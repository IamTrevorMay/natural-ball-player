import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { X, ChevronDown, ChevronRight, Plus, Calendar, Package, Trash2, Ban, CalendarClock, AlertTriangle, History } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { familyLabel, frequencyOf } from './productFamily';
import {
  extendPackageExpiry,
  describeExpiry,
  previewPresetDays,
  localDayString,
  daysBetweenDays,
  readExtensions,
  latestExtension,
  termDaysForBundleQty,
  EXTENSION_PRESET_DAYS,
  REASON_MAX_LENGTH,
  EXTEND_OK,
  EXTEND_STALE,
  EXTEND_INVALID,
  EXTEND_ERRORED,
} from './packageExtension';

// #235: full package history for a single player. Shows every active & past
// package/bundle they purchased, how many sessions are left, when each session
// was used, and how much time is left before the package expires. Staff can log
// a used session, adjust the remaining count, and set an expiration date.
const STATUS_STYLES = {
  active:   'bg-green-50 text-green-700 border-green-200',
  paid:     'bg-green-50 text-green-700 border-green-200',
  pending:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  past_due: 'bg-slate-50 text-slate-700 border-slate-200',
  failed:   'bg-red-50 text-red-700 border-red-200',
  canceled: 'bg-gray-100 text-gray-500 border-gray-200',
  refunded: 'bg-gray-100 text-gray-500 border-gray-200',
};

// #340: the raw database word was rendered straight to staff ("pending"), which
// reads as a system state rather than a fact about money. Same wording as the
// profile pill in Profile.js so the two screens can't tell different stories.
const STATUS_LABELS = {
  active:   'Active',
  paid:     'Paid',
  pending:  'Awaiting payment',
  past_due: 'Paused',            // Square PAUSED — not an unpaid bill. See WorkStore.js.
  failed:   'Payment failed',
  canceled: 'Canceled',
  refunded: 'Refunded',
};

// A purchase is only KNOWN paid when Square told us so: `paid_at` is written by
// the square-webhook payment handler and by nothing else.
//
// `status === 'active'` is deliberately NOT enough. square-subscriptions-backfill
// writes status='active' with paid_at left NULL, so treating active as paid would
// print "Paid <the date we ran the backfill>" — inventing a payment date, which is
// the exact defect this change exists to remove.
function hasPaymentDate(p) {
  return p.paid_at != null;
}

// Whether the package is currently working for the athlete. Separate question
// from "did money arrive", and the two must not be conflated.
function isLive(p) {
  return p.status === 'active' || p.status === 'paid';
}

// The date caption. Only ever claims a payment when there is a payment date.
function dateLabel(p) {
  if (hasPaymentDate(p)) return `Paid ${fmtDate(p.paid_at)}`;
  if (isLive(p)) return `Active since ${fmtDate(p.created_at)}`;
  return `Assigned ${fmtDate(p.created_at)}`;
}

// #344: returns null — never the string "Invalid Date" — for a missing or
// unparseable timestamp, so a caller can choose its own wording for "we don't
// know". The last-synced line depends on this: a blank or "Invalid Date" there
// would be one more thing on this screen that can't be trusted.
function fmtDateOrNull(d) {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDate(d) {
  return fmtDateOrNull(d) ?? '—';
}

// #306: the same job as fmtDateOrNull, for a CALENDAR DAY rather than an
// instant. `store_session_usage.used_on` is a postgres `date`, so it arrives as
// the bare string '2026-09-14' — and `new Date('2026-09-14')` is parsed as UTC
// midnight, which prints as the 13th in every US timezone. The usage history
// below has been showing every logged session one day early. Parsed at noon
// local, the convention already used in scheduleUtils.js and bookingCaps.js.
//
// Instants (paid_at, created_at, expires_at) still go through fmtDateOrNull —
// they carry a real offset and converting them to local is correct.
// #344 uses this too, for `canceled_date` / `charged_through_date` — also bare
// calendar days, also a whole day wrong if handed to new Date() directly, and
// the one date a parent is actually told. Anything that is not a bare day falls
// through to fmtDateOrNull, which is right for a real instant.
function fmtDayOrNull(day) {
  if (!day) return null;
  const raw = String(day).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return fmtDateOrNull(raw);
  const t = new Date(`${raw.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDay(day) {
  return fmtDayOrNull(day) ?? '—';
}

// #344: the two things on this screen are not the same kind of thing and must
// not be read as one list. `product_kind='package'` rows are Square recurring
// SUBSCRIPTIONS; everything else ('lesson', 'bundle') is a one-time purchase.
// Cordell's report is exactly this confusion: Square shows Charles Martin with
// live subscriptions, the portal shows "one pending package", and the two
// numbers were never counting the same thing.
function isSubscription(p) {
  return p.product_kind === 'package';
}

// #344: the billing frequency lives in the product name as a trailing
// "(MONTHLY price)" suffix — see productFamily.js, which owns that pattern for
// the whole app. Written out in full here because staff read this screen next
// to a Square invoice; the terse "/2wk" form used on the duplicate-products
// admin screen is not what a parent's invoice says.
const FREQUENCY_LABELS = {
  MONTHLY: 'Monthly',
  EVERY_TWO_WEEKS: 'Every two weeks',
  EVERY_SIX_MONTHS: 'Every six months',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
};

// A readable frequency for a subscription row. A frequency token Square invents
// later still renders honestly ("EVERY_THREE_WEEKS" -> "Every three weeks"), and
// a name carrying no suffix at all says "Recurring" rather than guessing
// "Monthly" — guessing monthly is how a fortnightly subscription ends up
// under-counted by half.
function frequencyLabel(p) {
  const freq = frequencyOf(p.product_name_snapshot);
  if (!freq) return 'Recurring';
  if (FREQUENCY_LABELS[freq]) return FREQUENCY_LABELS[freq];
  const words = freq.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The title to print. Subscriptions show the clean product name and carry their
// frequency in a badge instead, so "NBP 2x A Week Training (EVERY_TWO_WEEKS
// price)" stops being the thing staff have to parse. The stored name itself is
// untouched — this is display only.
function displayName(p) {
  return (isSubscription(p) && familyLabel(p.product_name_snapshot)) || p.product_name_snapshot;
}

// #307: deleting a purchase that was actually paid for is a refund, not a
// delete — it destroys the record that money was received, and takes the
// customer's session-usage history with it (store_session_usage.purchase_id
// is ON DELETE CASCADE). Refunds belong in Square. Delete is only for
// purchases that never became real money: still pending, or that failed/
// were canceled before payment landed.
const DELETABLE_STATUSES = new Set(['pending', 'canceled', 'failed']);

// ---------------------------------------------------------------------------
// #344: cancelling a subscription for real (square-cancel-subscription).
//
// THE ONE THING TO GET RIGHT: Square cancels at the END of the current billing
// period, not now. A perfectly successful cancel comes back as
//   { ok: true, square_status: "ACTIVE", canceled_date: "2025-09-14", ... }
// — still ACTIVE, with a FUTURE end date, and the family keeps their access
// until that day.
//
// So "is this cancelled?" is answered by `canceled_date` being present and by
// nothing else. If this code asked `square_status === 'CANCELED'` instead, every
// ordinary success would render as "nothing happened" and a coach would cancel
// the same family twice.
// ---------------------------------------------------------------------------

// Only a row Square actually knows as a subscription can be cancelled. A
// one-time lesson or bundle has no recurring billing and the function rejects
// it at the `lookup` stage, so the button must never appear on one.
function canCancelSubscription(p) {
  return !!p.square_subscription_id;
}


// Strictly before today, in the reader's own timezone. Only changes the tense of
// the sentence — "billing stops on" vs "billing stopped on" — which matters
// because a re-check of an old cancellation otherwise promises a family a future
// end date that went by months ago.
function isPastDay(d) {
  if (!d) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).trim());
  if (!m) return false;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  return day.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
}

// Used ONLY to describe a subscription whose billing has already finished — it
// is deliberately never consulted to decide whether our cancel worked.
const ENDED_SQUARE_STATUSES = new Set(['CANCELED', 'DEACTIVATED']);

// The function's own error strings are good plain English and are shown as the
// last line. Dropped when it only repeats what we already said above it — a
// coach reading the same sentence twice starts skimming, and these are the
// sentences that must not be skimmed.
function withDetail(lines, detail) {
  if (!detail) return lines;
  const already = lines.some(l => l.includes(detail) || detail.includes(l));
  return already ? lines : lines.concat(detail);
}

// Turns one response from square-cancel-subscription into what a coach reads.
// Pure on purpose: this is the part that decides what a family gets told about
// their money, so it is testable without a network or a browser.
//
// result: { ok: true, data }                    — the 200 body
//         { ok: false, stage, message }         — the non-2xx body
// who:    { athlete, product }
// returns { tone, title, lines, retryable }
export function cancelOutcome(result, who = {}) {
  const athlete = who.athlete || 'This athlete';
  const product = who.product || 'This subscription';
  const { ok, data, stage, message } = result || {};

  // Never refunds. Every branch says so, because "cancelled" is heard as
  // "money coming back" by roughly every parent who has ever been told it.
  const NO_REFUND =
    'Nothing has been refunded. Cancelling never returns money already paid — '
    + 'if money needs to go back, that is a separate refund in Square.';

  if (ok) {
    const endsOn = fmtDayOrNull(data?.canceled_date);
    const paidThrough = fmtDayOrNull(data?.charged_through_date);
    const squareStatus = String(data?.square_status || '').toUpperCase();
    const already = data?.already_canceled === true;
    const finished = ENDED_SQUARE_STATUSES.has(squareStatus);

    // The normal, expected success: Square gave us the day billing stops.
    if (endsOn) {
      const past = isPastDay(data?.canceled_date);
      const lines = already
        ? [
          'This subscription had already been cancelled in Square before now, so nothing changed and no second cancellation was sent. This is not an error.',
          past
            ? `Billing stopped on ${endsOn} and ${athlete}'s access under this subscription ended then.`
            : `Billing stops on ${endsOn}. ${athlete} keeps access until then.`,
        ]
        : [
          `Recurring billing for ${product} is now cancelled in Square. No further payments will be taken.`,
          past
            ? `The end of the paid period was ${endsOn}, which has already passed.`
            : `${athlete} keeps access until ${endsOn} — the end of the period already paid for. Billing has not stopped today.`,
        ];
      if (paidThrough && paidThrough !== endsOn) lines.push(`Square shows this paid through ${paidThrough}.`);
      lines.push(NO_REFUND);
      lines.push('Nothing was deleted. The record stays on this screen.');
      const when = past ? `billing stopped ${endsOn}` : `billing stops ${endsOn}`;
      return {
        tone: already ? 'notice' : 'success',
        title: already
          ? `Already cancelled — ${when}`
          : (past ? `Cancelled — ${when}` : `Billing stops on ${endsOn}`),
        lines,
        retryable: false,
      };
    }

    // Billing already finished before today, so there is no future end date.
    if (finished) {
      return {
        tone: 'notice',
        title: 'Already cancelled — billing has already stopped',
        lines: [
          `Square reports this subscription as ${squareStatus}. It is not billing anyone and no further payments will be taken. Nothing changed and this is not an error.`,
          'Square did not give a future end date because the billing period it was cancelled in has already passed.',
          NO_REFUND,
        ],
        retryable: false,
      };
    }

    // Square took the cancel but will not say when billing stops. We refuse to
    // invent a date, and we do not call this a clean success.
    return {
      tone: 'warn',
      title: 'Cancellation sent — Square has not given an end date',
      lines: [
        `Square accepted the cancellation but still reports this subscription as ${squareStatus || 'unknown'} with no date for when billing stops.`,
        'Do not give the family a date — we do not have one. Open this subscription in Square and confirm when it ends.',
        'Do not send the cancellation again; Square has already taken it.',
        NO_REFUND,
      ],
      retryable: false,
    };
  }

  const detail = message ? String(message) : null;

  switch (stage) {
    // Nothing left the building. The card is still being charged.
    case 'auth':
      return {
        tone: 'error',
        title: 'Not cancelled — you are not signed in, or not allowed to do this',
        lines: withDetail([
          'Nothing was sent to Square. Nothing changed and the family is still being billed exactly as before.',
          'Only an admin or a coach can cancel a subscription. Sign in again as one and retry.',
        ], detail),
        retryable: true,
      };

    case 'lookup':
      return {
        tone: 'error',
        title: 'Not cancelled — the purchase record could not be used',
        lines: withDetail([
          'Nothing was sent to Square. Nothing changed and the family is still being billed exactly as before.',
          'Close this screen, reopen it so the list is fresh, and try again.',
        ], detail),
        retryable: true,
      };

    case 'square_read':
      return {
        tone: 'error',
        title: 'Not cancelled — Square could not be read',
        lines: withDetail([
          'We could not read this subscription from Square, so no cancellation was sent. The family is still being billed.',
          'It is safe to try again.',
        ], detail),
        retryable: true,
      };

    // Square said no. The money is untouched.
    case 'square_cancel':
      return {
        tone: 'error',
        title: 'Not cancelled — the family is still being billed',
        lines: withDetail([
          'Square refused the cancellation, so nothing changed. The subscription is still live and the next payment will still be taken.',
          'It is safe to try again. If it keeps failing, cancel this subscription directly in Square.',
        ], detail),
        retryable: true,
      };

    // The dangerous one: we asked, and then lost sight of the answer.
    case 'square_verify':
      return {
        tone: 'warn',
        title: 'Cancellation was sent but NOT confirmed — check Square first',
        lines: withDetail([
          'The cancellation reached Square, but we could not re-read the subscription to confirm what Square did with it. It may or may not be cancelled.',
          'Do not press cancel again and do not tell the family anything yet. Open this subscription in Square and look at its status first.',
          'The portal record was deliberately left unchanged rather than guessing.',
        ], detail),
        retryable: false,
      };

    // The billing IS stopped. Only our own bookkeeping fell over. This must
    // never read as "the cancellation failed" — a coach who reads it that way
    // cancels a second time, or tells the family they are still being charged.
    case 'db_write':
      return {
        tone: 'warn',
        title: 'Billing WAS stopped in Square — only our record is out of date',
        lines: withDetail([
          'The cancellation went through. Square will take no further payments from this family.',
          'What failed was saving that result to the portal, so the row on this screen still shows the old status until the next Square sync.',
          'Do NOT cancel again — there is nothing left to cancel.',
          NO_REFUND,
        ], detail),
        retryable: false,
      };

    // Unknown stage, or the request never produced one (network dropped). We do
    // not know whether Square was touched, so the safe instruction is "go look",
    // not "try again".
    default:
      return {
        tone: 'warn',
        title: 'We could not tell whether the cancellation went through',
        lines: withDetail([
          'The request did not come back with a result we understand, so we cannot say whether Square was changed.',
          'Do not retry blindly. Open this subscription in Square and check its status before doing anything else or telling the family anything.',
        ], detail),
        retryable: false,
      };
  }
}

const OUTCOME_STYLES = {
  success: { box: 'border-green-300 bg-green-50', title: 'text-green-900', body: 'text-green-900' },
  notice:  { box: 'border-blue-300 bg-blue-50',   title: 'text-blue-900',  body: 'text-blue-900' },
  warn:    { box: 'border-amber-300 bg-amber-50', title: 'text-amber-900', body: 'text-amber-900' },
  error:   { box: 'border-red-300 bg-red-50',     title: 'text-red-900',   body: 'text-red-900' },
};

function timeLeftLabel(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, cls: 'text-red-600' };
  if (days === 0) return { text: 'Expires today', cls: 'text-orange-600' };
  if (days <= 14) return { text: `${days}d left`, cls: 'text-orange-600' };
  return { text: `${days}d left`, cls: 'text-gray-500' };
}

// #306 — the extend panel.
//
// Cordell asked for one function: an admin or coach putting an expired package
// back into use. The shape of this follows the shape of that job. It is opened
// from one package's own row, it shows that package and that athlete, and it
// changes exactly one row. There is deliberately no bulk mode and no way to
// reach it from a list — the person using it is standing at the desk with one
// family in front of them, and "extend everything that expired in June" is a
// decision nobody has made.
//
// The whole panel is a preview. Nothing is written until the staff member has
// seen the athlete, the package, the old expiry and the new one together on
// screen, and has typed a reason.
function ExtendExpiryPanel({ purchase, athleteName, onCancel, onExtended }) {
  const info = describeExpiry(purchase.expires_at);
  const today = localDayString(new Date());
  const termDays = termDaysForBundleQty(purchase.store_products?.bundle_qty);

  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const applyPreset = (days) => {
    const p = previewPresetDays({ expiresAt: purchase.expires_at, days });
    if (p.newDay) setDay(p.newDay);
  };

  // A package with no expiry on file is not expired and is not hiding anything
  // — every consumer (Schedule.js's booking-cap read, the attendance draw-down,
  // AthleteOutreach) treats a null expires_at as "never expires". Typing a date
  // onto it would TAKE access away, which is the opposite of what this button
  // is for. Most rows in this table are in exactly this state, so the panel has
  // to say so plainly rather than cheerfully offering to "extend" them.
  if (info.state === 'none') {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 space-y-2">
        <p className="text-sm font-semibold text-gray-900">This package has no expiry date, so nothing is cutting it off.</p>
        <p className="text-xs text-gray-600">
          Its sessions are already usable and there is nothing to give back. Giving it a date here would
          start a clock that does not currently exist and would eventually take the sessions away. If this
          package is supposed to have a deadline, use <span className="font-medium">Set expiration</span> instead —
          that is the control for putting a date on a package for the first time.
        </p>
        <button onClick={onCancel} className="border border-gray-300 text-gray-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-white transition">Close</button>
      </div>
    );
  }

  if (info.state === 'unreadable') {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-3 space-y-2">
        <p className="text-sm font-semibold text-red-900">The expiry date stored on this package cannot be read.</p>
        <p className="text-xs text-red-800">
          Nothing here can safely work out what to move it to, so extending is not offered. An admin will need
          to look at this row directly.
        </p>
        <button onClick={onCancel} className="border border-red-300 text-red-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-white transition">Close</button>
      </div>
    );
  }

  const addedFromNow = day ? daysBetweenDays(today, day) : null;
  const addedFromCurrent = day && info.day ? daysBetweenDays(info.day, day) : null;
  const reasonText = reason.trim();

  // Refused before the write rather than after. Both of these are "you did not
  // mean to press this": a date on or before today leaves the athlete just as
  // locked out as they are now, and a date before the current expiry shortens
  // the package instead of extending it.
  let blockedBecause = null;
  if (day && addedFromNow != null && addedFromNow <= 0) {
    blockedBecause = 'That date is today or earlier, so the package would still be expired. Pick a date in the future.';
  } else if (day && addedFromCurrent != null && addedFromCurrent <= 0) {
    blockedBecause = 'That date is on or before the expiry it already has, which would shorten the package rather than extend it.';
  }

  const ready = !!day && !!reasonText && !blockedBecause && !busy;

  const submit = async () => {
    setBusy(true);
    setFailure('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // The uuid is the audit key. The name is a snapshot alongside it so the
      // history stays readable years later without a join that a future policy
      // change might refuse.
      let actorName = user?.user_metadata?.full_name || null;
      if (user?.id) {
        const { data: me } = await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle();
        if (me?.full_name) actorName = me.full_name;
      }
      const res = await extendPackageExpiry({
        purchaseId: purchase.id,
        newDay: day,
        expectedExpiresAt: purchase.expires_at || null,
        reason: reasonText,
        actorId: user?.id || null,
        actorName,
      });
      if (res.code === EXTEND_OK) {
        onExtended({ newDay: day });
        return;
      }
      if (res.code === EXTEND_STALE) {
        setFailure('Somebody else changed this package\'s expiry while this panel was open, so the dates above are out of date and nothing was written. Close this, reopen it, and check what it says now before extending.');
      } else if (res.code === EXTEND_INVALID) {
        setFailure(res.message || 'That could not be used.');
      } else if (res.code === EXTEND_ERRORED) {
        setFailure(formatUserError(res.error, 'The package could not be extended.') + ' Nothing was changed.');
      } else {
        setFailure(res.message);
      }
    } catch (e) {
      setFailure(formatUserError(e, 'The package could not be extended.') + ' Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-indigo-600 flex-shrink-0" />
        <p className="text-sm font-semibold text-gray-900">Extend this package</p>
      </div>

      {/* What is about to change, stated before it changes. Athlete, package,
          old expiry, new expiry — all four on screen at once, because the
          person pressing this is giving somebody back access they paid for and
          should not have to hold any of it in their head. */}
      <div className="rounded border border-indigo-200 bg-white p-3 space-y-2">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-gray-500">Athlete</div>
            <div className="text-gray-900 font-medium truncate">{athleteName || '—'}</div>
          </div>
          <div>
            <div className="text-gray-500">Package</div>
            <div className="text-gray-900 font-medium truncate">{displayName(purchase)}</div>
          </div>
          <div>
            <div className="text-gray-500">Expires now</div>
            <div className="font-medium text-gray-900">
              {fmtDay(info.day)}
              <span className={info.state === 'expired' ? ' text-red-600' : ' text-gray-500'}>
                {info.state === 'expired' ? ` — expired ${info.days}d ago` : ` — ${info.days}d left`}
              </span>
            </div>
          </div>
          <div>
            <div className="text-gray-500">Sessions left</div>
            <div className="font-medium text-gray-900">{purchase.remaining_qty != null ? purchase.remaining_qty : 'Not recorded'}</div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-2">
          <div className="text-xs text-gray-500">New expiry</div>
          {day && !blockedBecause ? (
            <div className="text-sm font-semibold text-gray-900">
              {fmtDay(info.day)} → {fmtDay(day)}
              <span className="font-normal text-gray-600"> · {addedFromNow} more day{addedFromNow === 1 ? '' : 's'} from today</span>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Pick a date below.</div>
          )}
          {/* Adding 30 days to an expiry that passed 40 days ago produces a date
              still in the past. The presets count from today whenever the pack
              has already run out, and this line is where that is admitted —
              a silent correction to a date somebody is approving is not honest. */}
          {day && !blockedBecause && info.state === 'expired' && (
            <p className="text-xs text-gray-600 mt-1">
              Counted from today, not from the old expiry — that date has already passed, so adding to it
              would have left the package expired.
            </p>
          )}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-700 mb-1">Give it</div>
        <div className="flex flex-wrap gap-1.5">
          {EXTENSION_PRESET_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => applyPreset(d)}
              disabled={busy}
              className="border border-indigo-300 bg-white text-indigo-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-indigo-100 transition disabled:opacity-50"
            >
              +{d} days
            </button>
          ))}
          {/* The pack's own term, when the product carries one. This is the
              preset for the case that prompted #306: a pack paid months ago,
              given expires_at by the Square catch-up counted from the real
              payment date, and therefore expired before anyone saw it. The
              honest repair is the full term the family bought, starting now. */}
          {termDays != null && (
            <button
              type="button"
              onClick={() => applyPreset(termDays)}
              disabled={busy}
              className="border border-indigo-300 bg-white text-indigo-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-indigo-100 transition disabled:opacity-50"
            >
              Full term ({termDays} days)
            </button>
          )}
          <input
            type="date"
            value={day}
            min={today}
            onChange={(e) => setDay(e.target.value)}
            disabled={busy}
            className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-800 disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor={`extend-reason-${purchase.id}`}>
          Reason (required — this is kept on the package)
        </label>
        <input
          id={`extend-reason-${purchase.id}`}
          type="text"
          value={reason}
          maxLength={REASON_MAX_LENGTH}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          placeholder="e.g. paid in June, clock backdated by the Square catch-up"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-gray-800 disabled:opacity-50"
        />
      </div>

      {/* Moving the date does not create sessions. Said out loud, because a
          package can be expired AND empty, and extending an empty one looks
          like it worked while changing nothing the athlete can use. */}
      {purchase.remaining_qty === 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2">
          <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900">
            This package has <span className="font-semibold">no sessions left</span>. Extending the date will not
            give any back — if sessions are owed, change the count with <span className="font-medium">Edit remaining</span> as well.
          </p>
        </div>
      )}
      {purchase.remaining_qty == null && (
        <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2">
          <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900">
            The portal does not hold a session count for this package, so it cannot say how many sessions come
            back. Extending still lifts the deadline; the count has to be set by hand with <span className="font-medium">Edit remaining</span>.
          </p>
        </div>
      )}

      {blockedBecause && <p className="text-xs text-red-700">{blockedBecause}</p>}
      {failure && (
        <div className="rounded border border-red-300 bg-red-50 px-2.5 py-2">
          <p className="text-xs text-red-800">{failure}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={submit}
          disabled={!ready}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {busy ? 'Extending…' : day && !blockedBecause ? `Extend to ${fmtDay(day)}` : 'Extend'}
        </button>
        <button onClick={onCancel} disabled={busy} className="border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function PackagesModal({ userId, userName, canManage, canDelete = false, onClose }) {
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [usageByPurchase, setUsageByPurchase] = useState({});
  const [expanded, setExpanded] = useState({});
  const [busyId, setBusyId] = useState(null);
  // #306: the id of the package whose extend panel is open. Exactly one at a
  // time, by construction — there is no bulk extend and no way to get one.
  const [extendingId, setExtendingId] = useState(null);
  // What the last successful extension did, so the staff member gets told the
  // write landed instead of watching the row quietly change.
  const [extendNotice, setExtendNotice] = useState(null);
  // #344: null means "we could not establish a last-sync date" — either the
  // query failed, or store_backfill_runs is empty. It is NEVER used to mean
  // "synced just now"; the fallback wording says the date is unknown.
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // #344: the cancel flow lives in its own nested dialog so that stopping a
  // family's billing can never be one stray click on a row. `cancelTarget` holds
  // the row plus the names as they read at the moment of asking; `cancelResult`
  // is whatever cancelOutcome() made of the response.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelSending, setCancelSending] = useState(false);
  const [cancelResult, setCancelResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('store_purchases')
        // #344: square_subscription_id is what decides whether a row can be
        // cancelled at all. Without it there is no recurring billing to stop and
        // square-cancel-subscription rejects the call, so the button is hidden.
        // #306: `metadata` carries the extension audit trail, so "already
        // extended, by whom" is visible on the list itself and not only after
        // opening the extend panel.
        .select('id, product_id, product_kind, product_name_snapshot, status, remaining_qty, expires_at, amount_cents, created_at, paid_at, square_subscription_id, metadata, store_products(bundle_qty, kind)')
        .eq('user_id', userId)
        .in('product_kind', ['package', 'bundle', 'lesson'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      // #340: this used to be
      //   .filter(r => r.product_kind === 'package' || r.store_products?.bundle_qty != null)
      // which threw away every lesson purchase whose product had no session
      // count — and bundle_qty is NULL on 77 of the 92 active products. So an
      // athlete could have three assigned packages and this modal showed an
      // empty list. That is exactly what Cordell reported on Colton Kennedy:
      // "he should show one extra assigned payment on his profile".
      //
      // Cordell's actual ask on #340 is to see EVERYTHING assigned to an
      // athlete, so nothing is filtered out here any more. The uncounted ones
      // render with "—" sessions rather than being hidden, which tells staff
      // the truth: the pack is assigned, we just don't know its size yet.
      const list = rows || [];
      setPurchases(list);

      if (list.length > 0) {
        // The error was previously dropped on the floor here, which turned "the
        // usage query failed" into "this athlete has used no sessions" — a
        // silent lie on a screen staff delete records from. Surfaced now; the
        // package list itself still renders, because losing the usage history
        // is not a reason to show an empty modal.
        const { data: usage, error: usageErr } = await supabase
          .from('store_session_usage')
          .select('id, purchase_id, used_on, source_type, note')
          .in('purchase_id', list.map(p => p.id))
          .order('used_on', { ascending: false });
        if (usageErr) throw usageErr;
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

  // #344: subscription rows are NOT live data. They exist only because someone
  // pressed the button that runs square-subscriptions-backfill, and they are
  // frozen as of that moment — a subscription started, cancelled or paid since
  // then is missing or wrong here. Charles Martin's invoice was paid a week
  // after the last run, which is why the portal still showed him as pending
  // while Square showed him active and paying.
  //
  // Kept out of load() on purpose: this is a separate concern from the
  // athlete's purchases, and a failure here must not take the package list down
  // with it. Failure just leaves lastSyncedAt null, which renders as "unknown".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('store_backfill_runs')
          .select('ran_at')
          .order('ran_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setLastSyncedAt(data?.ran_at || null);
      } catch (e) {
        console.error('Failed to load last subscription sync:', e);
        if (!cancelled) setLastSyncedAt(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const deletePackage = async (purchase) => {
    const usageCount = (usageByPurchase[purchase.id] || []).length;
    const parts = [usageCount > 0
      ? `This package has ${usageCount} logged session(s). Deleting it will also remove those usage records. Continue?`
      : `Delete "${purchase.product_name_snapshot}" from this account? This cannot be undone.`];

    if (isSubscription(purchase)) {
      // #344: Cordell asked for "the option to choose which one to cancel /
      // delete". Cancel and delete are not the same action and conflating them
      // costs real money: this button only removes the portal's row, Square
      // keeps billing the card either way, and once the row is gone staff have
      // lost the thing that told them the subscription exists at all.
      // The wording below is unchanged on purpose — it is the sentence that
      // stops a coach believing this button ended the charges. The pointer to
      // the real cancel button is appended, not substituted.
      parts.push('This removes the portal\'s record only. It does NOT cancel the subscription and does NOT stop Square billing them — to actually stop the charges, cancel the subscription in Square.');
      parts.push('The "Cancel subscription" button on this row does exactly that. If that is what you meant, close this and use it instead.');
      // #341/#344 combined into one sentence rather than two walls of text: a
      // subscription row is never marked paid by a webhook (#341) AND is only
      // as fresh as the last manual backfill (#344), so the single honest
      // instruction for both is "Square is the source of truth, go look".
      parts.push('What this row says came from the last manual Square sync, so it may already be out of date. Check Square before continuing.');
    } else if (!hasPaymentDate(purchase)) {
      // #341: "Awaiting payment" currently means "Square never told us", not
      // "the athlete didn't pay" — so spell that out at the moment of deletion,
      // which is the point of no return.
      parts.push('This package has no payment confirmed in the portal. Square payment confirmations are not currently syncing, so it may still have been paid. Check Square before continuing.');
    }

    if (!window.confirm(parts.join('\n\n'))) return;
    setBusyId(purchase.id);
    try {
      if (usageCount > 0) {
        const { error: usageErr } = await supabase.from('store_session_usage').delete().eq('purchase_id', purchase.id);
        if (usageErr) throw usageErr;
      }
      const { error } = await supabase.from('store_purchases').delete().eq('id', purchase.id);
      if (error) throw error;
      await load();
    } catch (e) { alert('Error deleting package: ' + formatUserError(e)); } finally { setBusyId(null); }
  };

  // #344: the real cancel. Stops Square billing the family; deletes nothing.
  //
  // Deliberately NOT sharing `busyId` with the row's other buttons: this one
  // moves money, so it owns its own in-flight flag and the dialog's button is
  // disabled off it. Double-firing a cancel is survivable (the function's
  // already_canceled path is idempotent) but sending a second one while the
  // first is still open is exactly how a coach ends up unsure what happened.
  const runCancelSubscription = async () => {
    if (!cancelTarget || cancelSending) return;
    const { purchase, athlete, product } = cancelTarget;
    setCancelSending(true);
    setCancelResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('square-cancel-subscription', {
        body: { purchase_id: purchase.id },
      });

      if (error) {
        // supabase-js turns a non-2xx into a FunctionsHttpError and hides the
        // body on `error.context` (the raw Response). That body is the entire
        // point — it carries the `stage`, which is the difference between "they
        // are still being billed" and "the billing stopped, only our row is
        // stale". Without reading it, every failure collapses into the one
        // useless sentence this change exists to get rid of.
        let body = null;
        try { body = await error.context?.json?.(); } catch { /* not JSON */ }
        console.error('square-cancel-subscription failed:', body?.stage, body?.error || error.message);
        setCancelResult(cancelOutcome(
          { ok: false, stage: body?.stage, message: body?.error || error.message },
          { athlete, product },
        ));
      } else if (data?.error) {
        // A 200 carrying an error field. Treated the same way, stage and all.
        console.error('square-cancel-subscription returned an error:', data.stage, data.error);
        setCancelResult(cancelOutcome({ ok: false, stage: data.stage, message: data.error }, { athlete, product }));
      } else {
        console.log('square-cancel-subscription ok:', data);
        setCancelResult(cancelOutcome({ ok: true, data }, { athlete, product }));
      }
    } catch (e) {
      // Never reached the function, or the browser dropped the request. We do
      // not know what Square saw, so the default branch says "go look".
      console.error('square-cancel-subscription threw:', e);
      setCancelResult(cancelOutcome({ ok: false, stage: null, message: formatUserError(e) }, { athlete, product }));
    } finally {
      setCancelSending(false);
      // #344 requirement: the row must reflect the new state without a page
      // reload. Runs after every outcome, not just success — square_verify
      // writes a breadcrumb and the already-cancelled path re-syncs the status,
      // so "it failed" does not mean "nothing on the row moved".
      await load();
    }
  };

  // #341: Square payment confirmations are not currently reaching the portal —
  // store_webhook_events has never recorded a single event, so no one-time
  // purchase has ever been marked paid. That means "Awaiting payment" is NOT
  // proof the athlete didn't pay; Square may well hold a completed payment for
  // it. Staff must not delete on the strength of this screen alone. The notice
  // is driven by the data, so it disappears by itself once payments sync.
  const unconfirmedCount = purchases.filter(p => !hasPaymentDate(p) && !isLive(p)).length;

  // #344: one flat list made "how many packages are running?" unanswerable —
  // a recurring subscription and a one-off lesson pack sat side by side looking
  // identical. Split, recurring first: that is the group that keeps charging a
  // card whether or not this screen is right about it. Order inside each group
  // is untouched (newest first, from the query).
  const subscriptions = purchases.filter(isSubscription);
  const oneTimePurchases = purchases.filter(p => !isSubscription(p));
  const syncedOn = fmtDateOrNull(lastSyncedAt);

  // One row. Extracted only so the two groups render byte-identical markup —
  // the row itself is unchanged apart from the #344 frequency badge.
  const renderPurchase = (p) => {
    const total = p.store_products?.bundle_qty ?? null;
    const usage = usageByPurchase[p.id] || [];
    const isOpen = !!expanded[p.id];
    const tl = timeLeftLabel(p.expires_at);
    const busy = busyId === p.id;
    // #306: an extension is a staff member overriding what the family paid for,
    // so it is never buried. The pill is on the collapsed row — visible without
    // opening anything — and the full who/when/why is one click below.
    const extensions = readExtensions(p.metadata);
    const lastExt = latestExtension(p.metadata);
    return (
      <div key={p.id} className="border border-gray-200 rounded-lg">
        <button
          onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isOpen ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />}
              <span className="font-medium text-gray-900 truncate">{displayName(p)}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{STATUS_LABELS[p.status] || p.status}</span>
              {/* #344: how often Square bills this. Cordell was comparing a
                  portal row against a Square invoice with no way to tell a
                  fortnightly plan from a monthly one. */}
              {isSubscription(p) && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-indigo-50 text-indigo-700 border-indigo-200 flex-shrink-0">{frequencyLabel(p)}</span>
              )}
              {extensions.length > 0 && (
                <span
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-50 text-amber-800 border-amber-300 flex-shrink-0"
                  title={`Extended by ${lastExt?.by_name || 'a staff account'} on ${fmtDate(lastExt?.at)}`}
                >
                  {extensions.length === 1 ? 'Extended' : `Extended ×${extensions.length}`}
                </span>
              )}
            </div>
            {/* #340: this line used to read "Purchased {paid_at || created_at}".
                paid_at is NULL on every lesson-pack purchase in production, so it
                silently fell back to the date the pack was ASSIGNED and captioned
                it "Purchased" — telling staff money had been received when the
                portal has no such record. Cordell photographed exactly this: three
                rows reading "Purchased <date>" and "pending" at the same time.
                Never claim a purchase we cannot evidence. */}
            <div className="text-xs text-gray-500 mt-1 ml-6">{dateLabel(p)}</div>
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <div className="text-sm font-semibold text-gray-900">
              {/* #344: this said "Monthly" for every subscription regardless of
                  what Square actually bills — a fortnightly plan read as monthly
                  on the one line meant to describe it. The real frequency is in
                  the badge above; here we only say that it recurs. */}
              {p.remaining_qty != null ? `${p.remaining_qty}${total != null ? ` / ${total}` : ''} left` : (isSubscription(p) ? 'Recurring' : '—')}
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
                      <span className="font-medium">{fmtDay(u.used_on)}</span>
                      {u.note && <span className="text-gray-500 truncate">— {u.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* #306: the audit trail, in front of anyone who opens the package
                — not only the person who did it and not only in the database.
                Cordell's requirement was that it be obvious a package has been
                extended and by whom, so who/when/why are all three here, in
                that order, oldest first. */}
            {extensions.length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">Extensions</div>
                <ul className="space-y-1">
                  {extensions.map((e, i) => (
                    <li key={`${e.at || 'ext'}-${i}`} className="flex items-start gap-2 text-xs text-gray-700">
                      <History size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-medium">{fmtDate(e.at)}</span>
                        {' — '}
                        {/* Never invents a name. A record written before a name
                            could be resolved says so rather than showing a blank
                            where the responsible person should be. */}
                        {e.by_name ? e.by_name : 'a staff account (name not recorded)'}
                        {' moved the expiry '}
                        {e.from_day ? `from ${fmtDay(e.from_day)} ` : ''}
                        to {fmtDay(e.to_day)}
                        {e.added_days != null ? ` (+${e.added_days}d)` : ''}
                        {e.reason ? <span className="text-gray-600">{' — '}{e.reason}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Admin or coach only. `canManage` is the same gate the rest of
                this panel uses (Profile.js passes admin || coach), and the
                database agrees independently: store_purchases' UPDATE policy is
                restricted to those two roles, so an athlete who reached this
                code would get zero rows back and be told the write was refused
                rather than quietly succeeding. */}
            {canManage && extendingId === p.id && (
              <ExtendExpiryPanel
                purchase={p}
                athleteName={userName}
                onCancel={() => setExtendingId(null)}
                onExtended={async ({ newDay }) => {
                  setExtendingId(null);
                  setExtendNotice({ id: p.id, name: displayName(p), newDay });
                  await load();
                  setExpanded(prev => ({ ...prev, [p.id]: true }));
                }}
              />
            )}

            {canManage && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={() => logUsedSession(p)} disabled={busy} className="flex items-center gap-1 bg-indigo-600 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                    <Plus size={12} /> Log used session
                  </button>
                  <button onClick={() => editRemaining(p)} disabled={busy} className="border border-gray-300 text-gray-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50">Edit remaining</button>
                  <button onClick={() => editExpiry(p)} disabled={busy} className="border border-gray-300 text-gray-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50">Set expiration</button>
                  {/* #306. Separate from "Set expiration" on purpose: that one
                      types any date onto the row and leaves no trace of why.
                      This one only ever moves the deadline forward, shows what
                      it is about to change first, and will not save without a
                      reason. They are different acts and the history has to be
                      able to tell them apart. */}
                  <button
                    onClick={() => setExtendingId(prev => (prev === p.id ? null : p.id))}
                    disabled={busy}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition disabled:opacity-50 ${
                      extendingId === p.id
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'border border-indigo-300 text-indigo-700 hover:bg-indigo-50'
                    }`}
                  >
                    <CalendarClock size={12} /> Extend
                  </button>
                </div>

                {/* #344: the real cancel. Its own block, its own colour and the
                    biggest button on the row, because it is the action staff
                    actually came here for — the previous answer was "go do it in
                    Square", which is how families kept getting billed.
                    Deliberately NOT sitting next to Delete: those two are
                    different actions with different consequences and one row of
                    lookalike buttons is how they get confused. */}
                {canCancelSubscription(p) && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-900">
                      <Ban size={13} /> Stop the billing
                    </div>
                    <p className="text-[11px] text-rose-800 mt-1">
                      Cancels the recurring payment in Square so this family is not charged again.
                      Access runs to the end of the period already paid for, and nothing is refunded.
                    </p>
                    <button
                      onClick={() => { setCancelResult(null); setCancelTarget({ purchase: p, athlete: userName || 'This athlete', product: displayName(p) }); }}
                      disabled={busy || cancelSending}
                      className="mt-2 flex items-center gap-1.5 bg-rose-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-rose-700 transition disabled:opacity-50"
                    >
                      <Ban size={13} /> Cancel subscription
                    </button>
                  </div>
                )}

                {/* A package row with no Square subscription id cannot be
                    cancelled from here and the function would reject it. Say why,
                    rather than leaving a coach hunting for a missing button. */}
                {isSubscription(p) && !canCancelSubscription(p) && (
                  <p className="text-[11px] text-gray-500">
                    No Square subscription id is stored on this row, so it cannot be cancelled from the portal.
                    Re-sync subscriptions from Square, or cancel it in Square directly.
                  </p>
                )}

                {/* #307/#341: unchanged rule — only purchases that never became
                    real money are deletable at all. Kept apart from the cancel
                    button above and relabelled to say what it actually does:
                    it touches our record, not the family's card. */}
                {canDelete && DELETABLE_STATUSES.has(p.status) && (
                  <div className="pt-2 border-t border-gray-100">
                    <button onClick={() => deletePackage(p)} disabled={busy} className="flex items-center gap-1 border border-gray-300 text-gray-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50">
                      <Trash2 size={12} /> Delete portal record
                    </button>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Removes this row from the portal only. It does not stop Square billing anyone.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
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
          {/* #306: the write is confirmed out loud. A refused write is reported
              in the panel itself (writeOutcome.js turns "200 with zero rows"
              into a stated failure), so this banner only ever appears when a row
              really changed — the two outcomes never look the same. */}
          {extendNotice && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-xs text-green-900 flex items-start justify-between gap-3">
              <p>
                <span className="font-semibold">Extended.</span>{' '}
                &ldquo;{extendNotice.name}&rdquo; now expires {fmtDay(extendNotice.newDay)}
                {userName ? ` for ${userName}` : ''}. The reason and your name are on the package.
              </p>
              <button onClick={() => setExtendNotice(null)} className="text-green-700 hover:text-green-900 flex-shrink-0" aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )}
          {!loading && unconfirmedCount > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold mb-1">Check Square before deleting anything here.</p>
              <p>
                {unconfirmedCount === 1 ? 'One package on this account has' : `${unconfirmedCount} packages on this account have`}{' '}
                no payment confirmed in the portal. Payment confirmations from Square are
                not currently reaching us, so some of these may in fact have been paid.
                Confirm in Square first — deleting a package the athlete paid for cannot be undone.
              </p>
            </div>
          )}
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Loading packages…</p>
          ) : (
            <>
              {/* #344: THE SUBSCRIPTIONS SECTION ALWAYS RENDERS, even with zero
                  rows — and that is the whole point of this fix, not a detail.
                  The first version put the staleness warning inside the group,
                  so it only appeared for athletes who already had a subscription
                  on file. But the reported failure is the exact opposite case: a
                  subscription that STARTED AFTER the last sync has no row here at
                  all, so the screen would have said nothing and silently implied
                  the athlete has no subscriptions. That is what happened to
                  Charles Martin. "We have none on file as of <date>" is a very
                  different statement from "they have none", and staff comparing
                  this screen against Square need to be told which one they are
                  looking at. */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Subscriptions (recurring)</h4>
                  {/* These rows are a manual snapshot taken by
                      square-subscriptions-backfill, not live Square data, so the
                      screen states how old it is rather than letting staff assume
                      it is current. Charles Martin's invoice was paid a week after
                      the last run — the portal could not have known. */}
                  <p className="text-xs text-gray-400 mt-1">
                    {syncedOn
                      ? `Subscriptions last synced from Square on ${syncedOn}. Anything started or cancelled since then may not appear here.`
                      : 'Subscriptions are synced from Square manually and the date of the last sync is unknown. Anything started or cancelled since then may not appear here.'}
                  </p>
                  {/* #344: Cordell asked to "cancel / delete" as if they were
                      one action. They are not, and the difference is money —
                      which is exactly why both now exist and are described
                      separately. */}
                  <p className="text-xs text-gray-400 mt-1">
                    &ldquo;Cancel subscription&rdquo; stops Square billing the family and refunds nothing. &ldquo;Delete portal record&rdquo; removes the portal&apos;s record only and does not stop the billing. They are not the same thing.
                  </p>
                </div>
                {subscriptions.length > 0 ? (
                  subscriptions.map(renderPurchase)
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 p-3">
                    <p className="text-sm text-gray-600">
                      {syncedOn
                        ? `No subscriptions on file as of ${syncedOn}.`
                        : 'No subscriptions on file.'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      That is what the portal holds, not what Square holds. If this athlete is being
                      billed, check Square — a subscription started since the last sync will not be here.
                    </p>
                  </div>
                )}
              </div>
              {purchases.length === 0 && (
                <div className="text-center py-6">
                  <Package size={32} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No one-time packages assigned yet.</p>
                </div>
              )}
              {oneTimePurchases.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Packages &amp; lessons (one-time)</h4>
                  {oneTimePurchases.map(renderPurchase)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {/* #344 cancel dialog.
        HEIGHT: five popups on this project have pushed their own buttons off the
        bottom of the screen and one of them locked a coach out entirely. So the
        shell below carries NO max-height — the only capped, scrolling element is
        the middle <div>, and the footer holding the buttons is its SIBLING, not
        its child. Long copy scrolls inside the middle; the footer cannot move.
        Same shape as the coaches dialog in Schedule.js. */}
    {cancelTarget && (
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-lg w-full flex flex-col">
          <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <Ban size={18} className="text-rose-600" />
              <h3 className="text-base font-bold text-gray-900">
                {cancelResult ? 'Cancellation result' : 'Cancel this subscription?'}
              </h3>
            </div>
            <button
              onClick={() => { if (!cancelSending) { setCancelTarget(null); setCancelResult(null); } }}
              disabled={cancelSending}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
            >
              <X size={20} />
            </button>
          </div>

          {/* THE ONLY SCROLLING ELEMENT IN THIS DIALOG. */}
          <div className="px-5 py-4 max-h-[50vh] overflow-y-auto">
            {cancelResult ? (
              <div className={`rounded-lg border p-3 ${OUTCOME_STYLES[cancelResult.tone].box}`}>
                <p className={`text-sm font-bold ${OUTCOME_STYLES[cancelResult.tone].title}`}>
                  {(cancelResult.tone === 'warn' || cancelResult.tone === 'error') && (
                    <AlertTriangle size={14} className="inline-block mr-1.5 -mt-0.5" />
                  )}
                  {cancelResult.title}
                </p>
                <div className={`mt-2 space-y-2 text-xs ${OUTCOME_STYLES[cancelResult.tone].body}`}>
                  {cancelResult.lines.map((line, i) => <p key={i}>{line}</p>)}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="font-semibold text-gray-900">{cancelTarget.product}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {frequencyLabel(cancelTarget.purchase)} billing · Athlete: {cancelTarget.athlete}
                  </div>
                </div>
                {/* Every one of these is a thing a family has been told wrongly
                    before. They are spelled out here, at the moment of pressing,
                    not buried in a help page. */}
                <ul className="space-y-2 text-xs text-gray-700 list-disc pl-4">
                  <li>
                    <span className="font-semibold">This stops future billing in Square.</span> No further
                    payments will be taken for this subscription.
                  </li>
                  <li>
                    <span className="font-semibold">It does NOT refund anything already paid.</span> If money
                    needs to go back to this family, that is a separate refund, done in Square.
                  </li>
                  <li>
                    <span className="font-semibold">{cancelTarget.athlete} keeps access until the end of the
                    period already paid for.</span> Square cancels at the end of the current billing period,
                    not today, so do not tell the family their access has stopped.
                  </li>
                  <li>
                    Nothing is deleted. The record stays on this screen with its history.
                  </li>
                </ul>
                <p className="text-xs text-gray-500">
                  Square is asked live, so this does not depend on the last manual sync.
                  The exact date billing stops is shown once it is done.
                </p>
              </div>
            )}
          </div>

          {/* FOOTER — sibling of the scrolling element above, never inside it. */}
          <div className="border-t border-gray-200 px-5 py-3 flex flex-wrap justify-end gap-2 flex-shrink-0">
            {cancelResult ? (
              <>
                {/* Retry is offered ONLY where the outcome says nothing reached
                    Square. After square_verify or db_write there is no retry
                    button at all, because pressing it is the wrong move. */}
                {cancelResult.retryable && (
                  <button
                    onClick={runCancelSubscription}
                    disabled={cancelSending}
                    className="rounded-lg border border-rose-300 text-rose-700 px-4 py-1.5 text-sm font-medium hover:bg-rose-50 transition disabled:opacity-50"
                  >
                    Try again
                  </button>
                )}
                <button
                  onClick={() => { setCancelTarget(null); setCancelResult(null); }}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelSending}
                  className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
                >
                  Keep billing
                </button>
                {/* Disabled the instant it is pressed. This moves money. */}
                <button
                  onClick={runCancelSubscription}
                  disabled={cancelSending}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 transition disabled:opacity-60"
                >
                  <Ban size={14} />
                  {cancelSending ? 'Cancelling in Square…' : 'Yes, stop the billing'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
