// Issue #415 — an athlete's NBP schedule as an iCalendar feed.
//
// Google Calendar ("From URL"), Apple Calendar (webcal://) and Outlook all
// subscribe to a plain .ics URL and re-fetch it on their own cadence (Google:
// every 8–24h, Apple: user-chosen). Nothing here is pushed; the calendar app
// pulls.
//
// Deploy with --no-verify-jwt (pinned in supabase/config.toml): the caller is
// Google's crawler or a phone, never a logged-in browser. Authentication is
// the token in the URL — an unguessable uuid from calendar_feed_tokens, looked
// up with the service role. GET only, read only, no side effects.
//
// WHAT'S IN THE FEED — the same things My Schedule shows a player:
//   1. schedule_events assigned to the athlete directly (workouts, games)
//   2. schedule_events for any team they're on (team rows only — not the
//      per-athlete copies team programming makes for OTHER athletes)
//   3. facility_events they're the athlete on, tagged in athlete_ids, on
//      a team assigned to, or signed up for — recurrences expanded with
//      tombstones hidden and modified occurrences substituted
//   4. slot_reservations that are confirmed (or pending, marked as such).
//      A reservation is one DATE, so it is emitted once at its slot_date.
//   Meal plans are left out on purpose.
//
// Times are facility wall-clock with no zone in the DB, so they're written
// with a TZID rather than converted. FACILITY_TIMEZONE is the same env the
// public-booking functions read (_shared/availability.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOccurrenceDates, fmtLocalDate, addMinutes } from "../_shared/availability.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = Deno.env.get("FACILITY_TIMEZONE") || "America/Los_Angeles";
const DAYS_BACK = 30;
const DAYS_AHEAD = 365;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
};

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

// ---- iCalendar formatting -------------------------------------------------

function icsEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space.
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + b > limit) { out.push(cur); cur = ""; curBytes = 0; }
    cur += ch; curBytes += b;
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

const dateOnly = (d: string) => d.replace(/-/g, "");
const dateTime = (d: string, t: string) => `${dateOnly(d)}T${t.slice(0, 5).replace(":", "")}00`;

function nextDay(d: string): string {
  const x = new Date(d + "T12:00:00");
  x.setDate(x.getDate() + 1);
  return fmtLocalDate(x);
}

type FeedEvent = {
  uid: string;
  date: string;              // YYYY-MM-DD
  start?: string | null;     // HH:MM[:SS]
  end?: string | null;       // HH:MM[:SS]
  title: string;
  description?: string;
  location?: string;
  status?: "TENTATIVE" | "CONFIRMED";
};

function vevent(ev: FeedEvent, stamp: string): string {
  const lines = ["BEGIN:VEVENT", `UID:${ev.uid}`, `DTSTAMP:${stamp}`];
  if (ev.start) {
    lines.push(`DTSTART;TZID=${TZ}:${dateTime(ev.date, ev.start)}`);
    const end = ev.end && ev.end > ev.start ? ev.end : addMinutes(ev.start.slice(0, 5), 60);
    lines.push(`DTEND;TZID=${TZ}:${dateTime(ev.date, end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(ev.date)}`);
    lines.push(`DTEND;VALUE=DATE:${dateOnly(nextDay(ev.date))}`);
  }
  lines.push(`SUMMARY:${icsEscape(ev.title)}`);
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.status) lines.push(`STATUS:${ev.status}`);
  lines.push("END:VEVENT");
  return lines.map(fold).join("\r\n");
}

// Standard US Pacific rules. Only emitted when TZ is America/Los_Angeles;
// other zones rely on the client resolving the Olson TZID (Google, Apple and
// Outlook all do).
const VTIMEZONE_LA = [
  "BEGIN:VTIMEZONE", "TZID:America/Los_Angeles",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700", "TZNAME:PDT",
  "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0800", "TZNAME:PST",
  "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

// ---- feed assembly ----------------------------------------------------------

const parseRule = (r: unknown) => (typeof r === "string" ? JSON.parse(r) : r) || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "HEAD") return text(405, "method not allowed");

  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!UUID_RE.test(token)) return text(400, "invalid token");

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: tok, error: tokErr } = await db
      .from("calendar_feed_tokens").select("user_id").eq("token", token).maybeSingle();
    if (tokErr) { console.error("calendar-feed: token lookup failed:", tokErr.message); return text(500, "lookup failed"); }
    if (!tok) return text(404, "unknown token");
    const uid = tok.user_id as string;

    const { data: me } = await db.from("users").select("full_name").eq("id", uid).maybeSingle();

    const today = new Date();
    const rangeStart = new Date(today); rangeStart.setDate(rangeStart.getDate() - DAYS_BACK); rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(today); rangeEnd.setDate(rangeEnd.getDate() + DAYS_AHEAD); rangeEnd.setHours(23, 59, 59, 0);
    const startStr = fmtLocalDate(rangeStart);
    const endStr = fmtLocalDate(rangeEnd);

    const { data: myTeams } = await db.from("team_members").select("team_id, teams(name)").eq("user_id", uid);
    const teamIds: string[] = (myTeams || []).map((t: any) => t.team_id);
    const teamName = new Map<string, string>((myTeams || []).map((t: any) => [t.team_id, t.teams?.name || ""]));

    const events: FeedEvent[] = [];

    // 1 + 2: schedule_events (materialised per date — no expansion needed)
    const [direct, team] = await Promise.all([
      db.from("schedule_events").select("*").eq("player_id", uid).gte("event_date", startStr).lte("event_date", endStr),
      teamIds.length
        ? db.from("schedule_events").select("*").overlaps("team_ids", teamIds).is("player_id", null).gte("event_date", startStr).lte("event_date", endStr)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (direct.error) console.error("calendar-feed: direct schedule_events failed:", direct.error.message);
    if (team.error) console.error("calendar-feed: team schedule_events failed:", team.error.message);
    const seen = new Set<string>();
    for (const e of [...(direct.data || []), ...(team.data || [])]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const type = String(e.event_type || "event");
      let title = e.title || "";
      if (!title) {
        if (type === "game") title = e.opponent ? `Game vs ${e.opponent}` : "Game";
        else title = type.charAt(0).toUpperCase() + type.slice(1);
      }
      const bits: string[] = [];
      if (e.home_away) bits.push(e.home_away);
      if (e.is_optional) bits.push("Optional");
      const tn = (e.team_ids || []).map((id: string) => teamName.get(id)).filter(Boolean).join(", ");
      if (tn) bits.push(tn);
      if (e.notes) bits.push(e.notes);
      events.push({
        uid: `schedule-${e.id}@thenatural-app.com`,
        date: e.event_date, start: e.event_time, end: e.event_end_time,
        title, description: bits.join("\n") || undefined,
        location: [e.location, e.address].filter(Boolean).join(", ") || undefined,
        status: "CONFIRMED",
      });
    }

    // 3: facility events — mine, tagged, my teams', or signed up for
    const mineFilter = [`athlete_id.eq.${uid}`, `athlete_ids.cs.{${uid}}`];
    if (teamIds.length) mineFilter.push(`team_ids.ov.{${teamIds.join(",")}}`);
    const orFilter = mineFilter.join(",");
    const [single, masters, signups] = await Promise.all([
      db.from("facility_events").select("*").or(orFilter).eq("is_recurring", false).is("recurrence_parent_id", null)
        .gte("event_date", startStr).lte("event_date", endStr),
      db.from("facility_events").select("*").or(orFilter).eq("is_recurring", true).is("recurrence_parent_id", null),
      db.from("event_signups").select("event_id, event_date").eq("user_id", uid).gte("event_date", startStr).lte("event_date", endStr),
    ]);
    if (single.error) console.error("calendar-feed: facility single failed:", single.error.message);
    if (masters.error) console.error("calendar-feed: facility masters failed:", masters.error.message);

    const masterRows: any[] = masters.data || [];
    const signupRows: any[] = signups.data || [];
    const signupMasterIds = signupRows.map((s) => s.event_id).filter((id) => !masterRows.some((m) => m.id === id));
    if (signupMasterIds.length) {
      const { data: extra } = await db.from("facility_events").select("*").in("id", signupMasterIds).is("recurrence_parent_id", null);
      for (const m of extra || []) masterRows.push(m);
    }
    const allMasterIds = masterRows.map((m) => m.id);
    let exceptions: any[] = [];
    if (allMasterIds.length) {
      const { data: ex } = await db.from("facility_events").select("*").in("recurrence_parent_id", allMasterIds)
        .gte("event_date", startStr).lte("event_date", endStr);
      exceptions = ex || [];
    }
    const exMap = new Map<string, any>();
    for (const ex of exceptions) exMap.set(`${ex.recurrence_parent_id}_${ex.original_date || ex.event_date}`, ex);
    const signupDates = new Set(signupRows.map((s) => `${s.event_id}_${s.event_date}`));

    const facilityOut = new Map<string, any>(); // key: masterId_date
    for (const s of single.data || []) facilityOut.set(`${s.id}_${s.event_date}`, s);
    for (const m of masterRows) {
      const rule = parseRule(m.recurrence_rule);
      const isMineOrTeam = m.athlete_id === uid || (m.athlete_ids || []).includes(uid) || (m.team_ids || []).some((t: string) => teamIds.includes(t));
      if (m.is_recurring && rule) {
        for (const d of generateOccurrenceDates(m.event_date, rule, rangeStart, rangeEnd)) {
          const ds = fmtLocalDate(d);
          if (!isMineOrTeam && !signupDates.has(`${m.id}_${ds}`)) continue;
          const ex = exMap.get(`${m.id}_${ds}`);
          if (ex) { if (!ex.is_exception) facilityOut.set(`${m.id}_${ds}`, { ...ex, _uid_key: `${m.id}_${ds}` }); continue; }
          facilityOut.set(`${m.id}_${ds}`, { ...m, event_date: ds, _uid_key: `${m.id}_${ds}` });
        }
      } else if (!isMineOrTeam && signupDates.has(`${m.id}_${m.event_date}`) && m.event_date >= startStr && m.event_date <= endStr) {
        facilityOut.set(`${m.id}_${m.event_date}`, m);
      }
    }
    for (const [key, f] of facilityOut) {
      const bits: string[] = [];
      const tn = (f.team_ids || []).map((id: string) => teamName.get(id)).filter(Boolean).join(", ");
      if (tn) bits.push(tn);
      if (f.description) bits.push(f.description);
      events.push({
        uid: `facility-${f._uid_key || key}@thenatural-app.com`,
        date: f.event_date, start: f.start_time, end: f.end_time,
        title: f.title || "Facility Event",
        description: bits.join("\n") || undefined,
        location: f.location || undefined,
        status: "CONFIRMED",
      });
    }

    // 4: training-session reservations, one per booked date
    const { data: res, error: resErr } = await db.from("slot_reservations")
      .select("id, slot_date, status, player_note, training_slots(id, start_time, duration_minutes, notes, coach_id)")
      .eq("player_id", uid).in("status", ["confirmed", "pending"]).gte("slot_date", startStr).lte("slot_date", endStr);
    if (resErr) console.error("calendar-feed: reservations failed:", resErr.message);
    const coachIds = [...new Set((res || []).map((r: any) => r.training_slots?.coach_id).filter(Boolean))];
    const coachName = new Map<string, string>();
    if (coachIds.length) {
      const { data: coaches } = await db.from("users").select("id, full_name").in("id", coachIds);
      for (const c of coaches || []) coachName.set(c.id, c.full_name || "");
    }
    for (const r of res || []) {
      const s = r.training_slots;
      if (!s) continue;
      const coach = coachName.get(s.coach_id);
      const pending = r.status === "pending";
      const base = s.notes || "Training Session";
      const bits: string[] = [];
      if (coach) bits.push(`Coach: ${coach}`);
      if (pending) bits.push("Awaiting coach confirmation.");
      if (r.player_note) bits.push(r.player_note);
      events.push({
        uid: `reservation-${r.id}@thenatural-app.com`,
        date: r.slot_date, start: s.start_time,
        end: s.start_time ? addMinutes(String(s.start_time).slice(0, 5), s.duration_minutes || 60) : null,
        title: pending ? `${base} (pending)` : base,
        description: bits.join("\n") || undefined,
        status: pending ? "TENTATIVE" : "CONFIRMED",
      });
    }

    // ---- render ----
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const calName = `NBP – ${me?.full_name || "My Schedule"}`;
    const head = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Natural Ball Player//NBP Portal//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${icsEscape(calName)}`, `X-WR-TIMEZONE:${TZ}`,
      "REFRESH-INTERVAL;VALUE=DURATION:PT4H", "X-PUBLISHED-TTL:PT4H",
    ].map(fold);
    const body = [
      ...head,
      ...(TZ === "America/Los_Angeles" ? [VTIMEZONE_LA] : []),
      ...events.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || ""))).map((e) => vevent(e, stamp)),
      "END:VCALENDAR",
    ].join("\r\n") + "\r\n";

    return new Response(req.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="nbp-schedule.ics"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("calendar-feed: unhandled:", err);
    return text(500, "feed failed");
  }
});
