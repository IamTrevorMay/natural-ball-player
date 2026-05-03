import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { FileText, Download, DollarSign } from 'lucide-react';

const DOC_TYPE_LABEL = {
  paystub: 'Paystub',
  w2: 'W-2',
  '1099': '1099',
  other: 'Other',
};

const DOC_TYPE_COLOR = {
  paystub: 'bg-green-100 text-green-700',
  w2: 'bg-blue-100 text-blue-700',
  '1099': 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-700',
};

export default function WorkMyPay({ userId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [filter, setFilter] = useState('all');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_pay_documents')
      .select('id, doc_type, period_start, period_end, label, notes, file_path, file_name, file_size, created_at')
      .eq('user_id', userId)
      .order('period_start', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) console.error('Error fetching pay docs:', error);
    else setDocs(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (userId) fetchDocs(); }, [userId, fetchDocs]);

  const handleOpen = async (doc) => {
    setOpening(doc.id);
    const { data, error } = await supabase.storage
      .from('staff-pay-docs')
      .createSignedUrl(doc.file_path, 60 * 60);
    setOpening(null);
    if (error || !data?.signedUrl) {
      alert('Could not open file: ' + (error?.message || 'unknown error'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const formatDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filtered = filter === 'all' ? docs : docs.filter(d => d.doc_type === filter);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center space-x-2 overflow-x-auto">
          {['all', 'paystub', 'w2', '1099', 'other'].map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0 ${
                filter === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t === 'all' ? 'All' : DOC_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <DollarSign className="mx-auto text-gray-300 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No pay documents</h3>
          <p className="text-gray-500">
            {docs.length === 0
              ? 'Your paystubs and tax documents will appear here once admin uploads them.'
              : 'No documents in this category.'}
          </p>
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
                    <h4 className="font-medium text-gray-900 truncate">
                      {d.label || (d.period_start && d.period_end ? `${formatDate(d.period_start)} – ${formatDate(d.period_end)}` : d.file_name)}
                    </h4>
                  </div>
                  {!d.label && d.period_start && d.period_end && (
                    <p className="text-sm text-gray-600 mt-0.5">{formatDate(d.period_start)} – {formatDate(d.period_end)}</p>
                  )}
                  {d.notes && <p className="text-sm text-gray-600 mt-0.5">{d.notes}</p>}
                  <p className="text-xs text-gray-400 mt-1">
                    {d.file_name}{d.file_size ? ` · ${formatSize(d.file_size)}` : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleOpen(d)}
                disabled={opening === d.id}
                className="ml-3 flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition text-sm font-medium disabled:opacity-50 flex-shrink-0"
              >
                <Download size={14} />
                <span>{opening === d.id ? 'Opening...' : 'Open'}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
