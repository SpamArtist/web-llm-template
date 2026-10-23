import type { Draft, SessionState } from '../shared/planning.types.js';
import type { SessionOptions } from '../use-cases/session.types.js';
import { sourceHash } from '../shared/draft.js';
import { FakeGitHub, initialState, MemoryStore } from './publish-fixture.js';

export const options: SessionOptions = { codeCommit: 'new-commit', runId: 'new-run', sessionId: 'new-session', startedAt: '2026-10-23' };

export function validDraft(state: SessionState): Draft {
  return {
    version: 1, sourceNumber: state.snapshot.source.number, sourceHash: state.snapshot.sourceHash, codeCommit: state.snapshot.codeCommit,
    requirements: [{ id: 'US-1', kind: 'story', text: 'Users can export all rows.' }],
    groups: [
      { key: 'implementation', title: 'Implementation Tickets', body: 'Implementation of the report export.' },
      { key: 'code-review', title: 'Code Review', body: 'Actual sub-issues wait for all implementation tickets to finish.' },
      { key: 'performance-review', title: 'Performance Review', body: 'Actual sub-issues wait for all implementation tickets to finish.' },
    ],
    tickets: [{ key: 'export', title: 'Export all rows', body: 'Users can export all rows.\nAcceptance: exported rows match the report.\nTesting: Red: fail an export check. Green: implement export. Refactor: simplify conversion.\nEvidence: run export and check the saved file.', requirementIds: ['US-1'], blockedBy: [] }],
  };
}

export function sessionFixture() {
  const state = initialState();
  state.snapshot.source.labels = ['spec', 'ready-for-agent'];
  state.snapshot.approved = false;
  state.snapshot.sourceHash = sourceHash(state.snapshot.source);
  state.draft = validDraft(state);
  state.status = 'waiting';
  const github = new FakeGitHub(state);
  github.claim.record.phase = 'owned';
  github.claim.record.runId = null;
  github.claim.record.sourceHash = state.snapshot.sourceHash;
  const store = new MemoryStore();
  return { state, github, store };
}
