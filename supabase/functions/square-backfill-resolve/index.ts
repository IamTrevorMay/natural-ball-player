// Resolve a single unmatched subscription from a saved backfill run by
// assigning it to a portal user (#142). Admin-only.
//
// POST { run_id, subscription_id, user_id }
//   - Looks up Square subscription
//   - Looks up the linked store_products row (auto-creates if missing, same
//     path as the backfill function)
//   - Inserts a store_purchases row tied to the given user_id
//   - Marks that entry as resolved (resolved=true, resolved_user_id=user_id)
//     in store_backfill_runs.unmatched JSONB array

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

    const { run_id, subscription_id, user_id } = await req.json().catch(() => ({}));
    if (!run_id || !subscription_id || !user_id) {
      return jsonRes(cors, 400, { error: "run_id, subscription_id, user_id required" });
    }

    // Verify target user exists
    const { data: targetUser } = await service
      .from("users")
      .select("id, full_name")
      .eq("id", user_id)
      .single();
    if (!targetUser) return jsonRes(cors, 404, { error: "Target user not found" });

    // Fetch the Square subscription
    const subData = await squareFetch(`/v2/subscriptions/${subscription_id}`);
    const sub = subData?.subscription;
    if (!sub) return jsonRes(cors, 404, { error: "Square subscription not found" });

    // Resolve/auto-create the product (same logic as backfill)
    const planVarId = sub.plan_variation_id || null;
    const planId = sub.plan_id || null;
    let product: any = null;
    if (planVarId) {
      const { data } = await service
        .from("store_products")
        .select("id, name, price_cents, kind")
        .eq("square_variation_id", planVarId)
        .maybeSingle();
      if (data) product = data;
    }
    if (!product && planId) {
      const { data } = await service
        .from("store_products")
        .select("id, name, price_cents, kind")
        .eq("square_plan_id", planId)
        .maybeSingle();
      if (data) product = data;
    }
    if (!product) {
      // Try fetching from Square catalog directly
      const tryId = planVarId || planId;
      const catData = await squareFetch(`/v2/catalog/object/${tryId}`).catch(() => null);
      const obj = catData?.object;
      if (obj) {
        const isVar = obj.type === "SUBSCRIPTION_PLAN_VARIATION";
        const pd = isVar ? obj.subscription_plan_variation_data : obj.subscription_plan_data;
        const phase = pd?.phases?.[0];
        const priceCents = phase?.pricing?.price_money?.amount
          ?? phase?.pricing?.price?.amount
          ?? phase?.recurring_price_money?.amount
          ?? 0;
        const { data: created } = await service
          .from("store_products")
          .insert({
            kind: "package",
            name: pd?.name || "Subscription",
            price_cents: priceCents,
            recurring: true,
            square_catalog_id: isVar ? (pd?.subscription_plan_id || null) : obj.id,
            square_plan_id: isVar ? (pd?.subscription_plan_id || null) : obj.id,
            square_variation_id: isVar ? obj.id : null,
            active: true,
            sort_order: 100,
          })
          .select("id, name, price_cents, kind")
          .single();
        product = created;
      }
    }
    if (!product) return jsonRes(cors, 404, { error: "Could not resolve product for this subscription" });

    // Has store_purchases row already?
    const { data: existing } = await service
      .from("store_purchases")
      .select("id, metadata")
      .eq("square_subscription_id", subscription_id)
      .maybeSingle();

    const status = mapStatus(sub.status);

    if (existing) {
      // M2: preserve prior metadata when re-resolving — losing it on the
      // update path wiped the original checkout's idempotency_key and any
      // prior backfill audit trail.
      const priorMetadata = (existing.metadata && typeof existing.metadata === "object")
        ? existing.metadata as Record<string, unknown>
        : {};
      await service.from("store_purchases")
        .update({
          user_id,
          product_id: product.id,
          product_kind: product.kind,
          product_name_snapshot: product.name,
          amount_cents: product.price_cents,
          status,
          square_customer_id: sub.customer_id,
          metadata: {
            ...priorMetadata,
            resolved_from_backfill: true,
            last_resolve: { at: new Date().toISOString(), run_id, plan_variation_id: planVarId, plan_id: planId },
          },
        })
        .eq("id", existing.id);
    } else {
      const { error: insErr } = await service.from("store_purchases").insert({
        user_id,
        product_id: product.id,
        product_kind: product.kind || "package",
        product_name_snapshot: product.name,
        amount_cents: product.price_cents,
        status,
        square_subscription_id: subscription_id,
        square_customer_id: sub.customer_id,
        metadata: { resolved_from_backfill: true, run_id, plan_variation_id: planVarId, plan_id: planId },
      });
      if (insErr) return jsonRes(cors, 500, { error: insErr.message });
    }

    // Mark this entry resolved in the saved run log
    const { data: run } = await service
      .from("store_backfill_runs")
      .select("unmatched")
      .eq("id", run_id)
      .single();
    if (run) {
      const updatedUnmatched = (run.unmatched || []).map((u: any) =>
        u.subscription_id === subscription_id
          ? { ...u, resolved: true, resolved_user_id: user_id, resolved_at: new Date().toISOString() }
          : u
      );
      await service
        .from("store_backfill_runs")
        .update({ unmatched: updatedUnmatched })
        .eq("id", run_id);
    }

    return jsonRes(cors, 200, { ok: true, status });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
