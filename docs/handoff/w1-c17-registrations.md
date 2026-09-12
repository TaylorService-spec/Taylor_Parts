# W1-C17 — Financial authority: registrations this lane could not make itself

This lane (`impl/w1-financial-authority`) touched only files it owns. Everything below is a change to
a SHARED file that eleven concurrent lanes also edit, so it is recorded here instead of being made.

## 1. CI registration for the new test file — REQUIRED

`functions/test/financialCompanyDimension.test.mjs` is new and is not yet run by any workflow.
`.github/workflows/**` is shared, so this lane did not edit it.

In `.github/workflows/finance-invoice-persistence-tests.yml`:

* add to BOTH `paths:` filter blocks (alongside the existing
  `functions/test/financeReadProjection.test.mjs` / `functions/test/financialReportingRead.test.mjs`
  entries, currently near lines 56–57 and 106–107):

  ```yaml
      - "functions/test/financialCompanyDimension.test.mjs"
  ```

* append the file to the pure-core `node --test` run list (currently near line 156), after
  `test/financialReportingRead.test.mjs`:

  ```
  test/financialCompanyDimension.test.mjs
  ```

`.github/workflows/financials-north-star-tests.yml` already watches
`functions/src/finance/financeReadProjection.ts` and `functions/src/finance/financialReportingRead.ts`,
so the client-side suites it runs are already triggered by this change. No edit needed there.

Optional, not required: the file is a pure offline suite and needs no npm script, but if one is
wanted it belongs beside the other finance entries in `functions/package.json` (shared — not edited).

## 2. Administration → Objects — NOT registered, deliberately

No object administration profile was written. Lane C2's framework (PR #1866) is not on main, a profile
file that the registry does not list fails C2's coverage test, and this lane added no new object — it
added a missing DIMENSION to an existing governed read. There is therefore nothing for
`field-ops-app-vite/src/metadata/administration/objectAdministrationProfile.js` to list.

The integration point, when Invoice does get an Administration → Objects profile (that is lane C11's
object, not this lane's): the Invoice profile's read citation should name
`functions/src/finance/financeReadProjection.ts` `projectInvoiceAr` for the per-invoice AR shape and
note that `companyId` is now part of it.

## 3. Permission catalog — no change needed

No capability id was added or changed. `finance.read` and the five `finance.visibility.*` scope ids
are untouched; `functions/src/access/permissionCatalog.ts` (shared) needs no edit.

## 4. Metadata / entity registry — no change needed

`field-ops-app-vite/src/metadata/entityRegistry.js` and `field-ops-app-vite/test/suites.json` are
untouched and need no entry: no new entity, no new client suite.

## 5. Follow-ons this lane deliberately did NOT do (see the PR body for evidence)

* **`functions/src/finance/paymentCommands.ts` owns a SECOND copy of `deriveOutstandingMinor`**
  (`paymentCommands.ts:77`) identical to the read projection's (`financeReadProjection.ts:25`).
  Consolidating belongs to the Payment lane (C12) that owns that file. Until then
  `financialCompanyDimension.test.mjs` case 15 pins the two implementations to agree.
* **Client surfaces still render the consolidated figure without saying it is consolidated.**
  `field-ops-app-vite/src/modules/financials/FinancialsCustomerFinancials.jsx:55` reads
  `summary.outstandingByCurrency` with no operating-company control on the page at all, and
  `field-ops-app-vite/src/modules/accounts/AccountArSection.jsx:61-65` renders Invoice / Position /
  Outstanding with no company column. Both now HAVE the facts they need
  (`summary.byCompany`, `summary.spansMultipleCompanies`, and `companyId` on every row); wiring them
  is a Financials-surface change and is left to the lane that owns those pages.
* **A `VOID` invoice with a positive derived outstanding is still counted as owed.**
  `financeReadProjection.ts` `deriveArPosition` returns `VOID`, but `deriveOutstandingMinor` still
  returns `total − applied − …` for it, so `summarizeAccountAr` counts it in `openCount` /
  `outstandingByCurrency` and `summarizeArAging` files it under `currentMinor`. It is currently
  UNREACHABLE — no command in `functions/src/finance/` can put an invoice into `VOID` (every command
  only refuses one: `paymentCommands.ts:123`, `adjustmentCommands.ts:88`, `refundCommands.ts:79`) —
  and deciding what a voided invoice's outstanding means is a policy call that also has to agree with
  `financialReconciliation.ts:100`. Recorded, not invented.
