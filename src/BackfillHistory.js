import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { ChevronDown, ChevronRight, UserCheck, X, Loader2, Search, History } from 'lucide-react';

function UserPicker({ onPick, onCancel }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = query.trim();
      if (!q || q.length < 2) { setResults([]); return; }
      setLoading(true);
      const { data } = await supabase
        .from('users')
        .select('id, full_name, email, role')
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
        .order('full_name')
        .limit(20);
      setResults(data || []);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-md w-80">
      <div className="flex items-center mb-2">
        <Search size={14} className="text-gray-400 mr-2" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email…"
          className="flex-1 text-sm border-0 focus:outline-none"
        />
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
      {loading && <p className="text-xs text-gray-500">Searching…</p>}
      <div className="max-h-60 overflow-y-auto space-y-1">
        {results.map(u => (
          <button
            key={u.id}
            onClick={() => onPick(u)}
            className="w-full text-left px-2 py-1.5 hover:bg-indigo-50 rounded text-sm"
          >
            <div className="font-medium text-gray-900">{u.full_name}</div>
            <div className="text-xs text-gray-500">{u.email} · {u.role}</div>
          </button>
        ))}
        {!loading && query.length >= 2 && results.length === 0 && (
          <p className="text-xs text-gray-500 px-2">No matches.</p>
        )}
      </div>
    </div>
  );
}

function UnmatchedRow({ runId, item, onResolved }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const resolve = async (targetUser) => {
    setBusy(true);
    setErr('');
    setPickerOpen(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL || 'https://cjilkqzifyhssbsiqgfu.supabase.co'}/functions/v1/square-backfill-resolve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            run_id: runId,
            subscription_id: item.subscription_id,
            user_id: targetUser.id,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Resolve failed');
      onResolved(item.subscription_id, targetUser);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (item.resolved) {
    return (
      <tr className="text-gray-400 line-through">
        <td className="px-3 py-1.5">Resolved</td>
        <td className="px-3 py-1.5">{item.customer_name || '—'}</td>
        <td className="px-3 py-1.5">{item.email || '—'}</td>
        <td className="px-3 py-1.5">{item.product_name || '—'}</td>
        <td className="px-3 py-1.5 font-mono text-xs">{item.subscription_id}</td>
        <td className="px-3 py-1.5">{item.square_status || '—'}</td>
        <td className="px-3 py-1.5">✓</td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-3 py-1.5 text-red-700 text-xs">{item.reason}</td>
      <td className="px-3 py-1.5">{item.customer_name || '—'}</td>
      <td className="px-3 py-1.5">{item.email || '—'}</td>
      <td className="px-3 py-1.5">{item.product_name || '—'}</td>
      <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{item.subscription_id}</td>
      <td className="px-3 py-1.5">{item.square_status || '—'}</td>
      <td className="px-3 py-1.5 relative">
        <button
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="text-indigo-600 hover:text-indigo-800 text-xs font-medium flex items-center gap-1 disabled:opacity-60"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
          Assign user
        </button>
        {pickerOpen && (
          <div className="absolute right-0 top-full mt-1 z-10">
            <UserPicker onPick={resolve} onCancel={() => setPickerOpen(false)} />
          </div>
        )}
        {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
      </td>
    </tr>
  );
}

function RunDetails({ runId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('store_backfill_runs')
      .select('unmatched')
      .eq('id', runId)
      .single();
    setItems(data?.unmatched || []);
    setLoading(false);
  }, [runId]);

  useEffect(() => { load(); }, [load]);

  const markResolved = (subId, user) => {
    setItems(prev => prev.map(it =>
      it.subscription_id === subId ? { ...it, resolved: true, resolved_user_id: user.id } : it
    ));
  };

  if (loading) return <p className="px-4 py-2 text-sm text-gray-500">Loading…</p>;
  if (items.length === 0) return <p className="px-4 py-2 text-sm text-gray-500">No unmatched.</p>;

  return (
    <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border border-gray-200 rounded-b-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Reason</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Customer</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Email</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Product</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Sub ID</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Status</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(it => (
            <UnmatchedRow key={it.subscription_id} runId={runId} item={it} onResolved={markResolved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BackfillHistory() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('store_backfill_runs')
        .select('id, ran_at, ran_by, total_square_subs, inserted, updated, products_auto_created, unmatched_user, unmatched_product, ran_by_user:users!store_backfill_runs_ran_by_fkey(full_name)')
        .order('ran_at', { ascending: false })
        .limit(50);
      setRuns(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No backfill runs yet. Click "Backfill Subscriptions" in the Catalog tab to create one.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <History size={14} />
        Showing last {runs.length} backfill runs. Click a row to view unmatched entries and assign users.
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {runs.map(r => {
          const isOpen = expandedId === r.id;
          const totalUnmatched = (r.unmatched_user || 0) + (r.unmatched_product || 0);
          return (
            <div key={r.id} className="border-b last:border-b-0">
              <button
                onClick={() => setExpandedId(isOpen ? null : r.id)}
                className="w-full flex items-center px-4 py-3 hover:bg-gray-50 text-left"
              >
                {isOpen ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
                <div className="ml-3 flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {new Date(r.ran_at).toLocaleString()}
                    {r.ran_by_user?.full_name && (
                      <span className="text-gray-500 font-normal"> · {r.ran_by_user.full_name}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{r.total_square_subs} subs scanned</span>
                    <span className="text-green-700">{r.inserted} inserted</span>
                    {r.updated > 0 && <span className="text-blue-700">{r.updated} updated</span>}
                    {r.products_auto_created > 0 && <span>{r.products_auto_created} products auto-created</span>}
                    {totalUnmatched > 0 && <span className="text-red-700">{totalUnmatched} unmatched</span>}
                  </div>
                </div>
              </button>
              {isOpen && <RunDetails runId={r.id} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
