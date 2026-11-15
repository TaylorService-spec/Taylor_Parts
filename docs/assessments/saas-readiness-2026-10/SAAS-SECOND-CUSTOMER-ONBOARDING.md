# Second-Customer Onboarding

Issued: 2026-10-11 04:15:00 -0700 (America/Phoenix) · Baseline: `main @ c73ce647` · Status: ASSESSMENT ONLY. The target workflow below is a proposal, not an authorized procedure.

## 1. Today: can a new customer reach operation without a developer?

**No.**

| # | Step | How it is done today | Developer / script / SQL / special deploy? | Evidence |
|---|---|---|---|---|
| 1 | Register / be provisioned | No signup. Operator decision | Operator | — |
| 2 | Create tenant | `functions/scripts/bootstrapEosTenant.mjs --key … --name …` → `tenantBootstrap.ts` (`bootstrapTenant`, `bootstrapAdministrator`, `bootstrapFirstOwner`) | **Operator CLI plus `DATABASE_URL`; refuses production** (no production path exists) | `bootstrapEosTenant.mjs:4,14-15,40-44` |
| 3 | Company profile | Tenant `name` only; settings UI has 2 governed settings (`businessTimeZone`, `defaultLanguage`) | Self-service (limited) | `AdminSystemConfiguration.jsx`; `1764500000000…sql:71-93` |
| 4 | Operating companies | PG: `tenantOperatingCompanyReconcileCli.js` from committed JSON evidence. Firestore: `seedOperatingCompanies.js`. **Runtime constant `OPERATING_COMPANY_IDS {TAYLOR, VENTANA}`** | **Script plus code change** for any new company | `operatingCompanyAuthority.ts:21-24`; `1759968000000…sql:14-16` |
| 5 | Invite employees | No invite flow. `provisionEmployeeAccess.js` (Firestore) / `provisionGovernedPrincipal.js` (PG); `createEmployee`/`linkEmployeePrincipal` exist but "No screen calls them yet" | **Operator script** | `workforceApiClient.js:89-94`; skill `onboard-employee` |
| 6 | Security roles | Administration UI (assign/revoke, object grants, conditions). Baseline grants arrive via SQL migrations and `roleCapabilityAuthorityBaseline.json` (pinned `tenantKey: taylor-nonprod`) | UI for changes; **migration/seed for baseline** | `EmployeeSecurityRoles.jsx`; `adminPolicy/seed/roleCapabilityAuthorityBaseline.json:15` |
| 7 | Operational responsibilities (Job Role, Work Eligibility, Scope) | UI; Job Role catalog via `jobRoleCatalogSeedCli.js` | Catalog by script | `EmployeeJobRoleControl.jsx`, `EmployeeWorkAuthorization.jsx` |
| 8 | Warehouses, locations, trucks, bins | UI create (`createWarehouse`, `createBin`, `createTruck`); company/manager assignment via Owner manifest plus `warehouseAssignmentProvisioningCli.js` | Mixed | `adminPolicyApiClient.js:136-147`; `docs/provisioning/warehouse-assignment-manifest-2026-08-19.json` |
| 9 | Workflows | 3 code-authored seeds (`workflowSeeds.ts`); Builder UI for versions | Seed in code | `adminPolicy/workflowSeeds.ts` |
| 10 | Business modules | Per-environment activation in `config/environments.json` plus `environmentCapabilityOverrides.ts` | **Code/config edit plus redeploy** | `environmentCapabilityOverrides.ts:467-670` |
| 11 | Import customer records | `AdminDataImport.jsx`; **sandbox-only**; CUSTOMERS refused after CRM cutover | **Blocked** | `dataImportCallables.ts:404`; `importTargetGuard.ts:33` |
| 12 | Import inventory and equipment | Same; PARTS/INVENTORY refused; EQUIPMENT on Firestore adapter | **Blocked / inconsistent** | `dataImportCallables.ts:425`; `firestoreDataImportAdapters.ts:336` |
| 13 | Connect email / external systems | `AdminEmailCommunications.jsx` (M365/Google) requires provider app registration, Secret Manager secrets, function deploy; no mailbox bound anywhere; no ERP connector | **Infra/dev** | `docs/deployment/email-provider-setup.md`; `accountingDelivery.ts:12` |
| 14 | Reporting | Saved reports self-service over a fixed code catalog; reporting calendar hardcoded per Taylor/Ventana | Calendar = **code change** | `reportingCalendar.ts:70-78`; `reportCatalog.ts` |
| 15 | Operate without developers | Blocked by steps 2, 4, 5, 10–14; plus environment creation (Firebase project, registry entry, Render service, Vercel env), with production API not yet available | **No** | ADR-011; `render.yaml:30-32` |

**Hardcoded values a second customer would hit:**
- operating-company ids;
- reporting calendar (America/Phoenix);
- `ACCOUNT_LINES_OF_BUSINESS` = TAYLOR/VENTANA;
- shell name "Taylor Freezer of Arizona" (`AppRail.jsx:387`);
- `TAYLOR_WAREHOUSE_ID` in grant deltas;
- Taylor/Ventana ownership semantics in inventory control and rental;
- `taylor-parts` production guards;
- `eos-platform-sandbox` in refresh scripts;
- frozen-dessert equipment display vocabulary.

**Legitimate first-customer items (keep as data or fixtures):**
- `seedTaylorNonprodWorkforce.mjs`;
- Taylor provisioning manifests;
- commercial/CRM migration adapters;
- certification fixtures.

These do not need removal; they need to stop being the only path.

## 2. Proposed workflow: first customer → second customer (Scenario A, dedicated)

**Preconditions:**
- Customer 1 is on the production target platform (C1-OWNER-01 authorized).
- Phase 0 is complete.
- Phase 1 items P1-01, P1-03 to P1-06, P1-08 to P1-14 are complete, and the FX-AUTH-001 OIDC front door is live.

| Stage | Owner of step | Activity | Output / evidence | Automated by |
|---|---|---|---|---|
| 0. Qualify | Verenward commercial | Scope modules, users, operating companies, data sources; security questionnaire | Signed order form; module list; data inventory | — |
| 1. Contract | Owner / counsel | MSA, DPA, SLA, support tier (C1-CONTRACT-01 templates reused) | Executed agreement | — |
| 2. Register | Verenward ops | Create customer in control plane (or register, pre-P2-01): plan, modules, seats, region | Customer record | P2-01 |
| 3. Provision environment | Verenward ops (human-executed production action) | Instantiate production Blueprint for `deployment: <customer>`; registry entry with `role: production`; IdP configuration | Environment live; `/health` green; drift report clean | P1-01, P3-04 |
| 4. Provision tenant | Verenward ops | `provisionTenant`: tenant key/name, first Owner, first Administrator, operating companies, baseline grants, entitlements | Audit events; plan output | P1-08, P1-10, P1-11 |
| 5. Configure | Customer administrator (trained) | Company settings, calendars, lines of business, branding, warehouses/trucks/bins, workflows, roles and grants | Configuration export | P1-04 to P1-06; existing Administration |
| 6. Invite people | Customer administrator | Invite employees; assign Job Role, Security Roles, Work Eligibility, Scopes | Effective Access review per persona (`explainEffectiveAccess`, View as user) | P1-09 |
| 7. Load data | Customer administrator with Verenward support | Import customers, parts, equipment, opening inventory, service history; reconcile exceptions | Import job records; reconciliation report | P1-12 |
| 8. Integrate | Customer IT with Verenward | Bind mailbox (consented OAuth); accounting connector when available | Connection status; first inbound item | existing inbound work; P3-09 |
| 9. Verify | Verenward plus customer | Persona acceptance on customer data; isolation and backup restore proof; monitoring live | Acceptance record; restore evidence | P0-11, P0-12 |
| 10. Train and go live | Customer | Role training (training LAST, per roadmap); support intake live | Go-live authorization by customer and Owner | P2-08, P2-09 |
| 11. Operate | Verenward ops | Fleet releases, drift checks, cost tracking, support | Monthly ops report | P2-10, P2-12 |

**Success criterion (first commercial milestone):** a second customer, ideally from a different industry, completes stages 2–9 with **zero code edits** to customer constants or environment activation code. The only work is configuration and data, every step audited. Rehearse this first with a synthetic customer (P1-17).

## 3. Different-industry second customer: extra considerations

- **Vocabulary:** account lines of business, equipment display, work order types and workflow seeds need tenant configuration (P1-05) and, at scale, industry packages (P4-04).
- **Inventory semantics:** Taylor/Ventana title/custody rules must be expressed as operating-company roles (P1-07) before a single-company customer can use inventory control without Ventana concepts.
- **Rental and finance:** policy profiles are already generic (`finance/financialPolicyProfile.ts`). Strings and the billing default (`financeBillingPolicy.js:4,45`) need configuration.
- **Personas:** the 16-persona foundation is industry-neutral in structure (sales, service, warehouse, finance, administration) and should be reused unchanged. Persona *labels* may need tenant display configuration. That is a presentation change, not an authority change.
