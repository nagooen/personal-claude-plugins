# verification-tools

Verify a change in a real browser, and report only what was actually observed.

## Why

A green unit suite proves the logic. It does not prove the code runs, the field arrives on
the wire, or the user sees the right screen. So "tests pass" gets reported as "verified",
and the gap between those two goes unnoticed until someone opens the app.

Closing that gap by hand is slow, and the slow part is never the browser — it is the three
or four environment traps that look exactly like a broken change:

> A login that never leaves the machine looks identical to a rejected password. A stale
> remote-tracking ref looks identical to a missing commit. A cached observable looks
> identical to a code path that never ran.

Each one sends you debugging the wrong thing. The skill turns them into ordered gates: pin
the SHA, run the specs, prove DNS resolves, *then* open a browser.

The second half is the harder discipline. Once the app is up it is very easy to explain a
screen by reasoning backwards from it — to see no warning banner and narrate a mechanism
that sounds right and is wrong. So the skill separates two things it will not let you
merge:

> Absence of a UI element proves the deciding predicate was false. It does not tell you
> which clause made it false. Read the function, cite the line, then explain.

And it prefers the network payload over the screenshot. A screenshot shows a state; the
response body proves which code path ran and what data it saw. One is evidence, the other
is an artefact.

## What it produces

A report split three ways — confirmed in the browser, confirmed by specs only, not
verified at all — with the payloads quoted verbatim and the unreachable cases named. Some
paths cannot be shown with the data at hand: a blocking rule cannot be demonstrated by an
account that passes it. Saying so is the point, not a shortfall.

## Setup

Playwright MCP is required — `claude mcp add playwright --scope user -- npx -y
@playwright/mcp@latest` — and its tools only load at session start, so install then restart.

Credentials live in `~/.claude/test-accounts.json`, outside every repo so it cannot be
committed. `chmod 600` it:

```json
{
  "<project>": {
    "<persona>": { "email": "you+dev@example.com", "password": "..." }
  }
}
```

## The agent never sees that file

Handing an agent a password puts it in the transcript, and Playwright then writes DOM
snapshots to `~/.playwright-mcp/` that capture typed passwords in plaintext. So the login
happens outside the conversation instead.

You run the seed script. It reads the credentials locally, logs in through the real form, and
exits. Chrome keeps the session in its own profile, so the agent opens that profile and is
already authenticated:

```bash
node scripts/seed-browser-session.mjs \
  --project web-frontend --persona worker \
  --url http://localhost:8200/login --clear-stale-lock
```

It finds the Playwright MCP profile itself, detects the login form by input type rather than
by project-specific test ids, and is idempotent — an existing session short-circuits unless
you pass `--force`. Its output names the profile, where it landed, and whether a session key
was written. It never prints the password or the token.

Two things worth knowing:

- **Chrome allows one process per profile.** The script and the agent's browser cannot both
  hold it, so the script must exit before the agent connects. If a previous Chrome died and
  left a lock behind, `--clear-stale-lock` removes it once it has confirmed the owning
  process is gone.
- **`--force` clears the session first.** Without that it could never log in again: a live
  session makes the app redirect straight off the login route, so the form never renders.

The skill still checks `~/.playwright-mcp/` for leaked passwords at the end, because an
earlier session — or a human logging in by hand in the same profile — can still leave one.

Needs `playwright-core`, which it finds in the Playwright MCP's own npx cache or any nearby
`node_modules`. If it cannot, it tells you the one command to run.

## Usage

```
browser-verify: confirm the checkout fix works
```
