-- Target speed zone of a recorded set, for the analysis (python/main.py).
-- Run once in the Supabase SQL editor.
--
-- Optional: copied from the coach's plan when the set is recorded in My
-- training. Null when there is none (free workouts, the Squat-page recorder,
-- recordings made before this existed); the analysis works without it.
-- The m/s limits per zone and lift live in the code (squat/bench and deadlift
-- differ), so only the name is stored. Note the en dash (–) in the names.

alter table public.sessions
  add column if not exists target_zone text;

alter table public.sessions
  add constraint sessions_target_zone_check
  check (target_zone is null or target_zone in
    ('Speed–strength', 'Strength–speed', 'Accelerative strength', 'Maximal strength'));
