# ROLE PROFILE — CONTROLLER

**OBSERVED AT: 64008d5a** · **IMPLEMENTATION STATUS: NOT AUTHORIZED**
Sources: EMP-WORK §2.7 · EMP-INFORMATION §7.17 · EMP-EXPERIENCE §3.2/§4 · EMP-ROLE §5 ·
EMP-PERFORMANCE §2–§3, §7.3.

> **THE CONTROLLER CARRIES MORE WORKFLOWS THAN ANY OTHER ACTOR — 20 — AND CAN FINISH 15% OF THEM. Nine
> of the 20 are `CANNOT_START`. And the governed `controller` Role has ZERO HOLDERS EVEN IN THE
> SYNTHETIC SANDBOX ROSTER.**

> **Covers the Controller specifically. `accountingManager` and `financeManager` are INTENTIONALLY
> IDENTICAL IN CAPABILITY (DECISIONS #114) — *"Two Roles that resolve the same way are not a defect when
> the distinction they encode is real and the authority difference has not been designed yet"* — and the
> sales archaeology nonetheless classes the divergence an AUTHORITY GAP. BOTH READINGS RECORDED
> (EMP-ROLE F-10).**

---

## 1. Identity

| Dimension | Value |
|---|---|
| **Corpus activities** | **51** — `Controller` 19 (B2) + 30 (B3), **of which 14 BLOCKED and 9 PARTIAL**. The wider FINANCE block is **87** (`Accounting Manager` 36 · `Finance Manager` 2 · Controller 49) |
| **Security Role** | **`controller` — GOVERNED, and on the `financeManager` spine** |
| **Identified by** | **`employees/{id}.jobTitle` — FREE TEXT** |
| **Occupancy** | **ZERO holders in production (measured) AND ZERO in the synthetic sandbox roster** — one of the 15 governed Roles unoccupied even there |
| **Device** | **UNMEASURABLE for the B3 half** — 30 of her 51 activities carry **no device, no coverage, no friction score and no operating company** |
| **Modules crossed** | **6** — Finance · Inventory · Purchasing · Service · Administration · Cross-domain |
| **Workflows / finishable** | **20 / 15%** — (3 WORKS_WITH_GAPS · 7 BROKEN_MIDWAY · **9 CANNOT_START** · 1 NO_IMPLEMENTATION) |

---

## 2. The eleven role dimensions

| Dimension | Evidence | Provenance |
|---|---|---|
| **PURPOSE** | **Produce numbers that can survive an audit.** *"Produce the month's four inventory numbers; attest what the position rests on; close the period; reconcile EOS against the system of record; set approval thresholds"* | **INFERRED from observed work** |
| **RESPONSIBILITIES** | The four month-end numbers; publish the position **and record what it rests on**; close the period; reconcile; **set approval thresholds for credits, write-offs and refunds** | **KNOWN** |
| **ACCOUNTABILITIES** | **NOT A PERSON — COMPANY, by ruling D-15**: *"A ledger entry belongs to the books it lands in, **not to the salesperson upstream of it**… accounting ownership and sales credit are different questions **and must not share one field**."* **CORRECT — and it leaves COLLECTIONS ACCOUNTABILITY UNASSIGNED**: `WF-FIN-005` *"Chase what is owed"* **has actors and NO accountable party** | **KNOWN** |
| **DECISION AUTHORITY** | **Approval thresholds for credits, write-offs and refunds, and who the second approver is — AND *"the approval machinery IS BUILT AND HAS NO POLICY VALUES TO ENFORCE"*.** FIN-007 is declared *"not configured"* on **four** Financials surfaces; **self-approval is forbidden UNCONDITIONALLY — *"no policy input can re-enable it"*** | **KNOWN** |
| **NORMAL DAILY WORK** | **Largely CALENDAR-driven, not interrupt-driven** — 3 `AFTER_HOURS`, 0 `NETWORK_INTERRUPTION`, 0 `BACK_BUTTON` | **KNOWN** |
| **RECURRING WORK** | **17 `END_OF_MONTH` — the highest of any single role label** (the Ops/Management block totals 28) | **KNOWN** |
| **EXCEPTION WORK** | *"FIN-008 models period close but **NOT REOPEN**. A late transaction against a closed period **refuses, and there is no modelled path forward**."* An overpayment ***"cannot be recorded at all"***; a deposit before invoicing ***"has nowhere to sit"*** | **KNOWN** |
| **CROSS-DEPARTMENT** | **0 `HANDOFF`-tagged in B2; P3-B3 CANNOT EXPRESS ANY.** In: from Parts/Warehouse and Billing. Out: to Owner/GM | **KNOWN — but the zero is a MEASUREMENT GAP, not smooth work** |
| **MANAGEMENT / ESCALATION** | **To the Owner, as BLOCKED DECISIONS.** Intercompany accounting is blocked *"by **explicit Owner block**… a recorded **refusal to guess**, not a gap"*; which system is authority of record is undecided (#145) | **KNOWN** |
| **PROFICIENCY EXPECTATIONS** | **NOTHING** | **KNOWN (the absence)** |
| **SUCCESS OUTCOMES** | **NONE STATED — and she is an actor on `WF-SVC-016`, the technician scorecard workflow, whose step 3 is *"impossible: no Work Order carries an operating company"*** | **KNOWN** |

---

## 3. Work facets

| Facet | Content |
|---|---|
| **WORK ARRIVING** | Month-end close obligations; **variance and reconciliation exceptions**; credits above threshold; **a late transaction against a closed period** |
| **TRIGGERS** | **Month end**; a credit above threshold; a late transaction against a closed period |
| **DAILY QUESTIONS** | ***What is on hand and what is it worth? What was the margin? WHICH COMPANY DID THE WORK? Can I close the period? Who approved this credit?*** |
| **INFORMATION NEEDED** | **MARGIN — *"STRUCTURALLY unknown… the binding display rule is that it must render as UNKNOWN, NEVER 0%"*** (the cost engine is *"written, 425 lines, **and imported by nothing**"*). **THE OPERATING COMPANY ON A WORK ORDER — *"none carries one, and DECISIONS #143 FORBIDS INFERRING IT"*** |
| **ACTIONS** | **Publish the position and record what it rests on**; close the period (`WF-FIN-007`, **CANNOT_START**); reconcile (`WF-FIN-011`, **CANNOT_START**) |
| **RECOVERY** | *"Brenda's recovery is to **attest from engineering's deployment history, outside the system**"* — and those writes *"have **no in-product audit entry and no actor the product can name**."* *"CURRENT: **no surface produces any of that**, so the figure will be **assembled by hand and its provenance will live in someone's spreadsheet**"* |
| **WORK HELD OUTSIDE EOS** | **THE PUBLISHED FINANCIAL POSITION** (spreadsheet) · **attestation** (engineering deployment history) · **the Taylor/Ventana split** (*"She maintains the split in a spreadsheet"*; *"The split is reconstructed downstream and is **a reconciliation, not a report**"*) · **consolidation** (*"Elimination is **explicitly outside EOS** and belongs to an external authority"*) |

---

## 4. Information model

| DIM | REQUIREMENT | KNOWABLE |
|---|---|---|
| **SHOW** | The four month-end numbers, **each with its basis AND its as-of time** | **PARTIAL — *"Valuation is not a place for inference"*, and three of the four month-end paths are `OWNER_DECISION_PENDING`** |
| **SHOW** | **An inventory valuation** | **MISSING — AUTHORITY.** *"no surface produces one"*, and it must **REFUSE A DOLLAR FIGURE and name the offending lots**: *"A partial total with a footnote is the failure mode — **somebody will export the total**"* |
| **SHOW** | **Margin** | **MISSING — AUTHORITY.** **Must render UNKNOWN, NEVER 0%** — *"UNKNOWN renders as unknown (never 0, never blank-as-zero)"* |
| **SHOW** | **In-transit quantity and value, per company** | **MISSING** |
| **SHOW** | **A cross-company total labelled as one, or not produced at all** | **REQUIRED.** Cross-entity sums must type as **`UNELIMINATED_SUM`**, and `sales.consolidatedBilled.amount` *"must render WITH THAT CAVEAT rather than as a company total"* — *"the registry's **clearest example of a workflow that is blocked CORRECTLY**: a recorded refusal to guess, not a gap"* |
| **SHOW** | **AR aging buckets** | **MISSING BY POLICY** — implemented under a recorded deployment policy of **not shipping them**; and **page 01 says "60+ days" while page 04 says "61+" — ONE WORDING MUST WIN** → `OD-41` |
| **ATTENTION** | **Anything that would change a published number**; approvals waiting on a threshold that is **unset** | **MISSING** |
| **EXPLAIN** | **What each number counts and where it came from** — every displayed quantity stating **what it counts, at which location/company, and as of when** | **MISSING at scale.** *"a hardcoded baseline and a governed on-hand render in the same column with the same typography"* |
| **EXPLAIN** | *"why has this taken nine days?"* — **turning eight timestamp/actor pairs into one sentence** | **MISSING.** *"If no surface assembles the chronology, **Priya reconstructs it from field names**."* **And this is *"exactly the right use of a model"*** |
| **RECOMMEND** | **`AI_MATERIAL` on 11 of 19 inventory-Controller activities — 58%, THE HIGHEST CONCENTRATION OF ANY ROLE.** Legitimate: **narrating a variance once a reconciliation surface exists** | **PARTIAL** — the assistant is *"wired to nothing"* |
| **RECOMMEND** | **NOTHING on a wrong number, a valuation, or a determinism guarantee** | ***"Narrating a wrong number makes it MORE CONVINCING, NOT MORE CORRECT"*** · ***"Valuation is not a place for inference"*** · ***"This is a determinism guarantee. A MODEL NEAR IT IS A LIABILITY"*** — **AVAILABLE NOW as rules** |
| **DRILL-THROUGH** | Every number must drill to **the records that produced it, with the predicate intact** | **MISSING AT THE PRIMITIVE LEVEL** — `GoalTile.jsx`, `CompactMetric.jsx` and `FinancialsOverview.jsx` contain **no `onClick`, `navigate`, `Link` or `href` at all** |

---

## 5. Experience requirements

| ID | Trigger | Requirement | State |
|---|---|---|---|
| **EXP-011** | **Month-end morning** | The four numbers, **each with its basis and its as-of time** | **PARTIAL — AUTHORITY + WORKFLOW** |
| **EXP-040** | Any margin question | Cost and revenue for a job | **MISSING — AUTHORITY.** *"Margin is structurally unknown and must render as unknown, never as zero. **The cost engine is 425 lines and is imported by nothing**"* |
| **EXP-103** | **Month end, both companies** | Four numbers **with a company split** | **MISSING — MODEL.** *"The split is reconstructed downstream and is **a reconciliation, not a report**"*; and *"**She maintains the split in a spreadsheet**"* |
| **EXP-017** | Weekly exception review | Which Sales Orders are stuck **AND FOR HOW LONG** | **MISSING — MODEL.** *"the order records **no stage times**, so 'stuck' can be inferred from state but **not measured in days**"*; *"'When did this order enter fulfilment?' **has no answer anywhere**"* |
| **EXP-069** | Monthly review (with the Owner) | **Taylor's and Ventana's month side by side** | **BLOCKED.** *"The financial axis is **closed** and the operational axis is **an authority gap**"* |
| **EXP-090** | *"why has this taken nine days?"* | **EXPLAIN** — one sentence from eight timestamp/actor pairs | **MISSING — ENGINEERING** |
| **EXP-075** | Any mobile use | — | **NO DEVICE EVIDENCE.** *"A Controller approving at month end… **is a plausible phone user and NONE IS EVIDENCED EITHER WAY**"* → `OD-38` |

---

## 6. Performance — what may and may not be measured

| Metric | Axis | Attribution | Verdict |
|---|---|---|---|
| `purchasing.purchaseOrder.open.count` | **PROCESS HEALTH** | **BUSINESS (`FIRM` only)** | **MEASURABLE** |
| `crm.account.active.count` | **BUSINESS OUTCOME** | **BUSINESS — registered `FIRM` scope ONLY** | **MEASURABLE — *"a COMPLETE server-side `count()` over the authorized scope; NEVER A PAGE, NEVER A SAMPLE. Unknown status values surface as `unclassified` rather than vanishing"*.** But **`FIRM` only: it cannot be attributed to a person** |
| `sales.billed.amount` · `sales.collected.amount` | BUSINESS OUTCOME | **PERSON via `creditedSalespersonId`** | **PARTIAL — and `sales.billed.amount` is *"the best-placed commercial metric in the document"*.** **ACTIVATED by Decision #163** (so the North Star's *"billed reads pending activation"* is **stale in one direction**). **BUT the principal's reach is DEAD**: `finance.visibility.self`/`.team` are among the 17 dead-in-every-environment ids **[EXECUTED]** |
| `sales.consolidatedBilled.amount` | BUSINESS OUTCOME | **BUSINESS, never a person** | **GAP at consolidated scope**, typed **`UNELIMINATED_SUM`** — *"the registry's clearest example of a workflow that is **blocked CORRECTLY**"* |
| **Inventory valuation / value / turns / carrying cost** | BUSINESS OUTCOME | LOCATION | **GAP / DECLINED.** On the **ratified DO-NOT-BUILD list**, and *"adopting an industry-standard percentage is **expressly refused**: the number would be **invented, not measured**"* |
| **Margin / gross margin per job or per person** | BUSINESS OUTCOME | — | **MISSING — AUTHORITY.** `FIN-PQ-15a` (*"who may see margin by person?"*) is **confirmed unanswerable and correctly so** |
| **Period close / reconciliation completeness** | PROCESS HEALTH | PROCESS | **GAP** — both workflows are `CANNOT_START`, three of them `OWNER_DECISION_PENDING` |
| **Any per-company OPERATIONAL number** | — | — | **GAP, NOT A REQUIREMENT.** `DECISIONS #143` **forbids inferring** the operational company, and the ownership config is *"configuration only, **NOT applied to any record**"*. **The ONE duplicated activity in the entire 1,010-record corpus is exactly this blocker, `BLOCKED` in both copies** |
| **Anything about HER** | — | — | **GAP.** She is the actor on the most workflows and **none of them yields a metric attributable to her** — *"and that is the eight-axis discipline working, not a shortfall"* |

**And the rules that bind every number she reads** (EMP-INFORMATION S-3…S-8): **no number without
provenance** · **a count is a claim about the business; a dash is a claim about the read — three states,
never two** · **a bounded read may return a page and say so; A TOTAL MAY NOT** · **a rate rolls up as
`sum(numerator)/sum(denominator)`, never `average(per-person percentages)`** · **unknown has no number
slot** · **a cross-company total is labelled as one, or is not produced.**

---

## 7. What can go wrong, and why nothing catches it

| # | Failure |
|---|---|
| 1 | **The business cannot bill a customer from EOS in production at all.** `WF-FIN-001` **[EXECUTED]** |
| 2 | **She publishes a position assembled by hand, whose provenance lives in a spreadsheet** — and her attestation comes from **engineering's deployment history, outside the system** |
| 3 | **A report tells her "no records matched" and it is FALSE.** A bounded 20,000-doc page with in-memory filters and a `rowCount === 0 → "empty"` branch **ahead of truncation** — reproduced as `{kind:"empty", rowCount:0, truncated:true}` **with audit `outcome:"applied"`.** *"'No records matched' was false, and **the audit trail recorded it as a clean answer**."* **LIVE at this baseline** |
| 4 | **A company-scoped number over Accounts/Contacts/Locations/Equipment cannot be produced correctly** — row scope is **hardcoded GLOBAL**, and closed for **ZERO of four** reachable objects |
| 5 | **Margin renders as 0% instead of UNKNOWN**, if the binding display rule is ever relaxed |
| 6 | **A late transaction against a closed period refuses and there is no modelled path forward** — FIN-008 models close but **not reopen** |
| 7 | **Her approval machinery is built and has no policy values**, so **no *"waiting on me"* list can exist** |
| 8 | **Her Role has ZERO HOLDERS — in production AND in the synthetic sandbox roster** |
| 9 | **A partial total gets exported.** *"A partial total with a footnote is the failure mode — **somebody will export the total**"* — **and `report.export` does not exist anywhere in the repository** |
| 10 | **She is an actor on the technician scorecard workflow whose step 3 is *"impossible"*** — no Work Order carries an operating company |
| 11 | **9 of her 20 workflows are `CANNOT_START`, and 0 of 86 workflows in EOS are proven end to end** — *"and the zero is **the ABSENCE of a measurement**, not a measurement that they fail"* |
