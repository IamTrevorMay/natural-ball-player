// Shared list of skills a coach can cover for lessons / skills sessions (#245).
// Surfaced in the booking flow (Schedule.js coach drawer + ReserveSlotModal) and
// edited by staff in AdminSettings CoachCard and ManageCoaches.
// #276: how the strength & conditioning coach gets identified. Nothing is
// tagged with it yet — an admin applies it to the two S&C coaches through
// the UI (AdminSettings coach card / ManageCoaches) after this ships.
// Named separately so bookingCaps.js can test for it without re-spelling it.
export const SC_SKILL = 'Strength & Conditioning';

export const COACH_SKILL_OPTIONS = [
  'Pitching',
  'Throwing',
  'Hitting',
  'Fielding',
  'Catching',
  'Base Running',
  SC_SKILL,
];
