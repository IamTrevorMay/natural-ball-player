-- YouTube example video per situational play. Staff (admin+coach) edit via the
-- existing "Staff can update situational plays" policy; players read-only.
ALTER TABLE public.situational_plays ADD COLUMN IF NOT EXISTS video_url text;
