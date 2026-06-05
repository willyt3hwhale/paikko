# paikko

*Point at the bug. The agent fixes it.*

A web framework for AI coding that flips the loop: instead of describing bugs to an
agent from the outside, you **use the app like a user**, hit a report button the moment
something's wrong, and the report - with full app state attached - lands in a ticket
queue the agent works through.

The agent doesn't live in the app. The **feedback loop** does: report, review, accept
or reject, all from inside the running app.

## Thesis

Current AI coding (Lovable, v0, Claude Code, etc.) is outside-in: you see a problem in
the running app, switch to a chat, describe it from memory, the agent guesses. Context
is lost at the point of pain.

vibend captures context **at the point of pain**. The report button fires from inside
the app and bundles exact repro state - route, the DOM element you clicked, console,
network, client state, and a backend trace. The agent gets ground truth, not prose.

## Core pieces (v0)

1. **`<ReportButton>`** - captures route, DOM-click provenance (`data-src`), console
   ring buffer, last N network calls, client state, storage. Snapshot at click time.
2. **Mandated seams** - router, API handler wrapper (`withCapture()`), state store, and
   build-time provenance plugin. Only these are forced; everything else the agent does
   freely. The seams are what make capture *total* instead of best-effort.
3. **Ticket state machine** - the report/review loop, all through the in-app UI:
   ```
   open -> agent reproducing -> { repro failed -> needs-info }
                             -> fix proposed -> reviewing (parked, non-blocking)
                                             -> { accepted -> verify -> closed }
                                             -> { rejected + comment -> back to fix }
   ```
4. **Agent runner** - Claude Code in a loop. Polls for open tickets, pulls the bundle,
   fix-agent patches, verify-agent checks, opens a preview-per-ticket, posts back.
5. **CI seam guard** - mechanical check that fails if seams are bypassed (raw route
   handlers, state outside the store, provenance plugin stripped). Holds the line the
   prompt won't hold over 50 tickets.

## Stack

Wrapping a proven stack, not building our own - building the whole stack means debugging
the debugger. **Next.js + Prisma**, mandated state store, SWC/Babel provenance plugin.
Picked for the huge agent training base: the agent already knows Next, so it won't fight
the architecture. Drift is enemy #1; familiarity is the cheapest defense.

## The ticket bundle (the core contract)

Two-tier. The **head** loads into agent context every time; **artifacts** sit behind
refs the agent fetches only when a fix needs them. Each artifact carries a `summary` so
the agent decides from the head whether to fetch - most tickets solve with zero fetches.

Head: id, status, the user message, route, clicked-element provenance, thread, and an
artifacts index (ref + summary each). Artifacts (fetched by ref): console, network,
client state, storage, DOM snapshot, backend trace.

`traceId` stitches a frontend network entry to its backend handler + queries.
`src` appears on every layer (clicked element, API handler, each query) - provenance
end to end. Artifacts are **immutable**, captured once at report time - a photograph,
not a live window. Storage v0: JSONB rows keyed by ticket+name, served at
`GET /tickets/:id/artifacts/:name`.

## Roadmap

- **v0**: capture widget, 4 mandated seams, ticket state machine, Claude Code loop, CI guard.
- **v1+**: replay-on-fix (recorded session becomes a regression test), record/bug-hunt
  session mode, normal-user reports (queued, not auto-acted), mobile/field reporting.
