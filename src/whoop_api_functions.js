// =====================================================
// WHOOP API BACKEND FUNCTIONS
// Deploy these as Supabase Edge Functions or API routes
// =====================================================

import { createClient } from '@supabase/supabase-js';

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID;
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
const WHOOP_REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =====================================================
// 1. Exchange authorization code for tokens
// =====================================================
export async function exchangeToken(code, userId) {
  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        redirect_uri: WHOOP_REDIRECT_URI
      })
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const tokens = await tokenResponse.json();
    
    // Get WHOOP user profile
    const profileResponse = await fetch(`${WHOOP_API_BASE}/user/profile/basic`, {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    
    const profile = await profileResponse.json();

    // Calculate token expiration
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in);

    // Store tokens in database
    const { data, error } = await supabase
      .from('whoop_connections')
      .upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt.toISOString(),
        whoop_user_id: profile.user_id,
        is_active: true,
        connected_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Token exchange error:', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// 2. Refresh access token
// =====================================================
export async function refreshAccessToken(userId) {
  try {
    // Get current connection
    const { data: connection } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      throw new Error('No WHOOP connection found');
    }

    // Refresh the token
    const tokenResponse = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refresh_token,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Token refresh failed');
    }

    const tokens = await tokenResponse.json();

    // Update stored tokens
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in);

    await supabase
      .from('whoop_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    return tokens.access_token;
  } catch (error) {
    console.error('Token refresh error:', error);
    throw error;
  }
}

// =====================================================
// 3. Get valid access token (refresh if needed)
// =====================================================
async function getValidAccessToken(userId) {
  const { data: connection } = await supabase
    .from('whoop_connections')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!connection) {
    throw new Error('No WHOOP connection found');
  }

  // Check if token is expired or will expire in next 5 minutes
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
    return await refreshAccessToken(userId);
  }

  return connection.access_token;
}

// =====================================================
// 4. Sync WHOOP data
// =====================================================
export async function syncWhoopData(userId, daysBack = 7) {
  const startTime = Date.now();
  let cyclesSynced = 0;

  try {
    const accessToken = await getValidAccessToken(userId);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Fetch cycles (daily summaries)
    const cyclesResponse = await fetch(
      `${WHOOP_API_BASE}/cycle?` + new URLSearchParams({
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }),
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!cyclesResponse.ok) {
      throw new Error('Failed to fetch cycles');
    }

    const cycles = await cyclesResponse.json();

    // Process each cycle
    for (const cycle of cycles.records || []) {
      try {
        // Parse cycle data
        const cycleData = {
          user_id: userId,
          cycle_id: cycle.id.toString(),
          date: new Date(cycle.start).toISOString().split('T')[0],
          
          // Recovery data
          recovery_score: cycle.score?.recovery_score,
          hrv_rmssd: cycle.score?.hrv_rmssd_milli,
          resting_heart_rate: cycle.score?.resting_heart_rate,
          
          // Strain data
          strain: cycle.score?.strain,
          kilojoules: cycle.score?.kilojoule,
          average_heart_rate: cycle.score?.average_heart_rate,
          max_heart_rate: cycle.score?.max_heart_rate,
          
          // Sleep data (from sleep record if available)
          sleep_performance_percentage: cycle.sleep?.score?.stage_summary?.sleep_performance_percentage,
          sleep_duration_minutes: cycle.sleep?.score?.stage_summary?.total_in_bed_time_milli ? 
            Math.round(cycle.sleep.score.stage_summary.total_in_bed_time_milli / 60000) : null,
          sleep_needed_minutes: cycle.sleep?.score?.stage_summary?.sleep_needed?.baseline_milli ?
            Math.round(cycle.sleep.score.stage_summary.sleep_needed.baseline_milli / 60000) : null,
          sleep_debt_minutes: cycle.sleep?.score?.stage_summary?.sleep_debt?.debt_milli ?
            Math.round(cycle.sleep.score.stage_summary.sleep_debt.debt_milli / 60000) : null,
          sleep_quality_percentage: cycle.sleep?.score?.sleep_efficiency_percentage,
          time_in_bed_minutes: cycle.sleep?.score?.stage_summary?.total_in_bed_time_milli ?
            Math.round(cycle.sleep.score.stage_summary.total_in_bed_time_milli / 60000) : null,
          light_sleep_minutes: cycle.sleep?.score?.stage_summary?.light_sleep_duration_milli ?
            Math.round(cycle.sleep.score.stage_summary.light_sleep_duration_milli / 60000) : null,
          deep_sleep_minutes: cycle.sleep?.score?.stage_summary?.slow_wave_sleep_duration_milli ?
            Math.round(cycle.sleep.score.stage_summary.slow_wave_sleep_duration_milli / 60000) : null,
          rem_sleep_minutes: cycle.sleep?.score?.stage_summary?.rem_sleep_duration_milli ?
            Math.round(cycle.sleep.score.stage_summary.rem_sleep_duration_milli / 60000) : null,
          awake_minutes: cycle.sleep?.score?.stage_summary?.wake_duration_milli ?
            Math.round(cycle.sleep.score.stage_summary.wake_duration_milli / 60000) : null,
        };

        // Upsert cycle data
        await supabase
          .from('whoop_data')
          .upsert(cycleData, {
            onConflict: 'user_id,cycle_id'
          });

        cyclesSynced++;

      } catch (cycleError) {
        console.error(`Error processing cycle ${cycle.id}:`, cycleError);
      }
    }

    // Update last sync time
    await supabase
      .from('whoop_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('user_id', userId);

    // Log successful sync
    await supabase.from('whoop_sync_logs').insert({
      user_id: userId,
      status: 'success',
      cycles_synced: cyclesSynced,
      sync_duration_ms: Date.now() - startTime
    });

    return { success: true, cycles_synced: cyclesSynced };

  } catch (error) {
    console.error('Sync error:', error);

    // Log error
    await supabase.from('whoop_sync_logs').insert({
      user_id: userId,
      status: 'error',
      cycles_synced: cyclesSynced,
      error_message: error.message,
      sync_duration_ms: Date.now() - startTime
    });

    return { success: false, error: error.message };
  }
}

// =====================================================
// 5. Daily auto-sync function (run via cron)
// =====================================================
export async function dailyAutoSync() {
  try {
    // Get all active WHOOP connections
    const { data: connections } = await supabase
      .from('whoop_connections')
      .select('user_id')
      .eq('is_active', true);

    if (!connections || connections.length === 0) {
      return { success: true, message: 'No active connections' };
    }

    // Sync each user (sequential to avoid rate limits)
    const results = [];
    for (const conn of connections) {
      const result = await syncWhoopData(conn.user_id, 2); // Last 2 days
      results.push({ user_id: conn.user_id, ...result });
      
      // Wait 1 second between requests to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return { success: true, results };

  } catch (error) {
    console.error('Daily auto-sync error:', error);
    return { success: false, error: error.message };
  }
}
