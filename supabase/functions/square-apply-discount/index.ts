// Square apply / remove discount on a player's active subscription (#142).
// Admin-only.
//
// POST { user_id, discount_id }   -> applies override pricing to active sub
// POST { user_id, discount_id: null } -> clears override (restores base price)
//
// Discount math:
//   - percentage: new_price = round(base * (100 - pct) / 100)
//   - amount_cents: new_price = max(0, base - amount)
// Calls Square `PUT /v2/subscriptions/{id}` with `price_override_money`.

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

    const { user_id, discount_id } = await req.json().catch(() => ({}));
    if (!user_id) return jsonRes(cors, 400, { error: "user_id required" });

    // Find the player's active (or past_due) subscription row
    const { data: purchase, error: pErr } = await service
      .from("store_purchases")
      .select("id, amount_cents, square_subscription_id")
      .eq("user_id", user_id)
      .eq("product_kind", "package")
      .in("status", ["active", "past_due", "pending"])
      .not("square_subscription_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pErr) return jsonRes(cors, 500, { error: pErr.message });
    if (!purchase) return jsonRes(cors, 404, { error: "No active subscription for this player" });

    let priceOverrideMoney: { amount: number; currency: string } | null = null;
    let discountRow: { id: string; percentage: number | null; amount_cents: number | null } | null = null;
    let newPriceCents: number | null = null;

    if (discount_id) {
      const { data: d, error: dErr } = await service
        .from("store_discounts")
        .select("id, percentage, amount_cents")
        .eq("id", discount_id)
        .single();
      if (dErr || !d) return jsonRes(cors, 404, { error: "Discount not found" });
      discountRow = d;
      const base = purchase.amount_cents;
      if (d.percentage != null) {
        newPriceCents = Math.max(0, Math.round(base * (100 - Number(d.percentage)) / 100));
      } else if (d.amount_cents != null) {
        newPriceCents = Math.max(0, base - d.amount_cents);
      } else {
        return jsonRes(cors, 400, { error: "Discount has no percentage or amount" });
      }
      priceOverrideMoney = { amount: newPriceCents, currency: "USD" };
    }

    // Atomic-ish flow: capture current DB state so we can revert if Square
    // rejects, then update DB FIRST so that on a Square failure the user-visible
    // state stays consistent (no charge applied at Square, no record in DB).
    // If DB succeeds but Square fails, we revert the DB row back to the
    // previously-captured state.
    const { data: priorRow } = await service
      .from("store_purchases")
      .select("applied_discount_id, discounted_price_cents, metadata")
      .eq("id", purchase.id)
      .single();

    const { error: uErr } = await service
      .from("store_purchases")
      .update({
        applied_discount_id: discount_id || null,
        discounted_price_cents: newPriceCents,
      })
      .eq("id", purchase.id);
    if (uErr) return jsonRes(cors, 500, { error: uErr.message });

    // Square `UpdateSubscription` (PUT). On failure, revert the DB so it
    // mirrors Square truth instead of silently drifting.
    const body: Record<string, unknown> = {
      subscription: discount_id
        ? { price_override_money: priceOverrideMoney }
        : { price_override_money: null },
    };
    try {
      await squareFetch(`/v2/subscriptions/${purchase.square_subscription_id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    } catch (squareErr) {
      // Revert DB
      await service
        .from("store_purchases")
        .update({
          applied_discount_id: priorRow?.applied_discount_id ?? null,
          discounted_price_cents: priorRow?.discounted_price_cents ?? null,
        })
        .eq("id", purchase.id);
      return jsonRes(cors, 502, { error: `Square rejected the change: ${(squareErr as Error).message}. DB reverted.` });
    }

    // M1: merge into prior metadata so we don't blow away the idempotency_key,
    // payment_link_id, and other keys checkout stored on this row.
    const priorMetadata = (priorRow?.metadata && typeof priorRow.metadata === "object")
      ? priorRow.metadata as Record<string, unknown>
      : {};
    await service
      .from("store_purchases")
      .update({
        metadata: {
          ...priorMetadata,
          last_discount_change: {
            at: new Date().toISOString(),
            by: user.id,
            discount_id: discount_id || null,
            prior_discount_id: priorRow?.applied_discount_id || null,
            new_price_cents: newPriceCents,
          },
        },
      })
      .eq("id", purchase.id);

    return jsonRes(cors, 200, {
      ok: true,
      purchase_id: purchase.id,
      discount_id: discount_id || null,
      discounted_price_cents: newPriceCents,
    });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
