import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { FileText, Plus, X, Edit2, Trash2, Upload, Download, DollarSign, Lock, Settings } from 'lucide-react';

const DOC_TYPES = [
  { value: 'paystub', label: 'Paystub' },
  { value: 'w2', label: 'W-2' },
  { value: '1099', label: '1099' },
  { value: 'other', label: 'Other' },
];

const DOC_TYPE_LABEL = Object.fromEntries(DOC_TYPES.map(t => [t.value, t.label]));

const DOC_TYPE_COLOR = {
  paystub: 'bg-green-100 text-green-700',
  w2: 'bg-blue-100 text-blue-700',
  '1099': 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-700',
};

/* ─── PIN gate ─── */
function PayrollPinGate({ onUnlock, changeMode, onCancelChange }) {
  const [storedPin, setStoredPin] = useState(null);   // null = loading, '' = no pin set
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [settingUp, setSettingUp] = useState(!!changeMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('work_portal_settings')
        .select('value')
        .eq('key', 'payroll_pin')
        .maybeSingle();
      setStoredPin(data?.value || '');
    })();
  }, []);

  const handleVerify = () => {
    if (pin === storedPin) { onUnlock(); }
    else { setError('Incorrect PIN. Try again.'); setPin(''); }
  };

  const handleSetPin = async () => {
    if (newPin.length < 4) { setError('PIN must be at least 4 digits.'); return; }
    if (newPin !== confirmPin) { setError('PINs do not match.'); return; }
    setSaving(true);
    const { error: dbErr } = await supabase
      .from('work_portal_settings')
      .upsert({ key: 'payroll_pin', value: newPin }, { onConflict: 'key' });
    if (dbErr) { setError('Failed to save PIN: ' + dbErr.message); setSaving(false); return; }
    setSaving(false);
    onUnlock();
  };

  if (storedPin === null) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>;
  }

  // No PIN set yet — prompt to create one
  if (storedPin === '' || settingUp) {
    return (
      <div className="max-w-sm mx-auto mt-16">
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Lock className="mx-auto text-indigo-400 mb-4" size={40} />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{storedPin === '' ? 'Set a Payroll PIN' : 'Change Payroll PIN'}</h2>
          <p className="text-sm text-gray-500 mb-6">Choose a numeric PIN (at least 4 digits) to protect payroll data.</p>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={newPin}
            onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, '')); setError(''); }}
            placeholder="New PIN"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg tracking-widest mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={confirmPin}
            onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, '')); setError(''); }}
            placeholder="Confirm PIN"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg tracking-widest mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onKeyDown={(e) => e.key === 'Enter' && handleSetPin()}
          />
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <button
            onClick={handleSetPin}
            disabled={saving}
            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Set PIN'}
          </button>
          {(storedPin !== '' || onCancelChange) && (
            <button onClick={() => { if (onCancelChange) onCancelChange(); else { setSettingUp(false); setError(''); } }} className="mt-3 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          )}
        </div>
      </div>
    );
  }

  // PIN exists — require entry
  return (
    <div className="max-w-sm mx-auto mt-16">
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <Lock className="mx-auto text-indigo-400 mb-4" size={40} />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Payroll Locked</h2>
        <p className="text-sm text-gray-500 mb-6">Enter your PIN to access payroll data.</p>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
          placeholder="Enter PIN"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg tracking-widest mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          onClick={handleVerify}
          className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition"
        >
          Unlock
        </button>
      </div>
    </div>
  );
}

export default function WorkAdminPayroll({ userId }) {
  const [pinVerified, setPinVerified] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  const [docs, setDocs] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterUser, setFilterUser] = useState('all');
  const [filterType, setFilterType] = useState('all');

  const [formUserId, setFormUserId] = useState('');
  const [docType, setDocType] = useState('paystub');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [docsRes, staffRes] = await Promise.all([
      supabase
        .from('staff_pay_documents')
        .select('id, user_id, doc_type, period_start, period_end, label, notes, file_path, file_name, file_size, created_at, recipient:user_id(full_name)')
        .order('created_at', { ascending: false }),
      supabase
        .from('users')
        .select('id, full_name, role')
        .in('role', ['admin', 'coach'])
        .order('full_name', { ascending: true }),
    ]);
    if (docsRes.error) console.error('Error fetching docs:', docsRes.error);
    else setDocs(docsRes.data || []);
    if (staffRes.error) console.error('Error fetching staff:', staffRes.error);
    else setStaff(staffRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => {
    setFormUserId('');
    setDocType('paystub');
    setPeriodStart('');
    setPeriodEnd('');
    setLabel('');
    setNotes('');
    setFile(null);
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (doc) => {
    setEditing(doc);
    setFormUserId(doc.user_id);
    setDocType(doc.doc_type);
    setPeriodStart(doc.period_start || '');
    setPeriodEnd(doc.period_end || '');
    setLabel(doc.label || '');
    setNotes(doc.notes || '');
    setFile(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formUserId) { alert('Please select a staff member.'); return; }
    if (!editing && !file) { alert('Please choose a file to upload.'); return; }

    setSaving(true);
    let filePath = editing?.file_path || null;
    let fileName = editing?.file_name || null;
    let fileSize = editing?.file_size || null;
    let fileType = editing?.file_type || null;

    if (file) {
      const ext = file.name.split('.').pop();
      const newPath = `${formUserId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('staff-pay-docs')
        .upload(newPath, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        alert('Upload failed: ' + uploadError.message);
        setSaving(false);
        return;
      }
      if (editing?.file_path) {
        await supabase.storage.from('staff-pay-docs').remove([editing.file_path]);
      }
      filePath = newPath;
      fileName = file.name;
      fileSize = file.size;
      fileType = file.type;
    }

    const payload = {
      user_id: formUserId,
      doc_type: docType,
      period_start: periodStart || null,
      period_end: periodEnd || null,
      label: label.trim() || null,
      notes: notes.trim() || null,
      file_path: filePath,
      file_name: fileName,
      file_size: fileSize,
      file_type: fileType,
    };

    if (editing) {
      const { error } = await supabase.from('staff_pay_documents').update(payload).eq('id', editing.id);
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('staff_pay_documents').insert({ ...payload, uploaded_by: userId });
      if (error) {
        await supabase.storage.from('staff-pay-docs').remove([filePath]);
        alert('Save failed: ' + error.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    resetForm();
    fetchAll();
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete this ${DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type} for ${doc.recipient?.full_name || 'this user'}?`)) return;
    const { error } = await supabase.from('staff_pay_documents').delete().eq('id', doc.id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    if (doc.file_path) await supabase.storage.from('staff-pay-docs').remove([doc.file_path]);
    fetchAll();
  };

  const handleOpen = async (doc) => {
    const { data, error } = await supabase.storage
      .from('staff-pay-docs')
      .createSignedUrl(doc.file_path, 60 * 60);
    if (error || !data?.signedUrl) { alert('Could not open: ' + (error?.message || '')); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const filtered = docs.filter(d => {
    if (filterUser !== 'all' && d.user_id !== filterUser) return false;
    if (filterType !== 'all' && d.doc_type !== filterType) return false;
    return true;
  });

  const formatDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!pinVerified) {
    return <PayrollPinGate onUnlock={() => setPinVerified(true)} />;
  }

  if (showChangePin) {
    return (
      <PayrollPinGate
        changeMode
        onUnlock={() => setShowChangePin(false)}
        onCancelChange={() => setShowChangePin(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Upload paystubs and tax documents. Each staff member can only see their own.</p>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowChangePin(true)}
            className="flex items-center space-x-1 text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition text-sm"
            title="Change PIN"
          >
            <Settings size={15} />
            <span className="hidden sm:inline">Change PIN</span>
          </button>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
            >
              <Plus size={16} />
              <span>Upload</span>
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit pay document' : 'Upload pay document'}</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Staff member</label>
              <select
                value={formUserId}
                onChange={(e) => setFormUserId(e.target.value)}
                disabled={!!editing}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
              >
                <option value="">Select staff...</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Document type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period start</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period end</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. April 2026 — 1st half"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{editing ? 'Replace file (optional)' : 'File'}</label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              {editing && !file && (
                <p className="text-xs text-gray-500 mt-1">Currently: {editing.file_name} ({formatSize(editing.file_size)})</p>
              )}
            </div>
          </div>
          <div className="flex justify-end space-x-2 mt-4">
            <button onClick={resetForm} className="px-4 py-2 text-gray-600 hover:text-gray-900 transition">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <Upload size={16} />
              <span>{saving ? 'Saving...' : editing ? 'Save changes' : 'Upload'}</span>
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
        <div className="flex items-center space-x-2 overflow-x-auto">
          {['all', 'paystub', 'w2', '1099', 'other'].map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0 ${
                filterType === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t === 'all' ? 'All types' : DOC_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <DollarSign className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">{docs.length === 0 ? 'No pay documents uploaded yet.' : 'No documents match your filters.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {filtered.map(d => (
            <div key={d.id} className="p-4 flex items-center justify-between">
              <div className="flex items-start space-x-3 flex-1 min-w-0">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DOC_TYPE_COLOR[d.doc_type] || DOC_TYPE_COLOR.other}`}>
                      {DOC_TYPE_LABEL[d.doc_type] || d.doc_type}
                    </span>
                    <h4 className="font-medium text-gray-900 truncate">{d.recipient?.full_name || 'Unknown'}</h4>
                  </div>
                  {d.label && <p className="text-sm text-gray-700 mt-0.5">{d.label}</p>}
                  {d.period_start && d.period_end && (
                    <p className="text-sm text-gray-600 mt-0.5">{formatDate(d.period_start)} – {formatDate(d.period_end)}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {d.file_name}{d.file_size ? ` · ${formatSize(d.file_size)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0">
                <button onClick={() => handleOpen(d)} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition" title="Open"><Download size={16} /></button>
                <button onClick={() => handleEdit(d)} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition" title="Edit"><Edit2 size={16} /></button>
                <button onClick={() => handleDelete(d)} className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded transition" title="Delete"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
