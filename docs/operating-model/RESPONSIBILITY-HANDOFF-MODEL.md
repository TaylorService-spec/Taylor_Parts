---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
---

# RESPONSIBILITY HANDOFF MODEL

**OBSERVED AT: 64008d5a.** Integrated from **EMP-ACCOUNTABILITY** §4 and §6 (primary),
**EMP-WORK** §5, **OWN-E2E** §11, **EMP-EXPERIENCE** §4.6.

**No field, collection or schema is proposed. The continuity models below are chosen FROM EVIDENCE,
never for technical convenience, and every row states whether the guarantee holds today.**

---

## 0. THE PRIMARY MODEL GAP, STATED MECHANICALLY

> **EOS MODELS THE ASSIGNEE AND NO OTHER ROLE CONCEPT, SO A HANDOFF CAN NEVER MOVE ACCOUNTABILITY.**
> (EMP-WORK's finding, adopted by EMP-ACCOUNTABILITY as its primary framing)

**This is the mechanical answer to seven of the brief's accountability questions at once** — *"who
remains accountable during an unaccepted handoff"* has **nowhere to be recorded**, not merely no rule
governing it. **The distinction matters: a missing rule can be written; a missing place to put the
answer cannot be filled by policy.**

Corpus **P3B1-S21** is titled ***"the transfer EOS cannot express"***, and the real-world path it
records is the proof: ***"Dale tells Javier verbally and the record stays on Curtis."***

> **The workaround does not merely bypass EOS — it CORRUPTS THE VERY SCORECARD BUILT ON THAT DATA**,
> because the technician scorecard (`WF-SVC-016`) attributes the work to Curtis, **who did not do it.**
> **An accountability model whose only workaround falsifies the performance data is worse than one with
> an acknowledged gap**, and this is the strongest single argument that the gap must be closed in the
> **model** rather than tolerated in practice.

**This is simultaneously a MODEL GAP** (no accountability axis distinct from ownership and assignment),
**an ENGINEERING GAP** (person-owner derivation performs no referential or lifecycle check) and **a
WORKFLOW GAP** (no in-flight reassignment edge exists). **It is NOT fixable by cascading ownership,
which the existing rulings correctly forbid.**

---

## 1. ACCEPTANCE — pervasive in the business, absent from the model

**Keyword counts over all 1,010 corpus activities** (EMP-ACCOUNTABILITY §3):

| Term | Hits | Reading |
|---|---:|---|
| **`accept` / acceptance** | **107** | **acceptance is a PERVASIVE BUSINESS CONCEPT** |
| reject | 40 | |
| override | 27 | **but "manager override" as an exact phrase: 0** |
| escalation / escalate | 13 | thirteen times in a thousand activities, **always as *"the escalation target must be stated"* — i.e. as a MISSING thing** |
| reassign | 12 | |
| deactivated | 2 | |
| **vacation** | **1** | **a single activity models the most common real-world unavailability** |
| delegate | 1 | *"and in the sense of NOT delegating"* |
| **takeover · unassigned · out of office · terminated** | **0 each** | **the vocabulary of DEPARTURE AND TAKEOVER does not exist in the corpus at all** |

> **THE ASYMMETRY IS THE FINDING: acceptance is EVERYWHERE in the business and NOWHERE in EOS;
> departure is nowhere in either. Acceptance is a MODEL GAP against abundant evidence. Departure is
> MISSING INPUT — the corpus cannot settle it because THE BUSINESS NEVER DESCRIBED IT.**

**The one acceptance semantic that exists, and what it accepts:** the technician lifecycle has an
`Accept` action (`DISPATCHED → ACCEPTED`) — **the only acceptance semantics anywhere in EOS.** **It
accepts THE ASSIGNMENT, not accountability, and no ownership handoff has an equivalent.** And
`accountOwner` records `assignedBy*` + `assignedAt` — **who PUSHED it, never whether the recipient TOOK
it.**

---

## 2. CONTINUITY MODELS — three genuinely required, one representable in zero workflows

**A** = accountability changes **immediately on assignment** · **B** = the current accountable person
**remains accountable until the recipient ACCEPTS** · **C** = accountability **stays with the
process/role owner** while execution assignment changes. **Every row must still guarantee
accountability ≠ nobody.**

| Workflow | Model | Justification from evidence | Guarantee holds today? |
|---|---|---|---|
| **Account ownership** (WF-CRM-001) | **A** | A commercial relationship has one responsible salesperson and the handoff is a **management act, not a negotiation.** `accountOwner` records `assignedBy*` — **a push, which is model A's shape** | **No** — handoff to a non-`ACTIVE` employee is **unchecked** |
| **Contact / Location** | **A**, derived | They are the customer's people and places; they follow whoever owns the relationship **at creation** | **No** — inherits the same unchecked handoff |
| **Opportunity → Agreement → Sales Order** | **A** | Sales ownership is singular and continuous; **`resolveCreationOwner` already implements A with a REFUSAL instead of a guess** | **No** — same |
| **Sales Order fulfilment** (WF-SLS-003, WF-XD-001) | **C** | The salesperson stays accountable for the **commercial outcome** while allocation, picking and shipping are assigned elsewhere. `P3B3-ADV-015`: *"The order-to-cash chain therefore has a step in the middle that belongs to nobody in the governed model."* | **No** — **the process owner for fulfilment is UNNAMED** (ORPHAN-5) |
| **Work Order intake → ready → scheduled** (WF-SVC-001/002/003) | **C** | Service coordination is **a desk, not a person-to-person handoff**; the coordinator/service manager stays accountable while the job moves through the queue. **This is the Owner's worked example exactly** | **No** — no accountable-person field. `P3B1-S24-A03`: *"A WO in CREATED for three weeks means nobody marked it ready, and NOTHING RECORDS WHO WAS SUPPOSED TO"* |
| **Dispatch → Accept** (WF-SVC-005/007) | **B** | **The ONLY workflow where evidence POSITIVELY DEMANDS B.** `Accept` exists as a real transition, and `P3B1-S08-A09` treats non-acceptance as a signal: *"An unaccepted dispatch is the earliest signal that a technician's day has gone wrong."* **Under B the dispatcher remains accountable until Accept** | **No** — the state exists but **nobody is named as holding it**; recovery is *"The dispatcher phones."* |
| **Technician execution** (Accept→Complete) | **A** | Once accepted, the technician is accountable for the visit. **Correct, and `requiresOwnAssignment` enforces it** | **No — and A here is UNSAFE WITHOUT AN EXIT** (§3) |
| **Mid-day technician handover** (WF-SVC-011) | **B** | A partially-done job **must not become nobody's**; the first technician holds until the second accepts | **IMPOSSIBLE** — *"the transfer EOS cannot express"* |
| **Reorder request** (WF-INV-006) | **C then B** | `currentOwner` role queue is **textbook C.** The claim step (`assignedToUserId`) **should be B — a pull, which IS acceptance** | **No** — `S03-A10`: *"Ownership by ROLE with no assignee is the classic 'everyone's job is nobody's job' state"* |
| **Receiving → put-away** (WF-INV-001/002) | **C** | Warehouse process ownership; the scanner operator is an **executor** | **No** — `S08-A05`: *"The warehouse receipts the goods but nobody closes the request. Ray emails Dwayne. That is the current integration"* |
| **Transfer order in transit** (WF-INV-009) | **B**, two-sided | **Custody genuinely transfers on receipt**; source stays accountable until destination accepts. **The `PARTICIPATING_COMPANIES` shape is already the two-participant insight, at COMPANY level** | **No** — `S25-A05`: goods are *"off WH-PHX-MAIN's books, **ON NOBODY'S BOOKS**, and attached to no open transfer — the most completely lost stock any of these stories produces"* |
| **Cycle count sheet** | **C** | An open sheet belongs to the **inventory-control process** | **No** — `S31-A08`: *"If nobody picks it up, the sheet sits open indefinitely"* |
| **Invoice / payment / AR collections** (WF-FIN-001/003/005) | **C** | Accounting process ownership; **ruling D-15 correctly separates it from sales credit** | **No** — **no process owner named** |
| **Financial correction** (WF-FIN-004) | **C + approval** | An `IMMUTABLE` record's correction needs **a named approver** | **No** — **FIN-007 approval policy unconfigured BY DESIGN** |
| **Reference / catalog maintenance** (WF-INV-012, WF-EQP-005) | **C (steward)** | **Master data has a STEWARD, not an OWNER.** REFERENCE correctly removes *ownership* and leaves *stewardship* unassigned | **No** — no steward concept anywhere |
| **Employee deactivation** (WF-XD-006) | **B, mandatory** | **Nothing may be released until a successor accepts** | **No** — `S15-A05`: *"deactivation releases NOTHING. P1 has no release command at all"* |

> **SUMMARY: 16 workflows · 3 continuity models genuinely required (A×5, B×5, C×8, two hybrid) · and
> the guarantee "accountability ≠ nobody" holds in 0 OF 16. Model B is required by FIVE workflows and
> is representable in NONE — there is no acceptance state anywhere in the ownership model.** → `OD-11`

---

## 3. WHAT CAN GET LOST BETWEEN TWO PEOPLE

**Evidence base: 53 `HANDOFF`-tagged activities (P3-B1 34 · P3-B2 19 · P3-B3 **0 — unmeasurable**) and
90 rows flagged `role_handoff_unclear` (P3-B1 56 · P3-B2 34 · P3-B3 unmeasurable).**

> **STATE THE DENOMINATOR, EVERY TIME. It is 660, not 1,010.** P3-B3 — **350 rows, 34.7% of the corpus
> — carries no coverage tags, no device, no friction scores and no operating company.** So **sales,
> CRM, finance and administration contribute ZERO handoff evidence.** **That silence is a MEASUREMENT
> GAP, not evidence of smooth handoffs** — and the four domains that contribute nothing are precisely
> the ones whose handoffs were found **most exposed**: ORPHAN-5 (the fulfilment step belonging to
> nobody) and the AR/collections and financial-correction rows all sit in the untagged third. **Any
> reader comparing "53 handoffs" against "86 workflows" would conclude commercial handoffs are
> unproblematic; the correct conclusion is that THEY WERE NEVER MEASURED.**
> (EMP-ACCOUNTABILITY §3; EMP-WORK §0.2)

### 3.1 The register — 26 handoffs where work can be lost

**PROVENANCE: every row below is AUTHORED NARRATIVE.** EMP-WORK states plainly that its
lost-between-people section *"rests entirely on authored narrative"* and should reach the Owner as **a
hypothesis to test, not as observed practice.** **That qualifier is mandatory and travels with the
table.**

| From → To | What is handed | What gets lost | Mechanism |
|---|---|---|---|
| **Coordinator → Coordinator** (shift) | Undecided inbound rows | **Whether anyone has looked at a row.** *"With no owner field, the afternoon coordinator cannot tell a row nobody has looked at from one someone is actively chasing"* | No owner field, **no in-progress state** |
| **Coordinator → Dispatcher** | A Work Order marked ready | **Completeness.** *"Marking ready with no equipment and no address is possible — readiness is not validated against completeness"* | No validation gate |
| **Coordinator → Customer** | A promised time | **THE PROMISE ITSELF.** *"The promise lives outside EOS."* If nobody calls, *"a technician arrives at a locked convention centre"* | **Nothing records the promise** |
| **Dispatcher → Dispatcher** (shift) | The board | **EVERY IN-FLIGHT DECISION.** *"who was phoned, which customer was promised what — is verbal."* *"A dispatcher who reloads the page loses the feed; a dispatcher taking over at shift change never had one"* | **No change feed, no persisted decision log** |
| **Dispatcher → Technician** | A dispatched job | **The job itself, if ids mismatch**: *"A job dispatched to an id that does not match the technician's own `technicianId` is INVISIBLE TO EVERYONE except admins and dispatchers"* | Two-hop identity join |
| **Dispatcher → Technician** | A cancellation | **The cancellation, if he is offline**: *"If the technician arrives before the cancellation syncs he works a cancelled Work Order, and CANCELLED is TERMINAL with no way back"* | Async sync, terminal state |
| **Technician → Technician** | An in-progress job | **EVERYTHING.** *"the transfer EOS cannot express."* Javier's labour is **unattributed**; *"Curtis's productivity is OVERSTATED. The technician performance scorecard's productivity figure is built on exactly this data."* Cancel-and-recreate *"loses the arrivedAt, workStartedAt and three hours of execution data"* | **No transfer edge; one `assignedTechId`; no multi-technician concept** |
| **Technician → Office** | Completed work | **Notes and parts.** *"Completing with no note and no parts is permitted; nothing validates that anything was recorded."* Then: *"The technician is phoned and re-enters the information verbally"* | No completion-content validation |
| **Technician → Office** (offline) | Pending intents | **Visibility.** *"Nobody in the office can see this queue. A dispatcher wondering why a job has not completed has no view of the technician's pending intents."* And *"A technician who ignores a refused card leaves work PERMANENTLY UNRECORDED"* | Client-side queue |
| **Technician → Billing** | Labour hours | **ALL OF THEM.** Captured *"outside EOS, on paper or in payroll."* `workOrder.labor.record` is `active:false` **in every declared environment [EXECUTED]** | Capability inactive everywhere |
| **Billing → Invoice** | A closed Work Order | **The billing event.** *"Nothing downstream is triggered by Close… no invoice, no customer notification."* Billing Queue *"connected to neither end"* | **Unwired bridge — `billingQueue.ts` has zero importers** |
| **Dispatcher → Parts Manager** | An approved reorder request | **Where it went.** *"If it lands nowhere visible it simply waits."* **And approval is irreversible**: *"An approval cannot be undone"* | No routing visibility |
| **Parts Manager → Parts Associate** | An assigned request | **Recoverability.** *"Assigning to the wrong person is recoverable ONLY by re-assigning — and there is no branch from `ASSIGNED_TO_PARTS_ASSOCIATE` back to `READY_FOR_PARTS_MANAGER`"* | **No reverse edge** |
| **Associate → Associate** (absence) | A request mid-purchase | **THE CUT-OFF.** *"the single most likely real-world friction in the whole procurement chain, and there is NO reassignment branch in Rules to resolve it"* → *"The order misses the cut-off"* | **No reassignment branch** |
| **Receiving → Purchasing** | A received delivery | **The closeout.** *"Ray emails Dwayne. That is the current integration."* → *"The ledger and the purchasing queue tell different stories about the same cartons"* | **Email as integration** |
| **Operator → Operator** (same session) | A scanning session | **Session continuity.** *"If Dwayne cannot write into Ray's session, he will open a second one… and the receipt ends up with two sessions. Both failure modes trace to the same MISSING HANDOVER CONCEPT"* | No session-handover concept |
| **Operator → Operator** (shift) | A cycle count | **FOUR PHYSICALLY COUNTED CARTONS.** *"NOT DESIRED: queue held only in memory, in which case four physically counted cartons vanish with no trace anywhere"* | In-memory queue |
| **Parts Associate → Technician** | A staged kit | **The reservation.** *"Availability does not move, so the Thursday kit is still promisable to a Wednesday emergency call."* If parts are gone, *"a re-pull with no record of who took them. Placements record stowing, not removal"* | **Staging reserves nothing** |
| **Warehouse → Technician** (truck) | Custody of a unit | **Location.** *"If the load records state but not location, the unit reads as LOADED at the warehouse and the next warehouse count expects it"* | State without location |
| **Inventory → Equipment** (install) | A machine | **Single custody.** *"This is the handoff from inventory custody to equipment custody. TWO AUTHORITIES, ONE MACHINE."* If it half-commits, *"the machine is BOTH stock AND installed equipment simultaneously"* | Two authorities |
| **Taylor → Ventana** | Stock across the company line | **Attribution, PERMANENTLY.** *"the belts sit in Ventana's stockroom, fitted on Thursday, owned by Taylor ON PAPER FOREVER."* And *"the append-only rows cannot be reattributed"* | Append-only + **no intercompany object** |
| **Admin → Operator** | A granted role | **THE GRANT.** *"Nothing changes for Luis. The handoff Sam thinks he completed DID NOT HAPPEN"* | Inactive capability, **silent** |
| **Analyst → Second reviewer** | A variance to approve | **The reviewer.** *"Tessa's recovery is to find a second reviewer… or the recovery is a Slack message."* The second reviewer *"must be told the line was disposed of by the first, with the first reviewer's name and reason"* | **No reviewer routing** |
| **Service → Sales** | A replacement conversation | **THE OPPORTUNITY.** *"The Service → Sales direction DOES NOT EXIST IN ANY FORM. Every replacement-machine conversation that starts as a repair call leaves EOS at the Work Order"* | No reverse integration |
| **Sales → Fulfilment** | A booked Sales Order | **The fulfilment right.** *"held by `owner`, `admin` and `dispatcher` and by NO GOVERNED BUSINESS ROLE"* **[EXECUTED]** | Grant gap **surviving activation** |
| **Anyone → Successor** (employee disabled) | Their open work | **ALL OF IT.** *"Disabling the principal silently strands every Work Order assigned to them: Accept, Travel, Arrive, WorkStart and Complete ALL carry `requiresOwnAssignment: true`, so NOBODY ELSE CAN ADVANCE THEM"* | `requiresOwnAssignment` + **no reassignment** |

### 3.2 The three failure shapes of a missing handoff (OWN-E2E §11)

**All 14 HANDOFF-capable families have a declared, EXECUTED-validated ownership model and no route to
the governed handoff authority — but they are not uniform, and the distinction is the point.**

| Shape | Families | What it means |
|---|---|---|
| **INERT** | `contact`, `location`, `workOrder`, `reorderRequest`, `warehouse`, `mobileLocation`, `truck`, `supplierCompanyTerms`, `equipment` (9) | **Safe but dead.** No handoff, and no other mutation path either |
| **UNGOVERNED CHANGE PATH** | `account`, `contact`, `location`, `workOrderLegacy` (4) — **`account` most acutely** | **WORSE THAN ABSENT.** Model + no handoff + unguarded mutation = **an audit trail that cannot be reconstructed** |
| **PARTIAL, BYPASSING** | `opportunity` only | **The one place ownership genuinely moves in production is the one place the handoff vocabulary is not used** |

### 3.3 The four Owner rulings this section confirms, and the one exception

| Ruling | Status |
|---|---|
| **reassignment ≠ ownership transfer** | **UPHELD IN CODE.** `reassignWorkOrderTechnician` is a separate audited action with a **required reason** (H20) — *"the only audited person-change in the platform."* **ONE EXCEPTION: the reorder Assign branch changes `currentOwner` AND sets `assignedToUserId` in one Rules-enforced write** — conflict **AS-1** |
| **manager intervention ≠ ownership transfer** | **UPHELD.** A dispatcher acting on a technician's Work Order is **role authority**, not escalation and not a transfer. The only path by which a manager moves an owner is `ADMIN_CORRECTION` — *"correctly an audited handoff, not an implicit takeover"* |
| **no implicit historical cascade** | **UPHELD STRUCTURALLY** — the command has **no list input and no "and its children" flag** |
| **historical stays historical** | **UPHELD.** `IMMUTABLE` on 12 families; the Account document retains no prior-owner history and **history lives only in the immutable trail** |

**And one ruling the evidence sharpens rather than confirms:** *"may a handoff source represent an
escalation or a departure?"* **The three `OWNERSHIP_HANDOFF_SOURCES` — `DIRECT_HANDOFF`,
`CUSTOMER_HANDOFF_REVIEW`, `ADMIN_CORRECTION` — include NONE.** Their stated rationale is *"an admin
correcting a mistake and a customer-review reassignment are different acts, and a later reader of the
trail cannot tell them apart from the owner values alone."* **Routing a departure through
`ADMIN_CORRECTION` would file a legitimate lifecycle event as a data-entry fix, DESTROYING THE
DISTINCTION THE CLOSED SET EXISTS TO PRESERVE.** → `OD-11c`

---

## 4. EMPLOYEE UNAVAILABILITY AND DEPARTURE

### 4.1 What EOS actually has

`employmentStatus` ∈ `ACTIVE` · `ON_LEAVE` · `INACTIVE` · `TERMINATED` · `RETIRED` · `CONTRACTOR`
(`employeeProfileCommands.ts:122-130`, mirrored in `employee-foundation.md` and
`domain/constants.js:38`). Plus `separationDate`, `managerEmployeeId`, `operatingCompanyId`, `jobTitle`,
`operationalRoles`.

**Two independent, DELIBERATELY SEPARATE switches — and neither touches the third thing:**

| Switch | Owner | Effect |
|---|---|---|
| `employmentStatus` | `updateEmployeeProfile` | **Business lifecycle.** Non-`ACTIVE` → **every** operational capability fails closed |
| Auth account enable/disable | `setUserStatus` | **Account control.** Bumps `accessVersion`, resyncs claims |

**The source states the separation and its consequence explicitly:** *"Employment Status IS editable
here and account status is NOT… **Terminating employment through this command switches nobody off, and
this file contains no code that could.**"*

> **The separation is CORRECT. The uncovered case is the third thing neither switch touches: THE
> PERSON'S OUTSTANDING RESPONSIBILITIES.**

### 4.2 Nine states × seven consequences

**Every cell marked `NO CHANGE` is a place where responsibility silently persists on a person who
cannot discharge it.**

| State | Owned records | Accountabilities | Assigned work | Approvals | Escalations | Future records | Historical records |
|---|---|---|---|---|---|---|---|
| **VACATION** | NO CHANGE — **no vacation state exists** (`ON_LEAVE` is a *status*, not a date range) | n/a — none exist | NO CHANGE; **executor FROZEN** if `requiresOwnAssignment` | NO CHANGE | n/a | NO CHANGE — **keeps inheriting to an absent owner** | NO CHANGE **(correct)** |
| **SICK / UNAVAILABLE** | NO CHANGE | n/a | **Mid-execution work becomes UNRECOVERABLE** (§4.4) | NO CHANGE | n/a | NO CHANGE | NO CHANGE (correct) |
| **ROLE CHANGE** | NO CHANGE | n/a | NO CHANGE | Changes with `operationalRoles` | n/a | NO CHANGE — **a former salesperson keeps inheriting new Opportunities** | NO CHANGE (correct) |
| **DEPARTMENT CHANGE** | NO CHANGE | n/a | NO CHANGE | NO CHANGE | n/a | NO CHANGE | NO CHANGE (correct) |
| **MANAGER CHANGE** | NO CHANGE **(correct)** | n/a | NO CHANGE | NO CHANGE | n/a — **nothing reads `managerEmployeeId`** | NO CHANGE | NO CHANGE (correct) |
| **ON_LEAVE** | NO CHANGE | n/a | **All capability revoked** | Revoked | n/a | NO CHANGE | NO CHANGE (correct) |
| **CAPABILITY REMOVAL** | NO CHANGE | n/a | Executor can no longer act | Revoked | n/a | NO CHANGE | NO CHANGE (correct) |
| **DEACTIVATION** | NO CHANGE | n/a | **STRANDED.** *"deactivation releases NOTHING. P1 has no release command at all"* | Revoked | n/a | NO CHANGE | NO CHANGE (correct) |
| **TERMINATION / RESIGNATION / RETIREMENT** | **NO CHANGE — they remain the record owner FOREVER** | n/a | **STRANDED.** *"Disabling the principal silently strands every Work Order assigned to them… nobody else can advance them… ONE ADMINISTRATIVE CLICK CAN IMMOBILISE A DAY'S FIELD WORK WITH NO WARNING"* | Revoked | n/a | **NO CHANGE — a TERMINATED employee continues to be inherited as owner of every new Contact, Location, Opportunity, Agreement and Sales Order downstream of their Accounts** | NO CHANGE (correct) |

### 4.3 The two Owner rules, and how the evidence divides them

| Rule | Verdict |
|---|---|
| **"No actionable item may become orphaned."** | **VIOLATED**, structurally and at every one of the nine states |
| **"Do not mass-rewrite historical ownership."** | **HONOURED — and honoured BY THE SAME MECHANISM that causes the violation.** The non-cascade rule is the reason both facts are true |

> **THESE TWO RULES ARE NOT IN TENSION, AND THE RESOLUTION IS THE MODEL'S KEY MOVE: the thing that must
> be released on departure is ACCOUNTABILITY, not RECORD OWNERSHIP.** Historical ownership correctly
> stays put; **the accountable person must move. EOS cannot express this because it has no
> accountability axis to move — the two are the same field. Collapsing them is what forces an
> unacceptable choice between orphaning work and rewriting history.**

**The FUTURE-RECORDS column is the sharpest consequence and the one most likely to be overlooked:** a
`TERMINATED` employee who owns an Account is, **by ruling D-4's inheritance chain, the DEFAULT OWNER OF
RECORDS THAT DO NOT YET EXIST. Departure does not merely leave a backlog; it SEEDS NEW ORPHANS
INDEFINITELY.** → `OD-11a`

### 4.4 Two consequences that are live today

| Consequence | Evidence |
|---|---|
| **Mid-execution work is unrecoverable and only destruction is reachable** | `Accept`, `Travel`, `Arrive`, `WorkStart` and `Complete` are **all `requiresOwnAssignment: true`**, and from any of five committed statuses the only exits are the next technician-only step or `CANCELLED`. **Compounding: the double-booking guard means an orphaned Work Order permanently consumes its technician's dispatch capacity** — *"It blocks dispatch to a technician who no longer exists"* |
| **`reportDefinitions` is orphaned outright and UNRECOVERABLE BY ANYONE** | `ownerUid` is the only gate; **no transfer, no share, and no owner-override capability BY DESIGN** (*"matching Spec §9's 'private by default, no admin override'"*). **Two gates stack**: `reportAuthor` holds `.create`/`.rename`/`.duplicate` and **not `.delete`**; `report.definition.delete` is owner+admin only; and `requireOwnershipOrAudit` requires `ownerUid === actorUid`. **So an author cannot delete their own definition for want of the capability, and an admin who holds the capability cannot delete someone else's for want of ownership. THE RECORD IS UNDELETABLE BY ANYONE** |

### 4.5 The pattern EOS already has — ON THE WRONG AXIS

`warehouseRootCompanyAssignment.ts` ruling **R-20** implements **exactly the asymmetry departure
needs** — for **companies**:

> *"the validator (2A.1A) accepts INACTIVE in storage while this refuses it in assignment"*

**An inactive company may REMAIN an owner of record (history is preserved) but may NOT BE CHOSEN as a
new owner (no new obligations are created).** `deriveCompanyOwner` honours it; `resolveOperatingCompany`
returns `INACTIVE` **distinctly from `UNKNOWN`.**

> **THIS IS THE CORRECT SEMANTICS FOR A DEPARTED EMPLOYEE, ALREADY DESIGNED, ALREADY TESTED, AND
> APPLIED ONLY TO THE COMPANY AXIS. The person axis has NEITHER HALF: no lifecycle check on
> assignment, and no lifecycle awareness in derivation.** **Stating this is the deliverable; building
> it is not.** → `OD-11a`

**EMP-ACCOUNTABILITY's recommendation, carried as a recommendation and not a decision (OD-EMP-004):**
release **accountability only**, extended by the R-20 pattern to the person axis — *"a non-`ACTIVE`
employee may REMAIN an owner of record and may NOT BE CHOSEN as a new owner or accountable person. This
satisfies the invariant without rewriting one historical fact, and it reuses a pattern already ratified
and tested on the company axis."*

### 4.6 And the honest option has no queue to work from

Even the option that requires no new model — *"a named role must clear the backlog"* — **is blocked**,
because **nothing can list a departed person's obligations** (ORPHAN-13: *"a report that would answer
'which accounts have no owner' cannot be built"*), and **the person-owner derivation is structurally
blind to exactly that failure.**

---

## 5. WHAT MUST BE TRUE FOR A HANDOFF NOT TO CREATE A RESPONSIBILITY GAP

**Derived from the evidence above. Stated as tests, not as a design. Nothing is authorized.**

| # | The test | Why the evidence demands it | Satisfied today? |
|---|---|---|---|
| **H1** | **A handoff target must be a live, `ACTIVE` employee at the moment of assignment** | `record-ownership.md` §2 *requires* the check (*"reassigning to a departed employee ORPHANS THE RECORD SILENTLY, which is how ownership models rot"*); `buildOwnershipHandoff` is **pure and performs none**; and R-20 already implements the accept-in-storage / refuse-in-assignment asymmetry for companies | **NO** |
| **H2** | **Where a workflow requires continuity model B, an acceptance state must exist and name who holds the outcome until acceptance** | **Five of 16 workflows require B; acceptance appears 107 times in the corpus and zero times in the ownership model** | **NO** |
| **H3** | **A handoff must be recorded in the handoff vocabulary, not as a field diff** | The **one** live owner-change control emits **no `OWNERSHIP_HANDOFF`**, so the from-whom, to-whom, source and reason of the one ownership move EOS can perform are **not captured** | **NO** |
| **H4** | **Family-level refusals must run on the path a caller can actually reach** | EXECUTED: the live audit writer accepts a handoff of an invoice, a part, an audit event, or a nonexistent family. **The shortest wiring is the corrupting one** | **NO** → `OD-7` |
| **H5** | **An in-flight reassignment edge must exist for any family whose assignment gates its own advancement** | `requiresOwnAssignment` is correct as authorization and converts an assignment gap into a hard lock. **The only expressible answer today destroys a live customer commitment** | **NO** → `OD-13` |
| **H6** | **A handoff must not cascade, and existing children must not move** | **ALREADY SATISFIED, structurally.** `ownershipHandoffCommand.ts` has no list input and no children flag. **PRESERVE THIS** — and mark `record-ownership.md` §4/AC-7 superseded so the contradiction stops being citable (`OD-5`) | **YES — the one test EOS already passes** |
| **H7** | **The set of handoff sources must distinguish a departure from an admin correction, or departures must produce NO handoff at all** | Reusing `ADMIN_CORRECTION` files a lifecycle event as a data-entry fix. **And the brief's own ruling — *"do not assume escalation transfers record ownership"* — argues escalation should produce no handoff at all** | **NO** → `OD-11c` |
| **H8** | **Whether a non-admin may hand off a record they own must be ruled** | `record-ownership.md` open question 2, **never answered**: *"Letting a rep hand off their own account is natural; letting them push an unwanted one onto a colleague is not."* **Affects all 14 HANDOFF-capable families** | **NO** → `OD-4b` |
| **H9** | **The person axis must be able to REPORT an orphan before enforcement is gated on the census** | The census reports a **structural zero** for person orphans and the gate reads it as a measurement | **NO** → `OD-6` |
