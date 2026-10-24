import { describe, expect, it, vi } from 'vitest';
import { eligibility } from '../shared/eligibility';
import type { GitHub, Issue } from '../shared/planning.types';

const issue: Issue = { id: 101, number: 1, title: 'A spec', body: 'Requirements', url: '', state: 'open', labels: ['spec', 'ready-for-agent'] };

function github(parents: Map<number, Issue> = new Map()): GitHub {
  const unavailable = (): never => { throw new Error('Unexpected GitHub write or unrelated read.'); };
  return {
    parent: vi.fn(async (number: number) => parents.get(number) ?? null),
    repository: unavailable, issue: unavailable, candidates: unavailable, children: unavailable, allIssues: unavailable,
    comments: unavailable, comment: unavailable, createIssue: unavailable, updateIssue: unavailable,
    addLabels: unavailable, ensureLabel: unavailable, attach: unavailable, blockers: unavailable, block: unavailable,
    getClaim: unavailable, listClaims: unavailable, createClaim: unavailable, updateClaim: unavailable,
  };
}

describe('spec eligibility', () => {
  it('accepts an open labeled issue and snapshots auto-approve separately', async () => {
    expect(await eligibility(github(), 'example/project', issue)).toEqual({ eligible: true, approved: false });
    expect(await eligibility(github(), 'example/project', { ...issue, labels: [...issue.labels, 'auto-approve'] })).toEqual({ eligible: true, approved: true });
  });

  it('rejects closed and incompletely labeled issues', async () => {
    expect((await eligibility(github(), 'example/project', { ...issue, state: 'closed' })).eligible).toBe(false);
    for (const labels of [[], ['spec'], ['ready-for-agent'], ['auto-approve']]) {
      expect((await eligibility(github(), 'example/project', { ...issue, labels })).eligible).toBe(false);
    }
  });

  it('excludes reference-only labels on the issue or any ancestor', async () => {
    const reference = { ...issue, number: 3, labels: ['reference-only'] };
    const parents = new Map([[1, { ...issue, number: 2 }], [2, reference]]);
    expect((await eligibility(github(parents), 'example/project', issue)).eligible).toBe(false);
    expect((await eligibility(github(), 'example/project', { ...issue, labels: [...issue.labels, 'reference-only'] })).eligible).toBe(false);
  });

  it('permanently excludes template example 18 and descendants only in the template repo', async () => {
    const example = { ...issue, number: 18 };
    expect((await eligibility(github(), 'SpamArtist/WEB-LLM-TEMPLATE', example)).eligible).toBe(false);
    expect((await eligibility(github(new Map([[1, example]])), 'SpamArtist/web-llm-template', issue)).eligible).toBe(false);
    expect((await eligibility(github(), 'example/project', example)).eligible).toBe(true);
  });

  it('fails closed on broken ancestry or ancestry cycles', async () => {
    const api = github();
    api.parent = vi.fn().mockRejectedValue(new Error('Network failure'));
    expect(await eligibility(api, 'example/project', issue)).toMatchObject({ eligible: false, reason: 'Could not verify the complete issue ancestry.' });
    const cyclic = github(new Map([[1, { ...issue, number: 2 }], [2, issue]]));
    expect(await eligibility(cyclic, 'example/project', issue)).toMatchObject({ eligible: false, reason: 'Issue ancestry contains a cycle.' });
  });
});
