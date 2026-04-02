import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Calendar, Bell, BarChart3, Clock, MessageSquare, CheckCircle } from 'lucide-react';

export default function PlayerDashboard({ userId }) {
  const [loading, setLoading] = useState(true);
  const [playerData, setPlayerData] = useState(null);
  const [todaySchedule, setTodaySchedule] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };

  useEffect(() => {
    fetchDashboardData();
  }, [userId]);

  const fetchDashboardData = async () => {
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

      const today = new Date().toISOString().split('T')[0];
      const todayDow = new Date().getDay();

      // Fetch today's schedule events for the player
      const { data: scheduleEvents } = await supabase
        .from('schedule_events')
        .select('*')
        .eq('player_id', userId)
        .eq('event_date', today);

      // Fetch facility events for today (non-recurring)
      const { data: facilityNonRecurring } = await supabase
        .from('facility_events')
        .select('*')
        .eq('is_recurring', false)
        .is('recurrence_parent_id', null)
        .eq('event_date', today);

      // Fetch recurring facility events that might apply today
      const { data: facilityMasters } = await supabase
        .from('facility_events')
        .select('*')
        .eq('is_recurring', true)
        .is('recurrence_parent_id', null);

      const todayFacility = [...(facilityNonRecurring || [])];
      (facilityMasters || []).forEach(master => {
        const masterDate = new Date(master.event_date + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        if (todayDate >= masterDate) {
          const masterDow = masterDate.getDay();
          if (masterDow === todayDow) {
            if (!master.recurrence_end_date || todayDate <= new Date(master.recurrence_end_date + 'T00:00:00')) {
              todayFacility.push({ ...master, event_date: today });
            }
          }
        }
      });

      // Fetch player's confirmed training slot reservations
      const { data: myReservations } = await supabase
        .from('slot_reservations')
        .select('*, training_slots(*)')
        .eq('player_id', userId)
        .eq('status', 'confirmed');

      const todaySlots = (myReservations || []).filter(r => {
        const slot = r.training_slots;
        if (!slot) return false;
        if (slot.slot_date === today) return true;
        if (slot.repeat_weekly) {
          const slotDow = new Date(slot.slot_date + 'T00:00:00').getDay();
          if (slotDow === todayDow) {
            const slotStart = new Date(slot.slot_date + 'T00:00:00');
            const todayDate = new Date(today + 'T00:00:00');
            if (todayDate >= slotStart) {
              if (!slot.repeat_end_date || todayDate <= new Date(slot.repeat_end_date + 'T00:00:00')) return true;
            }
          }
        }
        return false;
      });

      // Combine all schedule items
      const allSchedule = [];

      (scheduleEvents || []).forEach(e => {
        allSchedule.push({
          id: e.id,
          title: e.opponent || e.event_type || 'Event',
          time: e.event_time,
          type: e.event_type || 'event',
          location: e.location,
        });
      });

      todayFacility.forEach(e => {
        allSchedule.push({
          id: e.id,
          title: e.title || 'Facility Event',
          time: e.start_time,
          type: 'facility',
          location: e.location,
        });
      });

      todaySlots.forEach(r => {
        const slot = r.training_slots;
        allSchedule.push({
          id: r.id,
          title: 'Training Session',
          time: slot.start_time,
          type: 'training',
          duration: slot.duration_minutes,
        });
      });

      allSchedule.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      setTodaySchedule(allSchedule);

      // Fetch notifications: unread messages + pending slot statuses
      const notifs = [];

      // Unread messages
      const { data: participantRows } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId);

      const convIds = (participantRows || []).map(p => p.conversation_id);
      if (convIds.length > 0) {
        const { data: allMessages } = await supabase
          .from('messages')
          .select('id, content, created_at, sender_id, users:sender_id(full_name)')
          .in('conversation_id', convIds)
          .neq('sender_id', userId)
          .order('created_at', { ascending: false })
          .limit(10);

        const msgIds = (allMessages || []).map(m => m.id);
        let readIds = new Set();
        if (msgIds.length > 0) {
          const { data: reads } = await supabase
            .from('message_reads')
            .select('message_id')
            .eq('user_id', userId)
            .in('message_id', msgIds);
          readIds = new Set((reads || []).map(r => r.message_id));
        }

        (allMessages || []).filter(m => !readIds.has(m.id)).slice(0, 5).forEach(m => {
          notifs.push({
            id: m.id,
            type: 'message',
            text: `${m.users?.full_name || 'Someone'} sent you a message`,
            detail: m.content?.substring(0, 60) || '',
            time: m.created_at,
          });
        });
      }

      // Pending slot requests (player's own)
      const { data: pendingReservations } = await supabase
        .from('slot_reservations')
        .select('*, training_slots(*)')
        .eq('player_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5);

      (pendingReservations || []).forEach(r => {
        notifs.push({
          id: r.id,
          type: 'pending',
          text: 'Training slot request pending',
          detail: r.training_slots?.start_time ? `${new Date(r.training_slots.slot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${formatTime(r.training_slots.start_time)}` : '',
          time: r.created_at,
        });
      });

      notifs.sort((a, b) => new Date(b.time) - new Date(a.time));
      setNotifications(notifs);

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
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

  const profile = playerData.player_profiles?.[0] || playerData.player_profiles;
  const teamInfo = playerData.team_members?.[0]?.teams;

  const getTypeColor = (type) => {
    switch (type) {
      case 'game': return 'bg-blue-100 text-blue-700';
      case 'training': return 'bg-green-100 text-green-700';
      case 'facility': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getNotifIcon = (type) => {
    switch (type) {
      case 'message': return <MessageSquare size={16} className="text-blue-500" />;
      case 'pending': return <Clock size={16} className="text-yellow-500" />;
      default: return <CheckCircle size={16} className="text-green-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h2 className="text-3xl font-bold text-gray-900">
          Welcome back, {playerData.full_name.split(' ')[0]}!
        </h2>
        <p className="text-gray-600 mt-1">Here's your overview for today</p>
      </div>

      {/* Player Info Card */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-6 text-white">
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
                  <span>&bull;</span>
                  <span>{teamInfo.name}</span>
                </>
              )}
            </div>
            {profile && (
              <div className="mt-2 flex items-center space-x-4 text-sm text-blue-100">
                {profile.grade && <span>Grade: {profile.grade}</span>}
                {profile.bats && <><span>&bull;</span><span>Bats: {profile.bats}</span></>}
                {profile.throws && <><span>&bull;</span><span>Throws: {profile.throws}</span></>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Schedule */}
        <div className="bg-white rounded-lg shadow">
          <div className="flex items-center space-x-2 p-6 pb-4 border-b border-gray-100">
            <Calendar size={20} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">Today's Schedule</h3>
          </div>
          <div className="p-6 pt-4">
            {todaySchedule.length > 0 ? (
              <div className="space-y-3">
                {todaySchedule.map((item, idx) => (
                  <div key={item.id || idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="text-sm font-semibold text-gray-700 min-w-[70px]">
                        {item.time ? formatTime(item.time) : 'TBD'}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{item.title}</p>
                        {item.location && <p className="text-xs text-gray-500">{item.location}</p>}
                        {item.duration && <p className="text-xs text-gray-500">{item.duration} min</p>}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${getTypeColor(item.type)}`}>
                      {item.type}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Calendar className="mx-auto text-gray-300 mb-3" size={36} />
                <p className="text-gray-500">No events scheduled for today</p>
              </div>
            )}
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-lg shadow">
          <div className="flex items-center space-x-2 p-6 pb-4 border-b border-gray-100">
            <Bell size={20} className="text-orange-500" />
            <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
            {notifications.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs font-medium px-2 py-0.5 rounded-full">{notifications.length}</span>
            )}
          </div>
          <div className="p-6 pt-4">
            {notifications.length > 0 ? (
              <div className="space-y-3">
                {notifications.map((notif, idx) => (
                  <div key={notif.id || idx} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                    <div className="mt-0.5">{getNotifIcon(notif.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{notif.text}</p>
                      {notif.detail && <p className="text-xs text-gray-500 mt-0.5 truncate">{notif.detail}</p>}
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(notif.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at{' '}
                        {new Date(notif.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Bell className="mx-auto text-gray-300 mb-3" size={36} />
                <p className="text-gray-500">No new notifications</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Placeholder */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center space-x-2 p-6 pb-4 border-b border-gray-100">
          <BarChart3 size={20} className="text-green-600" />
          <h3 className="text-lg font-semibold text-gray-900">Stats</h3>
        </div>
        <div className="p-6 pt-4">
          <div className="text-center py-12">
            <BarChart3 className="mx-auto text-gray-300 mb-4" size={48} />
            <h4 className="text-lg font-semibold text-gray-900 mb-2">Coming Soon</h4>
            <p className="text-gray-500">Your performance stats will appear here.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
