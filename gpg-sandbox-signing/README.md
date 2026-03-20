# gpg-sandbox-signing

Claude Code plugin that keeps pre-commit hooks sandboxed while GPG-signing commits.

## Problem

Claude Code's sandbox protects against supply-chain attacks by restricting what shell commands can access. However, GPG commit signing requires `gpg-agent`/`keyboxd` (GnuPG 2.4+), which cannot run inside the sandbox.

Today, Claude disables the **entire** sandbox for `git commit` — meaning pre-commit hooks (husky, lint-staged, eslint, prettier) also run unsandboxed. A compromised npm dependency executing during linting would have full filesystem and network access.

## Solution

Split `git commit` into two phases:

| Phase | Runs where | What happens |
|-------|-----------|--------------|
| 1. Commit (unsigned) | **Inside** sandbox | Pre-commit hooks execute safely. Commit created without GPG signature. |
| 2. GPG sign | **Outside** sandbox | PostToolUse hook amends the commit with a GPG signature. Only `git` + `gpg` run unsandboxed. |

## Installation

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/gpg-sandbox-signing/hooks/gpg-split-commit.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/gpg-sandbox-signing/hooks/gpg-sign-after-commit.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/` with the actual path to this plugin.

If you have existing hooks (e.g., RTK rewrite), add these entries alongside them — order matters for PreToolUse (RTK rewrite should come first so `rtk git commit` gets rewritten before this hook intercepts).

## How it works

1. **PreToolUse hook** (`gpg-split-commit.sh`): Intercepts `git commit` commands and rewrites them to `safe-commit.sh`. Skips `git commit --amend` (used by Step 2) and commands already bypassing GPG.

2. **Wrapper** (`safe-commit.sh`): Runs `git -c commit.gpgsign=false commit` inside the sandbox. Pre-commit hooks execute normally. On success, writes a marker file with the commit SHA.

3. **PostToolUse hook** (`gpg-sign-after-commit.sh`): Runs outside the sandbox. If the marker file exists and HEAD matches the expected SHA, amends the commit with `--gpg-sign`. Handles stale markers and GPG failures gracefully.

## Requirements

- GnuPG with a signing key configured in git (`git config user.signingkey`)
- `jq` (for PreToolUse JSON protocol)
- Claude Code with hook support

## Sandbox config

After installing this plugin, you can remove `~/.gnupg/S.gpg-agent` from your sandbox `allowUnixSockets` — GPG no longer needs to run inside the sandbox.
