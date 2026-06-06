-- Issue #193: Marek bloodwork panel tab. Stores blood-panel uploads per
-- player so coaches can use bloodwork to inform programming for 18+ athletes.
--
-- Files live in the existing 'staff-documents' bucket pattern (we'll add a
-- separate 'bloodwork' bucket via Storage UI). This table holds metadata.

CREATE TABLE IF NOT EXISTS public.marek_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  panel_date DATE NOT NULL,
  panel_type TEXT,
  file_url TEXT,
  file_name TEXT,
  summary TEXT,
  results JSONB DEFAULT '{}'::jsonb,
  follow_up_at DATE,
  uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marek_panels_player_date
  ON public.marek_panels(player_id, panel_date DESC);

ALTER TABLE public.marek_panels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marek_panels_select" ON public.marek_panels;
CREATE POLICY "marek_panels_select" ON public.marek_panels
  FOR SELECT TO authenticated
  USING (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "marek_panels_insert" ON public.marek_panels;
CREATE POLICY "marek_panels_insert" ON public.marek_panels
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "marek_panels_update" ON public.marek_panels;
CREATE POLICY "marek_panels_update" ON public.marek_panels
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "marek_panels_delete" ON public.marek_panels;
CREATE POLICY "marek_panels_delete" ON public.marek_panels
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

GRANT ALL ON public.marek_panels TO authenticated;
