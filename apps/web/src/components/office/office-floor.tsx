'use client';

import { useAgentStore } from '@/store/agent-store';
import { AgentAvatar } from './agent-avatar';

// ── Furniture sub-components ──────────────────────────────────

function DeskUnit({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {/* Desk surface */}
      <rect x={x - 36} y={y - 50} width={72} height={30} rx={3}
        fill="#1e293b" stroke="#334155" strokeWidth={0.5} />
      {/* Monitor */}
      <rect x={x - 10} y={y - 46} width={20} height={14} rx={1.5}
        fill="#0f172a" stroke="#475569" strokeWidth={0.4} />
      {/* Screen glow */}
      <rect x={x - 8} y={y - 44} width={16} height={10} rx={1}
        fill="#1e3a5f" opacity={0.4} />
      {/* Keyboard */}
      <rect x={x - 8} y={y - 28} width={16} height={5} rx={1}
        fill="#1e293b" stroke="#334155" strokeWidth={0.3} />
      {/* Chair */}
      <ellipse cx={x} cy={y + 36} rx={14} ry={10}
        fill="#1a1a2e" stroke="#334155" strokeWidth={0.4} />
      {/* Chair back */}
      <rect x={x - 10} y={y + 26} width={20} height={6} rx={3}
        fill="#1e1e38" stroke="#334155" strokeWidth={0.3} />
    </g>
  );
}

function MeetingTable({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {/* Circular table */}
      <circle cx={x} cy={y} r={28} fill="#1e293b" stroke="#334155" strokeWidth={0.5} />
      {/* Table center marker */}
      <circle cx={x} cy={y} r={4} fill="#0f172a" opacity={0.3} />
      {/* Chairs around table */}
      {[0, 60, 120, 180, 240, 300].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const cx = x + Math.cos(rad) * 40;
        const cy = y + Math.sin(rad) * 40;
        return (
          <ellipse key={angle} cx={cx} cy={cy} rx={8} ry={6}
            fill="#1a1a2e" stroke="#334155" strokeWidth={0.3}
            transform={`rotate(${angle}, ${cx}, ${cy})`} />
        );
      })}
    </g>
  );
}

function Sofa({ x, y, flip }: { x: number; y: number; flip?: boolean }) {
  const s = flip ? -1 : 1;
  return (
    <g transform={`translate(${x}, ${y}) scale(${s}, 1)`}>
      {/* Back rest */}
      <rect x={-22} y={-12} width={44} height={8} rx={4}
        fill="#2d1b4e" stroke="#4a2d7a" strokeWidth={0.4} />
      {/* Seat cushions */}
      <rect x={-20} y={-4} width={18} height={14} rx={3}
        fill="#3b2069" stroke="#4a2d7a" strokeWidth={0.3} />
      <rect x={2} y={-4} width={18} height={14} rx={3}
        fill="#3b2069" stroke="#4a2d7a" strokeWidth={0.3} />
      {/* Arm rests */}
      <rect x={-26} y={-8} width={6} height={20} rx={3}
        fill="#2d1b4e" stroke="#4a2d7a" strokeWidth={0.3} />
      <rect x={20} y={-8} width={6} height={20} rx={3}
        fill="#2d1b4e" stroke="#4a2d7a" strokeWidth={0.3} />
    </g>
  );
}

function Plant({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  const s = size;
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Pot */}
      <rect x={-6 * s} y={2 * s} width={12 * s} height={10 * s} rx={2}
        fill="#92400e" stroke="#78350f" strokeWidth={0.4} />
      {/* Soil */}
      <ellipse cx={0} cy={2 * s} rx={6 * s} ry={2 * s}
        fill="#451a03" />
      {/* Leaves */}
      <ellipse cx={-4 * s} cy={-6 * s} rx={6 * s} ry={8 * s}
        fill="#166534" opacity={0.8} transform={`rotate(-15, ${-4 * s}, ${-6 * s})`} />
      <ellipse cx={4 * s} cy={-7 * s} rx={5 * s} ry={9 * s}
        fill="#15803d" opacity={0.75} transform={`rotate(12, ${4 * s}, ${-7 * s})`} />
      <ellipse cx={0} cy={-10 * s} rx={4 * s} ry={7 * s}
        fill="#16a34a" opacity={0.65} />
    </g>
  );
}

function WaterCooler({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Base */}
      <rect x={-8} y={4} width={16} height={14} rx={2}
        fill="#334155" stroke="#475569" strokeWidth={0.4} />
      {/* Tank */}
      <rect x={-6} y={-12} width={12} height={16} rx={6}
        fill="#93c5fd" opacity={0.3} stroke="#60a5fa" strokeWidth={0.4} />
      {/* Water level */}
      <rect x={-5} y={-6} width={10} height={10} rx={5}
        fill="#3b82f6" opacity={0.15} />
    </g>
  );
}

// ── Zone label ────────────────────────────────────────────────

function ZoneLabel({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <g>
      <rect x={x - 2} y={y - 10} width={label.length * 7.5 + 8} height={14} rx={3}
        fill={color} opacity={0.12} />
      <text x={x + 2} y={y} fill={color} fontSize={9} fontWeight="700"
        fontFamily="system-ui, sans-serif" letterSpacing="0.08em"
        opacity={0.8} style={{ textTransform: 'uppercase' } as React.CSSProperties}>
        {label}
      </text>
    </g>
  );
}

// ── Main office floor ─────────────────────────────────────────

export function OfficeFloor() {
  const agents = useAgentStore((s) => s.agents);
  const agentList = [...agents.values()];

  // Corridor dimensions
  const CX = 586; // vertical corridor left edge
  const CW = 28;  // corridor width
  const CY = 336; // horizontal corridor top edge

  return (
    <svg
      viewBox="0 0 1200 700"
      className="w-full h-full"
      style={{ background: '#0a0e14' }}
    >
      <defs>
        {/* Subtle floor tile pattern */}
        <pattern id="floor-tile" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" fill="#0d1117" />
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#161b22" strokeWidth={0.3} />
        </pattern>

        {/* Corridor tile pattern */}
        <pattern id="corridor-tile" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="28" height="28" fill="#0f172a" />
          <rect x={1} y={1} width={12} height={12} rx={1} fill="#111827" opacity={0.5} />
          <rect x={15} y={1} width={12} height={12} rx={1} fill="#111827" opacity={0.5} />
          <rect x={1} y={15} width={12} height={12} rx={1} fill="#111827" opacity={0.5} />
          <rect x={15} y={15} width={12} height={12} rx={1} fill="#111827" opacity={0.5} />
        </pattern>

        {/* Glow filter for active elements */}
        <filter id="zone-glow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ─── Layer 1: Base floor ─── */}
      <rect width="1200" height="700" fill="url(#floor-tile)" />

      {/* ─── Layer 2: Building shell (outer walls) ─── */}
      <rect x={8} y={8} width={1184} height={684} rx={6}
        fill="none" stroke="#334155" strokeWidth={2} />
      {/* Inner wall shadow */}
      <rect x={10} y={10} width={1180} height={680} rx={5}
        fill="none" stroke="#1e293b" strokeWidth={1} />

      {/* ─── Layer 3: Zone backgrounds ─── */}
      {/* Executive Wing (top-left) */}
      <rect x={14} y={14} width={CX - 14} height={CY - 14} rx={4}
        fill="#1a1028" opacity={0.35} />
      {/* Engineering Floor (top-right) */}
      <rect x={CX + CW} y={14} width={1186 - CX - CW} height={CY - 14} rx={4}
        fill="#0f1a2e" opacity={0.35} />
      {/* Quality Lab (bottom-left) */}
      <rect x={14} y={CY + CW} width={CX - 14} height={686 - CY - CW} rx={4}
        fill="#0f1e1a" opacity={0.35} />
      {/* Ops Center (bottom-right) */}
      <rect x={CX + CW} y={CY + CW} width={1186 - CX - CW} height={686 - CY - CW} rx={4}
        fill="#1e1a0f" opacity={0.35} />

      {/* Zone accent bars (top edge) */}
      <rect x={14} y={14} width={CX - 14} height={2.5} rx={1}
        fill="#a855f7" opacity={0.4} />
      <rect x={CX + CW} y={14} width={1186 - CX - CW} height={2.5} rx={1}
        fill="#3b82f6" opacity={0.4} />
      <rect x={14} y={CY + CW} width={CX - 14} height={2.5} rx={1}
        fill="#22c55e" opacity={0.4} />
      <rect x={CX + CW} y={CY + CW} width={1186 - CX - CW} height={2.5} rx={1}
        fill="#f97316" opacity={0.4} />

      {/* ─── Layer 4: Cross corridor ─── */}
      {/* Horizontal corridor */}
      <rect x={14} y={CY} width={1172} height={CW} fill="url(#corridor-tile)" />
      {/* Vertical corridor */}
      <rect x={CX} y={14} width={CW} height={672} fill="url(#corridor-tile)" />
      {/* Corridor center lines */}
      <line x1={14} y1={CY + CW / 2} x2={1186} y2={CY + CW / 2}
        stroke="#1e293b" strokeWidth={1} strokeDasharray="8 4" opacity={0.4} />
      <line x1={CX + CW / 2} y1={14} x2={CX + CW / 2} y2={686}
        stroke="#1e293b" strokeWidth={1} strokeDasharray="8 4" opacity={0.4} />

      {/* ─── Layer 5: Zone labels ─── */}
      <ZoneLabel x={28} y={38} label="Executive Wing" color="#a855f7" />
      <ZoneLabel x={CX + CW + 14} y={38} label="Engineering Floor" color="#3b82f6" />
      <ZoneLabel x={28} y={CY + CW + 24} label="Quality Lab" color="#22c55e" />
      <ZoneLabel x={CX + CW + 14} y={CY + CW + 24} label="Ops Center" color="#f97316" />

      {/* ─── Layer 6: Furniture ─── */}
      {/* Desks at each agent position */}
      {agentList.map((agent) => (
        <DeskUnit key={`desk-${agent.configId}`} x={agent.position.x} y={agent.position.y} />
      ))}

      {/* Meeting table in executive wing */}
      <MeetingTable x={460} y={230} />

      {/* Sofas in corridor rest areas */}
      <Sofa x={300} y={CY + CW / 2} />
      <Sofa x={900} y={CY + CW / 2} flip />

      {/* ─── Layer 7: Decorations ─── */}
      {/* Plants at corridor intersections */}
      <Plant x={CX - 20} y={CY - 20} size={1.2} />
      <Plant x={CX + CW + 20} y={CY - 20} size={1} />
      <Plant x={CX - 20} y={CY + CW + 20} size={1} />
      <Plant x={CX + CW + 20} y={CY + CW + 20} size={1.2} />

      {/* Corner plants */}
      <Plant x={30} y={50} size={0.8} />
      <Plant x={1170} y={50} size={0.8} />
      <Plant x={30} y={660} size={0.8} />
      <Plant x={1170} y={660} size={0.8} />

      {/* Water coolers */}
      <WaterCooler x={CX - 30} y={200} />
      <WaterCooler x={CX + CW + 30} y={520} />

      {/* ─── Layer 8: Agent avatars (topmost) ─── */}
      {agentList.map((agent) => (
        <AgentAvatar key={agent.configId} agent={agent} />
      ))}
    </svg>
  );
}
