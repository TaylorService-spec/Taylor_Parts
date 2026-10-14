---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-09-01
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Implementation Plan: Cycle Count — multi-part count sheets, then activation and scheduling

**Sprint Specification:** none yet — this plan precedes it deliberately. The first
PR changes a stored record shape, and the decisions in *Decisions required* below
must be ruled on before a specification can be written honestly.

**Reviewer note (ChatGPT):** you do not have repository access. Everything you need
is restated below, and every claim about current behaviour was verified against the
source on 2026-09-01. Where a file is named, it is named so the Owner can check the
claim, not because you are expected to open it.

---

## Why this exists

The Owner reviewed two Insight Works apps for Microsoft Dynamics 365 Business
Central — *Advanced Inventory Count* (with its free *Cycle Count Scheduler*
companion) and *Barcode Generator PowerTool*. Neither is adoptable: both are
Business Central-native extensions and this system is not Business Central. They
were reviewed as a **requirements checklist**, and this plan is the result.

Two Owner constraints frame the whole plan:

1. **Incorporate the capability, not the product.** Build the features ourselves.
2. **No developer tooling for any operator, ever.** The Barcode Generator video is
   an 11-minute screencast of a developer writing AL code in VS Code and laying out
   a report in Microsoft Report Builder — the label design lives in source, so every
   label change is a deploy. That is the failure mode being explicitly avoided.
   Consequence for this plan: **every operator-tunable value is Administration data,
   never an environment variable and never a source constant.**

The repository already states this rule, in `AdminDuplicateRules.jsx`:

> rules are DATA an admin edits here, never behaviour compiled into a screen

There is exactly one existing violation in cycle counting, and PR A3 below retires it.

---

## What exists today (verified, not assumed)

The Cycle Count operating authority is **built and unusable**.

**Backend** — `functions/src/cycleCount/` (~1,600 lines across 9 modules):

- Lifecycle: `OPEN -> COUNTED -> RECONCILED | REJECTED`, plus `OPEN -> CANCELLED`.
- **One count document covers exactly one part at one location.** Locations are
  currently fenced to `WAREHOUSE` and `MOBILE` (truck), matching the fence of the
  shared location resolver this module reuses. Tracking modes are `NONE` and
  `SERIAL`; `LOT` is deferred.
- **Blind count is server-enforced, not a UI choice.** The expected quantity is
  snapshotted server-side at create time and is *not returned in the create
  response* — it first appears in the submit response, by which point the counted
  value has already left the counter's hands in the same request. A user reading the
  raw network response in devtools cannot find it either.
- **Separation of duties is server-enforced.** `reconcileCycleCount` refuses when the
  disposing actor is the same principal recorded as `submittedBy` **and** the
  variance is material. Distinct failure code `SEPARATION_OF_DUTIES`.
- **Materiality** is a dual absolute-OR-relative rule: material if the discrepancy is
  >= 3 units OR >= 10% of the expected population. Both bounds are read from
  environment variables (`CYCLE_COUNT_MATERIALITY_ABS_UNITS`,
  `CYCLE_COUNT_MATERIALITY_PCT`) at call time, failing closed to those defaults. The
  defaults have never been tuned — there is no count history to tune against.
- **Expected quantity has a single authority.** For `NONE` mode it is the
  location-aware operational ledger summed at the `(partId, location)` pair
  (`RECEIVED`/`RETURNED`/`TRANSFER_IN` positive, `TRANSFER_OUT`/`SCRAPPED` negative,
  `ADJUSTED` signed; a prior count's own `COUNTED` snapshot is deliberately excluded
  so it cannot compound with itself). For `SERIAL` mode it is the `serialized_assets`
  registry's `AVAILABLE` units at the location. **There is no second, manually
  maintained on-hand number anywhere in this path.**
- Reconciliation stages `ADJUSTED` ledger evidence; it never overwrites stock truth.
  A reason is required on any non-zero variance, on both approve and reject.

**Frontend** — `field-ops-app-vite/src/modules/inventory/CycleCounts.jsx`,
`src/domain/cycleCountScanSession.js`, `src/hooks/useCycleCountActions.js`:

- Manual entry and barcode/scan entry both exist. The scan path reuses the existing
  shared scan identity boundary (`src/domain/scannedIdentity.js`) rather than
  standing up a second scanner.
- Scanning a *different* part is refused outright:
  `WRONG_PART: "That is a different part. Count it separately."`
- **There is no durable read.** The `cycle_counts` collection is Rules-denied to
  every client (Admin-SDK-only, matching `receiving_orders`). The workspace list is
  session state assembled entirely from callable responses — "history" means "what
  this browser tab did this session."

**Activation state — the reason none of this is usable:**

All four capabilities are registered `active: false` and granted to **no role**:
`inventory.cycleCount.create`, `.submit`, `.reconcile`, `.cancel`. No compatibility,
default, or operational role holds any of them; no claims initializer, migration, or
fixture mints them; there is no superuser or wildcard bypass. Every real attempt
resolves `permission-denied` server-side today.

**Barcode generation does not exist at all.** The system reads barcodes well (a
10-type alias registry with GS1 digit-length validation, a scan resolver, five
consuming surfaces) but cannot produce one. There is no barcode or QR dependency in
either `package.json`.

---

## Decisions required before PR A1 can be specified

These are the material calls. They are listed first because A1 changes a stored
record shape, and getting them wrong is a migration rather than an edit.

### D0 — Count location scope and the governed location identity

A sheet is scoped to a location, so the location model is now part of the stored
record shape rather than an incidental parameter. Two things must be settled before
A1, and they are not the same question.

**(i) What is the governed Location authority?** Every line's expected quantity is
computed at a `(partId, location)` pair. There must be exactly one authority that
answers "is this a real, active, countable location, and what is its canonical
`locationId`" — the same authority Transfer and Receiving resolve against, not a
second registry stood up for counting.

**(ii) Is the current `WAREHOUSE`/`MOBILE` fence a scope statement or a permanent
one?** It is a **scope statement about today, and must be persisted as such.** An
earlier draft of this plan wrote bins off as "not modelled"; that was wrong, and this
plan does not carry the assumption forward. Bin-level counting is not being built in
A1 and is not being designed for in A1, but the record shape must not make it a
migration if the Location authority later admits `BIN` (or any other type) as
countable.

*Claude Code recommendation:* the sheet and each line persist a governed
`locationId` plus its resolved `locationType`, sourced from the single Location
authority. The countable-type fence lives in **that authority and in the command's
validation**, never as a shape constraint baked into the stored record — so widening
the fence later is a validation change and a capability decision, not a schema
migration. `WAREHOUSE` and `MOBILE` are the countable types today; nothing in the
persisted shape should encode that this is permanent.

**Open for your ruling:** whether the countable-type fence should additionally be
Administration data (an operator-editable list of countable location types) or remain
a governed code-level list changed only under Tier 2. The no-developer-tooling rule
argues for the former; the fact that admitting a location type has stock-integrity
consequences argues for the latter. Claude Code leans **governed code-level under
Tier 2**, because it is a capability boundary rather than an operator preference, but
this is exactly the kind of call this plan should not make alone.

### D1 — Is materiality per line, or per sheet?

Today there is one variance per record, so the question does not arise. On a 200-line
shelf sheet where 199 lines are clean and one is off by 40 units, is the *sheet*
material? The separation-of-duties guard depends on the answer.

*Claude Code recommendation:* **per line.** The guard should block self-approval of
any line that trips materiality, and leave clean lines disposable by the same actor.
Per-sheet materiality would let a large clean sheet dilute a serious single-line
discrepancy below the threshold — the exact integrity failure the guard exists for.

### D2 — Is partial approval allowed?

Can a manager approve 198 lines and reject 2? If yes, `reconcileCycleCount` moves
from one decision to a per-line disposition, and `ADJUSTED` ledger events stage per
approved line. If no, one disputed line blocks the whole sheet and the counter
recounts everything.

*Claude Code recommendation:* **yes, per-line disposition.** All-or-nothing turns a
single disputed line into a full recount of the shelf, which is precisely the
operator cost this whole change exists to remove. See D6 for the atomicity this
implies.

### D3 — When is a line's expected quantity snapshotted?

This is the subtlest decision and it interacts directly with the blind count.

The current design snapshots expected quantity at **create** time, before any
counting. That works because the record's single part is known at create. A
"walk the shelf and scan whatever is in front of you" sheet does not know its part
list at create time.

Two shapes:

- **(a) Predetermined line set.** The sheet is opened against a known part list
  (from a filter, a category, or later the scheduler), and every line's expected
  quantity is snapshotted at sheet create. Preserves the existing model exactly.
  Loses the walk-the-shelf workflow that motivated the change.
- **(b) Per-line snapshot at line-open.** A scan opens a line, and *that* is when
  the server snapshots that part's expected quantity. Preserves walk-the-shelf. The
  blind-count guarantee is unchanged — the snapshot still happens before any counted
  value is recorded for that line, and is still never returned until submit.

*Claude Code recommendation:* **(b)**, with (a) available as a variant once the
scheduler exists (a scheduled sheet naturally arrives with its line set already
determined). Both must obey the same rule: **the expected figure is never returned to
the client before that line's count is submitted.**

**Rolling snapshots, and why they must be visible in the record.** Under (b) there is
no single sheet-wide "as of" instant. A sheet opened at 09:00 and worked until 11:20
holds lines snapshotted at different times, and a receipt posted at 10:00 will be
inside some lines' expected figures and outside others'. That is correct behaviour —
each line's expected figure must reflect the ledger as of the moment that line was
opened, not the moment the sheet was — but it is invisible and misleading unless the
record says so.

*Therefore:* **each line persists `expectedSnapshotAt`**, the server timestamp at
which that line's expected quantity or expected serial set was computed. The sheet
carries no common snapshot timestamp, because it has none. Variance on a line is
always interpretable against its own `expectedSnapshotAt`, and a reviewer looking at
a wide-open sheet can see how stale each line is. Under variant (a) every line simply
carries the same `expectedSnapshotAt` — the field is not special-cased, and the two
variants stay one shape.

### D4 — What happens when a part is found that the sheet did not expect?

On a location-scoped sheet, an operator will scan parts that were not prelisted. That
is a normal and valuable outcome, not an error. Today it is refused as `WRONG_PART`.

**"Not prelisted" does not mean "expected quantity is zero."** These are two entirely
different statements and conflating them would corrupt the count. A part absent from
a predetermined line set may well have a substantial ledger balance at that location —
that is precisely the case worth catching. The sheet's line set is a *work plan*; it
is never an expected-quantity authority and must never be treated as one.

*Claude Code recommendation:* a newly discovered part opens a line through **the same
path any other line opens through** — the server computes its expected quantity from
the normal authority (the location-aware operational ledger for `NONE`, the
serialized asset registry for `SERIAL`) at line-open time, and stamps
`expectedSnapshotAt` like any other line. There is no separate "unexpected line" code
path and no separate expected-quantity rule.

**Expected quantity is 0 only when that authority returns 0.** In that case the line
behaves exactly as the existing materiality rule already specifies — a discrepancy
against a zero expected population is treated as material unconditionally, so stock
found where the ledger says there is none always reaches a manager. That outcome is
inherited, not newly invented, and it must not be reached by assuming zero.

### D5 — What does the idempotency fingerprint cover, and the one-line invariant

Today the fingerprint covers the request-derived identity only
(`partId`, `trackingMode`, `location`, `idempotencyKey`) and deliberately excludes
the server-computed snapshot, so that a later ledger movement cannot make a legitimate
replay look like a conflict. The sheet-level equivalent must preserve that property.

**Invariant: one part occupies at most one line per sheet.** A part appears on a sheet
zero times or once — never twice. This is what makes `(sheetId, partId)` a sound line
identity, and it is the rule that makes a re-scan of an already-counted part an
*update to that line* rather than a second line. Without it, `(sheetId, partId)` is
not unique, replay detection is meaningless, and a sheet can silently double-count.
The existing scan session already has the vocabulary for this on the serial side
(`DUPLICATE_SERIAL`); the quantity side needs the same discipline at the line level.

*Claude Code recommendation:* fingerprint the sheet on
`(location, idempotencyKey)` and each line on `(sheetId, partId)`, with the same
exclusion of all server-computed values — `expectedQuantity`,
`expectedSerialNumbers` and `expectedSnapshotAt` are all outside the fingerprint.
Enforce the one-line invariant server-side at line-open, not in the UI.

### D6 — Transaction shape and failure semantics

`computeExpectedQuantityThroughTxn` issues **one Firestore query per part inside the
create transaction**, and pulls every ledger document for that part to filter by
location in memory. This is fine for one part. A 200-line sheet would issue 200
queries in a single transaction and will not hold.

**What is given up, precisely: sheet-level atomicity — never line-level atomicity.**
The sheet is not a transactional unit. The line is.

*Claude Code recommendation:*

- The sheet is a parent document with line subdocuments.
- **Line-open** is one transaction: resolve the part, enforce the one-line invariant,
  compute the expected snapshot, stamp `expectedSnapshotAt`, write the line.
- **Line submit** is one transaction: record the counted quantity or serials, compute
  variance, move that line to `COUNTED`.
- **Line disposition is one transaction, and it includes that line's ledger
  evidence.** A single transaction takes the line from `COUNTED` to `RECONCILED` (or
  `REJECTED`) *and* stages the `ADJUSTED` ledger events for that line. These never
  split. There is no state in which a line is marked reconciled but its ledger
  evidence is missing, or in which ledger evidence exists for a line that is not
  marked reconciled.
- **A multi-line operation is a sequence of those line transactions**, not one large
  transaction. "Approve all" over 200 lines is 200 line transactions.

**Failure semantics, stated rather than assumed.** If a multi-line operation fails
part-way — at line 137 of 200 — the resulting state is:

- lines 1 to 136: **fully complete**, disposed and with ledger evidence staged, and
  they are **not rolled back**. Their dispositions were correct when made and remain
  correct.
- line 137: **`COUNTED`, untouched.** Its own transaction either committed or did not;
  there is no half-state.
- lines 138 to 200: **`COUNTED`, untouched.**
- the sheet: still open, showing an honest mix of disposed and undisposed lines.

The operation is therefore **resumable, not restartable** — retrying disposes only the
lines still in `COUNTED`, and already-disposed lines are replays that no-op rather
than double-staging ledger evidence. A partially disposed sheet is a legitimate,
displayable state, not a corrupted one.

**A partially reconciled line must never exist.** That is the single thing this shape
protects, and it is why atomicity is surrendered at the sheet boundary rather than
anywhere lower.

**This is the item most in need of your architectural review.** The trade is explicit:
a sheet is no longer all-or-nothing, in exchange for a shape that scales and for a
guarantee that each line's stock effect is atomic with its own disposition.

---

## PR breakdown

One row per planned PR, in dependency order. Track A and Track B are independent and
may run concurrently.

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| A1 | Cycle count sheet: record shape + commands | Stored schema change; governed location identity; line-level transaction boundaries; blind-count and SoD preservation across N lines | D0-D6 ruled | Not started |
| A2 | Cycle count sheet: scan session + workspace | Scan routes to a line instead of refusing; one-line invariant; per-line review UI | A1 | Not started |
| A3 | Materiality thresholds to Administration | Config-as-data; retires the last env-var operator knob | — (independent) | Not started |
| A4 | Durable cross-session visibility of COUNTED sheets | **Trusted read callable evaluated first**; new read capability; Rules change only if a callable is shown insufficient | A1 | Not started |
| A5 | Capability activation + role grants | **Tier 2** governance; which role submits vs. reconciles | A2, A4 | Owner-gated |
| A6 | Scheduling: `abcClass`, `lastCountedAt`, parts-due query | Derived list, not a stored calendar; frequency table is admin data | A5 | Not started |
| B1 | Label generation: part labels and location labels | One dependency (`bwip-js`); HTML print view; symbology is Administration configuration | D0 (location identity) | Not started |

---

## Sequencing notes

**Why A1 is first, ahead of activation.** It is the only item that gets more
expensive with time. It reshapes the stored cycle count record; done before any real
counts exist it costs nothing, done after it means maintaining a v1 and v2 reader
against `CYCLE_COUNT_SCHEMA_VERSION` indefinitely. The Owner has taken this path
deliberately, accepting a later go-live in exchange for no migration.

**Why A4 and A5 ship as one unit.** This is the trap in this plan and it must not be
split. Separation of duties forbids the submitter from approving their own material
variance, and today the workspace list is session-only. Granting the capabilities
*without* durable cross-session visibility produces counts that can be created and
submitted but **never closed** — the only person who can see a pending count is the
one person forbidden to dispose of it. A5 alone is not a working feature; it is a
dead end.

**A4 is a requirement, but the mechanism is open — evaluate the callable first.**
Durable cross-session visibility is mandatory before activation. Direct Firestore
client read access is *one* way to provide it and should not be assumed to be the
way. `cycle_counts` is deliberately Admin-SDK-only today, matching `receiving_orders`,
and the whole command surface already returns everything the client renders. A
**trusted read callable** — server-side authorization, no client read grant, no
`firestore.rules` change — preserves that posture, keeps the collection closed, and
avoids a Tier 2 Rules deploy for what is fundamentally a "let a manager see pending
work" requirement. Direct client reads buy live listeners and client-side query
flexibility; that should be shown to be needed before it is bought, because the price
is opening a governed collection.

*Claude Code recommendation:* specify A4 as a trusted read callable
(`inventory.cycleCount.read` or equivalent, registered and granted alongside the
others in A5), and treat a Rules-based direct read as a fallback requiring its own
justification. Note that this changes A4's authorization tier: a callable is a
routine repo change, whereas the Rules fallback is Tier 2.

**Why A6 is last.** `lastCountedAt` is written by completed counts. Built before
go-live, the parts-due query computes over an empty table and cannot be validated
against anything real.

**Why A3 floats.** It depends on nothing and blocks nothing. It can land at any point;
it is listed third only because it is small and closes the stated no-developer-tooling
gap early.

**Track B is nearly independent.** Label generation touches no cycle count command
code, but it does depend on D0: a printed *location* label encodes the governed
`locationId`, so the location identity must be settled before location labels are
generated. Part labels have no such dependency.

---

## External dependencies

- **Owner Tier-2 authorization** for A5 (capability activation and role grants), and
  for A4 **only if** the trusted-callable approach is rejected in favour of a
  `firestore.rules` change. Neither is a routine repo change and neither proceeds
  autonomously.
- **A5 requires a role split.** Separation of duties is only enforceable if `submit`
  and `reconcile` can be held by different principals. Which roles hold which is an
  Owner decision, not a derivable one.
- **D0 requires confirmation of the governed Location authority** — which existing
  registry is canonical for countable locations, and whether the countable-type fence
  is Administration data or a Tier 2 governed list.
- **B1 requires operational input**, though not a single dictated answer: what
  scanning hardware is in use (dedicated handheld laser, phone camera, or both — this
  informs the *default* symbology, it does not fix it), and whether label output is
  thermal (Zebra/ZPL, which needs a print bridge) or laser plus label sheets (which
  needs nothing beyond an HTML print view).
- **`firestore.rules` is not auto-deployed** in this repository. If A4 falls back to a
  Rules change, merged is not live and a manual deploy and verification step is
  required.

---

## Explicitly out of scope

- **Count templates and custom count calendars**, which the Insight Works app
  advertises. Once A6 computes "which parts are due today," there is no saved
  selection left to template. Revisit only if an operator is observed repeating a
  manual selection.
- **Bin-level counting**, as *current scope only*. `WAREHOUSE` and `MOBILE` are the
  countable location types today. This plan takes no position on whether bins should
  ever be countable, and per D0 the record shape must not encode that they cannot be.
- **`LOT` tracking**, consistent with the existing Receiving and Transfer posture.
- **Adopting either Insight Works app.** Both are Business Central-only.

---

## Non-negotiables for any implementation

Any plan that breaks one of these is wrong, regardless of how much simpler it is:

1. **The blind count survives.** No expected figure reaches the client — in the UI or
   in a raw network response — before that line's count is submitted.
2. **Separation of duties survives.** The principal who submitted a line cannot
   dispose of that line's material variance. Enforced server-side, inside the
   transaction that reads and writes the record. A hidden button is not a control.
3. **No second on-hand authority.** Expected quantity comes from the location-aware
   operational ledger (`NONE`) or the serialized asset registry (`SERIAL`). Never a
   maintained number, and never inferred from a sheet's line set.
4. **Observation is not adjustment.** Submitting records what was seen and moves no
   stock. Only reconciliation stages ledger evidence, under a separate capability.
5. **No operator-tunable value lives in code.** Thresholds, frequencies, symbologies
   and label definitions are Administration data. The single deliberate exception is
   the capability `active` flag, which is a release gate rather than an operator
   setting.
6. **Line-level reconciliation is atomic.** A line's disposition and that line's
   ledger evidence commit in one transaction, always. A partially reconciled line —
   disposed without evidence, or evidence without disposition — must not be
   representable. Sheet-level atomicity is deliberately surrendered; line-level
   atomicity never is.
7. **There is one governed Location authority.** Every sheet and every line resolves
   its `locationId` through the single canonical Location authority, never a
   count-specific registry or an ad-hoc string. Which location types are countable is
   a validation and capability decision made in that authority, not a constraint
   encoded into the stored record shape.

---

## What is being asked of ChatGPT

1. Rule on **D0-D6**, or state where the recommendation is wrong and why.
2. Review **D6 specifically** as an architecture question — sheet-level atomicity is
   being traded for scalability while line-level atomicity is held absolute. Confirm
   the failure semantics as stated are complete, and name anything they miss.
3. Rule on **D0(ii)** — whether the countable-location-type fence belongs in
   Administration data or in a Tier 2 governed list.
4. Assess the **A4 trusted-read-callable recommendation** against direct client
   Firestore reads, and say what would have to be true for the Rules change to be
   justified.
5. Confirm or challenge the **A1-first ordering** against the alternative (activate
   now, accept a dual-version reader).
6. Confirm the **A4+A5 pairing** is understood as a single unit and flag it if you
   disagree.
7. Identify anything in *Non-negotiables* that the multi-line shape quietly breaks
   and that this plan has not noticed.
