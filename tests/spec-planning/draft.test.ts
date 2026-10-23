import { describe, expect, it } from 'vitest';
import { groupTitles, orderTickets, sourceHash, validateDraft } from '../../src/shared/spec-planning/draft';
import { DraftValidationError } from '../../src/shared/spec-planning/errors';
import type { Draft, Issue, RunSnapshot } from '../../src/shared/spec-planning/planning.types';

const source: Issue = { id: 101, number: 1, title: 'Export a report', body: 'Users can export the complete report.', url: 'https://github.com/example/project/issues/1', state: 'open', labels: ['spec', 'ready-for-agent'] };
const snapshot: RunSnapshot = {
  version: 1, repo: 'example/project', source, sourceHash: sourceHash(source), approved: false,
  codeCommit: 'a'.repeat(40), startedAt: '2026-10-23T00:00:00Z', runId: 'run-1', ownerId: 'machine-1', sessionId: 'session-1',
};

function draft(): Draft {
  return {
    version: 1, sourceNumber: source.number, sourceHash: snapshot.sourceHash, codeCommit: snapshot.codeCommit,
    requirements: [{ id: 'US-1', kind: 'story', text: source.body }],
    groups: [
      { key: 'implementation', title: 'Implementation Tickets', body: 'Implementation tickets for source spec #1.' },
      { key: 'code-review', title: 'Code Review', body: 'For spec #1. Actual sub-issues must wait until all implementation tickets finish.' },
      { key: 'performance-review', title: 'Performance Review', body: 'For spec #1. Actual sub-issues must wait until all implementation tickets finish.' },
    ],
    tickets: [{
      key: 'export', title: 'Export the report',
      body: `## Requirements\n${source.body}\n## Acceptance criteria\n- [ ] Export contains all report rows.\n## Testing\nRed: assert export rows. Green: implement export. Refactor: simplify formatting.\n## Evidence\nRun the export command and inspect the saved output before closure.`,
      requirementIds: ['US-1'], blockedBy: [],
    }],
  };
}

describe('draft source snapshots', () => {
  it('ignores label and closure changes but detects requirement edits', () => {
    expect(sourceHash({ ...source, labels: [], state: 'closed' })).toBe(sourceHash(source));
    expect(sourceHash({ ...source, body: `${source.body} Add CSV.` })).not.toBe(sourceHash(source));
    expect(sourceHash({ ...source, title: 'Different request' })).not.toBe(sourceHash(source));
    expect(sourceHash({ ...source, number: 2 })).not.toBe(sourceHash(source));
  });

  it('accepts a complete draft without mutating it', () => {
    const input = draft();
    expect(validateDraft(input, snapshot)).toEqual(input);
    expect(Object.values(groupTitles)).toEqual(['Implementation Tickets', 'Code Review', 'Performance Review']);
  });

  it.each(['sourceNumber', 'sourceHash', 'codeCommit', 'version'])('rejects a stale or incompatible %s', (field) => {
    expect(() => validateDraft({ ...draft(), [field]: 'stale' }, snapshot)).toThrow(DraftValidationError);
  });

  it.each([null, [], 'draft', {}, { ...draft(), unexpected: true }, { ...draft(), tickets: 'tickets' }])('rejects malformed input %#', (value) => {
    expect(() => validateDraft(value, snapshot)).toThrow(DraftValidationError);
  });
});

describe('draft coverage and publication structure', () => {
  it('rejects missing or duplicate groups and incorrect titles', () => {
    const input = draft();
    input.groups.pop();
    expect(() => validateDraft(input, snapshot)).toThrow('Exactly three');
    input.groups.push(input.groups[0]);
    expect(() => validateDraft(input, snapshot)).toThrow('duplicate');
    const renamed = draft();
    renamed.groups[0].title = 'Tasks';
    expect(() => validateDraft(renamed, snapshot)).toThrow('wrong title');
  });

  it('rejects review containers with no waiting rule', () => {
    const input = draft();
    input.groups[1].body = 'Run a review.';
    expect(() => validateDraft(input, snapshot)).toThrow('waiting for all');
  });

  it('requires coverage and requirement text in each relevant ticket', () => {
    const input = draft();
    input.requirements.push({ id: 'TEST-1', kind: 'test', text: 'Test an empty report.' });
    expect(() => validateDraft(input, snapshot)).toThrow('has no ticket');
    input.tickets[0].requirementIds.push('TEST-1');
    expect(() => validateDraft(input, snapshot)).toThrow('omits the full text');
    input.tickets[0].body += '\nTest an empty report.';
    expect(validateDraft(input, snapshot)).toEqual(input);
    input.tickets[0].requirementIds.push('missing');
    expect(() => validateDraft(input, snapshot)).toThrow('unknown requirement');
  });

  it('rejects duplicate requirement IDs and duplicate ticket keys', () => {
    const input = draft();
    input.requirements.push(input.requirements[0]);
    expect(() => validateDraft(input, snapshot)).toThrow('duplicate');
    const tickets = draft();
    tickets.tickets.push(tickets.tickets[0]);
    expect(() => validateDraft(tickets, snapshot)).toThrow('duplicate');
  });

  it('requires testing and evidence in ticket bodies', () => {
    const input = draft();
    input.tickets[0].body = source.body;
    expect(() => validateDraft(input, snapshot)).toThrow('acceptance criteria');
  });

  it('rejects issue-number collisions and empty or reserved ticket keys', () => {
    const input = draft();
    input.tickets[0].existingIssue = 4;
    input.tickets.push({ ...input.tickets[0], key: 'export-next' });
    expect(() => validateDraft(input, snapshot)).toThrow('duplicate');
    input.tickets.pop();
    input.tickets[0].key = 'implementation';
    expect(() => validateDraft(input, snapshot)).toThrow('collide');
    input.tickets[0].key = '';
    expect(() => validateDraft(input, snapshot)).toThrow('nonempty');
  });
});

describe('blocking order', () => {
  it('orders blockers before dependents regardless of input order', () => {
    const input = draft();
    const first = input.tickets[0];
    input.tickets = [{ ...first, key: 'verify', blockedBy: ['export'] }, first];
    expect(orderTickets(validateDraft(input, snapshot)).map((entry) => entry.key)).toEqual(['export', 'verify']);
  });

  it('rejects unknown blockers, self blockers, and cycles', () => {
    const input = draft();
    input.tickets[0].blockedBy = ['unknown'];
    expect(() => validateDraft(input, snapshot)).toThrow('unknown blocker');
    input.tickets[0].blockedBy = ['export'];
    expect(() => validateDraft(input, snapshot)).toThrow('self');
    input.tickets[0].blockedBy = ['verify'];
    input.tickets.push({ ...input.tickets[0], key: 'verify', blockedBy: ['export'] });
    expect(() => validateDraft(input, snapshot)).toThrow('cycle');
  });
});
