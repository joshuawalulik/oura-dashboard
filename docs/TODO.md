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
