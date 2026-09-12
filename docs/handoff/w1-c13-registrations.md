# W1 / C13 — Inventory Action: required shared registrations

Lane C13 owns `field-ops-app-vite/src/metadata/definitions/inventoryAction.js` and the
`inventory_actions` collection behind it. Everything below is a change to a file the lane was
**forbidden to edit** (shared across eleven concurrent lanes). Each entry states the exact edit, the
evidence for it, and what breaks if it is skipped.

**This lane added no migration.** The pre-allocated id `1759104000000` was **not used** and remains
free. The known shared-test hazard (migration counts / `eos_ops` table lists in
`eosOpsOperatingCompanyCustody.test.mjs`, `eosOpsPostgres.test.mjs`,
`eosOpsOperatingCompanyCustodyPostgres.test.mjs`, `adminPolicyPostgres.test.mjs`) is therefore **not
triggered by C13** — no relative-index fix was needed and none was applied.

---

## 1. REQUIRED — register the new suite

**File:** `field-ops-app-vite/test/suites.json`
**Edit:** add, in alphabetical position (immediately before `test/inventoryRoleReadErrorContract.test.jsx`):

```json
    {
      "file": "test/inventoryActionRetirementContract.test.mjs",
      "runner": "node --test"
    },
```

**Why:** without it the retirement contract never runs in CI, and the guard it provides is
decorative. Verified locally: 9 tests, 9 pass, and each assertion was mutation-tested to confirm it
actually fails when the contract is broken.

---

## 2. RECOMMENDED — Administration → Objects advertises a Create that cannot happen

**File:** `field-ops-app-vite/src/access/objectPermissionMap.js:54-56`

Current:

```js
  { object: "Inventory Adjustments", domain: "Inventory",
    C: ["inventory.action.create", "inventory.cycleCount.create"], R: ["inventory.action.read"],
    E: [...], D: [] },
```

**Edit:** drop `"inventory.action.create"` from `C`, leaving `C: ["inventory.cycleCount.create"]`.

**Why:** `inventory.action.create` has **no executable path**. Its only application-layer writer,
`field-ops-app-vite/src/domain/inventoryActions.js:recordInventoryAction`, unconditionally throws
(Owner ruling 2026-08-30), and the `.add()`-capable `inventoryActionsStore` handle was removed
entirely. The CRED grid therefore promises an administrator a Create verb that no code can perform.

The governance census **already disagrees with this row**:
`functions/scripts/governance/objectCapabilityMap.mjs:64` records
`"Inventory Adjustments": { R: ["inventory.action.read"], C: [], E: [], D: [] }` — `C` empty. The
divergence is live today. `scripts/reconcileCrudMatrix.mjs:113` carries the stale `C` too and would
need the same edit.

**Not done here** because `objectPermissionMap.js` is a shared file and the change ripples into
`functions/src/access/parityFixtures.ts` (`admin/dispatcher: inventory action create` fixtures at
`:670-694`) and `functions/test/governedBusinessRoles.test.mjs:461,654`.

---

## 3. TIER-2, OWNER DECISION — the Firestore Rules create gap is now the ONLY write path

**File:** `firestore.rules:1154-1158`

```
    match /inventory_actions/{actionId} {
      allow read: if isAdminOrDispatcher() || isActiveOperationalRole("WAREHOUSE_MANAGER");
      allow create: if isAdminOrDispatcher();
      allow update, delete: if false;
    }
```

**Edit:** `allow create: if false;`

**Why:** with the product's write path retired, this rule is the last remaining way a document can
be created — `domain/inventoryActions.js`'s own header says so explicitly and declines to close it
from there. It carries **no field-level validation whatsoever**: no `hasOnly([...])`, no per-field
type check, and no `request.resource.data.createdBy == request.auth.uid` binding. Any admin or
dispatcher with a console can write an arbitrarily-shaped document, with a `createdBy` naming
someone else, into a collection two live UI panels display as attributable history
(`PartDetail.jsx:1224 InventoryActionsPanel`, `WarehouseManagerHome.jsx:90`).

This is also a standing instance of the program's hard prohibition on using Firestore Rules as the
authorization surface for a business write.

**Not done here:** `firestore.rules` is shared, and the file's own comment records that closing this
is a Tier-2 change the presentation ruling did not authorize.

---

## 4. DEFERRED — Administration → Objects profile

No profile file was written. The C2 reference contract
(`field-ops-app-vite/src/metadata/administration/objectAdministrationProfile.js`) exists **only on
`impl/w1-part-admin-objects`** — it is absent from `main` and from this branch. Writing
`profiles/inventoryAction.js` here would either import a module that does not exist (an unrunnable
test) or require copying the contract, which is precisely the "second framework" the lane brief
forbids. Cherry-picking was likewise forbidden.

When C2 lands, the registry line to add to
`field-ops-app-vite/src/metadata/administration/administrationProfileRegistry.js` is:

```js
import { inventoryActionAdministrationProfile } from "./profiles/inventoryAction.js";
// ...and in the exported array:
  inventoryActionAdministrationProfile,
```

The profile's content is already fully determined by the findings, and is **non-standard in exactly
one way worth flagging to whoever writes it**: `functions/src/ownership/ownershipMatrix.ts:326`
classifies `inventoryAction` as `ownerClass: "COMPANY"` with `ownerFields: []` and
`unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED`. C2's `validateObjectAdministrationProfile` rejects
`ownerClass === "COMPANY"` with no `companyField`. That is not a bug in either place — it is a real,
unresolved gap (the object stores no operating company and, per the matrix, would have to inherit it
from the stock location once D-9 is populated). It needs an Owner answer, not a local workaround,
and **operating company must not be inferred** from the Part, the warehouse, or the actor.

---

## 5. NO CHANGE NEEDED — recorded so it is not "fixed" later

- `docs/architecture/firebase-exit-baseline.json:46` still lists
  `field-ops-app-vite/src/hooks/useInventoryActions.js`. **Correct and must stay**: the read is
  deliberately still a client-direct Firestore subscription. `domain/inventoryActions.js` is
  correctly *absent* — the retirement removed a real Firebase dependency rather than disarming one.
  `node scripts/firebaseExitGuard.mjs` passes.
- `inventory_actions` appears in **no** migration and **no** `eos_ops`/`inventoryLedger` repository.
  That absence is this object's answer, not its gap — see the contract test's header.
