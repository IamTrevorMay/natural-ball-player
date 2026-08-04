import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Layers, Users, Plus, Trash2, X, GripVertical } from 'lucide-react';
import { formatUserError } from './errorMessage';

// #219: Training Groups management. Staff (admin/coach) separate the Naturals
// teams from training groups and bulk-place a whole team's athletes into a
// group by dragging a team card onto the group — no re-entering rosters.
// Training groups are just teams with team_type = 'training'; the same
// team_members table backs both, so an athlete can be on a Naturals team AND
// in any number of training groups.
const TEAM_MIME = 'application/x-team-id';

export default function TrainingGroups({ userId, userRole, onNavigateToProfile }) {
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [membersByTeam, setMembersByTeam] = useState({});
  const [dragOverColumn, setDragOverColumn] = useState(false);
  const [flash, setFlash] = useState(null); // { type: 'success'|'error', text }
  const [busyGroupId, setBusyGroupId] = useState(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', age_group: '' });

  const flashMsg = (type, text) => {
    setFlash({ type, text });
    setTimeout(() => setFlash(null), 4000);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: teamRows, error: teamErr }, { data: memberRows, error: memErr }] = await Promise.all([
        supabase.from('teams').select('id, name, team_type, age_group, description').order('name'),
        supabase
          .from('team_members')
          .select('id, team_id, user_id, role, users:user_id(id, full_name, role)')
          .order('created_at'),
      ]);
      if (teamErr) throw teamErr;
      if (memErr) throw memErr;
      setTeams(teamRows || []);
      const grouped = {};
      (memberRows || []).forEach(m => {
        if (!m.team_id) return;
        (grouped[m.team_id] = grouped[m.team_id] || []).push(m);
      });
      setMembersByTeam(grouped);
    } catch (err) {
      flashMsg('error', formatUserError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (userRole !== 'admin' && userRole !== 'coach') {
    return <div className="p-6 text-gray-600">Training Groups is available to coaches and admins.</div>;
  }

  const isTraining = (t) => (t.team_type || 'team') === 'training';
  const naturalsTeams = teams.filter(t => !isTraining(t));
  const trainingGroups = teams.filter(isTraining);

  // Players only (drop a team's athletes, not its coaches) into a group.
  const playersOf = (teamId) =>
    (membersByTeam[teamId] || []).filter(m => (m.users?.role || m.role) === 'player');

  // #243: moving a team to the Groups side converts the team itself into a
  // training group (team_type='training'). Its roster comes along via the shared
  // team_members table, and it leaves the Teams column — no rows are copied and
  // nothing is deleted (deleting would cascade the team's games/prospects/programs).
  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOverColumn(false);
    const sourceTeamId = e.dataTransfer.getData(TEAM_MIME);
    if (!sourceTeamId) return;
    const sourceTeam = teams.find(t => t.id === sourceTeamId);
    if (!sourceTeam || isTraining(sourceTeam)) return; // already a group
    const sourceName = sourceTeam.name || 'team';

    setBusyGroupId(sourceTeamId);
    try {
      const { error } = await supabase.from('teams').update({ team_type: 'training' }).eq('id', sourceTeamId);
      if (error) throw error;
      await fetchAll();
      flashMsg('success', `Moved ${sourceName} to Training Groups.`);
    } catch (err) {
      flashMsg('error', formatUserError(err));
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleRemoveMember = async (group, member) => {
    if (!window.confirm(`Remove ${member.users?.full_name || 'this athlete'} from ${group.name}?`)) return;
    try {
      const { error } = await supabase.from('team_members').delete().eq('id', member.id);
      if (error) throw error;
      await fetchAll();
    } catch (err) {
      flashMsg('error', formatUserError(err));
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    const name = newGroup.name.trim();
    if (!name) return;
    try {
      const { error } = await supabase.from('teams').insert({
        name,
        team_type: 'training',
        age_group: newGroup.age_group.trim() || null,
      });
      if (error) throw error;
      setNewGroup({ name: '', age_group: '' });
      setShowNewGroup(false);
      await fetchAll();
      flashMsg('success', `Created training group "${name}".`);
    } catch (err) {
      flashMsg('error', formatUserError(err));
    }
  };

  const handleDeleteGroup = async (group) => {
    const count = (membersByTeam[group.id] || []).length;
    if (!window.confirm(`Delete training group "${group.name}"${count ? ` and its ${count} membership${count === 1 ? '' : 's'}` : ''}? Athletes stay on their other teams.`)) return;
    try {
      await supabase.from('team_members').delete().eq('team_id', group.id);
      const { error } = await supabase.from('teams').delete().eq('id', group.id);
      if (error) throw error;
      await fetchAll();
      flashMsg('success', `Deleted "${group.name}".`);
    } catch (err) {
      flashMsg('error', formatUserError(err));
    }
  };

  if (loading) {
    return <div className="p-6 text-gray-500">Loading training groups…</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <Layers size={24} className="mr-2 text-blue-600" />
          Training Groups
        </h1>
        <button
          onClick={() => setShowNewGroup(s => !s)}
          className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Plus size={16} />
          <span>New Group</span>
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Drag a team from the left onto a training group to add all of its athletes — no re-entering rosters.
      </p>

      {flash && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${flash.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {flash.text}
        </div>
      )}

      {showNewGroup && (
        <form onSubmit={handleCreateGroup} className="mb-4 flex flex-wrap items-end gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Group name</label>
            <input
              autoFocus
              value={newGroup.name}
              onChange={(e) => setNewGroup(g => ({ ...g, name: e.target.value }))}
              placeholder="e.g. NBP 14u Training Group"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-28">
            <label className="block text-xs font-medium text-gray-600 mb-1">Age group</label>
            <input
              value={newGroup.age_group}
              onChange={(e) => setNewGroup(g => ({ ...g, age_group: e.target.value }))}
              placeholder="14u"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Create</button>
          <button type="button" onClick={() => { setShowNewGroup(false); setNewGroup({ name: '', age_group: '' }); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Teams (drag sources) */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Teams</h2>
          {naturalsTeams.length === 0 ? (
            <p className="text-sm text-gray-400">No teams yet.</p>
          ) : (
            <div className="space-y-2">
              {naturalsTeams.map(team => {
                const count = playersOf(team.id).length;
                return (
                  <div
                    key={team.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TEAM_MIME, team.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2.5 shadow-sm cursor-grab active:cursor-grabbing hover:border-blue-300 transition"
                  >
                    <GripVertical size={16} className="text-gray-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 text-sm truncate">{team.name}</div>
                      {team.age_group && <div className="text-xs text-gray-400">{team.age_group}</div>}
                    </div>
                    <span className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                      <Users size={13} /> {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Training groups — the whole column is a drop target (#243): dropping a
            team here converts it into a training group. */}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(TEAM_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOverColumn(true);
            }
          }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverColumn(false); }}
          onDrop={handleDrop}
          className={`rounded-lg transition ${dragOverColumn ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
        >
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Training Groups</h2>
          {trainingGroups.length === 0 ? (
            <div className={`text-sm rounded-md px-3 py-6 text-center border border-dashed transition ${dragOverColumn ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-400'}`}>
              Drag a team here to make it a training group, or click “New Group”.
            </div>
          ) : (
            <div className="space-y-3">
              {trainingGroups.map(group => {
                const members = membersByTeam[group.id] || [];
                return (
                  <div
                    key={group.id}
                    className="rounded-lg border-2 border-gray-200 bg-white transition p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">{group.name}</div>
                        <div className="text-xs text-gray-400">
                          {group.age_group ? `${group.age_group} · ` : ''}{members.length} athlete{members.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteGroup(group)}
                        title="Delete training group"
                        className="p-1.5 text-gray-300 hover:text-red-500 transition shrink-0"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {members.length === 0 ? (
                      <div className="text-xs rounded-md px-3 py-4 text-center text-gray-400 border border-dashed border-gray-200">
                        No athletes in this group yet.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {members.map(m => (
                          <span key={m.id} className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-2.5 pr-1 py-1 text-xs text-gray-700">
                            <button
                              type="button"
                              onClick={() => onNavigateToProfile && m.user_id && onNavigateToProfile(m.user_id)}
                              className="hover:text-blue-600 hover:underline truncate max-w-[140px]"
                            >
                              {m.users?.full_name || 'Unknown'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(group, m)}
                              title="Remove from group"
                              className="text-gray-400 hover:text-red-500"
                            >
                              <X size={13} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
