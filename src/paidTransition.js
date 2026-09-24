// What a MANUAL "this was paid" write puts on a store_purchases row (#306).
//
// There are now four places a purchase can be marked paid by a person:
// the Purchases tab's per-row button, its bulk action, and the Reconcile
// Pending confirm (WorkStore.js, InvoiceReconcile.js) — plus the Square
// webhook, which is the only automatic one. Until 2026-09-23 the manual
// paths wrote status + paid_at and nothing else, so a lesson pack settled
// by hand never got its expiry clock started and, if it was created before
// its product had a session count, never got a remaining_qty either. The
// webhook did both. Cordell's rule (#306, 2026-08-25) is that the clock
// starts the day they paid, June included, so every paid path must agree.
//
// This mirrors supabase/functions/square-webhook/index.ts's paid transition
// and supabase/functions/_shared/packageExpiry.ts's rule (via
// packageExtension.BUNDLE_TERM_DAYS, the CRA-side copy of that table):
//
//   status        -> 'paid'
//   paid_at       -> the date given (never "now" by default — the caller
//                    decides what it knows about when money moved)
//   expires_at    -> paid_at + the 5/10/20 -> 60/120/180 term, ONLY when
//                    the row has no expiry yet and the pack size has a term
//   remaining_qty -> the product's bundle_qty, ONLY when the row has none
//
// Neither expires_at nor remaining_qty is ever overwritten: an expiry an
// admin set by hand, or a count that has already been decremented, wins.
// A bundle_qty with no term (1, 50, null) starts no clock — same as the
// webhook.
import { termDaysForBundleQty } from './packageExtension';

export function manualPaidPatch({ row, bundleQty, paidAt }) {
  const paidIso = paidAt instanceof Date ? paidAt.toISOString() : paidAt;
  const patch = { status: 'paid', paid_at: paidIso };
  const qty = bundleQty ?? row?.store_products?.bundle_qty ?? null;
  if (row?.expires_at == null) {
    const days = termDaysForBundleQty(qty);
    if (days) patch.expires_at = new Date(new Date(paidIso).getTime() + days * 86400000).toISOString();
  }
  if (row?.remaining_qty == null && qty != null) patch.remaining_qty = qty;
  return patch;
}
