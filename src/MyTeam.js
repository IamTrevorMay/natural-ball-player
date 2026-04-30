import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Users, Calendar, MessageSquare, User, Mail, Phone, Star, Plus, Trash2, Edit2, Save, X, UserPlus } from 'lucide-react';

const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export default function MyTeam({ userId, userRole }) {
  const [loading, setLoading] = useState(true);
  const [teamData, setTeamData] = useState(null);
  const [roster, setRoster] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [recentAnnouncements, setRecentAnnouncements] = useState([]);
  const [activeTab, setActiveTab] = useState('roster');

  useEffect(() => {
    fetchTeamData();
  }, [userId]);

  const fetchTeamData = async () => {
    try {
      // Get user's team
      const { data: membership } = await supabase
        .from('team_members')
        .select('team_id, teams(*)')
        .eq('user_id', userId)
        .single();

      if (!membership) {
        setLoading(false);
        return;
      }

      const teamId = membership.team_id;
      setTeamData(membership.teams);

      // Get roster (all players on team)
      const { data: players } = await supabase
        .from('team_members')
        .select(`
          user_id,
          role,
          users(
            id,
            full_name,
            email,
            phone,
            player_profiles(
              jersey_number,
              position,
              grade,
              bats,
              throws
            )
          )
        `)
        .eq('team_id', teamId)
        .eq('role', 'player')
        .order('users(full_name)');

      if (players) {
        setRoster(players.map(p => ({
          ...p.users,
          role: p.role,
          player_profile: p.users.player_profiles?.[0]
        })));
      }

      // Get coaches
      const { data: coachList } = await supabase
        .from('team_members')
        .select(`
          user_id,
          role,
          users(
            id,
            full_name,
            email,
            phone
          )
        `)
        .eq('team_id', teamId)
        .in('role', ['coach', 'admin'])
        .order('users(full_name)');

      if (coachList) {
        setCoaches(coachList.map(c => ({
          ...c.users,
          role: c.role
        })));
      }

      // Get upcoming events
      const { data: events } = await supabase
        .from('schedule_events')
        .select('*')
        .eq('team_id', teamId)
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

    } catch (error) {
      console.error('Error fetching team data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading team information...</p>
      </div>
    );
  }

  if (!teamData) {
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
      {/* Team Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div className="w-20 h-20 bg-white/20 rounded-lg flex items-center justify-center">
              <Users size={40} />
            </div>
            <div>
              <h1 className="text-4xl font-bold">{teamData.name}</h1>
              {teamData.description && (
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
              ...((userRole === 'admin' || userRole === 'coach') ? [{ key: 'prospects', label: 'Prospects', icon: Star }] : [])
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
          {activeTab === 'roster' && <RosterTab roster={roster} />}
          {activeTab === 'coaches' && <CoachesTab coaches={coaches} />}
          {activeTab === 'schedule' && <ScheduleTab events={upcomingEvents} />}
          {activeTab === 'announcements' && <AnnouncementsTab announcements={recentAnnouncements} />}
          {activeTab === 'prospects' && (userRole === 'admin' || userRole === 'coach') && (
            <ProspectsTab teamId={teamData.id} userId={userId} roster={roster} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// ROSTER TAB
// ============================================

function RosterTab({ roster }) {
  const [sortBy, setSortBy] = useState('name');
  const [filterPosition, setFilterPosition] = useState('all');

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
      <div className="flex items-center justify-between">
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
        </div>
      </div>

      {/* Player Cards */}
      {sortedRoster.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Users size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No players found with the selected filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedRoster.map(player => (
            <PlayerCard key={player.id} player={player} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerCard({ player }) {
  const profile = player.player_profile || {};
  
  return (
    <div className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition border border-gray-200">
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
      </div>
    </div>
  );
}

// ============================================
// COACHES TAB
// ============================================

function CoachesTab({ coaches }) {
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
            <CoachCard key={coach.id} coach={coach} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoachCard({ coach }) {
  return (
    <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-6 border border-gray-200">
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

function ProspectsTab({ teamId, userId, roster }) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(null); // null, 'roster', 'external'
  const [newProspect, setNewProspect] = useState({ name: '', notes: '', player_id: '', position: '' });
  const [hoveredPosition, setHoveredPosition] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProspects();
  }, [teamId]);

  const fetchProspects = async () => {
    try {
      const { data, error } = await supabase
        .from('prospects')
        .select('*, users:player_id(full_name)')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProspects(data || []);
    } catch (error) {
      console.error('Error fetching prospects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProspect = async () => {
    if (!newProspect.name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('prospects')
        .insert({
          team_id: teamId,
          player_id: newProspect.player_id || null,
          name: newProspect.name,
          position: newProspect.position || null,
          notes: newProspect.notes || null,
          added_by: userId,
        });

      if (error) throw error;
      setNewProspect({ name: '', notes: '', player_id: '', position: '' });
      setAddMode(null);
      await fetchProspects();
    } catch (error) {
      console.error('Error adding prospect:', error);
      alert('Error adding prospect: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProspect = async (id) => {
    if (!window.confirm('Remove this prospect from the list?')) return;
    try {
      const { error } = await supabase
        .from('prospects')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchProspects();
    } catch (error) {
      console.error('Error deleting prospect:', error);
    }
  };

  const handleUpdateNotes = async (id) => {
    try {
      const { error } = await supabase
        .from('prospects')
        .update({ notes: editNotes || null })
        .eq('id', id);

      if (error) throw error;
      setEditingId(null);
      await fetchProspects();
    } catch (error) {
      console.error('Error updating prospect:', error);
    }
  };

  const handleSelectRosterPlayer = (playerId) => {
    const player = roster.find(p => p.id === playerId);
    if (player) {
      setNewProspect({ ...newProspect, name: player.full_name, player_id: playerId });
    }
  };

  // Filter out roster players already in prospects
  const existingPlayerIds = prospects.filter(p => p.player_id).map(p => p.player_id);
  const availableRoster = roster.filter(p => !existingPlayerIds.includes(p.id));

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading prospects...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Prospects List</h3>
        {!addMode && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => { setAddMode('roster'); setNewProspect({ name: '', notes: '', player_id: '', position: '' }); }}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition flex items-center space-x-1"
            >
              <UserPlus size={16} />
              <span>From Roster</span>
            </button>
            <button
              onClick={() => { setAddMode('external'); setNewProspect({ name: '', notes: '', player_id: '', position: '' }); }}
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
            {addMode === 'roster' ? 'Add Roster Player as Prospect' : 'Add External Prospect'}
          </h4>
          <div className="space-y-3">
            {addMode === 'roster' ? (
              <select
                value={newProspect.player_id}
                onChange={(e) => handleSelectRosterPlayer(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a player...</option>
                {availableRoster.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} {p.player_profile?.position ? `(${p.player_profile.position})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newProspect.name}
                onChange={(e) => setNewProspect({...newProspect, name: e.target.value})}
                placeholder="Prospect name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            <select
              value={newProspect.position}
              onChange={(e) => setNewProspect({...newProspect, position: e.target.value})}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">No position</option>
              <option value="P">P — Pitcher</option>
              <option value="C">C — Catcher</option>
              <option value="1B">1B — First Base</option>
              <option value="2B">2B — Second Base</option>
              <option value="3B">3B — Third Base</option>
              <option value="SS">SS — Shortstop</option>
              <option value="LF">LF — Left Field</option>
              <option value="CF">CF — Center Field</option>
              <option value="RF">RF — Right Field</option>
              <option value="DH">DH — Designated Hitter</option>
              <option value="UT">UT — Utility</option>
            </select>
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
                onClick={() => setAddMode(null)}
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
      <DepthChartField prospects={prospects} hoveredPosition={hoveredPosition} setHoveredPosition={setHoveredPosition} />

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
                        {prospect.player_id ? 'Roster' : 'External'}
                      </span>
                    </div>
                    {editingId === prospect.id ? (
                      <div className="mt-2 flex items-center space-x-2">
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
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    onClick={() => { setEditingId(prospect.id); setEditNotes(prospect.notes || ''); }}
                    className="p-1.5 text-gray-400 hover:text-blue-600 transition"
                    title="Edit notes"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteProspect(prospect.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 transition"
                    title="Remove prospect"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DepthChartField({ prospects, hoveredPosition, setHoveredPosition }) {
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

  const byPos = {};
  POSITIONS.forEach(p => { byPos[p.code] = []; });
  prospects.forEach(pr => {
    if (pr.position && byPos[pr.position]) byPos[pr.position].push(pr);
  });

  const hovered = POSITIONS.find(p => p.code === hoveredPosition);
  const hoveredList = hovered ? byPos[hovered.code] : [];

  return (
    <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900">Depth Chart</h4>
        <span className="text-xs text-gray-600">Hover a position to see who's there</span>
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
              const count = byPos[pos.code].length;
              const isHovered = hoveredPosition === pos.code;
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
                    fill={count > 0 ? '#2563eb' : '#9ca3af'}
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
                  {count > 0 && (
                    <circle cx={pos.x + 14} cy={pos.y - 14} r="9" fill="#dc2626" stroke="white" strokeWidth="1.5" />
                  )}
                  {count > 0 && (
                    <text x={pos.x + 14} y={pos.y - 11} textAnchor="middle" fill="white" fontSize="10" fontWeight="700" pointerEvents="none">
                      {count}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex-1 mt-3 md:mt-0 bg-white border border-gray-200 rounded-lg p-3 min-h-[120px]">
          {hovered ? (
            <>
              <div className="text-sm font-semibold text-gray-900 mb-1">{hovered.code} — {hovered.label}</div>
              <div className="text-xs text-gray-500 mb-2">{hoveredList.length} prospect{hoveredList.length !== 1 ? 's' : ''}</div>
              {hoveredList.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No prospects at this position.</p>
              ) : (
                <ul className="space-y-1">
                  {hoveredList.map(p => (
                    <li key={p.id} className="text-sm text-gray-800 flex items-center space-x-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      <span>{p.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 italic">Hover any position on the field to see prospects.</p>
          )}
        </div>
      </div>
    </div>
  );
}
