# Consolidated Backend Catch-Up Review — Production Release Decision

**Status: DEPLOYED; CORRECTED PRODUCTION VERIFICATION PASSED.**
The first 2026-07-20 deployment from `d5f2172` was rolled back after row 3 exposed
a verification-contract error. After PR #358 corrected the matrix, the reviewed
Rules and exactly 11 authorized Functions were redeployed from `3a9c3ff`; the
corrected assignment-consistency and revocation checks passed and all temporary
data was removed. See `docs/DECISIONS.md` entries #35–#36.
No production write, credential access, RoleAssignment, claims change, or Admin
activation was performed to produce this document. Every command below is
presented for Owner review; each stage requires its own explicit, scoped Owner
Deployment Authorization, matching this repo's established pattern
(`docs/DECISIONS.md` entries #26, #28, #30).

This document **supersedes and absorbs** `docs/deployment/issue-325-production-
authorization-package.md` (the prior, #325-only package) — everything in that
document is still accurate and is folded into §5/§6 below, now placed in the
context of the FULL undeployed backend, not #325 alone.

| | |
|---|---|
| Firebase project | `taylor-parts` |
| Region | `us-central1` |
| Frozen head | `2f4ec13d6d9b1cf7b6d2b293dfd66a7cb136d25e` (`origin/main`, confirmed current at review time) |
| Prepared | 2026-07-20 |
| Prepared by | INVENTORY workstream, this session |

---

## 1. Read-only inventory of what is live now

| Surface | Live state | How confirmed |
|---|---|---|
| Cloud Functions | **Zero functions deployed** to `taylor-parts` | `firebase functions:list --project taylor-parts` → `No functions found in project taylor-parts.` (read-only CLI call, already-authenticated developer session, no deploy) |
| Firestore database | Exists, `FIRESTORE_NATIVE`, `us-central1`, created `2026-07-02T07:41:03Z` | `firebase firestore:databases:get --project taylor-parts` (read-only) |
| Firestore Rules content | **Attempted via the read-only Admin SDK path** (`getSecurityRules().getFirestoreRuleset()`, `projectId: "taylor-parts"`) — **failed**: no Application Default Credentials are available in this environment (`ENOTFOUND metadata.google.internal`), confirming this is a genuine environment limitation, not a skipped step. Owner reviewed this finding and directed: proceed without live verification, using the repo's own deployment decision log as the best-available baseline (same resolution as the prior, #325-only package). | See §2. |
| Frontend (Hosting/GitHub Pages) | Live, out of scope for this review — deploys automatically on every push to `main` via `.github/workflows/deploy-field-ops.yml`, independent of Rules/Functions | `docs/Deployment.md` §1 |

---

## 2. Last known deployed Rules commit, and comparison against current `main`

Most recent Firestore Rules deploy recorded anywhere in this repo
(`docs/DECISIONS.md` entries through #34, `docs/SPRINT_STATUS.md`,
`docs/CLAUDE_CONTEXT.md`): **`docs/DECISIONS.md` entry #30**, deployed at commit
**`393f054883a970af2c39f1f193aff7dec8b12c11`** (2026-07-11), verified live by the
double-deploy content-fingerprint method. No later Rules deploy is recorded
anywhere (entry #34, the last entry, is a data-only backfill, explicitly no
`firestore.rules` change).

**This review compares that baseline against current `main` at the frozen head
(`2f4ec13`), not merely the prior package's target (`cd81cdd`)** — confirmed
`firestore.rules` is byte-identical between `cd81cdd` and `2f4ec13` (the one
intervening PR, #356, was documentation-only), so the delta below is accurate
against the true current `main`.

**Working assumption, unverified against live state (§1):** production Firestore
Rules are still at commit `393f054883a970af2c39f1f193aff7dec8b12c11`. Capturing
and hash-verifying the actual live rollback target remains a **required Owner
action before Stage 1 below** — procedure unchanged from the prior package:

**Option A — Firebase Console:** copy the full live ruleset text (Firestore
Database → Rules tab), hash it (`shasum -a 256`), store text + hash outside this
repo.

**Option B — read-only Admin SDK, from an already-credentialed environment**
(Cloud Shell or a machine with real ADC):
```js
const { getSecurityRules } = require("firebase-admin/security-rules");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "taylor-parts" });
getSecurityRules().getFirestoreRuleset().then((rs) => console.log(rs.source[0].content));
```

Reference hash for the assumed baseline (computable without credentials):
```bash
git show 393f054883a970af2c39f1f193aff7dec8b12c11:firestore.rules | shasum -a 256
```
**If the captured live hash doesn't match, stop — reconcile before Stage 1.**

---

## 3. Full monolithic Rules delta from production — every changed collection, security-reviewed

`firestore.rules`: 841 lines (baseline) → 1,473 lines (frozen head), +632 net.
Root and client-mirror copies confirmed byte-identical throughout. **Firestore
Rules deploy as a single atomic ruleset — there is no way to deploy only part of
this delta.** Deploying at all deploys everything below, simultaneously, for
every collection, for every live session.

**28 total collections in the frozen-head ruleset: 21 pre-existing (11 unchanged,
10 changed) + 7 brand new.**

### 3a. Brand-new collections (7) — added since the baseline, not modified

| Collection | Posture | Issue | Client-facing impact |
|---|---|---|---|
| `accessRequests` | `allow read, write: if false` (unconditional) | #226 | None — Admin-SDK/trusted-Function-only, no client reads it |
| `auditEvents` | `allow read, write: if false` | #226 | None — same |
| `permissions` | `allow read, write: if false` | #226 | None — same |
| `roles` | `allow read, write: if false` | #226 | None — same |
| `roleAssignments` | `allow read, write: if false` | #226 | None — same |
| `reportDefinitions` | `allow read, write: if false` | #325 | None — same; the trusted saved-definition service (§5) is the only path |
| `equipment` | `isAdminOrDispatcher()` read; governed create/update; delete always `false` | Equipment | **Real.** Live client code (`field-ops-app-vite/src/hooks/useEquipment.js`) already reads this collection directly, and its own header comment already anticipates the CURRENT state: reads "will surface as 'You do not have permission to view this equipment'" until these Rules deploy. **This deploy almost certainly FIXES an already-broken production feature, not one it puts at risk** — verify, don't assume (§9). No Cloud Function exists or is required for `equipment` — it is fully client-direct under Rules. |

### 3b. Pre-existing collections, unchanged (11) — confirmed byte-identical block diff, no action needed

`contacts`, `counters`, `fieldops_jobs`, `fieldops_technicians`, `fieldops_wos`,
`inventory_sync_status`, `locations`, `purchase_orders`, `supplier_catalog`,
`suppliers`, `users`.

Notably `fieldops_wos`/`counters` are unchanged and were already part of the
`393f054` baseline (confirmed identical block content) — **these were already
deployed and live as of the last confirmed deploy.** This matters directly for
§5/§6: Issue #15's Work Order Rules are not part of this delta and carry zero
Rules risk; only the Functions are undeployed (see §5).

### 3c. Pre-existing collections, CHANGED (10) — full security review

| Collection | Issue / Initiative | Test coverage | Intended behavior (this delta) | Dependent UI | Required Function |
|---|---|---|---|---|---|
| `employees` | #100 (PARTS_MANAGER assignment-candidate lookup) | `employeesRules.test.js` (20), `issue100PartsManagerRules.test.js` (40) | Adds a least-privilege read branch: an active PARTS_MANAGER may read an Employee doc beyond self/admin/dispatcher only if it matches the assignment-candidate contract (`employmentStatus=="ACTIVE"`, `operationalRoles` contains `PARTS_ASSOCIATE`, has a linked `userId`). Create/update/delete still admin-SDK-only. | `field-ops-app-vite/src/auth/employeeSession.js`, `field-ops-app-vite/src/domain/employees.js` | none — client-direct read, no writes |
| `inventory_actions` | #100 (WAREHOUSE_MANAGER audit-log read) | `issue100PartsManagerRules.test.js`, `issue100WarehouseManagerRules.test.js` (11) | Adds `isActiveOperationalRole("WAREHOUSE_MANAGER")` to the read grant (previously admin/dispatcher only). Create stays admin/dispatcher-only; update/delete `false` — append-only. | `field-ops-app-vite/src/domain/inventoryActions.js`, `field-ops-app-vite/src/hooks/useInventoryActions.js` | none — client-direct, single designated write path |
| `inventory_transactions` | #100 (PARTS_MANAGER + WAREHOUSE_MANAGER ledger read) | `issue100PartsManagerRules.test.js`, `issue100WarehouseManagerRules.test.js` | Adds both operational-role read branches (previously admin/dispatcher only). Create/update/delete still `false` for every client. | `field-ops-app-vite/src/services/operationsQueries.ts`, `field-ops-app-vite/src/hooks/useInventoryLedger.js` | **`transitionWorkOrder`** (#15) via `functions/src/inventoryService.ts` — the only write path (Admin-SDK ledger writer, ADR-003), unchanged by this delta |
| `reorder_purchase_orders` | #100 (PARTS_ASSOCIATE self-scoped read + create) | `issue100PartsAssociateRules.test.js` (23), `issue100PartsManagerRules.test.js`, `reorderRequestsRules.test.js` (82) | Read gains a self-scoped PARTS_ASSOCIATE branch (via the linked `reorder_requests` doc's `assignedToUserId`). Create gains `isActiveOperationalRole("PARTS_ASSOCIATE")` alongside admin/dispatcher, still fully field-validated. | `field-ops-app-vite/src/domain/reorderPurchaseOrders.js`, `field-ops-app-vite/src/hooks/useReorderPurchaseOrders.js`, `PartDetail.jsx` | none — client-direct `runTransaction()`; `functions/src/procurementService.ts`/`procurementBridge.ts` exist but are **not exported from `index.ts`**, so not a live trusted path today |
| `reorder_purchase_order_voids` | #100 | `reorderRequestsRules.test.js` | Read gains the identical self-scoped PARTS_ASSOCIATE branch. Create explicitly UNCHANGED (admin/dispatcher + assignee only) — PARTS_ASSOCIATE deliberately does NOT gain Void, per the governing Specification's Architecture Review decision. | `field-ops-app-vite/src/domain/reorderPurchaseOrders.js`, `useReorderPurchaseOrderVoids.js` | none — client-direct |
| `reorder_requests` | #100 (read + PR 3a update restructure) | `issue100PartsAssociateRules.test.js`, `issue100PartsManagerRules.test.js`, `reorderRequestsRules.test.js`, `accountsGovernedFieldsRules.test.js` (18), plus two verification-fixture test files | Read: 4 new additive branches (PARTS_MANAGER queue/oversight/history; PARTS_ASSOCIATE own assigned work). Update: the single shared admin/dispatcher gate is restructured into 8 self-contained branches — Approve/Reject/Cancel/Void stay admin/dispatcher-only (Void also assignee-gated); Start Purchasing/Post Purchasing Update/Record PO/Mark Received gain `\|\| isActiveOperationalRole("PARTS_ASSOCIATE")`; Assign gains `\|\| isActiveOperationalRole("PARTS_MANAGER")`. In-line comment flags a deliberate deviation from the Specification's illustrative code (merged clauses to stay under Firestore's Rules evaluation budget) for Architecture Review. | `field-ops-app-vite/src/domain/inventoryReorderRequests.js` (sole writer, explicitly "no Cloud Function — not required for this sprint's scope"), `useReorderRequests.js` | none — client-direct |
| `stock_locations` | Rules comment labels this **#226**, thematically WAREHOUSE_MANAGER scoped access (`docs/assessments/warehouse-manager-scoped-access.md`) — **flagging this issue-number discrepancy for the Owner's awareness**, not resolving it here | `warehouseManagerScopedAccessRules.test.js` (25) | Read gains `isAssignedToWarehouse(resource.data.warehouseId)` — WAREHOUSE_MANAGER sees only stock at their own `assignedWarehouseIds`; empty/absent list denies all. Create/update/delete still `false`. | `field-ops-app-vite/src/services/operationsQueries.ts` | none — read-only collection, no writer of any kind |
| `transfer_orders` | Same #226-labeled discrepancy as above | `warehouseManagerScopedAccessRules.test.js` | Read gains `isAssignedToWarehouse(fromWarehouseId) \|\| isAssignedToWarehouse(toWarehouseId)`. Create/update/delete still `false`. | `field-ops-app-vite/src/services/operationsQueries.ts` | none — read-only |
| `warehouses` | Same #226-labeled discrepancy as above | `warehouseManagerScopedAccessRules.test.js` | Read gains `isAssignedToWarehouse(warehouseId)` directly on the doc's own id. Create/update/delete still `false`. | `field-ops-app-vite/src/services/operationsQueries.ts` | none — read-only |
| `accounts` | **Not #15/#100/#226/#325** — Commercial Profile (parent Issue #175, `docs/specifications/account-commercial-profile-and-financial-forecast-horizons.md`) | `accountsGovernedFieldsRules.test.js` (18) | Adds field-level governance on two enum fields (`paymentTerms`, `taxStatus`): valid-enum enforced for everyone including admin; a non-admin (dispatcher) may `create` only at the safe baseline (both unset) and may `update` only if those two fields are left byte-identical — **admin alone may set or change them.** In-line Rules comment explicitly flags this as INTERIM, pending a future "PR 3b" trusted-writer conversion. | `field-ops-app-vite/src/domain/accounts.js`, `accountPortfolio.js`, `AccountForm.jsx`, `AccountDetail.jsx`, `WorkOrderWizard.jsx`, `EquipmentRegister.jsx` | none today (client-direct); a future PR 3b is the documented plan, not yet built |

**⚠ Behavior-tightening risk, distinct from `equipment`'s "already-broken, this
fixes it" case:** `AccountForm.jsx` (checked directly) contains **no role-based
UI gating** on `paymentTerms`/`taxStatus` — any user who can open the form can
attempt to change them. If a dispatcher currently edits these two fields
successfully in production (plausible, since this governance branch is new
since the baseline), **this deploy will newly deny that specific edit** with a
real permission-denied error, where none existed before. This is a deliberate,
specification-driven tightening, not a bug — but it is a genuine behavior
change to an already-working path, not merely closing an already-broken gap.
**Recommend the Owner confirm this is expected/communicated to Commercial
Profile stakeholders before Stage 1**, or flag it for the Owner's live
verification pass (§9 row analogous to the equipment check).

---

## 4. Every exported Function — enumeration and classification

`functions/src/index.ts` exports exactly **17 functions**. None are deployed
today (§1). Classified into three buckets per this task's instruction.

| Function | Issue | Client calls it today? | Rules dependency | Classification |
|---|---|---|---|---|
| `resolveEffectiveAccessCallable` | #226 | **Yes** — `useReportCapabilities.js`; fails closed (deny) if unreachable, scoped only to Reporting nav gating, not app-wide | none new (reads `roleAssignments`/`users`, already-deployed-shape) | **Required for initial catch-up** |
| `runReportDefinitionCallable` | #325 D-FN | **Yes** — `reportExecutionSeam.js`; resolves to the honest "unavailable" outcome if unreachable, never a crash/fallback | none new | **Required for initial catch-up** |
| `createSavedDefinitionCallable` | #325 W-SAVE | **Yes** — `savedReportService.js`; same graceful "unavailable" outcome | `reportDefinitions` (new, deny-all to clients — this Function is the only path) | **Required for initial catch-up** |
| `getSavedDefinitionCallable` | #325 W-SAVE | Yes, same file | same | **Required for initial catch-up** |
| `listSavedDefinitionsCallable` | #325 W-SAVE | Yes, same file | same | **Required for initial catch-up** |
| `renameSavedDefinitionCallable` | #325 W-SAVE | Yes, same file | same | **Required for initial catch-up** |
| `duplicateSavedDefinitionCallable` | #325 W-SAVE | Yes, same file | same | **Required for initial catch-up** |
| `deleteSavedDefinitionCallable` | #325 W-SAVE | Yes, same file | same | **Required for initial catch-up** |
| `createWorkOrder` | #15 | **Yes** — `workOrderService.ts`; **no graceful-degradation path found** (no `unavailable`/`not-found` handling like the #325 seams have) — Work Order creation is plausibly **actively broken** in production today, matching `docs/CLAUDE_CONTEXT.md`'s own long-standing note ("real Work Order creation still blocked on Cloud Functions deployment") | none new — `fieldops_wos`/`counters` Rules unchanged since the baseline, already live, `allow create, update, delete: if false` (Admin-SDK/Function-only, zero Rules risk either way) | **Recommended for initial catch-up** (see note below — this is a scope decision for the Owner, not assumed) |
| `transitionWorkOrder` | #15 | Yes, same file; also the sole writer of `inventory_transactions` (§3c) | same as above | **Recommended for initial catch-up** |
| `updateWorkOrderExecutionData` | #15 | Yes, same file | same as above | **Recommended for initial catch-up** |
| `grantRole` | #226 Row 7 | No — `AdminUsers.jsx`/`AdminRolesPermissions.jsx` reference Role names/types for display only; no `httpsCallable` found | writes `roleAssignments`/`auditEvents`, both new deny-all collections | **Later activation wave** — explicitly Admin-mutation, matches this task's own stop condition (RoleAssignments/Admin activation); deployment manifest already documents this needs a separate, later Owner authorization (Implementation Plan Row 19+) |
| `revokeRole` | #226 Row 7 | No | same | **Later activation wave** |
| `assignApprovedRole` | #226 Row 7 | No | same | **Later activation wave** |
| `setUserStatus` | #226 Row 7 | No | same | **Later activation wave** |
| `approveAccessRequest` | #226 Row 7 | No | writes `accessRequests`/`auditEvents` | **Later activation wave** |
| `rejectAccessRequest` | #226 Row 7 | No | same | **Later activation wave** |

**"Remain undeployed" bucket: empty.** Every one of the 17 functions has a
documented purpose and an eventual activation path — none is recommended for
indefinite non-deployment. The two non-"initial catch-up" functions groups are
"not yet," not "never":
- The 3 Work Order functions are a **scope-expansion judgment call** for the
  Owner — see §6 Stage 2. They were not part of the original #325-scoped
  authorization package, but meet the same low-risk bar (zero new Rules
  dependency, actively fixing rather than newly breaking, green CI) and close a
  real, already-documented production gap.
- The 6 Row 7 access commands are **deliberately excluded from this
  authorization** — deploying them is Admin activation, which this task's own
  stop condition places off-limits. They remain queued for their own future,
  separately-scoped wave.

---

## 5. #325-specific deployment detail (from the prior package, still accurate)

Unchanged from `docs/deployment/issue-325-production-authorization-package.md`:
all 8 #325/#226 functions are confirmed `onCall({ region: "us-central1" }, ...)`
in `functions/src/index.ts`; the `reportDefinitions` collection is exactly
`allow read, write: if false` with no admin override; a saved definition confers
no report-data access (execution independently reauthorizes through D-FN every
time). See that document (still merged, PR #356) for the full #325-only detail;
this document's §6 below folds it into the unified staged plan.

---

## 6. Dependency-safe staged deployment plan

**Firestore Rules cannot themselves be staged — one ruleset, one atomic deploy,
deploys everything in §3 simultaneously.** "Staged" therefore means: the single
mandatory Rules deploy, followed by ordered, independently-authorizable
Function deployment waves. No stage after Rules leaves a client workflow that
did NOT already fail before this deploy newly stranded on a missing Function
(verified in §7) — Rules deploying only ever *fixes* (`equipment`) or
*tightens-with-a-flagged-risk* (`accounts`) existing behavior; it never
activates a NEW client call path that a Function must simultaneously satisfy,
because every #325/#226 client call path (Stage 1) already degrades gracefully
and every #15 client call path (Stage 2) is already broken today, Rules or not.

### Stage 0 — Firestore Rules (mandatory, atomic, first)

Pre-flight (must all pass):
```bash
git rev-parse HEAD            # must read 2f4ec13d6d9b1cf7b6d2b293dfd66a7cb136d25e
git status --porcelain        # must be empty
diff firestore.rules field-ops-app-vite/firestore.rules   # must produce no output
```
Deploy:
```bash
firebase deploy --only firestore:rules --project taylor-parts
```
**Verification after this stage** (§9 row 0): confirm the `equipment` read path
now succeeds for an admin/dispatcher test read (was failing before); confirm
the `accounts` `paymentTerms`/`taxStatus` tightening behaves as documented for
both an admin and a non-admin test write. No Function call is exercised at this
stage — Stage 0 is Rules-only.

### Stage 1 — #325 / #226 Functions (same maintenance window as Stage 0, recommended)

```bash
firebase deploy --project taylor-parts --only \
  functions:resolveEffectiveAccessCallable,\
functions:runReportDefinitionCallable,\
functions:createSavedDefinitionCallable,\
functions:getSavedDefinitionCallable,\
functions:listSavedDefinitionsCallable,\
functions:renameSavedDefinitionCallable,\
functions:duplicateSavedDefinitionCallable,\
functions:deleteSavedDefinitionCallable
```
**Verification after this stage:** §9 rows 1–9 (the full matrix carried over
from the prior #325 package).

### Stage 2 — Issue #15 Work Order Functions (separately authorizable; recommended bundled with Stage 1, Owner's call)

```bash
firebase deploy --project taylor-parts --only \
  functions:createWorkOrder,functions:transitionWorkOrder,functions:updateWorkOrderExecutionData
```
No Rules change accompanies this stage — `fieldops_wos`/`counters` are already
live (§3b). **Verification after this stage:** §9 row 10 — a real Work Order
create → transition → execution-data-update cycle by a test technician/admin
principal; confirm `inventory_transactions` ledger entries land correctly.

### Explicitly NOT staged in this authorization — later activation wave

Row 7's 6 access commands (`grantRole`, `revokeRole`, `assignApprovedRole`,
`setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`) — queued for a
future, separately-scoped Owner authorization once Admin UI is ready and Admin
activation is explicitly in scope. No command is given for this wave; §4's
table stands as its specification.

### Rollback / restoration (any stage)

**Functions (any wave):**
```bash
firebase functions:delete <space-separated function names for that wave> \
  --project taylor-parts --region us-central1 --force
```
**Rules:**
```bash
git worktree add /tmp/rules-rollback 393f054883a970af2c39f1f193aff7dec8b12c11
cd /tmp/rules-rollback
shasum -a 256 firestore.rules   # must match §2's captured live hash before proceeding
firebase deploy --only firestore:rules --project taylor-parts
git worktree remove /tmp/rules-rollback
```
If §2's captured live hash didn't match `393f054`'s hash, restore to the actual
captured text instead of this commit.

---

## 7. Confirmation: no Rules stage strands a client workflow on an undeployed Function

Explicitly checked, one row per live client call path that touches a
Function-gated or newly-Rules-affected collection:

| Client call path | Degrades gracefully if its Function is undeployed? | Stranded by Stage 0 alone? |
|---|---|---|
| `useReportCapabilities.js` → `resolveEffectiveAccessCallable` | Yes — fails closed to deny, scoped only to Reporting nav visibility | No — same behavior whether Rules have deployed or not |
| `reportExecutionSeam.js` → `runReportDefinitionCallable` | Yes — resolves the honest `unavailable` outcome, never throws | No |
| `savedReportService.js` → 6 saved-definition callables | Yes — `savedReportServiceOutcome.js` has a first-class `unavailable` outcome | No |
| `workOrderService.ts` → `createWorkOrder`/`transitionWorkOrder`/`updateWorkOrderExecutionData` | **No graceful path found** | **Already broken before this deploy, unchanged by it** — Rules for `fieldops_wos`/`counters` are already live (§3b); Stage 0 does not newly cause or worsen this. Closing it is Stage 2's job, not Stage 0's obligation. |
| `useEquipment.js` → `equipment` (client-direct, no Function) | N/A — no Function involved | No — Stage 0 is expected to FIX this path, not strand it |
| `AccountForm.jsx` → `accounts` (client-direct, no Function) | N/A — no Function involved | No new Function dependency; flagged instead as a behavior-tightening risk (§3c), not a stranding |

**Conclusion: Stage 0 (Rules) never leaves a client workflow newly dependent on
an undeployed Function that wasn't already in that state.** The one real
"already broken" path (#15) is a pre-existing condition this review surfaces
and Stage 2 is offered to close, not a new risk this deploy introduces.

---

## 8. Complete regression suite results — frozen head `2f4ec13`

All suites re-run fresh at this exact commit (`functions/src` and
`firestore.rules` confirmed unchanged since PR #354's merge commit `cd12393`;
this consolidated review additionally re-ran the Work Order/operator-script
suites and the full client application suite, neither of which the prior
package covered).

| Suite | Result |
|---|---|
| Firestore Rules Regression (pinned, 11 suites, fresh emulator per suite) | **423 passed, 0 failed** |
| `test:access` (6 files) | **121 passed, 0 failed** |
| `test:audit` | **54 passed, 0 failed** |
| `test:trustedWriter` | **37 passed, 0 failed** |
| `test:effectiveAccess` | **23 passed, 0 failed** |
| `test:claims` | **5 passed, 0 failed** |
| `test:reporting` (parity + D-FN + saved-definition commands) | **59 passed, 0 failed** |
| `test:operatorAccess` | **20 passed, 0 failed** |
| `test:operatorAccessExecute` | **2 passed, 0 failed** |
| `test:transitionEngine` | **24 passed, 0 failed** |
| `test:workOrderEngineFunctions` | **29 passed, 0 failed** |
| `field-ops-app-vite` application suite (`npm test`, 40 files) | **499 passed, 0 failed** |
| **Total** | **1,296 passed, 0 failed** |

CI (GitHub Actions), merge commit `cd1239397a160899263c2f44a1c0651275e32e90`
(PR #354 — the commit that produced this exact `firestore.rules`/`functions/src`
state) — 12/12 checks green, links unchanged from the prior package. Frozen head
`2f4ec13`'s own CI (docs-only PR #356): Vite Build Check
(https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29796477707) and
Deploy Field Ops to GitHub Pages
(https://github.com/TaylorService-spec/Taylor_Parts/actions/runs/29796477757),
both green.

---

## 9. Production verification matrix

Row 0 and row 10 are new in this consolidated review; rows 1–9 are carried over
unchanged from the prior #325-only package, still accurate.

| # | Scenario | Method | Expected result |
|---|---|---|---|
| 0 | Stage 0 (Rules-only) behavior check | Read-only: attempt an `equipment` read as admin/dispatcher (expect success, previously likely denied); attempt an `accounts.paymentTerms` write as a non-admin test principal (expect denial if changing the value) | `equipment` read now succeeds; `accounts` governed-field write behaves exactly as §3c documents — confirms Stage 0 landed as designed before any Function deploys |
| 1 | Denied / unassigned principal | Call `resolveEffectiveAccessCallable` or any saved-definition callable as an authenticated user with no `roleAssignments` doc | `permission-denied` or an all-`false` decisions map — never silent allow |
| 2 | Valid Owner | `createSavedDefinitionCallable` → `listSavedDefinitionsCallable` → `getSavedDefinitionCallable` as the approved test principal | Create succeeds; list includes it; get returns it, correct `ownerUid` |
| 3 | Assignment-version consistency | Temporarily set `accessVersionAtGrant` above the principal's current `accessVersion` | Every subsequent trusted resolver/callable decision denies because a future-dated assignment is malformed/stale; restore the assignment immediately after the check |
| 4 | Revoked assignment and client freshness | Flip the assignment to `status: "disabled"` and bump `accessVersion`; verify the callable denies and a client holding the prior version clears cached grants before refresh | Server authorization denies immediately; the stale client decision never grants. A version bump alone does not revoke another active older assignment |
| 5 | Field omission | `runReportDefinitionCallable` with a definition selecting an ungranted field | Field dropped from output, or denied outright — never leaked |
| 6 | Saved-definition CRUD | Full create → rename → duplicate → delete cycle | Each step succeeds once; deleted id 404s afterward |
| 7 | Cross-principal denial | A second principal (with/without the capability) attempts `get`/`rename`/`duplicate`/`delete` on the first principal's definition | Denied identically regardless of capability or target existence (existence-oracle fix, PR #354 review round 1 — re-verify against real production state) |
| 8 | Immutable audit | Read `auditEvents` (Admin SDK, read-only) after scenario 6 | Exactly one `applied` event per mutating action, none for get/list, none overwritten |
| 9 | Rollback triggers | Any of: 1/3/4 unexpectedly allow; 7 leaks existence; 8 shows zero/duplicate events; any unexpected client error | **Stop.** Run §6's rollback procedure for the affected stage. No live partial fix. |
| 10 | Stage 2 (#15) verification, if authorized | A real create → transition → execution-data-update cycle by a test technician/admin; confirm `inventory_transactions` entries | Work Order created, transitions apply per the existing transition-engine rules, ledger entries correct, no error for the previously-broken path |

Verification is complete only when every authorized stage's rows pass exactly
as specified. Row 9 is the abort path, not optional.

---

## 10. Required test RoleAssignment plan — NO ASSIGNMENT PERFORMED

Unchanged from the prior package: verification requires exactly one test
principal holding the governed `owner` Role (global scope), exact document
shape specified below, for a **separate, explicit Owner Production Data
Authorization** — no assignment has been created.

```json
// Collection: roleAssignments, doc id: any fresh, unused id
{
  "id": "<same as doc id>",
  "principalUid": "<approved test/verification principal's real Firebase Auth uid>",
  "roleId": "owner",
  "scope": { "type": "global" },
  "grantedBy": "<Owner's own uid, or an explicit manual-grant marker>",
  "grantedAt": "<Firestore server timestamp at time of write>",
  "status": "active",
  "accessVersionAtGrant": "<same value as users/{uid}.accessVersion at grant time>"
}
```
`users/{uid}.accessVersion` for that principal: existing value, or `0` if this
is their first-ever grant. No principal is nominated in this document — the
Owner must name the uid(s). Revocation for row 4/9 requires disabling the
assignment. The accompanying `accessVersion` bump invalidates cached client/token
state and triggers refresh; it does not independently revoke active assignments.

---

## 11. Blast radius, stop conditions, and Owner authorization requests

### Blast radius

- **Stage 0 is instantaneous and global** for every collection in §3, the
  moment `firebase deploy --only firestore:rules` completes.
- **`equipment`**: expected fix, not a break (§3a) — verify, don't assume.
- **`accounts` governed fields**: a real, flagged behavior tightening for an
  already-working, UI-ungated path (§3c) — confirm expected with Commercial
  Profile stakeholders before Stage 0, or accept the new permission-denied
  surface as intended per the Specification.
- **6 new deny-all collections**: zero blast radius by construction — nothing
  reads them directly today.
- **Stage 1 (#325/#226 functions)**: already-live client code (Saved Reports UI,
  Reporting nav gate) currently degrades gracefully to "unavailable"/deny;
  deploying Stage 1 activates real functionality for the first time. Recommend
  deploying Stage 0 and Stage 1 in the same maintenance window — Rules alone,
  without Stage 1, leaves the already-live Saved Reports UI inert (not broken,
  per §7, but pointlessly inert) until Stage 1 follows.
- **Stage 2 (#15 functions)**: fixes an already-broken, already-documented
  production gap (Work Order creation). Zero Rules risk. Scope-expansion
  judgment call for the Owner — not part of the original #325 authorization.
- **Later wave (Row 7, 6 access commands)**: explicitly not authorized by this
  document. No blast radius today (zero live callers); deploying them later is
  Admin activation and needs its own dedicated authorization + verification.
- **No production data is read, written, or migrated by this document or any
  command in it.** Functions deploy uploads code; Rules deploy uploads a
  ruleset. Neither touches a document.
- **10 changed pre-existing collections (§3c) beyond `equipment`/`accounts`**
  are additive read-widenings for Issue #100 operational roles (PARTS_MANAGER/
  WAREHOUSE_MANAGER/PARTS_ASSOCIATE) or scoped-visibility grants (Warehouse
  Manager's `assignedWarehouseIds`) — every one only WIDENS who can read, never
  narrows an existing admin/dispatcher grant, and every write-path constraint
  is unchanged or additively loosened under the same explicit role check
  pattern already covered by the cited test files. Lowest-risk category in this
  delta.

### Stop conditions — do not proceed with any stage if any of these hold

1. §2's captured live Rules hash doesn't match `393f054`'s hash — reconcile first.
2. `git rev-parse HEAD` at deploy time isn't exactly `2f4ec13d6d9b1cf7b6d2b293dfd66a7cb136d25e`, or the tree isn't clean.
3. The root/client-mirror `firestore.rules` copies have drifted.
4. Any suite in §8 doesn't reproduce green when re-run immediately before deploy.
5. The Owner hasn't separately authorized §10's RoleAssignment write (Stage 1 verification cannot complete without it).
6. Any row of §9 fails or cannot be completed after its stage deploys.
7. The Owner has not confirmed the `accounts.paymentTerms`/`taxStatus` tightening (§3c) is expected.

### Owner authorization requests — exactly these, nothing more

1. **Firestore Rules deploy** — `firebase deploy --only firestore:rules --project taylor-parts` at exactly `2f4ec13d6d9b1cf7b6d2b293dfd66a7cb136d25e`, contingent on §2's hash reconciliation and §3c's confirmation.
2. **Stage 1 Functions deploy** — the 8 named #325/#226 functions, same commit, recommended same maintenance window as (1).
3. **Stage 2 Functions deploy (Owner's scope decision)** — the 3 named #15 Work Order functions, same commit; may be bundled with (2) or authorized separately.
4. **Owner Production Data Authorization** — the single test `roleAssignments` write in §10, required before §9's verification matrix can run.

**Not requested and explicitly out of scope:** Row 7's 6 access commands
(later activation wave), any credential access beyond the read-only attempt
already made and reported in §1, any production data write beyond §10's single
test grant, and any claims change.
