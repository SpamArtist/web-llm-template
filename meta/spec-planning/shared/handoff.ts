import { isAbsolute } from 'node:path';
import type { HandoffRecord } from './handoff.types.js';
import { handoffMarker, integrationBranch, validateBranchName } from './orchestrator-prompt.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && !value.includes('\0');
}

/** Reject malformed shared state before interpreting an action or mutating it. */
export function validateHandoff(value: unknown, sourceNumber: number, planningSessionId: string): asserts value is HandoffRecord {
  const fail = (): never => { throw new Error('Invalid durable handoff record. Read and repair its authoritative state before continuing.'); };
  if (!object(value)) return fail();
  if (value.version !== 1 || typeof value.status !== 'string' || !['pending', 'reserved', 'creating', 'launched'].includes(value.status)
    || !text(value.repo) || !text(value.baseBranch) || value.integrationBranch !== integrationBranch(sourceNumber)) return fail();
  try {
    if (value.marker !== handoffMarker(value.repo, sourceNumber, planningSessionId)) fail();
    validateBranchName(value.baseBranch);
  } catch { fail(); }
  if (value.baseCommit !== undefined && (typeof value.baseCommit !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.baseCommit))) fail();
  if (value.status === 'pending') {
    if (['executorSessionId', 'projectId', 'checkoutRoot', 'creationAttemptId', 'clientThreadId', 'threadId', 'hostId'].some((key) => value[key] !== undefined)) fail();
    return;
  }
  if (!text(value.executorSessionId) || value.executorSessionId === planningSessionId || !text(value.projectId) || !text(value.checkoutRoot)) return fail();
  if (!isAbsolute(value.checkoutRoot)) fail();
  if (value.status === 'reserved') {
    if (['creationAttemptId', 'clientThreadId', 'threadId', 'hostId'].some((key) => value[key] !== undefined)) fail();
    return;
  }
  if (!text(value.creationAttemptId) || !value.baseCommit || (value.clientThreadId !== undefined && !text(value.clientThreadId))) fail();
  if (value.status === 'creating') {
    if (value.threadId !== undefined || value.hostId !== undefined) fail();
    return;
  }
  if (!text(value.threadId) || !text(value.hostId)) fail();
}
