// Square checkout edge function (#142).
// Input:  { product_id: uuid, return_url?: string }
// Output: { checkout_url: string, purchase_id: uuid }
//
// Flow:
//   1. Verify caller JWT, look up store_product.
//   2. For one-time products (lesson / bundle / rental) -> Square Checkout
//      API: create Payment Link with order line item.
//   3. For recurring packages -> Square Subscriptions API: ensure Customer +
//      create Subscription with a generated card-collection invoice.
//   4. Insert a `pending` row in store_purchases referencing the Square IDs
//      so the webhook can promote it to `paid` / `active`.

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
    const msg = data?.errors?.[0]?.detail || `Square ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function uuid() {
  return crypto.randomUUID();
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

    const { product_id, return_url, target_user_id } = await req.json().catch(() => ({}));
    if (!product_id) return jsonRes(cors, 400, { error: "product_id required" });

    // Staff can create a purchase on behalf of a player (#213). Otherwise the
    // buyer is always the authenticated caller.
    let buyerId = user.id;
    if (target_user_id && target_user_id !== user.id) {
      const { data: caller } = await service
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!caller || (caller.role !== "admin" && caller.role !== "coach")) {
        return jsonRes(cors, 403, { error: "Only staff can assign a purchase to another user" });
      }
      buyerId = target_user_id;
    }

    const { data: product, error: prodErr } = await service
      .from("store_products")
      .select("*")
      .eq("id", product_id)
      .eq("active", true)
      .single();
    if (prodErr || !product) return jsonRes(cors, 404, { error: "Product not found" });

    const { data: userRow } = await service
      .from("users")
      .select("id, email, full_name")
      .eq("id", buyerId)
      .single();
    if (!userRow) return jsonRes(cors, 404, { error: "User row missing" });

    const locationId = Deno.env.get("SQUARE_LOCATION_ID");
    if (!locationId) return jsonRes(cors, 500, { error: "SQUARE_LOCATION_ID not configured" });

    const redirectUrl = return_url || `${req.headers.get("Origin") || "https://nbp-portal.vercel.app"}/store/return`;

    // One-time products: Payment Link via Checkout API. Branch on `kind` so a
    // misconfigured row with kind='package' AND recurring=false (admin saved
    // without filling square_variation_id yet) still gets routed to the
    // subscription path and returns a clear error instead of silently charging
    // a one-time fee.
    if (product.kind !== "package") {
      const idempotencyKey = uuid();
      const payload = {
        idempotency_key: idempotencyKey,
        quick_pay: {
          name: product.name,
          price_money: { amount: product.price_cents, currency: "USD" },
          location_id: locationId,
        },
        checkout_options: {
          redirect_url: redirectUrl,
          ask_for_shipping_address: false,
          merchant_support_email: undefined,
        },
        pre_populated_data: {
          buyer_email: userRow.email,
        },
        payment_note: `NBP ${product.kind}: ${product.name} for ${userRow.full_name}`,
      };
      const link = await squareFetch("/v2/online-checkout/payment-links", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const orderId = link?.payment_link?.order_id || null;
      const checkoutUrl = link?.payment_link?.url;
      if (!checkoutUrl) return jsonRes(cors, 502, { error: "Square did not return a checkout URL" });

      const { data: purchase, error: insErr } = await service
        .from("store_purchases")
        .insert({
          user_id: buyerId,
          product_id: product.id,
          product_kind: product.kind,
          product_name_snapshot: product.name,
          amount_cents: product.price_cents,
          status: "pending",
          square_order_id: orderId,
          remaining_qty: product.kind === "bundle" ? product.bundle_qty : null,
          checkout_url: checkoutUrl,
          metadata: { idempotency_key: idempotencyKey, payment_link_id: link?.payment_link?.id },
        })
        .select("id")
        .single();
      if (insErr) return jsonRes(cors, 500, { error: insErr.message });

      return jsonRes(cors, 200, { checkout_url: checkoutUrl, purchase_id: purchase.id });
    }

    // Recurring package: requires square_plan_id on the product (admin sets up
    // the catalog Subscription Plan in Square first, then pastes plan ID here).
    if (!product.square_plan_id || !product.square_variation_id) {
      return jsonRes(cors, 400, {
        error: "Subscription product missing square_plan_id / square_variation_id. Create the Subscription Plan in Square Dashboard and store the IDs on store_products.",
      });
    }

    // Find or create Square customer
    let squareCustomerId: string | null = null;
    const search = await squareFetch("/v2/customers/search", {
      method: "POST",
      body: JSON.stringify({
        query: { filter: { email_address: { exact: userRow.email } } },
        limit: 1,
      }),
    });
    squareCustomerId = search?.customers?.[0]?.id || null;
    if (!squareCustomerId) {
      const created = await squareFetch("/v2/customers", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: uuid(),
          given_name: userRow.full_name?.split(" ")[0] || userRow.full_name,
          family_name: userRow.full_name?.split(" ").slice(1).join(" ") || "",
          email_address: userRow.email,
          reference_id: buyerId,
        }),
      });
      squareCustomerId = created?.customer?.id || null;
    }
    if (!squareCustomerId) return jsonRes(cors, 502, { error: "Could not resolve Square customer" });

    // Square subscriptions need a card-on-file. Easiest path: send an
    // electronic invoice for the first cycle which collects the card and
    // enrolls auto-pay. The Subscription is created with `charge_through_date`
    // disabled; webhook flips status to active when the first invoice is paid.
    const sub = await squareFetch("/v2/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: uuid(),
        location_id: locationId,
        plan_variation_id: product.square_variation_id,
        customer_id: squareCustomerId,
        timezone: "America/Chicago",
        source: { name: "NBP Portal" },
      }),
    });

    const subscriptionId = sub?.subscription?.id;
    if (!subscriptionId) return jsonRes(cors, 502, { error: "Square subscription create failed" });

    // For first-cycle card collection we point the user at Square's hosted
    // invoice URL (Square auto-generates one for new subscriptions).
    const subInvoiceUrl = sub?.subscription?.invoice_ids?.[0]
      ? `${SQUARE_BASE.replace("connect.", "")}/invoice/${sub.subscription.invoice_ids[0]}`
      : redirectUrl;

    const { data: purchase, error: insErr } = await service
      .from("store_purchases")
      .insert({
        user_id: buyerId,
        product_id: product.id,
        product_kind: product.kind,
        product_name_snapshot: product.name,
        amount_cents: product.price_cents,
        status: "pending",
        square_subscription_id: subscriptionId,
        square_customer_id: squareCustomerId,
        checkout_url: subInvoiceUrl,
        metadata: { plan_variation_id: product.square_variation_id },
      })
      .select("id")
      .single();
    if (insErr) return jsonRes(cors, 500, { error: insErr.message });

    return jsonRes(cors, 200, { checkout_url: subInvoiceUrl, purchase_id: purchase.id });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
