-- Issue #189: facility fine document signed acknowledgment.
-- Trevor uploads the doc as a staff_documents row with title prefix
-- 'Facility Fine'. Every user must sign before they can dismiss the prompt,
-- same pattern as the player contract (#162 / ContractPage).

CREATE TABLE IF NOT EXISTS public.facility_fine_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.staff_documents(id) ON DELETE SET NULL,
  signed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  signature_url TEXT,
  signature_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_facility_fine_signatures_user
  ON public.facility_fine_signatures(user_id);

ALTER TABLE public.facility_fine_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facility_fine_signatures_select" ON public.facility_fine_signatures;
CREATE POLICY "facility_fine_signatures_select" ON public.facility_fine_signatures
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "facility_fine_signatures_insert" ON public.facility_fine_signatures;
CREATE POLICY "facility_fine_signatures_insert" ON public.facility_fine_signatures
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "facility_fine_signatures_delete" ON public.facility_fine_signatures;
CREATE POLICY "facility_fine_signatures_delete" ON public.facility_fine_signatures
  FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

GRANT ALL ON public.facility_fine_signatures TO authenticated;
