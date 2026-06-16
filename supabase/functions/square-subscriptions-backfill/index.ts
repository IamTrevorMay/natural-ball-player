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

    // Preload products by variation id AND plan id (older subs reference plan_id only)
    const { data: products } = await service
      .from("store_products")
      .select("id, name, price_cents, square_variation_id, square_plan_id, kind")
      .eq("recurring", true);
    const productByVariation = new Map<string, any>();
    const productByPlan = new Map<string, any>();
    for (const p of (products || [])) {
      if (p.square_variation_id) productByVariation.set(p.square_variation_id, p);
      if (p.square_plan_id) productByPlan.set(p.square_plan_id, p);
    }

    // Preload users by lowercased email. Only players need lookup — coaches
    // and admins never hold Square subscriptions.
    const { data: users } = await service
      .from("users")
      .select("id, email")
      .eq("role", "player");
    const userByEmail = new Map<string, string>();
    for (const u of (users || [])) {
      if (u.email) userByEmail.set(u.email.trim().toLowerCase(), u.id);
    }

    // Pre-fetch every Square customer referenced by a subscription in parallel
    // (bounded concurrency). Previously this happened serially inside the main
    // loop, turning every backfill into one Square round-trip per sub.
    const customerCache = new Map<string, any>();
    const uniqueCustomerIds = Array.from(new Set(subs.map((s: any) => s.customer_id).filter(Boolean)));
    const CUSTOMER_CONCURRENCY = 10;
    let cIdx = 0;
    const customerWorkers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(CUSTOMER_CONCURRENCY, uniqueCustomerIds.length); w++) {
      customerWorkers.push((async () => {
        while (true) {
          const idx = cIdx++;
          if (idx >= uniqueCustomerIds.length) return;
          const cid = uniqueCustomerIds[idx];
          try {
            const data = await squareFetch(`/v2/customers/${cid}`);
            customerCache.set(cid, data.customer);
          } catch {
            customerCache.set(cid, null);
          }
        }
      })());
    }
    await Promise.all(customerWorkers);

    const fetchCustomer = async (customerId: string) => {
      if (customerCache.has(customerId)) return customerCache.get(customerId);
      // Cache miss is rare after the pre-fetch; fall back to a direct lookup.
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
    let productsAutoCreated = 0;
    let unmatchedUser = 0;
    let unmatchedProduct = 0;
    const unmatched: any[] = [];

    // Auto-create missing recurring products by fetching the catalog object
    // directly from Square. Handles plan_variation_id (newer) and plan_id (older).
    const ensureProduct = async (planVarId: string | null, planId: string | null) => {
      if (planVarId) {
        const cached = productByVariation.get(planVarId);
        if (cached) return { product: cached, diag: null as string | null };
      }
      if (planId) {
        const cached = productByPlan.get(planId);
        if (cached) return { product: cached, diag: null as string | null };
      }
      const tryFetch = async (id: string): Promise<{ obj: any; err: string | null }> => {
        try {
          const data = await squareFetch(`/v2/catalog/object/${id}?include_related_objects=true`);
          if (data?.object) return { obj: data.object, err: null };
          return { obj: null, err: `no object in response (keys: ${Object.keys(data || {}).join(",")})` };
        } catch (err) {
          return { obj: null, err: (err as Error).message };
        }
      };
      let obj: any = null;
      let diag: string | null = null;
      if (planVarId) {
        const r = await tryFetch(planVarId);
        obj = r.obj;
        if (!obj) diag = `variation ${planVarId}: ${r.err}`;
      }
      if (!obj && planId) {
        const r = await tryFetch(planId);
        obj = r.obj;
        if (!obj) diag = `${diag ? diag + "; " : ""}plan ${planId}: ${r.err}`;
      }
      if (!obj) return { product: null, diag };
      diag = `found type=${obj.type}`;
      const phasePrice = (phase: any) =>
        phase?.pricing?.price_money?.amount
          ?? phase?.pricing?.price?.amount
          ?? phase?.recurring_price_money?.amount
          ?? phase?.price_money?.amount
          ?? null;
      const firstPhaseWithPrice = (phases: any[]) =>
        (phases || []).map((p: any) => ({ phase: p, price: phasePrice(p) })).find((x: any) => x.price != null);
      let row: Record<string, unknown> | null = null;
      if (obj.type === "SUBSCRIPTION_PLAN_VARIATION") {
        const pvd = obj.subscription_plan_variation_data;
        const hit = firstPhaseWithPrice(pvd?.phases);
        // Square's RELATIVE pricing inherits price from the linked catalog
        // item — it's not stored on the plan itself. Fall back to 0 so we can
        // still record the subscription; admin can edit price in Catalog UI.
        const priceCents = hit?.price ?? 0;
        const cadence = pvd?.phases?.[0]?.cadence || "";
        const suffix = hit?.price == null ? ` (${cadence || "inherited"} price)` : "";
        row = {
          kind: "package",
          name: (pvd?.name || "Subscription") + suffix,
          price_cents: priceCents,
          recurring: true,
          square_catalog_id: pvd?.subscription_plan_id || null,
          square_plan_id: pvd?.subscription_plan_id || null,
          square_variation_id: obj.id,
          active: true,
          sort_order: 100,
        };
      } else if (obj.type === "SUBSCRIPTION_PLAN") {
        const pld = obj.subscription_plan_data;
        const hit = firstPhaseWithPrice(pld?.phases);
        const priceCents = hit?.price ?? 0;
        row = {
          kind: "package",
          name: pld?.name || "Subscription",
          price_cents: priceCents,
          recurring: true,
          square_catalog_id: obj.id,
          square_plan_id: obj.id,
          square_variation_id: null,
          active: true,
          sort_order: 100,
        };
      }
      if (!row) {
        return { product: null, diag: `${diag} unsupported type ${obj.type}` };
      }
      const { data: insertedRow, error } = await service
        .from("store_products")
        .insert(row)
        .select("id, name, price_cents, square_variation_id, square_plan_id, kind")
        .single();
      if (error || !insertedRow) {
        return { product: null, diag: `${diag} db insert: ${error?.message || "unknown"}` };
      }
      productsAutoCreated++;
      if (insertedRow.square_variation_id) productByVariation.set(insertedRow.square_variation_id, insertedRow);
      if (insertedRow.square_plan_id) productByPlan.set(insertedRow.square_plan_id, insertedRow);
      return { product: insertedRow, diag: null };
    };

    for (const sub of subs) {
      const subId = sub.id;
      const planVarId = sub.plan_variation_id || null;
      const planId = sub.plan_id || null;
      const status = mapStatus(sub.status);

      const { product, diag } = await ensureProduct(planVarId, planId);
      if (!product) {
        unmatchedProduct++;
        const customer = await fetchCustomer(sub.customer_id);
        unmatched.push({
          subscription_id: subId,
          reason: diag || "no product",
          plan_variation_id: planVarId,
          plan_id: planId,
          customer_name: customer ? `${customer.given_name || ""} ${customer.family_name || ""}`.trim() : null,
          email: customer?.email_address || null,
          square_status: sub.status,
        });
        continue;
      }

      const customer = await fetchCustomer(sub.customer_id);
      const email = customer?.email_address?.trim()?.toLowerCase() || null;
      const userId = email ? userByEmail.get(email) : null;
      if (!userId) {
        unmatchedUser++;
        unmatched.push({
          subscription_id: subId,
          reason: "no user",
          email,
          customer_name: customer ? `${customer.given_name || ""} ${customer.family_name || ""}`.trim() : null,
          plan_variation_id: planVarId,
          plan_id: planId,
          product_name: product.name,
          square_status: sub.status,
        });
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

    const { data: logRow } = await service
      .from("store_backfill_runs")
      .insert({
        ran_by: user.id,
        total_square_subs: subs.length,
        inserted,
        updated,
        products_auto_created: productsAutoCreated,
        unmatched_user: unmatchedUser,
        unmatched_product: unmatchedProduct,
        unmatched,
      })
      .select("id")
      .single();

    return jsonRes(cors, 200, {
      run_id: logRow?.id || null,
      total_square_subs: subs.length,
      inserted,
      updated,
      products_auto_created: productsAutoCreated,
      unmatched_user: unmatchedUser,
      unmatched_product: unmatchedProduct,
      unmatched_details: unmatched,
    });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
