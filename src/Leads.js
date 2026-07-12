// Leads tab (#229 follow-up). Staff-facing list of role='public' users — the
// outside customers who signed up through the /book page. Doubles as a simple
// CRM: each lead has a pipeline status (new → contacted → converted / lost) and
// a count of how many sessions they've booked.

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { UserPlus, Search, Mail, Phone, Loader2, RefreshCw } from 'lucide-react';

const LEAD_STATUSES = ['new', 'contacted', 'converted', 'lost'];
const STATUS_CLS = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  contacted: 'bg-amber-100 text-amber-700 border-amber-200',
  converted: 'bg-green-100 text-green-700 border-green-200',
  lost: 'bg-gray-100 text-gray-600 border-gray-200',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export default function Leads() {
  const [leads, setLeads] = useState(null);
  const [bookingCounts, setBookingCounts] = useState({}); // lowercase email -> count
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    setError('');
    const { data, error: err } = await supabase
      .from('users')
      .select('id, full_name, email, phone, lead_status, created_at')
      .eq('role', 'public')
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); setLeads([]); return; }
    setLeads(data || []);

    // Booking counts per lead, matched by email. Staff can read all bookings.
    const { data: bookings } = await supabase.from('public_bookings').select('guest_email');
    const counts = {};
    (bookings || []).forEach((b) => {
      const key = (b.guest_email || '').trim().toLowerCase();
      if (key) counts[key] = (counts[key] || 0) + 1;
    });
    setBookingCounts(counts);
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id, lead_status) => {
    setSavingId(id);
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, lead_status } : l)));
    const { error: err } = await supabase.from('users').update({ lead_status }).eq('id', id);
    if (err) { setError(err.message); await load(); }
    setSavingId(null);
  };

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== 'all' && (l.lead_status || 'new') !== statusFilter) return false;
      if (!q) return true;
      return (l.full_name || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q) || (l.phone || '').toLowerCase().includes(q);
    });
  }, [leads, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: leads?.length || 0, new: 0, contacted: 0, converted: 0, lost: 0 };
    (leads || []).forEach((l) => { c[l.lead_status || 'new'] = (c[l.lead_status || 'new'] || 0) + 1; });
    return c;
  }, [leads]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <UserPlus size={24} className="text-teal-600" /> Leads
        </h1>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <p className="text-gray-500 text-sm mb-5">Outside customers who signed up through the public booking page.</p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm mb-4">{error}</div>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['all', ...LEAD_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition ${
                statusFilter === s ? 'bg-teal-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {s} <span className="opacity-70">({counts[s] || 0})</span>
            </button>
          ))}
        </div>
      </div>

      {leads === null ? (
        <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 size={20} className="animate-spin mr-2" /> Loading leads…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <UserPlus size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm">{leads.length === 0 ? 'No leads yet. They appear here once someone signs up on the booking page.' : 'No leads match your filters.'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Signed up</th>
                <th className="px-4 py-3 font-medium text-center">Bookings</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const bookings = bookingCounts[(l.email || '').trim().toLowerCase()] || 0;
                return (
                  <tr key={l.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{l.full_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="flex flex-col gap-0.5">
                        {l.email && <a href={`mailto:${l.email}`} className="flex items-center gap-1.5 text-teal-700 hover:underline"><Mail size={13} /> {l.email}</a>}
                        {l.phone && <a href={`tel:${l.phone}`} className="flex items-center gap-1.5 text-gray-500"><Phone size={13} /> {l.phone}</a>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block min-w-[24px] px-2 py-0.5 rounded-full text-xs font-semibold ${bookings > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{bookings}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={l.lead_status || 'new'}
                          onChange={(e) => updateStatus(l.id, e.target.value)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize border focus:outline-none focus:ring-2 focus:ring-teal-500 ${STATUS_CLS[l.lead_status || 'new']}`}
                        >
                          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {savingId === l.id && <Loader2 size={14} className="animate-spin text-gray-400" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
