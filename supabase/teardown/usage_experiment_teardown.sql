-- TEARDOWN — V2 usage research experiment.
--
-- This file lives in supabase/teardown/ (NOT supabase/migrations/) so the
-- Supabase CLI / GitHub auto-runner does NOT apply it on push. Run it
-- manually when the 2-week window ends.
--
-- Steps in order:
--   1. Vercel: flip REACT_APP_USAGE_TRACKING from "1" to "0" (or delete) → redeploy
--   2. Wait until production deploy is live so no more inserts arrive
--   3. (Optional) Snapshot the data first if you want to keep it for analysis:
--        \copy (SELECT * FROM public.usage_events) TO '/tmp/usage_events.csv' WITH CSV HEADER;
--   4. Run this script via Supabase SQL editor or supabase db push --file=<this>
--   5. Run the code-side teardown checklist in supabase/teardown/README.md

DROP TRIGGER IF EXISTS prevent_role_escalation_trg ON public.usage_events;  -- defensive, no-op

DROP POLICY IF EXISTS usage_events_insert ON public.usage_events;
DROP POLICY IF EXISTS usage_events_admin_select ON public.usage_events;

REVOKE INSERT, SELECT ON public.usage_events FROM authenticated;
REVOKE USAGE, SELECT ON SEQUENCE public.usage_events_id_seq FROM authenticated;

DROP INDEX IF EXISTS public.idx_usage_events_occurred;
DROP INDEX IF EXISTS public.idx_usage_events_role_type;
DROP INDEX IF EXISTS public.idx_usage_events_name;

DROP TABLE IF EXISTS public.usage_events;
