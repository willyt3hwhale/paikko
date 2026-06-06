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

## 3. Backend trace artifact  ☐
The DO-backed "frontend symptom → backend cause" spine is degraded locally (Durable
Objects don't run under `next dev`). Decide: accept prod-only, or build a local trace
path. Medium value.

## 4. Prod / SaaS hardening  ◐
- ☑ `projectKey` server-side filtering - `GET /api/tickets?projectKey=X` returns one tenant;
  no param = all (back-compat). Store `listHeads`/`listActionable` take an optional key.
- ☑ Configurable CORS allowlist - `PAIKKO_ALLOWED_ORIGINS` (comma-sep); unset/`*` = permissive
  (dev default keeps localhost working), set = reflect only listed origins.
- ☑ Publish-ready `@paikko/contract` + `@paikko/widget` (version/license/files/exports/
  publishConfig, react peerDep) + config docs (READMEs, `.env.example`).
- ☐ Auth / billing - when launching the hosted SaaS.
- ☐ A real DELETE/admin route (cleanup is currently raw D1).

## 5. The "looks wrong" report class  ☐
Half of real reports are visual taste, not logic. Provenance helps; a screenshot /
visual-diff artifact would help more. Future.
