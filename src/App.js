import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import AdminSettings from './AdminSettings';
import PlayerDashboard from './PlayerDashboard';
import CoachTools from './CoachTools';
import Profile from './Profile';
import Schedule from './Schedule';
import Messages from './Messages';
import MyTeam from './MyTeam';
import KnowledgeBase from './KnowledgeBase';
import { Users, Calendar, BarChart3, BookOpen, MessageSquare, Settings, TrendingUp, Activity, Target, Wrench, Bell, Clock } from 'lucide-react';
import './App.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [currentView, setCurrentView] = useState('dashboard');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        setUserId(session.user.id);
        fetchUserRole(session.user.id);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setUserId(session.user.id);
        fetchUserRole(session.user.id);
      } else {
        setUserRole(null);
        setUserId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const [userName, setUserName] = useState('');
  const [userAvatar, setUserAvatar] = useState(null);

  const fetchUserRole = async (userId) => {
    const { data, error } = await supabase
      .from('users')
      .select('role, full_name, avatar_url')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user role:', error);
    } else {
      setUserRole(data.role);
      setUserName(data.full_name || '');
      setUserAvatar(data.avatar_url || null);
    }
  };

  const handleLogin = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert('Error logging in: ' + error.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentView('dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">âš¾</div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="bg-gray-100 min-h-screen">
      <MainApp
        userRole={userRole}
        userId={userId}
        userName={userName}
        userAvatar={userAvatar}
        onLogout={handleLogout}
        currentView={currentView}
        setCurrentView={setCurrentView}
      />
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin(email, password);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">âš¾</div>
          <h1 className="text-3xl font-bold text-gray-900">Natural Ball Player</h1>
          <p className="text-gray-600 mt-2">Training Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

function MainApp({ userRole, userId, userName, userAvatar, onLogout, currentView, setCurrentView }) {
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [pendingSlotCount, setPendingSlotCount] = useState(0);
  const [pendingSlotDetails, setPendingSlotDetails] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [viewProfileUserId, setViewProfileUserId] = useState(null);
  const notifRef = useRef(null);

  const fetchNotificationCounts = useCallback(async () => {
    if (!userId) return;

    // Unread messages: messages in user's conversations not sent by them and not in message_reads
    try {
      const { data: participantRows } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId);

      const convIds = (participantRows || []).map(p => p.conversation_id);
      if (convIds.length > 0) {
        const { data: allMessages } = await supabase
          .from('messages')
          .select('id')
          .in('conversation_id', convIds)
          .neq('sender_id', userId);

        const msgIds = (allMessages || []).map(m => m.id);
        if (msgIds.length > 0) {
          const { data: reads } = await supabase
            .from('message_reads')
            .select('message_id')
            .eq('user_id', userId)
            .in('message_id', msgIds);

          const readIds = new Set((reads || []).map(r => r.message_id));
          setUnreadMessageCount(msgIds.filter(id => !readIds.has(id)).length);
        } else {
          setUnreadMessageCount(0);
        }
      } else {
        setUnreadMessageCount(0);
      }
    } catch (err) {
      console.error('Error fetching unread messages:', err);
    }

    // Pending slot requests (coaches/admins only)
    if (userRole === 'coach' || userRole === 'admin') {
      try {
        const { data: slots } = await supabase
          .from('training_slots')
          .select('id, slot_date, start_time')
          .eq('coach_id', userId);

        const slotIds = (slots || []).map(s => s.id);
        if (slotIds.length > 0) {
          const { data: pending } = await supabase
            .from('slot_reservations')
            .select('id, slot_id, slot_date, users:player_id(full_name)')
            .in('slot_id', slotIds)
            .eq('status', 'pending');

          const details = (pending || []).map(p => {
            const slot = slots.find(s => s.id === p.slot_id);
            return { ...p, slot };
          });
          setPendingSlotCount(details.length);
          setPendingSlotDetails(details);
        } else {
          setPendingSlotCount(0);
          setPendingSlotDetails([]);
        }
      } catch (err) {
        console.error('Error fetching pending slots:', err);
      }
    }
  }, [userId, userRole]);

  // Re-fetch counts when switching tabs (e.g., Messages marks reads, Coach Tools confirms slots)
  useEffect(() => {
    const timer = setTimeout(() => fetchNotificationCounts(), 500);
    return () => clearTimeout(timer);
  }, [currentView]);

  useEffect(() => {
    fetchNotificationCounts();

    // Realtime subscriptions
    const msgChannel = supabase.channel('notif-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => fetchNotificationCounts())
      .subscribe();

    const slotChannel = supabase.channel('notif-slots')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slot_reservations' }, () => fetchNotificationCounts())
      .subscribe();

    const readChannel = supabase.channel('notif-reads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, () => fetchNotificationCounts())
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(slotChannel);
      supabase.removeChannel(readChannel);
    };
  }, [fetchNotificationCounts]);

  // Click-outside handler
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const totalNotifCount = unreadMessageCount + pendingSlotCount;

  return (
    <div className="flex">
      <Sidebar
        userRole={userRole}
        userName={userName}
        userAvatar={userAvatar}
        currentView={currentView}
        setCurrentView={setCurrentView}
        onLogout={onLogout}
        unreadMessageCount={unreadMessageCount}
        pendingSlotCount={pendingSlotCount}
      />
      <div className="flex-1 ml-64">
        {/* Sticky header with notification bell */}
        <div className="sticky top-0 z-40 bg-white border-b px-8 py-3 flex justify-end">
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            >
              <Bell size={22} />
              {totalNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
                  {totalNotifCount > 99 ? '99+' : totalNotifCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h4 className="font-semibold text-gray-900 text-sm">Notifications</h4>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {pendingSlotDetails.map(req => (
                    <button
                      key={req.id}
                      onClick={() => { setCurrentView('coach-tools'); setShowNotifications(false); }}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
                    >
                      <div className="flex items-start space-x-3">
                        <div className="mt-0.5"><Clock size={16} className="text-yellow-500" /></div>
                        <div>
                          <p className="text-sm text-gray-900"><span className="font-medium">{req.users?.full_name || 'A player'}</span> requested a training session</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {req.slot?.slot_date && new Date(req.slot.slot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {req.slot?.start_time && ` at ${(() => { const [h, m] = req.slot.start_time.split(':'); const hour = parseInt(h); return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`; })()}`}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                  {unreadMessageCount > 0 && (
                    <button
                      onClick={() => { setCurrentView('messages'); setShowNotifications(false); }}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
                    >
                      <div className="flex items-start space-x-3">
                        <div className="mt-0.5"><MessageSquare size={16} className="text-blue-500" /></div>
                        <div>
                          <p className="text-sm text-gray-900">You have <span className="font-medium">{unreadMessageCount} unread message{unreadMessageCount !== 1 ? 's' : ''}</span></p>
                        </div>
                      </div>
                    </button>
                  )}
                  {totalNotifCount === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">No new notifications</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="p-8">
          <div className="max-w-7xl mx-auto">
            {currentView === 'dashboard' && (
              userRole === 'player' ? (
                <PlayerDashboard userId={userId} />
              ) : (
                <AdminDashboard userId={userId} userRole={userRole} setCurrentView={setCurrentView} />
              )
            )}
            {currentView === 'profile' && <Profile userId={userId} />}
            {currentView === 'profile-view' && viewProfileUserId && <Profile userId={viewProfileUserId} />}
            {currentView === 'team' && <MyTeam userId={userId} userRole={userRole} />}
            {currentView === 'schedule' && <Schedule userId={userId} userRole={userRole} />}
            {currentView === 'knowledge' && <KnowledgeBase userId={userId} userRole={userRole} />}
            {currentView === 'messages' && <Messages userId={userId} userRole={userRole} />}
            {currentView === 'coach-tools' && <CoachTools userRole={userRole} userId={userId} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'settings' && <AdminSettings userId={userId} userRole={userRole} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ userRole, userName, userAvatar, currentView, setCurrentView, onLogout, unreadMessageCount = 0, pendingSlotCount = 0 }) {
  return (
    <div className="w-64 bg-gray-900 text-white h-screen fixed left-0 top-0 p-6 flex flex-col">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-blue-400">Natural Ball Player</h1>
        <div className="flex items-center space-x-3 mt-3">
          {userAvatar ? (
            <img src={userAvatar} alt="Avatar" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
              {userName?.charAt(0) || '?'}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-200 truncate">{userName || 'User'}</p>
            <p className="text-xs text-gray-400">{userRole?.toUpperCase()}</p>
          </div>
        </div>
      </div>

      <nav className="space-y-2 flex-1">
        <button
          onClick={() => setCurrentView('dashboard')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'dashboard' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <BarChart3 size={20} />
          <span className="flex-1 text-left">Dashboard</span>
          {(userRole === 'coach' || userRole === 'admin') && pendingSlotCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">{pendingSlotCount}</span>
          )}
        </button>

        <button 
          onClick={() => setCurrentView('profile')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'profile' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <Users size={20} />
          <span>Profile</span>
        </button>

        <button 
          onClick={() => setCurrentView('team')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'team' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <Users size={20} />
          <span>My Team</span>
        </button>

        <button 
          onClick={() => setCurrentView('schedule')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'schedule' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <Calendar size={20} />
          <span>Schedule</span>
        </button>

        <button 
          onClick={() => setCurrentView('knowledge')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'knowledge' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <BookOpen size={20} />
          <span>Knowledge Base</span>
        </button>

        <button
          onClick={() => setCurrentView('messages')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'messages' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <MessageSquare size={20} />
          <span className="flex-1 text-left">Messages</span>
          {unreadMessageCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</span>
          )}
        </button>

        {(userRole === 'admin' || userRole === 'coach') && (
          <>
            <button 
              onClick={() => setCurrentView('coach-tools')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
                currentView === 'coach-tools' ? 'bg-blue-600' : 'hover:bg-gray-800'
              }`}
            >
              <Wrench size={20} />
              <span>Coach Tools</span>
            </button>

            <button 
              onClick={() => setCurrentView('settings')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
                currentView === 'settings' ? 'bg-blue-600' : 'hover:bg-gray-800'
              }`}
            >
              <Settings size={20} />
              <span>Settings</span>
            </button>
          </>
        )}
      </nav>

      <div className="mt-auto">
        <button
          onClick={onLogout}
          className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

function AdminDashboard({ userId, userRole, setCurrentView }) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [todaySessions, setTodaySessions] = useState([]);
  const [openSlots, setOpenSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };

  useEffect(() => {
    if (userId) fetchTrainingSessions();
  }, [userId]);

  const fetchTrainingSessions = async () => {
    setLoadingSlots(true);
    const today = new Date().toISOString().split('T')[0];
    const todayDow = new Date().getDay();

    const { data: slots } = await supabase
      .from('training_slots')
      .select('*')
      .eq('coach_id', userId);

    if (!slots || slots.length === 0) { setLoadingSlots(false); return; }

    const slotIds = slots.map(s => s.id);
    const { data: reservations } = await supabase
      .from('slot_reservations')
      .select('*, users:player_id(full_name, email)')
      .in('slot_id', slotIds);

    const allReservations = reservations || [];

    // Pending requests (any date)
    const pending = allReservations.filter(r => r.status === 'pending');
    // Attach slot info to pending
    const pendingWithSlot = pending.map(r => {
      const slot = slots.find(s => s.id === r.slot_id);
      return { ...r, slot };
    });
    setPendingRequests(pendingWithSlot);

    // Determine which slots apply today (direct date match OR weekly recurring match)
    const todaySlots = slots.filter(slot => {
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

    // Today's confirmed sessions
    const confirmed = allReservations.filter(r =>
      r.status === 'confirmed' &&
      todaySlots.some(s => s.id === r.slot_id && (r.slot_date === today || s.slot_date === today || s.repeat_weekly))
    );
    const confirmedWithSlot = confirmed.map(r => {
      const slot = todaySlots.find(s => s.id === r.slot_id);
      return { ...r, slot };
    });
    setTodaySessions(confirmedWithSlot);

    // Open slots today (not fully booked)
    const open = todaySlots.filter(slot => {
      const slotRes = allReservations.filter(r => r.slot_id === slot.id && r.status === 'confirmed');
      return slotRes.length < (slot.max_players || 1);
    });
    setOpenSlots(open);

    setLoadingSlots(false);
  };

  const handleConfirm = async (reservationId) => {
    await supabase.from('slot_reservations').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', reservationId);
    fetchTrainingSessions();
  };

  const handleDecline = async (reservationId) => {
    await supabase.from('slot_reservations').update({ status: 'declined' }).eq('id', reservationId);
    fetchTrainingSessions();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-600 mt-1">Welcome to Natural Ball Player</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Performance</h3>
            <TrendingUp className="text-blue-600" size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-900">Connected</p>
          <p className="text-sm text-gray-600 mt-1">Database is live</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Status</h3>
            <Activity className="text-green-600" size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-900">Active</p>
          <p className="text-sm text-gray-600 mt-1">System operational</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Progress</h3>
            <Target className="text-orange-600" size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-900">MVP Complete</p>
          <p className="text-sm text-gray-600 mt-1">Data entry ready</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button onClick={() => setCurrentView('coach-tools')} className="text-left p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition">
            <div className="font-medium text-blue-900">Go to Coach Tools</div>
            <div className="text-sm text-blue-600 mt-1">Add stats, schedules, and training programs</div>
          </button>
          <button onClick={() => setCurrentView('settings')} className="text-left p-4 bg-green-50 rounded-lg hover:bg-green-100 transition">
            <div className="font-medium text-green-900">Manage Users & Teams</div>
            <div className="text-sm text-green-600 mt-1">Create players, coaches, and teams</div>
          </button>
        </div>
      </div>

      {/* Training Sessions Section */}
      {!loadingSlots && (pendingRequests.length > 0 || todaySessions.length > 0 || openSlots.length > 0) && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Training Sessions</h3>

          {pendingRequests.length > 0 && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="bg-yellow-500 px-6 py-3">
                <h4 className="text-sm font-semibold text-white">Slot Requests ({pendingRequests.length})</h4>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingRequests.map(req => (
                  <div key={req.id} className="px-6 py-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900">{req.users?.full_name || 'Unknown'}</span>
                      <span className="text-sm text-gray-500 ml-2">
                        {req.slot?.slot_date && new Date(req.slot.slot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {req.slot?.start_time && ` at ${formatTime(req.slot.start_time)}`}
                      </span>
                      {req.player_note && <span className="text-xs text-gray-400 ml-2">"{req.player_note}"</span>}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button onClick={() => handleConfirm(req.id)} className="px-3 py-1 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200 transition">Confirm</button>
                      <button onClick={() => handleDecline(req.id)} className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition">Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {todaySessions.length > 0 && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="bg-green-500 px-6 py-3">
                <h4 className="text-sm font-semibold text-white">Today's Sessions ({todaySessions.length})</h4>
              </div>
              <div className="divide-y divide-gray-100">
                {todaySessions.map(session => (
                  <div key={session.id} className="px-6 py-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900">{session.users?.full_name || 'Unknown'}</span>
                      <span className="text-sm text-gray-500 ml-2">{session.slot?.start_time && formatTime(session.slot.start_time)} - {session.slot?.duration_minutes} min</span>
                    </div>
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">Confirmed</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {openSlots.length > 0 && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="bg-blue-500 px-6 py-3">
                <h4 className="text-sm font-semibold text-white">Open Slots Today ({openSlots.length})</h4>
              </div>
              <div className="divide-y divide-gray-100">
                {openSlots.map(slot => (
                  <div key={slot.id} className="px-6 py-3">
                    <span className="font-medium text-gray-900">{formatTime(slot.start_time)}</span>
                    <span className="text-sm text-gray-500 ml-2">{slot.duration_minutes} min</span>
                    {slot.notes && <span className="text-sm text-gray-400 ml-2">- {slot.notes}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

