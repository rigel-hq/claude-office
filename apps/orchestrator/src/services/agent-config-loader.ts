import type { AgentConfig } from '@rigelhq/shared';
import { AGENT_CONFIGS, AGENT_CONFIG_MAP } from '@rigelhq/shared';

export class AgentConfigLoader {
  /** Get the full config for an agent by ID */
  getConfig(agentId: string): AgentConfig | undefined {
    return AGENT_CONFIG_MAP.get(agentId);
  }

  /** Get all configs */
  getAllConfigs(): AgentConfig[] {
    return AGENT_CONFIGS;
  }

  /** Get only MVP/always-active agents */
  getActiveConfigs(): AgentConfig[] {
    return AGENT_CONFIGS.filter(c => c.status === 'always_active');
  }

  /** Generate a system prompt string from an agent config for use with Claude Agent SDK */
  generateSystemPrompt(agentId: string): string {
    const config = AGENT_CONFIG_MAP.get(agentId);
    if (!config) {
      throw new Error(`No agent config found for ID: ${agentId}`);
    }

    const sections: string[] = [];

    // Identity
    sections.push(`You are ${config.name}, the ${config.role} at RigelHQ.`);

    // Self-awareness for consultation
    sections.push(`Your agent ID is \`${agentId}\`. Do not consult yourself.`);

    // Background
    sections.push(`## Background\n${config.persona.background}`);

    // Communication Style
    sections.push(`## Communication Style\n${config.persona.communication_style}`);

    // Core Principles
    sections.push(
      `## Core Principles\n${config.persona.principles.map(p => `- ${p}`).join('\n')}`,
    );

    // Responsibilities
    sections.push(
      `## Responsibilities\n${config.core_responsibilities.map(r => `- ${r}`).join('\n')}`,
    );

    // Technical Capabilities
    const capLines: string[] = [];
    if (config.capabilities.languages?.length) {
      capLines.push(`Languages: ${config.capabilities.languages.join(', ')}`);
    }
    if (config.capabilities.frameworks?.length) {
      capLines.push(`Frameworks: ${config.capabilities.frameworks.join(', ')}`);
    }
    capLines.push(`Domains: ${config.capabilities.domains.join(', ')}`);
    sections.push(`## Technical Capabilities\n${capLines.join('\n')}`);

    // Collaboration
    const collabLines: string[] = [];
    collabLines.push(`You report to: ${config.collaboration.reports_to}`);
    if (config.collaboration.works_closely_with?.length) {
      collabLines.push(
        `You work closely with: ${config.collaboration.works_closely_with.join(', ')}`,
      );
    }
    if (config.collaboration.manages?.length) {
      collabLines.push(`You manage: ${config.collaboration.manages.join(', ')}`);
    }
    sections.push(`## Collaboration\n${collabLines.join('\n')}`);

    // Quality Standards
    sections.push(
      `## Quality Standards\n${config.quality_standards.map(s => `- ${s}`).join('\n')}`,
    );

    // Red Flags (optional)
    if (config.red_flags?.length) {
      sections.push(
        `## Red Flags to Watch For\n${config.red_flags.map(f => `- ${f}`).join('\n')}`,
      );
    }

    // Self-protection: prevent agents from killing the orchestrator
    sections.push(
      `## CRITICAL SAFETY RULES
- You are running inside the RigelHQ orchestrator process (PID: ${process.pid}, port: 4000)
- NEVER terminate, kill, restart, or stop the orchestrator process
- NEVER run commands like: kill, pkill, killall, or any signal-sending command targeting PID ${process.pid} or port 4000
- NEVER run: lsof -ti:4000, fuser 4000/tcp, or similar commands piped to kill/xargs
- NEVER run: process.exit(), pm2 restart/stop/delete, systemctl stop/restart on the orchestrator
- If a user asks you to restart or stop the orchestrator, respond that this requires manual intervention by the operator
- Violating these rules will crash the entire multi-agent system and disrupt all active sessions`,
    );

    // Peer consultation
    sections.push(
      `## Peer Consultation
When you need expertise outside your domain, you can request help from another specialist by including this marker in your response:

\`[CONSULT:agent-id] Your question or request here\`

Available specialists you can consult:
- backend-engineer: APIs, databases, server logic
- frontend-engineer: React, CSS, UI components
- devops-engineer: CI/CD, Docker, deployment, git
- technical-architect: System design, architecture decisions
- qa-tester: Testing strategy, test cases
- security-engineer: Security audits, vulnerability assessment
- dba-engineer: Database schema, queries, optimization
- infra-engineer: Cloud infrastructure, networking
- ux-designer: User experience, design patterns
- product-manager: Requirements clarification, priorities

Example: If you are the backend-engineer and need frontend help:
\`[CONSULT:frontend-engineer] What React component pattern should I use for real-time WebSocket data display?\`

The orchestrator will route your question to the specialist and return their answer. Only use this when the task genuinely requires cross-domain expertise.`,
    );

    // General guidelines
    sections.push(
      `## Important
- Always communicate findings clearly and professionally
- Coordinate with other agents through the CEA when cross-team work is needed
- Focus on your area of expertise and delegate outside your domain`,
    );

    return sections.join('\n\n');
  }

  /** Get the allowed tools list for an agent */
  getAllowedTools(agentId: string): string[] {
    const config = AGENT_CONFIG_MAP.get(agentId);
    if (!config) {
      return [];
    }
    return config.capabilities.tools;
  }
}

export const agentConfigLoader = new AgentConfigLoader();
