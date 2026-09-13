# ROLE PROFILE — FIELD TECHNICIAN

**OBSERVED AT: 64008d5a** · **IMPLEMENTATION STATUS: NOT AUTHORIZED**
**Admitted under the four-part test in [`../EMPLOYEE-ROLE-MAP.md`](../EMPLOYEE-ROLE-MAP.md) §8.**
Sources: EMP-WORK §2.3 · EMP-INFORMATION §7.1–7.2 · EMP-EXPERIENCE §3.2/§4 · EMP-ROLE §5 ·
EMP-PERFORMANCE §4.

> **Includes the APPRENTICE (9 activities), who is *"indistinguishable from a journeyman"* in EOS. That
> merge is EOS's, not this profile's — whether it is an experience distinction is `OD-3b`/`OD-12`.**

---

## 1. Identity

| Dimension | Value |
|---|---|
| **Corpus activities** | **143** — `field_technician` 104 (B1) · `Field Technician` 26 (B2) · `apprentice_technician` 9 (B1) · `Technician` 4 (B3) |
| **Libraries spanned** | **3** — *"and no artifact in the corpus joins those three views of one person's day"* |
| **Security Role** | **`technician` — a COMPATIBILITY Role, not one of the 45 governed.** And **the technician surface routes on `role === "technician"` — a role STRING, not a capability** |
| **Identified by** | `users/{uid}.role` + **`users/{uid}.technicianId`** — *"the only per-person work anchor that exists"* |
| **`operationalRoles` value** | `TECHNICIAN` — **and it is between 0 and 1 consumers depending on the reading (conflict `E-3`)** |
| **Org-tree placement** | under `dispatcher` |
| **Device** | **MOBILE** (B1 technicians are MOBILE-only **even where they scan**; `HANDHELD_SCANNER` exists in B2 only) |
| **Modules crossed** | **8 — the most of any job, jointly with Operations Manager**: Service · Technician · Equipment · Inventory · Warehouse · Scanner · Reporting · Cross-domain |
| **Workflows / finishable** | 18 / **28%** (5 WORKS_WITH_GAPS · 8 BROKEN_MIDWAY · 4 CANNOT_START · 1 NO_IMPLEMENTATION) |

---

## 2. The eleven role dimensions

| Dimension | Evidence | Provenance |
|---|---|---|
| **PURPOSE** | Execute a committed service visit end to end: accept, travel, arrive, diagnose, record, consume parts, install, complete | **INFERRED from observed work** — *"No document states a purpose for any job role"* |
| **RESPONSIBILITIES** | Accept/Travel/Arrive/WorkStart/Complete; scan parts; dictate notes; receive truck transfers; find staged parts; load the truck; install equipment | **KNOWN** — corpus `title` + `objects_touched` + `action` |
| **ACCOUNTABILITIES** | **NONE MODELLED.** The Work Order is COMPANY-owned with `ownerFields: []`; `assignedTechId` is **deliberately not an ownerField** | **KNOWN (the absence)** — `OD-1` |
| **DECISION AUTHORITY** | `requiresOwnAssignment: true` on **all five** of his transitions — **he is the ONLY possible actor.** No approval authority of any kind | **KNOWN** — and see §5: correct as authorization, **a hard lock as accountability** |
| **NORMAL DAILY WORK** | The day's accepted jobs **in sequence — sequenced by the technician, not the system**: *"Curtis sequences by memory and local knowledge, **which is usually better than anything the data supports**"* | **KNOWN** |
| **RECURRING WORK** | 5 `END_OF_DAY`, 0 `END_OF_MONTH` — **this is not a calendar job** | **KNOWN** |
| **EXCEPTION WORK** | **33 `MISSING_DATA` · 24 `EXCEPTION` · 21 `BAD_DATA` · 15 `NETWORK_INTERRUPTION` (by far the highest of any job) · 19 `PERMISSION_DENIAL` · 11 `CROSS_COMPANY` · 11 `RECOVERY`** | **KNOWN — the corpus's strongest dimension for this role** |
| **CROSS-DEPARTMENT** | **14 `HANDOFF`-tagged.** Inventory custody → equipment custody at install: *"**Two authorities, one machine**"* | **KNOWN** |
| **MANAGEMENT / ESCALATION** | **Phones the Dispatcher. And CANNOT RECORD HIS OWN ABSENCE** — `createTechnicianBlockedTime` is admin/dispatcher only | **KNOWN** — escalation itself is **MODEL GAP** |
| **PROFICIENCY EXPECTATIONS** | **NOTHING AT ALL.** `P3B1-S17-A06`: completing a job requiring an unheld certification → *"WORK_IN_PROGRESS → COMPLETED. **Succeeds.**"* → ***"Nothing warns."*** **Three subsystems that should gate on competence read none of it** | **KNOWN (the absence)** — `OD-12` |
| **SUCCESS OUTCOMES** | **NONE STATED.** And the two person-attributed metrics available are **WORKLOAD / CUMULATIVE VOLUME, not performance** | **KNOWN (the absence)** — `OD-15` |

---

## 3. Work facets

| Facet | Content |
|---|---|
| **WORK ARRIVING** | Dispatched jobs — **readable ONLY where `assignedTechId` matches `callerTechnicianId()`**; truck transfers; staged put-away sessions |
| **TRIGGERS** | Dispatch sets `assignedTechId`; a transfer arrives on the truck at 07:05; a staged kit needed at 06:05; a manufacturer safety notice |
| **DAILY QUESTIONS** | *What is assigned to me? What machine am I going to and what is its history? Do I already have the part on the truck? Where did the parts desk stage my kit? What is still pending in my sync queue?* |
| **INTERRUPTIONS** | The dead zone; the gun in the freezer; the network in the parking lot. **15 `NETWORK_INTERRUPTION`, 5 `AFTER_HOURS`** |
| **DECISIONS** | Whether to work a job assigned to someone else **on a colleague's word**; whether to record a part off the truck via scan or dashboard; **whether to trust a register serial that is wrong** |
| **HANDOFFS IN** | From Dispatcher (*"until Dispatch runs, the Work Order carries **no `assignedTechId` at all**"*); from Parts Associate (staged kit) |
| **HANDOFFS OUT** | To Billing on Complete. **To another technician — IMPOSSIBLE.** `P3B1-S21` is titled *"**handing a job over: the transfer EOS cannot express**"* |
| **RECOVERY** | Taps Arrive by mistake on the freeway — *"the only recovery is a back-office correction outside the lifecycle, **and there is no such correction path in the technician's app**"*. A refused queued intent: *"her ninety minutes of work exist only as a refused intent. **There is no Work Order to attach them to**"* |
| **WORK HELD OUTSIDE EOS** | **LABOUR TIME** (*"captured outside EOS, on paper or in payroll, and the Work Order carries none"*) · route sequence (memory) · job content on an undocumented handover (*"Curtis reads it to him over the phone… **He works blind**"*) · serial corrections · warranty claims · finding staged parts · truck-to-truck transfers · restock intent · **and COMPETENCE, which has NO outside channel at all** |

---

## 4. Information model — what EOS must show, explain and warn

| DIM | REQUIREMENT | MODE | KNOWABLE | GAP |
|---|---|---|---|---|
| **SHOW** | Today's assigned Work Orders with address, equipment, fault, **and the exact on-hand of the part at THIS truck**, each figure stating its location and as-of time | unprompted | **PARTIAL** — jobs yes; **truck stock no**: the client availability derivation is **location-blind and company-blind**, has **no `WORK_ORDER_CONSUMPTION` term** (so *"consumed stock never leaves on-hand"*), **adds the static catalog `warehouseQty` on top of ledger movement**, and **omits 5 of 9 movement types** | ENGINEERING |
| **SEARCH** | This machine's service history **while standing in front of it**; a part by SKU/barcode; **resolve by scanning the serial plate, with manual entry as a fallback** (*"they are, on old machines, behind the panel and covered in mix"*) | on demand | **MISSING** — equipment reads are gated on `isAdminOrDispatcher()` and *"a technician is neither"*; **the exclusion is DELIBERATE AND DOCUMENTED** | AUTHORITY — `OD-37` |
| **ATTENTION** | A new dispatch; ***"your truck is marked out of service"***; unsent scans from a previous shift | unprompted | **PARTIAL** — *"'Your truck is marked out of service' is a sentence **the server already knows and does not send**"*; DESIRED: *"You have 4 unsent scans from 21:40"* | ENGINEERING |
| **ASSIGNED** | **Only his own jobs, and the boundary said out loud** | unprompted | **AVAILABLE NOW** — enforced in Rules; an unconstrained technician read is denied | — |
| **ACCOUNTABLE** | *"this visit's outcome is yours to close"* | unprompted | **MISSING** | MODEL — `OD-1` |
| **OWNED / APPROVAL** | Nothing — a technician owns no records and approves nothing | n/a | **NOT APPLICABLE** | — |
| **ESCALATION** | *"who holds warehouse authority at THIS location, right now"* on every refusal — verbatim DESIRED: *"Moving stock out of WH-PHX-MAIN requires warehouse authority you do not hold. Ask the parts desk"* | on demand | **MISSING** — requires occupancy, **and all four `inventory.transfer.*` are `active:false` and granted to no Role, so the honest sentence is "not active in this release", NOT "you lack it"** | MODEL — `OD-25` |
| **EXPLAIN** | Why a part number scanned as unknown (**`NOT_FOUND` distinct from `FAILED`, with the scanned text echoed**); why warranty status is nowhere; **why this job shows a company that is not mine** | on demand | **MISSING** — *"Nothing about warranty claim status appears"*; *"Nothing distinguishes this from her own company's work"* | ENGINEERING + MODEL |
| **RECOMMEND** | **Almost nothing.** Of 104 service-technician activities, **82 are `NONE`** and 4 are `NOISE`; only 3 DRAFT / 2 EXPLAIN / 13 SHORTEN | on demand | **AVAILABLE NOW AS A RULE: AI IS QUIET HERE.** *"A technician on a roof is the reader least able to audit a generated sentence"* | — |
| **WARN** | Before Complete: *"this job requires a certification you do not hold"* · before a cross-company part movement: **both companies by name** · before a second send of a queued batch: *"this line was already received at 09:14. **Nothing was added**"* | **pre-commit** | **MISSING** — *"Certification is not consulted anywhere… Nothing warns"* | MODEL — `OD-12` |

**And for the APPRENTICE specifically:** he must be able to see **whether his account is linked to a
technician record at all.** *"`callerTechnicianId()` returns null, every technician-scoped read is
denied, and the reader gets **an empty jobs list**."* DESIRED: distinguish *"you have no jobs today"*
from *"your account is not linked to a technician record"* — *"**the difference between a five-minute
fix and a lost morning**."* **The honest-state vocabulary already has `CAPABILITY_NOT_ENABLED` for
exactly this — and `modules/technician` does not import `HonestState`.**

---

## 5. Experience requirements

| ID | Trigger | What EOS must already know | State |
|---|---|---|---|
| **EXP-001** | Opens the phone at 06:50 before leaving the driveway | The whole day's dispatched jobs **IN THE ORDER HE WILL DRIVE THEM**, each with address, equipment, symptom and parts | **MISSING — MODEL.** *"Technicians have no location data in their records and the recommendation engine's territory component is flat for that reason, so **a route optimiser has nothing to work from**"* → `OD-38` |
| **EXP-002** | Same moment | That he intends to accept **ALL FOUR** jobs, not one | **MISSING — WORKFLOW.** *"Four taps. **There is no 'accept all.'**"* *"Technicians accept the whole day at once; the model assumes one at a time"* |
| **EXP-003** | Signs in and sees nothing | Whether the empty list means *no work today*, *your account is not linked*, or *this capability is off* | **AVAILABLE NOW — THE ONE START-OF-DAY REQUIREMENT EOS ALREADY SATISFIES, and it is load-bearing** |
| **EXP-021** | Mid-day | A queue of his **own** refused/queued sync intents, **distinguishing retryable from refused** | **AVAILABLE NOW (partial)** — *"whether anything escalates it is UNPROVEN"* |
| **EXP-026** | A job is cancelled while he drives | That it left his day, **and that it was CANCELLED rather than imagined** | **UNKNOWN — REVERIFY.** *"Silently vanishing is worse, because the technician wonders whether he imagined it"* |
| **EXP-051** | Store shut · wrong address · machine fine · customer refuses over an unpaid invoice | **A governed *"I could not do this"* outcome** | **MISSING — THE MOST-CITED GAP IN THE CORPUS**, recorded **four times in one story** → `OD-13` |
| **EXP-052** | Fat-fingers **Arrive** on the freeway | A correction path | **MISSING.** Mis-taps *"are constant"* on a truck-mounted phone |
| **EXP-060** | Offline in a freezer room | That the intent is queued, **in what order, and that dependencies hold** | **AVAILABLE NOW — THE STRONGEST EXCEPTION EXPERIENCE IN EOS.** Two residuals: **a cold start with no signal *"gives him nothing — he cannot even load the app"*, and the local store *"is explicitly NOT encrypted, which matters for a lost phone carrying customer notes"*** |
| **EXP-061** | A queued intent refused at 18:00 | That a refusal arriving after hours **will not be seen** | **MISSING — WORKFLOW** |
| **EXP-070** | Any phone use | That **width changes composition, NEVER authority**, and that the surface follows **the USER, not the viewport** | **MISSING — LIVE VIOLATION.** *"**Two different technician experiences chosen by viewport width, not by user preference**"* → `OD-38` |
| **EXP-072** | Recording a part on the phone | Where the part came from | **AVAILABLE as a refusal** (*"Select where this part came from before recording usage"*) **and MISSING as a source** — the truck is not offered until a fragile join resolves, so *"**The technician sees only warehouses and either picks a warehouse he was never at, or gives up and does not record the part**"* |
| **EXP-098** | Last completion of the day at 17:45 in a car park | That this is *"**the most rushed record of the day**"* | **MISSING** — *"No friction, no checklist, no prompt"* — **stated as a finding, not a request for friction for its own sake** |

---

## 6. Performance — what may and may not be measured

| Metric | Axis | Attribution | Verdict |
|---|---|---|---|
| `technician.workOrder.completed.cumulative.count` | **WORKLOAD / CUMULATIVE VOLUME — *not* employee performance** | **PERSON, but via MUTABLE `assignedTechId`** | **PARTIAL.** ACTIVE; goal DENY in production; attribution **contestable**; **client-side unbounded read.** Rollup **REFUSED**: *"summing two technicians' all-time counts answers no question a manager asked, and **the sum grows with tenure rather than with performance**"* |
| `technician.workOrder.open.count` | **WORKLOAD** | **PERSON as SUBJECT, not as SCORE — assigned ≠ chosen** | **PARTIAL**, same three caveats. Rollup **REFUSED** |
| On-time completion / arrival | TIMELINESS | PERSON + PROCESS jointly | **GAP.** *"'on time' has no governed definition… Both the predicate and the eligible population are undecided."* **Refinement: `arrivedAt` IS a real timestamp, so *"the raw ingredients exist… the gap is that nothing computes it"* — but RESCHEDULE OVERWRITES THE SCHEDULED WINDOW IN PLACE, SO THE ORIGINAL CUSTOMER PROMISE IS LOST** |
| First-time fix | QUALITY | PERSON only with revisit linkage | **GAP — STRUCTURAL.** *"Two Work Orders at one Account for one machine are two independent records; nothing relates them, so **the denominator cannot be formed at all**"* |
| **Utilisation** | **CAPACITY — NEVER employee performance** | **RESOURCE, not person** | **GAP, and the EXISTENCE question is open.** *"Whether such a figure may exist at all is the open question, not merely how to compute it."* **And it is on the ratified DO-NOT-BUILD list** |
| Average job duration | TIMELINESS | PERSON | **PARTIAL AND SELF-WITHDRAWING** — one contradictory record withdraws the whole average. **Additional distortion: *"Average completion time is silently distorted by offline-synced work, because queued transitions carry the SYNC timestamp rather than the time the technician acted"*** |
| Same-day documentation | PROCESS HEALTH | PERSON | **GAP** — *"the offline submission queue that would supply the timing is **CLIENT-LOCAL PER DEVICE** — it is not a server-side fact and cannot be measured for anyone but the person holding the device"* |

**The three-axis frame ships with one populated slot and two reserved-and-visibly-empty ones**, each
naming what is missing: **PRODUCTIVITY** (populated) · **ON-TIME EXECUTION** (`NOT_ENABLED` —
*"a Work Order records no promise, commitment or SLA to be on time AGAINST"*) · **QUALITY**
(`NOT_ENABLED` — *"no revisit linkage exists in the model at all"*). **`NOT_ENABLED` rather than
`UNAVAILABLE` is deliberate and assistive — do not "simplify" it.**

**And a person-attributed number has already shipped wrong for this role: `-1686m` reported as a
performance fact. The bad records were NEVER REPAIRED, only the display.** → `OD-15`

---

## 7. What can go wrong, and why nothing catches it

| # | Failure |
|---|---|
| 1 | **He becomes unavailable mid-job and the job cannot move.** All five of his transitions are `requiresOwnAssignment: true`, so *"nobody else can advance them"*, and **the only exit is `Cancel` — destroying `arrivedAt`, `workStartedAt` and three hours of execution data.** **And the orphan permanently consumes his dispatch capacity** |
| 2 | **He works a job assigned to someone else on a colleague's word.** *"Dale tells Javier verbally and the record stays on Curtis"* — **and the technician scorecard attributes the work to Curtis, WHO DID NOT DO IT** |
| 3 | **He completes a job requiring a certification he does not hold.** *"Nothing warns."* **No subsystem reads it and no outside channel holds it** |
| 4 | **A job dispatched to a mismatched id is *"invisible to everyone except admins and dispatchers"*** |
| 5 | **He arrives before a cancellation syncs and works a cancelled Work Order** — *"and CANCELLED is TERMINAL with no way back"* |
| 6 | **He ignores a refused sync card and *"leaves work permanently unrecorded"*** — and **nobody in the office can see his pending-intent queue** |
| 7 | **His stale `on_job` status left overnight *"scores him as occupied all the next day with no way to notice"*** |
| 8 | **His labour never reaches EOS**, so *"even the one role EOS DOES model cannot be held accountable from the record"* |
