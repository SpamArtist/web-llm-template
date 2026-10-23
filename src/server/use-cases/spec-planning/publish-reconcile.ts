import type { Claim, Issue } from '../../../shared/spec-planning/planning.types.js';
import type { Publication } from './publish.types.js';
import { marker } from './publish-body.js';

export async function checkOwner(context: Publication): Promise<Claim> {
  const { github, state } = context;
  const claim = await github.getClaim(state.snapshot.source.number);
  const snapshot = state.snapshot;
  if (!claim || claim.record.ownerId !== snapshot.ownerId || claim.record.sessionId !== snapshot.sessionId || claim.record.runId !== snapshot.runId || claim.record.phase !== 'busy') {
    throw new Error('Spec session ownership changed. Stop publication.');
  }
  return claim;
}

export async function save(context: Publication): Promise<void> {
  await context.store.save(context.state.snapshot.source.number, context.state);
}

export function assertUnchanged(issue: Issue, title: string, body: string): void {
  if (issue.title !== title || issue.body !== body) throw new Error(`Issue #${issue.number} differs from the publication record. Preserve human edits.`);
}

export async function reconcileIssue(context: Publication, key: string, title: string, body: string, parent: Issue, labels: string[], existingIssue?: number, approvedBody?: string): Promise<Issue> {
  const { github, state, issues } = context;
  const matched = issues.filter((issue) => issue.body.includes(marker(state, key)));
  if (matched.length > 1) throw new Error(`Duplicate publication markers for ${key}.`);
  const record = state.published[key];
  if (record && matched.length && record.number !== matched[0]!.number) throw new Error(`Conflicting publication record for ${key}.`);
  let issue = record ? await github.issue(record.number) : matched[0];
  if (!issue && existingIssue) issue = await github.issue(existingIssue);
  if (!issue && key.startsWith('group:')) {
    const matches = (await github.children(parent.number)).filter((child) => child.title === title);
    if (matches.length > 1) throw new Error(`Multiple grouping issues titled ${title}.`);
    issue = matches[0];
  }
  if (issue) {
    if (Object.entries(state.published).some(([otherKey, other]) => otherKey !== key && other.number === issue.number)) throw new Error(`Issue #${issue.number} is already assigned to another publication key.`);
    if (key.startsWith('group:') && issue.labels.includes('ready-for-agent')) throw new Error(`Container #${issue.number} must not have ready-for-agent.`);
    if (record) assertUnchanged(issue, record.title, record.body);
    const currentParent = await github.parent(issue.number);
    if (currentParent && currentParent.number !== parent.number) throw new Error(`Issue #${issue.number} has a different parent.`);
    if (!record && issue.title === title && issue.body === approvedBody) {
      await checkOwner(context);
      issue = await github.updateIssue(issue.number, title, body);
    } else {
      assertUnchanged(issue, title, body);
    }
  } else {
    await checkOwner(context);
    issue = await github.createIssue(title, body, labels);
    issues.push(issue);
  }
  state.published[key] = { number: issue.number, id: issue.id, title: issue.title, body: issue.body };
  await save(context);
  const actualParent = await github.parent(issue.number);
  if (actualParent && actualParent.number !== parent.number) throw new Error(`Issue #${issue.number} has a different parent.`);
  if (!actualParent) {
    await checkOwner(context);
    await github.attach(parent.number, issue);
    await save(context);
  }
  if (key.startsWith('group:') && issue.labels.includes('ready-for-agent')) throw new Error(`Container #${issue.number} must not have ready-for-agent.`);
  if (labels.some((label) => !issue.labels.includes(label))) {
    await checkOwner(context);
    await github.addLabels(issue.number, labels);
    await save(context);
  }
  return issue;
}

export function unsupportedDependencies(error: unknown): boolean {
  return error instanceof Error && error.name === 'UnsupportedDependenciesError';
}

export async function reconcileBlockers(context: Publication, issue: Issue, blockers: Issue[]): Promise<void> {
  try {
    const actual = await context.github.blockers(issue.number);
    if (actual.some((item) => !blockers.some((blocker) => blocker.number === item.number))) throw new Error(`Issue #${issue.number} has unexpected blocking dependencies.`);
    for (const blocker of blockers) {
      if (actual.some((item) => item.number === blocker.number)) continue;
      await checkOwner(context);
      await context.github.block(issue.number, blocker);
      await save(context);
    }
  } catch (error) {
    if (!unsupportedDependencies(error)) throw error;
    context.dependencyFallback.add(issue.number);
    // Every rendered ticket already contains the complete explicit Blocked by list.
  }
}
