"""supabase_api.py — the few Supabase calls main.py needs, over plain HTTP.

No extra packages: just Python's urllib. Normally every call runs as the
logged-in user, so Row Level Security decides what is allowed, exactly as in
the app. The processing watcher (main.py --watch) instead uses the project's
service key, which bypasses Row Level Security so it can process every
athlete's recordings. That key is a secret: keep it in an environment
variable on the machine running the watcher, never in the repo or the website.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://amxrrodzdvizndchfeqy.supabase.co")
# Public anon key (the same one the website ships); access is limited by Row Level Security.
SUPABASE_ANON_KEY = os.environ.get(
    "SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFteHJyb2R6ZHZpem5kY2hmZXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzY2MjgsImV4cCI6MjEwNTExMjYyOH0.DK_3jMp83K1DQKW6NVaSK77UNYBtXwfamjkZ3svewO4",
)
RAW_BUCKET = "raw-sessions"
_api_key = SUPABASE_ANON_KEY


def use_service_key(key):
    """Every following call uses the service key (bypasses Row Level Security)."""
    global _api_key
    _api_key = key


TIMEOUT_S = 60  # no call should hang forever (on Azure it would block the function)


class SupabaseError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status  # HTTP status code


def is_transient(err):
    """True for errors worth trying again later: the network, or Supabase
    being busy or down (5xx, 429). False for real problems, like a missing file."""
    if isinstance(err, SupabaseError):
        return err.status is None or err.status >= 500 or err.status == 429
    return isinstance(err, OSError)


def _request(method, path, token=None, json_body=None, raw_body=None, headers=None):
    req = urllib.request.Request(SUPABASE_URL + path, method=method)
    req.add_header("apikey", _api_key)
    req.add_header("Authorization", "Bearer " + (token or _api_key))
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = raw_body
    if json_body is not None:
        data = json.dumps(json_body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=TIMEOUT_S) as res:
            text = res.read().decode()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as err:
        raise SupabaseError("%s %s failed (%s): %s" % (
            method, path.split("?")[0], err.code, err.read().decode()[:400]), err.code) from None


def log_in(email, password):
    """Returns (access_token, user_id)."""
    res = _request("POST", "/auth/v1/token?grant_type=password",
                   json_body={"email": email, "password": password})
    return res["access_token"], res["user"]["id"]


# ---------------- Storage: raw recordings ----------------

def upload_raw(token, path, samples):
    _request("POST", "/storage/v1/object/%s/%s" % (RAW_BUCKET, urllib.parse.quote(path)), token,
             raw_body=json.dumps(samples).encode(), headers={"Content-Type": "application/json"})


def download_raw(token, path):
    path = path.lstrip("/")
    if path.startswith(RAW_BUCKET + "/"):
        path = path[len(RAW_BUCKET) + 1:]
    return _request("GET", "/storage/v1/object/authenticated/%s/%s" % (RAW_BUCKET, urllib.parse.quote(path)), token)


def delete_raw(token, path):
    _request("DELETE", "/storage/v1/object/%s/%s" % (RAW_BUCKET, urllib.parse.quote(path)), token)


# ---------------- Tables ----------------

def insert(token, table, rows):
    return _request("POST", "/rest/v1/" + table, token, json_body=rows,
                    headers={"Prefer": "return=representation"})


def select(token, table, query):
    return _request("GET", "/rest/v1/%s?%s" % (table, query), token)


def delete(token, table, query):
    _request("DELETE", "/rest/v1/%s?%s" % (table, query), token)


def update(token, table, query, row):
    return _request("PATCH", "/rest/v1/%s?%s" % (table, query), token, json_body=row,
                    headers={"Prefer": "return=minimal"})
