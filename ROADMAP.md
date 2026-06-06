# paikko roadmap

Prioritized next work. Status: ☐ todo · ◐ in progress · ☑ done.

## 1. Wire the provenance plugin  ☑
The differentiator - DONE. A Babel `.babelrc` in `examples/calculator` loads the
provenance plugin (`packages/widget/src/build/provenancePlugin.cjs`), injecting
`data-src="<path>:<line>:<col>"` (repo-relative to the consumer app) + `data-paikko-component`
onto rendered JSX. Capture reads them, so a point-click now yields e.g.
`app/calc/Key.tsx:37:5` + component `Key` instead of null. Works in dev AND build (reads
AST `node.loc`, not React `__source`). Seam-guard's `provenance-present` retargeted to the
consumer app. (Note: `.babelrc` opts the example off SWC - fine for a demo.)

## 2. Drive `/paikko-run` for real  ☑
Ran a full loop pass WITH provenance: report on the AC key → `target.src =
app/calc/Key.tsx:37:5` → fix-agent opened that file directly (no grep), added a
`danger` variant, scoped the AC key red → accept → merge → verified live. Provenance
materially helped (saved a multi-file grep to the component). Loop + provenance compose.
(Still worth the user invoking `/paikko-run` in their own TUI as the real-world test.)

## 3. Backend trace artifact  ☑
Replaced the Durable-Object buffer with a **D1-backed trace buffer** (`TraceEntry` table,
migration 0004): `withCapture` appends each traced request, the reports route drains at
report time. Works under `next dev` (where DOs don't) AND prod (D1 is everywhere) - simpler
than the DO. Verified: a session's `GET /api/tickets` (200) + `:id` (404) buffer, then a
report drains them into a real `trace` artifact with `src` provenance. The DO is now legacy
dead code (kept so the Workers build doesn't break) - a cleanup pass should remove the
`SESSION_TRACE` binding from wrangler.jsonc/worker.ts/db.ts and rename the misnamed helpers.

## 4. Prod / SaaS hardening  ◐
- ☑ `projectKey` server-side filtering - `GET /api/tickets?projectKey=X` returns one tenant;
  no param = all (back-compat). Store `listHeads`/`listActionable` take an optional key.
- ☑ Configurable CORS allowlist - `PAIKKO_ALLOWED_ORIGINS` (comma-sep); unset/`*` = permissive
  (dev default keeps localhost working), set = reflect only listed origins.
- ☑ Publish-ready `@paikko/contract` + `@paikko/widget` (version/license/files/exports/
  publishConfig, react peerDep) + config docs (READMEs, `.env.example`).
- ☐ Auth / billing - when launching the hosted SaaS.
- ☐ A real DELETE/admin route (cleanup is currently raw D1).

## 5. The "looks wrong" report class  ☑
Added a **screenshot artifact**: the widget captures the page via `html2canvas` (lazy
dynamic import, longest side capped to 1280px, JPEG q0.7, ~26KB for the calc), excluding
the paikko UI (`ignoreElements [data-paikko-ui]`) so the shot is what the user saw. Stored
as the `screenshot` artifact; the review UI renders it as an `<img>`. Now the agent (which
sees images) and the human reviewer can directly see visual/taste reports. Best-effort -
a capture failure never blocks the report. (Inline base64 in D1/the bundle is fine at this
size; very large pages could want blob storage with a ref - future.)

## Tidy-up (known follow-ups, non-blocking)
- ☐ Remove the now-dead SessionTrace **Durable Object** fully (binding in wrangler.jsonc,
  worker.ts export, db.ts type aug) and rename the misnamed `*SessionDO` helpers (they hit D1).
- ☑ `@paikko/contract` builds `dist` on install (`prepare`) so fresh clones resolve it.
- ☐ Bake a committed default backend port (currently 8787 in code, 8788 via env locally).
- ☐ A real DELETE/admin API route (test cleanup is raw D1 today).
