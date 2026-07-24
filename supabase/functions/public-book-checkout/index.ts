// Public booking checkout (#229). NO auth — deploy with verify_jwt=false.
// A guest picks a published occurrence; this validates it's still bookable,
// inserts a pending public_bookings row, and returns a Square payment link.
// The square-webhook flips the row to `confirmed` when payment completes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight, isAllowedOrigin } from "../_shared/cors.ts";
import {
  addMinutes,
  facilityEventOccurrences,
  fmtLocalDate,
  trainingSlotOccurrences,
} from "../_shared/availability.ts";

const SQUARE_ENV = Deno.env.get("SQUARE_ENV") || "production";
const SQUARE_BASE = SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";
const SQUARE_VERSION = "2024-11-20";
const ACTIVE_BOOKING_STATES = ["pending_payment", "confirmed"];

function jsonRes(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function squareFetch(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN not configured");
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.errors?.[0]?.detail || `Square ${path} failed (${res.status})`);
  }
  return data;
}

const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);

  try {
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const {
      source_type,
      source_id,
      occurrence_date,
      guest_name,
      guest_email,
      guest_phone,
      notes,
      return_url,
    } = await req.json().catch(() => ({}));

    if (source_type !== "facility_event" && source_type !== "training_slot") {
      return jsonRes(cors, 400, { error: "Invalid source_type" });
    }
    if (!source_id || !occurrence_date) {
      return jsonRes(cors, 400, { error: "source_id and occurrence_date required" });
    }
    if (!guest_name?.trim()) return jsonRes(cors, 400, { error: "Name is required" });
    if (!guest_email || !emailOk(guest_email)) {
      return jsonRes(cors, 400, { error: "A valid email is required" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = fmtLocalDate(today);
    if (occurrence_date < todayStr) {
      return jsonRes(cors, 400, { error: "That time is in the past" });
    }
    // Wide range for occurrence validation (booker may look far ahead).
    const rangeEnd = new Date(today);
    rangeEnd.setDate(rangeEnd.getDate() + 400);

    // --- Load the source and confirm it's published + priced + occurs -------
    let title = "";
    let startTime = "";
    let endTime = "";
    let priceCents = 0;
    let capacity = 1;

    if (source_type === "facility_event") {
      const { data: ev, error } = await service
        .from("facility_events")
        .select("id, title, event_date, start_time, end_time, is_recurring, recurrence_rule, is_public, public_price_cents, public_capacity")
        .eq("id", source_id)
        .single();
      if (error || !ev) return jsonRes(cors, 404, { error: "That listing was not found" });
      if (!ev.is_public || ev.public_price_cents == null) {
        return jsonRes(cors, 400, { error: "That listing is not available for public booking" });
      }
      const dates = facilityEventOccurrences(ev, today, rangeEnd);
      if (!dates.includes(occurrence_date)) {
        return jsonRes(cors, 400, { error: "That date is not an available occurrence" });
      }
      title = ev.title;
      startTime = hm(ev.start_time);
      endTime = hm(ev.end_time);
      priceCents = ev.public_price_cents;
      capacity = ev.public_capacity ?? 1;
    } else {
      const { data: slot, error } = await service
        .from("training_slots")
        .select("id, coach_id, slot_date, start_time, duration_minutes, repeat_weekly, repeat_end_date, max_players, notes, is_public, public_price_cents")
        .eq("id", source_id)
        .single();
      if (error || !slot) return jsonRes(cors, 404, { error: "That session was not found" });
      if (!slot.is_public || slot.public_price_cents == null) {
        return jsonRes(cors, 400, { error: "That session is not available for public booking" });
      }
      const dates = trainingSlotOccurrences(slot, today, rangeEnd);
      if (!dates.includes(occurrence_date)) {
        return jsonRes(cors, 400, { error: "That date is not an available occurrence" });
      }
      const start = hm(slot.start_time);
      title = slot.notes || "Training session";
      startTime = start;
      endTime = start ? addMinutes(start, slot.duration_minutes) : "";
      priceCents = slot.public_price_cents;
      capacity = slot.max_players ?? 1;
    }

    // --- Capacity re-check (best-effort; webhook + staff cancel are backstops)
    const { data: existing } = await service
      .from("public_bookings")
      .select("id")
      .eq("source_type", source_type)
      .eq("source_id", source_id)
      .eq("occurrence_date", occurrence_date)
      .in("status", ACTIVE_BOOKING_STATES);
    let booked = (existing || []).length;
    if (source_type === "training_slot") {
      const { data: resv } = await service
        .from("slot_reservations")
        .select("id")
        .eq("slot_id", source_id)
        .eq("slot_date", occurrence_date)
        .neq("status", "cancelled");
      booked += (resv || []).length;
    }
    if (booked >= capacity) {
      return jsonRes(cors, 409, { error: "Sorry — that time was just booked. Please pick another." });
    }

    const locationId = Deno.env.get("SQUARE_LOCATION_ID");
    if (!locationId) return jsonRes(cors, 500, { error: "SQUARE_LOCATION_ID not configured" });

    // --- Create the pending booking first so we can link the redirect -------
    const { data: booking, error: insErr } = await service
      .from("public_bookings")
      .insert({
        source_type,
        source_id,
        occurrence_date,
        start_time: startTime || null,
        end_time: endTime || null,
        guest_name: guest_name.trim(),
        guest_email: guest_email.trim(),
        guest_phone: guest_phone?.trim() || null,
        notes: notes?.trim() || null,
        amount_cents: priceCents,
        // #249: free ($0) sessions confirm instantly — no Square payment step.
        status: priceCents === 0 ? "confirmed" : "pending_payment",
      })
      .select("id")
      .single();
    if (insErr || !booking) return jsonRes(cors, 500, { error: insErr?.message || "Could not create booking" });

    // Free session: skip the Square payment link entirely, booking is already confirmed.
    if (priceCents === 0) {
      return jsonRes(cors, 200, { free: true, booking_id: booking.id });
    }

    // Redirect target: honor a client return_url only if it's a trusted origin.
    let appOrigin = req.headers.get("Origin") || "https://nbp-portal.vercel.app";
    if (return_url) {
      try {
        if (isAllowedOrigin(new URL(return_url).origin)) appOrigin = new URL(return_url).origin;
      } catch { /* keep default */ }
    }
    const redirectUrl = `${appOrigin}/book?booking=${booking.id}`;

    try {
      const idempotencyKey = crypto.randomUUID();
      const link = await squareFetch("/v2/online-checkout/payment-links", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          quick_pay: {
            name: `${title} — ${occurrence_date}${startTime ? " " + startTime : ""}`,
            price_money: { amount: priceCents, currency: "USD" },
            location_id: locationId,
          },
          checkout_options: { redirect_url: redirectUrl, ask_for_shipping_address: false },
          pre_populated_data: { buyer_email: guest_email.trim() },
          payment_note: `NBP public booking ${booking.id} — ${guest_name.trim()}`,
        }),
      });

      const orderId = link?.payment_link?.order_id || null;
      const checkoutUrl = link?.payment_link?.url;
      if (!checkoutUrl) throw new Error("Square did not return a checkout URL");

      await service
        .from("public_bookings")
        .update({ square_order_id: orderId })
        .eq("id", booking.id);

      return jsonRes(cors, 200, { checkout_url: checkoutUrl, booking_id: booking.id });
    } catch (sqErr) {
      // Roll back the pending hold so it doesn't consume capacity forever.
      await service.from("public_bookings").delete().eq("id", booking.id);
      return jsonRes(cors, 502, { error: (sqErr as Error).message });
    }
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
