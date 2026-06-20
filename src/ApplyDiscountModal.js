import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { X, BadgePercent, Loader2 } from 'lucide-react';
import { useModalTracking, trackAction } from './usage';

function fmtDiscount(d) {
  if (d.percentage != null) return `${Number(d.percentage).toFixed(d.percentage % 1 ? 1 : 0)}% off`;
  if (d.amount_cents != null) return `$${(d.amount_cents / 100).toFixed(2)} off`;
  return 'Discount';
}

export default function ApplyDiscountModal({ playerId, playerName, onClose, onApplied }) {
  const [discounts, setDiscounts] = useState([]);
  const [purchase, setPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const [{ data: ds }, { data: p }] = await Promise.all([
      supabase.from('store_discounts').select('*').eq('active', true).order('name'),
      supabase
        .from('store_purchases')
        .select('id, amount_cents, discounted_price_cents, applied_discount_id, product_name_snapshot, status')
        .eq('user_id', playerId)
        .eq('product_kind', 'package')
        .in('status', ['active', 'past_due', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setDiscounts(ds || []);
    setPurchase(p || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const callApply = async (discount_id) => {
    setBusy(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL || 'https://cjilkqzifyhssbsiqgfu.supabase.co'}/functions/v1/square-apply-discount`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ user_id: playerId, discount_id }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Apply failed');
      await load();
      onApplied?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <BadgePercent size={22} className="text-indigo-600" />
            <h2 className="text-xl font-bold text-gray-900">Apply Discount</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            Applies an ongoing price override on <span className="font-medium">{playerName}</span>'s
            active Square subscription. Every future cycle bills at the discounted price until removed.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>
          )}

          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading…</div>
          ) : !purchase ? (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-4 py-3 text-sm">
              No active subscription found for this player. They must complete a monthly package purchase first.
            </div>
          ) : (
            <>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm">
                <div className="font-medium text-gray-900">{purchase.product_name_snapshot}</div>
                <div className="text-gray-600 mt-1">
                  Base: ${(purchase.amount_cents / 100).toFixed(2)} / mo
                </div>
                {purchase.discounted_price_cents != null && (
                  <div className="text-green-700 font-medium mt-1">
                    Current billed: ${(purchase.discounted_price_cents / 100).toFixed(2)} / mo
                  </div>
                )}
              </div>

              {purchase.applied_discount_id && (
                <button
                  onClick={() => callApply(null)}
                  disabled={busy}
                  className="w-full bg-white border border-red-300 text-red-700 px-4 py-2 rounded-lg hover:bg-red-50 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  Remove Current Discount
                </button>
              )}

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Available Discounts
                </h3>
                {discounts.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No discounts synced. Run "Sync from Square" in Work Portal → Store.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {discounts.map(d => {
                      const isApplied = d.id === purchase.applied_discount_id;
                      return (
                        <div
                          key={d.id}
                          className={`border rounded-lg px-4 py-3 flex items-center justify-between ${
                            isApplied ? 'border-green-300 bg-green-50' : 'border-gray-200'
                          }`}
                        >
                          <div>
                            <p className="font-medium text-gray-900">{d.name}</p>
                            <p className="text-sm text-gray-600">{fmtDiscount(d)}</p>
                          </div>
                          <button
                            onClick={() => callApply(d.id)}
                            disabled={busy || isApplied}
                            className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-60 flex items-center gap-2"
                          >
                            {busy && <Loader2 size={16} className="animate-spin" />}
                            {isApplied ? 'Applied' : 'Apply'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
