'use client';

import { motion } from 'framer-motion';
import type { AgentState } from '@/store/agent-store';

// Each "pixel" in our pixel-art characters
const PX = 2.5;

const STATUS_COLORS: Record<string, string> = {
  OFFLINE: '#30363d',
  IDLE: '#3fb950',
  THINKING: '#58a6ff',
  TOOL_CALLING: '#f0883e',
  SPEAKING: '#d2a8ff',
  COLLABORATING: '#56d4dd',
  ERROR: '#f85149',
};

const ZONE_OUTFIT: Record<string, string> = {
  executive: '#7c3aed',
  engineering: '#2563eb',
  quality: '#059669',
  ops: '#d97706',
};

// ── Character appearance per agent ────────────────────────────
interface Look {
  hair: string;
  style: 'crew' | 'long' | 'spiky' | 'bob' | 'mohawk' | 'bun' | 'cap' | 'curly';
  skin: string;
  accent?: 'glasses' | 'headphones';
}

const LOOKS: Record<string, Look> = {
  'cea':                  { hair: '#c084fc', style: 'crew',   skin: '#f5d0a9', accent: 'glasses' },
  'backend-engineer':     { hair: '#475569', style: 'crew',   skin: '#c68642' },
  'frontend-engineer':    { hair: '#fb7185', style: 'long',   skin: '#f5d0a9' },
  'app-developer':        { hair: '#38bdf8', style: 'spiky',  skin: '#d4a574' },
  'product-manager':      { hair: '#a0522d', style: 'bob',    skin: '#f5d0a9', accent: 'glasses' },
  'ux-designer':          { hair: '#e879f9', style: 'bun',    skin: '#8d5524' },
  'qa-tester':            { hair: '#22d3ee', style: 'crew',   skin: '#c68642' },
  'automation-qa-tester': { hair: '#4ade80', style: 'mohawk',  skin: '#f5d0a9' },
  'load-tester':          { hair: '#f97316', style: 'curly',  skin: '#d4a574' },
  'sre-engineer':         { hair: '#64748b', style: 'cap',    skin: '#8d5524' },
  'infra-engineer':       { hair: '#a78bfa', style: 'spiky',  skin: '#f5d0a9' },
  'dba-engineer':         { hair: '#94a3b8', style: 'crew',   skin: '#c68642', accent: 'glasses' },
  'platform-engineer':    { hair: '#2dd4bf', style: 'mohawk',  skin: '#d4a574' },
  'devops-engineer':      { hair: '#34d399', style: 'spiky',  skin: '#f5d0a9', accent: 'headphones' },
  'noc-engineer':         { hair: '#fbbf24', style: 'curly',  skin: '#8d5524', accent: 'headphones' },
  'operations-engineer':  { hair: '#fb923c', style: 'crew',   skin: '#c68642' },
  'projects-manager':     { hair: '#818cf8', style: 'bob',    skin: '#f5d0a9' },
  'security-engineer':    { hair: '#1e293b', style: 'cap',    skin: '#d4a574', accent: 'glasses' },
  'code-review-engineer': { hair: '#6366f1', style: 'long',   skin: '#c68642' },
  'technical-architect':  { hair: '#e2e8f0', style: 'crew',   skin: '#f5d0a9', accent: 'glasses' },
  'github-repos-owner':   { hair: '#a3e635', style: 'curly',  skin: '#8d5524' },
};

const DEFAULT_LOOK: Look = { hair: '#94a3b8', style: 'crew', skin: '#f5d0a9' };

// ── Hair styles ───────────────────────────────────────────────
function Hair({ style, color }: { style: string; color: string }) {
  const hw = 7 * PX; // head width
  const hx = -hw / 2;
  const top = -11 * PX; // top of head y

  switch (style) {
    case 'crew':
      return (
        <g>
          <rect x={hx - PX * 0.5} y={top - 2 * PX} width={hw + PX} height={2.5 * PX} fill={color} />
        </g>
      );
    case 'long':
      return (
        <g>
          <rect x={hx - PX} y={top - 2 * PX} width={hw + 2 * PX} height={2.5 * PX} fill={color} />
          <rect x={hx - PX} y={top} width={1.5 * PX} height={5 * PX} fill={color} />
          <rect x={hx + hw - PX * 0.5} y={top} width={1.5 * PX} height={5 * PX} fill={color} />
        </g>
      );
    case 'spiky':
      return (
        <g>
          <rect x={hx} y={top - 1.5 * PX} width={hw} height={2 * PX} fill={color} />
          <rect x={-PX} y={top - 4 * PX} width={2 * PX} height={2.5 * PX} fill={color} />
          <rect x={-4 * PX} y={top - 3 * PX} width={2 * PX} height={2 * PX} fill={color} />
          <rect x={2 * PX} y={top - 3 * PX} width={2 * PX} height={2 * PX} fill={color} />
        </g>
      );
    case 'bob':
      return (
        <g>
          <rect x={hx - PX} y={top - 2 * PX} width={hw + 2 * PX} height={3 * PX} fill={color} />
          <rect x={hx - PX} y={top + PX} width={2 * PX} height={3 * PX} fill={color} />
          <rect x={hx + hw - PX} y={top + PX} width={2 * PX} height={3 * PX} fill={color} />
        </g>
      );
    case 'mohawk':
      return (
        <g>
          <rect x={-2 * PX} y={top - 5 * PX} width={4 * PX} height={6 * PX} fill={color} />
        </g>
      );
    case 'bun':
      return (
        <g>
          <rect x={hx} y={top - 1.5 * PX} width={hw} height={2 * PX} fill={color} />
          <rect x={-2 * PX} y={top - 4.5 * PX} width={4 * PX} height={3 * PX} rx={PX} fill={color} />
        </g>
      );
    case 'cap':
      return (
        <g>
          <rect x={hx - 2 * PX} y={top - 1.5 * PX} width={hw + 4 * PX} height={2 * PX} fill={color} />
          <rect x={hx} y={top - 2.5 * PX} width={hw} height={PX} fill={color} />
        </g>
      );
    case 'curly':
      return (
        <g>
          <rect x={hx - PX} y={top - 2 * PX} width={3 * PX} height={2.5 * PX} rx={PX} fill={color} />
          <rect x={-2 * PX} y={top - 3 * PX} width={3 * PX} height={3 * PX} rx={PX} fill={color} />
          <rect x={hx + hw - 2 * PX} y={top - 2 * PX} width={3 * PX} height={2.5 * PX} rx={PX} fill={color} />
        </g>
      );
    default:
      return <rect x={hx} y={top - 2 * PX} width={hw} height={2.5 * PX} fill={color} />;
  }
}

// ── Accessories ───────────────────────────────────────────────
function Accessory({ type }: { type: string }) {
  switch (type) {
    case 'glasses':
      return (
        <g>
          <rect x={-6 * PX} y={-9 * PX} width={4 * PX} height={2.5 * PX} rx={PX * 0.4}
            fill="none" stroke="#c9d1d9" strokeWidth={0.7} />
          <rect x={2 * PX} y={-9 * PX} width={4 * PX} height={2.5 * PX} rx={PX * 0.4}
            fill="none" stroke="#c9d1d9" strokeWidth={0.7} />
          <line x1={-2 * PX} y1={-7.8 * PX} x2={2 * PX} y2={-7.8 * PX}
            stroke="#c9d1d9" strokeWidth={0.5} />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <path
            d={`M ${-4 * PX} ${-10 * PX} Q ${-5 * PX} ${-13 * PX} 0 ${-13.5 * PX} Q ${5 * PX} ${-13 * PX} ${4 * PX} ${-10 * PX}`}
            fill="none" stroke="#6b7280" strokeWidth={1.5}
          />
          <rect x={-5 * PX} y={-10.5 * PX} width={2.5 * PX} height={3 * PX} rx={PX * 0.4} fill="#4b5563" />
          <rect x={2.5 * PX} y={-10.5 * PX} width={2.5 * PX} height={3 * PX} rx={PX * 0.4} fill="#4b5563" />
        </g>
      );
    default:
      return null;
  }
}

// ── Main avatar component ─────────────────────────────────────
export function AgentAvatar({ agent }: { agent: AgentState }) {
  const look = LOOKS[agent.configId] ?? DEFAULT_LOOK;
  const color = STATUS_COLORS[agent.status] ?? '#30363d';
  const outfit = ZONE_OUTFIT[agent.zone] ?? '#4b5563';
  const isActive = agent.status !== 'OFFLINE';
  const isWorking = ['THINKING', 'TOOL_CALLING', 'SPEAKING', 'COLLABORATING'].includes(agent.status);

  // Dimensions in PX units
  const headW = 7 * PX;
  const headH = 4.5 * PX;
  const headX = -headW / 2;
  const headY = -11 * PX;

  const bodyW = 6 * PX;
  const bodyH = 3.5 * PX;
  const bodyX = -bodyW / 2;
  const bodyY = headY + headH;

  return (
    <g transform={`translate(${agent.position.x}, ${agent.position.y})`}>
      {/* Ground glow when working */}
      {isWorking && (
        <motion.ellipse
          cx={0} cy={4 * PX}
          rx={14 * PX} ry={6 * PX}
          fill={color} opacity={0.07}
          animate={{ opacity: [0.04, 0.1, 0.04], rx: [14 * PX, 15 * PX, 14 * PX] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* ── Chair (behind character) ── */}
      <rect
        x={-5 * PX} y={bodyY + bodyH - PX}
        width={10 * PX} height={PX}
        fill="#21262d"
      />
      <rect x={-5 * PX} y={bodyY} width={PX * 0.8} height={bodyH} fill="#21262d" />
      <rect x={4.2 * PX} y={bodyY} width={PX * 0.8} height={bodyH} fill="#21262d" />

      {/* ── Character body ── */}
      <rect
        x={bodyX} y={bodyY}
        width={bodyW} height={bodyH}
        fill={isActive ? outfit : '#2d333b'}
      />
      {/* Arms */}
      <rect x={bodyX - 1.5 * PX} y={bodyY + PX * 0.5} width={1.5 * PX} height={2 * PX}
        fill={isActive ? outfit : '#2d333b'} />
      <rect x={bodyX + bodyW} y={bodyY + PX * 0.5} width={1.5 * PX} height={2 * PX}
        fill={isActive ? outfit : '#2d333b'} />

      {/* ── Head ── */}
      <rect
        x={headX} y={headY}
        width={headW} height={headH}
        fill={look.skin}
      />

      {/* Eyes — pixel dots */}
      <rect x={-4 * PX} y={headY + 1.5 * PX} width={2 * PX} height={PX} fill="#1a1a2e" />
      <rect x={2 * PX} y={headY + 1.5 * PX} width={2 * PX} height={PX} fill="#1a1a2e" />
      {/* Eye highlights */}
      <rect x={-3.5 * PX} y={headY + 1.2 * PX} width={PX * 0.7} height={PX * 0.5} fill="#fff" opacity={0.6} />
      <rect x={2.5 * PX} y={headY + 1.2 * PX} width={PX * 0.7} height={PX * 0.5} fill="#fff" opacity={0.6} />

      {/* Mouth */}
      <rect x={-PX * 0.8} y={headY + 3 * PX} width={PX * 1.6} height={PX * 0.4}
        fill="#1a1a2e" opacity={isWorking ? 0.5 : 0.2} />

      {/* ── Hair ── */}
      <Hair style={look.style} color={isActive ? look.hair : '#2d333b'} />

      {/* ── Accessory ── */}
      {look.accent && isActive && <Accessory type={look.accent} />}

      {/* ── Desk (in front of character lower body) ── */}
      <rect
        x={-9 * PX} y={bodyY + bodyH}
        width={18 * PX} height={2.5 * PX}
        fill={isActive ? '#1c2128' : '#161b22'}
        stroke={isActive ? '#2d333b' : '#1c2128'}
        strokeWidth={0.5}
      />
      {/* Desk front edge */}
      <rect
        x={-9 * PX} y={bodyY + bodyH + 2 * PX}
        width={18 * PX} height={PX * 0.5}
        fill={isActive ? '#2d333b' : '#1c2128'}
      />

      {/* ── Monitor on desk ── */}
      <rect
        x={-4 * PX} y={bodyY + PX * 0.5}
        width={8 * PX} height={bodyH - PX * 0.5}
        fill="#0d1117"
        stroke={isWorking ? color : '#30363d'}
        strokeWidth={isWorking ? 0.8 : 0.4}
      />
      {/* Screen content when working */}
      {isWorking && (
        <g>
          <motion.rect
            x={-3 * PX} y={bodyY + PX * 1.2}
            width={6 * PX} height={PX * 0.6}
            fill={color} opacity={0.5}
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          <rect x={-3 * PX} y={bodyY + PX * 2.2} width={4 * PX} height={PX * 0.4} fill="#30363d" opacity={0.4} />
          <rect x={-3 * PX} y={bodyY + PX * 2.9} width={5 * PX} height={PX * 0.4} fill="#30363d" opacity={0.3} />
        </g>
      )}
      {/* Monitor stand */}
      <rect x={-PX * 0.4} y={bodyY + bodyH - PX * 0.3} width={PX * 0.8} height={PX * 0.8} fill="#30363d" />

      {/* ── Status dot ── */}
      <circle cx={10 * PX} cy={headY - PX} r={PX * 1.2} fill={color} />
      {isWorking && (
        <motion.circle
          cx={10 * PX} cy={headY - PX}
          r={PX * 1.2}
          fill="none" stroke={color} strokeWidth={0.7}
          animate={{ r: [PX * 1.2, PX * 2.5, PX * 1.2], opacity: [1, 0, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}

      {/* ── Name plate ── */}
      <rect
        x={-11 * PX} y={bodyY + bodyH + 4 * PX}
        width={22 * PX} height={5 * PX}
        rx={PX * 0.8}
        fill="#161b22"
        stroke={isActive ? '#2d333b' : '#1c2128'}
        strokeWidth={0.5}
      />
      <text
        x={0} y={bodyY + bodyH + 6.8 * PX}
        textAnchor="middle"
        dominantBaseline="central"
        fill={isActive ? '#c9d1d9' : '#484f58'}
        fontSize={6.5}
        fontFamily="'SF Mono', 'Fira Code', monospace"
        fontWeight={isWorking ? 600 : 400}
      >
        {agent.name.length > 14 ? agent.name.slice(0, 12) + '\u2026' : agent.name}
      </text>

      {/* ── Tool badge ── */}
      {agent.currentTool && (
        <g transform={`translate(${10 * PX}, ${bodyY})`}>
          <rect x={0} y={-PX * 2} width={agent.currentTool.length * 3.5 + 6} height={4 * PX}
            rx={PX} fill="#f0883e" opacity={0.9} />
          <text x={3} y={PX * 0.3} fill="#0f1419" fontSize={6} fontWeight="bold"
            fontFamily="monospace" dominantBaseline="central">
            {agent.currentTool}
          </text>
        </g>
      )}

      {/* ── Speech bubble ── */}
      {agent.speechBubble && agent.status === 'SPEAKING' && (
        <g transform={`translate(0, ${headY - 6 * PX})`}>
          <rect
            x={-22 * PX} y={-4 * PX}
            width={44 * PX} height={6 * PX}
            rx={PX * 1.5}
            fill="#d2a8ff" opacity={0.9}
          />
          <polygon points={`${-PX},${2 * PX} ${PX},${2 * PX} 0,${4 * PX}`} fill="#d2a8ff" opacity={0.9} />
          <text
            x={0} y={-0.8 * PX}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#0f1419"
            fontSize={6}
            fontFamily="system-ui, sans-serif"
          >
            {agent.speechBubble.length > 28 ? agent.speechBubble.slice(0, 26) + '\u2026' : agent.speechBubble}
          </text>
        </g>
      )}
    </g>
  );
}
