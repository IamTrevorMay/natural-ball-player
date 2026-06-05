-- Issue #184: deleting an athlete fails with
-- "new row for relation communication_logs violates check constraint chk_recipient_set".
-- Root cause: communication_logs.player_id FK was ON DELETE SET NULL, but the row
-- also has chk_recipient_set requiring player_id OR prospect_id be non-null. When a
-- user is deleted, the cascade nulls player_id, and if prospect_id is already null
-- the CHECK rejects the update and the whole delete rolls back.
--
-- Fix: switch player_id and prospect_id FKs to ON DELETE CASCADE so log rows are
-- removed alongside the deleted user/prospect. Communication history for the
-- removed party is dropped intentionally.

ALTER TABLE public.communication_logs
  DROP CONSTRAINT IF EXISTS communication_logs_player_id_fkey;

ALTER TABLE public.communication_logs
  ADD CONSTRAINT communication_logs_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.communication_logs
  DROP CONSTRAINT IF EXISTS communication_logs_prospect_id_fkey;

ALTER TABLE public.communication_logs
  ADD CONSTRAINT communication_logs_prospect_id_fkey
  FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;
