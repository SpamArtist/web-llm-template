import { createHash } from 'node:crypto';
import { DraftValidationError } from './errors';
import type { Draft, DraftGroup, DraftTicket, GroupKey, Issue, Requirement, RunSnapshot } from './planning.types';

export const groupTitles: Record<GroupKey, string> = {
  implementation: 'Implementation Tickets',
  'code-review': 'Code Review',
  'performance-review': 'Performance Review',
};

export function sourceHash(issue: Issue): string {
  return createHash('sha256').update(JSON.stringify([issue.number, issue.title, issue.body])).digest('hex');
}

function invalid(message: string): never {
  throw new DraftValidationError(message);
}

function object(value: unknown, context: string, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`${context} must be an object.`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) invalid(`${context} has unknown field ${key}.`);
  }
  return record;
}

function text(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${context} must be nonempty text.`);
  return value;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${context} must be an array.`);
  return value;
}

function strings(value: unknown, context: string): string[] {
  const result = array(value, context).map((entry) => text(entry, context));
  unique(result, context);
  return result;
}

function unique(values: string[], context: string): void {
  if (new Set(values).size !== values.length) invalid(`${context} contains duplicate identifiers.`);
}

function identifier(value: unknown, context: string): string {
  const key = text(value, context);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key)) invalid(`${context} must be a stable identifier.`);
  return key;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function requirement(value: unknown): Requirement {
  const item = object(value, 'requirement', ['id', 'kind', 'text']);
  const kind = item.kind;
  if (kind !== 'story' && kind !== 'decision' && kind !== 'test') invalid('Requirement kind must be story, decision, or test.');
  return { id: identifier(item.id, 'requirement.id'), kind, text: text(item.text, 'requirement.text') };
}

function group(value: unknown): DraftGroup {
  const item = object(value, 'group', ['key', 'title', 'body']);
  const key = item.key;
  if (key !== 'implementation' && key !== 'code-review' && key !== 'performance-review') invalid('Unknown group key.');
  if (item.title !== groupTitles[key]) invalid(`Group ${key} has the wrong title.`);
  const body = text(item.body, `group ${key}.body`);
  if (key !== 'implementation') {
    if (!/sub[ -]?issues/i.test(body) || !/implementation/i.test(body) || !/\ball\b/i.test(body) || !/finish|complet/i.test(body) || !/wait|block|after/i.test(body)) {
      invalid(`Review group ${key} must describe actual sub-issues waiting for all implementation tickets to finish.`);
    }
  }
  return { key, title: groupTitles[key], body };
}

function ticket(value: unknown): DraftTicket {
  const item = object(value, 'ticket', ['key', 'title', 'body', 'requirementIds', 'blockedBy', 'existingIssue']);
  const body = text(item.body, 'ticket.body');
  if (!/acceptance/i.test(body) || !/test|verification/i.test(body) || !/evidence/i.test(body) || !/\bred\b/i.test(body) || !/\bgreen\b/i.test(body) || !/\brefactor\b/i.test(body)) {
    invalid('Ticket bodies require acceptance criteria, testing, Red/Green/Refactor steps, and evidence.');
  }
  const result: DraftTicket = {
    key: identifier(item.key, 'ticket.key'), title: text(item.title, 'ticket.title'), body,
    requirementIds: strings(item.requirementIds, 'ticket.requirementIds'), blockedBy: strings(item.blockedBy, 'ticket.blockedBy'),
  };
  if ('existingIssue' in item) {
    if (typeof item.existingIssue !== 'number' || !Number.isSafeInteger(item.existingIssue) || item.existingIssue < 1) invalid('existingIssue must be a positive issue number.');
    result.existingIssue = item.existingIssue;
  }
  if (!result.requirementIds.length) invalid(`Ticket ${result.key} must cover a source requirement.`);
  return result;
}

/** Structural validation cannot prove that the model extracted every source requirement. */
export function validateDraft(value: unknown, snapshot: RunSnapshot): Draft {
  const item = object(value, 'draft', ['version', 'sourceNumber', 'sourceHash', 'codeCommit', 'requirements', 'groups', 'tickets']);
  if (item.version !== 1 || item.sourceNumber !== snapshot.source.number || item.sourceHash !== snapshot.sourceHash || item.codeCommit !== snapshot.codeCommit) {
    invalid('Draft version or source snapshot does not match the session.');
  }
  const requirements = array(item.requirements, 'requirements').map(requirement);
  const groups = array(item.groups, 'groups').map(group);
  const tickets = array(item.tickets, 'tickets').map(ticket);
  if (!requirements.length || !tickets.length) invalid('At least one requirement and one implementation ticket are required.');
  if (groups.length !== 3) invalid('Exactly three grouping issues are required.');
  unique(requirements.map((entry) => entry.id), 'requirements');
  unique(groups.map((entry) => entry.key), 'groups');
  unique(tickets.map((entry) => entry.key), 'tickets');
  unique(tickets.filter((entry) => entry.existingIssue !== undefined).map((entry) => String(entry.existingIssue)), 'existing issues');
  const requirementsById = new Map(requirements.map((entry) => [entry.id, entry]));
  const covered = new Set<string>();
  for (const entry of tickets) {
    if (Object.hasOwn(groupTitles, entry.key)) invalid('Ticket keys must not collide with group keys.');
    for (const id of entry.requirementIds) {
      const source = requirementsById.get(id);
      if (!source) invalid(`Ticket ${entry.key} refers to unknown requirement ${id}.`);
      if (!normalize(entry.body).includes(normalize(source.text))) invalid(`Ticket ${entry.key} omits the full text of requirement ${id}.`);
      covered.add(id);
    }
  }
  for (const entry of requirements) {
    if (!covered.has(entry.id)) invalid(`Requirement ${entry.id} has no ticket.`);
  }
  const draft: Draft = { version: 1, sourceNumber: snapshot.source.number, sourceHash: snapshot.sourceHash, codeCommit: snapshot.codeCommit, requirements, groups, tickets };
  orderTickets(draft);
  return draft;
}

/** Stable topological order, with every blocker before its dependent ticket. */
export function orderTickets(draft: Draft): DraftTicket[] {
  const remaining = new Map(draft.tickets.map((entry) => [entry.key, entry]));
  if (remaining.size !== draft.tickets.length) invalid('Duplicate ticket keys.');
  for (const entry of draft.tickets) {
    for (const blocker of entry.blockedBy) {
      if (blocker === entry.key || !remaining.has(blocker)) invalid(`Ticket ${entry.key} has a self or unknown blocker ${blocker}.`);
    }
  }
  const result: DraftTicket[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].find((entry) => entry.blockedBy.every((blocker) => !remaining.has(blocker)));
    if (!ready) invalid('Ticket blockers contain a cycle.');
    result.push(ready);
    remaining.delete(ready.key);
  }
  return result;
}
