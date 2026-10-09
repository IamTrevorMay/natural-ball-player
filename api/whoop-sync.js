// #443: WHOOP sync + coaching nudges for every connected athlete.
//
// Vercel Cron hits this every 2 hours (vercel.json) with
// `Authorization: Bearer $CRON_SECRET`. It does no work itself: it calls the
// `whoop` Supabase edge function's `cron` action with the service-role key,
// because that function owns the WHOOP tokens, their encryption key and the
// nudge rules (supabase/functions/whoop/nudges.ts). Until this existed, WHOOP
// data only refreshed when the athlete opened their WHOOP tab, so a nudge
// about yesterday's lift could not reach them until they went looking.
//
// Also callable by hand with a staff Supabase JWT — same as trackman-sync —
// and passes `?dry_run=1` / `?user_id=` / `?limit=` straight through:
//   curl -X POST "https://nbp-portal.vercel.app/api/whoop-sync?dry_run=1&limit=3" \
//     -H "Authorization: Bearer <staff access token>"
//
// Env (Vercel): SUPABASE_URL (or REACT_APP_SUPABASE_URL),
// SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "https://cjilkqzifyhssbsiqgfu.supabase.co";

function jsonRes(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// True if the caller is authorized (cron secret or an admin/coach JWT).
async function authorize(req, service) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false };
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return { ok: true, via: "cron" };
  const { data: { user } = {}, error } = await service.auth.getUser(token);
  if (error || !user) return { ok: false };
  const { data: row } = await service.from("users").select("role").eq("id", user.id).single();
  if (row && (row.role === "admin" || row.role === "coach")) return { ok: true, via: "manual", userId: user.id };
  return { ok: false };
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") return jsonRes(res, 405, { error: "Method not allowed" });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return jsonRes(res, 500, { error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
  const service = createClient(SUPABASE_URL, serviceKey);

  const authz = await authorize(req, service);
  if (!authz.ok) return jsonRes(res, 401, { error: "Unauthorized" });

  const qs = new URLSearchParams({ action: "cron" });
  const q = req.query || {};
  if (q.dry_run) qs.set("dry_run", String(q.dry_run));
  if (q.user_id) qs.set("user_id", String(q.user_id));
  if (q.limit) qs.set("limit", String(q.limit));
  const url = `${SUPABASE_URL}/functions/v1/whoop?${qs}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ via: authz.via, triggered_by: authz.userId || null }),
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    // The per-athlete detail is useful by hand but noisy for the cron log.
    if (authz.via === "cron" && body && Array.isArray(body.results)) body.results = body.results.filter((x) => x.error);
    return jsonRes(res, r.ok ? 200 : 502, { via: authz.via, upstream_status: r.status, ...body });
  } catch (e) {
    return jsonRes(res, 502, { error: `whoop edge function unreachable: ${e.message}` });
  }
};

// 59 connected athletes × 4 WHOOP calls each, 4 at a time: comfortably under
// a minute today, but give it room — a Vercel timeout here would not stop the
// edge function, it would just hide its result.
module.exports.config = { maxDuration: 300 };
