import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { TrendingUp, Activity, Moon, Target, Calendar, Users } from 'lucide-react';

export default function PlayerDashboard({ userId }) {
  const [loading, setLoading] = useState(true);
  const [playerData, setPlayerData] = useState(null);
  const [stats, setStats] = useState(null);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [teamInfo, setTeamInfo] = useState(null);

  useEffect(() => {
    fetchPlayerData();
  }, [userId]);

  const fetchPlayerData = async () => {
    try {
      // Fetch player profile
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select(`
          *,
          player_profiles(*),
          team_members(
            team_id,
            teams(*)
          )
        `)
        .eq('id', userId)
        .single();

      if (userError) throw userError;
      setPlayerData(userData);

      // Get team info if player is on a team
      if (userData.team_members && userData.team_members.length > 0) {
        setTeamInfo(userData.team_members[0].teams);
        
        // Fetch upcoming team events
        const { data: events, error: eventsError } = await supabase
          .from('schedule_events')
          .select('*')
          .eq('team_id', userData.team_members[0].team_id)
          .gte('event_date', new Date().toISOString().split('T')[0])
          .order('event_date', { ascending: true })
          .limit(3);

        if (!eventsError) {
          setUpcomingEvents(events);
        }
      }

      // Fetch latest performance stats
      const { data: latestStats, error: statsError } = await supabase
        .from('performance_stats')
        .select('*')
        .eq('player_id', userId)
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (!statsError && latestStats) {
        setStats(latestStats);
      }

    } catch (error) {
      console.error('Error fetching player data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading your dashboard...</p>
      </div>
    );
  }

  if (!playerData) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Profile Not Found</h2>
        <p className="text-gray-600">Unable to load player profile data.</p>
      </div>
    );
  }

  const profile = playerData.player_profiles?.[0];

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h2 className="text-3xl font-bold text-gray-900">
          Welcome back, {playerData.full_name.split(' ')[0]}!
        </h2>
        <p className="text-gray-600 mt-1">Here's your performance overview</p>
      </div>

      {/* Player Info Card */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-6 text-white">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-3xl font-bold">
              {profile?.jersey_number || '?'}
            </div>
            <div>
              <h3 className="text-2xl font-bold">{playerData.full_name}</h3>
              <div className="flex items-center space-x-3 mt-2 text-blue-100">
                <span>{profile?.position || 'Position not set'}</span>
                {teamInfo && (
                  <>
                    <span>â€¢</span>
                    <span>{teamInfo.name} Team</span>
                  </>
                )}
              </div>
              {profile && (
                <div className="mt-3 flex items-center space-x-4 text-sm text-blue-100">
                  <span>Grade: {profile.grade || 'Not set'}</span>
                  <span>â€¢</span>
                  <span>Bats: {profile.bats}</span>
                  <span>â€¢</span>
                  <span>Throws: {profile.throws}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Performance Stats */}
      {stats ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-600">Trackman Data</h3>
              <TrendingUp className="text-blue-600" size={20} />
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Exit Velocity</span>
                  <span className="font-semibold">{stats.exit_velocity || 'N/A'} mph</span>
                </div>
                {stats.exit_velocity && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{width: `${Math.min((stats.exit_velocity / 100) * 100, 100)}%`}}></div>
                  </div>
                )}
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Launch Angle</span>
                  <span className="font-semibold">{stats.launch_angle || 'N/A'}Â°</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Spin Rate</span>
                  <span className="font-semibold">{stats.spin_rate || 'N/A'} rpm</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-4">
              Last updated: {new Date(stats.date).toLocaleDateString()}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-600">HitTrax Stats</h3>
              <Activity className="text-orange-600" size={20} />
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Avg Distance</span>
                  <span className="font-semibold">{stats.avg_distance || 'N/A'} ft</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Hard Hit Rate</span>
                  <span className="font-semibold">{stats.hard_hit_rate || 'N/A'}%</span>
                </div>
                {stats.hard_hit_rate && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-orange-600 h-2 rounded-full" style={{width: `${stats.hard_hit_rate}%`}}></div>
                  </div>
                )}
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Line Drive Rate</span>
                  <span className="font-semibold">{stats.line_drive_rate || 'N/A'}%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-600">WHOOP Recovery</h3>
              <Moon className="text-purple-600" size={20} />
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Recovery Score</span>
                  <span className="font-semibold">{stats.recovery_score || 'N/A'}%</span>
                </div>
                {stats.recovery_score && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-600 h-2 rounded-full" style={{width: `${stats.recovery_score}%`}}></div>
                  </div>
                )}
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Strain</span>
                  <span className="font-semibold">{stats.strain || 'N/A'}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Sleep</span>
                  <span className="font-semibold">{stats.sleep_hours || 'N/A'} hrs</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Target className="mx-auto text-gray-300 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Performance Data Yet</h3>
          <p className="text-gray-600">Your coach will add your stats from training sessions.</p>
        </div>
      )}

      {/* Upcoming Schedule */}
      {upcomingEvents.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Calendar size={20} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">Upcoming Schedule</h3>
          </div>
          <div className="space-y-3">
            {upcomingEvents.map((event, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="text-center min-w-[60px]">
                    <div className="text-sm font-semibold text-gray-900">
                      {new Date(event.event_date).getDate()}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short' })}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{event.opponent}</div>
                    <div className="text-sm text-gray-600">{event.event_time} â€¢ {event.location}</div>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  event.event_type === 'game' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                }`}>
                  {event.event_type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Info */}
      {teamInfo && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Users size={20} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">My Team</h3>
          </div>
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center text-white text-2xl font-bold">
              {teamInfo.name}
            </div>
            <div>
              <h4 className="text-xl font-semibold text-gray-900">{teamInfo.name}</h4>
              {teamInfo.description && (
                <p className="text-sm text-gray-600 mt-1">{teamInfo.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
