---
artifact_type: operating-model-lane
lane: EMP-ACCOUNTABILITY
mode: EVIDENCE_WRITE
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
baseline_tag: ATLAS-BASE-2026-09-12-A
date: 2026-09-13
status: Draft — lane-local, not canonical
canonical_writer: EMP-OWN-SYNTHESIZER
---

# EMP-ACCOUNTABILITY — the business accountability model

**Every derived fact in this document carries `OBSERVED AT: 64008d5a`.** Nothing here was read from
production, a database, or a live environment. No schema, field, collection or command is proposed
as an implementation; where the business model needs something EOS cannot represent, the gap is
**classified**, and the classification is the deliverable.

**This lane owns the business model — what *should* be true.** It does not audit runtime behaviour
(**OWN-E2E**) and does not map the model onto object families (**OWN-DESIGN**). Where a finding
required proving what code does, it is marked **→ OWN-E2E** and handed over rather than concluded.

---

## 0. The load-bearing invariant, restated as a test

> **WHO IS RESPONSIBLE FOR MAKING SURE THE NEXT THING HAPPENS?**

For every **actionable** item, **exactly one accountable person** must be identifiable at all
times, unless an explicit Owner-approved exception defines otherwise. For **non-actionable /
reference / master-data** objects, EOS must identify the **responsible steward**. **"NOBODY IS
RESPONSIBLE" is not an acceptable steady state. NO HANDOFF MAY CREATE A RESPONSIBILITY GAP.**

### The lane's single most important finding

EOS **cannot answer the invariant question for any actionable operational item**, and — more
seriously — **cannot detect that it cannot answer it**. Three independently-correct decisions
compose into a gap that no existing instrument measures:

| # | The decision | Where | Why it is right on its own |
|---|---|---|---|
| 1 | Service and inventory work is **COMPANY**-owned, not person-owned (rulings D-13, D-14) | `functions/src/ownership/ownershipMatrix.ts` (`workOrder`, `workOrderLegacy`, `reorderRequest`) | "The responsible operating company owns the job; the technician performs it." Correctly refuses to call assignment ownership. |
| 2 | Non-`ACTIVE` `employmentStatus` **fails closed** on every operational capability | `functions/src/access/operationalRoleContext.ts:52`; `adminCredentialCommands.ts:183,223`; mirrored in `firestore.rules` `isActiveOperationalRole` | A departed or on-leave person must not retain operating authority. |
| 3 | Ownership **never cascades implicitly**; historical ownership stays historical | `ownershipHandoffCommand.ts` ("NO CASCADE … ONE record and ONE event"); `record-ownership.md` §6 | Prevents mass rewriting of history and silent mis-attribution. |

**The composition.** A COMPANY owns the Work Order, so no person is accountable for it by
ownership. The only *person* on the record is the assignee, whose authority is revoked the instant
they stop being `ACTIVE`. Nothing may cascade to name a replacement. **Result: a live customer
commitment with an identifiable owning company, an identifiable performer who can no longer act,
and no identifiable accountable person at all** — the literal "NOBODY IS RESPONSIBLE" steady state,
reached without any rule being broken. `OBSERVED AT: 64008d5a`

**Why it is invisible.** The person-owner derivation is **shape-only**: it validates that an
employee id is a non-empty usable string and **never reads the Employee document**
(`typedOwner.ts:95-125`, `deriveAccountOwner` / `deriveEmployeeRefOwner`). A record owned by a
`TERMINATED`, deleted or wholly non-existent employee therefore censuses as **RESOLVED**. By
contrast `deriveCompanyOwner` (`typedOwner.ts:131-140`) *does* resolve against the governed company
authority and returns `UNKNOWN` for an ungoverned id. **The COMPANY axis has referential integrity;
the PERSON axis has none.** The census — the instrument the whole enforcement gate depends on — is
structurally blind to exactly the failure the invariant exists to prevent. `OBSERVED AT: 64008d5a`

### The primary MODEL GAP, stated mechanically

Cross-lane finding from **EMP-WORK**, adopted here as the primary framing: **EOS models the ASSIGNEE
and no other role concept, so a handoff can never move accountability.** This is the mechanical answer
to questions 4, 9, 10, 11, 14, 16 and 17 at once — *"who remains accountable during an unaccepted
handoff"* has **nowhere to be recorded**, not merely no rule governing it. The distinction matters: a
missing rule can be written, whereas a missing place to put the answer cannot be filled by policy.

Corpus **P3B1-S21** is titled *"the transfer EOS cannot express"*, and the real-world path it records is
the proof: **"Dale tells Javier verbally and the record stays on Curtis."** The workaround does not
merely bypass EOS — it **corrupts the very scorecard built on that data**, because the technician
scorecard (WF-SVC-016) attributes the work to Curtis, who did not do it. **An accountability model
whose only workaround falsifies the performance data is worse than one with an acknowledged gap**, and
this is the strongest single argument that the gap must be closed in the model rather than tolerated in
practice.

This is a **MODEL GAP** (there is no accountability axis distinct from ownership and assignment),
an **ENGINEERING GAP** (person-owner derivation performs no referential or lifecycle check), and a
**WORKFLOW GAP** (no in-flight reassignment edge exists — §7). It is **not** fixable by cascading
ownership, which the existing rulings correctly forbid.

---

## 1. Evidence inventory — re-derived at baseline

| Evidence | Claimed | Re-derived `OBSERVED AT: 64008d5a` | Verdict |
|---|---|---|---|
| `docs/OWNERSHIP.md` | record-ownership evidence (63 lines) | 63 lines, but it is **IP / attribution governance** (who owns the company and the IP, AI-as-tools, prohibited wording). It contains **nothing** about record ownership, accountability or handoff. | **Brief is wrong** — see §12 |
| `docs/specifications/record-ownership.md` | 257 lines | 257 lines. Status **Draft**. Its stated model ("**whoever creates a record owns it**", owner "derived from the authenticated actor", §1) is **superseded** by ruling D-4 / `creationOwnerResolution.ts`, which forbids exactly that. | Superseded in part |
| `docs/assessments/eos-ownership-model-reconciliation.md` | 463 lines | 463 lines. Status **Ratified**. Carries rulings D-1…D-16, Q1–Q4, O-1…O-4 and the measured sandbox census. | Authoritative |
| `docs/specifications/employee-foundation.md` | 575 lines | 575 lines. Status **Approved**. Explicitly out of scope: **Availability, Scheduling, HR integration, multi-company hierarchy**. No `managerEmployeeId` in its schema. | Superseded in part |
| `docs/implementation-plans/eos-ownership-backfill-plan.md` | 482 lines | 482 lines. | Authoritative |
| `functions/src/ownership/**` | 12 modules | **12 modules** confirmed | Correct |
| `ownershipMatrix.ts` families | "50 families" (reconciliation doc) | **51** — PERSON 6, COMPANY 20, PARTICIPATING_COMPANIES 1, REFERENCE 7, EXCLUDED 17 (6+20+1+7+17 = 51). Evaluated, not pattern-matched. | Doc off by one |
| Workflow registry | 86 workflows | **86** confirmed (`p3d-workflow-registry/docs/architecture/eos-workflow-registry.json`, 252,208 bytes) | Correct |
| Registry state distribution | — | `WORKS_WITH_GAPS` 27 · `BROKEN_MIDWAY` 31 · `CANNOT_START` 23 · `NO_IMPLEMENTATION` 5 · **`WORKS_END_TO_END` 0** | New fact |

### The nine concepts → what EOS can actually store

Never collapse these, and especially not into `ownerId`. `OBSERVED AT: 64008d5a`

| # | Concept | Storage at baseline | Status |
|---|---|---|---|
| 1 | **RECORD OWNER** | `accounts.accountOwner` (7-field map); `ownerEmployeeId` on `opportunities` / `sales_agreements` / `sales_orders`; `operatingCompanyId` on 8 COMPANY families | **Partial** — 14 of 27 ownable families have **no owner storage at all** |
| 2 | **ACCOUNTABLE PERSON** | **none, anywhere** | **ABSENT** — no field, no concept, no vocabulary. The central MODEL GAP |
| 3 | **ASSIGNEE / EXECUTOR** | `assignedTechId`, `scheduledTechId` (work orders); `assignedToUserId` (reorder requests); `truck.driver` | Present, and correctly **not** an `ownerField` |
| 4 | **MANAGER** | **Two unreconciled answers** (§1.1): `employees.managerEmployeeId` (a person) and `access/roleHierarchy.ts` (a role-derived tree) | **Ambiguous** — neither is usable for escalation |
| 5 | **ESCALATION OWNER** | **none, anywhere** | **ABSENT** — §6 |
| 6 | **OPERATING COMPANY** | `operating_companies` (`taylor` / `ventana`, ruling D-2); `employees.operatingCompanyId`; `operatingCompanyId` on records | Present |
| 7 | **DOMAIN STEWARD** | **none** — the 7 REFERENCE families have `ownerType: null`, `transfer: N_A`, no steward field | **ABSENT** — §5 |
| 8 | **SECURITY ROLE** | `users/{uid}.role` (legacy mirror) + `roleAssignments` (governed); `employees.securityRole` is a **legacy mirror no command writes** | Present, correctly separated |
| 9 | **JOB ROLE** | `employees.jobTitle` (**free text**) + `operationalRoles` (8-value enum, **3 of which have no consumer** — §1.2) | Present, **not a usable vocabulary** |

**Two of the nine concepts have no representation at all (ACCOUNTABLE PERSON, ESCALATION OWNER) and
a third exists only as a dead field (MANAGER).** The invariant depends on precisely those three.

### 1.1 "Who manages this person?" has two unreconciled answers

Cross-lane input from **EMP-ROLE**, re-verified here. `OBSERVED AT: 64008d5a`

| Subsystem | Shape | Consumers | Provenance |
|---|---|---|---|
| `employees.managerEmployeeId` | **A person.** Relational — the command validates the referenced employee exists and refuses a self-manager | **Admin UI display only** — `UserDetail.jsx:79,258-262`, `UserEditPanel.jsx:172-175`, `employeeProfile.js:84`, `metadata/definitions/employee.js:225`. **No authorization, workflow, escalation or ownership path reads it** | **Not** `employee-foundation.md`. It arrived via `docs/specifications/administration-users-consolidation.md:204-209`, where it is listed among fields that are "All nullable, all backward compatible, **none backfilled**" |
| `access/roleHierarchy.ts` + `access/hierarchicalVisibility.ts` | **A role position.** "Role is the hierarchy levels" (Owner model, 2026-08-19) | Hierarchical **visibility** scoping, consumed by `governedBusinessRoles.ts` TEAM scopes | Owner model, 2026-08-19 |

`roleHierarchy.ts:9-20` states the conflict against itself, verbatim:

> *"So the tree lives here, with the Role definitions, rather than as a `reportsTo` field maintained
> per employee. An employee's position is derived from the Role they hold. The Owner named
> `reportsTo` on the employee as a **NICE TO HAVE** … It is deliberately not modelled yet, and its
> absence has one consequence worth stating plainly: **With role-only hierarchy, EVERY salesManager
> sees EVERY salesperson.** That is identical to the described behaviour while one manager per branch
> exists, and diverges the moment a second is appointed."*

**The two are conflated in opposite directions and nothing reconciles them.** One derives the manager
relationship from role and yields a **set** ("every sales manager"); the other stores a specific
**person** and is nullable, unbackfilled, and read only for display. `roleHierarchy.ts` is explicit
that the per-employee field is the *unbuilt* refinement — while that field now exists, unread.

**Consequence for this lane, and it is decisive.** Questions 14 and 15 — *does manager intervention
change accountability / record ownership?* — presuppose a resolvable manager. **EOS cannot resolve
one unambiguously.** "Escalate to the manager" evaluates to either *every manager of that branch* or
*null*. A second escalation tier addressed to "the manager" is therefore **not expressible today**,
independently of the fact that no escalation mechanism exists at all. Correctly noted by
`roleHierarchy.ts` as a visibility limitation; for accountability it is a **MODEL GAP**, because
accountability requires exactly one identifiable person and role-derived hierarchy structurally
cannot supply one. → **OD-EMP-005**

`roleHierarchy.ts:22-25` also draws the separation this lane must preserve: *"This is visibility, not
capability. Being above someone does not confer what they can DO … authority comes from the Role's
permissions, reach comes from position."* **Accountability is a third thing again, and it is neither.**

### 1.2 There is no job-role vocabulary that could carry accountability

Cross-lane input from **EMP-ROLE**: five disjoint vocabularies exist with **no mapping** between them.
Spot-checked here for the values this lane depends on. `OBSERVED AT: 64008d5a`

| Vocabulary | Values | Could it name an accountable party? |
|---|---|---|
| `employees.jobTitle` | **free text**, bounded and trimmed only | No — unqueryable, no referential integrity |
| `employees.operationalRoles[]` | 8 enum values | **Partly — and not for managers**: see below |
| Security Roles | **48** (45 governed + `admin`/`dispatcher`/`technician` from `compatibilityRoles.ts`); `admin` holds all 147 capabilities by construction, `owner` derives from `ADMIN_ROLE` | No — these are *authority*, and the brief's rulings correctly keep SECURITY ROLE distinct |
| `roleHierarchy.ts` role ids | org-chart positions | No — a position, not a person |
| Corpus `role` / `actor_role` | 8 (P3B1, snake_case) · 14 (P3B2, Title Case) · 18 (P3B3) — **three incompatible spellings of the same idea** | No — descriptive prose |

**The finding that matters most.** Of the 8 `operationalRoles` values, **`SERVICE_MANAGER`,
`SALES_MANAGER` and `SALES_ASSOCIATE` appear only in their own enum declaration
(`employeeProfileCommands.ts:137-139`), a display-label list (`employeeVocabulary.js:73-75`), and a
policy seed snapshot.** No authorization check, capability gate, Rules clause or workflow reads any of
the three. `employeeVocabulary.js:22` records the symptom in passing: a value *"has no label and no
place in this enum's declared value set."*

**`SERVICE_MANAGER` is the exact role the Owner's worked example names as the Work Order accountable
person, and it is a label with no consumer.** `SALES_MANAGER` — the natural first escalation for the
commercial chain — is the same. So the Owner's worked example fails on this axis too: not only is
there no accountability *field*, there is no *role value* with any behaviour behind it to point one at.

**Therefore: "who is accountable" cannot currently be expressed as a job role at all** — only as a
specific person, as a security Role (which the rulings forbid conflating), or as free text. Wherever
this lane's model needs a role to carry accountability, the answer is **MODEL GAP**, and the
least-bad existing carrier is `operationalRoles` — but only after the three dead values acquire
consumers. → **OD-EMP-007**

### 1.3 Capability removal has no proficiency counterpart

Cross-lane input from **EMP-ROLE**. Corpus **P3B1-S17-A06** — a technician completing a job requiring
a certification he does not hold — records the expected result as **"Nothing warns."**
`employee-foundation.md` puts **Skills** and **Certifications** explicitly out of scope.

This matters to §6: the unavailability matrix has a **CAPABILITY REMOVAL** row because capability is
modelled, and it has no proficiency row because proficiency is not. A person can therefore be
*authorized* and *unqualified* simultaneously, and the accountability model would report a properly
accountable person for work they cannot competently discharge. **MODEL GAP**, and one that makes
"exactly one accountable person" a necessary but insufficient condition. → **OD-EMP-008**

### The Owner's worked example, tested against evidence

The Owner's example asserts five potentially-different people. `OBSERVED AT: 64008d5a`

| Owner's role | Can EOS name this person today? | Evidence |
|---|---|---|
| Account owner = salesperson responsible for the commercial relationship | **YES** | `accountOwner.assignedToEmployeeId`, PERSON/USER, HANDOFF |
| Work Order accountable person = service coordinator/manager responsible for the outcome | **NO** | `workOrder` is `ownerClass: COMPANY`, `ownerFields: []` — measured 0/30 |
| Service Visit assignee = technician performing it | **YES** | `assignedTechId` |
| Parts task assignee = whoever pulls or orders the part | **PARTLY** | `reorder_requests.assignedToUserId` + `currentOwner` role queue; `reorderRequest.ownerFields: []` |
| Escalation owner = manager when execution cannot proceed | **NO** | no escalation concept exists |

**The worked example is a correct statement of the business and EOS can express two of its five
roles.** The example is therefore *evidence of the gap*, not a model to adopt on faith — and its
two unrepresentable roles are exactly concepts 2 and 5 above.

---

## 2. The eighteen questions, per major object

Seven distinct accountability patterns cover all 51 families. Each block answers all eighteen.
`MODEL GAP` = the business needs it and EOS has no concept. `ENGINEERING GAP` = the concept exists
but is unenforced. `AUTHORITY GAP` = nobody is empowered to decide. `WORKFLOW GAP` = no path exists.
`OBSERVED AT: 64008d5a` throughout.

### 2.1 ACCOUNT — the root of the person-owned chain (ruling D-4)

| # | Question | Answer |
|---|---|---|
| 1 | Who owns the record? | The salesperson in `accountOwner.assignedToEmployeeId` |
| 2 | What does "owner" mean here? | Commercial relationship responsibility — the Owner's worked example holds exactly |
| 3 | PERSON / COMPANY / PARTICIPATING / REFERENCE / none? | **PERSON** (`ownerType: USER`), `companyScope: COMPANY_NEUTRAL` — an Account is deliberately **not** company-scoped |
| 4 | Who is accountable for the outcome right now? | The same person. Account is the one family where owner and accountable person legitimately coincide |
| 5 | Who executes the current work? | N/A — an Account is a standing relationship, not a task. Execution lives on its children |
| 6 | Escalation owner? | **MODEL GAP** — none. `employees.managerEmployeeId` exists but no path reads it |
| 7 | Can all four differ? | Owner/accountable cannot differ (one field carries both). **MODEL GAP** |
| 8 | When is accountability established? | At explicit assignment. **Never at creation**: `backfillSource` says "explicit assignment only — ruling D-6 forbids inferring an Account owner from creator, territory, coverage, activity, sales history, or auth uid" |
| 9 | When may it change? | Any time, by explicit `OWNERSHIP_HANDOFF` (`transfer: HANDOFF`) |
| 10 | What constitutes acceptance of a handoff? | **Nothing. There is no acceptance concept.** `accountOwner` records `assignedBy*` + `assignedAt` — who *pushed* it, never whether the recipient took it (`commercialProfile.js:206-216`). **MODEL GAP** |
| 11 | Who remains accountable during an unaccepted handoff? | Unanswerable — the state does not exist. Transfer is instantaneous and single-sided |
| 12 | Intended recipient unavailable? | **Not checked.** No module in `functions/src/ownership/` reads `employmentStatus`; handoff to a `TERMINATED` employee is accepted. `record-ownership.md` §2 *requires* an active-employee check ("reassigning to a departed employee orphans the record silently, which is how ownership models rot"); `buildOwnershipHandoff` is pure and performs none. **ENGINEERING GAP** |
| 13 | Work overdue? | N/A for the Account itself |
| 14 | Does manager intervention change accountability? | **MODEL GAP** — no manager intervention concept, **and no resolvable manager** (§1.1) |
| 15 | Does manager intervention change record ownership? | Only via `ADMIN_CORRECTION`, one of three `OWNERSHIP_HANDOFF_SOURCES`. Correctly an audited handoff, not an implicit takeover |
| 16 | Does reassignment change ownership? | No. Ruling preserved: reassignment of work ≠ ownership transfer |
| 17 | What remains historical after transfer? | The `OWNERSHIP_HANDOFF` audit event (from, to, actor, source, optional reason). **The Account document retains no prior-owner history** — `accountOwner` is overwritten; history lives only in the immutable trail |
| 18 | What governs future records? | Children created after the handoff inherit the **new** owner (`inheritanceSource: "parent Account owner at creation"`). Existing children **do not move** — the non-cascade ruling |

**Contradiction found, and it matters.** `record-ownership.md` §4 states derivative ownership means
"reassigning an Account moves its Contacts and Locations with it, **immediately and silently**", and
its acceptance criterion 7 requires it. The ratified matrix states the opposite: Contact/Location
carry their **own** `owner` field, inherit only **at creation**, and "does **not** follow the
Account". `ownershipHandoffCommand.ts` enforces no-cascade structurally (no list input, no children
flag). **The matrix and the handoff command are the later, ratified authority; the spec's §4 and
AC-7 are superseded and should be marked so.** → **OD-OWN-004**

### 2.2 CONTACT / LOCATION — derivative person-owned

| # | Answer |
|---|---|
| 1–3 | **PERSON** (`USER`), own `owner` field; inherit parent Account owner **at creation only** |
| 4 | The inheriting employee — but inheritance is a **one-time snapshot**, so after an Account handoff the child's accountable person is the **former** Account owner until separately moved |
| 5 | N/A | 
| 6 | **MODEL GAP** |
| 7 | Owner and accountable coincide |
| 8 | At creation, from the parent |
| 9 | Explicit `HANDOFF` |
| 10–12 | As §2.1 — no acceptance, no availability check |
| 13 | N/A |
| 14–16 | As §2.1 |
| 17 | Audit event only |
| 18 | Nothing downstream |
| — | **Measured: `contacts` 0/339 owned, `locations` 0/183 owned** — "no ownership storage yet". Backfill is derivable (`accountId`) but **gated**, and 5 records (2 contacts, 3 locations) stay blocked because their parent is an R-7 control Account |

### 2.3 OPPORTUNITY / SALES AGREEMENT / SALES ORDER — the commercial chain

| # | Question | Answer |
|---|---|---|
| 1–3 | Owner, meaning, type | `ownerEmployeeId`, **PERSON/USER**. Sales responsibility. Plus an **orthogonal** `companyScopeField: operatingCompanyId` |
| 4 | Accountable now? | The owner. The three families are the model's **best case** — measured **14/14, 5/5, 17/17 RESOLVED** |
| 5 | Executor? | Distinct for Sales Order fulfilment (warehouse, dispatch, technician) — **and unrepresented**. The Sales Order names the salesperson, never who must ship it |
| 6 | Escalation owner? | **MODEL GAP.** `WF-SLS-005` records an approval-threshold seam as unbuilt: "no history, no list, no schedule, no template and **no approval threshold**" |
| 7 | Can all four differ? | Owner and accountable cannot; assignee is not modelled |
| 8 | Established when? | At creation, by `resolveCreationOwner`: **EXPLICIT → INHERIT GOVERNED UPSTREAM → REFUSE** |
| 9 | May change when? | Explicit `HANDOFF` |
| 10–12 | Acceptance / unaccepted / unavailable | No acceptance state; no availability check. As §2.1 |
| 13 | Overdue? | **MODEL GAP** — no ageing, no SLA, no stagnation owner. 0 of 86 workflows mention overdue, SLA or timeout |
| 14–16 | Manager / reassignment | `ADMIN_CORRECTION` only; reassignment ≠ ownership |
| 17 | Historical | Audit event; `ownerEmployeeId` overwritten |
| 18 | Future records | Downstream records created later inherit the **new** owner; existing ones do not move |

**The creation rule is exactly right and worth preserving verbatim.** `creationOwnerResolution.ts`
refuses six named fallbacks — actor, `createdBy`, authenticated user, `assignedTo`, an arbitrary
salesperson, an admin, the first available employee — with the assistant case stated in the source:
*"Customer owner = Rudy. An assistant calls createOpportunity with no ownerEmployeeId. Result:
owner = Rudy, createdBy = the assistant."* **The brief's ruling "an assistant creating a record does
not acquire ownership by acting" is implemented, tested and correct.** It is the strongest part of
the model and the synthesizer should not weaken it.

**But the refusal has an accountability cost.** On the measured sandbox (0/103 Accounts owned), a
`createOpportunity` with no explicit owner **REFUSES for every Account**. That is the designed,
honest behaviour — and it means the model's answer to "the root has no owner" is *to block new work*
rather than to name a responsible party. Refusing to create is safe for data and unsafe for the
business, and no rule says who must then fix the root. → **OD-EMP-002**

### 2.4 WORK ORDER — the actionable item the invariant cares most about

| # | Question | Answer |
|---|---|---|
| 1 | Who owns the record? | **An operating company** — and in storage, **nobody at all** |
| 2 | What does "owner" mean? | Which company's books and service obligation. Ruling D-13: "the responsible operating company owns the job; the technician performs it" |
| 3 | Type? | **COMPANY**. `fieldops_wos.ownerFields: []` — **measured 0/30, "the collection has no company storage at all"**. `fieldops_jobs` (legacy) genuinely stores `operatingCompanyId` |
| 4 | **Who is accountable for the outcome right now?** | **NOBODY.** A company is not a person; the matrix stores no person; `assignedTechId` is deliberately not an `ownerField`. This is the invariant failing at the single most operationally important object |
| 5 | Who executes? | `assignedTechId` (set only by `Dispatch`), planned via `scheduledTechId` |
| 6 | Escalation owner? | **MODEL GAP** — none |
| 7 | Can all four differ? | They *must* differ in the business (coordinator ≠ technician ≠ manager) and EOS represents only the technician |
| 8 | Established when? | Company: "explicit at creation, or a governed upstream source that already carries one (e.g. a Sales Order)" — `backfillSource: null`. Accountability: **never** |
| 9 | May change when? | `transfer: HANDOFF` for the company. Assignment changes only at `Dispatch` |
| 10 | Acceptance of a handoff? | The technician lifecycle **has** an `Accept` action (`DISPATCHED → ACCEPTED`) — **the only acceptance semantics anywhere in EOS**. It accepts *the assignment*, not accountability, and no ownership handoff has an equivalent |
| 11 | Who remains accountable during an unaccepted handoff? | Between `Dispatch` and `Accept`, **nobody is named**. The dispatcher has acted; the technician has not agreed; no field records who holds the outcome in between |
| 12 | Recipient unavailable? | A double-booking guard refuses dispatch to a technician occupied on another Work Order (`transitionWorkOrder.ts:311-320`). **No `employmentStatus` check on dispatch.** Once past `Dispatch`, unavailability is unrecoverable — see §7 |
| 13 | Overdue? | `detectStalledJobs` exists but `WF-SVC-017` records it returns only HIGH and CRITICAL, and "a Work Order with an unusable `createdAt` scores 0 on both the age and stagnation factors, falls to LOW … [and] is dropped from the At-risk table entirely" — **the least-known Work Order is the one the control tower cannot see** |
| 14 | Manager intervention → accountability? | **MODEL GAP** |
| 15 | Manager intervention → record ownership? | No (company ownership is unaffected by dispatch acts) — correctly |
| 16 | Reassignment → ownership? | No. `Dispatch` to a technician other than `scheduledTechId` requires a `reassignReason` and is separately audited (H20) — **a genuinely good pattern, and the only audited person-change in the platform** |
| 17 | Historical after transfer? | **`WF-SVC-011` — "the transfer EOS cannot express": "Reassignment moves the assignment; the execution record does not follow, and the second technician arrives at a job whose history is attributed to someone else."** |
| 18 | Future records? | Nothing inherits from a Work Order |

### 2.5 REORDER REQUEST — the only role-queue custody in EOS

| # | Answer |
|---|---|
| 1–3 | **COMPANY**, `ownerFields: []`. Measured **0/6**, and **6/6 MISSING_REFERENCE** — "the record cannot say where", so it cannot even derive a company. Two mention `wh-main` in `reviewNotes` free text, **deliberately unused** (prose is display text) |
| 4 | Accountable now? | **A ROLE, not a person.** `currentOwner` ∈ `INVENTORY` / `PARTS_MANAGER` / `PARTS_ASSOCIATE` — enforced in ~15 `firestore.rules` clauses. Ruling: "workflow custody, not record ownership … **naming collision only**" |
| 5 | Executor? | `assignedToUserId`; `requestedBy` is the actor |
| 6 | Escalation owner? | **MODEL GAP** |
| 7 | Can all differ? | Yes — and here four axes genuinely coexist (`currentOwner` role queue, `assignedToUserId` processor, `requestedBy` actor, company owner). **This is the closest EOS gets to the Owner's five-role example, and it was built for one workflow only** |
| 8–9 | At creation / by governed transition | |
| 10 | Acceptance | None. A role queue is a **pull** model: work sits in `PARTS_ASSOCIATE` until somebody claims it |
| 11 | Unaccepted | **THE GAP, in its purest form: while `currentOwner` names a role and `assignedToUserId` is unset, the record is owned by a queue and accountable to nobody.** A role is not a person and cannot be asked why the next thing has not happened |
| 12 | Recipient unavailable | `startPurchasing` carries `requiresOwnAssignment: true` — the same freeze as the Work Order |
| 13 | Overdue | **MODEL GAP** — nothing ages a queue |
| 14–18 | As §2.4 | |

**The role-queue pattern is the honest one for pull-based work and it is not a substitute for
accountability.** A queue answers "where is this?"; it never answers "who must make the next thing
happen?" Both are needed, and EOS has the first for exactly one family.

### 2.6 FINANCIAL ARTIFACTS — invoices, payments, adjustments, refunds

| # | Answer |
|---|---|
| 1–3 | **COMPANY**, all five families `ownerFields: []`, `transfer: IMMUTABLE` |
| 4 | Accountable now? | Ruling D-15: "A ledger entry belongs to the books it lands in, not to the salesperson upstream … Accounting ownership and sales credit are different questions and must not share one field." **This lane agrees for *ownership* and records that it leaves *collections accountability* unassigned** — `WF-FIN-005` "Chase what is owed" has actors but no accountable party |
| 5 | Executor | Unmodelled |
| 6 | Escalation | **MODEL GAP**, and explicitly so: `FinancialsGovernance.jsx` and three sibling surfaces state FIN-007 approval policy — "thresholds, approver roles, dual-control, escalation, expiry — is not configured; the mechanism fails closed rather than inventing a policy" |
| 7 | Can differ | Yes, and only the company is stored |
| 8 | At issue | |
| 9 | **Never** — `IMMUTABLE`. `buildOwnershipHandoff` refuses with `FAMILY_IMMUTABLE` |
| 10–12 | No handoff exists to accept or refuse | |
| 13 | Overdue | AR aging exists as a workflow; no accountable party |
| 14–16 | A manager cannot move a financial record's owner at all. **Risk already recorded in the reconciliation:** "A mis-owned historical invoice then has no legal path to correction. If the Owner wants one, it must be a named, audited exception rather than an implicit edit." → **OD-OWN-003** |
| 17 | Everything — that is the point of `IMMUTABLE` |
| 18 | Nothing |

### 2.7 COMPANY ASSETS and REFERENCE data — the steward question

| Family group | Class | Who is the steward? |
|---|---|---|
| `equipment`, `trucks`, `warehouses`, `mobile_locations`, `stock_locations`, inventory events, POs | COMPANY (20 families) | **A company, never a person.** The invariant's "responsible steward (person or role)" for master data is **unrepresented**: no `stewardEmployeeId`, no domain-owner role assignment |
| `parts`, `part_aliases`, `part_supplier_items`, `manufacturers`, `equipment_models`, `supplier_catalog`, `suppliers` | REFERENCE (7) | **Nobody.** `ownerType: null`, `transfer: N_A`, `unresolvedPolicy: "not ownable — excluded from the invariant by classification, not by omission"` |
| `transfer_orders` | PARTICIPATING_COMPANIES (1) | Two named participants, deliberately no single owner (ruling Q3) |
| identity / access / audit / coverage / infra | EXCLUDED (17) | Out of the model by classification |

**The REFERENCE classification is correct and incomplete.** Ruling D-11's question — "Can Taylor and
Ventana both legitimately use the same record?" — correctly establishes that a part has no *owning
company*. It does **not** establish that a part has no *responsible steward*. Somebody must maintain
the part catalog, and `inventoryCatalogAdministrator` exists as a capability while no record names a
person accountable for catalog correctness. For the **18 questions the answers are: Q1–Q3 REFERENCE /
none; Q4 MODEL GAP (steward); Q5–Q18 N/A or MODEL GAP.** The invariant explicitly requires a steward
for exactly these objects, so REFERENCE as currently defined **does not satisfy the invariant** — it
exempts the object from *ownership*, which is a different statement. → **OD-OWN-001**

---

## 3. The activity corpus — measured

Re-derived at baseline. The corpus is **not** one file; it is three vocabularies across three
worktrees, which is itself a finding. `OBSERVED AT: 64008d5a`

| Lane | Path | Activities | Coverage vocabulary |
|---|---|---|---|
| P3-B1 service | `p3b1-act-service/docs/scenarios/day-in-the-life/service-technician.json` | 330 | camelCase — `coverageCategories`, `exceptionRecoveryBehaviour` |
| P3-B2 inventory | `p3b2-act-inventory/docs/scenarios/day-in-the-life/inventory-warehouse-purchasing.json` | 330 | snake_case — `coverage`, `exception_recovery_behaviour` |
| P3-B3 sales/CRM/fin/admin | `p3b3-act-sales/docs/activities/p3b3-{administration,adversarial,crm,financial,management,sales}-activities.json` | 350 | **neither field** — `actor_role`, `owner_question`, `status`, `blocking_mechanism` |
| **Total** | | **1,010** | 3 incompatible schemas |

**`HANDOFF` coverage: 53 activities — denominator 660, not 1,010** (34 service, 19 inventory).
`EXCEPTION` 163 · `RECOVERY` 55 · `PERMISSION_DENIAL` 69 · `CROSS_COMPANY` 70.

**State the denominator, every time.** P3-B3 — **350 rows, 34.7% of the corpus** — carries no coverage
tags, no device, no friction scores and no operating company. So **sales, CRM, finance and
administration contribute zero handoff evidence**, and every handoff- and friction-derived figure in
this document covers **660 rows**. Cross-lane confirmation from **EMP-WORK**.

**That silence is a measurement gap, not evidence of smooth handoffs.** The four domains that
contribute nothing to the 53 are precisely the ones whose handoffs this lane found most exposed —
ORPHAN-5 (the fulfilment step belonging to nobody) and the AR/collections and financial-correction rows
of §5 all sit in the untagged third. Any reader comparing "53 handoffs" against "86 workflows" would
conclude commercial handoffs are unproblematic; the correct conclusion is that they were never
measured.

### The corpus already scores the gap this lane exists to name

P3B1/P3B2 carry `frictionScore.ownershipUnclear` / `scores.ownership_unclear` and
`roleHandoffUnclear` / `role_handoff_unclear`:

| Flag | Count / 660 tagged | Share |
|---|---|---|
| `ownershipUnclear` = true | **166** | **25%** |
| `roleHandoffUnclear` = true | **90** | **14%** |

**One activity in four is flagged as having unclear accountability, by the corpus's own authors,
independently of this lane.** That is the strongest available corroboration that the gap is real and
pervasive rather than an artifact of this analysis.

### `exception_recovery_behaviour` is prose, not a vocabulary

660 activities carry it; **594 of 660 values are unique**. The only repeats are the absence markers
`"None."` (34), `"n/a."` (32), `"None needed."` (2), `"None - nothing refuses."` (2). **There is no
controlled recovery vocabulary** — so recovery behaviour cannot be queried, aggregated, or asserted
against. → **OD-EMP-006**

### What the corpus proves about the vocabulary EOS lacks

Keyword counts over all 1,010 activities. `OBSERVED AT: 64008d5a`

| Term | Hits | Reading |
|---|---|---|
| `accept` / acceptance | 107 | acceptance is a **pervasive business concept** |
| reject | 40 | |
| override | 27 | but **"manager override" as an exact phrase: 0** |
| escalation / escalate | 13 | thirteen times in a thousand activities, always as *"the escalation target must be stated"* — i.e. as a **missing** thing |
| reassign | 12 | |
| deactivated | 2 | |
| **vacation** | **1** | a single activity models the most common real-world unavailability |
| delegate | 1 | and in the sense of *not* delegating |
| **takeover · unassigned · out of office · terminated** | **0 each** | **the vocabulary of departure and takeover does not exist in the corpus at all** |

The asymmetry is the finding: **acceptance is everywhere in the business and nowhere in EOS;
departure is nowhere in either.** Acceptance is a MODEL GAP against abundant evidence. Departure is a
**MISSING INPUT** — the corpus cannot settle it because the business never described it.

---

## 4. Continuity model per workflow

Three models. **A** = accountability changes immediately on assignment · **B** = the current
accountable person remains accountable until the recipient **accepts** · **C** = accountability stays
with the process/role owner while execution assignment changes. Chosen from evidence, never for
technical convenience. Every row must still guarantee accountability ≠ nobody.

| Workflow | Model | Justification from evidence | Guarantee holds today? |
|---|---|---|---|
| **Account ownership** (WF-CRM-001) | **A** | A commercial relationship has one responsible salesperson and the handoff is a management act, not a negotiation. `accountOwner` records `assignedBy*` — a push, which is model A's shape | **No** — handoff to a non-`ACTIVE` employee is unchecked |
| **Contact / Location** | **A**, derived | They are the customer's people and places; they follow whoever owns the relationship at creation | **No** — inherits the same unchecked handoff |
| **Opportunity → Agreement → Sales Order** | **A** | Sales ownership is singular and continuous; `resolveCreationOwner` already implements A with a refusal instead of a guess | **No** — same |
| **Sales Order fulfilment** (WF-SLS-003, WF-XD-001) | **C** | The salesperson stays accountable for the commercial outcome while allocation, picking and shipping are assigned elsewhere. Corpus **P3B3-ADV-015**: *"The order-to-cash chain therefore has a step in the middle that belongs to nobody in the governed model."* | **No** — the process owner for fulfilment is unnamed |
| **Work Order intake → ready → scheduled** (WF-SVC-001/002/003) | **C** | Service coordination is a desk, not a person-to-person handoff; the coordinator/service manager stays accountable while the job moves through the queue. This is the Owner's worked example exactly | **No** — no accountable-person field; corpus **P3B1-S24-A03**: *"A WO in CREATED for three weeks means nobody marked it ready, and nothing records who was supposed to."* |
| **Dispatch → Accept** (WF-SVC-005, WF-SVC-007) | **B** | **The only workflow where evidence positively demands B.** `Accept` exists as a real transition, and corpus **P3B1-S08-A09** treats non-acceptance as a signal: *"An unaccepted dispatch is the earliest signal that a technician's day has gone wrong."* Under B the dispatcher remains accountable until Accept | **No** — the state exists but nobody is named as holding it; recovery is *"The dispatcher phones."* |
| **Technician execution** (Accept→Complete) | **A** | Once accepted, the technician is accountable for the visit. Correct, and `requiresOwnAssignment` enforces it | **No** — and A here is **unsafe without an exit**: §7 |
| **Mid-day technician handover** (WF-SVC-011) | **B** | A partially-done job must not become nobody's; the first technician holds until the second accepts | **Impossible** — registry: *"the transfer EOS cannot express"* |
| **Reorder request** (WF-INV-006) | **C** then **B** | `currentOwner` role queue is textbook C. The claim step (`assignedToUserId`) should be B — a pull, which is acceptance | **No** — corpus **S03-A10**: *"Ownership by ROLE with no assignee is the classic 'everyone's job is nobody's job' state."* |
| **Receiving → put-away** (WF-INV-001/002) | **C** | Warehouse process ownership; the scanner operator is an executor | **No** — corpus **S08-A05**: *"The warehouse receipts the goods but nobody closes the request. Ray emails Dwayne. That is the current integration."* |
| **Transfer order in transit** (WF-INV-009) | **B**, two-sided | Custody genuinely transfers on receipt; source stays accountable until destination accepts. The `PARTICIPATING_COMPANIES` shape is already the two-participant insight at company level | **No** — corpus **S25-A05**: goods are *"off WH-PHX-MAIN's books, **on nobody's books**, and attached to no open transfer — the most completely lost stock any of these stories produces."* |
| **Cycle count sheet** | **C** | An open sheet belongs to the inventory-control process | **No** — corpus **S31-A08**: *"If nobody picks it up, the sheet sits open indefinitely."* |
| **Invoice / payment / AR collections** (WF-FIN-001/003/005) | **C** | Accounting process ownership; ruling D-15 correctly separates it from sales credit | **No** — no process owner named |
| **Financial correction** (WF-FIN-004) | **C** + approval | An `IMMUTABLE` record's correction needs a named approver | **No** — FIN-007 approval policy unconfigured by design |
| **Reference / catalog maintenance** (WF-INV-012, WF-EQP-005) | **C** (steward) | Master data has a steward, not an owner. REFERENCE class correctly removes *ownership* and leaves *stewardship* unassigned | **No** — §2.7 |
| **Employee deactivation** (WF-XD-006) | **B** mandatory | Nothing may be released until a successor accepts | **No** — corpus **S15-A05**: *"deactivation releases NOTHING. P1 has no release command at all."* |

**Summary: 16 workflows, 3 continuity models genuinely required (A×5, B×5, C×8, two hybrid), and
the guarantee "accountability ≠ nobody" holds in 0 of 16.** Model **B is required by five workflows
and is representable in none** — there is no acceptance state anywhere in the ownership model.

---

## 5. Escalation — per actionable workflow

**EOS has no escalation concept.** Verified by exhaustive search of `functions/src` and
`field-ops-app-vite/src`: every hit for "escalat*" is one of (a) *privilege*-escalation security
prose, (b) FIN-007 approval policy recorded as **unconfigured**, (c) statements that something is
**not** escalated (`workOrderAttentionProjection.js:179`, `performanceMetricRegistry.ts:253`,
`MyDashboard.jsx:260`). **No escalation owner, no escalation target, no trigger, no timer, no
approval chain exists in any business path.** `OBSERVED AT: 64008d5a`

The table below is therefore the **business requirement**, with the EOS status of each cell. It is
not a field proposal. `—` = no storage and no concept.

| Workflow | Normal accountable | Assignee | 1st escalation | 2nd escalation / manager | Trigger | Time or condition | What changes | What does NOT change |
|---|---|---|---|---|---|---|---|---|
| Inbound work → decision | Service coordinator (**—**) | Coordinator | Service manager (**—**) | Ops manager (**—**) | Row undecided | End of shift | **MISSING INPUT** | Record ownership; company |
| Dispatch not accepted | Dispatcher (**—**) | Technician (`assignedTechId`) | Dispatcher re-dispatch (**blocked** past `DISPATCHED`) | Service manager (**—**) | No `Accept` | Corpus P3B1-S08-A09 uses **40 minutes**; no rule stores it | Notify → then reassign | Company ownership; the execution record already written |
| Technician unavailable mid-job | Technician | Technician | Dispatcher (**—**) | Service manager (**—**) | Sick / no-show / deactivated | Immediate | **Nothing can change: only `Cancel` is reachable** (§7) | Everything, destructively |
| Work Order aged open | **—** | — | **—** | **—** | Age / stagnation | `detectStalledJobs` surfaces HIGH/CRITICAL only | — | — |
| Emergency after hours | After-hours coordinator (**—**) | Technician | — | — | Emergency received | Corpus **P3B1-S22-A05**: *"An emergency emailed at 18:30 waits until 06:40, and nothing escalates it regardless of content."* | — | — |
| Reorder request unclaimed | `currentOwner` **role** | `assignedToUserId` | Parts manager (**—**) | Ops manager (**—**) | No claim | Corpus **S04-A04**: *"The order misses the cut-off."* | **No reassignment branch exists in Rules** | — |
| Purchasing blocked by absent assignee | Parts associate | Same | Parts manager | — | Assignee out | Corpus **S04-A02**: *"Dwayne is on vacation. The part is urgent."* | Desired-but-unbuilt: *"the assign screen warns when the chosen assignee will not be able to perform the next transition."* | — |
| Transfer in transit overdue | Source company | — | **—** | **—** | Not received | Corpus **S25-A01**: *"...missing from every number for six days and nobody has been told."* | — | — |
| Cycle-count variance beyond tolerance | Inventory control (**—**) | Counter | Controller (**—**) | — | Variance | Month end | Approval required | — |
| Financial correction above threshold | Accounting manager (**—**) | — | Controller (**—**) | Owner | Amount threshold | **FIN-007 unconfigured — fails closed** | Approval | `IMMUTABLE` ownership |
| Privileged role grant | Administrator | — | Second approver (**seam recorded, unbuilt**) | Owner | Privileged role | — | Dual control | — |
| Price above discount threshold | Salesperson | — | Sales manager (**—**) | — | Discount depth | **WF-SLS-005: "no approval threshold"** | Approval | Record ownership |
| Access refused, no self-service path | Requester | — | Corpus **S26-A02**: *"The escalation target is Sam Ortega (System Admin)."* | — | Refusal | Immediate | Corpus **S01-A09**: *"Escalation target must be stated."* | — |

**Every "manager" cell above is doubly unresolvable.** Beyond having no escalation mechanism (§5
preamble), EOS cannot say *which person* the manager is (§1.1) and cannot name the manager's job role
in a way anything reads (§1.2). `SERVICE_MANAGER` and `SALES_MANAGER` — the two values that would
carry the second tier of almost every row — have no consumer anywhere. A second escalation tier is
therefore blocked on three independent gaps, not one.

**Escalation modality.** The brief's five modalities — notify · add responsibility · transfer
accountability · require approval · block workflow — map onto the evidence as: **block workflow** is
the only one EOS implements (fail-closed refusals everywhere), **require approval** is designed and
unconfigured (FIN-007), and **notify / add responsibility / transfer accountability are absent.**
Because blocking is the only available modality, **every escalation in EOS today resolves to "the
work stops and a human telephones someone"** — corpus: *"The dispatcher phones"*, *"Ray emails
Dwayne. That is the current integration."* → **OD-EMP-003**

**The brief's caution is upheld by evidence: escalation must not transfer record ownership.** The
three `OWNERSHIP_HANDOFF_SOURCES` are `DIRECT_HANDOFF`, `CUSTOMER_HANDOFF_REVIEW`,
`ADMIN_CORRECTION` — **none is an escalation, and none is a departure**. An escalation routed through
`ADMIN_CORRECTION` would file a legitimate operational event as a data-entry fix, corrupting the
audit trail's meaning. → **OD-OWN-005**

---

## 6. Employee unavailability and departure

### 6.1 What EOS actually has

`employmentStatus` ∈ `ACTIVE` · `ON_LEAVE` · `INACTIVE` · `TERMINATED` · `RETIRED` · `CONTRACTOR`
(`employeeProfileCommands.ts:122-130`, mirrored in `employee-foundation.md` and
`field-ops-app-vite/src/domain/constants.js:38`). Plus `separationDate`, `managerEmployeeId`,
`operatingCompanyId`, `jobTitle`, `operationalRoles`. `OBSERVED AT: 64008d5a`

**Two independent, deliberately separate switches:**

| Switch | Owner | Effect |
|---|---|---|
| `employmentStatus` | `updateEmployeeProfile` | Business lifecycle. Non-`ACTIVE` → **every** operational capability fails closed (`operationalRoleContext.ts`, `adminCredentialCommands.ts`, `firestore.rules` `isActiveOperationalRole`) |
| Auth account enable/disable | `setUserStatus` (`trustedWriterCommands.ts`) | Account control. Bumps `accessVersion`, resyncs claims |

The source states the separation and its consequence explicitly: *"Employment Status IS editable here
and account status is NOT … **Terminating employment through this command switches nobody off, and
this file contains no code that could.**"* The separation is correct. **The uncovered case is the
third thing neither switch touches: the person's outstanding responsibilities.**

### 6.2 The nine states × seven consequences

**Every cell marked `NO CHANGE` is a place where responsibility silently persists on a person who
cannot discharge it.** `OBSERVED AT: 64008d5a`

| State | Owned records | Accountabilities | Assigned work | Approvals | Escalations | Future records | Historical records |
|---|---|---|---|---|---|---|---|
| **VACATION** | NO CHANGE — no vacation state exists (`ON_LEAVE` is the nearest and is a *status*, not a date range) | n/a — none exist | NO CHANGE; **executor frozen** if `requiresOwnAssignment` | NO CHANGE | n/a | NO CHANGE — keeps inheriting to an absent owner | NO CHANGE (correct) |
| **SICK / UNAVAILABLE** | NO CHANGE | n/a | **Mid-execution work becomes unrecoverable** (§7). Corpus **P3B1-S21-A09** | NO CHANGE | n/a | NO CHANGE | NO CHANGE (correct) |
| **ROLE CHANGE** | NO CHANGE | n/a | NO CHANGE | Changes with `operationalRoles` | n/a | NO CHANGE — a former salesperson keeps inheriting new Opportunities | NO CHANGE (correct) |
| **DEPARTMENT CHANGE** | NO CHANGE | n/a | NO CHANGE | NO CHANGE | n/a | NO CHANGE | NO CHANGE (correct) |
| **MANAGER CHANGE** | NO CHANGE (correct) | n/a | NO CHANGE | NO CHANGE | n/a — nothing reads `managerEmployeeId` | NO CHANGE | NO CHANGE (correct) |
| **ON_LEAVE** | NO CHANGE | n/a | **All capability revoked** | Revoked | n/a | NO CHANGE | NO CHANGE (correct) |
| **CAPABILITY REMOVAL** | NO CHANGE | n/a | Executor can no longer act | Revoked | n/a | NO CHANGE | NO CHANGE (correct) |
| **DEACTIVATION** | NO CHANGE | n/a | Stranded. Corpus **S15-A05**: *"deactivation releases NOTHING. P1 has no release command at all."* | Revoked | n/a | NO CHANGE | NO CHANGE (correct) |
| **TERMINATION / RESIGNATION / RETIREMENT** | **NO CHANGE — they remain the record owner forever** | n/a | **Stranded.** Registry `WF-XD-006`: *"Disabling the principal silently strands every Work Order assigned to them … nobody else can advance them … One administrative click can immobilise a day's field work with no warning."* | Revoked | n/a | **NO CHANGE — a terminated employee continues to be inherited as owner of every new Contact, Location, Opportunity, Agreement and Sales Order downstream of their Accounts** | NO CHANGE (correct) |

### 6.3 The two rules the brief gives, and how evidence divides them

| Brief's rule | Verdict |
|---|---|
| **"No actionable item may become orphaned."** | **VIOLATED**, structurally and at every one of the nine states |
| **"Do not mass-rewrite historical ownership."** | **HONOURED** — and honoured *by the same mechanism that causes the violation*. The non-cascade rule is the reason both facts are true |

**These two rules are not in tension, and the resolution is the model's key move:** the thing that
must be released on departure is **accountability**, not **record ownership**. Historical ownership
correctly stays put; the accountable person must move. **EOS cannot express this because it has no
accountability axis to move** — the two are the same field. Collapsing them is what forces an
unacceptable choice between orphaning work and rewriting history.

The **future-records** column is the sharpest consequence and the one most likely to be overlooked: a
`TERMINATED` employee who owns an Account is, by ruling D-4's inheritance chain, **the default owner
of records that do not yet exist.** Departure does not merely leave a backlog; it seeds new
orphans indefinitely. → **OD-EMP-001**

### 6.4 The pattern EOS already has — on the wrong axis

`warehouseRootCompanyAssignment.ts` ruling **R-20** implements exactly the asymmetry departure needs,
for **companies**:

> *"the validator (2A.1A) accepts INACTIVE in storage while this refuses it in assignment"*

An inactive company may **remain** an owner of record (history is preserved) but may **not be chosen**
as a new owner (no new obligations are created). `deriveCompanyOwner` honours it; `resolveOperatingCompany`
returns `INACTIVE` distinctly from `UNKNOWN`. **This is the correct semantics for a departed employee,
already designed, already tested, and applied only to the company axis.** The person axis has neither
half: no lifecycle check on assignment, and no lifecycle awareness in derivation. Stating this is the
deliverable; building it is not this lane's. → **OD-EMP-004**

---

## 7. Every workflow that can become responsibility-orphaned

Ordered by severity. Each is derived from the state machine or quoted from evidence, not inferred.

### ORPHAN-1 — Work Order past `Dispatch`: only destruction is reachable · **CRITICAL**

Derived from `functions/src/transitionEngine.ts`. `OBSERVED AT: 64008d5a`

```
TRANSITIONS (the whole state machine):
  DISPATCHED        -> [ACCEPTED,         CANCELLED]
  ACCEPTED          -> [EN_ROUTE,         CANCELLED]
  EN_ROUTE          -> [ARRIVED,          CANCELLED]
  ARRIVED           -> [WORK_IN_PROGRESS, CANCELLED]
  WORK_IN_PROGRESS  -> [COMPLETED,        CANCELLED]
```
```
ACTION_PERMISSIONS:
  Accept/Travel/Arrive/WorkStart/Complete -> roles:["technician"], requiresOwnAssignment: TRUE
  Cancel                                  -> roles:["admin","dispatcher"], requiresOwnAssignment: false
ACTION_ALLOWED_FROM:
  Unschedule -> ["SCHEDULED"]     // and nowhere else
```

The source states the closure deliberately: *"Once a technician has been dispatched the job is
committed, so DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS have **no way back**."*

**Therefore:** from any of five active statuses the only two exits are (a) the next forward step,
performable **solely by the assigned technician**, or (b) `CANCELLED`. When that technician becomes
unavailable, **EOS's only expressible response to a live customer commitment is to cancel the record
of it.** The work does not stop existing; only EOS's knowledge of it does.

Independently corroborated by the corpus — **P3B1-S21-A09**, *"Cover a technician who goes home sick
at 11:00 with four jobs outstanding"*: **"None of the four can be reassigned. All four must be
cancelled and recreated."** Defect: *"There is no bulk reassignment and no reassignment at all after
Dispatch."* And **P3B1-S21-A01/A02** exist solely to attempt it and fail.

**Compounding:** the double-booking guard (`transitionWorkOrder.ts:311-320`) refuses to dispatch a
technician who is *"actively assigned to another Work Order"*. An orphaned Work Order therefore
**permanently consumes its technician's dispatch capacity** — one orphan removes a person from the
schedulable pool until someone cancels it. Corpus **P3B1-S32-A02**: *"Clear a Work Order stuck in
DISPATCHED for six days … It blocks dispatch to a technician who no longer exists."*

**Classification: WORKFLOW GAP** (no in-flight reassignment edge) + **MODEL GAP** (no accountable
person to fall back to). The registry agrees: `WF-SVC-011` `blocking_mechanism: NO_CODE`.

### ORPHAN-2 — The unaccepted dispatch window · **HIGH**

Between `Dispatch` and `Accept` the dispatcher has acted and the technician has not agreed. **No
field names who holds the outcome.** Corpus **P3B1-S08-A09**: *"An unaccepted dispatch is the earliest
signal that a technician's day has gone wrong"*; recovery: *"The dispatcher phones."* Continuity
model **B** is required and unrepresentable. **MODEL GAP.**

### ORPHAN-3 — Role-queue custody with no assignee · **HIGH**

`reorder_requests.currentOwner` names `INVENTORY` / `PARTS_MANAGER` / `PARTS_ASSOCIATE` while
`assignedToUserId` is unset. Corpus **S03-A10**: *"Ownership by ROLE with no assignee is the classic
'everyone's job is nobody's job' state."* **S04-A01**: *"Turn a role's problem into a person's
problem."* And there is no way back: *"there is no branch from `ASSIGNED_TO_PARTS_ASSOCIATE` back to
`READY_FOR_PARTS_MANAGER`"* — so a mis-assignment is recoverable only by reassignment, which
**S04-A04** reports has *"NO reassignment branch in Rules"*. **MODEL GAP + WORKFLOW GAP.**

### ORPHAN-4 — Terminated employee as perpetual inheritance root · **HIGH**

§6.3. A departed Account owner remains the governed default owner of records not yet created.
**MODEL GAP.**

### ORPHAN-5 — Fulfilment step owned by no governed role · **HIGH**

Corpus **P3B3-ADV-015**, *"The role that books an order cannot move it and the role that can move it
never sees it"*: **"The order-to-cash chain therefore has a step in the middle that belongs to nobody
in the governed model."** Its `owner_question`: *"Which named job allocates stock against a booked
Sales Order, and which raises its service visit? … no governed business role holds either."*
**AUTHORITY GAP** — this one is not a missing field, it is a missing *role definition*.

### ORPHAN-6 — Goods on nobody's books · **HIGH**

Corpus **S25-A05**, cancelling a transfer after the van has left: *"the four motors are off
WH-PHX-MAIN's books, **on nobody's books**, and attached to no open transfer — the most completely
lost stock any of these stories produces."* Also **S25-A07/A08**: *"five sensors stranded on a truck
that nobody is driving … nobody will notice until Alma asks where her sensors are on Friday."*
`transfer_orders` is `PARTICIPATING_COMPANIES` with `transfer: N_A` and the handoff command refuses it
by design (`FAMILY_PARTICIPATING_COMPANIES`) — correctly, since this is transaction state. **But that
means no authority at all governs custody during transit.** **MODEL GAP.**

### ORPHAN-7 — Aged open work with no accountable party and no blocked-on field · **MEDIUM**

Corpus **P3B1-S24-A03**: *"A WO in CREATED for three weeks means nobody marked it ready, and nothing
records who was supposed to."* Defect: *"A Work Order has no owner and no blocked-on field, so an aged
open job cannot be explained or chased from the record."* Compounded by `WF-SVC-017`: the stalled-job
detector *"returns only HIGH and CRITICAL"* and a Work Order with an unusable `createdAt` *"is dropped
from the At-risk table entirely."* **MODEL GAP + ENGINEERING GAP.**

### ORPHAN-8 — Inbound work rows with no owner · **MEDIUM**

Corpus **P3B1-S01-A10**: *"With no owner field, the afternoon coordinator cannot tell a row nobody has
looked at from one someone is actively chasing."* Defect: *"No ownership on an inbound row: two
coordinators either both chase it or neither does."* `inbound_work_requests` **does not appear in the
51-family matrix at all** — it is neither ownable, REFERENCE, nor EXCLUDED. **MODEL GAP**, and a
matrix completeness gap the synthesizer should record. → **OD-OWN-002**

### ORPHAN-9 — Open cycle-count sheet across a shift boundary · **MEDIUM**

Corpus **S31-A08**: *"If nobody picks it up, the sheet sits open indefinitely and the stale expected
snapshots drift further from reality every day."* Also **S20-A01**: *"A receipt stuck in IN_PROGRESS
with no live session is the worst outcome, because nobody else can work it."* **MODEL GAP.**

### ORPHAN-10 — Receiving completed, request never closed · **MEDIUM**

Corpus **S08-A05**: *"The warehouse receipts the goods but nobody closes the request. Ray emails
Dwayne. That is the current integration."* **WORKFLOW GAP.**

### ORPHAN-11 — Departed employee's platform records · **LOW but instructive**

Corpus **P3B3-ADV-008**: *"A saved report survives its author's departure and keeps naming them as
owner … the person best placed to tidy a departed colleague's reports is the one role that cannot
[delete them]."* `reportDefinitions` is **EXCLUDED** from the matrix ("platform record with its own
private-by-owner model — do not disturb"). The exclusion is right for *ownership* and leaves a real
departure consequence ungoverned. **MODEL GAP** in the EXCLUDED boundary.

### ORPHAN-12 — Unattributable changes · **LOW, but it defeats accountability retroactively**

Corpus **P3B3-ADV-034** / **P3B3-CRM-028**: *"A customer's payment terms changed and nobody knows who
changed them"* / *"A credit limit changed and nobody knows who changed it"* — Account edits are raw
client writes producing no audit event, unlike governed employee edits. **→ OWN-E2E to prove the
write path; the model consequence is mine: accountability that cannot be reconstructed after the
fact is not accountability.** **ENGINEERING GAP.**

### ORPHAN-13 — "Which accounts have no owner?" is unanswerable · **HIGH, meta**

Corpus **P3B3-CRM-030**: *"A report that would answer 'which accounts have no owner' — the question
the whole commercial chain depends on — cannot be built."* Combined with the shape-only person
derivation (§0), **EOS can neither prevent, detect, nor report person-level responsibility gaps.**
**ENGINEERING GAP + MODEL GAP.**

**Count: 13 orphaning workflows. Zero of the 86 registry workflows are `WORKS_END_TO_END`.**

---

## 8. Where ownership is confused with assignment

The platform is mostly **very good** at this, and the exceptions are specific. `OBSERVED AT: 64008d5a`

| Place | Confusion | Verdict |
|---|---|---|
| `reorder_requests.currentOwner` | A **role queue** named `currentOwner`, adjacent to a real ownership model | **Naming collision only** — correctly identified in the reconciliation and deliberately not folded in. Keep, do not rename (Tier-2 Rules risk; `firestore.rules` is **hash-anchored to the live deploy**) |
| `record-ownership.md` §4 "Work Order — owned, open question" | Spec asks whether Work Orders are ownable, warns `scheduledTechId`/`assignedTechId` "are *assignment*, not ownership, and conflating them would be easy and wrong" | **Superseded and correct** — ruling D-13 answered COMPANY, and `assignedTechId` is deliberately excluded from `ownerFields` |
| Sales Order `ownerEmployeeId` vs fulfilment | The record names the salesperson and **nobody** who must ship it, so "owner" silently absorbs a question it does not answer | **REAL CONFUSION** — by omission. ORPHAN-5 |
| `truckRegistry.reassignDriver` / `setDriver` | A driver is an assignment; `trucks.operatingCompanyId` is ownership | **Correctly separated** |
| `accountOwner` 7-field map | Records `assignedTo*` / `assignedBy*` / `assignedAt` — **assignment vocabulary for an ownership fact** | **Vocabulary confusion, real consequence.** It is the platform's best-provenanced structure and it describes ownership in the language of assignment, which is why "who accepted it" was never asked |
| `requiresOwnAssignment` | Assignment used as **authorization** | **Correct as authorization, dangerous as accountability** — it makes the assignee the *only* possible actor, converting an assignment gap into a hard lock (ORPHAN-1) |
| `explicitTitleHolder` | Legal title vs record ownership | **Correctly separated** (ruling D-3), and the matrix says so explicitly to stop a future reader "reconciling" them |
| `sales_territories`, `commercial_coverage_assignments` | Coverage vs ownership | **Correctly separated and EXCLUDED** — "coverage is not ownership, credit, commission or security" |

**The one-line conclusion: EOS reliably distinguishes ownership from assignment, and has no third
term for accountability — so accountability gets read into whichever of the two is present.** On an
Account that is ownership (and works); on a Work Order it is assignment (and breaks).

---

## 9. Where company ownership is confused with employee accountability

The brief's ruling **"operating-company authority ≠ employee accountability"** is the one most at
risk, and evidence shows it has already been crossed once — for defensible reasons. `OBSERVED AT: 64008d5a`

| Place | What happened | Verdict |
|---|---|---|
| **Rulings D-13 / D-14** — `fieldops_jobs`, `fieldops_wos`, `reorder_requests` reclassified **PERSON → COMPANY** | Justified as "the responsible operating company owns the job; the technician performs it" | **Correct about ownership, and it silently vacated the accountability question.** Reclassifying away from PERSON removed the only person-shaped field these families had, and nothing replaced it. **This is the moment the invariant became unsatisfiable for service work** |
| **Ruling D-15** — financial artifacts **PERSON → COMPANY** | "A ledger entry belongs to the books it lands in, not to the salesperson upstream" | **Correct**, and explicitly preserves attribution via lineage. Same vacating effect for collections accountability (ORPHAN, WF-FIN-005) |
| `companyScopeField` on opportunity / agreement / salesOrder | The matrix guards the distinction **explicitly**: *"Do not interpret `operatingCompanyId` as replacing salesperson ownership … one record with two true, independent facts"* | **Exemplary.** This is the ruling correctly defended in code comments. The synthesizer should propagate this pattern, not the D-13 one |
| `employees.operatingCompanyId` | A person belongs to a company | Correct, and **not** an accountability statement |
| `warehouseRootCompanyAssignment` R-20 | Company lifecycle gates assignment but not storage | **Exemplary** — and the pattern the person axis needs (§6.4) |
| `equipment` owner vs `explicitTitleHolder` | A `CUSTOMER` may hold title without owning the internal record | **Correctly separated** (D-3) |

**The structural finding.** Of the 27 ownable families, **20 are COMPANY, 1 is PARTICIPATING_COMPANIES,
and 6 are PERSON — and all 6 PERSON families are commercial.** Every operational family
(service, inventory, purchasing, finance, physical) is owned by a company. **A company cannot be
asked why the next thing has not happened.** The ownership model is therefore, for operations, a
*books-and-records* model rather than an accountability model. That is a legitimate thing for it to
be — but it means **the invariant cannot be satisfied by the ownership model at all** and needs a
second, orthogonal axis, exactly as `companyScopeField` is orthogonal to `ownerEmployeeId`.

**The precedent for that second axis already exists in the file**, in the `companyScopeField` note:
one record, two true, independent facts. Accountability is a third.

---

## 10. Owner decisions

Numbered, with QUESTION · EVIDENCE · OPTIONS · CONSEQUENCE · RECOMMENDATION. A recommendation is
offered **only** where evidence supports one; otherwise the decision is left open by design. **This
lane does not answer these.**

### OD-EMP-001 — Does accountability exist as an axis distinct from ownership and assignment?

- **QUESTION.** EOS has RECORD OWNER and ASSIGNEE. The invariant requires a third fact: the one person
  who must make the next thing happen. Is accountability a distinct axis, or is one of the two
  existing axes intended to carry it?
- **EVIDENCE.** 20 of 27 ownable families are COMPANY-owned; all 6 PERSON families are commercial
  (`ownershipMatrix.ts`). `assignedTechId` is deliberately excluded from `ownerFields` (D-13).
  `workOrder.ownerFields: []`, measured 0/30. 166 of 660 tagged corpus activities carry
  `ownershipUnclear: true`. The `companyScopeField` note already establishes the precedent that one
  record may carry two true independent facts.
- **OPTIONS.** (a) A third axis, orthogonal to both, per family. (b) Reclassify operational families
  back to PERSON, reversing D-13/D-14/D-15. (c) Declare assignment to be accountability. (d) Accept
  that operational work has no accountable person and rely on process.
- **CONSEQUENCE.** (b) reopens ratified rulings and recreates the confusion D-13 fixed. (c) collapses
  the distinction the whole model rests on and makes every `requiresOwnAssignment` lock an
  accountability lock. (d) is the current state and contradicts the invariant.
- **RECOMMENDATION.** **(a)**, on the evidence that the platform already models orthogonal facts
  cleanly (`companyScopeField`, `explicitTitleHolder`, coverage-vs-ownership) and that every attempt
  to fold accountability into an existing axis is the thing the rulings forbid.

### OD-EMP-002 — When a governed upstream owner is absent, who must supply one?

- **QUESTION.** `resolveCreationOwner` REFUSES when nothing resolves. Correct — but who is responsible
  for curing the refusal, and within what time?
- **EVIDENCE.** Measured 0/103 sandbox Accounts owned; on that data every ownerless
  `createOpportunity` refuses. Corpus **P3B3-CRM-006**: *"An imported account has no owner and blocks
  opportunity creation."* **P3B3-CRM-025**: contacts *"stay ownerless until the upstream account is
  owned. Ownership propagates down, never sideways."*
- **OPTIONS.** (a) Name a standing steward per family who must resolve refusals. (b) Queue refusals to
  a named role. (c) Leave it to whoever hits the error.
- **CONSEQUENCE.** (c) is current: the refusal is correct and nobody is responsible for curing it, so
  the block persists until a person independently notices.
- **RECOMMENDATION.** None — this depends on org design this lane cannot see. **MISSING INPUT.**

### OD-EMP-003 — Which escalation modality is authorized, per workflow?

- **QUESTION.** May an escalation notify, add responsibility, transfer accountability, require
  approval, or block? The five are materially different systems.
- **EVIDENCE.** **Block** is the only modality EOS implements. **Approval** is designed and
  unconfigured (FIN-007, four surfaces). Notify / add / transfer are absent. Corpus records the
  workaround as human: *"The dispatcher phones"*, *"Ray emails Dwayne. That is the current
  integration."* Escalation appears 13 times in 1,010 activities, always as a missing target.
- **OPTIONS.** Per workflow, one or more of the five.
- **CONSEQUENCE.** Blocking alone converts every accountability gap into stopped work — which is safe
  for data and, per §7, destructive for service commitments.
- **RECOMMENDATION.** Decide per workflow, not globally; and note that **transfer accountability** is
  the only modality that actually discharges the invariant, so at least one workflow must have it.

### OD-EMP-004 — On departure, what is released and what is retained?

- **QUESTION.** When an employee becomes non-`ACTIVE`, which of their record ownership, accountability,
  assigned work, approvals and future-inheritance is released, and to whom?
- **EVIDENCE.** §6.2: every one of the nine states is `NO CHANGE` for owned records. `WF-XD-006`:
  *"Disabling the principal silently strands every Work Order assigned to them … One administrative
  click can immobilise a day's field work with no warning."* Corpus **S15-A05**: *"deactivation
  releases NOTHING. P1 has no release command at all."* The three `OWNERSHIP_HANDOFF_SOURCES` include
  no departure source. `record-ownership.md` open question 3 already flags this as *"the most likely
  way the model rots in practice."* Ruling **R-20** already implements the correct asymmetry for
  companies (accept INACTIVE in storage, refuse it in assignment).
- **OPTIONS.** (a) Release **accountability only**; record ownership and history untouched. (b)
  Transfer record ownership on departure. (c) Nothing automatic; a named role must clear the backlog.
- **CONSEQUENCE.** (b) violates "no implicit cascade of historical ownership" and "historical ownership
  remains historical". (c) is honest but needs the role named and, today, has no queue to work from
  because nothing can list a departed person's obligations (ORPHAN-13).
- **RECOMMENDATION.** **(a)**, extended by the R-20 pattern to the person axis: a non-`ACTIVE` employee
  may **remain** an owner of record and may **not be chosen** as a new owner or accountable person.
  This satisfies the invariant without rewriting one historical fact, and it reuses a pattern already
  ratified and tested on the company axis.

### OD-EMP-005 — Which manager authority is canonical?

- **QUESTION.** `employees.managerEmployeeId` (a person, display-only, nullable, unbackfilled) or
  `roleHierarchy.ts` (a role-derived set)? Escalation and questions 14/15 need one answer.
- **EVIDENCE.** §1.1, including `roleHierarchy.ts:9-20` verbatim: *"EVERY salesManager sees EVERY
  salesperson … diverges the moment a second is appointed."* `managerEmployeeId` is read by four UI/
  metadata sites and no authorization or workflow path.
- **OPTIONS.** (a) `managerEmployeeId` canonical for accountability; role hierarchy stays visibility-
  only. (b) Role hierarchy canonical; accept a set. (c) Both, for different purposes, explicitly mapped.
- **CONSEQUENCE.** (b) cannot yield exactly one person, so it cannot satisfy the invariant. (a) requires
  the field to be populated — it is nullable and **never backfilled**, so today it would resolve to
  null for most employees.
- **RECOMMENDATION.** **(a) for accountability and escalation, (b) retained unchanged for visibility** —
  the separation `roleHierarchy.ts:22-25` already draws. Note this makes populating
  `managerEmployeeId` a prerequisite, not a nicety.

### OD-EMP-006 — Should recovery behaviour be a controlled vocabulary?

- **QUESTION.** `exception_recovery_behaviour` is authored prose: 594 of 660 values unique. Should
  recovery be classified?
- **EVIDENCE.** §3. Also three incompatible corpus schemas (camelCase / snake_case / neither).
- **CONSEQUENCE.** Recovery behaviour cannot be queried, aggregated, or asserted against in tests, so
  "every actionable workflow has a recovery path" is not a checkable statement.
- **RECOMMENDATION.** Yes for the **accountability-relevant** subset only — who recovers, not how.
  Classifying the prose wholesale would discard the detail that makes it useful.

### OD-EMP-007 — Which vocabulary may carry an accountable role?

- **QUESTION.** Five disjoint vocabularies, no mapping. Which one names an accountable party?
- **EVIDENCE.** §1.2. `jobTitle` is free text; `SERVICE_MANAGER` / `SALES_MANAGER` /
  `SALES_ASSOCIATE` have no consumer; security Roles (48) are authority and must stay distinct; corpus
  role names exist in three spellings.
- **OPTIONS.** (a) `operationalRoles`, after the dead values acquire consumers. (b) A new governed
  job-role authority. (c) Name persons only, never roles.
- **CONSEQUENCE.** (c) makes every departure an orphaning event by construction, since a person-only
  model has nothing to fall back to.
- **RECOMMENDATION.** **(a)** as the least-bad existing carrier — but the decision belongs with
  EMP-ROLE and the Owner, not this lane.

### OD-EMP-008 — Does accountability require proficiency?

- **QUESTION.** Must an accountable person be *qualified*, not merely authorized?
- **EVIDENCE.** §1.3. Corpus **P3B1-S17-A06**: expected result **"Nothing warns."** Skills and
  Certifications are explicitly out of scope in `employee-foundation.md`.
- **CONSEQUENCE.** "Exactly one accountable person" can be satisfied by someone who cannot do the work.
- **RECOMMENDATION.** None — this is org/HR design. **MISSING INPUT.**

### OD-OWN-001 — Does REFERENCE data need a steward?

- **QUESTION.** The invariant requires a *responsible steward* for non-actionable master data. The 7
  REFERENCE families have `ownerType: null`, `transfer: N_A`, and no steward.
- **EVIDENCE.** §2.7. Ruling D-11 establishes only that a part has no owning *company*.
  `inventoryCatalogAdministrator` exists as a capability while no record names a person accountable for
  catalog correctness.
- **OPTIONS.** (a) A steward per REFERENCE family. (b) Domain-level stewardship, not per record. (c)
  Declare REFERENCE data exempt from the invariant entirely.
- **CONSEQUENCE.** (c) is a narrowing of the invariant the Owner stated and should be explicit if chosen.
- **RECOMMENDATION.** **(b)** — per-record stewardship of 52 parts is administrative overhead with no
  business question behind it; per-domain stewardship answers "who maintains the catalog?" which is the
  question actually asked.

### OD-OWN-002 — Is `inbound_work_requests` in the ownership model?

- **QUESTION.** It is absent from all 51 matrix families — neither ownable, REFERENCE, nor EXCLUDED.
- **EVIDENCE.** `ownershipMatrix.ts` (51 families, enumerated §1). Corpus **P3B1-S01-A10**: *"No
  ownership on an inbound row: two coordinators either both chase it or neither does."* The matrix's own
  stated principle: *"a collection absent from this file entirely is indistinguishable from one nobody
  considered."*
- **CONSEQUENCE.** The first object in the service chain has no classification, and it is precisely
  where accountability must begin.
- **RECOMMENDATION.** Classify it — the matrix's own rule requires it. Which class is a business
  decision.

### OD-OWN-003 — Is there a correction path for an IMMUTABLE mis-owned record?

- **QUESTION.** 13 families are `IMMUTABLE`; `buildOwnershipHandoff` refuses them with
  `FAMILY_IMMUTABLE`. A mis-owned historical invoice has no legal path to correction.
- **EVIDENCE.** Already recorded as a risk in the reconciliation: *"If the Owner wants one, it must be
  a named, audited exception rather than an implicit edit."*
- **RECOMMENDATION.** Preserve immutability; if a path is wanted, a distinct audited action — never a
  relaxation of `FAMILY_IMMUTABLE`, and never `ADMIN_CORRECTION` reused.

### OD-OWN-004 — Do Contacts and Locations follow an Account handoff?

- **QUESTION.** Two ratified-looking authorities say opposite things.
- **EVIDENCE.** `record-ownership.md` §4 and AC-7: they move *"immediately and silently"*. The matrix:
  they have their own `owner`, inherit **at creation only**, and *"does not follow the Account"*.
  `ownershipHandoffCommand.ts` enforces no-cascade structurally.
- **CONSEQUENCE.** Unresolved, a later reader can cite either. Under the matrix, an Account handoff
  leaves 339 contacts and 183 locations (sandbox) pointing at the previous owner.
- **RECOMMENDATION.** The matrix and handoff command are later and ratified; **mark
  `record-ownership.md` §4/AC-7 superseded explicitly** rather than leaving both standing.

### OD-OWN-005 — May a handoff source represent an escalation or a departure?

- **QUESTION.** `OWNERSHIP_HANDOFF_SOURCES` = `DIRECT_HANDOFF`, `CUSTOMER_HANDOFF_REVIEW`,
  `ADMIN_CORRECTION`. None is an escalation or a departure.
- **EVIDENCE.** `auditEventWriter.ts:429-433`, with the stated rationale: *"an admin correcting a
  mistake and a customer-review reassignment are different acts, and a later reader of the trail cannot
  tell them apart from the owner values alone."*
- **CONSEQUENCE.** A departure-driven reassignment recorded as `ADMIN_CORRECTION` files a legitimate
  lifecycle event as a data-entry fix, destroying the distinction the closed set exists to preserve.
- **RECOMMENDATION.** Do not reuse `ADMIN_CORRECTION`. Whether a new source is added is an Owner
  decision; the brief's ruling *"do not assume escalation transfers record ownership"* argues that
  escalation should produce **no** handoff at all.

### OD-OWN-006 — Should person-owner derivation check the Employee?

- **QUESTION.** `deriveAccountOwner` / `deriveEmployeeRefOwner` are shape-only and never read the
  Employee document, so an owner who is terminated, deleted, or never existed censuses as **RESOLVED**.
  `deriveCompanyOwner` does resolve against its authority.
- **EVIDENCE.** §0. `record-ownership.md` §2 *requires* the active check. No module in
  `functions/src/ownership/` reads `employmentStatus`.
- **CONSEQUENCE.** The census — the instrument the enforcement gate depends on — cannot report a
  person-level orphan. Enforcement could be switched on against a census reading zero while orphans
  exist.
- **RECOMMENDATION.** **Yes**, and distinguish the states the way the company axis already does:
  `OWNERLESS` ≠ `UNKNOWN` (id names no employee) ≠ `INACTIVE` (names a non-`ACTIVE` employee) ≠
  `RESOLVED`. Note this is a measurement change, not a backfill, and it is a **prerequisite** to the
  enforcement gate rather than a follow-up. → hand the runtime proof to **OWN-E2E**.

---

## 11. MISSING INPUT

The Owner's separate employee-design conversation is **not available to this run.** Each item below can
be settled **only** by it. **Nothing here is reconstructed or guessed.**

| # | Question only the Owner's employee-design conversation can settle |
|---|---|
| MI-1 | Whether accountability is a first-class business concept in Taylor's operating model, or whether the business genuinely runs on process ownership plus a telephone |
| MI-2 | Per workflow, **who** the accountable person is by job role — in particular who is accountable for a Work Order's outcome (the Owner's worked example says "service coordinator/manager"; EOS has no consumer for either value, §1.2) |
| MI-3 | Which escalation modality is authorized per workflow, and the **time or condition** thresholds. Only one number appears anywhere in evidence: the corpus's 40 minutes for an unaccepted dispatch (P3B1-S08-A09), and it is narrative, not policy |
| MI-4 | What happens to owned records, accountabilities and assigned work on each of the nine unavailability/departure states — the §6.2 matrix is **entirely `NO CHANGE` today**, which is a description of the gap, not a statement of intent |
| MI-5 | Whether a handoff requires **acceptance**. Evidence shows acceptance is pervasive in the business (107 corpus mentions) and absent from EOS; only the Owner can say whether the ownership model should acquire it |
| MI-6 | Who may transfer a record they own (open question 2 of `record-ownership.md`, never answered) |
| MI-7 | Whether a departed employee's records are reassigned, held, or left — and to whom. Related: whether "future records follow a newly established owner" applies when the prior owner is terminated |
| MI-8 | Whether REFERENCE/master data has a named steward, and at what granularity (OD-OWN-001) |
| MI-9 | The legitimate business cases for an OPERATING-COMPANY CHANGE, which this lane was asked to settle "where legitimate" and found **no evidence for at all** — no family has a company-change rule, and `operatingCompanyId` is described as "immutable once stamped" in design docs |
| MI-10 | Whether accountability requires proficiency/certification (OD-EMP-008) |
| MI-11 | Whether the three deliberately-ownerless R-7 control Accounts are the *only* Owner-approved exception to the invariant, or a precedent for others |
| MI-12 | Which manager authority is canonical (OD-EMP-005) — the Owner already called `reportsTo` a "NICE TO HAVE" in 2026-08-19, which predates the field's existence and may no longer reflect intent |

---

## 12. UNPROVEN — claims this lane could not verify at baseline

| # | Claim | Status |
|---|---|---|
| UN-1 | That ownership handoff is **INERT** | **PARTIALLY FALSE.** Verified: not exported from `functions/src/index.ts`, so **no callable reaches it**. But `functions/scripts/assignWarehouseRootCompany.js:72,234` **does** call `stageOwnershipHandoff` in a real transaction. So it is inert *as a deployed callable* and **live as an operator CLI for one COMPANY family**. See §13 |
| UN-2 | That the sandbox census numbers still hold | **UNPROVEN.** The census ran 2026-08-30 against `eos-platform-sandbox`; this run performed no data read. All counts quoted are *as measured then*, and the reconciliation's own caveat stands: *"the sandbox is synthetic seeded data … Production would answer that, and this census does not."* |
| UN-3 | That backfill has not run since | **UNPROVEN** — requires a live read. The plan projects 517 PERSON + 451 COMPANY + 47 PARTICIPATING writes with 99 blocked; whether any executed is not visible from the repository |
| UN-4 | `record-ownership.md`'s defect claim that `createSalesOrderFromOpportunity` takes a caller-supplied `ownerEmployeeId` validated only as non-empty (line 232/295) | **NOT RE-VERIFIED.** Ruling D-4 and `creationOwnerResolution.ts` were written to fix exactly this; whether the call sites now route through the resolver is a runtime/code question → **OWN-E2E** |
| UN-5 | "DECISIONS #142" as the citation for rulings D-1…D-5 | **UNVERIFIABLE.** `docs/DECISIONS.md` entry 29/30 at that number concerns Void Purchase Order, not ownership. The reference is probably a PR number rather than a DECISIONS entry; either way the rulings' text is carried in the assessment's Addendum and that is what this lane relied on |
| UN-6 | That `firestore.rules` enforcement of ownership is not deployed | **NOT TESTED** (no deploy contact, correctly). Repository evidence says enforcement was deliberately not built (Gate 4 ungated) and that the file is **hash-anchored to the live deploy** by `functions/test/verifyTruckRegistryDeployment.test.js` → **OWN-E2E** |
| UN-7 | EMP-ROLE's "5 of 8 `operationalRoles` have no consumer" | **PARTIALLY RE-DERIVED.** This lane confirmed **3** with certainty — `SERVICE_MANAGER`, `SALES_MANAGER`, `SALES_ASSOCIATE` appear only in the enum, a label list and a seed snapshot. `WAREHOUSE_ASSOCIATE` and `TECHNICIAN` have at least one real consumer each (`dashboardComposition.js:154`; technician binding). The count is EMP-ROLE's to settle; the three that matter to this lane are verified |
| UN-8 | EMP-ROLE's "48 security Roles / 147 capabilities" and "`governedBusinessRoles.ts` header still says eight" | **NOT RE-DERIVED.** `compatibilityRoles.ts` confirmed to exist and to define `admin`/`dispatcher`/`technician`; the "eight governed business Role definitions" header string was **not found** by grep at this baseline. Counts accepted as cross-lane input, not re-measured — Role counting is EMP-ROLE's lane |
| UN-9 | Whether Account edits truly produce no audit event (ORPHAN-12) | **UNPROVEN** — asserted by corpus P3B3-ADV-034 / CRM-028; the write path was not traced → **OWN-E2E** |
| UN-11 | EMP-WORK's `workOrder.labor.record` is `active:false` in **every** declared environment | **NOT RE-DERIVED** — capability activation state was not read by this lane → **OWN-E2E** |
| UN-12 | EMP-WORK's **26** lost-between-people handoffs and **44** work-held-outside-EOS instances | **NOT RE-DERIVED, and explicitly hypothesis-grade.** EMP-WORK states these rest **entirely on authored narrative** and should reach the Owner as a hypothesis to test, not observed practice. Carried with that qualifier at Appendix A |
| UN-10 | That no `employmentStatus` check exists on dispatch | **VERIFIED NEGATIVE** for `functions/src/ownership/**` (no module reads it) and for the dispatch guard read (double-booking only). Not exhaustively traced through every callable's auth wrapper → **OWN-E2E** to confirm |

### Handed to OWN-E2E

1. Prove whether the ownership census, run today, would report a record owned by a non-existent or
   non-`ACTIVE` employee as `RESOLVED` (§0 — the model consequence is this lane's; the runtime proof is not).
2. Prove the current `createOpportunity` / `createSalesOrderFromOpportunity` / `closeOpportunityAsWon`
   call sites actually route through `resolveCreationOwner` (UN-4).
3. Prove that no deployed callable can reach `stageOwnershipHandoff`, and characterise what
   `assignWarehouseRootCompany.js` actually writes (UN-1).
4. Prove the Work Order orphan is reachable end-to-end: dispatch, then set the technician non-`ACTIVE`,
   then attempt every transition (ORPHAN-1).
5. Trace whether Account field edits emit audit events (UN-9).

### Handed to OWN-DESIGN

1. §0's asymmetry — the COMPANY axis resolves against an authority, the PERSON axis does not — is an
   object-family design question about what an owner *reference* is.
2. 14 of 27 ownable families have empty `ownerFields`; which object families those map onto, and whether
   `inbound_work_requests` is a family at all (OD-OWN-002).
3. Whether accountability is per-record, per-family, or per-workflow — this lane establishes it is
   *needed* and does not choose its shape.

---

## 13. What this lane found wrong in its own brief

Recorded because the brief asked, and because two of these would have propagated into the canonical
artifacts. `OBSERVED AT: 64008d5a`

| # | Brief said | Baseline says |
|---|---|---|
| 1 | `docs/OWNERSHIP.md` (63 lines) is record-ownership evidence | **Wrong file for the purpose.** 63 lines is correct, but it is **IP / attribution governance** — who owns the company and the IP, AI-as-tools, prohibited wording, protected legal actions. It contains **nothing** about record ownership, accountability, handoff or employees. The brief also instructed "do not write" it, which remains correct — but for a different reason than implied. The canonical record-ownership authority is `ownershipMatrix.ts`, with `docs/assessments/eos-ownership-model-reconciliation.md` as its rationale |
| 2 | Ownership handoff "has historically been **INERT**" | **Half-true and worth correcting precisely.** Inert as a deployed callable (not exported from `index.ts`) — confirmed. **Not inert as an operator path:** `functions/scripts/assignWarehouseRootCompany.js` calls `stageOwnershipHandoff` inside a transaction. The brief's instruction "do not activate it" was honoured; the belief that nothing calls it is incorrect |
| 3 | "The Work Order carries no company field at all (`ownerFields: []`)" | **CONFIRMED**, and worth stating more precisely: `workOrder`/`fieldops_wos` has `ownerFields: []`, note *"MEASURED 0/30 — the collection has no company storage at all."* But `workOrderLegacy`/`fieldops_jobs` **does** store `operatingCompanyId`. The two Work Order families differ, and a reader told only "the Work Order" would draw the wrong conclusion about the legacy one |
| 4 | "Existing rulings … creation-owner resolution is EXPLICIT → INHERIT GOVERNED UPSTREAM OWNER → REFUSE" and "the actor/creator does not automatically become owner" | **CONFIRMED and implemented** (`creationOwnerResolution.ts`). But `docs/specifications/record-ownership.md` — listed as evidence — states the **opposite** model in its own §1 and executive summary ("**Whoever creates a record owns it**", owner "derived from the authenticated actor"). It is a **Draft** superseded by ruling D-4 and is **not marked as superseded**. A lane reading the named evidence in order would adopt the wrong rule |
| 5 | "`ownershipMatrix` is DESCRIPTIVE of existing storage" | **Confirmed and incomplete.** It is descriptive for `ownerFields`, and **prescriptive** for `ownerClass`, `inheritanceSource`, `transfer` and `unresolvedPolicy` — `supplier_company_terms` is in the matrix as COMPANY and its **collection does not exist yet** (`unresolvedPolicy: "n/a — the collection does not exist yet"`). So the matrix does contain a declared-but-unbuilt family; treating it as purely descriptive would miss that |
| 6 | The reconciliation's "50 families" | **51.** PERSON 6 + COMPANY 20 + PARTICIPATING_COMPANIES 1 + REFERENCE 7 + EXCLUDED 17 = 51, evaluated rather than pattern-matched. The doc's own class breakdown sums to 51 while its prose says 50 |
| 7 | "`docs/specifications/employee-foundation.md` (575 lines)" as the employee evidence | **Correct length, insufficient as the employee source.** It predates and lacks `jobTitle`, `managerEmployeeId`, `operatingCompanyId`, `employeeNumber`, `separationDate` and the address block, which arrived via `docs/specifications/administration-users-consolidation.md:204-209`. A lane reading only `employee-foundation.md` would conclude EOS has no manager field at all |
| 8 | The corpus has "a `HANDOFF` coverage category and `exception_recovery_behaviour` field" | **True of two thirds of it.** P3B1 uses `coverageCategories`/`exceptionRecoveryBehaviour` (camelCase), P3B2 uses `coverage`/`exception_recovery_behaviour` (snake_case), and **P3B3's 350 activities have neither field** — they use `actor_role`/`owner_question`/`status`. All coverage analysis is necessarily over 660 of 1,010 activities |
| 9 | Implied by the brief's framing: that the nine concepts are distinguishable in EOS | **Two have no representation at all** (ACCOUNTABLE PERSON, ESCALATION OWNER), a third is ambiguous (MANAGER — two unreconciled subsystems, §1.1), and JOB ROLE has no usable vocabulary (§1.2). The instruction "never collapse them" is sound; the prerequisite is that four of the nine must first **exist** |

**None of the above weakens the brief's rulings.** Every one of the twelve "existing rulings" the brief
lists as constraints was found either implemented, correctly reasoned in code comments, or correctly
deferred. The corrections are to the *evidence pointers and counts*, not to the model.

---

## 14. Conclusions

1. **The load-bearing invariant is not satisfied for any actionable operational item, and cannot be
   detected as unsatisfied.** No accountable-person concept exists; 20 of 27 ownable families are owned
   by a company, which cannot be asked why the next thing has not happened; and the person-owner
   derivation is shape-only, so the census that gates enforcement is blind to person-level orphans.
2. **This is a composition of correct decisions, not a defect in any one of them.** COMPANY ownership of
   service work (D-13), fail-closed non-`ACTIVE` capability, and no-implicit-cascade are each right.
   Together they produce "NOBODY IS RESPONSIBLE" with no rule broken. Fixing it by weakening any of the
   three would be the wrong move, and the rulings correctly forbid it.
3. **The resolution shape is already precedented in the repository.** `companyScopeField`'s note — one
   record, two true, independent facts — plus ruling **R-20**'s accept-in-storage / refuse-in-assignment
   asymmetry together describe an accountability axis that satisfies the invariant **without rewriting a
   single historical ownership fact.** Both patterns are ratified and tested, on the company axis only.
4. **13 workflows can become responsibility-orphaned.** The worst is structural: past `Dispatch` a Work
   Order's only exits are the next technician-only step or `CANCELLED`, so EOS's only expressible answer
   to an unavailable technician is to cancel the record of a live customer commitment. Independently
   confirmed by the corpus: *"None of the four can be reassigned. All four must be cancelled and
   recreated."*
5. **Three of five continuity models are genuinely required across 16 workflows, and model B —
   accountability holds until the recipient accepts — is required by five of them and representable in
   none.** Acceptance appears 107 times in the corpus and zero times in the ownership model.
6. **Escalation does not exist.** Blocking is the only implemented modality, so every escalation resolves
   to stopped work plus a telephone call. The second tier is blocked three ways over: no mechanism, no
   resolvable manager (§1.1), and no consumer for the `SERVICE_MANAGER` / `SALES_MANAGER` role values
   that would carry it (§1.2).
7. **Departure releases nothing, and seeds future orphans.** All nine unavailability states are
   `NO_CHANGE` for owned records, and a terminated Account owner remains the governed default owner of
   records that do not yet exist.
8. **The corpus corroborates the gap independently:** 166 of 660 tagged activities (25%) are flagged
   `ownershipUnclear` by their own authors, and the words `takeover`, `unassigned`, `out of office` and
   `terminated` appear **zero** times in 1,010 activities — the business never described departure, so
   no lane can infer it.
9. **The gap is already being worked around, and the workaround falsifies data.** Cross-lane (EMP-WORK,
   hypothesis-grade): 44 instances of work held outside EOS, **in every case as a recovery path rather
   than a preference** — including the customer promise itself. Corpus P3B1-S21's real-world path,
   *"Dale tells Javier verbally and the record stays on Curtis,"* means the compensating behaviour
   **corrupts the technician scorecard** built on that data. The choice is not between a gap and a fix;
   it is between an acknowledged gap and wrong records.
10. **Report the denominator.** Handoff and friction figures cover **660 of 1,010** activities. Sales,
   CRM, finance and administration are untagged and contribute **zero** handoff evidence — a measurement
   gap, not a clean bill of health, and precisely where ORPHAN-5 and the financial rows of §5 sit.
11. **What EOS gets right should be protected explicitly:** `creationOwnerResolution.ts`'s six named
   forbidden fallbacks and the assistant case; the no-cascade handoff; `companyScopeField`'s defence of
   salesperson ownership against company scope; coverage-is-not-ownership; title-is-not-ownership; the
   `currentOwner` naming collision left deliberately unresolved; and the H20 audited dispatch
   reassignment with a required reason. These are the model's load-bearing correct parts.

---

## 15. Handoff

**TO:** EMP-OWN-SYNTHESIZER, via controller.

This file is **lane-local and not canonical.** It writes no canonical artifact: `docs/OWNERSHIP.md` and
`docs/specifications/record-ownership.md` were read and **not modified**.

For the synthesizer, in priority order:

1. **§0** — the three-decision composition and the shape-only derivation. This is the finding the
   canonical artifact must carry; everything else supports it.
2. **§10** — 8 `OD-EMP-*` and 6 `OD-OWN-*` decisions. **OD-EMP-001** (is accountability a distinct axis?)
   gates the others. **OD-OWN-006** is a prerequisite to the enforcement gate, not a follow-up.
3. **§13** — nine corrections to the shared brief, two of which (the superseded
   `record-ownership.md` §1, and `employee-foundation.md`'s missing fields) will mislead any sibling lane
   that reads the named evidence in order.
4. **§7** — the 13-item orphan register, for whichever canonical artifact records risk.
5. **§11** — 12 MISSING INPUT items. **MI-2, MI-4 and MI-5 cannot be closed by any amount of repository
   evidence** and should be put to the Owner directly.

6. **Appendix A** — EMP-WORK's 44 work-held-outside-EOS instances, carried with EMP-WORK's own
   hypothesis-not-practice qualifier. **Do not promote these to observed facts in a canonical artifact
   without the Owner confirming them**; they are the strongest available argument for closing the gap and
   the weakest-provenance evidence in this document, and both halves must travel together.

**Cross-lane:** §12 lists 5 items for OWN-E2E and 3 for OWN-DESIGN. Cross-lane input from EMP-ROLE was
received, verified, and is attributed at §1.1, §1.2, §1.3 and UN-7/UN-8; where this lane could not
re-derive EMP-ROLE's counts it says so rather than restating them.

---

## Appendix A — Cross-lane input from EMP-WORK

Received from the controller, carried with its own provenance qualifier. **EMP-WORK states plainly that
its outside-EOS and lost-between-people sections rest entirely on authored narrative and should reach
the Owner as a hypothesis to test, not as observed practice.** That qualifier is carried here and must
survive into any canonical artifact — this lane did not re-derive these figures and does not present
them as measured facts about Taylor's operations.

| Finding | Figure | Accountability reading |
|---|---|---|
| Handoffs where work can be lost between two people | **26** | Compare with this lane's **13** orphaning workflows (§7): EMP-WORK counts *handoff instances*, this lane counts *workflows with a structural orphaning path*. The two are consistent, at different granularity, and neither is a subset of the other |
| Instances of work held outside EOS | **44** | **In every one of the 44 the outside channel is a recovery path, not a preference.** This is the load-bearing qualifier: the business is not avoiding EOS out of habit, it is routing around a gap. Each is therefore evidence of an unmet accountability requirement rather than a training problem |

**The four load-bearing ones, and what each implies for accountability:**

| # | Work held outside EOS | Channel | Accountability consequence |
|---|---|---|---|
| 1 | **The customer promise** — *"the promise lives outside EOS"* | Phone | The single most important accountable commitment in the business has **no record at all**. Every §7 orphan is therefore worse than it looks: cancelling a Work Order (ORPHAN-1) does not cancel the promise, and EOS never knew about the promise to begin with |
| 2 | **The dispatcher shift handoff** — *"every in-flight decision is verbal"* | Verbal | Corroborates ORPHAN-2 and the corpus's *"The handoff dispatcher has no view of what the morning dispatcher did"* (P3B1-S07-A10) and *"The handoff is where the day's context is either transmitted or lost"* (P3B1-S22-A08). Continuity model **B** is required here and the acceptance state does not exist |
| 3 | **Labour time** — and `workOrder.labor.record` is `active:false` in **every declared environment** | Paper | An assignee's own record of what they did is not in EOS, so even the one role EOS *does* model cannot be held accountable from the record. **UNPROVEN by this lane** — the `active:false` claim is EMP-WORK's and was not re-verified here → **OWN-E2E** |
| 4 | **The published financial position** | Spreadsheet | Consistent with §2.6: financial families are COMPANY-owned, `IMMUTABLE`, and the accountable *person* for the published number is outside the system |

**Why this appendix changes a conclusion rather than decorating one.** This lane's §7 register was built
from state machines and matrix classifications — what EOS *can* express. EMP-WORK's 44 describe what the
business *does instead*. Read together, the gap is not latent: **it is already being worked around in
production practice, through channels that leave no auditable trace and, in the P3B1-S21 case, actively
falsify the data EOS does hold.** The invariant is not merely unsatisfied in principle; the
compensating behaviour is itself producing wrong records.
