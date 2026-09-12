# W1 · C24 — List / object-list metadata authority · registrations and handoff

**Branch:** `impl/w1-list-ns-migrations` · **base:** `33945090`
**Owns:** the North Star list migrations under `docs/north-star/lists/` and the object-list metadata
authority they run on (ADR-013). **Does not own** any business object.

---

## 1. Headline

**There was no remaining list migration.** `LISTS-P2-COLLECTION-DISPOSITION.md` declared the work
complete on 2026-08-27; this lane re-derived it from source instead of re-reading the summary, and
the declaration holds — 14/14 MIGRATE families, 24 COMPOSE surfaces and the composition gates are
real and green (152/152 across seven suites, §5 below). Everything still open is a **missing read
authority or an unmade product decision**, recorded in `LISTS-P2-COLLECTION-DISPOSITION.md` §11.2.

What *was* wrong is the question underneath the lists: **which registry says an object exists.** Two
claimed to, and they had already disagreed in shipped source for three weeks. That is the change.

---

## 2. REQUIRED REGISTRATIONS — none in a shared file

**`field-ops-app-vite/src/metadata/entityRegistry.js` — NOT EDITED, and no edit is owed.**

This lane adds **no entity, no field and no definition file**. The field census
(`test/entityRegistry.test.mjs:66`, `totalDeclaredFields() === 394`) is **untouched by this branch**.

| Shared file | Edited? | Note |
| --- | --- | --- |
| `metadata/entityRegistry.js` | no | nothing to register — no new entity |
| `test/suites.json` | no | the new assertions were appended to `test/objectListMetadataAuthority.test.mjs`, already registered at `suites.json:565`. **No new test file was created**, so `ciSuiteCoverage` needs no entry — this was the deciding factor in choosing that host file |
| `access/objectPermissionMap.js`, `permissionCatalog.ts`, `firestore.rules`, `functions/package.json`, `.github/workflows/**`, navigation/app-shell, `functions/src/constants/collections.ts` | no | untouched |

### 2.1 — SHARED-COUNT HAZARD (carried, not caused)

`test/entityRegistry.test.mjs:66` pins `totalDeclaredFields() === 394`. Concurrent lanes move it by
adding fields (C12/payment moves it to at least 395). **This branch does not move it.** If a merge
conflicts on that line, **resolve by SUMMING every lane's additions** — never by taking one side. A
lane that takes one side silently deletes another lane's field from the census while the field
itself merges fine, so the number stops measuring anything.

---

## 3. The ruling: `ENTITY_REGISTRY` vs the report catalog

> **`metadata/entityRegistry.js` is authoritative for object identity.
> `domain/reporting/reportCatalog.js` is a capability-scoped reporting projection over a subset of
> it, and may not be the place an object first appears.**

Full reasoning, evidence table and the three recorded divergences:
`docs/architecture/ADR-013-object-list-metadata-authority.md` §"Amendment, 2026-09-11 — Which
registry names the objects".

**Decisive evidence, in one line each:**

| | |
| --- | --- |
| `entityRegistry.js` is load-bearing | 29 entities / 394 fields; 13 collection surfaces render from it; `access/policyObjectRegistry.js:11,28` **derives** the governable-object set from it |
| the report catalog is inert | `reportCatalog.js:8` — *"this ships INERT"*; no read path; `reportCatalog.js:13` — its `report.*` capability ids are *"NOT registered in permissionCatalog.ts"* |
| the overlap is citation, not dependency | `entityDefinition.js:9-17` cites it as prior art **in prose**; **nothing under `src/metadata/` imports it** (now a guard) |
| it had already drifted | `purchaseOrder.js` refused its parent edge because there was *"no registered `reorderRequest` EntityDefinition"* (#1181, 2026-08-17), citing the report catalog — while `reorderRequest.js:117-122,404-411,498-503` (#1258) declared that edge and `test/metadataProcurementDefinitions.test.mjs:144` asserted it closed the gap |
| it is not one copy vs another | three report objects (`job`, `technician`, `serviceHistory`) have **no EntityDefinition at all** — the projection acting as a registry |

**No third copy was created. No merge was performed.** Converging the report catalog onto
`ENTITY_REGISTRY` moves `report.*` capability ids and the parity-proven server port
(`functions/src/reporting/reportCatalog.ts`) with it — a governed-reporting package, not a
list-metadata one.

---

## 4. Inspection — 15 dimensions

| # | Dimension | Finding |
| --- | --- | --- |
| 1 | canonical id | `EntityDefinition.id` (`entityDefinition.js:31-37` — *"`id` stable, machine, never rendered"*). The report catalog mints a **second** stable id per object (`reportCatalog.js:78` `objectId`), and they disagree on one: `account` vs `customer`, both on `accounts` — and the `report.customer.field.*.read` capability strings are minted from the non-canonical one. |
| 2 | existing authority | `metadata/entityRegistry.js` (29 entities, 394 fields). |
| 3 | duplicate / compat representations | **five**, and only one is a duplicate: `entityRegistry.js` (authority) · `domain/reporting/reportCatalog.js` (12 objects — the overlap) · `functions/src/reporting/reportCatalog.ts` (server port, parity-proven by `functions/test/reportCatalogParity.test.mjs`) · `access/objectPermissionMap.js` (24 CRUD-matrix rows, shared, **not edited**) · `access/policyObjectRegistry.js` (the **union** of registry + matrix — derived, not a copy, and already the proof of direction). |
| 4 | ownership authority | design-time: this registry. Run-time/tenant: `functions/src/adminPolicy` (`entityRegistry.js:21-25`). Unchanged. |
| 5 | operating-company authority | none touched. No definition in this change reads or infers `operatingCompanyId`. |
| 6 | relationships | `purchaseOrder → reorderRequest` was believed undeclarable and is in fact declared on the parent (`reorderRequest.js:498-503`). **No relationship was added** — declaring one is Purchasing-domain work. |
| 7 | readers | `access/policyObjectRegistry.js`, `test/entityRegistry.test.mjs`, `test/policyObjectRegistry.test.mjs`, and every `definitions/*.js` consumer. The report catalog's readers: `test/reportCatalog.test.mjs`, `ReportBuilder.jsx`, the server port. **Disjoint sets** — which is why the drift was invisible. |
| 8 | writers | none. Definitions are frozen pure data (`entityDefinition.js:25-28`, §8 no executable metadata). |
| 9 | client dependencies | metadata list runtime + `MetadataListGrid`/`MetadataRecordPage`. Unchanged. |
| 10 | Firebase dependencies | **none added.** No new Firestore collection, no callable, no Rules change, no Firebase business-runtime import. The change is two comment corrections and five test assertions over pure data. |
| 11 | migration source | none needed — migration id `1759968000000` **unused**. No schema, no backfill, no data move. |
| 12 | reconciliation proof | the five guards, each proven to fail on an injected violation (§5.2). |
| 13 | target Postgres authority | unchanged. The design-time object model is source-controlled declaration, not tenant data; the run-time policy record is `functions/src/adminPolicy`, already the Postgres target. |
| 14 | governed command / read boundary | untouched — §6 of `entityDefinition.js` holds: metadata declares a capability, never evaluates one. Nothing in this change returns a boolean meaning *allowed*. |
| 15 | Admin → Objects integration point | `ENTITY_REGISTRY` → `policyObjectRegistry.js` → the Objects grid. **The label divergence is visible there**: `purchaseOrderEntity.label` is `"Purchase Order"` while the report catalog relabelled the same collection `"Reorder Purchase Order"` precisely because the first label *"made a reporting result claim a source it never read"*. Recorded as a ledgered divergence, **not corrected** — which collection is the Purchase Order is `PURCHASE_ORDER_MONEY_LIVES_ON_A_DIFFERENT_COLLECTION`, and renaming an object to settle a label takes that decision by accident. **Next Purchasing/Financial lane should close it.** C2's `metadata/administration/objectAdministrationProfile.js` (PR #1866) is the additive profile layer over this same anchor; nothing here conflicts with it and nothing was cherry-picked. |

---

## 5. Verification — real output

### 5.1 — Suites

```
node --test  test/metadataEntityDefinition.test.mjs        38 pass  0 fail
             test/metadataCatalogDefinitions.test.mjs      29 pass  0 fail
             test/objectListMetadataAuthority.test.mjs     12 pass  0 fail   (7 before, +5 this lane)
             test/entityRegistry.test.mjs                   5 pass  0 fail   (census 394, unmoved)
             test/ciSuiteCoverage.test.mjs                  5 pass  0 fail
             test/metadataProcurementDefinitions.test.mjs  (the file whose :144 assertion
                                                            contradicted the stale comment)
vitest run   test/listsP2StateContract.test.jsx            19 ✓
             test/listsP2Tranche1.test.jsx                 24 ✓
             test/listsP2Tranche2.test.jsx                 20 ✓
             test/listsP2Tranche3.test.jsx                 14 ✓
             test/listsP2Compose.test.jsx                  16 ✓
             test/listsP2VisualContract.test.jsx           50 ✓
             test/compositionConformance.test.jsx           9 ✓
                                                      152 / 152
```

**`.test.jsx` suites do not run under `node --test`** — `ERR_UNKNOWN_FILE_EXTENSION`. They are vitest
suites (`package.json` `test:components`). Run them with `npx vitest run test/<file>.test.jsx`.

**Firestore-emulator suites were not run.** Port 8080 in this environment holds an unrelated uvicorn
service and the Admin SDK retries forever rather than failing. Not a finding about this branch.

### 5.2 — Falsifiability of the five new guards

*A check incapable of failing is not evidence.* Each was run against an injected violation and
observed to fail, then the injection was reverted:

| Guard | Injection | Result |
| --- | --- | --- |
| report catalog may not name a new object | added `obj("cycleCount", …, "cycle_counts", …)` | **failed** ✓ |
| the absent-entity ledger is closed | repointed `job` at `employees` (an entity collection) | **failed** ✓ |
| one collection, one label | relabelled report `equipment` → `"Asset"` | **failed** ✓ |
| no stale registration claim | added *"no registered \`manufacturer\` EntityDefinition"* to `supplier.js` | **failed** ✓ |
| object model does not depend on the projection | added a `reportCatalog.js` import to `metadata/listViewSummary.js` | **failed** ✓ |

---

## 6. Files changed

| File | Change |
| --- | --- |
| `field-ops-app-vite/test/objectListMetadataAuthority.test.mjs` | +5 guards pinning the ruling (appended to the existing ADR-013 boundary suite, already CI-registered) |
| `field-ops-app-vite/src/metadata/definitions/purchaseOrder.js` | two **comment** corrections — the stale *"no registered `reorderRequest` EntityDefinition"* claim and its restatement at the `relationships` site. No code, no field, no relationship, no census movement |
| `docs/architecture/ADR-013-object-list-metadata-authority.md` | the amendment |
| `docs/north-star/lists/LISTS-P2-COLLECTION-DISPOSITION.md` | §11 — the remaining-migration audit |
| `docs/handoff/w1-c24-registrations.md` | this file |

---

## 7. Not done, plainly

* **No list migration was performed**, because none remained. §11.1 is the evidence.
* **The `purchaseOrder` label divergence is recorded, not fixed.** Ledgered; a Purchasing/Financial call.
* **The report catalog was not converged onto `ENTITY_REGISTRY`.** Ruled, guarded, and left as a
  governed-reporting package — moving it drags `report.*` capability ids and a parity-proven server port.
* **The three entity-less reporting objects (`job`, `technician`, `serviceHistory`) were not declared.**
  Declaring `job` or `technician` would create an object family, and `technician` is specifically the
  one the Owner ruled on 2026-08-20 is a **role**, not a family. Ledgered instead.
* **No BLOCKED item was resolved.** All five remain blocked on a read or a product decision
  (verified: no global contacts route, `AdministrationUnavailable` still mounted, Job Assignments
  still nav-mounted, the Transfers part cell still `Unresolved reference`). §5 of the disposition:
  *reported, never resolved by manufacturing the authority that would make the surface conform.*
* **Migration `1759968000000` was not used.** No SQL, no schema, no data move.
