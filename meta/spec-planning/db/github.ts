import type { Comment, GitHub, Issue, Repository } from '../shared/planning.types';
import type { GitHubRequest, GitRef, RawIssue, RawRepository } from './github.types';
import { command } from './command';
import { createClaims } from './claims';
import { createRequest, GitHubError, repositoryFromOrigin, UnsupportedDependenciesError } from './github-transport';

function issue(raw: RawIssue): Issue {
  if (raw.pull_request) throw new Error('Pull requests are not source spec issues.');
  return { id: raw.id, number: raw.number, title: raw.title, body: raw.body ?? '',
    url: raw.html_url, state: raw.state,
    labels: raw.labels.map((label) => typeof label === 'string' ? label : label.name) };
}

// The transport is repository-relative. This boundary keeps all issue numbers
// distinct from the database IDs required by relationship writes.
export function createGitHubAdapter(target: string | (() => Promise<string>), request: GitHubRequest): GitHub {
  async function pages<T>(path: string): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; ; page++) {
      const next = await request<T[]>('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      values.push(...next);
      if (next.length < 100) return values;
    }
  }
  async function repository(): Promise<Repository> {
    const slug = typeof target === 'string' ? target : await target();
    const raw = await request<RawRepository>('GET', '');
    const ref = await request<GitRef>('GET', `/git/ref/heads/${encodeURIComponent(raw.default_branch)}`);
    return { slug, defaultBranch: raw.default_branch, defaultSha: ref.object.sha,
      cloneUrl: `https://github.com/${slug}.git`, canPush: raw.permissions?.push === true };
  }
  async function dependencies<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof GitHubError && [404, 410, 501].includes(error.status)) {
        throw new UnsupportedDependenciesError();
      }
      throw error;
    }
  }
  const listIssues = async (path: string) => (await pages<RawIssue>(path)).filter((item) => !item.pull_request).map(issue);
  return {
    repository,
    issue: async (number) => issue(await request<RawIssue>('GET', `/issues/${number}`)),
    candidates: () => listIssues('/issues?state=open&labels=spec%2Cready-for-agent'),
    allIssues: () => listIssues('/issues?state=all'),
    parent: async (number) => {
      try { return issue(await request<RawIssue>('GET', `/issues/${number}/parent`)); }
      catch (error) {
        if (error instanceof GitHubError && error.status === 404) {
          // A 404 can mean either no parent or unavailable ancestry. Require the
          // current issue schema to confirm no parent before treating it as a root.
          const raw = await request<RawIssue>('GET', `/issues/${number}`);
          if (!raw.sub_issues_summary || raw.parent_issue_url) {
            throw new Error('Cannot verify source issue ancestry.', { cause: error });
          }
          return null;
        }
        throw error;
      }
    },
    children: (number) => listIssues(`/issues/${number}/sub_issues`),
    comments: (number) => pages<Comment>(`/issues/${number}/comments`),
    comment: async (number, body) => { await request('POST', `/issues/${number}/comments`, { body }); },
    createIssue: async (title, body, labels) => issue(await request<RawIssue>('POST', '/issues', { title, body, labels })),
    updateIssue: async (number, title, body) => issue(await request<RawIssue>('PATCH', `/issues/${number}`, { title, body })),
    addLabels: async (number, labels) => { await request('POST', `/issues/${number}/labels`, { labels }); },
    ensureLabel: async (name, description) => {
      try { await request('GET', `/labels/${encodeURIComponent(name)}`); return; }
      catch (error) { if (!(error instanceof GitHubError && error.status === 404)) throw error; }
      try { await request('POST', '/labels', { name, description, color: '1d76db' }); }
      catch (error) {
        // Another machine may have created the label, or the response was lost.
        await request('GET', `/labels/${encodeURIComponent(name)}`).catch(() => { throw error; });
      }
    },
    attach: async (parent, child) => { await request('POST', `/issues/${parent}/sub_issues`, { sub_issue_id: child.id }); },
    blockers: (number) => dependencies(() => listIssues(`/issues/${number}/dependencies/blocked_by`)),
    block: (number, blocker) => dependencies(async () => {
      await request('POST', `/issues/${number}/dependencies/blocked_by`, { issue_id: blocker.id });
    }),
    ...createClaims(request, repository),
  };
}

export function createGitHub(root: string): GitHub {
  let slug: Promise<string> | undefined;
  const getSlug = () => slug ??= (async () => {
    const origin = await command('git', ['remote', 'get-url', 'origin'], root);
    if (origin.failed) throw new Error('Cannot read repository origin.');
    return repositoryFromOrigin(origin.stdout.trim());
  })();
  // Resolve origin before any GitHub operation; never infer a repository from cwd
  // inside gh, and never send repository data to a non-GitHub host.
  const transport = createRequest(root);
  const request: GitHubRequest = async (method, path, body, options) =>
    transport(method, `repos/${await getSlug()}${path}`, body, options);
  return createGitHubAdapter(getSlug, request);
}
