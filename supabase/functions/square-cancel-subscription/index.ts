// Cancel a Square subscription for real (#344).
//
// Until now the portal's only option was DELETE, which removed our row and left
// Square happily billing the family every month. This function stops the actual
// billing and then writes back whatever Square says is true.
//
// Admin or coach (UPDATE on store_purchases is already open to both, and the
// owner's answer on #344 was "let admins and coaches" do this).
//
// Input:  POST { purchase_id: uuid }   + caller's JWT in Authorization
// Output: 200 {
//           ok: true,
//           subscription_id, square_status, canceled_date, charged_through_date,
//           portal_status, already_canceled
//         }
//         non-2xx { error: "<plain English>", stage: "<auth|lookup|square_read|
//                    square_cancel|square_verify|db_write>" }
//
// IMPORTANT SEMANTICS — do not paraphrase these to a parent:
//   * Square cancels at the END of the current billing period. The subscription
//     usually stays ACTIVE with `canceled_date` set to a FUTURE date, and the
//     family keeps their access until then. That is why every response carries
//     canceled_date + charged_through_date: the UI must say "billing stops on
//     14 September", never "billing stopped today".
//   * Cancelling does NOT refund anything. Nothing in here moves money back.
//     A refund is a separate, deliberate action.
//   * Nothing here deletes anything. There is no DELETE in this file.
//
// Ordering is deliberate: read Square -> cancel -> RE-READ Square -> write DB.
// The whole reason #344 exists is that the portal trusted a stale snapshot of
// Square. The re-read is the source of truth; the cancel response's echo is not.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const SQUARE_ENV = Deno.env.get("SQUARE_ENV") || "production";
const SQUARE_BASE = SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";
const SQUARE_VERSION = "2024-11-20";

const LOG = "square-cancel-subscription";

type Stage =
  | "auth"
  | "lookup"
  | "square_read"
  | "square_cancel"
  | "square_verify"
  | "db_write";

function jsonRes(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Same helper the sibling Square functions use, plus the HTTP status carried on
// the thrown error so the caller can tell "Square is down" (retry later) from
// "Square has never heard of this subscription" (stop and investigate).
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
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

// Identical mapping to square-subscriptions-backfill. Keep them in step.
function mapStatus(sq: string): string {
  const s = (sq || "").toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "PENDING") return "pending";
  if (s === "PAUSED") return "past_due";
  if (s === "CANCELED" || s === "DEACTIVATED") return "canceled";
  return "pending";
}

// What HTTP status the caller should see for a Square-side failure. Our token
// being rejected is not the coach's fault, so it surfaces as 502, not 401.
function httpForSquare(err: unknown): number {
  const status = (err as { status?: number })?.status;
  if (status === 404) return 404;
  if (status === 429) return 429;
  return 502;
}

const TERMINAL_SQUARE_STATUSES = new Set(["CANCELED", "DEACTIVATED"]);

type SubFacts = {
  status: string;
  canceledDate: string | null;
  chargedThroughDate: string | null;
};

// Pull the three things that decide what a family is told. `canceled_date` is
// the date billing stops. If Square has scheduled the cancellation but has not
// stamped canceled_date yet, fall back to the pending CANCEL action's
// effective_date (we ask for ?include=actions on every read).
function readSubFacts(sub: unknown): SubFacts {
  const s = (sub || {}) as Record<string, any>;
  const actions = Array.isArray(s.actions) ? s.actions : [];
  const pendingCancel = actions.find(
    (a: any) => String(a?.type || "").toUpperCase() === "CANCEL",
  );
  return {
    status: String(s.status || "").toUpperCase(),
    canceledDate: s.canceled_date ?? pendingCancel?.effective_date ?? null,
    chargedThroughDate: s.charged_through_date ?? null,
  };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);

  // Tracks how far we got. It is the single most useful field in a failure:
  // it tells a coach whether the money was stopped and only the record failed
  // (square_verify / db_write) or whether nothing happened at all (auth /
  // lookup / square_read / square_cancel).
  let stage: Stage = "auth";

  const fail = (
    status: number,
    message: string,
    extra: Record<string, unknown> = {},
  ) => {
    console.error(`${LOG}: FAIL stage=${stage} http=${status} :: ${message}`);
    return jsonRes(cors, status, { error: message, stage, ...extra });
  };

  try {
    if (req.method !== "POST") {
      stage = "lookup";
      return fail(405, "This endpoint only accepts POST.");
    }

    // ---- auth ------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Missing authorization. Sign in and try again.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return fail(401, `Invalid token${userErr ? `: ${userErr.message}` : ""}`);
    }

    // Service role from here on. The role check below runs against it, and it
    // is only used to WRITE after that check passes.
    const service = createClient(supabaseUrl, serviceKey);

    const { data: roleRow, error: roleErr } = await service
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (roleErr) return fail(500, `Could not check your role: ${roleErr.message}`);
    const role = roleRow?.role || null;
    if (role !== "admin" && role !== "coach") {
      console.warn(`${LOG}: role=${role} user=${user.id} denied`);
      return fail(403, "Only an admin or a coach can cancel a subscription.");
    }

    // ---- lookup ----------------------------------------------------------
    stage = "lookup";

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const purchaseId = (body as { purchase_id?: unknown }).purchase_id;
    if (!purchaseId || typeof purchaseId !== "string") {
      return fail(400, "purchase_id is required.");
    }

    // Verify the row exists BEFORE touching Square. Never call Square on a bad id.
    const { data: purchase, error: pErr } = await service
      .from("store_purchases")
      .select(
        "id, user_id, status, square_subscription_id, product_name_snapshot, metadata",
      )
      .eq("id", purchaseId)
      .maybeSingle();
    if (pErr) return fail(500, `Could not read the purchase record: ${pErr.message}`);
    if (!purchase) {
      return fail(404, "That purchase record does not exist. Refresh the page and try again.");
    }

    const subId = purchase.square_subscription_id;
    if (!subId) {
      return fail(
        400,
        "This is a one-time purchase, not a subscription — there is nothing to cancel in Square. "
          + "No recurring billing exists for this record.",
      );
    }

    console.log(
      `${LOG}: start purchase=${purchase.id} subscription=${subId} `
        + `player=${purchase.user_id} portal_status=${purchase.status} `
        + `actor=${user.id} role=${role} env=${SQUARE_ENV}`,
    );

    // ---- square_read: what does Square actually say right now? ------------
    stage = "square_read";
    let before: SubFacts;
    try {
      const readData = await squareFetch(`/v2/subscriptions/${subId}?include=actions`);
      before = readSubFacts(readData?.subscription);
    } catch (err) {
      const httpStatus = httpForSquare(err);
      const detail = (err as Error).message;
      return fail(
        httpStatus,
        httpStatus === 404
          ? `Square has no subscription with id ${subId}. Nothing was cancelled and nothing was charged. `
            + "The portal record may be pointing at the wrong subscription."
          : `Could not read the subscription from Square: ${detail}. Nothing was cancelled.`,
        { subscription_id: subId },
      );
    }
    console.log(
      `${LOG}: square_read purchase=${purchase.id} subscription=${subId} `
        + `status=${before.status} canceled_date=${before.canceledDate} `
        + `charged_through_date=${before.chargedThroughDate}`,
    );

    const priorMetadata =
      (purchase.metadata && typeof purchase.metadata === "object" && !Array.isArray(purchase.metadata))
        ? purchase.metadata as Record<string, unknown>
        : {};

    // Already finished, or already scheduled to finish. Cancelling twice must be
    // harmless, so do NOT call cancel again — just report Square's dates and
    // bring the portal row into line if it disagrees.
    const alreadyCanceled =
      TERMINAL_SQUARE_STATUSES.has(before.status) || !!before.canceledDate;
    if (alreadyCanceled) {
      const portalShouldBe = mapStatus(before.status);
      let portalStatus = purchase.status;
      if (purchase.status !== portalShouldBe) {
        stage = "db_write";
        const { error: syncErr } = await service
          .from("store_purchases")
          .update({
            status: portalShouldBe,
            metadata: {
              ...priorMetadata,
              square_cancel_sync: {
                at: new Date().toISOString(),
                by: user.id,
                by_role: role,
                subscription_id: subId,
                square_status: before.status,
                canceled_date: before.canceledDate,
                charged_through_date: before.chargedThroughDate,
                previous_portal_status: purchase.status,
                note: "Square already had this cancelled; portal row synced. No refund was issued.",
              },
            },
          })
          .eq("id", purchase.id);
        if (syncErr) {
          return fail(
            500,
            `This subscription was already cancelled in Square (billing ends ${before.canceledDate || "at the end of the paid period"}), `
              + `but the portal record could not be updated: ${syncErr.message}. Square is unchanged — do not cancel again.`,
            {
              subscription_id: subId,
              square_status: before.status,
              canceled_date: before.canceledDate,
              charged_through_date: before.chargedThroughDate,
              already_canceled: true,
            },
          );
        }
        portalStatus = portalShouldBe;
        console.log(
          `${LOG}: synced already-cancelled purchase=${purchase.id} `
            + `subscription=${subId} ${purchase.status} -> ${portalShouldBe}`,
        );
      }

      console.log(
        `${LOG}: already_canceled purchase=${purchase.id} subscription=${subId} `
          + `square_status=${before.status} canceled_date=${before.canceledDate} `
          + `charged_through_date=${before.chargedThroughDate} actor=${user.id}`,
      );
      return jsonRes(cors, 200, {
        ok: true,
        subscription_id: subId,
        square_status: before.status,
        canceled_date: before.canceledDate,
        charged_through_date: before.chargedThroughDate,
        portal_status: portalStatus,
        already_canceled: true,
      });
    }

    // ---- square_cancel: the money-moving call -----------------------------
    stage = "square_cancel";
    console.log(
      `${LOG}: cancelling purchase=${purchase.id} subscription=${subId} `
        + `product="${purchase.product_name_snapshot}" actor=${user.id} role=${role}`,
    );
    try {
      // CancelSubscription takes no body and no idempotency key. It schedules
      // the cancellation for the end of the current billing period.
      await squareFetch(`/v2/subscriptions/${subId}/cancel`, { method: "POST" });
    } catch (err) {
      return fail(
        httpForSquare(err),
        `Square refused to cancel the subscription: ${(err as Error).message}. `
          + "Nothing was changed — the family is still being billed. Try again, or check Square directly.",
        { subscription_id: subId, square_status: before.status },
      );
    }
    console.log(`${LOG}: cancel accepted by Square subscription=${subId}`);

    // ---- square_verify: re-read, and believe THIS, not the echo above -----
    stage = "square_verify";
    let after: SubFacts;
    try {
      const verifyData = await squareFetch(`/v2/subscriptions/${subId}?include=actions`);
      after = readSubFacts(verifyData?.subscription);
    } catch (err) {
      console.error(
        `${LOG}: CANCEL SENT BUT UNVERIFIED purchase=${purchase.id} `
          + `subscription=${subId} actor=${user.id} err=${(err as Error).message}`,
      );
      // Best-effort breadcrumb so the next person to look at this row knows a
      // cancel was sent. Status is deliberately NOT changed — we do not know
      // what Square did, and guessing is how #344 happened.
      const { error: noteErr } = await service
        .from("store_purchases")
        .update({
          metadata: {
            ...priorMetadata,
            square_cancel_unverified: {
              at: new Date().toISOString(),
              by: user.id,
              by_role: role,
              subscription_id: subId,
              error: (err as Error).message,
              note: "Cancel was sent to Square but the follow-up read failed. Verify in Square before telling the family anything.",
            },
          },
        })
        .eq("id", purchase.id);
      if (noteErr) console.error(`${LOG}: breadcrumb write failed: ${noteErr.message}`);

      return fail(
        502,
        "The cancellation was sent to Square, but we could not re-read the subscription to confirm it. "
          + "The billing may or may not be stopped and the portal record's status was NOT changed. "
          + "Check this subscription in Square before telling the family anything. Do not assume it is cancelled.",
        { subscription_id: subId },
      );
    }

    const portalStatus = mapStatus(after.status);
    console.log(
      `${LOG}: square_verify purchase=${purchase.id} subscription=${subId} `
        + `status=${after.status} canceled_date=${after.canceledDate} `
        + `charged_through_date=${after.chargedThroughDate} -> portal_status=${portalStatus}`,
    );
    if (!TERMINAL_SQUARE_STATUSES.has(after.status) && !after.canceledDate) {
      // Square accepted the cancel but shows no end date. Surface it loudly
      // rather than letting the UI invent one.
      console.warn(
        `${LOG}: cancel accepted but Square reports status=${after.status} with no `
          + `canceled_date subscription=${subId} — verify manually`,
      );
    }

    // ---- db_write --------------------------------------------------------
    stage = "db_write";
    const { error: uErr } = await service
      .from("store_purchases")
      .update({
        status: portalStatus,
        // Merge — never clobber. Checkout/backfill/discount all keep keys here.
        metadata: {
          ...priorMetadata,
          square_cancel: {
            at: new Date().toISOString(),
            by: user.id,
            by_role: role,
            subscription_id: subId,
            square_status: after.status,
            canceled_date: after.canceledDate,
            charged_through_date: after.chargedThroughDate,
            previous_portal_status: purchase.status,
            note: "Recurring billing cancelled in Square. Billing stops at the end of the paid period; access continues until then. No refund was issued.",
          },
        },
      })
      .eq("id", purchase.id);
    if (uErr) {
      return fail(
        500,
        `Billing WAS cancelled in Square (billing stops ${after.canceledDate || "at the end of the current paid period"}), `
          + `but the portal record could not be updated: ${uErr.message}. `
          + "Do not cancel again — the subscription is already cancelled in Square. The portal row still shows the old status.",
        {
          subscription_id: subId,
          square_status: after.status,
          canceled_date: after.canceledDate,
          charged_through_date: after.chargedThroughDate,
        },
      );
    }

    console.log(
      `${LOG}: done purchase=${purchase.id} subscription=${subId} `
        + `square_status=${after.status} portal_status=${portalStatus} `
        + `canceled_date=${after.canceledDate} charged_through_date=${after.chargedThroughDate} `
        + `actor=${user.id} role=${role}`,
    );

    return jsonRes(cors, 200, {
      ok: true,
      subscription_id: subId,
      square_status: after.status,
      canceled_date: after.canceledDate,
      charged_through_date: after.chargedThroughDate,
      portal_status: portalStatus,
      already_canceled: false,
    });
  } catch (err) {
    // `stage` still holds the last step we entered, so an unexpected throw is
    // still attributable.
    console.error(`${LOG}: unhandled error at stage=${stage}:`, err);
    return jsonRes(cors, 500, { error: (err as Error).message, stage });
  }
});
