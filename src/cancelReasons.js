// #306: who decides a cancellation was "sick".
//
// Cordell: "Who decides a cancellation was 'sick'? ... Admins and coaches only
// choose if a cancellation was sick." Before this, the athlete pressed "I'm
// sick / injured" themselves and the session was handed straight back, so the
// person the rule protects the facility from was the person applying it.
//
// The values live in slot_reservations.cancel_reason, which is deliberately a
// loose `text` column with no CHECK constraint (see
// supabase/migrations/20260812_slot_reservations_cancel_reason.sql), so adding
// a value here needs no migration.
//
//   'athlete_cancelled' — the athlete cancelled their own booking. No staff
//                         member has looked at it. Counts against the package.
//   'sick'              — an admin or coach decided this one was illness or
//                         injury. The session goes back to the athlete.
//
// 'other' is the value the old athlete-chosen "Something else came up" button
// wrote. It means the same thing as 'athlete_cancelled' and is read, never
// written. Rows written before any of this shipped have no reason at all,
// which is also "nobody has looked at it".

export const CANCEL_REASON_ATHLETE = 'athlete_cancelled';
export const CANCEL_REASON_SICK = 'sick';

// Every value that means "not approved as sick" — the legacy 'other' and a
// null reason included. Used for the "needs review" filter and for deciding
// which of the two staff buttons is the current state.
export function isSickCancel(reason) {
  return reason === CANCEL_REASON_SICK;
}

export function cancelDecisionLabel(reason) {
  if (isSickCancel(reason)) return 'Sick / injured';
  return 'Counts against athlete';
}
