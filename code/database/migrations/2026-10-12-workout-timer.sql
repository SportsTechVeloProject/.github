-- Workout timer: when the athlete started the workout. Together with
-- completed_at it gives how long the session took.
-- Run once in the Supabase SQL editor.

alter table public.workouts
  add column if not exists started_at timestamptz;
