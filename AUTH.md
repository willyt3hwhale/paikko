# Auth (project API keys)

paikko ships **single-tenant and unauthenticated by default** - the zero-config
dev/demo mode. Turn on multi-tenant API-key auth by setting `PAIKKO_AUTH=required`
on the backend. Nothing else changes for an existing single-tenant deployment that
leaves it unset.

## The two keys (per project)

Stripe/Sentry-style key pair, minted together:

| Key | Prefix | Where it lives | Grants |
|-----|--------|----------------|--------|
| **publishable** | `pk_` | the browser widget (`apiKey` prop) | create reports for this project only |
| **secret** | `sk_` | the runner / review API (server-side) | read/patch/delete this project's tickets |

The publishable key is **not secret** - it ships in client JS. Its abuse surface is
bounded by the CORS origin allowlist (`PAIKKO_ALLOWED_ORIGINS`), so lock that down in
production. The secret key is stored **only as a SHA-256 hash**; the plaintext is
shown once at creation and never again.

When auth is enforced, the report's `projectKey` is taken from the **authenticated
publishable key**, not from anything the client sends - a key can only file for its
own tenant. Cross-tenant ticket access returns `404` (existence is never leaked).

## Enable it

```bash
# backend env
PAIKKO_AUTH=required
PAIKKO_ADMIN_TOKEN=<a long random secret>     # enables POST /api/projects
PAIKKO_ALLOWED_ORIGINS=https://app.example.com # lock CORS down in prod
```

## Provision a project

`POST /api/projects` is the admin endpoint. It's **disabled (404)** unless
`PAIKKO_ADMIN_TOKEN` is set, and then requires that token as a bearer:

```bash
curl -X POST https://paikko.example.com/api/projects \
  -H "authorization: Bearer $PAIKKO_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"slug":"my-app","name":"My App"}'
# -> 201
# {
#   "project": { "id": "...", "slug": "my-app", "name": "My App" },
#   "publishableKey": "pk_...",   # -> widget
#   "secretKey": "sk_...",        # -> runner / review API (store now, shown once)
#   "note": "Store the secretKey now - it is not retrievable later."
# }
```

## Use the keys

**Widget** (browser) - pass the publishable key:

```tsx
<PaikkoProvider
  endpoint="https://paikko.example.com/api/reports"
  apiKey="pk_..."          // publishable; sent as x-paikko-key
  /* ... */
/>
```

**Runner / review API** (server-side) - send the secret key as a bearer:

```bash
curl https://paikko.example.com/api/tickets \
  -H "authorization: Bearer sk_..."
```

## What's protected

| Surface | Auth when `PAIKKO_AUTH=required` |
|---------|----------------------------------|
| `POST /api/reports` | publishable key (`x-paikko-key`) -> stamps the project's slug |
| `GET /api/tickets`, `GET/PATCH/DELETE /api/tickets/:id` | secret key (`Authorization: Bearer sk_...`), scoped to the project |
| `GET /api/tickets/:id/artifacts/:name`, `POST /api/tickets/:id/thread` | secret key, scoped |
| `POST /api/projects` | `PAIKKO_ADMIN_TOKEN` bearer |

> **The review UI (`/tickets`, `/tickets/:id`) is server-rendered and reads the
> store directly** - it is not behind the API-key check. For a multi-tenant hosted
> deployment, put the dashboard behind your own operator login / proxy. The API-key
> auth here protects the programmatic surface (widget intake + the runner).

See also [BILLING.md](BILLING.md) for how per-project metering builds on this.
