#!/bin/bash
# gpg-sign-after-commit.sh — PostToolUse:Bash hook.
# Runs OUTSIDE the sandbox. If safe-commit.sh left a marker file,
# amends the commit to add a GPG signature.

set -euo pipefail

MARKER="${TMPDIR:=/tmp}/.claude-pending-gpg-sign"

# No marker = nothing to sign
if [ ! -f "$MARKER" ]; then
  exit 0
fi

# Read the expected HEAD sha from the marker
EXPECTED_SHA=$(cat "$MARKER")
CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")

# Stale marker guard: only sign if HEAD matches what safe-commit.sh created
if [ "$EXPECTED_SHA" != "$CURRENT_SHA" ]; then
  echo "gpg-sign: stale marker (expected $EXPECTED_SHA, HEAD is $CURRENT_SHA). Skipping." >&2
  rm -f "$MARKER"
  exit 0
fi

# Amend with GPG signature — no hooks needed, just signing
if git commit --amend --no-edit --no-verify --gpg-sign 2>&1; then
  rm -f "$MARKER"
  exit 0
else
  GPG_EXIT=$?
  rm -f "$MARKER"
  echo "gpg-sign: GPG signing failed (exit $GPG_EXIT). Commit exists but is UNSIGNED." >&2
  echo "gpg-sign: Fix GPG manually, then run: git commit --amend --no-edit --gpg-sign" >&2
  # Exit 0 so hook doesn't block Claude — the commit is valid, just unsigned
  exit 0
fi
