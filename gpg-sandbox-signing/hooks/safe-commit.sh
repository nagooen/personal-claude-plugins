#!/bin/bash
# safe-commit.sh — Runs INSIDE the sandbox.
# Commits without GPG signing so pre-commit hooks execute sandboxed.
# On success, leaves a marker file for the PostToolUse hook to GPG-sign.

set -euo pipefail

MARKER="${TMPDIR:=/tmp}/.claude-pending-gpg-sign"

# Remove any stale marker before attempting
rm -f "$MARKER"

# Commit unsigned — pre-commit hooks (husky/lint-staged) run here, sandboxed
git -c commit.gpgsign=false commit "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  # Record HEAD sha so the PostToolUse hook can verify it's signing the right commit
  git rev-parse HEAD > "$MARKER"
fi

exit $EXIT_CODE
