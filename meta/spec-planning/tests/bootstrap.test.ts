import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubRepository } from '../bootstrap/context.js';
import { bootstrapFixture, cliPath, owner } from './bootstrap-fixture.js';

const fixtures: ReturnType<typeof bootstrapFixture>[] = [];
function fixture() { const value = bootstrapFixture(); fixtures.push(value); return value; }
afterEach(() => { for (const item of fixtures.splice(0)) rmSync(item.directory, { recursive: true, force: true }); });

describe('profile planning registry', () => {
  it('normalizes GitHub clone transports and rejects ambiguous destinations', () => {
    for (const origin of ['https://github.com/Example/Generated.git', 'git@github.com:EXAMPLE/Generated.git', 'ssh://git@github.com/example/generated.git']) {
      expect(githubRepository(origin)).toBe('example/generated');
    }
    for (const origin of ['https://other.test/example/generated', 'https://github.com/example/generated/tree/main', 'https://token@github.com/example/generated', 'https://github.com/example/generated?x=1', '/some/local/repo']) {
      expect(() => githubRepository(origin)).toThrow();
    }
  });
  it('status and the real CLI perform no profile writes before dependency installation', () => {
    const f = fixture();
    const status = f.cli(['status']);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ repository: 'example/generated', record: null });
    expect(existsSync(f.profile)).toBe(false);
  });
  it('shares one reservation and canonical checkout across clone transports', () => {
    const f = fixture();
    const second = f.checkout('second', 'git@github.com:example/generated.git');
    const first = f.call('reserve', { session: 'a' });
    expect(f.call('status', {}, second).registryPath).toBe(first.registryPath);
    expect(f.call('status', {}, second).marker).toBe(first.marker);
    expect(() => f.call('reserve', { session: 'b' }, second)).toThrow(/another session/);
    expect(f.call('reserve', { session: 'a' }, second).record?.planningRoot).toBe(f.root);
  });
  it('separates different profiles and repositories', () => {
    const f = fixture();
    const other = f.checkout('other', 'https://github.com/example/other.git');
    f.call('reserve', { session: 'a' });
    expect(f.call('status', {}, other).record).toBe(null);
    expect(f.call('status', {}, other).registryPath).not.toBe(f.call('status').registryPath);
    const secondProfile = { ...f.env, CODEX_HOME: join(f.directory, 'profile-two') };
    const run = promisify(execFile);
    return run(process.execPath, [cliPath, 'status'], { cwd: f.root, env: secondProfile }).then(result => {
      expect(JSON.parse(result.stdout).record).toBe(null);
    });
  });
  it('allows only one concurrent CLI session to reserve setup', async () => {
    const f = fixture();
    const run = promisify(execFile);
    const results = await Promise.allSettled(['a', 'b'].map(session => run(process.execPath, [cliPath, 'reserve', '--session', session], { cwd: f.root, env: f.env })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.call('status').record?.reservation?.sessionId).toMatch(/^[ab]$/);
  });
  it('defers unavailable prerequisites without losing owner or allowing a new checkout', () => {
    const f = fixture(); f.ready();
    f.call('defer', { session: 'session-a' });
    const second = f.checkout('second');
    const resumed = f.call('reserve', { session: 'session-b' }, second).record;
    expect(resumed).toMatchObject({ ownerId: owner, planningRoot: f.root, reservation: { sessionId: 'session-b' } });
  });
  it('requires registered canonical owner and confirmed absence before creation', () => {
    const f = fixture(); f.call('reserve', { session: 'a' });
    expect(() => f.call('register', { session: 'a', owner, project: 'p' })).toThrow();
    f.registerOwner();
    f.call('register', { session: 'a', owner, project: 'p' });
    expect(() => f.call('begin-create', { session: 'a' })).toThrow(/Confirm no matching/);
    f.call('native-reconcile', { state: 'unknown' });
    expect(() => f.call('begin-create', { session: 'a' })).toThrow(/Confirm no matching/);
  });
  it('preserves unknown creation and requires stopped-session recovery plus complete inventory', () => {
    const f = fixture(); f.ready(); f.call('begin-create', { session: 'session-a' });
    f.call('native-reconcile', { state: 'unknown' });
    expect(() => f.call('defer', { session: 'session-a' })).toThrow(/may have succeeded/);
    expect(() => f.call('reserve', { session: 'session-b' })).toThrow(/another session/);
    expect(() => f.call('recover', { session: 'session-b', previousSession: 'session-a' })).toThrow(/verified stopped/);
    f.call('recover', { session: 'session-b', previousSession: 'session-a', stopped: true });
    expect(() => f.call('native-reconcile', { state: 'absent', session: 'session-b' })).toThrow(/complete native inventory/);
    expect(f.call('status').record?.phase).toBe('creating');
    f.call('native-reconcile', { state: 'absent', session: 'session-b', inventoryConfirmed: true });
    expect(f.call('begin-create', { session: 'session-b' }).record?.phase).toBe('creating');
  });
  it('adopts a recovered successful creation without creating twice', () => {
    const f = fixture(); f.ready(); f.call('begin-create', { session: 'session-a' });
    expect(() => f.call('activate', { session: 'session-a', automation: 'a' })).toThrow(/confirmed active/);
    f.call('native-reconcile', { state: 'active', automation: 'a' });
    expect(f.call('activate', { session: 'session-a', automation: 'a' }).record?.phase).toBe('active');
    expect(() => f.call('begin-create', { session: 'session-a' })).toThrow();
  });
  it('keeps native pause/delete as tombstones and never uses unknown status as absence', () => {
    const f = fixture(); f.ready(); f.activate();
    f.call('native-reconcile', { state: 'unknown' });
    expect(f.call('status').record?.phase).toBe('active');
    f.call('native-reconcile', { state: 'paused', automation: 'automation-a' });
    expect(() => f.call('reserve', { session: 'b' })).toThrow(/disabled/);
    f.call('native-reconcile', { state: 'active', automation: 'automation-a' });
    expect(f.call('status').record?.phase).toBe('disabled');
    expect(() => f.call('enable', { session: 'b' })).toThrow(/explicit/);
  });
  it('re-enables paused identities and explicitly replaces confirmed deleted ones', () => {
    const f = fixture(); f.ready(); f.activate();
    f.call('native-reconcile', { state: 'paused', automation: 'automation-a' });
    f.call('enable', { session: 'b', explicit: true });
    expect(() => f.call('begin-create', { session: 'b' })).toThrow(/known native/);
    f.call('native-reconcile', { state: 'active', automation: 'automation-a' });
    f.call('activate', { session: 'b', automation: 'automation-a' });
    f.call('native-reconcile', { state: 'deleted', automation: 'automation-a' });
    f.call('enable', { session: 'c', explicit: true });
    expect(f.call('status').record).toMatchObject({ automationId: null, previousAutomationIds: ['automation-a'] });
    f.call('native-reconcile', { state: 'absent' });
    f.activate('c', 'automation-b');
    expect(f.call('status').record?.automationId).toBe('automation-b');
  });
  it('requires pause confirmation before heartbeat replacement and preserves predecessor', () => {
    const f = fixture(); f.ready('session-a', 'old-heartbeat');
    expect(() => f.call('begin-create', { session: 'session-a' })).toThrow(/predecessor/);
    expect(() => f.call('migration-paused', { session: 'session-a', automation: 'wrong' })).toThrow(/does not match/);
    f.call('migration-paused', { session: 'session-a', automation: 'old-heartbeat' });
    f.activate();
    expect(f.call('status').record?.migration).toEqual({ automationId: 'old-heartbeat', pauseConfirmed: true });
  });
  it('converts an imported paused heartbeat only after explicit enable', () => {
    const f = fixture();
    f.call('reserve', { session: 'import' });
    f.call('native-reconcile', { state: 'paused', automation: 'legacy-heartbeat' });
    f.registerOwner();
    const adoption = { session: 'enable', owner, project: 'project-a', migration: 'legacy-heartbeat' };
    expect(() => f.call('register', adoption)).toThrow(/disabled/);
    f.call('enable', { session: 'enable', explicit: true });
    expect(() => f.call('register', { ...adoption, migration: 'wrong-task' })).toThrow(/predecessor identity/);
    const adopted = f.call('register', adoption).record;
    expect(adopted).toMatchObject({
      ownerId: owner, planningRoot: f.root, automationId: null, nativeObservation: null,
      migration: { automationId: 'legacy-heartbeat', pauseConfirmed: false },
    });
    expect(() => f.call('begin-create', { session: 'enable' })).toThrow(/predecessor is paused/);
    f.call('migration-paused', { session: 'enable', automation: 'legacy-heartbeat' });
    expect(() => f.call('begin-create', { session: 'enable' })).toThrow(/Confirm no matching/);
    f.call('native-reconcile', { state: 'absent' });
    f.activate('enable', 'new-standalone-task');
    expect(f.call('status').record).toMatchObject({
      phase: 'active', automationId: 'new-standalone-task',
      migration: { automationId: 'legacy-heartbeat', pauseConfirmed: true },
    });
  });
  it('stops at a missing first checkout and preserves registry bytes', () => {
    const f = fixture(); f.ready();
    const second = f.checkout('second');
    const path = f.call('status').registryPath;
    const original = readFileSync(path, 'utf8');
    rmSync(f.root, { recursive: true });
    expect(f.call('status', {}, second).attention).toBe('planning-root-missing');
    expect(() => f.call('reserve', { session: 'b' }, second)).toThrow(/planning-root-missing/);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
  it('guards scheduled runs with native state, canonical checkout and durable owner', () => {
    const f = fixture(); f.ready(); f.activate();
    const args = { owner, automation: 'automation-a', state: 'active' as const };
    expect(f.call('guard', args).allowed).toBe(true);
    expect(() => f.call('guard', { ...args, state: 'unknown' })).toThrow(/guard failed/);
    expect(() => f.call('guard', args, f.checkout('second'))).toThrow(/guard failed/);
    rmSync(join(f.root, '.local', 'spec-planning', 'owners', `${owner}.json`));
    expect(() => f.call('guard', args)).toThrow();
  });
  it('runs the immediate check once and recovers only an explicitly stopped scan', () => {
    const f = fixture(); f.ready(); f.activate();
    f.call('initial-check', { action: 'begin', session: 'a' });
    expect(() => f.call('initial-check', { action: 'begin', session: 'b' })).toThrow(/already started/);
    expect(() => f.call('initial-check', { action: 'recover', session: 'b', previousSession: 'a' })).toThrow(/verified stopped/);
    f.call('initial-check', { action: 'recover', session: 'b', previousSession: 'a', stopped: true });
    f.call('initial-check', { action: 'begin', session: 'b' });
    f.call('initial-check', { action: 'complete', session: 'b' });
    expect(f.call('status').record?.initialCheck.state).toBe('complete');
  });
  it('rejects corrupted and future-version records without replacing them', () => {
    const f = fixture(); f.call('reserve', { session: 'a' });
    const path = f.call('status').registryPath;
    writeFileSync(path, '{"version":2}');
    expect(() => f.call('status')).toThrow(/Invalid/);
    expect(() => f.call('reserve', { session: 'b' })).toThrow(/Invalid/);
    expect(readFileSync(path, 'utf8')).toBe('{"version":2}');
  });
  it('rejects symlinked registry directories before reading or writing', () => {
    const f = fixture(); f.call('status');
    mkdirSync(f.profile);
    const target = join(f.directory, 'external'); mkdirSync(target);
    symlinkSync(target, join(f.profile, 'spec-planning'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => f.call('status')).toThrow(/symbolic links/);
    expect(() => f.call('reserve', { session: 'a' })).toThrow(/symbolic links/);
    expect(readdirSync(target)).toEqual([]);
  });
  it('does not steal a live filesystem writer lock', () => {
    const f = fixture(); f.call('reserve', { session: 'a' });
    const lock = join(dirname(f.call('status').registryPath), 'update.lock');
    mkdirSync(lock);
    writeFileSync(join(lock, 'writer.json'), JSON.stringify({ pid: process.pid, sessionId: 'a' }));
    expect(() => f.call('reserve', { session: 'a' })).toThrow(/locked/);
    expect(() => f.call('recover-lock', { stopped: true, previousSession: 'a' })).toThrow(/still alive/);
  });
  it('serializes stopped-writer recovery and protects the next live writer', () => {
    const f = fixture(); f.call('reserve', { session: 'a' });
    const lock = join(dirname(f.call('status').registryPath), 'update.lock');
    mkdirSync(lock);
    const deadPid = 2147483647;
    writeFileSync(join(lock, 'writer.json'), JSON.stringify({ pid: deadPid, sessionId: 'a' }));
    const realKill = process.kill.bind(process);
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid !== deadPid) return realKill(pid, signal);
      // Force a second recovery exactly after the first has read the old writer.
      expect(() => f.call('recover-lock', { stopped: true, previousSession: 'a' })).toThrow(/recovery is pending/);
      throw Object.assign(new Error('stopped'), { code: 'ESRCH' });
    });
    try { f.call('recover-lock', { stopped: true, previousSession: 'a' }); }
    finally { kill.mockRestore(); }
    expect(existsSync(lock)).toBe(false);
    mkdirSync(lock);
    writeFileSync(join(lock, 'writer.json'), JSON.stringify({ pid: process.pid, sessionId: 'a' }));
    expect(() => f.call('recover-lock', { stopped: true, previousSession: 'a' })).toThrow(/still alive/);
    expect(existsSync(lock)).toBe(true);
  });
  it('rejects invalid CLI arguments instead of silently ignoring them', () => {
    const f = fixture();
    expect(f.cli(['reserve', '--session']).status).toBe(1);
    expect(f.cli(['reserve', '--session', 'a', '--session', 'b']).status).toBe(1);
    expect(f.cli(['status', '--unexpected']).status).toBe(1);
    expect(existsSync(f.profile)).toBe(false);
  });
});
