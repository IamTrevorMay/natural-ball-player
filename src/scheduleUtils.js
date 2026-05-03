// Shared schedule utilities used by Main Portal Schedule and Work Portal Staff Schedule.

export const fmtLocalDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
          let found = false;
          for (let i = 0; i < 7; i++) {
            current.setDate(current.getDate() + 1);
            const dayName = ['SU','MO','TU','WE','TH','FR','SA'][current.getDay()];
            if (rule.byDay.includes(dayName)) { found = true; break; }
          }
          if (!found) current.setDate(current.getDate() + 1);
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
        if (!ex.is_exception) return;
        expanded.push(ex);
      } else {
        expanded.push({ ...master, id: `${master.id}_${index}`, event_date: dateStr, _is_virtual: true, _master_id: master.id, _occurrence_index: index });
      }
    });
  });
  return expanded;
}
