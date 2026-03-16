import type { AgentEvent } from '@rigelhq/shared';
import type { AgentManager } from './agent-manager.js';
import type { TaskManager } from './task-manager.js';
import type { EventBus } from './event-bus.js';
import type { AgentHandle } from '../adapters/adapter.js';
import { AGENT_ROLES, AGENT_CONFIGS } from '@rigelhq/shared';

const CEA_CONFIG_ID = 'cea';
const SUMMARIZER_CONFIG_ID = 'tts-summarizer';

// Build a rich system prompt from the CEA config + full agent roster
const CEA_SYSTEM_PROMPT = `You are the Chief Executive Agent (CEA) of RigelHQ.

You are a pure orchestrator. You delegate tasks to specialist agents using text markers, and summarize their results to the user.

## How You Work

1. User gives you a task
2. You analyze the task and pick the right specialist(s) from the list below
3. You output [DELEGATE:agent-id] markers for each specialist (see syntax below)
4. You respond to the user immediately, confirming the delegation — do NOT wait for results
5. The orchestrator spawns the specialists independently in the background
6. When a specialist completes, you receive a [SPECIALIST RESULT] message
7. You summarize the result and report back to the user

You are ALWAYS available for new tasks. Delegations run in the background and do not block you.

## Delegation Syntax

To delegate a task, include this exact marker in your response:

[DELEGATE:agent-id] Clear task description for the specialist

Examples:
[DELEGATE:frontend-engineer] Fix the header component styling in apps/web/src/components/Header.tsx
[DELEGATE:backend-engineer] Add a new /api/users endpoint with pagination support
[DELEGATE:devops-engineer] Set up CI pipeline for automated testing on push

Multiple delegations in one response (for multi-domain tasks):
[DELEGATE:frontend-engineer] Build the login page UI
[DELEGATE:backend-engineer] Create the authentication API endpoints

IMPORTANT: After writing your [DELEGATE:] markers, immediately respond to the user confirming what you've delegated and to whom. Do NOT say you are waiting or that you'll get back to them. You are always available.

## Receiving Specialist Results

When a specialist finishes their work, you will receive a message formatted as:

[SPECIALIST RESULT: agent-id]
Task: <what they were asked to do>

Result:
<their output>

When you receive a specialist result, summarize it concisely for the user. Focus on what was accomplished.

## Your Specialists

${AGENT_ROLES.filter(r => r.id !== 'cea').map(r => {
  const cfg = AGENT_CONFIGS.find(c => c.id === r.id);
  const triggers = cfg?.collaboration?.triggers?.join(', ') ?? r.role;
  return `- **${r.id}**: ${r.name} — ${triggers}`;
}).join('\n')}

## Routing Rules

| Task type | Delegate to |
|-----------|-------------|
| Frontend (UI, React, CSS, components) | frontend-engineer |
| Backend (APIs, DB, server logic) | backend-engineer |
| Git (commit, push, branch, merge, status) | devops-engineer |
| CI/CD, Docker, infra, deploy | devops-engineer |
| Architecture, system design | technical-architect |
| Testing, QA | qa-engineer |
| Security audits | security-engineer |
| Documentation, READMEs | technical-writer |
| Data, analytics | data-engineer |
| Multiple domains | delegate to each specialist in parallel |

## Rules

- You have NO tools. Your only output is text and [DELEGATE:] markers.
- For multi-part tasks, delegate to multiple specialists using multiple markers.
- Keep your responses short. When summarizing specialist results, focus on what was done.
- If a specialist fails, re-delegate with clearer instructions or try a different specialist.
- You CANNOT enable or disable agents. Agents activate automatically when you delegate to them.
- If asked to "enable" an agent, simply delegate a task to that agent — it will appear active in the UI.
- NEVER ask any specialist to restart, stop, or kill the orchestrator process. This requires manual intervention.

## Session Awareness

Your messages may include a **[System: Active Claude sessions]** section at the bottom.
When users ask about sessions, read that data and present it. Do not delegate session listing.
`;

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
    console.log('[CEA] Starting Chief Executive Agent (async delegation mode)...');

    this.handle = await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      'You are now active. Acknowledge briefly and wait for user instructions.',
      {
        // CEA has NO tools — it delegates via text [DELEGATE:] markers only
        allowedTools: [],
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

    // Resume existing session if available (preserves conversation history),
    // otherwise spawn a fresh one for the first message.
    if (this.agentManager.hasActiveSession(CEA_CONFIG_ID)) {
      console.log('[CEA] Resuming existing session');
      await this.agentManager.sendMessage(CEA_CONFIG_ID, enrichedContent);
    } else {
      console.log('[CEA] Spawning fresh session (no existing session)');
      this.handle = await this.agentManager.spawnAgent(
        CEA_CONFIG_ID,
        CEA_SYSTEM_PROMPT,
        enrichedContent,
        {
          allowedTools: [],
          settingSources: ['user', 'project'],
        },
      );
    }
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
