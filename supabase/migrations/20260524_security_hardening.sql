-- Security hardening from Supabase advisor findings.
-- Tighten permissive RLS, add missing policies, drop overly broad bucket listing, pin function search_path.

-- ============================================================
-- 1. assessment_submissions: replace WITH CHECK (true) policies
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert assessment submissions" ON public.assessment_submissions;
DROP POLICY IF EXISTS "Authenticated users can update assessment submissions" ON public.assessment_submissions;

CREATE POLICY "assessment_submissions_insert" ON public.assessment_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    assessed_by = auth.uid()
    OR public.get_user_role() IN ('admin', 'coach')
  );

CREATE POLICY "assessment_submissions_update" ON public.assessment_submissions
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

-- ============================================================
-- 2. workout_templates: tighten INSERT to staff who self-attribute
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert workout_templates" ON public.workout_templates;

CREATE POLICY "workout_templates_insert" ON public.workout_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.get_user_role() IN ('admin', 'coach')
  );

-- ============================================================
-- 3. ai_conversations + ai_messages: per-user ownership
-- ============================================================
GRANT ALL ON public.ai_conversations TO authenticated;
GRANT ALL ON public.ai_messages TO authenticated;

DROP POLICY IF EXISTS "ai_conversations_select" ON public.ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_insert" ON public.ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_update" ON public.ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_delete" ON public.ai_conversations;

CREATE POLICY "ai_conversations_select" ON public.ai_conversations
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "ai_conversations_insert" ON public.ai_conversations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "ai_conversations_update" ON public.ai_conversations
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "ai_conversations_delete" ON public.ai_conversations
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_messages_select" ON public.ai_messages;
DROP POLICY IF EXISTS "ai_messages_insert" ON public.ai_messages;
DROP POLICY IF EXISTS "ai_messages_delete" ON public.ai_messages;

CREATE POLICY "ai_messages_select" ON public.ai_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid())
  );

CREATE POLICY "ai_messages_insert" ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid())
  );

CREATE POLICY "ai_messages_delete" ON public.ai_messages
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid())
  );

-- ============================================================
-- 4. article_views: own-insert, own-or-admin select
-- ============================================================
GRANT ALL ON public.article_views TO authenticated;

DROP POLICY IF EXISTS "article_views_select" ON public.article_views;
DROP POLICY IF EXISTS "article_views_insert" ON public.article_views;

CREATE POLICY "article_views_insert" ON public.article_views
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "article_views_select" ON public.article_views
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.get_user_role() = 'admin');

-- ============================================================
-- 5. knowledge_articles + knowledge_categories: read for all, write admin
-- ============================================================
GRANT ALL ON public.knowledge_articles TO authenticated;
GRANT ALL ON public.knowledge_categories TO authenticated;

DROP POLICY IF EXISTS "knowledge_articles_select" ON public.knowledge_articles;
DROP POLICY IF EXISTS "knowledge_articles_write" ON public.knowledge_articles;
DROP POLICY IF EXISTS "knowledge_articles_insert" ON public.knowledge_articles;
DROP POLICY IF EXISTS "knowledge_articles_update" ON public.knowledge_articles;
DROP POLICY IF EXISTS "knowledge_articles_delete" ON public.knowledge_articles;

CREATE POLICY "knowledge_articles_select" ON public.knowledge_articles
  FOR SELECT TO authenticated
  USING (is_published OR public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY "knowledge_articles_insert" ON public.knowledge_articles
  FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "knowledge_articles_update" ON public.knowledge_articles
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "knowledge_articles_delete" ON public.knowledge_articles
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "knowledge_categories_select" ON public.knowledge_categories;
DROP POLICY IF EXISTS "knowledge_categories_insert" ON public.knowledge_categories;
DROP POLICY IF EXISTS "knowledge_categories_update" ON public.knowledge_categories;
DROP POLICY IF EXISTS "knowledge_categories_delete" ON public.knowledge_categories;

CREATE POLICY "knowledge_categories_select" ON public.knowledge_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "knowledge_categories_insert" ON public.knowledge_categories
  FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "knowledge_categories_update" ON public.knowledge_categories
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "knowledge_categories_delete" ON public.knowledge_categories
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');

-- ============================================================
-- 6. Drop overly broad SELECT policies on public buckets.
-- Public URLs still work via the CDN; this just stops anonymous list() calls.
-- ============================================================
DROP POLICY IF EXISTS "Allow Updates 1oj01fe_1" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read attachments" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view signatures" ON storage.objects;

-- ============================================================
-- 7. Pin function search_path to prevent role/schema-takeover attacks
-- ============================================================
ALTER FUNCTION public.get_user_role() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_conversation_participant(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.user_can_access_channel(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.staff_hour_entries_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.staff_time_off_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.staff_schedule_events_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.work_messages_bump_thread() SET search_path = public, pg_temp;
ALTER FUNCTION public.work_roadmap_items_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.staff_announcements_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.staff_documents_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.staff_pay_documents_set_updated_at() SET search_path = public, pg_temp;

-- ============================================================
-- 8. Revoke EXECUTE on RLS-helper SECURITY DEFINER functions so they
-- can't be called as RPCs. RLS policies still call them via the
-- table-owner chain (no EXECUTE needed for that).
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.user_can_access_channel(uuid, uuid) FROM anon, authenticated, public;
