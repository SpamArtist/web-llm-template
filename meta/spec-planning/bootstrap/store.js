import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertRegistryDirectories, readRecord, validateRecord } from './context.js';

/** A short filesystem lock serializes local updates; the durable reservation spans tool calls. */
export function updateRegistry(context, update, sessionId = null) {
  const directory = dirname(context.registryPath);
  assertRegistryDirectories(context.registryPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertRegistryDirectories(context.registryPath);
  const lock = join(directory, 'update.lock');
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Registry update is locked at ${lock}. Retry after the writer finishes; recover-lock requires a verified dead writer.`, { cause: error });
    throw error;
  }
  const temporary = `${context.registryPath}.${randomUUID()}.tmp`;
  try {
    if (existsSync(join(directory, 'recovery.lock'))) throw new Error('Registry lock recovery is in progress. Retry when it finishes.');
    writeFileSync(join(lock, 'writer.json'), JSON.stringify({ pid: process.pid, sessionId }), { flag: 'wx', mode: 0o600 });
    const record = update(readRecord(context.registryPath, context.repository));
    validateRecord(record, context.repository);
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const fd = openSync(temporary, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, context.registryPath);
    return record;
  } finally {
    rmSync(temporary, { force: true });
    rmSync(lock, { recursive: true });
  }
}

/** Explicit recovery only; a live or uncertain writer is never interrupted. */
export function recoverUpdateLock(context, options) {
  if (!options.stopped) throw new Error('Lock recovery requires verified stopped setup (--stopped).');
  assertRegistryDirectories(context.registryPath);
  const directory = dirname(context.registryPath);
  const lock = join(directory, 'update.lock');
  const recovery = join(directory, 'recovery.lock');
  // Serialize recovery itself so a second recovery cannot remove a replacement writer's lock.
  try { mkdirSync(recovery, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another lock recovery is pending. Never steal its recovery.lock.', { cause: error });
    throw error;
  }
  try {
    let writer;
    try { writer = JSON.parse(readFileSync(join(lock, 'writer.json'), 'utf8')); }
    catch (error) {
      throw new Error('Writer metadata is unavailable. Preserve the lock and verify stopped processes before manual recovery.', { cause: error });
    }
    if (!Number.isInteger(writer.pid) || writer.pid <= 0 || writer.sessionId !== (options.previousSession || null)) {
      throw new Error('Lock writer identity does not match; preserve the lock for manual recovery.');
    }
    try { process.kill(writer.pid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      rmSync(lock, { recursive: true });
      return { recovered: true, ...context };
    }
    throw new Error('The registry writer is still alive. Never steal its lock.');
  } finally {
    rmSync(recovery, { recursive: true });
  }
}
