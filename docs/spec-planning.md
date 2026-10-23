# Local spec ticket planning

This workflow turns an approved GitHub spec into issue groups and implementation tickets. It runs inside local Codex for both public and private repositories. The current Codex session supplies the model through the user's ChatGPT subscription. The CLI manages files, ownership, and GitHub operations; it does not call a model API.

Use [the execution ADR](adr/0002-run-all-ticket-planning-in-local-codex.md) and [the tracker contract](../contracts/issue-tracker.md) for the agreed rules. Use [the repo to-tickets skill](../.agents/skills/to-tickets/SKILL.md) to design the breakdown. The required skills and scripts travel with this template. No global skill installation is required.

Adding these files does not enable a schedule. Implementation of the resulting tickets is outside this workflow.

## Set up each machine

1. Make sure the workflow files are on the repository's remote default branch. Setup checks this condition. A local branch with unmerged workflow files is not sufficient.
2. Install Git, Node.js with npm, and the GitHub CLI. Sign in to the local Codex app with the ChatGPT account whose subscription will run the work. Sign in to `gh` with access to the target repository. The workflow needs permission to create issues, comments, labels, sub-issue links, and shared ownership records. Setup checks repository write access.
3. In a dedicated local Codex chat for this checkout, invoke [setup-spec-planning](../.agents/skills/setup-spec-planning/SKILL.md). It runs `npm ci` if needed, then `npm run spec:plan -- setup`.
4. Keep the returned checkout root and owner ID in that chat's setup. The skill configures a native Codex heartbeat every two hours. It checks for an existing matching schedule first. The local machine and Codex app must be available for local work.
5. Check the setup result. If app automation tools are unavailable, the schedule is not configured. Manual operation remains available after CLI setup.

Use the same owner ID when you return to the same app instance and chat. For another Codex app instance, explicitly run setup with `--new-owner`. Register each additional machine separately. Do not copy an owner ID to another machine. A new owner does not automatically take over existing specs.

No API key, GitHub Actions model runner, or subscription credential upload is part of setup. The current repository's personal-data transmission rules still apply. Approval to publish tickets is not blanket approval to send personal data to another service.

## Labels and normal operation

| Label | Effect at run start |
| --- | --- |
| `spec` and `ready-for-agent` | Make an open source issue eligible for a draft. |
| `auto-approve` | Permit publication of the complete draft. |
| `reference-only` | Exclude an issue and all its descendants, even with trigger labels. |

The original template repository's example spec #18 and all its descendants are excluded. A different repository's issue #18 is not excluded by its number.

A scheduled check finds eligible issues every two hours. A new spec gets one shared owner. Other machines skip it. Different specs can have different owners. The CLI uses an atomic shared record on GitHub; a local file alone is not an ownership claim.

The run reads code from a separate checkout of the latest remote default branch and records its commit. It does not read unfinished main-checkout changes as implementation context. The source issue body is the authoritative requirements source. Comments can explain decisions.

Codex writes a complete draft under the main checkout's ignored `.artifacts/spec-planning/` directory. It shows the draft in the local chat. Without `auto-approve`, the draft waits. Add that label to approve publication. The next check can publish the saved draft. If requirements changed while it waited, the next run makes a new draft first.

The active run keeps its initial eligibility and approval state. Later label changes or source closure do not cancel that run. New runs check current state again.

Publication creates or reuses this actual GitHub hierarchy:

```text
Source spec
├── Implementation Tickets
│   └── Implementation tickets, with separate blocking links
├── Code Review
└── Performance Review
```

All three groups are containers. They receive no `ready-for-agent` label and are never closed automatically. Review containers remain empty. Their future review tickets must wait for every implementation ticket. Code review and performance review do not block each other.

The publisher verifies issue content, labels, direct parents, and blocking links. If GitHub does not support native dependency endpoints, it verifies explicit `Blocked by` links in the issue bodies. It records completion and the issue map on GitHub before removing the local draft and recovery files. Files for other specs remain.

## Manual commands

Run commands from the registered main checkout. Replace uppercase values with the values returned by setup and the CLI. Do not obtain them from an unrelated repository or session.

```sh
npm run spec:plan -- scan --owner OWNER_ID
npm run spec:plan -- begin --owner OWNER_ID --issue ISSUE_NUMBER --manual
```

`scan` returns an array of issue numbers, titles, actions, and reasons. It can report `eligible`, `skip`, `stopped`, `busy`, or `complete`. `begin` acquires or checks ownership and returns the action, state, and paths for that run.

| `begin` action | Codex action |
| --- | --- |
| `draft` | Read the context, inspect the returned checkout, and write the draft. |
| `publish` | Publish the saved draft using the returned run ID. |
| `waiting` | Keep the draft and wait for the approval label. |
| `skip` | Leave the spec unchanged; follow the reported reason. |
| `complete` | Report existing completion for a manual request. Do not revise tickets. |

Scheduled checks omit `--manual`. This prevents them from restarting stopped work. Do not repeatedly announce unchanged waiting, skipped, or complete results.

For a draft, use `state.snapshot` and the returned `paths.context`, `paths.checkout`, `paths.directory`, and `paths.draft`. The context contains the source issue, comments, and existing issues. Keep generated files in that session directory. Save and validate the draft, then publish only if the result requests it:

```sh
npm run spec:plan -- accept --owner OWNER_ID --issue ISSUE_NUMBER --run RUN_ID --file DRAFT_PATH
npm run spec:plan -- publish --owner OWNER_ID --issue ISSUE_NUMBER --run RUN_ID
```

The CLI is the publication entry point. Do not replace it with direct `gh issue create` commands: that would bypass ownership and recovery checks. GitHub access inside the CLI uses `gh`, not a GitHub plugin.

## Draft format

Write UTF-8 JSON to the returned draft path. [The owned types](../src/shared/spec-planning/planning.types.ts) define `Draft`. [The validator](../src/shared/spec-planning/draft.ts) checks its shape, coverage, and dependency graph. Read both when preparing a draft. Structural validation cannot prove that the model found every source requirement; Codex must check coverage against the complete spec.

Use these fields:

- `version`: `1`.
- `sourceNumber`: copy `state.snapshot.source.number`. Copy `sourceHash` and `codeCommit` from `state.snapshot.sourceHash` and `state.snapshot.codeCommit`. Do not calculate replacements.
- `requirements`: stable `id`, `kind` (`story`, `decision`, or `test`), and full `text` for each source requirement.
- `groups`: exactly three entries with `key`, `title`, and complete `body`. Use `implementation` / `Implementation Tickets`, `code-review` / `Code Review`, and `performance-review` / `Performance Review`.
- `tickets`: stable `key`, short `title`, complete `body`, covered `requirementIds`, and `blockedBy` ticket keys. Use `existingIssue` only for an existing implementation issue that this draft explicitly reuses.

Use simple identifier strings with letters, numbers, dots, underscores, or hyphens. All referenced requirements and blockers must exist. Cover every requirement. Each ticket body must include its covered requirements in full, acceptance cases, verification, Red → Green → Refactor steps, and evidence requirements. Follow the to-tickets rules for checks from the feature's entry point and checks of saved data. A requirement ID alone is insufficient.

Each review group body must state that future tickets are actual sub-issues and must wait for all implementation tickets to finish. The publisher adds source and immediate-parent links, dependency links, and recovery markers. Do not invent GitHub issue numbers for tickets that do not exist yet.

For existing issues, preserve published text and human edits. The publisher can adopt an explicitly approved existing body that matches the draft. It stops when a change cannot be proven safe. Do not remove markers or change source requirements to bypass a conflict.

## Missing requirements and failures

For missing decisions, write the exact questions to a plain-text file in the session directory, then stop the run:

```sh
npm run spec:plan -- stop --owner OWNER_ID --issue ISSUE_NUMBER --run RUN_ID --file REASON_PATH
```

The source issue receives a short report. The user updates its body and starts planning manually. `auto-approve` does not supply missing requirements.

Temporary read or safe operation failures can receive up to three retries after the first attempt. Missing permissions, invalid authentication, and conflicting requirements stop immediately. An uncertain issue or comment creation stops for manual reconciliation; it is not blindly repeated. A missing readback is not proof that creation failed. The next manual run uses stable markers to find existing issues and comments. After retries are exhausted, the work stops and keeps its recovery files. Scheduled checks do not begin a new retry cycle.

A partial publication resumes the same breakdown without duplicates. Existing human edits cause a stop. After verified publication, ordinary manual starts report completion; revision requires a separate explicit request.

## Recover or transfer ownership

Inspect current state first:

```sh
npm run spec:plan -- status --owner OWNER_ID --issue ISSUE_NUMBER
```

The result includes the shared claim and its SHA. Use that exact SHA for recovery or transfer. A stale SHA must fail instead of replacing a newer owner or run.

If a run is busy, do not clear it because the machine is asleep or offline. The user must explicitly confirm that the old process has stopped. Only its registered owner can recover the abandoned run:

```sh
npm run spec:plan -- recover --owner OWNER_ID --issue ISSUE_NUMBER --expected CLAIM_SHA --confirm-stopped
```

After recovery, start work manually. Do not add `--confirm-stopped` without the user's confirmation.

For an explicit transfer, set up the receiving machine first. Inspect its current claim and use the new owner's registered ID:

```sh
npm run spec:plan -- transfer --owner NEW_OWNER_ID --issue ISSUE_NUMBER --expected CLAIM_SHA
```

Transfer refuses a busy session unless the user explicitly confirms that the old process has stopped. After that confirmation, add `--confirm-stopped` to the transfer command. This permits recovery when the old machine or its owner registration is lost. Being offline alone is not confirmation that a run has stopped.

Reuse existing local draft files when available. If they are unavailable, rebuild unpublished work from the source and existing issues only when the same breakdown can be recovered reliably. Preserve published issues and human edits. Otherwise stop and report what is missing.
