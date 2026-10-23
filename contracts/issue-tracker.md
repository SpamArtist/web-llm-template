# Tracker and approved requirements

## Project initialization

Choose one canonical tracker and identify the approved requirements before implementing work. For a generated repository hosted on GitHub, the default tracker is GitHub Issues. During initialization, replace the selections below with the project's choices:

- **Tracker:** GitHub Issues for this repository.
- **Approved spec location:** Each task's approved GitHub issue body. For template development, [issue 19](https://github.com/SpamArtist/web-llm-template/issues/19) records the approved local spec-planning work. Generated projects must select their own approved issues; this example does not authorize work in a generated project.

**Customization point:** Teams using another tracker must replace these selections with its name, location, and approved-spec convention. If requirements live outside the tracker, link each work item to that authoritative spec. Keep one authoritative requirements source for each task.

## GitHub workflow

Use the `gh` CLI for issue operations. Determine the repository from `git remote get-url origin`; never hard-code the template repository's slug. Run `gh` from that checkout, or pass `--repo` with the owner/repository derived from `origin` when explicit selection is needed.

Read the approved issue or spec before implementation. Record requirement amendments and implementation decisions at that source so its current requirements remain authoritative. Durable documentation should link to it rather than copy an evolving issue body into `docs/`.

When completing work, leave the commands, outcomes, and available CI link with the issue or canonical work item, following the [verification contract](verification.md).

## Spec ticket planning

Use the repository's [to-tickets skill](../.agents/skills/to-tickets/SKILL.md) when breaking a source spec into tickets. Do not rely on a globally installed copy. The planning labels are:

- `spec`: identifies a source specification.
- `ready-for-agent`: together with `spec`, makes a source spec eligible for ticket planning.
- `auto-approve`: on an eligible source spec, authorizes publication of the complete locally generated breakdown without interactive approval, as defined by the repository skill. It does not authorize implementation.
- `reference-only`: excludes the issue and all its descendants when a run starts, regardless of the other labels. Check ancestors as well as the source issue; descendants need not repeat this label.

Planning ends after publishing and verifying the grouping issues, implementation tickets, and their relationships. Implementation automation is outside this scope.

Public and private repositories run ticket planning inside local Codex on the user's machine. Use the local ChatGPT subscription session and this repository's skill and planning rules. See the [execution decision](../docs/adr/0002-run-all-ticket-planning-in-local-codex.md).

### Triggers and approval

- Both public and private repositories use a local Codex scheduled task every two hours. Manual starts are also supported.
- Each scheduled check uses `gh` to find eligible issues and check their current labels.
- Adding `auto-approve` signals approval to publish the complete locally generated breakdown. Do not introduce a separate comment command or draft-version approval protocol. The other eligibility rules still apply.
- Editing a source spec after publication must not automatically rewrite its published tickets.

At the start of each run, record the current eligibility and approval state. Use that initial state for the active run. Later label changes or source-issue closure do not stop or change that run. A new run checks the current state again. Approval to continue the active run does not authorize changing the source issue's labels or reopening it.

### Session ownership

Multiple machines can process the same repository. Each spec's planning session must have one owner: one machine and Codex app instance. Other machines or app instances must not process that spec at the same time. Different specs can have different owners.

Scheduled and manual runs must respect the same session owner. Store one shared ownership record per spec on GitHub. The first successful claim establishes the owner; other machines and app instances skip that spec. Keep ownership while the draft waits for approval.

Transfer ownership only after an explicit user request. Do not transfer ownership automatically because the owner is asleep, offline, or temporarily disconnected.

After a transfer, use the existing draft files when available. If those files are unavailable, rebuild unpublished work from the source spec and existing GitHub tickets. Preserve published tickets and human edits. Stop and ask if the same breakdown cannot be recovered reliably.

### Drafts, completion, and missing requirements

An eligible source spec without `auto-approve` gets a complete draft breakdown prepared once, then waits for that label before publication. Repeated checks of the unchanged spec must not repeatedly regenerate its waiting draft.

If the source requirements change while the draft waits, make a new complete draft from the current requirements before publication. When `auto-approve` is present, publish the new draft under that label approval. Do not publish a draft based on obsolete requirements.

After successful publication, ordinary manual invocations report that publication is complete and leave existing tickets unchanged. Revising a published breakdown requires an explicit revision request.

When contradictory or missing requirements prevent a reliable breakdown, stop and report the specific questions on the source issue. Do not invent requirements to finish the breakdown. This rule also applies when `auto-approve` is present.

The user supplies missing requirements by updating the source issue's body, then starting planning manually. Comments can explain decisions, but the issue body remains the authoritative requirements source.

### Recovery from partial publication

If a run publishes only part of a breakdown, check the existing issues and relationships before continuing. Finish the same breakdown without duplicate issues or relationships. Preserve issues already created. Stop and report if recovery would replace human edits.

### Repository version

Use a separate checkout of the latest remote default branch for planning. Record the commit used for the run. Do not include unfinished changes from the user's local working directory.

### Draft storage and cleanup

Keep draft files and recovery records in the main local checkout's ignored `.artifacts/spec-planning/` directory, outside temporary planning checkouts. Do not commit these files. Keep waiting drafts until publication or explicit removal.

After all tickets and grouping issues are published and their contents, parent relationships, and blocking dependencies are verified on GitHub, remove that breakdown's local draft files and recovery records. Do not remove files for other specs or incomplete runs. Record completion on the source issue before cleanup so later runs can recognize completed publication without local files.

### Result reports

Show complete drafts in local Codex. Add a short comment on the source issue when a draft is ready, publication completes, or work stops. The completion comment must identify the published issues. Do not repeat reports when nothing changes.

### Setup in generated repositories

Provide one setup procedure in the repository for users to run through local Codex. The procedure must check authentication and permissions, create missing labels, and configure the two-hour schedule. Each machine requires explicit setup. Keep the required skill and workflow instructions in this repository; do not depend on globally installed skills.

### Retry limits

Allow up to three retries after the initial failure for temporary network or service failures. Stop immediately for missing permissions, invalid authentication, or conflicting requirements. Keep recovery files and report the failure. When retries are exhausted, require a manual restart; scheduled checks must not start a fresh retry cycle for that stopped work.

### Reference examples

The template repository's [example spec issue 18](https://github.com/SpamArtist/web-llm-template/issues/18) and all its descendants are reference examples, not approved work. Keep that tree excluded. This exception identifies the linked example tree; it does not exclude an unrelated issue numbered 18 in a generated repository.

Use [the local planning runbook](../docs/spec-planning.md) for setup, commands, storage, and recovery. The shared claim implementation must be checked for concurrent claims before use. These instructions do not establish a running automation.
