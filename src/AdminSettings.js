import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Plus, Users, X, Edit, Trash2, Upload, UserCog, UserMinus } from 'lucide-react';

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState('users');
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [loading, setLoading] = useState(true);

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
          id,
          team_id,
          role,
          teams(id, name)
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
            />
          )}
          {activeTab === 'teams' && (
            <TeamsTab 
              teams={teams}
              showCreateTeam={showCreateTeam}
              setShowCreateTeam={setShowCreateTeam}
              refreshTeams={fetchTeams}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function UsersTab({ users, teams, showCreateUser, setShowCreateUser, refreshUsers }) {
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

      <div className="grid grid-cols-1 gap-4">
        {users.map(user => (
          <UserCard key={user.id} user={user} teams={teams} refreshUsers={refreshUsers} />
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

function UserCard({ user, teams, refreshUsers }) {
  const [expanded, setExpanded] = useState(false);
  const [showManageTeams, setShowManageTeams] = useState(false);
  const [showChangeRole, setShowChangeRole] = useState(false);

  const getRoleBadgeColor = (role) => {
    switch(role) {
      case 'admin': return 'bg-purple-100 text-purple-700';
      case 'coach': return 'bg-blue-100 text-blue-700';
      case 'player': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const handleDeleteUser = async () => {
    if (!window.confirm(`Delete ${user.full_name}? This will remove all their data including stats, messages, and assignments.`)) return;
    
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', user.id);
    
    if (error) {
      alert('Error deleting user: ' + error.message);
    } else {
      alert('User deleted successfully');
      refreshUsers();
    }
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
            {user.full_name.charAt(0)}
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">{user.full_name}</h4>
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
          <button
            onClick={() => setShowManageTeams(true)}
            className="text-blue-600 hover:text-blue-800 p-2 rounded-lg hover:bg-blue-50 transition"
            title="Manage Teams"
          >
            <Users size={18} />
          </button>
          <button
            onClick={() => setShowChangeRole(true)}
            className="text-purple-600 hover:text-purple-800 p-2 rounded-lg hover:bg-purple-50 transition"
            title="Change Role"
          >
            <UserCog size={18} />
          </button>
          <button
            onClick={handleDeleteUser}
            className="text-red-600 hover:text-red-800 p-2 rounded-lg hover:bg-red-50 transition"
            title="Delete User"
          >
            <Trash2 size={18} />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-600 hover:text-gray-900"
          >
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Phone:</span>
              <span className="ml-2 text-gray-900">{user.phone || 'Not set'}</span>
            </div>
            <div>
              <span className="text-gray-600">Created:</span>
              <span className="ml-2 text-gray-900">
                {new Date(user.created_at).toLocaleDateString()}
              </span>
            </div>
            {user.player_profiles && user.player_profiles.length > 0 && (
              <>
                <div>
                  <span className="text-gray-600">Position:</span>
                  <span className="ml-2 text-gray-900">{user.player_profiles[0].position || 'Not set'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Number:</span>
                  <span className="ml-2 text-gray-900">{user.player_profiles[0].jersey_number || 'Not set'}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showManageTeams && (
        <ManageTeamsModal
          user={user}
          teams={teams}
          onClose={() => setShowManageTeams(false)}
          onSuccess={() => {
            setShowManageTeams(false);
            refreshUsers();
          }}
        />
      )}

      {showChangeRole && (
        <ChangeRoleModal
          user={user}
          onClose={() => setShowChangeRole(false)}
          onSuccess={() => {
            setShowChangeRole(false);
            refreshUsers();
          }}
        />
      )}
    </div>
  );
}

// ============================================
// MANAGE TEAMS MODAL
// ============================================

function ManageTeamsModal({ user, teams, onClose, onSuccess }) {
  const [selectedTeams, setSelectedTeams] = useState(
    user.team_members ? user.team_members.map(tm => ({ teamId: tm.team_id, role: tm.role, id: tm.id })) : []
  );
  const [loading, setLoading] = useState(false);

  const handleToggleTeam = (teamId) => {
    const existing = selectedTeams.find(t => t.teamId === teamId);
    if (existing) {
      setSelectedTeams(selectedTeams.filter(t => t.teamId !== teamId));
    } else {
      setSelectedTeams([...selectedTeams, { teamId, role: user.role === 'admin' ? 'coach' : user.role, id: null }]);
    }
  };

  const handleRoleChange = (teamId, newRole) => {
    setSelectedTeams(selectedTeams.map(t => 
      t.teamId === teamId ? { ...t, role: newRole } : t
    ));
  };

  const handleSave = async () => {
    setLoading(true);
    
    try {
      // Get current memberships
      const currentMemberships = user.team_members || [];
      const currentTeamIds = currentMemberships.map(tm => tm.team_id);
      const newTeamIds = selectedTeams.map(t => t.teamId);

      // Find teams to add
      const teamsToAdd = selectedTeams.filter(t => !currentTeamIds.includes(t.teamId));
      
      // Find teams to remove
      const teamsToRemove = currentMemberships.filter(tm => !newTeamIds.includes(tm.team_id));

      // Find teams where role changed
      const teamsToUpdate = selectedTeams.filter(t => {
        const current = currentMemberships.find(tm => tm.team_id === t.teamId);
        return current && current.role !== t.role;
      });

      // Add new team memberships
      if (teamsToAdd.length > 0) {
        const { error: addError } = await supabase
          .from('team_members')
          .insert(teamsToAdd.map(t => ({
            team_id: t.teamId,
            user_id: user.id,
            role: t.role
          })));
        
        if (addError) throw addError;
      }

      // Remove team memberships
      if (teamsToRemove.length > 0) {
        const { error: removeError } = await supabase
          .from('team_members')
          .delete()
          .in('id', teamsToRemove.map(tm => tm.id));
        
        if (removeError) throw removeError;
      }

      // Update roles
      for (const teamUpdate of teamsToUpdate) {
        const membership = currentMemberships.find(tm => tm.team_id === teamUpdate.teamId);
        const { error: updateError } = await supabase
          .from('team_members')
          .update({ role: teamUpdate.role })
          .eq('id', membership.id);
        
        if (updateError) throw updateError;
      }

      alert('Team assignments updated successfully!');
      onSuccess();
    } catch (error) {
      alert('Error updating teams: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Manage Teams</h3>
            <p className="text-sm text-gray-600 mt-1">{user.full_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">Select teams and assign role for each:</p>
          
          {teams.map(team => {
            const selected = selectedTeams.find(t => t.teamId === team.id);
            const isChecked = !!selected;

            return (
              <div key={team.id} className="border border-gray-200 rounded-lg p-4">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleTeam(team.id)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="font-medium text-gray-900">{team.name}</span>
                </label>

                {isChecked && (
                  <div className="mt-3 ml-7">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Role on this team:
                    </label>
                    <select
                      value={selected.role}
                      onChange={(e) => handleRoleChange(team.id, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="player">Player</option>
                      <option value="coach">Coach</option>
                    </select>
                  </div>
                )}
              </div>
            );
          })}

          {teams.length === 0 && (
            <p className="text-center text-gray-500 py-8">No teams available. Create a team first.</p>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 flex space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CHANGE ROLE MODAL
// ============================================

function ChangeRoleModal({ user, onClose, onSuccess }) {
  const [newRole, setNewRole] = useState(user.role);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (newRole === user.role) {
      alert('Role is already set to ' + newRole);
      return;
    }

    setLoading(true);

    try {
      // Update user role
      const { error: userError } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', user.id);

      if (userError) throw userError;

      // If changing to player, create player profile if it doesn't exist
      if (newRole === 'player' && (!user.player_profiles || user.player_profiles.length === 0)) {
        const { error: profileError } = await supabase
          .from('player_profiles')
          .insert({ user_id: user.id });

        if (profileError) throw profileError;
      }

      alert(`Role changed to ${newRole} successfully!`);
      onSuccess();
    } catch (error) {
      alert('Error changing role: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Change User Role</h3>
            <p className="text-sm text-gray-600 mt-1">{user.full_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Current Role: <span className="font-semibold capitalize">{user.role}</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Role *
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="player">Player</option>
              <option value="coach">Coach</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded text-sm">
            <strong>Note:</strong> Changing role to Player will create a player profile. Changing from Player may affect their stats and assignments.
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Changing...' : 'Change Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CREATE USER MODAL (unchanged from original)
// ============================================

function CreateUserModal({ teams, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'player',
    phone: '',
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

      // Wait a moment for the auth user to be created
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 2. Insert into users table
      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: formData.email,
          full_name: formData.full_name,
          role: formData.role,
          phone: formData.phone || null
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

// ============================================
// TEAMS TAB
// ============================================

function TeamsTab({ teams, showCreateTeam, setShowCreateTeam, refreshTeams }) {
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {teams.map(team => (
          <TeamCard key={team.id} team={team} refreshTeams={refreshTeams} />
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
    </div>
  );
}

function TeamCard({ team, refreshTeams }) {
  const [showEditTeam, setShowEditTeam] = useState(false);

  const handleDeleteTeam = async () => {
    if (!window.confirm(`Delete team "${team.name}"? This will remove all team assignments and team-related data.`)) return;

    const { error } = await supabase
      .from('teams')
      .delete()
      .eq('id', team.id);

    if (error) {
      alert('Error deleting team: ' + error.message);
    } else {
      alert('Team deleted successfully');
      refreshTeams();
    }
  };

  return (
    <>
      <div className="bg-gray-50 rounded-lg p-6 hover:bg-gray-100 transition">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-4 flex-1">
            {team.photo_url ? (
              <img
                src={team.photo_url}
                alt={team.name}
                className="w-16 h-16 rounded-lg object-cover"
              />
            ) : (
              <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center">
                <Users className="text-white" size={32} />
              </div>
            )}
            <div className="flex-1">
              <h4 className="text-xl font-semibold text-gray-900">{team.name}</h4>
              {team.description && (
                <p className="text-sm text-gray-600 mt-1">{team.description}</p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Created {new Date(team.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 ml-4">
            <button
              onClick={() => setShowEditTeam(true)}
              className="text-blue-600 hover:text-blue-800 p-2 rounded-lg hover:bg-blue-50 transition"
              title="Edit Team"
            >
              <Edit size={18} />
            </button>
            <button
              onClick={handleDeleteTeam}
              className="text-red-600 hover:text-red-800 p-2 rounded-lg hover:bg-red-50 transition"
              title="Delete Team"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {showEditTeam && (
        <EditTeamModal
          team={team}
          onClose={() => setShowEditTeam(false)}
          onSuccess={() => {
            setShowEditTeam(false);
            refreshTeams();
          }}
        />
      )}
    </>
  );
}

// ============================================
// EDIT TEAM MODAL
// ============================================

function EditTeamModal({ team, onClose, onSuccess }) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description || '');
  const [photoUrl, setPhotoUrl] = useState(team.photo_url || '');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    setUploading(true);
    
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${team.id}-${Date.now()}.${fileExt}`;
      const filePath = `team-photos/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      setPhotoUrl(publicUrl);
    } catch (err) {
      alert('Error uploading photo: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: updateError } = await supabase
      .from('teams')
      .update({
        name,
        description: description || null,
        photo_url: photoUrl || null
      })
      .eq('id', team.id);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
    } else {
      alert('Team updated successfully!');
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Edit Team</h3>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Team Photo
            </label>
            
            {photoUrl && (
              <div className="mb-3">
                <img
                  src={photoUrl}
                  alt="Team photo"
                  className="w-32 h-32 rounded-lg object-cover"
                />
              </div>
            )}

            <label className="cursor-pointer inline-flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
              <Upload size={18} />
              <span>{uploading ? 'Uploading...' : 'Upload Photo'}</span>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </div>

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
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// CREATE TEAM MODAL
// ============================================

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
