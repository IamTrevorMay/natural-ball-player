import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";
const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

// ---- Encryption (AES-256-GCM) ----

function getEncryptionKey(): CryptoKey | Promise<CryptoKey> {
  const keyStr = Deno.env.get("WHOOP_ENCRYPTION_KEY");
  if (!keyStr || keyStr.length < 32) {
    throw new Error("WHOOP_ENCRYPTION_KEY must be at least 32 characters");
  }
  const keyBytes = new TextEncoder().encode(keyStr.slice(0, 32));
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  const cipher = new Uint8Array(cipherBuf);
  // AES-GCM appends 16-byte tag to ciphertext in WebCrypto
  const ciphertext = cipher.slice(0, cipher.length - 16);
  const tag = cipher.slice(cipher.length - 16);
  return `${btoa(String.fromCharCode(...iv))}:${btoa(String.fromCharCode(...tag))}:${btoa(String.fromCharCode(...ciphertext))}`;
}

async function decrypt(encoded: string): Promise<string> {
  const key = await getEncryptionKey();
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(tagB64), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
  // WebCrypto expects tag appended to ciphertext
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data);
  combined.set(tag, data.length);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    combined
  );
  return new TextDecoder().decode(decrypted);
}

// ---- Sport names ----

const WHOOP_SPORT_NAMES: Record<number, string> = {
  [-1]: "Activity",
  0: "Running",
  1: "Cycling",
  16: "Baseball",
  17: "Basketball",
  22: "CrossFit",
  25: "Elliptical",
  33: "Hiking",
  43: "Rowing",
  44: "Rugby",
  48: "Spinning",
  49: "Swimming",
  50: "Tennis",
  51: "Track & Field",
  52: "Volleyball",
  56: "Weightlifting",
  57: "Yoga",
  63: "HIIT",
  64: "Walking",
  71: "Functional Fitness",
  84: "Stretching",
};

function recoveryStateFromScore(
  score: number | null
): "green" | "yellow" | "red" | null {
  if (score === null || score === undefined) return null;
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

// ---- Helper: get admin supabase client ----

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function getUserClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
}

// ---- Token management ----

async function ensureValidToken(
  adminClient: ReturnType<typeof getAdminClient>,
  userId: string
): Promise<string> {
  const { data: tokenRow } = await adminClient
    .from("whoop_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!tokenRow) throw new Error("No WHOOP tokens found");

  let accessToken = await decrypt(tokenRow.encrypted_access_token);

  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  if (Date.now() > expiresAt - 60_000 && tokenRow.encrypted_refresh_token) {
    const currentRefreshToken = await decrypt(
      tokenRow.encrypted_refresh_token
    );

    const res = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: currentRefreshToken,
        client_id: Deno.env.get("WHOOP_CLIENT_ID")!,
        client_secret: Deno.env.get("WHOOP_CLIENT_SECRET")!,
      }),
    });

    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = await res.json();

    await adminClient
      .from("whoop_tokens")
      .update({
        encrypted_access_token: await encrypt(data.access_token),
        encrypted_refresh_token: await encrypt(data.refresh_token),
        token_expires_at: new Date(
          Date.now() + data.expires_in * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.id);

    accessToken = data.access_token;
  }

  return accessToken;
}

// ---- Paginated WHOOP fetch ----

interface PaginatedResponse<T> {
  records: T[];
  next_token?: string;
}

async function fetchPaginated<T>(
  accessToken: string,
  path: string,
  startDate: string,
  endDate: string
): Promise<T[]> {
  const allRecords: T[] = [];
  let nextToken: string | undefined;

  do {
    const params = new URLSearchParams({
      start: new Date(startDate).toISOString(),
      end: new Date(endDate + "T23:59:59").toISOString(),
      limit: "25",
    });
    if (nextToken) params.set("nextToken", nextToken);

    const res = await fetch(`${WHOOP_API_BASE}${path}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `WHOOP API error ${res.status} on ${path}: ${body.slice(0, 300)}`
      );
    }

    const data: PaginatedResponse<T> = await res.json();
    allRecords.push(...data.records);
    nextToken = data.next_token;
  } while (nextToken);

  return allRecords;
}

// ---- Route handlers ----

async function handleConnect(userId: string): Promise<Response> {
  const adminClient = getAdminClient();
  const state = crypto.randomUUID();

  // Store state for validation on callback
  await adminClient
    .from("users")
    .update({ whoop_oauth_state: state })
    .eq("id", userId);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const callbackUrl = `${Deno.env.get("APP_URL") || "https://nbp-portal.vercel.app"}/api/whoop/callback`;

  const params = new URLSearchParams({
    client_id: Deno.env.get("WHOOP_CLIENT_ID")!,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "offline read:recovery read:cycles read:sleep read:workout read:profile",
    state: `${userId}:${state}`,
  });

  return new Response(
    JSON.stringify({ url: `${WHOOP_AUTH_URL}?${params.toString()}` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return new Response("Missing code or state", { status: 400 });
  }

  const [userId, state] = stateParam.split(":");
  const adminClient = getAdminClient();

  // Validate state
  const { data: user } = await adminClient
    .from("users")
    .select("whoop_oauth_state")
    .eq("id", userId)
    .single();

  if (!user || user.whoop_oauth_state !== state) {
    return new Response("Invalid state", { status: 403 });
  }

  // Exchange code for tokens
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const callbackUrl = `${Deno.env.get("APP_URL") || "https://nbp-portal.vercel.app"}/api/whoop/callback`;

  const tokenRes = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: Deno.env.get("WHOOP_CLIENT_ID")!,
      client_secret: Deno.env.get("WHOOP_CLIENT_SECRET")!,
      redirect_uri: callbackUrl,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return new Response(`Token exchange failed: ${text}`, { status: 500 });
  }

  const tokenData = await tokenRes.json();

  // Get WHOOP user ID
  const profileRes = await fetch(`${WHOOP_API_BASE}/user/profile/basic`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();

  // Store encrypted tokens
  await adminClient.from("whoop_tokens").upsert(
    {
      user_id: userId,
      whoop_user_id: String(profile.user_id),
      encrypted_access_token: await encrypt(tokenData.access_token),
      encrypted_refresh_token: tokenData.refresh_token
        ? await encrypt(tokenData.refresh_token)
        : null,
      token_expires_at: new Date(
        Date.now() + tokenData.expires_in * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  // Mark user as connected
  await adminClient
    .from("users")
    .update({ whoop_connected: true, whoop_oauth_state: null })
    .eq("id", userId);

  // Redirect back to the app
  const appUrl = Deno.env.get("APP_URL") || "https://nbp-portal.vercel.app";
  return new Response(null, {
    status: 302,
    headers: { Location: `${appUrl}?whoop_connected=true` },
  });
}

async function handleDisconnect(userId: string): Promise<Response> {
  const adminClient = getAdminClient();

  await adminClient.from("whoop_tokens").delete().eq("user_id", userId);
  await adminClient.from("whoop_cycles").delete().eq("athlete_id", userId);
  await adminClient.from("whoop_sleep").delete().eq("athlete_id", userId);
  await adminClient.from("whoop_workouts").delete().eq("athlete_id", userId);
  await adminClient
    .from("users")
    .update({ whoop_connected: false })
    .eq("id", userId);

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleSync(userId: string, targetUserId?: string): Promise<Response> {
  const adminClient = getAdminClient();
  const athleteId = targetUserId || userId;

  const accessToken = await ensureValidToken(adminClient, athleteId);

  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 365 * 86_400_000)
    .toISOString()
    .split("T")[0];

  // Fetch all data in parallel
  const [cycles, recoveries, sleeps, workouts] = await Promise.all([
    fetchPaginated<any>(accessToken, "/cycle", startDate, endDate),
    fetchPaginated<any>(accessToken, "/recovery", startDate, endDate),
    fetchPaginated<any>(accessToken, "/activity/sleep", startDate, endDate),
    fetchPaginated<any>(accessToken, "/activity/workout", startDate, endDate),
  ]);

  // Join recovery to cycles
  const recoveryByCycleId = new Map(
    recoveries.map((r: any) => [r.cycle_id, r])
  );

  // Upsert cycles
  if (cycles.length > 0) {
    const rows = await Promise.all(
      cycles.map(async (c: any) => {
        const recovery = recoveryByCycleId.get(c.id);
        return {
          athlete_id: athleteId,
          whoop_cycle_id: String(c.id),
          cycle_date: c.start.split("T")[0],
          recovery_score: recovery?.score?.recovery_score ?? null,
          recovery_state: recoveryStateFromScore(
            recovery?.score?.recovery_score ?? null
          ),
          hrv_rmssd: recovery?.score?.hrv_rmssd_milli ?? null,
          resting_heart_rate: recovery?.score?.resting_heart_rate ?? null,
          strain_score: c.score?.strain ?? null,
          kilojoule: c.score?.kilojoule ?? null,
          spo2_pct: recovery?.score?.spo2_percentage ?? null,
          skin_temp_celsius: recovery?.score?.skin_temp_celsius ?? null,
          raw_data: await encrypt(JSON.stringify({ cycle: c, recovery })),
        };
      })
    );
    await adminClient
      .from("whoop_cycles")
      .upsert(rows, { onConflict: "athlete_id,whoop_cycle_id" });
  }

  // Upsert sleep (skip naps)
  if (sleeps.length > 0) {
    const filtered = sleeps.filter((s: any) => !s.nap);
    const rows = await Promise.all(
      filtered.map(async (s: any) => ({
        athlete_id: athleteId,
        whoop_sleep_id: String(s.id),
        sleep_date: s.start.split("T")[0],
        sleep_score: s.score?.sleep_performance_percentage ?? null,
        total_duration_ms:
          s.score?.stage_summary?.total_in_bed_time_milli ?? null,
        rem_duration_ms:
          s.score?.stage_summary?.total_rem_sleep_time_milli ?? null,
        sws_duration_ms:
          s.score?.stage_summary?.total_slow_wave_sleep_time_milli ?? null,
        light_duration_ms:
          s.score?.stage_summary?.total_light_sleep_time_milli ?? null,
        awake_duration_ms:
          s.score?.stage_summary?.total_awake_time_milli ?? null,
        sleep_efficiency: s.score?.sleep_efficiency_percentage ?? null,
        sleep_consistency: s.score?.sleep_consistency_percentage ?? null,
        respiratory_rate: s.score?.respiratory_rate ?? null,
        raw_data: await encrypt(JSON.stringify(s)),
      }))
    );
    await adminClient
      .from("whoop_sleep")
      .upsert(rows, { onConflict: "athlete_id,whoop_sleep_id" });
  }

  // Upsert workouts
  if (workouts.length > 0) {
    const rows = await Promise.all(
      workouts.map(async (w: any) => {
        const startMs = new Date(w.start).getTime();
        const endMs = new Date(w.end).getTime();
        return {
          athlete_id: athleteId,
          whoop_workout_id: String(w.id),
          workout_date: w.start.split("T")[0],
          sport_name: WHOOP_SPORT_NAMES[w.sport_id] || `Sport ${w.sport_id}`,
          sport_id: w.sport_id,
          strain_score: w.score?.strain ?? null,
          average_heart_rate: w.score?.average_heart_rate ?? null,
          max_heart_rate: w.score?.max_heart_rate ?? null,
          distance_meter: w.score?.distance_meter ?? null,
          duration_ms: endMs - startMs,
          raw_data: await encrypt(JSON.stringify(w)),
        };
      })
    );
    await adminClient
      .from("whoop_workouts")
      .upsert(rows, { onConflict: "athlete_id,whoop_workout_id" });
  }

  return new Response(
    JSON.stringify({
      success: true,
      counts: {
        cycles: cycles.length,
        sleep: sleeps.length,
        workouts: workouts.length,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleData(
  userId: string,
  targetUserId: string | null,
  from: string | null,
  to: string | null
): Promise<Response> {
  const adminClient = getAdminClient();
  const athleteId = targetUserId || userId;

  // Check if connected
  const { data: user } = await adminClient
    .from("users")
    .select("whoop_connected")
    .eq("id", athleteId)
    .single();

  if (!user?.whoop_connected) {
    return new Response(
      JSON.stringify({ connected: false, cycles: [], sleep: [], workouts: [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const toDate = to || new Date().toISOString().split("T")[0];
  const fromDate =
    from || new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0];

  const [cyclesRes, sleepRes, workoutsRes] = await Promise.all([
    adminClient
      .from("whoop_cycles")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("cycle_date", fromDate)
      .lte("cycle_date", toDate)
      .order("cycle_date", { ascending: true }),
    adminClient
      .from("whoop_sleep")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("sleep_date", fromDate)
      .lte("sleep_date", toDate)
      .order("sleep_date", { ascending: true }),
    adminClient
      .from("whoop_workouts")
      .select("*")
      .eq("athlete_id", athleteId)
      .gte("workout_date", fromDate)
      .lte("workout_date", toDate)
      .order("workout_date", { ascending: true }),
  ]);

  return new Response(
    JSON.stringify({
      connected: true,
      cycles: cyclesRes.data || [],
      sleep: sleepRes.data || [],
      workouts: workoutsRes.data || [],
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ---- Main handler ----

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // Callback doesn't require auth (it's the OAuth redirect)
    if (action === "callback") {
      return await handleCallback(req);
    }

    // All other actions require auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userClient = getUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the caller's role. Players may connect and view their OWN WHOOP;
    // coaches/admins may additionally act on athletes they're authorized for.
    // Cross-user access is enforced per-action by assertCanTarget below (#154).
    const adminClient = getAdminClient();
    const { data: userData } = await adminClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!userData) {
      return new Response(
        JSON.stringify({ error: "No user record found" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Per-target authorization: a caller can target themselves; admins can target anyone;
    // a coach can target an athlete only when they're listed as that athlete's trainer.
    const assertCanTarget = async (targetId: string | null | undefined): Promise<Response | null> => {
      if (!targetId || targetId === user.id) return null;
      if (userData.role === "admin") return null;
      const { data: profile } = await adminClient
        .from("player_profiles")
        .select("trainer_id")
        .eq("user_id", targetId)
        .maybeSingle();
      if (profile?.trainer_id === user.id) return null;
      return new Response(
        JSON.stringify({ error: "Not authorized to access this athlete's WHOOP data" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    };

    switch (action) {
      case "connect":
        return await handleConnect(user.id);

      case "disconnect": {
        const body = await req.json().catch(() => ({}));
        const targetId = body.target_user_id || user.id;
        const denied = await assertCanTarget(targetId);
        if (denied) return denied;
        return await handleDisconnect(targetId);
      }

      case "sync": {
        const body = await req.json().catch(() => ({}));
        const targetId = body.target_user_id || user.id;
        const denied = await assertCanTarget(targetId);
        if (denied) return denied;
        return await handleSync(user.id, targetId);
      }

      case "data": {
        const targetId = url.searchParams.get("target_user_id");
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const denied = await assertCanTarget(targetId);
        if (denied) return denied;
        return await handleData(user.id, targetId, from, to);
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }
  } catch (err) {
    console.error("WHOOP function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
