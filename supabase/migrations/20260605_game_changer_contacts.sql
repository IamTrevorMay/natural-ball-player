-- Issue #187: per-team Game Changer contact directory (parents/coaches who run
-- the Game Changer scoring app). Surfaced in MyTeam under a new "Game Changer"
-- tab next to Prospects.

CREATE TABLE IF NOT EXISTS public.team_game_changer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Parent' CHECK (role IN ('Parent', 'Coach', 'Manager', 'Other')),
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_game_changer_contacts_team_id
  ON public.team_game_changer_contacts(team_id);

ALTER TABLE public.team_game_changer_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_gc_contacts_select" ON public.team_game_changer_contacts;
CREATE POLICY "team_gc_contacts_select" ON public.team_game_changer_contacts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "team_gc_contacts_insert" ON public.team_game_changer_contacts;
CREATE POLICY "team_gc_contacts_insert" ON public.team_game_changer_contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "team_gc_contacts_update" ON public.team_game_changer_contacts;
CREATE POLICY "team_gc_contacts_update" ON public.team_game_changer_contacts
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "team_gc_contacts_delete" ON public.team_game_changer_contacts;
CREATE POLICY "team_gc_contacts_delete" ON public.team_game_changer_contacts
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

GRANT ALL ON public.team_game_changer_contacts TO authenticated;
