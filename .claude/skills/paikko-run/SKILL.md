---
name: paikko-run
description: "Process the paikko open-ticket queue from inside an interactive Claude Code session. Polls open tickets oldest-first, claims one, pulls its bundle with two-tier discipline, delegates the fix to a sub-agent and the verification to a second sub-agent, then parks it in reviewing for in-app human accept/reject. Runs on your TUI subscription - no headless billing."
trigger: /paikko-run
---

# /paikko-run

You are the **paikko agent runner**, driving the ticket queue from inside this
interactive Claude Code session (the TUI, on the user's subscription - NOT a
headless `claude -p` process that bills as API).

This skill IS the main loop. The main TUI context **orchestrates**: it polls,
claims, pulls context, routes, and posts back. It **never edits code itself** -
fixing happens only inside a `fix-agent` sub-agent, and judging only inside a
`verify-agent` sub-agent. Keeping the work in sub-agents is what keeps this
session's context small (it carries heads, not diffs and build logs) over a long
queue.

Read `agent/runner.md` and `src/lib/contract.ts` once at the start of a run if
you have not already - they are the authoritative spec and the wire shapes.

---

## 0. Preconditions (check before the loop)

1. **The dev server must be running.** paikko's API is served by the OpenNext +
   wrangler preview. The user starts it in a separate terminal with:

   ```bash
   npm run preview        # opennextjs-cloudflare build + wrangler dev on :8787
   ```

   Confirm it answers before looping:

   ```bash
   curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/tickets?status=open
   ```

   A `200` means go. Anything else (connection refused, non-200): stop and tell
   the user to run `npm run preview` first, then re-invoke `/paikko-run`.

   > Note: Durable Objects (the `trace` artifact) do NOT work under local
   > preview - they degrade gracefully. If a ticket needs the backend `trace`
   > and it is empty/unavailable locally, treat it as missing context (route to
   > `needs_info`), do not block.

2. **Config (defaults, override if the user gave you values):**
   - `BASE` = `http://localhost:8787` (the preview origin).
   - `REPO` = the current working directory (this paikko repo).

---

## 1. The loop (process-until-empty)

One pass = one ticket, handled fully before the next. Serial by design so the
human watching the in-app board sees a clean, ordered trail.

```
loop:
  POLL   -> if no open tickets: report "queue empty", stop (offer re-run)
  PICK   -> oldest open ticket by createdAt
  CLAIM  -> open -> reproducing, post "picked up" note
  PULL   -> GET head, read artifact SUMMARIES, fetch only what the fix needs
  FIX    -> spawn fix-agent sub-agent (it edits app/calc/**; main never edits)
  VERIFY -> spawn verify-agent sub-agent (runs lint:seams + tsc --noEmit, judges)
  ROUTE  -> pass        => reproducing -> reviewing (parked) + summary note
            needs_info  => reproducing -> needs_info + one concrete question
  NEXT   -> continue; never block on a human (reviewing is parked)
stop when the queue is empty.
```

---

## 2. POLL - fetch the queue

```bash
curl -s "$BASE/api/tickets?status=open"
```

- Body is a JSON array of `TicketHead` (validate against `TicketHeadSchema`
  shape; tolerate extra fields).
- **If the array is empty:** report "Queue empty - no open tickets." and STOP.
  Offer to re-run (the user can invoke `/paikko-run` again, or use `/loop` to
  re-poll on a cadence - see "Re-polling" at the bottom). Do not busy-wait.
- **Otherwise:** the store returns newest-first, so sort by `createdAt`
  **ascending** and take the **first** (the OLDEST open ticket). Call its id `T`.

---

## 3. CLAIM - move to work + post a pickup note

Claim early (before pulling context) so the queue is honest the instant you take
a ticket: anyone watching the in-app board sees it leave `open`. The legal edge
is `open -> reproducing`.

The `PATCH /api/tickets/:id` endpoint takes an optional `status` AND an optional
`message` in one call, so claim + pickup note is a single request:

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"status":"reproducing","message":{"by":"agent","text":"Picked up - reproducing."}}'
```

The server stamps the thread message `id`/`at`; you send only `{by,text}`. The
response is the updated head.

> Only walk legal edges (see the state machine in `store.ts`):
> `open -> reproducing`, `reproducing -> {needs_info | reviewing}`,
> `needs_info -> reproducing`, `reviewing -> {closed | reproducing}`. The runner
> never writes `closed` (accept-to-close is a human, in-app action).

---

## 4. PULL - the head, then two-tier triage

```bash
curl -s "$BASE/api/tickets/$T"
```

This is the `TicketHead`: `report` (message/kind/route/`target`), `thread`, and
the `artifacts` **index** (each entry has a `ref`, a one-line `summary`, `count`,
`size`). **Read the summaries first.** The head is decision-complete by design.

**Always free (no fetch):** `report.message`, `report.kind`, `report.route`,
`report.target` (selector + `src` + component). A target `src` ("file:line:col")
often points straight at the file - **most tickets are solvable from the message
+ summaries + the clicked target's selector with ZERO artifact fetches.**

**Fetch an artifact only when the summary says the fix needs it:**

```bash
# only the ones triage selected, e.g. console:
curl -s "$BASE/api/tickets/$T/artifacts/console"
```

| Artifact | Fetch when |
|---|---|
| `console` | report mentions error/crash/exception, or summary shows error-level lines |
| `network` | bug is about a request/response, a wrong value from the server, a failed call (gives you `traceId`s) |
| `trace` | backend implicated: take the failing `NetworkEntry.traceId`, find the `TraceRequest` with the same `traceId` = the handler + its queries (may be empty under local preview - DOs off) |
| `clientState` | "wrong value on screen / stale UI" - snapshot of the store at report time |
| `dom` | layout/visual/structure bugs where serialized HTML + `targetSelector` matter |
| `storage` | auth/session/persistence bugs (tokens, flags, cookies) |

**Save context: do NOT blindly fetch every artifact.** Pass only the fetched
payloads (plus the head) into the fix-agent. Artifacts are an immutable
photograph captured at report time - do not assume current state differs.

**If this ticket has prior history** (its `thread` already contains an `agent`
message and a reviewer rejection - i.e. it was rejected and re-entered as
open/back-to-fix): read the **WHOLE thread** before re-fixing. The rejection
comment is the most important signal - it tells you exactly why the last attempt
was wrong. Do not repeat the rejected approach; the thread is the working memory
across review cycles.

---

## 5. FIX - delegate to the fix-agent sub-agent

The main context must NOT do the code-fixing itself. Spawn a sub-agent (the Agent
tool) as the **fix-agent**. Hand it:

- The full `TicketHead` (report + the WHOLE thread, especially any rejection
  comment).
- Exactly the artifact payloads triage selected - nothing more.
- The repo path (`REPO`) and the instruction below.

**fix-agent brief:**

> Reproduce the reported bug mentally from this bundle (it is an immutable
> photograph - do not re-fetch or assume live state). Use `target.src` /
> `TraceRequest.src` / `TraceQuery.src` provenance to land in the right file:line,
> and follow the `traceId` spine from a `NetworkEntry` to its `TraceRequest`
> rather than guessing the handler. Implement a **minimal, scoped** fix in the
> calculator code under `app/calc/**` - no drive-by refactors.
>
> **Respect every mandated seam:** new API handlers go through `withCapture`; new
> client app/domain state goes into the one mandated zustand store (never a second
> store, Redux, or context-as-store); never strip the provenance plugin. The seam
> guard will fail otherwise - do not fight it.
>
> Output: a short summary of what changed and which files you touched. Do NOT
> change ticket status or post thread messages - that is the main loop's job.

**If the fix-agent reports it cannot reproduce** (the bundle is insufficient -
missing a repro detail it would need): do NOT guess. Skip to ROUTE -> needs_info.

---

## 6. VERIFY - delegate to the verify-agent sub-agent

Spawn a SECOND sub-agent as the **verify-agent**. This is the LLM counterpart to
the mechanical seam guard: the guard is binary (was a seam bypassed - yes/no),
the verify-agent judges **correctness** (does this actually fix the reported bug
without regressing). Both must pass.

**verify-agent brief:**

> Given the ticket head and the fix-agent's changes in `app/calc/**`:
>
> 1. Run `npm run lint:seams`. A **non-zero exit is a hard reject** - a seam was
>    bypassed. Return the guard's output.
> 2. Run `npx tsc --noEmit`. A type error is a reject.
> 3. Re-read the report and confirm the diff plausibly addresses *that* bug, not
>    a different one, and does not regress.
> 4. If the bundle is insufficient to know the fix is right, return `needs_info`
>    with a concrete question instead of guessing.
>
> Output exactly one of: `pass` | `needs_info(question)` | `reject(reason)`.

```bash
# the verify-agent runs these in REPO:
npm run lint:seams
npx tsc --noEmit
```

**Keep the loop honest:** do NOT move a ticket to `reviewing` unless BOTH
`npm run lint:seams` and `npx tsc --noEmit` pass clean. A seam failure is a hard
stop for that fix - never park a seam-breaking fix in reviewing.

On a `reject(reason)`: re-dispatch the fix-agent with the reason fed in (bounded
- at most ~2 retries). If it still fails, route to `needs_info` with what is
blocking, and move on. Never loop indefinitely on one ticket.

---

## 7. ROUTE - drive the edge and post back

`by` is always `"agent"`. Keep `text` minimal and human-readable: no raw
instruction text, no internal IDs.

### pass (verified) -> propose: reproducing -> reviewing (PARKED)

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"status":"reviewing","message":{"by":"agent","text":"Fixed <one-line of what changed>. Rebuild/refresh the calculator and re-test, then Accept or Reject from the review UI."}}'
```

`reviewing` is **parked and non-blocking**: do NOT wait for the user. The human
rebuilds/refreshes the calculator, re-tests, and Accepts or Rejects from the
in-app review UI (accept -> the app verifies-to-close; reject + comment -> the
ticket re-enters the queue with full thread history). You move straight to the
next open ticket.

### needs_info (repro/verify could not proceed) -> reproducing -> needs_info

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"status":"needs_info","message":{"by":"agent","text":"<a single concrete question about what is missing to reproduce>"}}'
```

Parked. Post one concrete question (what you need to reproduce), then move on.

---

## 8. NEXT - loop or stop

Go back to step 2 (POLL) and take the next oldest open ticket. The ticket you
just handled is parked in `reviewing` or `needs_info`; the loop never blocks on a
human. **Stop when the queue is empty** (step 2 returns `[]`); report a short
summary of the run (how many tickets processed, where each landed) and offer to
re-run.

---

## Re-polling (optional cadence)

The core of this skill is **process-until-empty**, then stop. If the user wants
the runner to keep watching for newly-filed tickets, they can re-invoke
`/paikko-run`, or wrap it with `/loop` (e.g. `/loop 5m /paikko-run`) to re-poll
on an interval. Do not build your own busy-wait sleep loop inside one invocation.

---

## Invariants (do not break)

1. **Main context never edits code.** Only the fix-agent patches `app/calc/**`.
   The main loop orchestrates, routes, and posts.
2. **Two-tier discipline.** Read summaries first; default to zero artifact
   fetches; pull only what the fix needs.
3. **`reviewing` is parked and non-blocking** - never wait on a human in the loop.
4. **Seams are sacred.** A `lint:seams` non-zero exit is a hard stop; never park
   a seam-breaking fix in reviewing.
5. **Honest gate.** Never mark `reviewing` unless `tsc --noEmit` and
   `lint:seams` both pass.
6. **Walk only legal state edges**; the runner never writes `closed`.
7. **Rejected tickets carry their full thread** - read all of it (prior attempt
   + rejection comment) before re-fixing.
