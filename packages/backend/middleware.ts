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
import { verifyOperatorBasic } from "@/paikko/server/operatorAuth";

export const config = {
  matcher: ["/tickets/:path*", "/api/tickets/:path*"],
};

function challenge(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="paikko", charset="UTF-8"' },
  });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // Auth off -> dev, no gate.
  if (process.env.PAIKKO_AUTH === "disabled") return NextResponse.next();

  // CORS preflight carries no credentials; let it answer before any auth.
  if (req.method === "OPTIONS") return NextResponse.next();

  const header = (req.headers.get("authorization") ?? "").trim();

  // The runner / programmatic clients use a secret key; let Bearer through so the
  // route's authTickets validates it (and scopes to the tenant).
  if (/^Bearer\s+/i.test(header)) return NextResponse.next();

  // Everything else must present the operator Basic credentials. Uses the shared
  // constant-time hashed compare (operatorAuth) - same check as the route layer,
  // edge-safe (no Prisma). Fails closed when no dashboard login is configured.
  if (await verifyOperatorBasic(header)) return NextResponse.next();
  return challenge();
}
