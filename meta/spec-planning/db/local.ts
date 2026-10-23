import { mkdir, readFile, realpath, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LocalConfig, SessionState } from '../shared/planning.types.js';
import type { LocalSessionStore } from './local.types.js';

export function assertOwner(owner: string): void {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(owner)) throw new Error('Invalid owner identifier. Run setup first.');
}

function issueKey(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Issue number must be a positive integer.');
  return String(number);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Storage file must not be a symbolic link: ${path}`);
    return JSON.parse(await readFile(path, 'utf8')) as T;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function directory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) throw new Error(`Storage directory must not be a symbolic link: ${path}`);
}

async function checkDirectory(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Storage directory must not be a symbolic link: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

async function storageRoot(root: string, name: '.local' | '.artifacts'): Promise<string> {
  const parent = join(root, name);
  await directory(parent);
  const path = join(parent, 'spec-planning');
  await directory(path);
  return path;
}

export async function registerOwner(root: string, repo: string, newOwner = false): Promise<LocalConfig> {
  root = await realpath(root);
  const base = await storageRoot(root, '.local');
  const pointer = join(base, 'default-owner.json');
  const previous = await readJson<LocalConfig>(pointer);
  if (previous && !newOwner) return loadConfig(root, previous.ownerId, repo);
  const config: LocalConfig = { version: 1, repo, root, ownerId: randomUUID() };
  await directory(join(base, 'owners'));
  await atomicJson(join(base, 'owners', `${config.ownerId}.json`), config);
  await atomicJson(pointer, config);
  return config;
}

export async function loadConfig(root: string, ownerId: string, repo: string): Promise<LocalConfig> {
  assertOwner(ownerId);
  root = await realpath(root);
  const base = await storageRoot(root, '.local');
  await checkDirectory(join(base, 'owners'));
  const config = await readJson<LocalConfig>(join(base, 'owners', `${ownerId}.json`));
  if (!config || config.version !== 1 || config.root !== root || config.repo !== repo || config.ownerId !== ownerId) {
    throw new Error('Owner is not registered for this checkout and origin. Run setup in this app instance.');
  }
  return config;
}

export async function createLocalStore(root: string): Promise<LocalSessionStore> {
  const base = await storageRoot(await realpath(root), '.artifacts');
  const path = (number: number) => join(base, issueKey(number));
  return {
    async load(number) {
      await checkDirectory(path(number));
      const state = await readJson<SessionState>(join(path(number), 'state.json'));
      if (state && (state.snapshot?.version !== 1 || state.snapshot.source?.number !== number)) throw new Error('Invalid local recovery record. Preserve it for manual recovery.');
      return state;
    },
    async save(number, state) {
      if (state.snapshot.source.number !== number) throw new Error('Recovery record belongs to another spec.');
      await directory(path(number));
      await atomicJson(join(path(number), 'state.json'), state);
    },
    async remove(number) {
      // Only a verified completed spec reaches this method. Never delete the shared base.
      await rm(path(number), { recursive: true, force: true });
    },
    paths(number, commit) {
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid planning commit.');
      const folder = path(number);
      return { directory: folder, draft: join(folder, 'draft.json'), context: join(folder, 'context.json'), checkout: join(folder, 'checkouts', commit) };
    },
    async write(number, filename, value) {
      if (!['context.json', 'draft.json'].includes(filename)) throw new Error('Invalid planning file name.');
      await directory(path(number));
      await atomicJson(join(path(number), filename), value);
    },
  };
}
