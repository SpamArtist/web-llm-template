---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in one file per ticket locally, or native blocking links on a real tracker.
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.

## Automatic approval for GitHub specs

When an existing GitHub source spec has all three labels `spec`, `ready-for-agent`, and `auto-approve` at the start of a run, treat the complete locally generated breakdown as approved for publication by this workflow. This is an exception only to this skill's human approval and quiz requirements; it does not waive drafting, requirement coverage, hierarchy, dependency, reconciliation, or verification requirements, or other repository eligibility rules.

Still draft every grouping-issue and implementation-ticket body, parent relationship, and blocking dependency locally before publishing. Skip the interactive quiz and approval wait in step 4, and proceed to step 5 with that complete draft. Read and record the source issue's labels and the repository's eligibility checks at the start of each run. Keep that initial eligibility and approval state for the active run; later label changes or source-issue closure do not withdraw this run's approval. A new run must check the current state again. Without this exception, follow the existing approval process unchanged. The label does not authorize implementation of the published tickets.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

Keep the full source requirements available for review. Give each user story, architecture decision, and test requirement a stable ID, and map every ID to at least one focused ticket. A source link or list of IDs does not replace the relevant requirement text in a ticket.

When the source spec is an existing GitHub issue and tickets will be published to GitHub, inspect its actual sub-issues and their children before drafting. Reuse existing grouping issues and reconcile existing implementation tickets; propose additions or changes instead of duplicating them. Apply the GitHub spec hierarchy below only in this case; other sources, trackers, and local-file workflows retain their existing behavior.

### 2. Explore the codebase

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

Review the current code interfaces and data paths for required prefactoring and risky boundaries. Use those findings to set ticket scope, order, and acceptance criteria.

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow path through one layer at a time along with tests (schema + tests, API + tests, UI + tests, logic + tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Before feature work, decide how to check it. If checks are missing, make tests, lint, and CI the first ticket. Block feature tickets on it, and add more checks as needed.

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

Draft the full body of every ticket locally in temporary folder before asking for approval. Include the relevant source requirements and enough implementation and test detail for the ticket to be reviewed on its own.

For a GitHub source spec, also draft the bodies of the three grouping issues described below. Include their purpose and source spec reference, and the review waiting rules in both review containers. Do not create or change any issues or relationships before approval.

Put user actions, specific acceptance cases, Red → Green → Refactor steps, and evidence requirements in each relevant ticket.

If a feature uses more than one part of the system, each related ticket must specify a check from the feature’s entry point. The check must confirm the result that the user sees. If the feature saves data, it must also confirm the saved data. For a user interface, the check must use the control. Tests of a helper, an API, or page text alone do not prove that the control works. The ticket must require the implementation agent to run the check and record the result before closure. If the project does not permit automatic interaction tests, the ticket must require a manual check and a record of its result.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work
- **What user stories it covers**: list all user stories this ticket will cover

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Show the full draft ticket bodies with the numbered breakdown. Ask the user to approve their content and blocking edges, not only the titles or ticket count. Iterate until the user approves the breakdown.

For the GitHub spec hierarchy, show the full grouping-issue bodies, implementation-ticket bodies, actual parent/sub-issue relationships, and blocking dependencies together. On reruns, distinguish reused issues from proposed additions and changes. Request one approval for the complete draft; that approval authorizes creating or updating the approved groups and then publishing the approved implementation tickets in the same run. Do not request a second confirmation merely because group creation has finished.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured — the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below — one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply the `ready-for-agent` triage label unless instructed otherwise — the tickets are agent-grabbable by construction.

#### GitHub spec hierarchy

For a spec in an existing GitHub issue, use this workflow in place of the general tracker publication instructions above. Keep blocking dependencies separate from parent/sub-issue relationships, using native blocking links when supported, otherwise explicit "Blocked by" references. Implementation tickets retain the existing `ready-for-agent` labeling rule.

After the complete draft is approved:

1. Create or reuse three grouping issues with these exact titles: **Implementation Tickets**, **Code Review**, and **Performance Review**. Establish each as an actual, direct GitHub sub-issue of the source spec issue. Finish establishing all three groups before publishing implementation tickets.
2. Publish the approved implementation tickets in dependency order. Each must be an actual, direct GitHub sub-issue of **Implementation Tickets**, not a direct sub-issue of the source spec. A body link, checklist entry, label, or title alone does not establish this relationship. In each implementation ticket's body, identify **Implementation Tickets** as its immediate parent and retain a separate reference to the source spec.
3. Establish implementation tickets' blocking dependencies separately from their sub-issue relationships. Verify the actual parent relationships and the published dependencies before reporting completion.

```text
Source spec issue
├── Implementation Tickets
│   ├── Implementation ticket 1
│   └── Implementation ticket 2
├── Code Review
└── Performance Review
```

All three grouping issues are containers. Do not apply `ready-for-agent` to them or close them automatically. **Code Review** and **Performance Review** are containers for future review tickets; this workflow does not populate them. An empty review container does not mean its review is complete.

Both review container bodies must state that future review tickets are actual sub-issues of the corresponding review container and must wait for all implementation tickets to finish. When future review tickets are created, add explicit blocking dependencies on all implementation tickets using native blocking links when supported, otherwise explicit "Blocked by" references. Code review and performance review can proceed independently once implementation is complete; neither review blocks the other.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue except for the approved grouping-issue updates and parent/sub-issue relationships required by the GitHub spec hierarchy. Preserve the source spec issue's title, body, labels, and open/closed status. Never close grouping issues automatically.

<local-ticket-template>

# <NN> — <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective — not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None — can start immediately".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective — not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None — can start immediately".

</issue-template>

In either form, avoid specific file paths — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.
