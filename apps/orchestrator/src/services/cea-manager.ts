import type { AgentManager } from './agent-manager.js';
import type { TaskManager } from './task-manager.js';
import type { EventBus } from './event-bus.js';
import type { AgentHandle } from '../adapters/adapter.js';
import { AGENT_ROLES, AGENT_CONFIGS } from '@rigelhq/shared';

const CEA_CONFIG_ID = 'cea';

// Build a rich system prompt from the CEA config + full agent roster
const ceaConfig = AGENT_CONFIGS.find(c => c.id === 'cea');
const CEA_SYSTEM_PROMPT = `You are the Chief Executive Agent (CEA) of RigelHQ, an AI-powered command center.
${ceaConfig?.persona.background ?? 'You are a seasoned technology executive with deep expertise in multi-agent orchestration.'}

## Communication Style
${ceaConfig?.persona.communication_style ?? 'Direct, strategic, and decisive.'}

## Core Principles
${ceaConfig?.persona.principles.map(p => `- ${p}`).join('\n') ?? '- Lead with clarity and purpose'}

## Your Team
You orchestrate a team of 21 specialist agents. When a user gives you a task:
1. Analyze the request and break it into subtasks
2. Delegate to the appropriate specialist agent(s) using the Agent tool
3. Always prefix Agent tool prompts with the agent config ID in brackets, e.g., [backend-engineer] Build the REST API...
4. Review agent outputs before reporting back to the user
5. Coordinate between agents when tasks require collaboration

Available agents:
${AGENT_ROLES.map(r => {
  const cfg = AGENT_CONFIGS.find(c => c.id === r.id);
  const triggers = cfg?.collaboration?.triggers?.join(', ') ?? r.role;
  return `- [${r.id}] ${r.name} (${r.role}) — triggers: ${triggers}`;
}).join('\n')}

## Quality Standards
${ceaConfig?.quality_standards.map(q => `- ${q}`).join('\n') ?? '- Ensure high quality outputs'}
`;

export class CEAManager {
  private handle: AgentHandle | null = null;
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

    this.handle = await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      'You are now active. Acknowledge and wait for user instructions.',
    );

    this.healthy = true;
    console.log('[CEA] CEA is active and ready');

    // Process any queued messages
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      await this.sendMessage(msg);
    }
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.healthy || !this.handle) {
      console.log('[CEA] Not healthy, queueing message');
      this.messageQueue.push(content);
      return;
    }

    // For the mock adapter, spawn a new "CEA run" for each message
    // The real Claude adapter would use session resumption
    await this.agentManager.spawnAgent(
      CEA_CONFIG_ID,
      CEA_SYSTEM_PROMPT,
      content,
    );
  }

  async stop(): Promise<void> {
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
