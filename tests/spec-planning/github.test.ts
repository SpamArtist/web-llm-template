import { describe, expect, it, vi } from 'vitest';
import { createGitHub, createGitHubAdapter } from '../../src/db/spec-planning/github';
import { createRequest, GitHubError, repositoryFromOrigin, UnsupportedDependenciesError } from '../../src/db/spec-planning/github-transport';
import type { CommandRunner, GitHubRequest, RawIssue } from '../../src/db/spec-planning/github.types';

const rawIssue = (number: number): RawIssue => ({ id: 1000 + number, number, title: 'Ticket', body: 'Body',
  html_url: `https://github.com/example/template/issues/${number}`, labels: [{ name: 'spec' }], state: 'open' });
const response = (status: number, payload: unknown) => ({
  stdout: `HTTP/2.0 ${status} Test\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}`,
  stderr: '', failed: status >= 400,
});

describe('GitHub CLI transport', () => {
  it('returns an ordinary adapter, not a thenable', async () => {
    const github = createGitHub('/does-not-need-to-exist-until-first-operation');
    expect('then' in github).toBe(false);
    expect(await Promise.resolve(github)).toBe(github);
  });
  it.each(['https://github.com/example/template.git', 'git@github.com:example/template.git',
    'ssh://git@github.com/example/template', 'https://github.com/example/template'])('uses the origin repository: %s', (origin) => {
    expect(repositoryFromOrigin(origin)).toBe('example/template');
  });
  it.each(['https://github.example.com/example/template', 'https://github.com.evil.test/example/template',
    'https://user:password@github.com/example/template', 'file:///tmp/repository', 'https://github.com/example/../template'])('rejects an unsupported origin: %s', (origin) => {
    expect(() => repositoryFromOrigin(origin)).toThrow('Origin must');
  });
  it('passes a body through stdin, never through shell code or arguments', async () => {
    const run = vi.fn<CommandRunner>().mockResolvedValue(response(201, { id: 1 }));
    const request = createRequest('/checkout', run);
    const body = { title: '$(touch /tmp/unsafe) `whoami`', body: 'line 1\nline 2' };
    await request('POST', 'repos/example/template/issues', body);
    expect(run).toHaveBeenCalledWith('gh', expect.arrayContaining(['--hostname', 'github.com', '--input', '-']), '/checkout', JSON.stringify(body));
    expect(run.mock.calls[0][1]).not.toContain(body.title);
  });
  it('allows three retries for transient reads, then stops', async () => {
    const run = vi.fn<CommandRunner>().mockResolvedValue(response(503, { message: 'Unavailable' }));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(createRequest('/checkout', run, wait)('GET', 'repos/example/template')).rejects.toThrow('503');
    expect(run).toHaveBeenCalledTimes(4);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });
  it.each([401, 403])('does not retry HTTP %s permission errors', async (status) => {
    const run = vi.fn<CommandRunner>().mockResolvedValue(response(status, { message: 'Denied' }));
    await expect(createRequest('/checkout', run)('GET', 'repos/example/template')).rejects.toBeInstanceOf(GitHubError);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('retries a rate-limit response and a network failure', async () => {
    const run = vi.fn<CommandRunner>()
      .mockResolvedValueOnce(response(403, { message: 'API rate limit exceeded' }))
      .mockResolvedValueOnce({ stdout: '', stderr: 'connection reset', failed: true })
      .mockResolvedValue(response(200, { ok: true }));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(createRequest('/checkout', run, wait)('GET', 'repos/example/template')).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('does not retry invalid authentication without an HTTP response', async () => {
    const run = vi.fn<CommandRunner>().mockResolvedValue({ stdout: '', stderr: 'Run gh auth login to authenticate.', failed: true });
    await expect(createRequest('/checkout', run)('GET', 'repos/example/template')).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not blindly repeat an issue creation after a lost response', async () => {
    const run = vi.fn<CommandRunner>().mockResolvedValue({ stdout: '', stderr: 'connection reset', failed: true });
    const github = createGitHubAdapter('example/template', createRequest('/checkout', run));
    await expect(github.createIssue('Ticket', 'Body', [])).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('GitHub issue relationships', () => {
  it('confirms an absent parent from the hierarchy-aware issue response', async () => {
    const request: GitHubRequest = async <T>(_method: string, path: string) => {
      if (path.endsWith('/parent')) throw new GitHubError(404);
      return { ...rawIssue(7), sub_issues_summary: { total: 0 } } as T;
    };
    expect(await createGitHubAdapter('example/template', request).parent(7)).toBeNull();
  });
  it.each([{}, { parent_issue_url: 'https://api.github.com/repos/example/template/issues/6', sub_issues_summary: { total: 0 } }])(
    'stops when a missing parent endpoint cannot prove root ancestry', async (fields) => {
      const request: GitHubRequest = async <T>(_method: string, path: string) => {
        if (path.endsWith('/parent')) throw new GitHubError(404);
        return { ...rawIssue(7), ...fields } as T;
      };
      await expect(createGitHubAdapter('example/template', request).parent(7)).rejects.toThrow('Cannot verify');
    },
  );
  it('uses database IDs for relationships and issue numbers for endpoint paths', async () => {
    const calls = vi.fn().mockResolvedValue({});
    const request: GitHubRequest = async <T>(method: string, path: string, body?: unknown) => calls(method, path, body) as T;
    const github = createGitHubAdapter('example/template', request);
    const child = { ...rawIssue(8), body: 'Body', url: 'https://github.com/example/template/issues/8', labels: [] };
    await github.attach(7, child);
    await github.block(9, child);
    expect(calls.mock.calls).toEqual([
      ['POST', '/issues/7/sub_issues', { sub_issue_id: 1008 }],
      ['POST', '/issues/9/dependencies/blocked_by', { issue_id: 1008 }],
    ]);
  });
  it('reads every page, including closed tickets, and excludes pull requests', async () => {
    const calls = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => rawIssue(index + 1)))
      .mockResolvedValueOnce([{ ...rawIssue(101), state: 'closed' }, { ...rawIssue(102), pull_request: {} }]);
    const request: GitHubRequest = async <T>(method: string, path: string) => calls(method, path) as T;
    const issues = await createGitHubAdapter('example/template', request).allIssues();
    expect(issues).toHaveLength(101);
    expect(issues.at(-1)?.state).toBe('closed');
    expect(calls.mock.calls.map((call) => call[1])).toEqual([
      '/issues?state=all&per_page=100&page=1', '/issues?state=all&per_page=100&page=2',
    ]);
  });
  it.each([404, 410, 501])('allows dependency fallback only for unsupported HTTP %s', async (status) => {
    const request: GitHubRequest = async () => { throw new GitHubError(status); };
    await expect(createGitHubAdapter('example/template', request).blockers(5)).rejects.toBeInstanceOf(UnsupportedDependenciesError);
  });
  it.each([401, 403, 422, 500])('propagates dependency error HTTP %s', async (status) => {
    const request: GitHubRequest = async () => { throw new GitHubError(status); };
    await expect(createGitHubAdapter('example/template', request).blockers(5)).rejects.toBeInstanceOf(GitHubError);
  });
});
