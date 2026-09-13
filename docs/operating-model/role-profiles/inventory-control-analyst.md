# ROLE PROFILE — INVENTORY CONTROL ANALYST

**OBSERVED AT: 64008d5a** · **IMPLEMENTATION STATUS: NOT AUTHORIZED**
Sources: EMP-WORK §2.5 · EMP-INFORMATION §7.10 · EMP-EXPERIENCE §3.2/§4 · EMP-ROLE §5/§6.1 ·
EMP-PERFORMANCE §7.

> **THE SECOND-LARGEST ROLE GAP IN THE CORPUS: 34 activities of observed work with NO SECURITY ROLE.**
> The nearest governed Roles are `inventoryCycleCountCounter` and `inventoryCycleCountReconciler` —
> **and all four `inventory.cycleCount.*` capabilities are `active:false`, with
> `inventory.cycleCount.close` NOT IN THE CATALOG AT ALL.**

> **She is also the role where SEPARATION OF DUTIES is exercised correctly and then dead-ends:
> *"A counter cannot approve their own material variance. THIS IS A CONTROL, NOT A PERMISSIONS
> PROBLEM."* The control works. The eligible-reviewer list does not exist.**

---

## 1. Identity

| Dimension | Value |
|---|---|
| **Corpus activities** | **34** (B2 only) |
| **Security Role** | **NONE.** Nearest: `inventoryCycleCountCounter` / `inventoryCycleCountReconciler` — **both `active:false`, and `inventoryCycleCountCounter` is UNOCCUPIED even in the synthetic sandbox roster** |
| **Identified by** | **NONE** — *"no vocabulary identifies this role"* |
| **Org-tree placement** | **UNPLACED** |
| **Persona** | Tessa Nguyen |
| **Device** | DESKTOP — **low interruption load; this is desk work** (1 `ABANDONED_FLOW`, 0 `NETWORK_INTERRUPTION`, 0 `AFTER_HOURS`) |
| **Workflows / finishable** | 6 / **33%** (2 WORKS_WITH_GAPS · 2 BROKEN_MIDWAY · **2 CANNOT_START**) |

---

## 2. The eleven role dimensions

| Dimension | Evidence | Provenance |
|---|---|---|
| **PURPOSE** | **Keep part identity and inventory truth true.** *"Keep part identity true; run and reconcile cycle counts; age open transfers; validate imports before they land"* | **INFERRED from observed work** |
| **RESPONSIBILITIES** | Run import previews; submit and reconcile cycle counts; **age every open transfer across both companies**; attempt Part merges; disposition variance lines | **KNOWN** |
| **ACCOUNTABILITIES** | **NONE MODELLED.** *"Open variances awaiting a second reviewer"* is the nearest — and **it is a sheet state, not a person-accountable fact** | **KNOWN (the absence)** |
| **DECISION AUTHORITY** | Disposition of each variance line; **whether an ambiguous import row may proceed (it must not).** **AND EXPLICITLY NOT: approving her own variance** — correctly | **KNOWN — and the refusal is a CONTROL, not a permission defect** |
| **NORMAL DAILY WORK** | Import validation; variance review; transfer ageing | **KNOWN** |
| **RECURRING WORK** | **5 `END_OF_MONTH` · 5 `END_OF_DAY`.** Quarterly cycle count; month-end SKU reconciliation | **KNOWN** |
| **EXCEPTION WORK** | **16 `EXCEPTION` · 16 `BAD_DATA` · 2 `PERMISSION_DENIAL` · 2 `CROSS_COMPANY`** | **KNOWN** |
| **CROSS-DEPARTMENT** | **2 `HANDOFF` — the fewest of any substantial role.** To a **second reviewer** for her own variance (*"this is a **genuine role handoff, not an error**"*); to **System Admin for capability activation** | **KNOWN** |
| **MANAGEMENT / ESCALATION** | **To System Admin** — *"The escalation target is Sam Ortega (System Admin) to activate the capability — **and the screen must say so rather than leaving Tessa to guess**"*. **But activation is A RELEASE, NOT A PERSON, so naming a person there is WRONG.** And to a second reviewer — *"the screen must offer that as the next action, **with the eligible reviewers NAMED**, or the recovery is a Slack message"* | **KNOWN** |
| **PROFICIENCY EXPECTATIONS** | **NOTHING** | **KNOWN (the absence)** |
| **SUCCESS OUTCOMES** | **NONE STATED. And inventory accuracy — the obvious candidate — is a GAP for TWO independent reasons** (§6) | **KNOWN** |

---

## 3. Work facets

| Facet | Content |
|---|---|
| **WORK ARRIVING** | **Import files from branches**; **counted variance lines awaiting review** |
| **TRIGGERS** | The quarterly cycle count; **an opening-balance spreadsheet naming an ambiguous warehouse**; month-end; **a variance she counted herself** |
| **DAILY QUESTIONS** | *Which SKUs are not parts? **Which two Parts share one internal part number?** Which transfers have not arrived? **Does this import's warehouse name resolve to exactly ONE warehouse?*** |
| **INFORMATION NEEDED** | **15 `had_to_hunt`.** Which Part a duplicate number belongs to; **whether an expected-quantity read is company-scoped — IT IS NOT**: *"the expected-quantity transaction queries `where('partId','==',partId)` with **NO `operatingCompanyId` predicate** and filters **ONLY on location in memory**"* **[TRACED]** |
| **DECISIONS** | Disposition of each variance line; **whether an ambiguous import row may proceed (it must not)** |
| **RECOVERY** | *"Until a merge exists the only workaround is to retire one Part by status change and hand-correct its ledger, **which an append-only ledger does not permit**."* *"If the list cannot be produced, the recovery is **a manual ledger export and a spreadsheet, which is what will happen**"* |
| **WORK HELD OUTSIDE EOS** | **Duplicate part numbers** (*"The real-world recovery is **a spreadsheet and a phone call. That is the gap**"*) · **transfer ageing** (*"the recovery is a manual ledger export and a spreadsheet"*) · **second review** (*"or the recovery is **a Slack message**"*) |

---

## 4. Information model

| DIM | REQUIREMENT | KNOWABLE |
|---|---|---|
| **SHOW** | **Counted vs expected, and the variance** — drilling to the count lines, **and the statement that on-hand is UNCHANGED until reviewed** | **MISSING — MODEL** |
| **SHOW** | **In-transit quantity and value, PER COMPANY** — each open transfer itemised and aged, with **dispatching and receiving company** | **MISSING** |
| **SHOW** | **An inventory valuation** | **MISSING — AUTHORITY.** *"no surface produces one"*, and the requirement is that it **REFUSE A DOLLAR FIGURE and name the offending lots**: *"A partial total with a footnote is the failure mode — **somebody will export the total**"* |
| **SHOW** | Every quantity **stating its source and as-of time** | **MISSING.** *"a hardcoded baseline and a governed on-hand render **in the same column with the same typography**"* |
| **ATTENTION** | **Duplicate part numbers**; ambiguous warehouse names in a staged import; **transfers past an age threshold** | **MISSING.** *"…missing from every number for six days **and nobody has been told**"* |
| **ATTENTION** | Which variance lines she **may not approve because she counted them** | **PARTIAL.** **The control exists; the ELIGIBLE-REVIEWER LIST does not** |
| **EXPLAIN** | Why the create capability is inactive — ***"This workspace is visible but the create capability is inactive in this environment"* — BEFORE the picker, not after — plus the named escalation target** | **MISSING.** *"There is **no self-service recovery** … and the screen must say so rather than leaving Tessa to guess"* |
| **EXPLAIN** | Why her own variance is refused — **naming the rule, who submitted the count, and who can dispose of it** | **MISSING.** **And this is a `D-5` SEPARATION-OF-DUTIES refusal: it must read as *"This is a CONTROL, not a permissions problem"*, NOT as *"you lack access"*** |
| **RECOMMEND** | **`AI_MATERIAL` on 9 of her 34 activities** — the second-highest concentration after the Controller. **Legitimate**: narrating a variance once a reconciliation surface exists | **PARTIAL** — the assistant is *"wired to nothing"* |
| **RECOMMEND** | **NOTHING** on an ambiguous alias | ***"Ranking two equally-registered aliases is exactly the pick the server REFUSES to make. A model doing it in the UI REINTRODUCES THE DEFECT ABOVE THE API"*** — **AVAILABLE NOW as a rule** |
| **WARN** | A stale-write warning before a colleague's work is overwritten | **REQUIRED** — *"Losing a colleague's vendor note silently is the failure"* |

---

## 5. Experience requirements

| ID | Trigger | Requirement | State |
|---|---|---|---|
| **EXP-019** | Working a variance queue | **Which lines she may not approve because she counted them** | **PARTIAL — MODEL.** *"The screen must offer that as the next action, **with the eligible reviewers named**, or the recovery is a Slack message"* |
| **EXP-056** | The create capability is inactive | *"This workspace is visible but the create capability is inactive in this environment"* — **BEFORE the picker** — plus the named escalation target | **MISSING — ENGINEERING** |
| **EXP-058** | A bulk import partly fails | **Exactly which rows failed**, each retryable alone | **PARTIAL** |
| **EXP-034** | Any surface over an inactive capability | That the section is **INACTIVE, not EMPTY** | **AVAILABLE NOW where done well** — the Part record *"renders **stated absence** rather than empty tables — the correct treatment, and still four dead sections"*. **CONTRAST: `/inventory/transfers` shows *"Four live, undisabled buttons over four `active:false` capabilities; the page explains IN PROSE instead of in the CONTROL STATE"*** |
| **EXP-092** | A valuation | **NOTHING — be absent** | ***"Valuation is not a place for inference"*** — **AVAILABLE NOW as a rule** |

---

## 6. Performance

| Metric | Axis | Attribution | Verdict |
|---|---|---|---|
| **Inventory accuracy** | **QUALITY** | **LOCATION / PROCESS — NEVER A COUNTER'S SCORE** | **GAP — TWO INDEPENDENT BLOCKERS.** (1) `inventory.cycleCount.*` are **catalog-inactive, sandbox-overridden**. (2) **The rate is UNDEFINED**: *"whether accuracy is counted **by line, by part, by unit or by value** is a decision"* — **and the value option needs a valuation policy left open** |
| Counted variance volume | WORKLOAD | PERSON | **NOT PROPOSED.** *"assigned ≠ chosen"*, and **a variance count over a person would read as a score** |
| Obsolete / slow-moving inventory | BUSINESS OUTCOME | LOCATION | **GAP** — *"no aging implementation exists; **the thresholds AND the clock-start event are both undecided**"*. **On the DO-NOT-BUILD list** |
| Inventory value / turns / carrying cost | BUSINESS OUTCOME | LOCATION | **DECLINED — on the ratified DO-NOT-BUILD list**, and *"adopting an industry-standard percentage is **expressly refused**: the number would be **invented, not measured**"* |
| Transfer ageing | TIMELINESS | PROCESS | **GAP** — no governed stage timestamps |
| **`scores` / `frictionScore`** | **PROCESS HEALTH and PRODUCT DESIGN** | **THE PRODUCT SURFACE, NEVER A PERSON** | **She is the role whose work the corpus scores most densely — and *"the only thing in the 1,010-record evidence corpus called a 'score' is A SCORE OF EOS, NOT OF A PERSON. A synthesiser must not promote it"*** |

---

## 7. What can go wrong, and why nothing catches it

| # | Failure |
|---|---|
| 1 | **She counts a variance and cannot get a second reviewer.** The control is **correct**; *"the recovery is **a Slack message**"* because **no eligible-reviewer resolver exists** |
| 2 | **Her expected-quantity read is NOT company-scoped** — *"NO `operatingCompanyId` predicate… filters ONLY on location in memory"* **[TRACED]** — so a cross-company number can be wrong **and look right** |
| 3 | **Two Parts share one internal part number and there is no merge.** *"an append-only ledger does not permit"* the only workaround |
| 4 | **An import names *"Ventana Main"* where two warehouses match** — and an ambiguous row **must not proceed** |
| 5 | **She hits an inactive capability and is sent to a PERSON** — *"Calling an inactive capability a missing authority tells the Owner that something must be DESIGNED AND BUILT **when in fact something must be ACTIVATED**"* |
| 6 | **A count sheet sits open across a shift and *"the stale expected snapshots drift further from reality every day"*** |
| 7 | **An open transfer ages and nobody is told** — *"missing from every number for six days"* — and worse, **cancelling a transfer after the van has left leaves goods *"on NOBODY'S BOOKS, and attached to no open transfer — THE MOST COMPLETELY LOST STOCK ANY OF THESE STORIES PRODUCES"*** |
| 8 | **A reconciliation engine fed an empty array renders *"No discrepancies"*** — *"**a clean result for a check that never ran**"* |
| 9 | **Her whole role has no security Role**, and the two nearest governed Roles are **inactive AND unoccupied** |
