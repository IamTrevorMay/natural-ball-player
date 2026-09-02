-- 2026-09-02 — ALREADY RUN IN PRODUCTION by hand. Recorded here so a rebuilt
-- environment gets it too.
--
-- Athlete signup was failing in production with:
--   "player_profiles insert failed: permission denied for table player_profiles"
-- That is a GRANT failure, not RLS. The signup edge function runs as
-- service_role, and 74 of the ~78 public tables have no service_role grant at
-- all -- house style has been "GRANT ... TO authenticated" and nothing else.
-- player_profiles is not created by any migration in this repo (it was made by
-- hand), which is how it missed out.
--
-- Scope is deliberately narrow: only the tables signup writes to after the
-- users insert. The other 71 tables are a separate decision -- see
-- "Still open" in note 72.
--
-- Reverse with: REVOKE ALL ON <table> FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members   TO service_role;
