import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { FileText, Download, Search, FolderOpen } from 'lucide-react';

const CATEGORIES = ['All', 'Handbook', 'SOP', 'Policy', 'Training', 'Other'];

export default function WorkDocs() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [opening, setOpening] = useState(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_documents')
      .select('id, title, description, category, version, file_path, file_name, file_size, file_type, created_at, uploaded_by, uploader:uploaded_by(full_name)')
      .order('category', { ascending: true })
      .order('title', { ascending: true });

    if (error) console.error('Error fetching documents:', error);
    else setDocs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleOpen = async (doc) => {
    setOpening(doc.id);
    const { data, error } = await supabase.storage
      .from('staff-documents')
      .createSignedUrl(doc.file_path, 60 * 60);
    setOpening(null);
    if (error || !data?.signedUrl) {
      alert('Could not open file: ' + (error?.message || 'unknown error'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const filtered = docs.filter(d => {
    if (category !== 'All' && d.category !== category) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${d.title || ''} ${d.description || ''} ${d.file_name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center space-x-2 overflow-x-auto">
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0 ${
                category === c ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <FolderOpen className="mx-auto text-gray-300 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No documents</h3>
          <p className="text-gray-500">
            {docs.length === 0 ? 'No staff documents have been uploaded yet.' : 'No documents match your filters.'}
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
                    <h4 className="font-medium text-gray-900 truncate">{d.title}</h4>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{d.category}</span>
                    {d.version && <span className="text-xs text-gray-500">v{d.version}</span>}
                  </div>
                  {d.description && <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">{d.description}</p>}
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
