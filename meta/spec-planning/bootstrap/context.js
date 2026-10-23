import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Normalize GitHub clone transports without making any network requests. */
export function githubRepository(origin) {
  let path;
  const scp = /^git@github\.com:([^?#]+)$/i.exec(origin);
  if (scp) path = scp[1];
  else {
    let url;
    try { url = new URL(origin); } catch { throw new Error('Origin must identify a github.com repository.'); }
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol)
      || url.search || url.hash || url.password || url.port
      || (url.protocol === 'https:' && url.username) || (url.protocol === 'ssh:' && url.username !== 'git')) {
      throw new Error('Unsupported GitHub origin; use HTTPS or git SSH without credentials.');
    }
    path = url.pathname.slice(1);
  }
  path = path.replace(/\/$/, '').replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(path) || /\/(?:\.|\.\.)$/.test(path)) {
    throw new Error('Origin must contain exactly one GitHub owner and repository.');
  }
  return path.toLowerCase();
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 750, maxBuffer: 65536 }).trim();
}

export function checkoutIdentity(cwd) {
  const checkout = realpathSync.native(git(cwd, 'rev-parse', '--show-toplevel'));
  return { checkout, repository: githubRepository(git(checkout, 'remote', 'get-url', 'origin')) };
}

export function validateRecord(record, repository) {
  const nullableString = value => value === null || (typeof value === 'string' && value.length > 0);
  if (!record || record.version !== 1 || record.repository !== repository
    || !isAbsolute(record.planningRoot ?? '')
    || !['reserved', 'ready', 'creating', 'active', 'disabled'].includes(record.phase)
    || !nullableString(record.ownerId) || (record.ownerId !== null && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(record.ownerId))
    || !nullableString(record.projectId) || !nullableString(record.automationId)
    || !Array.isArray(record.previousAutomationIds) || record.previousAutomationIds.some(id => typeof id !== 'string' || !id)
    || !nullableString(record.disabledReason)
    || (record.reservation !== null && (typeof record.reservation?.sessionId !== 'string' || !record.reservation.sessionId
      || typeof record.reservation?.reservedAt !== 'string' || !record.reservation.reservedAt))
    || !['pending', 'running', 'complete'].includes(record.initialCheck?.state)
    || !nullableString(record.initialCheck?.sessionId)
    || (record.migration !== null && (typeof record.migration?.automationId !== 'string' || !record.migration.automationId
      || typeof record.migration?.pauseConfirmed !== 'boolean'))
    || (record.nativeObservation !== null && (!['active', 'paused', 'deleted', 'absent', 'unknown'].includes(record.nativeObservation?.state)
      || !nullableString(record.nativeObservation?.automationId) || typeof record.nativeObservation?.observedAt !== 'string'))
    || (['ready', 'creating', 'active'].includes(record.phase) && (!record.ownerId || !record.projectId))
    || (record.phase === 'active' && !record.automationId)
    || (record.phase === 'creating' && !record.reservation)) {
    throw new Error('Invalid planning workflow registry. Preserve it and recover explicitly.');
  }
  return record;
}

export function assertRegistryDirectories(path) {
  for (const directory of [dirname(dirname(path)), dirname(path)]) {
    try {
      if (lstatSync(directory).isSymbolicLink()) throw new Error('Planning registry directories must not be symbolic links.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function assertRegisteredOwner(record) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(record.ownerId || '')) throw new Error('Invalid planning owner.');
  const base = join(record.planningRoot, '.local', 'spec-planning');
  for (const directory of [dirname(base), base, join(base, 'owners')]) {
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Planning owner directories must not be symbolic links.');
  }
  const path = join(base, 'owners', `${record.ownerId}.json`);
  if (lstatSync(path).isSymbolicLink()) throw new Error('Owner record must not be a symbolic link.');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.version !== 1 || config.repo?.toLowerCase() !== record.repository
    || config.root !== record.planningRoot || config.ownerId !== record.ownerId) {
    throw new Error('Planning owner is not registered in the canonical checkout. Preserve the existing owner and drafts.');
  }
}

export function readRecord(path, repository) {
  try {
    assertRegistryDirectories(path);
    if (lstatSync(path).isSymbolicLink()) throw new Error('Workflow registry must not be a symbolic link.');
    return validateRecord(JSON.parse(readFileSync(path, 'utf8')), repository);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Read-only hook API: never creates folders, registers owners, or calls a service. */
export function getBootstrapContext(cwd = process.cwd(), env = process.env) {
  const { checkout, repository } = checkoutIdentity(cwd);
  const profile = resolve(env.CODEX_HOME || join(homedir(), '.codex'));
  const key = createHash('sha256').update(`github.com/${repository}`).digest('hex');
  const registryPath = join(profile, 'spec-planning', key, 'workflow.json');
  const record = readRecord(registryPath, repository);
  let attention = null;
  if (record) {
    if (!existsSync(record.planningRoot)) attention = 'planning-root-missing';
    else {
      try {
        const original = checkoutIdentity(record.planningRoot);
        if (original.checkout !== record.planningRoot || original.repository !== repository) attention = 'planning-root-changed';
      } catch { attention = 'planning-root-changed'; }
    }
  }
  return { repository, checkout, registryPath, marker: `spec-planning:${key}`, record, attention };
}
