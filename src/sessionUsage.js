// #233↔#235↔#306: the one place that moves a session on or off an athlete's
// package.
//
// This is the body that used to live inside syncReservationSessionUsage in
// Schedule.js, lifted out unchanged in what it DOES so two screens can share
// it, and changed in one respect: it now reports what actually happened
// instead of swallowing everything.
//
// That matters because of a documented failure mode in this codebase — when
// row-level security refuses a write, PostgREST answers 200 with an empty body
// and no error, so an ignored result looks exactly like a success. The
// attendance path has always chosen to swallow package problems (marking a
// player present must not fail because their package is odd), and it still
// does. The staff cancellation-review screen cannot: giving the session back
// IS the whole action, so a refused write there has to reach a human. Hence a
// return value rather than a console.error.
//
// Every write below ends in .select() and is judged on the rows it returns.

import { supabase } from './supabaseClient';
import { formatUserError } from './errorMessage';

export const USAGE_OUTCOME = {
  CONSUMED: 'consumed',      // a session was deducted
  RELEASED: 'released',      // a deducted session was given back
  ALREADY: 'already',        // the ledger already said this; nothing to do
  NO_PACKAGE: 'no_package',  // no counted package to draw from
  UNCOUNTED: 'uncounted',    // the package has no session count to move
  BLOCKED: 'blocked',        // a write returned zero rows — refused, not done
  ERRORED: 'errored',        // the database said no out loud
};

const SOURCE_TYPE = 'training_slot';

function pkgName(p) {
  return p?.product_name_snapshot ? `"${p.product_name_snapshot}"` : 'their package';
}

/**
 * Consume or release the one package session tied to a training-slot
 * reservation.
 *
 * @param {object}  args
 * @param {string}  args.reservationId  slot_reservations.id — the usage row's source_id
 * @param {string}  args.playerId       the athlete whose package moves
 * @param {string} [args.usedOn]        date the session was for (YYYY-MM-DD)
 * @param {boolean} args.consume        true = deduct a session, false = give one back
 * @param {string} [args.actorId]       who is doing this
 * @param {string} [args.note]          what the usage row should say
 * @returns {Promise<{ok: boolean, outcome: string, message: string}>}
 *          ok:false means the athlete's package is NOT in the state the caller
 *          asked for, and the message says so in words a human can act on.
 */
export async function applySessionUsage({ reservationId, playerId, usedOn, consume, actorId, note }) {
  if (!reservationId || !playerId) {
    return {
      ok: false,
      outcome: USAGE_OUTCOME.ERRORED,
      message: 'The booking is missing an id or an athlete, so the package could not be touched.',
    };
  }

  try {
    const { data: existing, error: findErr } = await supabase
      .from('store_session_usage')
      .select('id, purchase_id')
      .eq('source_type', SOURCE_TYPE)
      .eq('source_id', reservationId)
      .limit(1);
    if (findErr) throw findErr;
    const has = existing && existing[0];

    if (consume) {
      if (has) {
        return { ok: true, outcome: USAGE_OUTCOME.ALREADY, message: 'This session was already counted against the package.' };
      }
      const { data: pkgs, error: pkgErr } = await supabase
        .from('store_purchases')
        .select('id, remaining_qty, expires_at, product_name_snapshot')
        .eq('user_id', playerId)
        .in('product_kind', ['package', 'bundle', 'lesson'])
        .in('status', ['active', 'paid'])
        .gt('remaining_qty', 0)
        .order('expires_at', { ascending: true, nullsFirst: false });
      if (pkgErr) throw pkgErr;
      const pkg = (pkgs || [])[0];
      // Not a failure: most packages in this database have no session count at
      // all (remaining_qty NULL), so there is genuinely nothing to deduct.
      if (!pkg) {
        return {
          ok: true,
          outcome: USAGE_OUTCOME.NO_PACKAGE,
          message: 'This athlete has no package with a session count, so nothing was deducted.',
        };
      }

      const { data: inserted, error: insErr } = await supabase
        .from('store_session_usage')
        .insert({
          purchase_id: pkg.id,
          user_id: playerId,
          used_on: usedOn || null,
          source_type: SOURCE_TYPE,
          source_id: reservationId,
          note: note || null,
          created_by: actorId || null,
        })
        .select('id');
      if (insErr) throw insErr;
      if (!inserted || inserted.length === 0) {
        return {
          ok: false,
          outcome: USAGE_OUTCOME.BLOCKED,
          message: 'Nothing was saved — the session-usage record was refused (zero rows written). The package is unchanged.',
        };
      }

      const { data: updated, error: updErr } = await supabase
        .from('store_purchases')
        .update({ remaining_qty: pkg.remaining_qty - 1 })
        .eq('id', pkg.id)
        .select('id');
      if (updErr) throw updErr;
      if (!updated || updated.length === 0) {
        return {
          ok: false,
          outcome: USAGE_OUTCOME.BLOCKED,
          message: `Half-applied: the session was logged as used, but the sessions-left count on ${pkgName(pkg)} was refused (zero rows written) and is now one too high. Fix it by hand on the athlete's packages.`,
        };
      }
      return { ok: true, outcome: USAGE_OUTCOME.CONSUMED, message: `One session deducted from ${pkgName(pkg)}.` };
    }

    // Release.
    if (!has) {
      return {
        ok: true,
        outcome: USAGE_OUTCOME.ALREADY,
        message: 'No session had been deducted for this booking, so there was nothing to give back.',
      };
    }
    const { data: purch, error: purchErr } = await supabase
      .from('store_purchases')
      .select('id, remaining_qty, product_name_snapshot')
      .eq('id', has.purchase_id)
      .maybeSingle();
    if (purchErr) throw purchErr;

    const { data: deleted, error: delErr } = await supabase
      .from('store_session_usage')
      .delete()
      .eq('id', has.id)
      .select('id');
    if (delErr) throw delErr;
    if (!deleted || deleted.length === 0) {
      return {
        ok: false,
        outcome: USAGE_OUTCOME.BLOCKED,
        message: 'Nothing was saved — removing the session-usage record was refused (zero rows deleted). The session was not given back.',
      };
    }

    if (!purch) {
      return {
        ok: true,
        outcome: USAGE_OUTCOME.RELEASED,
        message: 'The used-session record was removed. The package it pointed at could not be read, so the sessions-left count was left alone.',
      };
    }
    // A monthly package has no session count; there is no number to put back.
    if (purch.remaining_qty == null) {
      return {
        ok: true,
        outcome: USAGE_OUTCOME.UNCOUNTED,
        message: `The used-session record was removed. ${pkgName(purch)} has no session count, so there is no number to put back.`,
      };
    }

    const { data: reUpdated, error: reUpdErr } = await supabase
      .from('store_purchases')
      .update({ remaining_qty: purch.remaining_qty + 1 })
      .eq('id', purch.id)
      .select('id');
    if (reUpdErr) throw reUpdErr;
    if (!reUpdated || reUpdated.length === 0) {
      return {
        ok: false,
        outcome: USAGE_OUTCOME.BLOCKED,
        message: `Half-applied: the used-session record was removed, but the sessions-left count on ${pkgName(purch)} was refused (zero rows written) and is now one too low. Fix it by hand on the athlete's packages.`,
      };
    }
    return { ok: true, outcome: USAGE_OUTCOME.RELEASED, message: `One session returned to ${pkgName(purch)}.` };
  } catch (e) {
    return {
      ok: false,
      outcome: USAGE_OUTCOME.ERRORED,
      message: `The package could not be changed. ${formatUserError(e)}`,
    };
  }
}
