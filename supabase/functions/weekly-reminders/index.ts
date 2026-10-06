// #438: weekly "update your stats + PT status" reminder for NBP+ athletes.
//
// Called by api/weekly-reminders.js (Vercel cron, Monday mornings) with the
// service-role key. Keeps verify_jwt=true: the service-role key IS a valid
// project JWT, so it passes the gateway, and the handler then insists on the
// service_role claim (or a staff user's JWT, for hand-runs).
//
// What one run does, for the facility-time week starting Monday:
//   1. weekly_reminder_audience() — every player in a training group with an
//      email who isn't Archived / Inactive.
//   2. Upsert one weekly_reminders row per athlete for this week
//      (ignoreDuplicates — a second run in the same week adds nothing).
//   3. Send to the rows still 'pending': blacklisted addresses are marked
//      'skipped', the rest go out through Resend's batch endpoint 100 at a
//      time (same pacing as send-campaign) and are marked sent / failed.
//   4. The athlete's bell reads the same row back (src/useNotifications.js).
//
// Query params for testing: ?dry_run=1 (report the audience, write nothing),
// ?user_id=<uuid> (restrict to one athlete), ?limit=N.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const FROM = "NBP Portal <noreply@thenatural-app.com>";
const REPLY_TO = "admin@thenaturalballplayer.com";
const APP_URL = "https://www.thenatural-app.com";
const SITE_URL = "https://www.thenaturalballplayer.com";
const POSTAL_ADDRESS = "The Natural Ballplayer &middot; 13424 NE 126th Pl, Kirkland, WA 98034";
const FACILITY_TZ = Deno.env.get("FACILITY_TIMEZONE") || "America/Los_Angeles";
const KIND = "stats_pt";
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 350;

type Audience = { user_id: string; email: string; full_name: string | null };
type Row = { id: string; user_id: string; email: string | null; email_status: string };

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

// Today's date in the facility timezone, as Y-M-D parts.
function facilityToday(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: FACILITY_TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// Monday on or before today, facility time, as YYYY-MM-DD.
function weekStart(): string {
  const { y, m, d } = facilityToday();
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sunday
  dt.setUTCDate(dt.getUTCDate() - ((dow + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function firstName(full: string | null): string {
  const f = (full || "").trim().split(/\s+/)[0];
  return f || "there";
}

function reminderHtml(name: string): string {
  const statsUrl = `${APP_URL}/?view=stats`;
  const messagesUrl = `${APP_URL}/?view=messages`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px;">
<tr><td style="padding:32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;">Weekly check-in</p>
<p style="margin:0 0 20px;">Hi ${escapeHtml(name)} — quick Monday reminder from your NBP coaches. Two things keep your programme on track:</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
<tr><td style="padding:14px 16px;background:#eff6ff;border-radius:8px;">
<p style="margin:0 0 6px;font-weight:700;">1. Update your game stats</p>
<p style="margin:0 0 10px;">Add anything from this past week — GameChanger, Perfect Game, MaxPreps, PBR or a box score — to the <strong>Stats</strong> tab on your profile. Coaches use it to adjust your programming.</p>
<a href="${statsUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">Open my Stats tab</a>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
<tr><td style="padding:14px 16px;background:#fff1f2;border-radius:8px;">
<p style="margin:0 0 6px;font-weight:700;">2. Any PT or injury news?</p>
<p style="margin:0 0 10px;">Injured, working back from one, or feeling something that isn't right? Tell your coach now so your PT plan and your programme can be adjusted before the week starts.</p>
<a href="${messagesUrl}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">Message my coach</a>
</td></tr>
</table>

<p style="margin:0;color:#6b7280;font-size:13px;">Nothing new this week? You're all set — no reply needed.</p>
</td></tr>
<tr><td style="padding:0 28px 28px;">
<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;">
You're getting this because you're an NBP+ athlete. To stop these reminders, reply to this email or ask your coach.<br>
<a href="${SITE_URL}" style="color:#6b7280;">thenaturalballplayer.com</a><br>
${POSTAL_ADDRESS}
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function reminderText(name: string): string {
  return `Hi ${name} — quick Monday reminder from your NBP coaches.

1. Update your game stats: add anything from this past week to the Stats tab on your profile. ${APP_URL}/?view=stats

2. Any PT or injury news? Injured, working back from one, or feeling something that isn't right? Message your coach so your plan can be adjusted. ${APP_URL}/?view=messages

Nothing new this week? You're all set — no reply needed.

You're getting this because you're an NBP+ athlete. To stop these reminders, reply to this email or ask your coach.
The Natural Ballplayer · 13424 NE 126th Pl, Kirkland, WA 98034`;
}

function decodeJwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const service = createClient(supabaseUrl, serviceKey);

  // ---- auth: service role (cron) or a staff user (hand-run) ----------------
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(req, { error: "Missing authorization header" }, 401);
  let via = "service";
  if (token !== serviceKey && decodeJwtRole(token) !== "service_role") {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json(req, { error: "Unauthorized" }, 401);
    const { data: me } = await service.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!me || !["admin", "coach"].includes(me.role)) return json(req, { error: "Unauthorized: staff only" }, 403);
    via = `staff:${user.id}`;
  }

  const url = new URL(req.url);
  const dryRun = ["1", "true"].includes(url.searchParams.get("dry_run") || "");
  const onlyUserId = url.searchParams.get("user_id");
  const limit = Math.max(0, parseInt(url.searchParams.get("limit") || "0", 10) || 0);
  const week = weekStart();

  // ---- 1. audience ---------------------------------------------------------
  const { data: audienceRaw, error: aErr } = await service.rpc("weekly_reminder_audience");
  if (aErr) return json(req, { error: `audience query failed: ${aErr.message}` }, 500);
  let audience = (audienceRaw || []) as Audience[];
  if (onlyUserId) audience = audience.filter((a) => a.user_id === onlyUserId);
  if (limit) audience = audience.slice(0, limit);

  if (dryRun) {
    return json(req, { ok: true, dry_run: true, via, week_start: week, audience: audience.length,
      sample: audience.slice(0, 5).map((a) => ({ user_id: a.user_id, name: a.full_name })) });
  }
  if (!resendApiKey) return json(req, { error: "RESEND_API_KEY not configured" }, 500);

  // ---- 2. one row per athlete per week (idempotent) --------------------------
  const rows = audience.map((a) => ({ user_id: a.user_id, week_start: week, kind: KIND, email: a.email, email_status: "pending" }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upErr } = await service.from("weekly_reminders")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,week_start,kind", ignoreDuplicates: true });
    if (upErr) return json(req, { error: `could not record reminders: ${upErr.message}` }, 500);
  }

  // ---- 3. send what's still pending -------------------------------------------
  let pendingQuery = service.from("weekly_reminders")
    .select("id, user_id, email, email_status")
    .eq("week_start", week).eq("kind", KIND).eq("email_status", "pending");
  if (onlyUserId) pendingQuery = pendingQuery.eq("user_id", onlyUserId);
  const { data: pendingRaw, error: pErr } = await pendingQuery.limit(2000);
  if (pErr) return json(req, { error: `could not read pending reminders: ${pErr.message}` }, 500);
  let pending = (pendingRaw || []) as Row[];
  if (limit) pending = pending.slice(0, limit);
  const nameById = new Map(audience.map((a) => [a.user_id, a.full_name]));

  const { data: blRows } = await service.from("email_blacklist").select("email");
  const blacklist = new Set((blRows || []).map((r: { email: string }) => (r.email || "").toLowerCase().trim()));

  const tally = { sent: 0, skipped: 0, failed: 0, no_email: 0 };
  const now = new Date().toISOString();

  const noEmail = pending.filter((r) => !r.email);
  if (noEmail.length) {
    await service.from("weekly_reminders").update({ email_status: "no_email" }).in("id", noEmail.map((r) => r.id));
    tally.no_email = noEmail.length;
  }
  const skip = pending.filter((r) => r.email && blacklist.has(r.email.toLowerCase().trim()));
  if (skip.length) {
    await service.from("weekly_reminders").update({ email_status: "skipped", email_error: "unsubscribed" }).in("id", skip.map((r) => r.id));
    tally.skipped = skip.length;
  }
  const skipIds = new Set([...noEmail, ...skip].map((r) => r.id));
  const queue = pending.filter((r) => !skipIds.has(r.id));

  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const chunk = queue.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((r) => {
      const name = firstName(nameById.get(r.user_id) ?? null);
      return {
        from: FROM,
        to: [r.email!],
        reply_to: REPLY_TO,
        subject: "Weekly check-in: update your stats & PT status",
        html: reminderHtml(name),
        text: reminderText(name),
        tags: [{ name: "kind", value: "weekly_reminder" }, { name: "week", value: week }],
      };
    });
    let ok = false;
    let ids: (string | null)[] = [];
    let errMsg = "";
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.data)) {
        ok = true;
        ids = body.data.map((d: { id?: string }) => d?.id ?? null);
      } else {
        errMsg = body?.message || body?.error || `Resend HTTP ${res.status}`;
      }
    } catch (e) {
      errMsg = (e as Error).message || "network error";
    }
    if (ok) {
      // Per-row update so the Resend id lands on the right row.
      await Promise.all(chunk.map((r, idx) => service.from("weekly_reminders")
        .update({ email_status: "sent", sent_at: now, resend_id: ids[idx] || null, email_error: null }).eq("id", r.id)));
      tally.sent += chunk.length;
    } else {
      await service.from("weekly_reminders").update({ email_status: "failed", email_error: errMsg.slice(0, 500) }).in("id", chunk.map((r) => r.id));
      tally.failed += chunk.length;
    }
    if (i + BATCH_SIZE < queue.length) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
  }

  return json(req, { ok: true, via, week_start: week, audience: audience.length, pending: pending.length, ...tally });
});
