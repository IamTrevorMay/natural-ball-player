import { supabase } from './supabaseClient';

/*
 * Default 3-month Pro lifting block (#assessment default program).
 *
 * When a coach ticks the "start a default program" box while submitting an
 * assessment, this drops the first 12 weeks of the Pro track onto the athlete's
 * calendar, so a brand-new athlete has something to train on until a coach
 * builds them a real plan.
 *
 * The Pro folder in the program library holds one workout_template per lifting
 * day, named like "Lower M1W1" (month 1, week 1, max-effort lower) or
 * "DE Upper M2W3" (month 2, week 3, dynamic-effort upper). Four of those make a
 * training week, and they land on the calendar as:
 *
 *   Lower     -> Monday
 *   Upper     -> Tuesday
 *   DE Lower  -> Thursday
 *   DE Upper  -> Friday
 *
 * The same folder also holds a parallel second-year track named "Lower Y2M1W1"
 * and so on. New athletes start on year one, so anything carrying a year prefix
 * in front of the month is skipped. So are one-offs that live in the folder but
 * aren't one of the four lifting days (e.g. "Split M4W2") — they'd otherwise
 * push a real lift off its day.
 */

export const PRO_FOLDER = 'Pro';
export const DEFAULT_PROGRAM_WEEKS = 12;

// Offsets from the Monday that starts each training week: Mon, Tue, Thu, Fri.
// The index is the day rank below, so if a week is missing (say) its Upper day,
// the remaining lifts stay on their own weekdays instead of shifting forward.
const LIFT_DAY_OFFSETS = [0, 1, 3, 4];

/**
 * Pull month / week / day-type out of a Pro template name.
 * Returns null for anything that isn't a year-one lifting day.
 */
export function parseProTemplateName(name) {
  const n = (name || '').toLowerCase();

  // "y2m1w1" -> a later-year track. Year one carries no year prefix.
  if (/y\d+\s*m\d+\s*w\d+/.test(n)) return null;

  const mw = n.match(/m(\d+)\s*w(\d+)/);
  if (!mw) return null;

  const isDE = /\bde\b/.test(n);
  const isLower = n.includes('lower');
  const isUpper = n.includes('upper');

  let dayRank = -1;
  if (isLower && !isDE) dayRank = 0;
  else if (isUpper && !isDE) dayRank = 1;
  else if (isLower && isDE) dayRank = 2;
  else if (isUpper && isDE) dayRank = 3;
  if (dayRank === -1) return null;

  return { month: parseInt(mw[1], 10), week: parseInt(mw[2], 10), dayRank };
}

/** The next Monday strictly after today. */
export function nextMonday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const delta = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Same note format the calendar's drag-and-drop uses, so an auto-scheduled
// workout looks identical to one a coach dragged on by hand.
function buildNotes(tpl) {
  const exercises = tpl.exercises || [];
  const body = [
    tpl.notes || '',
    exercises.length > 0
      ? '\n--- Exercises ---\n' +
        exercises
          .map((ex) =>
            [
              ex.name,
              ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : ex.sets || '',
              ex.rest || '',
              ex.load || '',
              ex.link || '',
            ].join(' | ')
          )
          .join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return body || null;
}

/**
 * Has this athlete already been given training by anyone?
 * Keeps the default block off anybody who is already set up.
 */
export async function playerAlreadyHasTraining(playerId) {
  const [assignments, workouts] = await Promise.all([
    supabase
      .from('training_program_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId),
    supabase
      .from('schedule_events')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('event_type', 'workout'),
  ]);
  if (assignments.error) throw assignments.error;
  if (workouts.error) throw workouts.error;
  return (assignments.count || 0) > 0 || (workouts.count || 0) > 0;
}

/**
 * Schedule the default 3-month Pro block for one athlete.
 *
 * Returns { scheduled, skipped, reason?, weeks?, startDate? }. A skip is a
 * normal outcome, not an error — the caller reports it and moves on.
 */
export async function assignDefaultProProgram(playerId) {
  if (!playerId) return { scheduled: 0, skipped: true, reason: 'No athlete selected.' };

  if (await playerAlreadyHasTraining(playerId)) {
    return {
      scheduled: 0,
      skipped: true,
      reason: 'This athlete already has training scheduled, so the default program was left alone.',
    };
  }

  const { data, error } = await supabase
    .from('workout_templates')
    .select('id, name, folder, program, notes, exercises, created_at')
    .or(`folder.eq.${PRO_FOLDER},program.eq.${PRO_FOLDER}`)
    .order('created_at')
    .limit(1000);
  if (error) throw error;

  // Mirror the program library's own folder rule: `folder` wins, `program` is
  // only a fallback for templates that never got filed.
  const proTemplates = (data || []).filter((t) => (t.folder || t.program) === PRO_FOLDER);

  const parsed = [];
  proTemplates.forEach((t) => {
    const key = parseProTemplateName(t.name);
    if (key) parsed.push({ ...t, ...key });
  });

  if (parsed.length === 0) {
    return {
      scheduled: 0,
      skipped: true,
      reason: `No year-one lifting days were found in the "${PRO_FOLDER}" folder.`,
    };
  }

  parsed.sort(
    (a, b) =>
      a.month - b.month ||
      a.week - b.week ||
      a.dayRank - b.dayRank ||
      (a.created_at || '').localeCompare(b.created_at || '')
  );

  // Group into training weeks, keeping the library's month -> week order.
  const weeks = [];
  const weekIndexByKey = new Map();
  parsed.forEach((t) => {
    const key = `${t.month}-${t.week}`;
    if (!weekIndexByKey.has(key)) {
      weekIndexByKey.set(key, weeks.length);
      weeks.push([]);
    }
    const bucket = weeks[weekIndexByKey.get(key)];
    // First template wins a given day slot, so a duplicate can't double-book it.
    if (!bucket.some((x) => x.dayRank === t.dayRank)) bucket.push(t);
  });

  const start = nextMonday();
  const rows = [];
  weeks.slice(0, DEFAULT_PROGRAM_WEEKS).forEach((week, weekIndex) => {
    week.forEach((tpl) => {
      const d = new Date(start);
      d.setDate(d.getDate() + weekIndex * 7 + LIFT_DAY_OFFSETS[tpl.dayRank]);
      rows.push({
        event_type: 'workout',
        title: tpl.name,
        notes: buildNotes(tpl),
        event_date: fmtDate(d),
        category: 'strength', // matches folderToCategory('Pro') in Schedule.js
        player_id: playerId,
      });
    });
  });

  if (rows.length === 0) {
    return { scheduled: 0, skipped: true, reason: 'Nothing to schedule.' };
  }

  const { error: insertError } = await supabase.from('schedule_events').insert(rows);
  if (insertError) throw insertError;

  return {
    scheduled: rows.length,
    skipped: false,
    weeks: Math.min(weeks.length, DEFAULT_PROGRAM_WEEKS),
    startDate: fmtDate(start),
  };
}
