import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { X, ChevronDown, ChevronRight, Plus, Calendar, Package, Trash2 } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { familyLabel, frequencyOf } from './productFamily';

// #235: full package history for a single player. Shows every active & past
// package/bundle they purchased, how many sessions are left, when each session
// was used, and how much time is left before the package expires. Staff can log
// a used session, adjust the remaining count, and set an expiration date.
const STATUS_STYLES = {
  active:   'bg-green-50 text-green-700 border-green-200',
  paid:     'bg-green-50 text-green-700 border-green-200',
  pending:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  past_due: 'bg-slate-50 text-slate-700 border-slate-200',
  failed:   'bg-red-50 text-red-700 border-red-200',
  canceled: 'bg-gray-100 text-gray-500 border-gray-200',
  refunded: 'bg-gray-100 text-gray-500 border-gray-200',
};

// #340: the raw database word was rendered straight to staff ("pending"), which
// reads as a system state rather than a fact about money. Same wording as the
// profile pill in Profile.js so the two screens can't tell different stories.
const STATUS_LABELS = {
  active:   'Active',
  paid:     'Paid',
  pending:  'Awaiting payment',
  past_due: 'Paused',            // Square PAUSED — not an unpaid bill. See WorkStore.js.
  failed:   'Payment failed',
  canceled: 'Canceled',
  refunded: 'Refunded',
};

// A purchase is only KNOWN paid when Square told us so: `paid_at` is written by
// the square-webhook payment handler and by nothing else.
//
// `status === 'active'` is deliberately NOT enough. square-subscriptions-backfill
// writes status='active' with paid_at left NULL, so treating active as paid would
// print "Paid <the date we ran the backfill>" — inventing a payment date, which is
// the exact defect this change exists to remove.
function hasPaymentDate(p) {
  return p.paid_at != null;
}

// Whether the package is currently working for the athlete. Separate question
// from "did money arrive", and the two must not be conflated.
function isLive(p) {
  return p.status === 'active' || p.status === 'paid';
}

// The date caption. Only ever claims a payment when there is a payment date.
function dateLabel(p) {
  if (hasPaymentDate(p)) return `Paid ${fmtDate(p.paid_at)}`;
  if (isLive(p)) return `Active since ${fmtDate(p.created_at)}`;
  return `Assigned ${fmtDate(p.created_at)}`;
}

// #344: returns null — never the string "Invalid Date" — for a missing or
// unparseable timestamp, so a caller can choose its own wording for "we don't
// know". The last-synced line depends on this: a blank or "Invalid Date" there
// would be one more thing on this screen that can't be trusted.
function fmtDateOrNull(d) {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDate(d) {
  return fmtDateOrNull(d) ?? '—';
}

// #344: the two things on this screen are not the same kind of thing and must
// not be read as one list. `product_kind='package'` rows are Square recurring
// SUBSCRIPTIONS; everything else ('lesson', 'bundle') is a one-time purchase.
// Cordell's report is exactly this confusion: Square shows Charles Martin with
// live subscriptions, the portal shows "one pending package", and the two
// numbers were never counting the same thing.
function isSubscription(p) {
  return p.product_kind === 'package';
}

// #344: the billing frequency lives in the product name as a trailing
// "(MONTHLY price)" suffix — see productFamily.js, which owns that pattern for
// the whole app. Written out in full here because staff read this screen next
// to a Square invoice; the terse "/2wk" form used on the duplicate-products
// admin screen is not what a parent's invoice says.
const FREQUENCY_LABELS = {
  MONTHLY: 'Monthly',
  EVERY_TWO_WEEKS: 'Every two weeks',
  EVERY_SIX_MONTHS: 'Every six months',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
};

// A readable frequency for a subscription row. A frequency token Square invents
// later still renders honestly ("EVERY_THREE_WEEKS" -> "Every three weeks"), and
// a name carrying no suffix at all says "Recurring" rather than guessing
// "Monthly" — guessing monthly is how a fortnightly subscription ends up
// under-counted by half.
function frequencyLabel(p) {
  const freq = frequencyOf(p.product_name_snapshot);
  if (!freq) return 'Recurring';
  if (FREQUENCY_LABELS[freq]) return FREQUENCY_LABELS[freq];
  const words = freq.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The title to print. Subscriptions show the clean product name and carry their
// frequency in a badge instead, so "NBP 2x A Week Training (EVERY_TWO_WEEKS
// price)" stops being the thing staff have to parse. The stored name itself is
// untouched — this is display only.
function displayName(p) {
  return (isSubscription(p) && familyLabel(p.product_name_snapshot)) || p.product_name_snapshot;
}

// #307: deleting a purchase that was actually paid for is a refund, not a
// delete — it destroys the record that money was received, and takes the
// customer's session-usage history with it (store_session_usage.purchase_id
// is ON DELETE CASCADE). Refunds belong in Square. Delete is only for
// purchases that never became real money: still pending, or that failed/
// were canceled before payment landed.
const DELETABLE_STATUSES = new Set(['pending', 'canceled', 'failed']);

function timeLeftLabel(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, cls: 'text-red-600' };
  if (days === 0) return { text: 'Expires today', cls: 'text-orange-600' };
  if (days <= 14) return { text: `${days}d left`, cls: 'text-orange-600' };
  return { text: `${days}d left`, cls: 'text-gray-500' };
}

export default function PackagesModal({ userId, userName, canManage, canDelete = false, onClose }) {
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [usageByPurchase, setUsageByPurchase] = useState({});
  const [expanded, setExpanded] = useState({});
  const [busyId, setBusyId] = useState(null);
  // #344: null means "we could not establish a last-sync date" — either the
  // query failed, or store_backfill_runs is empty. It is NEVER used to mean
  // "synced just now"; the fallback wording says the date is unknown.
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('store_purchases')
        .select('id, product_id, product_kind, product_name_snapshot, status, remaining_qty, expires_at, amount_cents, created_at, paid_at, store_products(bundle_qty, kind)')
        .eq('user_id', userId)
        .in('product_kind', ['package', 'bundle', 'lesson'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      // #340: this used to be
      //   .filter(r => r.product_kind === 'package' || r.store_products?.bundle_qty != null)
      // which threw away every lesson purchase whose product had no session
      // count — and bundle_qty is NULL on 77 of the 92 active products. So an
      // athlete could have three assigned packages and this modal showed an
      // empty list. That is exactly what Cordell reported on Colton Kennedy:
      // "he should show one extra assigned payment on his profile".
      //
      // Cordell's actual ask on #340 is to see EVERYTHING assigned to an
      // athlete, so nothing is filtered out here any more. The uncounted ones
      // render with "—" sessions rather than being hidden, which tells staff
      // the truth: the pack is assigned, we just don't know its size yet.
      const list = rows || [];
      setPurchases(list);

      if (list.length > 0) {
        const { data: usage } = await supabase
          .from('store_session_usage')
          .select('id, purchase_id, used_on, source_type, note')
          .in('purchase_id', list.map(p => p.id))
          .order('used_on', { ascending: false });
        const grouped = {};
        (usage || []).forEach(u => {
          (grouped[u.purchase_id] = grouped[u.purchase_id] || []).push(u);
        });
        setUsageByPurchase(grouped);
      } else {
        setUsageByPurchase({});
      }
    } catch (e) {
      console.error('Failed to load packages:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // #344: subscription rows are NOT live data. They exist only because someone
  // pressed the button that runs square-subscriptions-backfill, and they are
  // frozen as of that moment — a subscription started, cancelled or paid since
  // then is missing or wrong here. Charles Martin's invoice was paid a week
  // after the last run, which is why the portal still showed him as pending
  // while Square showed him active and paying.
  //
  // Kept out of load() on purpose: this is a separate concern from the
  // athlete's purchases, and a failure here must not take the package list down
  // with it. Failure just leaves lastSyncedAt null, which renders as "unknown".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('store_backfill_runs')
          .select('ran_at')
          .order('ran_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setLastSyncedAt(data?.ran_at || null);
      } catch (e) {
        console.error('Failed to load last subscription sync:', e);
        if (!cancelled) setLastSyncedAt(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const logUsedSession = async (purchase) => {
    const used_on = window.prompt('Date the session was used (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!used_on) return;
    const note = window.prompt('Optional note (e.g. hitting lesson):', '') || null;
    setBusyId(purchase.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from('store_session_usage').insert({
        purchase_id: purchase.id,
        user_id: userId,
        used_on,
        source_type: 'manual',
        note,
        created_by: user?.id || null,
      });
      if (insErr) throw insErr;
      // Decrement remaining count when we know it.
      if (purchase.remaining_qty != null && purchase.remaining_qty > 0) {
        const { error: updErr } = await supabase.from('store_purchases')
          .update({ remaining_qty: purchase.remaining_qty - 1 })
          .eq('id', purchase.id);
        if (updErr) throw updErr;
      }
      await load();
      setExpanded(prev => ({ ...prev, [purchase.id]: true }));
    } catch (e) {
      alert('Error logging session: ' + formatUserError(e));
    } finally {
      setBusyId(null);
    }
  };

  const editRemaining = async (purchase) => {
    const val = window.prompt('Sessions remaining:', purchase.remaining_qty ?? '');
    if (val === null) return;
    const n = val.trim() === '' ? null : parseInt(val, 10);
    if (n !== null && (Number.isNaN(n) || n < 0)) return alert('Enter a non-negative number.');
    setBusyId(purchase.id);
    try {
      const { error } = await supabase.from('store_purchases').update({ remaining_qty: n }).eq('id', purchase.id);
      if (error) throw error;
      await load();
    } catch (e) { alert('Error: ' + formatUserError(e)); } finally { setBusyId(null); }
  };

  const editExpiry = async (purchase) => {
    const cur = purchase.expires_at ? new Date(purchase.expires_at).toISOString().slice(0, 10) : '';
    const val = window.prompt('Expiration date (YYYY-MM-DD, blank to clear):', cur);
    if (val === null) return;
    const iso = val.trim() === '' ? null : new Date(val + 'T23:59:59').toISOString();
    if (val.trim() !== '' && Number.isNaN(new Date(iso).getTime())) return alert('Invalid date.');
    setBusyId(purchase.id);
    try {
      const { error } = await supabase.from('store_purchases').update({ expires_at: iso }).eq('id', purchase.id);
      if (error) throw error;
      await load();
    } catch (e) { alert('Error: ' + formatUserError(e)); } finally { setBusyId(null); }
  };

  const deletePackage = async (purchase) => {
    const usageCount = (usageByPurchase[purchase.id] || []).length;
    const parts = [usageCount > 0
      ? `This package has ${usageCount} logged session(s). Deleting it will also remove those usage records. Continue?`
      : `Delete "${purchase.product_name_snapshot}" from this account? This cannot be undone.`];

    if (isSubscription(purchase)) {
      // #344: Cordell asked for "the option to choose which one to cancel /
      // delete". Cancel and delete are not the same action and conflating them
      // costs real money: this button only removes the portal's row, Square
      // keeps billing the card either way, and once the row is gone staff have
      // lost the thing that told them the subscription exists at all.
      // Cancelling is a Square action and is deliberately not offered here.
      parts.push('This removes the portal\'s record only. It does NOT cancel the subscription and does NOT stop Square billing them — to actually stop the charges, cancel the subscription in Square.');
      // #341/#344 combined into one sentence rather than two walls of text: a
      // subscription row is never marked paid by a webhook (#341) AND is only
      // as fresh as the last manual backfill (#344), so the single honest
      // instruction for both is "Square is the source of truth, go look".
      parts.push('What this row says came from the last manual Square sync, so it may already be out of date. Check Square before continuing.');
    } else if (!hasPaymentDate(purchase)) {
      // #341: "Awaiting payment" currently means "Square never told us", not
      // "the athlete didn't pay" — so spell that out at the moment of deletion,
      // which is the point of no return.
      parts.push('This package has no payment confirmed in the portal. Square payment confirmations are not currently syncing, so it may still have been paid. Check Square before continuing.');
    }

    if (!window.confirm(parts.join('\n\n'))) return;
    setBusyId(purchase.id);
    try {
      if (usageCount > 0) {
        const { error: usageErr } = await supabase.from('store_session_usage').delete().eq('purchase_id', purchase.id);
        if (usageErr) throw usageErr;
      }
      const { error } = await supabase.from('store_purchases').delete().eq('id', purchase.id);
      if (error) throw error;
      await load();
    } catch (e) { alert('Error deleting package: ' + formatUserError(e)); } finally { setBusyId(null); }
  };

  // #341: Square payment confirmations are not currently reaching the portal —
  // store_webhook_events has never recorded a single event, so no one-time
  // purchase has ever been marked paid. That means "Awaiting payment" is NOT
  // proof the athlete didn't pay; Square may well hold a completed payment for
  // it. Staff must not delete on the strength of this screen alone. The notice
  // is driven by the data, so it disappears by itself once payments sync.
  const unconfirmedCount = purchases.filter(p => !hasPaymentDate(p) && !isLive(p)).length;

  // #344: one flat list made "how many packages are running?" unanswerable —
  // a recurring subscription and a one-off lesson pack sat side by side looking
  // identical. Split, recurring first: that is the group that keeps charging a
  // card whether or not this screen is right about it. Order inside each group
  // is untouched (newest first, from the query).
  const subscriptions = purchases.filter(isSubscription);
  const oneTimePurchases = purchases.filter(p => !isSubscription(p));
  const syncedOn = fmtDateOrNull(lastSyncedAt);

  // One row. Extracted only so the two groups render byte-identical markup —
  // the row itself is unchanged apart from the #344 frequency badge.
  const renderPurchase = (p) => {
    const total = p.store_products?.bundle_qty ?? null;
    const usage = usageByPurchase[p.id] || [];
    const isOpen = !!expanded[p.id];
    const tl = timeLeftLabel(p.expires_at);
    const busy = busyId === p.id;
    return (
      <div key={p.id} className="border border-gray-200 rounded-lg">
        <button
          onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isOpen ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />}
              <span className="font-medium text-gray-900 truncate">{displayName(p)}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{STATUS_LABELS[p.status] || p.status}</span>
              {/* #344: how often Square bills this. Cordell was comparing a
                  portal row against a Square invoice with no way to tell a
                  fortnightly plan from a monthly one. */}
              {isSubscription(p) && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-indigo-50 text-indigo-700 border-indigo-200 flex-shrink-0">{frequencyLabel(p)}</span>
              )}
            </div>
            {/* #340: this line used to read "Purchased {paid_at || created_at}".
                paid_at is NULL on every lesson-pack purchase in production, so it
                silently fell back to the date the pack was ASSIGNED and captioned
                it "Purchased" — telling staff money had been received when the
                portal has no such record. Cordell photographed exactly this: three
                rows reading "Purchased <date>" and "pending" at the same time.
                Never claim a purchase we cannot evidence. */}
            <div className="text-xs text-gray-500 mt-1 ml-6">{dateLabel(p)}</div>
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <div className="text-sm font-semibold text-gray-900">
              {/* #344: this said "Monthly" for every subscription regardless of
                  what Square actually bills — a fortnightly plan read as monthly
                  on the one line meant to describe it. The real frequency is in
                  the badge above; here we only say that it recurs. */}
              {p.remaining_qty != null ? `${p.remaining_qty}${total != null ? ` / ${total}` : ''} left` : (isSubscription(p) ? 'Recurring' : '—')}
            </div>
            {tl && <div className={`text-xs ${tl.cls}`}>{tl.text}</div>}
          </div>
        </button>

        {isOpen && (
          <div className="border-t border-gray-100 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-gray-400">Sessions used</div>
                <div className="text-gray-900 font-medium">{usage.length}{total != null ? ` of ${total}` : ''}</div>
              </div>
              <div>
                <div className="text-gray-400">Expires</div>
                <div className="text-gray-900 font-medium">{fmtDate(p.expires_at)}</div>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Usage history</div>
              {usage.length === 0 ? (
                <p className="text-xs text-gray-400">No sessions logged yet.</p>
              ) : (
                <ul className="space-y-1">
                  {usage.map(u => (
                    <li key={u.id} className="flex items-center gap-2 text-xs text-gray-700">
                      <Calendar size={12} className="text-gray-400 flex-shrink-0" />
                      <span className="font-medium">{fmtDate(u.used_on)}</span>
                      {u.note && <span className="text-gray-500 truncate">— {u.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canManage && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => logUsedSession(p)} disabled={busy} className="flex items-center gap-1 bg-indigo-600 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                  <Plus size={12} /> Log used session
                </button>
                <button onClick={() => editRemaining(p)} disabled={busy} className="border border-gray-300 text-gray-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50">Edit remaining</button>
                <button onClick={() => editExpiry(p)} disabled={busy} className="border border-gray-300 text-gray-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50">Set expiration</button>
                {/* #307/#341: unchanged — only purchases that never became real
                    money are deletable at all. A live subscription has no delete
                    button here on purpose; stopping it is a Square action. */}
                {canDelete && DELETABLE_STATUSES.has(p.status) && (
                  <button onClick={() => deletePackage(p)} disabled={busy} className="flex items-center gap-1 border border-red-300 text-red-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-red-50 transition disabled:opacity-50">
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[88vh] flex flex-col">
        <div className="border-b border-gray-200 p-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Package size={20} className="text-indigo-600" />
            <h3 className="text-lg font-bold text-gray-900">Packages{userName ? ` — ${userName}` : ''}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={22} /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-3">
          {!loading && unconfirmedCount > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold mb-1">Check Square before deleting anything here.</p>
              <p>
                {unconfirmedCount === 1 ? 'One package on this account has' : `${unconfirmedCount} packages on this account have`}{' '}
                no payment confirmed in the portal. Payment confirmations from Square are
                not currently reaching us, so some of these may in fact have been paid.
                Confirm in Square first — deleting a package the athlete paid for cannot be undone.
              </p>
            </div>
          )}
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Loading packages…</p>
          ) : (
            <>
              {/* #344: THE SUBSCRIPTIONS SECTION ALWAYS RENDERS, even with zero
                  rows — and that is the whole point of this fix, not a detail.
                  The first version put the staleness warning inside the group,
                  so it only appeared for athletes who already had a subscription
                  on file. But the reported failure is the exact opposite case: a
                  subscription that STARTED AFTER the last sync has no row here at
                  all, so the screen would have said nothing and silently implied
                  the athlete has no subscriptions. That is what happened to
                  Charles Martin. "We have none on file as of <date>" is a very
                  different statement from "they have none", and staff comparing
                  this screen against Square need to be told which one they are
                  looking at. */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Subscriptions (recurring)</h4>
                  {/* These rows are a manual snapshot taken by
                      square-subscriptions-backfill, not live Square data, so the
                      screen states how old it is rather than letting staff assume
                      it is current. Charles Martin's invoice was paid a week after
                      the last run — the portal could not have known. */}
                  <p className="text-xs text-gray-400 mt-1">
                    {syncedOn
                      ? `Subscriptions last synced from Square on ${syncedOn}. Anything started or cancelled since then may not appear here.`
                      : 'Subscriptions are synced from Square manually and the date of the last sync is unknown. Anything started or cancelled since then may not appear here.'}
                  </p>
                  {/* #344: Cordell asked to "cancel / delete" as if they were
                      one action. They are not, and the difference is money. */}
                  <p className="text-xs text-gray-400 mt-1">
                    Cancelling a subscription can only be done in Square. Deleting a row here removes the portal&apos;s record only and does not stop the billing.
                  </p>
                </div>
                {subscriptions.length > 0 ? (
                  subscriptions.map(renderPurchase)
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 p-3">
                    <p className="text-sm text-gray-600">
                      {syncedOn
                        ? `No subscriptions on file as of ${syncedOn}.`
                        : 'No subscriptions on file.'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      That is what the portal holds, not what Square holds. If this athlete is being
                      billed, check Square — a subscription started since the last sync will not be here.
                    </p>
                  </div>
                )}
              </div>
              {purchases.length === 0 && (
                <div className="text-center py-6">
                  <Package size={32} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No one-time packages assigned yet.</p>
                </div>
              )}
              {oneTimePurchases.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Packages &amp; lessons (one-time)</h4>
                  {oneTimePurchases.map(renderPurchase)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
