-- =====================================================================
-- Issue #305 (booking gate) — flag athletes who get blocked for lack of a
-- package, so staff can spot and follow up. WRITTEN, NOT RUN.
--
-- WHAT THIS ADDS:
--   A small, append-only log table: booking_package_flags. One row per
--   "a player tried to reserve a session and #305's gate blocked them."
--   No status/resolved workflow — Cordell asked for a flag a human can
--   notice, not an automated process (same spirit as #306's "Sick cancels:
--   N" counter — visible, not actioned by the system).
--
-- WHY IT'S NEEDED:
--   Notifications in this app (useMainPortalCounts / useWorkPortalCounts)
--   are all LIVE-COMPUTED from existing tables — there's no persisted
--   "notifications" table anywhere. A blocked booking attempt creates NO
--   slot_reservations row (that's the whole point of blocking it), so
--   there is nothing existing to compute a "flag" from. This table is that
--   missing record.
--
-- WHAT THIS DOES NOT DO:
--   - No email. #281's send path is untouched — this is in-app only,
--     read via the existing NotificationBell / useMainPortalCounts.
--   - No automatic blocking of anything else. Staff read this list; the
--     system does not act on it.
--   - Does not touch slot_reservations, store_purchases, or any existing
--     table.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.booking_package_flags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  slot_id    uuid NOT NULL REFERENCES public.training_slots(id) ON DELETE CASCADE,
  slot_date  date NOT NULL,
  -- Denormalized so the coach-facing notification query doesn't need a join
  -- back through training_slots (which may itself be a since-deleted or
  -- moved occurrence). Nullable: set from whatever the app already knows
  -- about the slot at the moment of the block.
  coach_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_package_flags_coach_idx
  ON public.booking_package_flags (coach_id, created_at DESC);

ALTER TABLE public.booking_package_flags ENABLE ROW LEVEL SECURITY;

-- The player's own client writes the row at the moment they're blocked
-- (same trust level as them inserting their own slot_reservations row —
-- this table only ever records THEIR OWN blocked attempt, nothing about
-- anyone else).
DROP POLICY IF EXISTS "booking_package_flags_insert" ON public.booking_package_flags;
CREATE POLICY "booking_package_flags_insert" ON public.booking_package_flags
  FOR INSERT
  WITH CHECK (player_id = auth.uid());

-- Staff (admin + coach) read all flags — this is a facility-wide "who
-- needs a follow-up call" list, not scoped to "my own" slots at the
-- database level (the app's notification query narrows it further).
DROP POLICY IF EXISTS "booking_package_flags_select" ON public.booking_package_flags;
CREATE POLICY "booking_package_flags_select" ON public.booking_package_flags
  FOR SELECT
  USING (public.get_user_role() IN ('admin', 'coach'));

GRANT SELECT, INSERT ON public.booking_package_flags TO authenticated;
GRANT SELECT, INSERT ON public.booking_package_flags TO service_role;


-- ---------------------------------------------------------------------
-- CHECK IT WORKED.
--   Expect: booking_package_flags listed with 5 columns, RLS enabled.
-- ---------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'booking_package_flags'
ORDER BY ordinal_position;


-- =====================================================================
-- HOW TO UNDO — returns the schema to exactly how it was before.
-- =====================================================================
--   DROP TABLE IF EXISTS public.booking_package_flags;
