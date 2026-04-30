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
import ManageAthletes from './ManageAthletes';
import ManageCoaches from './ManageCoaches';
import WaiverPage from './WaiverPage';
import { Users, Calendar, BarChart3, BookOpen, MessageSquare, Settings, TrendingUp, Activity, Target, Wrench, Bell, Clock, UserCog, FileText } from 'lucide-react';
import './App.css';

const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [currentView, setCurrentView] = useState('dashboard');
  const [waiverSigned, setWaiverSigned] = useState(null);

  const checkWaiverStatus = async (uid) => {
    const { data } = await supabase
      .from('waiver_signatures')
      .select('id')
      .eq('user_id', uid)
      .maybeSingle();
    setWaiverSigned(!!data);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        setUserId(session.user.id);
        fetchUserRole(session.user.id);
        checkWaiverStatus(session.user.id);
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
        checkWaiverStatus(session.user.id);
      } else {
        setUserRole(null);
        setUserId(null);
        setWaiverSigned(null);
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
        waiverSigned={waiverSigned}
        setWaiverSigned={setWaiverSigned}
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

function MainApp({ userRole, userId, userName, userAvatar, onLogout, currentView, setCurrentView, waiverSigned, setWaiverSigned }) {
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
        waiverSigned={waiverSigned}
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
                <PlayerDashboard userId={userId} waiverSigned={waiverSigned} setCurrentView={setCurrentView} />
              ) : (
                <AdminDashboard userId={userId} userRole={userRole} setCurrentView={setCurrentView} />
              )
            )}
            {currentView === 'profile' && <Profile userId={userId} userRole={userRole} />}
            {currentView === 'profile-view' && viewProfileUserId && <Profile userId={viewProfileUserId} userRole={userRole} onBack={() => setCurrentView('settings')} />}
            {currentView === 'team' && <MyTeam userId={userId} userRole={userRole} />}
            {currentView === 'schedule' && <Schedule userId={userId} userRole={userRole} />}
            {currentView === 'knowledge' && <KnowledgeBase userId={userId} userRole={userRole} />}
            {currentView === 'messages' && <Messages userId={userId} userRole={userRole} />}
            {currentView === 'manage-athletes' && <ManageAthletes userId={userId} userRole={userRole} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'manage-coaches' && <ManageCoaches userId={userId} userRole={userRole} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'coach-tools' && <CoachTools userRole={userRole} userId={userId} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'waiver' && <WaiverPage userId={userId} userRole={userRole} onSigned={() => setWaiverSigned(true)} />}
            {currentView === 'settings' && <AdminSettings userId={userId} userRole={userRole} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ userRole, userName, userAvatar, currentView, setCurrentView, onLogout, unreadMessageCount = 0, pendingSlotCount = 0, waiverSigned }) {
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
          onClick={() => setCurrentView('waiver')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'waiver' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <FileText size={20} />
          <span className="flex-1 text-left">Waiver</span>
          {waiverSigned === false && (
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full flex-shrink-0"></span>
          )}
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
          <span className="flex-1 text-left">Communication</span>
          {unreadMessageCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</span>
          )}
        </button>

        {(userRole === 'admin' || userRole === 'coach') && (
          <>
            <button
              onClick={() => setCurrentView('manage-athletes')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
                currentView === 'manage-athletes' ? 'bg-blue-600' : 'hover:bg-gray-800'
              }`}
            >
              <Users size={20} />
              <span>Manage Athletes</span>
            </button>

            {userRole === 'admin' && (
              <button
                onClick={() => setCurrentView('manage-coaches')}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
                  currentView === 'manage-coaches' ? 'bg-blue-600' : 'hover:bg-gray-800'
                }`}
              >
                <UserCog size={20} />
                <span>Manage Coaches</span>
              </button>
            )}

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
  const [todayFacilityEvents, setTodayFacilityEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };

  useEffect(() => {
    if (userId) {
      fetchTrainingSessions();
      fetchTodayFacilityEvents();
      fetchNotifications();
    }
  }, [userId]);

  const fetchTodayFacilityEvents = async () => {
    const today = fmtLocalDate(new Date());
    const todayDow = new Date().getDay();

    const { data: nonRecurring } = await supabase.from('facility_events').select('*').eq('is_recurring', false).is('recurrence_parent_id', null).eq('event_date', today);
    const { data: masters } = await supabase.from('facility_events').select('*').eq('is_recurring', true).is('recurrence_parent_id', null);

    const events = [...(nonRecurring || [])];
    (masters || []).forEach(master => {
      const masterDate = new Date(master.event_date + 'T00:00:00');
      const todayDate = new Date(today + 'T00:00:00');
      if (todayDate >= masterDate) {
        const masterDow = masterDate.getDay();
        if (masterDow === todayDow) {
          if (!master.recurrence_end_date || todayDate <= new Date(master.recurrence_end_date + 'T00:00:00')) {
            events.push({ ...master, event_date: today });
          }
        }
      }
    });
    events.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    setTodayFacilityEvents(events);
  };

  const fetchNotifications = async () => {
    const notifs = [];

    // Unread messages
    try {
      const { data: participantRows } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', userId);
      const convIds = (participantRows || []).map(p => p.conversation_id);
      if (convIds.length > 0) {
        const { data: allMessages } = await supabase.from('messages').select('id, content, created_at, sender_id, users:sender_id(full_name)').in('conversation_id', convIds).neq('sender_id', userId).order('created_at', { ascending: false }).limit(10);
        const msgIds = (allMessages || []).map(m => m.id);
        let readIds = new Set();
        if (msgIds.length > 0) {
          const { data: reads } = await supabase.from('message_reads').select('message_id').eq('user_id', userId).in('message_id', msgIds);
          readIds = new Set((reads || []).map(r => r.message_id));
        }
        (allMessages || []).filter(m => !readIds.has(m.id)).slice(0, 5).forEach(m => {
          notifs.push({ id: m.id, type: 'message', text: `${m.users?.full_name || 'Someone'} sent you a message`, detail: m.content?.substring(0, 60) || '', time: m.created_at });
        });
      }
    } catch (err) { console.error('Error fetching message notifications:', err); }

    notifs.sort((a, b) => new Date(b.time) - new Date(a.time));
    setNotifications(notifs);
  };

  const fetchTrainingSessions = async () => {
    setLoadingSlots(true);
    const today = fmtLocalDate(new Date());
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

    const pending = allReservations.filter(r => r.status === 'pending');
    const pendingWithSlot = pending.map(r => {
      const slot = slots.find(s => s.id === r.slot_id);
      return { ...r, slot };
    });
    setPendingRequests(pendingWithSlot);

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

    const confirmed = allReservations.filter(r =>
      r.status === 'confirmed' &&
      todaySlots.some(s => s.id === r.slot_id && (r.slot_date === today || s.slot_date === today || s.repeat_weekly))
    );
    const confirmedWithSlot = confirmed.map(r => {
      const slot = todaySlots.find(s => s.id === r.slot_id);
      return { ...r, slot };
    });
    setTodaySessions(confirmedWithSlot);

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

  const getNotifIcon = (type) => {
    switch (type) {
      case 'message': return <MessageSquare size={16} className="text-blue-500" />;
      case 'pending': return <Clock size={16} className="text-yellow-500" />;
      default: return <Bell size={16} className="text-green-500" />;
    }
  };

  // Build combined today's schedule from facility events + training sessions
  const todayScheduleItems = [];
  todayFacilityEvents.forEach(e => {
    todayScheduleItems.push({ id: e.id, title: e.title || 'Facility Event', time: e.start_time, type: 'facility', location: e.location });
  });
  todaySessions.forEach(s => {
    todayScheduleItems.push({ id: s.id, title: `Session: ${s.users?.full_name || 'Player'}`, time: s.slot?.start_time, type: 'training', duration: s.slot?.duration_minutes });
  });
  openSlots.forEach(s => {
    todayScheduleItems.push({ id: s.id, title: 'Open Slot', time: s.start_time, type: 'open', duration: s.duration_minutes });
  });
  todayScheduleItems.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const getTypeColor = (type) => {
    switch (type) {
      case 'facility': return 'bg-purple-100 text-purple-700';
      case 'training': return 'bg-green-100 text-green-700';
      case 'open': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-600 mt-1">Welcome to Natural Ball Player</p>
      </div>

      {/* Quick Actions */}
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

      {/* Pending Slot Requests */}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Schedule */}
        <div className="bg-white rounded-lg shadow">
          <div className="flex items-center space-x-2 p-6 pb-4 border-b border-gray-100">
            <Calendar size={20} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">Today's Schedule</h3>
          </div>
          <div className="p-6 pt-4">
            {todayScheduleItems.length > 0 ? (
              <div className="space-y-3">
                {todayScheduleItems.map((item, idx) => (
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
            <p className="text-gray-500">Team and player performance stats will appear here.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

