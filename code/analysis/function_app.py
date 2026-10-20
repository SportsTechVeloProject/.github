"""function_app.py — processing on Azure Functions, so nobody has to run main.py --watch.

Same analysis as main.py (process_waiting), started by the database instead of
a laptop. Setup and deployment: docs/azure-processing.md.

  new_session     HTTP. Supabase calls it (a Database Webhook) when a row is
                  inserted into sessions. Puts the session id on a queue and
                  answers at once: the webhook gives up after a few seconds,
                  the analysis can take longer.
  warm_up         HTTP, no key. The website calls it when real sensors connect
                  (and on Record), so the analysis is awake by the time the set
                  ends. Puts "warm-up" on the queue: on Flex Consumption the
                  queue function runs on its own instances, so waking this HTTP
                  function alone wouldn't help. Touches no data.
  process_session Queue. Analyzes one recording and saves its reps. Temporary
                  errors (network, Supabase busy) are raised, so the queue
                  tries again (up to 5 times, see host.json). A "warm-up"
                  message only loads the analysis code.
  sweep           Timer, daily at 03:00 UTC. Anything still waiting after 5
                  minutes: recordings older than the database's retry window
                  (a day; supabase/migrations/2026-10-14-resend-waiting-sessions.sql
                  retries every minute before that), and lifts whose analysis
                  has been added since. Daily: every run wakes the app and
                  loads scipy, which counts against the free grant.

App settings (Azure portal → the function app → Environment variables):
  SUPABASE_SERVICE_KEY   the service_role key. Secret: only here, never in the repo.
"""

import datetime
import logging
import os
import re
import time
import urllib.parse

# Matplotlib is imported by the analysis (for plots, unused here): no screen on
# Azure, and only /tmp is writable.
os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

import azure.functions as func

# main.py (and through it numpy, scipy, pandas and the data team's code) is
# imported inside the functions that analyze, not here: loading it takes
# several seconds on a cold start, and the webhook gives up after 5 s waiting
# for new_session, which only needs to queue an id.

QUEUE = "sessions-to-process"
SWEEP_AFTER_MINUTES = 5  # younger recordings are left to the webhook

WARM_UP = "warm-up"
WARM_UP_EVERY_S = 60  # per instance: a burst of calls queues one warm-up, not many
last_warm_up = 0.0

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

app = func.FunctionApp()


def analysis():
    """main.py, ready to use with the service key. Imported on first use."""
    import main
    import supabase_api as db
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_KEY isn't set: add it under the function app's Environment variables.")
    db.use_service_key(key)
    return main, db


@app.route(route="new-session", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
@app.queue_output(arg_name="queue", queue_name=QUEUE, connection="AzureWebJobsStorage")
def new_session(req: func.HttpRequest, queue: func.Out[str]) -> func.HttpResponse:
    # Supabase webhook body: {"type": "INSERT", "table": "sessions", "record": {...}, ...}.
    # {"id": "<session id>"} also works, for queueing a recording by hand.
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse("Expected a JSON body.", status_code=400)
    record = body.get("record") or {}
    if body.get("type", "INSERT") != "INSERT" or body.get("table", "sessions") != "sessions":
        return func.HttpResponse("Ignored: not a new session.", status_code=200)
    session_id = str(record.get("id") or body.get("id") or "")
    if not UUID.match(session_id):
        return func.HttpResponse("No session id in the request.", status_code=400)
    if record and (record.get("analyzed_at") or record.get("analysis_error") or not record.get("raw_data_path")):
        return func.HttpResponse("Ignored: already analyzed, or no raw file.", status_code=200)
    queue.set(session_id)
    logging.info("Queued session %s", session_id)
    return func.HttpResponse("Queued " + session_id, status_code=202)


@app.route(route="warm-up", methods=["POST", "GET"], auth_level=func.AuthLevel.ANONYMOUS)
@app.queue_output(arg_name="queue", queue_name=QUEUE, connection="AzureWebJobsStorage")
def warm_up(req: func.HttpRequest, queue: func.Out[str]) -> func.HttpResponse:
    global last_warm_up
    now = time.time()
    if now - last_warm_up < WARM_UP_EVERY_S:
        return func.HttpResponse("Already warming up.", status_code=200)
    last_warm_up = now
    queue.set(WARM_UP)
    logging.info("Warm-up queued")
    return func.HttpResponse("Warming up.", status_code=202)


@app.queue_trigger(arg_name="msg", queue_name=QUEUE, connection="AzureWebJobsStorage")
def process_session(msg: func.QueueMessage) -> None:
    session_id = msg.get_body().decode().strip()
    if session_id == WARM_UP:
        started = time.time()
        analysis()  # loads numpy, scipy, pandas, imufusion and the data team's code
        logging.info("Warm-up: analysis loaded in %.1f s", time.time() - started)
        return
    main, db = analysis()
    found = db.select(None, "sessions", main.WAITING_FIELDS + "&id=eq." + session_id + main.WAITING_FILTER)
    if not found:
        logging.info("Session %s: nothing to do (already analyzed, or not found).", session_id)
        return
    main.process_waiting(found[0], raise_transient=True)


@app.timer_trigger(arg_name="timer", schedule="0 0 3 * * *", run_on_startup=False)
def sweep(timer: func.TimerRequest) -> None:
    main, db = analysis()
    main.retry_new_analyses()
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=SWEEP_AFTER_MINUTES)
    waiting = db.select(None, "sessions", main.WAITING + "&created_at=lt." + urllib.parse.quote(cutoff.isoformat()))
    if waiting:
        logging.info("Sweep: %d recording(s) still waiting.", len(waiting))
    for session in waiting:
        main.process_waiting(session)
