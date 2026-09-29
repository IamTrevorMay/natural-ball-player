-- =====================================================================
-- Issue #428 — players could book sessions that were already full.
--
-- ROOT CAUSE: the slot_reservations SELECT policy is self-or-staff, and
-- public_bookings is staff-only. When an athlete opened ReserveSlotModal
-- the capacity check counted BOTH tables under the athlete's own RLS and
-- got 0 for every slot they had not booked yet, so `0 >= max_players`
-- was never true and every session looked open. CoachSlotsWeekView's
-- "Fully booked" badge was wrong for the same reason. Coach Zach set
-- max_players = 1 and Carter booked into several full sessions.
--
-- WHY NOT "let every authenticated user read all reservations" (option A
-- in the thread): that hands every athlete every other athlete's rows —
-- player_id, status, attendance, cancel_reason (sick / not) — many of
-- them minors. The client only ever needed a NUMBER.
--
-- WHAT THIS ADDS (option B, plus a server-side belt):
--   1. slot_booked_counts(uuid[], date, date) — SECURITY DEFINER RPC
--      returning (slot_id, slot_date, booked) for every occurrence in
--      the window that has at least one live booking. `booked` is the
--      same sum the client used to compute itself: slot_reservations in
--      pending/confirmed + public_bookings in pending_payment/confirmed.
--      Rows with no bookings are simply absent (treat as 0). Any
--      authenticated user may call it; it exposes counts only.
--   2. slot_reservations_capacity_guard — BEFORE INSERT/UPDATE trigger
--      that refuses a row entering pending/confirmed when the occurrence
--      is already at training_slots.max_players. This is what actually
--      stops the overbooking: the client check above closes the RLS hole,
--      the trigger closes the race between two athletes tapping Reserve
--      at the same moment (it takes a row lock on the training_slots row
--      so concurrent inserts serialise). It fires ONLY on a status
--      transition into the counted set, so #292 moves (slot_id/slot_date
--      repoint with status unchanged), coach confirms (pending →
--      confirmed, both already counted), cancels, declines and attendance
--      updates are never blocked — including on a slot that is already
--      over capacity from before this migration.
--      Raises SQLSTATE 'P0428' with message 'This session is fully booked.'
--      so the client can recognise it.
--
-- The only INSERT path in the app is the athlete's own ReserveSlotModal;
-- staff never create reservations by hand, so the trigger affects
-- athletes in practice. public_bookings (the /book flow) keeps its own
-- service-role capacity check in public-book-checkout; it is COUNTED
-- here but not guarded here.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.slot_booked_counts(
  p_slot_ids uuid[],
  p_start date,
  p_end date
)
RETURNS TABLE (slot_id uuid, slot_date date, booked integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT x.slot_id, x.slot_date, SUM(x.n)::integer AS booked
  FROM (
    SELECT r.slot_id, r.slot_date, COUNT(*) AS n
    FROM public.slot_reservations r
    WHERE r.slot_id = ANY (p_slot_ids)
      AND r.slot_date BETWEEN p_start AND p_end
      AND r.status IN ('pending', 'confirmed')
    GROUP BY r.slot_id, r.slot_date
    UNION ALL
    SELECT b.source_id, b.occurrence_date, COUNT(*) AS n
    FROM public.public_bookings b
    WHERE b.source_type = 'training_slot'
      AND b.source_id = ANY (p_slot_ids)
      AND b.occurrence_date BETWEEN p_start AND p_end
      AND b.status IN ('pending_payment', 'confirmed')
    GROUP BY b.source_id, b.occurrence_date
  ) x
  GROUP BY x.slot_id, x.slot_date;
$$;

REVOKE ALL ON FUNCTION public.slot_booked_counts(uuid[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.slot_booked_counts(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.slot_booked_counts(uuid[], date, date) TO service_role;

-- ---------------------------------------------------------------------
-- Server-side capacity guard.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slot_reservations_capacity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity integer;
  v_booked   integer;
BEGIN
  -- Only a transition INTO the counted set can push an occurrence over.
  IF NEW.status IS DISTINCT FROM 'pending' AND NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Serialise concurrent bookings of the same occurrence: the row lock on
  -- training_slots makes the second transaction wait for the first to
  -- commit, so its count below already includes the winner.
  SELECT COALESCE(s.max_players, 1) INTO v_capacity
  FROM public.training_slots s
  WHERE s.id = NEW.slot_id
  FOR UPDATE;

  IF v_capacity IS NULL THEN
    -- Orphan slot id: let the FK (if any) decide; nothing to guard.
    RETURN NEW;
  END IF;

  SELECT
    (SELECT COUNT(*) FROM public.slot_reservations r
      WHERE r.slot_id = NEW.slot_id
        AND r.slot_date = NEW.slot_date
        AND r.status IN ('pending', 'confirmed')
        AND r.id IS DISTINCT FROM NEW.id)
    +
    (SELECT COUNT(*) FROM public.public_bookings b
      WHERE b.source_type = 'training_slot'
        AND b.source_id = NEW.slot_id
        AND b.occurrence_date = NEW.slot_date
        AND b.status IN ('pending_payment', 'confirmed'))
  INTO v_booked;

  IF v_booked >= v_capacity THEN
    RAISE EXCEPTION 'This session is fully booked.'
      USING ERRCODE = 'P0428',
            HINT = format('slot %s on %s: %s of %s booked', NEW.slot_id, NEW.slot_date, v_booked, v_capacity);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS slot_reservations_capacity_guard ON public.slot_reservations;
CREATE TRIGGER slot_reservations_capacity_guard
  BEFORE INSERT OR UPDATE OF status, slot_id, slot_date ON public.slot_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.slot_reservations_capacity_guard();
