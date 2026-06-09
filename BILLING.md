# Billing (design note - not implemented)

Billing is **not built yet** - it needs a Stripe account, API keys, and product/price
setup that live outside this repo. This note records the intended design so the seam
is clear; the [project API-key auth](AUTH.md) already gives the per-tenant boundary it
hangs off.

## The model

Each `Project` (see `AUTH.md`) is the unit of billing. Metering keys off the project
slug that's already stamped on every ticket and resolved on every authenticated API
call, so no new identity is needed.

Likely meters:
- **reports ingested** per project per period (count of `POST /api/reports`)
- **active projects** (seats) for a flat per-project plan
- optionally **artifact storage** (sum of artifact `size`) for heavy users

## Sketch of the integration

1. Add `stripeCustomerId` + `plan` (and optionally `subscriptionId`) to `Project`.
2. On project creation, create a Stripe customer; on plan selection, a subscription.
3. Meter usage:
   - simplest: a periodic job aggregates `Ticket` counts per `projectKey` and reports
     usage to Stripe (metered price), or
   - real-time: increment a usage counter on each authenticated ingest.
4. Enforce limits in `authReports` / `authTickets` - e.g. reject ingest with `402`
   when a project is over its plan / past due. The guard functions in
   `src/paikko/server/auth.ts` are the natural place: they already resolve the
   project on every call.
5. Stripe webhooks (`/api/stripe/webhook`) keep `plan` / dunning state in sync.

## Why it's deferred

- Requires external Stripe credentials and product config (can't be done from the repo).
- The auth layer it depends on is now in place, so adding billing is additive: a few
  `Project` columns, a webhook route, and a check inside the existing auth guards - not
  a re-architecture.
