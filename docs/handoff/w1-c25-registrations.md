# W1-C25 — Cycle Count authority: registrations

Lane C25 (Cycle Count — sheets, lines, counting, reconciliation, and the `eos_ops`
cycle-count repository). Branch `impl/w1-cyclecount-authority`.

## Registrations made by this change

**None.** This change removes divergences; it adds no surface that needs registering.

| Registry | Entry | Why none |
| --- | --- | --- |
| Migration (`functions/migrations/`) | none | Every guard added here is a transition rule between rows over time (a RECONCILED line must not return to COUNTED). A CHECK constraint sees one row version and cannot express it; a trigger would put a second copy of the lifecycle in SQL. The reserved id `1760054400000` was therefore **not used** and remains free. |
| Capability (`permissionCatalog.ts`) | none | `inventory.cycleCount.{create,submit,reconcile,cancel}` already exist (`functions/src/cycleCount/cycleCountSheetCommand.ts:67-72`), registered-but-ungranted. No new verb was introduced. |
| Firestore collection | none | No new business collection; `cycle_counts` is unchanged. |
| Callable / HTTP operation | none | `functions/src/eosOps/cycleCountRepository.ts` remains unwired to any HTTP operation (`OPERATIONS_READ_OPERATIONS` is still exactly `["resolveMyCapabilities"]`). |
| Test script (`functions/package.json`) | none | New proofs were added to `test/eosOpsPostgres.test.mjs`, already registered in `test:adminPolicyPostgres` and run by `.github/workflows/eos-admin-policy-tests.yml:188`. No new schema-resetting file was created, so `adminPolicyPostgres.test.mjs`'s "every suite that resets the schema is covered by that one command" still holds. |

## ADMIN→OBJECTS (PR #1866, C2's framework)

No Cycle Count administration profile is added, and none can be added yet:
`field-ops-app-vite/src/metadata/entityRegistry.js:56-86` registers 29 entities and
**none of them is a Cycle Count** — a profile's `entityId` is resolved against that
registry (`validateProfileAgainstEntity`), so a profile without an entity is invalid by
construction. `entityRegistry.js` is a shared do-not-edit file for this lane.

When a `cycleCountEntity` is registered and #1866 has merged, the registry line is the
one-import-plus-one-array-entry form C2 established in
`field-ops-app-vite/src/metadata/administration/administrationProfileRegistry.js`:

```js
import { cycleCountAdministrationProfile } from "./profiles/cycleCount.js";

export const ADMINISTRATION_PROFILES = Object.freeze([
  cycleCountAdministrationProfile,
  partAdministrationProfile,
]);
```

Nothing was cherry-picked from `origin/impl/w1-part-admin-objects`; it was read for the
pattern only. Until then the gap is countable rather than invisible — Cycle Count appears
in `unprofiledEntities()` only once its entity exists.

## Facts this lane leaves for other lanes

- **C20 / serialized assets.** `cycleCountExpectedQuantity.ts:70-76` selects expected serials by the
  scalar `currentLocationId` with no location **type**, because the governed document contract stores
  only a scalar (`functions/src/serializedAsset/types.ts:14-19,72`). Transfer's sufficiency check has
  the same shape (`transferOrderCommand.ts:232`). Typed serial custody is C20's, not C25's.
- **C15 / cutover.** `eos_ops.cycle_count_lines` still has no column able to hold a per-serial
  disposition, so `reconcileLine` now REFUSES a serial discrepancy (`SERIAL_VARIANCE_NOT_RECONCILABLE`)
  rather than recording a line as reconciled with no ledger evidence — the same fail-closed answer
  `legacyInventoryMovementMapping.ts` gives with `SERIAL_SIGN_NOT_RECOVERABLE`.
- **Legacy serial ADJUSTED sign is unrecoverable BY CONSTRUCTION, not by accident.**
  `operationalMovementValidation.ts:80` pins a SERIAL movement's quantity to exactly `1`, so
  `cycleCountSheetCommand.ts:369`'s missing-serial ADJUSTED cannot carry a direction even in
  principle. Do not "fix" it by writing `-1` there; the validator rejects it.
