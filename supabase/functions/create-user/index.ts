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

    // Admins and coaches can create users; coaches are restricted to role='player'
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

    const { email, password, full_name, role } = await req.json();
    if (!email || !password || !full_name || !role) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, password, full_name, role" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (caller.role === "coach" && role !== "player") {
      return new Response(
        JSON.stringify({ error: "Coaches can only create player accounts" }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Create auth user via admin API (does NOT affect caller's session)
    const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });

    if (createError) {
      // Handle orphan auth users: if the email is already registered in auth
      // but has no public.users row (issue #166: Rory Swanson — auth account
      // existed, public.users missing, so search couldn't find him and the
      // UI re-create attempt failed with "user already exists"), look up the
      // existing auth user and backfill the public.users row instead of
      // returning the duplicate-email error.
      // Supabase Auth returns 422 / `email_exists` for duplicate emails. Use
      // the structured status code first; keep the message-matching fallback
      // since older SDK versions don't surface a stable status field.
      const status = (createError as any).status as number | undefined;
      const msg = (createError.message || "").toLowerCase();
      const looksDup =
        status === 422 ||
        (createError as any).code === "email_exists" ||
        msg.includes("already") || msg.includes("registered") ||
        msg.includes("duplicate") || msg.includes("exists");

      if (looksDup) {
        const normalizedEmail = email.trim().toLowerCase();
        // Paginate through all auth users — listUsers caps at perPage=1000.
        // Single-page scan misses everyone past the page boundary, which broke
        // orphan recovery (#166) once the directory crossed 200 accounts.
        const PER_PAGE = 1000;
        let existingAuth: any = null;
        for (let page = 1; page <= 50 && !existingAuth; page++) {
          const { data: pageData, error: pageErr } = await serviceClient.auth.admin.listUsers({ page, perPage: PER_PAGE });
          if (pageErr) break;
          const users = pageData?.users || [];
          existingAuth = users.find((u: any) => (u.email || "").toLowerCase() === normalizedEmail);
          if (users.length < PER_PAGE) break; // last page
        }
        if (existingAuth) {
          const { data: existingPub } = await serviceClient
            .from("users")
            .select("id")
            .eq("id", existingAuth.id)
            .maybeSingle();
          if (!existingPub) {
            // Backfill public row; the downstream client INSERT will then
            // ON CONFLICT no-op and the caller treats this as a fresh create.
            return new Response(
              JSON.stringify({ success: true, user_id: existingAuth.id, backfilled: true }),
              { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
            );
          }
          return new Response(
            JSON.stringify({ error: "A user with this email already exists in the portal." }),
            { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
