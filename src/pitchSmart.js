/* ============================================================================
   pitchSmart.js — shared MLB / USA Baseball Pitch Smart caps + required rest.

   Single source of truth for both program engines:
     * scProgramEngine.js  — uses the numeric league-AGE API
       (`requiredRestDays`, `dailyPitchMax`), driving lower-body lift scheduling
       around the arm.
     * throwingEngine.js    — uses the per-LEVEL API (`pitchSmartByLevel`),
       driving the throwing microcycle's rest flags.

   Two tables are kept intentionally. They are near-equivalent encodings of the
   same published guidance, but calibrated differently: the age-bracket table is
   a coarse 3-bracket approximation; the level table is more granular (splits
   15-16 vs 17-18, adds a pro tier). Housing both here — rather than forcing one
   onto the other — keeps each engine's published calibration exactly intact.
   ========================================================================== */

/* --------------------------------------------------------------------------- *
 *  Numeric league-age API (S&C engine).
 *  Rest days required AFTER an outing, ascending "pitchCount <= threshold".
 * --------------------------------------------------------------------------- */
const REST_7_14 = [[20, 0], [35, 1], [50, 2], [65, 3], [10000, 4]];
const REST_15_18 = [[30, 0], [45, 1], [60, 2], [80, 3], [10000, 4]];
const REST_19_22 = [[30, 0], [45, 1], [60, 2], [80, 3], [105, 4], [10000, 5]];

export function requiredRestDays(leagueAge, pitchCount) {
  if (pitchCount <= 0) return 0;
  const table = leagueAge <= 14 ? REST_7_14 : leagueAge <= 18 ? REST_15_18 : REST_19_22;
  for (const [threshold, rest] of table) if (pitchCount <= threshold) return rest;
  return table[table.length - 1][1];
}

export function dailyPitchMax(leagueAge) {
  if (leagueAge >= 7 && leagueAge <= 8) return 50;
  if (leagueAge <= 10) return 75;
  if (leagueAge <= 12) return 85;
  if (leagueAge <= 16) return 95;
  if (leagueAge <= 18) return 105;
  return null; // adult — no fixed cap
}

/* --------------------------------------------------------------------------- *
 *  Per-level API (throwing engine).
 *  Rest thresholds are descending "pitchCount >= threshold -> days".
 * --------------------------------------------------------------------------- */
export const PITCH_SMART = {
  '9-10': { max: 75, rest: [[66, 4], [51, 3], [36, 2], [21, 1], [1, 0]] },
  '11-12': { max: 85, rest: [[66, 4], [51, 3], [36, 2], [21, 1], [1, 0]] },
  '13-14': { max: 95, rest: [[66, 4], [51, 3], [36, 2], [21, 1], [1, 0]] },
  '15-16': { max: 95, rest: [[76, 4], [61, 3], [46, 2], [31, 1], [1, 0]] },
  '17-18': { max: 105, rest: [[81, 4], [61, 3], [46, 2], [31, 1], [1, 0]] },
  '19-22': { max: 120, rest: [[106, 5], [81, 4], [61, 3], [46, 2], [31, 1], [1, 0]] },
  pro: { max: 110, rest: [[100, 5], [76, 4], [51, 3], [31, 2], [1, 1]] },
};

export function pitchSmartByLevel(levelId, pitches) {
  const ps = PITCH_SMART[levelId] || PITCH_SMART['17-18'];
  let rest = 0;
  for (const [t, d] of ps.rest) if (pitches >= t) { rest = d; break; }
  return { max: ps.max, rest, over: pitches > ps.max };
}
