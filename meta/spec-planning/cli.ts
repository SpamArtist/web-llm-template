import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { command } from './db/command.js';
import { createGitHub } from './db/github.js';
import { createLocalStore, loadConfig, registerOwner, assertOwner } from './db/local.js';
import { prepareCheckout } from './db/checkout.js';
import { eligibility } from './shared/eligibility.js';
import { validateDraft } from './shared/draft.js';
import { beginSession, acceptDraft, stopSession } from './use-cases/session.js';
import { publishDraft } from './use-cases/publish.js';
import { recoverSession, transferSession } from './use-cases/ownership.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    owner: { type: 'string' }, issue: { type: 'string' }, run: { type: 'string' },
    file: { type: 'string' }, expected: { type: 'string' }, manual: { type: 'boolean' },
    'new-owner': { type: 'boolean' }, 'confirm-stopped': { type: 'boolean' },
  },
});

const usage = 'Commands: setup [--new-owner | --owner UUID], scan --owner UUID, begin --owner UUID --issue N [--manual], accept --owner UUID --issue N --run UUID --file draft.json, publish --owner UUID --issue N --run UUID, stop --owner UUID --issue N --run UUID --file questions.txt, status --owner UUID --issue N, recover --owner UUID --issue N --expected SHA --confirm-stopped, transfer --owner NEW_UUID --issue N --expected SHA [--confirm-stopped]';
const action = positionals[0];
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

async function main(): Promise<void> {
  if (!action || action === 'help') { console.log(usage); return; }
  if (!['setup', 'scan', 'begin', 'accept', 'publish', 'stop', 'status', 'recover', 'transfer'].includes(action) || positionals.length !== 1) throw new Error(usage);
  const rootResult = await command('git', ['rev-parse', '--show-toplevel'], process.cwd());
  if (rootResult.failed) throw new Error(rootResult.stderr);
  const root = rootResult.stdout.trim();
  if (action === 'setup' && values.owner && values['new-owner']) throw new Error('Choose --owner or --new-owner, not both.');
  const github = createGitHub(root);
  const repo = await github.repository();
  if (action === 'setup') {
    // Validate explicit adoption before labels or owner state can change.
    const existingOwner = values.owner ? await loadConfig(root, values.owner, repo.slug) : null;
    if (!repo.canPush) throw new Error('Setup requires repository write access for shared ownership refs and issues.');
    for (const path of [
      '.agents/skills/spec-planning/SKILL.md', '.agents/skills/setup-spec-planning/SKILL.md',
      '.agents/skills/to-tickets/SKILL.md', 'meta/spec-planning/cli.ts', 'meta/spec-planning/use-cases/session.ts',
      '.codex/hooks.json', 'meta/spec-planning/bootstrap/cli.js', 'meta/spec-planning/hooks/session-start.js',
    ]) {
      const installed = await command('gh', ['api', '--hostname', 'github.com', '--silent', `repos/${repo.slug}/contents/${path}?ref=${repo.defaultSha}`], root);
      if (installed.failed) throw new Error(`Install the complete planning workflow on the remote default branch before setup. Missing or inaccessible: ${path}`);
    }
    for (const [label, description] of [
      ['spec', 'Source specification for ticket planning'],
      ['ready-for-agent', 'Ready for an agent to process'],
      ['auto-approve', 'Approve publication of the complete local ticket draft'],
      ['reference-only', 'Reference example; exclude this issue and its descendants'],
    ]) await github.ensureLabel(label, description);
    output({ config: existingOwner ?? await registerOwner(root, repo.slug, values['new-owner']), scheduleEnabled: false,
      next: 'Use the repository setup-spec-planning skill to configure the native Codex two-hour schedule.' });
    return;
  }
  const owner = values.owner;
  if (!owner) throw new Error('Supply --owner from setup. Each app instance needs its own registration.');
  assertOwner(owner);
  await loadConfig(root, owner, repo.slug);
  const store = await createLocalStore(root);
  if (action === 'scan') {
    const results = [];
    for (const issue of await github.candidates()) {
      const result = await eligibility(github, repo.slug, issue);
      const claim = await github.getClaim(issue.number);
      const skip = !result.eligible || (claim && claim.record.ownerId !== owner);
      results.push({ number: issue.number, title: issue.title,
        action: skip ? 'skip' : claim?.record.phase === 'complete' ? 'complete' : claim?.record.phase === 'busy' ? 'busy' : claim?.record.phase === 'stopped' ? 'stopped' : 'eligible',
        reason: !result.eligible ? result.reason : skip ? 'Another app instance owns this spec.' : claim?.record.reason, claim });
    }
    output(results);
    return;
  }
  const issue = Number(values.issue);
  if (!Number.isSafeInteger(issue) || issue < 1) throw new Error('Supply a positive --issue number.');
  if (action === 'status') { output({ claim: await github.getClaim(issue), state: await store.load(issue) }); return; }
  if (action === 'recover' || action === 'transfer') {
    if (!values.expected || !/^[a-f0-9]{40}$/.test(values.expected)) throw new Error('Supply --expected with the current claim SHA from status.');
    if (action === 'recover') {
      if (!values['confirm-stopped']) throw new Error('Recover only after the user confirms that the prior run has stopped; supply --confirm-stopped.');
      await recoverSession(github, issue, owner, values.expected);
    } else await transferSession(github, issue, owner, values.expected, values['confirm-stopped']);
    output({ action: 'stopped', next: 'Use begin --manual for this owner.' });
    return;
  }
  let state = await store.load(issue);
  try {
    if (action === 'begin') {
      const result = await beginSession(github, store, owner, issue, {
        manual: values.manual, codeCommit: repo.defaultSha, runId: randomUUID(), sessionId: randomUUID(), startedAt: new Date().toISOString(),
      });
      state = result.state ?? null;
      if (!state) { output(result); return; }
      const paths = store.paths(issue, state.snapshot.codeCommit);
      if (result.action === 'draft') {
        await prepareCheckout(repo, state.snapshot.codeCommit, paths.checkout);
        const children = await github.children(issue);
        const hierarchy = [];
        for (const child of children) hierarchy.push({ issue: child, children: await github.children(child.number) });
        await store.write(issue, 'context.json', { snapshot: state.snapshot, comments: await github.comments(issue), hierarchy, existingIssues: await github.allIssues() });
      }
      output({ ...result, paths });
      return;
    }
    if (!state || state.snapshot.ownerId !== owner || !values.run || state.snapshot.runId !== values.run) throw new Error('Command needs the saved run and owner returned by begin.');
    const claim = await github.getClaim(issue);
    if (!claim || claim.record.ownerId !== owner || claim.record.sessionId !== state.snapshot.sessionId || claim.record.runId !== values.run || claim.record.phase !== 'busy') throw new Error('This run no longer owns the active claim.');
    if (action === 'accept') {
      if (!values.file) throw new Error('Supply --file with the complete draft JSON.');
      const draft = validateDraft(JSON.parse(await readFile(values.file, 'utf8')), state.snapshot);
      await store.write(issue, 'draft.json', draft);
      state = await acceptDraft(github, store, state, draft);
      output({ action: state.status === 'waiting' ? 'waiting' : 'publish', state });
    } else if (action === 'publish') {
      state = await publishDraft(github, store, state);
      output({ action: 'complete', published: state.published });
    } else if (action === 'stop') {
      if (!values.file) throw new Error('Supply --file with the questions or failure details as plain text.');
      const reason = (await readFile(values.file, 'utf8')).trim();
      if (!reason) throw new Error('Stop details must not be empty.');
      state = await stopSession(github, store, state, reason);
      output({ action: 'stopped', reason: state.reason });
    }
  } catch (error) {
    if (state && (action === 'begin' || state.snapshot.runId === values.run) && state.snapshot.ownerId === owner) {
      try { await stopSession(github, store, state, error instanceof Error ? error.message : String(error)); }
      catch (stopError) { console.error('Could not record the stopped state. Keep local files and inspect the claim before manual recovery.', stopError); }
    }
    throw error;
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
