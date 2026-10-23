import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertOwner, createLocalStore, loadConfig, registerOwner } from '../db/local.js';
import { initialState } from './publish-fixture.js';

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'spec-planning-local-'))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('local owner registration', () => {
  it('keeps the same owner on setup and creates a separate owner when requested', async () => {
    const first = await registerOwner(root, 'example/template');
    expect(await registerOwner(root, 'example/template')).toEqual(first);
    const second = await registerOwner(root, 'example/template', true);
    expect(second.ownerId).not.toBe(first.ownerId);
    expect(await registerOwner(root, 'example/template')).toEqual(second);
    expect(await loadConfig(root, first.ownerId, 'example/template')).toEqual(first);
    expect((await lstat(join(root, '.local/spec-planning/owners', `${first.ownerId}.json`))).mode & 0o777).toBe(0o600);
  });
  it.each(['../outside', 'not-an-owner', '', 'ABCDEF00-1234-1234-1234-123456789abc'])('rejects invalid owner %s', (owner) => {
    expect(() => assertOwner(owner)).toThrow('Invalid owner');
  });
  it('rejects a different repository or checkout root', async () => {
    const config = await registerOwner(root, 'example/template');
    await expect(loadConfig(root, config.ownerId, 'example/other')).rejects.toThrow('not registered');
    const configPath = join(root, '.local/spec-planning/owners', `${config.ownerId}.json`);
    await writeFile(configPath, JSON.stringify({ ...config, root: join(root, 'other') }));
    await expect(loadConfig(root, config.ownerId, 'example/template')).rejects.toThrow('not registered');
  });
  it('rejects an owner directory symlink without reading another directory', async () => {
    const config = await registerOwner(root, 'example/template');
    const owners = join(root, '.local/spec-planning/owners');
    await rm(owners, { recursive: true });
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), owners);
    await expect(loadConfig(root, config.ownerId, 'example/template')).rejects.toThrow('symbolic link');
  });
  it('rejects a symlinked config file and default owner pointer', async () => {
    const config = await registerOwner(root, 'example/template');
    const original = join(root, 'outside.json');
    await writeFile(original, JSON.stringify(config));
    const configPath = join(root, '.local/spec-planning/owners', `${config.ownerId}.json`);
    await rm(configPath);
    await symlink(original, configPath);
    await expect(loadConfig(root, config.ownerId, 'example/template')).rejects.toThrow('symbolic link');
    const pointer = join(root, '.local/spec-planning/default-owner.json');
    await rm(pointer);
    await symlink(original, pointer);
    await expect(registerOwner(root, 'example/template')).rejects.toThrow('symbolic link');
  });
});

describe('per-spec recovery storage', () => {
  it('saves and removes only the selected spec, including its draft files', async () => {
    const store = await createLocalStore(root);
    const first = initialState();
    const second = initialState();
    second.snapshot.source.number = 2;
    await store.save(1, first);
    await store.save(2, second);
    await store.write(1, 'draft.json', { draft: 'first' });
    await store.write(2, 'context.json', { context: 'second' });
    expect(await store.load(1)).toEqual(first);
    expect(await store.load(2)).toEqual(second);
    await store.remove(1);
    expect(await store.load(1)).toBeNull();
    expect(await store.load(2)).toEqual(second);
    expect(JSON.parse(await readFile(store.paths(2, 'a'.repeat(40)).context, 'utf8'))).toEqual({ context: 'second' });
    await expect(readFile(store.paths(1, 'a'.repeat(40)).draft)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects invalid issue keys and commit identifiers', async () => {
    const store = await createLocalStore(root);
    await expect(store.load(-1)).rejects.toThrow('positive integer');
    await expect(store.remove(1.5)).rejects.toThrow('positive integer');
    expect(() => store.paths(1, '../../outside')).toThrow('Invalid planning commit');
    await expect(store.save(2, initialState())).rejects.toThrow('another spec');
  });
  it('preserves malformed recovery records for manual recovery', async () => {
    const store = await createLocalStore(root);
    await store.save(1, initialState());
    const file = join(store.paths(1, 'a'.repeat(40)).directory, 'state.json');
    await writeFile(file, JSON.stringify({ snapshot: { version: 1, source: { number: 2 } } }));
    await expect(store.load(1)).rejects.toThrow('Invalid local recovery');
    expect(await readFile(file, 'utf8')).toContain('"number":2');
  });
  it('refuses storage parent symlinks', async () => {
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(root, '.artifacts'));
    await expect(createLocalStore(root)).rejects.toThrow('symbolic link');
  });
  it('refuses per-spec and state-file symlinks, while removal preserves their target', async () => {
    const store = await createLocalStore(root);
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'state.json'), JSON.stringify(initialState()));
    const paths = store.paths(1, 'a'.repeat(40));
    await symlink(outside, paths.directory);
    await expect(store.load(1)).rejects.toThrow('symbolic link');
    await expect(store.save(1, initialState())).rejects.toThrow('symbolic link');
    await store.remove(1);
    expect(await readFile(join(outside, 'state.json'), 'utf8')).toContain('publishing');
    await mkdir(paths.directory);
    await symlink(join(outside, 'state.json'), join(paths.directory, 'state.json'));
    await expect(store.load(1)).rejects.toThrow('symbolic link');
  });
});
