import { describe, expect, it } from 'vitest';
import { publishDraft } from '../use-cases/publish.js';
import { FakeGitHub, initialState, MemoryStore } from './publish-fixture.js';

function setup() { const state = initialState(); return { state, github: new FakeGitHub(state), store: new MemoryStore() }; }

describe('publishDraft entry point', () => {
  it('publishes the exact hierarchy and dependencies, verifies saved results, then cleans up', async () => {
    const { state, github, store } = setup();
    const original = structuredClone(github.issues[0]);
    await publishDraft(github, store, state);
    expect(github.issues.map((issue) => issue.title)).toEqual(['Spec', 'Implementation Tickets', 'Code Review', 'Performance Review', 'Create records', 'Read records']);
    expect([...github.parents]).toEqual([[2, 1], [3, 1], [4, 1], [5, 2], [6, 2]]);
    expect(github.dependencies.get(6)).toEqual([5]);
    expect(github.issues[5]!.body).toContain('Users can read saved records.');
    expect(github.issues[5]!.body).toContain('https://github.com/example/template/issues/5');
    expect(github.issues.slice(1, 4).every((issue) => !issue.labels.includes('ready-for-agent'))).toBe(true);
    expect(github.issues.slice(4).every((issue) => issue.labels.includes('ready-for-agent'))).toBe(true);
    expect(github.writes.indexOf('attach:1:4')).toBeLessThan(github.writes.indexOf('create:Create records'));
    expect(github.issues[0]).toEqual(original);
    expect(github.claim.record.phase).toBe('complete');
    expect(github.claim.record.published?.['ticket:read']).toBe(6);
    expect(github.notes).toHaveLength(1);
    expect(store.removed).toBe(true);
    expect(state.status).toBe('complete');
    await publishDraft(github, store, state);
    expect(github.creates).toBe(5);
    expect(github.notes).toHaveLength(1);
  });

  it('recovers an unattached issue when creation succeeded but its response was lost', async () => {
    const { state, github, store } = setup();
    github.failAfterCreate = 4;
    await expect(publishDraft(github, store, state)).rejects.toThrow('Response lost');
    expect(store.removed).toBe(false);
    expect(github.parents.has(5)).toBe(false);
    await publishDraft(github, store, state);
    expect(github.creates).toBe(5);
    expect(github.parents.get(5)).toBe(2);
    expect(store.removed).toBe(true);
  });

  it('reconciles a completion comment after its successful response was lost', async () => {
    const { state, github, store } = setup();
    const comment = github.comment.bind(github);
    github.comment = async (number, body) => { await comment(number, body); throw new Error('Comment response lost'); };
    await expect(publishDraft(github, store, state)).rejects.toThrow('Comment response lost');
    expect(store.removed).toBe(false);
    expect(github.notes).toHaveLength(1);
    github.comment = comment;
    await publishDraft(github, store, state);
    expect(github.notes).toHaveLength(1);
    expect(github.creates).toBe(5);
    expect(store.removed).toBe(true);
  });

  it('rejects a rebuilt draft that omits previously published keys before any write', async () => {
    const { state, github, store } = setup();
    state.published['ticket:previous-breakdown'] = { number: 12, id: 12, title: 'Published work', body: 'Keep this work.' };
    await expect(publishDraft(github, store, state)).rejects.toThrow('omits previously published work');
    expect(github.writes).toEqual([]);
    expect(store.removed).toBe(false);
  });

  it('rejects two recovered keys mapped to one issue before any write', async () => {
    const { state, github, store } = setup();
    const record = { number: 12, id: 12, title: 'Published work', body: 'Keep this work.' };
    state.published['ticket:create'] = record;
    state.published['ticket:read'] = record;
    await expect(publishDraft(github, store, state)).rejects.toThrow('same issue');
    expect(github.writes).toEqual([]);
  });

  it('stops rather than overwrite human edits during recovery', async () => {
    const { state, github, store } = setup();
    github.failAfterCreate = 4;
    await expect(publishDraft(github, store, state)).rejects.toThrow();
    github.issues[1]!.body += '\nHuman edit';
    const writes = github.writes.length;
    await expect(publishDraft(github, store, state)).rejects.toThrow('Preserve human edits');
    expect(github.writes).toHaveLength(writes);
    expect(store.removed).toBe(false);
  });

  it('checks session ownership before each mutation', async () => {
    const { state, github, store } = setup();
    github.onCreate = () => { github.claim.record.ownerId = 'other-machine'; };
    await expect(publishDraft(github, store, state)).rejects.toThrow('ownership changed');
    expect(github.creates).toBe(1);
    expect(github.parents.size).toBe(0);
    expect(store.removed).toBe(false);
  });

  it('retains initial approval when labels and source status change mid-run', async () => {
    const { state, github, store } = setup();
    github.onCreate = () => { github.issues[0]!.labels = ['reference-only']; github.issues[0]!.state = 'closed'; };
    await publishDraft(github, store, state);
    expect(state.status).toBe('complete');
    expect(github.creates).toBe(5);
  });

  it('uses explicit Blocked by links only when native dependencies are unsupported', async () => {
    const { state, github, store } = setup();
    github.unsupported = true;
    await publishDraft(github, store, state);
    expect(github.dependencies.size).toBe(0);
    expect(github.issues[5]!.body).toContain('## Blocked by\n\n- https://github.com/example/template/issues/5');
    expect(state.status).toBe('complete');
  });

  it('uses the explicit dependency fallback when only mutation endpoints are unsupported', async () => {
    const { state, github, store } = setup();
    github.block = async () => { const error = new Error('Unavailable'); error.name = 'UnsupportedDependenciesError'; throw error; };
    await publishDraft(github, store, state);
    expect(github.issues[5]!.body).toContain('## Blocked by\n\n- https://github.com/example/template/issues/5');
    expect(state.status).toBe('complete');
  });

  it('does not clean up when final dependency verification fails', async () => {
    const { state, github, store } = setup();
    github.block = async () => {};
    await expect(publishDraft(github, store, state)).rejects.toThrow('Dependency verification failed');
    expect(store.removed).toBe(false);
    expect(github.claim.record.phase).toBe('busy');
    expect(github.notes).toHaveLength(0);
  });

  it('reuses approved existing grouping issues and explicit tickets', async () => {
    const { state, github, store } = setup();
    const group = state.draft!.groups[0]!;
    const existingGroup = await github.createIssue(group.title, group.body, []);
    await github.attach(1, existingGroup);
    const ticket = state.draft!.tickets[1]!;
    const existingTicket = await github.createIssue(ticket.title, ticket.body, []);
    ticket.existingIssue = existingTicket.number;
    await github.attach(existingGroup.number, existingTicket);
    await publishDraft(github, store, state);
    expect(github.creates).toBe(5);
    expect(state.published['group:implementation']!.number).toBe(existingGroup.number);
    expect(state.published['ticket:create']!.number).toBe(existingTicket.number);
    expect((await github.issue(existingTicket.number)).labels).toContain('ready-for-agent');
  });

  it('does not treat permission failures as unsupported dependency endpoints', async () => {
    const { state, github, store } = setup();
    github.blockers = async () => { throw new Error('Forbidden'); };
    await expect(publishDraft(github, store, state)).rejects.toThrow('Forbidden');
    expect(store.removed).toBe(false);
    expect(github.notes).toHaveLength(0);
  });

  it('rejects duplicate markers instead of choosing an arbitrary issue', async () => {
    const { state, github, store } = setup();
    github.failAfterCreate = 1;
    await expect(publishDraft(github, store, state)).rejects.toThrow();
    github.issues.push({ ...github.issues[1]!, id: 3, number: 3 });
    await expect(publishDraft(github, store, state)).rejects.toThrow('Duplicate publication markers');
    expect(store.removed).toBe(false);
  });
});
