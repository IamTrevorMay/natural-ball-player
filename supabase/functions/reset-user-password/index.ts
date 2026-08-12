// #312: let an admin or coach set a player's password directly, for the case
// where the email-link reset (resetPasswordForEmail) never reaches them.
//
// Originally admin-only — setting an EXISTING person's password hands over
// access to an account with real history on it (messages, medical/PT
// records, package purchases), closer in risk to update-user-email (still
// admin-only) than to creating a brand-new, empty account. Widened to admin
// + coach on 2026-08-12 per the business owner's explicit reply to #312:
// "I would like admins and coaches to be able to do this."
//
// A coach caller is additionally blocked from targeting an admin or coach
// account (checked below, against the TARGET's row, not just the caller's).
// Without that, "coach can reset a password" plus "no check on who the
// password belongs to" is a straight privilege-escalation path: a coach
// resets an admin's password and signs in as them. Admin callers are
// unrestricted, unchanged from the original admin-only design.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Admin or coach — verified server-side against the caller's own row,
    // never trusted from the client.
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: caller, error: roleError } = await serviceClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (roleError || !caller || (caller.role !== "admin" && caller.role !== "coach")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: admin or coach only" }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { user_id, new_password } = await req.json();
    if (!user_id || typeof new_password !== "string" || new_password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Missing user_id, or new_password is shorter than 8 characters" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // A coach may only reset a player's password — never another staff
    // member's. Checked against the TARGET's row (not the caller's) so a
    // coach can't escalate by pointing this at an admin or another coach.
    if (caller.role === "coach") {
      const { data: target, error: targetError } = await serviceClient
        .from("users")
        .select("role")
        .eq("id", user_id)
        .single();

      if (targetError || !target) {
        return new Response(
          JSON.stringify({ error: "Target user not found" }),
          { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      if (target.role === "admin" || target.role === "coach") {
        return new Response(
          JSON.stringify({ error: "Unauthorized: coaches may only reset player passwords" }),
          { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    }

    const { error: updateError } = await serviceClient.auth.admin.updateUserById(user_id, {
      password: new_password,
    });

    if (updateError) {
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Same as update-user-email (H1): revoke any active session so a
    // previously-logged-in device doesn't keep transacting on the old
    // credential. Best-effort — don't fail the request if revoke errors.
    try {
      // @ts-ignore: signOut accepts an optional scope string in supabase-js v2
      await serviceClient.auth.admin.signOut(user_id, "global");
    } catch (_) {
      // ignore
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
