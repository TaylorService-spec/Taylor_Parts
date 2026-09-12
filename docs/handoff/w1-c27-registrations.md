# W1-C27 — Scheduling / Dispatch Authority: census, registrations, and ND-25

> ## ⚠️ ND-25 WAS WITHDRAWN BY OWNER RULING, 2026-09-12
>
> This handoff is the record of what the W1-C27 lane did, and is kept as written. One of its
> conclusions has since been overruled and must not be acted on from this document.
>
> **OVERLAPPING BLOCKED-TIME FACTS ARE LEGITIMATE.** A technician may be covered simultaneously by
> more than one real unavailability fact — a COMPANY_CLOSURE overlapping a recurring LUNCH, PTO
> overlapping a closure, training inside a broader closure. **UNAVAILABLE TIME = UNION OF BLOCKED
> INTERVALS** — not the sum of every block's duration, and not "no two blocks may overlap".
>
> ND-25's blanket refusal of overlapping blocked-time records (§7 below, and the Q3 answer in §5) is
> **not** the canonical business rule. The arithmetic divergence it diagnosed was real; the fix is now
> at the READERS, which both merge intervals before measuring. `createTechnicianBlockedTime` refuses
> no overlap; it collapses only a provable EXACT replay (every field identical). The per-technician
> `work_order_tech_locks` serialization is preserved.
>
> **Dimension 13 (“Target Postgres authority”) in §3 is overruled too** — it specified a `tstzrange`
> exclusion constraint, which would re-impose the withdrawn refusal at the database. It is corrected
> in place rather than left standing, because it is a forward specification a migration author would
> act on, not a record of what this lane did.
>
> `functions/test/schedulingBlockedTimeExclusion.test.mjs` is now
> `functions/test/schedulingBlockedTimeUnion.test.mjs`, and the function-scoped carve-out in
> `schedulingPlacementAuthorityContract.test.mjs` is empty again — that command no longer raises a
> refusal the placement policy owns.
>
> Current statement of the rule: `docs/design/governed-scheduling-domain.md` § ND-25.


Lane: C27 (scheduling / dispatch authority). Branch `impl/w1-scheduling-authority`.
Scope: `functions/src/scheduling/`, `technician_working_availability`, `technician_blocked_time`,
dispatch assignment, and the technician-recommendation surface.

---

## 1. Registrations required

Every shared file below is on this lane's do-not-edit list. Each line is recorded here so whoever
owns the shared file can apply it; nothing in this PR edits one.

| Shared file | Line to add | Why |
|---|---|---|
| `functions/package.json` | none | The new suite is `node --test` against `lib/`, run by the existing `functions/test` convention. No new dependency, no new script. |
| `field-ops-app-vite/test/suites.json` | none | The new suite lives in `functions/test/`, not the Vite package. |
| `entityRegistry.js` | none — see §2 | |
| `objectPermissionMap.js` | none | No new capability. `createTechnicianBlockedTime` keeps the admin/dispatcher bucket `ACTION_PERMISSIONS` already uses for Schedule and Dispatch. |
| `permissionCatalog.ts` | none | Same reason. |
| `firestore.rules` | none | Both availability collections remain `allow read, write: if false` (`firestore.rules:1773`, `1776`). The new refusal is server-side. |
| `firestore.indexes.json` | none | The overlap query reuses `loadBlockedTime`, so it reuses the already-declared composite `technician_blocked_time (technicianId ASC, endMillis ASC)`. |
| `functions/src/constants/collections.ts` | none | No new collection. |
| `capability-graph.json` / `firebase-exit-*.json` | none | No new Firebase business-runtime dependency, no new callable, no new collection. |

### Migration

**None, deliberately.** Migration id `1760140800000` was reserved for this lane and is **not used**.
There is no PostgreSQL scheduling authority to extend — `functions/migrations/` ends at
`1757980800000_operating-company-and-serialized-custody.sql` and only
`1757894400000_operational-capability-vocabulary.sql` mentions a technician at all, as vocabulary.
Adding a scheduling table here would have been the speculative half of a cutover nobody has designed,
and the defect this lane found is in the live Firestore write path, which a new empty table would not
have touched.

## 2. Administration → Objects

**No profile added, and it is not an omission.** C2's framework (PR #1866, read for pattern only at
`origin/impl/w1-part-admin-objects:field-ops-app-vite/src/metadata/administration/objectAdministrationProfile.js`)
requires `entityId` to name an entity that `metadata/entityRegistry.js` already declares, and
`validateProfileAgainstEntity` fails otherwise. Neither `technician_working_availability` nor
`technician_blocked_time` is a registered entity, and `entityRegistry.js` is a shared do-not-edit
file for this lane. A profile written now would be dormant *and* invalid.

**Integration point, when someone takes it:** register the two availability collections as entities
first, then add `administration/profiles/technicianBlockedTime.js` +
`administration/profiles/technicianWorkingAvailability.js` and one import/array entry each in
`administration/administrationProfileRegistry.js`. Citations that a profile could truthfully make
today, all checkable against real code:

- identity rule — `technician_working_availability` doc id **is** the technicianId
  (`functions/src/scheduling/schedulingCommands.ts:377`), so two disagreeing schedules are
  unrepresentable.
- governed writers — `setTechnicianWorkingAvailability`, `createTechnicianBlockedTime`,
  `deleteTechnicianBlockedTime` (`functions/src/scheduling/schedulingCallables.ts:56-58`).
- client reachability — none; `firestore.rules:1773,1776` deny read and write.
- exclusion rule — ND-25, `functions/src/scheduling/schedulingCommands.ts` (`createTechnicianBlockedTime`).
  **WITHDRAWN 2026-09-12 — see the banner at the top of this file.**

---

## 3. Fifteen-dimension census

| # | Dimension | Finding (`path:line`) |
|---|---|---|
| 1 | Canonical id | Working availability: doc id **is** `technicianId` — PK==FK by construction (`schedulingCommands.ts:377`, `types.ts:49`). Blocked time: server-allocated `blockId`, echoed into the body from `ref.id` (`schedulingCommands.ts:417`, `:479`) — cannot diverge. Both `technicianId`s are **`fieldops_technicians` doc ids**. |
| 2 | Existing authority | Placement: one shared policy, `functions/src/scheduling/placementPolicy.ts:73`. Availability: `technician_working_availability` (recurring) + `technician_blocked_time` (dated), `types.ts:17-18`. Work Order schedule fields stay owned by the WO (`types.ts:8-10`). |
| 3 | Duplicate / compat representations | **`fieldops_technicians.status`** is a second, older representation of "is this technician available" (`schedulingRepository.ts:21`). Also `wo.scheduledTechId` vs `wo.assignedTechId`, reconciled by H20 (`transitionWorkOrder.ts:377`) — C19's object, not touched. `rescheduledFrom*` is an explicitly-labelled display snapshot, not history (`schedulingCommands.ts:205-207`). |
| 4 | Ownership authority | `ownershipMatrix.ts:445` excludes `technician`/`fieldops_technicians` as "person authority — a subject of ownership, not an object". Neither availability collection appears in the matrix at all. |
| 5 | Operating-company authority | **`operatingCompanyId` appears nowhere in `functions/src/scheduling/`, `technicianRecommendationEngine.ts` or `dispatchBoardGeometry.js`** (verified by grep). No inference from warehouse, truck, employee or `homeWarehouseId` — the binding ruling is not violated. It is also not *carried*: scheduling is currently company-blind, and a cross-company placement would not be refused. Recorded as a gap, not fixed here — adding a company gate is a policy decision, not a defect repair. |
| 6 | Relationships | availability → technician (`loadTechnician`, `schedulingRepository.ts:32`); placement → Work Order (`WORK_ORDERS_COLLECTION`, `placementPolicy.ts:110`); serialization → `work_order_tech_locks/{technicianId}` (`schedulingCommands.ts:55`, `transitionWorkOrder.ts:54`). |
| 7 | Readers | Server: `placementPolicy.ts:97,130`; `schedulingReadService.ts:87-94`. Client: `useTechnicianAvailability.js:3` → `readTechnicianAvailability` callable only; `dispatchBoardGeometry.js:102,215,223,285,329`; `technicianRecommendationEngine.ts:125` (reads `fieldops_technicians.status`, **not** the availability authority). |
| 8 | Writers | Availability collections: three Admin-SDK commands only (`schedulingCommands.ts:374,414,503`). `fieldops_wos` schedule fields: `applyScheduleChange` (`schedulingCommands.ts:198`) and `transitionWorkOrder`'s Schedule/Dispatch/Unschedule. **`fieldops_technicians.status`: `completeAssignedJob.ts:316`, client `jobActions.js:80,121`, and any admin/dispatcher directly via `firestore.rules:418`.** |
| 9 | Client dependencies | The board cannot read either availability collection; its only path is the `readTechnicianAvailability` callable (`useTechnicianAvailability.js:9-11`). Client *write* dependency remains on `fieldops_technicians` (`firestore.rules:407,418`) and on `fieldops_jobs` via `jobActions.js:106-124`. |
| 10 | Firebase dependencies | Firestore + seven `onCall` adapters (`schedulingCallables.ts:53-62`). This PR adds none. |
| 11 | Migration source | None exists; none added. See §1. |
| 12 | Reconciliation proof | `functions/test/schedulingBlockedTimeExclusion.test.mjs` — 15 tests. *(Now `schedulingBlockedTimeUnion.test.mjs`, 26 tests, after the 2026-09-12 ruling.)* Existing: `schedulingAvailabilityModel.test.mjs` (30), `schedulingPlacementAuthorityContract.test.mjs` (11 after this PR), `workOrderAvailability.test.mjs` (7). Emulator suites (`test/e2e/schedulingCommandsEmulator.test.mjs`, `schedulingAvailabilityEmulator.test.mjs`) and the Rules suite `technicianAvailabilityRules.test.js` **cannot run in this environment** — see §6. |
| 13 | Target Postgres authority | Not built. **This row's original specification is WITHDRAWN by the 2026-09-12 ruling and must not be carried into a migration.** It named a `tstzrange` **exclusion constraint** as the Postgres form of ND-25 — that constraint *prevents* overlap, which is precisely the refusal the ruling withdrew. Encoding it would silently re-impose at the database the rule the application layer just stopped enforcing. The correct Postgres target stores overlapping rows freely (**no** `EXCLUDE USING gist`, no `btree_gist` dependency) and computes the **union** at read time; the union is the reader's job, as it now is in `availabilityModel.ts` and `dispatchBoardGeometry.js`. Per-technician serialization stays in `work_order_tech_locks`, not in a range constraint. |
| 14 | Governed command / read boundary | Commands `schedulingCommands.ts`; read projection `schedulingReadService.ts:61`; sanitized boundary `errorMapping.ts:55`. Authorization is `caller.role` only (`schedulingCommands.ts:87`, `schedulingReadService.ts:63`) — it does **not** read `callerContext.technicianId`. |
| 15 | Admin→Objects integration | §2. |

---

## 4. The identity trap — what this lane touched

**No `technicianId` call site was touched, widened, or added.** `functions/src/scheduling/` never reads
`callerContext.technicianId`; both authorization checks use `caller.role` alone
(`schedulingCommands.ts:87`, `schedulingReadService.ts:63`). C5's shrink-only ratchet is intact.

What this lane can add to the record, from its own reading:

- `functions/src/callerContext.ts:20` returns a **`fieldops_technicians`** doc id, and the scheduling
  domain treats `technicianId` as a `fieldops_technicians` key throughout
  (`schedulingRepository.ts:17,33`). The client agrees explicitly and says so at
  `field-ops-app-vite/src/domain/actorDisplayName.js:61` — "a `fieldops_technicians` doc id, NOT a
  Firebase uid".
- **The scheduling domain is therefore a live consumer of the compatibility collection as assignment
  authority**, against the ruling: `loadTechnician` (`schedulingRepository.ts:32`) is the existence
  and eligibility gate for *every* placement, and `readTechnicianAvailability` enumerates the
  technician roster from it (`schedulingReadService.ts:78`). Rewiring either onto `employees` is
  exactly the blind fix C5 fenced, and the covering suites are emulator-only, so **it was left alone
  and is reported instead**.
- `fieldops_technicians` is confirmed as the only reference entity with a live client write path
  (`firestore.rules:407` create, `:418` update), and that update path can set `status` freely within
  the enum — see Q5.

---

## 5. The five questions

### Q1 — Where is scheduling/dispatch authorization enforced?

**Split, and the split is the finding.**

- The **governed Work Order scheduling domain** enforces it in server commands:
  `requireDispatcher` (`schedulingCommands.ts:82-91`) and the same check in the read service
  (`schedulingReadService.ts:63`), both on the Admin SDK, which bypasses Rules by design.
- The **legacy job dispatch path** enforces it *only* in Firestore Rules. `assignJob`
  (`field-ops-app-vite/src/domain/jobActions.js:89-131`) is a **client-side transaction** writing
  `fieldops_jobs.technicianId`/`status` and `fieldops_technicians.status` directly; the only thing
  standing between a browser and a dispatch assignment is `isAdminOrDispatcher()` at
  `firestore.rules:373-395` and `:418`. That is authorization, workflow and assignment routing in
  Rules — the prohibited class.

**Scheduling visibility specifically** (the named prime offender) is **partly in Rules and partly
not**:

- `technician_working_availability` / `technician_blocked_time` — **not in Rules.** Both deny all
  client access (`firestore.rules:1773,1776`) and visibility is decided by a server projection
  (`schedulingReadService.ts:61-65`). This is the correct posture and it is already in place.
- `fieldops_jobs` — **in Rules.** `resource.data.technicianId == callerTechnicianId()` at
  `firestore.rules:363` is "who may see whose work", expressed as a Rules predicate.
- `fieldops_technicians` — **in Rules.** `techId == callerTechnicianId()` at `firestore.rules:406-409`
  is "who may see whose technician record".
- Both of those Rules predicates route through `callerTechnicianId()` (`firestore.rules:325`), i.e.
  through the identity trap. Fixing them means resolving the key space first. C5's fence, untouched.

### Q2 — Is there a double-booking guard, and is it real or check-then-act?

**Three answers, one per path.**

1. **Work Order placement — real.** `checkPlacement` runs `findScheduleConflict` over a
   **transactional** query (`placementPolicy.ts:109-128`), and every caller reads *and writes*
   `work_order_tech_locks/{technicianId}` in the same transaction (`schedulingCommands.ts:186-187,197`;
   `transitionWorkOrder.ts:245,250-256`). The sentinel exists precisely because a query-then-write
   over two *different* Work Order docs conflicts on nothing — the reasoning is written out at
   `transitionWorkOrder.ts:44-53`. Both placement entry points reach the one policy
   (`schedulingPlacementAuthorityContract.test.mjs`), so they cannot drift.
2. **Blocked time — was the classic version of the bug, now fixed.** `createTechnicianBlockedTime`
   had **no overlap check at all** and took **no sentinel**. Adding the check alone would have been
   exactly `SELECT`-then-`INSERT` with no lock: a transactional query locks the documents it
   *returns*, and a not-yet-existing record is not among them, so two concurrent creates each find
   nothing and each commit. ND-25 adds the check **and** the sentinel read+write. See §7.
3. **Legacy job assignment — a client-side check-then-act that Firestore happens to rescue.**
   `jobActions.js:110-123` reads the technician doc, refuses unless `status === available`, then
   writes. It is inside `runTransaction`, and the technician doc *is* in the read set, so Firestore
   does catch the concurrent case. But the guard is `TECH_STATUS`, which is the stale stored
   aggregate of Q5 — so it serializes correctly on a field that is frequently wrong.

### Q3 — Are overlapping availability / blocked-time intervals possible, and does anything refuse them?

**Before this PR: possible everywhere, refused nowhere.**

- **Blocked time vs blocked time** — nothing prevented two records for one technician covering the
  same minutes: no uniqueness rule, no exclusion rule, no idempotency key. A double-clicked PTO form
  was sufficient. **Now refused** — ND-25, `BLOCKED_TIME_CONFLICT`.
- **`weeklyHours` intervals within one weekday** — still possible.
  `validateWorkingAvailabilityInput` (`validation.ts:177-197`) refuses a *reversed* interval and
  explicitly argues why (`validation.ts:186-190`: storing a record whose displayed and enforced hours
  differ is "the exact disagreement this domain exists to prevent") but accepts an *overlapping*
  pair. **Not fixed here, and the reason is that it is benign in a way blocked time is not:**
  `normalizeIntervals` (`availabilityModel.ts:102-122`) merges them, and for working hours the merge
  *is* the union, so enforced coverage equals what the writer asked for. The residual risk is a
  reader misinterpreting `[07:00–16:00, 12:00–13:00]` as a lunch *subtraction* — the file's own
  documented idiom for a lunch is a gap, not a second interval (`types.ts:31-33`). Recorded as a
  known divergence, not silently left.
- **Blocked time vs scheduled work** — deliberately permitted when the block is recorded
  (`schedulingCommands.ts` `createTechnicianBlockedTime`), refused in the other direction
  (`placementPolicy.ts:99`). That asymmetry is ND-20 policy and is preserved; the new suite pins it
  (`schedulingBlockedTimeExclusion.test.mjs`, "recording an absence is still NOT refused because WORK
  is already placed there").

### Q4 — Does the recommendation engine read authority it shouldn't, or infer company/identity?

`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts` — ADR-004 says "design-stage only,
no implementation exists" (`ADR-004:13`); that is **stale**, it is implemented and wired into
`DispatcherBoard.jsx:16,210`.

- **Company:** no. `operatingCompanyId` appears nowhere in the engine. Nothing is inferred.
- **Identity:** no. It keys on `tech.id` and `wo.assignedTechId` (`:68-69`) and never touches
  `users/{uid}.technicianId`. It adds no consumer to the fenced call sites.
- **Authority it shouldn't read: yes, one.** Factor C, *Availability*, 20% of the score, reads
  `fieldops_technicians.status` (`:119-127`) — the compatibility collection, in the role of
  availability authority, which the ruling says it must not hold. The governed availability
  authority (`technician_working_availability` / `technician_blocked_time`) is **never consulted**:
  a technician on recorded PTO still scores 100 for availability. The board already holds the
  governed answer for the same technicians in the same render
  (`DispatcherBoard.jsx:131-137` → `availabilityByTechnicianId`) and does not pass it to the engine
  (`:210`).
- **Not changed here, and the reason is stated rather than assumed:** the engine scores *unplaced*
  queue cards, which have no window, while the governed availability read is windowed over the whole
  visible view. Turning "available minutes over a fortnight" into a 0–100 availability score is a
  formula nobody has chosen, and inventing one would be the speculative architecture this lane was
  told to avoid. It needs a ruling, not a patch.
- Factor D, *Territory*, returns a constant 50 for everyone (`:139-141`) — correctly degraded, no
  inference, but it means 15% of every score is noise. Also stale-doc risk: ADR-004 §12's acceptance
  checklist is entirely unticked for a shipped feature.

### Q5 — Is any schedule state a stored aggregate that can drift?

**Yes — `fieldops_technicians.status`, and it is the largest finding in this lane.**

It is a stored, three-valued summary (`available` / `on_job` / `off_shift`) of a question whose real
answer is intervals: the technician's working hours, their blocked time, and their live Work Order
lifecycle.

- **Who writes it:** `completeAssignedJob.ts:316` (→ `available`), client `jobActions.js:121`
  (→ `on_job`) and `:80` (→ `available`) — all three on the **legacy `fieldops_jobs`** flow — plus any
  admin or dispatcher writing it by hand through `firestore.rules:418`.
- **Who never writes it:** the governed Work Order lifecycle. `transitionWorkOrder.ts` references no
  technician collection at all, and neither does any command in `functions/src/scheduling/`. A
  technician dispatched and completed entirely through `fieldops_wos` never has this field updated.
- **Who reads it as authority:** `placementPolicy.ts:90` (eligibility gate — currently benign, since
  all three enum values pass and it only catches a malformed record) and
  `technicianRecommendationEngine.ts:125` (**20% of the recommendation score**).
- **Therefore:** it drifts by default and is right by coincidence. A technician on recorded PTO reads
  `available`; a technician whose only work is governed Work Orders can read `on_job` indefinitely.

A second, smaller one — **fixed by this PR**: *blocked minutes* was being computed twice, by two
different arithmetics, over the same records (`availabilityModel.ts:287-307` unions;
`dispatchBoardGeometry.js:221-230` sums). See §7.

---

## 6. What could not be verified here, plainly

- **Firestore-emulator suites do not run in this environment.** Port 8080 is held by an unrelated
  uvicorn service and the Admin SDK retries forever rather than failing. That covers
  `functions/test/e2e/schedulingCommandsEmulator.test.mjs`,
  `functions/test/e2e/schedulingAvailabilityEmulator.test.mjs` and
  `functions/test/technicianAvailabilityRules.test.js`. They were **not** run and are **not**
  claimed. The ND-25 transactional behaviour is therefore covered here by a pure suite plus a source
  contract, not by an executed transaction — and the emulator suites should be run before merge by
  anyone who can.
- `firestore.rules` is unchanged, so no deploy step is implied. (It also has no CI deploy in this
  repository — the existing caveat in `docs/design/governed-scheduling-domain.md` still stands.)

---

## 7. What was implemented — ND-25 **(WITHDRAWN 2026-09-12 — see the banner at the top)**

What follows is the record of what this lane shipped. The blanket overlap refusal it describes has
since been overruled; the serialization it describes is preserved.

One change, at the write path, in `functions/src/scheduling/schedulingCommands.ts`:

- `createTechnicianBlockedTime` refuses a record overlapping an existing absence for the same
  technician, reusing `loadBlockedTime` (same query, same composite index) and
  `findBlockedTimeConflict` (same half-open test) and raising the existing `BLOCKED_TIME_CONFLICT`.
  No second overlap rule, no new index, no new failure code, no new collection, no new callable.
- Both `createTechnicianBlockedTime` and `deleteTechnicianBlockedTime` now read **and write**
  `work_order_tech_locks/{technicianId}`, so the guard is a serialization rather than a
  query-then-insert that merely looks like one.

Why this was the smallest coherent step rather than a reconciler: with overlap impossible,
`sum == union` holds by construction, so both existing blocked-minute readers become correct without
either being rewritten and nothing is left behind to drift. The full argument, including the
worked numbers, is in `docs/design/governed-scheduling-domain.md` § "ND-25".

Tests: `functions/test/schedulingBlockedTimeExclusion.test.mjs` (15, new).
`functions/test/schedulingPlacementAuthorityContract.test.mjs` gained a named, function-scoped
carve-out (plus a test that the carve-out still matches a real function), because
`createTechnicianBlockedTime` legitimately raises a code the placement policy owns — the same
carve-out that file already makes in prose for `TECHNICIAN_NOT_FOUND`.
