import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import AdminSettings from './AdminSettings';
import PlayerDashboard from './PlayerDashboard';
import CoachTools from './CoachTools';
import Messages from './Messages';
import KnowledgeBase from './KnowledgeBase';
import MyTeam from './MyTeam';
import Profile from './Profile';
import Schedule from './Schedule';
import { Users, Calendar, BarChart3, BookOpen, MessageSquare, Settings, TrendingUp, Activity, Target, Wrench } from 'lucide-react';
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

  const fetchUserRole = async (userId) => {
    const { data, error } = await supabase
      .from('users')
      .select('role, full_name')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user role:', error);
    } else {
      setUserRole(data.role);
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

function MainApp({ userRole, userId, onLogout, currentView, setCurrentView }) {
  return (
    <div className="flex">
      <Sidebar 
        userRole={userRole} 
        currentView={currentView}
        setCurrentView={setCurrentView}
        onLogout={onLogout}
      />
      <div className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto">
          {currentView === 'dashboard' && (
            userRole === 'player' ? (
              <PlayerDashboard userId={userId} />
            ) : (
              <AdminDashboard />
            )
          )}
          {currentView === 'profile' && <Profile userId={userId} />}
          {currentView === 'team' && <MyTeam userId={userId} />}
          {currentView === 'schedule' && <Schedule userId={userId} userRole={userRole} />}
          {currentView === 'knowledge' && <KnowledgeBase userId={userId} userRole={userRole} />}
          {currentView === 'messages' && <Messages userId={userId} userRole={userRole} />}
          {currentView === 'coach-tools' && <CoachTools userRole={userRole} />}
          {currentView === 'settings' && <AdminSettings />}
        </div>
      </div>
    </div>
  );
}

function Sidebar({ userRole, currentView, setCurrentView, onLogout }) {
  return (
    <div className="w-64 bg-gray-900 text-white h-screen fixed left-0 top-0 p-6 flex flex-col">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-blue-400">Natural Ball Player</h1>
        <p className="text-sm text-gray-400 mt-1">{userRole?.toUpperCase()}</p>
      </div>

      <nav className="space-y-2 flex-1">
        <button 
          onClick={() => setCurrentView('dashboard')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
            currentView === 'dashboard' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <BarChart3 size={20} />
          <span>Dashboard</span>
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
          <span>Messages</span>
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

function AdminDashboard() {
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
          <button className="text-left p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition">
            <div className="font-medium text-blue-900">Go to Coach Tools</div>
            <div className="text-sm text-blue-600 mt-1">Add stats, schedules, and training programs</div>
          </button>
          <button className="text-left p-4 bg-green-50 rounded-lg hover:bg-green-100 transition">
            <div className="font-medium text-green-900">Manage Users & Teams</div>
            <div className="text-sm text-green-600 mt-1">Create players, coaches, and teams</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function ComingSoon({ title }) {
  return (
    <div className="bg-white rounded-lg shadow p-12 text-center">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">{title}</h2>
      <p className="text-gray-600">This section is under development</p>
    </div>
  );
}
