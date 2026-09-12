# W1-C5 — Employee ↔ Principal: registrations this lane could not make itself

Wave 1, lane C5 (`impl/w1-employee-principal`) owns the **Employee** business object and its linkage
to the **EOS security Principal**. Several files that would normally carry a registration are shared
with nine concurrent lanes and were therefore **not edited**. Everything this lane needs somebody to
register is listed here, with the exact change and the reason it matters.

Nothing below is optional-but-nice. Item 1 is the difference between these proofs running in CI and
not running at all.

---

## 1. `functions/package.json` → `test:adminPolicyPostgres` (REQUIRED)

Append the new real-PostgreSQL suite to the existing serialized command:

```diff
-"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs",
+"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs test/employeePrincipalLinkPostgres.test.mjs",
```

**Why it matters.** `.github/workflows/eos-admin-policy-tests.yml` already triggers on
`functions/migrations/**` (lines 72 and 111), so migration 008 will *fire* the workflow — but the job
runs `npm run test:adminPolicyPostgres`, and a suite absent from that command is a suite CI never
executes. Migration 008's constraints would then be proved only on a developer's laptop.

**Why this suite is safe to add.** It is **not** a schema resetter. `adminPolicyPostgres.test.mjs`'s
`every suite that resets the schema is covered by that one command` test exists because two files
that drop and re-migrate `eos_policy` raced in CI. `employeePrincipalLinkPostgres.test.mjs`
deliberately avoids that: it runs an idempotent `migrate up` and then deletes only its own rows (its
own table, plus the `prn-uid-*` principals and memberships its fixtures create). Both registration
guard tests in `adminPolicyPostgres.test.mjs` were run against this branch and still pass.

## 2. `functions/package.json` → a pure-test entry (REQUIRED)

The pure suite needs a home too. Either append it to `test:adminPolicy`:

```diff
-... test/legacyInventoryMovementMapping.test.mjs",
+... test/legacyInventoryMovementMapping.test.mjs test/employeePrincipalLinkPlan.test.mjs",
```

or add a dedicated script alongside the other per-subsystem ones:

```json
"test:employeePrincipalLink": "npm run build && node --test test/employeePrincipalLinkPlan.test.mjs"
```

`test/employeePrincipalLinkPlan.test.mjs` needs no database and no emulator. It carries the
**technician-id fallback ratchet** (see §5), which only protects anything if it runs on every PR.

## 3. `.github/workflows/eos-admin-policy-tests.yml` → path filters (RECOMMENDED)

Add to **both** `paths:` lists (the `pull_request` block near line 52 and the `push` block near line
101):

```yaml
      - "functions/src/employeeIdentity/**"
      - "functions/test/employeePrincipalLinkPlan.test.mjs"
      - "functions/test/employeePrincipalLinkPostgres.test.mjs"
```

Without this, a change to `functions/src/employeeIdentity/**` that touches no migration does not
trigger the workflow that proves it.

## 4. `functions/src/access/permissionCatalog.ts` — NO CHANGE NEEDED

This lane exports **no callable, no HTTP route and no new authorization surface**, so it introduces
no capability id. Recorded explicitly so a reviewer does not go looking for a missing entry: the
linkage is a repository and a planner, reachable today only from a test or a future command, and a
capability id declared before a surface exists would be an authority nothing enforces.

## 5. Nothing to register in `firestore.rules`, and deliberately so

No Rules change, no Firestore collection, no Firebase callable, no client write path. The linkage is
Postgres-resident (`eos_policy.employee_principal_links`). `scripts/firebaseExitGuard.mjs` passes
unchanged on this branch and no path was added to `docs/architecture/firebase-exit-baseline.json` —
`functions/src/employeeIdentity/**` imports no Firebase module at all, and a test in
`employeePrincipalLinkPlan.test.mjs` fences that as a property of the subsystem.

## 6. `field-ops-app-vite/src/metadata/entityRegistry.js` — ALREADY REGISTERED

`employeeEntity` is imported at line 27 and registered at line 59. **No change required.** Recorded
because "Admin → Objects readiness" would otherwise read as an open item; the Employee entity
definition (`field-ops-app-vite/src/metadata/definitions/employee.js`) is already the registry's
description of the object, and this lane did not alter it.

## 7. `field-ops-app-vite/src/access/objectPermissionMap.js` — OPEN QUESTION, NOT A REGISTRATION

There is **no `Employee` row in `OBJECT_PERMISSIONS`**, and this lane did not add one. That is not an
oversight this handoff wants quietly fixed: `firestore.rules`' `employees/{employeeId}` block
(lines 476-498) is three role/relationship-shaped OR branches and **no capability id** — there is no
`employee.read` in the permission catalog, and `employee.js`'s own header records `readCapability:
null` for exactly that reason. Adding a row with four empty arrays would be honest only alongside a
`rulesOnly: "employees"` marker (the shape `Contacts`, `Customer Locations` and `Equipment` already
use at lines 36, 37 and 86).

Whoever owns the Admin → Objects matrix should decide between:

- `{ object: "Employees", domain: "Workforce", rulesOnly: "employees", C: [], R: [], E: [], D: [] }`
  — truthful today; or
- introducing real `employee.*` capability ids first, which is a permission-catalog change and a
  Rules change, and therefore not a Wave 1 lane's decision.

**Lane C5's position:** the second is the right end state and the first is the honest interim. Either
way it is a decision with an owner, and this lane refused to make it inside a shared file.

## 8. `functions/src/callerContext.ts` — a defect this lane fenced but did not fix

`getCallerContext()` (line 20) reads `users/{uid}.technicianId`, and four call sites spend that value
where `trucks.assignedDriverEmployeeId` — an **Employee** id — is the declared authority. The exact
sets are recorded and ratcheted in `functions/test/employeePrincipalLinkPlan.test.mjs`
(`USER_TECHNICIAN_ID_READERS`, `TECHNICIAN_ID_AS_DRIVER_EMPLOYEE_ID`): a NEW fallback fails the test,
removing one is a one-line edit there.

This lane did not rewire the deployed callables. The suites covering them
(`test/cycleCountAssignedMobileLocation.test.mjs` and its siblings) are **Firestore-emulator suites
that cannot run in this environment**, and changing a production authorization path without being
able to run its tests is not a trade this lane was willing to make. The replacement is already built
and proved: `resolveEmployeeIdForPrincipal()` in
`functions/src/employeeIdentity/employeePrincipalLinkRepository.ts` answers "which Employee is this
principal" with **no fallback chain** — null is a complete answer.
