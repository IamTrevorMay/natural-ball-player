import React from 'react';
import { CalendarDays } from 'lucide-react';

/* --------------------------------------------------------------------------- *
 *  Training-day availability (#385 — Cordell)
 *
 *  "Coaches / admins need to have the option to choose what days the athlete can
 *   have programming on / can't have programming on … so their programming aligns
 *   with the days the team practices are scheduled."
 *
 *  Shared by the S&C, Throwing and Hitting generators (NOT nutrition — the issue
 *  excludes it). Two things live here:
 *
 *   1. <TrainingDaysPicker> — the seven Mon–Sun toggles. Purely presentational.
 *   2. The pure weekday-placement helpers the three generators use so that all
 *      three behave IDENTICALLY.
 *
 *  WEEKDAY INDEX CONVENTION — Mon = 0 … Sun = 6. This is the convention the three
 *  engines already use (scProgramEngine WD/WD_NAME, throwingEngine `days`,
 *  hittingEngine WD_ABBR), and it is the index encoded in the training_days
 *  `day_number` column:
 *
 *      day_number = (week - 1) * 7 + weekdayIndex + 1     (1-based, absolute)
 *
 *  THE ANCHOR — verified 2026-09-02, follow-up to #385. The ONE place day_number
 *  becomes a calendar date is Schedule.js handleProgramDrop (src/Schedule.js ~1734,
 *  arithmetic at ~1794-1796): each day is placed at
 *
 *      dropDate + (day_number - 1) days
 *
 *  where dropDate is the calendar cell the coach DRAGS the program onto — chosen
 *  later, possibly by someone else, possibly weeks after generation. The
 *  `training_program_assignments.start_date` the three generators write is NOT a
 *  placement anchor: nothing anywhere combines it with day_number (it only feeds the
 *  active/past filter and the date printed on the athlete profile).
 *
 *  So weekday index 0 means "the day the program is dropped on", NOT literally
 *  Monday. The names below — and the "Mon"/"Tue" tokens the three engines bake into
 *  day titles — are the true weekdays only when the program is dropped on a Monday.
 *  Dropped on a Wednesday, every session shifts two days later and a deselected day
 *  can still be hit.
 *
 *  Why this is not silently "fixed" by snapping the anchor to Monday: day_number is
 *  OVERLOADED. Hand-built programs from CoachTools write day_number = i + 1, a plain
 *  sequential 1..N ("day 1, day 2, day 3" — CoachTools.js ~1692 / ~1724 / ~1951), and
 *  Schedule.js cannot tell the two kinds apart. Snapping the drop to Monday would
 *  scatter those consecutive days across a week and could place day 1 in the past.
 *  The convention is therefore preserved and the UI states it plainly instead — see
 *  DROP_ANCHOR_NOTE below.
 *
 *  OVER-SUBSCRIPTION POLICY (chosen once, applied in all three generators):
 *  if a week needs more session days than the coach has made available, generation
 *  / saving is BLOCKED with an inline message. Sessions are never silently dropped
 *  and never silently stacked two-to-a-day.
 * --------------------------------------------------------------------------- */

export const WEEKDAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Default = every day allowed, i.e. exactly the behaviour before #385. */
export const ALL_TRAINING_DAYS = [0, 1, 2, 3, 4, 5, 6];

const cleanDays = (xs) => [...new Set(Array.isArray(xs) ? xs : [])]
  .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  .sort((a, b) => a - b);

/** Pretty "Mon · Wed · Fri" for any list of weekday indices. */
export const formatDays = (xs) => cleanDays(xs).map((d) => WEEKDAY_ABBR[d]).join(' · ');

/**
 * The plain-English truth about what the weekday names above mean. Shown in the
 * picker (so it is on screen in all three generators) and repeated in each
 * generator's save confirmation, which is the moment before a coach goes and drops
 * the program on the calendar. See "THE ANCHOR" at the top of this file.
 */
export const DROP_ANCHOR_NOTE = 'These weekday names are counted from the drop date: whichever '
  + 'calendar day you drag this program onto becomes day 1 ("Mon"). Drop it on a Monday and the '
  + 'days above are the real weekdays; drop it on a Wednesday and every session shifts two days '
  + 'later, so a day you deselected can still be hit.';

/** Same truth, self-contained, for the save confirmation in each generator. */
export const DROP_ANCHOR_SAVE_NOTE = 'Drop it on a Monday when you put it on the calendar: the day '
  + 'you drop it on becomes day 1, so dropping on any other weekday shifts every session and can '
  + 'land one on a day you deselected.';

/**
 * Choose `n` weekdays out of the allowed set, spread as evenly as possible so a
 * 4-session week does not end up as four consecutive days. Always includes the
 * first and last allowed day. Returns null when n does not fit.
 *
 * The step (allowed.length - 1) / (n - 1) is >= 1 whenever n <= allowed.length, so
 * the chosen indices are strictly increasing — two sessions can never collide on
 * one day.
 */
export function spreadOntoDays(allowed, n) {
  const a = cleanDays(allowed);
  const count = Math.round(Number(n) || 0);
  if (count < 1 || count > a.length) return null;
  if (count === 1) return [a[0]];
  return Array.from({ length: count }, (_, i) => a[Math.round((i * (a.length - 1)) / (count - 1))]);
}

/**
 * Work out where a week's sessions should move to.
 *
 * @param originalWeekdays weekday indices the engine put sessions on
 * @param allowed          weekday indices the coach made available
 * @returns {{ok:boolean, moved:boolean, map:Map<number,number>, needed:number}}
 *   ok=false  -> more sessions than available days (caller must block & explain).
 *   moved=false -> every original day is already allowed, so NOTHING is changed.
 */
export function weekdayPlacement(originalWeekdays, allowed) {
  const orig = cleanDays(originalWeekdays);
  const a = cleanDays(allowed);
  const identity = new Map(orig.map((d) => [d, d]));
  if (!orig.length) return { ok: true, moved: false, map: identity, needed: 0 };
  // Already compatible — leave the engine's own placement completely alone.
  if (orig.every((d) => a.includes(d))) return { ok: true, moved: false, map: identity, needed: orig.length };
  const target = spreadOntoDays(a, orig.length);
  if (!target) return { ok: false, moved: false, map: identity, needed: orig.length };
  return { ok: true, moved: true, map: new Map(orig.map((d, i) => [d, target[i]])), needed: orig.length };
}

/** The inline message shown when a week's sessions cannot fit the chosen days. */
export function fitMessage(needed, allowedCount) {
  const s = (n) => (n === 1 ? '' : 's');
  if (!allowedCount) return 'Pick at least one training day before generating.';
  return `${needed} session${s(needed)} a week won't fit in ${allowedCount} available day${s(allowedCount)} `
    + '— pick more days, or fewer sessions per week.';
}

/* ---------------------- day_number <-> (week, weekday) ---------------------- */

export const weekOfDayNumber = (dayNumber) => Math.floor((Math.max(1, dayNumber) - 1) / 7) + 1;
export const weekdayOfDayNumber = (dayNumber) => (Math.max(1, dayNumber) - 1) % 7;

/**
 * Rewrite the weekday token in a generated day title ("Wk 3 · Mon — Long toss").
 * If the title carries no weekday token there is nothing to correct, so it is
 * left exactly as the engine wrote it.
 */
function retitle(title, from, to) {
  if (from === to || typeof title !== 'string') return title;
  const re = new RegExp(`\\b${WEEKDAY_ABBR[from]}\\b`);
  return re.test(title) ? title.replace(re, WEEKDAY_ABBR[to]) : title;
}

/**
 * Move a serializer's program-day rows onto the coach's allowed weekdays.
 *
 * Rows are the {day_number, title, notes, exercises} shape emitted by
 * throwingEngine.programToProgramDays and hittingEngine.planToProgramDays.
 * (The S&C generator does NOT use this — scProgramEngine assigns the weekday
 * itself, so its titles and its on-screen preview are correct at the source.)
 *
 * Placement is decided PER WEEK, because a week's session count can change across
 * a program (the throwing skeleton varies with week-in-phase). A week whose days
 * are all allowed already is left exactly as the engine wrote it — that preserves
 * the engine's own session spacing — so when no week needs moving the original row
 * array is returned untouched. If ANY week cannot fit, the whole call fails and no
 * rows are changed: the caller blocks and explains rather than dropping or stacking
 * sessions.
 *
 * @returns {{ok:boolean, moved:boolean, needed:number, rows:Array}}
 */
export function remapProgramDayRows(rows, allowed) {
  const list = Array.isArray(rows) ? rows : [];
  const a = cleanDays(allowed);
  if (!list.length) return { ok: true, moved: false, needed: 0, rows: list };

  const byWeek = new Map();
  list.forEach((r) => {
    const wk = weekOfDayNumber(r.day_number);
    if (!byWeek.has(wk)) byWeek.set(wk, new Set());
    byWeek.get(wk).add(weekdayOfDayNumber(r.day_number));
  });

  const placements = new Map();
  let needed = 0;
  let ok = true;
  let moved = false;
  byWeek.forEach((set, wk) => {
    const p = weekdayPlacement([...set], a);
    placements.set(wk, p);
    needed = Math.max(needed, p.needed);
    if (!p.ok) ok = false;
    if (p.moved) moved = true;
  });

  if (!ok || !moved) return { ok, moved: false, needed, rows: list };

  const out = list.map((r) => {
    const wk = weekOfDayNumber(r.day_number);
    const from = weekdayOfDayNumber(r.day_number);
    const to = placements.get(wk).map.get(from);
    if (to == null || to === from) return r;
    return { ...r, day_number: (wk - 1) * 7 + to + 1, title: retitle(r.title, from, to) };
  });
  out.sort((x, y) => x.day_number - y.day_number);
  return { ok: true, moved: true, needed, rows: out };
}

/* ------------------------------- the picker -------------------------------- */

const ACCENT = {
  blue: 'bg-blue-600 text-white border-blue-600',
  cyan: 'bg-cyan-600 text-white border-cyan-600',
  orange: 'bg-orange-500 text-white border-orange-500',
};

/**
 * Seven Mon–Sun toggles. Defaults to all seven selected, which reproduces the
 * pre-#385 behaviour exactly, so a coach who ignores this control sees no change.
 *
 * @param value      array of weekday indices (Mon=0 … Sun=6)
 * @param onChange   (nextValue:number[]) => void
 * @param accent     'blue' | 'cyan' | 'orange' — matches the host generator
 * @param placedOn   array of weekday indices the sessions will actually land on
 * @param error      inline over-subscription message ('' when it fits)
 * @param note       extra explanatory line under the toggles
 */
export default function TrainingDaysPicker({
  value, onChange, accent = 'blue', placedOn = null, error = '', note = '',
}) {
  const selected = cleanDays(value);
  const on = ACCENT[accent] || ACCENT.blue;
  const toggle = (d) => {
    const next = selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d];
    onChange(cleanDays(next));
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <CalendarDays className="w-4 h-4" /> Training days available
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => onChange([...ALL_TRAINING_DAYS])}
            className="text-xs text-gray-400 hover:text-gray-600 underline">All 7</button>
          <button type="button" onClick={() => onChange([0, 1, 2, 3, 4])}
            className="text-xs text-gray-400 hover:text-gray-600 underline">Weekdays</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {WEEKDAY_ABBR.map((abbr, d) => (
          <button key={abbr} type="button" onClick={() => toggle(d)} title={WEEKDAY_FULL[d]}
            aria-pressed={selected.includes(d)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${selected.includes(d)
              ? on : 'bg-white text-gray-500 border-gray-300'}`}>
            {abbr}
          </button>
        ))}
      </div>

      <div className="text-[10px] text-gray-400 mt-2">
        Deselect the days the athlete can&apos;t train — team practices, school, travel. All seven selected
        (the default) leaves the plan exactly as the engine builds it.
      </div>
      {note && <div className="text-xs text-gray-500 mt-2">{note}</div>}
      {placedOn && placedOn.length > 0 && !error && (
        <div className="text-xs text-gray-600 bg-gray-50 rounded p-2 mt-2">
          Sessions land on: <span className="font-semibold">{formatDays(placedOn)}</span>
          <span className="text-gray-500">
            {` (day${placedOn.length === 1 ? '' : 's'} ${placedOn.map((d) => d + 1).join(', ')} of each week)`}
          </span>
        </div>
      )}
      {/* The weekday names are relative to the drop date, not the calendar — say so
          rather than letting the labels imply a promise the schedule cannot keep. */}
      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
        <span className="font-semibold">Drop this program on a Monday.</span> {DROP_ANCHOR_NOTE}
      </div>
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-2">{error}</div>
      )}
    </div>
  );
}
