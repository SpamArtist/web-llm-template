---
status: accepted
---

# Activate one planning workflow per repository per Codex app instance

For repositories created from this template, planning setup will activate the existing two-hour local schedule automatically once prerequisites pass, without a separate activation request. Missing authentication or unavailable Codex capabilities leave setup incomplete and must be reported; existing issue eligibility and publication approval rules remain in force.

Each local Codex app instance has one planning workflow per repository. Additional checkouts in the same app instance share that workflow; separate app instances can each have their own workflow, subject to the existing shared ownership rules for individual specs. This boundary avoids duplicate schedules from repeated clones without limiting setup to one app instance per machine.

For this workflow, an app instance means one local Codex profile on one machine. Windows and app restarts share its setup; separate profiles or machines have separate setups. Use the profile's persistent local state as the boundary, rather than an individual desktop process or chat.

Use one standalone native Codex scheduled task per repository in that profile. The schedule is managed at app level and is independent of an existing chat; do not create a dedicated planning chat or attach a heartbeat to the setup chat.

Configure ticket creation to use GPT-6 Astra with High reasoning (`gpt-6-astra`, `high`) initially. Preserve later explicit user changes to the scheduled task's model or reasoning effort. If the selected model or effort is unavailable, stop planning, report the missing access, and preserve drafts and registration. Substituting another model requires an explicit user choice.

Support macOS, Windows, and Linux where local Codex scheduling tools are available. If required tools are unavailable, leave setup incomplete and explain the missing capability.

When a single existing active planning heartbeat can be identified reliably, migrate it to the standalone schedule while preserving its owner, planning checkout, and drafts. Disable the old schedule before activating its replacement. Preserve intentionally paused or deleted status, and ask when multiple existing setups make the migration ambiguous.

Include a repository-local `SessionStart` command hook as the setup trigger. After the project configuration and exact hook definition pass Codex's trust review, the hook performs a small local setup-state check and supplies context for the agent to complete setup through native app tools. A plain clone does not activate planning. If the hook is untrusted or disabled, provide setup guidance rather than activating through a fallback route. Keep dependency installation and GitHub operations out of the hook itself.

After successful activation, check eligible issues immediately, then every two hours. Apply the existing eligibility, ownership, and publication approval rules to the first check as well as subsequent checks.

Incomplete setup does not block unrelated repository work. Report the missing prerequisite, preserve completed setup steps, and resume setup when the prerequisite is corrected.

Keep the first registered checkout as the planning checkout. Additional checkouts reuse its workflow. If the planning checkout disappears, report the problem before switching because unpublished drafts may need recovery.

An intentionally paused or deleted schedule stays disabled across later repository use. Enabling planning again requires an explicit request; automatic setup must not undo that choice.

These decisions replace the requirement for a separate explicit setup request in the earlier execution design and the chat-bound heartbeat in the current setup procedure. The complete design was confirmed on 2026-10-23. Implementation is pending; this record does not enable a schedule, and operational instructions still describe the current manual setup.

## Implementation constraints

The profile-level registration must coordinate simultaneous setup attempts across chats and checkouts. Record and reconcile the native automation identity so interrupted setup or an uncertain creation response cannot create duplicate schedules. A remembered active state is insufficient evidence that a schedule still exists or is enabled.

Preserve the existing planning-session ownership, stopped-run recovery, draft storage, latest-default-branch isolation, eligibility, and publication rules. Migrating a schedule does not authorize interrupting an active planning run, transferring ownership, replacing drafts, or implementing tickets. Standalone runs must resume from durable records rather than depend on the setup chat's history.

## Platform references

- [Codex hooks](https://learn.chatgpt.com/docs/hooks): repository hook discovery, trust review, session events, and additional agent context.
- [Scheduled tasks](https://developers.openai.com/codex/app/automations): standalone local runs and app-level schedule management.
- [Codex models](https://learn.chatgpt.com/docs/models): model selection and reasoning controls.
