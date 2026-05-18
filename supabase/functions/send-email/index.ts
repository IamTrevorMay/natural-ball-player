import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user's JWT to verify identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check role via service client (bypasses RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: userData, error: roleError } = await serviceClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (roleError || !userData || !["admin", "coach"].includes(userData.role)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: staff only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      recipientEmail,
      recipientName,
      subject,
      body,
      playerId,
      prospectId,
    } = await req.json();

    if (!recipientEmail || !subject || !body || !recipientName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;padding:24px;max-width:600px;margin:0 auto;">
<div style="white-space:pre-wrap;font-size:15px;line-height:1.6;">${body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
<p style="font-size:13px;color:#6b7280;text-align:center;">
<a href="https://www.thenatural-app.com" style="color:#4f46e5;text-decoration:none;font-weight:600;">Log in to The Natural</a><br>
<span style="font-size:11px;color:#9ca3af;">www.thenatural-app.com</span>
</p>
</body>
</html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "NBP Portal <noreply@thenatural-app.com>",
        to: [recipientEmail],
        subject,
        html: htmlBody,
        text: body + "\n\n---\nLog in to The Natural: https://www.thenatural-app.com",
      }),
    });

    // deno-lint-ignore no-explicit-any
    let resendData: any;
    try {
      resendData = await resendRes.json();
    } catch {
      resendData = { message: `Resend returned status ${resendRes.status} with non-JSON body` };
    }

    // Log to communication_logs
    const logEntry = {
      player_id: playerId || null,
      prospect_id: prospectId || null,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      subject,
      body,
      sent_by: user.id,
      status: resendRes.ok ? "sent" : "failed",
      resend_id: resendData.id || null,
      error_message: resendRes.ok ? null : (resendData.message || JSON.stringify(resendData)),
    };

    const { error: logError } = await serviceClient.from("communication_logs").insert(logEntry);
    if (logError) {
      console.error("Failed to log communication:", logError.message);
    }

    if (!resendRes.ok) {
      return new Response(
        JSON.stringify({ error: resendData.message || "Failed to send email" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
