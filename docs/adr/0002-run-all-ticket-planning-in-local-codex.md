# Run all ticket planning in local Codex

The [automatic setup decision](0003-automatic-local-planning-setup.md) supersedes this record's explicit per-machine setup procedure with a trusted hook and one standalone schedule per repository per local Codex profile. The execution and shared-ownership rules below remain in force.

Public and private repositories use local Codex on the user's machine for ticket planning. Use the local ChatGPT subscription session. GitHub Actions is not an execution path for ticket planning; the existing repository check workflows are outside this decision.

Use a local scheduled task every two hours, with a manual start option. Read issue data and publish approved tickets through `gh`. The repository supplies the skill and workflow instructions. Each user sets up local authentication and the local schedule for repositories made from this template.

Run planning in a separate checkout of the latest remote default branch, and record its commit. This gives each run a known repository version without including unfinished local changes.

Multiple machines can process a repository, but each spec's planning session has one owner: one machine and Codex app instance. Scheduled and manual runs must respect the same owner. Different specs can run on different machines.

Store one shared ownership record per spec on GitHub. The first successful claim establishes the owner, including while a draft waits for approval. Transfer ownership only after an explicit user request. A sleeping or disconnected machine can still hold valid drafts, so loss of connectivity does not authorize automatic takeover.

If a new owner cannot obtain the local draft files, rebuild unpublished work from the source spec and existing tickets. Preserve published tickets and human edits. Stop and ask when reliable recovery is not possible. Each machine uses the repository's setup procedure to check access, create missing labels, and configure the schedule.

The label rules, draft approval rules, and publication scope stay the same. This design does not require Codex credentials in GitHub secrets or a process to save refreshed credentials from an Actions runner. No scheduled task or ticket-planning runtime has been enabled by this decision.
