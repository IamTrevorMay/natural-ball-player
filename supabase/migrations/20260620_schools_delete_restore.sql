-- Audit L6: schools_delete was originally admin+coach (20260603) and was
-- silently narrowed to admin-only by the 20260616_rls_to_authenticated pass.
-- Restore the original admin+coach permission — coaches manage the school
-- directory day-to-day, the narrowing wasn't an intentional UX change.
-- L5 is closed by 20260616 (TO authenticated added on all three policies).

DROP POLICY IF EXISTS schools_delete ON public.schools;
CREATE POLICY schools_delete ON public.schools
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));
