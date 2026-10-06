// #438: weekly stats / PT check-in reminder for NBP+ athletes.
//
// Vercel Cron hits this Monday mornings (vercel.json: 15:00 UTC = 8am PDT /
// 7am PST) with `Authorization: Bearer $CRON_SECRET`. It does no work itself:
// it calls the `weekly-reminders` Supabase edge function with the service-role
// key, because that function already has RESEND_API_KEY and the shared email
// conventions (sender, blacklist, batching) live next to send-campaign there.
// Vercel has no Resend key and shouldn't need one.
//
// Also callable by hand with a staff Supabase JWT — same as trackman-sync —
// and passes `?dry_run=1` / `?user_id=` straight through for testing:
//   curl -X POST https://nbp-portal.vercel.app/api/weekly-reminders?dry_run=1 \
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

  const qs = new URLSearchParams();
  const q = req.query || {};
  if (q.dry_run) qs.set("dry_run", String(q.dry_run));
  if (q.user_id) qs.set("user_id", String(q.user_id));
  if (q.limit) qs.set("limit", String(q.limit));
  const url = `${SUPABASE_URL}/functions/v1/weekly-reminders${qs.toString() ? `?${qs}` : ""}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ via: authz.via, triggered_by: authz.userId || null }),
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return jsonRes(res, r.ok ? 200 : 502, { via: authz.via, upstream_status: r.status, ...body });
  } catch (e) {
    return jsonRes(res, 502, { error: `weekly-reminders edge function unreachable: ${e.message}` });
  }
};

module.exports.config = { maxDuration: 60 };
