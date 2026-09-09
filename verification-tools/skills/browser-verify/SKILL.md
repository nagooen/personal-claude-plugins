---
name: browser-verify
description: Verify a web-frontend change in a real browser. Runs the change's own specs as the contract, serves a reachable config on :8200, logs in from a local credentials file, then proves the code path ran using Playwright network payloads and screenshots. Reports partial verification honestly rather than passing a green suite off as browser-verified.
---

# Browser Verify Skill

You are verifying that a web-frontend change actually works in a running browser. Your job is to produce **evidence**, not reassurance: the payload the new code received, the screen the user would see, and an honest statement of which paths you could not reach.

## Purpose

A passing unit suite proves the logic. It does not prove the code runs, the field arrives on the wire, or the user sees the right screen. This skill closes that gap for `web-frontend` changes and, just as importantly, stops you claiming more than you observed.

Use it when asked to verify a change, confirm a fix works, take screenshots of a change, or check a PR in a browser.

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

**2. Credentials file** at `~/.claude/test-accounts.json`. Schema:

```json
{
  "web-frontend": {
    "worker": { "email": "someone.worker+dev@example.com", "password": "..." },
    "client": { "email": "someone.client+dev@example.com", "password": "..." }
  }
}
```

Read it with the Read tool. If it is missing, print the schema and stop — never ask the user to paste a password into the conversation.

**3. A checkout** at `~/projects/mableit/web-frontend` (or a worktree under `~/projects/mableit/worktrees/`) with `node_modules` present.

## Workflow Steps

### Step 1: Pin exactly what is under test

Never assume the working tree holds the change. Establish it:

```bash
WF=~/projects/mableit/web-frontend
git -C "$WF" rev-parse --abbrev-ref HEAD
git -C "$WF" status --short
git -C "$WF" fetch origin --prune
```

For a PR, get the head and confirm it is reachable locally:

```bash
gh pr view <N> --repo bettercaring/web-frontend --json state,headRefOid,mergeCommit,baseRefName
git -C "$WF" merge-base --is-ancestor <sha> HEAD && echo "IN TREE" || echo "NOT IN TREE"
```

**Three traps, all seen in practice:**

- A merged PR has its branch **deleted on origin**. `git fetch origin <branch>` then fails with `couldn't find remote ref`. The change is on `master` instead — check the merge commit.
- A local remote-tracking ref can be **stale**, pointing at an older head than the PR. Always `--prune` and compare SHAs, never branch names.
- `git fetch origin master` updates only `FETCH_HEAD`, **not** `refs/remotes/origin/master`. Use a bare `git fetch origin` to move tracking refs.

Report the SHA you are verifying. Everything downstream is a claim about that commit.

### Step 2: Read the change's specs as the contract, and run them

The spec files in the diff are the written expectation. Read them before touching a browser — they tell you which behaviour matters and, critically, which cases exist.

```bash
git -C "$WF" show --stat <sha> | grep spec
```

Run the affected suites. This is cheap, deterministic, and covers paths the browser cannot reach:

```bash
cd "$WF" && npx jest --watchman=false --no-coverage --testPathPattern="<area>"
```

Record the exact counts (`25 passed, 322 tests`). A red suite ends the verification — report it and stop.

If the specs are hard to map onto observable behaviour, invoke the `angular-spec-coverage` skill to analyse them.

### Step 3: Choose a config that can actually reach a backend

**This is the step that most often wastes time.** The dev-server port is `8200` (`angular.json`, the `serve` target).

Each `src/environments/environment*.ts` points at a different `baseUrl`. They are **not** equally reachable from a laptop:

| Script | `baseUrl` | Resolves? |
|---|---|---|
| `npm start` | `staging-mable.com.au` | **No** — no DNS answer |
| `npm run start:release` | `release.containers.staging-mable.com.au` | Yes |
| `npm run start:local` | proxies to `localhost:3000` | Only with a local backend |

Prove it before starting anything:

```bash
grep -n "baseUrl" "$WF/src/environments/environment.release.ts"
dig +short release.containers.staging-mable.com.au
curl -s -m 10 -o /dev/null -w "%{http_code}\n" https://release.containers.staging-mable.com.au/
```

A bare `staging-mable.com.au` failure looks exactly like a rejected login: the request never leaves the machine. Symptom to recognise in the browser console:

```
Failed to load resource: net::ERR_NAME_NOT_RESOLVED @ https://staging-mable.com.au/api/...
```

**Diagnose DNS before ever suspecting the credentials.** `curl` exit 6 and `dig` returning nothing are conclusive. Default to `npm run start:release`.

### Step 4: Serve where the user can watch it

If the session is inside Herdr (`test "${HERDR_ENV:-}" = 1`), run the server in a visible pane rather than a hidden background task, so the human can see the build:

```bash
herdr pane split --current --direction right --cwd "$WF" --no-focus
herdr pane run <returned-pane-id> "npm run start:release"
herdr pane read <pane-id> --source recent-unwrapped --lines 40
```

Otherwise run it as a background command. Either way, wait for both signals before proceeding:

```
** Angular Live Development Server is listening on localhost:8200 **
✔ Compiled successfully.
```

Free the port first if something already holds it (`lsof -nP -iTCP:8200 -sTCP:LISTEN -t`). Poll in a loop; never a bare foreground `sleep`. A cold build takes 40 seconds to several minutes.

### Step 5: Log in

Pick the persona the change concerns — a provider-facing gate needs the `worker` account, not `client`.

```
browser_resize            { width: 1440, height: 900 }
browser_navigate          { url: "http://localhost:8200/login" }
browser_fill_form         { fields: [ {target: "[data-testid=\"login-email\"]", ...},
                                      {target: "[data-testid=\"password-input\"]", ...} ] }
browser_click             { target: "[data-testid=\"login-submit\"]" }
browser_wait_for          { time: 5 }
```

Prefer `data-testid` selectors over snapshot refs — refs go stale after every re-render and Angular re-renders constantly.

Success looks like a redirect to `/dashboard/carer` (worker) and a console error count that **drops**. Still on `/login` plus a rising error count means the request failed; go back to Step 3 before doubting the password.

### Step 6: Reach the changed surface

Find the route from source rather than clicking around:

```bash
grep -rn "path:" "$WF/src/app/pages/<area>/"*routing*.ts
```

Deep-linking straight to the case is faster and more reproducible than navigating. A job-detail example:

```
browser_navigate { url: "http://localhost:8200/jobs/search/all/<jobId>" }
```

An empty list is not a verification. If a list view has no rows, the code path under test never ran — deep-link to a specific record instead. Where the ticket or commit message names a concrete case (a job id, a client, an account), **use that exact one**: it was chosen because it reproduces.

Use `browser_find { regex: ... }` to locate an element cheaply. A full `browser_snapshot` of a Mable page is thousands of lines — use it only when `find` is not enough.

### Step 7: Capture evidence, payload first

**The network payload is the strong evidence. The screenshot is the artefact.** A screenshot shows a state; the payload proves which code path ran and what data it saw.

```
browser_network_requests  { static: false, filter: "graphql|<endpoint-fragment>" }
browser_network_request   { index: <n>, part: "response-body" }
browser_network_request   { index: <n>, part: "request-body" }
```

Request bodies identify GraphQL operations by `operationName` and variables, which is how you prove a specific new query fired rather than inferring it from the UI.

**Two counting traps, both verified in practice:**

- Indices are numbered **per page load**. List and fetch within the same load; after any navigation, re-list before fetching, or you will quote the wrong request.
- A cached observable can stop a request from re-firing. `sah-worker-type-placeholder.service.ts:123` uses `shareReplay({ bufferSize: 1, refCount: false })`, which lives as long as the Angular injector. A full `browser_navigate` tears the injector down, so the query fires again; an **in-app** router navigation reuses the cache and issues nothing. Absence of a repeat request is therefore not evidence the code path was skipped — force a full reload when you need to observe the call.

Then the screenshots:

```
browser_take_screenshot { scale: "css", filename: "01-<what>.png", fullPage: true }
```

Number them in flow order. **A relative `filename` lands in the home directory, not the Playwright output dir** — state the real path in your report. Read back at least the decisive screenshot with the Read tool to confirm it shows what you claim.

Quote payloads verbatim in the report. Paraphrased JSON is not evidence.

### Step 8: Explain the observed state only from the rule's source

This is the discipline that matters most, and the easiest to skip.

When the UI shows (or omits) something, **read the predicate that decides it** before explaining why. Do not reason backwards from what you see.

A worked failure: on a Support-at-Home job showing no eligibility warning, the conclusion drawn was "the worker-type placeholder expansion suppressed a false warning". The actual rule was:

```ts
return !jobServiceCodes.some((code) => eligibleCodes.has(code));
```

Block only when **no** job service is deliverable. The worker had two deliverable services, so the job passed on the any-match alone — the expansion was irrelevant to that outcome. The verdict ("the change works") survived; the stated mechanism was wrong.

Rules:

- Absence of a UI element proves the predicate was false. It does **not** identify which clause made it false.
- Read the function, name the file and line, then explain.
- If you cannot point at the deciding line, label the explanation **unverified**.

### Step 9: Report, and name the gap

Separate what you observed from what you inferred, and state plainly which paths the browser could not reach.

```markdown
## Verified in the browser
- <endpoint> returned: <verbatim payload>
- <UI outcome>, decided by <file>:<line>
- Screenshots: <paths>

## Verified by specs only
- <path the browser could not reach> — <suite>, <N> tests

## Not verified
- <case> — needs <setup>
```

Some paths are structurally unreachable with the data at hand: a blocking rule cannot be shown by an account that passes it. **Say so.** Never let a green suite be reported as browser-verified, and never imply full coverage from a partial run.

### Step 10: Clean up credentials

Playwright writes DOM snapshots that **contain the typed password in plaintext**:

```bash
grep -rl "<password>" ~/.playwright-mcp/ 2>/dev/null
```

Report the matching files and offer to delete them. Do not delete without asking — the user may want the snapshots — but never leave the leak unmentioned.

Leave the dev server running unless asked to stop it, and say where it is (pane id or background task id).

## Hard Rules

**Never:**
- Take an outward action without explicit approval — applying to a job, submitting a form, sending a message, paying. These create real records in a shared environment. Getting to the button is verification; pressing it is not yours to decide.
- Mutate staging data to make a case reachable (editing a profile, a service list, an account) unless the user asks.
- Echo a password into the conversation, a commit, or a report.
- Claim browser verification on the strength of a passing suite.
- Report a state's cause without citing the deciding line.

**Always:**
- Name the SHA under test.
- Run the specs before the browser.
- Check DNS before blaming credentials.
- Quote payloads verbatim.
- State what you could not reach.

## Examples

### Example 1: Successful partial verification

*Verify the Support at Home apply gate matches the eligible list (ES-63076).*

1. `gh pr view` shows the PR merged; `merge-base --is-ancestor <merge-sha> HEAD` → in tree. Verifying `ecec787f0d`.
2. `npx jest --testPathPattern="sah-eligibility-gates"` → **25 suites, 322 tests passed**.
3. `dig` shows bare `staging-mable.com.au` has no answer; the release host resolves and returns 200. Start `npm run start:release`.
4. Server compiles in a Herdr pane; `:8200` returns 200.
5. Log in as the `worker` account → `/dashboard/carer`, console errors drop from 5 to 0.
6. Deep-link to the job id named in the commit message. It requires *Showering, toileting & dressing*, *Nursing services*, *Allied health services*.
7. Payloads:
   - `GET /app/support_at_home/eligibility_gate` → `eligibleServices` contains `showering_and_dressing`, `toileting`; `ineligibleServices: []`
   - `POST /app/graphql` `{operationName: "services", variables: {code: "nursing_list"}}` → nine nursing services by `sortValue`
   - Same for `allied_list` — both placeholder expansions fired
8. No warning banner, Apply active. Cause read from `is-apply-blocked.ts:30`: the any-match passes on the two deliverable services.
9. Reported: eligible-list consumption and placeholder expansion confirmed in the browser; the **blocking** path confirmed by specs only, since this account passes the gate. Apply was not clicked.

### Example 2: Recovering from an unreachable backend

*The login "fails".*

Symptom: still on `/login`, console shows `ERR_NAME_NOT_RESOLVED` for `staging-mable.com.au`.

Wrong move: re-typing the password, asking for different credentials.

Right move: `dig +short staging-mable.com.au` → empty. `curl` → exit 6. `dig +short release.containers.staging-mable.com.au` → an address. The default config is unreachable; the release config is not. Restart with `npm run start:release`, log in unchanged, console errors go to 0.

The credentials were never the problem, and were never tested.

## Success Criteria

Verification is complete when:

- [ ] The SHA under test is named and confirmed present in the working tree
- [ ] The affected suites ran, with counts recorded
- [ ] The dev server served a config whose backend resolves
- [ ] Login succeeded, evidenced by the post-login route
- [ ] At least one payload from the new code path is quoted verbatim
- [ ] Screenshots exist, with their real paths listed
- [ ] Every UI conclusion cites the deciding file and line
- [ ] Paths not reachable in the browser are listed explicitly
- [ ] Credential leakage in `~/.playwright-mcp/` was checked and reported

## Dependencies

**This skill invokes/references:**
- `angular-spec-coverage` (conditional: if the change's specs are hard to map onto observable behaviour)

**This skill is invoked by:**
- Users (verifying a change, taking screenshots, checking a PR in a browser)
- `desk-check` (conditional: when acceptance criteria need browser evidence)

**Skill type:** Workflow (Level 2)
**Dependency depth:** 1 (invokes one Definition skill; that skill invokes nothing)
**Context cost:** ~400 lines alone, ~715 with `angular-spec-coverage`
**Circular risk:** None — `angular-spec-coverage` does not reference this skill
