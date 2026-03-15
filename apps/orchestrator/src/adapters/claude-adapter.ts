import { query, listSessions as sdkListSessions } from '@anthropic-ai/claude-agent-sdk';
import type { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EventStream } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, AgentHandle, AgentEventCallback, SpawnOptions, SessionInfo } from './adapter.js';

export class ClaudeAdapter implements GatewayAdapter {
  private handles = new Map<string, { abort: AbortController; configId: string }>();
  /** Track active query completions so we can wait for them to settle after abort */
  private activeQueries = new Map<string, { abort: AbortController; done: Promise<void>; resolve: () => void }>();
  /** Configs currently being interrupted — suppresses error events */
  private interrupting = new Set<string>();
  /** Track which named subagent is currently active for a parent configId (for event attribution) */
  private activeSubagent = new Map<string, string>();

  async spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
    options?: SpawnOptions,
  ): Promise<AgentHandle> {
    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;
    let sessionId: string | null = null;

    const emit = (stream: EventStream, data: AgentEvent['data'], agentId?: string) => {
      seq += 1;
      onEvent({
        id: generateEventId(),
        agentId: agentId ?? configId,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    this.handles.set(configId, { abort: abortController, configId });

    // Spawn Claude Agent SDK query — all agents get full tool access
    const defaultTools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'];
    const resolvedTools = options?.allowedTools ?? defaultTools;
    const iter = query({
      prompt: taskPrompt,
      options: {
        abortController,
        systemPrompt,
        allowedTools: resolvedTools,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        ...(options?.agents ? { agents: options.agents } : {}),
        ...(options?.settingSources ? { settingSources: options.settingSources } : {}),
        ...(options?.mcpServers ? { mcpServers: options.mcpServers } : {}),
      },
    });

    // Build handle early so we can set sessionId
    const handle: AgentHandle = {
      id: `claude-${configId}-${Date.now()}`,
      configId,
      pid: null,
      sessionId: null,
      allowedTools: resolvedTools,
      agents: options?.agents,
      cwd: process.cwd(),
      stop: async () => {
        abortController.abort();
        this.handles.delete(configId);
      },
    };

    // Process events in background, tracked for interrupt support
    let queryResolve: () => void;
    const queryDone = new Promise<void>((r) => { queryResolve = r; });
    this.activeQueries.set(configId, { abort: abortController, done: queryDone, resolve: queryResolve! });

    (async () => {
      emit('lifecycle', { phase: 'start' });
      try {
        for await (const message of iter) {
          // Capture session ID from init message
          if (message.type === 'system') {
            const raw = message as unknown as Record<string, unknown>;
            const subtype = raw.subtype as string;

            // Capture session ID from init message
            if (subtype === 'init') {
              const sid = extractSessionId(raw);
              if (sid) {
                sessionId = sid;
                handle.sessionId = sessionId;
                console.log(`[Claude] Session started for ${configId}: ${sessionId}`);
              } else {
                console.warn(`[Claude] Init message for ${configId} had no session_id! Keys: ${Object.keys(raw).join(', ')}`);
              }
            }

            // Subagent task events — attribute to the named specialist from the Agent tool call
            if (subtype === 'task_started') {
              const taskDesc = (raw.description as string) ?? '';
              const subAgentId = this.activeSubagent.get(configId) ?? extractAgentId(taskDesc);
              console.log(`[Claude] Subagent started for ${configId}: ${subAgentId} — "${taskDesc.slice(0, 60)}"`);
              emit('lifecycle', { phase: 'start' }, subAgentId);
              emit('assistant', { text: `[${subAgentId}] Working on: ${taskDesc}` }, subAgentId);
            } else if (subtype === 'task_progress') {
              const subAgentId = this.activeSubagent.get(configId) ?? extractAgentId(raw.description as string);
              const lastTool = raw.last_tool_name as string | undefined;
              if (lastTool) {
                emit('tool', { tool: lastTool, phase: 'start' }, subAgentId);
                emit('tool', { tool: lastTool, phase: 'end' }, subAgentId);
              }
              emit('lifecycle', { phase: 'thinking' }, subAgentId);
            } else if (subtype === 'task_notification') {
              const status = raw.status as string;
              const summary = (raw.summary as string) ?? '';
              const subAgentId = this.activeSubagent.get(configId) ?? extractAgentId(summary);
              if (summary) {
                emit('assistant', { text: summary }, subAgentId);
              }
              if (status === 'failed') {
                emit('error', { error: `Subagent task failed` }, subAgentId);
              }
              emit('lifecycle', { phase: 'end' }, subAgentId);
              console.log(`[Claude] Subagent completed for ${configId}: ${subAgentId} (${status})`);
              this.activeSubagent.delete(configId);
            }
          } else if (message.type === 'assistant') {
            const assistantMsg = message as SDKAssistantMessage;
            emit('lifecycle', { phase: 'thinking' });
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                emit('assistant', { text: block.text });
              } else if (block.type === 'tool_use') {
                // Track which named subagent the CEA is delegating to
                if (block.name === 'Agent') {
                  const input = block.input as Record<string, unknown>;
                  const subagentType = (input.subagent_type as string) ?? null;
                  if (subagentType) {
                    this.activeSubagent.set(configId, subagentType);
                    console.log(`[Claude] ${configId} delegating to specialist: ${subagentType}`);
                  } else {
                    const desc = (input.prompt as string ?? input.description as string ?? '').slice(0, 60);
                    console.log(`[Claude] ${configId} delegating to generic agent: "${desc}"`);
                  }
                } else {
                  console.log(`[Claude] ${configId} calling tool: ${block.name}`);
                }
                emit('tool', { tool: block.name, phase: 'start', toolArgs: block.input as Record<string, unknown> });
                emit('tool', { tool: block.name, phase: 'end' });
              }
            }
          } else if (message.type === 'result') {
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.subtype !== 'success') {
              // Suppress error if this was an intentional interrupt (steering)
              if (!this.interrupting.has(configId)) {
                emit('error', { error: `Agent run ended: ${resultMsg.subtype}` });
              }
            }
            emit('lifecycle', { phase: 'end' });
          }
        }
      } catch (err) {
        // Suppress error events for intentional interrupts
        if (!this.interrupting.has(configId)) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          emit('error', { error: errorMsg });
        }
        emit('lifecycle', { phase: 'end' });
      } finally {
        this.handles.delete(configId);
        this.activeQueries.delete(configId);
        queryResolve!();
      }
    })();

    return handle;
  }

  /**
   * Interrupt any in-progress query for this config.
   * Aborts the current query and waits for its iterator to settle.
   * The session ID is preserved — only the active run is cancelled.
   */
  async interrupt(configId: string): Promise<void> {
    const active = this.activeQueries.get(configId);
    if (!active) return;

    console.log(`[Claude] Interrupting active query for ${configId} (steering)`);
    this.interrupting.add(configId);
    active.abort.abort();

    try {
      // Wait for the iterator to finish (max 3s safety timeout)
      await Promise.race([
        active.done,
        new Promise<void>((r) => setTimeout(r, 3000)),
      ]);
    } finally {
      this.interrupting.delete(configId);
    }
  }

  /** Send a follow-up message to an existing session via resume */
  async sendMessage(
    handle: AgentHandle,
    message: string,
    onEvent: AgentEventCallback,
  ): Promise<void> {
    if (!handle.sessionId) {
      throw new Error(`No session to resume for ${handle.configId}`);
    }

    // Interrupt any in-progress query first (steer, don't abort)
    await this.interrupt(handle.configId);

    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;

    const emit = (stream: EventStream, data: AgentEvent['data'], agentId?: string) => {
      seq += 1;
      onEvent({
        id: generateEventId(),
        agentId: agentId ?? handle.configId,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    this.handles.set(handle.configId, { abort: abortController, configId: handle.configId });

    // Track this query for future interrupt support
    let queryResolve: () => void;
    const queryDone = new Promise<void>((r) => { queryResolve = r; });
    this.activeQueries.set(handle.configId, { abort: abortController, done: queryDone, resolve: queryResolve! });

    const defaultTools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'];
    const resumeTools = handle.allowedTools ?? defaultTools;
    const iter = query({
      prompt: message,
      options: {
        abortController,
        resume: handle.sessionId,
        allowedTools: resumeTools,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        ...(handle.agents ? { agents: handle.agents } : {}),
      },
    });

    emit('lifecycle', { phase: 'start' });
    try {
      for await (const msg of iter) {
        if (msg.type === 'system') {
          const raw = msg as unknown as Record<string, unknown>;
          const subtype = raw.subtype as string;

          // Update session ID if it changed
          if (subtype === 'init') {
            const sid = extractSessionId(raw);
            if (sid) {
              handle.sessionId = sid;
              console.log(`[Claude] Session resumed for ${handle.configId}: ${sid}`);
            }
          }

          // Subagent task events — attribute to the named specialist from the Agent tool call
          if (subtype === 'task_started') {
            const taskDesc = (raw.description as string) ?? '';
            const subAgentId = this.activeSubagent.get(handle.configId) ?? extractAgentId(taskDesc);
            console.log(`[Claude] Subagent started for ${handle.configId}: ${subAgentId} — "${taskDesc.slice(0, 60)}"`);
            emit('lifecycle', { phase: 'start' }, subAgentId);
            emit('assistant', { text: `[${subAgentId}] Working on: ${taskDesc}` }, subAgentId);
          } else if (subtype === 'task_progress') {
            const subAgentId = this.activeSubagent.get(handle.configId) ?? extractAgentId(raw.description as string);
            const lastTool = raw.last_tool_name as string | undefined;
            if (lastTool) {
              emit('tool', { tool: lastTool, phase: 'start' }, subAgentId);
              emit('tool', { tool: lastTool, phase: 'end' }, subAgentId);
            }
            emit('lifecycle', { phase: 'thinking' }, subAgentId);
          } else if (subtype === 'task_notification') {
            const status = raw.status as string;
            const summary = (raw.summary as string) ?? '';
            const subAgentId = this.activeSubagent.get(handle.configId) ?? extractAgentId(summary);
            if (summary) emit('assistant', { text: summary }, subAgentId);
            if (status === 'failed') emit('error', { error: 'Subagent task failed' }, subAgentId);
            emit('lifecycle', { phase: 'end' }, subAgentId);
            console.log(`[Claude] Subagent completed for ${handle.configId}: ${subAgentId} (${status})`);
            this.activeSubagent.delete(handle.configId);
          }
        } else if (msg.type === 'assistant') {
          const assistantMsg = msg as SDKAssistantMessage;
          emit('lifecycle', { phase: 'thinking' });
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              emit('assistant', { text: block.text });
            } else if (block.type === 'tool_use') {
              // Track which named subagent the CEA is delegating to
              if (block.name === 'Agent') {
                const input = block.input as Record<string, unknown>;
                const subagentType = (input.subagent_type as string) ?? null;
                if (subagentType) {
                  this.activeSubagent.set(handle.configId, subagentType);
                  console.log(`[Claude] ${handle.configId} delegating to specialist: ${subagentType}`);
                } else {
                  const desc = (input.prompt as string ?? input.description as string ?? '').slice(0, 60);
                  console.log(`[Claude] ${handle.configId} delegating to generic agent: "${desc}"`);
                }
              } else {
                console.log(`[Claude] ${handle.configId} (resume) calling tool: ${block.name}`);
              }
              emit('tool', { tool: block.name, phase: 'start', toolArgs: block.input as Record<string, unknown> });
              emit('tool', { tool: block.name, phase: 'end' });
            }
          }
        } else if (msg.type === 'result') {
          const resultMsg = msg as SDKResultMessage;
          if (resultMsg.subtype !== 'success') {
            // Suppress error if this was an intentional interrupt (steering)
            if (!this.interrupting.has(handle.configId)) {
              emit('error', { error: `Agent run ended: ${resultMsg.subtype}` });
            }
          }
          emit('lifecycle', { phase: 'end' });
        }
      }
    } catch (err) {
      // Suppress error events for intentional interrupts
      if (!this.interrupting.has(handle.configId)) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit('error', { error: errorMsg });
      }
      emit('lifecycle', { phase: 'end' });
    } finally {
      this.handles.delete(handle.configId);
      this.activeQueries.delete(handle.configId);
      queryResolve!();
    }
  }

  async sendToSession(
    sessionId: string,
    message: string,
    onEvent: AgentEventCallback,
  ): Promise<void> {
    const runId = generateRunId();
    const abortController = new AbortController();
    let seq = 0;

    const emit = (stream: EventStream, data: AgentEvent['data']) => {
      seq += 1;
      onEvent({
        id: generateEventId(),
        agentId: `session-${sessionId.slice(0, 8)}`,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    const iter = query({
      prompt: message,
      options: {
        abortController,
        resume: sessionId,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    emit('lifecycle', { phase: 'start' });
    try {
      for await (const msg of iter) {
        if (msg.type === 'assistant') {
          const assistantMsg = msg as SDKAssistantMessage;
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              emit('assistant', { text: block.text });
            } else if (block.type === 'tool_use') {
              emit('tool', { tool: block.name, phase: 'start', toolArgs: block.input as Record<string, unknown> });
              emit('tool', { tool: block.name, phase: 'end' });
            }
          }
        } else if (msg.type === 'result') {
          const resultMsg = msg as SDKResultMessage;
          if (resultMsg.subtype !== 'success') {
            emit('error', { error: `Session run ended: ${resultMsg.subtype}` });
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      emit('error', { error: errorMsg });
    }
    emit('lifecycle', { phase: 'end' });
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      const sessions = await sdkListSessions();
      return sessions.map((s) => ({
        sessionId: s.sessionId,
        summary: s.summary,
        lastModified: s.lastModified,
        cwd: s.cwd,
        gitBranch: s.gitBranch,
        createdAt: s.createdAt,
      }));
    } catch (err) {
      console.error('[Claude] Failed to list sessions:', err);
      return [];
    }
  }

  async stop(handle: AgentHandle): Promise<void> {
    const entry = this.handles.get(handle.configId);
    if (entry) {
      entry.abort.abort();
      this.handles.delete(handle.configId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.handles) {
      entry.abort.abort();
    }
    this.handles.clear();
  }
}

/** Extract session_id from an SDK init message.
 *  TS SDK puts it directly on the message; Python SDK nests it under `data`. Handle both. */
function extractSessionId(raw: Record<string, unknown>): string | undefined {
  // Direct property (TypeScript SDK)
  if (typeof raw.session_id === 'string') return raw.session_id;
  // Nested under data (Python SDK / older versions)
  const data = raw.data as Record<string, unknown> | undefined;
  if (typeof data?.session_id === 'string') return data.session_id;
  return undefined;
}

/** Try to extract an agent config ID from a task description string */
function extractAgentId(desc: string | undefined): string {
  if (!desc) return 'subagent';
  const match = desc.match(/^\[?([a-z][\w-]*)\]?/i);
  return match?.[1] ?? 'subagent';
}
