-- Audit M5: team_game_changer_contacts SELECT policy was `USING (true)`, so
-- every authenticated user could read every team's parent/coach phone +
-- email + notes. Scope to team-membership: a player can read contacts for
-- a team they're on; staff (admin/coach) can read everything.

DROP POLICY IF EXISTS "team_gc_contacts_select" ON public.team_game_changer_contacts;
CREATE POLICY "team_gc_contacts_select" ON public.team_game_changer_contacts
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'coach')
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = team_game_changer_contacts.team_id
        AND tm.user_id = (SELECT auth.uid())
    )
  );
