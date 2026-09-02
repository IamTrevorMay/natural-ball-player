import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { X, ShoppingBag, Loader2, CheckCircle, Copy, AlertTriangle, ShieldAlert, BadgePercent } from 'lucide-react';
import { useModalTracking, trackAction } from './usage';
import { formatUserError } from './errorMessage';
import { familyKey, familyLabel, frequencyOf } from './productFamily';
import { classifyWriteOutcome } from './writeOutcome';
import {
  checkExistingAssignments,
  frequencyLabel,
  isLivePurchase,
  statusLabel,
  CHECK_CHECKING,
  CHECK_FAILED,
  CHECK_CLEAR,
  CHECK_MATCH,
  SEVERITY_LIVE,
  SEVERITY_OPEN,
} from './duplicateSubscriptionCheck';

const KIND_LABEL = {
  lesson: 'Lessons',
  package: 'Monthly Packages',
  bundle: 'Lesson Bundles',
  rental: 'Cage / Lane Rentals',
};
const KIND_ORDER = ['lesson', 'bundle', 'package', 'rental'];

// Same pill colours as PackagesModal.js — the two screens describe the same
// rows and must not colour them differently.
const STATUS_STYLES = {
  active:   'bg-green-50 text-green-700 border-green-200',
  paid:     'bg-green-50 text-green-700 border-green-200',
  pending:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  past_due: 'bg-slate-50 text-slate-700 border-slate-200',
  failed:   'bg-red-50 text-red-700 border-red-200',
  canceled: 'bg-gray-100 text-gray-500 border-gray-200',
  refunded: 'bg-gray-100 text-gray-500 border-gray-200',
};

function fmtMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// #384 — BILLING FREQUENCY.
//
// Cordell: "the square portal has the option to choose the frequency of the
// package / subscription as well as discount it."
//
// There is no `frequency` column anywhere in this schema — grep store_products
// and store_purchases in 20260616_square_store.sql and nothing of the sort
// exists. In this data model the frequency IS the Square subscription plan
// variation: square-catalog-sync writes ONE store_products row per
// SUBSCRIPTION_PLAN_VARIATION, each carrying that variation's own
// square_variation_id and its own price, and the frequency then survives only
// in the product NAME as the trailing "(MONTHLY price)" suffix productFamily.js
// owns.
//
// So choosing a frequency is not a new value to invent and post to Square — it
// is choosing WHICH row of the family to assign. square-checkout already bills
// whatever square_variation_id the chosen row carries, so this control charges
// the right cadence with no edge-function change at all.
//
// The options are therefore read off the catalogue that is already loaded,
// never from a list written here: a package that exists at one frequency gets
// no control, and a cadence Square invents next year shows up on its own.
// ---------------------------------------------------------------------------
function frequencyVersions(products, product) {
  if (!product) return [];
  const key = familyKey(product);
  if (!key) return [product];
  return (products || [])
    .filter((p) => p && p.kind === product.kind && familyKey(p) === key)
    .sort((a, b) => (
      (frequencyOf(a) || '').localeCompare(frequencyOf(b) || '')
      || String((a && a.name) || '').localeCompare(String((b && b.name) || ''))
    ));
}

// What one charge actually covers.
//
// This replaces the old " / mo", which was printed for EVERY recurring product.
// The catalogue genuinely contains EVERY_TWO_WEEKS and ANNUAL variations
// (productFamily.js), so that text described a fortnightly package as monthly —
// out by 2.17x on what a family pays in a month, on the one line staff read
// before charging them. A cadence we cannot name now says so instead of
// guessing, the same rule frequencyLabel() already follows.
const PERIOD_SUFFIX = {
  MONTHLY: ' /month',
  EVERY_TWO_WEEKS: ' /2 weeks',
  EVERY_SIX_MONTHS: ' /6 months',
  QUARTERLY: ' /quarter',
  ANNUAL: ' /year',
};

function periodSuffix(product) {
  if (!product || !product.recurring) return '';
  return PERIOD_SUFFIX[frequencyOf(product)] || ' each billing cycle';
}

// ---------------------------------------------------------------------------
// #384 — DISCOUNTS.
//
// Square supports exactly two shapes and so does store_discounts
// (20260616_square_discounts.sql:9-10): `percentage numeric(5,2)` and
// `amount_cents integer`. Those two, and nothing else, are offered here.
// ---------------------------------------------------------------------------
const DISCOUNT_OFF = 'off';
const DISCOUNT_PERCENT = 'percent';
const DISCOUNT_AMOUNT = 'amount';

// The jsonb key a portal-recorded (NOT Square-applied) discount is written
// under. store_purchases.metadata is jsonb NOT NULL DEFAULT '{}' and the UPDATE
// policy already admits admin and coach (20260713_package_usage:
// store_purchases_update_staff), so recording an intent needs no migration —
// the same reasoning packageExtension.js documents for its own audit trail.
const REQUESTED_DISCOUNT_KEY = 'requested_discount';

/**
 * The discounted price, and every reason it might not be one.
 *
 * The arithmetic is copied deliberately from square-apply-discount/index.ts:
 *   percentage   -> Math.max(0, Math.round(base * (100 - pct) / 100))
 *   amount_cents -> Math.max(0, base - amount)
 * Same operations, same order, same rounding. If this preview rounded
 * differently from the function that actually writes price_override_money, the
 * screen would show one price and the family would be charged another — which
 * is the precise failure #384 must not ship.
 *
 * `incomplete` is not `error`: an empty box is a discount not typed yet, and
 * shouting at someone mid-keystroke trains them to ignore the red text.
 */
function computeDiscount({ mode, raw, priceCents }) {
  const idle = {
    active: false, incomplete: false, error: null,
    percentage: null, amountCents: null, newPriceCents: null, offCents: null,
  };
  if (mode !== DISCOUNT_PERCENT && mode !== DISCOUNT_AMOUNT) return idle;

  const text = String(raw ?? '').trim();
  if (!text) return { ...idle, active: true, incomplete: true };

  const bad = (error) => ({ ...idle, active: true, error });
  const n = Number(text);
  if (!Number.isFinite(n)) return bad('Enter a number.');
  if (n < 0) return bad('A discount cannot be negative.');
  if (!Number.isFinite(priceCents)) {
    return bad('This product has no price on file, so there is nothing to discount.');
  }

  if (mode === DISCOUNT_PERCENT) {
    if (n > 100) return bad('A percentage discount cannot be more than 100%.');
    if (n === 0) return bad('Enter a discount greater than zero.');
    const newPriceCents = Math.max(0, Math.round(priceCents * (100 - n) / 100));
    return {
      active: true, incomplete: false, error: null,
      percentage: n, amountCents: null,
      newPriceCents, offCents: priceCents - newPriceCents,
    };
  }

  // Amount off, typed in dollars.
  const amountCents = Math.round(n * 100);
  if (amountCents === 0) return bad('Enter a discount greater than zero.');
  if (amountCents > priceCents) {
    return bad(`That is more than the ${fmtMoney(priceCents)} price of this package.`);
  }
  const newPriceCents = Math.max(0, priceCents - amountCents);
  return {
    active: true, incomplete: false, error: null,
    percentage: null, amountCents,
    newPriceCents, offCents: priceCents - newPriceCents,
  };
}

/**
 * The synced Square catalogue discount that means exactly what was typed, or
 * null.
 *
 * This matters because square-apply-discount does NOT accept a percentage or an
 * amount — it accepts a `discount_id` and reads the numbers out of
 * store_discounts itself (square-apply-discount/index.ts:97-113). So a typed
 * figure can only ever reach Square if a discount object with that exact figure
 * already exists in the Square catalogue. Matching is exact on purpose: a
 * "close enough" match would bill a family a number nobody chose.
 */
function matchSquareDiscount(discounts, disc) {
  if (!disc || !disc.active || disc.error || disc.incomplete) return null;
  return (discounts || []).find((d) => (
    (disc.percentage != null && d.percentage != null && Number(d.percentage) === disc.percentage)
    || (disc.amountCents != null && d.amount_cents != null && Number(d.amount_cents) === disc.amountCents)
  )) || null;
}

function discountPhrase(disc) {
  if (!disc || !disc.active || disc.error || disc.incomplete) return '';
  if (disc.percentage != null) {
    return `${disc.percentage}% off`;
  }
  return `${fmtMoney(disc.amountCents)} off`;
}

// #344: returns null — never the string "Invalid Date" — for a missing or
// unparseable timestamp, so the caller picks its own wording for "we don't
// know". Same helper, same reasoning, as PackagesModal.js: the last-synced line
// depends on it, and a blank or "Invalid Date" there would be one more thing on
// this screen that cannot be trusted.
function fmtDateOrNull(d) {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDate(d) {
  return fmtDateOrNull(d) ?? '—';
}

// The date caption, identical in logic to PackagesModal.js's dateLabel(): only
// ever claims a payment when Square actually gave us one (`paid_at`). A row can
// be status='active' with paid_at NULL — square-subscriptions-backfill writes
// exactly that — so "active" is never treated as evidence of payment.
function purchaseDateLabel(p) {
  if (p.paid_at != null) return `Paid ${fmtDate(p.paid_at)}`;
  if (isLivePurchase(p)) return `Active since ${fmtDate(p.created_at)}`;
  return `Assigned ${fmtDate(p.created_at)}`;
}

// Staff-facing: assign a store product/package to a player. Creates a pending
// charge (via square-checkout on the player's behalf) and surfaces the checkout
// link so the coach can share it — the player is also notified in-app (#213).
//
// #344: picking a product no longer assigns it immediately. It opens a review
// step that says what the athlete ALREADY has, because the reported bug is a
// dual-write path with no dedupe: the same team payment gets set up once in the
// Square dashboard and once here, and nothing ever compared the two. The review
// step warns; it never blocks. See duplicateSubscriptionCheck.js.
export default function AssignPackageModal({ playerId, playerName, onClose, onAssigned }) {
  useModalTracking('AssignPackageModal');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { product_name, checkout_url }
  const [copied, setCopied] = useState(false);

  // #344 — the review step's inputs.
  const [selected, setSelected] = useState(null);   // the product awaiting confirmation
  const [purchases, setPurchases] = useState(null); // null until the query answers
  const [purchasesLoading, setPurchasesLoading] = useState(true);
  // 🔴 Held as the error itself, not as a boolean and not folded into
  // `purchases`. Everything downstream keys off this to refuse to say "no
  // duplicates found" when the lookup never ran.
  const [purchasesError, setPurchasesError] = useState(null);
  // null means "we could not establish a last-sync date" — either the query
  // failed or store_backfill_runs is empty. It is NEVER used to mean "synced
  // just now"; the fallback wording says the date is unknown. Same source of
  // truth as PackagesModal.js.
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  // #384 — the frequency + discount controls.
  //
  // `viewer` is the signed-in staff member, and it is loaded because two
  // separate things downstream are admin-only and coaches can open this modal
  // (Profile.js gates the Assign Payment button on admin OR coach):
  //   * store_discounts SELECT is `get_user_role() = 'admin'`
  //     (20260616_square_discounts.sql:23-25), so a coach gets an EMPTY LIST
  //     WITH NO ERROR — indistinguishable from "Square has no discounts" unless
  //     we know the role;
  //   * square-apply-discount returns 403 for anyone but an admin
  //     (square-apply-discount/index.ts:74).
  const [viewer, setViewer] = useState(null);
  const [discounts, setDiscounts] = useState([]);
  const [discountsError, setDiscountsError] = useState(null);
  const [discountMode, setDiscountMode] = useState(DISCOUNT_OFF);
  const [discountRaw, setDiscountRaw] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // House rule: destructure `error` from every Supabase call and surface it.
      // `const { data } = await ...` hides a failed query as an empty list.
      const { data, error: err } = await supabase
        .from('store_products')
        .select('*')
        .eq('active', true)
        .order('sort_order');
      if (cancelled) return;
      if (err) {
        console.error('Failed to load store products:', err);
        setProductsError(formatUserError(err, 'Could not load the product list.'));
        setProducts([]);
      } else {
        setProductsError('');
        setProducts(data || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // #344: everything this athlete has ever been assigned. No product_kind
  // filter and no status filter — the owner asked to "show every package ever
  // bought with which are active", and a duplicate can just as easily collide
  // with a cancelled row as a live one.
  useEffect(() => {
    if (!playerId) return undefined;
    let cancelled = false;
    (async () => {
      setPurchasesLoading(true);
      const { data, error: err } = await supabase
        .from('store_purchases')
        .select('id, product_id, product_kind, product_name_snapshot, status, amount_cents, created_at, paid_at, expires_at, remaining_qty')
        .eq('user_id', playerId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (err) {
        // 🔴 The failure is kept, not swallowed. A caught error that left
        // `purchases` as [] would render "no duplicates found" off a query that
        // never ran — which is the exact bug this check exists to prevent.
        console.error('Failed to load existing purchases for duplicate check:', err);
        setPurchasesError(err);
        setPurchases(null);
      } else {
        setPurchasesError(null);
        setPurchases(data || []);
      }
      setPurchasesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [playerId]);

  // The subscription rows above are NOT live Square data. They exist only
  // because somebody pressed "Backfill Subscriptions" in WorkStore.js, and they
  // are frozen as of that moment — at one point the snapshot was ten days
  // stale. Kept in its own effect so a failure here cannot take the duplicate
  // check down with it; failure just leaves the date unknown, which is what the
  // wording then says.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('store_backfill_runs')
        .select('ran_at')
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        console.error('Failed to load last subscription sync:', err);
        setLastSyncedAt(null);
      } else {
        setLastSyncedAt((data && data.ran_at) || null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Who is doing this, and — only if that is an admin — what discounts Square
  // has actually synced. The query is skipped for a coach rather than run and
  // silently filtered to nothing, so this screen never reports an RLS refusal
  // as "no discounts exist".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const authUser = auth && auth.user;
      if (cancelled || !authUser) return;
      const { data: me, error: meErr } = await supabase
        .from('users')
        .select('id, full_name, role')
        .eq('id', authUser.id)
        .maybeSingle();
      if (cancelled) return;
      if (meErr) console.error('Could not read the signed-in account\'s role:', meErr);
      setViewer(me || { id: authUser.id, full_name: null, role: null });
      if (!me || me.role !== 'admin') return;
      const { data, error: dErr } = await supabase
        .from('store_discounts')
        .select('id, name, percentage, amount_cents')
        .eq('active', true)
        .order('name');
      if (cancelled) return;
      if (dErr) {
        console.error('Failed to load synced Square discounts:', dErr);
        setDiscountsError(dErr);
        setDiscounts([]);
      } else {
        setDiscountsError(null);
        setDiscounts(data || []);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const check = useMemo(
    () => checkExistingAssignments({
      product: selected,
      purchases,
      error: purchasesError,
      loading: purchasesLoading,
    }),
    [selected, purchases, purchasesError, purchasesLoading],
  );

  const isAdmin = viewer != null && viewer.role === 'admin';

  // Every catalogue row that is the same package at a different cadence. One
  // entry means the package exists at a single frequency and there is nothing
  // to choose.
  const versions = useMemo(() => frequencyVersions(products, selected), [products, selected]);

  // Recomputed against `selected.price_cents`, so switching frequency
  // re-validates the discount against the NEW price — a $50-off agreement that
  // is fine on a $240 monthly plan is not fine on a $120 fortnightly one, and
  // this is what catches that.
  const disc = useMemo(
    () => computeDiscount({
      mode: discountMode,
      raw: discountRaw,
      priceCents: selected ? selected.price_cents : null,
    }),
    [discountMode, discountRaw, selected],
  );

  const squareDiscount = useMemo(() => matchSquareDiscount(discounts, disc), [discounts, disc]);

  // The one question this whole feature turns on: will the family actually be
  // charged less?
  //
  // Only if all four hold. square-apply-discount is the ONLY deployed thing
  // that can change what Square bills, and it needs (a) an admin caller, (b) a
  // subscription — it looks up product_kind='package' with a non-null
  // square_subscription_id and 404s otherwise (index.ts:80-91) — and (c) an
  // existing store_discounts row, because it takes a discount_id and not a
  // number. Anything else is a note in the portal, and this flag is what the
  // wording keys off so the two can never disagree.
  const discountReachesSquare = !!(
    disc.active && !disc.error && !disc.incomplete
    && squareDiscount && isAdmin
    && selected && selected.kind === 'package'
  );

  const resetDiscount = () => { setDiscountMode(DISCOUNT_OFF); setDiscountRaw(''); };

  // Write the staff member's intent onto the purchase we just created.
  //
  // 🔴 It goes in `metadata`, NOT in `discounted_price_cents`. That column is
  // read across the app as WHAT SQUARE ACTUALLY CHARGED — invoiceMatch.js's
  // purchaseAmountCents() reconciles Square invoices against it, and
  // WorkStore.js prints `discounted_price_cents ?? amount_cents` as the money
  // received. Writing a price Square never charged into it would silently
  // corrupt invoice reconciliation for every discounted row. Only
  // square-apply-discount, which has just told Square, may set that column.
  const recordDiscountIntent = async ({ purchaseId, product, appliedInSquare, squareDiscountId, note }) => {
    if (!purchaseId) {
      return { ok: false, reason: 'square-checkout did not return the new purchase id, so nothing could be written down.' };
    }
    // Re-read and merge: jsonb cannot be appended to through PostgREST, and
    // square-checkout has just written idempotency_key / payment_link_id /
    // plan_variation_id onto this row. Replacing the object wholesale is the
    // exact defect PLANNING.md logs as M1 against square-apply-discount.
    const { data: fresh, error: readErr } = await supabase
      .from('store_purchases')
      .select('id, metadata')
      .eq('id', purchaseId)
      .maybeSingle();
    if (readErr) {
      console.error('Could not read back the new purchase to record the discount:', readErr);
      return { ok: false, reason: formatUserError(readErr, 'The new purchase could not be read back.') };
    }
    if (!fresh) {
      return { ok: false, reason: 'The new purchase could not be read back, so the discount was not written down.' };
    }
    const base = fresh.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata)
      ? fresh.metadata
      : {};
    const record = {
      at: new Date().toISOString(),
      by: viewer ? viewer.id : null,
      by_name: (viewer && viewer.full_name) || null,
      source: 'AssignPackageModal',
      product_id: product.id,
      product_name: product.name,
      frequency: frequencyOf(product),
      base_cents: product.price_cents,
      percentage: disc.percentage,
      amount_cents: disc.amountCents,
      new_price_cents: disc.newPriceCents,
      applied_in_square: !!appliedInSquare,
      square_discount_id: squareDiscountId || null,
      note: note || null,
    };
    // .select() is what makes this honest: an UPDATE refused by RLS returns 200
    // with no error and zero rows. See writeOutcome.js.
    const { data: updated, error: updErr } = await supabase
      .from('store_purchases')
      .update({ metadata: { ...base, [REQUESTED_DISCOUNT_KEY]: record } })
      .eq('id', purchaseId)
      .select('id');
    const outcome = classifyWriteOutcome({ error: updErr, data: updated, expected: 1 });
    if (outcome.outcome === 'errored') {
      console.error('Could not record the discount on the new purchase:', updErr);
      return { ok: false, reason: formatUserError(updErr, 'The discount could not be written down.') };
    }
    if (outcome.outcome !== 'written') {
      console.warn('Discount record refused (0 rows) for purchase', purchaseId);
      return { ok: false, reason: 'The database accepted the request but changed no rows, which means it refused the write. Nothing about the discount was recorded.' };
    }
    return { ok: true };
  };

  // What happened to the discount, as one of exactly three states. This is the
  // only place that decides, and the result screen reads it verbatim — there is
  // no second opinion anywhere that could tell staff a different story.
  //
  //   'applied'  — Square has it. The family is billed the discounted price.
  //   'recorded' — written on the purchase in the portal ONLY. Square still
  //                bills full price until a human changes it there.
  //   'lost'     — not applied AND not even written down. Say so loudest.
  const settleDiscount = async ({ purchaseId, product, session }) => {
    const shape = {
      phrase: discountPhrase(disc),
      baseCents: product.price_cents,
      newPriceCents: disc.newPriceCents,
      period: periodSuffix(product),
      squareName: squareDiscount ? squareDiscount.name : null,
    };

    if (discountReachesSquare) {
      try {
        const res = await fetch(
          `${process.env.REACT_APP_SUPABASE_URL || 'https://cjilkqzifyhssbsiqgfu.supabase.co'}/functions/v1/square-apply-discount`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ user_id: playerId, discount_id: squareDiscount.id }),
          },
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Square rejected the discount.');

        // 🔴 square-apply-discount takes a user_id, NOT a purchase_id: it picks
        // the athlete's most recent package purchase itself
        // (index.ts:80-89). That is normally the row we just made, but it is
        // not guaranteed, and a discount silently landing on a DIFFERENT
        // subscription is worse than one that never applied. It echoes the row
        // it touched, so check it, and refuse to claim success when it differs.
        if (purchaseId && json.purchase_id && json.purchase_id !== purchaseId) {
          const noted = await recordDiscountIntent({
            purchaseId, product, appliedInSquare: false,
            squareDiscountId: squareDiscount.id,
            note: `square-apply-discount applied this to purchase ${json.purchase_id}, not the one just assigned.`,
          });
          return {
            ...shape,
            state: 'misapplied',
            otherPurchaseId: json.purchase_id,
            recorded: noted.ok,
            recordProblem: noted.ok ? null : noted.reason,
          };
        }
        return {
          ...shape,
          state: 'applied',
          billedCents: typeof json.discounted_price_cents === 'number'
            ? json.discounted_price_cents
            : disc.newPriceCents,
        };
      } catch (err) {
        // Square said no. The package is already assigned, so fall through to
        // recording the intent rather than losing it — and carry the reason.
        console.error('square-apply-discount failed after assignment:', err);
        const noted = await recordDiscountIntent({
          purchaseId, product, appliedInSquare: false,
          squareDiscountId: squareDiscount.id,
          note: `square-apply-discount failed: ${err.message}`,
        });
        return {
          ...shape,
          state: noted.ok ? 'recorded' : 'lost',
          squareError: err.message,
          recordProblem: noted.ok ? null : noted.reason,
        };
      }
    }

    const noted = await recordDiscountIntent({
      purchaseId, product, appliedInSquare: false,
      squareDiscountId: squareDiscount ? squareDiscount.id : null,
      note: null,
    });
    return {
      ...shape,
      state: noted.ok ? 'recorded' : 'lost',
      recordProblem: noted.ok ? null : noted.reason,
    };
  };

  const handleAssign = async (product) => {
    // The assignment itself is UNCHANGED from #344: same endpoint, same body,
    // same rows written, same notification. #384's frequency control works
    // entirely by changing WHICH product.id is passed here, so the charge is
    // right without square-checkout knowing anything new. The discount is a
    // strictly separate second step below, after the assignment has already
    // succeeded — a discount that fails must never cost the athlete the package.
    setAssigning(product.id);
    setError('');
    const wanted = disc.active && !disc.error && !disc.incomplete ? disc : null;
    try {
      trackAction('assign_package', {
        product_id: product.id,
        player_id: playerId,
        frequency: frequencyOf(product),
        discount: wanted ? discountPhrase(wanted) : null,
        discount_reaches_square: discountReachesSquare,
      });
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL || 'https://cjilkqzifyhssbsiqgfu.supabase.co'}/functions/v1/square-checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            product_id: product.id,
            target_user_id: playerId,
            return_url: `${window.location.origin}/?store_return=1`,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Assignment failed');

      const outcome = wanted
        ? await settleDiscount({ purchaseId: json.purchase_id, product, session })
        : null;

      setResult({
        product_name: product.name,
        checkout_url: json.checkout_url,
        purchase_id: json.purchase_id || null,
        product,
        discount: outcome,
      });
      onAssigned?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAssigning(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(result.checkout_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be blocked; link is still visible */ }
  };

  const grouped = KIND_ORDER
    .map(kind => ({ kind, items: products.filter(p => p.kind === kind) }))
    .filter(g => g.items.length > 0);

  const firstName = (playerName || '').split(' ')[0] || 'this athlete';
  const syncedOn = fmtDateOrNull(lastSyncedAt);
  const selectedLabel = selected ? (familyLabel(selected.name) || selected.name) : '';

  // The staleness caveat. Printed next to every result of the check that makes
  // a claim about what is on file, because "nothing found" is only ever a
  // statement about the portal's snapshot — never about Square.
  const stalenessLine = syncedOn
    ? `Checked against the portal's copy, last synced from Square on ${syncedOn}. Anything set up in Square since then will not appear here.`
    : 'Checked against the portal\'s copy of Square. The date of the last sync is unknown, so anything set up in Square since then will not appear here.';

  const renderPurchaseRow = (p, key) => (
    <div key={key ?? p.id} className="border border-gray-200 rounded-lg px-3 py-2 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {familyLabel(p.product_name_snapshot) || p.product_name_snapshot}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{purchaseDateLabel(p)}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {p.product_kind === 'package' && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-indigo-50 text-indigo-700 border-indigo-200">
              {frequencyLabel(p.product_name_snapshot)}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {statusLabel(p)}
          </span>
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // The verdict block. Four shapes, and "could not check" is deliberately its
  // own shape rather than a variation of "none found".
  // ---------------------------------------------------------------------------
  const renderCheck = () => {
    if (check.state === CHECK_CHECKING) {
      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin text-gray-400" />
          <span>Checking what {firstName} already has…</span>
        </div>
      );
    }

    if (check.state === CHECK_FAILED) {
      return (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldAlert size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-900">
              <p className="font-semibold">Could not check for duplicates.</p>
              <p className="mt-1">
                The lookup of {playerName || 'this athlete'}&apos;s existing packages did not run, so this
                screen cannot tell you whether they already have {selectedLabel}.{' '}
                <span className="font-medium">This is not the same as finding none.</span> Check their
                Packages list and Square before assigning.
              </p>
              {purchasesError && (
                <p className="mt-1 text-xs text-red-700">
                  {formatUserError(purchasesError, 'The packages lookup failed.')}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (check.state === CHECK_CLEAR) {
      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">
            Nothing on file matches {selectedLabel}.
          </p>
          <p className="mt-1 text-gray-600">
            {check.checkedCount === 1
              ? 'One package on this account was checked.'
              : `${check.checkedCount} packages on this account were checked.`}{' '}
            {stalenessLine}
          </p>
        </div>
      );
    }

    if (check.state !== CHECK_MATCH) return null;

    const live = check.severity === SEVERITY_LIVE;
    const open = check.severity === SEVERITY_OPEN;
    // Amber is reserved for the cases where something is still running or could
    // start running again. A match against a cancelled/refunded/failed row is
    // real information but a much weaker case, so it reads as neutral.
    const box = live
      ? 'border-amber-400 bg-amber-50'
      : open
        ? 'border-amber-200 bg-amber-50/60'
        : 'border-slate-200 bg-slate-50';
    const icon = live ? 'text-amber-600' : open ? 'text-amber-500' : 'text-slate-400';
    const text = live || open ? 'text-amber-900' : 'text-slate-700';

    const top = check.matches[0];
    let headline;
    if (live) {
      headline = check.liveMatchCount > 1
        ? `${playerName || 'This athlete'} already has ${check.liveMatchCount} live ${selectedLabel} subscriptions.`
        : `${playerName || 'This athlete'} already has ${selectedLabel}, and it is ${top.statusLabel.toLowerCase()}.`;
    } else if (open) {
      headline = `${playerName || 'This athlete'} already has ${selectedLabel} on file — ${top.statusLabel.toLowerCase()}.`;
    } else {
      headline = `${playerName || 'This athlete'} has had ${selectedLabel} before. It is ${top.statusLabel.toLowerCase()}.`;
    }

    return (
      <div className={`rounded-lg border px-4 py-3 ${box}`}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className={`${icon} flex-shrink-0 mt-0.5`} />
          <div className={`text-sm ${text} min-w-0 flex-1`}>
            <p className="font-semibold">{headline}</p>

            {/* #344: the team-payment paragraph. Every one of the 26 duplicate
                subscriptions found was a team deposit or team fee — not one was
                a training programme — and the owner named the cause himself:
                one person sets the team payment up in the Square dashboard,
                another sets the same one up here. So when the product looks
                like a team payment, say that out loud instead of leaving staff
                to remember it. */}
            {check.teamPayment && (live || open) && (
              <p className="mt-1.5">
                <span className="font-medium">This is a team payment, which is where this goes wrong.</span>{' '}
                Every duplicate subscription found in this account audit was a team deposit or team
                fee, caused by the same payment being set up once in the Square dashboard and once
                here. Confirm in Square that this one is not already running before assigning it again.
              </p>
            )}

            <div className="mt-2 space-y-1.5">
              {check.matches.map((m) => (
                <div key={m.purchase.id} className="rounded border border-white/70 bg-white px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{m.label}</p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {m.frequencyLabel} · {purchaseDateLabel(m.purchase)}
                      </p>
                      {/* A different billing frequency is stated, never used to
                          dismiss the match: productFamily.js exists precisely
                          because Square exported the same real package at
                          several frequencies, so "annual" and "monthly" rows can
                          still be the same team fee twice. */}
                      {m.sameFrequency === false && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Same package, different billing frequency from the one you are assigning
                          ({frequencyLabel(selected, 'no frequency in the name')}).
                        </p>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border flex-shrink-0 ${STATUS_STYLES[m.purchase.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                      {m.statusLabel}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {!live && !open && (
              <p className="mt-2 text-xs">
                Nothing here is currently billing, so assigning this again is probably what you want.
              </p>
            )}

            <p className="mt-2 text-xs opacity-80">{stalenessLine}</p>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // #384 — the frequency picker.
  //
  // Only drawn when the catalogue actually holds this package at more than one
  // cadence. Every option is a real store_products row with its own Square
  // plan variation and its own price, so the price moves with the choice.
  // ---------------------------------------------------------------------------
  const renderFrequency = () => {
    if (!selected || versions.length < 2) return null;
    return (
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Billing frequency
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {versions.map((v) => {
            const active = v.id === selected.id;
            // square-checkout refuses a kind='package' row with no
            // square_plan_id / square_variation_id (index.ts:189-193) — those
            // are the older SUBSCRIPTION_PLAN rows square-catalog-sync inserts
            // with square_variation_id NULL. Say so here rather than let staff
            // find out from a 400 after pressing Assign. Not disabled: the
            // product list has always allowed picking one, and the edge
            // function's own message is the authority on why it failed.
            const notBillable = v.kind === 'package' && !(v.square_plan_id && v.square_variation_id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { setError(''); setSelected(v); }}
                disabled={assigning != null}
                className={`text-left border rounded-lg px-3 py-2 transition disabled:opacity-60 ${
                  active
                    ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <p className={`text-sm font-medium ${active ? 'text-indigo-900' : 'text-gray-900'}`}>
                  {frequencyLabel(v)}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {fmtMoney(v.price_cents)}{periodSuffix(v)}
                </p>
                {notBillable && (
                  <p className="text-xs text-red-700 mt-0.5">
                    Not set up as a subscription plan in Square — assigning this will fail.
                  </p>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Each option is a separate plan in Square, with its own price. Picking one here charges that
          plan — the same choice the Square dashboard offers.
        </p>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // #384 — the discount controls, and the one paragraph that has to be true.
  //
  // The controls are the easy half. The hard half is the status box at the
  // bottom, which says which of two completely different things is about to
  // happen: a real price override in Square, or a note in the portal while the
  // family keeps paying full price. Those are never worded the same.
  // ---------------------------------------------------------------------------
  const renderDiscount = () => {
    if (!selected) return null;
    const price = selected.price_cents;
    const period = periodSuffix(selected);
    const showing = disc.active && !disc.error && !disc.incomplete;

    return (
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Discount
        </h3>

        <div className="flex flex-wrap gap-2">
          {[
            [DISCOUNT_OFF, 'No discount'],
            [DISCOUNT_PERCENT, 'Percentage off'],
            [DISCOUNT_AMOUNT, 'Amount off'],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => { setDiscountMode(mode); if (mode === DISCOUNT_OFF) setDiscountRaw(''); }}
              disabled={assigning != null}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition disabled:opacity-60 ${
                discountMode === mode
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {discountMode !== DISCOUNT_OFF && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              {discountMode === DISCOUNT_AMOUNT && <span className="text-gray-500 text-sm">$</span>}
              <input
                type="number"
                min="0"
                step={discountMode === DISCOUNT_PERCENT ? '1' : '0.01'}
                max={discountMode === DISCOUNT_PERCENT ? '100' : undefined}
                value={discountRaw}
                onChange={(e) => setDiscountRaw(e.target.value)}
                disabled={assigning != null}
                placeholder={discountMode === DISCOUNT_PERCENT ? '20' : '50.00'}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 disabled:opacity-60"
              />
              {discountMode === DISCOUNT_PERCENT && <span className="text-gray-500 text-sm">%</span>}
              <span className="text-sm text-gray-500">off</span>
            </div>

            {disc.error && (
              <p className="text-sm text-red-700">{disc.error}</p>
            )}

            {showing && (
              <p className="text-sm text-gray-900">
                <span className="text-gray-500 line-through">{fmtMoney(price)}{period}</span>
                {' → '}
                <span className="font-semibold">{fmtMoney(disc.newPriceCents)}{period}</span>
                <span className="text-gray-500"> ({fmtMoney(disc.offCents)} off)</span>
              </p>
            )}

            {/* Discounts that already exist in Square. These are the ONLY ones
                that can be applied for real from here, because
                square-apply-discount takes a discount_id and reads the numbers
                out of store_discounts itself — it cannot be handed a figure. */}
            {isAdmin && selected.kind === 'package' && discounts.length > 0 && (
              <div className="pt-1">
                <p className="text-xs text-gray-500 mb-1.5">
                  Discounts synced from Square — these can be applied for real:
                </p>
                <div className="flex flex-wrap gap-2">
                  {discounts.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      disabled={assigning != null}
                      onClick={() => {
                        if (d.percentage != null) {
                          setDiscountMode(DISCOUNT_PERCENT);
                          setDiscountRaw(String(Number(d.percentage)));
                        } else if (d.amount_cents != null) {
                          setDiscountMode(DISCOUNT_AMOUNT);
                          setDiscountRaw((d.amount_cents / 100).toFixed(2));
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition disabled:opacity-60 ${
                        squareDiscount && squareDiscount.id === d.id
                          ? 'border-green-400 bg-green-50 text-green-800'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {d.name}
                      {' · '}
                      {d.percentage != null
                        ? `${Number(d.percentage)}% off`
                        : d.amount_cents != null
                          ? `${fmtMoney(d.amount_cents)} off`
                          : 'no value set'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isAdmin && selected.kind === 'package' && discounts.length === 0 && !discountsError && (
              <p className="text-xs text-gray-500">
                No discounts are synced from Square. Create one in the Square dashboard, then run
                “Sync from Square” in Work Portal → Store, and it becomes applicable from here.
              </p>
            )}
            {discountsError && (
              <p className="text-xs text-red-700">
                {formatUserError(discountsError, 'The Square discount list could not be loaded.')}{' '}
                That list is unknown, not empty.
              </p>
            )}

            {showing && renderDiscountFate()}
          </div>
        )}
      </div>
    );
  };

  // The status box. Green ONLY when a real Square price override is going to
  // happen; amber every other time, naming the amount the family will actually
  // be charged. A silent mismatch between this screen and the family's card is
  // the failure this whole block exists to prevent.
  const renderDiscountFate = () => {
    const period = periodSuffix(selected);
    if (discountReachesSquare) {
      return (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <BadgePercent size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-green-900">
              <p className="font-semibold">
                This will be applied in Square as “{squareDiscount.name}”.
              </p>
              <p className="mt-1">
                After assigning, {firstName} is billed{' '}
                <span className="font-medium">{fmtMoney(disc.newPriceCents)}{period}</span>{' '}
                instead of {fmtMoney(selected.price_cents)}{period}, every cycle, until the discount is
                removed. This is a real price override on the Square subscription — not a note.
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Why it cannot reach Square, most specific reason first. Each of these is
    // a different fix, so they are not collapsed into one vague sentence.
    let reason;
    if (selected.kind !== 'package') {
      reason = 'Only recurring subscriptions can be discounted automatically from the portal. This is a one-time charge, and square-checkout builds its Square payment link at the full list price.';
    } else if (!isAdmin) {
      reason = 'Applying a discount in Square is admin-only. Your account can record it here, but an admin has to apply it.';
    } else if (!squareDiscount) {
      reason = 'No discount in the Square catalogue matches this exact figure. The portal can only apply a discount that already exists in Square — it cannot create one.';
    } else {
      reason = 'The portal cannot apply this discount in Square.';
    }

    return (
      <div className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">
              This discount will be recorded in the portal only. Square will still bill{' '}
              {fmtMoney(selected.price_cents)}{period}.
            </p>
            <p className="mt-1">{reason}</p>
            {/* The remedy is genuinely different for the two kinds, so it is
                not written as one vague "fix it in Square". A subscription has
                a price you can override; a one-time payment link does not —
                square-checkout has already minted it at product.price_cents
                (square-checkout/index.ts:132) and a payment link's amount
                cannot be edited afterwards. */}
            {selected.kind === 'package' ? (
              <p className="mt-1">
                {firstName} will be charged the full {fmtMoney(selected.price_cents)}{period} every
                cycle until somebody changes it in the Square dashboard. Assign here, then open the
                subscription in Square and override the price to {fmtMoney(disc.newPriceCents)}.
              </p>
            ) : (
              <p className="mt-1">
                The payment link this creates will be for the full {fmtMoney(selected.price_cents)}, and
                a Square payment link&apos;s amount cannot be edited afterwards. To charge{' '}
                {fmtMoney(disc.newPriceCents)} instead, cancel this in Square and raise a new invoice
                for that amount.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // The result screen's discount block. It reads the outcome settleDiscount()
  // decided; it never re-derives anything, so it cannot contradict what
  // actually happened.
  // ---------------------------------------------------------------------------
  const renderDiscountOutcome = () => {
    const d = result && result.discount;
    if (!d) return null;

    if (d.state === 'applied') {
      return (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <BadgePercent size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-green-900">
              <p className="font-semibold">
                {d.phrase} applied in Square{d.squareName ? ` as “${d.squareName}”` : ''}.
              </p>
              <p className="mt-1">
                {firstName} is billed{' '}
                <span className="font-medium">{fmtMoney(d.billedCents)}{d.period}</span> instead of{' '}
                {fmtMoney(d.baseCents)}{d.period}, every cycle, until it is removed.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (d.state === 'misapplied') {
      return (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldAlert size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-900">
              <p className="font-semibold">The discount landed on a different subscription.</p>
              <p className="mt-1">
                Square applied {d.phrase} to purchase {d.otherPurchaseId}, not the one just assigned.
                Check {firstName}&apos;s subscriptions in Square before doing anything else — one of
                them is now billing a price nobody chose.
              </p>
              {!d.recorded && d.recordProblem && (
                <p className="mt-1 text-xs">{d.recordProblem}</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    const lost = d.state === 'lost';
    return (
      <div className={`rounded-lg border px-4 py-3 ${lost ? 'border-red-300 bg-red-50' : 'border-amber-400 bg-amber-50'}`}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className={`${lost ? 'text-red-600' : 'text-amber-600'} flex-shrink-0 mt-0.5`} />
          <div className={`text-sm ${lost ? 'text-red-900' : 'text-amber-900'}`}>
            <p className="font-semibold">
              {d.phrase} was NOT applied in Square. {playerName || 'This athlete'} will be charged{' '}
              {fmtMoney(d.baseCents)}{d.period}.
            </p>
            {d.squareError && (
              <p className="mt-1">Square rejected the change: {d.squareError}</p>
            )}
            <p className="mt-1">
              {lost
                ? 'It was not recorded in the portal either, so there is no note of it anywhere. '
                : 'It is recorded on this purchase in the portal so the agreement is not lost. '}
              {result.product && result.product.kind === 'package'
                ? `To make it real, open ${firstName}'s subscription in the Square dashboard and override the price to ${fmtMoney(d.newPriceCents)}.`
                : `The payment link above is for the full ${fmtMoney(d.baseCents)} and a Square payment link's amount cannot be edited. To charge ${fmtMoney(d.newPriceCents)} instead, cancel it in Square and raise a new invoice for that amount.`}
            </p>
            {d.recordProblem && (
              <p className="mt-1 text-xs">{d.recordProblem}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const step = result ? 'result' : selected ? 'review' : 'list';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      {/* #344 layout: the shell itself is NOT height-capped and the footer is a
          sibling of the scrolling region, not inside it (the working pattern in
          Schedule.js ~3975-4005). Only the middle band scrolls, and it is
          capped at 60vh, so header + 60vh + footer can never push the Assign
          button off-screen no matter how many existing packages an athlete has
          or how long the warning gets. */}
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ShoppingBag size={22} className="text-indigo-600 flex-shrink-0" />
            <h2 className="text-xl font-bold text-gray-900 truncate">
              {step === 'review' ? 'Confirm assignment' : 'Assign Payment'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={22} />
          </button>
        </div>

        {/* The ONLY scrolling element in this modal. `flex-1 min-h-0` is what
            lets it actually shrink inside the 90vh-capped column — without
            min-h-0 a flex child refuses to go below its content height and the
            footer is pushed off a short screen, which is the failure the modal
            rule exists to stop. */}
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[60vh] px-6 py-4 space-y-4">
          {step === 'result' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-gray-800">
                  <p className="font-medium">Assigned “{result.product_name}” to {playerName}.</p>
                  <p className="text-gray-600 mt-1">
                    A pending payment now appears in {firstName}&apos;s account and in their
                    notifications. Share the link below if you'd like them to pay right away.
                  </p>
                </div>
              </div>
              {renderDiscountOutcome()}

              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={result.checkout_url}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-gray-50"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
                >
                  <Copy size={14} />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {step === 'review' && (
            <>
              <div className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Assigning to {playerName}</p>
                <p className="font-medium text-gray-900">{selected.name}</p>
                {selected.description && <p className="text-sm text-gray-500">{selected.description}</p>}
                <p className="text-sm text-gray-700 font-semibold mt-1">
                  {fmtMoney(selected.price_cents)}{periodSuffix(selected)}
                  {selected.bundle_qty ? ` · ${selected.bundle_qty} sessions` : ''}
                </p>
              </div>

              {renderFrequency()}

              {renderDiscount()}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>
              )}

              {renderCheck()}

              {/* "show every package ever bought with which are active" — the
                  owner's own words on the tracker. Listed whatever the verdict
                  is, so the decision is made against the whole account rather
                  than the one row that happened to match. */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Everything on {firstName}&apos;s account
                </h3>
                {purchasesLoading ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : purchasesError ? (
                  <p className="text-sm text-gray-600">
                    This list could not be loaded, so it is not shown. It is not empty — it is unknown.
                  </p>
                ) : (purchases || []).length === 0 ? (
                  <p className="text-sm text-gray-600">
                    No packages on file in the portal for {firstName}.{' '}
                    {syncedOn
                      ? `That is what the portal held as of ${syncedOn}, not what Square holds.`
                      : 'That is what the portal holds, not what Square holds.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(purchases || []).map(p => renderPurchaseRow(p))}
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'list' && (
            <>
              <p className="text-sm text-gray-600">
                Choose what to charge <span className="font-medium">{playerName}</span>. This creates a
                pending payment they can complete — useful for package changes, facility fines, or any other charge.
              </p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>
              )}
              {productsError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{productsError}</div>
              )}

              {loading ? (
                <div className="text-center py-12 text-gray-500">Loading…</div>
              ) : grouped.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  {productsError ? 'The product list could not be loaded.' : 'No products available yet.'}
                </div>
              ) : (
                grouped.map(group => (
                  <div key={group.kind}>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
                      {KIND_LABEL[group.kind]}
                    </h3>
                    <div className="space-y-2">
                      {group.items.map(p => (
                        <div key={p.id} className="border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{p.name}</p>
                            {p.description && (
                              <p className="text-sm text-gray-500 truncate">{p.description}</p>
                            )}
                            <p className="text-sm text-gray-700 font-semibold mt-1">
                              {fmtMoney(p.price_cents)}{periodSuffix(p)}
                              {p.bundle_qty ? ` · ${p.bundle_qty} sessions` : ''}
                            </p>
                          </div>
                          <button
                            onClick={() => { setError(''); resetDiscount(); setSelected(p); }}
                            className="ml-4 bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition"
                          >
                            Assign
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* Footer: OUTSIDE the scrolling region, always on screen. */}
        <div className="border-t px-6 py-3 flex-shrink-0">
          {step === 'result' && (
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition"
              >
                Done
              </button>
            </div>
          )}

          {step === 'list' && (
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition"
              >
                Close
              </button>
            </div>
          )}

          {step === 'review' && (
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => { resetDiscount(); setSelected(null); }}
                disabled={assigning != null}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition disabled:opacity-60"
              >
                Back
              </button>
              <div className="flex items-center gap-3 min-w-0">
                {/* #344: the single acknowledgement, and only for the strong
                    case. It is a change of wording and colour on the button
                    itself — NOT a checkbox that gates it and NOT a disabled
                    state. The owner asked for warn-don't-block, and he is the
                    one assigning: sometimes the duplicate is deliberate (one
                    athlete legitimately runs the same annual team fee four
                    times, four years paid upfront). The button below is always
                    clickable. */}
                {check.requiresAck && (
                  <span className="text-xs text-amber-800 hidden sm:inline">
                    This adds a second live charge.
                  </span>
                )}
                {/* #384: the discount banner lives in the scrolling body, and
                    this button does not. Somebody who never scrolls must still
                    not be able to press Assign believing the family is about to
                    be charged less than they are. */}
                {disc.active && !disc.error && !disc.incomplete && !discountReachesSquare && (
                  <span className="text-xs text-amber-800">
                    Discount is portal-only — Square still bills {fmtMoney(selected.price_cents)}
                    {periodSuffix(selected)}.
                  </span>
                )}
                <button
                  onClick={() => handleAssign(selected)}
                  disabled={assigning != null}
                  className={`px-4 py-2 rounded-lg font-medium text-white transition disabled:opacity-60 flex items-center gap-2 ${
                    check.requiresAck ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {assigning != null ? <Loader2 size={16} className="animate-spin" /> : null}
                  {assigning != null
                    ? 'Assigning…'
                    : check.requiresAck
                      ? 'Assign anyway'
                      : 'Assign'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
