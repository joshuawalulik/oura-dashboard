---
name: Josh's Oura
description: A night-flight deck for sleep — graphite instrument panels, one burnished-copper accent, B612 cockpit type
colors:
  graphite-void: "#0b0c0e"
  panel-graphite: "#15171a"
  panel-raised: "#1b1e22"
  panel-border: "rgba(255, 255, 255, 0.08)"
  hairline: "rgba(255, 255, 255, 0.09)"
  instrument-white: "#e8eaed"
  text-muted: "rgba(230, 233, 238, 0.66)"
  text-faint: "rgba(230, 233, 238, 0.52)"
  ink-ghost: "rgba(230, 233, 238, 0.32)"
  burnished-copper: "#e0a066"
  copper-deep: "#9c5f28"
  metric-readiness: "#e0a066"
  metric-sleep: "#8fb0d4"
  metric-activity: "#a3b47e"
  status-good: "#7fb8a4"
  status-fair: "#d4b06a"
  status-low: "#cf8771"
  track: "rgba(255, 255, 255, 0.07)"
  chart-grid: "rgba(255, 255, 255, 0.06)"
typography:
  display:
    fontFamily: "B612 Mono, ui-monospace, SF Mono, Cascadia Code, monospace"
    fontSize: "1.4rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  title:
    fontFamily: "B612 Mono, ui-monospace, SF Mono, Cascadia Code, monospace"
    fontSize: "1.05rem"
    fontWeight: 700
    letterSpacing: "0.18em"
  headline:
    fontFamily: "B612 Mono, ui-monospace, SF Mono, Cascadia Code, monospace"
    fontSize: "1.1rem"
    fontWeight: 700
    letterSpacing: "0.14em"
  body:
    fontFamily: "B612, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "B612 Mono, ui-monospace, SF Mono, Cascadia Code, monospace"
    fontSize: "0.7rem"
    fontWeight: 400
    letterSpacing: "0.18em"
  caption:
    fontFamily: "B612 Mono, ui-monospace, SF Mono, Cascadia Code, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
rounded:
  panel: "16px"
  panel-compact: "14px"
  pill: "999px"
  focus: "4px"
spacing:
  sp-1: "0.25rem"
  sp-2: "0.5rem"
  sp-3: "0.75rem"
  sp-4: "1rem"
  sp-5: "1.5rem"
  sp-6: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.copper-deep}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0.7rem 1.7rem"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.instrument-white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0.7rem 1.7rem"
  card:
    backgroundColor: "{colors.panel-graphite}"
    rounded: "{rounded.panel}"
    padding: "1rem 0.5rem"
  stat-row:
    backgroundColor: "{colors.panel-graphite}"
    textColor: "{colors.instrument-white}"
    rounded: "{rounded.panel}"
    padding: "1rem 1.3rem"
  toggle-active:
    backgroundColor: "rgba(224, 160, 102, 0.1)"
    textColor: "{colors.burnished-copper}"
    rounded: "{rounded.pill}"
    padding: "0.65rem 1.05rem"
  link-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-faint}"
    typography: "{typography.caption}"
    padding: "0.6rem 0.75rem"
---

# Design System: Josh's Oura

## Overview

**Creative North Star: "The Night-Flight Deck"**

This is a cockpit instrument for sleep, not a health-tech marketing surface. The whole page is a night-table readout viewed on a phone in a dim bedroom: a near-black graphite ground, milled panel surfaces with hairline bezels, and B612 — the typeface Airbus commissioned for cockpit displays — as the only voice. One burnished-copper lamp is the sole chrome accent; everything else speaks in the three metric identity hues or in quiet ink. The signature form is the 270° tick-gauge dial: an SVG tick ring, a flat track sweeping from 135°, a metric-colored arc, a mono numeral, and a status word resting in the dial's open bottom gap. With all content removed, the dials alone identify the world.

The system refuses both the category default (three equal stat cards above a stock chart block) and its opposite (glowing neon glassmorphism). It is dark-only by design — there is no light mode and no `prefers-color-scheme` branch — and nothing on the page is allowed to look like an alarm. Status at its worst is a muted terracotta word at instrument-lamp intensity, never a red number. Density is calm: a single 42rem column, generous panel spacing, one story per glance.

**Key Characteristics:**
- Dark-only graphite flight deck (#0b0c0e ground, #15171a panels), fixed 3% SVG grain texture
- Hue encodes metric identity everywhere — copper readiness, dim-blue sleep, olive activity — in dials and charts alike
- One copper chrome accent (#e0a066); status is a quiet word on an amber floor, never alarm red
- B612 for prose, B612 Mono (tabular) for every number, label, and placard; both self-hosted under strict CSP
- Milled surfaces: flat fills, hairline borders, one inset top highlight — no blur, no glow, no glass

## Colors

A graphite ground with three metric identity hues, one copper chrome lamp, and an amber-floored status trio — every color is dim enough for a dark bedroom.

### Primary
- **Burnished Copper** (#e0a066): the single chrome accent — the placard underline, focus ring, active toggle lamp, and document links. It is also the readiness metric's identity hue; readiness being the lead metric is why it shares the accent.
- **Copper Deep** (#9c5f28): the pressed/filled form of copper — primary button fill and text selection background.

### Secondary (metric identity)
- **Dim Signal Blue** (#8fb0d4): the sleep metric, in its dial arc, chart line, chart fill (at 10% alpha), and series-key swatch.
- **Instrument Olive** (#a3b47e): the activity metric, same assignments.

### Tertiary (status lamps)
- **Lamp Green** (#7fb8a4): the "Good" status word (score ≥ 85). Desaturated to lamp intensity.
- **Lamp Amber** (#d4b06a): the "Fair" status word (70–84).
- **Lamp Terracotta** (#cf8771): the "Low" status word (< 70) and the armed disconnect button. This is the floor — the warmest color the page is permitted.

### Neutral
- **Graphite Void** (#0b0c0e): the page ground, under a faint top radial sheen and a fixed 3% fractal-noise grain.
- **Panel Graphite** (#15171a): every card, stat row, chart box, and notice surface.
- **Panel Raised** (#1b1e22): the chart tooltip surface — the only step above panel level.
- **Instrument White** (#e8eaed): primary text and gauge numerals.
- **Muted Ink** (rgba(230, 233, 238, 0.66)): labels, prose on panels, chart axis ticks. Stays ≥ 4.5:1 on the ground.
- **Faint Ink** (rgba(230, 233, 238, 0.52)): the sync stamp, footer links, version stamp, empty-dial numerals. Still text, still ≥ 4.5:1.
- **Ghost Ink** (rgba(230, 233, 238, 0.32)): decoration only, never text.
- **Hairline** (rgba(255, 255, 255, 0.09)): section rules; **Panel Border** (rgba(255, 255, 255, 0.08)): panel bezels.
- **Track** (rgba(255, 255, 255, 0.07)) and **Chart Grid** (rgba(255, 255, 255, 0.06)): gauge tracks and chart y-grid.

### Named Rules
**The Metric Identity Rule.** Hue encodes metric identity everywhere — readiness is copper, sleep is blue, activity is olive — in dials, chart lines, swatches, and tooltip rows alike. Score status is carried by a quiet word in the dial's bottom gap; it never recolors the numeral or the arc.

**The Amber Floor Rule.** No alarm red anywhere. The status ramp bottoms out at muted terracotta (#cf8771) at instrument-lamp intensity. A bad night reads as a dim lamp, not a siren.

**The One Lamp Rule.** Burnished copper is the only chrome accent. No second accent color may appear on chrome — buttons, focus, active states, and links all speak copper or stay neutral.

## Typography

**Body Font:** B612 (with -apple-system, Segoe UI, Roboto fallback) — self-hosted woff2, latin subset
**Label/Mono Font:** B612 Mono (with ui-monospace, SF Mono fallback) — self-hosted woff2

**Character:** The Airbus cockpit face: engineered for legibility at small sizes in low light. B612 carries sentences; B612 Mono carries every number, label, placard, and heading. The pairing reads as instrumentation, not editorial.

### Hierarchy
- **Display** (700, 1.4rem, B612 Mono, tabular-nums, -0.01em): stat values like "7h 32m". The gauge numeral is its SVG sibling (font-size 28 in a 100-unit viewBox, 700).
- **Title** (700, 1.05rem, B612 Mono, uppercase, 0.18em tracking): the site placard ("Josh's Oura"), underlined by a 2.25rem × 2px copper bar. Drops to 0.95rem under 480px.
- **Headline** (700, 1.1rem, B612 Mono, uppercase, 0.14em): section headings ("Trends").
- **Body** (400, 0.95rem, B612, line-height 1.65 on doc pages): prose, notices, buttons. Never uppercase, never tracked.
- **Caption** (400, 0.8rem): secondary UI — footer links, toggle buttons, back links.
- **Label** (400, 0.7rem, B612 Mono, uppercase, 0.18em, muted ink): card headings, stat labels, chart titles, the date placard, the version stamp. Status words use it at 0.22em (large dial) / 0.14em (small dials) with matching text-indent for optical centering.

### Named Rules
**The Mono Numeral Rule.** Every number on the surface — gauge numerals, stat values, sync stamps, chart ticks, tooltips, the version stamp — is B612 Mono with `font-variant-numeric: tabular-nums`. Prose is never mono.

**The Six Sizes Rule.** The `--fs-*` ramp (0.7 / 0.8 / 0.95 / 1.05 / 1.1 / 1.4rem) is the only set of font sizes on the surface. New text picks the nearest existing step.

## Layout

A single centered column, `max-width: 42rem`, with 1.25rem side padding (respecting `env(safe-area-inset-top)`) — a night-table readout, never a multi-column dashboard. Spacing follows the `--sp-*` ramp (0.25 / 0.5 / 0.75 / 1 / 1.5 / 2.5rem); sections separate with `--sp-6` (2.5rem) and a 1px hairline rule.

The Today cluster is the instrument panel: a single column on phones (primary readiness dial full-width, then a 2-up row of sleep/activity dials), switching at 560px to a 3fr/2fr grid with the readiness dial left and the two small dials stacked right. Dials reserve their square via `aspect-ratio: 1` before data arrives so there is no skeleton-to-data jump: 158px primary / 96px secondary, compacting to 140px / 86px under 480px. Chart canvases sit in fixed-height positioned parents (250px scores / 190px sleep; 220px / 170px under 480px). The page ends quietly: footer hairline, faint legal links, mono version stamp, then the disconnect control resting last and faint.

## Elevation & Depth

Depth is machined, not lit. Panels use one recipe — flat `#15171a` fill, 1px `rgba(255,255,255,0.08)` bezel, a 1px inset top highlight (`rgba(255,255,255,0.05)`), and one ambient drop shadow — so every surface reads as a milled plate set into the deck. The only raised step is the chart tooltip (`#1b1e22`). There is no blur, no glow, no backdrop-filter anywhere.

### Shadow Vocabulary
- **Panel shadow** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 28px rgba(0, 0, 0, 0.3)`): the single ambient shadow, applied with the inset highlight on every card, stat, chart box, and notice.

### Named Rules
**The Milled Surface Rule.** Every panel is the same recipe: flat fill, hairline bezel, one inset top highlight, one ambient shadow. No blur, no glow, no gradient fills — a milled surface, not glass.

## Shapes

Instrument geometry: panels are rounded rectangles at 16px (14px under 480px); all interactive pills — buttons, the range toggle, toggle segments — are fully round (999px). The signature silhouette is the 270° dial: a tick ring at radius 47 (minor ticks to 44.5, major ticks at 0/25/50/75/100 to radius 42), a 6-unit round-capped track at radius 37 sweeping 270° from 135°, and the value arc over it. Small dials (≤12 ticks) use heavier tick strokes (1.4/2 units vs 0.9/1.4) so ticks stay crisp at ~96px rendered size. Hairlines (1px at 8–9% white) do all structural separation; the focus ring is a 2px copper outline offset 3px with a 4px radius.

## Components

### Buttons
- **Shape:** full pill (999px radius)
- **Primary:** copper-deep fill (#9c5f28), white text, B612 700, 0.7rem × 1.7rem padding, 1px rgba(255,255,255,0.1) border. Used only for the connect action.
- **Hover / Focus:** `filter: brightness(1.12)` on hover; active scales to 0.98 and dims to 0.94; focus is the global copper outline.
- **Ghost:** rgba(255,255,255,0.06) fill with the panel border and instrument-white text; hover brightens the fill to 0.1. Used for retry actions.
- **Link buttons:** borderless, faint-ink, underlined (3px offset), 0.8rem B612; hover lifts to muted ink. The danger variant (disconnect) arms on first click — turning lamp-terracotta, bold, double-underlined — and fires only on a second click within 8s.

### Range Toggle
- **Style:** a pill group (3px padding, panel border) of mono 0.8rem pill buttons; inactive segments are transparent with muted ink.
- **Active:** lamp intensity, not a call to action — rgba(224,160,102,0.1) fill, rgba(224,160,102,0.35) border, copper text, 700 weight.
- **Hover / Active press:** inactive hover brightens to rgba(255,255,255,0.06); press scales 0.97.

### Cards / Containers
- **Corner Style:** 16px (14px under 480px)
- **Background:** panel graphite (#15171a)
- **Shadow Strategy:** the single panel recipe (see Elevation & Depth)
- **Border:** 1px rgba(255,255,255,0.08)
- **Internal Padding:** cards 1rem × 0.5rem centered; stat rows 1rem × 1.3rem as label/value flex rows; chart boxes 1rem with a 0.75rem bottom; notices 2.5rem × 1.5rem centered.

### Navigation
- **Header:** a cockpit placard, not a masthead — mono uppercase title with the copper underline bar left, faint mono "Updated" stamp right, closed by a hairline. Footer links are faint ink, no underline at rest, underline on hover.

### Charts (Chart.js, restyled)
- Stock chrome never ships: legends off (series named in the section header via 0.9rem × 2px swatch lines), tooltips restyled to panel-raised with hairline border, mono 11/12px type, 10px corner radius, no color boxes; each tooltip row's text takes its series color. Axis ticks are muted mono 10px; x-grid off; y-grid at 6% white with no axis border. Scores y-axis pins 40–100 (step 20) so a routine dip reads as a dip, not a cliff; 30-day lines drop point dots (radius 0, 1.5px line).

### The Tick-Gauge Dial (signature)
A 270° instrument dial drawn in SVG (100-unit viewBox): a functional tick ring (20 ticks primary, 8 secondary; majors at quarter marks, round caps) whose ticks light with the score — lit ticks at 72%/46% white alpha up to the score's position, the remainder dim at 26%/13% — plus a needle: one longer, metric-colored tick (radius 48.4→40.8, heavier stroke on small dials) at the score's exact angular position, fading in as the sweep arrives (~550ms after each dial's stagger delay). Under the ring, a round-capped 6-unit track at `--track` and a metric-colored value arc that sweeps in via a 0.9s `cubic-bezier(0.16,1,0.3,1)` dash-offset transition (staggered 0/120/240ms across the cluster). The score is a centered mono numeral that counts up 0→score in step with the sweep (same 900ms, ease-out-expo, tabular digits; skipped entirely under reduced motion, and it runs only on initial render and manual refresh — never on the range toggle). The status word — uppercase mono label in its status-lamp color — rests in the dial's open bottom gap, and beneath the dial a delta line reads the score against its trailing 7-day mean: CSS-drawn direction triangle and signed mono value in the metric's identity hue, faint "vs avg" after it ("– on avg" when flat; empty, height reserved, when fewer than 3 prior days have data). Empty state: faint "–" numeral, dim ring, no arc, no needle, no status word, no delta.

### Vitals Tiles
A 3-up grid of compact milled-panel readouts directly under the dial cluster: resting heart rate (`55 bpm`), nightly HRV (`41 ms`), and body-temperature deviation (signed, `+0.2°`). Each tile is the standard panel recipe with centered content — an uppercase mono label on top (0.7rem, 0.18em tracking, easing to 0.1em under 480px so "RESTING HR" fits a ~100px tile) and a B612 Mono 700 value at 1.4rem with tabular numerals; bpm/ms units trail in 0.8rem muted ink while the degree sign stays in the numeral. Signed values use ASCII `+`/`-` (the latin subset has no U+2212, same reason the delta arrows are CSS-drawn). Missing data shows the en-dash placeholder, like the time-asleep stat. Visible text is aria-hidden; a visually-hidden sibling carries the spoken form ("Resting heart rate: 55 beats per minute" / "no data yet").

### Readiness Heatmap
A single row of day lamps above the trend charts: one rounded square per day (inline SVG, 10-unit cells with 3-unit gaps, 2.5-unit radius, capped at 16px rendered height and left-aligned so a short range reads as a few small lamps, never stretched slabs). Each filled cell takes its day's status-lamp color — the one surface where the status colors, not metric identity hues, do the talking, because each cell *is* a status word made visible; the Amber Floor Rule still holds. Days without a readiness score are outline-only cells (14% white hairline, no fill). The strip always shows the fullest range fetched this visit (30 days stay once seen, whatever the toggle says). The panel header is the standard chart-head: mono label ("READINESS – LAST 30 DAYS") left, and a series-key-style count legend right (square 0.55rem swatches in the status colors, only non-zero bands listed). Each cell carries a native `<title>` tooltip ("Oct 12: 82 (Fair)" / "Oct 31: no data"); the SVG is `role="img"` with a summary label ("30-day readiness: 12 good, 12 fair, 3 low, 3 missing days."). Static — no animation, nothing to reduce.

### Skeletons
- A calm opacity pulse (rgba(255,255,255,0.05) overlay, 1.6s ease-in-out), never a shimmer sweep. Under `prefers-reduced-motion` it freezes at 0.6 opacity.

## Do's and Don'ts

### Do:
- **Do** give every number B612 Mono with tabular numerals; keep prose in B612 and never mono.
- **Do** carry metric identity by hue everywhere — readiness #e0a066, sleep #8fb0d4, activity #a3b47e — in dials, chart lines, keys, and tooltips alike.
- **Do** render status as a quiet uppercase word at lamp intensity in the dial's bottom gap (The Amber Floor Rule).
- **Do** build every new surface on the milled-panel recipe: #15171a fill, 1px bezel, inset top highlight, the one panel shadow, 16px radius.
- **Do** keep the single 42rem column and the `--sp-*` / `--fs-*` ramps; self-host every font under the strict CSP (no external origins; all styles in styles.css).
- **Do** honor `prefers-reduced-motion`: drop the arc sweep, skeleton pulse, and press transforms while keeping feedback legible.

### Don't:
- **Don't** use alarm red anywhere; the status ramp bottoms out at #cf8771 (The Amber Floor Rule).
- **Don't** add a second chrome accent; copper is the only lamp on chrome (The One Lamp Rule).
- **Don't** recolor a numeral or arc by status — status is a word, never a floodlight.
- **Don't** use blur, glassmorphism, neon glow, gradient fills on panels, or any light mode; the world is dark-only milled graphite.
- **Don't** ship stock Chart.js chrome — no legend boxes, default tooltips, or default grid; restyle per the Charts spec.
- **Don't** add inline styles, external stylesheets, or remote fonts; the CSP forbids them.
