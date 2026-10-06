-- #440: NBP+ Athlete Training Agreement (6- / 12-month terms), filled out and
-- signed in the app. Cordell uploaded the agreement as a staff_documents row
-- titled "NBP Athlete Training Agreement …" (v NBP+2.0, 2026-10-05) and wants
-- it mandatory for every NBP+ athlete — in-house or remote — with the fields
-- fillable in the portal instead of printed.
--
-- "NBP+ athlete" = member of a training group (teams.team_type = 'training'),
-- the same definition #436's program_status uses. The sidebar red dot is the
-- nag, exactly like Waiver / Contract / LOI / Facility Fine; nothing is
-- hard-blocked.
--
-- One row per (athlete, document version): re-uploading a new agreement
-- resets the prompt for everyone, as facility_fine_signatures does.
-- Signatures are TYPED full legal names (the PDF says "type full legal name
-- to sign"), not drawn, so there is no storage upload here.

CREATE TABLE IF NOT EXISTS public.nbp_plus_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.staff_documents(id) ON DELETE SET NULL,

  -- Section 1: athlete and program details
  athlete_name TEXT NOT NULL,
  date_of_birth DATE,
  parent_name TEXT,
  phone TEXT,
  email TEXT,
  term_months INTEGER NOT NULL CHECK (term_months IN (6, 12)),
  training_type TEXT NOT NULL CHECK (training_type IN ('in_house', 'remote')),
  payment_option TEXT NOT NULL CHECK (payment_option IN ('upfront', 'monthly')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  -- Pre-tax price from the Section 2 table, resolved at signing so a later
  -- price change never rewrites what the athlete agreed to.
  price_cents INTEGER NOT NULL,
  monthly_cents INTEGER,

  -- Sections 2 / 3 / 4 initials
  initials_payment TEXT NOT NULL,
  initials_requirements TEXT NOT NULL,
  initials_early_stop TEXT NOT NULL,

  -- Section 10: athlete
  athlete_signature TEXT NOT NULL,
  athlete_signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Section 10: parent / guardian (required when the athlete is under 18)
  parent_signature TEXT,
  parent_printed_name TEXT,
  parent_relationship TEXT,
  parent_signed_at TIMESTAMPTZ,

  -- Section 10: NBP countersignature (staff, after the athlete signs)
  nbp_signature TEXT,
  nbp_printed_name TEXT,
  nbp_title TEXT,
  nbp_signed_at TIMESTAMPTZ,
  nbp_signed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_nbp_plus_agreements_user ON public.nbp_plus_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_nbp_plus_agreements_document ON public.nbp_plus_agreements(document_id);

ALTER TABLE public.nbp_plus_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nbp_plus_agreements_select ON public.nbp_plus_agreements;
CREATE POLICY nbp_plus_agreements_select ON public.nbp_plus_agreements
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS nbp_plus_agreements_insert ON public.nbp_plus_agreements;
CREATE POLICY nbp_plus_agreements_insert ON public.nbp_plus_agreements
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Only staff update, and only to countersign: the athlete's own fields are
-- fixed once signed.
DROP POLICY IF EXISTS nbp_plus_agreements_update ON public.nbp_plus_agreements;
CREATE POLICY nbp_plus_agreements_update ON public.nbp_plus_agreements
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS nbp_plus_agreements_delete ON public.nbp_plus_agreements;
CREATE POLICY nbp_plus_agreements_delete ON public.nbp_plus_agreements
  FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

GRANT ALL ON public.nbp_plus_agreements TO authenticated;
GRANT ALL ON public.nbp_plus_agreements TO service_role;

-- Athletes can't read staff_documents, so — as for the player contract and
-- the facility fine — open this one document (metadata + file) to every
-- signed-in user by title. The page matches the same pattern.
DROP POLICY IF EXISTS staff_documents_select_training_agreement_all ON public.staff_documents;
CREATE POLICY staff_documents_select_training_agreement_all ON public.staff_documents
  FOR SELECT TO authenticated
  USING (title ILIKE '%Athlete Training Agreement%');

DROP POLICY IF EXISTS staff_documents_storage_select_training_agreement_all ON storage.objects;
CREATE POLICY staff_documents_storage_select_training_agreement_all ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND EXISTS (
      SELECT 1 FROM public.staff_documents d
      WHERE d.file_path = storage.objects.name
        AND d.title ILIKE '%Athlete Training Agreement%'
    )
  );

-- Staff rollup for Manage Athletes / Training Groups: has each athlete signed
-- the CURRENT agreement? Staff-gated SECURITY DEFINER so the list doesn't
-- need to pull every agreement row client-side.
CREATE OR REPLACE FUNCTION public.nbp_plus_agreement_status(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, signed_at timestamptz, countersigned boolean, term_months integer, end_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH current_doc AS (
    SELECT id FROM public.staff_documents
    WHERE title ILIKE '%Athlete Training Agreement%'
    ORDER BY created_at DESC LIMIT 1
  )
  SELECT a.user_id, a.athlete_signed_at, a.nbp_signed_at IS NOT NULL, a.term_months, a.end_date
  FROM public.nbp_plus_agreements a
  WHERE a.user_id = ANY (p_user_ids)
    AND a.document_id = (SELECT id FROM current_doc)
    AND public.get_user_role() IN ('admin', 'coach');
$$;
REVOKE ALL ON FUNCTION public.nbp_plus_agreement_status(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.nbp_plus_agreement_status(uuid[]) TO authenticated;
