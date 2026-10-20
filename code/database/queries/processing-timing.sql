-- How long recordings take from being saved to being analyzed.
-- Read-only: run it in the Supabase SQL editor whenever you want to check
-- (e.g. before and after a change to the processing on Azure).
--
-- seconds_to_result = from the sessions row being created (the upload has
-- finished) to analyzed_at (Azure saved the reps or the error). What the
-- athlete waits after pressing Stop is this plus the upload before it and up
-- to a second for the page to notice: roughly 2–4 s more.
-- A long time usually means Azure was asleep (cold start) or the webhook timed
-- out and the retry job sent the recording a minute later.

select
  s.id,
  s.created_at,
  s.exercise,
  s.target_zone,
  round(extract(epoch from s.analyzed_at - s.created_at)::numeric, 1) as seconds_to_result,
  s.analysis_error is null                                            as ok,
  left(s.analysis_error, 60)                                          as error
from public.sessions s
where s.analyzed_at is not null
order by s.created_at desc
limit 20;


-- Optional, for the newest recordings only: when Azure accepted each one.
-- Supabase keeps webhook replies (net._http_response) for a few hours only.
-- seconds_to_queue small = the webhook reached Azure right away;
-- a timeout or no row = the retry job sent it later.

select
  s.id,
  s.created_at,
  round(extract(epoch from r.created - s.created_at)::numeric, 1)   as seconds_to_queue,
  r.status_code,
  round(extract(epoch from s.analyzed_at - s.created_at)::numeric, 1) as seconds_to_result
from public.sessions s
left join net._http_response r on r.content like 'Queued ' || s.id::text || '%'
where s.created_at > now() - interval '6 hours'
order by s.created_at desc;
