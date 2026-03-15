'use client';

import { useRef, useEffect, useState } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { AGENT_ROLES } from '@rigelhq/shared';
import { ChatInput } from './chat-input';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatPanelProps {
  onSend: (message: string, targetAgent?: string) => void;
}

export function ChatPanel({ onSend }: ChatPanelProps) {
  const messages = useAgentStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedAgent, setSelectedAgent] = useState('cea');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = (content: string) => {
    onSend(content, selectedAgent === 'cea' ? undefined : selectedAgent);
  };

  return (
    <div className="flex flex-col h-full bg-rigel-surface">

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-rigel-muted text-center mt-8">
            No messages yet. Send a message to get started.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-0.5 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            {msg.sender === 'agent' && msg.agentName && (
              <span className="text-[10px] text-rigel-purple font-medium">{msg.agentName}</span>
            )}
            <div
              className={`px-3 py-1.5 rounded-lg text-xs max-w-[85%] ${
                msg.sender === 'user'
                  ? 'bg-rigel-blue text-rigel-bg'
                  : msg.sender === 'system'
                    ? 'bg-rigel-border text-rigel-muted'
                    : 'bg-rigel-bg text-rigel-text border border-rigel-border'
              }`}
            >
              {msg.content}
            </div>
            <span className="text-[10px] text-rigel-muted">{formatTime(msg.timestamp)}</span>
          </div>
        ))}
      </div>

      {/* Input with agent selector */}
      <ChatInput
        onSend={handleSend}
        agents={AGENT_ROLES}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
      />
    </div>
  );
}
