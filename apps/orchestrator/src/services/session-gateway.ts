import type { PrismaClient } from '@prisma/client';
import type { AgentEvent, AgentStatus, EventStream } from '@rigelhq/shared';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { GatewayAdapter, SessionHandle } from '../adapters/adapter.js';
import type { EventBus } from './event-bus.js';
import { AgentDefinitionBuilder } from './agent-definition-builder.js';
import { generateEventId, generateRunId } from '@rigelhq/shared';

/** Color palette for communication lines */
const LINE_COLORS = ['#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#84cc16', '#06b6d4', '#ec4899', '#22c55e'];
let colorIndex = 0;

const TEAM_LEAD_SYSTEM_PROMPT = `You are the Team Lead of RigelHQ — an AI engineering organization with 20 specialist agents.

## Your Role
You are a pure orchestrator. You receive tasks from users and ALWAYS delegate them to specialist agents using the Agent tool. You NEVER do work yourself — no Bash, no Read, no Write, no code.

## How You Work
1. Analyze the user's request
2. Pick the RIGHT specialist(s) — see routing table below
3. Use the Agent tool with \`subagent_type\` set to the specialist's ID
4. Summarize results concisely for the user

## Routing Table
| Task | Specialist (subagent_type) |
|------|--------------------------|
| Frontend, UI, React, CSS | frontend-engineer |
| Backend, APIs, server, DB queries | backend-engineer |
| Mobile apps | app-developer |
| Git status, commits, branches, push | github-repos-owner |
| Code review, review changes | code-review-engineer |
| CI/CD, Docker, deploy, infra | devops-engineer |
| Cloud infra, Terraform, AWS | infra-engineer |
| Database schema, migrations, DBA | dba-engineer |
| Platform, build systems | platform-engineer |
| Testing, QA, bugs | qa-tester |
| Automated tests, E2E | automation-qa-tester |
| Load testing, performance | load-tester |
| Security audit, vulnerabilities | security-engineer |
| System design, architecture | technical-architect |
| Product requirements, specs | product-manager |
| UX design, wireframes | ux-designer |
| SRE, monitoring, incidents | sre-engineer |
| NOC, alerts, uptime | noc-engineer |
| Operations, runbooks | operations-engineer |
| Project planning, timelines | projects-manager |

## CRITICAL RULES
- ALWAYS delegate. Never do the work yourself.
- Use the exact subagent_type IDs from the table above.
- For "review code" or "is code reviewed" → use code-review-engineer.
- For "git status" or "uncommitted changes" → use github-repos-owner.
- For multi-domain tasks, make multiple parallel Agent calls.
- Keep your summaries short.
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
  private activeCollabs = new Map<string, string>();         // agentId -> collaborationId (for line lifecycle)
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
    const isCea = agentId === 'cea';
    const isKnownAgent = agentId && AGENT_ROLE_MAP.has(agentId);

    if (!isKnownAgent) return;

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

    // Emit collaboration events for communication lines (specialist agents only)
    if (!isCea && status === 'THINKING' && event.stream === 'lifecycle' && event.data.phase === 'start') {
      // Specialist started — draw line from CEA to specialist
      const color = LINE_COLORS[colorIndex % LINE_COLORS.length];
      colorIndex++;
      const collaborationId = `comm-${agentId}-${Date.now()}`;
      // Track so we can end it later
      this.activeCollabs.set(agentId, collaborationId);
      await this.eventBus.publish({
        id: generateEventId(),
        agentId: 'cea',
        runId: generateRunId(),
        seq: 1,
        stream: 'collaboration' as EventStream,
        timestamp: Date.now(),
        data: {
          phase: 'start',
          collaborationId,
          type: 'parallel',
          participants: ['cea', agentId],
          topic: `Delegated to ${roleMeta.name}`,
          color,
        },
      });
    } else if (!isCea && status === 'IDLE' && event.stream === 'lifecycle' && event.data.phase === 'end') {
      // Specialist finished — fade line
      const collaborationId = this.activeCollabs.get(agentId);
      if (collaborationId) {
        this.activeCollabs.delete(agentId);
        await this.eventBus.publish({
          id: generateEventId(),
          agentId,
          runId: generateRunId(),
          seq: 1,
          stream: 'collaboration' as EventStream,
          timestamp: Date.now(),
          data: {
            phase: 'end',
            collaborationId,
            participants: ['cea', agentId],
          },
        });
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
