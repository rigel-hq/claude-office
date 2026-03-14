'use client';

import { useRef, useEffect } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { ChatInput } from './chat-input';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel({ onSend }: { onSend: (message: string) => void }) {
  const messages = useAgentStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full bg-rigel-surface border-l border-rigel-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-rigel-border">
        <h2 className="text-sm font-semibold text-rigel-text">Chat</h2>
        <p className="text-xs text-rigel-muted mt-0.5">Talk to CEA and your agents</p>
      </div>

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

      {/* Input */}
      <ChatInput onSend={onSend} />
    </div>
  );
}
