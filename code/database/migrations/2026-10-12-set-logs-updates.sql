-- Fixes to set_logs, for databases where supabase/plans.sql was run before
-- 2026-10-12. Run once in the Supabase SQL editor.

-- 1. The same exercise can appear twice in a day (heavy sets + back-off sets),
--    so a set is identified by the exercise's position in the day too.
alter table public.set_logs drop constraint if exists set_logs_workout_id_exercise_set_no_key;

create unique index if not exists set_logs_one_per_set
  on public.set_logs (workout_id, coalesce(item_index, -1), exercise, set_no);

-- 2. Timed exercises ("Bike 20 min", "Plank 3x45s") are logged as a time, not reps.
alter table public.set_logs
  add column if not exists duration_s int check (duration_s >= 0);

-- 3. Conditioning (bike, run, row…) can also log a distance, in metres. Only the
--    exercises the bank (js/exercises.js) marks as time-and-distance show it.
alter table public.set_logs
  add column if not exists distance_m numeric(9,1) check (distance_m >= 0);
