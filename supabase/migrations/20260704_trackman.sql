-- Trackman integration (#44). Session CSVs are pulled from Trackman's FTP
-- (practice/YYYY/MM/DD/<Type>_<ts>_verified.csv), one row per pitch, Trackman
-- V3 format (73 cols) carrying BOTH pitching metrics and batted-ball results.
-- Ingested by the Vercel /api/trackman-sync function (service_role); athletes
-- review their own stats in the profile Trackman tab.
--
-- Trackman names are "Last, First" and won't match users.full_name, so
-- trackman_player_map holds the staff-confirmed name -> user_id mapping; imports
-- resolve pitcher_user_id / batter_user_id from it and it backfills on change.

-- 1. Name -> athlete mapping (remembered) --------------------------------------
create table if not exists trackman_player_map (
  id uuid primary key default gen_random_uuid(),
  trackman_name text not null unique,   -- exactly as it appears in the CSV ("Last, First")
  user_id uuid references users(id) on delete cascade,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. One row per imported CSV file --------------------------------------------
create table if not exists trackman_sessions (
  id uuid primary key default gen_random_uuid(),
  trackman_session_id text,             -- SessionId column (may repeat across re-exports)
  session_date date,
  session_type text,                    -- from filename: 'Pitching' / 'Hitting' / ...
  file_path text not null unique,       -- FTP path — the import dedupe key
  pitch_count integer not null default 0,
  imported_at timestamptz not null default now()
);

-- 3. One row per pitch --------------------------------------------------------
create table if not exists trackman_pitches (
  id uuid primary key default gen_random_uuid(),
  session_row_id uuid references trackman_sessions(id) on delete cascade,
  trackman_session_id text,
  pitch_uid text unique,                -- PitchUID — dedupe on re-import (ON CONFLICT)
  pitch_no integer,
  play_id text,
  thrown_date date,
  thrown_time text,

  -- Pitcher
  pitcher_name text,
  pitcher_user_id uuid references users(id) on delete set null,
  pitcher_ext_id text,
  pitcher_throws text,

  -- Batter (populated on hitting sessions / batted balls)
  batter_name text,
  batter_user_id uuid references users(id) on delete set null,
  batter_ext_id text,
  batter_side text,

  balls integer,
  strikes integer,
  tagged_pitch_type text,
  pitch_call text,

  -- Pitching metrics
  rel_speed numeric,
  spin_rate numeric,
  spin_axis numeric,
  tilt text,
  rel_height numeric,
  rel_side numeric,
  extension numeric,
  vert_break numeric,
  induced_vert_break numeric,
  horz_break numeric,
  plate_loc_height numeric,
  plate_loc_side numeric,
  zone_speed numeric,
  vert_appr_angle numeric,
  horz_appr_angle numeric,
  eff_velocity numeric,

  -- Batted-ball metrics
  hit_type text,
  exit_speed numeric,
  launch_angle numeric,                 -- Angle column
  hit_direction numeric,
  distance numeric,
  hang_time numeric,
  bearing numeric,
  hit_spin_rate numeric,

  raw jsonb,                            -- full original row so no field is ever lost
  created_at timestamptz not null default now()
);

create index if not exists trackman_pitches_pitcher_idx on trackman_pitches (pitcher_user_id, thrown_date);
create index if not exists trackman_pitches_batter_idx on trackman_pitches (batter_user_id, thrown_date);
create index if not exists trackman_pitches_session_idx on trackman_pitches (session_row_id);
create index if not exists trackman_pitches_pitcher_name_idx on trackman_pitches (pitcher_name);
create index if not exists trackman_pitches_batter_name_idx on trackman_pitches (batter_name);

-- RLS -------------------------------------------------------------------------
alter table trackman_player_map enable row level security;
alter table trackman_sessions enable row level security;
alter table trackman_pitches enable row level security;

grant all on trackman_player_map to authenticated;
grant all on trackman_player_map to service_role;
grant all on trackman_sessions to authenticated;
grant all on trackman_sessions to service_role;
grant all on trackman_pitches to authenticated;
grant all on trackman_pitches to service_role;

-- Player map: staff-only (imports resolve it via service_role, not the client).
drop policy if exists "Staff manage trackman map" on trackman_player_map;
create policy "Staff manage trackman map" on trackman_player_map for all
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']))
  with check (public.get_user_role() = any (array['admin','coach']));

-- Pitches: an athlete sees rows where they are the pitcher or batter; staff see all.
drop policy if exists "Own or staff read pitches" on trackman_pitches;
create policy "Own or staff read pitches" on trackman_pitches for select
  to authenticated
  using (
    pitcher_user_id = auth.uid()
    or batter_user_id = auth.uid()
    or public.get_user_role() = any (array['admin','coach'])
  );
drop policy if exists "Staff write pitches" on trackman_pitches;
create policy "Staff write pitches" on trackman_pitches for all
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']))
  with check (public.get_user_role() = any (array['admin','coach']));

-- Sessions: readable if the athlete has a pitch in it, or staff.
drop policy if exists "Own or staff read sessions" on trackman_sessions;
create policy "Own or staff read sessions" on trackman_sessions for select
  to authenticated
  using (
    public.get_user_role() = any (array['admin','coach'])
    or exists (
      select 1 from trackman_pitches p
      where p.session_row_id = trackman_sessions.id
        and (p.pitcher_user_id = auth.uid() or p.batter_user_id = auth.uid())
    )
  );
drop policy if exists "Staff write sessions" on trackman_sessions;
create policy "Staff write sessions" on trackman_sessions for all
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']))
  with check (public.get_user_role() = any (array['admin','coach']));

-- Distinct Trackman player names + counts + current mapping, for the admin
-- mapping UI. Staff-gated (returns nothing for non-staff).
create or replace function public.trackman_name_directory()
returns table(trackman_name text, appearances bigint, mapped_user_id uuid)
language sql stable security definer set search_path = public as $$
  select n.nm, count(*)::bigint, m.user_id
  from (
    select pitcher_name nm from trackman_pitches where pitcher_name is not null
    union all
    select batter_name from trackman_pitches where batter_name is not null
  ) n
  left join trackman_player_map m on m.trackman_name = n.nm
  where public.get_user_role() = any (array['admin','coach'])
  group by n.nm, m.user_id
  order by n.nm;
$$;
revoke all on function public.trackman_name_directory() from public, anon;
grant execute on function public.trackman_name_directory() to authenticated;
