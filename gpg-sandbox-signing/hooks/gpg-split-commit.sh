#!/bin/bash
# gpg-split-commit.sh — PreToolUse:Bash hook.
# Intercepts `git commit` commands and rewrites them to use safe-commit.sh,
# which commits unsigned inside the sandbox. The PostToolUse hook then
# amends with a GPG signature outside the sandbox.
#
# Does NOT intercept:
#   - git commit --amend (used by the GPG signing step itself)
#   - Commands already containing commit.gpgsign=false or --no-gpg-sign
#   - Non-commit git commands

if ! command -v jq &>/dev/null; then
  exit 0
fi

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SAFE_COMMIT="$PLUGIN_DIR/hooks/safe-commit.sh"

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

# Must be a git commit command
if ! echo "$MATCH_CMD" | grep -qE '(^|&&\s*|;\s*)git\s+commit([[:space:]]|$)'; then
  exit 0
fi

# Skip if it's an amend (our own Step 2, or user-initiated amend)
if echo "$MATCH_CMD" | grep -qE 'git\s+commit\s+.*--amend'; then
  exit 0
fi

# Skip if already bypassing GPG (avoid double-wrapping)
if echo "$CMD" | grep -qE 'commit\.gpgsign=false|--no-gpg-sign|safe-commit\.sh'; then
  exit 0
fi

# --- Rewrite ---

# Extract everything after `git commit` to pass as args to safe-commit.sh
# Handle both `git commit -m "msg"` and `rtk git commit -m "msg"`
REWRITTEN=$(echo "$CMD" | sed -E "s|(rtk )?git commit|$SAFE_COMMIT|")

# Build updated tool_input preserving all original fields
ORIGINAL_INPUT=$(echo "$INPUT" | jq -c '.tool_input')
UPDATED_INPUT=$(echo "$ORIGINAL_INPUT" | jq --arg cmd "$REWRITTEN" '.command = $cmd')

jq -n \
  --argjson updated "$UPDATED_INPUT" \
  '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "permissionDecisionReason": "GPG split-commit: unsigned commit inside sandbox",
      "updatedInput": $updated
    }
  }'
