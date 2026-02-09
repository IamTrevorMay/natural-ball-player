import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Users, Calendar, MessageSquare, TrendingUp, User, Mail, Phone, Award, Activity } from 'lucide-react';

export default function MyTeam({ userId }) {
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
        .gte('event_date', new Date().toISOString().split('T')[0])
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
              { key: 'announcements', label: 'Announcements', icon: MessageSquare }
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
  const eventDate = new Date(event.event_date);
  
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
