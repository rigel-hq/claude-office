import type { AgentEvent } from '@rigelhq/shared';

/** Summary of a Claude session discovered on this machine */
export interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  cwd?: string;
  gitBranch?: string;
  createdAt?: number;
}

export interface AgentHandle {
  id: string;
  configId: string;
  pid: number | null;
  sessionId: string | null;
  /** Tools this agent was spawned with — preserved across resume */
  allowedTools?: string[];
  /** Subagent definitions — preserved so resumed sessions keep named specialists */
  agents?: Record<string, SubagentDef>;
  /** Working directory for this agent's session */
  cwd?: string;
  stop(): Promise<void>;
}

export type AgentEventCallback = (event: AgentEvent) => void | Promise<void>;

/** Subagent definition passed to the SDK's agents option */
export interface SubagentDef {
  description: string;
  prompt: string;
  tools?: string[];
}

export interface SpawnOptions {
  /** Subagent definitions that this agent can delegate to via the Agent tool */
  agents?: Record<string, SubagentDef>;
  /** Override the default allowed tools list */
  allowedTools?: string[];
  /** Load user/project settings (MCP servers, plugins, CLAUDE.md, etc.) */
  settingSources?: Array<'user' | 'project' | 'local'>;
  /** MCP server configurations to make available */
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> } | { type: 'sse' | 'http'; url: string; headers?: Record<string, string> }>;
}

export interface GatewayAdapter {
  spawn(
    configId: string,
    systemPrompt: string,
    taskPrompt: string,
    onEvent: AgentEventCallback,
    options?: SpawnOptions,
  ): Promise<AgentHandle>;

  /** Send a follow-up message to an existing session */
  sendMessage(
    handle: AgentHandle,
    message: string,
    onEvent: AgentEventCallback,
  ): Promise<void>;

  /** List all Claude sessions on this machine */
  listSessions(): Promise<SessionInfo[]>;

  /** Send a message to any session by ID (not just managed ones) */
  sendToSession(sessionId: string, message: string, onEvent: AgentEventCallback): Promise<void>;

  /** Interrupt any in-progress query for this config (steer, not kill) */
  interrupt(configId: string): Promise<void>;

  stop(handle: AgentHandle): Promise<void>;
  stopAll(): Promise<void>;
}
