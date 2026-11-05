# Dashboard roadmap

Each group below is meant to run as its own session on its own branch, landing
as a PR (never direct to main — main auto-deploys). House rules for every
session: no AI attribution anywhere (commits, PRs), run `npm test` before
opening the PR, and keep the CSP intact — zero third-party origins, everything
self-hosted.

> Unplanned extra, also done: PII/security review + hardening (PR #4, merged
> and deployed — dev-bypass guard, CSRF origin check, log truncation,
> HSTS/form-action headers, SHA-pinned actions, scoped CI deploy token).

**Order:** Group 1 lands first (it restyles every surface the other groups
would touch). Groups 2 and 3 both edit `public/app.js` / `public/index.html`,
so run them serially or accept a merge. Group 4 is independent enough to run
any time after 1.

**Differentiation arc (groups 5–8):** the goal is that this reads as a
privacy-first health data *product* — own data store, own analytics, built
for two people — not an Oura reskin. Group 6 is the substance and lands
next; group 7 builds on 6's store for alerting; group 8 is the write-up and
polish once there's something to show. Every group keeps the demo honest:
whatever the real site gains, `src/demo.ts` must synthesize too, so the
public demo always shows the full product.

---

## 1. Impeccable UI redo — ✅ done (PR #3, merged)

Full visual redo of the dashboard driven by the impeccable skill.

- [ ] `npx impeccable install --providers=claude --scope=project` first —
      `.claude/` is gitignored, so fresh worktrees don't inherit the install
- [ ] `/impeccable init` → PRODUCT.md (private 2-person night-table health
      readout; dark-only; iPhone-first at 42rem max)
- [ ] `/impeccable document` → DESIGN.md capturing the current instrument-panel
      system (graphite panels, burnished-copper accent, mono numerals, tick bezel)
- [ ] `/impeccable critique` the dashboard, then redo visuals from its findings
      (`typeset`, `layout`, `animate`, `delight` as needed)
- [ ] Restyle Chart.js away from stock defaults: dark panel tooltips, mono
      tick labels, no default legend boxes
- [ ] Finish with `/impeccable polish` + `/impeccable audit`; detector clean
      (`npx impeccable detect public/` and against the dev server URL)

Files: `public/styles.css`, `public/index.html`, `public/app.js`,
`public/privacy.html`, `public/terms.html`, `public/favicon.svg`

## 2. Instrument readouts — ✅ done (PR #5, merged)

Make the instrument metaphor functional. Frontend only; history data is
already in the `/api/dashboard` payload.

- [ ] Delta vs 7-day average under each score (`▲ +4 vs avg`, copper, mono)
- [ ] Functional bezel: single longer copper needle tick at the score's
      position; ticks up to the score render brighter than the rest
- [ ] Odometer count-up: score numeral ticks from 0 in sync with the arc
      draw-in (~900 ms), skipped under `prefers-reduced-motion`

Files: `public/app.js`, `public/styles.css`

## 3. New vitals — ✅ done (PR #6, merged)

Change what the dashboard shows: resting HR, HRV, body temp deviation.

- [ ] Extend the Oura API client (`src/oura.ts`) and the field allowlist
      (`src/filter.ts`) for resting heart rate, HRV, and temperature deviation
- [ ] Bump/invalidate the KV cache shape so stale cached payloads don't miss
      the new fields
- [ ] Vitals row of stat tiles under the rings (`RHR 52 · HRV 41 · TEMP +0.2°`),
      mono numerals, matching panel style
- [ ] Tests: filter allowlist covers the new fields and still strips
      everything else (`test/filter.test.ts`)

Files: `src/oura.ts`, `src/filter.ts`, `src/routes/api.ts`, `src/types.ts`,
`public/app.js`, `public/index.html`, `public/styles.css`, `test/`

## 4. Platform & density — ✅ done (PR #7, merged)

- [ ] PWA: self-hosted `manifest.webmanifest` + apple-touch-icon, standalone
      display so it launches full-screen from an iPhone home icon (CSP:
      everything stays same-origin; add `manifest-src 'self'` if needed)
- [ ] 30-day readiness heatmap strip: row of small squares colored by score
      band (contributions-graph style) above the trend charts

Files: `public/` (new manifest + icons), `public/index.html`,
`public/app.js`, `public/styles.css`, `src/index.ts` (headers/content-type
for the manifest if needed)

## 5. Public demo — ✅ done (PR #9, merged)

A recruiter-viewable demo at oura-demo.joshuawalulik.com: a separate Worker
environment (`wrangler deploy --env demo`) with `DEMO_MODE=1` serving
deterministic synthetic data from `src/demo.ts` — no Access in front, no
KV/secrets behind, OAuth routes 404, banner on the page, CI deploy +
inverted smoke test (must answer *without* auth), hourly uptime probe.

## 6. Own the data: longitudinal store + insights — ✅ done (PR #11, merged)

The sleep pattern landed as sleep length vs the next night's HRV
rather than vs readiness, because Oura builds readiness partly from sleep.

The "not a reskin" move: stop being a cached proxy, start owning history
and computing things Oura's app doesn't show.

- [x] D1 database (`[[d1_databases]]` in wrangler.toml) with a `days` table
      mirroring the `DayRecord` shape; migrations checked in
- [x] Nightly ingest: a `[triggers]` cron + `scheduled()` handler upserts the
      last ~7 days of filtered Oura data into D1 (idempotent, so late ring
      syncs self-heal); manual `/api/ingest?backfill=365` owner route to
      backfill history once
- [x] Baselines: 28-day rolling mean and σ per metric, computed in SQL or in
      the Worker; serve `vs baseline` z-scores in `/api/dashboard` and show
      them where the 7-day deltas live today (e.g. "HRV 1.8σ below your norm")
- [x] Correlations: sleep length vs the next night's HRV, day-of-week
      effects — a small "Patterns" panel with 2–3 honest, computed sentences
      (no LLM, no fabrication; each must clear a shuffle test at p < 0.01)
- [x] Bedtime correlation: bedtime vs that night's HRV, with bedtime stored as
      minutes from local midnight
- [x] Demo parity: `src/demo.ts` synthesizes the same insights payload so the
      public demo shows the Patterns panel and baselines
- [x] Tests: ingest idempotency, baseline math against fixtures, correlation
      windows with missing days
- [x] KV keeps its role (tokens + 3h response cache); D1 is history only

Files: `wrangler.toml`, `src/ingest.ts` (new), `src/insights.ts` (new),
`src/routes/api.ts`, `src/demo.ts`, `src/types.ts`, `public/app.js`,
`public/index.html`, `public/styles.css`, `test/`

## 7. Built-for-two: Web Push alerts (after 6)

Lean into the two-person product. Self-hosted push from the Worker — VAPID
keys as Worker secrets, no Firebase, CSP stays zero-third-party.

- [ ] Service worker (`public/sw.js`) + push subscription flow; subscriptions
      stored in KV keyed by viewer role, opt-in from the footer
- [ ] Alert rules evaluated by the nightly cron (group 6's handler): ring
      hasn't synced in 24h; readiness below a quiet threshold; temperature
      deviation sustained ≥ 2 days — copy stays calm, never alarm-toned
- [ ] Owner/partner scoping: each person subscribes their own devices; either
      can mute a rule for themselves
- [ ] Demo parity: demo shows the opt-in UI in a disabled "demo" state
- [ ] Tests: subscription storage, rule evaluation against fixture history,
      push payload shape (push delivery mocked)

Files: `public/sw.js` (new), `public/app.js`, `public/index.html`,
`public/styles.css`, `src/push.ts` (new), `src/ingest.ts`, `src/routes/`,
`wrangler.toml`, `test/`

## 8. Tell the story (after 6, ideally after 7)

Recruiters read READMEs, not `src/`.

- [ ] Screenshots (light on bytes, from the demo) + a short GIF at the top
      of the README, next to the demo link
- [ ] `docs/case-study.md`: why there's no login page, testing in real
      `workerd`, the fails-closed CI pipeline, and the demo's
      inverted-trust design — diagrams and real numbers, no marketing voice
- [ ] README: reframe the opening paragraph around "privacy-first health
      data product for two people" with the insights pipeline up front
- [ ] Repo description + topics on GitHub so it surfaces in searches

Files: `README.md`, `docs/case-study.md` (new), `docs/img/` (new)

## 9. Show the evidence (after 6)

Oura already covers a lot here: Symptom Radar reads more signals than a simple
rule could, and it has its own tag discoveries and experiments. What it doesn't
do is show the numbers behind a personal result, or reach someone without a
ring. So the pitch is that this dashboard shows its evidence.

- [x] Show the math: every tested pattern carries its comparison, effect size,
      minimum, and shuffle result, and tested ideas with no clear link are
      listed alongside the ones found
- [ ] Personal experiments: any habit and date range, reported with the same
      evidence, including "no clear effect"
- [ ] Multi-signal partner alert: a trigger for group 7, not a detector to rival
      Symptom Radar

Files: `src/insights.ts`, `src/ingest.ts`, `public/app.js`, `public/index.html`,
`public/styles.css`, `test/`
