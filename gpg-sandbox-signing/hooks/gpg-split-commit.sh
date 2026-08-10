#!/bin/bash
# gpg-split-commit.sh — PreToolUse:Bash hook.
# Detects `git commit` commands and temporarily disables GPG signing
# so the commit can succeed inside Claude Code's sandbox (which blocks
# ~/.gnupg/ access). A PostToolUse hook then amends with GPG signature.
#
# Does NOT intercept:
#   - git commit --amend (used by the GPG signing step itself)
#   - Commands already containing commit.gpgsign=false or --no-gpg-sign
#   - Non-commit git commands

if ! command -v jq &>/dev/null; then
  exit 0
fi

set -euo pipefail

DEBUG_LOG="${TMPDIR:-/tmp}/.gpg-hook-debug.log"
MARKER="${TMPDIR:-/tmp}/.claude-pending-gpg-sign"

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$CMD" ]; then
  exit 0
fi

# --- Detection ---

# Strip rtk prefix if present (rtk git commit → git commit)
MATCH_CMD="$CMD"
case "$MATCH_CMD" in
  rtk\ git\ commit*) MATCH_CMD="${MATCH_CMD#rtk }" ;;
esac

# Must be a git commit command. Matches with or without an rtk prefix, and
# whether the commit leads the command or follows a separator — e.g.
# `export PATH=...; rtk git commit -m x`, which the rtk strip above misses
# because it only anchors at the start of the string.
if ! echo "$MATCH_CMD" | grep -qE '(^|&&[[:space:]]*|;[[:space:]]*)(rtk[[:space:]]+)?git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# Skip if it's an amend (our own PostToolUse step, or user-initiated amend)
if echo "$MATCH_CMD" | grep -qE 'git\s+commit\s+.*--amend'; then
  exit 0
fi

# Skip if already bypassing GPG (avoid double-wrapping)
if echo "$CMD" | grep -qE 'commit\.gpgsign=false|--no-gpg-sign'; then
  exit 0
fi

# --- Block commits on main/master ---
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "BLOCKED: You are on the $BRANCH branch. Switch to a feature branch first." >&2
  exit 1
fi

# --- Disable GPG signing temporarily ---
echo "[gpg-pre] Disabling GPG for sandbox commit at $(date)" >> "$DEBUG_LOG"

# Save current HEAD so PostToolUse can detect if a new commit was made
PRE_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "none")
echo "$PRE_HEAD" > "$MARKER"

# Disable GPG signing locally (hook runs outside sandbox, can write .git/config)
git config --local commit.gpgsign false

echo "[gpg-pre] GPG disabled, marker=$PRE_HEAD" >> "$DEBUG_LOG"

# Exit 0 with no stdout = allow command through unchanged
exit 0
