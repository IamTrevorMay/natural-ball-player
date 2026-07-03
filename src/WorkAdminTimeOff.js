import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Plane, Check, X, RotateCcw, Star } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { trackAction } from './usage';

const STATUS_BADGE = {
  pending:   'bg-yellow-100 text-yellow-700',
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const TYPE_LABEL = { pto: 'PTO', sick: 'Sick', unpaid: 'Unpaid', other: 'Other' };

function daysBetween(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

export default function WorkAdminTimeOff({ userId }) {
  const [requests, setRequests] = useState([]);
  const [staff, setStaff] = useState([]);
  const [primaryApproverId, setPrimaryApproverId] = useState(null);
  const [primaryApproverName, setPrimaryApproverName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [filterUser, setFilterUser] = useState('all');
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [reqRes, staffRes, settingRes] = await Promise.all([
      supabase
        .from('staff_time_off_requests')
        .select('id, user_id, type, start_date, end_date, reason, status, reviewed_at, review_notes, submitter:user_id(full_name), reviewer:reviewed_by(full_name)')
        .order('status', { ascending: true })
        .order('start_date', { ascending: false }),
      supabase
        .from('users')
        .select('id, full_name, role')
        .in('role', ['admin', 'coach'])
        .order('full_name', { ascending: true }),
      supabase
        .from('work_portal_settings')
        .select('value')
        .eq('key', 'time_off_primary_approver_id')
        .maybeSingle(),
    ]);
    if (reqRes.error) console.error('Error:', reqRes.error);
    else setRequests(reqRes.data || []);
    if (staffRes.error) console.error('Error:', staffRes.error);
    else setStaff(staffRes.data || []);

    const approverId = settingRes.data?.value;
    setPrimaryApproverId(approverId);
    if (approverId) {
      const { data } = await supabase.from('users').select('full_name').eq('id', approverId).maybeSingle();
      setPrimaryApproverName(data?.full_name || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase.channel('admin-time-off')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_time_off_requests' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  const startReview = (r, defaultNotes = '') => {
    setReviewingId(r.id);
    setReviewNotes(defaultNotes);
  };

  const cancelReview = () => {
    setReviewingId(null);
    setReviewNotes('');
  };

  const setStatus = async (r, status) => {
    trackAction(`time_off_${status}`);
    const { error } = await supabase
      .from('staff_time_off_requests')
      .update({
        status,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes.trim() || null,
      })
      .eq('id', r.id);
    if (error) { alert('Update failed: ' + formatUserError(error)); return; }
    cancelReview();
    fetchAll();
  };

  const reopen = async (r) => {
    if (!window.confirm('Reset this request to pending?')) return;
    const { error } = await supabase
      .from('staff_time_off_requests')
      .update({ status: 'pending', reviewed_by: null, reviewed_at: null, review_notes: null })
      .eq('id', r.id);
    if (error) alert('Update failed: ' + formatUserError(error));
    else fetchAll();
  };

  const filtered = requests.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterUser !== 'all' && r.user_id !== filterUser) return false;
    return true;
  });

  const formatDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const isPrimary = userId === primaryApproverId;

  return (
    <div className="space-y-4">
      {primaryApproverName && (
        <div className={`rounded-lg p-3 text-sm flex items-start space-x-2 ${
          isPrimary ? 'bg-indigo-50 border border-indigo-200 text-indigo-900' : 'bg-gray-50 border border-gray-200 text-gray-700'
        }`}>
          <Star size={16} className={isPrimary ? 'text-indigo-600 mt-0.5' : 'text-gray-500 mt-0.5'} />
          <span>
            Primary approver: <span className="font-semibold">{primaryApproverName}</span>
            {isPrimary && ' — that\'s you.'}
            {!isPrimary && ` — you can still approve, but ${primaryApproverName} is the default.`}
          </span>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center space-x-2 overflow-x-auto">
          {[
            { key: 'pending',   label: `Pending${pendingCount ? ` (${pendingCount})` : ''}` },
            { key: 'approved',  label: 'Approved' },
            { key: 'rejected',  label: 'Rejected' },
            { key: 'cancelled', label: 'Cancelled' },
            { key: 'all',       label: 'All' },
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
          <Plane className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">No requests match your filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {filtered.map(r => (
            <div key={r.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">{TYPE_LABEL[r.type]}</span>
                    <h4 className="font-medium text-gray-900">{r.submitter?.full_name || 'Unknown'}</h4>
                    <span className="text-sm text-gray-500">·</span>
                    <span className="text-sm text-gray-700">
                      {formatDate(r.start_date)}{r.end_date !== r.start_date && ` – ${formatDate(r.end_date)}`}
                    </span>
                    <span className="text-sm text-gray-500">({daysBetween(r.start_date, r.end_date)}d)</span>
                  </div>
                  {r.reason && <p className="text-sm text-gray-600 mt-1">{r.reason}</p>}
                  {(r.status === 'approved' || r.status === 'rejected') && (
                    <p className="text-xs text-gray-500 mt-1">
                      {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.reviewer?.full_name || 'admin'}
                      {r.reviewed_at && ` · ${new Date(r.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </p>
                  )}
                  {r.review_notes && <p className="text-xs text-gray-600 mt-1 italic">"{r.review_notes}"</p>}
                </div>
                {reviewingId !== r.id && (
                  <div className="flex items-center space-x-1 ml-3 flex-shrink-0">
                    {r.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => startReview(r)}
                          className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200 transition flex items-center space-x-1"
                        >
                          <Check size={14} />
                          <span>Approve</span>
                        </button>
                        <button
                          onClick={() => startReview(r)}
                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition flex items-center space-x-1"
                        >
                          <X size={14} />
                          <span>Reject</span>
                        </button>
                      </>
                    ) : r.status !== 'cancelled' && (
                      <button
                        onClick={() => reopen(r)}
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
              {reviewingId === r.id && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Review notes (optional)</label>
                  <textarea
                    value={reviewNotes}
                    onChange={(ev) => setReviewNotes(ev.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Add a note for the requester (optional)"
                  />
                  <div className="flex justify-end space-x-2 mt-2">
                    <button onClick={cancelReview} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                    <button
                      onClick={() => setStatus(r, 'rejected')}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition flex items-center space-x-1"
                    >
                      <X size={14} />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={() => setStatus(r, 'approved')}
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
