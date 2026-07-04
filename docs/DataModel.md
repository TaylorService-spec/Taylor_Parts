# Firestore Data Model

This documents the Firestore schema as a **living spec with reality markers** — every collection/field below is tagged so a reader never has to guess whether something is real:

- ✅ **IMPLEMENTED** — has live data in production, verified either by reading the write path in code or by a direct Admin SDK check against the `taylor-parts` project.
- 🧪 **SCAFFOLDED, UNUSED** — the code to write it exists, but nothing ever calls it. No data, no consumer.
- ❌ **NOT BUILT** — described in an earlier version of this doc as if real, but no corresponding code exists anywhere in `src/`. Kept here (clearly marked) so the idea isn't lost, not because it's live.

Verified directly against `domain/constants.js`, `firebase/collectionStore.js`, `domain/jobActions.js`, and a direct Admin SDK listing of the live database's collections (`fieldops_jobs`, `fieldops_technicians`, `pcc`, `users` — confirmed 2026-07-04; **no other collections exist in production**, which is what caught the `phase`/`fieldops_inventory`/`fieldops_job_events` drift below).

## Collections

### `fieldops_jobs` — ✅ IMPLEMENTED

The core execution unit. Defined in `domain/constants.js` (`JOBS_COLLECTION`), written only through `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()`/`createJob()` (the sole sanctioned write path — see `docs/PROJECT_ARCHITECTURE.md`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `customer` | string | Customer name. Jobs do not own a separate customer entity/ID today — this is a plain string. |
| `description` | string | |
| `status` | string enum | `JOB_STATUS`: `open \| assigned \| in_progress \| complete`. The single canonical status enum — enforced since Sprint 1, no duplicates permitted anywhere. |
| `technicianId` | string \| null | Set by `assignJob()`, transactionally alongside the technician's own status. Cleared back to `null` by `updateJobStatus()`'s `ASSIGNED→OPEN` demotion branch, alongside resetting the technician's own `status`/`currentJobId` — see `fieldops_technicians` below. |
| `workOrderId` | string \| null | Groups jobs under a Work Order (see below — derived, not a real linked document today). |
| `address` | map `{ street, city, state, zip }`, optional | Additive field. `geo` (lat/lng) is a documented placeholder, not implemented yet — reserved for once a geocoding source is chosen. |
| `createdAt` | number | `Date.now()`, set once at creation (`firebase/collectionStore.js`). |
| `priority` | string enum, optional | **Dispatch Control Tower v1 addition.** `JOB_PRIORITY`: `low \| medium \| high \| urgent`. Independent of `status` — has no transition rules, feeds only `domain/dispatchEngine.js`'s ranking. Jobs without this field score as if `medium`; `createJob()` does not write a default, same pattern as `address`. |
| `assignedAt` | number, optional | **Dispatch Control Tower v1 addition.** `Date.now()`, set by `assignJob()`'s transaction. Not yet consumed by risk scoring (`jobRiskScoring.js` still uses `createdAt`); only `dispatchEngine.js` reads it indirectly via `computeAgeHours`. |
| `scheduledFor` | optional | **Dispatch Control Tower v1 addition.** Not yet read by any scoring or UI logic — reserved for a future sprint. |
| `estimatedDuration` | number (minutes), optional | **Dispatch Control Tower v1 addition.** Feeds `dispatchEngine.js`'s "low priority + long job" penalty (threshold: 120 minutes). |

**❌ NOT BUILT, previously mis-documented here as real:** `phase` (a `JOB_PHASE` enum: `CREATED \| ASSIGNED \| EN_ROUTE \| IN_PROGRESS \| PARTS_USED \| COMPLETED`), `partsRequired`, `partsReserved`. None of these fields, nor a `domain/jobPhaseWorkflow.js`, exist anywhere in `src/` — confirmed by grep, zero matches. `createJob()`'s actual write payload (verified above) never included them. If richer in-progress granularity is wanted later, `FieldMode.jsx`'s existing `travelStage` local state (`NOT_STARTED \| TRAVELING \| ARRIVED`) is the closest real analog today — and it's deliberately **not** persisted (explicit decision, current sprint: keep it UI-only "interaction state," not "system state," while Dispatch Control Tower and a real inventory system are still in flight).

### `fieldops_technicians` — ✅ IMPLEMENTED

Defined in `domain/constants.js` (`TECHNICIANS_COLLECTION`), written only through `domain/jobActions.js`'s `createTechnician()` and, for status, `assignJob()`/`updateJobStatus()`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `name` | string | |
| `phone` | string | |
| `status` | string enum | `TECH_STATUS`: `available \| on_job \| off_shift` |
| `createdAt` | number | Same `Date.now()` convention as jobs |
| `active` | boolean, optional | **Dispatch Control Tower v1 addition.** Defaults `true` at creation. `false` marks a technician deactivated without deleting their doc/history; Dispatch.jsx's workload panel shows them muted/"Inactive" rather than hiding them. |
| `currentJobId` | string \| null, optional | **Dispatch Control Tower v1 addition.** Set by `assignJob()`'s transaction, cleared by `updateJobStatus()` on both its `COMPLETE` branch and its `ASSIGNED→OPEN` demotion branch. |
| `maxConcurrentJobs` | number, optional | **Dispatch Control Tower v1 addition.** Defaults `1` at creation. Stored and displayed, **not yet enforced** as a hard cap on assignment in v1. |
| `lastActive` | number, optional | **Dispatch Control Tower v1 addition.** `Date.now()`, set at creation and bumped by both `assignJob()` and `updateJobStatus()`'s technician-doc writes. |
| `region` | string, optional | **Dispatch Control Tower v1 addition.** Not yet read by any scoring or UI logic — reserved for future geographic dispatch matching. |

**Deliberately not a field:** active job count. It's always *derived* live (`domain/dispatchScoring.js`'s `activeJobCount()`), never stored.

### `customers` — 🧪 SCAFFOLDED, UNUSED

`domain/customers.js` defines `customersStore = makeCollectionStore("customers")`. **Nothing in `src/` ever calls it** — confirmed by grep, zero other references. No customer entity exists anywhere the app actually runs; `fieldops_jobs.customer` (see above) remains a plain string.

### `workOrders` — 🧪 SCAFFOLDED, UNUSED

`domain/workOrders.js` defines a `workOrdersStore` pointed at a Firestore `workOrders` collection, with a documented (but unenforced) shape: `{ id, customerId, customerName, status, priority, scheduledDate, createdAt, updatedAt }`. **No code creates documents there** — confirmed, zero other references to `workOrdersStore` in `src/`.

The real, working "Work Order" concept today is **entirely derived**: jobs carry a `workOrderId` string, and `domain/workOrderLifecycle.js`'s `computeWorkOrderState()` groups jobs client-side by that field to derive a state (`READY \| BLOCKED \| IN_PROGRESS \| COMPLETED`). **A Work Order never owns its own status** — it's always computed from its child Jobs' real statuses, never written independently. `domain/workOrderScoring.js` (wraps that state in the shared Signal envelope for Control Tower) and `domain/workOrderValidation.js` (read-only anomaly detection, e.g. duplicate job IDs, orphaned technician references) both sit on top of this same derived state — neither writes to Firestore either.

### Inventory — ✅ IMPLEMENTED, but in-memory only (not Firestore)

`demo/InventoryContext.jsx` is the real, working inventory system (`modules/inventory/Inventory.jsx`'s screen reads it) — Warehouse stock, Truck stock, and per-job parts-used tracking, all `useState`. **No Firestore collection backs it; state resets on page reload.** This is an explicit, documented design choice from Sprint 3.6 ("hard rule: no new Firestore collections" — a network round-trip risks visible lag or a dropped write mid-demo that in-memory `setState` can't have), not an oversight.

**❌ NOT BUILT, previously mis-documented here as real:** a persisted `fieldops_inventory` collection (`quantityAvailable`/`quantityReserved` split, doc ID `${locationType}__${locationId}__${partId}`) and a `services/inventoryService.js`. Neither exists — there is no `services/` directory in this project at all, and no `INVENTORY_COLLECTION` constant in `domain/constants.js`. If a real, persisted, multi-location inventory system is built later, the available/reserved split described in the earlier version of this doc remains a reasonable design to reuse — it just hasn't been built.

### Activity Timeline / events — ✅ IMPLEMENTED, but derived only (not persisted)

`domain/eventTypes.js` (vocabulary: `EVENT_TYPE`, severity, icons, human-readable labels) + `domain/eventModel.js` (builds/sorts/groups/describes events) + `domain/eventValidation.js` (structural anomaly detection) + `domain/timelineBuilder.js` (the actual synthesizer) together produce the Activity Timeline panel's event stream **entirely on read**, from existing `fieldops_jobs`/derived Work Order data. Explicitly documented in-code: "never persisted -- there is no Firestore event collection, no audit log, no Cloud Function writing them."

**❌ NOT BUILT, previously mis-documented here as real:** a persisted `fieldops_job_events` collection and a `services/jobEventService.js`. Neither exists — no `JOB_EVENTS_COLLECTION` constant, no `services/` directory. The derived-only system above is the entire real implementation.

### `users` — ✅ IMPLEMENTED

Role docs for Firebase Authentication accounts. Defined in `domain/constants.js` (`USERS_COLLECTION`, `ROLES`). Doc ID is the Firebase Auth **UID**. `auth/AuthContext.jsx` fetches this once per sign-in via `fetchUserDoc()` (with retry/backoff) and exposes `role`/`technicianId` alongside `user`.

| Field | Type | Notes |
|---|---|---|
| `email` | string | Mirrors the Firebase Auth account's email; not authoritative (Auth is), kept for convenience when reading the collection directly. |
| `role` | string enum | `ROLES`: `admin \| dispatcher \| technician`. Gates which NAV tabs a signed-in user sees (`ROLE_NAV_ACCESS` in `domain/constants.js`, applied in `App.jsx`). A user with no doc, or a doc missing `role`, sees a "no access" screen (`auth/AuthGate.jsx`) rather than the app. |
| `technicianId` | string, optional | **Dispatch Control Tower v1 addition.** Links this Auth user to their `fieldops_technicians` doc. Admin-set, same provisioning model as `role`. Read by `AuthContext.jsx` and used both to scope `FieldMode.jsx`'s job query and by `firestore.rules`' technician self-service checks. |

**Provisioning is admin-only, not self-service.** Firestore rules allow a user to *read* only their own `users/{uid}` doc, and disallow client writes entirely (`allow write: if false`) — a role doc (and `technicianId` link) must be created via the Firebase console or an Admin SDK script.

**Known operational gotcha (hit during this sprint's testing):** the Firestore console's document/field editors require clicking their confirm/checkmark controls to actually persist — navigating away before that fully commits can leave the console *displaying* a value that was never actually saved server-side. If a `role`/`technicianId` lookup ever mysteriously comes back `null` despite "definitely having created the doc," verify with a hard console refresh (or a direct Admin SDK read) before assuming it's a code bug.

### `pcc` — ✅ IMPLEMENTED, legacy/unrelated

Exists in the live database (confirmed, 9 docs) but belongs to the separate, legacy Parts Control Center app (the repo-root `index.html`), not Field Ops. Not part of this schema.

### No `dispatchQueue` collection

Dispatch state lives entirely on the job document itself — `status` and `technicianId` are the complete picture of "is this job assigned, to whom." Ranked assignment suggestions (`domain/dispatchScoring.js`'s `computeDispatchRecommendations()`) are computed live, in memory, never persisted.

**Dispatch Control Tower v1's priority engine follows the same philosophy.** `domain/dispatchEngine.js`'s `rankJobsByPriority()` computes a `priorityScore` for every non-complete job live, on read — no `dispatchQueue` (or similarly named) collection was introduced. It's a distinct concept from `computeDispatchRecommendations()`: that function scores technician-for-job fit (who should take this job); `dispatchEngine.js` scores job-for-attention (which job the dispatcher should work next), driven by `priority` plus modifiers (unassigned-staleness, repeat-customer, low-priority+long-duration; an SLA-nearing-breach modifier is a documented no-op stub pending a future SLA-deadline field).

## Current Firestore rules — ✅ DEPLOYED, verified live

`firestore.rules` (repo root, mirrored in `field-ops-app-vite/`) — **confirmed via a direct Admin SDK `getFirestoreRuleset()` pull against the live `taylor-parts` project (2026-07-04) that this exact content is the active, released ruleset, not just what's committed:**

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function userData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function userRole() {
      return userData().role;
    }

    function isOwnTechnician(technicianId) {
      return technicianId == userData().technicianId;
    }

    function isAdminOrDispatcher() {
      return isSignedIn() && userRole() in ['admin', 'dispatcher'];
    }

    function isTechnician() {
      return isSignedIn() && userRole() == 'technician';
    }

    match /fieldops_jobs/{jobId} {
      allow read: if isAdminOrDispatcher()
        || (isTechnician() && isOwnTechnician(resource.data.technicianId) && resource.data.status != 'complete');

      allow create, delete: if isAdminOrDispatcher();

      allow update: if isAdminOrDispatcher()
        || (isTechnician()
            && isOwnTechnician(resource.data.technicianId)
            && request.resource.data.technicianId == resource.data.technicianId
            && request.resource.data.customer == resource.data.customer);
    }

    match /fieldops_technicians/{techId} {
      allow read: if isAdminOrDispatcher() || (isTechnician() && isOwnTechnician(techId));

      allow create, delete: if isAdminOrDispatcher();

      allow update: if isAdminOrDispatcher()
        || (isTechnician()
            && isOwnTechnician(techId)
            && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['status', 'currentJobId', 'lastActive']));
    }

    // Role docs are provisioned by an admin (console or Admin SDK), never
    // by the client -- a user must not be able to grant themself a role.
    match /users/{userId} {
      allow read: if isSignedIn() && request.auth.uid == userId;
      allow write: if false;
    }
  }
}
```

**Technician identity is resolved one way, always:** `isOwnTechnician()` compares against `users/{uid}.technicianId` only — no fallback to matching `request.auth.uid` directly against a technician doc ID.

Note: `pcc` has its own separate rules concern (legacy app, out of scope here). Nothing in this ruleset gates it.

**Why `fieldops_jobs`' read rule requires a matching query filter:** Firestore rules cannot filter query *results* by a condition absent from the query's own `where()` clauses — a query that could return a doc failing the rule is rejected entirely, not silently filtered. `FieldMode.jsx`'s job query therefore filters on both `technicianId` and `status != complete` to match this rule exactly (composite index deployed in `firestore.indexes.json`, confirmed live alongside the rules).

**Why `fieldops_technicians`' update rule is field-scoped:** `updateJobStatus()`'s transaction writes to the *assigned technician's own doc* (`status`/`currentJobId`/`lastActive`) whenever a technician-role account completes their own job. The rule carves out exactly those three fields for self-service, without opening `name`/`phone`/`maxConcurrentJobs`/`region`/`active` to self-edits.

**Honest limitation:** admin/dispatcher access remains a single, coarse gate — full read/write on `fieldops_jobs`/`fieldops_technicians`, no field-level or schema validation beyond the technician carve-outs above. Every business rule (valid status transitions, etc.) is enforced entirely client-side, in the domain layer (`canTransitionJob()`). A user hitting Firestore directly (browser console, a custom script, a compromised client) with an admin/dispatcher role bypasses all of that — rules provide authentication and technician-scoped authorization, not full data integrity, today.

**Deployment status:** this repo has no automated rules/index deployment (no CI step). Both the rules above and `firestore.indexes.json`'s composite index were deployed manually (`firebase deploy --only firestore:rules,firestore:indexes`) and independently re-verified live via Admin SDK — see `docs/Deployment.md` for the general process.

## Recommended direction for hardening rules (not implemented — documentation only)

1. **Enum validation.** Reject writes where `status` isn't one of the known `JOB_STATUS` values.
2. **Immutable `createdAt`.** Reject updates that change `createdAt` after creation, on any collection.
3. ~~**Non-negative inventory / append-only job events.**~~ **Not applicable** — there is no persisted `fieldops_inventory`/`fieldops_job_events` collection to harden (see above); both are in-memory or derived-only.
4. ~~**Technician self-service boundary.**~~ **Implemented in Dispatch Control Tower v1** — see "Current Firestore rules" above, deployed and verified live.

Rules-layer validation like the remaining items would need to mirror the transition table already defined in `domain/jobWorkflow.js` — keeping the two in sync would need to be an explicit discipline, not an afterthought.
