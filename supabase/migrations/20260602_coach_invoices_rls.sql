-- Issue #171: ensure coach_invoices has explicit RLS policies matching the
-- coach-invoices storage bucket. Pre-existing `invoices_*_own/admin` policies
-- were defined directly in Supabase Studio (no repo migration), so this file
-- recreates an authoritative set under `coach_invoices_*` names that mirror
-- the storage policies. Both sets OR together harmlessly.

DROP POLICY IF EXISTS "coach_invoices_select" ON public.coach_invoices;
CREATE POLICY "coach_invoices_select" ON public.coach_invoices
  FOR SELECT
  USING (
    coach_id = auth.uid()
    OR public.get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "coach_invoices_insert" ON public.coach_invoices;
CREATE POLICY "coach_invoices_insert" ON public.coach_invoices
  FOR INSERT
  WITH CHECK (
    coach_id = auth.uid()
    OR public.get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "coach_invoices_update" ON public.coach_invoices;
CREATE POLICY "coach_invoices_update" ON public.coach_invoices
  FOR UPDATE
  USING (
    coach_id = auth.uid()
    OR public.get_user_role() = 'admin'
  )
  WITH CHECK (
    coach_id = auth.uid()
    OR public.get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "coach_invoices_delete" ON public.coach_invoices;
CREATE POLICY "coach_invoices_delete" ON public.coach_invoices
  FOR DELETE
  USING (
    (coach_id = auth.uid() AND status = 'submitted')
    OR public.get_user_role() = 'admin'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_invoices TO authenticated;
