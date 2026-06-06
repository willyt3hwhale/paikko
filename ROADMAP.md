# paikko roadmap

Prioritized next work. Status: ☐ todo · ◐ in progress · ☑ done.

## 1. Wire the provenance plugin  ◐
The differentiator. Reports currently capture a CSS selector but `target.src` /
`target.component` are **null** - the plugin (`packages/widget/build/provenancePlugin.js`)
exists but isn't hooked into the consumer app's build. Goal: rendered elements carry
`data-src="file:line:col"` + `data-paikko-component`, capture reads them, so a click →
`Keypad.tsx:84`, not a grep. Wire into `examples/calculator`'s build (the agent fixes
consumer code, so src must point at consumer files). Retarget/drop the backend
seam-guard `provenance-present` check (provenance is now a consumer concern).

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
