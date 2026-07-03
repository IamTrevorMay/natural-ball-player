// Cancel + refund a public booking (#229). Staff-authenticated (keep
// verify_jwt=true). Refunds the Square payment and marks the booking refunded
// (or just canceled if it was never paid), freeing the slot's capacity.
//
// Input:  { booking_id: uuid, reason?: string }
// Output: { status: 'refunded' | 'canceled' }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const SQUARE_ENV = Deno.env.get("SQUARE_ENV") || "production";
const SQUARE_BASE = SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";
const SQUARE_VERSION = "2024-11-20";

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

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes(cors, 401, { error: "Missing authorization" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonRes(cors, 401, { error: "Invalid token" });

    const service = createClient(supabaseUrl, serviceKey);

    // Only staff may refund.
    const { data: caller } = await service
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!caller || (caller.role !== "admin" && caller.role !== "coach")) {
      return jsonRes(cors, 403, { error: "Only staff can refund a booking" });
    }

    const { booking_id, reason } = await req.json().catch(() => ({}));
    if (!booking_id) return jsonRes(cors, 400, { error: "booking_id required" });

    const { data: booking, error: bErr } = await service
      .from("public_bookings")
      .select("id, status, amount_cents, square_payment_id")
      .eq("id", booking_id)
      .single();
    if (bErr || !booking) return jsonRes(cors, 404, { error: "Booking not found" });

    if (booking.status === "refunded" || booking.status === "canceled") {
      return jsonRes(cors, 200, { status: booking.status });
    }

    // Never paid (still pending) -> just cancel; nothing to refund.
    if (booking.status !== "confirmed" || !booking.square_payment_id) {
      const { error } = await service
        .from("public_bookings")
        .update({ status: "canceled" })
        .eq("id", booking_id);
      if (error) throw error;
      return jsonRes(cors, 200, { status: "canceled" });
    }

    // Refund via Square, then mark refunded.
    const refund = await squareFetch("/v2/refunds", {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        payment_id: booking.square_payment_id,
        amount_money: { amount: booking.amount_cents, currency: "USD" },
        reason: reason || "Booking canceled by staff",
      }),
    });
    const refundId = refund?.refund?.id || null;

    const { error } = await service
      .from("public_bookings")
      .update({ status: "refunded", square_refund_id: refundId })
      .eq("id", booking_id);
    if (error) throw error;

    return jsonRes(cors, 200, { status: "refunded" });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
