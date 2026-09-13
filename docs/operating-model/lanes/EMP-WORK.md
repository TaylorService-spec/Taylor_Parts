# EMP-WORK — The Employee Work Matrix

**Lane:** EMP-WORK · **Mode:** EVIDENCE_WRITE
**Baseline:** `64008d5ae0bdd9532909671b15a91122400accf1` (= `ATLAS-BASE-2026-09-12-A`)
**OBSERVED AT: 64008d5a** — every derived fact in this document.
**Surface:** this file only. No other path written. No production contact, no deploys, no database or Firestore access.

**What this lane models:** real employee work, organised around the employee's actual job — *not* around
current EOS module boundaries. Where one real job crosses Service, Customer, Equipment, Inventory,
Purchasing and Financials, that crossing is recorded as the finding, not smoothed away.

---

## 0. Evidence base and its limits

| Source | Path | Records | Shape |
|---|---|---|---|
| P3-B1 Day-in-Life, service | `p3b1-act-service/docs/scenarios/day-in-the-life/service-technician.json` | 330 | 33 stories; `trigger` carried by `storyTitle`; `action`, `exceptionRecoveryBehaviour`, `expectedCrossObjectEffect`, `coverageCategories`, `frictionScore` (11 keys) |
| P3-B2 Day-in-Life, inventory/warehouse/purchasing | `p3b2-act-inventory/docs/scenarios/day-in-the-life/inventory-warehouse-purchasing.json` | 330 | 33 stories; same shape, snake_case keys; `scores` (11 keys) |
| P3-B3 activities, sales/CRM/finance/admin/management/adversarial | `p3b3-act-sales/docs/activities/p3b3-*.json` (6 files) | 350 | `trigger`, `narrative`, `objects_touched`, `authority_path`, `status`; 42 rows carry an `execution` block |
| Archaeology, service | `p3a1-arch-service/docs/design/archaeology/service-scheduling-technician-equipment.md` | 1,268 lines | §7 Missing-workflow discoveries (12), §8 UNPROVEN |
| Archaeology, inventory | `p3a2-arch-inventory/docs/design/archaeology/inventory-warehouse-purchasing-scanner.md` | 1,852 lines | Part 12 Missing-workflow discoveries (15), Part 15 UNPROVEN |
| Archaeology, sales/finance/admin | `p3a3-arch-sales/docs/design/archaeology/sales-crm-financials-reporting-administration.md` | 1,032 lines | §8.3 Missing-workflow discoveries (12), §8.6 UNPROVEN |
| Workflow registry | `p3d-workflow-registry/docs/architecture/eos-workflow-registry.json` | 86 workflows | `actors`, `trigger`, `steps`, `state`, `break_point`, `blocking_mechanism`, 106 owner questions |

### 0.1 Corpus caveats — every figure re-derived in this lane from the rows

| Claim | Re-derived here | Verdict |
|---|---|---|
| 1,010 records | 330 + 330 + 350 = **1,010** | CONFIRMED |
| 1,009 distinct activities | 350 P3-B3 ids are all distinct; `P3B3-FIN-056` ≡ `P3B3-MGMT-018` is a **content** duplicate (identical title, `actor_role` Operations Manager, `objects_touched`, status `BLOCKED`), not an id collision | CONFIRMED |
| 42 executed, 22 pass / 20 fail | `EXECUTED_PASS` 22 + `EXECUTED_FAIL` 20 = **42**, all in P3-B3 | CONFIRMED |
| 968 not executed | 1,010 − 42 = **968** | CONFIRMED |
| only 660 carry the literal `NOT_RUN` token | P3-B1 330 + P3-B2 330 = **660** all `NOT_RUN`; P3-B3's 308 unexecuted rows use `IMPLEMENTED_UNEXECUTED` 141, `PARTIAL` 68, `BLOCKED` 64, `NOT_SUPPORTED` 26, `DESIGNED_ONLY` 9 and never say `NOT_RUN` | CONFIRMED |
| "34 of P3-B3's recorded output lines are INFERRED" | **22 are INFERRED.** 118 output lines across 42 rows: `EXECUTED` 90, `INFERRED` 22, `TRACED` 6. The corrections block in each P3-B3 file states the same split ("22 INFERRED … and 6 TRACED", 28 downgraded in total) | **BRIEF IS WRONG — see §10** |

### 0.2 A structural blind spot the brief does not name

**P3-B3 (350 rows, 34.7% of the corpus) carries no coverage tags, no device context, no friction
scores and no operating-company field.** Consequently:

| Dimension | Rows measurable | Rows structurally unmeasurable |
|---|---|---|
| `coverage` categories (HANDOFF, EXCEPTION, RECOVERY, AFTER_HOURS…) | 660 (P3-B1 + P3-B2) | **350** (all P3-B3) |
| Friction scores (11 keys incl. `role_handoff_unclear`, `ownership_unclear`) | 660 | **350** |
| Device context (DESKTOP / MOBILE / handheld) | 660 | **350** |
| Operating company (Taylor / Ventana) | 660 | **350** — P3-B3's own metadata: *"ABSENT. No P3-B3 record carries an operating-company field of any kind, so Ventana coverage is structurally unmeasurable for this library."* |

**Consequence for this lane:** every friction, handoff and after-hours count below describes service,
inventory, warehouse and purchasing work only. **Sales, CRM, finance, administration and management
work — the whole commercial and back-office half of the business — contributes zero handoff evidence
and zero friction evidence.** Silence there is a measurement gap, not a finding of smooth work.

### 0.3 Standing evidence label

Every P3-B1 and P3-B2 activity is an **authored scenario**: design evidence that someone intended the
work to go this way, **not proof that the work happens this way.** P3-B1's own
`executionStatement` reads: *"NOTHING IN THIS LIBRARY HAS BEEN EXECUTED. No activity was run against
any real or production system. Every executionResult is NOT_RUN."* The 42 P3-B3 rows with an
`execution` block are the only executed evidence in the corpus, and 22 of their 118 output lines are
`INFERRED`. Claims below are labelled **[AUTHORED]**, **[EXECUTED]**, or **[TRACED]** accordingly.

### 0.4 Corrections adopted from lane EMP-ROLE

Four corrections arrived from the completed sibling lane EMP-ROLE and are adopted here. Each was
re-derived in this lane where the corpus permits.

| # | Correction | Effect on this document | Re-derived here |
|---|---|---|---|
| 1 | **The security-Role set is 48, not 45** — 45 governed business Roles **plus** `admin` / `dispatcher` / `technician` in `compatibilityRoles.ts`. Using 45 makes 314 activities (31%) falsely appear to belong to roles with no security Role; the real figure is **290 activities (28.7%) across 13 roles** | No figure in this document was computed from 45. The registry quotations already say 48 (*"every one of the 48 roles under the production activation set"*, `WF-EQP-002`), and that is the correct set | Consistent with `WF-EQP-002` / `WF-SLS-003` **[EXECUTED]** probes |
| 2 | **Service Coordinator and Dispatcher are two roles, not one.** EMP-ROLE withdrew its own merge as a violation of its rule | **Already held apart** — §2.1 and §2.2 are separate job profiles, and §1 lists COORDINATOR and DISPATCHER as separate real jobs. Affirmed and evidenced in §1.2 below | **Yes — see §1.2** |
| 3 | **`employee-foundation.md` is not sufficient for the Employee schema.** `jobTitle` and `managerEmployeeId` — the two most job-role-relevant fields — are absent from it and arrive via `docs/assessments/administration-users-consolidation.md:204-209` | Corrects §5.1: a MANAGER field **does** exist. §5.1 updated | Not re-derived — outside this lane's read set. **Taken from EMP-ROLE** |
| 4 | **Three ratified sales channels, not two** — `STRATEGIC_ACCOUNTS` as well as Retail and National Accounts. The Owner ruling is silent on the third, which widens it rather than contradicting it | Recorded. This lane makes no channel-based claim, so nothing is invalidated | Not re-derived — outside this lane's read set |

### 0.5 Further EMP-ROLE findings that bear directly on this lane

| Finding | Why it matters to employee work | Status |
|---|---|---|
| **There is no job-role vocabulary.** Five disjoint vocabularies exist with no mapping between them. `jobTitle` is free text; `operationalRoles[]` has 8 values of which **5 have no consumer anywhere** | This is the upstream cause of §1's fragmentation. The 40 corpus role labels are not a naming accident — **there is no canonical job-role vocabulary for them to have used** | **From EMP-ROLE** |
| **MANAGER and JOB ROLE are conflated in opposite directions by two subsystems at the same baseline.** Two answers to *"who manages this person"* exist and nothing reconciles them | Every escalation in §2 and every accountability claim in §5.1 runs through "who manages this person". There are two answers | **From EMP-ROLE** |
| **Proficiency, skill and certification are wholly unmodelled** | See §4.1 row 23 and §5.2 below — a named, concrete instance of work EOS does not hold | **Re-derived here — see §5.2** |
| **26 of 45 governed Roles have no corpus activity at all** | The measurement floor in §0.2 is worse than this lane could see from the corpus alone: it is 660 of 1,010 rows **and** 19 of 45 governed Roles | **From EMP-ROLE** |

---

## 1. The organising finding: EOS role labels fragment real jobs

The corpus carries **40 distinct role labels** across three libraries. They do not describe 40 jobs.
They describe roughly **ten real jobs**, each split across libraries because each library was scoped
to a module. **The fragmentation is the finding:** it is direct evidence that EOS's module boundaries
cut across the people who use it.

| Real job | Role labels in the corpus | Activities | Libraries spanned |
|---|---|---|---|
| **TECHNICIAN** | `field_technician` (104, B1), `Field Technician` (26, B2), `apprentice_technician` (9, B1), `Technician` (4, B3) | **143** | 3 |
| **PARTS / WAREHOUSE DESK** | `Parts Manager` (65, B2 + 4, B3), `Parts Associate` (37), `Stocker/scanner operator` (28), `Receiving Lead` (19), `Branch Parts Coordinator` (12), `Satellite Attendant` (7), `parts_counter` (5, B1), `Warehouse Manager` (5, B3), `Stocker` (4) | **186** | 3 |
| **OPS / SERVICE MANAGEMENT** | `service_manager` (60, B1), `Operations Manager` (17, B2 + 26, B3), `General Manager` (14), `Owner` (10), `Field Manager` (9) | **136** | 3 |
| **ADMINISTRATOR** | `Administrator` (83, B3), `System Admin` (27, B2), `Report Viewer` (1) | **111** | 2 |
| **DISPATCHER** | `dispatcher` (61, B1), `Dispatcher` (27, B2 + 9, B3) | **97** | 3 |
| **SALES** | `Salesperson` (43), `Sales Manager` (52), `Marketing Manager` (2) | **97** | 1 |
| **FINANCE** | `Controller` (19, B2 + 30, B3), `Accounting Manager` (36), `Finance Manager` (2) | **87** | 2 |
| **COORDINATOR** | `service_coordinator` (68, B1), `after_hours_coordinator` (5) | **73** | 1 |
| **BILLING / OFFICE** | `service_billing_admin` (18, B1), `Office Manager` (18, B3) | **36** | 2 |
| **INVENTORY CONTROL** | `Inventory Control Analyst` (34, B2) | **34** | 1 |
| **PURCHASING** | `Purchasing Admin` (8, B2), `Purchasing Manager` (2, B3) | **10** | 2 |

**Four jobs — Technician, Parts/Warehouse, Ops Management, Dispatcher — each appear in all three
libraries under three different labels.** A Dispatcher is `dispatcher` in Service, `Dispatcher` in
Inventory, and `Dispatcher` again in Sales/Admin, and no artifact in the corpus joins those three
views of one person's day.

### 1.1 Roles whose work crosses the most module boundaries

Derived from the 86-workflow registry's `actors` × `domain` fields — the most reliable crossing
measure available, because the registry assigns each workflow exactly one domain and names its actors
explicitly. **[TRACED]**

| Rank | Real job | Workflows | EOS domains crossed | Domains |
|---|---|---|---|---|
| 1 | **Field Technician** | 18 | **8** | Service, Technician, Equipment, Inventory, Warehouse, Scanner, Reporting, Cross-domain |
| 1 | **Operations Manager** | 12 | **8** | CRM, Sales, Finance, Inventory, Purchasing, Warehouse, Reporting, Cross-domain |
| 3 | **Controller** | **20** (most of any actor) | 6 | Finance, Inventory, Purchasing, Service, Administration, Cross-domain |
| 3 | **Dispatcher** | 19 | 6 | Service, Scheduling, Equipment, CRM, Sales, Cross-domain |
| 3 | **Salesperson** | 12 | 6 | Sales, CRM, Finance, Inventory, Reporting, Cross-domain |
| 6 | Accounting Manager | 14 | 5 | Finance, Sales, CRM, Technician, Cross-domain |
| 6 | Sales Manager | 14 | 5 | Sales, CRM, Finance, Reporting, Cross-domain |
| 6 | Parts Manager | 13 | 5 | Inventory, Purchasing, Equipment, Finance, Cross-domain |
| 9 | Administrator | 11 | 4 | Administration, CRM, Finance, Cross-domain |
| 9 | General Manager | 9 | 4 | Administration, Finance, Reporting, Sales |
| 9 | Owner | 9 | 4 | Administration, Finance, Reporting, Cross-domain |

**The two jobs that cross the most boundaries sit at opposite ends of the company** — a technician in
a parking lot and an operations manager at a desk — and **neither has a surface that spans their
eight domains.** The technician's eight domains are reached through one handheld; the operations
manager's eight through a dashboard the archaeology records as composed of placeholders.

**Health of the work, by job.** Registry `state` per actor. `WORKS_WITH_GAPS` is the only state in
which a person can finish the job today.

| Real job | Workflows | WORKS_WITH_GAPS | BROKEN_MIDWAY | CANNOT_START | NO_IMPLEMENTATION | % finishable |
|---|---|---|---|---|---|---|
| Dispatcher | 19 | 10 | 8 | 1 | 0 | **53%** |
| Service Manager | 9 | 5 | 4 | 0 | 0 | **56%** |
| Parts Associate | 8 | 3 | 4 | 1 | 0 | 38% |
| Parts Manager | 13 | 4 | 5 | 4 | 0 | 31% |
| Field Technician | 18 | 5 | 8 | 4 | 1 | **28%** |
| Service Coordinator | 10 | 3 | 5 | 1 | 1 | 30% |
| Inventory Control Analyst | 6 | 2 | 2 | 2 | 0 | 33% |
| Salesperson | 12 | 3 | 4 | 4 | 1 | 25% |
| Controller | 20 | 3 | 7 | 9 | 1 | **15%** |
| Operations Manager | 12 | 2 | 6 | 3 | 1 | 17% |
| Accounting Manager | 14 | 2 | 4 | 7 | 1 | 14% |
| Administrator | 11 | 1 | 8 | 1 | 1 | **9%** |
| Sales Manager | 14 | 1 | 6 | 6 | 1 | **7%** |
| General Manager | 9 | 0 | 2 | 6 | 1 | **0%** |
| Service Billing Admin | 5 | 0 | 2 | 2 | 1 | **0%** |

**Two jobs have no finishable workflow at all: General Manager and Service Billing Admin.** The
person who turns completed work into money, and the person accountable for the company's numbers,
can complete nothing end to end. **[TRACED]**

### 1.2 Service Coordinator and Dispatcher are two roles — re-derived

EMP-ROLE withdrew an earlier merge of these two. This lane confirms the separation from the corpus,
on the dimensions the Owner's Retail-vs-National-Accounts ruling turns on:

| Dimension | Service Coordinator | Dispatcher | Disjoint? |
|---|---|---|---|
| Activities | **68** | **61** | — |
| Personas | Marisol Vega (Taylor), Rosa Delgado (Ventana) | Dale Brackett (Taylor), Brett Hollins (Ventana) | **Yes — zero overlap** |
| Governed security Role | **None** | **Yes**, and a place in the org tree | Yes |
| Commitment authority | Cannot MarkReady, cannot Dispatch (`P3B1-S02-A08`, `P3B1-S08-A07`) | Both | Yes |
| HANDOFF-tagged activities | 9 | 13 | — |
| Terminal escalation point | Escalates **to** Dispatcher | Escalates to **nobody named** | Yes |

**The functional split is the point:** the Coordinator talks to the customer and the Dispatcher can
see the schedule, and `P3B1-S30-A09` states the consequence directly — *"The person talking to the
customer and the person who can see the schedule are two people."* Merging them would erase the
single most consequential handoff in §5.

**A caveat on this lane's own grouping.** §1 folds `after_hours_coordinator` into COORDINATOR. That is
**this lane's inference, not a corpus fact**: the persona is disjoint (Ken Iwata, 5 activities,
`defaultDeviceContext: MOBILE`, where both day coordinators are DESKTOP). Whether Ken is a coordinator
on a rota or a distinct job is **MISSING INPUT** (§8.1).

---

## 2. The per-role work matrix

Thirteen facets per job, as required. **[AUTHORED]** unless marked. Activity ids are citations.

### 2.1 SERVICE COORDINATOR / AFTER-HOURS COORDINATOR — 73 activities

*The customer-promise desk. Takes demand in by email and phone and turns it into a Work Order.*

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Decide which overnight email is real service demand; create Work Orders from phone calls; link equipment and location; tell the customer when someone is coming; hand undecided rows on |
| **DAILY QUESTIONS** | What came in overnight and is any of it an emergency? Which account does this sender belong to? Is there capacity before I promise a time? Did the transport actually poll, or is the queue empty because it is broken? |
| **TRIGGERS** | Inbound email transport polls and stages weekend messages (`P3B1-S01`); a customer phones (`P3B1-S02`, `P3B1-S30`); an after-hours emergency at 22:40 (`P3B1-S19`); a PM campaign planning morning (`P3B1-S23`) |
| **WORK ARRIVING** | 11 `inbound_work_requests` — 8 `AWAITING_DECISION`, 2 `NEEDS_REVIEW`, 1 `QUARANTINED` (`P3B1-S01-A01`); phone calls; the night coordinator's note and voicemail (`P3B1-S19-A09`) |
| **PLANNED WORK** | Clear the inbound queue before dispatch builds the day; quarterly PM campaign over 62 convenience stores (`P3B1-S23`) |
| **INTERRUPTIONS** | 4 `BACK_BUTTON_ABANDONED_FLOW`, 6 `AFTER_HOURS`. Starts an accept, opens the candidate picker, abandons it — *"the queue has no in-progress state between decidable and decided… nothing records that she looked at it and could not decide, so the next coordinator starts from zero"* (`P3B1-S18-A06`). Sessions expire while coordinators are on the phone (`P3B1-S18-A10`) |
| **DECISIONS** | Accept / decline / quarantine each inbound row; which of two matching accounts owns an ambiguous sender (`P3B1-S01-A06`); whether to promise a time without seeing capacity (`P3B1-S30-A09`) |
| **INFORMATION NEEDED** | Last successful poll time (`P3B1-S01-A01` — *"the screen must say when it last successfully polled, not just show zero rows"*); which rows a colleague is already chasing; open capacity; the difference between `AWAITING_DECISION` and `NEEDS_REVIEW` (*"'same queue, louder' is in the code comment and nowhere on screen"*) |
| **ACTIONS** | Accept → creates Work Order; decline; quarantine; attach a follow-up email to the existing WO rather than raising a second (`P3B1-S01-A07`); create WO by hand; cancel own error |
| **HANDOFFS** | **9 HANDOFF-tagged.** Out: to Dispatcher for MarkReady and Dispatch (cannot do either — `P3B1-S02-A08`, `P3B1-S08-A07`); to the afternoon coordinator (`P3B1-S01-A10`); to Billing. In: from the night coordinator (`P3B1-S19-A09`) |
| **EXCEPTIONS** | 9 EXCEPTION, 19 MISSING_DATA, 13 CROSS_COMPANY. A dead poller renders identically to a quiet weekend; a Ventana customer calls the Taylor number (`P3B1-S30-A08`); an account whose location has no registered equipment (`P3B1-S02-A05`) |
| **RECOVERY** | 4 RECOVERY. *"There is no in-product way to renumber a Work Order"* (`P3B1-S02-A09`). A WO created in error can be cancelled — but **a coordinator without the dispatcher role cannot cancel her own two-minute-old mistake and must ask a dispatcher** (`P3B1-S02-A06`) |
| **ESCALATIONS** | To Dispatcher for anything commitment-shaped. **After 17:30 there is nobody:** *"At 17:30 when the dispatcher has gone home, the coordinator taking an emergency call cannot dispatch anybody"* (`P3B1-S08-A07`). The after-hours coordinator *"phones a dispatcher at home"* (`P3B1-S19-A02`). **No urgency detection on inbound work — a request arriving at 18:30 waits until 06:40 and nothing escalates it regardless of content** (`P3B1-S22-A05`) |

### 2.2 DISPATCHER — 97 activities

*Owns and defends the board. The single most cross-cutting operational job: 19 workflows over 6 domains.*

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Build tomorrow on the board; commit a named technician to a named job; absorb the day's changes; cover absence; hand the board on at shift change |
| **DAILY QUESTIONS** | Who is available and who is on PTO? What is ready to schedule? Which dispatched job has not been accepted? What changed on the board since I last looked? Who is covering the sick technician's four outstanding jobs? |
| **TRIGGERS** | Ready-to-Schedule queue (`P3B1-S04-A01`); a customer closes for a burst pipe (`P3B1-S07-A05`); a technician phones from a locked door (`P3B1-S11-A05`); a technician goes home sick at 11:00 with four jobs outstanding (`P3B1-S21-A09`); a reorder request needing approval (`S03-A02`, B2) |
| **WORK ARRIVING** | Work Orders marked ready by coordinators; technician phone calls; reorder requests for review (B2 `S03`); PM campaign rows |
| **PLANNED WORK** | Build Tuesday (`P3B1-S04`); 7 END_OF_DAY activities including the board handoff |
| **INTERRUPTIONS** | Arrival exceptions, cancellations mid-drive, sick cover. 8 MISTAKE-tagged. *"Curtis is on the phone"* (`P3B1-S11-A05`) |
| **DECISIONS** | Placement against blocked time — *"the board surfaces the collision; a person decides"* (archaeology §7.1: **nothing surfaces it**); whether to cancel-and-recreate or leave a job and phone the customer; approve/reject a reorder request |
| **INFORMATION NEEDED** | Technician availability including PTO (`P3B1-S06` — *"the recommendation that does not know about PTO"*); what the morning dispatcher did; whether a dispatched job was accepted |
| **ACTIONS** | MarkReady, Dispatch, Unschedule, Reschedule, Cancel, record blocked time, approve reorder |
| **HANDOFFS** | **13 HANDOFF-tagged, the most of any job.** To Technician (Dispatch sets `assignedTechId` — *"until Dispatch runs, the Work Order carries no assignedTechId at all"*, `P3B1-S08-A01`); to the evening dispatcher (`P3B1-S22-A08`); to Parts Manager on reorder approval (`S03-A02`) |
| **EXCEPTIONS** | 30 EXCEPTION — the highest count of any job. Dispatch a WO with no address (`P3B1-S08-A08`); a job dispatched to an id that does not match the technician's `technicianId` is *"invisible to everyone except admins and dispatchers"* (`P3B1-S33-A07`) |
| **RECOVERY** | 7 RECOVERY. Reassigning an in-progress job is **not expressible**: *"Dale tells Javier verbally and the record stays on Curtis"* (`P3B1-S21-A02`). Cancel-and-recreate *"loses the arrivedAt, workStartedAt and three hours of execution data"* |
| **ESCALATIONS** | Receives escalation from Coordinator, Technician, Parts Associate (*"Dwayne must ask a dispatcher"*, `S07-A04`) and Purchasing Admin (*"Ask an admin or dispatcher to reassign"*, `S04-A04`). **Escalates to: nobody named in the corpus.** The dispatcher is the terminal operational escalation point and the corpus records no path above them |

### 2.3 FIELD TECHNICIAN (incl. apprentice) — 143 activities

*Crosses the most EOS domains of any job: 8. Works from a handheld, mostly alone, often offline.*

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Accept, travel, arrive, diagnose, record, consume parts, install equipment, complete. Receive truck transfers; find staged parts; load the truck |
| **DAILY QUESTIONS** | What is assigned to me? What machine am I going to and what is its history? Do I already have the part on the truck? Where did the parts desk stage my kit? What is still pending in my sync queue? |
| **TRIGGERS** | Dispatch sets `assignedTechId`; a transfer arrives on the truck at 07:05 (`S23-A07`, B2); a staged kit is needed at 06:05 (`S16-A04`, B2); a manufacturer safety notice (`P3B1-S31`) |
| **WORK ARRIVING** | Dispatched jobs (readable only where `assignedTechId` matches); truck transfers; staged put-away sessions |
| **PLANNED WORK** | The day's accepted jobs in sequence — **sequenced by the technician, not the system**: *"Curtis sequences by memory and local knowledge, which is usually better than anything the data supports"* (`P3B1-S10-A10`) |
| **INTERRUPTIONS** | **15 NETWORK_INTERRUPTION — by far the highest of any job.** The dead zone (`P3B1-S15`); the gun in the freezer, the network in the parking lot (`S21`, B2). 5 AFTER_HOURS |
| **DECISIONS** | Whether to work a job assigned to someone else on a colleague's word (`P3B1-S21-A03`); whether to record a part off the truck via scan or dashboard (`P3B1-S13-A03`); whether to trust a register serial that is wrong |
| **INFORMATION NEEDED** | Equipment context at the site — **denied**: equipment reads are gated on `isAdminOrDispatcher()` and *"a technician is neither"* (`WF-EQP-004`, CANNOT_START/RULES_DENY) **[TRACED]**. Other service locations on the account — cannot see them, *"so the most common arrival exception is invisible"* (`P3B1-S11-A02`). Whether van stock holds the part — *"the balance screen cannot answer 'does my technician already have one?'"* (archaeology Part 12.12) |
| **ACTIONS** | Accept, Travel, Arrive, WorkStart, Complete; scan parts; dictate notes (review is mandatory, *"dictation never auto-saves, which is the right call in a noisy environment"*, `P3B1-S12-A03`); receive transfer; install |
| **HANDOFFS** | **14 HANDOFF-tagged.** In: from Dispatcher; from Parts Associate (staged kit). Out: to Billing on Complete; **to another technician — impossible.** `P3B1-S21` is titled *"handing a job over: the transfer EOS cannot express."* Inventory custody → equipment custody at install: *"Two authorities, one machine"* (`S30-A04`, B2) |
| **EXCEPTIONS** | 33 MISSING_DATA, 24 EXCEPTION, 21 BAD_DATA. Store shut, address wrong, machine fine (`P3B1-S11`) — *"the lifecycle models a visit that succeeds"* (`P3B1-S11-A05`). **No governed non-completion: a technician cannot record "I could not do this", only Cancel** (archaeology §7.4) |
| **RECOVERY** | 11 RECOVERY. Taps Arrive by mistake on the freeway — *"the only recovery is a back-office correction outside the lifecycle, and there is no such correction path in the technician's app"* (`P3B1-S10-A06`). A refused queued intent: *"her ninety minutes of work exist only as a refused intent. There is no Work Order to attach them to"* (`P3B1-S15-A04`) |
| **ESCALATIONS** | Phones the Dispatcher. **Cannot record his own absence** — `createTechnicianBlockedTime` is admin/dispatcher only (archaeology §7.5). A refused sync intent: *"whether anything escalates it is UNPROVEN"* (`P3B1-S15-A05`) |

### 2.4 PARTS / WAREHOUSE DESK — 186 activities (largest single job in the corpus)

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Receive supplier deliveries; record and chase purchase orders; stage kits for named jobs; stow and relocate stock; move stock across the company line; close out at 17:30 |
| **DAILY QUESTIONS** | What is expected on the dock today? Where did we put it? Which approved request went where? Is this Taylor's shelf or Ventana's? Which lines carry into tomorrow and need a second reviewer? |
| **TRIGGERS** | The Tuesday supplier drop (`S01`); a reorder recommendation (`S02`); a dispatcher approval landing in the Parts Manager queue (`S03-A02`); a technician's restock request from the truck (`S23-A02`); 17:30 close-out (`S31`) |
| **WORK ARRIVING** | Three open supplier receipts on the awaiting-receipt queue, *"one belongs to ventana"* (`S01-A01`); approved reorder requests; technician restock requests |
| **PLANNED WORK** | Quarterly cycle count (`S26`); month-end SKU reconciliation; the opening-balance workbook (`S33`) |
| **INTERRUPTIONS** | *"A phone call interrupts"* (`S02-A06`); 8 BACK_BUTTON/ABANDONED_FLOW; 6 AFTER_HOURS; a vendor *"calls back to change the quantity mid-form"* (`S05-A08`) |
| **DECISIONS** | Assign an approved request to a named person (`S04-A01`); whether to void or cancel a PO; disposition of a counted variance; whether to stow warehouse-direct when the bin is unknown |
| **INFORMATION NEEDED** | **23 `had_to_hunt` — highest single role label in the corpus.** Where an approved request went (`S03-A10` — *"if it lands nowhere visible it simply waits"*); which of two Parts claims internal part number TST-1022 (`S14`); operating-company attribution on the queue row |
| **ACTIONS** | Receive, record receipt lines, record PO, void, cancel, mark received, assign, stage/put-away, relocate, transfer, dispatch transfer |
| **HANDOFFS** | **8 HANDOFF-tagged.** Dispatcher → Parts Manager (approval); Parts Manager → Parts Associate (*"the request leaves the manager queue and enters Dwayne's personal queue"*, `S04-A01`); Parts Associate → Technician (staged kit, `S16-A03`); gun handed between operators mid-session (`S20-A08`); shift change at 22:00 (`S21-A08`) |
| **EXCEPTIONS** | 53 EXCEPTION and 46 BAD_DATA — the highest of both in the corpus. 19 CROSS_COMPANY. Four drive belts cross the company line (`S24`); *"the belts sit in Ventana's stockroom, fitted on Thursday, owned by Taylor on paper forever"* (`S24-A06`) |
| **RECOVERY** | 14 RECOVERY. *"Ray's recovery is a phone call today"* (`S01-A08`). *"The real-world recovery is a spreadsheet and a phone call. That is the gap"* (`S14-A08`). *"Luis's real recovery is to stow warehouse-direct and write the shelf on paper"* (`S15-A10`). **No governed command closes a short receipt line** — *"a line short stays open and the order stays SENT, indefinitely"* (archaeology Part 12.2) |
| **ESCALATIONS** | *"The escalation target is Sam Ortega (System Admin) to activate the capability — and the screen must say so rather than leaving Tessa to guess"* (`S26-A02`). Associate → Dispatcher for void/cancel (`S06-A05`, `S07-A04`). Self-submitted variance lines need a second reviewer who *"must be told the line was disposed of by the first, with the first reviewer's name and reason"* (`S28-A04`) |

### 2.5 INVENTORY CONTROL ANALYST — 34 activities

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Keep part identity true; run and reconcile cycle counts; age open transfers; validate imports before they land |
| **DAILY QUESTIONS** | Which SKUs are not parts? Which two Parts share one internal part number? Which transfers have not arrived? Does this import's warehouse name resolve to exactly one warehouse? |
| **TRIGGERS** | Quarterly cycle count (`S26`); an opening-balance spreadsheet naming an ambiguous warehouse (`S18-A04`); month-end (`S14-A10`); a variance she counted herself (`S27-A05`) |
| **WORK ARRIVING** | Import files from branches; counted variance lines awaiting review |
| **PLANNED WORK** | 5 END_OF_MONTH; age every open transfer across both companies (`S25-A02`) |
| **INTERRUPTIONS** | 1 ABANDONED_FLOW. Low interruption load — this is desk work |
| **DECISIONS** | Disposition of each variance line; whether an ambiguous import row may proceed (it must not) |
| **INFORMATION NEEDED** | 15 `had_to_hunt`. Which Part a duplicate number belongs to; whether an expected-quantity read is company-scoped — **it is not**: *"the expected-quantity transaction queries `where('partId','==',partId)` with NO operatingCompanyId predicate and filters ONLY on location in memory"* (`S27-A09`) **[TRACED]** |
| **ACTIONS** | Run import preview; submit/reconcile cycle count; age transfers; attempt a Part merge |
| **HANDOFFS** | 2 HANDOFF. To a second reviewer for her own variance (`S27-A05` — *"this is a genuine role handoff, not an error"*); to System Admin for capability activation |
| **EXCEPTIONS** | 16 EXCEPTION, 16 BAD_DATA. Two parts one part number (`S14`); a spreadsheet naming *"Ventana Main"* where two warehouses match (`S18-A04`) |
| **RECOVERY** | *"Until a merge exists the only workaround is to retire one Part by status change and hand-correct its ledger, which an append-only ledger does not permit"* (`S14-A08`). *"If the list cannot be produced, the recovery is a manual ledger export and a spreadsheet, which is what will happen"* (`S25-A02`) |
| **ESCALATIONS** | To System Admin (capability activation, `S26-A02`); to a second reviewer (`S27-A05` — *"the screen must offer that as the next action, with the eligible reviewers named, or the recovery is a Slack message"*) |

### 2.6 SERVICE BILLING ADMIN / OFFICE MANAGER — 36 activities

*Turns finished work into money. **Zero finishable workflows.***

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Close completed Work Orders; bill the visit; reconcile one fault that produced two Work Orders; chase content out of empty completions |
| **DAILY QUESTIONS** | Which COMPLETED Work Orders can I close? What did this job actually cost in labour? Is this one trip charge or two? |
| **TRIGGERS** | A technician taps Complete; a customer reads a WO number over the phone (`P3B1-S02-A09`); month-end (11 END_OF_MONTH) |
| **WORK ARRIVING** | COMPLETED Work Orders — *"aged COMPLETED Work Orders accumulate as a queue nobody can clear"* (`P3B1-S16-A06`) |
| **PLANNED WORK** | Month-end close across two companies (`P3B1-S24`) |
| **INTERRUPTIONS** | 1 ABANDONED_FLOW, 1 AFTER_HOURS, 2 END_OF_DAY |
| **DECISIONS** | Whether to close a Work Order with no note and no parts; whether to charge one trip or two for one fault across two WOs (`P3B1-S20-A10` — *"a decision with no support in the data"*) |
| **INFORMATION NEEDED** | Labour time — **absent everywhere**: *"Labour time is therefore captured outside EOS, on paper or in payroll, and the Work Order carries none"* (`P3B1-S12-A04`). Both `workOrder.labor.record` and `.correct` are `active:false` and absent from every activation override including platform-sandbox **[EXECUTED]** (`WF-SVC-009`) |
| **ACTIONS** | Close (irreversible — *"a Work Order closed in error cannot be reopened"*, `P3B1-S16-A05`); search by WO number; merge bills by hand |
| **HANDOFFS** | 3 HANDOFF. In: from Technician on Complete. Out: **nowhere.** *"Nothing downstream is triggered by Close in this lane's reading — no invoice, no customer notification"* (`P3B1-S16-A05`). Billing Queue *"is unwired and `billingQueue.ts` has zero importers… written and connected to neither end"* (archaeology §8.3.9) |
| **EXCEPTIONS** | A technician completes with no content; one fault, two WOs; an after-hours job with no rate model, no premium and *"no route into billing at all"* (`WF-SVC-013`) |
| **RECOVERY** | *"The technician is phoned and re-enters the information verbally; she types it into a note field she may not have access to"* (`P3B1-S16-A06`). *"She reconstructs it from the technician's paper timesheet"* (`P3B1-S19-A10`). *"She merges them by hand in the billing system"* (`P3B1-S20-A10`) |
| **ESCALATIONS** | None recorded. **`WF-FIN-002` (bill a service visit with no Sales Order behind it) is CANNOT_START: *"the most common revenue event in a field-service business"* has no route into the billing spine** |

### 2.7 FINANCE — CONTROLLER / ACCOUNTING MANAGER — 87 activities

*Controller carries 20 registry workflows, more than any other actor. 15% finishable.*

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Produce the month's four inventory numbers; attest what the position rests on; close the period; reconcile EOS against the system of record; set approval thresholds |
| **DAILY QUESTIONS** | What is on hand and what is it worth? What was the margin? Which company did the work? Can I close the period? Who approved this credit? |
| **TRIGGERS** | Month end (17 END_OF_MONTH — highest of any job); a credit above threshold; a late transaction against a closed period |
| **WORK ARRIVING** | Month-end close obligations; variance and reconciliation exceptions |
| **PLANNED WORK** | `S32` *"Month end — the Controller's four numbers"*; period close |
| **INTERRUPTIONS** | 3 AFTER_HOURS. Largely calendar-driven, not interrupt-driven |
| **DECISIONS** | Approval thresholds for credits, write-offs and refunds and who the second approver is (`P3B3-FIN-048`, `P3B3-FIN-069`) — **the approval machinery *"is built and has no policy values to enforce"*** |
| **INFORMATION NEEDED** | Margin — *"STRUCTURALLY unknown… the binding display rule is that it must render as unknown, never 0%"* (`WF-FIN-008`, `WF-INV-016`; the cost engine is *"written, 425 lines, and imported by nothing"*). Operating company on a Work Order — **none carries one, and DECISIONS #143 forbids inferring it** (`WF-SVC-016`) |
| **ACTIONS** | Publish the position and record what it rests on (`S32-A10`); close the period (`WF-FIN-007`, CANNOT_START); reconcile (`WF-FIN-011`, CANNOT_START) |
| **HANDOFFS** | **0 HANDOFF-tagged in P3-B2; P3-B3 cannot express any.** In: from Parts/Warehouse and Billing. Out: to Owner/GM |
| **EXCEPTIONS** | *"FIN-008 models period close but not reopen. A late transaction against a closed period refuses, and there is no modelled path forward"* (archaeology §8.3.5). An overpayment *"cannot be recorded at all"*; a deposit before invoicing *"has nowhere to sit"* (`WF-FIN-003`) |
| **RECOVERY** | *"Brenda's recovery is to attest from engineering's deployment history, outside the system"* (`S18-A10`) — and those writes *"have no in-product audit entry and no actor the product can name."* *"CURRENT: no surface produces any of that, so the figure will be assembled by hand and its provenance will live in someone's spreadsheet"* (`S32-A10`) |
| **ESCALATIONS** | To the Owner, as blocked decisions: intercompany accounting is blocked *"by explicit Owner block… a recorded refusal to guess, not a gap"* (`WF-FIN-009`); which system is authority of record is undecided (#145, `WF-FIN-011`). **`WF-FIN-001`: *"THE BUSINESS CANNOT BILL A CUSTOMER FROM EOS TODAY IN PRODUCTION"*** **[EXECUTED]** |

### 2.8 SALES — SALESPERSON / SALES MANAGER — 97 activities

*No coverage tags, no friction scores, no operating company. 7% finishable for Sales Manager.*

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Open and work an opportunity; quote the deal; book, allocate and fulfil a Sales Order; maintain the account |
| **DAILY QUESTIONS** | What is in my pipeline and what closes this month? What did we quote last time? What is this account's installed base? Am I allowed to see this number? |
| **TRIGGERS** | *"A Taylor Freezer of Arizona account manager calls in after a compressor failure and asks for replacement pricing rather than another repair"* (`P3B3-SALES-001`) — **a service call becoming a sales opportunity** |
| **WORK ARRIVING** | Inbound calls; **not** service-originated replacement conversations — *"the Service → Sales direction does not exist in any form. Every replacement-machine conversation that starts as a repair call leaves EOS at the Work Order"* (`WF-XD-004`) |
| **PLANNED WORK** | Pipeline review; goal tracking (`WF-RPT-004`, CANNOT_START — all five capabilities `active:false`) |
| **INTERRUPTIONS** | **UNMEASURABLE — P3-B3 carries no coverage tags** |
| **DECISIONS** | Price every line by hand: *"Every price on every agreement is typed by hand, with no history, no list, no schedule, no template and no approval threshold"* (`WF-SLS-005`, NO_IMPLEMENTATION) |
| **INFORMATION NEEDED** | Any financial fact — **none available**: *"a Salesperson and a Sales Manager can see NO financial fact"* under the only environment where finance is activated (`WF-FIN-006`) **[EXECUTED]** |
| **ACTIONS** | Create Opportunity (*"explicitly pre-commitment and writes nothing into inventory or service"*, `P3B3-SALES-001`); draft Sales Agreement; book Sales Order |
| **HANDOFFS** | To Dispatcher/Operations for fulfilment — **broken and it survives activation**: *"`salesOrder.fulfill` and `salesOrder.service` are held by `owner`, `admin` and `dispatcher` and by NO governed business role"* **[EXECUTED]** (`WF-SLS-003`) |
| **EXCEPTIONS** | *"An acceptance blocked by an unpriced line CANNOT BE CLEARED FROM THE RECORD PAGE, because line pricing is not on it. Two surfaces, one record, one editor — and the product never taught anyone which"* (`WF-SLS-002`, archaeology §8.3.1 SA-G7) |
| **RECOVERY** | **None after acceptance:** *"commercial terms cannot change at all. No edit, no supersede, no second agreement, no decline. A renegotiation has no governed move"* (archaeology §8.3.2, SA-G6). `DECLINED` *"is modelled, legal, labelled — and unreachable"* (§8.3.3) |
| **ESCALATIONS** | Approval thresholds do not exist (`WF-SLS-005`). **`WF-XD-001` *"Opportunity to cash"* is CANNOT_START: *"37 of 147 capabilities are allowed anywhere in production and NOT ONE OF THEM IS COMMERCIAL"*** **[EXECUTED]** |

### 2.9 OPS / SERVICE MANAGEMENT — SERVICE MGR, OPS MGR, GM, OWNER, FIELD MGR — 136 activities

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Record blocked time and closures; review the morning's Work Orders for completeness; attribute work to the right technician and the right company; run the scorecard; close the service month |
| **DAILY QUESTIONS** | Who is available? Is today's work complete enough to dispatch? Which company performed this work? Is the scorecard true? |
| **TRIGGERS** | PTO and closure requests (`P3B1-S05`); month end (28 END_OF_MONTH — highest in the corpus); a manufacturer safety notice (`P3B1-S31`) |
| **WORK ARRIVING** | Blocked-time requests; completeness exceptions; variance and attribution questions |
| **PLANNED WORK** | Month end across two companies (`P3B1-S24`); the scorecard (`P3B1-S28` *"The scorecard that refuses to lie"*) |
| **INTERRUPTIONS** | 0 NETWORK_INTERRUPTION, 0 BACK_BUTTON. Desk-and-calendar work |
| **DECISIONS** | Whether overlapping blocked-time facts are legitimate — Owner ruling: *"ACCEPTED — overlapping blocked-time facts are legitimate and unavailable time is their UNION"* (`P3B1-S05-A02`, `behaviourClaim: DESIRED`); which technician owns which labour |
| **INFORMATION NEEDED** | **29 `had_to_hunt` and 24 `ownership_unclear` — the highest of any role label on both counts.** Service quality: on-time completion, first-time fix and jobs-per-workday are *"named, slotted and empty on an accepted surface, assigned to a Service Operations domain authority that does not exist"* (archaeology §7.11) |
| **ACTIONS** | Record blocked time; review created WOs; attribute the day's work; publish the position |
| **HANDOFFS** | **1 HANDOFF-tagged across 136 activities.** Management's handoffs are essentially unmodelled — see §5 |
| **EXCEPTIONS** | 33 MISSING_DATA, 20 BAD_DATA. *"Record blocked time for a technician id that does not exist"* from *"a stale technician id from a spreadsheet"* (`P3B1-S05-A08`). *"Two technicians on one job — routine for an install or a heavy lift — is unrepresentable"* (`P3B1-S21-A07`) |
| **RECOVERY** | 13 RECOVERY. *"The recall's completion lives in a document outside EOS, which is where the evidence will be looked for years later"* (`P3B1-S31-A10`) |
| **ESCALATIONS** | To the Owner as unresolved rulings. **General Manager: 0 of 9 workflows finishable.** `WF-SVC-016` (service month close and scorecard): *"Step 3 is impossible: no Work Order carries an operating company"* |

### 2.10 ADMINISTRATOR / SYSTEM ADMIN — 111 activities

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Grant roles; onboard employees; create warehouses and bins; stage customer imports; govern objects; see who did what |
| **DAILY QUESTIONS** | Does this grant actually grant anything? Who did what? Which capability is inactive and where? |
| **TRIGGERS** | A new technician on day one (`P3B1-S33`); a request to create a Ventana warehouse (`S18-A01`); a customer import from a spreadsheet (`P3B3-ADMIN-041`) |
| **WORK ARRIVING** | Access requests; escalations from Parts (`S26-A02`) and Inventory Control |
| **PLANNED WORK** | Onboarding; the opening-balance workbook (`S33`) |
| **INTERRUPTIONS** | 2 BACK_BUTTON, 1 ABANDONED_FLOW, 3 AFTER_HOURS |
| **DECISIONS** | Which role to grant — **with no reliable feedback**: *"The recovery is for Sam to learn the capability is inactive, which nothing on the Role screen tells him"* (`S15-A03`) |
| **INFORMATION NEEDED** | Whether a granted capability resolves. Audit: **unreadable** — *"An append-only audit authority genuinely exists and governed commands write to it — including DENIALS. An administrator cannot read it"* (`WF-ADM-006`) |
| **ACTIONS** | Grant role; stage import; print bin labels; attempt warehouse creation |
| **HANDOFFS** | 2 HANDOFF. *"Nothing changes for Luis. The handoff Sam thinks he completed did not happen"* (`S15-A03`) — **a handoff that silently does not occur** |
| **EXCEPTIONS** | Employee create *"is a Node script. `functions/scripts/provisionEmployeeAccess.js`. No callable, no screen, no capability row"* (archaeology §8.3.6). **`Employees` has no row in any of the four access tables** (§7.5) |
| **RECOVERY** | *"Sam's real recovery is to ask an engineer to run a script. That is the finding"* (`S18-A01`). *"an administrator should be told that warehouse creation is an out-of-band operation, not left to search for a button"* (`S18-A01`) |
| **ESCALATIONS** | **To engineering, outside the product.** Administrator is 9% finishable — 8 of 11 workflows BROKEN_MIDWAY |

### 2.11 PURCHASING — 10 activities

| Facet | Content |
|---|---|
| **JOBS TO BE DONE** | Record purchase orders; import supplier price files; load opening balances |
| **TRIGGERS** | An assigned reorder request; a supplier price file referencing catalog SKUs (`S13-A10`) |
| **WORK ARRIVING** | Requests assigned by the Parts Manager into a **personal** queue |
| **DECISIONS / EXCEPTIONS** | 4 `MISSING_DATA`, 3 `BAD_DATA`. A warehouse name matching two warehouses; two Parts with one internal part number (`S33-A03`, `S33-A04`) |
| **HANDOFFS** | **The corpus's single most likely real-world friction:** *"A colleague tries to start purchasing on someone else's request… This is the single most likely real-world friction in the whole procurement chain, and there is NO reassignment branch in Rules to resolve it"* — consequence: *"The order misses the cut-off"* (`S04-A04`) |
| **RECOVERY / ESCALATIONS** | *"Ask an admin or dispatcher to reassign.' CURRENT RISK: a raw permission error that does not name the assignee or the escalation"* (`S04-A04`) |
| **INFORMATION NEEDED** | A business PO number — **none exists**: *"A purchase order has no business number… Nothing prints, encodes or resolves a scannable order label"* (archaeology Part 12.8). *"The internal id is the request id and is not a purchase order number anyone outside the building recognises"* (`S05-A01`) |

---

## 3. The 7:30 AM answer, per role

> *If this person started work at 7:30 AM, what should EOS already know, what should be waiting for
> them, and what should EOS bring to their attention without their having to hunt for it?*

| Real job | EOS should already know | Should be waiting | Should be brought forward unasked | Today's gap at 07:30 |
|---|---|---|---|---|
| **Coordinator** | When the inbound transport last successfully polled; which rows a colleague is mid-decision on; who the night coordinator spoke to | The decided/undecided split of the overnight queue, ordered by urgency, with each row's account resolved | **Any overnight request whose content is an emergency.** Anything promised to a customer that no Work Order yet carries | **No urgency detection and no escalation on inbound work** — an 18:30 emergency email waits until 06:40 (`P3B1-S22-A05`). An empty queue from a dead poller looks identical to a quiet weekend (`P3B1-S01-A01`). The night's decisions *"live nowhere"* (`P3B1-S19-A09`) |
| **Dispatcher** | Every technician's availability **including PTO and closures**; what the previous shift changed and why | Today's board, with unaccepted dispatches and incomplete Work Orders flagged | **Blocked-time collisions** against placed work; dispatches unaccepted past a threshold; Work Orders ready but missing address or equipment | *"The board surfaces the collision; a person decides"* — **nothing surfaces it** (archaeology §7.1). The recommendation engine *"does not know about PTO"* (`P3B1-S06`). *"The handoff dispatcher has no view of what the morning dispatcher did"* (`P3B1-S07-A10`) |
| **Technician** | Which jobs are his; each machine's history; what is on his truck; what the parts desk staged for him | The day's jobs in a workable sequence with equipment context and parts plan attached | **Whether the part is already on his truck**; cancellations that happened while he drove; anything still unsynced from yesterday | **Equipment reads are denied to technicians** (`isAdminOrDispatcher()`, `WF-EQP-004`) **[TRACED]**. *"The balance screen cannot answer 'does my technician already have one?'"* (archaeology Pt 12.12). *"Curt tries to find the beater assembly at 06:05… Curt's recovery is a phone call at 06:05, which is the workflow this feature was supposed to remove"* (`S16-A04`) |
| **Parts / Warehouse** | What is expected on the dock, and which company owns each line; where every approved request went | The awaiting-receipt queue with supplier names and operating-company attribution; lines carried over from yesterday | **Short lines still open**; staged kits at risk of being picked for another job; requests approved and sitting unassigned | *"If it lands nowhere visible it simply waits"* (`S03-A10`). *"Availability does not move, so the Thursday kit is still promisable to a Wednesday emergency call. That is the real operational risk"* (`S16-A03`). No governed command closes a short line (archaeology Pt 12.2) |
| **Inventory Control** | Which imports are pending and which rows are ambiguous; every open transfer's age | Variance lines awaiting review, with her own counts flagged as needing a second reviewer | **Duplicate part numbers**; ambiguous warehouse names in a staged import; transfers past an age threshold | *"The escalation target is Sam Ortega… and the screen must say so rather than leaving Tessa to guess"* (`S26-A02`). *"If the list cannot be produced, the recovery is a manual ledger export and a spreadsheet, which is what will happen"* (`S25-A02`) |
| **Billing / Office** | Which Work Orders completed yesterday and what each contains | The closable queue, and the aged-COMPLETED queue separately | **Completions with no note and no parts**; one fault that produced two Work Orders | *"Aged COMPLETED Work Orders accumulate as a queue nobody can clear"* (`P3B1-S16-A06`). **Labour is not in EOS at all** — `workOrder.labor.record` is `active:false` everywhere **[EXECUTED]** (`WF-SVC-009`) |
| **Finance** | Period state; what the current position rests on; which company performed each record | The close checklist with each number's provenance | **Anything that would change a published number**; approvals waiting on a threshold that is unset | Margin *"must render as unknown rather than as zero"* (`WF-FIN-008`). *"no surface produces any of that, so the figure will be assembled by hand and its provenance will live in someone's spreadsheet"* (`S32-A10`). **Cannot bill in production at all** **[EXECUTED]** (`WF-FIN-001`) |
| **Sales** | Pipeline by close month; each account's installed base and open service work | Today's pipeline with stage and age | **A repair call that should become a replacement conversation**; agreements blocked on an unpriced line | *"The Service → Sales direction does not exist in any form"* (`WF-XD-004`). A blocked agreement *"CANNOT BE CLEARED FROM THE RECORD PAGE"* (`WF-SLS-002`). Sales can see **no** financial fact **[EXECUTED]** (`WF-FIN-006`) |
| **Ops / Management** | Who is unavailable today and why; yesterday's completion truth per technician and per company | The exception list: incomplete WOs, unattributed labour, open month-end items | **Where the scorecard is built on data that cannot support it** | Service-quality metrics are *"named, slotted and empty… assigned to a Service Operations domain authority that does not exist"* (archaeology §7.11). **No Work Order carries an operating company**, and inferring it is forbidden (`WF-SVC-016`) |
| **Administrator** | Which capabilities are inactive in this environment; which grants resolve to nothing | The access-request queue; onboarding in progress | **Grants that grant nothing**; denials recorded in the audit log | *"The recovery is for Sam to learn the capability is inactive, which nothing on the Role screen tells him"* (`S15-A03`). Audit is written and unreadable (`WF-ADM-006`) |
| **Purchasing** | Which requests are assigned to whom; the supplier cut-off times | Their own assigned queue | **A request assigned to an absent colleague approaching a cut-off** | No reassignment branch exists; *"The order misses the cut-off"* (`S04-A04`) |

---

## 4. Work currently held outside EOS

**The highest-value finding in this lane: work the product does not hold at all.** Every row is a
direct quotation from a corpus row or archaeology document, with its citation. Channel counts are
distinct activities matching a tightened regex over title, trigger, narrative, purpose, starting
state, transition, cross-object effect, exception/recovery and help fields.

| Channel | Distinct activities | Of which |
|---|---|---|
| Telephone (conversation, not handset-as-device) | **40** | P3-B1 26, P3-B2 8, P3-B3 6 |
| Email as a work channel | 30 | P3-B1 dominant (the inbound queue story) |
| Spreadsheet / workbook / CSV | 22 | P3-B2 dominant (imports, opening balances) |
| Paper / printout / handwritten / clipboard / whiteboard | 20 | — |
| Text / SMS / chat | 26 | includes one explicit *"or the recovery is a Slack message"* |
| Human memory | 16 | excludes code-level "filters in memory" false positives |
| In-person / verbal / hallway | 9 | — |
| Two-way radio | 2 | — |

### 4.1 Named instances — work with no EOS home

| # | Job | What is held outside EOS | Channel | Evidence |
|---|---|---|---|---|
| 1 | Coordinator | **The promise made to the customer.** *"The coordinator picks up the phone. The promise lives outside EOS."* | Phone | `P3B1-S07-A09` |
| 2 | Coordinator | *"She promises 'this afternoon' and hopes."* — *"The person talking to the customer and the person who can see the schedule are two people."* | Phone | `P3B1-S30-A09` |
| 3 | Coordinator | The night's decisions: *"Ken's decisions, the customer conversation and the reason a night crew was or was not called live nowhere."* | Phone + memory | `P3B1-S19-A09` |
| 4 | Coordinator | After-hours intake: *"If the wizard is not phone-usable, the on-call coordinator writes it on paper and enters it at 07:00, and the emergency has no record for nine hours."* | Paper | `P3B1-S19-A01` |
| 5 | Coordinator | The Taylor/Ventana PM split: *"She maintains the split in a spreadsheet."* | Spreadsheet | `P3B1-S23-A09` |
| 6 | Coordinator | PM due-dates: *"Without a PM interval on equipment, 'due' is a spreadsheet maintained outside EOS."* | Spreadsheet | `P3B1-S23-A01` |
| 7 | Coordinator | Customer-specific handling: *"She explains it verbally every time."* | Verbal | `P3B1-S20-A09` |
| 8 | Coordinator | Follow-up commitments: *"If nobody remembers, the customer phones in week three."* | Memory | `P3B1-S20-A04` |
| 9 | Dispatcher | **The entire shift handoff.** *"Every in-flight decision — who was phoned, which customer was promised what — is verbal."* | Verbal | `P3B1-S22-A08` |
| 10 | Dispatcher | *"The dispatcher's working memory of the morning is gone."* | Memory | `P3B1-S18-A07` |
| 11 | Dispatcher | Special handling: *"Dale remembers, or he does not."* | Memory | `P3B1-S20-A06` |
| 12 | Dispatcher | Mid-day reassignment: *"Dale tells Javier verbally and the record stays on Curtis."* | Verbal | `P3B1-S21-A02` |
| 13 | Dispatcher | Sick cover: *"In practice the dispatcher leaves them and phones the customers."* | Phone | `P3B1-S21-A09` |
| 14 | Dispatcher | Technician ids sourced from *"a stale technician id from a spreadsheet."* | Spreadsheet | `P3B1-S05-A08` |
| 15 | Technician | **Labour time — the input billing needs most.** *"Labour time is therefore captured outside EOS, on paper or in payroll, and the Work Order carries none."* | Paper / payroll | `P3B1-S12-A04` |
| 16 | Technician | Route sequence: *"Curtis sequences by memory and local knowledge, which is usually better than anything the data supports."* | Memory | `P3B1-S10-A10` |
| 17 | Technician | Job content on an undocumented handover: *"Curtis reads it to him over the phone."* — *"He works blind, with no access to the parts plan, the note or the customer detail."* | Phone | `P3B1-S21-A03` |
| 18 | Technician | Serial corrections: *"every field-discovered data error depends on"* an out-of-product path | Phone / verbal | `P3B1-S31-A05` |
| 19 | Technician | Damage/warranty claims: *"The claim is filed outside EOS."* | — | `P3B1-S14-A07` |
| 20 | Technician | Finding staged parts: *"Curt's recovery is a phone call at 06:05, which is the workflow this feature was supposed to remove."* | Phone | `S16-A04` |
| 21 | Technician | Truck-to-truck part transfer: *"The recovery is a phone call between two technicians, which is how this is actually solved today."* | Phone | `S10-A03` |
| 22 | Technician | Restock intent: *"If the request surface does not exist, the handoff happens by phone and the whole story below runs with no record of intent."* | Phone | `S23-A02` |
| 23 | Apprentice | Compliance: *"The compliance exposure is real and entirely outside the system."* **No outside channel holds it either — see §5.2** | **none** | `P3B1-S17-A06` |
| 24 | Parts / Receiving | Receipt exceptions: *"Ray's recovery is a phone call today."* | Phone | `S01-A08` |
| 25 | Parts / Receiving | Request closeout: *"Ray emails Dwayne. That is the current integration."* | **Email** | `S08-A05` |
| 26 | Stocker | Bin location: *"Luis's real recovery is to stow warehouse-direct and write the shelf on paper."* | Paper | `S15-A10` |
| 27 | Stocker | Hand-keyed codes: *"the only evidence of intent is the operator's memory."* | Memory | `S19-A09` |
| 28 | Stocker | A lost count session: *"If the queue was in memory, there is no recovery — only a re-count, and nobody will know a re-count is needed."* | Memory | `S21-A06` |
| 29 | Parts Associate | Staging handoff: *"This activity FAILS if a put-away session cannot carry the work order it is staging for, because then the handoff to Curt is verbal."* | Verbal | `S16-A03` |
| 30 | Parts Manager | Missing kit items: *"the recovery is a re-pull with no record of who took them."* | — | `S16-A03` |
| 31 | Inventory Control | Duplicate part numbers: *"The real-world recovery is a spreadsheet and a phone call. That is the gap."* | Spreadsheet + phone | `S14-A08` |
| 32 | Inventory Control | Transfer ageing: *"the recovery is a manual ledger export and a spreadsheet, which is what will happen."* | Spreadsheet | `S25-A02` |
| 33 | Inventory Control | Second review: *"or the recovery is a Slack message."* | Chat | `S27-A05` |
| 34 | Billing | Empty completions: *"The technician is phoned and re-enters the information verbally."* | Phone + verbal | `P3B1-S16-A06` |
| 35 | Billing | After-hours labour: *"She reconstructs it from the technician's paper timesheet."* | Paper | `P3B1-S19-A10` |
| 36 | Billing | One fault, two Work Orders: *"She merges them by hand in the billing system."* | External system | `P3B1-S20-A10` |
| 37 | Coordinator/Billing | Equipment provenance: *"She checks the sales paperwork."* | Paper | `P3B1-S30-A05` |
| 38 | Controller | Attestation: *"Brenda's recovery is to attest from engineering's deployment history, outside the system."* | External | `S18-A10` |
| 39 | Controller | **The published position.** *"no surface produces any of that, so the figure will be assembled by hand and its provenance will live in someone's spreadsheet."* | Spreadsheet | `S32-A10` |
| 40 | Service Manager | Recall completion: *"The recall's completion lives in a document outside EOS, which is where the evidence will be looked for years later."* | Document | `P3B1-S31-A10` |
| 41 | System Admin | Warehouse creation: *"Sam's real recovery is to ask an engineer to run a script."* | Engineer | `S18-A01` |
| 42 | Administrator | Employee creation: *"Employee create is a Node script… No callable, no screen, no capability row."* | CLI | archaeology §8.3.6 |
| 43 | Sales | Pricing: *"Every price on every agreement is typed by hand, with no history, no list, no schedule, no template and no approval threshold."* | Memory / hand | `WF-SLS-005` |
| 44 | Owner | Consolidation: *"Elimination is explicitly outside EOS and belongs to an external authority."* | External | `P3B3-FIN-055` |

**Pattern.** The out-of-EOS channel is almost never a convenience. In 44 of 44 instances it is a
**recovery path** — the thing the person does when the product cannot express the act. The four
heaviest concentrations are: **the customer promise** (coordinator, phone), **the shift handoff**
(dispatcher, verbal), **labour time** (technician, paper), and **the published financial position**
(controller, spreadsheet). Each is load-bearing for the business and none is in EOS.

---

## 5. What can get lost between two people

Handoff evidence: 53 `HANDOFF`-tagged activities (P3-B1 34, P3-B2 19, **P3-B3 0 — unmeasurable**) and
90 rows flagged `role_handoff_unclear` (P3-B1 56, P3-B2 34; **P3-B3 unmeasurable**).

| From → To | What is handed | What gets lost | Mechanism | Evidence |
|---|---|---|---|---|
| **Coordinator → Coordinator** (shift) | Undecided inbound rows | Whether anyone has looked at a row. *"With no owner field, the afternoon coordinator cannot tell a row nobody has looked at from one someone is actively chasing."* | No owner field, no in-progress state | `P3B1-S01-A10`, `P3B1-S18-A06` |
| **Coordinator → Dispatcher** | A Work Order marked ready | Completeness. *"Marking ready with no equipment and no address is possible — readiness is not validated against completeness."* | No validation gate | `P3B1-S02-A07` |
| **Coordinator → Customer** | A promised time | **The promise itself.** *"The promise lives outside EOS."* If nobody calls, *"a technician arrives at a locked convention centre."* | Nothing records the promise | `P3B1-S07-A09` |
| **Dispatcher → Dispatcher** (shift) | The board | **Every in-flight decision.** *"who was phoned, which customer was promised what — is verbal."* *"A dispatcher who reloads the page loses the feed; a dispatcher taking over at shift change never had one."* | No change feed, no persisted decision log | `P3B1-S22-A08`, `P3B1-S07-A10` |
| **Dispatcher → Technician** | A dispatched job | The job itself, if ids mismatch: *"A job dispatched to an id that does not match the technician's own technicianId is invisible to everyone except admins and dispatchers."* | Two-hop identity join | `P3B1-S33-A07`, `P3B1-S09` |
| **Dispatcher → Technician** | A cancellation | The cancellation, if he is offline: *"If the technician arrives before the cancellation syncs he works a cancelled Work Order, and CANCELLED is terminal with no way back."* | Async sync, terminal state | `P3B1-S07-A05` |
| **Technician → Technician** | An in-progress job | **Everything.** *"the transfer EOS cannot express."* *"Dale tells Javier verbally and the record stays on Curtis."* Javier's labour is unattributed; *"Curtis's productivity is overstated. The technician performance scorecard's productivity figure is built on exactly this data."* Cancel-and-recreate *"loses the arrivedAt, workStartedAt and three hours of execution data."* | No transfer edge; one `assignedTechId`; no multi-technician concept | `P3B1-S21-A01…A07` |
| **Technician → Office** | Completed work | Notes and parts. *"Completing with no note and no parts is permitted; nothing validates that anything was recorded."* Then: *"The technician is phoned and re-enters the information verbally."* | No completion content validation | `P3B1-S16-A01`, `P3B1-S16-A06` |
| **Technician → Office** (offline) | Pending intents | Visibility. *"Nobody in the office can see this queue. A dispatcher wondering why a job has not completed has no view of the technician's pending intents."* And *"A technician who ignores a refused card leaves work permanently unrecorded."* | Client-side queue | `P3B1-S15-A09`, `P3B1-S15-A04` |
| **Technician → Billing** | Labour hours | **All of them.** Captured *"outside EOS, on paper or in payroll."* `workOrder.labor.record` is `active:false` in every declared environment **[EXECUTED]** | Capability inactive everywhere | `P3B1-S12-A04`, `WF-SVC-009` |
| **Billing → Invoice** | A closed Work Order | The billing event. *"Nothing downstream is triggered by Close… no invoice, no customer notification."* Billing Queue *"connected to neither end."* | Unwired bridge | `P3B1-S16-A05`, archaeology §8.3.9 |
| **Dispatcher → Parts Manager** | An approved reorder request | Where it went. *"If it lands nowhere visible it simply waits."* Approval is irreversible: *"An approval cannot be undone."* | No routing visibility | `S03-A02`, `S03-A10` |
| **Parts Manager → Parts Associate** | An assigned request | Recoverability. *"Assigning to the wrong person is recoverable only by re-assigning — and there is no branch from ASSIGNED_TO_PARTS_ASSOCIATE back to READY_FOR_PARTS_MANAGER."* | No reverse edge | `S04-A01` |
| **Associate → Associate** (absence) | A request mid-purchase | **The cut-off.** *"the single most likely real-world friction in the whole procurement chain, and there is NO reassignment branch in Rules to resolve it."* → *"The order misses the cut-off."* | No reassignment branch | `S04-A04` |
| **Receiving → Purchasing** | A received delivery | The closeout. *"The warehouse receipts the goods but nobody closes the request… Ray emails Dwayne. That is the current integration."* → *"The ledger and the purchasing queue tell different stories about the same cartons."* | Email as integration | `S08-A05` |
| **Operator → Operator** (same session) | A scanning session | Session continuity. *"If Dwayne cannot write into Ray's session, he will open a second one… and the receipt ends up with two sessions. Both failure modes trace to the same missing handover concept."* Also *"the count is split across two sessions with no relationship between them."* | No session handover concept | `S20-A08`, `S21-A07` |
| **Operator → Operator** (shift) | A cycle count | **Four physically counted cartons.** *"NOT DESIRED: queue held only in memory, in which case four physically counted cartons vanish with no trace anywhere."* | In-memory queue | `S21-A06`, `S21-A08` |
| **Parts Associate → Technician** | A staged kit | The reservation. *"Availability does not move, so the Thursday kit is still promisable to a Wednesday emergency call."* If parts are gone, *"a re-pull with no record of who took them. Placements record stowing, not removal."* | Staging reserves nothing | `S16-A03` |
| **Warehouse → Technician** (truck) | Custody of a unit | Location. *"If the load records state but not location, the unit reads as LOADED at the warehouse and the next warehouse count expects it."* | State without location | `S30-A02` |
| **Inventory → Equipment** (install) | A machine | Single custody. *"This is the handoff from inventory custody to equipment custody. Two authorities, one machine."* If it half-commits, *"the machine is both stock and installed equipment simultaneously."* | Two authorities | `S30-A04` |
| **Taylor → Ventana** | Stock across the company line | Attribution, permanently. *"the belts sit in Ventana's stockroom, fitted on Thursday, owned by Taylor on paper forever."* And *"the append-only rows cannot be reattributed."* | Append-only + no intercompany object | `S24-A06`, `S30-A08` |
| **Admin → Operator** | A granted role | **The grant.** *"Nothing changes for Luis. The handoff Sam thinks he completed did not happen."* | Inactive capability, silent | `S15-A03` |
| **Analyst → Second reviewer** | A variance to approve | The reviewer. *"Tessa's recovery is to find a second reviewer… or the recovery is a Slack message."* The second reviewer *"must be told the line was disposed of by the first, with the first reviewer's name and reason."* | No reviewer routing | `S27-A05`, `S28-A04` |
| **Service → Sales** | A replacement conversation | **The opportunity.** *"The Service → Sales direction does not exist in any form. Every replacement-machine conversation that starts as a repair call leaves EOS at the Work Order."* | No reverse integration | `WF-XD-004` |
| **Sales → Fulfilment** | A booked Sales Order | The fulfilment right. *"held by `owner`, `admin` and `dispatcher` and by NO governed business role"* **[EXECUTED]** | Grant gap surviving activation | `WF-SLS-003` |
| **Anyone → Successor** (employee disabled) | Their open work | All of it. *"Disabling the principal silently strands every Work Order assigned to them: Accept, Travel, Arrive, WorkStart and Complete all carry requiresOwnAssignment: true, so nobody else can advance them."* | `requiresOwnAssignment` + no reassignment | `WF-XD-006` |

### 5.1 The accountability silence

The brief asks whether a handoff that changes the assignee also changes accountability. **The corpus
is almost entirely silent, and the silence is structured:**

| Concept | Represented in the corpus | Note |
|---|---|---|
| ASSIGNEE / EXECUTOR | Yes — `assignedTechId`, request assignment, session ownership | The only handoff concept EOS models |
| RECORD OWNER | Partially — `Employee (owner)` in `objects_touched`; 166 rows flagged `ownership_unclear` | `ownership_unclear` is the corpus's **second most common** friction flag |
| ACCOUNTABLE PERSON | **No** | No object distinct from assignee. `S20-A08`: *"The cross-object effect is on accountability, which is exactly what a discrepancy investigation runs on"* — and nothing records it |
| ESCALATION OWNER | **Named only as prose in `DESIRED` rows** | `S01-A09` *"Escalation target must be stated"*; `S26-A02` names Sam Ortega. No field holds it |
| MANAGER | **Yes in the schema, absent from the corpus** | **Corrected by EMP-ROLE:** `managerEmployeeId` exists — but not in `employee-foundation.md`; it arrives via `docs/assessments/administration-users-consolidation.md:204-209`, alongside `jobTitle`. Two problems remain. (a) **No corpus activity uses it**: not one of the 1,010 activities reads or writes a manager relation, so every escalation in §2 is prose. (b) **EMP-ROLE reports MANAGER and JOB ROLE are conflated in opposite directions by two subsystems at the same baseline — two answers to "who manages this person" exist and nothing reconciles them** |
| DOMAIN STEWARD | **Absent and load-bearing** | Service quality metrics are *"assigned to a Service Operations domain authority that does not exist"* (archaeology §7.11) |
| OPERATING COMPANY | Yes in B1/B2 (Taylor 290 / Ventana 40 in B1), **absent in all 350 P3-B3 rows**; 81 rows flag `operating_company_attribution_unclear` | **No Work Order carries one, and DECISIONS #143 forbids inferring it** (`WF-SVC-016`) |
| JOB ROLE vs SECURITY ROLE | **Conflated throughout** | The corpus uses one `role`/`actor_role` field for both. `WF-SLS-003` is precisely a case where they diverge: a capability held by security roles and by *"NO governed business role"*. **EMP-ROLE's upstream cause: there is no job-role vocabulary at all** — five disjoint vocabularies with no mapping, `jobTitle` free text, and `operationalRoles[]` carrying 8 values of which 5 have no consumer anywhere. The security-Role set is **48** (45 governed + `admin`/`dispatcher`/`technician`), and **26 of the 45 governed Roles have no corpus activity** |

**Finding for the accountability lane:** EOS models the *assignee* and nothing else. Every other role
concept in the brief's list is either absent, prose-only, or fused into the assignee field. A handoff
therefore always moves execution and **never** moves accountability, because there is no accountability
object to move.

### 5.2 Proficiency is unmodelled — and the corpus records exactly what that costs

EMP-ROLE reports proficiency, skill and certification wholly unmodelled. **Re-derived here from
`P3B1-S17-A06`, and it is worse than a missing field:**

| Field | Value at `64008d5a` |
|---|---|
| Title | *"Complete a job that requires a certification he does not hold"* |
| Role / persona | `apprentice_technician` / Wes Tanner |
| Action | *"Complete it."* |
| Expected state transition | *"WORK_IN_PROGRESS -> COMPLETED. **Succeeds.**"* |
| Expected UI result | ***"Nothing warns."*** |
| Exception / recovery | *"The compliance exposure is real and **entirely outside the system**."* |
| Cross-object effect | *"**Neither the recommendation engine nor the scheduler nor the transition engine reads any skill or certification data.** The recommendation engine's own comment notes technicians have name/phone/status only."* |

**Three separate subsystems that should gate on competence read none of it.** The dispatcher's
recommendation engine cannot avoid assigning an uncertified technician, the scheduler cannot refuse the
placement, and the transition engine completes the job silently. This is a fourth load-bearing item for
§4's list of work held outside EOS — **compliance** — and unlike the phone, the spreadsheet and the
paper timesheet, it has **no outside channel at all**: no one is holding it anywhere. **[AUTHORED]**

---

## 6. Interruption and after-hours load, by job

Coverage-tag derived; **P3-B3's 350 rows contribute nothing**. Note: the corpus has **no literal
`INTERRUPTION` category** — interruption is expressed as `BACK_BUTTON_ABANDONED_FLOW` (B1),
`BACK_BUTTON` + `ABANDONED_FLOW` (B2) and `NETWORK_INTERRUPTION`.

| Real job | n | NETWORK_INTERRUPTION | BACK_BUTTON / ABANDONED | AFTER_HOURS | END_OF_DAY | END_OF_MONTH | PERMISSION_DENIAL | CROSS_COMPANY |
|---|---|---|---|---|---|---|---|---|
| Parts / Warehouse | 186 | 8 | 9 | 6 | 15 | 3 | 19 | 19 |
| Technician | 143 | **15** | 2 | 5 | 5 | 0 | 19 | 11 |
| Ops / Management | 136 | 0 | 0 | 0 | 4 | **28** | 5 | 7 |
| Administrator | 111 | 0 | 3 | 3 | 0 | 0 | 6 | 1 |
| Dispatcher | 97 | 1 | 2 | 1 | 7 | 0 | 6 | 9 |
| **Sales** | **97** | **—** | **—** | **—** | **—** | **—** | **—** | **—** |
| Finance | 87 | 0 | 0 | 3 | 0 | 17 | 1 | 5 |
| Coordinator | 73 | 0 | 4 | 6 | 3 | 0 | 8 | 13 |
| Billing / Office | 36 | 0 | 1 | 1 | 2 | 11 | 1 | 3 |
| Inventory Control | 34 | 0 | 1 | 0 | 5 | 4 | 2 | 2 |
| Purchasing | 10 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |

**Reading.** Interruption is a **field** phenomenon (technician 15 of 24 network interruptions) and
end-of-month is a **management and finance** phenomenon (Ops 28, Finance 17, Billing 11). The two
populations need opposite things from EOS: the field needs work to survive a dropped connection; the
back office needs a number to survive an audit. The **Sales row is empty because it cannot be
measured**, not because sales work is uninterrupted.

---

## 7. Where the corpus and the archaeology disagree

Recorded, both sides, per the lane standard.

| Subject | Corpus says | Archaeology says | Disposition |
|---|---|---|---|
| Blocked-time overlap | `P3B1-S05-A02` records `behaviourClaim: DESIRED` — *"ACCEPTED — overlapping blocked-time facts are legitimate and unavailable time is their UNION"* (an Owner ruling **postdating** the shipped behaviour) | §4.1 *"Tonight's Owner ruling overturns shipped code — and the shipped fix was applied in the wrong place"* | **Both recorded.** The corpus captures the intended end state; the archaeology captures that the code disagrees and was patched in the wrong layer. `P3B1-S05-A10` adds: *"removing the overlap refusal (as the Owner ruling requires) would expose"* a further defect |
| Technician truck handoff | `S30-A02`/`S23-A07` treat truck receipt as workable | Pt 12.13: *"A technician cannot accept a truck handoff without over-granting — resolved by creating `inventoryTransferReceiver`… but the design record still describes it as open in three places"* | **Both recorded.** Resolved in code, stale in three design documents |
| Device coverage tags | P3-B1 `counts.byCoverageCategory` now reports DESKTOP 212 / MOBILE 118 | The P3-B1 `corrections` block records that the brief which fed it also named `S17-A01`, `S24-A04`, `S24-A06` as needing the same fix, and that **those are P3-B2 rows and remain UNFIXED** | **Recorded.** P3-B2's un-namespaced ids were mistaken for P3-B1 ids by an upstream brief; three P3-B2 rows are still inconsistent |
| Reorder gating by legacy role string | Passed-on claim: the contextual assistant bypassed the capability catalog | §8.3: **measured false for the assistant** (`assistantStarters.ts:57-58` gates on capability ids), **true for the UI control** (`RequestReorderControl.jsx:65-67` gates on `role === ROLES.ADMIN` etc.). *"The assistant's real defect is different and larger: it is wired to nothing."* | **Archaeology is correct and sharper.** Cited here as the model for how to state such a claim |

---

## 8. MISSING INPUT

The Owner's separate **employee-design conversation** is the source for how work really flows. **It is
not available to this run.** The following are marked MISSING INPUT and are **not** reconstructed or
guessed anywhere above.

### 8.1 The list

| # | Question only the employee-design conversation can answer |
|---|---|
| 1 | **The real headcount and the real job titles.** 40 corpus role labels reduce to ~10 jobs by this lane's reading, but which labels are one person at Taylor is unknown. Whether `service_coordinator` and `after_hours_coordinator` are the same person on a rota is MISSING INPUT |
| 2 | **Who actually starts at 07:30**, and whether the corpus's authored times (06:40 coordinator, 06:50 technician, 07:55 dispatcher, 22:40 after-hours) match real shifts |
| 3 | **Which of the 44 out-of-EOS instances in §4 are tolerated and which are pain.** The corpus labels them gaps; whether the business wants them in EOS is the Owner's call |
| 4 | **The real escalation tree.** The corpus names an escalation target in only a handful of `DESIRED` rows. Who a coordinator escalates to at 17:30, and who covers the dispatcher, is MISSING INPUT |
| 5 | **Whether accountability moves with an assignee.** §5.1 shows EOS cannot express the distinction; which way the business intends it is MISSING INPUT |
| 6 | **Who the domain stewards are.** The absent *"Service Operations domain authority"* (archaeology §7.11) is a real person or it is nobody |
| 7 | **Ventana's real operating shape.** P3-B1 gives Ventana 40 of 330 activities; P3-B3 cannot express operating company at all. Whether Ventana runs the same jobs is MISSING INPUT |
| 8 | **Whether AP genuinely stays outside EOS.** `WF-FIN-010` *"Pay a supplier"* is NO_IMPLEMENTATION and the registry states: *"Whether that is deliberate (AP stays in the accounting system of record) is an open Owner question, not a recorded decision"* |
| 9 | **Which system is authority of record for financial figures** (#145) — blocks `WF-FIN-011` at the root |
| 10 | **Approval thresholds and second approvers** for credits, write-offs and refunds (`P3B3-FIN-069`) — machinery built, no policy values |
| 11 | **Whether a technician should read equipment at the site they are standing on.** `WF-EQP-004` is CANNOT_START by a **deliberate, documented** exclusion — *"a decision to revisit, not a bug to fix"* |
| 12 | **What a multi-technician job should look like.** *"Two technicians on one job — routine for an install or a heavy lift — is unrepresentable"* (`P3B1-S21-A07`) |
| 13 | **The close cadence** — *"an unset Owner policy value"* (`WF-FIN-007`) |
| 14 | **How the 106 owner questions in the registry are prioritised** against employee pain |
| 15 | **Which of the two conflicting manager relations is correct.** EMP-ROLE reports MANAGER and JOB ROLE conflated in opposite directions by two subsystems at the same baseline, with nothing reconciling them. Every escalation path in §2 depends on the answer |
| 16 | **What certification and proficiency should gate.** §5.2 shows three subsystems read none of it and *"Nothing warns."* Which jobs require which competence, and whether EOS should refuse or merely warn, is the Owner's call |
| 17 | **Where `STRATEGIC_ACCOUNTS` work sits.** EMP-ROLE establishes three ratified sales channels, not two, and records the Owner ruling as silent on the third. Which real jobs serve it is MISSING INPUT |
| 18 | **Which canonical job-role vocabulary should win.** EMP-ROLE finds five disjoint vocabularies with no mapping, `jobTitle` free text, and 5 of 8 `operationalRoles[]` values with no consumer. This lane's ~10 real jobs (§1) are a proposal, not a ratified vocabulary |

---

## 9. UNPROVEN

Claims this lane relies on or reports that are **not** established by execution at this baseline.

| # | UNPROVEN |
|---|---|
| 1 | **Every behaviour in P3-B1 and P3-B2 — all 660 activities.** Both libraries are 100% `NOT_RUN`. P3-B1's own statement: *"NOTHING IN THIS LIBRARY HAS BEEN EXECUTED… an unexecuted activity may never be [labelled PASS]"* |
| 2 | **All 308 unexecuted P3-B3 rows** (`IMPLEMENTED_UNEXECUTED` 141, `PARTIAL` 68, `BLOCKED` 64, `NOT_SUPPORTED` 26, `DESIGNED_ONLY` 9) |
| 3 | **22 of the 118 output lines on the 42 executed P3-B3 rows are `INFERRED`** — *"no committed transcript or script emits or entails the line"* — and 6 more are `TRACED`, not executed |
| 4 | **Every §4 out-of-EOS claim is an authored narrative assertion**, not an observed practice. *"Ray's recovery is a phone call today"* is what an author believed, not a recorded observation. This is the single largest UNPROVEN in the lane, and it bears directly on its highest-value finding |
| 5 | **Every §5 handoff-loss claim**, for the same reason |
| 6 | **The real-job unification in §1.** Collapsing 40 labels to ~10 jobs is this lane's inference from role-name and activity-content similarity. No artifact in the corpus asserts it |
| 7 | **The module-crossing counts in §1.1** rest on the registry's `domain` and `actors` fields, which are `TRACED` (52 of 86 workflows) or `EXECUTED` (34). Domain assignment is the registry author's classification |
| 8 | **The §6 interruption table is 65% coverage at best** — 660 of 1,010 rows. Sales, CRM, finance, administration and management contribute nothing |
| 9 | **Whether `firestore.rules` blocks for `technician_working_availability` / `technician_blocked_time` are live in production.** No production contact was made by any lane (archaeology §8) |
| 10 | **Which technician composition real technicians actually see** (`TechnicianShell` vs `FieldMode`) — archaeology §8 |
| 11 | **Parts consumption on a cancelled Work Order** — *"whether it reverses, stands, or is orphaned — is UNPROVEN by this lane and is worth executing"* (`P3B1-S21-A05`). This sits directly on the cancel-and-recreate path that is the **only** available technician handoff |
| 12 | **Whether anything escalates a refused sync intent** (`P3B1-S15-A05`) |
| 13 | **Every emulator-gated suite** named in the scheduling, equipment and inventory documents. Firestore-emulator suites hang in this environment (port 8080 occupied), so none was run by any lane |
| 14 | **The three P3-B2 rows with contradictory device coverage tags** (`S17-A01`, `S24-A04`, `S24-A06`) remain unfixed and were not fixed here — P3-B2 is outside this lane's write surface |

---

## 10. Errors found in this lane's own brief

| # | Brief said | Correct at `64008d5a` | Basis |
|---|---|---|---|
| 1 | *"**34** of P3-B3's recorded output lines are INFERRED"* | **22** are INFERRED. 118 output lines over 42 rows: EXECUTED 90, INFERRED 22, TRACED 6. 28 lines were *downgraded* (22 INFERRED + 6 TRACED) — 34 matches nothing in the data | Re-derived from `execution.output_evidence_tiers` across all six P3-B3 files; agrees with each file's own `corrections.fix1_evidenceTiers` |
| 2 | *"`coverage` (categories incl. `HANDOFF`, `INTERRUPTION`-like, `RECOVERY`, `ESCALATION`-adjacent)"* | `HANDOFF` and `RECOVERY` are literal categories. **There is no `INTERRUPTION` category and no `ESCALATION` category in either vocabulary.** Interruption is `BACK_BUTTON_ABANDONED_FLOW` (B1) / `BACK_BUTTON` + `ABANDONED_FLOW` (B2) plus `NETWORK_INTERRUPTION`; escalation appears only as free prose | P3-B1 `coverageCategories` (20 values) and P3-B2 `vocabulary.coverage` (22 values), enumerated in full |
| 3 | *"`/home/rudy2/.local/share/eos-worktrees/p3b3-act-sales/docs/activities/p3b3-*.json` — 350; fields `trigger`, `narrative`, `objects_touched`, `status`, `blocking_mechanism`" | The glob matches **six** files totalling 350 records, one of which (`p3b3-adversarial-activities.json`, 40 records) the brief does not signal. **`blocking_mechanism` is not a field on P3-B3 activity records** — the record fields are `id`, `title`, `actor_role`, `trigger`, `narrative`, `objects_touched`, `authority_path`, `status`. `blocking_mechanism` is a field of the **workflow registry**, and it is named in P3-B3 only inside the `corrections` prose | Enumerated `activities[0].keys()` in all six files |
| 4 | Implied by *"the three archaeology docs… record **missing-workflow discoveries**"* | Correct, and worth stating precisely: **39 discoveries** total — service 12 (§7), inventory 15 (Part 12), sales/finance/admin 12 (§8.3). The brief does not give the count | Counted in each document |
| 5 | *"`p3b1-…/service-technician.json` — 330; fields include `trigger`"* | **There is no `trigger` field in P3-B1 or P3-B2.** P3-B1 carries the trigger implicitly in `storyTitle` (e.g. *"Monday 06:40 — the weekend's email pile lands in the inbound queue"*) plus `startingRecordsAndState`; only P3-B3 has a literal `trigger` field | Enumerated `activities[0].keys()` for all three libraries |

**Not an error, but a correction the brief inherits:** the brief's framing that the corpus is
*"unusually well suited to this lane"* holds for P3-B1 and P3-B2 and **fails for P3-B3**, which
carries no coverage tags, no device, no friction scores and no operating company — 350 rows, 34.7% of
the corpus, and the entire commercial and back-office half of the business. See §0.2.

---

## 11. Lane conclusions

1. **EOS's role labels fragment real jobs.** 40 labels, ~10 jobs. Four jobs appear in all three
   libraries under three different names, and nothing joins those views. **[This lane's inference — §9.6]**
2. **The two jobs that cross the most EOS domains are the technician (8) and the operations manager
   (8)** — opposite ends of the company, neither with a surface that spans their work. The Controller
   carries the most workflows of any actor (20) and can finish 15% of them. **[TRACED]**
3. **Two jobs have no finishable workflow at all: General Manager (0 of 9) and Service Billing Admin
   (0 of 5).** The person accountable for the numbers and the person who turns work into money can
   complete nothing end to end. **[TRACED]**
4. **44 named instances of work held outside EOS**, and in every one the outside channel is a
   *recovery path*, not a preference. Four are load-bearing for the business: the customer promise
   (phone), the dispatcher shift handoff (verbal), labour time (paper), and the published financial
   position (spreadsheet). **[AUTHORED — §9.4]**
5. **The technician-to-technician handoff is the corpus's sharpest single loss.** `P3B1-S21` is titled
   *"the transfer EOS cannot express."* The only representable options destroy execution data, and the
   real-world path — *"Dale tells Javier verbally and the record stays on Curtis"* — corrupts the very
   scorecard built on that data.
6. **EOS models the assignee and no other role concept.** Accountable person, escalation owner,
   manager and domain steward are absent, prose-only, or fused into the assignee. A handoff therefore
   cannot move accountability, because there is no accountability object. `ownership_unclear` is the
   corpus's second most common friction flag (166 of 660 measurable rows). **This is the finding for
   the accountability lane.**
7. **Interruption is a field phenomenon and month-end is a back-office one**, and the two populations
   need opposite guarantees: work that survives a dropped connection, versus a number that survives
   an audit.
8. **Nothing escalates by content.** An emergency email arriving at 18:30 waits until 06:40
   regardless of what it says (`P3B1-S22-A05`), and after 17:30 the coordinator who takes an emergency
   call cannot dispatch anyone (`P3B1-S08-A07`). The standing workaround — *"every on-call coordinator
   is permanently a dispatcher"* — is described in the corpus as *"a standing over-grant created by an
   after-hours gap"* (`P3B1-S19-A02`).
9. **The evidence is 96% unexecuted** (968 of 1,010) and the lane's highest-value section (§4) rests
   entirely on authored narrative. Treat §4 and §5 as a **design hypothesis to test with the Owner**,
   not as observed practice.
10. **The measurement floor is 660, not 1,010** — and after EMP-ROLE's correction it is worse: 660 of
    1,010 rows **and** only 19 of 45 governed Roles carry any corpus activity. Any statement about
    handoffs, friction, interruption, device or operating company covers service, inventory, warehouse
    and purchasing only.
11. **The fragmentation in §1 has a named upstream cause.** EMP-ROLE finds **no job-role vocabulary
    exists** — five disjoint vocabularies with no mapping, `jobTitle` free text, 5 of 8
    `operationalRoles[]` values with no consumer. The 40 corpus role labels are not a naming accident;
    there was no canonical vocabulary for them to use. **This lane's ~10 real jobs are a proposal for
    that vocabulary, and they need Owner ratification (§8.1 #18), not adoption by default.**
12. **Competence is the one item in §4 with no outside channel.** The customer promise lives on the
    phone, labour on paper, the financial position in a spreadsheet — each held by somebody. Skill and
    certification are held by **nobody**: three subsystems read none of it and the job completes with
    *"Nothing warns."* (§5.2)

---

*Lane EMP-WORK. Evidence-only. No production contact, no deploys, no database or Firestore access, no
implementation. Only this file written. Not pushed; no PR.*
