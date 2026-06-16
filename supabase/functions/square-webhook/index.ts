// Square webhook receiver (#142).
// Verifies HMAC-SHA256 signature with SQUARE_WEBHOOK_SIG_KEY, dedupes by
// event_id, and updates store_purchases rows.
//
// Events handled:
//   payment.created / payment.updated   -> mark one-time purchase paid/failed
//   subscription.created / .updated     -> activate / past_due / canceled
//   invoice.payment_made                -> first-cycle confirmation for subs

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const encoder = new TextEncoder();

async function verifySignature(
  body: string,
  signatureHeader: string | null,
  notificationUrl: string,
): Promise<boolean> {
  const key = Deno.env.get("SQUARE_WEBHOOK_SIG_KEY");
  if (!key || !signatureHeader) return false;
  const keyData = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", keyData, encoder.encode(notificationUrl + body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === signatureHeader;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-square-hmacsha256-signature");
  const notificationUrl = Deno.env.get("SQUARE_WEBHOOK_URL")
    || `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}${new URL(req.url).pathname}`;

  const ok = await verifySignature(rawBody, sigHeader, notificationUrl);
  if (!ok) return new Response("Invalid signature", { status: 401 });

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const eventId = event.event_id || event.id;
  const eventType = event.type;
  if (!eventId || !eventType) return new Response("Missing event fields", { status: 400 });

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Idempotency: insert into store_webhook_events; on conflict bail out 200.
  const { error: dupErr } = await service
    .from("store_webhook_events")
    .insert({ event_id: eventId, event_type: eventType, payload: event });
  if (dupErr) {
    if (dupErr.code === "23505") return new Response("ok (duplicate)", { status: 200 });
    return new Response(`DB error: ${dupErr.message}`, { status: 500 });
  }

  const obj = event?.data?.object || {};
  const now = new Date().toISOString();

  try {
    if (eventType === "payment.created" || eventType === "payment.updated") {
      const payment = obj.payment;
      if (!payment) return new Response("ok", { status: 200 });
      const orderId = payment.order_id;
      const paymentId = payment.id;
      const squareStatus = (payment.status || "").toUpperCase();
      const purchaseStatus = squareStatus === "COMPLETED" ? "paid"
        : squareStatus === "FAILED" || squareStatus === "CANCELED" ? "failed"
        : "pending";

      const patch: Record<string, unknown> = {
        status: purchaseStatus,
        square_payment_id: paymentId,
      };
      if (purchaseStatus === "paid") patch.paid_at = now;

      await service
        .from("store_purchases")
        .update(patch)
        .eq("square_order_id", orderId);
    } else if (
      eventType === "subscription.created"
      || eventType === "subscription.updated"
    ) {
      const sub = obj.subscription;
      if (!sub) return new Response("ok", { status: 200 });
      const subId = sub.id;
      const squareStatus = (sub.status || "").toUpperCase();
      const purchaseStatus = squareStatus === "ACTIVE" ? "active"
        : squareStatus === "CANCELED" ? "canceled"
        : squareStatus === "DEACTIVATED" ? "canceled"
        : squareStatus === "PAUSED" ? "past_due"
        : "pending";

      await service
        .from("store_purchases")
        .update({ status: purchaseStatus })
        .eq("square_subscription_id", subId);
    } else if (eventType === "invoice.payment_made") {
      const invoice = obj.invoice;
      if (!invoice) return new Response("ok", { status: 200 });
      const subId = invoice.subscription_id;
      if (subId) {
        await service
          .from("store_purchases")
          .update({ status: "active", paid_at: now })
          .eq("square_subscription_id", subId);
      }
    }
  } catch (err) {
    return new Response(`Handler error: ${(err as Error).message}`, { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
