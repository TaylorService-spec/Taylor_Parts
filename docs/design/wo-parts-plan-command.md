# WO Parts Planning — Phase 2: Dedicated Governed PLANNED Producer

Status: **Design + client pure core (repo-only).** The governed Cloud Function write is **not built yet** —
it has one material identity decision (§6) to confirm first. No Rules widening, no capability grant, no
deploy. Owner-ratified Phase 2 (option b): a dedicated planning command, separate from lifecycle transitions.

## 1. Business action

`setWorkOrderPartsPlan` — "**plan these parts for this Work Order.**" A business-intent command, **not** a
generic persistence API (`updateInventorySnapshot` is explicitly rejected). Planning is a distinct
operational decision that happens **before** dispatch and can change independently of Work Order lifecycle
transitions — so it must **not** live inside `transitionWorkOrder`.

**Invariant:** `PLAN PARTS != RESERVE PARTS != USE PARTS`. The command may write the governed `qtyPlanned`
representation and nothing else. It must not create reservations, inventory movements, usage, procurement,
required/returned quantities, or equipment-compatibility authority. Reservation stays with the existing
`DISPATCHED → reserveParts` trigger; usage stays with `updateWorkOrderExecutionData`.

## 2. Callable contract

`setWorkOrderPartsPlan({ workOrderId, plan, idempotencyKey? }) → { success, workOrderId, plannedCount }`
- `plan`: `[{ partId, name?, qtyPlanned }]` — validated by the client pure core
  (`domain/workOrderPartsPlan.js` → `buildPartsPlanInput`) and re-validated authoritatively server-side.
- Structural pattern mirrors `updateWorkOrderExecutionData.ts`: `onCall` + `getCallerContext` + a single
  `runTransaction` doing read-verify-write, touching **only** `inventorySnapshot` (+ a planning timestamp).

## 3. Authorization — a new governed capability (not a role)

Introduce **`workOrder.parts.plan`** in `functions/src/access/permissionCatalog.ts`, registered
**`active: false`** initially (fail-closed for every principal until a separate Owner grant — the same
posture as the inactive catalog/equipment capabilities). The command enforces it via
`verifyActorPermission(actorUid, "workOrder.parts.plan")` (resolving through `resolveEffectiveAccess`).

- **Not** gated on `admin`/`dispatcher`/`technician`, device type, or UI visibility. The capability answers
  *may this actor author/change planned parts*; the Persona/Permissions architecture decides who receives it.
- Do **not** grant it to make tests pass; do **not** infer owner/admin omnipotence. Tests use an injected
  permission resolver (as the equipment-compatibility command tests do), never a real grant.

## 4. Fail-closed rules

Authorization, identity, validation, and command invariants all fail closed:
- not signed in → `unauthenticated`; capability not held → `permission-denied`; WO missing → `not-found`;
  malformed plan → `invalid-argument`; removing a part with recorded usage → `failed-precondition`.
- **Readiness is NOT a prerequisite.** Planning produces information the readiness projection consumes;
  readiness is a derived result, never an authorization gate. A "short" or "unknown" readiness never blocks
  planning.

## 5. Authoritative merge algorithm (server, inside the transaction)

Given the WO's current `inventorySnapshot[]` and the validated `plan`:
1. **Upsert by identity:** for each plan line, update the matching item's `qtyPlanned`; add a new item if
   absent.
2. **Preserve execution + other fields:** keep each kept item's `qtyUsed` and any other fields untouched —
   planning never writes `qtyUsed`.
3. **Block unsafe removal:** a currently-planned part absent from the new plan is removed **only if**
   `qtyUsed` is 0/absent; removing a part with `qtyUsed > 0` fails `failed-precondition` (mirrors the client
   `planRemovalBlocked`).
4. Write `inventorySnapshot` (whole array) + a planning `lastUpdated`; nothing else. **Never** call
   `triggerInventoryEffects` or any reserve/consume path.

## 6. MATERIAL DECISION — identity on the stored `inventorySnapshot` item

The stored `InventorySnapshotItem` is keyed on **`sku`** today, and `updateWorkOrderExecutionData` matches
parts-used **by `sku`**. The readiness projection and this command key identity on **`partId`**. The command
must reconcile the two on the stored item. Options:
- **(i) Write both `partId` and `sku`, resolving `sku` from Part Master** (canonical `internalPartNumber`),
  falling back to `sku = partId` when unavailable. Most correct; adds one Part Master read in the planning
  transaction. Execution-capture keeps matching on `sku`; the projection keys on `partId`. *(Recommended.)*
- **(ii) Write `partId` and set `sku = partId`.** Simplest, no extra read, but conflates the two ids on the
  stored record.
- **(iii) Converge `updateWorkOrderExecutionData` to match on `partId`.** Cleanest long-term, but changes an
  existing live command's matching semantics — larger blast radius.

**Recommendation:** (i) now, with (iii) as a recorded follow-on so execution-capture prefers `partId`. This
is surfaced for confirmation because it writes a governed stored representation and touches how an existing
command matches parts — a material decision, not a silent pick.

## 7. Boundaries

Repo-only: registering the capability (`active:false`) and adding the callable are repo-only (export ≠
deploy; register ≠ grant). `fieldops_wos` is already Cloud-Function-only, so **no `firestore.rules` change**.
Deploying the function and granting the capability are **separate protected gates**, not part of this work.

## 8. Client pure core (built, this PR)

`domain/workOrderPartsPlan.js` (+ 5 tests): `buildPartsPlanInput` (validate/normalize plan intent, keyed on
`partId`, positive-int qty, no duplicates, empty plan = clear), `planRemovals`, and `planRemovalBlocked`
(cannot un-plan a part with recorded usage). This is the client mirror of §4–§5 invariants; the server
command re-enforces them as the authority.

## 9. Server command test plan (next build)

Capability fail-closed (no grant → denied); PLAN ≠ RESERVE (no ledger/`triggerInventoryEffects` effects);
`qtyUsed` preserved across a re-plan; removal-blocked for a used part; idempotency; identity written per §6.
