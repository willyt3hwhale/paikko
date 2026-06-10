# Auth

paikko is **authenticated by default** and gates every surface: report intake, the
programmatic ticket API, and the review dashboard. There is one escape hatch for
local single-tenant development - `PAIKKO_AUTH=disabled` - which turns the auth
checks into no-ops (used by the bundled `examples/calculator` demo). Any other
value, or leaving it unset, means auth is enforced.

## Credentials

Three credentials, one per caller shape:

| Caller | Credential | Where it lives | Grants |
|--------|-----------|----------------|--------|
| **report widget** (browser) | publishable key `pk_` (`x-paikko-key`) | client JS | create reports for its project only |
| **runner / review API** (server) | secret key `sk_` (`Authorization: Bearer`) | server-side | read/patch/delete its project's tickets |
| **review dashboard** (browser) | operator HTTP Basic login | the operator's browser | full, cross-tenant dashboard access |

Why three: the dashboard runs in a browser and therefore cannot hold the `sk_`
secret (anything in client JS is public). So the operator authenticates with HTTP
Basic; the gate covers both the `/tickets` pages and the same-origin `/api/tickets/*`
calls the dashboard makes, so the browser carries the Basic credentials to both.
The runner keeps using its `sk_` bearer, which passes through the dashboard gate
untouched and is validated by the route.

The publishable key is **not secret** - its abuse surface is bounded by the CORS
origin allowlist (`PAIKKO_ALLOWED_ORIGINS`). The secret key is stored **only as a
SHA-256 hash**; the plaintext is shown once at creation. The operator password is
read from env and compared by hash.

When auth is enforced, a report's `projectKey` is taken from the **authenticated
publishable key**, not from anything the client sends - a key can only file for its
own tenant. Cross-tenant ticket access returns `404` (existence is never leaked).

## Configure

```bash
# backend env
# (auth is ON by default; set PAIKKO_AUTH=disabled only for local dev)
PAIKKO_DASHBOARD_PASSWORD=<a long random secret>  # operator dashboard login
PAIKKO_DASHBOARD_USER=admin                        # optional, defaults to "admin"
PAIKKO_ADMIN_TOKEN=<a long random secret>          # enables POST /api/projects
PAIKKO_ALLOWED_ORIGINS=https://app.example.com     # REQUIRED for cross-origin widgets
```

> **CORS fails closed under enforced auth.** With auth on and no
> `PAIKKO_ALLOWED_ORIGINS` set, the backend will not reflect arbitrary origins
> (same-origin only). A cross-origin widget therefore requires its origin to be
> listed - this is deliberate, so enabling auth can't silently leave the public-key
> path open to any site.

> **The dashboard fails closed too.** With auth on and no
> `PAIKKO_DASHBOARD_PASSWORD` set, `/tickets` returns `401` rather than exposing the
> queue.

## Provision a project

`POST /api/projects` is the admin endpoint, **disabled (404)** unless
`PAIKKO_ADMIN_TOKEN` is set, then requires that token as a bearer:

```bash
curl -X POST https://paikko.example.com/api/projects \
  -H "authorization: Bearer $PAIKKO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"slug":"my-app","name":"My App"}'
# -> 201 { project, publishableKey: "pk_...", secretKey: "sk_...", note }
```

## Use the credentials

**Widget** (browser) - pass the publishable key:

```tsx
<PaikkoProvider endpoint="https://paikko.example.com/api/reports" apiKey="pk_..." />
```

**Runner / review API** (server) - send the secret key as a bearer:

```bash
curl https://paikko.example.com/api/tickets -H "authorization: Bearer sk_..."
```

**Dashboard** - open `https://paikko.example.com/tickets`; the browser prompts for
the operator login (`PAIKKO_DASHBOARD_USER` / `PAIKKO_DASHBOARD_PASSWORD`).

## What's protected

| Surface | Auth (enforced; the default) |
|---------|------------------------------|
| `POST /api/reports` | publishable key (`x-paikko-key`) -> stamps the project's slug |
| `GET /api/tickets`, `GET/PATCH/DELETE /api/tickets/:id` | secret key (tenant, scoped) **or** operator Basic (full) |
| `GET /api/tickets/:id/artifacts/:name`, `POST /api/tickets/:id/thread` | secret key (scoped) **or** operator Basic |
| `/tickets`, `/tickets/:id` (dashboard) | operator Basic (middleware gate) |
| `POST /api/projects` | `PAIKKO_ADMIN_TOKEN` bearer |

See also [BILLING.md](BILLING.md) for how per-project metering builds on this.
