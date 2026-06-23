import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Users, Calendar, MessageSquare, User, Mail, Phone, Star, Plus, Trash2, Edit2, Save, X, UserPlus, Search, Radio } from 'lucide-react';
import EmailComposeModal from './EmailComposeModal';
import { formatUserError } from './errorMessage';

const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const mergeUniqueById = (rows = []) => Array.from(new Map(rows.map(row => [row.id, row])).values());

async function searchUsersByNameOrEmail(selectClause, rawTerm, limit = 20) {
  const term = rawTerm.trim();
  const [nameResult, emailResult] = await Promise.all([
    supabase
      .from('users')
      .select(selectClause)
      .ilike('full_name', `%${term}%`)
      .limit(limit),
    supabase
      .from('users')
      .select(selectClause)
      .ilike('email', `%${term}%`)
      .limit(limit),
  ]);

  if (nameResult.error) throw nameResult.error;
  if (emailResult.error) throw emailResult.error;

  return mergeUniqueById([...(nameResult.data || []), ...(emailResult.data || [])]).slice(0, limit);
}

export default function MyTeam({ userId, userRole, initialTeamId, onNavigateToProfile }) {
  const [loading, setLoading] = useState(true);
  const [teamData, setTeamData] = useState(null);
  const [roster, setRoster] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [recentAnnouncements, setRecentAnnouncements] = useState([]);
  const [activeTab, setActiveTab] = useState('roster');
  const [availableTeams, setAvailableTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [filterType, setFilterType] = useState('All');
  const [filterAge, setFilterAge] = useState('All');
  const [prospects, setProspects] = useState([]);

  const fetchProspects = async (teamId) => {
    try {
      const { data } = await supabase
        .from('prospects')
        .select('*, users:player_id(full_name, email)')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false });
      setProspects(data || []);
    } catch (err) {
      console.error('Error fetching prospects:', err);
    }
  };

  const handleProspectToggle = async (player) => {
    const existing = prospects.find(p => p.player_id === player.id);
    try {
      if (existing) {
        await supabase.from('prospects').delete().eq('id', existing.id);
      } else {
        const pos = (player.player_profile?.position || '').toUpperCase().trim();
        await supabase.from('prospects').insert({
          team_id: selectedTeamId,
          player_id: player.id,
          name: player.full_name,
          position: pos || null,
          positions: pos ? [pos] : [],
          added_by: userId,
        });
      }
      await fetchProspects(selectedTeamId);
    } catch (err) {
      console.error('Error toggling prospect:', err);
    }
  };

  const prospectPlayerIds = prospects.filter(p => p.player_id).map(p => p.player_id);

  // Phase 1: Fetch teams the user has access to
  useEffect(() => {
    fetchMyTeams();
  }, [userId]);

  // Phase 2: When a team is selected, fetch its details
  useEffect(() => {
    if (selectedTeamId) {
      fetchTeamDetails(selectedTeamId);
    }
  }, [selectedTeamId]);

  const fetchMyTeams = async () => {
    try {
      // Get user's team memberships
      const { data: memberships } = await supabase
        .from('team_members')
        .select('team_id, teams(*)')
        .eq('user_id', userId);

      const memberTeams = (memberships || []).map(m => m.teams).filter(Boolean);

      if (memberTeams.length >= 1) {
        setAvailableTeams(memberTeams);
        // Use initialTeamId if provided and valid, otherwise first team
        const target = initialTeamId && memberTeams.find(t => t.id === initialTeamId);
        setSelectedTeamId(target ? target.id : memberTeams[0].id);
        setLoading(false);
        return;
      }

      // 0 team memberships
      if (userRole === 'admin') {
        // Admin with no team membership — fetch ALL teams
        const { data: allTeams } = await supabase
          .from('teams')
          .select('*')
          .order('name');

        if (allTeams && allTeams.length > 0) {
          setAvailableTeams(allTeams);
          const target = initialTeamId && allTeams.find(t => t.id === initialTeamId);
          setSelectedTeamId(target ? target.id : allTeams[0].id);
        }
      }
      // Players/coaches with 0 teams fall through to "No Team" state
      setLoading(false);
    } catch (error) {
      console.error('Error fetching teams:', error);
      setLoading(false);
    }
  };

  const fetchTeamDetails = async (teamId) => {
    try {
      const team = availableTeams.find(t => t.id === teamId);
      if (team) setTeamData(team);

      // Get all team members in one query, then split by users.role
      const { data: allMembers } = await supabase
        .from('team_members')
        .select(`
          user_id,
          role,
          users(
            id,
            full_name,
            email,
            phone,
            role,
            player_profiles!player_profiles_user_id_fkey(
              jersey_number,
              position,
              grade,
              bats,
              throws
            )
          )
        `)
        .eq('team_id', teamId)
        .order('users(full_name)');

      if (allMembers) {
        const coachRows = [];
        const playerRows = [];
        for (const m of allMembers) {
          const userRole = m.users?.role;
          if (userRole === 'admin' || userRole === 'coach') {
            coachRows.push({ ...m.users, role: m.role });
          } else {
            playerRows.push({
              ...m.users,
              role: m.role,
              player_profile: m.users.player_profiles?.[0]
            });
          }
        }
        setCoaches(coachRows);
        setRoster(playerRows);
      }

      // CM1: also include legacy rows that only set the scalar team_id and
      // never populated the team_ids array.
      const { data: events } = await supabase
        .from('schedule_events')
        .select('*')
        .or(`team_id.eq.${teamId},team_ids.cs.{${teamId}}`)
        .gte('event_date', fmtLocalDate(new Date()))
        .order('event_date', { ascending: true })
        .limit(5);

      if (events) {
        setUpcomingEvents(events);
      }

      // Get recent team announcements
      const { data: announcements } = await supabase
        .from('conversations')
        .select(`
          id,
          title,
          created_at,
          messages(
            id,
            content,
            created_at
          )
        `)
        .eq('type', 'team_announcement')
        .eq('related_team_id', teamId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (announcements) {
        setRecentAnnouncements(announcements);
      }

      await fetchProspects(teamId);

    } catch (error) {
      console.error('Error fetching team data:', error);
    }
  };

  const teamTypes = [...new Set(availableTeams.map(t => t.team_type || 'team').filter(Boolean))].sort();
  const ageGroups = [...new Set(availableTeams.map(t => t.age_group).filter(Boolean))].sort();

  const filteredTeams = availableTeams.filter(t => {
    if (filterType !== 'All' && (t.team_type || 'team') !== filterType) return false;
    if (filterAge !== 'All' && (t.age_group || '') !== filterAge) return false;
    return true;
  });

  // Auto-select first filtered team if current selection is filtered out
  useEffect(() => {
    if (filteredTeams.length > 0 && !filteredTeams.find(t => t.id === selectedTeamId)) {
      setSelectedTeamId(filteredTeams[0].id);
    }
  }, [filterType, filterAge]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading team information...</p>
      </div>
    );
  }

  if (!teamData && !selectedTeamId) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <Users size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Team Assignment</h2>
        <p className="text-gray-600">You haven't been assigned to a team yet. Contact your coach.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      {availableTeams.length > 1 && (teamTypes.length > 1 || ageGroups.length > 0) && (
        <div className="bg-white rounded-lg shadow px-4 py-3 flex flex-wrap items-center gap-3">
          {teamTypes.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Type:</span>
              {['All', ...teamTypes].map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    filterType === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'All' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          )}
          {ageGroups.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Age:</span>
              {['All', ...ageGroups].map(a => (
                <button
                  key={a}
                  onClick={() => setFilterAge(a)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    filterAge === a
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Team Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div className="w-20 h-20 bg-white/20 rounded-lg flex items-center justify-center">
              <Users size={40} />
            </div>
            <div>
              <h1 className="text-4xl font-bold">{teamData?.name || 'Select a Team'}</h1>
              {teamData?.description && (
                <p className="text-blue-100 mt-2 text-lg">{teamData.description}</p>
              )}
              <div className="flex items-center space-x-4 mt-3 text-blue-100">
                <span className="flex items-center space-x-1">
                  <Users size={16} />
                  <span>{roster.length} Players</span>
                </span>
                <span>•</span>
                <span className="flex items-center space-x-1">
                  <User size={16} />
                  <span>{coaches.length} Coaches</span>
                </span>
              </div>
            </div>
          </div>
          {filteredTeams.length > 1 && (
            <select
              value={selectedTeamId || ''}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-white/20 text-white border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/50 appearance-none cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '36px' }}
            >
              {filteredTeams.map(t => (
                <option key={t.id} value={t.id} className="text-gray-900">{t.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {[
              { key: 'roster', label: 'Roster', icon: Users },
              { key: 'coaches', label: 'Coaches', icon: User },
              { key: 'schedule', label: 'Schedule', icon: Calendar },
              { key: 'announcements', label: 'Announcements', icon: MessageSquare },
              { key: 'prospects', label: 'Prospects', icon: Star },
              { key: 'game_changer', label: 'Game Changer', icon: Radio },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition flex items-center space-x-2 ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon size={18} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'roster' && <RosterTab roster={roster} coaches={coaches} prospectPlayerIds={prospectPlayerIds} userRole={userRole} onProspectToggle={handleProspectToggle} teamId={selectedTeamId} onRosterChange={() => fetchTeamDetails(selectedTeamId)} onNavigateToProfile={onNavigateToProfile} />}
          {activeTab === 'coaches' && <CoachesTab coaches={coaches} onNavigateToProfile={onNavigateToProfile} />}
          {activeTab === 'schedule' && <ScheduleTab events={upcomingEvents} />}
          {activeTab === 'announcements' && <AnnouncementsTab announcements={recentAnnouncements} />}
          {activeTab === 'prospects' && (
            <ProspectsTab teamId={teamData.id} userId={userId} userRole={userRole} roster={roster} prospects={prospects} onProspectsChange={() => fetchProspects(selectedTeamId)} />
          )}
          {activeTab === 'game_changer' && (
            <GameChangerTab teamId={teamData.id} userRole={userRole} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// ROSTER TAB
// ============================================

function RosterTab({ roster, coaches = [], prospectPlayerIds, userRole, onProspectToggle, teamId, onRosterChange, onNavigateToProfile }) {
  const [sortBy, setSortBy] = useState('name');
  const [filterPosition, setFilterPosition] = useState('all');
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [addRole, setAddRole] = useState('player');
  const [adding, setAdding] = useState(false);
  const searchTimerRef = useRef(null);

  const isStaff = userRole === 'admin' || userRole === 'coach';

  // Debounced member search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!memberSearch.trim() || memberSearch.trim().length < 2) {
      setMemberResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const existingIds = roster.map(p => p.id);
        const data = await searchUsersByNameOrEmail('id, full_name, email, role', memberSearch, 20);
        setMemberResults(data.filter(u => !existingIds.includes(u.id)));
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [memberSearch, roster]);

  const handleAddMember = async (user) => {
    if (!teamId) return;
    setAdding(true);
    const { error } = await supabase.from('team_members').insert({
      team_id: teamId, user_id: user.id, role: addRole,
    });
    if (error) { alert('Could not add member: ' + formatUserError(error)); }
    else {
      setMemberSearch('');
      setMemberResults([]);
      onRosterChange();
    }
    setAdding(false);
  };

  const handleRemoveMember = async (userId) => {
    if (!teamId || !window.confirm('Remove this player from the team?')) return;
    const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
    if (error) { alert('Could not remove member: ' + formatUserError(error)); }
    else onRosterChange();
  };

  const positions = ['all', ...new Set(roster.map(p => p.player_profile?.position).filter(Boolean))];

  let sortedRoster = [...roster];

  // Filter by position
  if (filterPosition !== 'all') {
    sortedRoster = sortedRoster.filter(p => p.player_profile?.position === filterPosition);
  }

  // Sort
  sortedRoster.sort((a, b) => {
    if (sortBy === 'name') {
      return a.full_name.localeCompare(b.full_name);
    } else if (sortBy === 'number') {
      const numA = parseInt(a.player_profile?.jersey_number) || 999;
      const numB = parseInt(b.player_profile?.jersey_number) || 999;
      return numA - numB;
    } else if (sortBy === 'position') {
      return (a.player_profile?.position || 'ZZZ').localeCompare(b.player_profile?.position || 'ZZZ');
    }
    return 0;
  });

  return (
    <div className="space-y-4">
      {/* Filters & Sorting */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-3">
          <label className="text-sm font-medium text-gray-700">Position:</label>
          <select
            value={filterPosition}
            onChange={(e) => setFilterPosition(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {positions.map(pos => (
              <option key={pos} value={pos}>{pos === 'all' ? 'All Positions' : pos}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center space-x-3">
          <label className="text-sm font-medium text-gray-700">Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="name">Name</option>
            <option value="number">Jersey Number</option>
            <option value="position">Position</option>
          </select>
          {isStaff && (
            <button
              onClick={() => setShowAddMember(!showAddMember)}
              className="flex items-center space-x-1 px-3 py-1 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              <UserPlus size={14} />
              <span>Add Member</span>
            </button>
          )}
        </div>
      </div>

      {/* Add Member Panel */}
      {showAddMember && isStaff && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-blue-900">Add Member to Team</h4>
            <button onClick={() => { setShowAddMember(false); setMemberSearch(''); setMemberResults([]); }} className="text-blue-400 hover:text-blue-600"><X size={16} /></button>
          </div>
          <div className="flex items-center space-x-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="player">Player</option>
              <option value="coach">Coach</option>
            </select>
          </div>
          {searchLoading && <p className="text-xs text-gray-500">Searching...</p>}
          {memberResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
              {memberResults.map(u => (
                <div key={u.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.full_name}</p>
                    <p className="text-xs text-gray-500 truncate">{u.email} &middot; {u.role}</p>
                  </div>
                  <button
                    onClick={() => handleAddMember(u)}
                    disabled={adding}
                    className="flex-shrink-0 ml-2 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {adding ? '...' : 'Add'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {memberSearch.trim().length >= 2 && !searchLoading && memberResults.length === 0 && (
            <p className="text-xs text-gray-500">No matching users found.</p>
          )}
        </div>
      )}

      {/* Coaches first */}
      {coaches.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Coaches</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...coaches].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')).map(coach => (
              <CoachCard key={coach.id} coach={coach} onNavigateToProfile={onNavigateToProfile} />
            ))}
          </div>
        </div>
      )}

      {/* Players */}
      <div className="space-y-2">
        {coaches.length > 0 && (
          <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide pt-2">Players</h4>
        )}
        {sortedRoster.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Users size={40} className="mx-auto mb-3 text-gray-300" />
            <p>No players found with the selected filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedRoster.map(player => (
              <PlayerCard
                key={player.id}
                player={player}
                isProspect={prospectPlayerIds?.includes(player.id)}
                canManageProspects={userRole === 'admin' || userRole === 'coach'}
                onToggleProspect={() => onProspectToggle(player)}
                canRemove={isStaff}
                onRemove={() => handleRemoveMember(player.id)}
                onOpen={onNavigateToProfile ? () => onNavigateToProfile(player.id) : null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerCard({ player, isProspect, canManageProspects, onToggleProspect, canRemove, onRemove, onOpen }) {
  const profile = player.player_profile || {};
  const clickable = !!onOpen;

  return (
    <div
      onClick={clickable ? onOpen : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}
      className={`bg-gray-50 rounded-lg p-4 transition border border-gray-200 ${clickable ? 'cursor-pointer hover:bg-blue-50 hover:border-blue-200' : 'hover:bg-gray-100'}`}
    >
      <div className="flex items-start space-x-4">
        {/* Jersey Number */}
        <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center text-white flex-shrink-0">
          <span className="text-2xl font-bold">{profile.jersey_number || '?'}</span>
        </div>

        {/* Player Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 truncate">{player.full_name}</h4>
          <div className="flex items-center space-x-2 mt-1">
            {profile.position && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                {profile.position}
              </span>
            )}
            {profile.grade && (
              <span className="text-xs text-gray-600">{profile.grade}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-2 space-y-0.5">
            {profile.bats && <div>Bats: {profile.bats}</div>}
            {profile.throws && <div>Throws: {profile.throws}</div>}
          </div>
        </div>

        <div className="flex items-center space-x-1 flex-shrink-0">
          {/* Prospect Star Toggle */}
          {canManageProspects && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleProspect(); }}
              className={`p-1.5 rounded-full transition ${isProspect ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-300 hover:text-yellow-400'}`}
              title={isProspect ? 'Remove from prospects' : 'Add to prospects'}
            >
              <Star size={20} fill={isProspect ? 'currentColor' : 'none'} />
            </button>
          )}
          {canRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="p-1.5 rounded-full text-gray-300 hover:text-red-500 transition"
              title="Remove from team"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// COACHES TAB
// ============================================

function CoachesTab({ coaches, onNavigateToProfile }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Coaching Staff</h3>

      {coaches.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <User size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No coaches assigned to this team.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {coaches.map(coach => (
            <CoachCard key={coach.id} coach={coach} onNavigateToProfile={onNavigateToProfile} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoachCard({ coach, onNavigateToProfile }) {
  const clickable = !!onNavigateToProfile;
  return (
    <div
      onClick={clickable ? () => onNavigateToProfile(coach.id) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigateToProfile(coach.id); } } : undefined}
      className={`bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-6 border border-gray-200 ${clickable ? 'cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition' : ''}`}
    >
      <div className="flex items-start space-x-4">
        <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white flex-shrink-0">
          <User size={24} />
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-gray-900 text-lg">{coach.full_name}</h4>
          <p className="text-sm text-gray-600 capitalize">{coach.role}</p>
          
          <div className="mt-3 space-y-2">
            {coach.email && (
              <a
                href={`mailto:${coach.email}`}
                className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"
              >
                <Mail size={14} />
                <span>{coach.email}</span>
              </a>
            )}
            {coach.phone && (
              <a
                href={`tel:${coach.phone}`}
                className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"
              >
                <Phone size={14} />
                <span>{coach.phone}</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// SCHEDULE TAB
// ============================================

function ScheduleTab({ events }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Upcoming Team Schedule</h3>
      
      {events.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Calendar size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No upcoming events scheduled.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
      
      <div className="mt-6 text-center">
        <p className="text-sm text-gray-600">
          View full schedule in the <span className="text-blue-600 font-medium">Schedule</span> tab
        </p>
      </div>
    </div>
  );
}

function EventCard({ event }) {
  const eventDate = new Date(event.event_date + 'T00:00:00');
  
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {/* Date Box */}
          <div className="text-center min-w-[60px]">
            <div className="text-2xl font-bold text-gray-900">
              {eventDate.getDate()}
            </div>
            <div className="text-xs text-gray-600 uppercase">
              {eventDate.toLocaleDateString('en-US', { month: 'short' })}
            </div>
          </div>
          
          {/* Event Info */}
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="font-semibold text-gray-900">{event.opponent}</h4>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                event.event_type === 'game' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
              }`}>
                {event.event_type}
              </span>
              {event.home_away && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                  {event.home_away}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              {event.event_time} • {event.location}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// ANNOUNCEMENTS TAB
// ============================================

function AnnouncementsTab({ announcements }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Recent Team Announcements</h3>
      
      {announcements.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No team announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map(announcement => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))}
        </div>
      )}
      
      <div className="mt-6 text-center">
        <p className="text-sm text-gray-600">
          View all messages in the <span className="text-blue-600 font-medium">Messages</span> tab
        </p>
      </div>
    </div>
  );
}

function AnnouncementCard({ announcement }) {
  const latestMessage = announcement.messages?.[0];

  return (
    <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
      <div className="flex items-start space-x-3">
        <MessageSquare size={20} className="text-yellow-600 mt-1 flex-shrink-0" />
        <div className="flex-1">
          <h4 className="font-semibold text-gray-900">{announcement.title}</h4>
          {latestMessage && (
            <p className="text-sm text-gray-700 mt-1 line-clamp-2">{latestMessage.content}</p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            {new Date(announcement.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// PROSPECTS TAB (Coach/Admin Only)
// ============================================

const PROSPECT_POSITION_OPTIONS = [
  { code: 'P', label: 'P — Pitcher' },
  { code: 'C', label: 'C — Catcher' },
  { code: '1B', label: '1B — First Base' },
  { code: '2B', label: '2B — Second Base' },
  { code: '3B', label: '3B — Third Base' },
  { code: 'SS', label: 'SS — Shortstop' },
  { code: 'LF', label: 'LF — Left Field' },
  { code: 'CF', label: 'CF — Center Field' },
  { code: 'RF', label: 'RF — Right Field' },
  { code: 'DH', label: 'DH — Designated Hitter' },
  { code: 'UT', label: 'UT — Utility' },
];

const getProspectPositions = (p) => {
  if (Array.isArray(p?.positions) && p.positions.length > 0) {
    return p.positions.map(pos => (pos || '').toUpperCase().trim()).filter(Boolean);
  }
  const single = (p?.position || '').toUpperCase().trim();
  return single ? [single] : [];
};

function ProspectsTab({ teamId, userId, userRole, roster, prospects, onProspectsChange }) {
  const canEdit = userRole === 'admin' || userRole === 'coach';
  const [addMode, setAddMode] = useState(null); // null, 'member', 'external'
  const [newProspect, setNewProspect] = useState({ name: '', notes: '', player_id: '', positions: [] });
  const [hoveredPosition, setHoveredPosition] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [editPositions, setEditPositions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [emailTarget, setEmailTarget] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const memberDropdownRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Debounced member search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!memberSearch.trim() || memberSearch.trim().length < 2) {
      setMemberResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const existingPlayerIds = prospects.filter(p => p.player_id).map(p => p.player_id);
        const data = await searchUsersByNameOrEmail(
          'id, full_name, email, role, player_profiles!player_profiles_user_id_fkey(position)',
          memberSearch,
          20
        );
        const filtered = (data || []).filter(u => !existingPlayerIds.includes(u.id));
        setMemberResults(filtered);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [memberSearch, prospects]);

  // Click-outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (memberDropdownRef.current && !memberDropdownRef.current.contains(e.target)) {
        setMemberResults([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddProspect = async () => {
    if (!newProspect.name.trim()) return;
    setSaving(true);
    try {
      const normalized = (newProspect.positions || [])
        .map(p => (p || '').toUpperCase().trim())
        .filter(Boolean);
      const { error } = await supabase
        .from('prospects')
        .insert({
          team_id: teamId,
          player_id: newProspect.player_id || null,
          name: newProspect.name,
          position: normalized[0] || null,
          positions: normalized,
          notes: newProspect.notes || null,
          added_by: userId,
        });

      if (error) throw error;
      setNewProspect({ name: '', notes: '', player_id: '', positions: [] });
      setAddMode(null);
      setMemberSearch('');
      await onProspectsChange();
    } catch (error) {
      console.error('Error adding prospect:', error);
      alert('Error adding prospect: ' + formatUserError(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleNewPosition = (code) => {
    setNewProspect(prev => {
      const current = prev.positions || [];
      const exists = current.includes(code);
      return { ...prev, positions: exists ? current.filter(c => c !== code) : [...current, code] };
    });
  };

  const toggleEditPosition = (code) => {
    setEditPositions(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const handleDeleteProspect = async (id) => {
    if (!window.confirm('Remove this prospect from the list?')) return;
    try {
      const { error } = await supabase
        .from('prospects')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await onProspectsChange();
    } catch (error) {
      console.error('Error deleting prospect:', error);
    }
  };

  const handleUpdateNotes = async (id) => {
    try {
      const normalized = (editPositions || [])
        .map(p => (p || '').toUpperCase().trim())
        .filter(Boolean);
      const { error } = await supabase
        .from('prospects')
        .update({
          notes: editNotes || null,
          position: normalized[0] || null,
          positions: normalized,
        })
        .eq('id', id);

      if (error) throw error;
      setEditingId(null);
      await onProspectsChange();
    } catch (error) {
      console.error('Error updating prospect:', error);
    }
  };

  // Group prospects by position for field view — a prospect counts in every position they hold.
  const positionMap = {};
  prospects.forEach(p => {
    const positions = getProspectPositions(p);
    positions.forEach(pos => {
      if (!positionMap[pos]) positionMap[pos] = [];
      positionMap[pos].push(p);
    });
  });

  return (
    <div className="space-y-4">
      {/* Field Depth Chart */}
      {prospects.length > 0 && (
        <div className="bg-gradient-to-b from-green-100 to-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 text-center">Field Depth Chart</h4>
          <div className="relative w-full max-w-[500px] mx-auto" style={{ aspectRatio: '1.2' }}>
            {/* Outfield arc */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 500 420" fill="none">
              <path d="M 50 380 Q 250 20 450 380" stroke="#4ade80" strokeWidth="2" fill="none" strokeDasharray="4,4" />
              {/* Infield diamond */}
              <polygon points="250,280 320,340 250,400 180,340" stroke="#854d0e" strokeWidth="1.5" fill="#fef3c7" fillOpacity="0.3" />
              {/* Baselines */}
              <line x1="250" y1="400" x2="50" y2="380" stroke="#854d0e" strokeWidth="1" opacity="0.4" />
              <line x1="250" y1="400" x2="450" y2="380" stroke="#854d0e" strokeWidth="1" opacity="0.4" />
            </svg>
            {/* Position spots */}
            {[
              { pos: 'P', x: '50%', y: '72%' },
              { pos: 'C', x: '50%', y: '95%' },
              { pos: '1B', x: '68%', y: '75%' },
              { pos: '2B', x: '62%', y: '62%' },
              { pos: '3B', x: '32%', y: '75%' },
              { pos: 'SS', x: '38%', y: '62%' },
              { pos: 'LF', x: '20%', y: '35%' },
              { pos: 'CF', x: '50%', y: '22%' },
              { pos: 'RF', x: '80%', y: '35%' },
              { pos: 'DH', x: '90%', y: '90%' },
            ].map(({ pos, x, y }) => {
              const players = positionMap[pos] || [];
              return (
                <div
                  key={pos}
                  className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2"
                  style={{ left: x, top: y }}
                  onMouseEnter={() => setHoveredPosition(pos)}
                  onMouseLeave={() => setHoveredPosition(null)}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition ${
                    players.length > 0 ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-400 border-gray-300'
                  }`}>
                    {pos}
                  </div>
                  <span className={`text-[9px] font-medium mt-0.5 ${players.length > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                    {players.length > 0 ? `${players.length}` : '—'}
                  </span>
                  {hoveredPosition === pos && players.length > 0 && (
                    <div className="absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-30 min-w-[120px]">
                      {players.map(p => (
                        <div key={p.id} className="text-[11px] text-gray-800 py-0.5 whitespace-nowrap">{p.name}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Prospects List</h3>
        {canEdit && !addMode && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => { setAddMode('member'); setNewProspect({ name: '', notes: '', player_id: '', positions: [] }); setMemberSearch(''); setMemberResults([]); }}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition flex items-center space-x-1"
            >
              <UserPlus size={16} />
              <span>Any Member</span>
            </button>
            <button
              onClick={() => { setAddMode('external'); setNewProspect({ name: '', notes: '', player_id: '', positions: [] }); }}
              className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-green-700 transition flex items-center space-x-1"
            >
              <Plus size={16} />
              <span>External</span>
            </button>
          </div>
        )}
      </div>

      {/* Add Prospect Form */}
      {addMode && (
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <h4 className="font-medium text-gray-900 mb-3">
            {addMode === 'member' ? 'Add Member as Prospect' : 'Add External Prospect'}
          </h4>
          <div className="space-y-3">
            {addMode === 'member' ? (
              <div className="relative" ref={memberDropdownRef}>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                {memberResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {memberResults.map(u => (
                      <button
                        key={u.id}
                        onClick={() => {
                          const pos = (u.player_profiles?.[0]?.position || '').toUpperCase().trim();
                          setNewProspect({
                            name: u.full_name,
                            player_id: u.id,
                            positions: pos ? [pos] : [],
                            notes: newProspect.notes,
                          });
                          setMemberSearch('');
                          setMemberResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between"
                      >
                        <div>
                          <span className="font-medium text-gray-900">{u.full_name}</span>
                          <span className="text-xs text-gray-500 ml-2">{u.email}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.role === 'player' ? 'bg-blue-100 text-blue-700' : u.role === 'coach' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                        }`}>{u.role}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchLoading && <p className="text-xs text-gray-500 mt-1">Searching...</p>}
                {newProspect.player_id && (
                  <div className="mt-2 bg-blue-100 text-blue-800 px-3 py-1.5 rounded-lg text-sm flex items-center justify-between">
                    <span>Selected: <strong>{newProspect.name}</strong></span>
                    <button onClick={() => setNewProspect({ name: '', notes: newProspect.notes, player_id: '', positions: [] })} className="text-blue-600 hover:text-blue-800">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <input
                type="text"
                value={newProspect.name}
                onChange={(e) => setNewProspect({...newProspect, name: e.target.value})}
                placeholder="Prospect name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Positions (select one or more)</label>
              <div className="flex flex-wrap gap-1.5">
                {PROSPECT_POSITION_OPTIONS.map(opt => {
                  const selected = (newProspect.positions || []).includes(opt.code);
                  return (
                    <button
                      type="button"
                      key={opt.code}
                      onClick={() => toggleNewPosition(opt.code)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                        selected
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {opt.code}
                    </button>
                  );
                })}
              </div>
            </div>
            <textarea
              value={newProspect.notes}
              onChange={(e) => setNewProspect({...newProspect, notes: e.target.value})}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex space-x-2">
              <button
                onClick={handleAddProspect}
                disabled={saving || !newProspect.name.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-1"
              >
                <Save size={16} />
                <span>{saving ? 'Adding...' : 'Add Prospect'}</span>
              </button>
              <button
                onClick={() => { setAddMode(null); setMemberSearch(''); setMemberResults([]); }}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition flex items-center space-x-1"
              >
                <X size={16} />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Depth Chart Diagram */}
      <DepthChartField prospects={prospects} roster={roster} hoveredPosition={hoveredPosition} setHoveredPosition={setHoveredPosition} />

      {/* Prospects List */}
      {prospects.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Star size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No prospects added yet.</p>
          <p className="text-sm mt-1">Add players from your roster or external prospects to track.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {prospects.map(prospect => (
            <div key={prospect.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:bg-gray-100 transition">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3 flex-1">
                  <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center text-white flex-shrink-0">
                    <Star size={18} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-semibold text-gray-900">{prospect.name}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        prospect.player_id ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {prospect.player_id ? 'Member' : 'External'}
                      </span>
                      {getProspectPositions(prospect).map(pos => (
                        <span key={pos} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                          {pos}
                        </span>
                      ))}
                    </div>
                    {editingId === prospect.id ? (
                      <div className="mt-2 space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Positions</label>
                          <div className="flex flex-wrap gap-1.5">
                            {PROSPECT_POSITION_OPTIONS.map(opt => {
                              const selected = editPositions.includes(opt.code);
                              return (
                                <button
                                  type="button"
                                  key={opt.code}
                                  onClick={() => toggleEditPosition(opt.code)}
                                  className={`px-2 py-0.5 rounded-full text-xs font-medium border transition ${
                                    selected
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  {opt.code}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="Add notes..."
                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => handleUpdateNotes(prospect.id)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Save size={16} />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600 mt-1">
                        {prospect.notes || 'No notes'}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      Added {new Date(prospect.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                {canEdit && (
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    onClick={() => { setEditingId(prospect.id); setEditNotes(prospect.notes || ''); setEditPositions(getProspectPositions(prospect)); }}
                    className="p-1.5 text-gray-400 hover:text-blue-600 transition"
                    title="Edit notes"
                  >
                    <Edit2 size={16} />
                  </button>
                  {prospect.users?.email && (
                    <button
                      onClick={() => setEmailTarget({ name: prospect.name, email: prospect.users.email, prospectId: prospect.id, playerId: prospect.player_id })}
                      className="p-1.5 text-gray-400 hover:text-blue-600 transition"
                      title="Email prospect"
                    >
                      <Mail size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProspect(prospect.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 transition"
                    title="Remove prospect"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {emailTarget && (
        <EmailComposeModal
          recipientName={emailTarget.name}
          recipientEmail={emailTarget.email}
          playerId={emailTarget.playerId || null}
          prospectId={emailTarget.prospectId || null}
          onClose={() => setEmailTarget(null)}
          onSent={() => {}}
        />
      )}
    </div>
  );
}

function DepthChartField({ prospects, roster, hoveredPosition, setHoveredPosition }) {
  const POSITIONS = [
    { code: 'P',  label: 'Pitcher',      x: 200, y: 215 },
    { code: 'C',  label: 'Catcher',      x: 200, y: 305 },
    { code: '1B', label: 'First Base',   x: 270, y: 215 },
    { code: '2B', label: 'Second Base',  x: 240, y: 155 },
    { code: 'SS', label: 'Shortstop',    x: 160, y: 155 },
    { code: '3B', label: 'Third Base',   x: 130, y: 215 },
    { code: 'LF', label: 'Left Field',   x: 75,  y: 70  },
    { code: 'CF', label: 'Center Field', x: 200, y: 35  },
    { code: 'RF', label: 'Right Field',  x: 325, y: 70  },
  ];

  const normalizePosition = (pos) => {
    if (!pos) return null;
    const upper = pos.toUpperCase().trim();
    if (['RHP', 'LHP', 'SP', 'RP', 'CL'].includes(upper)) return 'P';
    if (upper === 'IF') return 'SS';
    if (upper === 'OF') return 'CF';
    return upper;
  };

  const rosterByPos = {};
  const prospectByPos = {};
  POSITIONS.forEach(p => { rosterByPos[p.code] = []; prospectByPos[p.code] = []; });

  (roster || []).forEach(player => {
    const pos = normalizePosition(player.player_profile?.position);
    if (pos && rosterByPos[pos]) rosterByPos[pos].push(player);
  });
  prospects.forEach(pr => {
    const seen = new Set();
    getProspectPositions(pr).forEach(raw => {
      const pos = normalizePosition(raw);
      if (pos && prospectByPos[pos] && !seen.has(pos)) {
        prospectByPos[pos].push(pr);
        seen.add(pos);
      }
    });
  });

  const hovered = POSITIONS.find(p => p.code === hoveredPosition);
  const hoveredRoster = hovered ? rosterByPos[hovered.code] : [];
  const hoveredProspects = hovered ? prospectByPos[hovered.code] : [];

  return (
    <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900">Depth Chart</h4>
        <div className="flex items-center space-x-3 text-xs text-gray-600">
          <span className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span><span>Roster</span></span>
          <span className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span><span>Prospects</span></span>
        </div>
      </div>
      <div className="flex flex-col md:flex-row md:space-x-4">
        <div className="flex-shrink-0 mx-auto" style={{ width: 400, maxWidth: '100%' }}>
          <svg viewBox="0 0 400 360" className="w-full h-auto">
            <path d="M 200 320 L 30 80 A 240 240 0 0 1 370 80 Z" fill="#86efac" stroke="#16a34a" strokeWidth="2" />
            <path d="M 200 280 L 110 215 L 200 150 L 290 215 Z" fill="#fbbf24" opacity="0.7" stroke="#b45309" strokeWidth="2" />
            <circle cx="200" cy="215" r="14" fill="#fbbf24" stroke="#b45309" strokeWidth="1.5" />
            {[ {x:200,y:280}, {x:290,y:215}, {x:200,y:150}, {x:110,y:215} ].map((b, i) => (
              <rect key={i} x={b.x - 6} y={b.y - 6} width="12" height="12" fill="white" stroke="#374151" strokeWidth="1" transform={`rotate(45 ${b.x} ${b.y})`} />
            ))}
            {POSITIONS.map(pos => {
              const rCount = rosterByPos[pos.code].length;
              const pCount = prospectByPos[pos.code].length;
              const isHovered = hoveredPosition === pos.code;
              const fillColor = rCount > 0 ? '#2563eb' : pCount > 0 ? '#d97706' : '#9ca3af';
              return (
                <g
                  key={pos.code}
                  onMouseEnter={() => setHoveredPosition(pos.code)}
                  onMouseLeave={() => setHoveredPosition(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={isHovered ? 22 : 18}
                    fill={fillColor}
                    stroke="white"
                    strokeWidth="2"
                  />
                  <text
                    x={pos.x}
                    y={pos.y + 4}
                    textAnchor="middle"
                    fill="white"
                    fontSize="11"
                    fontWeight="700"
                    pointerEvents="none"
                  >
                    {pos.code}
                  </text>
                  {/* Blue badge top-right: roster count */}
                  {rCount > 0 && (
                    <>
                      <circle cx={pos.x + 14} cy={pos.y - 14} r="9" fill="#2563eb" stroke="white" strokeWidth="1.5" />
                      <text x={pos.x + 14} y={pos.y - 11} textAnchor="middle" fill="white" fontSize="10" fontWeight="700" pointerEvents="none">
                        {rCount}
                      </text>
                    </>
                  )}
                  {/* Amber badge top-left: prospect count */}
                  {pCount > 0 && (
                    <>
                      <circle cx={pos.x - 14} cy={pos.y - 14} r="9" fill="#d97706" stroke="white" strokeWidth="1.5" />
                      <text x={pos.x - 14} y={pos.y - 11} textAnchor="middle" fill="white" fontSize="10" fontWeight="700" pointerEvents="none">
                        {pCount}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex-1 mt-3 md:mt-0 bg-white border border-gray-200 rounded-lg p-3 min-h-[120px]">
          {hovered ? (
            <>
              <div className="text-sm font-semibold text-gray-900 mb-2">{hovered.code} — {hovered.label}</div>
              {/* On Roster section */}
              <div className="mb-3">
                <div className="text-xs font-medium text-blue-700 mb-1 flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
                  <span>On Roster ({hoveredRoster.length})</span>
                </div>
                {hoveredRoster.length === 0 ? (
                  <p className="text-xs text-gray-400 italic ml-3">None</p>
                ) : (
                  <ul className="space-y-0.5 ml-3">
                    {hoveredRoster.map(p => (
                      <li key={p.id} className="text-sm text-gray-800 flex items-center space-x-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                        <span>{p.full_name}</span>
                        {p.player_profile?.jersey_number && (
                          <span className="text-xs text-gray-400">#{p.player_profile.jersey_number}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* Prospects section */}
              <div>
                <div className="text-xs font-medium text-amber-700 mb-1 flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
                  <span>Prospects ({hoveredProspects.length})</span>
                </div>
                {hoveredProspects.length === 0 ? (
                  <p className="text-xs text-gray-400 italic ml-3">None</p>
                ) : (
                  <ul className="space-y-0.5 ml-3">
                    {hoveredProspects.map(p => (
                      <li key={p.id} className="text-sm text-gray-800 flex items-center space-x-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        <span>{p.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500 italic">Hover any position on the field to see roster & prospects.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// GAME CHANGER TAB (#187)
// Per-team contact directory for parents/coaches who run the
// Game Changer scoring app during games.
// ============================================
const GC_ROLES = ['Parent', 'Coach', 'Manager', 'Other'];

function GameChangerTab({ teamId, userRole }) {
  const canManage = userRole === 'admin' || userRole === 'coach';
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ name: '', role: 'Parent', email: '', phone: '', notes: '' });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('team_game_changer_contacts')
      .select('*')
      .eq('team_id', teamId)
      .order('role')
      .order('name');
    setContacts(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [teamId]);

  const startAdd = () => {
    setEditing(null);
    setDraft({ name: '', role: 'Parent', email: '', phone: '', notes: '' });
    setAdding(true);
  };

  const startEdit = (c) => {
    setAdding(false);
    setEditing(c.id);
    setDraft({ name: c.name || '', role: c.role || 'Parent', email: c.email || '', phone: c.phone || '', notes: c.notes || '' });
  };

  const save = async () => {
    if (!draft.name.trim()) { alert('Name is required.'); return; }
    const payload = {
      team_id: teamId,
      name: draft.name.trim(),
      role: draft.role,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editing) {
      ({ error } = await supabase.from('team_game_changer_contacts').update(payload).eq('id', editing));
    } else {
      ({ error } = await supabase.from('team_game_changer_contacts').insert(payload));
    }
    if (error) { alert('Save failed: ' + formatUserError(error)); return; }
    setAdding(false);
    setEditing(null);
    load();
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this contact?')) return;
    await supabase.from('team_game_changer_contacts').delete().eq('id', id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Game Changer Contacts</h3>
          <p className="text-sm text-gray-500">Parents and coaches who can run Game Changer for this team.</p>
        </div>
        {canManage && !adding && !editing && (
          <button onClick={startAdd} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center space-x-1">
            <Plus size={16} />
            <span>Add Contact</span>
          </button>
        )}
      </div>

      {(adding || editing) && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <select value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
                {GC_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input type="tel" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setEditing(null); }} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm">Cancel</button>
            <button onClick={save} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm flex items-center gap-1">
              <Save size={14} />
              <span>{editing ? 'Update' : 'Save'}</span>
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500 text-center py-6">Loading contacts...</p>
      ) : contacts.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <Radio size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No Game Changer contacts yet.</p>
          {canManage && <p className="text-xs mt-1">Click "Add Contact" to start the directory.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contacts.map(c => (
            <div key={c.id} className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-gray-900">{c.name}</h4>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{c.role}</span>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="flex items-center gap-2 text-gray-700 hover:text-blue-600">
                        <Mail size={14} className="text-gray-400" />
                        <span className="truncate">{c.email}</span>
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-gray-700 hover:text-blue-600">
                        <Phone size={14} className="text-gray-400" />
                        <span>{c.phone}</span>
                      </a>
                    )}
                  </div>
                  {c.notes && <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{c.notes}</p>}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2 ml-3">
                    <button onClick={() => startEdit(c)} className="text-gray-400 hover:text-blue-600" title="Edit"><Edit2 size={14} /></button>
                    <button onClick={() => remove(c.id)} className="text-gray-400 hover:text-red-600" title="Remove"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
