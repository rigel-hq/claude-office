/**
 * Procedural avatar generator — deterministically generates a unique
 * face from an agent ID string (same ID = same face every time).
 * Inspired by OpenClaw Office's approach.
 */

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface AvatarData {
  faceShape: 'round' | 'square' | 'oval';
  hairStyle: 'short' | 'spiky' | 'side-part' | 'curly' | 'buzz';
  eyeStyle: 'dot' | 'line' | 'wide';
  skinColor: string;
  hairColor: string;
  shirtColor: string;
}

const SKIN_COLORS = ['#fde2c8', '#f5c5a0', '#d4956b', '#a0714f', '#6b4226', '#ffe0bd'];
const HAIR_COLORS = ['#2c1b0e', '#5a3214', '#c2884a', '#e8c068', '#8b4513', '#1a1a2e'];
const SHIRT_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#06b6d4',
  '#eab308', '#ef4444', '#6366f1', '#14b8a6', '#f43f5e', '#a855f7',
];

const FACE_SHAPES = ['round', 'square', 'oval'] as const;
const HAIR_STYLES = ['short', 'spiky', 'side-part', 'curly', 'buzz'] as const;
const EYE_STYLES = ['dot', 'line', 'wide'] as const;

export function generateAvatar(agentId: string): AvatarData {
  const h = hashString(agentId);
  return {
    faceShape: FACE_SHAPES[h % 3],
    hairStyle: HAIR_STYLES[(h >>> 3) % 5],
    eyeStyle: EYE_STYLES[(h >>> 6) % 3],
    skinColor: SKIN_COLORS[(h >>> 9) % 6],
    hairColor: HAIR_COLORS[(h >>> 12) % 6],
    shirtColor: SHIRT_COLORS[(h >>> 15) % 12],
  };
}
