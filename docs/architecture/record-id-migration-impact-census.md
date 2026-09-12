# Record ID Migration Impact Census

**Status:** CENSUS — a statement of what exists in the integrated tree at `d104cf49`
(all 32 Wave-1 lanes + `eos_finance`). **Nothing here has been migrated.**
**Companions:** `verenward-global-record-identity-standard.md`,
`verenward-object-code-registry-proposed.md`.

---

## 1. What this census found, in one page

**There is no identity standard today. There are seven.**

| # | Strategy | Objects |
|---|---|---|
| 1 | Firestore auto-ID | Work Order, Contact, Location, Opportunity, Sales Agreement, Sales Order, Sales Territory, Coverage Assignment, CRM Activity, Invoice, Invoice Adjustment, Payment, Payment Application, Refund, Reorder Request, Inventory Action, Report Definition, Audit Event (one path), Equipment (import path) |
| 2 | `sha256(idempotencyKey)` with a prefix | Bin `bin_`, Transfer Order `trf_`, Receiving Order `rcv_`/`rcvc_`, Cycle Count Sheet `ccs_`, operational ledger `imv_`, relocation `srl_`, Equipment install `eq_`, Performance Goal audit `pg_` |
| 3 | `sha256(natural key)` | Serialized Asset `sa_<[partId,serialNo]>`, Inbound Work Request `inbound_<mailboxId\|messageId>`, Cycle Count Line `ccl_<partId>`, Email OAuth State `<hash of state>` |
| 4 | Plaintext derived natural key | Part Alias `<aliasType>__<value>`, Equipment Model `<mfr>--<model>`, Part Supplier Item `<partId>__<supplierId>`, Bin Code Claim `binclaim_<wh>__<code>`, counters `<family>_<year>` |
| 5 | Caller-supplied natural key used verbatim as the id | **Part**, **Employee**, **Warehouse**, **Mobile Location**, **Truck**, Supplier, Manufacturer, Performance Goal, Operating Company, Email Connection/Mailbox/Routing Rule |
| 6 | `prefix_randomUUID()` (Postgres side) | `cmt_`, `ccs_`, `ccl_`, `mov_`, `rr_`, `rcv_`, `rcvl_`, `trf_`, `inv_`, `invl_`, `hof_`, `opp_`, `sag_`, `sor_`, `epl_`, `tenant-` |
| 7 | An identity borrowed from another record | Purchase Order **is** the Reorder Request id; PO Void **is** the same id again; Role Assignment **is** the caller's idempotency key |

**Five findings that shape any adoption plan:**

1. **There is no shared ID module.** `const newId = (prefix) => \`${prefix}_${randomUUID()}\`` exists as
   **five byte-identical private copies** (`eosOps/cycleCountRepository.ts:78`,
   `eosOps/inventoryCommitmentRepository.ts:53`, `eosOps/purchasingRepository.ts:62`,
   `eosOps/invoiceAuthority.ts:49`, `eosCommercial/commercialOwnershipRepository.ts:39`), plus two
   more inlined (`employeePrincipalLinkRepository.ts:133`, `adminPolicy/tenantBootstrap.ts:308`) and
   a bare `randomUUID()` variant (`adminPolicy/postgresPolicyRepository.ts:79`). There is **no ULID,
   no Crockford Base32, no nanoid, and no id library in either `package.json`.** Centralising
   generation therefore has seven server insertion points and eight client ones, not one.

2. **Firestore and Postgres already disagree about the same record's id.** Every `eos_ops`
   repository mints `prefix_randomUUID()` *even where the Firestore side has a deterministic hash
   with the same prefix* — `trf_`, `rcv_`, `ccs_`, `ccl_` all exist twice, meaning different things.
   **Bin is the only object where the two planes agree** (`bins_id_is_opaque CHECK (id ~
   '^bin_[0-9a-f]{40}$')`). Every other cutover needs a crosswalk that does not exist today.

3. **Tenancy is bifurcated.** Postgres has a real tenant (`eos_policy.tenants`, `tenant-<uuid>`,
   membership-enforced, `tenant_id` on every table). **Firestore has none at all** — no `tenants`
   collection, no `tenantId` field on any document, no tenant path segment in any of ~57 Rules
   blocks. Tenancy in Firestore is one Firebase project per tenant. Several `eos_*` tables are
   therefore **tenant-local by construction** (`PRIMARY KEY (tenant_id, …)` on `suppliers`,
   `supplier_catalog_items`, `equipment_models`, `trucks`, `mobile_locations`, `bin_code_claims`,
   `work_order_inventory_effects`), which is the single largest structural obstacle to *global*
   identity.

4. **Audit Event document ids double as the platform's idempotency ledger.** This is the highest-risk
   identifier in the system. See §5.1.

5. **The business-number counters can silently reuse numbers.** Confirmed, not theoretical. See §6.

---

## 2. The four identifier kinds, as they actually stand today

The standard's §2 taxonomy is not aspirational — every kind has live examples here.

### 2.1 EOS RECORD ID — machine identity, opaque, immutable

**`Part.partId` is the clearest example in the tree, and the only one enforced at read.**
`functions/src/partMaster/partMasterRepository.ts:102-104`:

```ts
if (data.partId !== docId) {
  throw new MalformedStoredRecordError(`part document ${docId} carries mismatched partId ${String(data.partId)}`);
}
```

The file header says it outright: *"Document identity IS domain identity: parts/{partId}"*. Only
three objects enforce this equality at read — **Part**, **Part Alias**
(`partAliasRepository.ts:82`) and **Equipment Model** (`modelFromFirestore`, which additionally
re-derives the id and checks it round-trips). Employee mirrors `employeeId` into the body and
**enforces nothing**, a gap recorded in its own definition (`employee.js:30-38`).

But `partId` is *not* opaque: it is caller-supplied free text validated only against a pattern
(`partMaster/validation.ts:38-49`), and on the import path it is derived from the business number
(`dataImport/contracts/partImportContract.ts:451-458`). So it is identity that behaves correctly and
*looks* like a business key — which is exactly the confusion the standard removes.

### 2.2 BUSINESS NUMBER — human identity, mutable, meaningful

**`Work Order.woNumber` (`WO-2026-000008`)** is the canonical case, and the tree keeps it correctly
separated: **no foreign key anywhere in this repository points at `woNumber`.** Every consumer
projects it for humans (`salesOrderReadService.ts:286,307`, `ai/workOrderContext.ts:110`); every
reference stores the auto-ID.

**`Part.internalPartNumber` is the clearest proof that business numbers are mutable.** It is in the
explicit update allowlist (`partMasterCommands.ts:281-283`), and changing it **automatically
preserves the prior value as an `INTERNAL_PN` alias** (`partMasterCommands.ts:362-392`). A mutable
key with an alias trail is precisely what a business number is, and precisely what a Record ID must
never be.

**Objects with no business number at all:** Account (`customerNumber` is passthrough, unvalidated,
non-unique), Payment (**none — the largest numbering gap in finance**), Warehouse, Bin, Mobile
Location, Truck, Cycle Count Sheet/Line, Serialized Asset, Inventory Transaction, Inventory Action,
Manufacturer, Sales Territory, Coverage Assignment, Invoice Adjustment, Refund, CRM Activity.

**One object declares a business number that does not exist in the data.** `reorderRequest`'s
EntityDefinition declares `identity: makeIdentity({ referenceField: "reorderRequestNumber" })`, and
`allocateReorderRequestNumber` is written and tested — **and nothing calls it.** The field is absent
from every document and always has been (`reorderRequest.js:172-180`).

### 2.3 LEGACY ID — frozen at cutover, owned by a system being left

**The `IMP-` prefixed account ids** (`dataImport/firestoreDataImportAdapters.ts:226-228`):

```ts
export function deriveImportedAccountId(name: string): string {
  const slug = name.trim().toUpperCase().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `IMP-${slug || "CUSTOMER"}-${shortDigest(naturalIdentityKey(name))}`;
}
```

This is a **Record ID derived from a legacy business name** — the exact anti-pattern the standard
forbids, for the exact reason it forbids it: the account's name is mutable, so the id encodes a fact
that can become false and cannot be corrected.

It is also **overloaded**: `IMP-` is *also* the import **job** id prefix
(`dataImportCallables.ts:232-235`, `IMP-<14-char stamp>-<6-char rand>`), and `customerIdentity.ts:66-69`
names this as *"a genuine collision of meaning in the source data"*. Both forms satisfy
`CRM_ID_PATTERN`, so an account id and a job id are not reliably distinguishable by shape. **This is
the single best argument in the tree for a registered object code.**

Other legacy carriers: `Account.legacyId` / `erpId` / `accountingId` / `customerNumber` (inert
passthrough strings, no integration reads them); `inventory_movements.source_transaction_id` (the
legacy Firestore doc id retained as provenance); `Warehouse.provenance: NATIVE | MIGRATED`;
`imported_service_history` with `sourceSystem: "DATA_IMPORT"` and a doc id of `SH-${idempotencyKey}`.

### 2.4 EXTERNAL ID — owned by a system EOS talks to

**`principals.external_subject`** is the model done correctly, and the migration that created it
states the reason better than this document could
(`1757548800000_tenant-and-identity.sql:54-64`):

> *"Authentication is external and TEMPORARY… If the authorization model's identity were the
> Firebase UID, replacing the provider would mean rewriting every assignment, every access-version
> row and every audit event… So `principals.id` is the EOS-native identifier, and
> `(identity_provider, external_subject)` is the MAPPING."*

**That is the Verenward Global Record Identity Standard, written a year early, for one object.** The
whole of this program is the generalisation of that paragraph.

**The seam is not closed, though.** The Firebase uid still leaks into Firestore *document ids*
(`users/{uid}`) and Firestore *fields* (`employees.userId`, `roleAssignments.principalUid`,
`auditEvents.actorUid`), and `user_role_assignments.principal_uid` /
`principal_access_versions.principal_uid` are deliberately **un-FK'd**.

Other external ids: `Equipment.serialNumber` / `assetTag` (manufacturer- and customer-issued,
**nullable and deliberately NOT unique in Postgres** — *"a UNIQUE constraint here would assert an
invariant the source data has never been held to"*); `PurchaseOrder.externalPoNumber` (the
supplier's own document number, human-transcribed, **not unique, not validated, no generator**);
`SalesOrder.customerPO`; `Payment.externalRef` (optional check/wire number, explicitly *"NOT
identity"*); `inbound_work_requests.messageId` (the provider's message id, and **half of that
record's derived doc id**).

### 2.5 The fifth thing, which is none of the four: idempotency keys

Client code mints `crypto.randomUUID()` idempotency keys in at least eight private copies
(`useOpportunityCreate.js`, `useSalesOrderActions.js`, `usePartIdentifiers.js`,
`useOpportunityTransitions.js`, `useOpportunitySectionSave.js`, `usePartMasterWrite.js`,
`useAgreementCommandRunner.js`, `services/reorderCallableClient.js`), each with a
`k-${Date.now()}-${Math.random()}` fallback.

**Three objects use a client-supplied idempotency key *as their document id*:** `roleAssignments`,
`privilegedRoleRequests`, `accessRequests` (`trustedWriterCommands.ts:824, 1059, 1213, 1323, 1582,
1655, 1867, 2168`). That makes a request de-duplication token into durable platform identity — a
client-chosen string with no shape rule becomes a permanent key. It is the clearest case in the tree
of one identifier kind doing another's job.

---

## 3. The census

Columns: **Def.** = EntityDefinition id (`—` = none exists). **Store** = FS (Firestore) / PG
(Postgres) / both. **PK shape** per §1's seven strategies. **Num.** = business number. **Scope** =
G (global/project-wide) or T (tenant-local by construction). **Diff.** = migration difficulty.
**Code** = proposed object code.

### 3.1 CRM and commercial

| Object | Def. | Store | PK shape today | Num. | Scope | Diff. | Code |
|---|---|---|---|---|---|---|---|
| Account | `account` | FS + PG | auto-ID **and** `IMP-<slug>-<digest>` | none | G / T-scoped FK | **HIGH** | `ACCT` |
| Contact | `contact` | FS + PG | auto-ID | none | G | LOW | `CNTC` |
| Location (site) | `location` | FS + PG | auto-ID | none | G | LOW-MED | `LOCN` |
| Opportunity | `opportunity` | FS + PG | auto-ID / `opp_<uuid>` | `OPP-YYYY-######` | G | MED | `OPPT` |
| Sales Agreement | `salesAgreement` | FS + PG | auto-ID / `sag_<uuid>` | `SA-YYYY-######` | G | MED | `SAGR` |
| Sales Order | `salesOrder` | FS + PG | auto-ID / `sor_<uuid>` | `SO-YYYY-######` | G | MED-HIGH | `SORD` |
| Sales Territory | `salesTerritory` | FS only | auto-ID | none | G | LOW | `STER` |
| Coverage Assignment | **—** | FS only | auto-ID | none | G | LOW | `CCAS` |
| CRM Activity | **—** | FS only | auto-ID | none | G | LOW | `CACT` |
| Ownership Handoff | **—** | PG only | `hof_<uuid>` | none | T | LOW | `OWHF` |

### 3.2 Finance

| Object | Def. | Store | PK shape today | Num. | Scope | Diff. | Code |
|---|---|---|---|---|---|---|---|
| Invoice | `invoice` | FS + PG | auto-ID / `inv_<uuid>` | `INV-000001` **per company** | G id, T+company number | **HIGH** | `INVC` |
| Invoice Line | — | PG | `invl_<uuid>` | none | T | MED | `INLN` |
| Invoice Adjustment | **—** | FS only | auto-ID | none | G | LOW | `IADJ` |
| Payment | `payment` | FS + PG | auto-ID | **none** | G | MED | `PMNT` |
| Payment Application | **—** | FS + PG | auto-ID (**not** derived) | none | G | MED | `PAPP` |
| Refund | **—** | FS only | auto-ID | none | G | LOW | `RFND` |

**Invoice is HIGH** because the number is a legal and financial artifact that cannot be re-derived,
the per-company counter state must migrate intact, and four child families reference the id under
`ON DELETE RESTRICT` with a currency-pinned composite FK.

**`Payment.paymentId` is declared as a field but is not stored** — it *is* the document key. The
definition says so: *"is NOT a stored document field — so nothing can compare a stored value against
the key, and a divergence between the two is undetectable rather than refused."*

### 3.3 Purchasing and supply

| Object | Def. | Store | PK shape today | Num. | Scope | Diff. | Code |
|---|---|---|---|---|---|---|---|
| Supplier | `supplier` | FS + PG | **caller-supplied natural key** | `vendorNumber`, no generator, not unique | G / **T composite PK** | MED-HIGH | `SUPL` |
| Supplier Catalog Item | `supplierCatalogItem` | FS + PG | opaque — **no writer exists** | none | G / **T composite PK** | LOW | `SCAT` |
| Part Supplier Item | **—** | FS | **derived** `${partId}__${supplierId}` | none | G | MED | `PSUP` |
| Manufacturer | `manufacturer` | FS only | **caller-supplied natural key** | none | G | MED | `MANF` |
| Reorder Request | `reorderRequest` | FS + PG | auto-ID / `rr_<uuid>` | `RR-YYYY-######` **allocator unwired** | G | MED | `RORQ` |
| Purchase Order | `purchaseOrder` | FS + PG | **shared — is the Reorder Request id** | `externalPoNumber` (supplier's, not unique) | G | MED | `PORD` |
| Purchase Order Void | `purchaseOrderVoid` | FS + PG | **shared — the same id again** | none | G | LOW-in-isolation | `PVOD` |
| Receiving Order | `receivingOrder` | FS + PG | `rcv_<sha>` **and** `rcvc_<sha>` / `rcv_<uuid>` | `RO-YYYY-######` | G | MED-HIGH | `RCVO` |
| Receiving Order Line | — | PG | `rcvl_<uuid>` | none | T | MED | `RCVL` |

**The Purchase Order / PO Void / Reorder Request triangle is the tightest coupling in the census.**
One string names three documents in three collections, and Postgres enforces it:
`purchase_orders.id TEXT PRIMARY KEY REFERENCES reorder_requests(id)` and
`purchase_order_voids.purchase_order_id TEXT PRIMARY KEY REFERENCES purchase_orders(id)`. None of the
three can be re-keyed independently.

**`purchaseOrder` also has a constant-name trap**: the client's `PURCHASE_ORDERS_COLLECTION` is
`"reorder_purchase_orders"` while the server's is `"purchase_orders"` — the same identifier naming
two different, unrelated collections.

### 3.4 Inventory, warehouse, logistics

| Object | Def. | Store | PK shape today | Num. | Scope | Diff. | Code |
|---|---|---|---|---|---|---|---|
| Part | `part` | FS | **caller-supplied, IS the doc id, read-guarded** | `internalPartNumber` (mutable, alias trail) | G | **HIGH** | `PART` |
| Part Alias | `partAlias` | FS | derived `<type>__<value>` | none | G | LOW (**0 rows**) | `PALS` |
| Inventory Transaction | `inventoryTransaction` | FS + PG | auto-ID **and** `imv_<sha>` | none | G | MED | `IVTX` |
| Inventory Commitment | **—** | PG only | `cmt_<uuid>` | none | T | LOW (greenfield) | `IVCM` |
| Warehouse | `warehouse` | FS + PG | **operator-typed** (`wh-main`) | **none** | G / **T composite** | MED-HIGH | `WHSE` |
| Bin | **—** | FS + PG | `bin_<sha256[0:40]>` — **the one object both planes agree on** | `code`, claim-ledgered | G (tenant-blind, fails closed) | LOW | `BINL` |
| Bin Code Claim | **—** | FS + PG | `binclaim_<wh>__<code>` | — | T | LOW | `BCLM` |
| Bin Placement | **—** | FS | `plc_<key>__<disc>` | none | G | LOW | `BPLC` |
| Stock Relocation | **—** | FS | `srl_<sha>` | none | G | LOW | `RLOC` |
| **Mobile Location** | `mobileLocation` | FS + PG | **operator-typed free text** | none | G / **T typed-pair PK** | **HIGH** | `MLOC` |
| **Truck** | `truck` | FS + PG | **operator-typed free text** | `vehicleNumber` — required, **not unique** | G / **T composite** | MED-HIGH | `TRCK` |
| Transfer Order | `transferOrder` | FS + PG | `trf_<sha>` / `trf_<uuid>` | `TO-YYYY-######` | G | MED | `TORD` |
| Cycle Count Sheet | **—** | FS + PG | `ccs_<sha>` (v2) / `cyc_` (v1 frozen) / `ccs_<uuid>` | none | G | MED | `CCSH` |
| Cycle Count Line | **—** | FS + PG | `ccl_<sha(partId)>` — **unique only within its sheet** | none | sheet-local | MED | `CCLN` |
| Serialized Asset | **—** | FS + PG | `sa_<sha([partId, serialNo])>` | `serialNo` (manufacturer's) | G / T natural unique | MED | `SRLA` |
| Inventory Action | `inventoryAction` | FS | auto-ID — **writer retired, throws** | none | G | LOW | `IVAC` |
| Stock Location | `stockLocation` | **retired** | was `<wh>__<part>__<bin>` | — | — | LOW | `SLOC` |

**Stock Location is retired in the data and alive in the metadata.** The constant, the Rules block,
the composite index and the rows are all gone (migration 008, proven by
`test/eosOpsWarehouseBinAuthority.test.mjs`). But `definitions/stockLocation.js` is still registered
in `entityRegistry.js` at lines 47 and 79, the `warehouse.stockLocation.read` capability is still
seeded, and `ownershipDerivation.ts:80` / `ownershipMatrix.ts:328` still declare the family. **This
is dead metadata pointing at a collection that no longer exists**, and it is the cheapest cleanup in
the census.

**Cycle Count Line ids are not globally unique** — `ccl_` is derived from `partId` alone, and
uniqueness comes entirely from the subcollection path. Flattening lines out of the subcollection
requires re-keying every one of them.

### 3.5 Service operations, equipment, people

| Object | Def. | Store | PK shape today | Num. | Scope | Diff. | Code |
|---|---|---|---|---|---|---|---|
| Work Order | `workOrder` | FS only | auto-ID | `WO-YYYY-######` — **counter-loss hazard, §6** | G (**no company segment**) | MED | `WKOR` |
| Equipment | `equipment` | FS + PG | `eq_<sha>` (install) **and** auto-ID (import) | none enforced | G / T + company key | MED-HIGH | `EQIP` |
| Equipment Model | `equipmentModel` | FS + PG | derived `<mfr>--<model>`, **double read-guard** | `modelNumber`, not unique | G / **T composite PK** | MED | `EQMD` |
| Imported Service History | **—** | FS | `SH-${idempotencyKey}` | none | G | LOW | `ISVH` |
| **Employee** | `employee` | FS (+ PG link only) | **operator-typed free text, no read-guard** | `employeeNumber` — **claim-doc registry** | G / T on the link | **HIGH** | `EMPL` |
| Employee–Principal Link | **—** | PG only | `epl_<uuid>` | none | T | LOW | `EPLK` |
| Performance Goal | **—** | FS only | caller-supplied, version-chained | none | G | LOW-MED | `PGOL` |

**`employee_number_registry` is the pattern the whole platform should copy.** Uniqueness of
`employeeNumber` is enforced by a *claim document* keyed on the case-folded value
(`employeeProfileCommands.ts:96, 161-163`), for the reason stated there:

> *"transactional isolation covers the documents a query MATCHED, not the ones that did not exist
> when it ran… A document id has no phantom: a read of `employee_number_registry/TAZ-0042` locks
> that exact key whether it exists or not."*

**That is exactly the guarantee `woNumber` lacks** (§6).

### 3.6 Email intake

| Object | Def. | Store | PK shape today | Scope | Diff. | Code |
|---|---|---|---|---|---|---|
| Email Connection | **—** | FS | caller-supplied **or** auto-ID | G | MED | `EMCN` |
| Email Mailbox | **—** | FS | caller-supplied **or** auto-ID | G | **HIGH** | `EMBX` |
| Email Routing Rule | **—** | FS | caller-supplied **or** auto-ID | G | LOW | `EMRR` |
| Inbound Work Request | **—** | FS | `inbound_<sha256(mailboxId\|messageId)>` | G | MED | `IWRQ` |
| Email Delivery Failure | **—** | FS | caller-supplied | G | LOW | `EMDF` |

**Email Mailbox is HIGH and the reason is non-obvious:** `mailboxId` is **half the Inbound Work
Request's derived document id**. Re-keying a mailbox would cause every already-ingested message to
re-ingest under a new `inbound_<digest>` id, defeating the platform's strongest de-duplication
guarantee. Email Connection is MED for the analogous reason — the credential vault is keyed by
`connectionId`.

### 3.7 Platform administration

| Object | Store | PK shape today | Scope | Diff. | Code |
|---|---|---|---|---|---|
| Tenant | PG only | `tenant-<uuidv4>`, natural key `tenants.key` UNIQUE | root | **HIGH** (FS has none) | `TNNT` |
| Operating Company | FS (inert) | **hard-coded slugs in source** (`taylor`, `ventana`) | G | LOW | `OPCO` |
| Principal | PG | `<uuidv4>`, `UNIQUE (identity_provider, external_subject)` | G | **HIGH** | `PRIN` |
| Tenant Membership | PG | `<uuidv4>`, `UNIQUE (tenant_id, principal_id)` | T | LOW | `TMEM` |
| Role | PG **+ 31 camelCase literals in source** | `<uuidv4>` / `UNIQUE (tenant_id, key)` | T | MED | `ROLE` |
| Role Assignment | FS + PG | **the client's idempotency key** / `<uuidv4>` | G | MED | `RASG` |
| Object Definition | PG | `<uuidv4>`, `UNIQUE (tenant_id, key)` | T | LOW | `OBJD` |
| Field Definition | PG | `<uuidv4>`, `UNIQUE (tenant_id, object_id, key)` | T | LOW | `FLDD` |
| Workflow / Version / Instance | PG | `<uuidv4>` + tenant-local natural keys | T | LOW | `WKFL`/`WFVR`/`WFIN` |
| **Audit Event** | FS + PG | **auto-ID *or* content-derived** | G / T | **HIGHEST** | `AUDT` |
| Data Import Job | FS | `IMP-<stamp>-<rand>` | G | LOW | `IMPJ` |
| Report Definition | FS | auto-ID | G (per owner) | LOW | `RPTD` |
| Counters | FS | `<family>_<year>` / `invoices_<companyId>` | G | LOW to move, **HIGH to make safe** | — |

**Personas do not exist as records.** A "persona" in this tree is vocabulary for a role-shaped test
actor, and `assistantEvaluation.ts:20-21` makes it concrete: `personaEmployeeId` — *a persona IS an
Employee id*. Nothing to inventory, nothing to migrate.

**Permission Sets do not exist as records either.** There is a capability catalog of dotted string
literals in source (`access/permissionCatalog.ts`), Postgres `capabilities` / `role_capabilities`,
and per-role CRED grids. No `permission_sets` table.

**There is no decision ledger.** `docs/DECISIONS.md` is a Markdown file referenced by number from
source comments. A repo-wide search for `decision.*ledger|decisionLedger|decision_ledger` returns
zero hits.

### 3.8 Records that should NOT receive an EOS Record ID

Recorded deliberately, because giving these a Record ID would be a regression.

| Record | Why not |
|---|---|
| `counters/<family>_<year>` | the id **is** the semantics — a derived, addressable key. An opaque id would make the counter unfindable. |
| `employee_number_registry/<number>` | a **claim document**. The whole guarantee is that the key is the claimed value, so the read locks a key that may not exist. |
| `bin_code_claims`, `location_truck_claims` | same claim-document pattern. |
| `email_oauth_states` | ephemeral, single-use, deliberately keyed by the **hash** of the state value so the value is never stored. |
| `inventory_sync_status/{workOrderId}` | a 1:1 side-record keyed by its parent; its identity *is* the parent's. |
| `tenant_admin_bootstraps` | `tenant_id` **is** the PK, and that is what makes "one-time" a database constraint rather than a check. |
| `work_order_inventory_effects` | `PRIMARY KEY (tenant_id, work_order_id, state)` — *"the state IS part of the identity"*. A surrogate would let two rows claim one state. |
| Invoice / order / receipt **lines** | unsettled — see the standard §14.4. |

---

## 4. Foreign-key blast radius

Measured by reference-site count where the census counted them.

| Id | Sites | Where it lands |
|---|---|---|
| `warehouseId` | **412** | every ledger row's `location.locationId`, transfer from/to, receiving location, cycle count location, `bins`, `trucks.homeWarehouseId`, reorder requests, `employees.assignedWarehouseIds`, PG `inventory_movements.location_id` |
| `truckId` | **240** | `location_truck_claims`, employee/driver crosswalks, consumption source selection, transfer receivable reads, PG `trucks` |
| `reorderRequestId` | **168** | `receiving_orders.sourceReorderRequestId`, `reorder_purchase_orders/{id}` (id-as-key), PO void, receiving transitions, PG purchasing |
| `transferOrderId` | **130** | ledger movement keys (`trfmv_`, `trfmvsn_` are **derived from it**), `sourceObject.id`, offline intents |
| `sheetId` (cycle count) | **118** | ledger keys (`cycmv_` derived from it), lines subcollection, PG `cycle_count_lines.sheet_id` |
| `serializedAssetId` | **111** | work-order equipment, install commands, sales order/agreement/opportunity, cycle count, receiving, custody |
| `accountId` | wide | contacts, locations, equipment, work orders, opportunities, agreements, sales orders, invoices, payments, refunds, CRM activities, coverage assignments |
| `employeeId` | wide | `users/{uid}.employeeId`, `fieldops_wos.assignedTechId`, `sales_orders.ownerEmployeeId`, `opportunities.owner`, `roleAssignments`, `employee_principal_links`, role hierarchy `managerId` |
| `partId` | wide | part aliases, part supplier items, inventory transactions, PG movements/commitments/catalog, equipment compatibility, reorder requests, WO parts plans, cycle count lines, serialized assets |

**The derived-ledger-key pattern is a hidden multiplier.** Transfer, receiving and cycle-count ledger
movement ids are `sha256` **of the parent id**:

```
trfmv_   = sha256([transferOrderId, suffix])
recvln_  = sha256([receivingId, lineId])
cycmv_   = sha256(["cycle-count-line", sheetId, ...])
```

Re-keying a parent therefore does not merely update a column — it changes the **identity of every
ledger row that parent produced**. Any conversion of Transfer Order, Receiving Order or Cycle Count
Sheet must either freeze the old derived ids (breaking the derivation invariant) or re-key the
ledger (forbidden). This is the strongest single argument for the standard's forward-only posture.

---

## 5. The hardest migrations, named

### 5.1 Audit Events — **the hardest, and it is not close**

`auditEvents` has two id paths by design (`access/auditEventWriter.ts:780` auto-ID, `:812`
caller-supplied), and **the caller-supplied path is the platform's idempotency substrate**: the
audit document's *existence* is the single source of truth for "was this call already applied."

```ts
// workOrderCreateMath.ts:10
export function createWorkOrderAuditId(actorUid: string, scope: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(`${actorUid}|${scope}|${idempotencyKey}`).digest("hex").slice(0, 40);
  return `createWorkOrder_${digest}`;
}
```

Used by at least eight command families (`trustedWriterCommands.ts:561`,
`employeeProfileCommands.ts:508`, `partMasterCommands.ts:248`, `performanceGoalCommands.ts:258`,
`coverageCallables.ts:37`, the commercial and finance callables, Data Import).

**Replacing these with random Record IDs silently re-enables replays.** A retried create would hash
to nothing, find no prior audit doc, and mint a second Work Order — burning a WO number and
creating a duplicate. The idempotency mechanism must be replaced *first*, as its own change with its
own proof, before audit identity can be touched. Until then, `AUDT` is registered and unused.

### 5.2 Part — identity that is also a business key

`partId` **is** the document id, is enforced equal to the body field at read, is what barcode and
alias resolution terminates at, and is referenced by roughly ten collections and tables. It is also
caller-supplied free text derived from `internalPartNumber` on the import path. Any re-key must
rewrite the document id and the body atomically or every subsequent read throws
`MalformedStoredRecordError`.

### 5.3 Employee, Principal, and the Firebase uid — three ids for one human

- Firestore `users/{uid}` — the **Firebase Auth uid is the document id**.
- Firestore `employees/{employeeId}` — **operator-typed free text**, mirrored into the body with
  **no enforcement**, the only writer a CLI script (`provisionEmployeeAccess.js:341`, example
  `--employeeId emp-001`).
- Postgres `principals.id` — a UUID, with `(identity_provider, external_subject)` as the mapping.

The uid leaks into `employees.userId`, `roleAssignments.principalUid` and `auditEvents.actorUid`, and
`user_role_assignments.principal_uid` is **deliberately un-FK'd**. Postgres already has the right
model; Firestore has not adopted it. This is the migration with the most surfaces and the least
structural help.

### 5.4 Mobile Location and Truck — operator-typed keys written into every ledger row

`functions/src/truckRegistry/validation.ts:16-18` is the entire validation:

```ts
const ID_MAX = 200;
const isId = (v: unknown): v is string => isNonEmptyString(v) && v.length <= ID_MAX && v === (v as string).trim();
```

Non-blank, trimmed, ≤200 characters. No charset rule, no format, no generator. A human types it into
a text input (`CreateTruckModal.jsx:64-81`). The Postgres migration states it flatly: *"Operator-typed
free text, carried across unchanged. No format is imposed."*

And the MOBILE `locationId` is written **verbatim into every MOBILE ledger row for all history**.
Renaming or normalising it rewrites the ledger. Truck adds a 1:1 structural coupling to the equally
free-text Mobile Location id and a `vehicleNumber` that is required but **not unique**.

### 5.5 Warehouse — 412 reference sites, no business number, and import resolves by name

`warehouseId` is operator-typed (`wh-main`, `wh-satellite`), has **no business number at all** to
fall back on, and is embedded as a raw string in every ledger row, transfer, receipt and count. The
Postgres target imposes `CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')` that arbitrary historical
slugs may violate, and the Firestore-global / Postgres-`(tenant_id, id)` mismatch is a genuine
semantic divergence.

Data Import already understands the problem and refuses to guess
(`firestoreInventoryImportAdapters.ts:261-291`): it resolves warehouses **by name**, and the code
says why — *"A file cannot carry the id half itself: EOS warehouse ids appear on no spreadsheet an
operator has."* That is the correct posture and it survives the standard unchanged.

### 5.6 Account — two id shapes and the widest fan-out in the system

Auto-ID from the UI path, `IMP-<slug>-<digest>` from the import path, in the same collection. The
widest inbound FK fan-out of any object. And an explicit repo-wide rule that ids are carried verbatim
and never re-minted (`crm/customerIdentity.ts:84-93`).

### 5.7 Tenant — Firestore has none

Introducing a tenant id into Firestore means touching all ~57 collections, every doc-id scheme, every
Rules block and every counter key. **This is not a Record ID problem and the standard does not solve
it** — the standard removes tenant *from* the id, which is the opposite direction. It is recorded
here because "global identity" presumes a tenant model, and on one of the two data planes there
isn't one.

### 5.8 The composite-key `eos_*` tables

`suppliers (tenant_id, supplier_id)`, `supplier_catalog_items (tenant_id, part_id, supplier_id)`,
`equipment_models (tenant_id, id)`, `trucks (tenant_id, truck_id)`,
`mobile_locations (tenant_id, location_type, location_id)`, `bin_code_claims (tenant_id,
warehouse_id, code)`, `work_order_inventory_effects (tenant_id, work_order_id, state)`.

These are **tenant-local identities by deliberate design**, each with a rationale written into its
migration. Converting them to a global surrogate is the largest single piece of work implied by
"global identity", and each needs its own decision about whether global identity is worth it. Some
of them — `work_order_inventory_effects` especially — should probably never convert (§3.8).

---

## 6. The counter-loss hazard — confirmed, systemic, and not a Record ID problem

The brief asked whether the Work Order counter can silently reuse numbers. **It can.**
`functions/src/woNumbering.ts:80`:

```ts
const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;
```

If `counters/work_orders_2026` is deleted, restored from a stale backup, or the project is restored
into a fresh Firestore, the next allocation returns `1` and mints `WO-2026-000001` a second time.
There is:

- no read of `fieldops_wos` to find the maximum existing `woNumber`;
- no uniqueness constraint (Firestore cannot enforce one on a non-id field);
- **no claim collection** — contrast `employee_number_registry`, which solves exactly this;
- no Rules or index check (`firestore.rules:506-516` denies all writes and even reads on `counters`).

The module header's claim — *"Never reused: sequence is read and incremented inside the SAME
transaction"* — is true **only for concurrency**. The transaction guarantees no two *concurrent*
callers get the same number. It guarantees nothing about a counter that no longer exists.

**The hazard is systemic.** The identical shape exists in all eight allocators: `work_orders_{year}`,
`opportunities_{year}`, `sales_orders_{year}`, `sales_agreements_{year}`, `transfer_orders_{year}`,
`receiving_orders_{year}`, `reorder_requests_{year}`, `invoices_{companyId}`.

**And the one piece of collision-aware code in the repository does not cover Work Orders.**
`functions/scripts/backfillOperationalNumbering.mjs:205-210` builds a set of already-used numbers and
refuses on `DUPLICATES_EXISTING_NUMBER` — for `sales_orders`, `transfer_orders`, `receiving_orders`
and `reorder_requests` only.

**Receiving Order has a second, sharper variant.** Its allocator returns a `PendingCounterWrite`
instead of committing, because the receiving command buffers all writes, and the module says what
happens if the caller drops it (`receivingOrderNumbering.ts:74-77`): *"an allocated number whose
counter write is dropped would be reissued on the next allocation for the same year, defeating the
whole 'never reused' guarantee."*

**This is a BUSINESS NUMBER defect, not a Record ID defect, and the distinction is the point.** The
Record ID standard does not fix it and must not be sold as fixing it. It is recorded here because it
is the strongest evidence in the tree for why the two identifier kinds must be kept apart: the
business numbers are the fragile, meaningful, human-facing, reusable-by-accident ones, and they are
carrying identity weight they were never built to carry.

The fix is independent and cheap: apply the `employee_number_registry` claim-document pattern to each
number series, or add a max-existing check to each allocator. It should be done regardless of what
happens to record identity.

---

## 7. Objects with no EntityDefinition

Sixteen first-class or near-first-class records have no registered EntityDefinition, so they are
invisible to the Administration Objects surface, the permissions grid, and every consumer that asks
"which objects exist":

Coverage Assignment · CRM Activity · Invoice Adjustment · Payment Application · Refund · Ownership
Handoff · Bin · Bin Code Claim · Bin Placement · Stock Relocation · Cycle Count Sheet · Cycle Count
Line · Serialized Asset · Inventory Commitment · Part Supplier Item · Performance Goal · the five
email-intake records · Imported Service History · Employee–Principal Link.

Several are leaves with no inbound references, which is likely *why* they were never registered. The
registry proposes codes for all of them anyway: **a code costs nothing and reserves the name**, and
the alternative is discovering the omission when someone else takes the obvious four letters.

Conversely, `stockLocation` **is** registered and points at a collection that no longer exists
(§3.4).

---

## 8. External integration exposure — much narrower than assumed

This matters because it bounds the blast radius of any identity change.

| Surface | Reality |
|---|---|
| `integrations/` | exactly one thing: `chatgpt-eos-intake`, a GitHub-backed artifact intake service. **No business records.** |
| `functions/src/eosApi/server.ts` | **not deployed** — its own header says *"there is no Render service."* |
| `functions/src/dataImport` | five entity types, **sandbox-only** — the production project is refused by name before any lookup (`importTargetGuard.ts:146-152`) |
| CSV paths | Contact import (client-direct, outside the governed pipeline) and bin labels. That is all. |
| Reporting | `reportCatalog.ts` exposes `location`, `reorderRequest`, `purchaseOrder`, `inventoryAction`, and the `customer.externalIds` field group behind `report.customer.field.externalIds.read` |
| QuickBooks / ERP | **none.** `erpId`, `accountingId`, `legacyId` are inert passthrough strings reserved for an integration that does not exist |
| Email providers | Microsoft Graph and Gmail — the one genuinely external id surface, and it is a **message id**, correctly kept as an external id |

**No EOS Record ID is currently exposed to any third party.** That is a substantial and temporary
advantage: identity can be settled before anyone outside the platform depends on it. It also softens
the hand-entry and read-aloud arguments in the standard (open question §14.2), and it is the reason
the forward-only adoption posture is affordable at all.

---

## 9. What an adoption program would do first, in order

Not authorised, not scheduled — the ordering implied by the findings above.

1. **Close the counter-loss hazard** (§6). Independent of record identity, cheap, and the pattern
   already exists in the tree.
2. **Delete the dead `stockLocation` metadata** (§3.4). Pure cleanup, zero risk.
3. **Write the identity library** with no call sites, and the crosswalk and tombstone schemas with no
   rows. Nothing changes; the primitives exist.
4. **Consolidate the seven `newId` copies** onto one module, still minting exactly what they mint
   today. No id changes value; the insertion point for a future change becomes one place instead of
   seven.
5. **Adopt VGRIS on new objects only.** First real ids, no existing data touched.
6. **Convert the cheap leaves** — Part Alias (zero rows), CRM Activity (capability-denied), Coverage
   Assignment, Invoice Adjustment, Refund, Sales Territory. Each proves the crosswalk machinery on a
   record nothing references.
7. **Replace the audit-id idempotency mechanism** before touching audit identity (§5.1). This is its
   own change with its own proof and probably its own quarter.
8. **Everything in §5 after that**, one object at a time, each with its own decision about whether
   conversion is worth it at all.
