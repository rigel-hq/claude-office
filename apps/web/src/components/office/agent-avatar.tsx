'use client';

import { useRef, useEffect, useState } from 'react';
import { animate, stagger, spring } from 'animejs';
import { generateAvatar, type AvatarData } from '@/lib/avatar-generator';
import type { AgentState } from '@/store/agent-store';

const R = 20; // avatar radius

const STATUS_COLORS: Record<string, string> = {
  OFFLINE: '#6b7280',
  IDLE: '#22c55e',
  THINKING: '#3b82f6',
  TOOL_CALLING: '#f97316',
  SPEAKING: '#a855f7',
  COLLABORATING: '#06b6d4',
  ERROR: '#ef4444',
};

// Movement offsets: working agents slide forward from desk
function getMotionOffset(status: string): { dx: number; dy: number } {
  switch (status) {
    case 'THINKING':      return { dx: 0, dy: -10 };
    case 'TOOL_CALLING':  return { dx: 5, dy: -5 };
    case 'SPEAKING':      return { dx: 0, dy: -14 };
    case 'COLLABORATING': return { dx: 8, dy: -8 };
    case 'ERROR':         return { dx: 0, dy: 3 };
    default:              return { dx: 0, dy: 0 };
  }
}

// ── Face sub-components (static SVG — no animation) ──────────

function HairShape({ style, color, cx, cy, r }: {
  style: string; color: string; cx: number; cy: number; r: number;
}) {
  const s = r / 20;
  const faceW = r * 0.8;

  switch (style) {
    case 'short':
      return <ellipse cx={cx} cy={cy - r * 0.4} rx={faceW * 1.05} ry={r * 0.5} fill={color} />;
    case 'spiky':
      return (
        <g>
          <ellipse cx={cx} cy={cy - r * 0.35} rx={faceW} ry={r * 0.45} fill={color} />
          <polygon points={`${cx - 6 * s},${cy - r * 0.65} ${cx - 3 * s},${cy - r * 1.1} ${cx},${cy - r * 0.65}`} fill={color} />
          <polygon points={`${cx - 2 * s},${cy - r * 0.7} ${cx + 1 * s},${cy - r * 1.15} ${cx + 4 * s},${cy - r * 0.7}`} fill={color} />
          <polygon points={`${cx + 2 * s},${cy - r * 0.65} ${cx + 5 * s},${cy - r * 1.05} ${cx + 8 * s},${cy - r * 0.6}`} fill={color} />
        </g>
      );
    case 'side-part':
      return (
        <g>
          <ellipse cx={cx + 2 * s} cy={cy - r * 0.4} rx={faceW * 1.1} ry={r * 0.5} fill={color} />
          <ellipse cx={cx - r * 0.5} cy={cy - r * 0.1} rx={4 * s} ry={r * 0.4} fill={color} />
        </g>
      );
    case 'curly':
      return (
        <g>
          <circle cx={cx - 5 * s} cy={cy - r * 0.55} r={6 * s} fill={color} />
          <circle cx={cx + 5 * s} cy={cy - r * 0.55} r={6 * s} fill={color} />
          <circle cx={cx} cy={cy - r * 0.65} r={7 * s} fill={color} />
          <circle cx={cx - 8 * s} cy={cy - r * 0.2} r={4 * s} fill={color} />
          <circle cx={cx + 8 * s} cy={cy - r * 0.2} r={4 * s} fill={color} />
        </g>
      );
    case 'buzz':
      return <ellipse cx={cx} cy={cy - r * 0.35} rx={faceW * 0.95} ry={r * 0.4} fill={color} />;
    default:
      return <ellipse cx={cx} cy={cy - r * 0.4} rx={faceW} ry={r * 0.45} fill={color} />;
  }
}

function Eyes({ style, cx, cy, r }: { style: string; cx: number; cy: number; r: number }) {
  const s = r / 20;
  const ey = cy + r * 0.05;
  const gap = 5 * s;

  switch (style) {
    case 'dot':
      return (
        <g>
          <circle cx={cx - gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
          <circle cx={cx + gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
        </g>
      );
    case 'line':
      return (
        <g>
          <line x1={cx - gap - 2 * s} y1={ey} x2={cx - gap + 2 * s} y2={ey} stroke="#1a1a2e" strokeWidth={1.5} strokeLinecap="round" />
          <line x1={cx + gap - 2 * s} y1={ey} x2={cx + gap + 2 * s} y2={ey} stroke="#1a1a2e" strokeWidth={1.5} strokeLinecap="round" />
        </g>
      );
    case 'wide':
      return (
        <g>
          <ellipse cx={cx - gap} cy={ey} rx={3 * s} ry={2.5 * s} fill="#fff" />
          <ellipse cx={cx + gap} cy={ey} rx={3 * s} ry={2.5 * s} fill="#fff" />
          <circle cx={cx - gap} cy={ey} r={1.5 * s} fill="#1a1a2e" />
          <circle cx={cx + gap} cy={ey} r={1.5 * s} fill="#1a1a2e" />
          <circle cx={cx - gap + 0.5 * s} cy={ey - 0.5 * s} r={0.6 * s} fill="#fff" />
          <circle cx={cx + gap + 0.5 * s} cy={ey - 0.5 * s} r={0.6 * s} fill="#fff" />
        </g>
      );
    default:
      return (
        <g>
          <circle cx={cx - gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
          <circle cx={cx + gap} cy={ey} r={1.8 * s} fill="#1a1a2e" />
        </g>
      );
  }
}

function AvatarFace({ data, cx, cy, r }: { data: AvatarData; cx: number; cy: number; r: number }) {
  const s = r / 20;
  const faceRx = data.faceShape === 'square' ? r * 0.85 : data.faceShape === 'oval' ? r * 0.72 : r * 0.78;
  const faceRy = data.faceShape === 'square' ? r * 0.75 : data.faceShape === 'oval' ? r * 0.85 : r * 0.78;

  return (
    <g>
      <ellipse cx={cx} cy={cy + r * 0.9} rx={r * 0.7} ry={r * 0.5} fill={data.shirtColor} />
      <rect x={cx - 3 * s} y={cy + r * 0.25} width={6 * s} height={8 * s} fill={data.skinColor} />
      <ellipse cx={cx} cy={cy - r * 0.05} rx={faceRx} ry={faceRy} fill={data.skinColor} />
      <HairShape style={data.hairStyle} color={data.hairColor} cx={cx} cy={cy} r={r} />
      <Eyes style={data.eyeStyle} cx={cx} cy={cy} r={r} />
      <path
        d={`M ${cx - 3 * s} ${cy + r * 0.28} Q ${cx} ${cy + r * 0.38} ${cx + 3 * s} ${cy + r * 0.28}`}
        fill="none" stroke="#1a1a2e" strokeWidth={0.8} opacity={0.35}
      />
    </g>
  );
}

// ── Main avatar with anime.js animations ─────────────────────

export function AgentAvatar({ agent }: { agent: AgentState }) {
  const avatar = generateAvatar(agent.configId);
  const color = STATUS_COLORS[agent.status] ?? '#6b7280';
  const isActive = agent.status !== 'OFFLINE';
  const isWorking = ['THINKING', 'TOOL_CALLING', 'SPEAKING', 'COLLABORATING'].includes(agent.status);
  const clipId = `clip-${agent.configId}`;

  // Refs for animated elements
  const groupRef = useRef<SVGGElement>(null);
  const bobRef = useRef<SVGGElement>(null);
  const pulseRef = useRef<SVGCircleElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const thinkDotsRef = useRef<SVGGElement>(null);
  const speakBarsRef = useRef<SVGGElement>(null);
  const toolBadgeRef = useRef<SVGGElement>(null);
  const speechRef = useRef<SVGGElement>(null);
  const spinRef = useRef<SVGCircleElement>(null);

  // Stable initial position for SSR (React won't override anime.js)
  const [initialPos] = useState(() => ({
    x: agent.position.x,
    y: agent.position.y,
  }));

  const offset = getMotionOffset(agent.status);
  const targetX = agent.position.x + offset.dx;
  const targetY = agent.position.y + offset.dy;

  // ── Position: spring-based movement ──
  useEffect(() => {
    if (!groupRef.current) return;
    const anim = animate(groupRef.current, {
      translateX: `${targetX}px`,
      translateY: `${targetY}px`,
      ease: spring({ stiffness: 100, damping: 20 }),
      composition: 'replace',
    });
    return () => { anim.pause(); };
  }, [targetX, targetY]);

  // ── Bobbing / breathing: smooth sine wave ──
  useEffect(() => {
    if (!bobRef.current) return;
    if (isWorking) {
      const anim = animate(bobRef.current, {
        translateY: ['0px', '-5px', '0px', '3px', '0px'],
        ease: 'inOutSine',
        duration: 2800,
        loop: true,
      });
      return () => { anim.pause(); };
    } else if (isActive) {
      const anim = animate(bobRef.current, {
        translateY: ['0px', '-2px', '0px'],
        ease: 'inOutSine',
        duration: 4500,
        loop: true,
      });
      return () => { anim.pause(); };
    }
  }, [isWorking, isActive]);

  // ── Pulse glow: smooth expansion ──
  useEffect(() => {
    if (!pulseRef.current) return;
    if (!isWorking) {
      pulseRef.current.setAttribute('opacity', '0');
      return;
    }
    const anim = animate(pulseRef.current, {
      r: [R + 6, R + 14, R + 6],
      opacity: [0.3, 0.05, 0.3],
      ease: 'inOutQuad',
      duration: 2200,
      loop: true,
    });
    return () => { anim.pause(); };
  }, [isWorking]);

  // ── Ground shadow: breathes with bobbing ──
  useEffect(() => {
    if (!shadowRef.current) return;
    if (!isActive) {
      shadowRef.current.setAttribute('opacity', '0');
      return;
    }
    shadowRef.current.setAttribute('opacity', '0.12');
    if (isWorking) {
      const anim = animate(shadowRef.current, {
        rx: [R - 2, R + 3, R - 2],
        opacity: [0.12, 0.06, 0.12],
        ease: 'inOutSine',
        duration: 2800,
        loop: true,
      });
      return () => { anim.pause(); };
    }
  }, [isWorking, isActive]);

  // ── Thinking dots: staggered spring bounce ──
  useEffect(() => {
    if (!thinkDotsRef.current || agent.status !== 'THINKING') return;
    const dots = thinkDotsRef.current.querySelectorAll('circle');
    if (dots.length === 0) return;
    const anim = animate(dots, {
      translateY: ['0px', '-4px', '0px'],
      opacity: [0.3, 1, 0.3],
      ease: spring({ stiffness: 300, damping: 8 }),
      delay: stagger(120),
      loop: true,
      duration: 1000,
    });
    return () => { anim.pause(); };
  }, [agent.status]);

  // ── Speaking bars: oscillation ──
  useEffect(() => {
    if (!speakBarsRef.current || agent.status !== 'SPEAKING') return;
    const bars = speakBarsRef.current.querySelectorAll('rect');
    if (bars.length === 0) return;
    const anim = animate(bars, {
      scaleY: [0.3, 1, 0.3],
      ease: 'inOutSine',
      delay: stagger(80),
      loop: true,
      duration: 500,
    });
    return () => { anim.pause(); };
  }, [agent.status]);

  // ── Tool badge: spring entrance ──
  useEffect(() => {
    if (!toolBadgeRef.current) return;
    if (!agent.currentTool) {
      toolBadgeRef.current.setAttribute('opacity', '0');
      return;
    }
    animate(toolBadgeRef.current, {
      opacity: [0, 1],
      scale: [0.2, 1],
      translateY: ['12px', '0px'],
      ease: spring({ stiffness: 250, damping: 14 }),
    });
  }, [agent.currentTool]);

  // ── Speech bubble: elastic pop-in ──
  useEffect(() => {
    if (!speechRef.current) return;
    if (!agent.speechBubble || agent.status !== 'SPEAKING') {
      speechRef.current.setAttribute('opacity', '0');
      return;
    }
    animate(speechRef.current, {
      opacity: [0, 1],
      scale: [0.4, 1],
      translateY: ['10px', '0px'],
      ease: spring({ stiffness: 180, damping: 12 }),
    });
  }, [agent.speechBubble, agent.status]);

  // ── Tool calling: spinning dash ring ──
  useEffect(() => {
    if (!spinRef.current || agent.status !== 'TOOL_CALLING') return;
    const anim = animate(spinRef.current, {
      rotate: [0, 360],
      ease: 'linear',
      duration: 3000,
      loop: true,
    });
    return () => { anim.pause(); };
  }, [agent.status]);

  return (
    <g
      ref={groupRef}
      style={{ transform: `translateX(${initialPos.x}px) translateY(${initialPos.y}px)` }}
    >
      <g ref={bobRef}>
        {/* Ground shadow */}
        <ellipse
          ref={shadowRef}
          cx={0} cy={R + 8} rx={R - 2} ry={4}
          fill="#000" opacity={0}
        />

        {/* Pulse glow ring */}
        <circle
          ref={pulseRef}
          cx={0} cy={0} r={R + 6}
          fill="none" stroke={color} strokeWidth={2}
          opacity={0}
        />

        {/* Status ring */}
        <circle
          cx={0} cy={0} r={R + 2}
          fill="none" stroke={color}
          strokeWidth={isWorking ? 3 : 2}
          strokeDasharray={agent.status === 'TOOL_CALLING' ? '6 3' : undefined}
          opacity={isActive ? 1 : 0.25}
        />

        {/* Spinning dash for TOOL_CALLING */}
        {agent.status === 'TOOL_CALLING' && (
          <circle
            ref={spinRef}
            cx={0} cy={0} r={R + 2}
            fill="none" stroke={color} strokeWidth={2}
            strokeDasharray="6 3"
            style={{ transformOrigin: '0px 0px' }}
          />
        )}

        {/* Avatar disc */}
        <circle cx={0} cy={0} r={R} fill="#1e293b" />

        {/* Clipped face */}
        <defs>
          <clipPath id={clipId}>
            <circle cx={0} cy={0} r={R} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <AvatarFace data={avatar} cx={0} cy={0} r={R} />
        </g>

        {/* Thinking dots */}
        {agent.status === 'THINKING' && (
          <g ref={thinkDotsRef} transform="translate(16, -16)">
            <circle cx={0} cy={0} r={2} fill={color} opacity={0.3} />
            <circle cx={6} cy={0} r={2} fill={color} opacity={0.3} />
            <circle cx={12} cy={0} r={2} fill={color} opacity={0.3} />
          </g>
        )}

        {/* Speaking waveform bars */}
        {agent.status === 'SPEAKING' && (
          <g ref={speakBarsRef} transform="translate(16, -16)">
            <rect x={0} y={-4} width={2} height={8} rx={1} fill={color} style={{ transformOrigin: '1px 0px' }} />
            <rect x={4} y={-3} width={2} height={6} rx={1} fill={color} style={{ transformOrigin: '5px 0px' }} />
            <rect x={8} y={-4} width={2} height={8} rx={1} fill={color} style={{ transformOrigin: '9px 0px' }} />
          </g>
        )}

        {/* Tool badge */}
        <g ref={toolBadgeRef} opacity={agent.currentTool ? 1 : 0}>
          {agent.currentTool && (
            <g transform="translate(0, 32)">
              <rect
                x={-(agent.currentTool.length * 3.2 + 10) / 2} y={0}
                width={agent.currentTool.length * 3.2 + 10} height={13}
                rx={6.5} fill="#f97316"
              />
              <text x={0} y={7.5} textAnchor="middle" dominantBaseline="central"
                fill="#fff" fontSize={7} fontWeight="600" fontFamily="system-ui">
                {agent.currentTool}
              </text>
            </g>
          )}
        </g>

        {/* Name label */}
        <g transform={`translate(0, ${agent.currentTool ? 48 : 30})`}>
          <rect
            x={-34} y={0} width={68} height={16} rx={8}
            fill="rgba(15, 23, 42, 0.85)"
            stroke="rgba(51, 65, 85, 0.4)"
            strokeWidth={0.5}
          />
          <text x={0} y={9} textAnchor="middle" dominantBaseline="central"
            fill={isActive ? '#e2e8f0' : '#64748b'}
            fontSize={7} fontWeight={isWorking ? 600 : 400} fontFamily="system-ui">
            {agent.name.length > 14 ? agent.name.slice(0, 12) + '\u2026' : agent.name}
          </text>
        </g>

        {/* Speech bubble */}
        <g ref={speechRef} opacity={0}>
          {agent.speechBubble && agent.status === 'SPEAKING' && (
            <g transform="translate(0, -40)">
              <rect x={-55} y={-10} width={110} height={18} rx={9}
                fill="rgba(168, 85, 247, 0.92)" />
              <polygon points="-4,8 4,8 0,14" fill="rgba(168, 85, 247, 0.92)" />
              <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
                fill="#fff" fontSize={7} fontFamily="system-ui">
                {agent.speechBubble.length > 26 ? agent.speechBubble.slice(0, 24) + '\u2026' : agent.speechBubble}
              </text>
            </g>
          )}
        </g>
      </g>
    </g>
  );
}

// ── Small avatar for sidebar list ────────────────────────────

export function SidebarAvatar({ agentId, size = 28 }: { agentId: string; size?: number }) {
  const data = generateAvatar(agentId);
  const r = size / 2;
  const clipId = `sidebar-clip-${agentId}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={r} cy={r} r={r} />
        </clipPath>
      </defs>
      <circle cx={r} cy={r} r={r} fill="#1e293b" />
      <g clipPath={`url(#${clipId})`}>
        <AvatarFace data={data} cx={r} cy={r} r={r} />
      </g>
    </svg>
  );
}
