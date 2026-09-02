---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-09-02
owner: Claude Code
related_adrs: ["ADR-014"]
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: BIN-P1 — stable bin identity and racking structure

**Architecture Review:** [ADR-014 — Warehouse and Bin Inventory Custody Model](../architecture/ADR-014-warehouse-and-bin-inventory-custody-model.md) and **Decision #160**, merged to `main` in PR #1747. Rulings O-1 through O-7 are final. This specification implements the identity half of BIN-P1 and introduces no new architectural decision.

**Source verified against:** `origin/main` @ `f690f483448ee16d46868c3e5893cef500fc1f17` (the BIN-P0 merge), read on 2026-09-02.

## Executive summary

A bin's document identity is currently `deriveBinDocId(warehouseId, code)` = `bin_{warehouseId}__{code}`. The human code **is** the database id, so correcting a mislabelled rack produces a *different document* and orphans that bin's placement history. Decision #160 (O-3) ruled that unacceptable.

BIN-P1 replaces the code-derived identity with a **stable surrogate `binId`**, moves the racking hierarchy into **structured attributes** (`area`, `aisle`, `bay`, `position`) from which the canonical display code is **derived**, enforces canonical-code uniqueness **within a warehouse** atomically, and gives a corrected code a **traceable history** so a stale printed label can never resolve to the wrong physical location.

P1 changes identity and structure only. **It does not touch custody**: a bin stays descriptive, put-away stays a placement event, no ledger event is written, and no quantity meaning changes. That is BIN-P6.

## Sprint objective

Give a bin an identity that survives a legitimate code correction, and a structure that survives a change of display convention — without altering what any inventory number means.

## Scope

**Backend — `functions/src/inventoryLocation/`**

- `binRegistry.ts` — stable id derivation; structured attribute validation; canonical code derivation; extended resolution outcomes.
- `binCommands.ts` — `createBin` reworked onto the surrogate id; new `renameBin` command shape; `setBinStatus` and `resolveBinCode` addressed by the new identity; claim writes.
- `putAwayCommand.ts` — resolves a scanned code to the stable `binId`; placement records carry it.
- `binCallables.ts` — request/response shapes for the above.

**New collection**

- `bin_code_claims` — the atomic uniqueness and code-history index (§Uniqueness).

**Frontend — contract only**

- `field-ops-app-vite/src/services/binCommandClient.js`
- `field-ops-app-vite/src/domain/putAwaySession.js` — new resolution outcome.

**Tests**

- `functions/test/binRegistry.test.mjs`, `putAwayCommand.test.mjs`, `scannerEndToEndContract.test.mjs`, `scannerReleaseReadiness.test.mjs`.

## Explicitly out of scope

- **Bin-level quantity, custody, or roll-up.** No ledger event, no `BIN` movement, no availability change. BIN-P6.
- **Warehouse roll-up calculations.** BIN-P6.
- **Administration racking UI.** BIN-P3.
- **Bulk generator** — odd numbering, per-aisle bay counts, irregular positions. BIN-P3. The schema must *support* it (§Racking structure); P1 builds none of it.
- **Label generation, printing or export.** BIN-P5.
- **Capability activation or grants.** BIN-P4.
- **Cycle Count BIN eligibility.** BIN-P7.
- **Visualization** — no coordinates, map fields, floor plan, drawing schema, image references, or visual editor.
- **Firestore Rules changes.** `bins`, `bin_placements` and the new `bin_code_claims` all stay match-block-free, which is deny-all.
- **Legacy `stock_locations` retirement.** BIN-P2.
- **The migration itself.** P1 specifies the posture and the verification gate; it writes no migration.

---

## Verified current state

### Identity and commands

| Element | Current | Source |
|---|---|---|
| Bin document id | `deriveBinDocId(warehouseId, code)` = `bin_{warehouseId}__{code}` | `binRegistry.ts` |
| Collection | `bins` | `binCommands.ts:23` |
| Code normalization | trim → collapse whitespace → upper-case; pattern `/^[A-Z0-9][A-Z0-9.\-_]{0,31}$/`; unsupported characters **rejected, never stripped** | `binRegistry.ts` |
| Stored bin fields | `warehouseId`, `code`, `originalCode`, `name`, `status`, `version`, `createdAt/By`, `updatedAt/By` | `binCommands.ts` create |
| Status | `ACTIVE` / `INACTIVE`; **nothing is ever deleted** | `binRegistry.ts` |
| `createBin` | one transaction; reads the whole `warehouses` collection inside it; **idempotent by construction** because the id is derived — a repeat create returns `unchanged`; **never revives a retired bin** | `binCommands.ts` |
| `setBinStatus` | retire/revive by `(warehouseId, code)`; `unchanged` on a no-op; version increment | `binCommands.ts` |
| `resolveBinCode` | read-only; normalizes, derives the id, reads the doc, delegates to pure `resolveBin` | `binCommands.ts` |
| `listBinsForWarehouse` | `where warehouseId ==`, limit 500 + truncation flag; a malformed stored bin is **excluded, not rendered** | `binCommands.ts` |
| `resolveBin` outcomes | `FOUND` / `INACTIVE` / `NOT_FOUND` / `WRONG_WAREHOUSE` / `MALFORMED`. Unrecognized status **fails closed to `INACTIVE`** | `binRegistry.ts` |
| Placement record | already stores **both** `binId` and `binCode`, plus `warehouseId`, `partId`, `serialNo`, `quantity`, `placedAt/By`, `idempotencyKey`, `pickedForWorkOrderId`, `note`, `schemaVersion: 1` | `putAwayCommand.ts` |
| Placement id | `derivePlacementId(idempotencyKey, serialNo \| partId)` — independent of the bin id | `putAwayCommand.ts` |

There is **no structured hierarchy**: no `area`, `aisle`, `bay` or `position` field exists. The code is one flat string.

`binRegistry.ts` is pure and deliberately never emits a `BIN` `LocationRef`; a test asserts it. `putAwayCommand.ts` writes no ledger event; a test asserts it never imports one. Both remain true after P1.

### Uniqueness mechanism today

**Structural, via the derived id.** Two bins with the same code in the same warehouse *are* the same document, so a duplicate cannot be created — there is nowhere for a second one to go. There is no uniqueness check, no index, and no claim document.

**This is exactly what the surrogate id removes**, and it is why P1 must add an explicit mechanism rather than simply swapping the id.

### An existing governed uniqueness pattern to reuse

The Truck Registry (ADR-010, Decision #59) enforces a cross-document 1:1 invariant that Firestore Rules cannot express by writing a **claim document inside the same transaction**: `location_truck_claims/{locationId}`, created-if-absent, alongside `mobile_locations` and `trucks` (`truckRegistry/truckRegistryCommands.ts`, `truckRegistryRepository.ts`).

**P1 reuses that proven pattern rather than inventing one.**

### Capabilities and Rules

`inventory.location.bin.manage`, `inventory.location.bin.read` and `inventory.placement.record` are all `active: false` and granted to no Role. Two least-privilege Roles are declared but confer nothing.

`bins` and `bin_placements` have **no `firestore.rules` match block** — deny-all by absence — and `scannerReleaseReadiness.test.mjs` asserts that as a test rather than a claim. `bin_code_claims` joins them on the same footing.

### Persisted-record evidence

Measured on `f690f483`:

- The **only** writers of `bins` are `createBin` and `setBinStatus` in `binCommands.ts`. Nothing else in `functions/src`, `functions/scripts`, or any seed, fixture or certification-world generator writes the collection.
- Both are reachable only through callables gated on `inventory.location.bin.manage`, which is `active: false` — `resolveEffectivePermission` denies unconditionally ahead of any Role check.
- `bins` is deny-all to every client, so there is no client write path.
- The only code that creates bins outside those commands lives in `functions/test/*` and runs against the Firestore emulator.

**Conclusion from repository evidence: no non-emulator bin or placement record can exist.** That conclusion is repository-derived, not environment-verified — see §Migration posture for the gate that closes it.

---

## Authority model

Unchanged by P1, and restated so the diff can be checked against it:

- **`warehouses`** is the governed custody parent. Bins hang off it; the whole warehouse set is read inside the create transaction so a bin cannot be created into a warehouse being removed concurrently.
- **`bins`** is the one bin registry. `bin_code_claims` is a **supporting index, not a second Location authority**: it holds no name, no status of its own beyond claim state, no hierarchy, and nothing resolves a location *from* it except by pointing back at a `binId`.
- **`inventory_transactions`** remains the sole quantity authority. P1 writes nothing to it.
- A bin remains **descriptive** until BIN-P6. Nothing in P1 makes a bin a custody location.

---

## Technical design

### Stable bin identity

**`binId` is server-derived, immutable, opaque to the business, and independent of every business attribute.**

```
binId = "bin_" + sha256(idempotencyKey).slice(0, 40)
```

- **Who generates it:** the server, inside `createBin`. Callers supply an `idempotencyKey`; they **may not supply a `binId`**, and a request carrying one is rejected as an unknown field rather than ignored.
- **When:** once, at create.
- **Can it change:** never. No command updates it.
- **Independent of:** `warehouseId`, `area`, `aisle`, `bay`, `position`, `code`, `displayCode`, and the warehouse's own code.

**Why an idempotency-key derivation rather than a random id.** The current `createBin` is *idempotent by construction* — a repeat create finds the same derived document and returns `unchanged`, so "a warehouse worker scanning the same label twice is not punished". A random surrogate would destroy that and turn every retry into a duplicate bin. Deriving the id from a caller-supplied request nonce keeps retry-safety **and** severs the id from the business code, and it is the pattern Receiving, Transfer and Cycle Count already use (`cycleCountDocId(idempotencyKey)`). Nothing new is invented.

**Addressing after this change.** Commands take `binId` where the caller already holds one, and `(warehouseId, code)` where a human or a scanner supplies one:

| Command | Addressed by |
|---|---|
| `createBin` | `idempotencyKey` + structured attributes + `warehouseId` |
| `renameBin` (new shape) | `binId` |
| `setBinStatus` | `binId`, **or** `(warehouseId, code)` for compatibility with the existing scan-first flow |
| `resolveBinCode` | `(warehouseId, rawCode)` — unchanged operator behaviour |
| `listBinsForWarehouse` | `warehouseId`; returns `binId` per row, as it already does |
| `recordPutAway` | `(warehouseId, binCode)` in, stable `binId` persisted |

**APIs return both.** Every outcome carries `binId` (the durable reference) and the current canonical `code`/`displayCode` (what a human reads). A caller that stores one for later must store `binId`.

**Barcode resolution** ends at `binId`: scan → normalize → resolve within the governed warehouse → canonical-or-superseded code → `binId` → governed bin record.

### Racking structure

Stored as **independent, normalized attributes**, with the human code **derived**:

```
binId          bin_<40 hex>                immutable, server-derived
warehouseId    wh-phoenix                  governed parent
area           PARTS_ROOM                  governed value, per §Area below
aisle          "A"                         1-2 letters, upper-case
bay            1                           INTEGER, not a formatted string
position       3                           INTEGER, not a formatted string
code           "A01-003"                   canonical normalized business code, DERIVED
originalCode   "A01-003"                   as typed, preserved for reprinting
name           "Bulk rack, north wall"     optional, never used for matching
status         ACTIVE | INACTIVE
version        integer
schemaVersion  2
createdAt/By, updatedAt/By
```

**`bay` and `position` are integers precisely so display width is not baked into identity.** A two-digit bay and a one-digit bay are the same bay. The client's open question — whether Warehouse bays are one digit or two (C-1) — is therefore a formatter setting, and **one-digit width must not be hard-coded anywhere in the schema.**

**Reserved even numbers work with no schema support.** `position` is an integer; `001, 003, 005` are positions 1, 3, 5. Activating `002` later creates a bin at position 2 and touches no existing bin's `binId`, `code`, or history. P1 stores no assumption of parity, contiguity or density — those belong to BIN-P3's generator, which P1 does not build.

**Area** is a governed value on the bin, **not a registry and not a facility model**. Its permitted values follow the Site/Area posture in Decision #160 (Operating Company → Warehouse → Area → Aisle → Bay → Bin). Which Areas exist is client input (C-3) and does not block P1: the field is validated as a governed non-empty token whose accepted set is configuration, exactly as the bay format is.

### Canonical display code derivation

`code` is **derived from the structured attributes by a formatter**, then normalized and validated against the existing `BIN_CODE_PATTERN` — which `A01-001` and `AA01-001` already satisfy unchanged.

The formatter is a per-warehouse format configuration (aisle width, bay width, position width, separator). P1 defines the seam and a default; **BIN-P3 exposes it, BIN-P5 prints from it.**

**A consequence that must be stated rather than discovered:** changing a warehouse's format configuration changes the canonical code of every bin under it. That is a **governed rename of each affected bin**, running the rename path below — not a free re-render. It changes no `binId` and orphans no history, but it is not a silent operation, and BIN-P3 must surface it as such.

### Uniqueness enforcement

**Scoped to the warehouse** (O-7): `Phoenix / A01-001` and `Seattle / A01-001` are two different bins; two *active* bins in one warehouse may not share a canonical code.

Enforced by a **claim document created inside the same transaction**, reusing the `location_truck_claims` pattern:

```
bin_code_claims/{warehouseId}__{canonicalCode}
  binId        the bin holding this code
  warehouseId
  code         the canonical code claimed
  claimState   HELD | SUPERSEDED
  claimedAt / claimedBy
  supersededAt / supersededBy   present only when SUPERSEDED
  schemaVersion 1
```

- `createBin` and `renameBin` **create the claim with `txn.create`** — create-if-absent. A second bin attempting the same code in the same warehouse fails the transaction, atomically. There is **no query-then-write**, no client-side check, and no eventual cleanup.
- The claim document id is derived from `(warehouseId, canonicalCode)`, so a duplicate cannot exist. Both segments are already constrained to path-safe characters (`isSafeIdSegment`, `BIN_CODE_PATTERN`).
- The claim is a **supporting index**. It carries no hierarchy, no name and no status of its own; resolution reads it only to find a `binId`.

### Rename and code history

**Recommended: option B — the governed claim collection — because it is already required for uniqueness, so history rides on it at no extra cost.**

Option A (`previousCodes[]` on the bin document) was evaluated and rejected as insufficient on its own: an array cannot atomically prevent a *different* bin from taking a released code, which is requirement 1. Option B satisfies both uniqueness and history with one mechanism, and subsumes what A would have recorded.

`renameBin(binId, newStructuredAttributes)` — one transaction:

1. authorize `inventory.location.bin.manage`;
2. read the bin by `binId`; refuse if absent or malformed;
3. derive the new canonical code from the new attributes;
4. `txn.create` the new claim — **fails atomically if another bin holds that code in this warehouse**;
5. mark the old claim `SUPERSEDED`, still pointing at the **same `binId`**;
6. update the bin's structured attributes, `code`, `originalCode`, `version`, `updatedAt/By`;
7. commit.

**`binId` is untouched.** `bin_placements`, future ledger evidence, cycle counts and audit records continue to refer to the same bin.

**A superseded code is not released.** It keeps pointing at its original bin, so:

- a **stale printed label still resolves to the right physical bin**, and the caller is told the code is outdated;
- a **different** bin cannot silently take that code — `txn.create` on the claim fails;
- the history is durable and readable.

Reusing a superseded code for a different bin therefore requires an explicit governed release. **P1 specifies only the refusal**; the release command is out of scope and is recorded as a future-stage decision, not an Owner blocker.

### Resolution contract

`resolveBinCode(warehouseId, rawCode)` — normalize → look up the claim → read the bin:

| Outcome | Meaning |
|---|---|
| `FOUND` | The canonical code of an `ACTIVE` bin in this warehouse |
| `FOUND_SUPERSEDED_CODE` | A previous code of a bin in this warehouse. Carries `binId`, the **current** canonical code, and the superseded code. The bin is correct; **the label is outdated** |
| `INACTIVE` | Resolved to a retired bin. Unrecognized stored status still fails closed to this |
| `NOT_FOUND` | Well-formed code, no claim |
| `WRONG_WAREHOUSE` | A real bin at another site — kept distinct from `NOT_FOUND` because "you are standing in the wrong building" is a different problem, and the one an operator most needs told plainly |
| `MALFORMED` | Not a usable code |

**A historical code never resolves to a different bin.** It resolves to its own bin or it does not resolve.

`FOUND_SUPERSEDED_CODE` returns everything a UI needs to eventually say *"This label is outdated. Current location code: A01-005."* **P1 builds no such UI.**

**Put-away treats `FOUND_SUPERSEDED_CODE` as usable** — the physical bin is correct and refusing a stow because a label is old would block honest work — but the outcome is returned so the caller can flag the label. Whether put-away requires operator confirmation on a superseded label is a **BIN-P3/P5 UX decision**, not an authority question; the command permits it and reports it.

### Put-away compatibility

`bin_placements` **already stores both `binId` and `binCode`**, so the shape barely moves:

- `binId` becomes the **stable** id — the durable reference that survives a rename.
- `binCode` remains the code **as it was at placement time**: a point-in-time historical fact, deliberately not updated by a later rename.
- `recordPutAway` resolves `(warehouseId, binCode)` through the new resolver and persists the resulting stable `binId`.

**Placement history survives a rename by construction**, because it never referenced the code as identity. Placement ids stay `derivePlacementId(idempotencyKey, serialNo | partId)` — already independent of the bin id, so idempotency is unaffected.

**No custody change.** `putAwayCommand.ts` still writes no ledger event, no quantity and no balance, and the test asserting it never imports the ledger stays green.

### Migration posture

**Repository evidence says a clean shape replacement, with no migration and no dual-version reader** (§Persisted-record evidence): nothing outside the two inert-capability commands can write `bins`, and emulator-test bins are disposable.

`schemaVersion` moves to `2` on the bin record; a fail-closed deserialize rejects a v1 document loudly rather than reading it, matching the posture the Cycle Count and warehouse validators already take.

**Pre-implementation verification gate — MANDATORY, and not satisfiable from this repository:**

> Before the first line of BIN-P1 is written, a **read-only** census of the sandbox and production `bins` and `bin_placements` collections must confirm both are empty. This session cannot query either environment, so the conclusion above is repository-derived, not environment-verified.

If that census finds records:

- **disposable fixture/emulator records** → regenerate, no migration;
- **sandbox governed evidence** → an explicit sandbox migration mapping each `bin_{wh}__{code}` to a new `binId` and rewriting `bin_placements.binId`, specified before implementation;
- **production records** → **STOP.** A governed migration plan is required first, and this specification's migration assumption is void.

**No `bin_placement` may ever be orphaned.** Any migration rewrites placement `binId` in the same governed operation that mints the new bin identity, or it does not run.

### Commands affected

| Command | Change |
|---|---|
| `createBin` | Takes `idempotencyKey` + structured attributes; derives `binId` and the canonical code; creates the bin **and** its claim in one transaction. Still returns `unchanged` on a replay; still never revives a retired bin |
| `renameBin` | **New command shape** (§Rename) |
| `setBinStatus` | Addressed by `binId` or `(warehouseId, code)`; behaviour otherwise unchanged, including `unchanged` on a no-op |
| `resolveBinCode` | Claim-based lookup; new `FOUND_SUPERSEDED_CODE` outcome |
| `listBinsForWarehouse` | Returns structured attributes alongside `binId`, `code`, `name`, `status`; limit and truncation unchanged; malformed rows still excluded |
| `recordPutAway` | Resolves to and persists the stable `binId` |

### Capability and governance impact

**None.** All bin capabilities stay `active: false` and granted to no Role, and no ordinary role grant changes.

`renameBin` is a **new command shape, not new authority**: maintaining the physical bin registry is exactly what `inventory.location.bin.manage` already describes and what the declared `inventoryBinAdministrator` Role already carries. Registering a new capability merely because a function name is new would add a rollout step without adding a boundary.

**If the Owner later wants rename to be separately grantable from create/retire**, that is a new capability and a Tier 2 change — recorded here as a future-stage option, **not** as a decision this specification makes or needs.

## Firestore Rules impact

**None.** Neither `firestore.rules` copy changes.

`bins`, `bin_placements` and the new `bin_code_claims` have no match block, which is deny-all; all three are Admin-SDK-only. `scannerReleaseReadiness.test.mjs` already asserts the first two have no match block, and P1 extends that assertion to `bin_code_claims`.

## UI impact

**None visible.** No screen changes. Two domain contract modules change so BIN-P3 and BIN-P5 have a correct base: `services/binCommandClient.js` (new request/response shapes) and `domain/putAwaySession.js` (the `FOUND_SUPERSEDED_CODE` outcome and its operator text). `PutAwayScan.jsx` and `PickScan.jsx` continue to work against the existing outcomes.

## Testing strategy

Emulator and pure-unit tests following the existing harness (`functions/test/binRegistry.test.mjs` is pure; `scannerEndToEndContract.test.mjs` runs against the emulator importing compiled `../lib`).

1. `createBin` produces a stable surrogate `binId` that contains no business attribute
2. a caller-supplied `binId` is **rejected**, not silently ignored
3. two different codes in one warehouse create two different bins
4. the same canonical code in the same warehouse cannot create two **active** bins — the claim `txn.create` fails atomically
5. the same code in two different warehouses is allowed and yields two `binId`s
6. `area`/`aisle`/`bay`/`position` validate independently of display width — bay `1` is valid whether rendered `1` or `01`
7. the canonical code derives correctly from the formatter seam, and changing format width changes the code without changing `binId`
8. a legitimate rename **preserves `binId`**
9. rename marks the old claim `SUPERSEDED` (still pointing at the same bin) and `HELD`s the new one
10. a stale/superseded code **never** resolves to another bin — a second bin attempting to claim it fails
11. a superseded code resolves to its original bin as `FOUND_SUPERSEDED_CODE`, carrying the current canonical code
12. `INACTIVE` behaviour preserved, including unrecognized stored status failing closed
13. `WRONG_WAREHOUSE` preserved and still distinct from `NOT_FOUND`
14. a malformed stored bin fails closed and is excluded from listings
15. a `bin_placement` records the stable `binId`
16. renaming a bin does not orphan placement history — placements written before the rename still resolve to the same bin
17. a scanned `INVENTORY_LOCATION` resolves to the same stable bin as a direct lookup
18. **no ledger write occurs** from create, rename, retire or resolve — the module still imports no ledger, movement type or balance function
19. **no `stock_locations` read or write authority is introduced**
20. all bin capabilities remain `active: false` and granted to no Role
21. `bins`, `bin_placements` **and `bin_code_claims`** have no `firestore.rules` match block
22. no Cycle Count eligibility change — the countable-type policy still resolves to `WAREHOUSE`/`MOBILE`
23. `createBin` remains replay-safe: the same `idempotencyKey` returns `unchanged` and creates no second bin
24. a retired bin is still not revived by re-creating its code

Migration tests are added **only if** the pre-implementation census proves records must be transformed.

## Acceptance criteria

- [ ] `binId` is server-derived, immutable, and contains no `warehouseId`, area, aisle, bay, position or code.
- [ ] A request supplying `binId` is rejected.
- [ ] `bay` and `position` are stored as integers; no display width appears in any stored field or validator.
- [ ] Canonical code is derived by the formatter seam and validates against the existing `BIN_CODE_PATTERN`.
- [ ] Two active bins in one warehouse cannot share a canonical code, enforced by `txn.create` on the claim inside the same transaction — no query-then-write anywhere in the path.
- [ ] The same code in two warehouses yields two bins.
- [ ] Rename preserves `binId` and leaves every existing `bin_placement` resolving to the same bin.
- [ ] A superseded code resolves to its original bin, reported as `FOUND_SUPERSEDED_CODE`, and cannot be claimed by another bin.
- [ ] `putAwayCommand.ts` still imports no ledger, movement type or balance function.
- [ ] `git diff` touches no `firestore.rules` copy, no capability file, and no role or grant definition.
- [ ] All 24 tests pass.
- [ ] The pre-implementation environment census is recorded before implementation begins.

## Rollback strategy

**Fully reversible; no irreversible step.**

P1 is repo-only. Every bin capability remains `active: false` and granted to no Role, so no principal can invoke any of these commands in any environment — no sandbox or production data can be written by this change. Reverting the PR restores the current shape completely.

The only state that can exist is emulator data, regenerated by re-running the tests.

**This ceases to be true the moment BIN-P4 activates the capabilities**, which is precisely why O-5 sequenced activation after the model is coherent.

## Risks

- **The idempotency-key derivation is load-bearing.** Swapping to a random id would silently reintroduce duplicate bins on retry. Test 23 is the guard.
- **The claim collection is a new authority surface.** If anything ever resolves a *location* from `bin_code_claims` rather than from `bins`, it has become a second Location registry. Its schema deliberately carries no name, hierarchy or display data so there is nothing to resolve from.
- **Format-change ripple.** Changing a warehouse's bay width renames every bin under it. Identities and history survive, but printed labels do not — this is why C-1 must close before BIN-P5 prints anything, and why BIN-P3 must present a format change as a bulk rename rather than a display toggle.
- **Superseded codes accumulate.** Every rename leaves a permanent claim. That is the point — releasing them is what would let a stale label point somewhere new — but the collection grows monotonically and `listBins` must never read it.
- **The environment census is outside this repository.** The migration posture rests on "nothing can have written `bins`", which is proven from source but not from the environments. The gate exists because that distinction matters.

## Open questions

**No Owner architectural decision is open.** Everything P1 needs is settled by Decision #160 and ADR-014.

Remaining items, none blocking implementation once the census gate is cleared:

```
CLIENT (shape the formatter default and BIN-P3/P5, not the schema)
  C-1  Warehouse bay width, one digit or two. Recommendation: two.
       Stored as an integer either way; must close before BIN-P5 prints.
  C-2  Final Phoenix Parts Room and Warehouse area codes.
  C-3  Which Areas exist (e.g. PARTS_ROOM, WAREHOUSE_STORAGE).

FUTURE-STAGE (not blocking BIN-P1)
  - Releasing a superseded code for reuse by a different bin: P1 specifies the
    refusal; the governed release command is unscoped.
  - Whether rename should become separately grantable from create/retire.
    Not required; would be a new capability and Tier 2.

PRE-IMPLEMENTATION GATE (blocking, environmental not architectural)
  - Read-only census of sandbox and production `bins` / `bin_placements`.
    Repository evidence says both are empty; this must be confirmed in the
    environments before implementation. Production records => STOP.
```

## Cycle Count relationship

**Nothing in Cycle Count changes.** P1's only guarantee to it: **the stable `binId` is usable, unchanged, as the governed `locationId` when BIN later becomes an eligible Cycle Count location type** — because it is immutable, path-safe, and independent of every business attribute.

The Cycle Count implementation plan and A1 specification are on branch `claude/cycle-count-a1-spec` (commits `7e457d7f`, `f585125d`) and are **not yet on `main`**. That architecture is not duplicated here.

## Approval

Pending. This specification requires review and approval before BIN-P1 implementation begins. **Implementation is not authorized by the existence of this document.**
