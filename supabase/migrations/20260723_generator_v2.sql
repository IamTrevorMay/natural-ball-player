-- Generator v2: training age storage + assessment editing.
-- Part of the program-generator overhaul (S&C / Throwing / Hitting / Nutrition).

-- ============================================================
-- 1. Store training age so generators can auto-fill it.
--    Months (not years) to match the existing ProgramGenerator input granularity.
-- ============================================================
ALTER TABLE public.player_profiles
  ADD COLUMN IF NOT EXISTS training_age_months integer;

-- ============================================================
-- 2. Allow editing of already-completed assessment submissions.
--    Staff already had UPDATE (20260524_security_hardening.sql); broaden it so
--    the original submitter (e.g. an athlete editing their own self-assessment)
--    can also update. Insert policy already permits assessed_by = auth.uid().
-- ============================================================
DROP POLICY IF EXISTS "assessment_submissions_update" ON public.assessment_submissions;

CREATE POLICY "assessment_submissions_update" ON public.assessment_submissions
  FOR UPDATE TO authenticated
  USING (assessed_by = auth.uid() OR public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (assessed_by = auth.uid() OR public.get_user_role() IN ('admin', 'coach'));
