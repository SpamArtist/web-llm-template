import type { GitHub, Issue, SessionState, SessionStore } from '../../../shared/spec-planning/planning.types.js';

export interface Publication {
  github: GitHub;
  store: SessionStore;
  state: SessionState;
  issues: Issue[];
  dependencyFallback: Set<number>;
}
