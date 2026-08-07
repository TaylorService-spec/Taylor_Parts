# F0 — Field Job Authority Convergence: Evidence & Retirement Status

**Status:** F0 COMPLETE (repo + live sandbox) · **NO DESTRUCTIVE RETIREMENT PERFORMED**
**Canonical authority:** `fieldops_wos` + the governed Work Order Engine
**Legacy authority:** `fieldops_jobs` — retirement candidate, untouched in production

---

## 1. What changed materially

Not a rewiring exercise. Three capabilities did not previously exist:

| | Before (legacy `fieldops_jobs`) | After (governed `fieldops_wos`) |
|---|---|---|
| Travel / arrival | React local state (`travelStageByJob`), **never written anywhere** — a dispatcher could not see a technician was en route | Governed `Travel`/`Arrive` transitions with server `enRouteAt`/`arrivedAt` |
| Acceptance | No `ACCEPTED` state existed; "the technician has seen this" was unrepresentable | Governed `Accept` with `acceptedAt` |
| Dispatch assignment | Client Firestore transaction (`assignJob`) | Governed `Dispatch` transition; server sets `assignedTechId`, enforces lifecycle + role |
| Completion history | Model has **no** `completedAt`/`completedBy` fields at all | `completedAt`, `workStartedAt`, append-only `executionLog` |

---

## 2. Live sandbox proof

Run against the deployed sandbox and the **real** Cloud Functions, using each
persona's own Firebase ID token via the Auth REST endpoint. The Admin SDK was
deliberately **not** used — an Admin SDK call bypasses auth and would prove
nothing about denial.

**19 / 19 passed.**

```
ALLOW — technician advances the governed lifecycle
  DISPATCHED -> Accept -> ACCEPTED        acceptedAt written by server
             -> Travel -> EN_ROUTE        enRouteAt PERSISTED  (was local-only before F0)
             -> Arrive -> ARRIVED         arrivedAt persisted
             -> WorkStart -> WORK_IN_PROGRESS   workStartedAt persisted

DENY — authority holds in both directions
  technician CANNOT accept another technician's Work Order   (and it stayed unchanged)
  technician CANNOT skip the lifecycle (Complete from SCHEDULED)
  technician CANNOT dispatch
  dispatcher CANNOT perform a technician field step

ALLOW — dispatcher dispatches
  SCHEDULED -> Dispatch -> DISPATCHED, assignedTechId set server-side
```

UI verification (Playwright, deployed sandbox): **10 / 10 passed** — Field Mode
renders a Current Job from the governed model, surfaces governed WO numbers,
offers exactly one governed next step, renders the progress list, and **does not
surface the Work Order assigned to another technician**.

### Two real defects this proof caught

1. **Sandbox identity gap.** `transitionWorkOrder` resolves the caller's
   technicianId from `users/{uid}.technicianId` (`callerContext.ts`), but the
   persona pack had only established the *reverse* link
   (`fieldops_technicians.userId`). Every technician transition failed
   `PERMISSION_DENIED` on `requiresOwnAssignment`. The seed now completes the
   mapping — this grants no capability and widens no permission; without it the
   technician persona can perform nothing at all.
2. **A wrong assumption in my own Dispatch conversion.** The governed table is
   `READY_TO_DISPATCH → SCHEDULED → DISPATCHED`, so `Dispatch` is valid **only**
   from `SCHEDULED`. The dispatch board now asks `getAllowedActions()` rather
   than assuming, and shows *"must be scheduled first"* otherwise. It does **not**
   fabricate a schedule — `Schedule` requires a real
   `scheduledStart`/`End`/`TechId` decision this board does not make.

---

## 3. Reporting `job` contract — assessed, deliberately unchanged

| Question | Finding |
|---|---|
| Is `job` reportable today? | **No.** `obj("job", "Job", "fieldops_jobs", 2, false)` — activation wave **2**, `fieldsPopulated: **false**`. It is an object-level **stub with no fields authored**. |
| Can a saved report reference job fields? | **No** — no fields exist to reference. |
| Are there persisted saved reports at all? | **No.** `savedReportModel.js`: *"This slice is CLIENT-ONLY and IN-MEMORY: no Firestore collection, no Rules."* |
| Compatibility impact of repoint/remove | **Zero**, today. |

**Decision: leave it unchanged in F0.** The catalog's own rule is that later-wave
objects have *"their fields authored and their sensitivity fixed at each wave's
own activation review before ever being reportable."* Changing a catalog object
is a reporting-authority decision, not F0 mechanics. It is recorded as a
retirement-package item: a stub pointing at a collection we intend to retire.

---

## 4. Every remaining `fieldops_jobs` reader / writer after convergence

**No routed application surface reads or writes the legacy job model any more.**

Converted in F0 (all verified free of `JOBS_COLLECTION` / `useAssignedJobs` /
`jobActions` / `JOB_STATUS` / `jobsStore`):
FieldMode · PartsScanner · Dispatch · Control Tower · Jobs · **WorkOrderDetailPage**
(the sixth surface — found during enumeration, not in the mandated five, and
converted rather than reported as a loose end).

What remains, and why:

| Remaining | Kind | Disposition |
|---|---|---|
| `domain/jobActions.js` | legacy write path (`createJob`/`assignJob`/`updateJobStatus`) — **no routed surface calls the job functions any more**; `createTechnician` is still used by Technicians.jsx | delete the job functions at retirement; `createTechnician` belongs to `fieldops_technicians` (out of scope) |
| `domain/jobWorkflow.js` | legacy 4-state machine | delete at retirement |
| `domain/workOrderLifecycle.js` | derives a WO state by aggregating child jobs — obsolete: a governed WO carries its own status | delete at retirement |
| `hooks/useAssignedJobs.js`, `firebase/collectionStore.js` (`jobsStore`) | legacy read plumbing, now unreferenced by surfaces | delete at retirement |
| `domain/constants.js` `JOBS_COLLECTION`/`JOB_STATUS` | vocabulary | delete at retirement |
| `functions/src/completeAssignedJob.ts` | governed legacy completion cascade — **still deployed** | retire once nothing calls it |
| `firestore.rules` `fieldops_jobs` block | hardened per F-RULES-1, deployed | **PROTECTED** — Rules change |
| `firestore.indexes.json` `technicianId` index | declared so a deploy is non-destructive (O-4) | **PROTECTED** — must not be silently dropped |
| `reportCatalog.js` / `.ts` `job` object | inert wave-2 stub | resolve at wave-2 activation review |
| `access/legacyAuthorizationSurface.ts` | intentionally *tracks* the legacy surface | update when the surface is gone |
| `functions/scripts/d1/d2/d3Smoke*`, `auditLegacyJobTechnicianData.js` | F-RULES-1 historical evidence tooling | retire or repoint with the collection |
| `scripts/indexDriftGuard.test.mjs` | uses the index as its O-4 fixture | repoint fixture at retirement |

---

## 5. Sandbox scenario — SBX-SCN-001 v2

Rebuilt on `fieldops_wos`. v1 seeded the legacy model, which had no acceptance,
travel or arrival states — so the scenario **could not exercise the field chain
it existed to prove**.

Seven governed Work Orders spanning the lifecycle, chosen so each proves
something specific:

| WO | Status | Proves |
|---|---|---|
| SBX001 | `ARRIVED` | the canonical failure; a persona performs WorkStart → diagnosis → parts chain live |
| SBX002 | `SCHEDULED` | the dispatcher path (`Dispatch` is valid only from here) |
| SBX003 | `COMPLETED` | finished work renders and is excluded from the active queue |
| SBX004 | `WORK_IN_PROGRESS` | `Complete` is the only step offered |
| SBX005 | `DISPATCHED` | `Accept` — the step the legacy model could not represent at all |
| SBX006 | `DISPATCHED`, **other technician** | the deny path is provable, not assumed |
| SBX007 | `READY_TO_DISPATCH` | the board honestly refuses to offer assignment where the engine would reject it |

Execution timestamps are set only for states actually reached, so seeded
documents stay consistent with what `transitionWorkOrder` would have written.
As in v1, the **receipt is still deliberately unseeded** — it is the governed
write the scenario exists to exercise.

F0 needed only enough depth to prove the chain. The larger program (multiple
technicians, multiple days, weekly scheduling, notes/picklists, concurrency and
load) remains **F5**.

---

## 6. Boundaries honoured

Not done, by explicit F0 boundary:

- ✗ No production `fieldops_jobs` record deleted or modified — all 12 untouched
- ✗ No production Rules block removed
- ✗ No index removed or deploy-deleted
- ✗ `fieldops_technicians` not retired
- ✗ No second job model created — `fieldWorkOrder.js` adds no model, collection,
  status vocabulary or permission; every "may I?" is answered by
  `getAllowedActions()`, and the phase projection is a read-side projection of
  the governed model with names deliberately unlike the legacy ones
- ✗ No F3 structured-field schema
- ✗ No Storage / attachments
- ✗ No authority expanded to ease convergence — the one identity mapping added is
  sandbox-only and grants nothing

**Destructive retirement remains a separate Owner gate.**

---

## 7. Verification summary

| Check | Result |
|---|---|
| Build | clean |
| eslint | 0 errors |
| Unit suite | 0 failed |
| Component suite | 491 passed |
| New: `workOrderWorkflowMirrorContract` | 6 passed — and **verified to fail on an injected divergence**, so it is not vacuous |
| New: `fieldWorkOrder` | 12 passed — exhaustive 11-status phase coverage, fail-closed unknown status, deny-for-every-status |
| Live sandbox allow/deny | 19 / 19 |
| Live sandbox UI | 10 / 10 |
