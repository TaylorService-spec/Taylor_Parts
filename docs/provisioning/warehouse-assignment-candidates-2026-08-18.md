# Warehouse Assignment — Candidate Evidence (prepare-only, 2026-08-18)

**Status: PREPARE ONLY. Nothing in this document has been executed. No Firestore write has been made.**

This document exists because the assignedWarehouseIds decision below is a **business decision**, not one this
tooling makes on its own (Owner ruling, 2026-08-18: *"Choosing which warehouse each should get is a business
decision — if the data does not make it unambiguous, present the candidates with evidence and ask rather than
picking. Do not guess."*).

## 1. Verified live facts (read-only, `eos-platform-sandbox`, queried 2026-08-18)

### `employees` (8 documents)

| employeeId | userId (uid) | operationalRoles | assignedWarehouseIds | employmentStatus | displayName |
|---|---|---|---|---|---|
| sbx-admin | ZVu3lHTP1NQhj0Am04zTAGou0dx1 | [] | [] | ACTIVE | Sandbox Admin |
| sbx-dispatcher | PEiRkebIGRPcEau7yBBV0D77Dho1 | [] | [] | ACTIVE | Sandbox Dispatcher |
| sbx-owner | 0TeiR5wPHCXoAIJShLsY8HDMzJN2 | [] | [] | ACTIVE | Sandbox Owner |
| sbx-partsassoc | sDtteBblHLRjVRIi9pywra0YunM2 | ["PARTS_ASSOCIATE"] | **[]** | ACTIVE | Sandbox Parts Assoc |
| sbx-partsmgr | 9L4ISPqtTEfl3ARq8W5v1j0fOBm1 | ["PARTS_MANAGER"] | **[]** | ACTIVE | Sandbox Parts Manager |
| sbx-restricted | lT75guU9mEY46QFQcegWRZRhYBi2 | [] | [] | ACTIVE | Sandbox Restricted |
| sbx-tech | rgVA63PthVQH1LX4baueZPhO6MR2 | [] | [] | ACTIVE | Sandbox Technician |
| sbx-whmgr | 2AXHCx3zYiNgGH1bUb1PFCY3DjB3 | ["WAREHOUSE_MANAGER"] | ["wh-main"] | ACTIVE | Sandbox Warehouse Manager |

No `employees` document carries a `name` field distinct from `displayName`, a `region`, `homeWarehouseId`, or
any other field that could disambiguate a warehouse choice for the two employees below.

### `warehouses` (5 documents)

| warehouseId | name | status |
|---|---|---|
| wh-main | Main Distribution Center | ACTIVE |
| wh-north | North Service Depot | ACTIVE |
| wh-retired | Legacy Overflow Store | **INACTIVE** |
| wh-sandbox-central | Central Distribution | ACTIVE |
| wh-sandbox-north | North Satellite | ACTIVE |

`wh-retired` is excluded from every candidate list below — it is `INACTIVE`, and
`functions/scripts/warehouseAssignmentProvisioningCli.js` refuses any manifest entry naming an inactive
warehouse (`WAREHOUSE_NOT_ACTIVE`) at dry-run.

## 2. The two missing assignments

Three technicians carry operational roles that are gated by `assignedWarehouseIds` in Firestore Rules
(`isActiveOperationalRole(...) && resource.data.assignedWarehouseIds.hasAny([...])`-style predicates). One
already has an assignment:

- `sbx-whmgr` (WAREHOUSE_MANAGER) → `["wh-main"]` — **already assigned, out of scope for this manifest.**

Two do not, and are the subject of this preparation:

- `sbx-partsmgr` (PARTS_MANAGER) — `assignedWarehouseIds: []`
- `sbx-partsassoc` (PARTS_ASSOCIATE) — `assignedWarehouseIds: []`

## 3. Candidates, with evidence — no pick made

Four `ACTIVE` warehouses exist: `wh-main`, `wh-north`, `wh-sandbox-central`, `wh-sandbox-north`. Nothing in the
live data ties either employee to exactly one of them:

- No employee-side location/region/site field exists to cross-reference against a warehouse.
- No warehouse-side field (e.g. a roster, a manager pointer, a region tag) references either employee.
- The one existing precedent — `sbx-whmgr` → `wh-main` — is suggestive (co-locating the Warehouse Manager's
  Parts staff at the same "main" facility is a defensible operational read) but is **not a fact**, only an
  inference, and this tool does not treat an inference as a decision.

**Candidates for `sbx-partsmgr` (PARTS_MANAGER):** `wh-main`, `wh-north`, `wh-sandbox-central`,
`wh-sandbox-north`.

**Candidates for `sbx-partsassoc` (PARTS_ASSOCIATE):** `wh-main`, `wh-north`, `wh-sandbox-central`,
`wh-sandbox-north`.

## 4. What is being asked of the Owner

Pick one warehouse per employee (they need not match each other) from the four ACTIVE candidates above, and
state the one-line business rationale for each pick (e.g. "co-locate with WAREHOUSE_MANAGER at the facility
they already scope to" or "this persona exercises the North depot flows"). That rationale is a **required**
field in the manifest schema
(`functions/scripts/warehouseAssignmentProvisioningCli.js`'s `validateManifestShape` — entries with a blank
`rationale` are rejected before any Firestore read).

Once decided, fill
[`docs/provisioning/warehouse-assignment-manifest.template.json`](./warehouse-assignment-manifest.template.json)
into a new file (do not edit the template in place — keep the unfilled template as the reusable, empty
starting point for any future run) and hand it to the dry-run step in
[`docs/operations/warehouse-assignment-provisioning-runbook.md`](../operations/warehouse-assignment-provisioning-runbook.md).
The template as committed has `warehouseId: null` and `rationale: null` on both entries; the tool's manifest
validator refuses to run a manifest in that state (`employeeId/warehouseId/rationale must be a non-empty
string`), which is the deliberate, tested enforcement of "no guessing."

**No dry-run, execute, or write has been performed for this assignment.** This document is candidate evidence
only.
