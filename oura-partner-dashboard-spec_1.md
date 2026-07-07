# Oura Partner Dashboard — Design & Implementation Document

**Purpose:** A small, private website that lets exactly two people (the ring owner and their partner) view the owner's Oura Ring health stats. Hosted entirely on Cloudflare, served over HTTPS, with access restricted via Cloudflare Access.

**Audience for this document:** Claude Code. This spec should be sufficient to scaffold, implement, and deploy the project end-to-end. Where a decision is marked `[OWNER INPUT]`, pause and ask before proceeding.

---

## 1. Goals & Non-Goals

### Goals
- Display the owner's daily Oura stats: readiness, sleep, and activity summaries, with a recent-history view (last 7 and 30 days).
- Accessible only to two specific people, each identified by their email address.
- Oura credentials (client secret, access/refresh tokens) never leave the server side. The browser only ever receives already-fetched, already-filtered JSON.
- Zero-maintenance operation: automatic token refresh, response caching, no database to administer.
- Cheap/free: everything should fit in Cloudflare's free tier and Oura's standard API limits.

### Non-Goals
- No support for arbitrary users, sign-ups, or more than one Oura account.
- No writing data back to Oura.
- No long-term historical warehousing (we display what the Oura API returns on demand; we are not building an archive).
- No native mobile app (responsive web only).

---

## 2. High-Level Architecture

```
Partner's browser ──HTTPS──▶ Cloudflare Access (email OTP allowlist: 2 emails)
                                     │ (authenticated request + CF-Access JWT)
                                     ▼
                             Cloudflare Worker (Hono)
                             ├── serves static dashboard (HTML/CSS/JS)
                             ├── /api/* routes → fetch from Oura API v2
                             ├── Workers KV: oura tokens + response cache
                             └── validates Cf-Access-Jwt-Assertion on every request
                                     │
                                     ▼
                             Oura API v2 (api.ouraring.com)
```

**Stack decisions (fixed):**
- **Runtime:** Cloudflare Workers, TypeScript, [Hono](https://hono.dev) as the router.
- **Storage:** Workers KV — one namespace for OAuth tokens, reused for response caching with TTLs.
- **Auth (site access):** Cloudflare Access, One-Time PIN identity provider, policy allowing exactly two email addresses.
- **Auth (Oura):** OAuth2 Authorization Code flow. Note that personal access tokens were deprecated by Oura in December 2025 — OAuth2 is the only option.
- **Frontend:** Single static page served by the Worker. Vanilla TS + a lightweight chart library (Chart.js via CDN or bundled). No React/Next — keep the deploy a single Worker.
- **Tooling:** `wrangler` for local dev and deploy.

---

## 3. Oura API Reference (verified July 2026)

### OAuth2 endpoints
| Purpose | URL |
|---|---|
| Authorization (user-facing) | `https://cloud.ouraring.com/oauth/authorize` |
| Token exchange & refresh | `https://api.ouraring.com/oauth/token` |

⚠️ The authorize URL is on `cloud.ouraring.com`; the token URL is on `api.ouraring.com`. These must be configured separately.

### Scopes
Available scopes: `email`, `personal`, `daily`, `heartrate`, `workout`, `tag`, `session`, `spo2`.

**Request only:** `daily` (readiness/sleep/activity summaries) and `personal` (needed for basic profile). Do **not** request `heartrate`, `tag`, `session`, or `spo2` unless the owner later opts in. `[OWNER INPUT]` Confirm whether workout data should be included (`workout` scope).

### Token lifecycle
- Access tokens expire after ~24 hours.
- Refresh via `POST https://api.ouraring.com/oauth/token` with `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret` (form-encoded).
- Refresh responses may rotate the refresh token — always persist the newest one returned.

### Data endpoints (base `https://api.ouraring.com/v2`)
| Data | Endpoint |
|---|---|
| Daily readiness | `GET /usercollection/daily_readiness?start_date&end_date` |
| Daily sleep | `GET /usercollection/daily_sleep?start_date&end_date` |
| Daily activity | `GET /usercollection/daily_activity?start_date&end_date` |
| Detailed sleep periods (optional, for bedtime/wake charts) | `GET /usercollection/sleep?start_date&end_date` |

All requests use `Authorization: Bearer <access_token>`. Multi-document responses return `{ "data": [...], "next_token": ... }` — handle pagination via `next_token` even though 30-day windows rarely need it.

### Rate limits
Documented at 5,000 requests per 5 minutes — irrelevant at our scale, but the cache (Section 6) keeps us to a handful of upstream calls per day regardless.

### App registration constraint
Oura API applications are limited to 10 users before requiring Oura approval. We have exactly one authorized Oura user (the owner), so this never matters — but do not design anything that would onboard additional Oura accounts.

---

## 4. Access Control Design

Two independent layers. Both must pass.

### Layer 1 — Cloudflare Access (the front door)
- The Worker's route (e.g. `oura.<owner-domain>.com/*`) sits behind a Cloudflare Access application.
- Identity provider: **One-Time PIN** (emailed code — no Google/GitHub setup needed).
- Policy: `Allow` where email is in `[owner email, partner email]`. `[OWNER INPUT]` — collect both emails during setup.
- Session duration: 730 hours (1 month) so the partner isn't re-prompted constantly.

### Layer 2 — JWT validation inside the Worker (defense in depth)
Cloudflare Access forwards a `Cf-Access-Jwt-Assertion` header. The Worker **must validate this JWT on every request** (including static assets is fine, but mandatory for `/api/*` and `/auth/*`):
- Verify signature against the Access team's public keys: `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cache the JWKS in memory).
- Verify `aud` matches the Access application AUD tag (stored as env var `CF_ACCESS_AUD`).
- Verify `iss` matches `https://<team>.cloudflareaccess.com` (env var `CF_ACCESS_TEAM_DOMAIN`).
- Reject with `403` if absent or invalid.

This ensures that even if the Worker URL is somehow reached directly (e.g. `*.workers.dev` default subdomain), it is useless. **Also: disable the `workers.dev` route for this Worker in wrangler config** (`workers_dev = false`) so the only path in is through the Access-protected custom domain.

### Owner-only routes
The OAuth connect flow (`/auth/*`, Section 5) must additionally check that the authenticated email equals the owner's email (env var `OWNER_EMAIL`). The partner can view data but can never (re)connect or disconnect the Oura account.

---

## 5. Oura OAuth Flow (one-time setup by the owner)

Routes on the Worker:

1. **`GET /auth/connect`** (owner only)
   - Generate a random `state`, store in KV with 10-minute TTL (`oauth_state:<state>` → `"1"`).
   - Redirect to `https://cloud.ouraring.com/oauth/authorize?response_type=code&client_id=...&redirect_uri=https://<site>/auth/callback&scope=daily+personal&state=<state>`.

2. **`GET /auth/callback`** (owner only)
   - Validate `state` against KV, delete it (single use).
   - If `error=access_denied`, show a friendly failure page.
   - Exchange `code` at the token endpoint (form-encoded POST with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret`).
   - Persist tokens to KV (Section 6 schema). Redirect to `/`.

3. **`POST /auth/disconnect`** (owner only) — delete the token record from KV.

There is no partner-facing auth flow with Oura. The partner only authenticates to Cloudflare Access.

---

## 6. Storage Schema (Workers KV)

Single KV namespace `OURA_KV`:

| Key | Value | TTL |
|---|---|---|
| `oura_tokens` | `{ access_token, refresh_token, expires_at (epoch ms) }` | none (persistent) |
| `cache:<endpoint>:<start>:<end>` | Raw filtered JSON payload served to the client | 3 hours |
| `oauth_state:<state>` | `"1"` | 10 minutes |

**Token refresh logic** (in a shared `getAccessToken()` helper):
1. Read `oura_tokens`. If absent → return 409 to the client with `{ error: "not_connected" }` (dashboard shows a "Connect Oura" button, visible to owner only).
2. If `expires_at` is more than 5 minutes away, use the access token.
3. Otherwise refresh, persist the new `access_token`, `expires_at`, and **the returned `refresh_token`** (rotation), then proceed.
4. If refresh fails with 401 (revoked), delete `oura_tokens` and return the `not_connected` state.

KV is eventually consistent; with a single user and infrequent refreshes this is acceptable. Do not attempt distributed locking — a duplicate refresh in a rare race is harmless.

---

## 7. API Routes (Worker → browser)

All under `/api/`, all requiring a valid Access JWT. Responses are **shaped/filtered** — never proxy Oura's raw response wholesale.

| Route | Returns |
|---|---|
| `GET /api/summary` | Today's (or latest available) readiness score, sleep score, activity score, steps, total sleep duration, resting HR from daily summaries — one compact object |
| `GET /api/history?days=7\|30` | Arrays of `{ date, readiness, sleep, activity, steps, total_sleep_seconds }` for charting |
| `GET /api/status` | `{ connected: boolean, viewer_is_owner: boolean, last_sync: string }` |

**Field filtering:** define an explicit allowlist of fields copied from Oura responses into API output. Anything not on the allowlist is dropped. This is the mechanism that keeps unshared data unshared — if the owner later grants more scopes, nothing new leaks by default.

**Caching:** check `cache:*` key first; on miss, call Oura, filter, store with 3h TTL, return. Add a `?refresh=1` param (owner only) that bypasses cache.

---

## 8. Frontend

One responsive page, served at `/` by the Worker (embed the HTML/JS as static assets via Workers Assets or inline).

- **Header:** "Josh's Oura" + last-synced timestamp.
- **Today cards:** three large score cards (Readiness / Sleep / Activity) with the score number and a small colored ring/arc; below them, steps, total sleep time (h:mm), resting heart rate.
- **Trends section:** line charts for the three scores plus steps over a 7/30-day toggle.
- **States:** loading skeletons; "not connected" state that shows a *Connect Oura* button only when `viewer_is_owner` is true, and a "Josh hasn't connected his ring yet" message otherwise; graceful "no data for today yet" (Oura data lands only after the ring syncs with the phone app).
- Dark-mode friendly, mobile-first (the partner will mostly open this on a phone).
- No client-side secrets, no localStorage of health data, no analytics.

`[OWNER INPUT]` Confirm dashboard title/names and whether any metric should be excluded from what the partner sees.

---

## 9. Configuration & Secrets

Via `wrangler secret put` (never committed):
- `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`
- `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`
- `OWNER_EMAIL`

In `wrangler.toml`: KV binding `OURA_KV`, custom-domain route, `workers_dev = false`.

---

## 10. Manual Setup Steps (owner does these; document them in the README)

1. Register an OAuth app at `https://cloud.ouraring.com/oauth/applications`; set redirect URI to `https://<site>/auth/callback`; record client ID/secret.
2. In Cloudflare: create the Worker's custom domain/route on the owner's zone.
3. In Cloudflare Zero Trust: add a team domain if none; create an Access application for the site hostname; enable One-Time PIN; add the two-email Allow policy; copy the AUD tag.
4. Set the five secrets; create the KV namespace; deploy with `wrangler deploy`.
5. Visit the site as the owner, pass Access, click *Connect Oura*, approve scopes.
6. Verify the partner's email can log in and sees data; verify a third email is rejected at the Access screen.

---

## 11. Security Requirements (acceptance checklist)

- [ ] Client secret and tokens exist only in Worker secrets/KV; grep the built client bundle to confirm no secret strings.
- [ ] Every `/api/*` and `/auth/*` handler validates the Access JWT (signature, `aud`, `iss`).
- [ ] `workers.dev` subdomain disabled; site reachable only via the Access-protected custom domain (HTTPS enforced by Cloudflare).
- [ ] `/auth/*` routes reject non-owner emails with 403.
- [ ] OAuth `state` is random, single-use, TTL-bound.
- [ ] API responses contain only allowlisted fields.
- [ ] No health data or tokens in `console.log` / Worker logs.
- [ ] Security headers on HTML: `Content-Security-Policy` (self + chart CDN if used), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- [ ] Refresh-token rotation persisted correctly (test by forcing an expired `expires_at`).

---

## 12. Implementation Plan

**Phase 1 — Skeleton:** wrangler project, Hono app, KV binding, Access JWT middleware with tests against a mocked JWKS, static page served.
**Phase 2 — Oura OAuth:** `/auth/connect`, `/auth/callback`, `/auth/disconnect`, token storage + `getAccessToken()` with refresh & rotation. Test with mocked token endpoint.
**Phase 3 — Data API:** the three `/api/*` routes, field allowlist, KV caching, pagination handling.
**Phase 4 — Frontend:** cards, charts, states, mobile polish.
**Phase 5 — Hardening & deploy:** security checklist above, README with the manual setup steps, deploy, end-to-end verification with both users.

Testing: use `vitest` with `@cloudflare/vitest-pool-workers` (or `unstable_dev`) and mock Oura responses; do not hit the live Oura API in tests.
