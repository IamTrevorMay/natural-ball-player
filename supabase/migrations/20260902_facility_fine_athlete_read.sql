-- #378 — "the facility fine document has no document for athletes to sign digitally"
--
-- WHAT IS ACTUALLY WRONG
-- The signing flow already exists (#189: src/FacilityFinePage.js, the
-- facility_fine_signatures table, the Documents sidebar entry in App.js) and it
-- is routed for every role. What athletes cannot do is SEE the document.
--
-- FacilityFinePage finds the document by querying public.staff_documents for a
-- title starting 'Facility Fine', then asks Storage for a signed URL to that
-- row's file_path in the 'staff-documents' bucket. Both of those are Work
-- Portal resources: CLAUDE.md line 69 lists `staff_documents` + the
-- `staff-documents` bucket under "Work Portal tables (coach + admin only) ...
-- Players cannot access these", described as "admin write, staff read".
--
-- So for a player:
--   * the staff_documents lookup returns zero rows (RLS, not an error), and
--   * FacilityFinePage renders "No facility fine document uploaded yet", and
--   * App.js checkFacilityFineStatus sees no document and marks the user as
--     signed, so there is not even a red dot to nag them.
-- Which is exactly the screen in Emmett's photo.
--
-- WHAT THIS MIGRATION DOES
-- Adds two NEW, additively-named PERMISSIVE policies so that every signed-in
-- user can read the Facility Fine document and nothing else in the staff
-- handbook. Postgres ORs permissive policies together, so this can only widen
-- access, never narrow it, and it does not touch or rename any existing
-- staff_documents / storage policy.
--
--   1. public.staff_documents      — SELECT, rows whose title starts 'Facility Fine'
--   2. storage.objects             — SELECT, objects in bucket 'staff-documents'
--                                    that are the file of such a row
--
-- It does NOT grant insert/update/delete to anyone, and it does NOT expose any
-- other handbook or SOP document.
--
-- PREREQUISITE
-- supabase/migrations/20260606_facility_fine_signatures.sql (and its two
-- follow-ups, 20260616_..._nulls_not_distinct.sql and
-- 20260620_..._update.sql) must already have been run. Those create
-- facility_fine_signatures with the own-row insert/select/update policies and
-- the public.get_user_role() IN ('admin','coach') staff read. This migration
-- adds nothing to that table — verified below with a no-op assertion so a
-- half-migrated database fails loudly here instead of silently at runtime.
--
-- SAFE TO RE-RUN: every statement is DROP ... IF EXISTS + CREATE, or a guarded
-- DO block. Running it twice changes nothing.
--
-- DO NOT RUN THIS AUTOMATICALLY. A human reviews it, then runs it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Fail loudly if the #189 tables are not there yet, rather than half-applying.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff_documents'
  ) THEN
    RAISE EXCEPTION 'public.staff_documents does not exist — nothing to widen. Aborting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'facility_fine_signatures'
  ) THEN
    RAISE EXCEPTION 'public.facility_fine_signatures does not exist — run 20260606_facility_fine_signatures.sql first. Aborting.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Let every signed-in user read ONLY the Facility Fine document row.
--    Staff keep whatever read policy they already have; this ORs onto it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_documents_select_facility_fine_all" ON public.staff_documents;
CREATE POLICY "staff_documents_select_facility_fine_all" ON public.staff_documents
  FOR SELECT TO authenticated
  USING (title ILIKE 'Facility Fine%');

-- ---------------------------------------------------------------------------
-- 2. Let every signed-in user read ONLY that document's file in Storage.
--    Matched by file_path so a file that is not the Facility Fine document
--    stays invisible even if it sits in the same bucket.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_documents_storage_select_facility_fine_all" ON storage.objects;
CREATE POLICY "staff_documents_storage_select_facility_fine_all" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND EXISTS (
      SELECT 1
      FROM public.staff_documents d
      WHERE d.file_path = storage.objects.name
        AND d.title ILIKE 'Facility Fine%'
    )
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- REVERSAL — run exactly these two statements to put things back.
-- They remove only the policies this migration added; every pre-existing
-- staff-only policy is untouched, so athletes lose sight of the document and
-- staff keep theirs.
--
--   DROP POLICY IF EXISTS "staff_documents_select_facility_fine_all" ON public.staff_documents;
--   DROP POLICY IF EXISTS "staff_documents_storage_select_facility_fine_all" ON storage.objects;
--
-- ---------------------------------------------------------------------------
-- HOW TO VERIFY AFTER RUNNING (as a player account, from the app):
--   * Documents -> Facility Fine shows the PDF, not the amber "not uploaded" box.
--   * Signing writes one facility_fine_signatures row and the page flips to
--     the green "Signed" state on reload.
--   * Work Portal -> Documents for a player is still inaccessible, and no other
--     handbook document is visible anywhere.
-- ---------------------------------------------------------------------------
