// Trackman FTP sync (#44). Vercel serverless function (Node). Pulls new session
// CSVs from Trackman's FTP, parses the V3 pitch-level format, resolves player
// names -> athletes via trackman_player_map, and upserts sessions + pitches with
// the Supabase service_role key.
//
// Triggered by:
//   - Vercel Cron nightly (sends Authorization: Bearer $CRON_SECRET)
//   - Admin "Sync now" button (sends the admin's Supabase access token)
//
// Env (set in Vercel, never committed):
//   TRACKMAN_FTP_HOST, TRACKMAN_FTP_USER, TRACKMAN_FTP_PASSWORD
//   SUPABASE_URL (or REACT_APP_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
//   CRON_SECRET

const { Writable } = require("stream");
const ftp = require("basic-ftp");
const { parse } = require("csv-parse/sync");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "https://cjilkqzifyhssbsiqgfu.supabase.co";
const MAX_FILES_PER_RUN = 25; // keep each run inside the function time budget; cron catches up

const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const int = (v) => { if (v == null || v === "") return null; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const str = (v) => { if (v == null) return null; const s = String(v).trim(); return s === "" ? null : s; };

function jsonRes(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// Recursively collect every .csv path under practice/ (practice/YYYY/MM/DD/*.csv).
async function listCsvFiles(client, dir, out, depth) {
  const entries = await client.list(dir);
  for (const e of entries) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) {
      if (depth < 4) await listCsvFiles(client, path, out, depth + 1);
    } else if (e.name.toLowerCase().endsWith(".csv")) {
      out.push(path);
    }
  }
}

async function downloadToBuffer(client, path) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } });
  await client.downloadTo(sink, path);
  return Buffer.concat(chunks);
}

function mapRow(r) {
  return {
    pitch_uid: str(r.PitchUID),
    trackman_session_id: str(r.SessionId),
    pitch_no: int(r.PitchNo),
    play_id: str(r.PlayID),
    thrown_date: str(r.Date),
    thrown_time: str(r.Time),
    pitcher_name: str(r.Pitcher),
    pitcher_ext_id: str(r.PitcherId),
    pitcher_throws: str(r.PitcherThrows),
    batter_name: str(r.Batter),
    batter_ext_id: str(r.BatterId),
    batter_side: str(r.BatterSide),
    balls: int(r.Balls),
    strikes: int(r.Strikes),
    tagged_pitch_type: str(r.TaggedPitchType),
    pitch_call: str(r.PitchCall),
    rel_speed: num(r.RelSpeed),
    spin_rate: num(r.SpinRate),
    spin_axis: num(r.SpinAxis),
    tilt: str(r.Tilt),
    rel_height: num(r.RelHeight),
    rel_side: num(r.RelSide),
    extension: num(r.Extension),
    vert_break: num(r.VertBreak),
    induced_vert_break: num(r.InducedVertBreak),
    horz_break: num(r.HorzBreak),
    plate_loc_height: num(r.PlateLocHeight),
    plate_loc_side: num(r.PlateLocSide),
    zone_speed: num(r.ZoneSpeed),
    vert_appr_angle: num(r.VertApprAngle),
    horz_appr_angle: num(r.HorzApprAngle),
    eff_velocity: num(r.EffVelocity),
    hit_type: str(r.HitType),
    exit_speed: num(r.ExitSpeed),
    launch_angle: num(r.Angle),
    hit_direction: num(r.Direction),
    distance: num(r.Distance),
    hang_time: num(r.HangTime),
    bearing: num(r.Bearing),
    hit_spin_rate: num(r.HitSpinRate),
    raw: r,
  };
}

// True if the caller is authorized (cron secret or an admin/coach JWT).
async function authorize(req, service) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false };
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return { ok: true, via: "cron" };
  // Otherwise treat it as a Supabase access token and require staff role.
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

  const auth = await authorize(req, service);
  if (!auth.ok) return jsonRes(res, 401, { error: "Unauthorized" });

  const host = process.env.TRACKMAN_FTP_HOST;
  const user = process.env.TRACKMAN_FTP_USER;
  const password = process.env.TRACKMAN_FTP_PASSWORD;
  if (!host || !user || !password) return jsonRes(res, 500, { error: "Trackman FTP env not configured" });

  const client = new ftp.Client(60000);
  const summary = { files_seen: 0, files_imported: 0, pitches_upserted: 0, skipped_existing: 0, errors: [] };

  try {
    // Prefer explicit FTPS; fall back to plain FTP if TLS negotiation fails.
    try {
      await client.access({ host, user, password, secure: true, secureOptions: { rejectUnauthorized: false } });
    } catch {
      await client.access({ host, user, password, secure: false });
    }

    const files = [];
    await listCsvFiles(client, "practice", files, 0);
    summary.files_seen = files.length;

    // Only import files we haven't seen before.
    const { data: existing } = await service.from("trackman_sessions").select("file_path");
    const known = new Set((existing || []).map((r) => r.file_path));
    const toImport = files.filter((f) => !known.has(f)).sort().slice(0, MAX_FILES_PER_RUN);

    // Load the name -> athlete map once.
    const { data: mapRows } = await service.from("trackman_player_map").select("trackman_name, user_id");
    const nameMap = new Map((mapRows || []).map((m) => [m.trackman_name, m.user_id]));

    for (const path of toImport) {
      try {
        const buf = await downloadToBuffer(client, path);
        const records = parse(buf.toString("utf8"), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
        if (!records.length) { summary.skipped_existing++; continue; }

        const fileName = path.split("/").pop();
        const sessionType = fileName.split("_")[0] || null;
        const first = records[0];

        const { data: sessionRow, error: sErr } = await service
          .from("trackman_sessions")
          .upsert({
            trackman_session_id: str(first.SessionId),
            session_date: str(first.Date),
            session_type: sessionType,
            file_path: path,
            pitch_count: records.length,
          }, { onConflict: "file_path" })
          .select("id")
          .single();
        if (sErr) throw sErr;

        const pitches = records.map((r) => {
          const m = mapRow(r);
          return {
            ...m,
            session_row_id: sessionRow.id,
            pitcher_user_id: m.pitcher_name ? (nameMap.get(m.pitcher_name) || null) : null,
            batter_user_id: m.batter_name ? (nameMap.get(m.batter_name) || null) : null,
          };
        }).filter((p) => p.pitch_uid); // need a dedupe key

        for (let i = 0; i < pitches.length; i += 500) {
          const chunk = pitches.slice(i, i + 500);
          const { error: pErr } = await service
            .from("trackman_pitches")
            .upsert(chunk, { onConflict: "pitch_uid", ignoreDuplicates: true });
          if (pErr) throw pErr;
          summary.pitches_upserted += chunk.length;
        }
        summary.files_imported++;
      } catch (e) {
        summary.errors.push({ path, message: String(e && e.message || e) });
      }
    }

    summary.remaining = Math.max(files.length - known.size - summary.files_imported, 0);
    return jsonRes(res, 200, { ok: true, via: auth.via, ...summary });
  } catch (err) {
    return jsonRes(res, 500, { error: String(err && err.message || err), ...summary });
  } finally {
    client.close();
  }
};

// Give the import room to run (Trackman files can number in the dozens).
module.exports.config = { maxDuration: 60 };
