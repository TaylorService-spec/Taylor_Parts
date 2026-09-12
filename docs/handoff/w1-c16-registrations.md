# W1-C16 — Reporting authority: registrations needed in shared files

**Lane:** C16 (reporting authority cleanup) · **Branch:** `impl/w1-reporting-authority`

This lane may not edit the shared files listed below (ten sibling lanes run concurrently against
them). Each item is a registration this lane's work *requires* or *recommends*, recorded here for
whoever owns the shared file. Nothing here is speculative: every entry names the file, the exact
change, and the evidence that motivates it.

---

## 1. REQUIRED — register the new pure test suite

**File:** `functions/package.json` (shared, not edited by this lane)

`test:reporting` today is:

```
"test:reporting": "npm run build && node test/reportCatalogParity.test.mjs && node test/reportExecutionService.test.mjs && node test/savedDefinitionCommands.test.mjs"
```

Two of those three require a live Firestore emulator on `127.0.0.1:8080`. This lane adds
`functions/test/reportTruncationHonesty.test.mjs`, which is **pure** (no emulator, no Firestore) and
pins census rule X-9 against `reportExecutionService.ts`. It should join the suite so the rule is
enforced in every environment, including ones with no emulator:

```
"test:reporting": "npm run build && node test/reportCatalogParity.test.mjs && node --test test/reportTruncationHonesty.test.mjs && node test/reportExecutionService.test.mjs && node test/savedDefinitionCommands.test.mjs"
```

Until then it runs standalone: `node --test test/reportTruncationHonesty.test.mjs` (9/9 pass).

---

## 2. RECOMMENDED — a truthful client outcome for a refused aggregate

**File:** `field-ops-app-vite/src/domain/reporting/reportRunOutcome.js` (Customer's lane, untouched here)

`runReportDefinitionCallable` now maps `IncompleteAggregateScanError` to the HttpsError code
`resource-exhausted`. `mapCallableError()` has no case for it, so it falls to the default branch and
resolves `reportRunUnavailable()` — *safe* (no rows, no aggregates, no raw code surfaced) but not
*honest*: the copy reads "Running reports isn't available yet," when the truth is "this total would
be understated; narrow the report or drop the aggregates."

This lane did not change it because `reportExecutionSeam.js` still resolves unconditionally to
`unavailable` and reporting is environment-deactivated in production
(`functions/test/reportingActivationBoundary.test.mjs:14-16`), so no user can reach the path today.
It becomes load-bearing the moment the seam is wired.

---

## 3. REQUIRED BEFORE WAVE 3/4 — an operating-company dimension in the report catalog

**Files:** `functions/src/access/permissionCatalog.ts` (shared) plus the catalog pair
`functions/src/reporting/reportCatalog.ts` + `field-ops-app-vite/src/domain/reporting/reportCatalog.js`

The report catalog declares **no `operatingCompanyId` field on any object** and
`reportExecutionService.ts` applies **no company predicate** — it reads
`db.collection(object.collection).limit(maxScanDocs + 1).get()`
(`functions/src/reporting/reportExecutionService.ts:446` pre-change) and filters in memory.

Today this is latent rather than live: the four activated objects (`customer`→`accounts`,
`contact`→`contacts`, `location`→`locations`, `equipment`→`equipment`) carry no `operatingCompanyId`
at all, so there is nothing to mix. It becomes a real cross-company defect at **wave 3**, whose
objects *do* carry the field — `reorder_requests` and `reorder_purchase_orders`
(`firestore.rules:1067` — "A purchase order now carries operatingCompanyId, INHERITED from its
reorder request").

ADR-007 deferred this deliberately: "Tenant Scope stays inert across all waves until #140 defines
it" (`docs/specifications/governed-object-based-report-creator.md:225`). That deferral predates the
EOS ruling that `operatingCompanyId` is the governed company authority and is never inferred, so it
should be revisited rather than inherited.

Registrations needed when wave 3 is taken up:

- `report.reorderRequest.field.operatingCompanyId.read` and
  `report.purchaseOrder.field.operatingCompanyId.read` in `permissionCatalog.ts`
  (`sensitivity: "standard"`, operators `filter`/`group` — a company dimension must be *groupable*,
  otherwise a consolidated figure cannot be broken out).
- The matching `f(...)` entries in **both** catalog copies (the parity test
  `functions/test/reportCatalogParity.test.mjs` enforces they stay identical).
- A decision the catalog alone cannot make: whether a wave-3 run **defaults** to the runner's
  company, or requires an explicit company filter. A silent consolidated default is the failure mode
  the EOS ruling names.

---

## 4. RECOMMENDED — reporting has no Administration→Objects integration point

**File:** `field-ops-app-vite/src/metadata/entityRegistry.js` (shared, not edited by this lane)

There is no reporting entry in `entityRegistry.js` and no reporting file in
`field-ops-app-vite/src/metadata/definitions/` (verified: zero matches for `report`/`metric` in that
directory). The report catalog is therefore a **second, parallel object registry** — 12 objects with
their own labels, collections and capability ids — maintained independently of the metadata
definitions that Administration→Objects renders. `field-ops-app-vite/src/metadata/entityDefinition.js:9`
acknowledges the overlap in prose, and `definitions/purchaseOrder.js:108,135` documents two places
where the two registries disagree on purpose.

Nothing is broken today. The registration to make, when Admin→Objects grows a reporting surface, is
that **one** of the two is authoritative for "which objects exist and what are their fields" — not
that a third copy is added.

---

## 5. NO CHANGE NEEDED — `firestore.rules` (recorded because it is the prime offender class)

`match /reportDefinitions/{definitionId} { allow read, write: if false; }`
(`firestore.rules:1592-1594`). Report visibility and row filtering are **not** enforced in Rules.
Verified and correct; the block's own comment records that the original client-direct design was
withdrawn precisely because Rules cannot resolve a live RoleAssignment, pair a mutation with an
Audit Event, or run the definition validator. No registration required — noted so a future reader
does not re-open it.
