-- Fix #207: Add offer_status to player_profiles for Naturals Select team tracking
ALTER TABLE public.player_profiles
  ADD COLUMN IF NOT EXISTS offer_status TEXT;
