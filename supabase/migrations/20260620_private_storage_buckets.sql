-- Audit IC3/IC4/IH1/IH2: flip signatures + message-attachments buckets to
-- private, drop the bucket-match-only "Anyone can view" + loose
-- INSERT/UPDATE policies, and replace with own-folder + staff-override
-- policies. The signatures bucket already has a per-user INSERT policy
-- ("Users can upload own signatures") and the client already uses
-- createSignedUrl via SignedSignatureImage, so reads keep working.

UPDATE storage.buckets
  SET public = false
  WHERE id IN ('signatures', 'message-attachments');

-- Drop loose signatures policies
DROP POLICY IF EXISTS "Anyone can view signatures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload signatures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update signatures" ON storage.objects;

-- Tight per-user signatures policies (own folder + staff read-all + admin delete-all)
DROP POLICY IF EXISTS "signatures_select_own_or_staff" ON storage.objects;
CREATE POLICY "signatures_select_own_or_staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.get_user_role() IN ('admin', 'coach')
    )
  );

DROP POLICY IF EXISTS "signatures_update_own" ON storage.objects;
CREATE POLICY "signatures_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "signatures_delete_own_or_admin" ON storage.objects;
CREATE POLICY "signatures_delete_own_or_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.get_user_role() = 'admin'
    )
  );

-- message-attachments: bucket already had an own-folder INSERT and DELETE
-- policy. Now that it's private, add a SELECT policy gated by own folder
-- (sender) + staff override. No client code currently reads this bucket
-- but the policy hardens for future use.
DROP POLICY IF EXISTS "message_attachments_select_own_or_staff" ON storage.objects;
CREATE POLICY "message_attachments_select_own_or_staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.get_user_role() IN ('admin', 'coach')
    )
  );
