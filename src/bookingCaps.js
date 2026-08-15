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

// Effective caps for everything a player owns. A player holding two packages is
// not punished for it — we take the MOST GENEROUS cap across their purchases.
// `nonLiftingCap: null` means no purchase they hold names a frequency, so the
// caller must not warn about non-lifting sessions at all.
export function capsForPurchases(purchases) {
  let nonLiftingCap = null;
  (purchases || []).forEach((p) => {
    const cap = weeklyNonLiftingCap(purchaseName(p));
    if (cap === null) return;
    nonLiftingCap = nonLiftingCap === null ? cap : Math.max(nonLiftingCap, cap);
  });
  return {
    nonLiftingCap,
    // The lifting allowance is a flat 4 for every package, so it is only
    // "unknown" when the player holds no package at all.
    liftingCap: (purchases || []).length > 0 ? LIFTING_WEEKLY_CAP : null,
  };
}

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

// The warning text for booking one more session, or null when nothing is wrong
// (or when we simply do not know enough to say anything).
//
// `liftingCount` / `nonLiftingCount` are the player's EXISTING bookings in that
// week, not counting the one being booked now.
// `self: true` addresses the athlete directly (the player booking themselves);
// otherwise the message is about them, for a coach reading it.
export function capWarningMessage({ playerName, self, caps, liftingCount, nonLiftingCount, bookingIsLifting }) {
  const cap = bookingIsLifting ? caps?.liftingCap : caps?.nonLiftingCap;
  // Unknown cap -> silence. Never guess a limit the package name did not state.
  if (cap === null || cap === undefined) return null;
  const already = bookingIsLifting ? liftingCount : nonLiftingCount;
  if (already + 1 <= cap) return null;
  const kind = bookingIsLifting ? 'lifting' : 'non-lifting';
  const subject = self ? 'You' : (playerName || 'This athlete');
  const verb = self ? 'already have' : 'already has';
  const whose = self ? 'your package' : 'their package';
  return `${subject} ${verb} ${already} ${kind} session${already === 1 ? '' : 's'} booked this week; ${whose} allows ${cap}.`;
}
