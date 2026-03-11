import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Plus, Users, X, Edit2, Save, Trash2, UserPlus, ChevronRight, Search, ChevronDown } from 'lucide-react';

const PROGRAM_OPTIONS = ['Pitching', 'Hitting', 'Pitching/Hitting', 'Strength', 'Academy', 'Rehab', 'No Program'];
const LEVEL_OPTIONS = ['Independent', 'Affiliate', 'High School', 'Professional', 'College', 'Youth', 'Pro - D', 'Pro - ND', '9U', '10U', '11U', '12U', '13U', '14U', '15U', '16U', '17U', '18U', 'AAA', 'AA', 'A+', 'A', 'MLB', 'Complex', 'NPB', 'KBO', 'MiLB', 'No Level'];
const STATUS_OPTIONS = ['On-Site', 'Remote', 'Active', 'Inactive', 'Archived'];

const LEVEL_COLORS = {
  'Professional': 'bg-teal-600 text-white',
  'High School': 'bg-orange-500 text-white',
  'College': 'bg-amber-500 text-white',
  'Youth': 'bg-yellow-500 text-white',
  'Independent': 'bg-blue-500 text-white',
  'Affiliate': 'bg-indigo-500 text-white',
  'MiLB': 'bg-emerald-500 text-white',
  'MLB': 'bg-red-600 text-white',
};

const STATUS_COLORS = {
  'Active': 'bg-green-500 text-white',
  'Remote': 'bg-orange-500 text-white',
  'Inactive': 'bg-gray-500 text-white',
  'On-Site': 'bg-blue-500 text-white',
  'Archived': 'bg-red-500 text-white',
};

export default function AdminSettings({ userId, userRole }) {
  const [activeTab, setActiveTab] = useState('users');
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showAssignRole, setShowAssignRole] = useState(false);
  const [loading, setLoading] = useState(true);

  const coaches = users.filter(u => u.role === 'coach');

  useEffect(() => {
    fetchTeams();
    fetchUsers();
  }, []);

  const fetchTeams = async () => {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error fetching teams:', error);
    } else {
      setTeams(data);
    }
    setLoading(false);
  };

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('users')
      .select(`
        *,
        player_profiles(*),
        team_members(
          team_id,
          teams(name)
        )
      `)
      .order('full_name');

    if (error) {
      console.error('Error fetching users:', error);
    } else {
      setUsers(data);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Admin Settings</h2>
          <p className="text-gray-600 mt-1">Manage users, teams, and organization settings</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            <button
              onClick={() => setActiveTab('users')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'users'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Athletes ({users.filter(u => u.role === 'player').length})
            </button>
            <button
              onClick={() => setActiveTab('teams')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'teams'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Teams ({teams.length})
            </button>
            <button
              onClick={() => setActiveTab('coaches')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'coaches'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Coaches ({coaches.length})
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'users' && (
            <UsersTab
              users={users}
              teams={teams}
              coaches={coaches}
              showCreateUser={showCreateUser}
              setShowCreateUser={setShowCreateUser}
              refreshUsers={fetchUsers}
              userId={userId}
            />
          )}
          {activeTab === 'teams' && (
            <TeamsTab
              teams={teams}
              users={users}
              showCreateTeam={showCreateTeam}
              setShowCreateTeam={setShowCreateTeam}
              refreshTeams={fetchTeams}
              refreshUsers={fetchUsers}
            />
          )}
          {activeTab === 'coaches' && (
            <CoachesTab
              coaches={coaches}
              users={users}
              showAssignRole={showAssignRole}
              setShowAssignRole={setShowAssignRole}
              refreshUsers={fetchUsers}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// COACHES TAB
// ============================================

function CoachesTab({ coaches, users, showAssignRole, setShowAssignRole, refreshUsers }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCoaches = coaches.filter(c => {
    const q = searchQuery.toLowerCase();
    return c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">All Coaches</h3>
        <button
          onClick={() => setShowAssignRole(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
        >
          <Plus size={18} />
          <span>Assign Coach Role</span>
        </button>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search coaches by name or email..."
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      {filteredCoaches.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Users size={48} className="mx-auto mb-4 text-gray-300" />
          <p>{searchQuery ? 'No coaches match your search.' : 'No coaches yet. Assign the coach role to a user to get started.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredCoaches.map(coach => (
            <CoachCard key={coach.id} coach={coach} refreshUsers={refreshUsers} />
          ))}
        </div>
      )}

      {showAssignRole && (
        <AssignRoleModal
          users={users}
          onClose={() => setShowAssignRole(false)}
          onSuccess={() => {
            setShowAssignRole(false);
            refreshUsers();
          }}
        />
      )}
    </div>
  );
}

function CoachCard({ coach, refreshUsers }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(coach.title || '');
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleRemoveCoach = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('users')
      .update({ role: 'player', title: null })
      .eq('id', coach.id);

    if (error) {
      console.error('Error removing coach:', error);
      alert('Error removing coach: ' + error.message);
    } else {
      refreshUsers();
    }
    setSaving(false);
    setConfirmRemove(false);
  };

  const handleSaveTitle = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('users')
      .update({ title: title || null })
      .eq('id', coach.id);

    if (error) {
      console.error('Error updating title:', error);
      alert('Error updating title: ' + error.message);
    } else {
      await refreshUsers();
      setEditingTitle(false);
    }
    setSaving(false);
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
            {coach.full_name.charAt(0)}
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">{coach.full_name}</h4>
            <p className="text-sm text-gray-600">{coach.email}</p>
            {/* Title editing */}
            <div className="flex items-center mt-1">
              {editingTitle ? (
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Head Coach, Pitching Coach"
                    className="text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTitle();
                      if (e.key === 'Escape') { setEditingTitle(false); setTitle(coach.title || ''); }
                    }}
                  />
                  <button
                    onClick={handleSaveTitle}
                    disabled={saving}
                    className="text-green-600 hover:text-green-700"
                  >
                    <Save size={16} />
                  </button>
                  <button
                    onClick={() => { setEditingTitle(false); setTitle(coach.title || ''); }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">
                    {coach.title || 'No title set'}
                  </span>
                  <button
                    onClick={() => setEditingTitle(true)}
                    className="text-gray-400 hover:text-blue-600"
                  >
                    <Edit2 size={14} />
                  </button>
                </div>
              )}
            </div>
            {coach.team_members && coach.team_members.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Teams: {coach.team_members.map(tm => tm.teams?.name).filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            coach
          </span>
          {confirmRemove ? (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-red-600">Demote to player?</span>
              <button
                onClick={handleRemoveCoach}
                disabled={saving}
                className="text-red-600 hover:text-red-700 text-xs font-medium"
              >
                {saving ? '...' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirmRemove(false)}
                className="text-gray-400 hover:text-gray-600 text-xs font-medium"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              className="text-gray-400 hover:text-red-600 transition"
              title="Remove coach role"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignRoleModal({ users, onClose, onSuccess }) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [targetRole, setTargetRole] = useState('coach');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setLoading(true);
    setError('');

    try {
      const updateData = { role: targetRole };
      if (targetRole === 'coach') {
        updateData.title = title || null;
      } else {
        updateData.title = null;
      }

      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', selectedUserId);

      if (updateError) throw updateError;

      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedUser = users.find(u => u.id === selectedUserId);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Assign Role</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select User *
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Choose a user...</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.full_name} ({user.email}) - {user.role}
                </option>
              ))}
            </select>
          </div>

          {selectedUser && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="text-gray-600">
                Current role: <span className="font-medium text-gray-900">{selectedUser.role}</span>
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Role *
            </label>
            <div className="space-y-2">
              {['player', 'coach', 'admin'].map(role => (
                <label key={role} className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="targetRole"
                    value={role}
                    checked={targetRole === role}
                    onChange={(e) => setTargetRole(e.target.value)}
                    className="text-blue-600"
                  />
                  <span className="capitalize text-gray-900">{role}</span>
                </label>
              ))}
            </div>
          </div>

          {targetRole === 'coach' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Coach Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Head Coach, Pitching Coach, Hitting Instructor"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedUserId}
              className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Assign Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// MANAGE ATHLETES TAB
// ============================================

function UsersTab({ users, teams, coaches, showCreateUser, setShowCreateUser, refreshUsers, userId }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterTrainer, setFilterTrainer] = useState('All');
  const [filterProgram, setFilterProgram] = useState('All');
  const [filterLevel, setFilterLevel] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSubStatus, setFilterSubStatus] = useState('All');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Only athletes (players)
  const athletes = users.filter(u => u.role === 'player');

  // Build team -> coaches map
  const teamCoachMap = {};
  (coaches || []).forEach(coach => {
    (coach.team_members || []).forEach(tm => {
      if (!teamCoachMap[tm.team_id]) teamCoachMap[tm.team_id] = [];
      if (!teamCoachMap[tm.team_id].includes(coach.full_name)) {
        teamCoachMap[tm.team_id].push(coach.full_name);
      }
    });
  });

  const allTrainerNames = [...new Set(Object.values(teamCoachMap).flat())].sort();
  const allTeamNames = [...new Set(teams.map(t => t.name))].sort();

  const getProfile = (user) => {
    const pp = user.player_profiles;
    if (Array.isArray(pp)) return pp[0] || {};
    if (pp && typeof pp === 'object') return pp;
    return {};
  };

  const getTeamNames = (user) => {
    return (user.team_members || []).map(tm => tm.teams?.name).filter(Boolean);
  };

  const getTrainer = (user) => {
    const teamIds = (user.team_members || []).map(tm => tm.team_id);
    const trainerNames = [];
    teamIds.forEach(tid => {
      if (teamCoachMap[tid]) trainerNames.push(...teamCoachMap[tid]);
    });
    return [...new Set(trainerNames)].join(', ') || '';
  };

  const splitName = (fullName) => {
    const parts = (fullName || '').trim().split(/\s+/);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
  };

  const filteredAthletes = athletes.filter(u => {
    const profile = getProfile(u);
    const teamNames = getTeamNames(u);
    const trainerName = getTrainer(u);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!u.full_name.toLowerCase().includes(q)) return false;
    }
    if (filterTeam !== 'All' && !teamNames.includes(filterTeam)) return false;
    if (filterTrainer !== 'All' && !trainerName.includes(filterTrainer)) return false;
    if (filterProgram !== 'All' && profile.program !== filterProgram) return false;
    if (filterLevel !== 'All' && profile.level !== filterLevel) return false;
    if (filterStatus !== 'All' && profile.status !== filterStatus) return false;
    if (filterSubStatus !== 'All' && (profile.sub_status || '') !== filterSubStatus) return false;
    return true;
  });

  const handleInlineUpdate = async (user, field, value) => {
    const profile = getProfile(user);
    if (!profile.id) return;
    const { error } = await supabase.from('player_profiles').update({ [field]: value }).eq('id', profile.id);
    if (!error) refreshUsers();
  };

  const handleDeleteUser = async (user) => {
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        'https://cjilkqzifyhssbsiqgfu.supabase.co/functions/v1/delete-user',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqaWxrcXppZnloc3Nic2lxZ2Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NzM0NjMsImV4cCI6MjA4NjE0OTQ2M30.sZH3suieH6Y4PHHb_rSbVS8zPMs-Uy20_rdt51Tfw3c',
          },
          body: JSON.stringify({ user_id: user.id }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete auth user');
      const { error } = await supabase.from('users').delete().eq('id', user.id);
      if (error) throw error;
      refreshUsers();
    } catch (err) {
      console.error('Error deleting user:', err);
      alert('Error deleting user: ' + err.message);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const filterSelectClass = "w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-gray-700";

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <h3 className="text-2xl font-bold text-gray-900">Manage Athletes</h3>
          <span className="bg-orange-500 text-white px-3 py-1 rounded-lg text-sm font-bold">
            {athletes.length}
          </span>
        </div>
        <button
          onClick={() => setShowCreateUser(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
        >
          <Plus size={18} />
          <span>Create Athlete</span>
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
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
                  {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th className="px-2 py-2">
                <select value={filterSubStatus} onChange={(e) => setFilterSubStatus(e.target.value)} className={filterSelectClass}>
                  <option value="All">All</option>
                  {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th className="px-2 py-2"></th>
            </tr>
            {/* Column Headers */}
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
            {filteredAthletes.map(athlete => {
              const profile = getProfile(athlete);
              const { firstName, lastName } = splitName(athlete.full_name);
              const teamNames = getTeamNames(athlete);
              const trainerName = getTrainer(athlete);

              return (
                <tr key={athlete.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-3 font-medium text-gray-900">{firstName}</td>
                  <td className="py-3 px-3 font-semibold text-gray-900">{lastName}</td>
                  <td className="py-3 px-3 text-gray-600 text-xs">{teamNames.join(', ') || '—'}</td>
                  <td className="py-3 px-3 text-gray-600 text-xs">{trainerName || '—'}</td>
                  <td className="py-3 px-3">
                    <select
                      value={profile.program || ''}
                      onChange={(e) => handleInlineUpdate(athlete, 'program', e.target.value)}
                      className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                    >
                      <option value="">—</option>
                      {PROGRAM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="py-3 px-3">
                    <BadgeSelect
                      value={profile.level}
                      options={LEVEL_OPTIONS}
                      colors={LEVEL_COLORS}
                      onChange={(val) => handleInlineUpdate(athlete, 'level', val)}
                      placeholder="—"
                    />
                  </td>
                  <td className="py-3 px-3">
                    <BadgeSelect
                      value={profile.status}
                      options={STATUS_OPTIONS}
                      colors={STATUS_COLORS}
                      onChange={(val) => handleInlineUpdate(athlete, 'status', val)}
                      placeholder="—"
                    />
                  </td>
                  <td className="py-3 px-3">
                    <BadgeSelect
                      value={profile.sub_status}
                      options={STATUS_OPTIONS}
                      colors={STATUS_COLORS}
                      onChange={(val) => handleInlineUpdate(athlete, 'sub_status', val)}
                      placeholder="—"
                    />
                  </td>
                  <td className="py-3 px-2">
                    {athlete.id !== userId && (
                      confirmDelete === athlete.id ? (
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => handleDeleteUser(athlete)}
                            disabled={deleting}
                            className="text-red-600 hover:text-red-700 text-xs font-medium"
                          >
                            {deleting ? '...' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-gray-500 hover:text-gray-700 text-xs"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(athlete.id)}
                          className="text-gray-400 hover:text-red-600 transition"
                          title="Delete athlete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredAthletes.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500">
                  No athletes found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreateUser && (
        <CreateUserModal
          teams={teams}
          onClose={() => setShowCreateUser(false)}
          onSuccess={() => {
            setShowCreateUser(false);
            refreshUsers();
          }}
        />
      )}
    </div>
  );
}


function CreateUserModal({ teams, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'player',
    phone: '',
    height: '',
    weight: '',
    team_id: '',
    // Player-specific fields
    jersey_number: '',
    position: '',
    grade: '',
    bats: 'Right',
    throws: 'Right'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Save admin session before signUp (signUp switches the active session)
      const { data: { session: adminSession } } = await supabase.auth.getSession();

      // 1. Create auth user using signUp
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.full_name,
            role: formData.role
          }
        }
      });

      if (authError) throw authError;

      // Restore admin session immediately so the app doesn't redirect
      if (adminSession) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        });
      }

      // 2. Insert into users table
      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: formData.email,
          full_name: formData.full_name,
          role: formData.role,
          phone: formData.phone || null,
          height: formData.height || null,
          weight: formData.weight || null
        });

      if (userError) throw userError;

      // 3. If player, create player profile
      if (formData.role === 'player') {
        const { error: profileError } = await supabase
          .from('player_profiles')
          .insert({
            user_id: authData.user.id,
            jersey_number: formData.jersey_number || null,
            position: formData.position || null,
            grade: formData.grade || null,
            bats: formData.bats,
            throws: formData.throws
          });

        if (profileError) throw profileError;
      }

      // 4. If team selected, add to team
      if (formData.team_id) {
        const { error: teamError } = await supabase
          .from('team_members')
          .insert({
            team_id: formData.team_id,
            user_id: authData.user.id,
            role: formData.role === 'admin' ? 'coach' : formData.role
          });

        if (teamError) throw teamError;
      }

      alert('User created successfully! They will need to verify their email before logging in.');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Create New User</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded text-sm">
            <strong>Note:</strong> User will receive a confirmation email and must verify before logging in. For testing, you can manually confirm users in Supabase Authentication dashboard.
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={formData.full_name}
                onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email *
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password *
              </label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Role *
              </label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="player">Player</option>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Height
              </label>
              <input
                type="text"
                placeholder="e.g., 6'2&quot;, 72 in"
                value={formData.height}
                onChange={(e) => setFormData({...formData, height: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Weight
              </label>
              <input
                type="text"
                placeholder="e.g., 185 lbs"
                value={formData.weight}
                onChange={(e) => setFormData({...formData, weight: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assign to Team
              </label>
              <select
                value={formData.team_id}
                onChange={(e) => setFormData({...formData, team_id: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No team</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          </div>

          {formData.role === 'player' && (
            <>
              <div className="pt-4 border-t border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-4">Player Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Jersey Number
                    </label>
                    <input
                      type="text"
                      value={formData.jersey_number}
                      onChange={(e) => setFormData({...formData, jersey_number: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Position
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., SS, P, OF"
                      value={formData.position}
                      onChange={(e) => setFormData({...formData, position: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Grade
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., 8th, 10th"
                      value={formData.grade}
                      onChange={(e) => setFormData({...formData, grade: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bats
                    </label>
                    <select
                      value={formData.bats}
                      onChange={(e) => setFormData({...formData, bats: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Right">Right</option>
                      <option value="Left">Left</option>
                      <option value="Switch">Switch</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Throws
                    </label>
                    <select
                      value={formData.throws}
                      onChange={(e) => setFormData({...formData, throws: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Right">Right</option>
                      <option value="Left">Left</option>
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TeamsTab({ teams, users, showCreateTeam, setShowCreateTeam, refreshTeams, refreshUsers }) {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTeams = teams.filter(t => {
    const q = searchQuery.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">All Teams</h3>
        <button
          onClick={() => setShowCreateTeam(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
        >
          <Plus size={18} />
          <span>Create Team</span>
        </button>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search teams by name or description..."
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTeams.map(team => (
          <div
            key={team.id}
            onClick={() => setSelectedTeam(team)}
            className="bg-gray-50 rounded-lg p-6 hover:bg-gray-100 transition cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-xl font-semibold text-gray-900">{team.name}</h4>
                {team.description && (
                  <p className="text-sm text-gray-600 mt-1">{team.description}</p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Created {new Date(team.created_at).toLocaleDateString()}
                </p>
              </div>
              <ChevronRight className="text-gray-400 mt-1" size={20} />
            </div>
          </div>
        ))}
      </div>

      {showCreateTeam && (
        <CreateTeamModal
          onClose={() => setShowCreateTeam(false)}
          onSuccess={() => {
            setShowCreateTeam(false);
            refreshTeams();
          }}
        />
      )}

      {selectedTeam && (
        <TeamDetailModal
          team={selectedTeam}
          users={users}
          onClose={() => setSelectedTeam(null)}
          onRefresh={() => {
            refreshTeams();
            refreshUsers();
          }}
        />
      )}
    </div>
  );
}

function TeamDetailModal({ team, users, onClose, onRefresh }) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description || '');
  const [editing, setEditing] = useState(false);
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState('player');
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const memberDropdownRef = useRef(null);

  const fetchMembers = async () => {
    const { data, error } = await supabase
      .from('team_members')
      .select('*, users(id, full_name, email, role)')
      .eq('team_id', team.id);

    if (error) {
      console.error('Error fetching members:', error);
    } else {
      setMembers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMembers();
  }, [team.id]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (memberDropdownRef.current && !memberDropdownRef.current.contains(e.target)) {
        setShowMemberDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const memberUserIds = new Set(members.map(m => m.user_id));
  const availableUsers = users.filter(u => !memberUserIds.has(u.id));
  const filteredAvailableUsers = availableUsers.filter(u => {
    const q = memberSearch.toLowerCase();
    if (!q) return true;
    return u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const handleSaveDetails = async () => {
    setSaving(true);
    setError('');
    const { error: updateError } = await supabase
      .from('teams')
      .update({ name, description: description || null })
      .eq('id', team.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setEditing(false);
      onRefresh();
    }
    setSaving(false);
  };

  const handleAddMember = async () => {
    if (!addUserId) return;
    setAdding(true);
    setError('');

    const { error: insertError } = await supabase
      .from('team_members')
      .insert({
        team_id: team.id,
        user_id: addUserId,
        role: addRole,
      });

    if (insertError) {
      setError(insertError.message);
    } else {
      setAddUserId('');
      setMemberSearch('');
      fetchMembers();
      onRefresh();
    }
    setAdding(false);
  };

  const handleRemoveMember = async (memberId) => {
    const { error: deleteError } = await supabase
      .from('team_members')
      .delete()
      .eq('id', memberId);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      fetchMembers();
      onRefresh();
    }
  };

  const handleDeleteTeam = async () => {
    setSaving(true);
    // Delete team members first, then team
    await supabase.from('team_members').delete().eq('team_id', team.id);
    const { error: deleteError } = await supabase
      .from('teams')
      .delete()
      .eq('id', team.id);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
    } else {
      onRefresh();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Team Details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          {/* Team Name & Description */}
          <div>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Team Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows="2"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={handleSaveDetails}
                    disabled={saving || !name.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-1"
                  >
                    <Save size={14} />
                    <span>{saving ? 'Saving...' : 'Save'}</span>
                  </button>
                  <button
                    onClick={() => { setEditing(false); setName(team.name); setDescription(team.description || ''); }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">{team.name}</h4>
                  {team.description && <p className="text-sm text-gray-600 mt-1">{team.description}</p>}
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="text-gray-400 hover:text-blue-600 ml-2"
                >
                  <Edit2 size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Members List */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Members ({members.length})
            </h4>
            {loading ? (
              <p className="text-gray-500 text-sm">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">No members yet</p>
            ) : (
              <div className="space-y-2">
                {members.map(member => (
                  <div key={member.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        {member.users?.full_name?.charAt(0) || '?'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{member.users?.full_name}</p>
                        <p className="text-xs text-gray-500">{member.users?.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                        {member.role}
                      </span>
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="text-gray-400 hover:text-red-600 transition"
                        title="Remove from team"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Member */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Add Member
            </h4>
            <div className="flex space-x-2">
              <div className="flex-1 relative" ref={memberDropdownRef}>
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => {
                    setMemberSearch(e.target.value);
                    setAddUserId('');
                    setShowMemberDropdown(true);
                  }}
                  onFocus={() => setShowMemberDropdown(true)}
                  placeholder="Search users..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showMemberDropdown && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredAvailableUsers.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No users found</div>
                    ) : (
                      filteredAvailableUsers.map(u => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setAddUserId(u.id);
                            setMemberSearch(u.full_name);
                            setShowMemberDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition flex items-center justify-between"
                        >
                          <span>{u.full_name}</span>
                          <span className="text-xs text-gray-400">{u.email}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="player">Player</option>
                <option value="coach">Coach</option>
              </select>
              <button
                onClick={handleAddMember}
                disabled={!addUserId || adding}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-1"
              >
                <UserPlus size={14} />
                <span>{adding ? '...' : 'Add'}</span>
              </button>
            </div>
          </div>

          {/* Delete Team */}
          <div className="pt-4 border-t border-gray-200">
            {confirmDelete ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-700 mb-3">
                  Delete <strong>{team.name}</strong>? This will remove all members from the team. This cannot be undone.
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={handleDeleteTeam}
                    disabled={saving}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
                  >
                    {saving ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-red-600 hover:text-red-700 text-sm font-medium flex items-center space-x-1"
              >
                <Trash2 size={14} />
                <span>Delete Team</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateTeamModal({ onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: insertError } = await supabase
      .from('teams')
      .insert({
        name,
        description: description || null
      });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Create New Team</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Team Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g., 14U, 16U"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
