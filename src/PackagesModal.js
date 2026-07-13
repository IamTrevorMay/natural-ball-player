import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { X, ChevronDown, ChevronRight, Plus, Calendar, Package } from 'lucide-react';
import { formatUserError } from './errorMessage';

// #235: full package history for a single player. Shows every active & past
// package/bundle they purchased, how many sessions are left, when each session
// was used, and how much time is left before the package expires. Staff can log
// a used session, adjust the remaining count, and set an expiration date.
const STATUS_STYLES = {
  active:   'bg-green-50 text-green-700 border-green-200',
  paid:     'bg-green-50 text-green-700 border-green-200',
  pending:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  past_due: 'bg-orange-50 text-orange-700 border-orange-200',
  failed:   'bg-red-50 text-red-700 border-red-200',
  canceled: 'bg-gray-100 text-gray-500 border-gray-200',
  refunded: 'bg-gray-100 text-gray-500 border-gray-200',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeLeftLabel(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, cls: 'text-red-600' };
  if (days === 0) return { text: 'Expires today', cls: 'text-orange-600' };
  if (days <= 14) return { text: `${days}d left`, cls: 'text-orange-600' };
  return { text: `${days}d left`, cls: 'text-gray-500' };
}

export default function PackagesModal({ userId, userName, canManage, onClose }) {
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [usageByPurchase, setUsageByPurchase] = useState({});
  const [expanded, setExpanded] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Packages + bundles carry session counts; lessons are single-use one-offs.
      const { data: rows, error } = await supabase
        .from('store_purchases')
        .select('id, product_id, product_kind, product_name_snapshot, status, remaining_qty, expires_at, amount_cents, created_at, paid_at, store_products(bundle_qty, kind)')
        .eq('user_id', userId)
        .in('product_kind', ['package', 'bundle'])
        .order('created_at', { ascending: false });
      if (error) throw error;
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
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Loading packages…</p>
          ) : purchases.length === 0 ? (
            <div className="text-center py-10">
              <Package size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No packages or bundles purchased yet.</p>
            </div>
          ) : purchases.map(p => {
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
                      <span className="font-medium text-gray-900 truncate">{p.product_name_snapshot}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{p.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 ml-6">Purchased {fmtDate(p.paid_at || p.created_at)}</div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="text-sm font-semibold text-gray-900">
                      {p.remaining_qty != null ? `${p.remaining_qty}${total != null ? ` / ${total}` : ''} left` : (p.product_kind === 'package' ? 'Monthly' : '—')}
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
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
