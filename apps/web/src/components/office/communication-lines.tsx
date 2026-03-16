'use client';

import { useMemo } from 'react';
import { useAgentStore } from '@/store/agent-store';
import type { ActiveCollaboration, AgentState, LineState } from '@/store/agent-store';

// Agent avatar radius (must match agent-avatar.tsx)
const AGENT_R = 26;

// Maximum concurrent lines rendered (performance guard — ADR 4.6)
const MAX_LINES = 8;

// Error color matching STATUS_COLORS.ERROR in agent-avatar.tsx
const ERROR_COLOR = '#b84a42';

// ── Bezier path helpers ──────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

/**
 * Build a quadratic Bezier `d` attribute between two points.
 * The control point is offset perpendicular to the midpoint
 * by 15% of the segment length — this gives a smooth organic curve.
 */
function bezierPath(a: Point, b: Point, index = 0): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return `M ${a.x},${a.y} L ${b.x},${b.y}`;

  // Perpendicular direction
  const perpX = -dy / len;
  const perpY = dx / len;

  // Stagger multiple lines between the same agents so they do not overlap
  const offset = len * 0.15 * (index % 2 === 0 ? 1 : -1);

  const midX = (a.x + b.x) / 2 + perpX * offset;
  const midY = (a.y + b.y) / 2 + perpY * offset;

  return `M ${a.x},${a.y} Q ${midX},${midY} ${b.x},${b.y}`;
}

/**
 * Offset a point from the center of an agent toward a target so
 * the line starts/ends at the edge of the status ring, not the center.
 */
function edgePoint(center: Point, target: Point, radius: number): Point {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return center;
  return {
    x: center.x + (dx / len) * radius,
    y: center.y + (dy / len) * radius,
  };
}

// ── Line style derivation from state ─────────────────────────

interface LineStyle {
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
  color: string;
  showParticles: boolean;
  particleSpeed: string;
  pulseAnimation: boolean;
}

function getLineStyle(lineState: LineState, baseColor: string): LineStyle {
  switch (lineState) {
    case 'initiating':
      return {
        strokeWidth: 1.5,
        strokeDasharray: '4 6',
        opacity: 0.3,
        color: '#9ca3af', // gray while walking
        showParticles: false,
        particleSpeed: '2s',
        pulseAnimation: false,
      };
    case 'active':
      return {
        strokeWidth: 2.5,
        strokeDasharray: '8 4',
        opacity: 0.7,
        color: baseColor,
        showParticles: true,
        particleSpeed: '1.5s',
        pulseAnimation: false,
      };
    case 'thinking':
      return {
        strokeWidth: 2,
        strokeDasharray: '6 4',
        opacity: 0.5,
        color: baseColor,
        showParticles: false,
        particleSpeed: '3s',
        pulseAnimation: true,
      };
    case 'error':
      return {
        strokeWidth: 2.5,
        strokeDasharray: '4 3',
        opacity: 0.8,
        color: ERROR_COLOR,
        showParticles: false,
        particleSpeed: '2s',
        pulseAnimation: false,
      };
    case 'fading':
      return {
        strokeWidth: 2,
        opacity: 0,
        color: baseColor,
        showParticles: false,
        particleSpeed: '2s',
        pulseAnimation: false,
      };
  }
}

// ── Sub-components ───────────────────────────────────────────

/**
 * Animated particles that flow along a Bezier path.
 * Uses SVG <animateMotion> for buttery-smooth, GPU-friendly animation.
 * Trail effect: particles have decreasing opacity (1.0 → 0.5 → 0.2).
 */
function PathParticles({
  pathD,
  color,
  speed,
  isSpeaking,
}: {
  pathD: string;
  color: string;
  speed: string;
  isSpeaking: boolean;
}) {
  // More particles and faster when agent is speaking
  const particles = isSpeaking
    ? [
        { delay: '0s', opacity: 1.0, r: 3 },
        { delay: '0.4s', opacity: 0.7, r: 2.5 },
        { delay: '0.8s', opacity: 0.4, r: 2 },
        { delay: '1.2s', opacity: 0.2, r: 1.5 },
      ]
    : [
        { delay: '0s', opacity: 0.8, r: 2.5 },
        { delay: '0.6s', opacity: 0.5, r: 2 },
        { delay: '1.2s', opacity: 0.2, r: 1.5 },
      ];

  return (
    <g>
      {particles.map((p, i) => (
        <circle key={i} r={p.r} fill={color} opacity={p.opacity}>
          <animateMotion
            dur={speed}
            repeatCount="indefinite"
            begin={p.delay}
            path={pathD}
          />
        </circle>
      ))}
    </g>
  );
}

/**
 * A single communication line between two agents,
 * including the path stroke, particles, and tooltip.
 * Renders differently based on the line state (ADR Section 4.3).
 */
function CollaborationLine({
  from,
  to,
  lineState,
  baseColor,
  index,
  tooltip,
  isSpeaking,
  staggerDelay,
}: {
  from: Point;
  to: Point;
  lineState: LineState;
  baseColor: string;
  index: number;
  tooltip: string;
  isSpeaking: boolean;
  staggerDelay: number;
}) {
  const style = getLineStyle(lineState, baseColor);

  // Offset endpoints to the edge of the agent's status ring
  const edgeFrom = edgePoint(from, to, AGENT_R + 2);
  const edgeTo = edgePoint(to, from, AGENT_R + 2);

  const d = bezierPath(edgeFrom, edgeTo, index);

  // Speaking state: thicker line (3px vs 2.5px per PRD spec)
  const strokeWidth = isSpeaking && lineState === 'active' ? 3 : style.strokeWidth;

  return (
    <g
      style={{
        opacity: style.opacity,
        transition: 'opacity 600ms ease-out',
        // Stagger entrance for rapid delegations (EC-4)
        animationDelay: staggerDelay > 0 ? `${staggerDelay}ms` : undefined,
      }}
    >
      <title>{tooltip}</title>

      {/* Invisible wider hit-area for easier hover targeting */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        strokeLinecap="round"
        style={{ cursor: 'pointer' }}
      />

      {/* Main path */}
      <path
        d={d}
        fill="none"
        stroke={style.color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={style.strokeDasharray}
        style={{
          filter: lineState === 'error'
            ? 'drop-shadow(0 0 3px rgba(184, 74, 66, 0.4))'
            : 'drop-shadow(0 0 2px rgba(0,0,0,0.15))',
          pointerEvents: 'none',
          transition: 'stroke 300ms ease, stroke-width 200ms ease',
        }}
      >
        {/* Animated dash offset for flowing effect */}
        {style.strokeDasharray && lineState !== 'fading' && (
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-24"
            dur={lineState === 'thinking' ? '1.5s' : '0.8s'}
            repeatCount="indefinite"
          />
        )}
      </path>

      {/* Pulsing opacity for thinking state */}
      {style.pulseAnimation && (
        <path
          d={d}
          fill="none"
          stroke={style.color}
          strokeWidth={strokeWidth + 2}
          strokeLinecap="round"
          strokeDasharray={style.strokeDasharray}
          style={{ pointerEvents: 'none' }}
        >
          <animate
            attributeName="opacity"
            values="0;0.3;0"
            dur="2s"
            repeatCount="indefinite"
          />
        </path>
      )}

      {/* Particles following the path (only for active state) */}
      {style.showParticles && (
        <PathParticles
          pathD={d}
          color={style.color}
          speed={style.particleSpeed}
          isSpeaking={isSpeaking}
        />
      )}
    </g>
  );
}

/**
 * For 3+ participants, render a translucent meeting zone circle
 * centered on the meeting table.
 */
function MeetingZone({
  participants,
  color,
  isFading,
}: {
  participants: number;
  color: string;
  isFading: boolean;
}) {
  const radius = 45 + Math.max(0, participants - 2) * 8;

  return (
    <circle
      cx={460}
      cy={230}
      r={radius}
      fill={color}
      opacity={isFading ? 0 : 0.08}
      stroke={color}
      strokeWidth={1}
      strokeOpacity={isFading ? 0 : 0.2}
      style={{ transition: 'opacity 600ms ease-out, r 400ms ease-out' }}
    />
  );
}

// ── Line state derivation ────────────────────────────────────

/**
 * Derive the visual line state from the collaboration status
 * and the participating agents' current statuses.
 */
function deriveLineState(
  collab: ActiveCollaboration,
  agents: Map<string, AgentState>,
): LineState {
  if (collab.status === 'fading') return 'fading';

  // Check if any participant has ERROR status
  for (const pid of collab.participants) {
    const agent = agents.get(pid);
    if (agent?.status === 'ERROR') return 'error';
  }

  // Check if any participant is still walking (isMoving)
  const anyMoving = collab.participants.some((pid) => {
    const agent = agents.get(pid);
    return agent?.isMoving;
  });
  if (anyMoving) return 'initiating';

  // Check if any participant is speaking
  const anySpeaking = collab.participants.some((pid) => {
    const agent = agents.get(pid);
    return agent?.status === 'SPEAKING';
  });
  if (anySpeaking) return 'active';

  // Check if any participant is thinking or tool-calling
  const anyThinking = collab.participants.some((pid) => {
    const agent = agents.get(pid);
    return agent?.status === 'THINKING' || agent?.status === 'TOOL_CALLING';
  });
  if (anyThinking) return 'thinking';

  // Default: active (agents are in collaboration but not doing anything visible)
  return 'active';
}

// ── Main component ───────────────────────────────────────────

/**
 * CommunicationLines reads active collaborations from the Zustand store
 * and renders animated SVG paths + particles between collaborating agents.
 * It is placed as Layer 7.5 in the office SVG (between decorations and avatars).
 *
 * Features:
 * - Line state machine (initiating → active → thinking → error → fading)
 * - Dynamic thickness (2px default, 3px when SPEAKING)
 * - Particle trail effect with opacity gradient
 * - Max 8 concurrent lines for performance
 * - Stagger delay for rapid delegations
 * - Error state (red dashed line)
 */
export function CommunicationLines() {
  const collaborations = useAgentStore((s) => s.collaborations);
  const agents = useAgentStore((s) => s.agents);

  // Build the list of lines to render
  const lines = useMemo(() => {
    const result: Array<{
      key: string;
      from: Point;
      to: Point;
      lineState: LineState;
      baseColor: string;
      index: number;
      tooltip: string;
      isSpeaking: boolean;
      staggerDelay: number;
    }> = [];

    let lineIndex = 0;

    collaborations.forEach((collab: ActiveCollaboration) => {
      const parts = collab.participants;
      const lineState = deriveLineState(collab, agents);

      // Build tooltip: "{initiator} → {participants}: {topic}"
      const initiatorAgent = agents.get(parts[0]) as AgentState | undefined;
      const initiatorName = initiatorAgent?.name ?? parts[0];
      const otherNames = parts
        .slice(1)
        .map((pid) => {
          const a = agents.get(pid) as AgentState | undefined;
          return a?.name ?? pid;
        })
        .join(', ');
      const tooltip = `${initiatorName} \u2192 ${otherNames}: ${collab.topic || 'collaboration'}`;

      // Check if the active speaker is in this collaboration
      const isSpeaking = collab.activeSpeaker
        ? collab.participants.includes(collab.activeSpeaker)
        : false;

      if (parts.length === 2) {
        // Direct line between the two agents
        const a = agents.get(parts[0]) as AgentState | undefined;
        const b = agents.get(parts[1]) as AgentState | undefined;
        if (a && b) {
          result.push({
            key: `${collab.id}-${parts[0]}-${parts[1]}`,
            from: a.position,
            to: b.position,
            lineState,
            baseColor: collab.color,
            index: lineIndex,
            tooltip,
            isSpeaking,
            // Stagger: 100ms per line for rapid delegations (EC-4)
            staggerDelay: lineIndex * 100,
          });
          lineIndex++;
        }
      } else if (parts.length >= 3) {
        // Star topology: line from initiator (first participant) to each other
        const initiator = agents.get(parts[0]) as AgentState | undefined;
        if (!initiator) return;

        for (let i = 1; i < parts.length; i++) {
          const target = agents.get(parts[i]) as AgentState | undefined;
          if (!target) continue;
          result.push({
            key: `${collab.id}-${parts[0]}-${parts[i]}`,
            from: initiator.position,
            to: target.position,
            lineState,
            baseColor: collab.color,
            index: lineIndex,
            tooltip,
            isSpeaking,
            staggerDelay: lineIndex * 100,
          });
          lineIndex++;
        }
      }
    });

    // Performance guard: max 8 concurrent lines (ADR 4.6)
    // Keep the most recent lines (higher index = newer)
    if (result.length > MAX_LINES) {
      return result.slice(-MAX_LINES);
    }

    return result;
  }, [collaborations, agents]);

  // Determine which collaborations have 3+ participants for meeting zones
  const meetingZones = useMemo(() => {
    const zones: Array<{
      key: string;
      participants: number;
      color: string;
      isFading: boolean;
    }> = [];

    collaborations.forEach((collab: ActiveCollaboration) => {
      if (collab.participants.length >= 3) {
        zones.push({
          key: `zone-${collab.id}`,
          participants: collab.participants.length,
          color: collab.color,
          isFading: collab.status === 'fading',
        });
      }
    });

    return zones;
  }, [collaborations]);

  if (lines.length === 0 && meetingZones.length === 0) return null;

  return (
    <g className="communication-lines" style={{ willChange: 'transform' }}>
      {/* Meeting zones (background) */}
      {meetingZones.map((zone) => (
        <MeetingZone
          key={zone.key}
          participants={zone.participants}
          color={zone.color}
          isFading={zone.isFading}
        />
      ))}

      {/* Communication lines */}
      {lines.map((line) => (
        <CollaborationLine
          key={line.key}
          from={line.from}
          to={line.to}
          lineState={line.lineState}
          baseColor={line.baseColor}
          index={line.index}
          tooltip={line.tooltip}
          isSpeaking={line.isSpeaking}
          staggerDelay={line.staggerDelay}
        />
      ))}
    </g>
  );
}
