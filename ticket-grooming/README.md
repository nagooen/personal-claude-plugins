# ticket-grooming

Groom an existing Jira epic or ticket so someone can build from it.

## Why

Grooming is not writing a ticket. It is repairing one. The ticket exists, someone is about to
build from it, and it will mislead them.

Four failure modes, ordered by what they actually cost:

| Failure | What it looks like | What it costs |
| --- | --- | --- |
| **Drift** | The description specifies a contract the code no longer has | The reader codes against types that do not compile |
| **Description over value** | "the single global feature flag" — never named | A guessed literal that compiles and silently does nothing |
| **Undefined jargon** | "tier 1" used across 14 children, defined nowhere | Every reader invents a different meaning |
| **The essay** | 4,000 words of decision rationale | Nobody finds the acceptance criteria |

The first two are the expensive ones. They do not read as errors — they read as a working
ticket — and they produce bugs that compile.

## Usage

```
groom: ES-62195              # ticket pass
groom: ES-61993              # epic pass
groom: ES-61993 --children   # epic pass, then report which children need work
```

## What it does

**Ticket pass** — restructures to What / Why / How / AC, pins every literal a builder needs into
a table, defines the ticket's jargon, and reconciles the description against shipped code.

**Epic pass** — coherence across children: one glossary, consistent naming, gaps and overlaps,
and whether the dependency order still holds.

It never writes to Jira without approval. A description edit replaces the whole body and Jira
has no version check, so the workflow drafts, re-checks the `updated` timestamp, and only then
publishes.

## Provenance

Written from a real epic (ES-61993, SaH Eligibility Gates) where the two expensive failure modes
each caused a shipped bug:

- "single global feature flag" was never named, so the code shipped `connectors_sah_eligibility`
  while the provisioned flag was `connectors_sah_eligibility_gates`. The gate failed open on
  every surface and looked healthy doing it.
- "match `serviceCategoryableCode`" never said which namespace, and a service *category* code
  (`nursing_list`) was fed where a service *categoryable* code (`personal_care_showering`)
  belonged. The two never match.

Its first epic-pass run on that same epic found eight children crediting the wrong ticket with
the shared foundation, four documents describing four different contracts, four names for one
service code, two stale blockers on tickets already Done, and four dependencies with no ticket
at all.
