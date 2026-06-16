-- Postgres treats multiple NULLs as DISTINCT by default, so the
-- (user_id, document_id) UNIQUE didn't prevent a user from signing more than
-- once when document_id was null. Switch to NULLS NOT DISTINCT so any NULL
-- document_id is treated as a single slot per user.
ALTER TABLE public.facility_fine_signatures
  DROP CONSTRAINT IF EXISTS facility_fine_signatures_user_id_document_id_key;

ALTER TABLE public.facility_fine_signatures
  ADD CONSTRAINT facility_fine_signatures_user_id_document_id_key
  UNIQUE NULLS NOT DISTINCT (user_id, document_id);
