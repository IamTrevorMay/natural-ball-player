import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { FileText, Plus, X, Edit2, Trash2, Upload, Download } from 'lucide-react';

const CATEGORIES = ['Handbook', 'SOP', 'Policy', 'Training', 'Other'];

export default function WorkAdminDocs({ userId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Other');
  const [version, setVersion] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_documents')
      .select('id, title, description, category, version, file_path, file_name, file_size, file_type, created_at, uploaded_by, uploader:uploaded_by(full_name)')
      .order('created_at', { ascending: false });
    if (error) console.error('Error fetching:', error);
    else setDocs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('Other');
    setVersion('');
    setFile(null);
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (doc) => {
    setEditing(doc);
    setTitle(doc.title);
    setDescription(doc.description || '');
    setCategory(doc.category);
    setVersion(doc.version || '');
    setFile(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!title.trim()) { alert('Title is required.'); return; }
    if (!editing && !file) { alert('Please choose a file to upload.'); return; }

    setSaving(true);

    let filePath = editing?.file_path || null;
    let fileName = editing?.file_name || null;
    let fileSize = editing?.file_size || null;
    let fileType = editing?.file_type || null;

    if (file) {
      // CM4: sanitize the persisted display name.
      const rawName = file.name || 'file';
      const safeName = rawName
        .split(/[\\/]/).pop()
        .normalize('NFKD')
        .replace(/[^\w.\-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'file';
      const ext = safeName.includes('.') ? safeName.split('.').pop() : '';
      const newPath = `${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;
      const { error: uploadError } = await supabase.storage
        .from('staff-documents')
        .upload(newPath, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        alert('Upload failed: ' + uploadError.message);
        setSaving(false);
        return;
      }

      if (editing?.file_path) {
        await supabase.storage.from('staff-documents').remove([editing.file_path]);
      }

      filePath = newPath;
      fileName = safeName;
      fileSize = file.size;
      fileType = file.type;
    }

    if (editing) {
      const { error } = await supabase
        .from('staff_documents')
        .update({
          title: title.trim(),
          description: description.trim() || null,
          category,
          version: version.trim() || null,
          file_path: filePath,
          file_name: fileName,
          file_size: fileSize,
          file_type: fileType,
        })
        .eq('id', editing.id);
      if (error) {
        alert('Save failed: ' + error.message);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from('staff_documents')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          category,
          version: version.trim() || null,
          file_path: filePath,
          file_name: fileName,
          file_size: fileSize,
          file_type: fileType,
          uploaded_by: userId,
        });
      if (error) {
        await supabase.storage.from('staff-documents').remove([filePath]);
        alert('Save failed: ' + error.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    resetForm();
    fetchDocs();
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"? This will also remove the file from storage.`)) return;
    const { error } = await supabase.from('staff_documents').delete().eq('id', doc.id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    if (doc.file_path) {
      await supabase.storage.from('staff-documents').remove([doc.file_path]);
    }
    fetchDocs();
  };

  const handleOpen = async (doc) => {
    const { data, error } = await supabase.storage
      .from('staff-documents')
      .createSignedUrl(doc.file_path, 60 * 60);
    if (error || !data?.signedUrl) { alert('Could not open: ' + (error?.message || '')); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Upload and manage documents available to all staff.</p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            <Plus size={16} />
            <span>Upload document</span>
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit document' : 'Upload document'}</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Employee Handbook 2026"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Version (optional)</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="e.g. 2.0 or Q2 2026"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editing ? 'Replace file (optional)' : 'File'}
              </label>
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

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : docs.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">No documents yet.</div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {docs.map(d => (
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
                  <p className="text-xs text-gray-400 mt-0.5">
                    {d.file_name}{d.file_size ? ` · ${formatSize(d.file_size)}` : ''}
                    {d.uploader?.full_name && ` · uploaded by ${d.uploader.full_name}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0">
                <button
                  onClick={() => handleOpen(d)}
                  className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition"
                  title="Open"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={() => handleEdit(d)}
                  className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition"
                  title="Edit"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => handleDelete(d)}
                  className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded transition"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
