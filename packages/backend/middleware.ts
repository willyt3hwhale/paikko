/**
 * Edge gate for the review dashboard.
 *
 * The dashboard (`/tickets`, `/tickets/:id`) runs in the operator's browser and
 * cannot hold a secret key, so it authenticates with HTTP Basic. This middleware
 * challenges those pages AND the same-origin ticket API the dashboard calls
 * (`/api/tickets/*`), so once the operator authenticates for the page the browser
 * carries the Basic credentials to the API fetches too.
 *
 * It deliberately does NOT gate `/api/reports` (the widget POSTs there
 * cross-origin with its publishable key) and lets `Authorization: Bearer ...`
 * through untouched so the runner's secret-key calls reach the route's own auth.
 *
 * Disabled only by `PAIKKO_AUTH=disabled` (the local dev escape hatch). With auth
 * on but no `PAIKKO_DASHBOARD_PASSWORD` configured, the dashboard fails closed.
 */

import { NextResponse, type NextRequest } from "next/server";

export const config = {
  matcher: ["/tickets/:path*", "/api/tickets/:path*"],
};

function challenge(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="paikko", charset="UTF-8"' },
  });
}

export function middleware(req: NextRequest): NextResponse {
  // Auth off -> dev, no gate.
  if (process.env.PAIKKO_AUTH === "disabled") return NextResponse.next();

  // CORS preflight carries no credentials; let it answer before any auth.
  if (req.method === "OPTIONS") return NextResponse.next();

  const header = (req.headers.get("authorization") ?? "").trim();

  // The runner / programmatic clients use a secret key; let Bearer through so the
  // route's authTickets validates it (and scopes to the tenant).
  if (/^Bearer\s+/i.test(header)) return NextResponse.next();

  // Everything else must present the operator Basic credentials.
  const pass = process.env.PAIKKO_DASHBOARD_PASSWORD;
  if (!pass) return challenge(); // fail closed: dashboard login not configured
  const user = process.env.PAIKKO_DASHBOARD_USER || "admin";

  const m = /^Basic\s+(.+)$/i.exec(header);
  if (!m) return challenge();
  let decoded: string;
  try {
    decoded = atob(m[1]);
  } catch {
    return challenge();
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return challenge();
  if (decoded.slice(0, idx) !== user || decoded.slice(idx + 1) !== pass) {
    return challenge();
  }
  return NextResponse.next();
}
