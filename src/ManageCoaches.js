import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Users, Search, Edit2, X, Plus } from 'lucide-react';

const STATUS_OPTIONS = ['Active', 'Remote', 'On-Site', 'Inactive', 'Archived'];
const SUB_STATUS_OPTIONS = ['No Sub-Status', 'Development', 'Trial'];

const STATUS_COLORS = {
  'Active': 'bg-green-500 text-white',
  'Remote': 'bg-orange-500 text-white',
  'On-Site': 'bg-blue-500 text-white',
  'Inactive': 'bg-gray-500 text-white',
  'Archived': 'bg-red-500 text-white',
};

export default function ManageCoaches({ userId, userRole, onNavigateToProfile }) {
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSubStatus, setFilterSubStatus] = useState('All');
  const [editingCoach, setEditingCoach] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => { fetchCoaches(); }, []);

  const fetchCoaches = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, avatar_url, coach_status, coach_sub_status, team_members(team_id, teams(name))')
      .eq('role', 'coach')
      .order('full_name');

    if (error) { console.error(error); setLoading(false); return; }
    setCoaches(data || []);
    setLoading(false);
  };

  const handleInlineUpdate = async (coachId, field, value) => {
    const { error } = await supabase.from('users').update({ [field]: value }).eq('id', coachId);
    if (!error) {
      setCoaches(prev => prev.map(c => c.id === coachId ? { ...c, [field]: value } : c));
    }
  };

  const splitName = (fullName) => {
    const parts = (fullName || '').trim().split(/\s+/);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
  };

  const allTeamNames = [...new Set(
    coaches.flatMap(c => (c.team_members || []).map(tm => tm.teams?.name).filter(Boolean))
  )].sort();

  const displayCoaches = coaches.filter(c => {
    const teamNames = (c.team_members || []).map(tm => tm.teams?.name).filter(Boolean);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!c.full_name.toLowerCase().includes(q)) return false;
    }
    if (filterTeam !== 'All' && !teamNames.includes(filterTeam)) return false;
    if (filterStatus !== 'All' && (c.coach_status || '') !== filterStatus) return false;
    if (filterSubStatus !== 'All' && (c.coach_sub_status || '') !== filterSubStatus) return false;
    return true;
  });

  const BadgeSelect = ({ value, options, colors, onChange, placeholder }) => {
    const color = value && colors[value] ? colors[value] : '';
    return (
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={`px-2 py-1 rounded text-xs font-medium border-0 cursor-pointer appearance-none pr-5 ${color || 'bg-gray-100 text-gray-600'}`}
        style={value && colors[value] ? {
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='white' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 4px center',
        } : {
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 4px center',
        }}
      >
        <option value="">{placeholder || '—'}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  };

  const filterSelectClass = "w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-gray-700";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading coaches...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-3xl font-bold text-gray-900">Manage Coaches</h2>
            <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-bold">
              {coaches.length}
            </span>
          </div>
          <p className="text-gray-600 mt-1">View and manage coaching staff</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {/* Filter Row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <th colSpan={2} className="px-3 py-2 text-left">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search for a Coach..."
                      className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </th>
                <th className="px-2 py-2">
                  <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {allTeamNames.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterSubStatus} onChange={(e) => setFilterSubStatus(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {SUB_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
              </tr>
              {/* Column Headers */}
              <tr className="border-b border-gray-200 bg-white">
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">First Name</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Last Name</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Team</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Sub Status</th>
              </tr>
            </thead>
            <tbody>
              {displayCoaches.map(coach => {
                const { firstName, lastName } = splitName(coach.full_name);
                const teamNames = (coach.team_members || []).map(tm => tm.teams?.name).filter(Boolean);

                return (
                  <tr key={coach.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3">
                      <button
                        onClick={() => onNavigateToProfile && onNavigateToProfile(coach.id)}
                        className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {firstName}
                      </button>
                    </td>
                    <td className="py-3 px-3 font-semibold text-gray-900">{lastName}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{teamNames.join(', ') || '—'}</td>
                    <td className="py-3 px-3">
                      <BadgeSelect
                        value={coach.coach_status}
                        options={STATUS_OPTIONS}
                        colors={STATUS_COLORS}
                        onChange={(val) => handleInlineUpdate(coach.id, 'coach_status', val)}
                      />
                    </td>
                    <td className="py-3 px-3">
                      <BadgeSelect
                        value={coach.coach_sub_status}
                        options={SUB_STATUS_OPTIONS}
                        colors={{}}
                        onChange={(val) => handleInlineUpdate(coach.id, 'coach_sub_status', val)}
                        placeholder="No Sub-Status"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {displayCoaches.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Users size={40} className="mx-auto mb-3 text-gray-300" />
              <p>No coaches found matching your filters.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
