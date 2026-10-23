#!/bin/sh
# The launcher needs only Git, a POSIX shell, and Node; npm install is unnecessary.
guidance() {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Local spec-planning setup is incomplete: Git, Node.js, or the repository root is unavailable. Continue unrelated work. Restore the prerequisite and start or resume Codex to retry; do not configure an external scheduler."}}'
}

if ! command -v git >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  guidance
  exit 0
fi

planning_root=$(git rev-parse --show-toplevel 2>/dev/null) || { guidance; exit 0; }
cd "$planning_root" || { guidance; exit 0; }
node "$planning_root/meta/spec-planning/hooks/session-start.js" || guidance
exit 0
