// Centralized CORS origin allowlist. Add new deploy origins here.
const ALLOWED_ORIGINS = [
  "https://nbp-portal.vercel.app",
  "https://natural-ball-player.vercel.app",
  "https://www.thenatural-app.com",
  "https://thenatural-app.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3100",
];

const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

// Returns CORS headers reflecting the request Origin if allowed.
// Unknown / missing origin -> no Allow-Origin header (browser blocks the response).
//
// Preview match must use a strict pattern: hostname must START with
// `nbp-portal-` (Vercel preview deployments) and END with `.vercel.app`. The
// previous `.includes("nbp-portal")` substring match was satisfied by any
// attacker-controlled subdomain containing the literal "nbp-portal".
const VERCEL_PREVIEW_RE = /^https:\/\/nbp-portal-[a-z0-9-]+\.vercel\.app$/i;

// True if `origin` (scheme+host, e.g. "https://nbp-portal.vercel.app") is a
// trusted app origin. Use to validate client-supplied redirect targets.
export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RE.test(origin);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const previewMatch = VERCEL_PREVIEW_RE.test(origin);
  const allowed = ALLOWED_ORIGINS.includes(origin) || previewMatch;
  if (!allowed) return { ...BASE_HEADERS };
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin };
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders(req) });
}
