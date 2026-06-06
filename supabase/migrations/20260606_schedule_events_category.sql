-- Issue #191: workout calendar event color didn't match the program library
-- color because MonthView/WeekView guessed the category from event.title using
-- substring matching ("hit", "pitch", "warm", etc). Titles like "DE Lower M3W3"
-- fell through to the default "orange" bucket even when the template lived in
-- the blue "Hitting" folder.
--
-- Adds a category column on schedule_events that the insert path populates from
-- the template/program folder. Render code prefers this over the title guess.

ALTER TABLE public.schedule_events
  ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN public.schedule_events.category IS
  'Source-of-truth category for color matching (hitting/pitching/strength/recovery/warmup/cardio/fielding/general). Set by the drag-from-library path so the calendar tile matches the program-library color.';
