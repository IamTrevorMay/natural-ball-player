// #340 — clearing the pending backlog by hand, one row at a time.
//
// WHY THIS SCREEN EXISTS. 140 one-time purchases are stuck at 'pending' —
// $56,500 across ~104 athletes, the oldest from 16 June. The money arrived, as
// Square invoices sent from the dashboard or cards taken at the desk, but those
// payments carry an order id the portal has never seen, so the webhook can
// never match them. It is a closed set: nothing has gone pending since the
// webhook went live in mid-August. There is no key joining a Square invoice to
// a portal purchase, so this cannot be automated. What CAN be automated is
// gathering the evidence and putting it in front of a person.
//
// THE RULES THIS FILE OBEYS
//   * Scanning writes NOTHING. The scan button reads Square and nothing else.
//   * Nothing is written until a human confirms that specific row, in a dialog
//     that shows them the evidence they are acting on.
//   * There is no bulk apply, and there will not be one. This is other people's
//     money; a wrong bulk run marks a hundred families paid.
//   * Every Supabase call destructures `error`, and a 200 with zero rows is
//     treated as a FAILURE — RLS refuses a write in exactly that shape. This is
//     the same guard as applyUpdate() in WorkStore.js, for the same reason.
//   * Admin or coach, matching the Mark-as-Paid gate in WorkStore.js and the
//     store_purchases_update_staff policy.
//
// WHAT A CONFIRM WRITES
//   status = 'paid', paid_at = <invoice's paid date if Square gave one, else
//   now>, and the invoice id merged into metadata. Recording which invoice was
//   used is the whole difference between an auditable reconciliation and 140
//   unexplained status changes. It deliberately does NOT set expires_at or
//   remaining_qty — same omissions as the existing Mark-as-Paid, for the same
//   reasons documented there (an expiry is set separately, on purpose).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight, ExternalLink,
  Loader2, RefreshCw, Search, X,
} from 'lucide-react';
import {
  TIER_LABELS, formatCents, invoicePaidAt, purchaseAmountCents, rankCandidates,
} from './invoiceMatch';

// Each invocation returns at most ~200 invoices and a cursor. 25 round trips is
// 5,000 invoices — far past anything this facility has produced in a 180-day
// window — and it stops the loop from running forever if Square keeps handing
// back cursors. If we stop early we say so rather than pretending the scan was
// complete, because "no candidate found" for a real invoice is the worst lie
// this screen could tell.
const MAX_SCAN_REQUESTS = 25;

const TIER_STYLES = {
  strong: 'bg-green-100 text-green-800 border-green-200',
  likely: 'bg-amber-100 text-amber-800 border-amber-200',
  weak: 'bg-slate-100 text-slate-700 border-slate-200',
  none: 'bg-gray-100 text-gray-500 border-gray-200',
};

const PAYMENT_STYLES = {
  paid: 'bg-green-50 text-green-700',
  partial: 'bg-amber-50 text-amber-800',
  unpaid: 'bg-red-50 text-red-700',
  unknown: 'bg-yellow-50 text-yellow-800',
};

const PAYMENT_LABELS = {
  paid: 'Square: paid',
  partial: 'Square: part-paid',
  unpaid: 'Square: NOT paid',
  unknown: 'Square: amount unknown',
};

const dateLabel = (v) => (v ? new Date(v).toLocaleDateString() : '—');

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function TierBadge({ tier }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${TIER_STYLES[tier] || TIER_STYLES.none}`}>
      {TIER_LABELS[tier] || tier}
    </span>
  );
}

function PaymentBadge({ state }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${PAYMENT_STYLES[state] || PAYMENT_STYLES.unknown}`}>
      {PAYMENT_LABELS[state] || state}
    </span>
  );
}

// The evidence block. Reasons, then what argues against, then the money flag —
// in that order, always all three, never collapsed away. A staff member should
// not have to click anything to see why the screen thinks these two rows are
// the same payment.
function Evidence({ result, compact }) {
  if (!result) return null;
  const reasons = compact ? result.reasons.slice(0, 2) : result.reasons;
  const cautions = compact ? result.cautions.slice(0, 1) : result.cautions;
  return (
    <div className="space-y-1">
      {result.flags.map((f, i) => (
        <p key={`f${i}`} className="text-xs text-red-700 flex gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{f}</span>
        </p>
      ))}
      {reasons.map((r, i) => (
        <p key={`r${i}`} className="text-xs text-gray-700 flex gap-1.5">
          <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-green-600" /><span>{r}</span>
        </p>
      ))}
      {cautions.map((c, i) => (
        <p key={`c${i}`} className="text-xs text-amber-800 flex gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{c}</span>
        </p>
      ))}
      {compact && (result.reasons.length > 2 || result.cautions.length > 1) && (
        <p className="text-xs text-gray-400">…expand the row for the rest.</p>
      )}
    </div>
  );
}

function InvoiceSummary({ invoice }) {
  if (!invoice) return <span className="text-gray-400">—</span>;
  return (
    <div className="space-y-0.5">
      <div className="text-sm text-gray-900">{invoice.customer_name || <span className="text-gray-400">no name</span>}</div>
      <div className="text-xs text-gray-500 break-all">{invoice.customer_email || 'no email'}</div>
      <div className="text-xs text-gray-500">
        {invoice.title || (invoice.line_item_names || []).join(', ') || 'no title'}
      </div>
      <div className="text-xs text-gray-600">
        {formatCents(invoice.amount_cents)} · {dateLabel(invoice.created_at)}
      </div>
    </div>
  );
}

// A row in the pending backlog. Busy state, error and candidate choice all live
// here so one row failing never disturbs the other 139 — the same per-row shape
// as BackfillHistory's UnmatchedRow.
function PendingRow({
  row, candidates, chosen, onChoose, expanded, onToggle,
  busy, error, usedInvoiceIds, onConfirm, onNoMatch, onUnreview, canAct,
}) {
  const chosenResult = chosen
    ? candidates.find((c) => c.invoiceId === chosen) || null
    : (candidates[0] || null);
  const reviewed = row.metadata?.reconcile_reviewed === true;

  return (
    <>
      <tr className={reviewed ? 'bg-gray-50' : ''}>
        <td className="px-3 py-2 align-top">
          <button onClick={onToggle} className="text-gray-500 hover:text-gray-800" title="Show all candidates">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="px-3 py-2 align-top text-xs text-gray-600 whitespace-nowrap">{dateLabel(row.created_at)}</td>
        <td className="px-3 py-2 align-top">
          <div className="text-sm text-gray-900">{row.user?.full_name || <span className="text-red-700">name unavailable</span>}</div>
          <div className="text-xs text-gray-500 break-all">
            {row.user?.email || <span className="text-red-700">email unavailable</span>}
          </div>
        </td>
        <td className="px-3 py-2 align-top">
          <div className="text-sm text-gray-800">{row.product_name_snapshot}</div>
          <div className="text-xs text-gray-600">
            {formatCents(purchaseAmountCents(row))}
            {row.discounted_price_cents != null && row.discounted_price_cents !== row.amount_cents && (
              <span className="text-gray-400"> (discounted from {formatCents(row.amount_cents)})</span>
            )}
          </div>
          {reviewed && (
            <div className="mt-1 text-xs text-gray-500 italic">
              Reviewed — no suitable match{row.metadata?.reconcile_reviewed_at ? ` on ${dateLabel(row.metadata.reconcile_reviewed_at)}` : ''}.
            </div>
          )}
        </td>
        <td className="px-3 py-2 align-top min-w-[200px]">
          {chosenResult ? <InvoiceSummary invoice={chosenResult.invoice} /> : <span className="text-xs text-gray-400">No candidate.</span>}
          {chosenResult && usedInvoiceIds.has(chosenResult.invoiceId) && (
            <p className="mt-1 text-xs text-red-700">Already used to settle another row in this session.</p>
          )}
        </td>
        <td className="px-3 py-2 align-top whitespace-nowrap">
          {chosenResult ? (
            <div className="space-y-1">
              <TierBadge tier={chosenResult.tier} />
              <div><PaymentBadge state={chosenResult.paymentState} /></div>
            </div>
          ) : <TierBadge tier="none" />}
        </td>
        <td className="px-3 py-2 align-top max-w-md">
          <Evidence result={chosenResult} compact={!expanded} />
          {error && <p className="mt-1 text-xs text-red-700 font-medium">{error}</p>}
        </td>
        <td className="px-3 py-2 align-top text-right whitespace-nowrap">
          {canAct && (
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={() => chosenResult && onConfirm(row, chosenResult)}
                disabled={busy || !chosenResult}
                className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                Confirm…
              </button>
              {reviewed ? (
                <button onClick={() => onUnreview(row)} disabled={busy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
                  Un-mark reviewed
                </button>
              ) : (
                <button
                  onClick={() => onNoMatch(row)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
                >
                  <Ban size={12} /> No suitable match
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="px-6 pb-4 pt-0 bg-gray-50">
            <p className="text-xs text-gray-500 py-2">
              {candidates.length === 0
                ? 'No invoice in the scanned window scored above "no match" for this purchase. Widen the scan window, or mark it as no suitable match.'
                : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} — pick the one you believe, then Confirm.`}
            </p>
            <div className="space-y-2">
              {candidates.map((c) => {
                const isChosen = c.invoiceId === (chosen || (candidates[0] && candidates[0].invoiceId));
                return (
                  <div
                    key={c.invoiceId}
                    className={`rounded border p-2 ${isChosen ? 'border-indigo-400 bg-white' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-2 cursor-pointer flex-1">
                        <input
                          type="radio"
                          className="mt-1"
                          checked={isChosen}
                          onChange={() => onChoose(row.id, c.invoiceId)}
                        />
                        <div className="flex-1">
                          <InvoiceSummary invoice={c.invoice} />
                        </div>
                      </label>
                      <div className="space-y-1 text-right">
                        <TierBadge tier={c.tier} />
                        <div><PaymentBadge state={c.paymentState} /></div>
                        {c.invoice?.public_url && (
                          <a
                            href={c.invoice.public_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            Open in Square <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 pl-6">
                      <Evidence result={c} />
                    </div>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// The confirm dialog. Buttons live in a footer OUTSIDE the scroll region — five
// modals on this project have shipped with their action buttons pushed below
// the fold on a laptop, which makes the dialog impossible to complete. Same
// shape as the reference at Schedule.js:3975-4005.
function ConfirmDialog({ pending, onCancel, onConfirm, busy }) {
  if (!pending) return null;
  const { row, result } = pending;
  const inv = result.invoice;
  const knownPaidAt = invoicePaidAt(inv);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onCancel}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">Settle this purchase as paid?</h3>
          <button onClick={onCancel} disabled={busy} className="p-1 hover:bg-gray-100 rounded disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded border border-gray-200 p-3">
              <p className="text-xs uppercase text-gray-500 mb-1">Portal purchase</p>
              <p className="text-sm font-medium text-gray-900">{row.user?.full_name || 'name unavailable'}</p>
              <p className="text-xs text-gray-500 break-all">{row.user?.email || 'email unavailable'}</p>
              <p className="text-sm text-gray-800 mt-1">{row.product_name_snapshot}</p>
              <p className="text-sm text-gray-800">{formatCents(purchaseAmountCents(row))}</p>
              <p className="text-xs text-gray-500">created {dateLabel(row.created_at)}</p>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <p className="text-xs uppercase text-gray-500 mb-1">Square invoice</p>
              <InvoiceSummary invoice={inv} />
              <p className="mt-1 font-mono text-[11px] text-gray-400 break-all">{inv?.id}</p>
              {inv?.public_url && (
                <a href={inv.public_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 mt-1">
                  Open in Square <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <TierBadge tier={result.tier} />
            <PaymentBadge state={result.paymentState} />
          </div>

          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs uppercase text-gray-500 mb-2">Evidence</p>
            <Evidence result={result} />
          </div>

          {!result.paymentConfirmed && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Square does not confirm this invoice as paid. If you settle this row anyway, you are asserting the money arrived some other way —
              check Square first.
            </div>
          )}
          {!result.signals.identity && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Nothing links this invoice to this athlete except the numbers. Only settle it if you personally recognise the family.
            </div>
          )}

          <div className="rounded bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
            <p className="font-medium text-gray-700">This writes:</p>
            <p>status → <span className="font-mono">paid</span></p>
            <p>
              paid_at → <span className="font-mono">{knownPaidAt ? new Date(knownPaidAt).toLocaleString() : 'now'}</span>
              {!knownPaidAt && ' — Square gives no payment date on an invoice, so today\'s date is recorded rather than an invented one.'}
            </p>
            <p>metadata → <span className="font-mono">reconciled_invoice_id</span>, <span className="font-mono">reconciled_by</span>, <span className="font-mono">reconciled_at</span> (merged; nothing already in metadata is lost)</p>
            <p>It does NOT set an expiry or a session count — use "Set expiration" on the athlete's packages afterwards if this pack should expire.</p>
            <p>The athlete can use this immediately.</p>
          </div>
        </div>

        <div className="border-t border-gray-200 px-4 py-3 flex justify-end gap-2 shrink-0">
          <button onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Yes — mark paid
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceReconcile({ userRole }) {
  // Same gate as Mark-as-Paid in WorkStore.js and store_purchases_update_staff.
  const canAct = userRole === 'admin' || userRole === 'coach';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [embedBlocked, setEmbedBlocked] = useState(false);

  const [actorId, setActorId] = useState(null);
  const [actorError, setActorError] = useState('');

  const [since, setSince] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanNote, setScanNote] = useState('');
  const [scanProgress, setScanProgress] = useState(null);

  const [search, setSearch] = useState('');
  const [hideReviewed, setHideReviewed] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [chosen, setChosen] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});
  const [note, setNote] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [usedInvoiceIds, setUsedInvoiceIds] = useState(() => new Set());

  // Who is doing this. It goes into metadata.reconciled_by, so a confirm is
  // blocked until we know — an audit trail with a null actor is not an audit
  // trail.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        setActorError(`Could not confirm who you are signed in as: ${error.message}`);
        return;
      }
      if (!data?.user?.id) {
        setActorError('Could not confirm who you are signed in as. Reload before settling anything.');
        return;
      }
      setActorId(data.user.id);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setEmbedBlocked(false);
    const { data, error } = await supabase
      .from('store_purchases')
      .select('id, user_id, product_kind, product_name_snapshot, amount_cents, discounted_price_cents, status, metadata, created_at, square_order_id, square_subscription_id, user:users!store_purchases_user_id_fkey(full_name, email)')
      .eq('status', 'pending')
      .is('square_subscription_id', null)
      .order('created_at', { ascending: true })
      .limit(1000);

    if (error) {
      setLoadError(`Could not load pending purchases: ${error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }
    const list = data || [];
    // A blocked PostgREST embed returns the outer row with `users: null` and NO
    // error (see src/userDirectory.js:13-28). On this screen that would mean
    // matching every athlete on a blank email — which scores a blank against a
    // blank as "no evidence", quietly demoting every real match. Say it loudly
    // instead of matching on nothing.
    setEmbedBlocked(list.length > 0 && list.every((r) => r.user === null));
    setRows(list);
    setLoading(false);

    // Default the scan window to a fortnight before the oldest pending row, so
    // the invoice that settles it is inside the window rather than just outside.
    if (list.length > 0) {
      const oldest = list.reduce((min, r) => {
        const t = Date.parse(r.created_at);
        return Number.isFinite(t) && t < min ? t : min;
      }, Date.now());
      // Functional update so this never has to be a dependency of load() — a
      // `since` dep would re-fetch the whole list every time the date changed.
      setSince((prev) => prev || isoDay(oldest - 14 * 86400000));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- the scan. READ ONLY. Nothing here writes anything, anywhere. --------
  const scanOnce = async (cursor) => {
    const { data, error } = await supabase.functions.invoke('square-invoices-scan', {
      body: { since: since || null, cursor: cursor || null },
    });
    if (error) {
      // supabase-js puts a non-2xx body on error.context, not on data, so the
      // function's own { error, stage } is lost unless we go and get it.
      let detail = error.message || 'Square scan failed';
      try {
        const body = await error.context?.json?.();
        if (body?.error) detail = `${body.error}${body.stage ? ` (stage: ${body.stage})` : ''}`;
      } catch (_e) {
        // No JSON body on the error — keep the transport message.
      }
      throw new Error(detail);
    }
    if (!data) throw new Error('Square scan returned nothing at all.');
    if (data.error) throw new Error(`${data.error}${data.stage ? ` (stage: ${data.stage})` : ''}`);
    return data;
  };

  const runScan = async () => {
    setScanning(true);
    setScanError('');
    setScanNote('');
    setScanProgress({ requests: 0, invoices: 0 });
    const collected = new Map();
    let cursor = null;
    let requests = 0;
    try {
      do {
        requests += 1;
        // eslint-disable-next-line no-await-in-loop
        const page = await scanOnce(cursor);
        for (const inv of (page.invoices || [])) {
          if (inv?.id) collected.set(inv.id, inv);
        }
        setScanProgress({ requests, invoices: collected.size });
        cursor = page.has_more ? (page.cursor || null) : null;
      } while (cursor && requests < MAX_SCAN_REQUESTS);

      if (cursor) {
        setScanNote(`Stopped after ${MAX_SCAN_REQUESTS} requests with more invoices still to read. The candidates below are incomplete — narrow the window and scan again before concluding anything is unmatched.`);
      }
      setInvoices(Array.from(collected.values()));
    } catch (e) {
      // Keep whatever did come back — partial candidates still help — but be
      // explicit that the list is incomplete.
      setInvoices(Array.from(collected.values()));
      setScanError(`${e.message}${collected.size > 0 ? ` — ${collected.size} invoice(s) were read before this failed, so the candidates below are incomplete.` : ''}`);
    } finally {
      setScanning(false);
    }
  };

  // Candidate ranking for every visible row. Recomputed only when the purchases
  // or the invoice set change.
  const candidatesByRow = useMemo(() => {
    const map = new Map();
    if (invoices.length === 0) return map;
    for (const r of rows) map.set(r.id, rankCandidates(r, invoices, { limit: 8 }));
    return map;
  }, [rows, invoices]);

  const tierCounts = useMemo(() => {
    const counts = { strong: 0, likely: 0, weak: 0, none: 0 };
    for (const r of rows) {
      const best = (candidatesByRow.get(r.id) || [])[0] || null;
      counts[best ? best.tier : 'none'] += 1;
    }
    return counts;
  }, [rows, candidatesByRow]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideReviewed && r.metadata?.reconcile_reviewed === true) return false;
      if (!q) return true;
      return (r.user?.full_name || '').toLowerCase().includes(q)
        || (r.user?.email || '').toLowerCase().includes(q)
        || (r.product_name_snapshot || '').toLowerCase().includes(q);
    });
  }, [rows, search, hideReviewed]);

  const outstandingCents = useMemo(
    () => rows.reduce((sum, r) => sum + (purchaseAmountCents(r) || 0), 0),
    [rows],
  );

  const setRowError = (id, msg) => setRowErrors((prev) => ({ ...prev, [id]: msg }));

  // ---- the one and only write path ----------------------------------------
  // Copied from applyUpdate() in WorkStore.js, guard and all: destructure
  // `error`, and treat a 200 with zero rows as a FAILURE, because that is
  // exactly how RLS refuses a write — success-shaped, empty, silent.
  //
  // The re-read first is not paranoia: metadata has to be merged client-side
  // (PostgREST cannot do a jsonb merge without an RPC, and this job may not add
  // one), so writing a stale copy would clobber whatever else was put there
  // since the page loaded. `.eq('status', 'pending')` narrows the window
  // further — if someone else settled the row while the dialog was open, the
  // update matches nothing and the zero-rows guard reports it instead of
  // overwriting their work.
  const applyPatch = async (row, buildPatch, verb) => {
    setBusyId(row.id);
    setRowError(row.id, '');
    setNote(null);

    const { data: fresh, error: freshErr } = await supabase
      .from('store_purchases')
      .select('id, status, metadata')
      .eq('id', row.id)
      .limit(1);

    if (freshErr) {
      setBusyId(null);
      setRowError(row.id, `Could not re-read this purchase before writing: ${freshErr.message}`);
      return false;
    }
    if (!fresh || fresh.length === 0) {
      setBusyId(null);
      setRowError(row.id, 'Could not re-read this purchase — it may have been deleted, or you may not have permission. Nothing was written.');
      return false;
    }
    if (fresh[0].status !== 'pending') {
      setBusyId(null);
      setRowError(row.id, `This purchase is now "${fresh[0].status}" — somebody else settled it. Nothing was written. Reload the list.`);
      return false;
    }

    const patch = buildPatch(fresh[0].metadata || {});

    const { data, error } = await supabase
      .from('store_purchases')
      .update(patch)
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id, user_id, product_kind, product_name_snapshot, amount_cents, discounted_price_cents, status, metadata, created_at, square_order_id, square_subscription_id, user:users!store_purchases_user_id_fkey(full_name, email)');

    setBusyId(null);

    if (error) {
      setRowError(row.id, `Could not ${verb}: ${error.message}`);
      return false;
    }
    // RLS returns success with zero rows when the policy blocks the write, so
    // an empty array is a silent failure, not a success. Treat it as one.
    if (!data || data.length === 0) {
      setRowError(row.id, `Could not ${verb} — the change was refused. You may not have permission, or the purchase is no longer pending. Nothing was written.`);
      return false;
    }

    const updated = data[0];
    setRows((prev) => (
      updated.status === 'pending'
        ? prev.map((r) => (r.id === row.id ? updated : r))
        : prev.filter((r) => r.id !== row.id)
    ));
    return true;
  };

  const doConfirm = async () => {
    if (!pendingConfirm) return;
    const { row, result } = pendingConfirm;
    if (!actorId) {
      setRowError(row.id, actorError || 'Not sure who you are signed in as — reload before settling anything.');
      setPendingConfirm(null);
      return;
    }
    const inv = result.invoice;
    const knownPaidAt = invoicePaidAt(inv);
    const nowIso = new Date().toISOString();

    const ok = await applyPatch(row, (existing) => ({
      status: 'paid',
      // Square gives no payment date on an invoice; when it is unknown we
      // record now and say which of the two it was, rather than inventing a
      // settlement date that reads like fact later.
      paid_at: knownPaidAt || nowIso,
      metadata: {
        ...existing,
        reconciled_invoice_id: inv?.id ?? null,
        reconciled_by: actorId,
        reconciled_at: nowIso,
        reconciled_invoice_status: inv?.status ?? null,
        reconciled_invoice_url: inv?.public_url ?? null,
        reconciled_invoice_order_id: inv?.order_id ?? null,
        reconciled_match_tier: result.tier,
        reconciled_paid_at_source: knownPaidAt ? 'square_invoice' : 'reconciled_at',
      },
    }), 'mark this as paid');

    setPendingConfirm(null);
    if (ok) {
      if (inv?.id) setUsedInvoiceIds((prev) => new Set(prev).add(inv.id));
      setNote({
        kind: 'ok',
        text: `${row.user?.full_name || 'Purchase'} — ${row.product_name_snapshot} marked paid against Square invoice ${inv?.id || '(unknown)'}.`,
      });
    }
  };

  // "No suitable match" — reviewed, NOT paid. It only touches metadata: status
  // and paid_at are untouched, so the money story is unchanged and a second
  // pass simply stops re-proposing the row. Deliberately no new table and no
  // migration; metadata already exists and is already jsonb.
  const doNoMatch = async (row) => {
    if (!actorId) {
      setRowError(row.id, actorError || 'Not sure who you are signed in as — reload first.');
      return;
    }
    const ok = await applyPatch(row, (existing) => ({
      metadata: {
        ...existing,
        reconcile_reviewed: true,
        reconcile_reviewed_by: actorId,
        reconcile_reviewed_at: new Date().toISOString(),
        reconcile_review_outcome: 'no_suitable_match',
      },
    }), 'mark this as reviewed');
    if (ok) setNote({ kind: 'ok', text: `${row.user?.full_name || 'Purchase'} — ${row.product_name_snapshot} marked reviewed. It is still pending and still unpaid.` });
  };

  const doUnreview = async (row) => {
    const ok = await applyPatch(row, (existing) => {
      const next = { ...existing };
      delete next.reconcile_reviewed;
      delete next.reconcile_reviewed_by;
      delete next.reconcile_reviewed_at;
      delete next.reconcile_review_outcome;
      return { metadata: next };
    }, 'un-mark this as reviewed');
    if (ok) setNote({ kind: 'ok', text: `${row.product_name_snapshot} is back in the queue.` });
  };

  if (!canAct) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Reconciling purchases is limited to admins and coaches — the same people who can mark a purchase paid.
      </div>
    );
  }

  const reviewedCount = rows.filter((r) => r.metadata?.reconcile_reviewed === true).length;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Reconcile pending purchases against Square invoices</h3>
          <p className="text-sm text-gray-600 mt-1">
            These purchases never matched a Square payment because the money came in as an invoice or a card at the desk, carrying an order id
            the portal never issued. Scan Square, read the evidence, and settle them one at a time. <span className="font-medium">Scanning writes nothing.</span>
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">Invoices created since</span>
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </label>
          <button
            onClick={runScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {scanning ? 'Scanning Square…' : 'Scan Square'}
          </button>
          {scanning && scanProgress && (
            <span className="text-xs text-gray-600">
              request {scanProgress.requests} · {scanProgress.invoices} invoice(s) so far — this takes a few seconds per page.
            </span>
          )}
          {!scanning && invoices.length > 0 && (
            <span className="text-xs text-gray-600">{invoices.length} invoice(s) loaded.</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              placeholder="Search athlete, email or product…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} />
            Hide rows already reviewed ({reviewedCount})
          </label>
        </div>

        <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
          <span>{rows.length} pending one-time purchase(s)</span>
          <span>{formatCents(outstandingCents)} outstanding</span>
          {invoices.length > 0 && (
            <>
              <span className="text-green-700">{tierCounts.strong} strong</span>
              <span className="text-amber-700">{tierCounts.likely} likely</span>
              <span className="text-slate-600">{tierCounts.weak} weak</span>
              <span className="text-gray-500">{tierCounts.none} with no candidate</span>
            </>
          )}
        </div>
      </div>

      {embedBlocked && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold flex items-center gap-2"><AlertTriangle size={16} /> Athlete names and emails did not load.</p>
          <p className="mt-1">
            Every pending row came back with no linked user. PostgREST returns a blocked embed as <span className="font-mono">users: null</span> with no error,
            so this looks like success and is not. Matching would run against blank emails and quietly propose the wrong families.
            Fix the read before settling anything here.
          </p>
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
      )}
      {actorError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{actorError}</div>
      )}
      {scanError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{scanError}</div>
      )}
      {scanNote && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{scanNote}</div>
      )}
      {note && (
        <div className={`rounded-lg px-4 py-3 text-sm ${note.kind === 'error' ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-green-50 border border-green-200 text-green-800'}`}>
          {note.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading pending purchases…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No pending one-time purchases. Nothing to reconcile.</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-600">
          {rows.length} pending purchase(s) are waiting. Click <span className="font-medium">Scan Square</span> above to pull the invoices and propose matches.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Nothing matches that filter.</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purchased</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Athlete</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Best candidate invoice</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Why</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {visible.map((r) => (
                <PendingRow
                  key={r.id}
                  row={r}
                  candidates={candidatesByRow.get(r.id) || []}
                  chosen={chosen[r.id] || null}
                  onChoose={(rowId, invoiceId) => setChosen((prev) => ({ ...prev, [rowId]: invoiceId }))}
                  expanded={expandedId === r.id}
                  onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  busy={busyId === r.id}
                  error={rowErrors[r.id] || ''}
                  usedInvoiceIds={usedInvoiceIds}
                  canAct={canAct}
                  onConfirm={(row, result) => setPendingConfirm({ row, result })}
                  onNoMatch={doNoMatch}
                  onUnreview={doUnreview}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        pending={pendingConfirm}
        busy={Boolean(pendingConfirm) && busyId === pendingConfirm.row.id}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={doConfirm}
      />
    </div>
  );
}
