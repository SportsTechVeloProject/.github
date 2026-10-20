/* app.js — App state, tabs, view switching, modals and theme. Wires the rest together.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order. */
"use strict";

/* ---------------- state + wiring ---------------- */
var state = { ex: "squat", selected: {} };
["squat", "bench", "deadlift"].forEach(function (k) { state.selected[k] = EXERCISES[k].history.length - 1; });

function selectSet(exKey, idx) {
  state.selected[exKey] = idx;
  renderExercise(exKey);
}

function renderExercise(exKey) {
  state.ex = exKey;
  var ex = EXERCISES[exKey];
  document.getElementById("plansView").hidden = true;
  hideTeamPage();
  document.getElementById("exerciseView").hidden = false;
  document.getElementById("exEyebrow").textContent = ex.name;

  // Logged in: the lifter's own sets (mysets.js). With none recorded yet the
  // demo stays, labelled as example data. Logged out: the demo.
  var recorded = mySets.active && !ex.showingExample;
  var n = ex.history.length;
  document.getElementById("exHeading").textContent = recorded
    ? n + " recorded set" + (n === 1 ? "" : "s")
    : "Est. 1RM " + ex.oneRM + " kg";
  var notice = document.getElementById("exNotice");
  notice.hidden = !mySets.active || recorded;
  notice.textContent = mySets.status ||
    "Example data. You haven't recorded any " + ex.name.toLowerCase() + " sets yet; yours will show here once they're recorded.";
  document.getElementById("logForm").hidden = mySets.active;

  document.querySelectorAll(".apptab").forEach(function (b) {
    b.setAttribute("aria-selected", b.dataset.ex === exKey ? "true" : "false");
  });

  var idx = clamp(state.selected[exKey], 0, ex.history.length - 1);
  var row = ex.history[idx];
  var sim = setData(ex, row);
  currentPathRep = 0;

  // Say which set the charts are showing, and how to change it.
  var which = (recorded ? "Showing your set from " : "Showing the example set from ") + row.date +
    (row.weight === null ? "" : " · " + row.weight + " kg") +
    (idx === ex.history.length - 1 ? " (the newest)" : "") + ".";
  document.getElementById("setContext").textContent = which +
    " Click another set in History below to switch. Click a chart to enlarge it and step through the reps one at a time; hover over a chart to read exact values.";

  // A recorded set has measured rep speeds, but no bar path yet.
  if (sim.reps) {
    renderVelocityChart(ex, sim);
  } else {
    renderChartMessage("velChart", "No reps calculated for this set yet.");
    document.getElementById("velLegend").innerHTML = "";
  }
  document.getElementById("velCaption").textContent = sim.real
    ? "Each line is one rep, coloured by the zone of its mean speed; the dot is its measured top speed. The shape between is approximate until the full speed curve is measured."
    : "Every rep in the selected set, aligned on one lift cycle instead of time. Colour shows each rep's training zone; the dot is its top speed.";
  // Recorded sets have no bar path yet, so the left/right card compares the
  // two sleeves' measured speed per rep instead, and front/back says so.
  var pathCard = document.getElementById("pathChart").closest(".chart-card");
  pathCard.querySelector("h3").textContent = sim.real ? LR_SPEED_TITLE : "Bar path — left vs right";
  pathCard.querySelector(".chart-legend.two").hidden = !!sim.real && !sim.reps;
  var pathCaption = document.getElementById("pathCaption");
  pathCaption.textContent = sim.real
    ? lrCheckSummary(sim)
    : "How high each end of the bar is through one rep. Where the two lines separate, one side is lower and the bar is tilting. Pick a rep above the chart.";
  pathCaption.hidden = !pathCaption.textContent;
  if (sim.real) {
    if (sim.reps) renderLRSpeedChart(sim, "pathChart");
    else renderChartMessage("pathChart", "No reps calculated for this set yet.");
    document.getElementById("pathPills").innerHTML = "";
    renderChartMessage("driftChart", NOT_MEASURED);
    document.getElementById("driftLegend").innerHTML = "";
  } else {
    renderPathChart(ex, sim);
    renderDriftChart(ex, sim);
  }
  renderRepZones(ex, sim);
  renderHistory(exKey, ex, idx);
  document.getElementById("driftCaption").textContent = ex.driftCaption;
  document.getElementById("driftCaption").hidden = !!sim.real;
  if (currentModalChart && !document.getElementById("chartModalOverlay").hidden) {
    openChartModal(currentModalChart);
  }
}

/* ---------------- log-a-set form ---------------- */
document.getElementById("logForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var input = document.getElementById("logWeight");
  var weight = parseFloat(input.value);
  if (!weight || weight <= 0) return;
  var ex = EXERCISES[state.ex];
  var now = new Date();
  var dateStr = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  var timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  ex.history.push({ date: "Today (" + dateStr + ")", time: timeStr, weight: weight });
  state.selected[state.ex] = ex.history.length - 1;
  input.value = "";
  renderExercise(state.ex);
});

/* ---------------- exercise tabs ---------------- */
function showPlans() {
  document.getElementById("exerciseView").hidden = true;
  hideTeamPage();
  document.getElementById("plansView").hidden = false;
  if (typeof loadTeamPlans === "function") loadTeamPlans();
  if (typeof refreshPlansTab === "function") refreshPlansTab();
  document.querySelectorAll(".apptab").forEach(function (b) {
    b.setAttribute("aria-selected", b.dataset.view === "plans" ? "true" : "false");
  });
}

document.querySelectorAll(".apptab").forEach(function (b) {
  b.addEventListener("click", function () {
    if (b.dataset.view === "plans") showPlans();
    else renderExercise(b.dataset.ex);
  });
});

/* ---------------- open / close demo ---------------- */
var marketing = document.getElementById("marketingView");
var app = document.getElementById("appView");
function openDemo() {
  marketing.hidden = true;
  app.hidden = false;
  window.scrollTo(0, 0);
  renderExercise(state.ex);
  if (typeof updateTeamBadge === "function") updateTeamBadge();
}
function closeDemo() {
  app.hidden = true;
  marketing.hidden = false;
  window.scrollTo(0, 0);
}
document.getElementById("exitDemo").addEventListener("click", function (e) { e.preventDefault(); closeDemo(); });
document.getElementById("exitDemo2").addEventListener("click", function (e) { e.preventDefault(); closeDemo(); });
document.getElementById("exitDemo3").addEventListener("click", function (e) { e.preventDefault(); closeDemo(); });

/* ---------------- zone info modal ---------------- */
function renderZoneTabs(active) {
  var ex = EXERCISES[state.ex];
  var tabs = document.getElementById("zoneModalTabs");
  tabs.innerHTML = "";
  ex.zones.forEach(function (z) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "zone-tab";
    b.textContent = z.label;
    b.dataset.zone = z.key;
    b.setAttribute("aria-selected", z.key === zoneKey(active) ? "true" : "false");
    b.addEventListener("click", function () { showZoneContent(z.key); });
    tabs.appendChild(b);
  });
}
function showZoneContent(zone) {
  var ex = EXERCISES[state.ex];
  var key = zoneKey(zone);
  var idx = ex.zones.findIndex(function (z) { return z.key === key; });
  if (idx < 0) idx = 0;
  var info = ZONE_INFO[ex.zones[idx].key];
  document.getElementById("zoneModalRange").textContent = ex.name + " · " + zoneRangeLabel(ex, idx) + " · " + info.pct;
  document.getElementById("zoneModalTitle").textContent = ex.zones[idx].label;
  document.getElementById("zoneModalDesc").textContent = info.desc;
  document.getElementById("zoneModalBenefit").textContent = info.benefit;
  // All five zones side by side, this one highlighted.
  var parts = document.getElementById("zoneModalParts");
  parts.innerHTML = "";
  ex.zones.forEach(function (z, i) {
    var tr = document.createElement("tr");
    if (i === idx) tr.className = "is-current";
    [z.label, zoneRangeLabel(ex, i), ZONE_INFO[z.key].pctShort].forEach(function (text) {
      var td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    parts.appendChild(tr);
  });
  document.querySelectorAll(".zone-tab").forEach(function (b) {
    b.setAttribute("aria-selected", b.dataset.zone === ex.zones[idx].key ? "true" : "false");
  });
}
function openZoneModal(zone) {
  renderZoneTabs(zone);
  showZoneContent(zone);
  document.getElementById("zoneModalOverlay").hidden = false;
}
function closeZoneModal() {
  document.getElementById("zoneModalOverlay").hidden = true;
}
// Capture phase: must intercept before a history row's own click
// listener (selectSet) fires during the bubble phase.
document.getElementById("appView").addEventListener("click", function (e) {
  var link = e.target.closest(".zone-link");
  if (!link) return;
  e.stopPropagation();
  openZoneModal(link.dataset.zone);
}, true);
document.getElementById("zoneModalClose").addEventListener("click", closeZoneModal);
// Close only when the press *and* release both land on the backdrop, so
// dragging out of the dialog (e.g. while selecting text) keeps it open.
var zonePressedOnBackdrop = false;
document.getElementById("zoneModalOverlay").addEventListener("mousedown", function (e) {
  zonePressedOnBackdrop = e.target.id === "zoneModalOverlay";
});
document.getElementById("zoneModalOverlay").addEventListener("click", function (e) {
  if (e.target.id === "zoneModalOverlay" && zonePressedOnBackdrop) closeZoneModal();
});

/* ---------------- enlarge-chart modal ---------------- */
var CHART_TYPES = ["velocity", "path", "drift"];
var currentModalChart = null;
var modalSelectedRep = null; // null = all reps overlaid; a number = that one rep only
function currentSetSim() {
  var ex = EXERCISES[state.ex];
  var idx = clamp(state.selected[state.ex], 0, ex.history.length - 1);
  return { ex: ex, sim: setData(ex, ex.history[idx]) };
}
function renderRepPills(container, repsCount, selectedIdx, onSelect) {
  container.innerHTML = "";
  var allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "rep-pill";
  allBtn.textContent = "All reps";
  allBtn.setAttribute("aria-pressed", selectedIdx === null ? "true" : "false");
  allBtn.addEventListener("click", function () { onSelect(null); });
  container.appendChild(allBtn);
  for (var i = 0; i < repsCount; i++) {
    (function (idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rep-pill";
      b.textContent = "Rep " + (idx + 1);
      b.setAttribute("aria-pressed", selectedIdx === idx ? "true" : "false");
      b.addEventListener("click", function () { onSelect(idx); });
      container.appendChild(b);
    })(i);
  }
}
function updateModalRepArrows(repsCount) {
  document.getElementById("modalRepPrev").disabled = modalSelectedRep === null;
  document.getElementById("modalRepNext").disabled = modalSelectedRep !== null && modalSelectedRep >= repsCount - 1;
}
function stepModalRep(dir) {
  var repsCount = currentSetSim().sim.reps;
  var cur = modalSelectedRep === null ? -1 : modalSelectedRep;
  var next = clamp(cur + dir, -1, repsCount - 1);
  modalSelectedRep = next === -1 ? null : next;
  openChartModal(currentModalChart);
}
function openChartModal(type) {
  var isFresh = type !== currentModalChart;
  if (isFresh) modalSelectedRep = null;
  currentModalChart = type;
  var ctx = currentSetSim();
  var ex = ctx.ex, sim = ctx.sim;
  if (modalSelectedRep !== null) modalSelectedRep = clamp(modalSelectedRep, 0, sim.reps - 1);

  var title = document.getElementById("chartModalTitle");
  var legendWrap = document.getElementById("chartModalLegend");
  var pillsWrap = document.getElementById("chartModalPills");
  var twoLegend = document.getElementById("chartModalTwoLegend");
  var caption = document.getElementById("chartModalCaption");

  // Recorded sets: front/back isn't measured, and nothing is without reps.
  if (sim.real && (type === "drift" || !sim.reps)) {
    title.textContent = { velocity: "Bar speed by lift cycle", path: LR_SPEED_TITLE, drift: "Bar path — front vs back" }[type];
    pillsWrap.innerHTML = "";
    legendWrap.hidden = true;
    twoLegend.hidden = true;
    caption.hidden = true;
    document.getElementById("modalRepPrev").disabled = true;
    document.getElementById("modalRepNext").disabled = true;
    renderChartMessage("chartModalSvg", type === "velocity" ? "No reps calculated for this set yet." : NOT_MEASURED);
    document.getElementById("chartModalOverlay").hidden = false;
    return;
  }

  renderRepPills(pillsWrap, sim.reps, modalSelectedRep, function (idx) {
    modalSelectedRep = idx;
    openChartModal(type);
  });
  updateModalRepArrows(sim.reps);

  var svg = document.getElementById("chartModalSvg");

  if (type === "velocity") {
    title.textContent = "Bar speed by lift cycle";
    legendWrap.hidden = modalSelectedRep !== null;
    twoLegend.hidden = true;
    caption.hidden = false;
    caption.textContent = modalSelectedRep === null
      ? "Every rep in the selected set, aligned on one lift cycle instead of time. Colour shows each rep's training zone; the dot is its top speed."
      : "Rep " + (modalSelectedRep + 1) + " of " + sim.reps + ", aligned on one lift cycle.";
    renderVelocityChart(ex, sim, { svg: "chartModalSvg", legend: "chartModalLegend" }, modalSelectedRep);
  } else if (type === "path" && sim.real) {
    title.textContent = LR_SPEED_TITLE;
    legendWrap.hidden = true;
    twoLegend.hidden = false;
    caption.hidden = false;
    caption.textContent = lrCheckSummary(sim);
    renderLRSpeedChart(sim, "chartModalSvg", modalSelectedRep);
  } else if (type === "path") {
    title.textContent = "Bar path — left vs right";
    legendWrap.hidden = true;
    twoLegend.hidden = false;
    caption.hidden = true;
    drawPathCurves(svg, ex, sim, modalSelectedRep);
  } else if (type === "drift") {
    title.textContent = "Bar path — front vs back";
    legendWrap.hidden = modalSelectedRep !== null;
    twoLegend.hidden = true;
    caption.hidden = false;
    caption.textContent = modalSelectedRep === null
      ? ex.driftCaption
      : ex.driftCaption + " Showing rep " + (modalSelectedRep + 1) + " only.";
    renderDriftChart(ex, sim, { svg: "chartModalSvg", legend: "chartModalLegend" }, modalSelectedRep);
  }
  document.getElementById("chartModalOverlay").hidden = false;
}
function closeChartModal() {
  document.getElementById("chartModalOverlay").hidden = true;
  currentModalChart = null;
  modalSelectedRep = null;
}
function stepChartType(dir) {
  var idx = CHART_TYPES.indexOf(currentModalChart);
  var next = (idx + dir + CHART_TYPES.length) % CHART_TYPES.length;
  openChartModal(CHART_TYPES[next]);
}
document.querySelectorAll(".chart-visual").forEach(function (el) {
  // The whole card opens the chart, except its own controls (e.g. rep pills).
  el.closest(".chart-card").addEventListener("click", function (e) {
    if (e.target.closest("button, a, input, select")) return;
    openChartModal(el.dataset.chart);
  });
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChartModal(el.dataset.chart); }
  });
});
document.getElementById("chartModalClose").addEventListener("click", closeChartModal);
var chartPressedOnBackdrop = false;
document.getElementById("chartModalOverlay").addEventListener("mousedown", function (e) {
  chartPressedOnBackdrop = e.target.id === "chartModalOverlay";
});
document.getElementById("chartModalOverlay").addEventListener("click", function (e) {
  if (e.target.id === "chartModalOverlay" && chartPressedOnBackdrop) closeChartModal();
});
document.getElementById("modalRepPrev").addEventListener("click", function () { stepModalRep(-1); });
document.getElementById("modalRepNext").addEventListener("click", function () { stepModalRep(1); });
document.getElementById("chartTypePrev").addEventListener("click", function () { stepChartType(-1); });
document.getElementById("chartTypeNext").addEventListener("click", function () { stepChartType(1); });

document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  if (!document.getElementById("chartModalOverlay").hidden) closeChartModal();
  else if (!document.getElementById("zoneModalOverlay").hidden) closeZoneModal();
});

/* ---------------- light / dark theme toggle ---------------- */
var THEME_KEY = "vlo-theme";
function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function effectiveIsDark() {
  var explicit = document.documentElement.getAttribute("data-theme");
  return explicit ? explicit === "dark" : systemPrefersDark();
}
function updateToggleIcons() {
  // Note: the `hidden` IDL property/attribute is unreliable on inline SVG
  // elements in some engines, so visibility is toggled via inline style
  // instead of .hidden.
  var dark = effectiveIsDark();
  document.querySelectorAll(".theme-toggle").forEach(function (btn) {
    btn.querySelector(".icon-sun").style.display = dark ? "none" : "";
    btn.querySelector(".icon-moon").style.display = dark ? "" : "none";
    btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  });
}
function applyTheme(theme) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  try { localStorage.setItem(THEME_KEY, theme || ""); } catch (e) { /* private browsing, etc. */ }
  updateToggleIcons();
}
(function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  applyTheme(saved === "dark" || saved === "light" ? saved : null);
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      var explicit = null;
      try { explicit = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
      if (!explicit) updateToggleIcons();
    });
  }
})();
document.querySelectorAll(".theme-toggle").forEach(function (btn) {
  btn.addEventListener("click", function () { applyTheme(effectiveIsDark() ? "light" : "dark"); });
});

/* ---------------- raw session preview (real Supabase fetch) ---------------- */
// Temporary signed link into the "raw-sessions" storage bucket — this one
// expires about a week after it was issued (Sep 20 2026). Once it stops
// working, swap in a fresh signed URL, or better, a permanent public URL,
// so this stops needing to be replaced by hand.
var RAW_SESSION_URL = "https://amxrrodzdvizndchfeqy.supabase.co/storage/v1/object/sign/raw-sessions/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002.json?token=eyJraWQiOiI5MTZmY2Y1Yi1kOTNlLTRkMzEtYTU0Yi04NzFkMWYwYzA4YjciLCJhbGciOiJIUzUxMiJ9.eyJ1cmwiOiJyYXctc2Vzc2lvbnMvMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxLzAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMi5qc29uIiwic2NvcGUiOiJkb3dubG9hZCIsImlhdCI6MTc4OTg4MzYwOSwiZXhwIjoxNzkwNDg4NDA5fQ.7Z9bo-s3wwvZ7ljObx-TBb5ggwHeDFOZjMBN7AtVgIvwU15NfYxOGb9PyoH_l02seNRkR1gBron-56ots_J7RA";

function drawRawSessionChart(samples) {
  var svg = document.getElementById("rawChart");
  if (!svg) return;
  svg.innerHTML = "";
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);

  var bySensor = { left: [], right: [] };
  samples.forEach(function (s) {
    if (typeof s.vVert !== "number") return;
    if (s.sensor !== "left" && s.sensor !== "right") return;
    bySensor[s.sensor].push({ t: s.t, v: s.vVert });
  });
  bySensor.left.sort(function (a, b) { return a.t - b.t; });
  bySensor.right.sort(function (a, b) { return a.t - b.t; });

  var allPts = bySensor.left.concat(bySensor.right);
  if (allPts.length === 0) {
    var msg = svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "mono", "font-size": 11, fill: "var(--muted)" });
    msg.textContent = "No velocity samples found in this file.";
    svg.appendChild(msg);
    return;
  }
  var allT = allPts.map(function (p) { return p.t; });
  var t0 = Math.min.apply(null, allT);
  var t1 = Math.max.apply(null, allT);
  var maxAbsV = Math.max.apply(null, allPts.map(function (p) { return Math.abs(p.v); }));
  var vBound = niceAbsMax(maxAbsV, 0.2);

  function xT(t) { return M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r); }
  var yS = makeYScaleRange(-vBound, vBound);

  var yTicks = [-1, -0.5, 0, 0.5, 1].map(function (f) { return { v: +(vBound * f).toFixed(2), y: yS(vBound * f) }; });
  yTicks.forEach(function (tk) {
    svg.appendChild(svgEl("line", { x1: M.l, x2: W - M.r, y1: tk.y, y2: tk.y, stroke: "var(--chart-grid)", "stroke-width": 1 }));
    var lbl = svgEl("text", { x: M.l - 10, y: tk.y + 3, "text-anchor": "end", class: "mono", "font-size": 9, fill: "var(--muted)" });
    lbl.textContent = tk.v.toFixed(2);
    svg.appendChild(lbl);
  });
  svg.appendChild(svgEl("line", { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, stroke: "var(--rule)", "stroke-width": 1 }));
  svg.appendChild(svgEl("line", { x1: M.l, x2: W - M.r, y1: yS(0), y2: yS(0), stroke: "var(--muted)", "stroke-width": 1.2 }));

  var tStart = svgEl("text", { x: M.l, y: H - 12, "text-anchor": "start", class: "mono", "font-size": 9, fill: "var(--muted)" });
  tStart.textContent = "0s";
  svg.appendChild(tStart);
  var tEnd = svgEl("text", { x: W - M.r, y: H - 12, "text-anchor": "end", class: "mono", "font-size": 9, fill: "var(--muted)" });
  tEnd.textContent = (t1 - t0).toFixed(0) + "s";
  svg.appendChild(tEnd);

  function drawSeries(pts, color) {
    if (!pts.length) return;
    var d = pts.map(function (p, i) {
      return (i === 0 ? "M" : "L") + xT(p.t).toFixed(1) + "," + yS(p.v).toFixed(1);
    }).join(" ");
    svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: color, "stroke-width": 1.3, "stroke-linecap": "round", opacity: 0.85 }));
  }
  drawSeries(bySensor.left, "var(--chart-left)");
  drawSeries(bySensor.right, "var(--chart-right)");

  var yt = svgEl("text", { x: W - M.r, y: M.t + 4, "text-anchor": "end", class: "mono", "font-size": 9, fill: "var(--muted)" });
  yt.textContent = "m/s vertical";
  svg.appendChild(yt);
}

function loadRawSession() {
  var status = document.getElementById("rawStatus");
  var btn = document.getElementById("loadRawBtn");
  if (!status || !btn) return;
  status.textContent = "Loading from Supabase…";
  btn.disabled = true;
  fetch(RAW_SESSION_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      drawRawSessionChart(data);
      status.textContent = data.length + " raw samples loaded live from Supabase Storage (unprocessed session).";
    })
    .catch(function (err) {
      status.textContent = "Couldn't load the session (" + err.message + "). The signed link may have expired, or the bucket may not be reachable from here yet.";
    })
    .then(function () { btn.disabled = false; });
}

var loadRawBtn = document.getElementById("loadRawBtn");
if (loadRawBtn) loadRawBtn.addEventListener("click", loadRawSession);
