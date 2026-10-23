import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { executeBootstrap } from '../bootstrap/workflow.js';
import type { BootstrapOptions } from '../bootstrap/bootstrap.types.js';

export const owner = '12345678-1234-1234-1234-123456789abc';
export const cliPath = resolve('meta/spec-planning/bootstrap/cli.js');
export function bootstrapFixture() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'planning-bootstrap-')));
  const profile = join(directory, 'profile');
  const env = { ...process.env, CODEX_HOME: profile };
  function checkout(name: string, origin = 'https://github.com/Example/Generated.git') {
    const root = join(directory, name);
    mkdirSync(root);
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync('git', ['-C', root, 'remote', 'add', 'origin', origin]);
    return root;
  }
  const root = checkout('first');
  function call(command: string, options: BootstrapOptions = {}, cwd = root) {
    return executeBootstrap(command, options, cwd, env);
  }
  function registerOwner(cwd = root, ownerId = owner) {
    const folder = join(cwd, '.local', 'spec-planning', 'owners');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${ownerId}.json`), JSON.stringify({ version: 1, root: cwd, repo: 'Example/Generated', ownerId }));
  }
  function ready(session = 'session-a', migration?: string) {
    call('reserve', { session });
    registerOwner();
    call('register', { session, owner, project: 'project-a', migration });
    call('native-reconcile', { state: 'absent' });
  }
  function activate(session = 'session-a', automation = 'automation-a') {
    call('begin-create', { session });
    call('native-reconcile', { state: 'active', automation });
    call('activate', { session, automation });
  }
  function cli(args: string[], cwd = root) {
    return spawnSync(process.execPath, [cliPath, ...args], { cwd, env, encoding: 'utf8' });
  }
  return { directory, profile, env, root, checkout, call, registerOwner, ready, activate, cli };
}
