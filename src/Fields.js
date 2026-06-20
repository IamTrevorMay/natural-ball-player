import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { MapPin, Plus, Pencil, Trash2, ExternalLink, X, Search } from 'lucide-react';
import { formatUserError } from './errorMessage';

export default function Fields({ userId, userRole }) {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const canEdit = userRole === 'admin' || userRole === 'coach';

  useEffect(() => {
    fetchFields();
  }, []);

  const fetchFields = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('fields')
      .select('*')
      .order('name');
    if (error) console.error('Error fetching fields:', error);
    setFields(data || []);
    setLoading(false);
  };

  const handleDelete = async (field) => {
    if (!window.confirm(`Delete "${field.name}"?`)) return;
    const { error } = await supabase.from('fields').delete().eq('id', field.id);
    if (error) {
      alert('Error deleting field: ' + formatUserError(error));
      return;
    }
    fetchFields();
  };

  const mapsUrl = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  const filtered = fields.filter(f => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (f.name || '').toLowerCase().includes(q) ||
      (f.address || '').toLowerCase().includes(q) ||
      (f.notes || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Fields</h2>
          <p className="text-gray-600 mt-1">Practice and game venue directory</p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
          >
            <Plus size={18} />
            <span>Add Field</span>
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields by name, address, or notes..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading fields...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <MapPin size={32} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">{fields.length === 0 ? 'No fields added yet' : 'No fields match your search'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(field => (
              <div key={field.id} className="p-4 flex items-start justify-between hover:bg-gray-50 transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <MapPin size={16} className="text-blue-600 flex-shrink-0" />
                    <h3 className="text-base font-semibold text-gray-900">{field.name}</h3>
                  </div>
                  {field.address && (
                    <a
                      href={mapsUrl(field.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center space-x-1"
                    >
                      <span>{field.address}</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                  {field.notes && (
                    <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{field.notes}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center space-x-1 ml-4 flex-shrink-0">
                    <button
                      onClick={() => { setEditing(field); setShowForm(true); }}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(field)}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <FieldForm
          field={editing}
          userId={userId}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); fetchFields(); }}
        />
      )}
    </div>
  );
}

function FieldForm({ field, userId, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: field?.name || '',
    address: field?.address || '',
    notes: field?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError('');

    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let resp;
    if (field) {
      resp = await supabase.from('fields').update(payload).eq('id', field.id);
    } else {
      resp = await supabase.from('fields').insert({ ...payload, created_by: userId });
    }

    if (resp.error) {
      setError(resp.error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-5 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">{field ? 'Edit Field' : 'Add Field'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={22} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Riverside Park Diamond 3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 Main St, City, State ZIP"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Players will be able to tap to open in Google/Apple Maps.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows="3"
              placeholder="Parking instructions, field number, gate code, etc."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : (field ? 'Save Changes' : 'Add Field')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
