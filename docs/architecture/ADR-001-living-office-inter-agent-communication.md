# ADR-001: Living Office — Inter-Agent Communication, Movement, and Visual Communication Lines

**Status:** Proposed
**Date:** 2026-03-16
**Author:** Technical Architect
**Stakeholders:** CEA, Backend Engineer, Frontend Engineer, Infra Engineer

---

## 1. Context and Motivation

Today, claude-office has a static office floor where agents sit at fixed desks. Communication flows exclusively through CEA: the user talks to CEA, CEA delegates to a specialist via the Claude `Agent` tool, and the specialist works in isolation. There is no visual representation of agents talking to each other, no physical movement when collaboration happens, and no peer-to-peer communication.

The goal is to create a **living office** where:

1. Agents can communicate with any other agent, not just through CEA
2. Visual **communication lines** appear between agents when they are talking
3. Agents **physically walk** to each other on the SVG floor when collaborating
4. The office feels alive — there is ambient motion, visible information flow, and spatial meaning

### Inspiration: OpenClaw Office and CLAW3D

The OpenClaw Office project (WW-AI-Lab/openclaw-office) and CLAW3D (claw3d.ai) demonstrate the key patterns we want to adopt:

- **Collaboration Lines** — SVG paths between communicating agents, with animated particles showing message direction
- **Agent Status Animations** — idle breathing, working bobbing, speaking waveforms (we already have these)
- **Meeting Zones** — agents gathering at a shared location (conference table, meeting pod) for multi-agent conversations
- **Speech Bubbles with Streaming** — live text streaming visible above agents (we partially have this)
- **Spatial Semantics** — the physical position of an agent conveys meaning (at desk = working solo, at meeting table = collaborating, walking = in transit)

---

## 2. Architecture Overview

The design spans four layers:

```
+------------------------------------------------------------------+
|  FRONTEND (Next.js + SVG + anime.js)                             |
|  - CommunicationLines layer (SVG paths between agents)           |
|  - Agent position interpolation (walking animations)             |
|  - Conversation indicators (speech bubbles, direction arrows)    |
+------------------------------------------------------------------+
        |  WebSocket (socket.io)
        v
+------------------------------------------------------------------+
|  WEBSOCKET SERVER (orchestrator)                                 |
|  - Relays collaboration events to connected clients              |
|  - New event types: collaboration:start, collaboration:end,      |
|    agent:move, agent:message                                     |
+------------------------------------------------------------------+
        |  Redis Pub/Sub + Streams
        v
+------------------------------------------------------------------+
|  COLLABORATION MANAGER (new service in orchestrator)             |
|  - Tracks active conversations between agent pairs               |
|  - Emits movement and line events                                |
|  - Manages conversation lifecycle                                |
+------------------------------------------------------------------+
        |  Calls into
        v
+------------------------------------------------------------------+
|  AGENT MANAGER + CEA MANAGER (existing)                          |
|  - Spawn/send messages to agents                                 |
|  - Emit subagent events that CollaborationManager intercepts     |
+------------------------------------------------------------------+
```

---

## 3. Part A: Inter-Agent Communication Protocol

### 3.1 Current State (CEA Hub-and-Spoke)

Today, all communication flows through CEA as a hub:

```
User -> CEA -> specialist-agent -> (work) -> CEA -> User
```

CEA uses the Claude `Agent` tool to spawn subagents. The subagent events flow back through the parent handle. There is no mechanism for `backend-engineer` to ask `frontend-engineer` a question.

### 3.2 Target State (Peer-to-Peer via Collaboration Manager)

We introduce a **CollaborationManager** service that sits alongside CEAManager and AgentManager. It does NOT replace CEA's delegation model — it augments it by:

1. **Detecting collaboration** from subagent events (CEA delegates to Agent A, Agent A's system prompt says "consult with Agent B")
2. **Enabling explicit peer requests** where an agent's output includes a structured collaboration request
3. **Managing the conversation lifecycle** between two (or more) agents

```
                          CollaborationManager
                         /         |          \
                   Agent A    Agent B    Agent C
                   (active)   (active)   (idle)
```

### 3.3 Collaboration Discovery

There are three ways a collaboration can be initiated:

#### Method 1: CEA-Orchestrated Parallel Delegation (existing, enhanced)

CEA already delegates to multiple specialists in parallel via the `Agent` tool. Today we see this as independent subagent events. The enhancement is that CollaborationManager detects when CEA has multiple active subagents for the same user request and treats them as a **collaboration group**.

**Detection signal:** When AgentManager processes a subagent event, it checks if the parent (CEA) has 2+ active subagents. If so, it emits a `collaboration:group_formed` event.

#### Method 2: Agent-Initiated Consultation (new)

An agent's system prompt includes instructions like: "If you need frontend expertise, output a structured consultation request." The agent produces a special marker in its assistant output:

```
[CONSULT:frontend-engineer] I need help with the React component structure for this API endpoint.
```

The orchestrator's event handler parses assistant text for `[CONSULT:<agent-id>]` patterns. When found, CollaborationManager:

1. Spawns or resumes the target agent with context from the requesting agent
2. Pipes the response back to the requesting agent via `sendMessage`
3. Emits collaboration lifecycle events throughout

#### Method 3: User-Directed Collaboration (new)

The user can explicitly say "Have the backend-engineer and frontend-engineer work together on this." CEA's system prompt is enhanced to recognize collaboration requests and emit them as parallel delegations with a shared context tag.

### 3.4 Conversation Threading

Each collaboration gets a unique `collaborationId`:

```typescript
interface Collaboration {
  id: string;                      // UUID
  type: 'parallel' | 'consultation' | 'meeting';
  initiator: string;               // agent configId who started it
  participants: string[];           // all agent configIds involved
  topic: string;                   // short description for UI
  startedAt: number;               // timestamp
  endedAt: number | null;
  parentRunId: string | null;      // ties back to CEA's run if applicable
  messages: CollaborationMessage[];
}

interface CollaborationMessage {
  id: string;
  collaborationId: string;
  fromAgent: string;
  toAgent: string;                 // '*' for broadcast to all participants
  content: string;
  timestamp: number;
}
```

This is stored in-memory in CollaborationManager (with optional Redis persistence for history replay).

### 3.5 Redis Channel Design

New channels added to `REDIS_CHANNELS`:

```typescript
export const REDIS_CHANNELS = {
  // ... existing channels ...

  /** Collaboration lifecycle events */
  COLLABORATIONS: 'rigelhq:collaborations',

  /** Per-collaboration message stream */
  collaborationMessages: (collabId: string) =>
    `rigelhq:collaboration:${collabId}:messages`,
} as const;
```

New stream for persistence:

```typescript
export const REDIS_STREAMS = {
  // ... existing streams ...

  /** Collaboration event history */
  COLLABORATIONS: 'rigelhq:collaborations:stream',
} as const;
```

---

## 4. Part B: Visual Communication Lines

### 4.1 Rendering Architecture

Communication lines are rendered as an SVG layer between the furniture layer (Layer 6) and the agent avatar layer (Layer 8). This is critical — lines must appear **behind** avatars but **above** desks and corridors.

In `office-floor.tsx`, the layer ordering becomes:

```
Layer 1: Base floor
Layer 2: Building shell
Layer 3: Zone backgrounds
Layer 4: Corridors
Layer 5: Zone labels
Layer 6: Furniture
Layer 7: Decorations
Layer 7.5: Communication Lines  <-- NEW
Layer 8: Agent avatars (topmost)
```

### 4.2 New Component: CommunicationLines

A new component `<CommunicationLines />` renders inside the SVG, reading from a new Zustand slice that tracks active collaborations.

```
<CommunicationLines collaborations={activeCollaborations} agents={agents} />
```

Each active collaboration between Agent A and Agent B produces:

1. **A curved SVG path** connecting the two agents' current positions
2. **Animated particles** flowing along the path in the direction of the current speaker
3. **A pulsing glow** on the path during active message exchange

### 4.3 Line Styles by State

| Collaboration State | Line Style | Particle Animation |
|---|---|---|
| `initiating` (agent walking to partner) | Dotted, low opacity (#ccc, 0.3) | None |
| `active` (agents talking) | Solid, medium opacity (agent color, 0.6) | Circles flowing from speaker to listener |
| `thinking` (one agent processing) | Dashed, pulsing opacity | Slow pulse along entire line |
| `idle` (paused, waiting for input) | Thin dotted, very low opacity | None |
| `ending` (wrapping up) | Fade out over 1.5s | Particles dissolve |

### 4.4 Path Calculation

Lines should be organic curves, not straight. Use quadratic Bezier curves with a control point offset perpendicular to the midpoint of the straight line between agents:

```
Given Agent A at (ax, ay) and Agent B at (bx, by):
  midX = (ax + bx) / 2
  midY = (ay + by) / 2
  dx = bx - ax
  dy = by - ay
  perpX = -dy * 0.15   // 15% perpendicular offset
  perpY = dx * 0.15
  controlX = midX + perpX
  controlY = midY + perpY

SVG path: M ax,ay Q controlX,controlY bx,by
```

When multiple lines exist between agents in the same zone, stagger the perpendicular offset to prevent overlap.

### 4.5 Particle Animation with anime.js

Each active line spawns 2-4 small circles (r=3) that travel along the SVG path using anime.js `motionPath`. The particles:

- Use the speaking agent's status color
- Have a slight trail effect (opacity gradient from 1.0 at head to 0.2 at tail)
- Are staggered with 300ms delays
- Complete one traversal in ~1.5s
- Loop continuously while the collaboration is active

Implementation approach:
- Define particles as `<circle>` elements with anime.js `motionPath` targeting the Bezier path
- Use `anime.stagger` for the delay between particles
- On collaboration end, animate particles to opacity 0 before removing

### 4.6 Performance Considerations

- **Maximum 8 concurrent lines** — if more collaborations exist, only show the most recent 8
- **Throttle position updates** to 10fps for line endpoint recalculation (agents move slowly; 10fps is imperceptible vs. 60fps)
- **Use CSS `will-change: transform`** on the communication lines layer for GPU compositing
- **Pool particle elements** — pre-allocate 32 circle elements (8 lines x 4 particles) and reuse them rather than creating/destroying DOM nodes

---

## 5. Part C: Agent Movement and Walking

### 5.1 Position Model

Currently, each agent has a static `position: { x, y }` computed at store initialization from their zone. We extend this to a dynamic model:

```typescript
interface AgentPosition {
  homeX: number;       // desk position (permanent)
  homeY: number;
  currentX: number;    // where the agent is right now
  currentY: number;
  targetX: number;     // where the agent is moving to
  targetY: number;
  isMoving: boolean;
  moveStartedAt: number | null;
  moveDuration: number;  // ms
}
```

The existing `position: { x, y }` in `AgentState` becomes `{ x: currentX, y: currentY }` for backward compatibility. New fields are added alongside.

### 5.2 Movement Triggers

An agent moves from their desk when:

1. **Consultation initiated** — Agent A walks to Agent B's desk
2. **Meeting called** — Multiple agents walk to the meeting table
3. **CEA delegation** — The specialist "leans forward" at their desk (existing small offset, enhanced)
4. **Collaboration complete** — Agent walks back to their home desk

### 5.3 Destination Calculation

| Scenario | Destination |
|---|---|
| Agent A consults Agent B | Midpoint between A's desk and B's desk, offset toward B by 30% |
| 2-agent collaboration | Each agent walks 40% of the way toward the other |
| 3+ agent meeting | All agents walk to the meeting table at (460, 230) |
| Return to desk | Agent's `homeX, homeY` |

For the midpoint approach, the formula is:

```
meetX = agentA.homeX + (agentB.homeX - agentA.homeX) * 0.4
meetY = agentA.homeY + (agentB.homeY - agentA.homeY) * 0.4
```

Each agent walks 40% toward the other, leaving a small gap between them at the meeting point.

### 5.4 Pathfinding

Full pathfinding (A*) is unnecessary for this office layout. Instead, use a **corridor-aware two-segment path**:

1. If both agents are in the **same zone**, use a direct lerp (straight line)
2. If agents are in **different zones**, route through the corridor intersection:
   - Walk from desk to nearest corridor entry point
   - Walk along corridor to the target zone's entry point
   - Walk from corridor to meeting point

The corridor intersection is at approximately (600, 350) — where the vertical and horizontal corridors cross.

Corridor entry points per zone:

| Zone | Corridor Entry (x, y) |
|---|---|
| Executive (top-left) | (586, 336) |
| Engineering (top-right) | (614, 336) |
| Quality (bottom-left) | (586, 364) |
| Ops (bottom-right) | (614, 364) |
| CEA Suite (top-center) | (600, -8) via vertical corridor |

A movement path is an array of waypoints:

```typescript
type Waypoint = { x: number; y: number };
type MovementPath = Waypoint[];  // 2-4 points
```

### 5.5 Animation

Agent movement uses anime.js with spring easing, matching the existing position animation in `agent-avatar.tsx`:

- **Walk speed:** ~120px per second (slow enough to be visible, fast enough to not feel sluggish)
- **Easing:** `easeInOutQuad` for natural acceleration/deceleration
- **Multi-waypoint:** Chain anime.js keyframes for corridor routing

The existing `useEffect` in `AgentAvatar` that animates `translateX/translateY` already handles this — we just need to update `agent.position` in the store, and the spring animation carries the avatar to its new location.

For multi-waypoint paths, we emit sequential `agent:move` events with ~500ms gaps, allowing the spring animation to chain naturally.

### 5.6 Return-to-Desk Behavior

When a collaboration ends (`collaboration:end` event), the CollaborationManager emits `agent:move` events returning each participant to their home position. A 1-second delay after the collaboration ends gives the user time to see the final state before agents start walking back.

If an agent receives a new collaboration while walking back, the return is interrupted and they redirect to the new destination. The spring animation handles this gracefully — there is no snapping.

---

## 6. Part D: Backend Event Flow

### 6.1 New Event Types

Extend `EventStream` to include collaboration-specific streams:

```typescript
export type EventStream =
  | 'lifecycle'
  | 'tool'
  | 'assistant'
  | 'error'
  | 'collaboration'   // NEW
  | 'movement';       // NEW
```

### 6.2 Collaboration Events

```typescript
// Emitted when a collaboration begins
interface CollaborationStartEvent {
  id: string;
  agentId: string;           // initiating agent
  runId: string;
  seq: number;
  stream: 'collaboration';
  timestamp: number;
  data: {
    phase: 'start';
    collaborationId: string;
    type: 'parallel' | 'consultation' | 'meeting';
    participants: string[];  // all agent configIds
    topic: string;
    initiatedBy: string;     // who triggered it
  };
}

// Emitted when a message flows between collaborating agents
interface CollaborationMessageEvent {
  id: string;
  agentId: string;           // the sending agent
  runId: string;
  seq: number;
  stream: 'collaboration';
  timestamp: number;
  data: {
    phase: 'message';
    collaborationId: string;
    fromAgent: string;
    toAgent: string;
    preview: string;         // first 80 chars for speech bubble
  };
}

// Emitted when a collaboration ends
interface CollaborationEndEvent {
  id: string;
  agentId: string;
  runId: string;
  seq: number;
  stream: 'collaboration';
  timestamp: number;
  data: {
    phase: 'end';
    collaborationId: string;
    participants: string[];
    durationMs: number;
  };
}
```

### 6.3 Movement Events

```typescript
interface AgentMoveEvent {
  id: string;
  agentId: string;
  runId: string;
  seq: number;
  stream: 'movement';
  timestamp: number;
  data: {
    phase: 'start' | 'waypoint' | 'arrived';
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    reason: 'collaboration' | 'return_to_desk' | 'meeting';
    collaborationId?: string;
  };
}
```

### 6.4 CollaborationManager Service

New file: `src/services/collaboration-manager.ts`

Responsibilities:

1. **Listen for subagent lifecycle events** — When AgentManager detects a new subagent starting, CollaborationManager checks if this creates a multi-agent collaboration
2. **Parse consultation markers** — Scan assistant text events for `[CONSULT:agent-id]` patterns
3. **Manage collaboration state** — Track active collaborations, their participants, and message flow
4. **Emit visual events** — Generate `collaboration:*` and `movement:*` events for the frontend
5. **Coordinate movement** — Calculate meeting positions and emit `agent:move` events

```
AgentManager.handleEvent()
    |
    v
CollaborationManager.onAgentEvent(event)
    |
    +-- Is this a new subagent? -> Check for collaboration group
    +-- Is this assistant text? -> Scan for [CONSULT:] markers
    +-- Is this lifecycle:end? -> Check if collaboration should end
    |
    v
EventBus.publish(collaborationEvent)
EventBus.publish(movementEvent)
```

### 6.5 WebSocket Relay

The existing pattern in `websocket-server.ts` already subscribes to Redis Pub/Sub and relays all events. Collaboration and movement events flow through the same `REDIS_CHANNELS.EVENTS` channel and are emitted as `agent:event` to all connected clients.

No new WebSocket event names are needed — the frontend distinguishes events by `event.stream === 'collaboration'` or `event.stream === 'movement'`.

### 6.6 Frontend State Management

Extend the Zustand store (`agent-store.ts`) with:

```typescript
interface ActiveCollaboration {
  id: string;
  type: 'parallel' | 'consultation' | 'meeting';
  participants: string[];
  topic: string;
  activeSpeaker: string | null;  // who is currently talking
  startedAt: number;
}

interface AgentStore {
  // ... existing fields ...

  // New collaboration state
  collaborations: Map<string, ActiveCollaboration>;
  agentPositions: Map<string, AgentPosition>;

  // New actions
  handleCollaborationEvent: (event: AgentEvent) => void;
  handleMovementEvent: (event: AgentEvent) => void;
}
```

The `handleEvent` method in the store is extended to route `collaboration` and `movement` stream events to their respective handlers.

---

## 7. End-to-End Flow Example

**Scenario:** User says "Build a login page with backend API and frontend component."

### Step 1: CEA Receives Task
CEA analyzes the task and decides to delegate to `backend-engineer` and `frontend-engineer` in parallel.

### Step 2: CEA Spawns Subagents
AgentManager spawns both specialists. CollaborationManager detects two subagents starting under the same parent run and emits:

```
collaboration:start {
  collaborationId: "collab-abc",
  type: "parallel",
  participants: ["backend-engineer", "frontend-engineer"],
  topic: "Login page implementation"
}
```

### Step 3: Agents Walk to Meeting Point
CollaborationManager calculates a meeting point between the two agents' desks and emits movement events:

```
movement:start { agentId: "backend-engineer", toX: 520, toY: 200, reason: "collaboration" }
movement:start { agentId: "frontend-engineer", toX: 580, toY: 200, reason: "collaboration" }
```

Frontend animates both agents walking from their desks toward each other.

### Step 4: Communication Line Appears
Frontend renders a curved SVG path between the two agents. Initially dotted (they are walking), then solid once both arrive.

### Step 5: Agents Work and Exchange Updates
As `backend-engineer` produces assistant text, a collaboration message event fires. The communication line animates particles flowing from backend to frontend. Speech bubbles appear above each agent as they produce output.

### Step 6: Consultation (Optional)
`frontend-engineer` outputs `[CONSULT:ux-designer] What's the best layout for mobile login?`. CollaborationManager:
- Adds `ux-designer` to the collaboration
- Emits movement event for ux-designer walking to the group
- A third communication line appears

### Step 7: Collaboration Ends
Both specialists complete. CollaborationManager emits:

```
collaboration:end { collaborationId: "collab-abc", durationMs: 45000 }
movement:start { agentId: "backend-engineer", toX: homeX, toY: homeY, reason: "return_to_desk" }
movement:start { agentId: "frontend-engineer", toX: homeX, toY: homeY, reason: "return_to_desk" }
```

Communication lines fade out. Agents walk back to their desks. CEA summarizes the results to the user.

---

## 8. File Changes Summary

### New Files

| File | Purpose |
|---|---|
| `orchestrator/src/services/collaboration-manager.ts` | Core collaboration tracking, event detection, movement coordination |
| `web/src/components/office/communication-lines.tsx` | SVG layer rendering animated lines between collaborating agents |
| `web/src/components/office/walking-path.ts` | Corridor-aware waypoint calculation utility |
| `shared/src/types/collaboration.ts` | Shared TypeScript types for collaboration and movement events |

### Modified Files

| File | Changes |
|---|---|
| `shared/src/types/events.ts` | Add `'collaboration'` and `'movement'` to `EventStream` union |
| `shared/src/constants/redis-channels.ts` | Add `COLLABORATIONS` channel and stream |
| `shared/src/types/agent.ts` | No changes needed (COLLABORATING status already exists) |
| `orchestrator/src/services/agent-manager.ts` | Hook into `handleEvent` to notify CollaborationManager |
| `orchestrator/src/services/cea-manager.ts` | Pass collaboration context to subagent prompts |
| `orchestrator/src/services/websocket-server.ts` | No changes needed (events flow through existing relay) |
| `orchestrator/src/index.ts` | Instantiate and wire CollaborationManager |
| `web/src/store/agent-store.ts` | Add `collaborations` map, `agentPositions` map, new handlers |
| `web/src/hooks/use-socket.ts` | Route collaboration/movement events to new store handlers |
| `web/src/components/office/office-floor.tsx` | Add `<CommunicationLines />` between Layer 7 and Layer 8 |
| `web/src/components/office/agent-avatar.tsx` | Read dynamic position from `agentPositions` map instead of static position |

---

## 9. Trade-offs and Alternatives Considered

### Alternative 1: Full Peer-to-Peer Agent Messaging (Rejected)

We considered giving each agent a direct messaging tool so any agent could message any other agent without orchestrator involvement. This was rejected because:
- It creates an N^2 communication topology that is hard to observe and debug
- It conflicts with the Claude `Agent` subagent model where the parent controls the lifecycle
- It would require a message broker between agents, adding significant complexity

Instead, we route all collaboration through the CollaborationManager, which provides centralized observability while still enabling the visual appearance of peer-to-peer communication.

### Alternative 2: A* Pathfinding on a Grid (Rejected)

Full grid-based pathfinding was considered for agent movement but rejected because:
- The office layout is simple (4 zones + corridors)
- A* would require maintaining a grid overlay and obstacle map
- The corridor-aware waypoint system achieves the same visual effect with 1/10th the complexity

### Alternative 3: WebSocket Rooms per Collaboration (Rejected)

We considered creating socket.io rooms for each collaboration so only relevant clients receive events. This was rejected because:
- The office visualization needs ALL collaboration events to render all lines
- The volume is low (max 8-10 concurrent collaborations)
- The existing broadcast model is simpler and sufficient

### Alternative 4: Canvas-Based Line Rendering (Rejected)

Canvas was considered for the communication lines to avoid SVG DOM overhead. Rejected because:
- The rest of the office is SVG; mixing renderers creates layering complexity
- At 8 lines with 4 particles each, we have only ~40 animated SVG elements — well within SVG performance budgets
- SVG paths work naturally with anime.js motionPath

---

## 10. Implementation Phases

### Phase 1: Backend Collaboration Detection (Week 1)
- Create `CollaborationManager` service
- Detect parallel subagent collaborations from existing CEA delegations
- Emit `collaboration:start` and `collaboration:end` events
- Emit `movement:*` events with calculated positions
- Wire into existing event bus and WebSocket relay

### Phase 2: Frontend Communication Lines (Week 1-2)
- Create `CommunicationLines` component
- Implement Bezier path calculation
- Add line rendering with style states (dotted, solid, fading)
- Add particle animation along paths using anime.js

### Phase 3: Agent Walking (Week 2)
- Extend agent store with dynamic position model
- Implement corridor-aware waypoint calculation
- Handle movement events in the store
- Existing anime.js spring animation handles the actual movement

### Phase 4: Agent-Initiated Consultation (Week 3)
- Add `[CONSULT:agent-id]` parsing in event handler
- Implement consultation spawn/response flow
- Add consultation instructions to agent system prompts
- Handle dynamic collaboration group expansion

### Phase 5: Polish and Ambient Life (Week 3-4)
- Add idle agent micro-movements (occasional chair swivel, stretch)
- Add "water cooler" encounters — low-priority random agent meetings
- Add meeting table gathering animation for 3+ agent collaborations
- Performance testing with all 21 agents active

---

## 11. Open Questions

1. **Collaboration history UI** — Should we show a timeline of past collaborations in the sidebar? This affects Redis stream retention policy.

2. **Maximum collaboration size** — Should we cap the number of agents in a single collaboration? CLAW3D allows up to 6 at a meeting table. Our meeting table has 6 chairs, which is a natural limit.

3. **Sound design** — Should collaboration events produce subtle audio cues (footstep sounds when walking, a gentle chime when a line connects)? This is a UX question, not architectural.

4. **Cross-zone line routing** — Should communication lines follow the corridor paths (like agents walk), or should they be direct curves? Corridor-following is more realistic but visually noisier. Recommendation: direct curves, as they are cleaner and the spatial meaning comes from agent positions, not line paths.

---

## 12. References

- [OpenClaw Office (WW-AI-Lab)](https://github.com/WW-AI-Lab/openclaw-office) — SVG isometric office with collaboration lines and agent status animations
- [CLAW3D](https://www.claw3d.ai/) — 3D virtual office with meeting table gathering and real-time agent communication
- [Claw-Empire](https://github.com/GreenSheep01201/claw-empire) — Pixel-art office simulator with agent collaboration across departments
- [ClawOffice on Product Hunt](https://www.producthunt.com/products/clawoffice) — 3D office walkthrough with desk-based agent interaction
- [wickedapp/openclaw-office](https://github.com/wickedapp/openclaw-office) — Animated mail envelopes showing task flow between agents
