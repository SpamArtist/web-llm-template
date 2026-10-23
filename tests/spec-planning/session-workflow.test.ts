import { describe, expect, it, vi } from 'vitest';
import { acceptDraft, beginSession, stopSession } from '../../src/server/use-cases/spec-planning/session.js';
import { publishDraft } from '../../src/server/use-cases/spec-planning/publish.js';
import { transferSession } from '../../src/server/use-cases/spec-planning/ownership.js';
import { sourceHash } from '../../src/shared/spec-planning/draft.js';
import { FakeGitHub, MemoryStore } from './publish-fixture.js';
import { options, sessionFixture, validDraft } from './session-fixture.js';

function issue42() {
  const { state } = sessionFixture();
  state.snapshot.source.number = 42;
  state.snapshot.source.id = 42;
  state.snapshot.source.url = 'https://github.com/example/template/issues/42';
  state.snapshot.sourceHash = sourceHash(state.snapshot.source);
  const github = new FakeGitHub(state);
  github.claim.record = { ...github.claim.record, sourceNumber: 42, phase: 'owned', runId: null, sourceHash: state.snapshot.sourceHash };
  return { github, store: new MemoryStore() };
}

describe('documented local workflow through mocked services', () => {
  it('waits for the label, rebuilds an edited source, publishes, verifies, and cleans up', async () => {
    // Setup response is mocked: no local owner, schedule, or issue is created.
    const setupResult = { config: { root: '/example/repo', repo: 'example/template', ownerId: 'machine' }, scheduleEnabled: false };
    const { github, store } = issue42();
    const first = await beginSession(github, store, setupResult.config.ownerId, 42, { ...options, manual: true });
    expect(first.action).toBe('draft');
    await acceptDraft(github, store, first.state!, validDraft(first.state!));
    expect(store.saved?.status).toBe('waiting');
    expect(github.creates).toBe(0);

    github.issues[0].body = 'Users can export all rows, including archived rows.';
    github.issues[0].labels.push('auto-approve');
    const second = await beginSession(github, store, setupResult.config.ownerId, 42, { ...options, runId: 'second-run' });
    expect(second.action).toBe('draft');
    expect(second.state?.draft).toBeUndefined();
    const updated = validDraft(second.state!);
    updated.requirements[0].text = github.issues[0].body;
    updated.tickets[0].body = updated.tickets[0].body.replace('Users can export all rows.', github.issues[0].body);
    await acceptDraft(github, store, second.state!, updated);
    await publishDraft(github, store, second.state!);
    expect(github.claim.record.phase).toBe('complete');
    expect(github.creates).toBe(4);
    expect((await github.children(42)).map((issue) => issue.title)).toEqual(['Implementation Tickets', 'Code Review', 'Performance Review']);
    const implementation = (await github.children(42))[0];
    expect((await github.children(implementation.number))[0].body).toContain('including archived rows');
    expect(store.removed).toBe(true);
    expect((await beginSession(github, store, 'machine', 42, { ...options, manual: true })).action).toBe('complete');
    expect(github.creates).toBe(4);
  });

  it('transfers a stopped partial session, rebuilds missing files, and reuses created issues', async () => {
    const { github, store } = issue42();
    github.issues[0].labels.push('auto-approve');
    const initial = await beginSession(github, store, 'machine', 42, options);
    await acceptDraft(github, store, initial.state!, validDraft(initial.state!));
    github.failAfterCreate = 2;
    await expect(publishDraft(github, store, initial.state!)).rejects.toThrow('Response lost');
    await stopSession(github, store, initial.state!, 'Issue creation outcome requires reconciliation.');
    expect(github.creates).toBe(2);
    await transferSession(github, 42, 'receiving-machine', github.claim.sha);

    const emptyReceivingStore = new MemoryStore();
    const resumed = await beginSession(github, emptyReceivingStore, 'receiving-machine', 42, { ...options, manual: true, runId: 'receiving-run' });
    expect(resumed.action).toBe('draft');
    expect(resumed.state?.snapshot.sessionId).toBe(initial.state?.snapshot.sessionId);
    expect(Object.keys(resumed.state!.published)).toHaveLength(2);
    // The agent can reconstruct this small fixture exactly from its source and published groups.
    await acceptDraft(github, emptyReceivingStore, resumed.state!, validDraft(resumed.state!));
    await publishDraft(github, emptyReceivingStore, resumed.state!);
    expect(github.creates).toBe(4);
    expect(github.claim.record.phase).toBe('complete');
    expect(emptyReceivingStore.removed).toBe(true);
  });

  it('retries cleanup after a verified publication without changing completion to a stop', async () => {
    const { github, store } = issue42();
    github.issues[0].labels.push('auto-approve');
    const result = await beginSession(github, store, 'machine', 42, options);
    await acceptDraft(github, store, result.state!, validDraft(result.state!));
    vi.spyOn(store, 'remove').mockRejectedValueOnce(new Error('Cleanup failed'));
    await expect(publishDraft(github, store, result.state!)).rejects.toThrow('Cleanup failed');
    expect(github.claim.record.phase).toBe('complete');
    expect(result.state?.status).toBe('complete');
    // This is the CLI catch path after publication throws during local cleanup.
    await stopSession(github, store, result.state!, 'Cleanup failed');
    expect(store.saved?.status).toBe('publishing');
    expect(github.notes.some((note) => note.body.includes('Ticket planning stopped'))).toBe(false);
    expect((await beginSession(github, store, 'machine', 42, options)).action).toBe('complete');
    expect(store.saved).toBeNull();
    expect(store.removed).toBe(true);
  });
});
