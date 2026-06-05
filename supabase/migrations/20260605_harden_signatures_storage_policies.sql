-- Harden signatures storage policies.
-- Replaces broad authenticated read/update rules with owner-or-staff access.

DROP POLICY IF EXISTS "Anyone can view signatures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload signatures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update signatures" ON storage.objects;

DROP POLICY IF EXISTS "signatures_select_owner_or_staff" ON storage.objects;
DROP POLICY IF EXISTS "signatures_insert_owner_or_staff" ON storage.objects;
DROP POLICY IF EXISTS "signatures_update_owner_or_staff" ON storage.objects;
DROP POLICY IF EXISTS "signatures_delete_owner_or_staff" ON storage.objects;

CREATE POLICY "signatures_select_owner_or_staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'coach')
      )
    )
  );

CREATE POLICY "signatures_insert_owner_or_staff" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'coach')
      )
    )
  );

CREATE POLICY "signatures_update_owner_or_staff" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'coach')
      )
    )
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'coach')
      )
    )
  );

CREATE POLICY "signatures_delete_owner_or_staff" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'coach')
      )
    )
  );
