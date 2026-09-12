# W1-C21 — Firebase retirement: what was retired, what was deferred, what still needs a registration

Lane C21 executes the safe Firebase retirements that concurrent lanes identified but could not
perform, and shrinks `docs/architecture/firebase-exit-baseline.json` to match. The baseline is a
floor that may only shrink; nothing here adds an entry, adds an exemption, or weakens
`scripts/firebaseExitGuard.mjs`.

**Baseline business-runtime entry count: 369 → 366.** (`frontend.firestore_client` 57 → 55,
`server.firebase_admin_firestore` 185 → 184; `frontend.firebase_functions_client` 55 and
`server.firebase_functions_server` 72 unchanged. The three IDENTITY_ONLY keys are untouched.)
`docs/architecture/firebase-exit-manifest.json` carries no per-file list and no counts, so it needed
no change; it is listed as editable for this lane and was deliberately left byte-identical.

---

## RETIRED (3)

Each was deleted only after proving unreachability: no importer, no caller, no Rules dependency, no
index, no seed writer, no test that exercises it, and no *use* on any of the twelve concurrent lane
branches (`origin/impl/w1-part-admin-objects`, `-truck-mobile`, `-inventory-commitment`,
`-commercial`, `-employee-principal`, `-account-contact-location`, `-supplier-manufacturer`,
`-equipment`, `-warehouse-bin`, `-purchasing`, `-invoice`, `-payment`).

### 1. `functions/src/supplierService.ts` — duplicate server-side Firebase supplier authority
Identified by lane C6 (PR #1872); C6 could not delete it because deletion creates a `staleEntry` in
a baseline file it may not edit.

- **Duplicate authority, confirmed.** It read the same `suppliers` collection as the governed
  Supplier Master (`functions/src/supplierMaster/*`, whose callables ARE exported from
  `functions/src/index.ts`), but typed it as `{ id, name, contactEmail, leadTimeDays }` — an
  ungoverned shape with no provenance, no version, and no command path.
- **No importer.** `grep -rn 'from "./supplierService"' functions/src` → zero hits. The only
  mentions anywhere in `functions/src` are prose comments (`procurementBridge.ts:23`).
- **Not deployed.** Never exported from `functions/src/index.ts`, so no Firebase function could
  reach `getSuppliers`, `getSupplierCatalog`, or `findBestSupplierForPart`.
- **One test importer, now removed.** `functions/test/warehouseProcurementSupplierServices.test.mjs`
  imported `findBestSupplierForPart`. The supplier tie-break case was removed with the module it
  tested; the file's `procurementService` cases are untouched, and its header now records why.
- **No Rules or index dependency of its own.** The `suppliers` and `supplier_catalog` Rules blocks
  and the `suppliers(status,name)` composite index serve the CLIENT reads described under
  DEFERRED #1 below, not this module.

### 2. `field-ops-app-vite/src/analytics/operationsIntelligenceService.ts` — orphan Firestore reader
288 lines, Epic 8 "Operations Intelligence Unification Layer", `import { collection, getDocs } from
"firebase/firestore"`.

- **Every exported symbol has zero references repo-wide.** Checked individually:
  `OperationalOverview`, `getOperationalOverview`, `WorkOrderPartsBlock`, `ProcurementDelayBlock`,
  `WarehouseTransferDelayBlock`, `InventoryShortageBlock`, `CrossDomainBottlenecks`,
  `getCrossDomainBottlenecks`, `PartDemandHeatmapEntry`, `getPartDemandHeatmap` — 0 refs each
  across `field-ops-app-vite/src`, `field-ops-app-vite/test`, `functions/src`, `functions/test`,
  `scripts`.
- **Not in the frontend test runner.** Absent from `field-ops-app-vite/test/suites.json`.
- **No lane branch imports it.** See the registration note below for the one descriptive citation.

### 3. `field-ops-app-vite/src/hooks/useAssignedJobs.js` — orphan scoped `fieldops_jobs` reader
Added by F-RULES-1 as the client half of the technician read-scoping interlock
(`docs/audits/f-rules-1/read-scoping-validation.md`).

- **Its only consumer stopped using it.** `field-ops-app-vite/src/modules/mobile/FieldMode.jsx` no
  longer imports it and no longer reads `fieldops_jobs` at all (it retains `useCurrentTechnician`).
  No other file imports the hook; `useAssignedJobs` appears nowhere else in the repository.
- **Rules enforcement is unaffected.** The scoped READ rule at `firestore.rules:353` stands
  untouched and still fails closed: an unconstrained technician read is denied whether or not a
  client hook exists to issue the matching query.
- **Not in `field-ops-app-vite/test/suites.json`.**

### What pins these against silent return
`scripts/firebaseExitGuard.test.mjs` gained two tests — the file CI already runs in
`.github/workflows/firebase-exit-guard.yml`, on a path filter that includes
`field-ops-app-vite/src/**` and `functions/src/**`, so any reintroduction triggers it:

1. *"W1-C21 retired Firebase business-runtime modules stay retired — absent from the tree"* — the
   three paths must not exist on disk.
2. *"W1-C21 retired modules stay out of the baseline — the ratchet never re-grows for them"* — none
   of the three may reappear in any `FORBIDDEN_CATEGORIES` key of the baseline.

The first pin was verified to genuinely fail by recreating one path (`not ok 29`, 29 pass / 1 fail)
and to pass again on removal (30 pass / 0 fail). The pins are deliberately about the *retirement
decision*, not the import: the guard's exact-match check already catches a returning
`firebase/firestore` import, but would not catch the same module returning through some future
helper the four categories do not match.

---

## DEFERRED (5) — referenced, or deliberately retained

### 1. `supplier_catalog` — NOT dead. Live client read.
Lane C6 reported no write path. That is true of governed commands but the collection is **read-live
and Rules-governed**, so retiring it would be a production outage:

- `field-ops-app-vite/src/modules/operations/Operations.jsx:95-96` calls `fetchSuppliers()` and
  `fetchSupplierCatalog()` from `field-ops-app-vite/src/services/operationsQueries.ts:174-175` —
  the Operations dashboard's ProcurementPanel genuinely queries it.
- `firestore.rules:1260` carries a live `match /supplier_catalog/{catalogItemId}` block
  (`allow read: if isAdminOrDispatcher()`), mirrored in `field-ops-app-vite/firestore.rules`.
- A governed EntityDefinition exists and is tested:
  `field-ops-app-vite/src/metadata/definitions/supplierCatalogItem.js`, asserted by
  `field-ops-app-vite/test/metadataCatalogDefinitions.test.mjs` (29/29 passing after this change).
- `functions/src/access/legacyAuthorizationSurface.ts:190` enumerates it in the row-24 legacy
  authorization census.
- A writer DOES exist: `functions/scripts/seedOperationsDemoData.js:142` batch-writes it.
- Its declaration lives in `functions/src/constants/collections.ts`, which lane C3 (PR #1877) owns
  this wave — not edited here in any case.

**Disposition:** keep. The `supplier_catalog` constant and Rules block stay. Only the duplicate
*server-side* reader (`supplierService.ts`) went away; the client read path is untouched.

### 2. `stock_locations` residue — deliberately retained by lane C3. Respected.
- `functions/src/ownership/ownershipBackfillRules.ts:99` (`{ collection: "stock_locations", ... }`)
  and `:206` (`stock_locations: 5`) are a one-time ownership stamping plan over 5 rows that still
  exist. C3 left the rule on purpose: deleting it while the rows remain would make the plan
  silently incomplete. **Not touched.**
- `functions/src/ownership/ownershipDerivation.ts:80` declares the matching
  `family: "stockLocation", collection: "stock_locations"` derivation that the backfill rule
  depends on. Same reasoning, same disposition: **not touched.**
- `field-ops-app-vite/src/metadata/entityRegistry.js` still registers `stockLocation`. That file is
  on this lane's do-not-edit list — **registration required, see below.**
- The remaining `stock_locations` mentions in `functions/src` (`inventoryAnalyticsCallables.ts`,
  `types/warehouse.ts`, `fulfillment/allocateSalesOrder.ts`, `fulfillment/fulfillmentAvailability.ts`,
  `truckRegistry/operationalReferenceProbe.ts`, `ownership/reorderRequestLocationAuthority.ts`) are
  prose explaining *why* BIN-P2 retired it. They are history, not dependencies, and removing them
  would delete the reasoning that stops someone re-adding a second balance table.

### 3. `usernames` — inert constant, but a deliberately reserved model. Not retired.
`field-ops-app-vite/src/domain/constants.js:20`'s `USERNAMES_COLLECTION` has **zero consumers** —
confirmed. But the collection is not residue:

- `field-ops-app-vite/src/domain/usernames.js` (pure normalize/validate/mapping-contract logic) is
  live and registered in `field-ops-app-vite/test/suites.json:1073`.
- `field-ops-app-vite/test/emulator/authPr2Boundary.mjs:50` asserts `usernames` is client-denied by
  default-deny — a standing security proof that names the collection.
- It is the merged AUTH-PR-2 data model with username login deliberately deferred by the Owner, not
  an abandoned constant.

Removing the constant would also mean editing `domain/constants.js`, a file several concurrent lanes
touch, for zero Firebase-exit benefit: `constants.js` imports no Firebase module and appears in no
baseline category. **Report, do not delete.**

### 4. `functions/src/cycleCount/cycleCountCallables.ts` — FROZEN on purpose (Decision #179).
Found by this lane's own orphan sweep (2 baseline entries: `server.firebase_admin_firestore` +
`server.firebase_functions_server`). Its header is explicit: "FROZEN — CERTIFICATION HISTORY ONLY…
It remains solely because the frozen Certification tooling and its tests drive it." Confirmed:
`functions/scripts/certificationWorld/executeCycleCount.mjs` drives it, and
`functions/test/cycleCountSheet.test.mjs` pins that `index.ts` must NOT export it. Retained
deliberately, exactly like #2. **Not touched.**

### 5. Test-only baseline modules — reported, not retired.
This lane's orphan sweep over all 299 business-runtime baseline files found four more whose only
non-`docs/` references are their own tests:
`functions/src/adminPolicy/migration/firestorePolicyParityHarness.ts`,
`functions/src/finance/financialPolicyProfileCommand.ts`,
`functions/src/supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.ts`,
`field-ops-app-vite/src/services/completionService.js`, plus
`field-ops-app-vite/src/hooks/useInstalledEquipmentPage.js`. Each is migration/parity tooling or has
a dedicated registered test suite, and retiring any of them means deleting a suite registered in
`field-ops-app-vite/test/suites.json` — a file this lane may not edit. "Has only a test" is not
proof of deadness. **Report, do not delete.**

---

## REGISTRATIONS REQUIRED (things this lane may not do itself)

1. **`field-ops-app-vite/src/metadata/entityRegistry.js` — drop the `stockLocation` registration.**
   Reserved file; owner must action. The collection has no writer, no balance authority and no
   client surface (BIN-P2 / Decision #160 / ADR-014). It is the last *client-facing* registration of
   a retired collection. This must NOT be done before the `ownershipBackfillRules.ts` stamping plan
   over the 5 remaining rows completes — see DEFERRED #2.
2. **Lane `impl/w1-part-admin-objects` — one stale citation.**
   `field-ops-app-vite/src/metadata/administration/profiles/part.js:377` lists
   `"src/analytics/operationsIntelligenceService.ts"` in the `staticPartsCatalog` representation's
   `readBy` array. That file no longer exists after this change. It is a descriptive string, not a
   `cite()`, so `objectAdministrationProfile.test.mjs`'s "every citation resolves to a real file"
   test does **not** fail — but the line should be dropped so the census stays honest. No other lane
   branch references either deleted frontend module.
3. **`firestore.rules:353-358` — stale comment, no behaviour change.**
   The `fieldops_jobs` READ rule's comment still says "Field Mode issues the matching scoped query
   (where technicianId == callerTechnicianId)". FieldMode.jsx stopped reading `fieldops_jobs` before
   this lane; with `useAssignedJobs.js` gone, no client issues that query at all. The rule itself is
   correct and fails closed — only the comment is stale. `firestore.rules` is on this lane's
   do-not-edit list.
4. **`docs/architecture/repo-graph.json`** still lists `functions/src/supplierService.ts`. It is a
   generated artifact and its workflow (`.github/workflows/repo-graph-tests.yml`) regenerates it
   report-only, so nothing fails; it was deliberately not regenerated here to avoid colliding with
   ten concurrent lanes. `node --test scripts/repoGraph.test.mjs` passes 13/13 after this change.

## NOT DONE, plainly
- No production cutover, import, dual-write, writer-freeze or deploy. No live Firestore access. No
  data deleted — this lane retired code and registrations only.
- Firestore-emulator suites were not run: port 8080 here holds an unrelated uvicorn service and the
  Admin SDK retries forever, so `functions/test/warehouseProcurementSupplierServices.test.mjs` (the
  file edited above) was syntax-checked with `node --check` but not executed.
