import { setTimeout } from 'node:timers/promises';
import { command } from './command';
import type { CommandRunner, GitHubRequest } from './github.types';

export class GitHubError extends Error {
  constructor(public readonly status: number, public readonly transient = false) {
    super(status ? `GitHub request failed (HTTP ${status}).` : 'GitHub CLI or network request failed.');
  }
}

export class UnsupportedDependenciesError extends Error {
  constructor() {
    super('Native GitHub issue dependencies are unavailable.');
    this.name = 'UnsupportedDependenciesError';
  }
}

export function repositoryFromOrigin(origin: string): string {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(origin.trim());
  if (!match || match[1].split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Origin must be a github.com HTTPS or SSH repository URL.');
  }
  return match[1];
}

export function createRequest(root: string, run: CommandRunner = command,
  wait: (ms: number) => Promise<unknown> = setTimeout): GitHubRequest {
  return async <T>(method: string, path: string, body?: unknown, options = {}): Promise<T> => {
    const args = ['api', '--hostname', 'github.com', '--include', '--method', method,
      '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2026-03-10', path];
    if (body !== undefined) args.push('--input', '-');
    const retries = ('retry' in options ? options.retry : method === 'GET') ? 3 : 0;
    for (let attempt = 0; ; attempt++) {
      const result = await run('gh', args, root, body === undefined ? undefined : JSON.stringify(body));
      const status = Number(/^HTTP\/\S+\s+(\d+)/m.exec(result.stdout)?.[1]
        ?? /HTTP (\d+)/.exec(result.stderr)?.[1] ?? 0);
      if (!result.failed && status >= 200 && status < 300) {
        const payload = result.stdout.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim();
        return (payload ? JSON.parse(payload) : undefined) as T;
      }
      const rateLimited = status === 403 && /rate limit|retry-after:|x-ratelimit-remaining:\s*0/i.test(result.stdout + result.stderr);
      const networkFailed = status === 0 && /timed? ?out|timeout|connection|network|socket|eof|tls handshake|no such host/i.test(result.stderr);
      const transient = networkFailed || status === 429 || status >= 500 || rateLimited;
      if (!transient || attempt >= retries) throw new GitHubError(status, transient);
      await wait(Math.min(1000 * 2 ** attempt, 8000));
    }
  };
}
