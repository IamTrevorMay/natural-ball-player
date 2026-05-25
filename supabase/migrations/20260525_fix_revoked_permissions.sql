-- Fix: Restore EXECUTE permissions on RLS-helper functions.
-- The 20260524_security_hardening migration incorrectly revoked EXECUTE from
-- authenticated, breaking ALL tables whose RLS policies call these functions.
-- RLS policies evaluate in the session user's context, so the caller DOES need
-- EXECUTE permission even though the functions are SECURITY DEFINER.

-- ============================================================
-- 1. Restore EXECUTE on RLS helper functions
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_channel(uuid, uuid) TO authenticated;

-- ============================================================
-- 2. Restore storage policies dropped in section 6 of hardening.
-- These were originally created via the Supabase Dashboard.
-- ============================================================

-- Signatures bucket: players upload signatures during contract/waiver/LOI signing;
-- staff need to read them for verification.
CREATE POLICY "Anyone can view signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures');

-- Signatures bucket: authenticated users upload their own signature images.
CREATE POLICY "Authenticated users can upload signatures" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'signatures');

-- Restore update policy for signatures (the dropped "Allow Updates 1oj01fe_1")
CREATE POLICY "Authenticated users can update signatures" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'signatures')
  WITH CHECK (bucket_id = 'signatures');
