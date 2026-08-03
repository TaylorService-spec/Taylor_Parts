---
artifact_type: specification
gate: I-LA (Receiving Location Authority) — C2 Warehouse Status
status: Draft
date: 2026-08-03
owner: Claude Code
session: INVENTORY
depends_on:
  - docs/specifications/receiving-selectable-location-authority.md
  - docs/specifications/enterprise-inventory-receiving-phase2.md
  - docs/specifications/enterprise-inventory-architecture.md
related_adrs: [ADR-003, ADR-005, ADR-010]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: null
target_release: null
---

# I-LA — Receiving Location-Eligibility Authority: **Ratify C2 (`warehouses.status`)**

**Status: DRAFT — docs-only. Merging this document authorizes NO implementation.** It
creates no runtime code, Firestore Rule, index, Function, callable, capability,
deployment, migration, or production-data change. It *selects and fully specifies*
Option **C2** from the reconciliation spec
(`receiving-selectable-location-authority.md` §2/§6): `warehouses` becomes the governed
first-slice Receiving location-eligibility authority through an explicit governed
`status` field. Implementation is deferred to the phased PR sequence in §10, each its
own DRAFT → Codex → Owner-merge gate.

**Session boundary.** Authored by the **INVENTORY** session, which owns `functions/**`
destination validation, warehouse persistence writers, `firestore.rules`/indexes,
capability changes, migrations, and backend deployment. The frontend
adapter/hook/UI/tests (`src/services/*location*Options*`, `src/hooks/*Location*Options*`)
remain **CUSTOMER**-owned; this document references them as downstream consumers and
does not edit them, the CUSTOMER reconciliation doc, `DECISIONS.md`,
`SYSTEM_AUTHORITIES.md`, or any Customer PR. It touches exactly one new docs file.

**Verified against `origin/main` @ `f8aceea`** (authoritative head at issue). Path
convention: `firestore.rules`, `functions/…`, `docs/…` repo-root-relative; `src/…`
relative to `field-ops-app-vite/`.

---

## 0. Why this gate exists

The merged Receiving frontend cutover spec (`inventory-receiving-frontend-cutover.md`
§0.5/§18) and the Phase-2 command both *assume* an "active governed Location" exists
but pin no authority for it. The reconciliation spec confirmed there is **no
active-location authority today** and recorded **Option D — HALT / fail closed** until
an Inventory-owned gate ratifies one of C1/C2/C3
(`receiving-selectable-location-authority.md:87-94`, `:98-104`). This is that gate for
**C2**.

---

## 1. Reconciliation — as-is on `main` (READ-ONLY, VERIFIED)

### 1.1 `warehouses` schema and writers

- **Type carries no lifecycle field.** `functions/src/types/warehouse.ts:10-14` —
  `interface Warehouse { id: string; name: string; location: string }`. The client
  mirror `RawWarehouse` is identical (`field-ops-app-vite/src/services/operationsQueries.ts:35-39`).
  No `status`/`active`/`enabled`/`lifecycle`/`deleted` field exists on the type.
- **No production writer exists.** No trusted command, callable, repository, or service
  creates/updates a `warehouses/{id}` document. `warehouseService.ts` writes only
  `stock_locations` and `transfer_orders`, never `warehouses`
  (`functions/src/warehouseService.ts:12-14`). The only warehouse-document writers are
  the demo seed (`functions/scripts/seedOperationsDemoData.js:37-40`, sets
  `{ id, name, location }` only) and test/verification fixtures. **C2 therefore
  introduces the first trusted warehouse writer** (§5).
- **No versioning / audit / idempotency** on warehouse docs today — unlike the Truck
  Registry, which enforces `version`/`createdAt`/`createdBy`/`updatedAt`/`updatedBy`
  (`functions/src/truckRegistry/truckRegistryRepository.ts:22-28`). Warehouses are
  treated as static admin-provisioned reference data.

### 1.2 The pre-existing, un-governed `status`/`active` convention (critical)

A **merged, live** reader already interprets warehouse `status`/`active`:

- `functions/src/truckRegistry/truckRegistryRepository.ts:191-198` — `isWarehouseActive`:
  `return d.active !== false && d.status !== "INACTIVE";` — **existence-primary:
  absence of any flag ⇒ active**; only an explicit `active===false` **or**
  `status==="INACTIVE"` fails closed.
- Consumed by the Truck Registry create / home-warehouse-change commands
  (`truckRegistryCommands.ts:185`, `:313` → `WarehouseInvalidError` / callable error
  `WAREHOUSE_INVALID`, `truckRegistryCallables.ts:44`).
- Fixtures already seed both flags: `functions/scripts/truckFunctionsVerificationMatrix.js:35-36`
  (`{ name, status: "ACTIVE", active: true }`); inactive test seeds use
  `{ name, active: false }` (`functions/test/truckRegistryCommands.test.mjs:44`,
  `truckRegistryCallables.test.mjs:89`).

**Consequence for C2 (§3).** Two overlapping flags (`active` boolean, `status` string)
are read today, with a **runtime-inferred default** (`absence ⇒ active`) that the Owner
directive and the reconciliation spec (`:87-94`) explicitly reject for a governed
authority. C2 must (a) pick a single governed field, (b) define precedence over the
legacy flag, and (c) backfill so no consumer relies on inference — **without breaking
`isWarehouseActive`.**

### 1.3 Rules posture

- `firestore.rules:1177-1180` — `match /warehouses/{warehouseId}`:
  `allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId);`
  `allow create, update, delete: if false;`. **All client writes denied** → any
  governed `status` is Admin-SDK-written and client-untamperable. **Read** = admin /
  dispatcher (`firestore.rules:22-24`) **or** a WAREHOUSE_MANAGER assigned to *that*
  warehouse (`isAssignedToWarehouse`, `firestore.rules:139-150`, which checks the
  linked **Employee's** `employmentStatus == "ACTIVE"` — not any warehouse status).
- Root and `field-ops-app-vite/firestore.rules` are byte-identical mirrors, enforced
  as a hard pre-emulator gate by `functions/scripts/rulesRegressionRunner.mjs`
  (`checkRulesIdentical`, `:83-88`, `:260-266`).

### 1.4 Phase-B Receiving location seam

- `functions/src/inventoryReceiving/receiveInventoryStockCommand.ts:63` — injected
  dependency `resolveLocationActive: (txn: Transaction, location: { type: string; locationId: string }) => Promise<boolean>`.
- Called at `:157` (`if (locActive !== true) throw new DestinationInvalidError(...)`,
  code `DESTINATION_INVALID`, class `:49`). The command itself does **not** check
  `type == WAREHOUSE`; eligibility is entirely the seam's job.
- Structural validation of the reference shape is separate:
  `receivingValidation.ts:63-64` → `validateLocationRef` requires exactly
  `{ type, locationId }` with `type ∈ INVENTORY_LOCATION_TYPES`
  (`operationalMovementTypes.ts:71` = `WAREHOUSE/BIN/MOBILE/VENDOR/CUSTOMER/VIRTUAL`).
- Currently stubbed `resolveLocationActive: async () => true` in tests
  (`functions/test/receiveInventoryStockCommand.test.mjs:57`), with the `false →
  DestinationInvalidError` contract exercised (`:135`) and throw-propagation exercised
  (`:170`). **There is no production resolver** — this is the exact seam C2 backs (§6).
- The RECEIVED ledger event records the destination as
  `location: { type, locationId }` from the *validated* value
  (`receiveInventoryStockCommand.ts:184-193`).

### 1.5 C3 (`inventory_locations`) maturity — nonexistent

`inventory_locations` does not exist at any layer — zero code/Rules/type matches for
the collection; the 7 `InventoryLocation` hits are all the `{ type, locationId }`
**reference shape**, which carries no `status`/`lifecycle`
(`field-ops-app-vite/src/domain/inventoryLocation.js`). Rules declare only
`warehouses`, `stock_locations`, `mobile_locations` — no `inventory_locations` block.

### 1.6 STOP-check result

- **No open PR** touches these surfaces (0 open PRs at `f8aceea`).
- **No fully-governed active-warehouse authority exists** that Receiving could reuse
  today — `isWarehouseActive` is un-typed, un-governed, and *infers* active by absence
  (§1.2). **C2 is not redundant.** It is, however, a strong merged precedent that C2
  must reconcile with rather than duplicate.

---

## 2. Decision — ratify **C2**, with rationale

**Selected:** C2 — `warehouses` gains an explicit governed `status` field that the
Receiving resolver consults.

- **C1 (existence-is-eligible) — rejected.** Cannot distinguish a retired/ineligible
  warehouse from an active one; it is a governance *weakening* of the Phase-2 spec's
  "active governed Location" wording (`receiving-selectable-location-authority.md:123-128`).
- **C3 (`inventory_locations`) — deferred, not now.** Architecturally broader but
  requires an entire new authority — identity model, trusted writer, Rules, indexes,
  migration, and UI contract — before *any* Receiving can operate (§1.5). Nothing of it
  exists.
- **C2 — chosen.** Extends the already-persisted `warehouses` authority with one
  governed eligibility fact; shortest safe path to end-to-end Receiving; reuses the
  existing Admin-SDK-only write posture (§1.3) so the field is client-untamperable from
  day one.

C2 does **not** foreclose C3: a later migration can promote `warehouses.status` into a
dedicated `inventory_locations` lifecycle. C2 is the first slice, `WAREHOUSE`-only.

---

## 3. The governed field

### 3.1 Field & enum

- **Field name:** `status` (Owner-directed; also aligns with the existing
  `status==="INACTIVE"` half of `isWarehouseActive`, §1.2).
- **Governed enum:** `ACTIVE | INACTIVE`. Exactly these two literal string values. Any
  other value (including a boolean, empty string, or unknown token) is a
  **malformed stored record**, treated as **ineligible** (fail closed), never coerced.
- Modeled on the repo's `employmentStatus` governed-enum precedent
  (`functions/src/access/adminCredentialCommands.ts:200`, `:232` — fail closed on
  non-`ACTIVE`) and the `TRUCK_STATUSES` validated-on-read convention
  (`truckRegistryRepository.ts:107`, `MalformedStoredRecordError`).

### 3.2 Relationship to the legacy `active` boolean — convergence by removal (P1)

`status` is the **single governed authority**, and C2 **eliminates** the legacy
`active` boolean rather than letting it coexist. A dual-field world permits a direct
contradiction — e.g. `status == "ACTIVE"` with `active == false` — under which Receiving
(which reads `status`, §6) would accept a warehouse that the Truck Registry's
`isWarehouseActive` (`d.active !== false && ...`, §1.2) rejects. That is not a
single-authority model, and it would make `INACTIVE → ACTIVE` reinstatement inconsistent
across production commands. To close it:

- **The migration (§4) removes the `active` field in the same trusted write that sets
  `status`.** After migration every warehouse has `status ∈ {ACTIVE, INACTIVE}` and
  **no** `active` field.
- **The trusted writer (§5) writes only `status` and never `active`.** All seeds and
  fixtures stop writing `active` (including
  `functions/scripts/truckFunctionsVerificationMatrix.js:35-36`, which currently sets
  `active: true`).
- **The existing Truck reader stays compatible with no Truck-surface change:** with
  `active` absent, `d.active !== false` is `true`, so `isWarehouseActive` falls through
  to `d.status !== "INACTIVE"` — `status` becomes authoritative for both consumers, and
  an explicitly retired warehouse is now correctly rejected by the Truck Registry too.
- Because `active` is removed, `INACTIVE → ACTIVE` reinstatement (§5) is safe: no stale
  `active === false` remains to contradict the reinstated `status`.
- Dropping the now-vestigial `d.active !== false` clause from `isWarehouseActive` is
  **cosmetic** (no doc carries `active` post-migration) and remains a separate Truck
  gate — **not** required for correctness and **not** performed here.

> **O-1 resolved (recommended): YES — `status` subsumes `active`, and the migration
> removes `active`** (Codex round 1 concurs). Confirm at ratification.

### 3.3 No runtime inference (binding)

The governed value is **persisted, never inferred**. For the Receiving resolver (§6) a
document **without** a valid `status` is **ineligible** — Receiving does *not* fall
back to "absence ⇒ active" the way `isWarehouseActive` does. The migration (§4)
guarantees every real warehouse carries an explicit `status`, so legitimate warehouses
remain receivable while the fail-closed default protects against un-migrated or
corrupt data.

---

## 3A. Governed record schema & governance-initialization contract (P1)

C2 governs `warehouses` with a small metadata envelope so the trusted writer (§5) can
perform `version`-CAS transitions. **One schema is shared, verbatim, by the
validator/deserializer, the migration (§4), the verifier (§4/§9), the trusted writer
(§5), and the emulator tests (§9)** — no consumer invents, infers, or fabricates a field.

**Governed warehouse record (post-initialization):**

| Field | Required? | Meaning |
|---|---|---|
| `id`, `name`, `location` | required (existing) | unchanged base fields |
| `status` | **required** | `ACTIVE \| INACTIVE` (§3) |
| `version` | **required**, integer ≥ 1 | optimistic-concurrency counter for the §5 CAS |
| `updatedAt`, `updatedBy` | **required** | last governed write (server timestamp + governed actor) |
| `createdAt`, `createdBy` | **optional** | authentic creation metadata — present for writer-created warehouses; **absent for migrated legacy docs whose history is unknown; never fabricated** |
| `provenance` | **required** | discriminator: `NATIVE` (writer-created) or `MIGRATED` (governance applied by §4) |
| `governanceInitializedAt`, `governanceInitializedBy` | required **iff** `provenance == MIGRATED`; **absent** iff `NATIVE` | server migration timestamp + governed migration tool/actor identity |
| `active` | **must be absent** | legacy field removed (§3.2) |

Two initialization provenances, **both yielding a transition-ready `version: 1` record**,
distinguished by the required `provenance` discriminator:

- **`provenance: "NATIVE"` (trusted writer, §5):** `version: 1`, `status: "ACTIVE"`,
  `createdAt/By` = server actor metadata (**both required**), `updatedAt/By` = the same
  creation metadata, and **no** `governanceInitialized*` (creation *is* the governance
  origin).
- **`provenance: "MIGRATED"` (I-LA3 migration, §4):** `version: 1`, `status` = resolved
  per the §4 matrix, `governanceInitializedAt/By` = server migration timestamp + governed
  migration tool identity (**both required**), `updatedAt/By` = that initialization
  timestamp/actor, **`createdAt/By` either both absent or both present-and-valid** — a
  legacy value is preserved only if authentic, otherwise left absent, never fabricated;
  `active` deleted.

### 3A.1 Provenance invariants (P2-1)

The `provenance` discriminator plus complete-pair rules make origin state unambiguous and
are enforced **identically** by all five consumers. A governed record is valid **iff it
matches exactly one** model:

| `provenance` | `createdAt/By` | `governanceInitializedAt/By` |
|---|---|---|
| `NATIVE` | **both present & valid** | **both absent** |
| `MIGRATED` | **both absent**, or **both present & valid** | **both present & valid** |

**Invalid → fail closed (not governed):** `provenance` missing or not in
`{NATIVE, MIGRATED}`; only one half of any pair present; `governanceInitialized*` present
on a `NATIVE` record or absent on a `MIGRATED` one; a timestamp that is not a well-formed
server timestamp, or an actor identity that is blank/non-string; any combination not
matching exactly one row above. ("Valid" = well-formed server timestamp for a time field;
non-blank string for an actor field.)

**Validator/deserializer rule (shared):** a governed warehouse must have `status ∈
{ACTIVE, INACTIVE}`, integer `version ≥ 1`, `updatedAt/By`, a valid `provenance` with its
coherent pairs (§3A.1), and must **not** carry an `active` field. Any record failing any
clause is **not governed** → fail closed (the verifier rejects it; the resolver §6 treats
the warehouse as ineligible). This is why transitions (§5) operate only on
already-initialized records — the writer never fabricates history.

> **O-5 (Owner/Codex):** adopt this single-`version` envelope with the `provenance`
> discriminator (recommended), or Codex's alternative — a separate `statusVersion` field
> with legacy creation metadata kept optional. This spec pins the single-`version` +
> `provenance` model; whichever is ratified is shared verbatim by all five consumers.

---

## 4. Existing-document migration / governance-initialization (I-LA3)

The migration is the **governed initializer** for legacy warehouses: one trusted write
per document that **initializes the full governed schema (§3A)** — sets `provenance:
"MIGRATED"`, `status`, `version: 1`, `updatedAt/By`, and `governanceInitializedAt/By`,
preserves an authentic `createdAt/By` only if already present and valid (both halves or
neither; **never fabricated**), and **removes `active`**. It performs no runtime inference
and never silently overwrites an ambiguous record. Every pre-migration combination is
resolved by an **explicit matrix**:

| Pre-migration state | Action |
|---|---|
| missing `status` + `active === false` | initialize (§3A) with `status = "INACTIVE"` |
| missing `status` + (`active === true` or absent) | initialize with `status = "ACTIVE"` |
| `status == "ACTIVE"` + `active === false` (contradiction) | **resolution-manifest entry required** (below); none ⇒ HALT |
| `status == "INACTIVE"` + `active === true` (contradiction) | **resolution-manifest entry required**; none ⇒ HALT |
| malformed `status` (present, not in enum) | **resolution-manifest entry required**; none ⇒ HALT |
| already fully governed (§3A: valid status, version, updated, no `active`) | preserve (no-op) |
| valid `status` + `active` present, non-contradictory | initialize (delete `active`, add governance metadata) |

**Governed contradiction/malformed repair — executable, not deferred to a callable.**
The round-1 "reconcile via the trusted writer" path is removed: that writer is not
deployed and, by §3A, cannot consume an *uninitialized* legacy record. The migration
itself is the initializer, and ambiguous records are resolved by an Owner-authored
manifest:

- **Dry-run (default)** lists every planned action **and every contradiction/malformed
  record** — each with its id and a **sanitized, deterministic pre-state fingerprint** (a
  stable hash over the record's governed-relevant fields; **no unexpected raw field
  values**) — into the immutable evidence archive, stamped with the target **project id**
  and the **governed commit** under which the dry-run ran.
- The **Owner authors a resolution manifest** — for exactly the ambiguous set, an explicit
  `warehouseId → { intended status (ACTIVE|INACTIVE), pre-state fingerprint }` entry,
  carrying the same project-id + governed-commit stamp.
- `--execute` requires the **manifest content-hash** plus `--acknowledge-production-write`,
  and **re-reads each ambiguous warehouse and re-computes its fingerprint before writing.**
  Hashing the manifest only proves its bytes are unchanged; the live re-read proves the
  warehouse documents did not drift between dry-run and execution.
- **Fail closed (HALT) before any write** on: a changed/stale pre-state fingerprint; a
  missing entry; an extra or duplicate entry; a `warehouseId` outside the dry-run
  ambiguous set; an invalid target status; or a manifest/dry-run **project or
  governed-commit mismatch**. No document is written until the complete manifest **and
  every** live precondition validate. The migration never chooses a status itself and
  never depends on a future undeployed callable.
- On successful validation the migration initializes the full §3A schema with the
  manifest-resolved `status` and `provenance: "MIGRATED"`, removes `active`, and records
  per-document evidence containing **no unexpected raw fields** (only sanitized,
  governed-relevant values).

- **Tooling conventions to mirror** (`functions/scripts/`): dry-run default; `--execute`
  gated on `--acknowledge-production-write`; idempotent; stop-on-first-failure; emits an
  immutable evidence archive — same posture as the Part-Master migration set
  (`SYSTEM_AUTHORITIES.md:47`) and the operator-CLI shape of
  `truckRegistryVerifierCli.js:1-40` (lazy deps, `--config/--evidence-dir/--confirm-project`).
- **Verifier (initially inert, I-LA3).** A read-only verifier asserts every warehouse doc
  is a **fully governed record per §3A** — `status ∈ {ACTIVE, INACTIVE}`, integer `version
  ≥ 1`, `updatedAt/By` present, **no `active`** — and reports any ungoverned / malformed /
  legacy-`active` record. It is the deploy-gate proving the §3A/§3.3 invariant before the
  resolver is wired (I-LA5) and before deploy (E2).
- **Idempotency.** Re-running is a no-op for docs already fully governed per §3A (valid
  status, `version` present, `updatedAt/By` present, no `active`).

---

## 5. Trusted writer — creation default + lifecycle transitions

C2 introduces the first trusted warehouse writer (I-LA2), following the Truck Registry
house pattern (one `db.runTransaction`; reads-before-writes; `version` CAS;
`createdAt/By`, `updatedAt/By`; a staged sanitized Audit Event; class-per-reason
sanitized error taxonomy).

- **Creation default.** The writer creates a warehouse as a **full governed record per
  §3A**: `provenance: "NATIVE"`, `version: 1`, `status: "ACTIVE"` (explicit, never absent),
  `createdAt/By` + `updatedAt/By` = server actor metadata, **no `active` field** and **no
  `governanceInitialized*`**. Seed scripts set `status` explicitly and stop writing
  `active` (§3.2), so no code path produces a status-less, version-less, or
  `active`-bearing warehouse.
- **Allowed transitions (`version`-CAS).** `ACTIVE → INACTIVE` (retire) and `INACTIVE →
  ACTIVE` (reinstate), each requiring the caller's `expectedVersion` to equal the stored
  `version`; on success the writer sets the new `status`, **bumps `version` by exactly
  one**, and updates `updatedAt/By`. A stale `expectedVersion` fails (`VERSION_CONFLICT`).
  Setting `status` to its current value is an idempotent no-op success (no version bump).
  Any other target value is rejected (`INVALID_STATUS`). Retiring never deletes the
  document. Transitions operate **only on already-governed records (§3A)**; an ungoverned
  legacy record must first be initialized by the migration (§4) — the writer does not
  initialize history.
- **Authorization.** All warehouse writes remain **Admin-SDK-only / trusted** — Rules
  already deny every client write (§1.3), so no Rules change is needed for the write
  side. The transition command runs under a governed capability
  (e.g. `inventory.warehouse.status.set`, ungranted/inert at introduction, activated
  only in E1) and requires an admin/dispatcher-context actor; each transition writes an
  Audit Event. Exact capability id + AuditAction are pinned in I-LA2/E1, mirroring the
  Phase-C `inventory.stock.receive` registration pattern.

> **Open decision O-2 (Owner/Codex):** capability model for the transition command —
> a dedicated `inventory.warehouse.status.set` capability vs. reuse of an existing
> admin capability. Recommendation: dedicated, ungranted-at-introduction.

---

## 6. Receiving semantics + `resolveLocationActive` resolver contract (I-LA5)

The concrete production resolver injected into
`receiveInventoryStockCommand.ts:63` implements exactly:

```
resolveLocationActive(txn, { type, locationId }) -> Promise<boolean>

eligible (return true)  IFF ALL of:
  • type === "WAREHOUSE"                         // first slice: WAREHOUSE only
  • warehouses/{locationId} read through txn EXISTS
  • the COMPLETE document passes the shared §3A validator/deserializer
      (governed: status∈{ACTIVE,INACTIVE}, integer version≥1, updatedAt/By present,
       exactly one coherent provenance §3A.1, and NO `active` field)
  • the validated record's status === "ACTIVE"

ineligible (return false)  — fail closed — for ANY of:
  • type !== "WAREHOUSE"        (BIN/MOBILE/VENDOR/CUSTOMER/VIRTUAL: no authority yet)
  • document missing
  • §3A validation fails: missing status/version/updatedAt-By, malformed status,
    invalid/incomplete provenance (§3A.1), or a lingering `active` field
  • the validated status === "INACTIVE"
```

- **The resolver enforces the shared §3A schema, not just `status` (P1).** It does not
  cherry-pick fields: it runs the **same** validator/deserializer that the migration,
  verifier, writer, and tests use, so a partially-migrated record like `{ status:
  "ACTIVE" }` (no `version`/`updatedAt`/provenance) is **ineligible** even though its raw
  `status` reads `"ACTIVE"`. Governed-and-`ACTIVE` is the only accept condition.
- The resolver is **total**: every validation failure returns `false`, never throws — a
  `false` surfaces as the command's existing `DestinationInvalidError`
  (`DESTINATION_INVALID`). This matches the merged seam contract (`Promise<boolean>`,
  `:157`). The pre-deploy verifier (§4) still guarantees no un-governed doc survives to
  production, but the resolver **independently** fails closed rather than trusting that.
- The read is performed **through the transaction** (commit-time state), consistent with
  the seam's declared signature and with `isWarehouseActive`'s transactional read.
- **Divergence from `isWarehouseActive` is intentional and documented:** Receiving is
  *stricter* — it requires `status` **present and === "ACTIVE"** (no absence-⇒-active
  inference), whereas the Truck Registry reader is existence-primary (§1.2/§3.3).
- Backend re-validation is **mandatory on every receipt**; any client-side option
  filtering (§8) is advisory only.

---

## 7. Rules implications & read-authorization (I-LR / I-LA4)

- **Write side: no Rules change.** Client writes to `warehouses` are already
  `if false` (§1.3); the governed `status` is Admin-SDK-written and untamperable. Adding
  the field changes nothing about who may write.
- **Read side: additive, no change required for existing readers.** admin / dispatcher
  and an assigned WAREHOUSE_MANAGER already read the whole warehouse doc, including the
  new `status` field (§1.3). No Rules edit is needed for them to see it.
- **The genuine gap is option *visibility* for the receiver persona (I-LR).** A
  `PARTS_ASSOCIATE` receive-actor satisfies **neither** read arm and cannot read the
  warehouse pick-list today
  (`receiving-selectable-location-authority.md:235-238`). Solving eligibility (I-LA)
  does **not** solve visibility. I-LA4 chooses **one** of:
  1. **Trusted backend-served options (recommended)** — a callable returns the eligible
     `{ value, label, type }[]` (status===ACTIVE) so the frontend never reads
     `warehouses` directly and never becomes authoritative; PARTS_ASSOCIATE receivers
     work without a broad read grant.
  2. **Narrow governed client read arm** on `warehouses` tied to the receive
     capability (a `firestore.rules` change — **Tier 2**, per the DECISIONS Tier rules).
  3. **Restrict the first slice** to admin/dispatcher receivers (no Rules change; defers
     PARTS_ASSOCIATE).
- Any Rules change here is **Tier 2 / escalate** and rides its own regression suite +
  byte-identical mirror update, exactly as the merged Receiving Phase-D gate did.

> **Open decision O-3 (Owner/Codex):** the I-LR mechanism (1/2/3 above).
> Recommendation: (1) trusted backend-served options — keeps the frontend
> non-authoritative and avoids widening `warehouses` read.

---

## 7A. Receiving capability grant gate (separate Owner authorization) (P2-1)

`inventory.stock.receive` was deliberately registered in Phase C with **zero role
grants** (ungranted, no `active` flag). Exporting/wiring the Receiving callable in E1
does **not** grant it — a callable guarding an ungranted capability authorizes no
persona. A distinct, **Owner-authorized grant gate** must clear before the callable is
activated for any real user; the catalog entry and callable export never grant it
implicitly. The grant gate specifies:

- **Eligible personas** — recommended first slice: `admin` / `dispatcher`, plus active
  `PARTS_ASSOCIATE` **only if** I-LR (§7) supports that persona (O-4).
- **Scope model** — global vs. per-warehouse (e.g. tied to `assignedWarehouseIds`).
- **Operational-role / employment conditions** — active `employmentStatus` and required
  `operationalRoles`, mirroring `isActiveOperationalRole`.
- **Explicit exclusions** — personas that must NOT receive (e.g. technician,
  authenticated-no-role).
- **Resolver + emulator tests** — a granted persona invokes; an ungranted/excluded
  persona is denied; the grant honors its scope model.
- **accessVersion invalidation** — granting/revoking bumps `accessVersion` so in-flight
  sessions re-resolve (a receive begun under a now-stale capability is not submitted).
- **Rollback / revocation** — revoking the grant immediately fails closed; procedure
  documented.

This is its own DRAFT → Codex → Owner-authorized step (the **GRANT** phase, §10),
sequenced **before** E2 callable activation. It is separate from O-2's
`inventory.warehouse.status.set` (the writer/transition capability, §5); the two grant
different commands.

---

## 8. Read-option contract for the Customer frontend (LF1) — reconciliation

C2 pins the **eligibility source** the CUSTOMER LF1 adapter consumes
(`receiving-selectable-location-authority.md:169-173`, `:250-258`):

- **Source / identity:** `warehouses`, option identity `warehouses/{id}`.
- **Eligibility predicate:** governed `warehouses.status === "ACTIVE"` (this spec's §3).
- **Option shape:** `{ value: id, label, type: "WAREHOUSE" }` where
  **`label = (trimmed name is non-blank) ? name : id`** — an empty or whitespace-only
  warehouse name falls back to the `id`, never rendered blank (this corrects the naive
  `name ?? id`, which preserves an empty/whitespace name). Sorted by `label`
  (localeCompare, id tiebreak), malformed / blank-`id` records dropped, deduped by
  value. The **blank-name fallback is a required LF1 unit-test case** (§ Customer tests).
- **Frontend is never authoritative:** the client may *filter to* status===ACTIVE for
  display, but the trusted command's `resolveLocationActive` (§6) is the single source
  of truth; a stale/inactive selection yields a sanitized rejection + refresh
  (`receiving-selectable-location-authority.md:226-231`).
- **Delivery mechanism** (client reads `warehouses` vs. backend-served options) is the
  I-LR decision (§7), not fixed here.

---

## 9. Migration · emulator · rollback · production-verification plan

- **E2 deploy ordering (pinned, P2-2).** The merged Phase-D `receiving_orders` deny-all
  Rules artifact was reviewed but **not deployed**; it must be deployed and verified
  **unconditionally** before the Receiving callable is activated. Any I-LA4 Rules delta
  is *additional*, never the trigger for deploying Phase D. Exact order:
    1. deploy the exact reviewed Rules artifact (Phase-D `receiving_orders` deny-all +
       any I-LA4 read-arm delta);
    2. verify `receiving_orders` client denial live (persona matrix);
    3. run the warehouse `status` migration (§4: dry-run → review evidence → `--execute`
       under production-write acknowledgement);
    4. run the warehouse verifier (valid `status`, no `active`);
    5. deploy the targeted Receiving / option callable(s);
    6. run backend verification (below);
    7. only then permit Customer readiness activation (Phase F).
  Operator-run in Cloud Shell; never by this agent.
- **Emulator tests (per phase):**
  - I-LA1 offline (validator, §3A/§3A.1): accept a valid `NATIVE` record and a valid
    `MIGRATED` record (both provenance models); reject missing status/version/updatedAt,
    unknown/boolean status, a lingering `active` field, a missing/invalid `provenance`, a
    half-populated `createdAt/By` or `governanceInitialized*` pair, `governanceInitialized*`
    on a `NATIVE` record (or absent on a `MIGRATED` one), and a malformed timestamp / blank
    actor.
  - I-LA2 emulator (writer, §3A/§5): create yields a full §3A record at `version: 1` with
    created/updated metadata and no `active`; a transition advances `version` **exactly
    once** and updates updatedAt/By; idempotent same-status no-op (no bump);
    INVALID_STATUS rejection; **stale `expectedVersion` fails (VERSION_CONFLICT)**; the
    writer **refuses an ungoverned/legacy record** (must be migrated first); audit staged.
  - I-LA3 (migration + verifier, §3A/§4) — mandatory governance-initialization cases:
    (a) a migrated legacy doc becomes **transition-ready at `version: 1`**;
    (b) **no historical `createdAt/createdBy` is fabricated** (absent stays absent);
    (c) a transition from the migrated `version: 1` record **advances exactly once**;
    (d) a stale `expectedVersion` against a migrated record fails;
    (e) a contradictory/malformed record **requires an explicit resolution-manifest
        entry**, and a missing/mismatched entry (or wrong manifest hash) **fails closed**;
    (f) the **verifier rejects a doc with a valid `status` but missing governance
        `version`/`updatedAt` metadata**, and rejects any doc still carrying `active`;
    (g) **re-running the migration is idempotent** (already-governed docs untouched).
  - I-LA4: Rules/read-visibility tests for the chosen I-LR mechanism (regression suite +
    byte-identical mirror) — only if (2) is chosen.
  - I-LA5 emulator: resolver returns true only for an existing WAREHOUSE whose **complete
    document passes the §3A validator** AND status===ACTIVE; returns **false** for a
    non-WAREHOUSE type, a missing doc, INACTIVE, malformed status, and — critically — an
    **ACTIVE record that fails §3A** (missing `version`, missing `updatedAt/By`, invalid/
    incomplete provenance §3A.1, or a lingering `active` field), e.g. `{ status: "ACTIVE" }`;
    every false case drives `DESTINATION_INVALID`. The Receiving command accepts a receipt
    only to a fully-governed ACTIVE warehouse.
- **Rollback per phase:** every I-LA phase is repo-only and independently revertable.
  The field is additive and inert until the resolver is wired (I-LA5); reverting I-LA5
  returns Receiving to the merged seam's stubbed/HALT posture (fail closed), never a bad
  write. E2 (deploy/migration) rollback = redeploy prior Rules/Functions; the persisted
  `status` field is harmless if left in place (only the resolver consults it).
- **Production verification (G):** post-deploy, the verifier confirms the backfill
  invariant in production; a controlled receipt to an ACTIVE warehouse succeeds and a
  receipt to a deliberately-INACTIVE fixture warehouse is rejected — evidence archived.

---

## 10. Phased implementation PR sequence (each its own DRAFT → Codex → Owner-merge)

| Phase | Scope | Rules? | Deploy? |
|---|---|---|---|
| **I-LA1** | `status` on `Warehouse` type + `RawWarehouse`; enum/validation; offline tests | no | no |
| **I-LA2** | trusted warehouse writer: creation default `ACTIVE` + `ACTIVE↔INACTIVE` transitions + version/audit; emulator tests | no | no |
| **I-LA3** | migration/backfill tooling + read-only verifier, **initially inert** | no | no |
| **I-LA4** | I-LR read-authorization decision (§7) + tests | maybe (Tier 2 if arm) | no |
| **I-LA5** | implement + inject production `resolveLocationActive` into the Receiving command; emulator tests | no | no |
| **E1** | Receiving callable adapter/export + real capability + AuditAction wiring (capability still **ungranted**) | no | no |
| **GRANT** | Receiving capability grant gate (§7A) — grant `inventory.stock.receive` to the pinned personas + tests | maybe (Tier 2 if arm) | no |
| **E2** | **unconditionally deploy the reviewed Phase-D Rules artifact (+ any I-LA4 delta) & verify `receiving_orders` denial**, then migration + verifier, then targeted callable, then backend-verify — ordered per §9 | Rules | **yes (Owner/operator)** |
| **F** | CUSTOMER frontend cutover (LF1 adapter/hook → LF2 UI → F3 activation) | no | no |
| **G** | production verification (§9) | — | verify |

I-LA1–I-LA5, E1, and the **GRANT** gate are repository-only (GRANT still requires its
own Owner grant authorization). E2/G require separate Owner authorization and
operator-run production actions; this agent orchestrates/verifies but never deploys.

---

## 11. Governance updates required on ratification (NOT done in this DRAFT)

These are recorded here for the Owner to enact on ratification / in the implementing
PRs — this docs-only spec does not edit them:

- **`docs/DECISIONS.md`** — append one Tier-1/2 entry ratifying C2 as the Receiving
  location-eligibility authority. **Proposed text:**
  > *I-LA (Receiving location authority): ratified **C2** — `warehouses.status`
  > (`ACTIVE|INACTIVE`) is the governed first-slice Receiving location-eligibility
  > authority. `status` is the single governed field (legacy `active` boolean
  > deprecated; migration derives `status` from it). Receiving fails closed on
  > missing/malformed/unknown/`INACTIVE`; no runtime inference. Alternatives rejected:
  > C1 (existence-is-eligible — cannot distinguish retired), C3 (`inventory_locations`
  > — new authority, deferred). Read-authorization (I-LR) decided separately.*
- **`docs/architecture/SYSTEM_AUTHORITIES.md`** — add a "Warehouse location eligibility
  / `status`" row naming the new trusted writer + the Receiving resolver as owners, when
  I-LA2/I-LA5 land (the code, per the doc's "code wins" rule, `SYSTEM_AUTHORITIES.md:1-5`).
- **ADR (optional):** an `ADR-011` for the location-eligibility authority decision, or a
  one-line DECISIONS pointer if an ADR is judged unnecessary.
- **`receiving-selectable-location-authority.md`** (CUSTOMER-owned): on ratification its
  "Option D — HALT" is superseded **for the C2 path** and its §7 `I-LA` row points here.
  Flipping that status is a CUSTOMER/Owner action; this INVENTORY doc does not edit it.

---

## 12. Open decisions (Codex round 1 concurred; pending Owner ratification)

- **O-1 — `status` subsumes `active`; the migration REMOVES `active` (§3.2/§4).**
  Recommended: **YES.**
- **O-2 — dedicated `inventory.warehouse.status.set` capability (§5)** for the
  writer/transition command, initially inactive/ungranted, separately activated.
  Recommended: **YES.**
- **O-3 — I-LR read-visibility (§7): trusted backend-served eligible-location options.**
- **O-4 — receiver personas (§7A): include active `PARTS_ASSOCIATE` only after BOTH
  I-LR (§7) and the `inventory.stock.receive` grant gate (§7A) are approved;** the first
  slice is otherwise admin/dispatcher.
- **O-5 — governance-metadata envelope (§3A): single `version` field, `createdAt/By`
  optional (never fabricated for legacy), migration adds `governanceInitialized*`.**
  Recommended: **single-`version` model** (vs. a separate `statusVersion`); shared
  verbatim by validator/migration/verifier/writer/tests.

---

## 13. Approval

**Gate:** I-LA — Receiving Location-Eligibility Authority (C2 `warehouses.status`).
**Status: DRAFT — docs-only.** Opened as a DRAFT PR for Codex review; authorizes no
implementation, Rules, index, Function, callable, capability, migration, deployment, or
production-data action. Ratifies **C2** and specifies the governed field, the shared
governance-initialization schema (§3A: `status`/`version`/`updatedAt/By`, optional
never-fabricated `createdAt/By`, `governanceInitialized*`), the migration/manifest-repair
policy (with live pre-state-fingerprint binding), a `provenance`-discriminated
governed-record model (§3A.1), a Receiving resolver that enforces the **complete** shared
§3A schema (not just `status`), trusted writer, Rules/read-authorization
implications, Customer read-option reconciliation, and the phased PR sequence. Reconciles
with the merged `isWarehouseActive` convention (§1.2/§3.2) by **removing** the legacy
`active` field in the migration — leaving `status` the single authority while keeping the
Truck reader compatible without editing the Truck surface. Applies Codex round-1
corrections: convergence-by-removal matrix (P1), a separate Receiving capability grant
gate (§7A / P2-1), unconditional Phase-D Rules deploy ordering (§9 / §10 E2 / P2-2), and
blank-name option-label fallback (§8 / P2-3). No `functions/**`, `firestore.rules`, index, runtime-frontend, capability,
callable, deployment, Hosting, production, Truck, `DECISIONS.md`, or `SYSTEM_AUTHORITIES.md`
change. **STOP for Codex review and separate Owner ratification.**
