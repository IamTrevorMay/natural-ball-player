-- Issue #142: persist every subscription-backfill run so admins can review
-- unmatched rows later and resolve them by assigning a portal user.

CREATE TABLE IF NOT EXISTS public.store_backfill_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at                 timestamptz NOT NULL DEFAULT now(),
  ran_by                 uuid REFERENCES public.users(id) ON DELETE SET NULL,
  total_square_subs      integer NOT NULL DEFAULT 0,
  inserted               integer NOT NULL DEFAULT 0,
  updated                integer NOT NULL DEFAULT 0,
  products_auto_created  integer NOT NULL DEFAULT 0,
  unmatched_user         integer NOT NULL DEFAULT 0,
  unmatched_product      integer NOT NULL DEFAULT 0,
  unmatched              jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS store_backfill_runs_ran_at_idx
  ON public.store_backfill_runs (ran_at DESC);

ALTER TABLE public.store_backfill_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_backfill_runs_select_admin" ON public.store_backfill_runs;
CREATE POLICY "store_backfill_runs_select_admin" ON public.store_backfill_runs
  FOR SELECT
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "store_backfill_runs_write_admin" ON public.store_backfill_runs;
CREATE POLICY "store_backfill_runs_write_admin" ON public.store_backfill_runs
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_backfill_runs TO authenticated;
GRANT ALL                            ON public.store_backfill_runs TO service_role;
