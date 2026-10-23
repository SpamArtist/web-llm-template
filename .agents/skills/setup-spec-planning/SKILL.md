---
name: setup-spec-planning
description: Set up this repository's local Codex spec-to-ticket workflow on one machine and configure its two-hour Codex schedule when the user requests setup.
---

# Set up spec planning

Use this skill only for requested setup. Adding workflow files to the template does not enable a schedule.

Read [the runbook](../../../docs/spec-planning.md) and [the tracker contract](../../../contracts/issue-tracker.md). Use this checkout's `origin` as the repository. Both public and private repositories use the current local Codex app with its ChatGPT subscription. Do not configure GitHub Actions, model API credentials, or a separate model process.

1. Use a dedicated local Codex chat for this checkout and machine. The repo's planning files must be available on its remote default branch before regular operation. Install locked dependencies with `npm ci` if needed. Check the local Git and GitHub CLI installation and authentication. Do not print credentials.
2. Run `npm run spec:plan -- setup` from the main checkout. It checks access, creates missing labels, and returns the root, repository, and owner ID. Preserve that ID for this chat. Use `--new-owner` only when the user explicitly sets up another app instance or replaces the local owner; it does not transfer existing specs.
3. Check for an existing matching Codex automation before creating one. Use the native `automation_update` tool and its schema. Inspect existing automation configuration under the local Codex home as needed. Match this repository, root, owner ID, and chat. Update an existing match rather than create a duplicate.
4. Configure a thread heartbeat every two hours in this dedicated chat. Its prompt must identify the absolute checkout root and owner ID and instruct Codex to use that repo's `.agents/skills/spec-planning/SKILL.md`. Include these rules in plain text: scan eligible specs; respect shared ownership; use the repo CLI and current subscription session; never implement tickets; stay quiet if nothing changes; report completion, failure, or required user action. Do not put credentials in the prompt.
5. Verify the tool result and report the owner, repository, root, schedule, and manual command. Report that the schedule is active only if the tool confirms it. If native app automation tools are unavailable, report that setup is incomplete. Do not substitute cron, launch agents, or another scheduler.

Use the returned root and owner ID for manual runs through [spec-planning](../spec-planning/SKILL.md). Each additional machine requires its own explicit setup. Each spec keeps one shared owner until an explicit transfer. A machine that is offline must not lose ownership automatically.

Setup does not grant blanket permission to send personal data to external services. Apply the repository's transmission rules to each destination and purpose. Use `gh` for authorized GitHub operations. Do not use the GitHub plugin.
