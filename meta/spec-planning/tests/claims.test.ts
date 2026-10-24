import { describe, expect, it } from 'vitest';
import { createClaims } from '../db/claims';
import { GitHubError } from '../db/github-transport';
import type { GitCommit, GitHubRequest } from '../db/github.types';
import type { ClaimRecord } from '../shared/planning.types';

const repository = async () => ({ slug: 'example/template', defaultBranch: 'main', defaultSha: 'base', cloneUrl: 'https://github.com/example/template.git', canPush: true });
const record = (ownerId: string, runId: string | null = null): ClaimRecord => ({
  version: 1, sourceNumber: 7, ownerId, sessionId: `session-${ownerId}`, phase: runId ? 'busy' : 'owned', runId,
});

function fakeGitHub() {
  const commits = new Map<string, GitCommit>([['base', { sha: 'base', message: 'Source', tree: { sha: 'tree' }, parents: [] }]]);
  const refs = new Map<string, string>();
  let loseNextWrite = false;
  let failure: number | undefined;
  const request: GitHubRequest = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    if (failure !== undefined) throw new GitHubError(failure);
    const input = body as { sha: string; tree: string; parents: string[]; message: string; ref: string; force: boolean };
    if (method === 'GET' && path === '/git/matching-refs/heads/LLM/spec-planning/') {
      return [...refs].map(([ref, sha]) => ({ ref: `refs/${ref}`, object: { sha } })) as T;
    }
    if (method === 'GET' && path.startsWith('/git/ref/')) {
      const sha = refs.get(path.slice('/git/ref/'.length));
      if (!sha) throw new GitHubError(404);
      return { object: { sha } } as T;
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) {
      const commit = commits.get(path.slice('/git/commits/'.length));
      if (!commit) throw new GitHubError(404);
      return commit as T;
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = `commit-${commits.size}`;
      const commit = { sha, message: input.message, tree: { sha: input.tree }, parents: input.parents.map((sha) => ({ sha })) };
      commits.set(sha, commit);
      return commit as T;
    }
    if (method === 'POST' && path === '/git/refs') {
      const key = input.ref.slice('refs/'.length);
      if (refs.has(key)) throw new GitHubError(422);
      refs.set(key, input.sha);
    } else if (method === 'PATCH' && path.startsWith('/git/refs/')) {
      const key = path.slice('/git/refs/'.length);
      const commit = commits.get(input.sha);
      expect(input.force).toBe(false);
      // Enforce the actual fast-forward boundary rather than mock a winning CAS.
      if (commit?.parents.length !== 1 || commit.parents[0].sha !== refs.get(key)) throw new GitHubError(422);
      refs.set(key, input.sha);
    } else throw new Error(`Unexpected operation ${method} ${path}`);
    if (loseNextWrite) { loseNextWrite = false; throw new GitHubError(0, true); }
    return undefined as T;
  };
  return {
    request, commits, refs,
    loseResponse: () => { loseNextWrite = true; },
    fail: (status: number) => { failure = status; },
  };
}

describe('shared spec claims', () => {
  it('lists shared records independently of source labels and ignores neighboring refs', async () => {
    const fake = fakeGitHub();
    const claims = createClaims(fake.request, repository);
    const claim = await claims.createClaim(record('machine-a'));
    fake.refs.set('heads/LLM/spec-planning/7-unrelated', 'base');
    expect(await claims.listClaims()).toEqual([claim]);
  });
  it('allows exactly one machine to claim a spec during a race', async () => {
    const fake = fakeGitHub();
    const first = createClaims(fake.request, repository);
    const second = createClaims(fake.request, repository);
    const results = await Promise.all([first.createClaim(record('machine-a')), second.createClaim(record('machine-b'))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const claim = await first.getClaim(7);
    expect(claim).toEqual(results.find(Boolean));
    expect(fake.refs.size).toBe(1);
    expect(fake.refs.has('heads/LLM/spec-planning/7')).toBe(true);
    expect(fake.commits.get(claim!.sha)?.tree.sha).toBe('tree');
  });
  it('allows only one scheduled or manual run to take an existing claim', async () => {
    const fake = fakeGitHub();
    const claims = createClaims(fake.request, repository);
    const owned = (await claims.createClaim(record('machine-a')))!;
    const results = await Promise.all([
      claims.updateClaim(owned, record('machine-a', 'manual')),
      claims.updateClaim(owned, record('machine-a', 'scheduled')),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.find(Boolean)!;
    expect(await claims.getClaim(7)).toEqual(winner);
    expect(fake.commits.get(winner.sha)?.parents).toEqual([{ sha: owned.sha }]);
  });
  it('recovers a lost create response by reading the exact intended record', async () => {
    const fake = fakeGitHub();
    const claims = createClaims(fake.request, repository);
    fake.loseResponse();
    const claim = await claims.createClaim(record('machine-a'));
    expect(claim?.record).toEqual(record('machine-a'));
    expect(fake.refs.size).toBe(1);
  });
  it('recovers a lost update response and keeps completed ownership', async () => {
    const fake = fakeGitHub();
    const claims = createClaims(fake.request, repository);
    const owned = (await claims.createClaim(record('machine-a')))!;
    fake.loseResponse();
    const completed = await claims.updateClaim(owned, { ...owned.record, phase: 'complete' });
    expect(completed?.record.phase).toBe('complete');
    expect(await claims.getClaim(7)).toEqual(completed);
    expect(await claims.createClaim(record('machine-b'))).toBeNull();
  });
  it('returns null only for missing ref, and propagates permission errors', async () => {
    const fake = fakeGitHub();
    const claims = createClaims(fake.request, repository);
    expect(await claims.getClaim(7)).toBeNull();
    fake.fail(403);
    await expect(claims.getClaim(7)).rejects.toThrow('403');
  });
  it('does not reset a malformed or foreign claim', async () => {
    const fake = fakeGitHub();
    fake.refs.set('heads/LLM/spec-planning/7', 'base');
    const claims = createClaims(fake.request, repository);
    await expect(claims.getClaim(7)).rejects.toThrow('does not contain');
    await expect(claims.createClaim(record('machine-a'))).rejects.toThrow('does not contain');
    expect(fake.refs.get('heads/LLM/spec-planning/7')).toBe('base');
  });
});
