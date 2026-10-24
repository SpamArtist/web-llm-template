import { describe, expect, it, vi } from 'vitest';
import { beginHandoffCreation, enrollLegacyHandoff, inspectHandoff, prepareHandoff, recordHandoffThread, recoverHandoff, reserveHandoff, seedHandoff } from '../use-cases/handoff.js';
import { validateHandoff } from '../shared/handoff.js';
import { FakeGitHub, initialState } from './publish-fixture.js';

const baseCommit = 'a'.repeat(40);
const identity = { sourceNumber: 1, ownerId: 'machine' };
const execution = { ...identity, executorSessionId: 'executor' };
const reservation = { ...execution, projectId: 'project', checkoutRoot: '/checkout' };

function completed(automatic = true): FakeGitHub {
  const github = new FakeGitHub(initialState());
  github.claim.record = { ...github.claim.record, phase: 'complete', runId: null, published: { 'group:implementation': 2, 'group:code-review': 3, 'group:performance-review': 4, 'ticket:first': 6, 'ticket:last': 9 }, ...(automatic ? { handoff: seedHandoff('example/template', 1, 'session', '') } : {}) };
  return github;
}

async function prepared(github = completed()): Promise<FakeGitHub> {
  await reserveHandoff(github, { ...reservation, expectedSha: github.claim.sha });
  await prepareHandoff(github, { ...execution, expectedSha: github.claim.sha, baseCommit });
  return github;
}

async function creating(github = completed()): Promise<FakeGitHub> {
  await prepared(github);
  await beginHandoffCreation(github, { ...execution, expectedSha: github.claim.sha });
  return github;
}

describe('durable publication handoff', () => {
  it('uses exact membership and only creates from a fresh successful reservation transition', async () => {
    const github = completed();
    expect(await inspectHandoff(github, 1, 'machine')).toMatchObject({ action: 'reserve', tickets: [6, 9] });
    await prepared(github);
    const request = { ...execution, expectedSha: github.claim.sha };
    expect(await beginHandoffCreation(github, request)).toMatchObject({ action: 'create' });
    expect(await beginHandoffCreation(github, request)).toMatchObject({ action: 'reconcile' });
    expect(github.claim.record).toMatchObject({ phase: 'complete', handoff: { status: 'creating', baseCommit, executorSessionId: 'executor' } });
  });

  it('never auto-enrolls old completed publications', async () => {
    const github = completed(false);
    expect(await inspectHandoff(github, 1, 'machine')).toMatchObject({ action: 'none' });
    expect(await reserveHandoff(github, { ...reservation, expectedSha: '1' })).toMatchObject({ action: 'none' });
    expect(github.writes).toEqual([]);
    await expect(enrollLegacyHandoff(github, { ...identity, expectedSha: '1', repo: 'example/template', sourceBody: github.issues[0].body, manual: false })).rejects.toThrow('explicit manual');
    expect(await enrollLegacyHandoff(github, { ...identity, expectedSha: '1', repo: 'example/template', sourceBody: github.issues[0].body, manual: true })).toMatchObject({ action: 'reserve' });
  });

  it('rejects stale legacy source, foreign repository, and reference-only ancestry', async () => {
    const github = completed(false);
    const request = { ...identity, expectedSha: '1', repo: 'example/template', sourceBody: github.issues[0].body, manual: true };
    await expect(enrollLegacyHandoff(github, { ...request, sourceBody: 'stale' })).rejects.toThrow('current source');
    await expect(enrollLegacyHandoff(github, { ...request, repo: 'other/template' })).rejects.toThrow('repository does not match');
    github.issues[0].labels.push('reference-only');
    await expect(enrollLegacyHandoff(github, request)).rejects.toThrow('reference-only');
    expect(github.writes).toEqual([]);
  });

  it('reserves once across competing executors and never steals an existing reservation', async () => {
    const github = completed();
    const attempts = await Promise.allSettled([
      reserveHandoff(github, { ...reservation, expectedSha: '1' }),
      reserveHandoff(github, { ...reservation, expectedSha: '1', executorSessionId: 'competitor' }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(github.writes).toEqual(['claim']);
    expect(await reserveHandoff(github, { ...reservation, expectedSha: '1', executorSessionId: 'competitor' })).toMatchObject({ claim: { record: { handoff: { executorSessionId: 'executor' } } } });
    await expect(prepareHandoff(github, { ...execution, executorSessionId: 'competitor', expectedSha: github.claim.sha, baseCommit })).rejects.toThrow('another executor');
  });

  it('allows exactly one caller to receive create authorization during a race', async () => {
    const github = await prepared();
    const request = { ...execution, expectedSha: github.claim.sha };
    const update = github.updateClaim.bind(github);
    // Production claim adapter accepts matching durable writes after a lost response.
    // Distinct creation attempts must not become matching writes across concurrent callers.
    vi.spyOn(github, 'updateClaim').mockImplementation(async (claim, record) => {
      const saved = await update(claim, record);
      if (!saved && JSON.stringify(github.claim.record) === JSON.stringify(record)) return structuredClone(github.claim);
      return saved;
    });
    const attempts = await Promise.allSettled([beginHandoffCreation(github, request), beginHandoffCreation(github, request)]);
    expect(attempts.filter((result) => result.status === 'fulfilled' && result.value.action === 'create')).toHaveLength(1);
    expect(await beginHandoffCreation(github, request)).toMatchObject({ action: 'reconcile' });
  });

  it('reconciles unknown creation even when a successful CAS response was lost', async () => {
    const github = await prepared();
    const update = github.updateClaim.bind(github);
    vi.spyOn(github, 'updateClaim').mockImplementationOnce(async (claim, record) => {
      await update(claim, record);
      throw new Error('Response lost');
    });
    const request = { ...execution, expectedSha: github.claim.sha };
    await expect(beginHandoffCreation(github, request)).rejects.toThrow('Response lost');
    expect(await beginHandoffCreation(github, request)).toMatchObject({ action: 'reconcile' });
    expect(github.claim.record.handoff?.status).toBe('creating');
  });

  it('keeps queued IDs separate from ready thread IDs and records eventual completion', async () => {
    const github = await creating();
    const queued = { ...execution, expectedSha: github.claim.sha, clientThreadId: 'pending-client' };
    expect(await recordHandoffThread(github, queued)).toMatchObject({ action: 'reconcile' });
    expect(github.claim.record.handoff?.threadId).toBeUndefined();
    expect(await recordHandoffThread(github, queued)).toMatchObject({ action: 'reconcile' });
    await expect(recordHandoffThread(github, { ...queued, expectedSha: github.claim.sha, clientThreadId: 'different' })).rejects.toThrow('different creation');
    const ready = { ...execution, expectedSha: github.claim.sha, threadId: 'ready-thread', hostId: 'local' };
    expect(await recordHandoffThread(github, ready)).toMatchObject({ action: 'launched' });
    expect(await recordHandoffThread(github, ready)).toMatchObject({ action: 'launched' });
    await expect(recordHandoffThread(github, { ...ready, threadId: 'replacement' })).rejects.toThrow('cannot be replaced');
    expect(github.claim.record.handoff).toMatchObject({ clientThreadId: 'pending-client', threadId: 'ready-thread', hostId: 'local' });
  });

  it('lets the same owner reconcile a discovered native chat from a later executor without transferring create permission', async () => {
    const github = await creating();
    const stale = github.claim.sha;
    await recordHandoffThread(github, { ...execution, expectedSha: github.claim.sha, clientThreadId: 'pending-client' });
    const later = { ...execution, executorSessionId: 'later-scheduled-run', threadId: 'found-native-thread', hostId: 'local' };
    await expect(recordHandoffThread(github, { ...later, expectedSha: stale })).rejects.toThrow('claim changed');
    expect(await recordHandoffThread(github, { ...later, expectedSha: github.claim.sha })).toMatchObject({ action: 'launched' });
    expect(github.claim.record.handoff).toMatchObject({ executorSessionId: 'executor', threadId: 'found-native-thread', clientThreadId: 'pending-client' });
    await expect(beginHandoffCreation(github, { ...later, expectedSha: github.claim.sha })).rejects.toThrow('another executor');
    expect(await beginHandoffCreation(github, { ...execution, expectedSha: github.claim.sha })).toMatchObject({ action: 'launched' });
  });

  it('pins the resolved base commit across retries and recovery', async () => {
    const github = await prepared();
    expect(await inspectHandoff(github, 1, 'machine')).toMatchObject({ action: 'prepare-branch' });
    await expect(prepareHandoff(github, { ...execution, expectedSha: github.claim.sha, baseCommit: 'b'.repeat(40) })).rejects.toThrow('already pinned');
    await recoverHandoff(github, { ...identity, expectedSha: github.claim.sha, confirmedStopped: true });
    const marker = github.claim.record.handoff?.marker;
    expect(await reserveHandoff(github, { ...reservation, executorSessionId: 'replacement', expectedSha: github.claim.sha })).toMatchObject({ action: 'prepare-branch', claim: { record: { handoff: { baseCommit, marker } } } });
  });

  it('requires explicit stopped confirmation and authoritative absence before retrying unknown creation', async () => {
    const github = await creating();
    const request = { ...identity, expectedSha: github.claim.sha, confirmedStopped: true };
    await expect(recoverHandoff(github, { ...request, confirmedStopped: false, confirmedAbsent: true })).rejects.toThrow('stopped executor');
    await expect(recoverHandoff(github, request)).rejects.toThrow('authoritative confirmation');
    await expect(recoverHandoff(github, { ...request, expectedSha: 'stale', confirmedAbsent: true })).rejects.toThrow('claim changed');
    expect(await recoverHandoff(github, { ...request, confirmedAbsent: true })).toMatchObject({ action: 'reserve' });
    expect(github.claim.record.handoff?.executorSessionId).toBeUndefined();
  });

  it('cannot reset a launched chat even with stop and absence confirmations', async () => {
    const github = await creating();
    await recordHandoffThread(github, { ...execution, expectedSha: github.claim.sha, threadId: 'thread', hostId: 'local' });
    await expect(recoverHandoff(github, { ...identity, expectedSha: github.claim.sha, confirmedStopped: true, confirmedAbsent: true })).rejects.toThrow('cannot reset');
  });

  it('rejects foreign owner, incomplete publication, duplicate members, and planning executor reuse', async () => {
    const github = completed();
    await expect(inspectHandoff(github, 1, 'foreign')).rejects.toThrow('registered planner');
    github.claim.record.phase = 'busy';
    await expect(inspectHandoff(github, 1, 'machine')).rejects.toThrow('completed claim');
    github.claim.record.phase = 'complete';
    await expect(reserveHandoff(github, { ...reservation, expectedSha: '1', executorSessionId: 'session' })).rejects.toThrow('distinct executor');
    github.claim.record.published!['ticket:last'] = 6;
    await expect(inspectHandoff(github, 1, 'machine')).rejects.toThrow('duplicate');
    delete github.claim.record.published!['group:implementation'];
    await expect(inspectHandoff(github, 1, 'machine')).rejects.toThrow('complete verified publication');
    expect(github.writes).toEqual([]);
  });

  it('requires full base SHA and durable intent before accepting thread results', async () => {
    const github = completed();
    await reserveHandoff(github, { ...reservation, expectedSha: '1' });
    await expect(prepareHandoff(github, { ...execution, expectedSha: github.claim.sha, baseCommit: 'main' })).rejects.toThrow('full Git commit SHA');
    await expect(beginHandoffCreation(github, { ...execution, expectedSha: github.claim.sha })).rejects.toThrow('pinned base');
    await expect(recordHandoffThread(github, { ...execution, expectedSha: github.claim.sha, threadId: 'ready', hostId: 'local' })).rejects.toThrow('durable creation intent');
  });
});


describe('durable handoff validation', () => {
  it.each([
    { status: 'unknown' },
    { version: 2 },
    { repo: 'other/repo' },
    { marker: 'wrong-marker' },
    { baseBranch: 'main~1' },
    { integrationBranch: 'main' },
    { baseCommit: 'short-sha' },
    { executorSessionId: 'unreserved' },
    { clientThreadId: 'unstarted' },
    { status: 'reserved' },
    { status: 'creating' },
    { status: 'launched' },
  ])('rejects malformed stored handoff %j', async (change) => {
    const github = completed();
    Object.assign(github.claim.record.handoff!, change);
    await expect(inspectHandoff(github, 1, 'machine')).rejects.toThrow('Invalid durable handoff');
    await expect(reserveHandoff(github, { ...reservation, expectedSha: '1' })).rejects.toThrow('Invalid durable handoff');
    expect(github.writes).toEqual([]);
  });

  it('rejects creating without base SHA and launched without actual thread and host', async () => {
    const github = await creating();
    const record = github.claim.record.handoff!;
    expect(() => validateHandoff({ ...record, baseCommit: undefined }, 1, 'session')).toThrow('Invalid durable handoff');
    expect(() => validateHandoff({ ...record, status: 'launched', clientThreadId: 'queued' }, 1, 'session')).toThrow('Invalid durable handoff');
    expect(() => validateHandoff({ ...record, status: 'launched', threadId: 'ready' }, 1, 'session')).toThrow('Invalid durable handoff');
    expect(() => validateHandoff({ ...record, status: 'creating', threadId: 'ready', hostId: 'local' }, 1, 'session')).toThrow('Invalid durable handoff');
  });
});
