---
artifact_type: owner-decision-options
gate: MI-X-PERSON-AUTHORITY (label collides — see §0.1; the register calls this OI-39 / V-15 / X-13 / BA-7)
status: Options enumerated. NO CHOICE MADE.
date: 2026-09-13
owner: Claude Code (lane MI-X-PERSON-AUTHORITY, EVIDENCE_WRITE)
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
related_adrs: []
depends_on:
  - docs/DECISIONS.md
  - docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md
implements: []
supersedes: []
superseded_by: []
---

# `MI-X` — WHICH COLLECTION IS *THE* PERSON AUTHORITY

**OBSERVED AT: `64008d5a`** for every claim below unless a line says otherwise. Two exceptions are
marked inline and only two: `docs/operating-model/engineering/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md`
(this branch's `HEAD` `f44235f8`; **not present at `64008d5a`**) and the production census commit
`be1e5579`.

**This document chooses nothing.** `OD-6` / `#182` is recorded on `int/a-correctness-register`, not on
this branch (this branch's `docs/DECISIONS.md` ends at **`#179`** — verified: last heading is
`## #179 — OWNER RULINGS: M-1 Option A…`). `#182` is cited **by number and ref** throughout, never by
relative link. **No schema. No field name. No enum name. No migration. No backfill.**

---

## 0. FIVE CORRECTIONS TO THE BRIEF, BEFORE THE OPTIONS

Correcting the brief was declared in scope. Five items.

| # | The brief said | Evidence at `64008d5a` (or as marked) | Consequence |
|---|---|---|---|
| **B-1** | The lane is `MI-X` | **`MI-X` IS ALREADY TAKEN, AND MEANS SOMETHING ELSE.** `OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1184` (`HEAD`): "**MI-X** \| Which of `MI-P`'s **two** acceptable architectures? … *(i)* a multi-axis responsibility census and *(ii)* a dedicated accountability census composed into the gate". Restated at `:1208`: "**No choice between `MI-P`'s two architectures.** `MI-X` records it as the Owner's." | **The label collides.** This question is already registered — as **`V-15`** (`:722`), **`OI-39`** (`:1109`) and correction **`X-13`** (`:1197`), and independently as **`BA-7`** (`docs/architecture/inventory-reference-authority-p1b-census.md:62`, `:497`, `:983`). Filed under the brief's label as instructed; **a distinct MI letter is needed and naming it is not a lane's call** → MISSING INPUT **MI-α** (§7) |
| **B-2** | "the Rules expose it at `firestore.rules:418`" | The `fieldops_technicians` **match block opens at `firestore.rules:397`** and closes at `:423`. `:418` is the **`allow update`** line only | The block is wider than one line, and the wider block is the load-bearing fact: it carries a **client `allow create`** at `:407-408` and a **client `allow update`** at `:418-419`. (The brief's `:418` matches the decomposition's own `X-12` citation of the 5 un-allowlisted update statements — consistent, but it is not the block) |
| **B-3** | "`isTypedOwner` `:67`" | `isTypedOwner` is **declared at `typedOwner.ts:62`**; `:67` is its `USER` branch — `if (v.type === OWNER_TYPES.USER) return nonEmptyString(v.id);` | `:67` is the correct line for *the defect* (the USER arm is shape-only); `:62` is the function. Both wanted |
| **B-4** | the census `be1e5579` "shows one principal `admin@global` with **`employeeId: null`**" | **VERIFIED, with a precision.** `be1e5579:docs/assessments/r32-production-exposure-census.json:21-28` — `"principalUid": "JBslDvmpq8RqQAiyzfvwne9yCWc2"`, `"employeeId": null`, `"activeAssignments": ["admin@global"]`. `admin@global` is the **role@scope assignment name**, not the principal. The anomaly row `be1e5579:…census.md:120` states the missing thing precisely: `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` — the principal "**has no `users/{uid}.employeeId`**" | The unpopulated linkage is on the **`users` side**, not a null on an `employees` document. This matters: it is `users/{uid}.employeeId` that is absent, and `users` is one of the candidates |
| **B-5** | "Check `functions/src/constants/collections.ts`" for which collections exist | **NONE OF THE THREE CANDIDATES IS DECLARED THERE.** The file is 143 lines and declares 30 collection constants; `employees`, `users` and `fieldops_technicians` **do not appear in it at all** (grep `-iE "employee\|users\|technician"` over `64008d5a:functions/src/constants/collections.ts` → **zero hits**) | The three candidates are **string literals scattered across call sites**, not governed constants. A prior lane found the same and said so: `docs/architecture/inventory-reference-authority-p1b-census.md:40` — "A methodological finding that shaped everything below: `functions/src/constants/collections.ts`…". **Every option below therefore inherits a literal-scatter problem, and it is identical across options** — it discriminates between none of them |

### 0.1 What the register already says, so this lane does not re-derive it as new

| Register item | Ref | What it already records |
|---|---|---|
| **`V-15`** | `…DECOMPOSITION.md:722` (`HEAD`) | "Which collection is *the* person authority? \| **AMBIGUOUS IN THE MATRIX ITSELF.** … **Two rows literally say 'person authority.'**" |
| **`OI-39`** | `…DECOMPOSITION.md:1109` (`HEAD`) | "`#182` Layer 1 requires *authoritative* resolution. **It cannot name *'the'* authority until this is settled**, and this **compounds** open item `O-1`" |
| **`X-13`** | `…DECOMPOSITION.md:1197` (`HEAD`) | Part I's §2.2 `C-B1` quote is exact but "**the CITATION is off by 19 lines**" — the `employees` row is `:514`, not `:533` — "and the substantive error is larger than the line number" |
| **`BA-7`** | `docs/architecture/inventory-reference-authority-p1b-census.md:62`, `:497`, `:520`, `:983` | Employee is **`DUPLICATE_AUTHORITY`** across "`employees` + `users` + `fieldops_technicians` + `eos_policy.principals` \| **four disjoint id spaces**"; disposition **`E. NEEDS_OWNER_RULING`** |
| **Part I `C-B1`** | `…DECOMPOSITION.md:212-215` (`HEAD`) | **Already answers it** — "The authority is the one the matrix already names: `employees`…". `X-13` is the correction that its definite article "is unearned" |

**So the question has been asked four times under four labels and answered once, by a lane, in a
document that another lane then corrected.** That is the state this options paper is written into.

---

## 1. THE THREE MATRIX ROWS, QUOTED EXACTLY

`functions/src/ownership/ownershipMatrix.ts`, **OBSERVED AT: `64008d5a`**:

```
513|        ["user", "users", "identity authority -- a subject of ownership, not an object"],
514|        ["employee", "employees", "person authority -- a subject of ownership, not an object"],
515|        ["technician", "fieldops_technicians", "person authority"],
```

**The brief's lines and wording are exact.** Two rows do say `"person authority"`.

### 1.1 But the brief's *reading* of what those rows are needs one qualification — carried both ways

The three rows sit inside a block whose own banner is:

```
507|      // ═══════════════════════ EXCLUDED — not business records ═══════════════════════
509|      // Recorded rather than omitted, so a reader can see these were considered. A collection absent
510|      // from this file entirely would be indistinguishable from one nobody thought about.
```

and the third tuple element is bound to the field **`note`**, with every row in the block forced to
`ownerClass: "EXCLUDED"`, `ownerType: null`, `ownerFields: []`, `unresolvedPolicy: NOT_OWNABLE`
(`:531-535`). **17 rows share that mapper** (`:513-529`).

| Reading | Statement | Consequence for `MI-X` |
|---|---|---|
| **R-A (the brief's)** | These are **authority declarations**, and the matrix declares three of them, two identically. The matrix therefore fails to name *the* person authority | `MI-X` is a defect in `ownershipMatrix.ts` and the fix includes editing it |
| **R-B (the block's own framing)** | The third element is a **free-text exclusion rationale** (`note`), answering *"why is this not an ownable family"*, **not** *"which collection is the authority"*. On this reading the matrix was **never asked** the question and so cannot have answered it wrongly — `C-B1`'s error is reading an authority designation out of a rationale string | `MI-X` is a defect in `C-B1`'s inference, not in the matrix, and `ownershipMatrix.ts` may need no change at all |

**Both readings are carried. They are not resolved here.** They differ in what gets edited, which is
a design consequence, and `#182` withholds design. Note that **R-B strengthens rather than weakens
`MI-X`**: if the matrix never named a person authority, then nothing at `64008d5a` names one *inside
the ownership module*, and Layer 1 has no in-module source at all.

---

## 2. THE CANDIDATE SET, DERIVED

The brief's list was not assumed. Derived by (a) every collection/table any code or doc calls a
person, employee, identity, principal or subject authority; (b) every id space a person reference at
`64008d5a` is drawn from. **The brief's list is incomplete in two places and over-broad in none.**

| # | Candidate | In the brief? | Grounded at `64008d5a`? |
|---|---|---|---|
| **1** | Firestore `employees` | yes | **YES** |
| **2** | Firestore `users` | yes | **YES** |
| **3** | Firestore `fieldops_technicians` | yes | **YES** |
| **4** | **Composite** `employees` (existence + status) + `users` (principal linkage) | yes | **YES — and already implemented twice**, §5.3 |
| **5** | PostgreSQL `eos_policy.principals` | yes ("the PostgreSQL `eos_policy` / identity side") | **YES, as a table. NO, as a person authority** — §4.5 |
| **6** | PostgreSQL **`eos_policy.employee_principal_links`** | **NO — ADDED BY THIS LANE** | **YES as DDL; NOT reachable** — §4.6. This is a *distinct* candidate from `principals`: it is the only artifact anywhere that carries an `employee_id` column, and conflating it with `principals` (which has none) would mis-assess the Postgres option |
| **7** | **Firebase Authentication** | **NO — ADDED BY THIS LANE, AND REJECTED** | Grounded, and **explicitly disqualified by governance**: `docs/CLAUDE_CONTEXT.md:62` — "Firebase Authentication is the **credential authority only** — the three are never merged into one entity". Recorded so the Owner can see it was considered, per the matrix's own `:509-510` principle |
| **8** | A future PostgreSQL `employees` table | no | **NO — DOES NOT EXIST.** `functions/migrations/1758412800000_employee-principal-linkage.sql:46-47`: "**THERE IS NO `employees` TABLE IN POSTGRESQL YET.** The canonical Employee record still lives in Firestore's `employees` collection". **Excluded from the options table as ungrounded**; its bearing on the *eventual* answer is §4.7 |

---

## 3. THE POPULATIONS, MEASURED — read the options table against these

Two censuses, **two different environments**, and they must not be merged.

| Fact | Value | Source |
|---|---|---|
| **PRODUCTION** (`taylor-parts`), 2026-09-02 | `users` **16** · `employees` **6** · `roleAssignments` **2** | `be1e5579:docs/assessments/r32-production-exposure-census.json:2-11` |
| …one principal with **no** employee link | `JBslDvmpq8RqQAiyzfvwne9yCWc2`, `employeeId: null` | `be1e5579:…census.json:21-28`; anomaly row `…census.md:120` |
| **NONPROD / sandbox**, 2026-09-11 (base `a8ec169e`) | `employees` **60**, `userId` populated **60/60**, **zero** dangling either way, **zero** bidirectional disagreements | `docs/architecture/inventory-reference-authority-p1b-census.md:802-805` |
| …`users` | **62**, `employeeId` on **60**; the 2 extras are probe artifacts (`PROBE_NOT_A_REAL_UID`, `probe-principal-that-does-not-exist`) | `…p1b-census.md:803-805` |
| …`fieldops_technicians` | **13**. 11 (`cw-emp-012`…`cw-emp-022`) have doc id == `technicianId` == `employeeId`. **2 orphans** `tech-sbx-01`, `tech-sbx-02` "exist as no employee" | `…p1b-census.md:795-800` |
| …and the orphan that exists nowhere else | "`tech-sbx-02` also has `userId: null`: **it exists in no other collection**, so a cutover treating `employees` as complete deletes it. **15% of the technician population is unrepresented in the canonical authority**" | `…p1b-census.md:798-800` |
| …a fact `employees` does not hold | "`fieldops_technicians.skills` exists on **0 of 60 employees** (no skills-like field at all)"; dispatch `status` (available 11 / off_shift 2) "likewise has no `employees` equivalent" | `…p1b-census.md:807-810` |
| …`users` holds no surviving business fact | "`users/{uid}` carries **no** surviving business fact (one vocabulary skew: uid `0TeiR5…` has `users.role="admin"` vs `employees.securityRole="Owner"`, and `"Owner"` is absent from `type Role` at `functions/src/callerContext.ts:8`)" | `…p1b-census.md:811-814` |
| …only one `users` doc carries a `technicianId` at all | "Only 1 user doc carries `technicianId` at all (`rgVA63… → tech-sbx-01`)" | `…p1b-census.md:828-829` |
| Sandbox is synthetic | "The sandbox is ~100% synthetic" | `…p1b-census.md:963` |

**Consequence stated once, because it applies to every option:** the two populations disagree about
what an `employees`-keyed Layer 1 would fail closed on. In **nonprod** the `employees`↔`users` edge is
a clean bijection and Layer 1 would be near-silent; in **PRODUCTION** one of the principals that can
act has no employee link at all, and Layer 1 keyed on `employees` fails closed on it.

---

## 4. THE OPTIONS — nine fields each

### 4.1 OPTION 1 — Firestore `employees`

| Field | Assessment |
|---|---|
| **AUTHORITY SOURCE** | Firestore collection `employees`, doc id = `employeeId`. Not in `collections.ts` (B-5); literal at `functions/scripts/provisionEmployeeAccess.js:209`, `functions/src/access/adminCredentialCallables.ts:104`, `field-ops-app-vite/src/domain/constants.js:35` |
| **WHAT RECORDS IT REPRESENTS** | The workforce/business person. `firestore.rules:433-436`: "**Employee is the authoritative workforce identity** … — separate from `users/{uid}`'s application-access identity above." `functions/src/employeeIdentity/employeePrincipalLink.ts:5`: "**The canonical business Employee is Firestore's `employees` collection.**" `employeePrincipalLinkPlan.ts:19-20`: "`employees` — **CANONICAL business Employee**." `docs/architecture/SYSTEM_AUTHORITIES.md:121`: "`employees` is **still the authoritative workforce identity**" |
| **IDENTITY RELATION** | `employees/{id}.userId` is "the Employee record's own statement about its external subject" (`employeePrincipalLinkPlan.ts:19-20`). The **only** derived link term is `RECIPROCAL_FIREBASE_UID_LINK` — `employees/{id}.userId` and `users/{uid}.employeeId` must "**agree in BOTH directions**" (`employeePrincipalLink.ts:36-39`); a one-way link is `NON_RECIPROCAL_USER_LINK` (`:71`). The uid is never an EOS id: "A Firebase UID is an **EXTERNAL IDENTITY KEY ONLY**… never an EOS-native identifier, and never an Employee id" (`employeePrincipalLink.ts:6-8`). Relation to `fieldops_technicians`: **none stored** — `…p1b-census.md:211-213` "There is no mapping between `employees` and `fieldops_technicians`" |
| **EMPLOYEE STATUS SOURCE** | **`employees/{employeeId}.employmentStatus`**. Six values, declared as a frozen list at `functions/src/access/employeeProfileCommands.ts:122-129` — `ACTIVE`, `ON_LEAVE`, `INACTIVE`, `TERMINATED`, `RETIRED`, `CONTRACTOR` — mirrored by literal in `provisionEmployeeAccess.js` (`employeeProfileCommands.ts:116-121` says why, and that a test pins the mirror). Written by exactly two paths: the trusted command (`employeeProfileCommands.ts:218`, validated `:322-326`) and the operator script (`provisionEmployeeAccess.js:480`, `:563`, which stamps `EMPLOYMENT_STATUS_ACTIVE` on create). Read as `=== "ACTIVE"` at `functions/src/access/operationalRoleContext.ts:71`+`:123`, `adminCredentialCommands.ts:200`+`:267`+`:232`, `functions/src/truckRegistry/truckRegistryRepository.ts:199`, **and inside Rules** at `firestore.rules:118` and `:494`. **No `active` boolean exists** (`docs/CLAUDE_CONTEXT.md:236`) |
| **TECHNICIAN RELATION** | None stored, and the absence is governed: `employeePrincipalLink.ts:43-47` — "**THERE IS NO THIRD TERM**, and in particular no term for 'the `fieldops_technicians` id happens to equal the `employees` id'… a rule inferred from the 11 is provably wrong for the 2." `employeePrincipalLinkPlan.ts:109-111` keeps `technicianIdCoincides` as "**EVIDENCE**" that no code path reads back |
| **COMPATIBILITY IMPACT** | **Lowest of the six.** Client writes already `if false` (`firestore.rules:497`) so no Rules relaxation is implied; two trusted writers only; `employmentStatus` already read by five trusted modules and by Rules. **But** it fails closed on the production principal with no link (§3) and on the 2 technician orphans, and it holds **neither** `skills` nor dispatch `status` (`…p1b-census.md:807-810`) |
| **MIGRATION IMPACT** | **None required to consult it.** No schema, no migration, no backfill — the collection, the field, the enum and two trusted-side validators already exist (§5.3). `#182`: **NO BACKFILL AUTHORIZED**, and the existing propagation is the thing being protected against, not a repair (`OI-41`, `…DECOMPOSITION.md:1111`) |
| **WHY IT CAN / CANNOT SATISFY `OD-6` LAYER 1** | **CAN serve the existence question, and only from a trusted caller.** It is the one candidate with a shipped precedent for the exact check — `truckRegistryRepository.ts:196-199` does `snap.exists && snap.data()?.employmentStatus === "ACTIVE"` inside a transaction, over `employees`, with the comment "`employmentStatus` is the authoritative Employee lifecycle field"; and `employeeProfileCommands.ts:531-541` does existence-only for the manager pointer, with the comment "**Referential integrity** for the one relational field. A manager pointer to a document that does not exist is a broken link… so it is **refused at the write** rather than discovered at the read." **CANNOT satisfy it as it stands**, for three reasons none of which a lane may discharge: (1) the **purity barrier** — §5; (2) the **namespace** question `O-1` is open per reference — §6.2; (3) it is a **provably incomplete** person population — 15% of technicians and one production principal are outside it (§3), so "does not exist in `employees`" ≠ "is not a person" |
| **RECOMMENDATION** | **NOT MADE. See §8** — the evidence converges here for the *existence* half and does **not** reach the Owner-reserved residue |

### 4.2 OPTION 2 — Firestore `users`

| Field | Assessment |
|---|---|
| **AUTHORITY SOURCE** | Firestore collection `users`, doc id = **Firebase auth uid** (`firestore.rules:15`: `get(/…/users/$(request.auth.uid))`) |
| **WHAT RECORDS IT REPRESENTS** | **Application access, not a person.** `firestore.rules:425-426`: "**Role docs** are provisioned by an admin (console or Admin SDK), never by the client". `docs/BusinessEntityModel.md:45`: "User \| **Application-access identity**, linked to Employee where applicable". `docs/CLAUDE_CONTEXT.md:62`: "User (`users/{uid}`) is the **authoritative application-access identity**". And the refusal vocabulary says it outright — `employeePrincipalLink.ts:68-69`: "A `users/{uid}` document with no Employee behind it. **A login is not a person record.**" Measured: it "carries **no** surviving business fact" (`…p1b-census.md:811`) |
| **IDENTITY RELATION** | It **is** the principal side: doc id = uid = the `external_subject` half of a Postgres principal (`employeePrincipalLink.ts:6-8`, `functions/migrations/1757548800000_tenant-and-identity.sql:33-35`). Carries `role` (`admin`/`dispatcher`/`technician`, `functions/src/callerContext.ts:8`), `employeeId` (back-link, `employeePrincipalLinkPlan.ts:21`) and `technicianId` (`callerContext.ts:20`, `firestore.rules:323-327`). It is the **only** candidate readable from a Rules `get()` by uid without a prior lookup (`firestore.rules:14-16`) |
| **EMPLOYEE STATUS SOURCE** | **NONE. It holds no employment status field at all.** Every `employmentStatus` read at `64008d5a` targets `employees/{employeeId}` (the 15 sites in §4.1). The nearest thing on `users` is Firebase Auth enable/disable, which is **not on the document** and is explicitly a different axis: `employeeProfileCommands.ts:33-35`, and `SYSTEM_AUTHORITIES.md:121` — "EOS Access on this surface reports account **LINKAGE**, never enabled/disabled — that is Firebase Auth state with no governed read, and **deriving it from employment status would show a CONTRACTOR who holds access as switched off**" |
| **TECHNICIAN RELATION** | Holds `users/{uid}.technicianId`, a **one-way, unchecked** pointer into `fieldops_technicians`: `SYSTEM_AUTHORITIES.md:47` — "`users/{uid}.technicianId` → `fieldops_technicians/{id}`, populated **only** via `functions/scripts/assignTechnicianToUser.js` (Admin SDK, manual — PT-001)"; `…p1b-census.md:202-204` "**[ONE-WAY, no back-check]**". Populated on **1 of 62** user docs in nonprod (`…p1b-census.md:828`) |
| **COMPATIBILITY IMPACT** | **HIGH and adverse.** Person references at `64008d5a` are `employeeId`-shaped, not uid-shaped — `deriveAccountOwner` reads `assignedToEmployeeId` (`typedOwner.ts:101`), `deriveEmployeeRefOwner` defaults to `ownerEmployeeId` (`:114`), `ownershipBackfillRules.ts:35-36` documents its map as "the owner's **canonical Employee id**", and `creationOwnerResolution.ts:33` returns `ownerEmployeeId`. Choosing `users` makes **every existing person reference the wrong key space**, which is the identical defect already measured live on the truck join: `…p1b-census.md:827` "**Two key spaces, silently equated**", `:828` "**Live outcome: 0 of 13 technicians resolve to a truck**… no truck, no error, no ambiguity flag" |
| **MIGRATION IMPACT** | Would require translating or re-keying every stored person reference. **`#182` authorizes NO BACKFILL**, so this option is **unreachable without a further Owner authorization** that does not exist at `64008d5a` |
| **WHY IT CAN / CANNOT SATISFY `OD-6` LAYER 1** | **CANNOT.** `#182` Layer 1 asks that the referenced **Employee** exist in the **governed Employee authority**. `users` (a) is not the Employee authority by four independent statements above, (b) holds no employment status, and (c) is in a different id space from every stored person reference. It can answer "is this uid a known login", which is a different question. Its `employeeId` field is also demonstrably **not guaranteed populated** — `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` in production (`be1e5579:…census.md:120`) |
| **RECOMMENDATION** | **AGAINST, on evidence** — for the existence question. It remains **necessary** for principal linkage, which is Option 4 |

### 4.3 OPTION 3 — Firestore `fieldops_technicians`

| Field | Assessment |
|---|---|
| **AUTHORITY SOURCE** | Firestore collection `fieldops_technicians`, doc id = `technicianId`, its own private id space (`firestore.rules:397`; `field-ops-app-vite/src/domain/actorDisplayName.js:61` — "a `fieldops_technicians` doc id, **NOT a Firebase uid**") |
| **WHAT RECORDS IT REPRESENTS** | A **field-service dispatch resource record**, person-shaped but not a person authority. Fields, reconstructed (there is **no** type declaration, converter or validator anywhere — U-1, §7): `name`, `phone`, `status` ∈ `available\|on_job\|off_shift` (`firestore.rules:346-348`), `createdAt`/`updatedAt`; plus seed-only `userId`/`skills`. The only trusted-side type is deliberately partial: `functions/src/scheduling/schedulingRepository.ts:23-26` — `interface TechnicianRecord { id: string; status: string; }`. Governance: `docs/BusinessEntityModel.md:265` — "**a field-service resource record, not the enterprise Employee model**… this section does not propose renaming, merging, or migrating `fieldops_technicians` into `employees`" |
| **IDENTITY RELATION** | Reachable **only** through `users/{uid}.technicianId`, one-way and unchecked (§4.2). **No** stored link to `employees`. `employeePrincipalLink.ts:43-47` forbids inferring one from the id coincidence, and 11/13 coincide while 2 do not |
| **EMPLOYEE STATUS SOURCE** | **NONE.** `status` is **dispatch state**, not employment lifecycle — three values, one of which (`on_job`) is a work state and none of which express employment. Its enum and `employmentStatus`'s six values do not intersect. It is written as a **completion cascade side-effect** (`functions/src/completeAssignedJob.ts:316`; `field-ops-app-vite/src/domain/jobActions.js:107,121-123`). Treating it as the person-status source would mean a technician mid-job is "on_job", not "employed" |
| **TECHNICIAN RELATION** | It *is* the technician record — which is precisely why it cannot also be the person authority: `docs/PROJECT_ARCHITECTURE.md:90` calls it "**Job / Technician (legacy, still real and in active use)**", and the object model retired the family — `field-ops-app-vite/test/objectListMetadataAuthority.test.mjs:179`: "superseded in the object model by the Owner's 2026-08-20 ruling that **technician is a ROLE on Employee, not a family**. `employeeEntity` is the registered object" |
| **COMPATIBILITY IMPACT** | **DISQUALIFYING, and this is the decisive fact of §4.3.** It is the **only** candidate a browser can write. `firestore.rules:407-408` `allow create: if isAdminOrDispatcher() && request.resource.data.status == 'available'` — **no other field validated, no `hasOnly()` allowlist**; `:418-419` `allow update: if isAdminOrDispatcher() && isTechnicianStatus(...)` — likewise no diff allowlist, so an admin/dispatcher may rewrite `name`, `phone`, `userId`, `skills`, or add arbitrary fields. Exercised from the browser: `field-ops-app-vite/src/domain/jobActions.js:40-42` `createTechnician` → `collectionStore.js:88 safeAddDoc`, reached from `modules/technicians/Technicians.jsx:58`. `…p1b-census.md:246-248`: "**`fieldops_technicians` is the only reference entity with a live client write path**". **No Cloud Function creates one** — `completeAssignedJob.ts:300-308` reads and refuses when absent ("Your technician record is missing -- the technicianId mapping is inconsistent"), `:316` only updates |
| **MIGRATION IMPACT** | Choosing it would entrench a collection the repo has already dispositioned for retirement — `…p1b-census.md:524` "`fieldops_technicians` \| **D. RETIRE_DUPLICATE** (contingent on BA-7)", `:1044` "**RETIRE** — subject to OR-4 preserving `skills` / dispatch status onto Employee first"; `docs/DECISIONS.md:909` defers its permissions because "**designing permissions here would ENTRENCH the legacy domain model W4 intends to retire**" |
| **WHY IT CAN / CANNOT SATISFY `OD-6` LAYER 1** | **CANNOT, on four independent grounds.** (1) It is **not a governed authority**: a client can create a row, so "exists in the authority" would be a fact a browser can manufacture — the opposite of fail-closed. (2) It carries **no employment status**. (3) It is in a **third id space** from every stored person reference. (4) Trusted code at `64008d5a` already **forbids** it this role: `employeePrincipalLinkPlan.ts:24-25` — "`fieldops_technicians` — **TEMPORARY COMPATIBILITY. Never employee-identity authority**, never assignment authority, and never a link source here"; `employeePrincipalLink.ts:46-47` — "`fieldops_technicians` is temporary compatibility data and **must not remain employee-identity authority**"; `scripts/employeeTruckCrosswalk.lib.mjs:650` records the ruling "**R4:** … `fieldops_technicians` is compatibility data and **never** Employee or assignment authority" |
| **RECOMMENDATION** | **AGAINST, on evidence.** And see §4.3a — the matrix row is the finding |

#### 4.3a IS `fieldops_technicians` A PERSON RECORD AT ALL? — the direct answer

**It is person-*shaped* and is not a person *authority*, and `ownershipMatrix.ts:515` is wrong as an
authority statement.** Both halves matter:

| Claim | Verdict | Evidence |
|---|---|---|
| Is it a role/assignment record attached to another identity? | **NO** | It carries its own `name`/`phone` and its own id namespace; nothing else holds those. It is not an assignment row keyed to a subject |
| Is it therefore a person record? | **Person-shaped, yes — a dispatch resource record** | `docs/BusinessEntityModel.md:265` "a field-service resource record, not the enterprise Employee model" |
| Is it a person **authority**? | **NO, and trusted code says so in three files** | `employeePrincipalLinkPlan.ts:24-25`; `employeePrincipalLink.ts:46-47`; `scripts/employeeTruckCrosswalk.lib.mjs:25-26`, `:650` |
| Is `ownershipMatrix.ts:515` wrong? | **Under reading R-A: YES, flatly** — it labels as "person authority" a collection that three other trusted-side files forbid from being one, with no qualifier the two other rows carry ( `:513`/`:514` both end "a subject of ownership, not an object"; `:515` does not) | §1.1 |
| …under reading R-B? | **The row is a defensible *exclusion rationale* and a misleading *authority* string.** "Person authority" as shorthand for "this holds person facts, so it is a subject not an object" is true of the collection; read as "this is the authority", it is false | §1.1 |
| **The finding either way** | The two rows that say `"person authority"` are **not two competing answers to one question** — `:514` names the canonical authority and `:515` names a collection explicitly barred from being one. The matrix is **inconsistent with the rest of the trusted tree**, not merely ambiguous within itself | — |

**One thing this does NOT license.** `fieldops_technicians` holds facts nothing else holds — `skills`
on 0 of 60 employees, dispatch `status` with no `employees` equivalent (`…p1b-census.md:807-810`) —
and `employeePrincipalLink.ts:81-83` reserves a refusal term for exactly that
(`TECHNICIAN_ONLY_BUSINESS_FACT`: "Retiring the collection would destroy it; this names that, and
refuses"). **"Not the person authority" is not "retirable", and this document authorizes no
retirement.**

### 4.4 OPTION 4 — COMPOSITE: `employees` for existence + status, `users` for principal linkage

| Field | Assessment |
|---|---|
| **AUTHORITY SOURCE** | Both Firestore collections, with the roles split. **This is not a hypothetical: the code already implies it, in two shipped shapes** |
| **WHAT RECORDS IT REPRESENTS** | `employees` = the person and their employment; `users` = the login that may act as that person. The split is the governed model verbatim — `docs/CLAUDE_CONTEXT.md:62`: "Employee (`employees/{employeeId}`) is the authoritative workforce identity; User (`users/{uid}`) is the authoritative application-access identity; Firebase Authentication is the credential authority only — **the three are never merged into one entity**" |
| **IDENTITY RELATION** | The **reciprocal** two-way link is already the only accepted derivation: `employeePrincipalLink.ts:36-39`. Its sole writer enforces both directions inside a transaction — `provisionEmployeeAccess.js:3-4` "**the only writer** of `employees/{employeeId}.userId` and `users/{uid}.employeeId`"; `:608-610` states the guard ("re-validates the reciprocal link (`employee.userId === plan.userId` AND `user.employeeId === plan.employeeId`) still holds, and only then writes both documents"), implemented as four aborts at `:616-646` before the paired write at `:648-649`. `employeeProfileCommands.ts:29-32` refuses one-sided writes for exactly this reason |
| **EMPLOYEE STATUS SOURCE** | `employees.employmentStatus` (as §4.1). `users` contributes **no** status — by design (§4.2) |
| **TECHNICIAN RELATION** | `users.technicianId` remains the only technician pointer, one-way and unchecked; the composite does **not** repair it. The already-identified deterministic fix for the live truck defect is the composite's own shape: `…p1b-census.md:835` "**Deterministic fix:** key the read the way the write keys — resolve `uid → users/{uid}.employeeId`" |
| **COMPATIBILITY IMPACT** | **Lowest, because it is already what the shipped trusted-side code does.** Three examples at `64008d5a`: `functions/src/access/adminCredentialCallables.ts:89` reads `users/{targetUid}` then `:104` reads `employees/{employeeId}`, and `adminCredentialCommands.ts:274-276` states the contract — "`employmentStatus` is trusted **ONLY** when the link is [reciprocal]… otherwise it is null (deny)"; `operationalRoleContext.ts:164` feeds `employeeEmploymentStatus` from the linked employee; and **Rules already do it** — `firestore.rules:112-121` `isActiveOperationalRole()` resolves `linkedEmployeeId()` then `get(employees/$(employeeId))` and requires `employee.userId == request.auth.uid && employee.employmentStatus == "ACTIVE"` |
| **MIGRATION IMPACT** | **None.** Both collections, both fields, the reciprocity rule, its single writer and its refusal vocabulary all exist |
| **WHY IT CAN / CANNOT SATISFY `OD-6` LAYER 1** | **This is the only option whose existence half AND actor half are both already governed.** But it **inherits every one of Option 1's three blockers unchanged** (purity, namespace `O-1`, incomplete population) and **adds a fourth**: it makes Layer 1 depend on a linkage that is **provably not always populated** — `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` in production (`be1e5579:…census.md:120`), and `employeePrincipalLink.ts:67` / `:69` / `:71` reserve three separate refusal terms for the unpopulated and one-way cases. **Whether a person reference must resolve a *principal* at all, or only an Employee, is not something `#182` as quoted settles** → MISSING INPUT **MI-γ** |
| **RECOMMENDATION** | **NOT MADE.** It is the option the existing code already implies; saying so is a finding, not a choice |

### 4.5 OPTION 5 — PostgreSQL `eos_policy.principals`

| Field | Assessment |
|---|---|
| **AUTHORITY SOURCE** | `eos_policy.principals`, `functions/migrations/1757548800000_tenant-and-identity.sql:79-92`: `id TEXT PRIMARY KEY`, `external_subject`, `identity_provider`, `display_name`, `status principal_status DEFAULT 'active'`, `created_at`, `updated_at`, `UNIQUE (identity_provider, external_subject)` |
| **WHAT RECORDS IT REPRESENTS** | **Security identity, not a person.** `employeePrincipalLink.ts:5-6`: "The security identity is `eos_policy.principals`". `…1757548800000:33-35`: "`principals.id` is the **EOS-native identifier**, and `(identity_provider, external_subject)` is the **MAPPING** to whatever proved the identity" |
| **IDENTITY RELATION** | Keyed by `(identity_provider, external_subject)` where `external_subject` is the Firebase uid; resolved at `functions/src/adminPolicy/postgresPolicyRepository.ts:376` (`SELECT * FROM …principals WHERE identity_provider = $1 AND external_subject = $2`). RoleAssignments hang off an **opaque principal id**, not a uid and not an `employeeId`: `…1757635200000_assignment-integrity.sql:57` renames `principal_uid → principal_id` because "`principal_uid` said 'a Firebase UID' and the value has been an EOS principal id since migration 002" (`:34-35`); FK at `:66-69`. **It carries no `employee_id` column at all** |
| **EMPLOYEE STATUS SOURCE** | **NONE.** `principals.status` is a `principal_status` (security/access state), not employment. `eos_policy.employee_principal_links` deliberately excludes employment too — `…1758412800000:107-111`: "No `external_subject`, no `identity_provider`, no `display_name`, **no `employment_status`**, no `technician_id`, no `skills`… The link table says WHICH TWO THINGS ARE THE SAME PERSON, **and nothing else about either of them**" |
| **TECHNICIAN RELATION** | None; explicitly excluded (`…1758412800000:107-111`, above) |
| **COMPATIBILITY IMPACT** | Person references at `64008d5a` are `employeeId`-shaped; principal ids are a **fourth** id space (`…p1b-census.md:62`: "four disjoint id spaces"). Same key-space defect class as Option 2, one namespace further out |
| **MIGRATION IMPACT** | Would require an `employeeId`→principal resolution on every person reference. No authorization exists; `#182` authorizes **NO BACKFILL** |
| **WHY IT CAN / CANNOT SATISFY `OD-6` LAYER 1** | **CANNOT — it answers a different question, and it is not reachable from the resolver's runtime anyway.** (1) It can prove a *principal* exists and is an active tenant member; it **cannot** prove an *Employee* exists, because there is no Employee row. (2) **Firebase Cloud Functions has no Postgres path at `64008d5a`**: the only `pg`-importing modules are `functions/src/adminPolicy/policyDatabase.ts:28` and `inboundWork/providerCredentialVault.ts`, and neither is reachable from `functions/src/index.ts` (grep `adminPolicy\|eosApi\|Pool` over it → **zero hits**); the Postgres consumer is a **separate Render HTTP service** (`functions/src/eosApi/server.ts:25,31-34,138`, started by `functions/scripts/serveEosApi.mjs:12-14`). No Cloud SQL connector exists anywhere. So a Firestore-side Layer 1 would have to cross a **network service boundary** |
| **RECOMMENDATION** | **AGAINST as the person authority.** It is the principal authority and already governs RoleAssignment (`SYSTEM_AUTHORITIES.md:54`), which is a different axis |

### 4.6 OPTION 6 — PostgreSQL `eos_policy.employee_principal_links` *(added by this lane)*

| Field | Assessment |
|---|---|
| **AUTHORITY SOURCE** | `eos_policy.employee_principal_links`, `functions/migrations/1758412800000_employee-principal-linkage.sql:115-163`: `id`, `tenant_id`, `principal_id`, **`employee_id TEXT NOT NULL`**, `operating_company_id`, `link_source`, `status`, `asserted_by`, `assertion_reason`, timestamps |
| **WHAT RECORDS IT REPRESENTS** | **A link, not a person.** `…1758412800000:107-111` (quoted §4.5). This is the **only artifact in the repository carrying an `employee_id` column**, which is why it is a candidate at all and why it must not be conflated with `principals` |
| **IDENTITY RELATION** | It is the mapping itself: `(principal_id, employee_id)` under a closed `link_source` vocabulary — `RECIPROCAL_FIREBASE_UID_LINK` or `OPERATOR_ASSERTED`, enforced both in SQL (`employee_principal_links_source_known` CHECK, `employeePrincipalLink.ts:33-34`) and in TS (`LINK_SOURCES`, `:49`). `employee_id` is **opaque with no FK**: `…1758412800000:119-120` "The canonical business Employee id. **Opaque here; see the header for why there is no FK yet**" |
| **EMPLOYEE STATUS SOURCE** | **NONE, by explicit design** (`…1758412800000:107-111`) |
| **TECHNICIAN RELATION** | None; `technician_id` explicitly excluded (same lines) |
| **COMPATIBILITY IMPACT** | Would introduce a cross-datastore dependency into a Firestore-side resolution path. And the module that reads it is **unreachable**: `functions/src/employeeIdentity/employeePrincipalLinkRepository.ts` exists, but **no `functions/src` module imports `employeeIdentity`** (only two CI workflow lines reference it) |
| **MIGRATION IMPACT** | The table is DDL at `64008d5a`. **Whether migration 008 is applied in any live environment is UNPROVEN** — the activation record documents the live nonprod DB at `migrations: 3` (`docs/architecture/eos-real-nonprod-activation.md:39`, health probe `:242` `"migrations":3`), i.e. 001–003 only. **Whether any row exists in it anywhere is UNPROVEN** |
| **WHY IT CAN / CANNOT SATISFY `OD-6` LAYER 1** | **CANNOT.** It can state *that* an Employee id was linked to a principal; it **cannot** state that the Employee **exists**, because `employee_id` is opaque with no referent — the row's existence is a *prior assertion*, not the authority's own statement. Layer 1 as quoted requires "**exists in the governed Employee authority**"; this table is by its own header not that authority. Plus the reachability and applied-migration problems above |
| **RECOMMENDATION** | **AGAINST as the person authority.** It is the correct **future FK holder** — §4.7 |

### 4.7 DOES THE PERSON AUTHORITY LIVE IN POSTGRESQL — OR EVENTUALLY? *(the brief's easy-to-miss item)*

**Today: NO, and the DDL says so in the imperative.** Eventually: **anticipated, not decided, and
explicitly reserved to the Owner.**

| Question | Answer | Evidence |
|---|---|---|
| Is there an `employees` table in PostgreSQL? | **NO** | `functions/migrations/1758412800000_employee-principal-linkage.sql:46-49`: "**THERE IS NO `employees` TABLE IN POSTGRESQL YET.** The canonical Employee record still lives in Firestore's `employees` collection, and this migration **does not invent a Postgres copy of it**: a second Employee master here would be the 'unmaintained copy of reference data whose original stays authoritative elsewhere'" |
| Is Postgres the canonical RoleAssignment authority? | **YES — for RoleAssignment, which is a different axis** | `docs/architecture/SYSTEM_AUTHORITIES.md:54`: "`functions/migrations/` is the single schema authority… **`principalContext.ts` is the sole answer to who/which tenant/which Roles**, read only from PostgreSQL — never a custom claim, `users/{uid}.role`, `employees.securityRole`"; "**Referential integrity is at the DATABASE (migration 003)**" |
| Is a future `employees` table anticipated? | **YES, as a named follow-up — not scheduled** | `…1758412800000:54-57`: "When an `employees` table **does arrive**, this column is already the right name, the right type and the right cardinality to take a foreign key with no restructuring — the constraint is the only thing that has to be added, and **that is a follow-up this header names**" |
| Has anyone decided whether Employee moves? | **NO — it is already an open Owner ruling** | `docs/architecture/inventory-reference-authority-p1b-census.md:62` classifies Employee **`DUPLICATE_AUTHORITY`** over "`employees` + `users` + `fieldops_technicians` + `eos_policy.principals` \| **four disjoint id spaces**", disposition **`E` owner ruling**, item **`BA-7`**; `:255` "**Disposition:** Employee **E. NEEDS_OWNER_RULING**"; `:530-533` "**No** reference entity is recommended for **A. MIGRATE_TO_POSTGRES_AUTHORITY** in this tranche… the six under owner ruling **must not be copied until their authority is settled**" |
| Firebase-exit stance? | **Identity migration explicitly not decided** | `docs/architecture/firebase-exit-manifest.json:14`: "eventual identity/auth migration is a separate future Firebase-exit concern, **not decided here**"; `:10` permits Firebase "only for sign-in identity and Firebase UID correlation to an EOS Principal/Employee" |
| Does the cutover design migrate identity? | **NO** | `docs/design/eos-operational-data-plane-inventory-authority-cutover.md:187`: "Technician identity / truck link \| Firestore `employees` + truck assignment \| AUTHORITATIVE REFERENCE \| **Not migrated**" |
| Has `eos_policy` ever been evaluated against live data? | **NOT_EVALUATED** | `…p1b-census.md:619-621`: "**`eos_policy` / PostgreSQL: NOT_EVALUATED** — no `DATABASE_URL`, no ADC for the Render database… Migration files were read as SQL text; **whether the schemas are applied anywhere is unknown**" |

**The consequence for `MI-X`, stated plainly:** choosing a Firestore collection today and choosing
where the Employee authority *lives* long-term are **two decisions, and `BA-7` is already the second
one**. Answering `MI-X` as "`employees`, in Firestore" is **compatible** with a later move to
PostgreSQL precisely because migration 008 pre-shaped `employee_id` to take the FK — but a Layer 1
implementation that hard-codes a Firestore read is a **second cutover cost** the Owner should price
now, not discover later. **This lane does not price it.**

### 4.8 Candidate 7 — Firebase Authentication *(considered, disqualified)*

Recorded per `ownershipMatrix.ts:509-510`'s own principle. Disqualified by `docs/CLAUDE_CONTEXT.md:62`
("credential authority **only**"), and it holds no employment fact: `provisionEmployeeAccess.js:68`
notes the `--email` "is **NEVER** written to `employees/{employeeId}`", and `docs/CLAUDE_CONTEXT.md:236`
confirms `employees` has "**No `email` field**".

---

## 5. THE PURITY / I-O CONSTRAINT — it binds every option identically

### 5.1 The ownership module is pure **throughout**, not only at `typedOwner.ts`

The brief's item 5 understates this. It is not that `typedOwner.ts` is pure and imports one pure
module; **every module in `functions/src/ownership/` is pure, and each says so in its own header.**

| Module | Imports (verified, `grep -n '^import'` at `64008d5a`) | Purity statement |
|---|---|---|
| `typedOwner.ts` | `:10` only — `./operatingCompanyAuthority.js` | `:7` "INERT, DERIVED, READ-NORMALIZED. No setter, no writer, no persistence" |
| `operatingCompanyAuthority.ts` | **none** | `:6` "PURE: no firebase-admin / firebase-functions import" |
| `ownershipCensus.ts` | `:16-26` — `./typedOwner`, `./ownershipMatrix`, `./operatingCompanyAuthority` | `:9-10` "READ-ONLY BY CONSTRUCTION: nothing in this module can write. It takes documents and returns counts" |
| `creationOwnerResolution.ts` | `:28` only — `./typedOwner` | `:25-26` "PURE: no Firestore, no I/O. **The caller reads the upstream document**… and hands the derivation in" |
| `ownershipBackfillRules.ts` | **none** | `:27` "PURE: no Firestore, no I/O, no clock. **The caller reads documents and applies patches**" |
| `ownershipHandoffCommand.ts` | `:32-34` — `./typedOwner`, `./ownershipMatrix`, + local | `:12-13` "It STAGES an audit event onto a **caller-supplied** transaction or batch… it does not commit" |

### 5.2 Therefore, said plainly as the brief requires

**A pure resolver cannot read a person authority. No candidate in §4 is readable without I/O — not
one.** All six require either a Firestore `get()` (Options 1–4) or a network call to a separate
service (Options 5–6). **This is a structural constraint on every option and it does not discriminate
between them.** Consequently `OD-6` Layer 1 **cannot be located inside `functions/src/ownership/`
at all** as that directory is currently constituted. It must sit in a **trusted caller** that reads
and hands the facts in — which is the pattern `creationOwnerResolution.ts:25-26` and
`ownershipBackfillRules.ts:27` already prescribe for their own inputs.

This is also the point where `#182` Layer 1 **collides with a standing ruling**, and the collision is
recorded in the code itself. `typedOwner.ts:44-48`:

> "Person-owned families produce INVALID only. Producing UNKNOWN for an employee id would require a
> cross-collection existence lookup, **which Owner ruling `O-1` explicitly excluded** from ownership
> resolution ('would introduce a fallible cross-collection lookup into otherwise deterministic
> ownership resolution'). So a USER family's UNKNOWN count is **structurally zero**, not merely empty."

**Both readings carried:** (i) `#182` Layer 1 **supersedes** `O-1`'s exclusion, in which case the
supersession must be stated in the ruling rather than inferred by a lane; (ii) `O-1` still stands and
Layer 1 must live **outside** the deterministic resolver, in the caller, leaving `O-1`'s "otherwise
deterministic" property intact. **Reading (ii) is consistent with both shipped precedents (§5.3) and
with every purity header above.** `…DECOMPOSITION.md:176` (`HEAD`) reaches the same fork: "Any
contract here **revisits ruling `O-1` and must say so out loud**."

### 5.3 Two trusted-side precedents already do exactly this check — both against `employees`

| Precedent | What it does | Evidence |
|---|---|---|
| Truck driver eligibility | `snap.exists && snap.data()?.employmentStatus === "ACTIVE"` on `employees/{employeeId}`, inside a transaction | `functions/src/truckRegistry/truckRegistryRepository.ts:196-200`, with `:197` "`employmentStatus` is the authoritative Employee lifecycle field" |
| Employee manager pointer | `txn.get(employees/{managerId})`; `if (!managerSnap.exists) throw UnknownManagerError("the selected manager is not an existing employee")` | `functions/src/access/employeeProfileCommands.ts:534-541`, with `:531-533` "**Referential integrity** for the one relational field… **refused at the write** rather than discovered at the read" |

**This is the strongest single piece of evidence in this document.** `OD-6` Layer 1's *mechanism* is
not novel — it is shipped twice, trusted-side, transactional, against `employees`, with one instance
checking existence-only and the other existence-plus-`ACTIVE`.

### 5.4 …and Rules do it too, which is unique to the Firestore options

`firestore.rules:112-121` `isActiveOperationalRole(role)` performs
`get(/…/employees/$(employeeId)).data` and requires `employee.userId == request.auth.uid &&
employee.employmentStatus == "ACTIVE"`; `:491-496` does the same per-document for the PARTS_MANAGER
read. **No Postgres candidate can ever be read from Rules.** If any part of Layer 1 must be
enforceable at the Rules boundary, Options 5 and 6 are excluded on that ground alone. **Whether it
must is not stated in `#182` as quoted** → MISSING INPUT **MI-δ**.

---

## 6. THE SIX TOUCH POINTS, AND WHAT EACH WOULD HAVE TO READ

### 6.1 The four shape-only paths plus the fifth, writing one — plus a sixth the brief omits

| # | Touch point | What it reads today | Verdict at `64008d5a` | Which authority would it have to read |
|---|---|---|---|---|
| 1 | `deriveAccountOwner` `typedOwner.ts:95-109` | `accountDoc.accountOwner.assignedToEmployeeId`; `nonEmptyString` at `:102`; `RESOLVED` at `:108` | shape-only | an **`employeeId`-keyed** authority → Option 1 or 4. **Cannot read it in place** (§5.2) |
| 2 | `deriveEmployeeRefOwner` `typedOwner.ts:112-125` | `doc[field]`, default `"ownerEmployeeId"` (`:114`); `nonEmptyString` `:118`; `RESOLVED` `:124` | shape-only | same |
| 3 | `deriveStoredOwner` `typedOwner.ts:196-210` | `isTypedOwner(value)` `:202`; the governance re-check at **`:206` is guarded on `value.type === OWNER_TYPES.COMPANY`** — brief confirmed exactly — so a `USER` owner returns `RESOLVED` at `:209` unexamined | shape-only for USER; existence-checked for COMPANY | same. Note `:205`'s own comment, "storage does not confer governance", is the argument for the USER arm too and is not applied to it |
| 4 | `isTypedOwner` `typedOwner.ts:62` (USER arm **`:67`**) | `nonEmptyString(v.id)` for USER; `isOperatingCompanyIdShape(v.id)` for COMPANY `:68` | **the asymmetry in one line** | same. This is the primitive the other three sit on, so it is the narrowest place the namespace question (§6.2) surfaces |
| 5 | `ownershipBackfillRules.ts:70-78` `personFromAccount` — **the writing one** | `:71` `ALREADY_SET` if `owner` present; `:74` `ctx.accountOwnerByAccountId.get(accountId)`; `:77` **writes** `{ owner: { type: "USER", id: employeeId } }` | **writes an unvalidated person id onto every child** | same — **and the map it trusts never touches a person authority**: it is built solely from `accounts` documents' `accountOwner.assignedToEmployeeId` (`functions/scripts/ownershipBackfillSimulation.js:81-85`; `ownershipSandboxBackfill.js:88-92`). `ownershipBackfillRules.ts:35-36` calls it "the owner's **canonical Employee id**" — a claim nothing verifies |
| **6** | **`creationOwnerResolution.ts:58-81` — OMITTED BY THE BRIEF** | `:63-64` EXPLICIT branch: `nonEmpty` **only**. `:67-74` INHERITED branch: admits an upstream owner iff `resolution === RESOLVED && owner.type === USER` — and #1/#2 return `RESOLVED` for any non-empty string | **the third shape-only *write-side* gate**, and the one `#182`'s "The word VALID is load-bearing" lands on | same. Registered as `V-13` (`…DECOMPOSITION.md:720`, `HEAD`). Reached from `opportunityCommands.ts:159` and `salesOrderCommands.ts:261` — and **not** from `salesAgreementCommands.ts`, which requires an explicit owner at `:280` with `nonEmpty` only and has no inheritance branch (`V-14`, `…DECOMPOSITION.md:721`) |

**Uniform answer:** all six read an **`employeeId`-shaped** value. **No touch point at `64008d5a`
reads a uid-shaped or technicianId-shaped or principal-id-shaped person reference.** That is an
evidential fact about the existing surface, and it is the single strongest structural argument for an
`employeeId`-keyed authority — while being **no proof at all** that those values are drawn from the
`employees` doc-id namespace, which is §6.2.

### 6.2 The namespace question is separate, and it is open

| Fact | Evidence |
|---|---|
| The `USER` namespace = canonical Employee id is **an open item, not a settled fact** | `typedOwner.ts:4-5`: "why the `USER` id namespace **is** the canonical Employee id (**open item O-1**)" |
| `employeeId` shape is constrained but **membership is not** | `employeePrincipalLink.ts:102-106` `isEmployeeIdShape`: non-empty, trimmed, contains no `"/"`. Shape only |
| Body/doc-id agreement is **unenforced** | `…p1b-census.md:250-251`: "Employee id **not stable enough** — body/doc-id agreement is unenforced (`field-ops-app-vite/src/metadata/definitions/employee.js:30-37`) and consumers hold a `technicianId` from a different namespace" |
| `#182` requires this be answered **per reference** | `…DECOMPOSITION.md:897`, `:1053` (`HEAD`): `OI-08` "**WIDENED**… must be answered **independently for each reference**, since `#182` [forbids] substitut[ing] one's validity for another's" |

**So even under Option 1 or 4, Layer 1 cannot be built by naming a collection.** Each of the six
touch points needs its own answer to "is this value in that collection's key namespace", and `O-1`
is open. `C-B2` (`…DECOMPOSITION.md:217-222`, `HEAD`) already specifies the mechanism — a distinct
"cannot ask" outcome, never a lookup miss — precisely so a namespace mismatch does not "manufacture
orphans at exactly the scale of the mismatch".

### 6.3 `employmentStatus`: existence, eligibility, or neither — the brief's item 2, answered

| Question | Answer | Evidence |
|---|---|---|
| Is `employmentStatus` the source for **EXISTENCE**? | **NO.** Existence is `snap.exists`; `employmentStatus` is a field on an existing document and cannot speak to absence | `truckRegistryRepository.ts:199` conjoins them: `snap.exists && … === "ACTIVE"`. `employeeProfileCommands.ts:514` and `:538-541` use `exists` **alone** for existence |
| Is it the source for **ELIGIBILITY**? | **YES — it is the only shipped one**, and it is fail-closed on non-`ACTIVE` | `operationalRoleContext.ts:51`: "`employees/{employeeId}.employmentStatus !== \"ACTIVE\"` -> false (**any other status, including** [absent])"; `:123`. `adminCredentialCommands.ts:183` "non-ACTIVE governed `employmentStatus` (ON_LEAVE / INACTIVE / TERMINATED /…)", enforced `:200`, `:267`. `docs/CLAUDE_CONTEXT.md:236`: "Phase 3 assignment eligibility is `employmentStatus == \"ACTIVE\"` **only**" |
| Is it trusted unconditionally? | **NO.** Trusted **only** through a reciprocal link | `adminCredentialCommands.ts:274-276`: "`employmentStatus` is trusted **ONLY** when the [link is reciprocal]… otherwise it is null (**deny**). A non-string `employmentStatus` is treated as **malformed (null)**" |
| So the two are **separate axes** | Confirmed, and Layer 1 as quoted asks only the **existence** one | `#182` Layer 1 (as quoted in the brief): "**exists** in the governed Employee authority" |
| Does that settle `MI-J`? | **NO, and nothing here should be read as settling it.** `MI-J` asks which employee fact is authoritative for "this person can no longer act"; `employmentStatus` is the only **candidate** at `64008d5a`, and the repo itself warns against conflating it with account state | `SYSTEM_AUTHORITIES.md:121`: "**deriving it from employment status would show a CONTRACTOR who holds access as switched off**"; `employeeProfileCommands.ts:37-40`: "they are **independent facts**… Terminating employment through this command **switches nobody off**" |

**A ranking consequence worth stating:** because existence and eligibility are separate axes, and
because Layer 1 as quoted asks only for existence, **`MI-X` is answerable without `MI-J`** — but a
Layer 1 built on `employees` will sit one field away from the eligibility question, and `#182`'s
own state table (`C-B3`, `…DECOMPOSITION.md:234-241`, `HEAD`) needs both. Sequencing the two is the
Owner's.

---

## 7. WOULD THE CHOSEN AUTHORITY ALSO SERVE THE TWO UNVALIDATED PERSON FACTS?

The brief's citations are **exact**, and there is a second set of line numbers worth having:

| Fact | Written at | Declared at | Validated by |
|---|---|---|---|
| `creditedSalespersonId` | `functions/src/opportunity/opportunityCommands.ts:178`; `functions/src/salesAgreement/salesAgreementCommands.ts:307-308`; `functions/src/salesOrder/salesOrderCommands.ts:291` — all via `resolveCreditedSalesperson(...)` | `financialAttribution.ts:163`, built `:228` | **`person()` at `financialAttribution.ts:205-209` — `nonEmpty` only** |
| `responsibleEmployeeId` | `financialAttribution.ts:229` | `:164`, input `:176` | same `person()` helper |

`financialAttribution.ts:205-209` verbatim:

```
205|  const person = (v: unknown, label: string): string | null => {
206|    if (v === undefined || v === null) return null;
207|    if (!nonEmpty(v)) throw new AttributionError("PERSON_INVALID", `${label} must be a non-empty id or absent`);
208|    return v.trim();
209|  };
```

| Question | Answer |
|---|---|
| Are these the same key space as the six touch points? | **YES.** `resolveCreditedSalesperson(explicit, inherited, commercialOwnerEmployeeId)` (`financialAttribution.ts:321-330`) **falls through to `ownerEmployeeId`** at `:328`. So an uncredited record's `creditedSalespersonId` **is** the `ownerEmployeeId`, byte for byte |
| Would an `employeeId`-keyed authority serve them? | **YES, mechanically** — same key space, and the consumers already assume it: `financialVisibility.ts:16` "records credited to me (`attribution.creditedSalespersonId == my employeeId`)"; `:179` compares it to `g.employeeId`; `permissionCatalog.ts:332` "`attribution.creditedSalespersonId == the principal's linked employeeId`" |
| So no second regime? | **Not mechanically. But there would be a second regime in every other respect, and it must be said.** `#182` as quoted names `typedOwner`'s shape-only USER resolution, **not** `financialAttribution`. Extending Layer 1 there is an **extension by analogy, not by ruling** |
| Is the asymmetry inside that one function? | **Yes, and it is stark.** In the **same function**, `company()` at `:212-224` **throws** `COMPANY_REQUIRED` on absence with "it is **never inferred, defaulted, or left to fill in later**", while `person()` at `:206` returns `null` for absence and never checks existence for a present value |
| Does the register already know? | **Yes** — `OI-38` (`…DECOMPOSITION.md:1108`, `HEAD`) records the gap, notes "**Zero** occurrences of either field in `ownershipMatrix.ts` or `ownershipCensus.ts`", and marks it **MISSING INPUT `MI-V`** — Owner only. `MI-V` at `:1182` is that question |
| **If the Owner declines to extend** | **Then the choice DOES create a second validation regime**, and it will be invisible: the frozen attribution snapshot (`financialAttribution.ts:225` `Object.freeze`) is **history** (`:184` "history, not state"), so an unvalidated person id written today is **never** revisited. A validated ownership axis beside an unvalidated attribution axis, over the **same ids**, is exactly the divergence `#182` Layer 1 exists to prevent — reached through a different door |

---

## 8. VERDICT ON RECOMMENDATION

### 8.1 What the evidence **does** support — stated as findings, not as a choice

| # | Finding | Strength |
|---|---|---|
| **F-1** | **`fieldops_technicians` is disqualified on evidence**, four independent ways (§4.3), and `ownershipMatrix.ts:515` is inconsistent with three other trusted-side files. This is not a close call and needs no Owner input to observe | **Established** |
| **F-2** | **`users` is disqualified as the existence authority** on evidence: it is application-access identity by four statements, holds no employment status, and is in the wrong key space for all six touch points | **Established** |
| **F-3** | **Neither Postgres candidate can serve it today**: no `employees` table (`…1758412800000:46-47`), no Cloud Functions→Postgres path, migration 008's live application UNPROVEN | **Established** |
| **F-4** | **The repository already names `employees`, in five places outside the matrix**, and **already implements the Layer-1 check against it, twice, trusted-side** (§5.3) plus twice in Rules (§5.4). Under §1.1 reading R-B the matrix never purported to answer the question, so the "ambiguity" is between the matrix's rationale strings and nothing at all | **Established** |
| **F-5** | **The operative choice already visible in the code is the COMPOSITE (Option 4)** — `employees` for existence and status, `users` for principal linkage — and it is what `adminCredentialCallables.ts:89`+`:104`, `adminCredentialCommands.ts:274-276`, `operationalRoleContext.ts:164` and `firestore.rules:112-121` all do | **Established as a description of existing code** |

### 8.2 What the evidence does **NOT** support, and why `RECOMMENDATION: NONE`

**`OD-6` Layer 1 cannot be satisfied by any candidate as the system stands.** Not because no
collection is nameable, but because naming one discharges **one** of four blockers. This is the
legitimate result the brief anticipated, and it is stated as such:

| Blocker | Why a lane cannot discharge it |
|---|---|
| **1. Location** | A pure resolver cannot read any authority (§5.1–5.2). Relocating Layer 1 to a trusted caller either **revisits `O-1`** or **relies on `O-1` standing** — two readings with opposite design consequences (§5.2). `#182` as quoted does not say which, and `…DECOMPOSITION.md:176` demands it be said "out loud" |
| **2. Namespace** | `O-1` is open (`typedOwner.ts:4-5`), body/doc-id agreement is unenforced (`…p1b-census.md:250-251`), and `OI-08` requires an answer **per reference**. A collection name does not supply six namespace answers |
| **3. Population completeness** | `employees` is **provably not the complete person population**: 15% of technicians are unrepresented, `tech-sbx-02` "exists in no other collection" (`…p1b-census.md:798-800`), and one **production** principal that can act has no employee link (`be1e5579:…census.md:120`). Whether Layer 1 fails closed on those — declaring real actors non-existent — is a **product** decision, not an engineering one |
| **4. Scope** | Whether Layer 1 also governs `creditedSalespersonId` / `responsibleEmployeeId` is **`MI-V`, Owner-only** (§7). Answering `MI-X` without it produces one validated axis and one unvalidated axis over the same ids |

**Therefore: `RECOMMENDATION: NONE.`** The Owner's instruction — *"Do not silently decide
architecture merely because one source is easier to query"* — is exactly the failure mode available
here: `employees` **is** the easiest to query (§5.3–5.4 prove the query is already written four
times), and that convenience is **not** an answer to blockers 1–4. F-1 through F-5 are offered as
the evidence the Owner should decide **on**, not as the decision.

---

## 9. UNPROVEN

| # | Item | Why |
|---|---|---|
| **U-1** | Whether `#182`/`OD-6`'s text says anything about Layer 1's **location** relative to the pure resolver, or about `O-1`'s supersession | `#182` is on `int/a-correctness-register`; this branch ends at `#179`. Only the brief's quotation was available |
| **U-2** | Whether migrations **004–016** (incl. 008, `employee_principal_links`) are applied in **any** live environment | The only activation record shows `migrations: 3` (`docs/architecture/eos-real-nonprod-activation.md:39`, `:242`). No doc records more |
| **U-3** | Whether any row exists in `eos_policy.employee_principal_links` anywhere | No environment was contacted (no production contact, per lane contract) |
| **U-4** | Whether `fieldops_technicians` has **any schema artifact** | None exists: no zod schema, no converter, no `metadata/definitions/technician.js`, no TS interface beyond `{id, status}` (`schedulingRepository.ts:23-26`). Its field list is reconstructed from writers, docs and fixtures |
| **U-5** | Live `fieldops_technicians` count | `docs/assessments/fieldops-jobs-disposition.md:28` says **8**; `…p1b-census.md:658`, `:795` say **13**. Different snapshots, not reconciled |
| **U-6** | Whether the client `createTechnician` path is reachable in shipped nav | `docs/north-star/lists/LISTS-P2-COLLECTION-DISPOSITION.md:232` calls `Technicians.jsx` "**Unrouted dead code**"; no route table was traced. **The Rules grant at `:407` is open regardless**, which is what §4.3 turns on |
| **U-7** | Whether `employees` holds a **tombstone**, i.e. whether DELETED is distinguishable from NON-EXISTENT | No `employees` document was read (no Firestore contact). Already registered as `U-10`, `…DECOMPOSITION.md:638` (`HEAD`) |
| **U-8** | Whether `employeeId` or `userId` appear on any **production** `fieldops_technicians` document | Written only by seeds (`seedSandboxTransactional.js:193`) and the cert-world fixture (`workforceLoad.mjs:121`); `…p1b-census.md:963` "The sandbox is ~100% synthetic" |
| **U-9** | Whether the 6 production `employees` (`be1e5579`) exhibit the same 60/60 `userId` bijection nonprod shows | The production census measured role exposure, not linkage completeness, and reported one un-linked principal |
| **NOT_RUN** | **No test, typecheck, build, lint or emulator was executed by this lane.** No emulator (no `java`, port 8080 held); no `functions/node_modules` was borrowed; `functions/lib` was never consulted for any claim. This is a documentation-only artifact and ran no code |

---

## 10. MISSING INPUT — Owner only

| Ref | Question |
|---|---|
| **MI-α** | **The label.** `MI-X` already denotes `MI-P`'s architecture choice (`…DECOMPOSITION.md:1184`). This question is registered as `OI-39` / `V-15` / `X-13` / `BA-7`. Which label governs, and is a new MI letter to be issued? Naming a missing-input item is the Owner's |
| **MI-β** | **`O-1`.** Does `#182` Layer 1 **supersede** `O-1`'s exclusion of cross-collection existence lookup from ownership resolution (`typedOwner.ts:44-48`), or does `O-1` stand with Layer 1 relocated to the trusted caller? Both readings are carried (§5.2) and they differ in what gets built |
| **MI-γ** | **Existence of what.** Must a person reference resolve an **Employee only**, or an Employee **and** a linked principal? The composite (Option 4) is what shipped code does, and it makes Layer 1 depend on a linkage that is **not always populated** in production (`be1e5579:…census.md:120`) |
| **MI-δ** | **Enforcement boundary.** Must any part of Layer 1 be enforceable in `firestore.rules`? If yes, Options 5–6 are excluded outright (§5.4). If no, the trusted-caller relocation is unconstrained |
| **MI-ε** | **The population gap.** `employees` is not the complete person population — 15% of technicians, plus one production principal that can act. Does Layer 1 **fail closed** on them (declaring real actors non-existent), or is completeness a precondition to activating Layer 1 at all? |
| **MI-ζ** | **Long-term home.** `BA-7` is already `E. NEEDS_OWNER_RULING` (`…p1b-census.md:62`, `:255`). Is `MI-X` answered **for now** in Firestore with the Postgres move left to `BA-7`, or must both be decided together? Migration 008 pre-shaped `employee_id` for the FK (`…1758412800000:54-57`), so they **can** be sequenced — whether they **should** is the Owner's |
| **MI-V** *(already registered)* | Does Layer 1 extend to `creditedSalespersonId` and `responsibleEmployeeId` (§7)? `…DECOMPOSITION.md:1182`, `:1108` |
| **MI-J** *(already registered)* | Which employee fact is authoritative for "this person can no longer act"? `employmentStatus` is the only candidate at `64008d5a`, and the repo warns against conflating it with account state (§6.3) |

---

## 11. CONFLICTS CARRIED — both readings, unresolved

| # | Conflict | Reading A | Reading B |
|---|---|---|---|
| **C-1** | What the three matrix rows **are** | **Authority declarations**; the matrix names three, two identically, and is defective | The third tuple element is an **exclusion rationale** (`note`); the matrix was never asked and `C-B1`'s inference is the defect. **R-B makes `MI-X` worse, not better** (§1.1) |
| **C-2** | `O-1` vs `#182` Layer 1 | `#182` supersedes; the resolver may do I/O | `O-1` stands; Layer 1 lives in the caller. **Consistent with all six purity headers and both shipped precedents** (§5.2) |
| **C-3** | `docs/BusinessEntityModel.md:44`, `:313`: "`employees` collection **does not exist yet**" / "New, **deferred**… collection does not exist yet" | The doc is **STALE**: `docs/CLAUDE_CONTEXT.md:236` says the schema is "as actually implemented (PRs #82–#84, **live on `main`**)", `firestore.rules:476-498` has a match block, `provisionEmployeeAccess.js` writes it, and two censuses counted documents (6 prod / 60 nonprod) | Taken literally it is a **governing model document denying the collection exists**, which would void Option 1. **Recorded as a doc-drift conflict; not repaired here** (out of allowed surface) |
| **C-4** | `…p1b-census.md:816`: "`grep -i \"employee\" functions/migrations/*.sql` → **ZERO MATCHES**" | **STALE at `64008d5a`** — verified this lane: **7** migration files match, `1758412800000_employee-principal-linkage.sql` with **44** hits. The p1b claim was measured at `a8ec169e` per its own `:11`, so it is a snapshot artifact | Its derived conclusion at `:818` — "**the R4 identity mapping currently has nowhere to live**" — is likewise superseded: migration 008 is exactly that place. **Recorded, not repaired** |
| **C-5** | `SYSTEM_AUTHORITIES.md:54`: "**NOT DEPLOYED:** no Render service, no Vercel variable, no environment holds a policy database" | **Contradicted** by `docs/architecture/eos-real-nonprod-activation.md:112` "Render — **EXISTS**. Deployed 2026-09-10" and the live health probe at `:242` | Either way **Cloud Functions still has no Postgres path** (§4.5), so Options 5–6 are unaffected by which is current |
| **C-6** | `docs/DataModel.md:126`: "any signed-in user can read or write any document in `fieldops_jobs`/`fieldops_technicians`" | **STALE** — contradicted by `firestore.rules:397-423`, which gates on `isAdminOrDispatcher()` | If current it would make Option 3 worse still, not better. **Either way Option 3 is disqualified** |

---

## 12. WHAT THIS DOCUMENT DELIBERATELY DOES NOT CONTAIN

- **No choice of person authority.** §8.2: `RECOMMENDATION: NONE`, with the four blockers named.
- **No schema, no field name, no enum name, no collection to create, no column, no index.** `#182`
  withholds them. Where a field is named (`employmentStatus`, `userId`, `employeeId`) it is **quoted
  from code that already exists at `64008d5a`**, never proposed.
- **No migration, no backfill, no repair path.** `#182`: **NO BACKFILL AUTHORIZED**.
- **No repair of the four stale documents** in §11 (C-3 … C-6). Out of this lane's allowed surface;
  each is recorded with both readings so the next lane inherits the conflict rather than a smoothing.
- **No `ownershipMatrix.ts` edit**, and no assertion that one is required — C-1 is unresolved and the
  two readings disagree about whether the file is defective at all.
- **No resolution of `MI-J`, `MI-V`, `BA-7`, `O-1`, or `OI-39`'s register placement.**
