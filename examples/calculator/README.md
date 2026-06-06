# @paikko/calculator (example consumer)

A plain Next 15 calculator that mounts the paikko widget (`@paikko/widget`) and
reports to the paikko backend. It is the reference for how a real consumer app
wires the widget: mount `<PaikkoProvider>`, point it at the backend, stamp a
`projectKey`, and hand it the app's own store reader so captured reports include
live client state.

## Configuration

The widget is configured through `NEXT_PUBLIC_*` env vars read by
`app/PaikkoMount.tsx`. Copy the example and adjust if needed:

```bash
cp .env.example .env.local
```

See `.env.example` for the three vars:

- `NEXT_PUBLIC_PAIKKO_ENDPOINT` - backend reports intake URL
- `NEXT_PUBLIC_PAIKKO_TICKETS_URL` - backend review queue URL
- `NEXT_PUBLIC_PAIKKO_PROJECT_KEY` - tenant key stamped on every report

For this local setup the backend is on `http://localhost:8788` and the
calculator is on `http://localhost:3000`.

## Running against the backend

Two `next dev` processes, one per app.

1. Start the backend on port 8788 (from `packages/backend`):

   ```bash
   npm run dev -- -p 8788
   ```

   This serves the API (`/api/reports`, `/api/tickets`) and the `/tickets`
   review UI. Visiting `/` redirects to `/tickets`.

2. Start this calculator on port 3000 (from `examples/calculator`):

   ```bash
   npm run dev
   ```

   `next dev` defaults to port 3000. Make sure `.env.local` (or `.env.example`'s
   defaults) point the widget at the backend on `:8788`.

3. Open http://localhost:3000, use the calculator, and file a report with the
   floating paikko button.

## Report flow

When you file a report, the widget captures the DOM, storage, provenance, and
the calculator's client state, then POSTs a contract-valid `ReportBundle`
**cross-origin** from `:3000` to the backend's `/api/reports` on `:8788`. Each
bundle carries `projectKey="calculator-demo"`. The report then shows up in the
backend's `/tickets` review UI (linked from the widget's nav pill), filtered to
this project's tenant.

## Provenance plugin

Capture relies on the widget's provenance babel plugin, wired in `.babelrc`:

```json
{
  "presets": ["next/babel"],
  "plugins": [
    ["../../packages/widget/src/build/provenancePlugin.cjs", { "rootDir": "." }]
  ]
}
```

(A published consumer would reference it as the `@paikko/widget/build/provenancePlugin`
package subpath instead of the monorepo relative path.)
