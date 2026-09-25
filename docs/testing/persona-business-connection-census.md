---
artifact_type: measurement
unit: LANE BE — persona business-connection census (P01–P16)
gate: read-only measurement — no identity mutation, no provisioning, no deployment
status: Measured 2026-09-24 against live nonprod and repo baseline b6a36b15
baseline: b6a36b15 (origin/main)
live_target: dpg-dah48qht0dsc73egnml0-a (eos-api-nonprod · tenant taylor-nonprod · platform-sandbox)
authorizes: nothing — no Employee creation, no Principal creation, no Role grant, no credential activation
machine_readable: functions/scripts/fixtures/personaBusinessConnectionCensus.v1.json
---

# Persona business-connection census

One canonical record of how every required persona is represented **today**, with
repository declaration and live nonprod kept apart. This document **authorizes
nothing** and changes nothing. No credential value, length or derivative appears
anywhere in it.

**Disposition states:** `VERIFIED` · `REPO_DECLARED_NOT_LIVE_VERIFIED` ·
`MISSING` · `STALE` · `BLOCKED_MEASUREMENT`.

---

## 1. Enumeration method

Six independent enumerations, unioned, each closed by an arithmetic residue
check — so a missed persona surfaces as an **unaccounted row**, not as silence.

| # | Enumeration | Source | Count |
|---|---|---|---|
| E1 | Owner-given target population | the lane brief | 16 (P01–P16) |
| E2 | Repository Employee declaration | `functions/scripts/fixtures/sampleCompany.v2.json` `employees[]` | 17 (+12 `jobRoles[]`, 15 `principals[]`) |
| E3 | Repository credential namespace | `scripts/sandboxCredentials.mjs` `SANDBOX_PERSONAS` | 13 keys |
| E4 | Live employee-driven join | `eos_workforce.employees` LEFT JOIN `eos_policy.employee_principal_links` LEFT JOIN `eos_policy.principals` LEFT JOIN `eos_policy.tenant_memberships`, with a correlated role-key aggregate | 17 employees → 31 rows |
| E5 | Live identity-driven complement | `eos_policy.principals WHERE NOT EXISTS (employee_principal_links)` | 1 |
| E6 | Live Role-catalog sweep | all `eos_policy.roles` with holder counts and `role_capabilities` counts | 49 |

E4 and E5 are **exact complements**, so every Principal appears in one or the
other. E4 uses LEFT joins, so an Employee with no identity still appears.

**Residue checks (all clean):**

- Principals: 15 active-link + 14 revoked-link + 1 unlinked = **30** = `count(*) principals`.
- Employees: 15 linked + 2 unlinked = **17** = `count(*) employees`.
- Role assignments: 40 active (attributed persona-by-persona below) + 3 disabled `zz_nonprod_acceptance` = **43** = `count(*) user_role_assignments`.
- Memberships: 16 active + 14 disabled = **30**; principals with no membership = **0**.
- Work eligibility **7** rows and operational scopes **6** rows, all open, each attributed.
- Record assignments: **1** `work_order_assignments` row (attributed to P06), **0** `reorder_request_assignments`.
- All 17 declared Employees appear either in a P-slot or in §7.

**A missed persona would show up** as an `employees` row with no P-slot and no §7
entry, or as an active `user_role_assignments` row that breaks the 40 + 3 = 43 check.

### Live baseline (verified, not assumed)

```
tenants 1 · capabilities 76 · role_capabilities 387 · principal_capabilities 0 · roles 49
principals 30 (firebase 16 / eos-synthetic-nonprod 14) · memberships 30 (16 active / 14 disabled)
user_role_assignments 43 (40 active / 3 disabled) · employee_principal_links 29 (15 active / 14 revoked)
employees 17 (15 ACTIVE / 1 CONTRACTOR / 1 ON_LEAVE)
employee_work_eligibility 7 · employee_operational_scopes 6
eos_ops: work_orders 13 · work_order_assignments 1 · reorder_requests 2 · rr_assignments 0 · parts 0 · warehouses 2
eos_commercial: opportunities 0 · sales_agreements 0 · sales_orders 0 · eos_crm.accounts 3
```

Every prior held count (76 / 387 / 0 / 30 / 43 / 29) **confirmed unchanged.**

### Job Role has no PostgreSQL authority

`information_schema` shows **no** `eos_workforce.employee_job_roles` table and
**no** job-role column on `eos_workforce.employees`. Every Job Role fact below —
including the Retail Sales vs National Accounts Sales distinction the Owner
requires be preserved — is therefore `REPO_DECLARED_NOT_LIVE_VERIFIED`.

---

## 2. Persona census, P01–P16

Provider is `firebase` for every live Principal. Every external subject is
**VERIFIED** from `eos_policy.principals`; every authentication **email** is
**REPO_DECLARED** (the uid↔email binding is `BLOCKED_MEASUREMENT` — §8).

| Slot | Persona key | Auth email | External subject | Principal id | P/M | Employee | Emp status | Job Role | Security Roles | Work Elig. | Op. Scopes | Login | Loader | Disp. | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **P01a** Owner authority | (rebound `synthetic-np-principal-owner`) | `eos-owner@sandbox.invalid` | `ajXZSa0gTcWAyDHVSsVifwZfNRf1` | `dca03ad1-9278-49e6-b4f9-d09d3f587dc4` | active/active | **none** | — | **none** | `owner` (47 caps) | — | — | no | no | VERIFIED | SECURITY_ROLE_DEFECT · EMPLOYEE_CONTEXT_DEFECT |
| **P01b** Owner/Exec Employee | `owner-executive` | `avery.fixture@sandbox.invalid` | `ZVu3lHTP1NQhj0Am04zTAGou0dx1` | `639c1970-dbdb-4bc0-af7c-118559151e2f` | active/active | `synthetic-np-emp-owner-executive` | ACTIVE | `OWNER_EXECUTIVE` | `admin` (66 caps) + 3× `zz_nonprod_acceptance` (disabled, 0 caps) | none | `REORDER_QUEUE:taylor` | no | no | VERIFIED | SECURITY_ROLE_DEFECT · CREDENTIAL_CATALOG_DEFECT |
| **P02** Administrator | **MERGED into P01b** | `avery.fixture@sandbox.invalid` | `ZVu3lHTP1NQhj0Am04zTAGou0dx1` | `639c1970-…` | active/active | `synthetic-np-emp-owner-executive` | ACTIVE | `OWNER_EXECUTIVE` | `admin` | none | `REORDER_QUEUE:taylor` | no | no | VERIFIED | CREDENTIAL_CATALOG_DEFECT |
| **P03** General Manager | `general-manager` | `bailey.fixture@sandbox.invalid` | `xiyAcX4UQEQRRqbMRrIXv3LwWVi2` | `98fbb1ee-4998-4082-adea-bf94fa82f4c8` | active/active | `synthetic-np-emp-general-manager` | ACTIVE | `GENERAL_MANAGER` | `generalManager` (31) | none | none | no | **no key at all** | VERIFIED | CREDENTIAL_CATALOG_DEFECT |
| **P04** Service Manager | `service-manager` | `devon.fixture@sandbox.invalid` | `oQPfzG2AUgWOo8Tm0LJvurj8dXi2` | `45b60e4f-f20f-4915-b9bb-17f851072aa4` | active/active | `synthetic-np-emp-service-manager` | ACTIVE | `SERVICE_MANAGER` | `fieldManager` (13) | none | none | no | key `fieldManager` → **other identity** | VERIFIED | CREDENTIAL_CATALOG_DEFECT |
| **P05** Dispatcher | `dispatcher` | `emerson.fixture@sandbox.invalid` | `PEiRkebIGRPcEau7yBBV0D77Dho1` | `18e54b1f-05e1-402d-8982-66efc8393f05` | active/active | `synthetic-np-emp-dispatcher` | ACTIVE | `DISPATCHER` | `dispatcher` (29) | **none** | `REORDER_QUEUE:taylor` | no | key → **other identity** | **VERIFIED** (2026-09-24 repair, untouched) | CREDENTIAL_CATALOG_DEFECT |
| **P06** Technician — ASSIGNED | `service-technician-a` | `finley.fixture@sandbox.invalid` | `i4EYSBGPXPM8lweuhI5a5y2TRgH3` | `97652f09-07bf-48e8-90b9-f321a01fe10d` | active/active | `synthetic-np-emp-service-technician-a` | ACTIVE | `SERVICE_TECHNICIAN` | `technician` (3) | `SERVICE_TECHNICIAN` | none | no | key → other identity | VERIFIED | CREDENTIAL_CATALOG_DEFECT · TEST_FIXTURE_DEFECT |
| **P07** Technician — UNASSIGNED | `service-technician-b` | `gray.fixture@sandbox.invalid` | `l2AKXJ44hzUEWpYfEpiQeg208CF2` | `728f5b0d-45bf-4708-8624-0864ab19bcab` | active/active | `synthetic-np-emp-service-technician-b` | ACTIVE | `SERVICE_TECHNICIAN` | `technician` (3) | `SERVICE_TECHNICIAN` | none | no | no | VERIFIED | CREDENTIAL_CATALOG_DEFECT |
| **P08** Parts Associate | `parts-associate` | `logan.fixture@sandbox.invalid` | `Ap6MRSs1gKW5lQtN4lTZOaecHgu1` | `29ec481c-51a6-468f-831e-5f84308bad0d` | active/active | `synthetic-np-emp-parts-associate` | ACTIVE | `PARTS_ASSOCIATE` | `partsAssociate` (10) · `inventoryReceivingClerk` (1) | `PARTS_OPERATIONS` | **none** (withheld) | no | key → other identity | VERIFIED | CREDENTIAL_CATALOG_DEFECT · DOMAIN_NOT_ACTIVATED |
| **P09** Parts Mgr / Purchasing | `parts-manager` | `kai.fixture@sandbox.invalid` | `p9zXxj5SJiOAwbSoFcKriaQ8NGt1` | `68ab4dec-5922-4d0c-954c-5161befe3bd8` | active/active | `synthetic-np-emp-parts-manager` | ACTIVE | `PARTS_MANAGER` | `partsManager` (16) · `purchasingManager` (13) | `PARTS_OPERATIONS` | `REORDER_QUEUE:taylor` | no | key → other identity | VERIFIED | CREDENTIAL_CATALOG_DEFECT · DOMAIN_NOT_ACTIVATED |
| **P10** Warehouse Associate | `warehouse-associate` | `noor.fixture@sandbox.invalid` | `cgVnRUMA2Sc7WxHl1lgTmbQAhwG2` | `65a269d9-86f8-4c7a-b974-436dd6779bbf` | active/active | `synthetic-np-emp-warehouse-associate` | ACTIVE | `WAREHOUSE_ASSOCIATE` | `warehouseAssociate` (8) · `inventoryCycleCountCounter` (3) | `WAREHOUSE_OPERATIONS` | `WAREHOUSE:SC-WH-MAIN` | no | **no key at all** | VERIFIED | CREDENTIAL_CATALOG_DEFECT |
| **P11** Warehouse Manager | `warehouse-manager` | `morgan.fixture@sandbox.invalid` | `0KBdhU9Z8Yc4aTQqXHODEP1jeHf1` | `00e45827-043a-484f-b150-0d8502e8e39f` | active/active | `synthetic-np-emp-warehouse-manager` | ACTIVE | `WAREHOUSE_MANAGER` | `warehouseManager` (12) · `inventoryCycleCountReconciler` (1) · `inventoryBinAdministrator` (**0**) | `WAREHOUSE_OPERATIONS` | `WAREHOUSE:SC-WH-MAIN` + `WAREHOUSE:SC-WH-SERVICE` | no | key → other identity | VERIFIED | CREDENTIAL_CATALOG_DEFECT · OBJECT_AUTHORITY_DEFECT |
| **P12** Retail Sales | `retail-sales-a` / `retail-sales-b` | `harper.fixture@…` / `indigo.fixture@…` | `4OVJwVRisyOlgBQDkjA75rs7djm2` / `jUzI7OPsdIbJ0WGa2YlYvGUXYKW2` | `c117537e-21ac-43e7-a210-b6cfa5323ed6` / `09aa317f-4cb7-4b90-b675-0ec9db216648` | active/active | `…retail-sales-a` / `…-b` | ACTIVE | `RETAIL_SALES` | `salesperson` (17) | none | none | no | key `salesperson` → other identity | VERIFIED | CREDENTIAL_CATALOG_DEFECT · DOMAIN_NOT_ACTIVATED |
| **P13** National Accounts Sales | `national-accounts-sales` | `jules.fixture@sandbox.invalid` | `zpfYS0PKUJOwVbskY1WjUreWqg72` | `da330746-66c5-4d99-ba94-57f3d241a814` | active/active | `synthetic-np-emp-national-accounts-sales` | ACTIVE | `NATIONAL_ACCOUNTS_SALES` | `salesperson` (17) | none | none | no | **no key at all** | VERIFIED | CREDENTIAL_CATALOG_DEFECT · DOMAIN_NOT_ACTIVATED |
| **P14** Finance / Accounting | — | — | — | — | — | — | — | **none** (no FINANCE Job Role key) | none held; `controller` / `financeManager` / `accountingManager` each 17 caps, **0 holders** | — | — | no | key `accountingManager` with **no identity behind it** | **MISSING** | EMPLOYEE_CONTEXT_DEFECT · DOMAIN_NOT_ACTIVATED · CREDENTIAL_CATALOG_DEFECT |
| **P15** Reporting / Read-only | — | — | — | — | — | — | — | none | none held; `reportViewer` / `reportFinanceViewer` / `reportAuthor` each **0 caps**, **0 holders** | — | — | no | no | **MISSING** | EMPLOYEE_CONTEXT_DEFECT · OBJECT_AUTHORITY_DEFECT · DOMAIN_NOT_ACTIVATED |
| **P16** Restricted / negative control | — | `restricted@sandbox.invalid` (declared only) | — | — | — | — | — | none | none | — | — | no | key only | **MISSING** | EMPLOYEE_CONTEXT_DEFECT · CREDENTIAL_CATALOG_DEFECT · INTENTIONAL_DENIAL |

`P/M` = Principal status / tenant membership status. Capability counts in
parentheses are `role_capabilities` rows for that Role key in nonprod.

### Retired fixture Principals (one per live persona except P01b)

Fourteen `eos-synthetic-nonprod` Principals survive with **`revoked` link,
`disabled` membership** and — importantly — **still-`active` role assignments**.
They are fenced twice (a disabled membership, and a provider no verifier
recognizes) so they grant nothing, but they double every `activeHolders` count:

`44362924` GM · `f52097cf` office-mgr · `2a91bda5` svc-mgr · `d0088c4e` dispatcher ·
`7c0399ca` tech-a · `d98c3328` tech-b · `f7791c23` contract-tech · `0ae3159a` retail-a ·
`3579c502` retail-b · `e3e20dc3` national · `0e879cc0` parts-mgr · `aa0d0151` parts-assoc ·
`cce28975` wh-mgr · `a851cdf2` wh-assoc.

**Distinct login-capable holders** (the number that matters): `admin` 1 · `owner` 1 ·
`generalManager` 1 · `officeManager` 1 · `fieldManager` 1 · `dispatcher` 1 ·
`technician` 3 · `salesperson` 3 · `partsManager` 1 · `purchasingManager` 1 ·
`partsAssociate` 1 · `inventoryReceivingClerk` 1 · `warehouseManager` 1 ·
`warehouseAssociate` 1 · `inventoryCycleCountReconciler` 1 ·
`inventoryCycleCountCounter` 1 · `inventoryBinAdministrator` 1.

---

## 3. Live vs repo drift

| # | Item | Repo declares | Live nonprod | Disposition |
|---|---|---|---|---|
| 1 | Owner/Executive authority | `admin` only | `admin` **and** a separate `owner` Principal | drift — §4 |
| 2 | Persona login namespace | 13 loader keys + 15 `*.fixture@…` logins + 1 `eos-owner@…` | 16 firebase Principals, 15 of them `*.fixture` Employees + the Owner | drift — §5 |
| 3 | Finance/Accounting chain | catalog gap, `proposedPersona: finance-controller` | **no Employee, no Principal, no login**; 3 Roles × 17 caps × 0 holders | MISSING |
| 4 | Reporting/read-only persona | catalog gap, `proposedPersona: report-viewer` | no persona **and** all 3 reporting Roles hold **0 capabilities** | MISSING + worse than declared |
| 5 | Personas without loader keys | loader described as the one credential path | GM, Warehouse Associate, National Accounts Sales, office-mgr, retail-b, contract-tech and the `owner` Principal have **no key at all** | drift — §5 |
| 6 | Dispatcher identity | `RESOLVED_FROM_AUTH_UID` | `18e54b1f…` / `PEiRkebIGRPcEau7yBBV0D77Dho1`, link active, fixture `d0088c4e` revoked | **VERIFIED — not mutated** |
| 7 | Technician ASSIGNED vs UNASSIGNED | `declaredButBlocked` | **LIVE**: 1 open `work_order_assignments` row, work order `dDas6xXNgcPi3WYPPCIL`, source `SCHEDULE`, from `2026-09-24 05:06:48.579Z`, assignee `synthetic-np-emp-service-technician-a`; tech-b has 0 | fixture **STALE** |
| 8 | `REORDER_QUEUE:taylor` holders | (prior note: parts-mgr + dispatcher) | **three**: dispatcher, **owner-executive**, parts-manager | corrected |
| 9 | Held Roles that grant nothing | not recorded | `inventoryBinAdministrator` **0 caps** (held by wh-mgr); `zz_nonprod_acceptance` 0 caps | new finding |
| 10 | Zero-holder Role keys | — | 32 of 49 rows (31 of the 48 governed keys). `owner` is **NOT** zero-holder — it has 1 | corrected |

---

## 4. Owner / Administrator drift (verification item 1)

**Repo:** `sampleCompany.v2.json` declares `principals[owner-executive].securityRoles = ["admin"]`
and `expectedAccess.personas["owner-executive"].securityRoles = ["admin"]`. The key
`owner` appears in **no** fixture's `securityRoles` list anywhere.

**Live:** two distinct top-of-house authorities.

| | Employee side | Authority side |
|---|---|---|
| Principal | `639c1970-dbdb-4bc0-af7c-118559151e2f` | `dca03ad1-9278-49e6-b4f9-d09d3f587dc4` |
| Subject | `ZVu3lHTP1NQhj0Am04zTAGou0dx1` | `ajXZSa0gTcWAyDHVSsVifwZfNRf1` |
| Display name | (Employee-derived) | `SYNTHETIC NONPROD Owner (fixture, signs in as eos-owner@sandbox.invalid; EOS holds the authority)` |
| Security Role | `admin` — **66** capabilities | `owner` — **47** capabilities |
| Employee link | `active` → `synthetic-np-emp-owner-executive` | **none** |
| Job Role | `OWNER_EXECUTIVE` | none (no Employee) |
| Work Elig. / Scopes | none / `REORDER_QUEUE:taylor` | n/a |

The exact drift:

1. The manifest models **one** top-of-house authority; nonprod holds **two**.
2. `owner` is live with 1 active global assignment while being declared nowhere.
3. The `owner` holder has **no Employee**, so it has no Job Role, no Work
   Eligibility and no Operational Scope — nothing that resolves through Employee
   context can refuse it.
4. The Employee carrying the `OWNER_EXECUTIVE` **Job Role** holds `admin`, not `owner`.
5. `admin` 66 caps vs `owner` 47 caps — materially different, not interchangeable.
6. `personaE2EScenarios.v1.json` → `canonicalPersonas[Administrator].whatWouldSeparateThem`
   states that a Principal holding `owner` but **not** `admin` would be the
   genuinely missing administrative persona and that *"the catalog contains no
   such persona."* **Measured false:** `dca03ad1` is exactly that Principal.
   The fixture claim is `STALE` (`TEST_FIXTURE_DEFECT`).

Classification: `SECURITY_ROLE_DEFECT` · `EMPLOYEE_CONTEXT_DEFECT` · `TEST_FIXTURE_DEFECT`.

---

## 5. Credential namespace overlap (verification item 2)

**Three mutually disjoint namespaces. Not one email is shared.**

| Namespace | Source | Emails | Live EOS Principals | Loader keys |
|---|---|---|---|---|
| **A** legacy `sbx-*` | `scripts/sandboxCredentials.mjs` `SANDBOX_PERSONAS` | **13** | **0** | 13 |
| **B** Sample Company v2 | `sampleCompany.v2.json` `employees[].sandboxPersona.credentialEmail` (`*.fixture@sandbox.invalid`) | **15** (activation allowlist **14** — owner-executive excluded, its `credentialEmail` is `null`) | **15** | **0** |
| **C** Owner authority | `functions/scripts/bindOwnerPersonaIdentity.js:83` | **1** (`eos-owner@sandbox.invalid`) | **1** | **0** |

`A∩B = 0` · `A∩C = 0` · `B∩C = 0` · **29 distinct declared logins, 0 overlap.**
`*.fixture@sandbox.invalid` occurs only in `sampleCompany.v2.json` and
`functions/test/sampleCompanyManifest.test.mjs`; `eos-owner@sandbox.invalid` only
in `bindOwnerPersonaIdentity.js` and two of its tests. Neither is registered in
the canonical loader.

**Nine loader keys collide by *name*** with a live business persona while pointing
at a *different* identity: `owner`, `admin`, `dispatcher`, `technician`,
`warehouseManager`, `partsManager`, `partsAssociate`, `fieldManager`,
`salesperson`. A prompt saying *"use the dispatcher persona"* therefore resolves
to an account that is **not** the live governed dispatcher. Four more
(`operationsManager`, `salesManager`, `accountingManager`, `restricted`) name a
Role or control that **no live Principal holds at all**.

### Loader reachability — measured, zero

One credential file exists on this host: `~/.eos-sandbox/sandbox-credentials.local.json`,
which is **not** on any canonical loader path. It holds **1 entry**:
`eos-owner@sandbox.invalid`.

- `loadSandboxPersona(<any key>)` with no explicit path → `CREDENTIAL_ACCESS_FAILED/FILE_NOT_FOUND`.
- With `SANDBOX_CREDENTIALS_FILE` pointed at that file → **all 13 keys** fail
  `CREDENTIAL_ACCESS_FAILED/PERSONA_NOT_IN_FILE`, **including `owner`**, because
  the loader maps `owner` → `owner@sandbox.invalid` while the file's only entry is
  `eos-owner@sandbox.invalid`.

**Loader-serviceable personas: 0. Browser-login-capable personas via the governed
path: 0.** Only `Object.keys()` and error codes were inspected; no password
value, length, encoding or other derivative was read, printed or stored.

Classification: `CREDENTIAL_CATALOG_DEFECT`.

---

## 6. Missing personas

| Slot | What exists | What is missing | Blocked by |
|---|---|---|---|
| **P14** Finance / Accounting | `controller`, `financeManager`, `accountingManager` — **17 capabilities each**, **0 holders**. A loader key `accountingManager` with no identity behind it. | **The whole Employee → Principal → membership → Role chain.** No `FINANCE_MANAGER` Job Role key exists either. | `SAMPLE_COMPANY_V3_REQUIRED` (Employee creation needs the one documented direct insert in `seedSampleCompany.js`) · `FINANCIALS_DOMAIN_BLOCKED` · `JOB_ROLE_VOCABULARY_PINNED` (12 keys, pinned by a test) |
| **P15** Reporting / Read-only | `reportViewer`, `reportFinanceViewer`, `reportAuthor` — **0 capabilities each**, **0 holders**. | A permanent acceptance Employee/persona. **And the authority itself:** these Roles grant nothing, so even a created persona would hold no positive authority — a pure deny-side control, not a read-only reporting persona. | `SAMPLE_COMPANY_V3_REQUIRED` · `REPORTING_DOMAIN_BLOCKED` · `REPORT_ROLES_HAVE_ZERO_CAPABILITIES` (measured live) |
| **P16** Restricted / negative control | Loader key `restricted` only. Nearest live constructs: `records-clerk` (ACTIVE Employee, 0 Principals) and `technician-on-leave` (ON_LEAVE, 0 Principals). | A **signed-in** identity refused everything. The two live constructs prove `Employee ≠ user access` — neither can sign in, so neither yields an authenticated-and-refused answer. `personaAuthorityDimensions.v1.json` records `sbx-restricted` `replacedBy: "NOT COVERED"`. | closest governed vehicle is the unheld `generalEmployee` Role (0 capabilities) |

Answers to the verification items: **item 3** — Finance/Accounting has **no**
Employee/login/Principal chain, only catalog Roles. **Item 4** — **no** permanent
reporting/read-only acceptance persona exists, and the reporting authority is
unbuilt in PostgreSQL rather than merely unheld. **Item 5** — confirmed:
Warehouse Associate, General Manager and National Accounts Sales all exist live
with **no canonical loader key at all**.

---

## 7. Personas present but outside P01–P16

Listed so the enumeration is closed; all four are `VERIFIED`.

| Persona key | Employee | Emp status | Principal | Roles | Elig. | Scopes | Note |
|---|---|---|---|---|---|---|---|
| `office-manager` | `synthetic-np-emp-office-manager` | ACTIVE | `a358c615-c65a-49ea-977d-9dc9b12785cb` / `Trvw2vp0yhd2SnXOfZvDUAcv6Aj2` | `officeManager` (4) | none | none | declared gap `WORK_ORDER_LIFECYCLE_AUTHORITY_STILL_LEGACY` |
| `contract-technician` | `synthetic-np-emp-contract-technician` | **CONTRACTOR** | `79e8b051-3bbd-4f7f-af0a-ec387323b925` / `26pkGMjIBJUzDAJYZTXosfLVw933` | `technician` | `SERVICE_TECHNICIAN` | none | the eligible-non-ACTIVE proof (`eligibleStatuses` = ACTIVE + CONTRACTOR) |
| `technician-on-leave` | `synthetic-np-emp-technician-on-leave` | **ON_LEAVE** | **none** | none | none | none | `INTENTIONAL_DENIAL`; cannot sign in |
| `records-clerk` | `synthetic-np-emp-records-clerk` | ACTIVE | **none** | none | none | none | `INTENTIONAL_DENIAL`; `Employee ≠ user access` while ACTIVE |

---

## 8. Measurement blocked

| Subject | Why | Disposition |
|---|---|---|
| Firebase Auth account existence and the **uid ↔ email binding** for every persona | Requires Firebase Admin credentials and an auth operation. This lane performs none and creates, resets or rotates nothing. The uid is VERIFIED from PostgreSQL; the email is REPO_DECLARED; the binding between them is not measured here. | `BLOCKED_MEASUREMENT` |
| Whether the 13 legacy `sbx-*` Auth accounts still exist | Same. **What is measured:** none has an `eos_policy.principals` row, so none can resolve an EOS authorization context even if its Auth account survives. | `BLOCKED_MEASUREMENT` |
| Browser navigation / experience authority per persona | Needs a dev server and browser automation, both forbidden here. No `EXPERIENCE_NAV_DEFECT` is asserted **or** denied. | `BLOCKED_MEASUREMENT` |
| Effective capability set per Principal via `capabilitiesForRoleKeys` | Not re-derived. Role-level `role_capabilities` counts are the ceiling (`principal_capabilities` = 0, no conditions applied). | `BLOCKED_MEASUREMENT` |
| Firestore-side persona state (`users/{uid}.role`, `employees/{id}.operationalRoles`) | This lane opens no Firebase connection and reads no Firestore Role — excluded by rule, not by inability. | `BLOCKED_MEASUREMENT` |
| `WORKFLOW_AUTHORITY_DEFECT` per persona | No workflow operation was invoked. Neither asserted nor denied. | `BLOCKED_MEASUREMENT` |

---

## 9. Classification summary

| Class | Count |
|---|---|
| `CREDENTIAL_CATALOG_DEFECT` | **15** |
| `DOMAIN_NOT_ACTIVATED` | 6 |
| `EMPLOYEE_CONTEXT_DEFECT` | 4 |
| `TEST_FIXTURE_DEFECT` | 3 |
| `OBJECT_AUTHORITY_DEFECT` | 3 |
| `INTENTIONAL_DENIAL` | 3 |
| `SECURITY_ROLE_DEFECT` | 2 |
| `IDENTITY_DEFECT` | 0 |
| `WORK_ELIGIBILITY_DEFECT` | 0 |
| `OPERATIONAL_SCOPE_DEFECT` | 0 |
| `WORKFLOW_AUTHORITY_DEFECT` | 0 (**not measured**) |
| `EXPERIENCE_NAV_DEFECT` | 0 (**not measured**) |

Counting rule: one count per (persona slot **or** fixture-staleness entry) × class.
`CREDENTIAL_CATALOG_DEFECT` covers P01–P14 and P16 (P15 makes no loader-key claim
to be wrong about). `INTENTIONAL_DENIAL` counts P16 plus the two deliberately
login-less Employees. `WORK_ELIGIBILITY_DEFECT` and `OPERATIONAL_SCOPE_DEFECT`
are 0 because every live dimension row matches its declaration and every withheld
one is withheld on purpose. `IDENTITY_DEFECT` is 0 because all 16 firebase
Principals resolve, all 15 links are single and active, and the dispatcher repair
is verified. The last two are 0 because they were **not measured** — see §8.

**Slot coverage: 13 VERIFIED, 3 MISSING.** P01 is VERIFIED because both halves
were measured, not because it is correct. **Zero of the 13 verified slots is
browser-login capable through the canonical credential loader.**

---

## 10. Registration note

No test in `functions/test/` globs `functions/scripts/fixtures/` — every consumer
names its file explicitly, and `functions/test/personaSuiteRegistration.test.mjs`
pins a **hard-coded four-entry** fixture list (`personaAuthorityDimensions.v1.json`,
`personaE2EScenarios.v1.json`, `sampleCompany.v2.json`,
`syntheticNonprodWorkforceSeed.v1.json`). The census fixture is therefore **not**
covered by an existing fixture-validation test, so `functions/package.json` and
`.github/workflows/eos-admin-policy-tests.yml` were **not** edited: registering a
path filter for a file no suite reads would register nothing. If a future lane
adds a validating suite for this census, the npm script **and both** `paths:`
blocks must change together — which is exactly what
`personaSuiteRegistration.test.mjs` enforces.

**No nonprod mutation. No production mutation. No fixture, credential or
authority was modified.**
