// #443: WHOOP coaching nudges.
//
// Pure rules over the rows the sync just wrote. `evaluateNudges` is called
// by the `whoop` edge function after every sync — the athlete opening their
// WHOOP tab, or the 2-hourly cron (api/whoop-sync.js → ?action=cron) — and
// upserts one whoop_nudges row per (athlete, rule, WHOOP record) with
// ignoreDuplicates, so a rule fires once per workout / sleep / day no matter
// how many syncs look at it. Only the last LOOKBACK_DAYS are considered, so
// the first run after deploy does not replay a year of history.
//
// Every threshold is a named constant up top so Cordell can tune them
// without reading the rules.
//
// NOT buildable from the WHOOP API (and therefore not here): the "top 10% of
// steps" nudge — WHOOP exposes no step count — and anything that needs live
// heart rate. The pre-game rule works off a RECORDED workout that ends
// shortly before a scheduled game; it cannot see an athlete pacing in the
// dugout with no activity logged.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const LOOKBACK_DAYS = 3;

// Lifting = these WHOOP sport ids, or a sport name that reads like one. HIIT
// and CrossFit are deliberately NOT lifts: a 20-minute conditioning block in
// zone 3 is doing its job, and the "push harder on your main lifts" rule
// would misread it. Athletes need to tag their lifts as Weightlifting or
// Functional Fitness in WHOOP for these two rules to see them — a generic
// "Activity" is invisible to them on purpose.
const LIFT_SPORT_IDS = new Set([56 /* Weightlifting */, 71 /* Functional Fitness */]);
const LIFT_NAME_RE = /lift|weight|strength|functional/i;
const LIFT_MIN_MINUTES = 20;          // ignore a 5-minute accidental activity
const LIFT_HIGH_ZONE_MIN_SHARE = 0.15; // < 15% of the lift in zones 4–5 → "not straining enough"
const LIFT_MAX_MINUTES = 75;          // Cordell: 60–75 min max

const ZONE5_LONG_MINUTES = 10;        // > 10 min in zone 5 → warning

const PREGAME_WINDOW_HOURS = 4;       // workout ending within 4h before first pitch
const PREGAME_HIGH_ZONE_MINUTES = 10; // ≥ 10 min in zones 4–5 in that window
const GAME_TITLE_RE = /\b(game|scrimmage|lives?|live at[- ]bats?)\b/i;

const SLEEP_MIN_HOURS = 7;            // asleep (in-bed minus awake) under 7h
const SLEEP_AWAKE_MAX_MINUTES = 45;   // or more than 45 min awake in bed
const SLEEP_EFFICIENCY_MIN = 85;      // or efficiency under 85%

const STRAIN_HIGH = 14;               // WHOOP day strain ≥ 14 → eat in surplus
const STRAIN_LOW = 8;                 // ≤ 8 → low-output day
const SURPLUS_MIN_KCAL = 300;
const SURPLUS_MAX_KCAL = 600;
const KCAL_PER_KJ = 1 / 4.184;

export type Nudge = {
  athlete_id: string;
  kind: string;
  source_key: string;
  severity: "info" | "warning";
  title: string;
  body: string;
  occurred_on: string | null;
};

type Workout = {
  whoop_workout_id: string; workout_date: string; sport_id: number | null; sport_name: string | null;
  start_at: string | null; end_at: string | null; duration_ms: number | null;
  zone_four_ms: number | null; zone_five_ms: number | null;
};
type Sleep = {
  whoop_sleep_id: string; sleep_date: string; total_duration_ms: number | null; awake_duration_ms: number | null;
  sleep_efficiency: number | null;
};
type Cycle = { whoop_cycle_id: string; cycle_date: string; strain_score: number | null; kilojoule: number | null };
type Game = { label: string; startAt: Date };

const mins = (ms: number | null | undefined) => Math.round((ms || 0) / 60_000);
const hm = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const prettyDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const prettyTime = (d: Date, tz: string) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });

// Today's YYYY-MM-DD in the facility timezone.
export function facilityToday(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// "2026-10-09" + "18:30:00" in `tz` → the UTC instant. Two-pass offset fix
// handles DST; good to the minute, which is all a 4-hour window needs.
function zonedToUtc(ymd: string, hms: string, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hms.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi || 0);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return new Date(utc);
}

const isLift = (w: Workout) =>
  (w.sport_id != null && LIFT_SPORT_IDS.has(w.sport_id)) || LIFT_NAME_RE.test(w.sport_name || "");

// ---- rules ----------------------------------------------------------------

function workoutRules(athleteId: string, workouts: Workout[], games: Game[], tz: string): Nudge[] {
  const out: Nudge[] = [];
  for (const w of workouts) {
    const dur = w.duration_ms || 0;
    const high = (w.zone_four_ms || 0) + (w.zone_five_ms || 0);
    const hasZones = w.zone_four_ms != null || w.zone_five_ms != null;
    const label = `${w.sport_name || "Workout"} on ${prettyDate(w.workout_date)}`;
    const base = { athlete_id: athleteId, source_key: w.whoop_workout_id, occurred_on: w.workout_date };

    if (isLift(w) && dur >= LIFT_MIN_MINUTES * 60_000) {
      if (hasZones && high / dur < LIFT_HIGH_ZONE_MIN_SHARE) {
        out.push({
          ...base, kind: "lift_low_strain", severity: "info",
          title: "Push harder on your main lifts",
          body: `${label}: only ${mins(high)} of ${mins(dur)} min reached zone 4–5. Your main lift sets should get you there — add load or cut the rest between sets.`,
        });
      }
      if (dur > LIFT_MAX_MINUTES * 60_000) {
        out.push({
          ...base, kind: "lift_too_long", severity: "info",
          title: "Keep lifts to 60–75 minutes",
          body: `${label} ran ${hm(dur)}. Longer than 75 min usually means too much rest, not more work. Tighten the session.`,
        });
      }
    }

    if ((w.zone_five_ms || 0) > ZONE5_LONG_MINUTES * 60_000) {
      out.push({
        ...base, kind: "zone5_long", severity: "warning",
        title: "Too long in zone 5",
        body: `${label}: ${mins(w.zone_five_ms)} min with your heart rate maxed out. More than ${ZONE5_LONG_MINUTES} min in zone 5 is not productive and can be dangerous. Bring the intensity down sooner.`,
      });
    }

    if (w.end_at && high >= PREGAME_HIGH_ZONE_MINUTES * 60_000) {
      const end = new Date(w.end_at).getTime();
      const start = w.start_at ? new Date(w.start_at).getTime() : end - dur;
      for (const g of games) {
        const gs = g.startAt.getTime();
        // Ends before first pitch, within the window, and is not the game itself.
        if (end <= gs && gs - end <= PREGAME_WINDOW_HOURS * 3_600_000 && !(start < gs && end > gs)) {
          out.push({
            ...base, kind: "pregame_strain", severity: "warning",
            title: "Save it for the game",
            body: `You spent ${mins(high)} min in zone 4–5 in the ${PREGAME_WINDOW_HOURS} hours before ${g.label} (${prettyTime(g.startAt, tz)}). Getting worked up before you play burns the energy you need on the field. Keep pre-game work light.`,
          });
          break;
        }
      }
    }
  }
  return out;
}

function sleepRules(athleteId: string, sleeps: Sleep[]): Nudge[] {
  const out: Nudge[] = [];
  for (const s of sleeps) {
    const inBed = s.total_duration_ms || 0;
    if (!inBed) continue;
    const awake = s.awake_duration_ms || 0;
    const asleep = Math.max(0, inBed - awake);
    const base = { athlete_id: athleteId, source_key: s.whoop_sleep_id, occurred_on: s.sleep_date };
    if (asleep < SLEEP_MIN_HOURS * 3_600_000) {
      out.push({
        ...base, kind: "sleep_short", severity: "info",
        title: "Not enough sleep",
        body: `You slept ${hm(asleep)} on ${prettyDate(s.sleep_date)}. Under ${SLEEP_MIN_HOURS} hours and recovery falls off — get to bed earlier tonight.`,
      });
    }
    const disrupted = awake > SLEEP_AWAKE_MAX_MINUTES * 60_000 || (s.sleep_efficiency != null && s.sleep_efficiency < SLEEP_EFFICIENCY_MIN);
    if (disrupted) {
      const eff = s.sleep_efficiency != null ? `${Math.round(s.sleep_efficiency)}% efficient` : null;
      out.push({
        ...base, kind: "sleep_disrupted", severity: "info",
        title: "Restless night",
        body: `${prettyDate(s.sleep_date)}: ${hm(awake)} awake in bed${eff ? ` (${eff})` : ""}. Cut screens and caffeine late, keep the room cool and dark, and keep a consistent bedtime.`,
      });
    }
  }
  return out;
}

function fuelRules(athleteId: string, cycles: Cycle[]): Nudge[] {
  const out: Nudge[] = [];
  for (const c of cycles) {
    if (c.strain_score == null) continue;
    const kcal = c.kilojoule != null ? Math.round(c.kilojoule * KCAL_PER_KJ) : null;
    const base = { athlete_id: athleteId, source_key: c.whoop_cycle_id, occurred_on: c.cycle_date };
    if (c.strain_score >= STRAIN_HIGH && kcal) {
      const lo = Math.round((kcal + SURPLUS_MIN_KCAL) / 50) * 50;
      const hi = Math.round((kcal + SURPLUS_MAX_KCAL) / 50) * 50;
      out.push({
        ...base, kind: "fuel_surplus", severity: "info",
        title: "Big day — eat to match it",
        body: `${prettyDate(c.cycle_date)} was a ${c.strain_score.toFixed(1)} strain day and you burned about ${kcal.toLocaleString()} kcal. To stay in a surplus and recover, aim for ${lo.toLocaleString()}–${hi.toLocaleString()} kcal, protein first.`,
      });
    } else if (c.strain_score <= STRAIN_LOW) {
      out.push({
        ...base, kind: "low_strain", severity: "info",
        title: "Low-output day",
        body: `${prettyDate(c.cycle_date)} came in at ${c.strain_score.toFixed(1)} strain${kcal ? ` (about ${kcal.toLocaleString()} kcal burned)` : ""}. If you are cutting, this is where the deficit comes from — keep intake honest. If you are building, you need more work in the day.`,
      });
    }
  }
  return out;
}

// ---- data + orchestration ---------------------------------------------------

async function loadGames(admin: SupabaseClient, athleteId: string, tz: string, fromYmd: string, toYmd: string): Promise<Game[]> {
  const { data: tm } = await admin.from("team_members").select("team_id").eq("user_id", athleteId);
  const teamIds = (tm || []).map((r: any) => r.team_id);
  const games: Game[] = [];

  const { data: se } = await admin
    .from("schedule_events")
    .select("title, opponent, event_date, event_time, player_id, team_id, team_ids")
    .eq("event_type", "game")
    .gte("event_date", fromYmd)
    .lte("event_date", toYmd);
  for (const e of se || []) {
    const mine = e.player_id === athleteId
      || (teamIds.length > 0 && (teamIds.includes(e.team_id) || (e.team_ids || []).some((t: string) => teamIds.includes(t))));
    if (!mine || !e.event_time) continue;
    games.push({ label: e.opponent ? `your game vs ${e.opponent}` : (e.title || "your game"), startAt: zonedToUtc(e.event_date, e.event_time, tz) });
  }

  // Facility calendar: games / scrimmages / lives the athlete (or their team)
  // is on. Recurring masters are expanded nowhere here — a weekly "lives"
  // block is rare and its occurrences carry their own date only via the
  // availability helper; keep this to concrete rows.
  const { data: fe } = await admin
    .from("facility_events")
    .select("title, event_date, start_time, athlete_id, athlete_ids, team_ids, is_exception")
    .gte("event_date", fromYmd)
    .lte("event_date", toYmd);
  for (const e of fe || []) {
    if (e.is_exception || !e.start_time || !GAME_TITLE_RE.test(e.title || "")) continue;
    const mine = e.athlete_id === athleteId
      || (e.athlete_ids || []).includes(athleteId)
      || (teamIds.length > 0 && (e.team_ids || []).some((t: string) => teamIds.includes(t)));
    if (!mine) continue;
    games.push({ label: e.title, startAt: zonedToUtc(e.event_date, e.start_time, tz) });
  }
  return games;
}

export async function evaluateNudges(
  admin: SupabaseClient,
  athleteId: string,
  tz: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ candidates: number; inserted: number; kinds: Record<string, number> }> {
  const today = facilityToday(tz);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const sinceYmd = isoDate(since);
  const tomorrow = isoDate(new Date(Date.now() + 86_400_000));

  const [wRes, sRes, cRes, games] = await Promise.all([
    admin.from("whoop_workouts")
      .select("whoop_workout_id, workout_date, sport_id, sport_name, start_at, end_at, duration_ms, zone_four_ms, zone_five_ms")
      .eq("athlete_id", athleteId).gte("workout_date", sinceYmd),
    admin.from("whoop_sleep")
      .select("whoop_sleep_id, sleep_date, total_duration_ms, awake_duration_ms, sleep_efficiency")
      .eq("athlete_id", athleteId).gte("sleep_date", sinceYmd),
    // Completed days only: today's cycle is still accumulating strain.
    admin.from("whoop_cycles")
      .select("whoop_cycle_id, cycle_date, strain_score, kilojoule")
      .eq("athlete_id", athleteId).gte("cycle_date", sinceYmd).lt("cycle_date", today),
    loadGames(admin, athleteId, tz, sinceYmd, tomorrow),
  ]);

  const nudges = [
    ...workoutRules(athleteId, (wRes.data || []) as Workout[], games, tz),
    ...sleepRules(athleteId, (sRes.data || []) as Sleep[]),
    ...fuelRules(athleteId, (cRes.data || []) as Cycle[]),
  ];
  const kinds: Record<string, number> = {};
  for (const n of nudges) kinds[n.kind] = (kinds[n.kind] || 0) + 1;

  if (opts.dryRun || nudges.length === 0) return { candidates: nudges.length, inserted: 0, kinds };

  const { data, error } = await admin
    .from("whoop_nudges")
    .upsert(nudges, { onConflict: "athlete_id,kind,source_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`whoop_nudges upsert failed: ${error.message}`);
  return { candidates: nudges.length, inserted: (data || []).length, kinds };
}
