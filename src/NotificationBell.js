import React, { useState, useRef, useEffect } from 'react';
import { Bell, MessageSquare, Clock, Plane, ArrowLeftRight, Briefcase, Home, CreditCard, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from './supabaseClient';
import { formatUserError } from './errorMessage';
import { PAYMENT_DUE_NOTICES_ENABLED } from './useNotifications';

// #316: shared by App.js and WorkPortal.js — both render this bell and both
// need to delete a pending payment the same way. Was previously copy-pasted
// verbatim in both files; extracted here so there's one implementation.
//
// store_purchases_delete_admin (the RLS policy) is admin-only. A DELETE a
// non-admin isn't allowed to make returns NO error and ZERO rows — Postgres
// just matches nothing. Checking only `error` therefore lies: it looks
// successful. The .select('id') + length check below is load-bearing —
// don't simplify it away to a plain `if (error)`, or a coach-gated delete
// (should that ever come back) goes silent again.
export async function deletePendingPayment(purchaseId, productName, onSuccess) {
  // #341: every row that reaches this function is status='pending' with no
  // paid_at (that's the only thing useMainPortalCounts selects), and pending
  // currently means "Square never told us" rather than "unpaid" — no payment
  // webhook has ever been delivered, so paid_at is NULL even on purchases
  // Cordell has confirmed were paid. The caution is therefore unconditional
  // here, unlike PackagesModal.deletePackage which can check hasPaymentDate.
  // Wording deliberately mirrors that screen's so the two tell one story.
  const unpaidWarning = '\n\nThis purchase has no payment confirmed in the portal. Square payment confirmations are not currently syncing, so it may still have been paid. Check Square before continuing.';
  if (!window.confirm(`Delete the pending payment for "${productName}"? This cannot be undone.${unpaidWarning}`)) return;
  const { data, error } = await supabase.from('store_purchases').delete().eq('id', purchaseId).select('id');
  if (error) { alert('Error deleting payment: ' + formatUserError(error)); return; }
  if (!data || data.length === 0) {
    alert('Nothing was deleted — you may not have permission to remove this payment.');
    return;
  }
  onSuccess?.();
}

function fmtMoney(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function fmtSlotTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationBell({ currentPortal, mainCounts, workCounts, onJump, userRole, onDeletePayment }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const total =
    (mainCounts?.unreadMessages || 0)
    + (mainCounts?.pendingSlots?.length || 0)
    // #341: excluded while PAYMENT_DUE_NOTICES_ENABLED is off, or the badge
    // would advertise notifications the panel below deliberately doesn't render.
    + (PAYMENT_DUE_NOTICES_ENABLED ? (mainCounts?.pendingPayments?.length || 0) : 0)
    + (mainCounts?.packageFlags?.length || 0)
    + (workCounts?.unreadMessages || 0)
    + (workCounts?.pendingHours?.length || 0)
    + (workCounts?.pendingTimeOff?.length || 0);

  const jump = (portal, view) => {
    setOpen(false);
    onJump?.(portal, view);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
      >
        <Bell size={22} />
        {total > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h4 className="font-semibold text-gray-900 text-sm">Notifications</h4>
            <span className="text-xs text-gray-500">{total} new</span>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {total === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-500">No new notifications</div>
            )}

            {/* Main portal notifications */}
            {(mainCounts?.pendingSlots || []).map(req => (
              <button
                key={`main-slot-${req.id}`}
                onClick={() => jump('main', 'coach-tools')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><Clock size={16} className="text-yellow-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{req.users?.full_name || 'A player'}</span> requested a training session
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(req.slot_date || req.slot?.slot_date) && fmtDate(req.slot_date || req.slot.slot_date)}
                      {req.slot?.start_time && ` at ${fmtSlotTime(req.slot.start_time)}`}
                    </p>
                  </div>
                  {currentPortal !== 'main' && <PortalTag kind="main" />}
                </div>
              </button>
            ))}

            {/* #305 (Q8): a player was blocked from booking for lack of a
                matching package — flagged so a coach can follow up. */}
            {(mainCounts?.packageFlags || []).map(flag => (
              <button
                key={`main-pkg-flag-${flag.id}`}
                onClick={() => jump('main', 'coach-tools')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><AlertTriangle size={16} className="text-red-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{flag.users?.full_name || 'A player'}</span> tried to book without a package
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {flag.slot_date && fmtDate(flag.slot_date)}
                    </p>
                  </div>
                  {currentPortal !== 'main' && <PortalTag kind="main" />}
                </div>
              </button>
            ))}

            {/* #341: the whole payment block — notice, checkout link and the
                admin delete button that hangs off it — is behind
                PAYMENT_DUE_NOTICES_ENABLED (defined in useNotifications.js,
                currently false). This used to read "Payment due: … tap to
                complete payment" over a live Square checkout_url; with the
                payment webhook never firing, that told athletes who HAD paid
                that they owed money and gave them one click to pay twice.
                useMainPortalCounts also returns an empty list while the flag is
                off, so this map has nothing to iterate either way — the guard
                stays so the two can't drift apart. While it's off, the admin
                delete path for an unconfirmed purchase is PackagesModal
                (Packages screen), which carries the same Square caution; who
                may delete is unchanged (RLS: store_purchases_delete_admin).
                The copy below is what shows when the flag goes back on: it
                states only what we can evidence — that no confirmation has
                reached us — and never asserts a debt. */}
            {PAYMENT_DUE_NOTICES_ENABLED && (mainCounts?.pendingPayments || []).map(pay => (
              <div key={`main-pay-${pay.id}`} className="flex items-stretch border-b border-gray-100">
                <a
                  href={pay.checkout_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex-1 text-left px-4 py-3 hover:bg-gray-50 transition"
                >
                  <div className="flex items-start space-x-3">
                    <div className="mt-0.5"><CreditCard size={16} className="text-gray-400" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        Payment not confirmed: <span className="font-medium">{pay.product_name_snapshot}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {fmtMoney(pay.amount_cents)} · we haven't received a confirmation for this yet
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Already paid? You're all set — no action needed. If not, tap to finish checkout.
                      </p>
                    </div>
                    {currentPortal !== 'main' && <PortalTag kind="main" />}
                  </div>
                </a>
                {/* #316: matches store_purchases_delete_admin (RLS) — admin only.
                    Coaches used to see this button too and it silently no-op'd. */}
                {userRole === 'admin' && onDeletePayment && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeletePayment(pay.id, pay.product_name_snapshot); }}
                    className="px-3 text-gray-400 hover:text-red-600 hover:bg-red-50 transition flex items-center"
                    title="Delete this unconfirmed payment — check Square first (#341)"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}

            {(mainCounts?.unreadMessages > 0) && (
              <button
                onClick={() => jump('main', 'messages')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><MessageSquare size={16} className="text-blue-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{mainCounts.unreadMessages} unread message{mainCounts.unreadMessages !== 1 ? 's' : ''}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">in your conversations</p>
                  </div>
                  {currentPortal !== 'main' && <PortalTag kind="main" />}
                </div>
              </button>
            )}

            {/* Work portal notifications */}
            {(workCounts?.unreadMessages > 0) && (
              <button
                onClick={() => jump('work', 'work-messages')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><MessageSquare size={16} className="text-indigo-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{workCounts.unreadMessages} unread Work message{workCounts.unreadMessages !== 1 ? 's' : ''}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">in channels and DMs</p>
                  </div>
                  {currentPortal !== 'work' && <PortalTag kind="work" />}
                </div>
              </button>
            )}

            {(workCounts?.pendingHours || []).slice(0, 5).map(h => (
              <button
                key={`work-hr-${h.id}`}
                onClick={() => jump('work', 'work-admin-hours')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><Clock size={16} className="text-yellow-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{h.submitter?.full_name || 'A coach'}</span> submitted {Number(h.hours_decimal).toFixed(2)} hrs
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">on {fmtDate(h.work_date)}</p>
                  </div>
                  {currentPortal !== 'work' && <PortalTag kind="work" />}
                </div>
              </button>
            ))}

            {(workCounts?.pendingTimeOff || []).slice(0, 5).map(t => (
              <button
                key={`work-to-${t.id}`}
                onClick={() => jump('work', 'work-admin-time-off')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><Plane size={16} className="text-yellow-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{t.submitter?.full_name || 'A coach'}</span> requested {(t.type || 'time off').toUpperCase()}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{fmtDate(t.start_date)}{t.end_date !== t.start_date && ` – ${fmtDate(t.end_date)}`}</p>
                  </div>
                  {currentPortal !== 'work' && <PortalTag kind="work" />}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PortalTag({ kind }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center space-x-1 flex-shrink-0 ${
      kind === 'work' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'
    }`}>
      {kind === 'work' ? <Briefcase size={10} /> : <Home size={10} />}
      <ArrowLeftRight size={9} />
    </span>
  );
}
