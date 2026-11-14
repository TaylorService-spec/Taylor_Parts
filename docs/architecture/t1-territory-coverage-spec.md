---
artifact_type: specification
gate: Decision document (docs-only; nothing is built, registered, granted or deployed)
status: Draft - awaiting Owner decisions OD-T1-1 .. OD-T1-18
date: 2026-10-20
owner: Claude Code (lane T-1)
related_adrs: [ADR-012]
depends_on: [docs/assessments/commercial-coverage-territory-authority-model.md, docs/roadmaps/business-capability-register.md#15]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release: nonprod only
---

# T-1: Territories and sales coverage on EOS (commercial item 6)

Issued: 2026-10-20 (America/Phoenix). Base: `origin/main` `b3d09dc3`.

**Direction on record.** Owner, 2026-10-19: territories are "Build in EOS". That supersedes the 2026-08-07 "record seams, do not build" posture
(register #15) and the 2026-08-21 DEFERRED record on `coverage.*` (`docs/governance/effective-authority.json`, `RECORDED_GAP`
`COVERAGE_TERRITORY_AUTHORITY_GAP`). It does **not** supersede the 2026-08-07 model constraints, which hold in full (section 1).

**What this document is.** A decision document. It reads the Firebase coverage code and the EOS account, ownership and channel code,
specifies the target (territory, geography rule, coverage assignment, resolver, My Book, administration, reads per role, audit), derives
the Firebase-parity holders, and turns every material choice into a numbered **OWNER DECISION** (section 8) with options and a
recommendation. Nothing here is a grant, a migration, a Rules change, or a deploy. Where one governed answer already exists it is stated
as **SETTLED** with its source and is not re-asked.

**What it deliberately does not do.** It does not choose a precedence rule, sales credit, commission, or a service territory. It does not
choose a map vendor or editor. It does not grant any capability.

## 1. Model constraints that hold (Owner, 2026-08-07)

| # | Constraint | Where it bites in this spec |
|---|---|---|
| M1 | A Territory has its own identity, independent of any salesperson | 4.1: no assignee, owner or person column on a territory |
| M2 | Geography abstraction is STATE, group of states, or ZIP group. No map editor, no vendor | 4.2 |
| M3 | `resolveCommercialCoverage` returns MULTIPLE assignments, each with Employee / Territory / Account relationship / Channel / responsibility / primary-secondary / dates | 4.5 |
| M4 | Corporate and local coverage coexist; named/strategic accounts are possible | 4.3, 4.5 |
| M5 | Precedence is NOT silently implemented | 4.5, OD-T1-9 |
| M6 | Coverage, opportunity owner, sales credit, commission and security authority are all distinct | 4.11 |
| M7 | Channel is configurable reference data: RETAIL / NATIONAL_ACCOUNTS / STRATEGIC_ACCOUNTS | 4.4, OD-T1-5 |
| M8 | Reuse Account / Location / Employee; no second Customer model | 4.10 |
| M9 | Admin configuration goes through the governed model, never client-direct | 4.7 |

## 2. Evidence

### 2.1 Firebase as built (read, not changed)

| Piece | Source | Behaviour that matters |
|---|---|---|
| `createSalesTerritory` | `functions/src/coverage/coverageCallables.ts:41-62` | Gate `coverage.write`, fail-closed (`:25-35`). `idempotencyKey` required. One transaction: audit-id probe, `sales_territories` insert, one audit event `createSalesTerritory` / target `salesTerritory`. **No company on the territory** |
| `createCoverageAssignment` | `coverageCallables.ts:65-85` | Same gate and shape; writes `commercial_coverage_assignments`; audit `createCoverageAssignment` / `coverageAssignment`. **Carries `companyId` (required)** |
| Territory command | `coverageCommands.ts:36-64` | Kinds STATE / STATE_GROUP / ZIP_GROUP / GEOSPATIAL. STATE needs `geo.states[]` (upper-cased); ZIP_GROUP needs `geo.zips[]` or `geo.zipPrefixes[]`; GEOSPATIAL needs an opaque `geo.polygonRef`. `status` ACTIVE or INACTIVE, set only at create |
| Assignment command | `coverageCommands.ts:101-146` | Assignee needs **both** `assignedToEmployeeId` and `assignedToUserId`. Scope kinds TERRITORY / ACCOUNT / NAMED_ACCOUNT / CORPORATE / CHANNEL, each needing its own reference; a channel constraint may accompany a non-CHANNEL scope. `effectiveFrom` ms-epoch required; `effectiveTo` null (open) or after `effectiveFrom`. `priority` PRIMARY / SECONDARY / OVERLAY or null. `responsibility` free text or null |
| Resolver | `coverageResolution.ts:26-84` | Returns ALL assignments effective at `now` (inclusive from, exclusive to) whose scope matches. No winner, no owner, no credit. Territory match: state upper-cased equality; ZIP exact or `startsWith` a prefix; GEOSPATIAL never matches. Fail-closed to `[]` |
| Read callable | `coverageReadCallables.ts:46-75` | Gate `coverage.read`. Caller names `companyId` and a `context`; reads that company's assignments **and every territory** (`limit(1001)`); more than 1000 of either answers `unavailable`. Projects `{assignmentId, assignee, scope, responsibility, priority, effectiveFrom, effectiveTo}` and **no territory field** |
| Rules | `firestore.rules:1794-1799` (and the `field-ops-app-vite/firestore.rules` mirror) | Both collections deny all client access |
| Capabilities | `functions/src/access/permissionCatalog.ts:421-443` | `coverage.write` and `coverage.read`, both `active:false` |
| Tests | `functions/test/coverageCommands.test.mjs`, `coverageCallables.test.mjs`, `coverageResolution.test.mjs`; client `field-ops-app-vite/test/commercialCoverage.test.mjs` | The behaviour above |
| Callers | none in the client, scripts or operator tooling (`evidence/firebase-replacement-matrix-2026-10-19.md` A4) | Territories are unlikely to hold production rows: **unverified** |

### 2.2 EOS as built

| Fact | Source |
|---|---|
| **No coverage or territory table in PostgreSQL.** Territory was kept out of the ownership schema by explicit ruling: "coverage is not ownership, credit, commission or security" | `functions/migrations/1758844800000_commercial-ownership-authority.sql:38-49`; `functions/src/ownership/ownershipMatrix.ts:522-523` (`salesTerritory`, `coverageAssignment` are `EXCLUDED`) |
| No `coverage.*` capability in PostgreSQL, no audit action, no operation | grep of `functions/migrations`, `functions/src/adminPolicy/seed/policySeedSnapshot.json` (`salesTerritory` is a registry-only entry) |
| The channel vocabulary is **already built**: PG enum `eos_commercial.commercial_sales_channel` = NATIONAL_ACCOUNTS, RETAIL, STRATEGIC_ACCOUNTS (stored on `opportunities.sales_channel`, `sales_orders.sales_channel`); per-tenant activation table `eos_policy.tenant_sales_channels` (starts empty, rows never deleted); governed command `setTenantSalesChannelStatus` under `admin.securityPolicy.write` | `functions/migrations/1759449600000_commercial-schema-parity-numbering-receipts.sql:61`; `1762905600000_tenant-sales-channel-scope.sql`; `functions/src/adminPolicy/policyCommands.ts:1250-1290` |
| A Security Role assignment can already be scoped to a sales channel (`salesChannel` scope type; consumers: opportunity / salesAgreement / salesOrder read and write). That is **security**, and it is the thing coverage must never feed | `functions/src/adminPolicy/assignmentScopeRuntime.ts:39-110`; `functions/src/access/roleHierarchy.ts:284` |
| Account (`eos_crm.accounts`: id, tenant, name, status, `owner_employee_id`), Location (`eos_crm.account_locations`: `address_state`, `address_postal_code`, **free text, all nullable**), Employee (`eos_workforce.employees`: id, tenant, employment status, `operating_company_id`) | `functions/migrations/1758758400000_crm-account-contact-location.sql:170-300`, `1759104000000_employee-business-authority.sql:289` |
| **There is no corporate / parent / affiliate relationship between Accounts anywhere** (no `parent_account_id`, no relationship table, in PostgreSQL or Firestore code) and no "named account" designation | repo-wide grep for parent / corporate / named account |
| Operating companies: `eos_policy.tenant_operating_companies` (ACTIVE / INACTIVE per tenant); Employees and Commercial records carry an operating company; company authority is mandatory for company-scoped data | `1759968000000_tenant-operating-company-authority.sql`; `docs/engineering/ACTIVE_WORKSTREAMS.md` (Company Authority V1) |
| Owner is a separate concept: `owner_employee_id` on Account, Contact, Location, Opportunity, Sales Order, Agreement | `1758844800000...sql:177-256` |
| Audit: `eos_policy.audit_events`; one event per governed change, same transaction | `1757462400000_admin-policy.sql:347`; G-1 / P-1 pattern |
| There is no "My Book" surface. The dashboard has `myOpportunities` (owner-based) and no coverage module | `field-ops-app-vite/src/domain/dashboardComposition.js`; `docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md` |

### 2.3 Gaps in the Firebase behaviour (found by reading; each is a decision in section 8, not a silent fix)

| # | Gap | Effect |
|---|---|---|
| F1 | **Create-only.** No command ends an assignment, edits a territory, or deactivates one. `effectiveTo` and `status` can be set only at creation | A reassignment cannot close the old assignment; both stay effective forever. Effective-dating exists in the data and cannot be used to end anything |
| F2 | The resolver ignores territory `status` | An INACTIVE territory still matches |
| F3 | The resolver takes `corporateAccountIds` and `namedAccountIds` **from the caller's context**; nothing in the system supplies them | A caller can assert any relationship; with no hierarchy source, CORPORATE and NAMED coverage can only ever be asserted, not derived |
| F4 | Territory match is literal: state equality after upper-casing, ZIP `startsWith`. Location addresses are free text (`address_state` may hold "Arizona"; ZIP may be ZIP+4) | A site in "Arizona" or an exact ZIP list against "85001-1234" does not match: silently uncovered |
| F5 | No integrity checks on write: `territoryId`, `channelId`, the Employee and the `companyId` are not verified to exist or be active | Dangling or typo'd references are accepted |
| F6 | Territories are not company-scoped; assignments are. The read loads every territory and trusts the caller's `companyId` with no company-authority check | A `coverage.read` holder can read any company's assignments by naming it |
| F7 | No territory read exists for any client (`salesTerritory.js` header): a territory's name, kind and geo can never be shown | An administration screen has nothing to list in Firebase |
| F8 | No `priority` rule: several PRIMARY assignments over the same scope are accepted | Not an error under M5; it must not be turned into a winner |
| F9 | Bounded read: more than 1000 territories or assignments answers `unavailable` | Acceptable at current scale; EOS replaces it with SQL filtering |

## 3. What is SETTLED (one governed answer; not re-asked)

| # | Settled point | Source |
|---|---|---|
| S1 | Territory has no person on it; people attach only through a Coverage Assignment | M1; register #15 |
| S2 | The resolver returns every effective matching assignment and ranks none | M3, M5; `coverageResolution.ts:78-84` |
| S3 | The channel vocabulary is the existing PG enum; a new channel is one `ALTER TYPE` plus tenant activation, not a new reference table | `1759449600000...sql:61`, `1762905600000...sql` header ("A second vocabulary for the same idea is how a scope value and a record value come to disagree") |
| S4 | The assignee is an Employee, by `eos_workforce.employees.id`. The Firebase `assignedToUserId` is not stored (principal resolution is the Employee-to-principal link, a separate authority) | `1759104000000...sql:289` ("the only Employee identity in EOS. Never a principals.id") |
| S5 | Effective dates are instants, half-open `[effective_from, effective_to)`, evaluated at an explicit `as_of` (default now). Display is America/Phoenix | `coverageResolution.ts:46-51`; register #15 effective-dating |
| S6 | Tables are PostgreSQL-native, tenant-scoped, with composite foreign keys to `accounts (tenant_id, id)` and `employees (tenant_id, id)`; no table in the ownership schema | M8; ownership ruling `1758844800000...sql:38-49` |
| S7 | Writes are governed commands on the EOS operations API, idempotent on `(actor, idempotency key)`, one `eos_policy.audit_events` row per change in the same transaction, never client-direct | M9; G-1 / P-1 pattern; Firebase parity |
| S8 | Service Territory (dispatch, technician routing) is a separate concept and authority. Sales Territory never governs it | register #15 |
| S9 | Coverage does not feed Security Role assignment scopes, record visibility, Opportunity owner, credit or commission | M6; `roleHierarchy.ts:284` |
| S10 | No data is copied from Firestore. The two collections are expected to be empty (no caller, capabilities inactive); a count is an operator read, not part of this work | evidence matrix A4 col. 7 |

## 4. Specification (the target; none of it exists yet)

### 4.1 Territory

A durable commercial-coverage object with an identity independent of any salesperson (M1, S1).

| Field | Rule |
|---|---|
| `id` | Server-allocated, immutable |
| `tenant_id` | Required |
| `name` | Required, trimmed, unique per tenant case-folded (Firebase allows duplicate names; a duplicate-named territory is indistinguishable in a picker). Deviation, see OD-T1-12 |
| `kind` | STATE / STATE_GROUP / ZIP_GROUP / GEOSPATIAL (Firebase set). GEOSPATIAL stays an opaque reference and never matches (M2) |
| `geo` | Per section 4.2, immutable after creation (a changed boundary is a new territory, so history of "who covered where" is never rewritten; OD-T1-11) |
| `status` | ACTIVE / INACTIVE, changed only by `setSalesTerritoryStatus` (OD-T1-11) |
| Operating company | **None** (OD-T1-4 recommends a territory is a geographic fact, tenant-wide) |
| Provenance | `created_by/at`, `updated_by/at`; rows never deleted |

### 4.2 Geography rule

The abstraction is exactly Firebase's: STATE or STATE_GROUP (a set of states), ZIP_GROUP (exact ZIPs and/or ZIP prefixes), GEOSPATIAL reserved. No map, no vendor (M2).

Match input is a Location's `address_state` and `address_postal_code`. Because those are free text (F4), the rule needs a normalisation step, and that step is the one real design choice in geography (OD-T1-6):

- State: compare the USPS two-letter code. Input is accepted as a two-letter code or a full state name through a fixed 51-entry table; anything else is "unresolvable", which matches no territory and is counted, never guessed.
- ZIP: compare the first five digits. ZIP+4 is reduced; non-numeric or short input is unresolvable.
- A Location with no state or no ZIP simply does not match territories of that kind (Firebase behaviour).

An Account has many Locations; territory coverage is decided **per Location** (OD-T1-7). The Account's billing address is not geography.

### 4.3 Coverage assignment

A person (Employee) assigned to a scope, effective-dated. Many may overlap; none replaces another (M3, M4).

| Field | Rule |
|---|---|
| `id`, `tenant_id` | As territory |
| `operating_company_id` | Required; must be an ACTIVE `tenant_operating_companies` row (Firebase `companyId`; OD-T1-4) |
| `assignee_employee_id` | Required; composite FK `(tenant_id, employee_id)`; the Employee must be ACTIVE at write (S4, OD-T1-12) |
| Scope kind | TERRITORY / ACCOUNT / NAMED_ACCOUNT / CORPORATE / CHANNEL (Firebase set; OD-T1-8 for the last three) |
| Scope reference | Exactly the one reference its kind needs (`territory_id`, `account_id`, ...), checked to exist (and, for territory, to be ACTIVE) at write |
| `channel` | Required for CHANNEL scope; optional AND-constraint on the others; must be a channel ACTIVE for the tenant at write (S3) |
| `responsibility` | A label (Salesperson, Account Executive, Territory Manager, National, Strategic, Relationship Manager are the register's examples). Free text in Firebase. Configurable list is **not** built now (OD-T1-14) |
| `priority` | PRIMARY / SECONDARY / OVERLAY or null. Recorded, never applied (M5, OD-T1-9) |
| `effective_from` / `effective_to` | S5. `effective_to` is null (open) or after `effective_from` |
| Provenance | `created_by/at`; ended-by/at when ended (OD-T1-11) |

Account relationship: an assignment's "Account relationship" (M3) is its scope kind plus reference: ACCOUNT / NAMED_ACCOUNT / CORPORATE name an Account; TERRITORY names the geography; CHANNEL names a channel. There is no separate relationship table (M8; OD-T1-8).

### 4.4 Channel

Settled by S3: the existing enum and tenant activation are the configurable reference data. A coverage assignment may name a channel only if the tenant has it ACTIVE, and `setTenantSalesChannelStatus` already refuses to deactivate a channel while Security Role assignments are scoped to it. This spec adds the same refusal for ACTIVE coverage assignments naming the channel (`SALES_CHANNEL_HAS_COVERAGE`), because deactivating under a live assignment strands it. No new channel table is built (OD-T1-5).

### 4.5 Resolver

`resolveCommercialCoverage(context, as_of)` returns `coverageAssignments[]`:

- Context: `{ operating_company_id, account_id?, location_id?, channel? }`. The server derives the Account, the Location's normalised state/ZIP and the Opportunity's channel itself. **It never accepts relationship ids from the caller** (closes F3).
- Returns every assignment in that company, effective at `as_of`, whose scope matches: ACCOUNT / NAMED_ACCOUNT / CORPORATE by the Account (OD-T1-8), TERRITORY by the Location's geography against an ACTIVE territory (closes F2), CHANNEL by channel. A channel constraint on any scope is AND-ed.
- Each row: assignment id, Employee id and display name, scope kind and reference (territory name/kind, account name, channel), responsibility, priority, effective dates. **No** owner, credit, commission, winner, rank or "primary employee" field. A test asserts the projection has none (parity with `summarizeCoverage`).
- Order is deterministic and **not meaningful**: `effective_from`, then id. The UI must not rank or highlight by priority (M5, OD-T1-9).
- Truncation: SQL-filtered; a result above a hard cap answers `UNAVAILABLE`, never a partial "ready" (parity with `coverageReadCallables.ts:62-67`).
- Honest states: `DENIED`, `READY` (possibly empty), `UNAVAILABLE`.

### 4.6 My Book ("my commercial coverage")

Register #15: My Book is "my commercial coverage", not a channel filter. Specification:

1. My assignments: my Employee's assignments effective now (the identity is derived from the session, never passed in).
2. Expanded to what they cover: Accounts named by ACCOUNT / NAMED_ACCOUNT / CORPORATE; Accounts with at least one Location inside a TERRITORY; Opportunities in a covered channel; each row says **why** it is covered (scope kind, territory/channel name, responsibility).
3. "Covered" and "Owned" are two separate sections or columns. A record that is both shows both facts. They are never merged into one list or a single number (M6). No credit, quota or commission figure appears.
4. Split coverage is shown as split: a row covered by two people lists both.

Cost control: expansion by territory is a SQL join over `account_locations`; it is bounded and answers `UNAVAILABLE` over the cap (OD-T1-15 sets the view; OD-T1-16 sets who may see it).

### 4.7 Administration

Governed only (M9). Operations on the EOS operations API (the family and route are a build detail):

| Operation | Parity | Notes |
|---|---|---|
| `createSalesTerritory` | Firebase | Deviation: unique name; GEOSPATIAL still opaque |
| `createCoverageAssignment` | Firebase | Deviation: integrity checks (F5) |
| `endCoverageAssignment` | **New** (F1) | Sets `effective_to` once, to a time not before now; cannot rewrite the past; idempotent |
| `setSalesTerritoryStatus` | **New** (F1, F2) | ACTIVE / INACTIVE; reason required; deactivation never ends assignments implicitly (they stop matching because the territory is inactive; ending is explicit) |
| `listSalesTerritories`, `listCoverageAssignments`, `resolveCoverageForContext` | Read; territory list is **new** (F7) | Section 4.8 |

Placement of the screen is an Owner/UX decision (OD-T1-17). It is not a client write path: the screen calls the operations.

### 4.8 Reads per role

| Surface | Capability | Holders if the recommendations are adopted | Parity? |
|---|---|---|---|
| Resolve coverage for a context; list territories and assignments | `coverage.read` | admin, owner (company authority applies: only companies the caller reaches) | Exact catalog parity; the territory list is new but rides the same key |
| Create / end / status | `coverage.write` | admin, owner | Exact catalog parity (OD-T1-2, OD-T1-3) |
| My Book | a new self-scoped read (proposed `coverage.myBook.read`) | **none until the Owner decides** (OD-T1-16) | Not parity: no Firebase equivalent |

The sales branch (`salesperson`, `salesManager`, `marketingManager`) has no coverage capability in Firebase or EOS today, so My Book for the people it is for needs a new grant, which is the Owner's call.

### 4.9 Audit

One `eos_policy.audit_events` row per governed change in the same transaction as the write: `createSalesTerritory` / `salesTerritory`, `createCoverageAssignment` / `coverageAssignment` (both names carry over from Firebase, `auditEventWriter.ts:166-168`), plus `endCoverageAssignment` and `setSalesTerritoryStatus` if OD-T1-11 adopts them. Idempotent replay writes no second row. Reads write nothing (parity). Actor, reason (required for end and status), before/after for status, company and idempotency key are recorded. A new audit action needs its runtime mirror in `AuditAction` and the writer list (the parser gotcha recorded for the AuditAction union).

### 4.10 Persistence (proposed shape; not built)

Reuses Account, Location, Employee; adds only two tables.

| Table | Key columns |
|---|---|
| `eos_commercial.sales_territories` | `id`, `tenant_id`, `name`, `kind`, `geo` (validated JSON per kind), `status`, provenance; unique `(tenant_id, lower(btrim(name)))` |
| `eos_commercial.coverage_assignments` | `id`, `tenant_id`, `operating_company_id`, `assignee_employee_id` (FK), `scope_kind`, `territory_id` (FK), `account_id` (FK), `channel` (`commercial_sales_channel`), `responsibility`, `priority`, `effective_from`, `effective_to`, `ended_by/at/reason`, provenance; CHECK: exactly the reference the kind needs; CHECK: `effective_to > effective_from`; no DELETE/TRUNCATE (the `tenant_sales_channels` guard pattern) |

Not in the ownership schema and not given an `owner` column (ruling `1758844800000...sql:38-49`). The migration is written by the controller from a `.sql.txt` (lane range `17647500xxxxx`); none is produced by this PR.

### 4.11 What stays distinct (M6)

| Concept | Authority | Relationship to coverage |
|---|---|---|
| Record owner | `owner_employee_id` | Unchanged. Never derived from or written by coverage |
| Sales credit | Not built | Coverage never implies credit |
| Commission | Not built | Not inferred from coverage |
| Security authority | Role + assignment scopes (incl. `salesChannel`) | Coverage never grants, narrows or widens a read/write |
| Service Territory | Dispatch | Separate (S8) |
| Opportunity channel | `opportunities.sales_channel` | A property of the deal; coverage by channel reads it, never writes it |

## 5. Firebase-parity holders (A7-style derivation)

Method: compile the Firebase catalogs (`functions/src/access/{permissionCatalog,compatibilityRoles,governedBusinessRoles}.ts`) and list every Role whose `permissions` include each key, plus any per-permission scope or condition. Read-only; no `rm -rf`, no regeneration of anything. Reproduce with `cd functions && npx tsc && node -e` over `lib/access/*.js` (the same recipe `functions/test/g1GoalAuthoring.test.mjs` uses).

| Capability | Catalog `active` | Roles holding it in the Firebase catalogs | Scoped or conditioned? | Source |
|---|---|---|---|---|
| `coverage.read` | **false** | admin, owner | No | owner: `governedBusinessRoles.ts:163` (`OWNER_COMMERCIAL_AUTHORITY`); admin: whole-catalog derivation |
| `coverage.write` | **false** | admin, owner | No | same |

So the exact-parity pair set is **4 pairs over 2 Roles** (admin and owner, each for read and write). No other Role holds either key; no sales, parts, warehouse or field Role does.

**But both keys are `active:false`, which is a hard DENY for everyone in Firebase.** The number of principals who could actually exercise either capability in Firebase today is **zero**. The catalog pairs record who was *meant* to hold the keys once activated; they were never live. Therefore:

- Registering the two keys in EOS with **no** grants is "no capability beyond Firebase" and is the only strictly-zero-widening option.
- Granting the 4 catalog pairs in EOS is the *intended* parity, but it makes admin and owner able to do something no one could do in Firebase. It is an activation, so it is an Owner decision (OD-T1-1 and OD-T1-17), not a derivation. The 2026-08-21 record said "stays unassigned and unactivated"; "Build in EOS" lifts the deferral for building, and this document does not read it as authority to grant.
- `docs/governance/owner-capability-contract.md:60-61` already records both keys as `OWNER_REQUIRED` and **not** `ADMIN_ONLY`: the Owner must be able to hold them; admin holding them is not required by that contract. Admin's holding is catalog derivation, not a ruling.

Any holder beyond admin and owner (sales branch, My Book, account-detail display) is **not parity** and is an Owner decision.

## 6. Interaction with existing authority

- **EOS Company Authority V1.** Assignments are company-scoped data: a reader reaches only companies in their company authority, an administrator is confined likewise. Territories are tenant-wide geography (OD-T1-4).
- **Security Role `salesChannel` scope.** Untouched. A person covering NATIONAL_ACCOUNTS is not thereby able to see or change a NATIONAL_ACCOUNTS deal; only a Role assignment does that (S9).
- **Account ownership hardening and Sales reporting.** The register lists them as consumers of coverage. They get a coverage *read*, never a coverage-derived owner.

## 7. PR 2 decision (build or stop)

**PR 2 is not built** by this lane. Criteria from the brief: build only if there is ONE governed answer, mirroring Firebase exactly, with no grant beyond it. Four reasons it fails today:

1. A schema plus resolver with **no grants** cannot be exercised by anyone: nobody can create a territory, so the resolver can only ever return an empty set. It would be dead code with a migration attached.
2. The schema itself embeds Owner choices that are not settled: whether a territory is company-scoped (OD-T1-4; Firebase says tenant-wide, the migration header says "not ruled"), what an Account relationship is when no hierarchy exists (OD-T1-8), and the geography normalisation (OD-T1-6).
3. "Exact Firebase parity" is not buildable as-is: F1 (create-only) and F3 (caller-asserted relationships) mean a faithful copy would reproduce two defects, and F6 (no company-authority check) cannot be reproduced on EOS at all because company authority is mandatory.
4. The grant question (4 catalog pairs vs none, section 5) is an activation decision that gates registration.

Once OD-T1-1, 2, 4, 6, 8 and 17 are decided, the build is small and bounded. The PR 2 plan, ready to execute, is: migration (two tables, capability registration, the OD-T1-17 grants with a parity JSON beside the migration), command module, `/operations` wiring, `coverageResolver` in SQL with the pure matcher ported, audit actions, and the offline + real-PostgreSQL tests listed in section 9.

## 8. OWNER DECISIONS

Each: options, then the recommendation. "Parity" means the Firebase behaviour.

**OD-T1-1. Scope of "Build in EOS".** Does the 2026-10-19 direction lift the 2026-08-21 DEFERRED record for `coverage.read` / `coverage.write` (the capabilities), or only authorise building the model?
(a) Lift for building and for granting the parity holders in nonprod; (b) lift for building only; grants remain a separate later decision; (c) keep deferred. **Recommend (a)**, nonprod only, no production change.

**OD-T1-2. Who administers territories (defines the commercial geography).**
(a) admin and owner (exact catalog parity); (b) owner only (the contract's `OWNER_REQUIRED`); (c) add generalManager / salesManager. **Recommend (a).** Admin already holds it by catalog derivation, the contract does not forbid it, and the territory map is configuration rather than a commercial commitment. (b) is the stricter reading and equally valid.

**OD-T1-3. Who administers coverage assignments (who covers what).**
(a) same key and holders as OD-T1-2 (parity); (b) a separate key so assignment can be delegated to sales leadership later; (c) delegate now to salesManager. **Recommend (a).** Splitting later is additive (the catalog gains a key; holders are rows). Delegating to the sales branch is beyond parity and Firebase never granted it.

**OD-T1-4. Operating-company scope.**
(a) Firebase shape: territory tenant-wide, assignment carries one operating company; (b) both company-scoped; (c) both tenant-wide. **Recommend (a).** A state or ZIP group is a geographic fact shared by Taylor and Ventana; who covers it for which company is the company-scoped fact, and company authority then governs reads and writes. The migration header (`1758844800000:46`) left this unruled, so it is a ruling, not an inference.

**OD-T1-5. Configurable channel list: build now?**
(a) No new table: use the existing enum plus `tenant_sales_channels` activation (S3); (b) build a data-driven channel reference table that replaces the enum. **Recommend (a).** It is already configurable per tenant, it is the vocabulary every Opportunity and Sales Order carries, and a second vocabulary is the failure the existing migration warns about. A fourth channel is one `ALTER TYPE`.

**OD-T1-6. Geography normalisation (F4).**
(a) Exact parity: upper-case state equality, ZIP literal prefix; report unmatched sites as a data-quality list; (b) normalise at match time (state code or full name via a fixed table; ZIP to five digits; unresolvable = no match, counted); (c) normalise Location addresses at write time (changes the Location authority). **Recommend (b).** It is a deliberate, additive deviation from Firebase that stops "Arizona" and "85001-1234" being silently uncovered, and it touches no Location data. (a) preserves a known defect; (c) crosses into the Customer domain.

**OD-T1-7. What geography does an Account sit in?**
(a) per Location (each site may fall in a different territory; the Account is covered if any Location is); (b) one primary or billing address; (c) per Location for resolution, My Book shows the Account once with its sites. **Recommend (c)** (resolution per Location as in Firebase's context; presentation de-duplicated). Billing address is not geography.

**OD-T1-8. Corporate, named and strategic accounts when no relationship data exists (F3).**
(a) Parity: relationship ids supplied by the caller in the context; (b) build an Account relationship model now (parent/child/franchisee/affiliate) in the Customer domain; (c) keep the three scope kinds, resolve them against server-known Account ids only (the assignment's referenced Account is the covered Account), and treat propagation across a hierarchy as a later, separate decision. **Recommend (c).** (a) lets a caller assert coverage; (b) is a Customer-domain schema change that needs its own spec. Under (c), "corporate" coverage is a label on an Account-scoped assignment until a hierarchy exists, and a corporate rep covering Locations in other territories is expressed as explicit assignments, which still coexist with the local rep (M4).

**OD-T1-9. Precedence, and how priority is treated (M5).**
(a) Defer: the resolver returns all matches, `priority` is a recorded label, order is deterministic and not meaningful, UI does not rank (several PRIMARYs allowed, flagged for review only); (b) rule now (specify override/inheritance). **Recommend (a), explicitly deferred.** Per the brief and M5 this is deferred unless the Owner rules.

**OD-T1-10. Commitment-time attribution.** Should an Opportunity or Sales Order snapshot its coverage when it is committed (so history does not migrate to today's owner)?
(a) No; resolve with `as_of` the record's own date on demand; (b) snapshot onto the record. **Recommend (a).** A snapshot is credit-adjacent (M6). `as_of` resolution already answers "who covered then" because assignments are effective-dated and never rewritten.

**OD-T1-11. Lifecycle beyond create (F1).**
(a) Parity: create-only; (b) add `endCoverageAssignment` (sets `effective_to` once, not in the past) and `setSalesTerritoryStatus`; territory geography immutable (a changed boundary is a new territory); (c) full edit of both. **Recommend (b).** Without it a reassignment cannot close the previous assignment. History is never rewritten.

**OD-T1-12. Corrective deviations from parity (F2, F5).** Adopt the integrity set: inactive territory matches nothing; territory, channel (ACTIVE for tenant), Employee (ACTIVE) and company (ACTIVE) must exist at write; unique territory name per tenant; overlapping assignments still allowed?
(a) adopt all of them; (b) exact parity (accept dangling references). **Recommend (a).** Foreign keys are the PostgreSQL norm in every sibling table, and they are not capability widening. Overlap stays allowed (M4, M5).

**OD-T1-13. Assignee identity.** Settled as S4 (Employee id only; `assignedToUserId` dropped). Listed so the Owner can veto: **recommend accept.**

**OD-T1-14. Configurable responsibility labels.**
(a) Free text, trimmed (parity); (b) a governed per-tenant label list (like channels). **Recommend (a) now**; the register says "configurable labels, not new identities", so a governed list is a later increment and is additive.

**OD-T1-15. My Book definition.**
(a) My assignments plus the Accounts/Opportunities they resolve to, with "covered" and "owned" shown as separate facts (section 4.6); (b) my assignments only, no expansion; (c) owner records and covered records merged into one list. **Recommend (a).** (c) is the simplistic conflation M6 forbids.

**OD-T1-16. Who may see My Book, and the key.**
(a) A new self-scoped read `coverage.myBook.read`, granted to salesperson, salesManager and marketingManager (the sales branch) plus owner and admin; (b) grant the parity `coverage.read` to sales roles (widens to arbitrary-context resolution; rejected); (c) none until after nonprod review. **Recommend (c) for the grant, (a) as the design:** register the self-scoped key, grant it only when the Owner names the Roles. This is a grant beyond parity and is not made here.

**OD-T1-17. Grants and activation of the parity pairs (section 5).**
(a) Register `coverage.read` / `coverage.write` and grant the 4 catalog pairs (admin and owner, read and write), nonprod; (b) register with zero grants until named; (c) do not register. **Recommend (a)**, with a parity JSON file beside the migration (G-1 / A6 pattern). The Firebase keys were never active, so this is an activation by Owner decision, not a restoration of live access; production unchanged.

**OD-T1-18. Where the screens live.** Administration (governed configuration: territories and assignments) versus the Sales workspace (My Book). **Recommend** administration screens under the governed-configuration area, My Book as a Sales surface; the information architecture and composition are UX-owned and are not decided here.

## 9. Test plan for the build (names are the plan; none exist yet)

Offline (`node --test`, no database):
- `t1 coverage - the resolver returns every effective matching assignment and no field named owner, credit, commission, winner or rank`
- `t1 coverage - effective window is half-open and an as_of in the past returns what covered then`
- `t1 coverage - an inactive territory matches nothing`
- `t1 coverage - state names, USPS codes and ZIP+4 normalise; an unresolvable address matches nothing and is counted`
- `t1 coverage - relationship ids are never accepted from the caller`
- `t1 coverage - the migration registers exactly coverage.read and coverage.write, and its VALUES equal the Firebase catalog holders pair for pair (admin, owner)`
- `t1 coverage - the operations are routed, idempotent, and write exactly one audit action each`
- `t1 coverage - no sales-branch Role holds coverage.read or coverage.write`

Real PostgreSQL:
- `t1 coverage postgres - territory, assignment, FK and CHECK integrity (wrong kind/reference pair, bad window, cross-tenant Employee/Account, inactive Employee)`
- `t1 coverage postgres - end is once-only and cannot reach into the past; DELETE and TRUNCATE are refused`
- `t1 coverage postgres - company authority: a reader outside the company reaches no assignment`
- `t1 coverage postgres - deactivating a channel is refused while coverage assignments name it`
- `t1 coverage postgres - My Book separates covered from owned and lists both people on a split-covered Account`

## 10. Boundaries

No migration, no capability registration, no grant, no Rules, no Functions or Hosting deploy, no production read or write, no Firebase change, no `DECISIONS.md` edit, and no change to the Firebase coverage code. The Firestore collections are not read. Merge of this document is not activation of anything.
