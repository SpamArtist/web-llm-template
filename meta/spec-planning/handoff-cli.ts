import { getBootstrapContext } from './bootstrap/context.js';
import { assertIntegrationBranchAbsent, ensureIntegrationBranch, resolveIntegrationBase } from './db/integration-branch.js';
import type { GitHub } from './shared/planning.types.js';
import type { HandoffCliOptions } from './handoff-cli.types.js';
import type { HandoffStatus } from './use-cases/handoff.types.js';
import { renderOrchestratorPrompt } from './shared/orchestrator-prompt.js';
import { beginHandoffCreation, enrollLegacyHandoff, inspectHandoff, prepareHandoff, recordHandoffThread, recoverHandoff, reserveHandoff } from './use-cases/handoff.js';

function nativeRequest(result: HandoffStatus) {
  const handoff = result.claim.record.handoff!;
  return {
    title: 'Orchestrator', model: 'gpt-6-luna', thinking: 'xhigh',
    target: { type: 'project', projectId: handoff.projectId!, environment: {
      type: 'worktree', startingState: { type: 'branch', branchName: handoff.integrationBranch },
    } },
    prompt: renderOrchestratorPrompt({ repo: handoff.repo, sourceNumber: result.claim.record.sourceNumber,
      tickets: result.tickets, baseBranch: handoff.baseBranch, integrationBranch: handoff.integrationBranch, marker: handoff.marker }),
  };
}

export async function runHandoffCommand(github: GitHub, root: string, repo: string, owner: string, issue: number, values: HandoffCliOptions) {
  const step = values.step ?? 'inspect';
  if (!['inspect', 'enroll', 'reserve', 'prepare', 'create', 'record', 'recover'].includes(step)) throw new Error('Unknown handoff step.');
  let result = await inspectHandoff(github, issue, owner);
  const handoff = result.claim.record.handoff;
  if (handoff && handoff.repo.toLowerCase() !== repo.toLowerCase()) throw new Error('Handoff repository differs from origin.');
  if (step === 'inspect') return handoff?.projectId ? { ...result, nativePreview: nativeRequest(result) } : result;
  if (!values.expected || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(values.expected)) throw new Error('Supply --expected with the current handoff claim SHA.');
  const mutation = { sourceNumber: issue, ownerId: owner, expectedSha: values.expected };
  if (step === 'enroll') {
    const source = await github.issue(issue);
    return enrollLegacyHandoff(github, { ...mutation, repo, sourceBody: source.body, manual: values.manual === true });
  }
  // Native destinations must come from this profile's existing registration.
  // A handoff never registers a project, changes a schedule, or selects by name.
  const context = getBootstrapContext(root);
  const registration = context.record;
  if (context.attention || !registration || registration.ownerId !== owner || registration.planningRoot !== context.checkout
    || registration.repository !== repo.toLowerCase() || !registration.projectId) {
    throw new Error('Handoff needs the existing owner and project in the canonical planning checkout. Complete or recover setup separately.');
  }
  if (handoff?.projectId && (handoff.projectId !== registration.projectId || handoff.checkoutRoot !== context.checkout)) {
    throw new Error('Handoff destination changed. Preserve the original project and checkout for recovery.');
  }
  if (step === 'recover') return recoverHandoff(github, { ...mutation,
    confirmedStopped: values['confirm-stopped'] === true, confirmedAbsent: values['confirmed-absent'] === true });
  if (!values.session?.trim()) throw new Error('Supply --session with the current Codex chat session ID.');
  const execution = { ...mutation, executorSessionId: values.session };
  if (step === 'reserve') {
    if (values.project !== registration.projectId) throw new Error('Supply --project with the verified registered project ID.');
    return reserveHandoff(github, { ...execution, projectId: registration.projectId, checkoutRoot: context.checkout });
  }
  if (step === 'record') return recordHandoffThread(github, { ...execution,
    clientThreadId: values['client-thread'], threadId: values.thread, hostId: values.host });
  if (!handoff || handoff.executorSessionId !== values.session) throw new Error('Handoff is reserved by another session or is not reserved.');
  // Repeated creation attempts only reconcile. Never inspect/reset a branch that
  // a successfully created but unrecorded Orchestrator might already be using.
  if (handoff.status === 'creating' || handoff.status === 'launched') return result;
  if (handoff.status !== 'reserved' || result.claim.sha !== values.expected) throw new Error('Read the current reserved handoff claim before preparing or creating.');
  if (step === 'prepare') {
    if (!handoff.baseCommit) {
      await assertIntegrationBranchAbsent(root, handoff.integrationBranch);
      const baseCommit = await resolveIntegrationBase(root, handoff.baseBranch);
      result = await prepareHandoff(github, { ...execution, baseCommit });
    }
    const prepared = result.claim.record.handoff!;
    await ensureIntegrationBranch(root, prepared.integrationBranch, prepared.baseCommit!, true);
    return { ...result, action: 'begin-create' as const, nativePreview: nativeRequest(result) };
  }
  if (!handoff.baseCommit) throw new Error('Prepare the integration branch before creating the Orchestrator.');
  await ensureIntegrationBranch(root, handoff.integrationBranch, handoff.baseCommit, true);
  // Build/validate the payload before consuming the one creation permission.
  const request = nativeRequest(result);
  result = await beginHandoffCreation(github, execution);
  return result.action === 'create' ? { ...result, nativeRequest: request } : result;
}
