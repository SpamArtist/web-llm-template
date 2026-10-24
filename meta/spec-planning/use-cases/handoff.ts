import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { validateHandoff } from '../shared/handoff.js';
import type { HandoffRecord } from '../shared/handoff.types.js';
import type { Claim, GitHub } from '../shared/planning.types.js';
import type { HandoffEnrollment, HandoffExecution, HandoffIdentity, HandoffMutation, HandoffPreparation, HandoffRecovery, HandoffReservation, HandoffStatus, HandoffThread } from './handoff.types.js';
import { handoffMarker, integrationBase, integrationBranch } from '../shared/orchestrator-prompt.js';

export function seedHandoff(repo: string, sourceNumber: number, planningSessionId: string, sourceBody: string): HandoffRecord {
  return { version: 1, status: 'pending', repo, marker: handoffMarker(repo, sourceNumber, planningSessionId), baseBranch: integrationBase(sourceBody), integrationBranch: integrationBranch(sourceNumber) };
}

function tickets(claim: Claim): number[] {
  const published = claim.record.published;
  if (!published || !['implementation', 'code-review', 'performance-review'].every((key) => Number.isSafeInteger(published[`group:${key}`]))) {
    throw new Error('Handoff requires the complete verified publication record.');
  }
  const numbers = Object.values(published);
  if (numbers.some((number) => !Number.isSafeInteger(number) || number < 1 || number === claim.record.sourceNumber) || new Set(numbers).size !== numbers.length) {
    throw new Error('Publication membership is invalid or contains duplicate issue numbers.');
  }
  const members = Object.entries(published).filter(([key]) => key.startsWith('ticket:')).map(([, number]) => number).sort((a, b) => a - b);
  if (!members.length || Object.keys(published).some((key) => !key.startsWith('ticket:') && !['group:implementation', 'group:code-review', 'group:performance-review'].includes(key))) {
    throw new Error('Handoff requires exact implementation ticket membership.');
  }
  return members;
}

function status(claim: Claim): HandoffStatus {
  const handoff = claim.record.handoff;
  const action = !handoff ? 'none' : handoff.status === 'pending' ? 'reserve' : handoff.status === 'reserved' ? handoff.baseCommit ? 'prepare-branch' : 'prepare' : handoff.status === 'creating' ? 'reconcile' : 'launched';
  return { claim, action, tickets: handoff ? tickets(claim) : [] };
}

async function owned(github: GitHub, request: HandoffIdentity): Promise<Claim> {
  const claim = await github.getClaim(request.sourceNumber);
  if (!claim || claim.record.sourceNumber !== request.sourceNumber || claim.record.ownerId !== request.ownerId || claim.record.phase !== 'complete') {
    throw new Error('Handoff requires a completed claim owned by the registered planner.');
  }
  if (claim.record.handoff !== undefined) validateHandoff(claim.record.handoff, claim.record.sourceNumber, claim.record.sessionId);
  return claim;
}

function current(claim: Claim, request: HandoffMutation): void {
  if (claim.sha !== request.expectedSha) throw new Error('Handoff claim changed. Read its current state before retrying.');
}

function executor(claim: Claim, request: HandoffExecution): HandoffRecord {
  const handoff = claim.record.handoff;
  if (!handoff || handoff.executorSessionId !== request.executorSessionId) throw new Error('Handoff reservation belongs to another executor session.');
  return handoff;
}

async function save(github: GitHub, claim: Claim, handoff: HandoffRecord): Promise<Claim> {
  validateHandoff(handoff, claim.record.sourceNumber, claim.record.sessionId);
  const saved = await github.updateClaim(claim, { ...claim.record, handoff });
  if (!saved) throw new Error('Handoff claim changed during update. Read its current state before retrying.');
  return saved;
}

export async function inspectHandoff(github: GitHub, sourceNumber: number, ownerId: string): Promise<HandoffStatus> {
  return status(await owned(github, { sourceNumber, ownerId }));
}

export async function reserveHandoff(github: GitHub, request: HandoffReservation): Promise<HandoffStatus> {
  const claim = await owned(github, request);
  if (claim.record.handoff?.status !== 'pending') return status(claim);
  current(claim, request);
  tickets(claim);
  if (!request.executorSessionId.trim() || request.executorSessionId === claim.record.sessionId || !request.projectId.trim() || !isAbsolute(request.checkoutRoot)) {
    throw new Error('Handoff needs a distinct executor session, matching project, and absolute canonical checkout root.');
  }
  const saved = await save(github, claim, { ...claim.record.handoff, status: 'reserved', executorSessionId: request.executorSessionId, projectId: request.projectId, checkoutRoot: request.checkoutRoot });
  return status(saved);
}

export async function prepareHandoff(github: GitHub, request: HandoffPreparation): Promise<HandoffStatus> {
  const claim = await owned(github, request);
  const handoff = executor(claim, request);
  if (handoff.status !== 'reserved') return status(claim);
  if (handoff.baseCommit) {
    if (handoff.baseCommit !== request.baseCommit) throw new Error('Handoff base commit is already pinned; branch movement cannot change it.');
    return status(claim);
  }
  current(claim, request);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(request.baseCommit)) throw new Error('Preparation requires a resolved full Git commit SHA.');
  return status(await save(github, claim, { ...handoff, baseCommit: request.baseCommit }));
}

export async function beginHandoffCreation(github: GitHub, request: HandoffExecution): Promise<HandoffStatus> {
  const claim = await owned(github, request);
  const handoff = executor(claim, request);
  if (handoff.status === 'creating' || handoff.status === 'launched') return status(claim);
  current(claim, request);
  if (handoff.status !== 'reserved' || !handoff.baseCommit) throw new Error('Create requires a reserved handoff with a pinned base commit.');
  tickets(claim);
  return { ...status(await save(github, claim, { ...handoff, status: 'creating', creationAttemptId: randomUUID() })), action: 'create' };
}

export async function recordHandoffThread(github: GitHub, request: HandoffThread): Promise<HandoffStatus> {
  const claim = await owned(github, request);
  const handoff = claim.record.handoff;
  if (!handoff) throw new Error('Thread recording requires a durable creation intent.');
  // A later scheduled run may reconcile a native chat found by its stable marker.
  // It records evidence only; creation and branch permissions remain with the original executor.
  if (handoff.executorSessionId !== request.executorSessionId) current(claim, request);
  if ((!request.threadId && !request.clientThreadId) || request.threadId?.trim() === '' || request.clientThreadId?.trim() === '' || (request.threadId && !request.hostId?.trim())) {
    throw new Error('Record a queued clientThreadId or a ready threadId with hostId.');
  }
  if (handoff.status === 'launched') {
    if (request.threadId !== handoff.threadId || request.hostId !== handoff.hostId) throw new Error('Launched handoff cannot be replaced.');
    return status(claim);
  }
  if (handoff.status !== 'creating') throw new Error('Thread recording requires a durable creation intent.');
  if (handoff.clientThreadId && request.clientThreadId && handoff.clientThreadId !== request.clientThreadId) throw new Error('Queued handoff cannot be replaced with a different creation.');
  if (!request.threadId && request.clientThreadId === handoff.clientThreadId) return status(claim);
  current(claim, request);
  return status(await save(github, claim, { ...handoff, ...(request.clientThreadId ? { clientThreadId: request.clientThreadId } : {}), ...(request.threadId ? { status: 'launched', threadId: request.threadId, hostId: request.hostId } : {}) }));
}

export async function recoverHandoff(github: GitHub, request: HandoffRecovery): Promise<HandoffStatus> {
  const claim = await owned(github, request);
  current(claim, request);
  const handoff = claim.record.handoff;
  if (!handoff || handoff.status === 'pending' || handoff.status === 'launched' || !request.confirmedStopped || (handoff.status === 'creating' && !request.confirmedAbsent)) {
    throw new Error('Recovery requires a stopped executor; uncertain creation also requires authoritative confirmation no chat exists. Launched handoffs cannot reset.');
  }
  const reset: HandoffRecord = { version: 1, status: 'pending', repo: handoff.repo, marker: handoff.marker, baseBranch: handoff.baseBranch, integrationBranch: handoff.integrationBranch, ...(handoff.baseCommit ? { baseCommit: handoff.baseCommit } : {}) };
  return status(await save(github, claim, reset));
}

export async function enrollLegacyHandoff(github: GitHub, request: HandoffEnrollment): Promise<HandoffStatus> {
  const claim = await owned(github, request);
  if (claim.record.handoff) return status(claim);
  current(claim, request);
  if (!request.manual) throw new Error('Previously completed publications require an explicit manual launch request.');
  tickets(claim);
  const source = await github.issue(request.sourceNumber);
  if (source.body !== request.sourceBody) throw new Error('Legacy enrollment needs the current source spec body.');
  const repository = await github.repository();
  if (repository.slug.toLowerCase() !== request.repo.toLowerCase()) throw new Error('Legacy enrollment repository does not match the publication.');
  const visited = new Set<number>();
  let ancestor: typeof source | null = source;
  while (ancestor) {
    if (visited.has(ancestor.number) || ancestor.labels.includes('reference-only') || (request.repo.toLowerCase() === 'spamartist/web-llm-template' && ancestor.number === 18)) throw new Error('Cannot launch a reference-only or cyclic spec tree.');
    visited.add(ancestor.number);
    ancestor = await github.parent(ancestor.number);
  }
  return status(await save(github, claim, seedHandoff(request.repo, request.sourceNumber, claim.record.sessionId, request.sourceBody)));
}
