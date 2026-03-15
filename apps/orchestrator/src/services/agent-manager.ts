import type { PrismaClient } from '@prisma/client';
import type { AgentEvent, AgentStatus } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, SpawnOptions, SessionInfo } from '../adapters/adapter.js';
import type { EventBus } from './event-bus.js';

interface ActiveAgent {
  handle: AgentHandle;
  configId: string;
  status: AgentStatus;
  lastActivity: number;
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

  constructor(
    readonly adapter: GatewayAdapter,
    private eventBus: EventBus,
    private db: PrismaClient,
    private maxConcurrent: number = 5,
    private idleTimeoutMs: number = 5 * 60 * 1000,
  ) {}

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
    const onEvent = async (event: AgentEvent) => {
      await this.handleEvent(configId, event);
    };

    const handle = await this.adapter.spawn(configId, systemPrompt, taskPrompt, onEvent, options);

    const activeAgent: ActiveAgent = {
      handle,
      configId,
      status: 'THINKING',
      lastActivity: Date.now(),
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
      const specialistStatus = this.mapEventToStatus(event);
      if (specialistStatus) {
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
      this.stopAgent(configId).catch(console.error);
    }, this.idleTimeoutMs));
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
    await this.adapter.stop(agent.handle);
    this.active.delete(configId);

    await this.db.agent.update({
      where: { configId },
      data: { status: 'OFFLINE', pid: null },
    });

    await this.eventBus.publishStatus(configId, 'OFFLINE');
    await this.processQueue();
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
  }
}
