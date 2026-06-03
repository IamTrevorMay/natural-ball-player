-- Issue #162: School / Coach Contact Directory
-- Two tables: schools (the institution) and school_contacts (coaching staff)

-- ── schools ──────────────────────────────────────────────────────────────────

CREATE TABLE public.schools (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  level      TEXT NOT NULL,            -- D1, D2, D3, NAIA, JUCO
  state      TEXT,
  city       TEXT,
  conference TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schools_select" ON public.schools
  FOR SELECT USING (true);

CREATE POLICY "schools_insert" ON public.schools
  FOR INSERT WITH CHECK (
    public.get_user_role() IN ('admin', 'coach')
  );

CREATE POLICY "schools_update" ON public.schools
  FOR UPDATE USING (
    public.get_user_role() IN ('admin', 'coach')
  ) WITH CHECK (
    public.get_user_role() IN ('admin', 'coach')
  );

CREATE POLICY "schools_delete" ON public.schools
  FOR DELETE USING (
    public.get_user_role() IN ('admin', 'coach')
  );

GRANT ALL ON public.schools TO authenticated;

-- ── school_contacts ──────────────────────────────────────────────────────────

CREATE TABLE public.school_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  title      TEXT,                     -- Head Coach, Pitching Coach, etc.
  email      TEXT,
  phone      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.school_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_contacts_select" ON public.school_contacts
  FOR SELECT USING (true);

CREATE POLICY "school_contacts_insert" ON public.school_contacts
  FOR INSERT WITH CHECK (
    public.get_user_role() IN ('admin', 'coach')
  );

CREATE POLICY "school_contacts_update" ON public.school_contacts
  FOR UPDATE USING (
    public.get_user_role() IN ('admin', 'coach')
  ) WITH CHECK (
    public.get_user_role() IN ('admin', 'coach')
  );

CREATE POLICY "school_contacts_delete" ON public.school_contacts
  FOR DELETE USING (
    public.get_user_role() IN ('admin', 'coach')
  );

GRANT ALL ON public.school_contacts TO authenticated;
