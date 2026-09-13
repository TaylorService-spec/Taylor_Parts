# ROLE PROFILE — SERVICE COORDINATOR

**OBSERVED AT: 64008d5a** · **IMPLEMENTATION STATUS: NOT AUTHORIZED**
Sources: EMP-WORK §2.1 · EMP-INFORMATION §7.4/§7.7 · EMP-EXPERIENCE §3.2/§4 · EMP-ROLE §5/§6.1 ·
EMP-PERFORMANCE §7.

> **THE LARGEST SINGLE ROLE GAP IN THE CORPUS: 68 activities of observed work with NO SECURITY ROLE AT
> ALL.** The Coordinator *"exists in no role vocabulary"* and is identified by **`jobTitle` free text
> only.**

> **Includes the AFTER-HOURS COORDINATOR (5 activities, Ken Iwata, `defaultDeviceContext: MOBILE`).
> EMP-WORK flags that grouping as *"THIS LANE'S INFERENCE, NOT A CORPUS FACT"* — the persona is
> disjoint and both day coordinators are DESKTOP. Whether Ken is a coordinator on a rota or a distinct
> job is `OD-3b`.**

---

## 1. Identity

| Dimension | Value |
|---|---|
| **Corpus activities** | **73** — `service_coordinator` 68 · `after_hours_coordinator` 5 |
| **Libraries spanned** | **1 (B1 only)** |
| **Security Role** | **NONE. The largest such gap in the corpus.** `serviceCoordinator` **exists in no role vocabulary**; the nearest governed Role is `officeManager` (*"Office/customer/service coordination"*) |
| **Identified by** | **`employees/{id}.jobTitle` — FREE TEXT. Nothing consumes it** |
| **Org-tree placement** | **UNPLACED** |
| **Personas** | **Marisol Vega (Taylor) · Rosa Delgado (Ventana)** — **and Marisol Vega is ALSO `Parts Manager` in B2 (conflict `R-1`, RECORDED NOT RESOLVED)** |
| **Device** | DESKTOP (the after-hours coordinator: **MOBILE**) |
| **Workflows / finishable** | 10 / **30%** (3 WORKS_WITH_GAPS · 5 BROKEN_MIDWAY · 1 CANNOT_START · 1 NO_IMPLEMENTATION) |

### 1.1 Why this is a SEPARATE role from the Dispatcher — conflict `R-4`, closed by four lanes

**On exactly the dimensions the Owner's own Retail-vs-National-Accounts ruling turns on:**

| Dimension | Service Coordinator | Dispatcher | Disjoint? |
|---|---|---|---|
| Activities | **68** | **61** | — |
| Personas | Marisol Vega, Rosa Delgado | Dale Brackett, Brett Hollins | **YES — zero overlap** |
| Governed security Role | **NONE** | **YES**, and a place in the org tree **above technicians** | **YES** |
| **Commitment authority** | **CANNOT MarkReady, CANNOT Dispatch** | **Both** | **YES** |
| `HANDOFF`-tagged activities | 9 | 13 | — |
| **Terminal escalation** | **Escalates TO the Dispatcher** | **Escalates to NOBODY NAMED** | **YES** |

> **THE FUNCTIONAL SPLIT IS THE POINT:** *"**The person talking to the customer and the person who can
> see the schedule are two people.**"* **Merging them would erase the single most consequential handoff
> in the corpus.** The brief's own rule forbids the merge **and the brief itself made it** (EMP-ROLE
> C-2, rated HIGH — that lane **withdrew its own merge as a violation of its rule**).

---

## 2. The eleven role dimensions

| Dimension | Evidence | Provenance |
|---|---|---|
| **PURPOSE** | **The customer-promise desk.** Takes demand in by email and phone and turns it into a Work Order | **INFERRED from observed work** |
| **RESPONSIBILITIES** | Decide which overnight email is real service demand; create Work Orders from phone calls; link equipment and location; **tell the customer when someone is coming**; hand undecided rows on | **KNOWN** |
| **ACCOUNTABILITIES** | **NONE MODELLED — and this is the role where the absence costs most.** She is accountable for **the customer promise, which *"lives outside EOS"* and has no record at all** | **KNOWN (the absence)** — `OD-1`, `OD-11`(promise) |
| **DECISION AUTHORITY** | Accept / decline / quarantine each inbound row; which of two matching accounts owns an ambiguous sender; **whether to promise a time WITHOUT SEEING CAPACITY.** **She CANNOT MarkReady and CANNOT Dispatch — and she cannot cancel her own two-minute-old mistake** | **KNOWN** |
| **NORMAL DAILY WORK** | Clear the inbound queue **before dispatch builds the day**; the quarterly PM campaign over 62 convenience stores | **KNOWN** |
| **RECURRING WORK** | 3 `END_OF_DAY`; the quarterly PM campaign | **KNOWN** |
| **EXCEPTION WORK** | **19 `MISSING_DATA` · 13 `CROSS_COMPANY` · 9 `EXCEPTION` · 8 `PERMISSION_DENIAL` · 6 `AFTER_HOURS` · 4 `BACK_BUTTON_ABANDONED_FLOW` · 4 `RECOVERY`** | **KNOWN** |
| **CROSS-DEPARTMENT** | **9 `HANDOFF`-tagged.** Out: to Dispatcher for MarkReady and Dispatch; to the afternoon coordinator; to Billing. In: **from the night coordinator** | **KNOWN** |
| **MANAGEMENT / ESCALATION** | **To the Dispatcher for anything commitment-shaped — AND AFTER 17:30 THERE IS NOBODY.** *"At 17:30 when the dispatcher has gone home, **the coordinator taking an emergency call cannot dispatch anybody**."* The after-hours coordinator *"**phones a dispatcher at home**"* | **KNOWN** |
| **PROFICIENCY EXPECTATIONS** | **NOTHING** | **KNOWN (the absence)** |
| **SUCCESS OUTCOMES** | **NONE STATED.** The one measurable thing over her work — `service.workOrder.pastDue.count` — is **PROCESS HEALTH at `FIRM` scope and CANNOT be pointed at her** | **KNOWN** |

---

## 3. Work facets

| Facet | Content |
|---|---|
| **WORK ARRIVING** | **11 `inbound_work_requests` — 8 `AWAITING_DECISION`, 2 `NEEDS_REVIEW`, 1 `QUARANTINED`**; phone calls; **the night coordinator's note and voicemail** |
| **TRIGGERS** | The inbound transport polls and stages weekend messages; **a customer phones**; an after-hours emergency at 22:40; a PM campaign planning morning |
| **DAILY QUESTIONS** | *What came in overnight and **is any of it an emergency**? Which account does this sender belong to? **Is there capacity before I promise a time?** **Did the transport actually poll, or is the queue empty because it is broken?*** |
| **INTERRUPTIONS** | **4 `BACK_BUTTON_ABANDONED_FLOW`, 6 `AFTER_HOURS`.** Starts an accept, opens the candidate picker, abandons it — *"**the queue has no in-progress state between decidable and decided… nothing records that she looked at it and could not decide, so the next coordinator starts from zero**"*. **Sessions expire while coordinators are on the phone** |
| **INFORMATION NEEDED** | **The last successful poll time** (*"the screen must say when it last successfully polled, not just show zero rows"*) · **which rows a colleague is already chasing** · open capacity · the difference between `AWAITING_DECISION` and `NEEDS_REVIEW` (*"'same queue, louder' is **in the code comment and nowhere on screen**"*) |
| **ACTIONS** | Accept → creates Work Order; decline; quarantine; **attach a follow-up email to the existing WO rather than raising a second**; create WO by hand; cancel own error |
| **RECOVERY** | *"**There is no in-product way to renumber a Work Order**."* And **a coordinator without the dispatcher role CANNOT CANCEL HER OWN TWO-MINUTE-OLD MISTAKE and must ask a dispatcher** |
| **WORK HELD OUTSIDE EOS — 8 named instances, more than any other role** | **THE PROMISE TO THE CUSTOMER** (*"The coordinator picks up the phone. **The promise lives outside EOS**"*; *"She promises 'this afternoon' and hopes"*) · **the night's decisions** (*"Ken's decisions, the customer conversation and the reason a night crew was or was not called **live nowhere**"*) · after-hours intake on **paper** (*"the emergency has no record for nine hours"*) · **the Taylor/Ventana PM split in a spreadsheet** · PM due dates in a spreadsheet · customer-specific handling (*"She explains it verbally every time"*) · follow-up commitments (*"**If nobody remembers, the customer phones in week three**"*) · equipment provenance (*"She checks the sales paperwork"*) |

---

## 4. Information model

| DIM | REQUIREMENT | KNOWABLE |
|---|---|---|
| **SHOW** | The decided/undecided split of the overnight queue, **ordered by urgency**, with **each row's account resolved** | **PARTIAL** — the queue reads; **but `service.inboundWork.read` is `active:false`, so the queue DENIES EVERY PRINCIPAL** |
| **SHOW** | **When the transport last successfully polled** | **MISSING.** *"If the transport has not polled, the queue is empty **and indistinguishable from 'no weekend demand'**"* |
| **SHOW** | **Which rows someone is already chasing** | **MISSING — MODEL.** *"With no owner field, the afternoon coordinator cannot tell a row nobody has looked at from one someone is actively chasing"* |
| **ATTENTION** | **Any overnight request whose CONTENT is an emergency** | **MISSING.** *"An emergency emailed at 18:30 waits until 06:40, and **nothing escalates it regardless of content**"*; and *"The queue does not distinguish 'arrived while you were here' from 'arrived after hours'"* |
| **ATTENTION** | Anything **promised to a customer that no Work Order yet carries** | **MISSING — there is no promise object** → `OD-11`(promise) |
| **SEARCH** | Answer from **one place while the customer is on the line** | **PARTIAL — *"the PUREST 'never hunt through six modules' case in the corpus"*** (`P3B1-S30`: *"The phone-call day — what a coordinator can find while a customer waits"*). **13 lookups — the highest of any role** |
| **EXPLAIN** | Why an accept refused; **which of two matching accounts owns an ambiguous sender**; the difference between the two queue statuses | **PARTIAL/MISSING** |
| **ACCOUNTABLE** | The inbound rows she has decided vs not; **customers she has promised a callback** | **MISSING** |
| **ESCALATION** | Who covers after 17:30 | **MISSING.** And **`ACTION_PERMISSIONS` has NO time-of-day or on-call dimension** → `OD-28` |
| **RECOMMEND** | **CLASSIFY — triage of inbound work.** Concentrated here (10 of the 16 service `CLASSIFY` rows). *"AI's value is classification/triage, **not execution**"* | **PARTIAL** — the queue exists; **the assistant is *"wired to nothing"* — `functions/src/index.ts` contains NO assistant export** |
| **WARN** | Crossing an operating-company boundary — **by name, before commit** (a Ventana customer calls the Taylor number) | **MISSING for the WO itself — there is *"no 'move this WO to the other company'"*** |

---

## 5. Experience requirements

| ID | Trigger | Requirement | State |
|---|---|---|---|
| **EXP-006** | **06:40 Monday, the weekend email pile** | How many inbound requests are decidable, **AND WHEN THE TRANSPORT LAST SUCCESSFULLY POLLED** | **PARTIAL — ENGINEERING** |
| **EXP-007** | Same | **Which rows someone is ALREADY CHASING** | **MISSING — MODEL** |
| **EXP-031** | Linking equipment to a new WO | **Which of four identical `C712`s at four sister stores this is** | **PARTIAL, AND DANGEROUS.** *"Picking the sister store's C712 produces a Work Order that **looks complete** and sends a technician to the right address to service **the wrong serial**"* |
| **EXP-032** | Reading a machine's history | **Which COMPANY serviced it each time** | **MISSING — MODEL.** *"A coordinator answering 'who serviced this last?' cannot answer '**under which company?**' from the record"* |
| **EXP-080** | Phone-call day, customer waiting | Answer from one place | **PARTIAL** |
| **EXP-097** | Leaving at 17:30 | **Which requests arrived AFTER HOURS, and which are emergencies** | **MISSING — MODEL** |
| **EXP-044** | 06:45 the next morning | What happened overnight | **MISSING — WORKFLOW.** *"She reads the note and phones Ken"* |

---

## 6. Performance — and why almost nothing is measurable

| Metric | Axis | Attribution | Verdict |
|---|---|---|---|
| **Overdue work** | **PROCESS HEALTH** | **PROCESS — `FIRM` scope only, CANNOT be pointed at a person** | **MEASURABLE** — `service.workOrder.pastDue.count` ACTIVE, applied **globally**; `scheduledStart` is the only date authority **and exists only once scheduled** |
| **Responsibility gaps** | **PROCESS HEALTH** | **PROCESS — EXPLICITLY NOT A PERSON** | **MEASURABLE as a corpus/design signal; NOT as a production metric.** And **the corpus `scores` field SCORES THE PRODUCT SURFACE, NEVER A PERSON** — all 11 keys are boolean assertions about the screen and the flow. ***"The only thing in the 1,010-record evidence corpus called a 'score' is a score of EOS, not of a person. A synthesiser must not promote it"*** |
| Coordination throughput | WORKLOAD | PERSON | **GAP — and note *"coordination throughput is NOT dispatch throughput"*, which is why the two roles must be measured separately** |
| Anything else | — | — | **GAP.** There is no governed follow-up-due or next-action-overdue fact; `obligationAttention.js` *"states by name that it does not invent SLA, risk score, customer promise, severity or ETA"* |

---

## 7. What can go wrong, and why nothing catches it

| # | Failure |
|---|---|
| 1 | **She promises a time she cannot see capacity for, and the promise has no record.** If nobody calls, *"**a technician arrives at a locked convention centre**"* |
| 2 | **An 18:30 emergency waits until 06:40.** *"nothing escalates it **regardless of content**"* |
| 3 | **After 17:30 she cannot dispatch anybody.** The standing workaround is itself a defect: *"every on-call coordinator is permanently a dispatcher"* — *"**a standing over-grant created by an after-hours gap**"* |
| 4 | **A dead poller renders identically to a quiet weekend** |
| 5 | **She and her colleague both chase the same row, or neither does.** *"No ownership on an inbound row: two coordinators either both chase it or neither does"* |
| 6 | **She abandons a decision and nothing records that she looked** — *"the next coordinator starts from zero"* |
| 7 | **She cannot cancel her own two-minute-old mistake** and must ask a dispatcher — and there is **no way to renumber a Work Order** |
| 8 | **She links the wrong one of four identical machines**, producing a Work Order that *"looks complete"* |
| 9 | **A Ventana customer calls the Taylor number and there is no way to move the Work Order** |
| 10 | **The whole family is UNGOVERNED AND UNMEASURED: `inbound_work_requests` is absent from ALL 51 matrix families** — neither ownable, REFERENCE, nor EXCLUDED — *"and it is the FIRST OBJECT IN THE SERVICE CHAIN, precisely where accountability must begin"* → `OD-16` |
