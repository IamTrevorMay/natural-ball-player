// Public, no-login facility booking page (#229). Reachable at /book by anyone
// (rendered in App.js before the auth gate). Outside customers browse the
// facility resources and coach sessions that staff have marked "public" +
// priced, then book & pay via Square. A paid booking shows on the staff
// Schedule calendar and can be canceled/refunded there.
//
// This page never authenticates. It talks only to the public edge functions
// (public-availability, public-book-checkout), which do all writes server-side.

import React, { useState, useEffect } from 'react';
import { supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { Calendar as CalendarIcon, Clock, MapPin, User, Dumbbell, CheckCircle, ArrowLeft, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const fnUrl = (name) => `${supabaseUrl}/functions/v1/${name}`;
const fnHeaders = {
  'Content-Type': 'application/json',
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
};

const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

// Prefix the event title with its booking Type when one is set (facility events
// carry booking_type; coach sessions don't).
const eventLabel = (s) => (s && s.booking_type ? `${s.booking_type} — ${s.title}` : (s ? s.title : ''));

const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const timeDisplay = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
};

const dateDisplay = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

const MONTH_LABEL = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Saturated bar backgrounds keyed by the event's color (facility_events.color /
// the booking Type color). Used for the month-grid event bars.
const TYPE_BAR = {
  teal: 'bg-teal-600', blue: 'bg-blue-700', purple: 'bg-purple-700', pink: 'bg-pink-600',
  red: 'bg-red-700', orange: 'bg-orange-600', yellow: 'bg-yellow-600', green: 'bg-green-600', gray: 'bg-gray-700',
};
const barColor = (c) => TYPE_BAR[c] || TYPE_BAR.teal;

// Compact time like "11a", "4:45p".
const shortTime = (t) => {
  if (!t) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
};

const MONTH_MAX_PER_DAY = 7; // events shown per day before "View More"

// Weeks (arrays of Date) covering the calendar month of `anchor`, padded to
// full Sun–Sat weeks.
function buildMonthGrid(anchor) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const cur = new Date(year, month, 1 - first.getDay()); // back up to Sunday
  const weeks = [];
  while (cur <= last || cur.getDay() !== 0) {
    const week = [];
    for (let i = 0; i < 7; i++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    weeks.push(week);
    if (weeks.length > 6) break;
  }
  return weeks;
}

function buildWeekDays(anchor) {
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}

export default function PublicBookingPage() {
  const params = new URLSearchParams(window.location.search);
  const returnedBooking = params.get('booking');
  const todayStr = fmtLocal(new Date());

  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all'); // all | resource | coach_session
  const [view, setView] = useState('month'); // month | week | today | list
  const [viewDate, setViewDate] = useState(() => new Date()); // month/week anchor
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [dayModal, setDayModal] = useState(null); // date string when a day's overflow is expanded
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const loadAvailability = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(fnUrl('public-availability'), {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({ days: 120 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load availability');
      setSlots(data.slots || []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!returnedBooking) loadAvailability();
    else setLoading(false);
  }, [returnedBooking]);

  const handleBook = async () => {
    if (!form.name.trim()) return setSubmitError('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setSubmitError('Please enter a valid email.');
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(fnUrl('public-book-checkout'), {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({
          source_type: selected.source_type,
          source_id: selected.source_id,
          occurrence_date: selected.occurrence_date,
          guest_name: form.name,
          guest_email: form.email,
          guest_phone: form.phone,
          notes: form.notes,
          return_url: window.location.origin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not start checkout');
      window.location.href = data.checkout_url;
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  };

  // --- Post-payment confirmation --------------------------------------------
  if (returnedBooking) {
    return (
      <Shell>
        <div className="max-w-md mx-auto text-center py-16">
          <CheckCircle size={56} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Thank you!</h1>
          <p className="text-gray-600 mb-6">
            If your payment went through, your booking is confirmed and our staff can see it.
            A receipt has been emailed to you by Square.
          </p>
          <a href="/book" className="inline-block px-5 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-medium">
            Book another time
          </a>
        </div>
      </Shell>
    );
  }

  const openBooking = (s) => { setSelected(s); setSubmitError(''); };

  const visible = slots.filter((s) => filter === 'all' || s.kind === filter);
  // Group by date.
  const byDate = {};
  visible.forEach((s) => { (byDate[s.occurrence_date] = byDate[s.occurrence_date] || []).push(s); });
  const allDates = Object.keys(byDate).sort();

  // Month/week navigation.
  const shiftMonth = (delta) => {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
    setViewDate(d);
    // Keep the selected day sensible: today if we're on the current month, else the 1st.
    setSelectedDate(todayStr.slice(0, 7) === fmtLocal(d).slice(0, 7) ? todayStr : fmtLocal(d));
  };
  const shiftWeek = (delta) => {
    const d = new Date(viewDate);
    d.setDate(d.getDate() + delta * 7);
    setViewDate(d);
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading availability…
        </div>
      );
    }
    if (loadError) {
      return (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
          {loadError}
          <button onClick={loadAvailability} className="ml-3 underline">Retry</button>
        </div>
      );
    }

    if (view === 'list') {
      if (allDates.length === 0) return <EmptyState />;
      return (
        <div className="space-y-6">
          {allDates.map((date) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{dateDisplay(date)}</h2>
              <div className="space-y-2">
                {byDate[date].map((s) => <SlotCard key={s.key} s={s} onClick={() => openBooking(s)} />)}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (view === 'today') {
      const daySlots = byDate[todayStr] || [];
      return (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{dateDisplay(todayStr)}</h2>
          {daySlots.length === 0
            ? <EmptyState label="No open times today. Try Week or Month." />
            : <div className="space-y-2">{daySlots.map((s) => <SlotCard key={s.key} s={s} onClick={() => openBooking(s)} />)}</div>}
        </div>
      );
    }

    if (view === 'week') {
      const days = buildWeekDays(viewDate);
      const rangeLabel = `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      return (
        <div>
          <CalNav label={rangeLabel} onPrev={() => shiftWeek(-1)} onNext={() => shiftWeek(1)} />
          <div className="grid grid-cols-7 gap-1.5 mb-5">
            {days.map((d) => {
              const ds = fmtLocal(d);
              const count = (byDate[ds] || []).length;
              return <DayPill key={ds} d={d} ds={ds} count={count} selected={ds === selectedDate} isToday={ds === todayStr} onSelect={() => setSelectedDate(ds)} />;
            })}
          </div>
          <DayPanel date={selectedDate} daySlots={byDate[selectedDate] || []} onOpen={openBooking} />
        </div>
      );
    }

    // Month (default) — full grid with each day's events listed as colored bars.
    const weeks = buildMonthGrid(viewDate);
    const curMonth = viewDate.getMonth();
    return (
      <div>
        <CalNav label={MONTH_LABEL(viewDate)} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} />
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-500 border-b border-gray-200">
          {DOW.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 border-l border-t border-gray-200">
          {weeks.flat().map((d) => {
            const ds = fmtLocal(d);
            const items = byDate[ds] || [];
            const inMonth = d.getMonth() === curMonth;
            return (
              <div key={ds} className={`border-r border-b border-gray-200 min-h-[128px] p-1 align-top ${!inMonth ? 'bg-gray-50' : ds === todayStr ? 'bg-amber-50' : 'bg-white'}`}>
                <div className={`text-right text-sm px-1 mb-0.5 ${inMonth ? 'text-gray-500' : 'text-gray-300'} ${ds === todayStr ? 'font-bold text-amber-700' : ''}`}>{d.getDate()}</div>
                <div className="space-y-0.5">
                  {items.slice(0, MONTH_MAX_PER_DAY).map((s) => <EventBar key={s.key} s={s} onClick={() => openBooking(s)} />)}
                  {items.length > MONTH_MAX_PER_DAY && (
                    <button onClick={() => setDayModal(ds)} className="w-full text-center text-[11px] text-gray-500 hover:text-gray-800 py-0.5">
                      View More
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Shell wide={view === 'month'}>
      <div className={`${view === 'month' ? 'max-w-7xl' : 'max-w-3xl'} mx-auto`}>
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Book Facility Time</h1>
        <p className="text-gray-600 mb-5">Reserve a resource or a session with one of our coaches.</p>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          {/* View switcher */}
          <div className="inline-flex bg-gray-200 rounded-lg p-0.5">
            {[
              { key: 'list', label: 'List' },
              { key: 'today', label: 'Today' },
              { key: 'week', label: 'Week' },
              { key: 'month', label: 'Month' },
            ].map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition ${
                  view === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* Kind filter */}
          <div className="flex space-x-1.5">
            {[
              { key: 'all', label: 'All' },
              { key: 'resource', label: 'Facility' },
              { key: 'coach_session', label: 'Coaching' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  filter === t.key ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {renderBody()}
      </div>

      {/* Day overflow modal (from month "View More") */}
      {dayModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40 p-4" onClick={() => setDayModal(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">{dateDisplay(dayModal)}</h3>
                <button onClick={() => setDayModal(null)} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={18} /></button>
              </div>
              <div className="space-y-2">
                {(byDate[dayModal] || []).map((s) => (
                  <SlotCard key={s.key} s={s} onClick={() => { setDayModal(null); openBooking(s); }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Booking form modal */}
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <button onClick={() => setSelected(null)} className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
                <ArrowLeft size={16} className="mr-1" /> Back
              </button>
              <h3 className="text-xl font-bold text-gray-900">{eventLabel(selected)}</h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 mt-1 mb-1">
                <span className="flex items-center"><CalendarIcon size={14} className="mr-1" />{dateDisplay(selected.occurrence_date)}</span>
                {selected.start_time && <span className="flex items-center"><Clock size={14} className="mr-1" />{timeDisplay(selected.start_time)}{selected.end_time ? `–${timeDisplay(selected.end_time)}` : ''}</span>}
                {selected.coach_name && <span className="flex items-center"><User size={14} className="mr-1" />{selected.coach_name}</span>}
              </div>
              <div className="text-lg font-bold text-gray-900 mb-4">{money(selected.price_cents)}</div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows="2" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>

              {submitError && <p className="text-sm text-red-600 mt-3">{submitError}</p>}

              <button onClick={handleBook} disabled={submitting} className="mt-5 w-full bg-teal-600 text-white py-2.5 rounded-lg hover:bg-teal-700 transition font-medium disabled:opacity-50 flex items-center justify-center">
                {submitting ? <><Loader2 size={18} className="animate-spin mr-2" /> Redirecting to payment…</> : `Continue to payment · ${money(selected.price_cents)}`}
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">You'll pay securely via Square. No account needed.</p>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function SlotCard({ s, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:border-teal-400 hover:shadow-sm transition text-left"
    >
      <div className="flex items-start space-x-3 min-w-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.kind === 'coach_session' ? 'bg-indigo-50 text-indigo-600' : 'bg-teal-50 text-teal-600'}`}>
          {s.kind === 'coach_session' ? <Dumbbell size={18} /> : <MapPin size={18} />}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 truncate">{eventLabel(s)}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-0.5">
            {s.start_time && <span className="flex items-center"><Clock size={12} className="mr-1" />{timeDisplay(s.start_time)}{s.end_time ? `–${timeDisplay(s.end_time)}` : ''}</span>}
            {s.coach_name && <span className="flex items-center"><User size={12} className="mr-1" />{s.coach_name}</span>}
            {s.location && <span className="flex items-center"><MapPin size={12} className="mr-1" />{s.location}</span>}
            {s.remaining > 1 && <span>{s.remaining} spots left</span>}
          </div>
        </div>
      </div>
      <div className="text-right flex-shrink-0 ml-3">
        <div className="font-bold text-gray-900">{money(s.price_cents)}</div>
        <div className="text-xs text-teal-600 font-medium">Book →</div>
      </div>
    </button>
  );
}

// A colored event bar in the month grid: dark time chip + tinted title.
function EventBar({ s, onClick }) {
  return (
    <button
      onClick={onClick}
      title={`${eventLabel(s)} · ${timeDisplay(s.start_time)} · ${money(s.price_cents)}`}
      className={`flex w-full rounded overflow-hidden text-white text-[11px] leading-tight ${barColor(s.color)} hover:opacity-90 transition`}
    >
      <span className="px-1 py-0.5 bg-black/30 font-semibold whitespace-nowrap">{shortTime(s.start_time)}</span>
      <span className="px-1 py-0.5 flex-1 truncate text-left">{eventLabel(s)}</span>
    </button>
  );
}

// The list of slots for a single selected day (used by Week + Month views).
function DayPanel({ date, daySlots, onOpen }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{dateDisplay(date)}</h2>
      {daySlots.length === 0
        ? <p className="text-sm text-gray-400 italic py-4">No open times this day.</p>
        : <div className="space-y-2">{daySlots.map((s) => <SlotCard key={s.key} s={s} onClick={() => onOpen(s)} />)}</div>}
    </div>
  );
}

// A single day button in the Week strip.
function DayPill({ d, ds, count, selected, isToday, onSelect }) {
  return (
    <button
      onClick={() => count > 0 && onSelect()}
      disabled={count === 0}
      className={`rounded-lg py-2 flex flex-col items-center transition ${
        selected ? 'bg-teal-600 text-white'
          : count > 0 ? 'bg-teal-50 text-gray-900 hover:bg-teal-100 cursor-pointer'
          : 'bg-gray-50 text-gray-300 cursor-default'
      }`}
    >
      <span className="text-[10px] uppercase">{DOW[d.getDay()]}</span>
      <span className={`text-base font-semibold ${isToday && !selected ? 'text-teal-600' : ''}`}>{d.getDate()}</span>
      <span className={`text-[10px] leading-none ${selected ? 'text-teal-100' : count > 0 ? 'text-teal-600' : 'text-transparent'}`}>{count > 0 ? count : '·'}</span>
    </button>
  );
}

function CalNav({ label, onPrev, onNext }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <button onClick={onPrev} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"><ChevronLeft size={20} /></button>
      <span className="font-semibold text-gray-900">{label}</span>
      <button onClick={onNext} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"><ChevronRight size={20} /></button>
    </div>
  );
}

function EmptyState({ label = 'No open times right now. Please check back soon.' }) {
  return (
    <div className="text-center py-16 text-gray-500">
      <CalendarIcon size={40} className="mx-auto mb-3 text-gray-300" />
      {label}
    </div>
  );
}

function Shell({ children, wide }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200">
        <div className={`${wide ? 'max-w-7xl' : 'max-w-3xl'} mx-auto px-4 py-4 flex items-center space-x-2`}>
          <span className="text-2xl">⚾</span>
          <span className="font-bold text-gray-900">Natural Ball Player</span>
        </div>
      </header>
      <main className="px-4 py-8">{children}</main>
    </div>
  );
}
