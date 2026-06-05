# paikko agent runner (v0)

*The runner is "Claude Code in a loop" - run as a SKILL inside an interactive
Claude Code (TUI) session, NOT a headless `claude -p` script. This file is its
spec - the loop, the seams it must not cross, and the contract it speaks. The
executable form of this spec is the `/paikko-run` skill at
`.claude/skills/paikko-run/SKILL.md`; this document is the design behind it.*

## Monorepo: framework vs consumer

paikko is an npm-workspaces **monorepo**. The **framework** lives in `packages/*`:

- `packages/contract` (`@paikko/contract`) - the wire contract.
- `packages/widget` (`@paikko/widget`) - the report widget the consumer mounts.
- `packages/backend` (`@paikko/backend`) - the Next 15 + OpenNext/Workers app:
  the ticket **API** (`/api/**`) and the `/tickets` **review UI** (root `/`
  redirects to `/tickets`). It serves the review surface the human and runner use;
  it never serves an end-user app.

The **consumer** lives in `examples/calculator` (`@paikko/calculator`) - a plain
Next 15 app that mounts `@paikko/widget` and POSTs reports cross-origin to the
backend. **The runner fixes consumer-app code, and only consumer-app code.** A
report is a bug a user hit in the consumer app; the fix belongs in that consumer
app (default dir `examples/calculator`, configurable). **The framework
(`packages/*`) is never edited by the loop** - if a report seems to need a
framework change, that is out of scope and the runner says so (`needs_info`)
rather than touching `packages/*`.

## Execution model: a TUI skill, not a headless process

The runner is **not** an outside `claude -p` daemon. The user invokes
`/paikko-run` inside their interactive Claude Code session, in the paikko monorepo,
with the **backend ticket API already running on :8787** (`npm run preview` in
`packages/backend`). The skill drives the loop on the user's TUI subscription - a
headless `claude -p` script would bill as API and defeats the point. The ticket
API base is configurable (default the local backend, `http://localhost:8787`).

The **interactive session IS the main loop.** It finds actionable tickets, picks
one, fixes it **in an isolated git worktree + branch** (in the consumer-app dir),
stands up an **isolated `next dev` preview of the consumer app** for that fix
alone, parks the ticket in `reviewing`, and reacts to the user's Accept / Reject /
Reply - all through the same HTTP surface the in-app review UI uses. The main loop
edits code **only inside the ticket's worktree, under the consumer-app dir**,
never the framework and never the main checkout; `main` is changed only by an
Accept merge.

The skill processes the **actionable set until it is empty**, then stops and
offers to re-run (a `/loop` wrapper can re-poll on a cadence). It does not
busy-wait; `reviewing` is parked.

---

## The branch-isolated review model (replaces direct-to-live)

The earlier v0 demo applied each fix **directly to the live working tree**, so the
app mutated the moment a fix landed and "review" meant re-testing an app that had
already changed. That is demo-grade. The runner now isolates every fix, and every
fix targets the **consumer app** (`examples/calculator`):

- **One worktree + branch per ticket.** Each ticket is fixed in its OWN git
  worktree (`../paikko-wt-{id}`) on its OWN branch (`ticket/{id}`) cut off `main`.
  Edits land only in the worktree's consumer-app dir
  (`../paikko-wt-{id}/examples/calculator/**`). The **live consumer app on `main`
  stays pristine** until the user Accepts.
- **One isolated preview per ticket.** Each fixed ticket gets its OWN `next dev`
  of the consumer app on an **alt port** (default 3001; sequential - exactly one at
  a time) serving ONLY that worktree's fix. The user views **only this fix**
  there. The ticket review UI (Accept / Reject / Reply) is on the **backend**
  (:8787), which is unaffected by consumer-app fixes.
- **"View fix" -> the isolated consumer-app preview.** The ticket carries a
  `previewUrl` (e.g. `http://localhost:3001`) pointing at the isolated `next dev`
  of the fixed consumer app - NOT the live consumer app - and a `branch`
  (`ticket/{id}`).
- **A reply re-engages the agent.** ANY user reply on a `reviewing` ticket
  re-engages the agent: it revisits and revises on the SAME branch + worktree, no
  separate Reject needed to request changes. A reply is enough.
- **Accept = merge.** Accept merges the ticket's consumer-app branch to `main`;
  the live consumer app (`next dev`) hot-reloads the merged source. status ->
  `closed`. The framework is never in the merge diff.
- **Reject = discard.** Reject discards the branch + worktree; live untouched;
  status -> `rejected`.
- **Sequential.** One active worktree + one isolated preview at a time keeps the
  loop feasible on a local machine.

The user manages the backend :8787; **the skill never starts or kills it** - it
only reads/writes its ticket API. Because the consumer app is a plain Next app,
Accept needs no build step: a running `next dev` hot-reloads the merged fix.

---

## Contract

Everything the runner reads or writes is shaped by `@/lib/contract` (see
`packages/contract/src/index.ts` - read it before touching this loop). Validate every
payload with the matching zod schema; never trust a wire shape.

Types/schemas the runner uses:

- `TicketHead` / `TicketHeadSchema` - tier-1 head, the spine of a ticket in
  context. Fields: `id`, `status` (`TicketStatus`), `createdAt` (`IsoTime`),
  `reporter`, `report` (`Report` = message/kind/route/`target`), `thread`
  (`ThreadMessage[]`), `artifacts` (`ArtifactIndex`), and the two branch-isolation
  fields:
  - `branch` (`string | null`) - the git branch the fix lives on (`ticket/{id}`).
    Null until the agent cuts the branch.
  - `previewUrl` (`string | null`) - the isolated consumer-app preview URL where
    ONLY this fix is viewable (`http://localhost:3001`, a `next dev` of the
    fixed consumer app). Null until the isolated preview is up.
  Both are always present as keys on the wire; value is a string or `null`.
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
  fix walks from "this fetch on the page" to "this handler + these queries on the
  server."
- `TicketStatus` / `TicketStatusSchema` - `open | reproducing | needs_info |
  reviewing | closed | rejected`. `closed` = accepted+merged (terminal);
  `rejected` = discarded (terminal). The runner drives the machine via `PATCH`.
- `ThreadMessage` / `ThreadMessageSchema` - what the runner posts back.

All imports are from `@/lib/contract`. No shape is redefined here.

---

## State machine

The store (`src/paikko/server/tickets/store.ts`) enforces these edges; the runner
only ever drives the ones marked (runner):

```
open        -> reproducing                 (runner: CLAIM)
reproducing -> needs_info                  (runner: ambiguous report -> ask)
reproducing -> reviewing                   (runner: fix parked on its branch + isolated preview)
needs_info  -> reproducing                 (runner: reporter answered, retry)
reviewing   -> reproducing                 (RE-ENGAGE on a user reply; runner revises on the same branch)
reviewing   -> closed                      (human ACCEPT; runner reacts -> merge branch to main)
reviewing   -> rejected                    (human REJECT; runner reacts -> discard branch + worktree)
closed      -> reproducing                 (reopen)
rejected    -> (terminal, no outgoing edges)
```

Identity edges are rejected by `canTransition`. `closed` and `rejected` are the
two terminal outcomes; `rejected` has no outgoing edges.

**Who writes what.** `closed` and `rejected` are **human** actions taken from the
in-app review UI on `main`. The runner does NOT write them; it **reacts** to a
ticket the user already moved there by performing the git side - merge on
`closed`, discard on `rejected` (see "Accept / Reject" below). The
`reviewing -> reproducing` re-engage edge is triggered by the store treating a
fresh user reply as actionable, not by the runner flipping status; on re-engage
the runner revises in place and the ticket stays `reviewing`.

---

## HTTP surface

Base URL is the running **backend** (default `http://localhost:8787`, the
`@paikko/backend` Workers app served by `npm run preview` in `packages/backend`;
the ticket API base is configurable - override if the user gave another). All
ticket routes are App-Router handlers under `packages/backend/app/api/**`,
wrapped in `withCapture` and CORS (the backend's seam guard enforces this; the
runner just consumes them - it never edits them). The skill issues these as plain
`curl` calls - see
`.claude/skills/paikko-run/SKILL.md` for the exact method/path/body of every
transition.

| Purpose | Call |
|---|---|
| List by status (open / reviewing / closed / rejected) | `GET /api/tickets?status=<status>` |
| Pull one head | `GET /api/tickets/:id` -> `TicketHeadSchema.parse(body)` |
| Fetch an artifact payload | the entry's `ref`, e.g. `GET /api/tickets/:id/artifacts/:name` -> `ArtifactPayloadSchemas[name].parse(body)` |
| Move status / set branch+previewUrl / post a message | `PATCH /api/tickets/:id` body `{ status?, message?, branch?, previewUrl? }` |

There is no single "actionable" endpoint over the wire; the runner derives the
actionable set from multiple status polls (see "The loop"). This mirrors the
store's `listActionable` helper: status `open`, OR status `reviewing` whose newest
thread message is from a non-agent author (a fresh user reply).

> **Wire intake.** The backend PATCH route's `PatchBodySchema` accepts
> `branch`/`previewUrl` (verified), and the store persists them. The skill always
> sends them; if an older backend rejects the extra keys it retries with
> `{status, message}` only (the status transition still lands) and reconstructs
> `branch`/`previewUrl` from convention - `branch = "ticket/{id}"`,
> `previewUrl = "http://localhost:3001"`.

---

## The loop

One pass = one ticket, handled fully (parked / merged / discarded) before the
next. **Strictly serial:** exactly one worktree and one isolated consumer-app
preview (default :3001) exist at a time. `$CONSUMER_DIR = examples/calculator`
(configurable) is the only dir the loop edits. The human watching the review
board sees a clean, ordered trail.

```
loop:
  FIND   -> the actionable set, oldest-first (backend API, default :8787):
            - GET ?status=open       -> NEW
            - GET ?status=reviewing  -> RE-ENGAGE iff last thread msg is non-agent
            - GET ?status=closed     -> ACCEPT cleanup iff branch unmerged + worktree exists
            - GET ?status=rejected   -> REJECT cleanup iff worktree/branch still exists
            if empty: STOP (report, offer re-run)
  PICK   -> oldest by createdAt -> ticket T; branch on its case:

   NEW (open):
     CLAIM   -> open -> reproducing, post "picked up - fixing on an isolated branch"
     PULL    -> GET head, triage artifact SUMMARIES, fetch only what the fix needs
     (ambiguous OR framework concern? -> reproducing -> needs_info + one question; no worktree; NEXT)
     ISOLATE -> git worktree add -B ticket/T ../paikko-wt-T main; symlink node_modules
     FIX     -> edit ../paikko-wt-T/$CONSUMER_DIR/** (NEVER packages/*, NEVER the main checkout)
     VERIFY  -> in $CONSUMER_DIR: npm run typecheck clean (no lint:seams - framework-only)
     COMMIT  -> commit the fix on ticket/T
     PREVIEW -> kill :3001; next dev the consumer-app worktree on :3001 (background)
     PUBLISH -> reproducing -> reviewing {branch, previewUrl} + "View the fix..." note (PARKED)

   RE-ENGAGE (reviewing + fresh user reply):
     reuse ../paikko-wt-T + ticket/T; read the WHOLE thread; revise in $CONSUMER_DIR;
     re-verify; commit; restart :3001 (next dev); post an update. Stay reviewing.

   ACCEPT (closed, branch unmerged):
     git -C main merge --no-ff ticket/T  (consumer-app source only; live next dev
     hot-reloads, no build); kill :3001; worktree remove ../paikko-wt-T;
     branch -d ticket/T; post "Merged to main - the consumer app now has the fix."

   REJECT (rejected):
     kill :3001; worktree remove --force ../paikko-wt-T; branch -D ticket/T;
     live untouched; post "Discarded - live unchanged."

  NEXT   -> continue with the next oldest actionable ticket.
STOP when the actionable set is empty.
```

There is no `POLL_INTERVAL` sleep: the skill processes the actionable set until
it is empty and stops. To re-poll for new reports/replies, the user re-invokes
`/paikko-run` (optionally under `/loop` on a cadence) - it does not busy-wait
inside one invocation.

### Why claim before pull (NEW path)

CLAIM (`reproducing`) happens before PULL so the queue is honest the instant a
runner takes a ticket: anyone watching the in-app board sees it leave `open`. If
the runner dies mid-pass the ticket is stuck in `reproducing` and a sweep can
reset it - acceptable for v0.

---

## Artifact triage (the cheap-context rule)

The head is **decision-complete by design**: each artifact carries a `summary`,
`count`, and `size` so the runner decides *from the head alone* whether to spend
context on the payload. Do not fetch reflexively.

Heuristics:

- **Always free**: `report.message`, `report.kind`, `report.route`,
  `report.target` (selector + `src` + component). A target `src` often points
  straight at the file - many tickets solve from this alone, zero fetches.
- **Fetch `console`** only if the report mentions an error/crash/exception, or a
  `console` summary shows `error`-level lines.
- **Fetch `network`** if the bug is about a request/response, a wrong value from
  the server, or a failed call. The `network` payload gives you `traceId`s.
- **Fetch `trace`** when `network` (or the report) implicates the backend: take
  the failing `NetworkEntry.traceId` and find the `TraceRequest` with the same
  `traceId` - that is the handler + its `queries` (+ `threw`). Use the spine
  instead of guessing. (May be empty under local preview - DOs off.)
- **Fetch `clientState`** for "wrong value on screen / stale UI" bugs - it is the
  snapshot of the mandated store at report time.
- **Fetch `dom`** only for layout/visual/structure bugs where the serialized HTML
  + `targetSelector` matter.
- **Fetch `storage`** for auth/session/persistence bugs (tokens, flags, cookies).

Fetch only what the fix needs; never dump all six. Artifacts are an immutable
photograph captured at report time - do not assume current state differs.

---

## Isolation: worktree, branch, isolated preview

### Worktree + branch (per ticket)

The fix for ticket `T` lives in a worktree `../paikko-wt-{T}` on branch
`ticket/{T}`, cut from `main`:

```bash
git -C "$MAIN_REPO" worktree add -B "ticket/$T" "../paikko-wt-$T" main
```

All editing happens under `../paikko-wt-$T/$CONSUMER_DIR/**` (the consumer app -
e.g. `examples/calculator`: its `app/**` pages and its own `lib/store.ts`). The
**framework (`../paikko-wt-$T/packages/**`) and the main checkout are never
edited.** The worktree gets `node_modules` by symlinking the main checkout's
(`ln -s "$MAIN_REPO/node_modules" "$WT/node_modules"`); the hoisted workspace
already contains the `@paikko/*` links the consumer imports. The fix is a
**commit on `ticket/{T}`** so Accept can merge / cherry-pick it; `main` is changed
only by the Accept merge.

### Isolated preview (alt port, one at a time)

The isolated preview is a `next dev` of the **consumer app** in the worktree on an
alt port (default 3001) so the user views ONLY this fix. The consumer app is a
plain Next 15 app - no Workers/OpenNext build is needed; `next dev` is the proven,
fast path (and it hot-reloads source edits during re-engage).

```bash
lsof -ti tcp:3001 | xargs -r kill 2>/dev/null || true                 # free the port
[ -e "$WT/node_modules" ] || ln -s "$MAIN_REPO/node_modules" "$WT/node_modules"
( cd "$WT/$CONSUMER_DIR" && npx next dev -p 3001 )                     # serve (background)
```

The runner stores `previewUrl = http://localhost:3001` on the ticket so "View fix"
links at the isolated consumer-app preview. The widget in that preview still
points at the backend (its `NEXT_PUBLIC_PAIKKO_*` env), so reports filed from the
preview also land on the backend.

---

## Verifying the fix (in the worktree)

On the NEW and RE-ENGAGE paths the runner verifies the **consumer app** in the
worktree before publishing to `reviewing`:

- `npm run typecheck` (`tsc --noEmit`) in `$CONSUMER_DIR` must be **clean** - a
  type error is a hard stop.
- There is **no `lint:seams`** in the consumer loop. The seam guard guards the
  framework backend (`packages/backend`), which the loop never edits; the consumer
  app has no seams to guard. On top of the typecheck, the runner's own re-read of
  the report (does the diff plausibly fix *that* bug without regressing, and does
  it stay inside `$CONSUMER_DIR`) is the correctness judgement.

Never publish a fix to `reviewing` unless the typecheck passes and the fix stays
in the consumer app. If the fix cannot be made clean, or would require a framework
change, do not park it - tear down the worktree and either post `needs_info` (if
context is missing or it's a framework concern) or leave a note explaining what is
blocking, then move on.

---

## Reviewing the fix (parked, non-blocking)

On a verified fix the runner flips the ticket `reproducing -> reviewing`, sets
`branch`/`previewUrl`, and posts a summary telling the human to view the fix at
the isolated preview and either Accept & merge or reply to request changes.

`reviewing` is **parked and non-blocking**: the runner does NOT wait for the
human. The isolated consumer-app preview stays up on :3001; the user reviews only
the fix there while the live consumer app on `main` is still pristine. The runner
moves on to the next actionable ticket.

---

## Re-engage on reply (no separate Reject)

A user reply on a parked `reviewing` ticket is itself the request for changes -
the store marks the ticket actionable again the moment a non-agent message is the
newest in the thread. The runner:

- **Reuses the existing worktree + branch** (`../paikko-wt-{T}`, `ticket/{T}`) -
  it does NOT cut a new one. If the worktree was cleaned up after a crash, it
  recreates it from the branch (`git worktree add ../paikko-wt-T ticket/T`).
- Reads the **WHOLE thread** - the latest user reply says what to change; the
  full conversation is the agent's working memory across review cycles.
- Revises in place (in `$CONSUMER_DIR`), re-verifies, **commits the revision on
  the same branch**, restarts the isolated consumer-app preview on :3001 (`next
  dev`), posts an update, and **stays `reviewing`**.

This is why the head carries the full `thread`: the conversation *is* the working
memory, and a reply alone re-engages the fix.

---

## Accept / Reject (the runner reacts to the human)

These statuses are set by the human in the in-app UI; the runner performs the git
side when it next sees the ticket.

### Accept (`closed`) -> merge consumer-app branch to main

```bash
git -C "$MAIN_REPO" merge --no-ff "ticket/$T" -m "merge ticket/$T into main"
# No build step: the consumer app is a plain Next app; a running `next dev` of
# the live consumer app hot-reloads the merged source automatically.
lsof -ti tcp:3001 | xargs -r kill 2>/dev/null || true    # kill the isolated preview
git -C "$MAIN_REPO" worktree remove "../paikko-wt-$T"
git -C "$MAIN_REPO" branch -d "ticket/$T"
```

Post "Merged to main - the consumer app now has the fix." A merge conflict or a
dirty `main` working tree stops the runner (surface it to the user; never force).
The merge only touches `$CONSUMER_DIR/**`; the framework is never in the diff.

### Reject (`rejected`) -> discard, live untouched

```bash
lsof -ti tcp:3001 | xargs -r kill 2>/dev/null || true
git -C "$MAIN_REPO" worktree remove --force "../paikko-wt-$T"
git -C "$MAIN_REPO" branch -D "ticket/$T"
```

Post "Discarded - live unchanged." The fix never reached `main`, so the live
consumer app is byte-for-byte the pristine baseline.

---

## Thread message conventions

When the runner posts, `by: "agent"`, and keep `text` minimal and human-readable
(no raw instruction text, no internal IDs beyond the preview link):

- on `reviewing`: a one/two-line change summary + "View the fix at the isolated
  preview; Accept & merge or reply to request changes."
- on `needs_info`: a single concrete question.
- on re-engage: a brief note of what changed vs. the prior version.
- on Accept: "Merged to main - the consumer app now has the fix."
- on Reject: "Discarded - live unchanged."

The server stamps `id` and `at`; the runner sends only `{ by, text }`.

---

## Invariants (do not break)

1. **The loop edits ONLY the consumer app.** Edits happen ONLY inside the ticket's
   worktree, under `$CONSUMER_DIR` (`../paikko-wt-{id}/examples/calculator/**`).
   The **framework (`packages/*`) is never edited** - contract, widget, backend
   are all off-limits. `main` is changed ONLY by an Accept merge. The runner never
   edits the main checkout.
2. **Validate every wire payload** with the contract's zod schema before use.
3. **Run as a TUI skill, not headless.** `/paikko-run` drives the loop inside the
   interactive session; never a `claude -p` daemon.
4. **The skill never starts/kills the backend (:8787).** The user owns the backend
   review server; the skill only reads/writes its ticket API. The backend is
   framework - never rebuilt or edited by the loop.
5. **One worktree + one isolated preview (default :3001) at a time.** Strictly
   sequential. The preview is a `next dev` of the consumer-app worktree.
6. **A user reply re-engages on the same branch** - no separate Reject is needed
   to request changes.
7. **Each fix is a commit on `ticket/{id}`** so Accept can merge/cherry-pick.
8. **Consumer typecheck is the gate.** Any `tsc --noEmit` error in the consumer
   app is a hard stop; never park a non-compiling fix in `reviewing`. There is no
   `lint:seams` in the consumer loop (it guards the framework backend, untouched).
9. **Triage before fetch.** Default to zero artifact fetches; pull only what the
   fix needs.
10. **Honest needs_info** for ambiguous reports or framework-only concerns - ask
    one concrete question instead of guessing or editing `packages/*`, and leave
    no worktree behind.
