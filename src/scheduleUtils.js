// Shared schedule utilities used by Main Portal Schedule and Work Portal Staff Schedule.

export const fmtLocalDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Date range covering the calendar month of `selectedDate`, widened to include the
// full Sun–Sat week it sits in. Ensures week-view fetches don't drop days that fall
// in the adjacent month when a week straddles a month boundary (#157). In month view
// the week is inside the month, so the range is just the month.
export function monthWeekRange(selectedDate) {
  const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const startOfWeek = new Date(selectedDate);
  startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const rangeStart = startOfWeek < startOfMonth ? startOfWeek : startOfMonth;
  const rangeEnd = endOfWeek > endOfMonth ? endOfWeek : endOfMonth;
  return { rangeStart, rangeEnd, startStr: fmtLocalDate(rangeStart), endStr: fmtLocalDate(rangeEnd) };
}

export function generateOccurrenceDates(startDate, rule, rangeStart, rangeEnd) {
  const dates = [];
  if (!rule || !rule.freq) return dates;
  const start = new Date(startDate + 'T12:00:00');
  const interval = rule.interval || 1;
  const maxCount = rule.count || 365;
  const until = rule.until ? new Date(rule.until + 'T23:59:59') : null;
  const rangeStartStr = fmtLocalDate(rangeStart);
  const rangeEndStr = fmtLocalDate(rangeEnd);
  let current = new Date(start);
  let count = 0;
  while (count < maxCount) {
    if (until && current > until) break;
    const currentStr = fmtLocalDate(current);
    if (currentStr > rangeEndStr) break;
    if (currentStr >= rangeStartStr && currentStr <= rangeEndStr) {
      dates.push(new Date(current));
    }
    switch (rule.freq) {
      case 'daily': current.setDate(current.getDate() + interval); break;
      case 'weekly':
        if (rule.byDay && rule.byDay.length > 0) {
          // Advance to the next day that is in byDay AND in an "active" week. Weeks are
          // counted from the start date's week; with interval N only every N-th week is
          // active (e.g. "every 2 weeks on Mon/Wed"). Bounded to avoid an infinite loop
          // if byDay somehow never matches.
          const dayCodes = ['SU','MO','TU','WE','TH','FR','SA'];
          const startOfWeek = (d) => { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0); return s; };
          const baseWeek = startOfWeek(start);
          let guard = 0;
          const maxSteps = 7 * interval + 7;
          do {
            current.setDate(current.getDate() + 1);
            guard++;
            const inByDay = rule.byDay.includes(dayCodes[current.getDay()]);
            const weekIdx = Math.round((startOfWeek(current) - baseWeek) / (7 * 86400000));
            if (inByDay && weekIdx % interval === 0) break;
          } while (guard < maxSteps);
        } else {
          current.setDate(current.getDate() + (7 * interval));
        }
        break;
      case 'monthly': current.setMonth(current.getMonth() + interval); break;
      case 'yearly': current.setFullYear(current.getFullYear() + interval); break;
      default: return dates;
    }
    count++;
  }
  return dates;
}

export function expandRecurringEvents(masters, exceptions, rangeStart, rangeEnd) {
  const exceptionMap = {};
  exceptions.forEach(ex => {
    const key = `${ex.recurrence_parent_id}_${ex.original_date || ex.event_date}`;
    exceptionMap[key] = ex;
  });
  const expanded = [];
  masters.forEach(master => {
    if (!master.recurrence_rule) return;
    const dates = generateOccurrenceDates(master.event_date, master.recurrence_rule, rangeStart, rangeEnd);
    dates.forEach((date, index) => {
      const dateStr = fmtLocalDate(date);
      const exKey = `${master.id}_${dateStr}`;
      if (exceptionMap[exKey]) {
        const ex = exceptionMap[exKey];
        // A cancelled/deleted occurrence is a tombstone row — hide it.
        // (facility_events uses is_exception; staff_schedule_events uses is_cancelled)
        if (ex.is_cancelled || ex.is_exception) return;
        // Otherwise it's a modified occurrence — render the replacement row.
        expanded.push(ex);
      } else {
        expanded.push({ ...master, id: `${master.id}_${index}`, event_date: dateStr, _is_virtual: true, _master_id: master.id, _occurrence_index: index });
      }
    });
  });
  return expanded;
}

// training_slots' per-occurrence exception model (#279, extended by #292).
// Unlike facility_events/schedule_events, training_slots has no generic
// recurrence_rule/expandRecurringEvents path — every caller expands its own
// repeat_weekly loop — so these helpers only answer per-date questions; each
// caller still runs its own weekly expansion.
//
// A child row (recurrence_parent_id set, original_date = the series date it
// stands in for) means one of two things:
//   is_exception=true  → that date is HIDDEN/CANCELLED (a tombstone, #279)
//   is_exception=false → that occurrence was MOVED (#292): it now lives at the
//                        child row's own slot_date and must render there as a
//                        real session
//
// Every training_slots reader MUST do all three of the following:
//   1. Skip any expanded occurrence date that has ANY exception row — a
//      tombstoned date is gone, and a moved date's session lives elsewhere.
//      (Skipping only tombstones would render a moved occurrence twice.)
//   2. Render moved child rows (collectMovedSlots) as real sessions on their
//      own slot_date, subject to the reader's own date-range filtering.
//   3. Never render a tombstone (is_exception=true) child row at all.
export function buildSlotExceptionMap(slots) {
  const map = {};
  (slots || []).forEach(slot => {
    if (slot.recurrence_parent_id && slot.original_date) {
      map[`${slot.recurrence_parent_id}_${slot.original_date}`] = slot;
    }
  });
  return map;
}

// The exception child row standing in for (masterId, dateStr), or undefined.
// Truthy result (tombstone OR moved) means "don't expand this series date".
export function getSlotDateException(exceptionMap, masterId, dateStr) {
  return exceptionMap[`${masterId}_${dateStr}`];
}

// Kept for compatibility: true only for tombstones. Readers deciding whether
// to expand a date should prefer getSlotDateException (any exception skips).
export function isSlotDateCancelled(exceptionMap, masterId, dateStr) {
  const ex = exceptionMap[`${masterId}_${dateStr}`];
  return !!(ex && ex.is_exception);
}

// Moved occurrences (#292): child rows that must render as real sessions on
// their own slot_date. Each carries the session fields the move copied off the
// master (coach_id, start_time, duration_minutes, ...). Callers apply their
// own date-range filter to the returned rows.
export function collectMovedSlots(slots) {
  return (slots || []).filter(slot => slot.recurrence_parent_id && slot.is_exception === false);
}

// ============================================
// facility_events per-occurrence writes (#347)
// ============================================
// These live here, not in Schedule.js, because two separate UIs need them:
// the right-click Delete in Month/Week view and the Delete/Save buttons in
// FacilityEventDetail (which is the only delete affordance Lanes view has).
// Before #347 those two paths had different implementations and the popup's
// one destroyed the whole series.

// Columns that must NOT be copied from a series master onto one of its
// per-occurrence child rows, plus the two joined objects that ride along on
// every read (`athlete:athlete_id(full_name)`, `coach:coach_id(full_name)` —
// see fetchFacilityEvents' facSelect). Those joins are not real columns, so
// leaving them in would make Postgres reject the insert. Client-side fields
// (_is_virtual, _master_id, _is_facility, _occurrence_index) are stripped by
// their `_` prefix below.
const FACILITY_EXCEPTION_DROP_KEYS = [
  'id', 'is_recurring', 'recurrence_rule', 'recurrence_index',
  'created_at', 'updated_at', 'athlete', 'coach',
];

// #347: build the exception row that stands in for one date of a series.
// SPREADS `source` (the master row, or the expanded virtual occurrence that
// carries all of the master's fields) instead of re-listing columns. Six
// hand-written field lists used to do this, and every one of them silently
// dropped is_public / public_price_cents / public_capacity / booking_type /
// is_non_team_activity / created_by — with NOT NULL defaults that made the
// omission destructive (is_public -> false, public_capacity -> 1), so moving
// one week of a public $40 cage rental unpublished it and lost its price.
export function buildFacilityExceptionRow(source, masterId, occurrenceDate, patch = {}) {
  const row = { ...(source || {}) };
  FACILITY_EXCEPTION_DROP_KEYS.forEach(k => { delete row[k]; });
  Object.keys(row).forEach(k => { if (k.startsWith('_')) delete row[k]; });
  return {
    ...row,
    recurrence_parent_id: masterId,
    original_date: occurrenceDate,
    event_date: occurrenceDate,
    // false = "this occurrence is DIFFERENT"; true = "this occurrence is
    // GONE" (see expandRecurringEvents above). Callers that mean to hide the
    // date pass is_exception: true through `patch` — deleteFacilityOccurrence.
    is_exception: false,
    is_recurring: false,
    ...patch,
  };
}

// #347: find-or-create the child row for (masterId, occurrenceDate) and apply
// `patch` to it. Always looks first: there is no unique index on
// (recurrence_parent_id, original_date), so a blind INSERT can leave two
// children for one date and expandRecurringEvents' last-write-wins map would
// then pick between them non-deterministically. Returns an error or undefined.
export async function upsertFacilityException(supabase, source, masterId, occurrenceDate, patch = {}) {
  const findExisting = () => supabase
    .from('facility_events')
    .select('id')
    .eq('recurrence_parent_id', masterId)
    .eq('original_date', occurrenceDate)
    .maybeSingle();

  const { data: existing, error: findError } = await findExisting();
  if (findError) return findError;
  if (existing) {
    const { error } = await supabase.from('facility_events').update(patch).eq('id', existing.id);
    return error;
  }
  const { error } = await supabase
    .from('facility_events')
    .insert(buildFacilityExceptionRow(source, masterId, occurrenceDate, patch));
  // 23505 = unique_violation, i.e. someone (or a double-click) created the row
  // between the lookup and the insert. Same discipline as the training_slots
  // tombstone path (#279): fall back to updating what is already there.
  if (error && error.code === '23505') {
    const { data: raced } = await findExisting();
    if (raced) {
      const { error: updateError } = await supabase.from('facility_events').update(patch).eq('id', raced.id);
      return updateError;
    }
  }
  return error;
}

// #347: hide ONE date of a series. Never a row delete — both
// facility_events_recurrence_parent_id_fkey and event_signups_event_id_fkey
// are ON DELETE CASCADE, so deleting the master by id takes every occurrence,
// every per-occurrence edit and every athlete sign-up with it. If the date
// already has an exception row (a previously modified occurrence) that row is
// UPDATED into a tombstone rather than deleted — deleting it would only remove
// the override and let the master's original values reappear on that day.
export async function deleteFacilityOccurrence(supabase, source, masterId, occurrenceDate) {
  return upsertFacilityException(supabase, source, masterId, occurrenceDate, { is_exception: true });
}

// #347: delete the whole series — the master row and every child row.
export async function deleteFacilitySeries(supabase, masterId) {
  const { error: childError } = await supabase.from('facility_events').delete().eq('recurrence_parent_id', masterId);
  if (childError) return childError;
  const { error } = await supabase.from('facility_events').delete().eq('id', masterId);
  return error;
}

// #347 QA: what deleteFacilityFuture returns when it was about to take the
// whole series, asked, and the user said no. It is NOT an error — nothing was
// deleted and nothing went wrong — so callers must check for it before either
// reporting a failure or acting as though the delete happened.
export const DELETE_CANCELLED = 'delete-cancelled';

// #347 QA: the one place that counts athlete sign-ups for a set of rows that
// are about to be removed. `targets` is a list of { eventId, eventDate }:
// eventDate names a single date on that row (one occurrence of a series),
// while a null/absent eventDate means EVERY date on that row — which is what a
// plain row delete takes, because event_signups_event_id_fkey is ON DELETE
// CASCADE. Returns the count, or null when it could not be established; a null
// must never be printed as a number (see facilitySeriesDeleteWarning).
export async function countSignupsForEvents(supabase, targets) {
  const list = (targets || []).filter(t => t && t.eventId);
  if (list.length === 0) return 0;
  const ids = [...new Set(list.map(t => t.eventId))];
  // Rows, not a head-count: a count query cannot express "this id but only on
  // this date", and matching the (id, date) pairs here keeps the number exact
  // instead of over-counting other dates of the same series.
  const { data, error } = await supabase
    .from('event_signups')
    .select('event_id, event_date, user_id')
    .in('event_id', ids);
  if (error) return null;
  const everyDate = new Set(list.filter(t => !t.eventDate).map(t => t.eventId));
  const onDate = new Set(list.filter(t => t.eventDate).map(t => `${t.eventId}_${t.eventDate}`));
  const matched = (data || []).filter(r => everyDate.has(r.event_id) || onDate.has(`${r.event_id}_${r.event_date}`));
  // QA: count PEOPLE, not rows. One athlete can hold both an old child-keyed
  // row and a new master-keyed one for the same date, and the roster the coach
  // just looked at dedupes by athlete — a warning saying 2 while the screen
  // says 1 undermines the warning.
  return new Set(matched.map(r => `${r.user_id}_${r.event_date}`)).size;
}

// #347 QA: the numbers for the "this wipes the whole series" warning.
// Returns { occurrences, signups }; either is null when it could not be worked
// out, and the caller must then leave that number out of the sentence rather
// than print a wrong or zero one. `master` is the row deleteFacilityFuture
// already fetched (recurrence_rule + event_date), so no extra read for it.
export async function countFacilitySeriesImpact(supabase, masterId, master) {
  let occurrences = null;
  try {
    const rule = typeof master?.recurrence_rule === 'string'
      ? JSON.parse(master.recurrence_rule)
      : (master?.recurrence_rule || null);
    // Only a series with an end (an until date or a repeat count) has an
    // honest number of dates. An open-ended one stays null.
    if (master?.event_date && rule?.freq && (rule.until || rule.count)) {
      const start = new Date(master.event_date + 'T12:00:00');
      const end = rule.until
        ? new Date(rule.until + 'T12:00:00')
        : new Date(start.getFullYear() + 10, start.getMonth(), start.getDate());
      occurrences = generateOccurrenceDates(master.event_date, rule, start, end).length || null;
    }
  } catch (e) {
    occurrences = null;
  }
  // #347 QA: sign-ups are recorded against whichever facility_events row the
  // popup was showing. On a normal occurrence that is the series master, but on
  // an occurrence that had already been edited (a real child row) it is the
  // CHILD's id — and deleteFacilitySeries removes the children too, taking
  // their sign-ups with them. Counting only the master therefore under-counted,
  // and a series whose only sign-ups sat on edited dates confirmed with "No
  // athletes are signed up" while three of them were about to be cancelled.
  // So: count across the master AND every child row of the series.
  const { data: children, error: childError } = await supabase
    .from('facility_events')
    .select('id')
    .eq('recurrence_parent_id', masterId);
  // Can't list the children -> can't establish the total. Stay null so the
  // warning uses the number-free wording rather than a reassuring wrong one.
  if (childError) return { occurrences, signups: null };
  const eventIds = [masterId, ...(children || []).map(c => c.id)];
  // Whole series: every date on every one of those rows goes.
  const signups = await countSignupsForEvents(supabase, eventIds.map(id => ({ eventId: id })));
  return { occurrences, signups };
}

// #347 QA: the one wording for "you are about to destroy a whole series", so
// the Delete button on the event card and the right-click menu cannot drift.
export function facilitySeriesDeleteWarning(counts, lead) {
  const { occurrences, signups } = counts || {};
  const dates = !occurrences
    ? 'every date in this series, past and future'
    : occurrences === 1
      ? 'the one date in this series'
      : `all ${occurrences} dates in this series`;
  const signupLine = signups == null
    ? 'Any athlete sign-ups on those dates will be cancelled.'
    : signups === 0
      ? 'No athletes are signed up.'
      : `${signups} athlete sign-up${signups === 1 ? '' : 's'} will be cancelled.`;
  return `${lead}\n\nThis permanently deletes ${dates}, along with any changes made to individual dates. `
    + `${signupLine} This cannot be undone.`;
}

// #347: end the series the day before `cutoff` by capping recurrence_rule.until.
// If the master's own start date is already past the cutoff there is nothing
// left to keep, so "this and future" is really "all" — and deleting the series
// cascades to every occurrence and every athlete sign-up.
//
// #347 QA: that escalation used to happen silently, so picking "Delete this and
// future events" on the FIRST date of a series destroyed everything with no
// warning. `confirmWholeSeries` is now asked first, and is handed the master row
// so it can put real numbers in the warning. No confirm handler, or an answer of
// no, means nothing is deleted — a future caller that forgets to pass one gets a
// harmless no-op instead of a silent wipe.
export async function deleteFacilityFuture(supabase, masterId, cutoff, confirmWholeSeries) {
  const { data: master, error: masterError } = await supabase
    .from('facility_events').select('recurrence_rule, event_date').eq('id', masterId).single();
  if (masterError) return masterError;
  if (!master) return null;
  const cutoffDate = new Date(cutoff + 'T00:00:00');
  cutoffDate.setDate(cutoffDate.getDate() - 1);
  const until = fmtLocalDate(cutoffDate);
  if (master.event_date && master.event_date > until) {
    const confirmed = typeof confirmWholeSeries === 'function' ? await confirmWholeSeries(master) : false;
    if (!confirmed) return DELETE_CANCELLED;
    return deleteFacilitySeries(supabase, masterId);
  }
  const rule = typeof master.recurrence_rule === 'string' ? JSON.parse(master.recurrence_rule) : (master.recurrence_rule || {});
  rule.until = until;
  const { error } = await supabase.from('facility_events').update({ recurrence_rule: rule }).eq('id', masterId);
  return error;
}
