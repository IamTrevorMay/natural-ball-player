// #312: let an admin set a player's password directly, for the case where
// the email-link reset (resetPasswordForEmail) never reaches them.
//
// Admin-only, deliberately narrower than create-user (which also allows
// coaches). Setting an EXISTING person's password hands over access to an
// account that already has real history on it (messages, medical/PT
// records, package purchases) — closer in risk to update-user-email (also
// admin-only) than to creating a brand-new, empty account. Start narrow;
// widen later if that turns out to be too restrictive in practice.
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

    // Admin only — verified server-side against the caller's own row, never
    // trusted from the client.
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: caller, error: roleError } = await serviceClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (roleError || !caller || caller.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Unauthorized: admin only" }),
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
