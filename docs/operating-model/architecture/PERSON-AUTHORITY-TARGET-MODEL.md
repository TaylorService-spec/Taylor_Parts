---
artifact_type: target-architecture-proposal
lane: PERSON-AUTHORITY-DESIGN
status: ARCHITECTURE PROPOSED. NOT AUTHORIZED. NOT IMPLEMENTED.
date: 2026-09-13
owner: Claude Code (lane PERSON-AUTHORITY-DESIGN, EVIDENCE + ARCHITECTURE)
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
related_adrs: []
depends_on:
  - docs/DECISIONS.md
  - docs/operating-model/owner-decisions/MI-X-PERSON-AUTHORITY-OPTIONS.md
  - docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md
implements: []
supersedes: []
superseded_by: []
---

# PERSON AUTHORITY — TARGET MODEL

**OBSERVED AT: `64008d5a`** for every claim unless a line marks otherwise. Two marked exceptions
only: the production census commit `be1e5579`, and this branch's `HEAD` (`673cb202`) for the two
input documents, which are **not present at `64008d5a`**.

**What this document is.** The Owner asked for a recommended architecture. This lane gives one.
`MI-X` enumerated six candidates and returned `RECOMMENDATION: NONE` — correctly, because it was
asked a **promotion** question ("which existing collection *is* the authority") and no existing
collection earns promotion. This lane is asked a **capability** question, and a capability question
has an answer even when a promotion question does not.

**What this document is not.** No schema. No migration. No backfill. No Rules change. No field name
and no enum name for the `OD-6` person-reference states — `#182` §3 withholds those, and every field
name appearing below is **quoted from code that already exists at `64008d5a`**, never proposed. No
production contact was made and no code was executed (see §6 `NOT_RUN`).

**Authority cited by number and ref, never by relative link.** `#182`/`OD-6`, `#183`/`M-4` and
`#184`/`OD-7` live on `int/a-correctness-register`; this branch's `docs/DECISIONS.md` ends at
**`#179`** (verified: last heading `## #179 — OWNER RULINGS: M-1 Option A…`, `docs/DECISIONS.md:6410`).

---

## 0. NINE CORRECTIONS TO THE BRIEF, BEFORE THE ARCHITECTURE

Correcting the brief was declared in scope and expected. Nine items; two of them change the
architecture, not merely a line number.

| # | The brief said | Evidence at `64008d5a` | Consequence |
|---|---|---|---|
| **B-1** | Allowed surface is `docs/operating-model/architecture/…`, and the two input docs sit beside it | **Neither input doc is at that path.** They are `docs/operating-model/owner-decisions/MI-X-PERSON-AUTHORITY-OPTIONS.md` (511 lines) and `docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` (1219 lines). `docs/operating-model/` contained only `engineering/` and `owner-decisions/` | The output directory had to be **created**. Done, as the contract permits. No input doc was modified |
| **B-2** | **"The target zero-Firebase architecture must support…"** | **"Zero-Firebase" is already scoped by a governing control document, and it is not zero Firebase.** `docs/architecture/firebase-exit-manifest.json:13-20` classes Firebase Auth + UID→Principal/Employee correlation as **`IDENTITY_ONLY`** with **`"trendsToZero": false`**; `:22-38` classes Firestore + Functions as **`BUSINESS_RUNTIME`** with **`"trendsToZero": true`** | **This is the single most load-bearing correction in this document.** The end state retains Firebase Auth *permanently* as credential authority and drives *Firestore* to zero. §3 is built on it. It also means the Owner's distinction is already half-implemented in governance |
| **B-3** | Three trusted files deny `fieldops_technicians` the identity role | **FOUR.** The brief's three are exact (`employeePrincipalLinkPlan.ts:24-25`, `employeePrincipalLink.ts:46-47`, `scripts/employeeTruckCrosswalk.lib.mjs:25-26`) plus **`functions/migrations/1758412800000_employee-principal-linkage.sql:90`** — "`fieldops_technicians` is compatibility data that must not remain employee-identity authority." | The omitted one is the **strongest**: it is DDL, and it backs the ruling with a `CHECK` constraint a future migration would have to edit in a reviewable diff (`:86-92`). `MI-X:180` omits it too |
| **B-4** | `employee_principal_links` "has an `employee_id` column but **no FK**" | **Correct on `employee_id`, incomplete on the table.** The table declares exactly one FK and it is deliberately *not* onto `principals`: `…1758412800000:133-135` `FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships (tenant_id, principal_id)`, rationale `:39-42` — "A key onto `principals` alone would prove the principal EXISTS. It would not prevent tenant A's Employee from being linked to a principal who belongs only to tenant B — a **cross-tenant identity leak** rather than a dangling row." `employee_id` gets a shape `CHECK` only (`:157-158`) | The link relation is **tenant-scoped**, and it already carries the exact retention discipline §3 needs: two *partial* unique indexes (`:169-175`) enforce 1↔1 **among active rows only**, so revoked links accumulate as history. **The target pattern is already built — on the link, not on the person** |
| **B-5** | "The referential-integrity mechanism is already shipped twice… **plus twice in Rules** (`:112-121`, `:491-496`)" | **Four times in Rules, not twice.** `grep -n "documents/employees" firestore.rules` → **`:61`** (`linkedEmployeeData()`), **`:92`** (reciprocal-link check), **`:114`** (`isActiveOperationalRole()`), **`:141`** (inlined WAREHOUSE_MANAGER variant). And **three** trusted-side validators, not two: truck driver (`truckRegistryRepository.ts:196-200`), manager (`employeeProfileCommands.ts:531-541`), **and** scheduling technician existence (`scheduling/placementPolicy.ts:82`, `TECHNICIAN_NOT_FOUND`) | The mechanism is **more** entrenched than the brief claims — 7 trusted gating reads across 5 files plus 4 Rules sites = **11 gating sites**. This *raises* the migration cost of the Firestore option rather than lowering it (§3.6) |
| **B-6** | Purity: "of the 12 modules… **5** declare `PURE`, 1 READ-ONLY BY CONSTRUCTION, **3** INERT, **2** 'no I/O', and `ownershipMatrix.ts` declares nothing" | **12 total ✓, 1 READ-ONLY BY CONSTRUCTION ✓ (`ownershipCensus.ts:9-10`), `ownershipMatrix.ts` declares nothing ✓.** But `PURE` appears in **6** headers (`creationOwnerResolution.ts:25`, `operatingCompanyAuthority.ts:6`, `ownershipBackfillRules.ts:27`, `ownershipDerivation.ts:26`, `warehouseCanonicalIdRepair.ts:4`, `warehouseRootCompanyAssignment.ts:4`), `INERT` in **5** (`commercialCompanyScope.ts:26`, `operatingCompanyAuthority.ts:10`, `ownershipHandoffCommand.ts:7`, `reorderRequestLocationAuthority.ts:27`, `typedOwner.ts:7`), and **there is no separate "no I/O" class** — every `no I/O` string is the *predicate of a `PURE` sentence*, so the brief double-counts one wording as two categories. Two files are double-declared (`operatingCompanyAuthority.ts` PURE+INERT; `ownershipDerivation.ts` PURE + READ-ONLY in its title), so no flat 5/1/3/2 partition can sum to 12 | Honest partition: **5 PURE-only · 1 PURE+INERT · 1 READ-ONLY BY CONSTRUCTION · 4 INERT-header-only · 1 nothing = 12.** The brief's *conclusion* survives intact and is in fact stronger: **no module in `functions/src/ownership/` can perform I/O**, so Layer 1 cannot live there. `MI-X §5.1`'s table listed only 6 of the 12 and is therefore incomplete, though its conclusion also survives |
| **B-7** | `creditedSalespersonId` is "written by all three commercial creation paths" | **Correct but under-counts by more than half: 8 write sites.** 3 creation (`opportunityCommands.ts:178`, `salesAgreementCommands.ts:307-308`, `salesOrderCommands.ts:291-292`) + **2 update** (`opportunityCommands.ts:320-327`, `salesAgreementCommands.ts:534-538`) + invoice snapshot (`invoiceCommands.ts:316`) + invoice-downstream derivation (`financialAttribution.ts:303`) + performance-goal scope (`performanceGoal.ts:434`) | The second regime §5 warns about is **larger than two fields** — see the 15-row inventory at §5.1 |
| **B-8** | `responsibleEmployeeId` is written "(`financialAttribution.ts:164`)" | `:164` is the **interface field declaration** (`responsibleEmployeeId: string \| null;`). The **write** is `:229`; the **validation** is the shared `person()` closure at `:205-209`. The brief's `:205-209` and `:212-224` citations are exact | Minor; recorded so a reader is not sent to the wrong line |
| **B-9** | `M-4`/`OD-7` place authority at the "governed orchestration" boundary | **The phrase `"governed orchestration"` appears nowhere in the repository** (0 hits over `.ts`/`.js`/`.md`, excluding `node_modules` and `functions/lib`), and on the Firestore side **the boundary does not exist yet**: `ownershipHandoffCommand.ts:200` `stageOwnershipHandoff` is documented as uncalled — `:197` "**Nothing calls this yet.**", `:9-14` "It is NOT exported from `functions/src/index.ts`, so no callable reaches it." The only two real mutation entry points at `64008d5a` are an operator CLI (`functions/scripts/assignWarehouseRootCompany.js:234`) and a **PostgreSQL** repository (`eosCommercial/commercialOwnershipRepository.ts:193` `transferCommercialOwnership`, one `BEGIN/COMMIT` on one `PoolClient`, `:12-19`) | **This is the second architecture-changing correction.** `OD-7` names a boundary that must be **built** on the Firestore side — and the one place that boundary **already exists in the shape `OD-7` describes is in PostgreSQL**. §3.4 turns on this |

### 0.1 One thing in the brief that is exactly right, and is the spine

> **BUSINESS EMPLOYEE** is the canonical operational person concept. **SECURITY PRINCIPAL** is the
> canonical authenticated/security identity concept. **EMPLOYEE and PRINCIPAL are not the same object.**

This is not only correct, it is **already governed, and already enforced in two independent places**:

| Statement | Ref |
|---|---|
| "Employee (`employees/{employeeId}`) is the authoritative workforce identity; User (`users/{uid}`) is the authoritative application-access identity; Firebase Authentication is the credential authority only — **the three are never merged into one entity**" | `docs/CLAUDE_CONTEXT.md:62` |
| "The canonical business Employee is `employees`; the security identity is [`eos_policy.principals`]" | `functions/migrations/1758412800000_employee-principal-linkage.sql:5` |
| "A person AT an Account. **Not a login** … Nothing here references `eos_policy.principals`, and **nothing may**: a customer's contact is not a principal of this system, and joining the two would make one" | `functions/migrations/1758758400000_crm-account-contact-location.sql:199-201` |

The third is the important one. PostgreSQL **already contains** a person-shaped business table
(`contacts`, `:203-229`) that is deliberately and structurally **not** an identity. The discipline
this lane recommends is therefore **not a new idea in this repository — it is an existing, enforced
one, applied to a second person type.**

### 0.2 The brief's two objects are three, and the third is why the model works

| Layer | Concept | Question it answers | Bearer today | Bearer in target |
|---|---|---|---|---|
| **CREDENTIAL** | Firebase Authentication | *What proved this session?* | Firebase Auth | **Firebase Auth — permanently** (`firebase-exit-manifest.json:13-20`, `trendsToZero: false`) |
| **PRINCIPAL** | security identity | *Who may act, in which tenant, with which Roles?* | `users/{uid}` (Firestore) **and** `eos_policy.principals` (PostgreSQL, undeployed) | **`eos_policy.principals`** |
| **EMPLOYEE** | business person | *Who is accountable?* | `employees` (Firestore) | **a PostgreSQL Employee relation that does not exist** (§1.4) |

The pattern the PRINCIPAL layer already uses is the one the EMPLOYEE layer needs, and it is stated
outright at `docs/architecture/SYSTEM_AUTHORITIES.md:54`:

> "**Identity is provider-neutral:** `principals.id` is EOS-native and `(identity_provider,
> external_subject)` is the MAPPING to whatever proved the identity, so **replacing Firebase is a row
> per principal rather than a rewrite** of every assignment, access-version row and audit event."

**Read that as a design rule and it generalizes:** a layer that holds an EOS-native key and a
*mapping* to the layer below it can have the layer below replaced without rewriting anything above.
That is the whole architecture in §3, applied one level up: an Employee relation holding an
EOS-native key plus a *mapping* to a principal, so that replacing the principal's provider — or the
Employee's own datastore — is a row per link rather than a rewrite of every ownership reference.

---

## 1. THE SMALLEST AUTHORITATIVE MODEL SATISFYING `OD-6`

### 1.1 The ten required capabilities, assessed against every candidate

`Y` = satisfied at `64008d5a` · `P` = partial, with the defect named · `N` = absent · `—` = not applicable

| # | Capability | `employees` (Firestore) | `eos_policy.principals` | `employee_principal_links` | `users` | `fieldops_technicians` | Firebase Auth |
|---|---|---|---|---|---|---|---|
| **1** | **stable Employee identity** | **P** — doc id is the key, and `employeeId` is refused as editable (`employeeProfileCommands.ts:238`, "the immutable document identifier"); but the body copy is **unenforced** (`field-ops-app-vite/src/metadata/definitions/employee.js:121-127`: "also written into the document body… **Nothing enforces the two match**") and there is **no TS interface, no zod schema, no read guard** for the document anywhere | N — its key is a *principal* id | N — `employee_id` is "**Opaque here**" with a shape `CHECK` only (`…1758412800000:119-120`, `:157-158`) | N — keyed by Firebase uid | N — own third id space | N — a credential subject |
| **2** | **existence** | **Y** — `snap.exists`, Admin-SDK only. 7 trusted gating reads + 4 Rules sites = **11 gating sites** (B-5) | P — proves a *principal* exists, not an Employee | **N** — the row is a **prior assertion**, not the authority's own statement about the Employee | N | **N — anti-satisfied**: a dispatcher client can *create* a row (`firestore.rules:407-408`), so "exists" would be a fact a browser can manufacture | N |
| **3** | **current status** | **Y** — `employmentStatus`, six frozen values (`employeeProfileCommands.ts:122-129`), two writers, mirror drift-guarded by test (`:114-121`) | N — `principal_status` is `'active'\|'disabled'`, a *security* flag | **N, by explicit design** — `…1758412800000:107-108` "no `employment_status`" | **N** — holds no employment fact at all | **N** — `status` is dispatch state `available\|on_job\|off_shift` (`firestore.rules:346-348`), **disjoint** from `employmentStatus`; written as a job-completion side effect (`completeAssignedJob.ts:316`) | N — claims capped at 4 non-identity keys (`compactClaims.ts:21-27`) |
| **4** | **historical identity retention** | **P — and this is the decisive gap.** See §1.2 | N | **Y for the LINK** — `status IN ('active','revoked')` + partial unique indexes on active rows only (`…1758412800000:143`, `:169-175`), so revoked links accumulate | N | N | N |
| **5** | **eligibility facts for current accountability** (`MI-R` minimum: governed employment/person status) | **Y** — `employmentStatus == "ACTIVE"` is the only shipped eligibility fact, fail-closed on everything else | N | N | N | N | N |
| **6** | **Principal linkage** | **P** — via `employees.userId` ↔ `users.employeeId`, a **denormalized mutually-asserting pair**, not a relation. See §1.3 | P — it is the principal side, but carries **no `employee_id` column at all** (`…1758412800000:7`) | **Y in shape** — the only artifact anywhere carrying `employee_id`, under a closed `link_source` vocabulary (`:140`); but unreachable and its live application is UNPROVEN (§6 `U-2`) | P — it is the *only* join point, holding both `employeeId` and `technicianId`; write-denied to clients (`firestore.rules:429`) | N | N |
| **7** | **technician linkage where required** | **N — ABSENT EVERYWHERE, AND INFERENCE IS FORBIDDEN.** See §1.3 | N | **N, by explicit design** — `…1758412800000:107-108` "no `technician_id`" | P — `users.technicianId`, one-way and unchecked, populated on **1 of 62** nonprod docs | — (it *is* the technician record) | N |
| **8** | **operating-company context where required** | **Y** — `operatingCompanyId` (`employeeProfileCommands.ts:215`), shape-validated `:348`, pattern `:146`. *Membership* is not checked | N | **Y** — `operating_company_id TEXT NOT NULL` (`…1758412800000:115-124`) | N | N | N |
| **9** | **server-side authoritative resolution** | **Y, and uniquely twice over** — Admin SDK *and* enforceable inside `firestore.rules` (4 sites). No other candidate can be read from Rules | **N from the resolver's runtime** — see §1.5 | **N** — same, plus no `functions/src` module imports `employeeIdentity` | Y (Admin SDK + Rules) | Y (but see #2) | Y |
| **10** | **PostgreSQL / zero-Firebase target compatibility** | **N — AND THIS IS THE FINDING THE ANTI-EASINESS RULE POINTS AT.** See §1.4 | **Y** — already the PostgreSQL security authority | **Y** — already PostgreSQL, and pre-shaped for the FK (`…1758412800000:54-57`) | **N** — Firestore, `BUSINESS_RUNTIME` | **N** | **Y** — `IDENTITY_ONLY`, `trendsToZero: false` |

### 1.2 Capability 4 — historical identity retention: **satisfied in fact, unguaranteed in principle**

This lane verified retention directly, because `OD-6` state **B** depends on nothing else.

| Question | Finding | Evidence |
|---|---|---|
| Can a client delete an Employee? | **No — nobody can, through Rules, including admin** | `firestore.rules:497` `allow create, update, delete: if false;` and the prose at `:448-452` "**No client, in any role including admin, may create/update/delete an Employee**" |
| Does any trusted path delete one? | **No. There is no delete path anywhere.** `grep -E '\.delete\(\)\|deleteDoc\|recursiveDelete'` over `functions/src/**` + `functions/scripts/**`, intersected with `employee` → **zero hits** | verified this lane |
| Is a former employee representable? | **Yes** — `TERMINATED` and `RETIRED` are two of the six frozen values (`employeeProfileCommands.ts:126-127`), and **`separationDate` already exists** as an editable field (`:217`) | `metadata/definitions/employee.js:256-262` — "Optional ISO calendar day (YYYY-MM-DD), stored as a string" |
| Does anything *derive* from `separationDate`? | **No. Nothing reads it.** There is no `terminationDate` field anywhere (0 hits) | verified this lane |
| Do consumers distinguish `TERMINATED` from `ON_LEAVE`? | **No. All five non-`ACTIVE` values collapse to one bucket at every consumer** | `operationalRoleContext.ts:51-52`: "`employmentStatus !== \"ACTIVE\"` -> false (any other status, **including ON_LEAVE/INACTIVE/TERMINATED/RETIRED/CONTRACTOR/missing/non-string**)"; same collapse `adminCredentialCommands.ts:183`, `:223` |

**So capability 4 is satisfied *de facto* and not *de jure*, and the distinction is the whole gap:**

1. **Retention is emergent, not invariant.** It holds because no delete path was ever written — an
   absence, not a guarantee. Nothing in Rules, DDL, a test, or a header states that an Employee
   record must survive the end of employment. A single future administrative-delete feature would
   silently convert every historical accountability reference from state **B** to state **C**.
2. **The data model can express B; no code path reads it.** `TERMINATED` + `separationDate` is
   exactly state **B**, sitting in storage, and every consumer flattens it into "not `ACTIVE`" —
   which is the correct **Layer 2** answer and destroys the **Layer 1** distinction `#182` requires.
   `OD-6` says `UNRESOLVED` "must not be the automatic representation" for
   `INACTIVE / TERMINATED / FORMER`; at `64008d5a` the automatic representation is *deny*, which is
   Layer 2's answer substituted for Layer 1's.

**One correction to how `OD-6` is likely to be read.** `OD-6` requires that NON-EXISTENT and
DELETED/UNRESOLVABLE "must not yield the same authoritative `RESOLVED` as a real Employee". That is a
requirement that **both be excluded from `RESOLVED`** — it is **not** a requirement that they be
distinguished *from each other*. Both therefore land in state **C**, and no tombstone capability is
needed to satisfy `OD-6` as quoted. `U-7`/`U-10`'s tombstone question is real but is **not** on
`OD-6`'s critical path. What `OD-6` *does* require distinguishing is **B from C** — and that needs
retention, which is capability 4.

### 1.3 Capabilities 6 and 7 — linkage: one relation faked with two fields, and one missing entirely

**Principal linkage (6) is not a relation.** It is `employees/{id}.userId` and `users/{uid}.employeeId`,
two denormalized fields that must **agree in both directions** to be trusted:

| Fact | Evidence |
|---|---|
| Reciprocity is the only accepted derivation | `employeePrincipalLink.ts:36-39` — `RECIPROCAL_FIREBASE_UID_LINK`, both directions |
| One writer, four aborts, paired write | `provisionEmployeeAccess.js:3-4` "**the only writer** of `employees/{employeeId}.userId` and `users/{uid}.employeeId`"; guard `:608-610`, aborts `:616-646`, write `:648-649` |
| `employmentStatus` is trusted **only** through that reciprocity | `adminCredentialCommands.ts:274-276` — "trusted **ONLY** when the link is [reciprocal]… otherwise it is null (**deny**)" |
| It is **provably not always populated, in production** | `be1e5579:docs/assessments/r32-production-exposure-census.json:21-28` — `"principalUid": "JBslDvmpq8RqQAiyzfvwne9yCWc2"`, `"employeeId": null`; anomaly `…census.md:120` `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` |
| Absence is a *documented expected state*, not an error | `field-ops-app-vite/src/auth/employeeSession.js:52-62` "Missing `employeeId` is a **valid, expected migration state, not an error**" |

A relation with a uniqueness constraint cannot be half-written; a **pair of fields can**, and in
production one of them is. `employee_principal_links` is the same fact expressed as an actual
relation with actual constraints — which is why §3 puts it in the target and the field pair in
transition.

**Technician linkage (7) is absent, and this is the only capability no candidate supplies at all.**

| Fact | Evidence |
|---|---|
| `employees` carries no `technicianId` | verified: no such field on any write or type in `functions/src` or `field-ops-app-vite/src` |
| `fieldops_technicians` carries no `employeeId` | field census `functions/scripts/auditLegacyJobTechnicianData.js:48` `KNOWN_TECHNICIAN_FIELDS = ["name", "phone", "status", "createdAt"]` |
| Inferring it from the id coincidence is **forbidden in four files** (B-3) | `employeePrincipalLink.ts:43-47` "**THERE IS NO THIRD TERM**… a rule inferred from the 11 is provably wrong for the 2" |
| The only route is two hops through `users`, written by a *different, manual* script | `assignTechnicianToUser.js:10-16` — "**No automatic mapping exists (and none is invented here)**: there is no existing signal anywhere in this system that says 'this Firebase Auth user corresponds to that technician document'" |
| And that route's own linkage field is **client-corruptible** | `fieldops_technicians.userId` sits inside the no-`hasOnly` dispatcher write surface (`firestore.rules:418-419`), so a dispatcher client can **repoint a technician at a different uid**. The ruleset *has* the helper (`:349-351` `affectedKeys().hasOnly(['status'])`) and applies it to `fieldops_jobs`, **not here** |

### 1.4 Capability 10 — **the finding the Owner's anti-easiness instruction points *at*, not away from**

The Owner's instruction, twice: *do not promote an existing compatibility collection merely because it
is easy to query*; *do not choose based on easiest current implementation*. The brief warns that a
prior lane found `employees` both the only viable existence source and the easiest to query, and
calls that coincidence "a trap, not an argument."

**Following the instruction leads somewhere specific, and it is not `employees`.**

| Step | Evidence |
|---|---|
| The governing control document defines the target runtime | `firebase-exit-manifest.json:9` — "Browser -> Vercel -> Firebase Auth token -> Render EOS API -> EOS authorization -> **PostgreSQL**" |
| …and what must move | `:10` — "**All business data**, business authorization, and business transport **must run through the Render EOS API against PostgreSQL, not through Firestore or Firebase Functions**" |
| Firestore is `BUSINESS_RUNTIME` and **must trend to zero** | `:22-38`, `"trendsToZero": true`, ratchet enforced by `scripts/firebaseExitGuard.mjs` (`:56`), "**baselineIsAFloorNotATarget: true**" (`:57`) |
| Firebase Auth is `IDENTITY_ONLY` and **need not** | `:13-20`, `"trendsToZero": false` |
| An Employee is **business data** — it is, by the Owner's own words, "the canonical **operational** person concept" | the brief's spine, §0.1 |

**Therefore: Firestore `employees` is, by the repository's own governing manifest, a dependency that
must trend to zero.** Promoting it to *permanent* canonical business Employee authority would
contradict `firebase-exit-manifest.json:10` directly.

**This is why the easy answer and the right answer diverge, and it is a stronger result than "do not
pick the easy one":** the easy source is the one the repository has **already ruled temporary**.
Honoring the Owner's instruction therefore means naming **PostgreSQL** as the target business
Employee authority — the harder answer, requiring storage that does not exist — and naming Firestore
`employees` as a **transitional bearer only**, never as the permanent authority.

**And the cost of delay is now measurable, which the brief did not know.** The `OD-6` Layer-1 defect
has **already been reproduced into the forward-looking PostgreSQL schema**. Unconstrained opaque
employee ids, no FK on any of them:

| Column | Migration |
|---|---|
| `owner_employee_id` on `accounts` · `contacts` · `account_locations` | `1758758400000_crm-account-contact-location.sql:176`, `:219`, `:262` |
| `owner_employee_id` on `opportunities` · `sales_agreements` · `sales_orders` | `1758844800000_commercial-ownership-authority.sql:184`, `:208`, `:233` |
| **`previous_owner_employee_id` / `new_owner_employee_id` on `ownership_handoffs`** | `1758844800000:262-263` |
| Any FK anywhere onto a person table | **none** — `grep -niE "REFERENCES[[:space:]]+(eos_policy\.)?(employees\|persons\|people\|users)"` over all 18 migrations → **zero** |

The *handoff* table — the artifact `OD-1` invariants 6 and 7 are about — already stores two
unvalidated person references in PostgreSQL. Migrating as-is carries the defect across the datastore
boundary rather than leaving it behind.

### 1.5 Capability 9 — why no PostgreSQL candidate can serve today, re-verified

The brief's claim is **correct and now proved by transitive closure**, not by grep alone:

| Fact | Evidence |
|---|---|
| `pg` **is** a declared dependency of the `functions` package | `functions/package.json:167-173` |
| …and is unreachable from the deployed entrypoint | transitive import closure from `functions/src/index.ts` over `src/` (ignoring `lib/`): **297 files reachable, ZERO import `pg`**; `eosApi/server.ts` **not reachable**; `policyDatabase` **not reachable**; `employeePrincipalLinkRepository` **not reachable** |
| The pool has exactly one construction site, rooted only at a separate process | `adminPolicy/policyDatabase.ts:28` (`import { Pool } from "pg"`), `:129`; roots solely at `eosApi/server.ts` |
| No `knex`, `drizzle`, `prisma`, or Cloud SQL connector | zero hits; the one `@google-cloud/cloud-sql-connector` is a **dev-only transitive dependency of `firebase-tools`** (`functions/package-lock.json:5939`) |
| And the consumer process **is not deployed** | `eosApi/server.ts:19-23` "**NOT DEPLOYED** — … **there is no Render service, and creating one needs Owner action**"; `docs/architecture/eos-policy-nonprod-activation.md:3-8` "**MERGED TO `main`. NOT DEPLOYED.** … **Merged code is not running code.**"; `render.yaml:56-75` is a committed blueprint for a never-provisioned resource |

**Note this partially resolves `MI-X` conflict `C-5`** (`SYSTEM_AUTHORITIES.md:54` "NOT DEPLOYED" vs
`eos-real-nonprod-activation.md:112` "Render — EXISTS"): the *policy* database service is not
deployed per three independent statements; whichever is current, **Cloud Functions still has no
PostgreSQL path**, so the conclusion is unaffected. Carried, not resolved (§7 `C-5`).

### 1.6 The smallest model — **three relations, and no fourth**

*Smallest* is load-bearing, so the exclusions are stated as firmly as the inclusions. Named as
**capabilities and relationships**, never as columns.

| | Relation | Must carry | Must NOT carry |
|---|---|---|---|
| **R1** | **BUSINESS EMPLOYEE** — the canonical operational person | an EOS-native, immutable, opaque identifier that is **never a credential key**; an **existence** fact only this relation can assert; **one** governed employment-status fact from a closed vocabulary with a single writer; **retention across the end of employment as an invariant, not an accident**; operating-company context | any credential or authentication fact; any dispatch/scheduling state; skills; contact details; HR data; a second status axis; any Role or permission |
| **R2** | **EMPLOYEE ↔ PRINCIPAL LINK** — the crosswalk | which Employee and which principal are the same person; the provenance of that assertion, from a closed vocabulary; whether the link is live or superseded, with superseded links **retained**; the tenant the link holds in | **nothing else about either side** — and this is already written down: `…1758412800000:107-111` "No `external_subject`, no `identity_provider`, no `display_name`, no `employment_status`, no `technician_id`, no `skills`… The link table says **WHICH TWO THINGS ARE THE SAME PERSON, and nothing else about either of them**" |
| **R3** | **SECURITY PRINCIPAL** — the canonical security identity | **exists already** as `eos_policy.principals` (`1757548800000_tenant-and-identity.sql:79-93`). **No change proposed** | — |

**Explicitly excluded from the minimum, so this does not become a person-master platform:** skills;
dispatch status; contact information and email (`employees` has **no** `email` field —
`docs/CLAUDE_CONTEXT.md:236`, and `provisionEmployeeAccess.js:68` says `--email` is "**NEVER** written
to `employees/{employeeId}`"); org hierarchy beyond the one existing manager pointer; account
enable/disable state (a separate axis by ruling — `SYSTEM_AUTHORITIES.md:121`, "deriving it from
employment status would show a CONTRACTOR who holds access as switched off"); any second person-status
axis; any Role, permission or Condition.

**Technician linkage (capability 7) is deliberately NOT in R1 or R2.** It is a *third* relationship
between a business Employee and a dispatch resource record, and forcing it into either would
re-create the very conflation four trusted files forbid. Whether it belongs in the minimum at all is
an Owner question (§4.2, `MI-θ`) — this lane's position is that it does **not**, because no `OD-6`
state depends on it.

### 1.7 The honest conclusion, stated plainly as the brief requires

| Horizon | Does a minimum model satisfy `OD-6` without new storage? | Why |
|---|---|---|
| **INTERIM** (Firestore is still the system of record) | **YES — no new storage is required**, and this is a genuine result rather than a convenience | Capabilities 1–3, 5, 8, 9 are satisfied by `employees` today; capability 4 is satisfied *in fact* (§1.2) and needs a **governed invariant plus a test**, not a schema; capability 6 is satisfied for the reciprocal-link population and **fails closed** outside it; capability 7 is not required by any `OD-6` state. What must be **built** is not storage — it is the **resolution boundary `OD-7` names, which does not exist on the Firestore side** (B-9) |
| **TARGET** (`firebase-exit-manifest.json:9-10` end state) | **NO. New storage is required, and it is R1.** | There is **no business-person relation in PostgreSQL at all** — not `employees`, not `persons`, not `people` among 54 tables; no employment-status concept in any of 18 migrations; and the DDL says so in the imperative: `…1758412800000:46-47` "**THERE IS NO `employees` TABLE IN POSTGRESQL YET.**" R2 exists but cannot assert existence (`employee_id` is "**Opaque here**"); R3 exists and is fine |

**The class of storage required, named as the brief asks:** a **governed, server-only,
transactionally-writable business-person relation in PostgreSQL, behind the Render EOS API**, holding
capabilities 1–5 and 8 and nothing else; plus the **addition of a referential constraint to the
existing link relation R2** — which migration 008's header already names as the follow-up it was
shaped for (`…1758412800000:54-57`: "the constraint is the only thing that has to be added").

**Not a new person-master platform. One relation, one constraint.**

---

## 2. RECONCILIATION AND CLASSIFICATION OF EVERY CANDIDATE

One class each, as required. Where current and target roles differ, both are stated.

| Candidate | **CLASSIFICATION** | Current role | Target role | Justification from evidence |
|---|---|---|---|---|
| **`employees`** (Firestore) | **TRANSITIONAL COMPATIBILITY** | **CANONICAL BUSINESS AUTHORITY, in fact and by five statements** | **Superseded by R1 in PostgreSQL; archived** | It *is* the canonical business Employee today — `firestore.rules:433-436` "**Employee is the authoritative workforce identity**"; `employeePrincipalLink.ts:5` "**The canonical business Employee is Firestore's `employees` collection**"; `employeePrincipalLinkPlan.ts:19-20`; `SYSTEM_AUTHORITIES.md:121`; `ownershipMatrix.ts:514`. It is also, by `firebase-exit-manifest.json:22-38`, a `BUSINESS_RUNTIME` dependency that **must trend to zero** (§1.4). **A collection that must trend to zero cannot be the permanent authority.** Classified TRANSITIONAL *because of* the manifest, not because of any defect in it — and explicitly **not** demoted to LEGACY: it is authoritative today and must be treated as such until R1 exists |
| **`eos_policy.principals`** | **CANONICAL SECURITY AUTHORITY** | Coded, proved against a real PostgreSQL database, **not deployed** (`SYSTEM_AUTHORITIES.md:54`; `eosApi/server.ts:19-23`) | **Unchanged — it is already right** | "The security identity is `eos_policy.principals`" (`employeePrincipalLink.ts:5-6`). Provider-neutral by design (`SYSTEM_AUTHORITIES.md:54`), EOS-native key, `UNIQUE (identity_provider, external_subject)` with the rationale that "a second sign-in path could mint a second principal for the same human and **split their Roles in half**" (`1757548800000:88-89`). It holds **no `employee_id`** (`…1758412800000:7`), **no type/kind column**, and no employment concept — which is exactly correct for a security authority and exactly why it is not the person authority |
| **`employee_principal_links`** | **LINK / CROSSWALK** | DDL only; **unreachable** (no `functions/src` module imports `employeeIdentity`); live application **UNPROVEN** (§6 `U-2`) | **R2 — the canonical crosswalk, with the FK added** | "The link table says **WHICH TWO THINGS ARE THE SAME PERSON, and nothing else about either of them**" (`…1758412800000:107-111`). Closed `link_source` vocabulary enforced in SQL *and* TS (`:140`; `LINK_SOURCES` `employeePrincipalLink.ts:49`). Its composite FK onto `tenant_memberships` (`:133-135`) already prevents cross-tenant identity leak. Its partial unique indexes (`:169-175`) already implement **retention with a live-state constraint** — the pattern R1 needs. It **cannot** be the person authority: `employee_id` is a prior assertion, not the authority's own statement of existence |
| **`users`** (Firestore) | **TRANSITIONAL COMPATIBILITY** | The Firestore-era **stand-in for the principal**, and the **only** join point holding both `employeeId` and `technicianId`; the only candidate readable from a Rules `get()` by uid (`firestore.rules:14-16`) | **Superseded by `principals` + R2; retired** | "**A login is not a person record**" (`employeePrincipalLink.ts:68-69`); "User (`users/{uid}`) is the **authoritative application-access identity**" (`CLAUDE_CONTEXT.md:62`); measured to carry "**no** surviving business fact" (`…p1b-census.md:811`). Its access role is **already superseded**: "`principalContext.ts` is the sole answer to who/which tenant/which Roles, read only from PostgreSQL — **never** a custom claim, **`users/{uid}.role`**, **`employees.securityRole`**" (`SYSTEM_AUTHORITIES.md:54`). **TRANSITIONAL, not LEGACY**, for one reason: it is load-bearing *right now* as the Rules-readable linkage (4 `get(employees/…)` sites all traverse it) and it has **no declared type anywhere** (`callerContext.ts:8-13` omits `employeeId` entirely) |
| **`fieldops_technicians`** | **LEGACY** | A field-service **dispatch resource record**, person-*shaped*, actively used, **client-writable** | **Retired — but only after its unique facts are re-homed** | Denied the identity role in **four** trusted files (B-3). "a field-service resource record, **not the enterprise Employee model**" (`docs/BusinessEntityModel.md:265`); "Job / Technician (**legacy**, still real and in active use)" (`docs/PROJECT_ARCHITECTURE.md:90`); "technician is a **ROLE on Employee, not a family**" (`field-ops-app-vite/test/objectListMetadataAuthority.test.mjs:179`). Disqualified as authority because a dispatcher client can mint a row (`firestore.rules:407-408`, no `hasOnly`) — "exists in the authority" would be browser-manufacturable. **LEGACY is not "retirable now":** it holds facts nothing else holds (skills on **0 of 60** employees; dispatch status with no `employees` equivalent — `…p1b-census.md:807-810`), and `employeePrincipalLink.ts:81-83` reserves `TECHNICIAN_ONLY_BUSINESS_FACT` for exactly that. **`ownershipMatrix.ts:515` labelling it "person authority" is inconsistent with all four** — see §7 `C-1` for both readings of what that row *is* |
| **Firebase Auth** | **NOT AUTHORITY** — for any person or business fact | **CREDENTIAL authority only**, and it holds **zero** employee facts | **Unchanged — retained permanently in this role** | "Firebase Authentication is the **credential authority only** — the three are never merged into one entity" (`CLAUDE_CONTEXT.md:62`). Verified: custom claims are capped at four non-identity keys and **throw** on any extra — `compactClaims.ts:21-27` `ALLOWED_CLAIM_KEYS = ["companyId","platformAdmin","companyAdmin","accessVersion"]`, `:66-73`; **no `employeeId` claim exists**; claims are "**NOT ACTIVATED IN PRODUCTION**" (`claimsWriter.ts:7-15`); `firestore.rules` **never reads `request.auth.token`** (zero matches). "A Firebase UID is an **EXTERNAL IDENTITY KEY ONLY**… never an EOS-native identifier, and never an Employee id" (`employeePrincipalLink.ts:6-8`). **NOT AUTHORITY for persons; and it is the legitimate, permanent authority for credentials** — `firebase-exit-manifest.json:13-20`, `trendsToZero: false` |

### 2.1 The three the brief warned about, answered directly

> Legacy/compatibility identities — `users`, `fieldops_technicians`, Firebase Auth identity — **must
> NOT become the permanent business Employee authority merely because they contain overlapping data.**

**None of them does, and none of them is close.** `users` holds no employment fact and is in the
wrong key space for every stored person reference. `fieldops_technicians` is client-writable and its
`status` is disjoint from employment. Firebase Auth holds four claim keys, none of them a person fact.
**The real risk the brief is guarding against is not these three — it is `employees` itself**, which
*is* the business authority today, *is* the easiest to query (11 gating sites already written), and
*is* classified `BUSINESS_RUNTIME/trendsToZero:true` by the governing manifest. §1.4 is that argument.

---

## 3. RECOMMENDED ARCHITECTURE

### 3.1 In one paragraph

**Three layers, permanently separated; one business person relation; one crosswalk; one resolution
boundary.** Firebase Auth stays forever as the **credential** authority and holds no person fact.
`eos_policy.principals` is the canonical **security** identity and holds no employment fact. A new
PostgreSQL **business Employee** relation (R1) is the canonical operational person and holds no
credential fact. R1 and `principals` meet **only** through the existing link relation
(`employee_principal_links`, R2) — never by a shared key, never by a field on either side, and never
by an inferred id coincidence. Person-reference resolution happens at **exactly one** governed
mutation boundary per `OD-7`, behind **one** capability-shaped port with **one** implementation at a
time: Firestore today, PostgreSQL after cutover. History is retained by **snapshotting the act**, not
by re-resolving the person.

### 3.2 What is canonical for what

| Concept | Canonical authority | Never the authority for |
|---|---|---|
| *What proved this session* | **Firebase Authentication** — permanently (`firebase-exit-manifest.json:13-20`) | anything business; any person fact; any Role |
| *Who may act, in which tenant, with which Roles* | **`eos_policy.principals`** + `tenant_memberships` + `user_role_assignments` | employment; accountability; any business identity |
| *Who is accountable* | **R1, the business Employee relation** — PostgreSQL in target, Firestore `employees` in transition | authentication; Roles; permissions; dispatch state |
| *Which Employee and which principal are the same person* | **R2, `employee_principal_links`** | any attribute of either side |
| *Dispatch/field-service resource state* | `fieldops_technicians` while it lives; a re-homed capability after | person identity; existence; employment |

### 3.3 How business identity and security identity link — and the three rules that keep them apart

The linkage is **one relation, one direction of truth, three prohibitions.**

| Rule | Statement | Already-existing basis |
|---|---|---|
| **L-1** | **The link is a relation, not a field.** Neither R1 nor `principals` carries the other's key. All linkage lives in R2, constrained on both sides | `principals` already carries no `employee_id` (`…1758412800000:7`); R2 already exists and already carries both. Today's reciprocal **field pair** (`employees.userId` ↔ `users.employeeId`) is the transitional stand-in and is **provably half-written in production** (§1.3) |
| **L-2** | **The link is tenant-scoped and its liveness is constrained, its history retained.** One live link per Employee and per principal per tenant; superseded links are kept, not deleted | **already built** — `…1758412800000:133-135` (composite FK), `:143` (`status IN ('active','revoked')`), `:169-175` (two partial unique indexes on active rows only) |
| **L-3** | **A link's existence is never evidence that either side exists.** R2 asserts sameness; **only R1 asserts an Employee exists**, and only `principals` asserts a principal exists | `…1758412800000:119-120` "**Opaque here**"; the FK is the thing that must be added (`:54-57`) |
| **P-1** | **Authentication identity is never business identity.** No credential key is ever an Employee key, and no Employee key is ever presented as a subject | `employeePrincipalLink.ts:6-8` "A Firebase UID is an **EXTERNAL IDENTITY KEY ONLY**… never an EOS-native identifier, and never an Employee id" |
| **P-2** | **No id coincidence is ever a link.** Sameness is asserted from a closed provenance vocabulary or it does not exist | `employeePrincipalLink.ts:43-47` "**THERE IS NO THIRD TERM**"; enforced by the SQL `CHECK` at `…1758412800000:86-92`, so adding a term requires "a diff a reviewer reads" |
| **P-3** | **Provider replacement is a row per link, never a rewrite.** Because R1 holds an EOS-native key and R2 holds the mapping, replacing Firebase Auth — or moving R1's datastore — touches links, not references | the generalization of `SYSTEM_AUTHORITIES.md:54`'s provider-neutrality (§0.2) |

### 3.4 Where resolution executes — `OD-7` (#184) applied, and the property that makes it cheap

`OD-7` ruled option **(e)**: governed orchestration is the authoritative handoff boundary; the pure
builder keeps family/axis validation; the writer keeps audit construction; **the writer does not
independently query Employee authority**, because "duplicating that lookup in a lower writer would
create two authority decisions that could drift."

**Applied, as an ordered contract:**

| Stage | Does | Does **not** | Basis at `64008d5a` |
|---|---|---|---|
| **1. Governed mutation entry point** | resolves the person reference **exactly once** against the Employee authority, inside the same transaction as the business mutation, and refuses the mutation on a non-admitted outcome | — | `OD-7`(e); `M-4` (#183) |
| **2. Pure builder** | family/axis validation, shape, governance class | **cannot** perform the lookup — its purity *forecloses* it | all 12 ownership headers (B-6); `ownershipHandoffCommand.ts:73` "Pure: no Firestore, no I/O, no clock"; `commercialOwnershipAuthority.ts:5-8` "**NO I/O**" |
| **3. Audit writer** | stages exactly one audit event onto the **caller-supplied** transaction | **no second lookup** | `auditEventWriter.ts:22-26`; `ownershipHandoffCommand.ts:194-198` "staged onto a caller-supplied transaction or batch… **never independently**" |

**Two facts about this boundary that the brief did not have, and they matter:**

1. **On the Firestore side the boundary does not exist.** `stageOwnershipHandoff`
   (`ownershipHandoffCommand.ts:200`) is the seam, and it is **uncalled**: `:197` "**Nothing calls
   this yet**", `:9-14` not exported from `index.ts`. The only live caller anywhere is an operator CLI
   (`functions/scripts/assignWarehouseRootCompany.js:234`), dry-run by default (`:17-23`). **`OD-7`'s
   boundary is therefore something to be built, not something to be relocated into.**
2. **On the PostgreSQL side it already exists, in exactly the shape `OD-7` describes.**
   `eosCommercial/commercialOwnershipRepository.ts:193` `transferCommercialOwnership` — one function,
   one transaction, "**they share one explicit `BEGIN/COMMIT` on one `PoolClient`**" (`:12-19`),
   composed over a pure builder that declares `NO I/O` (`commercialOwnershipAuthority.ts:282`, `:5-8`).

**The architectural consequence, and it is the recommendation's load-bearing property:**

> **The `OD-7` boundary is stable across the Firebase exit even though the datastore is not.**

Resolution sits behind **one capability-shaped port** — *"does this reference denote an Employee, and
what is its governed status?"* — with exactly **one implementation live at a time**: a Firestore read
in transition, a SQL read in the target. Two consequences:

- **`MI-X §4.7`'s "second cutover cost" is answerable rather than merely feared.** Its concern was
  that "a Layer 1 implementation that hard-codes a Firestore read is a second cutover cost the Owner
  should price now". Behind a single port, that cost is **one adapter**, not a re-audit of every
  reference — *provided* the port is introduced before the implementation, which is why §4.1 orders
  it first.
- **`M-4` and `OD-7` are satisfied structurally, not by discipline.** The writer cannot drift into a
  second lookup because it never receives the authority handle; the builder cannot, because its
  purity forecloses it. Defence in depth comes where `OD-7` says it does: a single governed entry
  point, pure validation, caller authorization, transaction atomicity, audit, and **tests prohibiting
  bypass paths** — not a second lookup.

**On `O-1` — both readings carried, and `OD-7` largely settles which one survives.**

| Reading | Statement | Status |
|---|---|---|
| **(i)** | `#182` Layer 1 **supersedes** `O-1`'s exclusion, and the resolver may perform the cross-collection lookup | **Contradicts `OD-7`(e)**, which keeps the pure builder pure, and contradicts all 12 purity headers. If the Owner intends it, the supersession must be **stated in the ruling**, not inferred |
| **(ii)** | `O-1` **stands**; resolution lives at the governed entry point and the resolver stays deterministic | **Consistent with `OD-7`(e), with all 12 headers, with all three shipped trusted-side validators, and with `creationOwnerResolution.ts:25-26`'s own prescription** ("the caller reads the upstream document… and hands the derivation in") |

`typedOwner.ts:44-48` is the text at issue: "Producing UNKNOWN for an employee id would require a
cross-collection existence lookup, **which Owner ruling `O-1` explicitly excluded**". Reading (ii)
leaves that sentence true and simply moves the question upstream. **This lane recommends (ii) and
cannot rule it** — `…DECOMPOSITION.md:176` requires the choice be said "out loud" (§4.2, `MI-β`).

### 3.5 How the four `OD-6` states are established — **capabilities, not field names**

`#182` §3 withholds field and enum names, so each state is defined by **which capability answers it**.

| `OD-6` state | Established by | Required capability | Must not be |
|---|---|---|---|
| **A** `VALID_CURRENT` | the **existence** capability answers *present*, **and** the **governed-status** capability returns a value the family's eligibility policy admits | 2 + 3 + 5 | conflated with "the string parsed" — `#182`: a non-empty string, type `USER`, and a successful parse are **each insufficient** |
| **B** `VALID_HISTORICAL / NOT_CURRENTLY_ELIGIBLE` | the **existence** capability answers *present*, **and** the governed-status capability returns a value the family's policy does **not** admit | 2 + 3 + **4, the retention capability** | represented as unresolved, or as C. `#182` is explicit: `INACTIVE / TERMINATED / FORMER ≠ NON-EXISTENT`, and unresolved "must not be the automatic representation for them". **At `64008d5a` the automatic representation is *deny* — Layer 2's answer substituted for Layer 1's** (§1.2) |
| **C** `MISSING / INVALID_REFERENCE` | the **existence** capability answers *absent* (this **covers both never-existed and removed**, §1.2), **or** the reference is **outside the authority's key namespace** so the question cannot be asked of it | 2, plus a **namespace-membership** capability | conflated with B; conflated with D; **and never produced by a namespace mismatch masquerading as a lookup miss** — `C-B2` (`…DECOMPOSITION.md:217-222`) requires a distinct "cannot ask" outcome precisely so a mismatch does not "manufacture orphans at exactly the scale of the mismatch" |
| **D** `NONE` | no person reference is stored at all | a first-class **absence** representation | conflated with C. **`OD-1` invariant (1): never NONE on actionable work** |

**A fifth outcome is required, and it is outside the four states.** Not a person-reference state — a
**resolution outcome**:

> **AUTHORITY-UNAVAILABLE / CANNOT-ASK.** When the authority cannot be consulted — the datastore is
> unreachable, the transaction cannot include the read, or the reference is outside the authority's
> key namespace — the resolver must produce an outcome **distinct from C**. On a mutation it must
> **fail closed** and refuse. On a read it must **not** be recorded as C.

Without it, an authority outage and a namespace mismatch both silently become "this person does not
exist", which manufactures false state-C at the scale of the outage or the mismatch — and
`creditedSalespersonId`'s frozen snapshot (`financialAttribution.ts:225` `Object.freeze`, `:184`
"history, not state") is **never revisited**, so a false C written today is permanent. **Whether this
fifth outcome collapses into C or stands apart is an Owner decision** (§4.2, `MI-η`) — this lane
states only that collapsing it is unsafe, and gives the reason.

**And the namespace question must be answered per reference, not once.** `O-1` is open
(`typedOwner.ts:4-5`, "why the `USER` id namespace **is** the canonical Employee id (**open item
O-1**)"); body/doc-id agreement is **unenforced** (`metadata/definitions/employee.js:121-127`,
"**Nothing enforces the two match**"); and `OI-08` (`…DECOMPOSITION.md:897`, `:1053`) requires an
independent answer per reference. **Naming an authority does not supply those answers, and this
architecture does not pretend to.** What it does supply is the place they are asked — once, at the
boundary — and a distinct outcome for "cannot ask".

### 3.6 How history is retained without blocking current-eligibility answers — **two channels**

This is the part of the design that costs nothing, because both halves already exist.

| Channel | What it does | Already shipped as |
|---|---|---|
| **(1) THE ACT** | The act is recorded **immutably at the moment it happens**, carrying a snapshot of the identity facts needed to read it later. **Historical audit therefore never re-resolves a person** | the Platform Assignment Standard's `assignedToDisplayName` (`CLAUDE_CONTEXT.md:62`; snapshotted at `coverage/coverageCommands.ts:137`); **one audit event per changed field, in the same transaction as the document write** (`employeeProfileCommands.ts:42-45`); the frozen attribution snapshot (`financialAttribution.ts:225`, `:184` "**history, not state**") |
| **(2) THE REFERENCE** | The reference stays live and resolves against the **retained** Employee record, whose current governed status answers eligibility | `employmentStatus` on a record with **no delete path** (§1.2) |

**Why this satisfies `OD-1` invariants (6) and (7) without a history table, and without slowing
eligibility:**

- **(6) historical accountability auditable** — answered entirely by channel (1). The audit record
  carries what it needs. It does not depend on the person authority being consulted at all, which is
  what makes it robust to the datastore moving under it.
- **(7) handoff guarantees no responsibility gap** — the handoff's resolution (§3.4 stage 1), its
  validation (stage 2) and its audit (stage 3) are in **one transaction**, so there is no interval in
  which the record has left one accountable person and not yet reached another. The Postgres seam
  already states this property: "**they share one explicit `BEGIN/COMMIT` on one `PoolClient`**"
  (`commercialOwnershipRepository.ts:12-19`).
- **Retention never slows eligibility.** Eligibility reads **one current status on one retained
  record** — not a history scan. This is the reason retention is cheap, and the reason B is
  representable with no new storage in the interim.

**One warning, because it is the same trap by a different door.** Channel (1) done *without* channel
(2) is exactly the `financialAttribution` defect: a frozen, permanent snapshot of a person id that
was never validated (§5). A snapshot is only as good as the reference it froze.

### 3.7 What stays Firebase-dependent during transition, and the end state

**Firebase-dependent during transition:**

| Dependency | Why it cannot go first | Ref |
|---|---|---|
| **Firebase Auth** | It is the credential authority and is **not required to go to zero, ever** | `firebase-exit-manifest.json:13-20`, `trendsToZero: false` |
| **`users/{uid}`** | The only Rules-readable linkage. All **4** `get(employees/…)` sites traverse it (`firestore.rules:61`, `:92`, `:114`, `:141`) via `userData()` (`:14-16`) | B-5 |
| **Firestore `employees`** | R1 does not exist; it is the interim bearer, with **11 gating sites** depending on it | §1.4, B-5 |
| **Rules-level eligibility enforcement** | **No PostgreSQL candidate can ever be read from `firestore.rules`.** Any eligibility currently enforced at the Rules boundary must be **re-homed to the EOS API at cutover** | `MI-δ`; §4.2 |

**That last row is the transition's largest un-priced cost, and it is un-priced in both directions.**
Four Rules sites enforce `employmentStatus == "ACTIVE"` *inside the security boundary*. After cutover
that enforcement cannot live there. Whether any part of Layer 1 **must** be Rules-enforceable is not
settled by `#182` as quoted — it is `MI-δ`, and it is the single question that most changes the
sequencing.

**The zero-Firebase end state — which is zero Firebase *business runtime*, not zero Firebase:**

```
Browser
  -> Vercel
  -> Firebase Auth token                        [CREDENTIAL — permanent, IDENTITY_ONLY]
  -> Render EOS API   verifies the token, maps (identity_provider, external_subject)
  -> eos_policy.principals                      [SECURITY IDENTITY — canonical]
  -> employee_principal_links  (FK-constrained both sides)   [R2 — crosswalk]
  -> business Employee relation                 [R1 — canonical business person; DOES NOT EXIST]
  -> PostgreSQL
```

| Artifact | End state |
|---|---|
| Firebase Auth | **retained permanently** as credential authority |
| `eos_policy.principals` | canonical security identity, unchanged |
| `employee_principal_links` | R2, with the FK added (`…1758412800000:54-57`) |
| **R1** | **new PostgreSQL relation — the only new storage this architecture requires** |
| Firestore `employees` | **ARCHIVE** — read-only evidence/history (`firebase-exit-manifest.json:51`) |
| `users` | **RETIRE** — superseded by `principals` + R2 |
| `fieldops_technicians` | **RETIRE — and only after** skills and dispatch status are re-homed (`TECHNICIAN_ONLY_BUSINESS_FACT`, `employeePrincipalLink.ts:81-83`) |
| Rules-based eligibility | re-homed to the EOS API; no Rules equivalent is possible |

**Note the manifest schedules none of this:** `"waves": []`
(`firebase-exit-manifest.json:60-62`), and the wave model says explicitly that ordering "**belongs to
the engineers and owners doing the migration work, not to this control document**."

---

## 4. IMPLEMENTATION IMPLICATIONS AND OWNER DECISIONS STILL REQUIRED

### 4.1 What would have to be built, in order — **every item NOT AUTHORIZED**

Ordered so that each step is reversible and none requires the next. **Nothing below is authorized,
scheduled, or begun. This lane implemented none of it.**

| # | Step | Why this position in the order | Status |
|---|---|---|---|
| **1** | Record the **classification** of the six candidates (§2) where the trusted tree can see it, and reconcile `ownershipMatrix.ts:513-515` with the four files that contradict it | Costs nothing, changes no behavior, and stops the next lane re-deriving `MI-X` a fifth time. Requires `C-1` resolved first (§7) | **NOT AUTHORIZED** |
| **2** | Make **retention** a governed invariant rather than an emergent one: state it, and pin it with a test that fails if a delete path is introduced | Capability 4 is `OD-6` state **B**'s only prerequisite, it is satisfied *in fact* today, and protecting it is cheaper than repairing it. **No schema, no migration** | **NOT AUTHORIZED** |
| **3** | Introduce the **resolution port** — the capability-shaped question of §3.4, with no implementation | This is what makes the datastore swap one adapter instead of a re-audit (§3.4). It must precede any implementation, or the cutover cost is locked in | **NOT AUTHORIZED** |
| **4** | Build the **governed mutation entry point** that `OD-7` names and that does not exist on the Firestore side (B-9), and give it the authority handle | `OD-7`(e) requires a single entry point; `stageOwnershipHandoff` is the seam and nothing calls it. Until this exists there is nowhere for Layer 1 to live | **NOT AUTHORIZED** |
| **5** | Implement the port against Firestore `employees`, per reference, with the **namespace** question answered per reference (`OI-08`) and a distinct **cannot-ask** outcome (§3.5) | Depends on 3 and 4. **Per reference**, never once for all six touch points | **NOT AUTHORIZED** |
| **6** | Add **bypass-prohibition tests** — that the writer holds no authority handle, that the builder remains pure, that no path reaches a mutation except through the entry point | `OD-7`'s named defence in depth *is* these tests, not a second lookup | **NOT AUTHORIZED** |
| **7** | Decide the **scope** question and, if extended, apply the same port to the person references at §5.1 | `MI-V` is Owner-only. Answering `OD-6` without it produces one validated axis and one unvalidated axis **over the same ids** | **NOT AUTHORIZED** |
| **8** | Create **R1** in PostgreSQL — the only new storage — carrying capabilities 1–5 and 8 and nothing else | The target answer (§1.7). Requires `MI-ζ` and the EOS API being deployed at all (`eosApi/server.ts:19-23`) | **NOT AUTHORIZED** |
| **9** | Add the **FK** on `employee_principal_links.employee_id` — the follow-up migration 008's header already names | "the constraint is the only thing that has to be added" (`…1758412800000:54-57`). Impossible before 8 | **NOT AUTHORIZED** |
| **10** | Constrain the **already-unconstrained PostgreSQL person columns** (§1.4: `accounts`, `contacts`, `account_locations`, `opportunities`, `sales_agreements`, `sales_orders`, and `ownership_handoffs`' two) | Otherwise the target schema keeps the defect it inherited. Impossible before 8 | **NOT AUTHORIZED** |
| **11** | Swap the port's implementation to PostgreSQL; re-home Rules-based eligibility to the EOS API; archive `employees`; retire `users` | The cutover. `MI-δ` governs whether step 11's Rules re-homing is even permissible | **NOT AUTHORIZED** |
| **12** | Re-home `fieldops_technicians`' unique facts, **then** retire it | `TECHNICIAN_ONLY_BUSINESS_FACT` (`employeePrincipalLink.ts:81-83`); `…p1b-census.md:1044` "**RETIRE** — subject to OR-4 preserving `skills` / dispatch status onto Employee first" | **NOT AUTHORIZED** |

**Explicitly NOT on this list, and deliberately:** any backfill (`#182` authorizes **none**); any
Rules change; any repair of the two stale documents the brief fenced off; any `ownershipMatrix.ts`
edit (blocked on `C-1`); any deletion of any collection; any production contact.

### 4.2 Decisions only the Owner can make — **not answered here**

| Ref | Question | Why only the Owner |
|---|---|---|
| **`MI-β`** *(carried from `MI-X`)* | Does `#182` Layer 1 **supersede** `O-1`'s exclusion of cross-collection lookup from ownership resolution, or does `O-1` stand with resolution at the governed entry point? | Reading (ii) is consistent with `OD-7`(e) and all 12 purity headers; reading (i) contradicts both. `…DECOMPOSITION.md:176` requires it be said out loud. **This lane recommends (ii) and cannot rule it** |
| **`MI-γ`** *(carried)* | Must a person reference resolve an **Employee only**, or an Employee **and** a live principal link? | The composite is what shipped code does, and it makes Layer 1 depend on a linkage **provably not always populated in production** (`be1e5579:…census.md:120`) |
| **`MI-δ`** *(carried)* | Must any part of Layer 1 be enforceable in `firestore.rules`? | If yes, **no PostgreSQL candidate can ever serve it**, and the target end state requires re-homing 4 Rules sites out of the security boundary. This is the question that most changes §4.1's ordering |
| **`MI-ε`** *(carried)* | `employees` is **not the complete person population** — ~15% of technicians unrepresented, `tech-sbx-02` "exists in no other collection", one **production** principal that can act has no employee link. Does Layer 1 **fail closed on them**, declaring real actors non-existent, or is completeness a **precondition** to activating Layer 1? | A product decision about real people being refused, not an engineering one |
| **`MI-ζ`** *(carried)* | Is the Employee authority answered **for now** in Firestore with the PostgreSQL move left to `BA-7`, or must both be decided together? | They **can** be sequenced (migration 008 pre-shaped the FK). Whether they **should** is the Owner's. §1.4's finding — that the defect is already reproduced in the PostgreSQL schema — is new input to this question |
| **`MI-η`** *(NEW, this lane)* | **Is AUTHORITY-UNAVAILABLE / CANNOT-ASK a fifth resolution outcome, distinct from state C?** | §3.5. Collapsing it into C makes an authority outage or a namespace mismatch indistinguishable from "this person does not exist", and the frozen attribution snapshot is never revisited, so a false C is permanent. `#182` as quoted names four **states**; whether it also constrains **outcomes** is not answerable by a lane |
| **`MI-θ`** *(NEW, this lane)* | **Is technician linkage in the minimum model at all?** It is the one required capability **no candidate supplies** (§1.3), inference is forbidden in four files, and no `OD-6` state depends on it | This lane's position is that it is **not** in the minimum. But `MI-R` says further constraints are "per family, never global", and whether any family's accountability requires a technician linkage is a family-by-family Owner question |
| **`MI-ι`** *(NEW, this lane)* | **Is a business Employee "business data" (→ PostgreSQL) or "identity" (→ carved out of the exit)?** | The manifest does not say. `:10` sends all **business data** to PostgreSQL; `:13-14` carves out **identity** and says migration of it is "**not decided here**". The Owner's own EMPLOYEE/PRINCIPAL distinction implies Employee is business data — **but the manifest has not been told so**, and `PROJECT_ARCHITECTURE.md:88` still says Firestore is the source of truth for all operational data (§7 `C-7`). **§3 is built on the reading that Employee is business data; if the Owner rules otherwise, §3's target collapses to "Firestore `employees` is permanent" and §1.4 is void** |
| **`MI-V`** *(already registered)* | Does Layer 1 extend to `creditedSalespersonId` / `responsibleEmployeeId` — and now, to the **15 person references at §5.1**? | `…DECOMPOSITION.md:1182`, `:1108`. §5.1 makes this materially larger than two fields |
| **`MI-J`** *(already registered)* | Which employee fact is authoritative for "this person can no longer act"? | `employmentStatus` is the only candidate, and the repo warns against conflating it with account state (`SYSTEM_AUTHORITIES.md:121`) |
| **`MI-α`** *(carried)* | The label. This question is registered as `OI-39` / `V-15` / `X-13` / `BA-7`. Which governs, and is a new ref to be issued? | Naming a register item is the Owner's |

**`MI-ι` is the one to answer first.** Every other question is downstream of it, and §3's entire
target rests on one reading of it.

---

## 5. WOULD THIS MODEL SERVE THE EXISTING UNVALIDATED PERSON FACTS, OR CREATE A SECOND REGIME?

### 5.1 The inventory is **fifteen references, not two** — this is the brief's largest under-count

| Person reference | Written at | Validated against |
|---|---|---|
| `creditedSalespersonId` | **8 sites** (B-7) | **nothing** — `nonEmpty`/trim only |
| `responsibleEmployeeId` | `financialAttribution.ts:229`, `:304` | **nothing** — the same `person()` closure `:205-209` |
| `ownerEmployeeId` (Opportunity) | `opportunityCommands.ts:173` | `creationOwnerResolution.ts:63-64` — `nonEmpty` + trim, in a module whose header is `:25` "**PURE: no Firestore, no I/O**" |
| `ownerEmployeeId` (Sales Order) | `salesOrderCommands.ts:285` (resolver `:261`) | same pure resolver |
| `ownerEmployeeId` (Sales Agreement) | `salesAgreementCommands.ts:301` | **nothing — not even routed through the resolver** |
| `newOwnerEmployeeId` / `previousOwnerEmployeeId` | `commercialOwnershipAuthority.ts:326-327`; persisted `commercialOwnershipRepository.ts:237-246` | `:291-301` — nonEmpty / null-vs-empty / no-op only |
| `newOwner.id` / `previousOwner.id` (typed owner) | `ownershipHandoffCommand.ts:186-187` | `isTypedOwner` shape + owner-class match (`:126-152`) — **no existence check** |
| `assignedToEmployeeId` + `assignedToUserId` (coverage) | `coverageCommands.ts:135-136` | `:106-107` nonEmpty only; `grep "employees" functions/src/coverage` → **0 hits** |
| `accountOwner.assignedToEmployeeId` (CRM migration) | `crm/customerMigrationSource.ts:152-153`; derived `typedOwner.ts:101-107` | shape only |
| `ownerEmployeeId` (CRM Account/Contact/Location) | `crm/customerIdentity.ts:137-144`, `:160-161` | non-empty string only; **the file has zero imports and therefore cannot read any authority** |
| `ownerEmployeeId` (**PostgreSQL** CRM rows) | `crm/customerRepository.ts:106`, `:118` | **nothing** |
| `actorEmployeeId` | `performanceGoalCommands.ts:121`, `performanceGoalReadService.ts:96` | read off `users/{uid}.employeeId`, used for **authority** (`performanceGoalAuthority.ts:269`, `:312`) — not existence-checked |
| `personaEmployeeId` | `assistant/assistantEvaluation.ts:21` | **nothing** |
| `requestedBy` | `ownership/reorderRequestLocationAuthority.ts:18` | **nothing** |
| `targetScopeId` where scope is EMPLOYEE | `performance/performanceGoal.ts:434` | **nothing** |

**Against three shipped counter-examples that prove the check is cheap and already idiomatic:**
`assignedDriverEmployeeId` (existence **+ ACTIVE**, `truckRegistryCommands.ts:277`,
`truckRegistryRepository.ts:196-200`); `managerEmployeeId` (existence, `employeeProfileCommands.ts:531-541`);
scheduling technician existence (`placementPolicy.ts:82`, `TECHNICIAN_NOT_FOUND`).

### 5.2 Would the model serve them?

| Question | Answer |
|---|---|
| Same key space? | **Yes.** `resolveCreditedSalesperson` falls through to the commercial owner's employee id at `financialAttribution.ts:328`, so an uncredited record's credited salesperson **is** the `ownerEmployeeId`, byte for byte. Consumers already assume it: `financialVisibility.ts:16`, `:177-179`; `permissionCatalog.ts:332` |
| Would the port serve them mechanically? | **Yes** — one port, one key space, called at each family's governed entry point |
| So no second regime? | **Not mechanically. But `#182` as quoted names `typedOwner`'s shape-only USER resolution, not `financialAttribution`.** Extending Layer 1 there is an **extension by analogy, not by ruling** — `MI-V`, Owner-only |
| Is the asymmetry inside one function? | **Yes, and it is stark.** In the same function, `company()` (`:212-224`) is non-nullable with two distinct refusals and says company "is **never inferred, defaulted, or left to fill in later**", while `person()` (`:205-209`) returns `null` for absence and never checks existence. **And `businessUnitId` is namespace-validated at `:202`** — so person references are validated more weakly than *both* company and business-unit references, in one function |
| If the Owner declines to extend? | **Then the choice creates a second regime, it will be invisible, and it will be permanent.** The attribution snapshot is frozen (`:225`) and is "**history, not state**" (`:184`), so an unvalidated person id written today is **never revisited**. A validated ownership axis beside an unvalidated attribution axis **over the same ids** is precisely the divergence `OD-6` exists to prevent, reached through a different door |

---

## 6. UNPROVEN and NOT_RUN

| # | Item | Why |
|---|---|---|
| **U-1** | Whether `#182`/`#183`/`#184`'s actual text says anything about Layer 1's **location**, `O-1`'s supersession, or whether the four states constrain **outcomes** as well as states | They are on `int/a-correctness-register`; this branch ends at `#179` (`docs/DECISIONS.md:6410`). **Only the brief's quotations were available.** Every reading of them here is a reading of the brief |
| **U-2** | Whether migrations **004–018** (incl. 008) are applied in **any** live environment | Three statements say the consumer is not deployed (§1.5); the only activation record shows `migrations: 3` |
| **U-3** | Whether any row exists in `employee_principal_links` anywhere | No environment was contacted |
| **U-4** | Whether the **production** `employees` population exhibits the nonprod `userId` bijection | The production census (`be1e5579`) measured role exposure, not linkage completeness, and reported one un-linked principal. **Dated 2026-09-02; not re-read live** |
| **U-5** | Whether `employees` documents carry any **tombstone** | No Firestore document was read. Registered as `U-10` (`…DECOMPOSITION.md:638`). **§1.2 shows this is NOT on `OD-6`'s critical path** |
| **U-6** | Whether `fieldops_technicians` has any schema artifact | None exists (no zod — `zod` is not a dependency of the Functions package at all; no converter; the only TS type is `{id, status}` at `schedulingRepository.ts:23-26`) |
| **U-7** | Whether the client `createTechnician` path is reachable in shipped navigation | `Technicians.jsx` is called "Unrouted dead code" by one doc; no route table traced. **The Rules grant at `:407` is open regardless**, which is what the disqualification turns on |
| **U-8** | The live `fieldops_technicians` count — **8** vs **13** in two docs | Different snapshots, not reconciled |
| **U-9** | Whether `employees` has any **declared type** | **Proved absent, not unproven**: no TS interface, no zod (not a dependency), no read guard. The shape exists only as an editable-field list (`employeeProfileCommands.ts:198-220`), a client metadata registry, a seed snapshot, and one writer's object literal |
| **NOT_RUN** | **No test, typecheck, build, lint, or emulator was executed by this lane.** No `java`, no emulator. **`functions/lib` was never consulted for any claim** and was excluded from every search. No `functions/node_modules` was borrowed. No production or non-production environment was contacted. No schema, migration, backfill, or Rules change was written. This is a documentation-only artifact and ran no code | — |

---

## 7. CONFLICTS CARRIED — both readings, unresolved

| # | Conflict | Reading A | Reading B |
|---|---|---|---|
| **C-1** *(carried from `MI-X`)* | What `ownershipMatrix.ts:513-515` **are** | **Authority declarations** — the matrix names three, two identically, and is defective | The third tuple element binds to **`note`**, a free-text **exclusion rationale** (`:531-535`), under an `EXCLUDED — not business records` banner (`:507`) shared by **17 rows**. The matrix was never asked the question. **Verified exactly this lane.** They differ in whether the file needs editing at all — which is why §4.1 step 1 is blocked on it |
| **C-2** *(carried)* | `O-1` vs `#182` Layer 1 | `#182` supersedes; the resolver may do I/O | `O-1` stands; resolution is at the governed entry point. **§3.4 shows reading B is the one consistent with `OD-7`(e) and all 12 purity headers** |
| **C-3** *(carried, fenced off)* | `docs/BusinessEntityModel.md:44`, `:313`: the `employees` collection "**does not exist yet**" | **STALE** — `firestore.rules:476-498` has a match block, `provisionEmployeeAccess.js` writes it, two censuses counted documents | Read literally, a governing model document denies the collection exists. **Being fixed separately; not touched** |
| **C-4** *(carried, fenced off)* | `…p1b-census.md:816`: zero employee matches in migrations | **STALE** — **7** migration files match at `64008d5a`; `1758412800000` has **44** hits. **Independently re-verified this lane** | Measured at an earlier base per its own `:11`; a snapshot artifact. **Being fixed separately; not touched** |
| **C-5** *(carried, partially resolved)* | `SYSTEM_AUTHORITIES.md:54` "**NOT DEPLOYED**" vs `eos-real-nonprod-activation.md:112` "Render — **EXISTS**" | Three independent statements say the policy service is not deployed (§1.5) | One activation doc says a Render service exists with a live health probe. **Either way Cloud Functions has no PostgreSQL path**, so §1.5's conclusion is unaffected |
| **C-6** *(carried)* | `docs/DataModel.md:126`: any signed-in user can write `fieldops_technicians` | **STALE** — contradicted by `firestore.rules:397-423`, which gates on `isAdminOrDispatcher()` | If current, Option 3 is worse still. **Either way it is disqualified** |
| **C-7** *(NEW, this lane — and it is `MI-ι`)* | Where does the **business person** live in the target? | `firebase-exit-manifest.json:10` — "**All business data** … must run through the Render EOS API against **PostgreSQL, not through Firestore**". An Employee is business data, so **R1 in PostgreSQL** | `docs/PROJECT_ARCHITECTURE.md:88` — "**Firestore is the source of truth for all operational data**", and `firebase-exit-manifest.json:13-14` carves **identity** out of the exit entirely, saying its migration is "**not decided here**". If Employee is identity rather than business data, **Firestore `employees` is permanent and §1.4's finding is void.** **§3 is built on reading A. The Owner must rule** |
| **C-8** *(NEW, this lane)* | Is the `OD-7` boundary a **relocation** or a **construction**? | The brief and `OD-7` speak of governed orchestration as the boundary, implying it exists to be used | **The phrase appears nowhere in the repository, and on the Firestore side the seam is explicitly uncalled** — `ownershipHandoffCommand.ts:197` "**Nothing calls this yet**". The only boundary in `OD-7`'s shape is in **PostgreSQL** (`commercialOwnershipRepository.ts:193`). **This changes §4.1's ordering: step 4 is a build, not a move** |

---

## 8. WHAT THIS DOCUMENT DELIBERATELY DOES NOT CONTAIN

- **No implementation of anything.** All twelve steps in §4.1 are marked **NOT AUTHORIZED**.
- **No schema, no migration, no backfill, no Rules change, no index, no column.** `#182` authorizes
  **no backfill**; this lane authorizes nothing at all.
- **No field name or enum name for the `OD-6` person-reference states.** §3.5 names **capabilities**
  and **relationships** only. Every field name in this document is **quoted from code existing at
  `64008d5a`**.
- **No answer to any `MI-` item in §4.2**, including the three this lane raised (`MI-η`, `MI-θ`,
  `MI-ι`).
- **No `ownershipMatrix.ts` edit and no claim that one is required** — `C-1` is unresolved and its two
  readings disagree about whether the file is defective at all.
- **No repair of the stale documents** in §7 (`C-3`, `C-4`, `C-6`) — fenced off by the lane contract.
- **No retirement of, or deletion from, any collection** — including `fieldops_technicians`, whose
  unique facts must be re-homed first.
- **No resolution of `MI-J`, `MI-V`, `BA-7`, `O-1`, or this question's register placement.**
