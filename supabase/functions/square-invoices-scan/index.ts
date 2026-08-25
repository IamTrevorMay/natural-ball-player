// Read the individual Square invoices so a human can reconcile them by hand (#340).
//
// WHY THIS EXISTS. 140 one-time purchases sit at 'pending' even though the money
// arrived — as Square invoices sent from the dashboard, or cards taken at the
// desk. Those payments carry an order id the portal has never seen, so they can
// never auto-match. There is no key linking a Square invoice to a portal
// purchase, so this cannot be automated: a person has to confirm each one.
//
// This function is the READ-ONLY half of that tool. It fetches invoices from
// Square and hands them back. It writes NOTHING, anywhere — no INSERT, no
// UPDATE, no DELETE, and no Square mutation. The only Supabase calls in this
// file are the auth check and the role lookup. A separate screen proposes
// matches and a human confirms each one.
//
// Contract:
//   POST { since: "YYYY-MM-DD" | null, cursor: string | null }
//   200  { invoices: [...], count, cursor, has_more, scanned_since }
//   err  { error, stage: "auth" | "square" | "parse" }
//
// Authorisation: admin OR coach — matching the Mark-as-Paid action in
// src/WorkStore.js (`userRole === 'admin' || userRole === 'coach'`) and the
// store_purchases_update_staff RLS policy. The staff who settle these rows are
// the staff who need to read the invoices.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const SQUARE_ENV = Deno.env.get("SQUARE_ENV") || "production";
const SQUARE_BASE = SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";
const SQUARE_VERSION = "2024-11-20";

// Square caps SearchInvoices at 200 per page. We deliberately ask for 100 so a
// single response can never balloon: we stop asking for pages the moment we
// hold MAX_RESULTS, which bounds one response at MAX_RESULTS - 1 + PAGE_LIMIT.
// We never truncate the array — a truncated page has no resumable cursor, and
// silently dropping an invoice from a money-reconciliation screen is the one
// failure mode that must not happen.
const SQUARE_PAGE_LIMIT = 100;
const MAX_RESULTS = 200;
const MAX_PAGES = 20; // hard stop so one invocation cannot run to timeout
const DEFAULT_SINCE_DAYS = 180;
const CUSTOMER_CONCURRENCY = 10;
const ORDER_BATCH_SIZE = 100; // BatchRetrieveOrders maximum
const ORDER_CONCURRENCY = 3;
const SQUARE_RETRY_BACKOFF_MS = [400, 1200, 3000];

function jsonRes(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function errRes(
  cors: Record<string, string>,
  status: number,
  stage: "auth" | "square" | "parse",
  error: string,
) {
  return jsonRes(cors, status, { error, stage });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same helper as square-subscriptions-backfill, plus 429 handling: Square rate
// limits per-endpoint and a scan of a busy location will hit it. Honour
// Retry-After when Square sends one, otherwise back off on a short curve. We
// retry ONLY 429 — a 500 is surfaced immediately so the caller sees the real
// failure instead of waiting out three pointless retries.
async function squareFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN not configured");

  for (let attempt = 0; ; attempt++) {
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

    if (res.status === 429 && attempt < SQUARE_RETRY_BACKOFF_MS.length) {
      const retryAfter = Number(res.headers?.get?.("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5000)
        : SQUARE_RETRY_BACKOFF_MS[attempt];
      console.log(
        "[square-invoices-scan] square 429, backing off",
        JSON.stringify({ path, attempt: attempt + 1, wait_ms: waitMs }),
      );
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const msg = data?.errors?.[0]?.detail || `Square ${path} failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }
}

// Bounded worker pool, same shape as the pre-fetch in
// square-subscriptions-backfill: never one request per row, serially.
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let idx = 0;
  const runners: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    runners.push((async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        await worker(items[i]);
      }
    })());
  }
  await Promise.all(runners);
}

// A Square Money amount, or null when the field genuinely is not there.
// 0 and "unknown" mean very different things to someone deciding whether a
// family paid, so we never coerce an absent field to 0.
function moneyAmount(m: any): number | null {
  const a = m?.amount;
  if (typeof a === "number" && Number.isFinite(a)) return a;
  return null;
}

function ts(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
}

// Total DUE on the invoice.
//
// Square does not put a total on the Invoice object. It lives as
// payment_requests[].computed_amount_money (read-only, computed from the
// order). An invoice is "one balance", "one deposit + balance", or
// "2-12 installments", so the total is the SUM across payment requests. We
// require every request to carry an amount — a partial sum understates what a
// family owes, which is worse than admitting we don't know. If the invoice
// gives us nothing (drafts can), fall back to the linked order's total_money;
// if that is missing too, return null.
function totalDueCents(inv: any, order: any): number | null {
  const reqs = Array.isArray(inv?.payment_requests) ? inv.payment_requests : [];
  if (reqs.length > 0) {
    let sum = 0;
    let complete = true;
    for (const r of reqs) {
      const a = moneyAmount(r?.computed_amount_money);
      if (a === null) { complete = false; break; }
      sum += a;
    }
    if (complete) return sum;
  }
  return moneyAmount(order?.total_money);
}

// Amount ACTUALLY PAID, from payment_requests[].total_completed_amount_money.
// Square omits that field on a request nothing has been paid against, so an
// absent field on a present request means zero paid on that request — not
// unknown. But if the invoice carries no payment_requests at all we know
// nothing, and say so with null rather than claiming $0.00 was paid.
function paidCents(inv: any): number | null {
  const reqs = Array.isArray(inv?.payment_requests) ? inv.payment_requests : [];
  if (reqs.length === 0) return null;
  let sum = 0;
  for (const r of reqs) sum += moneyAmount(r?.total_completed_amount_money) ?? 0;
  return sum;
}

function nameOf(given: unknown, family: unknown): string | null {
  const n = `${given || ""} ${family || ""}`.trim();
  return n || null;
}

// Upper bound on the value SearchInvoices sorts by. Square sorts
// INVOICE_SORT_DATE by created_at for drafts, scheduled_at for scheduled
// invoices, and the PUBLISH date for published ones — and the publish date is
// not a field we can read. It is however always <= updated_at, and always
// >= created_at. So max(created_at, scheduled_at, updated_at) is a safe upper
// bound, which is what lets us stop paging: sorted DESC, once an invoice's
// upper bound is older than `since`, every invoice after it has a sort date
// below that, hence a created_at below `since`, and none can qualify.
// Stopping on created_at alone would be wrong — an invoice created in May and
// published in July sorts by July.
function sortDateUpperBound(inv: any): number | null {
  const candidates = [ts(inv?.created_at), ts(inv?.scheduled_at), ts(inv?.updated_at)]
    .filter((t): t is number => t !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);

  const runId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return errRes(cors, 405, "parse", "Use POST");
    }

    // ---- auth: admin or coach ------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errRes(cors, 401, "auth", "Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: userErr } = await userClient.auth.getUser();
    const user = authData?.user;
    if (userErr || !user) {
      console.log(
        "[square-invoices-scan] auth failed",
        JSON.stringify({ run_id: runId, error: userErr?.message || "no user" }),
      );
      return errRes(cors, 401, "auth", "Invalid token");
    }

    const service = createClient(supabaseUrl, serviceKey);

    const { data: roleRow, error: roleErr } = await service
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    if (roleErr) {
      console.log(
        "[square-invoices-scan] role lookup failed",
        JSON.stringify({ run_id: runId, user_id: user.id, error: roleErr.message }),
      );
      return errRes(cors, 500, "auth", `Could not read your role: ${roleErr.message}`);
    }
    const role = roleRow?.role;
    if (role !== "admin" && role !== "coach") {
      console.log(
        "[square-invoices-scan] forbidden",
        JSON.stringify({ run_id: runId, user_id: user.id, role: role || null }),
      );
      return errRes(cors, 403, "auth", "Admin or coach only");
    }

    // ---- request body --------------------------------------------------------
    let body: any = {};
    try {
      const raw = await req.text();
      body = raw ? JSON.parse(raw) : {};
    } catch (_e) {
      return errRes(cors, 400, "parse", "Body must be JSON");
    }

    let since: string | null = body?.since ?? null;
    if (since !== null && (typeof since !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(since))) {
      return errRes(cors, 400, "parse", "since must be YYYY-MM-DD or null");
    }
    if (!since) {
      const d = new Date(Date.now() - DEFAULT_SINCE_DAYS * 86400000);
      since = d.toISOString().slice(0, 10);
    }
    const sinceMs = ts(since);
    if (sinceMs === null) return errRes(cors, 400, "parse", "since is not a real date");

    const startCursor: string | null =
      typeof body?.cursor === "string" && body.cursor ? body.cursor : null;

    const locationId = Deno.env.get("SQUARE_LOCATION_ID");
    if (!locationId) return errRes(cors, 500, "square", "SQUARE_LOCATION_ID not configured");

    console.log(
      "[square-invoices-scan] start",
      JSON.stringify({
        run_id: runId,
        user_id: user.id,
        role,
        since,
        resumed: Boolean(startCursor),
        square_env: SQUARE_ENV,
        location_id: locationId,
      }),
    );

    // ---- page through SearchInvoices ----------------------------------------
    // SearchInvoices is the only invoice endpoint that filters by location AND
    // returns a cursor AND lets us control sort order. InvoiceFilter has no date
    // range at all (confirmed against the reference: location_ids + customer_ids
    // only), so `since` is applied here, on created_at, after the fetch.
    const matched: any[] = [];
    let cursor: string | null = startCursor;
    let pages = 0;
    let scanned = 0;
    let reachedWindowEnd = false;

    while (pages < MAX_PAGES) {
      const searchBody: Record<string, unknown> = {
        query: {
          filter: { location_ids: [locationId] },
          sort: { field: "INVOICE_SORT_DATE", order: "DESC" },
        },
        limit: SQUARE_PAGE_LIMIT,
      };
      if (cursor) searchBody.cursor = cursor;

      let page: any;
      try {
        page = await squareFetch("/v2/invoices/search", {
          method: "POST",
          body: JSON.stringify(searchBody),
        });
      } catch (err) {
        console.log(
          "[square-invoices-scan] square search failed",
          JSON.stringify({
            run_id: runId,
            page: pages + 1,
            scanned,
            matched: matched.length,
            error: (err as Error).message,
          }),
        );
        return errRes(cors, 502, "square", (err as Error).message);
      }

      pages++;
      const invoices: any[] = Array.isArray(page?.invoices) ? page.invoices : [];
      scanned += invoices.length;

      for (const inv of invoices) {
        const created = ts(inv?.created_at);
        // Unparseable created_at: keep it. A staff member can judge an odd row;
        // dropping money silently is not an option.
        if (created === null || created >= sinceMs) matched.push(inv);
      }

      cursor = typeof page?.cursor === "string" && page.cursor ? page.cursor : null;

      // Sorted DESC, so if the last invoice on this page cannot possibly sort at
      // or after `since`, nothing further back can either.
      const last = invoices[invoices.length - 1];
      const lastBound = last ? sortDateUpperBound(last) : null;
      if (lastBound !== null && lastBound < sinceMs) {
        reachedWindowEnd = true;
        break;
      }

      if (!cursor) { reachedWindowEnd = true; break; }
      if (matched.length >= MAX_RESULTS) break;
    }

    const hasMore = Boolean(cursor) && !reachedWindowEnd;
    const nextCursor = hasMore ? cursor : null;

    // ---- customer fallback (only where the invoice itself lacks an email) ----
    // The invoice's primary_recipient is a snapshot of the customer taken when
    // the invoice was created, and it usually carries the email. Prefer it.
    // Only where there is a customer_id but no email do we go back to Square,
    // and then once per unique customer, through a bounded worker pool — never
    // one request per invoice, serially.
    const customerCache = new Map<string, any>();
    const needCustomer = Array.from(new Set(
      matched
        .filter((inv) => !inv?.primary_recipient?.email_address && inv?.primary_recipient?.customer_id)
        .map((inv) => inv.primary_recipient.customer_id as string),
    ));
    let customerLookupFailures = 0;
    await pool(needCustomer, CUSTOMER_CONCURRENCY, async (cid) => {
      try {
        const data = await squareFetch(`/v2/customers/${cid}`);
        customerCache.set(cid, data?.customer ?? null);
      } catch (err) {
        customerLookupFailures++;
        console.log(
          "[square-invoices-scan] customer lookup failed",
          JSON.stringify({ run_id: runId, customer_id: cid, error: (err as Error).message }),
        );
        customerCache.set(cid, null);
      }
    });

    // ---- orders (line item names + payment ids) ------------------------------
    // Neither line items nor payment ids live on the Invoice object; both live
    // on the linked Order. BatchRetrieveOrders is a POST but is a pure read.
    // If it fails we degrade — the invoice rows are still worth showing — and
    // line_item_names / payment_ids come back null, meaning "not retrieved",
    // which is not the same as "there were none".
    const orderCache = new Map<string, any>();
    const orderIds = Array.from(new Set(
      matched.map((inv) => inv?.order_id).filter((id: unknown): id is string => typeof id === "string" && !!id),
    ));
    const orderChunks: string[][] = [];
    for (let i = 0; i < orderIds.length; i += ORDER_BATCH_SIZE) {
      orderChunks.push(orderIds.slice(i, i + ORDER_BATCH_SIZE));
    }
    let orderLookupFailures = 0;
    await pool(orderChunks, ORDER_CONCURRENCY, async (chunk) => {
      try {
        const data = await squareFetch("/v2/orders/batch-retrieve", {
          method: "POST",
          body: JSON.stringify({ location_id: locationId, order_ids: chunk }),
        });
        for (const o of (Array.isArray(data?.orders) ? data.orders : [])) {
          if (o?.id) orderCache.set(o.id, o);
        }
      } catch (err) {
        orderLookupFailures++;
        console.log(
          "[square-invoices-scan] order batch failed",
          JSON.stringify({ run_id: runId, order_ids: chunk.length, error: (err as Error).message }),
        );
      }
    });

    // ---- shape the response --------------------------------------------------
    let out: any[];
    try {
      out = matched.map((inv) => {
        const pr = inv?.primary_recipient || {};
        const cid = pr?.customer_id || null;
        const fallback = cid ? customerCache.get(cid) : null;

        const email = pr?.email_address || fallback?.email_address || null;
        const name = nameOf(pr?.given_name, pr?.family_name)
          || nameOf(fallback?.given_name, fallback?.family_name)
          || fallback?.company_name
          || null;

        const order = inv?.order_id ? orderCache.get(inv.order_id) : undefined;
        const lineItemNames = order
          ? (Array.isArray(order.line_items) ? order.line_items : []).map((li: any) =>
            li?.name || li?.variation_name || "Custom amount"
          )
          : null;
        const paymentIds = order
          ? (Array.isArray(order.tenders) ? order.tenders : [])
            .map((t: any) => t?.payment_id || t?.id)
            .filter((v: unknown): v is string => typeof v === "string" && !!v)
          : null;

        return {
          id: inv?.id ?? null,
          // Verbatim: PAID, PARTIALLY_PAID, UNPAID, CANCELED, DRAFT, SCHEDULED,
          // PAYMENT_PENDING, REFUNDED, FAILED... The UI decides what to do with
          // it. An unpaid invoice is exactly as useful to a reconciler as a
          // paid one: it tells them the money genuinely has not arrived.
          status: inv?.status ?? null,
          created_at: inv?.created_at ?? null,
          title: inv?.title ?? null,
          customer_name: name,
          customer_email: email,
          amount_cents: totalDueCents(inv, order),
          paid_amount_cents: paidCents(inv),
          order_id: inv?.order_id ?? null,
          payment_ids: paymentIds,
          public_url: inv?.public_url ?? null,
          line_item_names: lineItemNames,
        };
      });
    } catch (err) {
      console.log(
        "[square-invoices-scan] map failed",
        JSON.stringify({ run_id: runId, error: (err as Error).message }),
      );
      return errRes(cors, 500, "parse", `Could not read Square's response: ${(err as Error).message}`);
    }

    console.log(
      "[square-invoices-scan] done",
      JSON.stringify({
        run_id: runId,
        user_id: user.id,
        role,
        since,
        pages,
        scanned,
        returned: out.length,
        has_more: hasMore,
        reached_window_end: reachedWindowEnd,
        hit_page_cap: pages >= MAX_PAGES,
        customer_lookups: needCustomer.length,
        customer_lookup_failures: customerLookupFailures,
        order_batches: orderChunks.length,
        order_lookup_failures: orderLookupFailures,
        unknown_amount: out.filter((r) => r.amount_cents === null).length,
        ms: Date.now() - startedAt,
      }),
    );

    return jsonRes(cors, 200, {
      invoices: out,
      count: out.length,
      cursor: nextCursor,
      has_more: hasMore,
      scanned_since: since,
    });
  } catch (err) {
    console.log(
      "[square-invoices-scan] unhandled",
      JSON.stringify({ run_id: runId, error: (err as Error).message }),
    );
    return errRes(cors, 500, "square", (err as Error).message);
  }
});
