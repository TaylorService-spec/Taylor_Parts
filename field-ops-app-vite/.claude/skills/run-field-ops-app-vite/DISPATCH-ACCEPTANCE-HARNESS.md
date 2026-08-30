# Dispatch P1v1 — the acceptance harness, and what each part actually proves

Three harnesses touch the Dispatch board. They produce three green numbers that mean three different
things, and this file exists because collapsing them into "the gate passed" is the specific error
that made half of the P1v1 acceptance work necessary.

## The split that matters

| harness | writes? | number | proves |
| --- | --- | --- | --- |
| `dispatchNorthStarQuickGate.mjs` | no | 27/27 | **composition and honesty** |
| `dispatchCorrectionsProbe.mjs` | no | 14/14 | **what the deployed board draws** |
| `dispatchInteractionPass.mjs` | **YES** | 26/26 | **VC-1..VC-4 as governed writes** |

## 1. `dispatchNorthStarQuickGate.mjs` — READ-ONLY / COMPOSITION

The North Star renders; availability arrives through the trusted callable; the deny-all collections
are never read directly; no lane fabricates a percentage.

> **THE QUICK GATE DOES NOT COVER VC-1..VC-4.** Audited on 2026-08-29: it contains no assertion
> mentioning a windowless record, weekend, outside-band placement, reason prompt, resize, keyboard,
> or past time. It predates those corrections. **A green 27/27 is not evidence that dragging,
> resizing, keyboard manipulation or past-slot refusal work.** If you need that, run the other two.

## 2. `dispatchCorrectionsProbe.mjs` — READ-ONLY / COMPOSITION

    node .claude/skills/run-field-ops-app-vite/dispatchCorrectionsProbe.mjs

What the DEPLOYED bundle draws: the R23 windowless fallback visible and named; today's past region
present with real width and `pointer-events: none`; **no** dead region on a future day; resize grips
and `aria-keyshortcuts` on live chips; distinct geometry offsets; the hour band widening past 7a–5p
for a real out-of-band placement; both availability states on screen with no fabricated percentage.

It navigates to the day the fixtures are on. Its first version read TODAY — an empty, entirely-past
day — and reported three missing affordances that were its own doing. **A probe that reads the wrong
day and reports missing affordances is worse than no probe**, so the day is explicit.

Proves no interaction. Read-only by construction.

## 3. `dispatchInteractionPass.mjs` — MUTATING / GOVERNED INTERACTION

    export GCLOUD_TOKEN=$(gcloud auth print-access-token)
    node .claude/skills/run-field-ops-app-vite/dispatchInteractionPass.mjs

**This one writes.** It schedules, re-times and resizes real fixture Work Orders on
`eos-platform-sandbox`, through the board's own gestures, so the commands issued are exactly the ones
a dispatcher issues.

Safety properties, each deliberate:

- **Target is a constant, not an argument.** `.firebaserc` defaults to `taylor-parts` — production —
  so "no argument" must mean sandbox, never "whatever the CLI would pick". A different project
  argument is refused by name, and the production project appearing anywhere in the resolved target
  aborts before the browser opens.
- **Every claim is confirmed by reading Firestore back.** A board that rendered a move it never
  persisted would pass a purely visual check.
- **A no-op mutation cannot pass.** Each assertion compares before and after (`!==`), so "the
  command ran and changed nothing" fails. This is not theoretical: a fixed drop fraction once landed
  on a chip's own current time, the reschedule succeeded, and the check correctly went red.
- **It restores what it consumes.** Section 1 empties the queue by scheduling its only card; the
  pass returns it through the governed Unschedule so a second run is not testing a different estate.
- **Governed commands only.** No direct Firestore writes. Reschedule and reassign supply the reason
  the server requires; nothing is auto-generated to route around the requirement.

### The harness bugs worth knowing about, because they will recur

Three iterations were needed and **every failure was the harness, not the product**:

1. `dragstart` and `drop` fired in one synchronous block. The lane only attaches `onDrop` once
   `draggingWorkOrder` is in React state, so the drop landed before the handler existed — silently.
   The drag is now split across two evaluates with a wait between.
2. A fixed drop fraction became a no-op once an earlier run had moved the chip there. The target
   fraction is now computed from the chip's current position.
3. Section 1 consumes the queue card, so the past-slot drop (which needs a queued card) ran last and
   found an empty queue. It now runs FIRST, on purpose. **Order is part of the test.**

## If you are about to cite a number

Say which harness produced it. "27/27" answers a question nobody asked about resize.
