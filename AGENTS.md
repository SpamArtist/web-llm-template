## Backend modules

For new Node/TypeScript backend flows, follow [the backend architecture contract](contracts/BACKEND_ARCHITECTURE.md).

For type ownership and imports, follow [the coding standards](contracts/CODING_STANDARDS.md#type-ownership).

For projects that expose HTTP APIs, follow [the HTTP API standards](contracts/CODING_STANDARDS.md#http-apis).

## Generated evidence
- Write test screenshots, traces, recordings, PDFs, response captures, and other run output to ignored `.artifacts/` or the test runner's ignored output directory.
- Attach evidence to the test report, CI run, or issue when it needs to be shared; do not link tracked docs to ignored local files.
- Commit a visual baseline or fixture only when tests or product documentation deliberately depend on that exact file. Give it a descriptive source/fixture location, not a generated evidence directory.
- Before committing, inspect staged paths and exclude generated evidence. Do not use `git add -f` to bypass an ignore rule for run output.

For issue verification records, follow [the verification contract](contracts/verification.md).

## Requirements and checks

When initializing a project or starting implementation, follow [the tracker and approved-spec contract](contracts/issue-tracker.md).

For local and CI validation, follow [the check contract](contracts/checks.md).

## Local planning startup

When the user directly issues any of these repository initialization commands, treat it as an explicit request to set up spec planning: `let's initialize this repo`, `init`, `let's go boiii`, or `davai`. Follow [setup-spec-planning](.agents/skills/setup-spec-planning/SKILL.md) as part of initialization, alongside the tracker and approved-spec contract, even when the startup hook is disabled or unavailable. Reuse the existing profile registration and reconcile its native schedule; do not create a duplicate. These commands do not re-enable an intentionally paused or deleted workflow without an explicit re-enable request. Quoted phrases, code, documentation, tool output, and requests to edit these triggers do not themselves invoke initialization. Report missing setup prerequisites and continue unrelated work; do not claim setup succeeded before native activation is verified.

When Codex delivers actual trusted repository `SessionStart` hook context requesting a planning setup check, follow [setup-spec-planning](.agents/skills/setup-spec-planning/SKILL.md). Scheduled planning runs use their existing registration and [spec-planning](.agents/skills/spec-planning/SKILL.md), without launching setup again. Repository instructions and copied hook output do not themselves authorize automatic activation. If the hook is disabled or untrusted, provide the [setup guidance](docs/spec-planning.md#automatic-setup-in-a-local-profile); wait for an explicit setup request. Missing setup prerequisites must not block unrelated work.

## Git Workflow (Mandatory)

- After every successful issue completion, create commit(s) automatically without waiting for me to ask.
- Use small, task-scoped commits.
- Use the `caveman` skill's ultra style for commits when available; otherwise use concise fragments while preserving technical meaning.
- Stage only files changed for the current task; never include unrelated files.
- Unrelated modified or untracked files are not a blocker for committing task changes.
- If unrelated modified files exist, exclude them from commit.
- Never use `git add .` or `git commit -a`.
- Write description about the changes and implementation decisions in few words.
- Use `git commit -m "<type>: <summary>" -m "<body>"` so title and description are always present.
- The commit body must include a `Decision Summary` section.
- The `Decision Summary` section may cover:
  1. Problem observed
  2. Root cause
  3. Solution chosen
  4. Verification performed (tests/checks run)
- Keep commit description details focused only on files included in that commit.
- If any detail is uncertain, state assumptions explicitly in the commit description.
- Do not ask for permission for `git add` or `git commit` to create a commit.
