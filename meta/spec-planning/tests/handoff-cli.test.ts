import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBootstrapContext } from '../bootstrap/context.js';
import type { WorkflowRecord } from '../bootstrap/bootstrap.types.js';
import { runHandoffCommand } from '../handoff-cli.js';
import type { HandoffCliOptions } from '../handoff-cli.types.js';
import { publishDraft } from '../use-cases/publish.js';
import { FakeGitHub, initialState, MemoryStore } from './publish-fixture.js';

const owner = '12345678-1234-1234-1234-123456789abc';
const project = 'registered-project';
const integration = 'LLM/spec-1-integration';
let directory: string;
let root: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function branchExists(): boolean {
  return spawnSync('git', ['-C', root, 'show-ref', '--verify', '--quiet', `refs/heads/${integration}`]).status === 0;
}

function registration(overrides: Partial<WorkflowRecord> = {}): void {
  const context = getBootstrapContext(root);
  const record: WorkflowRecord = {
    version: 1, repository: 'example/template', planningRoot: root, phase: 'ready', reservation: null,
    ownerId: owner, projectId: project, automationId: null, previousAutomationIds: [],
    initialCheck: { state: 'complete', sessionId: null }, disabledReason: null, migration: null,
    nativeObservation: { state: 'absent', automationId: null, observedAt: '2026-01-01T00:00:00Z' }, ...overrides,
  };
  mkdirSync(dirname(context.registryPath), { recursive: true });
  writeFileSync(context.registryPath, JSON.stringify(record));
  const owners = join(root, '.local', 'spec-planning', 'owners');
  mkdirSync(owners, { recursive: true });
  writeFileSync(join(owners, `${owner}.json`), JSON.stringify({ version: 1, repo: 'example/template', root, ownerId: owner }));
}

async function published(sourceBody?: string): Promise<FakeGitHub> {
  const state = initialState();
  state.snapshot.ownerId = owner;
  if (sourceBody) state.snapshot.source.body = sourceBody;
  const github = new FakeGitHub(state);
  github.claim.record.ownerId = owner;
  github.claim.sha = '0'.repeat(40);
  let revision = 0;
  vi.spyOn(github, 'updateClaim').mockImplementation(async (expected, record) => {
    if (expected.sha !== github.claim.sha) return null;
    github.claim = { sha: createHash('sha1').update(String(++revision)).digest('hex'), record: structuredClone(record) };
    github.writes.push('claim');
    return structuredClone(github.claim);
  });
  await publishDraft(github, new MemoryStore(), state);
  github.writes = [];
  return github;
}

function step(github: FakeGitHub, command: string, options: HandoffCliOptions = {}) {
  return runHandoffCommand(github, root, 'example/template', owner, 1, {
    step: command, expected: github.claim.sha, session: 'handoff-executor', project, ...options,
  });
}

beforeEach(() => {
  directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'handoff-cli-')));
  root = join(directory, 'checkout');
  mkdirSync(root);
  vi.stubEnv('CODEX_HOME', join(directory, 'isolated-profile'));
  git('init', '--quiet', '--initial-branch=main');
  git('remote', 'add', 'origin', 'https://github.com/example/template.git');
  // Missing-base cases must fail locally, never access GitHub or inherited credentials.
  git('config', 'protocol.https.allow', 'never');
  writeFileSync(join(root, '.gitignore'), '.local/\n');
  writeFileSync(join(root, 'tracked.txt'), 'committed contents\n');
  git('add', '.gitignore', 'tracked.txt');
  git('-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe('handoff CLI integration', () => {
  it('inspects completed publication without creating a registration or mutating shared state', async () => {
    const github = await published();
    const result = await step(github, 'inspect');
    expect(result).toMatchObject({ action: 'reserve', tickets: [5, 6] });
    expect(getBootstrapContext(root).record).toBeNull();
    expect(github.writes).toEqual([]);
    expect(branchExists()).toBe(false);
  });

  it('rejects absent registration, wrong project, and missing canonical checkout without writes', async () => {
    const github = await published();
    await expect(step(github, 'reserve')).rejects.toThrow('canonical planning checkout');
    registration();
    await expect(step(github, 'reserve', { project: 'different-project' })).rejects.toThrow('verified registered project');
    registration({ planningRoot: join(directory, 'missing-checkout') });
    await expect(step(github, 'reserve')).rejects.toThrow('canonical planning checkout');
    expect(github.writes).toEqual([]);
    expect(branchExists()).toBe(false);
  });

  it('prepares integration without switching, staging, or overwriting dirty checkout', async () => {
    const github = await published();
    registration();
    const main = git('rev-parse', 'main');
    writeFileSync(join(root, 'tracked.txt'), 'unfinished user edit\n');
    writeFileSync(join(root, 'untracked.txt'), 'unfinished user addition\n');
    const originalStatus = git('status', '--porcelain');
    await step(github, 'reserve');
    expect(await step(github, 'prepare')).toMatchObject({ action: 'begin-create' });
    expect(git('rev-parse', integration)).toBe(main);
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('status', '--porcelain')).toBe(originalStatus);
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('unfinished user edit\n');
    expect(readFileSync(join(root, 'untracked.txt'), 'utf8')).toBe('unfinished user addition\n');
    expect(git('diff', '--cached', '--name-only')).toBe('');
  });

  it('returns one native worktree request with exact tickets and preserves queued versus actual IDs', async () => {
    const github = await published();
    registration({ phase: 'active', automationId: 'existing-planner' });
    await step(github, 'reserve');
    const prepared = await step(github, 'prepare');
    expect(prepared).toHaveProperty('nativePreview');
    expect(prepared).not.toHaveProperty('nativeRequest');
    expect(github.claim.record.handoff?.status).toBe('reserved');
    expect(await step(github, 'inspect')).toHaveProperty('nativePreview');
    const creating = await step(github, 'create');
    expect(creating).toMatchObject({ action: 'create', nativeRequest: {
      title: 'Orchestrator', model: 'gpt-6-luna', thinking: 'xhigh',
      target: { type: 'project', projectId: project, environment: { type: 'worktree', startingState: { type: 'branch', branchName: integration } } },
      prompt: expect.stringContaining('Exact implementation tickets: #5, #6.'),
    } });
    expect(creating).toHaveProperty('nativeRequest', 'nativePreview' in prepared ? prepared.nativePreview : null);
    const repeated = await step(github, 'create');
    expect(repeated).toMatchObject({ action: 'reconcile' });
    expect(repeated).not.toHaveProperty('nativeRequest');
    expect(await step(github, 'record', { 'client-thread': 'queued-client' })).toMatchObject({ action: 'reconcile' });
    expect(github.claim.record.handoff?.threadId).toBeUndefined();
    expect(await step(github, 'record', { session: 'later-scheduled-run', thread: 'actual-thread', host: 'local' })).toMatchObject({ action: 'launched' });
    expect(github.claim.record.handoff).toMatchObject({ clientThreadId: 'queued-client', threadId: 'actual-thread', hostId: 'local' });
    expect(await step(github, 'create')).not.toHaveProperty('nativeRequest');
    expect(getBootstrapContext(root).record).toMatchObject({ phase: 'active', automationId: 'existing-planner' });
  });

  it('keeps old publication dormant until explicit manual enrollment', async () => {
    const github = await published();
    delete github.claim.record.handoff;
    expect(await step(github, 'inspect')).toMatchObject({ action: 'none' });
    await expect(step(github, 'enroll')).rejects.toThrow('explicit manual');
    expect(github.writes).toEqual([]);
    expect(await step(github, 'enroll', { manual: true })).toMatchObject({ action: 'reserve' });
    expect(getBootstrapContext(root).record).toBeNull();
    expect(branchExists()).toBe(false);
  });

  it('refuses stale claim SHA before creating any branch or native permission', async () => {
    const github = await published();
    registration();
    const stale = github.claim.sha;
    await step(github, 'reserve');
    github.writes = [];
    await expect(step(github, 'prepare', { expected: stale })).rejects.toThrow('current reserved handoff claim');
    await expect(step(github, 'create', { expected: stale })).rejects.toThrow('current reserved handoff claim');
    expect(github.writes).toEqual([]);
    expect(branchExists()).toBe(false);
    expect(github.claim.record.handoff?.status).toBe('reserved');
  });

  it('rejects existing integration branch even at base commit before consuming creation intent', async () => {
    const github = await published();
    registration();
    git('branch', integration, 'main');
    const existing = git('rev-parse', integration);
    await step(github, 'reserve');
    github.writes = [];
    await expect(step(github, 'prepare')).rejects.toThrow('Integration branch collision');
    expect(github.writes).toEqual([]);
    expect(git('rev-parse', integration)).toBe(existing);
    expect(github.claim.record.handoff).toMatchObject({ status: 'reserved' });
    expect(github.claim.record.handoff?.baseCommit).toBeUndefined();
  });

  it('fails missing declared base without fallback or branch creation', async () => {
    const github = await published('Deliver capabilities.\nIntegration base: release/missing');
    registration();
    await step(github, 'reserve');
    github.writes = [];
    await expect(step(github, 'prepare')).rejects.toThrow('Cannot resolve integration base release/missing');
    expect(github.writes).toEqual([]);
    expect(branchExists()).toBe(false);
    expect(github.claim.record.handoff).toMatchObject({ status: 'reserved', baseBranch: 'release/missing' });
    expect(github.claim.record.handoff?.baseCommit).toBeUndefined();
  });

  it('pins alternate source base even when main points elsewhere', async () => {
    git('branch', 'release/approved', 'main');
    const approved = git('rev-parse', 'release/approved');
    writeFileSync(join(root, 'tracked.txt'), 'later main commit\n');
    git('add', 'tracked.txt');
    git('-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'later main');
    const github = await published('Deliver capabilities.\nIntegration base: release/approved');
    registration();
    await step(github, 'reserve');
    await step(github, 'prepare');
    expect(git('rev-parse', integration)).toBe(approved);
    expect(git('rev-parse', integration)).not.toBe(git('rev-parse', 'main'));
    expect(git('branch', '--show-current')).toBe('main');
  });
});
