import { randomUUID } from 'crypto';
import type { AgentEvent } from '@rigelhq/shared';
import { AGENT_ROLES, AGENT_ROLE_MAP } from '@rigelhq/shared';
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

  /** Pending return-to-desk timers so we can cancel on shutdown */
  private returnTimers = new Set<ReturnType<typeof setTimeout>>();

  /** Pending cleanup timers */
  private cleanupTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private eventBus: EventBus) {
    this.initAgentHomes();
  }

  /**
   * Pre-compute agent home (desk) positions from AGENT_ROLES.
   * Uses the same grid-layout algorithm as the frontend agent-store.ts initAgents().
   */
  private initAgentHomes(): void {
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
      id: randomUUID(),
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
      const timer = setTimeout(async () => {
        this.returnTimers.delete(timer);
        try {
          await this.emitReturnToDesk(subagentId);
        } catch (err) {
          console.warn(`[CollabMgr] Failed to emit return-to-desk for ${subagentId}:`, err);
        }
      }, RETURN_DELAY_MS);
      this.returnTimers.add(timer);

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
        id: randomUUID(),
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

  // -- Event Emission Helpers --

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

  // -- Query Helpers --

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
      const timer = setTimeout(async () => {
        this.returnTimers.delete(timer);
        try {
          await this.emitReturnToDesk(participantId);
        } catch (err) {
          console.warn(`[CollabMgr] Failed to emit return-to-desk for ${participantId}:`, err);
        }
      }, RETURN_DELAY_MS);
      this.returnTimers.add(timer);
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
    const cleanupTimer = setTimeout(() => {
      this.cleanupTimers.delete(cleanupTimer);
      this.collaborations.delete(collabId);
    }, 10_000);
    this.cleanupTimers.add(cleanupTimer);
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

  // ── Public API for async delegation / consultation ──────────

  /**
   * Called by AgentManager when CEA delegates to a specialist via [DELEGATE:]
   * or when a specialist consults another via [CONSULT:].
   * Creates the visual collaboration (line + movement) between the two agents.
   */
  async onDelegation(delegatorId: string, specialistId: string, task: string): Promise<void> {
    // Check for existing collaboration between these two
    const existing = this.findCollaborationBetween(delegatorId, specialistId);
    if (existing) {
      existing.topic = task.slice(0, 80);
      return;
    }

    const collab: Collaboration = {
      id: randomUUID(),
      type: 'consultation',
      initiator: delegatorId,
      participants: [delegatorId, specialistId],
      topic: task.slice(0, 80) || `${delegatorId} → ${specialistId}`,
      startedAt: Date.now(),
      endedAt: null,
      parentRunId: 'delegation',
      messages: [],
    };

    if (this.collaborations.size >= MAX_COLLABORATIONS) {
      const oldest = [...this.collaborations.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
      if (oldest) await this.endCollaboration(oldest.id);
    }

    this.collaborations.set(collab.id, collab);
    this.trackAgentCollaboration(delegatorId, collab.id);
    this.trackAgentCollaboration(specialistId, collab.id);

    await this.emitCollaborationStart(collab, specialistId);
    await this.emitMovementToMeetingPoint(collab);

    console.log(`[CollabMgr] Delegation collaboration: ${delegatorId} → ${specialistId}: ${task.slice(0, 60)}`);
  }

  /**
   * Called by AgentManager when a delegated/consulted specialist completes.
   * Ends the visual collaboration and returns agents to their desks.
   */
  async onSpecialistComplete(specialistId: string): Promise<void> {
    await this.onSubagentEnd(specialistId);
  }

  /** Get active collaborations (for snapshot on client connect) */
  getActiveCollaborations(): Collaboration[] {
    return [...this.collaborations.values()].filter(c => !c.endedAt);
  }

  /** Clean up on shutdown */
  async shutdown(): Promise<void> {
    // Clear all pending timers
    for (const timer of this.returnTimers) {
      clearTimeout(timer);
    }
    this.returnTimers.clear();

    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();

    // End active collaborations
    for (const collabId of [...this.collaborations.keys()]) {
      const collab = this.collaborations.get(collabId);
      if (collab && !collab.endedAt) {
        collab.endedAt = Date.now();
        // Best effort emit on shutdown — don't await to avoid blocking
        this.emitCollaborationEnd(collab).catch(() => {});
      }
    }

    this.collaborations.clear();
    this.agentCollaborations.clear();
    this.runSubagents.clear();
  }
}
