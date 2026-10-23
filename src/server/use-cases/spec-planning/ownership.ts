import type { GitHub } from '../../../shared/spec-planning/planning.types.js';

export async function recoverSession(github: GitHub, issue: number, owner: string, expectedSha: string): Promise<void> {
  const claim = await github.getClaim(issue);
  if (!claim || claim.sha !== expectedSha || claim.record.ownerId !== owner || claim.record.phase !== 'busy') {
    throw new Error('Recovery needs the current busy claim SHA and its registered owner.');
  }
  if (!await github.updateClaim(claim, { ...claim.record, phase: 'stopped', runId: null, reason: 'Owner confirmed that the prior run has stopped. Manual restart required.' })) {
    throw new Error('Claim changed during recovery. Read its new state before retrying.');
  }
}

export async function transferSession(github: GitHub, issue: number, owner: string, expectedSha: string, confirmedStopped = false): Promise<void> {
  const claim = await github.getClaim(issue);
  if (!claim || claim.sha !== expectedSha || (claim.record.phase === 'busy' && !confirmedStopped) || claim.record.phase === 'complete') {
    throw new Error('Transfer needs the current inactive claim SHA, or explicit confirmation that the prior process has stopped. Completed sessions cannot transfer.');
  }
  if (!await github.updateClaim(claim, { ...claim.record, ownerId: owner, phase: 'stopped', runId: null, reason: 'User transferred ownership. Manual restart required.' })) {
    throw new Error('Claim changed during transfer. Read its new state before retrying.');
  }
}
