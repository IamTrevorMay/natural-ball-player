import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Users, Search, Edit2, X } from 'lucide-react';
import { useStatusOptions, StatusBadgeSelect } from './StatusSelect';

const PROGRAM_OPTIONS = ['Hitting', 'Pitching', 'Fielding', 'Catching', 'Combo', 'Base Running', 'Physical Therapy', 'Recovery', 'Mobility', 'Meal Planning', 'Stretching'];
const LEVEL_OPTIONS = ['8u', '9u', '10u', '11u', '12u', '13u', '14u', '15u', '16u', '17u', '18u', 'A', 'A+', 'AA', 'AAA', 'MLB', 'KBO', 'MEX', 'NPB'];
const SUB_STATUS_OPTIONS = ['Catcher', 'Infielder', 'Outfielder', 'Pitcher'];

const LEVEL_COLORS = {
  '8u': 'bg-sky-400 text-white',
  '9u': 'bg-sky-500 text-white',
  '10u': 'bg-blue-400 text-white',
  '11u': 'bg-blue-500 text-white',
  '12u': 'bg-blue-600 text-white',
  '13u': 'bg-indigo-400 text-white',
  '14u': 'bg-indigo-500 text-white',
  '15u': 'bg-indigo-600 text-white',
  '16u': 'bg-violet-500 text-white',
  '17u': 'bg-violet-600 text-white',
  '18u': 'bg-purple-600 text-white',
  'A': 'bg-teal-500 text-white',
  'A+': 'bg-teal-600 text-white',
  'AA': 'bg-amber-500 text-white',
  'AAA': 'bg-orange-500 text-white',
  'MLB': 'bg-red-600 text-white',
  'KBO': 'bg-emerald-600 text-white',
  'MEX': 'bg-green-600 text-white',
  'NPB': 'bg-rose-600 text-white',
};

const STATUS_COLORS = {
  'Active': 'bg-green-500 text-white',
  'Remote': 'bg-orange-500 text-white',
  'Inactive': 'bg-gray-500 text-white',
  'On-Site': 'bg-blue-500 text-white',
  'Archived': 'bg-red-500 text-white',
};

export default function ManageAthletes({ userId, userRole, onNavigateToProfile }) {
  const [rosterPlayers, setRosterPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterTrainer, setFilterTrainer] = useState('All');
  const [filterProgram, setFilterProgram] = useState('All');
  const [filterLevel, setFilterLevel] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSubStatus, setFilterSubStatus] = useState('All');
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [teamCoachMap, setTeamCoachMap] = useState({});

  const { options: statusOptions, addOption: addStatusOption } = useStatusOptions('status');
  const isAdmin = userRole === 'admin';

  useEffect(() => { fetchRosterPlayers(); fetchTeamCoaches(); }, []);

  const fetchRosterPlayers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, phone, avatar_url, player_profiles(id, position, jersey_number, grade, bats, throws, program, level, status, sub_status), team_members(team_id, teams(name))')
      .eq('role', 'player')
      .order('full_name');

    if (error) { console.error(error); setLoading(false); return; }

    let filtered = data || [];
    if (userRole === 'coach') {
      const { data: coachTeams } = await supabase.from('team_members').select('team_id').eq('user_id', userId);
      const teamIds = (coachTeams || []).map(t => t.team_id);
      filtered = filtered.filter(p => p.team_members?.some(tm => teamIds.includes(tm.team_id)));
    }
    setRosterPlayers(filtered);
    setLoading(false);
  };

  const fetchTeamCoaches = async () => {
    const { data } = await supabase
      .from('team_members')
      .select('team_id, users(full_name)')
      .eq('role', 'coach');
    const map = {};
    (data || []).forEach(row => {
      const name = row.users?.full_name;
      if (!name) return;
      if (!map[row.team_id]) map[row.team_id] = [];
      if (!map[row.team_id].includes(name)) map[row.team_id].push(name);
    });
    setTeamCoachMap(map);
  };

  const handleInlineUpdate = async (playerId, field, value) => {
    const player = rosterPlayers.find(p => p.id === playerId);
    const profileId = player?.player_profiles?.[0]?.id;
    if (!profileId) return;
    const { error } = await supabase.from('player_profiles').update({ [field]: value }).eq('id', profileId);
    if (!error) {
      setRosterPlayers(prev => prev.map(p =>
        p.id === playerId ? { ...p, player_profiles: [{ ...p.player_profiles[0], [field]: value }] } : p
      ));
    }
  };

  const handleEditSave = async () => {
    const profileId = editingPlayer?.player_profiles?.[0]?.id;
    if (!profileId) return;
    const { error } = await supabase.from('player_profiles').update({
      position: editForm.position || null,
      jersey_number: editForm.jersey_number || null,
      grade: editForm.grade || null,
      bats: editForm.bats || null,
      throws: editForm.throws || null,
    }).eq('id', profileId);
    if (!error) {
      fetchRosterPlayers();
      setEditingPlayer(null);
    }
  };

  const splitName = (fullName) => {
    const parts = (fullName || '').trim().split(/\s+/);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
  };

  const getTrainer = (player) => {
    const teamIds = (player.team_members || []).map(tm => tm.team_id);
    const names = [];
    teamIds.forEach(tid => {
      if (teamCoachMap[tid]) names.push(...teamCoachMap[tid]);
    });
    return [...new Set(names)].join(', ') || '';
  };

  const allTrainerNames = [...new Set(Object.values(teamCoachMap).flat())].sort();
  const allTeamNames = [...new Set(
    rosterPlayers.flatMap(p => (p.team_members || []).map(tm => tm.teams?.name).filter(Boolean))
  )].sort();

  const displayPlayers = rosterPlayers.filter(p => {
    const profile = p.player_profiles?.[0] || {};
    const teamNames = (p.team_members || []).map(tm => tm.teams?.name).filter(Boolean);
    const trainerName = getTrainer(p);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!p.full_name.toLowerCase().includes(q)) return false;
    }
    if (filterTeam !== 'All' && !teamNames.includes(filterTeam)) return false;
    if (filterTrainer !== 'All' && !trainerName.includes(filterTrainer)) return false;
    if (filterProgram !== 'All' && profile.program !== filterProgram) return false;
    if (filterLevel !== 'All' && profile.level !== filterLevel) return false;
    if (filterStatus !== 'All' && profile.status !== filterStatus) return false;
    if (filterSubStatus !== 'All' && (profile.sub_status || '') !== filterSubStatus) return false;
    return true;
  });

  const filterSelectClass = "w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-gray-700";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading athletes...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-3xl font-bold text-gray-900">Manage Athletes</h2>
            <span className="bg-orange-500 text-white px-3 py-1 rounded-lg text-sm font-bold">
              {rosterPlayers.length}
            </span>
          </div>
          <p className="text-gray-600 mt-1">View and manage athlete roster</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th colSpan={2} className="px-3 py-2 text-left">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search for an Athlete..."
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
                  <select value={filterTrainer} onChange={(e) => setFilterTrainer(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {allTrainerNames.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {PROGRAM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {LEVEL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {statusOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterSubStatus} onChange={(e) => setFilterSubStatus(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {SUB_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2"></th>
              </tr>
              <tr className="border-b border-gray-200 bg-white">
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">First Name</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Last Name</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Team</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Trainer</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Program</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Level</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Sub Status</th>
                <th className="py-3 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {displayPlayers.map(player => {
                const profile = player.player_profiles?.[0] || {};
                const { firstName, lastName } = splitName(player.full_name);
                const teamNames = (player.team_members || []).map(tm => tm.teams?.name).filter(Boolean);
                const trainerName = getTrainer(player);

                return (
                  <tr key={player.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3">
                      <button
                        onClick={() => onNavigateToProfile && onNavigateToProfile(player.id)}
                        className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {firstName}
                      </button>
                    </td>
                    <td className="py-3 px-3 font-semibold text-gray-900">{lastName}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{teamNames.join(', ') || '—'}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{trainerName || '—'}</td>
                    <td className="py-3 px-3">
                      <select
                        value={profile.program || ''}
                        onChange={(e) => handleInlineUpdate(player.id, 'program', e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      >
                        <option value="">—</option>
                        {PROGRAM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadgeSelect
                        value={profile.level}
                        options={LEVEL_OPTIONS}
                        colors={LEVEL_COLORS}
                        onChange={(val) => handleInlineUpdate(player.id, 'level', val)}
                        isAdmin={false}
                      />
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadgeSelect
                        value={profile.status}
                        options={statusOptions}
                        colors={STATUS_COLORS}
                        onChange={(val) => handleInlineUpdate(player.id, 'status', val)}
                        onAddOption={addStatusOption}
                        isAdmin={isAdmin}
                      />
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={profile.sub_status || ''}
                        onChange={(e) => handleInlineUpdate(player.id, 'sub_status', e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      >
                        <option value="">—</option>
                        {SUB_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <button
                        onClick={() => {
                          setEditingPlayer(player);
                          setEditForm({
                            position: profile.position || '',
                            jersey_number: profile.jersey_number || '',
                            grade: profile.grade || '',
                            bats: profile.bats || '',
                            throws: profile.throws || '',
                          });
                        }}
                        className="text-gray-500 hover:text-blue-600 transition"
                        title="Edit info"
                      >
                        <Edit2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {displayPlayers.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Users size={40} className="mx-auto mb-3 text-gray-300" />
              <p>No athletes found matching your filters.</p>
            </div>
          )}
        </div>
      </div>

      {editingPlayer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="border-b border-gray-200 p-6 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Edit Player Info</h3>
              <button onClick={() => setEditingPlayer(null)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
                <input type="text" value={editForm.position} onChange={(e) => setEditForm({...editForm, position: e.target.value})} placeholder="e.g., SS, RHP" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Jersey Number</label>
                <input type="text" value={editForm.jersey_number} onChange={(e) => setEditForm({...editForm, jersey_number: e.target.value})} placeholder="e.g., 7" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
                <input type="text" value={editForm.grade} onChange={(e) => setEditForm({...editForm, grade: e.target.value})} placeholder="e.g., Senior, 2026" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bats</label>
                  <select value={editForm.bats} onChange={(e) => setEditForm({...editForm, bats: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">—</option><option value="R">R</option><option value="L">L</option><option value="S">S</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Throws</label>
                  <select value={editForm.throws} onChange={(e) => setEditForm({...editForm, throws: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">—</option><option value="R">R</option><option value="L">L</option>
                  </select>
                </div>
              </div>
              <div className="flex space-x-3 pt-2">
                <button onClick={() => setEditingPlayer(null)} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 transition">Cancel</button>
                <button onClick={handleEditSave} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 transition">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
