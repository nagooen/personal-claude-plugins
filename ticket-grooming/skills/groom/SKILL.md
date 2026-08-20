---
name: groom
description: Groom an existing Jira epic or ticket so someone can build from it - restructure to What/Why/How/AC, pin literal values, define the epic's jargon, and reconcile the description against what actually shipped
---

# Groom Skill

Take an epic or ticket that already exists and make it buildable.

## Purpose

Grooming is not writing a ticket. It is repairing one. The ticket exists, someone is about to
build from it, and it will mislead them.

Four failure modes, in the order they cost the most:

| Failure | What it looks like | What it costs |
| --- | --- | --- |
| **Drift** | The description specifies a contract the code no longer has | The reader codes against types that do not compile |
| **Description over value** | "the single global feature flag" — never named | A guessed literal that compiles and silently does nothing |
| **Undefined jargon** | "tier 1" used across 14 children, defined nowhere | Every reader invents a different meaning |
| **The essay** | 4,000 words of decision rationale | Nobody finds the acceptance criteria |

Drift and description-over-value are the expensive ones. They do not read as errors — they read
as a working ticket — and they produce bugs that compile.

**This skill does NOT create tickets.** For that, use the story-creator agent or write from a PRD.
This skill only improves what is already there.

---

## Core Rules

### Rule 1: Four sections, then a short tail

Every groomed ticket reduces to:

- **What** — the deliverable, in one paragraph plus a signature or contract if there is one
- **Why** — the problem, and what breaks if this is not built
- **How** — brief. Pinned values, named traps, key decisions. Do not presuppose implementation
- **Acceptance criteria** — GIVEN/WHEN/THEN

Then a short tail: estimate, blockers, open items, OWASP categories, links, delivery.

Anything that does not fit those is a candidate for deletion.

### Rule 2: Pin literals. Never describe them.

**A reader cannot build from a description of a value.** This is the single highest-value thing
grooming does.

Every groomed ticket gets a table:

```markdown
### Pinned values — use these literally, do not paraphrase

| Thing | Literal value |
| --- | --- |
| Feature flag key | `connectors_sah_eligibility_gates` |
| Endpoint | `GET /personal_documents/support_providers/:uuid/funding_eligibilities` |
| Query parameter | `effective_date`, format `YYYY-MM-DD` |
| Wire fields validated | `eligibilities.supportAtHome.eligibleServices` — camelCase |
| Enum / code values | `home_care_package` |
| Timeout | 10s, then fail open |
| Cache key / TTL | `supportProviderUuid` + derived date / 5 min |
```

Pin at minimum: **feature flag keys, endpoint paths, query parameter names AND formats, wire field
names AND their case, enum and code values, timeouts, cache keys, table and column names.**

Case matters. `supportProviderUUID` and `support_provider_uuid` are different fields and a schema
validating the wrong one fails silently.

### Rule 3: Define the epic's own jargon

If a term appears in two or more tickets and is defined in none, define it once — on the epic —
and have the children link to it.

Watch for: tier 1 / tier 2, phase names, mode names, "the adaptor", "the gate", internal acronyms,
and any capitalised Noun Phrase the team says out loud but never wrote down.

A definition is not a gloss. Say what it *means*, what it *blocks*, what *drives* it, and where it
*renders*.

### Rule 4: Reconcile against reality

If code exists, the description must match it. Check every one of these:

- [ ] Type or contract blocks in the ticket still compile against the real source
- [ ] Field names, casing and optionality match the shipped types
- [ ] Function and helper names match (casing included)
- [ ] Every AC describes behaviour the code actually has
- [ ] Every pinned literal matches the source
- [ ] Anything the ticket says "always" or "never" about is still true

Where they disagree, the code wins on *fact* and the ticket wins on *intent*. If the code
deliberately diverges, record why in Open Items — do not silently rewrite the AC to match a bug.

### Rule 5: Keep what is load-bearing. Cut the rest.

**Keep verbatim:** contract and type definitions, copy decks and exact UI strings, named traps
("do not use X, it would break Y"), pinned values, anything a reader would otherwise guess.

**Cut:** decision rationale essays, superseded-decision narratives, "why we split this out"
histories, PR checklists, test-scenario inventories, anything restating what a linked ADR says.

The test: *would deleting this sentence cause someone to make a mistake?* If no, delete it.

### Rule 6: Record open items. Do not solve them.

Grooming surfaces unknowns. Write them down with the ticket that will settle them, and move on.
An open item with an owner is progress; an open item you tried to answer in the description is a
new essay.

### Rule 7: Never blank a section to look tidy

If a template section does not apply, say `N/A` **and why**. An empty Security section reads as
"not assessed", which is worse than "assessed, nothing applies".

---

## Workflow: Ticket pass

### Step 1 — Fetch and record

Read the issue. **Record the `updated` timestamp** — you will check it before writing.

If unsure of field names or MCP parameters: invoke the `jira` skill.

### Step 2 — Triage: is this worth grooming?

Skip and say so:

- **Closed or Done** — rewriting destroys the record and helps nobody
- **Finished spikes** — the value was the answer, not the format
- **Tickets someone else is mid-edit on** — check `updated` and the assignee first

### Step 3 — Restructure

Reduce to What / Why / How / AC plus the tail. Move surviving prose into the section where a
reader would look for it, not the section it was written in.

### Step 4 — Pin the literals

Build the table from Rule 2. Read the source to get the values — do not copy them from the
ticket, since the ticket is what you are checking.

### Step 5 — Define the jargon

Apply Rule 3. If the term belongs to the whole epic, note that it should move up rather than
being redefined per child.

### Step 6 — Reconcile

Apply Rule 4. Every mismatch is either a ticket correction or an Open Item.

### Step 7 — Acceptance criteria

GIVEN / WHEN / THEN. Testable, and matching shipped behaviour where it exists.

If AC need real rework rather than reformatting: invoke the `acceptance-criteria` skill.

### Step 8 — Security

If the ticket has a Security or OWASP section, verify it is still accurate. If it is missing or
reflexively `N/A`: invoke the `owasp-triage` skill.

### Step 9 — Delivery

If work is in flight, add a delivery table: PR links, review order, base branches, and which PR
unblocks which dependent ticket. Reviewers need the order more than the list.

### Step 10 — Draft, then publish

**Never write straight to Jira.**

1. Write the groomed description to a local file
2. Report: sections cut, literals pinned, jargon defined, drift found
3. **Wait for approval**
4. Re-fetch the issue and compare `updated` against Step 1. **If it moved, stop** — someone edited
   it while you worked. Re-merge rather than clobber
5. Publish

> **Why:** a Jira description edit replaces the whole body and there is no version check. A
> concurrent human edit is lost silently. Issue history is the only rollback.

---

## Workflow: Epic pass

Run when the key is an Epic. The epic pass is about **coherence across children**, not the epic's
own prose.

### Step 1 — Fetch the epic and every child

Note each child's status. Open children are in scope; Closed ones are not.

### Step 2 — Build one glossary

List every term used in two or more children. Define each once, on the epic. Children link up
rather than redefining — divergent redefinitions are how "tier 2" comes to mean three things.

### Step 3 — Consistency sweep

- Same concept, same name everywhere
- Same literal value everywhere (a flag key spelled two ways is a bug waiting)
- Same structure, so a reader moving between children knows where to look

### Step 4 — Gaps and overlaps

- Is any behaviour owned by two children? Decide which, and say so in both
- Is any behaviour owned by none? That is a missing ticket, not a grooming fix — raise it
- Does every child have a consumer, or is something being built for nobody?

### Step 5 — Dependency order

Map what blocks what. State the critical path and which child unblocks the most others. If a
child is blocked by something outside the epic, say so on the child, not just the epic.

### Step 6 — Epic-wide pinned values

Flag keys, endpoints, shared enums and shared contracts belong on the epic once. Children
reference them.

### Step 7 — Report, then groom children

Report what the sweep found. Then either run the ticket pass per child, or list which children
need it and let the human choose — a 14-child epic is a lot of edits to approve in one go.

---

## Red flags

Any of these means the ticket is not ready, whatever its length:

- A value named by role rather than literal — "the flag", "the endpoint", "the code"
- A term used more than once and defined nowhere
- A contract or type block that would not compile today
- An AC the shipped code contradicts
- "Always" or "never" with no stated exception, where an exception exists
- A section that restates a linked ADR instead of linking to it
- Estimates or file counts left over from before a split
- A Security section that is blank or reflexively `N/A`

---

## Examples

### Example 1 — Ticket pass finds drift

```
groom: ES-62195
```

**Found:**
- Description ran ~2,500 words with eight design sections before the AC
- "single global feature flag" — never named. The shipped enum used a different key, so the
  feature had been silently inert on every surface
- "match `serviceCategoryableCode`" — never said which of two namespaces, and the two never match
- "tier 1" and "tier 2" used twelve times, defined only in a Confluence source doc
- Contract block still showed a field and a union branch that had been removed

**Result:** ~1,700 words in What/Why/How/AC, a pinned-values table, a tier definition table, and
five corrections where the description specified code that no longer existed. Two of the pinned
values were the direct cause of shipped bugs.

### Example 2 — Ticket is not worth grooming

```
groom: ES-58001
```

**Found:** status Closed, shipped three weeks ago.

**Result:** skipped. Reported: *"Closed and shipped — rewriting the description destroys the
record of what was actually agreed. Groom the follow-up ticket instead if there is one."*

No edit made.

### Example 3 — Epic pass finds an overlap

```
groom: ES-61993 --children
```

**Found:**
- "tier 1" / "tier 2" used across 14 children, defined in none
- One flag key spelled two ways across three children
- The confirm-time validation rule appeared in both FE-3a and FE-3b with opposite meanings
- FE-2 had no stated consumer

**Result:** glossary added to the epic; flag key pinned once; the FE-3a/FE-3b overlap raised as a
decision for the squad rather than resolved unilaterally; a note on FE-2 asking who consumes it.

---

## Success Criteria

Grooming is complete when:

- [ ] Structure is What / Why / How / AC plus a short tail
- [ ] Every literal a builder needs is pinned in a table, read from source
- [ ] Every term used more than once is defined, once
- [ ] Description reconciles with shipped code, or divergence is an Open Item
- [ ] AC are GIVEN/WHEN/THEN and match real behaviour
- [ ] Security section is filled honestly, never blank
- [ ] No section restates a linked ADR or Confluence page
- [ ] Draft was approved before publishing, and `updated` was re-checked
- [ ] For an epic: one glossary, consistent names, gaps and overlaps reported

---

## Dependencies

**This skill invokes/references:**
- `jira` (conditional: for field mappings, MCP parameters, URL extraction)
- `acceptance-criteria` (conditional: when AC need rework, not just reformatting)
- `owasp-triage` (conditional: when the Security section is missing or stale)

**This skill is invoked by:**
- Users, before picking up a ticket that reads badly
- Users, at epic kickoff or mid-epic when children have drifted apart

**Skill type:** Workflow (Level 2)
**Dependency depth:** 1 (invokes Foundation and Definition skills only)
**Context cost:** ~400 lines self; ~1,200 with all three conditional dependencies
**Circular risk:** None — nothing referenced here references this back

---

## Usage

Invoke when:

- A ticket is about to be built from and reads badly
- A ticket describes code that has since changed
- An epic's children have drifted apart in naming or structure
- You are about to ask someone "what does this term mean?"

```
groom: ES-62195              # ticket pass
groom: ES-61993              # epic pass, epic only
groom: ES-61993 --children   # epic pass, then report which children need work
```
