import type { AgentEvent } from '@rigelhq/shared';
import type { AgentManager } from './agent-manager.js';
import type { TaskManager } from './task-manager.js';
import type { EventBus } from './event-bus.js';
import type { AgentHandle } from '../adapters/adapter.js';
import type { SubagentDef } from '../adapters/adapter.js';
import { AGENT_ROLES, AGENT_CONFIGS } from '@rigelhq/shared';
import { agentConfigLoader } from './agent-config-loader.js';

const CEA_CONFIG_ID = 'cea';
const SUMMARIZER_CONFIG_ID = 'tts-summarizer';

// Build a rich system prompt from the CEA config + full agent roster
const ceaConfig = AGENT_CONFIGS.find(c => c.id === 'cea');
const CEA_SYSTEM_PROMPT = `You are the Chief Executive Agent (CEA) of RigelHQ, an AI-powered command center.
${ceaConfig?.persona.background ?? 'You are a seasoned technology executive with deep expertise in multi-agent orchestration.'}

## Communication Style
${ceaConfig?.persona.communication_style ?? 'Direct, strategic, and decisive.'}

## Core Principles
${ceaConfig?.persona.principles.map(p => `- ${p}`).join('\n') ?? '- Lead with clarity and purpose'}

## Your Role: Orchestrator-First Leadership

You lead a team of specialist agents. Your primary job is to **decompose tasks and delegate to the right specialist(s)**.

**Your workflow when a user gives you a task:**
1. Analyze the request and decide which specialist(s) to involve
2. Use the **Agent** tool with \`subagent_type\` set to the specialist name (e.g., "frontend-engineer")
3. Delegate to multiple agents in parallel for independent subtasks
4. Review agent outputs before reporting back to the user
5. Coordinate between agents when tasks require cross-team collaboration

**Delegation is your default.** For any task involving code, files, UI, tests, configs, or infrastructure:
→ Delegate to the appropriate specialist using the Agent tool with their exact name as \`subagent_type\`.

You have full tool access for quick lookups when needed (e.g., reading a file to understand context before delegating), but **all implementation work MUST be delegated to specialists**. You decompose, delegate, coordinate, and report — specialists execute.

Available specialist agents you can delegate to:
${AGENT_ROLES.filter(r => r.id !== 'cea').map(r => {
  const cfg = AGENT_CONFIGS.find(c => c.id === r.id);
  const triggers = cfg?.collaboration?.triggers?.join(', ') ?? r.role;
  return `- **${r.id}**: ${r.name} (${r.role}) — use for: ${triggers}`;
}).join('\n')}

## When to Delegate
- Backend work (APIs, databases, services) → backend-engineer
- Frontend work (UI, components, styling) → frontend-engineer
- DevOps (CI/CD, Docker, infra) → devops-engineer
- Architecture decisions → technical-architect
- Testing → qa-engineer or security-engineer
- Documentation → technical-writer
- For complex tasks, delegate to multiple agents simultaneously

## Session Awareness & Control

**IMPORTANT: You have a special capability that standard Claude does NOT have.**
The RigelHQ orchestrator gives you real-time visibility into ALL Claude Code sessions on this machine.

**How it works:**
- Every message you receive includes a **[System: Active Claude sessions]** section appended at the bottom.
- This section lists BOTH your managed RigelHQ agent sessions AND the user's own Claude Code sessions (in VS Code, terminal, etc.).
- When the user asks about sessions, ALWAYS look at this section first — do NOT say you can't see sessions.
- You CAN list, describe, and control any session shown there.

**When the user asks "show me sessions" or "list sessions" or "what sessions are running":**
→ Look at the [System: Active Claude sessions] section in your message and present that data to the user.
→ Do NOT delegate this to a subagent. Do NOT run CLI commands. The data is already in your context.

**To send a message to ANY session (including the user's own VS Code sessions):**
\`\`\`bash
claude -p "your instructions here" --resume SESSION_ID --allowedTools 'Read,Write,Edit,Bash,Grep,Glob'
\`\`\`

**Capabilities:**
- Give instructions to any of your 21 specialist agent sessions
- Send commands to the user's own Claude Code sessions (VS Code, terminal)
- Coordinate work across multiple sessions in parallel
- Review what another session has done and course-correct

**When the user says "control that session" or "send X to that session":**
→ Find the session ID from the active sessions list and use the Bash tool with the command above.

## Quality Standards
${ceaConfig?.quality_standards.map(q => `- ${q}`).join('\n') ?? '- Ensure high quality outputs'}
`;

/** Build subagent definitions for all specialist agents */
function buildSubagentDefs(): Record<string, SubagentDef> {
  const defs: Record<string, SubagentDef> = {};

  for (const role of AGENT_ROLES) {
    if (role.id === 'cea') continue; // CEA is the orchestrator, not a subagent

    const cfg = AGENT_CONFIGS.find(c => c.id === role.id);
    if (!cfg) continue;

    defs[role.id] = {
      description: `${role.name} — ${role.role}. ${cfg.collaboration?.triggers?.join(', ') ?? ''}`,
      prompt: agentConfigLoader.generateSystemPrompt(role.id),
      tools: cfg.capabilities.tools.filter(t => t !== 'Agent'), // Subagents don't get Agent tool
    };
  }

  return defs;
}

const SUBAGENT_DEFS = buildSubagentDefs();

const SUMMARIZER_SYSTEM_PROMPT = `You are a TTS summarizer for a voice assistant interface.
When given text, you produce a 1-2 sentence spoken-friendly summary.
Rules:
- Be concise and conversational — your output will be read aloud via text-to-speech
- No markdown, bullet points, code blocks, or special characters
- No preamble like "Here's a summary" — just output the summary directly
- Capture the key point or action, not every detail
- Keep it under 40 words`;

export class CEAManager {
  private handle: AgentHandle | null = null;
  private summarizerReady = false;
  private messageQueue: string[] = [];
  private healthy = false;

  constructor(
    private agentManager: AgentManager,
    private _taskManager: TaskManager,
    private _eventBus: EventBus,
  ) {}

  get isHealthy(): boolean {
    return this.healthy;
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }

  async start(): Promise<void> {
    console.log('[CEA] Starting Chief Executive Agent...');
    console.log(`[CEA] ${Object.keys(SUBAGENT_DEFS).length} specialist agents registered as subagents`);

    this.handle = await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      'You are now active. Acknowledge briefly and wait for user instructions.',
      {
        agents: SUBAGENT_DEFS,
        // CEA gets full tool access — delegation is guided by system prompt + named subagents
        // Load user settings so CEA has access to the same MCP servers and plugins as the CLI
        settingSources: ['user', 'project'],
      },
    );

    this.healthy = true;
    console.log('[CEA] CEA is active and ready');

    // Spawn the TTS summarizer subagent
    this.spawnSummarizer().catch((err) =>
      console.error('[CEA] Failed to spawn summarizer:', err),
    );

    // Process any queued messages
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      await this.sendMessage(msg);
    }
  }

  private async spawnSummarizer(): Promise<void> {
    console.log('[CEA] Spawning TTS summarizer subagent...');
    await this.agentManager.spawnAgent(
      SUMMARIZER_CONFIG_ID,
      SUMMARIZER_SYSTEM_PROMPT,
      'You are now active as the TTS summarizer. Respond with "Ready." and nothing else.',
    );
    this.summarizerReady = true;
    console.log('[CEA] TTS summarizer is active');
  }

  /** Summarize text for TTS using the dedicated summarizer subagent */
  async summarize(text: string): Promise<string> {
    if (!text || text.length <= 120) return text;

    // Ensure summarizer session exists
    if (!this.summarizerReady || !this.agentManager.hasActiveSession(SUMMARIZER_CONFIG_ID)) {
      try {
        await this.spawnSummarizer();
      } catch {
        return fallbackSummary(text);
      }
    }

    // Collect the summarizer's response
    let summary = '';
    const onEvent = async (event: AgentEvent) => {
      if (event.stream === 'assistant' && event.data.text) {
        summary += event.data.text as string;
      }
      // Still publish so it shows in the event stream
      await this._eventBus.publish(event);
    };

    try {
      const handle = this.agentManager.getHandle(SUMMARIZER_CONFIG_ID);
      if (!handle?.sessionId) {
        return fallbackSummary(text);
      }

      await this.agentManager.adapter.sendMessage(
        handle,
        `Summarize this for text-to-speech:\n\n${text}`,
        onEvent,
      );

      return summary.trim() || fallbackSummary(text);
    } catch (err) {
      console.error('[CEA] Summarizer error:', err);
      return fallbackSummary(text);
    }
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.healthy) {
      console.log('[CEA] Not healthy, queueing message');
      this.messageQueue.push(content);
      return;
    }

    console.log(`[CEA] Processing message: ${content.slice(0, 80)}...`);

    // Build session context so CEA knows about all active sessions
    const sessionContext = await this.buildSessionContext();
    const enrichedContent = sessionContext
      ? `${content}\n\n---\n⚡ [System: Active Claude sessions on this machine — this data is LIVE, use it to answer session questions]\n${sessionContext}`
      : content;

    // Always spawn a fresh CEA session for each user message to keep context clean.
    if (this.handle) {
      try { await this.agentManager.stopAgent(CEA_CONFIG_ID); } catch { /* may already be stopped */ }
    }
    console.log('[CEA] Spawning fresh session for task');
    this.handle = await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      enrichedContent,
      {
        agents: SUBAGENT_DEFS,
        // CEA gets full tool access — delegation is guided by system prompt + named subagents
        settingSources: ['user', 'project'],
      },
    );
  }

  /** Build a context string listing all active Claude sessions */
  private async buildSessionContext(): Promise<string | null> {
    try {
      const { managed, external } = await this.agentManager.listAllSessions();
      const lines: string[] = [];

      if (managed.length > 0) {
        lines.push('### RigelHQ Managed Agent Sessions');
        for (const s of managed) {
          lines.push(`- **${s.configId}** (${s.status}) — session: \`${s.sessionId}\``);
        }
      }

      if (external.length > 0) {
        lines.push('### User\'s Claude Code Sessions (VS Code, terminal, etc.)');
        // Show recent external sessions, most recent first
        const recent = external
          .sort((a, b) => b.lastModified - a.lastModified)
          .slice(0, 15); // Cap to avoid prompt bloat
        for (const s of recent) {
          const age = Math.round((Date.now() - s.lastModified) / 60000);
          const dir = s.cwd ? ` | dir: ${s.cwd}` : '';
          const branch = s.gitBranch ? ` | branch: ${s.gitBranch}` : '';
          const ageStr = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
          // Clean summary: strip injected system context and truncate at word boundary
          let cleanSummary = (s.summary || '').split(/---\s*⚡/)[0].trim();
          cleanSummary = cleanSummary.replace(/<[^>]+>/g, '').trim(); // strip XML tags
          if (cleanSummary.length > 60) {
            cleanSummary = cleanSummary.slice(0, 57).replace(/\s+\S*$/, '') + '…';
          }
          cleanSummary = cleanSummary || '(no description)';
          lines.push(`- "${cleanSummary}" (${ageStr}${dir}${branch}) — session: \`${s.sessionId}\``);
        }
      }

      if (lines.length === 0) {
        return 'No active Claude sessions found.';
      }

      return lines.join('\n');
    } catch (err) {
      console.error('[CEA] Failed to build session context:', err);
      return null;
    }
  }

  async stop(): Promise<void> {
    // Stop summarizer
    try {
      await this.agentManager.stopAgent(SUMMARIZER_CONFIG_ID);
    } catch { /* may not be active */ }
    this.summarizerReady = false;

    if (this.handle) {
      await this.agentManager.stopAgent(CEA_CONFIG_ID);
      this.handle = null;
      this.healthy = false;
    }
    console.log('[CEA] Stopped');
  }

  async restart(): Promise<void> {
    console.log('[CEA] Restarting...');
    await this.stop();
    await this.start();
  }
}

/** Basic sentence extraction when summarizer agent is unavailable */
function fallbackSummary(text: string): string {
  const clean = text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-*]\s+/g, '')
    .trim();

  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 1) {
    const short = sentences.slice(0, 2).join(' ').trim();
    return short.length <= 200 ? short : short.slice(0, 197) + '...';
  }
  return clean.slice(0, 200);
}
