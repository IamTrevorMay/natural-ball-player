-- #436: per-athlete "is this NBP+ athlete programmed?" rollup for the staff
-- lists (Training Groups chips, Admin Settings users, Manage Athletes).
--
-- "Programmed" reads from what athletes actually see: workouts on their
-- calendar (schedule_events, event_type='workout') dated today or later,
-- directly (player_id) or via a team they belong to (team_id / team_ids),
-- keyed by the workout `category`:
--   lifting  = strength
--   mobility = mobility
--   throwing = pitching
--   hitting  = hitting
-- and meals = an active meal_plan_assignments row (own or team), where
-- active means end_date is null or today-or-later.
--
-- p_user_ids null = every member of a training group (teams.team_type =
-- 'training'); otherwise exactly the ids passed. Staff-gated SECURITY
-- DEFINER so the lists don't need to pull 100k+ schedule rows client-side.

create or replace function public.program_status(p_user_ids uuid[] default null)
returns table(user_id uuid, lifting boolean, mobility boolean, throwing boolean, hitting boolean, meals boolean)
language sql stable security definer set search_path = public as $$
  with ids as (
    select distinct u as user_id from unnest(coalesce(p_user_ids, '{}'::uuid[])) u
    where p_user_ids is not null
    union
    select distinct tm.user_id
    from team_members tm join teams t on t.id = tm.team_id
    where p_user_ids is null and t.team_type = 'training' and tm.user_id is not null
  ),
  w as (
    select e.player_id as user_id, lower(e.category) as category
    from schedule_events e
    where e.event_type = 'workout' and e.event_date >= current_date and e.player_id is not null
    union all
    select tm.user_id, lower(e.category)
    from schedule_events e
    join team_members tm on (tm.team_id = e.team_id or tm.team_id = any (coalesce(e.team_ids, '{}'::uuid[])))
    where e.event_type = 'workout' and e.event_date >= current_date and e.player_id is null
  ),
  m as (
    select mpa.player_id as user_id from meal_plan_assignments mpa
    where mpa.player_id is not null and (mpa.end_date is null or mpa.end_date >= current_date)
    union
    select tm.user_id from meal_plan_assignments mpa
    join team_members tm on tm.team_id = mpa.team_id
    where mpa.team_id is not null and (mpa.end_date is null or mpa.end_date >= current_date)
  )
  select ids.user_id,
    exists (select 1 from w where w.user_id = ids.user_id and w.category = 'strength'),
    exists (select 1 from w where w.user_id = ids.user_id and w.category = 'mobility'),
    exists (select 1 from w where w.user_id = ids.user_id and w.category = 'pitching'),
    exists (select 1 from w where w.user_id = ids.user_id and w.category = 'hitting'),
    exists (select 1 from m where m.user_id = ids.user_id)
  from ids
  where public.get_user_role() = any (array['admin','coach']);
$$;
revoke all on function public.program_status(uuid[]) from public, anon;
grant execute on function public.program_status(uuid[]) to authenticated;
