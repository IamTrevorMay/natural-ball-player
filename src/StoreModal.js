import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { X, ShoppingBag, Loader2, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useModalTracking, trackAction } from './usage';
import { PAYMENT_DUE_NOTICES_ENABLED } from './useNotifications';

const KIND_LABEL = {
  lesson: 'Lessons',
  package: 'Monthly Packages',
  bundle: 'Lesson Bundles',
  rental: 'Cage / Lane Rentals',
};
const KIND_ORDER = ['lesson', 'bundle', 'package', 'rental'];

function fmtMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusPill({ status }) {
  const map = {
    paid:     { cls: 'bg-green-100 text-green-700',  icon: CheckCircle, label: 'Paid' },
    active:   { cls: 'bg-green-100 text-green-700',  icon: CheckCircle, label: 'Active' },
    // #341: this pill is athlete-facing and 'pending' is not a fact about
    // money — the Square payment webhook has never delivered an event, so a
    // purchase Cordell watched get paid still reads 'pending' here. "Pending"
    // invited the reading "you haven't paid"; say only what we know, which is
    // that no confirmation has reached the portal. Staff screens use #340's
    // "Awaiting payment" (PackagesModal/Profile) — same claim, staff voice.
    pending:  { cls: 'bg-yellow-100 text-yellow-800',icon: Clock,       label: 'Payment not confirmed' },
    // See the note on PKG_STATUS_LABELS in WorkStore.js: this maps from Square's
    // PAUSED, never from an unpaid bill. Neutral colour, no alarm icon.
    past_due: { cls: 'bg-slate-100 text-slate-700',  icon: Clock,       label: 'Paused' },
    failed:   { cls: 'bg-red-100 text-red-700',      icon: AlertCircle, label: 'Failed' },
    canceled: { cls: 'bg-gray-100 text-gray-700',    icon: X,           label: 'Canceled' },
    refunded: { cls: 'bg-gray-100 text-gray-700',    icon: X,           label: 'Refunded' },
  };
  const m = map[status] || { cls: 'bg-gray-100 text-gray-700', icon: Clock, label: status };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}>
      <Icon size={12} /> {m.label}
    </span>
  );
}

// `userId` is the profile being VIEWED, not necessarily the person clicking.
// `loggedInUserId` is the person clicking. They are the same today — the Pay
// button that opens this is gated on `!onBack` (Profile.js:2182), i.e. your own
// profile only — but see the #394-shaped note on handleBuy below for why this
// component no longer assumes that.
export default function StoreModal({ userId, onClose, loggedInUserId }) {
  const isSelf = loggedInUserId == null || loggedInUserId === userId;
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: prods }, { data: purch }] = await Promise.all([
        supabase.from('store_products').select('*').eq('active', true).order('sort_order'),
        supabase.from('store_purchases').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(25),
      ]);
      if (cancelled) return;
      setProducts(prods || []);
      setPurchases(purch || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Same shape as #394, one layer down, and this one moves money.
  //
  // The read above is scoped to `userId` (the viewed athlete) and rendered
  // under "My Purchases". This call used to send no target at all, and
  // square-checkout falls back to `buyerId = user.id` — the CALLER
  // (square-checkout/index.ts:80). So the list showed the athlete's purchases
  // while the button bought for whoever pressed it: a store_purchases row
  // against the coach, a payment link in the coach's name and email.
  //
  // Not reachable today: the only entry point is gated `!onBack`, so only the
  // athlete themself can open this, and buying for yourself is correct. It is
  // fixed anyway because the gate immediately below it (Profile.js:2195) has
  // ALREADY been widened to coaches for #340. "Let a coach take payment from
  // the athlete's page" is an obvious next ask, and one edit to line 2182 would
  // turn this into a real money bug with nothing here to resist it.
  //
  // square-checkout enforces the permission itself — it 403s a non-staff caller
  // who passes a target other than themselves — so sending it is safe for
  // players and correct for staff. AssignPackageModal.js:634 already does this.
  const handleBuy = async (product) => {
    setBuying(product.id);
    setError('');
    try {
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
            target_user_id: userId,
            return_url: `${window.location.origin}/?store_return=1`,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Checkout failed');
      window.location.href = json.checkout_url;
    } catch (err) {
      setError(err.message);
      setBuying(null);
    }
  };

  const grouped = KIND_ORDER
    .map(kind => ({ kind, items: products.filter(p => p.kind === kind) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <ShoppingBag size={22} className="text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Store</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>
          )}

          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading…</div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No products available yet.</div>
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
                        onClick={() => handleBuy(p)}
                        disabled={buying === p.id}
                        className="ml-4 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-60 flex items-center gap-2"
                      >
                        {buying === p.id ? <Loader2 size={16} className="animate-spin" /> : null}
                        {buying === p.id ? 'Redirecting…' : 'Buy'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {purchases.length > 0 && (
            <div className="pt-4 border-t">
              {/* "My Purchases" is only true when you are looking at yourself.
                  If this ever opens on someone else's profile, saying "My"
                  over their rows is how a coach misreads whose money this is. */}
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
                {isSelf ? 'My Purchases' : 'This Athlete’s Purchases'}
              </h3>
              <div className="space-y-1">
                {purchases.map(pu => (
                  <div key={pu.id} className="flex items-center justify-between text-sm px-2 py-1.5 hover:bg-gray-50 rounded">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{pu.product_name_snapshot}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(pu.created_at).toLocaleDateString()} · {fmtMoney(pu.amount_cents)}
                        {pu.remaining_qty != null ? ` · ${pu.remaining_qty} remaining` : ''}
                      </p>
                      {/* #341: shown whenever the pill says "Payment not
                          confirmed", flag or no flag — the pill is visible
                          either way and an athlete who paid in Square deserves
                          to be told the portal's silence isn't a bill. */}
                      {pu.status === 'pending' && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          If you've already paid, you're all set — no action needed.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={pu.status} />
                      {/* #341: the pay-again link is behind
                          PAYMENT_DUE_NOTICES_ENABLED (useNotifications.js,
                          currently false). It sends the athlete to the original
                          live Square checkout_url, and with the payment webhook
                          never having fired, 'pending' includes purchases that
                          were really paid — so "Complete" was offering paying
                          customers a second charge. It comes back, reworded, on
                          the day Square confirmations are verified arriving. */}
                      {PAYMENT_DUE_NOTICES_ENABLED && pu.status === 'pending' && pu.checkout_url && (
                        <a
                          href={pu.checkout_url}
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Finish checkout
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
