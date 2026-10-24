import { command } from './command.js';
import type { CommandRunner } from './github.types.js';
import { validateBranchName } from '../shared/orchestrator-prompt.js';

function commitSha(value: string): string {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('Invalid integration base commit.');
  return value;
}

export async function assertIntegrationBranchAbsent(root: string, branch: string, run: CommandRunner = command): Promise<void> {
  validateBranchName(branch);
  const existing = await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root);
  if (!existing.failed) throw new Error(`Integration branch collision: ${branch}. Existing branches are never reset.`);
}

async function assertBranchNotCheckedOut(root: string, ref: string, run: CommandRunner): Promise<void> {
  const worktrees = await run('git', ['worktree', 'list', '--porcelain'], root);
  if (worktrees.failed) throw new Error(`Cannot inspect integration worktrees: ${worktrees.stderr}`);
  if (worktrees.stdout.split('\n').includes(`branch ${ref}`)) {
    throw new Error('Integration branch is already checked out in another worktree.');
  }
}

export async function resolveIntegrationBase(root: string, baseBranch: string, run: CommandRunner = command): Promise<string> {
  validateBranchName(baseBranch);
  const local = await run('git', ['rev-parse', '--verify', `refs/heads/${baseBranch}^{commit}`], root);
  if (!local.failed) return commitSha(local.stdout.trim());
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  const fetched = await run('git', ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', `+refs/heads/${baseBranch}:${remoteRef}`], root);
  if (fetched.failed) throw new Error(`Cannot resolve integration base ${baseBranch}: ${fetched.stderr}`);
  const remote = await run('git', ['rev-parse', '--verify', `${remoteRef}^{commit}`], root);
  if (remote.failed) throw new Error(`Cannot resolve integration base ${baseBranch}: ${remote.stderr}`);
  return commitSha(remote.stdout.trim());
}

// Persist the pinned SHA and branch-creation intent before calling. allowExisting is only for that intent's retry.
export async function ensureIntegrationBranch(root: string, branch: string, baseSha: string,
  allowExisting: boolean, run: CommandRunner = command): Promise<void> {
  validateBranchName(branch);
  commitSha(baseSha);
  const ref = `refs/heads/${branch}`;
  const symbolic = await run('git', ['symbolic-ref', '--quiet', ref], root);
  if (!symbolic.failed) throw new Error(`Integration branch collision: ${branch} is a symbolic reference.`);
  const existing = await run('git', ['rev-parse', '--verify', ref], root);
  if (!existing.failed) {
    if (allowExisting && existing.stdout.trim() === baseSha) {
      await assertBranchNotCheckedOut(root, ref, run);
      return;
    }
    throw new Error(`Integration branch collision: ${branch}. Existing branches are never reset.`);
  }
  // Compare-and-swap against an absent ref: a concurrent branch creation cannot be overwritten.
  const created = await run('git', ['update-ref', '--no-deref', ref, baseSha, '0'.repeat(40)], root);
  if (created.failed) {
    const concurrent = await run('git', ['rev-parse', '--verify', ref], root);
    if (allowExisting && !concurrent.failed && concurrent.stdout.trim() === baseSha) {
      await assertBranchNotCheckedOut(root, ref, run);
      return;
    }
    throw new Error(`Cannot create integration branch ${branch}: ${created.stderr}`);
  }
}
