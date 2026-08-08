# UX Discovery — the five operating questions (management purpose, round 1)

One sequential, strictly read-only Dispatcher / Service Manager mission. The
persona was **not** told that a management surface exists, was not asked to
evaluate Control Tower, and was given no route, module or expected answer. It was
given a Monday morning and the five questions as its actual job.

Build under test: `71a9adf` (see the deployment correction below). Scenario
`SBX-SCN-002` verified intact before the run: 4 complete, unit 3 blocked.

**FUNCTIONAL: FAIL · EXPERIENCE: FAIL**

## The five-question matrix

| # | Question | Answerable | Where | Screens | Type |
|---|---|---|---|---|---|
| 1 | What is blocked? | Partially | Purchasing "Needs attention"; Inventory Parts queue | 6 | MANUALLY RECONSTRUCTED |
| 2 | Which customer commitment is at risk? | Pipeline only | Opportunities banner | 4 | EXPLICIT (sales) / **UNAVAILABLE (service)** |
| 3 | What is partially complete? | Yes | Work Orders counts + complaint free-text | 3 | MANUALLY RECONSTRUCTED |
| 4 | What is waiting on material? | Partially, **and contradicted** | three surfaces that disagree | 5 | MANUALLY RECONSTRUCTED / partly UNAVAILABLE |
| 5 | Who owns the next action? | Per record only | Opportunities, Inventory queue, Job Assignments, PO | 4 | EXPLICIT per record, **no aggregate** |

Not one of the five was answered by reading a single surface. The best case
(question 3) still required cross-referencing a count against a sentence in a
free-text complaint field.

## Correction — one reported defect is a stale deployment, not a product defect

The persona hit `ReferenceError: toAgeHours is not defined` on **Dispatch Queue**
and **Service Operations** — "the exact two screens a dispatcher would open
first". That crash was **already fixed on main** by `d1ce975` (#669); the sandbox
was still running `71a9adf`, which predates the fix.

Verified rather than assumed: deployed current main (`5fbc7be`, D2 clean) and
re-drove both routes with a page-error listener.

```
/service-operations   chars=9574   pageErrors=0
/service/dispatch     chars=1058   pageErrors=0
```

**Not routed as a defect.** The finding is about deployment currency: a persona
mission against a stale build spends its budget rediscovering fixed bugs. Pin and
verify the build before every mission.

`/service/dispatch` renders without error but with very little content — thin, not
broken. Carried into the IA backlog, not raised as a crash.

## Finding — three procurement surfaces disagree, and one alarms falsely · **HIGH**

The most damaging result is not a missing screen; it is that the screens that
exist do not agree with each other.

- **Operations Overview**: *"No purchase orders yet"* and *"nothing currently
  needs reordering"*.
- **Purchasing → Purchase Orders**: *"Needs attention (1)"* — `PRT-1001`, with
  supplier, PO number, quantity and dates all blank.
- **Inventory → Parts**: *"All Assigned Work (1)"* — a **different** part,
  `PRT-1006`, "In Progress", age rendered as `19933d ago`.
- **Notification bell**: `PRT-1003` "pending review" — a **third** part, which the
  Inventory Operational Queue simultaneously denies exists, reporting
  *"Critical & High (0)"* and *"No parts are currently Critical or High priority."*

Three procurement surfaces, three different pictures, and the one that claims
everything is fine is the calmest. A manager cannot answer "what is waiting on
material" because the application does not have one answer to give.

**Route:** Materials / Inventory — one shared source for procurement state.

## Finding — service-side customer risk does not exist · **HIGH**

Question 2 is answerable **only for the sales pipeline**. Opportunities explicitly
flags "2 opportunities need attention" with a named owner. There is no service
equivalent: Harbor Grill has a live, blocked, partially-fulfilled commitment and
**no surface anywhere flags that customer as at risk**.

The commercial side of the business can say "this customer needs attention". The
operational side cannot — even though it is the side with the unfinished
obligation.

## Finding — ownership exists per record, never in aggregate · **MEDIUM**

Every individual record names someone. Nothing answers "what needs *me* today".
The five reconciliation discrepancies have no owner at all, and `WO-2026-SBX002`
sits at "Awaiting technician" with no owner to chase — only a Cancel button.

## Remediated in this round (UX-owned, merged)

**Fabricated CRITICAL severity.** Rows reading `Expected 0 · Actual NaN ·
Variance NaN · Severity CRITICAL`, summarised as "5 discrepancies — 5 critical",
were read by the persona as a genuine inventory emergency. A row whose quantities
are not finite numbers is now **UNKNOWN**: quantities render as "Unknown", never
`NaN`, and severity counts are built only from rows that could actually be
evaluated, with unevaluable rows reported separately rather than folded into the
critical count. `domain/reconciliationRowHonesty.js`, 10 tests.

The upstream computation producing `NaN` remains a separate defect with a
separate owner. This stops the UI asserting something it cannot support.

This is the third independent mission to report that badge. It should not have
survived two.

## Recommendation category: **OPERATING WORKSPACE FIXES FIRST**

Not a management-surface justification, and deliberately not a route
recommendation from one mission.

The persona reached this unprompted, and the reasoning is the evidence: *"A
summary screen on top of contradictory, occasionally-crashing sources would just
be a faster way to get the wrong answer."*

A cross-cutting view aggregating three procurement surfaces that disagree would
not resolve the disagreement — it would launder it into a single confident number.
The prerequisites are ordinary operating-workspace work:

1. One shared source for procurement state across Operations Overview, Purchasing
   and the Inventory queue.
2. Link Work Orders to the specific part or back-order blocking them (the
   Service ↔ Inventory seam, already routed).
3. Surface the coordination Product truth already has — five Work Orders share a
   `salesOrderId` and the client never reads it — so "partially complete" is a
   fact the system states rather than one a manager reconstructs.
4. A service-side notion of customer commitment at risk.

**The management-surface question is NOT answered and stays open.** What this
mission establishes is that it cannot be answered yet: with the operating
workspaces contradicting each other, evidence for option B (a genuine cross-domain
exception view) is indistinguishable from evidence for option C (the workspaces
are missing context). Re-run these five questions once the prerequisites land —
that is the point at which the distinction becomes visible.

**Control Tower naming: not assessed.** Purpose is not established, and the label
must follow the purpose.

## Questions raised for later missions

Are `PRT-1001`, `PRT-1003` and `PRT-1006` related, or three unrelated "needs
attention" parts with no cross-reference? Which Work Order is `PRT-1006` actually
needed for? Why is one technician (`tech-sbx-01`) assigned nearly every job across
two customers on the same day with no workload-conflict warning?
