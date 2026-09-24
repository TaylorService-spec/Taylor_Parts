---
artifact_type: evidence-manifest
title: Work Order migration — Owner evidence and final population
date: 2026-09-22
authority: Owner rulings 2026-09-22 (type normalization, operating company, probe residue)
snapshot: 3800975c2838f6c1610790c2eea153e7719b6d390c61b2f74319093650531b59
tool: functions/scripts/workOrderMigrationDryRun.mjs (read-only), functions/src/eosOps/migration/workOrderMigrationDryRun.ts
---

# Work Order migration — Owner evidence and final population

## The snapshot this evidence is about

`eos-platform-sandbox` / `fieldops_wos`, 30 documents,
`bodySha256 = 3800975c2838f6c1610790c2eea153e7719b6d390c61b2f74319093650531b59`.

Every ruling below is bound to that checksum. If the source changes the checksum changes, the Owner
manifest is refused and the probe exclusion stops applying — both records fall back to BUSINESS and block
again. A decision made about one measured population must not silently govern a different one.

## Final population

| | Count |
|---|---|
| SOURCE_TOTAL | 30 |
| Deterministic repository fixtures (`SBX-SCN-001` 11, `SBX-SCN-002` 5) | 16 |
| Owner-classified probe residue (`OWNER_CLASSIFIED_PROBE_RESIDUE_2026_09_22`) | 1 |
| **GENUINE BUSINESS** | **13** |
| COPYABLE | 13 |
| BLOCKED | 0 |

## Rulings

**Type normalization.** `SERVICE` → `SERVICE_CALL` (`OWNER_LEGACY_SERVICE_NORMALIZATION`); a missing type
→ `SERVICE_CALL` (`OWNER_LEGACY_DEFAULT`). The raw source value is retained in every case, including
`null`: after normalization a Work Order that never recorded a type and one that genuinely said
`SERVICE_CALL` are identical in the target, and the evidence must never claim the source said something it
did not. The NATIVE vocabulary is unchanged — no `LEGACY_SERVICE`, no `LEGACY_UNCLASSIFIED`.

**Operating company.** All 13 genuine business Work Orders → `taylor`, recorded in
`work-order-migration-manifest-OWNER-WO-COMPANY-2026-09-22.json`. **This is a migration fact about this
population and is NOT a runtime default.** Ventana can own Work Orders; the target model accepts any
ACTIVE governed operating company, and a native Work Order must establish company from explicit governed
input or a governed upstream record that already carries one, or creation refuses. Held by tests, not
convention.

**Numbering.** No schema change and no compatibility widening. All 13 genuine numbers already match the
native `^WO-[0-9]{4}-[0-9]{6,}$`; the 16 nonconforming shapes belong to excluded fixtures.

**Probe residue.** `p8nHWH7HywDUMiaS21YA` / `WO-2026-000034` is excluded as
`OWNER_CLASSIFIED_PROBE_RESIDUE_2026_09_22`. Retained in Firestore until legacy retirement — exclusion
means no target row, not deletion.

## Superseded decision — recorded, not rewritten

An earlier company decision under the same `decisionId` covered **14** records, including the probe record,
and was applied in a read-only re-run on 2026-09-22 before the probe ruling existed. It is superseded for
migration-population purposes by the probe exclusion. The committed manifest contains **13** records.

The mechanism enforces this rather than relying on the edit: the 14-record manifest is now REFUSED against
this population with `MANIFEST_FIXTURE_NAMED` — "naming it means the census was misread, and ignoring the
entry would leave that belief in place."

## Measured evidence for the probe exclusion

The forensic pass classified this record `BUSINESS_UNRESOLVED`, because the affirmative standard — a
repository-authored tool — was not met. The Owner, who knows what was run by hand, ruled it residue. Both
facts are recorded.

- `woNumber WO-2026-000034`, status `DISPATCHED`, type `SERVICE_CALL`
- `customerId 'probe-c'` → no account (105 read); `locationId 'probe-l'` → no location (185 read)
- `assignedTechId` and `scheduledTechId` both `probe-t-mtbxlplt` → no technician (13 read)
- the referenced records were **never created**, not deleted: no `probe-*` document exists in any collection
- `parseInt("mtbxlplt", 36)` = `2026-08-27T19:44:26.081Z`, **1.377 s before** the record's own `createdAt`
- created `19:44:27.458`, DISPATCHED `19:44:28.418` — 960 ms apart, a machine cadence
- the only probe-referencing document among 30 work orders, 105 accounts, 185 locations, 13 technicians,
  290 equipment, 45 jobs and 26 sales orders
- `git log --all -S` finds **zero** commits, on any branch, authoring `probe-t-`, `'probe-c'` or `'probe-l'`
- created through the governed `createWorkOrder` command by a real dispatcher persona, with four audit events

**Measurement correction.** The ruling text and an earlier report describe a dangling `salesOrderId`. The
record carries **no `salesOrderId` field at all**; its unresolved references are `customerId` and
`locationId` only.

## Target collision status

Measured read-only against Render nonprod `eos-policy-nonprod` (`dpg-dah48qht0dsc73egnml0-a`, database
`eos_policy`) on 2026-09-22. No connection string was handled or printed.

**`eos_ops.work_orders` does not exist in nonprod.** `to_regclass` is NULL; `pgmigrations` holds 34 rows,
last `1760140800000_reorder-assignment-identity`; the only `eos_ops` `work_order*` table is
`work_order_inventory_effects`. The repository carries 36 migrations — `1761004800000` and `1761091200000`
are not applied there.

So no row can collide and all 13 are `TARGET_ABSENT` — but the absent SCHEMA is itself an unmet COPY
precondition, and it is a different fact from "the table is empty".

## What is NOT resolved by any of this

- `SERVICE_FROM_SALES_ORDER_PART_LINE = COMMERCIAL_D2_EXECUTION_AUTHORITY_BLOCKER`
- no PostgreSQL Work Order create command, lifecycle command or number allocator exists
- COPY tooling does not exist
