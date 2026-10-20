"""main.py — one recorded set, from "Stop pressed" to reps in the database.

Runs on a laptop, no website involved. Each step is its own function, so you
can put a breakpoint anywhere (VS Code: Run and Debug, with the arguments
below) and look at the data between steps.

  1. load_recording   CSV (from MoveSenseCode) or JSON -> list of samples
  2. store_session    "Stop pressed": upload the JSON to Storage, create the
                      sessions row -> session_id
  3. process_session  session_id -> download the raw JSON, pick the code for
                      the exercise (back_squat -> squats.py), calculate reps
  4. save_reps        write one reps row per rep, linked by session_id
  5. print_summary    what the website will show

Usage (needs numpy, scipy, pandas, matplotlib, imufusion):
  python main.py recording.csv --weight 100 --reps 11      # the whole chain
  python main.py recording.csv --dry-run                   # steps 1 and 3 only, nothing stored
  python main.py recording.csv --reps 6 --store-only       # step 2 only: upload like the website; Azure analyzes it
  python main.py --session <id>                            # steps 3-5 for an existing session
  python main.py --session <id> --replace                  # same, replacing its reps
  add --plot to any of them to see the data team's plots

  python main.py --watch                                   # the processing watcher, see below

The watcher (--watch) is how sets recorded in the website get analyzed: every
couple of seconds it looks for recordings that haven't been analyzed yet
(sessions.analyzed_at and analysis_error both empty), runs the code for their
exercise, saves the reps and sets analyzed_at, or analysis_error if it fails.
It processes everyone's recordings, so it uses the project's service key
instead of a login: set SUPABASE_SERVICE_KEY first (Supabase dashboard →
Project Settings → API → service_role). Keep that key secret.

Login: you're asked for the athlete's V-Lo email and password (or set
VLO_EMAIL / VLO_PASSWORD). The set is saved under that athlete; their coach
sees it on the team page.
"""

import argparse
import csv
import datetime
import getpass
import json
import logging
import math
import os
import sys
import time
import traceback
import urllib.parse
import uuid

import supabase_api as db
import squats

# sessions.exercise -> the code that processes it. The keys are the exercise
# bank's (js/exercises.js): every exercise there with sensor "squat" uses the
# squat analysis, and so on. Keep these lists in step with the bank.
SQUAT_FAMILY = ["back_squat", "high_bar_squat", "low_bar_squat", "pause_squat", "tempo_squat",
                "box_squat", "pin_squat", "front_squat", "safety_bar_squat"]
BENCH_FAMILY = ["bench_press", "pause_bench", "close_grip_bench", "wide_grip_bench", "tempo_bench",
                "spoto_press", "larsen_press", "board_press", "pin_press", "floor_press"]
DEADLIFT_FAMILY = ["deadlift", "sumo_deadlift", "pause_deadlift", "deficit_deadlift", "block_pull"]

EXERCISES = {key: squats.analyze for key in SQUAT_FAMILY}
# EXERCISES.update({key: benchpress.analyze for key in BENCH_FAMILY})    # when the data team adds it
# EXERCISES.update({key: deadlift.analyze for key in DEADLIFT_FAMILY})

SAMPLE_FIELDS = ("sensor", "t", "recvAt", "x", "y", "z", "gx", "gy", "gz")


# ============================================================
# 1. Load the recording
# ============================================================

def load_recording(path):
    """CSV or JSON file -> [{sensor, t, recvAt, x, y, z, gx, gy, gz}, ...].
    Missing values ("undefined", empty) become None."""
    with open(path, encoding="utf-8") as f:
        if path.lower().endswith(".json"):
            rows = json.load(f)
        else:
            rows = list(csv.DictReader(f))

    samples = []
    for row in rows:
        sample = {"sensor": row.get("sensor")}
        for key in SAMPLE_FIELDS[1:]:
            sample[key] = to_number(row.get(key))
        samples.append(sample)
    print("1. Loaded %d samples from %s" % (len(samples), os.path.basename(path)))
    return samples


def to_number(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# ============================================================
# 2. Store it ("Stop pressed")
# ============================================================

def store_session(token, user_id, samples, exercise, weight_kg=None, reps=None, zone=None):
    """Uploads the raw JSON to Storage and creates the sessions row. Returns session_id."""
    session_id = str(uuid.uuid4())
    raw_path = "%s/%s.json" % (user_id, session_id)

    db.upload_raw(token, raw_path, samples)
    try:
        db.insert(token, "sessions", [{
            "id": session_id,
            "user_id": user_id,
            "exercise": exercise,
            "weight_kg": weight_kg,
            "reported_rep_count": reps,
            "recorded_at": recorded_at(samples),
            "raw_data_path": raw_path,
            "target_zone": zone,
        }])
    except db.SupabaseError:
        db.delete_raw(token, raw_path)  # don't leave an orphaned file behind
        raise
    print("2. Stored session %s (raw file %s/%s)" % (session_id, db.RAW_BUCKET, raw_path))
    return session_id


def recorded_at(samples):
    """When the set started: the first sample's receive time, else now."""
    stamps = [s["recvAt"] for s in samples if s.get("recvAt")]
    when = (datetime.datetime.fromtimestamp(min(stamps) / 1000, datetime.timezone.utc)
            if stamps else datetime.datetime.now(datetime.timezone.utc))
    return when.isoformat()


# ============================================================
# 3. Process it
# ============================================================

def process_session(token, session_id, plot=False):
    """Downloads the session's raw JSON and runs the code for its exercise."""
    found = db.select(token, "sessions",
                      "select=id,exercise,reported_rep_count,raw_data_path,target_zone&id=eq." + session_id)
    if not found:
        raise SystemExit("No session %s, or this account can't see it." % session_id)
    session = found[0]
    samples = db.download_raw(token, session["raw_data_path"])
    print("3. Downloaded %d samples for session %s (%s) from %s/%s" % (
        len(samples), session_id, session["exercise"], db.RAW_BUCKET, session["raw_data_path"]))
    print("   Target zone: %s" % (session.get("target_zone") or "none"))
    return analyze(samples, session["exercise"], session["reported_rep_count"], plot, session.get("target_zone"))


NO_ANALYSIS_YET = "No analysis for "  # marker in sessions.analysis_error; see watch()


class NoAnalysisYet(Exception):
    """The lift can be recorded but nobody has written its analysis yet."""


def analyze(samples, exercise, reps=None, plot=False, zone=None):
    if exercise not in EXERCISES:
        raise NoAnalysisYet("%s%s yet (have: %s)." % (NO_ANALYSIS_YET, exercise, ", ".join(sorted(EXERCISES))))
    results = EXERCISES[exercise](samples, reps=reps, zone=zone, plot=plot)
    print("   Processed with %s: %d reps" % (results["version"], len(results["reps"])))
    return results


# ============================================================
# 4. Save the reps
# ============================================================

def save_reps(token, session_id, results, replace=False):
    existing = db.select(token, "reps", "select=id&session_id=eq." + session_id)
    if existing and not replace:
        raise SystemExit("Session %s already has %d reps. Use --replace to redo them."
                         % (session_id, len(existing)))
    if existing:
        db.delete(token, "reps", "session_id=eq." + session_id)

    rows = []
    for r in results["reps"]:
        row = dict(r, session_id=session_id)
        row["metrics"] = dict(r.get("metrics", {}), version=results["version"])
        rows.append(row)
    if rows:
        db.insert(token, "reps", rows)
    print("4. Saved %d reps%s" % (len(rows), " (replaced %d)" % len(existing) if existing else ""))


def mark_analyzed(token, session_id, error=None, quiet=False):
    """Records that the session has been analyzed (or why it couldn't be), so
    the website stops showing "Processing…" and the watcher skips it."""
    try:
        db.update(token, "sessions", "id=eq." + session_id, {
            "analyzed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "analysis_error": error,
        })
    except db.SupabaseError as err:
        # Before supabase/migrations/2026-10-12-sessions-analysis-status.sql is run
        # the columns don't exist; with a normal login, updating may not be allowed.
        if not quiet:
            raise
        print("   (couldn't mark the session as analyzed: %s)" % str(err)[:120])


# ============================================================
# 5. Summary
# ============================================================

def print_summary(results, session_id=None):
    print()
    if session_id:
        print("Session", session_id)
    print("rep   left mean  left peak   right mean  right peak   (m/s)")
    for r in results["reps"]:
        print("%3d   %9s  %9s   %10s  %10s" % (
            r["rep_index"],
            fmt(r.get("left_mean_velocity")), fmt(r.get("left_peak_velocity")),
            fmt(r.get("right_mean_velocity")), fmt(r.get("right_peak_velocity"))))
    for w in results["warnings"]:
        print("warning:", w)


def fmt(v):
    return "%.2f" % v if isinstance(v, float) else "-"


# ============================================================
# 6. The processing watcher
# ============================================================

# Recordings waiting to be analyzed (also used by function_app.py on Azure).
WAITING_FIELDS = "select=id,user_id,exercise,reported_rep_count,raw_data_path,recorded_at,target_zone"
WAITING_FILTER = "&analyzed_at=is.null&analysis_error=is.null&raw_data_path=not.is.null"
WAITING = WAITING_FIELDS + WAITING_FILTER + "&order=recorded_at.asc&limit=10"


def watch(interval):
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key:
        sys.exit("Set SUPABASE_SERVICE_KEY first (Supabase dashboard → Project Settings → API → "
                 "service_role key). It lets the watcher process every athlete's recordings; keep it secret.")
    db.use_service_key(key)
    retry_new_analyses()
    print("Watching for new recordings every %g s. Press Ctrl+C to stop." % interval)
    try:
        while True:
            try:
                waiting = db.select(None, "sessions", WAITING)
            except (db.SupabaseError, OSError) as err:
                print("Couldn't check for recordings (%s); trying again." % str(err)[:160])
                waiting = []
            for session in waiting:
                process_waiting(session)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nStopped watching.")


def process_waiting(session, raise_transient=False):
    """Analyzes one recording from the website and saves its reps.

    A temporary error (network, Supabase busy) leaves the recording waiting so
    it's tried again; with raise_transient it's raised too, so Azure's queue
    retries it (function_app.py). Any other error is saved as analysis_error."""
    started = time.time()
    sid = session["id"]
    label = "%s %s" % (sid[:8], session["exercise"])
    try:
        samples = db.download_raw(None, session["raw_data_path"])
        results = analyze(samples, session["exercise"], session["reported_rep_count"], zone=session.get("target_zone"))
        save_reps(None, sid, results, replace=True)
        mark_analyzed(None, sid)
        took = time.time() - started
        since = seconds_since(session.get("recorded_at"))
        print("OK      %s: %d reps in %.1f s%s, target zone: %s" % (
            label, len(results["reps"]), took, "" if since is None else " (%.0f s after the set started)" % since,
            session.get("target_zone") or "none"))
    except NoAnalysisYet as err:
        # Not a failure: keep it waiting (analyzed_at stays empty) so it's
        # processed once the analysis exists; see retry_new_analyses().
        try:
            db.update(None, "sessions", "id=eq." + sid, {"analysis_error": str(err)[:500]})
        except (db.SupabaseError, OSError):
            pass
        print("WAITING %s: %s" % (label, err))
    except Exception as err:
        if not db.is_transient(err):
            fail(sid, label, err)
            return
        print("RETRY   %s: %s" % (label, str(err)[:300]))
        if raise_transient:
            raise
    except SystemExit as err:
        fail(sid, label, err)


def fail(sid, label, err):
    """Saves why a recording couldn't be analyzed; the website shows it.
    Adds where in the code it failed; the full traceback goes to the log
    (Azure: Log stream / Application Insights)."""
    reason = (str(err) or err.__class__.__name__).strip()
    where = failed_at(err)
    if where:
        reason += " [at " + where + "]"
    try:
        mark_analyzed(None, sid, error=reason[:1000])
    except (db.SupabaseError, OSError):
        pass
    print("FAILED  %s: %s" % (label, reason))
    logging.error("FAILED %s", label, exc_info=(type(err), err, err.__traceback__))


def failed_at(err):
    """'VelocityCalculations.py:34 find_drift': where the error started (the
    original error if it was re-raised with a clearer message)."""
    cause = err.__cause__ or err
    frames = traceback.extract_tb(cause.__traceback__) if cause.__traceback__ else []
    if not frames:
        return ""
    # Prefer the deepest frame in the data team's files (python/squat/).
    theirs = [f for f in frames if os.path.basename(os.path.dirname(f.filename)) == "squat"]
    f = (theirs or frames)[-1]
    return "%s:%d %s" % (os.path.basename(f.filename), f.lineno, f.name)


def retry_new_analyses():
    """Recordings of lifts that had no analysis yet: if one exists now, clear
    their marker so the watcher processes them like new recordings."""
    keys = ",".join(sorted(EXERCISES))
    try:
        db.update(None, "sessions",
                  "exercise=in.(%s)&analyzed_at=is.null&analysis_error=like.%s*" % (keys, urllib.parse.quote(NO_ANALYSIS_YET)),
                  {"analysis_error": None})
    except (db.SupabaseError, OSError) as err:
        print("Couldn't re-queue older recordings (%s)." % str(err)[:160])


def seconds_since(iso):
    try:
        when = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.datetime.now(datetime.timezone.utc) - when).total_seconds()
    except (AttributeError, ValueError):
        return None


# ============================================================
# Main
# ============================================================

def save_raw(token, session_id):
    """--session <id> --save-raw: the recording's raw samples and its row, saved
    next to the repo in .tmp-fixtures/ (git-ignored). Nothing is analyzed or changed."""
    found = db.select(token, "sessions", "select=*&id=eq." + session_id)
    if not found:
        raise SystemExit("No session %s, or this account can't see it." % session_id)
    samples = db.download_raw(token, found[0]["raw_data_path"])
    folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".tmp-fixtures")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, session_id + ".json")
    with open(path, "w") as f:
        json.dump(samples, f)
    with open(os.path.join(folder, session_id + ".row.json"), "w", encoding="utf-8") as f:
        json.dump(found[0], f, indent=2, ensure_ascii=False, default=str)
    print("Saved %d samples to %s" % (len(samples), os.path.normpath(path)))
    print("(and its sessions row next to it, as %s.row.json)" % session_id)


def log_in():
    email = os.environ.get("VLO_EMAIL") or input("V-Lo email: ")
    password = os.environ.get("VLO_PASSWORD") or getpass.getpass("Password: ")
    return db.log_in(email, password)


def main():
    parser = argparse.ArgumentParser(description="Store a recorded set, process it, and save its reps.")
    parser.add_argument("recording", nargs="?", help="CSV or JSON recording (not needed with --session)")
    parser.add_argument("--exercise", default="back_squat", help="sessions.exercise (default: back_squat)")
    parser.add_argument("--weight", type=float, help="weight in kg")
    parser.add_argument("--reps", type=int, help="the rep count the lifter reports")
    parser.add_argument("--session", help="process an existing session instead of storing a new one")
    parser.add_argument("--replace", action="store_true", help="replace reps that already exist")
    parser.add_argument("--dry-run", action="store_true", help="load and process only; nothing stored")
    parser.add_argument("--store-only", action="store_true",
                        help="upload the recording like the website does and stop; the processing on Azure analyzes it")
    parser.add_argument("--save-raw", action="store_true",
                        help="with --session: download the recording's raw file into .tmp-fixtures/ and stop "
                             "(nothing analyzed or changed), e.g. to run the data team's own script on it")
    parser.add_argument("--plot", action="store_true", help="show the data team's plots")
    parser.add_argument("--zone", help="target zone for a local file: fast, medium or slow (Squats2 TYPE; default: none)")
    parser.add_argument("--watch", action="store_true", help="keep processing new recordings from the website")
    parser.add_argument("--interval", type=float, default=2.0, help="with --watch: seconds between checks (default 2)")
    args = parser.parse_args()

    if args.watch:
        watch(args.interval)
        return
    if not args.recording and not args.session:
        parser.error("give a recording file, --session <id>, or --watch")

    if args.dry_run:
        samples = load_recording(args.recording)
        print_summary(analyze(samples, args.exercise, args.reps, args.plot, args.zone))
        print("\nDry run: nothing was stored.")
        return

    try:
        token, user_id = log_in()
        session_id = args.session
        if not session_id:
            samples = load_recording(args.recording)
            session_id = store_session(token, user_id, samples, args.exercise, args.weight, args.reps, args.zone)
            if args.store_only:
                print("\nStored only: Azure analyzes it now (Supabase webhook). Watch it with:\n"
                      "  select analyzed_at, analysis_error from sessions where id = '%s';" % session_id)
                return
        if args.save_raw:
            save_raw(token, session_id)
            return
        results = process_session(token, session_id, args.plot)
        save_reps(token, session_id, results, args.replace)
        mark_analyzed(token, session_id, quiet=True)
        print_summary(results, session_id)
    except db.SupabaseError as err:
        sys.exit("Supabase error: %s" % err)


if __name__ == "__main__":
    try:
        main()
    except NoAnalysisYet as err:
        sys.exit(str(err))
