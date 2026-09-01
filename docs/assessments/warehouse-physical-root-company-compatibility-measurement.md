# Workstream 2A.1 — physical-root company compatibility: the measurement

**Status:** MEASUREMENT ONLY. No code changed. No shape widened. This is the ten-item return the
Owner required before any implementation (DECISIONS #148).

**Measured at:** `origin/main` @ `878e786a` (2026-08-31), by reading the source and running the
validator against real fixtures — not by reasoning about it.

**The contradiction being measured.** The ownership model says a Warehouse IS a physical company root
and that `warehouse.operatingCompanyId` is a persisted governed fact. The §3A warehouse shape contract
predates that requirement and carries a **closed allow-list of twelve keys**, so a warehouse holding
the field is not a valid governed warehouse.

---

## 1 — The canonical §3A validator

`functions/src/warehouseGovernance/governedWarehouseValidation.ts` (185 lines). One exported function,
`validateGovernedWarehouse(input, expectedWarehouseId)`, plus the bounded reason vocabulary
`GOVERNED_WAREHOUSE_REASONS`. Pure, non-throwing, never mutates, returns a **sanitized reconstruction**
rather than the input.

The gate that matters is third in its order of checks:

```
ALLOWED_KEYS = { id, name, location, status, version, updatedAt, updatedBy,
                 provenance, createdAt, createdBy,
                 governanceInitializedAt, governanceInitializedBy }

for (const key of Object.keys(input))
  if (!ALLOWED_KEYS.has(key)) return fail(UNKNOWN_FIELD);
```

Twelve keys, closed. `active` is rejected earlier and separately. Measured directly:

| Document | Verdict |
|---|---|
| complete governed record | `valid: true` |
| the same record `+ operatingCompanyId: "taylor"` | `valid: false`, reason `unknown_field` |

The type behind it is `GovernedWarehouse` in `functions/src/types/warehouse.ts` — the same twelve
fields, four optional.

## 2 — Every caller of the validator

Six real consumers, all server-side. Every one of them treats an invalid record as **fail-closed**.

| Caller | What it does with the verdict | Blast radius if a warehouse becomes invalid |
|---|---|---|
| `inventoryReceiving/receivingLocationResolver.ts` | `false` → `DESTINATION_INVALID` | **Receiving refuses the warehouse as a destination** |
| `inventoryTransfer/transferLocationResolver.ts` | `false` → location not active | **Transfers refuse it as an endpoint** |
| `warehouseGovernance/receivingLocationOptionsService.ts` | filters the option out | **The Receiving location picker stops offering it** |
| `warehouseGovernance/warehouseStatusWriter.ts` | `MALFORMED_RECORD`; also self-checks before writing | **ACTIVE↔INACTIVE transitions refuse it** |
| `warehouseGovernance/warehouseGovernanceMigration.ts` | drives `classifyWarehouse` | **Re-classified as legacy → re-migrated, see §9** |
| `warehouseGovernance/warehouseGovernanceVerifier.ts` | counts it non-governed | **A governance verification run reports FAIL** |
| `reorderRequest/reorderCallables.ts` (2B) | excluded from the picker | The reorder path, which is how this was found |

**This is the headline finding.** The blocker is not Reorder's. Persisting `operatingCompanyId` today
breaks **Receiving, Transfers, the status writer, and the governance verifier** as well. Reorder is
simply the first consumer that asked for both facts at once.

`inventoryLocation/locationDisplayReadService.ts` reads `warehouses` but does **not** validate — it
reads `name` directly, so it is unaffected either way.

## 3 — Tests asserting the current shape

| Suite | Cases | Relationship to the allow-list |
|---|---|---|
| `governedWarehouseValidation.test.mjs` | 30 | Owns it. One case is exactly `unknown field -> unknown_field`, plus an own-key-`undefined` case that also lands on the unknown-field path. |
| `warehouseGovernanceMigration.test.mjs` | 28 | Depends on it through `classifyWarehouse` — governed vs derive vs ambiguous. |
| `warehouseStatusWriter.test.mjs` | 20 | Depends on it for `MALFORMED_RECORD` and the build-time self-check. |
| `receivingLocationOptionsService.test.mjs` | 15 | Depends on it for option eligibility. |
| `warehouseGovernanceVerifier.test.mjs` | 7 | Depends on it for the pass/fail verdict. |
| `reorderWarehouseEligibility.test.mjs` (2B) | 1 | The BLOCKER test, written to fail when this is resolved. |

Only the first suite asserts the allow-list *as such*. The other five would change behaviour, not
assertions, if the list widened — which is precisely why they are the ones to re-run.

## 4 — Every writer of a `warehouses/{id}` document

**Client writers: NONE.** `firestore.rules` is unconditional:

```
match /warehouses/{warehouseId} {
  allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId);
  allow create, update, delete: if false;
}
```

Server writers:

| Writer | Status | Write shape |
|---|---|---|
| `warehouseStatusWriter.createWarehouse` | **INERT** — unexported, no callable, no caller | Accepts only `{warehouseId, name, location}`; builds the record itself |
| `warehouseStatusWriter.setWarehouseStatus` | **INERT** — same | `txn.update` of exactly `status, version, updatedAt, updatedBy` |
| `warehouseGovernanceMigration.executeMigration` | Operator-run, gated | **Replaces** the document with `buildMigratedRecord`'s output |
| `scripts/certificationWorld/emulatorBootstrap.mjs` | Emulator fixture | Writes the full ten-field NATIVE shape, `{merge: true}` |
| `scripts/seedTruckFleetFixtures.mjs` | Seed script | Writes nine fields — **and omits `id`**, so what it writes is not §3A-valid today |
| `scripts/seedOperationsDemoData.js` | Demo seed | Legacy shape |

## 5 — Could any of them author `operatingCompanyId`?

**No — and the hard-stop condition is satisfied for the reason that matters most: there is no client
write path at all.** Widening the allow-list cannot hand a client writer anything, because
`allow create, update, delete: if false` denies every client write regardless of shape.

Server-side, each writer is closed by construction:

- `createWarehouse` rejects unknown request keys against `CREATE_ALLOWED_KEYS = {warehouseId, name, location}` and constructs the stored record itself.
- `setWarehouseStatus` rejects unknown keys and updates four named fields.
- `buildMigratedRecord` assembles a fixed field list.

So none of the three could author the field even if the shape permitted it. **A governed root-authority
write path does not exist yet and would have to be built** — which matches the Owner's expected
direction ("authored only through an explicitly governed root-authority path").

## 6 — Must it be immutable after root creation?

**Not strictly immutable — but not ordinarily mutable either.** `ownershipMatrix.ts` records the
warehouse root as `transfer: "HANDOFF"`, deliberately distinct from the `IMMUTABLE` used for
location-derived families such as `stock_locations`. A warehouse's operating company can therefore
change, but only through the explicit auditable handoff authority (`ownershipHandoffCommand.ts`),
never as a side effect of an ordinary warehouse transition.

The practical requirement: `setWarehouseStatus` must **preserve** the field across a status
transition, and must never be able to set it. Its current `txn.update` of four named fields already
preserves it — but that is currently an accident of the field not existing, and should become an
asserted property.

## 7 — Do warehouse transitions use `affectedKeys()`?

**No.** There is no `affectedKeys()` anywhere in the `warehouses` Rules block, because there are no
client writes to constrain — the whole block is `if false`. The immutability mechanism 2B relies on
for `reorder_requests` has no counterpart here and is not needed: the equivalent guard is the trusted
writer's own key allow-lists (§5).

## 8 — Receiving's behaviour with the extra field

Today: a company-bearing warehouse is **rejected as a receiving destination** (`DESTINATION_INVALID`)
and **disappears from the receiving location picker**. Both consequences follow from §2 and neither is
Reorder-specific.

After a widening, Receiving's behaviour should be *unchanged*, because it consults only
`parsed.value.status === "ACTIVE"` and the validator's sanitized reconstruction would simply carry one
more field. That is the claim to prove with the existing 15-case options suite plus the receiving
resolver's own tests — not to assume.

## 9 — Migration behaviour for warehouses without the field

Two distinct behaviours, and the second is a hazard.

- **Absent field, today:** a warehouse with no `operatingCompanyId` is fully governed and classifies
  as `GOVERNED` — a byte-stable no-op. Optional-on-historical-rows costs nothing.
- **Present field, today:** `classifyWarehouse` calls the validator first, gets `false`, falls through
  to the legacy branch and classifies the record as **`DERIVE`** — a record to be migrated.
  `executeMigration` then **replaces** the document with `buildMigratedRecord`'s fixed field list,
  which does not include `operatingCompanyId`. **A migration run would silently erase the company
  fact**, and its `STALE_PRESTATE` fingerprint check would not object, because the erasure is the
  planned action rather than drift.

That makes ordering non-negotiable: **the shape must be widened before any warehouse company fact is
written.** Writing first and reconciling later has a data-loss path.

## 10 — The exact delta

| Surface | Change | Notes |
|---|---|---|
| `types/warehouse.ts` | `operatingCompanyId?: string` on `GovernedWarehouse` | Optional — historical rows stay valid |
| `governedWarehouseValidation.ts` | add the key to `ALLOWED_KEYS`; validate it when present; carry it into the sanitized reconstruction | Value validation should go through the governed company authority (`resolveOperatingCompany`), not a bare string check |
| `warehouseGovernanceMigration.ts` | `buildMigratedRecord` must **preserve** an existing `operatingCompanyId` | Closes the §9 erasure path |
| `warehouseStatusWriter.ts` | no functional change; add an assertion that a status transition preserves the field and cannot set it | Its allow-lists already exclude it |
| `firestore.rules` | **NONE** | No client write exists to constrain, and no read change is needed |
| `verifyTruckRegistryDeployment.js` | **NONE** unless Rules change | The governed hash only moves if the ruleset does |
| Fixtures | `certificationWorld` / seed scripts unchanged unless a fixture warehouse is given a company | Separately authorized data work |
| Tests | 1 new allow-list case + a preservation case in migration + a preservation case in the status writer; re-run the five dependent suites; the 2B BLOCKER test **should then fail** and be replaced with real coverage | |

**Not in this delta, and deliberately:** the governed root-authority write path that would actually
author the field. Widening the shape makes the fact *storable*; it does not make it *writable*, and
conflating the two is how a shape change becomes an unintended grant.

---

## Two findings outside the ten items

**A. The blocker is wider than Reorder.** Persisting the company today breaks Receiving, Transfers,
the status writer and the governance verifier. Anyone reading DECISIONS #147 could reasonably think
this is a Reorder problem. It is not.

**B. `mobile_locations` does NOT have this problem.** The other ownership physical root is validated
by `mobileLocationFromFirestore`, which checks *required* fields rather than enforcing a closed
allow-list, so an added `operatingCompanyId` passes untouched. The asymmetry is worth recording: only
`warehouses` needs this amendment, and a future reader should not assume both roots were blocked.

**Stop point.** Nothing above has been implemented. The widening, its tests, and any root-authority
write path are separately authorized work.
