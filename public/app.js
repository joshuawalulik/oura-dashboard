/* Josh's Oura dashboard. No secrets, no localStorage, no analytics. */
(() => {
  "use strict";

  const state = { days: 7, isOwner: false, charts: {}, historyCache: {} };

  const $ = (id) => document.getElementById(id);

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* Color encodes metric identity everywhere (dials and charts tell one
     story); score status is a quiet word at an amber floor, never a
     recolored number. */
  const METRICS = {
    readiness: { label: "Readiness", colorVar: "--m-readiness" },
    sleep: { label: "Sleep", colorVar: "--m-sleep" },
    activity: { label: "Activity", colorVar: "--m-activity" },
  };

  function scoreStatus(score) {
    if (score >= 85) return { word: "Good", colorVar: "--status-good" };
    if (score >= 70) return { word: "Fair", colorVar: "--status-fair" };
    return { word: "Low", colorVar: "--status-low" };
  }

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Delta vs the trailing 7-day average: today's score against the mean of
     the (up to) seven days before it. Omitted when fewer than 3 of those
     days have data — a two-point average is noise, not a baseline. */
  function sevenDayDelta(history, metric, latest) {
    if (!history || !latest || latest[metric] == null) return null;
    const prior = history.filter((r) => r.date < latest.date).slice(-7);
    const values = prior.map((r) => r[metric]).filter((v) => v != null);
    if (values.length < 3) return null;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.round(latest[metric] - mean);
  }

  function deltaPhrase(delta) {
    if (delta == null) return "";
    if (delta === 0) return ", on 7-day average";
    return `, ${Math.abs(delta)} ${delta > 0 ? "above" : "below"} 7-day average`;
  }

  // Polite announcements for screen readers (state swaps are otherwise silent).
  function announce(message) {
    const el = $("sr-status");
    if (el) el.textContent = message;
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    if (res.status === 409) {
      const err = new Error("not_connected");
      err.notConnected = true;
      throw err;
    }
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
    return res.json();
  }

  function formatSleep(seconds) {
    if (seconds === null || seconds === undefined) return "–";
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  /* ---- Vitals row: three compact readouts under the dials ----
     Signed temp uses ASCII "-" and "+" — the B612 Mono latin subset has
     no U+2212 minus (same reason the delta arrows are CSS-drawn). */

  const VITAL_DEFS = {
    "resting-hr": {
      label: "Resting heart rate",
      format: (v) => [String(Math.round(v)), "bpm"],
      sr: (v) => `${Math.round(v)} beats per minute`,
    },
    hrv: {
      label: "Heart rate variability",
      format: (v) => [String(Math.round(v)), "ms"],
      sr: (v) => `${Math.round(v)} milliseconds`,
    },
    "temp-dev": {
      label: "Body temperature deviation",
      format: (v) => [`${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(1)}°`, null],
      sr: (v) =>
        `${v > 0 ? "plus " : v < 0 ? "minus " : ""}${Math.abs(v).toFixed(1)} degrees Celsius`,
    },
  };

  function renderVital(key, value) {
    const def = VITAL_DEFS[key];
    const el = document.querySelector(`[data-vital="${key}"]`);
    const srEl = document.querySelector(`[data-vital-sr="${key}"]`);
    el.textContent = "";
    if (value === null || value === undefined) {
      el.textContent = "–";
      srEl.textContent = `${def.label}: no data yet`;
      return;
    }
    const [number, unit] = def.format(value);
    el.append(document.createTextNode(number));
    if (unit) {
      const unitEl = document.createElement("span");
      unitEl.className = "vital-unit";
      unitEl.textContent = unit;
      el.append(unitEl);
    }
    srEl.textContent = `${def.label}: ${def.sr(value)}`;
  }

  function renderVitals(summary) {
    renderVital("resting-hr", summary.resting_heart_rate);
    renderVital("hrv", summary.average_hrv);
    renderVital("temp-dev", summary.temperature_deviation);
  }

  function formatDateLabel(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  /* ---- Gauges ----
     A 270° instrument dial: SVG tick ring, flat track, metric-colored
     value arc, mono numeral, status word resting in the open bottom gap. */

  const GAUGE = {
    r: 37, // arc radius in a 100-unit viewBox
    sweep: 0.75, // 270° of the circle
    startAngle: 135, // degrees; bottom-left, sweeping clockwise
  };

  function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  function renderGauge(
    container,
    score,
    { delayMs = 0, metric = "readiness", ticks = 20, delta = null } = {}
  ) {
    // Small dials need heavier tick strokes: at ~96px rendered size a
    // 0.9-unit stroke lands sub-pixel and reads as fuzz, not ticks.
    const small = ticks <= 12;
    const minorW = small ? 1.4 : 0.9;
    const majorW = small ? 2 : 1.4;
    container.textContent = "";
    const svgNS = "http://www.w3.org/2000/svg";
    const { label, colorVar } = METRICS[metric];
    const empty = score === null || score === undefined;
    const status = empty ? null : scoreStatus(score);
    const frac = empty ? null : score / 100;

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      empty
        ? `${label}: no data yet`
        : `${label} ${score} out of 100 — ${status.word}${deltaPhrase(delta)}`
    );

    // Tick ring: minor ticks along the sweep, longer majors at 0/25/50/75/100.
    // The ring is functional, not ornament: ticks up to the score are lit,
    // the remainder stays dim — the scale reads before the arc finishes.
    const tickGroup = document.createElementNS(svgNS, "g");
    for (let i = 0; i <= ticks; i++) {
      const major = i % (ticks / 4) === 0;
      const lit = frac !== null && i / ticks <= frac + 1e-9;
      const deg = GAUGE.startAngle + (i / ticks) * 360 * GAUGE.sweep;
      const [x1, y1] = polar(50, 50, 47, deg);
      const [x2, y2] = polar(50, 50, major ? 42 : 44.5, deg);
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", x1.toFixed(2));
      line.setAttribute("y1", y1.toFixed(2));
      line.setAttribute("x2", x2.toFixed(2));
      line.setAttribute("y2", y2.toFixed(2));
      line.setAttribute(
        "stroke",
        major
          ? `rgba(255,255,255,${lit ? 0.72 : 0.26})`
          : `rgba(255,255,255,${lit ? 0.46 : 0.13})`
      );
      line.setAttribute("stroke-width", String(major ? majorW : minorW));
      line.setAttribute("stroke-linecap", "round");
      tickGroup.appendChild(line);
    }

    const circumference = 2 * Math.PI * GAUGE.r;
    const trackLength = circumference * GAUGE.sweep;

    const track = document.createElementNS(svgNS, "circle");
    track.setAttribute("cx", "50");
    track.setAttribute("cy", "50");
    track.setAttribute("r", String(GAUGE.r));
    track.setAttribute("fill", "none");
    track.setAttribute("stroke", cssVar("--track"));
    track.setAttribute("stroke-width", "6");
    track.setAttribute("stroke-linecap", "round");
    track.setAttribute("stroke-dasharray", `${trackLength} ${circumference}`);
    track.setAttribute("transform", `rotate(${GAUGE.startAngle} 50 50)`);

    svg.append(tickGroup, track);

    if (!empty) {
      const arcLength = trackLength * (score / 100);
      const arc = document.createElementNS(svgNS, "circle");
      arc.setAttribute("class", "gauge-arc");
      arc.setAttribute("cx", "50");
      arc.setAttribute("cy", "50");
      arc.setAttribute("r", String(GAUGE.r));
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke", cssVar(colorVar));
      arc.setAttribute("stroke-width", "6");
      arc.setAttribute("stroke-linecap", "round");
      arc.setAttribute("stroke-dasharray", `${arcLength} ${circumference}`);
      // Start hidden; a forced synchronous reflow (not rAF, which background
      // tabs throttle for seconds) commits the hidden state, then releasing
      // the offset lets the CSS transition sweep the arc in, staggered per
      // dial via transition-delay.
      arc.setAttribute("stroke-dashoffset", String(arcLength));
      arc.style.transitionDelay = `${delayMs}ms`;
      arc.setAttribute("transform", `rotate(${GAUGE.startAngle} 50 50)`);
      svg.appendChild(arc);

      // The needle: one longer, metric-colored tick at the score's exact
      // angular position — the "bug" the lit scale and arc both point at.
      const needleDeg = GAUGE.startAngle + frac * 360 * GAUGE.sweep;
      const [nx1, ny1] = polar(50, 50, 48.4, needleDeg);
      const [nx2, ny2] = polar(50, 50, 40.8, needleDeg);
      const needle = document.createElementNS(svgNS, "line");
      needle.setAttribute("class", "gauge-needle");
      needle.setAttribute("x1", nx1.toFixed(2));
      needle.setAttribute("y1", ny1.toFixed(2));
      needle.setAttribute("x2", nx2.toFixed(2));
      needle.setAttribute("y2", ny2.toFixed(2));
      needle.setAttribute("stroke", cssVar(colorVar));
      needle.setAttribute("stroke-width", String(small ? 2.4 : 1.8));
      needle.setAttribute("stroke-linecap", "round");
      needle.setAttribute("opacity", "0");
      // Fade in as the arc sweep arrives at it (same stagger, late in the sweep).
      needle.style.transitionDelay = `${delayMs + 550}ms`;
      svg.appendChild(needle);
    }

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", "50");
    text.setAttribute("y", "52");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", empty ? "gauge-num gauge-num--empty" : "gauge-num");
    text.setAttribute("font-size", "28");
    text.textContent = empty ? "–" : String(score);
    svg.appendChild(text);

    container.appendChild(svg);
    renderDelta(container, metric, empty ? null : delta);

    if (!empty) {
      const arc = svg.querySelector(".gauge-arc");
      const needle = svg.querySelector(".gauge-needle");
      void svg.getBoundingClientRect(); // commit the hidden arc, then release
      arc.setAttribute("stroke-dashoffset", "0");
      needle.setAttribute("opacity", "1");
      animateNumeral(text, score, delayMs);

      const word = document.createElement("span");
      word.className = "gauge-status";
      word.textContent = status.word;
      word.style.color = cssVar(status.colorVar);
      word.setAttribute("aria-hidden", "true"); // the SVG label already carries it
      container.appendChild(word);
    }
  }

  /* Odometer: the numeral counts up 0→score in step with the arc sweep
     (same 900ms, same ease-out-expo feel; tabular mono digits don't
     jitter). Time-based so a throttled tab still lands on the final value.
     Runs only from renderSummary — initial render and manual refresh —
     never on the 7/30-day toggle, which doesn't touch the dials. */
  function animateNumeral(textEl, score, delayMs) {
    if (prefersReducedMotion()) return; // numeral is already at its final value
    const DURATION = 900;
    const start = performance.now() + delayMs;
    const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
    textEl.textContent = "0";
    const frame = (now) => {
      const t = Math.min(Math.max((now - start) / DURATION, 0), 1);
      textEl.textContent = String(Math.round(ease(t) * score));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* The delta line under the dial: signed value in the metric's identity
     hue (hue = metric identity everywhere), quiet mono "vs avg" after it.
     delta === null leaves the line empty (sparse history); the element
     keeps its height so the cards never jump. */
  function renderDelta(container, metric, delta) {
    const card = container.closest(".card");
    const el = card && card.querySelector(".gauge-delta");
    if (!el) return;
    el.textContent = "";
    if (delta === null || delta === undefined) return;
    if (delta === 0) {
      el.textContent = "– on avg";
      return;
    }
    const arrow = document.createElement("span");
    arrow.className = `delta-arrow ${delta > 0 ? "delta-arrow--up" : "delta-arrow--down"}`;
    const color = cssVar(METRICS[metric].colorVar);
    if (delta > 0) arrow.style.borderBottomColor = color;
    else arrow.style.borderTopColor = color;
    const value = document.createElement("span");
    value.className = "delta-value";
    value.textContent = `${delta > 0 ? "+" : "-"}${Math.abs(delta)}`;
    value.style.color = color;
    const unit = document.createElement("span");
    unit.textContent = "vs avg";
    el.append(arrow, value, unit);
  }

  function renderSummary(summary, history) {
    for (const el of document.querySelectorAll(".skeleton")) {
      el.classList.remove("skeleton");
    }
    if (!summary.date) {
      $("today-date").textContent = "No data yet — waiting for the ring to sync.";
      $("today-date").classList.add("today-date--message");
      renderGauge(document.querySelector('[data-metric="readiness"]'), null, { metric: "readiness" });
      renderGauge(document.querySelector('[data-metric="sleep"]'), null, { metric: "sleep", ticks: 8 });
      renderGauge(document.querySelector('[data-metric="activity"]'), null, { metric: "activity", ticks: 8 });
      renderVitals({});
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    $("today-date").classList.remove("today-date--message");
    $("today-date").textContent =
      summary.date === today ? "Today" : `Latest: ${formatDateLabel(summary.date)}`;
    renderGauge(document.querySelector('[data-metric="readiness"]'), summary.readiness, {
      metric: "readiness",
      delta: sevenDayDelta(history, "readiness", summary),
    });
    renderGauge(document.querySelector('[data-metric="sleep"]'), summary.sleep, {
      metric: "sleep",
      delayMs: 120,
      ticks: 8,
      delta: sevenDayDelta(history, "sleep", summary),
    });
    renderGauge(document.querySelector('[data-metric="activity"]'), summary.activity, {
      metric: "activity",
      delayMs: 240,
      ticks: 8,
      delta: sevenDayDelta(history, "activity", summary),
    });
    renderVitals(summary);
    document.querySelector('[data-stat="sleep-time"]').textContent =
      formatSleep(summary.total_sleep_seconds);
  }

  /* ---- Trend charts ---- */

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function lineDataset(label, data, color, days) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      pointBackgroundColor: color,
      tension: 0.35,
      spanGaps: true,
      // 30 days of dots is spaghetti; the line carries the story alone.
      pointRadius: days === 30 ? 0 : 2.5,
      pointHoverRadius: 5,
      borderWidth: days === 30 ? 1.5 : 2,
    };
  }

  function chartOptions(days) {
    const muted = cssVar("--text-muted");
    const mono = cssVar("--font-mono");
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        // Series are named in the section header, not stock legend boxes.
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar("--panel-raised"),
          borderColor: cssVar("--hairline"),
          borderWidth: 1,
          titleColor: muted,
          bodyColor: cssVar("--text"),
          titleFont: { family: mono, size: 11, weight: "normal" },
          bodyFont: { family: mono, size: 12 },
          padding: 10,
          cornerRadius: 10,
          caretSize: 5,
          displayColors: false,
          callbacks: {
            // Each tooltip row speaks in its series' own color.
            labelTextColor: (ctx) => ctx.dataset.borderColor,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: muted,
            font: { family: mono, size: 10 },
            maxTicksLimit: days === 30 ? 6 : 8,
            autoSkipPadding: 16,
            maxRotation: 0,
          },
          grid: { display: false },
        },
        y: {
          ticks: { color: muted, font: { family: mono, size: 10 } },
          grid: { color: cssVar("--chart-grid") },
          border: { display: false },
        },
      },
    };
  }

  function renderCharts(history) {
    const days = state.days;
    const labels = history.map((r) => formatDateLabel(r.date));
    const common = chartOptions(days);

    const scoreConfig = {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Readiness", history.map((r) => r.readiness), cssVar("--m-readiness"), days),
          lineDataset("Sleep", history.map((r) => r.sleep), cssVar("--m-sleep"), days),
          lineDataset("Activity", history.map((r) => r.activity), cssVar("--m-activity"), days),
        ],
      },
      options: {
        ...common,
        scales: {
          ...common.scales,
          // Suggested floor, pinned ceiling: a routine dip reads as a dip,
          // not a cliff, but a genuinely low score (< 40) extends the axis
          // instead of falling off the bottom of the chart.
          y: {
            ...common.scales.y,
            suggestedMin: 40,
            max: 100,
            ticks: { ...common.scales.y.ticks, stepSize: 20 },
          },
        },
      },
    };

    const sleepColor = cssVar("--m-sleep");
    const sleepDataset = lineDataset(
      "Time asleep",
      history.map((r) =>
        r.total_sleep_seconds === null
          ? null
          : Math.round((r.total_sleep_seconds / 3600) * 10) / 10
      ),
      sleepColor,
      days
    );
    sleepDataset.fill = true;
    sleepDataset.backgroundColor = hexToRgba(sleepColor, 0.1);
    const sleepConfig = {
      type: "line",
      data: { labels, datasets: [sleepDataset] },
      options: {
        ...common,
        scales: {
          ...common.scales,
          y: {
            ...common.scales.y,
            suggestedMin: 4,
            suggestedMax: 9,
            ticks: { ...common.scales.y.ticks, stepSize: 1 },
          },
        },
      },
    };

    $("scores-chart").setAttribute(
      "aria-label",
      `Line chart: readiness, sleep, and activity scores over the last ${days} days.`
    );
    $("sleep-chart").setAttribute(
      "aria-label",
      `Line chart: nightly time asleep in hours over the last ${days} days.`
    );

    for (const [key, canvasId, config] of [
      ["scores", "scores-chart", scoreConfig],
      ["sleep", "sleep-chart", sleepConfig],
    ]) {
      if (state.charts[key]) state.charts[key].destroy();
      state.charts[key] = new Chart($(canvasId), config);
      dismissTooltipOnTouchEnd($(canvasId));
    }
  }

  // iOS Safari: Chart.js shows tooltips on touchstart/touchmove but never
  // hides them, so a tapped point's tooltip sticks around forever. Clearing
  // on touchend alone is not enough: ~300ms after touchend, Safari fires
  // synthetic mouse events (mousemove at the touch point) that re-activate
  // the tooltip. preventDefault() on touchend suppresses those synthetic
  // events, and a delayed second clear catches any that slip through.
  function dismissTooltipOnTouchEnd(canvas) {
    if (canvas.dataset.touchDismiss) return; // attach once per canvas
    canvas.dataset.touchDismiss = "1";
    const clear = () => {
      const chart = Chart.getChart(canvas);
      if (!chart) return;
      chart.setActiveElements([]);
      chart.tooltip.setActiveElements([], { x: 0, y: 0 });
      chart.update();
    };
    const onEnd = (event) => {
      event.preventDefault();
      clear();
      setTimeout(clear, 400);
    };
    canvas.addEventListener("touchend", onEnd, { passive: false });
    canvas.addEventListener("touchcancel", onEnd, { passive: false });
  }

  /* ---- Readiness heatmap: one status lamp per day above the charts ----
     The strip always shows the fullest range fetched this visit (30 days
     stay once seen, whatever the toggle says); days without a readiness
     score are outline-only cells. No animation — it's a static readout. */

  const HEATMAP = { cell: 10, gap: 3, radius: 2.5 };

  function renderHeatmap(history) {
    // Prefer the 30-day range when any fetch this visit has returned it.
    const data = (state.historyCache[30] ?? history).slice(-30);
    const strip = $("heatmap-strip");
    strip.classList.remove("skeleton");
    strip.textContent = "";
    if (!data.length) return;

    const svgNS = "http://www.w3.org/2000/svg";
    const { cell, gap, radius } = HEATMAP;
    const width = data.length * cell + (data.length - 1) * gap;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${cell}`);
    svg.setAttribute("preserveAspectRatio", "xMinYMid meet");
    svg.setAttribute("role", "img");

    const counts = { Good: 0, Fair: 0, Low: 0, missing: 0 };
    data.forEach((record, i) => {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(i * (cell + gap)));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", String(cell));
      rect.setAttribute("height", String(cell));
      rect.setAttribute("rx", String(radius));
      const title = document.createElementNS(svgNS, "title");
      if (record.readiness == null) {
        counts.missing++;
        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", "rgba(255,255,255,0.14)");
        rect.setAttribute("stroke-width", "0.75");
        title.textContent = `${formatDateLabel(record.date)}: no data`;
      } else {
        const status = scoreStatus(record.readiness);
        counts[status.word]++;
        rect.setAttribute("fill", cssVar(status.colorVar));
        title.textContent = `${formatDateLabel(record.date)}: ${record.readiness} (${status.word})`;
      }
      rect.appendChild(title);
      svg.appendChild(rect);
    });

    const parts = [
      `${counts.Good} good`,
      `${counts.Fair} fair`,
      `${counts.Low} low`,
    ];
    if (counts.missing) parts.push(`${counts.missing} missing`);
    svg.setAttribute(
      "aria-label",
      `${data.length}-day readiness: ${parts.join(", ")} days.`
    );
    strip.appendChild(svg);

    $("heatmap-title").textContent = `Readiness – last ${data.length} days`;
    const key = $("heatmap-key");
    key.textContent = "";
    for (const [count, label] of [
      [counts.Good, "good"],
      [counts.Fair, "fair"],
      [counts.Low, "low"],
    ]) {
      if (!count) continue;
      const li = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = `key-swatch key-swatch--${label}`;
      li.append(swatch, `${count} ${label}`);
      key.appendChild(li);
    }
  }

  /* ---- Trends-scoped failure: a chart fetch error must never erase
     the scores the user is looking at. ---- */

  function showTrendsError() {
    $("trends-error").hidden = false;
    for (const box of document.querySelectorAll("#trends .chart-box")) box.hidden = true;
    announce("Couldn't load the trend charts.");
  }

  function hideTrendsError() {
    $("trends-error").hidden = true;
    for (const box of document.querySelectorAll("#trends .chart-box")) box.hidden = false;
  }

  function renderHistory(data) {
    $("trends").hidden = false;
    hideTrendsError();
    renderHeatmap(data);
    renderCharts(data);
  }

  async function loadHistory({ refresh = false } = {}) {
    // Ranges already fetched this visit render instantly from memory.
    if (!refresh && state.historyCache[state.days]) {
      renderHistory(state.historyCache[state.days]);
      return;
    }
    const params = new URLSearchParams({ days: String(state.days) });
    if (refresh) params.set("refresh", "1");
    const history = await fetchJson(`/api/history?${params}`);
    state.historyCache[state.days] = history.data;
    renderHistory(history.data);
  }

  /* ---- States & wiring ---- */

  function showNotConnected(isOwner) {
    $("today").hidden = true;
    $("trends").hidden = true;
    $("not-connected").hidden = false;
    $("not-connected-message").textContent = isOwner
      ? "Your Oura account isn't connected yet."
      : "Josh hasn't connected his ring yet.";
    $("connect-button").hidden = !isOwner;
    announce("Oura isn't connected.");
  }

  function showError() {
    $("error").hidden = false;
    $("today").hidden = true;
    $("trends").hidden = true;
    announce("Couldn't load data right now.");
  }

  function hideError() {
    $("error").hidden = true;
    $("today").hidden = false;
  }

  function renderLastSync(lastSync) {
    if (!lastSync) return;
    const el = $("last-sync");
    el.hidden = false;
    el.textContent = `Updated ${new Date(lastSync).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  // One request fetches status + summary + history together.
  async function loadDashboard({ refresh = false } = {}) {
    const params = new URLSearchParams({ days: String(state.days) });
    if (refresh) params.set("refresh", "1");
    const dash = await fetchJson(`/api/dashboard?${params}`);

    state.isOwner = dash.viewer_is_owner;
    $("demo-banner").hidden = !dash.demo;
    if (dash.version) {
      $("app-version").textContent = `build ${dash.version}`;
    }
    if (!dash.connected) {
      showNotConnected(dash.viewer_is_owner);
      return;
    }
    if (refresh) state.historyCache = {};
    $("owner-controls").hidden = !state.isOwner;
    $("disconnect-row").hidden = !state.isOwner;
    renderSummary(dash.summary, dash.history.data);
    renderLastSync(dash.last_sync);
    state.historyCache[dash.history.days] = dash.history.data;
    renderHistory(dash.history.data);
  }

  async function init() {
    try {
      await loadDashboard();
    } catch (err) {
      if (err.notConnected) {
        showNotConnected(state.isOwner);
      } else {
        showError();
      }
    }
  }

  function setActiveRange(days) {
    state.days = days;
    for (const b of document.querySelectorAll(".toggle button")) {
      const active = Number(b.dataset.days) === days;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    }
    // Deep-linkable range without polluting history.
    history.replaceState(null, "", days === 30 ? "#30d" : "#7d");
  }

  for (const button of document.querySelectorAll(".toggle button")) {
    button.addEventListener("click", async () => {
      setActiveRange(Number(button.dataset.days));
      announce(`Showing ${state.days} days`);
      try {
        await loadHistory();
      } catch {
        // Scoped: Today's scores stay on screen.
        showTrendsError();
      }
    });
  }

  $("trends-retry-button").addEventListener("click", async () => {
    try {
      await loadHistory();
    } catch {
      showTrendsError();
    }
  });

  $("refresh-button").addEventListener("click", async () => {
    const button = $("refresh-button");
    const label = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Refreshing…";
    try {
      await loadDashboard({ refresh: true });
      announce("Data refreshed.");
    } catch {
      showError();
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = label;
    }
  });

  $("retry-button").addEventListener("click", async () => {
    hideError();
    await init();
  });

  // Two-step disconnect: first click arms the button, second click (within
  // 8s) fires. Replaces the blocking window.confirm dialog.
  {
    const button = $("disconnect-button");
    const label = button.textContent;
    let disarmTimer;
    button.addEventListener("click", async () => {
      if (!button.classList.contains("armed")) {
        button.classList.add("armed");
        button.textContent = "Really disconnect?";
        announce("Disconnect armed — press again to confirm.");
        disarmTimer = setTimeout(() => {
          button.classList.remove("armed");
          button.textContent = label;
          announce("Disconnect cancelled.");
        }, 8000);
        return;
      }
      clearTimeout(disarmTimer);
      await fetch("/auth/disconnect", { method: "POST" });
      window.location.reload();
    });
  }

  // Restore a deep-linked range before the first fetch.
  if (location.hash === "#30d") setActiveRange(30);

  init();
})();
