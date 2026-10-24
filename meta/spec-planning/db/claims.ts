import type { Claim, ClaimRecord, Repository } from '../shared/planning.types';
import type { GitCommit, GitHubRequest, GitRef } from './github.types';
import { GitHubError } from './github-transport';

const prefix = 'spec-planning-claim-v1\n';
const branch = (number: number) => {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid source issue number.');
  return `heads/LLM/spec-planning/${number}`;
};

function decode(message: string, number: number): ClaimRecord {
  if (!message.startsWith(prefix)) throw new Error('Claim ref does not contain a planning record.');
  const record: ClaimRecord = JSON.parse(message.slice(prefix.length));
  if (record.version !== 1 || record.sourceNumber !== number
    || typeof record.ownerId !== 'string' || !record.ownerId || typeof record.sessionId !== 'string' || !record.sessionId
    || !['owned', 'busy', 'stopped', 'complete'].includes(record.phase)
    || !(record.runId === null || typeof record.runId === 'string')) {
    throw new Error('Invalid planning claim record.');
  }
  return record;
}

export function createClaims(request: GitHubRequest, repository: () => Promise<Repository>) {
  async function getClaim(number: number): Promise<Claim | null> {
    let ref: GitRef;
    try { ref = await request<GitRef>('GET', `/git/ref/${branch(number)}`); }
    catch (error) {
      if (error instanceof GitHubError && error.status === 404) return null;
      throw error;
    }
    const commit = await request<GitCommit>('GET', `/git/commits/${ref.object.sha}`);
    return { sha: commit.sha, record: decode(commit.message, number) };
  }

  async function write(expected: Claim | null, record: ClaimRecord): Promise<Claim | null> {
    const ref = branch(record.sourceNumber);
    if (expected && expected.record.sourceNumber !== record.sourceNumber) throw new Error('Claim source mismatch.');
    const parentSha = expected?.sha ?? (await repository()).defaultSha;
    const parent = await request<GitCommit>('GET', `/git/commits/${parentSha}`);
    try {
      // The sole parent is the expected ref SHA. Competing updates produce sibling
      // commits, so only one can be a fast-forward. Never force-update this ref.
      const commit = await request<GitCommit>('POST', '/git/commits', {
        message: prefix + JSON.stringify(record), tree: parent.tree.sha, parents: [parentSha],
      }, { retry: true });
      if (expected) await request('PATCH', `/git/refs/${ref}`, { sha: commit.sha, force: false }, { retry: true });
      else await request('POST', '/git/refs', { ref: `refs/${ref}`, sha: commit.sha }, { retry: true });
      return { sha: commit.sha, record };
    } catch (error) {
      // A connection can fail after GitHub stores the write. Read before retrying.
      const actual = await getClaim(record.sourceNumber);
      if (actual && JSON.stringify(actual.record) === JSON.stringify(record)) return actual;
      if (actual && (!expected || actual.sha !== expected.sha)) return null;
      if (error instanceof GitHubError && [409, 422].includes(error.status)) return null;
      throw error;
    }
  }

  return {
    getClaim,
    createClaim: (record: ClaimRecord) => write(null, record),
    updateClaim: (expected: Claim, record: ClaimRecord) => write(expected, record),
  };
}
