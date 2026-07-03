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
  let current = new Date(start);
  let count = 0;
  while (count < maxCount) {
    if (until && current > until) break;
    if (current > rangeEnd) break;
    if (current >= rangeStart && current <= rangeEnd) {
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
