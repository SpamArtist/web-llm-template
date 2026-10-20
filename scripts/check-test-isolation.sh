#!/usr/bin/env bash
set -euo pipefail

# git grep scans tracked working-tree files, including newly staged tests.
# This intentionally catches only direct references; review checks provenance.
if git grep --line-number --full-name -I -E \
  -e 'prototype[/\\]' \
  -e '(npm|pnpm|bun)[[:space:]]+(run|run-script)[[:space:]]+prototype([^[:alnum:]_-]|$)' \
  -e '(yarn|pnpm|bun)[[:space:]]+prototype([^[:alnum:]_-]|$)' \
  -- ':(top)tests/'; then
  printf 'Tests must be independent of prototype paths and startup commands.\n' >&2
  exit 1
else
  status=$?
  # No matches (including an absent or empty tests/ tree) is success.
  if (( status != 1 )); then
    exit "$status"
  fi
fi
