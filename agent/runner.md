# paikko agent runner (v0)

*The runner is "Claude Code in a loop" - run as a SKILL inside an interactive
Claude Code (TUI) session, NOT a headless `claude -p` script. This file is its
spec - the loop, the sub-agents, the seams it must not cross, and the contract it
speaks. The executable form of this spec is the `/paikko-run` skill at
`.claude/skills/paikko-run/SKILL.md`; this document is the design behind it.*

## Execution model: a TUI skill, not a headless process

The runner is **not** an outside `claude -p` daemon. The user invokes
`/paikko-run` inside their interactive Claude Code session, in the paikko repo,
with the dev server (`npm run preview`) already running. The skill drives the
loop on the user's TUI subscription - a headless `claude -p` script would bill as
API and defeats the point.

The **interactive session IS the main loop.** It polls the ticket queue, pulls
one ticket's bundle, dispatches a fix and a verify, parks the ticket in
`reviewing`, and posts the outcome back into the ticket thread - all through the
same HTTP surface the in-app UI uses. The **main loop never edits code itself**;
it orchestrates. Fixing happens only inside a `fix-agent` sub-agent (spawned via
the Agent tool); verification only inside a `verify-agent` sub-agent. This keeps
the main TUI context small (it carries the head, not diffs and build logs) and
makes each fix a clean, inspectable unit.

The skill processes the queue **until it is empty**, then stops and offers to
re-run (a `/loop` wrapper can re-poll on a cadence). It does not busy-wait; it
does not block on a human (`reviewing` is parked).

---

## Contract

Everything the runner reads or writes is shaped by `@/lib/contract` (see
`src/lib/contract.ts` - read it before touching this loop). Validate every
payload with the matching zod schema; never trust a wire shape.

Types/schemas the runner uses:

- `TicketHead` / `TicketHeadSchema` - tier-1 head, the spine of a ticket in
  context. Fields: `id`, `status` (`TicketStatus`), `createdAt` (`IsoTime`),
  `reporter`, `report` (`Report` = message/kind/route/`target`), `thread`
  (`ThreadMessage[]`), `artifacts` (`ArtifactIndex`).
- `ArtifactIndex` / `ArtifactIndexSchema` - `Partial<Record<ArtifactName,
  ArtifactIndexEntry>>`. Each entry: `ref` (`"GET /tickets/:id/artifacts/:name"`),
  `summary` (one line), `count` (records, null for singletons), `size` (bytes).
- `ArtifactName` / `ArtifactNameSchema` - `console | network | clientState |
  storage | dom | trace`.
- `ArtifactPayloadSchemas[name]` - the zod schema for a fetched payload. Always
  `ArtifactPayloadSchemas[name].parse(payload)` after a fetch.
- `ArtifactPayloadMap[name]` - the decoded payload type for `name`.
- `TraceId` / `TraceIdSchema` - the spine. A frontend `NetworkEntry.traceId`
  equals the backend `TraceRequest.traceId` it triggered: that is how the
  fix-agent walks from "this fetch on the page" to "this handler + these queries
  on the server."
- `TicketStatus` / `TicketStatusSchema` - `open | reproducing | needs_info |
  reviewing | closed`. The runner drives the machine via `PATCH`.
- `ThreadMessage` / `ThreadMessageSchema` - what the runner posts back.

All imports are from `@/lib/contract`. No shape is redefined here.

---

## HTTP surface

Base URL is the running dev server (default `http://localhost:8787`, the
`npm run preview` origin; override if the user gave you another). All ticket
routes are App-Router handlers under `app/api/**` and are therefore wrapped in
`withCapture` (the seam guard enforces this; the runner just consumes them). The
skill issues these as plain `curl` calls - see `.claude/skills/paikko-run/SKILL.md`
for the exact method/path/body of every transition.

| Purpose | Call |
|---|---|
| List open tickets, oldest first | `GET /api/tickets?status=open` |
| Pull one head | `GET /api/tickets/:id` -> `TicketHeadSchema.parse(body)` |
| Fetch an artifact payload | the entry's `ref`, e.g. `GET /api/tickets/:id/artifacts/:name` -> `ArtifactPayloadSchemas[name].parse(body)` |
| Move status | `PATCH /api/tickets/:id` body `{ status }` -> validate against `TicketStatusSchema` |
| Post a thread message | `POST /api/tickets/:id/thread` body `{ by, text }` (server stamps `id`/`at`) |

`status` is a query filter; the list returns an array of `TicketHead` (or a
trimmed head - re-`parse` with `TicketHeadSchema` and tolerate extra fields).
Sort by `createdAt` ascending and take the first if the API does not already
order.

---

## The loop

One pass = one ticket. The loop is deliberately serial in v0 (one ticket fully
handled before the next) so the human reviewing the queue sees a clear,
ordered trail. Parallelism is a v1 concern.

```
loop:
  1. POLL      GET /api/tickets?status=open
               -> parse[]  -> if empty: STOP (report "queue empty", offer re-run)
  2. PICK      oldest by createdAt  -> ticket id T
  3. CLAIM     PATCH /api/tickets/T { status: "reproducing", message }
               (claim early so a second runner / the UI sees it's being worked;
                the same PATCH posts the "picked up" thread note)
  4. PULL      GET /api/tickets/T  -> head = TicketHeadSchema.parse(body)
  5. TRIAGE    read head.report + head.thread + head.artifacts (summaries only).
               Decide which artifacts (if any) the fix needs - see "Artifact
               triage". Most tickets need ZERO fetches.
  6. FETCH     for each needed name: GET entry.ref
               -> ArtifactPayloadSchemas[name].parse(payload)
  7. FIX       spawn fix-agent (sub-agent via the Agent tool) with the head +
               fetched payloads. It patches app/calc/**. Main context never edits.
  8. VERIFY    spawn verify-agent (sub-agent). It reviews the diff, runs
               `npm run lint:seams` + `npx tsc --noEmit`, and judges correctness.
               -> outcome: pass | needs_info | reject(reason)
  9. ROUTE     pass        -> PATCH status: "reviewing" + summary msg (PARKED)
               needs_info  -> PATCH status: "needs_info" + concrete question
               reject      -> re-dispatch fix-agent (bounded retries); if still
                              failing, route needs_info and move on
 10. NEXT      continue loop (the ticket is now parked in "reviewing" or
               "needs_info"; the loop never blocks waiting on a human)
STOP when the queue is empty.
```

`MAX_FIX_RETRIES` default 2 (step 9 reject path). There is no `POLL_INTERVAL`
sleep: the skill processes until the queue is empty and stops. To re-poll for
newly-filed tickets, the user re-invokes `/paikko-run` (optionally under `/loop`
on a cadence) - it does not busy-wait inside one invocation.

### Why claim before pull

Step 3 (`reproducing`) happens before step 4 so the queue is honest the instant
a runner takes a ticket: anyone watching the in-app board sees it leave `open`.
If the runner dies mid-pass the ticket is stuck in `reproducing` and a sweep can
reset it - acceptable for v0.

---

## Artifact triage (the cheap-context rule)

The head is **decision-complete by design**: each artifact carries a `summary`,
`count`, and `size` so the runner decides *from the head alone* whether to spend
context on the payload. Do not fetch reflexively.

Heuristics:

- **Always free**: `report.message`, `report.kind`, `report.route`,
  `report.target` (selector + `src` + component). A target `src` often points
  the fix-agent straight at the file - many tickets are solved from this alone,
  zero fetches.
- **Fetch `console`** only if the report mentions an error/crash/exception, or a
  `console` summary shows `error`-level lines.
- **Fetch `network`** if the bug is about a request/response, a wrong value from
  the server, or a failed call. The `network` payload gives you `traceId`s.
- **Fetch `trace`** when `network` (or the report) implicates the backend: take
  the failing `NetworkEntry.traceId` and find the `TraceRequest` with the same
  `traceId` - that is the handler + its `queries` (+ `threw`). The spine is the
  whole point; use it instead of guessing the handler.
- **Fetch `clientState`** for "wrong value on screen / stale UI" bugs - it is the
  snapshot of the mandated store at report time.
- **Fetch `dom`** only for layout/visual/structure bugs where the serialized HTML
  + `targetSelector` matter.
- **Fetch `storage`** for auth/session/persistence bugs (tokens, flags, cookies).

Pass only the fetched payloads into the fix-agent. Never dump all six.

---

## Sub-agents

The main TUI loop is a dispatcher. It holds the head and the routing decisions;
it spawns two sub-agents (via the Agent tool) per ticket and consumes their
structured results. Keeping the work in sub-agents is what keeps the main context
from filling with diffs and build logs over a long queue.

### fix-agent (sub)

**Input**: the `TicketHead` + exactly the artifact payloads triage selected.
**Job**: reproduce mentally from the bundle, then patch the calculator code under
`app/calc/**` in the working tree.
**Must**:
- Treat artifacts as a *photograph* - immutable repro state, not a live system.
  Do not re-fetch or assume current state differs.
- Follow the `traceId` spine from a `NetworkEntry` to its `TraceRequest` rather
  than guessing which handler ran.
- Use `target.src` / `TraceRequest.src` / `TraceQuery.src` provenance to land in
  the right file:line.
- **Respect every mandated seam.** New API handlers go through `withCapture`.
  New client app/domain state goes into the one mandated zustand store - never a
  second store, Redux, or a context-as-store. Never strip the provenance plugin.
  (The seam guard will fail the build otherwise; do not fight it.)
- Keep the diff minimal and scoped to the ticket. No drive-by refactors.
**Output**: a short summary of the change and which files it touched. No status
changes, no thread posts - those are the main loop's job.

### verify-agent (sub)

**Input**: the ticket head + the fix-agent's diff.
**Job**: judge whether the fix is correct and seam-clean. This is the LLM
counterpart to the seam guard: the **guard is mechanical and binary** (did a seam
get bypassed - yes/no), the **verify-agent judges correctness** (does this
actually fix the reported bug without regressing). They are deliberately distinct
and both must be satisfied.
**Must**:
- Run `npm run lint:seams` and **treat a non-zero exit as a hard reject** - a
  seam was bypassed; bounce it back to fix-agent with the guard's output.
- Type-check (`npx tsc --noEmit`); a failure is a reject.
- Re-read the report and confirm the diff plausibly addresses *that* bug, not a
  different one.
- If the bundle is insufficient to know the fix is right (missing repro detail),
  return `needs_info` with a concrete question rather than guessing.
**Output**: `pass` | `needs_info(question)` | `reject(reason)`. Nothing else
mutates state.

---

## Reviewing the fix

On a `pass`, the fix is in the working tree under `app/calc/**`. The runner flips
the ticket to `reviewing` and posts a change summary telling the human how to see
it: rebuild/refresh the calculator and re-test, then Accept or Reject from the
in-app review UI. v0 reviews the running local build (the same `npm run preview`
dev server the runner talks to); a per-deploy preview URL is a v1 concern. The
thread message is the click-through from the in-app board.

---

## Status transitions (what the runner writes)

The runner only ever drives these edges (mirror of the README state machine):

- `open` -> `reproducing` - on claim (step 3).
- `reproducing` -> `needs_info` - repro/verify could not proceed; a question is
  posted. Parked; the loop moves on.
- `reproducing` -> `reviewing` - fix passed verify (`tsc --noEmit` +
  `lint:seams` both clean). **Parked, non-blocking**: the runner does NOT wait
  for the human. It posts the change summary + how to re-test, then continues to
  the next ticket.

The runner never writes `closed`. Accept/verify-to-close and reject are
**human** actions taken from the in-app UI:

- **accept** -> the app runs its verify-to-close path -> `closed`.
- **reject + comment** -> the rejection and the reviewer's comment land in the
  ticket `thread`, and the ticket re-enters the queue for the fix path.

---

## Rejected tickets re-enter with full thread history

A rejected ticket is **not** a fresh ticket. It comes back carrying its entire
`thread` - the original report, the runner's prior change summary, and the
reviewer's rejection comment - so the next fix attempt sees exactly why the last
one was wrong. When the runner picks up a ticket whose `thread` already contains a
prior agent message and a reviewer rejection:

- Feed the **whole** `thread` into the fix-agent, not just the latest message.
  The rejection comment is the most important signal for the retry.
- Do not repeat the rejected approach; the thread is the memory that prevents a
  loop of the same wrong fix.
- The work continues in the same working tree; the human re-reviews the rebuilt
  calculator after the new fix lands.

This is why the head carries the full `thread` and not just the head fields: the
conversation *is* the agent's working memory across review cycles.

---

## Thread message conventions

When the runner posts (step 10), `by: "agent"`, and keep `text` minimal and
human-readable (no raw instruction text, no internal IDs beyond the preview link):

- on `reviewing`: a one/two-line change summary + the preview URL.
- on `needs_info`: a single concrete question.
- on retry after reject: a brief note of what changed vs. the rejected attempt.

The server stamps `id` and `at`; the runner sends only `{ by, text }`.

---

## Invariants (do not break)

1. **Main context never edits code.** Only `fix-agent` patches. The loop
   orchestrates and posts.
2. **Validate every wire payload** with the contract's zod schema before use.
3. **Run as a TUI skill, not headless.** `/paikko-run` drives the loop inside the
   interactive session; never a `claude -p` daemon.
4. **`reviewing` is parked and non-blocking** - never wait on a human inside the
   loop.
5. **Seams are sacred.** A `lint:seams` failure is a hard stop for that fix; the
   runner does not park a seam-breaking fix in `reviewing`. Never flip to
   `reviewing` unless `tsc --noEmit` and `lint:seams` both pass clean.
6. **Triage before fetch.** Default to zero artifact fetches; pull only what the
   summary says the fix needs.
