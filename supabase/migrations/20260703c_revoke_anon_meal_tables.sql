-- Security audit (#229 / public /book page). The anon (unauthenticated) role
-- could SELECT the meal / nutrition tables: an old blanket `GRANT ... TO anon`
-- combined with `USING (true)` "Coaches can select" policies meant those four
-- tables were world-readable via the public anon key (which the /book page
-- ships). Every other main-portal table is protected because its policies key
-- on auth.uid() / get_user_role(), which are null for anon.
--
-- Fix: remove anon access to these tables. Authenticated players/coaches keep
-- access via their own grants + the same policies. Applied to prod 2026-07-03.
revoke all on meals from anon;
revoke all on meal_plans from anon;
revoke all on meal_plan_items from anon;
revoke all on meal_plan_assignments from anon;
