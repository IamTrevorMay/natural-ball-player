import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { X, ShoppingBag, Loader2, CheckCircle, Clock, AlertCircle } from 'lucide-react';

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
    pending:  { cls: 'bg-yellow-100 text-yellow-800',icon: Clock,       label: 'Pending' },
    past_due: { cls: 'bg-orange-100 text-orange-800',icon: AlertCircle, label: 'Past due' },
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

export default function StoreModal({ userId, onClose }) {
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
                          {p.kind === 'bundle' && p.bundle_qty ? ` · ${p.bundle_qty} lessons` : ''}
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
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">My Purchases</h3>
              <div className="space-y-1">
                {purchases.map(pu => (
                  <div key={pu.id} className="flex items-center justify-between text-sm px-2 py-1.5 hover:bg-gray-50 rounded">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{pu.product_name_snapshot}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(pu.created_at).toLocaleDateString()} · {fmtMoney(pu.amount_cents)}
                        {pu.remaining_qty != null ? ` · ${pu.remaining_qty} remaining` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={pu.status} />
                      {pu.status === 'pending' && pu.checkout_url && (
                        <a
                          href={pu.checkout_url}
                          className="text-xs text-blue-600 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Complete
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
