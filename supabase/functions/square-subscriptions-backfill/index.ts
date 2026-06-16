// Backfill existing Square subscriptions into store_purchases (#142).
// Admin-only. Idempotent.
//
// For every Square Subscription not already represented by a store_purchases
// row (matched on square_subscription_id), we:
//   - Look up the Square customer to get the email.
//   - Match against users.email (case-insensitive) to resolve user_id.
//   - Resolve product via store_products.square_variation_id = plan_variation_id.
//   - Insert a store_purchases row with status mapped from Square.
//
// Unmatched (no user, no product) subscriptions are reported but not inserted.

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

function mapStatus(sq: string): string {
  const s = (sq || "").toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "PENDING") return "pending";
  if (s === "PAUSED") return "past_due";
  if (s === "CANCELED" || s === "DEACTIVATED") return "canceled";
  return "pending";
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

    const { data: roleRow } = await service
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    if (roleRow?.role !== "admin") return jsonRes(cors, 403, { error: "Admin only" });

    // Paginate all Square subscriptions
    const subs: any[] = [];
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = { limit: 200 };
      if (cursor) body.cursor = cursor;
      const data = await squareFetch("/v2/subscriptions/search", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (Array.isArray(data.subscriptions)) subs.push(...data.subscriptions);
      cursor = data.cursor;
    } while (cursor);

    // Existing rows by square_subscription_id
    const { data: existingRows } = await service
      .from("store_purchases")
      .select("id, square_subscription_id, status")
      .not("square_subscription_id", "is", null);
    const existing = new Map<string, { id: string; status: string }>();
    for (const r of (existingRows || [])) {
      if (r.square_subscription_id) existing.set(r.square_subscription_id, { id: r.id, status: r.status });
    }

    // Preload products by variation id
    const { data: products } = await service
      .from("store_products")
      .select("id, name, price_cents, square_variation_id, kind")
      .eq("recurring", true);
    const productByVariation = new Map<string, any>();
    for (const p of (products || [])) {
      if (p.square_variation_id) productByVariation.set(p.square_variation_id, p);
    }

    // Preload users by lowercased email
    const { data: users } = await service.from("users").select("id, email");
    const userByEmail = new Map<string, string>();
    for (const u of (users || [])) {
      if (u.email) userByEmail.set(u.email.trim().toLowerCase(), u.id);
    }

    // Cache customer lookups
    const customerCache = new Map<string, any>();
    const fetchCustomer = async (customerId: string) => {
      if (customerCache.has(customerId)) return customerCache.get(customerId);
      try {
        const data = await squareFetch(`/v2/customers/${customerId}`);
        customerCache.set(customerId, data.customer);
        return data.customer;
      } catch {
        customerCache.set(customerId, null);
        return null;
      }
    };

    let inserted = 0;
    let updated = 0;
    let unmatchedUser = 0;
    let unmatchedProduct = 0;
    const unmatched: any[] = [];

    for (const sub of subs) {
      const subId = sub.id;
      const planVarId = sub.plan_variation_id;
      const status = mapStatus(sub.status);

      const product = productByVariation.get(planVarId);
      if (!product) {
        unmatchedProduct++;
        unmatched.push({ subscription_id: subId, reason: "no product", plan_variation_id: planVarId });
        continue;
      }

      const customer = await fetchCustomer(sub.customer_id);
      const email = customer?.email_address?.trim()?.toLowerCase() || null;
      const userId = email ? userByEmail.get(email) : null;
      if (!userId) {
        unmatchedUser++;
        unmatched.push({ subscription_id: subId, reason: "no user", email });
        continue;
      }

      const existingRow = existing.get(subId);
      if (existingRow) {
        // Only patch status to stay in sync
        if (existingRow.status !== status) {
          await service.from("store_purchases").update({ status }).eq("id", existingRow.id);
          updated++;
        }
        continue;
      }

      const { error: insErr } = await service.from("store_purchases").insert({
        user_id: userId,
        product_id: product.id,
        product_kind: product.kind || "package",
        product_name_snapshot: product.name,
        amount_cents: product.price_cents,
        status,
        square_subscription_id: subId,
        square_customer_id: sub.customer_id,
        metadata: { backfilled: true, plan_variation_id: planVarId },
      });
      if (insErr) {
        unmatched.push({ subscription_id: subId, reason: `insert error: ${insErr.message}` });
      } else {
        inserted++;
      }
    }

    return jsonRes(cors, 200, {
      total_square_subs: subs.length,
      inserted,
      updated,
      unmatched_user: unmatchedUser,
      unmatched_product: unmatchedProduct,
      unmatched_details: unmatched.slice(0, 20),
    });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
