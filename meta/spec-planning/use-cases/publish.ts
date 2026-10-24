import type { GitHub, Issue, SessionState, SessionStore } from '../shared/planning.types.js';
import type { Publication } from './publish.types.js';
import { groupBody, marker, orderedTickets, ticketBody } from './publish-body.js';
import { assertUnchanged, checkOwner, reconcileBlockers, reconcileIssue, save, unsupportedDependencies } from './publish-reconcile.js';
import { seedHandoff } from './handoff.js';

async function verify(context: Publication, key: string, parent: Issue, blockers: Issue[] = []): Promise<void> {
  const record = context.state.published[key]!;
  const issue = await context.github.issue(record.number);
  assertUnchanged(issue, record.title, record.body);
  if ((await context.github.parent(issue.number))?.number !== parent.number) throw new Error(`Parent verification failed for #${issue.number}.`);
  const group = key.startsWith('group:');
  if (issue.labels.includes('ready-for-agent') === group) throw new Error(`Label verification failed for #${issue.number}.`);
  if (group || context.dependencyFallback.has(issue.number)) return;
  try {
    const actual = (await context.github.blockers(issue.number)).map((item) => item.number).sort((a, b) => a - b);
    const expected = blockers.map((item) => item.number).sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Dependency verification failed for #${issue.number}.`);
  } catch (error) {
    if (!unsupportedDependencies(error)) throw error;
    // Body equality above verifies the explicit fallback dependency list.
  }
}

async function complete(context: Publication): Promise<void> {
  const { github, state, store } = context;
  const source = state.snapshot.source.number;
  const published = Object.fromEntries(Object.entries(state.published).map(([key, record]) => [key, record.number]));
  const completionMarker = marker(state, 'complete');
  const body = `Ticket publication is complete. All issue bodies, parents, labels, and dependencies were verified.\n\n${completionMarker}\n\n\`\`\`json\n${JSON.stringify({ version: 1, sourceNumber: source, sessionId: state.snapshot.sessionId, published }, null, 2)}\n\`\`\``;
  if (!(await github.comments(source)).some((comment) => comment.body.includes(completionMarker))) {
    await checkOwner(context);
    await github.comment(source, body);
  }
  const claim = await checkOwner(context);
  const handoff = seedHandoff(state.snapshot.repo, source, state.snapshot.sessionId, state.snapshot.source.body);
  if (!await github.updateClaim(claim, { ...claim.record, phase: 'complete', runId: null, published, handoff })) throw new Error('Spec ownership changed before completion.');
  state.status = 'complete';
  await store.remove(source);
}

export async function publishDraft(github: GitHub, store: SessionStore, state: SessionState): Promise<SessionState> {
  if (!state.snapshot.approved || !state.draft) throw new Error('Publication requires an approved draft.');
  const expectedKeys = new Set([
    ...state.draft.groups.map((group) => `group:${group.key}`),
    ...state.draft.tickets.map((ticket) => `ticket:${ticket.key}`),
  ]);
  const recovered = Object.entries(state.published);
  if (recovered.some(([key]) => !expectedKeys.has(key))) throw new Error('The draft omits previously published work. Recover the same breakdown.');
  if (new Set(recovered.map(([, record]) => record.number)).size !== recovered.length) throw new Error('Multiple publication keys refer to the same issue.');
  const claim = await github.getClaim(state.snapshot.source.number);
  if (claim?.record.phase === 'complete' && claim.record.ownerId === state.snapshot.ownerId && claim.record.sessionId === state.snapshot.sessionId) {
    state.status = 'complete';
    await store.remove(state.snapshot.source.number);
    return state;
  }
  // Validate handoff inputs before any publication writes; persist intent only
  // after the whole breakdown is verified. Old completed claims stay unchanged.
  seedHandoff(state.snapshot.repo, state.snapshot.source.number, state.snapshot.sessionId, state.snapshot.source.body);
  const context: Publication = { github, store, state, issues: await github.allIssues(), dependencyFallback: new Set() };
  await checkOwner(context);
  state.status = 'publishing';
  await save(context);
  const groups = new Map<string, Issue>();
  for (const group of state.draft.groups) {
    const issue = await reconcileIssue(context, `group:${group.key}`, group.title, groupBody(state, group), state.snapshot.source, [], undefined, group.body);
    groups.set(group.key, issue);
  }
  const implementation = groups.get('implementation');
  if (!implementation || groups.size !== 3) throw new Error('Publication requires all three grouping issues.');
  // Establish and verify every group before any implementation ticket is created.
  for (const group of state.draft.groups) await verify(context, `group:${group.key}`, state.snapshot.source);
  const tickets = new Map<string, Issue>();
  for (const ticket of orderedTickets(state.draft)) {
    const blockers = ticket.blockedBy.map((key) => tickets.get(key)!);
    const issue = await reconcileIssue(context, `ticket:${ticket.key}`, ticket.title, ticketBody(state, ticket, implementation, blockers), implementation, ['ready-for-agent'], ticket.existingIssue, ticket.body);
    tickets.set(ticket.key, issue);
    await reconcileBlockers(context, issue, blockers);
  }
  for (const group of state.draft.groups) await verify(context, `group:${group.key}`, state.snapshot.source);
  for (const ticket of state.draft.tickets) await verify(context, `ticket:${ticket.key}`, implementation, ticket.blockedBy.map((key) => tickets.get(key)!));
  await complete(context);
  return state;
}
