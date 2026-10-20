-- Team identity: profile pictures, team pictures and a team colour.
-- Applied 2026-10-14.
--
-- Plain-language summary:
--   1. Two storage "buckets" (cloud folders):
--      - "pictures": profile pictures. Public link: anyone with a picture's
--        exact (random) link can view it; nobody can browse the bucket.
--      - "team-pictures": team pictures. Private: only members of that team
--        can load them (through links that expire after an hour).
--   2. Rules saying who may upload / see / delete which pictures.
--   3. Three new columns: where each picture is stored, and the team colour.
--   4. Two existing functions (team people list, Top PRs) also return each
--      person's picture. Team search is NOT changed, so people outside a
--      team never see its picture.


-- ============================================================
-- 1. The buckets
-- ============================================================
-- Only images (JPG, PNG, WebP) up to 2 MB are accepted in either.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pictures', 'pictures', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-pictures', 'team-pictures', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;


-- ============================================================
-- 2. Who may upload, see and delete pictures
-- ============================================================
-- Profile pictures are stored as  profiles/<person id>/<random>.jpg  in "pictures";
-- team pictures as                <team id>/<random>.jpg            in "team-pictures".
-- storage.foldername(name) splits a path into its folders, e.g. [1], [2].

-- Is the logged-in person a member (any role) / a coach or admin of the
-- team whose id is written as text in a folder name? Compared as text, so a
-- malformed folder name simply doesn't match instead of causing an error.
create or replace function public.is_team_member_text(p_team text)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (select 1 from public.team_members
                 where team_id::text = p_team and user_id = (select auth.uid()));
$$;
create or replace function public.is_team_staff_text(p_team text)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (select 1 from public.team_members
                 where team_id::text = p_team and user_id = (select auth.uid())
                   and role in ('coach', 'admin'));
$$;
revoke execute on function public.is_team_member_text(text) from public, anon;
revoke execute on function public.is_team_staff_text(text) from public, anon;
grant execute on function public.is_team_member_text(text) to authenticated;
grant execute on function public.is_team_staff_text(text) to authenticated;

-- Profile pictures: only you can upload into your folder, see its files
-- (Supabase needs that to delete an old picture) and delete from it.
-- Viewing happens through the public link, so no other "see" rule is needed.
create policy "pictures: upload own profile picture" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pictures' and (storage.foldername(name))[1] = 'profiles'
              and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "pictures: see own profile folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = 'profiles'
         and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "pictures: delete own profile picture" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = 'profiles'
         and (storage.foldername(name))[2] = (select auth.uid())::text);

-- Team pictures: members of the team can see (load) them; only its coaches
-- and admins (who can already edit the team description) upload and delete.
create policy "team pictures: members see" on storage.objects
  for select to authenticated
  using (bucket_id = 'team-pictures' and public.is_team_member_text((storage.foldername(name))[1]));
create policy "team pictures: staff upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-pictures' and public.is_team_staff_text((storage.foldername(name))[1]));
create policy "team pictures: staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-pictures' and public.is_team_staff_text((storage.foldername(name))[1]));


-- ============================================================
-- 3. New columns
-- ============================================================
-- Where the picture is in its bucket, e.g. "profiles/4f45…/a8c1….jpg".
-- Empty (null) = no picture, the initial is shown instead.
alter table public.profiles add column if not exists avatar_path text;
alter table public.teams    add column if not exists logo_path   text;
-- Team colour as a hex code like "#3D6BE8". The website offers 8 colours
-- tested to be readable in light and dark mode; the check only makes sure
-- it's a valid colour code. Teams are only readable by their members.
alter table public.teams    add column if not exists color       text
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
-- Who may change these is covered by the existing rules: you update your
-- own profile; coaches and admins update their team.


-- ============================================================
-- 4. Functions that now also return pictures
-- ============================================================
-- A function's list of returned fields can't be changed in place, so each is
-- dropped and created again: same logic as before, plus the new fields.

-- The team's people (team page): + avatar_path.
drop function if exists public.team_roster(uuid);
create function public.team_roster(p_team uuid)
returns table (user_id uuid, full_name text, role text, joined_at timestamptz, avatar_path text)
language sql
stable security definer
set search_path to ''
as $$
  select m.user_id, p.full_name, m.role, m.joined_at, p.avatar_path
  from public.team_members m join public.profiles p on p.id = m.user_id
  where m.team_id = p_team and public.is_team_member(p_team)
  order by case m.role when 'admin' then 0 when 'coach' then 1 else 2 end, p.full_name;
$$;

-- Top PRs: + avatar_path. (Logic unchanged from 2026-10-14-team-stats.sql.)
drop function if exists public.team_top_lifts(uuid, numeric[], int);
create function public.team_top_lifts(p_team uuid, p_zone_mins numeric[], p_per_zone int default 3)
returns table (exercise text, zone_idx int, rank int, user_id uuid, full_name text,
               weight_kg numeric, mean_velocity numeric, recorded_at timestamptz, avatar_path text)
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
  select r.exercise, r.zone_idx, r.rk::int, r.user_id, p.full_name, r.weight_kg, round(r.v, 3), r.recorded_at, p.avatar_path
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rk <= p_per_zone
  order by r.exercise, r.zone_idx, r.rk;
$$;

-- Same access as before: logged-in users only.
revoke execute on function public.team_roster(uuid) from public, anon;
revoke execute on function public.team_top_lifts(uuid, numeric[], int) from public, anon;
grant execute on function public.team_roster(uuid) to authenticated;
grant execute on function public.team_top_lifts(uuid, numeric[], int) to authenticated;
