// Issue #281 Phase 2 — the campaign unsubscribe endpoint.
//
// Followed from the footer link of every campaign email by someone who is
// NOT logged in — an unsubscribe that requires signing in is not an
// unsubscribe. Deploy with --no-verify-jwt.
//
// Authentication is the token itself: an unguessable 122-bit uuid stored on
// the recipient row (never the email address in the URL — a guessable link
// would let anyone unsubscribe anyone). The token is looked up server-side
// with the service role; these tables have no anonymous RLS policies and
// gain none from this.
//
// 🔴 GET DOES NOT UNSUBSCRIBE. This is the important part, and it is easy to
// "simplify" back into a bug.
//   Microsoft Defender Safe Links, Mimecast, Proofpoint and Barracuda fetch
//   every URL in an inbound email before the human ever sees it. If a GET
//   performed the unsubscribe, every parent whose mail runs through a
//   corporate filter would be silently removed from the list without ever
//   clicking — and neither they nor we would know. So:
//     GET  → render a page with a Confirm button. Changes nothing.
//     POST → actually unsubscribe.
//   This is also exactly the shape RFC 8058 one-click requires, which is
//   what makes the List-Unsubscribe-Post header on the outgoing mail work:
//   the mail client POSTs, the human GETs and clicks.
//
// Unsubscribing blacklists the address for CAMPAIGNS only. Transactional
// email (send-email: password resets, booking confirmations) never consults
// the blacklist and is unaffected — which is what the page tells them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// This endpoint is public and echoes a stored value back into HTML. Escape it.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const shell = (title: string, inner: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:48px 16px;">
<div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center;">
${inner}
<p style="font-size:12px;color:#9ca3af;margin:24px 0 0;">The Natural Ballplayer</p>
</div>
</body>
</html>`;

const message = (title: string, body: string) =>
  shell(title, `<h1 style="font-size:18px;color:#111827;margin:0 0 12px;">${esc(title)}</h1>
<p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0;">${body}</p>`);

const html = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();

    // uuid shape only — anything else is not even looked up.
    if (!UUID_RE.test(token)) {
      return html(400, message(
        "Invalid link",
        "This unsubscribe link is not valid. If you copied it out of an email, make sure the whole link was copied.",
      ));
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // .limit(1) rather than .maybeSingle(): maybeSingle ERRORS on more than
    // one match, and "we can't unsubscribe you" is the message most likely
    // to be followed by the Report Spam button. Take the first match.
    const { data: rows, error: lookupError } = await serviceClient
      .from("email_campaign_recipients")
      .select("email")
      .eq("unsubscribe_token", token)
      .limit(1);

    if (lookupError) {
      console.error("unsubscribe: lookup failed:", lookupError.message);
      return html(500, message(
        "Something went wrong",
        "We could not process your request. Please try the link again in a moment.",
      ));
    }

    const recipient = (rows || [])[0];
    if (!recipient || !recipient.email) {
      return html(404, message("Invalid link", "This unsubscribe link is not valid or has expired."));
    }

    const address = String(recipient.email).toLowerCase().trim();

    // ---- GET: show the confirm button. Change NOTHING. ----
    if (req.method === "GET" || req.method === "HEAD") {
      const alreadyOff = await serviceClient
        .from("email_blacklist").select("email").eq("email", address).limit(1);
      if ((alreadyOff.data || []).length > 0) {
        return html(200, message(
          "You're already unsubscribed",
          `<strong>${esc(address)}</strong> is not receiving campaign emails from The Natural Ballplayer.`,
        ));
      }
      return html(200, shell("Unsubscribe", `
<h1 style="font-size:18px;color:#111827;margin:0 0 12px;">Unsubscribe from campaign emails?</h1>
<p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 20px;">
This will stop campaign and newsletter emails to <strong>${esc(address)}</strong>.
You will still get account emails — booking confirmations, schedule changes and password resets.
</p>
<form method="POST" action="${esc(url.pathname)}?token=${esc(token)}">
<button type="submit" style="background:#dc2626;color:#ffffff;border:none;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;cursor:pointer;">
Yes, unsubscribe me
</button>
</form>`));
    }

    if (req.method !== "POST") {
      return html(405, message("Not allowed", "Use the button in the email to unsubscribe."));
    }

    // ---- POST: this is the one that actually does it. ----
    // Upsert: already-unsubscribed is success, not an error.
    const { error: upsertError } = await serviceClient
      .from("email_blacklist")
      .upsert({ email: address, reason: "unsubscribed" }, { onConflict: "email" });

    if (upsertError) {
      console.error("unsubscribe: blacklist upsert failed:", upsertError.message);
      return html(500, message(
        "Something went wrong",
        "We could not process your request. Please try the link again in a moment.",
      ));
    }

    return html(200, message(
      "You're unsubscribed",
      `<strong>${esc(address)}</strong> will no longer receive campaign emails from The Natural Ballplayer. ` +
      `You will still receive account emails such as booking confirmations and password resets.`,
    ));
  } catch (err) {
    console.error("unsubscribe: unexpected error:", (err as Error).message);
    return html(500, message(
      "Something went wrong",
      "We could not process your request. Please try the link again in a moment.",
    ));
  }
});
