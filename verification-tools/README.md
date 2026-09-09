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

Credentials come from `~/.claude/test-accounts.json`, outside every repo so it cannot be
committed:

```json
{
  "web-frontend": {
    "worker": { "email": "you.worker+dev@example.com", "password": "..." }
  }
}
```

`chmod 600` it. Playwright MCP is required — `claude mcp add playwright --scope user -- npx
-y @playwright/mcp@latest` — and its tools only load at session start, so install then
restart.

Note that Playwright writes DOM snapshots to `~/.playwright-mcp/` which capture typed
passwords in plaintext. The skill's last step checks for that and tells you which files to
delete.

## Usage

```
browser-verify: confirm ES-63076 works
```
