import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Mail, Phone, Search, Users as UsersIcon } from 'lucide-react';

export default function WorkDirectory() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, phone, role, avatar_url')
        .in('role', ['admin', 'coach'])
        .order('full_name', { ascending: true });

      if (error) console.error('Error fetching staff:', error);
      else setStaff(data || []);
      setLoading(false);
    })();
  }, []);

  const filtered = staff.filter(s => {
    if (roleFilter !== 'all' && s.role !== roleFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${s.full_name || ''} ${s.email || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center space-x-2">
          {['all', 'admin', 'coach'].map(r => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition capitalize ${
                roleFilter === r ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {r === 'all' ? 'All' : r + 's'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <UsersIcon className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">No staff match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(s => (
            <div key={s.id} className="bg-white rounded-lg shadow p-5">
              <div className="flex items-center space-x-3 mb-3">
                {s.avatar_url ? (
                  <img src={s.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold">
                    {s.full_name?.charAt(0) || '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{s.full_name || 'Unknown'}</p>
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${
                    s.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {s.role?.toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 text-sm">
                {s.email && (
                  <a href={`mailto:${s.email}`} className="flex items-center space-x-2 text-gray-600 hover:text-indigo-600 transition">
                    <Mail size={14} className="flex-shrink-0" />
                    <span className="truncate">{s.email}</span>
                  </a>
                )}
                {s.phone && (
                  <a href={`tel:${s.phone}`} className="flex items-center space-x-2 text-gray-600 hover:text-indigo-600 transition">
                    <Phone size={14} className="flex-shrink-0" />
                    <span>{s.phone}</span>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
