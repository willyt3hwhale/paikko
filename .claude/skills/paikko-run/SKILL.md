---
name: paikko-run
description: "Drive the paikko branch-isolated review loop from inside an interactive Claude Code session. paikko is now a monorepo: the framework lives in packages/* (@paikko/contract, @paikko/widget, @paikko/backend) and is NEVER edited by the loop; the runner fixes the CONSUMER app (examples/calculator, or any configured consumer dir). Finds actionable tickets (open, or reviewing with a fresh user reply) oldest-first and processes ONE at a time: fixes each ticket in its own git worktree + branch off main, stands up an isolated `next dev` preview of the consumer app on an alt port for that fix alone, and parks it in reviewing. A user reply re-engages the agent on the same branch; Accept merges the branch to main and Reject discards the branch + worktree. The ticket API base is the backend (default http://localhost:8788), configurable. Runs on your TUI subscription - no headless billing."
trigger: /paikko-run
---

# /paikko-run

You are the **paikko agent runner**, driving the ticket queue from inside this
interactive Claude Code session (the TUI, on the user's subscription - NOT a
headless `claude -p` process that bills as API).

## Monorepo layout (read this first)

paikko is a single git repo that is an **npm-workspaces monorepo**:

- `packages/contract` (`@paikko/contract`) - the wire contract (TS + zod).
- `packages/widget` (`@paikko/widget`) - the report widget.
- `packages/backend` (`@paikko/backend`) - the Next 15 + OpenNext/Workers app:
  the **ticket API** (`/api/**`) and the `/tickets` **review UI**. Root `/`
  redirects to `/tickets`. This is the **framework backend**.
- `examples/calculator` (`@paikko/calculator`) - the **CONSUMER app**: a plain
  Next 15 calculator that mounts `@paikko/widget` and POSTs reports
  cross-origin to the backend.

**The framework (`packages/*`) is NEVER edited by this loop.** The runner fixes
**consumer-app code only**, under the configured consumer directory
(default `examples/calculator`). A report filed in a consumer app is a bug in
that consumer app's code, and that is the only place a fix may land.

This is the **branch-isolated** review loop. Every fix lives on its **own git
worktree + branch** (`ticket/{id}`) cut off `main`, viewed in its **own isolated
preview**: a `next dev` of the **consumer app** in that worktree on an **alt
port** (default 3001), serving only that fix. The **live consumer app stays
pristine** on `main` until the user Accepts. The review UI (Accept / Reject /
Reply) lives on the backend; the "View fix" link points at the ticket's isolated
consumer-app preview, never at the live consumer app.

This skill IS the main loop. The main TUI context **orchestrates**: it finds
work, claims, creates isolation, routes, and posts back. It **may edit code only
inside the ticket's worktree, under the consumer-app dir**
(`../paikko-wt-{id}/examples/calculator/**`) - **never** the framework
(`packages/*`) and **never** the main checkout. `main` is only ever changed by an
Accept merge.

Read `agent/runner.md` and `packages/contract/src/index.ts` once at the start of
a run if you have not already - they are the authoritative spec and the wire
shapes.

---

## 0. Preconditions (check before the loop)

1. **The BACKEND ticket API runs on :8788 (the review surface + intake).** The
   user manages it (started with `npm run preview` in `packages/backend`). **The
   skill does NOT start or kill :8788.** This is the `@paikko/backend` Workers app
   that serves `/api/**` and the `/tickets` review UI; reports filed from the
   consumer app land here cross-origin. Confirm it answers before looping:

   ```bash
   curl -s -o /dev/null -w '%{http_code}' "http://localhost:8788/api/tickets?status=open"
   ```

   A `200` means go. Anything else (connection refused, non-200): stop and tell
   the user to start the backend first (`cd packages/backend && npm run preview`),
   then re-invoke `/paikko-run`. If the user gave a different backend base, use it.

   > The backend is **framework** - the loop never edits it and never rebuilds it.
   > It is just the API the runner reads/writes and the review UI the human uses.

2. **Config (defaults - override only if the user gave you values):**
   - `BASE=http://localhost:8788` - the **backend** ticket API + review UI. The
     ticket API base is configurable; default is the local backend.
   - `PAIKKO_SECRET_KEY` - **only if the backend runs with `PAIKKO_AUTH=required`**
     (see `AUTH.md`). When set, the tickets API needs the project's secret key
     (`sk_...`) as a bearer, so **add `-H "authorization: Bearer $PAIKKO_SECRET_KEY"`
     to EVERY `$BASE/api/**` curl below** (GET, PATCH, artifacts, thread). Unset
     (the default permissive backend) -> send no auth header, curls work as-is.
     A `401` from any API call means this key is missing or wrong.
   - `MAIN_REPO` - this paikko monorepo checkout (the current working directory).
     The live `main` lives here; `git -C "$MAIN_REPO" ...` always targets it.
   - `CONSUMER_DIR=examples/calculator` - the consumer app, **relative to the repo
     root**. This is the ONLY directory the loop edits. Override if the user is
     running the loop against a different consumer app dir in the monorepo.
   - `ISO_PORT=3001` - the single isolated-preview port (one at a time). The
     isolated preview is a `next dev` of the consumer app worktree.
   - `PREVIEW_URL=http://localhost:3001` - the isolated consumer-app preview URL
     stored on the ticket (it points at the FIX, served from the worktree).
   - Worktree path for ticket `T`: `../paikko-wt-$T` (sibling of `MAIN_REPO`),
     branch `ticket/$T`. The consumer app inside it is
     `$WT/$CONSUMER_DIR` (e.g. `../paikko-wt-$T/examples/calculator`).

   > **Sequential by design.** Exactly ONE worktree + ONE isolated preview on
   > `$ISO_PORT` exist at a time. Finish (park / merge / discard) the current
   > ticket before standing up the next one. This keeps it feasible locally.

   > **Git is non-interactive.** Use `git -C <path>` (never `cd`). Set
   > `GIT_TERMINAL_PROMPT=0` so a hung credential prompt fails fast.

   > **Wire caveat (branch/previewUrl):** the backend PATCH route parses
   > `branch`/`previewUrl` in its body (verified). **Always send them.** They are
   > deterministic from convention regardless - `branch = "ticket/{id}"`,
   > `previewUrl = "http://localhost:3001"` (i.e. `$PREVIEW_URL`) - so if an older
   > backend drops them this run still works; you reconstruct them from the id. If
   > a PATCH that includes `branch`/`previewUrl` 400s on an unknown key, retry the
   > same PATCH with ONLY `{status, message}` so the status transition still
   > lands, and note that the
   > columns could not be set over the wire.

---

## 1. The loop (process-the-actionable-set, sequential)

One pass = one ticket, handled fully (parked / merged / discarded) before the
next. Strictly serial: one live worktree and one isolated preview (`$ISO_PORT`)
at a time. Every fix targets the **consumer app** (`$CONSUMER_DIR`), never the
framework (`packages/*`).

```
loop:
  FIND     -> the actionable set (open, OR reviewing with a fresh user reply),
              oldest-first. If empty: report and STOP (offer re-run).
  PICK     -> the OLDEST actionable ticket T. Branch on its situation:

   A. NEW (status open)            -> CLAIM, create worktree+branch, FIX it in
                                      $CONSUMER_DIR, verify, serve isolated
                                      consumer-app preview ($ISO_PORT via next dev),
                                      PUBLISH (-> reviewing, branch, previewUrl).
   B. RE-ENGAGE (reviewing + reply)-> reuse existing worktree, read full thread,
                                      revise in $CONSUMER_DIR, restart the preview,
                                      post update. Stay reviewing.
   C. ACCEPT (status closed,        -> merge ticket/T into main, kill the preview,
       branch not yet merged)         remove worktree+branch.
   D. REJECT (status rejected)      -> kill the preview, force-remove worktree,
                                      delete branch. Live untouched.

  NEXT     -> continue with the next oldest actionable ticket.
stop when the actionable set is empty.
```

> Accept (`closed`) and Reject (`rejected`) are **human** actions taken from the
> in-app review UI on `main`. The runner does not write `closed`/`rejected`; it
> **reacts** to a ticket that the user already moved there (cases C and D) by
> doing the git merge/cleanup. A user **reply** on a `reviewing` ticket is the
> re-engage signal (case B) - no Reject needed to request changes.

---

## 2. FIND - the actionable set (oldest-first)

There is no single "actionable" endpoint over the wire; derive it from two polls
(this mirrors the store's `listActionable`: open tickets, plus reviewing tickets
whose newest thread message is NOT from the agent).

```bash
# fresh reports waiting to be claimed
curl -s "$BASE/api/tickets?status=open"
# parked fixes the user may have replied to (or moved to closed/rejected)
curl -s "$BASE/api/tickets?status=reviewing"
```

Also poll the two terminal-but-actionable-for-cleanup states, so the runner
performs the git side of an Accept/Reject the user just triggered:

```bash
curl -s "$BASE/api/tickets?status=closed"     # Accept: branch may still need merging
curl -s "$BASE/api/tickets?status=rejected"   # Reject: worktree/branch may need dropping
```

Build the actionable set:

- **open** -> always actionable (NEW, case A).
- **reviewing** -> actionable ONLY if the LAST thread message's `by` is not
  `"agent"` (a fresh user reply -> RE-ENGAGE, case B). If the agent posted last,
  skip it (nothing new).
- **closed** -> actionable ONLY if its `branch` is set AND a worktree
  `../paikko-wt-{id}` still exists AND the branch is not yet merged into `main`
  (ACCEPT cleanup, case C). A closed ticket with no worktree is already merged -
  skip.
- **rejected** -> actionable ONLY if a worktree `../paikko-wt-{id}` OR the branch
  `ticket/{id}` still exists (REJECT cleanup, case D). Otherwise already cleaned -
  skip.

To test whether a worktree/branch still exists:

```bash
git -C "$MAIN_REPO" worktree list --porcelain | grep -q "paikko-wt-$T" && echo wt-exists
git -C "$MAIN_REPO" branch --list "ticket/$T" | grep -q . && echo branch-exists
# is ticket/T already in main's history? (closed already merged)
git -C "$MAIN_REPO" branch --merged main --list "ticket/$T" | grep -q . && echo already-merged
```

Validate each head against `TicketHeadSchema` shape (tolerate extra fields). Sort
the whole actionable set by `createdAt` **ascending**; take the **first**; call
its id `T`. If the set is empty: report "Nothing actionable - queue clear." and
STOP (offer to re-run, optionally under `/loop`).

---

## A. NEW ticket (status `open`)

### A.1 CLAIM (open -> reproducing) + pickup note

Claim early so the in-app board is honest the instant you take it. One PATCH does
the transition + the note:

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"status":"reproducing","message":{"by":"agent","text":"Picked up - fixing on an isolated branch."}}'
```

### A.2 PULL the head + two-tier triage

```bash
curl -s "$BASE/api/tickets/$T"
```

Read `report` (message/kind/route/`target`) + `thread` + the `artifacts`
**index** (each entry: `ref`, one-line `summary`, `count`, `size`). The head is
decision-complete by design.

**Always free (no fetch):** `report.message`, `report.kind`, `report.route`,
`report.target` (selector + `src` + component). A target `src` ("file:line:col")
often points straight at the file - **most tickets solve from message + summaries
+ the clicked target with ZERO artifact fetches.**

**Fetch an artifact only when its summary says the fix needs it:**

```bash
curl -s "$BASE/api/tickets/$T/artifacts/console"   # only the ones triage selected
```

| Artifact | Fetch when |
|---|---|
| `console` | report mentions error/crash/exception, or summary shows error-level lines |
| `network` | bug is about a request/response, a wrong value from the server, a failed call (gives `traceId`s) |
| `trace` | backend implicated: take the failing `NetworkEntry.traceId`, find the `TraceRequest` with the same `traceId` = handler + queries (may be empty under local preview - DOs off) |
| `clientState` | "wrong value on screen / stale UI" - the store snapshot at report time |
| `dom` | layout/visual/structure bugs where serialized HTML + `targetSelector` matter |
| `storage` | auth/session/persistence bugs (tokens, flags, cookies) |

Validate each fetched payload with `ArtifactPayloadSchemas[name].parse(...)`.
**Do NOT blindly fetch all six.** Artifacts are an immutable photograph captured
at report time - do not assume current state differs.

**Ambiguous report?** If the report is too vague to fix and no artifact resolves
it, do NOT guess. Move to `needs_info` (honest path) and continue the loop:

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"status":"needs_info","message":{"by":"agent","text":"<one concrete question about what is missing to reproduce>"}}'
```

(`reproducing -> needs_info` is a legal edge.) Then go to NEXT - no worktree was
created, so there is nothing to clean up.

### A.3 CREATE ISOLATION - a worktree + branch off main

Cut a fresh worktree and branch from `main`. `-B` makes the branch (resetting it
to `main` if a stale one lingers); the worktree directory is a sibling of the
repo so it never pollutes the main checkout:

```bash
GIT_TERMINAL_PROMPT=0 git -C "$MAIN_REPO" fetch --quiet || true
GIT_TERMINAL_PROMPT=0 git -C "$MAIN_REPO" worktree add -B "ticket/$T" "../paikko-wt-$T" main
```

If `worktree add` fails because `../paikko-wt-$T` already exists from a crashed
prior run, remove it first then retry:

```bash
git -C "$MAIN_REPO" worktree remove --force "../paikko-wt-$T" 2>/dev/null || true
git -C "$MAIN_REPO" worktree add -B "ticket/$T" "../paikko-wt-$T" main
```

Let `WT="$MAIN_REPO/../paikko-wt-$T"` (resolve to an absolute path) and
`APP="$WT/$CONSUMER_DIR"` (e.g. `$WT/examples/calculator`). The fix happens ONLY
under `$APP/**` (the consumer app - its pages and its own store). **Never touch
the framework (`$WT/packages/**`) and never touch the main checkout.**

The worktree does NOT get `node_modules` automatically. The proven approach is to
**symlink the root `node_modules`** from the main checkout so the workspace links
(`@paikko/contract`, `@paikko/widget`) resolve without a reinstall, since deps are
identical to `main`:

```bash
ln -s "$MAIN_REPO/node_modules" "$WT/node_modules"
```

This is a monorepo with hoisted, workspace-linked deps; the root `node_modules`
already contains the `@paikko/*` symlinks the consumer app imports, so the
symlink is enough for `tsc` and `next dev` in the worktree. (If a check still
complains about missing deps, run `npm install` once at `$WT` root - but the
symlink should suffice.)

### A.4 FIX in the worktree (consumer app only)

Implement a **minimal, scoped** fix for the reported bug under `$APP/**` - the
consumer app's own code (its `app/**` pages and its `lib/store.ts`). The bug was
reported by a user of the consumer app, so the fix lives in the consumer app.

- Use `target.src` / `TraceRequest.src` / `TraceQuery.src` provenance to land in
  the right file:line; follow the `traceId` spine from a `NetworkEntry` to its
  `TraceRequest` rather than guessing the handler.
- **NEVER edit the framework** (`$WT/packages/contract`, `$WT/packages/widget`,
  `$WT/packages/backend`). If a report seems to require a framework change, that
  is out of scope for the loop - post `needs_info` explaining it is a framework
  concern, not a consumer-app fix, and move on. The loop only changes the
  consumer.
- Respect the consumer app's own conventions (its single zustand store for app
  state; do not introduce a second store). Keep the diff tight - no drive-by
  refactors.

### A.5 VERIFY in the worktree (consumer app)

Type-check the **consumer app** in the worktree:

```bash
( cd "$APP" && npm run typecheck )   # tsc --noEmit for the consumer app
```

- `typecheck` must be **clean** - any type error is a hard stop; fix it before
  proceeding.
- There is **no `lint:seams` here** - the seam guard guards the framework backend
  (`packages/backend`), which the loop never edits. The consumer app has no seams
  to guard. (If you ever did touch the backend you would be out of scope; don't.)

If you cannot get the typecheck clean within a couple of attempts, do not publish.
Post a `needs_info` (if it's a missing-context problem) or leave it `reproducing`
with a note explaining what's blocking, tear down the worktree (A.3-style
`worktree remove --force`), and move on.

### A.6 COMMIT the fix on ticket/{T}

The fix must be a commit on `ticket/$T` so Accept can merge / cherry-pick it
later. `main` is never changed here.

```bash
git -C "$WT" add -u
# add any NEW files explicitly (never `git add -A`):
# git -C "$WT" add examples/calculator/<newfile>
git -C "$WT" commit -m "fix(ticket/$T): <one-line of what changed>"
```

### A.7 ISOLATED PREVIEW on $ISO_PORT (the consumer-app fix, alone)

Free the port, then run a `next dev` of the **consumer app** in this worktree on
`$ISO_PORT` in the **background**. The consumer app is a plain Next 15 app - no
Workers/OpenNext build is needed for the preview; `next dev` is the proven,
fast path. The preview points the widget at the same backend as live (its
`NEXT_PUBLIC_PAIKKO_*` env), so a report filed from the preview still lands on the
backend.

```bash
# 1. kill whatever holds $ISO_PORT (a previous ticket's isolated preview)
lsof -ti tcp:$ISO_PORT | xargs -r kill 2>/dev/null || true

# 2. ensure the worktree has node_modules (symlink to the main checkout's, A.3)
[ -e "$WT/node_modules" ] || ln -s "$MAIN_REPO/node_modules" "$WT/node_modules"

# 3. serve the consumer app on $ISO_PORT in the BACKGROUND (next dev)
( cd "$APP" && npx next dev -p "$ISO_PORT" )
```

Run step 3 with the Bash tool's `run_in_background` so it keeps serving while the
loop continues.

Confirm it is up before publishing (the consumer app's root IS the app, e.g. the
calculator):

```bash
curl -s -o /dev/null -w '%{http_code}' "$PREVIEW_URL/"   # expect 200
```

### A.8 PUBLISH (reproducing -> reviewing) + branch + previewUrl + summary

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d "{\"status\":\"reviewing\",\"branch\":\"ticket/$T\",\"previewUrl\":\"$PREVIEW_URL\",\"message\":{\"by\":\"agent\",\"text\":\"Fixed <one-line of what changed>. View the fix at the isolated preview; Accept & merge or reply to request changes.\"}}"
```

If that 400s on the unknown `branch`/`previewUrl` keys, retry with only
`{status, message}` so the transition still lands (the URL is reconstructable from
`$T`):

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d "{\"status\":\"reviewing\",\"message\":{\"by\":\"agent\",\"text\":\"Fixed <one-line>. View the fix at $PREVIEW_URL; Accept & merge or reply to request changes.\"}}"
```

`reviewing` is **parked and non-blocking** - the isolated consumer-app preview
stays up on `$ISO_PORT`; the user reviews ONLY the fix there, while the live
consumer app on `main` is still pristine. Go to NEXT.

---

## B. RE-ENGAGE (status `reviewing` + a fresh user reply)

A user reply on a parked `reviewing` ticket is a request for changes - no Reject
needed. **Reuse the EXISTING worktree/branch** (`../paikko-wt-$T`, `ticket/$T`);
do NOT cut a new one.

1. PULL the head; read the **WHOLE thread** - especially the latest user reply,
   which says what to change.

   ```bash
   curl -s "$BASE/api/tickets/$T"
   ```

2. If the worktree is gone (crash), recreate it from the branch (the prior commit
   is on `ticket/$T`):

   ```bash
   git -C "$MAIN_REPO" worktree add "../paikko-wt-$T" "ticket/$T"
   ```

3. Revise the fix **in `$APP/**`** (the consumer app, `$WT/$CONSUMER_DIR`) per the
   reply - never the framework. Re-run verify (A.5), then commit the revision on
   the same branch:

   ```bash
   git -C "$WT" add -u
   git -C "$WT" commit -m "fix(ticket/$T): revise per review"
   ```

4. Restart the isolated consumer-app preview on `$ISO_PORT` (A.7 steps 1-3: kill +
   ensure node_modules symlink + `next dev`). `next dev` hot-reloads source
   changes, so if it is still running from the prior pass a refresh may suffice;
   restarting it is the safe default.

5. Post an update; **stay `reviewing`** (do not transition - the PATCH carries
   only a `message`, re-asserting branch/previewUrl if the wire accepts them):

   ```bash
   curl -s -X PATCH "$BASE/api/tickets/$T" \
     -H 'content-type: application/json' \
     -d "{\"branch\":\"ticket/$T\",\"previewUrl\":\"$PREVIEW_URL\",\"message\":{\"by\":\"agent\",\"text\":\"Revised per your reply: <one-line>. Refresh the isolated preview and re-check.\"}}"
   ```

   (If branch/previewUrl keys 400, retry with only `{message}`.) Go to NEXT.

---

## C. ACCEPT (status `closed`, branch not yet merged)

The user Accepted from the in-app review UI; the ticket is already `closed`. The
runner does the git side: merge the consumer-app branch `ticket/$T` into `main`,
then tear down isolation. The merge only touches consumer-app source
(`$CONSUMER_DIR/**`); the framework is never in the diff.

```bash
# 1. merge the ticket branch into main (no-ff keeps the fix as one inspectable unit)
git -C "$MAIN_REPO" merge --no-ff "ticket/$T" -m "merge ticket/$T into main"
```

If `main` has a dirty working tree or the merge conflicts, stop and surface it to
the user (do not force). On a clean merge the consumer app on `main` now contains
the fix. If the user runs the live consumer app with `next dev`, it hot-reloads
the merged source automatically - no build step is needed (the consumer app is a
plain Next app, not a Workers bundle). There is nothing to rebuild here.

Then tear down the isolated preview + worktree + branch (live is now the source
of truth):

```bash
lsof -ti tcp:$ISO_PORT | xargs -r kill 2>/dev/null || true   # kill the isolated preview
git -C "$MAIN_REPO" worktree remove "../paikko-wt-$T"
git -C "$MAIN_REPO" branch -d "ticket/$T"                    # safe delete (merged)
```

Post the close-out note (status is already `closed`, terminal - send a `message`
only):

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"message":{"by":"agent","text":"Merged to main - the consumer app now has the fix."}}'
```

Go to NEXT.

---

## D. REJECT (status `rejected`)

The user Rejected from the in-app UI; the ticket is already `rejected` (terminal,
no outgoing edges). Discard the branch + worktree; the **live consumer app is
untouched** (the fix never reached `main`).

```bash
lsof -ti tcp:$ISO_PORT | xargs -r kill 2>/dev/null || true        # kill the isolated preview
git -C "$MAIN_REPO" worktree remove --force "../paikko-wt-$T"     # force: drop uncommitted too
git -C "$MAIN_REPO" branch -D "ticket/$T"                         # force delete (unmerged)
```

Post the discard note (terminal status - `message` only):

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"message":{"by":"agent","text":"Discarded - live unchanged."}}'
```

Go to NEXT.

---

## NEXT - loop or stop

Re-run FIND (step 2). Process the next oldest actionable ticket. **Stop when the
actionable set is empty** across all four polls; report a short run summary (how
many tickets parked / merged / discarded / needs_info, and which branch/preview
each landed on) and offer to re-run.

**Re-polling (optional cadence):** the core is process-until-clear, then stop. To
keep watching for new reports + replies, the user re-invokes `/paikko-run`, or
wraps it with `/loop` (e.g. `/loop 5m /paikko-run`). Do not build a busy-wait
sleep loop inside one invocation.

---

## Invariants (do not break)

1. **The loop only ever edits the CONSUMER app.** Code edits happen ONLY inside
   the ticket's worktree, under `$CONSUMER_DIR`
   (`../paikko-wt-{id}/examples/calculator/**`). The **framework (`packages/*`) is
   never edited** - not contract, not widget, not backend. `main` is changed ONLY
   by an Accept merge (case C). Never edit the main checkout directly.
2. **One worktree + one isolated preview (`$ISO_PORT`) at a time.** Strictly
   sequential. Finish (park / merge / discard) the current ticket before standing
   up the next. The preview is a `next dev` of the consumer-app worktree.
3. **The skill never touches the backend (:8788).** The user owns the backend
   review server; the skill only reads/writes its ticket API. The backend is
   framework - it is never rebuilt or edited by the loop.
4. **A user reply re-engages** (case B) on the SAME branch/worktree - no separate
   Reject is needed to request changes.
5. **Each fix is a commit on `ticket/{id}`** so Accept can merge/cherry-pick it.
6. **Consumer typecheck is a hard gate.** Any `tsc --noEmit` error in the consumer
   app (`npm run typecheck` in `$CONSUMER_DIR`) is a hard stop - never publish to
   `reviewing`. There is no `lint:seams` in the consumer loop; the seam guard
   guards the framework backend, which the loop never touches.
7. **Two-tier discipline.** Read artifact summaries first; default to zero
   fetches; pull only what the fix needs.
8. **Honest needs_info.** If a report is too ambiguous to fix - or would require a
   framework change - ask one concrete question (`reproducing -> needs_info`)
   instead of guessing or editing `packages/*`; no worktree left behind.
9. **Never `git add -A`/`git add .`** - use `git add -u` and add new files
   explicitly. Use `git -C <path>` (never `cd` into a repo for git).
10. **Cleanup is idempotent.** Killing the preview port and removing a
    worktree/branch that's already gone is a no-op (`|| true`); a crashed run is
    recoverable on the next pass.
