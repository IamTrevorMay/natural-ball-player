import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Pin, PinOff, Trash2, Edit2, Plus, X } from 'lucide-react';
import { formatUserError } from './errorMessage';

export default function WorkAdminAnnouncements({ userId }) {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_announcements')
      .select('id, title, body, pinned, created_at, author_id, author:author_id(full_name)')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) console.error('Error fetching:', error);
    else setAnnouncements(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

  const resetForm = () => {
    setTitle('');
    setBody('');
    setPinned(false);
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (a) => {
    setEditing(a.id);
    setTitle(a.title);
    setBody(a.body);
    setPinned(a.pinned);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !body.trim()) {
      alert('Title and body are required.');
      return;
    }
    setSaving(true);

    if (editing) {
      const { error } = await supabase
        .from('staff_announcements')
        .update({ title: title.trim(), body: body.trim(), pinned })
        .eq('id', editing);
      if (error) {
        alert('Error: ' + formatUserError(error));
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from('staff_announcements')
        .insert({ title: title.trim(), body: body.trim(), pinned, author_id: userId });
      if (error) {
        alert('Error: ' + formatUserError(error));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    resetForm();
    fetchAnnouncements();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this announcement?')) return;
    const { error } = await supabase.from('staff_announcements').delete().eq('id', id);
    if (error) alert('Error: ' + formatUserError(error));
    else fetchAnnouncements();
  };

  const handleTogglePin = async (a) => {
    const { error } = await supabase
      .from('staff_announcements')
      .update({ pinned: !a.pinned })
      .eq('id', a.id);
    if (error) alert('Error: ' + formatUserError(error));
    else fetchAnnouncements();
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Announcements posted here appear on every staff member's Home page.</p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            <Plus size={16} />
            <span>New announcement</span>
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit announcement' : 'New announcement'}</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Holiday hours update"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="What do you want the staff to know?"
              />
            </div>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Pin to top</span>
            </label>
            <div className="flex justify-end space-x-2">
              <button onClick={resetForm} className="px-4 py-2 text-gray-600 hover:text-gray-900 transition">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Post announcement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : announcements.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">No announcements yet.</div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {announcements.map(a => (
            <div key={a.id} className="p-4 flex items-start justify-between">
              <div className="flex-1 min-w-0 mr-4">
                <div className="flex items-center space-x-2 mb-1">
                  {a.pinned && (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">
                      <Pin size={10} />
                      <span>Pinned</span>
                    </span>
                  )}
                  <h4 className="font-semibold text-gray-900 truncate">{a.title}</h4>
                </div>
                <p className="text-sm text-gray-600 line-clamp-2">{a.body}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {a.author?.full_name || 'Unknown'} &middot; {formatDate(a.created_at)}
                </p>
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0">
                <button
                  onClick={() => handleTogglePin(a)}
                  className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition"
                  title={a.pinned ? 'Unpin' : 'Pin'}
                >
                  {a.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
                <button
                  onClick={() => handleEdit(a)}
                  className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded transition"
                  title="Edit"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => handleDelete(a.id)}
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
