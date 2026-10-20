-- Recordings' target zone: accept the code groups fast / medium / slow.
-- Applied 2026-10-15 (22 recordings converted to medium; checked: fast/medium/slow accepted, other values refused).
--
-- Plain language: each recording remembers which speed zone the coach asked
-- for (sessions.target_zone); the analysis uses it as Squats2's TYPE. Since
-- 2026-10-15 the website saves the zone's code group: fast (> 1.30 m/s),
-- medium (0.50–1.30) or slow (< 0.50). The database rule from
-- 2026-10-13-session-target-zone.sql only allows the four old zone names, so
-- new recordings would be refused. This:
--   1. replaces that rule with one that allows fast / medium / slow, and still
--      the four old names (so an older copy of the website keeps working);
--   2. converts the recordings that hold an old name to the group it belongs
--      to under the new zones (speed-strength, strength-speed and accelerative
--      are all medium; maximal is slow). Only the label changes.

alter table public.sessions drop constraint if exists sessions_target_zone_check;
alter table public.sessions add constraint sessions_target_zone_check check (
  target_zone is null or target_zone in (
    'fast', 'medium', 'slow',
    'Speed–strength', 'Strength–speed', 'Accelerative strength', 'Maximal strength'
  )
);

update public.sessions set target_zone = case target_zone
    when 'Speed–strength'        then 'medium'
    when 'Strength–speed'        then 'medium'
    when 'Accelerative strength' then 'medium'
    when 'Maximal strength'      then 'slow'
  end
where target_zone in ('Speed–strength', 'Strength–speed', 'Accelerative strength', 'Maximal strength');
