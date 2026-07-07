/* Josh's Oura dashboard. No secrets, no localStorage, no analytics. */
(() => {
  "use strict";

  const state = { days: 7, isOwner: false, charts: {}, historyCache: {} };

  const $ = (id) => document.getElementById(id);

  function scoreColor(score) {
    const styles = getComputedStyle(document.documentElement);
    if (score >= 85) return styles.getPropertyValue("--good").trim();
    if (score >= 70) return styles.getPropertyValue("--fair").trim();
    return styles.getPropertyValue("--low").trim();
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  function formatDateLabel(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  /* ---- Today cards ---- */

  function renderRing(container, score) {
    container.textContent = "";
    if (score === null || score === undefined) {
      const span = document.createElement("span");
      span.className = "ring-empty";
      span.textContent = "No data yet";
      container.appendChild(span);
      return;
    }
    const svgNS = "http://www.w3.org/2000/svg";
    const size = 84;
    const radius = 34;
    const circumference = 2 * Math.PI * radius;
    const color = scoreColor(score);

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Score ${score} out of 100`);

    const track = document.createElementNS(svgNS, "circle");
    const arc = document.createElementNS(svgNS, "circle");
    for (const [circle, stroke] of [[track, cssVar("--track")], [arc, "currentColor"]]) {
      circle.setAttribute("cx", size / 2);
      circle.setAttribute("cy", size / 2);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", stroke);
      circle.setAttribute("stroke-width", "7");
    }
    // currentColor + CSS class give the arc its color and soft glow
    arc.setAttribute("class", "ring-arc");
    arc.style.color = color;
    arc.setAttribute("stroke-linecap", "round");
    arc.setAttribute("stroke-dasharray", circumference);
    arc.setAttribute("stroke-dashoffset", circumference * (1 - score / 100));
    arc.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", "50%");
    text.setAttribute("y", "50%");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "ring-score");
    text.setAttribute("fill", "currentColor");
    text.textContent = score;

    svg.append(track, arc, text);
    container.appendChild(svg);
  }

  function renderSummary(summary) {
    for (const el of document.querySelectorAll(".skeleton")) {
      el.classList.remove("skeleton");
    }
    if (!summary.date) {
      $("today-date").textContent = "No data yet — waiting for the ring to sync.";
      for (const metric of ["readiness", "sleep", "activity"]) {
        renderRing(document.querySelector(`[data-metric="${metric}"]`), null);
      }
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    $("today-date").textContent =
      summary.date === today
        ? "Today"
        : `Latest: ${formatDateLabel(summary.date)}`;
    renderRing(document.querySelector('[data-metric="readiness"]'), summary.readiness);
    renderRing(document.querySelector('[data-metric="sleep"]'), summary.sleep);
    renderRing(document.querySelector('[data-metric="activity"]'), summary.activity);
    document.querySelector('[data-stat="sleep-time"]').textContent =
      formatSleep(summary.total_sleep_seconds);
  }

  /* ---- Trend charts ---- */

  function lineDataset(label, data, color) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      tension: 0.35,
      spanGaps: true,
      pointRadius: 2,
      pointHoverRadius: 5,
      borderWidth: 2,
    };
  }

  function renderCharts(history) {
    const labels = history.map((r) => formatDateLabel(r.date));
    const muted = cssVar("--text-muted");
    const grid = cssVar("--chart-grid");

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: muted, boxWidth: 12, boxHeight: 12 } } },
      scales: {
        x: { ticks: { color: muted, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: muted }, grid: { color: grid } },
      },
    };

    const scoreConfig = {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Readiness", history.map((r) => r.readiness), cssVar("--chart-readiness")),
          lineDataset("Sleep", history.map((r) => r.sleep), cssVar("--chart-sleep")),
          lineDataset("Activity", history.map((r) => r.activity), cssVar("--chart-activity")),
        ],
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: { ...commonOptions.scales.y, suggestedMin: 50, suggestedMax: 100 },
        },
      },
    };

    // Single series: the card's heading names it, so no legend box.
    const sleepColor = cssVar("--chart-sleep");
    const sleepDataset = lineDataset(
      "Time asleep (hours)",
      history.map((r) =>
        r.total_sleep_seconds === null
          ? null
          : Math.round((r.total_sleep_seconds / 3600) * 10) / 10
      ),
      sleepColor
    );
    sleepDataset.fill = true;
    sleepDataset.backgroundColor = "rgba(99, 102, 241, 0.12)";
    const sleepConfig = {
      type: "line",
      data: { labels, datasets: [sleepDataset] },
      options: {
        ...commonOptions,
        plugins: { legend: { display: false } },
      },
    };

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

  function renderHistory(data) {
    $("trends").hidden = false;
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
  }

  function showError() {
    $("error").hidden = false;
    $("today").hidden = true;
    $("trends").hidden = true;
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
    if (dash.version) {
      $("app-version").textContent = `build ${dash.version}`;
    }
    if (!dash.connected) {
      showNotConnected(dash.viewer_is_owner);
      return;
    }
    if (refresh) state.historyCache = {};
    $("owner-controls").hidden = !state.isOwner;
    renderSummary(dash.summary);
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

  for (const button of document.querySelectorAll(".toggle button")) {
    button.addEventListener("click", async () => {
      state.days = Number(button.dataset.days);
      for (const b of document.querySelectorAll(".toggle button")) {
        b.classList.toggle("active", b === button);
      }
      try {
        await loadHistory();
      } catch {
        showError();
      }
    });
  }

  $("refresh-button").addEventListener("click", async () => {
    try {
      await loadDashboard({ refresh: true });
    } catch {
      showError();
    }
  });

  $("disconnect-button").addEventListener("click", async () => {
    if (!window.confirm("Disconnect Oura? The dashboard will stop showing data.")) {
      return;
    }
    await fetch("/auth/disconnect", { method: "POST" });
    window.location.reload();
  });

  init();
})();
