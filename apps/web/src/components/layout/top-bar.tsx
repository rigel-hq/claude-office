'use client';

import { useAgentStore } from '@/store/agent-store';

export function TopBar() {
  const agents = useAgentStore((s) => s.agents);
  const connected = useAgentStore((s) => s.connected);

  const activeCount = [...agents.values()].filter((a) => a.status !== 'OFFLINE').length;
  const totalCount = agents.size;
  const thinkingCount = [...agents.values()].filter((a) => a.status === 'THINKING').length;
  const errorCount = [...agents.values()].filter((a) => a.status === 'ERROR').length;

  return (
    <header className="flex items-center justify-between px-5 py-2.5 bg-rigel-surface border-b border-rigel-border">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <span className="text-xl">⬡</span>
        <span className="text-base font-bold text-rigel-blue tracking-tight">RigelHQ</span>
        <span className="text-xs text-rigel-muted ml-1">Command Center</span>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-5 text-xs">
        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-rigel-green animate-pulse' : 'bg-rigel-red'}`} />
          <span className="text-rigel-muted">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Agent stats */}
        <div className="flex items-center gap-3 text-rigel-muted">
          <span>
            <span className="text-rigel-green font-medium">{activeCount}</span>/{totalCount} active
          </span>
          {thinkingCount > 0 && (
            <span>
              <span className="text-rigel-blue font-medium">{thinkingCount}</span> thinking
            </span>
          )}
          {errorCount > 0 && (
            <span>
              <span className="text-rigel-red font-medium">{errorCount}</span> errors
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
