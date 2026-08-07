// Issue #281 Phase 2 — the campaign unsubscribe endpoint.
//
// Followed from the footer link of every campaign email by someone who is
// NOT logged in — an unsubscribe that requires signing in is not an
// unsubscribe. Deploy with --no-verify-jwt (see the deploy note in
// 20260808_phase2_unsubscribe.sql).
//
// Authentication is the token itself: an unguessable 128-bit uuid stored on
// the recipient row (never the email address in the URL — a guessable link
// would let anyone unsubscribe anyone). The token is looked up server-side
// with the service role; these tables have no anonymous RLS policies and
// gain none from this.
//
// Unsubscribing blacklists the address for CAMPAIGNS only. Transactional
// email (send-email: password resets, booking confirmations) never consults
// the blacklist and is unaffected.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const page = (title: string, message: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:48px 16px;">
<div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center;">
<h1 style="font-size:18px;color:#111827;margin:0 0 12px;">${title}</h1>
<p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0;">${message}</p>
<p style="font-size:12px;color:#9ca3af;margin:24px 0 0;">The Natural Ballplayer &middot; thenatural-app.com</p>
</div>
</body>
</html>`;

const html = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();

    // uuid shape only — anything else is not even looked up.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
      return html(400, page("Invalid link", "This unsubscribe link is not valid. If you copied it from an email, make sure the full link was copied."));
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: recipient, error: lookupError } = await serviceClient
      .from("email_campaign_recipients")
      .select("email")
      .eq("unsubscribe_token", token)
      .maybeSingle();

    if (lookupError) {
      console.error("unsubscribe: lookup failed:", lookupError.message);
      return html(500, page("Something went wrong", "We could not process your request. Please try the link again in a moment."));
    }
    if (!recipient || !recipient.email) {
      return html(404, page("Invalid link", "This unsubscribe link is not valid or has expired."));
    }

    // Upsert: already-unsubscribed is success, not an error.
    const { error: upsertError } = await serviceClient
      .from("email_blacklist")
      .upsert({ email: recipient.email.toLowerCase().trim(), reason: "unsubscribed" }, { onConflict: "email" });

    if (upsertError) {
      console.error("unsubscribe: blacklist upsert failed:", upsertError.message);
      return html(500, page("Something went wrong", "We could not process your request. Please try the link again in a moment."));
    }

    return html(200, page(
      "You're unsubscribed",
      `${recipient.email} will no longer receive campaign emails from The Natural Ballplayer. ` +
      `You will still receive account emails like booking confirmations.`,
    ));
  } catch (err) {
    console.error("unsubscribe: unexpected error:", (err as Error).message);
    return html(500, page("Something went wrong", "We could not process your request. Please try the link again in a moment."));
  }
});
