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
