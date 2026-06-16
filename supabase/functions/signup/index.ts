import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const NEW_USER_TEAM_NAME = "New Users";
const MIN_PASSWORD_LENGTH = 12;

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

    const { email, password, full_name, phone } = await req.json();

    if (!email || !password || !full_name) {
      return json({ error: "Please provide your name, email, and a password." }, 400);
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
      .insert({ user_id: newUserId });
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

    return json({ success: true, message: confirmMessage });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
