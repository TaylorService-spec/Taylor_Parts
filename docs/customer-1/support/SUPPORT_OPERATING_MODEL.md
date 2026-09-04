# Support Operating Model — Taylor Arizona, Day 1

**Status: DRAFT — NOT LEGAL ADVICE, NOT EXECUTED, NOT ACCEPTED BY TAYLOR.**
**Decision owner: Verenward Owner for everything Verenward commits to; Taylor
Freezer of Arizona for everything about Taylor's own people, devices, and
expectations. This document is written by Lane E and decides nothing.**
**Gate: `C1-SUPPORT-01`. Feeds `C1-COMM-01` (support revenue line) and
`C1-CONTRACT-01` (support terms).**

This is the operating model — how support actually runs on a Tuesday. It is not
the support *contract*. Where a clause would have to be committed
contractually, this document names the decision and stops.

Related: [`../commercial/COST_TO_SERVE_MODEL.md`](../commercial/COST_TO_SERVE_MODEL.md) §4
(support labor), [`../commercial/PRICING_DECISION_WORKSHEETS.md`](../commercial/PRICING_DECISION_WORKSHEETS.md)
W-3 (support revenue), [`../commercial/DECISION_REGISTER.md`](../commercial/DECISION_REGISTER.md).

## The two rules this model exists to enforce

1. **Severity is defined by what Taylor cannot do, not by how the reporter
   feels.** Generic P1/P2 language produces an argument per ticket. Severity
   here is anchored to a named business workflow being stopped.
2. **Support labor is not free.** Every hour spent here is a cost line in
   §4 of the cost model, priced at the loaded rate the Owner has not yet set
   (`CD-01`). A support model that assumes founder availability is unlimited is
   the red line the readiness ledger already names.

## 1. Intake — the one front door

There is exactly one official intake channel. Anything else is not a support
request; it is a conversation that may become one when someone files it.

| Element | Draft position | Status |
|---|---|---|
| Channel | A single monitored address or queue, Verenward-operated | Mechanism `UNKNOWN` — `CD-25` |
| Who may file | Taylor's designated administrators plus any named Day-1 role user | Needs Taylor's named list — `CD-26` |
| Required in a report | Who, what workflow, what record (WO/PO/SO number), what was expected, what happened, when it started, how many people are affected | Draft |
| Acknowledgement | Verenward states the severity it assigned back to the reporter, in the reply | Draft |
| Disagreement on severity | Reporter may contest once; the escalation path in §4 settles it | Draft |

Out-of-channel requests (text message, hallway, phone call to the founder) are
logged into the same queue before work starts, or they do not exist for
response-time purposes. This is not bureaucracy — it is the only way the labor
in §4 of the cost model can ever be measured.

**Open issues.** No channel is chosen. No Taylor reporter list exists. Nothing
here has been agreed with Taylor.

## 2. Severity — tied to real Day-1 workflows

Day-1 scope is **not frozen** (`C1-SCOPE-01`, Lane A). The workflow families
below are the ones the cost model already assumes carry volume. If Lane A
freezes a different set, this table is wrong and must be reissued — that is a
known dependency, not an oversight.

| Sev | Plain definition | Day-1 examples |
|---|---|---|
| **S1 — Stopped** | A named Day-1 workflow cannot be completed by anyone, and there is no workaround Taylor can run itself. Money or field work halts. | Nobody can log in. Technicians cannot open or close work orders. Receiving cannot record an inbound shipment at all. No invoice can be produced. |
| **S2 — Degraded** | The workflow completes, but only via a workaround that costs materially more time, or it is wrong for a subset of users/records. | One technician cannot see assigned work but others can. Parts issue against a work order fails for one warehouse. A report shows stale numbers. Inventory counts are wrong for one location. |
| **S3 — Impaired** | Something is wrong or confusing, work continues, and the cost is annoyance rather than throughput. | A field label is misleading. A list sorts oddly. A screen is slow but usable. |
| **S4 — Question / request** | Not a defect. A how-do-I, a data question, an access request, or a change someone wants. | "How do I reassign a work order?" "Add a column here." "New user starts Monday." |

Rules that stop the arguing:

- **Severity is assessed at intake by Verenward, from the reported facts.** A
  reporter's stated urgency is an input, not the answer.
- **A workaround Taylor can actually run downgrades S1 to S2.** "Someone at
  Verenward can do it manually" is *not* a workaround — that is an S1 with a
  Verenward-labor bandage, and the readiness ledger treats undocumented manual
  intervention in a critical workflow as a red line.
- **Severity can be lowered as facts arrive**, and the change is stated to the
  reporter with the reason.
- **Scope of impact is a severity input, not a separate axis.** One user
  blocked on a workflow others can run is S2, not S1.

**Open issues.** Day-1 scope is unfrozen, so the example column is provisional.
No response or resolution *times* appear in this table on purpose — those are a
contractual commitment the Owner has not made (`CD-13`). Severity definitions
are drafted but not accepted by Taylor (`CD-27`).

## 3. Response expectations — the shape, not the numbers

Verenward has not committed to any response time. What is drafted is the
*structure* such a commitment would take, so that the Owner is deciding a
number rather than inventing a framework under pressure.

| Sev | Committed thing | Draft shape | Number |
|---|---|---|---|
| S1 | Time to first human response, and continuous effort until degraded or resolved | Business-hours clock unless off-hours coverage is purchased (`CD-06`) | `UNDECIDED` — `CD-13` |
| S2 | Time to first human response, and a stated plan | Business-hours clock | `UNDECIDED` — `CD-13` |
| S3 | Time to acknowledge and triage into a backlog | Business-hours clock | `UNDECIDED` — `CD-13` |
| S4 | Time to acknowledge; fulfilment is scheduled, not immediate | Business-hours clock | `UNDECIDED` — `CD-13` |

Two structural points the Owner must decide alongside the numbers:

- **Response is not resolution.** Committing to a resolution time for a defect
  of unknown cause is a commitment to an unknown amount of labor. The draft
  position is to commit to response and to communication cadence only.
- **A coverage window is a cost even when nothing breaks** if it is sold as
  availability rather than as consumed hours (`CD-06`).

**Open issues.** Every number in this section is undecided. Business hours
themselves are undefined — Taylor's field operations may start before, and end
after, any window Verenward would staff (`CD-13`, `CD-28`).

## 4. Escalation

Escalation is what happens when the normal path is not working, and it must be
honest about the fact that Verenward is currently very small.

1. **Level 1 — queue.** Intake, severity assignment, triage, known-issue and
   how-to answers, access requests.
2. **Level 2 — platform engineering.** Reproduce, diagnose, fix or produce a
   workaround. Today this is the same small group as Level 1.
3. **Level 3 — Owner.** Anything that requires a commercial decision, a
   production-data action, a Rules or authorization change, a scope
   concession, or a commitment Verenward has not already contracted to.

Escalation triggers, drafted:

- An S1 open past its first-response commitment, or with no workaround.
- Any request to act on production data or change access beyond routine
  administration.
- Any dispute about severity, about the bug-vs-enhancement boundary, or about
  whether the work is in scope.
- Anything that would cost Verenward materially more than the support line
  prices.

**Open issues.** Levels 1 and 2 are the same people; there is no coverage when
that person is unavailable, and no answer for it (`CD-29`). Taylor's side of
escalation — who at Taylor is authorized to escalate and to accept a
resolution — is unnamed (`CD-26`).

## 5. Bug versus enhancement

The single most expensive undefined boundary in this lane. It decides who pays
for a large class of work, and both parties will apply it under pressure.

Draft test, stated as one question: **does the system behave as accepted?**

| Case | Draft classification | Who pays |
|---|---|---|
| Behaves contrary to accepted, documented behaviour | **Bug** | Verenward, under support |
| Behaves as accepted, but the accepted behaviour is wrong for Taylor | **Enhancement** | Change request / billable |
| Behaves as accepted; Taylor's process changed | **Enhancement** | Change request / billable |
| Never worked, was never accepted, and was in Day-1 scope | **Implementation defect** | Implementation, not support |
| Never existed and was outside Day-1 scope | **New scope** | Billable custom work |
| Broke after a Verenward change | **Regression = bug** | Verenward, under support |
| Broke after a Taylor-side change (device, network, identity, third-party) | **Not a platform defect** | §6 |

This test depends on there *being* an accepted, documented baseline. Today the
authorities are the North Star page-family acceptance records and the training
guides — which do not yet cover every Day-1 workflow. Where no accepted
baseline exists, the classification is genuinely ambiguous and the honest
answer is to escalate rather than to assert.

**Open issues.** The boundary is drafted but not agreed (`CD-11`). The
acceptance baseline it depends on is incomplete. There is no agreed record of
"accepted behaviour" that both parties can point at during a dispute
(`CD-30`).

## 6. Third-party IT responsibility

Verenward supports the platform. It does not support Taylor's IT estate, and
the line has to be explicit before the first printer fails on a Tuesday.

| Thing | Draft owner | Note |
|---|---|---|
| Application defects, data integrity, platform availability | Verenward | The product |
| Cloud platform outage (Firebase/Google) | Verenward communicates; cannot resolve | Sets an availability-commitment limit |
| Workstations, tablets, phones, their OS and browser | Taylor / Taylor's IT | Including "the browser is five versions old" |
| Network, wifi, cellular coverage in the shop and in the field | Taylor / Taylor's IT | A common S1 report that is not a platform defect |
| Printers, label printers, barcode scanners, their drivers | Taylor / Taylor's IT | Hardware integration expectations are unstated |
| Email delivery, spam filtering | Taylor / Taylor's IT | Affects notifications and invitations |
| Identity provider and account lifecycle for Taylor staff | **Undecided** | Depends on the Day-1 identity model (`C1-IDENTITY-01`) |
| Existing accounting/ERP systems and any interface to them | **Undecided** | Depends on frozen Day-1 scope |

Draft operating rule: Verenward triages a report far enough to say which side
of this line it falls on, and says so plainly. That triage is Verenward labor
even when the answer is "not ours" — a real cost, currently unpriced.

**Open issues.** The whole table is a proposal, not an agreement (`CD-12`).
Taylor may have no IT function at all, in which case the "Taylor / Taylor's IT"
rows have no operator and every one of them lands back on Verenward as unpriced
labor (`CD-31`).

## 7. What this model deliberately does not do

- Does not commit to a response time, a resolution time, an availability
  percentage, or an uptime credit.
- Does not price support. Support pricing is worksheet W-3.
- Does not define off-hours or emergency coverage; that posture is `CD-06`.
- Does not create a support contract. Contract language is `C1-CONTRACT-01`.
- Does not assume Taylor accepts any of it.

## Open issues

- Nothing in this document has been agreed with Taylor or committed by the
  Owner. It is a draft operating model, and `C1-SUPPORT-01` requires the model
  to be *operational and contracted*, which it is not.
- Day-1 scope is unfrozen, so the workflows severity is anchored to are
  provisional.
- Every response-time number is `UNDECIDED`.
- The bug-vs-enhancement test depends on an acceptance baseline that does not
  yet exist for every Day-1 workflow.
- No tooling exists for the intake queue, so support labor is currently
  unmeasurable — which means §4 of the cost model cannot be validated against
  reality even after Day 1.

## Consumers of this document

- `C1-SUPPORT-01` — this is the operating-model half of the gate; the
  contracted half is not written.
- `C1-COMM-01` — worksheet W-3 prices what this model describes.
- `C1-CONTRACT-01` — support terms will be drafted from §§1–6, not invented
  separately.
