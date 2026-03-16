# PRD: Living Office -- Agent Communication & Movement

**Author:** Product Manager (Senior PM, RigelHQ)
**Date:** 2026-03-16
**Status:** Draft -- Pending CEA Review
**Version:** 1.0

---

## 1. Problem Statement

Today, RigelHQ's office floor is a beautiful but **static** scene. Agents sit at their desks, their status rings pulse when they are working, and speech bubbles appear above their heads -- but there is no visual sense that these agents exist in a *shared space*. When the CEA delegates a task to the Frontend Engineer, the user sees status changes on two separate avatars but nothing connects them visually. There is no walking, no visible conversation between agents, no sense of collaboration happening across the room.

The result: the office feels like 21 independent chat windows with nice avatars, not a living office where a team works together.

### What Users Want

Users who deploy multi-agent systems want to **see** the collaboration happening. They want the same satisfaction you get watching a well-coordinated team in an open-plan office -- people walking over to each other's desks, huddling at a whiteboard, pointing at a screen together, then returning to their seats to execute.

### Competitive Context

Several products in this space have demonstrated that **visual agent collaboration** is a compelling UX differentiator:

- **ClawOffice / OpenClaw Office** renders collaboration lines between agents showing inter-agent message flow, with real-time status animations and an isometric virtual office scene.
- **Claw-Empire** simulates a pixel-art virtual software company where agents hold meetings, deliver tasks across departments, and collaborate visually -- the user is the CEO watching it all unfold.
- **Pixel Agents** (VS Code extension) maps agent actions to physical movements: writing code sends the agent to a computer, reading files sends it to a bookshelf, idle agents wander.
- **Agent Office** shows agents walking to desks, thinking, collaborating, hiring, and assigning tasks to each other -- all rendered in real-time pixel art.

The common thread: **mapping abstract agent state to spatial, physical metaphors** makes multi-agent workflows intuitive and engaging.

---

## 2. Goals & Success Metrics

### Goals

| # | Goal | Rationale |
|---|------|-----------|
| G1 | Make agent-to-agent collaboration visible and spatial | Users should immediately understand *who is talking to whom* and *why* |
| G2 | Create organic movement that makes the office feel alive | Static avatars feel like a dashboard; moving avatars feel like a team |
| G3 | Support any-to-any agent communication (not just CEA-to-specialist) | The current hub-and-spoke model (CEA delegates) should be visually clear, but the system must also handle future peer-to-peer collaboration |
| G4 | Maintain clarity at scale (21 agents, multiple simultaneous conversations) | The office must not become a confusing tangle of lines and movement |

### Success Metrics

| Metric | Baseline | Target | How Measured |
|--------|----------|--------|--------------|
| User can identify which agents are collaborating | Cannot tell at all | >90% accuracy in 2-second glance test | User testing (5+ participants) |
| Time to understand "what is happening right now" | ~8 seconds (must scan all 21 agents individually) | <3 seconds | Task-based user testing |
| Perceived "aliveness" rating | N/A (not measured) | 4+ out of 5 on post-session survey | Qualitative feedback |
| Performance (frame rate during 3+ simultaneous conversations) | N/A | Sustained 60fps, no jank | Chrome DevTools Performance panel |

---

## 3. User Stories

### US-1: See Communication Lines Between Collaborating Agents

**As a** user watching the office floor,
**I want to** see a visual line connecting two agents when one is talking to the other,
**so that** I can immediately understand which agents are involved in the current task.

**Acceptance Criteria:**

- **Given** the CEA delegates a task to the Backend Engineer, **When** the Backend Engineer's status changes to THINKING, **Then** a curved, animated line appears connecting the CEA avatar to the Backend Engineer avatar.
- **Given** a communication line is active, **When** the delegated agent completes its task (status returns to IDLE), **Then** the line fades out over 600ms with an ease-out animation.
- **Given** the CEA delegates to 3 agents simultaneously, **When** all 3 are active, **Then** 3 separate lines are visible, each connecting CEA to one specialist.
- **Given** a communication line is active, **When** the user hovers over the line, **Then** a tooltip shows "CEA -> Backend Engineer: [task summary]".

### US-2: Agents Walk to Each Other When Collaborating

**As a** user watching the office floor,
**I want to** see an agent physically move toward another agent when they start collaborating,
**so that** the collaboration feels spatial and natural, like real coworkers walking over to talk.

**Acceptance Criteria:**

- **Given** the CEA delegates a task to the Frontend Engineer, **When** the Frontend Engineer begins work, **Then** the Frontend Engineer's avatar moves from its desk to a midpoint between the two agents (or to a meeting area), using a spring-based easing over 800-1200ms.
- **Given** an agent has walked to a collaboration point, **When** the collaboration ends (agent returns to IDLE), **Then** the agent walks back to its original desk position over 800-1200ms.
- **Given** two agents from different zones need to collaborate, **When** they start, **Then** both agents walk toward the nearest corridor intersection or meeting table as their rendezvous point.
- **Given** an agent is already at a collaboration point, **When** it receives a NEW collaboration request, **Then** it stays at its current position (no jittering back and forth).

### US-3: Any Agent Can Communicate with Any Other Agent

**As a** user,
**I want to** see ANY agent visually communicate with ANY other agent (not just through the CEA),
**so that** future peer-to-peer workflows and cross-functional collaboration are visually represented.

**Acceptance Criteria:**

- **Given** the Backend Engineer uses a subagent tool to invoke the DBA Engineer, **When** the DBA Engineer activates, **Then** a communication line appears between Backend Engineer and DBA Engineer (not CEA and DBA).
- **Given** multiple collaboration pairs are active (CEA->FE, CEA->BE, BE->DBA), **When** displayed simultaneously, **Then** each pair has its own colored line and the visual hierarchy remains clear.
- **Given** Agent A talks to Agent B who then talks to Agent C, **When** all three are active, **Then** the chain is visible: A--B--C, showing the delegation path.

### US-4: Office Feels Alive with Organic Movement

**As a** user watching the office during idle periods,
**I want to** see subtle organic movement (agents shifting in seats, occasional stretch, looking around),
**so that** the office never feels frozen or dead, even when no active work is happening.

**Acceptance Criteria:**

- **Given** an agent has been IDLE for more than 10 seconds, **When** the idle animation timer fires, **Then** the agent performs one of several micro-animations (slight position shift, head tilt, "stretch" scale pulse) randomly selected.
- **Given** 21 agents are all IDLE, **When** observed for 30 seconds, **Then** at least 3-5 different agents should have shown subtle idle motion (staggered, not synchronized).
- **Given** the user has the tab in the background, **When** the tab becomes active again, **Then** animations do not replay all at once (use requestAnimationFrame and visibility checks).

### US-5: Visual Feedback for Group Conversations

**As a** user,
**I want to** see a clear visual when 3+ agents are working together on the same task,
**so that** I can distinguish a group collaboration from multiple independent conversations.

**Acceptance Criteria:**

- **Given** the CEA delegates to Frontend Engineer, Backend Engineer, and DBA Engineer for the same task, **When** all three are active, **Then** they converge at the nearest meeting table and a translucent "meeting zone" circle appears around the group.
- **Given** a group meeting is active, **When** one agent finishes and returns to IDLE, **Then** that agent walks back to its desk while the remaining agents stay at the meeting point.
- **Given** a group meeting is active, **When** the user clicks on the meeting zone, **Then** a panel shows all participating agents and a summary of what they are working on.

---

## 4. Interaction Model

### 4.1 What Triggers Agent-to-Agent Communication?

Communication is triggered by **existing orchestrator events**, not new backend work:

| Trigger | Source Event | Visual Result |
|---------|-------------|---------------|
| CEA delegates to specialist | CEA emits `tool` event with `subagent_type` in data | Line from CEA to specialist + specialist walks toward CEA |
| Specialist begins working | Specialist emits `lifecycle:start` | Specialist avatar activates, line becomes "active" (animated dash) |
| Specialist responds | Specialist emits `assistant` event | Speech bubble on specialist, line pulses briefly |
| Specialist completes | Specialist emits `lifecycle:end` | Line fades, specialist walks back to desk |
| Peer-to-peer (future) | Any agent emits `tool` event targeting another agent | Line between the two peers |

**Key insight:** The frontend already receives ALL agent events via WebSocket. The new "collaboration" data can be derived client-side by tracking which agent triggered which other agent's activation.

### 4.2 How Does the User Know Which Agents Are Talking?

Layered visual cues, from most visible to most subtle:

1. **Communication lines** (highest visibility) -- animated SVG paths between avatars
2. **Physical proximity** -- agents walk toward each other, breaking the grid layout
3. **Matched color coding** -- collaborating agents share a conversation color (e.g., both have a teal ring during their exchange)
4. **Speech bubbles** -- already exist, continue to show agent output text
5. **Status ring animation** -- already exists, continues to pulse during work

### 4.3 What Happens Visually During a Multi-Agent Task?

**Scenario: User asks "Build a login page with API and tests"**

1. **T=0s**: User message appears in chat. CEA starts thinking (dots animate).
2. **T=2s**: CEA decides to delegate to 3 agents. CEA's speech bubble shows "Delegating to Frontend, Backend, and QA..."
3. **T=3s**: Three communication lines spring out from CEA simultaneously. Frontend Engineer, Backend Engineer, and QA Tester all begin walking toward the meeting table in the Executive Wing.
4. **T=4s**: All three arrive at the meeting table. A translucent group zone circle appears. Each agent's status ring matches a shared "collaboration" color.
5. **T=5-30s**: Agents cycle through THINKING, TOOL_CALLING, SPEAKING as they work. Tool badges appear and disappear. Speech bubbles show progress snippets.
6. **T=15s**: Backend Engineer finishes first. Its communication line fades. It walks back to its desk. The meeting zone shrinks slightly.
7. **T=25s**: Frontend Engineer finishes. Same behavior. QA Tester remains.
8. **T=30s**: QA Tester finishes. Last line fades. Meeting zone dissolves. All agents are back at desks.
9. **T=32s**: CEA's speech bubble shows the summary. CEA returns to IDLE.

### 4.4 Speech Bubbles During Peer Conversations

- Speech bubbles continue to work exactly as they do today (appear above the speaking agent's head).
- **New:** When an agent is speaking *to* another specific agent, the speech bubble gets a small directional indicator (a subtle arrow or the target agent's icon) so users know who the message is addressed to.
- Speech bubbles auto-dismiss after 4 seconds or when the next speech event arrives, whichever is sooner.
- If two agents are speaking simultaneously, both bubbles are visible (they do not overlap because agents have moved to different positions).

---

## 5. Visual Requirements

### 5.1 Communication Lines

| Property | Specification |
|----------|--------------|
| Shape | Curved SVG `<path>` (quadratic bezier), not straight lines. The curve bows slightly away from the direct path to avoid overlapping other agents. |
| Color | Each active conversation gets a unique color from a curated palette (teal, amber, rose, violet, lime -- max 5 simultaneous conversations before colors repeat). |
| Thickness | 2px default, 3px when data is actively flowing (agent is SPEAKING). |
| Animation | Animated dashes flowing from sender to receiver (CSS `stroke-dashoffset` animation). Direction indicates who initiated. |
| Opacity | 0.6 default, 1.0 when hovered. Fade-in over 400ms on creation, fade-out over 600ms on completion. |
| Endpoints | Lines connect to the edge of each agent's status ring (R+2 from center), not the center of the avatar. |
| Layer | Rendered BELOW agent avatars but ABOVE furniture and floor, so agents always appear on top of lines. |

### 5.2 Walking Animation

| Property | Specification |
|----------|--------------|
| Movement model | Spring-based (already used in `agent-avatar.tsx` via anime.js). Stiffness: 80, Damping: 18 for a natural deceleration feel. |
| Speed | Approximately 150-200 SVG units per second. A cross-office walk (600 units) takes ~3-4 seconds. |
| Path | Agents walk in straight lines toward their target. If crossing a corridor, they path through the corridor intersection (waypoint-based). |
| Bobbing | The existing vertical bob animation should increase slightly during walking (amplitude +2px) to simulate a walking bounce. |
| Shadow | The ground shadow should follow the agent and compress/expand slightly during the bob to reinforce the walking feel. |
| Return to desk | When collaboration ends, agents return to their exact original desk position (stored in the agent store). |

### 5.3 Meeting Point Behavior

| Scenario | Meeting Point |
|----------|---------------|
| Two agents in the SAME zone | Midpoint between their desks (clamped to avoid walls). |
| Two agents in ADJACENT zones (share a corridor) | The corridor between their zones. |
| Two agents in DIAGONAL zones | The central corridor intersection (CX + CW/2, CY + CW/2). |
| 3+ agents (group) | The meeting table in the Executive Wing (x=460, y=230). If the Executive Wing meeting table is already occupied by another group, use the corridor sofa areas. |
| CEA + any specialist | The specialist walks toward the corridor nearest to the CEA suite (top of the vertical corridor). CEA stays in its suite. |

### 5.4 Handling 3+ Agents in a Group Conversation

- Agents arrange themselves in a circle around the meeting table, evenly spaced (similar to the chair positions already defined in `MeetingTable`).
- A translucent circle (the "meeting zone") appears centered on the meeting table with radius proportional to the number of participants (base 45px + 8px per agent beyond 2).
- Communication lines from the initiator (usually CEA) connect to each participant. Participants do not have lines to each other unless they explicitly communicate peer-to-peer.
- If a new agent joins an existing group, it walks to the next available position around the table and the meeting zone expands smoothly.

### 5.5 Visual Priority (What Is Most Important to Show)

When multiple things are happening, the rendering priority (front to back) is:

1. **Speech bubbles** (always on top -- the user needs to read these)
2. **Agent avatars** (agents are the primary objects of attention)
3. **Tool badges and status indicators** (attached to agents)
4. **Communication lines** (connecting tissue between agents)
5. **Meeting zones** (background context for group work)
6. **Furniture, floor, decorations** (environmental context)

---

## 6. Feature Prioritization

### P0 -- Must Have (This Phase)

| Feature | Rationale |
|---------|-----------|
| Communication lines between CEA and active specialists | This is the single highest-impact visual change. It immediately shows "who is working with whom." |
| Line lifecycle (appear on delegate, fade on complete) | Without lifecycle, lines would accumulate or never appear. |
| Collaboration state tracking in the agent store | The frontend needs to know which agents are collaborating with which. Derived from existing events. |
| Agent walking to collaboration midpoint | Walking is what makes the office "alive." Without it, lines are just a dashboard overlay. |
| Agent returning to desk on completion | Agents must go home or the layout degrades over time. |
| Color-coded conversation lines | Multiple simultaneous conversations must be distinguishable. |

### P1 -- Should Have

| Feature | Rationale |
|---------|-----------|
| Meeting table convergence for 3+ agents | Group tasks are common (CEA often delegates to 2-3 specialists). Visual grouping makes these legible. |
| Meeting zone (translucent circle around group) | Reinforces the "meeting" metaphor and provides a click target for details. |
| Directional speech bubbles (arrow to target) | Adds clarity about who is being addressed. |
| Waypoint-based pathfinding (walk through corridors) | Without it, agents walk through walls. Looks bad but is not blocking. |
| Hover tooltip on communication lines | Provides detail-on-demand: "CEA -> Backend: Building login API" |

### P2 -- Nice to Have (Future)

| Feature | Rationale |
|---------|-----------|
| Idle micro-animations (shift, stretch, look around) | Adds polish but is purely cosmetic. |
| Peer-to-peer communication lines (non-CEA initiated) | Requires backend changes to track which agent spawned which subagent directly. |
| Chain visualization (A -> B -> C delegation paths) | Complex to render clearly; revisit when peer-to-peer is live. |
| "Water cooler" spontaneous gatherings during idle | Delightful but not functional. |
| Sound effects (subtle audio cues for walks, delegations) | Must be opt-in; some users will find it annoying. |
| Minimap showing all active conversations | Useful at scale (10+ simultaneous conversations) but premature now. |

---

## 7. Data Model Changes (Frontend Only)

The backend already emits all necessary events. The frontend store needs a new **collaboration layer**:

```
Collaboration {
  id: string                    // unique conversation ID
  initiatorId: string           // agent who started the conversation (usually "cea")
  participantIds: string[]      // agents involved (including initiator)
  color: string                 // assigned from palette
  status: "active" | "fading"   // lifecycle state
  startedAt: number             // timestamp
  taskSummary: string | null    // extracted from CEA's speech bubble
}
```

**Deriving collaborations from existing events:**

1. When an agent's status changes from OFFLINE/IDLE to THINKING/TOOL_CALLING/SPEAKING, and a "parent" agent recently emitted a `tool` event with a subagent matching this agent's ID, create a Collaboration linking parent to child.
2. When the child agent's status returns to IDLE, transition the Collaboration to "fading" and remove it after the fade animation completes (600ms).
3. If a new participant joins an existing Collaboration (same parent, same time window), add them to `participantIds`.

This is **entirely client-side logic** and requires zero backend changes.

---

## 8. Edge Cases

### EC-1: Agent Already in a Conversation When Another Wants to Talk

**Scenario:** Backend Engineer is collaborating with CEA. Then the CEA also delegates to Backend Engineer for a second task.

**Behavior:** The Backend Engineer stays at its current collaboration position. A second communication line does NOT appear (same pair, same direction). The existing line pulses to indicate a new message. The agent's speech bubble updates with the new task context.

### EC-2: Multiple Simultaneous Conversations

**Scenario:** CEA delegates to Frontend, Backend, and QA simultaneously. Backend also triggers DBA.

**Behavior:** Four communication lines are visible: CEA->FE (teal), CEA->BE (amber), CEA->QA (rose), BE->DBA (violet). Each line has a distinct color. The visual is busy but legible because lines are curved and color-coded. If more than 5 conversations are active, colors begin repeating (the oldest conversation reuses its color for a new one).

### EC-3: Agent Walks to Someone Who Then Walks Away

**Scenario:** Backend Engineer starts walking toward CEA. Before arriving, CEA initiates a new conversation with a different agent and the Backend collaboration is canceled.

**Behavior:** Backend Engineer smoothly redirects its walk back to its desk (spring animation handles this naturally -- the target position simply changes). The communication line fades immediately. There is no awkward "arrival at empty space."

### EC-4: Very Fast Consecutive Communications

**Scenario:** CEA rapidly delegates to 5 agents in under 1 second.

**Behavior:** All 5 communication lines appear in quick succession (staggered by 100ms each for visual clarity, not simultaneous). All 5 agents begin walking. If all 5 are walking to the same meeting table, they stagger their arrival positions to avoid overlap. A 100ms debounce on collaboration creation prevents duplicate entries from rapid-fire events.

### EC-5: Agent Goes to ERROR During Collaboration

**Scenario:** Backend Engineer is collaborating with CEA and hits an error.

**Behavior:** The communication line turns red (matching the ERROR status color #b84a42) and becomes dashed. The Backend Engineer's status ring turns red (existing behavior). The agent does NOT walk back to its desk -- it stays at the collaboration point so the user can see which conversation errored. When the error is resolved or the agent goes IDLE, normal completion behavior resumes.

### EC-6: Browser Tab Hidden During Collaboration

**Scenario:** User switches tabs while 3 agents are collaborating. They all finish while the tab is hidden.

**Behavior:** When the user returns to the tab, agents are already at their desk positions (the animation state catches up instantly via the spring system). Communication lines have already been cleaned up. No "replay" of walks or fades occurs. The agent store state is the source of truth, not the animation state.

### EC-7: Page Refresh During Active Collaboration

**Scenario:** User refreshes the browser while agents are mid-collaboration.

**Behavior:** On reconnect, the WebSocket sends `agent:status-snapshot` with current statuses. The frontend rebuilds collaboration state from the snapshot: any agent that is not IDLE/OFFLINE and has a known parent relationship is placed in a collaboration. Lines appear immediately (no animation). Agents are positioned at their collaboration points instantly (no walk animation on reload).

---

## 9. Out of Scope

The following are explicitly NOT part of this feature:

- **Backend changes to the orchestrator** -- all collaboration tracking is client-side
- **New WebSocket event types** -- we derive everything from existing events
- **3D rendering or isometric view** -- we stay with the current 2D SVG approach
- **Agent personality or behavioral AI** -- movement is purely reactive to orchestrator events, not generative
- **Persistent collaboration history** -- collaborations are ephemeral (exist only while active)
- **Mobile-specific layouts** -- the office floor is desktop-first

---

## 10. Technical Notes for Engineering

These are NOT implementation prescriptions, but context to help engineering estimate and plan:

1. **Communication lines** can be implemented as a new SVG layer in `office-floor.tsx`, rendered between the furniture layer (Layer 6) and the avatar layer (Layer 8).
2. **Walking positions** can extend the existing `AgentState.position` field. The store already has `position: { x, y }` that the avatar reads. Changing this position already triggers the spring animation in `agent-avatar.tsx`.
3. **Collaboration tracking** can be a new Zustand slice or a new Map in the existing `agent-store.ts`.
4. **Anime.js is already a dependency** and handles spring-based movement, so no new animation library is needed.
5. **SVG curved paths** between two points: `M x1,y1 Q cx,cy x2,y2` where (cx, cy) is the control point offset perpendicular to the midpoint.

---

## 11. Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| Q1 | Should the CEA avatar ever leave its suite, or always stay put? | Product Manager + UX Designer | Before P0 dev starts |
| Q2 | Do we need a "collaboration panel" UI (sidebar showing active conversations), or are the visual cues sufficient? | UX Designer | Before P1 dev starts |
| Q3 | What is the maximum number of simultaneous conversations we need to support visually before we simplify (e.g., collapse into a count badge)? | Product Manager | During P0 testing |
| Q4 | Should communication lines be interactive (clickable to filter chat to that conversation)? | Product Manager + Frontend Engineer | P1 planning |

---

## 12. Appendix: Competitive Research Sources

- [OpenClaw Office -- GitHub (WW-AI-Lab)](https://github.com/WW-AI-Lab/openclaw-office) -- isometric virtual office with collaboration lines and real-time status
- [ClawOffice on Product Hunt](https://www.producthunt.com/products/clawoffice) -- 3D office where agents sit at desks
- [Claw-Empire -- GitHub](https://github.com/GreenSheep01201/claw-empire) -- pixel-art CEO desk simulator with departments and meetings
- [Pixel Agents -- GitHub](https://github.com/pablodelucca/pixel-agents) -- VS Code extension mapping agent actions to physical movement
- [Agents in the Office -- GitHub](https://github.com/gukosowa/agents-in-the-office) -- NPC-style agents mirroring real agent behavior
- [Agent Office -- GitHub](https://github.com/harishkotra/agent-office) -- real-time pixel art agents walking, collaborating, and growing
- [CLAW3D](https://www.claw3d.ai/) -- 3D virtual office for AI agents
- [OpenClaw on Fortune](https://fortune.com/2026/03/14/openclaw-china-ai-agent-boom-open-source-lobster-craze-minimax-qwen/) -- coverage of OpenClaw ecosystem growth
