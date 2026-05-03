import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Plus, X, Edit2, Trash2, Clock, Check, AlertCircle } from 'lucide-react';

const STATUS_BADGE = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

function computeHours(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '';
  return (mins / 60).toFixed(2);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function WorkMyHours({ userId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const [workDate, setWorkDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [hours, setHours] = useState('');
  const [hoursTouched, setHoursTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_hour_entries')
      .select('id, work_date, start_time, end_time, hours_decimal, notes, status, reviewed_at, review_notes, reviewer:reviewed_by(full_name)')
      .eq('user_id', userId)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) console.error('Error:', error);
    else setEntries(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    fetchEntries();
    const channel = supabase.channel('my-hours')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_hour_entries', filter: `user_id=eq.${userId}` }, () => fetchEntries())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchEntries]);

  useEffect(() => {
    if (hoursTouched) return;
    const auto = computeHours(startTime, endTime);
    if (auto) setHours(auto);
  }, [startTime, endTime, hoursTouched]);

  const resetForm = () => {
    setWorkDate(todayISO());
    setStartTime('');
    setEndTime('');
    setHours('');
    setHoursTouched(false);
    setNotes('');
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (e) => {
    setEditing(e);
    setWorkDate(e.work_date);
    setStartTime(e.start_time || '');
    setEndTime(e.end_time || '');
    setHours(String(e.hours_decimal));
    setHoursTouched(true);
    setNotes(e.notes || '');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!workDate) { alert('Date is required.'); return; }
    const h = parseFloat(hours);
    if (!h || h <= 0) { alert('Enter hours greater than 0.'); return; }
    if (h > 24) { alert('Hours cannot exceed 24.'); return; }

    setSaving(true);
    const payload = {
      work_date: workDate,
      start_time: startTime || null,
      end_time: endTime || null,
      hours_decimal: h,
      notes: notes.trim() || null,
    };
    if (editing) {
      const { error } = await supabase.from('staff_hour_entries').update(payload).eq('id', editing.id);
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('staff_hour_entries').insert({ ...payload, user_id: userId, status: 'pending' });
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
    }
    setSaving(false);
    resetForm();
    fetchEntries();
  };

  const handleDelete = async (e) => {
    if (!window.confirm('Delete this hour entry?')) return;
    const { error } = await supabase.from('staff_hour_entries').delete().eq('id', e.id);
    if (error) alert('Delete failed: ' + error.message);
    else fetchEntries();
  };

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };
  const formatDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const totals = entries.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + Number(e.hours_decimal);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{(totals.pending || 0).toFixed(2)} <span className="text-sm font-normal text-gray-500">hrs</span></p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Approved</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{(totals.approved || 0).toFixed(2)} <span className="text-sm font-normal text-gray-500">hrs</span></p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Rejected</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{(totals.rejected || 0).toFixed(2)} <span className="text-sm font-normal text-gray-500">hrs</span></p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Submit hours you worked. Admin will review and approve.</p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            <Plus size={16} />
            <span>Log hours</span>
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit hours' : 'Log hours'}</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hours</label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="24"
                value={hours}
                onChange={(e) => { setHours(e.target.value); setHoursTouched(true); }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start time (optional)</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End time (optional)</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="What did you work on?"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2 mt-4">
            <button onClick={resetForm} className="px-4 py-2 text-gray-600 hover:text-gray-900 transition">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Clock className="mx-auto text-gray-300 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No hours yet</h3>
          <p className="text-gray-500">Click "Log hours" above to submit your first entry.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {entries.map(e => (
            <div key={e.id} className="p-4 flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[e.status]}`}>{e.status}</span>
                  <h4 className="font-medium text-gray-900">{formatDate(e.work_date)}</h4>
                  <span className="text-sm text-gray-600 font-semibold">{Number(e.hours_decimal).toFixed(2)} hrs</span>
                </div>
                {(e.start_time || e.end_time) && (
                  <p className="text-sm text-gray-600 mt-0.5">
                    {formatTime(e.start_time)} {e.start_time && e.end_time && '–'} {formatTime(e.end_time)}
                  </p>
                )}
                {e.notes && <p className="text-sm text-gray-600 mt-1">{e.notes}</p>}
                {e.status !== 'pending' && (
                  <p className="text-xs text-gray-500 mt-1 flex items-center space-x-1">
                    {e.status === 'approved' ? <Check size={12} /> : <AlertCircle size={12} />}
                    <span>
                      {e.status === 'approved' ? 'Approved' : 'Rejected'} by {e.reviewer?.full_name || 'admin'}
                      {e.reviewed_at && ` · ${new Date(e.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </span>
                  </p>
                )}
                {e.review_notes && <p className="text-xs text-gray-600 mt-1 italic">"{e.review_notes}"</p>}
              </div>
              {e.status === 'pending' && (
                <div className="flex items-center space-x-1 ml-3 flex-shrink-0">
                  <button onClick={() => handleEdit(e)} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition" title="Edit"><Edit2 size={16} /></button>
                  <button onClick={() => handleDelete(e)} className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded transition" title="Delete"><Trash2 size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
