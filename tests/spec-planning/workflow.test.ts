import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { beginSession, acceptDraft, stopSession } from '../../src/server/use-cases/spec-planning/session.js';
import { publishDraft } from '../../src/server/use-cases/spec-planning/publish.js';
import { createLocalStore } from '../../src/db/spec-planning/local.js';
import { sessionFixture, validDraft, options } from './session-fixture.js';

const roots: string[] = [];
async function localStore() {
  const root = await mkdtemp(join(tmpdir(), 'spec-planning-flow-'));
  roots.push(root);
  return { root, store: await createLocalStore(root) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('local planning through publication', () => {
  it('waits once, publishes after label approval, verifies durable records, then removes only that session', async () => {
    const { github } = sessionFixture();
    const { root, store } = await localStore();
    const neighbor = join(root, '.artifacts/spec-planning/2');
    await mkdir(neighbor, { recursive: true });
    await writeFile(join(neighbor, 'draft.json'), 'other spec');
    const source = structuredClone(github.issues[0]);
    const first = await beginSession(github, store, 'machine', 1, options);
    expect(first.action).toBe('draft');
    await acceptDraft(github, store, first.state!, validDraft(first.state!));
    expect(github.creates).toBe(0);
    expect(github.notes).toHaveLength(1);
    const second = await beginSession(github, store, 'machine', 1, { ...options, runId: 'poll' });
    expect(second.action).toBe('waiting');
    expect(github.notes).toHaveLength(1);
    github.issues[0].labels.push('auto-approve');
    const approved = await beginSession(github, store, 'machine', 1, { ...options, runId: 'approved' });
    expect(approved.action).toBe('publish');
    await publishDraft(github, store, approved.state!);
    expect(await store.load(1)).toBeNull();
    expect(await readFile(join(neighbor, 'draft.json'), 'utf8')).toBe('other spec');
    expect(github.claim.record.phase).toBe('complete');
    expect(Object.keys(github.claim.record.published!)).toHaveLength(4);
    expect(github.notes.at(-1)?.body).toContain('All issue bodies, parents, labels, and dependencies were verified');
    expect(github.issues[0]).toEqual({ ...source, labels: [...source.labels, 'auto-approve'] });
    expect((await beginSession(github, store, 'machine', 1, options)).action).toBe('complete');
    expect(github.creates).toBe(4);
  });

  it('keeps the approval snapshot when source labels and closure change during generation', async () => {
    const { github } = sessionFixture();
    github.issues[0].labels.push('auto-approve');
    const { store } = await localStore();
    const begun = await beginSession(github, store, 'machine', 1, options);
    github.issues[0].labels = [];
    github.issues[0].state = 'closed';
    const accepted = await acceptDraft(github, store, begun.state!, validDraft(begun.state!));
    await publishDraft(github, store, accepted);
    expect(github.creates).toBe(4);
    expect(github.issues[0].state).toBe('closed');
    expect(github.issues[0].labels).toEqual([]);
  });

  it('stops after an uncertain create, blocks scheduled retries, and recovers manually without a duplicate', async () => {
    const { github } = sessionFixture();
    github.issues[0].labels.push('auto-approve');
    const { store } = await localStore();
    const begun = await beginSession(github, store, 'machine', 1, options);
    const accepted = await acceptDraft(github, store, begun.state!, validDraft(begun.state!));
    github.failAfterCreate = 2;
    await expect(publishDraft(github, store, accepted)).rejects.toThrow('Response lost');
    await stopSession(github, store, accepted, 'Response lost after successful creation');
    expect((await beginSession(github, store, 'machine', 1, options)).action).toBe('skip');
    expect(await store.load(1)).not.toBeNull();
    const resumed = await beginSession(github, store, 'machine', 1, { ...options, runId: 'retry', manual: true });
    expect(resumed.action).toBe('publish');
    await publishDraft(github, store, resumed.state!);
    expect(github.creates).toBe(4);
    expect(github.parents.size).toBe(4);
    expect(await store.load(1)).toBeNull();
  });
});
