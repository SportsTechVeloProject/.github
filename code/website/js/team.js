/* team.js — Team page, invites inbox, join requests and account settings.
   Part of V-Lo. Loaded as a plain script after auth.js; see vlo.html for the order.

   How joining works (the rules live in Supabase, this file just calls them):
   - Coach/admin invites (in-app or link)  -> the person joins straight away.
   - Athlete invites (in-app or link)      -> the person can only send a join request.
   - Team search                           -> join request.
   - Coaches/admins accept or reject join requests. */
"use strict";

var DESC_MAX = 500;

function isTeamStaff() {
  return !!(currentTeam && (currentTeam.role === "coach" || currentTeam.role === "admin"));
}

function roleLabel(role) {
  return role === "member" ? "athlete" : role;
}

function isTeamAdmin() {
  return !!(currentTeam && currentTeam.role === "admin");
}

// Small DOM helper: el("p", "class", "text"). Always textContent, never HTML,
// because names and descriptions are typed by users.
function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  var b = el("button", className || "btn-ghost", label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function formatKg(kg) {
  return Math.round(kg).toLocaleString() + " kg";
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function debounce(fn, ms) {
  var t = null;
  return function () {
    var args = arguments;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(null, args); }, ms);
  };
}

/* ---------------- view switching ---------------- */
var teamViewEl = authEl("teamView");

function showTeamPage() {
  document.getElementById("exerciseView").hidden = true;
  document.getElementById("plansView").hidden = true;
  teamViewEl.hidden = false;
  authEl("sensorBar").hidden = true; // sensors belong to training, not the team page
  document.querySelectorAll(".apptab").forEach(function (b) { b.setAttribute("aria-selected", "false"); });
  authEl("teamBadge").setAttribute("aria-current", "page");
  window.scrollTo(0, 0);
  renderTeamPage();
}

function hideTeamPage() {
  teamViewEl.hidden = true;
  authEl("sensorBar").hidden = false;
  authEl("teamBadge").removeAttribute("aria-current");
}

authEl("teamBadge").addEventListener("click", showTeamPage);
authEl("teamBack").addEventListener("click", function (e) {
  e.preventDefault();
  renderExercise(state.ex);
});

function setTeamNotice(msg) {
  var n = authEl("teamNotice");
  n.textContent = msg || "";
  n.hidden = !msg;
}

/* ---------------- team page ---------------- */
function renderTeamPage() {
  hideProgress();
  if (authNotice) { setTeamNotice(authNotice); authNotice = ""; }

  if (!currentTeam) {
    authEl("teamEyebrow").textContent = "Team";
    authEl("teamHeading").textContent = "No team yet";
    renderDescriptions();
    renderTeamLook();
    authEl("teamMain").hidden = true;
    authEl("teamNone").hidden = false;
    var loggedIn = !!currentUser;
    authEl("teamNoneMsg").textContent = "You are not a member of a team yet, you can still work out on your own!" +
      (loggedIn ? "" : " Log in to search for a team and ask to join.");
    authEl("teamSearchCard").hidden = !loggedIn;
    return;
  }

  authEl("teamNone").hidden = true;
  authEl("teamMain").hidden = false;
  authEl("teamEyebrow").textContent = "Your team · " + roleLabel(currentTeam.role);
  authEl("teamHeading").textContent = currentTeam.teamName;
  renderDescriptions();
  renderTeamLook();

  var staff = isTeamStaff();
  if (!staff) authEl("joinRequestsCard").hidden = true;
  authEl("activityCard").hidden = true;
  authEl("todayCard").hidden = true;
  setAddPeopleOpen(false);
  authEl("addPeopleTitle").textContent = staff ? "Add people" : "Suggest someone";
  authEl("addPeopleToggle").textContent = staff ? "+ Add people" : "+ Suggest someone";
  authEl("addPeopleHint").textContent = staff
    ? "Find someone who has an account and invite them. They'll see the invite when they open V-Lo and can accept or decline."
    : "Know someone who should train with the team? Suggest them. They can then ask to join, and a coach or admin decides.";
  authEl("inviteRoleSelect").hidden = !staff;
  authEl("inviteRoleSelect").value = "member";

  loadTeamDetails();
  loadRoster();
  loadStats();
  loadWeeklyVolume();
  loadTopPrs();
  loadSentInvites();
  if (staff) loadJoinRequests();
}

// Refresh name and descriptions, in case a coach edited them since we loaded.
function loadTeamDetails() {
  var teamId = currentTeam.team_id;
  sb.from("teams").select("name, public_description, private_description, logo_path, color").eq("id", teamId).maybeSingle().then(function (res) {
    if (res.error || !res.data || !currentTeam || currentTeam.team_id !== teamId) return;
    currentTeam.teamName = res.data.name;
    currentTeam.public_description = res.data.public_description || "";
    currentTeam.private_description = res.data.private_description || "";
    currentTeam.logo_path = res.data.logo_path || null;
    currentTeam.color = res.data.color || null;
    authEl("teamHeading").textContent = currentTeam.teamName;
    updateTeamBadge();
    renderDescriptions();
    renderTeamLook();
  });
}

/* ---- descriptions (shown under the team name, like a profile bio) ---- */
var DESC_INFO = {
  public_description: {
    label: "Public \u00b7 shown in team search",
    empty: "Add a public description: what people see when they find the team in search."
  },
  private_description: {
    label: "Private \u00b7 only team members see this",
    empty: "Add a note for your team: training times, where you meet, house rules."
  }
};

function renderDescriptions() {
  var staff = isTeamStaff();
  Object.keys(DESC_INFO).forEach(function (field) {
    var box = document.querySelector('[data-desc="' + field + '"]');
    if (box.dataset.editing === "true") return;
    box.innerHTML = "";
    var text = currentTeam ? currentTeam[field].trim() : "";
    // Athletes only see text that exists; coaches/admins also see empty slots to fill in.
    box.hidden = !currentTeam || (!text && !staff);
    if (box.hidden) return;
    if (staff) box.appendChild(el("p", "team-desc-label", DESC_INFO[field].label));
    var p = el("p", "team-desc-text" + (text ? "" : " is-empty"), text || DESC_INFO[field].empty);
    if (staff) {
      p.appendChild(document.createTextNode(" "));
      var edit = button("Edit", "text-link team-desc-edit", function () { startDescEdit(field); });
      edit.setAttribute("aria-label", "Edit " + (field === "public_description" ? "public" : "private") + " description");
      p.appendChild(edit);
    }
    box.appendChild(p);
  });
}

function startDescEdit(field) {
  var box = document.querySelector('[data-desc="' + field + '"]');
  box.dataset.editing = "true";
  box.innerHTML = "";
  box.appendChild(el("p", "team-desc-label", DESC_INFO[field].label));

  var wrap = el("div", "team-bio-editor");
  var input = el("textarea");
  input.maxLength = DESC_MAX;
  input.value = currentTeam[field];
  input.setAttribute("aria-label", field === "public_description" ? "Public description" : "Private description");
  var actions = el("div", "team-bio-actions");
  var count = el("span", "log-note");
  var status = el("p", "log-note");
  function updateCount() { count.textContent = input.value.length + " / " + DESC_MAX; }
  input.addEventListener("input", updateCount);
  updateCount();

  var cancel = button("Cancel", "btn-ghost", function () {
    delete box.dataset.editing;
    renderDescriptions();
  });
  var save = button("Save", "btn", function () {
    save.disabled = true;
    status.textContent = "Saving\u2026";
    var patch = {};
    patch[field] = input.value.trim();
    sb.from("teams").update(patch).eq("id", currentTeam.team_id).select(field).single().then(function (res) {
      save.disabled = false;
      if (res.error) { status.textContent = "Couldn't save: " + res.error.message; return; }
      currentTeam[field] = res.data[field] || "";
      delete box.dataset.editing;
      renderDescriptions();
    });
  });
  actions.appendChild(count);
  actions.appendChild(cancel);
  actions.appendChild(save);
  wrap.appendChild(input);
  wrap.appendChild(actions);
  wrap.appendChild(status);
  box.appendChild(wrap);
  input.focus();
}

/* ---- people ---- */
var lastRoster = [];

function loadRoster() {
  sb.rpc("team_roster", { p_team: currentTeam.team_id }).then(function (res) {
    var coaches = authEl("coachList");
    var athletes = authEl("athleteList");
    coaches.innerHTML = "";
    athletes.innerHTML = "";
    if (res.error) { coaches.appendChild(el("li", "log-note", res.error.message)); return; }
    lastRoster = res.data || [];
    activityByUser = {};
    renderRosterLists();
    renderStatTiles();
    loadActivity();
    loadToday();
  });
}

function renderRosterLists() {
  var coaches = authEl("coachList");
  var athletes = authEl("athleteList");
  coaches.innerHTML = "";
  athletes.innerHTML = "";
  lastRoster.forEach(function (m) {
    var list = m.role === "member" ? athletes : coaches;
    list.appendChild(personRow(m));
  });
  if (!coaches.children.length) coaches.appendChild(el("li", "log-note", "No coaches yet."));
  if (!athletes.children.length) athletes.appendChild(el("li", "log-note", "No athletes yet. Add some below."));
}

// Round picture, or the initial when there's none (like the profile icon top right).
function avatar(fullName, isMe, avatarPath) {
  var a = el("span", "person-avatar" + (isMe ? " is-me" : ""));
  a.setAttribute("aria-hidden", "true");
  fillAvatar(a, fullName, avatarPath);
  return a;
}
function fillAvatar(a, fullName, avatarPath) {
  a.innerHTML = "";
  var url = profilePictureUrl(avatarPath);
  a.classList.toggle("has-photo", !!url);
  if (url) {
    var img = document.createElement("img");
    img.alt = "";
    img.src = url;
    a.appendChild(img);
  } else {
    a.textContent = (fullName || "?").trim().charAt(0).toUpperCase();
  }
}

/* ---- pictures ----
   Profile pictures: public bucket "pictures", viewed by link.
   Team pictures: private bucket "team-pictures"; only team members can get a
   (1-hour) link. See supabase/migrations/2026-10-14-team-identity.sql. */
function profilePictureUrl(path) {
  return path && sb ? sb.storage.from("pictures").getPublicUrl(path).data.publicUrl : null;
}

var teamPictureCache = {}; // path -> { at, promise }
function teamPictureUrl(path) {
  if (!path || !sb) return Promise.resolve(null);
  var hit = teamPictureCache[path];
  if (!hit || Date.now() - hit.at > 50 * 60000) { // links last an hour
    hit = teamPictureCache[path] = {
      at: Date.now(),
      promise: sb.storage.from("team-pictures").createSignedUrl(path, 3600)
        .then(function (res) { return res.error ? null : res.data.signedUrl; })
    };
  }
  return hit.promise;
}

// A picture file -> a square JPEG of size x size (centre crop), so uploads
// stay small and every picture fits a circle.
function squareJpeg(file, size) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    var src = URL.createObjectURL(file);
    img.onload = function () {
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(src);
      canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("Couldn't read that picture.")); }, "image/jpeg", 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(src); reject(new Error("That file isn't a picture we can read.")); };
    img.src = src;
  });
}

// Shrink, upload under folder/<random>.jpg, then return the new path.
function uploadPicture(bucket, folder, file, size) {
  return squareJpeg(file, size).then(function (blob) {
    var path = folder + "/" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + ".jpg";
    return sb.storage.from(bucket).upload(path, blob, { contentType: "image/jpeg" }).then(function (res) {
      if (res.error) throw res.error;
      return path;
    });
  });
}

function removePicture(bucket, path) {
  if (path) sb.storage.from(bucket).remove([path]); // best effort: an old file left behind does no harm
}

function personRow(m) {
  var li = el("li", "person-row");
  var isMe = currentUser && m.user_id === currentUser.id;
  var name = el("span", "person-name", m.full_name + (isMe ? " (you)" : ""));
  var meta = el("span", "person-meta", m.role === "admin" ? "admin" : m.role === "coach" ? "coach" : "since " + formatDate(m.joined_at));
  // Coaches/admins can open anyone's progress; everyone can open their own.
  if (isTeamStaff() || isMe) {
    var b = el("button", "person-open");
    b.type = "button";
    b.appendChild(avatar(m.full_name, isMe, m.avatar_path));
    // Name and role on the first line; training status and readiness
    // flags below (only loaded for people you're allowed to see).
    var text = el("span", "person-text");
    var top = el("span", "person-line");
    top.appendChild(name);
    top.appendChild(meta);
    text.appendChild(top);
    var act = activityByUser[m.user_id];
    if (act) {
      text.appendChild(el("span", "person-meta person-activity", activitySummary(act)));
      act.flags.forEach(function (f) { text.appendChild(el("span", "readiness-flag", "\u26a0 " + f)); });
    }
    b.appendChild(text);
    b.appendChild(el("span", "person-arrow", "→"));
    b.setAttribute("aria-label", "Show progress for " + m.full_name);
    b.addEventListener("click", function () { showProgress(m); });
    li.appendChild(b);
  } else {
    li.appendChild(avatar(m.full_name, isMe, m.avatar_path));
    li.appendChild(name);
    li.appendChild(meta);
  }
  // Admins manage everyone else: role and removing. (Yourself: "Leave team".)
  if (isTeamAdmin() && !isMe) {
    li.classList.add("has-manage");
    var manage = button("Manage", "text-link person-manage", function () { toggleManage(li, m); });
    manage.setAttribute("aria-expanded", "false");
    manage.setAttribute("aria-label", "Manage " + m.full_name);
    li.appendChild(manage);
  }
  return li;
}

/* ---- training status, readiness and recent activity ----
   Read straight from set_logs and sessions: the database's own rules let
   coaches/admins read their athletes' training and everyone read their
   own, so athletes only ever get their own status. */
var ACTIVITY_DAYS = 56;       // how far back to look (baseline for readiness)
var READINESS_DROP = 0.08;    // flag when a set is this much slower than usual at that load
var READINESS_RECENT_DAYS = 7; // only flag sets from the last week
var HIGH_VELOCITY_LOSS = 0.35; // flag a set whose last rep is this much slower than the first (placeholder)
var activityByUser = {};      // user id -> { last, daysThisWeek, flags }

function setSpeed(reps) {
  var v = reps.map(repMeanSpeed).filter(function (x) { return x !== null; });
  return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
}

function loadActivity() {
  if (!currentTeam || !currentUser) return;
  var teamId = currentTeam.team_id;
  var staff = isTeamStaff();
  var ids = staff ? lastRoster.map(function (m) { return m.user_id; }) : [currentUser.id];
  if (!ids.length) return;
  var since = new Date(Date.now() - ACTIVITY_DAYS * 86400000).toISOString();
  Promise.all([
    sb.from("set_logs").select("id, athlete_id, exercise, weight_kg, reps, duration_s, distance_m, done_at, recording_id")
      .in("athlete_id", ids).gte("done_at", since).order("done_at", { ascending: false }),
    sb.from("sessions").select("id, user_id, exercise, weight_kg, recorded_at, reported_rep_count, " +
                               "reps(rep_index, left_mean_velocity, right_mean_velocity)")
      .in("user_id", ids).gte("recorded_at", since).order("recorded_at", { ascending: false })
  ]).then(function (results) {
    if (!currentTeam || currentTeam.team_id !== teamId) return;
    var logs = results[0].error ? [] : (results[0].data || []);
    var recs = results[1].error ? [] : (results[1].data || []);
    var events = trainingEvents(logs, recs);

    activityByUser = {};
    ids.forEach(function (id) {
      var mine = events.filter(function (e) { return e.user_id === id; });
      activityByUser[id] = {
        last: mine.length ? mine[0].time : null,
        daysThisWeek: trainingDaysThisWeek(mine),
        flags: readinessFlags(recs.filter(function (r) { return r.user_id === id; }))
      };
    });
    renderRosterLists();
    if (staff) renderActivityFeed(events);
  });
}

// One list of sets, newest first: sets ticked off in Training, plus sensor
// recordings that don't belong to one of those (so nothing counts twice).
function trainingEvents(logs, recs) {
  var recById = {};
  recs.forEach(function (r) { recById[r.id] = r; });
  var linked = {};
  var events = logs.map(function (l) {
    var rec = l.recording_id ? recById[l.recording_id] : null;
    if (l.recording_id) linked[l.recording_id] = true;
    return { user_id: l.athlete_id, time: new Date(l.done_at), exercise: l.exercise,
             kg: l.weight_kg === null ? null : Number(l.weight_kg), reps: l.reps,
             duration: l.duration_s, distance: l.distance_m, speed: rec ? setSpeed(rec.reps) : null };
  });
  recs.forEach(function (r) {
    if (linked[r.id]) return;
    events.push({ user_id: r.user_id, time: new Date(r.recorded_at), exercise: exerciseName(r.exercise),
                  kg: r.weight_kg === null ? null : Number(r.weight_kg),
                  reps: r.reps.length || r.reported_rep_count, speed: setSpeed(r.reps) });
  });
  return events.sort(function (a, b) { return b.time - a.time; });
}

function trainingDaysThisWeek(events) {
  var now = new Date();
  var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  var days = {};
  events.forEach(function (e) { if (e.time >= monday) days[localDayString(e.time)] = true; });
  return Object.keys(days).length;
}

function timeAgo(date) {
  var mins = Math.round((Date.now() - date) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  var hours = Math.round(mins / 60);
  if (hours < 24) return hours + " h ago";
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var days = Math.round((today - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
  if (days <= 1) return "yesterday";
  return days + " days ago";
}

function activitySummary(act) {
  if (!act.last) return "No training in the last " + Math.round(ACTIVITY_DAYS / 7) + " weeks";
  return "Last trained " + timeAgo(act.last) + " \u00b7 " + act.daysThisWeek + " day" + (act.daysThisWeek === 1 ? "" : "s") + " this week";
}

// Readiness: is the person's latest recorded set of a lift clearly slower
// than their own earlier sets at that load? The expected speed comes from a
// straight line through their earlier sets (load vs speed), or from earlier
// sets at the same weight. Also flags a set where the bar slowed down a lot
// from the first to the last rep. Only recordings with measured reps count.
function readinessFlags(recs) {
  var flags = [];
  var byLift = {};
  recs.forEach(function (r) {
    var v = setSpeed(r.reps);
    if (v === null || r.weight_kg === null) return;
    (byLift[r.exercise] = byLift[r.exercise] || []).push({ kg: Number(r.weight_kg), v: v, time: new Date(r.recorded_at), reps: r.reps });
  });
  Object.keys(byLift).forEach(function (key) {
    if (!analyzedLift(EXERCISE_BY_KEY[key])) return;
    var sets = byLift[key].sort(function (a, b) { return a.time - b.time; });
    var latest = sets[sets.length - 1];
    if (Date.now() - latest.time > READINESS_RECENT_DAYS * 86400000) return;
    var name = exerciseName(key);

    var day = localDayString(latest.time);
    var before = sets.filter(function (s) { return localDayString(s.time) !== day; });
    var expected = expectedSpeed(before, latest.kg);
    if (expected !== null && expected > 0) {
      var drop = (expected - latest.v) / expected;
      if (drop > READINESS_DROP) {
        flags.push(Math.round(drop * 100) + "% slower than usual on " + name.toLowerCase() + " at " + formatKg(latest.kg));
      }
    }

    var reps = latest.reps.slice().sort(function (a, b) { return a.rep_index - b.rep_index; });
    var first = reps.length >= 3 ? repMeanSpeed(reps[0]) : null;
    var last = reps.length >= 3 ? repMeanSpeed(reps[reps.length - 1]) : null;
    if (first && last !== null && (first - last) / first > HIGH_VELOCITY_LOSS) {
      flags.push("High fatigue in last " + name.toLowerCase() + " set (" + Math.round((first - last) / first * 100) + "% velocity loss)");
    }
  });
  return flags;
}

// Speed expected at kg from earlier sets: a least-squares line when there are
// at least 3 sets over 2+ weights and kg is within (or near) that range,
// otherwise the average of earlier sets within 2.5 kg. Null if neither.
function expectedSpeed(sets, kg) {
  var near = sets.filter(function (s) { return Math.abs(s.kg - kg) <= 2.5; });
  var kgs = sets.map(function (s) { return s.kg; });
  var lo = Math.min.apply(null, kgs), hi = Math.max.apply(null, kgs);
  if (sets.length >= 3 && hi > lo && kg >= lo * 0.9 && kg <= hi * 1.1) {
    var n = sets.length;
    var mx = kgs.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = sets.reduce(function (a, s) { return a + s.v; }, 0) / n;
    var sxy = 0, sxx = 0;
    sets.forEach(function (s) { sxy += (s.kg - mx) * (s.v - my); sxx += (s.kg - mx) * (s.kg - mx); });
    var slope = sxy / sxx;
    if (slope < 0) return my + slope * (kg - mx); // heavier should mean slower
  }
  if (near.length >= 2) return near.reduce(function (a, s) { return a + s.v; }, 0) / near.length;
  return null;
}

// Coaches' feed: the latest training, grouped per person, exercise and day.
var ACTIVITY_FEED_SIZE = 10;
function renderActivityFeed(events) {
  var card = authEl("activityCard");
  var list = authEl("activityList");
  list.innerHTML = "";
  card.hidden = false;
  var groups = [];
  var byKey = {};
  events.forEach(function (e) {
    var key = e.user_id + "|" + (e.exercise || "").toLowerCase() + "|" + localDayString(e.time);
    if (!byKey[key]) { byKey[key] = { first: e, sets: [] }; groups.push(byKey[key]); }
    byKey[key].sets.push(e);
  });
  if (!groups.length) { list.appendChild(el("li", "log-note", "No training logged in the last " + Math.round(ACTIVITY_DAYS / 7) + " weeks.")); return; }
  groups.slice(0, ACTIVITY_FEED_SIZE).forEach(function (g) {
    var member = lastRoster.filter(function (m) { return m.user_id === g.first.user_id; })[0];
    var who = member ? member.full_name : "Someone";
    var isMe = currentUser && g.first.user_id === currentUser.id;
    var li = el("li", "person-row");
    li.appendChild(avatar(who, isMe, member && member.avatar_path));
    var text = el("span", "person-text");
    var top = el("span", "person-line");
    top.appendChild(el("span", "person-name", who + (isMe ? " (you)" : "")));
    top.appendChild(el("span", "person-meta", g.first.exercise || "Exercise"));
    text.appendChild(top);
    text.appendChild(el("span", "person-meta", setGroupSummary(g.sets)));
    li.appendChild(text);
    li.appendChild(el("span", "person-meta activity-time", timeAgo(g.first.time)));
    list.appendChild(li);
  });
}

// "3 sets · top 140 kg × 3 · best set avg 0.52 m/s"
function setGroupSummary(sets) {
  var parts = [sets.length + " set" + (sets.length === 1 ? "" : "s")];
  var top = sets.slice().sort(function (a, b) { return (b.kg || 0) - (a.kg || 0) || (b.reps || 0) - (a.reps || 0); })[0];
  if (top.kg) parts.push("top " + formatKg(top.kg) + (top.reps ? " \u00d7 " + top.reps : ""));
  else if (top.reps) parts.push(top.reps + " reps");
  else if (top.duration) parts.push(formatDuration(top.duration) + (top.distance ? " \u00b7 " + Math.round(top.distance) + " m" : ""));
  var speeds = sets.map(function (s) { return s.speed; }).filter(function (v) { return v !== null && v !== undefined; });
  if (speeds.length) parts.push("best set avg " + Math.max.apply(null, speeds).toFixed(2) + " m/s");
  return parts.join(" \u00b7 ");
}

/* ---- team look: picture and colour ---- */
// 8 colours, each tested readable (contrast at least 3:1) on the light and
// dark page backgrounds.
var TEAM_COLORS = [
  { name: "Blue", hex: "#3D6BE8" }, { name: "Teal", hex: "#13897F" },
  { name: "Green", hex: "#3C8D3F" }, { name: "Gold", hex: "#A87A0A" },
  { name: "Orange", hex: "#D0621F" }, { name: "Red", hex: "#D93B45" },
  { name: "Pink", hex: "#C9468F" }, { name: "Purple", hex: "#8E5BD9" }
];

function renderTeamLook() {
  var view = teamViewEl;
  var logo = authEl("teamLogo");
  var color = currentTeam && currentTeam.color;
  view.style.setProperty("--team", color || "var(--accent)");
  view.classList.toggle("has-team-color", !!color);
  logo.hidden = !currentTeam;
  authEl("teamLookToggle").hidden = !currentTeam || !isTeamStaff();
  if (!currentTeam) { authEl("teamLookPanel").hidden = true; return; }

  logo.innerHTML = "";
  logo.textContent = (currentTeam.teamName || "?").trim().charAt(0).toUpperCase();
  logo.classList.remove("has-photo");
  var forPath = currentTeam.logo_path;
  teamPictureUrl(forPath).then(function (url) {
    if (!url || !currentTeam || currentTeam.logo_path !== forPath) return;
    logo.textContent = "";
    var img = document.createElement("img");
    img.alt = "";
    img.src = url;
    logo.appendChild(img);
    logo.classList.add("has-photo");
  });
  authEl("teamPhotoRemove").hidden = !currentTeam.logo_path;

  var swatches = authEl("teamColorSwatches");
  swatches.innerHTML = "";
  [{ name: "Default", hex: null }].concat(TEAM_COLORS).forEach(function (c) {
    var b = el("button", "color-swatch" + (c.hex ? "" : " is-default"));
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String((currentTeam.color || null) === c.hex));
    b.setAttribute("aria-label", c.name);
    b.title = c.name;
    if (c.hex) b.style.background = c.hex;
    b.addEventListener("click", function () { saveTeamColor(c.hex); });
    swatches.appendChild(b);
  });
}

function saveTeamColor(hex) {
  authEl("teamLookStatus").textContent = "Saving\u2026";
  sb.from("teams").update({ color: hex }).eq("id", currentTeam.team_id).select("color").single().then(function (res) {
    if (res.error) { authEl("teamLookStatus").textContent = "Couldn't save: " + res.error.message; return; }
    currentTeam.color = res.data.color || null;
    authEl("teamLookStatus").textContent = "Saved.";
    renderTeamLook();
    updateTeamBadge();
  });
}

authEl("teamLookToggle").addEventListener("click", function () {
  authEl("teamLookPanel").hidden = false;
  authEl("teamLookToggle").hidden = true;
  authEl("teamLookStatus").textContent = "";
});
authEl("teamLookDone").addEventListener("click", function () {
  authEl("teamLookPanel").hidden = true;
  authEl("teamLookToggle").hidden = false;
});
authEl("teamPhotoBtn").addEventListener("click", function () { authEl("teamPhotoInput").click(); });
authEl("teamPhotoInput").addEventListener("change", function () {
  var file = this.files[0];
  this.value = "";
  if (!file || !currentTeam) return;
  var team = currentTeam, old = team.logo_path;
  authEl("teamLookStatus").textContent = "Uploading\u2026";
  uploadPicture("team-pictures", team.team_id, file, 512).then(function (path) {
    return sb.from("teams").update({ logo_path: path }).eq("id", team.team_id).select("logo_path").single().then(function (res) {
      if (res.error) { removePicture("team-pictures", path); throw res.error; }
      team.logo_path = res.data.logo_path;
      removePicture("team-pictures", old);
      authEl("teamLookStatus").textContent = "Saved.";
      renderTeamLook();
      updateTeamBadge();
    });
  }).catch(function (err) { authEl("teamLookStatus").textContent = "Couldn't upload: " + err.message; });
});
authEl("teamPhotoRemove").addEventListener("click", function () {
  var team = currentTeam, old = team.logo_path;
  sb.from("teams").update({ logo_path: null }).eq("id", team.team_id).then(function (res) {
    if (res.error) { authEl("teamLookStatus").textContent = "Couldn't remove: " + res.error.message; return; }
    team.logo_path = null;
    removePicture("team-pictures", old);
    authEl("teamLookStatus").textContent = "Removed.";
    renderTeamLook();
    updateTeamBadge();
  });
});

/* ---- Today's session ----
   Planned workouts are stored one per day (workouts.scheduled_date). The
   database's rules let athletes read only their own and coaches/admins
   their athletes', so an athlete only ever sees their own day. */
function loadToday() {
  if (!currentTeam || !currentUser) return;
  var teamId = currentTeam.team_id;
  var staff = isTeamStaff();
  var ids = staff ? lastRoster.map(function (m) { return m.user_id; }) : [currentUser.id];
  var today = todayString();
  var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  var queries = [
    sb.from("workouts").select(WORKOUT_FIELDS + ", plan_assignments(id, plans(id, name, content))")
      .in("athlete_id", ids).eq("scheduled_date", today),
    sb.from("set_logs").select("athlete_id, workout_id, done_at").in("athlete_id", ids).gte("done_at", midnight.toISOString())
  ];
  // Athletes with nothing today also get their next planned day.
  if (!staff) {
    queries.push(sb.from("workouts").select(WORKOUT_FIELDS + ", plan_assignments(id, plans(id, name, content))")
      .eq("athlete_id", currentUser.id).gt("scheduled_date", today).order("scheduled_date", { ascending: true }).limit(1));
  }
  Promise.all(queries).then(function (results) {
    if (!currentTeam || currentTeam.team_id !== teamId) return;
    // Training isn't set up (or failed to load): leave the card out.
    if (results[0].error) { authEl("todayCard").hidden = true; return; }
    var workouts = results[0].data || [];
    var logsToday = results[1].error ? [] : (results[1].data || []);
    var next = results[2] && !results[2].error ? (results[2].data || [])[0] : null;
    authEl("todayCard").hidden = false;
    if (staff) renderTodayCoach(workouts, logsToday);
    else renderTodayAthlete(workouts, logsToday, next);
  });
}

// done · started · not started
function todayStatus(w, logsToday) {
  if (w.completed_at) return "done";
  if (w.started_at || logsToday.some(function (l) { return l.workout_id === w.id; })) return "started";
  return "todo";
}
var TODAY_STATUS = { done: "\u2713 Done", started: "In progress", todo: "Not started" };

// "Back squat 5×3 · Strength-speed"
function planItemText(item) {
  var scheme = item.sets && item.repsText ? item.sets + "\u00d7" + item.repsText : (item.repsText || (item.sets ? item.sets + " sets" : ""));
  var text = item.name + (scheme ? " " + scheme : "");
  return item.zone ? text + " \u00b7 " + zoneLabel(item.zone) : text;
}

function renderTodayAthlete(workouts, logsToday, next) {
  var body = authEl("todayBody");
  body.innerHTML = "";
  authEl("todayEyebrow").textContent = "Today \u00b7 " + new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  authEl("todayTitle").textContent = "Your session today";
  if (!workouts.length) {
    authEl("todaySummary").textContent = "No session planned today. Rest, or log a free workout in Training.";
    if (next) {
      var day = new Date(next.scheduled_date + "T00:00:00");
      body.appendChild(el("p", "log-note", "Next: " + workoutTitle(next) + " on " +
        day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })));
    }
    body.appendChild(button("Open Training", "btn-ghost today-open", function () { openMyWorkout(null); }));
    return;
  }
  authEl("todaySummary").textContent = "";
  workouts.forEach(function (w) {
    var block = el("div", "today-workout");
    var head = el("p", "today-workout-head");
    head.appendChild(el("span", "person-name", workoutTitle(w)));
    var status = todayStatus(w, logsToday);
    head.appendChild(el("span", "today-status today-" + status, TODAY_STATUS[status]));
    block.appendChild(head);
    var plan = workoutPlan(w);
    if (plan) block.appendChild(el("p", "person-meta", plan.name));
    var dayPlan = workoutDay(w);
    var items = dayPlan ? dayPlan.items || [] : [];
    if (items.length) {
      var list = el("ul", "today-items");
      items.forEach(function (it) { list.appendChild(el("li", "", planItemText(it))); });
      block.appendChild(list);
    }
    block.appendChild(button(status === "done" ? "See in Training" : status === "started" ? "Continue" : "Start in Training",
                             status === "done" ? "btn-ghost today-open" : "btn today-open", function () { openMyWorkout(w.id); }));
    body.appendChild(block);
  });
}

function renderTodayCoach(workouts, logsToday) {
  var body = authEl("todayBody");
  body.innerHTML = "";
  authEl("todayEyebrow").textContent = "Today \u00b7 " + new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  authEl("todayTitle").textContent = "Today's sessions";

  var trainedToday = {};
  logsToday.forEach(function (l) { trainedToday[l.athlete_id] = true; });
  var planned = workouts.map(function (w) { return { w: w, status: todayStatus(w, logsToday) }; });
  var plannedIds = {};
  planned.forEach(function (p) { plannedIds[p.w.athlete_id] = true; });
  var free = Object.keys(trainedToday).filter(function (id) { return !plannedIds[id]; });

  var people = Object.keys(plannedIds).length;
  var done = planned.filter(function (p) { return p.status === "done"; }).length;
  authEl("todaySummary").textContent = people
    ? people + " " + (people === 1 ? "person has" : "people have") + " a session planned \u00b7 " + done + " done" +
      (free.length ? " \u00b7 " + free.length + " trained without a plan" : "")
    : "Nobody on the team has a session planned today." + (free.length ? " " + free.length + " trained without a plan." : "");

  // Not started first (who still needs to train), then in progress, then done.
  var order = { todo: 0, started: 1, done: 2 };
  planned.sort(function (a, b) { return order[a.status] - order[b.status]; });
  var list = el("ul", "people-list");
  function row(userId, title, status, statusText) {
    var member = lastRoster.filter(function (m) { return m.user_id === userId; })[0];
    if (!member) return;
    var isMe = currentUser && userId === currentUser.id;
    var li = el("li", "person-row");
    var b = el("button", "person-open");
    b.type = "button";
    b.appendChild(avatar(member.full_name, isMe, member.avatar_path));
    var text = el("span", "person-text");
    var top = el("span", "person-line");
    top.appendChild(el("span", "person-name", member.full_name + (isMe ? " (you)" : "")));
    top.appendChild(el("span", "person-meta", title));
    text.appendChild(top);
    b.appendChild(text);
    b.appendChild(el("span", "today-status today-" + status, statusText));
    b.setAttribute("aria-label", "Open " + member.full_name + "'s training");
    b.addEventListener("click", function () { isMe ? openMyWorkout(null) : openAthleteTraining(member); });
    li.appendChild(b);
    list.appendChild(li);
  }
  planned.forEach(function (p) { row(p.w.athlete_id, workoutTitle(p.w), p.status, TODAY_STATUS[p.status]); });
  free.forEach(function (id) { row(id, "Free workout", "done", "Trained"); });
  if (list.children.length) body.appendChild(list);
}

// Open your own training on a given workout (or today's default).
function openMyWorkout(workoutId) {
  training.athleteId = null;
  training.selectedId = workoutId;
  training.tab = "training";
  showPlans();
  window.scrollTo(0, 0);
}

/* ---- managing people (admins): role, remove; and leaving the team ----
   The database already allows exactly this: admins change roles and remove
   members, anyone can leave. A database rule (2026-10-14-keep-an-admin.sql)
   stops a team from losing its last admin. */
var ROLE_CHOICES = [{ role: "member", label: "Athlete" }, { role: "coach", label: "Coach" }, { role: "admin", label: "Admin" }];

function toggleManage(li, m) {
  var open = li.querySelector(".manage-panel");
  var btn = li.querySelector(".person-manage");
  if (open) { open.remove(); btn.setAttribute("aria-expanded", "false"); return; }
  btn.setAttribute("aria-expanded", "true");
  var panel = el("div", "manage-panel");
  var status = el("p", "log-note");

  var roles = el("div", "role-choices");
  roles.setAttribute("role", "radiogroup");
  roles.setAttribute("aria-label", "Role for " + m.full_name);
  roles.appendChild(el("span", "team-desc-label", "Role"));
  ROLE_CHOICES.forEach(function (c) {
    var b = button(c.label, "role-choice", function () {
      if (c.role === m.role) return;
      status.textContent = "Saving\u2026";
      setMemberRole(m, c.role).then(function (err) { if (err) status.textContent = err; });
    });
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(c.role === m.role));
    roles.appendChild(b);
  });
  panel.appendChild(roles);

  var remove = button("Remove from team", "text-link danger-link", function () {
    remove.hidden = true;
    var confirm = el("div", "team-confirm");
    confirm.appendChild(el("p", "", "Remove " + m.full_name + " from " + currentTeam.teamName + "? They lose access to the team page and " +
      "its coaches can no longer see their training. Their own training data stays theirs. You can invite them again later."));
    var row = el("div", "log-row");
    row.appendChild(button("Remove", "btn-danger", function () {
      status.textContent = "Removing\u2026";
      removeMember(m).then(function (err) { if (err) status.textContent = err; });
    }));
    row.appendChild(button("Cancel", "btn-ghost", function () { confirm.remove(); remove.hidden = false; }));
    confirm.appendChild(row);
    panel.insertBefore(confirm, status);
  });
  panel.appendChild(remove);
  panel.appendChild(status);
  li.appendChild(panel);
}

var LAST_ADMIN_MSG = "A team needs at least one admin. Make someone else admin first.";
function memberError(res, fallback) {
  if (res.error) return /at least one admin/i.test(res.error.message) ? LAST_ADMIN_MSG : res.error.message;
  // The database answers with no rows (not an error) when something isn't allowed.
  if (!res.data || !res.data.length) return fallback;
  return null;
}

function setMemberRole(m, role) {
  return sb.from("team_members").update({ role: role })
    .eq("team_id", currentTeam.team_id).eq("user_id", m.user_id).select("role")
    .then(function (res) {
      var err = memberError(res, "Couldn't change the role: only admins can do that.");
      if (!err) { setTeamNotice(m.full_name + " is now " + (role === "member" ? "an athlete" : "a" + (role === "admin" ? "n " : " ") + role) + "."); loadRoster(); }
      return err;
    });
}

function removeMember(m) {
  return sb.from("team_members").delete()
    .eq("team_id", currentTeam.team_id).eq("user_id", m.user_id).select("user_id")
    .then(function (res) {
      var err = memberError(res, "Couldn't remove them: only admins can do that.");
      if (!err) { setTeamNotice(m.full_name + " was removed from the team."); loadRoster(); loadStats(); loadWeeklyVolume(); loadTopPrs(); }
      return err;
    });
}

function closeLeaveConfirm() {
  authEl("leaveTeamConfirm").hidden = true;
  authEl("leaveTeamBtn").hidden = false;
  authEl("leaveTeamStatus").textContent = "";
}
authEl("leaveTeamBtn").addEventListener("click", function () {
  if (!currentTeam) return;
  authEl("leaveTeamText").textContent = "Leave " + currentTeam.teamName + "? You lose access to the team page and its coaches " +
    "can no longer see your training. Your own training data stays yours. To come back you need a new invite or join request.";
  authEl("leaveTeamConfirm").hidden = false;
  authEl("leaveTeamBtn").hidden = true;
});
authEl("leaveTeamNo").addEventListener("click", closeLeaveConfirm);
authEl("leaveTeamYes").addEventListener("click", function () {
  var team = currentTeam;
  authEl("leaveTeamStatus").textContent = "Leaving\u2026";
  sb.from("team_members").delete().eq("team_id", team.team_id).eq("user_id", currentUser.id).select("user_id").then(function (res) {
    var err = memberError(res, "Couldn't leave the team.");
    if (err) { authEl("leaveTeamStatus").textContent = err; return; }
    closeLeaveConfirm();
    authNotice = "You left " + team.teamName + ".";
    // Load the account again: no team now, so the page shows team search.
    loadMembership(currentUser).then(function () { if (!teamViewEl.hidden) renderTeamPage(); });
  });
});

/* ---- stats ---- */
var lastStats = [];
var lastWeeks = null; // [{ week_start: "YYYY-MM-DD", total_kg, sets, athletes }], oldest first

// Display name for an exercise key from sessions ("back_squat" -> "Back squat").
function exerciseName(key) {
  var ex = EXERCISE_BY_KEY[key];
  return ex ? ex.name : key;
}

function localDayString(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Kilos per week for the last 5 weeks (team_weekly_volume in
// supabase/migrations/2026-10-14-team-stats.sql). Team totals only.
function loadWeeklyVolume() {
  var teamId = currentTeam.team_id;
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  sb.rpc("team_weekly_volume", { p_team: teamId, p_tz: tz, p_weeks: 5 }).then(function (res) {
    if (!currentTeam || currentTeam.team_id !== teamId) return;
    lastWeeks = res.error ? null : (res.data || []);
    renderStatTiles();
  });
}

// This week's kilos against the average of the earlier weeks, scaled to how
// far into the week we are. Arrow: more than 5% ahead / behind that pace.
// Earlier weeks count from the first week the team logged anything, so a
// new team isn't compared with empty weeks before it started.
var PACE_MARGIN = 0.05;
function weeklyTile() {
  var now = new Date();
  var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  var thisWeekKey = localDayString(monday);
  var byWeek = {};
  lastWeeks.forEach(function (w) { byWeek[w.week_start] = Number(w.total_kg); });
  var thisWeek = byWeek[thisWeekKey] || 0;

  var earlier = [];
  for (var i = 4; i >= 1; i--) {
    var key = localDayString(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * i));
    if (earlier.length || byWeek[key]) earlier.push(byWeek[key] || 0);
  }
  if (!earlier.length) return statTile("Lifted this week", formatKg(thisWeek), "No earlier weeks to compare with yet");

  var avg = earlier.reduce(function (a, b) { return a + b; }, 0) / earlier.length;
  var share = (now - monday) / (7 * 86400000);
  var expected = avg * share;
  var arrow = "\u2192", state = "on", text = "On pace";
  if (expected > 0 && thisWeek > expected * (1 + PACE_MARGIN)) { arrow = "\u2191"; state = "up"; text = "Ahead of pace"; }
  else if (thisWeek < expected * (1 - PACE_MARGIN)) { arrow = "\u2193"; state = "down"; text = "Behind pace"; }

  var tile = statTile("Lifted this week", formatKg(thisWeek),
    text + " \u00b7 avg " + formatKg(avg) + "/week (last " + earlier.length + " week" + (earlier.length === 1 ? "" : "s") + ")");
  var value = tile.querySelector(".stat-value");
  value.appendChild(el("span", "pace-arrow pace-" + state, " " + arrow));
  tile.title = "By now in an average week the team has lifted about " + formatKg(expected) + ".";
  return tile;
}

/* ---- Top PRs (team_top_lifts) ---- */
function loadTopPrs() {
  var teamId = currentTeam.team_id;
  var box = authEl("topPrs");
  box.innerHTML = "";
  box.appendChild(el("p", "log-note", "Loading\u2026"));
  var mins = SPEED_ZONES.slice(0, -1).map(function (z) { return z.min; });
  sb.rpc("team_top_lifts", { p_team: teamId, p_zone_mins: mins, p_per_zone: 3 }).then(function (res) {
    if (!currentTeam || currentTeam.team_id !== teamId) return;
    box.innerHTML = "";
    if (res.error) { box.appendChild(el("p", "log-note", res.error.message)); return; }
    // Only the lifts V-Lo analyses (not test recordings).
    var rows = (res.data || []).filter(function (r) { return analyzedLift(EXERCISE_BY_KEY[r.exercise]); });
    if (!rows.length) { box.appendChild(el("p", "log-note", "No sensor-recorded sets with a measured bar speed yet.")); return; }

    var byExercise = {};
    rows.forEach(function (r) { (byExercise[r.exercise] = byExercise[r.exercise] || []).push(r); });
    Object.keys(byExercise).sort(function (a, b) { return exerciseName(a).localeCompare(exerciseName(b)); }).forEach(function (key) {
      var section = el("div", "pr-exercise");
      section.appendChild(el("h4", "pr-exercise-name", exerciseName(key)));
      var grid = el("div", "pr-zones");
      SPEED_ZONES.forEach(function (zone, idx) {
        var col = el("div", "pr-zone");
        var head = el("p", "pr-zone-name");
        var swatch = el("span", "swatch");
        swatch.style.background = "var(--zone-" + (idx + 1) + ")";
        head.appendChild(swatch);
        head.appendChild(document.createTextNode(zone.label));
        col.appendChild(head);
        var list = el("ol", "pr-list");
        byExercise[key].filter(function (r) { return r.zone_idx === idx; }).forEach(function (r) {
          var li = el("li", "pr-row");
          var isMe = currentUser && r.user_id === currentUser.id;
          li.appendChild(el("span", "pr-rank", String(r.rank)));
          li.appendChild(avatar(r.full_name, isMe, r.avatar_path));
          var who = el("span", "pr-who");
          who.appendChild(el("span", "person-name", r.full_name + (isMe ? " (you)" : "")));
          var when = new Date(r.recorded_at);
          who.appendChild(el("span", "person-meta",
            when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + ", " +
            when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })));
          li.appendChild(who);
          var nums = el("span", "pr-nums");
          nums.appendChild(el("span", "pr-kg", formatKg(Number(r.weight_kg))));
          nums.appendChild(el("span", "person-meta", Number(r.mean_velocity).toFixed(2) + " m/s avg"));
          li.appendChild(nums);
          list.appendChild(li);
        });
        if (!list.children.length) col.appendChild(el("p", "log-note", "No sets yet."));
        else col.appendChild(list);
        grid.appendChild(col);
      });
      section.appendChild(grid);
      box.appendChild(section);
    });
  });
}

function loadStats() {
  sb.rpc("team_stats", { p_team: currentTeam.team_id }).then(function (res) {
    lastStats = res.error ? [] : (res.data || []);
    renderStatTiles();
  });
}

function statTile(label, value, sub) {
  var tile = el("div", "stat-tile");
  tile.appendChild(el("p", "stat-label", label));
  tile.appendChild(el("p", "stat-value", value));
  if (sub) tile.appendChild(el("p", "stat-sub", sub));
  return tile;
}

function renderStatTiles() {
  var box = authEl("teamStats");
  box.innerHTML = "";
  function count(role, one, many) {
    var n = lastRoster.filter(function (m) { return m.role === role; }).length;
    return n ? n + " " + (n === 1 ? one : many) : "";
  }
  var athletes = lastRoster.filter(function (m) { return m.role === "member"; }).length;
  var staff = [count("coach", "coach", "coaches"), count("admin", "admin", "admins")].filter(Boolean).join(" · ");
  box.appendChild(statTile("Athletes", String(athletes), staff ? "plus " + staff : ""));
  var totalKg = lastStats.reduce(function (sum, r) { return sum + Number(r.total_kg || 0); }, 0);
  var sessions = lastStats.reduce(function (sum, r) { return sum + r.sessions; }, 0);
  box.appendChild(statTile("Total lifted", formatKg(totalKg), sessions + " session" + (sessions === 1 ? "" : "s") + " · load × reps"));
  if (lastWeeks) box.appendChild(weeklyTile());

  var speed = el("div", "stat-tile stat-tile-wide");
  speed.appendChild(el("p", "stat-label", "Average bar speed per lift"));
  // Only the three competition lifts, always in this order. Variations (pause
  // squat, sumo...) move at different speeds and test recordings aren't
  // training, so they're left out.
  ["back_squat", "bench_press", "deadlift"].forEach(function (key) {
    var r = lastStats.filter(function (x) { return x.exercise === key && x.avg_mean_velocity !== null; })[0];
    var row = el("p", "stat-row");
    row.appendChild(el("span", "", exerciseName(key)));
    row.appendChild(el("span", r ? "mono" : "stat-sub", r ? Number(r.avg_mean_velocity).toFixed(2) + " m/s" : "no data yet"));
    speed.appendChild(row);
  });
  box.appendChild(speed);
}

/* ---- one person's progress ---- */
function hideProgress() {
  authEl("athleteProgress").hidden = true;
}
authEl("progressClose").addEventListener("click", hideProgress);

function repMeanSpeed(rep) {
  var l = rep.left_mean_velocity, r = rep.right_mean_velocity;
  if (l !== null && r !== null) return (Number(l) + Number(r)) / 2;
  if (l !== null) return Number(l);
  if (r !== null) return Number(r);
  return null;
}

var progressMember = null;
authEl("progressTraining").addEventListener("click", function () { if (progressMember) openAthleteTraining(progressMember); });

function showProgress(member) {
  progressMember = member;
  authEl("progressTraining").textContent = currentUser && member.user_id === currentUser.id ? "See my training" : "See their training";
  var card = authEl("athleteProgress");
  card.hidden = false;
  authEl("progressName").textContent = member.full_name;
  authEl("progressSummary").innerHTML = "";
  authEl("progressCharts").innerHTML = "";
  authEl("progressRows").innerHTML = "";
  authEl("progressStatus").textContent = "Loading…";
  card.scrollIntoView({ behavior: "smooth", block: "start" });

  sb.from("sessions")
    .select("id, exercise, weight_kg, recorded_at, reported_rep_count, " +
            "reps(rep_index, left_mean_velocity, left_peak_velocity, right_mean_velocity, right_peak_velocity)")
    .eq("user_id", member.user_id)
    .order("recorded_at", { ascending: false })
    .then(function (res) {
      if (res.error) { authEl("progressStatus").textContent = res.error.message; return; }
      var sessions = res.data || [];
      authEl("progressStatus").textContent = sessions.length ? "" : member.full_name + " hasn't logged any sessions yet.";

      var byExercise = {};
      sessions.forEach(function (s) {
        var speeds = s.reps.map(repMeanSpeed).filter(function (v) { return v !== null; });
        s.meanSpeed = speeds.length ? speeds.reduce(function (a, b) { return a + b; }, 0) / speeds.length : null;
        s.repCount = s.reps.length || s.reported_rep_count || 0;
        (byExercise[s.exercise] = byExercise[s.exercise] || []).push(s);
      });

      // One tile per lift: heaviest load, and how bar speed moved from first to latest session.
      Object.keys(byExercise).sort().forEach(function (exercise) {
        var list = byExercise[exercise]; // newest first
        var best = Math.max.apply(null, list.map(function (s) { return Number(s.weight_kg || 0); }));
        var latest = list[0], first = list[list.length - 1];
        var sub = list.length + " session" + (list.length === 1 ? "" : "s");
        if (latest.meanSpeed !== null && first.meanSpeed !== null && list.length > 1) {
          var diff = latest.meanSpeed - first.meanSpeed;
          sub += " · speed " + (diff >= 0 ? "+" : "") + diff.toFixed(2) + " m/s since first";
        }
        authEl("progressSummary").appendChild(statTile(exerciseName(exercise), "Best " + formatKg(best), sub));
      });

      // Speed-over-time chart for each lift with measured reps.
      Object.keys(byExercise).sort().forEach(function (exercise) {
        if (!analyzedLift(EXERCISE_BY_KEY[exercise])) return;
        var points = byExercise[exercise].filter(function (s) { return s.meanSpeed !== null; });
        if (points.length) authEl("progressCharts").appendChild(speedHistoryChart(exerciseName(exercise), points));
      });

      // One row per set; clicking it opens that set's reps underneath.
      var rows = authEl("progressRows");
      sessions.forEach(function (s) {
        var tr = el("tr", "progress-set");
        tr.tabIndex = 0;
        tr.setAttribute("aria-expanded", "false");
        tr.appendChild(el("td", "", formatDate(s.recorded_at)));
        tr.appendChild(el("td", "", exerciseName(s.exercise)));
        tr.appendChild(el("td", "num", s.weight_kg === null ? "—" : formatKg(Number(s.weight_kg))));
        tr.appendChild(el("td", "num", String(s.repCount)));
        tr.appendChild(el("td", "num", s.meanSpeed === null ? "—" : s.meanSpeed.toFixed(2) + " m/s"));
        var best = fastestRep(s.reps);
        tr.appendChild(el("td", "num", best ? best.speed.toFixed(2) + " m/s (rep " + best.rep + ")" : "—"));
        rows.appendChild(tr);

        var detail = el("tr", "progress-detail");
        detail.hidden = true;
        var cell = el("td");
        cell.colSpan = 6;
        cell.appendChild(repDetail(s));
        detail.appendChild(cell);
        rows.appendChild(detail);

        function toggle() {
          detail.hidden = !detail.hidden;
          tr.setAttribute("aria-expanded", String(!detail.hidden));
        }
        tr.addEventListener("click", toggle);
        tr.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
      });
    });
}

// Chart of one lift's average set speed over time, with the speed zones as
// faint bands behind. Each dot is a set, coloured by its zone; hovering shows
// date, weight × reps and speed. sets: [{ recorded_at, weight_kg, repCount, meanSpeed }].
function speedHistoryChart(title, sets) {
  var card = el("div", "progress-chart");
  card.appendChild(el("p", "stat-label", title + " \u00b7 average set speed"));
  var pts = sets.map(function (s) {
    return { t: new Date(s.recorded_at).getTime(), v: s.meanSpeed, kg: s.weight_kg === null ? null : Number(s.weight_kg), reps: s.repCount };
  }).sort(function (a, b) { return a.t - b.t; });

  var W = 600, H = 210, m = { l: 44, r: 12, t: 12, b: 28 };
  var maxV = Math.max.apply(null, pts.map(function (p) { return p.v; }));
  var yMax = Math.max(1, Math.ceil((maxV + 0.1) * 4) / 4);
  var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  var span = t1 - t0 || 86400000;
  function x(t) { return pts.length === 1 ? (m.l + W - m.r) / 2 : m.l + (t - t0) / span * (W - m.l - m.r); }
  function y(v) { return m.t + (1 - v / yMax) * (H - m.t - m.b); }

  var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "progress-svg", role: "img",
                           "aria-label": title + ": average set speed over time" });
  // zone bands, fastest at the top
  SPEED_ZONES.forEach(function (z, i) {
    var hi = i === 0 ? yMax : Math.min(SPEED_ZONES[i - 1].min, yMax);
    if (z.min >= yMax) return;
    svg.appendChild(svgEl("rect", { x: m.l, y: y(hi), width: W - m.l - m.r, height: y(z.min) - y(hi),
                                    style: "fill: var(--zone-" + (i + 1) + "); opacity: 0.09" }));
  });
  // y axis: a line and label every 0.25 m/s
  for (var v = 0; v <= yMax + 1e-9; v += 0.25) {
    svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "progress-grid" }));
    var t = svgEl("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", class: "progress-axis" });
    t.textContent = v.toFixed(2);
    svg.appendChild(t);
  }
  // x axis: first and last date
  function dateLabel(time, anchor, xPos) {
    var d = svgEl("text", { x: xPos, y: H - 8, "text-anchor": anchor, class: "progress-axis" });
    d.textContent = new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    svg.appendChild(d);
  }
  dateLabel(t0, pts.length === 1 ? "middle" : "start", x(t0));
  if (pts.length > 1) dateLabel(t1, "end", x(t1));
  // line through the sets, then a dot per set
  if (pts.length > 1) {
    svg.appendChild(svgEl("path", { d: pts.map(function (p, i) { return (i ? "L" : "M") + x(p.t).toFixed(1) + "," + y(p.v).toFixed(1); }).join(" "),
                                    class: "progress-line" }));
  }
  var ex = { zones: SPEED_ZONES };
  pts.forEach(function (p) {
    var dot = svgEl("circle", { cx: x(p.t), cy: y(p.v), r: 5, class: "progress-dot", style: "fill: " + zoneColor(ex, p.v) });
    var tip = svgEl("title", {});
    tip.textContent = new Date(p.t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + "\n" +
      (p.kg === null ? "" : formatKg(p.kg) + (p.reps ? " \u00d7 " + p.reps : "") + "\n") +
      p.v.toFixed(2) + " m/s \u00b7 " + zoneLabel(zoneFor(ex, p.v));
    dot.appendChild(tip);
    svg.appendChild(dot);
  });
  card.appendChild(svg);
  // legend: the zones shown as bands
  var legend = el("p", "progress-legend");
  SPEED_ZONES.forEach(function (z, i) {
    if (z.min >= yMax) return;
    var item = el("span", "progress-legend-item");
    var sw = el("span", "swatch");
    sw.style.background = "var(--zone-" + (i + 1) + ")";
    item.appendChild(sw);
    item.appendChild(document.createTextNode(z.label));
    legend.appendChild(item);
  });
  card.appendChild(legend);
  card.appendChild(el("p", "log-note", "Each dot is a set; hover for weight and speed. Heavier sets are naturally slower, so compare dots at similar weights."));
  return card;
}

// The set's fastest rep by mean speed (left/right averaged): { rep, speed } or null.
function fastestRep(reps) {
  var best = null;
  reps.forEach(function (r) {
    var v = repMeanSpeed(r);
    if (v !== null && (!best || v > best.speed)) best = { rep: r.rep_index, speed: v };
  });
  return best;
}

// The reps of one set: mean and peak bar speed per sleeve, plus velocity loss.
function repDetail(session) {
  var box = el("div", "rep-detail");
  var reps = session.reps.slice().sort(function (a, b) { return a.rep_index - b.rep_index; });
  if (!reps.length) {
    box.appendChild(el("p", "log-note", "No reps calculated for this set yet."));
    return box;
  }

  function speed(v) { return v === null || v === undefined ? "—" : Number(v).toFixed(2); }
  var table = el("table", "rep-table");
  var head = el("tr");
  ["Rep", "Left mean", "Left peak", "Right mean", "Right peak", ""].forEach(function (h) { head.appendChild(el("th", "", h)); });
  table.appendChild(el("thead")).appendChild(head);
  var body = el("tbody");
  reps.forEach(function (r) {
    var tr = el("tr");
    tr.appendChild(el("td", "num", String(r.rep_index)));
    [r.left_mean_velocity, r.left_peak_velocity, r.right_mean_velocity, r.right_peak_velocity]
      .forEach(function (v) { tr.appendChild(el("td", "num", speed(v))); });
    // Flag reps where left and right disagree (threshold: LR_MISMATCH_LIMIT in core.js).
    var uneven = isUneven(r.left_mean_velocity, r.right_mean_velocity);
    tr.appendChild(el("td", "rep-flag", uneven
      ? "Uneven left/right (" + Math.round(lrMismatch(r.left_mean_velocity, r.right_mean_velocity) * 100) + "%)" : ""));
    body.appendChild(tr);
  });
  table.appendChild(body);
  box.appendChild(table);

  var first = repMeanSpeed(reps[0]), last = repMeanSpeed(reps[reps.length - 1]);
  var note = "Speeds in m/s. Uneven = left and right mean speeds more than " + Math.round(LR_MISMATCH_LIMIT * 100) + "% apart.";
  if (reps.length > 1 && first > 0 && last !== null) {
    note += " Velocity loss, first to last rep: " + Math.round((first - last) / first * 100) + "%.";
  }
  box.appendChild(el("p", "log-note", note));
  return box;
}

/* ---- join requests (coaches/admins) ---- */
// The card only shows while someone is waiting; the count also goes on the
// team badge in the header so coaches notice from any tab.
function setJoinRequestCount(n) {
  pendingJoinCount = n;
  authEl("joinRequestCount").textContent = n || "";
  authEl("joinRequestsCard").hidden = !n || !isTeamStaff();
  updateTeamBadge();
}

// Just the number, without loading the list (used when logging in).
function refreshJoinRequestCount() {
  if (!currentTeam || !isTeamStaff()) { setJoinRequestCount(0); return; }
  sb.from("team_join_requests").select("id", { count: "exact", head: true })
    .eq("team_id", currentTeam.team_id).eq("status", "pending")
    .then(function (res) { if (!res.error) setJoinRequestCount(res.count || 0); });
}

function loadJoinRequests() {
  sb.from("team_join_requests")
    .select("id, created_at, invite_id, requester:profiles!team_join_requests_user_id_fkey(full_name, avatar_path)")
    .eq("team_id", currentTeam.team_id)
    .eq("status", "pending")
    .order("created_at")
    .then(function (res) {
      var list = authEl("joinRequestList");
      list.innerHTML = "";
      if (res.error) { authEl("joinRequestsCard").hidden = false; list.appendChild(el("li", "log-note", res.error.message)); return; }
      setJoinRequestCount(res.data.length);
      res.data.forEach(function (r) {
        var li = el("li", "person-row");
        var who = r.requester ? r.requester.full_name : "Someone";
        li.appendChild(avatar(who, false, r.requester && r.requester.avatar_path));
        li.appendChild(el("span", "person-name", who));
        li.appendChild(el("span", "person-meta", r.invite_id ? "suggested by a teammate" : "found the team in search"));
        var actions = el("span", "person-actions");
        actions.appendChild(button("Accept", "btn", function () { answerRequest(r.id, true, li); }));
        actions.appendChild(button("Reject", "btn-ghost", function () { answerRequest(r.id, false, li); }));
        li.appendChild(actions);
        list.appendChild(li);
      });
    });
}

function answerRequest(id, accept, li) {
  li.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
  sb.rpc("answer_join_request", { p_request: id, p_accept: accept }).then(function (res) {
    if (res.error) {
      li.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      setTeamNotice(res.error.message);
      return;
    }
    loadJoinRequests();
    if (accept) { loadRoster(); loadStats(); }
  });
}

/* ---- adding people: collapsed behind a button ---- */
function setAddPeopleOpen(open) {
  authEl("addPeopleBody").hidden = !open;
  authEl("addPeopleToggle").setAttribute("aria-expanded", String(open));
  authEl("addPeopleToggle").hidden = open;
  if (open) authEl("userSearchInput").focus();
}
authEl("addPeopleToggle").addEventListener("click", function () { setAddPeopleOpen(true); });

/* ---- adding people: in-app invites ---- */
var userSearchInput = authEl("userSearchInput");
var runUserSearch = debounce(function () {
  var q = userSearchInput.value.trim();
  var box = authEl("userSearchResults");
  if (q.length < 2 || !currentTeam) { box.innerHTML = ""; return; }
  sb.rpc("search_users", { q: q, p_team: currentTeam.team_id }).then(function (res) {
    if (userSearchInput.value.trim() !== q) return; // a newer search is on its way
    box.innerHTML = "";
    if (res.error) { box.appendChild(el("p", "log-note", res.error.message)); return; }
    if (!res.data.length) { box.appendChild(el("p", "log-note", "Nobody found. They need a V-Lo account first; you can send them an invite link instead.")); return; }
    res.data.forEach(function (u) {
      var row = el("div", "person-row");
      row.appendChild(el("span", "person-name", u.full_name));
      var actions = el("span", "person-actions");
      if (u.invite_pending) {
        actions.appendChild(el("span", "person-meta", "invited"));
      } else if (isTeamStaff()) {
        actions.appendChild(button("Invite as athlete", "btn-ghost", function () { inviteUser(u, "member", actions); }));
        actions.appendChild(button("Invite as coach", "btn-ghost", function () { inviteUser(u, "coach", actions); }));
      } else {
        actions.appendChild(button("Suggest", "btn-ghost", function () { inviteUser(u, "member", actions); }));
      }
      row.appendChild(actions);
      box.appendChild(row);
    });
  });
}, 250);
userSearchInput.addEventListener("input", runUserSearch);

function inviteUser(user, role, actions) {
  actions.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
  sb.rpc("invite_user", { p_team: currentTeam.team_id, p_user: user.user_id, p_role: role }).then(function (res) {
    actions.innerHTML = "";
    actions.appendChild(el("span", "person-meta", res.error ? res.error.message : (isTeamStaff() ? "invited" : "suggested")));
    if (!res.error) loadSentInvites();
  });
}

// Invites this team has sent that nobody has answered yet (staff see all, athletes their own).
function loadSentInvites() {
  sb.from("team_invites")
    .select("id, role, created_at, created_by, invitee:profiles!team_invites_invited_user_id_fkey(full_name)")
    .eq("team_id", currentTeam.team_id)
    .eq("status", "pending")
    .not("invited_user_id", "is", null)
    .order("created_at", { ascending: false })
    .then(function (res) {
      var list = authEl("sentInviteList");
      list.innerHTML = "";
      if (res.error || !res.data.length) return;
      list.appendChild(el("li", "eyebrow sent-heading", "Waiting for an answer"));
      res.data.forEach(function (inv) {
        var li = el("li", "person-row");
        li.appendChild(el("span", "person-name", inv.invitee ? inv.invitee.full_name : "Someone"));
        li.appendChild(el("span", "person-meta", "as " + roleLabel(inv.role) + " · " + formatDate(inv.created_at)));
        if (isTeamStaff() || (currentUser && inv.created_by === currentUser.id)) {
          var actions = el("span", "person-actions");
          actions.appendChild(button("Cancel", "btn-ghost", function () {
            sb.from("team_invites").delete().eq("id", inv.id).then(loadSentInvites);
          }));
          li.appendChild(actions);
        }
        list.appendChild(li);
      });
    });
}

/* ---- adding people: invite links ---- */
authEl("createInviteBtn").addEventListener("click", function () {
  if (!currentTeam) return;
  var role = isTeamStaff() ? authEl("inviteRoleSelect").value : "member";
  authEl("inviteStatus").textContent = "Creating link…";
  sb.from("team_invites").insert({ team_id: currentTeam.team_id, role: role }).select().single()
    .then(function (res) {
      if (res.error) { authEl("inviteStatus").textContent = res.error.message; return; }
      var link = window.location.origin + window.location.pathname + "?invite=" + res.data.id;
      authEl("inviteLinkRow").hidden = false;
      authEl("inviteLinkOut").value = link;
      authEl("inviteStatus").textContent = isTeamStaff()
        ? "Share it any way you like. Whoever opens it and signs up (or logs in) joins as " + (role === "member" ? "an athlete" : "a coach") + "."
        : "Share it any way you like. Whoever opens it sends a join request, and a coach or admin decides.";
    });
});
authEl("copyInviteBtn").addEventListener("click", function () {
  var input = authEl("inviteLinkOut");
  input.select();
  try { document.execCommand("copy"); authEl("inviteStatus").textContent = "Copied."; } catch (e) { /* clipboard not available */ }
});

/* ---------------- team search (when not in a team) ---------------- */
var teamSearchInput = authEl("teamSearchInput");
var runTeamSearch = debounce(function () {
  var q = teamSearchInput.value.trim();
  var box = authEl("teamSearchResults");
  if (q.length < 2) { box.innerHTML = ""; return; }
  sb.rpc("search_teams", { q: q }).then(function (res) {
    if (teamSearchInput.value.trim() !== q) return;
    box.innerHTML = "";
    if (res.error) { box.appendChild(el("p", "log-note", res.error.message)); return; }
    if (!res.data.length) { box.appendChild(el("p", "log-note", "No teams match “" + q + "”.")); return; }
    res.data.forEach(function (t) { box.appendChild(teamResult(t)); });
    // Search knows you're in a team the page hasn't loaded: reload it.
    if (!currentTeam && currentUser && res.data.some(function (t) { return t.is_member; })) {
      loadMembership(currentUser).then(function () { if (!teamViewEl.hidden) renderTeamPage(); });
    }
  });
}, 250);
teamSearchInput.addEventListener("input", runTeamSearch);

// Only what search is allowed to show: name, public description, creator, member count.
function teamResult(t) {
  var card = el("div", "team-result");
  var head = el("div", "team-result-head");
  var titles = el("div");
  titles.appendChild(el("h4", "", t.name));
  titles.appendChild(el("p", "person-meta",
    "Created by " + (t.creator_name || "unknown") + " · " + t.member_count + " member" + (t.member_count === 1 ? "" : "s")));
  head.appendChild(titles);
  var action = el("span", "person-actions");
  if (t.is_member) action.appendChild(el("span", "person-meta", "You're a member"));
  else if (t.has_pending_request) action.appendChild(el("span", "person-meta", "Request sent"));
  else action.appendChild(button("Request to join", "btn", function () {
    action.innerHTML = "";
    action.appendChild(el("span", "person-meta", "Sending…"));
    sb.rpc("request_to_join", { p_team: t.team_id }).then(function (res) {
      action.innerHTML = "";
      action.appendChild(el("span", "person-meta", res.error ? res.error.message : "Request sent"));
    });
  }));
  head.appendChild(action);
  card.appendChild(head);
  if (t.public_description) card.appendChild(el("p", "team-bio", t.public_description));
  return card;
}

/* ---------------- invites inbox (home screen) ---------------- */
function refreshInbox() {
  var inbox = authEl("inviteInbox");
  if (!sb || !currentUser) { inbox.hidden = true; setInviteCount(0); return; }
  sb.rpc("my_invites").then(function (res) {
    var list = authEl("inviteList");
    list.innerHTML = "";
    var invites = res.error ? [] : (res.data || []);
    setInviteCount(invites.length);
    inbox.hidden = !invites.length;
    invites.forEach(function (inv) { list.appendChild(inviteCard(inv)); });
  });
}

function inviteCard(inv) {
  var card = el("div", "invite-card");
  var text = el("div", "invite-text");
  // Athlete suggestions can't be accepted directly, only turned into a join request.
  text.appendChild(el("p", "invite-title", inv.needs_approval
    ? (inv.invited_by || "A teammate") + " suggested you join " + inv.team_name
    : (inv.invited_by || "A coach") + " invited you to join " + inv.team_name + " as " + (inv.role === "member" ? "an athlete" : "a coach")));
  if (inv.public_description) text.appendChild(el("p", "team-bio invite-desc", inv.public_description));
  if (inv.needs_approval) text.appendChild(el("p", "log-note", "A coach or admin of the team has to approve your request."));
  card.appendChild(text);

  var actions = el("div", "person-actions");
  function respond(action) {
    actions.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    sb.rpc("respond_to_invite", { p_invite: inv.invite_id, p_action: action }).then(function (res) {
      if (res.error) {
        actions.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
        actions.appendChild(el("span", "log-note", res.error.message));
        return;
      }
      if (res.data === "joined") {
        authNotice = "Welcome to " + inv.team_name + "!";
        loadMembership(currentUser).then(showTeamPage);
      } else if (res.data === "requested") {
        authNotice = "Join request sent to " + inv.team_name + ".";
      }
      refreshInbox();
    });
  }
  if (inv.needs_approval) {
    actions.appendChild(button("Request to join team", "btn", function () { respond("request"); }));
    actions.appendChild(button("Ignore team suggestion", "btn-ghost", function () { respond("ignore"); }));
  } else {
    actions.appendChild(button("Accept", "btn", function () { respond("accept"); }));
    actions.appendChild(button("Decline", "btn-ghost", function () { respond("decline"); }));
  }
  card.appendChild(actions);
  return card;
}

/* ---------------- profile icon + account settings ---------------- */
var accountOverlayEl = authEl("accountModalOverlay");

function setInviteCount(n) {
  authEl("profileDot").hidden = n === 0;
  authEl("profileBtn").setAttribute("aria-label",
    currentUser ? "Account settings" + (n ? " (" + n + " team invite" + (n === 1 ? "" : "s") + ")" : "") : "Log in");
}

function updateProfileButton() {
  var initial = authEl("profileInitial");
  var svg = authEl("profileBtn").querySelector("svg");
  var name = currentProfile && currentProfile.full_name;
  var photo = currentUser && currentProfile ? profilePictureUrl(currentProfile.avatar_path) : null;
  initial.textContent = name ? name.trim().charAt(0).toUpperCase() : "";
  initial.hidden = !name || !!photo;
  svg.style.display = name || photo ? "none" : "";
  [["profilePhoto", "profileBtn"], ["navProfilePhoto", "navProfileBtn"]].forEach(function (ids) {
    var img = authEl(ids[0]);
    img.hidden = !photo;
    if (photo) img.src = photo; else img.removeAttribute("src");
    authEl(ids[1]).classList.toggle("has-photo", !!photo);
  });
  authEl("navProfileInitial").hidden = !!photo;
  authEl("profileBtn").classList.toggle("is-logged-in", !!currentUser);
  // Landing-page nav: show the profile circle instead of "Log in" once logged in.
  authEl("navLoginBtn").hidden = !!currentUser;
  authEl("navProfileBtn").hidden = !currentUser;
  authEl("navProfileInitial").textContent = name ? name.trim().charAt(0).toUpperCase()
    : (currentUser ? currentUser.email.charAt(0).toUpperCase() : "");
}

authEl("profileBtn").addEventListener("click", function () {
  if (!currentUser) { setAuthMode("login"); openAuthModal(); return; }
  authEl("accountEmail").textContent = currentUser.email;
  authEl("accountName").value = currentProfile ? currentProfile.full_name : "";
  authEl("accountStatus").textContent = "";
  renderAccountPhoto();
  authEl("accountPhotoStatus").textContent = "Shown to your team instead of your initial.";
  accountOverlayEl.hidden = false;
  authEl("accountName").focus();
});

function closeAccountModal() { accountOverlayEl.hidden = true; }

/* ---- your profile picture (account settings) ---- */
function renderAccountPhoto() {
  var path = currentProfile && currentProfile.avatar_path;
  fillAvatar(authEl("accountAvatar"), currentProfile ? currentProfile.full_name : "", path);
  authEl("accountAvatar").classList.add("is-me");
  authEl("accountPhotoRemove").hidden = !path;
  authEl("accountPhotoBtn").textContent = path ? "Change picture" : "Upload picture";
}

// After your picture changes: header icons, account settings, and the team page.
function afterPhotoChange() {
  renderAccountPhoto();
  updateProfileButton();
  lastRoster.forEach(function (m) { if (currentUser && m.user_id === currentUser.id) m.avatar_path = currentProfile.avatar_path; });
  if (!teamViewEl.hidden && currentTeam) { renderRosterLists(); loadTopPrs(); }
}

authEl("accountPhotoBtn").addEventListener("click", function () { authEl("accountPhotoInput").click(); });
authEl("accountPhotoInput").addEventListener("change", function () {
  var file = this.files[0];
  this.value = "";
  if (!file || !currentUser) return;
  var userId = currentUser.id, old = currentProfile && currentProfile.avatar_path;
  authEl("accountPhotoStatus").textContent = "Uploading\u2026";
  uploadPicture("pictures", "profiles/" + userId, file, 256).then(function (path) {
    return sb.from("profiles").update({ avatar_path: path }).eq("id", userId).select("avatar_path").single().then(function (res) {
      if (res.error) { removePicture("pictures", path); throw res.error; }
      currentProfile = Object.assign({}, currentProfile, { avatar_path: res.data.avatar_path });
      removePicture("pictures", old);
      authEl("accountPhotoStatus").textContent = "Saved.";
      afterPhotoChange();
    });
  }).catch(function (err) { authEl("accountPhotoStatus").textContent = "Couldn't upload: " + err.message; });
});
authEl("accountPhotoRemove").addEventListener("click", function () {
  var old = currentProfile && currentProfile.avatar_path;
  sb.from("profiles").update({ avatar_path: null }).eq("id", currentUser.id).then(function (res) {
    if (res.error) { authEl("accountPhotoStatus").textContent = "Couldn't remove: " + res.error.message; return; }
    currentProfile = Object.assign({}, currentProfile, { avatar_path: null });
    removePicture("pictures", old);
    authEl("accountPhotoStatus").textContent = "Removed.";
    afterPhotoChange();
  });
});
authEl("accountModalClose").addEventListener("click", closeAccountModal);
var accountPressedOnBackdrop = false;
accountOverlayEl.addEventListener("mousedown", function (e) { accountPressedOnBackdrop = e.target === accountOverlayEl; });
accountOverlayEl.addEventListener("click", function (e) { if (e.target === accountOverlayEl && accountPressedOnBackdrop) closeAccountModal(); });
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !accountOverlayEl.hidden) closeAccountModal();
});

authEl("accountForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var name = authEl("accountName").value.trim();
  if (!name) { authEl("accountStatus").textContent = "Your name can't be empty."; return; }
  authEl("accountSave").disabled = true;
  authEl("accountStatus").textContent = "Saving…";
  sb.from("profiles").update({ full_name: name }).eq("id", currentUser.id).select("full_name").single().then(function (res) {
    authEl("accountSave").disabled = false;
    if (res.error) { authEl("accountStatus").textContent = "Couldn't save: " + res.error.message; return; }
    currentProfile = Object.assign({}, currentProfile, res.data);
    updateProfileButton();
    authEl("accountStatus").textContent = "Saved.";
    if (!teamViewEl.hidden) renderTeamPage();
  });
});

authEl("accountLogout").addEventListener("click", function () {
  closeAccountModal();
  signOut();
});

/* ---------------- called by auth.js when login or team changes ---------------- */
function onAccountChanged() {
  updateProfileButton();
  refreshJoinRequestCount();
  refreshInbox();
  loadMySets();
  loadTeamPlans();
  resetTraining();
  if (!teamViewEl.hidden) renderTeamPage();
}
updateProfileButton();
setInviteCount(0);
