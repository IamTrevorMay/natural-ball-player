-- Fix #205: Add player_id to discount_codes so codes can be assigned per-athlete
-- (used for Marek Health partnership discount codes)

ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_discount_codes_player_id ON public.discount_codes(player_id);
