// Booking-only mini portal for role='public' users (#229 follow-up). Outside
// customers who created an account get this stripped-down shell instead of the
// full player/staff portal: they can book & pay for sessions (reusing the same
// /book experience embedded) and see their own booking / payment history.
//
// Public users have no team, training, messages, or documents — MainApp routes
// them here and never renders the normal Sidebar/views.

import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import PublicBookingPage from './PublicBookingPage';
import { Calendar, ClipboardList, LogOut, Loader2, CheckCircle, Clock, XCircle, RotateCcw } from 'lucide-react';

const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const dateDisplay = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

const timeDisplay = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const STATUS_META = {
  confirmed: { label: 'Confirmed', cls: 'bg-green-100 text-green-700', Icon: CheckCircle },
  pending_payment: { label: 'Payment pending', cls: 'bg-amber-100 text-amber-700', Icon: Clock },
  canceled: { label: 'Canceled', cls: 'bg-gray-100 text-gray-600', Icon: XCircle },
  refunded: { label: 'Refunded', cls: 'bg-blue-100 text-blue-700', Icon: RotateCcw },
};

export default function PublicPortal({ userId, userName, onLogout }) {
  const [tab, setTab] = useState('book'); // book | bookings
  const [profile, setProfile] = useState(null); // { full_name, email, phone }

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('users').select('full_name, email, phone').eq('id', userId).maybeSingle();
      if (active) setProfile(data || null);
    };
    if (userId) load();
    return () => { active = false; };
  }, [userId]);

  const prefill = profile
    ? { name: profile.full_name || userName || '', email: profile.email || '', phone: profile.phone || '' }
    : null;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img src="/nbp-logo.png" alt="NBP" className="w-8 h-8 object-contain" />
            <span className="font-bold text-gray-900 hidden sm:inline">Natural Ball Player</span>
          </div>
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setTab('book')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                tab === 'book' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Calendar size={16} /> <span className="hidden sm:inline">Book a Session</span>
            </button>
            <button
              onClick={() => setTab('bookings')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                tab === 'bookings' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <ClipboardList size={16} /> <span className="hidden sm:inline">My Bookings</span>
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition"
            >
              <LogOut size={16} /> <span className="hidden sm:inline">Sign Out</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab === 'book' ? (
          <>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Hi{userName ? `, ${userName.split(' ')[0]}` : ''} 👋</h1>
            <p className="text-gray-600 mb-5 text-sm">Choose an open time below to book and pay for a session.</p>
            <PublicBookingPage embedded prefill={prefill} />
          </>
        ) : (
          <MyBookings email={profile?.email} />
        )}
      </main>
    </div>
  );
}

function MyBookings({ email }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      // RLS lets a public user read only their own bookings (guest_email = their
      // JWT email). We still filter by email so an empty email shows nothing.
      const { data, error: err } = await supabase
        .from('public_bookings')
        .select('id, occurrence_date, start_time, end_time, source_type, amount_cents, status, notes, created_at')
        .order('occurrence_date', { ascending: false });
      if (!active) return;
      if (err) setError(err.message);
      else setRows(data || []);
    };
    load();
    return () => { active = false; };
  }, [email]);

  if (rows === null && !error) {
    return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 size={20} className="animate-spin mr-2" /> Loading your bookings…</div>;
  }
  if (error) {
    return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>;
  }
  if (!rows.length) {
    return (
      <div className="text-center py-16 text-gray-500">
        <ClipboardList size={40} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm">You haven't booked any sessions yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">My Bookings</h1>
      <div className="space-y-2.5">
        {rows.map((b) => {
          const meta = STATUS_META[b.status] || { label: b.status, cls: 'bg-gray-100 text-gray-600', Icon: Clock };
          const Icon = meta.Icon;
          return (
            <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{dateDisplay(b.occurrence_date)}</p>
                <p className="text-sm text-gray-500">
                  {b.start_time ? timeDisplay(b.start_time) : ''}{b.end_time ? ` – ${timeDisplay(b.end_time)}` : ''}
                  {b.source_type === 'training_slot' ? ' · Coaching session' : ' · Facility'}
                </p>
                {b.notes && <p className="text-xs text-gray-400 mt-0.5 truncate">{b.notes}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-semibold text-gray-900">{money(b.amount_cents)}</p>
                <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
                  <Icon size={12} /> {meta.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
