# Firestore Data Model

This documents the **actual, currently-implemented** Firestore schema — verified directly against the code (`domain/constants.js`, `firebase/collectionStore.js`, `services/*.js`, `firestore.rules`), not a proposed redesign. This project already has a live, working data model built across Sprints 1–4; nothing here introduces a new collection.

## Collections

### `fieldops_jobs`

The core execution unit. Defined in `domain/constants.js` (`JOBS_COLLECTION`), written only through `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()`/`createJob()` (the sole sanctioned write path — see `docs/PROJECT_ARCHITECTURE.md`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `customer` | string | Customer name. Jobs do not own a separate customer entity/ID today — this is a plain string. |
| `description` | string | |
| `status` | string enum | `JOB_STATUS`: `open \| assigned \| in_progress \| complete`. The single canonical status enum — enforced since Sprint 1, no duplicates permitted anywhere. |
| `technicianId` | string \| null | Set by `assignJob()`, transactionally alongside the technician's own status. |
| `workOrderId` | string \| null | Groups jobs under a Work Order (see below — derived, not a real linked document today). |
| `address` | map `{ street, city, state, zip }`, optional | Additive field. `geo` (lat/lng) is a documented placeholder, not implemented yet — reserved for once a geocoding source is chosen. Jobs created before this field existed simply have no address recorded; the UI (`modules/jobs/Jobs.jsx`) shows `—` for those. |
| `createdAt` | number | `Date.now()`, set once at creation (`firebase/collectionStore.js`). This is the **only** lifecycle timestamp the schema tracks — there's no `assignedAt`/`startedAt`/`completedAt`. Every age-based signal in the app (risk scoring, dispatch urgency) is an approximation built on this one field. |
| `phase` | string enum, optional | **Sprint 4 addition.** `JOB_PHASE`: `CREATED \| ASSIGNED \| EN_ROUTE \| IN_PROGRESS \| PARTS_USED \| COMPLETED`. Additive, richer-granularity tracking layered on top of `status` — never a replacement for it. Jobs written before Sprint 4 simply don't have this field. |
| `partsRequired` | map `{ [partId]: quantity }`, optional | **Sprint 4 addition.** What the job needs. |
| `partsReserved` | map `{ [partId]: quantity }`, optional | **Sprint 4 addition.** Running total reserved against inventory for this job (see `fieldops_inventory` below) — decremented as parts are consumed. |

### `fieldops_technicians`

Defined in `domain/constants.js` (`TECHNICIANS_COLLECTION`), written only through `domain/jobActions.js`'s `createTechnician()` and, for status, `assignJob()`/`updateJobStatus()`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `name` | string | |
| `phone` | string | |
| `status` | string enum | `TECH_STATUS`: `available \| on_job \| off_shift` |
| `createdAt` | number | Same `Date.now()` convention as jobs |

**Deliberately not a field:** active job count. It's always *derived* live (`domain/dispatchScoring.js`'s `activeJobCount()`), never stored — storing it would create a cached counter that can silently drift from the real jobs data. This applies broadly: anything computable from `fieldops_jobs` (Work Order state, risk severity, dispatch recommendations, technician availability) is computed on read, not persisted redundantly, anywhere in this codebase.

### Work Orders — no populated collection exists

`domain/workOrders.js` defines a `workOrdersStore` pointed at a Firestore `workOrders` collection, with a documented (but unenforced) shape: `{ id, customerId, customerName, status, priority, scheduledDate, createdAt, updatedAt }`. **No code creates documents there** — it's scaffolding from an earlier sprint, never wired to any UI.

The real, working "Work Order" concept today is **entirely derived**: jobs carry a `workOrderId` string, and `domain/workOrderLifecycle.js`'s `computeWorkOrderState()` groups jobs client-side by that field to derive a state (`READY \| BLOCKED \| IN_PROGRESS \| COMPLETED`). This is intentional, hard-enforced architecture (Sprint 3.4): **a Work Order never owns its own status** — it's always computed from its child Jobs' real statuses, never written independently. If real Work Order documents are ever introduced, this rule must not change; only what `workOrderId` points to would change.

### `fieldops_inventory` (Sprint 4)

Defined in `domain/constants.js` (`INVENTORY_COLLECTION`), written only through `services/inventoryService.js`. Deliberately separate from `demo/InventoryContext.jsx` (Sprint 3.6's in-memory-only demo inventory, which has no Firestore collection at all and is unrelated to this one).

Doc ID: `${locationType}__${locationId}__${partId}` (deterministic, so it can be read/written directly by ID without a query).

| Field | Type | Notes |
|---|---|---|
| `partId` | string | Also doubles as the doc's part identifier |
| `name` | string | |
| `locationType` | string enum | `LOCATION_TYPE`: `warehouse \| truck` |
| `locationId` | string | For `truck`, a technician's ID; for `warehouse`, a location identifier (e.g. `"central"`) |
| `quantityAvailable` | number | Total physical stock at this location |
| `quantityReserved` | number | How much of that stock is earmarked for jobs but not yet consumed |

**Why the available/reserved split, specifically:** "free to reserve" is always `quantityAvailable - quantityReserved`, never `quantityAvailable` alone — that's what prevents two jobs from both reserving the same physical stock. `consumePart()` can only draw down what a *specific job* itself reserved (tracked via that job's own `partsReserved` map, not a global pool), which is what actually prevents double-allocation, not just a quantity check. See `services/inventoryService.js` for the full transactional logic.

### `fieldops_job_events` (Sprint 4)

Defined in `domain/constants.js` (`JOB_EVENTS_COLLECTION`), written only through `services/jobEventService.js`.

| Field | Type | Notes |
|---|---|---|
| `jobId` | string | |
| `eventType` | string | e.g. `JOB_CREATED`, `PHASE_CHANGED`, `PART_RESERVED`, `PART_CONSUMED` |
| `payload` | map | Shape varies by `eventType` |
| `timestamp` | number | `Date.now()` |

This is a real, persisted event log — distinct from and not a replacement for Sprint 3.5's `domain/timelineBuilder.js`, which derives an in-memory activity timeline from `job.status`/`createdAt` on every render and writes nothing to Firestore. Both exist side by side today.

### `users`

Role docs for Firebase Authentication accounts. Defined in `domain/constants.js` (`USERS_COLLECTION`, `ROLES`). Doc ID is the Firebase Auth **UID** (not an auto-generated ID), so a role lookup is a direct `getDoc(doc(db, USERS_COLLECTION, uid))` — see `auth/AuthContext.jsx`, which fetches this once per sign-in and exposes it as `role` alongside `user`.

| Field | Type | Notes |
|---|---|---|
| `email` | string | Mirrors the Firebase Auth account's email; not authoritative (Auth is), kept for convenience when reading the collection directly. |
| `role` | string enum | `ROLES`: `admin \| dispatcher \| technician`. Gates which NAV tabs a signed-in user sees (`ROLE_NAV_ACCESS` in `domain/constants.js`, applied in `App.jsx`). A user with no doc, or a doc missing `role`, sees a "no access" screen rather than the app. |

**Provisioning is admin-only, not self-service.** Firestore rules allow a user to *read* only their own `users/{uid}` doc, and disallow client writes entirely (`allow write: if false`) — a role doc must be created via the Firebase console or an Admin SDK script. This is deliberate: if the client could write its own role doc, any authenticated user could grant themselves `admin`.

### No `dispatchQueue` collection

Dispatch state lives entirely on the job document itself — `status` and `technicianId` are the complete picture of "is this job assigned, to whom." `modules/dispatch/Dispatch.jsx` queries `fieldops_jobs` directly and filters for jobs without a `technicianId`. Ranked assignment suggestions (`domain/dispatchScoring.js`'s `computeDispatchRecommendations()`) are computed live, in memory, from the same jobs/technicians snapshot — never persisted. Introducing a separate queue collection that tracks assignment state independently would create two places that can disagree about whether a job is assigned, which is exactly the "duplicate dispatch logic" pattern this project has avoided since Sprint 1.

## Current Firestore rules

`field-ops-app-vite/firestore.rules` (mirrored at the repo-root `firestore.rules`, which is what `firebase.json` actually points at for deploy), verbatim:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    match /fieldops_jobs/{jobId} {
      allow read: if isSignedIn();

      allow write: if isSignedIn();
    }

    match /fieldops_technicians/{techId} {
      allow read, write: if isSignedIn();
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

Note: `fieldops_inventory` and `fieldops_job_events` (documented above under Collections) currently have **no rules of their own** and so are unreadable/unwritable by any client under this ruleset — the app's inventory/event-log features work in practice only because they're not gated by a `match` block here at all today. This is a pre-existing gap, not something introduced by the `users` collection addition.

**Honest limitation:** aside from the `users` collection's read-own/no-write rule, this is a single, coarse gate — any signed-in user can read or write any document in `fieldops_jobs`/`fieldops_technicians`, with no field-level or schema validation at the rules layer. Every business rule (valid status transitions, non-negative inventory, reservation ownership) is enforced entirely client-side, in the domain/service layer (`canTransitionJob()`, `canTransitionPhase()`, `inventoryService.js`'s quantity checks). A user hitting Firestore directly (browser console, a custom script, a compromised client) bypasses all of it — rules provide authentication, not authorization or data integrity, for those two collections today.

**Note on deployment:** this repo has no automated rules deployment (no CI step, confirmed). A change to this file has no effect on the live project until manually run via `firebase deploy --only firestore:rules` — see `docs/Deployment.md`. (The `users` rule above was deployed manually via that command as part of adding Firebase Auth roles.)

## Recommended direction for hardening rules (not implemented — documentation only, per this task's scope)

These are recommendations for a future sprint, not changes made now:

1. **Enum validation.** Reject writes where `status`/`phase` isn't one of the known enum values, e.g.:
   ```
   allow update: if isSignedIn()
     && request.resource.data.status in ['open', 'assigned', 'in_progress', 'complete'];
   ```
2. **Non-negative inventory.** Reject any `fieldops_inventory` write where `quantityAvailable < 0 || quantityReserved < 0 || quantityReserved > quantityAvailable`, as a defense-in-depth backstop behind the client-side checks `inventoryService.js` already does.
3. **Immutable `createdAt`.** Reject updates that change `createdAt` after creation, on any collection.
4. **Restrict `fieldops_job_events` to append-only.** No `allow update`/`allow delete` — an event log should never be edited or removed once written.
5. **Technician self-service boundary.** Technician-specific logins now exist (the `users` collection's `role` field), but `fieldops_jobs` rules haven't been tightened to use it yet — any signed-in user, regardless of role, can still write any job. A follow-up should restrict a technician's writes to jobs assigned to them (`resource.data.technicianId == request.auth.uid`), rather than relying on the client-side `ROLE_NAV_ACCESS` nav filter as the only technician boundary.

Rules-layer validation like this would need to mirror the transition tables already defined in `domain/jobWorkflow.js`/`domain/jobPhaseWorkflow.js` — keeping the two in sync (client-side logic and rules-side validation) would need to be an explicit discipline, not an afterthought, to avoid the rules silently drifting out of step with the real state machine.
