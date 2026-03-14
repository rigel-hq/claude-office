'use client';

import { useAgentStore } from '@/store/agent-store';
import { AgentAvatar } from './agent-avatar';
import { ZoneLabel } from './zone-label';

export function OfficeFloor() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <svg
      viewBox="0 0 860 620"
      className="w-full h-full"
      style={{ background: '#0f1419' }}
    >
      {/* Grid background */}
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#161b22" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="860" height="620" fill="url(#grid)" />

      {/* Zone boundaries */}
      {/* Executive Wing — top left */}
      <rect x={40} y={50} width={350} height={240} rx={12} fill="#161b22" fillOpacity={0.5} stroke="#30363d" strokeWidth={1} />
      <ZoneLabel x={55} y={75} label="Executive Wing" />

      {/* Engineering Floor — top right */}
      <rect x={420} y={50} width={400} height={240} rx={12} fill="#161b22" fillOpacity={0.5} stroke="#30363d" strokeWidth={1} />
      <ZoneLabel x={435} y={75} label="Engineering Floor" />

      {/* Quality Lab — bottom left */}
      <rect x={40} y={330} width={350} height={240} rx={12} fill="#161b22" fillOpacity={0.5} stroke="#30363d" strokeWidth={1} />
      <ZoneLabel x={55} y={355} label="Quality Lab" />

      {/* Ops Center — bottom right */}
      <rect x={420} y={330} width={400} height={240} rx={12} fill="#161b22" fillOpacity={0.5} stroke="#30363d" strokeWidth={1} />
      <ZoneLabel x={435} y={355} label="Ops Center" />

      {/* Central corridor / meeting area */}
      <line x1={215} y1={295} x2={620} y2={295} stroke="#30363d" strokeWidth={1} strokeDasharray="8 4" opacity={0.4} />

      {/* Agent avatars */}
      {[...agents.values()].map((agent) => (
        <AgentAvatar key={agent.configId} agent={agent} />
      ))}
    </svg>
  );
}
