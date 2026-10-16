# Frontend Dormant Firebase Clients: Retirement Ledger

Status: RECORDED 2026-10-15 (Firebase-exit lane, O-1 / DECISIONS #234). Ledger only. It records each frontend
Firebase client removed because nothing reachable calls it, the business requirement that client once served, and
the EOS Core path that owns that requirement now or must own it before the feature returns.

Governing rulings: EOS v1.0 has zero Firebase dependency and EOS Core owns all business authority (DECISIONS #234);
Owner decisions 2026-10-15 — "PR-A APPROVED: remove the unrouted legacy Technicians screen after proving no
reachable workflow depends on it" and "PR-B APPROVED: remove orphaned and environment-disabled Firebase clients.
Preserve business requirements for EOS Core replacement." Removing a client never retires the requirement: a
feature listed here comes back only on its EOS Core path, never by restoring the Firebase client.

## PR-A: the unrouted legacy Technicians screen (exit baseline 265 → 261)

### Removed

| File | What it did |
| --- | --- |
| `field-ops-app-vite/src/modules/technicians/Technicians.jsx` | A table of Firestore `fieldops_technicians` (`{ id, name, phone, status }`, status `available` / `on_job` / `off_shift`) through a live `onSnapshot`. |
| `field-ops-app-vite/src/modules/technicians/NewTechnicianModal.jsx` | "New Technician" form: name and phone. |
| `field-ops-app-vite/src/domain/jobActions.js` | `createTechnician` and `createJob` (client `addDoc`), `assignJob` and `updateJobStatus` (client `runTransaction` over `fieldops_jobs` + `fieldops_technicians`). Only the Technicians screen imported it. |
| `field-ops-app-vite/src/firebase/collectionStore.js` | The shared client Firestore writer (`makeCollectionStore`, `jobsStore`, `techniciansStore`). Its last consumer was `jobActions.js`. |
| `field-ops-app-vite/src/lib/firebaseSafe.js` | The `safeAddDoc` / `safeUpdateDoc` / `safeDeleteDoc` / `safeSetDoc` write-block wrappers. Its only consumer was `collectionStore.js`. |
| `field-ops-app-vite/src/hooks/useFirestoreCollection.js` | The generic Firestore collection `onSnapshot` hook. Its only consumer was `Technicians.jsx`. |
| `technicianSaveErrorMessage` in `domain/legacyCreateSaveErrors.js` | Error copy for the deleted modal. `jobSaveErrorMessage` stays (used by `NewJobModal`). |

### Why it was unreachable

- `App.jsx` reached `Technicians` only through `LEGACY_COMPONENTS[item.legacyKey]`. No nav item in
  `navigation/navConfig.js` carries `legacyKey: "technicians"`. The Administration Users consolidation removed the
  last one (the old "Employees" item; see the comment at `navConfig.js` "ADMINISTRATION USERS CONSOLIDATION").
  The `/administration` index and `/administration/employees` both redirect to `/administration/users`.
- The server navigation catalog (`functions/src`) has no `technicians` key and no `legacyKey`.
- No dynamic `import()` names any of the six files. The only static importers formed a closed chain rooted at
  `Technicians.jsx`; every other reference was a comment or a `vi.mock` of a module the component under test no
  longer imported.
- The `technicians` entry in `ROLE_NAV_ACCESS` (`domain/constants.js`) is left as it is. It gates nothing, because
  no nav item asks for it.

### Business requirements and their EOS Core owner

| Requirement | EOS Core owner |
| --- | --- |
| See the field workforce (name, contact, status) | The governed Employee directory, under Administration → Employees & Users (`/administration/users`). Work Order technician rosters come from `listWorkOrderTechnicians` (`useWorkOrderTechnicians`), keyed by Employee id. |
| Add a technician | Create an Employee and grant field eligibility through the governed Employee and role administration (PostgreSQL `employees`, `user_role_assignments`). A `fieldops_technicians` row was never an Employee and carried no authority. |
| Live technician job status (`available` / `on_job`) | Derived from Work Order assignment and execution state in `eos_ops` (Dispatch board, My Work). No separate status document is written. |
| Atomic job assignment and status transitions on `fieldops_jobs` | The Work Order lifecycle on `/operations/work-orders` (`transitionWorkOrder`, assignment). Legacy `fieldops_jobs` has no EOS writer and is not being revived. |
