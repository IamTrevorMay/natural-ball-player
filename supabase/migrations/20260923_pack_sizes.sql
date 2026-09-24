-- =====================================================================
-- Issue #306 — load the pack sizes from "NBP - how many sessions per
-- package.xlsx" (2026-08-15) into store_products.bundle_qty.
--
-- Of the 74 real packages on that sheet, 68 answered themselves and 6 were
-- answered by Cordell on 2026-08-25. Read against the live catalogue on
-- 2026-09-23 this reduces to a much smaller change than the sheet implies:
--
--   * Every "N Pack of ..." product already carries bundle_qty = N
--     (15 products). Nothing to do.
--   * Recurring programmes / memberships (kind='package') stay
--     bundle_qty NULL, which the app already reads as unlimited.
--   * Team deposits, fines and discounts stay NULL — not session packs.
--   * Cordell's 6 answers are all WEEKLY allowances ("4 S&C + 1 skills a
--     week"), not buckets that empty. A weekly allowance has no bundle_qty;
--     it is the weekly-cap rule in src/bookingCaps.js. They stay NULL here.
--   * That leaves the one-off sessions the sheet marked "Probably 1":
--       One Assessment Session          (96 purchases, 89 still pending)
--       No School Day Camp              (1 purchase)
--       Biolab Motion Capture Assessment (0 purchases)
--     These are the ONLY products this migration changes.
--
-- A bundle_qty of 1 has no entry in the 5/10/20 -> 60/120/180 expiry rule,
-- so setting it starts no expiry clock. It only lets the ledger count the
-- session off when the athlete is marked Present.
-- =====================================================================

-- 1. Product session counts. Matched on family_key so a "(MONTHLY price)"
--    twin, if Square ever exports one, is covered too. Only rows with no
--    count already set are touched.
UPDATE public.store_products
   SET bundle_qty = 1,
       updated_at = now()
 WHERE bundle_qty IS NULL
   AND family_key IN (
     'one assessment session',
     'no school day camp',
     'biolab motion capture assessment'
   );

-- 2. Backfill remaining_qty on purchases of ANY counted product where it was
--    never set. square-checkout copies bundle_qty into remaining_qty at
--    insert, but rows created before a product had a count (and rows
--    created by paths that did not copy it) have NULL, which the booking
--    gate reads as "not a pack". remaining = bundle_qty minus sessions
--    already logged against the purchase, floored at 0.
--
--    Terminal rows (canceled / refunded / failed) are left alone — nothing
--    reads their remaining_qty and rewriting history helps nobody.
UPDATE public.store_purchases sp
   SET remaining_qty = GREATEST(
         p.bundle_qty - COALESCE((
           SELECT count(*) FROM public.store_session_usage u
            WHERE u.purchase_id = sp.id
         ), 0),
         0
       ),
       updated_at = now()
  FROM public.store_products p
 WHERE p.id = sp.product_id
   AND p.bundle_qty IS NOT NULL
   AND sp.remaining_qty IS NULL
   AND sp.status IN ('pending', 'paid', 'active', 'past_due');

-- ---------------------------------------------------------------------
-- CHECK IT WORKED.
--   Expect: the three products at bundle_qty = 1, and zero live purchases
--   of a counted product with remaining_qty NULL.
-- ---------------------------------------------------------------------
SELECT name, bundle_qty FROM public.store_products
 WHERE family_key IN ('one assessment session','no school day camp','biolab motion capture assessment');

SELECT count(*) AS live_counted_purchases_missing_remaining
  FROM public.store_purchases sp
  JOIN public.store_products p ON p.id = sp.product_id
 WHERE p.bundle_qty IS NOT NULL
   AND sp.remaining_qty IS NULL
   AND sp.status IN ('pending', 'paid', 'active', 'past_due');

-- =====================================================================
-- HOW TO UNDO — the product change only; remaining_qty was NULL before and
-- can be nulled back with the same WHERE if needed.
-- =====================================================================
--   UPDATE public.store_products SET bundle_qty = NULL
--    WHERE family_key IN ('one assessment session','no school day camp','biolab motion capture assessment');
