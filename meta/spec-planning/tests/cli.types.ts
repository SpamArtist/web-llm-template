import type { LocalConfig } from '../shared/planning.types.js';

export interface CliResult {
  stdout: string;
  stderr: string;
  failed: boolean;
}

export interface FakeGhState {
  writable: boolean;
  installed: boolean;
  labels: string[];
  requests: { method: string; endpoint: string; input?: unknown }[];
  writes: { method: string; endpoint: string; input?: unknown }[];
}

export interface CliSetupResult {
  config: LocalConfig;
  scheduleEnabled: boolean;
}
