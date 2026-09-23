-- =====================================================================
-- Issue #422 — athletes can read their own notes (all but Disciplinary).
--
-- Until now player_notes was staff-only end to end: the SELECT policy
-- allowed admin/coach only, and Profile.js hid the Notes sub-tab from
-- players. Cordell: "I want players to be able to see their notes ...
-- Please show players their notes and only hide the disciplinary ones."
--
-- WHAT THIS ADDS:
--   1. player_notes_select_own — a player may SELECT rows where they are
--      the subject (player_id = auth.uid()) AND category <> 'disciplinary'.
--      Enforced here, not just in the UI, so a player can never pull a
--      disciplinary row whatever the client asks for. Staff read is
--      untouched (player_notes_select). Insert/update/delete unchanged:
--      players still cannot write notes.
--   2. staff_display_names(uuid[]) — SECURITY DEFINER RPC returning
--      (id, full_name) for admin/coach ids only. The users SELECT policy
--      is self-or-staff, so the `author:created_by(full_name)` embed comes
--      back null for a player; Profile.js calls this to fill in the coach
--      name on each note. Restricted to staff rows so it cannot be used to
--      enumerate other athletes.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

DROP POLICY IF EXISTS player_notes_select_own ON public.player_notes;
CREATE POLICY player_notes_select_own ON public.player_notes
  FOR SELECT TO authenticated
  USING (player_id = auth.uid() AND category <> 'disciplinary');

CREATE OR REPLACE FUNCTION public.staff_display_names(ids uuid[])
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.full_name
  FROM public.users u
  WHERE u.id = ANY (ids)
    AND u.role IN ('admin', 'coach');
$$;

REVOKE ALL ON FUNCTION public.staff_display_names(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.staff_display_names(uuid[]) TO authenticated;

COMMENT ON POLICY player_notes_select_own ON public.player_notes IS
  '#422: athletes read their own notes except category = disciplinary.';
COMMENT ON FUNCTION public.staff_display_names(uuid[]) IS
  '#422: staff (admin/coach) names by id for note-author display where the users RLS would otherwise hide them.';
