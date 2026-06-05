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

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");

    if (!code || !stateParam) {
      return new Response("Missing code or state", { status: 400 });
    }

    const [userId, state] = stateParam.split(":");
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate state
    const { data: user, error: userErr } = await adminClient
      .from("users")
      .select("whoop_oauth_state")
      .eq("id", userId)
      .single();

    if (userErr) {
      console.error("State lookup error");
      return new Response("State lookup failed", { status: 500 });
    }

    if (!user || user.whoop_oauth_state !== state) {
      console.error("State mismatch");
      return new Response("Invalid state", { status: 403 });
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
      const text = await profileRes.text();
      console.error("Profile fetch failed");
      return new Response(`Profile fetch failed: ${text}`, { status: 500 });
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
