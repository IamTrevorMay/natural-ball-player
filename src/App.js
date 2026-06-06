import React, { useState, useEffect } from 'react';
import { supabase, supabaseUrl, supabaseAnonKey } from './supabaseClient';
import AdminSettings from './AdminSettings';
import PlayerDashboard from './PlayerDashboard';
import CoachTools from './CoachTools';
import Profile from './Profile';
import Schedule from './Schedule';
import Messages from './Messages';
import MyTeam from './MyTeam';
import KnowledgeBase from './KnowledgeBase';
import Fields from './Fields';
import ManageAthletes from './ManageAthletes';
import ManageCoaches from './ManageCoaches';
import WaiverPage from './WaiverPage';
import ContractPage from './ContractPage';
import FacilityFinePage from './FacilityFinePage';
import LetterOfIntentPage from './LetterOfIntentPage';
import WorkPortalShell from './WorkPortal';
import NotificationBell from './NotificationBell';
import { useMainPortalCounts, useWorkPortalCounts } from './useNotifications';
import { Users, Calendar, BarChart3, BookOpen, MessageSquare, Settings, TrendingUp, Activity, Target, Wrench, Bell, Clock, UserCog, FileText, FolderOpen, ChevronDown, ChevronRight, Briefcase, Mail, Lock, ArrowLeft, Menu, X, MapPin } from 'lucide-react';
import './App.css';

const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [secondaryRole, setSecondaryRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [currentView, setCurrentView] = useState('dashboard');
  const [workPortalView, setWorkPortalView] = useState('work-home');
  const [waiverSigned, setWaiverSigned] = useState(null);
  const [contractSigned, setContractSigned] = useState(null);
  const [loiSigned, setLoiSigned] = useState(null);
  const [facilityFineSigned, setFacilityFineSigned] = useState(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [currentPortal, setCurrentPortal] = useState(() => {
    try {
      return localStorage.getItem('nbp_current_portal') || 'main';
    } catch {
      return 'main';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('nbp_current_portal', currentPortal);
    } catch {}
  }, [currentPortal]);

  useEffect(() => {
    if (userRole === 'player' && currentPortal === 'work') {
      setCurrentPortal('main');
    }
  }, [userRole, currentPortal]);

  const checkWaiverStatus = async (uid) => {
    const { data } = await supabase
      .from('waiver_signatures')
      .select('id')
      .eq('user_id', uid)
      .maybeSingle();
    setWaiverSigned(!!data);
  };

  const checkContractStatus = async (uid) => {
    const { data } = await supabase
      .from('player_contracts')
      .select('id')
      .eq('user_id', uid)
      .maybeSingle();
    setContractSigned(!!data);
  };

  const checkLoiStatus = async (uid) => {
    const { data } = await supabase
      .from('player_letters_of_intent')
      .select('id')
      .eq('user_id', uid)
      .maybeSingle();
    setLoiSigned(!!data);
  };

  const checkFacilityFineStatus = async (uid) => {
    // Find the most recent uploaded "Facility Fine" document. If none exists,
    // mark as signed (nothing to nag about). If it exists, check whether this
    // user has signed THIS document — re-uploading a new version of the doc
    // resets the prompt for everyone.
    const { data: docRows } = await supabase
      .from('staff_documents')
      .select('id')
      .ilike('title', 'Facility Fine%')
      .order('created_at', { ascending: false })
      .limit(1);
    const doc = docRows && docRows[0];
    if (!doc) { setFacilityFineSigned(true); return; }
    const { data } = await supabase
      .from('facility_fine_signatures')
      .select('id')
      .eq('user_id', uid)
      .eq('document_id', doc.id)
      .maybeSingle();
    setFacilityFineSigned(!!data);
  };

  useEffect(() => {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const isRecoveryUrl = hash.includes('type=recovery') || search.includes('type=recovery');
    if (isRecoveryUrl) {
      setPasswordRecovery(true);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      if (session) {
        setUserId(session.user.id);
        fetchUserRole(session.user.id);
        checkWaiverStatus(session.user.id);
        checkContractStatus(session.user.id);
        checkLoiStatus(session.user.id);
        checkFacilityFineStatus(session.user.id);
      } else {
        setUserRole(null);
        setUserId(null);
        setWaiverSigned(null);
        setContractSigned(null);
        setLoiSigned(null);
        setFacilityFineSigned(null);
      }
      setLoading(false);
    });

    // Fallback: if no auth event fires within 2s (e.g. no session at all), stop loading
    const timeout = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
              setSession(session);
              setUserId(session.user.id);
              fetchUserRole(session.user.id);
              checkWaiverStatus(session.user.id);
              checkContractStatus(session.user.id);
              checkLoiStatus(session.user.id);
            }
          });
        }
        return false;
      });
    }, 2000);

    return () => { subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  const [userName, setUserName] = useState('');
  const [userAvatar, setUserAvatar] = useState(null);

  const fetchUserRole = async (userId) => {
    const { data, error } = await supabase
      .from('users')
      .select('role, secondary_role, full_name, email, avatar_url')
      .eq('id', userId)
      .single();

    const applyUserRow = (row) => {
      setUserRole(row.role);
      setSecondaryRole(row.secondary_role || null);
      // Prefer freshly-fetched full_name; fall back to existing state, then auth
      // metadata, then email, so we never replace a good name with "User".
      setUserName((prev) => {
        const fetched = (row.full_name || '').trim();
        if (fetched) return fetched;
        if (prev && prev.trim()) return prev;
        const meta = row.email || '';
        return meta;
      });
      if (row.avatar_url !== undefined) setUserAvatar(row.avatar_url || null);
    };

    if (error) {
      console.error('Error fetching user role:', error);
      // Session may be stale — try refreshing and retrying once
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshData?.session) {
        const { data: retryData, error: retryError } = await supabase
          .from('users')
          .select('role, secondary_role, full_name, email, avatar_url')
          .eq('id', userId)
          .single();
        if (!retryError && retryData) {
          applyUserRow(retryData);
          return;
        }
      } else if (refreshError) {
        // Refresh token is dead (Dom Giustino's case in #180 — a stale session
        // from weeks ago kept "User" in the sidebar for 3s before the SDK gave
        // up). Force a clean sign-out so the next mount shows the login screen
        // instead of a half-loaded shell. The refresh-token failure is the
        // signal that this is NOT a transient fetch error.
        console.warn('Auth refresh failed; signing out stale session.');
        await supabase.auth.signOut();
      }
      // Don't auto sign-out on a transient fetch failure with a still-valid
      // refresh token — that would log the user out mid-session and is the
      // root of issue #164's "logs in then says User" flicker.
    } else {
      applyUserRow(data);
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

  if (passwordRecovery && session) {
    return <ResetPasswordPage onComplete={() => setPasswordRecovery(false)} />;
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="bg-gray-100 min-h-screen">
      <MainApp
        userRole={userRole}
        secondaryRole={secondaryRole}
        userId={userId}
        userName={userName}
        userAvatar={userAvatar}
        onLogout={handleLogout}
        currentView={currentView}
        setCurrentView={setCurrentView}
        workPortalView={workPortalView}
        setWorkPortalView={setWorkPortalView}
        waiverSigned={waiverSigned}
        setWaiverSigned={setWaiverSigned}
        contractSigned={contractSigned}
        setContractSigned={setContractSigned}
        loiSigned={loiSigned}
        setLoiSigned={setLoiSigned}
        facilityFineSigned={facilityFineSigned}
        setFacilityFineSigned={setFacilityFineSigned}
        currentPortal={currentPortal}
        setCurrentPortal={setCurrentPortal}
      />
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [signup, setSignup] = useState({ full_name: '', email: '', phone: '', password: '' });
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupSent, setSignupSent] = useState(false);
  const [signupError, setSignupError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin(email, password);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setSignupError('');
    setSignupLoading(true);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(signup),
      });
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Could not create account.');
      setSignupSent(true);
    } catch (err) {
      setSignupError(err.message);
    } finally {
      setSignupLoading(false);
    }
  };

  const resetSignup = () => {
    setShowSignup(false);
    setSignupSent(false);
    setSignupError('');
    setSignup({ full_name: '', email: '', phone: '', password: '' });
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/?type=recovery`,
    });
    setForgotLoading(false);
    if (error) {
      alert('Error: ' + error.message);
    } else {
      setForgotSent(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <img src="/nbp-logo.png" alt="NBP Logo" className="w-24 h-24 mx-auto mb-4 object-contain" />
          <h1 className="text-3xl font-bold text-gray-900">Natural Ball Player</h1>
          <p className="text-gray-600 mt-2">Training Portal</p>
        </div>

        {showSignup ? (
          signupSent ? (
            <div className="text-center space-y-4">
              <Mail size={40} className="mx-auto text-blue-500" />
              <h2 className="text-lg font-semibold text-gray-900">Almost there!</h2>
              <p className="text-sm text-gray-600">We sent a confirmation link to <strong>{signup.email}</strong>. Click it to activate your account, then sign in.</p>
              <button
                onClick={resetSignup}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition"
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <button
                type="button"
                onClick={resetSignup}
                className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
              >
                <ArrowLeft size={16} />
                <span>Back to Sign In</span>
              </button>
              <h2 className="text-lg font-semibold text-gray-900">Create Account</h2>
              <p className="text-sm text-gray-600">New to NBP? Create your athlete account. A coach will get you set up after you confirm your email.</p>
              {signupError && <p className="text-sm text-red-600">{signupError}</p>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={signup.full_name}
                  onChange={(e) => setSignup(s => ({ ...s, full_name: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={signup.email}
                  onChange={(e) => setSignup(s => ({ ...s, email: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="tel"
                  value={signup.phone}
                  onChange={(e) => setSignup(s => ({ ...s, phone: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <input
                  type="password"
                  value={signup.password}
                  onChange={(e) => setSignup(s => ({ ...s, password: e.target.value }))}
                  minLength={12}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">At least 12 characters.</p>
              </div>
              <button
                type="submit"
                disabled={signupLoading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {signupLoading ? 'Creating...' : 'Create Account'}
              </button>
            </form>
          )
        ) : showForgot ? (
          forgotSent ? (
            <div className="text-center space-y-4">
              <Mail size={40} className="mx-auto text-blue-500" />
              <h2 className="text-lg font-semibold text-gray-900">Check Your Email</h2>
              <p className="text-sm text-gray-600">We sent a password reset link to <strong>{forgotEmail}</strong>. Click the link in the email to reset your password.</p>
              <button
                onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(''); }}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition"
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <button
                type="button"
                onClick={() => setShowForgot(false)}
                className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
              >
                <ArrowLeft size={16} />
                <span>Back to Sign In</span>
              </button>
              <h2 className="text-lg font-semibold text-gray-900">Reset Password</h2>
              <p className="text-sm text-gray-600">Enter your email address and we'll send you a link to reset your password.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {forgotLoading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          )
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
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
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Forgot Password?
              </button>
            </div>
            <div className="text-center border-t border-gray-100 pt-4">
              <span className="text-sm text-gray-500">New here? </span>
              <button
                type="button"
                onClick={() => setShowSignup(true)}
                className="text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                Create an account
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ResetPasswordPage({ onComplete }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    if (newPassword.length < 12) {
      alert('Password must be at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      alert('Error resetting password: ' + error.message);
    } else {
      alert('Password updated successfully!');
      onComplete();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <img src="/nbp-logo.png" alt="NBP Logo" className="w-20 h-20 mx-auto mb-3 object-contain" />
          <h1 className="text-2xl font-bold text-gray-900">Set New Password</h1>
          <p className="text-gray-600 mt-2 text-sm">Enter your new password below.</p>
        </div>
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={12}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={12}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {saving ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function MainApp({ userRole, secondaryRole, userId, userName, userAvatar, onLogout, currentView, setCurrentView, workPortalView, setWorkPortalView, waiverSigned, setWaiverSigned, contractSigned, setContractSigned, loiSigned, setLoiSigned, facilityFineSigned, setFacilityFineSigned, currentPortal, setCurrentPortal }) {
  const [viewProfileUserId, setViewProfileUserId] = useState(null);
  const [navigateTeamId, setNavigateTeamId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasSecondary = !!secondaryRole && secondaryRole !== userRole;
  const [viewMode, setViewMode] = useState(userRole);
  useEffect(() => { setViewMode(userRole); }, [userRole]);
  const effectiveRole = hasSecondary ? viewMode : userRole;

  // If a coach toggles to "view as player", kick them out of the Work Portal too
  useEffect(() => {
    if (effectiveRole === 'player' && currentPortal === 'work') {
      setCurrentPortal('main');
    }
  }, [effectiveRole, currentPortal, setCurrentPortal]);

  const mainCounts = useMainPortalCounts(userId, effectiveRole);
  const workCounts = useWorkPortalCounts(userId, effectiveRole);

  const handleNotifJump = (portal, view) => {
    if (portal === 'main') setCurrentView(view);
    else { setWorkPortalView(view); setCurrentPortal('work'); }
  };

  if (currentPortal === 'work' && (userRole === 'coach' || userRole === 'admin')) {
    return (
      <WorkPortalShell
        userId={userId}
        userRole={userRole}
        userName={userName}
        userAvatar={userAvatar}
        onLogout={onLogout}
        currentView={workPortalView}
        setCurrentView={setWorkPortalView}
        onSwitchPortal={() => setCurrentPortal('main')}
        onSwitchPortalAndView={(view) => { setCurrentView(view); setCurrentPortal('main'); }}
      />
    );
  }

  const handleNav = (view) => { setCurrentView(view); setSidebarOpen(false); };

  return (
    <div className="flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar
        userRole={effectiveRole}
        userName={userName}
        userAvatar={userAvatar}
        currentView={currentView}
        setCurrentView={(v) => handleNav(v)}
        onLogout={onLogout}
        unreadMessageCount={mainCounts.unreadMessages}
        pendingSlotCount={mainCounts.pendingSlots.length}
        waiverSigned={waiverSigned}
        contractSigned={contractSigned}
        loiSigned={loiSigned}
        facilityFineSigned={facilityFineSigned}
        onSwitchPortal={() => { setCurrentPortal('work'); setSidebarOpen(false); }}
        canSwitchRole={hasSecondary}
        otherRole={hasSecondary ? (viewMode === userRole ? secondaryRole : userRole) : null}
        onSwitchRole={hasSecondary ? () => { setViewMode(viewMode === userRole ? secondaryRole : userRole); setSidebarOpen(false); } : null}
        mobileOpen={sidebarOpen}
      />
      <div className="flex-1 md:ml-64">
        <div className="sticky top-0 z-30 bg-white border-b px-4 md:px-8 py-3 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden p-1 text-gray-600 hover:text-gray-900">
            <Menu size={24} />
          </button>
          <div className="flex-1" />
          <NotificationBell
            currentPortal="main"
            mainCounts={mainCounts}
            workCounts={workCounts}
            onJump={handleNotifJump}
          />
        </div>

        {/* Main content */}
        <div className="p-4 md:p-8">
          <div className="max-w-7xl mx-auto">
            {currentView === 'dashboard' && (
              effectiveRole === 'player' ? (
                <PlayerDashboard userId={userId} waiverSigned={waiverSigned} setCurrentView={setCurrentView} />
              ) : (
                <AdminDashboard userId={userId} userRole={effectiveRole} setCurrentView={setCurrentView} />
              )
            )}
            {currentView === 'profile' && <Profile userId={userId} userRole={effectiveRole} loggedInUserId={userId} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} onNavigateToTeam={(teamId) => { setNavigateTeamId(teamId); setCurrentView('team'); }} />}
            {currentView === 'profile-view' && viewProfileUserId && <Profile userId={viewProfileUserId} userRole={effectiveRole} loggedInUserId={userId} onBack={() => setCurrentView('settings')} onNavigateToProfile={(profileUserId) => { setViewProfileUserId(profileUserId); }} onNavigateToTeam={(teamId) => { setNavigateTeamId(teamId); setCurrentView('team'); }} />}
            {currentView === 'team' && <MyTeam userId={userId} userRole={effectiveRole} initialTeamId={navigateTeamId} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'schedule' && <Schedule userId={userId} userRole={effectiveRole} />}
            {currentView === 'knowledge' && <KnowledgeBase userId={userId} userRole={effectiveRole} />}
            {currentView === 'fields' && <Fields userId={userId} userRole={effectiveRole} />}
            {currentView === 'messages' && <Messages userId={userId} userRole={effectiveRole} />}
            {currentView === 'manage-athletes' && <ManageAthletes userId={userId} userRole={effectiveRole} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'manage-coaches' && userRole === 'admin' && <ManageCoaches userId={userId} userRole={effectiveRole} mode="coaches" onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'manage-interns' && userRole === 'admin' && <ManageCoaches userId={userId} userRole={effectiveRole} mode="interns" onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'coach-tools' && <CoachTools userRole={effectiveRole} userId={userId} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
            {currentView === 'waiver' && <WaiverPage userId={userId} userRole={effectiveRole} onSigned={() => setWaiverSigned(true)} />}
            {currentView === 'contract' && <ContractPage userId={userId} userRole={effectiveRole} onSigned={() => setContractSigned(true)} />}
            {currentView === 'loi' && <LetterOfIntentPage userId={userId} userRole={effectiveRole} onSigned={() => setLoiSigned(true)} />}
            {currentView === 'facility-fine' && <FacilityFinePage userId={userId} onSigned={() => setFacilityFineSigned(true)} />}
            {currentView === 'settings' && <AdminSettings userId={userId} userRole={effectiveRole} onNavigateToProfile={(profileUserId) => { setCurrentView('profile-view'); setViewProfileUserId(profileUserId); }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ userRole, userName, userAvatar, currentView, setCurrentView, onLogout, unreadMessageCount = 0, pendingSlotCount = 0, waiverSigned, contractSigned, loiSigned, facilityFineSigned, onSwitchPortal, canSwitchRole, otherRole, onSwitchRole, mobileOpen }) {
  const [documentsExpanded, setDocumentsExpanded] = useState(true);
  const anyDocUnsigned = waiverSigned === false || contractSigned === false || loiSigned === false || facilityFineSigned === false;
  return (
    <div className={`w-64 bg-gray-900 text-white h-screen fixed left-0 top-0 p-4 flex flex-col z-50 transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
      <div className="mb-4">
        <div className="flex items-center space-x-2">
          <img src="/nbp-logo.png" alt="NBP" className="w-8 h-8 object-contain" />
          <h1 className="text-xl font-bold text-blue-400">Natural Ball Player</h1>
        </div>
        <div className="flex items-center space-x-3 mt-2">
          {userAvatar ? (
            <img src={userAvatar} alt="Avatar" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
              {userName?.charAt(0) || '?'}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-200 truncate">{userName || 'User'}</p>
            <p className="text-xs text-gray-400">{userRole?.toUpperCase()}</p>
          </div>
        </div>
      </div>

      <nav className="space-y-1 flex-1 overflow-y-auto">
        <button
          onClick={() => setCurrentView('dashboard')}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
            currentView === 'dashboard' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <BarChart3 size={18} />
          <span className="flex-1 text-left">Dashboard</span>
          {(userRole === 'coach' || userRole === 'admin') && pendingSlotCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">{pendingSlotCount}</span>
          )}
        </button>

        <button
          onClick={() => setCurrentView('profile')}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
            currentView === 'profile' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <Users size={18} />
          <span>Profile</span>
        </button>

        {/* Documents Section */}
        <div>
          <button
            onClick={() => setDocumentsExpanded(!documentsExpanded)}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm hover:bg-gray-800`}
          >
            <FolderOpen size={18} />
            <span className="flex-1 text-left">Documents</span>
            {anyDocUnsigned && (
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full flex-shrink-0"></span>
            )}
            {documentsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {documentsExpanded && (
            <div className="ml-4 space-y-1 mt-1">
              <button
                onClick={() => setCurrentView('waiver')}
                className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition text-sm ${
                  currentView === 'waiver' ? 'bg-blue-600' : 'hover:bg-gray-800'
                }`}
              >
                <FileText size={16} />
                <span className="flex-1 text-left">Waiver</span>
                {waiverSigned === false && (
                  <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></span>
                )}
              </button>
              <button
                onClick={() => setCurrentView('contract')}
                className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition text-sm ${
                  currentView === 'contract' ? 'bg-blue-600' : 'hover:bg-gray-800'
                }`}
              >
                <FileText size={16} />
                <span className="flex-1 text-left">Player Contract</span>
                {contractSigned === false && (
                  <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></span>
                )}
              </button>
              <button
                onClick={() => setCurrentView('loi')}
                className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition text-sm ${
                  currentView === 'loi' ? 'bg-blue-600' : 'hover:bg-gray-800'
                }`}
              >
                <FileText size={16} />
                <span className="flex-1 text-left">Letter of Intent</span>
                {loiSigned === false && (
                  <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></span>
                )}
              </button>
              <button
                onClick={() => setCurrentView('facility-fine')}
                className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition text-sm ${
                  currentView === 'facility-fine' ? 'bg-blue-600' : 'hover:bg-gray-800'
                }`}
              >
                <FileText size={16} />
                <span className="flex-1 text-left">Facility Fine</span>
                {facilityFineSigned === false && (
                  <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></span>
                )}
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => setCurrentView('team')}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
            currentView === 'team' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <Users size={18} />
          <span>My Team</span>
        </button>

        <button
          onClick={() => setCurrentView('schedule')}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
            currentView === 'schedule' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <Calendar size={18} />
          <span>Schedule</span>
        </button>

        <button
          onClick={() => setCurrentView('fields')}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
            currentView === 'fields' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <MapPin size={18} />
          <span>Fields</span>
        </button>

        <button
          onClick={() => setCurrentView('knowledge')}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
            currentView === 'knowledge' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <BookOpen size={18} />
          <span>Knowledge Base</span>
        </button>

        <button
          onClick={() => setCurrentView('messages')}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
            currentView === 'messages' ? 'bg-blue-600' : 'hover:bg-gray-800'
          }`}
        >
          <MessageSquare size={18} />
          <span className="flex-1 text-left">Communication</span>
          {unreadMessageCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</span>
          )}
        </button>

        {(userRole === 'admin' || userRole === 'coach') && (
          <>
            <button
              onClick={() => setCurrentView('manage-athletes')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
                currentView === 'manage-athletes' ? 'bg-blue-600' : 'hover:bg-gray-800'
              }`}
            >
              <Users size={18} />
              <span>Manage Athletes</span>
            </button>

            {userRole === 'admin' && (
              <>
                <button
                  onClick={() => setCurrentView('manage-coaches')}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
                    currentView === 'manage-coaches' ? 'bg-blue-600' : 'hover:bg-gray-800'
                  }`}
                >
                  <UserCog size={18} />
                  <span>Manage Coaches</span>
                </button>
                <button
                  onClick={() => setCurrentView('manage-interns')}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
                    currentView === 'manage-interns' ? 'bg-blue-600' : 'hover:bg-gray-800'
                  }`}
                >
                  <UserCog size={18} />
                  <span>Manage Interns</span>
                </button>
              </>
            )}

            <button
              onClick={() => setCurrentView('coach-tools')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
                currentView === 'coach-tools' ? 'bg-blue-600' : 'hover:bg-gray-800'
              }`}
            >
              <Wrench size={18} />
              <span>Coach Tools</span>
            </button>

            <button
              onClick={() => setCurrentView('settings')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition text-sm ${
                currentView === 'settings' ? 'bg-blue-600' : 'hover:bg-gray-800'
              }`}
            >
              <Settings size={18} />
              <span>Settings</span>
            </button>
          </>
        )}
      </nav>

      <div className="mt-auto pt-3 space-y-1.5">
        {canSwitchRole && onSwitchRole && otherRole && (
          <button
            onClick={onSwitchRole}
            className="w-full flex items-center justify-center space-x-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition text-sm"
            title={`Currently viewing as ${userRole}`}
          >
            <UserCog size={16} />
            <span>View as {otherRole.charAt(0).toUpperCase() + otherRole.slice(1)}</span>
          </button>
        )}
        {(userRole === 'coach' || userRole === 'admin') && onSwitchPortal && (
          <button
            onClick={onSwitchPortal}
            className="w-full flex items-center justify-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm"
          >
            <Briefcase size={16} />
            <span>Switch to Work Portal</span>
          </button>
        )}
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
  const [activityTotals, setActivityTotals] = useState(null);

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
      fetchActivityTotals();
    }
  }, [userId]);

  const fetchActivityTotals = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const todayStr = fmtLocalDate(today);
    const weekStartStr = fmtLocalDate(weekStart);
    const monthStartStr = fmtLocalDate(monthStart);

    const countOn = async (table, dateCol, type) => {
      const ranges = ['day', 'week', 'month'];
      const starts = { day: todayStr, week: weekStartStr, month: monthStartStr };
      const out = {};
      for (const r of ranges) {
        let q = supabase.from(table).select('id', { count: 'exact', head: true })
          .gte(dateCol, starts[r]).lte(dateCol, todayStr);
        if (type) q = q.eq('event_type', type);
        const { count } = await q;
        out[r] = count || 0;
      }
      return out;
    };

    const countSlotReservations = async () => {
      const ranges = ['day', 'week', 'month'];
      const starts = { day: todayStr, week: weekStartStr, month: monthStartStr };
      const out = {};
      for (const r of ranges) {
        const { count } = await supabase.from('slot_reservations')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'confirmed')
          .gte('slot_date', starts[r]).lte('slot_date', todayStr);
        out[r] = count || 0;
      }
      return out;
    };

    const [assessments, lessons, practices, games, workouts] = await Promise.all([
      countOn('assessment_submissions', 'assessment_date', null),
      countSlotReservations(),
      countOn('schedule_events', 'event_date', 'practice'),
      countOn('schedule_events', 'event_date', 'game'),
      countOn('schedule_events', 'event_date', 'workout'),
    ]);

    setActivityTotals({ assessments, lessons, practices, games, workouts });
  };

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

      {/* Activity Totals */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center space-x-2 p-6 pb-4 border-b border-gray-100">
          <BarChart3 size={20} className="text-green-600" />
          <h3 className="text-lg font-semibold text-gray-900">Activity Totals</h3>
        </div>
        <div className="p-6 pt-4">
          {!activityTotals ? (
            <div className="text-center py-8 text-gray-500 text-sm">Loading totals...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 font-semibold text-gray-700"></th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-700">Today</th>
                    <th className="text-right py-2 px-3 font-semibold text-gray-700">This week</th>
                    <th className="text-right py-2 pl-3 font-semibold text-gray-700">This month</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'assessments', label: 'Assessments' },
                    { key: 'lessons', label: 'Lessons' },
                    { key: 'practices', label: 'Practices' },
                    { key: 'workouts', label: 'Workouts' },
                    { key: 'games', label: 'Games' },
                  ].map(row => {
                    const t = activityTotals[row.key] || { day: 0, week: 0, month: 0 };
                    return (
                      <tr key={row.key} className="border-b border-gray-100 last:border-b-0">
                        <td className="py-2.5 pr-4 font-medium text-gray-900">{row.label}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-900">{t.day}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-900">{t.week}</td>
                        <td className="py-2.5 pl-3 text-right tabular-nums text-gray-900">{t.month}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

