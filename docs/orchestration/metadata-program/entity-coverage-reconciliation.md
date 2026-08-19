---
artifact_type: reconciliation
status: FINAL — A-ENTITY-MASS-DEFINITION final reconciliation; classification and evidence only, no code
date: 2026-08-18
workstream: EOS Metadata-to-Platform Program (A-ENTITY-MASS-DEFINITION, phase 7)
related:
  - docs/orchestration/metadata-program/LEDGER.md
  - docs/orchestration/metadata-program/ledger.json
  - docs/architecture/equipment-part-compatibility.md
  - docs/assessments/commercial-coverage-territory-authority-model.md
  - docs/roadmaps/business-capability-register.md
---

# Entity coverage reconciliation — the 22 uncovered collections

## 0. Method and premise

26 Firestore collections now have a merged `EntityDefinition` under
`field-ops-app-vite/src/metadata/definitions/`. This document answers, for the 22 collections
that do not, **not** "does a definition exist" but **"does one belong."** A collection existing in
`firestore.rules` is not evidence that it needs a user-facing entity — several of the 22 are
infrastructure, authority tables, audit trails, or internal joins that this program's own
established pattern (see `equipment.js`, `purchaseOrder.js`, `inventoryTransaction.js`,
`receivingOrder.js` headers) already treats as out of scope for definition, or defines with
`identity: SYSTEM_ONLY` / `readVia: "UNKNOWN"` rather than pretending at a name.

Every claim below is grounded in a direct read of `functions/src`, `field-ops-app-vite/src`, and
`firestore.rules` (root copy and `field-ops-app-vite/firestore.rules` are byte-identical — `diff`
confirms). Four parallel research passes plus direct verification produced the evidence; anything
that could not be established from the code says so explicitly rather than inferring.

**One load-bearing precedent, established directly from the merged definitions and used throughout
this reconciliation:** `receivingOrder.js` is a MERGED entity definition (`S-COM-RECEIPTS`-adjacent
lane) whose collection is `allow read, write: if false` in Rules, with `readVia: "UNKNOWN"` and
`readCallable: null` — the definition's own header explains that inventing a callable that doesn't
exist would be dishonest, so it declares the true state instead. **A missing read path is therefore
not, by itself, a bar to DEFINE** — the program's own convention allows an entity to be defined with
an honestly-declared `UNKNOWN` read path. What blocks DEFINE is the absence of a genuine, governed
**write** authority and an honestly-establishable **identity**, or a decision (Rules, capability
activation, business-identity semantics) that only Owner authority can make.

## 1. Findings by collection

### 1.1 `commercial_coverage_assignments` — BLOCKED_PROTECTED

- **Writer:** `functions/src/coverage/coverageCallables.ts` `createCoverageAssignment`, exported at
  `functions/src/index.ts:64`. Real, deployable code — but gated by capability `coverage.write`
  (`functions/src/access/permissionCatalog.ts`), registered `active: false`. `requireCoverageWrite()`
  fails closed for every caller. No client UI calls it (zero references to `createCoverageAssignment`
  in `field-ops-app-vite/src`).
- **Reader:** `functions/src/coverage/coverageReadCallables.ts` `resolveCoverageForContext`, exported
  `functions/src/index.ts:67`, gated by `coverage.read` (also `active: false`). Trusted-callable-only
  by design; `firestore.rules:1796-1798` is deny-all.
- **Identity:** No human-typed name on the assignment record itself — `assignee.assignedToEmployeeId`
  (Employee reference), `scope {kind, value}`, `responsibility`, `priority`, `effectiveFrom/To`. The
  sibling `sales_territories` collection carries a human `name`; this join-shaped record does not.
- **Human-facing?** Indirectly (a Sales Ops person reviews "who covers this scope"), but it is a
  people×scope×date assignment table, not a record looked up by its own name.
- **Decisive evidence:** `docs/roadmaps/business-capability-register.md` item #15, status
  `IDENTIFIED`, explicit instruction: *"RECORD + preserve seams; do NOT build during the current
  runway."* Real persistence has since been built under a narrower, later authorization ("records
  only — no precedence/credit/commission," per code comments) without reversing that roadmap
  instruction. The precedence/credit/commission questions the roadmap defers are exactly what would
  make an assignment record meaningful to browse. **Decision needed:** activate `coverage.read` /
  `coverage.write`, or explicitly authorize scoping a metadata definition ahead of that activation.

### 1.2 `counters` — EXEMPT

- **Writer:** Seven independent numbering allocators through one `COUNTERS_COLLECTION` constant
  (`functions/src/constants/collections.ts:7`): `functions/src/woNumbering.ts:31` (WO-YYYY-######),
  `functions/src/salesOrder/salesOrderNumbering.ts:44-45` (SO-), `functions/src/opportunity/
  opportunityNumbering.ts:53-54` (OPP-), `functions/src/inventoryTransfer/
  transferOrderNumbering.ts:43-44` (TO-), `functions/src/inventoryReceiving/
  receivingOrderNumbering.ts:46-47` (RO-), `functions/src/reorderRequest/
  reorderRequestNumbering.ts:52-53` (RR-), `functions/src/finance/invoiceNumbering.ts:20`
  (INV-######). Every one is LIVE, part of a merged, deployed create command.
- **Reader:** None outside each allocator's own read-increment-write transaction.
- **Rules (`firestore.rules:482-485`):** `allow read: if false; allow create, update, delete: if
  false;` — Admin-SDK-only.
- **Identity:** Doc id is a deterministic infrastructure key (`work_orders_2026`,
  `invoices_<companyId>`); fields are `{year, sequence, updatedAt}`. No name, no reference of its
  own — it *produces* the references other entities carry.
- **Human-facing?** No. Nobody looks up a `counters` document; they look up the `WO-2026-000123` it
  produced. Confirms the memory note verbatim.

### 1.3 `cycle_counts` — BLOCKED_DEPENDENCY

- **Writer:** `functions/src/cycleCount/cycleCountCallables.ts` (`createCycleCount`,
  `submitCycleCount`, `reconcileCycleCount`, `cancelCycleCount`), exported
  `functions/src/index.ts:203-212`, wired into a LIVE route (`App.jsx:33,438` →
  `modules/inventory/CycleCounts.jsx` → `hooks/useCycleCountActions.js` →
  `cycleCountCommandClient`). Unlike the compatibility trio below, this UI path is reachable — but
  every `inventory.cycleCount.*` capability is registered `active: false` and granted to no Role
  (`functions/src/index.ts:204` comment), so every real invocation fails `noQualifyingGrant`.
- **Reader:** **None exists at all** — not merely inactive. `useCycleCountActions.js:12-21`: *"THERE
  IS NO CLIENT READ PATH for cycle_counts... this hook keeps the workspace's list of cycle counts
  entirely in LOCAL component state"* populated only from each write-callable's own response,
  explicitly declining to invent an `inventory.cycleCount.read` capability. `firestore.rules:1218-
  1219` is deny-all.
- **Identity:** Doc id = `"cyc_" + sha256(idempotencyKey).slice(0,40)` — pure system id. Fields:
  `partId`, `trackingMode`, `location`, `expectedQuantity`/`expectedSerialNumbers`, actor. No name
  field.
- **Human-facing?** Borderline — the CycleCounts workspace is a working tool for a Warehouse
  Manager, but the record itself carries no name or reference a person would type or search for.
- **Why BLOCKED_DEPENDENCY, not BLOCKED_PROTECTED, and not DEFINE-with-UNKNOWN like
  `receivingOrder.js`:** the `receivingOrder.js` precedent works because a genuine WRITE authority
  exists and is at least reachable in principle once a Rules/capability decision is made. Here the
  write capability is inactive (same as several BLOCKED_PROTECTED items below) **and** the read side
  has no code at all — no read service, no capability id, nothing to activate. The missing thing is
  a governed `inventory.cycleCount.read` capability plus a read callable/service, neither of which
  exists in the repository today; building that is an engineering dependency this lane does not own,
  distinct from the pure activation decisions elsewhere in this document.

### 1.4 `databases` — STALE

- **Not a collection.** `firestore.rules:3-4`: `service cloud.firestore { match
  /databases/{database}/documents {`. This is the standard Rules-language wrapper — `{database}` is a
  path variable bound to the physical Firestore database name (`(default)`), not an app-defined
  collection; every other `match` block in the file nests inside it.
- Exhaustive grep of `functions/src`, `field-ops-app-vite/src`, `scripts/`, and `docs/` for
  `collection("databases")` or equivalent returns nothing.
- **Decisive evidence:** whatever process produced the "22 uncovered collections" list evidently
  scraped `match /` path segments out of `firestore.rules` and picked up the wrapper's own bound
  variable as if it were a collection name. This is a parser artifact, not a real gap. **STALE by
  construction — there is nothing to define.**

### 1.5 `equipment_compatibility_operations` — EXEMPT

- **Writer:** `functions/src/equipmentCompatibility/operationRepository.ts` (two-phase
  initiate/terminal state machine), collection constant
  `functions/src/equipmentCompatibility/repository.ts:22`. **No `onCall` wrapper exists anywhere for
  this write path**, and `functions/src/index.ts` has zero exports referencing "Compatibility" —
  confirmed by grep. Unreachable from any deployed surface, by explicit D4-gate design (see §1.7).
- **Reader:** None.
- **Rules (`firestore.rules:1736-1738`):** deny-all.
- **Identity:** Doc id = the caller's raw `idempotencyKey`; fields are `actorUid`, `action`,
  `targetType`, `targetId`, `commandFingerprint`, `status`, `initiatedAt`/`terminalAt` — an
  idempotency/audit log, no name field, ever.
- **Human-facing?** No — explicitly a "client-closed operation state machine" per the D4
  specification (`docs/implementation-plans/equipment-compatibility-d4-trusted-persistence.md`),
  never surfaced to a person even once the program activates.

### 1.6 `equipment_compatibility_sources` — EXEMPT

- **Writer:** `functions/src/equipmentCompatibility/compatibilityRepository.ts` (line 106: *"IMMUTABLE
  evidence"*), collection constant `repository.ts:21`. Same status as §1.5 — no `onCall` wrapper, no
  `index.ts` export, dormant by D4 design.
- **Reader:** The D5 read service (`equipmentCompatibilityReadCallable.ts`) is scoped to compatibility
  and model data, not source evidence specifically, and is itself unexported (see §1.8).
- **Rules (`firestore.rules:1732-1734`):** deny-all.
- **Identity:** Doc id = `sourceId`, a deterministic hash (D2 contract). Fields:
  `authorityType`, `sourceReference`, `sourceVersion`, `observedClaim`, `contentFingerprint`,
  `capturedAt/By`, `notes` — free-text evidence fields, not an identity/lookup name.
- **Human-facing?** No — the architecture doc (`docs/architecture/equipment-part-compatibility.md`
  §4.3) is explicit: *"Verification is a governed decision on the relationship, while evidence remains
  immutable provenance."* A source record is provenance attached to a relationship, never itself
  browsed by name.

### 1.7 `equipment_model_aliases` — BLOCKED_PROTECTED

- **Writer:** `functions/src/equipmentCompatibility/equipmentModelRepository.ts:185-188`. Same
  situation as §1.5/§1.6 — pure repository code, no `onCall` wrapper, no `index.ts` export. A
  client-side import/validation module (`field-ops-app-vite/src/domain/
  equipmentCompatibilityImport.js`) exists but has zero UI importers (only its own test file) —
  confirmed dormant.
- **Reader:** The D5 read callable is unexported (see §1.8). No path.
- **Rules (`firestore.rules:1724-1726`):** deny-all.
- **Identity — the strongest candidate of the compatibility group.** Doc id =
  `encodeModelAliasDocId(aliasKey)` where `aliasKey = "<aliasType>|<manufacturerId>|<rawValue>"`.
  `rawValue` is genuinely **human-typed** — a manufacturer's alternate/historical model number a
  parts person or technician would search by. The alias identity contract is exact, cited from
  `functions/src/equipmentCompatibility/domain/equipmentModel.ts`: `MODEL_ALIAS_VALUE_MAX = 120`
  (chars on the normalized value), `FIRESTORE_DOC_ID_MAX_BYTES = 1500` (the encoded key's hard
  ceiling), and `encodeModelAliasDocId` percent-encodes `%` first, then `/` — mirroring the governed
  Part Master alias pattern (`functions/src/partMaster/partAliasRepository.ts
  encodeAliasDocId`, ADR-008 / Decision #40). This confirms the memory note's "120 chars/1500
  bytes/percent-encode" contract verbatim.
- **Human-facing?** Yes, in intent — this is precisely a cross-reference lookup a person performs.
  Currently unreachable in practice.
- **Decisive evidence for the classification:** `docs/architecture/equipment-part-compatibility.md`
  §10 lays out D0–D11 as separate, individually-gated authorization steps; only D0/D1 are
  Owner-approved (§13). D4 (trusted persistence, this collection's write side) and D5 (read service)
  are both merged as **repo-only, PENDING, NOT AUTHORIZED** implementation-authorization packages
  (`docs/implementation-plans/equipment-compatibility-d4-trusted-persistence.md`,
  `-d5-read-service.md` front matter). Deployment (D10) and production data (D11) are separate,
  unstarted, explicitly protected gates. **Decision needed:** Owner authorization to advance past D5
  toward D10 (Rules/Functions export/capability activation) — a Tier-2 decision this lane cannot make.

### 1.8 `equipment_part_compatibility` — BLOCKED_PROTECTED

- **Writer/Reader/Rules:** Same D4/D5-gated, fully dormant status as §1.7 — repository code exists
  (`compatibilityRepository.ts`), no `onCall` wrapper, no export, `firestore.rules:1728-1730` deny-all.
  `equipmentCompatibilityReadCallable.ts` (D5) exists but is confirmed **not exported** anywhere in
  `functions/src/index.ts` (zero "Compatibility" matches).
- **Identity:** Doc id = `compatibilityId`, "a deterministic opaque hash of a versioned normalized
  tuple" (repository.ts header) — pure system id, never human-typed, re-derivable from content.
- **Human-facing?** Not standalone. The architecture doc's own read-model plan (§7) shows this
  relationship surfaced only as a composed "Used In Equipment" section under Part Detail, never as an
  independently browsed record — but it carries real business content (`compatibilityType`,
  `assembly`, `verificationStatus`, `applicability`) closer in shape to `partAlias.js`/
  `supplierCatalogItem.js` (both already-merged relationship-with-attributes entities) than to a pure
  join. **Classified BLOCKED_PROTECTED rather than EXEMPT** because, unlike `equipment_compatibility_
  sources`/`_operations`, this collection *is* the kind of relationship record the program already
  defines elsewhere once its production gate clears — the blocker is D10 authorization, not the
  record's nature. Same decision as §1.7 unblocks this one.

### 1.9 `fieldops_jobs` — STALE

- **Writer(s):** `field-ops-app-vite/src/domain/jobActions.js` `createJob()`/`updateJobStatus()`
  (client-direct) and `functions/src/completeAssignedJob.ts` (trusted callable). Still LIVE for a
  narrow technician self-completion remnant.
- **Reader:** `field-ops-app-vite/src/hooks/useAssignedJobs.js`, scoped
  `where("technicianId","==",technicianId)`.
- **Rules (`firestore.rules:323-365`):** client-direct, role- and self-scoped, not deny-all.
- **Identity:** `customer` (free-text, sometimes a string, sometimes `{name}` — see
  `field-ops-app-vite/src/domain/jobDisplay.js`'s `jobCustomerName()` normalizer for the historical
  shape drift this caused), `description`, `status`, `technicianId`, `workOrderId`, `address`. A
  human-typed name field exists, but the record itself is superseded.
- **Decisive evidence:** `field-ops-app-vite/src/modules/jobs/Jobs.jsx:9-19` states directly: *"F0 —
  this surface now READS the governed Work Order Engine (fieldops_wos) instead of the legacy
  fieldops_jobs collection... Its legacy 'New Job' form is REMOVED rather than migrated."*
  `field-ops-app-vite/src/domain/timestampMillis.js:6-9` confirms the same migration. The already-
  merged `workOrder.js` entity definition (`fieldops_wos`) is the current, governed model of exactly
  this business concept; `fieldops_jobs` is what it replaced. LEDGER.md's `S-SVC-JOB-ASSIGNMENTS`
  entry independently records the same finding ("Classify as duplicate/redirect/composition alias").
  **STALE — already covered, by `workOrder.js`, under a different and now-canonical collection.**

### 1.10 `fieldops_technicians` — BLOCKED_PROTECTED

- **Writer:** `field-ops-app-vite/src/domain/jobActions.js` `createTechnician()` (client-direct,
  wired to `Technicians.jsx`'s create flow) plus `completeAssignedJob.ts`'s availability cascade.
  LIVE.
- **Reader:** `Technicians.jsx:35` full-collection listener (admin/dispatcher);
  `hooks/useCurrentTechnician.js:4-12`, a single-doc self-read via `users/{uid}.technicianId`.
- **Rules (`firestore.rules:367-393`):** client-direct, role- and self-scoped.
- **Identity:** `{name, phone, status}` — human-typed `name`, no server-allocated reference.
- **Confirmed, not re-litigated:** `Technicians.jsx:19-32`'s own in-code comment records that
  S-ADM-EMPLOYEES was "ATTEMPTED and DECLINED for cause" — the admin nav item labelled "Employees"
  (`field-ops-app-vite/src/navigation/navConfig.js:371`, resolving the bare `/administration` route)
  renders this module, reading `fieldops_technicians` — a live collection **distinct** from
  `employees`, which the already-merged `employee.js` entity definition describes (written only by
  `functions/scripts/provisionEmployeeAccess.js`). A regression test pins the divergence:
  `field-ops-app-vite/test/techniciansSurfaceEmployeeDivergence.test.jsx`.
- **Why BLOCKED_PROTECTED:** the task brief's own protected-action category includes "new business-
  identity semantics," which is exactly what is missing here — a decision on whether the "Employees"
  identity the nav promises should be built against the live `fieldops_technicians` roster (different
  fields, no create path onto `employees`, different `status` lifecycle) or against the governed
  `employees` record, and what that means for the surface currently showing one under the other's
  label. This is recorded, confirmed, and requires an Owner product decision before either collection
  can be honestly (re)defined under the "Employees" label — not an engineering gap.

### 1.11 `inventory_actions` — DEFINE (top of the ranked list — see §3)

- **Writer:** `field-ops-app-vite/src/domain/inventoryActions.js` `recordInventoryAction()` — the
  file's own comment (line 8) states it is "the ONLY writer of inventory_actions — no component calls
  addDoc/setDoc directly." Wired LIVE into `modules/inventory/PartDetail.jsx` (lines 127, 1104) as an
  audit companion to stock actions.
- **Reader:** `modules/inventoryRole/WarehouseManagerHome.jsx` — `useInventoryActionsForPart(partId)`,
  a scoped, client-direct query. LIVE.
- **Rules (`firestore.rules:1167-1171`):** `allow read: if isAdminOrDispatcher() ||
  isActiveOperationalRole("WAREHOUSE_MANAGER"); allow create: if isAdminOrDispatcher(); allow update,
  delete: if false;` — client-direct, role-gated, **and the gating authorization is active today**,
  unlike every capability-inactive item above.
- **Identity:** `{id, partId, transactionType, quantityDelta, reason, notes, createdBy, createdAt}` —
  `partId` is a system reference, `reason`/`notes` are free text, not a name. No server-allocated
  reference either.
- **Human-facing?** Yes, as a related list under a Part — comparable in shape and purpose to the
  already-merged `inventoryTransaction.js`, which the Owner's ruling (`A-IDENTITY-MODES`,
  `X-INVENTORY-TRANSACTION-NO-IDENTITY`) resolved with `identity: makeIdentity({ mode:
  "SYSTEM_ONLY" })` rather than nominating a category field as a fake name. That exact, already-
  established precedent applies cleanly here.
- **Why this is the cheapest real DEFINE:** unlike every other candidate in this document, both the
  write and the read paths are LIVE **and actively authorized** (no inactive capability, no Rules
  deny-all, no missing decision) — this is a pure metadata-authoring task with a resolved-elsewhere
  identity question, not an unblocking task.
- **Proposed identity mode:** `SYSTEM_ONLY` (matches `inventoryTransaction.js`'s Owner-ruled
  precedent exactly — no nameField, no referenceField, both fields are foreign keys/free text).

### 1.12 `inventory_sync_status` — EXEMPT

- **Writer:** `functions/src/inventoryService.ts` (multiple `.doc(workOrderId)` writes), driven by
  `functions/src/transitionWorkOrder.ts` and `functions/src/inventoryEffectDetection.ts`. Admin-SDK
  only, LIVE — part of the Epic 2D Inventory Trigger System.
- **Reader:** `functions/src/inventoryEffectCallables.ts`, server-side only.
- **Rules (`firestore.rules:507-510`):** deny-all, with the repo's own comment at line 492-493
  supplying the decisive evidence directly: *"inventory_sync_status stays fully closed — internal
  retry/idempotency bookkeeping, no reporting value."*
- **Identity:** Doc id = `workOrderId` (foreign key, not its own identity); fields include
  `processedStates`. No name.
- **Human-facing?** No — the repository's own Rules comment already says so.

### 1.13 `invoice_adjustments` — BLOCKED_PROTECTED

- **Writer:** `functions/src/finance/adjustmentCallables.ts` `recordInvoiceAdjustment`, exported
  `functions/src/index.ts:58`. Real trusted-writer code, gated by capability
  `finance.adjustment.record`, `active: false` — fails closed for every caller today. Not
  dormant/demo — genuinely built and exported, just ungranted.
- **Reader:** Not established — exhaustive grep of `functions/src` and `field-ops-app-vite/src` finds
  only the constant, the writer, and the permission-catalog comment; nothing reads it.
- **Rules:** `firestore.rules:1785-1787`, deny-all.
- **Identity:** Auto-generated doc id; fields `type` (CREDIT_MEMO/DEBIT_CHARGE/WRITE_OFF), `reason`
  (free text), `recordedBy/At`. No name, no reference.
- **Human-facing?** No — a linked financial-ledger entry against an invoice, machine/audit-shaped.
- **Decisive evidence:** matches, and is explicitly named by, the LEDGER's own
  `X-NO-GOVERNED-READ-COLLECTIONS` finding — "invoice_adjustments... all `allow read, write: if
  false`... exhaustive search of functions/src found NO exported callable that reads any of them —
  only writers." **Decision needed:** Owner authorizes activating `finance.adjustment.record` (and a
  governed read) per that already-recorded finding.

### 1.14 `location_truck_claims` — EXEMPT

- **Writer:** `functions/src/truckRegistry/truckRegistryRepository.ts:174`, invoked from
  `truckRegistryCommands.ts:160` ("createTruck — atomically creates mobile_locations + trucks +
  location_truck_claims"). Admin-SDK, LIVE, part of the Truck Registry write service.
- **Reader:** Not established — no code reads it; the Rules comment
  (`firestore.rules:1245-1250`) states directly: *"This is INTERNAL bookkeeping... it carries no
  reporting value and is never read by any client surface."*
- **Rules (`firestore.rules:1251-1254`):** deny-all.
- **Identity:** Doc id = `locationId` itself — "Document identity IS domain identity"
  (`truckRegistryRepository.ts:3`). A foreign-key-shaped system id enforcing the 1:1 Truck↔MOBILE-
  Location invariant Rules cannot express cross-document. No name.
- **Human-facing?** No — an atomic uniqueness-guard/claim-lock doc, by the repo's own description.

### 1.15 `part_supplier_items` — BLOCKED_PROTECTED

- **Writer:** `functions/src/partMaster/partSupplierItems.ts` (`createPartSupplierItem`,
  `updatePartSupplierItem`, `changePartSupplierItemStatus`, `setPreferredSupplier`), Admin SDK,
  trusted, deterministic doc id `<partId>__<supplierId>`. Real, governed writer.
- **Reader:** No read service exists. `functions/src/partMaster/partSupplierItemProjections.ts` is a
  pure, I/O-free field-tiering module (RELATIONSHIP tier vs COST tier, gated respectively on
  `inventory.catalog.read` / `inventory.catalog.cost.read`) whose own header states the read service
  that would call Firestore and resolve those capabilities "is NOT built/activated here (it is gated
  on R-1 supplying `inventory.catalog.read` / `inventory.catalog.cost.read`)."
- **Rules (`firestore.rules:1658-1660`):** deny-all, with a comment explicitly noting "procurement
  data is NOT exposed here (part_supplier_items stays fully closed)."
- **Identity:** Deterministic composite key (server-computed, not human-typed); `supplierSku` is a
  human-transcribed supplier catalog number but not this program's own reference.
- **Human-facing?** In principle yes (a Parts Manager wants supplier cost/lead-time data), but there
  is no read surface today.
- **Decisive evidence:** also explicitly named in `X-NO-GOVERNED-READ-COLLECTIONS`. The "pure
  projection contract explicitly not activated" the memory note references is confirmed precisely:
  the logic exists and is unit-testable, the wiring to a real capability-checked callable does not.

### 1.16 `payment_applications` — BLOCKED_PROTECTED

- **Writer:** `functions/src/finance/paymentCallables.ts` `applyPayment`, exported
  `functions/src/index.ts:55`, gated by `finance.payment.apply`, `active: false`.
- **Reader:** Not established. `payment.js` (already-merged) only *mentions*
  `payment_applications` in a comment as out of scope — it does not read the collection.
- **Rules:** `firestore.rules:1776-1778`, deny-all.
- **Identity:** Auto-generated doc id, references `paymentId` + invoice; no name, no reference.
- **Human-facing?** No — a machine join artifact recording how a receipt was applied to an invoice.
- **Decisive evidence:** same `X-NO-GOVERNED-READ-COLLECTIONS` finding, explicitly named.

### 1.17 `permissions` — STALE

- **Writer:** None found anywhere — grep for `collection("permissions")` across `functions/src`,
  `field-ops-app-vite/src`, `scripts/` returns zero hits.
- **Rules (`firestore.rules:1682-1684`):** deny-all, governed by the block comment at 1670-1681
  citing the Enterprise Access & Administration Platform spec's explicit hard prohibition:
  "Permission/Role definitions are not client-editable... ever."
- **Decisive evidence:** the real authority is `functions/src/access/permissionCatalog.ts`, a
  hard-coded, dependency-free TypeScript catalog whose own header states no Firestore I/O — kept in
  sync between Functions and frontend by `scripts/syncAccessContracts.mjs`
  (`A-PERMISSION-CATALOG-GENERATION`, already merged). Authorization decisions resolve in code via
  `resolveEffectivePermission.ts` against the catalog plus `roleAssignments` (a **different**,
  already-real, still-deny-all collection — `firestore.rules:1690-1692` — not among these 22).
  **`permissions` has never been instantiated as a Firestore collection and is not intended to be** —
  STALE, not a gap; the authority already lives elsewhere, by design.

### 1.18 `purchase_orders` — STALE

- **Writer:** Only `functions/scripts/seedOperationsDemoData.js:98`, a manual demo-seed script — not
  a Cloud Function, not callable from the app. **DORMANT/DEMO-ONLY, confirmed.**
- **Reader:** `field-ops-app-vite/src/services/operationsQueries.ts:186`
  (`fetchPurchaseOrders`/`RawPurchaseOrder`), consumed by exactly one file,
  `analytics/operationsIntelligenceService.ts` — which itself has **zero consumers anywhere in the
  codebase** (grep for `operationsIntelligenceService`/`getOperationalOverview`/
  `getCrossDomainBottlenecks` returns only its own definitions). The read path is technically open
  (`firestore.rules:1271-1274` grants admin/dispatcher read, unlike the deny-all pattern elsewhere)
  but leads nowhere.
- **Decisive evidence:** `purchaseOrder.js`'s own header (already merged, describing the LIVE
  `reorder_purchase_orders` collection) explicitly states: *"NEVER the dormant Epic-5
  `purchase_orders` collection... the two are unambiguously separate concepts."*
  `operationsQueries.ts:202-206` independently confirms the same history — the dashboard's
  Procurement panel used to read this dormant collection and was switched to
  `reorder_purchase_orders` because nothing populated real data here. **Confirmed exactly as the task
  brief described. STALE — the live concept is already covered by `purchaseOrder.js`, and this
  collection is dead code the program has already, correctly, declined to model.**

### 1.19 `refunds` — BLOCKED_PROTECTED

- **Writer:** `functions/src/finance/refundCallables.ts` `recordRefund`, exported
  `functions/src/index.ts:70`, gated by `finance.refund.record`, `active: false`.
- **Reader:** Not established — no reader found anywhere.
- **Rules:** `firestore.rules:1804-1806`, deny-all.
- **Identity:** Auto-generated doc id; `amountMinor`, `currency`, `reason`, `recordedBy/At`. No name,
  no reference.
- **Human-facing?** No — a financial-ledger audit artifact.
- **Decisive evidence:** same `X-NO-GOVERNED-READ-COLLECTIONS` finding, explicitly named.

### 1.20 `reorder_purchase_order_voids` — DEFINE

- **Writer:** The JS domain module (`field-ops-app-vite/src/domain/reorderPurchaseOrders.js:137-159`
  `voidPurchaseOrder()`) checks `isWriteBlocked()` before writing. **This is not a permanent,
  collection-specific block** — `field-ops-app-vite/src/config/env.js:26-28` shows `isWriteBlocked =
  () => IS_DEMO || window.__PANIC_MODE__`, a **global** demo-mode/panic kill switch also checked by
  `jobActions.js`, `contactImport.js`, and `inventoryReorderRequests.js` — i.e., the exact same gate
  the already-merged `reorderRequest.js` and `purchaseOrder.js` siblings live under. It is not a
  reason to treat this collection differently from them.
- **Reader — corrects an assumption in the task brief and in `purchaseOrder.js`'s own header:** this
  collection is **not** deny-all. `firestore.rules:1111-1118` grants a live, validated, role-gated
  read: `allow read: if isAdminOrDispatcher() || (isActiveOperationalRole("PARTS_ASSOCIATE") &&
  get(.../reorder_requests/$(reorderPurchaseOrderId)).data.assignedToUserId == request.auth.uid);`
  and a fully cross-document-validated `allow create:` (requires the linked `reorder_requests` doc to
  be `status == "ORDERED"`, a matching `reorder_purchase_orders` record, and an atomic
  `reorder_requests → VOIDED` transition in the same commit). `allow update, delete: if false`
  (append-only). This is `readVia: CLIENT_DIRECT`, the same pattern the already-merged
  `reorderRequest.js` uses for its own collection.
- **Identity:** Doc id = the shared `reorderRequestId`/`reorderPurchaseOrderId` (1:1 with the Reorder
  Request, same deterministic-id pattern `purchaseOrder.js` already documents for its own
  collection). Fields: `reorderRequestId`, `partId`, `voidedBy`, `reason` (free text), `createdAt`. No
  human-typed name, no server-allocated reference — matches the identity shape of
  `equipment_compatibility_operations`/`_sources`, but unlike those, this record IS independently
  readable and IS the record of a real, human-triggered business event ("why was this PO voided").
- **Human-facing?** Yes — a Parts Associate or dispatcher would look this up to see why/when/by whom
  a Purchase Order was voided, exactly the kind of append-only audit-with-a-reason record
  `invoiceAdjustment`-shaped entities elsewhere in this program get defined for once reachable.
- **Why DEFINE despite `purchaseOrder.js`'s header calling it "out of this lane's writeScope":**
  that header correctly scoped its OWN lane to `reorder_purchase_orders`; it did not claim this
  sibling collection was unreadable — and it is not. The write path shares the exact same global
  gate as two already-merged siblings, and the read path is live and role-gated, not deny-all. No
  Rules change, no capability activation, and no business decision is needed to describe this
  collection honestly.
- **Proposed identity mode:** `SYSTEM_ONLY` (no name field; `reason` is a required free-text
  justification, not identity, matching the treatment of similar reason-bearing records elsewhere in
  the program).

### 1.21 `roles` — STALE

- **Writer:** None found — grep for `collection("roles")` across the whole repo returns zero hits.
- **Rules (`firestore.rules:1686-1688`):** deny-all, under the same governing comment
  (1670-1681) as `permissions`, citing the same hard prohibition on client-editable role
  definitions.
- **Decisive evidence:** the collection that actually carries live role-membership data is
  `roleAssignments` — a **different**, real, `.where("principalUid","==",...).where("status","==",
  "active")`-queried collection (`functions/src/access/adminCredentialCallables.ts:121`,
  `partMaster/partMasterCommands.ts:115`), itself also deny-all to clients
  (`firestore.rules:1690-1692`) but not among these 22. **`roles` as literally named has never been
  written to and is never intended to be** — the operative concept lives under a different name this
  lane was not asked to evaluate. STALE — the claim that a `roles` collection needs a definition is
  wrong; there is no such populated collection.

### 1.22 `users` — BLOCKED_DEPENDENCY

- **Writer:** `functions/scripts/provisionEmployeeAccess.js` (`USERS_COLLECTION = "users"`), Admin-SDK
  transaction writes during employee onboarding/linkage (`:613,648,699,736`). LIVE, invoked
  provisioning tooling (also referenced by the `onboard-employee` skill), not demo-only.
- **Reader:** Client-direct self-read only —
  `field-ops-app-vite/src/auth/employeeSession.js:50` (`getDoc(doc(db,"users",uid))`, consumed by
  `AuthContext.jsx`). Server/Admin-SDK reads exist for other purposes
  (`functions/src/callerContext.ts:16`, `access/adminCredentialCallables.ts`,
  `partMaster/partMasterCommands.ts`, `truckRegistry/truckRegistryCommands.ts`). **Rules
  (`firestore.rules:397-400`):** `allow read: if isSignedIn() && request.auth.uid == userId; allow
  write: if false.` Self-scoped only — no general-purpose directory read exists for any principal,
  including admin.
- **Identity:** uid-keyed authorization mirror holding `role`, `technicianId`, `employeeId` — not a
  human-facing record on its own; it drives what a signed-in user sees, not a directory entry.
- **Confirmed:** Firebase Auth (via `AuthContext.jsx`'s `onAuthStateChanged`) is the actual
  identity/session source; the Firestore `users` collection is a **separate mirror** document keyed
  by the same uid holding authorization metadata only, exactly as the memory note states.
- **Decisive evidence:** LEDGER.md's own `S-ADM-USERS` entry: "Needs a general-purpose unscoped Users
  directory read plus activation of its gating capability" — confirmed by the Rules text itself: the
  self-scoped `uid == userId` condition is the entire read surface today. **Missing dependency named
  exactly:** a general-purpose, capability-gated Users directory read service (does not exist in any
  form, active or inactive) — an engineering gap distinct from a Rules/authority decision, matching
  BLOCKED_DEPENDENCY.

## 2. A dormant-collection note

Every collection in §1.5–1.8 (`equipment_compatibility_operations`, `_sources`,
`equipment_model_aliases`, `equipment_part_compatibility`) appears in `firestore.rules` with a full
`allow read, write: if false` block **and has real, tested repository code behind it, yet zero
exported Cloud Function reaches any of them** — confirmed by grep against `functions/src/index.ts`
returning zero "Compatibility" matches. This is fully expected and by explicit design: the
architecture's own gate sequence (`docs/architecture/equipment-part-compatibility.md` §10) only
authorizes D0/D1 (pure types, no I/O) so far, and D4/D5 (the persistence and read-service code that
does exist) are merged as documentation-only "PENDING — NOT AUTHORIZED" packages. It is recorded here
as a finding, not a defect: four real, deny-all, zero-callable collections exist in Rules today purely
as prepared-but-unactivated infrastructure for a design-approved-but-implementation-gated program.

## 3. DEFINE group, ranked by mechanical cost

1. **`inventory_actions`** — cheapest. Write and read are both LIVE and actively authorized today (no
   inactive capability, no Rules gap, no pending decision). Identity question is already resolved by
   precedent (`inventoryTransaction.js`'s Owner-ruled `SYSTEM_ONLY`). This is pure metadata authoring.
2. **`reorder_purchase_order_voids`** — moderate. Write shares the same global `isWriteBlocked()` gate
   as two already-merged siblings (not collection-specific); read is live, Rules-validated,
   role-scoped. Requires correcting the (incorrect) assumption that this collection has no read path,
   and modeling a cross-document-validated create — more contract detail to capture than #1, but no
   external decision required.

## 4. Classification summary

| Collection | Classification | Decisive evidence | Proposed identity mode (DEFINE only) |
|---|---|---|---|
| `commercial_coverage_assignments` | BLOCKED_PROTECTED | Roadmap #15: "do NOT build during runway"; `coverage.read`/`coverage.write` capabilities `active:false`; Rules deny-all (`firestore.rules:1796-1798`) | — |
| `counters` | EXEMPT | Backs 7 numbering allocators (WO/SO/OPP/TO/RO/RR/INV); Admin-SDK-only, deny-all (`firestore.rules:482-485`); no name/reference of its own | — |
| `cycle_counts` | BLOCKED_DEPENDENCY | Write callables LIVE but `inventory.cycleCount.*` capabilities `active:false`; **no read capability/service exists at all** (`useCycleCountActions.js:12-21`) | — |
| `databases` | STALE | Rules-language service wrapper (`match /databases/{database}/documents`, `firestore.rules:3-4`), not app data; zero app references anywhere | — |
| `equipment_compatibility_operations` | EXEMPT | Idempotency/operation-log with `idempotencyKey` as doc id; explicitly a "client-closed operation state machine" per D4 spec; no export, dormant by design | — |
| `equipment_compatibility_sources` | EXEMPT | Immutable evidence/provenance record (`compatibilityRepository.ts:106`); architecture doc explicitly separates evidence from the browsable relationship (§4.3) | — |
| `equipment_model_aliases` | BLOCKED_PROTECTED | D4/D5 merged as PENDING/NOT AUTHORIZED (`docs/implementation-plans/equipment-compatibility-d4/d5-*.md` front matter); deny-all, no export; D10 (deploy) authorization required | — |
| `equipment_part_compatibility` | BLOCKED_PROTECTED | Same D10 gate as above; deterministic hash id, no export, deny-all (`firestore.rules:1728-1730`) | — |
| `fieldops_jobs` | STALE | `Jobs.jsx:9-19`: admin surface migrated onto `fieldops_wos` (already-merged `workOrder.js`); legacy create form removed, not migrated | — |
| `fieldops_technicians` | BLOCKED_PROTECTED | Confirmed the live data source behind the "Employees" nav item, distinct from `employees`/`employee.js`; `Technicians.jsx:19-32` records the decision as "DECLINED for cause" pending Owner call | — |
| `inventory_actions` | **DEFINE** | LIVE write (`inventoryActions.js`) + LIVE, actively-authorized scoped read (`WarehouseManagerHome.jsx`); Rules gate is active, not inactive (`firestore.rules:1167-1171`) | `SYSTEM_ONLY` |
| `inventory_sync_status` | EXEMPT | Rules comment itself: "internal retry/idempotency bookkeeping, no reporting value" (`firestore.rules:492-493`) | — |
| `invoice_adjustments` | BLOCKED_PROTECTED | Named in ledger's `X-NO-GOVERNED-READ-COLLECTIONS`; exported callable, `finance.adjustment.record` `active:false`, deny-all, no reader found | — |
| `location_truck_claims` | EXEMPT | Rules comment: "INTERNAL bookkeeping... never read by any client surface" (`firestore.rules:1245-1250`); doc id = `locationId` (uniqueness-guard, not identity) | — |
| `part_supplier_items` | BLOCKED_PROTECTED | Named in ledger's `X-NO-GOVERNED-READ-COLLECTIONS`; real writer, deny-all, pure projection contract built but explicitly gated on R-1 capability decision | — |
| `payment_applications` | BLOCKED_PROTECTED | Named in ledger's `X-NO-GOVERNED-READ-COLLECTIONS`; exported callable, `finance.payment.apply` `active:false`, deny-all, no reader found | — |
| `permissions` | STALE | Zero writer anywhere; real authority is `functions/src/access/permissionCatalog.ts`, an in-code, no-Firestore-I/O catalog; deny-all path never instantiated | — |
| `purchase_orders` | STALE | Confirmed dormant Epic-5 collection; demo-seed-only writer; sole reader chain (`operationsIntelligenceService.ts`) has zero consumers; already correctly disclaimed by `purchaseOrder.js`'s header | — |
| `refunds` | BLOCKED_PROTECTED | Named in ledger's `X-NO-GOVERNED-READ-COLLECTIONS`; exported callable, `finance.refund.record` `active:false`, deny-all, no reader found | — |
| `reorder_purchase_order_voids` | **DEFINE** | Write shares the global `isWriteBlocked()` gate two already-merged siblings also use; read is LIVE, role-gated, cross-document-validated (`firestore.rules:1111-1118`) — corrects the "no read path" assumption | `SYSTEM_ONLY` |
| `roles` | STALE | Zero writer anywhere; deny-all path deliberately never populated per spec; real role-membership data lives in the differently-named `roleAssignments` collection (out of this lane's scope) | — |
| `users` | BLOCKED_DEPENDENCY | Live writer + self-scoped-only read (`firestore.rules:397-400`); missing dependency named exactly by ledger's `S-ADM-USERS`: a general-purpose unscoped directory read + capability activation | — |

**Totals: DEFINE 2, EXEMPT 5, BLOCKED_DEPENDENCY 2, BLOCKED_PROTECTED 8, STALE 5 = 22.**
