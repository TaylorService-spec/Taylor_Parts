# Ventana fixture plan (Owner PART 1 section 3)

> **Requires #2201 merged** before the script is run. The **controller runs this on nonprod before Codex's cross-company pass**; Claude lanes and Codex never run it. Nothing in this plan or script was executed against nonprod: no nonprod write was made and no credential was read. Revised by lane VFX (2026-10-21) against `origin/main` `b433d396`; the S50-S55 inputs below were traced in command source, not run.

## 0. Rules that bind this fixture (Owner, 2026-10-21)

1. **The Ventana key waits for a human.** Binding the `ventana` operating-company key (`tenant_operating_company_keys`) is a separate human-authorized procedure documented by the UAT lane. This script never performs it and never edits `config/ownership/operating-company-keys.sandbox.json`. If the key is not bound, the first write refuses `OPERATING_COMPANY_NOT_GOVERNED` and the script stops with `STOPPED_KEY_NOT_BOUND`: **the fixture waits for the key.**
2. **No grant without a preview and the Owner's approval.** Every company-access grant is previewed first (`previewAuthorityChange`, advisory and read-only); the outcome and digest are printed; a grant is committed only with an explicit `--grant <id>` **and** `--approve-digest <id>=<digest>` equal to the digest the preview just returned.
3. **Minimal access, explicit negative controls.** Exactly one new grant each for Sales (retail), Service and Warehouse; Finance reuses existing reach; four Taylor-only personas are never granted (section 3).
4. **The three existing Ventana intercompany receivables are protected** (section 4).
5. **Shared customers, company-owned records.** The fixture's Ventana-line Account is a *shared customer record*; every Ventana Commercial, Work Order and Finance record is *company-owned* (section 5).
6. **Retail and National Accounts stay distinct** Job Roles separated by channel; the plan carries one Ventana record in each channel (section 5).

> **Phase 2 (Owner decisions, 2026-10-21).** The key value is `ventana` and is applied through the human-authorized procedure in `10-ventana-key-change-procedure.md` (this lane edits nothing). Governed Ventana access goes to existing personas, minimally, with Taylor-only negative controls; no Ventana personas with their own logins (OQ-08, OQ-14). Lane VFX owns the exact grant list, the dry run and the fixtures; **the three existing Ventana intercompany receivables are PROTECTED** (never mutated). Until the key is bound **every Ventana case is BLOCKED** (never PASS, never FAIL), and Codex's first run is a Taylor-only baseline. The script's API routes were corrected to the server's real routes (`/workforce/employees`, `/crm/customer`, `/commercial/sales`); `tools/uatRouteCheck.mjs` verifies them.

## 1. What exists today (from the 2026-10-21 census)

| Fact | Value |
|---|---|
| Operating companies in the tenant | `taylor` ACTIVE, `ventana` ACTIVE |
| Operating-company KEY bindings | **only `taylor`** (`MIGRATED`). `ventana` is authorized but **unkeyed** (the evidence file says a native Ventana operational row must FAIL CLOSED until an explicit binding is authored) |
| Employees homed in Ventana | **0** (all 34 are `taylor`) |
| Company-access grants to `ventana` | 3: `synthetic-np-emp-owner-executive`, `synthetic-np-emp-general-manager`, `synthetic-np-emp-finance-controller` |
| Finance (explicit Financials assignment) reach to `ventana` | financeAccounting, generalManager, ownerExecutive, administrator (FINANCE_ONLY Roles: Finance reach only) |
| Ventana obligations (`eos_finance.obligations`) | **3 intercompany receivables exist today, protected** |
| Ventana warehouses, other records | none known (the census holds no record counts; CG-06) |

Consequence: until the key is bound **no persona can create or see a Ventana operational record** (a warehouse's company is resolved to its ACTIVE bound key and an unbound company is refused with `OPERATING_COMPANY_NOT_GOVERNED`).

## 2. Ordered plan: the existing governed path for each write

All HTTP routes are `POST <route>` with `{ "operation", "input" }`. **Correction:** the Workforce, CRM and Commercial routes are `/workforce/employees`, `/crm/customer` and `/commercial/sales` (`eosApiDomainFor` in `functions/src/eosApi/server.ts` matches only the trailing-slash prefixes, so the bare `/workforce`, `/crm` and `/commercial` that earlier drafts and the generated Codex probe tables use would be answered by the Administration transport as UNKNOWN_OPERATION). `/operations/*` and `/admin/policy` were right.

| # | Write | Existing governed path | Persona | State |
|---|---|---|---|---|
| 1 | Bind the `ventana` key | **Not in this script, not in this PR.** Separate human-authorized procedure (UAT lane); the script detects "unbound" and stops | human | **Blocks every step below** |
| 2 | Ventana warehouses `ventana-uat-wh-main`, `-service` (S20, S21) | Administration `createWarehouse` (`/admin/policy`) | administrator | verified payload |
| 3 | Ventana Employees `ventana-uat-emp-sales`, `-tech`, `-office` (S30-S32) | Workforce `createEmployee` (`/workforce/employees`); creates no Principal, Role, link, scope or eligibility | administrator | verified payload |
| 4 | Company access for **existing** personas (S40) | Administration `previewAuthorityChange` then `grantCompanyAuthority` (`/admin/policy`); preview-first, approval by digest | administrator | verified; **Owner-gated** (section 3) |
| 5 | Ventana-native **personas** (Principal, link, MFA enrollment) | `provisionGovernedPrincipal.js` / `enrollPersonaLogins.js` (operator, credentials outside the repository) | n/a | **Not in this script** (OQ-14) |
| 6 | Ventana-line customer Account (S50) | CRM `createAccount`: `name`, `status: ACTIVE`, explicit `ownerEmployeeId`, `relationshipTypes: [CUSTOMER]`, `lineOfBusiness: [VENTANA]`, `idempotencyKey` | generalManager | verified (traced) |
| 7 | Customer site (S50b) | CRM `createAccountLocation`: `accountId`, `name`, `idempotencyKey` (returns `accountLocationId`) | generalManager | verified (traced) |
| 8 | RETAIL opportunity (S51) and stage walk (S51b-S51f) | Commercial `createOpportunity` (`operatingCompanyId: ventana`, `salesChannel: RETAIL`, one `SERVICE` line `{kind, ref, qty}`), then five `transitionOpportunity {opportunityId, toStage}` calls: QUALIFYING, SOLUTION, QUOTING, CUSTOMER_REVIEW, DECISION (WON is allowed only from DECISION) | generalManager | verified (traced) |
| 9 | NATIONAL_ACCOUNTS opportunity (S51n) | Commercial `createOpportunity` with `salesChannel: NATIONAL_ACCOUNTS`, same company and Account; stays IDENTIFIED | generalManager | verified (traced); new kind `V-OPP-N` |
| 10 | Agreement (S52), accept (S53), WON + Sales Order (S54) | `createSalesAgreement {opportunityId, ownerEmployeeId, locationId, lines[{kind: SERVICE, ref, businessUnitId: SERVICE, quantity, unitPrice}]}` (company is the Opportunity's; never stated); `acceptSalesAgreement {salesAgreementId}`; `closeOpportunityAsWon {opportunityId}` (returns `salesOrderId`) | generalManager | verified (traced) |
| 11 | Work Order (S55) | Work Order `createWorkOrder` (`/operations/work-orders`): `operatingCompanyId` as the stated context, `customerId`, `locationId`, `workOrderType: SERVICE_CALL`, `priority`, `complaint`, `salesOrderId`, `salesOrderLines: [1]` | generalManager | verified against `b433d396`; **re-confirm after #2200** (skipped unless `--include-reconfirm`) |
| 12 | Inventory (S56) | Supplier PO raise -> approve (another person) -> send -> receive into `ventana-uat-wh-main` | partsManager | **Plan only.** Needs company grants for the raising, approving and receiving Employees **and** a WAREHOUSE operational scope on `ventana-uat-wh-main` (a separate access act beyond the company grants proposed here), plus a SYNTHETIC Ventana supplier and part |
| 13 | Receivable (S57) | `prepareBillingPackage` -> `listObligations` | financeAccounting | **Plan only.** Needs S55 completed by a Ventana technician Principal (OQ-14). Executing it would add a Ventana obligation and so change the protected count (section 4) |
| 14 | Cross-company service (DWO-1) | `authorizeSalesOrderServiceProvider` then a Ventana Work Order linked to the Taylor-selling order | n/a | **Not scripted**: depends on #2200 and on steps 10-11 |

The Commercial chain runs as the **generalManager** persona: it holds a Ventana company-access grant and every capability involved, and as a global holder it passes the channel check for both channels. A step that returns a refusal stops the run.

## 3. Company-access grants (exact list)

Granted through `grantCompanyAuthority`, after a preview and the Owner's approval of its digest:

| Persona | Employee id | Domain it covers |
|---|---|---|
| retailSales | `synthetic-np-emp-retail-sales-a` | Sales (retail channel) |
| serviceManager | `synthetic-np-emp-service-manager` | Service |
| warehouseManager | `synthetic-np-emp-warehouse-manager` | Warehouse (company reach only; a WAREHOUSE scope on a Ventana warehouse is a separate access act) |

**Finance reuses existing reach.** Ventana reach already exists for ownerExecutive, administrator (Finance reach), generalManager and financeAccounting (`synthetic-np-emp-finance-controller`); no Finance grant is proposed and the script refuses one.

**Taylor-only negative controls, never granted, refused by the script's allowlist (`GRANT_TARGET_NEGATIVE_CONTROL`):**

| Persona | Employee id | Why it is the control |
|---|---|---|
| nationalAccountsSales | `synthetic-np-emp-national-accounts-sales` | Sales peer of retailSales in the other channel; must not reach Ventana |
| dispatcher | `synthetic-np-emp-dispatcher` | Service peer of serviceManager |
| partsAssociate | `synthetic-np-emp-parts-associate` | Warehouse/Parts peer of warehouseManager |
| generalEmployee | `synthetic-np-emp-restricted-user` | Zero-capability restricted control |

Any other Employee id is refused `GRANT_TARGET_NOT_ALLOWLISTED`. The grant flow:

1. `node docs/uat/tools/ventana-uat-fixture.mjs --preview --grant <ids>` (read-only; prints `previewOutcome` and `previewDigest` per Employee, writes nothing).
2. The Owner approves each digest.
3. `... --apply --grant <ids> --approve-digest <id>=<digest>,...` commits only digests that still equal the fresh preview (`GRANT_DIGEST_MISMATCH` otherwise; the server recomputes under its lock and refuses `STALE_PREVIEW`). Without an approval the step ends `AWAITING_APPROVAL`, writes nothing and prints the digest.

An identical active grant previews `NO_OP` and is reported `PRESENT`; the actor cannot grant itself.

## 4. Protected receivables

The three existing Ventana intercompany receivables (`eos_finance.obligations`, `operating_company_id = 'ventana'`) are never read-modified, re-keyed, reassigned or mixed with fixtures. With `--preview` and `--apply` the script performs a **read-only** `listObligations {operatingCompanyId: ventana}` as financeAccounting:

- before anything else: the count must equal `protectedObligations.expectedCount` (3) or it stops (`PROTECTED_OBLIGATIONS_COUNT_UNEXPECTED`) before any write;
- after the run (including an early stop): the count and a SHA-256 of the rows' stable fields (`id`, `operatingCompanyId`, `kind`, `currency`, `status`, `sourceDomain`, `sourceRecordId`, `dueOn`, `originatedMinor`, `settledMinor`, `outstandingMinor`; `overdue` excluded as time-derived) must be unchanged or it stops (`PROTECTED_OBLIGATIONS_CHANGED`).

The dry run (offline) prints this check as `PLANNED_NOT_RUN_OFFLINE`. Synthetic Ventana finance fixtures, if ever created, are separate rows; S57 is plan-only so none are created, and executing it requires a deliberate PR that raises `expectedCount`.

## 5. Shared customers and company-owned records

- The fixture Account (F-ACC, `V-ACC`) is a **shared customer record**: the Account has no operating-company column (company is not part of `createAccount`), `lineOfBusiness: VENTANA` only classifies it, and it may be readable across companies under existing Account authorization (`customer.record.read`). A Taylor-only persona seeing it is **not** a defect.
- Every Ventana **Opportunity, Agreement, Sales Order, Work Order and Finance** record is **company-owned**: a persona outside Ventana reads it as nonexistent.
- **Channel inside Ventana (F-OPPN, `V-OPP-N`):** S51 books a RETAIL Opportunity and S51n a NATIONAL_ACCOUNTS Opportunity, both Ventana, on the same Account. Expected: retailSales (granted Ventana, RETAIL-scoped) reaches the RETAIL record and **not** the NATIONAL_ACCOUNTS one; nationalAccountsSales (no Ventana grant) reaches neither; generalManager (global) both. `V-OPP-N` is not in the generated expected-access manifest (the census needed to regenerate it is not in the repository): the controller passes it to Codex as a supplemental case with these expectations.

## 6. The script

`docs/uat/tools/ventana-uat-fixture.mjs` + `ventana-uat-fixture.spec.json` (ordered steps, grant allowlist, negative controls, protected-receivable settings).

| Property | How |
|---|---|
| Dry run, offline | No flag: prints the plan, the grant list, the protected-receivable check plan; sends nothing, reads no credential |
| Read-only preview | `--preview [--grant ids]`: protected-receivable snapshot plus grant previews (outcome, digest); writes nothing |
| Nonprod only | The base URL must equal the registered `platform-sandbox` API in `config/environments.json` exactly; a differing `EOS_API_BASE_URL` or a `taylor-parts` host is refused; the registered URL is passed explicitly to the harness (which #2201 additionally allowlists) |
| Idempotent | `WAREHOUSE_EXISTS` / `EMPLOYEE_ALREADY_EXISTS` report PRESENT; a duplicate grant previews `NO_OP`; Commercial/CRM/Work Order steps carry fixed `ventana-uat-` idempotency keys (a replay returns the same ids) |
| Synthetic | Every free-text field must contain `SYNTHETIC UAT`; ids are prefixed `ventana-uat-`; every company is `ventana`; Taylor data is never read or written |
| Ordered, stop on refusal | First refusal stops the run; `STOPPED_KEY_NOT_BOUND` if the key is missing |
| Skipped by default | `S55` (`--include-reconfirm` after #2200); `S56`, `S57` are plan-only and never run |
| No credential handling | The operator sets `EOS_PERSONA_ISSUER_CREDENTIAL` (name only; never printed). Output is one JSON line per step: step, outcome, code |

Exit codes: 0 = every selected step PLANNED / APPLIED / PRESENT / AWAITING_APPROVAL; 2 = refused, blocked, protected rows changed or unsafe.

## 7. Controller run sequence

1. Merge #2201 (harness allowlist) and this PR. Re-confirm after #2200 for S55.
2. **Human key procedure** (UAT lane) binds `ventana`. Nothing below runs before it.
3. `node docs/uat/tools/ventana-uat-fixture.mjs --grant <the three ids>` (offline dry run).
4. `EOS_PERSONA_ISSUER_CREDENTIAL=... node docs/uat/tools/ventana-uat-fixture.mjs --preview --grant <the three ids>`; check `count: 3` for the protected receivables; hand the three digests to the Owner.
5. After approval: `... --apply --grant <ids> --approve-digest <id>=<digest>,...` (runs S20-S54; S55 is skipped).
6. After #2200 is merged and S55 re-confirmed: `... --apply --only S55 --include-reconfirm`.
7. Confirm the protected receivables printed `unchanged: true`; give Codex the run id and outcome in the preamble.

## 8. Fixture ids the test plan uses

| Fixture | Record kind(s) | Created by |
|---|---|---|
| F-ACC | `V-ACC` (shared customer record) | S50 |
| F-OPP | `V-OPP-R` | S51-S51f |
| F-OPPN | `V-OPP-N` (supplemental, NATIONAL_ACCOUNTS) | S51n |
| F-AGR | `V-AGR-R` | S52-S53 |
| F-ORD | `V-ORD-R` | S54 |
| F-WO | `V-WO` | S55 (after #2200) |
| F-INV | `V-INV` | S56 (plan) |
| F-REC | `V-REC` | S57 (plan) |
| F-NOCO | `X-OPP-NOCO` (company-less Opportunity created by the generalManager persona, no `operatingCompanyId`) | not scripted: one `createOpportunity` without a company by that persona |
| F-XSVC | `X-WO-XSVC` | not scripted (step 14) |

Until a fixture exists the manifest rows that need it report **NOT CONFIGURED**, never FAIL.

## 9. Findings for the controller (not changed here)

- The generated Codex handoff (`codex-handoff/test-plan.md`, `expected-access-manifest.json`, `data/*.csv`, `uatProbes.mjs`) names the bare routes `/crm`, `/commercial`, `/workforce`; they must be `/crm/customer`, `/commercial/sales`, `/workforce/employees` before Codex runs the direct-API probes. Regenerating needs the census file.
- The reconcile CLI lives at `functions/scripts/tenantOperatingCompanyKeyReconcileCli.js` (not `scripts/`), and `functions/test/operatingCompanyBindingPostgres.test.mjs` currently asserts that no `ventana` binding exists; both belong to the human key procedure.
- If the server runs `ADMIN_PREVIEW_MANDATORY=true`, a grant commit without a digest is refused `PREVIEW_REQUIRED`; this script always previews, so it is unaffected.
