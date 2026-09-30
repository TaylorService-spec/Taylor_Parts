# Reorder source census reconciliation (Owner ruling 2026-09-29)

**Status: reconciled locally. No live action.** The committed
[exclusion manifest](./reorder-migration-exclusion-manifest.json) (version 2) encodes this ruling. The Reorder
COPY (`functions/scripts/reorderCutover.js --exclusionManifest`) and
`functions/src/eosOps/migration/reorderMigrationExclusion.ts` enforce it. No Firestore record is deleted or mutated.

## The 15 legacy `reorder_requests`: mutually exclusive classes

| Class | Disposition | Requests | Purchase orders | Why |
|---|---|---|---|---|
| A. DQ-032 synthetic scenario fixtures | EXCLUDED | 5 (`ro-sbx-001`, `-002`, `-003`, `-004`, `-006`) | 3 (`ro-sbx-001`, `-005`, `-006`) | Sandbox seeder facts. Excluded only while the facts still match. |
| B. `CERTIFICATION_LIVE_PROOF` | EXCLUDED | 9 on part `CW-P-0000` | 1 (`Sz8QPa815EgkmvmObQ1K`) | Decision #155 / 2C / R-34 live proof on the certification part. Refuses if a record no longer names `CW-P-0000`. |
| C. `LEGACY_INCOMPLETE_OPERATING_CONTEXT` | HOLD | 1 (`eA7o3t8DyUXmtg8MCKjT`) | 0 | No warehouse and no operating company. Refuses if it gains one; that case needs a new ruling, never an inference. |
| D. Operational | COPY | **0** | 0 | Nothing remains to copy. |

The classes add up with no overlap: 5 + 9 + 1 + 0 = 15. There are 0 voids.

**Consequence:** Reorder activates in nonprod with an **empty queue**. No warehouse or operating-company baseline
is required for this activation.

The Catalog stays unchanged. `CW-P-0000` is `CERTIFICATION_FIXTURE_EXCLUDED:certificationWorld-marker` and is never
copied into `eos_ops.parts`. Of the source Catalog (54 parts, 48 equipment models, 21 aliases), 9 parts and
21 aliases are selected; 45 parts and all 48 models are certification fixtures.

## Backlog (recorded, NOT built by this ruling)

- **Warehouse / Inventory backlog: a warehouse COPY operator.** The source warehouses `wh-main` (taylor) and
  `wh-north` (ventana) are synthetic Firestore sandbox seeds. No governed Firestore→EOS warehouse copy exists.
  Until that operator is built under its own ruling, there is no Firestore warehouse read, no `wh-main`/`wh-north`
  population, and no mapping onto the Sample Company warehouses (`SC-WH-MAIN`, `SC-WH-SERVICE`).
- **Configuration backlog: the Ventana operating-company key binding.** `ventana` has no
  `tenant_operating_company_keys` row. The tooling exists
  (`operating-company-keys.sandbox.json` + `tenantOperatingCompanyKeyReconcileCli.js`) but is not run.

## Fixture isolation for the activation window (Controller rulings 2026-09-30)

- **1(b): preserve the four Sample Company v2 Equipment Models.** `taylor-nonprod` holds `FIXTUREWORKS--FW-50`,
  `FIXTUREWORKS--FW-OLD`, `SAMPLECO--SC-100` and `SAMPLECO--SC-200` (sourceAuthority `SAMPLE_COMPANY_V2`, seeded
  2026-09-16). The Catalog COPY treats exactly these as `KNOWN_NON_MIGRATED_FIXTURE`
  (`functions/src/catalogMaster/catalogKnownFixtures.ts`). Each is pinned by tenant, id, classification and a
  canonical fingerprint. The copy never writes them and verify does not count them as Taylor Catalog data. A fifth
  fixture, a changed or missing one, or one in another tenant refuses with `KNOWN_FIXTURE_MISMATCH`. Every other
  unknown target row is still `TARGET_HAS_UNKNOWN_RECORDS`.
- **2(a): one synthetic Taylor acceptance warehouse.** `synthetic-np-wh-taylor-acceptance` sits under key `taylor`.
  It is named `SYNTHETIC … (fixture)`, has no bin, and is audited as `NONPROD_SYNTHETIC_ACCEPTANCE`. It is created only by
  `functions/scripts/syntheticAcceptanceWarehouseCli.js` through the governed `warehouseBinRepository.createWarehouse`.
  It is acceptance infrastructure for the synthetic Reorder lifecycle proof, not Taylor master data. Sample Company
  stays unbound (`sample-co-synthetic` is never mapped to Taylor).
