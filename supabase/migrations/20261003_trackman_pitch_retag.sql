-- #435: let the linked athlete retag their own pitches in the portal.
--
-- Staff (admin/coach) already have full write via "Staff write pitches". This
-- adds an UPDATE path for the pitcher themself, limited to `tagged_pitch_type`
-- by a BEFORE UPDATE trigger (RLS can't scope columns; a column-level GRANT
-- would also shrink what staff can touch, so the trigger carries the rule).

drop policy if exists "Pitcher retags own pitches" on trackman_pitches;
create policy "Pitcher retags own pitches" on trackman_pitches for update
  to authenticated
  using (pitcher_user_id = auth.uid())
  with check (pitcher_user_id = auth.uid());

create or replace function public.trackman_pitches_guard_athlete_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Staff and service_role (no auth.uid()) are unrestricted.
  if auth.uid() is null or public.get_user_role() = any (array['admin','coach']) then
    return new;
  end if;
  -- An athlete may change only tagged_pitch_type on their own pitch.
  if (to_jsonb(new) - 'tagged_pitch_type') is distinct from (to_jsonb(old) - 'tagged_pitch_type') then
    raise exception 'Athletes may only change the pitch type.' using errcode = 'P0435';
  end if;
  return new;
end;
$$;

drop trigger if exists trackman_pitches_guard_athlete_update on trackman_pitches;
create trigger trackman_pitches_guard_athlete_update
  before update on trackman_pitches
  for each row execute function public.trackman_pitches_guard_athlete_update();
