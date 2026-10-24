import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliResult, CliSetupResult, FakeGhState } from './cli.types.js';

const script = fileURLToPath(new URL('../cli.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const fakeGh = fileURLToPath(new URL('./cli-gh-fixture.cjs', import.meta.url));
let root: string;
let bin: string;
let statePath: string;

function run(program: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(program, args, { cwd: root, timeout: 20_000, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, SPEC_PLANNING_TEST_GH_STATE: statePath },
    }, (error, stdout, stderr) => resolve({ stdout, stderr, failed: Boolean(error) }));
  });
}
const cli = (...args: string[]) => run(process.execPath, [tsx, script, ...args]);
const readState = async (): Promise<FakeGhState> => JSON.parse(await readFile(statePath, 'utf8'));

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spec-planning-cli-')));
  bin = join(root, 'bin');
  statePath = join(root, 'fake-gh-state.json');
  await mkdir(bin);
  await copyFile(fakeGh, join(bin, 'gh'));
  await chmod(join(bin, 'gh'), 0o755);
  await writeFile(statePath, JSON.stringify({ writable: true, installed: true, labels: [], requests: [], writes: [] }));
  expect((await run('git', ['init', '--quiet'])).failed).toBe(false);
  expect((await run('git', ['remote', 'add', 'origin', 'https://github.com/example/generated.git'])).failed).toBe(false);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('setup CLI entry point', () => {
  it('creates labels and registration, reuses the owner, and supports a new app owner', async () => {
    const firstRun = await cli('setup');
    expect(firstRun.stderr).toBe('');
    expect(firstRun.failed).toBe(false);
    const first: CliSetupResult = JSON.parse(firstRun.stdout);
    expect(first).toMatchObject({ scheduleEnabled: false, config: { version: 1, repo: 'example/generated', root } });
    expect(first.config.ownerId).toMatch(/^[a-f0-9-]{36}$/);
    const registration = join(root, '.local/spec-planning/owners', `${first.config.ownerId}.json`);
    expect(JSON.parse(await readFile(registration, 'utf8'))).toEqual(first.config);
    const initialGh = await readState();
    expect(initialGh.labels).toEqual(['spec', 'ready-for-agent', 'auto-approve', 'reference-only']);
    expect(initialGh.writes).toHaveLength(4);
    expect(initialGh.requests.filter(({ endpoint }) => endpoint.includes('/contents/'))).toHaveLength(11);
    const secondRun = await cli('setup');
    expect(secondRun.failed).toBe(false);
    expect((JSON.parse(secondRun.stdout) as CliSetupResult).config).toEqual(first.config);
    expect((await readState()).writes).toHaveLength(4);
    const newRun = await cli('setup', '--new-owner');
    expect(newRun.failed).toBe(false);
    const second: CliSetupResult = JSON.parse(newRun.stdout);
    expect(second.config.ownerId).not.toBe(first.config.ownerId);
    expect(JSON.parse(await readFile(registration, 'utf8'))).toEqual(first.config);
    expect(JSON.parse(await readFile(join(root, '.local/spec-planning/default-owner.json'), 'utf8'))).toEqual(second.config);
    expect((await readState()).writes).toHaveLength(4);
  }, 20_000);
  it('refuses missing write permission without creating labels or registration', async () => {
    await writeFile(statePath, JSON.stringify({ ...await readState(), writable: false }));
    const result = await cli('setup');
    expect(result.failed).toBe(true);
    expect(result.stderr).toContain('requires repository write access');
    expect((await readState()).writes).toEqual([]);
    await expect(readFile(join(root, '.local/spec-planning/default-owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('adopts a specific existing owner without replacing another profile default', async () => {
    const first: CliSetupResult = JSON.parse((await cli('setup')).stdout);
    const second: CliSetupResult = JSON.parse((await cli('setup', '--new-owner')).stdout);
    const adopted = await cli('setup', '--owner', first.config.ownerId);
    expect(adopted.failed).toBe(false);
    expect(JSON.parse(adopted.stdout).config).toEqual(first.config);
    expect(JSON.parse(await readFile(join(root, '.local/spec-planning/default-owner.json'), 'utf8'))).toEqual(second.config);
    const ambiguous = await cli('setup', '--owner', first.config.ownerId, '--new-owner');
    expect(ambiguous.failed).toBe(true);
    expect(ambiguous.stderr).toContain('not both');
  });
  it('refuses a missing explicit owner before changing labels', async () => {
    const result = await cli('setup', '--owner', '00000000-0000-4000-8000-000000000000');
    expect(result.failed).toBe(true);
    expect(result.stderr).toContain('not registered');
    expect((await readState()).writes).toEqual([]);
  });
  it('refuses a missing remote workflow before any setup changes', async () => {
    await writeFile(statePath, JSON.stringify({ ...await readState(), installed: false }));
    const result = await cli('setup');
    expect(result.failed).toBe(true);
    expect(result.stderr).toContain('Install the complete planning workflow');
    expect((await readState()).writes).toEqual([]);
    await expect(readFile(join(root, '.local/spec-planning/default-owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('shows help without GitHub access', async () => {
    const result = await cli('help');
    expect(result.failed).toBe(false);
    expect(result.stdout).toContain('Commands: setup');
    expect((await readState()).requests).toEqual([]);
  });
});
