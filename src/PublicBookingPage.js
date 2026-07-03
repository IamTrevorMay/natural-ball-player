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
import { Calendar as CalendarIcon, Clock, MapPin, User, Dumbbell, CheckCircle, ArrowLeft, Loader2 } from 'lucide-react';

const fnUrl = (name) => `${supabaseUrl}/functions/v1/${name}`;
const fnHeaders = {
  'Content-Type': 'application/json',
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
};

const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

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

export default function PublicBookingPage() {
  const params = new URLSearchParams(window.location.search);
  const returnedBooking = params.get('booking');

  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all'); // all | resource | coach_session
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
        body: JSON.stringify({ days: 45 }),
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

  const visible = slots.filter((s) => filter === 'all' || s.kind === filter);
  // Group by date for a clean listing.
  const byDate = {};
  visible.forEach((s) => { (byDate[s.occurrence_date] = byDate[s.occurrence_date] || []).push(s); });
  const dates = Object.keys(byDate).sort();

  return (
    <Shell>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Book Facility Time</h1>
        <p className="text-gray-600 mb-6">Reserve a resource or a session with one of our coaches.</p>

        <div className="flex space-x-2 mb-6">
          {[
            { key: 'all', label: 'All' },
            { key: 'resource', label: 'Facility' },
            { key: 'coach_session', label: 'Coaching' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === t.key ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading availability…
          </div>
        ) : loadError ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
            {loadError}
            <button onClick={loadAvailability} className="ml-3 underline">Retry</button>
          </div>
        ) : dates.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <CalendarIcon size={40} className="mx-auto mb-3 text-gray-300" />
            No open times right now. Please check back soon.
          </div>
        ) : (
          <div className="space-y-6">
            {dates.map((date) => (
              <div key={date}>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{dateDisplay(date)}</h2>
                <div className="space-y-2">
                  {byDate[date].map((s) => (
                    <button
                      key={s.key}
                      onClick={() => { setSelected(s); setSubmitError(''); }}
                      className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-lg p-4 hover:border-teal-400 hover:shadow-sm transition text-left"
                    >
                      <div className="flex items-start space-x-3 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.kind === 'coach_session' ? 'bg-indigo-50 text-indigo-600' : 'bg-teal-50 text-teal-600'}`}>
                          {s.kind === 'coach_session' ? <Dumbbell size={18} /> : <MapPin size={18} />}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate">{s.title}</div>
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
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Booking form modal */}
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <button onClick={() => setSelected(null)} className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
                <ArrowLeft size={16} className="mr-1" /> Back
              </button>
              <h3 className="text-xl font-bold text-gray-900">{selected.title}</h3>
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

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center space-x-2">
          <span className="text-2xl">⚾</span>
          <span className="font-bold text-gray-900">Natural Ball Player</span>
        </div>
      </header>
      <main className="px-4 py-8">{children}</main>
    </div>
  );
}
