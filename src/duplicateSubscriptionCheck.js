// #344: the pre-flight duplicate check for assigning a payment to an athlete.
//
// WHY THIS EXISTS, IN THE OWNER'S OWN WORDS:
//   "This issue was caused by coaches / admins assigning one team payment from
//    the square dashboard and another assigning the same team payment from the
//    players profile dashboard on the NBP web app."
//
// So there are two write paths into the same real-world subscription — Square's
// own dashboard and this portal — and nothing has ever compared them. 22
// athletes ended up carrying 26 more live subscriptions than they should, and
// EVERY ONE of those duplicates was a team deposit or team fee. Not one was a
// training programme.
//
// The approved fix shape is warn, never block: "warn (don't block) on assigning
// a duplicate, and show every package ever bought with which are active." The
// person doing the assigning is usually the owner, and he sometimes has a
// legitimate reason — one athlete really is paying the same annual team fee
// four times, because the family paid four years upfront. So this module's job
// is to hand him the facts, not to overrule him.
//
// Pure functions only: no React, no Supabase, no I/O. The caller does the
// query and passes the rows (and, critically, the query's `error`) in.

import { familyKey, familyLabel, frequencyOf } from './productFamily';

// ---------------------------------------------------------------------------
// The four things the check can be. There is no fifth, and in particular
// "failed" is NEVER collapsed into "clear" — see checkExistingAssignments().
// ---------------------------------------------------------------------------
export const CHECK_IDLE = 'idle';         // no product picked yet
export const CHECK_CHECKING = 'checking'; // query in flight
export const CHECK_FAILED = 'failed';     // we could not look — say so, loudly
export const CHECK_CLEAR = 'clear';       // looked, found nothing matching
export const CHECK_MATCH = 'match';       // looked, found something

// ---------------------------------------------------------------------------
// Purchase state. Mirrors PackagesModal.js / WorkStore.js exactly — three
// screens must not tell staff different stories about the same row.
//
// 🔴 `past_due` does NOT mean money is owed. Every writer maps it from Square's
// PAUSED and nothing else (square-subscriptions-backfill:53,
// square-backfill-resolve:52, square-webhook:195); Square has no past-due
// subscription status at all. A paused subscription is dormant, not gone — it
// can resume billing — so it is treated as OPEN here, not closed.
// ---------------------------------------------------------------------------
export function isLivePurchase(p) {
  return !!p && (p.status === 'active' || p.status === 'paid');
}
export function isOpenPurchase(p) {
  return !!p && (p.status === 'pending' || p.status === 'past_due');
}
export function isClosedPurchase(p) {
  return !!p && !isLivePurchase(p) && !isOpenPurchase(p);
}

// How loud a match is. 'live' is the strong case — that is a second thing
// actually billing a card right now.
export const SEVERITY_LIVE = 'live';
export const SEVERITY_OPEN = 'open';
export const SEVERITY_CLOSED = 'closed';

const SEVERITY_RANK = { [SEVERITY_LIVE]: 3, [SEVERITY_OPEN]: 2, [SEVERITY_CLOSED]: 1 };

function severityOf(purchase) {
  if (isLivePurchase(purchase)) return SEVERITY_LIVE;
  if (isOpenPurchase(purchase)) return SEVERITY_OPEN;
  return SEVERITY_CLOSED;
}

// Same words PackagesModal.js prints, so a coach reading the warning here and
// the package list there sees one vocabulary.
export const STATUS_LABELS = {
  active: 'Active',
  paid: 'Paid',
  pending: 'Awaiting payment',
  past_due: 'Paused',
  failed: 'Payment failed',
  canceled: 'Canceled',
  refunded: 'Refunded',
};

export function statusLabel(purchase) {
  const status = purchase && purchase.status;
  return STATUS_LABELS[status] || status || 'Unknown';
}

// Mirrors PackagesModal.js's FREQUENCY_LABELS. A token Square invents later
// still renders honestly ("EVERY_THREE_WEEKS" -> "Every three weeks"), and a
// name carrying no suffix says "Recurring" rather than guessing "Monthly" —
// guessing monthly is how a fortnightly plan ends up under-counted by half.
const FREQUENCY_LABELS = {
  MONTHLY: 'Monthly',
  EVERY_TWO_WEEKS: 'Every two weeks',
  EVERY_SIX_MONTHS: 'Every six months',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
};

export function frequencyLabel(value, fallback = 'Recurring') {
  const freq = frequencyOf(value);
  if (!freq) return fallback;
  if (FREQUENCY_LABELS[freq]) return FREQUENCY_LABELS[freq];
  const words = freq.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Team deposits / team fees.
//
// Nothing in the schema marks a product as a team payment: store_products has
// `kind` ('lesson' | 'package' | 'bundle' | 'rental') and nothing narrower, and
// productFamily.js is only about Square's duplicated frequency suffixes. So the
// only signal available is the product name, and this is deliberately a name
// heuristic rather than something pretending to be authoritative.
//
// It is tuned to under-claim: it needs the word "team" AND a money word
// (fee/dues/deposit). A false negative costs nothing — the athlete still gets
// the ordinary duplicate warning. A false positive would put the team-payment
// root-cause paragraph on a lesson pack, which is just noise. When a real
// `is_team_payment` column exists, replace the body of this function and every
// caller keeps working.
// ---------------------------------------------------------------------------
const TEAM_WORD_RE = /\bteams?\b/i;
// Checked against the live catalogue on 2026-08-25: every team product is
// "<age> Team Deposit", "... Full Team Fee", "The Naturals Team Payment",
// "Naturals Monthly Team" or "Naturals Team Monthly". 'payment' and the
// monthly-team pair are in the list because three real products use them and
// a fee/dues/deposit-only rule missed all three.
const TEAM_MONEY_WORD_RE = /\b(fee|fees|due|dues|deposit|deposits|payment|payments)\b/i;
// "Naturals Monthly Team" / "Naturals Team Monthly" carry no money word at all.
const TEAM_RECURRING_RE = /\b(monthly\s+team|team\s+monthly)\b/i;

export function isTeamPayment(value) {
  const label = familyLabel(value);
  if (!label) return false;
  if (TEAM_RECURRING_RE.test(label)) return true;
  return TEAM_WORD_RE.test(label) && TEAM_MONEY_WORD_RE.test(label);
}

// ---------------------------------------------------------------------------
// "Same product".
//
// NOT product_id equality. Square exported the same real-world package more
// than once — one row with the bare name, one or more with a
// "(EVERY_TWO_WEEKS price)" suffix — and the owner's rule (#276/#305) is that
// those are the same package in reality. productFamily.js owns that rule for
// the whole app and the SQL generated column store_products.family_key mirrors
// it, so matching on family_key is what the database would say too.
//
// A duplicate assigned through Square and one assigned through the portal can
// easily land on two different product rows of the same family, which is
// exactly the case product_id equality would miss. product_id is only the
// fallback for a row with no usable name at all.
// ---------------------------------------------------------------------------
export function isSameProduct(product, purchase) {
  if (!product || !purchase) return false;
  const productKey = familyKey(product);
  const purchaseKey = familyKey(purchase);
  if (productKey && purchaseKey) return productKey === purchaseKey;
  return !!product.id && !!purchase.product_id && product.id === purchase.product_id;
}

// Billing frequency comparison. Returns true (same), false (genuinely
// different) or null (at least one side does not say). null is not false: a
// bare product name carries no frequency, and claiming "different frequency"
// off a missing suffix would be inventing a distinction.
export function compareFrequency(product, purchase) {
  const a = frequencyOf(product);
  const b = frequencyOf(purchase);
  if (!a || !b) return null;
  return a === b;
}

function newestFirst(a, b) {
  const ta = new Date((a.purchase && a.purchase.created_at) || 0).getTime() || 0;
  const tb = new Date((b.purchase && b.purchase.created_at) || 0).getTime() || 0;
  return tb - ta;
}

/**
 * The whole check, as one pure function.
 *
 * @param {object}   args
 * @param {object}   args.product        the store_products row being assigned
 * @param {Array}    args.purchases      the athlete's store_purchases rows
 * @param {*}        args.error          the purchases query's `error`, or null
 * @param {boolean}  args.loading        query still in flight
 *
 * @returns {{
 *   state: string, matches: Array, severity: string|null,
 *   teamPayment: boolean, requiresAck: boolean, checkedCount: number,
 *   liveMatchCount: number
 * }}
 *
 * 🔴 THE ONE RULE THIS FUNCTION EXISTS TO ENFORCE:
 * a failed query must never come back as CHECK_CLEAR. "No duplicates found" is
 * a claim about the athlete's account; a query that did not run supports no
 * such claim. Reporting a failure as "none found" would actively cause the very
 * bug this check exists to prevent — so `error` is tested first, before
 * anything looks at rows, and a non-array `purchases` with no error is treated
 * the same way rather than silently becoming an empty list.
 */
export function checkExistingAssignments({ product, purchases, error, loading = false } = {}) {
  const teamPayment = isTeamPayment(product);
  const base = {
    state: CHECK_IDLE,
    matches: [],
    severity: null,
    teamPayment,
    requiresAck: false,
    checkedCount: 0,
    liveMatchCount: 0,
  };

  if (error) return { ...base, state: CHECK_FAILED };
  if (loading) return { ...base, state: CHECK_CHECKING };
  if (!product) return base;
  // No error, but also no rows array: we still have not seen this athlete's
  // account, so we cannot say it is clear.
  if (!Array.isArray(purchases)) return { ...base, state: CHECK_FAILED };

  const matches = purchases
    .filter((p) => p && isSameProduct(product, p))
    .map((purchase) => ({
      purchase,
      severity: severityOf(purchase),
      sameFrequency: compareFrequency(product, purchase),
      frequencyLabel: frequencyLabel(purchase),
      statusLabel: statusLabel(purchase),
      label: familyLabel(purchase) || purchase.product_name_snapshot || 'Unnamed package',
    }))
    .sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || newestFirst(a, b));

  const severity = matches.length ? matches[0].severity : null;
  const liveMatchCount = matches.filter((m) => m.severity === SEVERITY_LIVE).length;

  return {
    ...base,
    state: matches.length ? CHECK_MATCH : CHECK_CLEAR,
    matches,
    severity,
    // The only friction anywhere in this flow, and only for the strong case:
    // something matching is live RIGHT NOW. Everything else is informational.
    requiresAck: severity === SEVERITY_LIVE,
    checkedCount: purchases.length,
    liveMatchCount,
  };
}
