export interface RequestOptions {
  retry?: boolean;
}

export interface GitHubRequest {
  <T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
}

export interface RawIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  labels: (string | { name: string })[];
  pull_request?: unknown;
  parent_issue_url?: string | null;
  sub_issues_summary?: { total: number };
}

export interface RawRepository {
  full_name: string;
  default_branch: string;
  clone_url: string;
  permissions?: { push?: boolean };
}

export interface GitCommit {
  sha: string;
  message: string;
  tree: { sha: string };
  parents: { sha: string }[];
}

export interface GitRef {
  object: { sha: string };
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  failed: boolean;
}

export interface CommandRunner {
  (program: string, args: string[], cwd: string, input?: string): Promise<CommandResult>;
}
