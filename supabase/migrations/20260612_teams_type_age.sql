-- Fix #201: Add team_type and age_group columns to teams for filtering
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS team_type TEXT DEFAULT 'team';
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS age_group TEXT;
