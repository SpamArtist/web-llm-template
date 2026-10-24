export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string;
  url: string;
  state: 'open' | 'closed';
  labels: string[];
}

export interface Repository {
  slug: string;
  defaultBranch: string;
  defaultSha: string;
  cloneUrl: string;
  canPush: boolean;
}

export interface Comment {
  id: number;
  body: string;
}

export type GroupKey = 'implementation' | 'code-review' | 'performance-review';
export interface DraftGroup {
  key: GroupKey;
  title: string;
  body: string;
}
export interface Requirement {
  id: string;
  kind: 'story' | 'decision' | 'test';
  text: string;
}
export interface DraftTicket {
  key: string;
  title: string;
  body: string;
  requirementIds: string[];
  blockedBy: string[];
  existingIssue?: number;
}
export interface Draft {
  version: 1;
  sourceNumber: number;
  sourceHash: string;
  codeCommit: string;
  requirements: Requirement[];
  groups: DraftGroup[];
  tickets: DraftTicket[];
}

export interface ClaimRecord {
  version: 1;
  sourceNumber: number;
  ownerId: string;
  sessionId: string;
  phase: 'owned' | 'busy' | 'stopped' | 'complete';
  runId: string | null;
  sourceHash?: string;
  reason?: string;
  published?: Record<string, number>;
}
export interface Claim {
  sha: string;
  record: ClaimRecord;
}

export interface GitHub {
  repository(): Promise<Repository>;
  issue(number: number): Promise<Issue>;
  candidates(): Promise<Issue[]>;
  parent(number: number): Promise<Issue | null>;
  children(number: number): Promise<Issue[]>;
  allIssues(): Promise<Issue[]>;
  comments(number: number): Promise<Comment[]>;
  comment(number: number, body: string): Promise<void>;
  createIssue(title: string, body: string, labels: string[]): Promise<Issue>;
  updateIssue(number: number, title: string, body: string): Promise<Issue>;
  addLabels(number: number, labels: string[]): Promise<void>;
  ensureLabel(name: string, description: string): Promise<void>;
  attach(parent: number, child: Issue): Promise<void>;
  blockers(number: number): Promise<Issue[]>;
  block(number: number, blocker: Issue): Promise<void>;
  getClaim(number: number): Promise<Claim | null>;
  createClaim(record: ClaimRecord): Promise<Claim | null>;
  updateClaim(expected: Claim, record: ClaimRecord): Promise<Claim | null>;
}

export interface RunSnapshot {
  version: 1;
  repo: string;
  source: Issue;
  sourceHash: string;
  approved: boolean;
  codeCommit: string;
  startedAt: string;
  runId: string;
  ownerId: string;
  sessionId: string;
}
export interface PublishedRecord {
  number: number;
  id: number;
  title: string;
  body: string;
}
export interface SessionState {
  snapshot: RunSnapshot;
  status: 'drafting' | 'waiting' | 'publishing' | 'stopped' | 'complete';
  published: Record<string, PublishedRecord>;
  draft?: Draft;
  reason?: string;
}
export interface LocalConfig {
  version: 1;
  repo: string;
  ownerId: string;
  root: string;
}
export interface SessionStore {
  load(number: number): Promise<SessionState | null>;
  save(number: number, state: SessionState): Promise<void>;
  remove(number: number): Promise<void>;
}
