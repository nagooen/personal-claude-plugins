---
name: owasp-situation-sweep
description: Use after a security fix merges when you need to find other instances of the same vulnerability class across the same-stack codebase and stop it recurring. Triggers include post-fix sweeps, "where else does this bug exist?", sibling-sink hunts, open redirect / SSRF / IDOR follow-up, and playbook-driven single-class security audits.
---

# OWASP Situation Sweep

## Overview

Depth on a **single vulnerability class, post-fix**. Take one merged security fix, sweep the
same-stack codebase for siblings, triage true sinks from false-positives with recorded
reasons, then optionally migrate them to the fix's safe pattern — and codify what you learn
so the next run compounds.

**Core principle:** every vulnerability-specific fact lives in a **playbook**
(`playbooks/<vuln>.md`); this engine stays vuln-agnostic. A new class is a new playbook file,
never an edit to this skill. If you find yourself adding a regex or a file path *here*, you're
in the wrong file.

## When to use

- A security fix just merged and introduced a reusable safe pattern (e.g. a validated redirect
  service), and you want every sibling sink found.
- You're asking "where else does this class of bug exist in this repo?"
- You want prevention codified, not a one-off grep.

**When NOT to use:**
- Story kickoff / "which OWASP categories apply?" → use `owasp-triage` (breadth, pre-code).
- Attacker-mindset review of a PR across all classes → use `security` (breadth, review-time).
- No playbook exists and no learning doc to distill one from → stop; nothing grounds the sweep.

This skill is **depth, not breadth**: one class, thoroughly, after the fix. It complements the
two skills above rather than replacing them.

## Input

```
owasp-situation-sweep <playbook-name | learning-doc-path>
```

e.g. `owasp-situation-sweep open-redirect`.

## The playbook contract

A playbook is Markdown — YAML frontmatter (structured fields this engine reads) plus prose
(guidance and snippets shown to the user). Full field reference:
`references/playbook-schema.md`. The fields the workflow leans on: `stack`/`target` (where the
sweep runs), `detection` (candidate-sink regexes), `triage_rules`, `safe_pattern`, `forbidden`,
`known_sites`, `bypass_tests`.

## Workflow

**Report first. Never edit code before the user has seen the report and approved a site.**

1. **Load** — resolve the playbook by name. If given a learning-doc path with no matching
   playbook, offer to *distill a playbook from the doc first* (a one-time, reviewed step),
   then continue.
2. **Sweep** — resolve the target repo/roots from `stack`/`target`; run each `detection`
   regex; collect `file:line` candidates. State the search scope explicitly — no silent caps
   or sampling. If you bound coverage, say so.
3. **Triage** — classify every hit with `triage_rules` plus an attacker mindset (borrow the
   reasoning style of the `security` skill): **confirmed sink** / **false-positive (with
   reason)** / **needs-discussion**. Pre-seed verdicts from `known_sites`, then **re-verify
   each against the current code** — known_sites drift as the codebase moves.
4. **Report** — emit a ranked table: `file:line`, verdict, why, recommended action, and which
   `known_sites` were re-confirmed vs. changed. **Stop here for user review.**
5. **Migrate on approval** — for each site the user approves: apply `safe_pattern`
   before→after and scaffold the `bypass_tests` as unit tests. One small diff per site.
   Migration is *offered*, never forced — accept / skip / fix-differently are all valid.
6. **Codify** — update the playbook's `known_sites` (found / fixed / deferred) and offer to
   draft follow-up tickets for anything deferred, so the next run starts from today's truth.

## Migration behaviour

Follow the playbook's `safe_pattern` faithfully:

- Route through the audited safe sink; validate the parsed value and act on **that same parsed
  object** — no validate-one-thing / act-on-another gap for an encoding trick to slip through.
- Don't re-decode a value the framework already decoded (double-decode bypasses).
- Fail safe the way the playbook specifies (e.g. a blocked redirect → in-app not-found, never
  throw).
- Preserve legitimate in-app navigation; don't reroute it through the raw sink.
- Gate behind a feature flag when the original fix did and the site warrants a staged rollout.

## Quick reference

| Step | Output | Gate |
|------|--------|------|
| Load | resolved playbook | distill-if-missing |
| Sweep | candidate `file:line` list | scope stated, no silent caps |
| Triage | verdict + reason per hit | known_sites re-verified |
| Report | ranked table | **STOP — user reviews** |
| Migrate | one diff + tests per approved site | per-site approval |
| Codify | updated playbook + tickets | — |

## Common mistakes

- **Grep-and-flag.** A regex hit is a *candidate*, not a finding. Every verdict carries a reason.
- **Trusting stale `known_sites`.** Re-verify against current code: a once-confirmed sink may
  now be remediated, and a new sibling may have appeared since the playbook was written.
- **Migrating before reporting.** The report-and-stop gate is the whole point — it keeps the
  user in control of their own codebase.
- **Leaking vuln specifics into this file.** Detection regexes, safe patterns, and site lists
  belong in the playbook. This engine never names a vulnerability.
