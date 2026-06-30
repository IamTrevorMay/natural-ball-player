import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const NEW_USER_TEAM_NAME = "New Users";
const MIN_PASSWORD_LENGTH = 12;
const VALID_INTENTS = ["team", "training", "both"];

// Validate a 'YYYY-MM-DD' date string (string ops, no regex).
function isIsoDate(s: string): boolean {
  const parts = (s || "").split("-");
  if (parts.length !== 3) return false;
  const [y, mo, d] = parts;
  if (y.length !== 4 || mo.length !== 2 || d.length !== 2) return false;
  const yi = Number(y), mi = Number(mo), di = Number(d);
  if (!Number.isInteger(yi) || !Number.isInteger(mi) || !Number.isInteger(di)) return false;
  return mi >= 1 && mi <= 12 && di >= 1 && di <= 31;
}

// Baseball "U" age division from a date of birth (#200). NBP uses a May 1
// cutoff: a player's division for the season is the age they reach during the
// season's calendar year, and the season rolls over on May 1. So from May 1
// onward we use the current year, before that the previous year.
//   e.g. born 2013-06-28, evaluated June 2026 -> seasonYear 2026 -> 13U.
function computeAgeDivision(dob: string, today: Date): number | null {
  const parts = (dob || "").split("-");
  if (parts.length !== 3) return null;
  const birthYear = Number(parts[0]);
  if (!Number.isInteger(birthYear)) return null;
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1; // 1-12
  const seasonYear = month >= 5 ? year : year - 1;
  const division = seasonYear - birthYear;
  return Number.isFinite(division) ? division : null;
}

// Resolve the "NBP {N}u Training Group" team for a division. Names carry the
// age (the age_group column is unpopulated), so we match on the name. Youngest
// signups clamp to the 8u group; 19+ returns null (recorded only, placed by a
// coach).
function findTrainingGroup(teams: Array<{ id: string; name: string }>, division: number): string | null {
  if (division >= 19) return null;
  const targetU = Math.max(8, division);
  const needle = `nbp ${targetU}u training group`;
  const match = teams.find((t) => (t.name || "").trim().toLowerCase().startsWith(needle));
  return match?.id ?? null;
}

// H5: Per-IP signup rate limit. Best-effort, per-isolate (Supabase reuses an
// isolate for a few minutes idle, so a sustained attacker on one IP hits the
// same map). Survives long enough to throttle scripted enumeration.
const SIGNUP_WINDOW_MS = 5 * 60 * 1000;
const SIGNUP_MAX_ATTEMPTS = 5;
const signupAttemptsByIp = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (signupAttemptsByIp.get(ip) || []).filter((t) => now - t < SIGNUP_WINDOW_MS);
  if (list.length >= SIGNUP_MAX_ATTEMPTS) {
    signupAttemptsByIp.set(ip, list);
    return true;
  }
  list.push(now);
  signupAttemptsByIp.set(ip, list);
  // Cheap eviction so the map doesn't grow forever in a long-lived isolate.
  if (signupAttemptsByIp.size > 1000) {
    for (const [k, v] of signupAttemptsByIp) {
      if (v.every((t) => now - t >= SIGNUP_WINDOW_MS)) signupAttemptsByIp.delete(k);
    }
  }
  return false;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
}

// Public self-signup (#151). No auth required — always creates a `player`.
// New athletes are auto-added to the "New Users" team so coaches are notified.
// Email confirmation is enforced by the project's Auth settings; signUp triggers
// the confirmation email and the account stays unconfirmed until the user clicks it.
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrl = Deno.env.get("APP_URL") || "https://nbp-portal.vercel.app";

    if (rateLimited(clientIp(req))) {
      // Generic message — don't echo the limit details to a scraper.
      return json({ error: "Too many signup attempts. Try again in a few minutes." }, 429);
    }

    const {
      email: rawEmail,
      password,
      full_name: rawFullName,
      phone,
      date_of_birth: rawDob,
      signup_intent: rawIntent,
    } = await req.json();
    // H4: normalize email before any auth call so case/whitespace variants don't
    // create duplicate accounts and the orphan-recovery dedup in create-user
    // matches consistently.
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const full_name = typeof rawFullName === "string" ? rawFullName.trim() : "";

    if (!email || !password || !full_name) {
      return json({ error: "Please provide your name, email, and a password." }, 400);
    }

    // #200: date of birth (drives age-group auto-sort) and intent are required.
    const dobTrimmed = typeof rawDob === "string" ? rawDob.trim() : "";
    const date_of_birth = isIsoDate(dobTrimmed) ? dobTrimmed : "";
    if (!date_of_birth) {
      return json({ error: "Please provide a valid date of birth." }, 400);
    }
    const signup_intent = typeof rawIntent === "string" && VALID_INTENTS.includes(rawIntent) ? rawIntent : "";
    if (!signup_intent) {
      return json({ error: "Please choose whether you want a Naturals team, training only, or both." }, 400);
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        400
      );
    }

    const confirmMessage =
      "Account created. Check your email for a confirmation link, then log in.";

    // 1. Create the auth user and trigger the confirmation email via signUp.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name, role: "player" },
        emailRedirectTo: appUrl,
      },
    });

    if (signUpError) {
      return json({ error: signUpError.message }, 400);
    }

    const newUser = signUpData.user;
    // When email confirmation is on, Supabase returns an obfuscated user with no
    // identities for an already-registered email (anti-enumeration). Don't insert
    // rows or leak existence — return the same generic confirmation message.
    if (!newUser || (Array.isArray(newUser.identities) && newUser.identities.length === 0)) {
      return json({ success: true, message: confirmMessage });
    }

    const newUserId = newUser.id;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Insert the public.users row (role is forced to player).
    const { error: userError } = await serviceClient.from("users").insert({
      id: newUserId,
      email,
      full_name,
      role: "player",
      phone: phone || null,
      date_of_birth,
    });
    if (userError) {
      // Roll back the orphaned auth user so the email can be reused.
      await serviceClient.auth.admin.deleteUser(newUserId).catch(() => {});
      return json({ error: userError.message }, 400);
    }

    // Helper: roll back everything on partial failure so the signup is atomic
    // from the caller's perspective.
    const rollback = async (msg: string) => {
      await serviceClient.from("team_members").delete().eq("user_id", newUserId).catch(() => {});
      await serviceClient.from("player_profiles").delete().eq("user_id", newUserId).catch(() => {});
      await serviceClient.from("users").delete().eq("id", newUserId).catch(() => {});
      await serviceClient.auth.admin.deleteUser(newUserId).catch(() => {});
      return json({ error: msg }, 500);
    };

    // 3. Create the player profile.
    const { error: profileError } = await serviceClient
      .from("player_profiles")
      .insert({ user_id: newUserId, signup_intent });
    if (profileError) {
      console.error("player_profiles insert failed:", profileError.message);
      return await rollback(`Could not create player profile: ${profileError.message}`);
    }

    // 4. Add to the "New Users" team so coaches are notified.
    let teamId: string | null = null;
    const { data: team } = await serviceClient
      .from("teams")
      .select("id")
      .eq("name", NEW_USER_TEAM_NAME)
      .maybeSingle();
    teamId = team?.id ?? null;
    if (!teamId) {
      const { data: created, error: teamCreateErr } = await serviceClient
        .from("teams")
        .insert({ name: NEW_USER_TEAM_NAME })
        .select("id")
        .single();
      if (teamCreateErr) {
        console.error("teams insert failed:", teamCreateErr.message);
        return await rollback(`Could not create default team: ${teamCreateErr.message}`);
      }
      teamId = created?.id ?? null;
    }
    if (teamId) {
      const { error: teamError } = await serviceClient
        .from("team_members")
        .insert({ team_id: teamId, user_id: newUserId, role: "player" });
      if (teamError) {
        console.error("team_members insert failed:", teamError.message);
        return await rollback(`Could not add to team: ${teamError.message}`);
      }
    }

    // 5. Auto-sort into the age-group Training Group (#200). Best-effort: a
    // missing group or failed insert must not fail an otherwise-good signup —
    // the athlete is still in "New Users" for a coach to place. 19+ and ages
    // with no matching group are intentionally left for coach placement.
    const division = computeAgeDivision(date_of_birth, new Date());
    if (division != null && teamId !== null) {
      const { data: allTeams } = await serviceClient.from("teams").select("id, name");
      const trainingTeamId = findTrainingGroup(allTeams || [], division);
      if (trainingTeamId && trainingTeamId !== teamId) {
        const { error: tgErr } = await serviceClient
          .from("team_members")
          .insert({ team_id: trainingTeamId, user_id: newUserId, role: "player" });
        if (tgErr) console.error("training group auto-add failed:", tgErr.message);
      }
    }

    return json({ success: true, message: confirmMessage });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
