# Oura Partner Dashboard

[![CI](https://github.com/joshuawalulik/oura-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/joshuawalulik/oura-dashboard/actions/workflows/ci.yml)

A private, production-grade health dashboard that shares my Oura Ring stats
with exactly one other person. Serverless end to end, zero secrets in the
client, zero third-party origins, and a CI pipeline that refuses to ship a
broken or open deployment.

**Stack:** TypeScript · [Hono](https://hono.dev) · Cloudflare Workers + KV + D1 ·
Cloudflare Access · Chart.js (self-hosted) · Vitest (`workerd` pool) · GitHub Actions

## Live demo

**[oura-demo.joshuawalulik.com](https://oura-demo.joshuawalulik.com)** — no
login, click around.

The demo is the same Worker code deployed separately
(`wrangler deploy --env demo`) with `DEMO_MODE=1`: every number is
synthesized ([src/demo.ts](src/demo.ts)) as a pure function of the calendar
date — seeded PRNG, weekly sleep rhythm, the odd rough night that drags
readiness down and resting heart rate up — so it's stable within a day and
drifts day to day without rewriting history. There's no Access in front and
nothing private behind: the demo Worker has **no KV namespace, no D1
database, no secrets, and no OAuth routes** (they 404) — the demo's
baselines and patterns run the same insight math over generated days. The real deployment below stays locked to
two email addresses.

## What it does

- Today's readiness, sleep, and activity scores as rings, plus time asleep
  and 7/30-day trend charts, in a dark instrument-panel UI
- Owns its history: a nightly cron ingests each day into D1, and the
  dashboard reads today against a 28-day rolling baseline ("1.8σ below your
  norm") — something the Oura app itself doesn't show
- A Patterns panel with computed, honest sentences (sleep length and bedtime
  vs HRV, day-of-week effects), recomputed nightly over up to a year of
  history. Each claim has to beat a seeded shuffle test at p ≤ 0.01, every
  result can show its math, and tested ideas with no clear link are listed
  too: no LLM, no fabrication
- Names the readiness contributors sitting low today, without guessing at
  Oura's unpublished weights
- Pulls from the Oura API v2 over OAuth2, with automatic access-token refresh
  and refresh-token rotation persisted in KV
- Exactly two email addresses can see it; only the owner can connect or
  disconnect the Oura account

## Architecture

```
Browser ──HTTPS──▶ Cloudflare Access (email OTP, 2-address allowlist)
                          │  authenticated request + signed JWT
                          ▼
                  Cloudflare Worker (Hono)
                  ├── validates the Access JWT on every request
                  ├── serves the static dashboard
                  ├── /api/*  → filtered, KV-cached Oura data
                  ├── /auth/* → owner-only OAuth flow with Oura
                  ├── Workers KV: tokens + 3h response cache
                  └── D1: one row per day (nightly cron upsert)
                          │                └─ baselines + patterns
                          ▼
                  Oura API v2 (api.ouraring.com)
```

One Worker serves everything. There is no server to patch, and the whole
thing fits in Cloudflare's free tier. The D1 history is the part Oura can't
take away: filtered day rows accumulate under the ingest cron (idempotent
upserts, so late ring syncs self-heal), and the insights are computed from
that store, never fetched.

## Security model

Two independent authentication layers must both pass:

1. **Cloudflare Access at the edge** — email one-time PIN against a
   two-address allowlist. Strangers never reach the Worker.
2. **JWT verification inside the Worker** — every request's
   `Cf-Access-Jwt-Assertion` is verified independently
   ([src/access.ts](src/access.ts)): RS256 signature against the team's
   published JWKS (cached, with rotation handling), plus `aud`, `iss`, and
   expiry checks. The `workers.dev` route is disabled, so even a direct hit
   on the Worker is useless without a valid JWT.

On top of that:

- **Field allowlisting** ([src/filter.ts](src/filter.ts)) — API responses
  contain only explicitly copied fields. Raw Oura payloads never reach the
  browser, so granting the app more scopes leaks nothing by default.
- **Owner/viewer split** — `/auth/*` requires the authenticated email to
  match the owner; the partner can view but never touch the Oura connection.
- **OAuth hygiene** — single-use, TTL-bound `state`; tokens live only in
  Worker secrets and KV; a revoked refresh token degrades cleanly to a
  "not connected" state.
- **Hardened responses** — CSP locked to `'self'` (no external origins at
  all), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`.
  No health data or tokens in logs.

### Why there's no custom login page

Deliberately. Identity is delegated to Cloudflare Access and independently
*verified* in the Worker — so this app owns no passwords, no sessions, no
reset flow, and no phishing surface. Rolling custom auth to protect two
users would be strictly worse than the battle-tested edge primitive;
"don't build your own auth when a stronger primitive exists" is the
production-grade choice. The engineering lives in the JWT verification
layer and the owner/viewer authorization split on top of it.

## Performance

- **One round trip** — `/api/dashboard` returns status, summary, and history
  together, sharing a single upstream load (4 KV reads instead of 8)
- **Two-level caching** — filtered Oura responses cached 3h in KV
  server-side; fetched ranges cached in memory client-side, so the 7/30-day
  toggle is instant
- **No third-party requests** — Chart.js is self-hosted, so first paint
  costs one origin's DNS/TLS, and the CSP stays `'self'`-only

## Testing & CI/CD

111 tests run in the real Workers runtime via
`@cloudflare/vitest-pool-workers` — JWT verification against generated RSA
keys, token refresh/rotation, field-allowlist leak checks, D1 ingest
idempotency against the checked-in migrations, baseline/correlation math
against fixtures, and full request-level tests with Oura and the Access
JWKS mocked (no live calls).

Every push runs typecheck + tests; merges to `main` deploy via
`wrangler-action` and then **smoke-test the live site, asserting
unauthenticated requests are turned away** — proving each deploy is up
*and* fails closed. The public demo deploys after production and gets the
opposite smoke test: it must answer *without* auth and still declare
`"demo": true`. Superseded runs auto-cancel; docs-only commits skip CI.

## Observability

- **Structured JSON logs** flow to Workers Logs (and stream live via
  `npx wrangler tail`): every request logs method, path, status, latency,
  and viewer *role* — never emails, tokens, query strings (OAuth codes live
  there), or health values
- **Upstream visibility** — cache misses log each Oura call's latency and
  document count (making the cache hit rate obvious), and token refreshes
  log their outcome, so a broken Oura connection is diagnosable at a glance
- **Uptime probe** — an hourly GitHub Actions run asserts the production
  site is reachable *and* still failing closed, emailing on failure; the
  same check gates every deploy

## Project layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Security headers, Access JWT middleware, routing |
| `src/access.ts` | Access JWT verification (JWKS, signature, claims) |
| `src/oura.ts` | Oura OAuth token lifecycle + paginated data fetching |
| `src/filter.ts` | Field allowlists — the only path data takes to the browser |
| `src/routes/` | `/api/*` data routes and owner-only `/auth/*` flow |
| `src/ingest.ts` | Nightly/backfill Oura → D1 ingest (idempotent upserts) |
| `src/store.ts` | D1 day store (upsert + range reads) |
| `src/insights.ts` | Baseline (mean/σ/z) and pattern math — pure functions |
| `migrations/` | D1 schema migrations (applied in tests too) |
| `public/` | Static dashboard (vanilla JS, no framework) |
| `test/` | Vitest suite (runs in `workerd`) |

## Running it

```sh
npm install
cp .dev.vars.example .dev.vars   # local config; ACCESS_DEV_BYPASS=1 skips edge auth in dev only
npm run dev                      # wrangler dev on :8787
npm test
```

Deploying your own instance needs: an Oura OAuth app
(developer.ouraring.com), a Cloudflare zone + Access application (one-time
PIN, email allowlist), a KV namespace and a D1 database
(`wrangler d1 create oura-days`, id into [wrangler.toml](wrangler.toml),
then `wrangler d1 migrations apply oura-days --remote`), and five secrets
via `wrangler secret put` — `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`,
`CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`, `OWNER_EMAIL`. Then
`wrangler deploy` (or push to `main` with `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` repo secrets set). After the first deploy, hit
`/api/ingest?backfill=365` once as the owner to seed the history; the
nightly cron keeps it current from there.

## License

[MIT](LICENSE)
