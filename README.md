# Josh's Oura — Partner Dashboard

[![CI](https://github.com/joshuawalulik/oura-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/joshuawalulik/oura-dashboard/actions/workflows/ci.yml)

A small, private website that lets exactly two people (Josh and his partner)
view Josh's Oura Ring stats. One Cloudflare Worker (Hono + TypeScript) serves
the dashboard and a filtered API; Cloudflare Access (email one-time PIN,
two-address allowlist) is the front door; Workers KV stores the Oura OAuth
tokens and response cache. See
[oura-partner-dashboard-spec_1.md](oura-partner-dashboard-spec_1.md) for the
full design.

**What it shows:** readiness, sleep, and activity scores plus total sleep
time, for today and the last 7/30 days.
**Deliberately excluded** (owner decision, 2026-07-07): steps and resting
heart rate. The OAuth grant requests `personal daily workout` scopes; workout
data is not displayed yet but the scope is granted so it can be added without
reconnecting.

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Worker entry: security headers, Access JWT middleware, routing |
| `src/access.ts` | Cloudflare Access JWT validation (JWKS, signature, aud, iss) |
| `src/oura.ts` | Oura OAuth token refresh/rotation + paginated data fetching |
| `src/filter.ts` | Field allowlists — the only path data takes to the browser |
| `src/routes/auth.ts` | Owner-only `/auth/connect`, `/auth/callback`, `/auth/disconnect` |
| `src/routes/api.ts` | `/api/summary`, `/api/history?days=7\|30`, `/api/status` (KV-cached, 3h) |
| `public/` | Static dashboard (vanilla JS + Chart.js from jsDelivr) |
| `test/` | Vitest (`@cloudflare/vitest-pool-workers`) — no live Oura calls |

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in values; keep ACCESS_DEV_BYPASS=1
npm run dev                      # wrangler dev
npm test
```

`ACCESS_DEV_BYPASS=1` skips Access JWT validation (there is no Access in front
of `wrangler dev`) and treats you as the owner. **Never set it in production.**

## One-time production setup

1. **Oura developer account + project** — new apps can no longer be created
   at the old `cloud.ouraring.com/oauth/applications` page (it only edits
   pre-existing ones). Use the new **Oura Developer Portal** at
   <https://developer.ouraring.com>:
   1. *Prerequisites:* an Oura account signed into a recent version of the
      mobile app, and — for Gen3 / Oura Ring 4 — an **active Oura
      Membership** (per [Oura's API support article](https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API),
      the API returns no data for Gen3/Ring4 accounts without a membership).
   2. Sign in at the portal with your Oura account and complete the
      first-time developer onboarding it walks you through (developer
      profile / terms acceptance) — the portal requires this before a
      project can be created.
   3. The site's hostname is `oura.joshuawalulik.com` (already set in
      `wrangler.toml`) — the form wants several URLs on it.
   4. Under **Applications → New Application**, fill in:
      | Field | Value |
      |---|---|
      | Display Name | `Josh's Oura` (shown on the Oura consent screen) |
      | Description | `Private dashboard showing my Oura stats to me and my partner` |
      | Contact Email | your email |
      | Website | `https://oura.joshuawalulik.com/` |
      | Privacy Policy | `https://oura.joshuawalulik.com/privacy` (served by this app) |
      | Terms of Service | `https://oura.joshuawalulik.com/terms` (served by this app) |
      | Redirect URIs | `https://oura.joshuawalulik.com/auth/callback` |
   5. **Scopes:** the form pre-checks every scope. Uncheck everything except
      **Personal**, **Daily**, and **Workout** (this app requests exactly
      those; leaving extras checked only widens what the app *could* ask
      for).
   6. Create the application and copy the **Client ID** and **Client
      Secret** immediately — secrets are typically shown only once.

   Note: the privacy/terms pages sit behind Cloudflare Access like the rest
   of the site. That's fine for a two-person app — only you two ever see the
   consent screen that links to them.

   The OAuth endpoints themselves are unchanged (authorize at
   `cloud.ouraring.com/oauth/authorize`, tokens at
   `api.ouraring.com/oauth/token`), so no code changes are needed.
   (Personal access tokens were deprecated by Oura in Dec 2025; OAuth2 is
   required.)
2. **Custom domain** — `oura.joshuawalulik.com` is configured as a custom
   domain route in [wrangler.toml](wrangler.toml); Cloudflare creates the
   DNS record and certificate automatically on first deploy. Your portfolio
   on the zone's other records is untouched. `workers_dev = false` stays as
   is so the Worker is *only* reachable through the Access-protected domain.
3. **Cloudflare Access** — in Zero Trust:
   - Create a team domain if you don't have one (`<team>.cloudflareaccess.com`).
   - Add an Access application for the hostname from step 2 with session
     duration 730 hours.
   - Identity provider: **One-Time PIN**.
   - Policy: *Allow* → *Emails* → exactly the two addresses (owner + partner).
   - Copy the application **AUD tag**.
4. **KV + secrets + deploy**
   ```sh
   npx wrangler kv namespace create OURA_KV   # put the id in wrangler.toml
   npx wrangler secret put OURA_CLIENT_ID
   npx wrangler secret put OURA_CLIENT_SECRET
   npx wrangler secret put CF_ACCESS_AUD          # AUD tag from step 3
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN  # e.g. myteam.cloudflareaccess.com
   npx wrangler secret put OWNER_EMAIL            # owner's email, lowercase
   npx wrangler deploy
   ```
5. **Connect Oura** — visit the site as the owner, pass the Access email PIN,
   click *Connect Oura*, approve the scopes.
6. **Verify** — the partner's email can log in and sees data; a third email
   is rejected at the Access screen; `https://<worker>.workers.dev` does not
   resolve.

## Why there's no custom login page

Deliberate design decision: this app never sees a password and has no login
form, sign-up flow, or session store of its own. Identity is delegated to
Cloudflare Access (email one-time PIN against a two-address allowlist), and
the Worker independently *verifies* that identity on every request by
validating the `Cf-Access-Jwt-Assertion` JWT — RS256 signature against the
team's published JWKS, plus `aud`, `iss`, and expiry checks
([src/access.ts](src/access.ts)).

Rolling custom auth here would mean owning password storage, hashing,
resets, rate limiting, session revocation, and phishing surface — all to
protect two users, and all strictly worse than the battle-tested edge auth
we get for free. "Don't build your own auth when a stronger primitive
exists" *is* the production-grade choice; the engineering work lives in the
JWT verification layer and the owner/partner authorization split on top of
it.

## CI/CD

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)):

- **Every push & PR:** typecheck (`tsc --noEmit`) + the full vitest suite
  (runs in `workerd` via `@cloudflare/vitest-pool-workers`, with Oura and
  Access JWKS endpoints mocked — no live calls).
- **Merge to `main`:** deploys to Cloudflare via `wrangler-action`, then
  smoke-tests the live site, asserting unauthenticated requests are turned
  away (302 to Access or 403) — proving the deploy is up *and* fails closed.

Requires two repository secrets: `CLOUDFLARE_API_TOKEN` (custom token with
Workers Scripts:Edit + Workers KV Storage:Edit) and `CLOUDFLARE_ACCOUNT_ID`.

## Security model (summary)

- Two independent gates: Cloudflare Access at the edge, **and** the Worker
  validates the `Cf-Access-Jwt-Assertion` JWT (signature against the team
  JWKS, `aud`, `iss`, expiry) on every request.
- `/auth/*` additionally requires the authenticated email to equal
  `OWNER_EMAIL` — the partner can view, never (re)connect or disconnect.
- Oura credentials live only in Worker secrets and KV. The browser receives
  only fields on an explicit allowlist (`src/filter.ts`); everything else in
  Oura responses is dropped by default.
- OAuth `state` is random, single-use, and expires after 10 minutes.
- Refresh-token rotation is persisted; a revoked token degrades cleanly to
  the "not connected" state.
- Security headers on every response: CSP (`self` + jsDelivr for Chart.js),
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`.
- No health data or tokens are ever logged.
