import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Plus, Trash2, Edit2, Save, X, ShoppingBag, ListChecks, RefreshCw, History, Package } from 'lucide-react';
import BackfillHistory from './BackfillHistory';

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
  past_due: 'bg-orange-100 text-orange-800',
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
      bundle_qty: draft.kind === 'bundle' && draft.bundle_qty ? Number(draft.bundle_qty) : null,
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
        {draft.kind === 'bundle' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Bundle qty</label>
            <input
              type="number"
              min="1"
              value={draft.bundle_qty}
              onChange={(e) => setDraft({ ...draft, bundle_qty: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
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
        <div className="flex items-center space-x-2">
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
        <div className="bg-white rounded-lg shadow overflow-hidden">
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

function PurchasesTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
          <option value="past_due">Past due</option>
          <option value="failed">Failed</option>
          <option value="canceled">Canceled</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>

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
function packageTimeLeft(expiresAt) {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
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
        .select('id, product_name_snapshot, product_kind, status, remaining_qty, expires_at, created_at, paid_at, user:users!store_purchases_user_id_fkey(full_name, email)')
        .in('product_kind', ['package', 'bundle'])
        .order('created_at', { ascending: false })
        .limit(1000);
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
  const activeStatuses = new Set(['active', 'paid', 'pending', 'past_due']);
  const groupNames = Object.keys(groups).sort();

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (groupNames.length === 0) return <div className="text-center py-12 text-gray-500">No packages or bundles sold yet.</div>;

  return (
    <div className="space-y-2">
      {groupNames.map(name => {
        const list = groups[name];
        const activeCount = list.filter(r => activeStatuses.has(r.status)).length;
        const isOpen = !!open[name];
        return (
          <div key={name} className="bg-white rounded-lg shadow">
            <button
              onClick={() => setOpen(prev => ({ ...prev, [name]: !prev[name] }))}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
            >
              <div className="font-semibold text-gray-900">{name}</div>
              <div className="text-sm text-gray-500">{list.length} sold · {activeCount} active</div>
            </button>
            {isOpen && (
              <div className="border-t border-gray-100 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purchased</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sessions left</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time left</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {list.map(r => {
                      const tl = packageTimeLeft(r.expires_at);
                      return (
                        <tr key={r.id}>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            <div>{r.user?.full_name || '—'}</div>
                            <div className="text-xs text-gray-500">{r.user?.email}</div>
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-700">{new Date(r.paid_at || r.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-2 text-sm text-gray-700">{r.remaining_qty != null ? r.remaining_qty : (r.product_kind === 'package' ? 'Monthly' : '—')}</td>
                          <td className={`px-4 py-2 text-sm ${tl?.cls || 'text-gray-400'}`}>{tl?.text || '—'}</td>
                          <td className="px-4 py-2 text-sm">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'}`}>{r.status}</span>
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

export default function WorkStore() {
  const [tab, setTab] = useState('catalog');
  return (
    <div className="space-y-4">
      <div className="flex space-x-2 border-b border-gray-200">
        <button
          onClick={() => setTab('catalog')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center space-x-2 ${
            tab === 'catalog' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShoppingBag size={16} />
          <span>Catalog</span>
        </button>
        <button
          onClick={() => setTab('purchases')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center space-x-2 ${
            tab === 'purchases' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ListChecks size={16} />
          <span>Purchases</span>
        </button>
        <button
          onClick={() => setTab('packages')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center space-x-2 ${
            tab === 'packages' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package size={16} />
          <span>Packages</span>
        </button>
        <button
          onClick={() => setTab('backfill')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center space-x-2 ${
            tab === 'backfill' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <History size={16} />
          <span>Backfill History</span>
        </button>
      </div>
      {tab === 'catalog' ? <CatalogTab /> : tab === 'purchases' ? <PurchasesTab /> : tab === 'packages' ? <PackagesTab /> : <BackfillHistory />}
    </div>
  );
}
