import type { GitHub } from '../shared/planning.types.js';
import type { ScanResult } from './scan.types.js';
import { eligibility } from '../shared/eligibility.js';
import { inspectHandoff } from './handoff.js';

export async function scanPlanning(github: GitHub, repo: string, owner: string): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  // Handoffs outlive publication labels, issue closure, and local draft cleanup.
  // Discover them from durable claims, not only currently eligible source issues.
  const pending = (await github.listClaims()).filter(({ record }) =>
    record.ownerId === owner && record.phase === 'complete' && record.handoff && record.handoff.status !== 'launched');
  for (const claim of pending) {
    const current = await inspectHandoff(github, claim.record.sourceNumber, owner);
    if (current.action === 'launched') continue;
    const issue = await github.issue(claim.record.sourceNumber);
    results.push({ number: issue.number, title: issue.title, action: 'handoff', claim: current.claim });
  }
  for (const issue of await github.candidates()) {
    if (results.some((result) => result.number === issue.number)) continue;
    const result = await eligibility(github, repo, issue);
    const claim = await github.getClaim(issue.number);
    const skip = !result.eligible || (claim && claim.record.ownerId !== owner);
    results.push({ number: issue.number, title: issue.title,
      action: skip ? 'skip' : claim?.record.phase === 'complete' ? 'complete' : claim?.record.phase === 'busy' ? 'busy' : claim?.record.phase === 'stopped' ? 'stopped' : 'eligible',
      reason: !result.eligible ? result.reason : skip ? 'Another app instance owns this spec.' : claim?.record.reason, claim });
  }
  return results;
}
