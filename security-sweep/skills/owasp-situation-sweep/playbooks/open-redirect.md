---
vuln_class: open-redirect
cwe: CWE-601
owasp: A01
stack: angular
target:
  repo: web-frontend
  roots:
    - src/app
learning_doc: '~/.claude/memory/plans/web-frontend/ES-56999-open-redirect-evidence.md'
# Seed: ES-56999 (PR #10298 — centralised SafeRedirectService, fix XSS + open redirect).
# learning_doc points at the durable evidence memo. The in-worktree
# docs/solutions/security-issues/open-redirect-post-login-web-frontend-20260714.md authored during
# ES-56999 was not merged to master, so it is not a reliable reference.
# Follow-up ticket for deferred sinks: ES-59829.

# Candidate-sink patterns. A hit is a CANDIDATE, never a verdict — full-page navigation to a
# user-influenced value. router.navigateByUrl(...) is deliberately NOT here: Angular resolves it
# against configured routes, so an absolute off-site URL fails to match rather than navigating
# off-site. navigateByUrl candidates are tracked via known_sites, not regex (see notes below).
detection:
  - 'window\.location\.href\s*='
  - 'window\.location\.assign\('
  - 'window\.location\.replace\('
  - 'window\.open\('
  - '\.href\s*=.*redirect'

triage_rules:
  must_be: >
    The navigated value originates from external input — a query param (ActivatedRoute /
    queryParamMap), localStorage, postMessage, or an API field an attacker can influence. A
    hardcoded literal (window.location.href = '/') is never a sink.
  true_sink: >
    A user-influenced value flows into a full-page navigation (window.location.href / assign /
    replace, or window.open) without origin validation. Origin-prefixed concatenation
    (`${window.location.origin}${x}`) is still a sink: userinfo (`@evil.com`) and
    protocol-relative suffixes escape the intended origin.
  false_positive: >
    (1) router.navigateByUrl(x) / router.navigate(...) — SPA navigation resolved against routes,
    not an off-site jump. (2) A hardcoded/literal target. (3) A value already routed through
    SafeRedirectService.

# Migration target — quoted verbatim from ES-56999 (PR #10298). Do not paraphrase.
safe_pattern:
  service: 'SafeRedirectService — src/app/shared/services/safe-redirect.service.ts'
  util: 'parseSafeUrl — src/app/shared/utilities/safe-url.util.ts'
  api: "safeRedirectService.redirect(url, { allowedOrigins: 'internal' | string[], allowedSchemes?, context? }): boolean"
  before: |
    // Legacy: string-prefix check, then a raw full-page assignment.
    if (redirectUrl.indexOf('http://') === 0 || redirectUrl.indexOf('https://') === 0) {
      window.location.href = redirectUrl;
    } else {
      this.router.navigateByUrl(redirectUrl);
    }
  after: |
    // Fixed: validate + navigate the same parsed URL; fail safe to in-app not-found.
    const didRedirect = this.safeRedirectService.redirect(redirectUrl, {
      allowedOrigins: 'internal',
      context: 'login',
    });
    if (!didRedirect) {
      this.router.navigateByUrl('/not-found', navigationExtras);
    }

# Always rejected by parseSafeUrl regardless of allowedSchemes opt-in.
forbidden:
  - 'javascript:'
  - 'data:'
  - 'vbscript:'
  - 'blob:'
  - 'file:'

# Verified against web-frontend on 2026-07-22 (post-merge of PR #10298). Re-verify every run.
known_sites:
  - file: src/app/pages/login/services/redirect-after-login.service.ts
    line: 126
    status: remediated
    reason: >
      Primary path routes through safeRedirectService.redirect(...) behind feature flag
      connectors_safe_redirect_url. The raw window.location.href at ~:126 is the preserved
      handleRedirectLegacy() branch (flag-disabled fallback, slated for removal once the flag is
      fully enabled). The detection regex still hits this line — triage it as already-remediated,
      not a new sink.
  - file: src/app/shared/services/auth.service.ts
    line: 317
    status: migrate
    reason: >
      window.location.href = `${window.location.origin}${redirectTo}` — origin-prefixed but
      redirectTo is untrusted; userinfo/backslash/protocol-relative suffixes can escape the
      origin. Confirmed sink. (Lines 300 and 320 assign a hardcoded '/' — safe, ignore.)
  - file: src/app/shared/guards/gateway.guard.ts
    line: 40
    status: false_positive
    reason: >
      Uses router.navigateByUrl(redirectUrl) (:40 and :48) with redirectUrl from
      queryParamMap. SPA navigation resolved against routes — not an off-site full-page jump.
  - file: src/app/pages/verify-mobile-number/verify-mobile-number.component.ts
    line: 156
    status: needs_discussion
    reason: >
      Uses this.router.navigateByUrl(this.redirectUrl) (:156) with redirectUrl from a query
      param. By triage_rules this is a false-positive for open redirect (in-app nav, not a
      window.location sink). NOTE: the ES-56999 human analysis listed this file as a sink to
      migrate under ES-59829 — the live code shows navigateByUrl, so the two disagree. Flagged
      for human confirmation rather than silently downgraded.

# Derived from the parseSafeUrl / SafeRedirectService rejection cases. Each becomes a scaffolded
# unit test (Jest + ts-mockito, per web-frontend conventions) when a site is migrated.
bypass_tests:
  - 'Control characters: tab/newline/CR inside the value (e.g. "/\t/evil.com") — normalised, then rejected as protocol-relative.'
  - 'Protocol-relative: "//evil.com" — rejected up front.'
  - 'Backslash: "https:\\evil.com" / "/\\evil.com" — rejected (parser rewrites \\ to /).'
  - 'Userinfo: "https://trusted@evil.com" — rejected (username/password present).'
  - 'Forbidden / mixed-case scheme: "JaVaScRiPt:alert(1)", "data:...", "vbscript:" — always rejected.'
  - 'HTTP downgrade: "http://evil.com" rejected; "http://localhost" allowed (dev carve-out only).'
  - 'Origin look-alike: suffix ("evil-mable.com"), prefix, port variant, trailing dot — rejected by exact URL.origin match.'
  - 'Encoded end-to-end delivery: query param already decoded by DefaultUrlSerializer — must NOT be double-decoded (double-decode reopens the bypass).'
---

# Open Redirect (CWE-601 / OWASP A01) — Angular / web-frontend

## What this class looks like here

A user-influenced value (query param, `localStorage`, external field) reaches a **full-page
navigation** — `window.location.href = …`, `window.location.assign/replace(…)`, or
`window.open(…)` — without origin validation, sending an authenticated user off-site. In the
seed incident (ES-56999) the payload rode through the FusionAuth OAuth round-trip in
`localStorage`, so it was invisible in the address bar during login.

## Why naive fixes fail

String checks (`indexOf`, `startsWith`) miss protocol-relative (`//evil.com`), backslash
variants, and control characters the URL parser silently strips. A manual `decodeURIComponent`
on an `ActivatedRoute` param double-decodes (Angular's `DefaultUrlSerializer` already decoded
it), reopening the bypass. **Validate the canonical parsed `URL`, and navigate that same
object** — never re-parse or re-decode between the check and the jump.

## The safe pattern

`SafeRedirectService.redirect(url, options)` (returns `false` when blocked) canonicalises via
`parseSafeUrl` (`new URL()`), rejects obfuscation at the parse stage (backslash,
protocol-relative, userinfo, control chars), enforces https-only (localhost carve-out), and
checks `URL.origin` against an **exact** allowlist. `allowedOrigins: 'internal'` resolves to the
app's own origins — pass the symbol, never hardcode origins. Forbidden schemes
(`javascript:`, `data:`, `vbscript:`, `blob:`, `file:`) are stripped unconditionally.

## Sweep notes for this stack

- The `detection` regexes are `window.location.*` / `window.open` centric. `router.navigateByUrl`
  cases (`gateway.guard.ts`, `verify-mobile-number.component.ts`) are **not** surfaced by regex
  — they ride in via `known_sites` and are triaged as false-positives. This is intentional: a
  full-page sink is the class; SPA navigation is the look-alike that must be *cleared*, not
  fixed.
- A live sweep on 2026-07-22 also surfaced **`src/app/pages/coordinators/components/coordinator-client-details/coordinator-client-details.component.ts:67`**
  (`window.location.href = \`${environment.appUrl()}${redirectTo}\``) — the same origin-prefixed
  shape as `auth.service.ts:317`. Not in the ES-56999 set; left for a real run to triage rather
  than pre-judged here.

## Self-check (this playbook's acceptance test)

A fresh run of `owasp-situation-sweep open-redirect` against `web-frontend` should:

- [ ] flag `auth.service.ts:317` as a **confirmed sink** (and ignore the hardcoded `'/'` at :300/:320).
- [ ] surface `redirect-after-login.service.ts:126` but triage it as **already-remediated** (legacy flag branch), not new work.
- [ ] classify `gateway.guard.ts` as a **false-positive**, citing `router.navigateByUrl`.
- [ ] classify `verify-mobile-number.component.ts` as **false-positive / needs-discussion** (navigateByUrl), and note the disagreement with the ES-56999 human analysis.
- [ ] produce the report **before** any code change.
- [ ] on approval, a migration compiles, lints, and its scaffolded bypass tests pass.
