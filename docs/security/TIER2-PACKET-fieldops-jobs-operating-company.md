# TIER-2 PACKET — `fieldops_jobs` `allow update`: the admin/dispatcher branch has no affected-keys allowlist

**Status:** EVIDENCE PACKET. Read-only. **No Rules file was edited. Nothing was deployed.**
**Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (`main` == this baseline at time of writing).
**OBSERVED AT: 64008d5a** applies to every `file:line` in this document.
**Authorization required:** this describes a change somebody else must be authorized to make. Charter
Tier 2 (`docs/DelegationCharter.md:37`), see §11.

## 0. Execution status of every behavioural claim

**Every behavioural claim in this packet is UNPROVEN BY EXECUTION.** The Firestore emulator cannot run
in the authoring environment:

| constraint | evidence |
|---|---|
| No JRE | `which java` → not found. The emulator is a Java process (`.github/workflows/firestore-rules-regression.yml:62-67` installs Java 17 for exactly this reason). |
| Port 8080 held | `ss -ltnp` → `127.0.0.1:8080` held by `uvicorn` pid 187, unrelated to this repo. The suites pin `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. |

No rule in this document was evaluated. Claims are derived from reading the rule text, the transition
table, and the writers. Where a claim needs execution to settle, it is labelled **UNPROVEN** and the
settling observation is named.

---

## 1. CURRENT PREDICATE

### Verified line range

| item | range | note |
|---|---|---|
| `match /fieldops_jobs/{jobId}` block | `firestore.rules:353-395` | |
| The `allow update` **statement** (complete) | **`firestore.rules:381-391`** | one statement, terminated by `);` at 391 |
| Its explanatory comment | `firestore.rules:370-380` | |
| **The defective admin/dispatcher branch** | **`firestore.rules:383-384`** | inside the parenthesised OR opened at 382 |
| The technician branch it is contrasted with | `firestore.rules:386-390` | |

**The brief's citation `firestore.rules:381-384` is CORRECT** as the location of the guard plus the
admin/dispatcher branch. The full statement extends to **391**; cite `381-391` when quoting the whole
`allow update`, `383-384` when quoting the defective branch. Both copies of the file are
byte-identical at baseline, so these line numbers hold for `field-ops-app-vite/firestore.rules` too
(§9).

`git blame`: lines 381-391 are from `6e1fda9f1` (2026-07-21); the comment at 371-380 was revised by
`49873622b` (2026-07-22) — i.e. **the comment naming the allowlist was written one day after the
predicate**, which is consistent with the qualifier problem below.

### The whole `allow update` block, quoted verbatim

`firestore.rules:370-391`:

```
      // UPDATE: a completed job is terminal for every client; otherwise either
      // (a) admin/dispatcher performing a previously-approved lifecycle/
      //     assignment change (PR-2 contract, unchanged here), or
      // (b) the ASSIGNED technician performing a STATUS-ONLY start
      //     (assigned -> in_progress) on their OWN job (proven via
      //     users/{uid}.technicianId). Direct client completion is DENIED
      //     for technicians -- completion is Function-only
      //     (completeAssignedJob). jobStatusOnlyChange()'s hasOnly(['status'])
      //     allowlist also makes technicianId/workOrderId/customer/address/
      //     completedAt/completedBy or any other field client-immutable in
      //     this transition.
      allow update: if resource.data.status != 'complete'
        && (
          (isAdminOrDispatcher()
            && isValidJobTransition(resource.data.status, request.resource.data.status))
          ||
          (isSignedIn()
            && callerTechnicianId() != null
            && resource.data.technicianId == callerTechnicianId()
            && jobStatusOnlyChange()
            && isTechnicianJobTransition(resource.data.status, request.resource.data.status))
        );
```

### The neighbouring statements in the same match block, for context

`firestore.rules:360-368`:

```
      allow read: if isAdminOrDispatcher()
        || (isSignedIn()
          && callerTechnicianId() != null
          && resource.data.technicianId == callerTechnicianId());

      // CREATE: admin/dispatcher only; a new job must start open + unassigned.
      allow create: if isAdminOrDispatcher()
        && request.resource.data.status == 'open'
        && request.resource.data.technicianId == null;
```

`firestore.rules:393-394`:

```
      // DELETE: denied for all clients (no job delete path exists).
      allow delete: if false;
```

### Every helper the statement depends on, quoted verbatim

`firestore.rules:349-351` — **the allowlist that exists, and the pattern the correction should reuse**:

```
    function jobStatusOnlyChange() {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']);
    }
```

`firestore.rules:329-333`:

```
    // jobWorkflow.js transitions (admin/dispatcher path).
    function isValidJobTransition(from, to) {
      return (from == 'open' && to == 'assigned')
        || (from == 'assigned' && (to == 'in_progress' || to == 'open'))
        || (from == 'in_progress' && to == 'complete');
    }
```

`firestore.rules:343-345`:

```
    function isTechnicianJobTransition(from, to) {
      return from == 'assigned' && to == 'in_progress';
    }
```

`firestore.rules:320-327`:

```
    // The caller's trusted technicianId from users/{uid} (Admin-SDK-written,
    // `allow write: if false`, so client-immutable). null when signed out,
    // when the user doc is absent, or when the field is missing (fail closed).
    function callerTechnicianId() {
      return isSignedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        ? get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('technicianId', null)
        : null;
    }
```

### The defect, confirmed

The admin/dispatcher branch (`firestore.rules:383-384`) is **two conditions and nothing else**:
`isAdminOrDispatcher()` and `isValidJobTransition(...)`. The statement contains **no `keys()` call and
no `diff(...).affectedKeys()` call on that branch** — verified by reading 381-391 in full; the only
`diff/affectedKeys` in the statement arrives through `jobStatusOnlyChange()` at line **389**, which is
inside the technician branch's `&&` chain and therefore cannot constrain the other side of the `||`.

**The brief's reading of the comment is correct.** The comment at `firestore.rules:377-380` says
`jobStatusOnlyChange()`'s allowlist makes those fields "client-immutable **in this transition**." The
trailing qualifier scopes the sentence to branch (b). Nothing in the file claims immutability for
branch (a), and nothing enforces it.

### One correction to the defect statement, in the defect's favour on precision

The brief says an admin/dispatcher "performing **any** valid status or assignment transition may
rewrite every other field." Precise version: the branch is reachable **only bundled with one of the
four edges** in `isValidJobTransition` (`firestore.rules:330-332`), because a patch that leaves
`status` alone yields `from == to`, which no edge in that table matches. So:

- An admin/dispatcher **cannot** edit `description` (or any field) on its own today — that write is
  already denied.
- An admin/dispatcher **can** rewrite any field **when bundled with** `open→assigned`,
  `assigned→in_progress`, `assigned→open`, or `in_progress→complete`.

That narrows the reachable shape; it does not close it. The `open→assigned` edge is the exact edge the
assignment workflow uses, so the bundling requirement is no obstacle in practice.

---

## 2. WHO CAN REACH IT

### The predicate, resolved to its definition

`firestore.rules:22-24`:

```
    function isAdminOrDispatcher() {
      return isSignedIn() && (userRole() == "admin" || userRole() == "dispatcher");
    }
```

resolving through `firestore.rules:18-20` and `:14-16`:

```
    function userRole() {
      return userData().role;
    }
    function userData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
```

and `firestore.rules:6-8`: `isSignedIn()` is `request.auth != null`.

### Verdict: reachability is by a COMPATIBILITY Role, and by that alone

| axis | consulted by this branch? | evidence |
|---|---|---|
| Compatibility role string `users/{uid}.role` | **YES — the only input** | `firestore.rules:14-24` |
| Governed `roleAssignments` / `Role` documents | **NO** | absent from the whole predicate chain |
| `PERMISSION_CATALOG` / capability ids | **NO** | never referenced in `firestore.rules` |
| `employees.operationalRoles` | **NO, stated explicitly** | `firestore.rules:313-318`: "Compatibility source is `users/{uid}.role` (reuses `isAdminOrDispatcher()`); operationalRoles are **NOT** consulted here." |

So: **a compatibility Role, not a governed Role, and not both.** The satisfying principal set is
exactly `{uid : users/{uid}.role ∈ {"admin","dispatcher"}}`.

### The census facts — verified, and one of them does not say what the brief needs it to say

Committed census `be1e5579` — *"docs(access): R-32 production exposure census — zero exposed
principals (#1752)"*. Verified **an ancestor of `main` AND of the baseline `64008d5a`**
(`git merge-base --is-ancestor` → true for both).

| brief's claim | verified? | evidence |
|---|---|---|
| 2 `roleAssignments` | **YES** | `docs/assessments/r32-production-exposure-census.md:53` |
| one principal, `admin@global` | **YES** | `...census.md:65-68`: "Exactly one principal holds any active RoleAssignment: `admin` at `global` scope." |
| `employeeId: null` | **YES** | `...census.md:120`: `PRINCIPAL_HAS_NO_EMPLOYEE_LINK` — `JBslDvmpq8RqQAiyzfvwne9yCWc2` (the `admin@global` principal) has no `users/{uid}.employeeId` |
| zero governed-business-role occupancy | **YES** | `...census.md:60-63`: `technician + PARTS_MANAGER 0`, `technician + WAREHOUSE_MANAGER 0`, `BOTH 0`, `UNIQUE EXPOSED PRINCIPALS 0`; `:73-75` both manager roles 1 total / 0 with a governed Role |

### CORRECTION — the census does NOT enumerate the production principal set, and must not be cited as if it does

Two limits, both load-bearing for "who can reach it", and neither visible from the prose summary.

**(i) `roleAssignments` totals 2; exactly ONE is itemised.** `docs/assessments/r32-production-exposure-census.json`
reports `totals.roleAssignments: 2`, but its `principals[]` array contains **exactly one entry** —
`JBslDvmpq8RqQAiyzfvwne9yCWc2`, `employeeId: null`, `activeAssignments: ["admin@global"]`. **The second
roleAssignment is not itemised anywhere in the artifact** — not in the JSON, not in the Markdown. The
census's listing is scoped to a manager-exposure query (its stated purpose, `...census.md:23-30`), not
to a full principal enumeration.

So, precisely:

| statement | supportable? |
|---|---|
| "zero governed-business-role occupancy" | **YES** — that is exactly what the primary-exposure query measured (`...census.md:60-63`) |
| "the single production principal is `admin@global`" | **NO.** It is **one of two assignments**, and the other is **unidentified**. |

> **UNPROVEN:** the identity, principal, Role and active/inactive state of the **second** production
> `roleAssignment`. The prose at `...census.md:65-66` ("Exactly one principal holds any active
> RoleAssignment") is reconcilable with the JSON only if the second assignment is **inactive** — which
> the artifact never says. **"Who can reach it" cannot be closed while one of two production
> assignments is unidentified.** **What would settle it:** a read-only enumeration of
> `roleAssignments` with principal, roleId, scope and state. Production read — separately authorized.

**(ii) The evidence is dated, and was not re-read.** The census `measuredAt` is
**`2026-09-02T23:29:21.418Z`** (`...census.json`, and `...census.md:5, 36`). It was **not** re-read
live for this packet — a role-read lane was refused for exactly that reason. §2 therefore rests on
**dated committed evidence, not current production state.**

**(iii) And the census measures the wrong field for this branch anyway.** It measures
**`roleAssignments`** occupancy. It does **not** enumerate `users/{uid}.role`, which is the field
`isAdminOrDispatcher()` actually reads. It does report **`users` = 16** (`...census.md:54`). So:

> **UNPROVEN:** how many of the 16 production `users` documents carry `role == "admin"` or
> `role == "dispatcher"` — i.e. the true size of the principal set that can reach
> `firestore.rules:383`. **What would settle it:** a read-only census of
> `users` grouped by `role`, in the shape of `functions/scripts/r32ProductionExposureCensus.js`
> (which has no write path by construction, `...census.md:43-47`). That is a production read and is
> separately authorized; it was not performed for this packet.

The census's zero-occupancy result is nonetheless load-bearing here, and in a direction that
*increases* the relevance of the finding: with **zero** governed-role occupancy, there is no governed
Role gating anything on this collection, so **100% of write reach to `fieldops_jobs` runs through the
compatibility string.** The governed layer is not a second line of defence here; it is absent.

**Net for §2: the reachable principal set is NOT enumerated by this packet and cannot be, from
committed evidence.** What *is* established is the *shape* of reachability — a single compatibility
string field, no governed-Role gate, no capability gate, no second factor — and that shape is the
finding. The population is two open reads away (item (i) and the `users`-by-`role` census), both
production reads, both separately authorized, neither performed.

### `ADMIN_ALL_PERMISSIONS` — verified, and causally irrelevant to this branch

`functions/src/access/compatibilityRoles.ts:235-240`:

```
const ADMIN_ALL_PERMISSIONS = [
  ...ADMIN_CURATED_PERMISSIONS,
  ...PERMISSION_CATALOG.map((permission) => permission.id).filter(
    (id) => !ADMIN_CURATED_PERMISSIONS.includes(id),
  ),
];
```

spread onto `ADMIN_ROLE.permissions` at `functions/src/access/compatibilityRoles.ts:257`. The brief's
citation `compatibilityRoles.ts:235` is **correct for the `functions/` copy**. Minor correction: in the
mirror `field-ops-app-vite/src/access/compatibilityRoles.ts` the same declaration is at **`:241`**, not
235 — cite the copy.

**But it does not contribute to this defect.** `firestore.rules` never consults a permission id, a
`Role` document, or `PERMISSION_CATALOG`. `ADMIN_ALL_PERMISSIONS` widens who holds a *capability* in the
application/callable layer; it changes nothing about who satisfies `userRole() == "admin"`. Including it
in the reachability argument would overstate the finding. It is relevant only as context: the
capability layer is maximally permissive for `admin`, so there is no compensating control there either.

---

## 3. WHAT FIELD CAN CHANGE

### How this was derived — the method, stated

Four methods were used, and the first answer is the one that matters:

| method | result |
|---|---|
| **M0 — read the predicate for a key-set constraint** | **There is none.** `firestore.rules:381-391` contains no `keys()` and no `affectedKeys()` on branch (a). |
| **M1 — the document's written shape**: enumerate every create/update writer and read its payload | 19 known keys (table below) |
| **M2 — the metadata definition** | **DOES NOT EXIST.** No `EntityDefinition`, no zod schema, no TypeScript interface for this collection. `field-ops-app-vite/src/metadata/definitions/` has 34 files and no `job.js`; `field-ops-app-vite/test/objectListMetadataAuthority.test.mjs:178` records `fieldops_jobs — reporting wave 2, fieldsPopulated:false. No EntityDefinition`; `functions/src/reporting/reportCatalog.ts:89` registers it with `fieldsPopulated: false`. |
| **M3 — the Rules' own field mentions** for this collection | `status` and `technicianId` only (`firestore.rules:363, 367-368, 388`), plus the fields named in prose at `:378-379` |
| **M4 — prose enumerations in docs** | `docs/DataModel.md:7-23`; `docs/orchestration/metadata-program/entity-coverage-reconciliation.md:207-226` (marked **STALE**); `docs/assessments/fieldops-jobs-disposition.md` (production census, 12 records); `functions/src/ownership/ownershipMatrix.ts:267-271` |

### THE ANSWER IS NOT A LIST — the mutable set is UNBOUNDED

Because branch (a) carries no `affectedKeys()` constraint and no `keys().hasOnly(...)` shape check, a
Firestore `update` through it may **change any existing key, remove any existing key** (`affectedKeys()`
covers removals — noted for the equipment rule at `firestore.rules:1517-1519`), **and add keys that
have never existed on the document**. The enumeration below is therefore a **lower bound / census of
known keys**, not the permitted set. The permitted set is *every field name*, minus the two things the
surrounding conditions pin.

**What the surrounding conditions DO pin (the only two constraints):**

| pinned | by | effect |
|---|---|---|
| `resource.data.status != 'complete'` | `firestore.rules:381` | a completed job is terminal for this branch |
| `request.resource.data.status` must be a valid successor of the stored status | `firestore.rules:384` + `:329-333` | `status` itself cannot be set arbitrarily, and the write must *be* a transition |

Everything else on the document is free.

### Census of known keys (M1, with the writer for each)

| key | written by | notes |
|---|---|---|
| `status` | `field-ops-app-vite/src/domain/jobActions.js:77` (`updateJobStatus`), `:118` (`assignJob`); `functions/src/completeAssignedJob.ts:315` (Admin SDK) | pinned by the transition guard |
| `technicianId` | `field-ops-app-vite/src/domain/jobActions.js:117` (`assignJob`) | **the assignment axis** |
| `customer` | `jobActions.js:30` (`createJob`) → `collectionStore.js:88` | string **or** `{name}` — both shapes exist; normalized at `field-ops-app-vite/src/domain/jobDisplay.js:14-20` |
| `description` | `createJob` | |
| `workOrderId` | `createJob` | the upward link to `fieldops_wos` (`ownershipMatrix.ts:221-222`) |
| `address` | `createJob` | `{street,city,state,zip}` or null |
| `createdAt` | `collectionStore.js:88`; `functions/scripts/certificationWorld/correctLiveWorld.mjs:185` | |
| `updatedAt` | `collectionStore.js:88` (add only — `.update` at `:92-95` does **not** stamp it) | |
| **`operatingCompanyId`** | **`functions/src/ownership/ownershipBackfillRules.ts:141-150`, applied by `functions/scripts/ownershipSandboxBackfill.js:233`** | **the governed owner field — §4** |
| `jobId`, `customerId`, `locationId`, `equipmentId`, `title`, `priority`, `dataProvenance`, `certificationWorld` | `functions/scripts/certificationWorld/data/workforceLoad.mjs:168-182`, written via `certificationWorld/seedWrite.mjs:115-124` and stamped at `certificationWorld.mjs:203` | the 41 sandbox certification fixtures |
| `phase`, `partsRequired`, `partsReserved` | **NO WRITER ANYWHERE IN THIS WORKTREE** | declared at `docs/DataModel.md:7-23`; present on 3 production `heroConfig` demo records per `docs/assessments/fieldops-jobs-disposition.md` |

**Union — 19 keys:** `address`, `certificationWorld`, `createdAt`, `customer`, `customerId`,
`dataProvenance`, `description`, `equipmentId`, `jobId`, `locationId`, **`operatingCompanyId`**,
`partsRequired`, `partsReserved`, `phase`, `priority`, `status`, `technicianId`, `title`, `updatedAt`,
`workOrderId`.

**Explicitly not fields of this model:** `completedAt`, `completedBy` — `functions/src/completeAssignedJob.ts:312`
records that "the job model has no `completedAt`/`completedBy` fields", yet `firestore.rules:378-379`
names them as things the technician allowlist keeps immutable. They are probed and denied at
`functions/test/legacyJobsTechniciansRules.test.js:224-225`. Branch (a) would permit **creating** them.

### The 17 keys branch (a) leaves mutable, plus arbitrary new keys

Of the 19, `status` is pinned to a valid successor and nothing else is constrained. So branch (a)
leaves **18 of 19 known keys freely writable** (`status`'s *value* is constrained, its presence is
not), **plus any key not on this list**. The three highest-consequence members:

1. **`operatingCompanyId`** — the governed ownership fact (§4, §5).
2. **`technicianId`** — the assignment axis. Legitimately written by `assignJob`; but branch (a)
   permits changing it on any of the four edges, including `in_progress→complete`, i.e. completing a
   job while silently attributing it to a different technician. Not this packet's scope; recorded.
3. **`workOrderId`** — the link into the current Work Order authority. Branch (a) permits repointing it.

---

## 4. WHY `operatingCompanyId` IS AN AUTHORITY FACT — and the one part that does NOT hold

### It is not an authority-*adjacent* field. It is this family's DECLARED GOVERNED OWNER FIELD.

This is the strongest form of the claim and it needs no inference. **Verified at
`functions/src/ownership/ownershipMatrix.ts:267-268`:** `fieldops_jobs` is declared
`ownerClass: "COMPANY"` with **`ownerFields: ["operatingCompanyId"]`**.

So `firestore.rules:383-384` does not merely let an unrelated field drift. It lets an
admin/dispatcher rewrite **the exact field the ownership matrix names as this family's owner**, through
a transition whose stated purpose (`firestore.rules:371-372`) is a "lifecycle/assignment change." That
is **reassignment ≠ ownership transfer violated on the matrix's own terms** — a declared owner field
mutated by an assignment write — not a violation reached by argument about authority-relevance.

**Guard against one available misreading.** `ownershipMatrix.ts:83-93` carries ruling **R-8** and says
of a column: *"This column is NOT ownership. It exists so the financial lineage Sales Order -> Invoice
-> Payment can inherit a company without anyone concluding the company displaced the salesperson."*
That note is attached to **`companyScopeField`** (`ownershipMatrix.ts:94`) — the orthogonal
company axis carried by a **PERSON-owned** record, whose example is a Sales Order owned by a
salesperson and booked to a company. It does **not** apply here: on the `fieldops_jobs` row
`operatingCompanyId` sits in **`ownerFields`**, not `companyScopeField`, and the row's `ownerClass` is
**COMPANY**, not PERSON. R-8 cannot be used to demote this field.

### The full row

`functions/src/ownership/ownershipMatrix.ts:267-271`, quoted verbatim:

```
      family: "workOrderLegacy", collection: "fieldops_jobs", ownerClass: "COMPANY", ownerType: cmp,
      ownerFields: ["operatingCompanyId"], inheritanceSource: "explicit at creation, or the governed upstream service/commercial source company",
      transfer: "HANDOFF", companyScope: "SINGLE_COMPANY", backfillSource: null,
      unresolvedPolicy: OWNERLESS_UNTIL_SUPPLIED,
      note: "MEASURED 41/45: 41 sandbox jobs are certification fixtures and were explicitly authored, as equipment was. The other 4 are not, and stay unresolved. assignedTechId remains ASSIGNMENT.",
```

Read against the file's own column contract (`ownershipMatrix.ts:29-42`): `ownerFields` is "the
EXISTING storage the typed owner derives from. Empty = no storage yet." Non-empty here is a
**measured** statement — the file makes a point of this at `:262-266`:

> "Unlike `fieldops_wos` above, this family's `operatingCompanyId` REALLY IS STORED: the authorized
> sandbox backfill wrote it on 41 records (`ownershipBackfillRules.ts:118-128`,
> `AUTHORIZED_WRITE_CAPS.fieldops_jobs = 41`) and the post-backfill census measures 41/45 RESOLVED
> with the remaining 4 reported as "no `operatingCompanyId`". So the non-empty `ownerFields` below is
> a description of storage that exists, which is what the column means."

This distinction is load-bearing in the file: the sibling `fieldops_wos` row was **corrected down to
`ownerFields: []`** precisely because its declaration had never been measured
(`ownershipMatrix.ts:230-247`). `fieldops_jobs` is the row that survived that audit.

Ownership of this family is also an **Owner-ruled** axis, not an incidental field: ruling **R-3** /
**D-13** (`ownershipMatrix.ts:197-201, 256-260`) — *"The responsible operating company owns the job;
the technician performs it."*

### CORRECTION to the brief: "populated" is true in SANDBOX, and FALSE in PRODUCTION

The brief says `operatingCompanyId` "is a **populated** owner field on this family." Measured:

| environment | populated? | evidence |
|---|---|---|
| Sandbox, pre-backfill | 0 / 45 | `sb-evidence/ownership-census-sandbox-2026-08-30.txt:18` |
| Sandbox, post-backfill | **41 / 45** (4 "no `operatingCompanyId`") | `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt:18,46-47`; `sb-evidence/ownership-backfill-applied-eos-platform-sandbox.json:919-925` (scanned 45, eligible 41, 4 protected as "not an authored certification Job") |
| **Production** | **0 / 12 — never backfilled** | `docs/implementation-plans/eos-ownership-backfill-plan.md:94,228,265-266,326` records `fieldops_jobs` as having no company source; the production field census in `docs/assessments/fieldops-jobs-disposition.md` (12 records) lists `status`, `createdAt`, `customer`, `workOrderId`, `technicianId` and the 3 `heroConfig` demo fields — **no `operatingCompanyId`** |

**No create path writes it** — not `createJob`, not the certification fixtures, not any smoke or test
seed (`functions/test/legacyJobsTechniciansRules.test.js:193-197` writes 7 keys, none of them this
one). Its only writer is the sandbox backfill. So:

- The **model** defect is real and present at baseline.
- The **production blast radius today is a write of a field no production record currently holds** —
  i.e. an admin/dispatcher could *author* a false company fact on a production job, not corrupt an
  existing one. That is still authoring an ungoverned ownership fact, and it is worse in one respect:
  the value would be unaudited and indistinguishable from a legitimate future backfill.

### The authority-flow claim — VERIFIED, AND IT DOES NOT HOLD FOR THIS FAMILY

The brief asks that the "flows into authorization decisions" leg be verified rather than asserted. It
was. **Verdict: `operatingCompanyId` is NOT read for any authority purpose on `fieldops_jobs`, or
anywhere near it.**

| surface | does it read `operatingCompanyId` for authority? | evidence |
|---|---|---|
| `firestore.rules` (both copies) | **NO** | The field appears in **no `allow` predicate and no helper**. Its one non-comment occurrence is `firestore.rules:254` — a `hasOnly` key-list entry inside `hasCanonicalReorderRequestKeys()`, which the file itself marks **dormant** at `:242-244` ("the create rule that consulted it is retired, so this listing describes the record rather than permitting anything"). The other four mentions (`:248, :698, :1067, :1077`) are comments. |
| Client guards / permission hooks | **NO** | No `useCan`/`hasPermission`/selector reads it. `field-ops-app-vite/src/services/reorderCallableClient.js:9,99` states the client "NEVER SENDS operatingCompanyId." `docs/architecture/SYSTEM_AUTHORITIES.md:58` states it is deliberately not returned to the client "(the client must not hold the company as an authority)." |
| Firestore query scoping | **NO** | **Zero** occurrences of `where('operatingCompanyId', ...)` anywhere in the repo. |
| Cloud Functions — the one genuine authority read | **YES, but not for jobs** | `functions/src/finance/financialVisibility.ts:170`: `case "OPERATING_COMPANY": return nonEmpty(facts.companyId) && facts.companyId === g.operatingCompanyId;` — the FIN-004 per-record read-visibility decision. Fail-closed guard at `:137-139`; grant built at `functions/src/finance/financeReadCallables.ts:118-121`; enforced at `financeReadCallables.ts:202,231` and `functions/src/finance/financialReportingRead.ts:273`. |
| The permission engine's company scope | **NO — different key** | `functions/src/access/resolveEffectivePermission.ts:173-183` value-matches a RoleAssignment scope of type `operatingCompany` by its `value`; it never reads a field named `operatingCompanyId`. |

Two precision points that matter:

1. In the FIN-004 path the identifier `operatingCompanyId` is the **grant's bound scope value**; the
   *document* field compared against it is `invoice.companyId`. **No code anywhere compares a
   principal's company against a record's `operatingCompanyId`.**
2. That path covers `invoices` and financial reporting. **`fieldops_jobs` is not in it.** Everything
   else in `functions/src` touching the field is a write-authority refusal ("the caller does not
   choose the company" — `reorderCommands.ts:130-135, 293-298`; `invoiceCommands.ts:132-143`;
   `salesOrderCommands.ts:274-282`), required-field validation, derivation-and-stamping, or report
   scoping. `functions/src/ownership/commercialCompanyScope.ts:60-73` is documented as inert
   ("there is no enforcement").

### Therefore — the honest severity

**`operatingCompanyId` on `fieldops_jobs` is a governed ownership fact under an Owner ruling. It is
NOT, at this baseline, an input to any authorization decision.** This materially changes severity in
both directions and the packet states both:

- **Lower** than a privilege-escalation finding. Writing it grants the writer nothing, reveals
  nothing, and unlocks no data. There is no reachable "change the company, gain access" sequence.
- **Not merely cosmetic.** It is (a) a violation of a ratified standing ruling (§5), (b) an ungoverned,
  unaudited write to the field the ownership model designates as the owner of this family, and (c) a
  live pre-positioning risk: FIN-004 demonstrates that this platform *does* build authorization on
  company scope, and the ownership matrix declares this family COMPANY-owned. The gap should be closed
  **before** anything starts reading it, not after.

---

## 5. WHAT STANDING RULING IT VIOLATES

### CORRECTION FIRST — there is no ruling bearing the brief's wording

The brief names the standing ruling as **"reassignment ≠ ownership transfer"** (and adjacently
**"manager intervention ≠ ownership transfer"**). **No document in this repository contains either
sentence, or any paraphrase of them as a named ruling.** A repo-wide search for
`not ownership transfer` / `is not an ownership transfer` / `manager intervention` returns **zero**
matches. Cite the actual artifacts below, not that phrasing — a Rules citation in this program has
already been wrong once by being remembered rather than read.

What **does** exist, and what actually governs this, is a ratified invariant plus a separate
non-collapse ruling. Both are quoted verbatim.

### The ruling, verbatim

`docs/DECISIONS.md:3277-3279` — **#142, OWNER RULING: EOS Ownership Model v1**:

> "The approved invariant is *every governed business record has an owner*, typed as `owner.type` +
> `owner.id`, **separate from Created By and Assigned To, never changing implicitly, and changing only
> by explicit auditable handoff.**"

The adjacent **non-collapse ruling**, `docs/DECISIONS.md:3307-3310`:

> "`currentOwner` (a reorder-request role queue), coverage/territory, `explicitTitleHolder`,
> **`assignedTo`**, and `createdBy` are **presumed distinct** from ownership and may not be merged
> into it without a later family-specific reconciliation proving they are the same business
> authority."

Restated for this family at `functions/src/ownership/ownershipMatrix.ts:199-201`:

> "The responsible operating company owns the job; the technician performs it. That keeps the
> ownership/assignment distinction this whole model rests on, and it is why `assignedTechId` is
> deliberately NOT an ownerField below."

and closed at `ownershipMatrix.ts:271`: **"`assignedTechId` remains ASSIGNMENT."**

The handoff leg, `functions/src/ownership/ownershipHandoffCommand.ts:1-3` (ruling **D-5**):

> "'Every ownership change is an explicit, auditable handoff.' This module is that explicitness."

and D-1, `docs/DECISIONS.md:3282-3285`: "**There is no second, independently writable ownership
authority**, and writes keep going through the existing governed paths until an ownership write
authority is deliberately activated."

### The precise write sequence that violates it

One single-request client `PATCH`, no transaction needed, by any principal with
`users/{uid}.role == "admin"` or `"dispatcher"`, against a `fieldops_jobs` document whose stored
`status` is `open`:

```
PATCH .../documents/fieldops_jobs/{jobId}
{
  "status":             "assigned",     // a valid edge: open -> assigned
  "technicianId":       "T-1",         // the legitimate reassignment
  "operatingCompanyId": "ventana"      // an OWNERSHIP TRANSFER, smuggled
}
```

Evaluation against `firestore.rules:381-391`:

| condition | line | result |
|---|---|---|
| `resource.data.status != 'complete'` | 381 | `'open' != 'complete'` → **true** |
| `isAdminOrDispatcher()` | 383 → 22-24 | **true** |
| `isValidJobTransition('open','assigned')` | 384 → 330 | **true** |
| any constraint on the affected key set | — | **NONE EXISTS** |
| → `allow update` | 381 | **ALLOW** |

**UNPROVEN BY EXECUTION** (§0). What would settle it: the negative-control run in §8.

**Which clauses this breaks, one at a time:**

| ruling clause | how this sequence breaks it |
|---|---|
| "**never changing implicitly**" (`DECISIONS.md:3278`) | The ownership change rides inside a request whose declared purpose is an assignment. Nothing declares it, nothing validates it, nothing records it. That is the definition of implicit. |
| "**changing only by explicit auditable handoff**" (`:3279`) | No `OWNERSHIP_HANDOFF` audit event is produced. `stageOwnershipHandoff` (`ownershipHandoffCommand.ts:200-206`) is the only thing that emits one and it is not on this path. The transfer is unauditable after the fact: the document shows the new company and no record of the old one. |
| "**`assignedTo` presumed distinct from ownership**" (`:3308`) | One write mutates the assignment axis (`technicianId`) and the ownership axis (`operatingCompanyId`) together, collapsing the exact two axes `ownershipMatrix.ts:199-201` exists to hold apart. **Reassignment ≠ ownership transfer** — and here reassignment *is* the carrier of an ownership transfer. |
| D-1: "**no second, independently writable ownership authority**" (`:3284`) | `firestore.rules:383-384` *is* a second, independently writable ownership authority — reachable by a direct client REST call, bypassing every governed path. |

### Reassignment is itself a RULED, legitimate act — with no ownership dimension

This is what makes the collapse a violation rather than an ambiguity. `docs/DECISIONS.md:1601-1606`
(#110, Owner, 2026-08-19), verbatim:

> "**Dispatch may reassign away from the scheduled technician, with a recorded reason.** … Reassignment
> at Dispatch is permitted and explicit. It requires a reason. The system records **prior technician,
> new technician, actor, timestamp and reason**; re-runs the schedule and conflict checks against the
> new technician; and notifies affected parties. Completed and cancelled work remains locked."

Reassignment is therefore a first-class, accountable operational act with its own recorded facts — and
**`operatingCompanyId` is not among them.** The Owner specified exactly what a reassignment records,
and company is absent from that list. Branch (a) lets a company change ride inside the one act the
Owner enumerated field-by-field without it.

A test-level pin of the same distinction, on the sibling family:
`functions/test/warehouseRootCompanyAssignment.test.mjs:68` —
`test("a DIFFERENT company -> REFUSE. Reassignment is not invented here", …)`.

**The adjacent form — call it manager intervention vs ownership transfer** (the packet's own shorthand;
see the correction opening this section — no ruling carries that phrasing). A dispatcher's legitimate
intervention authority on this collection is a lifecycle correction (`assigned→open` is an un-assign;
`firestore.rules:331`, and `firestore.rules:410-412` grants the analogous "operational-correction
authority" on technicians). Branch (a) lets that intervention carry a company change. The intervention
authority was granted as a PR-2 lifecycle contract (`firestore.rules:371-372`); it was never granted
as an ownership authority.

### The same file already made this argument, forty lines earlier — about the same field

`firestore.rules:246-253`, verbatim, in `hasCanonicalReorderRequestKeys()`:

```
        // THE IMMUTABILITY IS REAL, AND IT IS NOT HERE. It comes from machinery that was in this
        // file first: every retained update branch ends with diff(resource.data).affectedKeys()
        // .hasOnly([...]), and not one of those lists names warehouseId or operatingCompanyId. An
        // update touching either puts it in affectedKeys() and fails the branch. That is live, it is
        // what the emulator suite proves on both record generations, and it is why no per-branch
        // equality pin is added: an equality check would have to dereference a key legacy rows do
        // not have, whereas diff() compares the maps and never reports a key absent from both. A
        // retained client update therefore cannot become a company transfer, on either generation.
```

Two things follow. First, the mechanism this packet proposes in §7 is the mechanism the file already
names as the correct one for this exact field. Second, **the sentence "every retained update branch
ends with `diff(resource.data).affectedKeys().hasOnly([...])`" is scoped to `reorder_requests` and is
not true of the file as a whole** — `firestore.rules:383-384` is a counterexample. A reader who
generalises that sentence would conclude the platform is already protected. It is not.

---

## 6. CURRENT TEST COVERAGE

### The suite

**`functions/test/legacyJobsTechniciansRules.test.js`** — the F-RULES-1 contract suite, **43**
registered assertions, of which **25** target `fieldops_jobs`.

| fact | evidence |
|---|---|
| Registered with an **exact expected count** | `functions/scripts/rulesRegressionRunner.mjs:59` — `{ file: "legacyJobsTechniciansRules.test.js", expected: 43 }` |
| Repo-wide expected total | `rulesRegressionRunner.mjs:68` — `EXPECTED_TOTAL` = **835** |
| Runs in CI, path-filtered on the Rules files | `.github/workflows/firestore-rules-regression.yml:11-12, 23-24` (`firestore.rules`, `field-ops-app-vite/firestore.rules`), `:78` (`npm run test:rules`) |
| CI provides the JRE | `.github/workflows/firestore-rules-regression.yml:62-67` (Java 17) |
| Harness | `firebase-admin` + Node `fetch` against the emulator REST APIs, custom-token sign-in. **`@firebase/rules-unit-testing` is not used anywhere in this repo.** Emulator required. |
| Direct script | `functions/package.json:113` — `test:fRules1`; `:14` — `test:rules` |

### Branch-vs-`main`

`git rev-parse main HEAD` → **both `64008d5ae0bdd9532909671b15a91122400accf1`**.
`git diff --stat main...HEAD -- '*test*'` → **empty**.
Checked `feature/f-rules-1-pr1-contract-tests`, `feature/f-rules-1-pr2-incremental-enforcement`,
`feature/f-rules-1-field-mode-read-scoping`, `chore/tier2-bounded-permission-policy` — **no test-file
diffs vs `main`** (already merged).

**Every test below exists on `main`. There are no branch-only `fieldops_jobs` Rules tests.**

### What the `allow update` coverage actually is

| # | file:line | branch | assertion | on `main` |
|---|---|---|---|---|
| 1 | `legacyJobsTechniciansRules.test.js:214` | **(a) admin/disp** | ALLOW — dispatcher assigns `{technicianId, status}` (`open→assigned`) | yes |
| 2 | `:237` | **(a) admin/disp** | DENY — admin cannot reopen a `complete` job | yes |
| 3 | `:215` | (b) technician | ALLOW — status-only `assigned→in_progress` on own job | yes |
| 4 | `:222` | (b) | DENY — technician cannot set `complete` | yes |
| 5 | `:223` | (b) | DENY — smuggled `workOrderId` | yes |
| 6 | `:224` | (b) | DENY — smuggled `completedAt` | yes |
| 7 | `:225` | (b) | DENY — smuggled `completedBy` | yes |
| 8 | `:226` | (b) | DENY — arbitrary status (`assigned→cancelled`) | yes |
| 9 | `:227` | (b) | DENY — multi-field replace to `complete` | yes |
| 10 | `:233` | (b) | DENY — another technician's job | yes |
| 11 | `:234` | (b) | DENY — technician changes `technicianId` | yes |
| 12 | `:235` | (b) | DENY — smuggled `customer` (`hasOnly(['status'])`) | yes |
| 13 | `:236` | (b) | DENY — lifecycle skip `assigned→complete` | yes |
| 14 | `:239` | (b) | DENY — unmapped technician fails closed | yes |

Non-update `fieldops_jobs` assertions: `:209-213, 228, 231-232, 238, 240-241`. Seed: `:193-197`.

### Verdict — the gaps, stated plainly

| question | answer |
|---|---|
| Assertions on the **technician** branch (b) | **12 of 14** — all four of its guards are covered |
| Assertions on the **admin/dispatcher** branch (a) | **exactly 2** — one ALLOW (`:214`), one DENY (`:237`, and that DENY is produced by the *outer* `status != 'complete'` guard at `firestore.rules:381`, not by anything inside branch (a)) |
| Any test asserting **field immutability against an admin/dispatcher writer** on `fieldops_jobs` | **NONE.** Every "immutability" assertion above (`:223, :224, :225, :227, :234, :235`) derives from `jobStatusOnlyChange()` and proves nothing about branch (a). |
| Any test mentioning **`operatingCompanyId`** on `fieldops_jobs`, for any principal | **NONE. Zero coverage of any kind.** The field does not appear in the `fieldops_jobs` Rules block nor in any test touching that collection. It is covered only for `reorder_requests` (`rulesRegressionRunner.mjs:68` notes both record generations proved to "refuse `warehouseId`/`operatingCompanyId` as a diff"). |
| `isValidJobTransition` edge coverage | 2 of 4 edges touched via branch (a): `open→assigned` (`:214`). `assigned→open`, `in_progress→complete` and every illegal pair are **unexercised for admin/dispatcher**. |

**So: the defect is not merely untested — the one existing branch-(a) ALLOW test (`:214`) is the test
whose payload the correction must continue to pass.** See §7.

Adjacent, for completeness: `functions/test/completeAssignedJob.test.js` covers the trusted callable
(Admin SDK, bypasses Rules); `:279-280` asserts the successful cascade leaves `technicianId` and
`description` untouched. `functions/scripts/d2SmokeRulesVerification.js:133-150` is an operator smoke
script (not CI) and probes technician paths only.

---

## 7. MINIMUM CORRECTION

**Not applied. Quoted here only. `firestore.rules` was not edited in this packet.**

### The pattern to reuse — it is already in this file, twice

| precedent | location | distance from the defect |
|---|---|---|
| `jobStatusOnlyChange()` | `firestore.rules:349-351` | **32 lines above**, same match block's sibling helper |
| `equipment` `allow update` | `firestore.rules:1542-1547` — `... && request.resource.data.diff(resource.data).affectedKeys().hasOnly(equipmentEditableKeys()) && ...` | same file, a named-key-list variant |

Both use `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`. Nothing needs
inventing.

### The change — one new helper, one added conjunct

**Diff-shaped, illustrative, NOT APPLIED:**

```diff
--- a/firestore.rules
+++ b/firestore.rules
@@ (helpers, beside jobStatusOnlyChange at 349-351)
     function jobStatusOnlyChange() {
       return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']);
     }
+    // The admin/dispatcher lifecycle+assignment branch's allowlist -- the SAME
+    // machinery as jobStatusOnlyChange() above, one key wider, because assignment
+    // is this branch's authority and a technician's is not: jobActions.js's
+    // assignJob() writes exactly {technicianId, status} and updateJobStatus()
+    // writes exactly {status}. Ownership (operatingCompanyId) is deliberately
+    // ABSENT: ruling #142/D-5 -- ownership changes only by explicit auditable
+    // handoff, never implicitly and never as a passenger on a reassignment.
+    function jobLifecycleFieldsOnlyChange() {
+      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'technicianId']);
+    }
@@ (the allow update statement at 381-391)
       allow update: if resource.data.status != 'complete'
         && (
           (isAdminOrDispatcher()
+            && jobLifecycleFieldsOnlyChange()
             && isValidJobTransition(resource.data.status, request.resource.data.status))
           ||
           (isSignedIn()
             && callerTechnicianId() != null
             && resource.data.technicianId == callerTechnicianId()
             && jobStatusOnlyChange()
             && isTechnicianJobTransition(resource.data.status, request.resource.data.status))
         );
```

### Why `['status', 'technicianId']` and not `['status']`

`['status']` alone would be **smaller but wrong** — it would break the one existing branch-(a) ALLOW
test. Verified against every live writer:

| writer | payload | passes `hasOnly(['status','technicianId'])`? |
|---|---|---|
| `field-ops-app-vite/src/domain/jobActions.js:116-119` (`assignJob`) | `{ technicianId, status }` | **yes** |
| `field-ops-app-vite/src/domain/jobActions.js:77` (`updateJobStatus`) | `{ status }` | **yes** |
| `functions/src/completeAssignedJob.ts:315` | `{ status }` — **Admin SDK, bypasses Rules entirely** | n/a |
| `field-ops-app-vite/src/firebase/collectionStore.js:92-95` (`jobsStore.update`) | caller-supplied; **does not stamp `updatedAt`** (only `.add` at `:88` does) | no extra key introduced |
| `createJob` → `NewJobModal.jsx` | **orphaned** — no importer; `Jobs.jsx:23-33` records the create form was removed (F0) | n/a |
| `functions/test/legacyJobsTechniciansRules.test.js:214` (the existing ALLOW) | `{ technicianId, status }` | **yes — preserved** |

So the correction is a **no-op for every live client write path** and preserves all 43 existing
assertions. UNPROVEN by execution (§0); §8 is how that is settled.

### Why a `hasOnly` allowlist rather than an equality pin on `operatingCompanyId`

The file already answered this, for this field, at `firestore.rules:250-253`: an equality check
"would have to dereference a key legacy rows do not have, whereas `diff()` compares the maps and never
reports a key absent from both." Production `fieldops_jobs` records **do not carry
`operatingCompanyId`** (§4), so an equality pin would be exactly the broken shape that comment warns
against. `hasOnly` is correct on both generations. It also closes the whole class — `workOrderId`,
`customer`, `address`, an invented `completedBy` — not just this one field.

### Scope discipline

This is a change to **`fieldops_jobs` only**. No rule outside that match block is proposed.

---

## 8. NEGATIVE CONTROL REQUIRED

A prior lane found a parity harness passing vacuously. The guard below must be proven **fail-first**.
**None of this was executed here** (§0) — it is the required procedure for the authorized implementer.

### The observation that proves non-vacuity

**Run the new DENY assertion against the UNMODIFIED baseline Rules and observe it FAIL.** Concretely,
against `firestore.rules` at `64008d5a`, the probe must return **HTTP 200** where the assertion expects
a denial. If it returns 403 before the Rules change, the assertion is not testing what it claims and
must be discarded and rewritten.

### The assertions to add (to `functions/test/legacyJobsTechniciansRules.test.js`, beside `:214`)

```js
  // NEGATIVE CONTROL: each of these returns 200 against the baseline rules
  // (branch (a) has no affectedKeys allowlist) and 403 after the fix.
  record("dispatcher cannot smuggle operatingCompanyId into an assignment",
    "ENFORCED", "DENY",
    await updateDoc("fieldops_jobs", "job-open-fr1", dispTok,
      { technicianId: str("T1-fr1"), status: str("assigned"), operatingCompanyId: str("ventana") }));
  record("admin cannot smuggle operatingCompanyId into a start transition",
    "ENFORCED", "DENY",
    await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", adminTok,
      { status: str("in_progress"), operatingCompanyId: str("ventana") }));
  record("admin cannot smuggle customer into a lifecycle transition",
    "ENFORCED", "DENY",
    await updateDoc("fieldops_jobs", "job-assigned-T1-fr1", adminTok,
      { status: str("in_progress"), customer: mapv({ name: str("HIJACK") }) }));
```

The third is the class-closure control: it proves the fix closes arbitrary fields, not one name.
A fourth assertion should re-affirm the preserved ALLOW (`:214` already does; keep it unchanged and
observe it still passes — that is the regression half of the control).

### The procedure, in order

```
# 1. FAIL-FIRST -- baseline Rules, new assertions. Requires a JRE + free :8080.
git -C <checkout> stash            # or verify firestore.rules is untouched at 64008d5a
cd functions && npm run test:fRules1
#   REQUIRED OBSERVATION: the three new assertions REPORT FAILURE
#   (HTTP 200 where DENY expected). Record the raw HTTP status per probe.
#   If any returns 403 here, the assertion is vacuous -- STOP and rewrite it.

# 2. Apply the §7 Rules change to BOTH copies (§9).

# 3. PASS-AFTER
cd functions && npm run test:fRules1
#   REQUIRED OBSERVATION: 46/46 pass -- the 43 pre-existing assertions
#   (including :214's ALLOW) plus the 3 new DENYs.

# 4. Whole-suite regression
cd functions && npm run test:rules
#   REQUIRED OBSERVATION: 838/838.
```

### The count bookkeeping — and why it makes the guard structurally non-vacuous

`functions/scripts/rulesRegressionRunner.mjs` asserts an **exact** per-suite count and an exact total.
Adding 3 assertions **requires** two edits or the runner fails:

| file:line | from | to |
|---|---|---|
| `functions/scripts/rulesRegressionRunner.mjs:59` | `expected: 43` | `expected: 46` |
| `functions/scripts/rulesRegressionRunner.mjs:68` | `EXPECTED_TOTAL` 835 | 838 |

This is the structural anti-vacuity property: a silently-skipped or silently-deleted assertion changes
the count and **fails the runner**. A vacuous pass cannot hide behind "0 tests ran." Note
`rulesRegressionRunner.mjs` is itself tested by `functions/test/rulesRegressionRunner.test.mjs` (`:200,
:228` reference this suite's registration), which must be re-run.

**Stale label, worth fixing in the same PR:** `.github/workflows/firestore-rules-regression.yml`
labels the step *"Canonical Firestore Rules regression (423 assertions)"* while `EXPECTED_TOTAL` is
835. A reviewer reading the CI label cannot tell whether the count moved. Cosmetic, but it is exactly
the signal a fail-first discipline depends on.

### What CI proves and what it does not

CI **can** run this (Java 17 at `firestore-rules-regression.yml:62-67`; path filter includes both Rules
copies at `:11-12, 23-24`). So the fail-first observation is obtainable in CI by pushing the test
commit **before** the Rules commit and reading the red run. CI **cannot** prove the live production
ruleset behaves this way — that needs §9 Step 3/4.

---

## 9. DEPLOYMENT IMPACT

### Dual-copy parity

| fact | evidence |
|---|---|
| Two committed copies | `firestore.rules` (1876 lines) and `field-ops-app-vite/firestore.rules` (1876 lines) |
| **Byte-identical at baseline** | `md5sum` → `e10bc046d30e337ef8e95f3d5f96ee0f` for **both** |
| The root copy is the **deploy source** | `firebase.json:5` — `"rules": "firestore.rules"` |
| Both must change | `skills/verify-rules-deploy/references/checklist.md:52-60`: "Every Sprint Specification requires changing **both** copies" |
| Deterministic parity check | `node skills/verify-rules-deploy/scripts/parity-check.mjs` → `PARITY OK` (0) / `PARITY MISMATCH` (1) |
| Hard refusal | `checklist.md:125`: "Do not deploy with the two `firestore.rules` copies out of parity." |

**Requirement:** apply the §7 change to both files and confirm `PARITY OK` before any deploy. Because
both copies are byte-identical at baseline, §1's line numbers apply to both — but re-derive them after
editing rather than trusting them.

### Deployment is manual, and nothing automates it

| fact | evidence |
|---|---|
| **No CI deploys rules** | `checklist.md:5-9`: "a `firestore.rules` change committed to the repo has **zero effect** on the live project until someone manually deploys it… (rules once sat undeployed for months)" |
| The release script **refuses** to | `scripts/_prodRelease.run.sh:23-26`: "It will not deploy `firestore.rules`. A Rules change is a Tier-2 protected action… Bundling it into a release script is how a Rules change ships without anyone deciding to ship it." |
| The command | `firebase deploy --only firestore:rules`, by an authorized operator, from the correct checkout (`checklist.md:80-84`) |
| The emulator/deploy reads the **CWD's branch** | `checklist.md:10-12` — "this produced a false 'Rules gap' finding twice" |
| Required reported states | `checklist.md:104-117`: **LIVE** / **MERGED, NOT DEPLOYED** / **BLOCKED** |

So the realistic post-merge state is **MERGED, NOT DEPLOYED**, and the packet should say so rather than
imply the fix takes effect on merge.

### What breaks for a legitimate admin workflow

**Nothing on any live path.** Verified writer-by-writer in §7: `assignJob` writes exactly
`{technicianId, status}`, `updateJobStatus` writes exactly `{status}`, `completeAssignedJob` is Admin
SDK and bypasses Rules, `createJob` is orphaned, and `jobsStore.update` adds no stamp. The allowlist is
a no-op for all of them.

**What does break — three things, all currently unexercised:**

| # | breaks | today | after |
|---|---|---|---|
| 1 | An **ad-hoc console / REST edit** of any other field by an admin, bundled with a valid status transition | succeeds silently | 403 |
| 2 | A **future client feature** that edits a job field alongside a transition (e.g. correcting `customer` while assigning) | would work | must be a separate write, or a trusted callable |
| 3 | The **sandbox ownership backfill**, *if* it were ever run through a client SDK | — | unaffected: `functions/scripts/ownershipSandboxBackfill.js:233` is **Admin SDK** and bypasses Rules entirely |

Note what is **already** broken today and stays so: an admin cannot edit a job field *without* a status
transition, because `isValidJobTransition(from, from)` is false for all `from` (§1). So the correction
does not remove a general edit capability — there isn't one.

**Nothing regresses for the 3 production records carrying `phase`/`partsRequired`/`partsReserved`:**
those fields have **no writer anywhere in this worktree**, so no path exists to be denied.

### Who notices

**Nobody, automatically.** There is no monitoring on Rules denials and no client-side mirror of this
predicate (unlike equipment, where `firestore.rules:1515-1516` notes "E2's client guard enforces the
same contract independently"). A denial surfaces as a `permission-denied` in the browser console and a
failed user action. Consequences:

- CI is the only automated notice, and only for the **committed** rules, not the live ones.
- The named human notices: the operator who runs Step 3/4 of
  `skills/verify-rules-deploy/references/checklist.md`.
- **Recommendation for the implementer:** state in the PR that there is no runtime detection, so the
  post-deploy verification (checklist Step 4) is the only proof the change is live and the only chance
  to catch an unforeseen legitimate write being denied.

---

## 10. ROLLBACK

### How to revert

| layer | action |
|---|---|
| Live ruleset | `firebase deploy --only firestore:rules` from a checkout at `64008d5a` (both copies at baseline), **or** roll back via the Firebase console's Rules version history for the target project. |
| Repo | revert the commit in both `firestore.rules` and `field-ops-app-vite/firestore.rules`; re-run `parity-check.mjs`. |
| Tests | revert the 3 assertions **and** `rulesRegressionRunner.mjs:59` (46→43) and `:68` (838→835), **or CI goes red** — see the coupling below. |

### How long clients stay on stale rules

**There is no client-side rules cache.** Firestore Rules are evaluated server-side per request, so a
deployed ruleset applies to new requests without any client update, reload, or cache expiry. This is
unlike the app bundle, which `firebase.json`'s hosting headers deliberately mark
`no-cache, no-store, must-revalidate` precisely because *that* had a staleness bug.

> **UNPROVEN:** the exact server-side propagation latency of a Rules deploy for this project. Google
> documents it as generally within a few minutes and not instantaneous. It was not measured and cannot
> be measured here (§0). **What would settle it:** the operator recording the console's published
> timestamp and the first observed behaviour change during checklist Step 4.

Practical consequence: the rollback window is short and is **not** gated on client behaviour. There is
no "clients stay on stale rules for N hours" exposure.

### What state a partial rollout leaves

| partial state | possible? | consequence |
|---|---|---|
| Half-applied ruleset (some rules new, some old) | **NO** | Exactly one ruleset is published per database; a deploy is atomic at the Rules layer. There is no half-state and no per-collection rollout. |
| **Dual-copy divergence** | **YES — the realistic failure** | Reverting only one file leaves the copies out of parity. `parity-check.mjs` catches it; `checklist.md:125` forbids deploying in that state. The root copy is what actually deploys (`firebase.json:5`), so a revert of only the `field-ops-app-vite/` copy changes **nothing** live while making the repo look reverted — the more dangerous direction. |
| **Repo-vs-live divergence** | **YES, and it is the default** | No CI deploys rules (`checklist.md:5-9`). A revert merged without a deploy leaves the *old* (fixed) rules live and the *new* (baseline) rules committed, or vice versa. `checklist.md:104-117` exists for exactly this: the correct status is **MERGED, NOT DEPLOYED** until Step 3/4 evidence exists. |
| **Test-vs-Rules divergence** | **YES — a real coupling** | If the Rules are rolled back but the 3 assertions stay registered, `firestore-rules-regression.yml` fails (the assertions expect DENY; baseline rules return 200) **and** the count assertion fails. A Rules rollback **must** be accompanied by the test revert, in the same commit. Conversely, reverting only the tests leaves the fix live but unguarded. |

**Rollback is therefore three coupled edits (both Rules copies + the tests/counts) plus one manual
deploy, and only the last of those changes live behaviour.**

---

## 11. WHY THIS MUST REMAIN A SEPARATE TIER-2 CHANGE

This is argued, not asserted.

### 1. It is Tier 2 twice over, and the charter forbids splitting it

`docs/DelegationCharter.md:37` — Tier 2 includes: **"Changes to `firestore.rules` that alter who can
read or write what."** This change alters what an admin/dispatcher may write. Squarely in.

`docs/DelegationCharter.md:38` — Tier 2 also includes: **"Anything that would violate or bend the
write-path rule (no job/technician writes outside `assignJob()`/`updateJobStatus()`)."** This change
*enforces* that rule at the Rules layer for the first time — it moves a charter-level invariant from
convention into enforcement, on the exact two collections the clause names. Second independent hit.

`docs/DelegationCharter.md:28` closes the split: "**the presence of one Tier 2 element pulls the whole
merge decision into Tier 2, it doesn't get split field-by-field.**" So a PR containing this Rules diff
is a Tier-2 PR *in its entirety*, whatever else it contains.

`docs/DelegationCharter.md:105` (§8.3) and `:113` (§8.7) repeat it as a stop condition and confirm no
delegated mode authorizes a Rules deploy.

### 2. The repository has already made this exact mistake once, on this exact reasoning

`docs/DECISIONS.md:35-43` — **#4, "Correction to entry #3 — the `firestore.rules` change within Sprint
2.1.11 was mis-scoped as Tier 1"**:

> "…`docs/DelegationCharter.md` Section 2 lists 'Changes to `firestore.rules` that alter who can read
> or write what' as Tier 2 (escalate) unconditionally — **it does not carve out an exception for
> changes that follow an existing pattern** or don't touch the Blaze-blocked ledger."

That sentence is aimed directly at this packet's own §7 argument. §7's strongest engineering point is
*"reuse the pattern 32 lines away."* Decision #4 says that is precisely **not** a Tier-1 qualifier. The
`checklist.md:19-28` Step 0 restates it: "There is no carve-out for 'follows an existing pattern' or
'doesn't touch the ledger.'"

Also from #4 (`DECISIONS.md:42-43`): committing anyway and treating the classifier as a technicality
was rejected, as was *"quietly reworking the rules change to look like a 'read-only' or 'narrower'
change to avoid triggering the same review."* A minimal, pattern-matching, test-shaped diff is exactly
what that second rejection describes the shape of. Minimality is a merit of the fix; it is not a route
around the gate.

### 3. The ownership model's own ruling reserved this enforcement

`docs/DECISIONS.md:3326-3328`, closing ruling #142: **"Not done, deliberately: no enforcement, no
backfill, no Rules change, no deploy, no cascade, no silent assignment."** The change in §7 *is* the
enforcement that ruling declined to authorize. Landing it inside another PR would be an unowned
reversal of an explicit Owner reservation.

### 4. The smuggling argument — why bundling it with a test fix specifically defeats review

The operative rule is that Tier-2 work must not ride inside a normal correctness PR: **a reviewer
approving a test fix has not thereby approved a change to Rules authority.** For this change that is
not a generic caution; it is a mechanical property of this repo's CI:

1. `.github/workflows/firestore-rules-regression.yml:11-12, 23-24` path-filters on **both**
   `firestore.rules` **and** `functions/test/**Rules*.test.js`. A PR that changes only the tests and a
   PR that changes the tests *and* the Rules produce **the same single check with the same name**. The
   signal is identical.
2. The three assertions in §8 and the Rules conjunct in §7 are designed to land together and pass
   together. Bundled, the PR narrative reads *"add missing coverage for the jobs update rule, and the
   coverage passes"* — which is true, and which conceals that the coverage passes **because the
   authority changed**. The fail-first discipline in §8 exists to expose that; bundling hides its
   output inside one green run.
3. The counts make it worse, not better: `rulesRegressionRunner.mjs:59` and `:68` must change too. A
   reviewer seeing `43 → 46` and `835 → 838` in a "test coverage" PR has a plausible, entirely
   innocent reading available. The count delta is indistinguishable from ordinary coverage growth.
4. Approval is not transitive. `DECISIONS.md:48-52` (#5) records this repository resolving exactly
   that: an approval for PR #95 and issue #97 did not extend to PR #94, and treating an earlier
   general "ok" as retroactive blanket authorization was rejected as "the same 'assume authorization
   from context' mistake." A reviewer's approval of coverage is not an approval of authority.

### 5. What separation should look like

| PR | contents | tier | gate |
|---|---|---|---|
| **1 — characterization** | the 3 assertions (§8) + the two count bumps, **against unmodified Rules** | Tier 1 | CI is **RED**, deliberately. That red run **is** the fail-first evidence (§8), and it is a reviewable artifact rather than a claim. |
| **2 — the authority change** | both `firestore.rules` copies, nothing else | **Tier 2 — Owner approval** | CI turns green. The **entire diff is the authority change**, so a reviewer cannot approve it without reading it. |
| **3 — deploy** | no code | **Tier 2/3 — Owner authorization + human operator** | `checklist.md` Steps 2-5; report LIVE / MERGED-NOT-DEPLOYED / BLOCKED. |

A deliberately-red PR 1 may be procedurally awkward; if the repo forbids merging red, invert it —
land PR 1 with the assertions registered but the run captured as a CI artifact, or capture the
fail-first run on the PR-2 branch before the Rules commit and cite the run URL. The requirement is that
**the fail-first observation exists as evidence outside the approving PR**, not the specific mechanism.

---

## 12. THE A/B QUESTION — RETURNED TO THE OWNER, WITH NO RECOMMENDATION

- **A.** Forbid changing `operatingCompanyId` through that transition **entirely**.
- **B.** Route a legitimate company change through a **separate governed command**.

### DETERMINATION: the business semantics are NOT established. This is the Owner's decision, and this packet makes no recommendation between A and B.

### The evidence that looks like it settles it — and the repository's own ruling that it does not

The apparent settling evidence is `functions/src/ownership/ownershipMatrix.ts:269`:
`transfer: "HANDOFF"` on the `fieldops_jobs` row, read against the column contract at
`ownershipMatrix.ts:33` (**`HANDOFF` = "explicit auditable transfer"**), and chosen deliberately against
`IMMUTABLE` siblings (`:191` invoices/payments/refunds, `:329` warehouse balances, `:390-426` the
inventory/transfer/receiving/cycle-count/PO families) and against `N_A` (`:444-452`, where "the handoff
command refuses this family"). The handoff command's four family refusals
(`functions/src/ownership/ownershipHandoffCommand.ts:90-121`) all pass for this row, so the machinery
already says yes to it.

**That reading is wrong, and the repository has already adjudicated exactly this inference — for the
sibling family, on the identical classification.** `docs/assessments/ownership-2a1b-physical-root-company-authority-reconciliation.md:119-132`,
verbatim:

> "- `ownershipMatrix.ts` classifies the `warehouse` root as `transfer: "HANDOFF"`, `ownerClass: COMPANY`… So a *policy* for change exists: it goes through the handoff authority, not through an ordinary write.
> - **But no business event is defined anywhere.** Searching DECISIONS, SYSTEM_AUTHORITIES and the specifications finds no case of a warehouse moving between operating companies, and no event that would represent it.
>
> **Can a physical Warehouse legitimately move from Taylor to Ventana?**
>
> **NO GOVERNED REASSIGNMENT SEMANTICS FOUND.** The matrix says *how* such a change would have to be made if it happened; nothing says it happens, or what business event it would be. **The `HANDOFF` classification is a routing rule, not evidence of a use case, and I am not treating "technically expressible" as "governed".**"

Escalated as a standing stop condition at the same document `:353-355`:

> "2. **NO GOVERNED REASSIGNMENT SEMANTICS (§E).** The matrix routes a company change to HANDOFF but no business event exists. The proposal therefore **refuses** a different-company assignment. **If reassignment is real, it needs its own ruling and its own event** — not a flag on this command."

And enforced in code, `functions/src/ownership/warehouseRootCompanyAssignment.ts:27-30`:

> "NO REASSIGNMENT. The ownership matrix routes a warehouse company CHANGE to the handoff authority, but nothing in this repository describes a warehouse moving between operating companies or what business event that would be. **A routing rule is not a use case**, so a mismatch is refused rather than treated as a transfer. If that requirement ever becomes real it gets its own ruling."

`warehouses` and `fieldops_jobs` are both `ownerClass: "COMPANY"`, both `transfer: "HANDOFF"`, both
`companyScope: "SINGLE_COMPANY"`. **The adjudication transfers verbatim.** `transfer: "HANDOFF"` is a
*routing* classification stating how a change would have to be made **if** it happened; it is not
evidence that it happens. Treating it as business evidence is the precise error that document names and
refuses.

**This packet drafted the opposite conclusion before finding that precedent, and records the reversal
rather than quietly adopting the corrected one.** The `transfer: "HANDOFF"` value is real, it is
Owner-derived (ruling R-3/D-13), and it is *not* business evidence.

### The positive search for business evidence — what was looked for and what was found

| question | finding |
|---|---|
| Any product path that changes a **job's** `operatingCompanyId`? | **NONE.** No callable, no HTTP endpoint, no UI action, no script. `grep` over `field-ops-app-vite/src` finds zero job-related `operatingCompanyId` writes. |
| The only writer of a job's company, ever? | The bounded **sandbox** backfill rule `functions/src/ownership/ownershipBackfillRules.ts:140-152`, applied by `functions/scripts/ownershipSandboxBackfill.js:233`. It **never overwrites**: `ownershipBackfillRules.ts:21` — "`ALREADY_SET` the ownership field is already present -- **never overwritten** (requirement 10)"; script header `:21` "NEVER OVERWRITES." Cap `fieldops_jobs: 41` (`:226`); the other 4 return `PROTECTED`. |
| The job's declared `inheritanceSource`? | **Creation-time only** — `ownershipMatrix.ts:268`: "explicit at creation, or the governed upstream service/commercial source company". Reinforced at `:258-260`: "**THE JOB is where the company enters** the legacy service lineage… Never from the technician, the dispatcher, `createdBy` or `assignedTo`." |
| Does a governed command for it already exist? | **The authority exists; it is INERT and it has never performed a transfer.** `ownershipHandoffCommand.ts:7-14`: "**INERT. Deliberately, and in two separate ways:** 1. It is NOT exported from `functions/src/index.ts`, so no callable reaches it… 2. It STAGES an audit event… it does not commit." |
| `stageOwnershipHandoff`'s only live caller? | **CONFIRMED** as the brief stated: the operator CLI `functions/scripts/assignWarehouseRootCompany.js:72` (require) and `:234` (call). Everything else is test-only (`functions/test/warehouseRootCompanyAssignment.test.mjs:28,255`; `functions/test/ownershipModel.test.mjs` ×14; `functions/test/warehouseCanonicalIdRepair.test.mjs:164` asserts its *absence*). |
| …and is that caller a transfer? | **NO — it is a FIRST ASSIGNMENT.** `assignWarehouseRootCompany.js:23-25`: `unset + governed ACTIVE -> ASSIGN`, `same -> IDEMPOTENT (no write, no audit event)`, **`different company -> REFUSE`**. The staged event carries `previousOwner = null` (`:239-240`). Sandbox/cert only; production refused by project id and registry role (`:18-45`, `:100-125`). **So the handoff machinery has never, anywhere, moved a record between companies.** |
| The family-level validator on a product path? | **CONFIRMED NOT.** Two candidates: (1) the in-module family gate `ownershipHandoffCommand.ts:89-121`, reachable only from the inert command; (2) the explicit `assertFamilyIsGovernedHere` at `functions/src/eosCommercial/commercialOwnershipAuthority.ts:115-133` (throws `FAMILY_NOT_TRANSFERABLE`), used by `buildCommercialHandoff` (`:282-312`) and `functions/src/eosCommercial/commercialOwnershipRepository.ts:181-260`. **The whole `eosCommercial` directory is DEAD:** grep for `eosCommercial` outside it returns nothing — no callable, no `index.ts` export; only two test files import it, and it targets a Postgres plane no deployed code reaches. Corroborated by `docs/financials/FIN-001_FINANCIAL_AUTHORITY_MAP.md:333`: "Sales-credit reassignment / company-attribution correction \| **DESIGNED, INERT**". |
| Any other ownership-transfer command? | **NONE.** `transferOwnership`, `reassignCompany`, `changeOperatingCompany`: **zero hits repo-wide.** |
| Any doc establishing a job's company changes? | **NONE.** `docs/DECISIONS.md:3352-3353` (#143) says "The 41 authored fixture companies on `fieldops_jobs` stand. Job ownership does **not** depend on Work Order ownership, and company changes are **not** synchronised in either direction" — it presupposes the *concept* without asserting the *event*. |
| Where company mutability WAS decided for adjacent records? | **Immutable / frozen / historical, every time.** `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md:222` ("**immutable once stamped**"); `docs/financials/FIN-002_REPORTING_ATTRIBUTION_MODEL.md:66` ("frozen at ACCEPTED… rewrites nothing historical (test-pinned)"); `docs/architecture/SYSTEM_AUTHORITIES.md:115`; `firestore.rules:246-253`; and an explicit refusal to even provide the method — `functions/src/eosOps/warehouseBinRepository.ts:226-229`: "**There is no method that moves a warehouse between operating companies**: the company is the boundary a warehouse's whole movement history was recorded under, and reassigning it would silently restate who owned every past receipt." |
| Any live product path mutating `operatingCompanyId` on **any** existing document? | **Exactly one, and it is not an owned record.** `updateEmployeeProfile` treats it as an editable field on `employees` (`functions/src/access/employeeProfileCommands.ts:215`, validation `:345-351`; callable `functions/src/access/administrationUsersCallables.ts:93-97`; exported `functions/src/index.ts:244`; UI `field-ops-app-vite/src/modules/administration/UserEditPanel.jsx:186-190`). But `employees` is **EXCLUDED** from the ownership matrix — `ownershipMatrix.ts:514`: "person authority -- a subject of ownership, not an object." That is HR employment data, not a record-ownership transfer, and it is not a job. **It does not generalise.** |

**Conclusion: the repository does not establish that a job's operating company legitimately changes
after creation.** Per the lane rule, business intent is **not** inferred from the existence of an
unguarded hole, and the absence of evidence is reported as absence — not converted into either answer.

### Therefore — RETURNED AS AN OWNER/AUTHORITY DECISION

**No recommendation between A and B is made.** Per the precedent above, if reassignment is real it
"needs its own ruling and its own event," and that ruling is the Owner's, not this packet's. Both
options are costed below.

### Both options, fully costed

| | **A — forbid entirely through that transition** | **B — route through a separate governed command** |
|---|---|---|
| **What it asserts about the business** | A job's company is set at creation and never changes by a client write. Consistent with the `IMMUTABLE`-everywhere precedent (`FIN-002:66`, LOB wireframe `:222`, `warehouseBinRepository.ts:226-229`) and with `inheritanceSource` being creation-time (`ownershipMatrix.ts:268`). | A job's company legitimately changes, as an explicit auditable event. Consistent with `transfer: "HANDOFF"` (`ownershipMatrix.ts:269`) — **but that value is a routing rule, not evidence (see above)**. |
| **Rules change** | §7: one helper + one conjunct, both copies | **The same change.** B also requires the client path closed, or D-1's "no second, independently writable ownership authority" (`DECISIONS.md:3284`) is violated regardless. |
| **Code change** | **none** | Wire `stageOwnershipHandoff` to a callable; export from `functions/src/index.ts`; add the owner-field write onto the same transaction (the seam is described at `ownershipHandoffCommand.ts:196-198`); define the business event and choose its `OWNERSHIP_HANDOFF_SOURCES` token (`DIRECT_HANDOFF` / `CUSTOMER_HANDOFF_REVIEW` / `ADMIN_CORRECTION`, `functions/src/access/auditEventWriter.ts:255-264`); register a capability/permission id; build an admin surface. |
| **Prerequisite Owner authorization** | Tier 2 for the Rules change + Tier 2/3 for the deploy (§9, §11) | All of A's, **plus** activation of the ownership write authority, which `DECISIONS.md:3284-3285` reserves ("until an ownership write authority is **deliberately activated**") and `:3326-3328` explicitly declined, **plus** a new ruling defining the business event (`ownership-2a1b:353-355`). |
| **Test cost** | 3 assertions + 2 count bumps (§8) | A's, plus callable tests, `OWNERSHIP_HANDOFF` audit assertions, idempotency/no-op refusal, and a Rules test proving the client path stays closed. |
| **Breaks a live workflow?** | **No** — §9 verified it is a no-op for every live writer | No |
| **Blocks a legitimate company change?** | **Yes at the client — but there is no such product path today to block**, and no evidence a legitimate change exists (table above) | No |
| **Audit trail** | None produced — the write is denied, so there is nothing to audit | `OWNERSHIP_HANDOFF` with previous/new owner, actor, source, optional reason (D-5, `DECISIONS.md:3301-3305`) |
| **Cost of being wrong** | If a real company-change need later emerges, it must go through B anyway — A costs nothing but a later unblock, and denies no capability anyone has today | Building a transfer path for an event nobody has shown exists — the exact "technically expressible ≠ governed" error `ownership-2a1b:129-132` refuses, plus a new ungoverned-by-ruling write authority on a COMPANY-owned family |
| **Reversibility** | High — §10 | Low — an activated write authority and an audit vocabulary are hard to withdraw |

### One structural observation, offered as a finding and NOT as a recommendation

A and B are not distinguished by their Rules predicate: **both require the client write path closed.**
Under A it is the whole answer; under B it is the precondition that stops there being two writable
ownership authorities (`DECISIONS.md:3284`). So the §7 predicate is the **intersection** of A and B, not
a vote for either.

This is stated so the Owner can see that the A/B question and the §7 Rules change are separable
decisions. It is **not** an argument that §7 should be approved — that is a Tier-2 decision on its own
terms (§11), and this packet has no authority to pre-approve it.

### The single piece of business evidence that would settle A vs B

> **A named, real instance of a job whose operating company had to change after creation** — a Taylor
> job that became a Ventana job (or the reverse): **which job, who asked, why, when, and what the
> correct audit story is.**

- **If it exists:** B is the answer. The instance supplies the business event that
  `ownership-2a1b:353-355` says a reassignment needs, and it makes the
  `DIRECT_HANDOFF` / `ADMIN_CORRECTION` token choice answerable from the case rather than guessed.
- **If it does not exist:** A is the answer, and the `warehouses` precedent applies unchanged —
  refuse the change, and let it get "its own ruling" if the requirement ever becomes real.

**The repository contains no such instance.** The only company values ever written to this family are
41 synthetic sandbox certification fixtures, authored from a static map at
`functions/scripts/certificationWorld/data/serviceJobCompany.mjs:26+`. That is the absence of evidence,
reported as absence. **It is not an answer, and this packet does not convert it into one** — a
consistent record of "we never needed this" is weaker than a ruling, and the Owner may hold business
knowledge the repository does not.

## 13. SCOPE-DISCIPLINE NOTE — other un-allowlisted `allow update` branches

The brief asks that a second un-allowlisted branch be **reported, not absorbed**. A mechanical scan of
all 30 `allow update` statements in `firestore.rules` (excluding the 18 that are `if false`, which need
no allowlist) found **5 permissive statements with no `affectedKeys().hasOnly(...)`**:

| lines | collection | note |
|---|---|---|
| **381-391** | **`fieldops_jobs`** | **this packet's subject** |
| 418-419 | `fieldops_technicians` | `allow update: if isAdminOrDispatcher() && isTechnicianStatus(request.resource.data.status);` — the closest analogue: same principal gate, same status-validation-without-key-allowlist shape. **Not examined. Not in scope.** |
| 1335-1337 | `accounts` | has governed-field guards (`accountGovernedFieldsValid`, `accountGovernedFieldsUnchanged`) rather than a key allowlist — a different, possibly adequate pattern. Not assessed. |
| 1343 | `locations` | `allow create, update: if isAdminOrDispatcher();` — wholly unconstrained. Not assessed. |
| 1557 | `contacts` | `allow create, update: if isAdminOrDispatcher();` — wholly unconstrained. Not assessed. |

Only **2** of 30 statements carry an allowlist: `reorder_requests` (763-888) and `equipment`
(1542-1547).

**This packet proposes no change to any of these and makes no claim about them.** They are reported to
the controller as a separate finding. Whether any is a defect depends on each collection's owner fields
and writers, which were not investigated. **None of them is `operatingCompanyId`-bearing on the
evidence gathered here, but that was not verified and is therefore UNPROVEN.**

---

## 14. UNPROVEN — consolidated

| # | claim | why unproven | what would settle it |
|---|---|---|---|
| 1 | Every behavioural claim about rule evaluation (§1, §5, §7) | No JRE; port 8080 held (§0) | The §8 fail-first/pass-after emulator runs, in CI or on a machine with Java 17 |
| 2 | The size of the principal set satisfying `isAdminOrDispatcher()` in production | The `be1e5579` census measures `roleAssignments`, not `users/{uid}.role`; `users` = 16 total | A read-only census of `users` grouped by `role`, in the shape of `functions/scripts/r32ProductionExposureCensus.js`. Production read — separately authorized. |
| 2b | **The identity, principal, Role and active/inactive state of the SECOND production `roleAssignment`** | `...census.json` reports `totals.roleAssignments: 2` but itemises **one** principal (`admin@global`). The second is itemised nowhere. The prose claim "exactly one principal holds any *active* RoleAssignment" is reconcilable only if the second is inactive — which the artifact never states. **"Who can reach it" is not closed.** (§2) | A read-only enumeration of `roleAssignments` with principal, roleId, scope and state. Production read — separately authorized. |
| 2c | That §2's reachability picture reflects **current** production state | The census `measuredAt` is `2026-09-02T23:29:21.418Z` and was **not** re-read live (a role-read lane was refused). §2 rests on dated committed evidence. | A fresh read-only run of the census script |
| 3 | That the §7 allowlist breaks no live workflow | Derived by reading every writer, not by running the app | §8 step 3/4, plus post-deploy checklist Step 4 |
| 4 | Rules-deploy propagation latency | Not measurable here | Operator records the console published timestamp and first observed behaviour change (checklist Step 4) |
| 5 | Whether the 19-key census is the complete set of keys ever written | Derived from writers + docs + census evidence; no schema exists to check against (M2 — there is no `EntityDefinition`) | A production field-key census over `fieldops_jobs`. Note the set is **unbounded by rule** regardless (§3), so this does not change the correction. |
| 6 | Whether the other 4 un-allowlisted branches (§13) are defects | Deliberately not investigated — scope discipline | A separate lane per collection |
| 6b | **Whether a job's operating company legitimately changes after creation** (the A/B question) | The repository contains no business event, no product path, and no ruling for it; `transfer: "HANDOFF"` is a routing rule, not evidence (`ownership-2a1b:129-132`). Absence of evidence is **not** an answer. | **A named real instance** of a job whose company had to change — which job, who asked, why, when, and the correct audit story. **Owner knowledge, not a repository read.** (§12) |
| 7 | That the live production ruleset matches `64008d5a` | No production contact | `skills/verify-rules-deploy` Steps 3-4 |

---

## 15. CORRECTIONS TO THE BRIEF

Recorded because correcting the brief was declared in scope.

| # | brief said | correction |
|---|---|---|
| 1 | the defect is at `firestore.rules:381-384` | **Correct** for the guard + admin/dispatcher branch. The full `allow update` **statement** runs to **391**. Cite `381-391` for the block, `383-384` for the branch. The substance of the defect claim is **confirmed in full**. |
| 2 | `ADMIN_ALL_PERMISSIONS` at `compatibilityRoles.ts:235` | **Correct for `functions/src/access/compatibilityRoles.ts:235`**; the mirror `field-ops-app-vite/src/access/compatibilityRoles.ts` has it at **`:241`**. More importantly it is **causally irrelevant** to this branch — `firestore.rules` consults no permission id (§2). |
| 3 | `operatingCompanyId` is a **populated** owner field on this family | **Populated in SANDBOX only: 41/45.** **Production is 0/12 — never backfilled** (`docs/implementation-plans/eos-ownership-backfill-plan.md:94,228,265-266,326`). The model defect is real; the production exposure is *authoring* a false company fact, not corrupting an existing one (§4). |
| 4 | `operatingCompanyId` "flows into authorization decisions" | **Verified and it does NOT, for this family.** The one live authority read is FIN-004 `functions/src/finance/financialVisibility.ts:170`, which matches a *grant's* bound value against `invoice.companyId` — invoices, not jobs. No `allow` predicate, no client guard, and zero `where('operatingCompanyId', …)` queries anywhere. **This materially lowers severity** and the packet says so (§4). **But the authority-relevance argument is not needed**: the field is this family's **declared `ownerFields` entry** (`ownershipMatrix.ts:267-268`), which is a stronger and direct basis (§4). |
| 5 | the census shows "zero governed-business-role occupancy" | **Confirmed** (`r32-production-exposure-census.md:60-63, 73-75`). Its bearing here is the opposite of mitigating: with zero governed-role occupancy, **all** write reach to this collection runs through the compatibility `users/{uid}.role` string, and the governed layer is not a second line of defence (§2). |
| 6 | an admin/dispatcher "performing **any** valid status or assignment transition" may rewrite every field | Precise version: reachable **only bundled with one of the four edges** in `isValidJobTransition`. A field-only patch yields `from == to`, which matches no edge, and is **already denied**. This narrows the shape; it does not close it, and `open→assigned` is the assignment workflow's own edge (§1). |
| 7 | the standing ruling is **"reassignment ≠ ownership transfer"** (adjacently **"manager intervention ≠ ownership transfer"**) | **No document in this repository contains either sentence, or any paraphrase of them as a named ruling** — a repo-wide search for `not ownership transfer` / `is not an ownership transfer` / `manager intervention` returns **zero** matches. The substance is right; the citation must be the actual artifacts: the #142 invariant (`DECISIONS.md:3277-3279`), the non-collapse ruling (`:3307-3310`), and `ownershipMatrix.ts:199-201, 271`. Cite those, not the phrasing (§5). |
| 8 | the census shows "the single production principal is `admin@global`" | **Not supportable.** `...census.json` totals **2** `roleAssignments` and itemises **one** principal. The second is unidentified everywhere in the artifact. Zero *governed-business-role occupancy* is supportable; a closed principal enumeration is not. Also: the census is dated **2026-09-02** and was not re-read live (§2). |
| 9 | — (not in the brief; **this packet's own reversal, recorded**) | This packet first read `ownershipMatrix.ts:269` `transfer: "HANDOFF"` as business evidence that a job's company legitimately changes, and drafted a B-shaped determination. **That was wrong.** `docs/assessments/ownership-2a1b-physical-root-company-authority-reconciliation.md:129-132` adjudicates exactly that inference for the sibling COMPANY-owned family on the identical classification: "**NO GOVERNED REASSIGNMENT SEMANTICS FOUND**… The `HANDOFF` classification is a **routing rule, not evidence of a use case**, and I am not treating 'technically expressible' as 'governed'." §12 was reversed to **no recommendation, returned to the Owner** (§12). |
| 10 | — (not in the brief) | `ownershipHandoffCommand.ts:13-14` ("There is no code path in this repo that calls it") and `:197` ("Nothing calls this yet") are **stale** at `64008d5a`: `functions/scripts/assignWarehouseRootCompany.js:234` calls `stageOwnershipHandoff`. Out of scope; recorded (§12). |
| 11 | — (not in the brief) | The handoff machinery has **never moved a record between companies anywhere**. Its one live caller is a *first assignment* that **refuses** a different company and stages `previousOwner = null` (`assignWarehouseRootCompany.js:23-25, 239-240`). Relevant because it means B has no working precedent, not merely no product path (§12). |
