import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { Tag, CheckSquare, Square, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { coachOwningProduct, isProductVisibleToCoach } from './Schedule';

// Mirrors Schedule.js's PRODUCT_KIND_GROUPS (UI labels only — the ownership
// rule itself lives in coachOwningProduct/isProductVisibleToCoach, imported
// from Schedule.js rather than re-implemented here).
const PRODUCT_KIND_GROUPS = [
  { kind: 'package', label: 'Monthly / Recurring' },
  { kind: 'lesson', label: 'Lesson & Class Packages' },
];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// #308 (#287 follow-up too): bulk-tag training_slots with a package/plan
// instead of opening each one individually in the slot modal. 569 of 670
// slots had nothing attached as of 2026-08. Row-selection mechanism (this
// file) is deliberately generic; the semantics (table, attribute, ownership
// rule) are NOT — a facility_events "team" tagger would be a separate
// component, not a mode of this one.
export default function BulkTagSessions() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [slots, setSlots] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [products, setProducts] = useState([]);

  const [coachFilter, setCoachFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | group | one_on_one
  const [publicFilter, setPublicFilter] = useState('all'); // all | public | private
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [kindSwitchNote, setKindSwitchNote] = useState(null);

  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null); // { succeeded, failed: [{id, title, error}] }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: slotRows, error: slotErr }, { data: coachRows, error: coachErr }, { data: productRows, error: prodErr }] = await Promise.all([
        supabase
          .from('training_slots')
          // Masters + standalone slots only (recurrence_parent_id IS NULL) —
          // per-occurrence exception children (#279 tombstones, #292 moves)
          // inherit the series' product requirement and aren't separately
          // tagged here. is_subscription_session=false is equivalent to "no
          // product attached": CreateSlotPanel's save always keeps
          // store_product_ids in sync with it (empty when false, non-empty
          // when true), so filtering on the boolean alone is sufficient.
          .select('id, coach_id, slot_date, start_time, duration_minutes, max_players, notes, is_public, repeat_weekly')
          .is('recurrence_parent_id', null)
          .eq('is_subscription_session', false)
          .order('slot_date', { ascending: false })
          .limit(2000),
        supabase.from('users').select('id, full_name').eq('role', 'coach'),
        supabase.from('store_products').select('id, name, price_cents, recurring, kind')
          .in('kind', ['package', 'lesson'])
          .eq('active', true)
          .order('sort_order'),
      ]);
      if (slotErr) throw slotErr;
      if (coachErr) throw coachErr;
      if (prodErr) throw prodErr;
      setSlots(slotRows || []);
      setCoaches(coachRows || []);
      setProducts(productRows || []);
    } catch (e) {
      setError(formatUserError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const coachNameById = useMemo(
    () => Object.fromEntries(coaches.map(c => [c.id, c.full_name])),
    [coaches]
  );
  const coachFullNames = useMemo(() => coaches.map(c => c.full_name).filter(Boolean), [coaches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return slots.filter(s => {
      if (coachFilter && s.coach_id !== coachFilter) return false;
      if (typeFilter === 'group' && !(s.max_players > 1)) return false;
      if (typeFilter === 'one_on_one' && !(s.max_players <= 1)) return false;
      if (publicFilter === 'public' && !s.is_public) return false;
      if (publicFilter === 'private' && s.is_public) return false;
      if (q && !(s.notes || 'Training session').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [slots, coachFilter, typeFilter, publicFilter, search]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allShownSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));
  const selectAllShown = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allShownSelected) {
        filtered.forEach(s => next.delete(s.id));
      } else {
        filtered.forEach(s => next.add(s.id));
      }
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setSelectedProductIds([]);
    setKindSwitchNote(null);
  };

  const selectedSlots = useMemo(() => slots.filter(s => selected.has(s.id)), [slots, selected]);
  const selectedCoachIds = useMemo(() => [...new Set(selectedSlots.map(s => s.coach_id))], [selectedSlots]);
  const spansMultipleCoaches = selectedCoachIds.length > 1;
  const singleCoachName = selectedCoachIds.length === 1 ? coachNameById[selectedCoachIds[0]] : null;

  // #308: a selection spanning several coaches could otherwise apply one
  // coach's product to another coach's session — restrict to org-wide
  // (unowned) products when that's the case, and say so on screen.
  const visibleProducts = useMemo(() => {
    if (selected.size === 0) return products;
    if (spansMultipleCoaches) return products.filter(p => coachOwningProduct(p.name, coachFullNames) == null);
    return products.filter(p => isProductVisibleToCoach(p.name, singleCoachName, coachFullNames));
  }, [products, selected.size, spansMultipleCoaches, singleCoachName, coachFullNames]);

  const selectedKind = (() => {
    const first = products.find(p => selectedProductIds.includes(p.id));
    return first ? first.kind : null;
  })();

  const toggleProduct = (id) => {
    const product = products.find(p => p.id === id);
    setSelectedProductIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      // A session accepts memberships OR lesson packages, never a mix —
      // same rule as CreateSlotPanel (Schedule.js).
      if (product && selectedKind && product.kind !== selectedKind) {
        const from = PRODUCT_KIND_GROUPS.find(g => g.kind === selectedKind)?.label || selectedKind;
        const to = PRODUCT_KIND_GROUPS.find(g => g.kind === product.kind)?.label || product.kind;
        setKindSwitchNote(`A session uses either monthly memberships or lesson packages, not both — your ${from} selection was replaced with this ${to} one.`);
        return [id];
      }
      setKindSwitchNote(null);
      return [...prev, id];
    });
  };

  const apply = async () => {
    if (selected.size === 0 || selectedProductIds.length === 0) return;
    const productNames = products.filter(p => selectedProductIds.includes(p.id)).map(p => p.name);
    const ok = window.confirm(
      `Attach ${productNames.join(', ')} to ${selected.size} session${selected.size === 1 ? '' : 's'}?\n\n` +
      `Each of these sessions will require one of the selected package(s)/plan(s) to book.`
    );
    if (!ok) return;
    setApplying(true);
    setApplyResult(null);
    const ids = [...selected];
    let succeeded = 0;
    const failed = [];
    for (const id of ids) {
      const { error: updErr } = await supabase
        .from('training_slots')
        .update({
          store_product_ids: selectedProductIds,
          store_product_id: selectedProductIds[0] || null,
          is_subscription_session: true,
        })
        .eq('id', id);
      if (updErr) {
        const slot = slots.find(s => s.id === id);
        failed.push({ id, title: slot?.notes || 'Training session', message: updErr.message });
      } else {
        succeeded++;
      }
    }
    setApplying(false);
    setApplyResult({ succeeded, failed });
    clearSelection();
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
        <Tag size={18} className="text-indigo-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-indigo-800">
          Sessions listed here have no package or membership attached. Select the ones that should require one, pick the
          product, and apply it to all of them at once. This only tags sessions — it does not gate booking.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>
      )}

      {applyResult && (
        <div className={`border rounded-lg px-4 py-3 text-sm space-y-1 ${applyResult.failed.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center gap-2 font-medium text-gray-800">
            {applyResult.failed.length ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-green-600" />}
            <span>{applyResult.succeeded} session{applyResult.succeeded === 1 ? '' : 's'} tagged successfully.</span>
          </div>
          {applyResult.failed.length > 0 && (
            <div className="pl-6 space-y-1">
              <div className="text-amber-700 font-medium">{applyResult.failed.length} failed:</div>
              <ul className="space-y-0.5">
                {applyResult.failed.map(f => (
                  <li key={f.id} className="flex items-start gap-1.5 text-amber-700">
                    <XCircle size={12} className="flex-shrink-0 mt-0.5" />
                    <span><span className="font-medium">{f.title}</span> — {f.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Coach</label>
          <select value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="">All coaches</option>
            {coaches.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="all">Group + 1-on-1</option>
            <option value="group">Group only</option>
            <option value="one_on_one">1-on-1 only</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Visibility</label>
          <select value={publicFilter} onChange={(e) => setPublicFilter(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
            <option value="all">Public + Private</option>
            <option value="public">Public only</option>
            <option value="private">Private only</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Search title</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. Hitting"
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div className="text-sm text-gray-500 pb-1.5">
          {loading ? 'Loading…' : `${filtered.length} untagged session${filtered.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={selectAllShown} disabled={loading || filtered.length === 0} className="flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:text-indigo-800 disabled:opacity-50">
          {allShownSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          <span>{allShownSelected ? 'Unselect all shown' : 'Select all shown'}</span>
        </button>
        <div className="text-sm text-gray-600">
          {selected.size} selected
          {selected.size > 0 && (
            <button onClick={clearSelection} className="ml-2 text-gray-400 hover:text-gray-600 underline">clear</button>
          )}
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg max-h-[420px] overflow-y-auto divide-y divide-gray-100">
        {loading ? (
          <p className="text-sm text-gray-500 text-center py-8">Loading sessions…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">Nothing matches these filters.</p>
        ) : filtered.map(s => (
          <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="w-4 h-4 text-indigo-600 border-gray-300 rounded flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{s.notes || 'Training session'}</div>
              <div className="text-xs text-gray-500">
                {coachNameById[s.coach_id] || 'Unknown coach'} · {fmtDate(s.slot_date)} {fmtTime(s.start_time)}
                {s.repeat_weekly ? ' · weekly' : ''}
              </div>
            </div>
            <div className="flex-shrink-0 flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                {s.max_players > 1 ? 'Group' : '1-on-1'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.is_public ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                {s.is_public ? 'Public' : 'Private'}
              </span>
            </div>
          </label>
        ))}
      </div>

      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700">Apply a product to the selected sessions</h4>
          {selected.size === 0 && <span className="text-xs text-gray-400">Select sessions above first</span>}
        </div>

        {spansMultipleCoaches && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Your selection spans {selectedCoachIds.length} coaches, so only org-wide products (not owned by a specific coach) are shown below.</span>
          </div>
        )}

        {visibleProducts.length === 0 ? (
          <p className="text-xs text-gray-400">No eligible products to show for this selection.</p>
        ) : (
          <div className="space-y-3 max-h-56 overflow-y-auto border border-gray-200 rounded-lg p-2">
            {PRODUCT_KIND_GROUPS.map(group => {
              const groupProducts = visibleProducts.filter(p => p.kind === group.kind);
              if (groupProducts.length === 0) return null;
              return (
                <div key={group.kind}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{group.label}</div>
                  <div className="space-y-1.5">
                    {groupProducts.map(p => (
                      <label key={p.id} className="flex items-center space-x-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProduct(p.id)} disabled={selected.size === 0} className="w-4 h-4 text-indigo-600 border-gray-300 rounded" />
                        <span>{p.name}{p.price_cents != null ? ` — $${(p.price_cents / 100).toFixed(2)}${p.recurring ? '/mo' : ''}` : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {kindSwitchNote && <p className="text-xs text-amber-600">{kindSwitchNote}</p>}

        <button
          onClick={apply}
          disabled={applying || selected.size === 0 || selectedProductIds.length === 0}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {applying ? 'Applying…' : `Apply to ${selected.size} session${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
