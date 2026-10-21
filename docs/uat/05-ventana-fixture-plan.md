# Ventana fixture plan (Owner PART 1 section 3)

> **Requires #2201 merged** before the script is run. The **controller runs this on nonprod before Codex's cross-company pass**; Claude lanes and Codex never run it. Read-only lane: nothing here was executed, no nonprod write was made, no credential was read.

## 1. What exists today (from the 2026-10-21 census)

| Fact | Value |
|---|---|
| Operating companies in the tenant | `taylor` ACTIVE, `ventana` ACTIVE |
| Operating-company KEY bindings | **only `taylor`** (`MIGRATED`). `ventana` is authorized but **unkeyed, deliberately** (`config/ownership/operating-company-keys.sandbox.json`: "a native Ventana operational row must FAIL CLOSED until an explicit key binding is authored here") |
| Employees homed in Ventana | **0** (all 34 are `taylor`) |
| Company-access grants to `ventana` | 3: `synthetic-np-emp-owner-executive`, `synthetic-np-emp-general-manager`, `synthetic-np-emp-finance-controller` (the #2140-R preservation) |
| Finance (explicit Financials assignment) reach to `ventana` | financeAccounting, generalManager, ownerExecutive, administrator (FINANCE_ONLY Roles: Finance reach only) |
| Ventana warehouses, records | none known (the census holds no record counts; CG-06) |

Consequence: **no persona can today create or see a Ventana operational record**, and the key binding is a precondition of every Ventana write (a warehouse's company is resolved to its ACTIVE bound key and an unbound company is refused with `OPERATING_COMPANY_NOT_GOVERNED`).

## 2. Ordered plan: the existing governed path for each write

| # | Write | Existing governed path | Who runs it | State |
|---|---|---|---|---|
| 1 | Bind the `ventana` key (`tenant_operating_company_keys`) | The evidence file `config/ownership/operating-company-keys.sandbox.json` gains one binding (`operatingCompanyId: ventana`, proposed key `ventana`, provenance `NATIVE`, reason citing the Owner ruling); then `node scripts/tenantOperatingCompanyKeyReconcileCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> --apply` on the Render shell (dry run by default; there is no `--key` argument by design; it never rebinds or deletes) | Controller PR for the file (Owner question **OQ-09**), then the operator on Render | **Not done. This lane makes no code or config change.** The script detects "unbound" and stops. |
| 2 | Ventana warehouses (`ventana-uat-wh-main`, `ventana-uat-wh-service`) | Administration command `createWarehouse` (`warehouse.record.manage`; reason required; one audit row; the company resolves to the bound key; `provenance NATIVE`) | script S20, S21 as `administrator` | verified payload |
| 3 | Ventana Employees (`ventana-uat-emp-sales`, `-tech`, `-office`) | Workforce command `createEmployee` (`admin.employeeProfile.write`); creates **no** Principal, Role, link, scope or eligibility ("existence is not authority") | script S30-S32 as `administrator` | verified payload |
| 4 | Ventana reach for **existing** personas | Administration command `grantCompanyAuthority` (idempotent; an identical active grant is returned; an actor cannot grant themselves). **An Owner-gated access act:** the script writes a grant only for employee ids named with `--grant`, default **none** | script S40 | verified payload; needs Owner answer **OQ-08** |
| 5 | Ventana-native **personas** (a Principal, an Employee link, an MFA enrollment) | `functions/scripts/provisionGovernedPrincipal.js` / `enrollPersonaLogins.js` (operator, credentials outside the repository) | **Not in this script.** Credentials are never created by this lane. | Owner question **OQ-14** |
| 6 | Synthetic Ventana account, opportunity, agreement, order | CRM `createAccount` (`lineOfBusiness: ["VENTANA"]`); Commercial `createOpportunity` (`operatingCompanyId: ventana`), `createSalesAgreement` (must equal the Opportunity's company), `acceptSalesAgreement`, `closeOpportunityAsWon` / `createSalesOrderFromOpportunity`. The actor must reach Ventana (Q-1a `admitNewRecordCompany`): the **generalManager** persona holds a Ventana grant and every commercial capability involved | script S50-S53 as `generalManager` | **payload not verified**; listed, not run (`--include-unverified`) |
| 7 | Synthetic Ventana Work Order | Work Order command `createWorkOrder` (`workOrder.create` + company authority) | script S55 | **payload not verified**; DWO (#2200) changes the boundary: re-confirm after it merges |
| 8 | Synthetic Ventana inventory | Supplier PO chain (P-1): raise -> approve (another person) -> send -> receive into `ventana-uat-wh-main`. **No persona holds Ventana inventory authority today**: it needs Owner-approved company-access grants and a WAREHOUSE operational scope for the receiving Employee | script S56 (plan only) | **Stops at a plan** (OQ-08) |
| 9 | Synthetic Ventana receivable | `prepareBillingPackage` -> `listObligations`; a package exists only for an order that is eligible in full (Work Order evidenced), so it needs S55 executed and completed by a Ventana technician Principal (OQ-14) | script S57 (plan only) | **Stops at a plan** |
| 10 | Cross-company service (DWO-1) | `authorizeSalesOrderServiceProvider` on a Taylor-selling order, then a Ventana Work Order linked to it | **Not scripted**: depends on #2200 and on steps 6-7 | Owner/controller, after #2200 |

**Where no governed path exists:** none of the above lacks a path, but steps 8 and 9 cannot run without Owner access acts and a Ventana technician login, and step 1 needs a config PR. Those are plans, by design.

## 3. The script

`docs/uat/tools/ventana-uat-fixture.mjs` + `ventana-uat-fixture.spec.json` (ordered steps). **Dry run by default** (`node docs/uat/tools/ventana-uat-fixture.mjs` prints the plan and sends nothing; verified offline).

| Property | How |
|---|---|
| Nonprod only | The base URL must equal the registered `platform-sandbox` API in `config/environments.json` exactly; an `EOS_API_BASE_URL` that differs is refused; a `taylor-parts` host is refused. It passes the base URL explicitly to `callEosApiAsPersona`. |
| Idempotent | `createWarehouse`/`createEmployee` "already exists" codes (`WAREHOUSE_EXISTS`, `EMPLOYEE_ALREADY_EXISTS`) are reported as PRESENT; `grantCompanyAuthority` returns an identical active grant; commercial steps carry fixed idempotency keys (`ventana-uat-S5x-...`). Re-running changes nothing. |
| Synthetic | Every free-text field must contain `SYNTHETIC UAT`; every id is prefixed `ventana-uat-`; every company is `ventana`; a `--grant` target must be a `synthetic-np-emp-*` Employee (never a sample or real-derived person). Taylor data is never read or written. |
| Ordered, stop on refusal | Steps run in order; the first refusal stops the run (`STOPPED_KEY_NOT_BOUND` if step 1 is missing). |
| No credential handling | The operator sets `EOS_PERSONA_ISSUER_CREDENTIAL` (name only; never printed). The issuer is an API client here, not login proof. Output is one JSON line per step: step, outcome, code. |
| Unverified steps | Steps S50-S57 are `verified:false`: skipped unless `--include-unverified`; S56/S57 are plan-only. The controller confirms each payload against the named source before using the flag. |

Run order for the controller: (1) Owner answers OQ-08/09/14; (2) controller PR for the key evidence file and the reconcile CLI on Render; (3) dry run; (4) `--apply` (S20-S32, plus `--grant` ids the Owner named); (5) confirm S50-S55 payloads, then `--apply --include-unverified --only S50,S51,S52,S53,S55`; (6) tell Codex the run id and outcome in the preamble.

## 4. Fixture ids the test plan uses

| Fixture | Record kind(s) | Created by |
|---|---|---|
| F-ACC | `V-ACC` | S50 |
| F-OPP | `V-OPP-R` | S51 |
| F-AGR | `V-AGR-R` | S52-S53 |
| F-ORD | `V-ORD-R` | S53 |
| F-WO | `V-WO` | S55 |
| F-INV | `V-INV` | S56 (plan) |
| F-REC | `V-REC` | S57 (plan) |
| F-NOCO | `X-OPP-NOCO` (company-less Opportunity created by the generalManager persona, no `operatingCompanyId`) | not scripted: one `createOpportunity` without a company by that persona |
| F-XSVC | `X-WO-XSVC` | not scripted (step 10) |

Until a fixture exists the manifest rows that need it report **NOT CONFIGURED**, never FAIL.
