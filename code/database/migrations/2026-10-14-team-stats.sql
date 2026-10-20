-- Team stats for the team page: weekly volume and Top PRs.
-- Both are read-only. They run as "security definer" so they can add up the
-- whole team's sets, but each first checks that the caller is on the team,
-- and only returns totals (volume) or the top 3 per category (Top PRs).
-- An athlete's individual sets stay private to them and their coaches.
-- Run once in the Supabase SQL editor (applied 2026-10-14).

-- Kilos lifted (weight x reps) per week for the last p_weeks weeks, weeks
-- starting Monday in the caller's timezone. Counts sets ticked off in
-- Training (set_logs) and sensor recordings (sessions); a recording that
-- belongs to a ticked-off set is counted once, through the set.
create or replace function public.team_weekly_volume(p_team uuid, p_tz text default 'UTC', p_weeks int default 5)
returns table (week_start date, total_kg numeric, sets int, athletes int)
language sql
stable security definer
set search_path to ''
as $$
  with lifts as (
    select l.athlete_id as user_id,
           (l.done_at at time zone p_tz) as local_time,
           coalesce(l.weight_kg, 0) * coalesce(l.reps, 0) as kg
    from public.set_logs l
    join public.team_members m on m.user_id = l.athlete_id and m.team_id = p_team
    union all
    select s.user_id,
           (s.recorded_at at time zone p_tz),
           coalesce(s.weight_kg, 0) * coalesce(nullif((select count(*) from public.reps r where r.session_id = s.id), 0),
                                               s.reported_rep_count, 0)
    from public.sessions s
    join public.team_members m on m.user_id = s.user_id and m.team_id = p_team
    where not exists (select 1 from public.set_logs l where l.recording_id = s.id)
  )
  select date_trunc('week', local_time)::date,
         round(sum(kg), 1),
         count(*)::int,
         count(distinct user_id)::int
  from lifts
  where public.is_team_member(p_team)
    and local_time >= date_trunc('week', now() at time zone p_tz) - make_interval(weeks => p_weeks - 1)
  group by 1
  order by 1;
$$;

-- Top PRs: per exercise and speed zone, the 3 heaviest sensor-recorded sets,
-- one per person (their best). A set's speed is the average of its reps'
-- mean speeds (left/right averaged). p_zone_mins are the zones' lower speed
-- limits, fastest zone first (from SPEED_ZONES in js/core.js), so zone_idx 0
-- is the fastest zone. Ties on weight go to the faster set.
create or replace function public.team_top_lifts(p_team uuid, p_zone_mins numeric[], p_per_zone int default 3)
returns table (exercise text, zone_idx int, rank int, user_id uuid, full_name text,
               weight_kg numeric, mean_velocity numeric, recorded_at timestamptz)
language sql
stable security definer
set search_path to ''
as $$
  with set_speed as (
    select s.id, s.user_id, s.exercise, s.weight_kg, s.recorded_at,
           avg(coalesce((r.left_mean_velocity + r.right_mean_velocity) / 2,
                        r.left_mean_velocity, r.right_mean_velocity)) as v
    from public.sessions s
    join public.team_members m on m.user_id = s.user_id and m.team_id = p_team
    join public.reps r on r.session_id = s.id
    where s.weight_kg is not null and public.is_team_member(p_team)
    group by s.id
  ),
  zoned as (
    select ss.*, (select count(*) from unnest(p_zone_mins) b where b > ss.v)::int as zone_idx
    from set_speed ss
    where ss.v is not null
  ),
  best_per_person as (
    select distinct on (z.exercise, z.zone_idx, z.user_id) z.*
    from zoned z
    order by z.exercise, z.zone_idx, z.user_id, z.weight_kg desc, z.v desc, z.recorded_at
  ),
  ranked as (
    select b.*, row_number() over (partition by b.exercise, b.zone_idx
                                   order by b.weight_kg desc, b.v desc, b.recorded_at) as rk
    from best_per_person b
  )
  select r.exercise, r.zone_idx, r.rk::int, r.user_id, p.full_name, r.weight_kg, round(r.v, 3), r.recorded_at
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rk <= p_per_zone
  order by r.exercise, r.zone_idx, r.rk;
$$;

-- Only logged-in users may call them (the membership check does the rest).
revoke execute on function public.team_weekly_volume(uuid, text, int) from public, anon;
revoke execute on function public.team_top_lifts(uuid, numeric[], int) from public, anon;
grant execute on function public.team_weekly_volume(uuid, text, int) to authenticated;
grant execute on function public.team_top_lifts(uuid, numeric[], int) to authenticated;
