---
artifact_type: operating-model-canonical
lane: EMP-OWN-SYNTHESIZER
baseline: 64008d5ae0bdd9532909671b15a91122400accf1
date: 2026-09-13
implementation_status: NOT AUTHORIZED
---

# EMPLOYEE WORK MATRIX

**OBSERVED AT: 64008d5a.** Integrated from **EMP-WORK** (primary), **EMP-EXPERIENCE** §1/§3/§4/§5,
**EMP-INFORMATION** §4/§7/§8, **EMP-PERFORMANCE** §7.

> **THE ORGANISING RULE, and it is measured rather than asserted: do not force real work into current
> module boundaries.** Where one real job crosses Service, Customer, Equipment, Inventory, Purchasing
> and Financials, **that crossing is the finding, not something to smooth away.**

**No UI, screen, layout, composition or component is specified here.** EMP-EXPERIENCE specified none
and neither does this. Where a row says *"the queue must distinguish X from Y"* it is stating an
**information requirement**, not a component.

---

## 0. EVIDENCE BASE AND ITS HARD LIMITS

| Source | Records | Shape |
|---|---:|---|
| **P3-B1** Day-in-Life, service | 330 | 33 stories · 12 personas · 8 role labels · `coverageCategories` (20 values) · `frictionScore` (11 keys, camelCase) · `deviceContext` (DESKTOP/MOBILE) · `helpOpportunity` · `aiOpportunityClassification` (6 values) |
| **P3-B2** Day-in-Life, inventory/warehouse/purchasing | 330 | 33 stories · 13–14 role labels · `coverage` (22–24 values incl. split RETRY/IDEMPOTENCY) · `scores` (11 keys, snake_case) · `device` (DESKTOP/MOBILE/**HANDHELD_SCANNER**) · `help_info_opportunity` · `ai_opportunity` (5 **different** values) · **128 rows carrying an explicit `DESIRED:` information requirement** |
| **P3-B3** sales/CRM/finance/admin/management/adversarial (**six files**) | 350 | `id`, `title`, `actor_role`, `trigger`, `narrative`, `objects_touched`, `authority_path`, `status` — **and nothing else** |
| Archaeology ×3 (service · inventory · sales) | 1,268 / 1,852 / 1,032 lines | **39 missing-workflow discoveries** total (12 / 15 / 12) |
| Workflow registry | 86 workflows | `actors`, `trigger`, `steps`, `state`, `break_point`, `blocking_mechanism`, **106 owner questions** |

### 0.1 THE STRUCTURAL BLIND SPOT — state the denominator, every time

**P3-B3 (350 rows, 34.7% of the corpus) carries NO coverage tags, NO device context, NO friction
scores and NO operating-company field.** Its own metadata states it: *"ABSENT. No P3-B3 record carries
an operating-company field of any kind, so Ventana coverage is structurally unmeasurable for this
library."*

| Dimension | Rows measurable | Rows structurally UNMEASURABLE |
|---|---:|---:|
| `coverage` categories (HANDOFF, EXCEPTION, RECOVERY, AFTER_HOURS…) | 660 | **350** |
| Friction scores (11 keys incl. `role_handoff_unclear`, `ownership_unclear`) | 660 | **350** |
| Device context (DESKTOP / MOBILE / HANDHELD_SCANNER) | 660 | **350** |
| Operating company (Taylor / Ventana) | 660 | **350** |

> **CONSEQUENCE: every friction, handoff, device, after-hours and operating-company count in this
> document describes SERVICE, INVENTORY, WAREHOUSE AND PURCHASING WORK ONLY. Sales, CRM, finance,
> administration and management — THE WHOLE COMMERCIAL AND BACK-OFFICE HALF OF THE BUSINESS —
> contributes ZERO handoff evidence and ZERO friction evidence. SILENCE THERE IS A MEASUREMENT GAP, NOT
> A FINDING OF SMOOTH WORK.**
>
> **And the coincidence is not a coincidence:** the same population is the one the master brief reports
> as **commercially dead in production** — *"the roles whose experience is least evidenced are the roles
> whose capability set is most switched off. It is the same absence measured twice."* (EMP-EXPERIENCE
> §0.3)

### 0.2 THE STANDING EVIDENCE LABEL

**Every P3-B1 and P3-B2 activity is an AUTHORED SCENARIO: design evidence that someone intended the
work to go this way, NOT proof that the work happens this way.** P3-B1's own `executionStatement`:
*"NOTHING IN THIS LIBRARY HAS BEEN EXECUTED. No activity was run against any real or production system.
Every `executionResult` is NOT_RUN."* And: *"No activity is labelled PASS, and **an unexecuted activity
may never be.**"*

The 42 P3-B3 rows with an `execution` block are the **only** executed evidence, **22 of their 118 output
lines are `INFERRED`** and 6 more `TRACED`. **And the 42 prove authority resolution, never workflow
completion:** *"all 42 are capability resolutions — which prove who may do a thing and never that the
thing completes."*

**Claims below are labelled [AUTHORED], [EXECUTED] or [TRACED] accordingly.** The corpus was generated
against **`d104cf49`, not this baseline**, so corpus statements about code state are **one commit
behind**.

### 0.3 THE FRICTION INSTRUMENT — the strongest signal in the corpus

Both story libraries score every activity against the same eleven booleans (two naming conventions, one
meaning). **Canonicalised over N = 660** (EMP-EXPERIENCE §0.4):

| Flag | Count | Share of 660 | Evidence of |
|---|---:|---:|---|
| **`NO_NEXT`** — no obvious "what next" location | **261** | **40%** | **The single largest experience defect in EOS.** Forty per cent of modelled work ends without telling the person what to do next |
| **`NO_WHY`** — no obvious "why" location | **216** | 33% | A third of work gives no in-place account of why the state is what it is |
| **`RECOVERY_UNCLEAR`** | **195** | 30% | Recovery from the failure the activity models is not discoverable |
| **`HUNT`** — had to hunt for necessary information | **182** | 28% | **The literal defect the organising rule names** |
| **`OWNERSHIP_UNCLEAR`** | **166** | **25%** | **A quarter of work cannot answer "whose is this?"** |
| **`HANDOFF_UNCLEAR`** | **90** | 14% | Role-to-role transfer is unclear |
| `HELP_MISSING` | 85 | 13% | Help absent at the moment it was needed |
| **`OC_UNCLEAR`** — operating-company attribution unclear | **81** | 12% | **and 81 of 660 is a FLOOR, not a ceiling — see §0.1** |
| `AI_SHORTEN` | 37 | 6% | |
| `AI_NOISE` | 8 | 1% | Under-counts; the categorical field is the better instrument |
| **`NOISE_PAGE`** — unnecessary explanation permanently occupied the page | **4** | **1%** | **Over-explaining is NOT an EOS problem. Under-explaining is** |

> **READ THE TOP FOUR TOGETHER. They are not four defects. They are ONE: EOS SHOWS STATE AND WITHHOLDS
> CONSEQUENCE.** Every requirement below is, at bottom, a demand that **a state be accompanied by its
> why, its next move, and its recovery.**
>
> **And read `NOISE_PAGE` = 4/660 as a design instruction.** The corpus authors were asked whether
> explanation was in the way, and **in 656 of 660 cases it was not. Nothing in this evidence supports
> stripping explanation to make surfaces cleaner.**

### 0.4 THE HAPPY PATH IS THE MINORITY CASE

| Device | Touch an exception-family category | Share |
|---|---|---:|
| DESKTOP (442) | 296 | 67% |
| MOBILE (149) | 96 | 64% |
| **HANDHELD_SCANNER (69)** | 55 | **80%** |
| **All 660** | **447** | **68%** |

**Only 213 of 660 activities touch no exception category at all. An experience designed around the 213
is designed around a third of the work. And the handheld is the MOST exception-dense surface in EOS with
the LEAST screen to spend on it.**

---

## 1. EOS ROLE LABELS FRAGMENT REAL JOBS

**40 distinct role labels across three libraries. They do not describe 40 jobs. They describe roughly
TEN real jobs, each split across libraries because each library was scoped to a MODULE.**

> **THE FRAGMENTATION IS THE FINDING: it is direct evidence that EOS's module boundaries cut across the
> people who use it.**

| Real job | Role labels in the corpus | Activities | Libraries |
|---|---|---:|---:|
| **PARTS / WAREHOUSE DESK** | `Parts Manager` (65 B2 + 4 B3), `Parts Associate` (37), `Stocker/scanner operator` (28), `Receiving Lead` (19), `Branch Parts Coordinator` (12), `Satellite Attendant` (7), `parts_counter` (5 B1), `Warehouse Manager` (5 B3), `Stocker` (4) | **186** | 3 |
| **TECHNICIAN** | `field_technician` (104 B1), `Field Technician` (26 B2), `apprentice_technician` (9), `Technician` (4 B3) | **143** | 3 |
| **OPS / SERVICE MANAGEMENT** | `service_manager` (60 B1), `Operations Manager` (17 B2 + 26 B3), `General Manager` (14), `Owner` (10), `Field Manager` (9) | **136** | 3 |
| **ADMINISTRATOR** | `Administrator` (83 B3), `System Admin` (27 B2), `Report Viewer` (1) | **111** | 2 |
| **DISPATCHER** | `dispatcher` (61 B1), `Dispatcher` (27 B2 + 9 B3) | **97** | 3 |
| **SALES** | `Salesperson` (43), `Sales Manager` (52), `Marketing Manager` (2) | **97** | 1 |
| **FINANCE** | `Controller` (19 B2 + 30 B3), `Accounting Manager` (36), `Finance Manager` (2) | **87** | 2 |
| **COORDINATOR** | `service_coordinator` (68 B1), `after_hours_coordinator` (5) | **73** | 1 |
| **BILLING / OFFICE** | `service_billing_admin` (18 B1), `Office Manager` (18 B3) | **36** | 2 |
| **INVENTORY CONTROL** | `Inventory Control Analyst` (34 B2) | **34** | 1 |
| **PURCHASING** | `Purchasing Admin` (8 B2), `Purchasing Manager` (2 B3) | **10** | 2 |

**Four jobs — Technician, Parts/Warehouse, Ops Management, Dispatcher — each appear in ALL THREE
libraries under THREE DIFFERENT LABELS.** A Dispatcher is `dispatcher` in Service, `Dispatcher` in
Inventory, and `Dispatcher` again in Sales/Admin, **and no artifact in the corpus joins those three views
of one person's day.**

**Two caveats on this grouping, both stated by the lane that made it:**
1. **It is UNPROVEN.** EMP-WORK §9.6: *"Collapsing 40 labels to ~10 jobs is this lane's inference from
   role-name and activity-content similarity. **No artifact in the corpus asserts it.**"*
2. **One row is explicitly the lane's own inference, not a corpus fact:** folding
   `after_hours_coordinator` into COORDINATOR. The persona is **disjoint** (Ken Iwata, 5 activities,
   `defaultDeviceContext: MOBILE`, where both day coordinators are DESKTOP). **Whether Ken is a
   coordinator on a rota or a distinct job is MISSING INPUT.**

**And three other lanes normalised the same 40 labels differently — 27 roles, 15 role families, ~30
register rows. FOUR NORMALISATIONS, NONE CHOSEN** — conflict **R-8**, `OD-1`.

**The upstream cause is named** (EMP-ROLE F-3): **there is no job-role vocabulary at all.** *"The 40
corpus role labels are not a naming accident — there was no canonical vocabulary for them to have
used."* **EMP-WORK's ~10 real jobs are a PROPOSAL for that vocabulary and need Owner ratification, not
adoption by default.**

---

## 2. ROLES WHOSE WORK CROSSES THE MOST MODULE BOUNDARIES

Derived from the 86-workflow registry's `actors` × `domain` fields — *"the most reliable crossing measure
available, because the registry assigns each workflow exactly one domain and names its actors
explicitly."* **[TRACED]**

| Rank | Real job | Workflows | Domains | Domains crossed |
|---|---|---:|---:|---|
| 1= | **Field Technician** | 18 | **8** | Service · Technician · Equipment · Inventory · Warehouse · Scanner · Reporting · Cross-domain |
| 1= | **Operations Manager** | 12 | **8** | CRM · Sales · Finance · Inventory · Purchasing · Warehouse · Reporting · Cross-domain |
| 3 | **Controller** | **20** (most of any actor) | 6 | Finance · Inventory · Purchasing · Service · Administration · Cross-domain |
| 3 | **Dispatcher** | 19 | 6 | Service · Scheduling · Equipment · CRM · Sales · Cross-domain |
| 3 | **Salesperson** | 12 | 6 | Sales · CRM · Finance · Inventory · Reporting · Cross-domain |
| 6 | Accounting Manager | 14 | 5 | Finance · Sales · CRM · Technician · Cross-domain |
| 6 | Sales Manager | 14 | 5 | Sales · CRM · Finance · Reporting · Cross-domain |
| 6 | Parts Manager | 13 | 5 | Inventory · Purchasing · Equipment · Finance · Cross-domain |
| 9 | Administrator | 11 | 4 | Administration · CRM · Finance · Cross-domain |
| 9 | General Manager | 9 | 4 | Administration · Finance · Reporting · Sales |
| 9 | Owner | 9 | 4 | Administration · Finance · Reporting · Cross-domain |

> **The two jobs that cross the most boundaries sit at OPPOSITE ENDS OF THE COMPANY** — a technician in
> a parking lot and an operations manager at a desk — **and NEITHER HAS A SURFACE THAT SPANS THEIR EIGHT
> DOMAINS.** The technician's eight are reached through **one handheld**; the operations manager's eight
> through **a dashboard the archaeology records as composed of placeholders.**

### 2.1 Health of the work, by job — `WORKS_WITH_GAPS` is the only state in which a person can finish

| Real job | Workflows | WORKS_WITH_GAPS | BROKEN_MIDWAY | CANNOT_START | NO_IMPL | % finishable |
|---|---:|---:|---:|---:|---:|---:|
| Service Manager | 9 | 5 | 4 | 0 | 0 | **56%** |
| Dispatcher | 19 | 10 | 8 | 1 | 0 | **53%** |
| Parts Associate | 8 | 3 | 4 | 1 | 0 | 38% |
| Inventory Control Analyst | 6 | 2 | 2 | 2 | 0 | 33% |
| Parts Manager | 13 | 4 | 5 | 4 | 0 | 31% |
| Service Coordinator | 10 | 3 | 5 | 1 | 1 | 30% |
| Field Technician | 18 | 5 | 8 | 4 | 1 | **28%** |
| Salesperson | 12 | 3 | 4 | 4 | 1 | 25% |
| Operations Manager | 12 | 2 | 6 | 3 | 1 | 17% |
| **Controller** | **20** | 3 | 7 | **9** | 1 | **15%** |
| Accounting Manager | 14 | 2 | 4 | 7 | 1 | 14% |
| Administrator | 11 | 1 | 8 | 1 | 1 | **9%** |
| Sales Manager | 14 | 1 | 6 | 6 | 1 | **7%** |
| **General Manager** | 9 | **0** | 2 | 6 | 1 | **0%** |
| **Service Billing Admin** | 5 | **0** | 2 | 2 | 1 | **0%** |

> **TWO JOBS HAVE NO FINISHABLE WORKFLOW AT ALL: General Manager (0 of 9) and Service Billing Admin
> (0 of 5). The person who turns completed work into money, and the person accountable for the
> company's numbers, CAN COMPLETE NOTHING END TO END.** **[TRACED]**
>
> **EMP-PERFORMANCE adopts this as the reason NO BUSINESS OUTCOME METRIC IS PROPOSED for either
> (OD-EMP-022): *"Not because the outcome is undefined, but because no workflow that would produce it
> can complete. A GAP, not a requirement."*** And **the Controller carries the most workflows of any
> actor (20) and the governed `controller` Role has ZERO HOLDERS even in the synthetic roster.**

### 2.2 The same finding from the other direction — seven real jobs, none owned by a module

| # | The job, as the person would say it | Modules crossed | Where the module boundary breaks it |
|---|---|---|---|
| **J1** | *"This machine keeps failing — should we keep fixing it or sell them a new one?"* | Equipment · Service · Inventory · Financials · Sales | **No equipment↔opportunity relationship exists in ANY entity definition**, and repair economics (repairs-12mo, repair spend vs replacement cost) was **deferred and never built** |
| **J2** | *"I'm standing in front of the machine — what happened to it last time, and what parts will I need?"* | Service · Equipment · Inventory | Service history may be on **a page the technician cannot open** → *"he phones the office"*; the truck is not offered as a parts source **until a seven-record join resolves** |
| **J3** | *"One customer, four machines, one trip."* | Service · Customer · Equipment · Scheduling · Fulfilment | Both coordinated surfaces are **read-only over a projection awaiting grants/deploys** — *"No command on either coordinated surface"* |
| **J4** | *"Get this part on order tonight so I don't lose tomorrow morning."* | Service · Inventory · Purchasing · Financials | The reorder chain runs — **and the Parts Manager who raises the request CANNOT APPROVE, REJECT OR CANCEL ONE**; only an administrator or dispatcher can |
| **J5** | *"Bill this repair visit."* | Service · Customer · Inventory · Financials | *"The billing queue anchors on a Sales Order; a repair call has none"*; **`billingQueue.ts` has ZERO IMPORTERS** — *"written and connected to neither end"* |
| **J6** | *"Four drive belts crossed the company line."* | Inventory · Warehouse · Operating Company · Financials | The model *"has NO OWNER DIMENSION AT ALL"*; allocation is built with **no operating-company predicate** — `grep -n operatingCompany` over four allocation files returns **ZERO HITS** |
| **J7** | *"A manufacturer safety notice — find every affected machine in the field."* | Equipment · Customer · Location · Service | One story, ten activities, **and no cross-module population read.** The coordinator reconstructs it |

> **NONE of J1–J7 is a Service job, an Inventory job or a Finance job. Every one is *A JOB*. AN
> EXPERIENCE ORGANISED BY MODULE CANNOT EXPRESS ANY OF THE SEVEN.** That is the finding, **and it is
> measured, not asserted.**

---

## 3. THE PER-JOB WORK MATRIX — thirteen facets

**[AUTHORED] unless marked. Activity ids are citations.** Full per-role detail for the seven
best-evidenced jobs is in [`role-profiles/`](role-profiles/); this section is the cross-job comparison.

| Job (activities) | JOBS TO BE DONE | WORK ARRIVING | HANDOFFS out | ESCALATES TO | THE DEFINING GAP |
|---|---|---|---|---|---|
| **Service Coordinator / After-hours** (73) | Decide which overnight email is real demand; create Work Orders from calls; link equipment and location; tell the customer when someone is coming; hand undecided rows on | 11 `inbound_work_requests` — 8 `AWAITING_DECISION`, 2 `NEEDS_REVIEW`, 1 `QUARANTINED`; phone calls; the night coordinator's note and voicemail | **9 HANDOFF.** To Dispatcher for MarkReady and Dispatch (**cannot do either**); to the afternoon coordinator; to Billing | **Dispatcher — and AFTER 17:30 THERE IS NOBODY.** *"At 17:30 when the dispatcher has gone home, the coordinator taking an emergency call cannot dispatch anybody"*; the after-hours coordinator *"phones a dispatcher at home"* | **NO URGENCY DETECTION ON INBOUND WORK — a request arriving at 18:30 waits until 06:40 and NOTHING ESCALATES IT REGARDLESS OF CONTENT.** And a coordinator **cannot cancel her own two-minute-old mistake** and must ask a dispatcher |
| **Dispatcher** (97) | Build tomorrow on the board; commit a named technician to a named job; absorb the day's changes; cover absence; hand the board on at shift change | Work Orders marked ready; technician phone calls; reorder requests for review; PM campaign rows | **13 HANDOFF — the most of any job.** To Technician (**until Dispatch runs, the Work Order carries no `assignedTechId` at all**); to the evening dispatcher; to Parts Manager on reorder approval | **NOBODY NAMED.** Receives escalation from Coordinator, Technician, Parts Associate and Purchasing Admin. **The dispatcher is the TERMINAL operational escalation point and the corpus records no path above them** | **Reassigning an in-progress job is NOT EXPRESSIBLE**: *"Dale tells Javier verbally and the record stays on Curtis."* **30 EXCEPTION — the highest of any job.** And *"the board surfaces the collision; a person decides"* — **nothing surfaces it** |
| **Field Technician** (143, incl. apprentice) | Accept, travel, arrive, diagnose, record, consume parts, install, complete. Receive truck transfers; find staged parts; load the truck | Dispatched jobs (readable **only where `assignedTechId` matches**); truck transfers; staged put-away sessions | **14 HANDOFF.** Out: to Billing on Complete. **To another technician — IMPOSSIBLE.** Inventory custody → equipment custody at install: *"Two authorities, one machine"* | **Phones the Dispatcher. CANNOT RECORD HIS OWN ABSENCE** — `createTechnicianBlockedTime` is admin/dispatcher only | **15 NETWORK_INTERRUPTION — by far the highest.** **Equipment reads are DENIED to technicians** (`isAdminOrDispatcher()`, *"a technician is neither"*) **[TRACED]**. **No governed non-completion: he cannot record "I could not do this", only Cancel.** And *"the lifecycle models a visit that SUCCEEDS"* |
| **Parts / Warehouse Desk** (186 — largest single job) | Receive supplier deliveries; record and chase POs; stage kits for named jobs; stow and relocate stock; move stock across the company line; close out at 17:30 | Three open supplier receipts on the awaiting-receipt queue, *"one belongs to ventana"*; approved reorder requests; technician restock requests | **8 HANDOFF.** Dispatcher → Parts Manager (approval); Parts Manager → Parts Associate (*"the request leaves the manager queue and enters Dwayne's personal queue"*); Parts Associate → Technician (staged kit); **the gun handed between operators mid-session**; shift change at 22:00 | *"The escalation target is Sam Ortega (System Admin) to activate the capability — **and the screen must say so rather than leaving Tessa to guess**"*; Associate → Dispatcher for void/cancel | **23 `had_to_hunt` — the highest single role label in the corpus.** **53 EXCEPTION and 46 BAD_DATA — the highest of both.** 19 CROSS_COMPANY. *"the belts sit in Ventana's stockroom, fitted on Thursday, **owned by Taylor on paper forever**."* **No governed command closes a short receipt line** — *"a line short stays open and the order stays SENT, indefinitely"* |
| **Inventory Control Analyst** (34) | Keep part identity true; run and reconcile cycle counts; age open transfers; validate imports before they land | Import files from branches; counted variance lines awaiting review | **2 HANDOFF.** To a second reviewer for her own variance (*"this is a genuine role handoff, not an error"*); to System Admin for capability activation | To System Admin; to a second reviewer — *"the screen must offer that as the next action, **with the eligible reviewers named**, or the recovery is a Slack message"* | **15 `had_to_hunt`.** The expected-quantity read is **NOT company-scoped**: *"queries `where('partId','==',partId)` with NO `operatingCompanyId` predicate and filters ONLY on location in memory"* **[TRACED]**. **No Part merge exists** — *"the only workaround is to retire one Part by status change and hand-correct its ledger, which an append-only ledger does not permit"* |
| **Service Billing Admin / Office Mgr** (36) | Close completed Work Orders; bill the visit; reconcile one fault that produced two Work Orders; chase content out of empty completions | **COMPLETED Work Orders** — *"aged COMPLETED Work Orders accumulate as a queue nobody can clear"* | **3 HANDOFF. In: from Technician on Complete. OUT: NOWHERE.** *"Nothing downstream is triggered by Close — no invoice, no customer notification"* | **NONE RECORDED.** `WF-FIN-002` (bill a service visit with no Sales Order behind it) is **CANNOT_START**: *"the most common revenue event in a field-service business"* has no route into the billing spine | **ZERO FINISHABLE WORKFLOWS.** **Labour time is ABSENT EVERYWHERE** — *"captured outside EOS, on paper or in payroll, and the Work Order carries none"*; both `workOrder.labor.record` and `.correct` are `active:false` and **absent from every activation override including platform-sandbox** **[EXECUTED]**. Close is **irreversible** |
| **Finance — Controller / Accounting Mgr** (87) | Produce the month's four inventory numbers; attest what the position rests on; close the period; reconcile EOS against the system of record; set approval thresholds | Month-end close obligations; variance and reconciliation exceptions | **0 HANDOFF-tagged in P3-B2; P3-B3 cannot express any.** In: from Parts/Warehouse and Billing. Out: to Owner/GM | **To the Owner, as BLOCKED DECISIONS**: intercompany accounting is blocked *"by explicit Owner block… a recorded refusal to guess, not a gap"*; which system is authority of record is undecided | **17 END_OF_MONTH — highest of any job. Margin is *"STRUCTURALLY unknown… the binding display rule is that it must render as UNKNOWN, never 0%"*** (the cost engine is *"written, 425 lines, and imported by nothing"*). **`WF-FIN-001`: *"THE BUSINESS CANNOT BILL A CUSTOMER FROM EOS TODAY IN PRODUCTION"*** **[EXECUTED]** |
| **Sales** (97) — **THIN EVIDENCE** | Open and work an opportunity; quote the deal; book, allocate and fulfil a Sales Order; maintain the account | Inbound calls. **NOT service-originated replacement conversations** — *"The Service → Sales direction DOES NOT EXIST IN ANY FORM"* | To Dispatcher/Operations for fulfilment — **BROKEN, AND IT SURVIVES ACTIVATION**: *"`salesOrder.fulfill` and `salesOrder.service` are held by `owner`, `admin` and `dispatcher` and by NO GOVERNED BUSINESS ROLE"* **[EXECUTED]** | **Approval thresholds DO NOT EXIST.** `WF-XD-001` *"Opportunity to cash"* is CANNOT_START: *"37 of 147 capabilities are allowed anywhere in production and NOT ONE OF THEM IS COMMERCIAL"* **[EXECUTED]** | **No coverage tags, no friction scores, no operating company — UNMEASURABLE.** *"Every price on every agreement is typed by hand, with no history, no list, no schedule, no template and no approval threshold."* **A Salesperson and a Sales Manager can see NO FINANCIAL FACT** **[EXECUTED]**. After acceptance *"commercial terms cannot change at all… A renegotiation has no governed move"* |
| **Ops / Service Management** (136) | Record blocked time and closures; review the morning's Work Orders for completeness; attribute work to the right technician and company; run the scorecard; close the service month | Blocked-time requests; completeness exceptions; variance and attribution questions | **1 HANDOFF-tagged across 136 activities. Management's handoffs are essentially unmodelled** | **To the Owner as unresolved rulings** | **29 `had_to_hunt` and 24 `ownership_unclear` — the HIGHEST of any role label on BOTH counts.** **28 END_OF_MONTH — highest in the corpus.** Service quality is *"named, slotted and empty on an accepted surface, assigned to a **Service Operations domain authority that does not exist**"*. **General Manager: 0 of 9 finishable.** `WF-SVC-016`: *"Step 3 is impossible: NO WORK ORDER CARRIES AN OPERATING COMPANY"* |
| **Administrator / System Admin** (111) | Grant roles; onboard employees; create warehouses and bins; stage customer imports; govern objects; see who did what | Access requests; escalations from Parts and Inventory Control | **2 HANDOFF.** *"Nothing changes for Luis. **The handoff Sam thinks he completed did not happen**"* — a handoff that **silently does not occur** | **TO ENGINEERING, OUTSIDE THE PRODUCT.** *"Sam's real recovery is to ask an engineer to run a script. That is the finding"* | **9% finishable — 8 of 11 BROKEN_MIDWAY.** Employee create *"is a Node script… **No callable, no screen, no capability row**"*, and **`Employees` has no row in any of the four access tables.** Audit is **written and unreadable**: *"An append-only audit authority genuinely exists and governed commands write to it — including DENIALS. **An administrator cannot read it**"* |
| **Purchasing** (10) | Record purchase orders; import supplier price files; load opening balances | Requests assigned by the Parts Manager into a **PERSONAL** queue | **The corpus's single most likely real-world friction** (§3.1 of the handoff model) | *"Ask an admin or dispatcher to reassign.' CURRENT RISK: a raw permission error that does not name the assignee or the escalation"* | **A purchase order has NO BUSINESS NUMBER** — *"Nothing prints, encodes or resolves a scannable order label."* *"The internal id is the request id and is not a purchase order number anyone outside the building recognises"* |

### 3.1 Interruption and after-hours load, by job

**Coverage-tag derived; P3-B3's 350 rows contribute NOTHING.** Note: **the corpus has no literal
`INTERRUPTION` category** — interruption is expressed as `BACK_BUTTON_ABANDONED_FLOW` (B1),
`BACK_BUTTON` + `ABANDONED_FLOW` (B2) and `NETWORK_INTERRUPTION`.

| Real job | n | NETWORK_INT | BACK_BUTTON/ABANDONED | AFTER_HOURS | END_OF_DAY | END_OF_MONTH | PERMISSION_DENIAL | CROSS_COMPANY |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Parts / Warehouse | 186 | 8 | 9 | 6 | 15 | 3 | **19** | **19** |
| Technician | 143 | **15** | 2 | 5 | 5 | 0 | **19** | 11 |
| Ops / Management | 136 | 0 | 0 | 0 | 4 | **28** | 5 | 7 |
| Administrator | 111 | 0 | 3 | 3 | 0 | 0 | 6 | 1 |
| Dispatcher | 97 | 1 | 2 | 1 | 7 | 0 | 6 | 9 |
| **Sales** | **97** | **—** | **—** | **—** | **—** | **—** | **—** | **—** |
| Finance | 87 | 0 | 0 | 3 | 0 | 17 | 1 | 5 |
| Coordinator | 73 | 0 | 4 | 6 | 3 | 0 | 8 | 13 |
| Billing / Office | 36 | 0 | 1 | 1 | 2 | 11 | 1 | 3 |
| Inventory Control | 34 | 0 | 1 | 0 | 5 | 4 | 2 | 2 |
| Purchasing | 10 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |

> **Interruption is a FIELD phenomenon** (technician 15 of 24 network interruptions) **and end-of-month
> is a MANAGEMENT AND FINANCE phenomenon** (Ops 28, Finance 17, Billing 11). **The two populations need
> OPPOSITE things from EOS: the field needs work to survive a dropped connection; the back office needs
> a number to survive an audit.** **The Sales row is empty because it CANNOT BE MEASURED, not because
> sales work is uninterrupted.**

---

## 4. THE 07:30 ANSWER, PER ROLE

> *If this person started work at 07:30, what should EOS already know, what should be waiting for them,
> and what should EOS bring to their attention without their having to hunt for it?*

| Real job | EOS should already know | Should be waiting | Should be brought forward UNASKED | Today's gap at 07:30 |
|---|---|---|---|---|
| **Coordinator** | **When the inbound transport last successfully polled**; which rows a colleague is mid-decision on; who the night coordinator spoke to | The decided/undecided split of the overnight queue, **ordered by urgency**, with each row's account resolved | **Any overnight request whose CONTENT is an emergency.** Anything promised to a customer that no Work Order yet carries | **No urgency detection and no escalation on inbound work.** An empty queue from a dead poller **looks identical to a quiet weekend.** The night's decisions *"live nowhere"* |
| **Dispatcher** | Every technician's availability **including PTO and closures**; **what the previous shift changed and why** | Today's board, with **unaccepted dispatches and incomplete Work Orders flagged** | **Blocked-time collisions** against placed work; dispatches unaccepted past a threshold; Work Orders ready but **missing address or equipment** | *"The board surfaces the collision; a person decides"* — **nothing surfaces it.** The recommendation engine *"does not know about PTO."* *"The handoff dispatcher has no view of what the morning dispatcher did"* |
| **Technician** | Which jobs are his; each machine's history; what is on his truck; **what the parts desk staged for him** | The day's jobs **in a workable sequence** with equipment context and parts plan attached | **Whether the part is already on his truck**; cancellations that happened while he drove; **anything still unsynced from yesterday** | **Equipment reads are DENIED to technicians** **[TRACED]**. *"The balance screen cannot answer 'does my technician already have one?'"* *"Curt's recovery is a phone call at 06:05, **which is the workflow this feature was supposed to remove**"* |
| **Parts / Warehouse** | What is expected on the dock, **and which company owns each line**; where every approved request went | The awaiting-receipt queue with supplier names **and operating-company attribution**; lines carried over from yesterday | **Short lines still open**; staged kits at risk of being picked for another job; **requests approved and sitting unassigned** | *"If it lands nowhere visible it simply waits."* *"Availability does not move, so the Thursday kit is still promisable to a Wednesday emergency call. **That is the real operational risk**."* **No governed command closes a short line** |
| **Inventory Control** | Which imports are pending and which rows are ambiguous; **every open transfer's age** | Variance lines awaiting review, **with her own counts flagged as needing a second reviewer** | **Duplicate part numbers**; ambiguous warehouse names in a staged import; transfers past an age threshold | *"The escalation target is Sam Ortega… **and the screen must say so rather than leaving Tessa to guess**."* *"the recovery is a manual ledger export and a spreadsheet, **which is what will happen**"* |
| **Billing / Office** | Which Work Orders completed yesterday **and what each contains** | The **closable** queue, and the **aged-COMPLETED** queue **separately** | **Completions with no note and no parts**; **one fault that produced two Work Orders** | *"Aged COMPLETED Work Orders accumulate as a queue nobody can clear."* **Labour is not in EOS at all** **[EXECUTED]** |
| **Finance** | Period state; **what the current position rests on**; which company performed each record | The close checklist **with each number's provenance** | **Anything that would change a published number**; approvals waiting on a threshold that is unset | Margin *"must render as unknown rather than as zero."* *"no surface produces any of that, so the figure will be assembled by hand and **its provenance will live in someone's spreadsheet**."* **Cannot bill in production at all** **[EXECUTED]** |
| **Sales** | Pipeline by close month; each account's **installed base and open service work** | Today's pipeline with stage and age | **A repair call that should become a replacement conversation**; agreements blocked on an unpriced line | *"The Service → Sales direction does not exist in any form."* A blocked agreement *"CANNOT BE CLEARED FROM THE RECORD PAGE"*. Sales can see **no** financial fact **[EXECUTED]** |
| **Ops / Management** | Who is unavailable today and why; **yesterday's completion truth per technician AND per company** | The exception list: incomplete WOs, unattributed labour, open month-end items | **Where the scorecard is built on data that cannot support it** | Service-quality metrics are *"named, slotted and empty… assigned to a Service Operations domain authority that does not exist."* **No Work Order carries an operating company, and INFERRING IT IS FORBIDDEN** |
| **Administrator** | **Which capabilities are inactive in this environment**; which grants resolve to nothing | The access-request queue; onboarding in progress | **Grants that grant nothing**; denials recorded in the audit log | *"The recovery is for Sam to learn the capability is inactive, **which nothing on the Role screen tells him**."* Audit is **written and unreadable** |
| **Purchasing** | Which requests are assigned to whom; **the supplier cut-off times** | Their own assigned queue | **A request assigned to an absent colleague approaching a cut-off** | **No reassignment branch exists**; *"The order misses the cut-off"* |

**Two requirements EOS ALREADY SATISFIES and which are load-bearing** (EMP-EXPERIENCE EXP-003, EXP-013):
**the honest-state vocabulary distinguishes `EMPTY` / `NO_MATCHES` / `CAPABILITY_NOT_ENABLED`** — *"A
wrong honest state on day one costs an hour of somebody's time"* — and **Decision #161: *"A gated module
holds its place. Re-ranking a dashboard around what happens to be available today teaches the reader
that availability is importance."*** **Adopt the second verbatim as an experience rule for all six
buckets.**

---

## 5. WORK QUEUES — what must exist, and its state

### 5.1 "My Work" is SIX buckets keyed on SIX different things

**Do not produce one generic "My Work."** (EMP-EXPERIENCE §3 — canonical)

| Bucket | Keyed on (concept #) | Key field at `64008d5a` | Buildable? | When it matters |
|---|---|---|---|---|
| **MY OWNED RELATIONSHIPS** | RECORD OWNER (1) | **four** field names | **PARTIAL + UNGOVERNED** — a union across four shapes, **and the key is client-writable, unaudited, by any admin or dispatcher** | Continuously, for anyone with a book of accounts. **A STANDING list, never a to-do list** |
| **MY ACCOUNTABILITIES** | ACCOUNTABLE PERSON (2) — **collapsed** | **none.** Nearest is a role-keyed state | **MISSING (MODEL GAP)** + measured-empty | When something is mine to see through **without being assigned to me** — *"Marisol needs to know this is hers now"* |
| **MY ASSIGNED WORK** | ASSIGNEE (3) | `assignedTechId`/`technicianId`, `assignedToUserId`, per-domain | **PARTIAL** — per-domain assembly | The technician's and parts associate's whole day. **THE ONLY BUCKET WITH A REAL WORKING KEY** |
| **MY APPROVALS** | SECURITY ROLE (8) + ACCOUNTABLE PERSON (2) | `roleAssignments` → capability | **AVAILABLE as capacity / MEASURED-EMPTY in production** | When someone else is blocked waiting for me. **SEPARATION OF DUTIES LIVES HERE** — *"A counter cannot approve their own material variance. This is a CONTROL, not a permissions problem"* |
| **MY ESCALATIONS** | ESCALATION OWNER (5) | **nothing exists** | **MISSING — cannot be built at all** | When my own authority has run out |
| **MY TEAM / MANAGEMENT VIEW** | MANAGER (4) | **two unreconciled answers**, neither expressing a team | **MISSING (MODEL GAP)** | Only for someone with people — **and it must be a DIFFERENT SURFACE, not a wider one** (§7) |

> **Of the six: ONE has a working key · TWO are partial and need a union across heterogeneous fields ·
> THREE cannot be built at all. A DESIGN THAT SHIPS ONE "MY WORK" LIST HIDES THAT DISTRIBUTION AND
> IMPLIES EOS CAN ANSWER QUESTIONS IT CANNOT.**

**Two anti-requirements, stated so a later pass cannot re-derive them:**
1. **`MY OWNED RELATIONSHIPS` must NEVER be merged into a task list.** An owned account is not a to-do.
2. **A bucket whose key does not exist must render as a STATED ABSENCE, not as an empty list.** The
   corpus proves the cost twice over — *"The honest-state vocabulary distinguishes EMPTY from NO_MATCHES
   from CAPABILITY_NOT_ENABLED, which is precisely what separates 'no work today' from 'your account is
   not linked'"*, and an unpolled transport makes the queue *"empty and indistinguishable from 'no
   weekend demand'."* **Given measured-zero occupancy, EVERY role-keyed bucket will be empty on day one
   for STRUCTURAL reasons, and must say WHICH reason.**

**One recorded disagreement, not resolved** (conflict **A-1**, EMP-EXPERIENCE §3.4): EMP-WORK holds
*"EOS models the ASSIGNEE and no other role concept."* **EMP-EXPERIENCE holds the NARROWER reading** —
RECORD OWNER **is** stored; what is missing is **a single key to query it by** plus a live read path — so
`PARTIAL (MODEL: heterogeneous keys) + MISSING (production transport)` **rather than "not stored."**
**EMP-EXPERIENCE's is the more precise and is used; EMP-WORK's is true of every OTHER bucket.**

### 5.2 Per-role bucket contents, and what each resolves to

**`ROLE-EMPTY` = the bucket's key resolves and returns nothing in production.** (EMP-EXPERIENCE §3.2)

| Role family | MY OWNED | MY ACCOUNTABILITIES | MY ASSIGNED | MY APPROVALS | MY ESCALATIONS | MY TEAM |
|---|---|---|---|---|---|---|
| **Field Technician** | — | Jobs accepted but unfinished + queued sync intents — **PARTIAL**, *"whether anything escalates it is UNPROVEN"* | Today's dispatched + accepted WOs **in the order he will drive them** — **PARTIAL**: assignment works, **route order does not exist** | — | Refusals he cannot self-serve; **a certification he lacks (*"Nothing warns"*)** — **MISSING** | — |
| **Dispatcher** | — | The board for the day(s) she owns; jobs stuck in `DISPATCHED` past their age — **PARTIAL**, *"whether any surface shows time-in-status is UNPROVEN"* | Placements she made that have not been accepted — **PARTIAL** | **Reorder approve/reject/cancel — WHICH SHE HOLDS AND THE PARTS MANAGER DOES NOT** — `ROLE-EMPTY` | Technician gone sick with four jobs outstanding; **no reassign verb** — **MISSING** | Her technicians' lanes — **but this is CAPACITY, not people management** |
| **Service Coordinator** | The accounts and sites she habitually handles — **MISSING**: no owner field on an inbound row | The inbound rows she has decided vs not; **customers she has promised a callback** — **MISSING** | WOs she created that are not yet scheduled — **PARTIAL** | — | A cross-company mis-intake with *"no 'move this WO to the other company'"* — **MISSING** | — |
| **Service / Field Manager** | — | Service quality for her branch — **MISSING**: *"assigned to a Service Operations domain authority that does not exist"* | — (**a manager's own assigned work is rare and must not dominate**) | Goal approval — **BLOCKED** | Onboarding chain incomplete for a new starter — **MISSING**: *"seven records with no single view"* | **§7** |
| **Parts Manager** | The catalog and reorder points she stewards — **MISSING** (no steward concept) | Requests in `READY_FOR_PARTS_MANAGER` — **THE CANONICAL ACCOUNTABILITY BUCKET**, and `ROLE-EMPTY`: **she cannot approve what lands there** | Requests assigned to her by name — **PARTIAL** | **NONE — AND SHE SHOULD HAVE THEM.** `reorder.request.approve/reject/cancel` reach **no governed business Role** | Capability inactive with no self-service path — **MISSING** | **§7** |
| **Parts floor** (Associate · Receiving Lead · Stocker · Satellite) | — | The receiving session or count sheet he opened and has not closed — **PARTIAL** | Scan tasks, put-aways, pick/stage requests — **PARTIAL**; *"Nothing produces a pick list"* | — | **THE DENSEST ESCALATION NEED IN THE CORPUS.** A committed duplicate needs an `ADJUSTED` movement *"which requires authority Ray may not hold. **That escalation must be discoverable from the line**."* One case is *"a GENUINE STRUCTURAL DEAD END"* — **MISSING** | — |
| **Inventory Control Analyst** | The count sheets and variance lines she authored — **PARTIAL** | Open variances awaiting a second reviewer — **PARTIAL** | Sheets assigned to her — **PARTIAL** | **Cannot approve her own — CORRECT**, and the screen must *"offer that as the next action, with the eligible reviewers NAMED"* — **MISSING** (no eligible-reviewer resolver) | Inactive `cycleCount` capabilities — **MISSING** | — |
| **Billing / Office / Accounting Mgr** | — | WOs completed-but-not-closed — **PARTIAL**, and *"Two companies' revenue recognition runs off ONE UNSEGREGATED LIST"* | — | Invoice issue / credit approval — **MISSING** (`finance.invoice.issue` inactive; FIN-007 *"not configured"*) | A WO completed with no content: *"The technician is phoned and re-enters the information verbally"* — **MISSING** | — |
| **Controller / Finance Mgr** | — | The four month-end numbers; the books each entry lands in — **PARTIAL** | — | Period close, void, intercompany — **MISSING** (all `CANNOT_START`, three `OWNER_DECISION_PENDING`) | — | **§7** |
| **Salesperson** — **THIN EVIDENCE** | **THE PRIMARY BUCKET FOR THIS ROLE** — accounts, opportunities, agreements she owns — **PARTIAL model / MISSING in production**: every `opportunity.*` id resolves **DENY for all 48 roles** | Agreements awaiting acceptance; orders requiring action — designed and **GATED** | — | — | An ownerless Account refuses Opportunity creation and *"the report field that would list them is inactive in every environment"* (**EXECUTED_FAIL**) — **MISSING** | — |
| **Sales Manager** — **THIN EVIDENCE** | Accounts he owns directly | Channel/territory coverage — **MISSING** (channel is a property of the **deal**, not the person) | — | Goal approval — **BLOCKED** | — | **§7**, and *"EVERY salesManager sees EVERY salesperson"* |
| **Ops / GM / Owner** | — | Cross-domain exception review — **PARTIAL** | — | Access grants, ownership handoff — **PARTIAL** (**the handoff command has no caller**) | — | **§7** |
| **Administrator / System Admin** | — | Objects, roles and policy she governs — **PARTIAL**: *"`Employees` has no row in ANY of the four tables"* | Access requests — **MISSING** (**no request object**) | Role grant / revoke — **CAPABILITY_INACTIVE** | *"Sam is asked to just switch the capability on"* — **the correct answer is refusal plus a pointer at the release process, and the screen does not say what `active:false` means** | — |
| **Branch Parts Coordinator** | — | Stock crossing the company line — **MISSING**: **12 of 12 `OC_UNCLEAR`, 11 of 12 `OWNERSHIP_UNCLEAR`. THIS ROLE EXISTS *BECAUSE OF* THE OPERATING-COMPANY BOUNDARY AND EOS CANNOT EXPRESS IT** | — | — | Intercompany transfer with **no title-transfer event** — **MISSING** | — |
| **Warehouse Manager** — **THIN EVIDENCE** | The warehouses she is assigned — **PARTIAL**: `assignedWarehouseIds` went live in Rules; **the census records `assignedWarehouseComparison: BOTH_EMPTY` for the one warehouse-manager employee** | — | — | — | *"No governed way to create or activate a warehouse"* — **MISSING** | — |

### 5.3 The process queues, and what each is keyed on

| Queue | Keyed on | State | Attribution |
|---|---|---|---|
| **Inbound work decision** | `queue` + `status` | **The ONLY real queue in EOS** — and it filters on **`status` only**, no owner, role or company predicate. Its capability is `active:false`, so it **denies every principal.** `NEEDS_REVIEW` is *"same queue, louder"* — **in a code comment and nowhere on screen** | OWN-E2E stage 5; EMP-INFO |
| **Reorder ladder** | `currentOwner` role token + `status` | **The ONE real escalation ladder, and it is a STATUS ladder.** Measured-empty in production; **and the Parts Manager who raises a request cannot approve it** | OWN-DESIGN Panel C |
| **Ready-to-schedule / board** | `status` over `SCHEDULABLE_STATUS` | `service.workOrder.readyToSchedule.count` **ACTIVE at `FIRM`** — **derived from the transition table rather than listed.** But the collision is not surfaced and the recommender **does not know about PTO** | EMP-PERF §7 |
| **Past-due / at-risk** | `scheduledStart` age + stagnation | `service.workOrder.pastDue.count` **ACTIVE at `FIRM`, applied GLOBALLY** — **cannot be pointed at a person even if someone wanted to.** `detectStalledJobs` returns **only HIGH and CRITICAL**, and a WO with an unusable `createdAt` **is dropped from the At-risk table entirely** — *"the Work Order the system knows least about is the one it shows least"* | EMP-PERF §7; EMP-INFO A-6 |
| **Scheduling exceptions** | `detectDayOverlaps()` | `service.workOrder.schedulingConflict.count` **ACTIVE at `FIRM`** — *"the same primitives the scheduling workspace uses"* | EMP-PERF §7 |
| **Closable / aged-COMPLETED** | `status` | **MISSING** — *"a queue nobody can clear"*, and **unsegregated by company** | EMP-WORK |
| **Variance awaiting second reviewer** | separation of duties | **PARTIAL** — the control exists, **the eligible-reviewer list does not** | EMP-EXP EXP-019 |
| **Awaiting-receipt / expected in today** | supplier receipt lines | **MISSING as a scan-first entry** — **a purchase order has no business number** | EMP-EXP EXP-009 |
| **Open reorder requests / POs awaiting receipt / open POs** | location / firm | **MEASURABLE** — three ACTIVE registry metrics at `LOCATION`/`FIRM` scope, **attributed to a LOCATION, never a person** | EMP-PERF §7 |
| **Ownerless records** | owner field | **MISSING AND UNREPORTABLE.** *"the most consequential exception in the CRM domain and the hardest to see"* (**EXECUTED_FAIL**) | EMP-EXP §5.4 |
| **Access requests / approvals** | `approverConstraint` | **MISSING** — workflow and UI **explicitly deferred** | OWN-DESIGN WG-4 |

**And the rule that binds all of them** (`eos-dashboard-composition-authority` Rule 6, EMP-INFO S-5):
**a bounded read may return a page and say so. A TOTAL may not.**

---

## 6. WORK CURRENTLY HELD OUTSIDE EOS

> **THE HIGHEST-VALUE FINDING IN EMP-WORK — and the weakest-provenance evidence in the corpus. BOTH
> HALVES MUST TRAVEL TOGETHER.**
>
> **PROVENANCE, MANDATORY:** EMP-WORK states plainly that this section rests **entirely on AUTHORED
> NARRATIVE** and should reach the Owner as **a hypothesis to test, not as observed practice.**
> *"'Ray's recovery is a phone call today' is what an author believed, not a recorded observation. This
> is the single largest UNPROVEN in the lane, and it bears directly on its highest-value finding."*
> **EMP-ACCOUNTABILITY carries them with that qualifier at its Appendix A and instructs that it must
> survive into any canonical artifact. It does. DO NOT PROMOTE THESE TO OBSERVED FACTS WITHOUT THE
> OWNER CONFIRMING THEM.**

**Channel counts — distinct activities matching a tightened regex over title, trigger, narrative,
purpose, starting state, transition, cross-object effect, exception/recovery and help fields:**

| Channel | Distinct activities | Of which |
|---|---:|---|
| **Telephone** (conversation, not handset-as-device) | **40** | P3-B1 26 · P3-B2 8 · P3-B3 6 |
| Email as a work channel | 30 | P3-B1 dominant (the inbound queue story) |
| Text / SMS / chat | 26 | includes one explicit *"or the recovery is a Slack message"* |
| Spreadsheet / workbook / CSV | 22 | P3-B2 dominant (imports, opening balances) |
| Paper / printout / handwritten / clipboard / whiteboard | 20 | — |
| Human memory | 16 | **excludes code-level "filters in memory" false positives** |
| In-person / verbal / hallway | 9 | — |
| Two-way radio | 2 | — |

### 6.1 THE PATTERN — and it is the load-bearing qualifier

> **In 44 OF 44 named instances the out-of-EOS channel is NOT A CONVENIENCE. It is a RECOVERY PATH —
> the thing the person does when THE PRODUCT CANNOT EXPRESS THE ACT.** *"The business is not avoiding
> EOS out of habit, it is routing around a gap. Each is therefore evidence of an UNMET ACCOUNTABILITY
> REQUIREMENT rather than a training problem."* (EMP-ACCOUNTABILITY Appendix A)

### 6.2 The four load-bearing ones, and what each implies

| # | Work held outside EOS | Channel | Accountability consequence |
|---|---|---|---|
| 1 | **THE CUSTOMER PROMISE** — *"The coordinator picks up the phone. **The promise lives outside EOS**."* *"She promises 'this afternoon' and hopes"* — *"The person talking to the customer and the person who can see the schedule are two people"* | **Phone** | **The single most important accountable commitment in the business has NO RECORD AT ALL. Every orphan is therefore worse than it looks: CANCELLING A WORK ORDER DOES NOT CANCEL THE PROMISE, and EOS never knew about the promise to begin with** |
| 2 | **THE DISPATCHER SHIFT HANDOFF** — *"Every in-flight decision — who was phoned, which customer was promised what — is verbal."* *"The dispatcher's working memory of the morning is gone"* | **Verbal** | Corroborates ORPHAN-2 and *"The handoff dispatcher has no view of what the morning dispatcher did"* / *"The handoff is where the day's context is either transmitted or lost."* **Continuity model B is required here and the acceptance state does not exist** |
| 3 | **LABOUR TIME** — *"Labour time is therefore captured outside EOS, on paper or in payroll, and the Work Order carries none"* | **Paper / payroll** | **An assignee's own record of what they did is not in EOS, so EVEN THE ONE ROLE EOS DOES MODEL cannot be held accountable from the record.** `workOrder.labor.record` is `active:false` **in every declared environment** **[EXECUTED]** |
| 4 | **THE PUBLISHED FINANCIAL POSITION** — *"no surface produces any of that, so the figure will be assembled by hand and **its provenance will live in someone's spreadsheet**"* | **Spreadsheet** | Consistent with financial families being COMPANY-owned and `IMMUTABLE`: **the accountable PERSON for the published number is outside the system** |

### 6.3 And the FIFTH, which has no outside channel at all

**COMPETENCE.** `P3B1-S17-A06` — an apprentice completes a job requiring a certification he does not
hold:

| Field | Value at `64008d5a` |
|---|---|
| Action | *"Complete it."* |
| Expected state transition | *"WORK_IN_PROGRESS → COMPLETED. **Succeeds.**"* |
| Expected UI result | ***"Nothing warns."*** |
| Exception / recovery | *"The compliance exposure is real and **entirely outside the system**"* |
| Cross-object effect | *"**Neither the recommendation engine nor the scheduler nor the transition engine reads any skill or certification data.** The recommendation engine's own comment notes technicians have name/phone/status only"* |

> **THREE SEPARATE SUBSYSTEMS THAT SHOULD GATE ON COMPETENCE READ NONE OF IT.** The dispatcher's
> recommendation engine cannot avoid assigning an uncertified technician, the scheduler cannot refuse
> the placement, and the transition engine completes the job silently.
>
> **AND UNLIKE THE PHONE, THE SPREADSHEET AND THE PAPER TIMESHEET, IT HAS NO OUTSIDE CHANNEL AT ALL:
> NO ONE IS HOLDING IT ANYWHERE.** → `OD-12`

### 6.4 Named instances — the 44, condensed by owner

| Job | Held outside EOS (representative) | Channel |
|---|---|---|
| **Coordinator** (8) | The promise to the customer · the night's decisions (*"Ken's decisions, the customer conversation and the reason a night crew was or was not called live nowhere"*) · after-hours intake (*"the on-call coordinator writes it on paper and enters it at 07:00, and the emergency has no record for nine hours"*) · the Taylor/Ventana PM split (*"she maintains the split in a spreadsheet"*) · PM due dates · customer-specific handling (*"she explains it verbally every time"*) · follow-up commitments (*"If nobody remembers, the customer phones in week three"*) | Phone · paper · spreadsheet · verbal · memory |
| **Dispatcher** (6) | The entire shift handoff · *"The dispatcher's working memory of the morning is gone"* · special handling (*"Dale remembers, or he does not"*) · mid-day reassignment (*"Dale tells Javier verbally and the record stays on Curtis"*) · sick cover (*"the dispatcher leaves them and phones the customers"*) · technician ids from *"a stale technician id from a spreadsheet"* | Verbal · memory · phone · spreadsheet |
| **Technician / Apprentice** (9) | **Labour time** · route sequence (*"Curtis sequences by memory and local knowledge, which is usually better than anything the data supports"*) · job content on an undocumented handover (*"He works blind, with no access to the parts plan, the note or the customer detail"*) · serial corrections · warranty claims (*"The claim is filed outside EOS"*) · finding staged parts · truck-to-truck part transfer · restock intent · **compliance (no channel)** | Paper · memory · phone · **none** |
| **Parts / Receiving / Stocker** (7) | Receipt exceptions (*"Ray's recovery is a phone call today"*) · **request closeout (*"Ray emails Dwayne. That is the current integration"*)** · bin location (*"stow warehouse-direct and write the shelf on paper"*) · hand-keyed codes (*"the only evidence of intent is the operator's memory"*) · a lost count session (*"there is no recovery — only a re-count, and nobody will know a re-count is needed"*) · staging handoff (*"then the handoff to Curt is verbal"*) · missing kit items (*"a re-pull with no record of who took them"*) | Phone · **email** · paper · memory · verbal |
| **Inventory Control** (3) | Duplicate part numbers (*"The real-world recovery is a spreadsheet and a phone call. That is the gap"*) · transfer ageing · second review (*"or the recovery is a Slack message"*) | Spreadsheet · phone · chat |
| **Billing** (4) | Empty completions (*"The technician is phoned and re-enters the information verbally"*) · after-hours labour (*"She reconstructs it from the technician's paper timesheet"*) · one fault two WOs (*"She merges them by hand in the billing system"*) · equipment provenance (*"She checks the sales paperwork"*) | Phone · paper · external system |
| **Controller / Owner** (3) | Attestation (*"attest from engineering's deployment history, outside the system"* — and those writes *"have no in-product audit entry and no actor the product can name"*) · **the published position** · consolidation (*"Elimination is explicitly outside EOS and belongs to an external authority"*) | External · spreadsheet |
| **Service Manager / Admin / Sales** (4) | Recall completion (*"lives in a document outside EOS, **which is where the evidence will be looked for years later**"*) · warehouse creation (*"Sam's real recovery is to ask an engineer to run a script. **That is the finding**"*) · employee creation (*"a Node script… No callable, no screen, no capability row"*) · pricing (*"Every price on every agreement is typed by hand"*) | Document · engineer · CLI · hand |

---

## 7. WHAT MANAGERS MUST SEE THAT INDIVIDUALS SHOULD NOT — AND THE REVERSE

**The evidence forces THREE questions, not one, because the boundary runs in two directions and one of
them is currently unenforceable.** (EMP-EXPERIENCE §5)

### 7.1 Manager-only, and whether EOS can enforce it

| Manager sees | Individual must not | Why | Can EOS enforce it? |
|---|---|---|---|
| **Comparison across people** | A peer's figures | Comparison is the manager's job and **a peer-visible league table is not** | **NO** — *"with role-only hierarchy EVERY salesManager sees EVERY salesperson."* **The boundary exists between LEVELS, not between TEAMS** |
| **Unassigned / unowned work** | — | **A management failure to fix, not an individual's queue** | **NO** — **EXECUTED_FAIL**: *"an ownerless account blocks opportunity creation by design, and the report field that would list them is inactive in every environment"* |
| **Capacity / utilisation across the team** | Colleagues' load | | **PARTIAL** — `% booked` *"renders only when every technician in view has a recorded schedule, **which in practice means never**"* |
| **Goals and targets — set and approve** | **AUTHORING their own target** | Owner's stated position: *"employees do not automatically manage their own targets"* | **PARTIAL** — read granted widely, authoring not; `WF-RPT-004` **CANNOT_START** |
| **Cost, margin, rate** | Pricing, rates, tax, totals | *"A technician completes work/parts/times/readings; **pricing, rates, tax, and totals are office-only**"* | **NO** — *"Route-level `ROLE_NAV_ACCESS` cannot express this."* **Field-level visibility within a document (G35) is a NAMED, UNBUILT capability — and ADR-007 solved the same problem for REPORTS and *"nobody connected the two"*** |
| **Cross-domain activity for one employee** | Another's activity trail | | **NO** — `Employee` is *"a wave-4 reportable object with **no fields populated**"*; and **the ELEVEN governed Roles declaring `audit.event.read` are REFUSED by the deployed service** |
| **Salary-class aggregates** — *"SUM(salary) by department but not any individual salary"* | Any individual row | ADR-007 calls it *"the single most common sensitive report"* | **NO** — aggregate-only field access was **ruled out for v1**, surfaced *"now rather than discovered in wave 5"* — **and wave 5 is the financial wave** |

### 7.2 Individual-only — the direction missing from the brief

| The individual must see | The manager should not, or not silently | Evidence |
|---|---|---|
| **His own performance figure, AND A WAY TO CONTEST IT** | A manager acting on an **uncontested** figure | *"**Contestability is what makes performance data legitimate**"* — and *"The correction, if any, happens in a conversation."* *"A technician penalised by a data model defect has no way to see or contest it"* |
| **His own technician status** | | *"If the status is stale (left at `on_job` overnight), **he is scored as occupied all the next day with no way to notice**"* |
| **His own goal, without reading anyone else's** | | The `performanceGoalSubject` Role **exists for exactly this** and has **no corpus activity and ZERO OCCUPANCY even in the synthetic roster** |
| **Nothing at all about a peer's pay, rate or margin** | | **And today the absence of field-level visibility FAILS IN THE PERMISSIVE DIRECTION** |

> **THE ASYMMETRY THAT MUST BE STATED TO THE OWNER. Every manager-only boundary in §7.1 is currently
> enforced by WHAT HAPPENS TO BE SWITCHED OFF, not by a visibility model. When the commercial
> capabilities are activated — THE CHEAPEST CHANGE IN THE PROGRAMME — THE BOUNDARIES OPEN BEFORE THE
> MECHANISMS THAT SHOULD GOVERN THEM EXIST.** → `OD-14`

### 7.3 The manager surface must be a DIFFERENT surface, not a wider one

| Requirement | Evidence |
|---|---|
| A manager's surface is composed from **different questions**, not from an individual's surface with a bigger scope | **The ONLY role-conditional composition in the built dashboard is *"technicians get their own surface, everyone else gets the shared one"*** — **i.e. EOS today has exactly ONE manager/individual split and it is DEVICE-SHAPED, not role-shaped** |
| The composition may **NOT mint its own permissions** | Decision #161 Rule 1: *"A dashboard COMPOSES authority. It is never a second permission layer."* **Verified: ZERO `dashboard.*` ids exist in either catalog mirror** |
| Personalization inputs are a **closed set, and never a persona name** | Rule 1a |
| Actual and target must share a measurement basis; **never BOOKED actual vs BILLED goal** | Rule 3 |
| **A rate rolls up as `sum(numerator)/sum(denominator)`, NEVER `average(per-employee percentages)`** | Rule 8 — **the single most common manager-dashboard arithmetic error** |
| Cross-entity sums must type as **`UNELIMINATED_SUM`** | Rule 8 |
| **An action a manager surface offers must be an action that EXISTS** | Rule 10 |

> **ADOPT DECISION #161's TEN RULES AS THE MANAGER-EXPERIENCE CONTRACT.** They are already
> Owner-accepted, already live-verified, **and EMP-EXPERIENCE found nothing in the corpus that
> contradicts them.**

### 7.4 The exception queues managers need, and their state

| # | The manager's weekly question | Activity | State |
|---|---|---|---|
| 1 | Which Sales Orders are stuck, **and why** | `MGMT-033` | **PARTIAL** — **no stage times, so no "how long"**; *"'When did this order enter fulfilment?' has no answer anywhere"* |
| 2 | Which Opportunities closed WON and never became an order | `MGMT-034` | PARTIAL |
| 3 | Which fulfilled orders were never invoiced (**revenue leakage**) | `MGMT-035` | PARTIAL |
| 4 | Which invoices are open past terms | `MGMT-036` | **BLOCKED** |
| 5 | Which Work Orders don't tie to their Sales Order quantities | `MGMT-037` | `IMPLEMENTED_UNEXECUTED` |
| 6 | **Which customers have NO ACCOUNT OWNER** | `MGMT-038` | **EXECUTED_FAIL** — *"the most consequential exception in the CRM domain and the hardest to see"* |
| 7 | Which records have no resolvable owner at all | `MGMT-029` | `IMPLEMENTED_UNEXECUTED` (**an ownership census exists as a script**) |

> **SIX OF SEVEN ARE EXCEPTION QUEUES OVER THE COMMERCIAL SPINE, AND THE COMMERCIAL SPINE IS OFF. A
> manager experience built on these seven is a manager experience that shows SEVEN HONEST REFUSALS
> TODAY.**

---

## 8. WHERE THE CORPUS AND THE ARCHAEOLOGY DISAGREE

**Recorded, both sides, per the lane standard.** (EMP-WORK §7 — and see conflicts **W-6**, **W-7**,
**W-8**.)

| Subject | Corpus says | Archaeology says | Disposition |
|---|---|---|---|
| **Blocked-time overlap** | `P3B1-S05-A02`, `behaviourClaim: DESIRED` — an Owner ruling *"ACCEPTED — overlapping blocked-time facts are legitimate and unavailable time is their UNION"*, **postdating the shipped behaviour** | §4.1 — *"Tonight's Owner ruling overturns shipped code — **and the shipped fix was applied in the wrong place**"* | **BOTH RECORDED.** The corpus captures the intended end state; the archaeology captures that the code disagrees **and was patched in the wrong layer.** And `P3B1-S05-A10`: *"removing the overlap refusal (as the Owner ruling requires) would expose"* a further defect |
| **Technician truck handoff** | `S30-A02`/`S23-A07` treat truck receipt as workable | Pt 12.13 — *"resolved by creating `inventoryTransferReceiver`… **but the design record still describes it as open in three places**"* | **BOTH RECORDED. Resolved in code, stale in three design documents** — the same failure shape as the stale matrix row |
| **Device coverage tags** | P3-B1 `counts.byCoverageCategory` now reports DESKTOP 212 / MOBILE 118 | The P3-B1 `corrections` block records that the brief which fed it **also named three P3-B2 rows for the same fix, and those remain UNFIXED** | **RECORDED.** P3-B2's un-namespaced ids were mistaken for P3-B1 ids by an upstream brief; **three P3-B2 rows are still inconsistent and were not fixed here** |
| **Reorder gating by legacy role string** | A passed-on claim: the contextual assistant bypasses the capability catalog | §8.3 — **measured FALSE for the assistant** (`assistantStarters.ts:57-58` gates on capability ids), **TRUE for the UI control** (`RequestReorderControl.jsx:65-67` gates on `role === ROLES.ADMIN`). *"The assistant's real defect is different and larger: **it is wired to nothing**"* | **THE ARCHAEOLOGY IS CORRECT AND SHARPER.** EMP-WORK cites this *"as the model for how to state such a claim"* — **split a passed-on claim into the false part and the true part, and name the larger defect the original concealed** |

---

## 9. WHAT THIS DOCUMENT DOES NOT CLAIM

| # | Limit |
|---|---|
| 1 | **Every behaviour in P3-B1 and P3-B2 — all 660 activities — is UNPROVEN.** Both libraries are 100% `NOT_RUN` |
| 2 | **All 308 unexecuted P3-B3 rows are UNPROVEN** (`IMPLEMENTED_UNEXECUTED` 141 · `PARTIAL` 68 · `BLOCKED` 64 · `NOT_SUPPORTED` 26 · `DESIGNED_ONLY` 9) |
| 3 | **22 of the 118 output lines on the 42 executed rows are `INFERRED`** — *"no committed transcript or script emits or entails the line"* — and 6 more are `TRACED`, not executed |
| 4 | **Every §6 out-of-EOS claim is an AUTHORED NARRATIVE ASSERTION, not an observed practice. THE SINGLE LARGEST UNPROVEN IN THE LANE, and it bears directly on its highest-value finding** |
| 5 | **Every §3.1 / §6 handoff-loss claim, for the same reason** |
| 6 | **The real-job unification in §1 is this lane's INFERENCE.** *"No artifact in the corpus asserts it"* |
| 7 | **The module-crossing counts in §2 rest on the registry's `domain` and `actors` fields**, which are `TRACED` (52 of 86) or `EXECUTED` (34). **Domain assignment is the registry author's classification** |
| 8 | **The §3.1 interruption table is 65% coverage at best** — 660 of 1,010 rows |
| 9 | **Whether the `firestore.rules` blocks for `technician_working_availability` / `technician_blocked_time` are live in production** — **no production contact was made by any lane** |
| 10 | **Which technician composition real technicians actually see** (`TechnicianShell` vs `FieldMode`) |
| 11 | **Parts consumption on a cancelled Work Order** — *"whether it reverses, stands, or is orphaned — is UNPROVEN and is worth executing."* **This sits directly on the cancel-and-recreate path that is the ONLY available technician handoff** |
| 12 | **Whether anything escalates a refused sync intent** |
| 13 | **Every emulator-gated suite.** Firestore-emulator suites hang in this environment (port 8080 occupied), so **none was run by any lane** |
| 14 | **The three P3-B2 rows with contradictory device coverage tags remain UNFIXED** and were not fixed here |
