import type { Claim } from '../shared/planning.types.js';

export interface HandoffIdentity {
  sourceNumber: number;
  ownerId: string;
}
export interface HandoffMutation extends HandoffIdentity {
  expectedSha: string;
}
export interface HandoffExecution extends HandoffMutation {
  executorSessionId: string;
}
export interface HandoffReservation extends HandoffExecution {
  projectId: string;
  checkoutRoot: string;
}
export interface HandoffPreparation extends HandoffExecution {
  baseCommit: string;
}
export interface HandoffThread extends HandoffExecution {
  clientThreadId?: string;
  threadId?: string;
  hostId?: string;
}
export interface HandoffRecovery extends HandoffMutation {
  confirmedStopped: boolean;
  confirmedAbsent?: boolean;
}
export interface HandoffEnrollment extends HandoffMutation {
  repo: string;
  sourceBody: string;
  manual: boolean;
}
export interface HandoffStatus {
  claim: Claim;
  action: 'none' | 'reserve' | 'prepare' | 'prepare-branch' | 'create' | 'reconcile' | 'launched';
  tickets: number[];
}
