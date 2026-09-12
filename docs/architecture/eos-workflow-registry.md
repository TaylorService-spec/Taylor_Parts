# EOS Workflow Registry

Lane **P3-D** of the Taylor EOS overnight programme, **revalidated against post-Wave-1 mainline by lane P3-WF** (§0a). This is the consolidation layer over the Phase-3
archaeology lanes (P3-A1, P3-A2, P3-A3), the three day-in-the-life activity libraries (P3-B1, P3-B2,
P3-B3, 1,010 activities) and the Phase-2 open decision ledger (P2-D).

It is not a list of routes and it is not a re-filing of the activities. A **workflow** here is a
complete business path from trigger to settled outcome, crossing whatever screens, capabilities,
collections and roles it needs. The registry is the map of every such path the business actually
runs, with the truth about each one.

**Machine-readable companion:** [`eos-workflow-registry.json`](./eos-workflow-registry.json) — one
record per workflow in the schema below.
**Schema reconciliation:** [`eos-workflow-registry-schema-reconciliation.md`](./eos-workflow-registry-schema-reconciliation.md) —
how the three activity libraries' vocabularies map onto one another and onto this registry.

**No runtime code was changed by this lane. Nothing was pushed. No production contact was made.**

---

## 0. The correctness rule this registry was built under

> **A CORRECT CODE READING FROM THE WRONG BRANCH IS STILL A FALSE STATEMENT ABOUT THE PRODUCT.**

Every `night/*` lane branched from `d104cf49`, which is behind. The integrated head is **`0ba8ab0d`**
on `integration/wave-1`. **Every defect promoted into this registry was re-checked against the
integrated head before being called live.** Defects that were true at `d104cf49` and are fixed at
`0ba8ab0d` appear in §7 and in no workflow record.

Two things follow that a reader should hold onto:

1. **Almost everything here is `TRACED`, not `EXECUTED`, and that is the honest state.** The Firestore
   emulator cannot run on this machine (no JRE, and port 8080 is held by an unrelated uvicorn),
   `node_modules` is absent in this worktree, and no lane made production contact. A workflow is
   never labelled working on the strength of someone having read it.
2. **One thing was genuinely executed, by this lane, at the integrated head**: capability resolution
   for all 48 roles across all 147 capabilities under the production and `platform-sandbox`
   activation sets. That is the only executed authority evidence in the programme, and it is the
   reason **32** of the 86 records carry `EXECUTED` rather than `TRACED`. Where a record is `EXECUTED`,
   its `evidence_note` says exactly which half was run and which half was read.

---

## 0a. Revalidation at post-Wave-1 mainline — lane P3-WF

**Baseline: `64008d5ae0bdd9532909671b15a91122400accf1`** (mainline, PR #1898 merged). Every
code-derived claim in this document is cited to this SHA. Mode: documentation only — **no runtime
code, test, config or schema was changed, nothing was pushed, and no production contact was made.**

### The premise this lane was given, and what the repository actually says

| Claim in the tasking | Measured at the baseline | Verdict |
|---|---|---|
| "The whole registry was authored against `d104cf49`" | Its `verified_against` block already recorded **`0ba8ab0d`**, and says so explicitly | **Misleading** |
| "Wave 1 changed **244 files**" | `33945090…0ba8ab0d` = **244 files / 91 commits** — but that is measured from Wave 1's *true* fork point | **True of Wave 1, not of this registry's exposure** |
| `d104cf49` is the "pre-merge base" | `d104cf49` is **commit 89 of 91 _inside_ the Wave-1 integration branch** and already contained **222 of the 244** changed files | **False** |
| The registry's exposure to Wave 1 | `d104cf49…64008d5ae0bdd9532909671b15a91122400accf1` = **39 files / 3 commits** | **This is the real delta** |

**And the finding that decides the whole lane:** the prior registry's `verified_against` commit
`0ba8ab0d` and this baseline have **byte-identical trees** — both
`c1c3ef45fbf0e12af8d0d59c270a1ccd279459f7`, because the merge was fast-forwardable on its first
parent. *Every reading the prior lane took at `0ba8ab0d` is therefore exactly valid at this baseline.*

> **Wave 1 changed the classification of no workflow.** The corrections in this revalidation are
> errors the prior lane made **against the tree it actually read**, plus two reasons that were right
> about the state and wrong about the cause. That is a different and more useful result than
> "the branch was stale".

### The 39-file delta, and what cites it

Only three commits separate the two SHAs: `f7a4a26e` (the two Owner rulings — blocked-time UNION and
`stock_locations` retired), `0ba8ab0d` (docs: the `tstzrange` target withdrawn) and the merge itself.
**Five of 86 workflows cite a file in that delta**; the remaining 81 were citation-spot-checked.

| Workflow | Cites | Re-verified outcome |
|---|---|---|
| `WF-SVC-003` | `availabilityModel.ts`, `dispatchBoardGeometry.js` | **Already correct.** Cites `:231 mergeBlockedIntervals` and `:271 blockedMinutesInBand`; both verified at the baseline. One citation fixed (below). |
| `WF-SVC-004` | + `schedulingCommands.ts` | **Already correct**, and more precise than the tasking: it already records the **exact-replay collapse**. |
| `WF-SVC-013`, `WF-SVC-019` | `availabilityModel.ts` | Citations verified; no classification effect. |
| `WF-INV-015` | `adminPolicy/types.ts` | Change is **comment-only** (`29 entities / 394 fields` → `28 / 389`, a consequence of the `stockLocation.js` deletion). No effect. |

### The Owner rulings, verified rather than assumed

- **Blocked-time UNION — landed, and the tasking's summary of it is incomplete.**
  `createTechnicianBlockedTime` no longer refuses overlapping blocked time (ND-25 withdrawn), and both
  readers merge before measuring — `availabilityModel.mergeBlockedIntervals` (`:231`) and
  `dispatchBoardGeometry.mergeBlockedIntervals` (`:232`), the second a deliberate hand-mirror because
  the packages share no module path. **But the command is not simply permissive now:** it collapses an
  **exact replay** (same technician, kind, both endpoints and note) idempotently, returning the existing
  `blockId` and writing neither a document nor an audit event. "No longer refuses overlapping blocked
  time" is true and incomplete; `WF-SVC-004` already had this right.
- **`BLOCKED_TIME_CONFLICT` still refuses PLACEMENT, as warned.** Live at
  `placementPolicy.ts:101`, reached from `checkPlacement` via `findBlockedTimeConflict`, which remains
  exported and has exactly one caller. **Placement still respects PTO.** No record in this registry
  claims otherwise.
- **`stock_locations` retired, with no migration.** `field-ops-app-vite/src/metadata/definitions/stockLocation.js`
  and its test are **deleted** at this baseline (both were still present at `d104cf49`);
  `entityRegistry.js:54` carries the ruling. No migration was added — the three SQL files that mention
  the name only *document* why no such table exists. `WF-INV-009` and `WF-XD-003` already record the
  consequence (P2-D item 15c) correctly.
- **`tstzrange` withdrawn** in `0ba8ab0d`, documentation only.
- **The six §7 demotions all still hold.** Each was already marked *"re-read at `0ba8ab0d`"*, which is
  this baseline's tree. Four of them (blocked-time refusal, the board's summing, the `tstzrange`
  target, the stale `stockLocation.js`) describe changes that land in the 39-file delta — so they were
  correct **only** because the prior lane looked past its own base, exactly as its §7 heading says.

### Citation audit — all 86 records

| Measure | Result |
|---|---:|
| File/line citations extracted from all 86 records | 574 |
| Resolving to a file present at the baseline | **574** |
| Line numbers past end of file | **0** |
| Citations naming a bare basename that exists at two paths | 22 |

One substantive citation error, and it is an authoring error rather than Wave-1 drift
(`transitionEngine.ts` is unchanged across all 244 files):

| Record | Was | Is | Note |
|---|---|---|---|
| `WF-SVC-003` | `transitionEngine.ts:133 (Schedule)` | **`:134`** | `:133` is `Unschedule`. The `:128-143` range for `ACTION_PERMISSIONS` is correct. |

---

## 1. The map

**86 workflows across 14 domains.**

| Domain | Workflows |
|---|---:|
| Service | 11 |
| Finance | 12 |
| Inventory | 9 |
| Administration | 8 |
| Warehouse | 6 |
| Cross-domain | 6 |
| Scheduling | 5 |
| Equipment | 5 |
| Sales | 5 |
| CRM | 5 |
| Technician | 4 |
| Scanner | 4 |
| Reporting | 4 |
| Purchasing | 2 |

---

## 2. State histogram

| State | Count | Share | Meaning |
|---|---:|---:|---|
| `WORKS_END_TO_END` | **0** | 0% | A path that runs from trigger to settled outcome with no gap. **There are none.** |
| `WORKS_WITH_GAPS` | **27** | 31% | The path completes, and something along it is wrong, lossy, ungoverned or unstated. |
| `BROKEN_MIDWAY` | **32** | 37% | The path starts, gets somewhere real, and has no next step. |
| `CANNOT_START` | **22** | 26% | The first step refuses, for every principal, in the environment named. |
| `NO_IMPLEMENTATION` | **5** | 6% | The business runs this path and EOS models no part of it. |

**Zero workflows are `WORKS_END_TO_END`.** That is not a rhetorical flourish and it is not a claim
that nothing works — 27 paths do complete. It is a consequence of the rule this registry was built
under: a workflow is only whole if every step from trigger to settled outcome is both implemented
*and* reachable by a job someone does, and no path in EOS currently clears both bars. The nearest
misses are recorded as `WORKS_WITH_GAPS` with the specific gap named.

*Recomputed at `64008d5ae0bdd9532909671b15a91122400accf1`. The single movement from the prior histogram is `WF-RPT-001`, `CANNOT_START` →
`BROKEN_MIDWAY`; it is a severity **increase**, not a fix. Nothing became `WORKS_END_TO_END`, and Wave 1
fixed the state of no workflow.*

**A reading caution.** `CANNOT_START` is almost always environment-specific. Twenty-two workflows
cannot start *in production*; most of those same paths resolve in `platform-sandbox`, where 92
capability ids are activated — and production is **no longer** a zero-activation environment: it
adopts 25 `report.*` ids (see §6.4). Where the wall differs by environment, the record says so in
`blocking_note` — and the interesting cases are the ones where the sandbox wall is a *different*
wall from the production one, because only the sandbox wall survives an activation decision.

### Blocking mechanism histogram

| Mechanism | Count |
|---|---:|
| `NO_CODE` | 35 |
| `CAPABILITY_INACTIVE` | 21 |
| `OWNER_DECISION_PENDING` | 15 |
| `RULES_DENY` | 4 |
| `NOT_GRANTED_TO_ANY_JOB` | 3 |
| `CLIENT_GATE_NEVER_REQUESTED` | 3 |
| `ENVIRONMENT_NOT_ACTIVATED` | 4 |
| `TRANSPORT_UNREACHABLE` | 1 |
| `SCHEMA_ABSENT_NONPROD` | 0 |

Each record carries exactly one `blocking_mechanism` — the one that stops the path *first*. Where a
workflow is blocked more than once, or differently in different environments, the additional
mechanisms are named in `blocking_note`. Twenty-two records carry a `blocking_note`; reading only the
histogram will understate how many paths are blocked in more than one way at once.

`SCHEMA_ABSENT_NONPROD` is zero because the workflow it would govern — reaching a Postgres authority
from a browser — is stopped earlier by `TRANSPORT_UNREACHABLE`. The schema absence is real and is
recorded in that record's `blocking_note`; it is simply never the *first* wall.

### Evidence histogram

| Evidence status | Count |
|---|---:|
| `TRACED` | 54 |
| `EXECUTED` | 32 |
| `INFERRED` | 0 |

*Recomputed at `64008d5ae0bdd9532909671b15a91122400accf1`. `EXECUTED` fell 34 → 32. Both movements are **demotions**
(`WF-ADM-001`, `WF-ADM-006`); nothing was promoted, and **`TRACED` is never promoted to `EXECUTED`**.*

**What `EXECUTED` is worth here, stated exactly.** The 32 surviving `EXECUTED` records rest on ONE
probe: capability resolution against the shipped resolver. Lane P3-WF **independently re-ran that
probe at `64008d5ae0bdd9532909671b15a91122400accf1`** — 147 capabilities × 48 roles against
`resolveEffectivePermission`, the real Role catalogs and `ENVIRONMENT_ACTIVATION_REGISTRY`, under Node
22 type-stripping, with no network, no Firestore, no emulator and no production contact. It reproduced
eight of the prior figures exactly and **corrected five** (§6.4). A record keeps `EXECUTED` only where
the fact that decides its state is a resolver outcome in that re-run; where the deciding fact is a code
reading, it is now `TRACED`.

**Nothing in this registry is `INFERRED`, and that is a claim about this file only.** Every record
carries at least one `authority_path` citation that resolves to a file present at this baseline (574 of
574 citations; zero line numbers past end of file). The programme's separate finding that **34 of
P3-B3's 118 recorded output lines are unanchored and are therefore `INFERRED`, not `EXECUTED`**, is
about a **different population** — P3-B3's output lines, not these records — and the numerical
coincidence with the prior `EXECUTED` count of 34 is exactly that, a coincidence. Where a P3-B3
activity id is a record's *sole* corroboration it appears in `supporting_activities`, never as the
`authority_path`, so no record's tier rests on an unanchored line.

---

## 2a. The catalogue

One row per workflow. `break point` is the first sentence of the record's full `break_point` field;
the complete text, the ordered steps, the authority paths and the supporting activity ids are in the
JSON companion.


### Service (11)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-SVC-001` | Inbound customer email becomes decided service demand | `WORKS_WITH_GAPS` | `CAPABILITY_INACTIVE` ‡ | `TRACED` | Step 1. If the transport has not polled, the queue renders empty and an empty queue is indistinguishable from no weekend demand (P3B1-S01-A01, P3B1-S27). |
| `WF-SVC-002` | Phone call becomes a numbered Work Order | `WORKS_WITH_GAPS` | `NO_CODE` ‡ | `TRACED` | Step 3. woNumbering.ts:50 — `const sequence = snap.exists ? (snap.data() as CounterDoc).sequence + 1 : 1;` — a lost counter document silently restarts numbering at 000001, there is no unique constraint anywhere, and `counters` is `allow read: if false`… |
| `WF-SVC-011` | Hand a job over to another technician mid-day | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 2. The lifecycle has no transfer edge that preserves what the first technician already did. |
| `WF-SVC-012` | Coordinated visit — one customer, several machines, one trip | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 4. Five Work Orders, one truck, one customer site, mission reads PARTIAL — and there is no command on either route that moves it forward. |
| `WF-SVC-013` | After-hours emergency call | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 4. Nothing in EOS distinguishes after-hours work commercially. |
| `WF-SVC-014` | Planned-maintenance campaign across many sites | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 1 has no bulk path and step 3 has no object. |
| `WF-SVC-015` | Manufacturer safety notice — find every affected machine in the field | `BROKEN_MIDWAY` | `ENVIRONMENT_NOT_ACTIVATED` ‡ | `EXECUTED` | Step 3, **reason corrected**. The equipment report ids **are** production-adopted and **do** resolve ALLOW (owner, admin, `reportViewer`). The blocker is the release gate, not capability inactivity. |
| `WF-SVC-016` | Service month close and the technician scorecard | `BROKEN_MIDWAY` | `OWNER_DECISION_PENDING` | `TRACED` | Step 3 is impossible: no Work Order carries an operating company, and DECISIONS #143 forbids inferring it from technician, dispatcher, creator, customer or location. |
| `WF-SVC-017` | Service Operations exception review (control tower) | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Step 2 never populates (SO-G5). |
| `WF-SVC-019` | New technician reaches a workable state | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Step 2 is the identity trap P2-D item 18 fences: the technician identity key space is fieldops_technicians document ids, not Firebase uids, and users/{uid}.technicianId is spent as an Employee id in at least one place (trucks.assignedDriverEmployeeId). |
| `WF-SVC-020` | Warranty work | `NO_IMPLEMENTATION` | `NO_CODE` | `TRACED` | Step 2 renders a placeholder. There is no claim object, no coverage model, no provider, no service-under-warranty concept and no billing consequence anywhere in EOS. |


### Scheduling (5)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-SVC-003` | Place ready work on a technician's day (Schedule) | `WORKS_WITH_GAPS` | `NO_CODE` ‡ | `TRACED` | Not the arithmetic — that was fixed at the integrated head (see demotions). |
| `WF-SVC-004` | Record a technician's working schedule and absences | `WORKS_WITH_GAPS` | `NOT_GRANTED_TO_ANY_JOB` ‡ | `TRACED` | Step 2, for the actor rather than the act: createTechnicianBlockedTime requires a dispatcher (requireDispatcher, schedulingCommands.ts:82-91). |
| `WF-SVC-005` | Commit a named technician to a named job (Dispatch) | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Step 3's visibility rule is a legacy role string, not a capability: firestore.rules:507-508 is the only reach control, and no workOrder.read capability exists in the catalog at all. |
| `WF-SVC-006` | Legacy job dispatch (fieldops_jobs) | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | There is no break in the sense of a refusal — the path completes. |
| `WF-SVC-018` | Two obsolete scheduling boards remain routed and writable | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Nothing refuses. SchedulingWorkspace.jsx:25 still asserts at the integrated head that 'true "reschedule" is NOT a deployed transition' — rescheduleWorkOrderCallable has been deployed and certified since 2026-08-27. |


### Technician (4)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-SVC-007` | Technician executes the visit: Accept, Travel, Arrive, Work, Complete | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Step 4→5. Complete is a technician action and Close is an admin/dispatcher action, so a Work Order cannot be finished by one person — correct by design. |
| `WF-SVC-008` | Record parts consumed on a Work Order | `WORKS_WITH_GAPS` | `OWNER_DECISION_PENDING` | `TRACED` | Step 4 is the seam P2-D item 4 names: two code paths compute commitment differently and one over-reports availability (fulfillmentAvailability.ts:138-139 vs inventoryService.ts:153-160 vs :168-189). |
| `WF-SVC-009` | Record technician labour and carry it to a bill | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 1. Both workOrder.labor.record and workOrder.labor.correct are registered active:false AND are absent from every capabilityActivationOverrides array in config/environments.json — including platform-sandbox. |
| `WF-SVC-010` | Offline field capture and sync | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Step 3. An offline write and a dispatcher reschedule made while the technician was dark can both be legitimate. |


### Equipment (5)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-EQP-001` | Register a customer's installed machine | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | No break in the create path. The governance gap is that Administration → Objects lists an object whose permissions are not expressible as capabilities AT ALL — a third condition, distinct from both 'ungranted' and 'inactive'. |
| `WF-EQP-002` | Install a serialized unit at a customer | `BROKEN_MIDWAY` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Two, at different layers. (a) In PRODUCTION, steps 1-3 cannot start: EXECUTED at the integrated head, all three capabilities resolve DENY/inactivePermission for every one of the 48 roles under the production activation set (which is empty —… |
| `WF-EQP-003` | Move, retire or reactivate an equipment record | `CANNOT_START` | `RULES_DENY` ‡ | `TRACED` | Step 2. The buttons are honest and the capability is absent. |
| `WF-EQP-004` | A technician reads the equipment at the site they are standing on | `CANNOT_START` | `RULES_DENY` | `TRACED` | Step 1. Equipment reads are gated on isAdminOrDispatcher(). |
| `WF-EQP-005` | Maintain equipment model compatibility (which part fits which machine) | `CANNOT_START` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Step 1. Five capabilities, built and registered, that can run in no environment the repository declares AND are held by no governed business role. |


### Inventory (9)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-INV-001` | Supplier delivery arrives at the dock and becomes stock | `BROKEN_MIDWAY` | `ENVIRONMENT_NOT_ACTIVATED` ‡ | `TRACED` | Step 3, and not for an authority reason. |
| `WF-INV-005` | Answer 'do we have any?' — the availability number | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | The number renders. |
| `WF-INV-009` | Move stock across the company line (Taylor to Ventana) | `BROKEN_MIDWAY` | `OWNER_DECISION_PENDING` | `TRACED` | Step 2. |
| `WF-INV-010` | Quarterly cycle count | `BROKEN_MIDWAY` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Step 5 names a capability that does not exist. |
| `WF-INV-012` | Administer the part catalog — identity, aliases, duplicate part numbers | `BROKEN_MIDWAY` | `ENVIRONMENT_NOT_ACTIVATED` ‡ | `EXECUTED` | Step 3. |
| `WF-INV-013` | Load opening balances from a workbook | `CANNOT_START` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Step 1 in every environment (both capabilities active:false and sandbox-unactivated for .stage/.execute per P3-B3's EXECUTED probe), and step 3 refuses production categorically and deliberately — the guard runs BEFORE the capability check, so production… |
| `WF-INV-014` | A part comes back from a job (returns) | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 1 has a built, granted backend command and no screen at all — the exact inverse of the racking surface. |
| `WF-INV-015` | Acquire and hold custody of a serialized asset | `WORKS_WITH_GAPS` | `OWNER_DECISION_PENDING` | `TRACED` | In production step 1 cannot start (active:false). |
| `WF-INV-016` | Inventory month end — the Controller's four numbers | `BROKEN_MIDWAY` | `OWNER_DECISION_PENDING` | `TRACED` | Step 2. The cost engine is written, 425 lines, and imported by nothing. |


### Warehouse (6)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-INV-002` | Put a received unit away into a bin | `WORKS_WITH_GAPS` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 3 is not a break so much as a boundary the product does not state: put-away records a position, not a quantity movement, and since BIN-P6 / Decision #170 placement alone is no longer an authoritative put-away. |
| `WF-INV-003` | Move stock from one bin to another | `CANNOT_START` | `CLIENT_GATE_NEVER_REQUESTED` | `TRACED` | Step 1, permanently, for every principal in every environment. |
| `WF-INV-004` | Rack a warehouse — create and administer bins | `CANNOT_START` | `CLIENT_GATE_NEVER_REQUESTED` | `TRACED` | Step 1. |
| `WF-INV-008` | Load a truck before the run (restock / transfer to mobile) | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 1, in production. All four transfer capabilities are active:false (EXECUTED, prodAllow=0). |
| `WF-INV-011` | Create a warehouse | `NO_IMPLEMENTATION` | `NO_CODE` ‡ | `EXECUTED` | Step 2. There is no registered warehouse write capability anywhere, the writer is unexported, and every warehouse row in every environment came from a seed or an operator CLI (docs/operations/warehouse-assignment-provisioning-runbook.md:46-55). |
| `WF-INV-017` | Pick and stage parts for a job | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 2. Picking writes a placement with a job reference and reserves nothing, so two jobs can be picked the same unit and both be told it is theirs. |


### Purchasing (2)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-INV-006` | Reorder: recommendation to request to purchase order to receipt | `WORKS_WITH_GAPS` | `OWNER_DECISION_PENDING` | `TRACED` | Nothing refuses; the whole chain completes. |
| `WF-INV-007` | Purchase order lifecycle on the purchasing desk | `WORKS_WITH_GAPS` | `OWNER_DECISION_PENDING` | `TRACED` | Two purchase-order collections exist and only one is governed; the designed nine-column list and its Dollars contract were written against `purchase_orders` while the reachable screen reads `reorder_purchase_orders`. |


### Scanner (4)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-SCN-001` | What a scan means — identity resolution | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | A live inconsistency the source lanes found and no document resolves: serials are CASE-SIGNIFICANT in matching and CASE-INSENSITIVE in three separate duplicate checks (test/receivingScanQueue.test.mjs:109; putAwayCommand.ts:243-244;… |
| `WF-SCN-002` | Who is allowed to scan what | `WORKS_WITH_GAPS` | `CAPABILITY_INACTIVE` | `TRACED` | The shell itself is correct and is one of only two Service-domain surfaces that gates on capabilities rather than role strings. |
| `WF-SCN-003` | Scanning under degraded connectivity | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | A fixed defect worth carrying as a regression: the offline put-away queue's localStorage key was NOT scoped to a principal, so two warehouse workers sharing one handheld shared one queue (warehouse-parts-offline-runtime.md:183-188). |
| `WF-SCN-004` | Technician records a part on the job from the handheld scanner | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Step 3. No undo, no correction, no running total, and a duplicate scan records silently. |


### Sales (5)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-SLS-001` | Open and work an opportunity to a decision | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 1, in production. Every opportunity.* capability resolves DENY/inactivePermission for all 48 roles under the production activation set (EXECUTED). |
| `WF-SLS-002` | Quote the deal — the Sales Agreement | `BROKEN_MIDWAY` | `NO_CODE` ‡ | `EXECUTED` | Step 2 — SA-G7, and it is the sharpest single workflow break in the registry. |
| `WF-SLS-003` | Book, allocate, fulfil and close a Sales Order | `BROKEN_MIDWAY` | `NOT_GRANTED_TO_ANY_JOB` | `EXECUTED` | Step 2, and the break survives activation. |
| `WF-SLS-004` | Route a lead to whoever covers the account (territory / coverage) | `CANNOT_START` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Step 1, in every environment the repository declares. |
| `WF-SLS-005` | Price a deal — price lists, discounts, templates, history | `NO_IMPLEMENTATION` | `NO_CODE` | `TRACED` | Step 1. Every price on every agreement is typed by hand, with no history, no list, no schedule, no template and no approval threshold. |


### CRM (5)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-CRM-001` | Create and maintain a customer account | `BROKEN_MIDWAY` | `RULES_DENY` | `EXECUTED` | Step 3. |
| `WF-CRM-002` | Correct a customer record created in error | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 2. There is no correcting act for a customer created in error. |
| `WF-CRM-003` | Manage contacts on an account, including bulk import | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 2. A client writeBatch walks around the governed Data Import pipeline entirely — that pipeline has a contract, a job record, an environment guard and an audit trail, and this path has none of the four. |
| `WF-CRM-004` | Manage customer sites and reparent one after a franchise sale | `BROKEN_MIDWAY` | `RULES_DENY` | `TRACED` | Step 3. The Location can be reparented and the installed base cannot follow it. |
| `WF-CRM-005` | See a customer's whole relationship on one page (Customer 360) | `WORKS_WITH_GAPS` | `CAPABILITY_INACTIVE` | `EXECUTED` | Steps 2-5 are all gated on capabilities that are active:false, so in production the richest page in the product renders identity and a column of honest refusals. |


### Finance (12)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-FIN-001` | Bill a customer — issue the invoice | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 2, in production, by every role. This is the single most consequential finding in the registry: THE BUSINESS CANNOT BILL A CUSTOMER FROM EOS TODAY IN PRODUCTION. |
| `WF-FIN-002` | Bill a service visit that has no Sales Order behind it | `CANNOT_START` | `OWNER_DECISION_PENDING` | `TRACED` | Step 1. A break-fix Work Order with no Sales Order has no route into the billing spine at all. |
| `WF-FIN-003` | Take the customer's money | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 1 in production (active:false). |
| `WF-FIN-004` | Undo a billing mistake — void, credit, adjust, refund, write off | `CANNOT_START` | `OWNER_DECISION_PENDING` ‡ | `EXECUTED` | Step 1. An invoice cannot be voided and the system is built as if it could — schema columns, a VOID position in the projection, reconciliation that reads it, and no writer. |
| `WF-FIN-005` | Chase what is owed — AR aging and collections | `WORKS_WITH_GAPS` | `NO_CODE` | `TRACED` | Step 3. AR ages an invoice by a due date that no system computed — invoice issuance does not derive the due date from the customer's payment-terms enum, because there is no terms engine, so the whole aging ladder rests on a hand-typed field. |
| `WF-FIN-006` | See a financial number at all (FIN-004 visibility) | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 2. In the only environment where finance is activated at all, the override array lifts `.consolidated` and not `.self`, `.team`, `.businessUnit` or `.company`. |
| `WF-FIN-007` | Close the accounting period | `CANNOT_START` | `CLIENT_GATE_NEVER_REQUESTED` ‡ | `EXECUTED` | Step 1. The close model is built, dormant, and has nowhere to store a period. |
| `WF-FIN-008` | Know what a job cost and what it earned (margin) | `CANNOT_START` | `OWNER_DECISION_PENDING` | `EXECUTED` | Step 1. Margin is STRUCTURALLY unknown — not missing data, but an unruled authority — and the binding display rule is that it must render as unknown rather than as zero. |
| `WF-FIN-009` | Account for work one company does for the other (intercompany) | `CANNOT_START` | `OWNER_DECISION_PENDING` | `EXECUTED` | Step 1, by explicit Owner block. This is the registry's clearest example of a workflow that is blocked correctly: FIN-BLOCK-004 is a recorded refusal to guess, not a gap. |
| `WF-FIN-010` | Pay a supplier | `NO_IMPLEMENTATION` | `NO_CODE` | `TRACED` | Step 1. Half of the money in a distribution business — what it owes — is not modelled at all. |
| `WF-FIN-011` | Reconcile EOS against the accounting system of record | `CANNOT_START` | `OWNER_DECISION_PENDING` | `TRACED` | Step 2. Which system is the authority of record for financial figures has not been decided (#145), so external reconciliation is blocked at the root. |
| `WF-FIN-012` | Reach a Postgres finance or CRM authority from a browser | `BROKEN_MIDWAY` | `TRANSPORT_UNREACHABLE` ‡ | `TRACED` | Step 2/3. Sixteen authority modules exist under functions/src/eosOps/ and functions/src/eosCommercial/. |


### Reporting (4)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-RPT-001` | Build and run a governed report | **`BROKEN_MIDWAY`** | `ENVIRONMENT_NOT_ACTIVATED` ‡ | `EXECUTED` | **Reclassified from `CANNOT_START`.** 25 `report.*` ids are activated in production and resolve ALLOW; `reportExecutionService.ts:420` then authorizes at `{ scope: global }`. Severity up, not down. |
| `WF-RPT-002` | Save, share and delete a report definition | `BROKEN_MIDWAY` | `NOT_GRANTED_TO_ANY_JOB` | `EXECUTED` | Step 3, and it survives activation. `report.definition.delete` is one of the 21 capabilities held only by admin/owner, so the `reportAuthor` role — the job built for this — can create, rename and duplicate its own definitions and cannot delete them. |
| `WF-RPT-003` | See your own dashboard | `WORKS_WITH_GAPS` | `CAPABILITY_INACTIVE` | `TRACED` | No break: the composition is Owner-accepted and live-verified, and it is the only place in the repository with a working guard against the client-gate defect class. |
| `WF-RPT-004` | Set and track a performance goal | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 1 in production (all five active:false, prodAllow=0 EXECUTED). |


### Administration (8)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-ADM-001` | Govern an object — fields, labels, sensitivity | `BROKEN_MIDWAY` | `OWNER_DECISION_PENDING` | **`TRACED`** | Step 3. Tier demoted from `EXECUTED`: the decisive fact is a code reading, not a resolver outcome. |
| `WF-ADM-002` | Grant and revoke a person's access | `BROKEN_MIDWAY` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Step 4 cannot run anywhere: administrator-initiated password reset is built end to end — eligibility, dedupe, link validity, outbound sender — and its capability is activated in no environment at all. |
| `WF-ADM-003` | Administer an employee record | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 1 is a Node script — there is no callable, no screen and no capability row for creating the most fundamental record in an access-control system. |
| `WF-ADM-004` | Activate a capability for an environment | `WORKS_WITH_GAPS` | `OWNER_DECISION_PENDING` | `EXECUTED` | Step 3. Activating any capability immediately grants it to every administrator and owner in the system, because the administrator compatibility role is constructed as its curated list plus every remaining catalog id. |
| `WF-ADM-005` | Configure email intake so customer email becomes work | `CANNOT_START` | `CAPABILITY_INACTIVE` | `EXECUTED` | Step 1, in production. The route fails closed correctly and the capability is inactive, so the feed that WF-SVC-001 depends on cannot be configured from the product at all in production. |
| `WF-ADM-006` | See who did what | `BROKEN_MIDWAY` | `NO_CODE` | **`TRACED`** | Step 2. Tier demoted from `EXECUTED`: deny-all collections and an absent read path are code readings. An append-only audit authority genuinely exists and governed commands write to it — including DENIALS (auditEventWriter.ts:606). |
| `WF-ADM-007` | Build and publish a workflow | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 2. A workflow can be drafted, versioned, role-bound and published, and no governed command consults it. |
| `WF-ADM-008` | Find the Company Settings screen | `NO_IMPLEMENTATION` | `NO_CODE` | `TRACED` | Step 1. |


### Cross-domain (6)

| id | workflow | state | blocks on | evidence | break point |
|---|---|---|---|---|---|
| `WF-XD-001` | Opportunity to cash — the full commercial spine | `CANNOT_START` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Step 1, in production, and every step after it. |
| `WF-XD-002` | Service to cash — the break-fix spine | `BROKEN_MIDWAY` | `CAPABILITY_INACTIVE` ‡ | `EXECUTED` | Steps 4 and 6, independently, and either alone is fatal. |
| `WF-XD-003` | Attribute a record to the company that did the work | `BROKEN_MIDWAY` | `OWNER_DECISION_PENDING` | `TRACED` | Step 3. The company boundary is declared in the ownership and Postgres layers and enforced in exactly ONE place in the whole system — AR cash application, which checks the company and fails closed on a mismatch or a NULL. |
| `WF-XD-004` | An emailed customer request becomes work that sales learns about | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 3. The Sales Order → Service direction is built and governed. |
| `WF-XD-005` | Rename a part that is already quoted and committed | `WORKS_WITH_GAPS` | `NO_CODE` | `EXECUTED` | No refusal — and that is the finding. `inventory.catalog.manage` does not refuse a rename on a part with open commitments, and it is one of the few capabilities live in production. |
| `WF-XD-006` | Disable an employee who is mid-job | `BROKEN_MIDWAY` | `NO_CODE` | `TRACED` | Step 2. |


‡ = this workflow is blocked by more than one mechanism, or by a different mechanism in a
different environment. The record's `blocking_note` says which.


---


## 3. Break points, ranked by business consequence

A break point is the exact step where a path stops. These are the ones that cost the business the
most, and the ranking is by what the business cannot do, not by how many records mention it.

### 1. The business cannot sell, fulfil or bill from EOS in production — by any role
`WF-XD-001`, `WF-FIN-001`, `WF-SLS-001`, `WF-SLS-003`.
**EXECUTED at `0ba8ab0d`: 37 of 147 capabilities are allowed anywhere in production, and not one of
them is commercial.** `finance.invoice.issue`, every other `finance.*`, every `salesOrder.*`, every
`opportunity.*`, every `salesAgreement.*` and every `report.*` id resolves `DENY/inactivePermission`
for all 48 roles. The commands are written, tested, deployed and fail-closed
(`functions/src/finance/invoiceCallables.ts:112`); the capabilities are `active:false`; and
`config/environments.json`'s `taylor-parts-production` entry carries no `capabilityActivationOverrides`
key at all. **This is an activation decision, not a build gap** — which is what makes it the most
consequential and the cheapest to move.

### 2. The most common revenue event in a field-service business has no path
`WF-XD-002`, `WF-SVC-009`, `WF-FIN-002`.
A technician fixes a machine and the customer is billed for parts and hours. This is broken at both
ends and either break alone is fatal. **Input:** `workOrder.labor.record` and `workOrder.labor.correct`
are `active:false` *and* absent from every `capabilityActivationOverrides` array in the repository —
EXECUTED, they resolve DENY for all 48 roles under both the production and the sandbox sets. Labour
cannot be recorded in any environment EOS declares, so it cannot reach billing. **Output:** the
billing spine anchors on the Sales Order (FIN-BLOCK-002), so a break-fix Work Order with no Sales
Order has no route into it. Steps 1-5 of the path work; the two that turn work into money do not.

### 3. The order-to-cash chain has a step in the middle that belongs to no job
`WF-SLS-003`, `WF-XD-001`.
`salesOrder.fulfill` and `salesOrder.service` are held by `owner`, `admin` and `dispatcher` — and by
no governed business role. **EXECUTED: `salesperson`, `generalManager` and `operationsManager` all
resolve `DENY/noQualifyingGrant` in the sandbox, where the activation gate is lifted.** Six roles can
book an order; thirteen can read one; none of the business-named roles can advance it. The only
non-administrator who can is the dispatcher — who is deliberately excluded from billing authority a
few lines away in the same file. **This break survives activation**, which is why it ranks above
several larger-looking ones.

### 4. Five built surfaces are unreachable by everyone, forever, and no test catches it
`WF-INV-003`, `WF-INV-004`, `WF-FIN-007`, and the compatibility section of `WF-INV-012`'s part record.
A component gates on a capability id that is not in `REPORT_CAPABILITY_REQUEST`
(`field-ops-app-vite/src/access/reportCapabilityAccess.js:30`, 44 ids). The feed is therefore never
asked, returns `undefined`, and the fail-closed gate at `:139-148` grants only on an explicit `true`.
The five ids, verified at the integrated head by resolving all four constituent lists and diffing
against every capability gate in `field-ops-app-vite/src`:

| Capability | Gated at | What it costs |
|---|---|---|
| `inventory.location.bin.manage` | `AdminWarehouseRacking.jsx:42`, checked `:158` | Nobody can rack a warehouse. Every control renders `<Ungated>` at `:323` — including for `inventoryBinAdministrator`, the role built to hold it. |
| `inventory.stock.relocate` | `access/scanWorkflows.js:91`, gate `:211` | The one scanner workflow that moves quantity can never be offered to anyone. |
| `equipment.compatibility.view` | `domain/equipmentCompatibilitySection.js:13`, gate `:32` | The Part record's compatibility section is dead for everyone. |
| `financialPolicy.profile.read` | `AdminFinancialPolicy.jsx:39`, gate `:71` | The financial policy profile cannot be read from the product. |
| `financialPolicy.profile.configure` | `AdminFinancialPolicy.jsx:40`, gate `:72` | …or configured. Activating the capability would not help. |

**The guard that should catch this class is a tautology.**
`field-ops-app-vite/test/navCapabilityConvergence.test.mjs:147-151` asserts that
`GOVERNED_SURFACE_CAPABILITY_IDS ⊆ REPORT_CAPABILITY_REQUEST` — and `REPORT_CAPABILITY_REQUEST` is
*defined* by spreading `GOVERNED_SURFACE_CAPABILITY_IDS` into it. The subset relation is true by
construction; the test can never fail, and it reads component gates not at all. It is registered in
`suites.json:541` and passes. The one real guard,
`field-ops-app-vite/test/dashboardComposition.test.mjs:460-477`, greps the *source* of one file for
`has(ctx, "...")` call sites and diffs the extracted set against the request — exactly the right
shape, hardcoded to `domain/dashboardComposition.js`. Four post-acceptance correctives to My
Dashboard (#1793) were fixes for this same defect class. Adding the five ids takes the request from
44 to 49, inside the feed's 100-id bound.

### 5. Nobody can create a warehouse — the object that is the company boundary root
`WF-INV-011`.
There is **no registered warehouse write capability anywhere**: `inventory.warehouse.status.set` is
checked at `functions/src/warehouseGovernance/warehouseStatusWriter.ts:127` and `:176` and is
**absent from the 147-id catalog** (EXECUTED at `0ba8ab0d`). The writer declares itself *"INERT,
UNEXPORTED … no callable; production-inert (no caller)"* at `:1-6` and its only importers are two
test files. Every warehouse row in every environment came from a seed or an operator CLI. The
ownership model calls a Warehouse *"the company boundary root"*; the product cannot make one.

### 6. An invoice cannot be voided, and the system is built as if it could
`WF-FIN-004`.
The Postgres invoice table carries `void_reason`, `voided_at` and `voided_by` with an all-or-nothing
CHECK; the AR projection understands a `VOID` position and reconciliation reads it. **No write path
sets any of it** — the migration says so itself. Meanwhile `issueInvoice` does not read the governed
Sales Order, so it cannot observe a cancellation: an invoice can be issued for an order cancelled an
hour earlier, and issued in error it is permanent.

### 7. A Sales Agreement cannot be unblocked from the page that reports it blocked
`WF-SLS-002` (SA-G7).
Acceptance refuses while a line has no price. Line pricing is **not on the record page** — the editor
lives in `SalesAgreementPanel` in the Opportunity workspace. Two surfaces, one record, one editor,
and the product never taught anyone which. The sharpest single workflow break in the registry:
a user is told what is wrong on a page that cannot fix it.

### 8. Five of seven capability holders are refused by the rules that actually decide
`WF-CRM-001`.
`customer.record.update` is **ACTIVE** and resolves ALLOW for seven roles including `salesperson`,
`salesManager`, `officeManager` and `generalManager` (EXECUTED). The write path is a client-direct
Firestore write (`field-ops-app-vite/src/domain/accounts.js:78`) governed by `isAdminOrDispatcher()`
(`firestore.rules:22-24`), which admits exactly `"admin"` and `"dispatcher"`. The capability model and
the enforcing authority disagree about the same act, and the capability model is the one the product
shows people.

### 9. The availability number on three screens is wrong in three compounding ways
`WF-INV-005`.
`computeAvailableStockByPart` (`field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts:273-291`)
adds the hardcoded 200-SKU static catalogue baseline — whose own header says *"METADATA ONLY — NO
STOCK AUTHORITY"* — on top of ledger movements (`:287`, `:288`); handles four of the nine physical
movement types, missing `RETURNED`, `SCRAPPED`, `RELOCATION_IN`, `RELOCATION_OUT` and
`WORK_ORDER_CONSUMPTION` (`:279-281`); and is location-blind by its own docblock (`:267-268`), so
stock on a technician's truck reads as available. The server does none of these things
(`functions/src/inventoryService.ts:113-114`, `functions/src/fulfillment/fulfillmentAvailability.ts:64`),
so the screen and the allocator can disagree about the same part.

### 10. A Work Order number can silently collide, and nothing can detect it
`WF-SVC-002`.
`functions/src/woNumbering.ts:50` — `const sequence = snap.exists ? (data).sequence + 1 : 1;`. A lost
counter document restarts numbering at `000001`. There is no unique constraint anywhere, and
`counters` is `allow read: if false` (`firestore.rules:513`), so no client surface can even see the
collision. **Still live at the integrated head**, re-read this lane.

### 11. Two routes render a perfect read over a projection with no command at all
`WF-SVC-012`.
Five Work Orders, one truck, one customer site, mission reads PARTIAL — and there is no command on
either coordinated route that moves it forward. The design itself said the consuming UI was deferred
until grants and deploys landed; it shipped anyway. The same shape recurs at
`/financials/billing-queue`, `/financials/credits-adjustments` and `/administration/workflows`.

### 12. One administrative click can immobilise a day of field work
`WF-XD-006`.
`setUserStatus` does not refuse, warn or queue an exception when the subject is the assigned
technician on open Work Orders. Every technician transition carries `requiresOwnAssignment: true`
(`functions/src/transitionEngine.ts:138-142`), so nobody else can advance them — and the reassignment
path does not carry the execution record (`WF-SVC-011`).

---

## 4. Cross-domain seams — where workflows hand off and drop things

The registry's reason for existing. Each of these is a place where two domains both behave correctly
and the business loses something between them.

| # | Seam | What is dropped | Records |
|---|---|---|---|
| **S1** | Service → Finance | A completed Work Order's labour and parts. Labour cannot be recorded in any environment; the billing queue anchors on a Sales Order a break-fix job does not have. | `WF-XD-002`, `WF-SVC-009`, `WF-FIN-002` |
| **S2** | Sales → Inventory | The operating company. `allocateSalesOrder.ts:117-121` builds its eligible pool from `status == ACTIVE` warehouses with no company predicate, so a Ventana order fills from a Taylor shelf and nothing records it. | `WF-SLS-003`, `WF-INV-009`, `WF-XD-003` |
| **S3** | Sales → Service | Ownership of the next step. `salesOrder.fulfill` and `salesOrder.service` belong to no governed business role, so the order arrives in Service by a route no named job can take. | `WF-SLS-003`, `WF-XD-001` |
| **S4** | Service → Sales | The whole direction. Sales Order → Service is built and governed; Service → Opportunity does not exist in any form, so every replacement conversation that starts as a repair call leaves EOS. | `WF-XD-004` |
| **S5** | Inventory → Finance | Cost. `inventoryCostEngine.ts` is 425 lines with zero importers and FIN-BLOCK-003 blocks a ruled cost authority, so margin is structurally unknown and must render as unknown rather than zero. | `WF-INV-016`, `WF-FIN-008` |
| **S6** | Purchasing → Inventory | The meaning of "received". The reorder chain's `ORDERED → RECEIVED` closeout touches no stock; a receiving session moves quantity. Two different facts, one word, and no surface distinguishes them. | `WF-INV-006`, `WF-INV-001` |
| **S7** | CRM → Equipment | The installed base. A Customer Location can be reparented after a franchise sale and the Equipment standing on it cannot (`firestore.rules:1512-1521`, with no command either). | `WF-CRM-004`, `WF-EQP-003` |
| **S8** | Administration → everything | Which authority a change actually edits. Roles & Permissions edits the Postgres policy store; sales, CRM and finance commands obey the capability engine; 44 Rules sites obey a legacy role string. Nothing in the UI says so. | `WF-ADM-001`, `WF-ADM-007` |
| **S9** | Administration → Service | Configuration of the feed. The Inbound Work queue reads under a live capability gate; the surface that configures the mailbox behind it is `active:false` in production, so the queue can be read and cannot be filled. | `WF-SVC-001`, `WF-ADM-005` |
| **S10** | Technician identity → everything | The join. `users/{uid}.technicianId` is a `fieldops_technicians` document id, not a Firebase uid, and is spent as an Employee id in at least one place. Nothing surfaces an incomplete link until a consumption source silently returns nothing. | `WF-SVC-019`, `WF-SVC-008` |
| **S11** | Ownership model → Inventory | The company hop. Four inventory record families were declared to inherit their operating company *from a stock location*, and the 2026-09-12 ruling retired that hop. Nothing says what they inherit from now. | `WF-XD-003`, `WF-INV-009` |
| **S12** | Reporting → Finance | The visibility contract. F13 Invariant E says *"the export of a number is the number"*, and `reportExecutionService.ts` imports `financialVisibility` nowhere. **No longer latent.** P3-WF, EXECUTED at `64008d5ae0bdd9532909671b15a91122400accf1`: 25 `report.*` ids are activated in the production project and resolve ALLOW for `reportViewer`, so a run authorized today is authorized at `{ scope: global }` (`reportExecutionService.ts:420`) with no visibility contract anywhere in the path. | `WF-RPT-001`, `WF-FIN-006` |

**The pattern across all twelve.** Not one of these seams is a bug in either domain. Each is a place
where a decision was correctly deferred on one side and the other side shipped anyway. That is why
they do not appear in any single-domain document, and it is the argument for the registry existing.

---


## 5. The authority failure modes — and the three the vocabulary cannot express

The programme's established vocabulary names four distinct authority failure modes. All four are
real and all four are in this registry. Building it surfaced **three more** — **seven distinct modes in
total** — that the nine-token
`blocking_mechanism` vocabulary has to flatten. They are recorded here so the flattening is visible
rather than silent, and every affected record names the true mode in its `blocking_note`.

| # | Mode | Token used | Why the token is or is not a good fit |
|---|---|---|---|
| 1 | Capability registered `active:false` and the environment does not lift it | `CAPABILITY_INACTIVE` | Exact. 109 of 147 ids; 23 records. |
| 2 | Environment declines to activate an id it could | `ENVIRONMENT_NOT_ACTIVATED` | Exact where it applies. |
| 3 | Gated client-side and never requested from the trusted feed | `CLIENT_GATE_NEVER_REQUESTED` | Exact. 5 ids, 5 sites, 3 records + one section. |
| 4 | Held only by `admin`/`owner`, by no job someone does | `NOT_GRANTED_TO_ANY_JOB` | Exact. See the correction in §6. |
| **5** | **Release / readiness constant** | `ENVIRONMENT_NOT_ACTIVATED` | **Poor fit.** `RECEIVING_TRANSPORT_READY` (`field-ops-app-vite/src/config/receivingReadiness.js:26`), `PART_MASTER_WRITE_READY` (`field-ops-app-vite/src/config/partMasterWriteReadiness.js:27`) and `TRUCK_MANAGEMENT_WRITE_READY` (`field-ops-app-vite/src/hooks/useTruckManagement.js:41-42`) are **compile-time** constants, resolved per environment from `config/environments.json` through `field-ops-app-vite/vite.config.js:113`'s `__APP_READINESS__` define. While false the client makes **zero callable attempts** — no refusal, no error, nothing reaches Functions. The repository names the distinction itself and is worth quoting: *"READINESS IS NOT AUTHORIZATION, and readiness true does not mean 'activated'"* (`partMasterWriteReadiness.js`), and for receiving, *"`inventory.stock.receive` is granted through governed role composition to admin, dispatcher, and owner. `RECEIVING_TRANSPORT_READY` nonetheless remains FALSE because the customer-facing Phase-F Hosting/readiness activation has not been authorized … Changing this constant AND releasing the resulting Hosting bundle requires a separate explicit Owner authorization; flipping it alone is not activation."* This is a **release gate**, not an authority gate, and no token in the vocabulary says so. Records `WF-INV-001`, `WF-INV-012`, and the truck half of `WF-INV-008`. |
| **6** | **Not expressible as a capability at all** | `NO_CODE` or `RULES_DENY` | **Poor fit.** `field-ops-app-vite/src/access/objectPermissionMap.js:92` — `{ object: "Equipment / Installed Base", rulesOnly: "equipment", C: [], R: [], E: [], D: [] }`. Contacts (`:36`) and Customer Locations (`:37`) are the same. P3-A1 §1.2 names this explicitly as *a third and distinct condition from both "ungranted" and "inactive"*. Administration → Objects renders these objects and cannot govern them. Records `WF-EQP-001`, `WF-CRM-003`, `WF-CRM-004`. |
| **7** | **Capability named in code or design and absent from the catalog** | `NO_CODE` | **Poor fit** — the code exists and checks an id that was never registered. **EXECUTED at `64008d5ae0bdd9532909671b15a91122400accf1` against all 147 ids (re-run by P3-WF; `0ba8ab0d` has a byte-identical tree):** `inventory.warehouse.status.set`, `inventory.cycleCount.close`, `financial.intercompany.classify`, `report.export`, `report.definition.share` and the whole `budget.*` family are all absent from the catalog. Records `WF-INV-011`, `WF-INV-010`, `WF-FIN-009`, `WF-RPT-001`, `WF-RPT-002`, `WF-FIN-008`. |

**Recommendation to the programme:** add `RELEASE_NOT_AUTHORIZED`, `NOT_CAPABILITY_EXPRESSIBLE` and
`CAPABILITY_NOT_REGISTERED` to the vocabulary. Each names a different owner and a different fix, and
collapsing them into the existing nine loses the distinction that tells a reader whether the remedy
is a config edit, a design decision or a catalog entry.

---

## 6. Corrections this lane makes to the programme's standing figures

### 6.1 The admin/owner-only figure is 32, not 21 — and the 11-id difference is the live part

The circulated headline is: *"21 capabilities are held ONLY by `admin`/`owner` and by no governed
business role."* The first half is exact. The second half is not what the measurement measures.

The probe that produces 21 filters holders with `h !== "admin" && h !== "owner"`. That lets
`dispatcher` — and `technician` — count as governed business roles. **They are not.** They live in
`functions/src/access/compatibilityRoles.ts`, not `governedBusinessRoles.ts`, and the roles file at
the integrated head is unambiguous: 45 governed business roles, 3 compatibility roles
(`admin`, `dispatcher`, `technician`).

**Re-EXECUTED at `0ba8ab0d`, excluding all three compatibility roles: the number is 32.**

The eleven additional ids are the ones that matter operationally, because nine of them are **ACTIVE
and live in production**:

| Capability | `active` | Holders | Production ALLOW |
|---|---|---|---:|
| `reorder.request.approve` | true | owner, admin, dispatcher | 3 |
| `reorder.request.reject` | true | owner, admin, dispatcher | 3 |
| `reorder.request.cancel` | true | owner, admin, dispatcher | 3 |
| `reorder.request.markReceived` | true | owner, admin, dispatcher, technician | 3 |
| `reorder.request.read.own` | true | owner, admin, dispatcher, technician | 3 |
| `reorder.request.create.system` | true | owner, admin, dispatcher | 3 |
| `reorder.purchaseOrder.void` | true | owner, admin, dispatcher | 0 |
| `inventory.action.create` | true | owner, admin, dispatcher | 3 |
| `inventory.analytics.read` | true | owner, admin, dispatcher | 3 |
| `salesOrder.fulfill` | false | owner, admin, dispatcher | 0 |
| `salesOrder.service` | false | owner, admin, dispatcher | 0 |

**The reorder approval chain is live in production today and reachable by no governed business
role.** A Parts Manager can raise a reorder request and cannot approve, reject or cancel one; only an
administrator or a dispatcher can.

P3-B3's own prose already knew this: its finding #3 describes `salesOrder.fulfill` as held by
*"`owner`, `admin` and `dispatcher` — and by no governed business role"*. Its headline figure of 21
is measured with a definition under which that sentence would be false. **The headline and the
finding are measured two different ways in the same document.** This is the same class of error the
programme has been warning lanes about, one level up from the grep.

Both numbers belong in the record. **0 ungranted · 21 held only by `owner`+`admin` · 32 held by no
governed business role.** The third is the one that answers *"can a job someone does actually do
this?"*

### 6.2 P3-A2's one remaining "ungranted" capability is not ungranted

P3-A2's Part 7 is a careful, correct correction of the 2026-08 design record — and it ends with one
exception: *"`equipment.compatibility.view` … **NO** — `governedBusinessRoles.ts:1471`: 'THE FOUR
COMPATIBILITY IDS ARE NOT INCLUDED' … the only capability in this domain where 'ungranted' still
holds."*

**Resolved at `0ba8ab0d`: holders are `owner` and `admin`. Zero holders is 0 capabilities out of 147.**
The four `equipment.compatibility.*` ids are granted by the catalog spread at
`compatibilityRoles.ts:235-240`, exactly like every other id. What is true — and is the more useful
statement — is that they are held by **no governed business role**, and are additionally among the 17
dead in every environment. They are `NOT_GRANTED_TO_ANY_JOB`, not ungranted.

P3-A2 reached that conclusion by reading `governedBusinessRoles.ts`, which is the grep method the
same document warns other lanes against three paragraphs earlier. It is worth saying plainly because
it shows the error is not carelessness: it is what happens whenever a grant is read from the role
file instead of resolved through the resolver.

### 6.3 Capability holder counts in P3-A2's Part 7 table are governed-role counts, not holder counts

Re-EXECUTED at `0ba8ab0d`, total holders (governed holders in brackets):

| Capability | P3-A2's figure | Resolved |
|---|---:|---|
| `inventory.catalog.read` | 15 | **19** (17 governed) |
| `inventory.balance.read` | 14 | **17** (15 governed) |
| `inventory.serializedAsset.read` | 12 | **15** (13 governed) |

P3-A1 §1.2 independently re-measured `inventory.serializedAsset.read` and got **12**, correcting a
composition map that said 8. The resolver says 15 holders, 13 of them governed. Both lanes moved the
number in the right direction and both stopped short of the resolver's answer. This is offered as a
measurement note, not a criticism: the direction of every stale claim in this programme is *understating
what exists*, and that held for both attempts.

---

### 6.4 Corrections lane P3-WF makes to the *prior lane's own* executed figures

The capability matrix was **independently re-run at `64008d5ae0bdd9532909671b15a91122400accf1`** — 147
capabilities × 48 roles against the shipped `resolveEffectivePermission`, the real
`GOVERNED_BUSINESS_ROLES` / `COMPATIBILITY_ROLES` catalogs and `ENVIRONMENT_ACTIVATION_REGISTRY`, under
Node 22 type-stripping. Read-only; no network, no Firestore, no emulator, no deploy, no production
contact. **Eight figures reproduced exactly. Five were wrong.**

**Reproduced exactly:** 147 capabilities · 48 roles (45 governed + 3 compatibility) · 109 `active:false` ·
92 `platform-sandbox` activations · 3 certification activations · **17 dead in every environment** ·
21 held only by `owner`+`admin` · **0 ungranted**.

| Figure | Prior | **Corrected** | Why |
|---|---:|---:|---|
| Production activation overrides | 0 | **25** | Production carries no `capabilityActivationOverrides` — correct — but it carries a **deliberately different field**, `productionCapabilityActivations` (`environmentCapabilityOverrides.ts:679`), composed into the resolver by `resolveRuntimeCapabilityOverrides()`. All 25 are eligible and honoured. The prior run looked for the wrong field name. |
| Allowed anywhere in production | 37 | **62** | **37 is exactly the figure you get by ignoring those 25.** Re-run with them honoured: 62. With them ignored: 37. The difference is exactly 25 — which is how the root cause was confirmed arithmetically. |
| Held by no governed business role | 32 | **33** | Under the denominator this registry itself argues for — held by no role outside `{admin, owner, dispatcher, technician}` — the executed count is 33. The prior 11-id delta omits **`reorder.request.create.manual`** (holders `owner`, `admin`, `dispatcher`). 21 + 12 = 33. |
| `report.*` family size | 38 | **39** | Executed count of catalog ids matching `report.*`. |
| Activation environments | 3 | **4** | A fourth, **`demo-certworld`** (11 inventory/equipment ids), appears nowhere in the prior registry. It does **not** move `dead_in_every_environment` (17), because its 11 ids are a subset of the sandbox 92. |

**State the denominator, always.** §8 disagreement 2 proposes that rule; this table is why it matters.
The same population yields **0**, **21** or **33** depending only on which roles count as "a job
someone does":

| Denominator | Count |
|---|---:|
| No role outside `compatibilityRoles.ts` — i.e. `owner` counts as governed | **0** |
| No role outside `{admin, owner}` — the programme's headline definition | **21** |
| No role outside `{admin, owner, dispatcher, technician}` — this registry's definition | **33** |

The same ambiguity explains §6.3's residual: `inventory.serializedAsset.read` has **15 holders** in
both readings, and **13 or 14** governed depending on whether `owner` counts.

**A self-correction, recorded deliberately.** This lane's first pass reported
`reorder.purchaseOrder.void` as a genuinely **ungranted** capability, which would have contradicted the
prior registry's `0`. That was **an artifact of this lane's own harness**: the id carries an
`isOwnAssignment` Condition everywhere it is granted, and the harness passed an empty
`ConditionContext`. With conditions satisfied it has 3 holders. **The prior registry's 0 ungranted is
correct.** It is recorded because the same empty-context artifact is the likeliest cause of any future
disagreement about this id — and because a lane that reports only other lanes' errors is not measuring
itself.

---

### 6.5 The changed-classification list

Three records change. **None of them changes because Wave 1 changed the code** — all three change
because the re-run found the production activation set, which the prior lane measured as empty.

| Record | Before | After | Reason |
|---|---|---|---|
| `WF-RPT-001` Build and run a governed report | `CANNOT_START` · `CAPABILITY_INACTIVE` · `EXECUTED` | **`BROKEN_MIDWAY`** · **`ENVIRONMENT_NOT_ACTIVATED`** · `EXECUTED` | The premise "fails closed for every principal in every environment" is false. 25 `report.*` ids are activated in production and **all 25 resolve ALLOW** for `owner`, `admin` and the governed role **`reportViewer`**. `reportExecutionService.ts:420` then authorizes at `{ scope: global }`. **Severity up, not down.** |
| `WF-SVC-015` Manufacturer safety notice | `BROKEN_MIDWAY` · `CAPABILITY_INACTIVE` · `EXECUTED` | `BROKEN_MIDWAY` · **`ENVIRONMENT_NOT_ACTIVATED`** · `EXECUTED` | State right, **reason wrong**. "No role resolves ALLOW under the production activation set" and "buildable in the sandbox and in no production environment" are both false: every equipment report id it needs is production-adopted and resolves ALLOW, and 36 of 39 `report.*` ids are sandbox-activated too. |
| `WF-ADM-001` / `WF-ADM-006` | `EXECUTED` | **`TRACED`** | Tier demotions. The facts that decide these states are code readings, not resolver outcomes. Nothing promoted. |

**And a stale safety premise in the code itself, which is the most consequential thing this lane
found.** `functions/src/index.ts:178-183` asserts that the report-execution surface *"requires NO Role
grant exists for any `report.*` capability … every real call denies today by construction of the access
layer."* **That is false at `64008d5ae0bdd9532909671b15a91122400accf1`:** `reportViewer` and
`reportFinanceViewer` hold `report.*` grants and resolve ALLOW. Defence in depth has degraded from
three independent blocks to two, and the comment asserting the third is stale. The client seam is not
the third block either — `reportExecutionSeam.js:32` calls the callable **unconditionally** and merely
maps a rejection to "unavailable". **This is a standing defect, not a Wave-1 one:**
`governedBusinessRoles.ts` and `functions/src/index.ts` are unchanged across all 244 Wave-1 files. What
still stands between this and a live global-scope data read is the claim that the callable is **not
deployed to the production project** — which is **UNPROVEN** here and not provable from the repository.

---

## 7. Defects demoted — true at `d104cf49`, fixed at the integrated head

These appear in **no workflow record**. A registry that reports fixed defects as open is worse than
no registry.

| # | Claim, as the source lane stated it | Status at `0ba8ab0d` | Evidence |
|---|---|---|---|
| **D1** | P3-B1 headline: *"the Owner ruling is violated — `schedulingCommands.ts:460-468` refuses any overlap"*, raising `BLOCKED_TIME_CONFLICT`. Cited by activities in stories S05, S23 and S32. | **OBSOLETE.** `createTechnicianBlockedTime` no longer calls `findBlockedTimeConflict` and no longer raises `BLOCKED_TIME_CONFLICT`. The function now carries the ruling verbatim in a comment block and collapses only an EXACT replay (same technician, kind, both endpoints, note), returning the existing `blockId` and writing nothing. The `work_order_tech_locks` serialization is deliberately preserved. | Re-read at `0ba8ab0d`; commit `f7a4a26e`. |
| **D2** | P3-A1 §4.1, severity Critical: *"`blockedMinutesInBand` sums clipped durations instead of computing a union; two identical 8h PTO records draw 16h blocked on an 8h lane."* | **FIXED.** `field-ops-app-vite/src/domain/dispatchBoardGeometry.js:232` now exports `mergeBlockedIntervals`, mirroring `functions/src/scheduling/availabilityModel.ts:231`, and `blockedMinutesInBand` at `:271` merges before measuring. The two are held in agreement by `functions/test/schedulingBlockedTimeUnion.test.mjs`, which imports **both** cross-package and runs the same inputs through each. | Re-read at `0ba8ab0d`. |
| **D3** | P3-A1 §4.1 consequence 3: *"the eventual Postgres form of ND-25 is a `tstzrange` exclusion constraint — that design target is now wrong and must not be carried into the migration."* | **FIXED**, and by exactly the mechanism P3-A1 asked for. `0ba8ab0d` is the commit that withdraws it: *"the target stores overlapping rows freely and computes the union at read time."* Verified as the sole remaining hit for `tstzrange` / `EXCLUDE USING` / `btree_gist`. | Commit `0ba8ab0d`. |
| **D4** | P2-D item 15, `BLOCKS_NONPROD`: the `stock_locations` mechanical residual is unapplied; `scripts/indexDriftGuard.test.mjs:187` asserts 35 against a live 34 and is RED; `listIndexCoverage` is RED. | **LANDED.** `field-ops-app-vite/src/metadata/definitions/stockLocation.js` is **deleted**, `entityRegistry.js` drops the import (29 entities → 28), the seed snapshot drops the six field-policy rows, and `indexDriftGuard.test.mjs` is re-measured to 38 live / 44 declared / 34 declared-and-live / 10 pending with 4 live-and-undeclared. `stockLocationSurfaceRetired.test.jsx` guards the deletion. | Re-read at `0ba8ab0d`; commit `f7a4a26e`. |
| **D5** | P3-A2 Part 13 outstanding work item 1: *"the list/metadata registration is stale — `stockLocation.js:73` still declares the entity over collection `stock_locations`; retire the registration."* | **DONE.** The file does not exist at the integrated head. | Re-read at `0ba8ab0d`. |
| **D6** | P2-D item 7g / Q9: *"`admin.credentialReset.initiate` — Administration advertises this verb and **no server code implements it**. Delete the advertisement, or build the command?"* Cited `capability-graph.json` `serverReferenceCount: 0`. | **STALE.** `functions/src/access/adminCredentialCommands.ts` is 798 lines / 39 KB; `adminCredentialCallables.ts` exists; and `initiateAdminPasswordReset` and `listResetEligibleUsers` are exported from `functions/src/index.ts:225-227`. **P3-B3 is right and P2-D is wrong** — see §8, disagreement 4. The capability is still inactive everywhere, so the *question* survives in P3-B3's form; P2-D's premise does not. | Re-read at `0ba8ab0d`. |

**Partial demotion — one claim narrowed rather than dropped.** The programme brief states, as its
example of an obsolete finding, *"zero hits for `BLOCKED_TIME_CONFLICT`/`findBlockedTimeConflict` in
that file at the integrated head."* That is exactly true of `schedulingCommands.ts`. It is worth
saying that the tokens are **not** gone from the tree: they live on in `errorMapping.ts`, `types.ts`,
`availabilityModel.ts` and `placementPolicy.ts`, where they mean the **placement** refusal — a job
may not be placed into blocked time — which the ruling did not touch and which
`placementPolicy.ts:98-105` still enforces. A reader who generalises "zero hits in that file" into
"the concept is gone" will conclude that placement no longer respects PTO. It does.

---

## 8. Where the inputs disagree with each other

Given in both readings, with citations, rather than resolved silently. Where this lane can settle a
disagreement with evidence, it says so and says what kind of evidence.

> **Revalidated at `64008d5ae0bdd9532909671b15a91122400accf1` by lane P3-WF: Wave 1 settled NONE of the
> nine.** All nine stood at `d104cf49`, and all nine stand at this baseline — the files each one turns
> on (`governedBusinessRoles.ts`, `compatibilityRoles.ts`, `permissionCatalog.ts`,
> `salesOrderLifecycle.ts`, `capability-graph.json`, `ownershipMatrix.ts`) are **unchanged across all
> 244 Wave-1 files**. Disagreement **7** was already recorded as settled *at the integrated head*,
> which is this baseline's tree, so it stays settled — it was **not** settled by the merge. Two are
> **amended** below, and none is silently picked.
>
> | # | Status at this baseline |
> |---:|---|
> | 1 | **Stands as settled.** 0 ungranted **re-executed and confirmed** — see the self-correction in §6.4. |
> | 2 | **Still not settled, and now quantified.** §6.4 shows the same population yields 0, 21 or 33 on denominator choice alone. P3-A3's proposed rule is the remedy. |
> | 3 | **Stands as settled** (15 holders). **Amended:** governed holders are 13 **or 14** depending on whether `owner` counts — §6.4. |
> | 4 | **Stands as settled** (P3-B3 right). Re-confirmed: `admin.credentialReset.initiate` is one of the **17 dead in every environment**. |
> | 5, 6, 8, 9 | **Unchanged.** No Wave-1 file touches any of them. |
> | 7 | **Stays settled**, but by the *integrated head*, not by the merge. **Amended:** the surviving question (P2-D 15c) is carried correctly by `WF-INV-009` and `WF-XD-003`. |
>
> **A tenth disagreement is now on the record**, between the repository and itself: `functions/src/index.ts:178-183`
> asserts no Role grant exists for any `report.*` capability; the resolver says `reportViewer` and
> `reportFinanceViewer` hold them and resolve ALLOW. **The resolver is the authority** (§6.5).

**1. Is any capability ungranted?**
P3-A2 Part 7: *"`equipment.compatibility.view` … the only capability in this domain where 'ungranted'
still holds"* (`governedBusinessRoles.ts:1471`). P3-B3 §3.1 and P3-A1 §1.2 and P3-A3 §2: zero of 147
are ungranted; `compatibilityRoles.ts:235-240` spreads the whole catalog onto `admin`.
**Settled, EXECUTED at `0ba8ab0d`: P3-B3/A1/A3 are right.** Holders of `equipment.compatibility.view`
are `owner` and `admin`. P3-A2's method was a read of the governed-roles file, which cannot see the
derived grant.

**2. How many capability ids does Administration advertise, and how many objects are inert?**
The W1-C18 handoff (`:49`, `:137`, `:159`) says *30 of 58*, and *seven objects inert on every verb*,
with Transfer Orders among them. P3-A3 §7.2 re-measures: the advertised union is **56**, not 58 (the
"58" conflates the 49 CRED ids with the 9 ids on the `WORKFLOW_ACTION_CAPABILITIES` ban list, all
nine of which are active); **twelve** objects are inert, not seven; **Transfer Orders is not one of
them** because `warehouse.transferOrder.read` is active; and **Dispatch Schedule, which is fully
inert, is omitted from the list**. P2-D item 7e re-measures the same territory differently again and
gets *57 unique ids, 31-32 `active:false`*.
**Not settled by this lane.** All three counts are over different denominators — CRED cells only, the
advertised union across three tables, and a fourth private copy — and no lane states its denominator
in the same terms as another. This registry uses none of them; it uses the resolver's 147/109. P3-A3's
proposed standing rule is the right remedy and is repeated here: *a capability claim must state the
file, the predicate that produced the number, and the denominator's definition.*

**3. Is `inventory.serializedAsset.read` granted to 8, 12 or 15 roles?**
The equipment composition map says 8. P3-A1 §1.2 re-measures and says 12, calling the map's figure
stale. P3-A2 Part 7 says 12 for the same id.
**Settled, EXECUTED at `0ba8ab0d`: 15 holders, 13 of them governed business roles.** Every lane moved
the number the same way and every lane stopped one step short of the resolver.

**4. Is administrator password reset implemented?**
P2-D item 7g: *"Administration advertises this verb and **no server code implements it**"*, citing
`capability-graph.json` `CLIENT_ONLY`, `serverReferenceCount: 0`. P3-B3 ADMIN-035: *"Administrator-
initiated password reset is **built end to end** (eligibility, dedupe, link validity, outbound
sender) and its capability is activated in no environment at all."*
**Settled at `0ba8ab0d`: P3-B3 is right.** `functions/src/access/adminCredentialCommands.ts` is 798
lines; both callables are exported from `functions/src/index.ts:225-227`. P2-D's evidence was the
capability graph artifact, which P2-D itself elsewhere records as far staler than its own
stale-reference counter suggests. Note that P3-A3 §7.6 adds a third reading neither lane carries:
four specified guards (disabled-user, missing-Employee-link, break-glass, final-active-admin) are
**not in the merged command** — and P3-A3 marks whether the closing change landed as UNPROVEN.

**5. Does `recordPutAway` carry a quantity?**
The programme brief (as quoted by P3-A2): *"`recordPutAway` is quantity-free."* P3-A2 Part 6: *"not
quantity-free — the placement record carries a `quantity` field … What is true, and stronger, is that
that quantity **participates in no balance**."*
**P3-A2 is right and its correction is the more useful statement.** Carried into `WF-INV-002`.

**6. Is the Sales Order state machine supposed to have a `DRAFT` state?**
`docs/assessments/sales-order-fulfillment-assessment.md:44` assessed `DRAFT → CONFIRMED → …`. The
shipped `functions/src/salesOrder/salesOrderLifecycle.ts:9` has no `DRAFT`, and P3-A3 found no
decision record removing it.
**Not settled. UNPROVEN whether the removal was deliberate.** Carried as an open question.

**7. Does `stock_locations` still need work?**
P3-A2 Part 13 lists four outstanding items and disposes REMOVE. P2-D item 15 records the residual as
`BLOCKS_NONPROD` with two guards red. Both were written against `d104cf49`.
**Settled at `0ba8ab0d`: the residual landed** (see §7 D4/D5). What survives is P2-D item 15c, which
the ruling *created*: four record families declared inheritance through a hop that no longer exists.
That is now the live question, and it is newer than either document.

**8. Is `warehouse.stockLocation.read` a problem?**
P3-A2 Part 13 item 2 flags it as *"still active and granted while the object is retired"*.
**Confirmed live at `0ba8ab0d`, EXECUTED: `active:true`, 4 holders, 2 governed, production ALLOW.**
The integration commit explicitly preserved it — *"labelled retired, evaluated by nothing"* — and
removed only the mapping that made it a grantable permission on a live object. So a capability
resolves ALLOW in production over an object with no Rules block, no query and no writer. Not a
defect; worth a reader knowing.

**9. How many `.test.mjs` suites are unregistered?**
Integration commit `0b95a347` says 37. P2-D item 13 confirms *"37 is exact for `.test.mjs`"* and adds
that the claim is wrong if read as `.test.mjs` **and** `.test.jsx` — the combined count of frontend
test files absent from `suites.json` is **263**.
**Both are right about different sets.** Recorded because the guard test in break point 4 is in
`suites.json` and passes, which is a reminder that registration is not coverage.

---

## 9. UNPROVEN — stated plainly

The value of the **32** `EXECUTED` records depends on the other **54** being labelled honestly, and on
this list being complete. *Re-verified and extended by lane P3-WF at `64008d5ae0bdd9532909671b15a91122400accf1`.*

**Proven by execution, at `64008d5ae0bdd9532909671b15a91122400accf1` — re-run independently by lane P3-WF:**
- Every `(role, capability, environment)` resolution quoted anywhere in this registry. 48 roles ×
  147 capabilities under the production and `platform-sandbox` activation sets, against the shipped
  resolver and the unmodified `config/environments.json`.
- The derived aggregates: 147 capabilities, 45 governed business roles + 3 compatibility roles,
  109 `active:false`, 92 sandbox overrides, 3 certification overrides, **25 production activations**
  (*not 0 — see §6.4*), 11 `demo-certworld` activations, 0 ungranted, 21 held only by `owner`+`admin`,
  **33 held by no governed business role** (*not 32*), 17 dead in
  every environment, **62 allowed anywhere in production** (*not 37 — the 37 is exactly the figure
  obtained by ignoring the 25 production activations; see §6.4*).
- Catalog membership: `inventory.warehouse.status.set`, `inventory.cycleCount.close`,
  `financial.intercompany.classify`, `report.export`, `report.definition.share` and `budget.*` are
  absent from the 147.

**Not proven. Everything else, and specifically:**

1. **No Cloud Function was invoked.** Not `issueInvoice`, not `applyPayment`, not `createOpportunity`,
   not `allocateSalesOrder`, not `transitionWorkOrder`, not `recordPutAway`, not `createBin`, not one.
   Every `authority_path` naming a command is a code trace.
2. **No Firestore Rules were evaluated.** Every `RULES_DENY` in this registry is a reading of the
   ruleset text. In particular `WF-CRM-001`'s "five of seven capability holders are refused" is an
   executed capability result set beside a *read* of `firestore.rules:22-24` — not an emulator result.
   The emulator cannot run here: no JRE, and port 8080 is held by an unrelated uvicorn.
3. **No Postgres connection was made and the applied-migration count was not measured.** This lane
   verified that `functions/migrations/` holds exactly 18 files and which schema each creates. The
   programme's *"nonprod is at 7 of 18"* figure is **inherited and unverified by every lane that has
   touched it, including this one**. P3-B3 flags it as programme-supplied; P2-D does not mention
   nonprod at all. If nonprod has advanced past 7, the `SCHEMA_ABSENT_NONPROD` half of `WF-FIN-012`
   changes.
4. **No HTTP request reached the Render service.** This lane re-read `functions/src/eosApi/server.ts`,
   `functions/src/eosOps/eosOpsHttp.ts:176` and `functions/src/adminPolicy/adminPolicyHttp.ts:130` at
   the integrated head and confirms the route shapes the brief describes. **Whether the service is
   deployed is inherited from the brief and is unproven here.** Source says what it would serve if
   running; nothing in this lane says it is running.
5. **No test suite was run.** `node_modules` is absent in this worktree. The executed probe
   deliberately avoids that dependency by loading the pure resolver under Node 22 type-stripping.
   The claim that `navCapabilityConvergence.test.mjs` is a tautology is a reading of its 151 lines
   against the definition of `REPORT_CAPABILITY_REQUEST`, not a mutation test.
6. **The five `CLIENT_GATE_NEVER_REQUESTED` sites were traced, not executed.** They were found by
   resolving the four lists composing `REPORT_CAPABILITY_REQUEST` at the integrated head and diffing
   against every capability gate in `field-ops-app-vite/src`. The conclusion is a reading.
7. **Activity-id ranges are nominal.** Where a record cites `P3B1-S05-A01..A10`, the story's
   activities were mapped to the workflow as a block. Individual activity-to-step mapping was done
   only where a record names a single activity id.
8. **Line numbers inherited from the source lanes were spot-verified, not exhaustively re-read.** This
   lane personally re-read at `0ba8ab0d`: `woNumbering.ts:50`; `compatibilityRoles.ts:228-245`;
   `resolveEffectivePermission.ts:265` (both copies); `transitionEngine.ts:128-143`;
   `firestore.rules:22-24, 329-334, 507-509, 1319-1338, 1329-1331, 1506, 1512-1521, 1739-1742,
   1773-1776`; `permissionCatalog.ts:283-320`; `invoiceCallables.ts:110-114`;
   `allocateSalesOrder.ts:117-121`; `commercialCompanyScope.ts:24-30`;
   `legacyAuthorizationSurface.ts:16-21, 52-74`; `finance/paymentCommands.ts:127-132`;
   `schedulingCommands.ts` (the blocked-time region); `availabilityModel.ts:231, 386`;
   `dispatchBoardGeometry.js:232, 271`; `reportCapabilityAccess.js:30-37, 139-148`;
   `eosApi/server.ts`; `eosOpsHttp.ts:176`; `adminPolicyHttp.ts:130`;
   `fulfillment/coordinatedVisit.ts`; `fulfillment/billingEligibility.ts`;
   `salesOrder/createServiceForSalesOrder.ts:85-114`; `adminCredentialCommands.ts` (size and export);
   `navConfig.js` (the full route list); `functions/migrations/` (all 18 filenames).
   **Citations outside that set are as reported by the source lanes.**
9. **The state of every workflow is a judgement.** `WORKS_WITH_GAPS` versus `BROKEN_MIDWAY` turns on
   whether a reasonable operator would call the outcome settled. Where the call was close, the
   `break_point` field states the fact and lets a reader disagree with the label.
10. **No workflow in this registry has been run end to end by anybody.** The zero in the
    `WORKS_END_TO_END` row is not a measurement that they fail; it is the absence of a measurement
    that they succeed, combined with a named gap in every path.

### Added by lane P3-WF at `64008d5ae0bdd9532909671b15a91122400accf1`

11. **Whether `runReportDefinitionCallable` is deployed to the production project is UNPROVEN, and it
    is now load-bearing.** `functions/src/index.ts:183` exports it; its header claims it is *"NOT
    deployed to the production project"*. That claim is not verifiable from the repository and this lane
    made no production contact. It matters more than it did, because the header's **second** guarantee —
    that no Role grant exists for any `report.*` capability — is **false at this baseline** (§6.5). The
    discriminating test is a deployed-functions list for `taylor-parts`. **Nobody has run it.**
12. **Governed-role OCCUPANCY is unknown, and three records now depend on it.** 45 governed business
    Roles are live authority and `roleAssignments` is read per request as the sole source of an ALLOW —
    **capacity is proven**. Whether **any principal actually holds** `reportViewer`,
    `reportFinanceViewer` or any other governed Role **has been established by no lane.** `WF-RPT-001`,
    `WF-SVC-015` and `WF-RPT-002` state a capability-layer result; none of them asserts that a person
    can do the thing.
13. **Nothing was reclassified `EXECUTED` on the strength of a run this lane did not make.** The only
    execution here is the pure-resolver matrix. `EXECUTED` moved in one direction only: **down**, twice.
14. **The `readGovernedList` "compat-only" finding is false of mainline** — it was branch-local to an
    unmerged branch. Checked: the string appears **nowhere** in any of the 86 records, so no
    classification in this registry ever rested on it. No correction was required.
15. **Retired approximations are not reused anywhere in this document.** Verified absent as live claims:
    *"8 command families"*, *"~10 Part referencers"*, *"412 Warehouse references"*. The *"7 of 18
    migrations"* figure is **withdrawn outright** and survives only as item 3 above, which already
    labels it inherited and unverified.
16. **P3-B3 cannot support any Ventana attribution claim.** That corpus has **no operating-company
    field** across its 350 records, so operating-company attribution is **structurally unmeasurable**
    there. `WF-XD-003` and `WF-INV-009` are company-boundary records and neither rests on P3-B3 for
    attribution; this is recorded so no later lane tries.
17. **Day-in-Life figures, as corrected by the programme.** **1,010 records / 1,009 distinct
    activities** (`P3B3-FIN-056` ≡ `P3B3-MGMT-018` is a semantic duplicate); **42 executed — 22 PASS,
    20 FAIL**; **968 not executed, of which only 660 carry the literal `NOT_RUN` token.** The
    remaining 308 are unexecuted **without** that token — *the 968 must never be described as
    `NOT_RUN`.*
18. **Archaeology: `BRANCH_ONLY` and `HISTORY_ONLY` are not lost.** 30 deduplicated rows / 34 named
    files — **25 `SOURCE_UNAVAILABLE`, 3 `BRANCH_ONLY`, 2 `HISTORY_ONLY`.** The latter five are
    recoverable and no record here treats them as missing.
19. **Four `CODE_WRITE` lanes were live while this revalidation was written.** ENG-A/B/C/D may land
    fixes after this document is committed. §9a states what would change, **without pre-crediting any
    of it.**

---

## 9a. Forward-looking — what the concurrent engineering lanes would change

Recorded as a **conditional**, at `64008d5ae0bdd9532909671b15a91122400accf1`, from each lane's branch tip.
**No fix below is credited in any histogram, state or tier in this document.** If a lane lands, the
named record must be re-verified — the classification does not update itself.

| Lane | Branch tip vs baseline | Record affected | What would change |
|---|---|---|---|
| **ENG-A** | `acdd87b9` — resolve `audit.event.read` against **both** Role catalogs in the Change History read | **`WF-ADM-006`** *See who did what* | Currently `BROKEN_MIDWAY` · `NO_CODE` · `TRACED` — "an administrator cannot read the audit authority". If the fix lands, the Change History read resolves for holders in either catalog. The `NO_CODE` mechanism would no longer describe step 2, and the state could move to `WORKS_WITH_GAPS`. **The deny-all collections and the absent customer-edit history are separate and would survive**, so this is not a clean fix of the record. |
| **ENG-B** | **nothing landed** — branch tip is identical to the baseline | none | No conditional to record. |
| **ENG-C** | `276e0417` — deny/deny is a parity *observation*, not `CAPABILITY_PARITY_READY` | **`WF-INV-005`** *the availability number* | Currently `WORKS_WITH_GAPS` · `NO_CODE` · `TRACED`. The fix narrows a **harness classification**, not the three compounding arithmetic defects (static-catalogue baseline, four of nine movement types, location-blindness). **State and tier would not change**; a parity claim cited near the record would. |
| **ENG-D** | `129c485d` — operator scripts refuse with no explicit environment | **`WF-ADM-003`** *Administer an employee record* | Currently `BROKEN_MIDWAY` · `NO_CODE` · `TRACED`, because step 1 "is a Node script — there is no callable, no screen and no capability row". The fence makes that script **safer**, not **absent**: it does not add a callable, a screen or a capability row. **The classification would not change**, and the record should not be read as improving if the fence lands. |

The honest summary: **of the four live engineering lanes, at most one (ENG-A) could move a state, and
none of them could produce a `WORKS_END_TO_END`.**

---

## 10. Owner questions — consolidated, de-duplicated, and raised rather than answered

**106 open decisions**, in four tiers. Full text, provenance and cross-references are in the JSON
companion under `owner_questions`.

| Tier | Count | What it is |
|---|---:|---|
| `CONSOLIDATED_58_PLUS_20` | **71** | P3-B3's 58 and P2-D's 20, de-duplicated against each other. 78 raw → 71 distinct. |
| `P3B3_ACTIVITY_LEVEL` | 6 | Raised in P3-B3's activity-level `owner_question` fields (71 raisings) and folded away by its own §6 consolidation to 58. Restored here because each is a distinct workflow break point. |
| `ARCHAEOLOGY_LANE` | 4 | Raised by P3-A2 or P3-A3 and present in neither consolidated set. |
| `P3D_NEW` | 25 | Raised first by this lane, mostly from cross-domain seams no single-domain document could see. |

### The seven merges that collapsed 78 into 71

| Consolidated id | Absorbs | Why they are one decision |
|---|---|---|
| `OQ-COMP-01` | P3-B3 #24 + P2-D Q1 | Both ask whether a Ventana order may draw Taylor stock. P2-D adds the more dangerous half: *or a warehouse whose company nobody has recorded*. |
| `OQ-FIN-01` | P3-B3 #28 + P2-D Q16 | Voiding an invoice. P2-D supplies numbering and whether a void still counts as owed; P3-B3 supplies the two concrete options. |
| `OQ-FIN-05` | P3-B3 #34 + #35 + P2-D Q13 | Deposits, overpayments and a parent paying its franchisees' invoices are one unapplied-cash ruling. |
| `OQ-RPT-04` | P3-B3 #56 + P2-D Q12 | Whether `reportAuthor` may delete is determined by whether a saved report is user data or business configuration. Ruled apart, the narrow one gets re-asked. |
| `OQ-XD-02` | P3-B3 #51 + #52 | Catalog rename safety and catalog-read activation are the same `inventory.catalog.*` ruling. |
| `OQ-ACT-02` | P3-B3 #2 + P2-D Q9 | The 17-dead-everywhere question subsumes P2-D's credential-reset question — **and P2-D's premise is stale** (§7 D6), so only P3-B3's framing survives. |
| `OQ-RPT-01` | P2-D Q11 + P3-A3 §6.2a | P2-D asks whether a report defaults to the runner's company. P3-A3 found the mechanism that question presumes — a runner's authorized row set — does not exist in code. Both halves must be ruled before `report.*` is activated. |

### The five decisions that gate the most workflows

| Owner question | Workflows waiting |
|---|---:|
| `OQ-ACT-01` — the activation sequence for the Opportunity-to-cash spine in production | 9 |
| `OQ-ACT-02` — the 17 capabilities that can run in no environment at all | 6 |
| `OQ-GATE-01` — the five gated-but-never-requested ids, and the tautological guard | 5 |
| `OQ-COMP-01`/`OQ-COMP-02`/`OQ-COMP-03` — the operating-company cluster | 6 |
| `OQ-FIN-02` — how a break-fix visit with no Sales Order is billed | 3 |


## Appendix A — the 106 open Owner questions

Raised, not answered. `gates` is the number of registry workflows whose break point waits on this decision.


### Tier 1 — the de-duplicated 58 + 20 (71 distinct decisions)

| id | gates | question | raised by |
|---|---:|---|---|
| `OQ-ACT-01` | 10 | What is the sequence and gating condition for activating the Opportunity-to-cash spine in production, and is platform-sandbox's 92-id array the intended production target or a superset needing trimming? | P3B3 #1 (ADV-040) |
| `OQ-ACT-02` | 7 | Seventeen capabilities can run in no environment at all — labour recording, four finance reach scopes, both coverage ids, three report fields, administrator password reset, the equipment-compatibility family, equipment.model.manage. For each: awaiting security review, awaiting design, or abandoned? | P3B3 #2 (MGMT-050, ADMIN-035, ADV-024); P2-D Q9 (item 7g) |
| `OQ-ACT-03` | 1 | Activating any capability immediately grants it to every administrator and owner (compatibilityRoles.ts:235-240). Should activation and administrator grant be decoupled, via the explicit exclusion list the code anticipates at :232-234? | P3B3 #3 (ADV-014, ADMIN-051) |
| `OQ-ACT-04` | 1 | Five comments in functions/src/index.ts and one in firestore.rules assert capabilities are 'granted to nobody'. Correct the comments, or make them true by exclusion? | P3B3 #4 (ADMIN-050) |
| `OQ-ACT-05` | 1 | EOS decides authorization three ways — the legacy Rules role string (44 sites, 22 collections), the governed capability engine (147/48), and the Postgres object/field policy store. legacyAuthorizationSurface.ts:16-21 records an Owner constraint against a third. Which two survive, and which is the authority of record? | P3B3 #5 (ADV-039, ADV-029, ADMIN-060) |
| `OQ-ADM-03` | 1 | Should a second factor be required when an administrator approves an elevation to a privileged role? The MFA seam is recorded and unimplemented at accessCommandCallables.ts:272-277. | P3B3 #8 (ADMIN-030) |
| `OQ-ADM-04` | 1 | Any authenticated tenant member can read the entire policy configuration — every object, every role's permission matrix, every workflow, the policy audit history. Intended? | P3B3 #7 (ADMIN-057) |
| `OQ-ADM-06` | 1 | On the Postgres path, role assignment accepts owner/generalManager/admin and the design note says this supersedes the two-person route; on the Firebase path a privileged grant still needs a distinct second approver. Are the two meant to differ? | P3B3 #9 (ADMIN-058) |
| `OQ-ADM-07` | 1 | Has the resolver's own recorded interpretation of 'consistent with the current accessVersion' (accessVersionAtGrant <= currentAccessVersion) been ratified? | P3B3 #10 (MGMT-043) |
| `OQ-COMP-01` | 3 | May a Ventana Sales Order be fulfilled from a Taylor warehouse — or from a warehouse whose company nobody has recorded? Nothing compares them, allocation builds its eligible pool from status==ACTIVE warehouses with no company predicate, and the resulting obligation has nowhere to be recorded. | P3B3 #24 (ADV-001); P2-D Q1 (item 1) |
| `OQ-COMP-02` | 4 | Does a Work Order carry its own operating company? If yes: required at creation (refusing the 19 of 30 with no source) or inherited from its Sales Order where one exists (covering 11 of 30)? If no: how is a reservation attributed to Taylor vs Ventana? Creation is the only capture point that avoids a later backfill, and the create wizard does not ask. | P2-D Q2 (item 2); P3-A1 §2.7 |
| `OQ-COMP-03` | 4 | Four record families — inventory transaction, inventory action, transfer, cycle count — were declared to inherit their operating company from a stock location. The 2026-09-12 ruling retired that hop. What do they inherit from now? And does the retirement also withdraw the one-time Ownership-v1 stamping plan over the 5 surviving rows? | P2-D Q14 (items 15b, 15c) |
| `OQ-COMP-04` | — | What is the 'census gate' that commercialCompanyScope.ts:27 names as the precondition for enforcing the operating company, and what closes it? | P3B3 #25 (ADV-027) |
| `OQ-COMP-05` | — | When a deal was booked to the wrong operating company and invoices have issued, what is the correcting act? The company is deliberately immutable downstream, invoices cannot be voided, and no intercompany reclassification record may exist. | P3B3 #26 (ADV-007, SALES-050) |
| `OQ-COMP-06` | — | Ruling R-4 requires a mixed-company purchase order to be refused or split. Which, and where is it enforced? | P3B3 #27 (MGMT-023) |
| `OQ-CRM-01` | 1 | Which is the intended authority for customer master data — the capability model (which grants five more roles than Rules admit) or the legacy Rules gate? Should the trusted server-side writer named at firestore.rules:1329-1331 be built first? | P3B3 #6 (ADV-002, CRM-028) |
| `OQ-CRM-02` | 2 | Should account edits — including payment terms and tax status — go through a trusted writer with an audit trail before more commercial fields land on the Account? Today they are raw client writes producing nothing, while employee edits next door are a governed callable with a change-history read. | P3B3 #50 (ADV-034) |
| `OQ-CRM-03` | 2 | Should bulk contact import go through the governed Data Import pipeline so it inherits the environment guard, the entity contract and the audit trail? Today it is a client writeBatch with none of the four. | P3B3 #45 (CRM-020, ADV-012) |
| `OQ-CRM-04` | 1 | Accounts without an owner block Opportunity creation by design, yet report.customer.field.accountOwner.read is inactive everywhere, so no report can list them. Activate it? | P3B3 #46 (CRM-030, MGMT-038) |
| `OQ-CRM-05` | 2 | When a customer site changes hands between franchisees, the Location can be reparented and the Equipment on it cannot (firestore.rules:1512-1521, with no command either). What is the intended act for the installed base? | P3B3 #47 (CRM-033, CRM-043, ADV-010) |
| `OQ-CRM-07` | 1 | When an Account, Contact or Customer Location is created in error, what is the correcting act? Delete is refused everywhere and no merge or void command exists; mergedIntoAccountId (D-C1-7) appears in no code anywhere. | P3B3 #43 (CRM-005, CRM-027, CRM-040) |
| `OQ-CRM-08` | 1 | Should an Account carry a governed lifecycle? Postgres declares the four-state enum; Firestore, the authority, declares none, refuses delete, and lets an archived account be edited straight back to Prospect (ND-11). | P3B3 #44 (CRM-011, ADV-018) |
| `OQ-CRM-09` | 1 | Should the non-empty-schema guard in the CRM down-migration (1758758400000:302-319) be applied to eos_commercial (whose down section is an unconditional DROP SCHEMA ... CASCADE at 1758844800000:339), eos_finance and eos_ops? | P3B3 #48 (CRM-038) |
| `OQ-CRM-10` | 1 | Should EOS model a customer hierarchy? Assessed and unimplemented; parentAccountId (D-C1-3) is not stored. | P3B3 #49 (CRM-054) |
| `OQ-EQP-01` | 1 | Is the equipment-install seam — a governed capability for the install, a legacy Rules gate for the record it is about — intended to stay split? And should there be a recovery command: install has no uninstall, return or replacement on either the Firestore or the Postgres path (ADR-010 §4 unbuilt), so a unit installed at the wrong customer stays there. | P3B3 #58 (ADV-028); P3-A1 §2.15, §7 item 2 |
| `OQ-FIN-01` | 1 | An invoice issued against the wrong customer cannot be voided. Who may void one, on what evidence, with what effect on issued numbering, and does a voided invoice still count as owed? Full-value credit memo, or build a governed voidInvoice? | P3B3 #28 (FIN-004, ADV-019); P2-D Q16 (item 17) |
| `OQ-FIN-02` | 4 | How is a break-fix service visit with no Sales Order billed? The billing queue is SO-anchored (FIN-BLOCK-002), and labour cannot be recorded in any environment, so the path is broken at both ends. | P3B3 #29 (FIN-007) |
| `OQ-FIN-03` | 1 | Should the Billing Queue's governed command path be wired, and under which approval policy? functions/src/finance/billingQueue.ts has zero importers. | P3B3 #30 (FIN-008) |
| `OQ-FIN-04` | 1 | Should EOS hold unapplied cash on account, and who may apply it later? An overpayment cannot currently be recorded at all (paymentCommands.ts:129-130). | P3B3 #33 (FIN-016) |
| `OQ-FIN-05` | 1 | How should a pre-invoice deposit on an equipment order be recorded? And how should a parent company's payment covering several franchisees' invoices be recorded — may cash from one customer settle a related customer's invoice, never, only within parentAccountId, or freely? | P3B3 #34 (FIN-017); P3B3 #35 (ADV-004); P2-D Q13 (item 11) |
| `OQ-FIN-07` | 1 | What are the approval thresholds for credits, write-offs and refunds, and who is the second approver above each? The machinery is built with no policy values, which is why two financial surfaces ship with writes disabled. | P3B3 #41 (FIN-069) |
| `OQ-FIN-08` | 1 | Should AR aging buckets ship, and at which boundaries? They are implemented under a recorded deployment policy of not shipping them, and pages 01 and 04 disagree on the last bucket label ('60+' vs '61+'). | P3B3 #38 (FIN-024); P3-A3 §5.4 F2 |
| `OQ-FIN-11` | 1 | Should invoice issuance derive the due date from the customer's payment-terms enum? There is no terms engine; the date is typed, and AR ages against it. | P3B3 #31 (FIN-011, ADV-025) |
| `OQ-FIN-12` | 1 | Should EOS produce customer statements and dunning notices, or does that stay in the accounting system of record? | P3B3 #32 (FIN-013) |
| `OQ-FIN-13` | 1 | In platform-sandbox, finance.visibility.consolidated is activated and .self, .team, .businessUnit and .company are not — so Sales sees nothing and Accounting sees everything. Deliberate, or an omission in the override array? | P3B3 #36 (FIN-021, ADV-013) |
| `OQ-FIN-14` | 1 | Is a scoped financial view below consolidated still wanted (FIN-BLOCK-001), and which role should hold it? Both .businessUnit and .company are held by no governed business role. | P3B3 #37 (FIN-023) |
| `OQ-FIN-15` | 1 | All twenty Financials nav items are visible with no capability gate, so the role guaranteed to see nothing sees the whole menu. Intended? | P3B3 #40 (FIN-065) |
| `OQ-FIN-18` | 1 | Is accounts payable intended to stay in the accounting system of record, or does EOS eventually own it? None exists today — no supplier bill, no payable, no payment run. | P3B3 #39 (FIN-027) |
| `OQ-FIN-19` | 1 | Which system is the authority of record for financial figures — EOS or the external accounting system? External reconciliation is blocked on this (#145), and financialReconciliation.ts is a detector that is never run. | P3B3 #42 (FIN-070) |
| `OQ-LEDGER-Q10` | — | May an admin or dispatcher still create an inventory_actions document straight from a console, with no field validation and a createdBy naming anyone? The product's own writer was retired by ruling; this Rules grant is what survived it, and it is now the only remaining way to create such a document. | P2-D Q10 (item 8); P3-A2 Part 12 item 15 |
| `OQ-LEDGER-Q15` | 2 | Two purchase-order collections exist and only one is governed. Is the canonical procurementService layer retired or converted? Its price is a currency-less float that must not become a cost authority, and a canonical PO has no business number at all. | P2-D Q15 (item 16); P3-A2 R12 |
| `OQ-LEDGER-Q17` | 1 | How do 'available minutes over a window' become a 0-100 recommendation score for an unplaced queue card that has no window? Today 20% of the score reads a stored status field that a technician on recorded PTO still reads 'available'. | P2-D Q17 (item 20) |
| `OQ-LEDGER-Q18` | — | Do supplier commercial terms vary by operating company? If yes, one additive column on supplier_catalog_items; both tables are still empty. | P2-D Q18 (item 22) |
| `OQ-LEDGER-Q19` | — | After an intake PR is merged and its branch deleted, should a retry of the same submit_work request return the merged pointer, or is content-addressing the artifact the answer? (ChatGPT-EOS intake integration; outside the registry's business-workflow scope, carried for completeness.) | P2-D Q19 (item 23) |
| `OQ-LEDGER-Q20` | 1 | Is Job Assignments a distinct assignment board, or an assignment VIEW of Work Orders? A Work Order and a Job can describe the same physical visit, and nothing says which is the record when they disagree. | P2-D Q20 (item 24); P3-A1 §2.4 |
| `OQ-LEDGER-Q3` | 1 | Should a workOrder.read capability exist, and does it mean 'read any Work Order' or 'read the ones assigned to me'? Today a users/{uid}.role string decides, in two hand-copies, and no read capability is in the catalog. | P2-D Q3 (item 3) |
| `OQ-LEDGER-Q4` | 2 | When parts are consumed on a work order, how does the stock leave on-hand? (a) consumption writes a physical removal movement, (b) the on-hand derivation counts location-less CONSUMED rows, or (c) commitment permanently retains consumed quantity. Today two code paths compensate differently and one over-reports availability. | P2-D Q4 (item 4) |
| `OQ-LEDGER-Q5` | 1 | When a serialized unit is installed on customer equipment, does the installation emit an inventory ledger movement — and from where? ADR-010 §3 says one thing; migration 007 ruled the customer's Equipment out of the location type enum, so no such row is emittable. Today nothing is emitted. Custody itself is already defined. | P2-D Q5 (item 6) |
| `OQ-LEDGER-Q6` | 1 | Is workOrder.cancel the Work Order's delete verb or its edit verb? The seeded policy store and the generated governance contract disagree. | P2-D Q6 (item 7a) |
| `OQ-LEDGER-Q7` | 2 | Is Employee access expressed as real employee.* capabilities, or recorded honestly as Rules-governed for now? Employees has no row in any of the four capability tables, and employee CREATE is a Node script with no callable, no screen and no capability. | P2-D Q7 (item 7b); P3-A3 §7.5 |
| `OQ-LEDGER-Q8` | 2 | Should Contacts, Customer Locations and Equipment get real capabilities (six ids proposed, plus whether Equipment deserves a create separate from equipment.install) — or stay governed by Firestore role branches? Today their permissions are not expressible as capabilities at all (rulesOnly), a third condition distinct from both ungranted and inactive, and Administration renders them anyway. | P2-D Q8 (item 7c); P3-A1 §1.2 |
| `OQ-RPT-01` | 2 | When a report runs against a wave-3 object that carries an operating company, does it default to the runner's company or require an explicit company filter? And should the row-scope defect be closed first — reportExecutionService.ts:420 hardcodes the authorization target to global, so a holder of the object capability would see every row and a grant at ownAssignment or location scope would not resolve at all. | P2-D Q11 (item 9); P3-A3 §6.2a |
| `OQ-RPT-03` | 1 | Which of the eight unpopulated report objects should be populated next, and in what order? | P3B3 #55 (MGMT-002) |
| `OQ-RPT-04` | 1 | Can the reportAuthor role delete its own saved definitions? Today it can create, rename and duplicate and cannot delete — report.definition.delete is held by owner and admin only. And is a saved report the user's private data (deleted with them) or business configuration (shareable, surviving its author, listed in Administration)? There is no admin override on the ownership check, so a saved report survives its author's departure and nobody can clean it up. | P3B3 #56 (MGMT-004, ADV-008); P2-D Q12 (item 10) |
| `OQ-RPT-05` | — | Should issueInvoice be gated on the Sales Order's state, given that it currently cannot see a cancellation? | P3B3 #57 (ADV-019) |
| `OQ-SLS-01` | 1 | Should a customer's refusal be recorded as DECLINED on the Agreement, or only as LOST on the Opportunity? DECLINED is modelled with no producer (ND-14). And, separately: SA-G7 — should line pricing move onto the Sales Agreement record page, given that an acceptance blocked by an unpriced line cannot be cleared from the page that reports it? | P3B3 #15 (SALES-014); P3-A3 §3.3 SA-G7 |
| `OQ-SLS-02` | 1 | When a customer changes their mind after accepting an Agreement — a superseding Agreement, or a governed amendment on the original? Neither is implemented (ND-15 / SA-G6). | P3B3 #14 (SALES-013) |
| `OQ-SLS-03` | 1 | Should Sales Agreement acceptance carry a value or discount threshold above which a more senior role must accept? governedBusinessRoles.ts:388-394 records the absence as a deliberate governance gap. | P3B3 #13 (ADV-033, SALES-012) |
| `OQ-SLS-04` | 1 | Should a Sales Order record the time it entered each lifecycle stage? Without it, order cycle time cannot be measured at all (ND-8). | P3B3 #16 (SALES-036) |
| `OQ-SLS-05` | 2 | Which named job allocates stock against a booked Sales Order, and which raises its service visit? Neither salesOrder.fulfill nor salesOrder.service is held by any governed business role. | P3B3 #11 (ADV-015, SALES-063) |
| `OQ-SLS-06` | 1 | Is fulfilment authority intended to sit with dispatch? The dispatcher is deliberately excluded from billing and holds both fulfilment capabilities. | P3B3 #12 (ADV-022) |
| `OQ-SLS-08` | 1 | Is a reusable sales template still wanted? 2,228 lines of wireframe, no implementation. And does the 2026-07 unrelaxable constraint still bind — that a line storing ONE price cannot later carry both a transfer price and a customer price, so intercompany pricing must be designed before quotes, orders and invoices are built on it? | P3B3 #21 (SALES-048); P3-A3 §8.1 item 4 (G21/G22) |
| `OQ-SLS-09` | 1 | Is there a customer-specific or volume-based price list EOS should hold, or is every price typed per agreement? | P3B3 #17 (SALES-041) |
| `OQ-SLS-10` | 1 | Should a salesperson see what an account last paid for a part before requoting it? No price-history read exists. | P3B3 #18 (SALES-042) |
| `OQ-SLS-11` | 1 | How should sales credit be split when more than one person contributed? Coverage explicitly records no precedence, credit or commission, and nothing else does either. | P3B3 #19 (SALES-046) |
| `OQ-SLS-12` | 1 | Should line of business be a governed dimension on the commercial transaction, or remain an Account attribute? | P3B3 #20 (SALES-047) |
| `OQ-SLS-13` | — | May a Sales Order ship to a Customer Location belonging to a different Account? Equipment enforces account-location parentage in Rules; the Sales Order path does not appear to. | P3B3 #22 (SALES-066) |
| `OQ-SLS-14` | — | Is the allocation-side duplicate-reference case (P1.7) still open, and should p1-fulfillment-billing-spine-spec.md:29 be updated to match the shipped lineId-primary matching? | P3B3 #23 (ADV-031) |
| `OQ-XD-02` | 2 | Should inventory.catalog.manage refuse a rename on a part with open commitments, or should the fulfilment write-back key on the immutable part id rather than the mutable SKU? And is the catalog READ deliberately held back while .manage and .activate are live in production? | P3B3 #51 (ADV-003); P3B3 #52 (ADV-023) |
| `OQ-XD-03` | 1 | Should a technician or dispatcher be able to raise an Opportunity from a Work Order? The Sales Order to Service direction exists; this one does not. | P3B3 #54 (ADV-036) |
| `OQ-XD-04` | 1 | Should setUserStatus refuse, warn, or queue an exception when the subject is the assigned technician on open work orders? Every technician transition carries requiresOwnAssignment: true, so disabling the principal strands the work. | P3B3 #53 (ADV-005) |


### Tier 2 — raised at P3-B3 activity level, folded away by its own §6 consolidation (6)

| id | gates | question | raised by |
|---|---:|---|---|
| `OQ-CRM-06` | 1 | Should a technician be able to read the customer and the equipment at the site they are standing on? firestore.rules:1506 gates equipment reads on isAdminOrDispatcher() and the technician exclusion is deliberate and documented at :1367-1381. | P3B3 CRM block (CRM-044, ADV-017, CRM-008) |
| `OQ-FIN-06` | 2 | How should intercompany be treated? FIN-BLOCK-004 forbids any intercompany record type until the Owner rules it, so a cross-company transfer or service has nowhere to land and consolidated figures are honestly typed UNELIMINATED_SUM. | P3B3 Financial block (FIN-045, FIN-054, FIN-055, MGMT-017) |
| `OQ-FIN-09` | 2 | What is the accounting close cadence, and should a closed period be reopenable? FIN-008 models close and NOT reopen, and has no storage. | P3B3 Financial block (FIN-052); P3-A3 §5.4 row 20 FIN-PQ-20a |
| `OQ-FIN-10` | 2 | What is the cost authority (FIN-BLOCK-003)? Margin is structurally unknown and the binding rule is that it renders as unknown, never 0%. inventoryCostEngine.ts is 425 lines with zero importers. | P3B3 Financial block (FIN-039, FIN-062) |
| `OQ-FIN-16` | 1 | FIN-BLOCK-005 blocks shipping a financial screen without an approved design source; the 2026-09-01 update records the design direction as APPROVED with repo ingest still pending. What closes it? | P3B3 Financial block (FIN-049) |
| `OQ-XD-01` | 1 | Is the Render EOS API's exposed surface — /health, POST /admin/policy, POST /operations/inventory with a closed operation list of one non-mutating read — the intended nonprod posture? Sixteen authority modules sit behind a transport with no route to any of them. | P3B3 §3.4 / §5 seam 3; this lane re-read server.ts, eosOpsHttp.ts:176 and adminPolicyHttp.ts:130 at 0ba8ab0d |


### Tier 3 — raised by an archaeology lane, in neither consolidated set (4)

| id | gates | question | raised by |
|---|---:|---|---|
| `OQ-CRM-11` | 1 | Does Postgres eos_crm supersede or duplicate the Firestore CRM path? D-C1-4 (duplicate key) and D-C1-5 (lifecycle) are implemented in the Postgres lane and enforced nowhere on the Firestore path that users actually reach. | P3-A3 §4.4 — 'the single most consequential unanswered question in CRM' |
| `OQ-FIN-17` | 1 | No budget.* capability exists anywhere in the 147-id catalog, and Cost to Budget and Budget Management draw five actions over it. Create the capability family, or retire the two surfaces? | P3-A3 §5.4 rows 09 and 12; verified EXECUTED by this lane: absent from the catalog at 0ba8ab0d |
| `OQ-RPT-02` | 1 | Should the report path compose FIN-004 visibility? F13 Invariant E says 'the export of a number is the number', and reportExecutionService.ts imports financialVisibility nowhere. | P3-A3 §6.2b |
| `OQ-SLS-07` | 1 | Does the Coverage authority (sales_territories + commercial_coverage_assignments, built, registered and reachable by nobody) supersede or duplicate D-C1-6, which asked for a nullable descriptive territoryId FIELD on the Account and explicitly proposed no Territory entity? | P3-A3 §3.5, §4.4 |


### Tier 4 — raised first by lane P3-D (25)

| id | gates | question | raised by |
|---|---:|---|---|
| `OQ-ADM-01` | 1 | Which of the twenty-one object/verb disagreements across the four capability tables are intended? Eighteen carry no recorded rationale anywhere, and Reorder Requests and Employees have no row at all. | P3-A3 §7.3; P2-D item 7 |
| `OQ-ADM-02` | 2 | The Administration policy seed drops the rulesOnly marker, so inside the tenant policy store a Rules-governed object is indistinguishable from an unmodelled one — Contacts looks like Marketing Initiatives. Should the marker be carried? | P3-A3 §7.4 |
| `OQ-ADM-05` | 1 | users/{uid}.technicianId is spent as an Employee id in at least one place, and the technician identity key space is fieldops_technicians document ids rather than Firebase uids. Nothing tells anyone the link is incomplete until a consumption source silently returns nothing. What is the rewire, and what environment can verify it? | P2-D item 18 (BLOCKS_NONPROD); P3-B1 S09/S33 |
| `OQ-ADM-08` | 1 | Should the audit authority be readable from the product? It exists, governed commands write to it including denials, and both Audit Logs and Permission Preview render Unavailable because the collections deny-all and no read path is deployed. | P3-A3 §7.6, §8.3 item 7 |
| `OQ-GATE-01` | 4 | Five capability ids are gated on in client components and are absent from REPORT_CAPABILITY_REQUEST, so the trusted feed is never asked and the gate denies for every principal in every environment, permanently: equipment.compatibility.view, inventory.stock.relocate, inventory.location.bin.manage, financialPolicy.profile.read, financialPolicy.profile.configure. Is the fix a five-id addition to the request set (44 -> 49, inside the feed's 100-id bound), and should the convergence guard be rewritten? test/navCapabilityConvergence.test.mjs:147-151 asserts only that GOVERNED_SURFACE_CAPABILITY_IDS is a subset of a list built by spreading it — a tautology that can never fail. The only real guard, dashboardComposition.test.mjs:460-477, greps one file. | this lane's client-gate sweep at 0ba8ab0d; P3-A2 Part 16 Q1 (racking only) |
| `OQ-INV-01` | 1 | Should the receiving, part-master and truck-management readiness constants remain client-side environment flags? Each makes zero callable attempts outside platform-sandbox while the capability behind it is ACTIVE and granted — a failure mode none of the established blocking vocabulary can express. | P3-A2 Part 11; verified at 0ba8ab0d |
| `OQ-INV-02` | 1 | Since BIN-P6 / Decision #170, placement alone is no longer an authoritative put-away. What is the second half, and which capability governs it? | P3-A2 Part 9 |
| `OQ-INV-03` | 1 | Which of the three surfaces rendering computeAvailableStockByPart may keep doing so? The derivation adds a hardcoded 200-SKU static baseline on top of ledger movements, handles four of nine movement types, and counts truck stock as available — while the server fences on ACTIVE warehouses and excludes MOBILE. | P3-A2 Part 9, Part 16 Q5 |
| `OQ-INV-04` | 1 | Is the reorder trusted-command boundary authorised? Eight of ten reorder lifecycle transitions are direct client Firestore writes; the fix is fully designed and marked DESIGN ONLY, not authorized for implementation. | P3-A2 R18-R20, Part 16 Q8 |
| `OQ-INV-05` | 1 | inventory.cycleCount.close is referenced in code and is absent from the capability catalog. Register it, or remove the reference? And is a count started in the certification environment — where cancel is deliberately excluded from the activation array — meant to be uncancellable? | P3-A2 R10; verified EXECUTED at 0ba8ab0d |
| `OQ-INV-06` | 1 | Who creates a warehouse? There is no registered warehouse write capability, the writer declares itself inert and unexported, and every warehouse row in every environment came from a seed or an operator CLI — for the object that is the company boundary root of the whole ownership model. | P3-A2 R5, Part 12 item 7, Part 16 Q2 |
| `OQ-INV-07` | 1 | Who decides the disposition half of a return? Intake writes a state with no exit and has no scan tile; RETURNED is a schema-legal movement type with no writer, deliberately, because writing one at intake would be the automatic restock Decision #118 forbids. | P3-A2 R21g, Part 12 items 3 and 4, Part 16 Q7 |
| `OQ-INV-08` | 1 | Is the serial case-folding asymmetry deliberate? Serials are case-significant in matching and case-insensitive in three separate duplicate checks, and no document addresses it. | P3-A2 Part 15 item 10 |
| `OQ-INV-09` | 1 | Should anything produce a pick list, and should picking reserve? Template T3 was drawn from a real Taylor pick ticket in 2026-07 and never built; PickScan stages against a Work Order's existing snapshot and reserves nothing, so two jobs can be picked the same unit. | P3-A2 Part 12 item 1, Part 16 Q12 |
| `OQ-SCN-01` | 1 | Should a technician be able to undo or correct a recorded part consumption? There is no undo, no running total, and a duplicate scan records silently. The F2 blind review passed FUNCTIONAL and failed EXPERIENCE in all three rounds. | P3-A2 R22 |
| `OQ-SVC-01` | 1 | The dispatcher board answers 'is this person available' from two sources in one viewport — the recommendation engine scores fieldops_technicians.status while the hatched chip reads technician_blocked_time. Which is the board's answer, and should the recommendation engine read the governed availability authority? | P3-A1 §2.2; P3-B1 S06 |
| `OQ-SVC-02` | 1 | Should a technician be able to record their own absence? createTechnicianBlockedTime requires a dispatcher, and the handheld is the only surface where the technician is. | P3-A1 §7 item 5 |
| `OQ-SVC-03` | 1 | What does a technician press when they genuinely cannot complete a job? The state machine models forward edges plus CANCELLED and has no governed non-completion outcome; 'honest exits are first-class' was designed and never built. | P3-A1 §5 item 3, §7 item 4; P3-B1 S11/S17 |
| `OQ-SVC-04` | 1 | When an offline technician's queue drains onto a Work Order a dispatcher rescheduled meanwhile, which wins, and what does the technician see? | P3-A1 §2.11; P3-B1 S15 |
| `OQ-SVC-05` | 1 | How should a job be handed from one technician to another mid-execution? Reassignment moves the assignment; the execution record does not follow, so the second technician inherits work attributed to someone else. | P3-B1 S21 |
| `OQ-SVC-06` | 1 | What command moves a coordinated visit or a coordinated field mission forward? Two routes render an honest, governed read over a projection with no command surface at all. | P3-A1 §2.9; P3-B1 S25; P3-B3 MGMT-048 |
| `OQ-SVC-07` | 1 | Should EOS model a preventive-maintenance schedule, campaign or recurrence? A 62-site quarterly PM is 62 unrelated Work Orders and nothing can say afterwards whether the campaign completed. | P3-B1 S23 |
| `OQ-SVC-08` | 1 | Should risk scoring stop dropping the Work Order it knows least about? SO-G7: an unusable createdAt scores 0 on both age and stagnation, falls to LOW, and detectStalledJobs returns only HIGH and CRITICAL, so the implemented and tested 'age unknown' row is unreachable. | P3-A1 §4.2 |
| `OQ-SVC-09` | 1 | Should /service/scheduling and /service/dispatch-scheduling be routed at all? Both are navHidden, both still resolve by URL, both still write governed data, and one still asserts in its own header that reschedule is not a deployed transition. | P3-A1 §2.3 |
| `OQ-SVC-10` | 1 | Is warranty a workflow EOS should carry? One governed date exists and there is no claim, no coverage model, no provider and no billing consequence; the route is nav-declared with no component behind it. | P3-A1 §2.10 |


Where a question carries a `note` in the JSON companion, it records why two source questions were
merged, or where a source premise was found stale.

---

## 11. How to read a workflow record

```
id                   WF-<DOMAIN>-<NNN>
name                 the business path, in the words someone doing the job would use
domain               one of the 14
trigger              what starts it in the real world
actors               roles and personas, in job language, with the governed role id where one exists
steps[]              ordered; each names the surface and the authority that governs it
objects_touched[]    collections and record types the path reads or writes
authority_path       file:line, verified at integrated head 0ba8ab0d
state                WORKS_END_TO_END | WORKS_WITH_GAPS | BROKEN_MIDWAY | CANNOT_START | NO_IMPLEMENTATION
break_point          for anything not whole: the exact step where it fails, and why
blocking_mechanism   the mechanism that stops it FIRST
blocking_note        the other mechanisms, and where the wall differs by environment
supporting_activities activity ids from P3-B1 / P3-B2 / P3-B3 that exercise this path
owner_questions      consolidated OQ-* ids
evidence_status      EXECUTED | TRACED | INFERRED
evidence_note        on EXECUTED records: which half was run, which half was read
lane_sources         which upstream lane said what
```

---

*Lane P3-D. Consolidation only. No runtime code changed, no design implemented, no production
contact, no Owner question answered, nothing pushed.*
