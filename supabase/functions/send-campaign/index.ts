// Issue #281 Phase 2 — the campaign blast sender.
//
// This is the only irreversible action in the application: it emails real
// families. Every design choice below is a safety property. Do not simplify.
//
//   - ADMIN ONLY (send-email allows coach; this does not).
//   - The request identifies recipients by campaign_id and NOTHING else. The
//     list is read server-side from email_campaign_recipients. Accepting
//     addresses from the browser would turn any admin session into an open
//     relay — that is why this function exists separately from send-email,
//     whose single-recipient anti-injection guard stays untouched.
//   - IDEMPOTENT: only rows still 'pending' are ever sent. Re-invoking for
//     the same campaign re-sends nothing; a double-click cannot double-send.
//     ('retryFailed: true' first flips failed → pending, then the same rule
//     applies — sent rows are never touched.)
//   - Results are written per batch AS THE SEND PROGRESSES, never only at
//     the end. If this dies halfway, the database already knows exactly who
//     was emailed.
//   - Blacklisted addresses are marked 'skipped' — recorded, not dropped.
//   - The recipient snapshot is verified against the count the admin
//     confirmed (email_campaigns.recipient_count). Mismatch = stop, send
//     nothing, report.
//   - Resend limits (looked up 2026-08-08, resend.com/docs/api-reference/
//     rate-limit + the batch API announcement): batch endpoint takes up to
//     100 emails per call; the rate limit is 2 requests/second on the
//     conservative published figure (newer docs say 10/s per team). We pace
//     to the conservative 2/s and back off on 429 — safe under either.
//   - Wall clock: work is chunked and self-limiting. If time runs out with
//     rows still pending, the function returns { resume: true } and the
//     client re-invokes; idempotency makes resumption safe.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const BATCH_SIZE = 100;              // Resend batch endpoint maximum
const BATCH_PAUSE_MS = 700;          // ~1.4 requests/second — under the 2/s published limit
const TIME_BUDGET_MS = 100_000;      // return { resume: true } past this; edge wall clock is ~150s
const FROM = "NBP Portal <noreply@thenatural-app.com>";

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function unsubscribeUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl}/functions/v1/unsubscribe?token=${token}`;
}

function campaignHtml(bodyHtml: string, unsubUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;padding:24px;max-width:600px;margin:0 auto;">
${bodyHtml}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
<p style="font-size:12px;color:#9ca3af;text-align:center;">
The Natural Ballplayer &middot; <a href="https://www.thenatural-app.com" style="color:#6b7280;">thenatural-app.com</a><br>
<a href="${unsubUrl}" style="color:#6b7280;">Unsubscribe from these emails</a>
</p>
</body>
</html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing authorization header" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json(401, { error: "Invalid token" });

    // ADMIN only. Deliberately stricter than send-email's admin+coach:
    // emailing the whole list is not a coach-level action.
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: userData, error: roleError } = await serviceClient
      .from("users").select("role").eq("id", user.id).single();
    if (roleError || !userData || userData.role !== "admin") {
      return json(403, { error: "Unauthorized: admin only" });
    }

    const { campaignId, retryFailed } = await req.json();
    if (!campaignId || typeof campaignId !== "string") {
      return json(400, { error: "campaignId is required" });
    }

    const { data: campaign, error: campaignError } = await serviceClient
      .from("email_campaigns")
      .select("id, subject, body_html, recipient_count, status")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) return json(500, { error: `Failed to load campaign: ${campaignError.message}` });
    if (!campaign) return json(404, { error: "Campaign not found" });
    if (!campaign.subject || !campaign.body_html) {
      return json(400, { error: "Campaign has no subject or body — nothing sent." });
    }

    // Retry-failed: flip ONLY failed rows back to pending. Sent rows are
    // never touched, so retrying cannot re-email anyone.
    if (retryFailed === true) {
      const { error: retryError } = await serviceClient
        .from("email_campaign_recipients")
        .update({ status: "pending", error: null })
        .eq("campaign_id", campaignId)
        .eq("status", "failed");
      if (retryError) return json(500, { error: `Failed to reset failed recipients: ${retryError.message}` });
    }

    // Load the full snapshot for verification, then work only the pending rows.
    const { data: allRows, error: rowsError } = await serviceClient
      .from("email_campaign_recipients")
      .select("id, email, status, unsubscribe_token")
      .eq("campaign_id", campaignId)
      .range(0, 9999);
    if (rowsError) {
      return json(500, {
        error: `Failed to load recipients: ${rowsError.message}. ` +
          `(If this mentions unsubscribe_token, run 20260808_phase2_unsubscribe.sql first — ` +
          `campaign email must not go out without unsubscribe links.)`,
      });
    }

    // The snapshot must match the count the admin literally typed to
    // confirm. If it doesn't, someone changed something — send NOTHING.
    if (!allRows || allRows.length !== campaign.recipient_count) {
      return json(409, {
        error: `Recipient snapshot (${allRows?.length ?? 0}) does not match the confirmed count ` +
          `(${campaign.recipient_count}). Nothing was sent.`,
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) return json(500, { error: "Email service not configured" });

    await serviceClient.from("email_campaigns")
      .update({ status: "sending" }).eq("id", campaignId);

    // Blacklist — mark matches 'skipped' BEFORE sending, recorded not dropped.
    const { data: blacklistRows, error: blacklistError } = await serviceClient
      .from("email_blacklist").select("email").range(0, 9999);
    if (blacklistError) {
      await serviceClient.from("email_campaigns").update({ status: "failed" }).eq("id", campaignId);
      return json(500, { error: `Failed to load blacklist: ${blacklistError.message}. Nothing was sent.` });
    }
    const blacklist = new Set((blacklistRows || []).map((r) => (r.email || "").toLowerCase().trim()));

    const pendingAll = allRows.filter((r) => r.status === "pending");
    const toSkip = pendingAll.filter((r) => blacklist.has((r.email || "").toLowerCase().trim()));
    if (toSkip.length > 0) {
      const { error: skipError } = await serviceClient
        .from("email_campaign_recipients")
        .update({ status: "skipped", error: "blacklisted" })
        .in("id", toSkip.map((r) => r.id));
      if (skipError) console.error("send-campaign: failed to mark skipped rows:", skipError.message);
    }
    const skipIds = new Set(toSkip.map((r) => r.id));
    const queue = pendingAll.filter((r) => !skipIds.has(r.id));

    const startedAt = Date.now();
    let sentCount = 0;
    let failedCount = 0;
    let resume = false;

    const markRows = async (ids: string[], fields: Record<string, unknown>) => {
      if (ids.length === 0) return;
      const { error } = await serviceClient
        .from("email_campaign_recipients").update(fields).in("id", ids);
      if (error) console.error("send-campaign: failed to record results:", error.message);
    };

    const sendOne = async (row: { id: string; email: string; unsubscribe_token: string }) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [row.email],
          subject: campaign.subject,
          html: campaignHtml(campaign.body_html, unsubscribeUrl(supabaseUrl, row.unsubscribe_token)),
          text: htmlToText(campaign.body_html) +
            `\n\n---\nUnsubscribe: ${unsubscribeUrl(supabaseUrl, row.unsubscribe_token)}`,
        }),
      });
      let data: { id?: string; message?: string } = {};
      try { data = await res.json(); } catch { /* non-JSON error body */ }
      if (res.ok && data.id) {
        await markRows([row.id], { status: "sent", provider_message_id: data.id, sent_at: new Date().toISOString() });
        sentCount++;
      } else {
        await markRows([row.id], { status: "failed", error: data.message || `Resend status ${res.status}` });
        failedCount++;
      }
    };

    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { resume = true; break; }
      const chunk = queue.slice(i, i + BATCH_SIZE);

      // Malformed addresses fail up front — never handed to Resend, and never
      // allowed to poison a batch of 99 valid ones.
      const invalid = chunk.filter((r) => !r.email || r.email.length > 254 || /[\r\n,;<>]/.test(r.email) || !EMAIL_RE.test(r.email));
      if (invalid.length > 0) {
        await markRows(invalid.map((r) => r.id), { status: "failed", error: "invalid email address" });
        failedCount += invalid.length;
      }
      const valid = chunk.filter((r) => !invalid.includes(r));
      if (valid.length === 0) continue;

      let batchRes: Response;
      try {
        batchRes = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(valid.map((row) => ({
            from: FROM,
            to: [row.email],
            subject: campaign.subject,
            html: campaignHtml(campaign.body_html, unsubscribeUrl(supabaseUrl, row.unsubscribe_token)),
            text: htmlToText(campaign.body_html) +
              `\n\n---\nUnsubscribe: ${unsubscribeUrl(supabaseUrl, row.unsubscribe_token)}`,
          }))),
        });
      } catch (netErr) {
        await markRows(valid.map((r) => r.id), { status: "failed", error: `network error: ${(netErr as Error).message}` });
        failedCount += valid.length;
        continue;
      }

      if (batchRes.status === 429) {
        // Rate limited: nothing in this chunk was sent. Back off hard, then
        // fall through to one-by-one for this chunk (self-pacing).
        await batchRes.body?.cancel();
        await new Promise((r) => setTimeout(r, 2000));
        for (const row of valid) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) { resume = true; break; }
          await sendOne(row);
          await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
        }
        if (resume) break;
        continue;
      }

      if (!batchRes.ok) {
        // Whole-batch rejection (e.g. one bad payload item 422s the call).
        // Retry the chunk one-by-one so a single bad address cannot take
        // down 99 good ones, and each failure records ITS error.
        await batchRes.body?.cancel();
        for (const row of valid) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) { resume = true; break; }
          await sendOne(row);
          await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
        }
        if (resume) break;
        continue;
      }

      // Success: Resend returns { data: [{ id }, ...] } aligned with the
      // request order. Record results for THIS batch immediately.
      let batchData: { data?: Array<{ id?: string }> } = {};
      try { batchData = await batchRes.json(); } catch { /* tolerated */ }
      const ids = batchData.data || [];
      const nowIso = new Date().toISOString();
      for (let j = 0; j < valid.length; j++) {
        const providerId = ids[j]?.id || null;
        await markRows([valid[j].id], providerId
          ? { status: "sent", provider_message_id: providerId, sent_at: nowIso }
          : { status: "failed", error: "no provider id in batch response" });
        if (providerId) sentCount++; else failedCount++;
      }

      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }

    // Final tallies from the database — the source of truth, not our counters.
    const { data: finalRows } = await serviceClient
      .from("email_campaign_recipients")
      .select("status")
      .eq("campaign_id", campaignId)
      .range(0, 9999);
    const tally = { sent: 0, failed: 0, skipped: 0, pending: 0 };
    (finalRows || []).forEach((r) => { tally[r.status as keyof typeof tally] = (tally[r.status as keyof typeof tally] || 0) + 1; });

    if (!resume) {
      await serviceClient.from("email_campaigns").update({
        status: tally.failed > 0 && tally.sent === 0 ? "failed" : "sent",
        sent_at: new Date().toISOString(),
      }).eq("id", campaignId);
    }

    return json(200, { success: true, resume, ...tally });
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
});
