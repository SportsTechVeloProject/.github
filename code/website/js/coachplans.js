/* coachplans.js — coaches save plans to their team and assign them to athletes.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order.

   Tables (supabase/plans.sql, docs/database.md): plans → plan_assignments →
   workouts. Assigning a plan creates one dated workout per plan day: from the
   start date, each 7-day window is one plan week, and its days go to the
   chosen training weekdays in order. Other days are rest days. The coach can
   move a workout later; skipped workouts are never shifted.
   (Plans can also belong to one person instead of a team; this page handles
   team plans.) */
"use strict";

var WEEKDAYS = [
  { n: 1, short: "Mon" }, { n: 2, short: "Tue" }, { n: 3, short: "Wed" }, { n: 4, short: "Thu" },
  { n: 5, short: "Fri" }, { n: 6, short: "Sat" }, { n: 7, short: "Sun" }
];

var teamPlans = [];        // this team's saved plans, with their assignments
var teamPeople = {};       // user_id -> { full_name, role } from team_roster
var openPlanId = null;     // the saved plan loaded into the editor, if any
var assignPlan = null;     // the plan the assign panel is for
var assignDone = "";       // "Assigned to …" confirmation, kept until the coach changes something

/* ---------------- dates ---------------- */
// Plain calendar dates as "YYYY-MM-DD", computed in UTC so time zones and
// daylight saving can't shift a day.
function parseDay(s) { var p = s.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function dayString(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDaysTo(s, n) { return dayString(parseDay(s) + n * 86400000); }
function isoWeekday(s) { var d = new Date(parseDay(s)).getUTCDay(); return d === 0 ? 7 : d; }
function prettyDay(s) {
  return new Date(parseDay(s)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function nextMonday() {
  var now = new Date();
  var today = dayString(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return addDaysTo(today, (8 - isoWeekday(today)) % 7 || 7);
}

/* ---------------- schedule ---------------- */
function mostDaysInAWeek(content) {
  return (content.weeks || []).reduce(function (m, w) { return Math.max(m, w.days.length); }, 0);
}

// A sensible default spread for n training days.
function defaultWeekdays(n) {
  return { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7] }[clamp(n, 1, 7)];
}

// One dated session per plan day: week k is the 7 days starting at
// start + 7(k-1); its days take that window's training weekdays in order.
// Every 7-day window holds each weekday exactly once, so there are always
// as many slots as chosen weekdays.
function planSchedule(content, startDate, weekdays) {
  var out = [];
  (content.weeks || []).forEach(function (week, wi) {
    var windowStart = addDaysTo(startDate, wi * 7);
    var slots = [];
    for (var i = 0; i < 7; i++) {
      var d = addDaysTo(windowStart, i);
      if (weekdays.indexOf(isoWeekday(d)) !== -1) slots.push(d);
    }
    week.days.forEach(function (day, di) {
      out.push({ week_no: wi + 1, day_no: di + 1, label: day.label, scheduled_date: slots[di] || null, weekLabel: week.label });
    });
  });
  return out;
}

/* ---------------- loading ---------------- */
function coachPlansAvailable() { return !!(sb && currentUser && currentTeam && isTeamStaff()); }

function setCoachStatus(text) { document.getElementById("coachPlansStatus").textContent = text || ""; }

function loadTeamPlans() {
  var card = document.getElementById("coachPlans");
  var saveBtn = document.getElementById("planSaveTeamBtn");
  var on = coachPlansAvailable();
  card.hidden = !on;
  saveBtn.hidden = !on;
  if (!on) { closeAssign(); return; }

  setCoachStatus("Loading your team's plans…");
  var teamId = currentTeam.team_id;
  Promise.all([
    sb.from("plans")
      .select("id, name, content, source_text, created_at, updated_at, plan_assignments(id, athlete_id, start_date, weekdays)")
      .eq("team_id", teamId)
      .order("updated_at", { ascending: false }),
    sb.rpc("team_roster", { p_team: teamId })
  ]).then(function (results) {
    if (!currentTeam || currentTeam.team_id !== teamId) return; // switched team meanwhile
    var plansRes = results[0], rosterRes = results[1];
    teamPeople = {};
    (rosterRes.data || []).forEach(function (m) { teamPeople[m.user_id] = m; });
    if (plansRes.error) {
      teamPlans = [];
      renderTeamPlans();
      var missing = /plans|schema cache|does not exist/i.test(plansRes.error.message || "");
      setCoachStatus(missing
        ? "Plans aren't set up in Supabase yet. Run supabase/plans.sql in the Supabase SQL editor, then reload."
        : "Couldn't load plans: " + plansRes.error.message);
      return;
    }
    teamPlans = plansRes.data || [];
    renderTeamPlans();
    updateSaveButton();
    setCoachStatus(teamPlans.length ? "" : "No plans saved yet. Read a plan below and press Save to team.");
    if (assignPlan) {
      assignPlan = teamPlans.filter(function (p) { return p.id === assignPlan.id; })[0] || null;
      if (assignPlan) renderAssign(); else closeAssign();
    }
  });
}

function personName(id) {
  var p = teamPeople[id];
  if (!p) return "Unknown athlete";
  return p.full_name + (currentUser && id === currentUser.id ? " (you)" : "");
}

/* ---------------- the plan list ---------------- */
function planSummary(plan) {
  var weeks = (plan.content.weeks || []).length;
  var days = (plan.content.weeks || []).reduce(function (n, w) { return n + w.days.length; }, 0);
  var assigned = plan.plan_assignments.length;
  return weeks + " week" + (weeks === 1 ? "" : "s") + " · " + days + " workout" + (days === 1 ? "" : "s") +
    " · " + (assigned ? "assigned to " + assigned + " athlete" + (assigned === 1 ? "" : "s") : "not assigned yet") +
    " · updated " + formatDate(plan.updated_at);
}

var armedDelete = null;
function renderTeamPlans() {
  var list = document.getElementById("coachPlanList");
  list.innerHTML = "";
  teamPlans.forEach(function (plan) {
    var li = el("li", "person-row" + (plan.id === openPlanId ? " is-open" : ""));
    var text = el("div", "coach-plan-text");
    text.appendChild(el("div", "person-name", plan.name));
    text.appendChild(el("div", "person-meta", planSummary(plan)));
    li.appendChild(text);

    var actions = el("div", "person-actions");
    actions.appendChild(button(plan.id === openPlanId ? "Open in editor" : "Open", "btn-ghost", function () { openTeamPlan(plan); }));
    actions.appendChild(button("Assign", "btn", function () { openAssign(plan); }));
    actions.appendChild(button(armedDelete === plan.id ? "Click again to delete" : "Delete", "btn-ghost", function () {
      if (armedDelete !== plan.id) { armedDelete = plan.id; renderTeamPlans(); return; }
      armedDelete = null;
      sb.from("plans").delete().eq("id", plan.id).then(function (res) {
        if (res.error) { setCoachStatus("Couldn't delete: " + res.error.message); return; }
        if (openPlanId === plan.id) closeTeamPlan();
        loadTeamPlans();
      });
    }));
    li.appendChild(actions);
    list.appendChild(li);
  });
}

/* ---------------- open / save ---------------- */
function openTeamPlan(plan) {
  openPlanId = plan.id;
  document.getElementById("planName").value = plan.name;
  document.getElementById("planText").value = plan.source_text || "";
  runPlanParse(true);
  updateSaveButton();
  renderTeamPlans();
  document.getElementById("planText").scrollIntoView({ behavior: "smooth", block: "center" });
}

// Called by the Clear button in plans.js: the editor no longer shows a saved plan.
function closeTeamPlan() {
  openPlanId = null;
  updateSaveButton();
  if (teamPlans.length) renderTeamPlans();
}

function updateSaveButton() {
  var open = teamPlans.filter(function (p) { return p.id === openPlanId; })[0];
  document.getElementById("planSaveTeamBtn").textContent = open ? "Save changes to team plan" : "Save to team";
}

function saveTeamPlan() {
  var status = document.getElementById("planStatus");
  var name = document.getElementById("planName").value.trim();
  if (!currentPlan || !currentPlan.weeks.length) { status.textContent = "Read a plan first: there's nothing to save yet."; return; }
  if (!name) { status.textContent = "Give the plan a name first (top right)."; document.getElementById("planName").focus(); return; }

  var row = {
    name: name,
    content: { meta: currentPlan.meta, weeks: currentPlan.weeks },
    source_text: document.getElementById("planText").value,
    updated_at: new Date().toISOString()
  };
  var request = openPlanId
    ? sb.from("plans").update(row).eq("id", openPlanId).select("id").single()
    : sb.from("plans").insert(Object.assign({ team_id: currentTeam.team_id, created_by: currentUser.id }, row)).select("id").single();
  status.textContent = "Saving…";
  request.then(function (res) {
    if (res.error) { status.textContent = "Couldn't save: " + res.error.message; return; }
    var wasOpen = !!openPlanId;
    openPlanId = res.data.id;
    status.textContent = wasOpen ? "Saved changes to “" + name + "”." : "Saved “" + name + "” to your team. Press Assign to give it to an athlete.";
    var noZone = countMissingZones(currentPlan);
    if (noZone) status.textContent += " Note: " + noZone + " Movesense exercise" + (noZone === 1 ? " has" : "s have") + " no zone yet.";
    loadTeamPlans();
    updateSaveButton();
  });
}

/* ---------------- assign ---------------- */
function openAssign(plan) {
  assignPlan = plan;
  assignDone = "";
  var panel = document.getElementById("assignPanel");
  panel.hidden = false;
  document.getElementById("assignTitle").textContent = "Assign “" + plan.name + "”";

  var select = document.getElementById("assignAthlete");
  select.innerHTML = "";
  var people = Object.keys(teamPeople).map(function (id) { return teamPeople[id]; })
    .sort(function (a, b) { return (a.role === "member" ? 0 : 1) - (b.role === "member" ? 0 : 1) || a.full_name.localeCompare(b.full_name); });
  people.forEach(function (m) {
    var opt = el("option", "", personName(m.user_id) + (m.role === "member" ? "" : " · " + roleLabel(m.role)));
    opt.value = m.user_id;
    select.appendChild(opt);
  });

  document.getElementById("assignStart").value = nextMonday();
  var picks = document.getElementById("assignWeekdays");
  picks.innerHTML = "";
  var chosen = defaultWeekdays(mostDaysInAWeek(plan.content));
  WEEKDAYS.forEach(function (wd) {
    var label = el("label", "weekday-pick");
    var box = el("input");
    box.type = "checkbox";
    box.value = wd.n;
    box.checked = chosen.indexOf(wd.n) !== -1;
    box.addEventListener("change", function () { assignDone = ""; renderAssign(); });
    label.appendChild(box);
    label.appendChild(el("span", "", wd.short));
    picks.appendChild(label);
  });
  renderAssign();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeAssign() {
  assignPlan = null;
  document.getElementById("assignPanel").hidden = true;
}

function chosenWeekdays() {
  return Array.prototype.slice.call(document.querySelectorAll("#assignWeekdays input:checked"))
    .map(function (b) { return +b.value; });
}

// Validates the choices and previews the dates; returns the schedule or null.
function renderAssign() {
  if (!assignPlan) return null;
  var note = document.getElementById("assignNote");
  var preview = document.getElementById("assignPreview");
  var confirmBtn = document.getElementById("assignConfirmBtn");
  var start = document.getElementById("assignStart").value;
  var weekdays = chosenWeekdays();
  var need = mostDaysInAWeek(assignPlan.content);
  preview.innerHTML = "";
  renderCurrentAssignments();

  var problem = !start ? "Pick a start date."
    : !weekdays.length ? "Pick the athlete's training days."
    : weekdays.length < need ? "This plan has " + need + " training days in its busiest week, so pick at least " + need + " training days (" + weekdays.length + " picked)."
    : "";
  confirmBtn.disabled = !!problem || !document.getElementById("assignAthlete").value;
  if (problem) { note.textContent = problem; note.className = "log-note assign-problem"; return null; }

  var schedule = planSchedule(assignPlan.content, start, weekdays);
  var restDays = 7 - weekdays.length;
  note.className = "log-note";
  note.textContent = (assignDone ? assignDone + " " : "") + schedule.length + " workouts from " + prettyDay(schedule[0].scheduled_date) + " to " +
    prettyDay(schedule[schedule.length - 1].scheduled_date) + ". " + restDays + " rest day" + (restDays === 1 ? "" : "s") +
    " a week. Missed workouts stay on their date; you can move a workout later.";

  var byWeek = {};
  schedule.forEach(function (s) { (byWeek[s.week_no] = byWeek[s.week_no] || []).push(s); });
  Object.keys(byWeek).forEach(function (wk) {
    var row = el("div", "assign-week");
    row.appendChild(el("span", "assign-week-label", byWeek[wk][0].weekLabel || "Week " + wk));
    var days = el("span", "assign-week-days");
    byWeek[wk].forEach(function (s) {
      days.appendChild(el("span", "assign-day", prettyDay(s.scheduled_date) + " · " + s.label));
    });
    row.appendChild(days);
    preview.appendChild(row);
  });
  return schedule;
}

function renderCurrentAssignments() {
  var list = document.getElementById("assignCurrent");
  list.innerHTML = "";
  var assignments = assignPlan ? assignPlan.plan_assignments : [];
  document.getElementById("assignCurrentTitle").hidden = !assignments.length;
  assignments.forEach(function (a) {
    var li = el("li", "person-row");
    li.appendChild(el("span", "person-name", personName(a.athlete_id)));
    var days = WEEKDAYS.filter(function (wd) { return a.weekdays.indexOf(wd.n) !== -1; }).map(function (wd) { return wd.short; }).join(", ");
    li.appendChild(el("span", "person-meta", "from " + prettyDay(a.start_date) + " · " + days));
    var actions = el("div", "person-actions");
    actions.appendChild(button(armedDelete === a.id ? "Click again: also deletes their logged sets" : "Unassign", "btn-ghost", function () {
      if (armedDelete !== a.id) { armedDelete = a.id; renderCurrentAssignments(); return; }
      armedDelete = null;
      sb.from("plan_assignments").delete().eq("id", a.id).then(function (res) {
        if (res.error) { setCoachStatus("Couldn't unassign: " + res.error.message); return; }
        loadTeamPlans();
      });
    }));
    li.appendChild(actions);
    list.appendChild(li);
  });
}

function confirmAssign() {
  var schedule = renderAssign();
  if (!schedule) return;
  var note = document.getElementById("assignNote");
  var athleteId = document.getElementById("assignAthlete").value;
  var plan = assignPlan;
  note.textContent = "Assigning…";
  sb.from("plan_assignments").insert({
    plan_id: plan.id,
    athlete_id: athleteId,
    start_date: document.getElementById("assignStart").value,
    weekdays: chosenWeekdays(),
    assigned_by: currentUser.id
  }).select("id").single().then(function (res) {
    if (res.error) { note.textContent = "Couldn't assign: " + res.error.message; return; }
    var assignmentId = res.data.id;
    var rows = schedule.map(function (s) {
      return { athlete_id: athleteId, assignment_id: assignmentId, week_no: s.week_no, day_no: s.day_no, label: s.label, scheduled_date: s.scheduled_date };
    });
    return sb.from("workouts").insert(rows).then(function (res2) {
      if (res2.error) {
        // Don't leave an assignment without its workouts.
        sb.from("plan_assignments").delete().eq("id", assignmentId);
        note.textContent = "Couldn't create the workouts: " + res2.error.message;
        return;
      }
      assignDone = "Assigned to " + personName(athleteId) + ": " + rows.length + " workouts scheduled.";
      var noZone = countMissingZones(plan.content);
      if (noZone) assignDone += " " + noZone + " Movesense exercise" + (noZone === 1 ? " has" : "s have") + " no zone, so no weight suggestions there.";
      note.textContent = assignDone;
      loadTeamPlans();
    });
  });
}

/* ---------------- wiring ---------------- */
(function initCoachPlans() {
  document.getElementById("planSaveTeamBtn").addEventListener("click", saveTeamPlan);
  function changed() { assignDone = ""; renderAssign(); }
  document.getElementById("assignStart").addEventListener("change", changed);
  document.getElementById("assignAthlete").addEventListener("change", changed);
  document.getElementById("assignConfirmBtn").addEventListener("click", confirmAssign);
  document.getElementById("assignCancelBtn").addEventListener("click", closeAssign);
})();
