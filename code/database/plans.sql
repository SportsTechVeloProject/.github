-- V-Lo training plans and workouts: tables, helper functions, rules and row level security.
-- See docs/database.md for the full structure and why each link exists.
--
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run again: tables are only created if missing; functions, triggers
-- and policies are replaced.
--
-- Tables:
--   plans             a programme. Belongs to a team (a coach's plan) or to one
--                     person (their own plan).
--   plan_assignments  a plan given to one athlete: start date + training weekdays
--   workouts          one training day for one athlete, on a date. Created from an
--                     assignment (planned), or by the athlete on their own (free).
--   set_logs          one row per set the athlete finishes (weight, reps, Done),
--                     optionally linked to its sensor recording in `sessions`
--
-- Who can do what:
--   coaches/admins of a team: create, edit and assign that team's plans, move its
--                             planned workouts, and read the training data of
--                             athletes in their team
--   anyone, for themselves:   write and follow their own plans, log free workouts,
--                             mark workouts complete, log their own sets
--   nobody else:              sees anything


-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  -- Exactly one of these: a team's plan (any coach of the team can use it),
  -- or one person's own plan.
  team_id     uuid references public.teams(id) on delete cascade,
  owner_id    uuid references public.profiles(id) on delete cascade,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  name        text not null check (length(trim(name)) > 0),
  -- The plan reader's output: { meta, weeks: [{ label, days: [{ label, items: [...] }] }] }
  content     jsonb not null,
  -- What was imported, so the plan can be re-read or edited later.
  source_text text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint plan_has_one_owner check ((team_id is null) <> (owner_id is null))
);

create table if not exists public.plan_assignments (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  athlete_id  uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  -- Training weekdays, ISO numbering: 1 = Monday … 7 = Sunday. Other days are rest days.
  weekdays    smallint[] not null,
  assigned_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint weekdays_valid check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  )
);

create table if not exists public.workouts (
  id             uuid primary key default gen_random_uuid(),
  -- Whose training day this is. For a planned workout it's filled in from the
  -- assignment automatically (trigger below).
  athlete_id     uuid not null references public.profiles(id) on delete cascade,
  -- Planned workouts come from an assignment; free workouts (the athlete trained
  -- without a plan) have none.
  assignment_id  uuid references public.plan_assignments(id) on delete cascade,
  week_no        int check (week_no >= 1),  -- 1-based position in plans.content.weeks
  day_no         int check (day_no >= 1),   -- 1-based position in that week's days
  label          text,
  -- Planned: set from the start date and weekdays when the plan is assigned; a coach
  -- can move it. Skipped workouts are not shifted: a past date with no completed_at
  -- is a missed workout.
  scheduled_date date not null,
  started_at     timestamptz,  -- the athlete pressed Start (or logged the first set)
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint planned_has_position check (assignment_id is null or (week_no is not null and day_no is not null)),
  constraint position_complete check ((week_no is null) = (day_no is null)),
  unique (assignment_id, week_no, day_no)
);

create table if not exists public.set_logs (
  id            uuid primary key default gen_random_uuid(),
  workout_id    uuid not null references public.workouts(id) on delete cascade,
  athlete_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  -- Position of the exercise in the planned day's items; null for free workouts.
  item_index    int check (item_index >= 0),
  exercise      text not null,
  set_no        int not null check (set_no >= 1),
  weight_kg     numeric(6,2) check (weight_kg >= 0),
  reps          int check (reps >= 0),
  duration_s    int check (duration_s >= 0),           -- timed exercises: seconds instead of reps
  distance_m    numeric(9,1) check (distance_m >= 0),  -- conditioning: distance in metres
  done_at       timestamptz not null default now(),
  -- The sensor recording of this set, if Movesense was used (squat, bench, deadlift).
  -- Unique: one recording belongs to at most one set.
  recording_id  uuid unique references public.sessions(id) on delete set null
);
-- One row per set: the same exercise can appear twice in a day (e.g. heavy sets
-- and back-off sets), so the exercise's position in the day is part of the key.
-- Free workouts have no position (null), which counts as -1 here.
create unique index if not exists set_logs_one_per_set
  on public.set_logs (workout_id, coalesce(item_index, -1), exercise, set_no);

create index if not exists plans_team_idx on public.plans (team_id);
create index if not exists plans_owner_idx on public.plans (owner_id);
create index if not exists plan_assignments_plan_idx on public.plan_assignments (plan_id);
create index if not exists plan_assignments_athlete_idx on public.plan_assignments (athlete_id);
create index if not exists workouts_athlete_date_idx on public.workouts (athlete_id, scheduled_date);
create index if not exists workouts_assignment_idx on public.workouts (assignment_id);
create index if not exists set_logs_workout_idx on public.set_logs (workout_id);
create index if not exists set_logs_athlete_idx on public.set_logs (athlete_id);


-- ============================================================
-- Helper functions
-- ============================================================
-- Security definer so the policies below can look across tables without
-- triggering each other's row level security (which would recurse).

-- Is the logged-in user a coach or admin of this team?
create or replace function public.vlo_is_team_staff(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = p_team and user_id = auth.uid() and role in ('coach', 'admin')
  );
$$;

-- Is the logged-in user a coach or admin of any team this athlete is in?
-- (The same reach coaches have over recordings.)
create or replace function public.vlo_coaches_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members me
    join team_members athlete on athlete.team_id = me.team_id
    where me.user_id = auth.uid() and me.role in ('coach', 'admin') and athlete.user_id = p_athlete
  );
$$;

-- Can the logged-in user edit and assign this plan? Team plan: its coaches.
-- Personal plan: its owner.
create or replace function public.vlo_can_manage_plan(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from plans p
    where p.id = p_plan
      and ((p.team_id is not null and public.vlo_is_team_staff(p.team_id)) or p.owner_id = auth.uid())
  );
$$;

-- Can the logged-in user give this plan to this athlete? A team plan goes to
-- members of that team; a personal plan only to its owner.
create or replace function public.vlo_can_assign(p_plan uuid, p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from plans p
    where p.id = p_plan
      and (
        (p.team_id is not null and public.vlo_is_team_staff(p.team_id)
          and exists (select 1 from team_members m where m.team_id = p.team_id and m.user_id = p_athlete))
        or (p.owner_id = auth.uid() and p_athlete = auth.uid())
      )
  );
$$;

-- Is the logged-in user following this plan?
create or replace function public.vlo_is_assigned(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from plan_assignments where plan_id = p_plan and athlete_id = auth.uid());
$$;

-- Can the logged-in user manage this assignment (and its planned workouts)?
create or replace function public.vlo_can_manage_assignment(p_assignment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from plan_assignments a
    where a.id = p_assignment and public.vlo_can_manage_plan(a.plan_id)
  );
$$;

create or replace function public.vlo_workout_athlete(p_workout uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select athlete_id from workouts where id = p_workout;
$$;


-- ============================================================
-- Rules the app also checks, enforced here too
-- ============================================================

-- A plan can't have more training days in a week than the athlete has training weekdays.
create or replace function public.vlo_check_assignment_fits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  most_days int;
begin
  select coalesce(max(jsonb_array_length(w -> 'days')), 0) into most_days
  from plans p, jsonb_array_elements(p.content -> 'weeks') w
  where p.id = new.plan_id;
  if most_days > cardinality(new.weekdays) then
    raise exception 'This plan has % training days in a week but only % training weekdays were chosen',
      most_days, cardinality(new.weekdays);
  end if;
  return new;
end;
$$;

drop trigger if exists plan_assignments_fit on public.plan_assignments;
create trigger plan_assignments_fit before insert or update on public.plan_assignments
  for each row execute function public.vlo_check_assignment_fits();

-- Workouts:
--  * a planned workout always belongs to its assignment's athlete;
--  * only whoever manages the plan may move, relabel or reassign a planned workout
--    (the athlete may still mark it complete);
--  * nobody may hand a workout to someone else.
create or replace function public.vlo_guard_workout()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignment_id is not null then
    select athlete_id into new.athlete_id from plan_assignments where id = new.assignment_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.athlete_id is distinct from old.athlete_id
       or new.assignment_id is distinct from old.assignment_id then
      raise exception 'A workout can''t be moved to another athlete or plan';
    end if;
    if old.assignment_id is not null
       and not public.vlo_can_manage_assignment(old.assignment_id)
       and (new.scheduled_date is distinct from old.scheduled_date
            or new.week_no is distinct from old.week_no
            or new.day_no is distinct from old.day_no
            or new.label is distinct from old.label) then
      raise exception 'Only the coach can move or change a planned workout';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_guard on public.workouts;
create trigger workouts_guard before insert or update on public.workouts
  for each row execute function public.vlo_guard_workout();


-- ============================================================
-- Row level security
-- ============================================================

alter table public.plans enable row level security;
alter table public.plan_assignments enable row level security;
alter table public.workouts enable row level security;
alter table public.set_logs enable row level security;

-- plans
drop policy if exists "plans: read" on public.plans;
create policy "plans: read" on public.plans
  for select using (
    (team_id is not null and public.vlo_is_team_staff(team_id))
    or owner_id = auth.uid()
    or public.vlo_is_assigned(id)
  );

drop policy if exists "plans: create" on public.plans;
create policy "plans: create" on public.plans
  for insert with check (
    created_by = auth.uid()
    and ((team_id is not null and public.vlo_is_team_staff(team_id)) or owner_id = auth.uid())
  );

drop policy if exists "plans: edit" on public.plans;
create policy "plans: edit" on public.plans
  for update
  using ((team_id is not null and public.vlo_is_team_staff(team_id)) or owner_id = auth.uid())
  with check ((team_id is not null and public.vlo_is_team_staff(team_id)) or owner_id = auth.uid());

drop policy if exists "plans: delete" on public.plans;
create policy "plans: delete" on public.plans
  for delete using ((team_id is not null and public.vlo_is_team_staff(team_id)) or owner_id = auth.uid());

-- plan_assignments
drop policy if exists "assignments: read" on public.plan_assignments;
create policy "assignments: read" on public.plan_assignments
  for select using (athlete_id = auth.uid() or public.vlo_can_manage_plan(plan_id));

drop policy if exists "assignments: create" on public.plan_assignments;
create policy "assignments: create" on public.plan_assignments
  for insert with check (public.vlo_can_assign(plan_id, athlete_id));

drop policy if exists "assignments: edit" on public.plan_assignments;
create policy "assignments: edit" on public.plan_assignments
  for update using (public.vlo_can_manage_plan(plan_id))
  with check (public.vlo_can_assign(plan_id, athlete_id));

drop policy if exists "assignments: delete" on public.plan_assignments;
create policy "assignments: delete" on public.plan_assignments
  for delete using (public.vlo_can_manage_plan(plan_id));

-- workouts
drop policy if exists "workouts: read" on public.workouts;
create policy "workouts: read" on public.workouts
  for select using (athlete_id = auth.uid() or public.vlo_coaches_athlete(athlete_id));

-- Free workouts: the athlete, for themselves. Planned workouts: whoever manages the plan.
drop policy if exists "workouts: create" on public.workouts;
create policy "workouts: create" on public.workouts
  for insert with check (
    (assignment_id is null and athlete_id = auth.uid())
    or (assignment_id is not null and public.vlo_can_manage_assignment(assignment_id))
  );

-- The athlete may update their own workouts (complete them; move free ones);
-- the trigger above stops them from moving planned ones.
drop policy if exists "workouts: edit" on public.workouts;
create policy "workouts: edit" on public.workouts
  for update using (
    athlete_id = auth.uid()
    or (assignment_id is not null and public.vlo_can_manage_assignment(assignment_id))
  );

drop policy if exists "workouts: delete" on public.workouts;
create policy "workouts: delete" on public.workouts
  for delete using (
    (assignment_id is null and athlete_id = auth.uid())
    or (assignment_id is not null and public.vlo_can_manage_assignment(assignment_id))
  );

-- set_logs
drop policy if exists "set logs: read" on public.set_logs;
create policy "set logs: read" on public.set_logs
  for select using (athlete_id = auth.uid() or public.vlo_coaches_athlete(athlete_id));

drop policy if exists "set logs: athlete logs own sets" on public.set_logs;
create policy "set logs: athlete logs own sets" on public.set_logs
  for insert with check (athlete_id = auth.uid() and public.vlo_workout_athlete(workout_id) = auth.uid());

drop policy if exists "set logs: athlete edits own sets" on public.set_logs;
create policy "set logs: athlete edits own sets" on public.set_logs
  for update using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid() and public.vlo_workout_athlete(workout_id) = auth.uid());

drop policy if exists "set logs: athlete deletes own sets" on public.set_logs;
create policy "set logs: athlete deletes own sets" on public.set_logs
  for delete using (athlete_id = auth.uid());
