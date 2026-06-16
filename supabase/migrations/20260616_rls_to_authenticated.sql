-- Defense-in-depth: pin RLS policies to the `authenticated` role so an
-- accidental future GRANT to anon doesn't silently widen access.
--
-- Recreates SELECT/INSERT/UPDATE/DELETE policies on the recently-added tables
-- (coach_invoices, schools, school_contacts, store_*) with TO authenticated.
-- Functional behavior is unchanged for authenticated users.

-- coach_invoices
DROP POLICY IF EXISTS "coach_invoices_select"            ON public.coach_invoices;
DROP POLICY IF EXISTS "coach_invoices_insert"            ON public.coach_invoices;
DROP POLICY IF EXISTS "coach_invoices_update"            ON public.coach_invoices;
DROP POLICY IF EXISTS "coach_invoices_delete"            ON public.coach_invoices;

CREATE POLICY "coach_invoices_select" ON public.coach_invoices
  FOR SELECT TO authenticated
  USING (coach_id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "coach_invoices_insert" ON public.coach_invoices
  FOR INSERT TO authenticated
  WITH CHECK (coach_id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "coach_invoices_update" ON public.coach_invoices
  FOR UPDATE TO authenticated
  USING      (coach_id = auth.uid() OR public.get_user_role() = 'admin')
  WITH CHECK (coach_id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "coach_invoices_delete" ON public.coach_invoices
  FOR DELETE TO authenticated
  USING ((coach_id = auth.uid() AND status IN ('submitted','rejected'))
         OR public.get_user_role() = 'admin');

-- schools (read-all for authenticated; staff writes)
DROP POLICY IF EXISTS schools_select ON public.schools;
DROP POLICY IF EXISTS schools_insert ON public.schools;
DROP POLICY IF EXISTS schools_update ON public.schools;
DROP POLICY IF EXISTS schools_delete ON public.schools;

CREATE POLICY schools_select ON public.schools
  FOR SELECT TO authenticated USING (true);
CREATE POLICY schools_insert ON public.schools
  FOR INSERT TO authenticated WITH CHECK (public.get_user_role() IN ('admin','coach'));
CREATE POLICY schools_update ON public.schools
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin','coach'))
  WITH CHECK (public.get_user_role() IN ('admin','coach'));
CREATE POLICY schools_delete ON public.schools
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');

-- school_contacts
DROP POLICY IF EXISTS school_contacts_select ON public.school_contacts;
DROP POLICY IF EXISTS school_contacts_insert ON public.school_contacts;
DROP POLICY IF EXISTS school_contacts_update ON public.school_contacts;
DROP POLICY IF EXISTS school_contacts_delete ON public.school_contacts;

CREATE POLICY school_contacts_select ON public.school_contacts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY school_contacts_insert ON public.school_contacts
  FOR INSERT TO authenticated WITH CHECK (public.get_user_role() IN ('admin','coach'));
CREATE POLICY school_contacts_update ON public.school_contacts
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin','coach'))
  WITH CHECK (public.get_user_role() IN ('admin','coach'));
CREATE POLICY school_contacts_delete ON public.school_contacts
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');

-- store_products
DROP POLICY IF EXISTS "store_products_select" ON public.store_products;
DROP POLICY IF EXISTS "store_products_insert" ON public.store_products;
DROP POLICY IF EXISTS "store_products_update" ON public.store_products;
DROP POLICY IF EXISTS "store_products_delete" ON public.store_products;

CREATE POLICY "store_products_select" ON public.store_products
  FOR SELECT TO authenticated
  USING (active = true OR public.get_user_role() = 'admin');
CREATE POLICY "store_products_insert" ON public.store_products
  FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY "store_products_update" ON public.store_products
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY "store_products_delete" ON public.store_products
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');

-- store_purchases
DROP POLICY IF EXISTS "store_purchases_select"        ON public.store_purchases;
DROP POLICY IF EXISTS "store_purchases_update_admin"  ON public.store_purchases;
DROP POLICY IF EXISTS "store_purchases_delete_admin"  ON public.store_purchases;

CREATE POLICY "store_purchases_select" ON public.store_purchases
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.get_user_role() = 'admin');
CREATE POLICY "store_purchases_update_admin" ON public.store_purchases
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY "store_purchases_delete_admin" ON public.store_purchases
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');

-- store_discounts
DROP POLICY IF EXISTS "store_discounts_select" ON public.store_discounts;
DROP POLICY IF EXISTS "store_discounts_write_admin" ON public.store_discounts;

CREATE POLICY "store_discounts_select" ON public.store_discounts
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');
CREATE POLICY "store_discounts_write_admin" ON public.store_discounts
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- store_webhook_events
DROP POLICY IF EXISTS "store_webhook_events_select" ON public.store_webhook_events;
CREATE POLICY "store_webhook_events_select" ON public.store_webhook_events
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

-- store_backfill_runs
DROP POLICY IF EXISTS "store_backfill_runs_select_admin" ON public.store_backfill_runs;
DROP POLICY IF EXISTS "store_backfill_runs_write_admin"  ON public.store_backfill_runs;

CREATE POLICY "store_backfill_runs_select_admin" ON public.store_backfill_runs
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');
CREATE POLICY "store_backfill_runs_write_admin" ON public.store_backfill_runs
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
