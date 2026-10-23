import { describe, expect, it, vi } from 'vitest';
import { acceptDraft, beginSession, stopSession } from '../../src/server/use-cases/spec-planning/session.js';
import type { GitHub } from '../../src/shared/spec-planning/planning.types.js';
import { options, sessionFixture, validDraft } from './session-fixture.js';

describe('exclusive spec sessions', () => {
  it('claims a new spec atomically and keeps its source snapshot', async () => {
    const { github, store } = sessionFixture();
    const api: GitHub = github;
    vi.spyOn(api, 'getClaim').mockResolvedValueOnce(null);
    api.createClaim = vi.fn(async (record) => { github.claim = { sha: '1', record }; return structuredClone(github.claim); });
    const result = await beginSession(api, store, 'machine', 1, options);
    expect(result.action).toBe('draft');
    expect(github.claim.record).toMatchObject({ phase: 'busy', runId: 'new-run', sessionId: 'new-session' });
    expect(store.saved?.snapshot.source).toEqual(github.issues[0]);
  });

  it('skips other owners, busy runs, stopped automatic runs, and lost claim races', async () => {
    const { github, store } = sessionFixture();
    expect((await beginSession(github, store, 'other-machine', 1, options)).action).toBe('skip');
    github.claim.record.phase = 'busy';
    expect((await beginSession(github, store, 'machine', 1, { ...options, manual: true })).action).toBe('skip');
    github.claim.record.phase = 'stopped';
    expect((await beginSession(github, store, 'machine', 1, options)).action).toBe('skip');
    github.claim.record.phase = 'owned';
    vi.spyOn(github, 'updateClaim').mockResolvedValue(null);
    expect((await beginSession(github, store, 'machine', 1, options)).action).toBe('skip');
    expect(store.saves).toBe(0);
  });

  it('reports complete publication without creating another session', async () => {
    const { github, store } = sessionFixture();
    github.claim.record.phase = 'complete';
    expect((await beginSession(github, store, 'other-machine', 1, options)).action).toBe('complete');
    expect(store.saves).toBe(0);
  });

  it('retries completed publication cleanup only for the same session and local owner', async () => {
    const { state, github, store } = sessionFixture();
    github.claim.record.phase = 'complete';
    store.saved = state;
    expect((await beginSession(github, store, 'machine', 1, options)).action).toBe('complete');
    expect(store.removed).toBe(true);
    expect(github.writes).toHaveLength(0);
  });

  it('preserves local files for other sessions or owners after remote completion', async () => {
    const { state, github, store } = sessionFixture();
    github.claim.record.phase = 'complete';
    store.saved = structuredClone(state);
    store.saved.snapshot.sessionId = 'different-session';
    await beginSession(github, store, 'machine', 1, options);
    expect(store.removed).toBe(false);
    store.saved = structuredClone(state);
    store.saved.snapshot.ownerId = 'other-owner';
    await beginSession(github, store, 'machine', 1, options);
    expect(store.removed).toBe(false);
    store.saved = structuredClone(state);
    await beginSession(github, store, 'other-owner', 1, options);
    expect(store.removed).toBe(false);
  });

  it('permits an explicit manual restart of a stopped session', async () => {
    const { github, store } = sessionFixture();
    github.claim.record.phase = 'stopped';
    const result = await beginSession(github, store, 'machine', 1, { ...options, manual: true });
    expect(result.action).toBe('draft');
    expect(result.state?.snapshot.sessionId).toBe('session');
  });

  it('does not restart a local stopped session while the remote claim remains owned', async () => {
    const { state, github, store } = sessionFixture();
    state.status = 'stopped';
    state.reason = 'Source read exhausted its retries.';
    store.saved = state;
    const repository = vi.spyOn(github, 'repository');
    const source = vi.spyOn(github, 'issue');
    const claim = vi.spyOn(github, 'getClaim');
    expect(await beginSession(github, store, 'machine', 1, options)).toEqual({ action: 'skip', reason: state.reason });
    expect(repository).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(github.claim.record.phase).toBe('owned');
    expect((await beginSession(github, store, 'machine', 1, { ...options, manual: true })).action).toBe('waiting');
  });

  it('reports unreadable local recovery state instead of silently restarting', async () => {
    const { github, store } = sessionFixture();
    vi.spyOn(store, 'load').mockRejectedValue(new Error('Invalid recovery JSON'));
    const repository = vi.spyOn(github, 'repository');
    await expect(beginSession(github, store, 'machine', 1, options)).rejects.toThrow('Invalid recovery JSON');
    expect(repository).not.toHaveBeenCalled();
  });

  it('does not claim an ineligible issue', async () => {
    const { github, store } = sessionFixture();
    github.issues[0].labels.push('reference-only');
    expect((await beginSession(github, store, 'machine', 1, options)).action).toBe('skip');
    expect(github.claim.record.phase).toBe('owned');
    expect(store.saves).toBe(0);
  });
});

describe('draft wait, edits, and approval', () => {
  it('keeps a complete draft between runs and reports readiness once', async () => {
    const { github, store } = sessionFixture();
    const first = await beginSession(github, store, 'machine', 1, options);
    await acceptDraft(github, store, first.state!, validDraft(first.state!));
    expect(github.claim.record.phase).toBe('owned');
    expect(store.saved?.status).toBe('waiting');
    expect(github.notes).toHaveLength(1);
    const next = await beginSession(github, store, 'machine', 1, { ...options, runId: 'next', codeCommit: 'different' });
    expect(next.action).toBe('waiting');
    expect(next.state?.snapshot.codeCommit).toBe('new-commit');
    expect(next.state?.draft).toEqual(first.state?.draft);
    expect(github.notes).toHaveLength(1);
  });

  it('regenerates an edited waiting draft on the new code commit', async () => {
    const { state, github, store } = sessionFixture();
    store.saved = state;
    github.issues[0].body = 'Changed requirements.';
    const result = await beginSession(github, store, 'machine', 1, options);
    expect(result.action).toBe('draft');
    expect(result.state?.draft).toBeUndefined();
    expect(result.state?.snapshot.codeCommit).toBe('new-commit');
    expect(result.state?.snapshot.source.body).toBe('Changed requirements.');
  });

  it('uses a new approval snapshot but retains an unchanged draft commit', async () => {
    const { state, github, store } = sessionFixture();
    store.saved = state;
    github.issues[0].labels.push('auto-approve');
    const result = await beginSession(github, store, 'machine', 1, options);
    expect(result.action).toBe('publish');
    expect(result.state?.snapshot.approved).toBe(true);
    expect(result.state?.snapshot.codeCommit).toBe('commit');
    expect(github.claim.record.phase).toBe('busy');
    expect(github.notes).toHaveLength(0);
  });

  it('keeps initial approval when labels and closure change during an active run', async () => {
    const { github, store } = sessionFixture();
    github.issues[0].labels.push('auto-approve');
    const result = await beginSession(github, store, 'machine', 1, options);
    github.issues[0].labels = ['reference-only'];
    github.issues[0].state = 'closed';
    await acceptDraft(github, store, result.state!, validDraft(result.state!));
    expect(store.saved?.status).toBe('publishing');
    expect(store.saved?.snapshot.approved).toBe(true);
  });

  it('does not adopt approval added after a run started', async () => {
    const { github, store } = sessionFixture();
    const result = await beginSession(github, store, 'machine', 1, options);
    github.issues[0].labels.push('auto-approve');
    await acceptDraft(github, store, result.state!, validDraft(result.state!));
    expect(store.saved?.status).toBe('waiting');
  });
});

describe('recovery and failure records', () => {
  it('rebuilds missing local drafts with the same remote session identity', async () => {
    const { github, store } = sessionFixture();
    github.issues.push({ ...github.issues[0], id: 2, number: 2, title: 'Implementation Tickets', body: 'Existing group\n<!-- spec-planning:1:session:group:implementation -->' });
    const result = await beginSession(github, store, 'machine', 1, options);
    expect(result.action).toBe('draft');
    expect(result.state?.snapshot.sessionId).toBe('session');
    expect(result.state?.published['group:implementation'].number).toBe(2);
    expect(result.reason).toContain('same breakdown');
  });

  it('stops when the source changed after partial publication', async () => {
    const { state, github, store } = sessionFixture();
    state.published['group:implementation'] = { id: 2, number: 2, title: 'Implementation Tickets', body: 'Existing body' };
    store.saved = state;
    github.issues[0].body = 'Different requirements';
    await expect(beginSession(github, store, 'machine', 1, options)).rejects.toThrow('source changed');
    expect(store.saved?.status).toBe('stopped');
    expect(store.saved?.published['group:implementation'].number).toBe(2);
    expect(github.claim.record.phase).toBe('stopped');
    expect(github.notes).toHaveLength(1);
    expect((await beginSession(github, store, 'machine', 1, options)).action).toBe('skip');
    await expect(beginSession(github, store, 'machine', 1, { ...options, manual: true })).rejects.toThrow('source changed');
  });

  it('stops when a remote publication record no longer has its marker', async () => {
    const { github, store } = sessionFixture();
    github.claim.record.published = { 'ticket:export': 2 };
    await expect(beginSession(github, store, 'machine', 1, options)).rejects.toThrow('no matching session marker');
    expect(github.claim.record.phase).toBe('stopped');
  });

  it('retains the latest saved publication records and reports a failure once', async () => {
    const { github, store } = sessionFixture();
    const result = await beginSession(github, store, 'machine', 1, options);
    store.saved!.published['ticket:export'] = { id: 3, number: 3, title: 'Export', body: 'Saved body' };
    await stopSession(github, store, result.state!, 'Temporary failures exhausted.');
    await stopSession(github, store, result.state!, 'Temporary failures exhausted.');
    expect(store.saved?.published['ticket:export'].number).toBe(3);
    expect(github.claim.record).toMatchObject({ phase: 'stopped', published: { 'ticket:export': 3 } });
    expect(github.notes).toHaveLength(1);
  });

  it('stops after invalid model output and retains the session for manual recovery', async () => {
    const { github, store } = sessionFixture();
    const result = await beginSession(github, store, 'machine', 1, options);
    await expect(acceptDraft(github, store, result.state!, {})).rejects.toThrow('Invalid ticket draft');
    expect(store.saved?.status).toBe('stopped');
    expect(github.claim.record.phase).toBe('stopped');
  });

  it('does not change another run claim when reporting an old failure', async () => {
    const { github, store } = sessionFixture();
    const result = await beginSession(github, store, 'machine', 1, options);
    github.claim.record.runId = 'another-run';
    await stopSession(github, store, result.state!, 'Old run failed.');
    expect(github.claim.record.phase).toBe('busy');
    expect(github.claim.record.runId).toBe('another-run');
    expect(github.notes).toHaveLength(0);
  });

  it('does not overwrite the local record of a later run', async () => {
    const { github, store } = sessionFixture();
    const result = await beginSession(github, store, 'machine', 1, options);
    store.saved!.snapshot.runId = 'later-run';
    store.saved!.status = 'publishing';
    await stopSession(github, store, result.state!, 'Old run failed.');
    expect(store.saved?.snapshot.runId).toBe('later-run');
    expect(store.saved?.status).toBe('publishing');
  });

  it('marks the remote claim stopped even when local persistence fails', async () => {
    const { github, store } = sessionFixture();
    vi.spyOn(store, 'save').mockRejectedValue(new Error('Disk full'));
    await expect(beginSession(github, store, 'machine', 1, options)).rejects.toThrow('Disk full');
    expect(github.claim.record.phase).toBe('stopped');
    expect(github.notes[0].body).toContain('Local recovery storage failed');
  });
});
