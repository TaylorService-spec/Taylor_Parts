# Persona Foundation — READY evidence (Phase A)

Issued: 2026-09-25 (America/Phoenix) · base `09d63c4e83a13a0df0639276689d7b3750f44b2f` (merge of PR #1969) · lane PA

**Status: PERSONA FOUNDATION COMPLETE.** The Owner declared it complete on 2026-09-25 on the
approved **split cross-environment proof**. This document records that proof and what each part rests on.
This lane ran no live operation, apply or Auth call. Each fact below is labelled with its source.

## Evidence classes

| Label | Meaning |
|---|---|
| **REPO** | Stated in source, config or a fixture at the base commit, or proven by a test run in this lane. |
| **PRIOR-LIVE (date, source)** | A live measurement that someone else took earlier and recorded. The date and the record are named. It was not re-observed here. |
| **OP-RECORD** | Found only in the operator's session record (not in the repository). It is a claim, not an artifact. |
| **NOT OBSERVED IN THIS ENVIRONMENT** | No evidence available to this lane. This does **not** mean the fact is missing. |

We follow the Owner's split-trust-domain ruling. LOCAL holds Firebase Auth, the credential file and the
registry. RENDER/PostgreSQL holds Principal, Employee, the link, Job Role and Security Role. When the
local bootstrap reports `READY 0` or `EMPLOYEE_MISSING`, that means **not observed in that trust
domain**. It is intentional and is not a defect.

The non-secret Phase 1 artifact (`scratchpad/phase1-auth-artifact.json`) was **not present** on this host:
`find /tmp -name 'phase1-auth-artifact*'` returned nothing. So every Auth UID below comes from the
registry, or for reporting, from the OP-RECORD.

## Verdict

**PERSONA_FOUNDATION_COMPLETE_READY_16** — Owner-approved split cross-environment proof.

| Half | Trust domain | What establishes it | Source |
|---|---|---|---|
| **Auth / credential side** | LOCAL: Firebase Auth, the credential file, the registry | 16 canonical identities, 16 credentials, 0 to create, 0 duplicates. Disposition PRESERVE 5 / RESET 10 / CREATE 1. 16/16 sign-in with UIDs matched against the registry and the Admin SDK. | Operator live run, 2026-09-25 (OP-RECORD) |
| **PostgreSQL side** | RENDER / PostgreSQL: Principal, Employee, link, Job Role, Security Role | 16 personas with intended Principal linkage and Employee. `job_roles` = 16. Current Employee → Job Role links = 16, each canonical Employee exactly one. 2C: 13 ASSIGNED / 0 CHANGED / 0 conflicts. 2D–2F: 3 Principals, 3 Employees, 3 links, 3 Job Roles. | Operator live run, 2026-09-25/26 (OP-RECORD); PRIOR-LIVE census 2026-09-24 |
| **Canonical join** | Both | `config/sandboxRoleIdentityRegistry.json`, the reconciliation contract between Auth UID / credential identity and EOS Principal / Employee / Job Role | REPO |
| **Ruled Security Roles** | PostgreSQL | P14 finance-accounting → `accountingManager` only. P15 reporting-analyst → `reportViewer` (effective `reportDefinition.read`). P16 general-employee → no Security Role, no direct grant, no Work Eligibility, no Operational Scope. The rest follow the canonical 16-role catalog. | Owner acceptance record (OP-RECORD) |
| **Authority baseline unchanged** | PostgreSQL | objects 40 · capabilities 79 · role_capabilities 413 · principal_capabilities 0 · migrations 51 | REPO (baseline + 51 migration files) plus OP-RECORD |
| **Structural readiness** | Repo | The 16-role vocabulary matches the registry's 16 `jobRole` values. The #1969 operator and its fail-closed reconciliation guard are merged. 271 unit + 68 PostgreSQL tests pass, 0 failures (§1e). | REPO |

**Persona / credential infrastructure is FROZEN** (Owner ruling). It is reopened only if application or process
acceptance exposes a real defect.

### What the local bootstrap's `READY 0` means

It is an **observation-boundary limitation, not a live readiness failure.** The local bootstrap holds only the LOCAL
trust domain and has no `DATABASE_URL`, so every PostgreSQL-side check reads NOT OBSERVED IN THIS EXECUTION
ENVIRONMENT. The Owner deliberately ruled out any single process holding both trust domains. Readiness is shown
by the two halves above, joined through the registry. It is never shown by one process's READY count. Do not
"fix" `READY 0`.

### Residual evidence notes (recorded, non-blocking)

These are repo-hygiene items. None reopens the foundation.

- The registry's reporting row still reads `uid: null` / `accountExists: false`. The live account exists
  (OP-RECORD UID `Wv5msonPZyXtiy8ZOdJPxlnAboK2`). Until the registry records it, `sandboxPersonaBootstrap.js:366`
  does not compare that UID. Recording it is a protected registry write and needs Owner authorization (proposal P1, §5).
- The header of migration `1762300800000` still says "NOT APPLIED TO NONPROD". The apply is recorded as
  2026-09-25 (proposal P2). The baseline's `deployment` block is stale in the same way.
- Persona fixtures D3–D8 lag the registry (§3, proposal P3).
- Active role-assignment arithmetic: the record shows 44 → 43 against an expected +2. The difference is between
  "active" and "all rows". It does not affect the 16 Job Role links. The optional Q3 read (§4) reconciles it.
- The read-only commands in §4 remain available for any later re-verification. They are not a completion gate.

## 1. What the repo proves

### 1a. The #1969 operator (REPO)

`functions/scripts/administerEmployeeCli.js` at `09d63c4e`:

- `assignEmployeeJobRole` is added to `COMMANDS`. `--jobRoleId` is accepted **only** for that command. Every other command refuses it with `ARGUMENT_NOT_ACCEPTED`.
- The command calls the existing governed writer `lib/eosWorkforce/commands/employeeJobRoleCommands.js`. It is gated on `admin.employeeJobRole.write`, which is **not** `admin.employeeProfile.write`.
- **Reconciliation guard (`assertJobRoleReconcilable`).** It runs before the command, and also on a dry run. It uses the governed read `listEmployeeJobRoleHistory`, which needs `employee.record.read`.

  | Current Job Role | Result |
  |---|---|
  | none | `ASSIGN` |
  | same as requested | `NO_CHANGE` |
  | different | `JOB_ROLE_RECONCILIATION_CONFLICT`, and the command is **never called** |

  A refusal carries only the employeeId, the current Job Role and the requested Job Role. No audit row is written for a refusal.
- The file has no INSERT, UPDATE or DELETE statements. Its only own query is the tenant lookup.

### 1b. Canonical Job Role vocabulary (REPO)

`functions/src/eosWorkforce/jobRoleVocabulary.ts` `CANONICAL_JOB_ROLES` has 16 entries:

`owner-executive, general-manager, office-manager, office-administration, service-manager,
service-coordinator-dispatcher, service-technician, parts-associate, parts-manager, warehouse-associate,
warehouse-manager, retail-sales, national-accounts-sales, finance-accounting, reporting-analyst,
general-employee`

- Six ids are superseded and refused at creation (`JOB_ROLE_ID_SUPERSEDED`): `owner`, `parts-warehouse`, `accounting`, `administrator`, `dispatcher`, `finance-manager`.
- The registry's 16 `roles[].jobRole` values equal this set exactly, one role per key.

### 1c. Registry (REPO)

`config/sandboxRoleIdentityRegistry.json`:

- 16 canonical roles and 15 noncanonical addresses (retained, never adopted).
- Dispositions: 5 PRESERVE, 10 RESET_EXISTING_SANDBOX_PASSWORD, 1 CREATE_AUTH_ACCOUNT (`reportingAnalyst`).
- `ownerAdminSplit`: Admin Principal `639c1970-dbdb-4bc0-af7c-118559151e2f`, Owner Principal `dca03ad1-9278-49e6-b4f9-d09d3f587dc4`.

### 1d. Authority baseline (REPO)

- `functions/lib/adminPolicy/seed/roleCapabilityAuthorityBaseline.json` records `totalGrants 413`. The repo has 51 migration files.
- This agrees with the claimed live figures of 413 role_capabilities and 51 migrations. Those live figures are PRIOR-LIVE 2026-09-25 (Phase 3 apply, OP-RECORD).

### 1e. Tests run in this lane

Setup: ran `npm ci && npm run build` in `functions/`. The PG suites used `POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55432/pa_policy`, one at a time. We did not run `effectiveAccessFeed`, any `*Emulator` suite, `employeeBusinessAuthorityMigration` or `employeeReferenceIntegrityMeasurement`.

| Suite | Pass / Fail |
|---|---|
| canonicalJobRoleVocabulary | 23 / 0 |
| employeeAdministrationCommand | 15 / 0 |
| sandboxRoleIdentityRegistry | 28 / 0 |
| personaAuthorityDimensions | 58 / 0 |
| personaE2EHarness | 33 / 0 |
| personaSuiteRegistration | 5 / 0 |
| sandboxPersonaBootstrapApply | 17 / 0 |
| sampleCompanyManifest | 85 / 0 |
| technicianIdentityTrap | 7 / 0 |
| **unit subtotal** | **271 / 0** |
| employeeJobRoleOperatorPostgres (PG) | 14 / 0 — includes R (absent→ASSIGN, same→NO_CHANGE, different→CONFLICT, command never called) and R4 (a partial rerun over mixed state is safe) |
| employeeAdministrationCommandPostgres (PG) | 16 / 0 |
| employeeJobRolePostgres (PG) | 12 / 0 |
| personaBusinessAccessRegression (PG) | 26 / 0 |
| **PG subtotal** | **68 / 0** |

## 2. The 16-row persona table

Each dimension is kept separate. **Credential** means the Auth email only. No password was read or
printed, and the credential file was not opened.

**Source keys used in the table:**

| Key | Source |
|---|---|
| **R** | REPO: `config/sandboxRoleIdentityRegistry.json` |
| **V** | REPO: `jobRoleVocabulary.ts` |
| **C** | PRIOR-LIVE 2026-09-24: `functions/scripts/fixtures/personaBusinessConnectionCensus.v1.json` (live census in the repo) |
| **D** | REPO declared target: `functions/scripts/fixtures/personaAuthorityDimensions.v1.json` |
| **S** | REPO: `personaE2EScenarios.v1.json` `personaAuthorityFixtures`, "as of 2026-09-23" |
| **OP** | OP-RECORD (memory, 2026-09-25/26) |
| **P3** | PRIOR-LIVE 2026-09-25: Phase 3 apply (OP-RECORD) |
| **—** | NOT OBSERVED IN THIS ENVIRONMENT |

**Job Role column.** The Job Role *id* is REPO (R+V). Whether the live assignment exists is **OP only for all 16 rows**. (Established by the operator's PostgreSQL-side run; see Verdict.)

**Security Role column.** Unless noted otherwise, the role is recorded as held live, and no row reflects the post-split state.

| # | Persona key | Job Role (id) | Credential email | Auth UID | Principal id | Employee id | Security Role(s) | Work Eligibility | Operational Scope |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ownerExecutive | owner-executive (R,V; assignment OP) | eos-owner@sandbox.invalid (R) | ajXZSa0gTcWAyDHVSsVifwZfNRf1 (R) | dca03ad1-9278-49e6-b4f9-d09d3f587dc4 (R) | synthetic-np-emp-owner-executive (R; relink to owner OP) | owner (scenarios canonicalPersonas; C shows `owner` on the authority-side Principal) | none (D withheld: "administrative principal proof") | REORDER_QUEUE:taylor (S, migration-derived — but S lists it under the pre-split `admin` row); current: — |
| 2 | administrator | office-administration (R,V; OP) | admin@sandbox.invalid (R) | ZVu3lHTP1NQhj0Am04zTAGou0dx1 (R) | 639c1970-dbdb-4bc0-af7c-118559151e2f (R, C) | synthetic-np-emp-administrator (R declared; created OP) | admin (C, plus 3 disabled zz_nonprod_acceptance) | none declared (D) | none declared (D) |
| 3 | generalManager | general-manager (R,V; OP) | bailey.fixture@sandbox.invalid (R) | xiyAcX4UQEQRRqbMRrIXv3LwWVi2 (R) | 98fbb1ee-4998-4082-adea-bf94fa82f4c8 (C) | synthetic-np-emp-general-manager (R, C) | generalManager (C) | none (C "by design") | none (C) |
| 4 | officeManager | office-manager (R,V; OP) | casey.fixture@sandbox.invalid (R) | Trvw2vp0yhd2SnXOfZvDUAcv6Aj2 (R, C externalSubject) | a358c615-c65a-49ea-977d-9dc9b12785cb (C) | synthetic-np-emp-office-manager (R, C) | officeManager (C) | none declared (D, S) | none declared (D, S) |
| 5 | serviceManager | service-manager (R,V; OP) | devon.fixture@sandbox.invalid (R) | oQPfzG2AUgWOo8Tm0LJvurj8dXi2 (R) | 45b60e4f-f20f-4915-b9bb-17f851072aa4 (C) | synthetic-np-emp-service-manager (R, C) | fieldManager (C) | none (C) | none (C) |
| 6 | dispatcher | service-coordinator-dispatcher (R,V; OP) | dispatcher@sandbox.invalid (R) | PEiRkebIGRPcEau7yBBV0D77Dho1 (R) | 18e54b1f-05e1-402d-8982-66efc8393f05 (C) | synthetic-np-emp-dispatcher (R, C) | dispatcher (C) | none (C: "ZERO Work Eligibility rows"; D withheld) | **CONFLICT** — see note 1 |
| 7 | serviceTechnician | service-technician (R,V; OP) | finley.fixture@sandbox.invalid (R) | i4EYSBGPXPM8lweuhI5a5y2TRgH3 (R) | 97652f09-07bf-48e8-90b9-f321a01fe10d (C, P06) | synthetic-np-emp-service-technician-a (R, C) | technician (C) | SERVICE_TECHNICIAN (D, S) | none (D withheld REORDER_QUEUE) |
| 8 | partsAssociate | parts-associate (R,V; OP) | logan.fixture@sandbox.invalid (R) | Ap6MRSs1gKW5lQtN4lTZOaecHgu1 (R) | 29ec481c-51a6-468f-831e-5f84308bad0d (C) | synthetic-np-emp-parts-associate (R, C) | partsAssociate, inventoryReceivingClerk (C) | PARTS_OPERATIONS (C "eligibility live"; D, S) | **CONFLICT** — see note 1 |
| 9 | partsManager | parts-manager (R,V; OP) | kai.fixture@sandbox.invalid (R) | p9zXxj5SJiOAwbSoFcKriaQ8NGt1 (R) | 68ab4dec-5922-4d0c-954c-5161befe3bd8 (C) | synthetic-np-emp-parts-manager (R, C) | partsManager, purchasingManager (C) | PARTS_OPERATIONS (D, S) | **CONFLICT** — see note 1 |
| 10 | warehouseAssociate | warehouse-associate (R,V; OP) | noor.fixture@sandbox.invalid (R) | cgVnRUMA2Sc7WxHl1lgTmbQAhwG2 (R) | 65a269d9-86f8-4c7a-b974-436dd6779bbf (C) | synthetic-np-emp-warehouse-associate (R, C) | warehouseAssociate, inventoryCycleCountCounter (C) + inventoryPutAwayOperator (P3) | WAREHOUSE_OPERATIONS (C, D, S) | WAREHOUSE:SC-WH-MAIN (D, S; SC-WH-SERVICE withheld) |
| 11 | warehouseManager | warehouse-manager (R,V; OP) | morgan.fixture@sandbox.invalid (R) | 0KBdhU9Z8Yc4aTQqXHODEP1jeHf1 (R) | 00e45827-043a-484f-b150-0d8502e8e39f (C) | synthetic-np-emp-warehouse-manager (R, C) | warehouseManager, inventoryCycleCountReconciler, inventoryBinAdministrator (C) | WAREHOUSE_OPERATIONS (D, S) | WAREHOUSE:SC-WH-MAIN, WAREHOUSE:SC-WH-SERVICE (D, S) |
| 12 | retailSales | retail-sales (R,V; OP) | harper.fixture@sandbox.invalid (R) | 4OVJwVRisyOlgBQDkjA75rs7djm2 (R) | c117537e-21ac-43e7-a210-b6cfa5323ed6 (C, "primary") | synthetic-np-emp-retail-sales-a (R) | salesperson (S; C) | none (D, S) | none (D, S) |
| 13 | nationalAccountsSales | national-accounts-sales (R,V; OP) | jules.fixture@sandbox.invalid (R) | zpfYS0PKUJOwVbskY1WjUreWqg72 (R) | da330746-66c5-4d99-ba94-57f3d241a814 (C) | synthetic-np-emp-national-accounts-sales (R, C) | salesperson (C) | none (D, S) | none (D, S) |
| 14 | financeAccounting | finance-accounting (R,V; OP) | acctmgr@sandbox.invalid (R) | anKfqN34GSS1RKCgF00nWTse6062 (R) | `4db54637…` (OP only; no repo record) | synthetic-np-emp-finance-controller (R) | **CONFLICT**: R expects `accountingManager`; the scenarios fixture says `controller`; OP says accountingManager was assigned. Live: — | none declared (D) | none declared (D) |
| 15 | reportingAnalyst | reporting-analyst (R,V; OP) | reporting@sandbox.invalid (R) | **CONFLICT**: R says `null` / accountExists:false; OP says `Wv5msonPZyXtiy8ZOdJPxlnAboK2` (created 2026-09-25). Current: — | `8bd1a99e…` (OP only) | synthetic-np-emp-report-analyst (R) | R expects `reportViewer`; the scenarios fixture says `[]` and BLOCKED; OP says assigned. Live: — | none declared (D) | none declared (D) |
| 16 | generalEmployee | general-employee (R,V; OP) | restricted@sandbox.invalid (R) | lT75guU9mEY46QFQcegWRZRhYBi2 (R) | `0e0a0a89…` (OP only) | synthetic-np-emp-restricted-user (R) | **CONFLICT**: R expects `[]` and forbids `generalEmployee`; the scenarios fixture says `generalEmployee`. OP says none. Live: — | none declared (D) | none declared (D) |

**Note 1: Operational Scope conflict for dispatcher, parts-associate and parts-manager.**

| Source | What it says |
|---|---|
| D (declared target) | `REORDER_QUEUE:sample-co-synthetic` for dispatcher, parts-associate and parts-manager. This depends on the prerequisite `OPERATING_COMPANY_KEY_BINDING_REQUIRED`. |
| S | Parts-associate: none, with the scope marked `declaredButBlocked`. Dispatcher and parts-manager: `REORDER_QUEUE:taylor (migration-derived)`, with `sample-co-synthetic` marked `declaredButBlocked`. |
| C | Parts-associate: "scope deliberately withheld". Dispatcher: "one REORDER_QUEUE scope". |
| OP (vocabulary memory) | "6 scope rows applied". |

These cannot all be true. Only a current read settles it (§4, query Q7).

## 3. Drift found (repo vs claimed live state)

| # | Artifact | What it says | Claimed live state | Consequence |
|---|---|---|---|---|
| D1 | `config/sandboxRoleIdentityRegistry.json` → `reportingAnalyst` | `uid: null`, `accountExists: false`, `credentialDisposition: CREATE_AUTH_ACCOUNT`, plus `reason` and `operatorAction` saying the account is not yet created. Top-level `confirmedBy` says "15 of 16". `applyPhases.1` says "only reporting@ does not". | The account exists with uid `Wv5msonPZyXtiy8ZOdJPxlnAboK2` (OP 2026-09-25). | **Two hazards.** (a) `sandboxPersonaBootstrap` guards the UID only when `r.uid` is set (`if (account && r.uid && account.uid !== r.uid)`, line 366), so **the reporting UID is unguarded**. (b) The non-`--live` dry run builds observations from `accountExists` and still reports reporting as "1 to create". The bootstrap's own comment warns this is "the most dangerous possible misreading of a dry run". |
| D2 | `functions/migrations/1762300800000_authority-activation-and-reporting-read.sql`, lines 119–121 | "THIS MIGRATION HAS NOT BEEN APPLIED TO NONPROD" | Applied 2026-09-25 08:48:41 UTC with all 8 guards passing: capabilities 79, role_capabilities 413, objects 40, migrations 51 (P3). | Misleading to readers only. There is no checksum, and no test reads this text (checked). |
| D3 | `personaE2EScenarios.v1.json` `canonicalPersonas[14]` (finance) | `securityRoles: ["controller"]` | Registry and OP: `accountingManager` | This fixture disagrees with the registry's Owner-ruled expectation. |
| D4 | same, `[15]` (reporting) | `disposition: BLOCKED`, `securityRoles: []`, `liveInNonprod: false`, blocked by `REPORTING_CAPABILITY_VOCABULARY_ABSENT` | Migration 1762300800000 registered `reportDefinition.read` for reportViewer. The registry expects `reportViewer`. OP: Principal created. | Stale. The blocker named was cleared by Reporting Slice 1. |
| D5 | same, `[16]` (restricted) | `securityRoles: ["generalEmployee"]`, `liveInNonprod: false`, and "shares the OFFICE_MANAGER Job Role" | Registry: `expectedSecurityRoles: []`, `forbiddenSecurityRoles: ["generalEmployee"]`, Job Role `general-employee` | **Direct contradiction** with the registry. The Job Role statement also predates the 16-key ruling. |
| D6 | same, `canonicalPersonas` population | 17 entries: includes technician-b and a MERGED Purchasing row; no office-manager canonical row | Registry: 16 canonical roles | Two different population definitions. |
| D7 | same, `personaAuthorityFixtures.rows[owner-executive]` | `securityRoles: ["admin"]` | After the split the owner Employee is linked to the `owner` Principal (OP) | Pre-split and stale (dated 2026-09-23). |
| D8 | `personaAuthorityDimensions.v1.json` `dimensions[jobRole]` | "NONE IN POSTGRESQL (EMP-RT-08). Manifest metadata only." | `eos_workforce.job_roles` holds 16 (OP) | Stale description of where the authority lives. |
| D9 | `jobRoleVocabulary.ts` header | "job_roles holds 0 rows in nonprod (measured 2026-09-24)" | 16 (OP) | A dated measurement. It is correct as history and should not be read as current. |
| D10 | Tests pin D1 | `sandboxCredentialOperations.test.mjs:403-431` pins 5/10/1 and "the CREATE role has … `uid` null". `sandboxRoleIdentityRegistry.test.mjs:533-534` pins `notActivatable` including reportingAnalyst and 15 accounts. `sandboxPersonaBootstrapApply.test.mjs:57-62,221` models reporting as absent. | — | **Fixing D1 means changing these tests too.** Because the bootstrap and its tests are FROZEN infrastructure, this is an integration/Owner decision, not a data-only edit. |

## 4. Prepared read-only operator commands (NOT run by this lane)

### 4a. Nonprod PostgreSQL (Render Shell on `eos-api-nonprod`, trust domain RENDER/PG)

**Existing governed tool.** It is read-only and every statement runs inside `SET TRANSACTION READ ONLY`:

```sh
node scripts/measureWorkforceActivation.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL
```

Expected: 21 employees and 33 principals.

**The Job Role and count read.** Nothing in the repo reports this, so here it is as a read-only session. The database refuses any write:

```sh
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
-- Q1 authority counts. Expect 40 | 79 | 413 | 0 | 51
SELECT (SELECT count(*) FROM eos_policy.objects)               AS objects,
       (SELECT count(*) FROM eos_policy.capabilities)          AS capabilities,
       (SELECT count(*) FROM eos_policy.role_capabilities)     AS role_capabilities,
       (SELECT count(*) FROM eos_policy.principal_capabilities) AS principal_capabilities,
       (SELECT count(*) FROM public.pgmigrations)              AS migrations;
-- Q2 workforce counts. Expect 16 | 16 | 21 | 33
SELECT (SELECT count(*) FROM eos_workforce.job_roles) AS job_roles,
       (SELECT count(*) FROM eos_workforce.employee_job_role_assignments WHERE effective_to IS NULL) AS current_job_roles,
       (SELECT count(*) FROM eos_workforce.employees) AS employees,
       (SELECT count(*) FROM eos_policy.principals)   AS principals;
-- Q3 role assignments. Reconciles the 43 / 44 / 46 arithmetic (optional; non-blocking)
SELECT status::text, count(*) FROM eos_policy.user_role_assignments GROUP BY 1 ORDER BY 1;
-- Q4 the chain per canonical Employee: Principal, provider, subject, current Job Role.
-- Expect 16 rows, each with exactly one Job Role equal to the registry's.
WITH canon(emp) AS (VALUES ('synthetic-np-emp-owner-executive'),('synthetic-np-emp-administrator'),
  ('synthetic-np-emp-general-manager'),('synthetic-np-emp-office-manager'),('synthetic-np-emp-service-manager'),
  ('synthetic-np-emp-dispatcher'),('synthetic-np-emp-service-technician-a'),('synthetic-np-emp-parts-associate'),
  ('synthetic-np-emp-parts-manager'),('synthetic-np-emp-warehouse-associate'),('synthetic-np-emp-warehouse-manager'),
  ('synthetic-np-emp-retail-sales-a'),('synthetic-np-emp-national-accounts-sales'),('synthetic-np-emp-finance-controller'),
  ('synthetic-np-emp-report-analyst'),('synthetic-np-emp-restricted-user'))
SELECT c.emp, l.principal_id, p.identity_provider, p.external_subject, p.status::text AS principal_status,
       (SELECT string_agg(j.job_role_id, ',') FROM eos_workforce.employee_job_role_assignments j
         WHERE j.employee_id = c.emp AND j.effective_to IS NULL) AS current_job_role
  FROM canon c
  LEFT JOIN eos_policy.employee_principal_links l ON l.employee_id = c.emp AND l.status = 'active'
  LEFT JOIN eos_policy.principals p ON p.id = l.principal_id
 ORDER BY c.emp;
-- Q5 Employees with more than one current Job Role. Expect 0 rows
SELECT employee_id, count(*) FROM eos_workforce.employee_job_role_assignments
 WHERE effective_to IS NULL GROUP BY 1 HAVING count(*) > 1;
-- Q6 active Security Roles per canonical Principal. Expect restricted = none; finance = accountingManager; reporting = reportViewer
SELECT l.employee_id, string_agg(r.key, ',' ORDER BY r.key) AS security_roles
  FROM eos_policy.employee_principal_links l
  JOIN eos_policy.user_role_assignments a ON a.principal_uid = l.principal_id AND a.status::text = 'active'
  JOIN eos_policy.roles r ON r.id = a.role_id
 WHERE l.status = 'active' AND l.employee_id LIKE 'synthetic-np-emp-%'
 GROUP BY 1 ORDER BY 1;
-- Q7 current Work Eligibility and Operational Scope. Settles note 1
SELECT 'WE' AS kind, employee_id, qualification_code AS value FROM eos_workforce.employee_work_eligibility WHERE effective_to IS NULL
UNION ALL
SELECT 'OS', employee_id, scope_type || ':' || scope_id FROM eos_workforce.employee_operational_scopes WHERE effective_to IS NULL
 ORDER BY 2, 1, 3;
SQL
```

If `psql` is not on the Render image, run the same statements through `node -e` with `pg`, passing `options: '-c default_transaction_read_only=on'` (the pattern `roleAssignmentCensusCli.js` uses). If Q1–Q2 differ from the expected values, **stop**. Do not repair anything.

### 4b. Firebase Auth (operator workstation, trust domain LOCAL, nonprod ADC, never the production keys)

```sh
cd functions
SANDBOX_CREDENTIALS_FILE=/mnt/c/Users/Rudy2/Favorites/Downloads/sandbox-credentials.local.json \
  node scripts/sandboxPersonaBootstrap.js --project eos-platform-sandbox --live
```

This command is a dry run only; `--apply` is refused by the CLI. It performs an Admin lookup for each canonical address and reads only the credential file's key names.

Expected output:

- `accountsPresent 16`, `accountsToCreate 0`.
- No `AUTH_UID_MISMATCH` among the 15 roles whose UID is recorded.
- The reporting row shows `observedUid Wv5msonPZyXtiy8ZOdJPxlnAboK2` with `registryUid null`. That is D1, and it is unguarded.
- `credential source: PRESENT entries=72`.
- `READY 0` or `EMPLOYEE_MISSING` / `JOB_ROLE_CATALOG_MISSING`. This is **expected and intentional** (split trust domains). **Do not fix it.**

The 16/16 *sign-in* proof cannot be produced by a read-only command, because it needs the passwords. It remains OP-RECORD unless the operator re-runs the Phase 1 sign-in verification. That verification only signs in; it does not rotate anything.

## 5. Proposed corrections (NOT applied — integration-owned and frozen surfaces)

### P1. Registry reporting row (`config/sandboxRoleIdentityRegistry.json`)

Apply only after §4b confirms the UID. The recommended disposition is **PRESERVE**: the account now exists and its password is working, so any re-run must never rotate or recreate it.

```diff
@@ "confirmedBy"
-  "confirmedBy": "Authoritative Firebase Admin SDK lookup against eos-platform-sandbox via ADC, 2026-09-25. 15 of 16 accounts exist; reporting@sandbox.invalid does not.",
+  "confirmedBy": "Authoritative Firebase Admin SDK lookup against eos-platform-sandbox via ADC, 2026-09-25. 15 of 16 accounts existed; reporting@sandbox.invalid was then created by Phase 1 (2026-09-25) and all 16 now exist.",
@@ roles[key=reportingAnalyst]
       "authEmail": "reporting@sandbox.invalid",
-      "uid": null,
-      "accountExists": false,
+      "uid": "Wv5msonPZyXtiy8ZOdJPxlnAboK2",
+      "accountExists": true,
       "sampleCompanyEmployee": "report-analyst",
-      "reason": "ACCOUNT_NOT_CREATED_YET: an authoritative Firebase Admin SDK enumeration of eos-platform-sandbox on 2026-09-25 found 28 @sandbox.invalid accounts and no reporting address among them. It is the only canonical role whose account does not exist.",
-      "operatorAction": "Run sandboxPersonaBootstrap after merge and deploy; it creates exactly ONE account for reporting@sandbox.invalid and then activates its credential through the existing activateMissingSandboxPasswords. Do not create a second reporting-shaped account and do not point this key at a substitute. NOTE the authority gap is separate and unchanged: reportViewer, reportFinanceViewer and reportAuthor each resolve to ZERO role_capabilities in nonprod, so a holder measures nothing until those grants exist.",
+      "$comment": "CREATED 2026-09-25 by Phase 1 (the ONE CREATE_AUTH_ACCOUNT of the ruling); now PRESERVE. Never recreate, never rotate. The uid is recorded so the bootstrap's AUTH_UID_MISMATCH guard covers this role like the other fifteen.",
       "phase": 5,
       "expectedSecurityRoles": [
         "reportViewer"
       ],
       "expectedEmployeeId": "synthetic-np-emp-report-analyst",
-      "credentialDisposition": "CREATE_AUTH_ACCOUNT"
+      "credentialDisposition": "PRESERVE"
@@ applyPhases.1.action
-      "action": "Ensure exactly one PASSWORDLESS sandbox Auth account per canonical role. Reuse every existing account; create only a genuinely missing one. Measured 2026-09-25: 15 exist, only reporting@sandbox.invalid does not."
+      "action": "Ensure exactly one PASSWORDLESS sandbox Auth account per canonical role. Reuse every existing account; create only a genuinely missing one. Measured 2026-09-25: 15 existed; reporting@sandbox.invalid was created by Phase 1 the same day, so all 16 exist."
```

`credentialDispositions.expectedFinalState` (`preserved 5, rotated 10, created 1`) records the Phase 1 *plan outcome*. Leave it unchanged as history, or add `"current": {"preserve": 6, "reset": 10, "create": 0}`.

**Coupled test changes (must land in the same PR).** These are frozen suites, so the Owner or integration must authorize them:

- `sandboxCredentialOperations.test.mjs:403-431`: PRESERVE becomes 6 (add `reportingAnalyst`). The `CREATE_AUTH_ACCOUNT` bucket becomes absent. The "CREATE role has neither" loop stays valid vacuously.
- `sandboxRoleIdentityRegistry.test.mjs:533-534`: check whether `activatableByThisManifest` changes for reporting. Expect 16 accounts. Also recheck the `toCreate` expectation at 405-411, which asserts `["reportingAnalyst"]`.
- `sandboxPersonaBootstrapApply.test.mjs:57-62,221`: the fixtures model reporting as absent. Either keep that as a synthetic historical scenario by constructing the absence explicitly, or update it.

**Lower-risk alternative if the freeze forbids touching tests:** set `uid` only, with `accountExists` left false. **Not recommended.** It is still wrong about `accountExists`, and `sandboxCredentialOperations.test.mjs:429` (`uid === null` for CREATE) would fail anyway.

### P2. Migration header note (`functions/migrations/1762300800000_authority-activation-and-reporting-read.sql`)

This is a comment-only edit. No tooling checksums migration files and no test reads this text (grep-verified). node-pg-migrate records the migration by name, so the edit does not re-run anything.

```diff
--- Nonprod before: capabilities 76, objects 39, role_capabilities 387, principal_capabilities 0,
--- migrations 50. THIS MIGRATION HAS NOT BEEN APPLIED TO NONPROD; every proof was run against a
--- disposable local database.
+-- Nonprod before: capabilities 76, objects 39, role_capabilities 387, principal_capabilities 0,
+-- migrations 50. At authoring time this migration had not been applied to nonprod and every proof
+-- was run against a disposable local database. APPLIED TO NONPROD 2026-09-25 08:48:41 UTC (PR #1966,
+-- merge 11668e53, Render dep-dar3abavcj2c739vmf0g); all 8 guards passed; nonprod after: capabilities
+-- 79, objects 40, role_capabilities 413, principal_capabilities 0, migrations 51.
```

### P3. Fixture drift D3–D8 (recommendation only)

Get an Owner decision on whether `personaE2EScenarios.v1.json` and `personaAuthorityDimensions.v1.json` should be brought in line with the registry, or marked superseded-by-registry. At minimum:

- finance → `accountingManager`
- reporting → no longer BLOCKED
- restricted → `[]` Security Roles and Job Role `general-employee`
- owner row → post-split

Several suites (`personaE2EHarness`, `personaAuthorityDimensions`) pin these fixtures, so this is a separate reviewed change.

## 6. What this lane did not do

It made no live read or write. It did not call Firebase Auth or open the credential file. It did not edit the registry, the bootstrap, loaders, persona fixtures or migrations. It ran no apply. The only artifact committed is this document.
