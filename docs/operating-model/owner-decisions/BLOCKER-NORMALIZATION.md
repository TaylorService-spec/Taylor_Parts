# BLOCKER NORMALIZATION — which of the 17 actually blocks the foundation

**LANE** `BLOCKER-NORMALIZATION` · **MODE** `EVIDENCE_WRITE` · **NO IMPLEMENTATION** · branch
`ext/census-acceptance` · **BASELINE `64008d5ae0bdd9532909671b15a91122400accf1`**

**The premise under test.** The controller concluded *"nothing below can be honestly classified until the 17
are answered."* **That is false.** Tested against ten named foundation work items: **six of the ten are
blocked by none of the seventeen**, and **three decisions** account for every block that exists.

**THE ANSWER THE OWNER ASKED FOR: MUST-RULE-NOW COUNT = 3.** `MI-λ` · `MI-ε` · `OD-16`.

**Evidence convention.** Code, Rules, migration and SQL measurements are reads at **`64008d5a`**, tagged
**[@`64008d5a`]**; document citations are `ref:path:line`, reads of that ref's tip. Rulings **#180–#188** are
cited by entry number and clause heading, read at **`int/a-correctness-register` @ `97fb4b0d`** — a
**descendant** of the baseline, not an ancestor (verified: `git merge-base --is-ancestor 64008d5a
int/a-correctness-register` → true). Prior evidence is **cited, not restated**. **NOT_RUN:** no test, build,
typecheck, lint or emulator; **no `java`**; no environment contacted; no secrets.

**Nothing here answers any decision**; recommendations appear only where cited evidence supports one. **No
naming is frozen.** All 42 decomposition items and all ten PostgreSQL items **A–J** remain
`IMPLEMENTATION STATUS = NOT AUTHORIZED` (**#184**). **"Can start" below means "no remaining Owner DECISION
blocks it" — authorization is a separate gate, still withheld.**

## 0. THE TEN FOUNDATION WORK ITEMS

| # | Foundation work item | Where it comes from |
|---|---|---|
| **F1** | Canonical PostgreSQL Employee authority | **#185** items **A** (relation), **B** (status model), **C** (historical retention) |
| **F2** | Constrain `employee_principal_links` | **#185** item **D** — FK on `employee_id` |
| **F3** | Employee authority port | **#185** item **G** — server-side person-resolution adapter |
| **F4** | Distinguish `AUTHORITY_UNAVAILABLE` | **#187 §2** — distinct, fails closed |
| **F5** | Dedicated Accountability Census | **#187 §1** — architecture (ii), separate from ownership census |
| **F6** | Compose census into the enforcement gate | **#187 §1** — `OWNERSHIP + ACCOUNTABILITY + … → GATE` |
| **F7** | Accountable-person persistence | **#180** storage clause · **#181** commercial chain |
| **F8** | `OD-7` governed orchestration skeleton | **#185** item **I** · **#183**/**#184** sequence |
| **F9** | Bypass census | **#184**, *"Bypass paths are DEFECTS"* → required call-path census |
| **F10** | Integrate the unrelated executable correctness branches | §13 below |

---

## 1. ONE SCREEN — ALL 17

| DECISION | EXACT QUESTION (short) | STAGE BLOCKED | MUST RULE NOW? | RECOMMENDATION |
|---|---|---|---|---|
| **`MI-λ`** | Declared disposition of a person reference that does not resolve when the constraint is added | **F2** (+ item **E** migration) | **YES** | **(a) DECLARE-AND-QUARANTINE** — the only option satisfying all three prohibitions. Ask it as a **schema rule before any row exists** (`V-λ`) |
| **`MI-ε`** | Does Layer 1 fail closed on people absent from `employees`, or is completeness a precondition? | **F6**, **F7** (enforcement mode only) | **YES** | **NONE** — refusing real people is not an engineering call. **(c) STAGED** is the option that keeps F5/F7 construction moving |
| **`OD-16`** | Classify `inbound_work_requests` + three email collections; are Approval/Exception and Report-execution governed families; Work Order company storage | **F5**, **F6** | **YES** | **PARTIAL** — *classify them*; the matrix's own rule requires it. **Which class is the Owner's** |
| **`MI-V`** | Does Layer 1 extend to all fifteen person references? | none of the ten | NO | **D — safe default (b)**: the two ruled facts only; the other 13 keep today's floor, out of scope pending an enumerated list |
| **`MI-κ`** | What is the governed JOB-ROLE vocabulary, and who may occupy it? | `OI-04` only | NO | **B** — role-keyed **escalation/approval** only. **Verified off the Layer-1 path** (§8) |
| **`OD-13`** | Is there a governed "I COULD NOT COMPLETE THIS" outcome; is `Cancel` acceptable in the interim? | Service/Dispatch workflow family | NO | **B** — and the shipped machine already **is** the interim answer: `CANCELLED` is reachable from every non-terminal state |
| **Job-role vocabulary extension** (`X-16`) | Which job roles exist; does Sales split Retail / National Accounts; PRIMARY vs ADDITIONAL grain | Employee-Profile / workflow | NO | **B — EMPLOYEE-PROFILE / WORKFLOW**, not foundation. Missing distinction is exactly **one axis** (§10) |
| **User Access composition** (`X-21`) | May one admin surface present credential + security-role + capability facts as one "User Access" object? | Administration surface | NO | **C** — surface composition. `#185`'s three-concept separation binds regardless of layout |
| **Responsibility coverage** (`X-25`) | Is coverage a governed axis with its own integrity measurement; is single-person dependency a first-class defect? | a would-be sixth axis | NO | **D — safe default**: **not** a governed axis. `#187 §1`'s five axes stand |
| **Automatic escalation** (`X-27`) | May a proficiency gap (or any defect) automatically raise an escalation? | escalation family | NO | **D — safe default: NO automatic escalation.** Consistent with `#180` invariants 2/4/5 and `#186 §8` |
| **Dual accountability in handover** (`X-37`) | May two people share accountability during a handover window, or is MULTIPLE ACCOUNTABLE PEOPLE zero-tolerance? | F7 **cardinality** (cost, not correctness) | NO | **D — safe default: zero tolerance / cardinality 1** (`MI-W`: exception list is EMPTY). **Cheap now, expensive after F7 ships** — see §16 `T-2` |
| **Pending-transfer expiry** (`X-38`) | Does a pending accountability transfer expire, after how long, to whom does it fall back? | handoff-acceptance family | NO | **D — safe default: no pending state.** `#183`/`#184` rule ONE atomic transaction; an atomic transfer cannot expire |
| **Territory** (`X-39`) | Is territory / service area a profile fact or an assignment-model concept? | Profile surface (reading A) / assignment family (reading B) | NO | **C** — both readings carried (§16 `T-3`) |
| **Qualification blocking** (`X-40`) | Which qualifications legally block assignment when expired vs advisory? | assignment / dispatch family | NO | **B** — and the ruling constraint: it is **execution authority**; `#182 "4."` forbids fusing it with accountability eligibility |
| **Per-state Service accountability** (`S-7`) | The accountable person per Service lifecycle state | Service family | NO | **B** — **and this is the same decision as the row below** (§15 correction 1) |
| **Job Roles / Proficiencies / Coverage administration** (`M-8`) | Do the six administered object types become governed first-class objects at all? | Administration → People family | NO | **C** — six object types with no governed existence today |
| **Service lifecycle accountability** (unlabelled, consolidated) | Across all Service states together: who holds accountability, and at which boundaries does it move, by which governed operation? | Service / Dispatch family **only** | NO | **B** — **does NOT block the generic foundation.** And 4 of the 9 states do not exist in the shipped machine (§10) |

## 2. THE BLOCKING MATRIX — 17 × 10

`Y` = BLOCKS. **No `Y` was given because a decision appears in the same 42-item decomposition.** Mechanisms
for every `Y` are below the grid; every `N` row names what it blocks instead.

| DECISION | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 | F9 | F10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `MI-λ` | N | **Y** | N | N | N | N | N | N | N | N |
| `MI-ε` | N | N | N | N | N | **Y** | **Y** | N | N | N |
| `OD-16` | N | N | N | N | **Y** | **Y** | N | N | N | N |
| `MI-V` | N | N | N | N | N | N | N | N | N | N |
| `MI-κ` | N | N | N | N | N | N | N | N | N | N |
| `OD-13` | N | N | N | N | N | N | N | N | N | N |
| Job-role vocabulary `X-16` | N | N | N | N | N | N | N | N | N | N |
| User Access composition `X-21` | N | N | N | N | N | N | N | N | N | N |
| Responsibility coverage `X-25` | N | N | N | N | N | N | N | N | N | N |
| Automatic escalation `X-27` | N | N | N | N | N | N | N | N | N | N |
| Dual accountability `X-37` | N | N | N | N | N | N | N | N | N | N |
| Pending-transfer expiry `X-38` | N | N | N | N | N | N | N | N | N | N |
| Territory `X-39` | N | N | N | N | N | N | N | N | N | N |
| Qualification blocking `X-40` | N | N | N | N | N | N | N | N | N | N |
| Per-state Service `S-7` | N | N | N | N | N | N | N | N | N | N |
| Administration objects `M-8` | N | N | N | N | N | N | N | N | N | N |
| Service lifecycle (consolidated) | N | N | N | N | N | N | N | N | N | N |
| **BLOCKED BY** | **0** | **1** | **0** | **0** | **1** | **2** | **1** | **0** | **0** | **0** |

### 2.1 Every YES, with its mechanism

| Cell | Which artifact cannot be built safely, and why |
|---|---|
| `MI-λ` → **F2** | Item **D** adds an FK on `employee_principal_links.employee_id` — *"the only thing that has to be added"* (**#185**, *"Two factual corrections"*, quoting `1758412800000:55-57`). The FK **fails** on any retained row whose `employee_id` does not resolve, and **#187 §4** requires `RECIPROCAL_FIREBASE_UID_LINK` rows be *"retained as historical migration provenance"* — so they may not be removed to make the FK pass. Three prohibitions then bound the answer and none produces it: **#182 "10."** (no backfill-as-repair), **#182 "8."** (no automatic history rewrite), **#180 invariant 6** (historical accountability stays auditable). **A lane may not choose which prohibition yields.** |
| `MI-ε` → **F6** | Composing the census into an **enforcement** gate is the act of refusing. Whether a real actor absent from `employees` is refused **is** `MI-ε`. **#182 "1."** fixes only the resolver's *answer*; it neither licenses nor forbids **activating** enforcement over a knowingly incomplete population. The census can be **built and reported** (F5) without this; it cannot be made to **refuse** without it |
| `MI-ε` → **F7** | Same mechanism at write time. **Split, and the split matters:** the accountable-person **storage shape** for the three `#181` families is buildable today; what is not buildable is its **refusal behaviour** when the named person is a real actor with no `employees` row. Build the shape, defer the refusal |
| `OD-16` → **F5** | **#182 "3."** applies state **D** `NONE` *"only where the family legitimately permits no person reference"*. For an **unclassified** collection the census cannot distinguish legitimate `NONE` from a defect — the denominator is undefined. **Four live collections are absent from `ownershipMatrix`.** A census can still be built reporting them `UNCLASSIFIED — not scored`, but it cannot then be **accepted** as the measurement of **#180 invariant 1**, which **#180** itself records as *"not currently detectable"* |
| `OD-16` → **F6** | Follows from F5: a gate over an undefined denominator either under-blocks (silent violation) or over-blocks (refuses legitimate `NONE`) |

### 2.2 Every NO row, and what it blocks instead

| Decision | Blocks instead |
|---|---|
| `MI-V` | **Later stage, additive:** extension of the Layer-1 floor to the other 13 references. A gate built over the two ruled facts (RECORD OWNER `PERSON`, ACCOUNTABLE PERSON) is correct; enumeration is added later without rework |
| `MI-κ` | `OI-04` only — and `OI-04` is **independently** blocked on an Owner role **grant** (`ext/own-engineering-gap:…/OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md:1360`) |
| `OD-13` | The Service/Dispatch **workflow** family — the transition vocabulary of `functions/src/transitionEngine.ts` [@`64008d5a`] |
| `X-16` | The Employee-Profile / workflow family: v4.1 Profile and Responsibility surfaces, and `OPERATIONAL_ROLE_VALUES` consumers |
| `X-21` | The Administration → People surface layout |
| `X-25` | A sixth governed axis that **#187 §1** does not contain, plus the Profile coverage surfaces (`NS2-EMP-11`) |
| `X-27` | The ESCALATION axis family — an axis **#180** names and no foundation item implements |
| `X-37` | F7's **cardinality**, as cost not correctness: cardinality 1 is what **#180 invariant 1** rules today, so single-valued storage is safe; an Owner-approved exception later is a schema change. See §16 `T-2` |
| `X-38` | The handoff-acceptance family (**#186 §13**, *"handoff acceptance semantics"* — not absorbed) |
| `X-39` | The Profile surface (reading A) or the assignment/scheduling family (reading B) |
| `X-40` | The assignment/dispatch family. **ASSIGNMENT is outside `OD-7`'s axis scope** (**#187 §5**), so no foundation item reaches it |
| `S-7` / Service lifecycle | The Service and Dispatch families only — `NS2-SVC r2` and `NS2-DSP-01 r2` propagation rows |
| `M-8` | The Administration → People family: six administered object types with no governed existence |

## 3. MUST RULE NOW — FOUNDATION (3)

**`MI-λ` · `MI-ε` · `OD-16`.** Options, settled constraints and recommendations are already in
`ext/census-acceptance:…/REMAINING-DECISION-TRIAGE.md` §2.1–§2.2 and are **cited, not restated**; ratified
category **C** at **#188**. **Sequence within the three:** `OD-16` first — it gates the most (F5, F6), is
pure classification, and the matrix's own header already says an absent collection *"would be
indistinguishable from one nobody thought about"*; `MI-λ` next, and **ask `V-λ` before asking it**, because
zero rows makes it a schema rule; `MI-ε` **last**, because it gates only **activation** of F6/F7.

## 4. DEFER UNTIL FAMILY (B) — 6

`MI-κ` (escalation/approval) · `OD-13` (Service/Dispatch workflow) · `X-16` job-role vocabulary
(Employee-Profile / workflow) · `X-40` qualification blocking (assignment/dispatch) · `S-7` **and** the
consolidated **Service lifecycle accountability** decision (Service/Dispatch) — **one decision, two framings**
(§15 correction 1).

## 5. DEFER UNTIL UI / ADMIN (C) — 3

`X-21` User Access composition · `X-39` territory · `M-8` administration object types.

## 6. DERIVED / NON-BLOCKING WITH A NAMED SAFE DEFAULT (D) — 5

| Decision | THE SAFE DEFAULT, named | Why it is safe |
|---|---|---|
| `MI-V` | Layer 1 covers the **two ruled facts** only; the other 13 keep today's floor and are declared out of scope | Exactly what **#182 "1."** rules; **#182 "7."** independently protects existing `creditedSalespersonId` semantics, so nothing changes silently |
| `X-25` responsibility coverage | Coverage is **not** a governed axis | **#187 §1** enumerates five axes and coverage is not among them; **#182 "6."** likewise excludes it; **#180 invariant 9** reserves stewardship models |
| `X-27` automatic escalation | **No** automatic escalation | Acting automatically is the unsafe side of a not-decided rule (**#186 §13**). **#180** invariants 2/4/5 and **#186 §8** already forbid automatic accountability movement |
| `X-37` dual accountability | **Zero tolerance; cardinality 1** | **#180 invariant 1**'s exception is constitutively conditional on *"an explicit, separately Owner-approved exception"*; none exists (`MI-W`, **#188** class B). A later exception is additive to a census built on zero tolerance |
| `X-38` pending-transfer expiry | **No pending state**, therefore no expiry and no fallback | **#183**/**#184** rule ONE governed **transaction** — *"WRITE RESPONSIBILITY CHANGE · WRITE AUDIT · COMMIT"*, *"commit atomically"*. An atomic transfer has no pending window to expire. **#180 invariant 7** is satisfied **by atomicity**, not by a fallback |

**CLASS E (DERIVED — NO OWNER DECISION): 0 of the 17.** The seven previously-derived ids (`MI-γ` `MI-δ`
`MI-U` `MI-W` `O-1` `M-2` `OD-8`) and the one non-blocking id (`MI-α`) were closed at **#188** and are not
among this lane's 17.

## 7. THE SIX REGISTERED DECISIONS — AT SOURCE

Questions are **quoted, not paraphrased**. Locations are reads of each ref's tip.

| DECISION ID | EXACT QUESTION | SOURCE DOCUMENT | EXACT LOCATION | CURRENT SETTLED CONSTRAINTS |
|---|---|---|---|---|
| **`MI-λ`** | *"**Is item E a "backfill" under `#182` §10, or a governed datastore move of an existing record?** And **what is the declared disposition of a row whose person reference does not resolve when the constraints of §9.4 are added** — given that it may be neither a rewrite (`#182` §8) nor a silent drop (`#180` invariant 6)?"* | `PERSON-AUTHORITY-TARGET-MODEL.md` | `ext/own-engineering-gap:docs/operating-model/architecture/…:1097` (§9.8) | First half **derived**: a verbatim datastore move is not the prohibited backfill. Second half open. `ownership_handoffs` append-only [@`64008d5a`]; **never fabricate an Employee**; **never delete immutable history** |
| **`MI-κ`** | *"**What is the governed JOB-ROLE vocabulary, and who may occupy it?**"* | same, raised at `OWNERSHIP-IMPLEMENTATION-DECOMPOSITION.md` | `…:1098` (§9.8); `ext/own-engineering-gap:docs/operating-model/engineering/…:1489` (§23) | Eligibility's floor is governed employment/person status (**#182 "4."**); further constraints **per family**. Employment-status vocabulary already shipped (**#186 §4**). **#182 "4."** forbids eligibility-as-role/capability |
| **`MI-ε`** | *"`employees` is **not the complete person population**. Does Layer 1 **fail closed** on those people — declaring real actors non-existent — or is completeness a **precondition**?"* | same | `…:1087` (§9.8); also `:574` (§4.2) | NON-EXISTENT must not yield `RESOLVED` (**#182 "1."**). `AUTHORITY_UNAVAILABLE` is **distinct** and **fails closed** (**#187 §2**) — *"absent"* and *"cannot ask"* are already different outcomes |
| **`MI-V`** | *"Does Layer 1 extend to the **fifteen** person references of §5.1, including `creditedSalespersonId` and `responsibleEmployeeId` on `person()`'s `nonEmpty`-only floor (`financialAttribution.ts:205-209`)?"* | same, raised at the decomposition | `…:1093` (§9.8); `…DECOMPOSITION.md:1208` (§17) | RECORD OWNER (`PERSON`) and ACCOUNTABLE PERSON **are** in scope and independently validated (**#182 "1."**). **#182 "7."** protects existing `creditedSalespersonId` semantics. **#185** rules the authority, **not** the scope |
| **`OD-13`** | *"**Is there a governed "I COULD NOT COMPLETE THIS" outcome — and is `Cancel` an acceptable escalation answer for a dispatched Work Order in the interim?**"* | `EMPLOYEE-OPEN-DECISIONS.md` | `emp/own-synthesis:docs/operating-model/…:156` | Accountability is **never automatically transferred** (**#186 §8**, **#180** inv. 2 & 4); **REASSIGNMENT ≠ ACCOUNTABILITY TRANSFER** (**#187 §5**); no transition may create a `NONE` state (**#180** inv. 7). **#186 §8/§13** make escalation workflow-specific and not decided |
| **`OD-16`** | *"**Classify `inbound_work_requests` and the three email collections; and are Approval/Exception and Report-execution governed families? And does a Work Order get company storage, from where?**"* | same | `…:159` | **#182 "3."** state **D** `NONE` applies *"only where the family legitimately permits no person reference"*; `#143` forbids **inferring** a Work Order's company; **#180 invariant 8** permits COMPANY ownership **with** a PERSON accountable; **#180 invariant 9** sends reference/master-data stewardship to a separate decision |

**NOT LOCATABLE AT SOURCE — a decision id for the consolidated Service lifecycle question.** Searched
`ext/own-engineering-gap`, `ext/census-acceptance`, `ext/own-decision-packet`, `emp/own-synthesis`,
`int/a-correctness-register` and `64008d5a` for `PROPOSED ACCOUNTABILITY` / `WORKFLOW VALIDATION REQUIRED` —
zero hits on all six; only `atlas/employee-v41-input` carries it (prior triage §3.1, unchanged). **Naming a
register item is the Owner's.**

## 8. `MI-κ` — THE DEPENDENCY, VERIFIED

**Exact question:** *"**What is the governed JOB-ROLE vocabulary, and who may occupy it?**"*
(`ext/own-engineering-gap:…/PERSON-AUTHORITY-TARGET-MODEL.md:1098`).

**The claim tested:** that `MI-κ` plus zero governed-Role occupancy blocks anything naming an accountable
person. **REFUTED — on four independent pieces of evidence.**

| # | Evidence | Reading |
|---|---|---|
| 1 | `functions/src/ownership/ownershipMatrix.ts:518` [@`64008d5a`]: `["roleAssignment", "roleAssignments", "access authority, governed separately"]` | The **shipped** ownership authority declares the Security-Role relation **out of scope for itself**, by name |
| 2 | `git grep -E "RoleAssignment\|roleAssignment" 64008d5a -- functions/src/ownership/ functions/src/employeeIdentity/` returns **exactly that one line** and nothing else | **No** person-resolution or ownership path consults a Security Role. There is no code dependency to break |
| 3 | `be1e5579:docs/assessments/r32-production-exposure-census.md:70-78` — `PARTS_MANAGER` total 1 / with governed Role **0**; `WAREHOUSE_MANAGER` total 1 / with governed Role **0**; both *"carry the operational role on their employee record and hold **no RoleAssignment whatsoever**"*; totals `users` **16**, `employees` **6** (`:54-55`) | **Two real business people exist, carry real `employeeId`s and operational job roles, and hold zero Security Roles.** An Employee is therefore referenceable as a business person with **no** Security Role — demonstrated, not argued |
| 4 | **#182 "4."** separates accountability from ROLE · CAPABILITY · WORKFLOW AUTHORITY and forbids defining eligibility as capability-to-perform; **#186 §2/§4** put the eligibility floor on **employment status**, whose vocabulary is already shipped (`functions/src/access/employeeProfileCommands.ts:122-129` [@`64008d5a`], six frozen values) | Naming an accountable person needs **Employee identity + employment status**. Both ship today |

**OPERATIONAL JOB ROLE and GOVERNED SECURITY ROLE are kept strictly separate throughout.** Item 3 is
decisive because it is an occupancy fact, not an inference: the governed Security-Role population is empty
**and the business-person population is not.**

**THE EXACT DEPENDENCY.** `MI-κ` is required **only** where a surface or rule keys behaviour on a **JOB
ROLE** — role-keyed escalation routing, approval authority, coverage rows. It is **not** required to create,
resolve, validate, name, store or census an accountable person. It blocks **`OI-04`** and nothing in F1–F10,
re-verifying the prior correction to `…DECOMPOSITION.md:1489` (*"nothing can name an accountable person
without it"* — **too strong after #182**; prior triage §5 correction 3, and **#188**).

## 9. `MI-λ` — OPTIONS THAT SEPARATE HISTORICAL FROM CURRENT

**The physical constraint, re-verified [@`64008d5a`]** in
`functions/migrations/1758844800000_commercial-ownership-authority.sql`:

| Fact | Line | Verified text |
|---|---|---|
| Append-only trigger | `:295-305` | `refuse_ownership_history_mutation()` raises on `BEFORE UPDATE OR DELETE`, hint *"A correction is a NEW handoff row with source ADMIN_CORRECTION, not an edit to the old one."* |
| Four sibling FKs | `:258-261` | `tenant_id … REFERENCES eos_policy.tenants(id)` · `opportunity_id … REFERENCES opportunities(id)` · `sales_agreement_id …` · `sales_order_id …` |
| Two person columns, **no FK, no CHECK** | `:262-263` | `previous_owner_employee_id TEXT` · `new_owner_employee_id TEXT NOT NULL` |

**So a bad row there is permanent by design** — and that is the feature. **Two absolutes:** **(1) never
fabricate an Employee to make an FK pass** — a minted row produces in the **authority** the false `RESOLVED`
**#182 "1."** forbids, where nothing downstream can detect it; **(2) never delete immutable history because a
person reference is bad** — **#180 invariant 6**, **#182 "8."**, **#186 §7**.

**The distinction the options must carry**, and no option may conflate them:

| Category | Definition | Required treatment |
|---|---|---|
| **HISTORICAL INVALID REFERENCE** | A reference on a **closed / non-actionable** record, or on an append-only history row | **Retained, auditable, never repaired, never blocking.** It is evidence |
| **CURRENT ACTIONABLE INVALID REFERENCE** | A reference on an **actionable** record where the next required outcome still depends on a person | A **responsibility defect requiring governed resolution** (**#186 §8**) — resolved by a governed accountability/ownership move, never by editing the reference |

### 9.1 The three options, precisely

| Option | Mechanism | Does it require historical mutation? | Satisfies both absolutes? |
|---|---|---|---|
| **(a) DECLARE-AND-QUARANTINE** | **Scoped FK**: the FK is added **NOT VALID** (or as a trigger on new rows only) so it constrains **every future insert** and validates **no existing row**; existing non-resolving rows are **retained, enumerated in a governed exception register** and classified HISTORICAL vs CURRENT ACTIONABLE by the census. Future enforcement is thereby enabled **without touching one historical row** | **NO** | **YES** |
| **(b) PRECONDITION** | No constraint until every reference resolves — an Owner-authorized population project first. Couples to `MI-ε` | No, but it **stalls** F2 for the duration | YES, at the cost of an unbounded wait (`V-ε` unmeasured) |
| **(c) TOMBSTONE THE REFERENT** | Mint a governed **NON-ACTIONABLE** Employee identity preserving the id without asserting a person | No | **Only if** the minted identity is governed as explicitly non-actionable and **never** resolves to `VALID_CURRENT`. **Named so it can be refused.** It writes a person into the person authority — the Owner's call, never a lane's |

**RECOMMENDATION: (a)** — the only option satisfying all three prohibitions **at once**, and the only one
that **separates future FK enforcement from historical integrity**. That is the staged integrity model:
**constrain forward, measure backward, repair neither.** `…PERSON-AUTHORITY-TARGET-MODEL.md:995` (§9.4a(3))
already orders item **E** after the constraint, and §9.4a(4) already establishes that **a failed constraint
is a measurement**. **`V-λ` is UNPROVEN** — if no row exists, `MI-λ` is a schema rule settled before any row
exists and the dilemma disappears. **Ask `V-λ` first; it may collapse a must-rule-now item into one line.**

## 10. SERVICE LIFECYCLE — ONE TABLE, OVER THE SHIPPED STATE MACHINE

**The shipped vocabulary [@`64008d5a`]** — `field-ops-app-vite/src/domain/workOrderStatus.js:20-32`
(11 values) and `functions/src/transitionEngine.ts:39-51` (the graph), `:53-57` (`TERMINAL_STATUSES` =
`COMPLETED` · `CLOSED` · `CANCELLED`):
`CREATED → READY_TO_DISPATCH → SCHEDULED → DISPATCHED → ACCEPTED → EN_ROUTE → ARRIVED → WORK_IN_PROGRESS →
COMPLETED → CLOSED`, with `CANCELLED` reachable from every non-terminal state and **one** reverse edge
(`SCHEDULED → READY_TO_DISPATCH`).

**FINDING — this discharges `V-SVC`, and against the design.** `WAITING_ON_PARTS`, `RETURN_VISIT`,
`READY_FOR_BILLING` and any work-order `EXCEPTION` state **do not exist anywhere at the baseline**
(repo-wide grep over `functions/src`, `field-ops-app-vite/src`, `firestore.rules`: zero hits; the single
`"EXCEPTION"` hit is `FinancialsReconciliation.jsx:22`, an external-reconciliation state, unrelated).
**Four of the nine requested states are not states.** Conversely `SCHEDULED`, `ACCEPTED`, `EN_ROUTE`,
`ARRIVED` and `CANCELLED` are shipped and the design's seven labels omit all five.

| STATE (as requested) | SHIPPED STATE | PROPOSED ACCOUNTABLE ROLE/PERSON | CURRENT EVIDENCE | SETTLED? | OWNER DECISION REQUIRED? |
|---|---|---|---|---|---|
| **NEW WORK** | `CREATED` | Service-outcome accountable person (design: *"K. Ames"*) | `08-EMP-PROPAGATION-MATRIX.md:10` — `PROPOSED`, *"PARTIAL — BLOCKED — OWNER DECISION on lifecycle rules"* | **Platform rules only** (the 8 derived rules, prior triage §3.2) | **YES** — who |
| **REVIEW / INTAKE** | **none** — the `CREATED → READY_TO_DISPATCH` edge; action `MarkReady` (`functions/src/adminPolicy/workflowSeeds.ts:180`) | — | No state exists; intake is an **edge**, not a state | n/a | **NO** — there is no state to be accountable for. Making it one is a **state-machine** decision, not an accountability one |
| **DISPATCHED** | `SCHEDULED` · `DISPATCHED` · `ACCEPTED` · `EN_ROUTE` · `ARRIVED` (five shipped states, one design label) | unchanged holder; technician is ASSIGNEE | `#187 §5` — **REASSIGNMENT ≠ ACCOUNTABILITY TRANSFER**; `#180` inv. 2 | **YES** — accountability does **not** move on dispatch or acceptance | **NO** for movement; **YES** for who |
| **WORK IN PROGRESS** | `WORK_IN_PROGRESS` | unchanged holder | `#180` inv. 2 & 4 · `#184` *"Assignment remains separate"* | **YES** — does not move | **NO** for movement |
| **WAITING ON PARTS** | **DOES NOT EXIST** | — | Repo-wide: zero hits | n/a | **NO as an accountability decision.** A **state-machine extension** decision first |
| **RETURN VISIT** | **DOES NOT EXIST** | — | Repo-wide: zero hits | n/a | Same |
| **READY FOR BILLING** | **DOES NOT EXIST** — `COMPLETED → CLOSED` is the only post-work edge (`transitionEngine.ts:48`) | design's plausible second holder | Zero hits | n/a | Same. **This is the state the prior triage flagged as the clearest candidate for a boundary move, and it is not a shipped state** |
| **EXCEPTION / ESCALATION** | **DOES NOT EXIST** as a work-order state | ESCALATION OWNER axis (`#180`) | Zero hits; ESCALATION is a **separate axis**, not a status | n/a | **NO as a status decision.** It is the `X-27` / `OD-13` territory |
| **CLOSED** | `CLOSED` (+ `COMPLETED`, `CANCELLED` — all terminal) | historical holder, preserved | `#180` inv. 6 · `#182 "2."` · `#186 §7` | **YES** — history survives | **NO** |

**CLASSIFICATION: B — FAMILY IMPLEMENTATION BLOCKER (Service / Dispatch only).** It blocks `NS2-SVC r2`,
`NS2-DSP-01 r2` and every `PROPOSED ACCOUNTABILITY` chip on those two surfaces, and **none of F1–F10**. The
eight derived platform rules (prior triage §3.2) **constrain** the answer completely and **determine** none
of it; that lane's recommendation — **(a) one accountable person for the whole lifecycle** — is
**strengthened** here: with four proposed boundary states non-existent, a per-state map has no states to map
to. **Correction to the question's frame:** over the shipped machine it reduces to **one question about
`CREATED`…`CLOSED` with no boundary move available**, plus **a separate, prior decision on whether four new
states are added at all**. Those must not be asked as one.

## 11. JOB-ROLE VOCABULARY EXTENSION (`X-16`)

**The shipped vocabulary [@`64008d5a`]** — `functions/src/access/employeeProfileCommands.ts:131-140`,
`OPERATIONAL_ROLE_VALUES`, frozen, literal-mirrored across two writers and drift-guarded by test
(`:120-121`, *"asserts the two lists match, so the mirror cannot drift silently"*): **eight** values.
**No parallel vocabulary is proposed here.**

| v4.1 design role | Maps to a shipped value? | Value |
|---|---|---|
| technician / *"Service Technician"* | **YES** | `TECHNICIAN` |
| service manager | **YES** | `SERVICE_MANAGER` |
| parts (the parts half of the *"parts+purchasing hybrid"* profile) | **YES** | `PARTS_MANAGER` / `PARTS_ASSOCIATE` |
| *(warehouse — not in the 5 test profiles but shipped)* | **YES** | `WAREHOUSE_MANAGER` / `WAREHOUSE_ASSOCIATE` |
| **Retail Sales** | **NO — collapses** | only `SALES_ASSOCIATE` / `SALES_MANAGER` exist |
| **National Accounts Sales** | **NO — collapses** | same two values |
| *purchasing* (the second half of the hybrid profile) | **UNRESOLVED** — no shipped value; the design calls it a **profile**, not a job role. **Not asserted as a missing value** | — |
| *Warranty Administration · Inventory Reconciliation* | **not job roles** — they appear as **responsibilities / coverage rows** (`NS2-EMP Profile r1.dc.html:235`) | — |

**THE EXACT MISSING VALUES — one axis, not a list of roles.** The shipped sales values encode **SENIORITY**
(`_MANAGER` / `_ASSOCIATE`). The design's distinction is **BOOK OF BUSINESS**: *"Sales is TWO job roles:
Retail Sales and National Accounts Sales — independently assignable, different responsibilities/authority/
metrics. Never one generic Sales role"* (`atlas/employee-v41-input:docs/atlas/inputs/employee-v4.1/pages/
NS2-EMP-responsibility.md:24`) and *"separate roles with separate coverage rows — never one generic Sales
role"* (`…/NS2-EMP Profile r1.dc.html:250`). **A flat vocabulary cannot carry two orthogonal axes**, so
preserving `Retail Sales` and `National Accounts Sales` as **distinct business job roles** requires exactly
one of three shapes — **naming is not proposed, and `X-16`'s own PRIMARY-vs-ADDITIONAL grain question is
undecided, which is why the count is a range**:

| Shape | Values added | Values retired | Cost |
|---|---|---|---|
| **(i) Split the seniority pair per book** | **+4** (retail × 2, national accounts × 2) | `SALES_ASSOCIATE`, `SALES_MANAGER` (**2**) | Largest; touches the frozen list, the mirror, the drift test, and any stored value |
| **(ii) Add the two books as values alongside** | **+2** | none | Smallest, but the vocabulary then mixes two axes in one list — the defect that produced the question |
| **(iii) Carry the sales book as a second governed fact** | **0** to `OPERATIONAL_ROLE_VALUES` | none | Leaves the eight frozen values untouched; adds one governed attribute and its own vocabulary decision |

**RECOMMENDATION: none on the shape** — a governed-vocabulary decision is correctly the Owner's. **One
evidence-supported observation:** **(iii)** is the only shape preserving the frozen, drift-guarded eight
**unchanged** while satisfying *"never one generic Sales role"*, and the one most consistent with **#180**'s
axis discipline — a book of business is not a seniority.

**CLASSIFICATION: EMPLOYEE-PROFILE / WORKFLOW BLOCKER — NOT FOUNDATION.** Mechanism (§2.2): no foundation
item consumes a job role (§8), so F1–F10 are unaffected whatever the Owner rules.

## 12. THE FIVE DESIGN CONTRADICTIONS

Cited and tabulated from `atlas/employee-v41-input:docs/atlas/reconciliation/EMPLOYEE-V41-RECONCILIATION.md`
§5 — **not re-derived**. **None of the five is foundation-blocking**; all five are Design-package corrections.

| FRAME | CLAIM | CONTRADICTED AUTHORITY | CORRECT TREATMENT | LAYOUT vs SEMANTIC | BLOCKING? |
|---|---|---|---|---|---|
| **`X-42`** `NS2-EMP Responsibility r2.dc.html:217` | *"**NO ACCOUNTABLE PERSON** … orphaned when T. Ruiz went on leave"* | **#186 §5** case B (`INACTIVE` → reference stays **VALID**) and **§8** (*"accountability is never automatically transferred"*); **#180** inv. 1 and 6 | Render the package's **own** `ACCOUNTABLE NOT CURRENTLY ELIGIBLE` defect (`08-EMP-PROPAGATION-MATRIX.md:22`), naming T. Ruiz. **An eligibility lapse is never the absence of an accountable person** | **LAYOUT — back to Design** (the correct chip already exists in the package) | **NON-BLOCKING** for foundation; blocks the Responsibility surface's defect rendering |
| **`X-7`** `08-EMP-PROPAGATION-MATRIX.md:23`, `NS2-DSP-01 … r2.dc.html:109` | availability is *"(OD-6 state)"*, and the list of four is presented as the complete rendering | **#182 §3** — the state contract has four members and **none is availability**; **#187 §2** — `AUTHORITY_UNAVAILABLE` distinct, fail-closed, required in *"resolver · census · enforcement · audit · UI outcome vocabulary · tests"*, and rendered **nowhere** in the package | Four outcomes separately renderable (valid current · valid but not currently eligible · invalid/unresolvable · **authority unreachable**, failing closed); **availability is a fifth, orthogonal fact** and must not occupy one of those slots. *"not a broken reference"* and `ASSIGNEE UNAVAILABLE` are **correct and must be kept** | **BOTH** — a layout change (the fifth outcome must be rendered) **and** a semantic correction carried into engineering (**F4**) | **NON-BLOCKING** — **#187 §2** already rules the semantics, so F4 proceeds. Blocks the package's *"complete rendering"* claim |
| **`X-19`** `pages/NS2-EMP-responsibility.md:23` | *"USER IDENTITY → EMPLOYEE … linkage is one field + navigation"* | **#185** — *"CREDENTIAL → PRINCIPAL → EMPLOYEE LINK → EMPLOYEE"*; the crosswalk *"must not rely permanently on … `users/{uid}.employeeId`"* | **Three** concepts, not two, with the governed link between **principal** and employee. *"never a merge"* and *"an employee may exist with no login"* are correct and kept | **SEMANTIC correction carried into engineering**, with a layout consequence (the chain is drawn) | **NON-BLOCKING** — ruled by **#185**; F2/F3 proceed |
| **`X-20`** `08-EMP-PROPAGATION-MATRIX.md:18` | ADM People / User Access row: authority dependency `—`, status `COMPLETE` | **#187 §4** (`RECIPROCAL_FIREBASE_UID_LINK` retired as an authority, **still minted in code** at the baseline) · **#185** (`employee_principal_links` needs **real** FKs; `employee_id` FK absent) | State the dependency: a **governed** employee↔principal link with its own provenance (who / when / through which governed process / which employee / which principal). `COMPLETE` with a `—` dependency is not supportable | **SEMANTIC correction**, executed as a **layout/table edit back to Design** | **NON-BLOCKING** for foundation; blocks that row's status claim. Note it is the **surface expression of F2** |
| **`X-1`** `NS2-EMP Responsibility r1.dc.html:251`, `:70` | *"Accepting the visit … added the ACCOUNTABLE chip"*; *"until you accept, T. Ruiz remains accountable"* | **#187 §5** `M-1` — **REASSIGNMENT ≠ ACCOUNTABILITY TRANSFER**; assignment is a separate axis | **Already corrected by the Owner in v4.1**: `r2.dc.html:251` and `08-EMP-PROPAGATION-MATRIX.md:14` (*"Accept-transfers-accountability REMOVED as general rule"*). **`§27` must read `r2`** | **NEITHER — provenance hygiene.** `r1` is retained as ingest evidence and its filename differs by one character | **NON-BLOCKING**, but a live **mis-pickup risk** |

## 13. THE ELEVEN EXECUTABLE FIXES — READINESS

**Measured, not assumed.** Exactly **9 branches** descend from `64008d5a` carrying non-`docs/` changes
(`git branch --contains 64008d5a` ∩ `--no-merged 64008d5a` → 33 branches; 9 carry code), holding **16**
non-`docs` commits that group into **11 fix units** plus one reconciliation test (§15 correction 2).

| # | BRANCH / COMMIT | PURPOSE | TOUCHES EMPLOYEE/ACCOUNTABILITY FOUNDATION? | DEPENDS ON ANY OF THE 17? | SAFE TO INTEGRATE NOW? |
|---|---|---|---|---|---|
| 1 | `post/eng-a-audit-read` `acdd87b9` | Resolve `audit.event.read` against **both** Role catalogs in the Change History read | **NO** | **NO** | **INTEGRATION READY** |
| 2 | `post/eng-b-firebase-guard` `bd1f1287` | Fence the `firebase-admin` namespace-access bypass in the Firebase exit guard | **NO** | **NO** | **INTEGRATION READY** |
| 3 | `post/eng-b-firebase-guard` `bccf0759` | Ratchet the transitional Firestore shim boundary on **growth**, not existence | **NO** | **NO** | **INTEGRATION READY** |
| 4 | `post/eng-c-parity-vacuity` `276e0417` | deny/deny is a parity **observation**, not `CAPABILITY_PARITY_READY` | **NO** | **NO** | **INTEGRATION READY** |
| 5 | `post/eng-d-environment-fence` `129c485d` | Operator scripts refuse with no explicit environment | **NO** | **NO** | **INTEGRATION READY** |
| 6 | `post/eng-e-report-scope` `92db1d19` | Bind report runs to the runner's operating company | **NO** | **NO** | **INTEGRATION READY** |
| 7 | `rpt/…` `b8308e48` | Never return *"empty"* for an absence that was not proven | **NO** | **NO** | **INTEGRATION READY** |
| 8 | `rpt/…` `5d8193fb` | The audit-context fix missed six of nine call sites | **NO** | **NO** | **INTEGRATION READY** |
| 9 | `rpt/false-empty-and-audit` `510eba1c` + `8521cd88` | Activation-boundary guard asserted a false safety property; three guards registered in CI | **NO** | **NO** | **INTEGRATION READY** |
| 10 | `rpt/client-outcome-honesty` `9d3ab48d` + `d65be79c` + `8e28e32d` | Client told the user nothing was read when documents were; client mirrors ratcheted; kind contract | **NO** | **NO** | **INTEGRATION READY** |
| 11 | `fix/crash-diagnostics-flake` `3cead2c0` + `bcb91387` | Prove the crash-id keyspace deterministically, not by sampling; margin restated | **NO** | **NO** | **INTEGRATION READY** |
| — | `ext/reporting-reconcile` `e50b390e` | One false-empty **ordering** test against the remediation chain | **NO** | **NO** | **INTEGRATION READY** (reconciliation, not a 12th fix) |

**ZERO-TOUCH CLAIM — VERIFIED, all ten branches including `rpt/p0-blast-radius`.**
`git diff --name-only 64008d5a..<branch> | grep -Ei 'functions/src/ownership/|functions/src/employeeIdentity/|accountab|ownershipMatrix|typedOwner|ownershipCensus'` returns **NONE** on every one.
**So F10 is blocked by none of the 17, and the controller's premise is refuted for §11 as stated.**
**Nothing was integrated by this lane.**

## 14. THE ACCOUNTABLE-PERSON FIELD: PREREQUISITE OR FOLLOW-ON?

**The controller's claim tested: that introducing it is a prerequisite. PARTLY FALSE — it is a
prerequisite for F5/F6 to mean anything, and a follow-on to nothing among the 17 except `MI-ε`'s
enforcement mode.**

**Measured [@`64008d5a`]:** `git grep -niE "accountablePerson|accountable_person|accountableEmployee"` over
`functions/src`, `field-ops-app-vite/src` and `firestore.rules` returns **ZERO HITS**. **The field does not
exist in any form.** This is consistent with **#180**'s own note that invariant 1 *"is not currently
detectable"*.

| Record family | Requires it NOW | May defer | Authority |
|---|---|---|---|
| **Opportunity · Sales Agreement · Sales Order** | **YES — ruled** | — | **#181**: *"ACCOUNTABLE PERSON IS A SEPARATELY CARRIED BUSINESS FACT … not permanently derived from RECORD OWNER"*, with the creation rule **EXPLICIT VALID → GOVERNED DERIVATION FROM CURRENT COMMERCIAL RECORD OWNER → REFUSE** and *"its own lifecycle"* |
| **Service Work Order** | Storage **shape** yes; **who** no | the per-state holder | **#180** worked example separates the outcome holder from technician and escalation owner; **#186 §8/§13** reserve the workflow rule (§10) |
| **Purchase / Parts workflow** | Storage **shape** yes | — | **#180** worked example |
| **`inbound_work_requests` · the three email collections · Approval/Exception · Report-execution** | **NO — cannot be decided** | **YES** | **`OD-16`**. **#182 "3."** state **D** `NONE` applies *"only where the family legitimately permits no person reference"* — unclassified means undecidable |
| **Reference / master-data families** | **NO** | **YES** | **#180 invariant 9** — *"do not automatically require an accountable person merely because the field exists"*; stewardship is a separate decision |

### 14.1 Which shape

| Shape | Verdict | Reasoning from source |
|---|---|---|
| **(A) One generic accountability relation across families** | **COLLIDES with #180 invariant 10 — under one reading, and both are carried** | **Reading 1 — collides.** Invariant 10: *"Do **NOT** implement one generic `ownerId` / `accountableId` shortcut across all families"*, and **#180** adds *"**Invariant 10 means this ruling does not license adding a field**"*. A single relation keyed by (family, record, person) is the relational spelling of one generic `accountableId`. **Reading 2 — does not collide.** Invariant 10 prohibits a **shortcut** — one undifferentiated field standing in for per-family semantics — whereas a governed relation with per-family rules, per-family lifecycle and per-family census scoring is differentiated; and **#187 §1** *requires* an accountability measurement separable from ownership, which a relation supplies naturally. **This lane does not resolve it.** |
| **(B) Family-specific `accountablePerson` storage** | **ALREADY AUTHORIZED for the three commercial families, and for them only** | **#181** rules it a *"separately carried business fact"* on Opportunity / Sales Agreement / Sales Order with its own lifecycle — that **is** family-specific storage, ruled. **Explicitly forbidden**: `accountablePerson = ownerEmployeeId` as a permanent computed identity |
| **(C) Another already-authorized shape** | **The governed HANDOFF CARRIER already exists and is the only available one** | `M-2` resolves **by exclusion** (**#188** class B): `FIELD_CHANGE_ACTIONS` is a **one-member set** (`functions/src/access/auditEventWriter.ts:414-416`, `["updateEmployeeProfile"]`) and `:661-670` throws for anything else — so the field-change carrier is **structurally refused** for a responsibility move and the handoff carrier is the only one. **This is the movement mechanism, not the storage** |

**What is NOT available.** **`accountablePerson` must NOT be placed into `ownershipMatrix.ownerFields`**
(**#187 §1**, verbatim). So **(A)** may not be implemented by extending the ownership matrix under **either**
reading of invariant 10 — that path is closed independently.

**Conclusion, no architecture invented.** The foundation needs **(B) for the three `#181` families now**,
**(C) as the movement carrier**, and **(A) left unresolved** pending an Owner reading of invariant 10 — (A)
is not needed to start, because the only families whose storage is ruled are already family-specific. **So
the field is a FOLLOW-ON for every family except the three `#181` rules, and for those three a prerequisite
to F5 measuring anything.**

## 15. CORRECTIONS — to this lane's brief and to the artifacts it cites

| # | Claim | Correction | Severity |
|---|---|---|---|
| **1** | The brief's 17 lists **`per-state Service accountability`** and **`one consolidated Service lifecycle accountability decision`** as separate rows | **They are ONE decision at two refs.** `S-7` (`…EMPLOYEE-V41-RECONCILIATION.md` §6) and the unlabelled consolidated question (prior triage §3.3) ask the same thing; **#188** ratifies that it *"is asked **once**, covering all states together, not per status"*. **There are 16 distinct decisions, not 17.** Both rows are kept above so the count reconciles with the brief | **MEDIUM** — it changes the denominator |
| **2** | *"the **11** executable fixes"* | **11 fix units across 9 branches / 16 non-`docs` commits** — measured (§13). 11 is a defensible count of fix **units**, not of branches and not of commits. Stated so the number is reproducible | **LOW** — the substantive claim (zero-touch) is verified |
| **3** | The prior lane flagged that *"the seven design labels come from a design ref"* (`V-SVC`) | **`V-SVC` is now DISCHARGED, and against the design: four of the nine states requested do not exist at the baseline in any form** (§10). The consolidated decision must be re-framed over 11 shipped states, and the addition of new states is a **separate, prior** decision | **HIGH** — it changes what the Service decision is |
| **4** | The register claim that `MI-κ` gates naming an accountable person | **Re-verified refuted** on four independent grounds (§8), now including the positive occupancy fact that two business people exist with real `employeeId`s and **zero** `RoleAssignment`s (`be1e5579:…r32-production-exposure-census.md:70-78`). Confirms prior triage §5 correction 3 and **#188** | **MEDIUM** |
| **5** | The brief's framing that the controller's premise *"is already false for §11"* and to *"prove where"* | **Proven false for 6 of the 10 foundation items** — F1, F3, F4, F8, F9, F10 are blocked by **none** of the 17 — and for **all five** design contradictions, none of which is foundation-blocking. The premise holds only for **F5, F6, F7 and F2**, and there only via **three** decisions | — |

**Not corrected, and load-bearing:** the brief's instruction that a `NO` must name what it blocks instead is
honoured in §2.2 for all thirteen non-blocking rows.

## 16. CONFLICTS CARRIED — both readings

| # | Conflict | Reading A | Reading B |
|---|---|---|---|
| **`T-1`** | Does **(A)** one generic accountability relation collide with **#180 invariant 10**? | **Collides** — a relation keyed by (family, record, person) is the relational spelling of one generic `accountableId`, and **#180** says invariant 10 *"does not license adding a field"* | **Does not collide** — invariant 10 prohibits an undifferentiated **shortcut**; a relation with per-family rules and per-family census scoring is differentiated, and **#187 §1** requires a separable accountability measurement. **Unresolved here.** Either way **#187 §1** forbids `ownershipMatrix.ownerFields` |
| **`T-2`** | Is `X-37` (dual accountability) really non-blocking for **F7**? | **Non-blocking** — cardinality 1 is what **#180 invariant 1** rules and `MI-W` proves the exception list EMPTY, so single-valued storage is safe and a later exception is additive | **Effectively blocking on cost** — if the Owner later permits a handover window with two holders, F7's cardinality changes and the migration is expensive. **Cheapest moment to answer `X-37` is before F7 ships**, even though it does not gate it |
| **`T-3`** | `X-39` territory's class | **`C` UI/ADMIN** — a profile fact, per the design's framing | **`B` assignment family** — an assignment-model concept. **#187 §5** puts ASSIGNMENT outside `OD-7`, so either way it is not foundation |
| **`T-4`** | `MI-λ`'s standing | **Must rule now** — it gates F2 | **May dissolve** — if `V-λ` returns zero rows it is a schema rule settled before any row exists. **Ask `V-λ` first** |

## 17. UNPROVEN — carried, not re-investigated

`V-λ` (whether any row exists in the nine unconstrained person columns — **load-bearing for `MI-λ` and the
cheapest measurement on this list**) · `V-ε` (incidence of unrepresented actors) · `V-O1` (which namespace
stored owner ids occupy) · `V-U9` (`OD-8`'s exposure rests on static read; no emulator). All four inherited
unchanged from prior triage §4. **`V-SVC` is DISCHARGED** (§10).

## 18. FOUNDATION WORK THAT CAN START — the exact engineering sequence

**No Owner decision among the 17 blocks any of these.** Authorization remains separate and withheld
(**#184**); this is a decision-readiness sequence, not a work order.

| Stage | Work | Blocked by | Why it is unblocked |
|---|---|---|---|
| **S0** | **Integrate the 11 executable fix units** (§13) | nothing | Zero-touch verified against all four foundation patterns on all ten branches |
| **S1** | **F1 — canonical PostgreSQL Employee authority** (items **A**, **B**, **C**) | nothing | Authority ruled **#185**; status vocabulary already shipped and *"needs nothing new"* (**#186 §4**); retention semantics ruled (**#180** inv. 6, **#182 "2."**, **#186 §7**). New DDL has no legacy rows, so `MI-λ` does not reach it |
| **S2** | **F3 — Employee authority port** (item **G**) | nothing | The port's contract is fully ruled: **#182 §3** four states · **#186 §5** five cases · **#185** resolution chain · **#186** resolution/eligibility separation. `MI-γ` (Employee only, no live principal link) and `MI-δ` (not Rules-enforceable) are **derived**, **#188** |
| **S3** | **F4 — distinguish `AUTHORITY_UNAVAILABLE`** | nothing | **#187 §2** rules it distinct and fail-closed and enumerates every place the distinction must appear. **No naming is frozen here** |
| **S4** | **F8 — `OD-7` orchestration skeleton** (item **I**) | nothing | Sequence ruled verbatim by **#183**/**#184**; carrier determined by exclusion (`M-2`, **#188**); axis scope ruled (**#187 §5**) |
| **S5** | **F9 — bypass census** | nothing | **#184** *"Bypass paths are DEFECTS"* **requires** the end-to-end call-path census; `OD-8` is a defect to fix, not a policy to choose (**#188**). Inherits `V-U9` as a measurement |
| **S6** | **F7 (shape only) — accountable-person storage for the three `#181` families** | `MI-ε` for the **refusal behaviour** only | **#181** rules the fact separately carried with its own lifecycle and gives the creation rule. Build the shape and the governed creation path; leave the refusal mode switched off |
| **S7** | **F2 — constrain `employee_principal_links`** | **`MI-λ`** (and ask `V-λ` first) | Ready the moment the disposition is declared; item **D**'s target is already named in the migration's own text |
| **S8** | **F5 — dedicated Accountability Census** | **`OD-16`** | Architecture ruled (ii) at **#187 §1**; only the family denominator is missing |
| **S9** | **F6 — compose census into the enforcement gate** | **`OD-16`** then **`MI-ε`** | Last, by construction: it is the act of refusing |

**S0–S5 are blocked by nothing. S6 is blocked only in its enforcement mode. S7, S8 and S9 are blocked by
exactly three decisions.**

## 19. WHAT THIS DOCUMENT DELIBERATELY DOES NOT CONTAIN

**No answer to any of the 17** — options and, where cited evidence supports one, a recommendation.
**No naming frozen** — not the `OD-6` person-reference states, not a job-role value, not an accountability
field, not a register id for the Service decision, not a state-machine state.
**No implementation, schema, DDL, migration, Rules change, backfill, integration, deploy, data mutation, UI
or PR**; no branch merged, pushed, rebased or force-updated; **nothing integrated**.
**No research agenda, no new census, no archaeology** — every fact is a read of `64008d5a` or a named ref.
**No reopening** of `OD-1`, `MI-N`, `OD-6`, `OD-7`, `MI-ι`, `MI-S`, `MI-Y`, `M-4`, `M-1`, `MI-P`, `MI-Q`,
`MI-R`, `MI-θ`, `AUTHORITY_UNAVAILABLE` or the link-provenance ruling. **No edit to any other file.**
