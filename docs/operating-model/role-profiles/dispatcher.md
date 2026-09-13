# ROLE PROFILE — DISPATCHER

**OBSERVED AT: 64008d5a** · **IMPLEMENTATION STATUS: NOT AUTHORIZED**
Sources: EMP-WORK §2.2 · EMP-INFORMATION §7.3 · EMP-EXPERIENCE §3.2/§4 · EMP-ROLE §5 ·
EMP-PERFORMANCE §7.

> **The Dispatcher and the Service Coordinator are TWO ROLES, not one. Four lanes concur (conflict
> `R-4`) — 68 vs 61 activities, DISJOINT personas, ASYMMETRIC authorization, different commitment
> authority and different terminal escalation. *"The person talking to the customer and the person who
> can see the schedule are two people."* MERGING THEM WOULD ERASE THE SINGLE MOST CONSEQUENTIAL HANDOFF
> IN THE CORPUS.**

---

## 1. Identity

| Dimension | Value |
|---|---|
| **Corpus activities** | **97** — `dispatcher` 61 (B1) · `Dispatcher` 27 (B2) · `Dispatcher` 9 (B3) |
| **Libraries spanned** | **3**, under **two spellings**, with **nothing joining the three views** |
| **Security Role** | **`dispatcher` — a COMPATIBILITY Role.** **There is no governed Role named `dispatcher`**; the nearest governed Role is `officeManager` |
| **Org-tree placement** | **under `fieldManager`, ABOVE `technician`** — and that placement is what distinguishes the role from the Coordinator |
| **Personas** | Dale Brackett (Taylor) · Brett Hollins (Ventana) — **zero overlap with the Coordinator's personas** |
| **Device** | DESKTOP |
| **Modules crossed** | **6** — Service · Scheduling · Equipment · CRM · Sales · Cross-domain |
| **Workflows / finishable** | **19 / 53% — the second-highest finishable rate of any job** (10 WORKS_WITH_GAPS · 8 BROKEN_MIDWAY · 1 CANNOT_START) |

---

## 2. The eleven role dimensions

| Dimension | Evidence | Provenance |
|---|---|---|
| **PURPOSE** | **Own and defend the board.** Commit a named technician to a named job, and absorb the day's changes | **INFERRED from observed work** |
| **RESPONSIBILITIES** | MarkReady · Dispatch · Unschedule · Reschedule · Cancel · record blocked time · approve reorder requests | **KNOWN** |
| **ACCOUNTABILITIES** | **NONE MODELLED.** *"The dispatcher has acted; the technician has not agreed; **no field records who holds the outcome in between**"* | **KNOWN (the absence)** — ORPHAN-2 |
| **DECISION AUTHORITY** | **The widest operational authority in EOS.** All dispatcher-held transitions are `requiresOwnAssignment: false`, so **she can act on any technician's Work Order — and that is ROLE AUTHORITY, not escalation and not an ownership transfer** (`AS-3`). **She also holds reorder approve/reject/cancel, WHICH THE PARTS MANAGER DOES NOT** | **KNOWN** |
| **NORMAL DAILY WORK** | Build tomorrow on the board; place work against capacity; cover absence | **KNOWN** |
| **RECURRING WORK** | **7 `END_OF_DAY`** including the board handoff. 0 `END_OF_MONTH` | **KNOWN** |
| **EXCEPTION WORK** | **30 `EXCEPTION` — THE HIGHEST COUNT OF ANY JOB.** 8 `MISTAKE` · 7 `RECOVERY` · 9 `CROSS_COMPANY` · 6 `PERMISSION_DENIAL` | **KNOWN** |
| **CROSS-DEPARTMENT** | **13 `HANDOFF`-tagged — the most of any job** | **KNOWN** |
| **MANAGEMENT / ESCALATION** | **Receives escalation from Coordinator, Technician, Parts Associate and Purchasing Admin. ESCALATES TO: NOBODY NAMED IN THE CORPUS. The dispatcher is the TERMINAL operational escalation point and the corpus records no path above them** | **KNOWN** |
| **PROFICIENCY EXPECTATIONS** | **NOTHING** — and **she cannot avoid assigning an uncertified technician: the recommendation engine reads no skill or certification data** | **KNOWN (the absence)** — `OD-12` |
| **SUCCESS OUTCOMES** | **NONE STATED.** The four metrics over her work are all **PROCESS HEALTH at `FIRM` scope — they CANNOT be pointed at her even if someone wanted to** | **KNOWN** |

---

## 3. Work facets

| Facet | Content |
|---|---|
| **WORK ARRIVING** | Work Orders marked ready by coordinators; **technician phone calls**; reorder requests for review; PM campaign rows |
| **TRIGGERS** | The Ready-to-Schedule queue; a customer closes for a burst pipe; **a technician phones from a locked door**; a technician goes home sick at 11:00 **with four jobs outstanding**; a reorder request needing approval |
| **DAILY QUESTIONS** | *Who is available and who is on PTO? What is ready to schedule? Which dispatched job has not been accepted? **What changed on the board since I last looked?** Who is covering the sick technician's four outstanding jobs?* |
| **INFORMATION NEEDED** | Technician availability **including PTO** (*"the recommendation that does not know about PTO"*); **what the morning dispatcher did**; whether a dispatched job was accepted |
| **DECISIONS** | Placement against blocked time — *"the board surfaces the collision; a person decides"* (**nothing surfaces it**); whether to cancel-and-recreate or leave a job and phone the customer; approve/reject a reorder |
| **HANDOFFS OUT** | To Technician (**Dispatch sets `assignedTechId` — until then the Work Order carries none at all**); **to the evening dispatcher**; to Parts Manager on reorder approval |
| **RECOVERY** | **Reassigning an in-progress job is NOT EXPRESSIBLE**: *"Dale tells Javier verbally and the record stays on Curtis."* Cancel-and-recreate *"loses the arrivedAt, workStartedAt and three hours of execution data"* |
| **WORK HELD OUTSIDE EOS** | **THE ENTIRE SHIFT HANDOFF** (*"Every in-flight decision — who was phoned, which customer was promised what — is verbal"*) · *"The dispatcher's working memory of the morning is gone"* · special handling (*"Dale remembers, or he does not"*) · mid-day reassignment (verbal) · sick cover (*"the dispatcher leaves them and phones the customers"*) · technician ids from *"a stale technician id from a spreadsheet"* |

---

## 4. Information model

| DIM | REQUIREMENT | KNOWABLE |
|---|---|---|
| **SHOW** | Today's board with **every number linked and carrying an exception count** | **PARTIAL AND TWO ARE WRONG.** *"Technicians on shift"* is computed over `technicians.length` **and INCLUDES `OFF_SHIFT`**; and **no windowed *"completed this week"* read exists anywhere in Service**, so the label was **honestly downgraded to "Completed"** |
| **SHOW** | Per-lane `% booked` and fleet `% booked` | **PARTIAL AND ONE IS WRONG.** `blockedMinutesInBand` **SUMs clipped durations** while `availabilityModel` **UNIONs minutes**, so **two identical 8-hour PTO records draw SIXTEEN HOURS BLOCKED ON AN EIGHT-HOUR LANE.** Fleet % renders **only when every technician has a recorded schedule — *"in practice means never"*** |
| **ATTENTION** | **Blocked-time collisions** against placed work; dispatches unaccepted past a threshold; Work Orders ready but **missing address or equipment** | **MISSING.** *"the board surfaces the collision; a person decides"* — **nothing surfaces it** |
| **ATTENTION** | The at-risk count, **with severity, age AND WHY** | **PARTIAL** — `detectStalledJobs` returns **only HIGH and CRITICAL**, and a Work Order with an unusable `createdAt` **is dropped from the At-risk table entirely.** *"The Work Order the system knows least about is the one it shows least"* |
| **EXPLAIN** | Why a recommendation ranked as it did, **and whether the reason accounts for PTO** | **PARTIAL AND MISLEADING.** The engine *"projects reason sentences and the board renders them"* — but afterwards *"**The manager cannot distinguish 'the dispatcher ignored the score' from 'the score was wrong'**"* |
| **WARN** | Overlap is **REFUSED**; shift overrun is **WARNED, never refused** — *"75 minutes of this placement fall outside the technician's working hours"* | **AVAILABLE NOW (partial). THE DISTINCTION IS CORRECT AND MUST BE PRESERVED: *"Outside hours is a warning, never a refusal"*** |
| **WARN** | The colliding Work Order **BY NAME** in the dialog — *"must name the colliding Work Order, not merely say 'conflict'"* — **and even when that technician is filtered out of view** | **AVAILABLE NOW (partial)** |
| **RECOMMEND** | A ranked technician recommendation **with its reason sentence**, non-binding, computed on read, never persisted, **and deviations recorded** | **AVAILABLE NOW as a design idiom** — but *"this customer has banned this technician"* **has no home in the model at all** |
| **ESCALATION** | Who covers when she cannot | **MISSING — SHE IS THE TERMINAL POINT** |

---

## 5. Experience requirements

| ID | Trigger | Requirement | State |
|---|---|---|---|
| **EXP-004** | Opens the board at 07:55 to build tomorrow | Ready-to-schedule demand **AND** technician capacity **AND** blocked time, **in one read, for the date being built** | **AVAILABLE NOW (partial).** *"Three panes: queue, lane grid, technician pane."* **But** a technician with unrecorded hours *"draws a lane that cannot honestly be shaded"*, and **the warning must read *"we do not know"*, never *"outside hours"*** |
| **EXP-005** | Same moment, **having inherited the board** | **What the previous shift did to it** | **MISSING — MODEL.** The activity feed is **SESSION-ONLY**: *"the incoming dispatcher's feed is empty. **There is no shift-note or handover surface**"* |
| **EXP-015** | Reviewing open work at 17:20 | *"Still open"* as a **first-class filter** | **PARTIAL** — terminal statuses are `COMPLETED`/`CLOSED`/`CANCELLED`, so *"'still open' is everything else — a filter the surfaces should support directly"* |
| **EXP-016** | A job sat in `DISPATCHED` since 09:40 | **TIME-IN-STATUS, not just status** | **UNKNOWN — REVERIFY.** *"`dispatchedAt` makes the age computable; **whether any surface shows time-in-status is UNPROVEN**."* The cost is named: *"A job left in DISPATCHED overnight **silently blocks that technician's first dispatch tomorrow**"* |
| **EXP-036** | Choosing a technician | A ranked recommendation with its reason, **PTO-aware** | **PARTIAL AND MISLEADING** |
| **EXP-045** | Technician goes home sick at 11:00 with four jobs outstanding | **That four jobs need redistributing, AND A VERB TO DO IT** | **MISSING — WORKFLOW.** *"In practice the dispatcher leaves them and phones the customers"* → `OD-13` |
| **EXP-043** | Shift change at 17:30 | The day's context | **MISSING — MODEL** |
| **EXP-095** | 17:20 | **Every non-terminal Work Order, and which will BLOCK TOMORROW** | **PARTIAL.** *"A technician with two overnight jobs and a full tomorrow **looks free tomorrow**"* |
| **EXP-096** | Jobs legitimately running past 17:30 | That this is **normal** — *"The board simply reflects reality, which is correct"* — and that ***"Nothing sweeps or prompts"*** | **PARTIAL** |
| **EXP-024** | A placement collides | The colliding WO by name, in the dialog | **AVAILABLE NOW (partial)** |

---

## 6. Performance — what may and may not be measured

| Metric | Axis | Attribution | Verdict |
|---|---|---|---|
| `service.workOrder.readyToSchedule.count` | **PROCESS HEALTH** | **PROCESS, `FIRM` only** | **MEASURABLE** — over `SCHEDULABLE_STATUS`, *"derived from the transition table rather than listed"* |
| `service.workOrder.schedulingConflict.count` | **EXCEPTION RATE** | **PROCESS, `FIRM` only** | **MEASURABLE** — via `detectDayOverlaps()`, *"the same primitives the scheduling workspace uses"* |
| `service.workOrder.pastDue.count` | **PROCESS HEALTH** | **PROCESS, `FIRM` only — CANNOT be pointed at a person** | **MEASURABLE** — applied **GLOBALLY**, not week-bound |
| `service.workOrder.partsBlocked.count` | **PROCESS HEALTH** | **PROCESS** | **MEASURABLE**, and **the honest form**: *"NO_PLAN is never surfaced… and UNKNOWN readiness is never escalated."* **The RATE version is a GAP — *"UNKNOWN is INFECTIOUS in the ATP computation… a rate over a population containing one unknown part is ITSELF UNKNOWN, not merely smaller"*** |
| Time-in-backlog (`READY_TO_DISPATCH → SCHEDULED`) | TIMELINESS | PROCESS | **GAP.** *"Neither MarkReady nor Schedule records WHEN IT HAPPENED, so time-in-backlog — **the measure of whether dispatch is coping** — has no anchor on the Work Order record."* Confirmed: `ACTION_TIMESTAMP_FIELD` **omits MarkReady, Schedule and Unschedule** |
| Per-technician `% booked` | **CAPACITY** | **RESOURCE, never a person** | **MEASURABLE — and it must NEVER be relabelled utilisation.** Two guards are **mandatory**: unrecorded availability renders *"no working schedule recorded"*, **never 0%**; and **a data-coverage worklist of technicians with no recorded hours is a PREREQUISITE, because *"Every capacity number is wrong until this list is empty"*** — and whether such a list exists is **UNPROVEN** |

> **Four of the Dispatcher's metrics are ACTIVE, and ALL FOUR are registered at `FIRM` scope only — so
> a past-due count CANNOT BE POINTED AT HER EVEN IF SOMEONE WANTED TO. That is the eight-axis discipline
> ENFORCED IN CODE rather than asserted in prose.**

---

## 7. What can go wrong, and why nothing catches it

| # | Failure |
|---|---|
| 1 | **She dispatches to an id that does not match the technician's own `technicianId`** — and the job is *"**invisible to everyone except admins and dispatchers**"* |
| 2 | **She dispatches a Work Order with no address** — *"Marking ready with no equipment and no address is possible; readiness is not validated against completeness"* |
| 3 | **A technician goes sick and she cannot move the work.** *"None of the four can be reassigned. **All four must be cancelled and recreated.**"* And **each orphan permanently consumes that technician's dispatch capacity** |
| 4 | **She hands over at 17:30 and every in-flight decision is lost** — the feed is session-only |
| 5 | **She places against a lane whose blocked time is DOUBLE-COUNTED** (16 hours on an 8-hour lane) |
| 6 | **She assigns an uncertified technician and *"nothing warns"*** — and neither the recommender, the scheduler nor the transition engine reads competence |
| 7 | **She is the terminal escalation point and has nobody to escalate to** — *"the corpus records no path above them"* |
| 8 | **Her reorder approval is IRREVERSIBLE** — *"An approval cannot be undone"* — and *"if it lands nowhere visible it simply waits"* |
