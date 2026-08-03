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

### 3.2 Relationship to the legacy `active` boolean (precedence — decision required)

**Recommendation:** `status` is the **single governed authority**. The legacy `active`
boolean is **not** governed by C2 and is treated as **deprecated**.

- The C2 trusted writer (§5) writes **only** `status`; it never writes `active`.
- To keep `isWarehouseActive` coherent, the migration (§4) **derives** each doc's
  `status` from its current state so both readers agree afterward:
  `active === false ⇒ status = "INACTIVE"`, otherwise `status = "ACTIVE"`.
- After backfill, `isWarehouseActive`'s formula `d.active !== false && d.status !==
  "INACTIVE"` remains correct for every doc, and governing `status` actually *improves*
  it: an explicitly retired warehouse (`status="INACTIVE"`) is now rejected by the
  Truck Registry too.
- **Follow-up (out of this gate, noted for the roadmap):** converge
  `isWarehouseActive` onto reading `status` only and remove the `active` boolean from
  fixtures — a separate Truck-surface change requiring its own gate; **not** performed
  here (Truck exclusion).

> **Open decision O-1 (Owner/Codex):** confirm `status` subsumes `active` as above, or
> direct that both remain co-governed. The rest of this spec assumes `status`-single.

### 3.3 No runtime inference (binding)

The governed value is **persisted, never inferred**. For the Receiving resolver (§6) a
document **without** a valid `status` is **ineligible** — Receiving does *not* fall
back to "absence ⇒ active" the way `isWarehouseActive` does. The migration (§4)
guarantees every real warehouse carries an explicit `status`, so legitimate warehouses
remain receivable while the fail-closed default protects against un-migrated or
corrupt data.

---

## 4. Existing-document migration / default policy

- **Backfill, do not infer.** A governed migration script sets an explicit `status` on
  every existing `warehouses/{id}`:
  - `active === false` (legacy inactive) ⇒ `status = "INACTIVE"`;
  - otherwise ⇒ `status = "ACTIVE"`.
  It never leaves a warehouse without `status` and never guesses at runtime.
- **Tooling conventions to mirror** (`functions/scripts/`): dry-run default; `--execute`
  gated on `--acknowledge-production-write`; idempotent; stop-on-first-failure; emits an
  immutable evidence archive — same posture as the Part-Master migration set
  (`SYSTEM_AUTHORITIES.md:47`) and the operator-CLI shape of
  `truckRegistryVerifierCli.js:1-40` (lazy deps, `--config/--evidence-dir/--confirm-project`).
- **Verifier (initially inert, I-LA3).** A read-only verifier asserts every warehouse
  doc has `status ∈ {ACTIVE, INACTIVE}` and reports any missing/invalid record. It is
  the deploy-gate that proves §3.3's persisted-value invariant holds before the
  resolver is wired (I-LA5) and before deploy (E2).
- **Idempotency.** Re-running the backfill is a no-op for docs already carrying a valid
  `status`.

---

## 5. Trusted writer — creation default + lifecycle transitions

C2 introduces the first trusted warehouse writer (I-LA2), following the Truck Registry
house pattern (one `db.runTransaction`; reads-before-writes; `version` CAS;
`createdAt/By`, `updatedAt/By`; a staged sanitized Audit Event; class-per-reason
sanitized error taxonomy).

- **Creation default.** When the writer creates a warehouse it stamps `status =
  "ACTIVE"` **explicitly** (never absent). Seed scripts are updated to set `status`
  explicitly as well, so no code path produces a status-less warehouse.
- **Allowed transitions.** `ACTIVE → INACTIVE` (retire) and `INACTIVE → ACTIVE`
  (reinstate). Setting `status` to its current value is an idempotent no-op success. Any
  other target value is rejected (`INVALID_STATUS`). Retiring a warehouse never deletes
  the document (Rules already deny client delete; the writer does not hard-delete).
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
  • warehouses/{locationId} exists (read through txn)
  • the doc's status is the exact string "ACTIVE"

ineligible (return false)  — fail closed — for ANY of:
  • type !== "WAREHOUSE"        (BIN/MOBILE/VENDOR/CUSTOMER/VIRTUAL: no authority yet)
  • document missing
  • status field absent
  • status not a string / not in { ACTIVE, INACTIVE } (malformed → ineligible)
  • status === "INACTIVE"
```

- The resolver is **total**: data conditions (missing/malformed/INACTIVE) return
  `false`, never throw — a `false` surfaces as the command's existing
  `DestinationInvalidError` (`DESTINATION_INVALID`). This matches the merged seam
  contract (`Promise<boolean>`, `:157`) and keeps corrupt-data handling a
  migration/verifier concern (§4), caught before deploy.
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

## 8. Read-option contract for the Customer frontend (LF1) — reconciliation

C2 pins the **eligibility source** the CUSTOMER LF1 adapter consumes
(`receiving-selectable-location-authority.md:169-173`, `:250-258`):

- **Source / identity:** `warehouses`, option identity `warehouses/{id}`.
- **Eligibility predicate:** governed `warehouses.status === "ACTIVE"` (this spec's §3).
- **Option shape:** `{ value: id, label: name ?? id, type: "WAREHOUSE" }`, sorted by
  `label` (localeCompare, id tiebreak), malformed/blank-id records dropped, deduped by
  value — the existing `fetchWarehouseOptions` pattern.
- **Frontend is never authoritative:** the client may *filter to* status===ACTIVE for
  display, but the trusted command's `resolveLocationActive` (§6) is the single source
  of truth; a stale/inactive selection yields a sanitized rejection + refresh
  (`receiving-selectable-location-authority.md:226-231`).
- **Delivery mechanism** (client reads `warehouses` vs. backend-served options) is the
  I-LR decision (§7), not fixed here.

---

## 9. Migration · emulator · rollback · production-verification plan

- **Migration (E2):** run the §4 backfill in dry-run, review the evidence archive, then
  `--execute` under production-write acknowledgement; run the verifier to prove every
  warehouse carries a valid `status`. Operator-run in Cloud Shell; never by this agent.
- **Emulator tests (per phase):**
  - I-LA1 offline: enum/validation + type parse (valid ACTIVE/INACTIVE; reject
    missing/unknown/boolean).
  - I-LA2 emulator: create stamps ACTIVE; ACTIVE↔INACTIVE transitions; idempotent
    no-op; INVALID_STATUS rejection; version CAS conflict; audit event staged.
  - I-LA3: verifier flags a status-less / malformed doc; passes a fully-backfilled set.
  - I-LA4: Rules/read-visibility tests for the chosen I-LR mechanism (regression suite +
    byte-identical mirror) — only if (2) is chosen.
  - I-LA5 emulator: resolver returns true only for existing WAREHOUSE with
    status===ACTIVE; false for missing/absent/INACTIVE/malformed/non-WAREHOUSE; the
    Receiving command rejects a receipt to an INACTIVE warehouse with
    `DESTINATION_INVALID`; accepts to an ACTIVE one.
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
| **E1** | Receiving callable adapter/export + real capability + AuditAction wiring | no | no |
| **E2** | deploy Rules (if I-LA4 changed them), run migration + verifier, targeted Function deploy | — | **yes (Owner/operator)** |
| **F** | CUSTOMER frontend cutover (LF1 adapter/hook → LF2 UI → F3 activation) | no | no |
| **G** | production verification (§9) | — | verify |

I-LA1–I-LA5 and E1 are repository-only. E2/G require separate Owner authorization and
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

## 12. Open decisions requiring Owner / Codex

- **O-1** — `status` subsumes the legacy `active` boolean (§3.2). *Recommend: yes.*
- **O-2** — capability model for the transition command (§5). *Recommend: dedicated
  `inventory.warehouse.status.set`, ungranted at introduction.*
- **O-3** — I-LR read-visibility mechanism (§7). *Recommend: trusted backend-served
  options (frontend non-authoritative; PARTS_ASSOCIATE works without a broad read grant).*
- **O-4** — first-slice receiver personas: admin/dispatcher only, or include
  PARTS_ASSOCIATE via O-3? *Recommend: decide with O-3.*

---

## 13. Approval

**Gate:** I-LA — Receiving Location-Eligibility Authority (C2 `warehouses.status`).
**Status: DRAFT — docs-only.** Opened as a DRAFT PR for Codex review; authorizes no
implementation, Rules, index, Function, callable, capability, migration, deployment, or
production-data action. Ratifies **C2** and specifies the governed field, migration/
default policy, trusted writer, Receiving resolver contract, Rules/read-authorization
implications, Customer read-option reconciliation, and the phased PR sequence. Reconciles
with the merged `isWarehouseActive` convention (§1.2/§3.2) without editing the Truck
surface. No `functions/**`, `firestore.rules`, index, runtime-frontend, capability,
callable, deployment, Hosting, production, Truck, `DECISIONS.md`, or `SYSTEM_AUTHORITIES.md`
change. **STOP for Codex review and separate Owner ratification.**
