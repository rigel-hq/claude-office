'use client';

import { useState, useCallback } from 'react';
import type { AgentRoleMeta } from '@rigelhq/shared';

interface ChatInputProps {
  onSend: (message: string) => void;
  agents: AgentRoleMeta[];
  selectedAgent: string;
  onSelectAgent: (agentId: string) => void;
}

export function ChatInput({ onSend, agents, selectedAgent, onSelectAgent }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed) return;
      onSend(trimmed);
      setValue('');
    },
    [value, onSend],
  );

  const selectedMeta = agents.find((a) => a.id === selectedAgent);
  const placeholder = selectedAgent === 'cea'
    ? 'Send a message to CEA...'
    : `Message ${selectedMeta?.name ?? selectedAgent}...`;

  return (
    <div className="border-t border-rigel-border">
      {/* Agent selector */}
      <div className="px-3 pt-2 pb-1">
        <select
          value={selectedAgent}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="w-full text-xs bg-rigel-bg text-rigel-text border border-rigel-border rounded-md px-2 py-1.5 outline-none focus:border-rigel-blue cursor-pointer"
        >
          <option value="cea">Chief Executive Agent (default)</option>
          {agents
            .filter((a) => a.id !== 'cea')
            .map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.icon} {agent.name}
              </option>
            ))}
        </select>
      </div>

      {/* Message input */}
      <form onSubmit={handleSubmit} className="flex gap-2 px-3 pb-3 pt-1">
        <input
          type="text"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-rigel-bg border border-rigel-border rounded-lg px-3 py-2 text-sm text-rigel-text placeholder-rigel-muted focus:outline-none focus:border-rigel-blue"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-4 py-2 bg-rigel-blue text-rigel-bg rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Send
        </button>
      </form>
    </div>
  );
}
