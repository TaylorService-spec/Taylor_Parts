# ROLE PROFILE — PARTS FLOOR

**Parts Associate · Receiving Lead · Stocker / Scanner Operator · Satellite Attendant · Branch Parts
Coordinator · Parts Counter**

**OBSERVED AT: 64008d5a** · **IMPLEMENTATION STATUS: NOT AUTHORIZED**
Sources: EMP-WORK §2.4 · EMP-INFORMATION §7.9/§7.11–7.14 · EMP-EXPERIENCE §3.2/§4 · EMP-ROLE §5/§6.1 ·
EMP-PERFORMANCE §7.

> **This profile covers a GROUP because three of the six sub-roles have NO SECURITY ROLE AT ALL and two
> lanes disagree about whether two of them are one role.** The groupings are **recorded, not resolved**:
> **`R-3`** (Luis Mendoza is `Stocker/scanner operator` **and** `Stocker` within one library) and
> **`R-5`** (Parts Associate vs Parts Counter — two lanes hold them apart, two fold them together).
> **A profile per sub-role would silently make an Owner decision.**

---

## 1. Identity

| Sub-role | Activities | Security Role | Placement | Persona |
|---|---:|---|---|---|
| **Parts Associate** | **37–42** (B2 37 + SVC 5 under a different normalisation) | **`partsAssociate` — GOVERNED** | under `partsManager` | Dwayne Holbrook |
| **Receiving Lead** | **19** | **Contested**: EMP-ROLE records **NONE**; EMP-INFORMATION maps **`inventoryReceivingClerk` (governed)**. **Both recorded** | **unplaced** | Ray Camacho |
| **Stocker / Scanner Operator** | **32** (28 + 4 **under two labels, same persona**) | **NONE** — nearest `inventoryPutAwayOperator` / `inventoryStockRelocationOperator`, **both gated on ids that are `active:false`, one of them NEVER REQUESTED** | **unplaced** | Luis Mendoza |
| **Satellite Attendant** | **7** | **NONE** | **unplaced** | Owen Tate |
| **Branch Parts Coordinator** | **12** | **NONE** | **unplaced** | Nadia Fournier — **100% `ventana`** |
| **Parts Counter** | **5** | **NONE** | **unplaced** | Nate Purcell |
| **GROUP TOTAL** | **~100–112** | **3 of 6 have no security Role — 75 activities with no authorization home** | | |

| Dimension | Value |
|---|---|
| **`operationalRoles` values** | **`PARTS_ASSOCIATE` (consumed) · `WAREHOUSE_ASSOCIATE` (between 0 and 1 consumers — conflict `E-3`)** |
| **Device** | **DESKTOP · MOBILE · and `HANDHELD_SCANNER` — a real third device class carrying 69 activities, existing in ONE LIBRARY ONLY** |
| **Workflows / finishable** | Parts Associate 8 / **38%** (3 WORKS_WITH_GAPS · 4 BROKEN_MIDWAY · 1 CANNOT_START) |

---

## 2. The eleven role dimensions

| Dimension | Evidence | Provenance |
|---|---|---|
| **PURPOSE** | Take physical custody of stock accurately, at the right location and the right company, and hand it on | **INFERRED from observed work** |
| **RESPONSIBILITIES** | Receive supplier deliveries and record receipt lines; record and chase POs; **stage kits for named jobs**; stow and relocate stock; **move stock across the company line**; run scan sessions; execute assigned purchasing | **KNOWN** |
| **ACCOUNTABILITIES** | **NONE MODELLED.** *"The receiving session or count sheet he opened and has not closed"* is the nearest accountability-shaped thing — and **it is a session, not a person-accountable fact** | **KNOWN (the absence)** |
| **DECISION AUTHORITY** | Disposition of a counted variance; **whether to stow warehouse-direct when the bin is unknown.** **NOT: void, cancel, or start purchasing on someone else's request.** *"Dwayne must ask a dispatcher"* | **KNOWN** |
| **NORMAL DAILY WORK** | The awaiting-receipt queue; put-away; staging; relocation; the 22:00 shift change | **KNOWN** |
| **RECURRING WORK** | **15 `END_OF_DAY` across the desk — the most of any job.** Quarterly cycle count; month-end SKU reconciliation | **KNOWN** |
| **EXCEPTION WORK** | **53 `EXCEPTION` and 46 `BAD_DATA` — THE HIGHEST OF BOTH IN THE CORPUS.** 19 `CROSS_COMPANY` · 19 `PERMISSION_DENIAL` · 14 `RECOVERY` · 9 `BACK_BUTTON/ABANDONED` · 8 `NETWORK_INTERRUPTION` · 6 `AFTER_HOURS`. **And 80% of handheld activities touch an exception — the most exception-dense surface in EOS on the least screen** | **KNOWN** |
| **CROSS-DEPARTMENT** | **8 `HANDOFF`.** Parts Manager → Parts Associate; **Parts Associate → Technician (staged kit)**; **the gun handed between operators MID-SESSION**; the 22:00 shift change; **Receiving → Purchasing BY EMAIL** | **KNOWN** |
| **MANAGEMENT / ESCALATION** | **THE DENSEST ESCALATION NEED IN THE CORPUS.** A committed duplicate needs an `ADJUSTED` movement *"which requires authority Ray may not hold. **That escalation must be discoverable FROM THE LINE**"*. **And one case is *"a GENUINE STRUCTURAL DEAD END"*** — *"Dwayne must find a dispatcher who is ALSO the assignee — **and the assignee is Dwayne**"* | **KNOWN** |
| **PROFICIENCY EXPECTATIONS** | **NOTHING** | **KNOWN (the absence)** |
| **SUCCESS OUTCOMES** | **NONE STATED.** Every measurable metric over this work is attributed to a **LOCATION or the FIRM** | **KNOWN** |

---

## 3. Work facets

| Facet | Content |
|---|---|
| **WORK ARRIVING** | Three open supplier receipts, *"**one belongs to ventana**"*; approved reorder requests **into a PERSONAL queue**; technician restock requests; staged put-away sessions |
| **TRIGGERS** | The Tuesday supplier drop; **06:00 at the dock, gun in hand**; a dispatcher approval; a technician's restock request; **17:30 close-out** |
| **INFORMATION NEEDED** | **23 `had_to_hunt` — the highest single role label in the corpus.** **What is expected in today, against which order** — *"**A purchase order has no business number. Nothing prints, encodes or resolves a scannable order label**"*, so **scan-first receiving entry cannot be built**; which of two Parts claims internal part number TST-1022; **operating-company attribution on the queue row** |
| **DECISIONS** | Whether to void or cancel a PO; disposition of a counted variance; **whether to stow warehouse-direct when the bin is unknown** |
| **INTERRUPTIONS** | *"A phone call interrupts"*; a vendor *"calls back to change the quantity mid-form"*; **the gun handed over mid-session**; **the freezer, the dock** |
| **RECOVERY** | *"Ray's recovery is **a phone call today**."* *"The real-world recovery is **a spreadsheet and a phone call. That is the gap**."* *"Luis's real recovery is to **stow warehouse-direct and write the shelf on paper**."* **And no governed command closes a short receipt line** |
| **WORK HELD OUTSIDE EOS** | Receipt exceptions (**phone**) · **request closeout by EMAIL** (*"Ray emails Dwayne. **That is the current integration**"*) · bin location (**paper**) · hand-keyed codes (*"the only evidence of intent is **the operator's memory**"*) · a lost count session (*"there is **no recovery** — only a re-count, **and nobody will know a re-count is needed**"*) · staging handoff (*"then the handoff to Curt is **verbal**"*) · missing kit items (*"a re-pull with **no record of who took them**"*) |

---

## 4. Information model

| DIM | REQUIREMENT | KNOWABLE |
|---|---|---|
| **SHOW** | **"11 of 14 received"**, drilling to **the three outstanding lines, opened on the first** | **MISSING** |
| **SHOW** | The **queued-scan count**, with **queued lines distinguishable from committed ones** | **MISSING** — *"committed and queued lines render identically"* |
| **SHOW** | **In-transit quantity and value, per company**, itemised and aged | **MISSING** |
| **SHOW** | What is expected on the dock, **and which company owns each line** | **MISSING for the company axis** |
| **ATTENTION** | **Short lines still open**; staged kits at risk; **an unsent scan batch from a previous shift** | **MISSING.** DESIRED: *"You have 4 unsent scans from 21:40"* |
| **EXPLAIN** | **Why a part number scanned as unknown — `NOT_FOUND` distinct from `FAILED`, with the scanned text echoed** | **MISSING** |
| **EXPLAIN** | **Who can void, and WHAT TO DO WHEN NOBODY WHO CAN VOID IS THE ASSIGNEE** | **MISSING — but this requirement ALREADY ANTICIPATES THE EMPTY CASE AND IS THE RIGHT PATTERN** (EMP-INFORMATION `O-5`) |
| **WARN** | *"**marking received does NOT add the stock**"*; *"this records where it went; **it does not change how much there is**"*; retiring a bin *"**does not free the code, and it does not move any stock**"* | **AVAILABLE NOW as stated requirements** — but `HELP_MISSING` is **27 of 100, the highest rate of any family** |
| **WARN** | **Crossing the operating-company line — BY NAME, BEFORE COMMIT** | **REQUIRED, and inferring the company from the operator's location is FORBIDDEN** |
| **WARN** | Relocating more than the source bin holds → **an OFFER TO SPLIT, not a bare refusal** | **MISSING** — *"The screen should offer to split, not just refuse"* |
| **WARN** | *"This transfer has been dispatched. It cannot be cancelled; **the stock must be returned**"* | **REQUIRED, pre-commit** |
| **WARN** | A second send of a queued batch: *"this line was already received at 09:14. **Nothing was added**"* | **MISSING** |
| **RECOMMEND** | **NOTHING on the scan-commit path.** The Scanner Operator carries **5 of the 15 `AI_UNSAFE_HERE` rows — the highest of any role**. And *"A model guessing whether the write landed is exactly the wrong tool. **This needs an idempotency key, not an inference**"* | **AVAILABLE NOW as a rule: AI MUST BE ABSENT HERE** |
| **SCAN principle** | **Scanning resolves IDENTITY and does NOT determine AUTHORITY** — *"The scanner identifies an object and prepares an operation; **it never changes inventory merely because a barcode was read**"*; one shared `resolveScannedIdentity` | **AVAILABLE NOW as principle.** **But `inventory.stock.relocate` is one of the five NEVER-REQUESTED ids, so *"the only quantity-moving scanner workflow can never be offered to anyone"*** |

---

## 5. Experience requirements

| ID | Trigger | Requirement | State |
|---|---|---|---|
| **EXP-009** | **06:00 at the dock, gun in hand** | What is expected in today, **against which order** | **MISSING — MODEL.** **A purchase order has no business number** |
| **EXP-047** | Restock request from the truck | The ask, **in a form the warehouse can pick against** | **MISSING — WORKFLOW.** *"the handoff happens by phone and the whole story below runs with **no record of intent**"*; and ***"Nothing produces a pick list"*** |
| **EXP-048** | Nine parts staged for Thursday 06:00 | That **staging does not reserve**, and **who removed a staged part** | **PARTIAL/MISSING.** *"Placements record stowing, **not removal**"* |
| **EXP-053** | Scans the same carton twice | That the recovery is an `ADJUSTED` movement he may not be authorised for — **AND WHO IS** | **MISSING — MODEL.** *"That escalation must be discoverable **from the line**"* |
| **EXP-054** | Tries to void an order he owns | Who **can**, and that *"the person closest to the order is the person who cannot cancel it"* | **MISSING, AND STRUCTURALLY SO — *"a GENUINE STRUCTURAL DEAD END"*** |
| **EXP-055** | Relocates more than the source bin holds | **An offer to SPLIT the movement** | **MISSING** |
| **EXP-058** | A bulk act partly fails | **EXACTLY WHICH ROWS FAILED**, each retryable alone | **PARTIAL.** The requirement is stated **four times** — *"If row 12 fails, rows 1-11 must remain created and row 12 must be retryable alone"*; *"If four of eleven fail, **the operator must know which four before the vendor call ends**"*. **66 of 660 activities are `BULK`** |
| **EXP-059** | Same act submitted twice from two tabs | A refusal that **reads as PROTECTION, not as a fault** | **AVAILABLE as authority, MISSING as experience.** *"Rules protect correctness well and the UI is likely to translate the protection into a **frightening error**. **The finding will be UX, not authority**"* |
| **EXP-073** | Gun in hand, freezer or dock | That **scanning resolves IDENTITY and does not determine AUTHORITY** | **AVAILABLE as principle; the one quantity-moving workflow is unreachable** |
| **EXP-074** | Any handheld task | That this is **the most exception-dense surface in EOS (80%) on the least screen** | **AVAILABLE NOW AS EVIDENCE**, reflected in **no built surface** |

---

## 6. Performance

| Metric | Axis | Attribution | Verdict |
|---|---|---|---|
| `receiving.purchaseOrder.receivable.count` | **PROCESS HEALTH** | **LOCATION** | **MEASURABLE** |
| `parts.reorderRequest.open.count` | **PROCESS HEALTH** | **LOCATION** | **MEASURABLE** |
| Receipt discrepancy rate | QUALITY / EXCEPTION | **PROCESS** | **GAP — NUMERATOR ONLY.** *"The numerator exists; **the DENOMINATOR does not.** Whether the rate is per receipt, per PO, per line or per unit **is undecided**"* |
| Scan throughput / session productivity | WORKLOAD | PERSON | **GAP — and not proposed.** Every candidate would need a governed session-actor fact; **the gun is handed between operators mid-session and there is no handover concept** |
| Inventory accuracy | QUALITY | **LOCATION / PROCESS — NEVER A COUNTER'S SCORE** | **GAP — two blockers** |
| Anything about **them** | — | — | **GAP, and deliberately.** *"`scores` scores the PRODUCT SURFACE, never a person"* — all 11 keys are boolean assertions about the screen and the flow, **not one names an employee, a persona's competence, an outcome, a quantity or a standard** |

---

## 7. What can go wrong, and why nothing catches it

| # | Failure |
|---|---|
| 1 | **A colleague tries to start purchasing on someone else's request** — *"**the single most likely real-world friction in the whole procurement chain**, and there is NO reassignment branch in Rules to resolve it"* → *"**The order misses the cut-off**"* |
| 2 | **The structural dead end:** *"Dwayne must find a dispatcher who is ALSO the assignee — **and the assignee is Dwayne**"* |
| 3 | **Ray receipts the goods and nobody closes the request.** *"Ray emails Dwayne. **That is the current integration**"* → *"The ledger and the purchasing queue **tell different stories about the same cartons**"* |
| 4 | **A short line stays open and the order stays SENT, indefinitely** — no governed command closes it |
| 5 | **The gun is handed over mid-session and the receipt ends up with two sessions** — *"**Both failure modes trace to the same MISSING HANDOVER CONCEPT**"* |
| 6 | **A shift-change cycle count loses four physically counted cartons.** *"queue held only in memory, in which case **four physically counted cartons vanish with no trace anywhere**"* |
| 7 | **A staged kit is picked for another job**, because *"**availability does not move, so the Thursday kit is still promisable to a Wednesday emergency call**"* — and a re-pull leaves **no record of who took them** |
| 8 | **Four drive belts cross the company line and *"sit in Ventana's stockroom, fitted on Thursday, OWNED BY TAYLOR ON PAPER FOREVER"*** — and **the append-only rows cannot be reattributed** |
| 9 | **The Branch Parts Coordinator's whole job is the company boundary and EOS cannot express it: 12 of 12 of her activities are flagged `OC_UNCLEAR` and 11 of 12 `OWNERSHIP_UNCLEAR`** |
| 10 | **The only quantity-moving scanner workflow *"can never be offered to anyone"*** — `inventory.stock.relocate` is one of the five never-requested gate ids, **and the user is told nothing** |
| 11 | **A bin picker renders EMPTY instead of DENIED on three surfaces** — *"**Three screens inventing three different stories about the same refusal**"* |
