// Square catalog sync (#142). Admin-only.
// Pulls ITEMs (one-time) and SUBSCRIPTION_PLAN_VARIATIONs (recurring) from the
// merchant's Square Catalog and upserts them into store_products.
//
// Upsert key: square_variation_id when present, otherwise square_catalog_id
// (so re-syncing is idempotent and updates names / prices in place).
//
// Kind defaults: one-time items -> 'lesson', subscription plan variations ->
// 'package'. Admin can re-classify (bundle / rental) in the UI after sync.
// Existing rows keep their user-edited kind / active / sort_order / description.

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

async function listAllCatalog(types: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ types });
    if (cursor) qs.set("cursor", cursor);
    const data = await squareFetch(`/v2/catalog/list?${qs.toString()}`);
    if (Array.isArray(data.objects)) out.push(...data.objects);
    cursor = data.cursor;
  } while (cursor);
  return out;
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

    const items = await listAllCatalog("ITEM");
    const planVars = await listAllCatalog("SUBSCRIPTION_PLAN_VARIATION");

    // Existing rows keyed by square_variation_id (preferred) and square_catalog_id (fallback)
    const { data: existing } = await service
      .from("store_products")
      .select("id, square_variation_id, square_catalog_id");
    const bySvId = new Map<string, string>();
    const byCatId = new Map<string, string>();
    for (const r of (existing || [])) {
      if (r.square_variation_id) bySvId.set(r.square_variation_id, r.id);
      else if (r.square_catalog_id) byCatId.set(r.square_catalog_id, r.id);
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Helper: upsert one product
    const upsert = async (row: Record<string, unknown>, lookupId: string, byMap: Map<string, string>) => {
      const id = byMap.get(lookupId);
      if (id) {
        // Update only price/name/square IDs — preserve admin-edited fields.
        const patch = {
          name: row.name,
          price_cents: row.price_cents,
          square_catalog_id: row.square_catalog_id ?? null,
          square_plan_id: row.square_plan_id ?? null,
          square_variation_id: row.square_variation_id ?? null,
        };
        const { error } = await service.from("store_products").update(patch).eq("id", id);
        if (error) errors.push(`update ${lookupId}: ${error.message}`);
        else updated++;
      } else {
        const { error } = await service.from("store_products").insert(row);
        if (error) errors.push(`insert ${lookupId}: ${error.message}`);
        else inserted++;
      }
    };

    // ITEMs (one-time). One row per variation when item has variations.
    for (const it of items) {
      const itemData = it.item_data;
      if (!itemData) { skipped++; continue; }
      const variations = itemData.variations || [];
      if (variations.length === 0) { skipped++; continue; }
      for (const v of variations) {
        const vd = v.item_variation_data;
        const priceCents = vd?.price_money?.amount;
        if (priceCents == null) { skipped++; continue; }
        const name = variations.length === 1
          ? itemData.name
          : `${itemData.name} – ${vd.name || "Variation"}`;
        await upsert(
          {
            kind: "lesson",
            name,
            price_cents: priceCents,
            recurring: false,
            square_catalog_id: it.id,
            square_variation_id: v.id,
            active: true,
            sort_order: 0,
          },
          v.id,
          bySvId,
        );
      }
    }

    // SUBSCRIPTION_PLAN_VARIATIONs (recurring monthly packages)
    for (const pv of planVars) {
      const pvd = pv.subscription_plan_variation_data;
      if (!pvd) { skipped++; continue; }
      const phase = pvd.phases?.[0];
      const priceCents = phase?.pricing?.price?.amount ?? phase?.recurring_price_money?.amount;
      if (priceCents == null) { skipped++; continue; }
      const name = pvd.name || "Subscription";
      await upsert(
        {
          kind: "package",
          name,
          price_cents: priceCents,
          recurring: true,
          square_catalog_id: pvd.subscription_plan_id || null,
          square_plan_id: pvd.subscription_plan_id || null,
          square_variation_id: pv.id,
          active: true,
          sort_order: 100,
        },
        pv.id,
        bySvId,
      );
    }

    return jsonRes(cors, 200, {
      inserted,
      updated,
      skipped,
      errors,
      counts: { items: items.length, plan_variations: planVars.length },
    });
  } catch (err) {
    return jsonRes(cors, 500, { error: (err as Error).message });
  }
});
