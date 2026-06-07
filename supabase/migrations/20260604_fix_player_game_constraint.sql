-- Fix #177: allow player-scoped games in schedule_events
-- The valid_event_type_data CHECK constraint required games to have team_id,
-- but PlayerAddGameModal inserts with player_id only. Relax the constraint
-- so games (and practices) can be either team-scoped or player-scoped.
-- The existing check_team_or_player constraint still enforces exactly one.

ALTER TABLE public.schedule_events DROP CONSTRAINT IF EXISTS valid_event_type_data;
ALTER TABLE public.schedule_events ADD CONSTRAINT valid_event_type_data CHECK (
  event_type IN ('game', 'practice')
  OR (event_type = 'workout' AND player_id IS NOT NULL AND team_id IS NULL)
  OR (event_type = 'meal' AND player_id IS NOT NULL AND team_id IS NULL)
);
