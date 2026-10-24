import { describe, expect, it } from 'vitest';
import { publishDraft } from '../use-cases/publish.js';
import { beginSession } from '../use-cases/session.js';
import { scanPlanning } from '../use-cases/scan.js';
import { FakeGitHub, initialState, MemoryStore } from './publish-fixture.js';
import { options } from './session-fixture.js';

describe('publication to Orchestrator handoff', () => {
  it('persists pending handoff atomically with completion before deleting the draft', async () => {
    const state = initialState();
    state.snapshot.source.body += '\nIntegration base: release/candidate';
    const github = new FakeGitHub(state);
    const store = new MemoryStore();
    store.remove = async () => {
      expect(github.claim.record).toMatchObject({ phase: 'complete', handoff: {
        status: 'pending', baseBranch: 'release/candidate', integrationBranch: 'LLM/spec-1-integration',
      } });
      expect(github.claim.record.published).toEqual({
        'group:implementation': 2, 'group:code-review': 3, 'group:performance-review': 4, 'ticket:create': 5, 'ticket:read': 6,
      });
      store.saved = null;
      store.removed = true;
    };
    await publishDraft(github, store, state);
    expect(store.removed).toBe(true);
    const handoff = structuredClone(github.claim.record.handoff);
    expect((await beginSession(github, store, 'machine', 1, options)).handoff).toEqual(handoff);
    await publishDraft(github, store, state);
    expect(github.claim.record.handoff).toEqual(handoff);
    expect(github.creates).toBe(5);
  });

  it('leaves historical completed records alone, even with leftover publication state', async () => {
    const state = initialState();
    const github = new FakeGitHub(state);
    const store = new MemoryStore();
    github.claim.record.phase = 'complete';
    github.claim.record.runId = null;
    await store.save(1, state);
    await publishDraft(github, store, state);
    expect(github.claim.record.handoff).toBeUndefined();
    expect((await beginSession(github, store, 'machine', 1, options)).handoff).toBeUndefined();
    expect(github.creates).toBe(0);
  });

  it('does not seed a handoff after an unapproved or failed publication', async () => {
    const state = initialState();
    const github = new FakeGitHub(state);
    const store = new MemoryStore();
    state.snapshot.approved = false;
    await expect(publishDraft(github, store, state)).rejects.toThrow('approved draft');
    state.snapshot.approved = true;
    github.failAfterCreate = 2;
    await expect(publishDraft(github, store, state)).rejects.toThrow('Response lost');
    expect(github.claim.record.handoff).toBeUndefined();
    expect(store.removed).toBe(false);
  });

  it('rejects ambiguous branch instructions before publishing any issues', async () => {
    const state = initialState();
    state.snapshot.source.body += '\nIntegration base: main\nIntegration base: dev';
    const github = new FakeGitHub(state);
    await expect(publishDraft(github, new MemoryStore(), state)).rejects.toThrow('Ambiguous');
    expect(github.writes).toEqual([]);
  });

  it('finds pending handoffs after source closure and label removal, without drafts', async () => {
    const state = initialState();
    const github = new FakeGitHub(state);
    await publishDraft(github, new MemoryStore(), state);
    github.issues[0].state = 'closed';
    github.issues[0].labels = [];
    github.candidates = async () => [];
    expect(await scanPlanning(github, 'example/template', 'machine')).toMatchObject([
      { number: 1, action: 'handoff', claim: { record: { handoff: { status: 'pending' } } } },
    ]);
    expect(await scanPlanning(github, 'example/template', 'another-owner')).toEqual([]);
  });

  it('does not duplicate a pending candidate or automatically launch legacy completion', async () => {
    const state = initialState();
    const github = new FakeGitHub(state);
    github.candidates = async () => [github.issues[0]];
    await publishDraft(github, new MemoryStore(), state);
    const results = await scanPlanning(github, 'example/template', 'machine');
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('handoff');
    delete github.claim.record.handoff;
    expect(await scanPlanning(github, 'example/template', 'machine')).toMatchObject([{ action: 'complete' }]);
  });
});
