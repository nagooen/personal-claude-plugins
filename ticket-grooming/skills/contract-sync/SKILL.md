---
name: contract-sync
description: Sweep an epic's frontend and backend tickets for one contract stated two ways - field names, casing, shape, optionality, enums, error bodies and rollout flags - then pin one canonical contract on the epic
---

# Contract Sync Skill

One contract, two or more tickets. Find where they disagree before someone builds from them.

## Purpose

A vertical slice has one contract and several tickets describing it. Each description was written
by a different person, at a different time, from a different side of the wire. They drift. Neither
side reads as wrong.

`groom` Rule 4 checks one ticket against the code. This skill checks **ticket against ticket**. A
contract can be internally consistent in every ticket and still not join up.

| Drift | What it looks like | What it costs |
| --- | --- | --- |
| **Field name** | Provider says `funding_eligibilities`, consumer says `eligibilities` | The mapper reads `undefined`; the guard silently passes |
| **Case** | Provider `support_provider_uuid`, consumer `supportProviderUuid` | Schema validation fails on a field that is present |
| **Shape** | Provider returns one object, consumer ticket expects a list | Consumer built against a shape that never arrives |
| **Optionality** | Provider nullable on no match, consumer treats it as always there | Crash on the first empty result |
| **Enum coverage** | Provider ships four codes, consumer ticket handles three | Unhandled default, usually rendering as "not eligible" |
| **Error body** | Provider defines the 4xx body, no consumer ticket says what renders | Blank screen that no ticket owns |
| **Rollout coupling** | Provider behind flag A, consumer behind flag B | One side live, the other not: inert or half-broken |
| **Ownership** | No AC covers the mapping layer | Found during integration, off-sprint |
| **Sequencing** | Consumer unblocked before the endpoint exists | Consumer builds against a guessed shape |

The first four are the expensive ones. They produce code that compiles, tests that pass in
isolation, and a feature that quietly does nothing.

**This skill does not design the contract.** It finds where tickets disagree about a contract that
already has an owner.

- To repair a single ticket: `groom`
- To write the contract tests that lock the agreement in: `contract-test-ac`
- To create tickets that do not exist: the story-creator agent

---

## When it applies

Run the sweep when **all** of these are true:

- The epic has children in two or more repos, or two or more languages
- Data crosses between them at runtime
- At least one child is still open

Skip it, and say so, when every child lives in one repo and one language. There is no cross-stack
contract to sync — that is `groom` Rule 4 and nothing more.

---

## Core Rules

### Rule 1: One boundary, one owner, many consumers

For every place data crosses the stack, name **exactly one provider ticket** and list every
consumer ticket.

If two tickets both claim to define the response shape, fix that first — before comparing a single
field. Two owners means two contracts, and the matrix will not converge.

Boundaries to look for:

- REST endpoint
- GraphQL query or mutation
- Event, queue or webhook payload
- Shared enum or code list
- Feature flag read on both sides
- Database column a second service reads directly

### Rule 2: Compare in a matrix, not in prose

One row per field. One column per ticket. One column for the shipped code.

```markdown
| Field | Provider (BE-1) | Consumer (FE-0) | Shipped code | Verdict |
| --- | --- | --- | --- | --- |
| `eligibleServices` | array, always present | `eligible_services`, array, optional | `eligibleServices` | drift — consumer wrong on name and optionality |
| `assessedAt` | ISO-8601 date-time | not mentioned | present | silence — does the consumer need it? |
| `verdict` | enum of 3 | enum of 3, same values | matches | agree |
```

Three verdicts only:

- **agree** — same name, case, shape, optionality, values
- **drift** — they disagree; name which side is wrong
- **silence** — nobody consumes it, or nobody provides it

Prose comparison hides drift. A matrix makes silence visible, which prose never does.

### Rule 3: Resolve by role, not by seniority

- **Provider wins on shape.** What the endpoint returns is a fact about the provider.
- **Consumer wins on need.** A field the consumer requires and the provider does not return is a
  **provider gap** — a new AC on the provider ticket, not a note on the consumer's.
- **Code wins on fact.** Where either ticket disagrees with merged code, the code is what exists.
  Intent still lives in the ticket.
- **Nobody wins on silence.** A provided field no consumer reads is either over-fetching or a
  missing consumer. Decide which and say so.

**Never resolve a drift by loosening the consumer.** Making a required field optional so it matches
a ticket that was wrong ships the bug instead of fixing it.

### Rule 4: Case is part of the field name

`supportProviderUuid` and `support_provider_uuid` are different fields.

State the case on **both** sides. Then state where the conversion happens and which ticket owns
it. This is the most common silent drift at a stack boundary: the response arrives, the guard
runs, every field reads `undefined`, and nothing throws.

If the provider serialises snake_case and the consumer's types are camelCase, name the transformer
and the ticket that builds it. **"The adaptor handles it" is not an owner.**

### Rule 5: Sweep the unhappy paths too

Happy-path drift gets caught by the first integration test. These do not:

| Path | Both tickets must state |
| --- | --- |
| **Empty result** | 200 with an empty list, 204, or 404 — and what renders |
| **Provider error** | The 4xx/5xx body shape, and what the consumer shows |
| **Timeout** | The literal value, and fail open or fail closed |
| **Auth failure** | Which status, and whether the consumer retries or logs out |
| **Flag off** | What each side does. "Nothing" is not an answer |

Fail-open and fail-closed cannot be split across tickets. If the provider ticket says "fail open"
and no consumer ticket says what an open failure renders, the behaviour is undefined and will be
decided by whoever writes the code last.

### Rule 6: Couple the rollout, or sequence it explicitly

Two valid options. The tickets must say which one.

**One flag** — the same literal key on both sides, pinned once on the epic. Two keys is a bug even
when both spellings are individually correct.

**Sequenced** — the provider ships first and dark; the consumer ships behind its own flag
afterwards. State the order, and state that the provider is backward compatible.

Then answer both questions explicitly:

- What happens if the consumer ships first?
- What happens if the provider ships first?

"That cannot happen" needs the mechanism that prevents it.

### Rule 7: If the consumer is unblocked early, name the stub and the swap

Consumers routinely start before the endpoint exists. That is fine, if the tickets say so:

- Which ticket builds the stub or mock
- Which literal shape it returns — the provider's shape, read from the provider's ticket, never a
  guess
- Which ticket swaps stub for real
- Whether the stub ships to production, and behind what

An unnamed stub becomes production code.

### Rule 8: Pin the contract once, on the epic

The canonical shape and its literals live on the epic. Children link up to it.

A child that restates the contract will drift from it again. That restatement is how the epic got
into this state.

---

## Workflow

### Step 1 — Confirm the stack actually splits

Read the epic and every open child. Note each child's repo and language. Apply **When it applies**.

If unsure of field names or MCP parameters: invoke the `jira` skill.

### Step 2 — List the boundaries

One line each: kind, provider ticket, consumer tickets.

```
GET /support_providers/:uuid/funding_eligibilities   provider BE-1   consumers FE-0, FE-3a
flag connectors_sah_eligibility_gates               provider BE-1   consumers FE-0
```

### Step 3 — Assign one owner per boundary

Apply Rule 1. Resolve contested ownership before comparing any field.

If two tickets both define the shape, that is a decision for the squad — report it, do not pick a
winner unilaterally.

### Step 4 — Extract verbatim, do not summarise

Copy each ticket's stated contract into the matrix **word for word**.

Paraphrasing normalises the casing and the optionality — the exact things you are hunting.

### Step 5 — Read the code for the third column

Where code is merged, read the real serialiser, schema or type. Not the ticket's copy of it: the
ticket is what you are checking.

### Step 6 — Diff

Apply Rule 2. Mark every row agree, drift or silence. Count them by class.

### Step 7 — Resolve

Apply Rule 3. Every drift and silence row becomes exactly one of:

- **A ticket correction** — the wrong side gets edited
- **A new AC on the provider** — a consumer need not yet promised
- **An open item** — with an owner and the ticket that settles it

If AC need writing rather than reformatting: invoke the `acceptance-criteria` skill.

### Step 8 — Unhappy paths, rollout, stub

Apply Rules 5, 6 and 7. These three produce more open items than the field matrix does, because
nobody wrote them down anywhere.

### Step 9 — Pin the contract on the epic

Apply Rule 8. One canonical shape block, one pinned-values table:

```markdown
### Pinned values — use these literally, do not paraphrase

| Thing | Literal value |
| --- | --- |
| Endpoint | `GET /support_providers/:uuid/funding_eligibilities` |
| Wire case | snake_case on the wire, camelCase in consumer types |
| Transformer owner | FE-0 |
| Feature flag key | `connectors_sah_eligibility_gates` — one key, both sides |
| Timeout / behaviour | 10s, then fail open |
```

Then list which children must change, and how.

### Step 10 — Report, then publish

**Never write straight to Jira.**

1. Write the report and any drafted descriptions to a local file
2. Report boundaries, drift by class, silence, ownership gaps, open items
3. **Wait for approval**
4. Per ticket, re-fetch and compare `updated` against Step 1. If it moved, stop and re-merge
5. Publish

> **Why:** a Jira description edit replaces the whole body and there is no version check. A
> concurrent human edit is lost silently. Issue history is the only rollback.

---

## Report format

```
Boundaries: 2
  GET /.../funding_eligibilities    provider BE-1    consumers FE-0, FE-3a
  flag connectors_sah_...           provider BE-1    consumers FE-0

Fields compared: 14
  agree 6   drift 6   silence 2

Drift by class
  name 1   case 2   optionality 1   enum 1   error body 1

Ownership gaps: 1
  snake_case -> camelCase transformer named in no ticket

Rollout: sequenced, but neither ticket states the order
Stub: FE-0 uses one; no swap ticket exists

Open items: 3
```

Lead with the counts. The class breakdown tells the squad whether this is a wording problem or a
design problem.

---

## Red flags

Any of these means the boundary is not synced, however good each ticket looks alone:

- A response shape written out in full in more than one ticket
- Two flag keys where the feature needs one
- Casing stated on one side only
- "The adaptor handles it", with no ticket named
- A consumer ticket whose AC never mention the error path
- A provider field no consumer ticket mentions
- A stub with no swap ticket
- "Fail open" on one side and silence on the other
- Provider and consumer estimates that assume different sequencing
- Two tickets that both define the same response

---

## Examples

### Example 1 — A shape pivot the consumer never heard about

```
contract-sync: ES-61993
```

**Found:**
- The provider ticket had been rewritten to a three-field verdict. The consumer ticket still
  described the earlier shape, including a tier field that no longer existed
- Both tickets read as complete and current
- The merged consumer code was built against the old shape
- The feature flag key appeared spelled two ways across the two tickets

**Result:** the three-field shape pinned once on the epic; the consumer ticket corrected; the flag
key pinned once. The stale tier field became an open item rather than a silent edit, because
merged code still returned it and somebody had to decide which was wrong.

### Example 2 — Silence, not drift

```
contract-sync: ES-61993 --boundary funding_eligibilities
```

**Found:** the provider returned `defaultService`, `isAdminOnlyType` and `serviceInJob`. No
consumer ticket mentioned any of the three.

**Result:** raised as a question, not a correction. Two were genuinely needed and got new AC on the
consumer ticket. One was over-fetching and got a trim ticket. Neither ticket had been *wrong* —
which is exactly why nobody had caught it.

### Example 3 — Sweep not needed

```
contract-sync: ES-58440
```

**Found:** four children, all in one Rails repo. No runtime boundary between them.

**Result:** skipped. Reported: *"Single repo, single language — there is no cross-stack contract to
sync. Run `groom` per child instead."*

No edit made.

---

## Success Criteria

The sweep is complete when:

- [ ] Every boundary is listed with exactly one provider ticket
- [ ] Every field sits in the matrix, marked agree, drift or silence
- [ ] Casing is stated on both sides, and the transformer has a named owner
- [ ] Every drift row is a correction, a new provider AC, or an open item with an owner
- [ ] Empty, error, timeout, auth-failure and flag-off paths are stated on both sides
- [ ] Rollout is one shared flag key, or an explicitly stated sequence
- [ ] Any stub names its shape source and its swap ticket
- [ ] The canonical contract and its literals are pinned once, on the epic
- [ ] No child restates the contract
- [ ] The report was approved, and `updated` re-checked, before publishing

---

## Dependencies

**This skill invokes/references:**
- `jira` (conditional: for field mappings, MCP parameters, URL extraction)
- `acceptance-criteria` (conditional: when a drift row becomes a new provider AC)
- `contract-test-ac` (reference only: when the fix is contract tests, not ticket edits)

**This skill is invoked by:**
- `groom` (conditional: epic pass, when children span frontend and backend)
- `groom` (conditional: ticket pass, when the ticket is one side of a boundary)
- Users, at epic kickoff or before an integration milestone

**Skill type:** Definition (Level 1)
**Dependency depth:** 1 (invokes Foundation skills only)
**Context cost:** ~400 lines self; ~900 with both conditional dependencies
**Circular risk:** None. `groom` invokes this; this names `groom`'s rules for orientation but never
invokes it.

---

## Usage

Invoke when:

- An epic has both frontend and backend children and integration is coming
- A consumer is about to be built before the provider exists
- Two tickets describe the same response and you are not sure they match
- Someone asks "is that field camelCase or snake_case on the wire?"

```
contract-sync: ES-61993                      # sweep every boundary in the epic
contract-sync: ES-61993 --boundary <path>    # one boundary only
contract-sync: ES-62195 ES-62201             # one provider / consumer pair
```
