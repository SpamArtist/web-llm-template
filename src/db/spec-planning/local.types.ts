import type { LocalConfig, SessionStore } from '../../shared/spec-planning/planning.types.js';

export interface SessionPaths {
  directory: string;
  draft: string;
  context: string;
  checkout: string;
}

export interface LocalSessionStore extends SessionStore {
  paths(number: number, commit: string): SessionPaths;
  write(number: number, filename: 'context.json' | 'draft.json', value: unknown): Promise<void>;
}

export interface SetupResult {
  config: LocalConfig;
  scheduleEnabled: false;
}
