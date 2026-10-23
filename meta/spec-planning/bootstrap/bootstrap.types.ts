export type WorkflowPhase = 'reserved' | 'ready' | 'creating' | 'active' | 'disabled';
export type NativeState = 'active' | 'paused' | 'deleted' | 'absent' | 'unknown';
export interface WorkflowRecord {
  version: 1;
  repository: string;
  planningRoot: string;
  phase: WorkflowPhase;
  reservation: { sessionId: string; reservedAt: string } | null;
  ownerId: string | null;
  projectId: string | null;
  automationId: string | null;
  previousAutomationIds: string[];
  initialCheck: { state: 'pending' | 'running' | 'complete'; sessionId: string | null };
  disabledReason: string | null;
  migration: { automationId: string; pauseConfirmed: boolean } | null;
  nativeObservation: { state: NativeState; automationId: string | null; observedAt: string } | null;
}
export interface BootstrapContext {
  repository: string;
  checkout: string;
  registryPath: string;
  marker: string;
  record: WorkflowRecord | null;
  attention: string | null;
}
export interface BootstrapOptions {
  session?: string;
  owner?: string;
  project?: string;
  automation?: string;
  migration?: string;
  state?: NativeState;
  action?: string;
  reason?: string;
  previousSession?: string;
  stopped?: boolean;
  explicit?: boolean;
  inventoryConfirmed?: boolean;
}
