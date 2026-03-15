export type CollaborationType = 'parallel' | 'consultation' | 'meeting';

export type CollaborationPhase =
  | 'start'
  | 'message'
  | 'end';

export type MovementPhase =
  | 'start'
  | 'waypoint'
  | 'arrived';

export type MovementReason =
  | 'collaboration'
  | 'return_to_desk'
  | 'meeting';

export interface Collaboration {
  id: string;
  type: CollaborationType;
  initiator: string;
  participants: string[];
  topic: string;
  startedAt: number;
  endedAt: number | null;
  parentRunId: string | null;
  messages: CollaborationMessage[];
}

export interface CollaborationMessage {
  id: string;
  collaborationId: string;
  fromAgent: string;
  toAgent: string;   // '*' for broadcast to all participants
  content: string;
  timestamp: number;
}

/**
 * Extended position model for dynamic agent movement.
 * The existing AgentState.position becomes { x: currentX, y: currentY }.
 */
export interface AgentPosition {
  homeX: number;
  homeY: number;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  moveStartedAt: number | null;
  moveDuration: number;
}
