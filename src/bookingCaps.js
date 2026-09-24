// Weekly booking caps derived from a package name (#276).
//
// The business rule, from the issue:
//   * All lifting packages can book up to 4 LIFTING sessions a week.
//   * A package named "one time a week" allows 1 NON-LIFTING session a week.
//   * A package named "2-4 times a week" allows 2 NON-LIFTING sessions a week.
// The point is to stop a coach's request queue filling up and to stop athletes
// overusing the system — so every check here WARNS, it never blocks.
//
// Session counts really live inside Square, which we do not call. The owner
// described the rule in terms of the package NAME, so the name is what we
// parse. A name that says nothing about frequency yields `null` — "unknown",
// which callers must treat as "no cap, stay silent". We never guess.
//
// A lifting session is one whose coach carries the Strength & Conditioning
// skill tag (the seventh COACH_SKILL_OPTIONS entry, added for this issue on
// fork/nick/sc-coach-skill and reused here so there is exactly one spelling
// of the tag in the codebase).
import { SC_SKILL } from './skillOptions';
import { familyKey } from './productFamily';

// Every lifting package gets the same lifting allowance, per the issue.
export const LIFTING_WEEKLY_CAP = 4;

// Square exported the same real-world package several times, once per billing
// frequency, e.g. "NBP 2x A Week Training (MONTHLY price)". Everything before
// the "(FREQUENCY price)" suffix is the real package name — same rule as the
// product-family key used elsewhere in the app. Strip it before parsing.
const FREQUENCY_SUFFIX = /\s*\((?:MONTHLY|EVERY_TWO_WEEKS|EVERY_SIX_MONTHS|QUARTERLY|ANNUAL|[A-Z_]+)\s+price\)\s*$/i;

export const stripFrequencySuffix = (name) => (name || '').replace(FREQUENCY_SUFFIX, '').trim();

// "one time a week" / "two times a week" — only rewrite a number word when it
// is actually counting sessions, so "18u" / "Naturals 12u" style names and any
// other stray word stay untouched.
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

function normalizeName(name) {
  let s = stripFrequencySuffix(name).toLowerCase().replace(/\s+/g, ' ');
  s = s.replace(/\b(one|two|three|four|five|six|seven)\b(?=\s+times?\b)/g, (w) => String(NUMBER_WORDS[w]));
  return s;
}

// "2-4x a week", "1-2x A Week", "2 to 4 times per week"
const RANGE_RE = /(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:x|times?)\s*(?:a|per|\/)?\s*week/;
// "2x a week", "3x A Week", "1 time per week", "4x/week"
const SINGLE_RE = /(\d+)\s*(?:x|times?)\s*(?:a|per|\/)?\s*week/;

// The weekly session frequency stated in a product name, or null when the name
// says nothing about frequency. For a range ("1-2x a week") this is the TOP of
// the range — that is the most sessions the package entitles the athlete to.
export function weeklyFrequencyFromName(productName) {
  const s = normalizeName(productName);
  if (!s) return null;
  const range = s.match(RANGE_RE);
  if (range) return Math.max(parseInt(range[1], 10), parseInt(range[2], 10));
  const single = s.match(SINGLE_RE);
  if (single) return parseInt(single[1], 10);
  return null;
}

// How many NON-LIFTING sessions a week the package named `productName` allows.
//   1        -> 1   ("one time a week")
//   2, 3, 4  -> 2   (the issue's "named 2-4 times a week" bucket: 3x and 4x
//                    packages are inside that band, so they get the same 2)
//   5+       -> 2   (no such package exists today; clamped to the top bucket
//                    rather than inventing a bigger allowance)
//   no frequency in the name -> null, meaning UNKNOWN: do not cap, do not warn.
// A range like "1-2x a week" resolves on its top value (2), so it lands in the
// 2-4 bucket — the package sells up to two sessions a week, so two is what the
// athlete is allowed.
export function weeklyNonLiftingCap(productName) {
  const freq = weeklyFrequencyFromName(productName);
  if (freq === null) return null;
  if (freq <= 1) return 1;
  return 2;
}

// Pull a display name off whatever purchase shape the caller has: store_purchases
// rows snapshot the name, joined store_products rows carry it as `name`.
export const purchaseName = (p) =>
  p?.product_name_snapshot || p?.name || p?.store_products?.name || p?.product_name || '';

// (capsForPurchases — the pre-#306 aggregate — now lives below the allowance
// table as a thin wrapper over allowancesForPurchases.)

// A session is a lifting session when its coach carries the S&C skill tag.
//
// FALLBACK, deliberate: a coach with NO skills recorded counts as NON-LIFTING.
// Today 0 of 22 coaches are tagged S&C, so defaulting the other way would
// classify every existing session as lifting and hand everybody the cap of 4 —
// i.e. the feature would silently do nothing. Erring toward non-lifting means
// the tighter cap applies until an admin tags the two S&C coaches, which is the
// visible, fixable failure mode.
export function isLiftingCoach(coach) {
  const skills = Array.isArray(coach) ? coach : coach?.skills;
  if (!Array.isArray(skills) || skills.length === 0) return false;
  return skills.some((s) => String(s).trim().toLowerCase() === SC_SKILL.toLowerCase());
}

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The Sunday-to-Saturday calendar week a slot date falls in. This matches the
// week the rest of the app already uses (scheduleUtils.monthWeekRange and
// Schedule.js getWeekRangeLabel both do `date - date.getDay()`), so a "week"
// here is the same week the coach sees on the schedule. Parsed at noon so a
// DST boundary cannot roll the date backwards.
export function weekRangeForDate(slotDate) {
  const d = new Date(`${slotDate}T12:00:00`);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { startStr: fmtDate(start), endStr: fmtDate(end) };
}

// ---------------------------------------------------------------------------
// #306 — per-package weekly allowances, from Cordell (2026-08-25).
//
// Cordell described the six packages that have no number in their name as
// allowances that refill every week, not buckets that empty:
//
//   NBP College Training                         4 S&C + 1 skills a week
//   Adam Cimber Submarine Pitching & Lifting     2 a week, S&C or skills
//   NBP 1-2x A Week Training                     2 S&C + 1 skills a week
//   NBP Once A Week Training                     1 S&C + 1 skills a week
//   Submarine Academy                            2 a week, S&C or skills
//   Trevor May Pitching Academy                  1 a week, with Trevor May only
//
// Two separate pots where he gave two numbers — a 5th lift can't be taken
// in place of the skills session — and unused weeks don't bank.
//
// Keyed by product family (productFamily.familyKey: the name with Square's
// "(MONTHLY price)" suffix stripped, lowercased), so every billing-frequency
// twin of a package resolves to one row. "NBP 1-2x A Week Program" is the
// subscription twin of "NBP 1-2x A Week Training" (same words, the version
// 9 athletes actually hold) and is given the same allowance; that mapping
// is an inference from the name and is called out on #306 for Cordell.
//
// Anything not in this table falls back to the name-parsing rule above
// (#276): "2x a week" in the name -> 2 skills a week, and every package
// carries the flat S&C allowance of LIFTING_WEEKLY_CAP.
//
//   { sc, skills }            two pots
//   { any }                   one pot, either kind counts against it
//   coachOnly: [names]        lowercased full names the allowance is valid
//                             with; booking anyone else warns
export const PACKAGE_ALLOWANCES = {
  'nbp college training':                                     { sc: 4, skills: 1 },
  'adam cimber submarine pitching & lifting program monthly': { any: 2 },
  'nbp 1-2x a week training':                                 { sc: 2, skills: 1 },
  'nbp 1-2x a week program':                                  { sc: 2, skills: 1 },
  'nbp once a week training':                                 { sc: 1, skills: 1 },
  'submarine academy':                                        { any: 2 },
  'trevor may pitching academy':                              { any: 1, coachOnly: ['trevor may'] },
};

// Session classes. A slot says which it is via training_slots.session_type
// (set by the coach in CreateSlotPanel); when it doesn't, the coach's S&C
// skill tag decides, as it did before #306's column existed.
export const SESSION_SC = 'sc';
export const SESSION_SKILLS = 'skills';

export function sessionClass(slot, coach) {
  if (slot?.session_type === SESSION_SC) return SESSION_SC;
  if (slot?.session_type === SESSION_SKILLS) return SESSION_SKILLS;
  return isLiftingCoach(coach) ? SESSION_SC : SESSION_SKILLS;
}

// The allowance one product name grants, or null when neither the table nor
// the name says anything.
export function allowanceForName(productName) {
  const key = familyKey(productName);
  if (key && PACKAGE_ALLOWANCES[key]) return PACKAGE_ALLOWANCES[key];
  const skills = weeklyNonLiftingCap(productName);
  if (skills === null) return null;
  return { sc: LIFTING_WEEKLY_CAP, skills };
}

// Effective allowance for everything a player owns — the MOST GENEROUS value
// per pot across their purchases, so holding two packages never punishes
// anyone. Returns null only when the player holds nothing at all.
//
// Parity with the pre-#306 rule: a player who holds SOME package whose name
// states no frequency still gets the flat S&C allowance (the old code gave
// liftingCap = 4 to anyone with a purchase) and no skills cap (silence).
//
// coachOnly is set only when EVERY allowance-bearing package the player
// holds is coach-restricted — one general package alongside the Trevor May
// academy means they may book anyone.
export function allowancesForPurchases(purchases) {
  const list = purchases || [];
  if (list.length === 0) return null;
  const out = {};
  let bearing = 0;
  let restricted = 0;
  let coachOnly = [];
  list.forEach((p) => {
    const a = allowanceForName(purchaseName(p));
    if (!a) return;
    bearing += 1;
    ['sc', 'skills', 'any'].forEach((k) => {
      if (a[k] == null) return;
      out[k] = out[k] == null ? a[k] : Math.max(out[k], a[k]);
    });
    if (a.coachOnly) { restricted += 1; coachOnly = [...new Set([...coachOnly, ...a.coachOnly])]; }
  });
  if (out.sc == null && out.any == null) out.sc = LIFTING_WEEKLY_CAP;
  out.coachOnly = bearing > 0 && restricted === bearing ? coachOnly : null;
  return out;
}

// Legacy shape, still used by AdminSettings' package overview.
export function capsForPurchases(purchases) {
  const a = allowancesForPurchases(purchases);
  return {
    nonLiftingCap: a ? (a.skills ?? a.any ?? null) : null,
    liftingCap: a ? (a.sc ?? a.any ?? null) : null,
  };
}

// The warning text for booking one more session, or null when nothing is wrong
// (or when we simply do not know enough to say anything).
//
// `counts` = { sc, skills }: the player's EXISTING bookings that week, not
// counting the one being booked now. `bookingClass` is the class of the
// session being booked. `bookingCoachName` is that session's coach, for the
// coach-only rule. `self: true` addresses the athlete directly; otherwise the
// message is about them, for a coach reading it.
export function capWarningMessage({ playerName, self, allowances, counts, bookingClass, bookingCoachName }) {
  if (!allowances) return null;
  const subject = self ? 'You' : (playerName || 'This athlete');
  const whose = self ? 'your package' : 'their package';

  if (allowances.coachOnly && bookingCoachName) {
    const name = String(bookingCoachName).trim().toLowerCase();
    if (!allowances.coachOnly.includes(name)) {
      const names = allowances.coachOnly.map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase())).join(' or ');
      return `${subject} ${self ? 'hold' : 'holds'} a package that covers sessions with ${names} only — this session is with ${bookingCoachName}.`;
    }
  }

  const sc = counts?.sc || 0;
  const skills = counts?.skills || 0;
  let cap;
  let already;
  let kind;
  if (allowances.any != null && allowances[bookingClass] == null) {
    cap = allowances.any;
    already = sc + skills;
    kind = '';
  } else {
    cap = allowances[bookingClass];
    already = bookingClass === SESSION_SC ? sc : skills;
    kind = bookingClass === SESSION_SC ? 'strength & conditioning ' : 'skills ';
  }
  // Unknown cap -> silence. Never guess a limit nobody stated.
  if (cap === null || cap === undefined) return null;
  if (already + 1 <= cap) return null;
  const verb = self ? 'already have' : 'already has';
  return `${subject} ${verb} ${already} ${kind}session${already === 1 ? '' : 's'} booked this week; ${whose} allows ${cap}.`;
}
