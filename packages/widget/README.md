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
| `ticketsUrl`     | `string`                           | no       | Absolute URL of the backend review queue. Renders a nav pill linking to it; omit to hide the pill. |
| `getClientState` | `() => Record<string, unknown>`    | no       | Reader for your app's client state, snapshotted at report time. Pass your store's `getState` (or equivalent). Omit and client state is captured as `{}`. |
| `reporter`       | `string`                           | no       | Who is filing the report. Defaults to `"anonymous"`. |

`PaikkoProvider` is the default export and also a named export. `ReportButton`,
`PaikkoNav`, and the capture primitives are exported individually for hosts that
want to compose the pieces themselves.

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
above.
