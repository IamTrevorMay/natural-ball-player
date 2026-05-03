import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Plus, X, Edit2, Trash2, Plane, Check, AlertCircle, Ban } from 'lucide-react';

const STATUS_BADGE = {
  pending:   'bg-yellow-100 text-yellow-700',
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const TYPE_OPTIONS = [
  { value: 'pto',    label: 'PTO' },
  { value: 'sick',   label: 'Sick' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'other',  label: 'Other' },
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t.label]));

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

export default function WorkTimeOff({ userId }) {
  const [requests, setRequests] = useState([]);
  const [approver, setApprover] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const [type, setType] = useState('pto');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [reqRes, settingRes] = await Promise.all([
      supabase
        .from('staff_time_off_requests')
        .select('id, type, start_date, end_date, reason, status, reviewed_at, review_notes, reviewer:reviewed_by(full_name)')
        .eq('user_id', userId)
        .order('start_date', { ascending: false }),
      supabase
        .from('work_portal_settings')
        .select('value')
        .eq('key', 'time_off_primary_approver_id')
        .maybeSingle(),
    ]);
    if (reqRes.error) console.error('Error:', reqRes.error);
    else setRequests(reqRes.data || []);

    const approverId = settingRes.data?.value;
    if (approverId) {
      const { data } = await supabase.from('users').select('full_name').eq('id', approverId).maybeSingle();
      setApprover(data?.full_name || null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    fetchAll();
    const channel = supabase.channel('my-time-off')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_time_off_requests', filter: `user_id=eq.${userId}` }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchAll]);

  const resetForm = () => {
    setType('pto');
    setStartDate(todayISO());
    setEndDate(todayISO());
    setReason('');
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (r) => {
    setEditing(r);
    setType(r.type);
    setStartDate(r.start_date);
    setEndDate(r.end_date);
    setReason(r.reason || '');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!startDate || !endDate) { alert('Start and end dates are required.'); return; }
    if (endDate < startDate) { alert('End date must be on or after start date.'); return; }
    setSaving(true);
    const payload = { type, start_date: startDate, end_date: endDate, reason: reason.trim() || null };
    if (editing) {
      const { error } = await supabase.from('staff_time_off_requests').update(payload).eq('id', editing.id);
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('staff_time_off_requests').insert({ ...payload, user_id: userId, status: 'pending' });
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
    }
    setSaving(false);
    resetForm();
    fetchAll();
  };

  const handleCancel = async (r) => {
    if (!window.confirm('Cancel this time-off request?')) return;
    const { error } = await supabase.from('staff_time_off_requests').update({ status: 'cancelled' }).eq('id', r.id);
    if (error) alert('Cancel failed: ' + error.message);
    else fetchAll();
  };

  const handleDelete = async (r) => {
    if (!window.confirm('Delete this request?')) return;
    const { error } = await supabase.from('staff_time_off_requests').delete().eq('id', r.id);
    if (error) alert('Delete failed: ' + error.message);
    else fetchAll();
  };

  const formatDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-4">
      {approver && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-900">
          Time-off requests are routed to <span className="font-semibold">{approver}</span> for approval.
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Submit a time-off request and track its status.</p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            <Plus size={16} />
            <span>Request time off</span>
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit request' : 'New time-off request'}</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="hidden md:block" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {startDate && endDate && endDate >= startDate && (
              <div className="md:col-span-2 text-sm text-gray-600">
                {daysBetween(startDate, endDate)} day{daysBetween(startDate, endDate) !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <div className="flex justify-end space-x-2 mt-4">
            <button onClick={resetForm} className="px-4 py-2 text-gray-600 hover:text-gray-900 transition">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Submit request'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Plane className="mx-auto text-gray-300 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No time-off requests yet</h3>
          <p className="text-gray-500">Click "Request time off" above to submit your first one.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {requests.map(r => (
            <div key={r.id} className="p-4 flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">{TYPE_LABEL[r.type]}</span>
                  <h4 className="font-medium text-gray-900">
                    {formatDate(r.start_date)}{r.end_date !== r.start_date && ` – ${formatDate(r.end_date)}`}
                  </h4>
                  <span className="text-sm text-gray-500">({daysBetween(r.start_date, r.end_date)}d)</span>
                </div>
                {r.reason && <p className="text-sm text-gray-600 mt-1">{r.reason}</p>}
                {(r.status === 'approved' || r.status === 'rejected') && (
                  <p className="text-xs text-gray-500 mt-1 flex items-center space-x-1">
                    {r.status === 'approved' ? <Check size={12} /> : <AlertCircle size={12} />}
                    <span>
                      {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.reviewer?.full_name || 'admin'}
                      {r.reviewed_at && ` · ${new Date(r.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </span>
                  </p>
                )}
                {r.review_notes && <p className="text-xs text-gray-600 mt-1 italic">"{r.review_notes}"</p>}
              </div>
              <div className="flex items-center space-x-1 ml-3 flex-shrink-0">
                {r.status === 'pending' && (
                  <>
                    <button onClick={() => handleEdit(r)} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition" title="Edit"><Edit2 size={16} /></button>
                    <button onClick={() => handleCancel(r)} className="p-2 text-gray-500 hover:text-orange-600 hover:bg-gray-100 rounded transition" title="Cancel"><Ban size={16} /></button>
                    <button onClick={() => handleDelete(r)} className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded transition" title="Delete"><Trash2 size={16} /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
