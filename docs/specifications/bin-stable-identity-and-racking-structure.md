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

**Source verified against:** `origin/main` @ `f690f483448ee16d46868c3e5893cef500fc1f17` (the BIN-P0 merge), re-read on 2026-09-02 for the correction pass. `main` has since advanced by one commit which touches neither `functions/src/inventoryLocation/`, nor the shared scan boundary, nor `docs/specifications/` — verified by empty diff.

**Correction pass, 2026-09-02.** Five contracts were incomplete in the first draft and are corrected here: create-idempotency conflict detection, claim integrity on rename, the separation of human code from machine scan identity, the untruthful `originalCode` field, and an implied Administration configuration authority that P1 does not have.

**Final scan-contract correction, 2026-09-02.** An earlier draft described the barcode path as `barcode → resolveScannedIdentity → discover binId → fetch bin`. **`resolveScannedIdentity` is pure and discovers nothing** — it matches against candidates the caller already read. The governed lookup is now specified as a separate trusted read, `resolveBinToken`, and `FOUND_SUPERSEDED_LABEL` is removed from P1's machine contract because a `binId`-only token cannot reveal what text is printed on the label. See §9.

## Executive summary

A bin's document identity is currently `deriveBinDocId(warehouseId, code)` = `bin_{warehouseId}__{code}`. The human code **is** the database id, so correcting a mislabelled rack produces a *different document* and orphans that bin's placement history. Decision #160 (O-3) ruled that unacceptable.

BIN-P1 replaces the code-derived identity with a **stable surrogate `binId`**, moves the racking hierarchy into **structured attributes** (`area`, `aisle`, `bay`, `position`) from which the canonical display code is **derived**, enforces canonical-code reservation **within a warehouse** atomically and permanently, and separates the **human code** (warehouse-scoped, for manual entry) from the **machine scan identity** (globally unambiguous, for barcodes) so a stale or duplicated label can never resolve to the wrong physical bin.

P1 changes identity and structure only. **It does not touch custody**: a bin stays descriptive, put-away stays a placement event, no ledger event is written, and no quantity meaning changes. That is BIN-P6.

## Sprint objective

Give a bin an identity that survives a legitimate code correction, a structure that survives a change of display convention, and a scan identity that is unambiguous across warehouses — without altering what any inventory number means.

## Scope

**Backend — `functions/src/inventoryLocation/`**

- `binRegistry.ts` — stable id and fingerprint derivation; structured attribute validation; canonical code derivation; corrected resolution outcomes for both input paths.
- `binCommands.ts` — `createBin` reworked onto the surrogate id with replay/conflict detection; new `renameBin`; `setBinStatus` and `resolveBinCode` addressed by the new identity; claim reads and writes.
- `putAwayCommand.ts` — resolves either input path to the stable `binId`; placements persist it.
- `binCallables.ts` — request and response shapes for the above.

**New collection**

- `bin_code_claims` — the atomic reservation and code-history index (§Uniqueness).

**Frontend — contract only**

- `field-ops-app-vite/src/services/binCommandClient.js`
- `field-ops-app-vite/src/domain/putAwaySession.js` — the superseded-**code** outcome and its operator text.

**Unchanged, deliberately:** `field-ops-app-vite/src/domain/scannedIdentity.js` and `inventoryLocation.js`. Both stay **pure**: the governed bin lookup belongs to the trusted BIN read service, never to the scanner domain. §9 explains the separation and why no change to the shared boundary is needed or permitted.

**Tests** — `functions/test/binRegistry.test.mjs`, `putAwayCommand.test.mjs`, `scannerEndToEndContract.test.mjs`, `scannerReleaseReadiness.test.mjs`.

## Explicitly out of scope

- **Bin-level quantity, custody, or roll-up.** No ledger event, no `BIN` movement, no availability change. BIN-P6.
- **Administration racking UI and any operator-editable configuration.** BIN-P3. See §Configuration seam — P1 introduces no configuration authority.
- **Bulk generator** — odd numbering, per-aisle bay counts, irregular positions. BIN-P3. The schema must *support* it; P1 builds none of it.
- **Label generation, printing or export.** BIN-P5. P1 specifies only the identity contract P5 will encode.
- **Capability activation or grants.** BIN-P4.
- **Cycle Count BIN eligibility.** BIN-P7.
- **Visualization** — no coordinates, map fields, floor plan, drawing schema, image references, or visual editor.
- **Firestore Rules changes.** `bins`, `bin_placements` and `bin_code_claims` all stay match-block-free, which is deny-all.
- **Legacy `stock_locations` retirement.** BIN-P2.
- **Releasing a reserved code for reuse by a different bin.** P1 specifies only the refusal.
- **The migration itself.** P1 specifies the posture and the mandatory census gate; it writes no migration.

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
| `resolveBinCode` | read-only; normalizes, derives the id from **the expected warehouse**, reads the doc, delegates to pure `resolveBin` | `binCommands.ts` |
| `listBinsForWarehouse` | `where warehouseId ==`, limit 500 + truncation flag; a malformed stored bin is **excluded, not rendered** | `binCommands.ts` |
| `resolveBin` outcomes | `FOUND` / `INACTIVE` / `NOT_FOUND` / `WRONG_WAREHOUSE` / `MALFORMED`. Unrecognized status **fails closed to `INACTIVE`** | `binRegistry.ts` |
| Callables | `createBin`, `deactivateBin`, `reactivateBin`, `resolveBin`, `listBins`, `recordPutAway`; actor taken **only** from `request.auth.uid` | `binCallables.ts` |
| Placement record | already stores **both** `binId` and `binCode`, plus `warehouseId`, `partId`, `serialNo`, `quantity`, `placedAt/By`, `idempotencyKey`, `pickedForWorkOrderId`, `note`, `schemaVersion: 1` | `putAwayCommand.ts` |
| Placement id | `derivePlacementId(idempotencyKey, serialNo \| partId)` — independent of the bin id | `putAwayCommand.ts` |

There is **no structured hierarchy**: no `area`, `aisle`, `bay` or `position` field exists. The code is one flat string.

`binRegistry.ts` is pure and deliberately never emits a `BIN` `LocationRef`; a test asserts it. `putAwayCommand.ts` writes no ledger event; a test asserts it never imports one. Both remain true after P1.

**Note on today's `WRONG_WAREHOUSE`.** `resolveBin` can return it, but `resolveBinCode` derives the document id from the *expected* warehouse, so the stored `warehouseId` always equals the expected one and the branch is effectively unreachable on that path. It is reachable only if a caller reads a bin by some other means. §Resolution corrects this rather than preserving a promise the scoped path cannot keep.

### Uniqueness mechanism today

**Structural, via the derived id.** Two bins with the same code in the same warehouse *are* the same document, so a duplicate cannot be created. There is no uniqueness check, no index, and no claim document. **This is exactly what a surrogate id removes**, which is why P1 must add an explicit mechanism rather than simply swapping the id.

### Existing patterns reused

- **Governed uniqueness claim.** The Truck Registry (ADR-010, Decision #59) enforces a cross-document invariant Rules cannot express by writing `location_truck_claims/{locationId}` **inside the same transaction**. P1 reuses that shape.
- **Idempotency fingerprint.** Cycle Count, Receiving and Transfer share one convention: a deterministic document id derived from a caller `idempotencyKey`, plus a stored fingerprint over the **request-derived identity only**, deliberately excluding every server-computed value so a later state change cannot turn a legitimate replay into a conflict. Replay iff the fingerprint matches, conflict if not (`cycleCountRepository.ts` `fingerprintCycleCount` / `toIdentity`). P1 reuses that shape.
- **Shared scan boundary — and what it is not.** `normalizeScanToken` already unwraps JSON payloads, http(s) URLs, and `(TAYLOR|EOS)[-_:](PART|ASSET|WO|LOC|EQUIP)?[-_:]?` vendor prefixes. `resolveScannedIdentity` is **PURE**: it performs no I/O and discovers nothing. It matches a normalized token against **candidate records the caller has already read under its own authority**, and an `INVENTORY_LOCATION` matches only when the caller has already supplied `{ type, locationId }` with `type` in `INVENTORY_LOCATION_TYPES` — which does already include `BIN` (`domain/inventoryLocation.js`). The module's own header states the principle: *"Scanning resolves IDENTITY. Scanning does NOT determine AUTHORITY."* P1 needs **no change** to either module, and must not ask either to do a governed lookup.

### Capabilities and Rules

`inventory.location.bin.manage`, `inventory.location.bin.read` and `inventory.placement.record` are all `active: false` and granted to no Role. Two least-privilege Roles are declared but confer nothing.

`bins` and `bin_placements` have **no `firestore.rules` match block** — deny-all by absence — and `scannerReleaseReadiness.test.mjs` asserts that as a test rather than a claim. `bin_code_claims` joins them on the same footing.

### Persisted-record evidence

Measured on `f690f483`:

- The **only** writers of `bins` are `createBin` and `setBinStatus`. Nothing else in `functions/src`, `functions/scripts`, or any seed, fixture or certification-world generator writes the collection.
- Both are reachable only through callables gated on `inventory.location.bin.manage`, which is `active: false` — `resolveEffectivePermission` denies unconditionally ahead of any Role check.
- `bins` is deny-all to every client, so there is no client write path.
- The only code in `functions/` creating bins outside those commands lives in `functions/test/*` and runs against the emulator.

**An earlier draft concluded from this that no non-emulator bin could exist. The census disproved it, and the reasoning is corrected here.** Two things the repository walk missed:

1. **`active: false` is not global.** Per-environment capability activation means the sandbox callables are reachable even while the capability is inert in production. "Registered inactive" describes the default, not every environment.
2. **`scripts/runSandboxScannerScenarios.mjs` calls `createBin` and `recordPutAway` as real personas against the real deployed callables** — deliberately, since its own header states that test data is created "through the GOVERNED COMMANDS … never by writing documents directly". It is a `scripts/` release-readiness runner, not a `functions/` seed, which is why a `functions/`-scoped search did not surface it.

This is exactly the failure mode the census gate existed to catch: repository evidence bounds what *code* can do, never what an *environment* contains. See §11 for the measured result.

---

## Authority model

- **`warehouses`** is the governed custody parent. The whole warehouse set is read inside the create transaction so a bin cannot be created into a warehouse being removed concurrently.
- **`bins/{binId}`** is the **one** bin authority.
- **`bin_code_claims`** is a supporting reservation and history index. It holds no name, no hierarchy and no display data of its own; nothing resolves a location *from* it except by pointing back at a `binId`.
- **The machine scan token** is an identifier, not an authority (§Machine scan identity).
- **`inventory_transactions`** remains the sole quantity authority. P1 writes nothing to it.
- A bin remains **descriptive** until BIN-P6.

These are four *mechanisms* and **one authority**: `bins/{binId}`.

---

## Technical design

### 1. Stable bin identity

**`binId` is server-derived, immutable, opaque to the business, and independent of every business attribute.**

```
binId = "bin_" + sha256(idempotencyKey).slice(0, 40)
```

- **Who generates it:** the server, inside `createBin`. Callers supply an `idempotencyKey`; they **may not supply a `binId`**, and a request carrying one is rejected as an unknown field rather than ignored.
- **When:** once, at create.
- **Can it change:** never. No command updates it.
- **Independent of:** `warehouseId`, `area`, `aisle`, `bay`, `position`, `code`, and the warehouse's own code.

**Why an idempotency-key derivation rather than a random id.** Today's `createBin` is *idempotent by construction* — a repeat create finds the same derived document and returns `unchanged`, so "a warehouse worker scanning the same label twice is not punished". A random surrogate would destroy that and turn every retry into a duplicate bin. Deriving from a caller-supplied request nonce keeps retry-safety **and** severs the id from the business code. It is the pattern `cycleCountDocId(idempotencyKey)`, Receiving and Transfer already use.

### 2. Create idempotency: replay versus conflict

A derived id alone is not a complete idempotency contract. The same `idempotencyKey` reused with **different create intent** must not silently return the existing bin.

**Create identity — the exact request-derived fields:**

```
warehouseId
area
aisle
bay
position
idempotencyKey
```

**Fingerprint** — the repository convention, reused verbatim: a 16-hex `sha256` over a canonical JSON serialization of the create identity above (`canonicalJson` + `sha256(...).slice(0,16)`, as `fingerprintCycleCount` does), stored on the bin document as `fingerprint`.

**Deliberately excluded from both create identity and fingerprint:**

| Excluded | Why |
|---|---|
| `binId` | server-derived |
| `code` / `displayCode` | **derived** from the structured identity by the formatter — see below |
| formatter policy or any of its output | a policy change must never invalidate a legitimate replay |
| `status` | server-defaulted to `ACTIVE` |
| `version`, `schemaVersion`, timestamps, actor | server-computed |
| `name` | **not part of create identity** — see below |

**Why `code` is excluded, and why this is the load-bearing exclusion.** The canonical code is a *function of* `(area, aisle, bay, position)` and the formatter policy. Including it would make the fingerprint depend on formatter configuration, so a later width change (`AA1-003` → `AA01-003`) would turn a legitimate create replay into an `IDEMPOTENCY_CONFLICT`. **The structured attributes are the identity; the code is a rendering of it.** A formatter change can never invalidate a replay.

**Why `name` is excluded.** `name` is an optional human label explicitly "never used for matching" in the current registry. Making it part of create identity would mean correcting a typo in a rack's description turns a retry into a conflict. It is stored, it is updatable, and it is not identity.

**Replay comparison sequence** inside `createBin`'s single transaction:

1. authorize `inventory.location.bin.manage`;
2. read the `warehouses` set; validate the structured draft against it;
3. compute `binId` from `idempotencyKey` and `requestFingerprint` from the create identity;
4. read `bins/{binId}`;
5. **if absent** → derive the canonical code, `txn.create` the claim, `txn.create` the bin with its fingerprint, return `created`;
6. **if present** → recompute the stored record's fingerprint from its own stored create identity and verify it equals its stored `fingerprint` — a mismatch is `MALFORMED_STORED_RECORD`, never trusted;
7. **stored fingerprint == requestFingerprint** → return `unchanged` (replay). No write of any kind;
8. **stored fingerprint != requestFingerprint** → throw `BinIdempotencyConflictError`. **Fail closed: no `unchanged`, no modification of the existing bin, no second bin, no second claim.**

This preserves the existing "never revive a retired bin" rule: a replay against a retired bin returns `unchanged` with its actual `INACTIVE` status.

### 3. Racking structure

Stored as **independent, normalized attributes**, with the human code **derived**:

```
binId          bin_<40 hex>                immutable, server-derived
fingerprint    16 hex                      over create identity only
warehouseId    wh-phoenix                  governed parent
area           PARTS_ROOM                  normalized governed token
aisle          "A"                         1-2 letters, upper-case
bay            1                           INTEGER, not a formatted string
position       3                           INTEGER, not a formatted string
code           "A01-003"                   current canonical business code, DERIVED
name           "Bulk rack, north wall"     optional, never used for matching
status         ACTIVE | INACTIVE
version        integer
schemaVersion  2
createdAt/By, updatedAt/By
```

**`originalCode` is REMOVED** — see §4.

**`bay` and `position` are integers precisely so display width is not baked into identity.** A two-digit bay and a one-digit bay are the same bay. The client's open question — whether Warehouse bays are one digit or two (C-1) — is therefore a formatter setting, and **one-digit width must not be hard-coded anywhere in the schema.**

**Reserved even numbers need no schema support.** `position` is an integer; `001, 003, 005` are positions 1, 3, 5. Activating `002` later creates a bin at position 2 and touches no existing bin's `binId`, code, or history. P1 stores no assumption of parity, contiguity or density.

### 4. `originalCode` is removed

v1 accepted a free-form typed code, so `originalCode` truthfully meant "exactly what was typed before normalization". **P1 creation is structured** — `area`, `aisle`, `bay`, `position` — and the code is derived. There is no typed string, so `originalCode` would be a field with no truthful source.

**It is removed from `schemaVersion: 2`.** Code and its history are represented by:

- the **current** canonical code on `bins/{binId}`;
- **every** code the bin has held, in `bin_code_claims`.

No replacement human-authored label field is invented: `name` already exists for "Bulk rack, north wall", and nothing in the requirement asks for another.

### 5. Canonical display code derivation, and the configuration seam

`code` is derived from the structured attributes by a **formatter**, then normalized and validated against the existing `BIN_CODE_PATTERN` — which `A01-001` and `AA01-001` already satisfy unchanged.

**P1's formatter is a server-owned, injected policy seam.** It is:

- **server-owned** — supplied through the command's dependency composition, exactly as `resolveLocationActive` is pinned for Transfer and Cycle Count;
- **deterministic and unit-tested**;
- **not operator-editable, and not read from any stored configuration document.** P1 creates no configuration collection, no Administration surface, and no capability to change formatting.

P1 ships **one default policy** (aisle as given, bay zero-padded to width 2, position zero-padded to width 3, `-` between bay and position → `A01-003`). It is a default, not a client decision: C-1 remains open, and the seam exists so that answering it later changes an injected policy rather than a schema.

**BIN-P3** supplies the operator-editable governed configuration surface, its update semantics, and the bulk-rename consequence below.

**Area is the same story.** For P1, `area` is validated as a **normalized governed token** — non-empty, upper-case, path-safe, bounded length — and nothing more. **P1 does not define, store or enforce Taylor's final Area vocabulary.** C-2 and C-3 remain client input for BIN-P3 configuration. The validator enforces shape, safety and coherence; it does not fabricate a list.

**A consequence to state rather than discover:** once BIN-P3 makes the policy configurable, changing a warehouse's format changes the canonical code of every bin under it. That is a **governed bulk rename** running the §7 path — it changes no `binId` and orphans no history, but it is not a silent re-render, and BIN-P3 must present it as a rename rather than a display toggle. **It also invalidates printed labels' visible text — but not their machine identity** (§9).

### 6. Code reservation and uniqueness

The enforced rule is **stronger** than "two active bins cannot share a code":

> Once a canonical code has been claimed by a bin in a warehouse, that code stays reserved to **that same `binId`** — including after a rename, and including while the bin is `INACTIVE` — unless a future, explicitly governed release operation exists. **P1 implements no release.**

```
bin_code_claims/{warehouseId}__{canonicalCode}
  binId         the bin this code is reserved to — never changes
  warehouseId
  code          the canonical code claimed
  claimState    HELD | SUPERSEDED
  claimedAt / claimedBy
  supersededAt / supersededBy   present only when SUPERSEDED
  schemaVersion 1
```

- `HELD` — the bin's **current** canonical code.
- `SUPERSEDED` — a **historical** code, permanently reserved to the same `binId`.
- **A second bin may claim neither.** `createBin` and `renameBin` write claims with `txn.create` — create-if-absent — so a competing claim fails the transaction atomically. There is **no query-then-write**, no client-side check, and no eventual cleanup.
- The claim id derives from `(warehouseId, canonicalCode)`; both segments are already constrained to path-safe characters (`isSafeIdSegment`, `BIN_CODE_PATTERN`).
- **Reservation is warehouse-scoped** (O-7): `Phoenix / A01-001` and `Seattle / A01-001` are two claims, two bins, two `binId`s.

**Deactivation does not release a code.** An `INACTIVE` bin retains its `HELD` claim and every `SUPERSEDED` claim. Reactivation reclaims nothing, because nothing was ever released.

### 7. Rename and code history

Option **B** — the governed claim collection — is used, because it is already required for reservation, so history rides on it at no extra cost. Option **A** (`previousCodes[]` on the bin) was evaluated and rejected: an array cannot atomically prevent a *different* bin from taking a released code.

`renameBin(binId, newStructuredAttributes)` — **one transaction**:

1. authorize `inventory.location.bin.manage`;
2. read `bins/{binId}`; **fail closed** if absent (`BinNotFoundError`) or malformed (`BinMalformedStoredRecordError`);
3. validate the new structured attributes; derive the new canonical code;
4. **if the new code equals the current canonical code** → return an idempotent no-op (`unchanged`). **Do not `txn.create` a claim the bin already holds** — that would fail against its own reservation;
5. read the **old** claim at `(warehouseId, currentCode)`;
6. the old claim **must** exist, reference **this exact `binId`**, match **this warehouse**, match **this current canonical code**, and be in `claimState: HELD`;
7. any mismatch or absence → **`BinClaimIntegrityError`. No rename.** Rename **never repairs** a missing or wrong claim silently;
8. `txn.create` the new claim as `HELD` — fails atomically if any bin already holds or has superseded that code;
9. update the old claim to `SUPERSEDED`, still pointing at the **same `binId`**;
10. update the bin's structured attributes, `code`, `version`, `updatedAt/By`;
11. commit.

**`binId` is untouched.** `bin_placements`, future ledger evidence, cycle counts and audit records continue to refer to the same bin.

**Rename is permitted on an `INACTIVE` bin** — correcting a mislabelled retired rack is legitimate, and it changes no availability because a bin has no custody. Status is untouched by rename.

**Integrity failure taxonomy** (sanitized, one class per reason, matching the repository's command-error convention):

| Error | Meaning |
|---|---|
| `BinIdempotencyConflictError` | `idempotencyKey` reused with different create identity |
| `BinClaimIntegrityError` | old claim missing, wrong bin, wrong warehouse, wrong code, or wrong state |
| `BinCodeReservedError` | the target code is `HELD` or `SUPERSEDED` by another bin |
| `BinMalformedStoredRecordError` | stored bin or claim fails its own coherence check |
| existing `BinInvalidError` / `BinUnauthorizedError` / `BinNotFoundError` | unchanged |

### 8. Human code resolution — warehouse-scoped

For manual entry and for any flow that already carries a governed warehouse context:

```
warehouseId + "A01-001"
  -> normalize
  -> bin_code_claims/{warehouseId}__{code}
  -> binId
  -> bins/{binId}
```

| Outcome | Meaning |
|---|---|
| `FOUND` | The `HELD` code of an `ACTIVE` bin in this warehouse |
| `FOUND_SUPERSEDED_CODE` | A `SUPERSEDED` code of a bin in this warehouse. Carries `binId`, the **current** canonical code, and the superseded code. The bin is correct; **the label is outdated** |
| `INACTIVE` | Resolved to a retired bin. Unrecognized stored status still fails closed to this |
| `NOT_FOUND` | Well-formed code, no claim in this warehouse |
| `MALFORMED` | Not a usable code |

**`WRONG_WAREHOUSE` is deliberately absent from this path.** The lookup is scoped to the supplied warehouse, so it cannot observe that another warehouse holds the same code — and it must not. `Seattle + A01-001` resolves Seattle's bin correctly and is not confused by Phoenix also having an `A01-001`. Claiming `WRONG_WAREHOUSE` here would be a promise the scoped lookup cannot keep; today's branch is already effectively unreachable on this path.

**A historical code never resolves to a different bin.** It resolves to its own bin or it does not resolve.

### 9. Machine scan identity — globally unambiguous

Because Decision #160 permits the same human code in different warehouses, **a barcode carrying only `A01-001` is not sufficient to identify a physical bin.** The machine identity is therefore a different thing from the human code.

**The machine scan token is the `binId`.** It is already globally unique (a `sha256` derivation), opaque, immutable, and independent of every business attribute — which is exactly what a scan token must be.

**Three modules, three jobs, and the boundary between them is the point:**

| Module | Job | Does it read Firestore? |
|---|---|---|
| `normalizeScanToken` (existing, unchanged) | **Parses machine input.** Unwraps JSON payloads, http(s) URLs, and `(TAYLOR\|EOS)[-_:](…LOC…)` prefixes into a bare token | No — pure |
| `resolveBinToken` (**new**, trusted) | **Performs the governed record lookup** and the warehouse-context comparison | Yes — server-side, Admin SDK, under `inventory.location.bin.read` |
| `resolveScannedIdentity` (existing, unchanged) | **Matches a token against candidates the caller already read.** Generic identity matcher | No — pure, and must stay so |

```
raw barcode
  -> normalizeScanToken(raw)                      pure parse
  -> stable binId token
  -> resolveBinToken(binId, activeWarehouseContext)   TRUSTED lookup
       read bins/{binId}
       fail-closed bin validation
       compare bin.warehouseId with the active warehouse context
  -> FOUND | WRONG_WAREHOUSE | INACTIVE | NOT_FOUND | MALFORMED
  -> on FOUND, a canonical governed reference: { type: "BIN", locationId: binId }
```

**`resolveScannedIdentity` does not discover a bin, and this specification does not ask it to.** It is pure by design — it performs no I/O and matches only against `candidates.locations` that the caller has already read under its own authority. An earlier draft of this specification implied a `barcode → resolveScannedIdentity → discover binId → fetch bin` sequence. **That is not what the source does**, and it is corrected here.

The trusted resolver's `FOUND` result *produces* the canonical `{ type: "BIN", locationId: binId }` reference, which a caller may then hand to `resolveScannedIdentity` as a candidate wherever generic multi-entity scan composition is useful — a workflow screen that accepts a part, a work order or a bin from one input field, for example. That is the correct direction: **the trusted lookup supplies the candidate; the pure matcher never fetches it.**

**Prohibited, explicitly:**

- making `scannedIdentity.js` perform Firestore I/O;
- adding any direct client read of `bins`;
- preloading every bin across every warehouse into the candidate set so the pure matcher could "discover" a wrong-warehouse token — this would be both an unbounded read and a client-side authority leak;
- a second scan resolver, a second Location registry, or a bin-specific scanner stack.

`resolveBinToken` is part of the **existing trusted BIN read authority** (`inventory.location.bin.read`), alongside `resolveBinCode` and `listBinsForWarehouse`. It is a new command shape, not a new capability.

**Properties this gives, by construction:**

- **globally unambiguous** — two warehouses' `A01-001` bins have different `binId`s, therefore different barcodes;
- **stable across a legitimate rename** — renaming changes `code`, never `binId`, so **the barcode keeps working**;
- **stable across a format-width change** — `AA1-003` → `AA01-003` changes visible text only; the machine identity is unchanged.

**Barcode-path resolution outcomes:**

| Outcome | Meaning |
|---|---|
| `FOUND` | `binId` resolved, bin `ACTIVE`, `bin.warehouseId` matches the active warehouse context |
| `WRONG_WAREHOUSE` | `binId` resolved to a real bin **in another warehouse** — the operator is in the wrong building. This is where `WRONG_WAREHOUSE` genuinely belongs, and it is determinable here **because the token identifies the bin globally** |
| `INACTIVE` | Resolved to a retired bin |
| `NOT_FOUND` | Well-formed token, no such bin |
| `MALFORMED` | Not a usable token |

**There is no `FOUND_SUPERSEDED_LABEL` in P1's machine contract.** A token carrying only `binId` tells the system nothing about what human-readable text is printed beside the barcode, so P1 cannot honestly detect a stale printed code from a scan. Claiming otherwise would be a promise the payload cannot keep.

**The honest consequence, stated plainly:** after a rename, a physical label's **printed text can be stale while its barcode still resolves correctly**. That is acceptable and truthful — the operator reaches the right bin; the sign on it reads the old code until it is reprinted.

Whether the system can *also* detect a stale printed code is a **BIN-P5 question**, to be answered once the label payload is actually designed. P5 may choose to encode `locationId` plus `printedCode`, or a `labelVersion`, or another governed payload. **That is not a P1 decision, and P1 invents no label-version parsing.**

**What the label carries is BIN-P5's design.** P1 fixes only the identity contract: the human-readable code for people, and a token that resolves to the stable `binId` for scanners.

### 10. Put-away compatibility

`bin_placements` **already stores both `binId` and `binCode`**, so the shape barely moves.

**Two input paths, one persisted identity:**

| Path | Resolution |
|---|---|
| Operator types or picks a code | `warehouseId + code` → §8 → `binId` |
| Operator scans a barcode | machine token → §9 → `binId` → warehouse check |

In both cases the placement persists:

- **`binId`** — the stable id, the durable reference that survives a rename;
- **`binCode`** — the code **as it was at placement time**: a point-in-time historical fact, deliberately never updated by a later rename.

**Placement history survives a rename by construction**, because it never referenced the code as identity. Placement ids stay `derivePlacementId(idempotencyKey, serialNo | partId)` — already independent of the bin id, so idempotency is unaffected.

**Put-away accepts a superseded code or label** — the physical bin is correct, and refusing a stow because a label is old would block honest work — but returns the outcome so the caller can flag it. Whether the UI then requires confirmation is a **BIN-P3/P5 UX decision**, not an authority question.

**No custody change.** `putAwayCommand.ts` still writes no ledger event, no quantity and no balance, and the test asserting it never imports the ledger stays green.

### 11. Migration posture — census PERFORMED, and it changed the answer

**The mandatory pre-implementation census has been run. It is recorded here as evidence, not as a decision.**

| Environment | Project | `bins` | `bin_placements` | Read mechanism | Measured |
|---|---|---|---|---|---|
| **Sandbox** | `eos-platform-sandbox` | **63** | **42** | Firebase MCP `firestore_list_documents`, read-only, field-masked, as `rudy.digiorgio@gmail.com` | 2026-09-02 |
| **Production** | `taylor-parts` | **0** | **0** | same | 2026-09-02 |

Both listings returned **no `nextPageToken`**, so the counts are complete rather than a first page. Project identities came from `config/environments.json` and `.firebaserc`; no project was switched and no Firebase configuration was modified to perform the read.

**Sandbox classification: fixture / disposable release-readiness artifacts, created through the governed commands.** Not hand-seeded, and not customer or operational data. The evidence is exact:

- `scripts/runSandboxScannerScenarios.mjs` computes `RUN = "v" + Date.now()`, then `BIN = "A14" + RUN.slice(-5)`, `STAGE_BIN = "ST" + RUN.slice(-5)`, and a third bin `"NB" + RUN.slice(-5)` at `wh-north`. Every one of the 63 bins matches that generator: 21 `A14…` and 21 `ST…` at `wh-main`, 21 `NB…` at `wh-north` — **21 scenario runs**, dated 2026-08-21 to 2026-08-26.
- The 42 placements are `plc_plc-v<epoch>__PRT-1001` and `plc_pick-v<epoch>__PRT-1001` — the runner's `plc-${RUN}` and `pick-${RUN}` idempotency keys, two per run, all for the single scenario part.
- All 63 bins are `ACTIVE`, all v1 shape, all `schemaVersion: 1` on the placement side.

**They are nonetheless real governed records, written through the real commands, and they are not this specification's to delete.**

> **BIN-P1 implementation is BLOCKED.** The census result is **CASE B** — sandbox non-empty, production empty. Clean shape replacement is *not* authorized on the strength of repository evidence alone, because that evidence was wrong.

**Two dispositions are available, and choosing between them is an Owner decision, not an implementation detail:**

- **Regenerate.** Treat the 63 bins and 42 placements as spent scenario output, clear them under a governed operation, and re-run `runSandboxScannerScenarios.mjs` after BIN-P1 ships. Cheapest, and it matches what the records actually are. It does discard the record of 21 past scanner-release validation runs.
- **Migrate.** Map each `bin_{warehouseId}__{code}` to a new surrogate `binId`, mint the corresponding `bin_code_claims` entry, and rewrite `bin_placements.binId` — all in one governed operation. Preserves the evidence trail at the cost of a migration that exists only to serve disposable data.

**Claude Code recommendation: regenerate**, because the records are scenario output whose value is the *run*, not the row, and the runner reproduces them on demand. **Not decided here.**

Whichever is chosen, once BIN-P1 ships, `schemaVersion` moves to `2` and the fail-closed deserialize rejects a v1 document loudly rather than reading it — the posture the Cycle Count and warehouse validators already take. **No dual-version reader**, in either disposition.

**No `bin_placement` may ever be orphaned.** If migration is chosen, it rewrites placement `binId` in the same governed operation that mints the new bin identity, or it does not run. If regeneration is chosen, bins and placements are cleared together — never bins alone.

**Production remains empty and must be re-confirmed immediately before implementation**, since this census is a point-in-time reading and BIN-P4 has not yet activated anything there.

### 12. Commands affected

| Command | Change |
|---|---|
| `createBin` | Structured attributes + `idempotencyKey`; derives `binId`, `fingerprint` and the canonical code; writes bin **and** claim in one transaction; replay/conflict per §2; still never revives a retired bin |
| `renameBin` | **New command shape** (§7) |
| `setBinStatus` | Addressed by `binId`, **or** `(warehouseId, code)` for the existing scan-first flow; behaviour otherwise unchanged, including `unchanged` on a no-op; **does not touch claims** |
| `resolveBinCode` | Claim-based lookup; outcomes per §8; **`WRONG_WAREHOUSE` removed from this path** |
| `resolveBinToken` | **New read** for the barcode path; outcomes per §9 |
| `listBinsForWarehouse` | Returns structured attributes alongside `binId`, `code`, `name`, `status`; limit and truncation unchanged; malformed rows still excluded; **never reads `bin_code_claims`** |
| `recordPutAway` | Resolves either input path and persists the stable `binId` |

### 13. Capability and governance impact

**None.** All bin capabilities stay `active: false` and granted to no Role, and no ordinary role grant changes.

`renameBin` and `resolveBinToken` are **new command shapes, not new authority**: maintaining the physical bin registry is exactly what `inventory.location.bin.manage` describes and what the declared `inventoryBinAdministrator` Role carries, and resolving a scanned bin is what `inventory.location.bin.read` describes. Registering a new capability merely because a function name is new would add a rollout step without adding a boundary — and Decision #119's corollary cuts the other way too: a capability is registered when least privilege *requires* one, not when a signature changes.

**If the Owner later wants rename separately grantable from create/retire**, that is a new capability and a Tier 2 change — recorded as a future-stage option, **not** a decision this specification makes or needs.

## Firestore Rules impact

**None.** Neither `firestore.rules` copy changes. `bins`, `bin_placements` and the new `bin_code_claims` have no match block, which is deny-all; all three are Admin-SDK-only. `scannerReleaseReadiness.test.mjs` already asserts the first two, and P1 extends that assertion to `bin_code_claims`.

## UI impact

**None visible.** No screen changes. Two domain contract modules change so BIN-P3 and BIN-P5 have a correct base: `services/binCommandClient.js` (new request and response shapes) and `domain/putAwaySession.js` (the superseded outcomes and their operator text). `PutAwayScan.jsx` and `PickScan.jsx` continue to work against the existing outcomes. `scannedIdentity.js` is **not** modified.

## Testing strategy

Pure-unit tests in `binRegistry.test.mjs`; emulator tests following the existing harness (`scannerEndToEndContract.test.mjs` imports compiled `../lib`).

**Identity**
1. `createBin` produces a stable surrogate `binId` containing no business attribute
2. a caller-supplied `binId` is **rejected**, not silently ignored
3. `binId` is immutable — no command path updates it
4. two different structured identities in one warehouse create two different bins
5. the same structured identity in two different warehouses yields two different `binId`s

**Create idempotency**
6. same `idempotencyKey` + identical create identity → `unchanged`, no write
7. same `idempotencyKey` + different `warehouseId` → `BinIdempotencyConflictError`
8. same `idempotencyKey` + different structured rack attributes → `BinIdempotencyConflictError`
9. a conflict leaves the existing bin, its claim and its fingerprint untouched
10. changing the formatter policy does **not** change the create fingerprint, and a legitimate replay still returns `unchanged`
11. changing `name` does not turn a replay into a conflict
12. a stored bin whose recomputed fingerprint disagrees with its stored one is `MALFORMED_STORED_RECORD`
13. a replay against a retired bin returns `unchanged` with `INACTIVE` — it is not revived

**Code reservation**
14. two bins in one warehouse cannot hold the same canonical code — the claim `txn.create` fails atomically
15. the same code in two warehouses is allowed and produces two claims
16. a `SUPERSEDED` code is permanently reserved — a different bin claiming it fails with `BinCodeReservedError`
17. deactivation releases neither the `HELD` nor any `SUPERSEDED` claim
18. reactivation reclaims nothing and reuses the same `binId` and claims

**Rename and claim integrity**
19. a legitimate rename preserves `binId`
20. rename marks the old claim `SUPERSEDED` (same `binId`) and `HELD`s the new one, in one transaction
21. rename to the current canonical code is an idempotent no-op and creates no claim
22. a missing old claim causes `BinClaimIntegrityError` — no rename, no repair
23. an old claim pointing at a different `binId` causes `BinClaimIntegrityError`
24. an old claim in the wrong warehouse or wrong state causes `BinClaimIntegrityError`
25. rename is permitted on an `INACTIVE` bin and does not change its status

**Human-code resolution**
26. `FOUND` for the `HELD` code of an active bin
27. `FOUND_SUPERSEDED_CODE` returns the original bin and its current canonical code
28. a superseded code never resolves to another bin
29. `Seattle + A01-001` resolves Seattle's bin and is not confused by Phoenix's `A01-001`
30. `NOT_FOUND` for a well-formed code with no claim in that warehouse
31. `INACTIVE` preserved, including unrecognized stored status failing closed
32. `MALFORMED` preserved
33. the warehouse-scoped path **never** returns `WRONG_WAREHOUSE`

**Machine scan identity** — these prove the three-module separation, not a candidate-discovery flow
34. `normalizeScanToken("EOS-LOC:bin_x")` → `bin_x`; bare `bin_x`, a JSON payload and an http(s) URL all normalize to the same token through the **existing** boundary
35. `resolveBinToken(bin_x, correct warehouse context)` → `FOUND`
36. `resolveBinToken(bin_x, wrong warehouse context)` → `WRONG_WAREHOUSE`
37. `resolveBinToken` on an unknown token → `NOT_FOUND`; on a retired bin → `INACTIVE`; on an unusable token → `MALFORMED`
38. a `FOUND` result yields the canonical reference `{ type: "BIN", locationId: bin_x }`
39. when that canonical reference is supplied as a `candidates.locations` entry, `resolveScannedIdentity` resolves the same `binId` — the trusted lookup supplies the candidate, the pure matcher never fetches it
40. **no global or cross-warehouse client-side bin preload is introduced** — nothing reads more than one bin to resolve one token
41. `scannedIdentity.js` is unmodified by this PR and performs no Firestore I/O
42. `inventoryLocation.js` is unmodified by this PR
43. Phoenix and Seattle bins sharing the human code `A01-001` receive **distinct** machine scan identities
44. a barcode resolves to the same `binId` after a legitimate human-code rename
45. a format-width change (`AA1-003` → `AA01-003`) does not alter the machine identity
46. **no `FOUND_SUPERSEDED_LABEL` outcome exists** in P1's machine-token contract

**Put-away**
47. a placement records the stable `binId`
48. renaming a bin does not orphan placement history — earlier placements still resolve to the same bin
49. `binCode` on an existing placement is **not** rewritten by a later rename
50. both input paths (typed code, scanned token) produce the same persisted `binId`

**Schema**
51. `schemaVersion: 2` contains **no** `originalCode` field
52. `area`, `aisle`, `bay`, `position` validate independently of display width — bay `1` is valid whether rendered `1` or `01`
53. the canonical code derives deterministically from the injected formatter policy
54. the formatter policy is server-owned and injected; **no configuration collection, Administration surface or capability is introduced**
55. `area` is validated as shape only — no fixed Taylor vocabulary is enforced

**Non-authority guards**
56. **no ledger write** from create, rename, retire, resolve or put-away — the modules still import no ledger, movement type or balance function
57. **no `stock_locations`** read or write authority is introduced
58. all bin capabilities remain `active: false` and granted to no Role
59. `bins`, `bin_placements` **and `bin_code_claims`** have no `firestore.rules` match block
60. no Cycle Count eligibility change — the countable-type policy still resolves to `WAREHOUSE`/`MOBILE`
61. no coordinate, map, floor-plan or image field exists on any bin record

Migration tests are added **only if** the census proves records must be transformed.

## Acceptance criteria

- [ ] `binId` is server-derived, immutable, and contains no `warehouseId`, area, aisle, bay, position or code; a request supplying one is rejected.
- [ ] Create idempotency is fingerprint-backed: same key + same intent replays; **same key + different intent fails closed** with no write and no modification of the existing bin.
- [ ] The formatter policy and its output are **excluded** from create identity and fingerprint, so a format change can never invalidate a legitimate replay.
- [ ] `bay` and `position` are integers; no display width appears in any stored field or validator.
- [ ] Two bins in one warehouse cannot hold the same canonical code, enforced by `txn.create` inside the same transaction — no query-then-write anywhere in the path.
- [ ] A `SUPERSEDED` code remains permanently reserved to its original bin; **P1 implements no release**.
- [ ] `INACTIVE` bins retain their identity, their `HELD` claim and their history; deactivation frees no code.
- [ ] Rename verifies the old claim's existence, bin, warehouse, code and state before proceeding, and **never repairs** a bad claim silently; rename to the current code is a no-op.
- [ ] Rename preserves `binId` and leaves every existing `bin_placement` resolving to the same bin, with its historical `binCode` unrewritten.
- [ ] The raw human code is **not** the machine barcode identity; the machine identity is globally unambiguous and stable across rename and across a format-width change.
- [ ] `WRONG_WAREHOUSE` is returned only on the machine-identity path; the warehouse-scoped code path never returns it.
- [ ] The governed bin lookup lives in the **trusted** `resolveBinToken`, not in the scanner domain: `scannedIdentity.js` and `inventoryLocation.js` are unmodified and perform no I/O, and no direct client read of `bins` is added.
- [ ] Resolving one scanned token reads **one** bin — no global or cross-warehouse candidate preload exists.
- [ ] P1's machine-token contract has **no `FOUND_SUPERSEDED_LABEL` outcome**, and the specification makes no claim that a `binId`-only token can reveal a stale printed code.
- [ ] The shared scan boundary is used unmodified — no bin-specific scanner stack, no parallel Location authority.
- [ ] `originalCode` is absent from `schemaVersion: 2`.
- [ ] **No Administration formatter or Area configuration authority is created in P1** — the policy is server-owned and injected, and `area` is validated as shape only.
- [ ] `git diff` touches no `firestore.rules` copy, no capability file, and no role or grant definition.
- [ ] All 61 tests pass.
- [ ] **The sandbox and production environment census is recorded before implementation begins.** *(Done 2026-09-02 — §11. Production 0/0; sandbox 63 bins / 42 placements. Implementation additionally requires an Owner ruling on the sandbox disposition.)*

## Rollback strategy

**Fully reversible; no irreversible step.**

P1 is repo-only. Every bin capability remains `active: false` and granted to no Role, so no principal can invoke any of these commands in any environment — no sandbox or production data can be written by this change. Reverting the PR restores the current shape completely. The only state that can exist is emulator data, regenerated by re-running the tests.

**This ceases to be true the moment BIN-P4 activates the capabilities**, which is precisely why O-5 sequenced activation after the model is coherent.

## Risks

- **The idempotency-key derivation is load-bearing.** Swapping to a random id would silently reintroduce duplicate bins on retry. Tests 6–13 are the guard.
- **The fingerprint's exclusions are load-bearing.** Including the derived code would couple replay detection to formatter configuration; test 10 exists precisely because that failure would be invisible until the first width change.
- **The claim collection is a new surface.** If anything ever resolves a *location* from `bin_code_claims` rather than from `bins`, it has become a second Location registry. Its schema carries no name, hierarchy or display data so there is nothing to resolve from, and test 47's sibling constraint keeps `listBins` off it.
- **Reservations accumulate monotonically.** Every rename leaves a permanent claim. That is the point — releasing them is what would let a stale label point somewhere new — but the collection only grows, and no listing path may read it.
- **Format-change ripple.** Changing a warehouse's bay width renames every bin under it. Identities, history and barcodes survive; printed visible text does not. This is why C-1 must close before BIN-P5 prints, and why BIN-P3 must present a format change as a bulk rename.
- **A stale printed code is invisible to P1, by design.** After a rename the barcode keeps resolving correctly while the printed text still reads the old code. P1 cannot detect that from a `binId`-only token and does not pretend to. The operational cost is a wall that reads one thing and scans as another until relabelled; the alternative — inventing a label payload now — would guess at BIN-P5's design.
- **The purity boundary is easy to erode.** The tempting shortcut is to let the scanner domain fetch a bin, or to preload every warehouse's bins so the pure matcher can spot a wrong-warehouse token. Either would turn an identity matcher into an authority and an unbounded read. Tests 40–42 exist to make that regression fail loudly.
- **The census is outside this repository.** The migration posture rests on "nothing can have written `bins`", proven from source but not from the environments.

## Open questions

**No Owner architectural decision is open.** Everything P1 needs is settled by Decision #160 and ADR-014.

```
BLOCKING, NON-ARCHITECTURAL — census DONE, disposition OPEN
  Census performed 2026-09-02 (§11). Production empty (0/0). Sandbox holds
  63 bins and 42 placements, classified as disposable scanner-scenario
  output from 21 runs of scripts/runSandboxScannerScenarios.mjs.
  CASE B => BIN-P1 implementation is BLOCKED until the Owner rules the
  sandbox disposition: REGENERATE (recommended) or MIGRATE.
  Production must be re-confirmed empty immediately before implementation.

CLIENT (shape BIN-P3/P5 configuration and labels, NOT the P1 schema)
  C-1  Warehouse bay display width, one digit or two. Stored as an integer
       either way; must close before BIN-P5 prints.
  C-2  Final Phoenix Parts Room and Warehouse area codes.
  C-3  Actual Area vocabulary. P1 validates shape only and enforces no list.
  C-4  Barcode symbology.
  C-5  Label medium.
  C-6  Part-to-bin operating rules.
  C-7  Irregular / deep / oversized position attributes.

FUTURE-STAGE (not blocking BIN-P1)
  - Releasing a reserved code for reuse by a different bin: P1 specifies the
    refusal; the governed release command is unscoped.
  - Whether rename should become separately grantable from create/retire.
    Not required; would be a new capability and Tier 2.
```

## Cycle Count relationship

**Nothing in Cycle Count changes.** P1's only guarantee to it: **the stable `binId` is usable, unchanged, as the governed `locationId` when BIN later becomes an eligible Cycle Count location type** — because it is immutable, path-safe, globally unique, and independent of every business attribute. It is already the shape `INVENTORY_LOCATION` expects.

The Cycle Count implementation plan and A1 specification are on branch `claude/cycle-count-a1-spec` (commits `7e457d7f`, `f585125d`) and are **not yet on `main`**. That architecture is not duplicated here.

## Approval

Pending final review. **Implementation is not authorized by the existence of this document.**

The environment census is complete (§11) and did **not** clear the way: production is empty, but sandbox holds 63 bins and 42 placements. Implementation therefore remains gated on an Owner ruling for the sandbox disposition — **regenerate** (recommended) or **migrate** — plus a re-confirmation that production is still empty at that moment.
