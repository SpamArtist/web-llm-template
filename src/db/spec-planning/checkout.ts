import { mkdir, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { command } from './command.js';
import type { Repository } from '../../shared/spec-planning/planning.types.js';
import type { CommandRunner } from './github.types.js';

async function safeDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await safeDirectory(parent);
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Planning checkout directories must not be symbolic links.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(path, { mode: 0o700 });
  }
}

export async function prepareCheckout(repo: Repository, commit: string, path: string,
  run: CommandRunner = command, wait: (ms: number) => Promise<unknown> = setTimeout): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid planning commit.');
  path = resolve(path);
  await safeDirectory(path);
  try {
    const gitDirectory = await lstat(join(path, '.git'));
    if (gitDirectory.isSymbolicLink() || !gitDirectory.isDirectory()) throw new Error('Planning checkout must own its Git directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const git = async (args: string[], retryFetch = false) => {
    for (let attempt = 0; ; attempt++) {
      const result = await run('git', args, path);
      if (!result.failed) return result.stdout.trim();
      const denied = /authentication failed|permission denied|could not read username|repository not found|not authorized|\b40[13]\b/i.test(result.stderr);
      const transient = /timed? ?out|timeout|connection|network|socket|eof|tls handshake|could not resolve|HTTP (?:429|5\d\d)|returned error: (?:429|5\d\d)/i.test(result.stderr);
      if (!retryFetch || denied || !transient || attempt >= 3) throw new Error(`Planning checkout failed: ${result.stderr}`);
      await wait(1000 * 2 ** attempt);
    }
  };
  await git(['init', '--quiet']);
  // gh supplies the existing GitHub login; no model API or separate Git credential is stored.
  await git(['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '--quiet', '--depth=1', repo.cloneUrl, commit], true);
  await git(['checkout', '--quiet', '--detach', commit]);
  if (await git(['rev-parse', 'HEAD']) !== commit || await git(['status', '--porcelain'])) {
    throw new Error('Planning checkout must match the recorded commit and have no local changes.');
  }
}
