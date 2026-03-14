'use client';

import { motion } from 'framer-motion';
import type { AgentState } from '@/store/agent-store';

const STATUS_COLORS: Record<string, string> = {
  OFFLINE: '#30363d',
  IDLE: '#3fb950',
  THINKING: '#58a6ff',
  TOOL_CALLING: '#f0883e',
  SPEAKING: '#d2a8ff',
  COLLABORATING: '#56d4dd',
  ERROR: '#f85149',
};

const STATUS_DASH: Record<string, string> = {
  TOOL_CALLING: '4 4',
};

export function AgentAvatar({ agent }: { agent: AgentState }) {
  const color = STATUS_COLORS[agent.status] ?? '#30363d';
  const dash = STATUS_DASH[agent.status];
  const isActive = agent.status !== 'OFFLINE';
  const isPulsing = ['THINKING', 'SPEAKING', 'COLLABORATING'].includes(agent.status);

  return (
    <g transform={`translate(${agent.position.x}, ${agent.position.y})`}>
      {/* Status ring */}
      <motion.circle
        cx={0}
        cy={0}
        r={28}
        fill="none"
        stroke={color}
        strokeWidth={isPulsing ? 3 : 2}
        strokeDasharray={dash}
        animate={isPulsing ? {
          r: [28, 31, 28],
          opacity: [1, 0.6, 1],
        } : {}}
        transition={isPulsing ? {
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
        } : {}}
      />

      {/* Background circle */}
      <circle
        cx={0}
        cy={0}
        r={24}
        fill={isActive ? '#161b22' : '#0f1419'}
        stroke="#30363d"
        strokeWidth={1}
      />

      {/* Agent icon */}
      <text
        x={0}
        y={2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={20}
        style={{ userSelect: 'none' }}
      >
        {agent.icon}
      </text>

      {/* Agent name */}
      <text
        x={0}
        y={42}
        textAnchor="middle"
        fill="#8b949e"
        fontSize={9}
        fontFamily="system-ui, sans-serif"
      >
        {agent.name.length > 16 ? agent.name.slice(0, 14) + '…' : agent.name}
      </text>

      {/* Tool badge */}
      {agent.currentTool && (
        <g transform="translate(20, -20)">
          <rect x={-2} y={-8} width={agent.currentTool.length * 5.5 + 8} height={16} rx={4} fill="#f0883e" />
          <text x={2} y={1} fill="#0f1419" fontSize={8} fontWeight="bold" fontFamily="monospace" dominantBaseline="central">
            {agent.currentTool}
          </text>
        </g>
      )}

      {/* Speech bubble */}
      {agent.speechBubble && (
        <g transform="translate(0, -44)">
          <rect
            x={-60}
            y={-14}
            width={120}
            height={24}
            rx={8}
            fill="#d2a8ff"
            opacity={0.9}
          />
          {/* Pointer triangle */}
          <polygon points="-4,10 4,10 0,16" fill="#d2a8ff" opacity={0.9} />
          <text
            x={0}
            y={-2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#0f1419"
            fontSize={8}
            fontFamily="system-ui, sans-serif"
          >
            {agent.speechBubble.length > 28 ? agent.speechBubble.slice(0, 26) + '…' : agent.speechBubble}
          </text>
        </g>
      )}

      {/* Error badge */}
      {agent.status === 'ERROR' && (
        <g transform="translate(20, 15)">
          <circle cx={0} cy={0} r={8} fill="#f85149" />
          <text x={0} y={1} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={10} fontWeight="bold">!</text>
        </g>
      )}
    </g>
  );
}
