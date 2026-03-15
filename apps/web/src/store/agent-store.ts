'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { AgentStatus, AgentEvent } from '@rigelhq/shared';
import { AGENT_ROLES } from '@rigelhq/shared';

enableMapSet();

// Zone layout positions for 1200x700 office floor
const ZONE_POSITIONS: Record<string, { baseX: number; baseY: number }> = {
  executive: { baseX: 130, baseY: 130 },
  engineering: { baseX: 700, baseY: 130 },
  quality: { baseX: 130, baseY: 470 },
  ops: { baseX: 700, baseY: 470 },
};

export interface AgentState {
  configId: string;
  name: string;
  icon: string;
  role: string;
  zone: string;
  status: AgentStatus;
  mvpActive: boolean;
  position: { x: number; y: number };
  currentTool: string | null;
  speechBubble: string | null;
  speechTimeout: ReturnType<typeof setTimeout> | null;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  agentId?: string;
  agentName?: string;
  content: string;
  timestamp: number;
}

interface AgentStore {
  agents: Map<string, AgentState>;
  messages: ChatMessage[];
  events: AgentEvent[];
  connected: boolean;

  // Actions
  initAgents: () => void;
  handleEvent: (event: AgentEvent) => void;
  setConnected: (connected: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  addEvent: (event: AgentEvent) => void;
  updateAgentStatus: (configId: string, status: AgentStatus) => void;
}

export const useAgentStore = create<AgentStore>()(
  immer((set) => ({
    agents: new Map(),
    messages: [],
    events: [],
    connected: false,

    initAgents: () => {
      set((state) => {
        const zoneCounters: Record<string, number> = {};

        for (const role of AGENT_ROLES) {
          const zone = role.zone;
          zoneCounters[zone] = (zoneCounters[zone] ?? 0) + 1;
          const idx = zoneCounters[zone];
          const base = ZONE_POSITIONS[zone] ?? { baseX: 300, baseY: 300 };

          // Grid layout within zone: 3 columns, desk spacing
          const col = (idx - 1) % 3;
          const row = Math.floor((idx - 1) / 3);

          state.agents.set(role.id, {
            configId: role.id,
            name: role.name,
            icon: role.icon,
            role: role.role,
            zone,
            status: 'OFFLINE',
            mvpActive: role.mvpActive,
            position: {
              x: base.baseX + col * 180,
              y: base.baseY + row * 120,
            },
            currentTool: null,
            speechBubble: null,
            speechTimeout: null,
          });
        }
      });
    },

    handleEvent: (event: AgentEvent) => {
      set((state) => {
        // Push to activity feed (keep last 100)
        state.events.push(event);
        if (state.events.length > 100) {
          state.events = state.events.slice(-100);
        }

        const agent = state.agents.get(event.agentId);
        if (!agent) return;

        switch (event.stream) {
          case 'lifecycle':
            if (event.data.phase === 'start' || event.data.phase === 'thinking') {
              agent.status = 'THINKING';
              agent.currentTool = null;
              agent.speechBubble = null;
            } else if (event.data.phase === 'end') {
              agent.status = 'IDLE';
              agent.currentTool = null;
              agent.speechBubble = null;
            }
            break;

          case 'tool':
            if (event.data.phase === 'start') {
              agent.status = 'TOOL_CALLING';
              agent.currentTool = (event.data.tool as string) ?? null;
            } else {
              agent.status = 'THINKING';
              agent.currentTool = null;
            }
            break;

          case 'assistant':
            agent.status = 'SPEAKING';
            agent.speechBubble = ((event.data.text as string) ?? '').slice(0, 80);
            break;

          case 'error':
            agent.status = 'ERROR';
            agent.speechBubble = (event.data.error as string) ?? 'Error';
            break;
        }
      });
    },

    setConnected: (connected) => {
      set((state) => {
        state.connected = connected;
      });
    },

    addMessage: (message) => {
      set((state) => {
        state.messages.push(message);
        // Keep last 200 messages
        if (state.messages.length > 200) {
          state.messages = state.messages.slice(-200);
        }
      });
    },

    addEvent: (event) => {
      set((state) => {
        state.events.push(event);
        if (state.events.length > 100) {
          state.events = state.events.slice(-100);
        }
      });
    },

    updateAgentStatus: (configId, status) => {
      set((state) => {
        const agent = state.agents.get(configId);
        if (agent) agent.status = status;
      });
    },
  })),
);
