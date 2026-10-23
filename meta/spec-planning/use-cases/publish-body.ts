import type { Draft, DraftGroup, DraftTicket, Issue, SessionState } from '../shared/planning.types.js';

export function marker(state: SessionState, key: string): string {
  return `<!-- spec-planning:${state.snapshot.source.number}:${state.snapshot.sessionId}:${key} -->`;
}

export function groupBody(state: SessionState, group: DraftGroup): string {
  const review = group.key === 'implementation' ? '' : '\n\nFuture review tickets must be actual sub-issues of this container and wait for all implementation tickets to finish. Add explicit blocking dependencies on every implementation ticket. Code Review and Performance Review can proceed independently. An empty container does not mean review is complete.';
  return `${group.body}\n\n## Source spec\n\n${state.snapshot.source.url}${review}\n\n${marker(state, `group:${group.key}`)}`;
}

export function ticketBody(state: SessionState, ticket: DraftTicket, parent: Issue, blockers: Issue[]): string {
  const requirements = state.draft!.requirements.filter((item) => ticket.requirementIds.includes(item.id));
  return `${ticket.body}\n\n## Parent\n\n${parent.url}\n\n## Source spec\n\n${state.snapshot.source.url}\n\n## Source requirements\n\n${requirements.map((item) => `### ${item.id}\n\n${item.text}`).join('\n\n')}\n\n## Blocked by\n\n${blockers.length ? blockers.map((issue) => `- ${issue.url}`).join('\n') : 'None — can start immediately.'}\n\n${marker(state, `ticket:${ticket.key}`)}`;
}

export function orderedTickets(draft: Draft): DraftTicket[] {
  const ordered: DraftTicket[] = [];
  const pending = new Map(draft.tickets.map((ticket) => [ticket.key, ticket]));
  while (pending.size) {
    const next = [...pending.values()].find((ticket) => ticket.blockedBy.every((key) => ordered.some((item) => item.key === key)));
    if (!next) throw new Error('Ticket dependencies contain a cycle or an unknown key.');
    ordered.push(next);
    pending.delete(next.key);
  }
  return ordered;
}
