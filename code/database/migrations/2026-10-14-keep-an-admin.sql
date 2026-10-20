-- Safety rule: a team must always keep at least one admin.
-- Applied 2026-10-14; tested (last admin cannot step down or be removed; normal role changes and removals still work).
--
-- Plain language: before any change to who is on a team or what role they
-- have, the database checks two things and refuses the change if either
-- fails:
--   1. Would the team be left without an admin? (The last admin leaving,
--      being removed, or being made coach/athlete.) Then: refuse, with the
--      message "A team needs at least one admin. Make someone else admin first."
--      The website shows that message as it is.
--   2. Is someone trying to move a membership to another person or another
--      team, instead of just changing its role? Admins only need to change
--      roles, so anything else is refused.
-- It never changes any data by itself; it only says yes or no.

create or replace function public.team_members_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.team_id <> old.team_id) then
    raise exception 'Only the role of a team member can be changed.';
  end if;

  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from public.team_members m
                     where m.team_id = old.team_id and m.role = 'admin' and m.user_id <> old.user_id) then
    raise exception 'A team needs at least one admin. Make someone else admin first.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Run the check before every role change or removal on team_members.
drop trigger if exists team_members_guard on public.team_members;
create trigger team_members_guard
  before update or delete on public.team_members
  for each row execute function public.team_members_guard();
