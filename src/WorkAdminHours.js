import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Clock, Check, X, RotateCcw } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { trackAction } from './usage';

const STATUS_BADGE = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function WorkAdminHours({ userId }) {
  const [entries, setEntries] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [filterUser, setFilterUser] = useState('all');
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [entriesRes, staffRes] = await Promise.all([
      supabase
        .from('staff_hour_entries')
        .select('id, user_id, work_date, start_time, end_time, hours_decimal, notes, status, reviewed_at, review_notes, submitter:user_id(full_name), reviewer:reviewed_by(full_name)')
        .order('status', { ascending: true })
        .order('work_date', { ascending: false }),
      supabase
        .from('users')
        .select('id, full_name, role')
        .in('role', ['admin', 'coach'])
        .order('full_name', { ascending: true }),
    ]);
    if (entriesRes.error) console.error('Error:', entriesRes.error);
    else setEntries(entriesRes.data || []);
    if (staffRes.error) console.error('Error:', staffRes.error);
    else setStaff(staffRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase.channel('admin-hours')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_hour_entries' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  const startReview = (entry) => {
    setReviewingId(entry.id);
    setReviewNotes(entry.review_notes || '');
  };

  const cancelReview = () => {
    setReviewingId(null);
    setReviewNotes('');
  };

  const setStatus = async (entry, status) => {
    trackAction(`hours_${status}`);
    const { error } = await supabase
      .from('staff_hour_entries')
      .update({
        status,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes.trim() || null,
      })
      .eq('id', entry.id);
    if (error) { alert('Update failed: ' + formatUserError(error)); return; }
    cancelReview();
    fetchAll();
  };

  const reopenEntry = async (entry) => {
    if (!window.confirm('Reset this entry to pending?')) return;
    const { error } = await supabase
      .from('staff_hour_entries')
      .update({ status: 'pending', reviewed_by: null, reviewed_at: null, review_notes: null })
      .eq('id', entry.id);
    if (error) alert('Update failed: ' + formatUserError(error));
    else fetchAll();
  };

  const filtered = entries.filter(e => {
    if (filterStatus !== 'all' && e.status !== filterStatus) return false;
    if (filterUser !== 'all' && e.user_id !== filterUser) return false;
    return true;
  });

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };
  const formatDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const pendingCount = entries.filter(e => e.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center space-x-2 overflow-x-auto">
          {[
            { key: 'pending', label: `Pending${pendingCount ? ` (${pendingCount})` : ''}` },
            { key: 'approved', label: 'Approved' },
            { key: 'rejected', label: 'Rejected' },
            { key: 'all', label: 'All' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setFilterStatus(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0 ${
                filterStatus === t.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-sm text-gray-600">Staff:</label>
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All staff</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Clock className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">No entries match your filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {filtered.map(e => (
            <div key={e.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[e.status]}`}>{e.status}</span>
                    <h4 className="font-medium text-gray-900">{e.submitter?.full_name || 'Unknown'}</h4>
                    <span className="text-sm text-gray-500">·</span>
                    <span className="text-sm text-gray-700">{formatDate(e.work_date)}</span>
                    <span className="text-sm font-semibold text-indigo-700">{Number(e.hours_decimal).toFixed(2)} hrs</span>
                  </div>
                  {(e.start_time || e.end_time) && (
                    <p className="text-sm text-gray-600 mt-0.5">
                      {formatTime(e.start_time)} {e.start_time && e.end_time && '–'} {formatTime(e.end_time)}
                    </p>
                  )}
                  {e.notes && <p className="text-sm text-gray-600 mt-1">{e.notes}</p>}
                  {e.status !== 'pending' && (
                    <p className="text-xs text-gray-500 mt-1">
                      {e.status === 'approved' ? 'Approved' : 'Rejected'} by {e.reviewer?.full_name || 'admin'}
                      {e.reviewed_at && ` · ${new Date(e.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </p>
                  )}
                  {e.review_notes && <p className="text-xs text-gray-600 mt-1 italic">"{e.review_notes}"</p>}
                </div>
                {reviewingId !== e.id && (
                  <div className="flex items-center space-x-1 ml-3 flex-shrink-0">
                    {e.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => startReview(e)}
                          className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200 transition flex items-center space-x-1"
                        >
                          <Check size={14} />
                          <span>Approve</span>
                        </button>
                        <button
                          onClick={() => { startReview(e); setReviewNotes(''); }}
                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition flex items-center space-x-1"
                        >
                          <X size={14} />
                          <span>Reject</span>
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => reopenEntry(e)}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition flex items-center space-x-1"
                        title="Reset to pending"
                      >
                        <RotateCcw size={14} />
                        <span>Reopen</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              {reviewingId === e.id && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Review notes (optional)</label>
                  <textarea
                    value={reviewNotes}
                    onChange={(ev) => setReviewNotes(ev.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Add a note for the coach (optional)"
                  />
                  <div className="flex justify-end space-x-2 mt-2">
                    <button onClick={cancelReview} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                    <button
                      onClick={() => setStatus(e, 'rejected')}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition flex items-center space-x-1"
                    >
                      <X size={14} />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={() => setStatus(e, 'approved')}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition flex items-center space-x-1"
                    >
                      <Check size={14} />
                      <span>Approve</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
