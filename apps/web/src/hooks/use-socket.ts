'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAgentStore } from '@/store/agent-store';
import type { AgentEvent } from '@rigelhq/shared';

const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const { handleEvent, setConnected, addMessage, initAgents } = useAgentStore();

  useEffect(() => {
    // Initialize agent positions on mount
    initAgents();

    const socket = io(ORCHESTRATOR_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected to orchestrator');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected from orchestrator');
      setConnected(false);
    });

    // Receive event history on connect
    socket.on('event:history', (events: AgentEvent[]) => {
      for (const event of events) {
        handleEvent(event);
      }
    });

    // Real-time agent events
    socket.on('agent:event', (event: AgentEvent) => {
      handleEvent(event);

      // Add assistant text to chat
      if (event.stream === 'assistant' && event.data.text) {
        addMessage({
          id: event.id,
          sender: 'agent',
          agentId: event.agentId,
          agentName: event.agentId,
          content: event.data.text as string,
          timestamp: event.timestamp,
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = (content: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat:message', { content });
      addMessage({
        id: `user-${Date.now()}`,
        sender: 'user',
        content,
        timestamp: Date.now(),
      });
    }
  };

  return { sendMessage };
}
