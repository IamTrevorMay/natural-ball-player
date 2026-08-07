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
