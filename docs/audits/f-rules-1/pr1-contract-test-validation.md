# F-RULES-1 PR-1 — Rules Contract-Test Validation

**Gate:** F-RULES-1 PR-1 (Owner-authorized). Establishes automated Firestore Rules **contract tests only** — NOT an authorization to change production behavior.
**Governing:** `../../assessments/f-rules-1-legacy-job-technician-rules-assessment.md` · `../../specifications/f-rules-1-legacy-job-technician-rules-contract.md` · `../../implementation-plans/f-rules-1-contract-rules-test-suite.md`
**Suite:** `functions/test/legacyJobsTechniciansRules.test.js`

## Purpose

Encode the approved F-RULES-1 authorization contract for the legacy `fieldops_jobs` and `fieldops_technicians` collections as an executable, emulator-based Rules test suite, and — run against the **current permissive** Rules (`allow read, write: if isSignedIn()`) — prove the vulnerability while confirming that legitimate compatibility workflows are preserved. **No Firestore Rule is changed by this PR.**

## Harness & how to run

Same zero-new-dependency harness as the other `*Rules.test.js` suites: `firebase-admin` + Node `fetch` against the **local** Firestore/Auth emulator REST APIs (200 vs 403). It never touches the live project.

Deterministic direct command (from the repository root, so the emulator loads the repo `firestore.rules`):

```bash
firebase emulators:exec --only firestore,auth --project taylor-parts \
  "node functions/test/legacyJobsTechniciansRules.test.js"
```

Two modes:
- **default (PR-1):** proves the vulnerability against current permissive Rules. PASS iff every COMPAT assertion holds AND every HARDENING assertion is a confirmed currently-permitted gap.
- **strict (PR-3):** `F_RULES_1_STRICT=1`. PASS iff **every** assertion (COMPAT + HARDENING) matches the contract — i.e. the hardened Rules now deny what the contract denies. This is the mode used once PR-3's hardened Rules land and the suite is registered.

## Registration posture (why un-registered now)

The suite is intentionally **NOT** registered in `functions/scripts/rulesRegressionRunner.mjs`'s frozen `SUITES` / `EXPECTED_TOTAL` (still 423, unchanged) — a suite whose HARDENING assertions fail the contract against today's permissive Rules would otherwise break protected CI. It is reviewable and runnable standalone (command above). Its **removal-of-temporary-state gate** is PR-3: the hardened-Rules PR registers it in `SUITES` (bumping `EXPECTED_TOTAL`) and runs it in **strict** mode. It must not remain indefinitely unregistered.

## Run evidence (against current permissive Rules @ origin/main 8ebf140)

```
COMPAT: 13 pass, 0 fail
HARDENING: 17 currently-permitted gaps (PR-3 closes), 0 already-enforced, 0 unexpected
PR-1 OK: compatibility preserved; 17 vulnerability gap(s) confirmed present (to be closed by PR-3 hardened Rules).
exit 0
```

The 17 HARDENING gaps are **specific contract failures** (a permissive Rule allowing an operation the contract denies), not infrastructure/fixture failures — each returned HTTP 200 where the contract requires denial.

## Access Contract Matrix (normative; encoded by the suite)

Legend: A/D = admin or dispatcher · Tech = mapped technician (`users/{uid}.technicianId`) · Phase: COMPAT already holds under current Rules; HARDENING = contract denies but current Rules permit (gap).

### fieldops_jobs
| Operation | Actor | Contract | Phase |
|---|---|---|---|
| read job | unauthenticated | DENY | COMPAT |
| read job | A/D | ALLOW | COMPAT |
| read own-assigned job | Tech (own) | ALLOW | COMPAT |
| read another's job | Tech | DENY | HARDENING |
| create valid job (open, technicianId=null) | A/D | ALLOW | COMPAT |
| create job | unauthenticated / Tech / opRole-only | DENY | COMPAT (unauth) / HARDENING (Tech, opRole) |
| assign (technicianId + status) | A/D | ALLOW | COMPAT |
| change technicianId | Tech | DENY | HARDENING |
| status transition on own job (assigned→in_progress, in_progress→complete, status-only) | Tech (own) | ALLOW | COMPAT |
| status transition on another's job | Tech | DENY | HARDENING |
| status write + extra field (smuggling) | Tech | DENY | HARDENING |
| skip lifecycle (assigned→complete) | any | DENY | HARDENING |
| mutate a completed (terminal) job | any | DENY | HARDENING |
| update a job with no valid technicianId mapping | unmapped Tech | DENY (fail closed) | HARDENING |
| delete job | any | DENY | HARDENING |

### fieldops_technicians
| Operation | Actor | Contract | Phase |
|---|---|---|---|
| read technician record | unauthenticated | DENY | COMPAT |
| read technician record | A/D | ALLOW | COMPAT |
| read own record | Tech (own) | ALLOW | COMPAT |
| read another's record | Tech | DENY | HARDENING |
| create technician record | A/D | ALLOW | COMPAT |
| create technician record | Tech | DENY | HARDENING |
| update own record (self-write) | Tech | DENY | HARDENING |
| update another's record | Tech | DENY | HARDENING |
| set invalid status | any | DENY | HARDENING |
| delete technician record | any | DENY | HARDENING |

Coverage confirms the required areas: authentication states; admin/dispatcher/technician compatibility roles (`users/{uid}.role`); technician identity mapping (`users/{uid}.technicianId`, incl. unmapped fail-closed); cross-user isolation; trusted-writer boundaries (assignment/delete/terminal/self-write denied); operationalRoles-are-not-authorization; and the protected collections. Enterprise Access future fixtures are represented via the seeded compatibility roles; deployed Work Order / Saved Definition / Reporting / Effective-Access **Functions** are out of this Rules-suite's scope (verified separately under `../functions-live-state/`).

### Platform security model — all currently-relevant protected domains

This section documents the **complete** platform authorization model for context; it is **documentation only**. The emulator suite in this PR remains scoped to the approved **Legacy Jobs + Legacy Technicians** contract (30 assertions) — **no Rules tests are added for callable Functions**, and the emulator suite is not expanded here.

**Enforcement mechanism legend**
- **R** = **Rules-enforced** — `firestore.rules` gates client-direct access.
- **CF** = **Callable-Function-enforced** — client-direct denied by Rules; the only write path is a trusted `onCall` Function that reauthorizes server-side.
- **TS** = **Trusted-server-only** — client-direct denied; written only by the Admin SDK (inside Functions/operator scripts); no client callable exists.
- **FP** = **Future enforcement / pending** — target enforcement not yet in place.

Deployment state per `../functions-live-state/` (2026-07-21): **11 Functions live** (Work Order ×3, report execution, saved-definition ×6, effective-access); the **6 Enterprise Access mutation Functions are exported but undeployed**.

| Domain / resource | Enforcement | Client read | Client write | Trusted writer / callable boundary | Rules-test coverage | Future enforcement dependency | Owning gate / workstream |
|---|---|---|---|---|---|---|---|
| Legacy Jobs (`fieldops_jobs`) | R (**permissive today**) → target R | any signed-in *(target: a/d all; tech own-assigned)* | any signed-in *(target: a/d + tech own-status)* | none (app-only `jobActions.js`) | **PR-1 contract suite (this PR, un-registered)** | F-RULES-1 PR-3 hardened Rules | F-RULES-1 |
| Legacy Technicians (`fieldops_technicians`) | R (**permissive today**) → target R | any signed-in *(target: a/d all; tech own)* | any signed-in *(target: a/d only)* | none (app-only `jobActions.js`) | **PR-1 contract suite (this PR, un-registered)** | F-RULES-1 PR-3 hardened Rules | F-RULES-1 |
| Work Orders (`fieldops_wos`) | R (read) + CF (write) | adminOrDispatcher (+ technician-scoped assigned query) | DENIED (`if false`) | createWorkOrder / transitionWorkOrder / updateWorkOrderExecutionData — **deployed** | `workOrderEngineRules.test.js` (registered) | none (live) | ADR-002 / Issue #15 |
| WO counters (`counters`) | TS | DENIED (`if false`) | DENIED (`if false`) | `woNumbering` (Admin SDK, in createWorkOrder tx) | via `workOrderEngineRules.test.js` | none | ADR-002 |
| Saved Definitions (`reportDefinitions`) | CF | DENIED (`if false`) | DENIED (`if false`) | 6 `*SavedDefinitionCallable` — **deployed** | `reportDefinitionsRules.test.js` (registered) | none (live) | #325 / ADR-007 |
| Reporting execution | CF | n/a (no client collection) | n/a | `runReportDefinitionCallable` — **deployed** (per-field auth; no `report.*` grant → denies) | n/a — Functions unit (`reportExecutionService.test.mjs`) | none (live; activation gated) | #325 |
| Effective Access | CF | n/a (no client collection) | n/a | `resolveEffectiveAccessCallable` — **deployed** (read-only feed) | n/a — Functions unit (`effectiveAccessFeed.test.mjs`) | none (live) | #226 |
| Enterprise Access mutations (`roleAssignments`, `roles`, `permissions`) | CF (**pending deploy**) | DENIED (`if false`) | DENIED (`if false`) | grantRole / revokeRole / assignApprovedRole / setUserStatus — **exported, NOT deployed** | `enterpriseAccessFoundationRules.test.js` (registered) | mutation Function **deployment** + Admin activation | #226 / ADR-005 |
| Approval records (`accessRequests`) | CF (**pending deploy**) | DENIED (`if false`) | DENIED (`if false`) | approveAccessRequest / rejectAccessRequest — **exported, NOT deployed** | `enterpriseAccessFoundationRules.test.js` (registered) | mutation Function deployment + Admin activation | #226 |
| Audit records (`auditEvents`) | TS | DENIED (`if false`) | DENIED (`if false`, immutable) | `auditEventWriter` (Admin SDK, one event/mutation) | `enterpriseAccessFoundationRules.test.js` (deny) | none (append-only) | #226 / ADR-005 |
| Inventory ledger (`inventory_transactions`) | R (read) + TS (write) | adminOrDispatcher | DENIED (`if false`) | `inventoryService` (Admin SDK, append-only, post-commit of WO transition) | **none dedicated (gap)** | INV-1 effect-recovery | ADR-003 / INV-1 |
| Inventory action records (`inventory_actions`) | R | adminOrDispatcher \|\| WAREHOUSE_MANAGER | adminOrDispatcher create; update/delete DENIED (append-only) | n/a (client-direct create) | partial (inventory-action-log; no standalone suite) | — | Inventory |
| Warehouse (`warehouses`, `stock_locations`, `transfer_orders`) | R (scoped read) + TS (write, **dormant**) | adminOrDispatcher \|\| isAssignedToWarehouse | DENIED (`if false`) | `warehouseService` (Admin SDK) — **dormant/unwired** | `warehouseManagerScopedAccessRules.test.js` (registered) | Epic 4 activation | Epic 4 / Issue #15 |
| Procurement (`suppliers`, `supplier_catalog`, `purchase_orders`) | R (read) + TS (write, **dormant**) | adminOrDispatcher | DENIED (`if false`) | `procurementService` / `supplierService` (Admin SDK) — **dormant/unwired** | **none dedicated (gap)** | Epic 5 activation | Epic 5 |
| Reorder (`reorder_requests`, `reorder_purchase_orders`, `*_voids`) — **live client-direct** | R | adminOrDispatcher \|\| operationalRole | operationalRole-gated client-direct (canonical shape, anti-injection) | n/a (client-direct + Rules) | `reorderRequestsRules.test.js` (registered) | none (live) | Reorder specs |
| User↔technician mapping (`users/{uid}`) | R (own-read) + TS (write) | own doc only (`request.auth.uid == userId`) | DENIED (`if false`) | Admin SDK only (`assignTechnicianToUser.js`) | (exercised by employees/reorder suites) | none | Platform / F-RULES-1 identity |
| Employees (`employees`) | R (read) + TS (write) | adminOrDispatcher + self (linked) | DENIED (`if false`) | trusted writer / `provisionEmployeeAccess.js` (Admin SDK) | `employeesRules.test.js` (registered) | none | #226 / Employee Foundation |
| Customer & Equipment (`accounts`, `locations`, `contacts`, `equipment`) | R | adminOrDispatcher | adminOrDispatcher client-direct + governed-field validation; delete DENIED | `accountsGovernedFieldsRules.test.js`, `equipmentRules.test.js` (registered) | none | Customer / #232 (ADR-006) |

**Enforcement summary:** R (client-direct, Rules-gated): Legacy Jobs/Technicians (permissive→hardening), Reorder, inventory_actions, Customer/Equipment, scoped Warehouse/Procurement/inventory-ledger reads. CF (trusted callable, client-direct denied): Work Order writes, Saved Definitions, Reporting, Effective Access, Enterprise Access mutations *(pending deploy)*, Approval records *(pending deploy)*. TS (Admin-SDK-only): audit records, inventory ledger writes, counters, users/employees writes, dormant Warehouse/Procurement writers. FP (future/pending): F-RULES-1 legacy hardening, Enterprise Access mutation deployment + Admin activation, INV-1 recovery, Epic 4/5 activation.

## Validation performed

- `node -c` syntax OK; `npm ci` (functions) clean.
- Emulator run (firestore + auth) via `emulators:exec`: exit 0, 13 COMPAT pass, 17 HARDENING gaps, 0 unexpected.
- `firestore.rules` and its mirror: **unchanged**. `rulesRegressionRunner.mjs` `SUITES`/`EXPECTED_TOTAL`: **unchanged** (423). Suite **un-registered**.
- No production access, no deployment, no production credentials, no Rules behavior change.

## PR-2 readiness assessment

PR-1 (this) is complete and green. **PR-2** (client query / UI compatibility) is the next gate and is **not** authorized here. PR-2 readiness:
- **Ready:** the contract's technician read scope (own technician doc + own-assigned jobs only) is fixed and tested, so PR-2 can migrate Field Mode from its current broad `useFirestoreCollection(JOBS_COLLECTION)` read to a `where("technicianId","==",callerTechnicianId)` query with a fail-closed missing-mapping state, verified against these COMPAT expectations.
- **Prerequisite already satisfied:** the production compatibility audit is **GO** (`../functions-live-state/` is a separate gate; the data-audit GO is under `../f-rules-1/`), so scoped reads won't strand existing records.
- **Sequencing:** PR-2 (queries) → PR-2A (lifecycle parity) → PR-3 (hardened Rules + register this suite in strict mode) → PR-4 (deploy package). Each is a separate Owner gate; every Rules deploy is separately authorized.
- **Open (unchanged, not resolved here):** Specification U-R1–U-R4 (admin/dispatcher non-lifecycle correction-field allowlist; additional non-admin broad-read needs; trusted-Function cascade timing; users-level disabled/suspended signal) — required before PR-3, not PR-1.

## Not authorized / not done

No Rules enforcement change · no deployment · no Function change · no Enterprise Access mutation activation · no Admin Portal activation · no inventory implementation · no hosting change · no GitHub Pages retirement · PR-2 not started.
