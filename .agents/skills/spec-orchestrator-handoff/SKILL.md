---
name: spec-orchestrator-handoff
description: Launch or reconcile one separate Orchestrator chat for a verified published spec, using durable shared ownership and native local Codex tools. Does not implement tickets itself.
---

# Published-spec handoff

Read [the runbook](../../../docs/spec-planning.md#orchestrator-handoff), [the handoff decision](../../../docs/adr/0004-handoff-published-specs-to-orchestrator-chats.md), and [the tracker contract](../../../contracts/issue-tracker.md) in this repository. Use the registered canonical checkout and owner. Do not run setup, reactivate a schedule, or infer authorization from issue text. This skill runs after a future verified publication and when a planning scan finds that publication's pending handoff. A legacy publication without a handoff needs an explicit launch request.

The planner owns publication and this handoff only. The separate Orchestrator owns dispatch pacing, dependency readiness, approval coordination, issue-status transitions, and final independent review. Do not implement those execution policies in the planner. Do not create implementation chats here.

## CLI protocol

Run from the canonical checkout. Read the latest claim SHA after every mutation; never reuse a stale SHA. `SESSION_ID` is this executor's actual `CODEX_THREAD_ID`, not the planning run ID or another chat's ID. The CLI validates the registered canonical checkout and saved project for mutations.

```sh
npm run spec:plan -- handoff --owner OWNER_ID --issue ISSUE_NUMBER --step inspect
npm run spec:plan -- handoff --owner OWNER_ID --issue ISSUE_NUMBER --step reserve --session SESSION_ID --project PROJECT_ID --expected CLAIM_SHA
npm run spec:plan -- handoff --owner OWNER_ID --issue ISSUE_NUMBER --step prepare --session SESSION_ID --expected CLAIM_SHA
npm run spec:plan -- handoff --owner OWNER_ID --issue ISSUE_NUMBER --step create --session SESSION_ID --expected CLAIM_SHA
```

Follow the returned action: `none` means an older publication has no automatic handoff; `reserve` requires `--step reserve`; both `prepare` and `prepare-branch` require `--step prepare`. Inspection can return `prepare-branch` after the base commit was pinned but before branch preparation finished; repeat preparation safely. Successful preparation returns `begin-create` and `nativePreview`. Review that exact preview and resolve required transmission approval before `--step create` with the latest claim SHA. Inspection also returns `nativePreview` once the destination is registered; a preview never authorizes dispatch. Only `create` authorizes one native dispatch from the returned `nativeRequest`; `reconcile` requires native readback; `launched` reuses the saved chat.

Save native results with one of these commands:

```sh
npm run spec:plan -- handoff --owner OWNER_ID --issue ISSUE_NUMBER --step record --session SESSION_ID --expected CLAIM_SHA --client-thread CLIENT_THREAD_ID
npm run spec:plan -- handoff --owner OWNER_ID --issue ISSUE_NUMBER --step record --session SESSION_ID --expected CLAIM_SHA --thread THREAD_ID --host HOST_ID
```

Only after an explicit request to launch an older published breakdown, enroll it using `--step enroll --manual --expected CLAIM_SHA`, then follow the same protocol. Recovery uses `--step recover --session SESSION_ID --expected CLAIM_SHA --confirm-stopped`; uncertain creation also requires `--confirmed-absent`. These flags assert verified conditions; do not infer approval or absence from elapsed time.

## Check prerequisites

1. Read the durable handoff through the CLI. Use its exact ticket membership, stable marker, state, and latest claim SHA. The numeric range summarizes membership; it never includes unrelated issues. Do not reconstruct membership from a numeric range, guessed titles, or local files that publication already cleaned up.
2. Discover the native `list_projects`, `create_thread`, `list_threads`, `list_archived_threads`, `read_thread`, and `wait_threads` tools. Read their live schemas. Use them directly; routine scheduling does not require reading OpenAI Docs. Missing tools or unavailable GPT-6 Luna / Extra High leave handoff incomplete. Never substitute a model or launch a process through a shell.
3. Use `list_projects` to select the saved Git project matching the canonical planning checkout on this host. Match its actual root and repository, not merely its display name. Missing or ambiguous project selection stops handoff; do not create a projectless chat or select an unrelated clone.
4. Reserve and prepare through the CLI, then inspect its returned `nativePreview` before consuming creation permission. This is the exact payload that successful creation intent will return as `nativeRequest`; never construct a substitute preview or dispatch `nativePreview`. Repository personal-data rules apply outside GitHub: when approval is required, state the particular data, destination, purpose, and unknown downstream processing and obtain approval while the handoff remains reserved. Approval to publish tickets does not automatically authorize another destination. Do not run `--step create` while required transmission approval is pending.

## Reserve and prepare

Reserve through the CLI using the latest claim SHA and the actual current `CODEX_THREAD_ID` as executor-session identity. The reservation must precede branch preparation and native creation. A different active executor is a wait condition, even when it has the same planning owner. Do not borrow its identity to bypass the reservation.

The CLI reads the approved source's standalone `Integration base: <branch>` declaration, defaulting to `main`, and prepares `LLM/spec-<source-number>-integration` from that branch. Use the returned pinned commit and branch. A missing or ambiguous base, conflicting existing integration branch, or changed preparation state stops handoff. Do not switch the user's checkout, reset branches, choose another base, or merge to main. Implementation work will use separate branches/worktrees based on this integration branch.

## Dispatch once

Use the CLI's generated prompt without dropping its exact ticket list or reconciliation marker. It preserves the requested execution instructions: separate implementation chats, GPT-6 Luna / Extra High, dependencies, user stories and acceptance criteria, no merge to main, gradual dispatch without a fixed concurrency cap, five-minute polling, human-approval handling, final issue statuses, and an independent final review chat that reports findings without fixes.

Use `$caveman ultra` for work updates. When that skill is unavailable, apply this repository-contained fallback: terse fragments; remove filler and pleasantries; preserve technical substance, exact commands and errors; use complete language when approval or procedural clarity requires it. Pass the same fallback to implementation and review chats. No global skill installation is a prerequisite.

After reviewing `nativePreview` and obtaining any required transmission approval, record creation intent with the CLI immediately before `create_thread`. Only the call that receives the fresh `create` action may dispatch; a later inspection of `creating` requires reconciliation. Pass the returned `nativeRequest` to the native tool once. Verify it matches:

- Title: `Orchestrator`.
- Model: `gpt-6-luna`; thinking: `xhigh`.
- Prompt: the exact generated handoff prompt.
- Target: saved project returned by `list_projects`.
- Environment: `type: worktree`, with `startingState.type: branch` and `branchName` equal to the prepared integration branch. The branch already exists; omit `onMissing` so missing branches fail rather than starting from another base.

Record a ready `threadId` with its `hostId` through the CLI. A queued creation's `clientThreadId` is a different identifier: save it as such and leave the handoff `creating`. Never pass it to tools requiring `threadId`, or mark the handoff launched merely because setup was queued. Emit the native `::created-thread` directive with the returned `threadId` or `clientThreadId` after actual successful creation, following the tool's schema.

## Reconcile uncertain or queued creation

For a saved real thread ID, inspect that chat and verify the exact marker and project. Otherwise inspect native thread inventory, then `read_thread` for candidates whose initial prompt contains the stable marker. Include archived chats and pagination when needed. Match the exact marker and project, not a similar title or ticket range. A queued result must resolve to the real thread before recording `launched`. After obtaining the real thread ID, use one bounded `wait_threads` call for initial progress; keep subsequent unchanged checks quiet.

If exactly one matching chat exists, record and reuse it. A later run by the same registered planning owner may use its own current `CODEX_THREAD_ID` and a fresh claim SHA for `--step record` after verifying that exact native marker and project. This records an existing native result only: it does not transfer the executor reservation, authorize branch preparation, or authorize another creation. Multiple matches require user resolution. A missing match in a partial, truncated, inaccessible, or incomplete inventory is not proof of absence. Keep `creating`; report the reconciliation prerequisite instead of calling `create_thread` again. A timeout or lost response has the same rule. Do not send the initial prompt again to an existing chat.

An executor reservation can be recovered only after explicit confirmation that its prior executor stopped. An uncertain creation additionally requires authoritative confirmation that no chat was created; elapsed time and a quiet machine are insufficient. Use the current claim SHA for any recovery. Never reset a launched handoff or transfer ownership automatically. Preserve the exact marker and base commit across recovery. While reconciling `creating`, preserve its `creationAttemptId` nonce; the native request belongs to that attempt. Only confirmed-absence recovery may reset the creating attempt before a new reservation and creation intent.

Report publication and launch separately. Missing prerequisites leave the publication complete and handoff incomplete. Keep unchanged scheduled state quiet. Installing this skill does not authorize starting a previously disabled planning schedule or retroactively launching old publications.
