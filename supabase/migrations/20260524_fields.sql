-- Fields directory: shared list of practice/game venues with addresses for navigation.
-- Visible to all authenticated users; admin + coach can write.

CREATE TABLE IF NOT EXISTS public.fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.fields TO authenticated;

DROP POLICY IF EXISTS "fields_select_all" ON public.fields;
CREATE POLICY "fields_select_all" ON public.fields
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "fields_insert_staff" ON public.fields;
CREATE POLICY "fields_insert_staff" ON public.fields
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "fields_update_staff" ON public.fields;
CREATE POLICY "fields_update_staff" ON public.fields
  FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "fields_delete_staff" ON public.fields;
CREATE POLICY "fields_delete_staff" ON public.fields
  FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));
