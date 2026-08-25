import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { X, ShoppingBag, Loader2, CheckCircle, Copy, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useModalTracking, trackAction } from './usage';
import { formatUserError } from './errorMessage';
import { familyLabel } from './productFamily';
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

  const check = useMemo(
    () => checkExistingAssignments({
      product: selected,
      purchases,
      error: purchasesError,
      loading: purchasesLoading,
    }),
    [selected, purchases, purchasesError, purchasesLoading],
  );

  const handleAssign = async (product) => {
    // Unchanged from before #344: same endpoint, same body, same rows written,
    // same notification. The duplicate check is pre-flight only.
    setAssigning(product.id);
    setError('');
    try {
      trackAction('assign_package', { product_id: product.id, player_id: playerId });
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
      setResult({ product_name: product.name, checkout_url: json.checkout_url });
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

  const step = result ? 'result' : selected ? 'review' : 'list';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      {/* #344 layout: the shell itself is NOT height-capped and the footer is a
          sibling of the scrolling region, not inside it (the working pattern in
          Schedule.js ~3975-4005). Only the middle band scrolls, and it is
          capped at 60vh, so header + 60vh + footer can never push the Assign
          button off-screen no matter how many existing packages an athlete has
          or how long the warning gets. */}
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full flex flex-col">
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

        {/* The ONLY scrolling element in this modal. */}
        <div className="overflow-y-auto max-h-[60vh] px-6 py-4 space-y-4">
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
                  {fmtMoney(selected.price_cents)}{selected.recurring ? ' / mo' : ''}
                  {selected.bundle_qty ? ` · ${selected.bundle_qty} sessions` : ''}
                </p>
              </div>

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
                              {fmtMoney(p.price_cents)}{p.recurring ? ' / mo' : ''}
                              {p.bundle_qty ? ` · ${p.bundle_qty} sessions` : ''}
                            </p>
                          </div>
                          <button
                            onClick={() => { setError(''); setSelected(p); }}
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
                onClick={() => setSelected(null)}
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
