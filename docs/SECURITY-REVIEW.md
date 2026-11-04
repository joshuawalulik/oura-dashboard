# Security & PII review — Oura Partner Dashboard

Date: 2026-11-03 · Scope: full working tree + complete git history (all branches), reviewed against `origin/main` (commit `2796b7f`, the deployed build).

> **Status (2026-11-04): historical record — all actionable findings are closed.**
> M1, L1, L2, L4, and L5 were fixed in PR #4 (merged and deployed; the scoped
> `oura-dashboard-ci-deploy` Cloudflare token is in place and verified by a
> live deploy). L3 was confirmed mock data (see below). L6 and the I1 notes
> are informational/accepted-risk by choice (Oura-side token revoke on
> disconnect, `.impeccable/critique/` cleanup, KV-at-rest). Nothing in this
> document describes an open issue. Line references are to the pre-PR#4 code
> the review inspected.

**Overall posture: strong.** No secrets, tokens, keys, or health data were ever committed. The two-layer auth, field allowlist, and metadata-only logging claims all hold up under inspection. Findings below are hardening opportunities, not active holes.

---

## Findings (by severity)

### M1 — `ACCESS_DEV_BYPASS` has no code-level production guard — ✅ fixed
> Applied: bypass now also requires `GIT_SHA` to be absent ([src/index.ts:68](src/index.ts#L68)); two tests added (ignored when `GIT_SHA` set, honored without).

**Severity: Medium** · [src/index.ts:66](src/index.ts#L66), [src/types.ts:13](src/types.ts#L13)

A single env var (`ACCESS_DEV_BYPASS = "1"`) disables the in-Worker JWT check **and** grants owner identity to every request. Today nothing sets it in production — `wrangler.toml` has no `[vars]` block and it isn't a deployed secret — but the only safeguard is convention ("NEVER set this in production" in `.dev.vars.example`). One accidental `wrangler secret put`, a future `[vars]` block, or a bulk secret import would silently drop auth layer 2 to Access-only *and* make the partner the owner.

**Remediation:** make the bypass structurally impossible in production. Cheapest: honor it only when `GIT_SHA` is absent (CI always injects `--var GIT_SHA:…`, dev never has it):
```ts
if (c.env.ACCESS_DEV_BYPASS === "1" && !c.env.GIT_SHA) { … }
```
Add a test asserting the bypass is ignored when `GIT_SHA` is set.

### L1 — `POST /auth/disconnect` has no CSRF defense of its own — ✅ fixed
> Applied: the `/auth/*` middleware now rejects any request whose `Origin` header names another site ([src/routes/auth.ts](src/routes/auth.ts)); cross-origin and same-origin tests added.

**Severity: Low** · [src/routes/auth.ts:88](src/routes/auth.ts#L88)

The route is protected only by the Access cookie + owner check. A cross-site form POST from the owner's browser would be blocked by the Access cookie's SameSite behavior today, but that's Cloudflare's default, not something this repo controls or tests. Impact is low (tokens deleted → reconnect), but it's the one state-changing route reachable by simple request.

**Remediation:** in the `/auth/*` middleware (or on this route), reject requests whose `Origin` header is present and not the site's own origin. One `if`, no session machinery needed.

### L2 — Error-message logging can carry more than metadata in edge cases — ✅ fixed
> Applied: the KV token-record parse is wrapped; a corrupt record is deleted and degrades to `NotConnectedError`, so no `JSON.parse` excerpt can reach logs ([src/oura.ts](src/oura.ts)); test added.

**Severity: Low** · [src/index.ts:42](src/index.ts#L42), [src/routes/api.ts:108](src/routes/api.ts#L108)

Both the `onError` handler and `handleUpstreamError` log `err.message` verbatim. All *expected* errors carry safe, constant messages (verified across `src/oura.ts`, `src/access.ts`, both route files). The crack: V8's `JSON.parse` errors can include an excerpt of the parsed input. `JSON.parse(raw)` on the KV token record ([src/oura.ts:54](src/oura.ts#L54)) runs outside any try/catch — a corrupted record would put a fragment of the token JSON into `err.message` and thence into Workers Logs. Unlikely, but it's the one path that can break the "never tokens in logs" claim.

**Remediation:** wrap the token-record parse and rethrow a constant-message error (e.g. treat unparseable records as `NotConnectedError` after deleting the record), or truncate/allowlist `err.message` at the two log sites.

### L3 — Committed redesign screenshots may show real health data — ✅ RESOLVED: confirmed mock
**Severity: closed 2026-11-03** · `docs/redesign/*.jpg`

> Resolution: the redesign session confirmed all five screenshots (before and after) were taken against a static preview with a `mock-api.js` fetch stub — hardcoded summary (86/74/63, 7h42m), sine-generated trend series, fabricated last-sync. Independently verified against the committed images: values match the stub exactly and the after-shots' footer reads "BUILD DEV.MOCK". No real Oura data was ever rendered or captured. No cleanup needed.

PR #3 committed five dashboard screenshots showing scores (86/74/63), sleep time, and a dated 7-day trend line. The redesign session's notes say populated UI came from a mock fetch-stub, and before/after show identical values — consistent with mock data — but the dates match real calendar days and the "before" shot predates the mock setup in that session's narrative. If any of these show real Oura values, they're now permanent history in the repo.

**Remediation:** confirm they're mock. If real: the values shown are coarse daily scores (low sensitivity), so the pragmatic fix is deleting `docs/redesign/` in a follow-up commit and accepting history retention — or rewrite history now while the repo has a single collaborator, if that matters to you. Going forward, only screenshot the mock-stub UI (the handover note already establishes that pattern).

### L4 — CI actions pinned by tag, not SHA, in a repo holding a deploy token — ✅ fixed (pins) / ⏳ token scoping is yours
> Applied: all three `uses:` entries pinned to full commit SHAs (checkout v7.0.1, setup-node v6.5.0, wrangler-action v4.1.3). Scoping the Cloudflare token is a dashboard action only you can do.

**Severity: Low** · [.github/workflows/ci.yml:20](.github/workflows/ci.yml#L20), [ci.yml:34](.github/workflows/ci.yml#L34)

`actions/checkout@v7`, `setup-node@v6`, and `cloudflare/wrangler-action@v4` are mutable tags. A compromised tag could exfiltrate `CLOUDFLARE_API_TOKEN` (which can deploy to your domain and read KV — i.e., the Oura tokens). Otherwise CI secrets handling is correct: secrets only in the push-to-main deploy step, never echoed; smoke test and uptime probe print only an HTTP status code.

**Remediation:** pin all four `uses:` entries to full commit SHAs (Dependabot can keep them fresh), and scope the Cloudflare token to Workers-deploy-only for this account if it isn't already.

### L5 — Security headers: no HSTS, no `form-action` — ✅ fixed
> Applied: `Strict-Transport-Security: max-age=31536000; includeSubDomains` added and CSP extended with `form-action 'self'` ([src/index.ts](src/index.ts)); header test extended.

**Severity: Low** · [src/index.ts:52-60](src/index.ts#L52)

The CSP is genuinely strict (all `'self'`, no third-party origins — verified against deployed HTML/CSS/JS: self-hosted Chart.js, self-hosted B612 fonts, one `data:` SVG noise texture covered by `img-src data:`). Two gaps: no `Strict-Transport-Security` header (may be covered by zone-level "Always Use HTTPS", but the Worker shouldn't assume it), and CSP `form-action` is not covered by `default-src` fallback. No forms exist today, but it's a free hardening line.

**Remediation:** add `Strict-Transport-Security: max-age=31536000; includeSubDomains` and append `; form-action 'self'` to the CSP.

### L6 — Personal email addresses in git commit metadata — ✅ fixed for future commits
> Applied: repo-local `git config user.email` set to `71195503+joshuawalulik@users.noreply.github.com` (revert with `git config --unset user.email`). Existing history unchanged — only relevant if the repo ever goes public.

**Severity: Low (only if the repo ever goes public)** · git history metadata

File *content* across all history contains only placeholder emails (`owner@example.com`, `partner@example.com`). But commit author/committer metadata contains two personal addresses (not repeated here, to keep file content clean — inspect `git log --format='%ae %ce'` to see them, plus the GitHub noreply). Fine for a private repo; they become public (and scrapeable) the moment the repo does.

**Remediation:** none needed while private. If you ever open-source: either accept it, or mirror to a fresh repo rather than flipping visibility. For future commits, consider setting `git config user.email` to the GitHub noreply address.

### I1 — Informational / accepted-risk notes
- **KV namespace id + custom domain in `wrangler.toml`** ([wrangler.toml:16](wrangler.toml#L16), [:28](wrangler.toml#L28)): acceptable for a private repo. The namespace id is not a credential — it's only usable with an account API token — and the domain is public by nature (DNS, CT logs). No action; just don't carry it into a public fork.
- **`.dev.vars` / `.wrangler/` were never committed** on any branch (verified via `git log --all --name-only`); `.gitignore` covers both, plus `.claude/`. The only tracked "secret-shaped" files ever were `.dev.vars.example` (placeholders) and a harmless `.claude/launch.json` (removed in `20e8ecc`).
- **`.impeccable/critique/...md` embeds absolute local paths** — ✅ fixed: file untracked and deleted; `.impeccable/.gitignore` now covers `critique/` and `hook.cache.json`. (The old copy remains in PR #3's history — accepted, it's only a macOS username.)
- **Oura tokens sit plaintext in KV and are not revoked at Oura on disconnect** ([src/routes/auth.ts:89](src/routes/auth.ts#L89)): disconnect deletes the only stored copy, which is fine; calling Oura's revoke endpoint too would be strictly better. KV-at-rest exposure is equivalent to Cloudflare-account compromise — accepted.
- **Malformed JWT signature segment → 500 instead of 403** — ✅ fixed: signature decode wrapped, now a clean `AccessJwtError` → 403 ([src/access.ts](src/access.ts)); test added.
- **`failurePage` inline `style` attribute is blocked by the CSP** — ✅ fixed: the page now links `/styles.css` and uses the privacy/terms document classes ([src/routes/auth.ts](src/routes/auth.ts)).
- **Ops note:** ~~local `main` is 2 commits behind~~ ✅ done: local `main` fast-forwarded to `origin/main` (`2796b7f`).

---

## Verified clean (explicit no-findings)

1. **PII/secrets in history:** full `git log -p` across all branches — no API keys, OAuth secrets, tokens, Cloudflare account ids, Access AUD/team-domain values, or health data fixtures anywhere. Tests use generated RSA keys and obvious fake tokens.
2. **Logging hygiene:** request log is method/path/status/ms/viewer-role only; no query strings (OAuth `code`/`state` never logged — `onError` logs pathname only); `oura_fetch` logs counts/timings; token-refresh logs outcome enums. Claim holds on every route and error path except the L2 edge case.
3. **Response surface:** `src/filter.ts` allowlist is airtight — only `day/date`, three scores, `type` (consumed server-side), and `total_sleep_seconds` survive; filtered-before-cache means even the KV cache never holds raw Oura payloads. Error bodies are constant JSON enums. Partner cannot reach `/auth/*` (owner middleware at [src/routes/auth.ts:31](src/routes/auth.ts#L31)) and `?refresh=1` is owner-gated.
4. **Auth layers:** JWT verification checks alg=RS256, signature, `exp`, `nbf` (60s skew), `aud`, `iss`, and email presence, with kid-based key lookup and a single rotation refetch. Owner check is case-normalized on both sides.
5. **OAuth flow:** state is 256-bit random, KV-stored, single-use, 10-min TTL; tokens go straight to KV and never into responses, logs, or the client; refresh rotation keeps the newest refresh token.
6. **Frontend:** no localStorage/sessionStorage/cookies/analytics/external origins in deployed `app.js`/`styles.css`/HTML; API URLs carry only `days` and `refresh`; privacy.html and terms.html claims match observed behavior (3h cache TTL confirmed at [src/routes/api.ts:18](src/routes/api.ts#L18)).
7. **CI/workflows:** secrets referenced only via `${{ secrets.* }}` in the deploy step; probes emit status codes only; deploy gated on push-to-main after tests.

## Top 3 actions

1. ~~Guard the dev bypass in code~~ (M1) — ✅ applied with tests.
2. **Scope the Cloudflare token** (L4) — pins applied; token scoping remains a Cloudflare-dashboard action for the owner.
3. ~~Confirm the redesign screenshots are mock data~~ (L3) — ✅ done: confirmed stub-generated, verified against the committed images ("BUILD DEV.MOCK" footer). No cleanup needed.
