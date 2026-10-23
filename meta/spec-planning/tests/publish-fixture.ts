import type { Claim, ClaimRecord, Comment, GitHub, Issue, Repository, SessionState, SessionStore } from '../shared/planning.types.js';

export function initialState(): SessionState {
  const source: Issue = { id: 1, number: 1, title: 'Spec', body: 'Deliver two capabilities.', url: 'https://github.com/example/template/issues/1', state: 'open', labels: ['spec', 'ready-for-agent', 'auto-approve'] };
  return {
    snapshot: { version: 1, repo: 'example/template', source, sourceHash: 'hash', approved: true, codeCommit: 'commit', startedAt: '2026-01-01', runId: 'run', ownerId: 'machine', sessionId: 'session' },
    status: 'publishing', published: {},
    draft: { version: 1, sourceNumber: 1, sourceHash: 'hash', codeCommit: 'commit', requirements: [{ id: 'S1', kind: 'story', text: 'Users can create records.' }, { id: 'S2', kind: 'story', text: 'Users can read saved records.' }], groups: [
      { key: 'implementation', title: 'Implementation Tickets', body: 'Implementation work.' },
      { key: 'code-review', title: 'Code Review', body: 'Code review work.' },
      { key: 'performance-review', title: 'Performance Review', body: 'Performance review work.' },
    ], tickets: [
      { key: 'read', title: 'Read records', body: 'Check saved records from the entry point.', requirementIds: ['S2'], blockedBy: ['create'] },
      { key: 'create', title: 'Create records', body: 'Create records and verify saved data.', requirementIds: ['S1'], blockedBy: [] },
    ] },
  };
}

export class MemoryStore implements SessionStore {
  saved: SessionState | null = null;
  removed = false;
  saves = 0;
  async load(): Promise<SessionState | null> { return structuredClone(this.saved); }
  async save(_number: number, state: SessionState): Promise<void> { this.saved = structuredClone(state); this.saves++; }
  async remove(): Promise<void> { this.saved = null; this.removed = true; }
}

export class FakeGitHub implements GitHub {
  issues: Issue[];
  parents = new Map<number, number>();
  dependencies = new Map<number, number[]>();
  notes: Comment[] = [];
  claim: Claim;
  creates = 0;
  writes: string[] = [];
  failAfterCreate = 0;
  unsupported = false;
  onCreate?: () => void;
  constructor(state: SessionState) {
    this.issues = [structuredClone(state.snapshot.source)];
    this.claim = { sha: '1', record: { version: 1, sourceNumber: 1, ownerId: 'machine', sessionId: 'session', phase: 'busy', runId: 'run' } };
  }
  async repository(): Promise<Repository> { return { slug: 'example/template', defaultBranch: 'main', defaultSha: 'commit', cloneUrl: 'unused', canPush: true }; }
  async issue(number: number): Promise<Issue> {
    const issue = this.issues.find((item) => item.number === number);
    if (!issue) throw new Error('Missing issue');
    return structuredClone(issue);
  }
  async candidates(): Promise<Issue[]> { return this.allIssues(); }
  async parent(number: number): Promise<Issue | null> { const parent = this.parents.get(number); return parent ? this.issue(parent) : null; }
  async children(number: number): Promise<Issue[]> { return Promise.all([...this.parents].filter(([, parent]) => parent === number).map(([child]) => this.issue(child))); }
  async allIssues(): Promise<Issue[]> { return structuredClone(this.issues); }
  async comments(): Promise<Comment[]> { return structuredClone(this.notes); }
  async comment(_number: number, body: string): Promise<void> { this.notes.push({ id: this.notes.length + 1, body }); this.writes.push('comment'); }
  async createIssue(title: string, body: string, labels: string[]): Promise<Issue> {
    const number = this.issues.length + 1;
    const issue: Issue = { id: number, number, title, body, labels, url: `https://github.com/example/template/issues/${number}`, state: 'open' };
    this.issues.push(issue); this.creates++; this.writes.push(`create:${title}`);
    this.onCreate?.();
    if (this.creates === this.failAfterCreate) throw new Error('Response lost after successful creation');
    return structuredClone(issue);
  }
  async updateIssue(number: number, title: string, body: string): Promise<Issue> { const issue = this.issues.find((item) => item.number === number)!; issue.title = title; issue.body = body; this.writes.push('update'); return structuredClone(issue); }
  async addLabels(number: number, labels: string[]): Promise<void> { this.issues.find((issue) => issue.number === number)!.labels.push(...labels); this.writes.push('labels'); }
  async ensureLabel(): Promise<void> { throw new Error('Not used'); }
  async attach(parent: number, child: Issue): Promise<void> { this.parents.set(child.number, parent); this.writes.push(`attach:${parent}:${child.number}`); }
  async blockers(number: number): Promise<Issue[]> {
    if (this.unsupported) { const error = new Error('Unsupported dependency endpoint'); error.name = 'UnsupportedDependenciesError'; throw error; }
    return Promise.all((this.dependencies.get(number) ?? []).map((value) => this.issue(value)));
  }
  async block(number: number, blocker: Issue): Promise<void> { this.dependencies.set(number, [...this.dependencies.get(number) ?? [], blocker.number]); this.writes.push('block'); }
  async getClaim(): Promise<Claim> { return structuredClone(this.claim); }
  async createClaim(): Promise<Claim | null> { return null; }
  async updateClaim(expected: Claim, record: ClaimRecord): Promise<Claim | null> {
    if (expected.sha !== this.claim.sha) return null;
    this.claim = { sha: `${Number(expected.sha) + 1}`, record: structuredClone(record) }; this.writes.push('claim'); return structuredClone(this.claim);
  }
}
