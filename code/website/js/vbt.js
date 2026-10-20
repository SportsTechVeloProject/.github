/* vbt.js — velocity-based weight suggestions.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order.

   The coach picks a training zone per exercise; the app suggests the weight:

   1. First set: from the athlete's load–velocity line, fitted through their
      recent recorded sets of that lift (weight vs. the set's speed). Read off
      the weight that should move at the middle of the zone. Not enough
      different weights yet → the last weight they used in that zone.
   2. Next set: after a recorded set, compare its speed with the zone. Faster
      → heavier, slower → lighter, by as much as the athlete's line says that
      speed difference is worth in kilos.

   A set's speed is the average of its reps' mean speeds (left and right
   averaged). Suggestions are rounded to 2.5 kg; athletes can type any weight. */
"use strict";

var VBT = {
  HISTORY_DAYS: 42,           // sets older than this don't shape the line
  MIN_POINTS: 3,              // sets needed for a line…
  MIN_SPREAD_KG: 10,          // …spread over at least this many kilos
  STEP_KG: 2.5,               // suggestions are rounded to this
  MAX_CHANGE: 0.10,           // next-set suggestion moves at most 10% of the weight
  // When the athlete has no line yet: roughly how much speed one more kilo
  // costs, per lift (m/s per kg). Typical values; replaced by the athlete's own.
  DEFAULT_SLOPE: { squat: -0.006, bench: -0.010, deadlift: -0.005 }
};

function roundToStep(kg) { return Math.round(kg / VBT.STEP_KG) * VBT.STEP_KG; }

// A set's speed: the average of its reps' mean speeds.
function setSpeed(reps) {
  var speeds = (reps || []).map(repMeanSpeed).filter(function (v) { return v !== null; });
  return speeds.length ? speeds.reduce(function (a, b) { return a + b; }, 0) / speeds.length : null;
}

// Least-squares line speed = a + b·kg through { kg, v } points. Null unless
// there are enough sets at different enough weights and speed drops with load.
function loadVelocityLine(points) {
  if (points.length < VBT.MIN_POINTS) return null;
  var kgs = points.map(function (p) { return p.kg; });
  if (Math.max.apply(null, kgs) - Math.min.apply(null, kgs) < VBT.MIN_SPREAD_KG) return null;
  var n = points.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  points.forEach(function (p) { sx += p.kg; sy += p.v; sxx += p.kg * p.kg; sxy += p.kg * p.v; });
  var b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (!(b < 0)) return null; // heavier must be slower, or the data isn't usable yet
  return { a: (sy - b * sx) / n, b: b, n: n };
}

// The athlete's recorded sets of one exercise (bank key, e.g. "back_squat";
// a pause squat has its own line): [{ kg, v, date }], newest last.
// history: rows from `sessions` with weight_kg, recorded_at, exercise and reps.
function liftPoints(history, exerciseKey) {
  var since = Date.now() - VBT.HISTORY_DAYS * 86400000;
  return history.filter(function (s) {
    return s.exercise === exerciseKey && s.weight_kg != null && new Date(s.recorded_at).getTime() >= since;
  }).map(function (s) {
    return { kg: Number(s.weight_kg), v: setSpeed(s.reps), date: s.recorded_at };
  }).filter(function (p) { return p.v !== null && p.kg > 0; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

// First set: { kg, why } or null when there's nothing to go on.
function suggestStart(points, range) {
  var line = loadVelocityLine(points);
  if (line) {
    var kg = roundToStep((range.mid - line.a) / line.b);
    if (kg > 0) {
      return { kg: kg, why: "from your load–velocity line (" + line.n + " recorded sets, last " + Math.round(VBT.HISTORY_DAYS / 7) + " weeks)" };
    }
  }
  // Fallback: the most recent weight whose set landed in the zone, else the most recent weight.
  var inZone = points.filter(function (p) { return p.v >= range.lo && p.v <= range.hi; });
  var pick = inZone[inZone.length - 1] || points[points.length - 1];
  if (!pick) return null;
  return {
    kg: roundToStep(pick.kg),
    why: inZone.length ? "the last weight that landed in this zone (" + new Date(pick.date).toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ")"
      : "your last recorded weight; record a few sets at different weights to get suggestions from your own line"
  };
}

// After a recorded set: { kg, why, state } where state is up / hold / down / stop.
// firstSpeed: speed of the first recorded set of this exercise today (for VL).
function suggestNext(currentKg, speed, range, points, liftKey, velocityLoss, firstSpeed) {
  var v = speed.toFixed(2) + " m/s";
  if (velocityLoss != null && firstSpeed && speed < firstSpeed) {
    var loss = (firstSpeed - speed) / firstSpeed * 100;
    if (loss >= velocityLoss) {
      return { kg: currentKg, state: "stop", why: "speed is down " + Math.round(loss) + "% from your first set, past the coach's " + velocityLoss + "% limit: stop this exercise here" };
    }
  }
  if (speed >= range.lo && speed <= range.hi) {
    return { kg: currentKg, state: "hold", why: "moved " + v + ", inside the zone: stay at this weight" };
  }
  var line = loadVelocityLine(points);
  var slope = line ? line.b : VBT.DEFAULT_SLOPE[liftKey] || -0.006;
  var change = (range.mid - speed) / slope; // kilos to land mid-zone
  var cap = currentKg * VBT.MAX_CHANGE;
  change = Math.max(-cap, Math.min(cap, change));
  var kg = roundToStep(currentKg + change);
  if (kg === currentKg) kg = currentKg + (speed > range.hi ? VBT.STEP_KG : -VBT.STEP_KG);
  return speed > range.hi
    ? { kg: kg, state: "up", why: "moved " + v + ", faster than the zone (" + range.lo.toFixed(2) + "–" + range.hi.toFixed(2) + "): go heavier" }
    : { kg: kg, state: "down", why: "moved " + v + ", slower than the zone (" + range.lo.toFixed(2) + "–" + range.hi.toFixed(2) + "): go lighter" };
}
