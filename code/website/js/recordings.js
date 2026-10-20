/* recordings.js — uploads a recorded set and fetches its analysis.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order.

   Same steps as store_session() in python/main.py: the raw samples go to the
   raw-sessions Storage bucket as <user id>/<session id>.json, then a sessions
   row points at them. The processing on Azure (python/function_app.py, started
   by a Supabase webhook) picks the row up, writes its reps and sets
   analyzed_at, or analysis_error if the set couldn't be analyzed. See
   docs/database.md and docs/azure-processing.md. */
"use strict";

// The plan reader's lift keys -> sessions.exercise, which picks the analysis code.
var LIFT_EXERCISE = { squat: "back_squat", bench: "bench_press", deadlift: "deadlift" };
var PENDING_KEY = "vlo.pendingRecording.v1";

// Wakes the processing on Azure while the athlete gets ready, so the first
// set's result doesn't wait for a cold start. Called when real sensors
// connect and on Record. Fire and forget: no key (it only wakes the app and
// touches no data), no answer needed, never more than once in a few minutes.
var WARM_UP_URL = "https://vloprocessingkth-gsgmc6h6b5dghsck.germanywestcentral-01.azurewebsites.net/api/warm-up";
var WARM_UP_EVERY_MS = 3 * 60 * 1000;
var lastWarmUp = 0;
function warmUpProcessing() {
  if (sensorsSimulated() || Date.now() - lastWarmUp < WARM_UP_EVERY_MS) return;
  lastWarmUp = Date.now();
  try {
    fetch(WARM_UP_URL, { method: "POST", mode: "no-cors", keepalive: true }).catch(function () {});
  } catch (e) { /* offline or blocked: the set is still processed, just after a cold start */ }
}
document.addEventListener("vlo:sensors", function () { if (sensorsReady()) warmUpProcessing(); });

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// rec: what Recorder.stop() returned. details: { exercise, weightKg, reps, targetZone }
// (targetZone: the code group of the coach's zone, fast / medium / slow
// (zoneGroup() in core.js), or null. It's the analysis's Squats2 TYPE.)
// Resolves to the new session id.
function uploadRecording(rec, details) {
  var sessionId = newId();
  var path = currentUser.id + "/" + sessionId + ".json";
  var body = new Blob([JSON.stringify(rec.rows)], { type: "application/json" });
  return sb.storage.from("raw-sessions").upload(path, body, { contentType: "application/json", upsert: false })
    .then(function (res) {
      if (res.error) throw new Error("upload failed: " + res.error.message);
      return sb.from("sessions").insert({
        id: sessionId,
        user_id: currentUser.id,
        exercise: details.exercise,
        weight_kg: details.weightKg,
        reported_rep_count: details.reps,
        target_zone: details.targetZone || null,
        recorded_at: new Date(rec.startedAt).toISOString(),
        raw_data_path: path
      });
    })
    .then(function (res) {
      if (res.error) {
        sb.storage.from("raw-sessions").remove([path]); // don't leave an orphaned file
        throw new Error("saving the set failed: " + res.error.message);
      }
      clearPendingRecording();
      return sessionId;
    })
    .catch(function (err) {
      // Keep the samples in this browser so the set isn't lost; uploadPending() retries.
      try { localStorage.setItem(PENDING_KEY, JSON.stringify({ rec: rec, details: details })); } catch (e) { /* too big or blocked */ }
      throw err;
    });
}

function pendingRecording() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch (e) { return null; }
}
function clearPendingRecording() {
  try { localStorage.removeItem(PENDING_KEY); } catch (e) { /* nothing stored */ }
}

// Analysis state of some recordings: { id: { analyzed_at, analysis_error, reps: [...] } }.
function fetchRecordings(ids) {
  if (!ids.length) return Promise.resolve({});
  return sb.from("sessions")
    .select("id, exercise, weight_kg, recorded_at, analyzed_at, analysis_error, reps(rep_index, left_mean_velocity, right_mean_velocity, left_peak_velocity, right_peak_velocity)")
    .in("id", ids)
    .then(function (res) {
      var out = {};
      (res.data || []).forEach(function (s) { out[s.id] = s; });
      return out;
    });
}

// One line about an analyzed set, for the set row.
function recordingSummary(s) {
  if (!s) return { state: "pending", text: "Waiting for the recording…" };
  // The watcher marks lifts nobody has written analysis for yet; they stay waiting.
  if (s.analysis_error && s.analysis_error.indexOf("No analysis for ") === 0) {
    return { state: "pending", text: "Saved. Analysis for this lift isn't ready yet; it runs automatically once it is." };
  }
  if (s.analysis_error) return { state: "error", text: "Couldn't analyze this set: " + s.analysis_error };
  if (!s.analyzed_at) return { state: "pending", text: "Processing the recording…" };
  var speeds = (s.reps || []).slice().sort(function (a, b) { return a.rep_index - b.rep_index; })
    .map(repMeanSpeed).filter(function (v) { return v !== null; });
  if (!speeds.length) return { state: "done", text: "Analyzed: no reps found in this recording." };
  var mean = speeds.reduce(function (a, b) { return a + b; }, 0) / speeds.length;
  var best = Math.max.apply(null, speeds);
  var loss = speeds.length > 1 && speeds[0] > 0 ? Math.round((speeds[0] - speeds[speeds.length - 1]) / speeds[0] * 100) : 0;
  return {
    state: "done",
    text: speeds.length + " rep" + (speeds.length === 1 ? "" : "s") + " · mean " + mean.toFixed(2) +
      " m/s · fastest " + best.toFixed(2) + " m/s · velocity loss " + loss + "%"
  };
}
