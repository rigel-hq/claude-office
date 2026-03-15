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

const SKIN_COLORS = ['#e8cdb5', '#d4b89a', '#bf9876', '#96775a', '#6b5240', '#dcc5a8'];
const HAIR_COLORS = ['#2a1f16', '#4a3020', '#9a7850', '#bfa268', '#6e4020', '#1c1c28'];
const SHIRT_COLORS = [
  '#3a6b9f', '#6b5a8e', '#8e5a72', '#9a6e40', '#3a7a52', '#3a808a',
  '#8a7a30', '#8a4a4a', '#5558a0', '#2a8a7a', '#7a4a58', '#7a5a9a',
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
