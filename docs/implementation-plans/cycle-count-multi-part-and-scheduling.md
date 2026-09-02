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

**Sprint Specification:** not yet written. This plan precedes it deliberately: the
first PR changes a stored record shape, and the architectural rulings below had to be
settled before a specification could be written honestly. **They now are.** Writing
the A1 specification is the next gate and is not part of this pass.

**Reviewer note:** this document is self-contained. Every claim about current
behaviour was verified against the source on 2026-09-01. Where a file is named, it is
named so the claim can be checked, not because the reader is expected to open it.

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
   Consequence: **no legitimate operator-tunable value should require source editing
   and a deploy.** This is bounded by ruling D0(ii) below — governed integrity policy
   and capability release gates are not operator knobs, and the principle must not be
   used to demote them into ordinary preferences.

The repository already states the general rule, in `AdminDuplicateRules.jsx`:

> rules are DATA an admin edits here, never behaviour compiled into a screen

There is exactly one violation in cycle counting today, and PR A3 below retires it.

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

## Rulings register

All architectural decisions required to specify A1 are settled.

| Ref | Decision | Ruling |
|---|---|---|
| D0(i) | Governed Location authority | **APPROVED** — single canonical Location authority; no count-specific registry |
| D0(ii) | Countable location types | **GOVERNED** — integrity policy, not ordinary Administration preference |
| D1 | Materiality scope | **APPROVED** — per line; no second sheet-level formula |
| D2 | Partial disposition | **APPROVED** — per-line disposition allowed |
| D3 | Expected snapshot timing | **APPROVED** — truthful per-line `expectedSnapshotAt`; no fictional common instant |
| D4 | Discovered parts | **APPROVED** — normal expected-quantity authority; "not prelisted" is not "expected 0" |
| D5 | Line identity | **APPROVED** — one part occupies at most one line per sheet |
| D6 | Atomicity | **APPROVED** — line-level atomic, sheet-level resumable |
| D7 | Concurrent counters | **POSTURE SET** — not built now; shape must not foreclose it |
| — | A1-first ordering | **APPROVED** |
| — | A4 mechanism | **APPROVED** — trusted read callable is the primary design |
| — | A4 + A5 | **APPROVED** — one activation unit, in that order |

---

## Architectural rulings

### D0 — Count location scope and the governed location identity

**D0(i) — Governed Location authority. APPROVED.**

A sheet is scoped to a location, so the location model is part of the stored record
shape rather than an incidental parameter. There is exactly one authority that answers
"is this a real, active location, and what is its canonical identity" — the same
authority Transfer and Receiving resolve against. Cycle Count persists a **governed
location reference**, never an ad-hoc string and never a count-specific registry.
Identifying which existing registry is canonical is an A1 implementation task, not an
open architectural question.

**D0(ii) — Countable location types are GOVERNED, not ordinary Administration data.**

Two concepts are distinct and must not be collapsed:

- **(A) Location configuration** — site, area, aisle, bay, bin, location status,
  label and display configuration, and other legitimate physical-location
  administration. These may be Administration data where already authorized.
- **(B) Cycle-count eligibility policy** — which governed location types may
  *legally be counted*. This has stock-integrity consequences and is therefore
  governed authority.

Current eligible scope remains `WAREHOUSE` and `MOBILE`. **The stored Cycle Count
shape must not encode those as permanent schema limitations.** Persist the governed
location identity/reference only. At command time:

1. resolve the governed location;
2. determine its type;
3. validate that type against the currently authorized Cycle Count location-type
   policy;
4. refuse if that type is not eligible.

Future support for `BIN` or any other governed location type is therefore a
**policy and validation change, not a Cycle Count record migration.**

**Nuance that must not be lost:** "governed" does not necessarily mean "a source-code
constant forever." A future implementation may store this policy as data — but
changing it must still require an appropriately governed and audited authority. The
no-developer-tooling principle must not be used to demote stock-integrity scope into a
normal Admin preference.

### D1 — Materiality is per line. APPROVED.

Materiality is evaluated per line. **No second sheet-level materiality formula is
created.** Sheet review and completion state are *derived* from line states. A
material variance on one line cannot be diluted by clean lines elsewhere on the
sheet — that dilution is the exact integrity failure the separation-of-duties guard
exists to prevent.

### D2 — Partial, per-line disposition is allowed. APPROVED.

A manager may approve some lines and reject others. One disputed line does not force a
whole-sheet recount. Prefer **line state plus derived sheet completion** over a second,
elaborate sheet-level state machine. See D6 for the atomicity this implies.

### D3 — Expected quantity is snapshotted per line, and the timestamp must be truthful. APPROVED.

The current design snapshots expected quantity at create time, which works because the
single part is known then. A "walk the shelf and scan whatever is in front of you"
sheet does not know its part list at create time.

**Every line persists `expectedSnapshotAt`: the actual server timestamp at which that
line's authoritative expected quantity (or expected serial set) was computed.**

Two working modes, one shape:

- **Walk-the-shelf** — a scan opens a line, and that is when the server computes and
  stamps that line's snapshot. Rolling per-line snapshots by construction.
- **Scheduled or prelisted** — the sheet may pre-open or establish its lines from a
  determined part list, but **each line still records its own actual snapshot
  instant.**

**Do not claim a shared `expectedSnapshotAt` unless it is objectively true.** A
scheduled sheet that predetermines 200 lines at 09:00 and then computes their
snapshots separately truthfully records:

```
line   1    expectedSnapshotAt 09:00:01
line  50    expectedSnapshotAt 09:00:07
line 200    expectedSnapshotAt 09:00:24
```

That is correct and must be recorded as such. **A predetermined line set is a WORK
PLAN. It is not automatically an atomic inventory snapshot.**

A genuine common "inventory as of 09:00" across all lines would require an explicit
point-in-time ledger capability. **That capability does not exist today and this plan
does not imply it does.** Consequently the sheet carries **no sheet-level common
`expectedSnapshotAt`** unless such a capability is built and the value is objectively
true.

The blind-count guarantee is unchanged in both modes: a line's snapshot is computed
before any counted value is recorded for that line, and is never returned to the
client before that line is submitted.

### D4 — A discovered part uses the normal expected-quantity authority. APPROVED.

On a location-scoped sheet, an operator will scan parts that were not prelisted. That
is a normal and valuable outcome, not an error. Today it is refused as `WRONG_PART`.

**"Not prelisted" does not mean "expected quantity is zero."** These are entirely
different statements and conflating them would corrupt the count. A part absent from a
predetermined line set may well have a substantial ledger balance at that location —
that is precisely the case worth catching. **The sheet's line set is a work plan; it
is never an expected-quantity authority.**

A newly discovered part opens a line through **the same path any other line opens
through**: the server computes its expected quantity from the normal authority (the
location-aware operational ledger for `NONE`, the serialized asset registry for
`SERIAL`) at line-open, and stamps `expectedSnapshotAt` like any other line. There is
no separate "unexpected line" code path and no separate expected-quantity rule.

**Expected quantity is 0 only when that authoritative calculation returns 0.** If
physical stock is then observed against an authoritative expected 0, the existing
materiality behaviour applies unchanged — a discrepancy against a zero expected
population is material unconditionally, so stock found where the ledger says there is
none always reaches a manager. That outcome is **inherited, not newly invented, and
must never be reached by assuming zero.**

### D5 — One part occupies at most one line per sheet. APPROVED.

A part appears on a sheet zero times or once — never twice. Enforced **server-side**
at line-open, not in the UI.

A re-scan or re-open of the same part **resolves to the existing line** rather than
creating a second one. For `SERIAL` tracking, serial observations belong **under that
part's single line**; they never create duplicate part lines. This prevents a second
expected snapshot being taken for the same part on the same sheet through accidental
duplicate-line creation.

This invariant is what makes `(sheetId, partId)` a sound line identity. Without it,
replay detection is meaningless and a sheet can silently double-count.

**Idempotency fingerprints:** the sheet on `(location, idempotencyKey)`, each line on
`(sheetId, partId)`, with all server-computed values excluded — `expectedQuantity`,
`expectedSerialNumbers` and `expectedSnapshotAt` are outside the fingerprint, so a
later ledger movement can never make a legitimate replay look like a conflict.

### D6 — Line-level atomicity is absolute; sheet-level progress is resumable. APPROVED.

`computeExpectedQuantityThroughTxn` issues **one Firestore query per part inside the
create transaction**, and pulls every ledger document for that part to filter by
location in memory. Fine for one part; a 200-line sheet would issue 200 queries in a
single transaction and will not hold.

**What is given up, precisely: sheet-level atomicity. Never line-level atomicity.**
The sheet is not a transactional unit. The line is.

The sheet is a parent document with line subdocuments. **Line-open** is one
transaction (resolve the part, enforce the one-line invariant, compute the snapshot,
stamp `expectedSnapshotAt`, write the line). **Line submit** is one transaction
(record counted quantity or serials, compute variance, move that line to `COUNTED`).

**Line disposition is one transaction that must atomically:**

- read current line state;
- verify actor capability;
- enforce separation of duties;
- verify the disposition;
- establish any required variance and reason conditions;
- stage that line's ledger adjustment evidence;
- mark that same line disposed and reconciled (or rejected);
- commit as one unit.

**There must never be a state where** a line says `RECONCILED` but its ledger evidence
is missing, or ledger evidence exists while the line still appears unreconciled
because the second half failed.

A multi-line operation is a **sequence of line transactions**, not one large
transaction. "Approve all" over 200 lines is 200 line transactions.

**Failure semantics, stated rather than assumed.** On failure at line 137 of 200:

- **lines 1–136:** conclusively committed — disposed with their ledger evidence
  staged. **Not rolled back.** Their dispositions were correct when made and remain
  correct.
- **line 137:** `COUNTED`, untouched. Its transaction either committed or did not;
  there is no half-state.
- **lines 138–200:** `COUNTED`, untouched.
- **the sheet:** still open, honestly showing a mix of disposed and undisposed lines.

The operation is **resumable, not restartable.** A retry treats already-disposed lines
as idempotent no-op successes, continues with the remaining lines, and never
double-stages ledger evidence. A partially disposed sheet is a legitimate, displayable
state — not a corrupted one.

### D7 — Concurrent counters: posture set, not built.

**Can multiple employees work the same sheet concurrently?**

**Ruling: do not build collaborative multi-user counting.** It is not required now and
YAGNI applies. The current UI and workflow may remain single-operator if that is the
smallest correct first release.

**However, the A1 stored shape must not make multi-counter support expensive later.**
Counter and audit identity belongs at **line level** where relevant, not solely at
sheet level. A line should be able to carry truthful server-recorded evidence such as
`openedBy`, `submittedBy`, `expectedSnapshotAt`, and submission and disposition
timestamps and actors as appropriate — following existing repository audit conventions
and the smallest correct shape. **Do not invent fields the existing audit model does
not need.**

The invariant that matters: **the schema must not assume a single permanent
sheet-level counter identity is the only possible counter for every line.**

This is an architectural posture, not a promise to implement collaboration.

---

## Blind count on multi-line sheets — a per-line, server-enforced redaction

Multi-line sheets create mixed states within a single record. A sheet may hold:

```
line A   SUBMITTED
line B   SUBMITTED
line C   OPEN, being counted
line D   unopened
```

**A durable cross-session read must not expose the expected quantity for C or D merely
because A and B have been submitted.** Redaction is **line-scoped**:

```
for each line:
    if that line has reached the point at which expected may lawfully be revealed:
        expected may be returned
    else:
        expected is omitted / redacted server-side
```

This must not rely on hidden UI fields, frontend conditionals, a "review mode", or
sheet-level status. **Expected values for unsubmitted lines must not appear in raw
callable or network responses either** — the same standard the single-part
implementation already meets.

This extends Non-negotiable #1 and binds A4 in particular.

---

## PR breakdown

One row per planned PR, in dependency order. Track A and Track B are independent and
may run concurrently. A3 is structurally independent of all of them.

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| A1 | Cycle count sheet: record shape + commands | Stored schema change; governed location reference; line-level transaction boundaries; blind-count and SoD preservation across N lines | Rulings final (all settled) | Ready to specify |
| A2 | Cycle count sheet: scan session + workspace | Scan resolves to a line instead of refusing; one-line invariant; per-line review UI | A1 | Not started |
| A3 | Materiality thresholds to Administration | Config-as-data; retires the last env-var operator knob | — (independent) | Not started |
| A4 | Durable cross-session visibility of cycle count sheets | Trusted read boundary; per-line expected redaction; capability, tenant, location and actor scoping | A1 | Not started |
| A5 | Capability activation + role grants | **Tier 2** governance; which role submits, reviews, reconciles | A2, A4 verified | Owner-gated |
| A6 | Scheduling: `abcClass`, `lastCountedAt`, parts-due query | Derived list, not a stored calendar; frequency table is admin data | A5 | Not started |
| B1 | Label generation: part labels and location labels | One dependency (`bwip-js`); HTML print view; symbology is Administration configuration; labels resolve through the shared scan identity boundary | — | Not started |

---

## Sequencing notes

**A1 first — approved.** A1 is first in the Cycle Count *structural dependency chain*.
It is the only item that gets more expensive with time: it reshapes the stored record,
which costs nothing before real counts exist and means maintaining a v1 and v2 reader
against `CYCLE_COUNT_SCHEMA_VERSION` indefinitely afterwards. There are no usable
counts today and the capabilities are inactive, so this is the correct moment to change
the model. **Do not activate the existing one-part shape merely to gather history** —
that deliberately manufactures migration debt.

**"A1 first" does not mean unrelated work waits.** A3 is structurally independent and
may merge before A1. So may Track B. The ordering constrains the Cycle Count structural
chain, nothing else.

**A4's mechanism: a trusted read boundary is the primary design — approved.** The
requirement is durable cross-session visibility of cycle count sheets. Direct Firestore
client reads are **not** the default solution. `cycle_counts` may remain client-denied.

The trusted server-side read boundary (conceptually a list and a get; final naming
follows repository conventions) must enforce:

- capability and read authority;
- company and tenant scope;
- location scope;
- actor eligibility;
- record visibility;
- state-based projection — including the per-line expected redaction above.

A direct `firestore.rules` read change is a **fallback only**, if a concrete
requirement later proves the callable inadequate. Such a proposal needs explicit
justification and Tier 2 treatment.

**A4's own implementation can be a routine repository change** if it introduces no
governed authority change. A5 remains the governance and activation gate for the
authorities needed to actually use the feature.

**A4 and A5 remain one activation unit, in this order:**

```
build the durable reviewer read path
    -> verify it
    -> activate and grant the required capabilities
    -> go live
```

**Never activate A5 before the durable reviewer read path exists and is verified.**
Separation of duties forbids the submitter from disposing of their own material
variance; without durable visibility, the only person who can see a pending count is
the one person forbidden to close it. A5 alone is not a working feature; it is a dead
end.

**Do not automatically couple "can read or review a sheet" to "can reconcile a
sheet."** If the capability model supports keeping those authorities distinct, keep
them distinct.

**A6 is last.** `lastCountedAt` is written by completed counts. Built before go-live,
the parts-due query computes over an empty table and cannot be validated against
anything real.

**Track B is independent.** Label generation touches no cycle count command code and
is not blocked by the Cycle Count chain.

---

## External dependencies

- **Owner Tier-2 authorization for A5** — capability activation and role grants. Not a
  routine repo change; does not proceed autonomously.
- **Owner Tier-2 authorization for A4 only if** the trusted read boundary is rejected
  in favour of a `firestore.rules` change. The primary design needs no Rules change.
- **A5 requires a role split.** Separation of duties is only enforceable if `submit`
  and `reconcile` can be held by different principals. Which roles hold which — and
  whether review is a third, distinct authority — is an Owner decision.
- **B1 requires operational input, not an architectural decision:** what scanning
  hardware is in use (this informs *default* symbology, it does not define the data
  model), and whether label output is thermal (Zebra/ZPL, needing a print bridge) or
  laser plus label sheets (needing nothing beyond an HTML print view).
- **`firestore.rules` is not auto-deployed** in this repository. If A4 ever falls back
  to a Rules change, merged is not live and a manual deploy and verification step is
  required.

---

## Barcode labels — the resolution model (B1)

A label does **not** have to encode or expose an opaque database identifier. The model
is resolution, not encoding:

```
physical / business location
    -> human-readable code
    -> barcode or configured representation
    -> shared scan identity resolver
    -> governed Location identity
```

A physical label may carry a canonical business or display code, a governed scanner
token, a governed alias, or another approved representation.

**Required invariant: every location barcode resolves, through the shared scan
identity boundary, to exactly one governed Location record.** No separate barcode
location registry and no second location authority — the same rule already applied to
part identifiers.

B1 covers **both part labels and location labels**. Symbology is Administration
configuration where appropriate; hardware informs defaults but does not define the
data model.

---

## Explicitly out of scope

- **Count templates and custom count calendars**, which the Insight Works app
  advertises. Once A6 computes "which parts are due today," there is no saved
  selection left to template. Revisit only if an operator is observed repeating a
  manual selection.
- **Bin-level counting — current scope only.** `WAREHOUSE` and `MOBILE` are the
  eligible types today. Per D0(ii) this is eligibility *policy*, not a schema
  limitation, and the record shape must not encode that bins can never be countable.
- **Collaborative multi-counter sheets** — see D7. Not built; not foreclosed.
- **A point-in-time ledger snapshot capability** — see D3. Does not exist and is not
  implied.
- **`LOT` tracking**, consistent with the existing Receiving and Transfer posture.
- **Adopting either Insight Works app.** Both are Business Central-only.

---

## Non-negotiables for any implementation

Any plan that breaks one of these is wrong, regardless of how much simpler it is:

1. **The blind count survives.** No expected figure reaches the client — in the UI or
   in a raw network response — before that **line** is submitted. **Expected-value
   redaction is per-line and server-enforced in durable reads**, never a UI condition
   and never gated on sheet-level status.
2. **Separation of duties survives.** The principal who submitted a line cannot
   dispose of that line's material variance. Enforced server-side, inside the
   transaction that reads and writes the record. A hidden button is not a control.
3. **No second on-hand authority.** Expected quantity comes only from the
   location-aware operational ledger (`NONE`) or the serialized asset registry
   (`SERIAL`) — never a maintained number, and never inferred from the sheet's
   planned line set.
4. **Observation is not adjustment.** Submitting records what was seen and moves no
   stock. Only reconciliation stages ledger evidence, under a separate capability.
5. **No legitimate operator-tunable value requires source editing and a deploy.**
   Thresholds, frequencies, symbologies and label definitions are Administration data.
   Capability `active` flags and governed integrity policy — including cycle-count
   location-type eligibility — are **not** normal operator knobs and this principle
   does not demote them.
6. **Line reconciliation is atomic.** A line's disposition and that line's ledger
   evidence commit in one transaction, always. Sheet processing may partially
   progress; an individual line's disposition and evidence may not. A partially
   reconciled line must not be representable.
7. **No parallel Location authority.** Cycle Count references the governed Location
   identity. Scanning *resolves* that identity; it never creates another warehouse or
   bin registry.

---

## Open architectural decisions before A1

**None.** Every decision required to write the A1 specification is settled and
recorded in the rulings register above.

Two items remain outstanding but are **not** architectural blockers for A1:

- **A5's role split** — which roles hold `submit`, review, and `reconcile`. An Owner
  governance decision, needed at A5, not at A1.
- **B1's operational input** — scanning hardware and label output medium. These set
  defaults and procurement, not the data model, and do not block B1's architecture.

**A1 specification gate: READY.**
