# UX Journey — C713 × 5, Round 2 (coordinated surfaces exposed)

Pinned build `fd213a6` · D2 MATCH · fixture premise verified before either run
(4 COMPLETED, unit 3 WORK_IN_PROGRESS, `qtyUsed 0/1`). Two personas, **sequential**,
both strictly read-only. Same scenario as Round 1, same three customer questions.

**Dispatcher: FUNCTIONAL FAIL · EXPERIENCE FAIL**
**Technician: FUNCTIONAL FAIL · EXPERIENCE FAIL**

## Did #674 resolve Round 1's findings?

| Round 1 finding | Round 2 result |
|---|---|
| Invisible coordination | **NO** — surface exists, shows different data |
| 13–14 screens / 6 modules | **WORSE** — 19 screens / 6 modules (dispatcher) |
| Unit identity buried in free text | **NO** — still the only disclosure |
| Partial completion unclear | **NO** — still assembled by hand |
| Material blocker context | **PARTIAL** — named; supply status still a dead end |
| Remaining obligation invisible | **NO** |

## Why: the surfaces are read-first on synthetic fixtures

Verified in code **before** spending either agent — `access/coordinatedOperationsSource.js`
defaults to `syntheticCoordinatedOperationsSource()`. Both new surfaces render
fixture data, not the live Work Orders every other module shows.

So the screens purpose-built for this exact question cannot answer it. The
dispatcher still opened five equipment pages one at a time to reach "4 of 5". The
technician still learned the job had five units from one sentence of prose.

**This is not a design failure of #674.** The composition was independently praised —
the technician called Coordinated Mission *"genuinely good design — clear per-unit
cards, color-coded readiness, plain-language blocker text"* and *"the best laid-out
screen in the app"*, then immediately: *"Wasted on synthetic data."* The seam is
built to swap sources without touching the projection or the surfaces. **The
remaining work is wiring, not redesign.**

## Finding — synthetic fixtures reuse a live customer's name · **HIGH** · owner: Design

The fixtures name a customer **"Harbor Grill Downtown"** for a *different* job
(2× C723, SO-4002, both complete) while the live customer is **"Harbor Grill
Restaurant Group / Harbor Grill — Downtown"** (5× C713, one blocked).

Both personas hit this independently. The technician's is the dangerous one — the
synthetic mission shows **`Taylor C713 · unit 3 — COMPLETED`** while their real
assignment shows **`WO-2026-C71303 · unit 3 of 5 · Working`**. Same model, same unit
number, opposite status, adjacent screens.

Disclosure exists (*"Showing a synthetic sample…"*) and is the right instinct, but
the dispatcher's observation is the problem: *"nothing distinguishes it visually
from real rows in the list before you click in."*

**Fix:** rename synthetic entities so they cannot collide with live records, and
separate demo rows from real ones at list level — not only inside the detail. A
labelled fake sitting beside real screens is, in the technician's words,
*"actively misleading under time pressure."*

## Finding — no persona asked for a new Job/Visit authority · **evidence, not a defect**

In Round 1, **all three** personas independently proposed a Job / Visit /
WorkOrderGroup object. In Round 2, with coordination visible, **neither did.**

The asks changed to *"wire Coordinated Visits to real data"* and *"a Job/Sales-Order
grouping that lists sibling WO numbers"* — the **existing** authority, not a new one.
Neither persona was told the object had been proposed, rejected, or that it existed.

This is the strongest available evidence that Product's decision was correct: the
gap was never a missing domain object, it was a missing projection. **Round 1's
convergence should not be re-read as demand for a new authority.**

## Finding — the technician cannot see sibling units · **HIGH**

The technician's assigned list contains **one** of the five units. The other four are
invisible: not their serials, not their status, not who holds them. Job Assignments
correctly refuses the full list (*"You don't have access to the full work order
list"*) — the scoping is right; the coordinated projection is precisely what should
close this, and it is synthetic.

Consequence, in their words: if they finish unit 3 and leave, *"nothing tells me
what's left of the 5-unit install."*

## Finding — parts readiness is honestly UNKNOWN, and that is correct · **not a defect**

*"Parts readiness can't be confirmed" · "Truck stock isn't available for this job" ·
"PRT-1002 — UNKNOWN"*

Exactly right, and the honesty rule holding under pressure is worth recording. The
technician's complaint is not that it says UNKNOWN — it is that UNKNOWN is still the
best the system can do for the one consumable the job needs: *"I'd be driving out
blind."* That is the Service ↔ Inventory seam, unchanged, now confirmed a third time.

## Confirmed again (second/third independent corroboration)

- **Equipment reports `ACTIVE` for the uncommissionable unit** — all five identical.
- **The rejected `PRT-1002` reorder has fallen out of every queue**, dated
  `Invalid Date`, with nothing behind it and no link to the job it blocks.
- **Raw ids shown to operators** — `acct-harbor` on Dashboard and Service Operations
  where every other screen resolves the name.
- **Billing unanswerable** — correctly disclosed capability gap, not a defect.

## Remediated in this round (UX-owned)

Readiness rows showed a bare part code. A technician planning a run read
`PRT-1002 — UNKNOWN` and had to open the scanner and search the code to learn it
meant *Water Inlet Valve*. The readiness projection already carried `name`; the row
now leads with it and keeps the code alongside, since the code is what is printed on
the shelf label and the box. No name resolved ⇒ the code stands alone rather than a
placeholder pretending to be one.

## Service IA evidence status

Still **accumulating — no consolidation recommendation.** Round 2 makes the reason
explicit: the dispatcher's module count did not fall when a coordination surface
appeared, because that surface is not connected. Judging whether Jobs / Scheduling /
Dispatch / Service Operations should consolidate, while the screen that would most
change the traversal is disconnected, would be deciding IA from a substrate that has
not yet been exercised. **Re-run after the live source lands** — that is the decisive
measurement.

## Operational customer risk — assessment against canonical facts

Per Owner direction, assessed only against facts that **exist**:

| Fact | Exists? | Where |
|---|---|---|
| Partial completion | YES | WO statuses grouped by `salesOrderId` |
| Blocked execution | YES | WO status + diagnosis |
| Material readiness | YES, as READY/ATTENTION/**UNKNOWN** | parts-readiness projection |
| Remaining obligation | DERIVABLE | complete vs total in the `salesOrderId` group |
| Scheduled commitment | PARTIAL | scheduling exists; no customer-facing promise |
| SLA / promise date / ETA | **NO** | nothing canonical |

An honest operational-attention signal is derivable from the first four **without
inventing anything** — the group is incomplete, one member is blocked, and its
material state is UNKNOWN. What is **not** derivable is anything time-based: no SLA,
no promised date, no ETA, no severity score. Any "at risk *by when*" claim would be
fabrication.

**Recommendation:** an attention signal, if built, must be a statement of governed
fact (*"1 of 5 incomplete · blocked · material UNKNOWN"*), never a score, and must
not reuse Opportunity attention semantics — that is a pre-commitment concept and
this is a post-commitment obligation. **Not built. Recorded for the owning
programme.**

## Method

Preconditions verified before either persona: pinned SHA, deployed identity, D2
MATCH, fixture premise. Personas ran sequentially, read-only, credentials via
`loadSandboxPersona`. No mutation; the premise was intact for the second run.
