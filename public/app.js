/* Josh's Oura dashboard. No secrets, no localStorage, no analytics. */
(() => {
  "use strict";

  const state = { days: 7, isOwner: false, charts: {} };

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
    for (const [circle, stroke] of [[track, cssVar("--track")], [arc, color]]) {
      circle.setAttribute("cx", size / 2);
      circle.setAttribute("cy", size / 2);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", stroke);
      circle.setAttribute("stroke-width", "7");
    }
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
      borderWidth: 2,
    };
  }

  function renderCharts(history) {
    const labels = history.map((r) => formatDateLabel(r.date));
    const muted = cssVar("--text-muted");
    const grid = cssVar("--track");

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: muted, boxWidth: 12 } } },
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
          lineDataset("Readiness", history.map((r) => r.readiness), cssVar("--good")),
          lineDataset("Sleep", history.map((r) => r.sleep), cssVar("--accent")),
          lineDataset("Activity", history.map((r) => r.activity), cssVar("--fair")),
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

    const sleepConfig = {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset(
            "Time asleep (hours)",
            history.map((r) =>
              r.total_sleep_seconds === null
                ? null
                : Math.round((r.total_sleep_seconds / 3600) * 10) / 10
            ),
            cssVar("--accent")
          ),
        ],
      },
      options: commonOptions,
    };

    for (const [key, canvasId, config] of [
      ["scores", "scores-chart", scoreConfig],
      ["sleep", "sleep-chart", sleepConfig],
    ]) {
      if (state.charts[key]) state.charts[key].destroy();
      state.charts[key] = new Chart($(canvasId), config);
    }
  }

  async function loadHistory({ refresh = false } = {}) {
    const params = new URLSearchParams({ days: String(state.days) });
    if (refresh) params.set("refresh", "1");
    const history = await fetchJson(`/api/history?${params}`);
    $("trends").hidden = false;
    renderCharts(history.data);
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

  async function loadDashboard({ refresh = false } = {}) {
    const summaryUrl = refresh ? "/api/summary?refresh=1" : "/api/summary";
    const [summary] = await Promise.all([
      fetchJson(summaryUrl),
      loadHistory({ refresh }),
    ]);
    renderSummary(summary);
    renderLastSync(summary.last_sync);
  }

  async function init() {
    try {
      const status = await fetchJson("/api/status");
      state.isOwner = status.viewer_is_owner;
      if (!status.connected) {
        showNotConnected(status.viewer_is_owner);
        return;
      }
      $("owner-controls").hidden = !state.isOwner;
      renderLastSync(status.last_sync);
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
