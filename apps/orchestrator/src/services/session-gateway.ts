import type { PrismaClient } from '@prisma/client';
import type { AgentEvent, AgentStatus } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { GatewayAdapter, SessionHandle } from '../adapters/adapter.js';
import type { EventBus } from './event-bus.js';
import { AgentDefinitionBuilder } from './agent-definition-builder.js';

const TEAM_LEAD_SYSTEM_PROMPT = `You are the Team Lead of RigelHQ — an AI engineering organization.

## Your Role
You are an orchestrator. You receive tasks from users and delegate them to specialist agents using the Agent tool. You do NOT do the work yourself.

## How You Work
1. Analyze the user's request
2. Decide which specialist(s) are needed
3. Use the Agent tool to delegate to them (set subagent_type to the specialist's ID)
4. Summarize results concisely for the user

## CRITICAL RULES
- ALWAYS delegate work to specialists using the Agent tool. Never write code, read files, or use Bash yourself.
- Use the \`subagent_type\` parameter when calling the Agent tool — set it to the specialist's ID (e.g., "frontend-engineer", "backend-engineer").
- For multi-domain tasks, make multiple Agent calls in parallel.
- Keep your responses concise — focus on what was accomplished.
`;

interface ActiveSession {
  handle: SessionHandle;
  projectName: string;
  activeAgents: Set<string>;  // configIds of currently active specialists
  /** Map tool_use_id -> agent configId for resolving task events */
  toolUseToAgent: Map<string, string>;
}

export class SessionGateway {
  private sessions = new Map<string, ActiveSession>();       // sessionId -> ActiveSession
  private configToSession = new Map<string, string>();       // configId -> sessionId (for lookup)
  private agentDefBuilder: AgentDefinitionBuilder;
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private adapter: GatewayAdapter,
    private eventBus: EventBus,
    private db: PrismaClient,
    private idleTimeoutMs: number = 30 * 60 * 1000,  // 30 min default
  ) {
    this.agentDefBuilder = new AgentDefinitionBuilder();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Create a new session for a project */
  async createSession(projectName: string, initialPrompt: string): Promise<string> {
    console.log(`[SessionGW] Creating session for project: ${projectName}`);

    const agents = this.agentDefBuilder.buildAll();
    console.log(`[SessionGW] Loaded ${Object.keys(agents).length} agent definitions`);

    const onEvent = async (event: AgentEvent) => {
      await this.handleEvent(event);
    };

    const configId = 'cea';  // Team lead uses the CEA configId for proper UI attribution
    const handle = await this.adapter.createSession(
      configId,
      initialPrompt,
      agents,
      onEvent,
      {
        systemPrompt: TEAM_LEAD_SYSTEM_PROMPT,
        agentProgressSummaries: true,
      },
    );

    // Wait briefly for session ID to be populated from the init message
    const waitForSession = async (): Promise<string> => {
      for (let i = 0; i < 50; i++) {
        if (handle.sessionId) return handle.sessionId;
        await new Promise(r => setTimeout(r, 100));
      }
      // Fallback: generate a temporary session ID
      return `pending-${Date.now()}`;
    };
    const sessionId = await waitForSession();
    handle.sessionId = sessionId;

    const session: ActiveSession = {
      handle,
      projectName,
      activeAgents: new Set(),
      toolUseToAgent: new Map(),
    };

    this.sessions.set(sessionId, session);

    // Store in DB
    await this.db.session.upsert({
      where: { sessionId },
      update: { projectName, status: 'ACTIVE' },
      create: {
        projectName,
        sessionId,
        status: 'ACTIVE',
      },
    });

    this.resetIdleTimer(sessionId);
    console.log(`[SessionGW] Session created: ${sessionId} for ${projectName}`);
    return sessionId;
  }

  /** Send a follow-up message to an existing session */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No active session: ${sessionId}`);

    console.log(`[SessionGW] Sending message to ${sessionId}: ${message.slice(0, 80)}...`);

    const onEvent = async (event: AgentEvent) => {
      await this.handleEvent(event);
    };

    await this.db.session.update({
      where: { sessionId },
      data: { status: 'ACTIVE' },
    });

    await this.adapter.resumeSession(session.handle, message, onEvent);
    this.resetIdleTimer(sessionId);
  }

  /** List all sessions */
  async listSessions(): Promise<Array<{ sessionId: string; projectName: string; status: string }>> {
    const dbSessions = await this.db.session.findMany({
      where: { status: { not: 'STOPPED' } },
      orderBy: { lastActive: 'desc' },
    });
    return dbSessions.map(s => ({
      sessionId: s.sessionId,
      projectName: s.projectName,
      status: s.status,
    }));
  }

  /** Check if a session exists and is active */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Stop a specific session */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.clearIdleTimer(sessionId);
    await this.adapter.stop(session.handle);
    this.sessions.delete(sessionId);

    // Clean up configToSession reverse-lookup entries for this session
    for (const [configId, sid] of this.configToSession) {
      if (sid === sessionId) this.configToSession.delete(configId);
    }

    await this.db.session.update({
      where: { sessionId },
      data: { status: 'STOPPED' },
    });

    // Mark all active agents for this session as IDLE
    for (const agentId of session.activeAgents) {
      await this.db.agent.update({
        where: { configId: agentId },
        data: { status: 'IDLE', sessionId: null, taskId: null },
      }).catch(() => { /* agent row may not exist yet */ });
      await this.eventBus.publishStatus(agentId, 'IDLE');
    }

    console.log(`[SessionGW] Session stopped: ${sessionId}`);
  }

  /** Stop all sessions */
  async stopAll(): Promise<void> {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    await this.adapter.stopAll();
    this.sessions.clear();
    this.configToSession.clear();
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  /** Handle events from the SDK stream */
  private async handleEvent(event: AgentEvent): Promise<void> {
    // Publish all events to the bus (UI gets everything)
    await this.eventBus.publish(event);

    // Track agent status based on event stream
    const agentId = event.agentId;
    if (!agentId || !AGENT_ROLE_MAP.has(agentId)) return;

    const status = this.mapEventToStatus(event);
    if (!status) return;

    const roleMeta = AGENT_ROLE_MAP.get(agentId)!;

    await this.db.agent.upsert({
      where: { configId: agentId },
      update: {
        status,
        sessionId: (event.sessionKey as string) ?? null,
        taskId: (event.data.taskId as string) ?? null,
      },
      create: {
        configId: agentId,
        name: roleMeta.name,
        role: roleMeta.role,
        icon: roleMeta.icon,
        status,
      },
    });

    await this.eventBus.publishStatus(agentId, status);

    // Track active agents per session
    for (const [, session] of this.sessions) {
      if (status === 'IDLE' || status === 'OFFLINE') {
        session.activeAgents.delete(agentId);
      } else {
        session.activeAgents.add(agentId);
      }
    }
  }

  private mapEventToStatus(event: AgentEvent): AgentStatus | null {
    switch (event.stream) {
      case 'lifecycle':
        if (event.data.phase === 'start' || event.data.phase === 'thinking') return 'THINKING';
        if (event.data.phase === 'end') return 'IDLE';
        return null;
      case 'tool':
        return 'TOOL_CALLING';
      case 'assistant':
        return 'SPEAKING';
      case 'error':
        return 'ERROR';
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Idle / hibernate
  // ---------------------------------------------------------------------------

  private resetIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    this.idleTimers.set(sessionId, setTimeout(() => {
      this.hibernateSession(sessionId).catch(console.error);
    }, this.idleTimeoutMs));
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  private async hibernateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    console.log(`[SessionGW] Hibernating session: ${sessionId}`);
    await this.adapter.stop(session.handle);
    await this.db.session.update({
      where: { sessionId },
      data: { status: 'IDLE' },
    });
    // Keep in sessions map so it can be resumed
  }
}
