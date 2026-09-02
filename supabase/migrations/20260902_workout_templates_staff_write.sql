-- Issue #388 — admins and coaches cannot edit workout templates they did not create.
--
-- WHAT IS WRONG TODAY
--   public.workout_templates has an owner-only UPDATE policy: (created_by = auth.uid()).
--   There are 872 templates and only 2 distinct owners, so for all 8 admins and
--   25 coaches nearly every template belongs to somebody else. An UPDATE against
--   one of those comes back HTTP 200 with no error and ZERO rows changed —
--   PostgREST does not treat "the policy matched nothing" as an error — so the
--   screens that write templates either refuse up front (Exercise Video Gaps) or
--   would report a success that never happened.
--
-- WHAT THIS DOES
--   Adds ONE extra permissive UPDATE policy allowing any user whose
--   public.get_user_role() is 'admin' or 'coach' to update any workout_templates
--   row. That is the same helper and the same ARRAY['admin','coach'] test already
--   used by email_campaigns, package_usage, fields, outreach_log and others, so
--   this is the established "staff can do this" pattern in this database, not a
--   new mechanism.
--
--   Permissive RLS policies for the same command are OR-ed together, so ADDING a
--   policy can only widen access — the existing owner-only policy is left exactly
--   as it is and continues to let a creator edit their own template even if they
--   are neither admin nor coach. Nothing is dropped, nothing is narrowed.
--
-- WHAT THIS DOES *NOT* DO
--   DELETE is deliberately left owner-only. Not being able to edit somebody
--   else's template is an annoyance; being able to delete 872 templates you did
--   not create is not recoverable from the browser. If staff-wide delete is ever
--   wanted it should be its own reviewed migration.
--   SELECT and INSERT are untouched.
--
-- AFFECTS
--   public.workout_templates — UPDATE only. No table, column, index, data or
--   grant changes. No rows are read or written by this migration.
--
-- ADDITIVE AND REVERSIBLE
--   Safe to run more than once (the policy is dropped by name first).
--   To reverse, run exactly:
--
--       DROP POLICY IF EXISTS "workout_templates_update_staff" ON public.workout_templates;
--
--   Reversing restores the owner-only behaviour with no other side effects.
--
-- BEFORE RUNNING, CONFIRM (read-only, run by hand):
--   The reasoning above assumes the existing owner-only UPDATE policy is
--   PERMISSIVE. A RESTRICTIVE policy is AND-ed, not OR-ed, and this migration
--   would then change nothing. Check with:
--
--       SELECT policyname, permissive, cmd, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'workout_templates';
--
--   Every policy listed for UPDATE should say PERMISSIVE.

DROP POLICY IF EXISTS "workout_templates_update_staff" ON public.workout_templates;

CREATE POLICY "workout_templates_update_staff" ON public.workout_templates
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));
