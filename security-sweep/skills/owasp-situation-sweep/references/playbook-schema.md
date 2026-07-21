# Playbook schema

A playbook is the *only* place vulnerability-specific knowledge lives. The
`owasp-situation-sweep` engine (SKILL.md) reads these fields and stays otherwise
class-agnostic — a new vulnerability class is a new file here, never a change to the engine.

A playbook is a Markdown file: a **YAML frontmatter** block (structured fields the engine
parses) followed by a **prose body** (guidance and code the engine shows the user).

## Frontmatter fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `vuln_class` | string | yes | Slug identifying the class, e.g. `open-redirect`. Matches the invocation name. |
| `cwe` | string | yes | e.g. `CWE-601`. |
| `owasp` | string | yes | e.g. `A01`. |
| `stack` | string | yes | e.g. `angular`. Gates which repo the sweep runs against. One class can have several playbooks — one per stack. |
| `target` | object | yes | `{ repo, roots }` — where the sweep runs. `roots` is the list of source directories to scan. |
| `detection` | list of regex | yes | Candidate-sink patterns to grep for. A hit is a *candidate*, never a verdict. |
| `triage_rules` | object | yes | `must_be` (precondition for any true sink), `true_sink` (what confirms one), `false_positive` (what clears one). Prose, applied with judgement. |
| `safe_pattern` | object | yes | `service`, `util`, `before`, `after` — the migration target, quoted from the real fix. |
| `forbidden` | list | yes | Things the safe pattern must always reject (e.g. dangerous URL schemes), regardless of caller opt-in. |
| `known_sites` | list | yes | Seeded from the learning doc / prior runs: `{ file, line, status, reason }`. `status` ∈ `migrate` / `false_positive` / `remediated` / `needs_discussion`. **Re-verified every run** — they drift. |
| `bypass_tests` | list | yes | Test checklist derived from the fix's bypass catalogue. Each becomes a scaffolded unit test on migration. |
| `learning_doc` | path | yes | Link back to the human-readable source doc, so the two stay in sync. |

## `known_sites.status` values

| Status | Meaning | Sweep behaviour |
|--------|---------|-----------------|
| `migrate` | Confirmed sink, not yet fixed | Report as **confirmed sink**; offer migration. |
| `false_positive` | A candidate that is not a real sink | Report as **false-positive** with the recorded reason; no action. |
| `remediated` | Already routed through the safe pattern | Note as already-fixed; do **not** re-flag as new work even if a regex still hits a preserved legacy branch. |
| `needs_discussion` | Ambiguous; needs a human call | Surface for discussion; never auto-migrate. |

## Authoring a new playbook

1. Start from a merged fix and its learning doc (the ground truth).
2. Fill the frontmatter; quote `safe_pattern.before`/`after` **verbatim** from the diff — paraphrasing invites drift.
3. Ground `known_sites` against the *current* code, not the doc alone. Run the `detection` regexes yourself and record real `file:line`s.
4. Derive `bypass_tests` from the fix's rejection cases (control chars, protocol-relative, userinfo, forbidden schemes, origin look-alikes, encoding).
5. Add a **Self-check** section: the exact triage a fresh run must reproduce. That is the playbook's acceptance test.
