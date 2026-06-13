# @paikko/widget

The consumer-installable paikko report widget. Mount it once in your app and
users get a floating report button that captures the DOM, storage, client state,
and provenance of what they were looking at, then POSTs a contract-valid
`ReportBundle` to your paikko backend.

The widget is backend-agnostic and store-agnostic: you configure where reports
go (`endpoint`), which tenant they belong to (`projectKey`), where the review
queue lives (`ticketsUrl`), and how to read your app's state (`getClientState`).

## Install

```bash
npm install @paikko/widget @paikko/contract react
```

`react` is a peer dependency (>= 18.3.1). `@paikko/contract` carries the shared
wire types/zod schemas and is required.

> The widget ships raw TS/TSX source (its `exports` point at `./src`). With
> Next.js, add it to `transpilePackages` so the host build transpiles it:
>
> ```js
> // next.config.js
> module.exports = { transpilePackages: ["@paikko/widget", "@paikko/contract"] };
> ```

## Usage

Mount `<PaikkoProvider>` once, typically inside a `"use client"` island near the
root of your app (the function-valued `getClientState` prop cannot cross the
server/client boundary, so it must live in a client module):

```tsx
"use client";
import { PaikkoProvider } from "@paikko/widget";
import { getState } from "@/lib/store";

export function PaikkoMount() {
  return (
    <PaikkoProvider
      endpoint="http://localhost:8788/api/reports"
      projectKey="my-app"
      ticketsUrl="http://localhost:8788/tickets"
      getClientState={getState}
      reporter="anonymous"
    />
  );
}
```

### `<PaikkoProvider>` props

| Prop             | Type                               | Required | Description |
|------------------|------------------------------------|----------|-------------|
| `endpoint`       | `string`                           | yes      | Backend reports intake URL the bundle is POSTed to. May be cross-origin. |
| `projectKey`     | `string \| null`                   | no       | Project/tenant key stamped onto every report (SaaS seam). Defaults to `null`. |
| `apiKey`         | `string`                           | no       | Project **publishable** key (`pk_...`), sent as `x-paikko-key`. Required whenever the backend enforces auth (the default; off only with `PAIKKO_AUTH=disabled`). Public - never pass a secret key (`sk_...`). See the repo's `AUTH.md`. |
| `ticketsUrl`     | `string`                           | no       | Absolute URL of the backend review queue. Renders a nav pill linking to it; omit to hide the pill. |
| `getClientState` | `() => Record<string, unknown>`    | no       | Reader for your app's client state, snapshotted at report time. Pass your store's `getState` (or equivalent). Omit and client state is captured as `{}`. |
| `reporter`       | `string`                           | no       | Who is filing the report. Defaults to `"anonymous"`. |
| `enabled`        | `boolean`                          | no       | Whether to mount at all. **Defaults to dev-only** (`NODE_ENV !== "production"`), so the pills never ship to real users. Pass `true`/`false` to force it. |

`PaikkoProvider` is the default export and also a named export. `ReportButton`,
`PaikkoNav`, and the capture primitives are exported individually for hosts that
want to compose the pieces themselves.

## Environment & production (read this before deploying)

paikko is a development/internal tool. Both the widget and the provenance plugin
default to **dev-only** so nothing leaks into a production deploy, but there are
two footguns worth knowing:

- **Widget rendering.** `<PaikkoProvider>` renders only when `NODE_ENV !==
  "production"` unless you pass `enabled`. To gate it from an env file, drive the
  prop explicitly and put the flag in `.env.development` (loaded only by `next
  dev`), **not** `.env.local` - Next loads `.env.local` in production builds too,
  so a "dev" flag there silently enables the widget in prod:

  ```tsx
  <PaikkoProvider
    enabled={process.env.NEXT_PUBLIC_PAIKKO_ENABLED === "true"}
    endpoint="https://paikko.example.com/api/reports"
    /* ... */
  />
  ```

- **Provenance attributes.** The babel plugin no-ops when `NODE_ENV ===
  "production"` by default, so `data-src` source paths never ship in prod HTML.
  A JSON `.babelrc` cannot read env vars; if you need to force it on/off, use a
  `.babelrc.js` and pass `{ enabled: process.env.NEXT_PUBLIC_PAIKKO_ENABLED ===
  "true" }`. Clear `.next` / `node_modules/.cache` after changing this - a stale
  babel cache keeps the old behavior.

- **Cross-origin requests are safe.** The capture layer injects its
  `x-paikko-trace` / `x-paikko-session` headers only on **same-origin** fetch/XHR
  calls. Cross-origin requests (third-party CDNs, wasm, media) are still recorded
  but their headers are left untouched, so paikko never trips a CORS preflight on
  someone else's endpoint.

## Provenance babel plugin (required)

The widget's capture relies on a babel plugin that stamps source provenance onto
your components at build time. Wire it into the consumer's babel config:

- Plugin: `@paikko/widget/build/provenancePlugin`
  (`packages/widget/src/build/provenancePlugin.cjs`)
- Reference config: `examples/calculator/.babelrc`

```json
// .babelrc
{
  "presets": ["next/babel"],
  "plugins": [
    ["@paikko/widget/build/provenancePlugin", { "rootDir": "." }]
  ]
}
```

The `examples/calculator` app references the plugin by relative path
(`../../packages/widget/src/build/provenancePlugin.cjs`) because it runs from
inside this monorepo; a published consumer would use the package subpath shown
above. The subpath resolves via the package `exports` map to
`./src/build/provenancePlugin.cjs` (there is no literal `build/` dir); if your
toolchain doesn't honor the exports map, fall back to the explicit path
`./node_modules/@paikko/widget/src/build/provenancePlugin.cjs`.

The plugin no-ops in production by default (see **Environment & production**), so
the plain JSON `.babelrc` above is safe to commit - it emits provenance in dev
and strips it from prod builds automatically.
