import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { BarChart3, ChevronLeft, ChevronRight, Download, Clock, Plane } from 'lucide-react';
import { formatUserError } from './errorMessage';

// #318 — read-only reporting for "how many hours is each coach working / taking
// off". No writes anywhere in this file: it only SELECTs and aggregates in JS.
//
// Status vocabulary is taken verbatim from WorkAdminHours.js / WorkAdminTimeOff.js:
//   staff_hour_entries.status        -> pending | approved | rejected
//   staff_time_off_requests.status   -> pending | approved | rejected | cancelled
//   staff_time_off_requests.type     -> pto | sick | unpaid | other
// `rejected` and `cancelled` rows are NEVER counted. `pending` rows are counted
// only when the "All submitted" toggle is on, and are always kept in their own
// column / bar segment so approved pay-ready hours are never silently mixed with
// unreviewed ones.

const TYPE_LABEL = { pto: 'PTO', sick: 'Sick', unpaid: 'Unpaid', other: 'Other' };
const TYPE_ORDER = ['pto', 'sick', 'unpaid', 'other'];

const COLOR_APPROVED = '#4f46e5'; // indigo-600, the app accent
const COLOR_PENDING = '#a5b4fc';  // indigo-300

// --- date helpers -----------------------------------------------------------
// Matches the rest of the app: dates are plain `YYYY-MM-DD` strings and are
// parsed at LOCAL midnight (`+ 'T00:00:00'`), never as UTC. See Schedule.js.
const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => new Date(s + 'T00:00:00');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// Math.round (not floor) so a DST transition inside the span can't drop a day —
// same guard WorkAdminTimeOff.js uses in daysBetween().
const dayDiff = (a, b) => Math.round((b - a) / 86400000);

// Week starts on SUNDAY everywhere in this app (Schedule.js / scheduleUtils.js
// both do `setDate(getDate() - getDay())`). Matching it so the numbers here
// line up with what the schedule screens show.
const startOfWeek = (d) => { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0); return s; };
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

const GRANULARITIES = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'custom', label: 'Custom range' },
];

function periodRange(granularity, anchor, customStart, customEnd) {
  if (granularity === 'custom') {
    // Tolerate a backwards custom range rather than rendering nothing.
    const a = customStart || fmtLocalDate(anchor);
    const b = customEnd || fmtLocalDate(anchor);
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  }
  if (granularity === 'day') return { start: fmtLocalDate(anchor), end: fmtLocalDate(anchor) };
  if (granularity === 'week') {
    const s = startOfWeek(anchor);
    return { start: fmtLocalDate(s), end: fmtLocalDate(addDays(s, 6)) };
  }
  if (granularity === 'month') {
    return { start: fmtLocalDate(startOfMonth(anchor)), end: fmtLocalDate(endOfMonth(anchor)) };
  }
  return {
    start: fmtLocalDate(new Date(anchor.getFullYear(), 0, 1)),
    end: fmtLocalDate(new Date(anchor.getFullYear(), 11, 31)),
  };
}

// QA 2026-08-15 (BUG 2): month/year paging used to reset the anchor to the 1st
// (and year paging to Jan 1), so paging ▶ then ◀ on Year and switching back to
// Month landed you on January instead of the month you came from — and the CSV
// then exported a period the user was never looking at. Now we move the anchor
// by exactly one period and keep the rest of the date, clamping the day into
// the target month (Jan 31 ▶ Feb 28, Feb 29 ▶ Feb 28 in a non-leap year).
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

function shiftAnchor(granularity, anchor, dir) {
  const d = new Date(anchor);
  if (granularity === 'day') d.setDate(d.getDate() + dir);
  else if (granularity === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (granularity === 'month') {
    const day = d.getDate();
    d.setDate(1); // park on a day every month has before rolling the month over
    d.setMonth(d.getMonth() + dir);
    d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  } else {
    const month = d.getMonth(), day = d.getDate();
    d.setDate(1);
    d.setFullYear(d.getFullYear() + dir, month);
    d.setDate(Math.min(day, daysInMonth(d.getFullYear(), month)));
  }
  return d;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodLabel(granularity, anchor, range) {
  if (granularity === 'day') return parseISO(range.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (granularity === 'week') {
    const s = parseISO(range.start), e = parseISO(range.end);
    return `${MONTH_SHORT[s.getMonth()]} ${s.getDate()} – ${MONTH_SHORT[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
  }
  if (granularity === 'month') return anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (granularity === 'year') return String(anchor.getFullYear());
  const s = parseISO(range.start), e = parseISO(range.end);
  return `${MONTH_SHORT[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()} – ${MONTH_SHORT[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

// A coach can save an entry with start/end times but no hours_decimal (the
// column is nullable and only the "My Hours" form auto-fills it). We recompute
// the duration from start_time/end_time in that case instead of silently
// treating the shift as 0 hours — same overnight-wrap logic as
// WorkMyHours.js computeHours().
function entryHours(e) {
  if (e.hours_decimal != null) {
    const n = Number(e.hours_decimal);
    return Number.isFinite(n) ? n : 0;
  }
  if (!e.start_time || !e.end_time) return 0;
  const [sh, sm] = e.start_time.split(':').map(Number);
  const [eh, em] = e.end_time.split(':').map(Number);
  if ([sh, sm, eh, em].some((v) => !Number.isFinite(v))) return 0;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight shift, e.g. 22:00–02:00
  return mins > 0 ? mins / 60 : 0;
}

// Days of a time-off request that actually land inside [start, end], inclusive
// on both ends. A request that straddles the boundary (e.g. Dec 28 – Jan 4
// against a January period) is clipped, so it contributes only its in-period
// days and is never double-counted across two periods.
function daysInRange(reqStart, reqEnd, rangeStart, rangeEnd) {
  const s = reqStart > rangeStart ? reqStart : rangeStart;
  const e = reqEnd < rangeEnd ? reqEnd : rangeEnd;
  if (s > e) return 0;
  return dayDiff(parseISO(s), parseISO(e)) + 1;
}

const fmtHours = (n) => (Math.round(n * 100) / 100).toFixed(2);

export default function WorkAdminHoursAnalytics() {
  const [granularity, setGranularity] = useState('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(() => fmtLocalDate(startOfMonth(new Date())));
  const [customEnd, setCustomEnd] = useState(() => fmtLocalDate(endOfMonth(new Date())));
  const [approvedOnly, setApprovedOnly] = useState(true);
  const [sortKey, setSortKey] = useState('hours');
  const [sortDir, setSortDir] = useState('desc');

  const [entries, setEntries] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hovered, setHovered] = useState(null);

  const range = useMemo(
    () => periodRange(granularity, anchor, customStart, customEnd),
    [granularity, anchor, customStart, customEnd]
  );

  // The month/year roll-ups the owner asked for are relative to the period's
  // own calendar month/year, so we widen the fetch to cover that whole year.
  // Still exactly one query per table — we just aggregate the extra rows in JS.
  const refDate = useMemo(() => parseISO(range.start), [range.start]);
  const fetchRange = useMemo(() => {
    const yStart = fmtLocalDate(new Date(refDate.getFullYear(), 0, 1));
    const yEnd = fmtLocalDate(new Date(refDate.getFullYear(), 11, 31));
    return {
      start: range.start < yStart ? range.start : yStart,
      end: range.end > yEnd ? range.end : yEnd,
    };
  }, [range.start, range.end, refDate]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [hoursRes, offRes] = await Promise.all([
      supabase
        .from('staff_hour_entries')
        .select('id, user_id, work_date, start_time, end_time, hours_decimal, status, coach:user_id(full_name)')
        .gte('work_date', fetchRange.start)
        .lte('work_date', fetchRange.end)
        .order('work_date', { ascending: true }),
      // Overlap filter, NOT a containment filter: a request must be returned if
      // any part of it touches the window, so a stay that starts before the
      // window or ends after it still shows up.
      supabase
        .from('staff_time_off_requests')
        .select('id, user_id, start_date, end_date, type, status, coach:user_id(full_name)')
        .lte('start_date', fetchRange.end)
        .gte('end_date', fetchRange.start)
        .order('start_date', { ascending: true }),
    ]);
    if (hoursRes.error || offRes.error) {
      console.error('Error:', hoursRes.error || offRes.error);
      setError(formatUserError(hoursRes.error || offRes.error));
      setLoading(false);
      return;
    }
    setEntries(hoursRes.data || []);
    setTimeOff(offRes.data || []);
    setLoading(false);
  }, [fetchRange.start, fetchRange.end]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const agg = useMemo(() => {
    const inPeriod = (d) => d >= range.start && d <= range.end;
    const countHourStatus = (s) => s === 'approved' || (!approvedOnly && s === 'pending');
    const countOffStatus = (s) => s === 'approved' || (!approvedOnly && s === 'pending');

    const monthRange = { start: fmtLocalDate(startOfMonth(refDate)), end: fmtLocalDate(endOfMonth(refDate)) };
    const yearRange = {
      start: fmtLocalDate(new Date(refDate.getFullYear(), 0, 1)),
      end: fmtLocalDate(new Date(refDate.getFullYear(), 11, 31)),
    };

    const coaches = new Map();
    const ensure = (id, name) => {
      if (!coaches.has(id)) {
        coaches.set(id, {
          id, name: name || 'Unknown',
          approved: 0, pending: 0, workDates: new Set(),
          daysOff: 0, byType: {}, monthOff: 0, yearOff: 0,
        });
      }
      const c = coaches.get(id);
      if (name && c.name === 'Unknown') c.name = name;
      return c;
    };

    // --- chart buckets ---
    // Bucket width is derived from how long the selected range is, so a year
    // charts as 12 months, a month as its weeks, and a week as its days.
    const spanDays = dayDiff(parseISO(range.start), parseISO(range.end)) + 1;
    const unit = spanDays <= 14 ? 'day' : spanDays <= 92 ? 'week' : 'month';
    const multiYear = parseISO(range.start).getFullYear() !== parseISO(range.end).getFullYear();
    const bucketKeyFor = (d) => {
      if (unit === 'day') return fmtLocalDate(d);
      if (unit === 'week') return fmtLocalDate(startOfWeek(d));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const labelFor = (key) => {
      if (unit === 'month') {
        const [y, m] = key.split('-').map(Number);
        return multiYear ? `${MONTH_SHORT[m - 1]} '${String(y).slice(2)}` : MONTH_SHORT[m - 1];
      }
      const d = parseISO(key);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    };

    // Walk every day in the range once so empty buckets still get a slot on the
    // axis (a week with no hours should read as a gap, not vanish).
    const bucketIndex = new Map();
    const buckets = [];
    for (let d = parseISO(range.start), last = parseISO(range.end); d <= last; d = addDays(d, 1)) {
      const key = bucketKeyFor(d);
      if (!bucketIndex.has(key)) {
        bucketIndex.set(key, buckets.length);
        buckets.push({ key, label: labelFor(key), approved: 0, pending: 0 });
      }
    }

    for (const e of entries) {
      if (e.status === 'rejected') continue; // never counted, in any mode
      const hrs = entryHours(e);
      if (hrs <= 0) continue;
      if (inPeriod(e.work_date)) {
        const c = ensure(e.user_id, e.coach?.full_name);
        if (e.status === 'approved') c.approved += hrs;
        else if (e.status === 'pending') c.pending += hrs;
        if (countHourStatus(e.status)) c.workDates.add(e.work_date);

        const bi = bucketIndex.get(bucketKeyFor(parseISO(e.work_date)));
        if (bi != null) {
          if (e.status === 'approved') buckets[bi].approved += hrs;
          else if (e.status === 'pending') buckets[bi].pending += hrs;
        }
      }
    }

    for (const r of timeOff) {
      if (r.status === 'rejected' || r.status === 'cancelled') continue;
      if (!countOffStatus(r.status)) continue;
      const inP = daysInRange(r.start_date, r.end_date, range.start, range.end);
      const inM = daysInRange(r.start_date, r.end_date, monthRange.start, monthRange.end);
      const inY = daysInRange(r.start_date, r.end_date, yearRange.start, yearRange.end);
      if (!inP && !inM && !inY) continue;
      const c = ensure(r.user_id, r.coach?.full_name);
      c.daysOff += inP;
      c.monthOff += inM;
      c.yearOff += inY;
      if (inP) {
        const t = r.type || 'other';
        c.byType[t] = (c.byType[t] || 0) + inP;
      }
    }

    // A coach who has left has no rows at all and is simply absent from the
    // map, so they never show up as a row of zeros. But a coach who DID submit
    // is kept even when "Approved only" zeroes out their counted hours —
    // otherwise someone with nothing but unreviewed hours would silently
    // disappear and read as "didn't work", when really they're awaiting review.
    const rows = [];
    for (const c of coaches.values()) {
      const hours = approvedOnly ? c.approved : c.approved + c.pending;
      const daysWorked = c.workDates.size;
      // QA 2026-08-15 (BUG 1): this used to also accept c.monthOff / c.yearOff,
      // which are roll-ups over the whole calendar month/year and say nothing
      // about the SELECTED range — so a coach whose only time off was in
      // February was listed as an all-zero row in an August day view, and the
      // "No hours submitted in this period" empty state never appeared. Row
      // inclusion is now purely in-range activity. c.approved / c.pending are
      // only ever added to for entries where inPeriod(work_date), and c.daysOff
      // is already clipped to the range by daysInRange(), so all three terms are
      // range-scoped. Note `c.pending > 0` is deliberate and must stay: under
      // "Approved only" a coach with nothing but unreviewed hours still gets a
      // row (0.00 counted, hours visible in the Pending column) so they read as
      // "awaiting review" rather than "didn't work".
      const hasActivityInRange = c.approved > 0 || c.pending > 0 || c.daysOff > 0;
      if (!hasActivityInRange) continue;
      rows.push({
        ...c,
        hours,
        daysWorked,
        avgPerDay: daysWorked > 0 ? hours / daysWorked : 0,
      });
    }

    const totalHours = rows.reduce((s, r) => s + r.hours, 0);
    for (const r of rows) r.share = totalHours > 0 ? (r.hours / totalHours) * 100 : 0;

    const totals = {
      approved: rows.reduce((s, r) => s + r.approved, 0),
      pending: rows.reduce((s, r) => s + r.pending, 0),
      hours: totalHours,
      daysWorked: rows.reduce((s, r) => s + r.daysWorked, 0),
      daysOff: rows.reduce((s, r) => s + r.daysOff, 0),
      monthOff: rows.reduce((s, r) => s + r.monthOff, 0),
      yearOff: rows.reduce((s, r) => s + r.yearOff, 0),
    };

    const typesPresent = TYPE_ORDER.filter((t) => rows.some((r) => r.byType[t]))
      .concat(
        Array.from(new Set(rows.flatMap((r) => Object.keys(r.byType)))).filter((t) => !TYPE_ORDER.includes(t))
      );

    return { rows, totals, buckets, unit, typesPresent, monthRange, yearRange };
  }, [entries, timeOff, range, approvedOnly, refDate]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...agg.rows].sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
      return dir * ((a[sortKey] || 0) - (b[sortKey] || 0));
    });
  }, [agg.rows, sortKey, sortDir]);

  // QA 2026-08-15 (BUG 3): the TOTAL row's share used to be the literal string
  // "100.0%" (and "100.0" in the CSV), which printed even on an all-zero table.
  // Derive it from the per-coach shares so it can only ever say 100.0% when the
  // rows actually add up to that, and show nothing meaningful when there are no
  // hours to take a share of.
  const totalShare = useMemo(
    () => (agg.totals.hours > 0 ? sortedRows.reduce((s, r) => s + r.share, 0) : 0),
    [agg.totals.hours, sortedRows]
  );

  // QA 2026-08-15 (BUG 2): on a Year view `refDate` is 1 January by definition,
  // so the "<month> <year> total" time-off column was permanently labelled
  // "Jan" and read 0 next to a non-zero year total. A single calendar month is
  // meaningless next to a full-year period, so the column is hidden entirely on
  // the Year view (in the table and in the CSV); every other granularity keeps
  // the month containing the start of the period, which is what it always meant.
  const showMonthOff = granularity !== 'year';

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Coach', 'Approved hours', 'Pending hours', 'Counted hours', 'Days worked',
      'Avg hours/day', 'Days off (period)', ...agg.typesPresent.map((t) => `Days off – ${TYPE_LABEL[t] || t}`),
      ...(showMonthOff ? [`Days off (${MONTH_SHORT[refDate.getMonth()]} ${refDate.getFullYear()})`] : []),
      `Days off (${refDate.getFullYear()})`, 'Share of hours %',
    ];
    const lines = [
      [`NBP hours & time off — ${periodLabel(granularity, anchor, range)}`],
      [`${range.start} to ${range.end} · ${approvedOnly ? 'Approved only' : 'All submitted (approved + pending)'}`],
      [],
      header,
      ...sortedRows.map((r) => [
        // QA 2026-08-15: the export must say exactly what the screen says. Both
        // of these cells render an em dash when there is nothing to average and
        // no share to take, so write that rather than a fake 0.00 / blank.
        r.name, fmtHours(r.approved), fmtHours(r.pending), fmtHours(r.hours), r.daysWorked,
        r.daysWorked ? fmtHours(r.avgPerDay) : '—', r.daysOff, ...agg.typesPresent.map((t) => r.byType[t] || 0),
        ...(showMonthOff ? [r.monthOff] : []), r.yearOff, agg.totals.hours > 0 ? r.share.toFixed(1) : '—',
      ]),
      ['TOTAL', fmtHours(agg.totals.approved), fmtHours(agg.totals.pending), fmtHours(agg.totals.hours),
        agg.totals.daysWorked, '—', agg.totals.daysOff, ...agg.typesPresent.map((t) => sortedRows.reduce((s, r) => s + (r.byType[t] || 0), 0)),
        ...(showMonthOff ? [agg.totals.monthOff] : []), agg.totals.yearOff,
        agg.totals.hours > 0 ? totalShare.toFixed(1) : '—'],
    ];
    const csv = lines.map((row) => row.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nbp-hours-${range.start}_to_${range.end}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const SortHeader = ({ label, sortKey: k, className = '' }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-indigo-600 whitespace-nowrap ${className}`}
      title="Click to sort"
    >
      {label}
      <span className="text-gray-400 ml-1">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
    </th>
  );

  return (
    // QA 2026-08-15 (BUG 4): `w-full min-w-0` on the root. Without min-w-0 this
    // screen is a flex item whose automatic minimum size is its content, so the
    // 640px chart and the wide coach table stretched the whole page (390px
    // viewport measured 854px of horizontal scroll) instead of being clipped by
    // the `overflow-x-auto` wrappers below. Constraining the root makes those
    // wrappers scroll internally again. No effect on desktop, where the root
    // already fills its container.
    <div className="space-y-4 w-full min-w-0">
      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {GRANULARITIES.map((g) => (
            <button
              key={g.id}
              onClick={() => setGranularity(g.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0 ${
                granularity === g.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {granularity === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-gray-500 text-sm">to</span>
              <input
                type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAnchor(shiftAnchor(granularity, anchor, -1))}
                className="p-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                aria-label="Previous period"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-gray-900 min-w-0">{periodLabel(granularity, anchor, range)}</span>
              <button
                onClick={() => setAnchor(shiftAnchor(granularity, anchor, 1))}
                className="p-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                aria-label="Next period"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => setAnchor(new Date())}
                className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition text-xs font-medium"
              >
                Today
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
              <button
                onClick={() => setApprovedOnly(true)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition ${approvedOnly ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600'}`}
              >
                Approved only
              </button>
              <button
                onClick={() => setApprovedOnly(false)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition ${!approvedOnly ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600'}`}
              >
                All submitted
              </button>
            </div>
            <button
              onClick={exportCsv}
              disabled={loading || sortedRows.length === 0}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {!approvedOnly && (
          <p className="text-xs text-gray-500">
            Showing approved <span className="font-medium">and</span> pending hours. Pending hours have not been reviewed yet — don't pay from this view.
          </p>
        )}
      </div>

      {error ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button onClick={fetchAll} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition">
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : sortedRows.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <BarChart3 className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">No hours submitted in this period.</p>
          <p className="text-sm text-gray-400 mt-1">
            {approvedOnly ? 'Try "All submitted" to include hours that are still awaiting review.' : 'Pick a different period with the arrows above.'}
          </p>
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: approvedOnly ? 'Approved hours' : 'Total hours', value: fmtHours(agg.totals.hours) },
              { label: 'Awaiting review', value: fmtHours(agg.totals.pending) },
              // QA 2026-08-15: this counted `r.hours > 0`, i.e. COUNTED hours,
              // so under "Approved only" a coach whose hours were all pending
              // was listed in the table below yet excluded here — the tile read
              // "0" over a table of coaches. Count anyone who submitted hours in
              // the period in either status; they worked, the hours just haven't
              // been reviewed. Coaches with only time off are still not counted
              // as working, which is why this is not simply sortedRows.length.
              { label: 'Coaches working', value: sortedRows.filter((r) => r.approved > 0 || r.pending > 0).length },
              { label: 'Days off in period', value: agg.totals.daysOff },
            ].map((t) => (
              <div key={t.label} className="bg-white rounded-lg shadow p-4 border border-gray-200">
                <p className="text-xs text-gray-600">{t.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">{t.value}</p>
              </div>
            ))}
          </div>

          {/* Trend chart */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
                <BarChart3 size={18} className="text-indigo-600" />
                <span>Hours per {agg.unit}</span>
              </h3>
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_APPROVED }} /> Approved
                </span>
                {!approvedOnly && (
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_PENDING }} /> Pending
                  </span>
                )}
              </div>
            </div>
            {/* Horizontal scroll keeps the axis labels at a readable size on a
                375px phone instead of shrinking them with the viewBox.
                QA 2026-08-15 (BUG 4): max-w-full so the 640px inner track can
                never widen this wrapper — it scrolls inside the card instead of
                panning the page. */}
            <div className="overflow-x-auto max-w-full">
              <div className="min-w-[640px]">
                <HoursBarChart
                  buckets={agg.buckets}
                  showPending={!approvedOnly}
                  hovered={hovered}
                  setHovered={setHovered}
                />
              </div>
            </div>
          </div>

          {/* Per-coach table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center space-x-2">
              <Clock size={18} className="text-indigo-600" />
              <h3 className="font-semibold text-gray-900">Hours by coach</h3>
              <span className="text-sm text-gray-500">· {periodLabel(granularity, anchor, range)}</span>
            </div>
            {/* QA 2026-08-15 (BUG 4): max-w-full — the 8 nowrap columns are
                wider than a phone and were widening the page rather than
                scrolling here. */}
            <div className="overflow-x-auto max-w-full">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-700 text-left">
                  <tr>
                    <SortHeader label="Coach" sortKey="name" />
                    <SortHeader label="Approved" sortKey="approved" className="text-right" />
                    <SortHeader label="Pending" sortKey="pending" className="text-right" />
                    <SortHeader label="Counted hrs" sortKey="hours" className="text-right" />
                    <SortHeader label="Days worked" sortKey="daysWorked" className="text-right" />
                    <SortHeader label="Avg hrs/day" sortKey="avgPerDay" className="text-right" />
                    <SortHeader label="Days off" sortKey="daysOff" className="text-right" />
                    <SortHeader label="Share" sortKey="share" className="text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedRows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{fmtHours(r.approved)}</td>
                      <td className={`px-3 py-2 text-right ${r.pending > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>{fmtHours(r.pending)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-700">{fmtHours(r.hours)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.daysWorked}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.daysWorked ? fmtHours(r.avgPerDay) : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.daysOff}</td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden md:block">
                            <div className="h-full rounded-full" style={{ width: `${r.share}%`, background: COLOR_APPROVED }} />
                          </div>
                          <span>{r.share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold text-gray-900 border-t-2 border-gray-200">
                  <tr>
                    <td className="px-3 py-2">TOTAL</td>
                    <td className="px-3 py-2 text-right">{fmtHours(agg.totals.approved)}</td>
                    <td className="px-3 py-2 text-right">{fmtHours(agg.totals.pending)}</td>
                    <td className="px-3 py-2 text-right text-indigo-700">{fmtHours(agg.totals.hours)}</td>
                    <td className="px-3 py-2 text-right">{agg.totals.daysWorked}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">{agg.totals.daysOff}</td>
                    {/* QA 2026-08-15 (BUG 3): derived, not a hardcoded "100.0%" */}
                    <td className="px-3 py-2 text-right">{agg.totals.hours > 0 ? `${totalShare.toFixed(1)}%` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Time off */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center space-x-2">
              <Plane size={18} className="text-indigo-600" />
              <h3 className="font-semibold text-gray-900">Time off by coach</h3>
              <span className="text-sm text-gray-500">
                · days counted inside {range.start} – {range.end}
              </span>
            </div>
            {agg.totals.daysOff === 0 && agg.totals.yearOff === 0 ? (
              <p className="p-8 text-center text-gray-500">No time off recorded in this period.</p>
            ) : (
              // QA 2026-08-15 (BUG 4): max-w-full, same reason as the table above.
              <div className="overflow-x-auto max-w-full">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Coach</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Days off (period)</th>
                      {agg.typesPresent.map((t) => (
                        <th key={t} className="px-3 py-2 font-medium text-right whitespace-nowrap">{TYPE_LABEL[t] || t}</th>
                      ))}
                      {showMonthOff && (
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                          {MONTH_SHORT[refDate.getMonth()]} {refDate.getFullYear()} total
                        </th>
                      )}
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">{refDate.getFullYear()} total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedRows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                        <td className="px-3 py-2 text-right text-gray-900">{r.daysOff}</td>
                        {agg.typesPresent.map((t) => (
                          <td key={t} className={`px-3 py-2 text-right ${r.byType[t] ? 'text-gray-900' : 'text-gray-300'}`}>{r.byType[t] || 0}</td>
                        ))}
                        {showMonthOff && <td className="px-3 py-2 text-right text-gray-700">{r.monthOff}</td>}
                        <td className="px-3 py-2 text-right text-gray-700">{r.yearOff}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-gray-900 border-t-2 border-gray-200">
                    <tr>
                      <td className="px-3 py-2">TOTAL</td>
                      <td className="px-3 py-2 text-right">{agg.totals.daysOff}</td>
                      {agg.typesPresent.map((t) => (
                        <td key={t} className="px-3 py-2 text-right">{sortedRows.reduce((s, r) => s + (r.byType[t] || 0), 0)}</td>
                      ))}
                      {showMonthOff && <td className="px-3 py-2 text-right">{agg.totals.monthOff}</td>}
                      <td className="px-3 py-2 text-right">{agg.totals.yearOff}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 px-1">
            Rejected hour entries and rejected/cancelled time off are never counted. Week starts Sunday, matching the
            schedule. Days off count every calendar day in a request that falls inside the period, so a request that
            straddles the edge only contributes its in-period days.
          </p>
        </>
      )}
    </div>
  );
}

// Hand-rolled inline SVG bar chart — the app has no charting dependency and we
// are not adding one. Stacked: approved on the bottom, pending lighter on top.
function HoursBarChart({ buckets, showPending, hovered, setHovered }) {
  const W = 720, H = 280;
  const padL = 48, padR = 12, padT = 16, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxVal = Math.max(
    ...buckets.map((b) => (showPending ? b.approved + b.pending : b.approved)),
    0
  );
  const niceMax = (() => {
    if (maxVal <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(maxVal)));
    const f = maxVal / exp;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * exp;
  })();

  const n = buckets.length || 1;
  const band = plotW / n;
  const barW = Math.min(band * 0.62, 46);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;
  // Keep the axis from turning into a solid smear of text on long ranges.
  const labelStep = n > 24 ? Math.ceil(n / 12) : 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => niceMax * f);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 280 }} role="img" aria-label="Hours per period">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">
            {t >= 100 ? Math.round(t) : Math.round(t * 10) / 10}
          </text>
        </g>
      ))}
      <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#9ca3af" strokeWidth="1" />

      {buckets.map((b, i) => {
        const cx = padL + band * i + band / 2;
        const x = cx - barW / 2;
        const aH = (b.approved / niceMax) * plotH;
        const pH = showPending ? (b.pending / niceMax) * plotH : 0;
        const total = b.approved + (showPending ? b.pending : 0);
        return (
          <g key={b.key}>
            {pH > 0 && (
              <rect x={x} y={y(b.approved + b.pending)} width={barW} height={pH} fill={COLOR_PENDING} rx="2" />
            )}
            {aH > 0 && <rect x={x} y={y(b.approved)} width={barW} height={aH} fill={COLOR_APPROVED} rx="2" />}
            {/* Invisible full-height hit area so hovering anywhere in the
                column works, including on an empty bucket. */}
            <rect
              x={padL + band * i} y={padT} width={band} height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>{`${b.label}: ${fmtHours(total)} hrs`}</title>
            </rect>
            {i % labelStep === 0 && (
              <text x={cx} y={H - padB + 18} textAnchor="middle" fontSize="11" fill="#6b7280">{b.label}</text>
            )}
          </g>
        );
      })}

      {hovered != null && buckets[hovered] && (() => {
        const b = buckets[hovered];
        const total = b.approved + (showPending ? b.pending : 0);
        const lines = showPending
          ? [`${b.label}`, `Approved ${fmtHours(b.approved)} hrs`, `Pending ${fmtHours(b.pending)} hrs`]
          : [`${b.label}`, `Approved ${fmtHours(b.approved)} hrs`];
        const boxW = 148, boxH = 18 * lines.length + 12;
        let bx = padL + band * hovered + band / 2 - boxW / 2;
        bx = Math.max(padL, Math.min(bx, W - padR - boxW)); // clamp inside plot
        const by = Math.max(padT, y(total) - boxH - 8);
        return (
          <g pointerEvents="none">
            <rect x={bx} y={by} width={boxW} height={boxH} rx="6" fill="#111827" opacity="0.92" />
            {lines.map((ln, li) => (
              <text key={li} x={bx + 10} y={by + 18 + li * 18} fontSize="12" fill="#ffffff" fontWeight={li === 0 ? 600 : 400}>
                {ln}
              </text>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}
