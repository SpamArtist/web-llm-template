export interface ClaimCheckEvidence {
  repository: string;
  ref: string;
  startedAt: string;
  completedAt?: string;
  createResults?: string[];
  updateResults?: string[];
  initialSha?: string;
  finalSha?: string;
  passed: boolean;
  cleaned: boolean;
  error?: string;
}
