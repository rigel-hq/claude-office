'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { AGENT_ROLE_MAP } from '@rigelhq/shared';
import type { AgentEvent } from '@rigelhq/shared';

const EVENT_COLORS: Record<string, string> = {
  thinking: 'text-rigel-blue',
  tool: 'text-rigel-orange',
  speaking: 'text-rigel-green',
  error: 'text-rigel-red',
  lifecycle: 'text-rigel-muted',
};

const EVENT_LABELS: Record<string, string> = {
  thinking: 'THINKING',
  tool: 'TOOL',
  speaking: 'SPEAKING',
  error: 'ERROR',
  lifecycle: 'LIFECYCLE',
};

function classifyEvent(event: AgentEvent): string {
  switch (event.stream) {
    case 'lifecycle':
      if (event.data.phase === 'thinking') return 'thinking';
      return 'lifecycle';
    case 'tool':
      return 'tool';
    case 'assistant':
      return 'speaking';
    case 'error':
      return 'error';
    default:
      return 'lifecycle';
  }
}

function summarizeEvent(event: AgentEvent, eventType: string): string {
  switch (eventType) {
    case 'thinking':
      return 'is thinking...';
    case 'lifecycle':
      if (event.data.phase === 'start') return 'started a run';
      if (event.data.phase === 'end') return 'finished';
      return `lifecycle: ${String(event.data.phase ?? 'unknown')}`;
    case 'tool': {
      const tool = event.data.tool ? String(event.data.tool) : 'unknown';
      if (event.data.phase === 'start') return `using tool: ${tool}`;
      return `finished tool: ${tool}`;
    }
    case 'speaking': {
      const text = event.data.text ? String(event.data.text).slice(0, 120) : '';
      return text || 'speaking...';
    }
    case 'error':
      return String(event.data.error ?? 'Unknown error').slice(0, 120);
    default:
      return JSON.stringify(event.data).slice(0, 80);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={`transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
    >
      <path
        d="M4 5L7 8L10 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ActivityFeed() {
  const events = useAgentStore((s) => s.events);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [agentFilter, setAgentFilter] = useState('all');

  // Derive unique agent IDs that have events, sorted by agent name
  const agentOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const event of events) {
      ids.add(event.agentId);
    }
    return Array.from(ids)
      .map((id) => {
        const meta = AGENT_ROLE_MAP.get(id);
        return { id, name: meta?.name ?? id };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [events]);

  // Filter events by selected agent
  const filteredEvents = useMemo(() => {
    if (agentFilter === 'all') return events;
    return events.filter((e) => e.agentId === agentFilter);
  }, [events, agentFilter]);

  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredEvents.length, collapsed]);

  return (
    <div className="flex flex-col h-full bg-rigel-surface border-t border-rigel-border">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-rigel-border flex-shrink-0">
        {/* Left: title + count */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-rigel-muted uppercase tracking-wider whitespace-nowrap">
            Activity Feed
          </span>
          <span className="text-xs text-rigel-muted whitespace-nowrap">
            ({filteredEvents.length})
          </span>
        </div>

        {/* Right: filter + collapse toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="text-xs bg-rigel-bg text-rigel-text border border-rigel-border rounded px-1.5 py-0.5 outline-none focus:border-rigel-blue cursor-pointer"
          >
            <option value="all">All Agents</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCollapsed((prev) => !prev)}
            className="text-rigel-muted hover:text-rigel-text transition-colors p-0.5"
            aria-label={collapsed ? 'Expand activity feed' : 'Collapse activity feed'}
          >
            <ChevronIcon collapsed={collapsed} />
          </button>
        </div>
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs leading-5">
          {filteredEvents.length === 0 && (
            <div className="text-rigel-muted py-4 text-center">
              {agentFilter === 'all'
                ? 'No events yet. Waiting for agent activity...'
                : 'No events for this agent.'}
            </div>
          )}
          {filteredEvents.map((event) => {
            const eventType = classifyEvent(event);
            const colorClass = EVENT_COLORS[eventType] ?? 'text-rigel-muted';
            const label = EVENT_LABELS[eventType] ?? 'EVENT';
            const meta = AGENT_ROLE_MAP.get(event.agentId);
            const icon = meta?.icon ?? '?';
            const name = meta?.name ?? event.agentId;
            const summary = summarizeEvent(event, eventType);

            return (
              <div key={event.id} className="flex items-baseline gap-1.5 truncate">
                <span className="text-rigel-muted flex-shrink-0">
                  {formatTime(event.timestamp)}
                </span>
                <span className="flex-shrink-0">{icon}</span>
                <span className="text-rigel-text font-medium flex-shrink-0 max-w-[140px] truncate">
                  {name}
                </span>
                <span className={`flex-shrink-0 font-semibold ${colorClass}`}>
                  [{label}]
                </span>
                <span className="text-rigel-muted truncate">
                  {summary}
                </span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
