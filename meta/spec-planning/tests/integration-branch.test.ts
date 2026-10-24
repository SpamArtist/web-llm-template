import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertIntegrationBranchAbsent, ensureIntegrationBranch, resolveIntegrationBase } from '../db/integration-branch.js';
import { command } from '../db/command.js';
import type { CommandRunner } from '../db/github.types.js';

let root: string;
let repository: string;
let initial: string;
const branch = 'LLM/spec-12-integration';
async function git(args: string[], cwd = repository): Promise<string> {
  const result = await command('git', args, cwd);
  if (result.failed) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function commit(message: string): Promise<string> {
  await git(['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spec-integration-')));
  repository = join(root, 'repo');
  await mkdir(repository);
  await git(['init', '--quiet', '--initial-branch=main']);
  await writeFile(join(repository, 'tracked.txt'), 'committed');
  await git(['add', 'tracked.txt']);
  initial = await commit('fixture');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('safe integration branch preparation', () => {
  it('pins local main and creates integration ref without switching or changing dirty source files', async () => {
    await writeFile(join(repository, 'tracked.txt'), 'unfinished edits');
    await writeFile(join(repository, 'untracked.txt'), 'unfinished addition');
    const before = await git(['status', '--porcelain']);
    const pinned = await resolveIntegrationBase(repository, 'main');
    expect(pinned).toBe(initial);
    await assertIntegrationBranchAbsent(repository, branch);
    await ensureIntegrationBranch(repository, branch, pinned, false);
    expect(await git(['rev-parse', `refs/heads/${branch}`])).toBe(initial);
    expect(await git(['branch', '--show-current'])).toBe('main');
    expect(await git(['status', '--porcelain'])).toBe(before);
    expect(await readFile(join(repository, 'tracked.txt'), 'utf8')).toBe('unfinished edits');
    expect(await readFile(join(repository, 'untracked.txt'), 'utf8')).toBe('unfinished addition');
  });
  it('uses a requested local base and never repins after that branch advances', async () => {
    await git(['branch', 'release/v2']);
    const pinned = await resolveIntegrationBase(repository, 'release/v2');
    const newer = await commit('later main');
    await git(['update-ref', 'refs/heads/release/v2', newer]);
    await ensureIntegrationBranch(repository, branch, pinned, false);
    expect(await git(['rev-parse', `refs/heads/${branch}`])).toBe(initial);
  });
  it('fetches only the exact requested branch from origin when local branch is absent', async () => {
    const remote = join(root, 'origin');
    await git(['clone', '--quiet', '--bare', repository, remote]);
    await git(['update-ref', 'refs/heads/release/v2', initial], remote);
    await git(['remote', 'add', 'origin', remote]);
    expect(await resolveIntegrationBase(repository, 'release/v2')).toBe(initial);
    expect(await git(['rev-parse', 'refs/remotes/origin/release/v2'])).toBe(initial);
    expect(await git(['branch', '--show-current'])).toBe('main');
    await expect(resolveIntegrationBase(repository, 'missing')).rejects.toThrow('Cannot resolve integration base missing');
  });
  it('rejects even same-SHA preexisting branches without retry authorization', async () => {
    await git(['branch', branch]);
    await expect(assertIntegrationBranchAbsent(repository, branch)).rejects.toThrow('collision');
    await expect(ensureIntegrationBranch(repository, branch, initial, false)).rejects.toThrow('collision');
    await ensureIntegrationBranch(repository, branch, initial, true);
  });
  it('never resets a different integration tip on retry', async () => {
    await ensureIntegrationBranch(repository, branch, initial, false);
    const newer = await commit('later main');
    await git(['update-ref', `refs/heads/${branch}`, newer]);
    await expect(ensureIntegrationBranch(repository, branch, initial, true)).rejects.toThrow('collision');
    expect(await git(['rev-parse', `refs/heads/${branch}`])).toBe(newer);
  });
  it('rejects reusing a matching branch already attached to a worktree', async () => {
    await ensureIntegrationBranch(repository, branch, initial, false);
    await git(['worktree', 'add', '--quiet', join(root, 'other-work'), branch]);
    await expect(ensureIntegrationBranch(repository, branch, initial, true)).rejects.toThrow('already checked out');
  });
  it('rejects symbolic branch aliases rather than modifying their target', async () => {
    await git(['symbolic-ref', `refs/heads/${branch}`, 'refs/heads/main']);
    await expect(ensureIntegrationBranch(repository, branch, initial, true)).rejects.toThrow('symbolic reference');
    expect(await git(['rev-parse', 'refs/heads/main'])).toBe(initial);
  });
  it('rejects unsafe input before any Git calls', async () => {
    const run = vi.fn<CommandRunner>();
    await expect(resolveIntegrationBase(repository, 'main;touch /tmp/unwanted', run)).rejects.toThrow('Invalid');
    await expect(ensureIntegrationBranch(repository, branch, 'main', false, run)).rejects.toThrow('Invalid');
    expect(run).not.toHaveBeenCalled();
  });
});
