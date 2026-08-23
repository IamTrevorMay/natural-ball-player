// Issue #281 — the campaign unsubscribe endpoint.
//
// 🔴 THIS FUNCTION MUST NEVER RETURN HTML. Supabase documents that Edge
// Functions rewrite a `text/html` response to `text/plain` — "Edge Functions
// are designed for APIs and data processing, not serving web pages." The
// first version of this file tried to render a confirmation page and it
// arrived in people's browsers as a wall of raw source code. Setting the
// header does not help; the platform overrides it. The page now lives in the
// React app at /unsubscribe (src/UnsubscribePage.js) and this is an API.
//
// Deploy with --no-verify-jwt: it is opened from an email by someone who is
// not logged in and never will be.
//
// Authentication is the token itself: an unguessable 122-bit uuid stored on
// the recipient row. The email address is never in the URL — a guessable
// link would let anyone unsubscribe anyone. The token is looked up
// server-side with the service role; these tables have no anonymous RLS
// policies and gain none from this.
//
// 🔴 GET DOES NOT UNSUBSCRIBE. Easy to "simplify" back into a bug.
//   Microsoft Defender Safe Links, Mimecast, Proofpoint and Barracuda fetch
//   every URL in an inbound email before the human ever sees it. If a GET
//   performed the unsubscribe, every parent whose mail runs through a
//   corporate filter would be silently removed from the list without ever
//   clicking — and neither they nor we would know.
//     GET  → report who the token belongs to. Changes nothing.
//     POST → actually unsubscribe.
//   This split is also exactly what RFC 8058 one-click requires, which is
//   what makes the List-Unsubscribe-Post header work: Gmail and Yahoo POST
//   here directly and never see the app page at all.
//
// Unsubscribing blacklists the address for CAMPAIGNS only. Transactional
// email (send-email: password resets, booking confirmations) never consults
// the blacklist and is unaffected.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://www.thenatural-app.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The app calls this cross-origin from thenatural-app.com.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();

    // A person who lands on the raw function URL in a browser gets sent to the
    // real page. Only ever a redirect — it changes nothing, so a link scanner
    // following it is harmless.
    const wantsPage = (req.headers.get("accept") || "").includes("text/html");
    if (wantsPage && req.method !== "POST") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${APP_URL}/unsubscribe?token=${encodeURIComponent(token)}`,
          "Cache-Control": "no-store",
        },
      });
    }

    // uuid shape only — anything else is not even looked up.
    if (!UUID_RE.test(token)) return json(400, { error: "invalid_token" });

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // .limit(1) rather than .maybeSingle(): maybeSingle ERRORS on more than
    // one match, and "we can't unsubscribe you" is the message most likely to
    // be followed by the Report Spam button. Take the first match.
    const { data: rows, error: lookupError } = await serviceClient
      .from("email_campaign_recipients")
      .select("email")
      .eq("unsubscribe_token", token)
      .limit(1);

    if (lookupError) {
      console.error("unsubscribe: lookup failed:", lookupError.message);
      return json(500, { error: "lookup_failed" });
    }

    const recipient = (rows || [])[0];
    if (!recipient || !recipient.email) return json(404, { error: "invalid_token" });

    const address = String(recipient.email).toLowerCase().trim();

    // ---- GET: report only. Change NOTHING. ----
    if (req.method === "GET" || req.method === "HEAD") {
      const { data: already } = await serviceClient
        .from("email_blacklist").select("email").eq("email", address).limit(1);
      return json(200, {
        email: address,
        alreadyUnsubscribed: (already || []).length > 0,
      });
    }

    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    // ---- POST: this is the one that actually does it. ----
    // Upsert: already-unsubscribed is success, not an error.
    const { error: upsertError } = await serviceClient
      .from("email_blacklist")
      .upsert({ email: address, reason: "unsubscribed" }, { onConflict: "email" });

    if (upsertError) {
      console.error("unsubscribe: blacklist upsert failed:", upsertError.message);
      return json(500, { error: "could_not_unsubscribe" });
    }

    return json(200, { email: address, unsubscribed: true });
  } catch (err) {
    console.error("unsubscribe: unexpected error:", (err as Error).message);
    return json(500, { error: "unexpected" });
  }
});
