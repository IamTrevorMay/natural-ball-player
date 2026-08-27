// #306 — extending an expired package so its remaining sessions become usable
// again. Staff-only (admin or coach), one package at a time, with a reason on
// file and a record of who did it.
//
// WHY THIS EXISTS
//
// Cordell: "The sessions are hidden if the package expires. The only way to get
// those sessions back is if an admin or coach manually extended the package
// after it expired. This function needs to exist."
//
// The hiding is real and it is enforced in three separate places, so this is
// not a cosmetic problem:
//   * Schedule.js ~102     — the booking-cap read filters
//                            `expires_at.is.null,expires_at.gt.now`, so an
//                            expired pack stops counting toward what the
//                            athlete is allowed to book.
//   * Schedule.js ~8300    — marking attendance draws down the first
//                            non-expired pack; an expired one is never picked,
//                            so the session silently comes out of nothing.
//   * AthleteOutreach.js:63 — an expired pack is not "currently held".
// Moving `expires_at` forward is therefore the whole fix. Nothing else needs to
// change for the sessions to come back.
//
// WHY IT MATTERS NOW
//
// Packs paid retroactively start their clock from the day they were actually
// paid. When the Square catch-up runs, square-webhook computes expires_at from
// the payment date (see supabase/functions/_shared/packageExpiry.ts), so a pack
// paid months ago lands already expired the moment it syncs. Real athletes will
// be cut off by a backfill they had nothing to do with, and this is how the
// desk puts one of them right.
//
// WHY NO MIGRATION
//
// `store_purchases.metadata` is jsonb NOT NULL DEFAULT '{}' (20260616_square_store)
// and the UPDATE policy already admits admin and coach
// (20260713_package_usage: `store_purchases_update_staff`). The audit trail
// lives under a single `extensions` key in that column. Nothing is added to the
// schema and no policy is touched.

import { supabase } from './supabaseClient';
import { classifyWriteOutcome } from './writeOutcome';

// The jsonb key. Everything else already in `metadata` (square-checkout writes
// `idempotency_key`, `payment_link_id`, `plan_variation_id`) is carried through
// untouched by withExtensionRecorded below.
export const EXTENSIONS_KEY = 'extensions';

// A short reason is mandatory — this is money and access — but it is free text,
// because the reasons are not knowable in advance and a dropdown of guesses
// would just get "Other" every time. Capped so a paste accident cannot bloat
// the row.
export const REASON_MAX_LENGTH = 240;

// The facility's session-pack terms, keyed by pack size. This MIRRORS
// supabase/functions/_shared/packageExpiry.ts (BUNDLE_EXPIRY_DAYS) — that copy
// is Deno/TypeScript and cannot be imported into the CRA bundle. If the terms
// change, both must change. Any pack size not listed has no term at all, which
// is why "full term" is offered only when we actually know one.
export const BUNDLE_TERM_DAYS = { 5: 60, 10: 120, 20: 180 };

export function termDaysForBundleQty(bundleQty) {
  if (bundleQty == null) return null;
  return BUNDLE_TERM_DAYS[Number(bundleQty)] ?? null;
}

// The offered jumps. A date field is still the source of truth — these only
// fill it in, so staff are never stuck with the presets.
export const EXTENSION_PRESET_DAYS = [14, 30, 60, 90];

// --------------------------------------------------------------------------
// Dates.
//
// `new Date('2026-09-14')` is parsed as UTC midnight and prints as the 13th
// everywhere west of Greenwich. Every day-string in this module is therefore
// parsed at noon local, which is the convention already used across
// scheduleUtils.js, bookingCaps.js, Schedule.js and WorkSchedule.js. A day
// string here always means a calendar day as staff would say it out loud.
// --------------------------------------------------------------------------

// Date (or timestamp) -> 'YYYY-MM-DD' in the viewer's own timezone.
export function localDayString(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD'. Noon anchor, so a DST boundary inside
// the span cannot shift the answer by a day.
export function addDaysToDay(dayString, days) {
  if (!dayString) return null;
  const d = new Date(`${dayString}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days));
  return localDayString(d);
}

// Whole calendar days between two day strings. Used for "N more days", so it
// counts days, never hours — an answer of "29.6 days" helps nobody.
export function daysBetweenDays(fromDay, toDay) {
  if (!fromDay || !toDay) return null;
  const a = new Date(`${fromDay}T12:00:00`);
  const b = new Date(`${toDay}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// The stored value for a chosen day. End of that day, local — identical to what
// the existing "Set expiration" button in PackagesModal.js writes, so the two
// controls cannot disagree about what "expires on the 14th" means.
export function dayToExpiryIso(dayString) {
  if (!dayString) return null;
  const d = new Date(`${dayString}T23:59:59`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// --------------------------------------------------------------------------
// Reading the current state of one package.
// --------------------------------------------------------------------------

/**
 * What the expiry on a purchase currently means.
 *
 * `state` is deliberately three-valued. `expires_at` is NULL on most rows —
 * square-checkout leaves it null on insert, square-webhook only fills it in for
 * a paid pack whose product carries a bundle_qty of 5, 10 or 20, and every
 * other row has one only if somebody typed it in by hand. A null expiry is NOT
 * an expired package: every consumer treats null as "never expires", so such a
 * pack is not hidden and has nothing to give back.
 */
export function describeExpiry(expiresAt, now = new Date()) {
  if (!expiresAt) return { state: 'none', day: null, days: null };
  const t = new Date(expiresAt);
  if (Number.isNaN(t.getTime())) return { state: 'unreadable', day: null, days: null };
  const today = localDayString(now);
  const day = localDayString(t);
  const days = daysBetweenDays(today, day);
  if (t.getTime() < now.getTime()) return { state: 'expired', day, days: Math.abs(days ?? 0) };
  return { state: 'live', day, days: days ?? 0 };
}

/**
 * The new expiry a given number of days buys, and what it was counted from.
 *
 * The base is `max(today, current expiry)`, not the current expiry. Adding 30
 * days to an expiry that passed 40 days ago produces a date still in the past —
 * the staff member would press the button, be told it worked, and the athlete
 * would still be locked out. That is the exact failure this whole feature
 * exists to prevent, so the base is stated back to them in the preview
 * (`countedFromToday`) rather than being a silent correction.
 */
export function previewPresetDays({ expiresAt, days, now = new Date() }) {
  const today = localDayString(now);
  const info = describeExpiry(expiresAt, now);
  const usable = info.state === 'live' ? info.day : today;
  return {
    baseDay: usable,
    countedFromToday: usable === today && info.state !== 'live',
    newDay: addDaysToDay(usable, days),
  };
}

// --------------------------------------------------------------------------
// The audit trail.
// --------------------------------------------------------------------------

/**
 * Every extension ever recorded on a purchase, oldest first.
 *
 * Tolerant on purpose. `metadata` is free-form jsonb that three other writers
 * touch; if `extensions` is missing, is not an array, or holds entries that are
 * not objects, this returns what it can rather than throwing inside a render
 * and blanking the packages screen.
 */
export function readExtensions(metadata) {
  const raw = metadata && metadata[EXTENSIONS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e === 'object');
}

export function latestExtension(metadata) {
  const list = readExtensions(metadata);
  return list.length > 0 ? list[list.length - 1] : null;
}

/**
 * `metadata` with one extension appended. Never replaces the object: the other
 * keys square-checkout writes are the link between this row and the Square
 * order, and losing them to a careless `{ extensions: [...] }` would break the
 * reconciliation those keys exist for.
 */
export function withExtensionRecorded(metadata, record) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return { ...base, [EXTENSIONS_KEY]: [...readExtensions(base), record] };
}

// --------------------------------------------------------------------------
// The write.
// --------------------------------------------------------------------------

export const EXTEND_OK = 'ok';
export const EXTEND_INVALID = 'invalid';       // caller gave us something unusable
export const EXTEND_STALE = 'stale';           // the row moved since the preview
export const EXTEND_ERRORED = 'errored';       // the database said no, out loud
export const EXTEND_BLOCKED = 'blocked';       // the database said nothing and wrote nothing

/**
 * Extend one package's expiry and record who, when and why.
 *
 * @param {object}  args
 * @param {string}  args.purchaseId
 * @param {string}  args.newDay                 chosen expiry, 'YYYY-MM-DD'
 * @param {?string} args.expectedExpiresAt      what the preview showed, so a row
 *                                              changed since then is refused
 * @param {string}  args.reason
 * @param {?string} args.actorId
 * @param {?string} args.actorName
 * @returns {Promise<{ code: string, message?: string, row?: object, current?: object }>}
 */
export async function extendPackageExpiry({
  purchaseId,
  newDay,
  expectedExpiresAt = null,
  reason,
  actorId = null,
  actorName = null,
  now = new Date(),
}) {
  const cleanReason = String(reason || '').trim().slice(0, REASON_MAX_LENGTH);
  if (!purchaseId) return { code: EXTEND_INVALID, message: 'No package was selected.' };
  if (!cleanReason) return { code: EXTEND_INVALID, message: 'A reason is required.' };

  const newExpiresAt = dayToExpiryIso(newDay);
  if (!newExpiresAt) return { code: EXTEND_INVALID, message: 'That is not a date we can read.' };

  // Re-read immediately before writing. Two reasons, and the first is the one
  // that would actually bite: `metadata` has to be merged client-side (jsonb
  // has no append through PostgREST), so writing a copy fetched when the modal
  // opened would silently drop anything written to the row since. The second is
  // that the staff member is about to change a date they were shown, and if
  // somebody else already moved it the preview they approved is a lie.
  const { data: fresh, error: readErr } = await supabase
    .from('store_purchases')
    .select('id, expires_at, metadata, remaining_qty, product_name_snapshot')
    .eq('id', purchaseId)
    .maybeSingle();
  if (readErr) return { code: EXTEND_ERRORED, message: null, error: readErr };
  if (!fresh) {
    return { code: EXTEND_BLOCKED, message: 'That package could not be read back — it may have been removed, or the portal may not be allowing this account to see it. Nothing was changed.' };
  }
  if ((fresh.expires_at || null) !== (expectedExpiresAt || null)) {
    return { code: EXTEND_STALE, current: fresh };
  }

  const record = {
    at: new Date(now).toISOString(),
    by: actorId,
    by_name: actorName || null,
    reason: cleanReason,
    from: fresh.expires_at || null,
    to: newExpiresAt,
    from_day: fresh.expires_at ? localDayString(fresh.expires_at) : null,
    to_day: newDay,
    added_days: fresh.expires_at ? daysBetweenDays(localDayString(fresh.expires_at), newDay) : null,
  };

  // .select('id, expires_at, metadata') is what makes this honest: without it a
  // policy-refused UPDATE returns 200 with no error and is indistinguishable
  // from one that worked. See writeOutcome.js.
  const { data: updated, error: updErr } = await supabase
    .from('store_purchases')
    .update({ expires_at: newExpiresAt, metadata: withExtensionRecorded(fresh.metadata, record) })
    .eq('id', purchaseId)
    .select('id, expires_at, metadata');

  const outcome = classifyWriteOutcome({ error: updErr, data: updated, expected: 1 });
  if (outcome.outcome === 'errored') return { code: EXTEND_ERRORED, error: updErr };
  if (outcome.outcome !== 'written') {
    // Zero rows back. The statement matched nothing the policy would let this
    // account write, so NOTHING happened — say that, rather than reporting a
    // success the athlete will find out about at the desk.
    console.warn('Package extension refused (0 rows) for purchase', purchaseId);
    return {
      code: EXTEND_BLOCKED,
      message: 'The database accepted the request but changed no rows, which means it refused the write. The expiry has NOT moved and nothing was recorded. Extending a package requires an admin or coach account — check yours, then try again.',
    };
  }
  return { code: EXTEND_OK, row: updated[0], record };
}
