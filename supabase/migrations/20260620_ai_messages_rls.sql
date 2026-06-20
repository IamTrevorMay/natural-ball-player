-- Audit H8: ai_messages SELECT/INSERT/DELETE policies used inline
-- EXISTS(...) into public.ai_conversations, which itself has RLS. Per the
-- project's RLS rule (CLAUDE.md), recursive policies should go through a
-- SECURITY DEFINER helper that bypasses the inner table's RLS.
--
-- is_conversation_participant() already exists but queries the unrelated
-- conversation_participants table. Add a dedicated helper for the AI
-- chat feature and rewrite the three ai_messages policies to call it.

CREATE OR REPLACE FUNCTION public.is_ai_conversation_owner(conv_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ai_conversations
    WHERE id = conv_id AND user_id = uid
  );
$$;

REVOKE ALL ON FUNCTION public.is_ai_conversation_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ai_conversation_owner(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "ai_messages_select" ON public.ai_messages;
DROP POLICY IF EXISTS "ai_messages_insert" ON public.ai_messages;
DROP POLICY IF EXISTS "ai_messages_delete" ON public.ai_messages;

CREATE POLICY "ai_messages_select" ON public.ai_messages
  FOR SELECT TO authenticated
  USING (public.is_ai_conversation_owner(conversation_id, auth.uid()));

CREATE POLICY "ai_messages_insert" ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.is_ai_conversation_owner(conversation_id, auth.uid()));

CREATE POLICY "ai_messages_delete" ON public.ai_messages
  FOR DELETE TO authenticated
  USING (public.is_ai_conversation_owner(conversation_id, auth.uid()));
