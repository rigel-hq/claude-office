# Implementation Plan: Living Office -- Agent Communication, Movement & Visual Lines

**Author:** Technical Architect
**Date:** 2026-03-16
**Status:** Ready for Implementation
**References:**
- ADR: `/docs/architecture/ADR-001-living-office-inter-agent-communication.md`
- PRD: `/docs/prd-living-office.md`

---

## Overview

This plan implements the "Living Office" feature across three parallel workstreams. The Shared Package (Workstream 1) must be completed first because both Backend and Frontend depend on it. After that, Backend (Workstream 2) and Frontend (Workstream 3) can proceed in parallel.

### Dependency Graph

```
Workstream 1: Shared Package
    |
    +---> Workstream 2: Backend (Orchestrator)
    |
    +---> Workstream 3: Frontend (Web)
```

### Key Files Reference (Read These Before Starting)

| Alias | Absolute Path |
|-------|---------------|
| `events.ts` | `/packages/shared/src/types/events.ts` |
| `redis-channels.ts` | `/packages/shared/src/constants/redis-channels.ts` |
| `agent.ts` (types) | `/packages/shared/src/types/agent.ts` |
| `agent-roles.ts` | `/packages/shared/src/constants/agent-roles.ts` |
| `agent-manager.ts` | `/apps/orchestrator/src/services/agent-manager.ts` |
| `event-bus.ts` | `/apps/orchestrator/src/services/event-bus.ts` |
| `cea-manager.ts` | `/apps/orchestrator/src/services/cea-manager.ts` |
| `websocket-server.ts` | `/apps/orchestrator/src/services/websocket-server.ts` |
| `index.ts` (orch) | `/apps/orchestrator/src/index.ts` |
| `agent-store.ts` | `/apps/web/src/store/agent-store.ts` |
| `use-socket.ts` | `/apps/web/src/hooks/use-socket.ts` |
| `office-floor.tsx` | `/apps/web/src/components/office/office-floor.tsx` |
| `agent-avatar.tsx` | `/apps/web/src/components/office/agent-avatar.tsx` |

All paths in this document are relative to the monorepo root: `/Users/charantej/charan_personal_projects/claude-office`

---

## Workstream 1: Shared Package (`packages/shared`)

This workstream adds shared types and constants that both Backend and Frontend consume. Complete this first.

---

### Task 1.1: Add Collaboration and Movement Types

**File:** `packages/shared/src/types/collaboration.ts` (NEW)

- [ ] Create the file with the following types:

```typescript
// packages/shared/src/types/collaboration.ts

export type CollaborationType = 'parallel' | 'consultation' | 'meeting';

export type CollaborationPhase =
  | 'start'
  | 'message'
  | 'end';

export type MovementPhase =
  | 'start'
  | 'waypoint'
  | 'arrived';

export type MovementReason =
  | 'collaboration'
  | 'return_to_desk'
  | 'meeting';

export interface Collaboration {
  id: string;
  type: CollaborationType;
  initiator: string;
  participants: string[];
  topic: string;
  startedAt: number;
  endedAt: number | null;
  parentRunId: string | null;
  messages: CollaborationMessage[];
}

export interface CollaborationMessage {
  id: string;
  collaborationId: string;
  fromAgent: string;
  toAgent: string;   // '*' for broadcast to all participants
  content: string;
  timestamp: number;
}

/**
 * Extended position model for dynamic agent movement.
 * The existing AgentState.position becomes { x: currentX, y: currentY }.
 */
export interface AgentPosition {
  homeX: number;
  homeY: number;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  moveStartedAt: number | null;
  moveDuration: number;
}
```

- [ ] Verify: `npx tsc --noEmit` passes from `packages/shared`

---

### Task 1.2: Extend EventStream with New Stream Types

**File:** `packages/shared/src/types/events.ts` (MODIFY)

- [ ] Add `'collaboration'` and `'movement'` to the `EventStream` union type:

```typescript
// BEFORE:
export type EventStream = 'lifecycle' | 'tool' | 'assistant' | 'error';

// AFTER:
export type EventStream = 'lifecycle' | 'tool' | 'assistant' | 'error' | 'collaboration' | 'movement';
```

- [ ] No other changes needed in this file. The `AgentEvent` interface already uses `data: { phase?: ...; [key: string]: unknown }` which is flexible enough for collaboration and movement payloads.
- [ ] Verify: `npx tsc --noEmit` passes from `packages/shared`

---

### Task 1.3: Add Redis Channels for Collaborations

**File:** `packages/shared/src/constants/redis-channels.ts` (MODIFY)

- [ ] Add collaboration channels to `REDIS_CHANNELS`:

```typescript
export const REDIS_CHANNELS = {
  /** Global event stream (all agents) */
  EVENTS: 'rigelhq:events',
  /** Per-agent event stream: rigelhq:agent:{configId}:events */
  agentEvents: (configId: string) => `rigelhq:agent:${configId}:events`,
  /** Per-agent status: rigelhq:agent:{configId}:status */
  agentStatus: (configId: string) => `rigelhq:agent:${configId}:status`,
  /** Task status changes */
  TASK_UPDATES: 'rigelhq:tasks:updates',
  /** User-agent chat messages */
  CHAT_MESSAGES: 'rigelhq:chat:messages',

  // --- NEW ---
  /** Collaboration lifecycle events */
  COLLABORATIONS: 'rigelhq:collaborations',
  /** Per-collaboration message stream */
  collaborationMessages: (collabId: string) =>
    `rigelhq:collaboration:${collabId}:messages`,
} as const;
```

- [ ] Add collaboration stream to `REDIS_STREAMS`:

```typescript
export const REDIS_STREAMS = {
  /** Main event stream for history/replay */
  EVENTS: 'rigelhq:events:stream',
  /** Per-agent event stream */
  agentEvents: (configId: string) => `rigelhq:agent:${configId}:stream`,

  // --- NEW ---
  /** Collaboration event history */
  COLLABORATIONS: 'rigelhq:collaborations:stream',
} as const;
```

- [ ] Verify: `npx tsc --noEmit` passes from `packages/shared`

---

### Task 1.4: Export New Types from Package Barrel

**File:** `packages/shared/src/types/index.ts` (MODIFY)

- [ ] Add the export for the new collaboration types:

```typescript
export * from './agent.js';
export * from './task.js';
export * from './message.js';
export * from './events.js';
export * from './collaboration.js';  // NEW
```

- [ ] Verify: `npx tsc --noEmit` passes from `packages/shared`

---

### Task 1.5: Build the Shared Package

- [ ] Run the build from the shared package directory:

```bash
cd packages/shared && npm run build
```

- [ ] Verify no errors. Both orchestrator and web apps import from `@rigelhq/shared`, so they need the built output.

---

## Workstream 2: Backend -- Orchestrator (`apps/orchestrator`)

This workstream adds the CollaborationManager service and hooks it into the existing event flow. It can proceed in parallel with Workstream 3 after Workstream 1 is complete.

---

### Task 2.1: Create CollaborationManager Service

**File:** `apps/orchestrator/src/services/collaboration-manager.ts` (NEW)

This is the core new service. It tracks active collaborations, detects them from agent events, calculates meeting positions, and emits collaboration + movement events.

- [ ] Create the file with the following implementation:

```typescript
// apps/orchestrator/src/services/collaboration-manager.ts

import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { Collaboration, CollaborationMessage } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';

/**
 * Zone layout constants — must match the frontend ZONE_POSITIONS in agent-store.ts
 * and the corridor dimensions in office-floor.tsx.
 */
const ZONE_POSITIONS: Record<string, { baseX: number; baseY: number }> = {
  'ceo-suite': { baseX: 600, baseY: -40 },
  executive:   { baseX: 130, baseY: 130 },
  engineering: { baseX: 700, baseY: 130 },
  quality:     { baseX: 130, baseY: 470 },
  ops:         { baseX: 700, baseY: 470 },
};

/** Corridor entry points per zone (from ADR Section 5.4) */
const CORRIDOR_ENTRY: Record<string, { x: number; y: number }> = {
  'ceo-suite':  { x: 600, y: -8 },
  executive:    { x: 586, y: 336 },
  engineering:  { x: 614, y: 336 },
  quality:      { x: 586, y: 364 },
  ops:          { x: 614, y: 364 },
};

/** Meeting table position */
const MEETING_TABLE = { x: 460, y: 230 };

/** Corridor intersection */
const CORRIDOR_CENTER = { x: 600, y: 350 };

/** How long before agents walk back after collaboration ends (ms) */
const RETURN_DELAY_MS = 1500;

/** Max tracked collaborations */
const MAX_COLLABORATIONS = 20;

interface AgentHomePosition {
  x: number;
  y: number;
  zone: string;
}

export class CollaborationManager {
  /** Active collaborations keyed by collaborationId */
  private collaborations = new Map<string, Collaboration>();

  /** Map agentId -> Set of collaborationIds they are in */
  private agentCollaborations = new Map<string, Set<string>>();

  /** Track which subagents belong to which parent run */
  private runSubagents = new Map<string, Set<string>>();

  /** Agent home positions (desk positions), keyed by configId */
  private agentHomes = new Map<string, AgentHomePosition>();

  /** Sequence counter for event IDs */
  private seq = 0;

  constructor(private eventBus: EventBus) {
    this.initAgentHomes();
  }

  /**
   * Pre-compute agent home (desk) positions from AGENT_ROLES.
   * Uses the same grid-layout algorithm as the frontend agent-store.ts initAgents().
   */
  private initAgentHomes(): void {
    const { AGENT_ROLES } = require('@rigelhq/shared');
    const zoneCounters: Record<string, number> = {};

    for (const role of AGENT_ROLES) {
      const zone = role.zone as string;
      zoneCounters[zone] = (zoneCounters[zone] ?? 0) + 1;
      const idx = zoneCounters[zone];
      const base = ZONE_POSITIONS[zone] ?? { baseX: 300, baseY: 300 };

      const col = (idx - 1) % 3;
      const row = Math.floor((idx - 1) / 3);

      this.agentHomes.set(role.id, {
        x: base.baseX + col * 180,
        y: base.baseY + row * 120,
        zone,
      });
    }
  }

  /**
   * Called by AgentManager.handleEvent() for every agent event.
   * This is the main entry point for collaboration detection.
   */
  async onAgentEvent(event: AgentEvent, parentConfigId: string): Promise<void> {
    const agentId = event.agentId;
    const isSubagent = agentId !== parentConfigId;

    // --- 1. Detect parallel collaboration groups ---
    if (isSubagent && event.stream === 'lifecycle' && event.data.phase === 'start') {
      await this.onSubagentStart(agentId, parentConfigId, event.runId);
    }

    // --- 2. Detect collaboration end ---
    if (isSubagent && event.stream === 'lifecycle' && event.data.phase === 'end') {
      await this.onSubagentEnd(agentId);
    }

    // --- 3. Parse [CONSULT:agent-id] markers from assistant text ---
    if (event.stream === 'assistant' && event.data.text) {
      await this.parseConsultationMarkers(agentId, event.data.text as string, event.runId);
    }

    // --- 4. Emit collaboration message events for active collaborations ---
    if (event.stream === 'assistant' && event.data.text) {
      await this.emitCollaborationMessage(agentId, event.data.text as string);
    }
  }

  /**
   * A subagent started. Check if the parent has multiple active subagents,
   * forming a collaboration group.
   */
  private async onSubagentStart(
    subagentId: string,
    parentConfigId: string,
    runId: string,
  ): Promise<void> {
    // Track subagent under this run
    if (!this.runSubagents.has(parentConfigId)) {
      this.runSubagents.set(parentConfigId, new Set());
    }
    const siblings = this.runSubagents.get(parentConfigId)!;
    siblings.add(subagentId);

    // Check: does an active collaboration already include this parent?
    const existingCollab = this.findCollaborationByInitiator(parentConfigId);

    if (existingCollab) {
      // Add this subagent to the existing collaboration
      if (!existingCollab.participants.includes(subagentId)) {
        existingCollab.participants.push(subagentId);
        this.trackAgentCollaboration(subagentId, existingCollab.id);

        // Emit updated collaboration event
        await this.emitCollaborationStart(existingCollab, subagentId);

        // Move the new participant to the meeting point
        await this.emitMovementToMeetingPoint(existingCollab);
      }
      return;
    }

    // If the parent now has 1+ subagents, create a collaboration
    // (a single delegation is still a 2-party collaboration: parent + child)
    const participants = [parentConfigId, subagentId];
    const topic = this.inferTopic(parentConfigId, subagentId);

    const collab: Collaboration = {
      id: uuidv4(),
      type: siblings.size >= 3 ? 'meeting' : siblings.size >= 2 ? 'parallel' : 'consultation',
      initiator: parentConfigId,
      participants,
      topic,
      startedAt: Date.now(),
      endedAt: null,
      parentRunId: runId,
      messages: [],
    };

    // Enforce max
    if (this.collaborations.size >= MAX_COLLABORATIONS) {
      const oldest = [...this.collaborations.values()]
        .sort((a, b) => a.startedAt - b.startedAt)[0];
      if (oldest) {
        await this.endCollaboration(oldest.id);
      }
    }

    this.collaborations.set(collab.id, collab);
    this.trackAgentCollaboration(parentConfigId, collab.id);
    this.trackAgentCollaboration(subagentId, collab.id);

    // Emit collaboration:start
    await this.emitCollaborationStart(collab, subagentId);

    // Calculate and emit movement events
    await this.emitMovementToMeetingPoint(collab);
  }

  /**
   * A subagent ended. If it was the last participant, end the collaboration.
   * Otherwise, just remove it from the collaboration and emit a return-to-desk event.
   */
  private async onSubagentEnd(subagentId: string): Promise<void> {
    const collabIds = this.agentCollaborations.get(subagentId);
    if (!collabIds) return;

    for (const collabId of [...collabIds]) {
      const collab = this.collaborations.get(collabId);
      if (!collab) continue;

      // Remove this agent from participants
      collab.participants = collab.participants.filter(p => p !== subagentId);

      // Emit return-to-desk for this agent (delayed)
      setTimeout(async () => {
        await this.emitReturnToDesk(subagentId);
      }, RETURN_DELAY_MS);

      // If only the initiator remains, end the collaboration
      if (collab.participants.length <= 1) {
        await this.endCollaboration(collabId);
      }
    }

    this.agentCollaborations.delete(subagentId);
  }

  /**
   * Parse assistant text for [CONSULT:agent-id] markers.
   * When found, create a consultation collaboration.
   */
  private async parseConsultationMarkers(
    fromAgentId: string,
    text: string,
    runId: string,
  ): Promise<void> {
    const consultRegex = /\[CONSULT:([a-z0-9-]+)\]\s*(.*)/gi;
    let match: RegExpExecArray | null;

    while ((match = consultRegex.exec(text)) !== null) {
      const targetAgentId = match[1];
      const message = match[2]?.trim() ?? '';

      // Validate target agent exists
      if (!AGENT_ROLE_MAP.has(targetAgentId)) {
        console.warn(`[CollabMgr] Unknown consultation target: ${targetAgentId}`);
        continue;
      }

      // Check if these two are already collaborating
      const existing = this.findCollaborationBetween(fromAgentId, targetAgentId);
      if (existing) {
        // Just emit a message event on the existing collaboration
        await this.emitCollabMessage(existing.id, fromAgentId, targetAgentId, message);
        continue;
      }

      // Create a new consultation collaboration
      const collab: Collaboration = {
        id: uuidv4(),
        type: 'consultation',
        initiator: fromAgentId,
        participants: [fromAgentId, targetAgentId],
        topic: message.slice(0, 80) || `${fromAgentId} consulting ${targetAgentId}`,
        startedAt: Date.now(),
        endedAt: null,
        parentRunId: runId,
        messages: [],
      };

      this.collaborations.set(collab.id, collab);
      this.trackAgentCollaboration(fromAgentId, collab.id);
      this.trackAgentCollaboration(targetAgentId, collab.id);

      await this.emitCollaborationStart(collab, fromAgentId);
      await this.emitMovementToMeetingPoint(collab);

      console.log(`[CollabMgr] Consultation: ${fromAgentId} -> ${targetAgentId}: ${message.slice(0, 60)}`);
    }
  }

  /**
   * If an agent is in an active collaboration and produces assistant text,
   * emit a collaboration:message event so the frontend can animate particles.
   */
  private async emitCollaborationMessage(
    agentId: string,
    text: string,
  ): Promise<void> {
    const collabIds = this.agentCollaborations.get(agentId);
    if (!collabIds) return;

    for (const collabId of collabIds) {
      const collab = this.collaborations.get(collabId);
      if (!collab || collab.endedAt) continue;

      // Determine the "target" — the other participant(s)
      const others = collab.participants.filter(p => p !== agentId);
      const toAgent = others.length === 1 ? others[0] : '*';

      await this.emitCollabMessage(collabId, agentId, toAgent, text);
    }
  }

  // ── Event Emission Helpers ────────────────────────────

  private async emitCollaborationStart(
    collab: Collaboration,
    triggerAgent: string,
  ): Promise<void> {
    const event: AgentEvent = {
      id: `collab-${this.seq++}`,
      agentId: triggerAgent,
      runId: collab.parentRunId ?? 'n/a',
      seq: this.seq,
      stream: 'collaboration',
      timestamp: Date.now(),
      data: {
        phase: 'start',
        collaborationId: collab.id,
        type: collab.type,
        participants: collab.participants,
        topic: collab.topic,
        initiatedBy: collab.initiator,
      },
    };
    await this.eventBus.publish(event);
  }

  private async emitCollabMessage(
    collaborationId: string,
    fromAgent: string,
    toAgent: string,
    text: string,
  ): Promise<void> {
    const event: AgentEvent = {
      id: `collab-msg-${this.seq++}`,
      agentId: fromAgent,
      runId: 'n/a',
      seq: this.seq,
      stream: 'collaboration',
      timestamp: Date.now(),
      data: {
        phase: 'message',
        collaborationId,
        fromAgent,
        toAgent,
        preview: text.slice(0, 80),
      },
    };
    await this.eventBus.publish(event);
  }

  private async emitCollaborationEnd(collab: Collaboration): Promise<void> {
    const event: AgentEvent = {
      id: `collab-end-${this.seq++}`,
      agentId: collab.initiator,
      runId: collab.parentRunId ?? 'n/a',
      seq: this.seq,
      stream: 'collaboration',
      timestamp: Date.now(),
      data: {
        phase: 'end',
        collaborationId: collab.id,
        participants: collab.participants,
        durationMs: Date.now() - collab.startedAt,
      },
    };
    await this.eventBus.publish(event);
  }

  /**
   * Calculate a meeting point for the collaboration and emit
   * movement:start events for all participants.
   */
  private async emitMovementToMeetingPoint(collab: Collaboration): Promise<void> {
    const participants = collab.participants;

    // If 3+ participants, everyone goes to the meeting table
    if (participants.length >= 3) {
      const angleStep = (2 * Math.PI) / participants.length;
      for (let i = 0; i < participants.length; i++) {
        const agentId = participants[i];
        const home = this.agentHomes.get(agentId);
        if (!home) continue;

        // CEA stays in its suite
        if (agentId === 'cea') continue;

        const targetX = MEETING_TABLE.x + Math.cos(angleStep * i) * 50;
        const targetY = MEETING_TABLE.y + Math.sin(angleStep * i) * 50;

        await this.emitMovement(agentId, home, targetX, targetY, 'meeting', collab.id);
      }
      return;
    }

    // 2-participant collaboration: each walks 40% toward the other
    if (participants.length === 2) {
      const [a, b] = participants;
      const homeA = this.agentHomes.get(a);
      const homeB = this.agentHomes.get(b);
      if (!homeA || !homeB) return;

      // CEA stays in its suite
      const ceaIsA = a === 'cea';
      const ceaIsB = b === 'cea';

      if (!ceaIsA) {
        const targetAx = homeA.x + (homeB.x - homeA.x) * 0.4;
        const targetAy = homeA.y + (homeB.y - homeA.y) * 0.4;
        await this.emitMovement(a, homeA, targetAx, targetAy, 'collaboration', collab.id);
      }

      if (!ceaIsB) {
        const targetBx = homeB.x + (homeA.x - homeB.x) * 0.4;
        const targetBy = homeB.y + (homeA.y - homeB.y) * 0.4;
        await this.emitMovement(b, homeB, targetBx, targetBy, 'collaboration', collab.id);
      }
    }
  }

  private async emitReturnToDesk(agentId: string): Promise<void> {
    const home = this.agentHomes.get(agentId);
    if (!home) return;

    // CEA never moves
    if (agentId === 'cea') return;

    const event: AgentEvent = {
      id: `move-${this.seq++}`,
      agentId,
      runId: 'n/a',
      seq: this.seq,
      stream: 'movement',
      timestamp: Date.now(),
      data: {
        phase: 'start',
        fromX: 0,   // frontend uses its own current position
        fromY: 0,
        toX: home.x,
        toY: home.y,
        reason: 'return_to_desk',
      },
    };
    await this.eventBus.publish(event);
  }

  private async emitMovement(
    agentId: string,
    home: AgentHomePosition,
    toX: number,
    toY: number,
    reason: string,
    collaborationId?: string,
  ): Promise<void> {
    const event: AgentEvent = {
      id: `move-${this.seq++}`,
      agentId,
      runId: 'n/a',
      seq: this.seq,
      stream: 'movement',
      timestamp: Date.now(),
      data: {
        phase: 'start',
        fromX: home.x,
        fromY: home.y,
        toX,
        toY,
        reason,
        collaborationId,
      },
    };
    await this.eventBus.publish(event);
  }

  // ── Query Helpers ─────────────────────────────────────

  private findCollaborationByInitiator(initiator: string): Collaboration | undefined {
    for (const collab of this.collaborations.values()) {
      if (collab.initiator === initiator && !collab.endedAt) {
        return collab;
      }
    }
    return undefined;
  }

  private findCollaborationBetween(a: string, b: string): Collaboration | undefined {
    for (const collab of this.collaborations.values()) {
      if (collab.endedAt) continue;
      if (collab.participants.includes(a) && collab.participants.includes(b)) {
        return collab;
      }
    }
    return undefined;
  }

  private async endCollaboration(collabId: string): Promise<void> {
    const collab = this.collaborations.get(collabId);
    if (!collab || collab.endedAt) return;

    collab.endedAt = Date.now();
    await this.emitCollaborationEnd(collab);

    // Return all remaining participants to desks
    for (const participantId of collab.participants) {
      setTimeout(async () => {
        await this.emitReturnToDesk(participantId);
      }, RETURN_DELAY_MS);
    }

    // Clean up tracking
    for (const participantId of collab.participants) {
      const set = this.agentCollaborations.get(participantId);
      if (set) {
        set.delete(collabId);
        if (set.size === 0) this.agentCollaborations.delete(participantId);
      }
    }

    // Remove from active map after a grace period (for late events)
    setTimeout(() => {
      this.collaborations.delete(collabId);
    }, 10_000);
  }

  private trackAgentCollaboration(agentId: string, collabId: string): void {
    if (!this.agentCollaborations.has(agentId)) {
      this.agentCollaborations.set(agentId, new Set());
    }
    this.agentCollaborations.get(agentId)!.add(collabId);
  }

  private inferTopic(initiator: string, participant: string): string {
    const initiatorMeta = AGENT_ROLE_MAP.get(initiator);
    const participantMeta = AGENT_ROLE_MAP.get(participant);
    return `${initiatorMeta?.name ?? initiator} delegating to ${participantMeta?.name ?? participant}`;
  }

  /** Get active collaborations (for snapshot on client connect) */
  getActiveCollaborations(): Collaboration[] {
    return [...this.collaborations.values()].filter(c => !c.endedAt);
  }

  /** Clean up on shutdown */
  async stopAll(): Promise<void> {
    for (const collabId of [...this.collaborations.keys()]) {
      await this.endCollaboration(collabId);
    }
    this.collaborations.clear();
    this.agentCollaborations.clear();
    this.runSubagents.clear();
  }
}
```

- [ ] Verify: `npx tsc --noEmit` passes from `apps/orchestrator`

---

### Task 2.2: Hook CollaborationManager into AgentManager.handleEvent

**File:** `apps/orchestrator/src/services/agent-manager.ts` (MODIFY)

The CollaborationManager needs to observe every agent event. The cleanest integration point is inside `handleEvent`, right after the event is published to the EventBus.

- [ ] Add a `collaborationManager` property and setter to `AgentManager`:

```typescript
// At the top of the class, add a new field:
private collaborationManager: CollaborationManager | null = null;

// Add a setter method (below the constructor):
setCollaborationManager(cm: CollaborationManager): void {
  this.collaborationManager = cm;
}
```

- [ ] Add the import at the top of the file:

```typescript
import type { CollaborationManager } from './collaboration-manager.js';
```

- [ ] In `handleEvent`, after the `await this.eventBus.publish(event)` call (line ~294), add:

```typescript
    // Notify CollaborationManager so it can detect collaboration patterns
    if (this.collaborationManager) {
      await this.collaborationManager.onAgentEvent(event, configId);
    }
```

Note: `configId` here is the parent agent ID (the first argument to `handleEvent`). This is important because `event.agentId` may be a subagent ID, but CollaborationManager needs to know the parent.

- [ ] Verify: `npx tsc --noEmit` passes from `apps/orchestrator`

---

### Task 2.3: Wire CollaborationManager into index.ts

**File:** `apps/orchestrator/src/index.ts` (MODIFY)

- [ ] Add the import:

```typescript
import { CollaborationManager } from './services/collaboration-manager.js';
```

- [ ] After `const ceaManager = ...` (around line 38), instantiate CollaborationManager:

```typescript
  const collaborationManager = new CollaborationManager(eventBus);
  agentManager.setCollaborationManager(collaborationManager);
```

- [ ] Wire CollaborationManager to WebSocketServer so it can send collaboration snapshots on connect. Add to `WebSocketServer`:

```typescript
  wsServer.setCollaborationManager(collaborationManager);
```

- [ ] In the `shutdown` function, add cleanup before `agentManager.stopAll()`:

```typescript
    await collaborationManager.stopAll();
```

- [ ] Verify: `npx tsc --noEmit` passes from `apps/orchestrator`

---

### Task 2.4: Add Collaboration Snapshot to WebSocket Connect

**File:** `apps/orchestrator/src/services/websocket-server.ts` (MODIFY)

When a client connects, they need the current collaboration state (just like they get `agent:status-snapshot`).

- [ ] Add a `collaborationManager` property and setter:

```typescript
  private collaborationManager: CollaborationManager | null = null;

  setCollaborationManager(cm: CollaborationManager): void {
    this.collaborationManager = cm;
  }
```

- [ ] Add the import:

```typescript
import type { CollaborationManager } from './collaboration-manager.js';
```

- [ ] In `setupHandlers`, inside the `connection` handler, after the `agent:status-snapshot` emit block (~line 68), add:

```typescript
      // Send active collaborations snapshot so the UI shows current lines immediately
      if (this.collaborationManager) {
        try {
          const collabs = this.collaborationManager.getActiveCollaborations();
          socket.emit('collaboration:snapshot', collabs);
        } catch {
          // Best effort
        }
      }
```

- [ ] Verify: `npx tsc --noEmit` passes from `apps/orchestrator`

---

### Task 2.5: Verify End-to-End Backend Flow

- [ ] Write a quick manual test or use the mock adapter:
  1. Start the orchestrator with `RIGELHQ_ADAPTER=mock`
  2. Send a chat message that triggers CEA to delegate to 2+ agents
  3. Verify in the console logs that:
     - `[CollabMgr] Consultation: ...` or collaboration start events appear
     - Movement events are emitted
     - Collaboration end events fire when subagents complete
- [ ] If using the mock adapter, verify that mock simulation triggers collaboration events by checking the event stream

---

## Workstream 3: Frontend -- Web (`apps/web`)

This workstream adds the visual communication lines, dynamic agent positions, and collaboration state to the UI. It can proceed in parallel with Workstream 2 after Workstream 1 is complete.

---

### Task 3.1: Create Walking Path Utility

**File:** `apps/web/src/components/office/walking-path.ts` (NEW)

This utility calculates corridor-aware waypoints for agent movement between zones.

- [ ] Create the file:

```typescript
// apps/web/src/components/office/walking-path.ts

export type Waypoint = { x: number; y: number };

/**
 * Corridor dimensions and zone layout constants.
 * These must match office-floor.tsx (CX=586, CW=28, CY=336).
 */
const CX = 586;
const CW = 28;
const CY = 336;

/** Corridor entry points per zone */
const CORRIDOR_ENTRY: Record<string, Waypoint> = {
  'ceo-suite':  { x: 600, y: -8 },
  executive:    { x: CX, y: CY },
  engineering:  { x: CX + CW, y: CY },
  quality:      { x: CX, y: CY + CW },
  ops:          { x: CX + CW, y: CY + CW },
};

/** Corridor intersection center */
const CORRIDOR_CENTER: Waypoint = { x: CX + CW / 2, y: CY + CW / 2 };

/**
 * Given a zone name, return the corridor entry point.
 */
function getCorridorEntry(zone: string): Waypoint {
  return CORRIDOR_ENTRY[zone] ?? CORRIDOR_CENTER;
}

/**
 * Check if two zones are the same.
 */
function sameZone(zoneA: string, zoneB: string): boolean {
  return zoneA === zoneB;
}

/**
 * Check if two zones share a corridor edge (adjacent).
 * Adjacent pairs: executive/engineering (horizontal), quality/ops (horizontal),
 * executive/quality (vertical), engineering/ops (vertical).
 */
function adjacentZones(zoneA: string, zoneB: string): boolean {
  const pairs = new Set([
    'executive|engineering',
    'engineering|executive',
    'quality|ops',
    'ops|quality',
    'executive|quality',
    'quality|executive',
    'engineering|ops',
    'ops|engineering',
  ]);
  return pairs.has(`${zoneA}|${zoneB}`);
}

/**
 * Calculate a corridor-aware walking path between two points.
 *
 * Rules:
 * 1. Same zone: direct line (2 waypoints)
 * 2. Adjacent zones: go through the shared corridor edge (3 waypoints)
 * 3. Diagonal zones: route through corridor intersection (4 waypoints)
 * 4. CEO suite: route through top of vertical corridor
 */
export function calculateWalkingPath(
  from: Waypoint,
  fromZone: string,
  to: Waypoint,
  toZone: string,
): Waypoint[] {
  // Same zone — direct path
  if (sameZone(fromZone, toZone)) {
    return [from, to];
  }

  // CEO suite to/from any zone — route through top of vertical corridor
  if (fromZone === 'ceo-suite' || toZone === 'ceo-suite') {
    const ceaEntry = CORRIDOR_ENTRY['ceo-suite'];
    const otherZone = fromZone === 'ceo-suite' ? toZone : fromZone;
    const otherEntry = getCorridorEntry(otherZone);

    if (fromZone === 'ceo-suite') {
      return [from, ceaEntry, otherEntry, to];
    } else {
      return [from, otherEntry, ceaEntry, to];
    }
  }

  // Adjacent zones — route through shared corridor edge
  if (adjacentZones(fromZone, toZone)) {
    const entryA = getCorridorEntry(fromZone);
    const entryB = getCorridorEntry(toZone);
    return [from, entryA, entryB, to];
  }

  // Diagonal zones — route through corridor intersection
  const entryA = getCorridorEntry(fromZone);
  const entryB = getCorridorEntry(toZone);
  return [from, entryA, CORRIDOR_CENTER, entryB, to];
}

/**
 * Calculate the total distance of a walking path.
 * Used to determine animation duration.
 */
export function pathDistance(waypoints: Waypoint[]): number {
  let dist = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    dist += Math.sqrt(dx * dx + dy * dy);
  }
  return dist;
}

/**
 * Calculate animation duration for a given path at ~120px/s.
 */
export function walkDuration(waypoints: Waypoint[]): number {
  const SPEED = 120; // px per second
  const MIN_DURATION = 400;
  const MAX_DURATION = 4000;
  const dist = pathDistance(waypoints);
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, (dist / SPEED) * 1000));
}
```

- [ ] Verify: `npx tsc --noEmit` passes from `apps/web`

---

### Task 3.2: Extend Agent Store with Collaboration State

**File:** `apps/web/src/store/agent-store.ts` (MODIFY)

This is a significant modification. Add collaboration tracking, dynamic positions, and new event handlers.

- [ ] Add new imports at the top:

```typescript
import type { Collaboration, AgentPosition } from '@rigelhq/shared';
```

- [ ] Add `ActiveCollaboration` interface and color palette after the `ChatMessage` interface:

```typescript
/** Active collaboration for visual rendering */
export interface ActiveCollaboration {
  id: string;
  type: 'parallel' | 'consultation' | 'meeting';
  participants: string[];
  topic: string;
  activeSpeaker: string | null;
  color: string;
  startedAt: number;
  status: 'active' | 'fading';
}

/** Curated color palette for collaboration lines (max 8 unique) */
const COLLAB_COLORS = [
  '#3a90a0', // teal
  '#b07a40', // amber
  '#b84a72', // rose
  '#8a6abf', // violet
  '#5a9a50', // lime
  '#4a7ab0', // blue
  '#a06a30', // copper
  '#6a8a3a', // olive
];
let colorIdx = 0;
function nextCollabColor(): string {
  const c = COLLAB_COLORS[colorIdx % COLLAB_COLORS.length];
  colorIdx++;
  return c;
}
```

- [ ] Add new fields to the `AgentStore` interface:

```typescript
interface AgentStore {
  agents: Map<string, AgentState>;
  messages: ChatMessage[];
  events: AgentEvent[];
  connected: boolean;

  // --- NEW ---
  collaborations: Map<string, ActiveCollaboration>;
  agentHomePositions: Map<string, { x: number; y: number }>;

  // Actions
  initAgents: () => void;
  handleEvent: (event: AgentEvent) => void;
  setConnected: (connected: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  addEvent: (event: AgentEvent) => void;
  updateAgentStatus: (configId: string, status: AgentStatus) => void;

  // --- NEW actions ---
  handleCollaborationEvent: (event: AgentEvent) => void;
  handleMovementEvent: (event: AgentEvent) => void;
  loadCollaborationSnapshot: (collabs: Collaboration[]) => void;
}
```

- [ ] Modify `initAgents` to also store home positions:

Inside the `initAgents` `set()` callback, after setting `state.agents`, add:

```typescript
        // Store home positions for return-to-desk
        state.agentHomePositions.set(role.id, {
          x: base.baseX + col * 180,
          y: base.baseY + row * 120,
        });
```

- [ ] Extend `handleEvent` to route collaboration and movement events:

At the top of the `handleEvent` set callback, before `const agent = state.agents.get(event.agentId)`, add:

```typescript
        // Route collaboration and movement events to specialized handlers
        if (event.stream === 'collaboration') {
          // We call the handler logic inline here (immer requires mutations inside set())
          const data = event.data;
          if (data.phase === 'start') {
            const collabId = data.collaborationId as string;
            if (!state.collaborations.has(collabId)) {
              state.collaborations.set(collabId, {
                id: collabId,
                type: (data.type as ActiveCollaboration['type']) ?? 'parallel',
                participants: (data.participants as string[]) ?? [],
                topic: (data.topic as string) ?? '',
                activeSpeaker: null,
                color: nextCollabColor(),
                startedAt: Date.now(),
                status: 'active',
              });
            } else {
              // Update participants (a new agent joined)
              const existing = state.collaborations.get(collabId)!;
              existing.participants = (data.participants as string[]) ?? existing.participants;
            }
          } else if (data.phase === 'message') {
            const collabId = data.collaborationId as string;
            const collab = state.collaborations.get(collabId);
            if (collab) {
              collab.activeSpeaker = data.fromAgent as string;
            }
          } else if (data.phase === 'end') {
            const collabId = data.collaborationId as string;
            const collab = state.collaborations.get(collabId);
            if (collab) {
              collab.status = 'fading';
              // Remove after fade animation (600ms)
              setTimeout(() => {
                useAgentStore.setState((s) => {
                  s.collaborations.delete(collabId);
                });
              }, 600);
            }
          }
          return; // Don't process as normal agent event
        }

        if (event.stream === 'movement') {
          const data = event.data;
          const targetAgent = state.agents.get(event.agentId);
          if (targetAgent && data.phase === 'start') {
            targetAgent.position = {
              x: data.toX as number,
              y: data.toY as number,
            };
          }
          return; // Don't process as normal agent event
        }
```

- [ ] Add the new action implementations in the store definition:

```typescript
    handleCollaborationEvent: (event) => {
      // Handled inline in handleEvent above
      // This method exists for direct calls if needed
      const store = useAgentStore.getState();
      store.handleEvent(event);
    },

    handleMovementEvent: (event) => {
      // Handled inline in handleEvent above
      const store = useAgentStore.getState();
      store.handleEvent(event);
    },

    loadCollaborationSnapshot: (collabs) => {
      set((state) => {
        for (const collab of collabs) {
          if (collab.endedAt) continue;
          state.collaborations.set(collab.id, {
            id: collab.id,
            type: collab.type,
            participants: collab.participants,
            topic: collab.topic,
            activeSpeaker: null,
            color: nextCollabColor(),
            startedAt: collab.startedAt,
            status: 'active',
          });
        }
      });
    },
```

- [ ] Initialize new fields in the store's default state:

```typescript
    collaborations: new Map(),
    agentHomePositions: new Map(),
```

- [ ] Verify: `npx tsc --noEmit` passes from `apps/web`

---

### Task 3.3: Update use-socket.ts to Handle New Events and Snapshots

**File:** `apps/web/src/hooks/use-socket.ts` (MODIFY)

- [ ] Add `loadCollaborationSnapshot` to the destructured store actions:

```typescript
  const { handleEvent, setConnected, addMessage, initAgents, updateAgentStatus, loadCollaborationSnapshot } = useAgentStore();
```

- [ ] Add a new socket listener after the `agent:status-snapshot` handler:

```typescript
    // Receive active collaboration snapshot on connect
    socket.on('collaboration:snapshot', (collabs: Collaboration[]) => {
      loadCollaborationSnapshot(collabs);
    });
```

- [ ] Add the import for `Collaboration` type:

```typescript
import type { AgentEvent, AgentStatus, Collaboration } from '@rigelhq/shared';
```

Note: No changes needed for `agent:event` handling. The existing `handleEvent(event)` call will now route collaboration and movement events through the extended store logic added in Task 3.2.

- [ ] Verify: `npx tsc --noEmit` passes from `apps/web`

---

### Task 3.4: Create CommunicationLines Component

**File:** `apps/web/src/components/office/communication-lines.tsx` (NEW)

This is the main visual component -- SVG paths with animated particles between collaborating agents.

- [ ] Create the file:

```typescript
'use client';

import { useRef, useEffect, useMemo } from 'react';
import { animate, stagger } from 'animejs';
import { useAgentStore, type ActiveCollaboration, type AgentState } from '@/store/agent-store';

/**
 * Calculate a quadratic Bezier control point offset perpendicular to the
 * straight line between two agents. This makes the line curve organically.
 */
function bezierPath(
  ax: number, ay: number,
  bx: number, by: number,
  offsetFactor: number = 0.15,
): string {
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const perpX = -dy * offsetFactor;
  const perpY = dx * offsetFactor;
  const cx = midX + perpX;
  const cy = midY + perpY;
  return `M ${ax},${ay} Q ${cx},${cy} ${bx},${by}`;
}

/** Maximum number of visible communication lines */
const MAX_LINES = 8;

/** Number of particles per line */
const PARTICLES_PER_LINE = 3;

interface LineData {
  id: string;
  path: string;
  color: string;
  status: 'active' | 'fading';
  fromAgent: string;
  toAgent: string;
  activeSpeaker: string | null;
}

export function CommunicationLines() {
  const collaborations = useAgentStore((s) => s.collaborations);
  const agents = useAgentStore((s) => s.agents);
  const particleGroupRef = useRef<SVGGElement>(null);

  // Compute line data from collaborations + agent positions
  const lines: LineData[] = useMemo(() => {
    const result: LineData[] = [];
    const collabList = [...collaborations.values()].slice(0, MAX_LINES);

    for (const collab of collabList) {
      // For each pair in the collaboration, draw a line from initiator to each participant
      const initiator = collab.participants[0];
      const others = collab.participants.slice(1);

      for (const other of others) {
        const agentA = agents.get(initiator);
        const agentB = agents.get(other);
        if (!agentA || !agentB) continue;

        // Offset factor varies per line to avoid overlap
        const offsetFactor = 0.12 + result.length * 0.04;

        const path = bezierPath(
          agentA.position.x, agentA.position.y,
          agentB.position.x, agentB.position.y,
          offsetFactor,
        );

        result.push({
          id: `${collab.id}-${initiator}-${other}`,
          path,
          color: collab.color,
          status: collab.status,
          fromAgent: initiator,
          toAgent: other,
          activeSpeaker: collab.activeSpeaker,
        });
      }
    }

    return result;
  }, [collaborations, agents]);

  // Animate particles along active lines
  useEffect(() => {
    if (!particleGroupRef.current || lines.length === 0) return;

    const particles = particleGroupRef.current.querySelectorAll('.collab-particle');
    if (particles.length === 0) return;

    const anim = animate(particles, {
      strokeDashoffset: [0, -20],
      ease: 'linear',
      duration: 1500,
      loop: true,
      delay: stagger(300),
    });

    return () => { anim.pause(); };
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <g className="communication-lines" style={{ willChange: 'transform' }}>
      {/* Line paths */}
      {lines.map((line) => (
        <g key={line.id}>
          {/* Base path (glow) */}
          <path
            d={line.path}
            fill="none"
            stroke={line.color}
            strokeWidth={line.status === 'fading' ? 1 : 3}
            strokeLinecap="round"
            opacity={line.status === 'fading' ? 0.1 : 0.15}
            filter="url(#zone-glow)"
          />

          {/* Main visible path */}
          <path
            d={line.path}
            fill="none"
            stroke={line.color}
            strokeWidth={line.activeSpeaker ? 2.5 : 1.5}
            strokeLinecap="round"
            strokeDasharray={line.status === 'fading' ? '4 4' : line.activeSpeaker ? undefined : '6 4'}
            opacity={line.status === 'fading' ? 0.15 : 0.55}
            style={{
              transition: 'opacity 600ms ease-out, stroke-width 300ms ease',
            }}
          />

          {/* Animated particles (small circles at intervals along the path) */}
          {line.status === 'active' && line.activeSpeaker && (
            <g ref={particleGroupRef}>
              {Array.from({ length: PARTICLES_PER_LINE }).map((_, i) => (
                <circle
                  key={`${line.id}-p${i}`}
                  className="collab-particle"
                  r={2.5}
                  fill={line.color}
                  opacity={0.7 - i * 0.15}
                >
                  {/* Use SMIL animation as a fallback for path following */}
                  <animateMotion
                    dur={`${1.5 + i * 0.3}s`}
                    repeatCount="indefinite"
                    begin={`${i * 0.3}s`}
                    path={line.path}
                  />
                </circle>
              ))}
            </g>
          )}
        </g>
      ))}
    </g>
  );
}
```

- [ ] Verify: `npx tsc --noEmit` passes from `apps/web`

---

### Task 3.5: Update office-floor.tsx to Add Communication Lines Layer

**File:** `apps/web/src/components/office/office-floor.tsx` (MODIFY)

- [ ] Add the import at the top:

```typescript
import { CommunicationLines } from './communication-lines';
```

- [ ] Add the `<CommunicationLines />` component between the Decorations layer (Layer 7) and the Agent Avatars layer (Layer 8). Find the comment `{/* --- Layer 8: Agent avatars (topmost) --- */}` and add the new layer BEFORE it:

```tsx
      {/* --- Layer 7.5: Communication Lines --- */}
      <CommunicationLines />

      {/* --- Layer 8: Agent avatars (topmost) --- */}
```

The exact insertion point is between the last `<WaterCooler>` component and the `agentList.map` that renders `<AgentAvatar>` components.

- [ ] Verify: The communication lines layer renders below avatars but above furniture.
- [ ] Verify: `npx tsc --noEmit` passes from `apps/web`

---

### Task 3.6: Update agent-avatar.tsx to Use Dynamic Positions from Store

**File:** `apps/web/src/components/office/agent-avatar.tsx` (MODIFY)

The agent-avatar already animates to `agent.position.x/y` via anime.js springs. Since we now update `agent.position` in the store when movement events arrive (Task 3.2), the avatar will automatically animate to the new position. No changes needed for basic movement.

However, we should add a visual indicator for the COLLABORATING status.

- [ ] Verify that the existing `useEffect` for position animation (lines 171-180) already reads `targetX` and `targetY` from `agent.position`. It does -- the spring animation will handle the movement automatically when the store position changes.

- [ ] (Optional enhancement) Add a collaborating ring effect. In the `STATUS_COLORS` map, the `COLLABORATING` color is already defined as `'#3a90a0'`. The `isWorking` check on line 146 already includes `'COLLABORATING'`. So the existing pulse glow and bobbing animations already activate when an agent is collaborating. No changes needed.

- [ ] Verify: `npx tsc --noEmit` passes from `apps/web`

---

### Task 3.7: Test the Full Visual Flow

- [ ] Start both the orchestrator (`npm run dev` in `apps/orchestrator`) and the web app (`npm run dev` in `apps/web`)
- [ ] Send a chat message that triggers CEA to delegate to multiple agents (e.g., "Build a login page with backend and frontend")
- [ ] Verify visually:
  - [ ] Communication lines appear between CEA and the active specialists
  - [ ] Lines use distinct colors from the palette
  - [ ] Agents walk from their desks toward each other (position updates animate via springs)
  - [ ] When agents complete, lines fade out over 600ms
  - [ ] Agents walk back to their home desk positions
  - [ ] Particles animate along active lines when an agent is speaking
- [ ] Verify performance:
  - [ ] Open Chrome DevTools Performance panel
  - [ ] Record during 3+ active collaborations
  - [ ] Confirm sustained 60fps with no visible jank

---

## Cross-Workstream Verification Checklist

After all three workstreams are complete, verify the following end-to-end:

- [ ] **TypeScript:** Run `npx tsc --noEmit` in all three packages (shared, orchestrator, web) with zero errors
- [ ] **Event flow:** Collaboration events flow from CollaborationManager -> EventBus -> Redis -> WebSocket -> Frontend store -> SVG rendering
- [ ] **Reconnect:** Refresh the browser mid-collaboration. Verify that the `collaboration:snapshot` event restores active lines immediately without animation replay
- [ ] **Multiple simultaneous conversations:** Trigger 3+ parallel delegations. Verify each gets a distinct line color and agents do not overlap at meeting points
- [ ] **CEA stays put:** Verify the CEA avatar never leaves its suite (movement events skip `agentId === 'cea'`)
- [ ] **Return to desk:** Verify every agent returns to its exact home position after collaboration ends
- [ ] **Mock adapter:** With `RIGELHQ_ADAPTER=mock`, verify the mock simulation triggers visible collaborations

---

## File Summary

### New Files (4)

| File | Workstream | Purpose |
|------|------------|---------|
| `packages/shared/src/types/collaboration.ts` | 1 | Shared types: Collaboration, CollaborationMessage, AgentPosition |
| `apps/orchestrator/src/services/collaboration-manager.ts` | 2 | Core collaboration tracking, event detection, movement coordination |
| `apps/web/src/components/office/communication-lines.tsx` | 3 | SVG layer rendering animated Bezier paths between collaborating agents |
| `apps/web/src/components/office/walking-path.ts` | 3 | Corridor-aware waypoint calculation utility |

### Modified Files (8)

| File | Workstream | Changes |
|------|------------|---------|
| `packages/shared/src/types/events.ts` | 1 | Add `'collaboration'` and `'movement'` to EventStream |
| `packages/shared/src/constants/redis-channels.ts` | 1 | Add COLLABORATIONS channel and stream |
| `packages/shared/src/types/index.ts` | 1 | Export collaboration types |
| `apps/orchestrator/src/services/agent-manager.ts` | 2 | Add collaborationManager field and hook in handleEvent |
| `apps/orchestrator/src/services/websocket-server.ts` | 2 | Add collaboration snapshot on client connect |
| `apps/orchestrator/src/index.ts` | 2 | Instantiate and wire CollaborationManager |
| `apps/web/src/store/agent-store.ts` | 3 | Add collaborations map, movement handling, snapshot loading |
| `apps/web/src/hooks/use-socket.ts` | 3 | Handle collaboration:snapshot event |
| `apps/web/src/components/office/office-floor.tsx` | 3 | Insert CommunicationLines layer between Layer 7 and Layer 8 |

### Unchanged Files (confirmed no modifications needed)

| File | Reason |
|------|--------|
| `apps/web/src/components/office/agent-avatar.tsx` | Existing spring animation already handles position changes; COLLABORATING status already supported |
| `apps/orchestrator/src/services/cea-manager.ts` | No changes needed for P0; CEA system prompt changes deferred to P1 |
| `apps/orchestrator/src/services/event-bus.ts` | Generic enough to handle new event streams without modification |
| `packages/shared/src/types/agent.ts` | COLLABORATING status already exists in AgentStatus union |
| `packages/shared/src/constants/agent-roles.ts` | No changes needed |
