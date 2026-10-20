/* mysets.js — the logged-in lifter's recorded sets, from Supabase.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order.

   Logged out, the exercise tabs show the demo history in core.js. Logged in,
   they show the lifter's own sets: one `sessions` row per set, with the
   per-rep speeds from `reps` (written by python/main.py). Each set is turned
   into the same shape simulateSet() returns, so the charts and tables draw
   it the same way, marked `real` so they can skip what isn't measured yet. */
"use strict";

// sessions.exercise -> the app's exercise tab
var EXERCISE_TABS = { back_squat: "squat", bench_press: "bench", deadlift: "deadlift" };

var mySets = { active: false, status: "" };
Object.keys(EXERCISES).forEach(function (k) { EXERCISES[k].demoHistory = EXERCISES[k].history; });

function realSetFromSession(s) {
  var reps = (s.reps || []).slice()
    .sort(function (a, b) { return a.rep_index - b.rep_index; })
    .filter(function (r) { return repMeanSpeed(r) !== null; });
  function avg(a, b) {
    if (a === null && b === null) return null;
    if (a === null) return Number(b);
    if (b === null) return Number(a);
    return (Number(a) + Number(b)) / 2;
  }
  var velocities = reps.map(function (r) { return +repMeanSpeed(r).toFixed(3); });
  var n = velocities.length;
  var first = velocities[0], last = velocities[n - 1];
  var when = new Date(s.recorded_at);
  return {
    date: when.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    time: when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    weight: s.weight_kg === null ? null : Number(s.weight_kg),
    sessionId: s.id,
    sim: {
      real: true,
      pct: null,              // no 1RM for real data yet
      reps: n,
      velocities: velocities, // mean speed per rep, left/right averaged
      peaks: reps.map(function (r) { return avg(r.left_peak_velocity, r.right_peak_velocity); }),
      left: reps.map(function (r) { return r.left_mean_velocity; }),
      right: reps.map(function (r) { return r.right_mean_velocity; }),
      v1: n ? first : null,
      lossPct: n > 1 && first > 0 ? (first - last) / first * 100 : 0
    }
  };
}

// Swap every exercise tab between the demo and the lifter's sets, then
// redraw if an exercise tab is on screen. A tab where the lifter has no sets
// yet (or while loading) keeps the demo, flagged so the page labels it as
// example data instead of showing an empty screen.
function showSets(active, byTab, status) {
  mySets.active = active;
  mySets.status = status || "";
  Object.keys(EXERCISES).forEach(function (k) {
    var ex = EXERCISES[k];
    var own = (active && byTab && byTab[k]) || [];
    ex.history = own.length ? own : ex.demoHistory;
    ex.showingExample = active && !own.length;
    state.selected[k] = ex.history.length - 1;
  });
  if (!document.getElementById("appView").hidden && !document.getElementById("exerciseView").hidden) {
    renderExercise(state.ex);
  }
}

// Called on every login and logout (see onAccountChanged in team.js).
function loadMySets() {
  if (!sb || !currentUser) { showSets(false); return; }
  var userId = currentUser.id;
  showSets(true, null, "Loading your sets…");
  sb.from("sessions")
    .select("id, exercise, weight_kg, recorded_at, reported_rep_count, " +
            "reps(rep_index, left_mean_velocity, right_mean_velocity, left_peak_velocity, right_peak_velocity)")
    .eq("user_id", userId)
    .order("recorded_at", { ascending: true })
    .then(function (res) {
      if (!currentUser || currentUser.id !== userId) return; // logged out meanwhile
      if (res.error) {
        console.error("loadMySets error:", res.error);
        showSets(true, null, "Couldn't load your sets: " + res.error.message);
        return;
      }
      var byTab = {};
      (res.data || []).forEach(function (s) {
        var tab = EXERCISE_TABS[s.exercise];
        if (tab) (byTab[tab] = byTab[tab] || []).push(realSetFromSession(s));
      });
      showSets(true, byTab);
    });
}
