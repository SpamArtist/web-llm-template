/** Durable, shared ownership of one spec's transition into implementation. */
export interface HandoffRecord {
  version: 1;
  status: 'pending' | 'reserved' | 'creating' | 'launched';
  repo: string;
  marker: string;
  baseBranch: string;
  integrationBranch: string;
  executorSessionId?: string;
  projectId?: string;
  checkoutRoot?: string;
  baseCommit?: string;
  creationAttemptId?: string;
  clientThreadId?: string;
  threadId?: string;
  hostId?: string;
}
