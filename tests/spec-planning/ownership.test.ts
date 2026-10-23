import { describe, expect, it, vi } from 'vitest';
import { recoverSession, transferSession } from '../../src/server/use-cases/spec-planning/ownership.js';
import { FakeGitHub, initialState } from './publish-fixture.js';

describe('explicit session recovery', () => {
  it('stops only the current busy claim owned by the requesting app', async () => {
    const github = new FakeGitHub(initialState());
    await recoverSession(github, 1, 'machine', '1');
    expect(github.claim.record).toMatchObject({ ownerId: 'machine', phase: 'stopped', runId: null });
    expect(github.claim.sha).toBe('2');
  });
  it.each([['other-machine', '1'], ['machine', 'old-sha']])('rejects owner/SHA mismatch %s %s', async (owner, sha) => {
    const github = new FakeGitHub(initialState());
    await expect(recoverSession(github, 1, owner, sha)).rejects.toThrow('current busy claim');
    expect(github.writes).toEqual([]);
  });
  it.each(['owned', 'stopped', 'complete'] as const)('does not recover a %s claim', async (phase) => {
    const github = new FakeGitHub(initialState());
    github.claim.record.phase = phase;
    await expect(recoverSession(github, 1, 'machine', '1')).rejects.toThrow('current busy claim');
  });
  it('reports a lost concurrent recovery update', async () => {
    const github = new FakeGitHub(initialState());
    vi.spyOn(github, 'updateClaim').mockResolvedValue(null);
    await expect(recoverSession(github, 1, 'machine', '1')).rejects.toThrow('changed during recovery');
  });
});

describe('explicit session transfer', () => {
  it.each(['owned', 'stopped'] as const)('transfers a current %s claim and requires manual restart', async (phase) => {
    const github = new FakeGitHub(initialState());
    github.claim.record.phase = phase;
    await transferSession(github, 1, 'new-machine', '1');
    expect(github.claim.record).toMatchObject({ ownerId: 'new-machine', phase: 'stopped', runId: null });
  });
  it.each(['busy', 'complete'] as const)('refuses transfer of a %s claim', async (phase) => {
    const github = new FakeGitHub(initialState());
    github.claim.record.phase = phase;
    await expect(transferSession(github, 1, 'new-machine', '1')).rejects.toThrow('current inactive claim');
    expect(github.writes).toEqual([]);
  });
  it('rejects a stale SHA and a lost concurrent update', async () => {
    const github = new FakeGitHub(initialState());
    github.claim.record.phase = 'owned';
    await expect(transferSession(github, 1, 'new-machine', 'old-sha')).rejects.toThrow('current inactive claim');
    vi.spyOn(github, 'updateClaim').mockResolvedValue(null);
    await expect(transferSession(github, 1, 'new-machine', '1')).rejects.toThrow('changed during transfer');
  });
  it('transfers a busy claim only after explicit confirmation that its process stopped', async () => {
    const github = new FakeGitHub(initialState());
    await transferSession(github, 1, 'new-machine', '1', true);
    expect(github.claim.record).toMatchObject({ ownerId: 'new-machine', phase: 'stopped', runId: null });
    expect(github.claim.sha).toBe('2');
  });
  it('still rejects stale and completed claims after stop confirmation', async () => {
    const github = new FakeGitHub(initialState());
    await expect(transferSession(github, 1, 'new-machine', 'old-sha', true)).rejects.toThrow('current inactive claim');
    github.claim.record.phase = 'complete';
    await expect(transferSession(github, 1, 'new-machine', '1', true)).rejects.toThrow('Completed sessions cannot transfer');
    expect(github.writes).toEqual([]);
  });
  it('does not accept a concurrent ownership change after stop confirmation', async () => {
    const github = new FakeGitHub(initialState());
    vi.spyOn(github, 'updateClaim').mockResolvedValue(null);
    await expect(transferSession(github, 1, 'new-machine', '1', true)).rejects.toThrow('changed during transfer');
  });
});
