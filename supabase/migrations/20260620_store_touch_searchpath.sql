-- Audit IM2: store_touch_updated_at is the only public trigger function
-- without an explicit search_path. Align with the other touch functions
-- (staff_*_set_updated_at) which all SET search_path = public, pg_temp.
-- Cosmetic / defense-in-depth — function is SECURITY INVOKER so the risk
-- is low, but a uniform style avoids someone copying this one as a template.

ALTER FUNCTION public.store_touch_updated_at() SET search_path = public, pg_temp;
