# W1-C12 — required shared registrations

Lane: **C12 — Payment and payment application (`payments`, `payment_applications`)**
Branch: `impl/w1-payment`
Pre-allocated migration id: `1759017600000`

This lane did **not** edit any serialized shared file. Everything the integration writer must apply
is listed here, exactly, with the reason each one is or is not needed.

---

## 1. `functions/package.json` — **TWO SCRIPT REGISTRATIONS REQUIRED**

Two new suites were added and neither can register itself.

**1a. `test:adminPolicy`** (the offline eos_ops suite list) — append:

```
 test/eosOpsCashApplication.test.mjs
```

Final form of the existing value, unchanged except for the appended file:

```
"test:adminPolicy": "npm run build && node --test test/adminPolicyAuthorization.test.mjs ... test/legacyInventoryMovementMapping.test.mjs test/eosOpsCashApplication.test.mjs"
```

**1b. `test:adminPolicyPostgres`** (the serialized real-database command) — append:

```
 test/eosOpsCashApplicationPostgres.test.mjs
```

**This one is a registration, not a compliance requirement.** `adminPolicyPostgres.test.mjs`'s
*"every suite that resets the schema is covered by that one command"* test scans test files for a
schema-drop and fails if such a file is missing from this script. `eosOpsCashApplicationPostgres.test.mjs`
is deliberately built **not** to reset the schema — it runs `node-pg-migrate up` and scopes every
row it writes to its own tenant (`tenant-c12-cash`), cleaning up with `TRUNCATE` — so that test
passes today with or without this line. Two reasons it is still the right line to add:

* a financial-data suite that drops schemas can destroy another suite's rows if it is ever pointed
  at the wrong `DATABASE_URL`; scoped cleanup cannot, which is why it was written this way; and
* without the registration the suite runs in **no** CI command at all, and a structural proof that
  nothing runs proves nothing.

## 2. `field-ops-app-vite/src/metadata/administration/administrationProfileRegistry.js` — **ONE LINE, AFTER LANE C2 LANDS**

This file does **not exist on `main`**. It is lane C2's (branch `impl/w1-part-admin-objects`,
PR #1866). This lane wrote its profile to C2's contract and did **not** cherry-pick anything.

When C2 merges, add the import and the array entry:

```js
import { paymentAdministrationProfile } from "./profiles/payment.js";

export const ADMINISTRATION_PROFILES = Object.freeze([
  partAdministrationProfile,
  paymentAdministrationProfile,
]);
```

**Until then, `field-ops-app-vite/src/metadata/administration/profiles/payment.js` has an import
that does not resolve** (`../objectAdministrationProfile.js`). Nothing imports the file, so nothing
breaks — but it is inert, not live, and a reviewer should know that is deliberate rather than an
oversight. The profile was validated against C2's real `validateObjectAdministrationProfile` +
`validateProfileAgainstEntity` out of tree: **0 problems, 8 citations, 0 unresolved.**

C2's own `test/objectAdministrationProfile.test.mjs` coverage test fails when a profile file exists
and the registry does not list it, so after C2 merges this line is required, not optional.

## 3. `field-ops-app-vite/src/metadata/entityRegistry.js` — **NO CHANGE REQUIRED**

`paymentEntity` is already imported (`:39`) and already in `ENTITY_REGISTRY` (`:71`). This lane
added **no new EntityDefinition**. It did add one FIELD to the existing `payment` entity
(`paymentId`, the canonical identity) inside `definitions/payment.js`, which this lane owns; the
registry references the entity by id and needs no edit.

`paymentApplication` remains **unregistered** — there is no `definitions/paymentApplication.js`, and
this lane did not add one. The Firestore `payment_applications` collection has no read path, no
client surface and no list view to describe, so an EntityDefinition for it would declare a surface
nothing can serve. Recorded as a known gap, not routed around.

## 4. `field-ops-app-vite/src/access/objectPermissionMap.js` — **NO CHANGE REQUIRED**

No new capability id. The profile names `finance.payment.apply`, copied from
`functions/src/finance/paymentCallables.ts` (`FINANCE_PAYMENT_APPLY_CAPABILITY`) — a *declaration
handed to the resolver*, never a grant, and nothing in this lane evaluates one.

## 5. `functions/src/access/permissionCatalog.ts` — **NO CHANGE REQUIRED**

No new capability. `finance.payment.apply` already exists (`:290`, `active: false`, fail-closed).

**A real gap is recorded rather than filled:** there is no `finance.payment.read` (or similar)
anywhere, and `finance.read`'s own catalog description names the invoice AR position via
`listAccountInvoiceAr` specifically — not payments. Inventing a read capability here would attribute
a gate to a read path that does not exist. The profile's `readModel.gate` says so in those words.

## 6. `firestore.rules` — **NO CHANGE REQUIRED, AND NONE PERMITTED**

Unchanged. `payments` and `payment_applications` remain `allow read, write: if false` (`:1812`,
`:1815`). No authorization, workflow, ownership, approval, routing, visibility or business-config
logic was added to Rules by this lane.

## 7. `field-ops-app-vite/test/suites.json` — **ONE ENTRY REQUIRED, AFTER LANE C2 LANDS**

No new client-side test file was added by this lane, so **nothing is required today**. If C2's
`test/objectAdministrationProfile.test.mjs` is extended to cover this profile, C2's existing
`suites.json` entry already runs it — no second entry is needed.

## 8. `.github/workflows/**`, `firebase-exit-baseline.json`, `firebase-exit-manifest.json`, `capability-graph.json` — **NO CHANGE REQUIRED**

No new Firebase dependency, no new Firestore collection, no new callable, no new capability.
`node scripts/firebaseExitGuard.mjs` passes unchanged on this branch.

---

## Shared-test hazards this lane hit, and exactly how it fixed them

Adding migration **008** breaks four assertions on `main` that assume 007 is the newest migration.
The canonical positional fix was applied to the one named in the lane brief; the other three are in
files the brief did not name and are fixed in the same spirit. **Every one of these is a change a
sibling lane adding migration 008+ will also have to make**, so they are listed here for trivial
conflict resolution.

| File | Was | Now |
| --- | --- | --- |
| `functions/test/eosOpsOperatingCompanyCustody.test.mjs` | `assert.equal(files.length, 7)` + `files[files.length - 1]` | `assert.equal(files[6], MIGRATION_FILE, ...)` — the canonical form, `files.length` dropped |
| `functions/test/adminPolicyPostgres.test.mjs` | `down 7` hardcoded | count read from the `migrations` directory |
| `functions/test/adminPolicyPostgres.test.mjs` | *"the newest migration reverses alone"*, `down(1)` | renamed *"migration 007 reverses alone"*; reverses everything above 007 first, so it keeps proving the 007/006 pair it was written for instead of re-aiming itself at whichever packet landed last |
| `functions/test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` | `migrate(["down","1"])` in two tests | `downThrough007()`, computed from the directory |
| `functions/test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` | `deepEqual(tables carrying operating_company_key, the three)` | the three must be present; **every** table carrying the column must have it `TEXT NOT NULL`; `cycle_count_lines` must not. Exhaustiveness moved off the list and onto the rule, because the Owner ruling requires the column on later tables too — 008's `payments` is the first |
| `functions/test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` | `information_schema.columns` unfiltered | joined to `information_schema.tables` for `BASE TABLE` — view columns are always reported nullable, and 008's `payment_balances` view merely *projects* the company key |
| `functions/test/eosOpsPostgres.test.mjs` | *"exactly four foundation tables"* | the four must be present (containment); the FORBIDDEN-table list is what stays exhaustive, and it was widened to `locations`, `invoices`, `accounts` |

### One more pinned number

`field-ops-app-vite/test/entityRegistry.test.mjs` pins the declared-field census. Adding
`payment.paymentId` moves it **394 -> 395** (entity count unchanged at 29). The test's own comment
says the pin exists so that a model change is a deliberate edit to that number, which this is — but
any sibling lane that also adds a field will edit the same line, so expect a conflict there and
resolve it by summing the lanes' additions rather than taking one side.

Verified: 61/61 pass in `adminPolicyPostgres` + `eosOpsPostgres` + `eosOpsOperatingCompanyCustodyPostgres`
with migration 008 present, and 61/61 with it removed.

---

## What this lane could NOT do

* **Firestore-emulator suites did not run.** Port 8080 on this host holds an unrelated service, so
  `paymentCallables.test.mjs` and any Rules regression suite could not be exercised here. Not run,
  not faked.
* **No production cutover, import, dual-write, writer-freeze or deploy**, by instruction. The
  eos_ops tables are empty and nothing deployed reads or writes them.
* **No live record was mutated, migrated or reconciled**, by instruction. The drift described below
  was measured and reported, never "fixed".
