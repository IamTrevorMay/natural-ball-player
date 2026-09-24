-- =====================================================================
-- Issue #305 — booking gate ships in WARN mode.
--
-- The gate was built to refuse a reservation when the athlete holds no
-- matching package. Measured 2026-09-23 against the live database it would
-- have refused 50 of the last 80 real bookings (14 athletes), because 162
-- lesson-pack purchases still sit at 'pending'. So the gate runs, but it
-- WARNS instead of blocking: the athlete sees the banner, the booking goes
-- through, and staff get the flag. Flipping to hard block later is one
-- constant in Schedule.js (BOOKING_GATE_MODE).
--
-- That means a flag row no longer always means "was blocked". Two columns
-- record what actually happened so the bell can say the right thing:
--
--   outcome  'blocked'  — the athlete could not reserve (hard-block mode)
--            'booked'   — the athlete reserved anyway (warn mode)
--   reason   'none'        — holds no matching package at all
--            'expired'     — holds one, but it has expired
--            'no_sessions' — holds one, but it has no sessions left
--            'paused'      — holds one, but the subscription is paused
--                            (store_purchases.status = 'past_due', which
--                            every writer maps from Square PAUSED)
--
-- Existing rows (there are none in production as of 2026-09-23 — the gate
-- has never been on) default to outcome='blocked', reason NULL.
-- =====================================================================

ALTER TABLE public.booking_package_flags
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'blocked',
  ADD COLUMN IF NOT EXISTS reason  text;

-- Loose text, no CHECK — same convention as slot_reservations.cancel_reason.
-- The app writes the four reasons above; a fifth can be added without a
-- migration.

-- ---------------------------------------------------------------------
-- CHECK IT WORKED.
--   Expect: 7 columns including outcome (text, default 'blocked') and reason.
-- ---------------------------------------------------------------------
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'booking_package_flags'
ORDER BY ordinal_position;

-- =====================================================================
-- HOW TO UNDO
-- =====================================================================
--   ALTER TABLE public.booking_package_flags DROP COLUMN IF EXISTS outcome;
--   ALTER TABLE public.booking_package_flags DROP COLUMN IF EXISTS reason;
