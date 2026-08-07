# WO Parts Planning — Phase 2: Dedicated Governed PLANNED Producer

Status: **Implemented (repo-only).** The governed `setWorkOrderPartsPlan` Cloud Function, its `active:false`
capability, the pure core, and tests are built. No Rules widening, no capability grant, no deploy. Owner-
ratified Phase 2 (option b): a dedicated planning command, separate from lifecycle transitions. The identity
question (§6) is resolved by applying the repository's established identity authority — see §6.

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

## 6. Identity on the stored `inventorySnapshot` item — canonical rule (applied)

`partId` and `sku`/`internalPartNumber` are **distinct governed identifiers** (ADR-008 Part Master). The
command applies the canonical authority chain and **never** equates or fabricates them:

```
partId → canonical Part Master (parts/{partId}) → internalPartNumber → inventorySnapshot.sku
```

- **`partId`** is the canonical Part identity (the plan/projection key). **`sku`** is a compatibility/display
  identifier that MUST equal the canonical Part's **`internalPartNumber`** — kept so the live
  `updateWorkOrderExecutionData` (which matches by `sku`) is unaffected.
- **Never** `sku = partId`; **never** infer `partId == sku`.

**Fail-closed resolution (applied in `applyPartsPlan`, with reads done in the callable's transaction):**
- **New row:** the canonical Part must exist **and** yield a valid `internalPartNumber`, which becomes `sku`.
  Missing Part → `PART_NOT_FOUND` (fail closed); missing/invalid `internalPartNumber` → `SKU_UNRESOLVED`.
- **Existing row:** match by canonical `partId`, **or** a legacy (partId-less) row **only** when
  `existing.sku === canonical internalPartNumber`. On an unambiguous match: preserve the row (qtyUsed +
  unrelated fields), backfill canonical `partId`, set `sku` to the canonical `internalPartNumber`, update
  `qtyPlanned`. A prior `sku` is retained only because it was proven equal to the canonical sku (that is how
  the legacy row matched) — never retained arbitrarily.
- **Ambiguity → fail closed (`failed-precondition`):** more than one candidate row for a `partId`; a stored
  `sku` that conflicts with the canonical `internalPartNumber` (`SKU_CONFLICT`); duplicate identities
  (`IDENTITY_AMBIGUOUS`). Never silently choose, duplicate, or normalize by assuming `partId == sku`.

`partId` is an additive optional field on `InventorySnapshotItem` (legacy items carry only `sku`).

**Recorded follow-on (NOT in scope here):** converging `updateWorkOrderExecutionData` to match on `partId`
is a separate change to a live command and is left for its own gate. Compatibility is satisfied by writing
the canonical `internalPartNumber` into `sku` — **not** by equating `sku` with `partId`.

## 7. Boundaries

Repo-only: registering the capability (`active:false`) and adding the callable are repo-only (export ≠
deploy; register ≠ grant). `fieldops_wos` is already Cloud-Function-only, so **no `firestore.rules` change**.
Deploying the function and granting the capability are **separate protected gates**, not part of this work.

## 8. Client pure core (built, this PR)

`domain/workOrderPartsPlan.js` (+ 5 tests): `buildPartsPlanInput` (validate/normalize plan intent, keyed on
`partId`, positive-int qty, no duplicates, empty plan = clear), `planRemovals`, and `planRemovalBlocked`
(cannot un-plan a part with recorded usage). This is the client mirror of §4–§5 invariants; the server
command re-enforces them as the authority.

## 9. Tests (built)

`functions/test/setWorkOrderPartsPlan.test.mjs` (6, offline over the compiled pure core): validation
(honest `PartsPlanError(INVALID)`), identity written (both `partId` + `sku`, sku fallback + resolver),
**PLAN ≠ USE** (`qtyUsed` preserved across a re-plan), the used-part removal invariant
(`failed-precondition`), and legacy sku-only matching (no fabricated duplicate). The two governance
guardrails also cover it: `permissionCatalog.test.mjs` (registered `active:false`, additive) and
`resolveEffectivePermission.test.mjs` (accounted-for as deferred-by-design, granted to no Role). Capability
enforcement + the transaction are the callable layer (emulator/integration), asserted structurally here.

The client callable binding lives in `services/workOrderService.ts` (`setWorkOrderPartsPlan`), alongside the
other WO callables — the producer is invokable end-to-end; the planning **UI** is a later phase.
