/* training.js — "My training": an athlete's workouts, the sets they log, and
   recording sets with the Movesense sensors.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order.

   Reads workouts (with their plan) and set_logs from Supabase; see
   docs/database.md. On the left, the workouts grouped by plan and week; on
   the right, the selected day's exercises, each with one row per set:
   weight, reps and Done. Done saves a set_logs row.

   Squat, bench and deadlift (and their variants) can be recorded: with both
   sensors connected a set row offers Record; Stop uploads the recording
   (recordings.js), saves the set with its recording_id, and the row then
   shows the analysis once the processing watcher has written the reps.

   Free workouts are days without a plan (e.g. active recovery): the athlete
   adds exercises as they go.

   A coach can open the same view for one of their athletes (team page →
   "See their training"); it's read-only then. */
"use strict";

var training = {
  athleteId: null,    // whose training is shown; null = the logged-in user's own
  athleteName: "",
  workouts: [],
  logs: [],           // every set this athlete has logged
  recordings: {},     // session id -> { analyzed_at, analysis_error, reps }
  history: [],        // the athlete's recent recorded sets (sessions + reps), for weight suggestions (vbt.js)
  freeExercises: {},  // free workout id -> exercise names added but not logged yet
  selectedId: null,
  calMonth: null,     // "YYYY-MM" shown in the calendar
  restDate: null,     // a day without workouts picked in the calendar ("YYYY-MM-DD")
  tab: "training",    // which half of the Plans tab: "training" or "builder"
  recording: null,    // { workoutId, itemIndex, name, setNo } while a set is being recorded
  uploading: null,    // same shape, while a finished recording uploads
  pollTimer: null
};

var SET_FIELDS = "id, workout_id, item_index, exercise, set_no, weight_kg, reps, duration_s, distance_m, done_at, recording_id";
var WORKOUT_FIELDS = "id, athlete_id, assignment_id, week_no, day_no, label, scheduled_date, started_at, completed_at";
var POLL_MS = 1000;  // how often a set waiting for its analysis checks for the result
var POLL_GIVE_UP_MS = 3 * 60 * 1000;

function trainingReadOnly() {
  return !!(training.athleteId && currentUser && training.athleteId !== currentUser.id);
}

function todayString() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// done · today · missed · upcoming. Skipped workouts stay where they were.
function workoutStatus(w) {
  if (w.completed_at) return "done";
  var today = todayString();
  if (w.scheduled_date < today) return "missed";
  if (w.scheduled_date === today) return "today";
  return "upcoming";
}
var STATUS_TEXT = { done: "Done", today: "Today", missed: "Missed", upcoming: "" };

function workoutPlan(w) {
  return (w.plan_assignments && w.plan_assignments.plans) || null;
}

// The plan day behind a planned workout: { label, items } or null.
function workoutDay(w) {
  var plan = workoutPlan(w);
  if (!plan || !plan.content || !w.week_no) return null;
  var week = (plan.content.weeks || [])[w.week_no - 1];
  return (week && week.days[w.day_no - 1]) || null;
}

function workoutTitle(w) {
  var day = workoutDay(w);
  return w.label || (day && day.label) || "Workout";
}

// A free workout's exercises: what's been logged (in order) plus what was added.
// An exercise logged with a time stays a timed exercise.
function freeItems(w) {
  var items = [];
  function has(name) { return items.some(function (it) { return it.name === name; }); }
  training.logs.filter(function (l) { return l.workout_id === w.id; })
    .sort(function (a, b) { return a.done_at < b.done_at ? -1 : 1; })
    .forEach(function (l) {
      if (has(l.exercise)) return;
      items.push({ name: l.exercise, lift: matchLift(l.exercise), sets: null, reps: null, duration: null });
    });
  (training.freeExercises[w.id] || []).forEach(function (it) {
    if (!items.some(function (x) { return exerciseId(x.name) === exerciseId(it.name); })) items.push(it);
  });
  return items;
}


/* ---------------- tabs inside Plans ---------------- */
// Logged out: only the plan builder (the demo). Logged in: My training first.
// Logged out: the plan builder demo. Athletes: only My training. Coaches and
// admins: both, switchable.
function refreshPlansTab() {
  var loggedIn = !!(sb && currentUser);
  var staff = loggedIn && isTeamStaff();
  document.getElementById("plansSwitch").hidden = !staff;
  if (loggedIn && !staff) training.tab = "training";
  showPlansTab(loggedIn ? training.tab : "builder");
}

function showPlansTab(tab) {
  if (tab === "builder" && sb && currentUser && !isTeamStaff()) tab = "training";
  if (sb && currentUser) training.tab = tab;
  document.getElementById("plansTabTraining").setAttribute("aria-selected", String(tab === "training"));
  document.getElementById("plansTabBuilder").setAttribute("aria-selected", String(tab === "builder"));
  document.getElementById("trainingView").hidden = tab !== "training";
  document.getElementById("planBuilderView").hidden = tab !== "builder";
  if (tab === "training") loadTraining();
  updateSensorBar();
}

// The sensor panel is for recording your own sets. Hidden while a coach
// looks at an athlete's training: it's read-only, and a recording would be
// saved to the coach's account, not the athlete's.
function updateSensorBar() {
  var readOnlyTraining = !document.getElementById("plansView").hidden && training.tab === "training" && trainingReadOnly();
  document.getElementById("sensorBar").hidden = readOnlyTraining;
}

function trainingVisible() {
  return !document.getElementById("appView").hidden && !document.getElementById("plansView").hidden &&
    !document.getElementById("trainingView").hidden;
}

// From the team page: show an athlete's training as they see it (read-only).
function openAthleteTraining(member) {
  training.athleteId = currentUser && member.user_id === currentUser.id ? null : member.user_id;
  training.athleteName = member.full_name;
  training.selectedId = null;
  training.tab = "training";
  showPlans();
  window.scrollTo(0, 0);
}

// Login or logout: back to the logged-in user's own training.
function resetTraining() {
  training.athleteId = null;
  training.selectedId = null;
  training.workouts = [];
  training.logs = [];
  training.recordings = {};
  if (!document.getElementById("plansView").hidden) refreshPlansTab();
}

/* ---------------- loading ---------------- */
function setTrainingStatus(text) { document.getElementById("trainingStatus").textContent = text || ""; }

function loadTraining() {
  if (!sb || !currentUser) return;
  var athleteId = training.athleteId || currentUser.id;
  var readOnly = trainingReadOnly();
  updateSensorBar();
  document.getElementById("plansTabTraining").textContent = readOnly ? training.athleteName + "'s training" : "My training";
  document.getElementById("trainingEyebrow").textContent = readOnly ? "Read-only · as " + training.athleteName + " sees it" : "My training";
  document.getElementById("trainingHeading").textContent = readOnly ? training.athleteName + "'s training" : "Your workouts";
  document.getElementById("trainingBackRow").hidden = !readOnly;
  document.getElementById("freeWorkoutBtn").hidden = readOnly;
  setTrainingStatus("Loading workouts…");

  Promise.all([
    sb.from("workouts")
      .select(WORKOUT_FIELDS + ", plan_assignments(id, plans(id, name, content))")
      .eq("athlete_id", athleteId)
      .order("scheduled_date", { ascending: true }),
    sb.from("set_logs").select(SET_FIELDS).eq("athlete_id", athleteId),
    sb.from("sessions")
      .select("id, exercise, weight_kg, recorded_at, analyzed_at, analysis_error, reps(left_mean_velocity, right_mean_velocity)")
      .eq("user_id", athleteId)
      .gte("recorded_at", new Date(Date.now() - VBT.HISTORY_DAYS * 86400000).toISOString())
  ]).then(function (results) {
    if ((training.athleteId || currentUser.id) !== athleteId) return; // switched meanwhile
    var wRes = results[0], lRes = results[1];
    var err = wRes.error || lRes.error;
    if (err) {
      document.getElementById("trainingLayout").hidden = true;
      var column = (err.message || "").match(/column [\w.]+\.(started_at|duration_s|distance_m|analyzed_at|analysis_error) does not exist/);
      setTrainingStatus(column
        ? "The database is missing the newest columns (" + column[1] + "). Run the files in supabase/migrations in the Supabase SQL editor, then reload."
        : /workouts|set_logs|schema cache|does not exist/i.test(err.message || "")
          ? "Training isn't set up in Supabase yet. Run supabase/plans.sql in the Supabase SQL editor."
          : "Couldn't load workouts: " + err.message);
      return;
    }
    training.workouts = wRes.data || [];
    training.logs = lRes.data || [];
    training.history = (results[2] && results[2].data) || [];
    if (!training.workouts.some(function (w) { return w.id === training.selectedId; })) {
      training.selectedId = defaultWorkoutId();
    }
    renderTraining();
    offerPendingUpload();
    var recIds = training.logs.map(function (l) { return l.recording_id; }).filter(Boolean);
    fetchRecordings(recIds).then(function (recs) {
      training.recordings = recs;
      renderTrainingDay();
      startPolling();
    });
  });
}

// Today's workout; otherwise the next one coming up; otherwise the latest.
function defaultWorkoutId() {
  var today = todayString(), list = training.workouts;
  var pick = list.filter(function (w) { return w.scheduled_date === today; })[0]
    || list.filter(function (w) { return w.scheduled_date > today; })[0]
    || list[list.length - 1];
  return pick ? pick.id : null;
}

/* ---------------- waiting for analysis ---------------- */
function pendingRecordingIds() {
  return training.logs.map(function (l) { return l.recording_id; }).filter(function (id) {
    var r = id && training.recordings[id];
    return id && (!r || (!r.analyzed_at && !r.analysis_error));
  });
}

function startPolling() {
  clearTimeout(training.pollTimer);
  var started = Date.now();
  (function poll() {
    var ids = pendingRecordingIds();
    if (!ids.length || Date.now() - started > POLL_GIVE_UP_MS) { renderTrainingDay(); return; }
    training.pollTimer = setTimeout(function () {
      fetchRecordings(ids).then(function (recs) {
        Object.keys(recs).forEach(function (id) {
          training.recordings[id] = recs[id];
          if (recs[id].analyzed_at) {
            training.history = training.history.filter(function (h) { return h.id !== id; }).concat([recs[id]]);
          }
        });
        renderTrainingDay();
        poll();
      });
    }, POLL_MS);
  })();
}

/* ---------------- rendering ---------------- */
function renderTraining() {
  var layout = document.getElementById("trainingLayout");
  // The calendar shows even with no workouts yet, so any day can be picked.
  layout.hidden = false;
  setTrainingStatus(training.workouts.length ? "" : trainingReadOnly()
    ? training.athleteName + " has no workouts yet. Assign them a plan under Plan builder."
    : "No workouts yet. When your coach assigns you a plan, your workouts show up here. Pick a day in the calendar, or start a free workout.");
  renderTrainingList();
  renderTrainingDay();
}

function renderTrainingList() {
  var nav = document.getElementById("trainingList");
  nav.innerHTML = "";
  var lastGroup = null;
  training.workouts.forEach(function (w) {
    var plan = workoutPlan(w);
    var group = w.assignment_id
      ? (plan ? plan.name : "Plan") + (w.week_no ? " · Week " + w.week_no : "")
      : "Free workouts";
    if (group !== lastGroup) {
      nav.appendChild(el("p", "training-group", group));
      lastGroup = group;
    }
    var status = workoutStatus(w);
    var b = el("button", "training-item status-" + status);
    b.type = "button";
    if (w.id === training.selectedId) b.setAttribute("aria-current", "true");
    b.appendChild(el("span", "training-item-date", prettyDay(w.scheduled_date)));
    b.appendChild(el("span", "training-item-label", workoutTitle(w)));
    if (STATUS_TEXT[status]) b.appendChild(el("span", "training-pill " + status, status === "done" ? "✓ Done" : STATUS_TEXT[status]));
    b.addEventListener("click", function () { selectWorkout(w); });
    nav.appendChild(b);
  });
  renderTrainingCalendar();
}

function selectWorkout(w) {
  training.selectedId = w.id;
  training.restDate = null;
  training.calMonth = w.scheduled_date.slice(0, 7);
  renderTrainingList();
  renderTrainingDay();
}


/* ---------------- ⓘ explanations ---------------- */
// Short explanations shown on hover (or tap / keyboard focus) next to the
// thing they explain.
var TIPS = {
  movesense: "Record this exercise with the two Movesense sensors on the bar: press \u25cf Record and stand still for a few seconds before the set, and press \u25a0 Stop only after the bar is back in the rack (the analysis uses both to find the set). You get each rep's speed, and with a zone from your coach, a weight suggestion for the next set.",
  soon: "The sensors can record this lift and the recording is saved, but its analysis hasn't been written yet. Speeds appear by themselves once it is.",
  manual: "Not recorded with the sensors: fill in the fields and press Done.",
  zone: "Velocity-based training: instead of a fixed weight, your coach picks a speed zone. Choose the weight so the set's average rep speed lands in this range. The app suggests it from your own recorded sets.",
  start: "From your load–velocity line: your recent recorded sets of this exercise at different weights show how fast each weight moves for you. This is the weight that should move at the middle of the zone, rounded to 2.5 kg. You can always type your own.",
  next: "Your last set's average speed compared with the zone: faster means the weight is light for you today, slower means heavy. How many kilos to change comes from your own load–velocity line, at most 10% per set.",
  speed: "The set's average speed: the mean speed of each rep, averaged over the set. ✓ means it landed in your coach's zone; ↑ faster than the zone (the weight was light), ↓ slower (heavy).",
  noZone: "Your coach hasn't picked a speed zone for this lift, so there's no speed target and no weight suggestions. You can still record the sets and see their speed.",
  result: "Mean: the average speed of the set's reps, the number zones use. Fastest: the quickest rep. Velocity loss: how much slower the last rep was than the first; more loss means more fatigue.",
  timer: "Start workout starts the clock, and it keeps running if you leave the page. Logging a set starts it too. Finish workout stops it and saves how long you trained."
};

function infoTip(text) {
  var tip = el("button", "info-tip", "i");
  tip.type = "button";
  tip.dataset.tip = text;
  tip.setAttribute("aria-label", text);
  return tip;
}
function withTip(node, text) { node.appendChild(infoTip(text)); return node; }

// Jump to the sensor panel at the top and make it stand out for a moment.
function showSensorPanel() {
  var bar = document.getElementById("sensorBar");
  if (!bar) return;
  bar.scrollIntoView({ behavior: "smooth", block: "start" });
  bar.classList.remove("is-flashing");
  void bar.offsetWidth; // restart the animation
  bar.classList.add("is-flashing");
}

/* ---------------- calendar ---------------- */
// A month at a time: days with workouts are coloured by status, empty days are
// rest days. Clicking a day opens its workout (clicking again cycles through
// several on the same day).
var CAL_STATUS_ORDER = ["today", "missed", "upcoming", "done"];
function renderTrainingCalendar() {
  var host = document.getElementById("trainingCalendar");
  host.innerHTML = "";
  var selected = training.workouts.filter(function (x) { return x.id === training.selectedId; })[0];
  var month = training.calMonth || (selected ? selected.scheduled_date : todayString()).slice(0, 7);
  training.calMonth = month;
  var y = +month.slice(0, 4), m = +month.slice(5, 7);

  var head = el("div", "training-cal-head");
  function shift(by) {
    var d = new Date(Date.UTC(y, m - 1 + by, 1));
    training.calMonth = d.toISOString().slice(0, 7);
    renderTrainingCalendar();
  }
  var prev = button("\u2039", "training-cal-nav", function () { shift(-1); });
  prev.setAttribute("aria-label", "Previous month");
  var next = button("\u203a", "training-cal-nav", function () { shift(1); });
  next.setAttribute("aria-label", "Next month");
  head.appendChild(prev);
  head.appendChild(el("span", "training-cal-title",
    new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })));
  head.appendChild(next);
  host.appendChild(head);

  var grid = el("div", "training-cal-grid");
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (d) { grid.appendChild(el("span", "training-cal-dow", d)); });
  var byDate = {};
  training.workouts.forEach(function (w) { (byDate[w.scheduled_date] = byDate[w.scheduled_date] || []).push(w); });
  var first = month + "-01";
  for (var blank = 1; blank < isoWeekday(first); blank++) grid.appendChild(el("span", "training-cal-blank"));
  var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  var today = todayString();
  for (var d = 1; d <= days; d++) {
    var date = month + "-" + String(d).padStart(2, "0");
    var list = byDate[date] || [];
    var cell;
    if (list.length) {
      var statuses = list.map(workoutStatus);
      var status = CAL_STATUS_ORDER.filter(function (s) { return statuses.indexOf(s) !== -1; })[0];
      cell = el("button", "training-cal-day has-workout status-" + status);
      cell.type = "button";
      cell.title = list.map(function (w) { return workoutTitle(w) + (STATUS_TEXT[workoutStatus(w)] ? " (" + STATUS_TEXT[workoutStatus(w)].toLowerCase() + ")" : ""); }).join("\n");
      cell.setAttribute("aria-label", prettyDay(date) + ": " + cell.title.replace(/\n/g, ", "));
      (function (list) {
        cell.addEventListener("click", function () {
          var at = list.map(function (w) { return w.id; }).indexOf(training.selectedId);
          selectWorkout(list[(at + 1) % list.length]);
        });
      })(list);
      if (list.some(function (w) { return w.id === training.selectedId; })) cell.setAttribute("aria-current", "true");
    } else {
      cell = el("button", "training-cal-day is-rest");
      cell.type = "button";
      cell.title = "Rest day";
      cell.setAttribute("aria-label", prettyDay(date) + ": rest day");
      (function (date) {
        cell.addEventListener("click", function () {
          training.restDate = date;
          training.selectedId = null;
          renderTrainingList();
          renderTrainingDay();
        });
      })(date);
      if (training.restDate === date) cell.setAttribute("aria-current", "true");
    }
    if (date === today) cell.classList.add("is-today");
    cell.appendChild(el("span", "training-cal-num", String(d)));
    if (list.length > 1) cell.appendChild(el("span", "training-cal-count", String(list.length)));
    grid.appendChild(cell);
  }
  host.appendChild(grid);

  var legend = el("p", "training-cal-legend");
  [["done", "Done"], ["upcoming", "Planned"], ["missed", "Missed"]].forEach(function (p) {
    var item = el("span", "");
    item.appendChild(el("i", "training-cal-key status-" + p[0]));
    item.appendChild(document.createTextNode(p[1]));
    legend.appendChild(item);
  });
  legend.appendChild(el("span", "", "Empty: rest day"));
  host.appendChild(legend);
}

/* ---------------- workout timer ---------------- */
// started_at is set by Start workout (or the first logged set); completed_at
// by Finish workout. Between the two the header shows a running clock.
function formatClock(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(sec).padStart(2, "0");
}
function timerText(w) {
  if (!w.started_at) return "";
  var start = new Date(w.started_at).getTime();
  if (w.completed_at) return "Took " + formatDuration(Math.round((new Date(w.completed_at).getTime() - start) / 1000));
  return "\u23f1 " + formatClock(Date.now() - start);
}
setInterval(function () {
  var node = document.getElementById("workoutTimer");
  if (!node) return;
  var w = training.workouts.filter(function (x) { return x.id === training.selectedId; })[0];
  if (w && w.started_at && !w.completed_at) node.textContent = timerText(w);
}, 1000);

function setWorkoutTimes(w, fields) {
  return sb.from("workouts").update(fields).eq("id", w.id).select("started_at, completed_at").single()
    .then(function (res) {
      if (res.error) { setTrainingStatus("Couldn't update the workout: " + res.error.message); throw res.error; }
      w.started_at = res.data.started_at;
      w.completed_at = res.data.completed_at;
      renderTrainingList();
      renderTrainingDay();
    });
}

// What the app knows about an exercise in a workout: its bank entry (if any),
// the fields a set has, and whether the sensors record it (exercises.js).
// A plan name that isn't in the bank is logged as weight × reps, or as time
// when the plan gave a duration.
function exerciseInfo(item) {
  var ex = findExercise(item.name);
  var log = ex ? ex.log : item.duration != null ? "duration" : "weight_reps";
  // The plan gave a time for something the bank logs by reps: log the time.
  if (item.duration != null && LOG_TYPES[log].fields.indexOf("time") === -1) {
    log = log === "weight_reps" ? "weight_duration" : "duration";
  }
  // Not in the bank but looks like a barbell lift ("Zercher squat"): it can be
  // recorded under its own name; analysis comes when someone writes it.
  var sensor = ex ? ex.sensor || null : matchLift(item.name) ? "barbell" : null;
  var lift = ex ? analyzedLift(ex) : null;
  return {
    ex: ex,
    key: ex ? ex.key : null,
    name: ex ? ex.name : item.name,     // what's stored, so history lines up
    log: log,
    fields: LOG_TYPES[log].fields,
    lift: lift,                          // has analysis and speed zones
    recordable: !!sensor                 // the sensors can record it
  };
}

// Same exercise? Compares by bank entry, so "Squat" and "Back squat" match.
function exerciseId(name) {
  var ex = findExercise(name);
  return ex ? ex.key : exerciseFold(name);
}

// Time fields: minutes when the target is 2 minutes or more, or for
// conditioning and mobility without a target; seconds for holds like planks.
function timeUnit(item, info) {
  if (item.duration != null) return item.duration >= 120 ? 60 : 1;
  return info && info.ex && info.ex.cat === "Core" ? 1 : 60;
}

function logsFor(workoutId, itemIndex, name) {
  var id = exerciseId(name);
  return training.logs.filter(function (l) {
    return l.workout_id === workoutId && (itemIndex === null ? l.item_index === null && exerciseId(l.exercise) === id : l.item_index === itemIndex);
  });
}

// The most recent earlier workout where this exercise was logged.
function lastTime(w, name) {
  var dates = {};
  training.workouts.forEach(function (x) { dates[x.id] = x.scheduled_date; });
  var id = exerciseId(name);
  var earlier = training.logs.filter(function (l) {
    return exerciseId(l.exercise) === id && dates[l.workout_id] && dates[l.workout_id] < w.scheduled_date;
  });
  if (!earlier.length) return null;
  var latest = earlier.reduce(function (a, b) { return dates[b.workout_id] > dates[a.workout_id] ? b : a; });
  var sets = earlier.filter(function (l) { return l.workout_id === latest.workout_id; })
    .sort(function (a, b) { return a.set_no - b.set_no; });
  return { date: dates[latest.workout_id], sets: sets };
}

function setText(l) {
  var parts = [];
  if (l.weight_kg !== null && l.weight_kg !== undefined) parts.push(Number(l.weight_kg) + " kg");
  if (l.reps !== null && l.reps !== undefined) parts.push(l.reps + " reps");
  if (l.duration_s !== null && l.duration_s !== undefined) parts.push(formatDuration(l.duration_s));
  if (l.distance_m !== null && l.distance_m !== undefined) parts.push(formatDistance(l.distance_m));
  return parts.join(" × ") || "done";
}

function formatDistance(m) {
  return m >= 1000 ? +(m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
}

var FIELD_LABEL = { weight: "Weight (kg)", added: "Added kg", reps: "Reps", distance: "Distance (km)" };
function fieldLabel(field, item, info) {
  if (field === "time") return timeUnit(item, info) === 60 ? "Time (min)" : "Time (s)";
  return FIELD_LABEL[field];
}
// Set, the exercise's fields, the measured speed for Movesense lifts, then the buttons.
function rowColumns(info) {
  return "44px repeat(" + info.fields.length + ", minmax(0, 112px))" + (info.lift ? " minmax(0, 84px)" : "") + " minmax(0, 1fr)";
}

function renderTrainingDay() {
  var host = document.getElementById("trainingDay");
  var w = training.workouts.filter(function (x) { return x.id === training.selectedId; })[0];
  // Keep what the athlete has typed: re-rendering mid-edit would wipe unsaved
  // inputs. Untouched fields are left to the new suggestions.
  var typed = {};
  host.querySelectorAll("input[data-key][data-edited]").forEach(function (inp) { typed[inp.dataset.key] = inp.value; });
  host.innerHTML = "";
  if (!w && training.restDate) { renderRestDay(host, training.restDate); return; }
  if (!w) return;
  var readOnly = trainingReadOnly();
  var day = workoutDay(w);
  var plan = workoutPlan(w);
  var status = workoutStatus(w);
  var isFree = !w.assignment_id;
  var items = isFree ? freeItems(w) : (day ? day.items : []);

  // header
  var head = el("div", "training-day-head");
  var titles = el("div");
  titles.appendChild(el("p", "eyebrow", isFree
    ? "Free workout"
    : (plan ? plan.name : "Plan") + (w.week_no ? " · Week " + w.week_no + " · Day " + w.day_no : "")));
  titles.appendChild(el("h3", "", workoutTitle(w)));
  var done = training.logs.filter(function (l) { return l.workout_id === w.id; }).length;
  var planned = isFree ? null : items.reduce(function (n, it) { return n + (it.sets || 1); }, 0);
  titles.appendChild(el("p", "training-day-meta",
    prettyDay(w.scheduled_date) + (STATUS_TEXT[status] ? " · " + STATUS_TEXT[status] : "") +
    " · " + done + (planned ? " of " + planned : "") + " set" + ((planned || done) === 1 ? "" : "s") + " done"));
  head.appendChild(titles);
  var actions = el("div", "training-day-actions");
  var clock = el("span", "training-timer" + (w.started_at && !w.completed_at ? " is-running" : ""), timerText(w));
  clock.id = "workoutTimer";
  if (clock.textContent) actions.appendChild(clock);
  actions.appendChild(infoTip(TIPS.timer));
  if (!readOnly) {
    var now = function () { return new Date().toISOString(); };
    if (!w.started_at && !w.completed_at) {
      actions.appendChild(button("Start workout", "btn", function () { setWorkoutTimes(w, { started_at: now() }); }));
    }
    actions.appendChild(button(w.completed_at ? "Completed ✓ · undo" : "Finish workout", w.completed_at || !w.started_at ? "btn-ghost" : "btn", function () {
      setWorkoutTimes(w, w.completed_at ? { completed_at: null } : { completed_at: now(), started_at: w.started_at || now() });
    }));
    if (isFree) actions.appendChild(deleteFreeWorkoutButton(w));
  }
  head.appendChild(actions);
  host.appendChild(head);

  if (!isFree && !day) {
    host.appendChild(el("p", "log-note", plan
      ? "This day isn't in the plan any more; it may have been edited since it was assigned."
      : "The plan behind this workout is private."));
    return;
  }
  items.forEach(function (item, i) { host.appendChild(exerciseCard(w, item, isFree ? null : i, readOnly)); });
  if (isFree && !readOnly) host.appendChild(addExerciseForm(w));
  if (isFree && !items.length) host.appendChild(el("p", "log-note", readOnly ? "Nothing logged in this workout." : "Add the first exercise below."));

  host.querySelectorAll("input[data-key]").forEach(function (inp) {
    if (typed[inp.dataset.key] !== undefined && !inp.disabled) {
      inp.value = typed[inp.dataset.key];
      inp.dataset.edited = "1";
    }
  });
}

function exerciseCard(w, item, itemIndex, readOnly) {
  var info = exerciseInfo(item);
  var card = el("section", "training-ex" + (info.recordable ? " is-tracked" : ""));
  var top = el("div", "training-ex-head");
  top.appendChild(el("span", "training-ex-name", item.name));
  var bits = [];
  if (item.sets) {
    var reps = item.repsText || (item.reps == null ? "" : String(item.reps));
    bits.push(item.duration != null && item.sets === 1 ? reps : reps ? item.sets + " × " + reps : item.sets + " sets");
  }
  var lt = item.load ? loadText(item) : "";
  if (lt) bits.push(lt);
  if (bits.length) top.appendChild(el("span", "training-ex-target", bits.join("  ·  ")));
  var tag = el("span", "training-tag-wrap");
  tag.appendChild(info.lift
    ? el("span", "training-tag movesense", "Movesense")
    : info.recordable
      ? el("span", "training-tag movesense soon", "Movesense · analysis coming")
      : el("span", "training-tag manual", "Log by hand"));
  tag.appendChild(infoTip(info.lift ? TIPS.movesense : info.recordable ? TIPS.soon : TIPS.manual));
  top.appendChild(tag);
  card.appendChild(top);

  if (item.tempo) card.appendChild(el("p", "plan-item-tempo", describeTempo(item.tempo, info.lift)));
  if (item.velocity) {
    var band = item.velocity.max ? item.velocity.min.toFixed(2) + "–" + item.velocity.max.toFixed(2) : item.velocity.min.toFixed(2);
    card.appendChild(el("p", "plan-item-vbt", "Aim for " + band + " m/s" +
      (info.lift ? " · " + zoneLabel(zoneFor(EXERCISES[info.lift], item.velocity.max || item.velocity.min)) : "")));
  }
  if (item.note) card.appendChild(el("p", "plan-item-note", "Coach: " + item.note));

  // Velocity-based: the coach's zone (or speed range) sets the target, and the
  // weight is suggested from the athlete's own sets of this exercise (vbt.js).
  var range = null;
  if (info.lift && item.zone) range = zoneRange(EXERCISES[info.lift], item.zone);
  else if (info.lift && item.velocity) {
    var vhi = item.velocity.max || item.velocity.min + 0.05;
    range = { lo: item.velocity.min, hi: vhi, mid: (item.velocity.min + vhi) / 2 };
  }
  var points = range ? liftPoints(training.history, info.key) : [];
  info.range = range;
  if (item.zone && range) {
    card.appendChild(withTip(el("p", "training-zone", "Speed zone: " + zoneLabel(item.zone) + " · " + range.lo.toFixed(2) + "–" + range.hi.toFixed(2) +
      " m/s average "), TIPS.zone));
  } else if (info.lift && !range && w.assignment_id) {
    card.appendChild(withTip(el("p", "training-zone is-missing", "No speed zone set by your coach "), TIPS.noZone));
  }
  if (info.recordable && !readOnly) {
    var ready = sensorsReady();
    var hint = el("p", "training-sensor-hint" + (ready ? " is-ready" : ""), ready
      ? (sensorsSimulated()
        ? "Simulated sensors: Record and Stop work to try the flow, but simulated recordings aren't saved or analyzed."
        : "Sensors connected: press \u25cf Record, stand still for a few seconds, do the set, rack the bar, then press \u25a0 Stop.")
      : "Sensors not connected. ");
    if (!ready) {
      var connect = el("button", "text-link", "Connect sensors \u2191");
      connect.type = "button";
      connect.addEventListener("click", showSensorPanel);
      hint.appendChild(connect);
      hint.appendChild(document.createTextNode(" Or log the sets by hand with Done."));
    }
    card.appendChild(hint);
  }

  var last = lastTime(w, item.name);
  if (last) {
    card.appendChild(el("p", "training-last",
      "Last time (" + prettyDay(last.date) + "): " + last.sets.map(setText).join(" · ")));
  }

  var logs = logsFor(w.id, itemIndex, item.name);

  // Suggestions: the first set from history; after that, from the latest analyzed set.
  var start = range && !logs.length ? suggestStart(points, range) : null;
  if (start) {
    card.appendChild(withTip(el("p", "training-suggest", "Suggested first set: " + start.kg + " kg, " + start.why + ". "), TIPS.start));
  } else if (range && !logs.length && !readOnly) {
    card.appendChild(el("p", "training-suggest", "No recorded " + info.name.toLowerCase() +
      " sets yet: pick a weight, record the set, and the app suggests the next one."));
  }
  var next = null, nextAfterSet = 0;
  if (range) {
    var analyzed = logs.filter(function (l) {
      var r = l.recording_id && training.recordings[l.recording_id];
      return r && r.analyzed_at && setSpeed(r.reps) !== null && l.weight_kg !== null;
    }).sort(function (a, b) { return a.set_no - b.set_no; });
    if (analyzed.length) {
      var latest = analyzed[analyzed.length - 1];
      var firstSpeed = setSpeed(training.recordings[analyzed[0].recording_id].reps);
      next = suggestNext(Number(latest.weight_kg), setSpeed(training.recordings[latest.recording_id].reps),
        range, points, info.lift, item.velocityLoss, firstSpeed);
      nextAfterSet = latest.set_no;
    }
  }
  var count = Math.max(item.sets || 1, logs.reduce(function (m, l) { return Math.max(m, l.set_no); }, 0));
  var rec = training.recording;
  if (rec && rec.workoutId === w.id && rec.itemIndex === itemIndex && rec.name === item.name) count = Math.max(count, rec.setNo);
  var table = el("div", "training-sets");
  var head = el("div", "training-set training-set-head");
  head.style.gridTemplateColumns = rowColumns(info);
  head.appendChild(el("span", "", "Set"));
  info.fields.forEach(function (f) { head.appendChild(el("span", "", fieldLabel(f, item, info))); });
  if (info.lift) head.appendChild(withTip(el("span", "", "Speed "), TIPS.speed));
  head.appendChild(el("span", "", ""));
  table.appendChild(head);

  var defaultKg = start ? start.kg : item.load ? prescribedKg(item) : null;
  if (defaultKg == null && last && last.sets.length && last.sets[0].weight_kg !== null) defaultKg = Number(last.sets[0].weight_kg);
  // Sets after the latest logged one start from what was just done (same
  // weight, reps, time, distance); a speed-based suggestion overrides the weight.
  var lastDone = logs.slice().sort(function (a, b) { return b.set_no - a.set_no; })[0];
  function defaultsFor(setNo) {
    var d = { kg: defaultKg, reps: item.reps, duration: item.duration, distance: null, suggested: !!start };
    if (lastDone && setNo > lastDone.set_no) {
      if (lastDone.weight_kg !== null) { d.kg = Number(lastDone.weight_kg); d.suggested = false; }
      if (lastDone.reps !== null) d.reps = lastDone.reps;
      if (lastDone.duration_s != null) d.duration = lastDone.duration_s;
      if (lastDone.distance_m != null) d.distance = Number(lastDone.distance_m);
    }
    if (next && next.state !== "stop" && setNo > nextAfterSet) { d.kg = next.kg; d.suggested = true; }
    return d;
  }
  for (var s = 1; s <= count; s++) {
    var rowWrap = setRow(w, item, info, itemIndex, s, logs.filter(function (l) { return l.set_no === s; })[0], defaultsFor(s), readOnly);
    if (next && s === nextAfterSet) {
      rowWrap.appendChild(withTip(el("p", "training-suggest next-" + next.state,
        (next.state === "stop" ? "" : "Next set: " + next.kg + " kg. ") + next.why.charAt(0).toUpperCase() + next.why.slice(1) + ". "), TIPS.next));
    }
    table.appendChild(rowWrap);
  }
  card.appendChild(table);

  if (!readOnly) {
    card.appendChild(button("Add set", "btn-ghost training-add", function () {
      ++count;
      table.appendChild(setRow(w, item, info, itemIndex, count, null, defaultsFor(count), false));
    }));
  }
  return card;
}

function sameRow(a, w, itemIndex, name, setNo) {
  return !!a && a.workoutId === w.id && a.itemIndex === itemIndex && a.name === name && a.setNo === setNo;
}

// One set: the exercise's own fields (weight, reps, time, distance…), then
// Record / Stop for sensor exercises and Done.
function setRow(w, item, info, itemIndex, setNo, log, defaults, readOnly) {
  var wrap = el("div", "training-set-wrap");
  var row = el("div", "training-set" + (log ? " is-done" : ""));
  row.style.gridTemplateColumns = rowColumns(info);
  wrap.appendChild(row);
  row.appendChild(el("span", "training-set-no", String(setNo)));
  var key = w.id + "|" + itemIndex + "|" + item.name + "|" + setNo;
  var unit = timeUnit(item, info);
  var recordingThis = sameRow(training.recording, w, itemIndex, item.name, setNo);
  var uploadingThis = sameRow(training.uploading, w, itemIndex, item.name, setNo);

  var inputs = {};
  info.fields.forEach(function (f) {
    var inp = el("input");
    inp.type = "number"; inp.min = "0";
    inp.inputMode = f === "reps" ? "numeric" : "decimal";
    inp.step = f === "reps" ? "1" : f === "distance" ? "0.01" : f === "time" ? (unit === 60 ? "0.5" : "1") : "0.5";
    inp.dataset.key = key + "|" + f;
    inp.setAttribute("aria-label", item.name + " set " + setNo + " " + fieldLabel(f, item, info).toLowerCase());
    var v = "";
    if (f === "weight" || f === "added") {
      v = log ? log.weight_kg : defaults.kg;
      if (f === "added") inp.placeholder = "0";
    } else if (f === "reps") {
      v = log ? log.reps : defaults.reps;
    } else if (f === "time") {
      var secs = log ? log.duration_s : defaults.duration;
      v = secs == null ? null : +(secs / unit).toFixed(1);
    } else if (f === "distance") {
      var metres = log ? log.distance_m : defaults.distance;
      v = metres != null ? +(metres / 1000).toFixed(2) : null;
    }
    inp.value = v === null || v === undefined ? "" : Number(v);
    inp.disabled = readOnly || !!log || uploadingThis;
    if ((f === "weight" || f === "added") && !log && defaults.suggested && v != null) {
      inp.classList.add("is-suggested");
      inp.title = "Suggested from your speed. Type your own if you like.";
    }
    inp.addEventListener("input", function () { inp.dataset.edited = "1"; inp.classList.remove("is-suggested"); });
    inputs[f] = inp;
    row.appendChild(inp);
  });
  if (info.lift) row.appendChild(speedCell(log, info.range));

  var controls = el("span", "training-set-controls");
  row.appendChild(controls);

  if (log && log.recording_id) {
    var summary = recordingSummary(training.recordings[log.recording_id]);
    var result = el("p", "training-rec " + summary.state, "\u25cf Recorded · " + summary.text + " ");
    if (summary.state === "done") result.appendChild(infoTip(TIPS.result));
    wrap.appendChild(result);
  }

  if (readOnly) {
    controls.appendChild(el("span", "training-set-state", log ? "✓ " + new Date(log.done_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""));
    return wrap;
  }

  function num(f) { return inputs[f] && inputs[f].value !== "" ? Number(inputs[f].value) : null; }
  function values() {
    var time = num("time"), dist = num("distance");
    return {
      kg: inputs.weight ? num("weight") : inputs.added ? num("added") : null,
      reps: num("reps"),
      duration: time === null ? null : Math.round(time * unit),
      distance: dist === null ? null : Math.round(dist * 1000)
    };
  }
  // What a set needs before it can be saved, per kind of exercise.
  function missing(v) {
    var f = info.fields;
    if (f.indexOf("reps") !== -1 && (v.reps === null || !(v.reps >= 0))) return "reps";
    if (f.indexOf("distance") !== -1) return v.duration === null && v.distance === null ? "time or distance" : null;
    if (f.indexOf("time") !== -1 && (v.duration === null || !(v.duration >= 0))) return "time";
    return null;
  }

  if (log) {
    var undo = button("✓ Done", "btn-ghost training-done is-done", function () {
      undo.disabled = true;
      sb.from("set_logs").delete().eq("id", log.id).then(function (res) {
        if (res.error) { undo.disabled = false; setTrainingStatus("Couldn't undo the set: " + res.error.message); return; }
        training.logs = training.logs.filter(function (l) { return l.id !== log.id; });
        renderTrainingDay();
        renderTrainingList();
      });
    });
    undo.title = log.recording_id ? "Undo: removes the set from the log (the recording itself is kept)" : "Undo this set to change it";
    controls.appendChild(undo);
    return wrap;
  }

  if (uploadingThis) {
    controls.appendChild(el("span", "training-set-state", "Saving the recording…"));
    return wrap;
  }

  // Recording controls, for exercises the sensors can record.
  if (info.recordable && recordingThis) {
    row.classList.add("is-recording");
    var stop = button("\u25a0 Stop & save", "btn training-stop", function () { stopRecording(w, item, info, itemIndex, setNo, values()); });
    stop.setAttribute("aria-label", "Stop recording " + item.name + " set " + setNo + " and save it");
    controls.appendChild(stop);
    controls.appendChild(el("span", "training-rec-live", "0:00"));
    return wrap;
  }
  var recordFirst = info.recordable && sensorsReady();
  if (recordFirst) {
    var recBtn = button("\u25cf Record set " + setNo, "btn training-record", function () { startRecording(w, item, itemIndex, setNo); });
    recBtn.disabled = Recorder.isRecording();
    recBtn.setAttribute("aria-label", "Record " + item.name + " set " + setNo + " with the sensors");
    controls.appendChild(recBtn);
  }

  var doneBtn = button("Done", recordFirst ? "btn-ghost training-done" : "btn training-done", function () {
    var v = values();
    var need = missing(v);
    if (need) {
      var first = inputs[need === "time or distance" ? "time" : need];
      if (first) first.focus();
      setTrainingStatus("Enter the " + need + " for set " + setNo + " first.");
      return;
    }
    if (v.kg !== null && !(v.kg >= 0)) { setTrainingStatus("Check the weight for set " + setNo + "."); return; }
    doneBtn.disabled = true;
    saveSet(w, item, info, itemIndex, setNo, v, null).catch(function () { doneBtn.disabled = false; });
  });
  doneBtn.setAttribute("aria-label", "Done with " + item.name + " set " + setNo);
  controls.appendChild(doneBtn);
  return wrap;
}

// The set's measured average speed, marked against the zone when there is one.
function speedCell(log, range) {
  var r = log && log.recording_id ? training.recordings[log.recording_id] : null;
  var speed = r && r.analyzed_at ? setSpeed(r.reps) : null;
  if (speed === null) {
    var waiting = r && !r.analyzed_at && !r.analysis_error;
    var empty = el("span", "training-speed is-empty", waiting ? "…" : "–");
    if (waiting) empty.title = "Waiting for the recording to be analyzed";
    return empty;
  }
  var where = !range ? "" : speed > range.hi ? "above" : speed < range.lo ? "below" : "in";
  var mark = { "in": " ✓", above: " ↑", below: " ↓", "": "" }[where];
  var cell = el("span", "training-speed" + (where ? " is-" + where : ""), speed.toFixed(2) + mark);
  cell.title = speed.toFixed(2) + " m/s average" + (where === "in" ? ", in the zone" : where === "above" ? ", faster than the zone" : where === "below" ? ", slower than the zone" : "");
  return cell;
}

function saveSet(w, item, info, itemIndex, setNo, v, recordingId) {
  return sb.from("set_logs").insert({
    workout_id: w.id, athlete_id: currentUser.id, item_index: itemIndex, exercise: info.name,
    set_no: setNo, weight_kg: v.kg, reps: v.reps, duration_s: v.duration, distance_m: v.distance, recording_id: recordingId
  }).select(SET_FIELDS).single().then(function (res) {
    if (res.error) { setTrainingStatus("Couldn't save the set: " + res.error.message); throw res.error; }
    setTrainingStatus("");
    training.logs.push(res.data);
    if (!w.started_at && !w.completed_at) {
      setWorkoutTimes(w, { started_at: new Date(new Date(res.data.done_at).getTime() - 60000).toISOString() }).catch(function () {});
    }
    renderTrainingDay();
    renderTrainingList();
    return res.data;
  });
}

/* ---------------- recording ---------------- */
var recordTicker = null;

function startRecording(w, item, itemIndex, setNo) {
  if (Recorder.isRecording()) return;
  Recorder.start({ workoutId: w.id, simulated: sensorsSimulated() });
  warmUpProcessing();
  training.recording = { workoutId: w.id, itemIndex: itemIndex, name: item.name, setNo: setNo };
  renderTrainingDay();
  clearInterval(recordTicker);
  recordTicker = setInterval(function () {
    if (!Recorder.isRecording()) { clearInterval(recordTicker); return; }
    document.querySelectorAll(".training-rec-live").forEach(function (n) {
      var secs = Math.floor(Recorder.seconds());
      n.textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
      n.title = Recorder.sampleCount() + " samples received";
    });
  }, 500);
}

function stopRecording(w, item, info, itemIndex, setNo, v) {
  clearInterval(recordTicker);
  var rec = Recorder.stop();
  training.recording = null;
  if (!rec || !rec.rows.length) {
    setTrainingStatus("Nothing was recorded. Check that both sensors are still connected.");
    renderTrainingDay();
    return;
  }
  // Simulated sensors: the set is logged like Done, but the recording is
  // never uploaded or analyzed.
  if (rec.meta && rec.meta.simulated) {
    saveSet(w, item, info, itemIndex, setNo, v, null).then(function () {
      setTrainingStatus("Simulated recording (" + Math.round(rec.seconds) + " s): the set is logged, but simulated recordings aren't saved or analyzed.");
    }, function () { renderTrainingDay(); });
    return;
  }
  training.uploading = { workoutId: w.id, itemIndex: itemIndex, name: item.name, setNo: setNo };
  renderTrainingDay();
  uploadRecording(rec, { exercise: info.key || exerciseFold(info.name).replace(/ /g, "_"), weightKg: v.kg, reps: v.reps, targetZone: zoneGroup(item.zone) })
    .then(function (sessionId) {
      training.recordings[sessionId] = { analyzed_at: null, analysis_error: null, reps: [] };
      return saveSet(w, item, info, itemIndex, setNo, v, sessionId);
    })
    .then(function () {
      training.uploading = null;
      renderTrainingDay();
      startPolling();
    })
    .catch(function (err) {
      training.uploading = null;
      renderTrainingDay();
      setTrainingStatus("The set was recorded but couldn't be saved (" + ((err && err.message) || err) +
        "). It's kept in this browser; reload the page while online to try again.");
    });
}

// A recording that failed to upload earlier: offer to send it again.
function offerPendingUpload() {
  var pending = pendingRecording();
  var box = document.getElementById("trainingPending");
  if (!pending || trainingReadOnly()) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = "";
  box.appendChild(el("span", "", "A recorded set (" + Math.round(pending.rec.seconds) + " s of " + pending.details.exercise.replace("_", " ") + ") wasn't uploaded yet."));
  box.appendChild(button("Upload it now", "btn-ghost", function () {
    uploadRecording(pending.rec, pending.details).then(function () {
      box.hidden = true;
      setTrainingStatus("Uploaded. It shows in the Squat, Bench Press or Deadlift tab once it's analyzed.");
    }, function (err) { setTrainingStatus("Still couldn't upload: " + err.message); });
  }));
  box.appendChild(button("Discard", "btn-ghost", function () { clearPendingRecording(); box.hidden = true; }));
}

/* ---------------- free workouts ---------------- */
// A day with nothing planned, picked in the calendar.
function renderRestDay(host, date) {
  var head = el("div", "training-day-head");
  var titles = el("div");
  titles.appendChild(el("p", "eyebrow", "Rest day"));
  titles.appendChild(el("h3", "", prettyDay(date)));
  titles.appendChild(el("p", "training-day-meta", "Nothing planned for this day."));
  head.appendChild(titles);
  host.appendChild(head);
  if (trainingReadOnly()) return;
  var past = date < todayString();
  host.appendChild(el("p", "log-note", past
    ? "Trained anyway, e.g. active recovery? Log it as a free workout for this day."
    : "Want to train this day anyway, e.g. active recovery? Add a free workout for it."));
  host.appendChild(button(date === todayString() ? "Start a free workout today" : "Log a free workout on this day", "btn", function () {
    startFreeWorkout(date);
  }));
}

function startFreeWorkout(date) {
  var day = typeof date === "string" ? date : todayString();
  var existing = training.workouts.filter(function (w) { return !w.assignment_id && w.scheduled_date === day; })[0];
  if (existing) { selectWorkout(existing); renderTraining(); return; }
  sb.from("workouts").insert({ athlete_id: currentUser.id, scheduled_date: day, label: "Free workout" })
    .select(WORKOUT_FIELDS).single()
    .then(function (res) {
      if (res.error) { setTrainingStatus("Couldn't start a free workout: " + res.error.message); return; }
      res.data.plan_assignments = null;
      training.workouts.push(res.data);
      training.workouts.sort(function (a, b) { return a.scheduled_date < b.scheduled_date ? -1 : a.scheduled_date > b.scheduled_date ? 1 : 0; });
      training.selectedId = res.data.id;
      training.restDate = null;
      training.calMonth = day.slice(0, 7);
      renderTraining();
    });
}

function addExerciseForm(w) {
  var form = el("form", "training-add-ex");
  var input = el("input");
  input.type = "text";
  input.placeholder = "Search exercises, e.g. Back squat, Bike, Plank 3x45s";
  input.setAttribute("aria-label", "Exercise name");
  input.setAttribute("list", "trainingExerciseNames");
  var list = el("datalist");
  list.id = "trainingExerciseNames";
  var seen = {};
  EXERCISE_BANK.map(function (x) { return x.name; }).concat(training.logs.map(function (l) { return l.exercise; })).forEach(function (n) {
    if (seen[n.toLowerCase()]) return;
    seen[n.toLowerCase()] = true;
    var o = el("option");
    o.value = n;
    list.appendChild(o);
  });
  form.appendChild(input);
  form.appendChild(list);
  var add = el("button", "btn-ghost", "Add exercise");
  add.type = "submit";
  form.appendChild(add);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    // Read it like a plan line, so "Bike 20 min" gets a 20-minute target, and
    // use the bank's name so it lines up with history.
    var parsed = parseExerciseLine(text);
    var item = parsed && parsed.name
      ? { name: parsed.name, lift: parsed.lift, sets: parsed.sets, reps: parsed.reps, repsText: parsed.repsText,
          duration: parsed.duration, load: parsed.load, tempo: parsed.tempo, note: parsed.note }
      : { name: text, lift: matchLift(text), sets: null, reps: null, duration: null };
    var known = findExercise(item.name);
    if (known) item.name = known.name;
    (training.freeExercises[w.id] = training.freeExercises[w.id] || []).push(item);
    renderTrainingDay();
  });
  return form;
}

var armedFreeDelete = null;
function deleteFreeWorkoutButton(w) {
  return button(armedFreeDelete === w.id ? "Click again: deletes its logged sets too" : "Delete workout", "btn-ghost", function () {
    if (armedFreeDelete !== w.id) { armedFreeDelete = w.id; renderTrainingDay(); return; }
    armedFreeDelete = null;
    sb.from("workouts").delete().eq("id", w.id).then(function (res) {
      if (res.error) { setTrainingStatus("Couldn't delete the workout: " + res.error.message); return; }
      training.workouts = training.workouts.filter(function (x) { return x.id !== w.id; });
      training.logs = training.logs.filter(function (l) { return l.workout_id !== w.id; });
      training.selectedId = defaultWorkoutId();
      renderTraining();
    });
  });
}

/* ---------------- wiring ---------------- */
(function initTraining() {
  document.getElementById("plansTabTraining").addEventListener("click", function () { showPlansTab("training"); });
  document.getElementById("plansTabBuilder").addEventListener("click", function () { showPlansTab("builder"); });
  document.getElementById("freeWorkoutBtn").addEventListener("click", startFreeWorkout);
  document.getElementById("trainingBack").addEventListener("click", function (e) {
    e.preventDefault();
    training.athleteId = null;
    training.selectedId = null;
    loadTraining();
  });
  // Sensors connecting or dropping changes which sets can be recorded.
  document.addEventListener("vlo:sensors", function () {
    if (trainingVisible() && !Recorder.isRecording()) renderTrainingDay();
  });
})();
