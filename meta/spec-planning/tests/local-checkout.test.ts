import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCheckout } from '../db/checkout.js';
import { command } from '../db/command.js';
import type { CommandRunner } from '../db/github.types.js';
import type { Repository } from '../shared/planning.types.js';

let root: string;
const commit = 'a'.repeat(40);
const repo: Repository = { slug: 'example/template', defaultBranch: 'main', defaultSha: commit, cloneUrl: 'https://github.com/example/template.git', canPush: true };
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'spec-planning-checkout-'))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const success = (stdout = '') => ({ stdout, stderr: '', failed: false });

describe('isolated planning checkout', () => {
  it('uses the recorded commit without copying dirty source files, and rejects later checkout dirt', async () => {
    const source = join(root, 'source');
    await mkdir(source);
    const git = async (args: string[]) => {
      const result = await command('git', args, source);
      if (result.failed) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    await git(['init', '--quiet']);
    await writeFile(join(source, 'tracked.txt'), 'committed source');
    await git(['add', 'tracked.txt']);
    await git(['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    const sha = await git(['rev-parse', 'HEAD']);
    await writeFile(join(source, 'tracked.txt'), 'unfinished edits');
    await writeFile(join(source, 'untracked.txt'), 'unfinished addition');
    const target = join(root, 'planning', sha);
    await prepareCheckout({ ...repo, cloneUrl: source, defaultSha: sha }, sha, target);
    expect(await readFile(join(target, 'tracked.txt'), 'utf8')).toBe('committed source');
    await expect(readFile(join(target, 'untracked.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe('unfinished edits');
    expect(await readFile(join(source, 'untracked.txt'), 'utf8')).toBe('unfinished addition');
    await writeFile(join(target, 'unexpected.txt'), 'do not overwrite this');
    await expect(prepareCheckout({ ...repo, cloneUrl: source }, sha, target)).rejects.toThrow('no local changes');
    expect(await readFile(join(target, 'unexpected.txt'), 'utf8')).toBe('do not overwrite this');
  });
  it('rejects a checkout parent symlink before creating files outside storage', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, 'checkouts'));
    const run = vi.fn<CommandRunner>();
    await expect(prepareCheckout(repo, commit, join(root, 'checkouts', commit), run)).rejects.toThrow('symbolic links');
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(join(outside, commit, '.git/config'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects an external Git directory file before running Git', async () => {
    const target = join(root, 'checkout');
    await mkdir(target);
    await writeFile(join(target, '.git'), 'gitdir: /external/repository');
    const run = vi.fn<CommandRunner>();
    await expect(prepareCheckout(repo, commit, target, run)).rejects.toThrow('own its Git directory');
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects invalid commits before filesystem or command work', async () => {
    const run = vi.fn<CommandRunner>();
    await expect(prepareCheckout(repo, '../other', join(root, 'checkout'), run)).rejects.toThrow('Invalid planning commit');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('bounded checkout fetch retries', () => {
  it('retries only transient fetch failures, with three bounded delays', async () => {
    let fetches = 0;
    const run = vi.fn<CommandRunner>(async (_program, args) => {
      if (args.includes('fetch') && ++fetches <= 3) return { failed: true, stdout: '', stderr: 'connection timed out' };
      return success(args.includes('rev-parse') ? commit : '');
    });
    const wait = vi.fn().mockResolvedValue(undefined);
    await prepareCheckout(repo, commit, join(root, 'checkout'), run, wait);
    expect(fetches).toBe(4);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect(run.mock.calls.filter(([, args]) => args.includes('init'))).toHaveLength(1);
  });
  it('stops after three retries when the service remains unavailable', async () => {
    const run = vi.fn<CommandRunner>(async (_program, args) => args.includes('fetch')
      ? { failed: true, stdout: '', stderr: 'The requested URL returned error: 503' } : success());
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(prepareCheckout(repo, commit, join(root, 'checkout'), run, wait)).rejects.toThrow('503');
    expect(run.mock.calls.filter(([, args]) => args.includes('fetch'))).toHaveLength(4);
    expect(wait).toHaveBeenCalledTimes(3);
  });
  it.each(['Authentication failed', 'Permission denied (publickey).', 'The requested URL returned error: 403', 'Repository not found.'])('does not retry %s', async (stderr) => {
    const run = vi.fn<CommandRunner>(async (_program, args) => args.includes('fetch') ? { failed: true, stdout: '', stderr } : success());
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(prepareCheckout(repo, commit, join(root, 'checkout'), run, wait)).rejects.toThrow(stderr);
    expect(run.mock.calls.filter(([, args]) => args.includes('fetch'))).toHaveLength(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
