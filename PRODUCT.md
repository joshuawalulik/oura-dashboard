# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Exactly two people: Josh (the owner, whose Oura Ring supplies the data) and
his partner. Both reach the site through a Cloudflare Access email-OTP
allowlist; nobody else can load it. Primary situation: a quick glance on an
iPhone — often at night or first thing in the morning — to answer "how did
I/he sleep, how recovered is he today?" Desktop viewing is secondary.

## Product Purpose

A private night-table health readout. It shows today's Oura readiness,
sleep, and activity scores, time asleep, and 7/30-day trends — nothing more.
Success is a calm, legible, instantly scannable reading; it is an instrument,
not a marketing page or a product for an audience.

## Positioning

A single-purpose, self-hosted sharing surface for one couple's Oura data:
serverless (Cloudflare Worker + KV), zero third-party origins, zero
analytics, field-allowlisted API responses. Nothing a general health app
could truthfully copy, because the product *is* its privacy posture.

## Operating Context

- Viewed mostly on an iPhone, single column, max-width 42rem; dark rooms
  and dim light are the normal viewing environment.
- Data arrives from the Oura API v2 via the Worker (`/api/dashboard`,
  `/api/history`), cached up to 3 hours in KV; the ring may not have synced
  yet, so "no data yet" is a routine state, not an error.
- Local development (`npx wrangler dev --port 8787`) usually has no Oura
  tokens, so the not-connected state is what dev normally shows.

## Capabilities and Constraints

- States that must all keep working: not-connected (owner vs. viewer copy),
  error + retry, loading skeletons, "no data yet" rings, two-step disconnect
  arming, 7/30-day history toggle, owner-only refresh/disconnect controls.
- Strict CSP: `default-src 'self'` — no inline styles or scripts, no
  external origins of any kind (no webfont CDNs; fonts are system or
  self-hosted). Chart.js is self-hosted in `public/vendor/`.
- Frontend is vanilla HTML/CSS/JS served from `public/` by the Worker; no
  build step for the frontend.
- Dark-only by design (night-table readout); `prefers-reduced-motion` must
  be respected.
- Roadmap (TODO.md on main): later groups add vitals data, instrument
  interactions, and PWA support on top of this visual system.

## Brand Commitments

- No external brand; the page is titled "Josh's Oura". Tone is quiet,
  factual, first-person-private.
- The visual direction is explicitly open to replacement (Josh asked for a
  visible redo), but it must remain dark, calm, and data-first.

## Evidence on Hand

- Real data shapes come from the Oura API (scores 0–100, sleep seconds);
  no fabricated testimonials, metrics, or marketing claims exist or may be
  invented. Legal pages (`public/privacy.html`, `public/terms.html`) state
  factual privacy/terms copy that must stay truthful.

## Product Principles

1. Glanceable first: the day's readiness answer lands within one second,
   before any scrolling or reading.
2. Calm over clever: no motion, color, or ornament that competes with the
   numbers; delight shows up as precision.
3. Dark, dim-light native: contrast tuned for a dark bedroom, never a
   white flash.
4. Private by construction: no third-party origins, no analytics, CSP
   stays strict — design decisions may never loosen it.
5. Honest states: syncing gaps, disconnection, and errors are first-class
   designed states, not afterthoughts.

## Accessibility & Inclusion

Respect `prefers-reduced-motion` everywhere. Score rings carry ARIA labels
("Score N out of 100"). Keyboard focus must stay visible on the dark ground.
No product-specific standard beyond that is mandated.
