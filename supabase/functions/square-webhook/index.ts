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

function timingSafeEqual(a: string, b: string): boolean {
  // Length difference is not a secret — return false fast, but still walk a
  // fixed-length comparison on equal-length inputs to avoid leaking the prefix.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

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
  return timingSafeEqual(b64, signatureHeader);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-square-hmacsha256-signature");
  // Require the explicit env var instead of reconstructing from request
  // headers. Header-based reconstruction (x-forwarded-proto, host) can pick a
  // different canonical/alias host than Square used when signing, breaking
  // signature verification on the first event after a config change.
  const notificationUrl = Deno.env.get("SQUARE_WEBHOOK_URL");
  if (!notificationUrl) {
    return new Response("SQUARE_WEBHOOK_URL not configured", { status: 500 });
  }

  const ok = await verifySignature(rawBody, sigHeader, notificationUrl);
  if (!ok) return new Response("Invalid signature", { status: 401 });

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }

  // Square v2 webhook envelope: `event_id` is the canonical idempotency key.
  // Do NOT fall back to `event.id` (doesn't exist at top level — any fallback
  // produced `undefined` and locked into 23505 forever on the first miss).
  const eventId = event.event_id;
  const eventType = event.type;
  if (!eventId || !eventType) return new Response("Missing event fields", { status: 400 });

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Idempotency: if this event was already processed, ack and stop. We record
  // the event only AFTER successful processing (below), so a transient failure
  // is retried by Square rather than being permanently swallowed as a duplicate.
  const { data: alreadyProcessed } = await service
    .from("store_webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (alreadyProcessed) return new Response("ok (duplicate)", { status: 200 });

  const obj = event?.data?.object || {};
  const now = new Date().toISOString();

  try {
    if (eventType === "payment.created" || eventType === "payment.updated") {
      const payment = obj.payment;
      if (payment) {
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

        // Square does not guarantee order_id on every payment (manual / POS
        // ad-hoc payments arrive with order_id null). Match the row by
        // payment_id when order_id is missing so we don't silently no-op.
        let q = orderId
          ? service.from("store_purchases").update(patch).eq("square_order_id", orderId)
          : service.from("store_purchases").update(patch).eq("square_payment_id", paymentId);
        // Out-of-order safety: never overwrite a terminal state with a softer
        // one. If the row is already paid, only allow refunded/failed updates.
        // If paid_at is set, never flip it back to pending.
        if (purchaseStatus === "pending") {
          q = q.is("paid_at", null);
        } else if (purchaseStatus === "failed") {
          q = q.neq("status", "refunded");
        }
        const { data: updated, error } = await q.select("id");
        if (error) throw error;

        // Public facility bookings (#229) live in a separate table, matched by
        // the same Square order_id. Confirm on completion; mark failed/refunded
        // otherwise. A guest payment never matches store_purchases, so update
        // both tables independently rather than branching on `updated`.
        if (orderId) {
          const bookingStatus = purchaseStatus === "paid" ? "confirmed"
            : purchaseStatus === "failed" ? "canceled"
            : null;
          if (bookingStatus) {
            // Only act on a still-pending booking so a late/duplicate event
            // can't revive one a staffer already refunded or canceled.
            const { error: bErr } = await service
              .from("public_bookings")
              .update({ status: bookingStatus, square_payment_id: paymentId })
              .eq("square_order_id", orderId)
              .eq("status", "pending_payment");
            if (bErr) throw bErr;
          }
        }

        // A COMPLETED payment that matched no purchase row (webhook landed before
        // checkout inserted the pending row, or an ad-hoc POS payment) needs
        // reconciliation. The full event payload is persisted below, so
        // square-backfill-resolve can pick it up; surface it in logs meanwhile.
        if (purchaseStatus === "paid" && (!updated || updated.length === 0)) {
          console.warn(`square-webhook: COMPLETED payment ${paymentId} (order ${orderId}) matched no purchase row — checking public_bookings / needs reconciliation`);
        }
      }
    } else if (
      eventType === "subscription.created"
      || eventType === "subscription.updated"
    ) {
      const sub = obj.subscription;
      if (sub) {
        const subId = sub.id;
        const squareStatus = (sub.status || "").toUpperCase();
        const purchaseStatus = squareStatus === "ACTIVE" ? "active"
          : squareStatus === "CANCELED" ? "canceled"
          : squareStatus === "DEACTIVATED" ? "canceled"
          : squareStatus === "PAUSED" ? "past_due"
          : "pending";

        // Once a subscription is canceled, do not allow webhook to revive it
        // back to pending — Square may retry events out of order on cancel/reactivate.
        let q = service.from("store_purchases").update({ status: purchaseStatus }).eq("square_subscription_id", subId);
        if (purchaseStatus === "pending") {
          q = q.in("status", ["pending"]);
        }
        const { error } = await q;
        if (error) throw error;
      }
    } else if (eventType === "invoice.payment_made") {
      const invoice = obj.invoice;
      const subId = invoice?.subscription_id;
      if (subId) {
        const { error } = await service
          .from("store_purchases")
          .update({ status: "active", paid_at: now })
          .eq("square_subscription_id", subId);
        if (error) throw error;
      }
    }
  } catch (err) {
    // Do NOT record idempotency — return non-200 so Square retries and we
    // reprocess rather than losing the event forever.
    return new Response(`Handler error: ${(err as Error).message}`, { status: 500 });
  }

  // Processing succeeded — record the event so future retries are deduped.
  const { error: recErr } = await service
    .from("store_webhook_events")
    .insert({ event_id: eventId, event_type: eventType, payload: event });
  if (recErr && recErr.code !== "23505") {
    // Idempotency bookkeeping failed but the purchase update already succeeded;
    // ack anyway (a duplicate delivery would re-run idempotent updates).
    console.error("square-webhook: failed to record idempotency:", recErr.message);
  }

  return new Response("ok", { status: 200 });
});
