import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { X, ShoppingBag, Loader2, CheckCircle, Copy } from 'lucide-react';
import { useModalTracking, trackAction } from './usage';

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

// Staff-facing: assign a store product/package to a player. Creates a pending
// charge (via square-checkout on the player's behalf) and surfaces the checkout
// link so the coach can share it — the player is also notified in-app (#213).
export default function AssignPackageModal({ playerId, playerName, onClose, onAssigned }) {
  useModalTracking('AssignPackageModal');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { product_name, checkout_url }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('store_products')
        .select('*')
        .eq('active', true)
        .order('sort_order');
      if (cancelled) return;
      setProducts(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleAssign = async (product) => {
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <ShoppingBag size={22} className="text-indigo-600" />
            <h2 className="text-xl font-bold text-gray-900">Assign Payment</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {result ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-gray-800">
                  <p className="font-medium">Assigned “{result.product_name}” to {playerName}.</p>
                  <p className="text-gray-600 mt-1">
                    A pending payment now appears in {playerName?.split(' ')[0] || 'their'} account and in their
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
              <button
                onClick={onClose}
                className="w-full border border-gray-300 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-50 transition"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Choose what to charge <span className="font-medium">{playerName}</span>. This creates a
                pending payment they can complete — useful for package changes, facility fines, or any other charge.
              </p>

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
                            onClick={() => handleAssign(p)}
                            disabled={assigning === p.id}
                            className="ml-4 bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-60 flex items-center gap-2"
                          >
                            {assigning === p.id ? <Loader2 size={16} className="animate-spin" /> : null}
                            {assigning === p.id ? 'Assigning…' : 'Assign'}
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
      </div>
    </div>
  );
}
