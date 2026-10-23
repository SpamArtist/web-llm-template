import { eligibility } from '../shared/eligibility.js';
import { sourceHash, validateDraft } from '../shared/draft.js';
import type { ClaimRecord, GitHub, SessionState, SessionStore } from '../shared/planning.types.js';
import type { SessionOptions, SessionResult } from './session.types.js';
import { activeClaim, recoverPublished, reportOnce, stopSession } from './session-state.js';

export { stopSession } from './session-state.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function beginSession(github: GitHub, store: SessionStore, ownerId: string, issueNumber: number, options: SessionOptions): Promise<SessionResult> {
  const saved = await store.load(issueNumber);
  // An exhausted read can fail before a remote busy claim exists. Its local stop
  // still prevents the scheduler from starting a fresh network retry cycle.
  if (saved?.snapshot.ownerId === ownerId && saved.status === 'stopped' && !options.manual) {
    return { action: 'skip', reason: saved.reason ?? 'The previous run stopped. A manual restart is required.' };
  }
  const [repository, source, previousClaim] = await Promise.all([github.repository(), github.issue(issueNumber), github.getClaim(issueNumber)]);
  if (previousClaim?.record.phase === 'complete') {
    // Publication commits completion remotely before deleting local recovery files.
    // Retry that cleanup without reopening a completed session after a disk failure.
    if (previousClaim.record.ownerId === ownerId) {
      const completed = saved;
      if (completed?.snapshot.ownerId === ownerId && completed.snapshot.sessionId === previousClaim.record.sessionId) {
        await store.remove(issueNumber);
      }
    }
    return { action: 'complete', reason: 'Tickets are already published. Use an explicit revision request to change them.' };
  }
  if (previousClaim && previousClaim.record.ownerId !== ownerId) return { action: 'skip', reason: 'Another machine owns this spec session. Request an explicit transfer.' };
  if (previousClaim?.record.phase === 'busy') return { action: 'skip', reason: 'A run is already active. Explicit recovery is required if the owner stopped.' };
  if (previousClaim?.record.phase === 'stopped' && !options.manual) return { action: 'skip', reason: 'The previous run stopped. A manual restart is required.' };
  const eligible = await eligibility(github, repository.slug, source);
  if (!eligible.eligible) return { action: 'skip', reason: eligible.reason };
  const previous = saved && saved.snapshot.sessionId === previousClaim?.record.sessionId ? saved : null;
  const hash = sourceHash(source);
  const unchanged = previous?.snapshot.sourceHash === hash;
  const state: SessionState = {
    snapshot: {
      version: 1, repo: repository.slug, source, sourceHash: hash, approved: eligible.approved,
      codeCommit: unchanged && previous.draft ? previous.snapshot.codeCommit : options.codeCommit,
      startedAt: options.startedAt, runId: options.runId, ownerId,
      sessionId: previousClaim?.record.sessionId ?? options.sessionId,
    },
    status: 'drafting', published: previous?.published ?? {},
    ...(unchanged && previous.draft ? { draft: previous.draft } : {}),
  };
  const record: ClaimRecord = {
    ...(previousClaim?.record ?? {}), version: 1, sourceNumber: issueNumber, ownerId,
    sessionId: state.snapshot.sessionId, phase: 'busy', runId: options.runId,
    sourceHash: previousClaim?.record.sourceHash ?? hash,
  };
  delete record.reason;
  const acquired = previousClaim ? await github.updateClaim(previousClaim, record) : await github.createClaim(record);
  if (!acquired) return { action: 'skip', reason: 'Another run claimed this spec first.' };
  try {
    await store.save(issueNumber, state);
    await recoverPublished(github, state);
    for (const [key, number] of Object.entries(previousClaim?.record.published ?? {})) {
      if (state.published[key]?.number !== number) throw new Error(`Published issue #${number} has no matching session marker. Preserve human edits and recover manually.`);
    }
    const priorHash = previousClaim?.record.sourceHash ?? previous?.snapshot.sourceHash;
    if (Object.keys(state.published).length && priorHash && priorHash !== hash) {
      throw new Error('The source changed after partial publication. Preserve existing tickets and request an explicit revision before continuing.');
    }
    await store.save(issueNumber, state);
    if (!state.draft) return { action: 'draft', state, ...(Object.keys(state.published).length ? { reason: 'Recover the same breakdown from published tickets. Stop if recovery is uncertain.' } : {}) };
    await acceptDraft(github, store, state, state.draft);
    return { action: state.snapshot.approved ? 'publish' : 'waiting', state };
  } catch (error) {
    await stopSession(github, store, state, errorMessage(error));
    throw error;
  }
}

export async function acceptDraft(github: GitHub, store: SessionStore, state: SessionState, value: unknown): Promise<SessionState> {
  try {
    await activeClaim(github, state);
    state.draft = validateDraft(value, state.snapshot);
    state.status = state.snapshot.approved ? 'publishing' : 'waiting';
    await store.save(state.snapshot.source.number, state);
    const claim = await activeClaim(github, state);
    if (state.snapshot.approved) {
      if (!await github.updateClaim(claim, { ...claim.record, sourceHash: state.snapshot.sourceHash })) throw new Error('Spec ownership changed before publication.');
      return state;
    }
    // Report while still holding the run lock. A failure leaves recovery in stopped state.
    await reportOnce(github, state, 'ready', `The complete ticket draft is ready for source version ${state.snapshot.sourceHash}. Review it in local Codex. Add auto-approve to publish it.`);
    if (!await github.updateClaim(claim, { ...claim.record, phase: 'owned', runId: null, sourceHash: state.snapshot.sourceHash })) {
      throw new Error('Spec ownership changed before the approval wait.');
    }
    return state;
  } catch (error) {
    await stopSession(github, store, state, errorMessage(error));
    throw error;
  }
}
