import type { PrismaClient } from '@prisma/client';
import type { AgentEvent, AgentStatus } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, SpawnOptions, SessionInfo } from '../adapters/adapter.js';
import type { EventBus } from './event-bus.js';
import type { CollaborationManager } from './collaboration-manager.js';
import { agentConfigLoader } from './agent-config-loader.js';

interface ActiveAgent {
  handle: AgentHandle;
  configId: string;
  status: AgentStatus;
  lastActivity: number;
  /** The runId of the current query — used to discard stale events from prior runs */
  currentRunId: string | null;
}

/** Tracks a specialist spawned by CEA's [DELEGATE:] marker */
interface PendingDelegation {
  delegatedBy: string;
  task: string;
  output: string[];
}

/** Tracks a specialist spawned by another agent's [CONSULT:] marker */
interface PendingConsultation {
  requestedBy: string;
  question: string;
  output: string[];
}

export class AgentManager {
  private active = new Map<string, ActiveAgent>();
  private queue: Array<{
    configId: string;
    systemPrompt: string;
    taskPrompt: string;
    options?: SpawnOptions;
    resolve: (handle: AgentHandle) => void;
    reject: (err: Error) => void;
  }> = [];
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Agents currently being steered — suppress completion side-effects */
  private steering = new Set<string>();
  /** Track subagent IDs spawned by each parent agent, so we can clean them up on parent completion */
  private parentSubagents = new Map<string, Set<string>>();
  /** Subagents that have completed (lifecycle:end received) — guards against late events reverting IDLE */
  private completedSubagents = new Set<string>();
  /** Optional collaboration manager for detecting inter-agent collaboration */
  private collaborationManager: CollaborationManager | null = null;
  /** Track delegations: specialist configId → who delegated and accumulated output */
  private pendingDelegations = new Map<string, PendingDelegation>();
  /** Track consultations: consulted agent configId → who requested and accumulated output */
  private pendingConsultations = new Map<string, PendingConsultation>();

  constructor(
    readonly adapter: GatewayAdapter,
    private eventBus: EventBus,
    private db: PrismaClient,
    private maxConcurrent: number = 5,
    private idleTimeoutMs: number = 5 * 60 * 1000,
  ) {}

  /** Attach a CollaborationManager to observe all agent events */
  setCollaborationManager(cm: CollaborationManager): void {
    this.collaborationManager = cm;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  getActiveAgents(): ActiveAgent[] {
    return [...this.active.values()];
  }

  async spawnAgent(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    options?: SpawnOptions,
  ): Promise<AgentHandle> {
    // Check if already active
    if (this.active.has(configId)) {
      return this.active.get(configId)!.handle;
    }

    // Check pool capacity
    if (this.active.size >= this.maxConcurrent) {
      return new Promise((resolve, reject) => {
        this.queue.push({ configId, systemPrompt, taskPrompt, options, resolve, reject });
      });
    }

    return this.doSpawn(configId, systemPrompt, taskPrompt, options);
  }

  private async doSpawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    options?: SpawnOptions,
  ): Promise<AgentHandle> {
    // We need the handle reference to guard against stale events from prior runs.
    // The onEvent callback below will discard events if the handle has been replaced
    // by a newer spawn for the same configId.
    let handleRef: AgentHandle | null = null;

    const onEvent = async (event: AgentEvent) => {
      // Guard: discard events from a prior run whose handle has been replaced.
      // This prevents a race where the old query's lifecycle:end fires after a
      // new spawn has registered a new handle, which would incorrectly set the
      // new agent to IDLE while it is still processing.
      const current = this.active.get(configId);
      if (current && handleRef && current.handle !== handleRef) {
        console.log(`[AgentMgr] Discarding stale event for ${configId} (old handle, stream: ${event.stream}, phase: ${event.data.phase ?? 'n/a'})`);
        return;
      }
      await this.handleEvent(configId, event);
    };

    const handle = await this.adapter.spawn(configId, systemPrompt, taskPrompt, onEvent, options);
    handleRef = handle;

    const activeAgent: ActiveAgent = {
      handle,
      configId,
      status: 'THINKING',
      lastActivity: Date.now(),
      currentRunId: null,
    };

    this.active.set(configId, activeAgent);

    // Resolve agent metadata from roles registry
    const roleMeta = AGENT_ROLE_MAP.get(configId);
    const agentName = roleMeta?.name ?? configId;
    const agentRole = roleMeta?.role ?? configId;
    const agentIcon = roleMeta?.icon ?? '🤖';

    // Update DB
    await this.db.agent.upsert({
      where: { configId },
      update: { status: 'THINKING', startedAt: new Date(), pid: handle.pid },
      create: {
        configId,
        name: agentName,
        role: agentRole,
        icon: agentIcon,
        status: 'THINKING',
        startedAt: new Date(),
        pid: handle.pid,
      },
    });

    await this.eventBus.publishStatus(configId, 'THINKING');

    return handle;
  }

  /** Send a follow-up message to an existing agent session.
   *  If the agent is currently busy, interrupts the current work
   *  and steers it with the new message (same session). */
  async sendMessage(configId: string, message: string): Promise<void> {
    const agent = this.active.get(configId);
    if (!agent || !agent.handle.sessionId) {
      throw new Error(`No active session for ${configId}`);
    }

    // Mark as steering so the interrupt's lifecycle:end doesn't trigger completion
    this.steering.add(configId);

    const onEvent = async (event: AgentEvent) => {
      await this.handleEvent(configId, event);
    };

    agent.status = 'THINKING';
    agent.lastActivity = Date.now();
    await this.db.agent.update({
      where: { configId },
      data: { status: 'THINKING' },
    });
    await this.eventBus.publishStatus(configId, 'THINKING');

    // adapter.sendMessage now internally interrupts any in-progress query first
    this.steering.delete(configId);
    await this.adapter.sendMessage(agent.handle, message, onEvent);
  }

  /** List all Claude sessions on this machine (managed + external) */
  async listAllSessions(): Promise<{ managed: Array<{ configId: string; sessionId: string; status: AgentStatus }>; external: SessionInfo[] }> {
    // Managed sessions from our active agents
    const managed: Array<{ configId: string; sessionId: string; status: AgentStatus }> = [];
    for (const [configId, agent] of this.active) {
      if (agent.handle.sessionId) {
        managed.push({ configId, sessionId: agent.handle.sessionId, status: agent.status });
      }
    }

    // All sessions on this machine via SDK
    const allSessions = await this.adapter.listSessions();

    // Filter out our managed sessions to get external ones
    const managedIds = new Set(managed.map(m => m.sessionId));
    const external = allSessions.filter(s => !managedIds.has(s.sessionId));

    return { managed, external };
  }

  /** Send a message to any Claude session by ID (managed or external) */
  async sendToSession(sessionId: string, message: string): Promise<void> {
    const onEvent = async (event: AgentEvent) => {
      await this.eventBus.publish(event);
    };
    await this.adapter.sendToSession(sessionId, message, onEvent);
  }

  /** Check if an agent has an active session that can be resumed */
  hasActiveSession(configId: string): boolean {
    const agent = this.active.get(configId);
    return Boolean(agent?.handle.sessionId);
  }

  /** Re-register an agent that was removed from the active map but still has a valid session */
  ensureActive(configId: string, handle: AgentHandle): void {
    if (this.active.has(configId)) return;
    if (!handle.sessionId) return;
    console.log(`[AgentMgr] Re-registering ${configId} with session ${handle.sessionId.slice(0, 8)}...`);
    this.active.set(configId, {
      handle,
      configId,
      status: 'IDLE',
      lastActivity: Date.now(),
      currentRunId: null,
    });
  }

  /** Get the handle for an active agent */
  getHandle(configId: string): AgentHandle | null {
    return this.active.get(configId)?.handle ?? null;
  }

  private async handleEvent(configId: string, event: AgentEvent): Promise<void> {
    const agent = this.active.get(configId);
    if (!agent) return;

    agent.lastActivity = Date.now();

    // Check if this event is from a subagent (specialist) rather than the parent
    const isSubagentEvent = event.agentId !== configId;

    if (isSubagentEvent) {
      // Upsert the specialist agent in DB so the UI can show it
      const specialistId = event.agentId;

      // Track this subagent under its parent so we can clean up on parent completion
      if (!this.parentSubagents.has(configId)) {
        this.parentSubagents.set(configId, new Set());
      }
      this.parentSubagents.get(configId)!.add(specialistId);

      // If this subagent's lifecycle already ended, only allow lifecycle:end events through
      // (guards against late assistant/tool events reverting IDLE back to SPEAKING)
      if (this.completedSubagents.has(specialistId)) {
        if (event.stream !== 'lifecycle' || event.data.phase !== 'end') {
          console.log(`[AgentMgr] Discarding late event for completed subagent ${specialistId} (stream: ${event.stream})`);
          // Still publish the raw event for logging, but don't update status
          await this.eventBus.publish(event);
          return;
        }
      }

      const specialistStatus = this.mapEventToStatus(event);
      if (specialistStatus) {
        // Mark subagent as completed when lifecycle ends — prevents late events from reverting status
        if (event.stream === 'lifecycle' && event.data.phase === 'end') {
          this.completedSubagents.add(specialistId);
          console.log(`[AgentMgr] Subagent ${specialistId} lifecycle ended — marking IDLE`);
        } else if (event.stream === 'lifecycle' && event.data.phase === 'start') {
          // New lifecycle start — subagent is being re-used, clear the completed guard
          this.completedSubagents.delete(specialistId);
        }

        const roleMeta = AGENT_ROLE_MAP.get(specialistId);
        const name = roleMeta?.name ?? specialistId;
        const role = roleMeta?.role ?? 'Specialist';
        const icon = roleMeta?.icon ?? '🤖';
        await this.db.agent.upsert({
          where: { configId: specialistId },
          update: { status: specialistStatus, startedAt: new Date() },
          create: {
            configId: specialistId,
            name,
            role,
            icon,
            status: specialistStatus,
            startedAt: new Date(),
            pid: null,
          },
        });
        await this.eventBus.publishStatus(specialistId, specialistStatus);
      }
    } else {
      // Map event to status for the parent agent
      const newStatus = this.mapEventToStatus(event);
      if (newStatus && newStatus !== agent.status) {
        agent.status = newStatus;
        await this.db.agent.update({
          where: { configId },
          data: { status: newStatus },
        });
        await this.eventBus.publishStatus(configId, newStatus);
      }
    }

    // Publish event
    await this.eventBus.publish(event);

    // Notify CollaborationManager so it can detect collaboration patterns
    if (this.collaborationManager) {
      try {
        await this.collaborationManager.onAgentEvent(event, configId);
      } catch (err) {
        console.warn(`[AgentMgr] CollaborationManager error for ${configId}:`, err);
      }
    }

    // --- Async delegation: detect [DELEGATE:] markers in CEA's assistant text ---
    if (configId === 'cea' && !isSubagentEvent && event.stream === 'assistant' && event.data.text) {
      try {
        await this.parseDelegationMarkers(event.data.text as string);
      } catch (err) {
        console.error(`[AgentMgr] Delegation parsing error:`, err);
      }
    }

    // --- Consultation: detect [CONSULT:] markers in any specialist's assistant text ---
    if (configId !== 'cea' && !isSubagentEvent && event.stream === 'assistant' && event.data.text) {
      try {
        await this.parseConsultationMarkers(configId, event.data.text as string);
      } catch (err) {
        console.error(`[AgentMgr] Consultation parsing error for ${configId}:`, err);
      }
    }

    // --- Accumulate output for delegated/consulted specialists ---
    if (!isSubagentEvent && event.stream === 'assistant' && event.data.text) {
      const delegation = this.pendingDelegations.get(configId);
      if (delegation) {
        delegation.output.push(event.data.text as string);
      }
      const consultation = this.pendingConsultations.get(configId);
      if (consultation) {
        consultation.output.push(event.data.text as string);
      }
    }

    // Handle lifecycle end — mark IDLE but keep session alive
    // Skip during steering (interrupt + immediate re-send)
    // Only trigger for the parent agent's lifecycle end, not subagent lifecycle ends
    if (!isSubagentEvent && event.stream === 'lifecycle' && event.data.phase === 'end' && !this.steering.has(configId)) {
      await this.onAgentComplete(configId);
    }

    // Reset idle timer
    this.resetIdleTimer(configId);
  }

  private mapEventToStatus(event: AgentEvent): AgentStatus | null {
    switch (event.stream) {
      case 'lifecycle':
        if (event.data.phase === 'start' || event.data.phase === 'thinking') return 'THINKING';
        if (event.data.phase === 'end') return 'IDLE';
        return null;
      case 'tool':
        return event.data.phase === 'start' ? 'TOOL_CALLING' : 'THINKING';
      case 'assistant':
        return 'SPEAKING';
      case 'error':
        return 'ERROR';
      default:
        return null;
    }
  }

  private async onAgentComplete(configId: string): Promise<void> {
    const agent = this.active.get(configId);

    // --- Delegation result callback: send specialist output back to the delegating agent ---
    const delegation = this.pendingDelegations.get(configId);
    if (delegation) {
      this.pendingDelegations.delete(configId);
      const output = delegation.output.join('\n').slice(0, 10000);
      const resultMsg = `[SPECIALIST RESULT: ${configId}]\nTask: ${delegation.task}\n\nResult:\n${output || '(no output produced)'}`;

      // Notify CollaborationManager that delegation ended
      if (this.collaborationManager) {
        try {
          await this.collaborationManager.onSpecialistComplete(configId);
        } catch (err) {
          console.warn(`[AgentMgr] CollabMgr onSpecialistComplete error:`, err);
        }
      }

      // Send result back to delegator (fire-and-forget to avoid blocking)
      console.log(`[AgentMgr] Delegation complete: ${configId} → ${delegation.delegatedBy} (${output.length} chars)`);
      this.sendMessage(delegation.delegatedBy, resultMsg).catch(err =>
        console.error(`[AgentMgr] Failed to send delegation result to ${delegation.delegatedBy}:`, err),
      );
    }

    // --- Consultation result callback: send answer back to the requesting agent ---
    const consultation = this.pendingConsultations.get(configId);
    if (consultation) {
      this.pendingConsultations.delete(configId);
      const output = consultation.output.join('\n').slice(0, 5000);
      const consultResult = `[CONSULTATION RESULT from ${configId}]\nQuestion: ${consultation.question}\n\nAnswer:\n${output || '(no answer produced)'}`;

      if (this.collaborationManager) {
        try {
          await this.collaborationManager.onSpecialistComplete(configId);
        } catch (err) {
          console.warn(`[AgentMgr] CollabMgr onSpecialistComplete error:`, err);
        }
      }

      console.log(`[AgentMgr] Consultation complete: ${configId} → ${consultation.requestedBy} (${output.length} chars)`);
      this.sendMessage(consultation.requestedBy, consultResult).catch(err =>
        console.error(`[AgentMgr] Failed to send consultation result to ${consultation.requestedBy}:`, err),
      );
    }

    // Transition all tracked subagents to IDLE as a safety net.
    // If a subagent already received its own lifecycle:end, this is a harmless no-op
    // (the DB already has IDLE). But if the subagent's lifecycle:end was lost or
    // never emitted, this ensures they don't stay stuck in SPEAKING/THINKING.
    await this.transitionSubagentsToIdle(configId);

    // Keep agent in active map if it has a session (can be resumed)
    if (agent?.handle.sessionId) {
      console.log(`[AgentMgr] ${configId} completed — keeping IDLE (session: ${agent.handle.sessionId.slice(0, 8)}...)`);
      agent.status = 'IDLE';
      await this.db.agent.update({
        where: { configId },
        data: { status: 'IDLE' },
      });
    } else {
      // No session — clean up fully
      console.log(`[AgentMgr] ${configId} completed — removing (no sessionId captured)`);
      this.clearIdleTimer(configId);
      this.active.delete(configId);
      await this.db.agent.update({
        where: { configId },
        data: { status: 'IDLE', pid: null },
      });
    }

    // Process queue
    await this.processQueue();
  }

  /** Transition all subagents of a parent to IDLE and clean up tracking state */
  private async transitionSubagentsToIdle(parentConfigId: string): Promise<void> {
    const subagentIds = this.parentSubagents.get(parentConfigId);
    if (!subagentIds || subagentIds.size === 0) return;

    console.log(`[AgentMgr] Parent ${parentConfigId} completed — transitioning ${subagentIds.size} subagent(s) to IDLE`);

    for (const subagentId of subagentIds) {
      try {
        await this.db.agent.update({
          where: { configId: subagentId },
          data: { status: 'IDLE' },
        });
        await this.eventBus.publishStatus(subagentId, 'IDLE');
        this.completedSubagents.add(subagentId);
      } catch (err) {
        // Best effort — subagent may not exist in DB if it was never upserted
        console.warn(`[AgentMgr] Failed to transition subagent ${subagentId} to IDLE:`, err);
      }
    }

    // Clean up the tracking set for this parent
    this.parentSubagents.delete(parentConfigId);
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0 || this.active.size >= this.maxConcurrent) return;

    const next = this.queue.shift()!;
    try {
      const handle = await this.doSpawn(next.configId, next.systemPrompt, next.taskPrompt, next.options);
      next.resolve(handle);
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private resetIdleTimer(configId: string): void {
    this.clearIdleTimer(configId);
    this.idleTimers.set(configId, setTimeout(() => {
      this.hibernateAgent(configId).catch(console.error);
    }, this.idleTimeoutMs));
  }

  /** Hibernate an idle agent: stop its process to free resources but preserve
   *  the session ID so the session can be resumed later via sendMessage(). */
  private async hibernateAgent(configId: string): Promise<void> {
    const agent = this.active.get(configId);
    if (!agent) return;

    const sessionId = agent.handle.sessionId;
    if (!sessionId) {
      // No session to preserve — full stop
      await this.stopAgent(configId);
      return;
    }

    console.log(`[AgentMgr] Hibernating ${configId} — preserving session ${sessionId.slice(0, 8)}... for resumption`);

    this.clearIdleTimer(configId);

    // Transition subagents to IDLE as a safety net
    await this.transitionSubagentsToIdle(configId);

    // Stop the underlying process but keep the entry in the active map
    // so hasActiveSession() still returns true and sendMessage() can resume.
    await this.adapter.stop(agent.handle);

    agent.status = 'IDLE';
    await this.db.agent.update({
      where: { configId },
      data: { status: 'IDLE', pid: null },
    });
    await this.eventBus.publishStatus(configId, 'IDLE');
  }

  private clearIdleTimer(configId: string): void {
    const timer = this.idleTimers.get(configId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(configId);
    }
  }

  async stopAgent(configId: string): Promise<void> {
    const agent = this.active.get(configId);
    if (!agent) return;

    this.clearIdleTimer(configId);

    // Transition all tracked subagents to IDLE before stopping the parent.
    // This ensures subagents don't stay stuck in SPEAKING/THINKING when the
    // parent is stopped (e.g., CEAManager spawning a fresh session).
    await this.transitionSubagentsToIdle(configId);

    // Remove from active map BEFORE stopping the adapter so that any stale
    // lifecycle:end events from the dying query find no active entry and are
    // safely ignored by handleEvent's null-agent guard.
    this.active.delete(configId);

    await this.adapter.stop(agent.handle);

    await this.db.agent.update({
      where: { configId },
      data: { status: 'OFFLINE', pid: null },
    });

    await this.eventBus.publishStatus(configId, 'OFFLINE');
    await this.processQueue();
  }

  // ── Async delegation: CEA → specialist spawning ──────────────

  /** Parse [DELEGATE:agent-id] markers from CEA's text and spawn specialists */
  private async parseDelegationMarkers(text: string): Promise<void> {
    const delegateRegex = /\[DELEGATE:([a-z0-9-]+)\]\s*(.*)/gi;
    let match: RegExpExecArray | null;

    while ((match = delegateRegex.exec(text)) !== null) {
      const targetAgentId = match[1];
      const task = match[2]?.trim() ?? '';

      if (!AGENT_ROLE_MAP.has(targetAgentId)) {
        console.warn(`[AgentMgr] Unknown delegation target: ${targetAgentId}`);
        continue;
      }
      if (targetAgentId === 'cea') {
        console.warn(`[AgentMgr] CEA cannot delegate to itself`);
        continue;
      }

      console.log(`[AgentMgr] CEA delegating to ${targetAgentId}: ${task.slice(0, 80)}`);
      await this.handleDelegation(targetAgentId, task);
    }
  }

  /** Spawn or message a specialist for a delegated task */
  private async handleDelegation(targetAgentId: string, task: string): Promise<void> {
    try {
      // Track this delegation
      this.pendingDelegations.set(targetAgentId, {
        delegatedBy: 'cea',
        task,
        output: [],
      });

      // Notify CollaborationManager for visual effects (lines, movement)
      if (this.collaborationManager) {
        await this.collaborationManager.onDelegation('cea', targetAgentId, task);
      }

      // Spawn or resume the specialist
      if (this.hasActiveSession(targetAgentId)) {
        await this.sendMessage(targetAgentId, task);
      } else {
        const systemPrompt = agentConfigLoader.generateSystemPrompt(targetAgentId);
        const tools = agentConfigLoader.getAllowedTools(targetAgentId).filter(t => t !== 'Agent');
        await this.spawnAgent(targetAgentId, systemPrompt, task, {
          allowedTools: tools,
          settingSources: ['user', 'project'],
        });
      }
    } catch (err) {
      console.error(`[AgentMgr] Failed to handle delegation to ${targetAgentId}:`, err);
      this.pendingDelegations.delete(targetAgentId);
    }
  }

  // ── Peer consultation: specialist → specialist spawning ─────

  /** Parse [CONSULT:agent-id] markers and spawn consulted agents */
  private async parseConsultationMarkers(fromAgentId: string, text: string): Promise<void> {
    const consultRegex = /\[CONSULT:([a-z0-9-]+)\]\s*(.*)/gi;
    let match: RegExpExecArray | null;

    while ((match = consultRegex.exec(text)) !== null) {
      const targetAgentId = match[1];
      const question = match[2]?.trim() ?? '';

      if (!AGENT_ROLE_MAP.has(targetAgentId)) {
        console.warn(`[AgentMgr] Unknown consultation target: ${targetAgentId}`);
        continue;
      }
      if (targetAgentId === fromAgentId) {
        console.warn(`[AgentMgr] ${fromAgentId} cannot consult itself`);
        continue;
      }

      // Don't interrupt busy agents — skip if target is active and not idle
      const targetAgent = this.active.get(targetAgentId);
      if (targetAgent && targetAgent.status !== 'IDLE') {
        console.log(`[AgentMgr] ${targetAgentId} is busy (${targetAgent.status}), skipping consultation from ${fromAgentId}`);
        continue;
      }

      console.log(`[AgentMgr] ${fromAgentId} consulting ${targetAgentId}: ${question.slice(0, 80)}`);
      await this.handleConsultation(fromAgentId, targetAgentId, question);
    }
  }

  /** Spawn or message a specialist for a consultation */
  private async handleConsultation(fromAgentId: string, targetAgentId: string, question: string): Promise<void> {
    try {
      this.pendingConsultations.set(targetAgentId, {
        requestedBy: fromAgentId,
        question,
        output: [],
      });

      const consultMsg = `[Consultation from ${fromAgentId}]: ${question}`;

      // Notify CollaborationManager for visual effects
      if (this.collaborationManager) {
        await this.collaborationManager.onDelegation(fromAgentId, targetAgentId, question);
      }

      if (this.hasActiveSession(targetAgentId)) {
        await this.sendMessage(targetAgentId, consultMsg);
      } else {
        const systemPrompt = agentConfigLoader.generateSystemPrompt(targetAgentId);
        const tools = agentConfigLoader.getAllowedTools(targetAgentId).filter(t => t !== 'Agent');
        await this.spawnAgent(targetAgentId, systemPrompt, consultMsg, {
          allowedTools: tools,
          settingSources: ['user', 'project'],
        });
      }
    } catch (err) {
      console.error(`[AgentMgr] Failed to handle consultation ${fromAgentId} → ${targetAgentId}:`, err);
      this.pendingConsultations.delete(targetAgentId);
    }
  }

  async stopAll(): Promise<void> {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    await this.adapter.stopAll();

    for (const [configId] of this.active) {
      await this.db.agent.update({
        where: { configId },
        data: { status: 'OFFLINE', pid: null },
      }).catch(() => {}); // Best effort on shutdown
    }

    this.active.clear();
    this.queue = [];
    this.parentSubagents.clear();
    this.completedSubagents.clear();
    this.pendingDelegations.clear();
    this.pendingConsultations.clear();
  }
}
