---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
---

# EMPLOYEE ESCALATION MODEL

**OBSERVED AT: 64008d5a.** Integrated from **EMP-ACCOUNTABILITY** §5 (primary), **OWN-DESIGN** §4.3,
**OWN-E2E** F-9, **EMP-INFORMATION** §6 and §10, **EMP-EXPERIENCE** §4.7.

**The table in §3 is THE BUSINESS REQUIREMENT with the EOS status of each cell. IT IS NOT A FIELD
PROPOSAL.** `—` = no storage and no concept.

---

## 0. EOS HAS NO ESCALATION CONCEPT — verified exhaustively

**Verified by exhaustive search of `functions/src` and `field-ops-app-vite/src`: every hit for
`escalat*` is one of** (EMP-ACCOUNTABILITY §5):

| Category | Instances |
|---|---|
| **(a) *Privilege*-escalation security prose** | `governedBusinessRoles.ts:641,655` (*"self-escalation path"*) |
| **(b) FIN-007 approval policy recorded UNCONFIGURED** | **four Financials surfaces** — `FinancialsCreditsAdjustments.jsx:57`, `FinancialsInvoiceDetail.jsx:230`, `FinancialsPaymentDetail.jsx:202`, `FinancialsGovernance.jsx:162` — each stating *"FIN-007 approval policy — **thresholds, approver roles, dual-control, escalation, expiry** — is not configured"* |
| **(c) Statements that something is NOT escalated** | `workOrderAttentionProjection.js:179`, `performanceMetricRegistry.ts:253`, `MyDashboard.jsx:260` |
| **(d) Governance prose about escalation *to the Owner* as an AI-agent boundary** | `docs/OWNERSHIP.md`, `DelegationCharter.md`, `PlatformOperatingModel.md` — **and note this is the IP/attribution document, not a record-ownership authority** |
| **(e) Deploy-gate scripts** | unrelated |

> **NO ESCALATION OWNER, NO ESCALATION TARGET, NO TRIGGER, NO TIMER, NO APPROVAL CHAIN EXISTS IN ANY
> BUSINESS PATH.** (EMP-ACCOUNTABILITY) **No escalation field, no escalation target, and no escalation
> timer on any business record** (OWN-DESIGN MG-2, uniform across all 25 families). **Stage 14 is
> MISSING AT THE MODEL LEVEL for every family** (OWN-E2E F-9). **`MY ESCALATIONS` cannot be built at
> all — there is nothing to key it on** (EMP-EXPERIENCE concept 5).

**The corpus demands it repeatedly and only ever as an absence.** `escalation`/`escalate` appears
**13 times in 1,010 activities**, and **always as *"the escalation target must be stated"*** — i.e. as
**a missing thing.**

---

## 1. THE TWO THINGS THAT LOOK LIKE ESCALATION AND ARE NOT

| Mechanism | What it is | Why it is not escalation |
|---|---|---|
| **`transitionEngine.ts:129-140`** — each transition gated on `roles` + `requiresOwnAssignment`. Dispatcher-held transitions (`MarkReady`/`Schedule`/`Dispatch`/`Close`/`Cancel`) are `requiresOwnAssignment: false`; technician transitions (`Accept`/`Travel`/`Arrive`) are `true` | **The closest thing in EOS** | **A dispatcher acting on a technician's Work Order is ROLE AUTHORITY, not escalation and not an ownership transfer** (OWN-DESIGN Panel C; conflict **AS-3**). **The Owner ruling "manager intervention ≠ ownership transfer" is upheld by this code, and no artifact may promote it into an escalation mechanism** |
| **The reorder status ladder** — `PENDING_REVIEW → READY_FOR_PARTS_MANAGER → ASSIGNED_TO_PARTS_ASSOCIATE → PURCHASING_IN_PROGRESS → ORDERED → RECEIVED`, each gated by capability + `roleKeys` | **THE ONE REAL ESCALATION LADDER IN EOS — and it is a STATUS ladder** | `currentOwner` holds **a role token, never an employee id.** **A role is not a person and cannot be asked why the next thing has not happened.** And **D-14 keeps `currentOwner`, `requestedBy` and `assignedToUserId` all separate from the COMPANY owner** |

**And one status-level escalation that exists and is invisible:** `NEEDS_REVIEW` on inbound work —
*"Routing demanded manual review, or thread association was ambiguous. **Same queue, louder**"* —
**which is in a code comment and NOWHERE ON SCREEN.** `QUARANTINED` is refusal before review. **No
person, no timer, no target.**

---

## 2. THE FIVE MODALITIES — only one is implemented

The brief's five escalation modalities, mapped onto the evidence (EMP-ACCOUNTABILITY §5):

| Modality | Status at `64008d5a` |
|---|---|
| **BLOCK WORKFLOW** | **THE ONLY ONE EOS IMPLEMENTS** — fail-closed refusals everywhere |
| **REQUIRE APPROVAL** | **DESIGNED AND UNCONFIGURED.** FIN-007 across four surfaces; `financialApprovals.ts` is *"built and has no policy values to enforce"*; and approval is **threshold-based, never person-based** — `ApprovalPolicyLine{actionType, requiresApproval, thresholdMinor}` decides *whether*, **never *who*** |
| **NOTIFY** | **ABSENT** |
| **ADD RESPONSIBILITY** | **ABSENT** |
| **TRANSFER ACCOUNTABILITY** | **ABSENT — and it is the only modality that actually DISCHARGES the invariant** |

> **BECAUSE BLOCKING IS THE ONLY AVAILABLE MODALITY, EVERY ESCALATION IN EOS TODAY RESOLVES TO "THE
> WORK STOPS AND A HUMAN TELEPHONES SOMEONE."** The corpus records it in terms: *"The dispatcher
> phones"* · *"Ray emails Dwayne. That is the current integration."* → `OD-11c`
>
> **And blocking alone converts every accountability gap into STOPPED WORK — which is SAFE FOR DATA
> and, for service commitments, DESTRUCTIVE.**

**EMP-ACCOUNTABILITY's recommendation, carried as a recommendation and not a decision (OD-EMP-003):**
*"Decide per workflow, not globally; and note that **TRANSFER ACCOUNTABILITY is the only modality that
actually discharges the invariant, so at least one workflow must have it.**"*

---

## 3. ESCALATION PER ACTIONABLE WORKFLOW — the business requirement, with EOS status

| Workflow | Normal accountable | Assignee | 1st escalation | 2nd escalation / manager | Trigger | Time or condition | What changes | What does NOT change |
|---|---|---|---|---|---|---|---|---|
| **Inbound work → decision** | Service coordinator (**—**) | Coordinator | Service manager (**—**) | Ops manager (**—**) | Row undecided | End of shift | **MISSING INPUT** | Record ownership; company |
| **Dispatch not accepted** | Dispatcher (**—**) | Technician (`assignedTechId`) | Dispatcher re-dispatch (**BLOCKED past `DISPATCHED`**) | Service manager (**—**) | No `Accept` | Corpus `P3B1-S08-A09` uses **40 minutes**; **no rule stores it** | Notify → then reassign | Company ownership; **the execution record already written** |
| **Technician unavailable mid-job** | Technician | Technician | Dispatcher (**—**) | Service manager (**—**) | Sick / no-show / deactivated | Immediate | **NOTHING CAN CHANGE: ONLY `Cancel` IS REACHABLE** | **Everything, destructively** |
| **Work Order aged open** | **—** | — | **—** | **—** | Age / stagnation | `detectStalledJobs` surfaces **HIGH/CRITICAL only** | — | — |
| **Emergency after hours** | After-hours coordinator (**—**) | Technician | — | — | Emergency received | **`P3B1-S22-A05`: *"An emergency emailed at 18:30 waits until 06:40, and NOTHING ESCALATES IT REGARDLESS OF CONTENT"*** | — | — |
| **Reorder request unclaimed** | `currentOwner` **role** | `assignedToUserId` | Parts manager (**—**) | Ops manager (**—**) | No claim | `S04-A04`: *"The order misses the cut-off"* | **NO REASSIGNMENT BRANCH EXISTS IN RULES** | — |
| **Purchasing blocked by absent assignee** | Parts associate | Same | Parts manager | — | Assignee out | `S04-A02`: *"Dwayne is on vacation. The part is urgent"* | **Desired-but-unbuilt**: *"the assign screen warns when the chosen assignee will not be able to perform the next transition"* | — |
| **Transfer in transit overdue** | Source company | — | **—** | **—** | Not received | `S25-A01`: *"…missing from every number for six days **and nobody has been told**"* | — | — |
| **Cycle-count variance beyond tolerance** | Inventory control (**—**) | Counter | Controller (**—**) | — | Variance | Month end | Approval required | — |
| **Financial correction above threshold** | Accounting manager (**—**) | — | Controller (**—**) | Owner | Amount threshold | **FIN-007 UNCONFIGURED — fails closed** | Approval | **`IMMUTABLE` ownership** |
| **Privileged role grant** | Administrator | — | Second approver (**seam recorded, UNBUILT**) | Owner | Privileged role | — | Dual control | — |
| **Price above discount threshold** | Salesperson | — | Sales manager (**—**) | — | Discount depth | **`WF-SLS-005`: *"no approval threshold"*** | Approval | Record ownership |
| **Access refused, no self-service path** | Requester | — | `S26-A02`: *"The escalation target is Sam Ortega (System Admin)"* | — | Refusal | Immediate | `S01-A09`: *"**Escalation target must be stated**"* | — |

> **EVERY "MANAGER" CELL ABOVE IS DOUBLY — IN FACT TRIPLY — UNRESOLVABLE.** Beyond having no escalation
> mechanism at all: **(1)** EOS cannot say **WHICH PERSON** the manager is (conflict **AU-1** — two
> unreconciled authorities, one yielding a set and one yielding null); **(2)** EOS cannot name the
> manager's **JOB ROLE** in a way anything reads — **`SERVICE_MANAGER` and `SALES_MANAGER`, the two
> values that would carry the second tier of almost every row, HAVE NO CONSUMER ANYWHERE**; and
> **(3)** even if both were settled, **production occupancy of every governed Role is measured ZERO.**
> **A second escalation tier is therefore blocked on THREE INDEPENDENT GAPS, not one.**

---

## 4. THE ONE ESCALATION EOS CAN EXPRESS — and it destroys the record

**`transitionEngine.ts`, the whole state machine:**

```
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

**The source states the closure deliberately** (`:37`): *"Once a technician has been dispatched the job
is committed, so DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS have **no way back**."*
**OWN-E2E re-verified this and broadened it: FIVE terminal-ish states, not two.**

> **THEREFORE: from any of five active statuses the only two exits are (a) the next forward step,
> performable SOLELY BY THE ASSIGNED TECHNICIAN, or (b) `CANCELLED`. When that technician becomes
> unavailable, EOS'S ONLY EXPRESSIBLE RESPONSE TO A LIVE CUSTOMER COMMITMENT IS TO CANCEL THE RECORD OF
> IT. THE WORK DOES NOT STOP EXISTING; ONLY EOS'S KNOWLEDGE OF IT DOES.**

**Independently corroborated by the corpus** — `P3B1-S21-A09`, *"Cover a technician who goes home sick
at 11:00 with four jobs outstanding"*: ***"None of the four can be reassigned. All four must be
cancelled and recreated."*** Defect: *"There is no bulk reassignment and no reassignment at all after
Dispatch."* And `P3B1-S21-A01/A02` exist **solely to attempt it and fail.**

**Four compounding facts:**

| # | Compounding fact |
|---|---|
| 1 | **Cancel-and-recreate destroys execution data** — *"loses the arrivedAt, workStartedAt and three hours of execution data"* |
| 2 | **An orphan permanently consumes its technician's dispatch capacity.** The double-booking guard (`transitionWorkOrder.ts:311-320`) refuses to dispatch a technician *"actively assigned to another Work Order"*, so **one orphan removes a person from the schedulable pool until someone cancels it** — `P3B1-S32-A02`: *"Clear a Work Order stuck in DISPATCHED for six days… **It blocks dispatch to a technician who no longer exists**"* |
| 3 | **Cancelling the Work Order DOES NOT CANCEL THE CUSTOMER PROMISE** — because the promise *"lives outside EOS"* and **EOS never knew about it** (the work matrix §6.2) |
| 4 | **Parts consumption on a cancelled Work Order — whether it reverses, stands, or is orphaned — is UNPROVEN**, and it *"sits directly on the cancel-and-recreate path that is the ONLY available technician handoff"* |

> **Stage 14 is therefore MISSING AT THE MODEL LEVEL, not merely unimplemented: there is no
> representation for responsibility moving when work fails, AND THE WORKAROUND DESTROYS THE COMMERCIAL
> RECORD.** → `OD-13`

**And one further absence with the same root:** there is **no governed non-completion outcome.** *"the
state machine models forward edges plus Cancel"*, so a technician cannot record *"I could not do this"*
— the most-cited gap in the corpus, recorded **four times in one story** (store shut · wrong address ·
machine fine · customer refuses over an unpaid invoice). **EMP-PERFORMANCE adds the measurement
consequence: with no governed "could not complete, and why", AN EXCEPTION CANNOT BE SEPARATED FROM A
REFUSAL, so no exception-rate metric can be attributed at all.**

---

## 5. ESCALATION MUST NOT TRANSFER RECORD OWNERSHIP — upheld by the evidence

**The brief's caution is upheld.** The three `OWNERSHIP_HANDOFF_SOURCES` are `DIRECT_HANDOFF`,
`CUSTOMER_HANDOFF_REVIEW`, `ADMIN_CORRECTION` — **and NONE is an escalation, and NONE is a departure.**
Their stated rationale (`auditEventWriter.ts:429-433`):

> *"an admin correcting a mistake and a customer-review reassignment are different acts, and a later
> reader of the trail cannot tell them apart from the owner values alone."*

> **AN ESCALATION ROUTED THROUGH `ADMIN_CORRECTION` WOULD FILE A LEGITIMATE OPERATIONAL EVENT AS A
> DATA-ENTRY FIX, DESTROYING THE DISTINCTION THE CLOSED SET EXISTS TO PRESERVE.**
> **EMP-ACCOUNTABILITY's recommendation (OD-OWN-005): do not reuse `ADMIN_CORRECTION`. Whether a new
> source is added is an Owner decision — and the brief's own ruling *"do not assume escalation
> transfers record ownership"* argues that ESCALATION SHOULD PRODUCE NO HANDOFF AT ALL.** → `OD-11c`

---

## 6. EVERY REFUSAL SENTENCE THAT ASSUMES SOMEONE HOLDS A ROLE

**EMP-INFORMATION §10 is canonical here. Each requirement below RENDERS A SENTENCE NAMING A ROLE
HOLDER, and therefore silently assumes somebody occupies it. Production occupancy is MEASURED ZERO.**

> **If nobody does, each one degrades from "helpful escalation" to A DEAD END THAT NAMES A GHOST.**

| # | The requirement | Role it assumes is occupied | What it renders at zero occupancy |
|---|---|---|---|
| O-1 | *"if the coordinator lacks Cancel, the button should say who can do it"* | `dispatcher` or `admin` | **a button naming a role nobody holds** |
| O-2 | *"A denial that names the role that can do it is worth more than the denial itself"* | `dispatcher` / `admin` | the same |
| O-3 | *"Assigned to Dwayne Holbrook. Ask an admin or dispatcher to reassign."* | `admin` or `dispatcher` | **correct on the assignee, A DEAD END ON THE ESCALATION** |
| O-4 | *"ⓘ: who reviews reorder requests"* | a reviewer Role | **an empty answer to a direct question** |
| **O-5** | *"ⓘ: who can void, and **what to do when nobody who can void is the assignee**"* | a void-holder | **THIS ONE ALREADY ANTICIPATES THE EMPTY CASE AND IS THE RIGHT PATTERN** |
| O-6 | *"ⓘ: who can cancel"* | a cancel-holder | a dead end |
| O-7 | *"Moving stock out of WH-PHX-MAIN requires warehouse authority you do not hold. Ask the parts desk."* | a warehouse-authority holder **at that location** | **WORSE than a dead end: all four `inventory.transfer.*` are `active: false` and granted to NO Role, so the honest sentence is "not active in this release", not "you lack it"** |
| O-8 | *"a refusal that names the capability and says who can activate it"* | the activation owner | **activation is A RELEASE, NOT A PERSON — naming a person here is WRONG** |
| O-9 | *"the refusal names the rule, names who submitted the count, and names who can dispose of it"* | a reconciler | `inventory.cycleCount.reconcile` is `active:false`; **two Roles are DECLARED carrying it** |
| O-10 | *"ⓘ on the refusal: who does hold this authority at this location, right now"* | any holder | requires occupancy **AND a location dimension on the Role** |
| O-11 | *"a refusal naming the capability"* for asset acquisition | `inventorySerializedAssetAcquirer` | **both `inventory.serializedAsset.*` ids are `active: false` and granted to no Role** |
| O-12 | *"the escalation names who can"* | any holder | a dead end |
| **O-13** | ESCALATION for Apprentice Technician, Satellite Attendant, After-Hours Coordinator | a manager | **even WITH occupancy the answer is AMBIGUOUS — "who manages this person" has two unreconciled answers** |
| **O-14** | *"Ask your administrator"* on an unlinked technician record | `admin` | **THIS ONE IS SAFE — `admin` is a seeded compatibility Role** |
| O-15 | Any *"who approves this"* sentence | an approver | **no approval queue exists at all** |

### 6.1 The composition rule this produces

**A refusal sentence must be composed from THREE RESOLVED FACTS, in this order, and must degrade
honestly when a fact is missing** (EMP-INFORMATION §10):

| Step | Question | If the answer is unfavourable |
|---|---|---|
| **1** | **Is the capability ACTIVE?** | If no → say *"not active in this release; granting it has no effect"* **and NAME NO PERSON** |
| **2** | **Does ANY principal hold it?** | If the occupancy read returns zero → say ***"no one currently holds this authority"*** — **a TRUE, ACTIONABLE sentence** — and **never name a Role as though someone were in it** |
| **3** | **WHO holds it?** | Only then name them |

> **Until the occupancy read exists, STEP 2 CANNOT BE EVALUATED, so every "ask X" sentence in the
> corpus is `UNKNOWN — REVERIFY`. NINE OF THE FIFTEEN ROWS ABOVE WOULD RENDER A DEAD END TODAY.**
> → `OD-25`

**And the distinction that must never be collapsed** (EMP-INFORMATION E-2, verbatim from the
archaeology): ***"Calling an inactive capability a missing authority tells the Owner that something
must be DESIGNED AND BUILT when in fact something must be ACTIVATED."*** *"Capability inactive"* and
*"authority required"* are **two different states, two different sentences, two different owners.**

**The five conditions that must never share a rendering** (EMP-INFORMATION §6.1):

| Condition | The true sentence | Who can change it |
|---|---|---|
| **D-1 UNGRANTED** — capability active, this principal's Roles lack it | *"Approving a reorder request needs review authority you do not hold. [Named holders] hold it."* | an administrator, by Role assignment |
| **D-2 INACTIVE** — registered `active: false`; **NO Role can hold it in this environment** | *"These capabilities are registered but not active in this release. **Granting them has no effect.**"* | **a RELEASE, not a configuration** |
| **D-3 UNASKED** — active **and** grantable **and** granted, and the client **never asks the server**, so it is permanently `false` | *"This control is gated on a capability this screen never requests. **Nothing you can be granted will switch it on.**"* | **an engineering change to the request set** |
| **D-4 NOT-A-CAPABILITY** — `rulesOnly` objects (Contacts, Customer Locations, Equipment) with C/R/E/D all empty | *"Access to equipment records is decided by Firestore Rules, not by a Role. **There is no capability to grant.**"* | a Rules change |
| **D-5 SEPARATION-OF-DUTIES** — the principal **HOLDS** the capability and is refused on **who they are relative to the record** | *"A counter cannot approve their own material variance. **This is a CONTROL, not a permissions problem.**"* | **nobody — it is the control working** |

**Corpus `S22-A04` is the whole requirement in one row:** three refusals with three different causes
must produce **three visibly different messages**, and today's risk is **one generic "permission
denied" for all three** — *"which makes the system's actual state UNKNOWABLE FROM THE OUTSIDE: the user
cannot tell an unbuilt feature from a misconfigured Role from a deliberate policy."*

**D-3 is the worst of the five** and it is **LIVE at this baseline** (conflict **EG-C4**): a capability
outside the 44-id `REPORT_CAPABILITY_REQUEST` resolves `false` **forever, for every principal, in every
environment, whatever Role they hold** — *"worse than ungranted or inactive, because NO GRANT, NO
ACTIVATION AND NO ROLE CHANGE CAN REACH IT — and THE USER IS TOLD NOTHING, not even 'you lack X'."*
**Five ids at five gate sites across four pages:** `inventory.location.bin.manage` (*"nobody can rack a
warehouse — including `inventoryBinAdministrator`, the Role built to hold it"*) ·
`inventory.stock.relocate` (*"the one scanner workflow that moves quantity can never be offered"*) ·
`equipment.compatibility.view` · `financialPolicy.profile.read` · `financialPolicy.profile.configure`
(*"Activating the capability would not help"*).

---

## 7. WHAT MUST BE TRUE FOR ESCALATION TO EXIST

**Stated as tests, in dependency order. Nothing is authorized. No field is proposed.**

| # | The test | Blocked on |
|---|---|---|
| **E1** | **A resolvable escalation target must exist for exactly one person.** Today "escalate to their manager" evaluates to **every manager of that branch, or null** | conflict **AU-1** → `OD-6b`. **And note this makes POPULATING `managerEmployeeId` a prerequisite, not a nicety — it is nullable and NEVER BACKFILLED** |
| **E2** | **A modality other than BLOCK must exist for at least one workflow** — and **TRANSFER ACCOUNTABILITY is the only modality that discharges the invariant** | `OD-11c` |
| **E3** | **An escalation must be expressible WITHOUT transferring record ownership** | Upheld by the evidence. **Preserve it: do not reuse `ADMIN_CORRECTION`** |
| **E4** | **A refusal must compose from three resolved facts and degrade honestly** — capability-active, then occupancy, then holder | `OD-25` + an authorized occupancy read |
| **E5** | **The five refusal conditions must never share a rendering** — and **D-3 must say that nothing grantable will change it** | `AVAILABLE NOW / ENGINEERING`: *"the request set and the resolver are both in the repository; only the rendering is missing"* |
| **E6** | **An escalation target must be discoverable FROM THE LINE**, not from institutional knowledge | *"That escalation must be discoverable from the line"* — the densest need in the corpus is the parts floor |
| **E7** | **An in-flight exit must exist for any family whose assignment gates its own advancement** | `OD-13`. **Without it the only escalation EOS can express destroys the record** |
| **E8** | **A time or condition threshold must be a policy value, not a narrative number** | **Only ONE number appears anywhere in the evidence: the corpus's 40 minutes for an unaccepted dispatch — and it is NARRATIVE, NOT POLICY** → `OD-11d` |
| **E9** | **An eligible-reviewer resolver must exist wherever separation of duties applies** | *"the screen must offer that as the next action, with the eligible reviewers NAMED, or the recovery is a Slack message"* |
| **E10** | **Authority may need a TIME-OF-DAY or ON-CALL dimension** — `ACTION_PERMISSIONS` has **none** | `OD-28`. **And the standing workaround is itself recorded as a defect: *"every on-call coordinator is permanently a dispatcher"* — "a standing over-grant created by an after-hours gap"** |

---

## 8. UNPROVEN in this model

| # | Claim |
|---|---|
| 1 | **Whether anything escalates a refused sync intent.** *"An intent that never succeeds ages in the queue; whether anything escalates it is UNPROVEN"* |
| 2 | **Whether any surface shows TIME-IN-STATUS.** `dispatchedAt` makes the age computable; the cost is named — *"A job left in DISPATCHED overnight silently blocks that technician's first dispatch tomorrow"* |
| 3 | **Whether a cancelled job is shown as cancelled or silently vanishes** on the technician's phone. *"Silently vanishing is worse, because the technician wonders whether he imagined it"* |
| 4 | **Whether `detectStalledJobs`' HIGH/CRITICAL-only output means the implemented "age unknown" row is UNREACHABLE.** *"The Work Order the system knows least about is the one it shows least"* |
| 5 | **Whether parts consumption on a cancelled Work Order reverses, stands or is orphaned** — and **it is the cost of the only representable handoff** |
| 6 | **Current production role occupancy** — the census is 2026-09-02 against a 2026-09-12 baseline. **No lane may re-measure it without production authorisation** |
| 7 | **Every escalation requirement in §3 is AUTHORED NARRATIVE.** The corpus names an escalation target in only a handful of `DESIRED` rows, and **the real escalation tree is MISSING INPUT** |
