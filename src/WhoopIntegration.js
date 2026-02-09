import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Activity, RefreshCw, Link as LinkIcon, Unlink, CheckCircle, AlertCircle, Clock } from 'lucide-react';

// WHOOP OAuth Configuration
const WHOOP_CLIENT_ID = process.env.REACT_APP_WHOOP_CLIENT_ID || 'YOUR_CLIENT_ID';
const WHOOP_REDIRECT_URI = process.env.REACT_APP_WHOOP_REDIRECT_URI || 'http://localhost:3000/whoop/callback';
const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1';

export default function WhoopIntegration({ userId }) {
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [recentData, setRecentData] = useState([]);
  const [lastSync, setLastSync] = useState(null);

  useEffect(() => {
    checkConnection();
    fetchRecentData();
  }, [userId]);

  const checkConnection = async () => {
    const { data } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    
    if (data) {
      setConnection(data);
      setLastSync(data.last_sync_at);
    }
    setLoading(false);
  };

  const fetchRecentData = async () => {
    const { data } = await supabase
      .from('whoop_data')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(7);
    
    if (data) {
      setRecentData(data);
    }
  };

  const handleConnect = () => {
    // Generate random state for security
    const state = Math.random().toString(36).substring(7);
    sessionStorage.setItem('whoop_oauth_state', state);
    sessionStorage.setItem('whoop_user_id', userId);

    // Redirect to WHOOP OAuth
    const authUrl = `${WHOOP_AUTH_URL}?` + new URLSearchParams({
      response_type: 'code',
      client_id: WHOOP_CLIENT_ID,
      redirect_uri: WHOOP_REDIRECT_URI,
      scope: 'read:recovery read:cycles read:sleep read:workout read:profile',
      state: state
    });

    window.location.href = authUrl;
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your WHOOP account? You can reconnect anytime.')) return;

    const { error } = await supabase
      .from('whoop_connections')
      .update({ is_active: false })
      .eq('user_id', userId);

    if (!error) {
      setConnection(null);
      setRecentData([]);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Call your backend sync function
      const response = await fetch('/api/whoop/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      if (response.ok) {
        await checkConnection();
        await fetchRecentData();
        alert('WHOOP data synced successfully!');
      } else {
        throw new Error('Sync failed');
      }
    } catch (err) {
      alert('Failed to sync WHOOP data: ' + err.message);
    }
    setSyncing(false);
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading WHOOP status...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className={`rounded-lg p-6 ${connection ? 'bg-green-50 border-2 border-green-200' : 'bg-gray-50 border-2 border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${connection ? 'bg-green-600' : 'bg-gray-400'}`}>
              <Activity size={24} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {connection ? 'WHOOP Connected' : 'WHOOP Not Connected'}
              </h3>
              <p className="text-sm text-gray-600">
                {connection 
                  ? `Connected ${new Date(connection.connected_at).toLocaleDateString()}`
                  : 'Connect your WHOOP to auto-sync recovery data'
                }
              </p>
              {lastSync && (
                <p className="text-xs text-gray-500 mt-1 flex items-center space-x-1">
                  <Clock size={12} />
                  <span>Last synced: {new Date(lastSync).toLocaleString()}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {connection ? (
              <>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 flex items-center space-x-2"
                >
                  <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
                  <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
                <button
                  onClick={handleDisconnect}
                  className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition flex items-center space-x-2"
                >
                  <Unlink size={18} />
                  <span>Disconnect</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
              >
                <LinkIcon size={18} />
                <span>Connect WHOOP</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Recent Data */}
      {connection && recentData.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent WHOOP Data (Last 7 Days)</h3>
          <div className="space-y-3">
            {recentData.map((data) => (
              <WhoopDataCard key={data.id} data={data} />
            ))}
          </div>
        </div>
      )}

      {/* Setup Instructions */}
      {!connection && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h4 className="font-semibold text-blue-900 mb-3">How to Connect WHOOP</h4>
          <ol className="space-y-2 text-sm text-blue-800">
            <li>1. Click "Connect WHOOP" button above</li>
            <li>2. Sign in to your WHOOP account</li>
            <li>3. Authorize Natural Ball Player to access your data</li>
            <li>4. You'll be redirected back and your data will sync automatically</li>
          </ol>
          <div className="mt-4 text-xs text-blue-700">
            <strong>Note:</strong> Your WHOOP data will sync automatically every morning at 6 AM. You can also manually sync anytime.
          </div>
        </div>
      )}
    </div>
  );
}

function WhoopDataCard({ data }) {
  const date = new Date(data.date);
  const sleepHours = data.sleep_duration_minutes ? (data.sleep_duration_minutes / 60).toFixed(1) : null;
  
  const getRecoveryColor = (score) => {
    if (!score) return 'gray';
    if (score >= 67) return 'green';
    if (score >= 34) return 'yellow';
    return 'red';
  };

  const recoveryColor = getRecoveryColor(data.recovery_score);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-semibold text-gray-900">
            {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </h4>
          <p className="text-xs text-gray-500">Cycle ID: {data.cycle_id.slice(0, 8)}...</p>
        </div>
        {data.recovery_score && (
          <div className={`px-4 py-2 rounded-full ${
            recoveryColor === 'green' ? 'bg-green-100 text-green-700' :
            recoveryColor === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            <span className="text-2xl font-bold">{Math.round(data.recovery_score)}%</span>
            <span className="text-xs ml-1">Recovery</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {data.strain && (
          <div>
            <div className="text-gray-600">Strain</div>
            <div className="font-semibold text-gray-900">{data.strain.toFixed(1)}</div>
          </div>
        )}
        {sleepHours && (
          <div>
            <div className="text-gray-600">Sleep</div>
            <div className="font-semibold text-gray-900">{sleepHours} hrs</div>
          </div>
        )}
        {data.hrv_rmssd && (
          <div>
            <div className="text-gray-600">HRV</div>
            <div className="font-semibold text-gray-900">{Math.round(data.hrv_rmssd)} ms</div>
          </div>
        )}
        {data.resting_heart_rate && (
          <div>
            <div className="text-gray-600">RHR</div>
            <div className="font-semibold text-gray-900">{data.resting_heart_rate} bpm</div>
          </div>
        )}
        {data.sleep_performance_percentage && (
          <div>
            <div className="text-gray-600">Sleep Quality</div>
            <div className="font-semibold text-gray-900">{Math.round(data.sleep_performance_percentage)}%</div>
          </div>
        )}
        {data.time_in_bed_minutes && (
          <div>
            <div className="text-gray-600">Time in Bed</div>
            <div className="font-semibold text-gray-900">{(data.time_in_bed_minutes / 60).toFixed(1)} hrs</div>
          </div>
        )}
      </div>

      {/* Sleep breakdown */}
      {data.light_sleep_minutes && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-600 mb-2">Sleep Breakdown</div>
          <div className="flex space-x-2 text-xs">
            <div className="flex-1 bg-blue-100 text-blue-700 px-2 py-1 rounded text-center">
              Light: {Math.round(data.light_sleep_minutes / 60 * 10) / 10}h
            </div>
            <div className="flex-1 bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-center">
              Deep: {Math.round(data.deep_sleep_minutes / 60 * 10) / 10}h
            </div>
            <div className="flex-1 bg-purple-100 text-purple-700 px-2 py-1 rounded text-center">
              REM: {Math.round(data.rem_sleep_minutes / 60 * 10) / 10}h
            </div>
            {data.awake_minutes > 0 && (
              <div className="flex-1 bg-gray-100 text-gray-700 px-2 py-1 rounded text-center">
                Awake: {Math.round(data.awake_minutes)}m
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// OAuth Callback Handler Component
export function WhoopCallback() {
  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Processing WHOOP authorization...');

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const error = params.get('error');

      // Check for errors
      if (error) {
        throw new Error(`WHOOP authorization failed: ${error}`);
      }

      // Verify state
      const savedState = sessionStorage.getItem('whoop_oauth_state');
      if (state !== savedState) {
        throw new Error('Invalid state parameter');
      }

      const userId = sessionStorage.getItem('whoop_user_id');
      if (!userId) {
        throw new Error('User ID not found');
      }

      // Exchange code for tokens
      setMessage('Exchanging authorization code for access token...');
      
      const tokenResponse = await fetch('/api/whoop/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, userId })
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to exchange authorization code');
      }

      // Initial sync
      setMessage('Syncing your WHOOP data...');
      await fetch('/api/whoop/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      setStatus('success');
      setMessage('WHOOP connected successfully! Redirecting...');

      // Clean up
      sessionStorage.removeItem('whoop_oauth_state');
      sessionStorage.removeItem('whoop_user_id');

      // Redirect back to profile
      setTimeout(() => {
        window.location.href = '/profile';
      }, 2000);

    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
        {status === 'processing' && (
          <>
            <RefreshCw size={48} className="mx-auto mb-4 text-blue-600 animate-spin" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Connecting WHOOP</h2>
            <p className="text-gray-600">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={48} className="mx-auto mb-4 text-green-600" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Success!</h2>
            <p className="text-gray-600">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle size={48} className="mx-auto mb-4 text-red-600" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Failed</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            <button
              onClick={() => window.location.href = '/profile'}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
            >
              Return to Profile
            </button>
          </>
        )}
      </div>
    </div>
  );
}
