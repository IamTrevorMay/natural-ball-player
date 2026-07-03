import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AES-256-GCM encryption
function getEncryptionKey(): Promise<CryptoKey> {
  const keyStr = Deno.env.get("WHOOP_ENCRYPTION_KEY");
  if (!keyStr || keyStr.length < 32) {
    throw new Error("WHOOP_ENCRYPTION_KEY must be at least 32 characters");
  }
  const keyBytes = new TextEncoder().encode(keyStr.slice(0, 32));
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  const cipher = new Uint8Array(cipherBuf);
  const ciphertext = cipher.slice(0, cipher.length - 16);
  const tag = cipher.slice(cipher.length - 16);
  return `${btoa(String.fromCharCode(...iv))}:${btoa(String.fromCharCode(...tag))}:${btoa(String.fromCharCode(...ciphertext))}`;
}

const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

// Constant-time string comparison
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyOAuthState(userId: string, nonce: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get("WHOOP_ENCRYPTION_KEY");
  if (!secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${userId}:${nonce}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return timingSafeEqual(expected, signature);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");

    if (!code || !stateParam) {
      return new Response("Missing code or state", { status: 400 });
    }

    // State format: `${userId}:${nonce}:${signature}`. Validated via HMAC, no
    // DB round-trip — so two parallel connect attempts can't invalidate each
    // other (previous design stored state on users row). Legacy format from
    // before this deploy was `${userId}:${state}` stored on
    // users.whoop_oauth_state and is validated via DB lookup.
    const parts = stateParam.split(":");
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let userId: string;

    if (parts.length === 3) {
      // H6: HMAC-signed path. All three pieces must be non-empty before we
      // hand them to verifyOAuthState.
      const [hmacUserId, nonce, signature] = parts;
      if (!hmacUserId || !nonce || !signature) {
        return new Response("Invalid state", { status: 400 });
      }
      const ok = await verifyOAuthState(hmacUserId, nonce, signature);
      if (!ok) {
        return new Response("Invalid state", { status: 403 });
      }
      // Reject stale state (replay protection). The nonce is `<issuedMs>.<uuid>`;
      // reject if it's missing the timestamp or older than 10 minutes.
      const issuedMs = Number(nonce.split(".")[0]);
      const TEN_MIN = 10 * 60 * 1000;
      if (!Number.isFinite(issuedMs) || Date.now() - issuedMs > TEN_MIN) {
        return new Response("State expired — please reconnect.", { status: 403 });
      }
      userId = hmacUserId;
    } else if (parts.length === 2) {
      // H6: legacy path requires EXACTLY 2 non-empty parts. The previous
      // `parts.length !== 3` check accepted 4+ parts and silently ignored the
      // trailing fragments via destructuring, letting a crafted state slip
      // past the HMAC path.
      const [userIdLegacy, legacyState] = parts;
      if (!userIdLegacy || !legacyState) {
        return new Response("Invalid state", { status: 400 });
      }
      const { data: legacyUser } = await adminClient
        .from("users")
        .select("whoop_oauth_state")
        .eq("id", userIdLegacy)
        .single();
      if (
        !legacyUser ||
        !legacyUser.whoop_oauth_state ||
        !timingSafeEqual(legacyUser.whoop_oauth_state, legacyState)
      ) {
        return new Response("Invalid state", { status: 403 });
      }
      userId = userIdLegacy;
    } else {
      return new Response("Invalid state", { status: 400 });
    }

    // Exchange code for tokens - use the SAME redirect_uri as was sent in the auth request
    const callbackUrl = `${Deno.env.get("APP_URL") || "https://nbp-portal.vercel.app"}/api/whoop/callback`;

    const tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: Deno.env.get("WHOOP_CLIENT_ID")!,
        client_secret: Deno.env.get("WHOOP_CLIENT_SECRET")!,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenRes.ok) {
      console.error("Token exchange failed");
      return new Response("Token exchange failed", { status: 500 });
    }

    const tokenData = await tokenRes.json();

    // Get WHOOP user ID
    const profileRes = await fetch(`${WHOOP_API_BASE}/user/profile/basic`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      // H7: keep the raw WHOOP response body on the server side (logs) but
      // do NOT echo it to the client — a third-party API error body can
      // include identifiers / rate-limit hints / OAuth-server diagnostics
      // we don't want surfaced to an attacker probing the flow.
      const text = await profileRes.text().catch(() => "");
      console.error("Profile fetch failed", profileRes.status, text);
      return new Response("Profile fetch failed", { status: 500 });
    }

    const profile = await profileRes.json();

    // Encrypt tokens
    const encAccessToken = await encrypt(tokenData.access_token);
    const encRefreshToken = tokenData.refresh_token ? await encrypt(tokenData.refresh_token) : null;

    // Store encrypted tokens
    const { error: upsertErr } = await adminClient.from("whoop_tokens").upsert(
      {
        user_id: userId,
        whoop_user_id: String(profile.user_id),
        encrypted_access_token: encAccessToken,
        encrypted_refresh_token: encRefreshToken,
        token_expires_at: new Date(
          Date.now() + tokenData.expires_in * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (upsertErr) {
      console.error("Token upsert FAILED");
      return new Response("Token storage failed", { status: 500 });
    }

    // Mark user as connected
    const { error: updateErr } = await adminClient
      .from("users")
      .update({ whoop_connected: true, whoop_oauth_state: null })
      .eq("id", userId);

    if (updateErr) {
      console.error("User update failed");
    }

    // Redirect back to the app
    const appUrl = Deno.env.get("APP_URL") || "https://nbp-portal.vercel.app";
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}?whoop_connected=true` },
    });
  } catch (err) {
    console.error("Callback unhandled error");
    return new Response("Callback error", { status: 500 });
  }
});
