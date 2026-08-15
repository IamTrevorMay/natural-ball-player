import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { Layers, Download, Save, Eye, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { frequencyOf, groupByFamily } from './productFamily';

// #276/#305: Square exported the same real-world package more than once — a
// bare-named row (tagged on the training slots) and one or more
// "<same name> (FREQUENCY price)" rows (where the purchases live). The owner's
// rule is that everything before the "(frequency of charge)" is the same
// package in reality.
//
// This screen shows each duplicated family, how much data hangs off each
// version, and lets an admin pick the ONE version the family should collapse
// to. Nothing is written until "Save merges" is clicked, and saving only ever
// sets store_products.canonical_product_id — no name, price, id or Square field
// is touched.

const PAGE_SIZE = 1000;

// Fetch a whole table in pages. Deliberately three queries total for the whole
// screen (products, purchases, slots) — counting happens client-side rather
// than firing one count query per product.
async function fetchAllRows(table, columns) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

// A slot points at products through the legacy single FK and/or the uuid[]
// (#249 keeps store_product_id = store_product_ids[0]); count each product once.
function slotProductIds(slot) {
  const ids = new Set();
  if (slot.store_product_id) ids.add(slot.store_product_id);
  (slot.store_product_ids || []).forEach((id) => { if (id) ids.add(id); });
  return ids;
}

function money(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

// QA 2026-08-15: every recurring row used to print "/ mo" no matter what it
// actually billed at, so "NBP 2x A Week Training (EVERY_TWO_WEEKS price)" read
// as $150.00 / mo — a monthly label on a fortnightly price, on the one screen
// whose entire job is telling billing frequencies apart. The suffix now comes
// from the frequency in the product's own name.
const FREQUENCY_LABELS = {
  MONTHLY: '/mo',
  EVERY_TWO_WEEKS: '/2wk',
  EVERY_SIX_MONTHS: '/6mo',
  QUARTERLY: '/qtr',
  ANNUAL: '/yr',
};

// '' for a one-off product. For a recurring one: the short label for its
// frequency; a frequency Square invents later still renders honestly
// (lowercased token); and when the name carries no frequency at all we say
// "recurring" rather than guessing "monthly".
function priceSuffix(product) {
  if (!product?.recurring) return '';
  const freq = frequencyOf(product.name);
  if (!freq) return ' (recurring)';
  return ` ${FREQUENCY_LABELS[freq] || `/${freq.replace(/_/g, ' ').toLowerCase()}`}`;
}

// One sentence explaining why updates failed. The migration ships unapplied on
// purpose, so that case names the file to run instead of leaking a PostgREST
// schema-cache error; anything else falls back to the shared formatter.
function describeSaveFailure(errors) {
  const missingColumn = (errors || []).some((e) => {
    const raw = String(e?.message || '');
    return /canonical_product_id/i.test(raw) && /(column|schema cache|does not exist)/i.test(raw);
  });
  if (missingColumn) {
    return 'the store_products.canonical_product_id column does not exist yet — apply supabase/migrations/20260815_product_families.sql first.';
  }
  const message = formatUserError((errors || [])[0]);
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function DuplicateProducts() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [products, setProducts] = useState([]);
  const [purchaseCounts, setPurchaseCounts] = useState({});
  const [slotCounts, setSlotCounts] = useState({});
  // { [familyKey]: canonical product id }
  const [selection, setSelection] = useState({});
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSaveResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setDenied(true); return; }
      const { data: me } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
      if (me?.role !== 'admin') { setDenied(true); return; }
      setDenied(false);

      const [productRows, purchaseRows, slotRows] = await Promise.all([
        fetchAllRows('store_products', '*'),
        fetchAllRows('store_purchases', 'id, product_id'),
        fetchAllRows('training_slots', 'id, store_product_id, store_product_ids'),
      ]);

      const purchases = {};
      purchaseRows.forEach((row) => {
        if (!row.product_id) return;
        purchases[row.product_id] = (purchases[row.product_id] || 0) + 1;
      });
      const slots = {};
      slotRows.forEach((row) => {
        slotProductIds(row).forEach((id) => { slots[id] = (slots[id] || 0) + 1; });
      });

      setProducts(productRows);
      setPurchaseCounts(purchases);
      setSlotCounts(slots);
    } catch (e) {
      console.error('Duplicate product analysis failed:', e);
      setError(formatUserError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Only families with more than one version are a problem worth showing.
  const families = useMemo(
    () => groupByFamily(products).filter((f) => f.products.length > 1),
    [products],
  );

  // Default the pick to the version with the most purchases — "the version the
  // players actually bought". Ties break on slots tagged, then on name. An
  // already-saved canonical_product_id (once the migration is applied) wins.
  useEffect(() => {
    if (families.length === 0) return;
    setSelection((prev) => {
      const next = { ...prev };
      families.forEach((family) => {
        if (next[family.key]) return;
        const saved = family.products.find((p) => p.canonical_product_id == null
          && family.products.some((q) => q.canonical_product_id === p.id));
        if (saved) { next[family.key] = saved.id; return; }
        const best = family.products.slice().sort((a, b) =>
          (purchaseCounts[b.id] || 0) - (purchaseCounts[a.id] || 0)
          || (slotCounts[b.id] || 0) - (slotCounts[a.id] || 0)
          || String(a.name || '').localeCompare(String(b.name || ''))
        )[0];
        if (best) next[family.key] = best.id;
      });
      return next;
    });
  }, [families, purchaseCounts, slotCounts]);

  // Plain-English preview: what Save would change, before anything is written.
  const preview = useMemo(() => {
    const lines = [];
    let slotsAffected = 0;
    let purchasesAffected = 0;
    let versionsMerged = 0;
    families.forEach((family) => {
      const canonicalId = selection[family.key];
      if (!canonicalId) return;
      const canonical = family.products.find((p) => p.id === canonicalId);
      const others = family.products.filter((p) => p.id !== canonicalId);
      if (!canonical || others.length === 0) return;
      const slots = others.reduce((sum, p) => sum + (slotCounts[p.id] || 0), 0);
      const purchases = others.reduce((sum, p) => sum + (purchaseCounts[p.id] || 0), 0);
      slotsAffected += slots;
      purchasesAffected += purchases;
      versionsMerged += others.length;
      lines.push({
        key: family.key,
        label: family.label,
        canonicalName: canonical.name,
        otherCount: others.length,
        slots,
        purchases,
      });
    });
    return { lines, slotsAffected, purchasesAffected, versionsMerged };
  }, [families, selection, slotCounts, purchaseCounts]);

  const analysisRows = useMemo(() => {
    const rows = [];
    families.forEach((family) => {
      const canonicalId = selection[family.key];
      family.products.forEach((p) => {
        rows.push({
          family: family.label,
          product_name: p.name || '',
          kind: p.kind || '',
          active: p.active ? 'yes' : 'no',
          bundle_qty: p.bundle_qty == null ? '' : p.bundle_qty,
          price: ((p.price_cents || 0) / 100).toFixed(2),
          purchases: purchaseCounts[p.id] || 0,
          slots_tagged: slotCounts[p.id] || 0,
          is_canonical: p.id === canonicalId ? 'yes' : 'no',
        });
      });
    });
    return rows;
  }, [families, selection, purchaseCounts, slotCounts]);

  const exportCsv = () => {
    const headers = ['family', 'product_name', 'kind', 'active', 'bundle_qty', 'price', 'purchases', 'slots_tagged', 'is_canonical'];
    const body = analysisRows.map((r) => headers.map((h) => csvCell(r[h])).join(','));
    const csv = [headers.join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `duplicate-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const saveMerges = async () => {
    setSaving(true);
    setSaveResult(null);
    setError('');
    try {
      const updates = [];
      families.forEach((family) => {
        const canonicalId = selection[family.key];
        if (!canonicalId) return;
        family.products.forEach((p) => {
          // The canonical row points at nothing (NULL = "this IS the canonical
          // one"); every other version points at it.
          const want = p.id === canonicalId ? null : canonicalId;
          if ((p.canonical_product_id ?? null) !== want) updates.push({ id: p.id, canonical_product_id: want });
        });
      });
      if (updates.length === 0) {
        setSaveResult({ ok: true, message: 'Nothing to change — the saved merges already match these picks.' });
        return;
      }
      // QA 2026-08-15: this loop used to throw on the first failed update, so a
      // failure halfway through left the earlier rows merged while the banner
      // said only "Could not save" — the user had no way to know a partial
      // merge had landed. PostgREST gives the client no transaction, so instead
      // we finish the run, tally it, and say exactly what stuck.
      const failures = [];
      let saved = 0;
      for (const u of updates) {
        const { error: updErr } = await supabase
          .from('store_products')
          .update({ canonical_product_id: u.canonical_product_id })
          .eq('id', u.id);
        if (updErr) {
          console.error('Saving product merge failed for product', u.id, updErr);
          failures.push(updErr);
        } else {
          saved += 1;
        }
      }

      // Reload first: load() clears saveResult, so the banner is set after it.
      if (saved > 0) await load();

      if (failures.length === 0) {
        setSaveResult({ ok: true, message: `Saved. ${saved} product row${saved === 1 ? '' : 's'} updated.` });
        return;
      }
      const reason = describeSaveFailure(failures);
      setSaveResult({
        ok: false,
        message: saved === 0
          ? `Could not save. All ${updates.length} update${updates.length === 1 ? '' : 's'} failed: ${reason} Nothing was changed.`
          : `Saved ${saved} of ${updates.length}. ${failures.length} failed: ${reason} Nothing was rolled back; re-open this screen to see the current state.`,
      });
    } catch (e) {
      console.error('Saving product merges failed:', e);
      setSaveResult({ ok: false, message: describeSaveFailure([e]) });
    } finally {
      setSaving(false);
    }
  };

  if (denied) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-8 text-center">
        <AlertTriangle size={28} className="text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-gray-600">This tool is available to admins only.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500 flex items-center justify-center gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <p>{error}</p>
          <button onClick={load} className="mt-2 text-red-800 underline">Try again</button>
        </div>
      </div>
    );
  }

  if (families.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-10 text-center">
        <Layers size={32} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-600">No duplicated packages found.</p>
        <p className="text-xs text-gray-500 mt-1">
          Every product name is unique once the “(FREQUENCY price)” suffix is ignored.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-600 max-w-2xl">
          Square listed the same package more than once — once with the plain name, and again with the
          billing frequency in the title. Anything before the “(frequency of charge)” is the same package
          in reality. Pick the one version each package should count as; sessions tagged with the other
          versions will be treated as that package.
        </p>
        {/* QA 2026-08-15: three fixed-width buttons measured ~400px, just over a
            390px phone viewport; wrapping them keeps this screen (hosted in the
            Store page's tab set) from panning sideways. No effect on desktop,
            where they fit on one line. */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 flex items-center space-x-2"
          >
            <Eye size={16} />
            <span>{showPreview ? 'Hide preview' : 'Preview'}</span>
          </button>
          <button
            onClick={exportCsv}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 flex items-center space-x-2"
          >
            <Download size={16} />
            <span>Export CSV</span>
          </button>
          <button
            onClick={saveMerges}
            disabled={saving}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center space-x-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            <span>{saving ? 'Saving…' : 'Save merges'}</span>
          </button>
        </div>
      </div>

      {saveResult && (
        <div className={`rounded-lg px-4 py-2 text-sm flex items-start gap-2 border ${
          saveResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {saveResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{saveResult.message}</span>
        </div>
      )}

      {showPreview && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">What “Save merges” will change</h3>
          <p className="text-sm text-gray-600">
            {preview.versionsMerged === 0
              ? 'Nothing — every package already points at itself.'
              // QA 2026-08-15: "version(s)"/"package(s)" replaced with real agreement.
              : `${preview.versionsMerged} duplicate version${preview.versionsMerged === 1 ? '' : 's'} across
                 ${preview.lines.length} package${preview.lines.length === 1 ? '' : 's'} will be
                 marked as the same package as the version you picked. That covers
                 ${preview.slotsAffected} tagged session${preview.slotsAffected === 1 ? '' : 's'} and
                 ${preview.purchasesAffected} purchase${preview.purchasesAffected === 1 ? '' : 's'}.`}
          </p>
          <p className="text-xs text-gray-500">
            Saving only records which version is the canonical one. No product name, price, Square id or
            purchase record is changed, and nothing is deleted.
          </p>
          {preview.lines.length > 0 && (
            <ul className="text-sm text-gray-700 space-y-1 pt-1">
              {preview.lines.map((line) => (
                <li key={line.key} className="border-t border-gray-100 pt-1">
                  {/* QA 2026-08-15: "version(s)" replaced with real agreement. */}
                  <span className="font-medium text-gray-900">{line.label}</span> — {line.otherCount} other
                  version{line.otherCount === 1 ? ' becomes' : 's become'} “{line.canonicalName}”: {line.slots} session
                  {line.slots === 1 ? '' : 's'} and {line.purchases} purchase
                  {line.purchases === 1 ? '' : 's'} follow.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500">
        {/* QA 2026-08-15: verb now agrees with the count ("1 package has" /
            "2 packages have"). */}
        {families.length} package{families.length === 1 ? ' has' : 's have'} more than one version in Square.
      </p>

      {families.map((family) => {
        const canonicalId = selection[family.key];
        const otherCount = family.products.length - (canonicalId ? 1 : 0);
        return (
          <div key={family.key} className="bg-white rounded-lg shadow border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Layers size={16} className="text-indigo-600 shrink-0" />
              <h3 className="font-semibold text-gray-900">{family.label}</h3>
              <span className="text-xs text-gray-500">{family.products.length} versions</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Keep</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Kind</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sessions in pack</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purchases</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sessions tagged</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {family.products.map((p) => {
                    const freq = frequencyOf(p.name);
                    return (
                      <tr key={p.id} className={p.id === canonicalId ? 'bg-indigo-50' : ''}>
                        <td className="px-4 py-2">
                          <input
                            type="radio"
                            name={`canonical-${family.key}`}
                            checked={p.id === canonicalId}
                            onChange={() => setSelection((prev) => ({ ...prev, [family.key]: p.id }))}
                            className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                            aria-label={`Keep ${p.name}`}
                          />
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-gray-500">{freq ? freq.replace(/_/g, ' ').toLowerCase() : 'no billing frequency in the name'}</div>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700 capitalize">{p.kind}</td>
                        <td className="px-4 py-2 text-sm">
                          {p.active
                            ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Yes</span>
                            : <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs">No</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700">{p.bundle_qty == null ? '—' : p.bundle_qty}</td>
                        <td className="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">{money(p.price_cents)}{priceSuffix(p)}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 font-medium">{purchaseCounts[p.id] || 0}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 font-medium">{slotCounts[p.id] || 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-gray-100 text-sm text-gray-600">
              Sessions tagged with the other {otherCount} version{otherCount === 1 ? '' : 's'} will be treated as this package.
            </div>
          </div>
        );
      })}
    </div>
  );
}
