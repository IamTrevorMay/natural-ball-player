// Public booking availability (#229). NO auth — deploy with verify_jwt=false.
// Returns bookable occurrences (facility resources + coach sessions) that staff
// have marked public and priced, minus anything already booked/reserved.
//
// Uses the service_role client so it can read across tables and compute
// remaining capacity without exposing any table to the anon role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import {
  addMinutes,
  facilityEventOccurrences,
  fmtLocalDate,
  trainingSlotOccurrences,
} from "../_shared/availability.ts";

const ACTIVE_BOOKING_STATES = ["pending_payment", "confirmed"];

function jsonRes(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Postgres `time` comes back as HH:MM:SS — trim to HH:MM for display/compare.
const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);

  try {
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Range: today .. today + N days (default 45).
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = fmtLocalDate(today);
    const days = Math.min(Math.max(Number(body?.days) || 45, 1), 120);
    const rangeEnd = new Date(today);
    rangeEnd.setDate(rangeEnd.getDate() + days);
    rangeEnd.setHours(23, 59, 59, 999);
    const rangeEndStr = fmtLocalDate(rangeEnd);

    // --- Fetch published inventory + supporting rows in parallel -------------
    const [feRes, tsRes, bookingRes] = await Promise.all([
      service
        .from("facility_events")
        .select("id, title, event_date, start_time, end_time, location, lanes, color, booking_type, is_recurring, recurrence_rule, recurrence_parent_id, is_exception, original_date, is_public, public_price_cents, public_capacity")
        .or("is_public.eq.true,recurrence_parent_id.not.is.null"),
      service
        .from("training_slots")
        .select("id, coach_id, slot_date, start_time, duration_minutes, repeat_weekly, repeat_end_date, max_players, notes, is_public, public_price_cents")
        .eq("is_public", true),
      service
        .from("public_bookings")
        .select("source_type, source_id, occurrence_date")
        .in("status", ACTIVE_BOOKING_STATES)
        .gte("occurrence_date", todayStr),
    ]);

    if (feRes.error) throw feRes.error;
    if (tsRes.error) throw tsRes.error;
    if (bookingRes.error) throw bookingRes.error;

    const allFacility = feRes.data || [];
    const publicMasters = allFacility.filter((e) => e.is_public && !e.is_exception);
    // Tombstoned occurrences of recurring public events (deleted single dates).
    const tombstones = new Set<string>();
    for (const e of allFacility) {
      if (e.is_exception && e.recurrence_parent_id) {
        tombstones.add(`${e.recurrence_parent_id}_${e.original_date || e.event_date}`);
      }
    }

    // Booked counts by "source_type:source_id:date".
    const bookedCount = new Map<string, number>();
    for (const b of bookingRes.data || []) {
      const k = `${b.source_type}:${b.source_id}:${b.occurrence_date}`;
      bookedCount.set(k, (bookedCount.get(k) || 0) + 1);
    }

    // Internal reservations also consume coach-session capacity.
    const slotIds = (tsRes.data || []).map((s) => s.id);
    const reservedCount = new Map<string, number>();
    if (slotIds.length) {
      const { data: resv } = await service
        .from("slot_reservations")
        .select("slot_id, slot_date, status")
        .in("slot_id", slotIds)
        .neq("status", "cancelled")
        .gte("slot_date", todayStr);
      for (const r of resv || []) {
        const k = `${r.slot_id}:${r.slot_date}`;
        reservedCount.set(k, (reservedCount.get(k) || 0) + 1);
      }
    }

    // Coach names for sessions.
    const coachIds = [...new Set((tsRes.data || []).map((s) => s.coach_id).filter(Boolean))];
    const coachNames = new Map<string, string>();
    if (coachIds.length) {
      const { data: coaches } = await service
        .from("users")
        .select("id, full_name")
        .in("id", coachIds);
      for (const c of coaches || []) coachNames.set(c.id, c.full_name);
    }

    const out: Array<Record<string, unknown>> = [];

    // --- Facility resources -------------------------------------------------
    for (const ev of publicMasters) {
      if (ev.public_price_cents == null) continue;
      const capacity = ev.public_capacity ?? 1;
      const dates = facilityEventOccurrences(ev, today, rangeEnd);
      for (const date of dates) {
        if (date < todayStr || date > rangeEndStr) continue;
        if (tombstones.has(`${ev.id}_${date}`)) continue;
        const booked = bookedCount.get(`facility_event:${ev.id}:${date}`) || 0;
        const remaining = capacity - booked;
        if (remaining <= 0) continue;
        out.push({
          key: `facility_event:${ev.id}:${date}`,
          kind: "resource",
          source_type: "facility_event",
          source_id: ev.id,
          occurrence_date: date,
          title: ev.title,
          booking_type: ev.booking_type || null,
          color: ev.color || "teal",
          start_time: hm(ev.start_time),
          end_time: hm(ev.end_time),
          location: ev.location || null,
          lanes: Array.isArray(ev.lanes) ? ev.lanes : null,
          price_cents: ev.public_price_cents,
          remaining,
        });
      }
    }

    // --- Coach sessions -----------------------------------------------------
    for (const slot of tsRes.data || []) {
      if (slot.public_price_cents == null) continue;
      const capacity = slot.max_players ?? 1;
      const dates = trainingSlotOccurrences(slot, today, rangeEnd);
      for (const date of dates) {
        if (date < todayStr || date > rangeEndStr) continue;
        const booked = bookedCount.get(`training_slot:${slot.id}:${date}`) || 0;
        const reserved = reservedCount.get(`${slot.id}:${date}`) || 0;
        const remaining = capacity - booked - reserved;
        if (remaining <= 0) continue;
        const start = hm(slot.start_time);
        out.push({
          key: `training_slot:${slot.id}:${date}`,
          kind: "coach_session",
          source_type: "training_slot",
          source_id: slot.id,
          occurrence_date: date,
          title: slot.notes || "Training session",
          color: "teal",
          coach_name: coachNames.get(slot.coach_id) || "Coach",
          start_time: start,
          end_time: start ? addMinutes(start, slot.duration_minutes) : "",
          duration_minutes: slot.duration_minutes,
          price_cents: slot.public_price_cents,
          remaining,
        });
      }
    }

    // Sort by date then start time for a clean public listing.
    out.sort((a, b) => {
      const da = `${a.occurrence_date} ${a.start_time}`;
      const db = `${b.occurrence_date} ${b.start_time}`;
      return da < db ? -1 : da > db ? 1 : 0;
    });

    return jsonRes(cors, 200, { slots: out });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
