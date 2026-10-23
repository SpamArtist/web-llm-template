import type { SessionState } from '../../../shared/spec-planning/planning.types.js';

export interface SessionOptions {
  manual?: boolean;
  codeCommit: string;
  runId: string;
  sessionId: string;
  startedAt: string;
}

export interface SessionResult {
  action: 'draft' | 'publish' | 'waiting' | 'skip' | 'complete';
  state?: SessionState;
  reason?: string;
}
