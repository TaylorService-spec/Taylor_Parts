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

## PR-B: orphaned and environment-disabled clients (exit baseline 261 → 257)

### Removed

| Item | Why nothing reachable used it |
| --- | --- |
| `services/completionService.js` (`completeAssignedJob` binding) | No importer. FieldMode completes through the governed Work Order `Complete` transition (F0; see `test/completionFlow.test.mjs`). |
| `services/manufacturerCommandClient.js`, `hooks/useManufacturerWrite.js`, `config/manufacturerWriteReadiness.js`, and the create / rename / status affordances in `modules/inventory/Manufacturers.jsx` | `MANUFACTURER_WRITE_READY` was `false` in all five environments, so the hook returned "write disabled" before any call. The flag is removed from `config/environments.json` and `vitest.config.js`. The Manufacturers page stays as a read-only list. |
| `services/inventoryBalanceCallableClient.js` (`getPartBalance`) and its default use in `modules/scan/LookupScan.jsx` | `INVENTORY_BALANCE_READ_READY` was `false` in all five environments, so the client only ever answered `transport-not-ready`. LookupScan's default now returns exactly that, so the balance row renders the same refusal as before. |
| The `getCountFromServer` fallback in `hooks/useListViewChrome.js` | It ran only for a `CLIENT_DIRECT` entity with no injected count. Of the five lists that mount the hook, Accounts, Customer Equipment and Work Orders read through `EOS_API`, Sales Orders reads through `CALLABLE`, and the Part Master (`CLIENT_DIRECT`) injects the Render Catalog `countParts`. The branch never ran. |

### Kept, on purpose

| Item | Why it stays |
| --- | --- |
| `domain/completionFlow.js` | A pure module, no Firebase. It records the idempotent / ambiguous-result recovery rules for completion. It has no runtime consumer now; it is kept as the tested specification for the EOS cutover to reuse or delete. (`domain/manufacturerWrite.js` was kept at first, then deleted in the PR-C refresh after Lane D confirmed only its own test imported it; the governed rules live in `postgresManufacturerWriter.ts`.) |
| `INVENTORY_BALANCE_READ_READY` in `config/environments.json` | Still a required readiness key (`scripts/resolveEnvironment.mjs`, `functions/test/scannerReleaseReadiness.test.mjs`). `config/inventoryBalanceReadiness.js` still supplies `INVENTORY_BALANCE_UNAVAILABLE_REASON` to `domain/partsNorthStar.js`. |

The server callables (`completeAssignedJob`, `createManufacturer`, `updateManufacturer`, `changeManufacturerStatus`, `getPartBalance`) are not touched here. Each needs a GATED equivalence record under [firebase-capability-equivalence-gate.md](firebase-capability-equivalence-gate.md) and an operator undeploy.

### Business requirements and their EOS Core owner

| Requirement | EOS Core owner | State |
| --- | --- | --- |
| Complete an assigned job, idempotent and safe on an ambiguous result | The Work Order `Complete` transition on `/operations/work-orders` | Live. Legacy `fieldops_jobs` completion is not revived. |
| Create, rename, activate and deactivate a Manufacturer, with optimistic concurrency and a separate activate authority | `functions/src/catalogMaster/postgresManufacturerWriter.ts` (`inventory.catalog.manage` for create and rename; `inventory.catalog.activate` for status; `updated_at` as the concurrency token). Reads: `functions/src/eosOps/manufacturerAuthority.ts` (`listManufacturers` / `getManufacturer` / `searchManufacturers`, `inventory.manufacturer.read`). | Built and tested, **not routed**. Next step: add Catalog API operations for the writer and the reads, then point the Manufacturers page at them. |
| See a Part's on-hand, reserved, available and on-order quantities while scanning | An EOS Core inventory balance read over `eos_ops` stock, injected into `LookupScan` as `deps.fetchBalance` | **No EOS read yet.** The scan screen states the balance is unavailable, as it always has. |
| An exact header count on a list | Each object's own count authority, passed as `options.count` (the Part Master's Catalog `countParts` today) | Live. Other lists show no count until they have one. |
