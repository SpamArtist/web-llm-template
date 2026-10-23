import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const config = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
const definition = config.hooks.SessionStart[0];
const command = definition.hooks[0];
const event = { hook_event_name: 'SessionStart', session_id: 'hook-test-session', source: 'startup' };
const windows = process.platform === 'win32';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'spec-planning-hook-')));
let checkout: string;
let profile: string;
let registry: string;
let counter = 0;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function invoke(input = JSON.stringify(event), cwd = checkout, path = process.env.PATH) {
  const result = spawnSync(windows ? 'cmd.exe' : '/bin/sh', windows
    ? ['/d', '/s', '/c', command.commandWindows]
    : ['-c', command.command], {
    cwd, input, encoding: 'utf8', timeout: 6000,
    env: { ...process.env, CODEX_HOME: profile, PATH: path },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

function writeRecord(phase = 'active', planningRoot = checkout) {
  mkdirSync(dirname(registry), { recursive: true });
  writeFileSync(registry, JSON.stringify({
    version: 1, repository: 'example/hook-fixture', planningRoot, phase,
    reservation: null, ownerId: '00000000-0000-4000-8000-000000000001', projectId: 'local-project',
    automationId: 'native-schedule', previousAutomationIds: [], disabledReason: phase === 'disabled' ? 'user-paused' : null,
    migration: null, nativeObservation: null,
    initialCheck: { state: 'complete', sessionId: null },
  }));
}

beforeAll(() => {
  const source = join(scratch, 'source');
  mkdirSync(source);
  git(source, 'init');
  writeFileSync(join(source, 'fixture'), 'Locally authored hook integration fixture.\n');
  git(source, 'add', 'fixture');
  git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test fixture');
});

beforeEach(() => {
  checkout = join(scratch, `checkout with spaces ${++counter}`);
  profile = join(scratch, `profile ${counter}`);
  execFileSync('git', ['clone', '--quiet', join(scratch, 'source'), checkout]);
  git(checkout, 'remote', 'set-url', 'origin', 'https://github.com/Example/Hook-Fixture.git');
  cpSync(join(root, 'meta/spec-planning/hooks'), join(checkout, 'meta/spec-planning/hooks'), { recursive: true });
  cpSync(join(root, 'meta/spec-planning/bootstrap'), join(checkout, 'meta/spec-planning/bootstrap'), { recursive: true });
  writeFileSync(join(checkout, 'package.json'), '{"type":"module"}');
  const key = createHash('sha256').update('github.com/example/hook-fixture').digest('hex');
  registry = join(profile, 'spec-planning', key, 'workflow.json');
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('trusted SessionStart hook', () => {
  it('matches only startup and resume with a bounded command on both platforms', () => {
    const matcher = new RegExp(definition.matcher);
    expect(['startup', 'resume'].every(source => matcher.test(source))).toBe(true);
    expect(['compact', 'clear', 'fork'].some(source => matcher.test(source))).toBe(false);
    expect(command.timeout).toBeLessThanOrEqual(5);
    expect(command.commandWindows).toContain('session-start.ps1');
    expect(command.commandWindows).not.toContain('ExecutionPolicy Bypass');
  });

  it('runs from a fresh clone without npm dependencies and does not register anything', () => {
    const output = JSON.parse(invoke());
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput.additionalContext).toContain('Complete or resume local setup');
    expect(output.hookSpecificOutput.additionalContext).toContain('actual SessionStart hook context');
    expect(() => readFileSync(registry)).toThrow();
  });

  it('resolves the git root from a nested directory containing spaces', () => {
    const nested = join(checkout, 'nested folder', 'child');
    mkdirSync(nested, { recursive: true });
    expect(invoke(JSON.stringify({ ...event, source: 'resume', cwd: nested }), nested)).toContain('setup-spec-planning/SKILL.md');
  });

  it('reconciles native state even when local registration says active', () => {
    writeRecord();
    const before = readFileSync(registry, 'utf8');
    const output = invoke();
    expect(output).toContain('cached active state does not prove');
    expect(output).toContain('Keep unchanged or non-actionable state quiet');
    expect(output).toContain('If this is a scheduled spec-planning run');
    expect(readFileSync(registry, 'utf8')).toBe(before);
  });

  it('leaves an intentionally disabled workflow silent', () => {
    writeRecord('disabled');
    expect(invoke()).toBe('');
  });

  it('preserves a missing planning checkout and asks for recovery', () => {
    writeRecord('active', join(scratch, 'deleted-checkout'));
    expect(invoke()).toContain('report the problem before changing the planning checkout');
  });

  it('preserves malformed state and emits nonblocking guidance', () => {
    mkdirSync(dirname(registry), { recursive: true });
    writeFileSync(registry, '{broken');
    expect(invoke()).toContain('Do not overwrite malformed state');
    expect(readFileSync(registry, 'utf8')).toBe('{broken');
  });

  it('ignores malformed, oversized, compact, and delegated events', () => {
    expect(invoke('{')).toBe('');
    expect(invoke('x'.repeat(70 * 1024))).toBe('');
    expect(invoke(JSON.stringify({ ...event, source: 'compact' }))).toBe('');
    expect(invoke(JSON.stringify({ ...event, agent_id: 'child' }))).toBe('');
    expect(invoke(JSON.stringify({ ...event, hook_event_name: 'SubagentStart' }))).toBe('');
  });

  it.skipIf(windows)('reports missing Git without failing the Codex session', () => {
    const bin = join(scratch, 'empty-bin');
    mkdirSync(bin, { recursive: true });
    expect(invoke(JSON.stringify(event), checkout, bin)).toContain('Git or the repository root is unavailable');
  });

  it.skipIf(windows)('reports missing Node without installing dependencies', () => {
    const bin = join(scratch, 'git-only-bin');
    mkdirSync(bin, { recursive: true });
    const gitPath = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    symlinkSync(gitPath, join(bin, 'git'));
    expect(invoke(JSON.stringify(event), checkout, bin)).toContain('Git, Node.js, or the repository root is unavailable');
  });
});
