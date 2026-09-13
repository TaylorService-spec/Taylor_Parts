---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
---

# EMPLOYEE ATLAS HANDOFF

**OBSERVED AT: 64008d5a.**

**What this document is.** The **preconditions** that must be true before any North Star family can be
considered **operationally complete** — stated as **tests**, with the decision that gates each.

**What it is not.** **Not an Atlas artifact.** This synthesis is **upstream of** Atlas, not part of it —
and **`docs/atlas/**` was never written to and does not exist at this baseline** (confirmed by four
independent checks in EMP-EXPERIENCE §9: `ls docs/atlas`, `find -type d -name design-r1`,
`find -iname '*atlas*'`, `git ls-files | grep -iE 'atlas|design-r1'` — **there is no `atlas` path of any
kind**). **Design r1 artifacts are absent and are neither referenced nor reconstructed.**

> **NOTHING BELOW IS AUTHORIZED. Every gate is a PRECONDITION, not a plan.** Where the honest
> precondition is *"rule on this before building anything"*, that is what the gate says.

---

## 1. THE TWO SENTENCES THAT BOUND ANY EMPLOYEE-FACING NORTH STAR WORK

Both are already in the repository, and **this synthesis does not weaken either:**

> **"Do NOT turn EOS into a simplistic employee-scoring system."**
> **"Do NOT infer compensation or performance policies that Taylor has not stated."**

**They are not this programme's invention.** The repository holds the same position in **three** places
(EMP-PERFORMANCE §0):

| Where | Verbatim |
|---|---|
| `TechnicianPerformance.jsx:6-7` | *"The Owner's direction is explicit: **'Do not reward throughput alone. Visually balance PRODUCTIVITY, ON-TIME EXECUTION and QUALITY.'**"* |
| `performanceGoalAuthority.ts:52` | *"The Owner: **'Employees do NOT automatically manage their own targets.'**"* |
| `DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md:746` | *"**Do not reward throughput alone.** The direction is explicit that productivity, on-time execution and quality must be visually balanced"* |

> **THESE THREE ARE THE ONLY OWNER-STATED PERFORMANCE DIRECTION REACHABLE AT THIS BASELINE. All three
> are about the SHAPE of a performance surface. NOT ONE OF THEM STATES A CONSEQUENCE** — no pay, no
> review, no ranking, no threshold. **That absence is the strongest single finding in the performance
> lane, and it is recorded as MISSING INPUT, not filled in.**

**And the test EMP-PERFORMANCE adopts for every proposed metric, in the platform's own words:**

> *"a screen that showed a completion count and stopped would read as though **throughput IS the job** —
> not because anyone claimed it, but because it would be the only number on the page, **and the only
> number on a page is the score.**"*

---

## 2. RECONCILIATION WITH THE ALREADY-SHIPPING NORTH STAR

**`docs/north-star/financials/` (20 pages) is referenced and reconciled, NEVER contradicted and never
restated.** EMP-PERFORMANCE §2.1 reconciled page 15 row by row: **5 AGREE, 3 EXTEND, 2 CONFLICT-narrow.**
The corrections that must reach Atlas:

| # | The North Star says | Finding at `64008d5a` | Class |
|---|---|---|---|
| **N-1** | §4/§10: *"view seg (Salesperson credit / Service responsibility — **never merged**)"* | **CORRECT AND STRONGER THAN IT KNOWS.** `creditedSalespersonId` and `responsibleEmployeeId` are two separate NULLABLE dimensions on one frozen snapshot | **AGREE**, reinforced |
| **N-2** | §10: *"`creditedSalespersonId` ≠ `ownerEmployeeId` ≠ `createdBy` ≠ `responsibleEmployeeId` — labelled per row"* | **VERIFIED IN CODE.** `creditedSalespersonId` resolves through `resolveCreditedSalesperson(...)` distinctly from `ownerEmployeeId` | **AGREE** |
| **N-3** | §9: *"DENIED = named withheld panel (never zeros, never silent absence)"* | **THE SERVER IS AHEAD OF THE DESIGN.** `performanceGoalReadService.ts:44-54` implements exactly three distinct absences and **forbids collapsing them**: *"Collapsing these into one empty state is how 'you may not see this' becomes 'there isn't one.'"* | **AGREE** |
| **N-4** | §10: *"All values are **Certification World specimen fixtures** showing the shape of the read, not live claims"* | **STALE — THE SURFACE SHIPPED WIRED.** `FinancialsEmployeePerformance.jsx` (181 lines) reads the **real** callable `listFinancialFacts` via a **server-side `byCreditedSalesperson` rollup**, with **no fixture or mock import.** It renders **Person · Basis · Billed · Collected · Outstanding · Goal.** **Its emptiness in production is a CAPABILITY fact (`finance.read` inactive, sandbox-only), NOT a design placeholder.** *The North Star's conclusion is right for the wrong reason* | **CONFLICT (narrow)** |
| **N-5** | §10 implies the four attribution axes are each usable | **`responsibleEmployeeId` IS DECLARED AND NEVER POPULATED.** It exists only in the snapshot builder; nothing outside it ever supplies it. **The component says so itself: *"No governed financial read exposes a responsible-employee dimension, so this view HAS NO ROWS TO SHOW — and credit rows are not relabelled to fill it."*** **So the "Service responsibility" view is STRUCTURALLY EMPTY, not merely unactivated** | **EXTEND** |
| **N-6** | §11: *"billed reads pending activation"* | **NOW STALE IN ONE DIRECTION.** `sales.billed.amount` and `sales.collected.amount` were **ACTIVATED** by Decision #163. **The surviving blocker moved from the METRIC to the PRINCIPAL'S FINANCE REACH** | **EXTEND** |
| **N-7** | §12: FIN-004 named as primary dependency (OPEN) | **SHARPENED BY EXECUTED EVIDENCE:** `finance.visibility.self`/`.team`/`.businessUnit`/`.company` are **dead in EVERY environment**; only `.consolidated` is activated anywhere. ***So the SELF and TEAM views the North Star draws are PRECISELY THE TWO THAT CAN RESOLVE NOTHING***, and **the DENIED withheld panel is the NORMAL state for a salesperson, not the exception** | **EXTEND** |
| **N-8** | §13-14: *"Capabilities (CONCEPTUAL — exact governed IDs TBD)"* | **THE TBD IS CLOSEABLE.** The ids exist and are enumerable: `performance.goal.{read,create,approve,supersede,retire}` | **EXTEND** |
| **N-9** | §15: **"DESIGN GAPS — None."** | **DISPUTED ON SCOPE, NOT ON DESIGN. The page has NO CONTEST AFFORDANCE** — no way for a measured person to dispute a number attributed to them. *"The North Star is a FINANCIAL surface and may reasonably say credit disputes are out of its scope — **but then the gap belongs to somebody, and today it belongs to nobody.**"* | **CONFLICT (narrow)** → `OD-15` |
| **N-10** | §17: `FIN-PQ-15a` margin visibility by person | **CONFIRMED UNANSWERABLE, AND CORRECTLY SO.** *"Margin is STRUCTURALLY unknown — not missing data, but an UNRULED AUTHORITY"* | **AGREE** |
| **N-11** | Title: *"Salesperson & Employee Performance"* | **The title MERGES what §4/§10 SEPARATES.** Sales credit and employee performance are different axes (BUSINESS OUTCOME vs EMPLOYEE PERFORMANCE) | **NOTE, not a conflict** — the body already separates them |

**And one authority split Atlas must not conflate** (`AU-10`, EMP-PERFORMANCE OD-EMP-018):

> **THERE ARE TWO GOAL AUTHORITIES.** **`performance_goals` / `performance.goal.*`** — machinery
> **genuinely complete** (five capabilities, six callables, a metric registry, a subject Role), *"the
> clearest counter-example to 'nothing is built': **what is missing is an ACTIVATION DECISION, NOT
> CODE**"* — and **FIN-003 plan records (GOAL mode)**, an **AUTHORITY GAP** (*"goal records have no
> collection, no command, no read callable"*). **A target set through `performance.goal.create` does
> NOT populate the financial Goal column, and vice versa. NEVER SAY "GOALS EXIST" OR "GOALS DO NOT
> EXIST" WITHOUT NAMING WHICH AUTHORITY.** The shipped page is blocked on the **second** and says so.

---

## 3. THE ONLY TWO GOVERNED FACTS THAT CAN NAME A PERSON

**This is the hardest constraint on any employee-facing North Star surface** (EMP-PERFORMANCE §2.5,
OD-EMP-017):

| Field | Verdict |
|---|---|
| **`creditedSalespersonId`** (Opportunity · Agreement · Sales Order · Invoice) | **GOVERNED, server-stamped, FROZEN.** Caller may *propose*; server resolves explicit → inherited → commercial owner → `null`. **Clearing is REFUSED**: *"cannot be cleared, only reassigned."* And *"FIN-002: sales credit, frozen at creation. Distinct from `ownerEmployeeId`; **never the actor**"* |
| **`assignedTechId`** (`fieldops_wos`) | **GOVERNED, server-stamped** — set only by `transitionWorkOrder` (Dispatch), with a double-booking guard; client `create, update, delete: if false`. **BUT MUTABLE AFTER COMPLETION and carrying NO PER-TRANSITION ACTOR** — *"a WO that's since been CLOSED by a dispatcher still counts as completed by this technician"* |
| `ownerEmployeeId` | GOVERNED, **and explicitly NOT credit**: *"OWNERSHIP != SALES CREDIT"*; *"Moving the OWNER does not move credit (test-pinned)"* |
| `createdByUid` | GOVERNED — `ctx.actorUid`, **never from the payload** |
| **`responsibleEmployeeId`** | **DECLARED, NEVER POPULATED** |
| **`accountOwner`** | **CLIENT-WRITABLE, and unpopulated — sandbox 0/103** |
| **`createdBy` on Work Orders** | **ABSENT.** `createWorkOrder.ts:78-99` writes **no creator field at all.** The actor survives **only** as an Audit Event — **and the audit collections are DENY-ALL** |
| **`createdBy` on Accounts** | **ABSENT** — `grep -n "createdBy" firestore.rules` returns **no output** |

> **A METRIC CAN BE ATTRIBUTED TO A PERSON THROUGH EXACTLY TWO GOVERNED FACTS. Everything else is
> absent, unpopulated, or client-writable.** And ownership non-collapse is **ratified while being
> INERT** — `SYSTEM_AUTHORITIES.md:116`: *"`currentOwner` … `explicitTitleHolder` … `assignedTo`, and
> `createdBy` are **presumed distinct** and are not ownership. **Inert:** no Rules enforce ownership, no
> writer stamps it, no backfill has run."*

**And the axis discipline that must survive into Atlas** (EMP-PERFORMANCE §1): eight axes, and
**EMPLOYEE PERFORMANCE is the smallest of them.** *"Technician utilisation" is **CAPACITY**, not
employee performance. "First-time completion" is **QUALITY**. "Overdue unassigned work" is **PROCESS
HEALTH**.* **The repository already enforces this in code rather than asserting it in prose: the four
active service queue metrics are registered at `FIRM` scope only, so a past-due count CANNOT BE POINTED
AT A PERSON EVEN IF SOMEONE WANTED TO.**

> **Of the 12 registry-active metrics: 7 are PROCESS HEALTH or EXCEPTION · 2 WORKLOAD · 3 BUSINESS
> OUTCOME. ZERO ARE EMPLOYEE PERFORMANCE AS MEASURED. Only 4 of 37 registered metrics are both
> `EMPLOYEE`-scoped AND active. That is the answer to the performance lane's purpose, and it is A
> FINDING RATHER THAN A SHORTFALL.**

---

## 4. THE FOURTEEN GATES — what must be true before any North Star family is operationally complete

**In dependency order. Each states the TEST, the EVIDENCE, and the DECISION that gates it.**

| # | GATE | TEST that closes it | Why it precedes implementation | Gated by |
|---|---|---|---|---|
| **G1** | **Rule whether ACCOUNTABLE PERSON is an axis at all** | *"For a named actionable item, exactly one person resolves, and the resolution is auditable and contestable"* | **20 COMPANY-owned families wait on it; it gates every other accountability decision — and ANSWERING IT BY ADDING A FIELD IS EXACTLY WHAT THE DISCOVERY RULE FORBIDS** | **`OD-1`** |
| **G2** | **Make the person axis referentially honest BEFORE the census gates enforcement** | The orphan join returns **a non-zero, reportable count where orphans exist** | **The census is the instrument the gate depends on and it is STRUCTURALLY BLIND to person-level orphans. Enforcement could be switched on against a census reading zero while orphans exist. A MEASUREMENT CHANGE, NOT A BACKFILL — and a PREREQUISITE, NOT A FOLLOW-UP** | **`OD-6`** |
| **G3** | **Close the handoff-validation authority question** | The **live** writer refuses **every** case the builder refuses | **EXECUTED: the live audit writer accepts a handoff of an invoice, a part, an audit event, or a nonexistent family. WIRING ANYTHING BEFORE THIS IS DECIDED PRODUCES THE CORRUPTION THE MATRIX EXISTS TO PREVENT** | **`OD-7`** |
| **G4** | **Narrow or accept the ownership-write exposure** | A Rules test: an `admin`/`dispatcher` client `update` changing **only** `accounts.accountOwner` is **REFUSED** | **Four owner fields are rewritable by any `admin` or `dispatcher`, unguarded and unaudited — and PRODUCTION'S ONLY PRINCIPAL HOLDS EXACTLY THAT ROLE. Rules themselves call it an "INTERIM path"** | **`OD-8`** (and **`U-N` must be EXECUTED first** — the finding rests on STATIC READ) |
| **G5** | **Supply the 12 physical-root company assignments** | Census reports `warehouses` **5/5** and `mobile_locations` **7/7**, and a reorder request is created **without `WAREHOUSE_NO_COMPANY`** | **Orphanhood PROPAGATES to every location-derived family, and the live, complete, fail-closed reorder path is REFUSING EVERY REQUEST IN EVERY ENVIRONMENT. INFERENCE IS EXPLICITLY FORBIDDEN, SO THE GAP CANNOT BE CLOSED BY A DEFAULT** | **`OD-9`**, **`OD-23`** |
| **G6** | **Decide whether company ownership is a user-visible fact or an internal scoping key** | Every stored company fact is **either rendered and reportable, or explicitly declared internal** | ***"It must be answered BEFORE the census gate, because A FACT NOBODY CAN SEE CANNOT BE VERIFIED BY THE PEOPLE ACCOUNTABLE FOR IT"*** | **`OD-10`** |
| **G7** | **Grant at least one human a governed business Role, and decide the honest sentence at zero occupancy** | A role-keyed queue **opens for a real holder**, and a zero-occupancy refusal says *"no one currently holds this authority"* rather than naming a ghost | **Production occupancy is MEASURED ZERO. Every role-keyed queue, every "ask X" sentence, and three of the six "My Work" buckets are MEASURED-EMPTY. NINE OF FIFTEEN ESCALATION SENTENCES WOULD RENDER A DEAD END** | **`OD-2`**, **`OD-25`** |
| **G8** | **Rule the authoritative JOB ROLE vocabulary and its mapping to the 48 security Roles** | Every corpus job resolves to **exactly one** governed Role or is **explicitly declared not a role** | **INDEPENDENT OF G7. Grant every Role tomorrow and a role-shaped queue becomes NON-EMPTY AND KEYED ON THE WRONG THING: 29 of 45 Roles have no corpus label and 51% of authored work names no Role at all. OCCUPANCY AND VOCABULARY ARE TWO INDEPENDENT PREREQUISITES** | **`OD-3`**, **`OD-3b`** |
| **G9** | **Rule the canonical owner id namespace** | One namespace resolves for all eight affected families | Open item **O-1** is explicitly still open: *"the ruling named the TYPE, not the IDENTIFIER."* **Both are in live use** | **`OD-4`** |
| **G10** | **Mark the superseded documentation superseded, and correct the stale descriptions** | **No matrix row describes storage or a policy the code contradicts**, and `record-ownership.md` §1/§4/AC-7 carry an explicit supersession notice | ***"A lane reading the named evidence in order would adopt the wrong rule" — AND TWO LANES DID.*** *"Correct code that cannot be audited against its own description"* is **the worse failure mode** | **`OD-5`** (documentation, not design — **but conflict `O-1` needs Owner adjudication, not a fix**) |
| **G11** | **Decide whether a governed "I could not complete this" outcome exists** | A technician records *"could not complete, and why"*, **and every on-time and completion metric excludes it explicitly rather than silently** | **The most-cited gap in the corpus. Without it, the only expressible answer to an unavailable technician is `Cancel` — which DESTROYS THE COMMERCIAL RECORD — and every metric is computed over a population that excludes the real day** | **`OD-13`** |
| **G12** | **Classify `inbound_work_requests` and the three email collections; decide whether Approval/Exception and Report-execution are families** | **Every live collection carrying a governed company fact has a classification** | ***"A collection absent from this file would be indistinguishable from one nobody thought about"* — FOUR SUCH COLLECTIONS EXIST, one of them the FIRST OBJECT IN THE SERVICE CHAIN, *"precisely where accountability must begin"*** | **`OD-16`** |
| **G13** | **A CONTEST PATH must exist before any number is presented as EMPLOYEE PERFORMANCE** | A person **sees their own figure and can dispute a misattributed completion**, and the dispute is **auditable** | ***"No annotation or correction path exists for a misattributed completion, so IMMUTABLE EXECUTION DATA BECOMES UNCONTESTABLE PERFORMANCE DATA."*** The evidence that would settle a dispute **exists and is unreadable.** **AND A PERSON-ATTRIBUTED NUMBER HAS ALREADY SHIPPED WRONG ONCE — `-1686m` on a real technician's screen — AND THE BAD RECORDS WERE NEVER REPAIRED, ONLY THE DISPLAY** | **`OD-15`**, **`OD-36`** |
| **G14** | **Rule field-level visibility (G35) BEFORE commercial activation** | A technician **cannot read pricing, rates, tax or totals** on a document they can otherwise open | ***"Every manager-only boundary is currently enforced by WHAT HAPPENS TO BE SWITCHED OFF. Activation is the cheapest change in the programme and IT OPENS THE BOUNDARIES BEFORE THE MECHANISMS THAT SHOULD GOVERN THEM EXIST."*** And today the absence **fails in the PERMISSIVE direction** | **`OD-14`** |

---

## 5. PER-FAMILY: WHAT "OPERATIONALLY COMPLETE" WOULD REQUIRE

**Each row states the gates that family cannot clear. Nothing here is scheduled.**

| North Star family | Cannot be operationally complete until | Because |
|---|---|---|
| **Employee Performance** (page 15) | **G13** (contest path) · **G7** (occupancy) · **G8** (vocabulary) · `OD-17` (finance reach) · `OD-34` (labour) | **Only two governed facts can name a person; `responsibleEmployeeId` is declared and never populated, so the "Service responsibility" view is STRUCTURALLY EMPTY.** `finance.visibility.self`/`.team` are **dead in every environment**, so **the DENIED panel is the normal state.** **And `performanceGoalSubject` — the Role whose entire purpose is letting a measured person read their own target — has ZERO HOLDERS EVEN IN THE SYNTHETIC ROSTER** |
| **Service / Work Order** | **G5** (roots) · **G11** (non-completion) · **G1** (accountability) · `OD-16` (company on the WO) | **The Work Order has NO company field and NO accountable person**, `DECISIONS #143` forbids inferring the company, `WF-SVC-016` step 3 is *"impossible"*, and **past `Dispatch` the only exit is `Cancel`** |
| **Dispatch / Scheduling** | **G7** · `OD-13` · and the blocked-time union defect (**conflict `W-6`**) | **The recommender does not know about PTO**; the collision is not surfaced; **two identical 8-hour PTO records draw SIXTEEN HOURS BLOCKED ON AN EIGHT-HOUR LANE**; and there is **no shift-handover surface** |
| **Inbound Work / Service Intake** | **G12** (classification) · `OD-28` (time-of-day authority) · `OD-17` (`service.inboundWork.read` is `active:false`) | **The only real queue in EOS filters on `status` only, DENIES EVERY PRINCIPAL, is absent from all 51 matrix families, has no assignee step, and NOTHING ESCALATES BY CONTENT** |
| **Inventory / Parts / Reorder** | **G5** (roots) · `OD-17` (approval verbs) · `OD-18` (`currentOwner`) · `OD-16` (reassignment) | **The live path refuses every request in every environment**; **the Parts Manager who raises a request cannot approve one**; **the only "owner" the user sees is a role queue and the real owner is never rendered**; and **there is no reassignment branch and no reverse edge** |
| **Financials / Billing** | `OD-33` (break-fix billing) · `OD-34` (labour) · `OD-17` (finance reach) · **G6** | ***"THE BUSINESS CANNOT BILL A CUSTOMER FROM EOS TODAY IN PRODUCTION"* [EXECUTED]**; **`billingQueue.ts` has zero importers**; labour is **dead in every environment**; and **margin must render UNKNOWN, never 0%** — the cost engine is *"425 lines and imported by nothing"* |
| **Sales / Commercial** | **G14** (field-level visibility, **before activation**) · `OD-20` (the channel/coverage collision) · `OD-30` (approval thresholds) · `OD-17` | **NOT ONE production-reachable capability is commercial**; every `opportunity.*` id resolves **DENY for all 48 roles**; `salesOrder.fulfill`/`.service` reach **NO governed business Role**; **after acceptance *"a renegotiation has no governed move"*; and *"a Salesperson may bind the same terms a General Manager can"*** |
| **Reporting** | **G2** (person-axis honesty) · `OD-10` (row scope) · `OD-17` (the owner dimension) · `OD-32` (export) · **and the LIVE false-empty defect** | **Row scope is hardcoded GLOBAL, bypassing the scope model in BOTH directions**; row scope is closed for **ZERO of four** reachable objects; **the only owner dimension is `active:false`**; **`report.export` does not exist anywhere**; and **a bounded 20,000-doc page can return "no records matched" FALSELY, audited as `outcome: "applied"`** |
| **Administration / Access** | **G7** · **G8** · `OD-35` (activation/grant coupling) · `OD-36` (readable audit) · `OD-39` (onboarding) | **9% finishable**; **`Employees` has no row in ANY of the four access tables**; employee create is **a Node script**; **audit is written and unreadable**; and **nothing on the Role screen says what `active:false` means** |
| **Goals / Targets** | **G7** · `OD-17` (all five capabilities `active:false`, sandbox-only) · **`AU-10`** (which authority) | ***"The goal machinery is genuinely complete… what is missing is an ACTIVATION DECISION, NOT CODE."*** **But `performance_goals` has NO Rules match block, `performanceGoalSubject` has zero holders, and THERE ARE TWO GOAL AUTHORITIES that must not be conflated** |
| **My Work / Dashboard** | **G1** · **G7** · **G8** · `OD-6b` (team) | **Three of the six buckets cannot be built at all; one has a working key; two need a union across four heterogeneous fields — AND THE KEY FOR THE OWNED BUCKET IS CLIENT-WRITABLE AND UNAUDITED** |
| **Manager / Team views** | **G14** · `OD-6b` · `OD-15` · `OD-36` | ***"NO TEAM ENTITY EXISTS"***; *"EVERY salesManager sees EVERY salesperson"*; **six of seven manager exception queues sit over a commercial spine that is off**; and **the eleven Roles declaring `audit.event.read` are refused by the deployed service** |

---

## 6. WHAT MUST NOT BE BUILT, AND BY WHOSE AUTHORITY

**Carrying these forward is as important as carrying the gaps.** (EMP-PERFORMANCE §6, §2.3)

| Do not build | Authority |
|---|---|
| **Any composite employee score, index, rating or ranking; any leaderboard or peer/stack ranking** | **The failure mode the lane exists to prevent, and it has NO AUTHORITY: the only aggregation rules in the registry are `SUM` and `RATIO_OF_SUMS` over ONE metric — *"nothing in the repository permits combining metrics into one figure. ADDING A WEIGHTING WOULD BE MINTING POLICY."*** And comparison *"inherits every attribution defect… with no indication of which numbers are sound"* |
| **Technician utilisation as an employee metric** | **A NAMED REFUSAL, twice over:** the registry's own blocker — *"**Whether such a figure may exist at all is the open question, not merely how to compute it**"* — **and the ratified DO-NOT-BUILD list.** *"Reported as a defect it would invite someone to 'fix' it by computing a number the registry DELIBERATELY REFUSES"* |
| **Everything else on the DO-NOT-BUILD list** — AOV · pipeline value · first-time fix · SLA/response · callbacks · parts-delay impact · WO aging buckets · jobs-per-workday · stockout rate · inventory aging · inventory value/turns/carrying cost · **waste avoided** · emergency-purchase rate · PO cycle time · supplier on-time · cross-domain activity roll-up · notification history | ***"The DO-NOT-BUILD list IS DESIGN AUTHORITY TOO"*** — reserved as *"named absences so a later session does not re-derive them."* **RE-PROPOSING ANY OF THEM IS RE-DERIVING A NAMED ABSENCE** |
| **Commission, sales-credit split, or any pay-linked metric** | **DECLINED, NOT DEFERRED.** `NOT_SUPPORTED`: *"Coverage explicitly records no precedence, credit or commission, **and nothing else in EOS does either**"*; **no commission module exists.** **Proposing one would infer a compensation policy Taylor has not stated — DIRECTLY PROHIBITED** |
| **Any metric carrying a threshold, band, target value or pass/fail line** | **A THRESHOLD IS A POLICY**, and the repository refuses invented values **by name** — *"adopting an industry-standard percentage is expressly refused: the number would be invented, not measured"*; *"Inventing an expected date is expressly refused."* **TARGETS ARE THE OWNER'S TO SET THROUGH `performance.goal.create`** |
| **Any metric derived from job title, seniority, certification or proficiency** | **Title comparison is *"expressly forbidden"*** (`performanceGoalAuthority.ts:93`), and **proficiency is wholly unmodelled** — *"Nothing warns."* **A competence metric over an unmodelled competence would be PURE INVENTION ABOUT A PERSON** |
| **Any operational metric scoped to an operating company or business unit** | `DECISIONS #143` **forbids inferring it**, and the ownership config is *"configuration only, **NOT applied to any record**"* |
| **Any per-channel sales metric** | **A DEFERRED MODEL, not a measurement-design gap.** *"record and preserve the seams, do NOT build during the runway"* |
| **A TEAM-scoped metric of any kind** | ***"NO TEAM ENTITY EXISTS."*** A manager may still **VIEW** a rollup over their visibility set — *"it is not a team, and **it cannot be the durable target of a stored goal**"* |
| **A corpus-derived exception rate for any commercial role** | **P3-B3 carries no friction, coverage, device or company tags. Such a rate would report MISSING INSTRUMENTATION AS GOOD PERFORMANCE** |
| **Any BUSINESS OUTCOME metric for General Manager or Service Billing Admin** | **0 of 9 and 0 of 5 finishable workflows.** *"Not because the outcome is undefined, but because **no workflow that would produce it can complete**"* |
| **A second metric registry** | `performanceMetricRegistry.ts` **exists, is test-pinned at 37/12, and carries every blocker by governed id. EXTEND IT; DO NOT MIRROR IT** |
| **A generic `ownerId`, or any field that collapses two of the nine concepts** | The standing Owner rulings, **and the fact that four of the nine concepts must first EXIST** |

### 6.1 And nine deliberate refusals that must not be "simplified"

**Each is a GUARD, and each was written AFTER SOMETHING WENT WRONG.** (EMP-PERFORMANCE handoff item 9)

| Guard | Why it exists |
|---|---|
| **`blocked(...)` registry entries** | **Named refusals, NOT stubs.** *"The file computes NOTHING. There is not one measurement in this module and there must never be one"* |
| **`NOT_ENABLED` rather than `UNAVAILABLE`** | **Deliberate and assistive**: `UNAVAILABLE` carries `role="alert"`, and *"announcing it as an alert would train a technician to ignore alerts"* |
| **`FIRM`-only scope on the four service queue metrics** | **So a past-due count CANNOT BE POINTED AT A PERSON even if someone wanted to** |
| **The withheld panel** | *"DENIED = named withheld panel (never zeros, never silent absence)"* |
| **The refused rollups** | *"summing two technicians' all-time counts answers no question a manager asked, and **the sum grows with tenure rather than with performance**"*; *"Summing open assignments across technicians measures BACKLOG, not performance"* |
| **`MAX_TARGETS_PER_READ = 40` REFUSING rather than trimming** | *"trimming would answer a different question than the one asked **and say nothing about having done so**"* |
| **One contradictory record WITHDRAWS THE WHOLE AVERAGE** | The fix to `-1686m` was **NOT `Math.abs()`, NOT `Math.max(0,…)`, NOT a timestamp swap** — *"Each of those turns evidence the platform cannot explain into a plausible number, **which is worse than showing nothing: it is unfalsifiable**"* |
| **A gated module HOLDS ITS PLACE** | *"Re-ranking a dashboard around what happens to be available today **teaches the reader that availability is importance**"* |
| **`currentOwner`'s naming collision left deliberately unresolved** | **Tier-2 Rules risk; `firestore.rules` is HASH-ANCHORED to the live deploy.** *(And the remedy is contested — `OD-18`)* |

---

## 7. WHAT EOS GETS RIGHT AND MUST BE PROTECTED EXPLICITLY

**EMP-ACCOUNTABILITY's conclusion 11, carried verbatim because it is the list most at risk of being
optimised away:**

> `creationOwnerResolution.ts`'s **six named forbidden fallbacks** and the assistant case · the
> **no-cascade handoff** · **`companyScopeField`'s defence of salesperson ownership against company
> scope** · **coverage-is-not-ownership** · **title-is-not-ownership** · the `currentOwner` naming
> collision **left deliberately unresolved** · and the **H20 audited dispatch reassignment with a
> required reason.** **These are the model's load-bearing correct parts.**

**Add four more this synthesis judges equally load-bearing:**

| # | What is right |
|---|---|
| 1 | **The assistant case, implemented, tested and correct:** *"Customer owner = Rudy. An assistant calls `createOpportunity` with no `ownerEmployeeId`. Result: **owner = Rudy, `createdBy` = the assistant**."* **The Owner's ruling "an assistant creating a record does not acquire ownership by acting" is the STRONGEST PART OF THE MODEL and must not be weakened** |
| 2 | **`reassignWorkOrderTechnician` as a SEPARATE AUDITED ACTION** from `OWNERSHIP_HANDOFF`, with a **required reason** — *"the only audited person-change in the platform"*, and **the code-level proof that reassignment ≠ ownership transfer** |
| 3 | **R-20's accept-in-storage / refuse-in-assignment asymmetry** — *"Storage validity and assignment eligibility are different questions… **deliberately and not by oversight**"* — **already the correct semantics for a departed employee, on the wrong axis** |
| 4 | **The honest-state vocabulary and the offline intent queue.** 13 states distinguishing `EMPTY` from `NO_MATCHES` from `DENIED` from `NOT_ENABLED` from `UNKNOWN`; and a dependency graph with **no optimistic local quantities** — *"there is no second source of truth for quantities."* **These are the two places EOS's engineering is ahead of its design, and both are under-adopted rather than wrong** |

---

## 8. THE FIVE THINGS TO CARRY FORWARD FIRST

**Not a plan and not a priority ruling — the five places where the evidence is strongest and the cost of
getting it wrong is highest.** (EMP-EXPERIENCE §12, adopted and extended)

| # | Carry forward | Why first |
|---|---|---|
| **1** | **Attach WHY / NEXT / RECOVERY to every state** | `NO_NEXT` **261/660** · `NO_WHY` **216/660** · `RECOVERY_UNCLEAR` **195/660**. **It is ONE defect, it is the largest, and it is mostly an ENGINEERING GAP — the facts usually exist.** And `NOISE_PAGE` = **4/660**, so **nothing in this evidence supports stripping explanation to make surfaces cleaner** |
| **2** | **Name the escalation owner on every refusal — composed from three resolved facts, degrading honestly** | **69 `PERMISSION_DENIAL` activities whose recovery is *"find someone"*, one of them *"a genuine structural dead end."* Requires `OD-11c` and nothing else** |
| **3** | **Keep the six buckets distinct, and render the three that cannot be built as STATED ABSENCES** | **Three of six keys do not exist; production occupancy is zero. A single "My Work" list would make all of that INVISIBLE** |
| **4** | **Distinguish EMPTY from NOT-LINKED from CAPABILITY-OFF everywhere** | **The one start-of-day requirement EOS already satisfies somewhere** — *"A wrong honest state on day one costs an hour of somebody's time"* — **and given measured-zero occupancy, DAY ONE IS THE NORMAL CASE.** The fix is **adoption in 16 of 26 module families**, not new design |
| **5** | **Let width change composition and never authority** | *"Two different technician experiences chosen by VIEWPORT WIDTH, not by user preference"* — **a live violation, on the most mobile role in the business** |

**And one this synthesis adds as a sixth, because it gates the census gate itself:**

| **6** | **Make the person axis able to REPORT an orphan** | **The census reports a STRUCTURAL ZERO for person orphans and the enforcement gate reads it as a measurement.** *"Either the gate must stop treating person resolution as measured, or ruling O-1 must be revisited. **THIS DECISION BLOCKS THE GATE EITHER WAY.**"* → **`OD-6`** |

---

## 9. Handoff conditions

- **This synthesis wrote only under `docs/operating-model/`.** `docs/atlas/**`, `docs/design/**`,
  `docs/specifications/**`, `docs/assessments/**`, `functions/**`, `field-ops-app-vite/**`,
  `scripts/**` and `config/**` were **read and NOT modified.**
- **`docs/OWNERSHIP.md` and `docs/specifications/record-ownership.md` were read and NOT modified** —
  their supersession is **recorded as a decision (`OD-5`), not applied.**
- **No production contact, no deploys, no database mutation, no Firestore reads or writes, no schema, no
  implementation. Ownership handoff was NOT activated.**
- **No Owner question answered. No lane's finding overridden. Both readings preserved wherever two
  lanes disagree.**
- **Not pushed. No PR.**
