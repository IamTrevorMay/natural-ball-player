import React, { useState, useEffect, useRef } from 'react';
import { supabase, supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { Plus, Users, X, Edit2, Save, Trash2, UserPlus, ChevronRight, Search, CheckCircle, XCircle } from 'lucide-react';

async function deleteAuthUser(userId) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${supabaseUrl}/functions/v1/delete-user`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ user_id: userId }),
    }
  );
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Failed to delete auth user');
  return result;
}

export default function AdminSettings({ userId, userRole, onNavigateToProfile }) {
  const [activeTab, setActiveTab] = useState('users');
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showAssignRole, setShowAssignRole] = useState(false);
  const [showCreateProspect, setShowCreateProspect] = useState(false);
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [waiverSignatures, setWaiverSignatures] = useState([]);

  const coaches = users.filter(u => u.role === 'coach');
  const players = users.filter(u => u.role === 'player');

  const fetchProspects = async () => {
    const { data, error } = await supabase
      .from('prospects')
      .select('*')
      .order('full_name');
    if (error) console.error('Error fetching prospects:', error);
    else setProspects(data || []);
  };

  const fetchWaiverSignatures = async () => {
    const { data, error } = await supabase
      .from('waiver_signatures')
      .select('*');
    if (error) console.error('Error fetching waiver signatures:', error);
    else setWaiverSignatures(data || []);
  };

  useEffect(() => {
    fetchTeams();
    fetchUsers();
    fetchProspects();
    fetchWaiverSignatures();
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
              Users ({users.length})
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
            <button
              onClick={() => setActiveTab('prospects')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'prospects'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Prospects
            </button>
            <button
              onClick={() => setActiveTab('codes')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'codes'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Codes
            </button>
            <button
              onClick={() => setActiveTab('inventory')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'inventory'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Inventory
            </button>
            <button
              onClick={() => setActiveTab('waivers')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'waivers'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Waivers ({waiverSignatures.length}/{players.length} signed)
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'users' && (
            <UsersTab
              users={users}
              teams={teams}
              showCreateUser={showCreateUser}
              setShowCreateUser={setShowCreateUser}
              refreshUsers={fetchUsers}
              userId={userId}
              onNavigateToProfile={onNavigateToProfile}
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
          {activeTab === 'prospects' && (
            <ProspectsTab
              prospects={prospects}
              teams={teams}
              showCreateProspect={showCreateProspect}
              setShowCreateProspect={setShowCreateProspect}
              refreshProspects={fetchProspects}
            />
          )}
          {activeTab === 'codes' && (
            <CodesTab />
          )}
          {activeTab === 'inventory' && (
            <InventoryTab />
          )}
          {activeTab === 'waivers' && (
            <WaiversTab players={players} waiverSignatures={waiverSignatures} />
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
  const [filterStatus, setFilterStatus] = useState('all');

  const getCoachStatus = (c) => c.coach_status || 'Active';

  const statusCounts = { Active: 0, Inactive: 0, Archived: 0 };
  coaches.forEach(c => {
    const s = getCoachStatus(c);
    if (s === 'Inactive') statusCounts.Inactive++;
    else if (s === 'Archived') statusCounts.Archived++;
    else statusCounts.Active++;
  });

  const filteredCoaches = coaches.filter(c => {
    const q = searchQuery.toLowerCase();
    if (!c.full_name.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false;
    if (filterStatus !== 'all') {
      const status = getCoachStatus(c);
      if (filterStatus === 'Active' && status !== 'Active') return false;
      if (filterStatus === 'Inactive' && status !== 'Inactive') return false;
      if (filterStatus === 'Archived' && status !== 'Archived') return false;
    }
    return true;
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search coaches by name or email..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          <option value="Active">Active ({statusCounts.Active})</option>
          <option value="Inactive">Inactive ({statusCounts.Inactive})</option>
          <option value="Archived">Archived ({statusCounts.Archived})</option>
        </select>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active {statusCounts.Active}</span>
        <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">Inactive {statusCounts.Inactive}</span>
        <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Archived {statusCounts.Archived}</span>
        <span className="ml-auto text-gray-400">{filteredCoaches.length} shown</span>
      </div>

      {filteredCoaches.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Users size={48} className="mx-auto mb-4 text-gray-300" />
          <p>{searchQuery || filterStatus !== 'all' ? 'No coaches match your filters.' : 'No coaches yet. Assign the coach role to a user to get started.'}</p>
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
// USERS TAB
// ============================================

function UsersTab({ users, teams, showCreateUser, setShowCreateUser, refreshUsers, userId, onNavigateToProfile }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const getUserStatus = (u) => {
    if (u.role === 'player') {
      const pp = Array.isArray(u.player_profiles) ? u.player_profiles[0] : u.player_profiles;
      return pp?.status || 'Active';
    }
    if (u.role === 'coach') return u.coach_status || 'Active';
    return 'Active';
  };

  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    if (!u.full_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (filterStatus !== 'all') {
      const status = getUserStatus(u);
      if (filterStatus === 'Active' && status !== 'Active') return false;
      if (filterStatus === 'Inactive' && status !== 'Inactive') return false;
      if (filterStatus === 'Archived' && status !== 'Archived') return false;
    }
    return true;
  });

  const statusCounts = { Active: 0, Inactive: 0, Archived: 0 };
  const roleFiltered = users.filter(u => filterRole === 'all' || u.role === filterRole);
  roleFiltered.forEach(u => {
    const s = getUserStatus(u);
    if (s === 'Inactive') statusCounts.Inactive++;
    else if (s === 'Archived') statusCounts.Archived++;
    else statusCounts.Active++;
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">All Users</h3>
        <button
          onClick={() => setShowCreateUser(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
        >
          <Plus size={18} />
          <span>Create User</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users by name or email..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="coach">Coach</option>
          <option value="player">Player</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          <option value="Active">Active ({statusCounts.Active})</option>
          <option value="Inactive">Inactive ({statusCounts.Inactive})</option>
          <option value="Archived">Archived ({statusCounts.Archived})</option>
        </select>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active {statusCounts.Active}</span>
        <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">Inactive {statusCounts.Inactive}</span>
        <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Archived {statusCounts.Archived}</span>
        <span className="ml-auto text-gray-400">{filteredUsers.length} shown</span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredUsers.map(user => (
          <UserCard key={user.id} user={user} teams={teams} refreshUsers={refreshUsers} userId={userId} onNavigateToProfile={onNavigateToProfile} />
        ))}
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

function UserCard({ user, teams, refreshUsers, userId, onNavigateToProfile }) {
  const [showEdit, setShowEdit] = useState(false);

  const getRoleBadgeColor = (role) => {
    switch(role) {
      case 'admin': return 'bg-purple-100 text-purple-700';
      case 'coach': return 'bg-blue-100 text-blue-700';
      case 'player': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <>
      <div
        onClick={() => setShowEdit(true)}
        className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
              {user.full_name.charAt(0)}
            </div>
            <div>
              <h4
                className="font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onNavigateToProfile && onNavigateToProfile(user.id); }}
              >
                {user.full_name}
              </h4>
              <p className="text-sm text-gray-600">{user.email}</p>
              {user.team_members && user.team_members.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Teams: {user.team_members.map(tm => tm.teams.name).join(', ')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
              {user.role}
            </span>
            <Edit2 size={16} className="text-gray-400" />
          </div>
        </div>
      </div>

      {showEdit && (
        <EditUserModal
          user={user}
          teams={teams}
          userId={userId}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false);
            refreshUsers();
          }}
        />
      )}
    </>
  );
}

function EditUserModal({ user, teams, userId, onClose, onSuccess }) {
  const profile = Array.isArray(user.player_profiles) ? user.player_profiles[0] : user.player_profiles || null;
  const currentTeamIds = (user.team_members || []).map(tm => tm.team_id);

  const [formData, setFormData] = useState({
    full_name: user.full_name || '',
    email: user.email || '',
    phone: user.phone || '',
    role: user.role || 'player',
    height: user.height || '',
    weight: user.weight || '',
    jersey_number: profile?.jersey_number || '',
    position: profile?.position || '',
    grade: profile?.grade || '',
    bats: profile?.bats || 'Right',
    throws: profile?.throws || 'Right',
  });
  const [assignedTeamIds, setAssignedTeamIds] = useState(currentTeamIds);
  const [addTeamId, setAddTeamId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const availableTeams = teams.filter(t => !assignedTeamIds.includes(t.id));

  const handleAddTeam = () => {
    if (addTeamId && !assignedTeamIds.includes(addTeamId)) {
      setAssignedTeamIds([...assignedTeamIds, addTeamId]);
      setAddTeamId('');
    }
  };

  const handleRemoveTeam = (teamId) => {
    setAssignedTeamIds(assignedTeamIds.filter(id => id !== teamId));
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Update users table
      const { error: userError } = await supabase
        .from('users')
        .update({
          full_name: formData.full_name,
          email: formData.email,
          phone: formData.phone || null,
          role: formData.role,
          height: formData.height || null,
          weight: formData.weight || null,
        })
        .eq('id', user.id);
      if (userError) throw userError;

      // 2. Update player_profiles if player
      if (formData.role === 'player' && profile?.id) {
        const { error: profileError } = await supabase
          .from('player_profiles')
          .update({
            jersey_number: formData.jersey_number || null,
            position: formData.position || null,
            grade: formData.grade || null,
            bats: formData.bats,
            throws: formData.throws,
          })
          .eq('id', profile.id);
        if (profileError) throw profileError;
      } else if (formData.role === 'player' && !profile) {
        // Create player profile if switching to player role
        const { error: profileError } = await supabase
          .from('player_profiles')
          .insert({
            user_id: user.id,
            jersey_number: formData.jersey_number || null,
            position: formData.position || null,
            grade: formData.grade || null,
            bats: formData.bats,
            throws: formData.throws,
          });
        if (profileError) throw profileError;
      }

      // 3. Sync team assignments
      const teamsToAdd = assignedTeamIds.filter(id => !currentTeamIds.includes(id));
      const teamsToRemove = currentTeamIds.filter(id => !assignedTeamIds.includes(id));

      for (const teamId of teamsToRemove) {
        await supabase.from('team_members').delete().eq('user_id', user.id).eq('team_id', teamId);
      }
      for (const teamId of teamsToAdd) {
        await supabase.from('team_members').insert({
          team_id: teamId,
          user_id: user.id,
          role: formData.role === 'admin' ? 'coach' : formData.role,
        });
      }

      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    setDeleting(true);
    try {
      await deleteAuthUser(user.id);
      const { error } = await supabase.from('users').delete().eq('id', user.id);
      if (error) throw error;
      onSuccess();
    } catch (err) {
      console.error('Error deleting user:', err);
      alert('Error deleting user: ' + err.message);
      setDeleting(false);
    }
  };

  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Edit User</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
              <input
                type="text"
                value={formData.full_name}
                onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value})}
                className={inputClass}
              >
                <option value="player">Player</option>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Height</label>
              <input
                type="text"
                placeholder="e.g., 6'2&quot;, 72 in"
                value={formData.height}
                onChange={(e) => setFormData({...formData, height: e.target.value})}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Weight</label>
              <input
                type="text"
                placeholder="e.g., 185 lbs"
                value={formData.weight}
                onChange={(e) => setFormData({...formData, weight: e.target.value})}
                className={inputClass}
              />
            </div>
          </div>

          {/* Team Assignments */}
          <div className="pt-4 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">Team Assignments</label>
            {assignedTeamIds.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {assignedTeamIds.map(tid => {
                  const team = teams.find(t => t.id === tid);
                  return (
                    <span key={tid} className="inline-flex items-center bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm">
                      {team?.name || 'Unknown'}
                      <button onClick={() => handleRemoveTeam(tid)} className="ml-2 text-blue-400 hover:text-red-600">
                        <X size={14} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {availableTeams.length > 0 && (
              <div className="flex items-center space-x-2">
                <select
                  value={addTeamId}
                  onChange={(e) => setAddTeamId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">Add to team...</option>
                  {availableTeams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddTeam}
                  disabled={!addTeamId}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50"
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Player-specific fields */}
          {formData.role === 'player' && (
            <div className="pt-4 border-t border-gray-200">
              <h4 className="font-semibold text-gray-900 mb-4">Player Details</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Jersey Number</label>
                  <input
                    type="text"
                    value={formData.jersey_number}
                    onChange={(e) => setFormData({...formData, jersey_number: e.target.value})}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                  <input
                    type="text"
                    placeholder="e.g., SS, P, OF"
                    value={formData.position}
                    onChange={(e) => setFormData({...formData, position: e.target.value})}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Grade</label>
                  <input
                    type="text"
                    placeholder="e.g., 8th, 10th"
                    value={formData.grade}
                    onChange={(e) => setFormData({...formData, grade: e.target.value})}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bats</label>
                  <select
                    value={formData.bats}
                    onChange={(e) => setFormData({...formData, bats: e.target.value})}
                    className={inputClass}
                  >
                    <option value="Right">Right</option>
                    <option value="Left">Left</option>
                    <option value="Switch">Switch</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Throws</label>
                  <select
                    value={formData.throws}
                    onChange={(e) => setFormData({...formData, throws: e.target.value})}
                    className={inputClass}
                  >
                    <option value="Right">Right</option>
                    <option value="Left">Left</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            {user.id !== userId ? (
              confirmDelete ? (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-red-600">Delete this user?</span>
                  <button
                    onClick={handleDeleteUser}
                    disabled={deleting}
                    className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-red-600 hover:text-red-700 text-sm font-medium flex items-center space-x-1"
                >
                  <Trash2 size={14} />
                  <span>Delete User</span>
                </button>
              )
            ) : <div />}

            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
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
      let { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.full_name,
            role: formData.role
          }
        }
      });

      // Handle "User already registered" — clean up orphaned records and retry
      if (authError && authError.message.includes('User already registered')) {
        // Restore admin session before cleanup
        if (adminSession) {
          await supabase.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: adminSession.refresh_token,
          });
        }

        // Look up in public.users to get the ID for the edge function
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('email', formData.email)
          .single();

        if (existingUser) {
          // Delete auth user via edge function, then public.users row
          await deleteAuthUser(existingUser.id);
          await supabase.from('users').delete().eq('id', existingUser.id);

          // Re-save admin session (may have been refreshed)
          const { data: { session: freshSession } } = await supabase.auth.getSession();

          // Retry signUp
          const retry = await supabase.auth.signUp({
            email: formData.email,
            password: formData.password,
            options: {
              data: {
                full_name: formData.full_name,
                role: formData.role
              }
            }
          });

          if (retry.error) throw retry.error;
          authData = retry.data;
          authError = null;

          // Restore admin session after retry
          if (freshSession) {
            await supabase.auth.setSession({
              access_token: freshSession.access_token,
              refresh_token: freshSession.refresh_token,
            });
          }
        } else {
          throw new Error(
            'This email exists in auth but not in the users table. Please delete it manually from the Supabase Authentication dashboard, then try again.'
          );
        }
      } else if (authError) {
        throw authError;
      } else {
        // Restore admin session immediately so the app doesn't redirect
        if (adminSession) {
          await supabase.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: adminSession.refresh_token,
          });
        }
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

  // Prospects state
  const [teamProspects, setTeamProspects] = useState([]);
  const [allProspects, setAllProspects] = useState([]);
  const [prospectSearch, setProspectSearch] = useState('');
  const [showProspectDropdown, setShowProspectDropdown] = useState(false);
  const [addProspectId, setAddProspectId] = useState('');
  const [addingProspect, setAddingProspect] = useState(false);
  const prospectDropdownRef = useRef(null);

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

  const fetchAllProspects = async () => {
    const { data } = await supabase.from('prospects').select('*').order('full_name');
    setAllProspects(data || []);
  };

  const fetchTeamProspects = async () => {
    const { data } = await supabase
      .from('team_prospects')
      .select('*, prospects(id, full_name, email, position, grade)')
      .eq('team_id', team.id);
    setTeamProspects(data || []);
  };

  useEffect(() => {
    fetchMembers();
    fetchAllProspects();
    fetchTeamProspects();
  }, [team.id]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (memberDropdownRef.current && !memberDropdownRef.current.contains(e.target)) {
        setShowMemberDropdown(false);
      }
      if (prospectDropdownRef.current && !prospectDropdownRef.current.contains(e.target)) {
        setShowProspectDropdown(false);
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

  const teamProspectIds = new Set(teamProspects.map(tp => tp.prospect_id));
  const availableProspects = allProspects.filter(p => !teamProspectIds.has(p.id));
  const filteredAvailableProspects = availableProspects.filter(p => {
    const q = prospectSearch.toLowerCase();
    if (!q) return true;
    return (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
  });

  const handleAddProspect = async () => {
    if (!addProspectId) return;
    setAddingProspect(true);
    setError('');
    const { error: insertError } = await supabase.from('team_prospects').insert({
      team_id: team.id,
      prospect_id: addProspectId,
    });
    if (insertError) setError(insertError.message);
    else {
      setAddProspectId('');
      setProspectSearch('');
      fetchTeamProspects();
    }
    setAddingProspect(false);
  };

  const handleRemoveProspect = async (tpId) => {
    const { error: deleteError } = await supabase.from('team_prospects').delete().eq('id', tpId);
    if (deleteError) setError(deleteError.message);
    else fetchTeamProspects();
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
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Members Column */}
            <div>
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
              <div className="mt-4">
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
            </div>

            {/* Prospects Column */}
            <div>
              <div>
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Prospects ({teamProspects.length})
                </h4>
                {teamProspects.length === 0 ? (
                  <p className="text-gray-500 text-sm py-4 text-center">No prospects yet</p>
                ) : (
                  <div className="space-y-2">
                    {teamProspects.map(tp => (
                      <div key={tp.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                            {tp.prospects?.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{tp.prospects?.full_name}</p>
                            <p className="text-xs text-gray-500">{tp.prospects?.email || tp.prospects?.position || ''}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveProspect(tp.id)}
                          className="text-gray-400 hover:text-red-600 transition"
                          title="Remove prospect"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Prospect */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Add Prospect
                </h4>
                <div className="flex space-x-2">
                  <div className="flex-1 relative" ref={prospectDropdownRef}>
                    <input
                      type="text"
                      value={prospectSearch}
                      onChange={(e) => {
                        setProspectSearch(e.target.value);
                        setAddProspectId('');
                        setShowProspectDropdown(true);
                      }}
                      onFocus={() => setShowProspectDropdown(true)}
                      placeholder="Search prospects..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {showProspectDropdown && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredAvailableProspects.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">No prospects found</div>
                        ) : (
                          filteredAvailableProspects.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setAddProspectId(p.id);
                                setProspectSearch(p.full_name);
                                setShowProspectDropdown(false);
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 transition flex items-center justify-between"
                            >
                              <span>{p.full_name}</span>
                              <span className="text-xs text-gray-400">{p.email || p.position || ''}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleAddProspect}
                    disabled={!addProspectId || addingProspect}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50 flex items-center space-x-1"
                  >
                    <UserPlus size={14} />
                    <span>{addingProspect ? '...' : 'Add'}</span>
                  </button>
                </div>
              </div>
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

// ============================================
// PROSPECTS TAB
// ============================================

function ProspectsTab({ prospects, teams, showCreateProspect, setShowCreateProspect, refreshProspects }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProspect, setEditingProspect] = useState(null);

  const filteredProspects = prospects.filter(p => {
    const q = searchQuery.toLowerCase();
    return (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
  });

  const handleDeleteProspect = async (id) => {
    if (!window.confirm('Delete this prospect?')) return;
    const { error } = await supabase.from('prospects').delete().eq('id', id);
    if (error) alert('Error deleting prospect: ' + error.message);
    else refreshProspects();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">All Prospects</h3>
        <button
          onClick={() => setShowCreateProspect(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
        >
          <Plus size={18} />
          <span>Create Prospect</span>
        </button>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search prospects by name or email..."
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      {filteredProspects.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Users size={48} className="mx-auto mb-4 text-gray-300" />
          <p>{searchQuery ? 'No prospects match your search.' : 'No prospects yet. Create one to get started.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProspects.map(prospect => (
            <div key={prospect.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                  {(prospect.full_name || '?').charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{prospect.full_name}</p>
                  <p className="text-xs text-gray-500">{prospect.email || 'No email'}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                {prospect.position && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{prospect.position}</span>
                )}
                {prospect.grade && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">{prospect.grade}</span>
                )}
                <button onClick={() => setEditingProspect(prospect)} className="text-gray-400 hover:text-blue-600 transition">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDeleteProspect(prospect.id)} className="text-gray-400 hover:text-red-600 transition">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateProspect && (
        <CreateProspectModal
          teams={teams}
          onClose={() => setShowCreateProspect(false)}
          onSuccess={() => {
            setShowCreateProspect(false);
            refreshProspects();
          }}
        />
      )}

      {editingProspect && (
        <EditProspectModal
          prospect={editingProspect}
          teams={teams}
          onClose={() => setEditingProspect(null)}
          onSuccess={() => {
            setEditingProspect(null);
            refreshProspects();
          }}
        />
      )}
    </div>
  );
}

function CreateProspectModal({ teams, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    height: '',
    weight: '',
    team_id: '',
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
      const { error: insertError } = await supabase.from('prospects').insert({
        full_name: formData.full_name,
        email: formData.email || null,
        phone: formData.phone || null,
        height: formData.height || null,
        weight: formData.weight || null,
        team_id: formData.team_id || null,
        jersey_number: formData.jersey_number || null,
        position: formData.position || null,
        grade: formData.grade || null,
        bats: formData.bats,
        throws: formData.throws,
      });
      if (insertError) throw insertError;
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Create Prospect</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
              <input type="text" required value={formData.full_name} onChange={(e) => setFormData({...formData, full_name: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
              <input type="tel" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Height</label>
              <input type="text" placeholder="e.g., 6'2&quot;, 72 in" value={formData.height} onChange={(e) => setFormData({...formData, height: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Weight</label>
              <input type="text" placeholder="e.g., 185 lbs" value={formData.weight} onChange={(e) => setFormData({...formData, weight: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assign to Team</label>
              <select value={formData.team_id} onChange={(e) => setFormData({...formData, team_id: e.target.value})} className={inputClass}>
                <option value="">No team</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-4">Player Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Jersey Number</label>
                <input type="text" value={formData.jersey_number} onChange={(e) => setFormData({...formData, jersey_number: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                <input type="text" placeholder="e.g., SS, P, OF" value={formData.position} onChange={(e) => setFormData({...formData, position: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Grade</label>
                <input type="text" placeholder="e.g., 8th, 10th" value={formData.grade} onChange={(e) => setFormData({...formData, grade: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Bats</label>
                <select value={formData.bats} onChange={(e) => setFormData({...formData, bats: e.target.value})} className={inputClass}>
                  <option value="Right">Right</option>
                  <option value="Left">Left</option>
                  <option value="Switch">Switch</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Throws</label>
                <select value={formData.throws} onChange={(e) => setFormData({...formData, throws: e.target.value})} className={inputClass}>
                  <option value="Right">Right</option>
                  <option value="Left">Left</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? 'Creating...' : 'Create Prospect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditProspectModal({ prospect, teams, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    full_name: prospect.full_name || '',
    email: prospect.email || '',
    phone: prospect.phone || '',
    height: prospect.height || '',
    weight: prospect.weight || '',
    team_id: prospect.team_id || '',
    jersey_number: prospect.jersey_number || '',
    position: prospect.position || '',
    grade: prospect.grade || '',
    bats: prospect.bats || 'Right',
    throws: prospect.throws || 'Right'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const { error: updateError } = await supabase.from('prospects').update({
        full_name: formData.full_name,
        email: formData.email || null,
        phone: formData.phone || null,
        height: formData.height || null,
        weight: formData.weight || null,
        team_id: formData.team_id || null,
        jersey_number: formData.jersey_number || null,
        position: formData.position || null,
        grade: formData.grade || null,
        bats: formData.bats,
        throws: formData.throws,
      }).eq('id', prospect.id);
      if (updateError) throw updateError;
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Edit Prospect</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
              <input type="text" required value={formData.full_name} onChange={(e) => setFormData({...formData, full_name: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
              <input type="tel" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Height</label>
              <input type="text" value={formData.height} onChange={(e) => setFormData({...formData, height: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Weight</label>
              <input type="text" value={formData.weight} onChange={(e) => setFormData({...formData, weight: e.target.value})} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assign to Team</label>
              <select value={formData.team_id} onChange={(e) => setFormData({...formData, team_id: e.target.value})} className={inputClass}>
                <option value="">No team</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-4">Player Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Jersey Number</label>
                <input type="text" value={formData.jersey_number} onChange={(e) => setFormData({...formData, jersey_number: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                <input type="text" value={formData.position} onChange={(e) => setFormData({...formData, position: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Grade</label>
                <input type="text" value={formData.grade} onChange={(e) => setFormData({...formData, grade: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Bats</label>
                <select value={formData.bats} onChange={(e) => setFormData({...formData, bats: e.target.value})} className={inputClass}>
                  <option value="Right">Right</option>
                  <option value="Left">Left</option>
                  <option value="Switch">Switch</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Throws</label>
                <select value={formData.throws} onChange={(e) => setFormData({...formData, throws: e.target.value})} className={inputClass}>
                  <option value="Right">Right</option>
                  <option value="Left">Left</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="button" onClick={handleSave} disabled={loading || !formData.full_name.trim()} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
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

// ============================================
// CODES TAB
// ============================================

function CodesTab() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchCodes(); }, []);

  const fetchCodes = async () => {
    const { data, error } = await supabase
      .from('discount_codes')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) console.error('Error fetching codes:', error);
    else setCodes(data || []);
    setLoading(false);
  };

  const addCode = async () => {
    const { data, error } = await supabase
      .from('discount_codes')
      .insert({ vendor: '', code: '' })
      .select()
      .single();
    if (error) { alert('Error adding code: ' + error.message); return; }
    setCodes([...codes, data]);
  };

  const updateCode = async (id, field, value) => {
    const { error } = await supabase
      .from('discount_codes')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error('Error updating code:', error); return; }
    setCodes(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const deleteCode = async (id) => {
    const { error } = await supabase.from('discount_codes').delete().eq('id', id);
    if (error) { console.error('Error deleting code:', error); return; }
    setCodes(prev => prev.filter(c => c.id !== id));
  };

  if (loading) return <div className="text-gray-600">Loading codes...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">Discount Codes</h3>
        <button
          onClick={addCode}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
        >
          <Plus size={18} />
          <span>Add Code</span>
        </button>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Vendor</th>
            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Code</th>
            <th className="py-3 px-4 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {codes.map(c => (
            <tr key={c.id} className="border-b border-gray-100">
              <td className="py-2 px-4">
                <input
                  type="text"
                  defaultValue={c.vendor}
                  onBlur={(e) => updateCode(c.id, 'vendor', e.target.value)}
                  placeholder="Vendor name"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </td>
              <td className="py-2 px-4">
                <input
                  type="text"
                  defaultValue={c.code}
                  onBlur={(e) => updateCode(c.id, 'code', e.target.value)}
                  placeholder="Discount code"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </td>
              <td className="py-2 px-4 text-center">
                <button onClick={() => deleteCode(c.id)} className="text-red-400 hover:text-red-600 transition">
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {codes.length === 0 && (
            <tr>
              <td colSpan={3} className="py-8 text-center text-gray-500">No codes yet. Click "Add Code" to create one.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// INVENTORY TAB
// ============================================

const INVENTORY_CATEGORIES = ['Socks', 'Belts', 'Hats', 'Shorts', 'Shirts', 'Jerseys', 'Sweatshirts', 'Long Sleeve', 'Pants'];

function InventoryTab() {
  const [items, setItems] = useState([]);
  const [threshold, setThreshold] = useState(5);
  const [settingsId, setSettingsId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchInventory(); }, []);

  const fetchInventory = async () => {
    const [{ data: itemData }, { data: settingsData }] = await Promise.all([
      supabase.from('inventory_items').select('*').order('category').order('item').order('color').order('size'),
      supabase.from('inventory_settings').select('*').limit(1).single(),
    ]);
    setItems(itemData || []);
    if (settingsData) {
      setThreshold(settingsData.low_stock_threshold);
      setSettingsId(settingsData.id);
    }
    setLoading(false);
  };

  const addRow = async () => {
    const { data, error } = await supabase
      .from('inventory_items')
      .insert({ category: '', item: '', color: '', size: '', qty_in_stock: 0, on_order: 0 })
      .select()
      .single();
    if (error) { alert('Error adding row: ' + error.message); return; }
    setItems([...items, data]);
  };

  const updateItem = async (id, field, value) => {
    const isNumber = field === 'qty_in_stock' || field === 'on_order';
    const val = isNumber ? (parseInt(value) || 0) : value;
    const { error } = await supabase
      .from('inventory_items')
      .update({ [field]: val, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error('Error updating item:', error); return; }
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i));
  };

  const deleteItem = async (id) => {
    const { error } = await supabase.from('inventory_items').delete().eq('id', id);
    if (error) { console.error('Error deleting item:', error); return; }
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const updateThreshold = async (value) => {
    const val = parseInt(value) || 0;
    setThreshold(val);
    if (settingsId) {
      await supabase.from('inventory_settings').update({ low_stock_threshold: val }).eq('id', settingsId);
    }
  };

  const getStatus = (qty) => {
    if (qty <= 0) return { label: 'OUT OF STOCK', color: 'bg-red-100 text-red-700' };
    if (qty <= threshold) return { label: 'LOW STOCK', color: 'bg-yellow-100 text-yellow-700' };
    return { label: 'OK', color: 'bg-green-100 text-green-700' };
  };

  // Summary metrics
  const totalSKUs = items.length;
  const totalInStock = items.reduce((sum, i) => sum + (i.qty_in_stock || 0), 0);
  const totalOnOrder = items.reduce((sum, i) => sum + (i.on_order || 0), 0);
  const totalExpected = totalInStock + totalOnOrder;
  const outOfStockCount = items.filter(i => (i.qty_in_stock || 0) <= 0).length;
  const lowStockCount = items.filter(i => (i.qty_in_stock || 0) > 0 && (i.qty_in_stock || 0) <= threshold).length;
  const okCount = items.filter(i => (i.qty_in_stock || 0) > threshold).length;

  // Stock by category
  const categoryStats = {};
  items.forEach(i => {
    const cat = i.category || 'Uncategorized';
    if (!categoryStats[cat]) categoryStats[cat] = { inStock: 0, onOrder: 0 };
    categoryStats[cat].inStock += i.qty_in_stock || 0;
    categoryStats[cat].onOrder += i.on_order || 0;
  });

  if (loading) return <div className="text-gray-600">Loading inventory...</div>;

  return (
    <div className="space-y-6">
      {/* Dashboard Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Key Metrics */}
        <div className="bg-gray-50 rounded-lg p-5">
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Key Metrics</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-gray-600">Total SKUs</span><span className="font-semibold text-gray-900">{totalSKUs}</span>
            <span className="text-gray-600">Total Units in Stock</span><span className="font-semibold text-gray-900">{totalInStock}</span>
            <span className="text-gray-600">Total Units On Order</span><span className="font-semibold text-gray-900">{totalOnOrder}</span>
            <span className="text-gray-600">Total Expected Stock</span><span className="font-semibold text-gray-900">{totalExpected}</span>
          </div>
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="inline-block w-3 h-3 rounded bg-red-400"></span>
              <span className="text-sm text-gray-700">Out of Stock: <strong>{outOfStockCount}</strong></span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-block w-3 h-3 rounded bg-yellow-400"></span>
              <span className="text-sm text-gray-700">Low Stock: <strong>{lowStockCount}</strong></span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-block w-3 h-3 rounded bg-green-400"></span>
              <span className="text-sm text-gray-700">OK: <strong>{okCount}</strong></span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-200">
            <label className="block text-xs text-gray-500 mb-1">Low Stock Threshold</label>
            <input
              type="number"
              min="0"
              value={threshold}
              onChange={(e) => updateThreshold(e.target.value)}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Stock by Category */}
        <div className="bg-gray-50 rounded-lg p-5">
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Stock by Category</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 font-semibold text-gray-700">Category</th>
                <th className="text-right py-1.5 font-semibold text-gray-700">In Stock</th>
                <th className="text-right py-1.5 font-semibold text-gray-700">On Order</th>
                <th className="text-right py-1.5 font-semibold text-gray-700">Expected</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(categoryStats).sort(([a], [b]) => a.localeCompare(b)).map(([cat, stats]) => (
                <tr key={cat} className="border-b border-gray-100">
                  <td className="py-1.5 text-gray-900">{cat}</td>
                  <td className="py-1.5 text-right text-gray-700">{stats.inStock}</td>
                  <td className="py-1.5 text-right text-gray-700">{stats.onOrder}</td>
                  <td className="py-1.5 text-right font-medium text-gray-900">{stats.inStock + stats.onOrder}</td>
                </tr>
              ))}
              {Object.keys(categoryStats).length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-gray-500">No data yet</td></tr>
              )}
              {Object.keys(categoryStats).length > 0 && (
                <tr className="font-semibold">
                  <td className="py-1.5 text-gray-900">TOTAL</td>
                  <td className="py-1.5 text-right text-gray-900">{totalInStock}</td>
                  <td className="py-1.5 text-right text-gray-900">{totalOnOrder}</td>
                  <td className="py-1.5 text-right text-gray-900">{totalExpected}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inventory Table */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">All Items</h3>
          <button
            onClick={addRow}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
          >
            <Plus size={18} />
            <span>Add Row</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-3 text-sm font-semibold text-gray-700">Category</th>
                <th className="text-left py-3 px-3 text-sm font-semibold text-gray-700">Item</th>
                <th className="text-left py-3 px-3 text-sm font-semibold text-gray-700">Color</th>
                <th className="text-left py-3 px-3 text-sm font-semibold text-gray-700">Size</th>
                <th className="text-right py-3 px-3 text-sm font-semibold text-gray-700">Qty in Stock</th>
                <th className="text-right py-3 px-3 text-sm font-semibold text-gray-700">On Order</th>
                <th className="text-right py-3 px-3 text-sm font-semibold text-gray-700">Expected Stock</th>
                <th className="text-center py-3 px-3 text-sm font-semibold text-gray-700">Status</th>
                <th className="py-3 px-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const expected = (item.qty_in_stock || 0) + (item.on_order || 0);
                const status = getStatus(item.qty_in_stock || 0);
                return (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2 px-3">
                      <select
                        defaultValue={item.category}
                        onChange={(e) => updateItem(item.id, 'category', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      >
                        <option value="">Select</option>
                        {INVENTORY_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input type="text" defaultValue={item.item} onBlur={(e) => updateItem(item.id, 'item', e.target.value)} placeholder="Item name" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="text" defaultValue={item.color} onBlur={(e) => updateItem(item.id, 'color', e.target.value)} placeholder="Color" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="text" defaultValue={item.size} onBlur={(e) => updateItem(item.id, 'size', e.target.value)} placeholder="Size" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min="0" defaultValue={item.qty_in_stock} onBlur={(e) => updateItem(item.id, 'qty_in_stock', e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 text-right" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min="0" defaultValue={item.on_order} onBlur={(e) => updateItem(item.id, 'on_order', e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 text-right" />
                    </td>
                    <td className="py-2 px-3 text-right text-sm font-medium text-gray-900">{expected}</td>
                    <td className="py-2 px-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${status.color}`}>{status.label}</span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button onClick={() => deleteItem(item.id)} className="text-red-400 hover:text-red-600 transition">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-500">No inventory items yet. Click "Add Row" to create one.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================
// WAIVERS TAB
// ============================================
function WaiversTab({ players, waiverSignatures }) {
  const waiverMap = {};
  waiverSignatures.forEach(w => { waiverMap[w.user_id] = w; });

  const sorted = [...players].sort((a, b) => {
    const aHas = waiverMap[a.id] ? 1 : 0;
    const bHas = waiverMap[b.id] ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas; // unsigned first
    return (a.full_name || '').localeCompare(b.full_name || '');
  });

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Waiver Status</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Player Name</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Email</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date Signed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(player => {
              const waiver = waiverMap[player.id];
              return (
                <tr key={player.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-900 font-medium">{player.full_name}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{player.email}</td>
                  <td className="py-3 px-4">
                    {waiver ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        <CheckCircle size={12} />
                        <span>Signed</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                        <XCircle size={12} />
                        <span>Unsigned</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {waiver ? new Date(waiver.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-gray-500">No players found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
