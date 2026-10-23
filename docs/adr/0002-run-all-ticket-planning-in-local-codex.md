# Run all ticket planning in local Codex

Public and private repositories use local Codex on the user's machine for ticket planning. Use the local ChatGPT subscription session. GitHub Actions is not an execution path for ticket planning; the existing repository check workflows are outside this decision.

Use a local scheduled task every two hours, with a manual start option. Read issue data and publish approved tickets through `gh`. The repository supplies the skill and workflow instructions. Each user sets up local authentication and the local schedule for repositories made from this template.

The label rules, draft approval rules, and publication scope stay the same. This design does not require Codex credentials in GitHub secrets or a process to save refreshed credentials from an Actions runner. No scheduled task or ticket-planning runtime has been enabled by this decision.
