---
artifact_type: contract
title: Work Order migration COPY contract (Firestore fieldops_wos -> eos_ops.work_orders family)
date: 2026-09-26
lane: WOC (lane/wo-copy-correctness, base 09d63c4e)
authority: workOrderFieldParityMatrix.ts (where each fact lives), workOrderMigrationDryRun.ts (which records copy), Owner evidence 2026-09-22
implements: functions/src/eosOps/migration/workOrderMigrationCopy.ts (WORK_ORDER_COPY_CONTRACT mirrors this table)
---

# Work Order migration COPY contract

## Why this exists

The COPY at `workOrderMigrationCopy.ts:378-387` (base `09d63c4e`) inserted `created_at = now()`, left out
complaint, diagnosis, resolution, severity, estimated duration and every lifecycle timestamp except
`completed_at`, defaulted a missing priority to `3`, wrote **no** assignment, schedule history or
transition rows, and planted `planned_at = now()` on the Parts Plan. `verifyCopy` checked none of those,
so a COPY that lost them still reported `ok: true`. The parity matrix already said where each fact lives
(`workOrderFieldParityMatrix.ts:84-328`). The COPY did not follow it. This contract says what the COPY
does with each business-significant source field, and the code enforces it.

**What counts as the source.** The legacy writers (all Admin SDK, `firestore.rules:509` denies client
writes): `createWorkOrder.ts:81-99`, `transitionWorkOrder.ts:215-425` with `transitionEngine.ts:92-101`,
`scheduling/schedulingCommands.ts:225-238, 376-379`, `updateWorkOrderExecutionData.ts:172-230`,
`workOrderPartsPlan/setWorkOrderPartsPlan.ts:244`. The type is `types/workOrder.ts:83-186`.
**What counts as the target.** Migration `1761004800000` (`work_orders` lines 59-148,
`work_order_assignments` 160-202, `work_order_schedule_history` 240-259, `work_order_transitions`
267-287, `work_order_sales_order_lines` 301-312), plus `1761091200000` (`work_order_parts_plan`) and
`eos_policy.audit_events` (`1757462400000:347-358`).

## Classes

| Class | Meaning |
|---|---|
| REQUIRED_COPY | Copied into the named target column or row. VERIFY checks it. A required value that is missing or unusable **refuses the record**, with a reason code. |
| DERIVED_SERVER_SIDE | Not a source field. The COPY computes it from governed authority (Owner manifest, governed binding, identity tables, run metadata). |
| HISTORICAL_ONLY | Kept as evidence (the Firestore record until legacy retirement, the Firestore Audit Events, and this run's provenance record). Not written as governed target state, because doing so would mean making up a fact the source does not have. |
| INTENTIONALLY_NOT_COPIED | Another governed authority owns the fact, or it is a duplicate. Not copied, on purpose. |
| UNKNOWN | No target column exists, and no ruling says where the fact goes. **Schema gap.** A record with a non-empty value here is refused (`SCHEMA_GAP_FIELD_PRESENT`) so the value is not silently lost. |

Any top-level source field that is **not** in this table refuses the record (`UNMAPPED_SOURCE_FIELD`).
Nothing is dropped just because nobody listed it.

## The contract

| # | Source field (cite) | Target (cite, migration 1761004800000 unless noted) | Class | Rule |
|---|---|---|---|---|
| 1 | document id (`types/workOrder.ts:84`) | `work_orders.id` (61) | REQUIRED_COPY | Carried exactly. A `data.id` that differs from the document id refuses the record. |
| 2 | `woNumber` (85; `createWorkOrder.ts:82`) | `work_order_number` (70) | REQUIRED_COPY | Copied exactly. No number is allocated. |
| 3 | `status` (87; `transitionWorkOrder.ts:216`) | `status` (71) | REQUIRED_COPY | Must be one of the 11 governed statuses (`types/workOrder.ts:15-26`), otherwise `FIELD_VALUE_INVALID`. |
| 4 | `type` (92; `createWorkOrder.ts:86`) | `work_order_type` (72) | REQUIRED_COPY | The DRY RUN's Owner normalization (`SERVICE`/absent -> `SERVICE_CALL`). The raw value goes in the plan and the run record. |
| 5 | `priority` (89; `createWorkOrder.ts:84,114`) | `priority` (73) | REQUIRED_COPY | Integer 1..4. **There is no default.** The old `?? 3` made up a priority. Absent means `MISSING_REQUIRED_FIELD`. |
| 6 | `severity` (90; `createWorkOrder.ts:85`) | `severity` (74) | REQUIRED_COPY | In the vocabulary (`EQUIPMENT_DOWN`/`PARTIAL_OPERATION`/`COSMETIC`/`PREVENTIVE`): copied. Out of the vocabulary: `NULL`, raw value kept in the run record (the DRY RUN ruling `workOrderMigrationDryRun.ts:651-662`). It never becomes priority. |
| 7 | `customerId` (94) | `customer_id` (86) | REQUIRED_COPY | Must be a non-empty string. |
| 8 | `locationId` (95) | `location_id` (87) | REQUIRED_COPY | Must be a non-empty string. |
| 9 | `equipmentId` (100) | `equipment_id` (88) | REQUIRED_COPY | Nullable. The FK applies. |
| 10 | `salesOrderId` (104) | `sales_order_id` (89) | REQUIRED_COPY | Nullable, opaque. |
| 11 | `salesOrderLineRefs` (105; `createWorkOrder.ts:92`) | `work_order_sales_order_lines` (301-312) | **UNKNOWN** | Schema gap: the target keeps only `sales_order_line_id`. `kind`, `orderedQty` and `allocatedQty` have no column, and `lineId` is optional on legacy refs (`types/workOrder.ts:69-80`). This is the `COMMERCIAL_D2` seam. If present, the record is refused. |
| 12 | *(no source field; ownership matrix `ownership/ownershipMatrix.ts:230-251`, `ownerFields: []`)* | `operating_company_key` (66) | DERIVED_SERVER_SIDE | Owner manifest `operatingCompanyId`, then the governed binding (`resolveOperatingCompanyKey`). Never string equality. |
| 13 | *(tenant)* | `tenant_id` (62) | DERIVED_SERVER_SIDE | Operator `--tenantKey`, then `eos_policy.tenants`. |
| 14 | `complaint` (158; `createWorkOrder.ts:89`) | `complaint` (106) | REQUIRED_COPY | Verbatim. `''` stays `''` and absent stays `NULL`. A non-string refuses the record. |
| 15 | `diagnosis` (159) | `diagnosis` (107) | REQUIRED_COPY | Same rule as complaint. No current server writer. Copied when present. |
| 16 | `resolution` (160) | `resolution` (108) | REQUIRED_COPY | Same rule as complaint. |
| 17 | `estimatedDurationMinutes` (117; `schedulingCommands.ts:376-379`) | `estimated_duration_minutes` (94) | REQUIRED_COPY | A positive integer or absent. Anything else refuses the record. |
| 18 | `laborHours` (161) | Work Order labor authority (`workOrderLabor/workOrderLaborCommand.ts:3,563`) | INTENTIONALLY_NOT_COPIED | A denormalized total. The labor records are the authority. |
| 19 | `scheduledStart` (120; `transitionWorkOrder.ts:293`, `schedulingCommands.ts:227`) | `scheduled_start` (92) | REQUIRED_COPY | Timestamp rule (below). Both ends or neither, and end >= start, checked before any write. |
| 20 | `scheduledEnd` (121; `transitionWorkOrder.ts:294`) | `scheduled_end` (93) | REQUIRED_COPY | Timestamp rule. |
| 21 | `dispatchedAt` (149; `transitionWorkOrder.ts:378`) | `dispatched_at` (97) | REQUIRED_COPY | Timestamp rule. |
| 22 | `acceptedAt` (150; `transitionEngine.ts:94`) | `accepted_at` (98) | REQUIRED_COPY | Timestamp rule. |
| 23 | `enRouteAt` (151; `transitionEngine.ts:95`) | `en_route_at` (99) | REQUIRED_COPY | Timestamp rule. |
| 24 | `arrivedAt` (152; `transitionEngine.ts:96`) | `arrived_at` (100) | REQUIRED_COPY | Timestamp rule. |
| 25 | `workStartedAt` (153; `transitionEngine.ts:97`) | `work_started_at` (101) | REQUIRED_COPY | Timestamp rule. |
| 26 | `completedAt` (154; `transitionEngine.ts:98`) | `completed_at` (102) | REQUIRED_COPY | Required when status is `COMPLETED` (132). |
| 27 | `closedAt` (155; `transitionEngine.ts:99`) | `closed_at` (103) | REQUIRED_COPY | Required when status is `CLOSED` (133). On a `CANCELLED` record see row 28. On any other status it refuses the record (`TIMESTAMP_STATUS_INCOHERENT`). |
| 28 | cancellation instant = `closedAt` on a `CANCELLED` record (`transitionEngine.ts:100`: "Cancel: closedAt") | one `work_order_transitions` row (267-287): `to_status='CANCELLED'`, `action='cancel'`, `from_status NULL`, `actor NULL`, `provenance='MIGRATED'` | DERIVED_SERVER_SIDE | **Schema gap: there is no `cancelled_at` column.** Native `CANCELLED` never stamps `closed_at` (`eosOps/workOrderLifecycle.ts:329`), so writing it there would give the column a second meaning. The instant is kept as the transition it records. |
| 29 | `createdAt` (184; `createWorkOrder.ts:97`) | `created_at` (116) | REQUIRED_COPY | **The legacy instant, passed explicitly. Never `now()`.** Absent or unusable means `MISSING_REQUIRED_FIELD`. |
| 30 | `updatedAt` (185; `createWorkOrder.ts:98`, `transitionWorkOrder.ts:217`) | `updated_at` (117) | REQUIRED_COPY | Same rule as `createdAt`. Must be >= `createdAt`. |
| 31 | `lastUpdated` (178; `updateWorkOrderExecutionData.ts:172`) | *(none)* | INTENTIONALLY_NOT_COPIED | The touch time of one writer (execution capture). `types/workOrder.ts:172-176` calls it deliberately separate from `updatedAt`. **Conflict noted:** the parity matrix (`workOrderFieldParityMatrix.ts:315-322`) calls it "the same fact" and lists "they disagree" as a blocker. They disagree by design, so that blocker is not applied. Owner may revisit. |
| 32 | `partsPlanUpdatedAt` (182; `setWorkOrderPartsPlan.ts:244`) | `parts_plan_updated_at` (109) | REQUIRED_COPY | Timestamp rule. |
| 33 | `assignedTechId` (107; `transitionWorkOrder.ts:366`) | `work_order_assignments` current row (160-202) | REQUIRED_COPY | Technician, then Employee (see Assignments). When present it is the current assignee (`transitionWorkOrder.ts:367-369`). |
| 34 | `scheduledTechId` (122; `transitionWorkOrder.ts:295,377`, `schedulingCommands.ts:226`) | the same current row, when there is no `assignedTechId` | REQUIRED_COPY | Before dispatch it names the current assignee. After dispatch it equals `assignedTechId`. A divergent value goes to the run record. |
| 35 | `reassignedFromTechId` (143; `transitionWorkOrder.ts:381`) | run record evidence | HISTORICAL_ONLY | A closed interval row needs `effective_from` (168, NOT NULL), and the source never recorded when that earlier assignment began. Writing the row would mean making up a start. |
| 36 | `reassignedAt` (144; `transitionWorkOrder.ts:382`) | run record evidence, and the current row's `effective_from` (basis `REASSIGNED_AT`) | HISTORICAL_ONLY | See Assignments. |
| 37 | `reassignedReason` (145) | run record evidence | HISTORICAL_ONLY | |
| 38 | `reassignedByUid` (146) | run record: resolved Principal id or `UNRESOLVED` (never the uid) | HISTORICAL_ONLY | |
| 39 | `rescheduledFromTechId` (131; `schedulingCommands.ts:234`) | run record evidence, and basis `RESCHEDULED_AT` | HISTORICAL_ONLY | Same interval-start gap as row 35. |
| 40 | `rescheduledFromStart` (129; `schedulingCommands.ts:232`) | `work_order_schedule_history.previous_start` (244) | REQUIRED_COPY | One row for the surviving latest reschedule. |
| 41 | `rescheduledFromEnd` (130) | `previous_end` (245) | REQUIRED_COPY | |
| 42 | `rescheduledAt` (132; `schedulingCommands.ts:235`) | `changed_at` (250) | REQUIRED_COPY | Required whenever `rescheduledFrom*` is present. `new_start`/`new_end` = the current schedule. A reschedule only happens in `SCHEDULED` (`schedulingCommands.ts:193`), and Unschedule clears the snapshot (`transitionWorkOrder.ts:420-425`). |
| 43 | `rescheduledReason` (133; `schedulingCommands.ts:236`) | `reason` (248) | REQUIRED_COPY | |
| 44 | `rescheduledByUid` (134; `schedulingCommands.ts:237`) | `changed_by_principal_id` (249) | DERIVED_SERVER_SIDE | uid -> `eos_policy.principals` (`identity_provider='firebase'`) with a tenant membership. If it does not resolve: `NULL` (MIGRATED rows may say "unknown", migration comment 112-113), reported in the outcome. |
| 45 | `inventorySnapshot` lines: `[].partId` + `qtyPlanned` (167, 188-202; `setWorkOrderPartsPlan.ts:244`) | `work_order_parts_plan` (1761091200000) | REQUIRED_COPY | One row per line with `qtyPlanned > 0`. A planned line with no `partId`, a qty that is not a whole number, or a duplicate `partId` refuses the record. The Part id is preserved as a reference, not checked against the catalog. |
| 46 | `inventorySnapshot[].qtyUsed/sku/name/category/notes/lineId` | `work_order_inventory_effects` / inventory ledger | INTENTIONALLY_NOT_COPIED | Usage was already recorded by the governed consumption authority (`updateWorkOrderExecutionData.ts:190-212`). |
| 47 | `executionLog` (177; `updateWorkOrderExecutionData.ts:225`) | *(none)* | **UNKNOWN** | Schema gap. These are technician notes (`{note, at, byTechnicianId}`, `types/workOrder.ts:209-213`), not status transitions, so the matrix's target `work_order_transitions` does not fit. If present, the record is refused. |
| 48 | creator identity: `actorUid` on the `createWorkOrder` Audit Event (`createWorkOrder.ts:190-209`). **Not on the record.** | `created_by_principal_id` (114) = `NULL` | HISTORICAL_ONLY | The schema allows it for MIGRATED rows (134-136). It stays in the Firestore Audit Events. |
| 49 | last actor (per-write Audit Events only) | `updated_by_principal_id` (115) = `NULL` | HISTORICAL_ONLY | Same as row 48. |
| 50 | dispatcher and every transition's actor (Audit Events, `transitionWorkOrder.ts:564-611`) | *(none)* | HISTORICAL_ONLY | Only the cancellation (row 28) is carried as a transition row. Other lifecycle moments are columns 21-27. |
| 51 | `inboundWorkRequestId` (`createWorkOrder.ts:94`, not in the type) | *(none)* | **UNKNOWN** | Schema gap. Refused if present. |
| 52 | `externalReference` (`createWorkOrder.ts:95`) | *(none)* | **UNKNOWN** | Schema gap. Refused if present. |
| 53 | `authorizationNumber` (`createWorkOrder.ts:96`) | *(none)* | **UNKNOWN** | Schema gap. Refused if present. |
| 54 | accountable person / record owner | *(no column on `work_orders`)* | INTENTIONALLY_NOT_COPIED | Nothing to copy: the source has no field (`ownershipMatrix.ts:249`), and assignment never changes ownership. |
| 55 | provenance | `provenance='MIGRATED'` (111) and on every child row | DERIVED_SERVER_SIDE | |
| 56 | source provenance: snapshot `bodySha256`, per-document `sha256`, `runId`, `decisionId`, copy instant | `eos_policy.audit_events` row `action='work_order.migration.copy'` | DERIVED_SERVER_SIDE | **Schema gap: `work_orders` has no copy-time or run column.** The existing C5 convention (`commercialC5Target.ts:713-718`) is used instead: one audit row per applying run. |

**Counts (56 rows):** REQUIRED_COPY 33 · DERIVED_SERVER_SIDE 6 · HISTORICAL_ONLY 8 ·
INTENTIONALLY_NOT_COPIED 4 · UNKNOWN 5 (`salesOrderLineRefs`, `executionLog`, `inboundWorkRequestId`,
`externalReference`, `authorizationNumber`) · plus 2 derived schema gaps (row 28 `cancelled_at`,
row 56 copy-time column).

**Schema gaps, reported and not authored:** no migration was written. Every one would be a new column
or table, which is not trivially additive, and each needs an Owner/Commercial decision:
`cancelled_at`; a copy-run/provenance column; Sales Order line ref `kind`/qty snapshot; technician
execution notes; inbound request / external reference / authorization number.

## Timestamps

One converter, `toTimestamptz`, is used for every target instant.

| Input | Conversion |
|---|---|
| Firestore Timestamp (`seconds` + `nanoseconds`, or `_seconds`/`_nanoseconds` when exported) | Exact to the microsecond. Nanoseconds are truncated to µs, which is `timestamptz` precision. |
| object with `toDate()` / JS `Date` | Millisecond precision. |
| ISO-8601 string **with** `Z` or `±hh:mm` | Parsed exactly and normalized to UTC. |
| ISO-like string **without** an offset | Refused: `TIMESTAMP_AMBIGUOUS_TIMEZONE`. No zone is ever assumed. |
| integer epoch **milliseconds** | Accepted only inside [2000-01-01, 2100-01-01). Epoch seconds fall outside that range and are refused, so seconds are never read as millis. |
| anything else, or an impossible date | `TIMESTAMP_INVALID` |
| outside [2000, 2100) | `TIMESTAMP_OUT_OF_RANGE` |
| `null` / absent / `''` | `NULL` (then the required-field rules apply) |

The canonical form is `YYYY-MM-DDTHH:MM:SS.ffffffZ`. VERIFY reads the target back with
`to_char(col AT TIME ZONE 'UTC', …US…)` and compares strings, so a timezone shift or lost precision
shows up as a divergence. Ordering checks: `updatedAt` and every lifecycle stamp (rows 21-27) must be
>= `createdAt`, otherwise `TIMESTAMP_ORDER_VIOLATION`.

**Migration-instant fields, which are explicitly not historical:** the audit row's `occurred_at`, the
`effective_from` of a current assignment whose start the source never recorded (basis
`MIGRATION_INSTANT`, which the row's `reason` states), and `work_order_parts_plan.planned_at`/`updated_at`
(whose `planned_by` is `migration:<decisionId>`). All three take **one** `copiedAt` value per run. It is
recorded in the run record, and VERIFY compares against it. This follows the C5 "established by the
migration, nothing backdated" precedent (`commercialC5Target.ts:32-33`).

## Assignments

- **Resolution:** only through the DRY RUN's exact chain, technician document -> `employeeId` ->
  governed Employee (`workOrderMigrationDryRun.ts:456-476`), or an Owner manifest
  `assignmentEmployeeId`. At COPY time the Employee must **also** exist in `eos_workforce.employees`
  for the tenant. A Firebase uid is never an Employee.
- **Current only.** One open `work_order_assignments` row, `source='MIGRATION'`, `provenance='MIGRATED'`,
  `assigned_by_principal_id NULL`, deterministic id `woa_mig_<workOrderId>`.
  `reason = MIGRATED_CURRENT_ASSIGNMENT legacy:<field>=<technicianId|none> basis:<basis>[ decision:<id>]`.
- **`effective_from` basis:** `REASSIGNED_AT` when `reassignedFromTechId` is present and the current row
  comes from `assignedTechId` (a dispatch reassignment opens the interval exactly then). `RESCHEDULED_AT`
  when the row comes from `scheduledTechId` and `rescheduledFromTechId` is present and different.
  Otherwise `MIGRATION_INSTANT`. A same-technician dispatch continues an interval that began at an
  unrecorded Schedule, so `dispatchedAt` is **not** used as the start.
- **History is not authored.** The source keeps only the latest reassignment and reschedule, and never
  their start. The technician ids go to the run record instead (rows 35-39).
- **Unresolvable assignee:** `ACTIVE` records never reach the plan, because the DRY RUN blocks them
  (`ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION`). A `TERMINAL` record with an unresolved technician is copied
  **with no assignment row**, and the legacy reference is kept (Owner ruling in the DRY RUN,
  `workOrderMigrationDryRun.ts:524-532`). An Employee that resolved in the source but is **missing from
  `eos_workforce.employees` refuses the whole COPY**: `UNRESOLVED_IDENTITY`, naming every affected
  Work Order. The COPY is one transaction, so refusing one Work Order refuses the run. This is fail
  closed: an in-flight job must not arrive unassigned, and a finished one must not name an Employee the
  target cannot hold.

## Insert-only, verification and provenance

- The COPY runs no `UPDATE` and no `UPSERT` on the target. An existing row is compared field by field and
  child by child. Equal: `ALREADY_PRESENT_EQUIVALENT`, nothing is written. Different: `TARGET_CONFLICT`,
  and the whole COPY is refused with the per-field findings.
- VERIFY classifies each row as `MATCH` / `SOURCE_CHANGED` (the run record's per-document `sha256` differs
  from the current source) / `TARGET_DIVERGED` / `UNRESOLVED_IDENTITY` / `MISSING_REQUIRED_FIELD` /
  `CHILD_ROW_MISMATCH` / `UNKNOWN`. It also counts child rows (assignments, schedule history,
  transitions, parts plan, sales order lines) and lists MIGRATED target rows outside the population.
  `ok` only when every row is `MATCH` and there are no unexpected rows.
- A dry run is deterministic: same source and same target give the same plan digest, refusals and
  collisions. `copiedAt` exists only when applying.
