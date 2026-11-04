---
target: the dashboard (public/index.html)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/joshuawalulik/Repos/OuraRing/.claude/worktrees/eager-pike-c063e6/public/index.html"
target_fingerprint: "sha256:8950e169d4180eca8f23208cfef06a0f344a01ce37ced232a0562d05d417396a"
target_path: /Users/joshuawalulik/Repos/OuraRing/.claude/worktrees/eager-pike-c063e6/public/index.html
timestamp: 2026-11-04T01-16-01Z
slug: public-index-html
---
# Critique: Josh's Oura dashboard

Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No in-flight feedback on refresh/toggle; "Updated …" stamp at ~2.8:1 |
| 2 | Match System / Real World | 3 | "7:42" ambiguous (clock vs duration) |
| 3 | User Control and Freedom | 3 | Two-step disconnect good; range not in URL |
| 4 | Consistency and Standards | 3 | Readiness copper in Trends vs status color on ring; indigo fill leftover |
| 5 | Error Prevention | 4 | Armed disconnect, viewer/owner split, 409 distinction |
| 6 | Recognition Rather Than Recall | 4 | Everything labeled in place |
| 7 | Flexibility and Efficiency | 3 | Instant cached range switches; no deep link, no staleness hint |
| 8 | Aesthetic and Minimalist Design | 3 | 30-day chart spaghetti; "No data yet" ×4 in empty state |
| 9 | Error Recovery | 2 | Trends fetch failure hides the whole dashboard (showError hides #today) |
| 10 | Help and Documentation | 2 | 85/70 color thresholds never explained |
| **Total** | | **29/40** | **Good** |

## Design Specificity Verdict

LLM: authored, not interchangeable (tick bezel, mono tabular numerals, single copper accent, etched panels). The generic 40% is Trends: stock Chart.js legends/tooltips and leftover indigo fill rgba(99,102,241,0.12) at app.js:192, all banned by DESIGN.md.

Detector: 20 findings (3 warnings, 17 advisories). Warnings = skeleton shimmer flagged as marquee (false positives). Advisories: 11 font-size literals + #f3a89d ×2 outside the documented system (no real type ramp); grain flagged as stripes (intentional). Overlay confirmed 3 text elements at 2.8:1 (last-sync, Refresh data, version stamp) — found independently by both assessments.

## Priority Issues

- [P1] Trends failure destroys dashboard: toggle/history error path calls showError() which hides #today. Scope failure to inline chart-box notice + retry.
- [P1] Accessibility bundle: unlabeled canvases, no aria-pressed on toggle, no live regions, faint text 2.8:1.
- [P1] Off-palette indigo fill under sleep chart (app.js:192).
- [P2] Chart chrome contradicts system: default legends/tooltips; copper-vs-status dual encoding for readiness.
- [P2] 30-day legibility: pointRadius 2 × 3 series × 30 points; needs pointRadius 0, fewer ticks.

## Persona Red Flags

- Casey: no refresh feedback; toggle 29px / footer links 14px under 44pt; Refresh adjacent to red Disconnect.
- Sam: charts invisible to screen readers; active range inaudible; 2.8:1 faint text; 4s disarm not extendable (WCAG 2.2.1).
- Alex: no deep-linkable range; no cache-staleness signal; exact values need 2px point hunting.

## Minor Observations

- DESIGN.md says ring numeral takes status color; build renders white — doc/artifact disagree.
- Empty-state text overlaps tick bezel in 80px rings.
- Scores chart has no heading (only stock legend); sleep chart has one.
- Sleep chart auto-scale exaggerates dips; suggestedMin 50 similar.
- color-scheme meta inconsistent (index: dark; legal pages: light dark).

## Questions to Consider

1. Should this instrument ever show full-saturation red at 3 AM, or is amber the floor?
2. Does color mean metric identity or status? Both encodings can't stand.
3. Should the page's final note be "Disconnect Oura"?
