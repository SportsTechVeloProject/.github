/* core.js — Shared data model and helpers. Loaded first; everything else leans on it.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order. */
"use strict";

/* ---------------- data model ---------------- */
// Speed zones, fastest first, by a set's mean bar speed. The same limits for
// every lift for now; give a lift its own list in EXERCISES if that changes.
//
// The website works in the five velocity zones from the literature (Bryan
// Mann's VBT zones, as published by GymAware: gymaware.com/velocity_zones).
// The code underneath has three groups, the same words as the data team's
// analysis TYPE and what recordings save: fast / medium / slow. Each zone
// belongs to exactly one group:
//   fast   > 1.30 m/s        starting strength
//   medium 0.50–1.30 m/s     speed-strength, strength-speed, accelerative strength
//   slow   < 0.50 m/s        absolute strength
var SPEED_ZONES = [
  { key: "starting_strength",     min: 1.30, label: "Starting strength",     group: "fast" },
  { key: "speed_strength",        min: 1.00, label: "Speed-strength",        group: "medium" },
  { key: "strength_speed",        min: 0.75, label: "Strength-speed",        group: "medium" },
  { key: "accelerative_strength", min: 0.50, label: "Accelerative strength", group: "medium" },
  { key: "absolute_strength",     min: 0,    label: "Absolute strength",     group: "slow" }
];
var SPEED_GROUPS = [
  { key: "fast",   min: 1.30 },
  { key: "medium", min: 0.50 },
  { key: "slow",   min: 0 }
];

function foldZoneName(name) {
  return String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, " ").trim();
}

// Any zone name -> a zone key (starting_strength … absolute_strength), or
// "medium" for the broad middle group (a coach may aim anywhere in
// 0.50–1.30 m/s), or null. Accepts the keys, the labels, the group words
// and the names used earlier (Power, Traditional, Maximal strength…).
function zoneKey(name) {
  if (!name) return null;
  var z = foldZoneName(name);
  if (!z) return null;
  for (var i = 0; i < SPEED_ZONES.length; i++) {
    if (z === foldZoneName(SPEED_ZONES[i].key) || z === foldZoneName(SPEED_ZONES[i].label)) return SPEED_ZONES[i].key;
  }
  if (/^speed strength/.test(z)) return "speed_strength";
  if (/^strength speed/.test(z)) return "strength_speed";
  if (/^accelerative/.test(z)) return "accelerative_strength";
  if (z === "fast" || z === "speed" || /^(starting|explosiv)/.test(z)) return "starting_strength";
  if (z === "slow" || /^(absolute|max)/.test(z)) return "absolute_strength";
  if (z === "medium" || /^(power|traditional)/.test(z)) return "medium";
  return null;
}

// Any zone name -> its code group: fast / medium / slow (null if unknown).
// This is what the analysis and the database use.
function zoneGroup(name) {
  var key = zoneKey(name);
  if (key === "medium") return "medium";
  var zone = SPEED_ZONES.filter(function (z) { return z.key === key; })[0];
  return zone ? zone.group : null;
}

// What the website shows for a zone (any name accepted); unknown names as they are.
function zoneLabel(name) {
  var key = zoneKey(name);
  if (key === "medium") return "Speed-strength to accelerative strength";
  var zone = SPEED_ZONES.filter(function (z) { return z.key === key; })[0];
  return zone ? zone.label : (name || "");
}

// Fictional lifter, fictional load-velocity profile per lift.
// V(%1RM) = a - b * (%1RM/100), calibrated so V(100%) = v1RM (approx. published VBT anchors).
var EXERCISES = {
  squat: {
    name: "Back Squat",
    oneRM: 140,
    a: 1.05, b: 0.73,
    cyclePath: "down-up",           // top -> bottom -> top
    cycleLabels: ["Top", "Bottom (depth)", "Top"],
    driftCenters: [50],             // forward drift risk is at depth
    driftCaption: "Positive = the bar drifts forward, toward your toes; negative = back toward your heels.",
    zones: SPEED_ZONES,
    history: [
      { date: "Aug 9",  time: "6:10 PM", weight: 100 },
      { date: "Aug 16", time: "6:05 PM", weight: 105 },
      { date: "Aug 23", time: "5:50 PM", weight: 110 },
      { date: "Aug 30", time: "6:20 PM", weight: 112.5 },
      { date: "Sep 6",  time: "6:00 PM", weight: 115 },
      { date: "Sep 12", time: "6:15 PM", weight: 117.5 }
    ]
  },
  bench: {
    name: "Bench Press",
    oneRM: 100,
    a: 0.90, b: 0.73,
    cyclePath: "down-up",           // lockout -> chest -> lockout
    cycleLabels: ["Top (lockout)", "Bottom (chest)", "Top (lockout)"],
    driftCenters: [50],             // drift risk is off the chest
    driftCaption: "Positive = the bar drifts toward the rack, over your face; negative = back toward your hips.",
    zones: SPEED_ZONES,
    history: [
      { date: "Aug 9",  time: "5:40 PM", weight: 75 },
      { date: "Aug 16", time: "5:35 PM", weight: 77.5 },
      { date: "Aug 23", time: "5:50 PM", weight: 80 },
      { date: "Aug 30", time: "5:45 PM", weight: 82.5 },
      { date: "Sep 6",  time: "5:55 PM", weight: 82.5 },
      { date: "Sep 12", time: "5:50 PM", weight: 85 }
    ]
  },
  deadlift: {
    name: "Deadlift",
    oneRM: 170,
    a: 0.85, b: 0.70,
    cyclePath: "up-down",           // floor -> lockout -> floor
    cycleLabels: ["Bottom (floor)", "Top (lockout)", "Bottom (floor)"],
    driftCenters: [15, 85],         // drift risk is breaking the floor and re-setting
    driftCaption: "Positive = the bar drifts away from your shins, out in front; negative = back into your shins.",
    zones: SPEED_ZONES,
    history: [
      { date: "Aug 9",  time: "7:05 PM", weight: 130 },
      { date: "Aug 16", time: "7:00 PM", weight: 135 },
      { date: "Aug 23", time: "7:10 PM", weight: 140 },
      { date: "Aug 30", time: "6:55 PM", weight: 142.5 },
      { date: "Sep 6",  time: "7:15 PM", weight: 145 },
      { date: "Sep 12", time: "7:05 PM", weight: 150 }
    ]
  }
};

// What each zone means, by zone key. pct = typical share of 1RM (pctShort for
// tables), from the
// GymAware article text (Bryan Mann); the zone itself is always decided by
// the measured bar speed, never by the %.
var ZONE_INFO = {
  starting_strength: {
    pct: "bodyweight or very light loads", pctShort: "bodyweight",
    desc: "Jumps, throws and other movements with very little load, starting from a standstill, as fast as possible.",
    benefit: "Trains the ability to overcome inertia from a dead stop: getting the body or a light implement moving explosively. Builds speed, not maximal strength."
  },
  speed_strength: {
    pct: "about 20–40% of 1RM", pctShort: "20–40%",
    desc: "Light loads moved as fast as possible: speed comes first, strength second. Weighted jumps, throws, cleans, banded work.",
    benefit: "Builds explosiveness under a light load, for example sprint starts, jumping and throwing."
  },
  strength_speed: {
    pct: "about 40–60% of 1RM", pctShort: "40–60%",
    desc: "Moderately heavy loads moved as fast as possible.",
    benefit: "Builds the ability to produce a lot of force quickly: \"fast but still strong\", like a first step or a change of direction."
  },
  accelerative_strength: {
    pct: "about 65–80% of 1RM", pctShort: "65–80%",
    desc: "Heavy loads driven as fast as possible, e.g. squats, bench press and deadlifts in the working-set range.",
    benefit: "Bridges raw strength and usable power: pushing hard against a heavy load and still accelerating it."
  },
  absolute_strength: {
    pct: "about 80–100% of 1RM", pctShort: "80–100%",
    desc: "Very heavy loads where the bar can't move faster than about 0.5 m/s: heavy triples, doubles and near-maximal singles.",
    benefit: "Builds maximal strength, the ability to exert as much force as possible. Essential for powerlifting and peaking, but taxing, so use it with care."
  }
};

function zoneRangeLabel(ex, idx) {
  var z = ex.zones[idx];
  if (idx === 0) return "> " + z.min.toFixed(2) + " m/s";
  var upper = ex.zones[idx - 1].min;
  if (z.min === 0) return "< " + upper.toFixed(2) + " m/s";
  return z.min.toFixed(2) + "–" + upper.toFixed(2) + " m/s";
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Colour token for a speed's zone: --zone-1 (fastest zone) to --zone-5.
function zoneColor(ex, v) {
  for (var i = 0; i < ex.zones.length; i++) {
    if (v >= ex.zones[i].min) return "var(--zone-" + (i + 1) + ")";
  }
  return "var(--zone-" + ex.zones.length + ")";
}

// The speed range of a training zone for a lift, { lo, hi, mid } in m/s, for
// aiming a set's average speed. Zones are listed fastest first and the top
// zone has no upper limit (nor the bottom one a lower), so those two get a
// band of ZONE_OPEN_BAND for aiming. Zone limits live in EXERCISES above.
var ZONE_OPEN_BAND = 0.2;
function zoneRange(ex, zone) {
  var key = zoneKey(zone), idx = -1;
  if (key === "medium") return { lo: 0.50, hi: 1.30, mid: 0.90 }; // the whole middle group
  ex.zones.forEach(function (z, i) { if (z.key === key) idx = i; });
  if (idx === -1) return null;
  var lo = ex.zones[idx].min;
  var hi = idx === 0 ? lo + ZONE_OPEN_BAND : ex.zones[idx - 1].min;
  if (lo === 0) lo = Math.max(0.05, hi - ZONE_OPEN_BAND);
  return { lo: lo, hi: hi, mid: (lo + hi) / 2 };
}

// Uneven rep: left and right mean speeds differ by more than this share of
// the rep's speed. 0.22 (22%) is a placeholder chosen so only the most uneven
// rep in the first recorded set gets flagged; change it here once there's
// enough clean data to pick a real threshold.
var LR_MISMATCH_LIMIT = 0.22;
// Share by which left and right differ (0.25 = 25%), or null without both sides.
function lrMismatch(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return null;
  var mean = (Number(left) + Number(right)) / 2;
  return mean > 0 ? Math.abs(Number(left) - Number(right)) / mean : null;
}
function isUneven(left, right) {
  var m = lrMismatch(left, right);
  return m !== null && m > LR_MISMATCH_LIMIT;
}

// The zone key (e.g. strength_speed) a speed falls in. Show it with zoneLabel();
// zoneGroup() gives fast / medium / slow.
function zoneFor(ex, v) {
  for (var i = 0; i < ex.zones.length; i++) {
    if (v >= ex.zones[i].min) return ex.zones[i].key;
  }
  return ex.zones[ex.zones.length - 1].key;
}

// Deterministic set simulator: given a load, derive first-rep velocity from
// the load-velocity profile, estimate reps-to-near-failure (Brzycki-style),
// and taper velocity across the reps actually performed.
function simulateSet(weight, ex) {
  var pct = clamp((weight / ex.oneRM) * 100, 30, 105);
  var v1 = Math.max(0.05, ex.a - ex.b * (pct / 100));
  var maxReps = clamp((102.78 - pct) / 2.78, 1, 20);
  var reps = clamp(Math.round(maxReps) - 1, 1, 15);
  var lossFraction = clamp((reps / maxReps) * 0.38, 0, 0.55);
  var vLast = v1 * (1 - lossFraction);
  var velocities = [];
  for (var i = 0; i < reps; i++) {
    var t = reps === 1 ? 0 : i / (reps - 1);
    var tc = Math.pow(t, 1.15);
    velocities.push(+(v1 - (v1 - vLast) * tc).toFixed(3));
  }
  return { pct: pct, v1: v1, reps: reps, velocities: velocities, lossPct: lossFraction * 100 };
}

// The numbers behind one history row. A recorded set brings its own
// (row.sim, built from the database in mysets.js); demo rows are simulated
// from their load.
function setData(ex, row) {
  return row.sim || simulateSet(row.weight, ex);
}
