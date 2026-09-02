---
artifact_type: specification
gate: Sprint Specification
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

# Sprint Specification: Cycle Count sheet — record shape and commands (A1)

**Architecture Review:** [Cycle Count multi-part and scheduling implementation plan](../implementation-plans/cycle-count-multi-part-and-scheduling.md) — Approved 2026-09-01. Rulings D0–D7, A1-first ordering, A4 mechanism and the A4+A5 activation unit are all settled there; this specification implements A1 and introduces no new architectural decision.

## Executive summary

Cycle Count today stores **one part at one location per document**. A counter walking a shelf must create a separate count for every part, and the scan session refuses anything else (`WRONG_PART: "That is a different part. Count it separately."`). A1 replaces that stored shape with a **sheet of lines**: one sheet scoped to a governed location, one line per part, each line carrying its own expected snapshot, its own count, its own variance and its own disposition.

Every integrity property of the current implementation is preserved and re-expressed per line: the blind count, server-enforced separation of duties on material variance, a single expected-quantity authority, observation-is-not-adjustment, and atomic ledger evidence. What is deliberately surrendered is **sheet-level atomicity** — a multi-line reconcile is a sequence of per-line transactions and is resumable, never restartable.

A1 is a stored-shape and command change only. It grants nothing, activates nothing, changes no Firestore Rules, and adds no UI.

## Sprint objective

Replace the single-part `cycle_counts` record with a sheet-and-line shape, and rewrite the four commands (`create`, `submit`, `reconcile`, `cancel`) against it, at the same integrity standard the current implementation holds — while the capabilities remain `active: false` and ungranted.

## Scope

**Backend — `functions/src/cycleCount/`**

- `cycleCountTypes.ts` — sheet and line types, statuses, failure taxonomy additions.
- `cycleCountRepository.ts` — sheet and line serialize/deserialize, identity, fingerprints.
- `cycleCountValidation.ts` — request-shape validation; **removal of the location-type fence from shape validation** (see D0).
- `cycleCountCommand.ts` — the command family, restructured to sheet and line.
- `cycleCountCommandComposition.ts` — production dependency pinning, extended with the location-type eligibility policy seam.
- `cycleCountCallables.ts` / `cycleCountCallableWiring.ts` — callable surface for the new commands, including per-line redaction of expected values.
- `cycleCountExpectedQuantity.ts` — unchanged in behaviour; called per line instead of per record.
- `cycleCountMateriality.ts` — unchanged; evaluated per line.

**Frontend — contract only**

- `field-ops-app-vite/src/domain/cycleCountCommandRequest.js` — request builders for the new command shapes.
- `field-ops-app-vite/src/domain/cycleCountActionResult.js` — outcome mapping for new failure codes.
- `field-ops-app-vite/src/domain/cycleCountScanSession.js` — `WRONG_PART` becomes "open or resolve that part's line" rather than a refusal.

**Certification world**

- `functions/scripts/certificationWorld/executeCycleCount.mjs` and the verifiers that read `cycle_counts` must be updated to the new shape. These are emulator-only generators (see *Migration*).

**Tests**

- `functions/test/cycleCountCommand.test.mjs` — rewritten against the new shape.
- Frontend suites registered in `field-ops-app-vite/test/suites.json`.

## Explicitly out of scope

- **No capability activation and no grants.** All four `inventory.cycleCount.*` ids remain `active: false`, held by no role. That is A5.
- **No durable cross-session read.** The A4 trusted read boundary is a separate PR. A1's callable responses remain the only source of client state.
- **No `firestore.rules` change.** `cycle_counts` stays client-denied, including its new `lines` subcollection.
- **No workspace UI rebuild.** `CycleCounts.jsx` is not restructured in A1; only the domain contract modules it consumes change. A2 rebuilds the workspace.
- **No materiality configuration move.** Thresholds stay on the existing environment-variable reader. That is A3, and A1 must not partially implement it.
- **No scheduling, no `abcClass`, no `lastCountedAt`.** That is A6.
- **No collaborative multi-counter workflow.** Posture only — see *Concurrent counters*.
- **No `BIN` counting.** Eligibility remains `WAREHOUSE` and `MOBILE`; A1 only moves *where* that fence is enforced.
- **No `LOT` tracking.**
- **No dual-version reader.** See *Migration*.

---

## Technical design

### Current state (verified against source, 2026-09-01)

One `cycle_counts` document is one part at one location. `serializeCycleCount` writes `partId`, `trackingMode`, `location`, `expectedQuantity`, optional `expectedSerialNumbers`, `status`, `version`, `idempotencyKey`, `actor`, `createdAt/By`, `updatedAt/By`, `fingerprint`. `submitFields` adds `countedQuantity`/`countedSerialNumbers`, `variance`/`serialVariance` and `submittedBy`. `reconcileFields` adds `reviewDecision`, `reconciliationReason`, `reconciledAt`, `reconciledBy`, `ledgerEventIds`. `deserializeCycleCount` is fail-closed: it rejects any `schemaVersion !== CYCLE_COUNT_SCHEMA_VERSION` (currently `1`) and any key outside `STORED_KEYS`.

Document identity is `cycleCountDocId(idempotencyKey)` = `"cyc_" + sha256(key).slice(0,40)`. The fingerprint is a 16-hex hash over the request-derived identity **only** — `{partId, trackingMode, location, idempotencyKey}` — deliberately excluding the server-computed snapshot so a later ledger movement cannot turn a legitimate replay into a conflict.

`validateCycleCountLocationRef` currently enforces `type ∈ CYCLE_COUNT_LOCATION_TYPES` (`WAREHOUSE`, `MOBILE`) as **shape** validation, and `cycleCountCommandComposition.ts` pins `makeResolveTransferLocationActive` — the same governed resolver Transfer uses — as the active-location check.

### Answers to the eleven shape questions

**1. What remains on the parent sheet?**

The governed location reference, sheet identity and idempotency, lifecycle status, and creation/update audit. Nothing about any part, and no aggregate count state.

**2. What moves to the line?**

Everything part-scoped: `partId`, `trackingMode`, the expected snapshot and its timestamp, the counted values, the variance, the per-line disposition and its ledger evidence, and per-line actor identity.

**3. What is the canonical identity of a line?**

`(sheetId, partId)`. Lines live in a `lines` subcollection of the sheet, and the **line document id is derived deterministically from `partId`** — `cycleCountLineDocId(partId)` = `"ccl_" + sha256(partId).slice(0,40)`. A part therefore has exactly one addressable path within a sheet.

**4. How is one-part-one-line enforced?**

By the document path, not by a query. Because the line id derives from `partId`, a second open of the same part resolves to the same document; the command reads it, finds it exists, and returns the existing line as a replay. There is no code path that can create a second line for the same part, so there is no way to take a second expected snapshot for that part on that sheet. For `SERIAL` tracking, serial observations are recorded in that one line's `countedSerialNumbers`; they never create sibling lines.

**5. What server-computed fields exist?**

Per line: `expectedQuantity`, `expectedSerialNumbers` (`SERIAL` only), `expectedSnapshotAt`, `variance`, `serialVariance`, `ledgerEventIds`, `fingerprint`, `version`. Per sheet: `fingerprint`, `version`. None of these is ever accepted from input.

**6. Which fields are hidden from clients before submission?**

Per line, until **that line** is submitted: `expectedQuantity` and `expectedSerialNumbers`. They are omitted from the response payload server-side, not hidden in the UI. `expectedSnapshotAt` may be returned — it discloses no quantity — but carries no expected value with it.

**7. What becomes visible after that specific line is submitted?**

That line's `expectedQuantity` / `expectedSerialNumbers`, and its computed `variance` / `serialVariance`. **Only that line's.** Sibling lines that are still `OPEN` remain redacted in the same response.

**8. What state is sheet-level versus line-level?**

Sheet-level is **lifecycle only**: `OPEN`, `CLOSED`, `CANCELLED`. Line-level is the count state machine, reusing the existing vocabulary unchanged: `OPEN → COUNTED → RECONCILED | REJECTED`, plus `OPEN → CANCELLED`.

A sheet has no `COUNTED` state and no progress rollup. Introducing one would create a second source of truth about line state and would make every line write contend on the parent document.

**9. How is sheet completion derived?**

By reading the lines. A sheet is *complete* when every non-cancelled line is `RECONCILED` or `REJECTED`. This is computed by the reader — in A1, the callable response; from A4 onward, the trusted read boundary — and is never denormalised onto the sheet. `closeCycleCountSheet` verifies the condition at close time inside its own transaction; that is the only place the derivation is authoritative rather than informational.

**10. What schema/version marker changes are required?**

`CYCLE_COUNT_SCHEMA_VERSION` goes `1 → 2` and applies to the sheet. Lines carry their own `CYCLE_COUNT_LINE_SCHEMA_VERSION = 1`. Because `deserializeCycleCount` already rejects any record whose `schemaVersion` is not the current constant, every pre-existing v1 document becomes `MALFORMED_STORED_RECORD` on read. That is intended (see *Migration*).

**11. What single-part behaviour is deleted or replaced?**

| Deleted | Replaced by |
|---|---|
| `partId`, `trackingMode`, `expectedQuantity`, `expectedSerialNumbers` on the sheet document | The same fields on the line |
| `countedQuantity`, `countedSerialNumbers`, `variance`, `serialVariance`, `submittedBy` on the sheet | The same fields on the line |
| `reviewDecision`, `reconciliationReason`, `reconciledAt`, `reconciledBy`, `ledgerEventIds` on the sheet | The same fields on the line |
| `createCycleCount(partId, location, idempotencyKey)` | `createCycleCountSheet(location, idempotencyKey)` + `openCycleCountLine(sheetId, partId)` |
| `submitCycleCount(cycleCountId, counted…)` | `submitCycleCountLine(sheetId, partId, counted…)` |
| `reconcileCycleCount(cycleCountId, decision, reason)` | `reconcileCycleCountLine(sheetId, partId, decision, reason)` |
| `cancelCycleCount(cycleCountId)` | `cancelCycleCountSheet(sheetId)` and `cancelCycleCountLine(sheetId, partId)` |
| Location-type fence inside `validateCycleCountLocationRef` | Command-time eligibility policy (D0) |
| Ledger idempotency keyed on `cycleCountId` alone | Keyed on `(sheetId, partId)` |

### Stored shape

**`cycle_counts/{sheetId}`** — document id `cycleCountDocId(idempotencyKey)`, unchanged derivation.

```
schemaVersion        2
location             { type, locationId }      governed reference; type is the RESOLVED type, stored as fact
status               "OPEN" | "CLOSED" | "CANCELLED"
version              integer >= 1
idempotencyKey       string
actor                { kind, id }
createdAt/createdBy
updatedAt/updatedBy
fingerprint          16-hex over { location, idempotencyKey }
closedAt/closedBy    present only when status is CLOSED
```

**`cycle_counts/{sheetId}/lines/{lineId}`** — document id `cycleCountLineDocId(partId)`.

```
schemaVersion        1  (line schema)
partId               string
trackingMode         "NONE" | "SERIAL"
expectedQuantity     integer >= 0                     server-computed at line-open
expectedSerialNumbers  string[]                       SERIAL only, server-computed, sorted, unique
expectedSnapshotAt   Timestamp                        ACTUAL instant this line's expected value was computed
status               "OPEN" | "COUNTED" | "RECONCILED" | "REJECTED" | "CANCELLED"
version              integer >= 1
fingerprint          16-hex over { partId, trackingMode }
openedBy / openedAt
countedQuantity | countedSerialNumbers                 present once COUNTED
variance | serialVariance                              present once COUNTED
submittedBy / submittedAt                              present once COUNTED
reviewDecision, reconciliationReason,
reconciledAt, reconciledBy, ledgerEventIds             present once disposed
```

The existing `SERIAL` deserialize invariants carry over to the line verbatim: serials are non-empty strings, unique, and `expectedSerialNumbers.length === expectedQuantity`; a `NONE` line must not carry `expectedSerialNumbers`.

`openedBy`/`openedAt` and `submittedAt` are the only new audit fields. They exist because D7 requires that line actor identity not be assumed to be a single sheet-level counter; `submittedBy`, `reconciledAt` and `reconciledBy` already exist in the current vocabulary and keep their names.

### D0 — Location authority and eligibility policy

**The stored shape carries a governed location reference only.** `validateCycleCountLocationRef` stops enforcing `type ∈ {WAREHOUSE, MOBILE}`; it validates the *reference shape* (`{type, locationId}`, both non-empty) and nothing more. `CYCLE_COUNT_LOCATION_TYPES` stops being a schema constraint and becomes the **default eligibility policy**.

Command-time sequence, in `createCycleCountSheet`:

```
resolve the governed location
  -> determine its governed type
  -> validate that type against the authorized Cycle Count countable-type policy
  -> refuse with CycleCountLocationInvalidError if not eligible
```

The eligibility policy is supplied through the composition seam
(`cycleCountCommandComposition.ts`) as `countableLocationTypes`, pinned in production to the governed default. It is **not** Administration data and **not** operator-editable (ruling D0(ii)); a future implementation may store it as data provided changing it still requires a governed, audited authority.

The active-location check continues to reuse `makeResolveTransferLocationActive` — the same governed authority Transfer resolves against. **No second Location registry is introduced.**

Consequence, and the point of the change: admitting `BIN` later is a policy and validation change plus a capability decision. It is not a Cycle Count record migration.

### Line open and the expected snapshot

`openCycleCountLine(sheetId, partId)` — one transaction:

1. authorize `inventory.cycleCount.create`;
2. read the sheet; refuse unless `status === "OPEN"`;
3. resolve the part; refuse if not found, not active, identity-incoherent, or its tracking mode is unsupported (`LOT` deferred);
4. read `lines/{cycleCountLineDocId(partId)}`; **if it exists, return it as a replay** — no second snapshot, no second line;
5. compute the expected value from the existing authority — `computeExpectedQuantityThroughTxn` for `NONE`, `computeExpectedSerialsThroughTxn` for `SERIAL`, both unchanged;
6. write the line with `expectedSnapshotAt = now`;
7. stage one audit event.

**`expectedSnapshotAt` is the actual instant that line's expected value was computed.** There is no sheet-level snapshot timestamp and none may be added. A sheet worked from 09:00 to 11:20 holds lines with different snapshot instants, and a receipt posted at 10:00 is inside some lines' expected figures and outside others'. That is correct, and the field is what makes it legible.

**A predetermined line set is a work plan.** If a caller opens many lines up front (the shape A6's scheduler will use), each `openCycleCountLine` call still stamps its own real timestamp. The plan must not claim a shared instant, and a genuine common "inventory as of T" would require a point-in-time ledger capability that **does not exist**.

**A part not prelisted follows exactly this path.** There is no separate code path for a discovered part and no separate expected-quantity rule. The sheet's line set is never consulted as an expected-quantity authority. `expectedQuantity` is `0` **only when `computeExpectedQuantityThroughTxn` returns 0** (or the serial registry returns an empty set) — never because the part was absent from a plan.

The response carries `sheetId`, `lineId`, `partId`, `trackingMode`, `status: "OPEN"`, `expectedSnapshotAt`, and the replay flag. It carries **no expected quantity and no expected serials**, matching today's `createCycleCount`, which deliberately omits them from the create response so devtools inspection reveals nothing.

### Line submit

`submitCycleCountLine(sheetId, partId, countedQuantity | countedSerialNumbers)` — one transaction: authorize `inventory.cycleCount.submit`; read the line; require `OPEN` or `COUNTED`; validate the counted payload against the line's stored `trackingMode` using the existing `validateSubmitCycleCountInput`; compute `variance = counted - expected` (`NONE`) or the `{missing, unexpected}` set difference (`SERIAL`); write `COUNTED` with `submittedBy`/`submittedAt`; stage one audit event.

Replay semantics are unchanged from the current implementation: resubmitting the same values replays; resubmitting different values raises `CycleCountIdempotencyConflictError`.

**This response is where that line's expected value first crosses the wire** — after the counted value has already left the counter's hands in the same request, exactly as today. Sibling lines are untouched and unrevealed.

Submitting remains **observation only**. No ledger write occurs here.

### Line reconciliation — the atomic unit

`reconcileCycleCountLine(sheetId, partId, decision, reason?)` is **one transaction** that performs, atomically:

1. read current line state;
2. verify actor capability (`inventory.cycleCount.reconcile`);
3. enforce separation of duties;
4. verify the requested disposition is legal for the current state;
5. validate variance and reason requirements;
6. stage that line's ledger adjustment evidence when appropriate;
7. update that line's disposition state;
8. commit as one unit.

Rules carried over unchanged from the current implementation:

- `APPROVE` on a non-zero variance requires a reason; so does `REJECT`.
- `REJECT` stages **no** ledger evidence at all.
- A decision cannot later be changed (`RECONCILED` cannot become `REJECTED`, or the reverse) — `CycleCountStatusInvalidError`.
- Separation of duties fires only on a **material** variance for that line, evaluated by `isMaterialCycleCountVariance` against **that line's** expected units. `CycleCountSelfApprovalError` when `actor.id === line.submittedBy`.
- A `COUNTED` line with a variance and no `submittedBy` is `MALFORMED_STORED_RECORD` — fail closed, never an unattributable self-approval.
- `SERIAL` missing units stage `ADJUSTED` evidence; the `serialized_assets` registry is **not** flipped, and unexpected serials are never staged as a movement. Both postures are unchanged and their reasoning is unchanged.

**Materiality is per line and there is no sheet-level formula.** A clean line is disposable by the same actor who submitted it even when a sibling line on the same sheet is material; a material line is blocked even when every sibling is clean.

**Ledger evidence identity moves from the record to the line:**

```
noneLedgerIdKey(sheetId, partId)                    -> "cycmv_" + sha256([sheetId, partId, "adjust"])
serialLedgerIdKey(sheetId, partId, "missing", sn)   -> "cycmv_" + sha256([sheetId, partId, "missing", sn])
```

`sourceObject` remains `{ type: "ADJUSTMENT", id: sheetId }`. Verified against `stageOperationalMovement`: ledger document identity derives solely from `idempotencyKey`, and `sourceObject` carries no uniqueness constraint, so several lines on one sheet correctly produce several `ADJUSTED` movements sharing one adjustment source. Replay is exact-fingerprint based, so a retried line disposition returns `replayed` and stages nothing new.

### Multi-line reconciliation — resumable, never restartable

A sheet-level orchestrator (`reconcileCycleCountSheet`) is a **loop over line transactions**, not a transaction. Approving 200 lines is 200 transactions.

On failure at line 137 of 200:

- **lines 1–136** — conclusively committed, disposed with their ledger evidence staged. **Not rolled back.**
- **line 137** — `COUNTED`, untouched. Its transaction either committed or did not; there is no half-state.
- **lines 138–200** — `COUNTED`, untouched.
- **the sheet** — still `OPEN`, honestly showing a mix of disposed and undisposed lines.

Retry disposes only the lines still in `COUNTED`; already-disposed lines return `replayed` and re-derive the identical `ledgerEventIds`, so no evidence is double-staged. The existing coherence guards are preserved per line: on an already-decided line the ledger call must report `replayed` and the recomputed id set must equal the stored `ledgerEventIds`, or `CycleCountIntegrityError`.

**A partially reconciled line must not be representable.** Sheet-level atomicity is surrendered deliberately; line-level atomicity is not.

### Cancel

`cancelCycleCountLine(sheetId, partId)` — `OPEN → CANCELLED`, domain-safe only before that line is submitted. Idempotent.

`cancelCycleCountSheet(sheetId)` — `OPEN → CANCELLED`, legal only when **no line on the sheet has been submitted**. This preserves the current rule ("cancellation is only domain-safe before a count is submitted") at sheet scope. A sheet with any `COUNTED` or disposed line must be closed, not cancelled.

`closeCycleCountSheet(sheetId)` — `OPEN → CLOSED`, legal only when every non-cancelled line is `RECONCILED` or `REJECTED`. The condition is verified inside the transaction.

### Concurrent counters — posture, not implementation

Collaborative multi-user counting is **not built**. The workflow may remain single-operator.

The shape does not foreclose it: there is no `sheetCounterId`, and per-line `openedBy`, `submittedBy`, `reconciledBy` and their timestamps make each line's actor identity truthful on its own. Adding concurrent counting later needs no schema migration. **No field is added beyond those three actor pairs and `expectedSnapshotAt`.**

### Idempotency summary

| Level | Identity | Fingerprint covers | Excluded |
|---|---|---|---|
| Sheet | `cycleCountDocId(idempotencyKey)` | `{location, idempotencyKey}` | everything server-computed |
| Line | `cycleCountLineDocId(partId)` within the sheet | `{partId, trackingMode}` | `expectedQuantity`, `expectedSerialNumbers`, `expectedSnapshotAt`, counted values, variance |

The governing principle is unchanged and must not regress: **request-derived identity participates in fingerprinting; server-computed values never do**, so ledger movement after a legitimate first request can never turn its replay into a conflict.

### Failure taxonomy

Existing codes are retained. Two additions:

- `SHEET_NOT_FOUND` — a line command naming a sheet that does not exist. (`CYCLE_COUNT_NOT_FOUND` continues to mean the *line* is missing.)
- `SHEET_STATUS_INVALID` — a line operation against a `CLOSED` or `CANCELLED` sheet, or an illegal sheet transition.

`LOCATION_INVALID` now covers both "malformed reference" and "type not eligible under the current policy". The message distinguishes them; the sanitized code does not.

## Firestore Rules impact

**None.** Neither `firestore.rules` copy changes.

`cycle_counts` remains deny-all for every client, and the new `lines` subcollection inherits that denial — the existing deny-all match on the collection path covers descendants, and A1 adds no rule to weaken it. Verification that the subcollection is genuinely denied is an acceptance criterion below.

Durable cross-session reads are A4, and the approved plan rules that they should be delivered by a trusted read boundary rather than a Rules change.

## UI impact

**None visible in A1.** No screen changes and no navigation change. `CycleCounts.jsx` continues to render the existing workspace against the domain contract modules; A2 rebuilds it for sheets.

Three domain contract modules change so A2 has a correct base:

- `cycleCountCommandRequest.js` — builders for the sheet and line commands.
- `cycleCountActionResult.js` — mapping for `SHEET_NOT_FOUND` and `SHEET_STATUS_INVALID`.
- `cycleCountScanSession.js` — `COUNT_OBSERVATION.WRONG_PART` stops meaning "refuse". A scan of a different part now resolves to that part's line. `DUPLICATE_SERIAL` is unchanged. **No expected figure enters this module** — its existing header rule ("nothing in this module accepts, stores, derives or displays an expected figure") is preserved exactly.

## Testing strategy

Emulator tests in `functions/test/cycleCountCommand.test.mjs`, rewritten for the new shape and following the existing harness (`FIRESTORE_EMULATOR_HOST`, compiled `../lib` imports, injected authorize/part/location/audit seams, `check(name, fn)`). Frontend contract tests are registered in `field-ops-app-vite/test/suites.json`.

Focused authority tests, not full-system regression:

*Sheet and location*
1. creates a sheet against an eligible governed location
2. refuses a location type outside the eligibility policy
3. refuses an inactive governed location
4. sheet create replays on the same `idempotencyKey`; conflicts on a different location

*Line open and expected authority*
5. opens the first line for a part
6. a repeat open or scan of the same part returns the **same** line, with no second snapshot
7. a discovered part not prelisted on the sheet uses the normal expected-quantity authority
8. `expectedQuantity` is `0` only when the authority returns 0
9. `NONE` expected quantity comes from the operational ledger sum
10. `SERIAL` expected serials come from the serialized asset registry (`AVAILABLE` at that location)
11. `expectedSnapshotAt` is stored per line and reflects each line's real compute instant — two lines opened at different times carry different values
12. refuses an unsupported tracking mode (`LOT`)

*Blind count*
13. the line-open response carries no `expectedQuantity` and no `expectedSerialNumbers`
14. expected values appear only in that line's submit response
15. a sibling line still `OPEN` remains redacted in the same response

*Materiality and separation of duties*
16. materiality is computed per line against that line's expected units
17. the submitter of a material line cannot dispose of it (`SEPARATION_OF_DUTIES`)
18. a different principal disposing of the same line succeeds
19. a clean line is disposable by its own submitter even when a sibling line is material
20. a `COUNTED` line with a variance and no `submittedBy` fails closed

*Disposition and atomicity*
21. partial sheet disposition: some lines disposed, others left `COUNTED`
22. a line's disposition and its ledger evidence commit together
23. an injected failure mid-transaction leaves no half-reconciled line — the line is `COUNTED` with no orphan ledger evidence, or disposed with evidence
24. a retry after a mid-sheet failure leaves lines 1..N-1 stable and continues
25. retry does not double-stage ledger evidence — the same `ledgerEventIds` replay
26. a decision cannot be reversed after the fact

*Preserved semantics*
27. submit stages no ledger writes (observation only)
28. `REJECT` stages no ledger evidence even with a variance, and still requires a reason
29. line cancel is legal only before submit; sheet cancel only while no line is submitted
30. sheet close requires every non-cancelled line disposed
31. no second on-hand or location authority is introduced — the location resolver and expected-quantity modules are the same ones Transfer uses

*Rules posture*
32. rules simulator: an authenticated non-admin client is denied read on `cycle_counts/{id}` **and** on `cycle_counts/{id}/lines/{lineId}`

## Rollback strategy

**Fully reversible; no irreversible step.**

A1 is repo-only. The capabilities remain `active: false` and granted to no role, so no principal can invoke any command in any environment — no production or sandbox data can be written by this change. Reverting the PR restores the v1 shape completely.

The only state that can exist is emulator and certification-world data, which is regenerated by re-running the certification scripts.

## Migration

**No dual-version reader, and none is permitted.**

Evidence that no persisted records require preservation:

- All four capabilities are `active: false` and held by no role; `resolveEffectivePermission` denies unconditionally ahead of any role check. No principal can have created a record.
- `cycle_counts` is client-denied in both Rules copies; there is no client write path.
- The only writers of `cycle_counts` in the repository are the `functions/scripts/certificationWorld/` generators. `executeCycleCount.mjs` is marked **EMULATOR ONLY** and drives the real command family against the emulator; its output is synthetic and regenerated on every certification run.

`CYCLE_COUNT_SCHEMA_VERSION` therefore moves to `2`, and the existing fail-closed `deserializeCycleCount` rejects any v1 document as `MALFORMED_STORED_RECORD` rather than reading it. That is the intended behaviour: loud failure over silent dual-shape support.

**If persisted non-emulator `cycle_counts` records are discovered during implementation, stop and report before writing any migration.** This specification's migration assumption would be void.

## Acceptance criteria

- [ ] `cycle_counts/{sheetId}` stores a governed location reference, lifecycle status, identity and audit — and no part-scoped field.
- [ ] `cycle_counts/{sheetId}/lines/{lineId}` stores exactly the line fields listed above, with `lineId` derived from `partId`.
- [ ] `validateCycleCountLocationRef` no longer restricts location type; the eligibility check happens at command time through the composition seam.
- [ ] Opening the same part twice on one sheet returns the same line and does not recompute the expected snapshot.
- [ ] A line's `expectedSnapshotAt` equals the real instant its expected value was computed; no sheet-level snapshot timestamp exists anywhere in the shape.
- [ ] No response from any command returns `expectedQuantity` or `expectedSerialNumbers` for a line that has not been submitted — verified by asserting on the raw payload, not the UI.
- [ ] Submitting a line stages no ledger write.
- [ ] Disposing one line stages that line's ledger evidence and updates that line's status in a single transaction.
- [ ] An injected mid-sheet failure leaves earlier lines disposed, the failing and later lines `COUNTED`, and no half-reconciled line.
- [ ] Retrying a failed sheet reconcile produces no duplicate ledger evidence.
- [ ] Materiality and separation of duties are evaluated per line.
- [ ] All 32 tests above pass against the Firestore emulator.
- [ ] `git diff` touches no capability file, no `firestore.rules` copy, and no role or grant definition.
- [ ] All four `inventory.cycleCount.*` capabilities remain `active: false` and granted to no role.
- [ ] Rules simulator confirms `cycle_counts/{id}/lines/{lineId}` is denied to clients.

## Risks

- **Line-open cost on a large predetermined sheet.** Each `openCycleCountLine` runs `computeExpectedQuantityThroughTxn`, which reads every ledger document for that part and filters location in memory. Opening 200 lines is 200 such transactions. This is bounded and correct, but a scheduled 200-line sheet will not open instantly. A6 should open lines lazily or in batches; A1 must not introduce a bulk-open path that reverts to one large transaction — that is the exact shape D6 rejected.
- **`WRONG_PART` semantics change is the one place a regression could hide.** The scan session must resolve to a line, not silently count into the wrong one. Test 6 is the guard.
- **Redaction is easy to reintroduce badly.** Any convenience helper that serialises a full line for a response is a candidate leak. The projection must be an explicit allow-list per line status, and test 15 must assert on the raw payload.
- **Certification-world drift.** Six scripts read `cycle_counts` with the v1 shape and will fail loudly after the schema bump. Loud failure is the intent, but they must be updated in this PR or the certification run is red.
- **Ledger key change is silent if mishandled.** Moving from `cycleCountId` to `(sheetId, partId)` changes the derived movement document ids. Since no real evidence exists, there is nothing to reconcile — but a partial edit that leaves one call site on the old key would produce two movements for one line. Test 25 is the guard.

## Open questions

**None.** Every decision this specification depends on was ruled in the approved implementation plan (D0–D7, A1-first, A4 mechanism, A4+A5 activation unit). The remaining outstanding items — A5's role split and B1's hardware and label medium — are not needed to implement A1.

## Approval

Pending. Architectural review of the parent implementation plan completed 2026-09-01 with all A1 decisions ruled and the A1 specification gate marked READY. This specification requires its own approval before implementation begins.
