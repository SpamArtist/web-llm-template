import type { Claim } from '../shared/planning.types.js';

export interface ScanResult {
  number: number;
  title: string;
  action: 'skip' | 'complete' | 'busy' | 'stopped' | 'eligible' | 'handoff';
  reason?: string;
  claim: Claim | null;
}
