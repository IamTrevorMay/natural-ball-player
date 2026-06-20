-- Audit M6: facility_fine_signatures had no UPDATE policy. The table has
-- UNIQUE (user_id, document_id), so re-signing the same document violates
-- the constraint and the upload path can't recover. Add an own-row UPDATE
-- policy so a player can refresh their signature without an admin having
-- to delete first.

DROP POLICY IF EXISTS "facility_fine_signatures_update" ON public.facility_fine_signatures;
CREATE POLICY "facility_fine_signatures_update" ON public.facility_fine_signatures
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
