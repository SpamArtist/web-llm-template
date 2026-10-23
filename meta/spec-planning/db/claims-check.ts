import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command } from './command';
import { createRequest, GitHubError, repositoryFromOrigin } from './github-transport';
import type { GitCommit, GitRef, RawRepository } from './github.types';
import type { ClaimCheckEvidence } from './claims-check.types';

// This opt-in live probe creates only a unique disposable ref. It never uses
// production spec claim names or writes issues. Run once before enabling setup.
export async function checkLiveClaims(root: string): Promise<ClaimCheckEvidence> {
  const origin = await command('git', ['remote', 'get-url', 'origin'], root);
  if (origin.failed) throw new Error('Cannot read repository origin.');
  const slug = repositoryFromOrigin(origin.stdout.trim());
  const request = createRequest(root);
  const prefix = `repos/${slug}`;
  const ref = `heads/LLM/spec-planning-check-${randomUUID()}`;
  const evidence: ClaimCheckEvidence = { repository: slug, ref, startedAt: new Date().toISOString(), passed: false, cleaned: false };
  const knownShas = new Set<string>();
  const readRef = () => request<GitRef>('GET', `${prefix}/git/ref/${ref}`);
  const race = async (operations: Promise<unknown>[]) => {
    const results = await Promise.allSettled(operations);
    const descriptions = results.map((result) => result.status === 'fulfilled' ? 'accepted'
      : result.reason instanceof GitHubError ? `HTTP ${result.reason.status}` : 'failed');
    if (results.filter((result) => result.status === 'fulfilled').length !== 1
      || results.some((result) => result.status === 'rejected'
        && !(result.reason instanceof GitHubError && [409, 422].includes(result.reason.status)))) {
      throw new Error(`Concurrent ref check failed: ${descriptions.join(', ')}.`);
    }
    return descriptions;
  };
  try {
    const repository = await request<RawRepository>('GET', prefix);
    const base = await request<GitRef>('GET', `${prefix}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`);
    const parent = await request<GitCommit>('GET', `${prefix}/git/commits/${base.object.sha}`);
    const commit = async (parentSha: string, name: string) => {
      const value = await request<GitCommit>('POST', `${prefix}/git/commits`, {
        message: `${ref}: ${name}`, tree: parent.tree.sha, parents: [parentSha],
      });
      knownShas.add(value.sha);
      return value.sha;
    };
    const initial = await Promise.all([commit(base.object.sha, 'create-a'), commit(base.object.sha, 'create-b')]);
    evidence.createResults = await race(initial.map((sha) => request('POST', `${prefix}/git/refs`, { ref: `refs/${ref}`, sha })));
    evidence.initialSha = (await readRef()).object.sha;
    if (!initial.includes(evidence.initialSha)) throw new Error('Initial ref does not match either contender.');
    const siblings = await Promise.all([commit(evidence.initialSha, 'update-a'), commit(evidence.initialSha, 'update-b')]);
    evidence.updateResults = await race(siblings.map((sha) => request('PATCH', `${prefix}/git/refs/${ref}`, { sha, force: false })));
    evidence.finalSha = (await readRef()).object.sha;
    if (!siblings.includes(evidence.finalSha)) throw new Error('Updated ref does not match either contender.');
    const winner = await request<GitCommit>('GET', `${prefix}/git/commits/${evidence.finalSha}`);
    if (winner.parents.length !== 1 || winner.parents[0].sha !== evidence.initialSha) throw new Error('Winner is not a direct child of the original claim.');
    evidence.passed = true;
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : 'Unknown live check failure.';
  }
  try {
    const current = await readRef();
    if (!knownShas.has(current.object.sha)) throw new Error('Disposable ref changed outside this probe; cleanup refused.');
    const expected = evidence.finalSha ?? current.object.sha;
    if (current.object.sha !== expected) throw new Error('Disposable ref does not match the verified SHA; cleanup refused.');
    await request('DELETE', `${prefix}/git/refs/${ref}`);
    try { await readRef(); throw new Error('Disposable ref still exists after cleanup.'); }
    catch (error) { if (!(error instanceof GitHubError && error.status === 404)) throw error; }
    evidence.cleaned = true;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) evidence.cleaned = true;
    else evidence.error = `${evidence.error ?? ''} Cleanup: ${error instanceof Error ? error.message : 'failed'}`.trim();
  }
  evidence.completedAt = new Date().toISOString();
  const directory = resolve(root, '.artifacts/spec-planning-implementation');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'claim-check.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await checkLiveClaims(process.cwd());
  console.log(JSON.stringify({ passed: result.passed, cleaned: result.cleaned, error: result.error }));
  if (!result.passed || !result.cleaned) process.exitCode = 1;
}
