-- Audit IC1/IC2: avatars UPDATE + INSERT policies were `bucket_id = 'avatars'`
-- with no folder/auth check, so any authenticated user could overwrite anyone
-- else's avatar. Drop both, replace with own-folder + admin override. SELECT
-- remains anonymous (bucket stays public — avatars are intentionally so).
-- Upload path convention is `${auth.uid()}/${timestamp}.ext` (Profile.js).

DROP POLICY IF EXISTS "Allow Updates 1oj01fe_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow Uploads 1oj01fe_0" ON storage.objects;

DROP POLICY IF EXISTS "avatars_insert_own_or_admin" ON storage.objects;
CREATE POLICY "avatars_insert_own_or_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.get_user_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "avatars_update_own_or_admin" ON storage.objects;
CREATE POLICY "avatars_update_own_or_admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.get_user_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "avatars_delete_own_or_admin" ON storage.objects;
CREATE POLICY "avatars_delete_own_or_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.get_user_role() = 'admin'
    )
  );
