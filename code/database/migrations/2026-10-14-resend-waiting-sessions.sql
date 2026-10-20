-- Retry handing recordings to the analysis on Azure until it has them.
-- Run once in the Supabase SQL editor, after replacing PASTE_FULL_URL_HERE
-- (below) with the new_session address including ?code=…
-- (Azure portal → vloProcessingKTH → Functions → new_session → Get function URL).
-- Never commit the real address: the code= part is a secret.
--
-- Why: the webhook on sessions (Insert) gets one try. When the function app is
-- asleep, waking it can take longer than the webhook waits (5 s), and that
-- recording would never be analyzed. This job runs every minute and sends
-- every recording that's older than a minute and still has neither a result
-- nor an error again. The first try woke Azure up, so the retry gets through.
-- Once analyzed (analyzed_at) or failed (analysis_error), a recording is never
-- sent again. Nothing waiting = nothing sent, so Azure isn't woken for nothing.
-- See docs/azure-processing.md.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.vlo_resend_waiting_sessions()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  waiting record;
  sent integer := 0;
begin
  for waiting in
    select id from public.sessions
    where analyzed_at is null
      and analysis_error is null
      and raw_data_path is not null
      and created_at < now() - interval '1 minute'   -- give the webhook its chance first
      and created_at > now() - interval '1 day'      -- don't retry forever (the hourly sweep on Azure takes over)
    order by created_at
    limit 20
  loop
    perform net.http_post(
      url := 'PASTE_FULL_URL_HERE',
      body := jsonb_build_object('id', waiting.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

-- Only the database itself (cron) runs this; the website's users can't.
revoke all on function public.vlo_resend_waiting_sessions() from public, anon, authenticated;

-- Every minute. Re-running this file replaces the job instead of adding a second one.
select cron.unschedule('vlo-resend-waiting-sessions')
where exists (select 1 from cron.job where jobname = 'vlo-resend-waiting-sessions');
select cron.schedule('vlo-resend-waiting-sessions', '* * * * *', 'select public.vlo_resend_waiting_sessions()');
