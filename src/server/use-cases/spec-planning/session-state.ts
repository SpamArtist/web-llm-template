import { createHash } from 'node:crypto';
import type { Claim, GitHub, SessionState, SessionStore } from '../../../shared/spec-planning/planning.types.js';

export async function activeClaim(github: GitHub, state: SessionState): Promise<Claim> {
  const claim = await github.getClaim(state.snapshot.source.number);
  const snapshot = state.snapshot;
  if (!claim || claim.record.ownerId !== snapshot.ownerId || claim.record.sessionId !== snapshot.sessionId || claim.record.runId !== snapshot.runId || claim.record.phase !== 'busy') {
    throw new Error('Spec session ownership changed.');
  }
  return claim;
}

export async function reportOnce(github: GitHub, state: SessionState, event: string, body: string): Promise<void> {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const marker = `<!-- spec-planning:${state.snapshot.source.number}:${state.snapshot.sessionId}:${event}:${hash} -->`;
  if (!(await github.comments(state.snapshot.source.number)).some((comment) => comment.body.includes(marker))) {
    await github.comment(state.snapshot.source.number, `${body}\n\n${marker}`);
  }
}

export async function recoverPublished(github: GitHub, state: SessionState): Promise<void> {
  const prefix = `<!-- spec-planning:${state.snapshot.source.number}:${state.snapshot.sessionId}:`;
  for (const issue of await github.allIssues()) {
    const suffixes = issue.body.split(prefix).slice(1);
    for (const suffix of suffixes) {
      const end = suffix.indexOf(' -->');
      if (end === -1) continue;
      const key = suffix.slice(0, end);
      if (!key.startsWith('group:') && !key.startsWith('ticket:')) continue;
      const record = state.published[key];
      if (record && record.number !== issue.number) throw new Error(`Duplicate publication marker for ${key}.`);
      // A stored record is the baseline for human-edit detection. Never replace it.
      if (!record) state.published[key] = { number: issue.number, id: issue.id, title: issue.title, body: issue.body };
    }
  }
}

export async function stopSession(github: GitHub, store: SessionStore, state: SessionState, reason: string): Promise<SessionState> {
  // Verified remote completion is final. A cleanup error must not convert it
  // into a stopped session that would block the next cleanup attempt.
  if (state.status === 'complete') return state;
  const number = state.snapshot.source.number;
  state.status = 'stopped';
  state.reason = reason;
  let localFailure: unknown;
  try {
    const latest = await store.load(number);
    // A stale failing caller must not overwrite a later run's local state.
    if (latest && (latest.snapshot.sessionId !== state.snapshot.sessionId || latest.snapshot.runId !== state.snapshot.runId)) return state;
    if (latest) state.published = { ...state.published, ...latest.published };
    // Persist local recovery before attempting any network call.
    await store.save(number, state);
  } catch (error) {
    localFailure = error;
  }
  const claim = await github.getClaim(number);
  if (claim && claim.record.ownerId === state.snapshot.ownerId && claim.record.sessionId === state.snapshot.sessionId && claim.record.runId === state.snapshot.runId && claim.record.phase === 'busy') {
    const stopped = await github.updateClaim(claim, { ...claim.record, phase: 'stopped', runId: null, reason,
      published: Object.fromEntries(Object.entries(state.published).map(([key, record]) => [key, record.number])),
    });
    if (stopped) await reportOnce(github, state, 'stopped', `Ticket planning stopped: ${reason}\n\n${localFailure ? 'Local recovery storage failed; use the GitHub records for recovery.' : 'Recovery files were retained.'} Start manually after resolving the failure.`);
  }
  if (localFailure) throw localFailure;
  return state;
}
