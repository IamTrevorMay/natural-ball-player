// Session-pack expiry rule, keyed by bundle_qty (#298). Shared by
// square-checkout (which no longer uses it directly — see square-checkout's
// own comment) and square-webhook, which is the only place that actually
// starts the clock. ONE definition here so the two functions can't drift.
//
// Any bundle_qty not listed (or no bundle_qty at all) gets no expiry.
export const BUNDLE_EXPIRY_DAYS: Record<number, number> = {
  5: 60,
  10: 120,
  20: 180,
};

// Returns an ISO expiry timestamp anchored to `startDate`, or null when
// bundleQty is missing or has no mapped expiry (e.g. an uncounted product,
// or a bundle_qty outside the 5/10/20 rule).
export function computeExpiresAt(bundleQty: number | null | undefined, startDate: Date): string | null {
  if (bundleQty == null) return null;
  const days = BUNDLE_EXPIRY_DAYS[bundleQty];
  if (!days) return null;
  return new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
