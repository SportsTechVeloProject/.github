-- Analysis status on recordings, for the processing watcher (python/main.py --watch).
-- Run once in the Supabase SQL editor.
--
--   analyzed_at     set when the watcher (or main.py) has written the recording's reps
--   analysis_error  set instead when the recording couldn't be analyzed, with the reason
--
-- The website shows "Processing…" while both are empty, then the result or the error.
-- The watcher only picks up recordings where both are empty.

alter table public.sessions
  add column if not exists analyzed_at timestamptz,
  add column if not exists analysis_error text;

-- Recordings made before this existed were already analyzed (or never will be):
-- mark them done so the watcher doesn't pick up old test data.
update public.sessions
set analyzed_at = coalesce(created_at, now())
where analyzed_at is null and analysis_error is null;

-- The watcher asks for "not analyzed yet" every couple of seconds.
create index if not exists sessions_waiting_for_analysis
  on public.sessions (recorded_at)
  where analyzed_at is null and analysis_error is null;
