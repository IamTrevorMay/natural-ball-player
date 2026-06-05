// Centralized CORS origin allowlist. Add new deploy origins here.
const ALLOWED_ORIGINS = [
  "https://nbp-portal.vercel.app",
  "https://natural-ball-player.vercel.app",
  "https://www.thenatural-app.com",
  "https://thenatural-app.com",
  "http://localhost:3000",
  "http://localhost:3001",
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
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const previewMatch = /^https:\/\/.*\.vercel\.app$/.test(origin) &&
    origin.includes("nbp-portal");
  const allowed = ALLOWED_ORIGINS.includes(origin) || previewMatch;
  if (!allowed) return { ...BASE_HEADERS };
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin };
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders(req) });
}
