-- Live Trackman capture (BullpenSync tool) support.
--
-- The nightly FTP sync (api/trackman-sync.js) imports verified Trackman-cloud
-- CSVs. The new `tools/bullpen-sync` desktop tool sniffs the B1<->iPad
-- WebSocket live and writes sessions/pitches directly from an admin's laptop.
-- Both land in the SAME trackman_sessions / trackman_pitches tables so the
-- athlete's existing Trackman tab shows everything.
--
-- To keep the two producers from colliding and to let the UI distinguish them,
-- add a `source` discriminator ('ftp' = cloud verified import, 'live' = B1
-- WebSocket capture). Live sessions use a synthetic file_path of
-- 'live/<session_uuid>' so the existing NOT NULL UNIQUE constraint still holds
-- (no schema relaxation needed).

alter table trackman_sessions
  add column if not exists source text not null default 'ftp';
alter table trackman_sessions
  add column if not exists captured_by uuid references users(id) on delete set null;

alter table trackman_pitches
  add column if not exists source text not null default 'ftp';

create index if not exists trackman_sessions_source_idx on trackman_sessions (source);
create index if not exists trackman_pitches_source_idx on trackman_pitches (source);

-- RLS is unchanged: the existing "Staff write sessions/pitches" policies already
-- let admin+coach insert, which is exactly who runs the BullpenSync tool
-- (authenticated with their own NBP account). No new grants/policies required.
