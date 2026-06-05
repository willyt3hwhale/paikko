---
name: paikko-run
description: "Drive the paikko branch-isolated review loop from inside an interactive Claude Code session. Finds actionable tickets (open, or reviewing with a fresh user reply) oldest-first and processes ONE at a time: fixes each ticket in its own git worktree + branch off main, stands up an isolated preview on :8788 for that fix alone, and parks it in reviewing. A user reply re-engages the agent on the same branch; Accept merges the branch to main (live :8787 hot-reloads) and Reject discards the branch + worktree leaving live untouched. Runs on your TUI subscription - no headless billing."
trigger: /paikko-run
---

# /paikko-run

You are the **paikko agent runner**, driving the ticket queue from inside this
interactive Claude Code session (the TUI, on the user's subscription - NOT a
headless `claude -p` process that bills as API).

This is the **branch-isolated** review loop. Every fix lives on its **own git
worktree + branch** (`ticket/{id}`) cut off `main`, viewed in its **own isolated
preview** on **port 8788**. The **live app on `main` (port 8787) stays pristine**
until the user Accepts. The review UI (Accept / Reject / Reply) stays on the main
app; the "View fix" link points at the ticket's isolated preview, never at live.

This skill IS the main loop. The main TUI context **orchestrates**: it finds
work, claims, creates isolation, routes, and posts back. It **may edit code only
inside the ticket's worktree** (`../paikko-wt-{id}/app/calc/**`) - **never** in
the main checkout. `main` is only ever changed by an Accept merge.

Read `agent/runner.md` and `src/lib/contract.ts` once at the start of a run if
you have not already - they are the authoritative spec and the wire shapes.

---

## 0. Preconditions (check before the loop)

1. **The MAIN persistent preview runs on :8787 serving PRISTINE `main`.** The
   user manages it (started with `npm run preview`). **The skill does NOT start or
   kill :8787.** It hot-reloads when `.open-next` is rebuilt on `main` - which only
   happens on an Accept merge. Confirm it answers before looping:

   ```bash
   curl -s -o /dev/null -w '%{http_code}' "http://localhost:8787/api/tickets?status=open"
   ```

   A `200` means go. Anything else (connection refused, non-200): stop and tell
   the user to run `npm run preview` first, then re-invoke `/paikko-run`.

2. **Config (defaults - override only if the user gave you values):**
   - `BASE=http://localhost:8787` - the ticket API + live app (pristine `main`).
   - `MAIN_REPO` - this paikko checkout (the current working directory). The live
     `main` lives here; `git -C "$MAIN_REPO" ...` always targets it.
   - `ISO_PORT=8788` - the single isolated-preview port (one at a time).
   - `PREVIEW_URL=http://localhost:8788` - the isolated preview URL stored on the
     ticket.
   - Worktree path for ticket `T`: `../paikko-wt-$T` (sibling of `MAIN_REPO`),
     branch `ticket/$T`.

   > **Sequential by design.** Exactly ONE worktree + ONE isolated preview on
   > :8788 exist at a time. Finish (park / merge / discard) the current ticket
   > before standing up the next one. This keeps it feasible locally.

   > **Git is non-interactive.** Use `git -C <path>` (never `cd`). Set
   > `GIT_TERMINAL_PROMPT=0` so a hung credential prompt fails fast.

   > **Wire caveat (branch/previewUrl):** the PATCH route may or may not yet parse
   > `branch`/`previewUrl` in its body. **Always send them anyway** (the store
   > persists them when the route forwards them). They are deterministic from
   > convention regardless - `branch = "ticket/{id}"`, `previewUrl =
   > "http://localhost:8788"` - so if the wire drops them this run still works;
   > you reconstruct them from the id. If a PATCH that includes `branch`/
   > `previewUrl` 400s on an unknown key, retry the same PATCH with ONLY
   > `{status, message}` so the status transition still lands, and note that the
   > columns could not be set over the wire.

---

## 1. The loop (process-the-actionable-set, sequential)

One pass = one ticket, handled fully (parked / merged / discarded) before the
next. Strictly serial: one live worktree and one :8788 preview at a time.

```
loop:
  FIND     -> the actionable set (open, OR reviewing with a fresh user reply),
              oldest-first. If empty: report and STOP (offer re-run).
  PICK     -> the OLDEST actionable ticket T. Branch on its situation:

   A. NEW (status open)            -> CLAIM, create worktree+branch, FIX in it,
                                      verify, build+serve isolated preview :8788,
                                      PUBLISH (-> reviewing, branch, previewUrl).
   B. RE-ENGAGE (reviewing + reply)-> reuse existing worktree, read full thread,
                                      revise, rebuild :8788, post update. Stay reviewing.
   C. ACCEPT (status closed,        -> merge ticket/T into main (live :8787
       branch not yet merged)         hot-reloads), kill :8788, remove worktree+branch.
   D. REJECT (status rejected)      -> kill :8788, force-remove worktree, delete
                                      branch. Live untouched.

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

Let `WT="$MAIN_REPO/../paikko-wt-$T"` (resolve to an absolute path). The fix
happens ONLY under `$WT/app/calc/**` (and its store under `$WT/...` if the bug
needs it). **Never touch the main checkout.**

The worktree shares the main repo's `node_modules` is NOT guaranteed - if a
build/typecheck in `$WT` complains about missing deps, run `npm ci` once in `$WT`
(or symlink: `ln -s "$MAIN_REPO/node_modules" "$WT/node_modules"`). Prefer the
symlink to save time since deps are identical to `main`.

### A.4 FIX in the worktree

Implement a **minimal, scoped** fix for the reported bug under `$WT/app/calc/**`.

- Use `target.src` / `TraceRequest.src` / `TraceQuery.src` provenance to land in
  the right file:line; follow the `traceId` spine from a `NetworkEntry` to its
  `TraceRequest` rather than guessing the handler.
- **Respect every mandated seam:** new API handlers go through `withCapture`; new
  client app/domain state goes into the one mandated zustand store (never a second
  store, Redux, or context-as-store); never strip the provenance plugin.
- No drive-by refactors. Keep the diff tight.

### A.5 VERIFY in the worktree

Both checks run **in `$WT`**:

```bash
( cd "$WT" && npx tsc --noEmit )
( cd "$WT" && npm run lint:seams )
```

- `tsc --noEmit` must be **clean** - any type error is a hard stop; fix it before
  proceeding.
- `lint:seams` must pass; **only the one known provenance violation is
  acceptable** (the pre-existing baseline). Any NEW seam violation is a hard stop -
  fix it in the worktree; never publish a seam-breaking fix.

If you cannot get both clean within a couple of attempts, do not publish. Post a
`needs_info` (if it's a missing-context problem) or leave it `reproducing` with a
note explaining what's blocking, tear down the worktree (A.3-style
`worktree remove --force`), and move on.

### A.6 COMMIT the fix on ticket/{T}

The fix must be a commit on `ticket/$T` so Accept can merge / cherry-pick it
later. `main` is never changed here.

```bash
git -C "$WT" add -u
# add any NEW files explicitly (never `git add -A`):
# git -C "$WT" add app/calc/<newfile>
git -C "$WT" commit -m "fix(ticket/$T): <one-line of what changed>"
```

### A.7 ISOLATED PREVIEW on :8788 (the fix, alone)

Free the port, then build this worktree's bundle and serve it on :8788 in the
**background**. The isolated preview serves the calculator fix only; D1/tickets
are not needed there (`/calc` is client-side).

```bash
# 1. kill whatever holds :8788 (a previous ticket's isolated preview)
lsof -ti tcp:$ISO_PORT | xargs -r kill 2>/dev/null || true

# 2. build THIS worktree's OpenNext bundle (produces $WT/.open-next/worker.js)
( cd "$WT" && npx opennextjs-cloudflare build )

# 3. serve that bundle on :8788 in the BACKGROUND
#    opennextjs-cloudflare preview forwards trailing args to `wrangler dev`.
( cd "$WT" && npx opennextjs-cloudflare preview -- --port "$ISO_PORT" )
```

Run step 3 with the Bash tool's `run_in_background` so it keeps serving while the
loop continues. If `opennextjs-cloudflare preview -- --port` does not bind the
port on this machine, fall back to driving `wrangler dev` against the just-built
bundle directly (same effect):

```bash
( cd "$WT" && npx wrangler dev --port "$ISO_PORT" )   # serves $WT/.open-next per wrangler.jsonc `main`
```

Confirm it is up before publishing:

```bash
curl -s -o /dev/null -w '%{http_code}' "$PREVIEW_URL/calc"   # expect 200
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
  -d "{\"status\":\"reviewing\",\"message\":{\"by\":\"agent\",\"text\":\"Fixed <one-line>. View the fix at $PREVIEW_URL/calc; Accept & merge or reply to request changes.\"}}"
```

`reviewing` is **parked and non-blocking** - the isolated preview stays up on
:8788; the user reviews ONLY the fix there, while the live app on :8787 is still
pristine `main`. Go to NEXT.

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

3. Revise the fix **in `$WT/app/calc/**`** per the reply. Re-run verify (A.5),
   then commit the revision on the same branch:

   ```bash
   git -C "$WT" add -u
   git -C "$WT" commit -m "fix(ticket/$T): revise per review"
   ```

4. Rebuild the isolated preview on :8788 (A.7 steps 1-3, kill + build + serve).

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
runner does the git side: merge `ticket/$T` into `main` so the live :8787 preview
hot-reloads the fix, then tear down isolation.

```bash
# 1. merge the ticket branch into main (no-ff keeps the fix as one inspectable unit)
git -C "$MAIN_REPO" merge --no-ff "ticket/$T" -m "merge ticket/$T into main"
```

If `main` has a dirty working tree or the merge conflicts, stop and surface it to
the user (do not force). On a clean merge, `main`'s `.open-next` is rebuilt on the
NEXT build the live preview picks up; if the live :8787 preview does not
hot-reload from the source change alone, rebuild the live bundle on `main`:

```bash
( cd "$MAIN_REPO" && npx opennextjs-cloudflare build )   # live :8787 hot-reloads the merged fix
```

Then tear down the isolated preview + worktree + branch (live is now the source
of truth):

```bash
lsof -ti tcp:$ISO_PORT | xargs -r kill 2>/dev/null || true   # kill :8788
git -C "$MAIN_REPO" worktree remove "../paikko-wt-$T"
git -C "$MAIN_REPO" branch -d "ticket/$T"                    # safe delete (merged)
```

Post the close-out note (status is already `closed`, terminal - send a `message`
only):

```bash
curl -s -X PATCH "$BASE/api/tickets/$T" \
  -H 'content-type: application/json' \
  -d '{"message":{"by":"agent","text":"Merged to main - live."}}'
```

Go to NEXT.

---

## D. REJECT (status `rejected`)

The user Rejected from the in-app UI; the ticket is already `rejected` (terminal,
no outgoing edges). Discard the branch + worktree; the **live app is untouched**
(the fix never reached `main`).

```bash
lsof -ti tcp:$ISO_PORT | xargs -r kill 2>/dev/null || true        # kill :8788
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

1. **Main stays pristine until Accept.** Code edits happen ONLY inside the
   ticket's worktree (`../paikko-wt-{id}/app/calc/**`). `main` is changed ONLY by
   an Accept merge (case C). Never edit the main checkout directly.
2. **One worktree + one :8788 preview at a time.** Strictly sequential. Finish
   (park / merge / discard) the current ticket before standing up the next.
3. **The skill never touches :8787.** The user owns the main persistent preview;
   the skill only reads its API and triggers a `main` rebuild on Accept.
4. **A user reply re-engages** (case B) on the SAME branch/worktree - no separate
   Reject is needed to request changes.
5. **Each fix is a commit on `ticket/{id}`** so Accept can merge/cherry-pick it.
6. **Seams are sacred.** A NEW `lint:seams` violation or any `tsc --noEmit` error
   is a hard stop - never publish to `reviewing`. Only the one known baseline
   provenance violation is tolerated.
7. **Two-tier discipline.** Read artifact summaries first; default to zero
   fetches; pull only what the fix needs.
8. **Honest needs_info.** If a report is too ambiguous to fix, ask one concrete
   question (`reproducing -> needs_info`) instead of guessing - no worktree left
   behind.
9. **Never `git add -A`/`git add .`** - use `git add -u` and add new files
   explicitly. Use `git -C <path>` (never `cd` into a repo for git).
10. **Cleanup is idempotent.** Killing :8788 and removing a worktree/branch that's
    already gone is a no-op (`|| true`); a crashed run is recoverable on the next
    pass.
