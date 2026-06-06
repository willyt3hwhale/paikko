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

## 2. Drive `/paikko-run` for real  ☐
Loop is shaken down twice by the assistant; the real test is the user invoking
`/paikko-run` in their own Claude Code TUI against `examples/calculator` (their
subscription). Validates the loop end-to-end on a real machine.

## 3. Backend trace artifact  ☐
The DO-backed "frontend symptom → backend cause" spine is degraded locally (Durable
Objects don't run under `next dev`). Decide: accept prod-only, or build a local trace
path. Medium value.

## 4. Prod / SaaS hardening  ☐
- `projectKey` server-side filtering (multi-tenant; the field is persisted but unfiltered).
- CORS allowlist (currently dev-permissive, reflects any origin).
- Publish the packages; bake a configurable backend port default (currently 8787 default,
  overridden to 8788 via `NEXT_PUBLIC_PAIKKO_*` env to dodge a port clash).
- Auth / billing when launching the hosted SaaS.

## 5. The "looks wrong" report class  ☐
Half of real reports are visual taste, not logic. Provenance helps; a screenshot /
visual-diff artifact would help more. Future.
