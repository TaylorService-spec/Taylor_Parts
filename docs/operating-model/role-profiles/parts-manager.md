# ROLE PROFILE — PARTS MANAGER

**OBSERVED AT: 64008d5a** · **IMPLEMENTATION STATUS: NOT AUTHORIZED**
Sources: EMP-WORK §2.4 · EMP-INFORMATION §7.8 · EMP-EXPERIENCE §3.2/§4 · EMP-ROLE §5 ·
EMP-PERFORMANCE §7 · OWN-DESIGN Panel C.

> **THE CANONICAL ACCOUNTABILITY CASE IN EOS — and the sharpest single authority gap: the Parts Manager
> owns the queue requests land in AND CANNOT APPROVE, REJECT OR CANCEL ONE. `reorder.request.approve`,
> `.reject` and `.cancel` reach NO GOVERNED BUSINESS ROLE — only an administrator or dispatcher.**

---

## 1. Identity

| Dimension | Value |
|---|---|
| **Corpus activities** | **69–79** depending on normalisation — `Parts Manager` 65 (B2) + 4 (B3); EMP-INFORMATION normalises `warehouse manager`→Parts Manager where the sales corpus means the parts desk, giving **74**; EMP-EXPERIENCE counts **79** (conflict `R-8` — **four normalisations, none chosen**) |
| **Security Role** | **`partsManager` — GOVERNED** |
| **`operationalRoles` value** | **`PARTS_MANAGER` — one of only THREE that gate a real check** (`firestore.rules isActiveOperationalRole()`, used at the `parts` block) |
| **Org-tree placement** | under `operationsManager` |
| **Occupancy** | **In production: `emp-rudy-parts-manager` holds `managerOperationalRoles: ["PARTS_MANAGER"]` and `governedRoleId: partsManager` with `state: OPERATIONAL_ROLE_ONLY`, `scopes: []`, `assignedWarehouseComparison: BOTH_EMPTY` — i.e. NO RoleAssignment whatsoever. THE JOB ROLE EXISTS. THE SECURITY ROLE DOES NOT** |
| **Modules crossed** | **5** — Inventory · Purchasing · Equipment · Finance · Cross-domain |
| **Workflows / finishable** | 13 / **31%** (4 WORKS_WITH_GAPS · 5 BROKEN_MIDWAY · **4 CANNOT_START**) |

---

## 2. The eleven role dimensions

| Dimension | Evidence | Provenance |
|---|---|---|
| **PURPOSE** | Keep the parts the business needs available at the right location, at the right company, without over-ordering | **INFERRED from observed work** |
| **RESPONSIBILITIES** | Review reorder recommendations; **raise reorder requests**; assign approved requests to a named person; steward the catalog and reorder points; close out at 17:30 | **KNOWN** |
| **ACCOUNTABILITIES** | **A ROLE QUEUE, NOT A PERSON.** Requests land in `READY_FOR_PARTS_MANAGER` — *"it assigns ownership to `PARTS_MANAGER`, **NOT TO A PERSON**"*. **`currentOwner` holds a role token, never an employee id** | **KNOWN — and it is the purest instance of the invariant failing** |
| **DECISION AUTHORITY** | **THE GAP.** She can **raise** a request and **assign** an approved one. **She CANNOT approve, reject or cancel one** — those verbs *"are held by `owner`, `admin` and `dispatcher` and by **NO governed business role**"* | **KNOWN** → `OD-17` |
| **NORMAL DAILY WORK** | The awaiting-receipt queue; reorder review; assignment; **17:30 close-out** | **KNOWN** |
| **RECURRING WORK** | **12 `END_OF_DAY` — the most of any job.** Quarterly cycle count; month-end SKU reconciliation; the opening-balance workbook | **KNOWN** |
| **EXCEPTION WORK** | Across the Parts/Warehouse desk as a whole: **53 `EXCEPTION` and 46 `BAD_DATA` — the HIGHEST OF BOTH IN THE CORPUS.** 19 `PERMISSION_DENIAL`, 19 `CROSS_COMPANY` | **KNOWN** |
| **CROSS-DEPARTMENT** | **8 `HANDOFF`.** Dispatcher → Parts Manager (approval); **Parts Manager → Parts Associate** (*"the request leaves the manager queue and enters Dwayne's personal queue"*) | **KNOWN** |
| **MANAGEMENT / ESCALATION** | **To System Admin for capability activation** — *"The escalation target is Sam Ortega (System Admin) to activate the capability — **and the screen must say so rather than leaving Tessa to guess**"*. **But activation is A RELEASE, NOT A PERSON, so naming a person there is WRONG** | **KNOWN** |
| **PROFICIENCY EXPECTATIONS** | **NOTHING** | **KNOWN (the absence)** |
| **SUCCESS OUTCOMES** | **NONE STATED.** The three measurable things over her work are **PROCESS HEALTH at `LOCATION`/`FIRM` scope — attributed to a LOCATION, never a person** | **KNOWN** |

---

## 3. Work facets

| Facet | Content |
|---|---|
| **WORK ARRIVING** | Three open supplier receipts on the awaiting-receipt queue, *"**one belongs to ventana**"*; **approved reorder requests landing in `READY_FOR_PARTS_MANAGER`**; technician restock requests |
| **TRIGGERS** | The Tuesday supplier drop; a reorder recommendation; **a dispatcher approval landing in her queue**; a technician's restock request from the truck; **17:30 close-out** |
| **DAILY QUESTIONS** | *What is expected on the dock today? Where did we put it? **Which approved request went where?** **Is this Taylor's shelf or Ventana's?** Which lines carry into tomorrow and need a second reviewer?* |
| **INFORMATION NEEDED** | **23 `had_to_hunt` across the desk — THE HIGHEST SINGLE ROLE LABEL IN THE CORPUS.** Where an approved request went (*"**if it lands nowhere visible it simply waits**"*); which of two Parts claims internal part number TST-1022; **operating-company attribution on the queue row** |
| **DECISIONS** | **Assign an approved request to a named person** — *"Turn a role's problem into a person's problem"*; whether to void or cancel a PO; disposition of a counted variance; whether to stow warehouse-direct when the bin is unknown |
| **RECOVERY** | **14 `RECOVERY` across the desk.** *"Ray's recovery is a phone call today."* *"The real-world recovery is a spreadsheet and a phone call. **That is the gap**."* **No governed command closes a short receipt line** — *"a line short stays open and the order stays SENT, **indefinitely**"* |
| **WORK HELD OUTSIDE EOS** | Receipt exceptions (**phone**) · **request closeout by EMAIL** (*"Ray emails Dwayne. **That is the current integration**"*) · bin location (**paper**) · missing kit items (*"a re-pull with **no record of who took them**"*) · duplicate part numbers (**spreadsheet + phone**) |

---

## 4. Information model

| DIM | REQUIREMENT | KNOWABLE |
|---|---|---|
| **SHOW** | On-hand and **available (on-hand minus commitment)** per location and company, **each figure stating what it counts, at which location/company, and as of when** | **MISSING.** The derivation is **location-blind and company-blind**, **adds catalog `warehouseQty` to ledger movement**, **omits 5 of 9 movement types**, and has **no `WORK_ORDER_CONSUMPTION` term** — so *"**consumed stock never leaves on-hand**"*. And the `On hand` column on the Parts list was **REJECTED** under `ND-25` (*"truthful absence > false comfort"*) because **no availability authority exists** |
| **SHOW** | Requests newly landed in `READY_FOR_PARTS_MANAGER` — **role-owned, not yet person-assigned — AND THAT THEY ARE HERS** | **PARTIAL model, ROLE-EMPTY in production.** The state exists and the help text the corpus asks for is exact: *"**Owned by the Parts Manager role. Not yet assigned to a person**"* |
| **SHOW** | **Which company each queue row belongs to** | **MISSING on operational rows; AVAILABLE on commercial rows** — **two independent axes** |
| **SHOW** | The reorder recommended quantity **with its basis** | **MISSING THE PROVENANCE** — *"the number arrives with **no provenance affordance**"* |
| **ATTENTION** | **Short lines still open**; staged kits at risk of being picked for another job; **requests approved and sitting UNASSIGNED** | **MISSING.** *"Availability does not move, so the Thursday kit is still promisable to a Wednesday emergency call. **That is the real operational risk**"* |
| **ATTENTION** | A number on screen is wrong | ***"NOTHING. AI must be silent here: narrating a wrong number makes it MORE CONVINCING, NOT MORE CORRECT"*** — **AVAILABLE NOW as a rule** |
| **EXPLAIN** | Why she cannot approve the request in her own queue — **and WHO CAN** | **MISSING.** And **this is a `D-1` UNGRANTED condition, not `D-2` INACTIVE — the distinction must not be collapsed** |
| **WARN** | *"recording a placement **does not change any quantity**"*; *"staging **does not reserve**"* — *"**the most important sentence on this screen**"* | **AVAILABLE NOW as a stated requirement** — but `HELP_MISSING` is flagged on **27 of 100 parts-floor activities, the highest rate of any family** |
| **WARN** | **Crossing the operating-company line — BY NAME, BEFORE COMMIT** (*"'Taylor Freezer of Arizona → Ventana' in words"*) | **REQUIRED, and inference from the operator's location is FORBIDDEN** |
| **RECOMMEND** | **Group twenty requests by supplier before they become twenty POs** — *"real leverage"*. But *"Drafting justification text from the demand signal is useful; **CHOOSING THE QUANTITY IS NOT**"* | **MISSING.** **Eight designed recommenders and *"NOTHING FROM IT WAS BUILT"*** |
| **ESCALATION** | Capability inactive with no self-service path | **MISSING** — and **the honest sentence is *"not active in this release; granting it has no effect"*, naming NO person** |

---

## 5. Experience requirements

| ID | Trigger | Requirement | State |
|---|---|---|---|
| **EXP-008** | Opens her queue | Requests in `READY_FOR_PARTS_MANAGER` — **role-owned, not yet person-assigned — and that they are hers** | **PARTIAL model, ROLE-EMPTY in production.** **AUTHORITY GAP: the approval verbs reach no governed Role** |
| **EXP-018** | Any queue over both companies | **Which company each row belongs to** | **MISSING — MODEL** |
| **EXP-033** | At the point of a placement action | That **recording a placement does not change any quantity**, and that **staging does not reserve** | **AVAILABLE as a stated requirement; `HELP_MISSING` 27/100** |
| **EXP-039** | Twenty replenishment recommendations | Recommended quantity **with its basis**, grouped by supplier | **MISSING** |
| **EXP-089** | Same | AI may **group by supplier**, never **choose the quantity** | **MISSING** |
| **EXP-102** | 17:30 at Phoenix Main | What a warehouse lead closes out | **PARTIAL** — modelled across ten activities; **the densest `HELP_MISSING` zone for this family** |
| **J4** (*"Get this part on order tonight so I don't lose tomorrow morning"*) | crosses Service · Inventory · Purchasing · Financials | — | **The reorder chain RUNS — and *"the Parts Manager who raises the request CANNOT APPROVE, REJECT OR CANCEL ONE"*** |

---

## 6. Performance

| Metric | Axis | Attribution | Verdict |
|---|---|---|---|
| `parts.reorderRequest.open.count` | **PROCESS HEALTH** | **LOCATION, not person** | **MEASURABLE** (`LOCATION`, `FIRM`) — *"the picker filters by the same authority the create enforces (**offered == accepted**)"* |
| `receiving.purchaseOrder.receivable.count` | **PROCESS HEALTH** | **LOCATION** | **MEASURABLE** — `inventory.stock.receive` is active and *"needs no override"* |
| `purchasing.purchaseOrder.open.count` | **PROCESS HEALTH** | **BUSINESS (`FIRM` only)** | **MEASURABLE** |
| **Inventory accuracy** | QUALITY | **LOCATION / PROCESS — never a counter's score** | **GAP — two blockers.** `inventory.cycleCount.*` catalog-inactive **AND** the rate is undefined: *"whether accuracy is counted by line, by part, by unit or by value **is a decision**"*, and the value option needs a valuation policy left open |
| **Service-impact shortage** | PROCESS HEALTH | PROCESS | **PARTIAL — count YES, rate NO.** *"The COUNT is not a weaker version of the rate — **it is the form that can be right**"*, because **UNKNOWN IS INFECTIOUS in the ATP computation** |
| Obsolete / slow-moving inventory | BUSINESS OUTCOME | LOCATION | **GAP** — *"no aging implementation exists; **the thresholds AND the clock-start event are both undecided**"* |
| Unexplained loss or waste | BUSINESS OUTCOME | LOCATION | **GAP — three missing things.** A governed **PREVENTION event** is *"STILL MISSING, and it is the binding constraint"*; and a stated **COUNTERFACTUAL** is *"**an Owner decision, not an implementation detail**"*. **On the DO-NOT-BUILD list** |
| Anything about **her** | — | — | **GAP.** Every measurable metric over her work is attributed to a **LOCATION or the FIRM, never to her** — **and that is the eight-axis discipline working, not a shortfall** |

---

## 7. What can go wrong, and why nothing catches it

| # | Failure |
|---|---|
| 1 | **A request lands in her queue and she cannot act on it.** The approval verbs reach **no governed business Role** → `OD-17` |
| 2 | **The queue she owns is MEASURED-EMPTY in production.** *"The reorder request that lands in `READY_FOR_PARTS_MANAGER` lands in a queue **nobody can open**"* — the one active principal holds `admin@global` and **is not linked to an employee** |
| 3 | **`currentOwner` is the only "owner" the user sees, and it is not ownership** — rendered directly above "Assigned to" while **the record's real company owner is never rendered at all** → `OD-18` |
| 4 | **She assigns to the wrong person and there is no way back** — *"no branch from `ASSIGNED_TO_PARTS_ASSOCIATE` back to `READY_FOR_PARTS_MANAGER`"*, and **no reassignment branch in Rules** |
| 5 | **Her approval is IRREVERSIBLE** — *"An approval cannot be undone"* — and *"if it lands nowhere visible it simply waits"* |
| 6 | **Every reorder request refuses in every environment** — the live path is fail-closed on a **warehouse company that has no authorized writer** → `OD-9` |
| 7 | **She cannot see which company a queue row belongs to**, and *"the belts sit in Ventana's stockroom, fitted on Thursday, **owned by Taylor on paper forever**"* |
| 8 | **The catalog she stewards has NO STEWARD CONCEPT.** *"`REFERENCE` correctly says no BUSINESS OWNER; it does not say no CURATOR, **and no curator exists**"* → `OD-11b` |
| 9 | **A short receipt line stays open indefinitely** — no governed command closes it |
| 10 | **Her escalation target for an inactive capability is a PERSON, and it should be a RELEASE** — *"Calling an inactive capability a missing authority tells the Owner that something must be DESIGNED AND BUILT when in fact something must be ACTIVATED"* |
