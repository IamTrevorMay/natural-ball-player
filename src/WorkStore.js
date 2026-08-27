import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Plus, Trash2, Edit2, Save, X, ShoppingBag, ListChecks, RefreshCw, History, Package, Tag, Layers, Link2, HeartPulse } from 'lucide-react';
import BackfillHistory from './BackfillHistory';
import InvoiceReconcile from './InvoiceReconcile';
import CancellationReview from './CancellationReview';
import BulkTagSessions from './BulkTagSessions';
import DuplicateProducts from './DuplicateProducts';
import { latestExtension } from './packageExtension';

const KIND_OPTIONS = [
  { value: 'lesson',  label: 'Lesson (one-time)' },
  { value: 'bundle',  label: 'Lesson Bundle (one-time)' },
  { value: 'package', label: 'Monthly Package (subscription)' },
  { value: 'rental',  label: 'Cage / Lane Rental (one-time)' },
];

const STATUS_COLORS = {
  paid:     'bg-green-100 text-green-700',
  active:   'bg-green-100 text-green-700',
  pending:  'bg-yellow-100 text-yellow-800',
  past_due: 'bg-slate-100 text-slate-700',
  failed:   'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-700',
  canceled: 'bg-gray-100 text-gray-700',
};

function emptyDraft() {
  return {
    kind: 'lesson',
    name: '',
    description: '',
    price_dollars: '',
    recurring: false,
    bundle_qty: '',
    square_catalog_id: '',
    square_plan_id: '',
    square_variation_id: '',
    active: true,
    sort_order: 0,
  };
}

function CatalogTab() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('store_products')
      .select('*')
      .order('kind')
      .order('sort_order');
    if (error) setError(error.message);
    setProducts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const startEdit = (p) => {
    setEditingId(p.id);
    setDraft({
      kind: p.kind,
      name: p.name,
      description: p.description || '',
      price_dollars: (p.price_cents / 100).toFixed(2),
      recurring: p.recurring,
      bundle_qty: p.bundle_qty || '',
      square_catalog_id: p.square_catalog_id || '',
      square_plan_id: p.square_plan_id || '',
      square_variation_id: p.square_variation_id || '',
      active: p.active,
      sort_order: p.sort_order,
    });
    setCreating(false);
  };

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setDraft(emptyDraft());
    setError('');
  };

  const save = async () => {
    setError('');
    if (!draft.name.trim()) { setError('Name required'); return; }
    const priceNum = Number(draft.price_dollars);
    if (Number.isNaN(priceNum) || priceNum < 0) { setError('Invalid price'); return; }
    const payload = {
      kind: draft.kind,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      price_cents: Math.round(priceNum * 100),
      recurring: draft.kind === 'package' && draft.recurring,
      bundle_qty: (draft.kind === 'bundle' || draft.kind === 'lesson') && draft.bundle_qty ? Number(draft.bundle_qty) : null,
      square_catalog_id: draft.square_catalog_id.trim() || null,
      square_plan_id: draft.square_plan_id.trim() || null,
      square_variation_id: draft.square_variation_id.trim() || null,
      active: draft.active,
      sort_order: Number(draft.sort_order) || 0,
    };
    let res;
    if (creating) {
      res = await supabase.from('store_products').insert(payload);
    } else {
      res = await supabase.from('store_products').update(payload).eq('id', editingId);
    }
    if (res.error) { setError(res.error.message); return; }
    cancel();
    fetchProducts();
  };

  const syncFromSquare = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL || 'https://cjilkqzifyhssbsiqgfu.supabase.co'}/functions/v1/square-catalog-sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      setSyncResult(json);
      await fetchProducts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this product?')) return;
    const { error } = await supabase.from('store_products').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    fetchProducts();
  };

  const backfillSubscriptions = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL || 'https://cjilkqzifyhssbsiqgfu.supabase.co'}/functions/v1/square-subscriptions-backfill`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Backfill failed');
      setSyncResult({
        inserted: json.inserted,
        updated: json.updated,
        skipped: (json.unmatched_user || 0) + (json.unmatched_product || 0),
        errors: (json.unmatched_details || []).map(d =>
          `${d.subscription_id}: ${d.reason}${d.email ? ` (${d.email})` : ''}${d.plan_variation_id ? ` [plan ${d.plan_variation_id}]` : ''}`
        ),
        rawUnmatched: json.unmatched_details || [],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const renderForm = () => (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Kind</label>
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          >
            {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
          <textarea
            rows={2}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Price (USD)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={draft.price_dollars}
            onChange={(e) => setDraft({ ...draft, price_dollars: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Sort order</label>
          <input
            type="number"
            value={draft.sort_order}
            onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        {draft.kind === 'package' && (
          <>
            <div className="flex items-center space-x-2 mt-6">
              <input
                id="recurring"
                type="checkbox"
                checked={draft.recurring}
                onChange={(e) => setDraft({ ...draft, recurring: e.target.checked })}
              />
              <label htmlFor="recurring" className="text-sm text-gray-700">Recurring (monthly)</label>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Square Plan Variation ID</label>
              <input
                type="text"
                value={draft.square_variation_id}
                onChange={(e) => setDraft({ ...draft, square_variation_id: e.target.value })}
                placeholder="set up plan in Square first"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </>
        )}
        {(draft.kind === 'bundle' || draft.kind === 'lesson') && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sessions in this package</label>
            <input
              type="number"
              min="1"
              value={draft.bundle_qty}
              onChange={(e) => setDraft({ ...draft, bundle_qty: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-1">
              How many sessions this package holds. Leave blank for things that aren't sessions — deposits, fines, discounts, memberships.
            </p>
          </div>
        )}
        <div className="flex items-center space-x-2 mt-6">
          <input
            id="active"
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          <label htmlFor="active" className="text-sm text-gray-700">Active</label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex space-x-2">
        <button
          onClick={save}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center space-x-2"
        >
          <Save size={16} />
          <span>Save</span>
        </button>
        <button
          onClick={cancel}
          className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 flex items-center space-x-2"
        >
          <X size={16} />
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-600">Active products show to players in the Store on their profile.</p>
        {/* QA 2026-08-15: this 415px button row did not wrap, so "Add Product"
            was sliced off at 390px. Its parent already wraps; this one didn't. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={syncFromSquare}
            disabled={syncing}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60 flex items-center space-x-2"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            <span>{syncing ? 'Syncing…' : 'Sync from Square'}</span>
          </button>
          <button
            onClick={backfillSubscriptions}
            disabled={syncing}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60 flex items-center space-x-2"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            <span>{syncing ? 'Working…' : 'Backfill Subscriptions'}</span>
          </button>
          {!creating && editingId === null && (
            <button
              onClick={() => { setCreating(true); setDraft(emptyDraft()); }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center space-x-2"
            >
              <Plus size={18} />
              <span>Add Product</span>
            </button>
          )}
        </div>
      </div>

      {syncResult && (
        <div className="space-y-2">
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-2 text-sm">
            Synced: {syncResult.inserted} added, {syncResult.updated} updated, {syncResult.skipped} skipped.
          </div>
          {syncResult.rawUnmatched?.length > 0 && (
            <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm font-semibold text-red-800">
                {syncResult.rawUnmatched.length} unmatched
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Reason</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Customer</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Square sub</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Square status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {syncResult.rawUnmatched.map(u => (
                      <tr key={u.subscription_id}>
                        <td className="px-3 py-1.5 text-red-700">{u.reason}</td>
                        <td className="px-3 py-1.5">{u.customer_name || '—'}</td>
                        <td className="px-3 py-1.5">{u.email || '—'}</td>
                        <td className="px-3 py-1.5">{u.product_name || u.plan_variation_id || '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-500">{u.subscription_id}</td>
                        <td className="px-3 py-1.5">{u.square_status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {creating && renderForm()}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : products.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No products yet.</div>
      ) : (
        // QA 2026-08-15: was `overflow-hidden`, which clipped the catalog table
        // on a phone instead of letting it scroll.
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kind</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {products.map(p => (
                <React.Fragment key={p.id}>
                  <tr>
                    <td className="px-4 py-2 text-sm text-gray-700 capitalize">{p.kind}</td>
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">{p.name}</td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      ${(p.price_cents / 100).toFixed(2)}{p.recurring ? ' / mo' : ''}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {p.active
                        ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Yes</span>
                        : <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs">No</span>}
                    </td>
                    <td className="px-4 py-2 text-right space-x-2">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-indigo-600 hover:text-indigo-800"
                        aria-label="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        className="text-red-600 hover:text-red-800"
                        aria-label="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                  {editingId === p.id && (
                    <tr>
                      <td colSpan={5} className="px-4 py-3 bg-gray-50">{renderForm()}</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// #358: staff can settle a purchase by hand.
//
// WHY THIS EXISTS. A purchase made through the portal's own checkout link now
// marks itself paid — Square's webhook matches on square_order_id and flips the
// row (proven live 2026-08-19: created 21:42, paid 21:45, no human involved).
// But most money at NBP arrives another way: a Square invoice sent from the
// dashboard, or a card at the front desk. Those payments carry an order id that
// the portal has never seen, so they can never match. 140 purchases sat
// 'pending' for two months for exactly this reason.
//
// There is NO key that links a Square invoice to a portal purchase —
// square_customer_id is NULL on every one of those rows — so this cannot be
// automated. A person has to confirm it. That is what these two buttons are.
//
// CANCEL, NOT DELETE (Cordell's call, 2026-08-19). Cancelling takes the
// purchase out of the athlete's account exactly like deleting would — every
// "does this athlete own it" check keys off status in ('active','paid') — but
// the row survives, so the history of what was assigned and unwound is intact.
// The DELETE policy on store_purchases is admin-only anyway; UPDATE is open to
// admin and coach, which is why both roles can use these.
function PurchasesTab({ userRole }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('store_purchases')
        .select('*, user:users!store_purchases_user_id_fkey(full_name, email)')
        .order('created_at', { ascending: false })
        .limit(500);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  // Only rows that are genuinely unsettled can be marked paid. A row that is
  // already paid/active must not be re-stamped — that would overwrite a real
  // paid_at from Square with today's date and lose when the money actually
  // landed. 'refunded' and 'canceled' are terminal and are left alone.
  // Cordell, 2026-08-19: "1. Admins and coaches".
  const canAct = userRole === 'admin' || userRole === 'coach';

  const canMarkPaid = (r) => ['pending', 'failed', 'past_due'].includes(r.status);
  const canCancel   = (r) => !['canceled', 'refunded'].includes(r.status);

  const money = (r) => `$${((r.discounted_price_cents ?? r.amount_cents) / 100).toFixed(2)}`;

  // Both actions go through here. Every Supabase call in this file historically
  // dropped `error` on the floor, which is how a failed write came to look
  // exactly like a successful one (see the #272 end_time bug). Destructure it,
  // check it, and say so on screen.
  const applyUpdate = async (row, patch, verb) => {
    setBusyId(row.id);
    setNote(null);
    const { data, error } = await supabase
      .from('store_purchases')
      .update(patch)
      .eq('id', row.id)
      .select('*, user:users!store_purchases_user_id_fkey(full_name, email)');
    setBusyId(null);

    if (error) {
      setNote({ kind: 'error', text: `Could not ${verb}: ${error.message}` });
      return;
    }
    // RLS returns success with zero rows when the policy blocks the write, so
    // an empty array is a silent failure, not a success. Treat it as one.
    if (!data || data.length === 0) {
      setNote({ kind: 'error', text: `Could not ${verb} — the change was refused. You may not have permission, or the purchase no longer exists.` });
      return;
    }
    setRows(prev => prev.map(r => (r.id === row.id ? data[0] : r)));
    setNote({ kind: 'ok', text: `${row.user?.full_name || 'Purchase'} — ${row.product_name_snapshot} ${verb === 'mark this as paid' ? 'marked as paid' : 'cancelled'}.` });
  };

  const markPaid = (r) => {
    const ok = window.confirm(
      `Mark this as PAID?\n\n` +
      `${r.user?.full_name || 'Unknown'} — ${r.product_name_snapshot}\n${money(r)}\n\n` +
      `Only do this if the money has actually arrived in Square or in person. ` +
      `The athlete will immediately be able to use it.\n\n` +
      `This does not set an expiry date. If this pack should expire, use "Set expiration" on the athlete's packages afterwards.`
    );
    if (!ok) return;
    applyUpdate(r, { status: 'paid', paid_at: new Date().toISOString() }, 'mark this as paid');
  };

  const cancelPurchase = (r) => {
    const warnPaid = ['paid', 'active'].includes(r.status)
      ? `\n\n\u26a0\ufe0f This one is already marked ${r.status}. Cancelling it takes it out of the athlete's account. If money was actually taken, refund it in Square as well \u2014 this button does not move any money.`
      : '';
    const ok = window.confirm(
      `Cancel this purchase?\n\n` +
      `${r.user?.full_name || 'Unknown'} — ${r.product_name_snapshot}\n${money(r)}\n\n` +
      `It stops counting towards what the athlete owns and disappears from their account. ` +
      `The record is kept, so this can be undone by marking it paid again.${warnPaid}`
    );
    if (!ok) return;
    applyUpdate(r, { status: 'canceled' }, 'cancel this purchase');
  };

  const filtered = rows.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (r.user?.full_name || '').toLowerCase().includes(q)
      || (r.user?.email || '').toLowerCase().includes(q)
      || (r.product_name_snapshot || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search by name, email, product…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="active">Active</option>
          <option value="past_due">Paused</option>
          <option value="failed">Failed</option>
          <option value="canceled">Canceled</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>

      {note && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          note.kind === 'error'
            ? 'bg-red-50 border border-red-200 text-red-800'
            : 'bg-green-50 border border-green-200 text-green-800'
        }`}>
          {note.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No purchases.</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kind</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                {canAct && (
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-sm text-gray-700">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    <div>{r.user?.full_name || '—'}</div>
                    <div className="text-xs text-gray-500">{r.user?.email}</div>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">{r.product_name_snapshot}</td>
                  <td className="px-4 py-2 text-sm text-gray-700 capitalize">{r.product_kind}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">${(r.amount_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'}`}>
                      {r.status}
                    </span>
                  </td>
                  {canAct && (
                    <td className="px-4 py-2 text-sm text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {canMarkPaid(r) && (
                          <button
                            onClick={() => markPaid(r)}
                            disabled={busyId === r.id}
                            title="Record that this was paid in Square or in person"
                            className="border border-green-600 text-green-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-green-50 transition disabled:opacity-50"
                          >
                            {busyId === r.id ? 'Saving…' : 'Mark as paid'}
                          </button>
                        )}
                        {canCancel(r) && (
                          <button
                            onClick={() => cancelPurchase(r)}
                            disabled={busyId === r.id}
                            title="Take this out of the athlete's account. The record is kept."
                            className="border border-gray-300 text-gray-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50"
                          >
                            {busyId === r.id ? 'Saving…' : 'Cancel'}
                          </button>
                        )}
                        {!canMarkPaid(r) && !canCancel(r) && (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// #238: package overview grouped by product. Each package/bundle expands to
// show every client who bought it, when, how many sessions remain, and how much
// time is left before it expires.

// #340: the raw database word was rendered straight to staff ("pending"), which
// reads as a system state rather than a fact about money. Same wording as
// PackagesModal.js and the profile pill in Profile.js so the three screens
// can't tell different stories.
// 🔴 `past_due` does NOT mean the family owes money. Every writer maps it from
// Square's PAUSED and nothing else — square-subscriptions-backfill:53,
// square-backfill-resolve:52, square-webhook:195. Square has no past-due
// subscription status at all. So these are subscriptions somebody deliberately
// paused (an athlete taking the season off), and calling them "Payment needs
// updating" in orange told staff — and the athlete, via the profile pill — that
// a bill was outstanding when nothing was owed. 53 families were labelled this
// way. The status key is left alone; only the words and the colour change.
const PKG_STATUS_LABELS = {
  active:   'Active',
  paid:     'Paid',
  pending:  'Awaiting payment',
  past_due: 'Paused',
  failed:   'Payment failed',
  canceled: 'Canceled',
  refunded: 'Refunded',
};

// Duplicated from PackagesModal.js on purpose (#341): three screens needed the
// same two questions answered and a shared module would have widened the blast
// radius of this fix. Keep the definitions identical if either one changes.
//
// A purchase is only KNOWN paid when Square told us so: `paid_at` is written by
// the square-webhook payment handler and by nothing else.
//
// `status === 'active'` is deliberately NOT enough. square-subscriptions-backfill
// writes status='active' with paid_at left NULL, so treating active as paid would
// print "Paid <the date we ran the backfill>" — inventing a payment date, which is
// the exact defect this change exists to remove.
function pkgHasPaymentDate(r) {
  return r.paid_at != null;
}

// Whether the package is currently working for the athlete. Separate question
// from "did money arrive", and the two must not be conflated.
function pkgIsLive(r) {
  return r.status === 'active' || r.status === 'paid';
}

// The date cell. Only ever claims a payment when there is a payment date.
function pkgDateLabel(r) {
  const d = (v) => (v ? new Date(v).toLocaleDateString() : '—');
  if (pkgHasPaymentDate(r)) return `Paid ${d(r.paid_at)}`;
  if (pkgIsLive(r)) return `Active since ${d(r.created_at)}`;
  return `Assigned ${d(r.created_at)}`;
}

function packageTimeLeft(expiresAt) {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  // #340: an unparseable expires_at gives NaN, which used to print "NaNd left".
  // Rare, but the filter removal puts far more rows through here, and the cell
  // already falls back to "—" for the (common) no-expiry case.
  if (!Number.isFinite(days)) return null;
  if (days < 0) return { text: `expired ${Math.abs(days)}d ago`, cls: 'text-red-600' };
  if (days <= 14) return { text: `${days}d left`, cls: 'text-orange-600' };
  return { text: `${days}d left`, cls: 'text-gray-500' };
}

function PackagesTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('store_purchases')
        // #306: `metadata` carries the extension audit trail written by
        // packageExtension.js. Selected so this tab — the only place staff see
        // every package at once — cannot show an extended package as if nobody
        // had touched it. Extending itself is not offered here: it is a
        // one-athlete-at-a-time act and belongs on the athlete's own profile.
        .select('id, product_name_snapshot, product_kind, status, remaining_qty, expires_at, created_at, paid_at, metadata, user:users!store_purchases_user_id_fkey(full_name, email), store_products(bundle_qty)')
        .in('product_kind', ['package', 'bundle', 'lesson'])
        .order('created_at', { ascending: false })
        .limit(1000);
      // #340/#341: this used to be
      //   .filter(r => r.product_kind === 'package' || r.store_products?.bundle_qty != null)
      // left over from a #298 follow-up that only wanted to stop a one-off
      // kind='lesson' purchase rendering as an unlimited "Monthly" package. The
      // filter throws away every purchase whose product has no session count —
      // and bundle_qty is NULL on 77 of the 92 active products, while all 130
      // lesson-pack purchases in production are product_kind='lesson'. So this
      // tab showed none of them: the same defect PackagesModal.js had, removed
      // there for the same reason (see its load()).
      //
      // It also quietly falsified the numbers on this screen. The #341 notice
      // below and the per-group summary are both computed from `rows`, so with
      // the filter in place they described only the survivors — a QA run with 6
      // fixture rows (4 unconfirmed) showed 3 rows and a banner reading "One
      // purchase below…". In production the tab would warn about nothing at all.
      //
      // Nothing is filtered out here any more; `rows` is every assigned
      // package/bundle/lesson, so the counts agree with what is on screen.
      // Rows whose product carries no session count render "—" under Sessions
      // left rather than being hidden, which tells staff the truth: the pack is
      // assigned, we just don't know its size yet.
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  // Group by product name (the snapshot is what the customer actually bought).
  const groups = {};
  rows.forEach(r => {
    const key = r.product_name_snapshot || '(unnamed)';
    (groups[key] = groups[key] || []).push(r);
  });
  const groupNames = Object.keys(groups).sort();

  // #341: Square payment confirmations are not currently reaching the portal —
  // store_webhook_events has never recorded a single event, so no one-time
  // purchase has ever been marked paid. "Awaiting payment" on this screen is NOT
  // proof the athlete didn't pay; Square may well hold a completed payment for
  // it. The notice is driven by the data, so it disappears by itself once
  // payments sync. Counted over the whole unfiltered `rows` (#340) — this
  // number is a claim about what is listed below, so it has to be counted from
  // the same set that is rendered.
  const unconfirmedCount = rows.filter(r => !pkgHasPaymentDate(r) && !pkgIsLive(r)).length;

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (groupNames.length === 0) return <div className="text-center py-12 text-gray-500">No packages or bundles assigned yet.</div>;

  return (
    <div className="space-y-2">
      {unconfirmedCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold mb-1">Check Square before chasing payment on anything here.</p>
          <p>
            {unconfirmedCount === 1 ? 'One purchase below has' : `${unconfirmedCount} purchases below have`}{' '}
            no payment confirmed in the portal. Payment confirmations from Square are
            not currently reaching us, so some of these may in fact have been paid.
            Confirm in Square before treating anyone here as owing money.
          </p>
        </div>
      )}
      {groupNames.map(name => {
        const list = groups[name];
        // #340: this line used to read "{list.length} sold · {activeCount} active",
        // where activeCount counted status in (active, paid, pending, past_due).
        // Both halves asserted money we cannot evidence: every one of the 130
        // lesson-pack purchases in production sits at 'pending' with paid_at NULL,
        // so "sold" and "active" were both counting rows the portal has no payment
        // record for. Split into the three separate facts we actually know:
        // how many were assigned, how many Square confirmed payment for, and how
        // many are currently usable. All three count `list`, which is now the
        // group's full unfiltered membership (#340), so the header total always
        // matches the number of rows that open underneath it.
        const paidCount = list.filter(pkgHasPaymentDate).length;
        const liveCount = list.filter(pkgIsLive).length;
        const isOpen = !!open[name];
        return (
          <div key={name} className="bg-white rounded-lg shadow">
            <button
              onClick={() => setOpen(prev => ({ ...prev, [name]: !prev[name] }))}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
            >
              <div className="font-semibold text-gray-900">{name}</div>
              <div className="text-sm text-gray-500">{list.length} assigned · {paidCount} payment confirmed · {liveCount} active</div>
            </button>
            {isOpen && (
              <div className="border-t border-gray-100 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                      {/* #340: this column was headed "Purchased" and rendered
                          new Date(r.paid_at || r.created_at). paid_at is NULL on
                          every lesson-pack purchase in production, so it silently
                          fell back to the date the pack was ASSIGNED and captioned
                          it as a sale — telling staff money had been received when
                          the portal has no such record. The heading no longer
                          asserts anything; the cell says which date it is showing. */}
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sessions left</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time left</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {list.map(r => {
                      const tl = packageTimeLeft(r.expires_at);
                      // #340: the pack size, when the product carries one. NULL
                      // on 77 of the 92 active products, so it is shown only
                      // when known — never invented, and never a reason to hide
                      // the row. Same shape as PackagesModal.js ("3 / 8").
                      const total = r.store_products?.bundle_qty ?? null;
                      return (
                        <tr key={r.id}>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            <div>{r.user?.full_name || '—'}</div>
                            <div className="text-xs text-gray-500">{r.user?.email}</div>
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-700">{pkgDateLabel(r)}</td>
                          {/* #344: this said 'Monthly' for EVERY recurring row, so a
                              fortnightly plan read as monthly here while the profile
                              modal correctly called it "Every two weeks" — two screens
                              telling different stories about one purchase, which is the
                              confusion #344 exists to end. Say 'Recurring' and let the
                              product name carry the real frequency. */}
                          <td className="px-4 py-2 text-sm text-gray-700">{r.remaining_qty != null ? `${r.remaining_qty}${total != null ? ` / ${total}` : ''}` : (r.product_kind === 'package' ? 'Recurring' : '—')}</td>
                          <td className={`px-4 py-2 text-sm ${tl?.cls || 'text-gray-400'}`}>
                            <div>{tl?.text || '—'}</div>
                            {/* #306: a date on this row that somebody moved by
                                hand is not the same fact as a date the system
                                worked out, and staff comparing this tab against
                                Square need to be able to tell. Who and why are
                                on the athlete's own Packages panel; this says
                                that there is something to go and read. */}
                            {(() => {
                              const ext = latestExtension(r.metadata);
                              if (!ext) return null;
                              return (
                                <div className="text-xs text-amber-700" title={ext.reason || ''}>
                                  Extended by {ext.by_name || 'a staff account'}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'}`}>{PKG_STATUS_LABELS[r.status] || r.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// #358: coaches reach this screen now, but only the Purchases tab.
//
// Cordell asked for admins AND coaches to be able to settle a purchase. This
// component was mounted for admins only, so honouring that meant letting
// coaches in — but the Catalog tab creates, edits and DELETES products, and
// Duplicate Products merges them. Handing a coach the product catalogue is a
// far bigger change than "let a coach mark a purchase paid", and nobody asked
// for it. So the tab row is filtered by role rather than the door being opened
// wider than the request. Admins see all six exactly as before.
const STORE_TABS = [
  { key: 'catalog',    label: 'Catalog',            Icon: ShoppingBag, adminOnly: true },
  { key: 'purchases',  label: 'Purchases',          Icon: ListChecks,  adminOnly: false },
  // #340: settling the 140 stuck 'pending' rows against Square invoices. Not
  // adminOnly — it is the same act as Mark-as-Paid above, gated the same way
  // (admin or coach, matching store_purchases_update_staff).
  { key: 'reconcile',  label: 'Reconcile Pending',  Icon: Link2,       adminOnly: false },
  { key: 'packages',   label: 'Packages',           Icon: Package,     adminOnly: true },
  { key: 'backfill',   label: 'Backfill History',   Icon: History,     adminOnly: true },
  { key: 'bulk-tag',   label: 'Bulk Tag Sessions',  Icon: Tag,         adminOnly: false },
  { key: 'duplicates', label: 'Duplicate Products', Icon: Layers,      adminOnly: true },
  // #306: Cordell — "Admins and coaches only choose if a cancellation was
  // sick." So this one is NOT adminOnly: a coach deciding whether the athlete
  // in front of them was genuinely ill is the whole point. It sits in the
  // Store area because what the decision moves is a package session, which is
  // what every other tab here is about.
  { key: 'cancels',    label: 'Cancellations',      Icon: HeartPulse,  adminOnly: false },
];

export default function WorkStore({ userRole, userId }) {
  const isAdmin = userRole === 'admin';
  const tabs = STORE_TABS.filter(t => isAdmin || !t.adminOnly);
  const [tab, setTab] = useState(isAdmin ? 'catalog' : 'purchases');

  // A coach must never land on an admin tab — not via a stale value, and not
  // via a role that changes under them mid-session. Falling back to the first
  // tab they ARE allowed beats rendering nothing, which is how a blank page
  // with no explanation happens.
  const activeTab = tabs.some(t => t.key === tab) ? tab : tabs[0].key;

  return (
    <div className="space-y-4">
      {/* QA 2026-08-15: the six tabs were a 787px un-wrapping, un-scrolling row,
          so at 390px documentElement.scrollWidth hit 819px — the whole Store
          page panned sideways and the sticky header decoupled from the content.
          The row now scrolls inside its own container; `min-w-max` keeps the
          bottom border spanning the full width (so desktop is pixel-identical)
          and `whitespace-nowrap` stops the labels breaking mid-word. */}
      <div className="overflow-x-auto">
        <div className="flex space-x-2 min-w-max border-b border-gray-200">
          {tabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center space-x-2 whitespace-nowrap ${
                activeTab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      {activeTab === 'catalog' ? <CatalogTab />
        : activeTab === 'purchases' ? <PurchasesTab userRole={userRole} />
        : activeTab === 'reconcile' ? <InvoiceReconcile userRole={userRole} />
        : activeTab === 'packages' ? <PackagesTab />
        : activeTab === 'bulk-tag' ? <BulkTagSessions />
        : activeTab === 'duplicates' ? <DuplicateProducts />
        : activeTab === 'cancels' ? <CancellationReview userId={userId} userRole={userRole} />
        : <BackfillHistory />}
    </div>
  );
}
