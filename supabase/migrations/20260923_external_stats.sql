-- =====================================================================
-- Issue #421 — External stats uploads (GameChanger, Perfect Game,
-- MaxPreps, PBR, other).
--
-- Cordell: "input a button for players to upload their external stats
-- ... from game changer, perfect game, max preps, pbr and any other ...
-- so nbp staff and players can work with real time game numbers".
--
-- One row per upload. An entry carries a source, an optional profile
-- link, and/or an optional file (stat export PDF/CSV/screenshot) stored
-- in the private 'external-stats' bucket under {player_id}/... so the
-- storage policies can defer to the folder name like 'bloodwork' does.
--
-- Access: an athlete manages (read/insert/update/delete) their OWN rows
-- and files; admin + coach manage everyone's. Nothing is public.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.external_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('gamechanger', 'perfect_game', 'maxpreps', 'pbr', 'other')),
  source_label text,          -- free text when source = 'other'
  title text,                 -- e.g. "2026 Spring season"
  season text,                -- e.g. "Spring 2026"
  profile_url text,           -- link to the external profile / stat page
  file_url text,              -- storage path in the external-stats bucket
  file_name text,
  notes text,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_stats_has_content CHECK (profile_url IS NOT NULL OR file_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_external_stats_player_created
  ON public.external_stats (player_id, created_at DESC);

ALTER TABLE public.external_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_stats_select ON public.external_stats;
CREATE POLICY external_stats_select ON public.external_stats
  FOR SELECT TO authenticated
  USING (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS external_stats_insert ON public.external_stats;
CREATE POLICY external_stats_insert ON public.external_stats
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'))
  );

DROP POLICY IF EXISTS external_stats_update ON public.external_stats;
CREATE POLICY external_stats_update ON public.external_stats
  FOR UPDATE TO authenticated
  USING (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS external_stats_delete ON public.external_stats;
CREATE POLICY external_stats_delete ON public.external_stats
  FOR DELETE TO authenticated
  USING (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

GRANT ALL ON public.external_stats TO authenticated;
GRANT ALL ON public.external_stats TO service_role;

-- Private bucket. Stat exports are PDFs, spreadsheets/CSVs, or screenshots.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'external-stats', 'external-stats', false, 26214400,
  ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/heic',
    'text/csv', 'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Files live at {player_id}/{timestamp}-{name}; the first folder segment is
-- the owner. Same shape as the bloodwork bucket policies.
DROP POLICY IF EXISTS "External stats files read" ON storage.objects;
CREATE POLICY "External stats files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'external-stats'
    AND (public.get_user_role() IN ('admin', 'coach')
         OR (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  );

DROP POLICY IF EXISTS "External stats files write" ON storage.objects;
CREATE POLICY "External stats files write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'external-stats'
    AND (public.get_user_role() IN ('admin', 'coach')
         OR (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  );

DROP POLICY IF EXISTS "External stats files delete" ON storage.objects;
CREATE POLICY "External stats files delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'external-stats'
    AND (public.get_user_role() IN ('admin', 'coach')
         OR (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  );

COMMENT ON TABLE public.external_stats IS
  '#421: athlete-uploaded external stats (GameChanger / Perfect Game / MaxPreps / PBR / other) — a profile link and/or a file in the external-stats bucket.';
