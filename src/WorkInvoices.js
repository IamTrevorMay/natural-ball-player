import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Upload, FileText, Trash2, ExternalLink, X, DollarSign } from 'lucide-react';

const STATUS_COLORS = {
  submitted: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  paid: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function WorkInvoices({ userId, userRole }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [file, setFile] = useState(null);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const isAdmin = userRole === 'admin';

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const query = supabase
      .from('coach_invoices')
      .select('*, coach:coach_id(full_name)')
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      query.eq('coach_id', userId);
    }

    const { data, error } = await query;
    if (error) console.error('Error fetching invoices:', error);
    else setInvoices(data || []);
    setLoading(false);
  }, [userId, isAdmin]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const handleUpload = async () => {
    if (!file) return alert('Please select a file to upload.');
    setSaving(true);
    try {
      const ext = file.name.split('.').pop();
      const filePath = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('coach-invoices')
        .upload(filePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('coach_invoices')
        .insert({
          coach_id: userId,
          invoice_date: invoiceDate || null,
          amount: amount ? parseFloat(amount) : null,
          description: description.trim() || null,
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
        });

      if (insertError) {
        await supabase.storage.from('coach-invoices').remove([filePath]);
        throw insertError;
      }

      setFile(null);
      setInvoiceDate(new Date().toISOString().split('T')[0]);
      setAmount('');
      setDescription('');
      setShowForm(false);
      await fetchInvoices();
    } catch (error) {
      console.error('Error uploading invoice:', error);
      alert('Error uploading invoice: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = async (inv) => {
    const { data, error } = await supabase.storage
      .from('coach-invoices')
      .createSignedUrl(inv.file_path, 60 * 60);
    if (error || !data?.signedUrl) { alert('Could not open file.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (inv) => {
    if (!window.confirm('Delete this invoice?')) return;
    const { error } = await supabase.from('coach_invoices').delete().eq('id', inv.id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    if (inv.file_path) {
      await supabase.storage.from('coach-invoices').remove([inv.file_path]);
    }
    fetchInvoices();
  };

  const handleStatusChange = async (inv, newStatus) => {
    const { error } = await supabase
      .from('coach_invoices')
      .update({ status: newStatus })
      .eq('id', inv.id);
    if (error) { alert('Update failed: ' + error.message); return; }
    fetchInvoices();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{isAdmin ? 'Coach Invoices' : 'My Invoices'}</h2>
          <p className="text-sm text-gray-500 mt-1">{isAdmin ? 'Review and manage coach-submitted invoices.' : 'Upload and track your invoices.'}</p>
        </div>
        {!isAdmin && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            <Upload size={16} />
            <span>Upload Invoice</span>
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Upload Invoice</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. May 2026 coaching hours" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">File *</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
            </div>
          </div>
          <div className="flex justify-end space-x-2 mt-4">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-600 hover:text-gray-900 transition">Cancel</button>
            <button onClick={handleUpload} disabled={saving || !file} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
              <Upload size={16} />
              <span>{saving ? 'Uploading...' : 'Upload'}</span>
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading invoices...</div>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <DollarSign size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">{isAdmin ? 'No invoices submitted yet.' : 'You haven\'t uploaded any invoices yet.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {isAdmin && <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Coach</th>}
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Date</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Amount</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Description</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">File</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                    {isAdmin && (
                      <td className="px-4 py-3 text-sm text-gray-900 font-medium">{inv.coach?.full_name || '—'}</td>
                    )}
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {inv.invoice_date ? new Date(inv.invoice_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {inv.amount != null ? `$${Number(inv.amount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{inv.description || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <button onClick={() => handleOpen(inv)} className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800">
                        <FileText size={14} />
                        <span className="truncate max-w-[120px]">{inv.file_name || 'View'}</span>
                      </button>
                      {inv.file_size && <span className="text-xs text-gray-400 ml-1">({formatSize(inv.file_size)})</span>}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <select
                          value={inv.status}
                          onChange={(e) => handleStatusChange(inv, e.target.value)}
                          className={`px-2 py-1 rounded-full text-xs font-medium border-0 cursor-pointer ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}`}
                        >
                          <option value="submitted">Submitted</option>
                          <option value="approved">Approved</option>
                          <option value="paid">Paid</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      ) : (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                          {inv.status?.charAt(0).toUpperCase() + inv.status?.slice(1)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        <button onClick={() => handleOpen(inv)} className="text-gray-400 hover:text-blue-600" title="Open file">
                          <ExternalLink size={16} />
                        </button>
                        {(isAdmin || inv.status === 'submitted') && (
                          <button onClick={() => handleDelete(inv)} className="text-gray-400 hover:text-red-600" title="Delete">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
