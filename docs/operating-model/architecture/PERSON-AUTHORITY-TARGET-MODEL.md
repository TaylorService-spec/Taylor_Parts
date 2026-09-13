---
artifact_type: target-architecture-proposal
lane: PERSON-AUTHORITY-DESIGN
status: ARCHITECTURE PROPOSED. NOT AUTHORIZED. NOT IMPLEMENTED.
ruled: 2026-09-13 — MI-iota RULED and CLOSED by DECISIONS #185 (ref int/a-correctness-register): BUSINESS EMPLOYEE IS BUSINESS DATA; canonical Employee authority belongs in EOS-owned PostgreSQL. Section 3's target reading is RATIFIED. B-2 is WITHDRAWN BY THAT RULING. Section 9 adds the PostgreSQL target work, items A-J, every one NOT AUTHORIZED.
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

> ## ⚠⚠ `MI-ι` IS RULED. READ THIS BEFORE §0.
>
> **`docs/DECISIONS.md` #185 (ref `int/a-correctness-register`, 2026-09-13) RULES AND CLOSES `MI-ι`:**
> **BUSINESS EMPLOYEE IS BUSINESS DATA. The canonical Employee authority belongs in EOS-owned
> PostgreSQL.** Read at source, not from a brief.
>
> **Three consequences for this document, marked in place below and not edited away:**
>
> 1. **§3's target is RATIFIED.** `MI-ι` in §4.2 and conflict **`C-7`** in §7 are **CLOSED**; `C-7`
>    **Reading B** (*"Employee is identity, therefore Firestore `employees` is permanent"*) is **VOID BY
>    RULING**. §1.4's finding stands.
> 2. **`B-2` IS WITHDRAWN BY THE RULING.** `#185`, verbatim: *"`trendsToZero: false` is **NOT a permanence
>    claim**, and this program over-read it. … **A prior report in this program stated that Firebase Auth is
>    retained permanently on the strength of that flag. That over-read the manifest and is withdrawn.**"*
>    **That prior report is this document.** See the struck `B-2` row and §0.3.
> 3. **The ruling adds a documentation defect this document did not find:** the word **`/Employee`** in the
>    identity carve-out of **both** `docs/architecture/firebase-exit-manifest.json` and
>    `docs/architecture/firebase-exit-ratchet.md:4` is now **WRONG**, and
>    `firebase-exit-ratchet.md:70-71`'s *"identity is the one Firebase capability this architecture keeps on
>    purpose"* **overstates its own source**. Reconciliation is **documentation-correctness work, not
>    implemented here.**
>
> **§9 (NEW) carries the PostgreSQL target work — items A–J — and every one is `NOT AUTHORIZED`.**
> `#185` Status, verbatim: *"**IMPLEMENTATION REMAINS NOT AUTHORIZED** — items A–J of `MI-ι` §11 are
> prepared only."*

---

## 0. NINE CORRECTIONS TO THE BRIEF, BEFORE THE ARCHITECTURE

Correcting the brief was declared in scope and expected. Nine items; two of them change the
architecture, not merely a line number.

| # | The brief said | Evidence at `64008d5a` | Consequence |
|---|---|---|---|
| **B-1** | Allowed surface is `docs/operating-model/architecture/…`, and the two input docs sit beside it | **Neither input doc is at that path.** They are `docs/operating-model/owner-decisions/MI-X-PERSON-AUTHORITY-OPTIONS.md` (511 lines) and `docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` (1219 lines). `docs/operating-model/` contained only `engineering/` and `owner-decisions/` | The output directory had to be **created**. Done, as the contract permits. No input doc was modified |
| **B-2** ⚠ **WITHDRAWN BY `#185`** | **"The target zero-Firebase architecture must support…"** | ~~**"Zero-Firebase" is already scoped by a governing control document, and it is not zero Firebase.**~~ The **classification** facts are exact — `docs/architecture/firebase-exit-manifest.json:13-20` classes Firebase Auth + UID→Principal/Employee correlation `IDENTITY_ONLY` with `"trendsToZero": false`; `:22-38` classes Firestore + Functions `BUSINESS_RUNTIME` with `"trendsToZero": true`. **The INFERENCE drawn from them is withdrawn** — `#185`: *"`trendsToZero: false` is **NOT a permanence claim**, and this program over-read it. … A prior report in this program stated that Firebase Auth is retained permanently on the strength of that flag. **That over-read the manifest and is withdrawn.**"* The manifest itself says `IDENTITY_ONLY` is outside the ratchet *"for the current business-runtime exit phase"* and that identity migration is *"**not decided here**"* | ~~**the single most load-bearing correction in this document**~~ → **NOT a permanence finding.** `trendsToZero: false` means **out of scope for this ratchet**, not *retained forever*. **What survives, and it is what §3 actually needs:** Firestore is `BUSINESS_RUNTIME` and **must trend to zero**, so `employees` cannot be the permanent authority (§1.4). **What does not survive:** every use of the word *"permanently"* about Firebase Auth in §0.2, §1.7, §3.2, §3.7 — read those as *"credential authority for this exit phase; its own migration is a separate undecided question."* And `#185` rules that **`/Employee` must be struck** from the identity carve-out in the manifest and in `firebase-exit-ratchet.md:4`, and that `firebase-exit-ratchet.md:70-71`'s *"keeps on purpose"* **overstates its source** |
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
| ~~**`MI-ι`**~~ **RULED / CLOSED — `#185`** | **Is a business Employee "business data" (→ PostgreSQL) or "identity" (→ carved out of the exit)?** | **ANSWERED: BUSINESS DATA.** `#185`, verbatim: *"**BUSINESS EMPLOYEE IS BUSINESS DATA. The canonical Employee authority belongs in EOS-owned PostgreSQL.** The Employee business record must **not** be classified `IDENTITY_ONLY` merely because an Employee may be linked to an authenticated user or principal."* **§3's target reading is RATIFIED and §1.4's finding stands.** The ruling also resolves the manifest gap this row identified — it rules **`/Employee` out of the identity carve-out** in both control documents. **It is no longer *"the one to answer first"*; it is answered.** The target work it authorizes to be *prepared* is **§9, items A–J, all `NOT AUTHORIZED`** |
| **`MI-V`** *(already registered)* | Does Layer 1 extend to `creditedSalespersonId` / `responsibleEmployeeId` — and now, to the **15 person references at §5.1**? | `…DECOMPOSITION.md:1182`, `:1108`. §5.1 makes this materially larger than two fields |
| **`MI-J`** *(already registered)* | Which employee fact is authoritative for "this person can no longer act"? | `employmentStatus` is the only candidate, and the repo warns against conflating it with account state (`SYSTEM_AUTHORITIES.md:121`) |
| **`MI-α`** *(carried)* | The label. This question is registered as `OI-39` / `V-15` / `X-13` / `BA-7`. Which governs, and is a new ref to be issued? | Naming a register item is the Owner's |

~~**`MI-ι` is the one to answer first.** Every other question is downstream of it, and §3's entire
target rests on one reading of it.~~

> **⚠ ANSWERED 2026-09-13 — `#185`.** `MI-ι` is **RULED / CLOSED**: **BUSINESS EMPLOYEE IS BUSINESS DATA;
> the canonical Employee authority belongs in EOS-owned PostgreSQL.** §3's reading is **RATIFIED**, and the
> prepared-not-implemented target work it authorizes is **§9, items A–J, every one `NOT AUTHORIZED`**.
> The remaining rows above stand **open and unchanged**, except that **`MI-η` is now NAMED AND DEFERRED
> BY RULING** rather than raised by a lane — `#185`: *"AUTHORITY UNAVAILABLE **if later ruled
> separately**"*. **`MI-λ`** and **`MI-κ`** are added at §9.8.

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
| ~~**U-1**~~ **PARTLY DISCHARGED — see §9.10** | Whether `#182`/`#183`/`#184`'s actual text says anything about Layer 1's **location**, `O-1`'s supersession, or whether the four states constrain **outcomes** as well as states | ~~Only the brief's quotations were available.~~ **`#182`, `#183`, `#184` and `#185` have now been read AT SOURCE** from `int/a-correctness-register:docs/DECISIONS.md`, so every reading in **§9** is a reading of the rulings. **What remains unproven:** `#182` does not state Layer 1's *location* (**`#184` does** — option (e), the governed orchestration boundary; `MI-β` remains the formal question), and whether the four states constrain **outcomes** as well as states is **named and deferred** by `#185`, not answered | Discharged for §9; §1–§8 above were written from the brief and are marked where a ruling moved them |
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
| ~~**C-7**~~ **RESOLVED BY RULING — `#185`** | Where does the **business person** live in the target? | **READING A IS RULED.** `firebase-exit-manifest.json:10` — "**All business data** … must run through the Render EOS API against **PostgreSQL, not through Firestore**" — and `#185` rules an Employee **is** business data. **R1 in PostgreSQL.** | **READING B IS VOID BY RULING.** `docs/PROJECT_ARCHITECTURE.md:88` (*"Firestore is the source of truth for all operational data"*) and the manifest's `:13-14` identity carve-out no longer support *"Employee is identity, therefore Firestore `employees` is permanent"*: `#185` rules Firestore `employees` **transitional business compatibility** and strikes `/Employee` from the carve-out. **`PROJECT_ARCHITECTURE.md:88` is now a document to reconcile, not a reading to carry** — recorded, not edited (outside this lane's surface) |
| **C-8** *(NEW, this lane)* | Is the `OD-7` boundary a **relocation** or a **construction**? | The brief and `OD-7` speak of governed orchestration as the boundary, implying it exists to be used | **The phrase appears nowhere in the repository, and on the Firestore side the seam is explicitly uncalled** — `ownershipHandoffCommand.ts:197` "**Nothing calls this yet**". The only boundary in `OD-7`'s shape is in **PostgreSQL** (`commercialOwnershipRepository.ts:193`). **This changes §4.1's ordering: step 4 is a build, not a move** |

---

## 8. WHAT THIS DOCUMENT DELIBERATELY DOES NOT CONTAIN

- **No implementation of anything.** All twelve steps in §4.1 are marked **NOT AUTHORIZED**.
- **No schema, no migration, no backfill, no Rules change, no index, no column.** `#182` authorizes
  **no backfill**; this lane authorizes nothing at all.
- **No field name or enum name for the `OD-6` person-reference states.** §3.5 names **capabilities**
  and **relationships** only. Every field name in this document is **quoted from code existing at
  `64008d5a`**.
- **No answer to any `MI-` item in §4.2** — **except `MI-ι`, which the Owner RULED at `#185`** and which is
  therefore recorded as CLOSED rather than answered here. `MI-η` and `MI-θ` stand open; `MI-η` is now **named
  and deferred by ruling**. **§9 adds `MI-λ` and cross-registers `MI-κ`, and answers neither.**
- **No `ownershipMatrix.ts` edit and no claim that one is required** — `C-1` is unresolved and its two
  readings disagree about whether the file is defective at all.
- **No repair of the stale documents** in §7 (`C-3`, `C-4`, `C-6`) — fenced off by the lane contract.
- **No retirement of, or deletion from, any collection** — including `fieldops_technicians`, whose
  unique facts must be re-homed first.
- **No resolution of `MI-J`, `MI-V`, `BA-7`, `O-1`, or this question's register placement.**

---

# 9. THE POSTGRESQL TARGET WORK — `MI-ι` / `#185`, PREPARED NOT IMPLEMENTED

**OBSERVED AT: `64008d5ae0bdd9532909671b15a91122400accf1`** for every code and DDL claim. **#185** read at
source from `int/a-correctness-register:docs/DECISIONS.md`.

> ## ⚠ EVERY ITEM IN §9 CARRIES `IMPLEMENTATION STATUS = NOT AUTHORIZED`.
>
> `#185` Status, verbatim: *"**IMPLEMENTATION REMAINS NOT AUTHORIZED** — items A–J of `MI-ι` §11 are
> **prepared only**, and all 42 items in
> `docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` keep
> `IMPLEMENTATION STATUS = NOT AUTHORIZED` until the remaining authority decisions are settled and the
> architecture-authority conflict above is reconciled."*
>
> **No DDL is written to any migration file. No migration is executed. No backfill. No Rules change. No
> deploy. No production contact. No data mutation.** §9 specifies **relations and constraints at the
> architectural level**, which is what this lane was asked for, and nothing below is a migration.
>
> **NAMING IS NOT FROZEN.** `#182` §3: *"Exact enum and schema names are NOT authorized by this ruling."*
> `#185`: *"**Naming is explicitly not frozen by this ruling.**"* §9 therefore names **capabilities,
> relations and semantic states**. Every identifier that appears in a code font below is **quoted from DDL or
> code that exists at `64008d5a`** — `employee_principal_links`, `employee_id`, `owner_employee_id`,
> `eos_policy.principals`, `tenant_memberships` — never proposed. **R1 is referred to as "the Employee
> relation", not by a table name.**

### 9.0 Provenance of items A–J — read this before relying on the lettering

**`#185` confirms items A–J exist and are "prepared only". It does not enumerate them.** No `MI-ι` document
exists at any ref in this repository (`git log --all --diff-filter=A --name-only` finds no file matching
`iota`, `MI-I`, `BUSINESS-EMPLOYEE` or `EMPLOYEE-BUSINESS`; the only `MI-` packet is
`docs/operating-model/owner-decisions/MI-X-PERSON-AUTHORITY-OPTIONS.md`, and `MI-ι` was raised in **§4.2 of
this document as a single table row**, which has no §6/§9/§10/§11).

| | |
|---|---|
| **A–J titles** | **`SOURCE: LANE BRIEF. NOT VERIFIED AT SOURCE.`** Registered as `U-10` (§9.10) |
| **The ruled content each item must satisfy** | **VERIFIED AT SOURCE** — every clause in §9 is quoted from `#185`, `#184`, `#183`, `#182`, `#181` or `#180` as read on `int/a-correctness-register` |
| **`#185`'s own internal citations (`MI-ι` §6, §11)** | point to the same unlocatable document. Recorded, not resolved |

**If the Owner's A–J lettering differs, the content below is unaffected — only the labels are.**

---

## 9.1 REQUIRED POSTGRESQL RELATIONS — architectural level, no DDL

`#185` fixes the target in one table:

| Concept | `#185`'s canonical target | State at `64008d5a` |
|---|---|---|
| **EMPLOYEE** — business person authority | **"PostgreSQL Employee relation"** | **DOES NOT EXIST.** `functions/migrations/1758412800000_employee-principal-linkage.sql:46`: *"**THERE IS NO `employees` TABLE IN POSTGRESQL YET.**"* Among **54** `CREATE TABLE` statements across **18** migrations there is no business-person relation — no `employees`, `persons` or `people` — and no employment-status concept in any of them |
| **PRINCIPAL** — security principal authority | **`eos_policy.principals`** | **EXISTS.** `1757548800000_tenant-and-identity.sql:79-93`. **No change proposed by this document or by `#185`** |
| **CROSSWALK** — governed EMPLOYEE ↔ PRINCIPAL link | **`employee_principal_links`, "made referentially sound with real foreign keys"** | **EXISTS AND IS PARTLY RIGHT ALREADY.** `1758412800000:117-160`. One FK, deliberate and composite; `employee_id` unconstrained beyond shape |
| **CREDENTIAL** | the credential provider, **authentication only** | Firebase Auth. `#185`: *"transitional credential source"* — and per `#185`'s withdrawal of `B-2`, **not** ruled permanent |

**The three relations `#185` requires, stated as capabilities (§1.6's R1/R2/R3, now ruled rather than
proposed):**

| | Relation | Must carry (capability, not column) | Must NOT carry |
|---|---|---|---|
| **R1** | **the PostgreSQL Employee relation** — canonical business person | an EOS-native, immutable, opaque identifier that is **never a credential key**; an **existence** fact only this relation may assert; **one** governed employment-status fact from a closed vocabulary with a single writer; **retention across the end of employment as an invariant**; operating-company context; tenant context | any credential or authentication fact; any dispatch/scheduling state; skills; contact details; HR data; a second status axis; any Role, permission or Condition |
| **R2** | **`employee_principal_links`** — the crosswalk | which Employee and which principal are the same person; the **provenance** of that assertion from a closed vocabulary; whether the link is live or superseded, **superseded links retained**; the tenant the link holds in | *"nothing else about either side"* — already written into the DDL at `1758412800000:107-111`: *"No `external_subject`, no `identity_provider`, no `display_name`, no `employment_status`, no `technician_id`, no `skills`… The link table says **WHICH TWO THINGS ARE THE SAME PERSON, and nothing else about either of them**"* |
| **R3** | **`eos_policy.principals`** | exists; **no change** | — |

**No fourth relation.** Technician linkage is deliberately not in R1 or R2 (§1.6) and remains `MI-θ`.

---

## 9.2 REUSE vs NEW — the part to get right

**Three categories, and the middle one is the one this program keeps collapsing into the other two.**

| Category | What is in it | Why |
|---|---|---|
| **NEW STORAGE — exactly one relation** | **R1, the Employee relation** | No business-person relation exists among the 54 tables, and the DDL says so in the imperative (`1758412800000:46`). **This is the only new storage the target requires.** |
| **REUSE AND CONSTRAIN — already built, needs constraining, NOT creating** | **`employee_principal_links`** (`1758412800000:117-160`) | The table exists with an `employee_id` column *already of the right name, type and cardinality*, and its own header pre-shaped the follow-up: `:55-57` — *"When an `employees` table does arrive, this column is already the right name, the right type and the right cardinality to take a foreign key with no restructuring — **the constraint is the only thing that has to be added**, and that is a follow-up this header names rather than one a reader has to infer."* |
| **REUSE UNCHANGED** | **`eos_policy.principals`** (`1757548800000:79-93`), **`tenant_memberships`** (the target of R2's existing composite FK) | `#185` names `principals` canonical and proposes no change. `tenant_memberships` already declares the `UNIQUE (tenant_id, principal_id)` R2's FK targets |
| **CONSTRAIN EXISTING BUSINESS RELATIONS — exists, defective, must not be created again** | the **nine** unconstrained person columns of §9.4 | They are already in PostgreSQL DDL. The target work is **adding constraints to shipped tables**, not adding tables |

### 9.2a What is already correct in `employee_principal_links`, precisely

**Getting reuse right means not "improving" the parts that are already right.** Four properties are built and
must survive:

| Property | Where | Why it must not be changed |
|---|---|---|
| The FK is **composite and deliberately not onto `principals`** | `1758412800000:133-135` — `FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships (tenant_id, principal_id)` | Rationale at `:39-42`: *"A key onto `principals` alone would prove the principal EXISTS. It would not prevent tenant A's Employee from being linked to a principal who belongs only to tenant B — a **cross-tenant identity leak** rather than a dangling row."* **Adding a simple `REFERENCES principals(id)` would be a regression, not an improvement** |
| **Retention discipline is already in the indexes** | `:169-172` and `:173-176` — two **PARTIAL** unique indexes, `WHERE status = 'active'` | *"PARTIAL on `status = 'active'`: **history survives, ambiguity does not**"* (`:167-168`). 1↔1 is enforced among **active rows only**, so revoked links accumulate as history. **This is the retention pattern item C needs, already built — on the link, not on the person** |
| **Closed provenance vocabulary** | `:139-140` — `CHECK (link_source IN ('RECIPROCAL_FIREBASE_UID_LINK', 'OPERATOR_ASSERTED'))` | `:138` — *"a `link_source` with free text means nothing after the third value somebody invents — and the third value somebody would invent is the technician id."* The closure is the point |
| **An assertion always has an author and a reason** | `:146-155` | *"Enforced by the database, because the caller that would forget is exactly the caller that is guessing"* |

### 9.2b Reuse vs new, per item A–J

| Item | New storage? | Reuse and constrain? | Reuse unchanged? |
|---|---|---|---|
| **A** Employee relation authority | **YES — R1. The only new relation** | — | — |
| **B** Employee status model | on R1 (part of A) | — | the shipped closed vocabulary is the input (§9.3 B) |
| **C** historical retention semantics | **NO — needs an invariant and a test, not storage** | R2's partial-index pattern is the precedent | Firestore-side retention is already de facto true |
| **D** `employee_principal_links` FK integrity | **NO** | **YES — this is the canonical reuse-and-constrain item** | the existing composite FK, the partial indexes, the `link_source` closure |
| **E** migration / crosswalk from Firestore `employees` | **NO** — E moves rows into A, it creates nothing | **YES — the nine unconstrained person columns (§9.4)** | — |
| **F** compatibility for `fieldops_technicians` | **NO storage until its unique facts are re-homed**, and that is out of the minimum (`MI-θ`) | — | — |
| **G** server-side person-resolution adapter | **NO** | the port from §3.4 / §4.1 step 3 | `commercialOwnershipRepository.ts:193` is the shipped boundary shape |
| **H** `OD-6` acceptance tests | **NO** | — | the fake-authority test pattern (`ownershipCensus.ts:5-7`) |
| **I** `OD-7` orchestration integration | **NO** | — | the `BEGIN/COMMIT`-on-one-`PoolClient` property (`commercialOwnershipRepository.ts:12-19`) |
| **J** census / responsibility-integrity integration | **NO** | — | `ownershipCensus.ts`; **but which shape is `MI-X`'s, unanswered** |

> **Nine of the ten items require no new storage.** The target is **one relation, one added constraint on the
> crosswalk, and constraints on nine already-shipped columns.** Anything larger is not this ruling.

---

## 9.3 ITEMS A–J

**Every item: `IMPLEMENTATION STATUS = NOT AUTHORIZED`.**

### A — Employee relation authority (R1)

| | |
|---|---|
| **Ruled by** | `#185`: *"The canonical Employee authority belongs in EOS-owned PostgreSQL"*; *"PostgreSQL Employee relation = business person authority"* |
| **Required relations** | **R1 — new.** One relation, tenant-scoped, server-only, transactionally writable behind the Render EOS API |
| **Required constraints, architectural level** | a primary key that is **EOS-native, immutable, opaque and never a credential key** (the `principals.id` discipline one level up — `SYSTEM_AUTHORITIES.md:54`: *"`principals.id` is EOS-native and `(identity_provider, external_subject)` is the MAPPING to whatever proved the identity"*); tenant scoping consistent with `tenant_memberships`' composite discipline so that a cross-tenant Employee reference is **unrepresentable**, not merely refused; **exactly one** governed status fact, from a closed vocabulary, enforced by the database; **no delete path** (item C); an existence fact only R1 may assert |
| **Reuse vs new** | **NEW. The only new storage in the target.** `1758412800000:46` |
| **Crosswalk changes** | none of its own; it is what D's FK points at |
| **Migration implications** | R1 must exist before D and before E. It requires the **EOS API to be deployed at all** — `functions/src/eosApi/server.ts:19-23`: *"**NOT DEPLOYED** — there is no Render service, and creating one needs Owner action"*; `docs/architecture/eos-policy-nonprod-activation.md:3-8`: *"**MERGED TO `main`. NOT DEPLOYED.** … Merged code is not running code."* |
| **Compatibility surfaces** | Firestore `employees` remains the interim bearer with **11 gating sites** (`B-5`: 7 trusted reads across 5 files + 4 Rules sites `:61`, `:92`, `:114`, `:141`) |
| **Tests / proofs** | existence is assertable **only** through R1; a credential or principal id is **rejected as an Employee key** (`#185`: *"Never Firebase user → therefore Employee"*); a cross-tenant Employee reference is unrepresentable; the status vocabulary is closed at the database, not only in code |
| **Remaining Owner decisions** | **`MI-ζ`** (sequence R1 with the Firestore answer, or decide both together) · **`MI-ε`** (does Layer 1 fail closed on the people `employees` does not represent?) · **`MI-α`** (the register label) |
| **Status** | **NOT AUTHORIZED** |

### B — Employee status model

| | |
|---|---|
| **Ruled by** | `#185`: Layer 1 must establish *"employee status"* and *"current eligibility facts required by the caller"*. `#182` §4 / `MI-R`: *"at minimum it must consider **governed employment / person status**"*; *"Additional company or domain constraints are **per family — do not invent them globally**"* |
| **Required relations** | one status fact **on R1**. **Not a second relation, not a second axis** |
| **Required constraints** | a **closed vocabulary enforced by the database**; **exactly one** status axis; **one writer**. The vocabulary shipped today has six members — `EMPLOYMENT_STATUS_VALUES` at `functions/src/access/employeeProfileCommands.ts:122-129`: `ACTIVE`, `ON_LEAVE`, `INACTIVE`, `TERMINATED`, `RETIRED`, `CONTRACTOR` — and it is **not proposed here as R1's vocabulary**; it is the measured input to the Owner's choice |
| **Reuse vs new** | part of A. No new relation |
| **Crosswalk changes** | **none — and this is a constraint, not an absence.** `1758412800000:107-111` forbids `employment_status` on R2 by design: *"a copy here would be a second place for the same fact to be stated, which is the only way two places can ever disagree"* |
| **Migration implications** | the vocabulary must be decided **before** E moves any row, or E writes values R1 must later re-map |
| **Compatibility surfaces** | **four `firestore.rules` sites enforce `employmentStatus == "ACTIVE"` inside the security boundary** (`:61`, `:92`, `:114`, `:141`). **No PostgreSQL relation can ever be read from `firestore.rules`**, so any eligibility enforced there must be re-homed to the EOS API at cutover — `MI-δ`, and §3.7 calls it the transition's largest un-priced cost |
| **Tests / proofs** | `#182` proofs **P1**–**P4**: valid-current · inactive · terminated · non-existent. Each must be a **distinct** outcome, and `#182` §2 is explicit: *"**INACTIVE · TERMINATED · FORMER EMPLOYEE are NOT the same condition as NON-EXISTENT / INVALID**"* and *"`UNRESOLVED` must NOT be the automatic representation for every inactive or terminated employee"* |
| **Remaining Owner decisions** | **`MI-S`** (is state **B** a distinct outcome or `RESOLVED` + a carried eligibility fact, and must INACTIVE be distinguishable from TERMINATED inside it?) · **`MI-J`** (which fact is authoritative for *"can no longer act"* — and `SYSTEM_AUTHORITIES.md:121` warns against conflating it with account state) · **`MI-δ`** |
| **Status** | **NOT AUTHORIZED** |

### C — historical retention semantics

| | |
|---|---|
| **Ruled by** | `#185`: Layer 1 must establish *"historical identity preservation"*. `#182` §2: EOS *"**must preserve the historical reference**"* and must not rewrite historical ownership, accountability or attribution because an Employee later becomes inactive or terminated. `#180` invariant 6: *"Historical accountability must remain auditable."* |
| **Required relations** | **none. This item needs an invariant and a test, not storage** |
| **Required constraints** | on R1: **no delete path, as a stated invariant rather than an emergent one**. On R2: the **existing** partial-unique-index pattern, retained (`1758412800000:169-176`) |
| **Reuse vs new** | **NO new storage. The one item in A–J that requires none** |
| **Crosswalk changes** | none — R2's retention is already correct and must be **protected, not extended** |
| **Migration implications** | E must be **additive**: it may not delete a Firestore `employees` document, and the Firestore side becomes `ARCHIVE` (read-only evidence), never a deletion |
| **Compatibility surfaces** | Retention is **satisfied de facto today and it is verified**: `firestore.rules:497` is `allow create, update, delete: if false;` on `/employees/{employeeId}`, and **no delete path exists in the trusted tree** (a search of `functions/src` and `functions/scripts` for a `.delete()` on an `employees` document at `64008d5a` returns **zero**). **It is satisfied by accident, not by contract** — which is precisely why C is the cheapest item and the one most worth doing early |
| **Tests / proofs** | a test that **fails if a delete path is introduced** on either bearer; `#182`'s two historical proofs (**P2**, **P3**) must prove **HISTORY PRESERVED**; the two-channel model of §3.6 asserted — **the act** (immutable audit with a snapshot of the identity facts) **and the reference** (live, resolving against a retained record). §3.6's warning is a required negative control: **channel (1) without channel (2) is the `financialAttribution` defect** — a frozen, permanent snapshot (`financialAttribution.ts:225` `Object.freeze`, `:184` *"history, not state"*) of a person id that was never validated |
| **Remaining Owner decisions** | **none for the invariant itself.** `MI-S` governs how state **B** is *represented*, not whether history is *retained* |
| **Register note** | **`OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` contains no `OI-nn` for this** — `OI-07`/`OI-31` cover state B's representation, not retention's guarantee. Recorded there as correction **X-16**; carried here |
| **Status** | **NOT AUTHORIZED** |

### D — `employee_principal_links` FK integrity

| | |
|---|---|
| **Ruled by** | `#185`: *"`employee_principal_links` = **governed crosswalk**, made referentially sound with **real foreign keys**"* |
| **Required relations** | **none new.** R2 exists |
| **Required constraints, architectural level** | ① a **real referential constraint from R2's employee reference onto R1** — and, to match the discipline already in the file, **composite and tenant-scoped**, so that tenant A's link cannot name tenant B's Employee. A simple single-column key onto R1 would prove existence and **reintroduce exactly the cross-tenant leak `:39-42` was written to make unrepresentable.** ② the existing composite FK onto `tenant_memberships` (`:133-135`) **retained unchanged**. ③ the shape `CHECK` at `:157-158` **retained or migrated into R1's key domain** — it currently encodes *"`employee_id` is a Firestore document id today"*, which after cutover is no longer true, so it is a **transitional constraint with an expiry**, not a permanent one |
| **Reuse vs new** | **REUSE AND CONSTRAIN. This is the canonical instance.** *"The constraint is the only thing that has to be added"* (`:55-57`) — written in 2026 as a named follow-up, and `#185` is the ruling that asks for it |
| **Crosswalk changes** | **three, and one is not in the brief.** (i) the FK above. (ii) the shape `CHECK`'s expiry. (iii) **`link_source`'s closed vocabulary contains a value `#185` rules transitional.** `:140` admits exactly `'RECIPROCAL_FIREBASE_UID_LINK'` and `'OPERATOR_ASSERTED'`, and `:80` documents the first as *"`employees/{id}.userId` and `users/{uid}.employeeId` agree"* — which is **precisely** what `#185` forbids the crosswalk from relying on permanently: *"The crosswalk must not rely permanently on matching strings · Firebase uid coincidence · `users/{uid}.employeeId`."* **So one of only two admitted provenances is a compatibility mechanism.** The target needs a governed successor provenance, or `RECIPROCAL_FIREBASE_UID_LINK` needs a declared retirement — **and `:138`'s own reasoning is why this must be decided rather than drifted into**: the closure exists so a third value is a deliberate act |
| **Migration implications** | **D is impossible before A.** And D is **blocking on data**: an FK cannot be added while any row's employee reference does not resolve in R1, so **D forces E's completeness question into the open** — which is the correct order, because an FK that cannot be added is a measurement of exactly how incomplete the crosswalk is |
| **Compatibility surfaces** | `users/{uid}.employeeId` and `employees/{id}.userId` remain the reciprocal mechanism during transition; `#185` classes `users` *"transitional identity compatibility"* |
| **Tests / proofs** | a link naming a non-existent Employee is **refused by the database**, not by a caller; a link naming another tenant's Employee is **unrepresentable**; **revoked links survive** the new constraint (the partial indexes still admit history); the existing `tenant_memberships` FK still refuses a principal who is not a member of that tenant; and the `link_source` vocabulary change, whichever way it goes, is a **reviewable diff in DDL** — which is the property `B-3` identified as the strongest form of this repository's discipline |
| **Remaining Owner decisions** | **`MI-γ`** (must a person reference resolve an Employee **only**, or an Employee **and** a live link? — this decides whether D's FK is on Layer 1's critical path or beside it) · **`MI-ε`** (the unlinked population) · the `link_source` successor question above, which is **new and unregistered** |
| **Status** | **NOT AUTHORIZED** |

### E — migration / crosswalk from Firestore `employees`

| | |
|---|---|
| **Ruled by** | `#185`: Firestore `employees` = *"transitional business compatibility"*; *"**No big-bang migration**"* required; *"**One authoritative implementation at a time. No long-lived dual authority.**"* `#182` §10: *"**No backfill authorized.**"* |
| **Required relations** | none new. E populates R1 |
| **Required constraints** | E is **additive and idempotent**, and it is **not a backfill in `#182`'s sense** — the distinction must be stated, because the words collide. `#182` forbids *backfill as a mechanism for fixing historical inactive or terminated references* and forbids propagating an unvalidated upstream owner (`ownershipBackfillRules.ts:71` `ALREADY_SET` ⇒ no repair path; `:74-77` writes an unvalidated `{ type: "USER", id }` onto every child). **E is a datastore move of an existing governed record, not a repair of a reference.** Whether that distinction is the Owner's is stated as a decision below rather than assumed |
| **Reuse vs new** | reuse. **And E is where the already-reproduced defect must be stopped — §9.4** |
| **Crosswalk changes** | E must **not** create links; links are D's and are governed by provenance. A row moved by E with no resolvable principal link is a **measured incompleteness**, never an inferred link |
| **Migration implications** | **`#185` removes the big-bang requirement and replaces it with a harder constraint: one authority at a time.** So E is not *"copy then switch"*; it is *"copy, verify, switch, and make the old bearer unreachable as an authority"*. The verification step is not optional under *"no silent fallback"* (§9.6) |
| **Compatibility surfaces** | Firestore `employees` → `ARCHIVE` (read-only evidence/history), never deleted (item C). `users` → RETIRE, superseded by `principals` + R2. `fieldops_technicians` → item F |
| **Tests / proofs** | every Firestore `employees` document resolves in R1 **or** is enumerated as a named exception; **no document is deleted**; re-running E writes zero (the idempotence property `assignWarehouseRootCompany` already demonstrates — *"a re-run wrote 0"*, `docs/specifications/reorder-trusted-command-authority.md:208`); and **after cutover, a read of the old bearer for authority purposes fails a test** (§9.6) |
| **Remaining Owner decisions** | **`MI-ε`** — **this is the decision E cannot proceed without.** `employees` is **not the complete person population** (~15% of technicians unrepresented; `tech-sbx-02` *"exists in no other collection"*; one **production** principal that can act has no employee link). E must either **fail closed on those people — declaring real actors non-existent — or treat completeness as a precondition.** That is a product decision about real people being refused. Also: **is E a "backfill" under `#182` §10, or a datastore move?** Unregistered; raised below as **`MI-λ`** |
| **Status** | **NOT AUTHORIZED** |

### F — compatibility strategy for `fieldops_technicians`

| | |
|---|---|
| **Ruled by** | `#185`: *"`fieldops_technicians` = **legacy operational compatibility**"*; *"**Never collapse** EMPLOYEE into … `fieldops_technicians`"*; *"a technician id"* is **insufficient** as proof an Employee exists; the crosswalk must not rely permanently on *"`fieldops_technicians` identity"* |
| **Required relations** | **none in the minimum.** Technician linkage is a **third** relationship between a business Employee and a dispatch resource record, and forcing it into R1 or R2 re-creates the conflation **four** trusted artifacts forbid — `employeePrincipalLinkPlan.ts:24-25`, `employeePrincipalLink.ts:46-47`, `scripts/employeeTruckCrosswalk.lib.mjs:25-26`, and the strongest, **DDL**: `1758412800000_employee-principal-linkage.sql:90` — *"`fieldops_technicians` is compatibility data that must not remain employee-identity authority"*, backed by a `CHECK` at `:86-92` |
| **Required constraints** | **no `technician_id` on R2** — already forbidden at `:107-111`, and `:138` names it as *"the third value somebody would invent"* for `link_source` |
| **Reuse vs new** | **no new storage until its unique facts are re-homed** — `TECHNICIAN_ONLY_BUSINESS_FACT` (`employeePrincipalLink.ts:81-83`), skills and dispatch status |
| **Crosswalk changes** | none. F's whole content is **what must not be added** |
| **Migration implications** | retirement is **last**: `inventory-reference-authority-p1b-census.md:1044` — *"**RETIRE** — subject to OR-4 preserving `skills` / dispatch status onto Employee first"* |
| **Compatibility surfaces** | it **is** the compatibility surface. It has **no schema artifact at all** (`U-6`: no zod — `zod` is not a dependency of the Functions package; no converter; the only TS type is `{id, status}` at `schedulingRepository.ts:23-26`) |
| **Tests / proofs** | a technician id is **refused** as an Employee reference; the four prohibitions are asserted rather than trusted; nothing in R1 or R2 carries a technician fact |
| **Remaining Owner decisions** | **`MI-θ`** — is technician linkage in the minimum model at all? This lane's position is **no**, because **no `OD-6` state depends on it**; but `MI-R` says further constraints are *"per family, never global"*, so whether any family's accountability requires it is family-by-family and the Owner's |
| **Status** | **NOT AUTHORIZED** |

### G — server-side person-resolution adapter (the port)

| | |
|---|---|
| **Ruled by** | `#185`: *"The governed person-resolution port must allow a current transitional implementation to be replaced by the PostgreSQL implementation **without changing `OD-7` orchestration semantics**. **One authoritative implementation at a time. No long-lived dual authority. No silent fallback from PostgreSQL to Firestore after cutover.** The interface must **hide storage** from governed business commands"* |
| **Required relations** | none. G is an interface and one adapter at a time |
| **Required constraints** | the port is **server-side only**; it is the **single** place the authority is consulted; it is consulted **exactly once per mutation**, inside the transaction (`#184` stage A/B); it returns **semantic states**, never storage shapes; **no caller may hold two implementations** |
| **Reuse vs new** | reuse of §3.4's design and §4.1 step 3's ordering. The boundary shape already exists in PostgreSQL: `functions/src/eosCommercial/commercialOwnershipRepository.ts:193` `transferCommercialOwnership`, one function, one transaction — *"they share one explicit `BEGIN/COMMIT` on one `PoolClient`"* (`:12-19`) — composed over a pure builder declaring `NO I/O` (`commercialOwnershipAuthority.ts:5-8`) |
| **Crosswalk changes** | G is what traverses the chain `#185` ruled: **CREDENTIAL → PRINCIPAL → EMPLOYEE LINK → EMPLOYEE**. **It may never shortcut it** — `#185`: *"Never Firebase user → therefore Employee"*, and *"**Principal existence alone**"* is insufficient |
| **Migration implications** | **G must precede any implementation, or the cutover cost is locked in** (§4.1 step 3; `MI-X §4.7`'s *"second cutover cost"*). Behind one port the cost is **one adapter**; without it, a re-audit of every reference |
| **Compatibility surfaces** | the transitional adapter reads Firestore `employees`; the target adapter reads R1. **Exactly one is live** |
| **Tests / proofs** | §9.5 and §9.6 in full — the semantic-equivalence suite and the single-authority guard |
| **Remaining Owner decisions** | **`MI-β`** (does `#182` Layer 1 supersede `O-1`'s exclusion of cross-collection lookup, or does `O-1` stand with resolution at the governed entry point? — **#184(e) and #185's storage-hiding clause both compose only with the latter, and this lane recommends it and cannot rule it**) · **`MI-η`** (is AUTHORITY UNAVAILABLE a distinct outcome? — **`#185` names it and defers it**: *"AUTHORITY UNAVAILABLE **if later ruled separately**"*) · **`MI-S`**, **`MI-U`** (the rest of the return set) · **`MI-V`** (does the port serve the other person references? — §5.1's **fifteen**) |
| **Status** | **NOT AUTHORIZED** |

### H — `OD-6` acceptance tests

| | |
|---|---|
| **Ruled by** | `#182` §11's thirteen required proofs; `#182`: *"Historical cases must prove **HISTORY PRESERVED**. Current-actionability cases must prove **INVALID CURRENT RESPONSIBILITY DOES NOT PASS THE GATE**."* |
| **Required relations** | none |
| **Required constraints** | the suite must be **storage-agnostic**, so that it passes unchanged against both adapters. That is the mechanical proof that `#185`'s swap requirement is met (§9.5) |
| **Reuse vs new** | reuse of the shipped fake-authority pattern — `ownershipCensus.ts:5-7`, *"a fake document source, with no emulator and no credentials"* |
| **Crosswalk changes** | none |
| **Migration implications** | **H is the cutover's acceptance gate**, so it must exist before the swap, not after |
| **Compatibility surfaces** | none — a fake authority is neither bearer, which is the point |
| **Tests / proofs** | the 13 proofs, with the coverage map at §15 of the decomposition as the starting arithmetic: **2 FULL** (P1, P4) · **2 split across layers** (P2, P3) · **3 partial** (P5, P12, P13) · **6 not covered by any existing item** (P6–P11). Plus the controls this program has established as load-bearing: a **negative control** proving today's resolvers return `RESOLVED` for all person states; a **mutation check** (deleting the authority read must fail ≥1 case); a **poisoned-getter** control proving the read was actually attempted |
| **Remaining Owner decisions** | **`MI-S`**, **`MI-T`**, **`MI-U`** — the suite cannot assert against a state set that is not fixed. `#182` §3 withholds the names and `#185` confirms *"Naming is explicitly not frozen"* |
| **Status** | **NOT AUTHORIZED** |

### I — `OD-7` orchestration integration

| | |
|---|---|
| **Ruled by** | `#184`: `OD-7` **option (e)** — *"**GOVERNED ORCHESTRATION IS THE AUTHORITATIVE HANDOFF BOUNDARY**"*; the writer does **not** independently query Employee authority because *"duplicating that lookup in a lower writer would create two authority decisions that could drift"*; *"**Any runtime mutation path capable of changing governed RECORD OWNERSHIP or ACCOUNTABILITY without passing through the governed orchestration boundary is a DEFECT.**"* `#183`: *"**DO NOT** put authoritative Employee existence lookup inside the synchronous audit writer or the pure builder"* |
| **Required relations** | none |
| **Required constraints** | `#184`'s five stages, in order — **A** authoritative fact resolution · **B** governed orchestration (read state, determine the axis change, **verify the caller may perform it**, verify Layer-1/eligibility, **preserve current responsibility until the transition commits**) · **C** pure family/axis validation · **D** audit · **E** atomic commit. *"On any failure: **ZERO HANDOFF MUTATION · ZERO PARTIAL AUDIT · ZERO RESPONSIBILITY GAP**"* |
| **Reuse vs new** | **the boundary is a CONSTRUCTION on the Firestore side, not a relocation** — conflict `C-8`. `ownershipHandoffCommand.ts:197`: *"**Nothing calls this yet**"*; `:9-14` not exported from `index.ts`. **The one place the boundary already exists in `OD-7`'s shape is PostgreSQL** (`commercialOwnershipRepository.ts:193`), which is a genuine architectural advantage of the ruled target: the cutover moves toward the datastore that already hosts the ruled shape |
| **Crosswalk changes** | none of its own; I consumes G |
| **Migration implications** | **`#185`'s swap requirement binds here**: the adapter change must not change stage semantics. §9.5 states what must be true |
| **Compatibility surfaces** | `#184` names a **bypass defect** at the baseline: `OwnerSelect.jsx` → `updateOpportunity` *"moves ownership in production and emits **no** `OWNERSHIP_HANDOFF` at all"* (`opportunityCallables.ts:337-350` writes a free-text `summary`). *"Do not make the writer compensate for a bypass — **eliminate or refuse the bypass**"* |
| **Tests / proofs** | `#184` requires, **before implementation authorization**, an **end-to-end call-path census**: `PUBLIC / API ENTRY → ORCHESTRATOR → AUTHORITY READ → PURE VALIDATOR → WRITE → AUDIT → COMMIT`, with every mutation path classified **GOVERNED · INERT · LEGACY · BYPASS DEFECT · NOT APPLICABLE**. Plus the bypass-prohibition tests `#184` names as the defence in depth: the writer holds **no authority handle**; the builder remains **pure**; no path reaches a mutation except through the entry point |
| **Remaining Owner decisions** | **`M-1`** (axis scope), **`M-2`** (which carrier owns the handoff fact), **`M-3`** (whether selecting a placement authorizes wiring or only settles architecture) — **all three explicitly left OPEN by `#183`.** Note `M-1`…`M-4` here are **not** the `M-n` of `#179`, which concerns `cycle_counts` migration |
| **Status** | **NOT AUTHORIZED** |

### J — census / responsibility-integrity integration

| | |
|---|---|
| **Ruled by** | `#182` §6 (`MI-P` CLOSED): accountability **must** be measured, but *"`accountablePerson` must **NOT** be put into `ownershipMatrix.ownerFields` merely to make the existing ownership census see it"*; acceptable directions are **a multi-axis responsibility census** **or** a **dedicated accountability census composed into the enforcement gate**. `#182` §9: *"**The gate may NOT close on a census structurally incapable of detecting:** non-existent person owner · invalid person owner · missing accountable person · invalid accountable person"* |
| **Required relations** | none. J measures |
| **Required constraints** | the census must read the port's **semantic** outcome, never a storage shape — which is what makes the same census valid before and after cutover. New outcomes get their **own counts**, and gate treatment is a **declared constant with a rationale in one named place** |
| **Reuse vs new** | reuse. And the structural defect is measured: `ownershipCensus.ts:165` maps only `family.ownerFields` and `:157-163` returns OWNERLESS when it is empty, so the census is **single-axis by construction** |
| **Crosswalk changes** | none |
| **Migration implications** | J is the gate on `OI-24` / `W6`, and §12.6 of the decomposition records that gate as **further** from closable than the pre-ruling analysis found |
| **Compatibility surfaces** | none |
| **Tests / proofs** | `#182` **proof 10** — ACCOUNTABLE PERSON missing on an **ACTIONABLE** item — is the weld proof and requires the actionable discriminator, the accountable reference **and** the census axis. And a property testable today with **no employee data at all**: `assessable` (`ownershipCensus.ts:240`) cannot go false at any quantity of person orphans, because an orphan yields `RESOLVED` (`typedOwner.ts:108`, `:124`) → bucket `"resolved"` (`ownershipCensus.ts:81-82`) → none of `blocking`'s four terms (`:231`) |
| **Remaining Owner decisions** | **`MI-X`** — *which* of `MI-P`'s two architectures. `#182` §6: *"Prepare the smallest design consistent with this ruling; **do not implement the final architecture**."* **A lane choosing would be designing the architecture the ruling reserved.** Also **`MI-W`** (is there an Owner exception list to *"exactly one accountable person"*?), which leaves the family envelope at **9 or 12** |
| **Status** | **NOT AUTHORIZED** |

---

## 9.4 THE LAYER-1 DEFECT IS ALREADY IN THE TARGET SCHEMA — and what that means for E

**Measured at `64008d5a` across all 18 migrations. Nine person columns in PostgreSQL, zero referential
constraints on any of them:**

| Column(s) | Migration, line | Constraint |
|---|---|---|
| `owner_employee_id` on `accounts` | `1758758400000_crm-account-contact-location.sql:176` | **none** (indexed at `:192`) |
| `owner_employee_id` on `contacts` | `1758758400000:219` | **none** (indexed at `:232`) |
| `owner_employee_id` on `account_locations` | `1758758400000:262` | **none** (indexed at `:281`) |
| `owner_employee_id` on `opportunities` | `1758844800000_commercial-ownership-authority.sql:184` (`NOT NULL`) | **none** |
| `owner_employee_id` on `sales_agreements` | `1758844800000:208` (`NOT NULL`) | **none** |
| `owner_employee_id` on `sales_orders` | `1758844800000:233` (`NOT NULL`) | **none** |
| **`previous_owner_employee_id` on `ownership_handoffs`** | `1758844800000:262` | **none** |
| **`new_owner_employee_id` on `ownership_handoffs`** | `1758844800000:263` (`NOT NULL`) | **none** |
| `employee_id` on `employee_principal_links` | `1758412800000:121` | **shape `CHECK` only** (`:157-158`) |

**And the asymmetry is stark on the very table `OD-1` invariants 6 and 7 are about.** In the same
`CREATE TABLE ownership_handoffs`, **four** columns are FK-constrained and the **two person columns are not**:

```
:258   tenant_id                  TEXT NOT NULL REFERENCES eos_policy.tenants(id),
:259   opportunity_id             TEXT          REFERENCES opportunities(id),
:260   sales_agreement_id         TEXT          REFERENCES sales_agreements(id),
:261   sales_order_id             TEXT          REFERENCES sales_orders(id),
:262   previous_owner_employee_id TEXT,                      -- no FK, no CHECK
:263   new_owner_employee_id      TEXT NOT NULL,             -- no FK, no CHECK
```

**Zero `REFERENCES` onto any person relation exists anywhere:**
`grep -rniE 'REFERENCES[[:space:]]+(eos_policy\.)?[a-z_]*employee' functions/migrations/` → **0 hits**.
Broadening to any `REFERENCES` line mentioning employee/person/people returns **3**, and none is a person
key: `1758412800000:32` and `:37` are header comments, `:135` is the composite key onto
`tenant_memberships`. **[OBSERVED AT: `64008d5a`]**

### 9.4a What this means for E — four consequences, stated as constraints on E

| # | Consequence |
|---|---|
| **1** | **E is not a copy, it is a repair boundary.** Migrating Firestore `employees` into R1 while leaving these nine columns unconstrained carries the `OD-6` Layer-1 defect **across the datastore boundary** and leaves it in the target. The `owner_employee_id` columns are not future storage — **they are already storage**, and they are the same shape-only defect `#182` §1 ruled insufficient: *"A PERSON reference is **not** valid merely because it is a non-empty string."* |
| **2** | **`ownership_handoffs` is the worst place for it to be, and that is a ruling-level fact.** `#183` ruled *"**NON-EXISTENT EMPLOYEE → INVALID PERSON REFERENCE → NOT ELIGIBLE AS HANDOFF TARGET**"*, and `#184` made the governed orchestration boundary responsible for establishing it. This table is **append-only and trigger-protected** (`refuse_ownership_history_mutation`, `1758844800000:295-301`: *"a correction is a NEW handoff row … not an edit to the old one"*). **So an unvalidated person id written here is permanent by design** — the same trap as `financialAttribution`'s frozen snapshot, reached through a different door. **E must not be allowed to run before this column is constrained**, because history that cannot be edited cannot be repaired |
| **3** | **E's ordering is therefore forced, not chosen:** A (R1 exists) → D (crosswalk FK) → **constrain the nine columns** → E (move rows) → cutover. **Constraining before moving is the only order in which an FK failure is a measurement rather than an outage.** §4.1 listed the nine columns as step **10**, *after* the FK at step 9; **§9.4 tightens that: they must be constrained before E populates or repoints anything that writes them.** Recorded as a revision to §4.1's ordering, not a contradiction of it |
| **4** | **The constraint work is itself a measurement.** Adding a referential constraint to a column that already holds rows **cannot succeed** while any value fails to resolve — so the attempt is the census. This is the same property `#182` §9 requires of the gate, obtained from the database instead of from a script, and it is why this lane recommends the constraints be specified with A rather than deferred behind E |

**A caution that belongs with this finding.** `#182` §10 forbids backfill and `#182` §8 forbids rewriting
history automatically. **Constraining a column is not rewriting it**, but a constraint that cannot be added
creates pressure to "fix" the offending rows — and **that** pressure is what `#182` §10 exists to refuse.
**E must have a declared answer for a non-resolving row that is neither a rewrite nor a silent drop**, and
what that answer is belongs to `MI-ε` and to the new question **`MI-λ`** below.

---

## 9.5 WHAT MUST BE TRUE FOR THE PORT TO SWAP WITHOUT CHANGING `OD-7` SEMANTICS

`#185`, verbatim: *"The governed person-resolution port must allow a current transitional implementation to be
replaced by the PostgreSQL implementation **without changing `OD-7` orchestration semantics**."* `#184` fixes
what those semantics are. **Six conditions, each stated so it is checkable rather than intended:**

| # | Condition | Why `#184` / `#185` requires it | How it is checked |
|---|---|---|---|
| **1** | **The port's contract is expressed only in semantic states, never in storage shapes.** No document reference, no row, no snapshot, no `DocumentSnapshot`, no `PoolClient` crosses it | `#185`: *"The interface must **hide storage** from governed business commands"* | A type-level boundary test: the port's signature mentions no datastore type. The negative control is `typedOwner.ts`, whose `OwnerDerivation` has **nowhere to put** a non-shape fact — the obstruction §12.3c of the decomposition records as discharged by `#182`'s two layers |
| **2** | **Resolution happens exactly once per mutation, at `#184` stage A, inside the transaction** | `#184`: duplicating the lookup *"would create two authority decisions that could drift"*; `#183`: the writer's `assertValid` (`auditEventWriter.ts:460`) is **synchronous and returns `void`**, so it **could not** perform the lookup even if asked | A test that the writer and the builder **hold no authority handle**. This is structural, not disciplinary: the writer cannot drift because it never receives the handle, and the builder cannot because its purity forecloses it |
| **3** | **The failure mode is identical across adapters: refuse before write.** `#183`: *"**If resolution fails: REFUSE BEFORE WRITE.** No ownership, accountability or assignment mutation may occur"* | `#184`: *"On any failure: **ZERO HANDOFF MUTATION · ZERO PARTIAL AUDIT · ZERO RESPONSIBILITY GAP**"* | The `OD-6` acceptance suite (item H) **passes unchanged against both adapters.** That is the operational definition of *"without changing `OD-7` semantics"* — if the suite needs editing for the swap, the swap changed semantics |
| **4** | **Atomicity is provided by the host transaction, and both adapters participate in the caller's transaction rather than opening their own** | `#183`: the handoff must be *"one governed transactional operation: `READ AUTHORITATIVE FACTS · VALIDATE · WRITE RESPONSIBILITY CHANGE · WRITE AUDIT · COMMIT`"* | The shipped precedent is the property to preserve: `commercialOwnershipRepository.ts:12-19` — *"they share **one explicit `BEGIN/COMMIT` on one `PoolClient`**"* — and `ownershipHandoffCommand.ts:194-198`, staged *"onto a caller-supplied transaction or batch… **never independently**"*. **A Firestore transaction and a PostgreSQL transaction are not interchangeable objects, so condition 4 is the one that does real design work**: the port must take the transaction from the caller as an opaque handle, or the adapters are not substitutable |
| **5** | **The transitional adapter's outcomes are a subset of the target adapter's, never a different set.** A state the Firestore adapter cannot produce must be **absent, not approximated** | `#182` §1: NON-EXISTENT and DELETED/UNRESOLVABLE *"must **not** produce the same authoritative `RESOLVED` result as a real Employee"* — approximating one state with another is exactly the defect | For each semantic state, an assertion that the transitional adapter either **produces it** or **declares it unproducible**; never that it maps it onto a neighbour. The tombstone question (`U-5`/`U-10`) is the live instance, and §1.2 established it is **not** on `OD-6`'s critical path — states **C**'s *never-existed* and *removed* are already fused by `#182` |
| **6** | **`OD-7`'s five stages are ordered by the orchestrator, not by the adapter.** The adapter answers a question; it never decides when it is asked | `#184` stage **B**: *"**preserve current responsibility until the governed transition commits**"* — a sequencing guarantee the adapter cannot make | A call-order assertion in the orchestrator's tests, with the poisoned-getter technique as the control: if stage A is skipped, the read was never attempted and the test must fail |

> **The single most important of the six is 4.** Conditions 1–3, 5 and 6 are satisfiable by interface
> discipline. **Condition 4 is where a Firestore-to-PostgreSQL swap can silently change `OD-7` semantics
> even with an unchanged signature**, because Firestore transaction semantics and PostgreSQL
> `BEGIN/COMMIT` + `FOR UPDATE` semantics differ in what they serialize. `commercialOwnershipRepository.ts`
> uses `FOR UPDATE` specifically so that *"the second one records the first one's new owner as its previous
> owner instead of overwriting it"* (`:185-188`) — **a guarantee the Firestore adapter must be proved to
> provide, not assumed to.** Registered as `U-11` (§9.10).

---

## 9.6 HOW "NO SILENT FALLBACK AFTER CUTOVER" IS ENFORCED RATHER THAN INTENDED

`#185`, verbatim: *"**One authoritative implementation at a time. No long-lived dual authority. No silent
fallback from PostgreSQL to Firestore after cutover.**"*

**"No silent fallback" is a property that review cannot hold.** A fallback is added by someone solving an
outage under pressure, and it is invisible precisely because it works. So the enforcement must be
**structural or ratcheted**, and this repository already owns both mechanisms.

| Mechanism | What it makes impossible | Precedent that exists at `64008d5a` |
|---|---|---|
| **① Exactly one adapter is constructible at a time** — the authoritative implementation is selected once, at composition, and **no code path can hold both** | A `catch` that reaches the other bearer, because the other bearer's client is not reachable from the call site at all | The strongest form of this already holds by accident and is measured: the transitive import closure from `functions/src/index.ts` over `src/` reaches **297 files, ZERO of which import `pg`** (§1.5). **Unreachability is a real, verified, testable property in this codebase — not an aspiration** |
| **② An import ratchet with a pinned count** — the set of modules that may import the non-authoritative bearer's client is enumerated and asserted, so adding one is a **failing test and a visible diff**, not a deploy | A new caller quietly acquiring the retired bearer | `scripts/firebaseExitGuard.mjs`, the `BUSINESS_RUNTIME` ratchet with `"baselineIsAFloorNotATarget": true` (`firebase-exit-manifest.json:56-57`); `ownershipMatrix.ts:97-100`'s R-1 source guard; the ENG-B ratchet |
| **③ The authority answer carries its provenance, and a mismatch is a refusal, not a log line** | A degraded answer being consumed as authoritative | `#182` §1's whole premise: *"Before EOS describes a person reference as authoritatively resolved it must establish that the referenced Employee **exists in the governed Employee authority**"* |
| **④ A distinct AUTHORITY-UNAVAILABLE outcome that fails closed on mutation** | An outage becoming *"this person does not exist"* — which is what a fallback is usually added to avoid, so **removing the motive is part of the enforcement** | §3.5's fifth outcome. **`#185` names it and defers it**: *"AUTHORITY UNAVAILABLE **if later ruled separately**." So ④ is the one mechanism of the five that is not yet available by ruling* — `MI-η` |
| **⑤ The old bearer is demoted in Rules and in code, not merely unused** | Any client or trusted path treating the archive as current | `firestore.rules:497` already denies **all** client writes to `/employees/{employeeId}` (`allow create, update, delete: if false;`), so the Firestore bearer is **already** write-closed to clients. Cutover adds: no trusted path reads it **for authority**, only for evidence |

**Stated as the acceptance test the cutover must pass:**

> **A test that fails if any module reachable from the deployed entrypoint can obtain a person-authority
> answer from the non-authoritative bearer — asserted by import closure and by a pinned count, not by
> reading the code.** Plus: a test that an authority outage produces the unavailable outcome and **refuses
> the mutation**, and a test that the archive bearer is read only on evidence paths.

**Two honest limits.** ④ depends on a ruling `#185` explicitly deferred, so until `MI-η` is answered the
enforcement is four mechanisms, not five — and the missing one is the one that removes the *motive* for a
fallback. And ①'s strongest form is currently an **accident** of deployment topology (`eosApi/server.ts` is
not reachable from `index.ts`, and is **not deployed** at all); **after cutover that accident inverts**, and
what was unreachable becomes the authority while what was the authority must be made unreachable.
**Nobody has designed that inversion, and it is not designed here.** Registered as `U-12`.

---

## 9.7 CROSSWALK CHANGES — consolidated

| # | Change | Item | Kind | Basis |
|---|---|---|---|---|
| **1** | A **real referential constraint** from R2's employee reference onto R1, **composite and tenant-scoped** | **D** | **ADD** | `#185` *"real foreign keys"*; `1758412800000:55-57`, and `:39-42` for why composite |
| **2** | The existing composite FK onto `tenant_memberships` (`:133-135`) | **D** | **RETAIN UNCHANGED** | `:39-42` — a simple key onto `principals` would permit a cross-tenant identity leak |
| **3** | The two **partial** unique indexes (`:169-176`) | **C**, **D** | **RETAIN UNCHANGED** | `:167-168` *"history survives, ambiguity does not"* — this is the retention pattern, already built |
| **4** | The `employee_id` shape `CHECK` (`:157-158`) | **D** | **RETAIN WITH A DECLARED EXPIRY** | It encodes *"`employee_id` is a Firestore document id today"* (`:60-61`), which ceases to be true at cutover. It is a transitional constraint, and saying so is the difference between retiring it and forgetting it |
| **5** | **The `link_source` closed vocabulary contains a transitional provenance.** `:140` admits exactly `'RECIPROCAL_FIREBASE_UID_LINK'` and `'OPERATOR_ASSERTED'`; `:80` documents the first as *"`employees/{id}.userId` and `users/{uid}.employeeId` agree"* | **D**, **E** | **DECIDE — a governed successor, or a declared retirement** | `#185`: the crosswalk *"must not rely permanently on matching strings · Firebase uid coincidence · **`users/{uid}.employeeId`**"*. **NOT IN THE BRIEF; this lane's finding.** `:138`'s own reasoning — the closure exists so a third value is a deliberate act — is why this must be decided rather than drifted into |
| **6** | **No `technician_id`, no `employment_status`, no `display_name`, no `external_subject`, no `identity_provider`, no `skills` on R2** | **B**, **F** | **PROHIBITION, RETAINED** | `:107-111` — *"a copy here would be a second place for the same fact to be stated, which is the only way two places can ever disagree"* |
| **7** | **E creates no links.** A moved Employee with no resolvable principal link is a **measured incompleteness**, never an inferred link | **E** | **PROHIBITION** | `#185`: *"Never Firebase user → therefore Employee"*; the crosswalk may not rest on *"client-side linkage"* |

---

## 9.8 REMAINING OWNER DECISIONS

**CLOSED and marked so throughout §9:** `OD-1` (#180) · `MI-N` (#181) · `OD-6`, `MI-P`, `MI-Q`, `MI-R`
(#182) · `M-4` (#183) · `OD-7` (#184) · **`MI-ι` (#185)**.

| Ref | Question | Blocks | Status |
|---|---|---|---|
| **`MI-S`** | Is state **B** a distinct resolution outcome, or `RESOLVED` + a separately carried eligibility fact — and must INACTIVE be distinguishable from TERMINATED inside it? | **B**, **G**, **H**, and 10 of the 42 register items | OPEN |
| **`MI-U`** | Is state **C** (`MISSING / INVALID_REFERENCE`) **one** state or **two**? Today *missing* blocks the gate (`ownershipCensus.ts:231`) and *invalid reference* cannot block at any quantity — **opposite treatment for one ruled state** | **G**, **H**, **J** | OPEN |
| **`MI-T` / `MI-η`** | Is **AUTHORITY UNAVAILABLE** a fifth outcome distinct from **C**? | **G**, **H**, and enforcement mechanism ④ of §9.6 | **OPEN, and now NAMED-AND-DEFERRED by `#185`** — *"AUTHORITY UNAVAILABLE **if later ruled separately**"*. It is no longer a lane's invention; it is a deferred ruling |
| **`MI-X`** | Which of `MI-P`'s **two** acceptable census architectures? | **J**, and 7 register items | OPEN. **Note the label collides** with `MI-X-PERSON-AUTHORITY-OPTIONS.md`; `MI-α` should settle it |
| **`MI-ε`** | `employees` is **not the complete person population**. Does Layer 1 **fail closed** on those people — declaring real actors non-existent — or is completeness a **precondition**? | **A**, **D**, **E** — **E cannot proceed without it** | OPEN. A product decision about real people being refused |
| **`MI-δ`** | Must any part of Layer 1 be enforceable in `firestore.rules`? | **B**, and the whole cutover sequence | OPEN. If yes, **no PostgreSQL relation can ever serve it**, and four Rules sites (`:61`, `:92`, `:114`, `:141`) must be re-homed out of the security boundary |
| **`MI-γ`** | Must a person reference resolve an **Employee only**, or an Employee **and** a live principal link? | **D** (whether its FK is on Layer 1's critical path), **G** | OPEN |
| **`MI-β`** | Does `#182` Layer 1 supersede `O-1`'s exclusion of cross-collection lookup, or does `O-1` stand with resolution at the governed entry point? | **G** | OPEN. **`#184`(e) and `#185`'s storage-hiding clause both compose only with the latter.** This lane recommends it and cannot rule it |
| **`MI-ζ`** | Sequence R1 with the Firestore answer, or decide both together? | **A**, **E** | OPEN. **`#185` supplies the missing input**: §9.4's finding that the defect is already reproduced in the PostgreSQL schema argues for deciding together |
| **`MI-θ`** | Is technician linkage in the minimum model at all? | **F** | OPEN. This lane's position: **no** — no `OD-6` state depends on it |
| **`MI-V`** | Does Layer 1 extend to the **fifteen** person references of §5.1, including `creditedSalespersonId` and `responsibleEmployeeId` on `person()`'s `nonEmpty`-only floor (`financialAttribution.ts:205-209`)? | **G**'s scope | OPEN. `#185` rules the **authority**, not the **scope**; extension remains **by analogy, not by ruling** |
| **`MI-J`** | Which employee fact is authoritative for *"this person can no longer act"*? | **B** | OPEN. `SYSTEM_AUTHORITIES.md:121` warns against conflating it with account state |
| **`MI-W`** | Is there an Owner exception list to *"exactly one accountable person"*? | **J**, `OI-01` | OPEN. Leaves the family envelope at **9 or 12** |
| **`MI-α`** | The register label for the person-authority question | all of §9's citations | OPEN |
| **`MI-λ`** *(NEW, this lane)* | **Is item E a "backfill" under `#182` §10, or a governed datastore move of an existing record?** And **what is the declared disposition of a row whose person reference does not resolve when the constraints of §9.4 are added** — given that it may be neither a rewrite (`#182` §8: do not rewrite history automatically) nor a silent drop (`#180` invariant 6: historical accountability must remain auditable)? | **E**, and the ordering of §9.4a(3) | **OPEN.** `#182` §10 forbids backfill in terms aimed at *repairing references*; E moves records. **The words collide and a lane may not choose which one governs a migration.** Without an answer, E has no legal action for a non-resolving row, and §9.4's constraint attempt has no defined outcome |
| **`MI-κ`** *(registered in the decomposition, §23)* | What is the governed **job-role vocabulary**, and who may occupy it? | `OI-04`; nothing can **name** an accountable person without it | OPEN |

**Plus the documentation reconciliation `#185` itself directs, and which is not implemented here:** strike
**`/Employee`** from the identity carve-out in `docs/architecture/firebase-exit-manifest.json` and
`docs/architecture/firebase-exit-ratchet.md:4`, leaving `Principal`; correct
`firebase-exit-ratchet.md:70-71`'s *"identity is the one Firebase capability this architecture keeps on
purpose"* to the manifest's own *"not decided here"*; and record that `OD-6` Layer 1 **cannot** be satisfied
through the identity exception. `#185` notes that `firebase/auth`, `firebase-admin/auth` and
`firebase-admin/app` staying outside `FORBIDDEN_CATEGORIES` (`firebase-exit-ratchet.md:66-72`) is
**unaffected**. **Both files are outside this lane's allowed surface and neither was touched.** And
`docs/PROJECT_ARCHITECTURE.md:88` (*"Firestore is the source of truth for all operational data"*) now
requires reconciliation too — recorded, not edited.

---

## 9.9 SEQUENCE — §4.1 REVISED, WITH THE ORDERING §9.4 FORCES

**§4.1's twelve steps stand. Two revisions, and every step remains `NOT AUTHORIZED`:**

| Revision | §4.1 as written | §9 |
|---|---|---|
| **R-i** | Step **10** constrains the nine PostgreSQL person columns **after** step 9's crosswalk FK | **The nine columns must be constrained before E populates or repoints anything that writes them** (§9.4a(3)). `ownership_handoffs` is append-only and trigger-protected, so an unvalidated id written there is **permanent by design**. Constraining before moving is the only order in which an FK failure is a measurement rather than an outage |
| **R-ii** | Step **1** records the six-candidate classification, blocked on conflict `C-1` | **`#185` supersedes the classification question**: all three matrix "authority" rows (`ownershipMatrix.ts:513`, `:514`, `:515`) are ruled **transitional**, so the classification to record is the ruling's, not this lane's. **`C-1` still blocks editing `ownershipMatrix.ts`** — the two readings still disagree about whether that file is defective at all — so step 1 becomes *"record the ruling where the trusted tree can see it"* and the matrix edit stays blocked |

---

## 9.10 UNPROVEN — §9 additions

`U-1` … `U-9` of §6 stand. **`U-1` is partly discharged**: `#182`, `#183`, `#184` **and** `#185` have now been
read at source on `int/a-correctness-register`, so §9's readings are readings of the **rulings**, not of a
brief. What `U-1` still covers: `#182` does not state Layer 1's *location* (`#184` does, and `MI-β` remains
the formal question), and whether the four states constrain **outcomes** as well as states is **named and
deferred** by `#185` rather than answered.

| # | Unproven | Why | What would prove it |
|---|---|---|---|
| **U-10** | The enumeration and exact wording of **`MI-ι` §11 items A–J** | **No `MI-ι` document exists at any ref** (§9.0). `#185` confirms A–J exist and are *"prepared only"*; it does not list them | The Owner publishing the `MI-ι` packet, or `#185` being amended to enumerate A–J |
| **U-11** | That a Firestore adapter can provide the serialization guarantee the PostgreSQL boundary provides with `FOR UPDATE` (`commercialOwnershipRepository.ts:185-188`) | No code was executed and no transaction semantics were tested. **This is condition 4 of §9.5 and the one place a signature-identical swap can change `OD-7` semantics** | A concurrency test against both adapters asserting the same previous-owner outcome under two simultaneous handoffs |
| **U-12** | That the post-cutover **inversion** of §9.6 mechanism ① is designable — what is now unreachable (`eosApi/server.ts`, not reachable from `index.ts`, and **not deployed**) becomes the authority, and what is now the authority must be made unreachable | No such design exists and none is proposed here | A cutover design that states the import-closure invariant in both directions, with the ratchet that holds it |
| **U-13** | Whether migrations **004–018** — including `1758412800000` and `1758844800000` — are applied in **any** environment, i.e. whether §9.4's nine unconstrained columns exist as **rows** or only as **DDL** | No environment was contacted. `U-2` records the only activation evidence as `migrations: 3` | A migration-state read under whatever authority governs it. **Load-bearing for E**: it changes the cost of §9.4a by an order of magnitude, and it decides whether the constraints of §9.4a(3) are a schema edit or a data reconciliation |
| **U-14** | Whether any row exists in `employee_principal_links` anywhere (`U-3`, restated because **D's FK cannot be added over non-resolving rows**) | No environment was contacted | The same read |
| **NOT_RUN** | **No test, typecheck, build, lint, or emulator was executed. No `java`. No `functions/lib` was consulted for any claim and it was excluded from every search. No `functions/node_modules` was borrowed. No production or non-production environment was contacted. No schema, migration, backfill, or Rules change was written. No DDL was added to any file.** Every §9 measurement is a file read in a git worktree at `64008d5a`, plus four `git show` reads of `int/a-correctness-register:docs/DECISIONS.md` | — |

---

## 9.11 WHAT §9 DELIBERATELY DOES NOT CONTAIN

- **No DDL.** Not in a migration file, not in a fenced block presented as schema. The one fenced block in
  §9.4 is **quoted from `1758844800000:258-263` as it exists**, to show the asymmetry — it is evidence, not a
  proposal.
- **No migration executed, no backfill, no repair path, no data mutation, no Rules change, no deploy, no
  production contact.**
- **No table name, column name, enum name, index name or interface name proposed.** R1 is *"the Employee
  relation"* throughout. `#182` §3 withholds the names and `#185` says *"Naming is explicitly not frozen by
  this ruling"* — **including the person-authority interface's naming, which is expressly not frozen here.**
- **No answer to `MI-S`, `MI-T`/`MI-η`, `MI-U`, `MI-V`, `MI-W`, `MI-X`, `MI-β`, `MI-γ`, `MI-δ`, `MI-ε`,
  `MI-ζ`, `MI-θ`, `MI-J`, `MI-α`, `MI-κ`, `MI-λ`, `O-1`, `M-1`, `M-2`, `M-3`, `OD-8`, `OD-13` or `OD-16`** —
  and **no choice between `MI-P`'s two architectures.**
- **No edit to `docs/architecture/firebase-exit-manifest.json`, `docs/architecture/firebase-exit-ratchet.md`,
  `docs/PROJECT_ARCHITECTURE.md` or `functions/src/ownership/ownershipMatrix.ts`** — all outside this lane's
  allowed surface, and the matrix additionally blocked on conflict `C-1`.
- **No retirement of, or deletion from, any collection or table** — `employees` becomes `ARCHIVE`, never a
  deletion (item C), and `fieldops_technicians`' unique facts must be re-homed first (item F).
- **No schedule.** `firebase-exit-manifest.json:60-62` is `"waves": []`, and the wave model says ordering
  *"belongs to the engineers and owners doing the migration work, not to this control document."* §9.9 states
  **dependencies**, not dates.
