-- =============================================================================
-- Messaging clean-up — let people actually delete a conversation and remove a
-- group-chat member
-- =============================================================================
--
-- WHY
-- "Delete conversation" and "Remove member" in the Communication screen look
-- like they work and then change nothing. The cause is not a bug in those
-- buttons: the messaging tables have row-level security switched on and NO
-- delete rules at all, so every delete quietly matches zero rows and reports
-- no error. The screen has been fixed in the same commit to stop claiming
-- success, but until these two rules exist the buttons cannot work for anyone.
--
-- WHAT THIS CHANGES, IN PLAIN ENGLISH
--   1. A conversation can be deleted by the person who started it, or by an
--      admin. Nobody else can delete it. Deleting the conversation also
--      removes its messages and its member list automatically — the database
--      is already set up to do that.
--   2. A person can be removed from a conversation by an admin or a coach,
--      and anyone can remove themselves from one. A regular athlete still
--      cannot remove anybody else.
--
-- WHAT COULD BREAK
--   * Nothing that works today stops working: these rules only ADD the ability
--     to delete, which currently does not exist at all.
--   * Deleting a conversation is permanent and takes its whole message history
--     with it. That is what the confirmation on screen already says.
--
-- NOT APPLIED. Run this in Supabase (SQL editor or migration deploy) after
-- review.
-- =============================================================================

-- 1. Conversations: the creator or an admin may delete.
--    get_user_role() is the same helper the existing update rule on this table
--    uses, so admin means the same thing here as everywhere else.
drop policy if exists "Creator or admin can delete conversations" on public.conversations;
create policy "Creator or admin can delete conversations"
  on public.conversations
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    or get_user_role() = 'admin'
  );

-- 2. Conversation members: staff may remove anyone; anyone may remove
--    themselves. Removing the last trace of a whole conversation is covered by
--    rule 1 above (the member list is cleared automatically with it).
drop policy if exists "Staff or self can remove participants" on public.conversation_participants;
create policy "Staff or self can remove participants"
  on public.conversation_participants
  for delete
  to authenticated
  using (
    get_user_role() in ('admin', 'coach')
    or user_id = auth.uid()
  );
