# Governed field groups

**Status:** EOS Core mechanism. Owner direction, 2026-10-12 ([DECISIONS #230](../DECISIONS.md)). First instance: Part Supplier Terms (SUP-1, PR #2064).
**Evaluator:** `functions/src/eosOps/governedFieldGroups.ts` (pure: no I/O, no clock).
**First adopter:** `functions/src/eosOps/partSupplierTerms.ts`.

Governed field groups are how EOS governs access to **fields inside a record**. Use them when some fields of a record need their own authority, for example cost on a supplier's terms.

The Owner set three rules (2026-10-12):

- Governed field groups are **the** reusable EOS Core field-permission mechanism.
- The retired per-Role field overrides (`role_field_permission_overrides`) and the retired field-override UI are **not** revived.
- Commercial READ, CREATE and EDIT each use an **explicit capability**.

## 1. The model

The chain is Employee → Security Role → capability → Object → field group → field.

- Each field group is governed by **registered capabilities**. These are ordinary rows in `eos_policy.capabilities`, on the record's Object.
- Administration grants a group's capabilities to Security Roles the same way it grants any other capability. They are revoked, audited and shown in the Objects matrix the same way too.
- Nothing about a field group lives outside the capability model.

### 1.1 Definition shape

```ts
defineFieldGroups({
  objectKey: "supplierCatalogItem",
  // The RECORD DOORWAY: one registered key per record-level action. Optional.
  record: { read: "inventory.supplierTerms.read", create: "...create", edit: "...edit", changeStatus: "...changeStatus" },
  groups: [
    { key: "RELATIONSHIP", label: "Supplier relationship", sensitive: false,
      read: "inventory.supplierTerms.read", create: "inventory.supplierTerms.create", edit: "inventory.supplierTerms.edit",
      fields: ["itemId", "partId", "supplierId", /* ... */] },
    { key: "COMMERCIAL", label: "Cost & contract terms", sensitive: true,
      read: ["inventory.supplierTerms.read", "inventory.catalog.read", "inventory.catalog.cost.read"],   // ALL-OF
      create: "inventory.catalog.cost.create", edit: "inventory.catalog.cost.edit",
      fields: ["cost", "currency", "contractStart", "contractEnd"] },
  ],
});
```

Each mode (`read`, `create` or `edit`) takes one requirement. A requirement is one of:

- `null`: the group is governed by the command's record gate.
- one key: the caller must hold that key.
- a non-empty list of keys: the caller must hold **every** key in the list.

`defineFieldGroups` refuses these definitions when the module loads:

- a field that appears in two groups;
- a group key used twice;
- an empty requirement list;
- a record action without a key.

### 1.2 Evaluator API

| Function | Answers |
|---|---|
| `fieldAccessFor(def, caps)` | `{ [group]: { read, create, edit } }`. This is the caller's decision for each group, and the UI renders from it. |
| `recordAccessFor(def, caps)` | `{ [recordAction]: boolean }`, for example `{ read, create, edit, changeStatus }`. The UI offers only the controls this allows. |
| `projectForCaller(def, caps, record)` | The record as this caller may see it. Fields of an unreadable group are **absent**. `withheld` names each withheld group, its fields and the keys it requires. |
| `assertWritable(def, caps, mode, fields)` | Throws `FIELD_GROUP_FORBIDDEN` naming the group and the keys it requires, or `FIELD_NOT_GOVERNED` for a field that no group declares. The error carries field names and keys, never a value. |
| `canReadAllGroups(def, caps)` | `false` when some group is unreadable. A command must then not decide any answer by comparing stored values. |
| `auditSafe(def, record)` | The record as an audit row may hold it. Every field of a sensitive group becomes `{ withheld: true }`, and `sensitiveFieldsWithheld` names those fields. |
| `sensitiveFieldsChanged(def, before, after)` | The **names** of the sensitive fields that changed, for an audit reason. It never returns values. |

`caps` is the caller's **already-resolved** capability Set. It comes from `capabilityAuthority.resolveOperationalContext`, the same resolver every flat gate reads. The evaluator never resolves anything itself.

## 2. Rules

1. **Record doorway.** No field of a record is readable without the record's own read key. Each group's read requirement repeats that key. Each record action (`create`, `edit`, `changeStatus`) is checked by the command before any field group is consulted. The refusal is `CAPABILITY_MISSING`, and it names the key.
2. **Additive union of effective capabilities.** The capability Set is the union of every Role the Principal holds through a qualifying assignment, plus unexpired direct exceptions. Holding more Roles can only widen access. Two Roles that each hold half of an all-of requirement together satisfy it, and the PG suite proves this with real assignments.
3. **Withheld, not nulled.** An unreadable field is removed from every response: list, write echo, replay and unchanged answers. A `null` would itself reveal something, because it says the field has no value. `withheld` names the group and the keys it requires.
4. **Write refusal.** A request naming a field of a group the caller may not create or edit is refused (`FIELD_GROUP_FORBIDDEN`) before anything is read.
5. **No equality oracle.** A caller who cannot read a group never gets an answer decided by that group's stored values:
   - A create whose content-addressed replay would match the stored terms is answered `ITEM_ALREADY_EXISTS`.
   - A stated value of an unreadable group is applied unconditionally. The version bumps, and the answer is never `NO_CHANGES` or a replay. Because the value was not compared, the audit reason says it was **stated**, not that it changed: for example `part-supplier terms stated without read access: cost` (review N3).
   - A caller without the record read key is not told which other record a write affected, and cannot find it out by probing. For example, setting the preferred supplier returns `clearedItemId: null` to that caller, and checks every precondition (stated version, ACTIVE terms, ACTIVE supplier) before answering `unchanged`, so no refusal differs by which item is preferred (review N2).
   - A blind change to a range must state both ends, so no refusal depends on a stored bound the caller cannot see.
6. **Minimal echo.** A caller who may write a record but cannot read it gets `{ itemId, status, version }` and nothing else (security review N1). An example is a caller holding `changeStatus` alone.
7. **Audit-safe sensitive values.** Audit rows hold sensitive values as `{ withheld: true }`, and the audit reason names the changed sensitive fields only. The audit trail stays append-only: the `audit_events_append_only` trigger is not touched, and a test proves that an UPDATE or DELETE is still refused.
8. **Standing exclusions for sensitive groups.** A sensitive group's keys go in `PROTECTED_ADMINISTRATOR_EXCLUSIONS`. Protected Administrator standing implies every READ, so without the exclusion it would reach the sensitive read. The record read stays implied: operational read is part of standing (#223).
9. **Scoped or conditional grants are not effective (fail closed).** A key reached only through a scoped assignment is not in the flat capability Set (`conditionallyHeld` only). A key granted under a **grant condition** (`eos_policy.capability_grant_conditions`) is removed by `capabilitiesWithoutUnevaluatedConditions` before any field-group decision, the same rule the Cycle Count routes apply. An adopting route resolves its actor that way. The supplier-terms routes use their own actor for this, and leave the shared Reorder actor unchanged (review N1). A field group therefore never treats either kind of key as held.
10. **No title inference.** No Role key, persona, title or Job Role is read anywhere in the evaluator or in an adopting command. The Owner direction says: do not infer cost access from Owner, Administrator, General Manager, Parts Manager or Warehouse Manager titles. A static test scans the command for those words.
11. **No revival of `role_field_permission_overrides`.** A group's authority is a capability, and nothing else.

## 3. Audit and reporting policy

- **Audit rows.** A sensitive group's values never reach `eos_policy.audit_events`. A general audit read, the Administration audit history and any export of the audit trail therefore cannot carry them, because the stored row does not hold them.
- **Reporting.** Every field of a sensitive group is `reportable: false` and `exportable: false` in the Object definition (`field-ops-app-vite/src/metadata/definitions/*.js`). The seed snapshot carries `reportable: false` into `eos_policy` field metadata. No report, export or analysis definition can select these fields. A test pins that every CONFIDENTIAL field of `supplierCatalogItem` is non-reportable.
- **Replay outcomes and response echoes** are projected for the caller (rules 3, 5 and 6). An error response carries field names and capability keys only, never a stored value. The PG suite collects more than 60 refusals and checks them all.

## 4. Accepted disclosure: version-change metadata

Optimistic concurrency bumps the record's `version` on every applied write, including a write that changed only a restricted field. The audit reason also names the restricted fields that were written (for example `part-supplier terms updated: cost, leadTimeDays`, or `stated without read access: cost` for a writer who cannot read them).

As a result, a caller who can read the record but not the restricted group can observe that a restricted field changed: the version moved, or the audit names the field. They **never** observe the field's value.

Per the Owner direction of 2026-10-12, this is **recorded as accepted**. The metadata is required for correct concurrency and for an honest audit trail, and it never carries a restricted value. No mitigation, such as a separate version per group, is planned.

## 5. Adopting governed field groups for another Object

1. **Register the keys** in a migration: one per record action and one per group mode, on the Object, with clear `display_label`s.
   - Grant nothing in the migration.
   - Write a guarded Down that refuses to reverse while a grant or an Administration decision names one of the keys.
   - Keep the migration terse. node-pg-migrate echoes every migration file into the PG test harnesses' output buffer. At this PR the full chain prints 1,047,428 bytes against the 1,048,576-byte (1 MiB) `spawnSync` default, which leaves 1,148 bytes. The canonical fix is Native Identity PR #2066, which raises `maxBuffer` at every harness call site (#2069 was closed as its duplicate). **#2066 must merge before the next migration lands.**
2. **Define the groups** with `defineFieldGroups`.
   - Include the record doorway.
   - Repeat the record read key in every group's `read`.
   - Mark a group `sensitive: true` when its values must not be audited.
3. **In the command:**
   - Check the record key first.
   - Call `assertWritable` before any read.
   - Pass every response through `projectForCaller`, or the minimal echo for a non-reader.
   - Write audit rows with `auditSafe`, and use `sensitiveFieldsChanged` for the reason.
   - Use `canReadAllGroups` and per-group readability for every replay or no-change decision.
4. **In the list answer,** return `fieldAccess` and `recordAccess`. The UI renders from these, fails closed when they are absent, and never sends a field the caller cannot write.
5. **Add a sensitive group's keys to `PROTECTED_ADMINISTRATOR_EXCLUSIONS`.** Changing that list is an Owner decision.
6. **Mark sensitive fields** `sensitivity: "CONFIDENTIAL"`, `reportable: false` and `exportable: false` in the Object definition. Then regenerate the seed snapshot.
7. **Prove the Object in tests:**
   - the Objects matrix (`getObjectActionGrantMatrix`): the actions, kinds, labels and standing;
   - zero grants;
   - one Role per mode;
   - the multi-Role union;
   - write-blind oracles;
   - the Protected Administrator through the real resolver;
   - tenant isolation;
   - audit rows and append-only integrity;
   - error responses.
8. **Fan out the capability count** to every pin, the sample company vocabulary and the capability graph.

## 6. Instance: Part Supplier Terms (`supplierCatalogItem`)

**Table:** `eos_ops.supplier_catalog_items`. **Command:** `partSupplierTerms.ts` on `/operations/inventory`. **Migration:** `1764530000000_supplier-terms-capabilities.sql`.

| Capability | Action | Kind | Label | Protected Administrator standing |
|---|---|---|---|---|
| `inventory.supplierTerms.read` | `readTerms` | READ | Read supplier terms | implied (operational read, #223) |
| `inventory.supplierTerms.create` | `createTerms` | CREATE | Add supplier terms | not implied (business Object) |
| `inventory.supplierTerms.edit` | `editTerms` | EDIT | Edit supplier terms | not implied |
| `inventory.supplierTerms.changeStatus` | `changeStatus` | BUSINESS_ACTION | Activate / deactivate supplier terms | not implied |
| `inventory.catalog.cost.read` | `readCost` | READ | Read supplier cost & contract terms | **excluded** |
| `inventory.catalog.cost.create` | `createCost` | CREATE | Set supplier cost & contract terms on new terms | **excluded** |
| `inventory.catalog.cost.edit` | `editCost` | EDIT | Change supplier cost & contract terms | **excluded** |

`inventory.catalog.cost.read` is effective **only together with** `inventory.supplierTerms.read` and `inventory.catalog.read` (review N5). Granted alone it shows nothing, and the PG suite proves this (r1). Administration shows its label as written above. Whoever grants it should grant the other two as well, as both proposals in 6.1 do.

| Group | Fields | read | create | edit |
|---|---|---|---|---|
| RELATIONSHIP | itemId, partId, supplierId, supplierName, supplierStatus, supplierSku, status, preferred, version | supplierTerms.read | supplierTerms.create | supplierTerms.edit |
| OPERATIONAL | leadTimeDays, availability, minOrderQty, orderMultiple, purchaseUnit, conversionToStockingUnit, lastVerifiedAt | supplierTerms.read | supplierTerms.create | supplierTerms.edit |
| COMMERCIAL (sensitive, CONFIDENTIAL, non-reportable) | cost, currency, contractStart, contractEnd | supplierTerms.read **and** catalog.read **and** catalog.cost.read (r1) | catalog.cost.create | catalog.cost.edit |

- **Creating terms** needs `supplierTerms.create` **and** `catalog.cost.create`, because cost and currency are NOT NULL.
- **`supplierOptions`,** the suppliers that terms can be added for, is offered only to a caller holding both of those keys.
- **Setting the preferred supplier** needs `supplierTerms.edit`, because preference is a RELATIONSHIP field.
- **No dependency on broad catalog maintenance.** Supplier terms no longer depend on `inventory.catalog.manage` or `inventory.catalog.activate`. A holder of those two keys alone is refused every supplier-terms operation. The Owner directed that broad catalog maintenance must not be granted merely to let a Purchasing Manager maintain supplier terms.

### 6.1 PROPOSED grants (not executed)

> **Proposed only.** These grants are **not** executed. No migration, delta, seed or sample-company fixture grants any of the seven keys, and the tests pin zero grants. Executing them is an Administration action that needs further Owner authorization.

| Role | Proposed keys | Already held (baseline) | Effect |
|---|---|---|---|
| **Purchasing Manager** (`purchasingManager`) | `inventory.supplierTerms.read`, `.create`, `.edit`, `.changeStatus`; `inventory.catalog.cost.read`, `.create`, `.edit` (7) | `inventory.catalog.read` | Reads, adds, edits and activates supplier terms, sets the preferred supplier, and sees and sets cost, currency and contract window. It gains no `inventory.catalog.manage`. |
| **Inventory Catalog Administrator** (`inventoryCatalogAdministrator`) | `inventory.supplierTerms.read`, `.edit`, `.changeStatus`, and `inventory.catalog.cost.read` (4) | `inventory.catalog.read`, `.manage`, `.activate` | Maintains relationship and ordering terms and their lifecycle, and **reads** cost and contract terms. The Owner ruling of 2026-08-07 (`docs/assessments/r1-catalog-read-authority-requirement.md`) names the catalog administrator as a cost-read holder. Cost **create** and **edit** stay with Purchasing, so this Role cannot add terms (adding sets cost) or change cost. The cost read is proposed as its own explicit grant, never inferred from catalog administration. |

The PG suite proves the Purchasing bundle (case c) with a fixture Role that holds exactly those keys. It also proves the read, edit and changeStatus combination, and the cost-read combination, that the Inventory Catalog Administrator proposal describes. This runs on a fixture Role, never the real one.

### 6.2 Where it is proven

| Test | Proves |
|---|---|
| `functions/test/governedFieldGroups.test.mjs` | The evaluator, including the record doorway and `canReadAllGroups`. |
| `functions/test/partSupplierTermsPostgres.test.mjs` | Cases (a) to (j): read-only, the multi-Role union, the Purchasing bundle, write-blind oracles, the Protected Administrator through the real resolver, broad manage refused, tenant isolation, audit rows and append-only integrity, error responses, and zero grants. |
| `functions/test/supplierTermsObjectMatrixPostgres.test.mjs` | The Administration Objects matrix: seven actions, kinds and labels; the admin cell `PROTECTED_ADMINISTRATOR` on `supplierTerms.read` only; zero grants. |
| `functions/test/partSupplierTermsEmployeeContractPostgres.test.mjs` with `field-ops-app-vite/test/partSupplierTermsWorkflow.test.jsx` | The screen's requests and the server's answers, `recordAccess` included. |
| `field-ops-app-vite/test/metadataCatalogDefinitions.test.mjs` | Every CONFIDENTIAL field is non-reportable and non-exportable. |
