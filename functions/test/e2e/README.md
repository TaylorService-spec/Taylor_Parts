# Emulator E2E harness

## Why this exists

A read-only review of the deployed callable surface found roughly 20 HIGH and 30 MEDIUM defects, and
observed that **62 of the 84 deployed callables have never been invoked by any test or scout** — every
one of them mutates, and no safe place existed to actually run them. That is the single biggest
coverage gap in the product.

This directory is that place. It is a **reusable pattern** for driving a real Firestore emulator
end-to-end through a chosen chain of governed callables — start the emulator, seed a minimal governed
dataset, "authenticate" as a chosen persona, invoke the real exported callable handlers, assert on the
resulting documents, tear down. It runs against the emulator **only**. Nothing here is reachable from a
live Firebase project.

## What's here

| File | What it proves |
|---|---|
| `lib/testKit.mjs` | Shared harness: persona seeding, Part Master seeding, the `workOrder.parts.plan` governed-capability grant, callable request builder, ledger/audit assertion helpers. |
| `workOrderLifecycleEmulator.test.mjs` | **Chain 1, happy path.** `createWorkOrder` → `setWorkOrderPartsPlan` → `transitionWorkOrder` (MarkReady/Schedule/Dispatch/Accept/Travel/Arrive/WorkStart/Complete/Close) → `updateWorkOrderExecutionData`, asserting Work Order status, `inventory_transactions` ledger entries, and `auditEvents` at each step. |
| `workOrderLifecycleEdgeCasesEmulator.test.mjs` | Chain 1's three "current fixtures don't cover this" states: an **empty** parts plan, a **terminal** (CLOSED) Work Order, and a **cancelled** (post-Dispatch, reservation-releasing) Work Order. |
| `schedulingCommandsEmulator.test.mjs` | **Chain 2, the governed Scheduling commands.** `rescheduleWorkOrder` / `reassignScheduledWorkOrder` (plan changes — status stays `SCHEDULED`) and `transitionWorkOrder("Unschedule")` (ND-18's one reverse edge), including every ND-20 refusal, the outside-working-hours **warning** that must NOT become a refusal, atomicity after each refusal, and a real two-writer concurrency race against the per-technician lock. |
| `schedulingAvailabilityEmulator.test.mjs` | **Chain 2b, the availability authority.** `setTechnicianWorkingAvailability` / `createTechnicianBlockedTime` / `deleteTechnicianBlockedTime` and the trusted `readTechnicianAvailability` projection — including that the projection and the commands agree about which windows are blocked, and that an unrecorded schedule reports `null` capacity rather than zero. |
| `runAll.mjs` | Spawns every `*Emulator.test.mjs` file in this directory as its own process and aggregates pass/fail into one exit code. |

The orchestrator that starts/stops the emulator lives one level up, at
`functions/scripts/runE2eEmulatorSuite.mjs`, and is invoked via `npm run test:e2eEmulatorSuite`
(`functions/package.json`).

## Running it

```
cd functions
npm run test:e2eEmulatorSuite
```

That's `npm run build` (compiles `src/` → `lib/`, which is what these tests import) followed by
`functions/scripts/runE2eEmulatorSuite.mjs`, which:

1. Generates a **temporary, gitignored** `firebase.json` copy (`.e2e-emulator-firebase.json` at the repo
   root) with the Firestore/Auth/hub/logging emulator ports overridden from env vars — never edits the
   real `firebase.json`.
2. Runs `firebase emulators:exec --only firestore,auth --project eos-platform-sandbox --config
   .e2e-emulator-firebase.json "node functions/test/e2e/runAll.mjs"` from the **repo root**, so
   `firestore.rules` resolves from THIS worktree's checked-out branch.
3. Exits with `runAll.mjs`'s own exit code — 0 only if every file's every `check()` passed. **This is
   the number to trust — never a grep of the emulator log.**

Ports default to 8080 (Firestore) / 9099 (Auth) / 4400 (hub) / 4500 (logging) — the same defaults
`firebase.json` already uses — but are overridable, since 8080 in particular is frequently already
occupied on this machine (and, per this repo's worktree-fleet convention, several agents may have an
emulator up at once):

```
E2E_FIRESTORE_PORT=18234 E2E_AUTH_PORT=19234 E2E_HUB_PORT=14234 E2E_LOGGING_PORT=15234 \
  npm run test:e2eEmulatorSuite
```

To run a single file against an emulator you've already started yourself:

```
npm run build
firebase emulators:start --only firestore,auth --project eos-platform-sandbox
# in a second terminal:
node test/e2e/workOrderLifecycleEmulator.test.mjs
```

## The pattern, so this becomes a habit and not a one-off

This harness invokes the **real exported `onCall` handler**, via its own `.run(request)` method — the
same convention `functions/test/workOrderEngineFunctions.test.js` and
`functions/test/receivingCallablesEmulator.test.mjs` already use in this repo. It does **not** go
through a live HTTPS round-trip or the Auth emulator's token issuance — every callable in this codebase
resolves the caller's role from a plain `users/{uid}` Firestore doc (`callerContext.ts`), or from a
governed `roleAssignments` doc resolved through `resolveEffectiveAccess()` (the newer capability model,
e.g. `workOrder.parts.plan`) — so seeding that doc IS "authenticating as a persona" for these purposes.
Real HTTPS/Auth-emulator round-tripping is a heavier, separate pattern
(`field-ops-app-vite/test/emulator/authPr2Boundary.mjs` is this repo's example of it) worth reaching for
only when a chain specifically needs to prove client-SDK-enforced `firestore.rules` behavior, not
callable authorization logic.

### To add the next chain

1. **Pick one real, currently-unexercised chain of callables** — a sequence with a genuine business
   before/after, not an isolated smoke-test of one function. Check which callables already have
   *some* emulator coverage first (`grep -rl "\.run(" functions/test/*.mjs` and the `*Emulator.test.mjs`
   files already in `functions/test/`) — this pattern is for the still-uncovered 62, not a duplicate of
   existing coverage.
2. **Reuse `lib/testKit.mjs` first.** Add to it, don't fork it, when the chain needs a NEW kind of
   persona/seed/grant (e.g. a Sales Order or Opportunity fixture) — the point of a shared kit is that
   the seed helpers accumulate instead of getting reinvented per chain. If the new chain's domain is
   unrelated to Work Orders (e.g. Sales Order lifecycle), consider a sibling
   `lib/salesOrderTestKit.mjs` rather than overloading this one — same principle either way: shared,
   named, documented helpers, not copy-pasted seed blocks.
3. **New file naming: `<chainName>Emulator.test.mjs`.** `runAll.mjs` picks up every file matching that
   suffix automatically — no registration step needed.
4. **Follow the `check()` pattern**, not `node --test`: `makeCheckRunner(label)` from the test kit gives
   you `check(name, fn)` (prints `PASS`/`FAIL`, never throws past its own catch) and `summarize()`
   (returns whether every check passed). End the file with
   `process.exit(summarize() ? 0 : 1)` — that exit code is what `runAll.mjs` — and therefore CI —
   actually trusts.
5. **Assert on governed side effects, not just the callable's return value.** This repo's callables
   routinely have real Firestore side effects the return value alone doesn't reveal — a ledger write
   (`inventory_transactions`), an Audit Event, a Sales Order write-back. Read those collections back and
   assert on them the way `workOrderLifecycleEmulator.test.mjs` does for the ledger and
   `auditEvents`.
6. **Cover more than the happy path.** Add (or extend) an edge-cases file the way
   `workOrderLifecycleEdgeCasesEmulator.test.mjs` does: an empty/zero case, a terminal/closed case, and
   at least one exceptional case (cancelled, partially-fulfilled, rejected). A prior audit found NO
   fixture anywhere in this repo produces a cancelled Sales Order, a partially-invoiced Sales Order, or
   a LOST Opportunity — those three are still open (this lane closed the equivalent Work Order gap:
   empty parts plan, CLOSED terminal state, and a post-Dispatch CANCELLED Work Order that proves
   `releaseParts()` genuinely releases the outstanding ledger reservation). Whoever picks up the next
   chain in that domain should seed the cancelled/partial/LOST fixtures as part of it, through the real
   commands where one exists (e.g. a `transitionWorkOrder` Cancel, an Opportunity LOST transition), not
   as a hand-authored terminal-status Firestore doc — the whole point of this harness is exercising the
   real governed write path, not fabricating its output.
7. **Add a CI path filter.** Copy `.github/workflows/emulator-e2e-harness-tests.yml`'s `paths:` list and
   extend it with the `src/` files your new chain's callables live in, and this file itself.
8. **Never assume port 8080/hub 4400 are free**, and never manually prefix `VAR=value` before a command
   in an npm script (it breaks under `cmd.exe` on Windows, which is what `firebase emulators:exec`
   shells out through on this platform). Set env vars in a `.mjs` script (as
   `runE2eEmulatorSuite.mjs` does) or pass them as real CLI flags (`--project`, `--config`), never as
   shell-syntax prefixes.

### One thing chain 2 learned the hard way

**Log an unrecognised error before sanitizing it.** The scheduling callables collapse anything they
do not recognise into a generic `internal` so no internal state crosses the trust boundary — which is
right, and which also meant an intermittent `10 ABORTED: Transaction lock timeout` surfaced as an
unexplainable "The request could not be completed." and cost an instrumented rerun to identify. The
callables now log the raw error server-side first. If you add a chain whose callables sanitize
errors, do the same, or the harness will one day tell you something failed and nothing will tell you
what.

The finding underneath it was real: contention was being reported to callers as a 500 when the
truthful answer was "somebody else was moving this, try again". See
`docs/design/governed-scheduling-domain.md`.

## Known gaps (honest accounting)

- **One chain, not the whole product.** This lane proves the harness pattern works and proves ONE real
  chain (Work Order create → plan → schedule → dispatch → accept → travel → arrive → work-start →
  execution-capture → complete → close) genuinely end-to-end, including its ledger and audit side
  effects. It does not attempt the other 55+ still-uncovered mutating callables — see item 1 above for
  how to pick the next one.
- **Sales Order cancelled / partially-invoiced, and Opportunity LOST fixtures are still missing.** The
  originating review named these three specifically; this lane's edge-cases file closes the same class
  of gap for Work Orders (empty / terminal / cancelled) but does not touch Sales Order or Opportunity
  seed data. That is a natural "next chain" candidate under this same pattern.
- **`transitionWorkOrder`'s Sales Order fulfillment write-back path** (Complete on an SO-linked Work
  Order) is exercised by the existing `functions/test/salesOrderFulfillmentWriteBackEmulator.test.mjs`,
  not by this harness — Chain 1 deliberately uses a Work Order with no `salesOrderId` to keep the first
  proof of the pattern minimal. A future chain could combine the two.
