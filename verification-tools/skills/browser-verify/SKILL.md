---
name: browser-verify
description: Verify a change in a real browser. Discovers the project's dev-server and environment config, runs the change's own tests as the contract, drives a browser session seeded outside the conversation so no password is ever read, then proves the code path ran using Playwright network payloads and screenshots. Reports partial verification honestly rather than passing a green suite off as browser-verified.
---

# Browser Verify Skill

You are verifying that a change actually works in a running browser. Your job is to produce **evidence**, not reassurance: the payload the new code received, the screen the user would see, and an honest statement of which paths you could not reach.

## Purpose

A passing test suite proves the logic. It does not prove the code runs, the field arrives on the wire, or the user sees the right screen. This skill closes that gap and, just as importantly, stops you claiming more than you observed.

Use it when asked to verify a change, confirm a fix works, take screenshots of a change, or check a PR in a browser.

Nothing here is project-specific. Every value you need — port, config, test command, routes — is discovered in Step 1 and reused for the rest of the run.

## Prerequisites

Stop and report if any is missing. Do not improvise around them.

**1. Playwright MCP tools.**

```bash
claude mcp get playwright
```

If absent, install it — but the tools only load at session start, so **you cannot use them in the same session**:

```bash
claude mcp add playwright --scope user -- npx -y @playwright/mcp@latest
```

Tell the user to restart, then stop. Installing and then pretending to verify is worse than not starting.

**2. A seeded browser session.** You do not log in, and you never read the credentials file.

The human runs `scripts/seed-browser-session.mjs`, which reads `~/.claude/test-accounts.json`
locally, logs in through the real form, and exits. Chrome keeps the session in its profile, so
you inherit an authenticated browser:

```bash
node scripts/seed-browser-session.mjs \
  --project <project> --persona <persona> --url <login-url> --clear-stale-lock
```

It prints the profile it chose, where it landed, and whether the session key was set — never a
password and never a token.

**You must not read `~/.claude/test-accounts.json`, and must not ask for a password.** Reading it
puts the password in the transcript and in any DOM snapshot taken afterwards, which is the exact
leak Step 11 exists to clean up. If no session is seeded, print the command above and stop.

Chrome allows one process per profile, so the script and your browser cannot both hold it. If the
script reports the profile is busy, close the browser (`browser_close`) and let the human re-run.

**3. A checkout** with dependencies installed.

## Workflow Steps

### Step 1: Build a project profile

Discover these before anything else. Do not guess any of them, and do not carry assumptions in from another project.

| What | Where to look |
|---|---|
| Dev-server command | `package.json` scripts — the `start`/`serve`/`dev` family |
| Dev-server port | The framework's serve config, or the script's own flags |
| Environment configs | An `environments/`, `config/` or `.env*` set — one per target |
| API host per config | The base-URL constant each config exports |
| Test command | `package.json` scripts, plus the runner's config for path filters |
| Route table | The router config for the area the change touches |
| Login route | The router config — the human needs it for the seed script, you never post to it |
| An authenticated route | Somewhere only a signed-in user reaches, to confirm the session |

Report the profile in one short block before proceeding. Everything downstream cites it.

### Step 2: Pin exactly what is under test

Never assume the working tree holds the change. Establish it:

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git fetch origin --prune
```

For a PR, get the head and confirm it is reachable locally:

```bash
gh pr view <N> --json state,headRefOid,mergeCommit,baseRefName
git merge-base --is-ancestor <sha> HEAD && echo "IN TREE" || echo "NOT IN TREE"
```

**Three traps, all seen in practice:**

- A merged PR has its branch **deleted on the remote**. Fetching that branch then fails with `couldn't find remote ref`. The change is on the base branch instead — check the merge commit.
- A local remote-tracking ref can be **stale**, pointing at an older head than the PR. Always `--prune` and compare SHAs, never branch names.
- `git fetch origin <branch>` updates only `FETCH_HEAD`, **not** `refs/remotes/origin/<branch>`. Use a bare `git fetch origin` to move tracking refs.

Report the SHA you are verifying. Everything downstream is a claim about that commit.

### Step 3: Read the change's tests as the contract, and run them

The test files in the diff are the written expectation. Read them before touching a browser — they tell you which behaviour matters and, critically, which cases exist.

```bash
git show --stat <sha> | grep -Ei "spec|test"
```

Run the affected suites with the command from the profile, scoped to the changed area. This is cheap, deterministic, and covers paths the browser cannot reach.

Record the exact counts. A red suite ends the verification — report it and stop.

### Step 4: Prove the chosen config can reach a backend

**This is the step that most often wastes time.** Configs are not equally reachable from a development machine: some point at hosts that need a VPN, some at hosts that no longer exist, some at a local backend that is not running.

For the config you intend to serve, resolve its API host before starting anything:

```bash
dig +short <api-host>
curl -s -m 10 -o /dev/null -w "%{http_code}\n" https://<api-host>/
```

An unresolvable host looks **exactly** like a rejected password: the request never leaves the machine. Symptom to recognise in the browser console:

```
Failed to load resource: net::ERR_NAME_NOT_RESOLVED @ https://<api-host>/...
```

`curl` exit 6 and an empty `dig` are conclusive. **Diagnose the host before ever suspecting the credentials.** If the default config is unreachable, try the others from the profile and serve the one that resolves — then say in your report which config you used, because it changes what the run proves.

### Step 5: Serve where the user can watch it

If the session runs inside a terminal multiplexer the user is watching, start the server in a visible pane rather than a hidden background task, so they can see the build. Otherwise run it as a background command.

Either way, wait for the framework's own ready signal — a listening line, a compiled line, or both — before proceeding. Free the port first if something already holds it:

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN -t
```

Poll in a loop; never a bare foreground `sleep`. A cold build can take from seconds to several minutes.

### Step 6: Confirm the inherited session

The session is already seeded (Prerequisite 2). Your job is to confirm it, not to create it.

```
browser_resize    { width: 1440, height: 900 }
browser_navigate  { url: "http://localhost:<port>/<an-authenticated-route>" }
browser_wait_for  { time: 5 }
```

Success is landing on the authenticated route rather than being bounced to login. Confirm it
from something only a signed-in user gets — an authenticated API call returning 200, or
navigation that only a signed-in role can see. Do not confirm it from the account's profile
payload: those carry personal data you have no reason to pull into context.

Then check the persona is the right one. A provider-facing rule needs the provider account, not
the customer one. Read the role off the navigation or an authorised response, not off a
profile record.

If you land on the login route instead, **do not try to log in.** Either the seeded session
expired or the API host is unreachable. Re-check Step 4, then ask the human to re-run the seed
script with `--force`.

### Step 7: Reach the changed surface

Find the route from the profile rather than clicking around. Deep-linking straight to the case is faster and more reproducible than navigating.

An empty list is not a verification. If a list view has no rows, the code path under test never ran — deep-link to a specific record instead. Where the ticket or commit message names a concrete case (a record id, an account, a fixture), **use that exact one**: it was chosen because it reproduces.

Use `browser_find { regex: ... }` to locate an element cheaply. A full `browser_snapshot` of a real application page can be thousands of lines — use it only when `find` is not enough.

### Step 8: Capture evidence, payload first

**The network payload is the strong evidence. The screenshot is the artefact.** A screenshot shows a state; the payload proves which code path ran and what data it saw.

```
browser_network_requests  { static: false, filter: "<endpoint-fragment>" }
browser_network_request   { index: <n>, part: "response-body" }
browser_network_request   { index: <n>, part: "request-body" }
```

Request bodies identify an operation by name and variables, which is how you prove a specific new call fired rather than inferring it from the UI.

**Two counting traps, both verified in practice:**

- Indices are numbered **per page load**. List and fetch within the same load; after any navigation, re-list before fetching, or you will quote the wrong request.
- A cached read can stop a request from re-firing. A memoised or replayed observable that lives as long as the application's dependency container will serve the second caller from cache. A full page load tears that container down, so the call fires again; an **in-app** route change reuses the cache and issues nothing. Absence of a repeat request is therefore not evidence the code path was skipped — force a full reload when you need to observe the call.

Then the screenshots:

```
browser_take_screenshot { scale: "css", filename: "01-<what>.png", fullPage: true }
```

Number them in flow order. **A relative `filename` lands in the home directory, not the Playwright output directory** — state the real path in your report. Read back at least the decisive screenshot to confirm it shows what you claim.

Quote payloads verbatim in the report. Paraphrased JSON is not evidence.

### Step 9: Explain the observed state only from the rule's source

This is the discipline that matters most, and the easiest to skip.

When the UI shows (or omits) something, **read the predicate that decides it** before explaining why. Do not reason backwards from what you see.

A worked failure: a screen showed no warning where one was expected to be possible, and the conclusion drawn was that a newly added lookup had suppressed it. The deciding function was actually a single any-match over a list — one qualifying entry was enough to pass, and the account had two. The new lookup was irrelevant to that outcome. The verdict ("the change works") survived; the stated mechanism was wrong, and nothing in the screenshot could have revealed that.

Rules:

- Absence of a UI element proves the predicate was false. It does **not** identify which clause made it false.
- Read the function, name the file and line, then explain.
- If you cannot point at the deciding line, label the explanation **unverified**.

### Step 10: Report, and name the gap

Separate what you observed from what you inferred, and state plainly which paths the browser could not reach.

```markdown
## Verified in the browser
- <endpoint> returned: <verbatim payload>
- <UI outcome>, decided by <file>:<line>
- Config served: <which one>, because <reachability>
- Screenshots: <paths>

## Verified by tests only
- <path the browser could not reach> — <suite>, <N> tests

## Not verified
- <case> — needs <setup>
```

Some paths are structurally unreachable with the data at hand: a blocking rule cannot be shown by an account that passes it. **Say so.** Never let a green suite be reported as browser-verified, and never imply full coverage from a partial run.

### Step 11: Check for credential leakage

Seeding the session outside the conversation removes the main cause of this leak: you never type
the password, so no DOM snapshot of yours can capture it. Check anyway — an earlier session, or
a human logging in by hand in the same profile, still leaves snapshots behind.

Never paste the password into the check. Read it into a shell variable and grep with that, so it
reaches neither the command nor the output:

```bash
PW=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.claude/test-accounts.json')))['<project>']['<persona>']['password'])")
grep -rl -- "$PW" ~/.playwright-mcp/ 2>/dev/null
unset PW
```

Report the matching files and offer to delete them. Do not delete without asking — the user may
want the snapshots — but never leave the leak unmentioned.

Leave the dev server running unless asked to stop it, and say where it is.

## Hard Rules

**Never:**
- Take an outward action without explicit approval — submitting an application or form, sending a message, paying. These create real records in a shared environment. Getting to the button is verification; pressing it is not yours to decide.
- Mutate shared environment data to make a case reachable unless the user asks.
- Read `~/.claude/test-accounts.json`, or ask for a password. The session is seeded outside the
  conversation precisely so the credential never enters it.
- Log in through the form yourself. If the session is missing, say so and stop.
- Echo a password or a session token into the conversation, a commit, or a report.
- Claim browser verification on the strength of a passing suite.
- Report a state's cause without citing the deciding line.
- Reuse a port, config or route remembered from another project. Rebuild the profile every run.

**Always:**
- Name the SHA under test.
- Run the tests before the browser.
- Resolve the API host before blaming credentials.
- Say which config you served.
- Quote payloads verbatim.
- State what you could not reach.

## Examples

### Example 1: Successful partial verification

*Verify that an eligibility rule now matches against an allow-list rather than a deny-list.*

1. Profile: dev server on the port from the serve config, four environment configs, test runner with a path filter, the feature's route table.
2. `gh pr view` shows the PR merged; `merge-base --is-ancestor <merge-sha> HEAD` → in tree. The verified SHA is recorded.
3. The change's suites run: all pass, counts recorded.
4. The default config's API host does not resolve; a second config's host resolves and returns 200. Serve that one.
5. Server reaches its ready signal in a visible pane.
6. Confirm the seeded provider session → authenticated route, an authorised call returns 200.
7. Deep-link to the record id named in the commit message. It requires three services, two of them expressed as category placeholders.
8. Payloads: the eligibility endpoint returns an allow-list containing two of the required services; two follow-up queries resolve the placeholder categories. All three quoted verbatim.
9. No warning shown, action enabled. Cause read from the deciding function: an any-match passes on the two allowed services.
10. Reported: allow-list consumption and placeholder resolution confirmed in the browser; the **blocking** path confirmed by tests only, since this account passes the rule. The submit control was not pressed.

### Example 2: Recovering from an unreachable backend

*The seeded session "fails".*

Symptom: bounced to the login route, console shows `ERR_NAME_NOT_RESOLVED` for the API host.

Wrong move: asking the human to re-seed, or for different credentials.

Right move: `dig +short <host>` → empty. `curl` → exit 6. A sibling config's host resolves.
Restart the server on that config, navigate again, the session works untouched.

The credentials were never the problem, and were never involved. The seed script would have
failed the same way for the same reason — it logs in against the same unreachable host.

## Success Criteria

Verification is complete when:

- [ ] The project profile was discovered this run, not assumed
- [ ] The SHA under test is named and confirmed present in the working tree
- [ ] The affected suites ran, with counts recorded
- [ ] The served config's API host was proved reachable, and the config is named
- [ ] The seeded session was confirmed, evidenced by an authenticated route or a 200 from an
      authorised call — and no credential was read into context
- [ ] At least one payload from the new code path is quoted verbatim
- [ ] Screenshots exist, with their real paths listed
- [ ] Every UI conclusion cites the deciding file and line
- [ ] Paths not reachable in the browser are listed explicitly
- [ ] Credential leakage in `~/.playwright-mcp/` was checked and reported

## Dependencies

**This skill invokes/references:**
- None. Self-contained: the project profile in Step 1 replaces any project-specific companion skill.

**This skill is invoked by:**
- Users (verifying a change, taking screenshots, checking a PR in a browser)
- Any workflow skill needing browser evidence for an acceptance criterion

**Skill type:** Workflow (Level 2)
**Dependency depth:** 0 (invokes nothing)
**Context cost:** ~340 lines
**Circular risk:** None
