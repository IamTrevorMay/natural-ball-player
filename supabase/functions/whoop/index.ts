import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as makeCors, preflight } from "../_shared/cors.ts";
import { evaluateNudges } from "./nudges.ts";

// #443: facility timezone for "today" and game times. Same env the other
// functions read; same default as calendar-feed.
const FACILITY_TZ = Deno.env.get("FACILITY_TIMEZONE") || "America/Los_Angeles";

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

// Single-flight refresh cache keyed by user_id. WHOOP rotates refresh_token on
// every use; two concurrent calls without coordination invalidate each other.
// This guarantees only one refresh request is ever in-flight per user. The
// cache is per-isolate so it doesn't survive cold starts, but Deno keeps warm
// isolates long enough to cover the realistic concurrency window (a single
// browser tab firing sync + data back-to-back).
const refreshInFlight = new Map<string, Promise<string>>();

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

  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  if (Date.now() <= expiresAt - 60_000) {
    return await decrypt(tokenRow.encrypted_access_token);
  }
  if (!tokenRow.encrypted_refresh_token) {
    // L3: access token expired AND we have no refresh token to renew with.
    // Returning the stale token just causes the next API call to 401 with
    // an opaque error. Surface a structured signal so the client can prompt
    // the user to re-authorise WHOOP instead of looping on failed syncs.
    throw new Error("WHOOP_REAUTH_REQUIRED");
  }

  const existing = refreshInFlight.get(userId);
  if (existing) return await existing;

  const refreshPromise = (async () => {
    try {
      const currentRefreshToken = await decrypt(tokenRow.encrypted_refresh_token);

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

      return data.access_token as string;
    } finally {
      refreshInFlight.delete(userId);
    }
  })();
  refreshInFlight.set(userId, refreshPromise);
  return await refreshPromise;
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
      start: new Date(`${startDate}T00:00:00Z`).toISOString(),
      end: new Date(`${endDate}T23:59:59Z`).toISOString(),
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

// Sign the OAuth state with HMAC-SHA256 so the callback can verify it without
// a DB lookup. This removes the concurrent-connect race that the previous
// implementation had (state stored on users row → second connect overwrote
// the first, invalidating the original flow).
async function signOAuthState(userId: string, nonce: string): Promise<string> {
  const secret = Deno.env.get("WHOOP_ENCRYPTION_KEY");
  if (!secret) throw new Error("WHOOP_ENCRYPTION_KEY not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${userId}:${nonce}`)
  );
  // base64url, no padding
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function handleConnect(userId: string, corsHeaders: Record<string, string>): Promise<Response> {
  // Embed the issue time in the nonce (`<ms>.<uuid>`) so the callback can reject
  // a stale/replayed state. The timestamp is inside the HMAC-signed payload, so
  // it can't be tampered with.
  const nonce = `${Date.now()}.${crypto.randomUUID()}`;
  const signature = await signOAuthState(userId, nonce);

  const callbackUrl = `${Deno.env.get("APP_URL") || "https://nbp-portal.vercel.app"}/api/whoop/callback`;

  const params = new URLSearchParams({
    client_id: Deno.env.get("WHOOP_CLIENT_ID")!,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "offline read:recovery read:cycles read:sleep read:workout read:profile",
    state: `${userId}:${nonce}:${signature}`,
  });

  return new Response(
    JSON.stringify({ url: `${WHOOP_AUTH_URL}?${params.toString()}` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// NOTE: OAuth callback lives in the dedicated `whoop-callback` edge function
// (routed by vercel.json /api/whoop/callback). Do not add a copy here — it
// would silently diverge from the canonical implementation.

async function handleDisconnect(userId: string, corsHeaders: Record<string, string>): Promise<Response> {
  const adminClient = getAdminClient();

  // L4: best-effort token revocation at WHOOP so the disconnect actually
  // invalidates the OAuth grant rather than just dropping our local copy.
  // Failure here is non-fatal — Whoop's tokens are short-lived (1h) so even
  // a missed revoke ages out quickly. Read the existing row before we delete
  // it so we have the refresh_token to revoke.
  try {
    const { data: tokenRow } = await adminClient
      .from("whoop_tokens")
      .select("encrypted_refresh_token, encrypted_access_token")
      .eq("user_id", userId)
      .single();
    if (tokenRow?.encrypted_refresh_token) {
      const refreshToken = await decrypt(tokenRow.encrypted_refresh_token);
      const clientId = Deno.env.get("WHOOP_CLIENT_ID");
      const clientSecret = Deno.env.get("WHOOP_CLIENT_SECRET");
      if (clientId && clientSecret) {
        await fetch("https://api.prod.whoop.com/oauth/oauth2/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: refreshToken,
            token_type_hint: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
          }),
        }).catch(() => {});
      }
    }
  } catch {
    // ignore — disconnect should always succeed locally
  }

  // Independent deletes — run in parallel.
  await Promise.all([
    adminClient.from("whoop_tokens").delete().eq("user_id", userId),
    adminClient.from("whoop_cycles").delete().eq("athlete_id", userId),
    adminClient.from("whoop_sleep").delete().eq("athlete_id", userId),
    adminClient.from("whoop_workouts").delete().eq("athlete_id", userId),
  ]);
  await adminClient
    .from("users")
    .update({ whoop_connected: false })
    .eq("id", userId);

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Pull everything new from WHOOP for one athlete and upsert it. Shared by the
// athlete-triggered sync and the #443 cron. Throws on any failure (including
// WHOOP_REAUTH_REQUIRED) so the caller decides how to report it.
async function syncAthlete(
  adminClient: ReturnType<typeof getAdminClient>,
  athleteId: string
): Promise<{ cycles: number; sleep: number; workouts: number }> {
  const accessToken = await ensureValidToken(adminClient, athleteId);

  const endDate = new Date().toISOString().split("T")[0];
  // Incremental sync: start from the day after the most recent cycle we have
  // (with a 1-day overlap to catch late-arriving recovery data). First-time
  // sync (no rows yet) falls back to 365 days.
  const { data: lastCycle } = await adminClient
    .from("whoop_cycles")
    .select("cycle_date")
    .eq("athlete_id", athleteId)
    .order("cycle_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startDate = lastCycle?.cycle_date
    ? new Date(new Date(lastCycle.cycle_date).getTime() - 86_400_000).toISOString().split("T")[0]
    : new Date(Date.now() - 365 * 86_400_000).toISOString().split("T")[0];

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
    const { error: cyclesErr } = await adminClient
      .from("whoop_cycles")
      .upsert(rows, { onConflict: "athlete_id,whoop_cycle_id" });
    if (cyclesErr) throw new Error(`whoop_cycles upsert failed: ${cyclesErr.message}`);
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
    const { error: sleepErr } = await adminClient
      .from("whoop_sleep")
      .upsert(rows, { onConflict: "athlete_id,whoop_sleep_id" });
    if (sleepErr) throw new Error(`whoop_sleep upsert failed: ${sleepErr.message}`);
  }

  // Upsert workouts
  if (workouts.length > 0) {
    const rows = await Promise.all(
      workouts.map(async (w: any) => {
        const startMs = new Date(w.start).getTime();
        const endMs = new Date(w.end).getTime();
        // #443: heart-rate zone split + real timestamps, so the nudge rules
        // don't have to decrypt raw_data. WHOOP v2 nests these under
        // score.zone_durations.
        const z = w.score?.zone_durations || w.score?.zone_duration || {};
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
          start_at: new Date(startMs).toISOString(),
          end_at: new Date(endMs).toISOString(),
          kilojoule: w.score?.kilojoule ?? null,
          zone_zero_ms: z.zone_zero_milli ?? null,
          zone_one_ms: z.zone_one_milli ?? null,
          zone_two_ms: z.zone_two_milli ?? null,
          zone_three_ms: z.zone_three_milli ?? null,
          zone_four_ms: z.zone_four_milli ?? null,
          zone_five_ms: z.zone_five_milli ?? null,
          raw_data: await encrypt(JSON.stringify(w)),
        };
      })
    );
    const { error: workoutsErr } = await adminClient
      .from("whoop_workouts")
      .upsert(rows, { onConflict: "athlete_id,whoop_workout_id" });
    if (workoutsErr) throw new Error(`whoop_workouts upsert failed: ${workoutsErr.message}`);
  }

  await adminClient
    .from("whoop_tokens")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("user_id", athleteId);

  return { cycles: cycles.length, sleep: sleeps.length, workouts: workouts.length };
}

async function handleSync(userId: string, targetUserId: string | undefined, corsHeaders: Record<string, string>): Promise<Response> {
  const adminClient = getAdminClient();
  const athleteId = targetUserId || userId;

  const counts = await syncAthlete(adminClient, athleteId);

  // #443: a manual sync should surface nudges too, not just the cron. A rules
  // failure must not fail the sync the athlete just asked for.
  let nudges: unknown = null;
  try {
    nudges = await evaluateNudges(adminClient, athleteId, FACILITY_TZ);
  } catch (e) {
    console.error("whoop nudges (manual sync):", e);
  }

  return new Response(
    JSON.stringify({ success: true, counts, nudges }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// #443: ?action=cron — sync every connected athlete and run the nudge rules.
// Called by api/whoop-sync.js (Vercel cron, every 2 hours) with the service
// role key; also runnable by a staff user for testing. Query params:
//   dry_run=1   evaluate rules but write nothing (sync still runs)
//   user_id=    one athlete only
//   limit=N     first N athletes (oldest sync first)
// One athlete's failure (expired WHOOP grant, API hiccup) is recorded on the
// token row and never stops the others.
function decodeJwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

async function handleCron(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const adminClient = getAdminClient();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "Missing authorization header" }, 401);
  let via = "service";
  if (token !== serviceKey && decodeJwtRole(token) !== "service_role") {
    const { data: { user }, error } = await getUserClient(authHeader).auth.getUser();
    if (error || !user) return json({ error: "Unauthorized" }, 401);
    const { data: me } = await adminClient.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!me || !["admin", "coach"].includes(me.role)) return json({ error: "Unauthorized: staff only" }, 403);
    via = `staff:${user.id}`;
  }

  const url = new URL(req.url);
  const dryRun = ["1", "true"].includes(url.searchParams.get("dry_run") || "");
  const onlyUserId = url.searchParams.get("user_id");
  const limit = Math.max(0, parseInt(url.searchParams.get("limit") || "0", 10) || 0);

  let q = adminClient
    .from("whoop_tokens")
    .select("user_id, last_synced_at")
    .order("last_synced_at", { ascending: true, nullsFirst: true });
  if (onlyUserId) q = q.eq("user_id", onlyUserId);
  if (limit) q = q.limit(limit);
  const { data: tokens, error: tErr } = await q;
  if (tErr) return json({ error: `whoop_tokens read failed: ${tErr.message}` }, 500);

  const startedAt = Date.now();
  const results: Array<Record<string, unknown>> = [];
  const queue = [...(tokens || [])];
  const CONCURRENCY = 4;

  const worker = async () => {
    while (queue.length) {
      const row = queue.shift()!;
      const athleteId = row.user_id as string;
      const r: Record<string, unknown> = { user_id: athleteId };
      try {
        r.counts = await syncAthlete(adminClient, athleteId);
        r.nudges = await evaluateNudges(adminClient, athleteId, FACILITY_TZ, { dryRun });
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        r.error = msg;
        await adminClient
          .from("whoop_tokens")
          .update({ last_sync_error: msg.slice(0, 500) })
          .eq("user_id", athleteId);
      }
      results.push(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  const summary = {
    via,
    dry_run: dryRun,
    athletes: results.length,
    synced: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    reauth_required: results.filter((r) => String(r.error || "").includes("WHOOP_REAUTH_REQUIRED")).length,
    nudges_inserted: results.reduce((n, r) => n + (((r.nudges as any)?.inserted as number) || 0), 0),
    nudge_candidates: results.reduce((n, r) => n + (((r.nudges as any)?.candidates as number) || 0), 0),
    elapsed_ms: Date.now() - startedAt,
    results,
  };
  console.log("whoop cron:", JSON.stringify({ ...summary, results: undefined }));
  return json(summary);
}

async function handleData(
  userId: string,
  targetUserId: string | null,
  from: string | null,
  to: string | null,
  corsHeaders: Record<string, string>
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
  const pre = preflight(req);
  if (pre) return pre;
  const corsHeaders = makeCors(req);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // OAuth callback now lives in `whoop-callback` (vercel.json routes
    // /api/whoop/callback → that function). The `?action=callback` path here
    // is removed to keep one canonical implementation.

    // #443: the cron authenticates with the service-role key (or a staff
    // JWT) and has no end user, so it is routed before the getUser() gate.
    if (action === "cron") return await handleCron(req, corsHeaders);

    // All actions require auth
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
        return await handleConnect(user.id, corsHeaders);

      case "disconnect": {
        const body = await req.json().catch(() => ({}));
        const targetId = body.target_user_id || user.id;
        const denied = await assertCanTarget(targetId);
        if (denied) return denied;
        return await handleDisconnect(targetId, corsHeaders);
      }

      case "sync": {
        const body = await req.json().catch(() => ({}));
        const targetId = body.target_user_id || user.id;
        const denied = await assertCanTarget(targetId);
        if (denied) return denied;
        return await handleSync(user.id, targetId, corsHeaders);
      }

      case "data": {
        const targetId = url.searchParams.get("target_user_id");
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const denied = await assertCanTarget(targetId);
        if (denied) return denied;
        return await handleData(user.id, targetId, from, to, corsHeaders);
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
