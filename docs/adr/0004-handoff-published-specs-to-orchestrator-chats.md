---
status: accepted
---

# Hand off published specs to Orchestrator chats

Approved requirements: [issue 23](https://github.com/SpamArtist/web-llm-template/issues/23).

Verified, approved ticket publication hands off automatically to one Orchestrator chat per source spec. That chat starts implementation immediately. Planning remains responsible for the breakdown; the separate Orchestrator owns implementation and independent final review. This changes ADR 0001's prohibition on publication triggering implementation, while preserving publication approval and the separation of planning from execution.

The handoff identifies the exact implementation ticket set for the source spec, including tickets reused by its published breakdown. First and last issue numbers summarize that set; they do not authorize work on unrelated issues between those numbers. The supplied initial prompt retains its execution instructions, with the issue-number and integration-branch placeholders replaced and the exact ticket list included.

Each Orchestrator starts immediately with GPT-6 Luna and Extra High reasoning in a new worktree in the saved project matching the registered planning checkout. The source spec can select a base with `Integration base: <branch>`; otherwise the base is `main`. A missing base stops handoff rather than silently selecting another branch. The integration branch is `LLM/spec-<source-number>-integration`. Implementation chats use separate worktrees based on that integration branch. Ticket work merges into the integration branch, never main.

There is no fixed cap on concurrent implementation chats. The supplied prompt's instruction, "Do not create all chat sessions at once," remains in the initial Orchestrator prompt. Launch pacing, approval-pause coordination, and issue-status decisions belong to the Orchestrator; the planning workflow does not implement those execution policies. The supplied requirements for dependency handling, worker models, acceptance criteria, polling, and independent review remain prompt instructions.

Automatic handoff applies to future publications. Breakdowns published before this feature require an explicit launch request. Retries reuse the existing Orchestrator rather than launching another chat for the same handoff. A durable shared handoff claim reserves creation before native dispatch; an uncertain result is reconciled by its stable marker rather than repeated. A queued creation remains incomplete until its real chat identity is known. Missing native tools, project, base branch, or required transmission approval leave publication complete and handoff pending; they do not discard the published breakdown.

This boundary allows approved planning output to proceed directly into execution without making the planner itself an implementation worker. It also keeps orchestration policy in the requested initial prompt instead of expanding the planner into an execution scheduler.
