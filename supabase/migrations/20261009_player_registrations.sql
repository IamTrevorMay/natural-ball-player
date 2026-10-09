-- =====================================================================
-- Issue #447 — Tournament registration proof (Perfect Game, Top Tier).
--
-- Cordell: tournament directors and opposing teams could not find some of
-- our players when they looked them up, so "add an upload attachment
-- button of each player's registration for both tournaments with a
-- hyperlink option for web profile to those sites".
--
-- One row per athlete per site (perfect_game / top_tier). A row carries a
-- link to the athlete's public profile on that site and/or a proof file
-- (screenshot / PDF of the registration) in the private 'registrations'
-- bucket under {player_id}/... so the storage policies can defer to the
-- folder name like 'external-stats' and 'bloodwork' do.
--
-- Access: an athlete manages their OWN rows and files; admin + coach
-- manage everyone's. Nothing is public. Surfaced on the profile at
-- Records → Registration, and as a roster in Coach Tools → Registrations.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.player_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  site text NOT NULL CHECK (site IN ('perfect_game', 'top_tier')),
  profile_url text,           -- link to the athlete's profile on that site
  file_url text,              -- storage path in the registrations bucket
  file_name text,
  notes text,                 -- e.g. "PG ID 123456", "registered under Jr."
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_registrations_one_per_site UNIQUE (player_id, site),
  CONSTRAINT player_registrations_has_content CHECK (profile_url IS NOT NULL OR file_url IS NOT NULL)
);

ALTER TABLE public.player_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_registrations_select ON public.player_registrations;
CREATE POLICY player_registrations_select ON public.player_registrations
  FOR SELECT TO authenticated
  USING (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS player_registrations_insert ON public.player_registrations;
CREATE POLICY player_registrations_insert ON public.player_registrations
  FOR INSERT TO authenticated
  WITH CHECK (
    updated_by = (SELECT auth.uid())
    AND (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'))
  );

DROP POLICY IF EXISTS player_registrations_update ON public.player_registrations;
CREATE POLICY player_registrations_update ON public.player_registrations
  FOR UPDATE TO authenticated
  USING (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS player_registrations_delete ON public.player_registrations;
CREATE POLICY player_registrations_delete ON public.player_registrations
  FOR DELETE TO authenticated
  USING (player_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

GRANT ALL ON public.player_registrations TO authenticated;
GRANT ALL ON public.player_registrations TO service_role;

-- Private bucket. Proof is a screenshot or a PDF of the registration page.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'registrations', 'registrations', false, 15728640,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Registration files read" ON storage.objects;
CREATE POLICY "Registration files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'registrations'
    AND (public.get_user_role() IN ('admin', 'coach')
         OR (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  );

DROP POLICY IF EXISTS "Registration files write" ON storage.objects;
CREATE POLICY "Registration files write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'registrations'
    AND (public.get_user_role() IN ('admin', 'coach')
         OR (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  );

DROP POLICY IF EXISTS "Registration files delete" ON storage.objects;
CREATE POLICY "Registration files delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'registrations'
    AND (public.get_user_role() IN ('admin', 'coach')
         OR (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  );

COMMENT ON TABLE public.player_registrations IS
  '#447: per-athlete Perfect Game / Top Tier registration proof — profile link and/or a file in the registrations bucket. One row per athlete per site.';
