# W1-C11 — required shared registrations

Lane: **C11 — Invoice**
Branch: `impl/w1-invoice`
Pre-allocated migration id: `1758931200000`

This lane did **not** edit any serialized shared file. Everything the integration writer must apply
is listed here, with the reason each one is or is not needed.

---

## 1. `field-ops-app-vite/src/metadata/administration/administrationProfileRegistry.js` — **ONE ENTRY REQUIRED, AND IT IS NOT OPTIONAL**

This lane wrote `field-ops-app-vite/src/metadata/administration/profiles/invoice.js` to Lane C2's
Object Administration Profile pattern. C2 owns the registry and the framework module
(`objectAdministrationProfile.js`), and **neither is on `main`** at the time of writing — they
arrive with PR #1866 (`impl/w1-part-admin-objects`). This lane therefore wrote the profile file and
created **no competing registry**.

Apply, once C2 has merged:

```js
import { invoiceAdministrationProfile } from "./profiles/invoice.js";
```

and add `invoiceAdministrationProfile` to the `ADMINISTRATION_PROFILES` array.

**Why this is mandatory rather than nice-to-have:** C2's `test/objectAdministrationProfile.test.mjs`
has a coverage test that **fails if a profile file exists and the registry does not list it**. Once
both branches are on `main`, omitting this entry is a red build, not a missing feature.

**Verification already performed on this branch.** The framework module and C2's `entityDefinition.js`
were overlaid temporarily (out of the commit) and the profile run through the real validator:

```
VALIDATOR PROBLEMS: NONE
CITATIONS: 11 checked; ALL RESOLVE
fieldPolicies: 20, commands: 1, representations: 2
```

All 11 `cite(path, symbol)` citations resolve against real files in this repository.

## 2. `functions/package.json` — **TWO SUITE REGISTRATIONS REQUIRED** (shared file, not edited here)

Both new suites pass locally (real output in the PR body). Neither is registered, because
`functions/package.json` is a serialized shared file.

| Suite | Where it belongs | Needs a database |
| --- | --- | --- |
| `test/invoiceTotalsAuthority.test.mjs` | append to `test:fulfillment` **or** a new `test:invoice` script | no |
| `test/invoiceAuthorityPostgres.test.mjs` | append to `test:adminPolicyPostgres` | yes (`POLICY_TEST_DATABASE_URL`) |

`test/invoiceAuthorityPostgres.test.mjs` **deliberately does not reset the schema.** It migrates
`up` (idempotent) and deletes only its own tenant's rows. That is why it does not trip
`adminPolicyPostgres.test.mjs`'s "every suite that resets the schema is covered by that one command"
check while it is unregistered, and it is safe to append to `test:adminPolicyPostgres`
(`--test-concurrency=1` already serialises that command).

## 3. `field-ops-app-vite/test/suites.json` — **NO CHANGE, AND NONE POSSIBLE**

No field-ops-app-vite test suite was added. One was considered — a conditional validator for the new
profile — and **deliberately not written**: `ciSuiteCoverage.test.mjs` requires every
`field-ops-app-vite/test/*.test.mjs` to be in `suites.json` or named by a workflow, and `suites.json`
is a do-not-edit shared file for this lane. Adding an unregistered suite would have broken that
check. The profile is covered by C2's own suite the moment registration #1 is applied.

## 4. `field-ops-app-vite/src/metadata/entityRegistry.js` — **NO CHANGE REQUIRED**

`invoiceEntity` is already imported and present. This lane added **no** EntityDefinition; the
administration profile declares no fields of its own and names only fields the entity already has
(verified: `validateProfileAgainstEntity` reports no problems).

## 5. `functions/src/access/permissionCatalog.ts` — **NO CHANGE REQUIRED**

**No new capability id.** The profile names `finance.invoice.issue` and `finance.read`, both copied
from the commands that already require them (`invoiceCallables.ts`'s
`FINANCE_INVOICE_ISSUE_CAPABILITY`, `financeReadCallables.ts`). They are *declarations handed to the
resolver*, not grants; both remain registered `active:false`. Nothing in this lane evaluates one.

## 6. `field-ops-app-vite/src/access/objectPermissionMap.js` — **NO CHANGE REQUIRED**

No new capability id and no new object.

## 7. `firestore.rules` — **NO CHANGE REQUIRED, AND NONE PERMITTED**

Unchanged. No authorization, permission, workflow, ownership, approval, routing, visibility or
business-config logic was added anywhere in Rules. `invoices`, `payments` and `payment_applications`
remain deny-all to clients.

## 8. `.github/workflows/**` — **OPTIONAL (integration writer's call)**

If the two suites in #2 are registered in `functions/package.json`, no workflow edit is needed
beyond whatever already invokes those scripts. If the writer prefers to name the files directly, the
Postgres suite belongs in the same workflow that runs `test:adminPolicyPostgres`.

## 9. `firebase-exit-baseline.json` / `firebase-exit-manifest.json` / `capability-graph.json` — **NO CHANGE REQUIRED**

`node scripts/firebaseExitGuard.mjs` passes unchanged: *"no new Firebase business-runtime
dependencies beyond the committed baseline"*. Every file this lane added
(`functions/src/eosOps/invoiceTotals.ts`, `functions/src/eosOps/invoiceAuthority.ts`, the migration,
the profile, the tests) is Firebase-free. The lane **removed** no baseline entry either — retiring
the Firestore `invoices` authority is a cutover this packet does not perform.

---

## What was NOT registered because it does not exist

* **No `voidInvoice` command.** Migration 008 gives `invoices` the `voided_at` / `void_reason` /
  `voided_by` columns because four existing commands already *refuse to act on* a void invoice and
  the AR read already *projects* a VOID position — but **nothing anywhere sets VOID**. Every
  occurrence of `"VOID"` in `functions/src/finance/` is a read. Inventing the command would be
  deciding a financial policy (who may void, on what evidence, with what effect on issued
  numbering) that nobody has decided.
* **No AR overlay in the Postgres authority.** `payments`, `payment_applications`,
  `invoice_adjustments` and `refunds` are the Payment lane's. Migration 008 stops at what is
  BILLED and leaves `eos_finance.invoice_totals` as the join surface that lane will need.
  (Schema updated at the W1 integration: the Owner ruled Invoice and Payment into one
  `eos_finance` bounded context. This lane's migration establishes it; the Payment lane's extends
  it, and `payment_applications.invoice_id` is now a real foreign key into `eos_finance.invoices`.)
