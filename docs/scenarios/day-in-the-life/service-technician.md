# Day-in-the-Life Activity Library — Service + Technician Domains

**Lane P3-B1.** 330 activities across 33 business stories, covering service coordination, technician field work, the Work Order lifecycle, scheduling and dispatch, equipment service context, inbound work intake, and the mobile and after-hours realities of field service at Taylor Freezer of Arizona.

Machine-readable companion: [`service-technician.json`](./service-technician.json).

> **Nothing in this library has been executed.** No activity was run against any real or production system, and no production write of any kind was made. Every `executionResult` is `NOT_RUN`. **No activity is labelled `PASS`, and an unexecuted activity may never be.**

Authored against integrated head `d104cf49`. Every assertion about system behaviour cites `path:line`. Where an activity describes behaviour that *should* exist rather than behaviour that *does*, it is marked `behaviourClaim: DESIRED` and says so in the text. Where this lane did not verify a claim, the activity says `UNPROVEN` rather than guessing.

## Contents

1. [How to read an activity](#how-to-read-an-activity)
2. [Coverage](#coverage)
3. [Cast](#cast)
4. [The stories](#the-stories)
5. [Execution-harness specification](#execution-harness-specification)
6. [The defects these scenarios would catch](#the-defects-these-scenarios-would-catch)

## How to read an activity

Each activity is one thing a named person does, in one operating company, against real records, with a stated expected outcome on every axis the platform cares about:

| Field | What it records |
| --- | --- |
| Persona / role / operating company | Who acts, under which authority, for `taylor` or `ventana` |
| Account context | The customer and machine the activity touches, where relevant |
| Starting records and state | What must already exist for the activity to make sense |
| Business purpose | Why a real person would do this |
| Preconditions | What must be true before the action |
| Action | The single thing done |
| Expected EOS state transition | The lifecycle or record change, cited to the transition table |
| Expected authority / capability | Which capability or role governs it, and what refuses it |
| Expected UI result | What the person should see |
| Expected audit result | What history should record |
| Expected cross-object effect | What else moves — inventory, counters, capacity, custody |
| Exception / recovery behaviour | What happens when it goes wrong, and whether recovery exists |
| Device context | `MOBILE` or `DESKTOP` |
| Coverage categories | Which of the 20 required categories the activity exercises |
| AI opportunity | `SHORTEN` · `CLASSIFY` · `DRAFT` · `EXPLAIN` · `NOISE` · `NONE` |
| Help / ⓘ opportunity | Where an explainer would earn its place, or why one would not |
| Reset / replay notes | What a harness must do to run it again honestly |
| Friction score | Eleven flags, from “had to hunt” through “ownership unclear” |
| Evidence | `path:line` for every behavioural assertion |
| Defects this would catch | The concrete failure the activity is designed to expose |

## Coverage

### Required coverage categories

| Category | Activities |
| --- | ---: |
| NORMAL | 74 |
| EXCEPTION | 55 |
| MISTAKE | 11 |
| RECOVERY | 33 |
| HANDOFF | 34 |
| BAD_DATA | 51 |
| MISSING_DATA | 94 |
| DUPLICATE_DATA | 12 |
| PERMISSION_DENIAL | 32 |
| CROSS_COMPANY | 29 |
| MOBILE | 118 |
| DESKTOP | 212 |
| AFTER_HOURS | 10 |
| BULK | 31 |
| END_OF_DAY | 18 |
| END_OF_MONTH | 39 |
| NETWORK_INTERRUPTION | 15 |
| BACK_BUTTON_ABANDONED_FLOW | 9 |
| RETRY_IDEMPOTENCY | 13 |
| UNUSUAL_BUT_LEGITIMATE | 31 |

*Activities carry more than one category, so the column sums above 330.*

*`MOBILE` and `DESKTOP` were 119 and 213 on first publication — 332 against 330 activities,
while the device-context split below read 212/118. Two activities carried both tags. Corrected
by lane P3-DIL-FIX; see "Corrections" at the end of this document.*

### Role distribution

| Role | Activities |
| --- | ---: |
| field_technician | 104 |
| service_coordinator | 68 |
| dispatcher | 61 |
| service_manager | 60 |
| service_billing_admin | 18 |
| apprentice_technician | 9 |
| after_hours_coordinator | 5 |
| parts_counter | 5 |

### Persona distribution

| Persona | Activities |
| --- | ---: |
| Curtis Nally | 67 |
| Priya Raman | 60 |
| Dale Brackett | 55 |
| Marisol Vega | 49 |
| Javier Ochoa | 22 |
| Rosa Delgado | 19 |
| Amanda Foy | 18 |
| Tonya Reese | 15 |
| Wes Tanner | 9 |
| Brett Hollins | 6 |
| Ken Iwata | 5 |
| Nate Purcell | 5 |

### Operating company, device, AI, behaviour claim

| Dimension | Split |
| --- | --- |
| Operating company | taylor 290 · ventana 40 |
| Device context | DESKTOP 212 · MOBILE 118 |
| AI opportunity | CLASSIFY 16 · DRAFT 12 · EXPLAIN 21 · NOISE 25 · NONE 176 · SHORTEN 80 |
| Behaviour claim | CURRENT 321 · DESIRED 9 |

### Friction flags raised

| Friction signal | Activities |
| --- | ---: |
| no obvious "what next?" location | 142 |
| no obvious "why?" location | 117 |
| had to hunt for necessary information | 89 |
| recovery unclear | 80 |
| ownership unclear | 75 |
| role handoff unclear | 56 |
| operating-company attribution unclear | 29 |
| AI could materially shorten the task | 28 |
| help missing when needed | 18 |
| AI would be noise here | 3 |
| unnecessary explanation permanently occupies the page | 1 |

## Cast

Taylor Freezer of Arizona services commercial ice machines, soft-serve freezers and frozen-beverage equipment across Phoenix and Tucson. Two operating companies — **taylor** and **ventana** — sell and service from one shared account base, one technician roster and one Work Order collection.

| Persona | Role | Company | Usual device |
| --- | --- | --- | --- |
| Marisol Vega | service_coordinator | taylor | DESKTOP |
| Rosa Delgado | service_coordinator | ventana | DESKTOP |
| Dale Brackett | dispatcher | taylor | DESKTOP |
| Brett Hollins | dispatcher | ventana | DESKTOP |
| Priya Raman | service_manager | taylor | DESKTOP |
| Ken Iwata | after_hours_coordinator | taylor | MOBILE |
| Curtis Nally | field_technician | taylor | MOBILE |
| Javier Ochoa | field_technician | taylor | MOBILE |
| Tonya Reese | field_technician | ventana | MOBILE |
| Wes Tanner | apprentice_technician | taylor | MOBILE |
| Amanda Foy | service_billing_admin | taylor | DESKTOP |
| Nate Purcell | parts_counter | taylor | DESKTOP |

Recurring customers: Sonoran Scoops Creamery (Taylor C712/C713 soft-serve, four stores) · QuikMart Southwest and QuikMart #418 (62 c-stores, Manitowoc ice and FBD frozen beverage, split across both companies) · Desert Ice & Cold Storage, Tolleson (Vogt P24AL tube-ice plant) · Cactus Burger Co. (Taylor C602 shake machines) · Camelback Convention Center (banquet ice) · Rio Salado High School District · Tucson Gas & Go (Taylor 349 frozen beverage) · Pima Pediatrics Clinic (Scotsman nugget ice).

## The stories

### P3B1-S01 — Monday 06:40 - the weekend's email pile lands in the inbound queue

**Account context.** Mixed: Sonoran Scoops Creamery, QuikMart #418, Cactus Burger Co. #12

Marisol opens the service mailbox queue before the phones start. Over the weekend the service@ mailbox took eleven messages: three genuine machine-down calls, a manufacturer recall notice, two 'just checking on my part', a spam invoice, one message from a Ventana-billed c-store chain that landed in the Taylor mailbox, and a resend of Friday's message whose original she already turned into a Work Order. Everything she does here decides whether a technician's Tuesday is real work or a wasted drive.

<details><summary>10 activities — P3B1-S01-A01 · P3B1-S01-A02 · P3B1-S01-A03 · P3B1-S01-A04 · P3B1-S01-A05 · P3B1-S01-A06 · P3B1-S01-A07 · P3B1-S01-A08 · P3B1-S01-A09 · P3B1-S01-A10</summary>

#### P3B1-S01-A01 — Open the inbound work queue and read the overnight backlog

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed: Sonoran Scoops Creamery, QuikMart #418, Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | 11 inbound_work_requests: 8 AWAITING_DECISION, 2 NEEDS_REVIEW, 1 QUARANTINED. No Work Orders created yet from any of them. |
| **Business purpose** | Decide, before dispatch builds the day, which of the weekend's emails are real service demand. |
| **Preconditions** | — Marisol signed in as a Taylor service coordinator<br>— Inbound email transport has polled and staged the weekend messages<br>— At least one routing rule exists |
| **Action** | Navigate to the Inbound Work queue and sort by received time ascending. |
| **Expected EOS state transition** | None. Reading the queue changes no inbound_work_request status; AWAITING_DECISION and NEEDS_REVIEW are both still decidable (DECIDABLE_STATUSES). |
| **Expected authority / capability** | Read of the inbound work queue. The read service is a callable, not a client collection read. |
| **Expected UI result** | A list of 11 rows with sender, subject, normalized body preview, status chip, and routing classification. |
| **Expected audit result** | No audit event. A read is not an event. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | If the transport has not polled, the queue is empty and indistinguishable from 'no weekend demand'. The screen must say when it last successfully polled, not just show zero rows. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | An (i) on the status chip explaining the difference between AWAITING_DECISION and NEEDS_REVIEW - 'same queue, louder' is in the code comment and nowhere on screen. |
| **Reset / replay** | Reset = delete the seeded inbound_work_requests and re-seed from a fixture of 11 provider messages. No WO side effects to unwind because nothing was decided. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:32-46 (INBOUND_WORK_STATUSES)`<br>`functions/src/inboundWork/inboundWorkModel.ts:50-53 (DECIDABLE_STATUSES)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | An empty queue caused by a dead poller is presented identically to a genuinely quiet weekend. |

#### P3B1-S01-A02 — Accept a genuine machine-down email and let it create a Work Order

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Cactus Burger Co. #12, 4400 N 24th St Phoenix - Taylor C602 shake machine

| | |
| --- | --- |
| **Starting records / state** | inbound_work_request status AWAITING_DECISION, requestType SERVICE, resolved to account Cactus Burger Co. and location #12. |
| **Business purpose** | Turn a customer's 'our shake machine is blowing the breaker' email into governed service demand. |
| **Preconditions** | — The request is in a DECIDABLE status<br>— Candidate account/location resolution produced exactly one match |
| **Action** | Click Accept, confirm the resolved account/location and the SERVICE_CALL type, submit. |
| **Expected EOS state transition** | inbound_work_request AWAITING_DECISION -> ACCEPTED, and a new Work Order is created in CREATED. Not READY_TO_DISPATCH - only the MarkReady action reaches that. |
| **Expected authority / capability** | workOrder.create. The accept path runs server-side and allocates the WO number inside the same transaction that writes the WO doc. |
| **Expected UI result** | Confirmation naming the new woNumber (WO-2026-0000NN) and a link to the Work Order. |
| **Expected audit result** | Two staged audit events on the accept: 'accepted inbound request and created work order <woNumber>' and 'created work order <woNumber> from inbound request <id>'. |
| **Expected cross-object effect** | Work Order created; inbound request now carries workItemId and woNumber. |
| **Exception / recovery** | If the transaction fails mid-way neither the counter increment nor the WO doc commits, so no number is burned. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | A 'why is this CREATED and not ready to dispatch?' explainer at the status chip on the resulting WO. |
| **Reset / replay** | Replay-safe by design: the command is keyed and a second accept returns {replayed:true} with the same woNumber rather than a second WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task |
| **Evidence** | `functions/src/inboundWork/inboundDecisionCommands.ts:87-115 (replay returns existing woNumber)`<br>`functions/src/inboundWork/inboundDecisionCommands.ts:211-221 (audit summaries)`<br>`functions/src/createWorkOrder.ts:78-100`<br>`functions/src/transitionEngine.ts:39-51 (CREATED -> READY_TO_DISPATCH)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S01-A03 — Press Accept twice because the first click seemed to hang

*Marisol Vega (service_coordinator) · taylor · DESKTOP · RETRY_IDEMPOTENCY, DUPLICATE_DATA, DESKTOP*

**Account context.** Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | The same inbound_work_request as the previous activity; the first Accept has committed but the response has not reached the browser. |
| **Business purpose** | Prove that an impatient double-submit cannot mint two Work Orders for one customer email. |
| **Preconditions** | — The first Accept committed server-side<br>— The client has not yet rendered the result |
| **Action** | Click Accept a second time within a few seconds. |
| **Expected EOS state transition** | No second transition. The replay path finds the already-created Work Order and returns it. |
| **Expected authority / capability** | Same authority; idempotency is a property of the command, not of the caller. |
| **Expected UI result** | DESIRED: the UI should show the same confirmation with the same woNumber, and say plainly 'already accepted - this is the Work Order that was created'. Whether the current UI distinguishes replay from first-accept is UNPROVEN by this lane. |
| **Expected audit result** | CURRENT: the replay path returns before staging a second pair of audit events, so history shows one acceptance, not two. |
| **Expected cross-object effect** | No second Work Order, no second woNumber allocated, no second counter increment. |
| **Exception / recovery** | If the UI silently renders the replayed result as if it were new, the coordinator learns nothing; if it errors, she may create a duplicate WO by hand instead. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | A 'what happened?' line distinguishing 'created just now' from 'already created at 06:44 by you'. |
| **Reset / replay** | No reset needed - this is the reset-safe path. To re-run, clear the request's workItemId. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/inboundWork/inboundDecisionCommands.ts:87-115 (replayed:true, same woNumber)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A replayed accept rendered as a fresh success teaches coordinators that double-clicking is harmless, which is only true here. |

#### P3B1-S01-A04 — Decline a spam invoice that reached the service mailbox

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, BAD_DATA, DESKTOP*

**Account context.** n/a - unresolved sender, no account match

| | |
| --- | --- |
| **Starting records / state** | inbound_work_request NEEDS_REVIEW, no candidate account resolved, body is a fake overdue-invoice notice. |
| **Business purpose** | Keep non-work out of the service pipeline without deleting the evidence that it arrived. |
| **Preconditions** | — The request is in a DECIDABLE status |
| **Action** | Click Decline and select reason INVALID_REQUEST. |
| **Expected EOS state transition** | inbound_work_request NEEDS_REVIEW -> DECLINED. No Work Order is created. |
| **Expected authority / capability** | Inbound decision authority; distinct from workOrder.create because declining creates nothing. |
| **Expected UI result** | The row leaves the working queue and remains findable under a Declined filter. |
| **Expected audit result** | An audit event recording the decline and its reason code. |
| **Expected cross-object effect** | None. Declining does not touch accounts, equipment or Work Orders. |
| **Exception / recovery** | If the wrong reason is chosen there is no in-place edit of a decline reason; recovery is UNPROVEN by this lane and likely requires re-intake. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | Reason-code definitions on hover - INVALID_REQUEST vs CUSTOMER_ACCOUNT_ISSUE is not self-evident. |
| **Reset / replay** | Re-seed the request in AWAITING_DECISION; a DECLINED record is not re-decidable. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | recovery unclear |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:55-63 (INBOUND_DECLINE_REASONS)`<br>`functions/src/inboundWork/inboundWorkModel.ts:50-53` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S01-A05 — Try to decide a request that a colleague already accepted while the page was open

*Marisol Vega (service_coordinator) · taylor · DESKTOP · EXCEPTION, HANDOFF, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave

| | |
| --- | --- |
| **Starting records / state** | The row still renders AWAITING_DECISION in Marisol's stale browser tab; the stored status is ACCEPTED. |
| **Business purpose** | Two coordinators work the same queue; the second one must not be able to double-decide. |
| **Preconditions** | — Another coordinator accepted the request after this page loaded |
| **Action** | Click Decline on the stale row. |
| **Expected EOS state transition** | No transition. ACCEPTED is not in DECIDABLE_STATUSES, so the command refuses. |
| **Expected authority / capability** | Authority is present; the refusal is a state guard, not a permission failure. The UI must not blame the user's role. |
| **Expected UI result** | DESIRED: 'This request was accepted by Dale Brackett at 06:51 and became WO-2026-000141.' CURRENT wording is UNPROVEN by this lane. |
| **Expected audit result** | A refused command should leave no state-change event. Whether refusals are themselves audited is UNPROVEN. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The row must refresh in place to the real status rather than leaving the coordinator staring at a status the server disagrees with. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'Who decided this, and what did it become?' is the question, and there is no obvious place on the row to answer it. |
| **Reset / replay** | Seed two sessions; reset by restoring the request to AWAITING_DECISION. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:50-53 (DECIDABLE_STATUSES excludes ACCEPTED)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S01-A06 — Work a NEEDS_REVIEW request whose sender matches two accounts

*Marisol Vega (service_coordinator) · taylor · DESKTOP · CROSS_COMPANY, MISSING_DATA, DESKTOP*

**Account context.** Ambiguous: QuikMart Southwest (ventana) vs QuikMart #418 store-level (taylor)

| | |
| --- | --- |
| **Starting records / state** | inbound_work_request NEEDS_REVIEW, candidate resolution returned two accounts, one per operating company. |
| **Business purpose** | A c-store chain buys ice machines through Ventana and soft-serve through Taylor; the wrong pick bills the wrong company. |
| **Preconditions** | — Candidate resolution produced more than one match |
| **Action** | Open the candidate list and choose the correct account. |
| **Expected EOS state transition** | Still NEEDS_REVIEW until a decision is submitted; choosing a candidate is not itself a decision. |
| **Expected authority / capability** | Inbound decision authority. Note: the Work Order that results will carry NO operatingCompanyId field - the WorkOrder type has none. |
| **Expected UI result** | A candidate picker showing account name and (DESIRED) operating company for each. Whether operating company is shown today is UNPROVEN. |
| **Expected audit result** | The eventual accept records which candidate was chosen. |
| **Expected cross-object effect** | Account choice determines the location, the equipment register scope, and downstream billing - but not the WO's company, because the WO records none. |
| **Exception / recovery** | Picking wrong is recoverable only by cancelling the resulting Work Order and re-intaking; there is no 'move this WO to the other company'. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | The candidate rows are exactly where an operating-company badge belongs and is the single highest-value (i) in this story. |
| **Reset / replay** | Seed two accounts with overlapping sender domains. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · help missing when needed · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/types/workOrder.ts (no operatingCompanyId on the WorkOrder interface)`<br>`functions/src/ownership/operatingCompanyAuthority.ts:23-24` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A Work Order created from a cross-company-ambiguous email carries no company attribution at all, so the mistake is invisible after the fact. |

#### P3B1-S01-A07 — Attach a follow-up email to the Work Order it belongs to instead of creating a second one

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | A second message on the same thread ('it's doing it again this morning'), status AWAITING_DECISION. WO-2026-000141 exists in CREATED. |
| **Business purpose** | One machine fault is one Work Order, however many emails the customer sends about it. |
| **Preconditions** | — The target Work Order exists and is not terminal |
| **Action** | Choose Attach to existing Work Order, search WO-2026-000141, confirm. |
| **Expected EOS state transition** | inbound_work_request AWAITING_DECISION -> ATTACHED. The Work Order's own status does not move. |
| **Expected authority / capability** | Inbound decision authority. Attaching does not require workOrder.transition because nothing transitions. |
| **Expected UI result** | The request shows as attached, with the woNumber; the Work Order should show the attached correspondence. |
| **Expected audit result** | 'attached inbound request to work order <woNumber>'. |
| **Expected cross-object effect** | The Work Order gains correspondence context; no lifecycle effect. |
| **Exception / recovery** | Attaching to the wrong WO has no visible undo in this lane's reading - UNPROVEN whether detach exists. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'Attach or create?' is the decision; a one-line rule at the choice point would settle it. |
| **Reset / replay** | Restore the request to AWAITING_DECISION and clear its workOrderId. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · recovery unclear |
| **Evidence** | `functions/src/inboundWork/inboundDecisionCommands.ts:330 (attach audit summary)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S01-A08 — Find the duplicate resend of Friday's message already marked DUPLICATE

*Marisol Vega (service_coordinator) · taylor · DESKTOP · DUPLICATE_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler

| | |
| --- | --- |
| **Starting records / state** | An inbound_work_request in DUPLICATE: the same provider message id was taken in on Friday. |
| **Business purpose** | Confirm the duplicate really is the same request and not a second, genuinely new fault. |
| **Preconditions** | — Intake detected a repeated provider message id |
| **Action** | Open the DUPLICATE row and compare it to the original request and its Work Order. |
| **Expected EOS state transition** | None. DUPLICATE is not decidable. |
| **Expected authority / capability** | Read only. |
| **Expected UI result** | DESIRED: the duplicate row links straight to the original request and to the Work Order the original produced. Whether it does is UNPROVEN. |
| **Expected audit result** | No new event. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A duplicate by message id is not the same as a duplicate by intent - a customer forwarding their own message creates a new id and will NOT be caught here. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | 'Why was this marked duplicate?' - the criterion is provider message id, and that is worth saying on the row. |
| **Reset / replay** | Re-seed both messages with the same provider id. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:32-46 (DUPLICATE: 'The same provider message id was already taken in')` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Intent-level duplicates (customer forwards their own email, or calls and emails) are not detected; two Work Orders for one fault is the field consequence. |

#### P3B1-S01-A09 — Inspect a QUARANTINED message and confirm it must not be worked from

*Marisol Vega (service_coordinator) · taylor · DESKTOP · EXCEPTION, BAD_DATA, DESKTOP*

**Account context.** Unknown mailbox - sender not on any account

| | |
| --- | --- |
| **Starting records / state** | inbound_work_request QUARANTINED: refused before review, unknown mailbox. |
| **Business purpose** | Quarantine is a security boundary; a coordinator must be able to see why without being able to release blindly. |
| **Preconditions** | — Routing refused the message before review |
| **Action** | Open the quarantined record and read the normalized body and the quarantine reason. |
| **Expected EOS state transition** | None. QUARANTINED is not decidable. |
| **Expected authority / capability** | Read. There is no coordinator-level release-from-quarantine path in this lane's reading; if releasing is required, that is MISSING_CAPABILITY. |
| **Expected UI result** | Normalized (HTML-stripped, bounded) body only - never rendered markup. |
| **Expected audit result** | No new event. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A legitimate customer emailing from a new address quarantines. The recovery is to add the address to the account, then ask them to resend - slow, and the screen should say so. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'This is quarantined because we do not recognise the sender. Here is how to make the next one land.' |
| **Reset / replay** | Seed an unknown-mailbox message. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:32-46 (QUARANTINED)`<br>`functions/src/inboundWork/inboundWorkModel.ts:10-17 (normalized, HTML stripped, bounded)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No governed release-from-quarantine path means a real emergency from a new address has no fast route in. |

#### P3B1-S01-A10 — Leave the queue with two rows undecided and hand them to the afternoon coordinator

*Marisol Vega (service_coordinator) · taylor · DESKTOP · HANDOFF, END_OF_DAY, DESKTOP*

**Account context.** Mixed: Sonoran Scoops Creamery, QuikMart #418, Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | Nine of eleven rows decided; two NEEDS_REVIEW remain pending a callback to the customer. |
| **Business purpose** | An honest handoff at shift change is the difference between a pending item and a lost one. |
| **Preconditions** | — Two requests remain in NEEDS_REVIEW |
| **Action** | Add a note to each remaining row explaining what is blocking it, then close the queue. |
| **Expected EOS state transition** | None; both stay NEEDS_REVIEW. |
| **Expected authority / capability** | Note authorship. Whether a per-request note or assignment field exists is UNPROVEN by this lane; if it does not, this is MISSING_CAPABILITY and the handoff happens in chat instead. |
| **Expected UI result** | DESIRED: an owner and a 'waiting on' state visible on the row. |
| **Expected audit result** | DESIRED: the note is attributable. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | With no owner field, the afternoon coordinator cannot tell a row nobody has looked at from one someone is actively chasing. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | 'Who owns this row right now?' has no obvious location. |
| **Reset / replay** | None required; nothing was written. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:32-46` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No ownership on an inbound row: two coordinators either both chase it or neither does. |

</details>

### P3B1-S02 — 07:20 - the phone call that becomes a Work Order, and the number that must never repeat

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

Rosa takes a call from the plant manager at Desert Ice: the number-two Vogt is making half-size cubes and they are shipping to a grocery chain on Wednesday. She creates the Work Order by hand. This story exercises WO creation, numbering, the CREATED state, and what happens when the counter document behind woNumber is not in the state the code assumes.

<details><summary>10 activities — P3B1-S02-A01 · P3B1-S02-A02 · P3B1-S02-A03 · P3B1-S02-A04 · P3B1-S02-A05 · P3B1-S02-A06 · P3B1-S02-A07 · P3B1-S02-A08 · P3B1-S02-A09 · P3B1-S02-A10</summary>

#### P3B1-S02-A01 — Create a SERVICE_CALL Work Order by hand from a phone call

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · NORMAL, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | Account Desert Ice & Cold Storage exists with one location; equipment record for Vogt P24AL #2 exists under that location. |
| **Business purpose** | Capture a phoned-in fault as governed demand while the plant manager is still on the line. |
| **Preconditions** | — Rosa holds workOrder.create<br>— The account and location exist<br>— The equipment is registered at that location |
| **Action** | Create Work Order: type SERVICE_CALL, severity PARTIAL_OPERATION, priority 2 (High), link the Vogt, describe 'undersized cubes, harvest cycle suspect'. |
| **Expected EOS state transition** | New Work Order in CREATED. Its only legal onward moves are READY_TO_DISPATCH and CANCELLED. |
| **Expected authority / capability** | workOrder.create, held by the governed service roles. |
| **Expected UI result** | The new WO opens on its detail page showing woNumber and status CREATED. |
| **Expected audit result** | 'created work order <woNumber>' staged in the same transaction as the WO write. |
| **Expected cross-object effect** | Counter document counters/work_orders_2026 increments by one, in the same transaction. |
| **Exception / recovery** | If the transaction retries on counter contention the WO is written once; Firestore retries the loser automatically. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | Severity vs priority is two fields that sound like one; an (i) distinguishing EQUIPMENT_DOWN from priority 1 would earn its place. |
| **Reset / replay** | Delete the WO and decrement nothing - the counter must NOT be rolled back, or the next WO reuses a number. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/createWorkOrder.ts:78-100`<br>`functions/src/woNumbering.ts:44-59`<br>`functions/src/transitionEngine.ts:40 (CREATED: READY_TO_DISPATCH, CANCELLED)`<br>`functions/src/types/workOrder.ts:28-42 (Priority, Severity, WorkOrderType)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S02-A02 — Create a second Work Order at the same instant a Taylor coordinator creates one

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · NORMAL, RETRY_IDEMPOTENCY, CROSS_COMPANY, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | Two coordinators submit WO creation within the same second; both transactions read counters/work_orders_2026. |
| **Business purpose** | Two operating companies share one WO number series; concurrent creation must not collide. |
| **Preconditions** | — Two concurrent creation transactions |
| **Action** | Both submit. Observe both woNumbers. |
| **Expected EOS state transition** | Two Work Orders, both CREATED, with consecutive and distinct woNumbers. |
| **Expected authority / capability** | Both callers hold workOrder.create. |
| **Expected UI result** | Each coordinator sees their own number; neither sees the collision that Firestore resolved. |
| **Expected audit result** | Two creation events, two distinct woNumbers. |
| **Expected cross-object effect** | Counter sequence advances by exactly two. |
| **Exception / recovery** | Firestore detects the read/write conflict on the counter doc and retries the loser automatically - this is the documented mechanism, not a hope. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None needed; this should be invisible. |
| **Reset / replay** | Delete both WOs; leave the counter advanced. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear |
| **Evidence** | `functions/src/woNumbering.ts:6-19 (transaction-safety contract)`<br>`functions/src/woNumbering.ts:44-59` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S02-A03 — Create a Work Order after the year counter document has been lost

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · BAD_DATA, DUPLICATE_DATA, EXCEPTION, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | counters/work_orders_2026 has been deleted (restore-from-backup, manual cleanup, or a botched environment copy). 140 Work Orders already exist with 2026 numbers. |
| **Business purpose** | This is the single highest-value defect scenario in WO creation and it is trivially reachable in a restored environment. |
| **Preconditions** | — The counter document for the current year does not exist<br>— Work Orders bearing 2026 numbers already exist |
| **Action** | Create one new Work Order. |
| **Expected EOS state transition** | A Work Order is created in CREATED - and it is numbered WO-2026-000001, because the allocator treats a missing counter as sequence 0. |
| **Expected authority / capability** | workOrder.create; authority is not the failure here. |
| **Expected UI result** | CURRENT: nothing warns. The coordinator is shown a number that already belongs to another Work Order. |
| **Expected audit result** | An audit event naming a woNumber that is now ambiguous - two records in history claim the same human identifier. |
| **Expected cross-object effect** | There is no unique constraint on woNumber, so the write succeeds. Every downstream reference by number (invoices, customer emails, technician paperwork) is now ambiguous. |
| **Exception / recovery** | No recovery path exists in-product. Detection requires a query for duplicate woNumbers that nothing runs. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | Not a help problem - a constraint problem. |
| **Reset / replay** | Reset = delete the counter doc and pre-seed 140 numbered WOs. Replay = recreate the counter at the correct high-water mark. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/woNumbering.ts:50 ('const sequence = snap.exists ? ... + 1 : 1')`<br>`functions/src/woNumbering.ts:6-11 (the 'never reused' claim rests entirely on the counter existing)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | woNumber silently restarts at 000001 when the counter document is absent. The file's own header promises 'Never reused'; that promise holds only while the counter survives. No unique constraint on woNumber catches the collision. |

#### P3B1-S02-A04 — Attempt to set the Work Order straight to READY_TO_DISPATCH at creation

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · PERMISSION_DENIAL, NORMAL, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | The creation form is open. |
| **Business purpose** | Coordinators want to skip a click for an obviously-ready job; the model must not let the initial status be chosen. |
| **Preconditions** | — Rosa holds workOrder.create |
| **Action** | Look for a status selector on the creation form; attempt to create in READY_TO_DISPATCH. |
| **Expected EOS state transition** | Not possible. Creation produces CREATED; READY_TO_DISPATCH is reachable only via the MarkReady action. |
| **Expected authority / capability** | MarkReady is admin/dispatcher only, so a coordinator without the dispatcher role could not reach it even if creation offered it. |
| **Expected UI result** | No status selector should exist on the creation form. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | If a coordinator cannot MarkReady, every WO she creates waits for a dispatcher - which is correct, and the screen should say so rather than leaving her wondering. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'What happens next to this Work Order, and who does it?' - the exact gap. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:68-80 (ACTION_TO_STATUS)`<br>`functions/src/transitionEngine.ts:129 (MarkReady: admin/dispatcher)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S02-A05 — Create a Work Order against an account whose location has no registered equipment

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · MISSING_DATA, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Pima Pediatrics Clinic, Tucson - Scotsman CU50 nugget machine, never registered

| | |
| --- | --- |
| **Starting records / state** | Account and location exist; the equipment register holds nothing at that location. |
| **Business purpose** | Real service demand routinely arrives for machines nobody has registered yet. |
| **Preconditions** | — Account and location exist<br>— No equipment records at the location |
| **Action** | Create the Work Order and try to link equipment. |
| **Expected EOS state transition** | Work Order created in CREATED with no equipment link. |
| **Expected authority / capability** | workOrder.create. Equipment creation is a separate authority; whether Rosa holds it is a distinct question. |
| **Expected UI result** | An empty equipment picker. DESIRED: 'no equipment registered at this location - register it, or proceed without.' |
| **Expected audit result** | The WO creation event records no equipment. |
| **Expected cross-object effect** | Equipment locationId resolves into the CRM locations collection and is validated against the location's accountId - so registering it later requires a location that matches the account. |
| **Exception / recovery** | A WO with no equipment cannot carry model-specific parts guidance, and the technician discovers the gap on site. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | The empty picker is where 'register this machine' belongs. |
| **Reset / replay** | Seed an account+location with no equipment. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · help missing when needed · no obvious "what next?" location |
| **Evidence** | `firestore.rules:1439-1442 (equipment locationId must exist in /locations and its accountId must match)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S02-A06 — Cancel a Work Order created in error two minutes earlier

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · MISTAKE, RECOVERY, PERMISSION_DENIAL, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | WO in CREATED, created against the wrong location. |
| **Business purpose** | A mis-created WO must be cancellable immediately and visibly, not quietly deleted. |
| **Preconditions** | — The WO is in CREATED |
| **Action** | Cancel with a reason. |
| **Expected EOS state transition** | CREATED -> CANCELLED. CANCELLED is terminal - no outgoing transitions at all. |
| **Expected authority / capability** | Cancel is admin/dispatcher only. A service coordinator without that role CANNOT cancel her own two-minute-old mistake and must ask a dispatcher. |
| **Expected UI result** | DESIRED: if the coordinator lacks Cancel, the button should say who can do it, not simply be absent. |
| **Expected audit result** | A cancellation event with the reason. |
| **Expected cross-object effect** | The burned woNumber is not reclaimed; the sequence never goes backwards. |
| **Exception / recovery** | The recovery for cancelling the wrong WO is to create a new one - CANCELLED cannot be reopened. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Cancelled is permanent' belongs in the confirm dialog. |
| **Reset / replay** | Seed a fresh WO; a cancelled one cannot be reused. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:137 (Cancel: admin/dispatcher)`<br>`functions/src/transitionEngine.ts:50 (CANCELLED is terminal)`<br>`functions/src/transitionEngine.ts:53-57 (TERMINAL_STATUSES)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The role that can create a Work Order is not the role that can cancel one, so the person best placed to catch a creation mistake in the first minute cannot act on it. |

#### P3B1-S02-A07 — Mark the Desert Ice Work Order ready to dispatch

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, HANDOFF, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | WO in CREATED with equipment linked and a usable description. |
| **Business purpose** | Readiness is a dispatcher's judgement that the job can actually be scheduled. |
| **Preconditions** | — Dale holds the dispatcher role<br>— The WO is in CREATED |
| **Action** | Invoke MarkReady. |
| **Expected EOS state transition** | CREATED -> READY_TO_DISPATCH. |
| **Expected authority / capability** | MarkReady: roles admin/dispatcher, requiresOwnAssignment false. |
| **Expected UI result** | Status chip changes; the WO appears in the Ready-to-Schedule queue. |
| **Expected audit result** | A transition event. Note: MarkReady is not in ACTION_TIMESTAMP_FIELD, so no execution timestamp field is written for it. |
| **Expected cross-object effect** | The WO becomes visible to the scheduling surfaces. |
| **Exception / recovery** | Marking ready with no equipment and no address is possible - readiness is not validated against completeness. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | 'Ready means what, exactly?' - there is no readiness checklist, only a button. |
| **Reset / replay** | Unschedule does not apply here; to reset, recreate the WO in CREATED. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:129`<br>`functions/src/transitionEngine.ts:92-99 (ACTION_TIMESTAMP_FIELD omits MarkReady)`<br>`functions/src/transitionEngine.ts:19-25 (why MarkReady exists at all)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | MarkReady validates nothing. A Work Order with no equipment, no address and an empty description can be declared ready, and the cost lands on the technician. |

#### P3B1-S02-A08 — Attempt MarkReady as a service coordinator without the dispatcher role

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · PERMISSION_DENIAL, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | WO in CREATED. Rosa's legacy users/{uid}.role is not admin or dispatcher. |
| **Business purpose** | Prove the permission boundary is enforced server-side, not merely hidden in the UI. |
| **Preconditions** | — Rosa lacks admin/dispatcher |
| **Action** | Invoke the MarkReady action directly against the callable, bypassing the UI. |
| **Expected EOS state transition** | None. The action is refused. |
| **Expected authority / capability** | Refused: ACTION_PERMISSIONS.MarkReady lists only admin and dispatcher, and getAllowedActions filters on role before anything else. |
| **Expected UI result** | n/a for the direct call; in the UI the action should not be offered. |
| **Expected audit result** | DESIRED: a refused privileged action is worth recording. Whether it is recorded today is UNPROVEN. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The correct recovery is a named dispatcher to ask, and the UI does not name one. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | A denial that names the role that can do it is worth more than the denial itself. |
| **Reset / replay** | Swap the caller's role and re-run. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:128-143`<br>`functions/src/transitionEngine.ts:152-172 (getAllowedActions)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S02-A09 — Search for a Work Order by the number the customer read out over the phone

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · DUPLICATE_DATA, BAD_DATA, DESKTOP*

**Account context.** Desert Ice & Cold Storage

| | |
| --- | --- |
| **Starting records / state** | Two Work Orders share woNumber WO-2026-000001 because of the lost-counter scenario earlier in this story. |
| **Business purpose** | The number is the only handle a customer has; ambiguity here is felt by the customer, not by the database. |
| **Preconditions** | — Duplicate woNumbers exist |
| **Action** | Search WO-2026-000001. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | CURRENT: two results, or one arbitrary result, depending on the surface. Either is wrong. Which one happens is UNPROVEN by this lane. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Any action taken on the wrong match lands on an unrelated customer's Work Order. |
| **Exception / recovery** | There is no in-product way to renumber a Work Order. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - a constraint problem wearing a search problem's clothes. |
| **Reset / replay** | Same fixture as the lost-counter activity. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/woNumbering.ts:6-11` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S02-A10 — Review the morning's created Work Orders for completeness before dispatch builds the day

*Priya Raman (service_manager) · taylor · DESKTOP · NORMAL, CROSS_COMPANY, MISSING_DATA, DESKTOP*

**Account context.** Desert Ice & Cold Storage, 9100 W Buckeye Rd Tolleson - Vogt P24AL tube-ice machine

| | |
| --- | --- |
| **Starting records / state** | 14 Work Orders created since 06:00 across both companies; 4 have no equipment link, 2 have no priority set above default. |
| **Business purpose** | A service manager's daily quality pass is where bad demand gets fixed before a truck rolls. |
| **Preconditions** | — Priya can read Work Orders across both companies |
| **Action** | Filter today's created Work Orders and inspect completeness. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Work Order visibility is decided by the legacy users/{uid}.role string, NOT by a capability - no workOrder.read capability exists in the permission catalog. |
| **Expected UI result** | DESIRED: a completeness column. CURRENT: she reads each one. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | Because no Work Order carries operatingCompanyId, she cannot filter this review by operating company at all - the grouping she actually manages by does not exist on the record. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'Why can't I filter by company?' has no answer on screen. |
| **Reset / replay** | Seed 14 WOs with the described gaps. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/ai/workOrderContext.ts:19 ('No workOrder.read capability exists in the current permission catalog')`<br>`firestore.rules:506-510 (fieldops_wos read gate is role-based)`<br>`functions/src/types/workOrder.ts (no operatingCompanyId)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Work Order visibility rides a legacy role string rather than a capability, and no Work Order carries an operating company, so neither 'who may see this' nor 'whose job is this' is expressible in the governed model. |

</details>

### P3B1-S03 — The machine on the Work Order - equipment context a technician can actually use

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

Sonoran Scoops runs four stores. Three have Taylor C712s, one has an older C713 nobody updated in the register. Marisol links equipment to Work Orders all morning; Curtis reads the result on a phone in a parking lot. Everything wrong in the register becomes a wasted drive or a wrong part on the truck.

<details><summary>10 activities — P3B1-S03-A01 · P3B1-S03-A02 · P3B1-S03-A03 · P3B1-S03-A04 · P3B1-S03-A05 · P3B1-S03-A06 · P3B1-S03-A07 · P3B1-S03-A08 · P3B1-S03-A09 · P3B1-S03-A10</summary>

#### P3B1-S03-A01 — Open the account-scoped equipment register for Sonoran Scoops

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | Account has 4 locations; 6 equipment records across them. |
| **Business purpose** | Before linking equipment to a Work Order, see what is actually registered. |
| **Preconditions** | — Marisol can read the equipment register<br>— The account exists |
| **Action** | Navigate to Equipment > Customer Equipment, bound the register to the Sonoran Scoops account. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Equipment read. The register is account-scoped by design - EquipmentRegister.jsx bounds the list by a chosen Account. |
| **Expected UI result** | A list of 6 units by name/model/serial. The picker never exposes raw ids. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Each equipment record's locationId resolves into the CRM locations collection, and Rules require that location's accountId to match the equipment's accountId. |
| **Exception / recovery** | If a unit was registered against the wrong location, it simply will not appear under the store the caller names. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None needed. |
| **Reset / replay** | Seed 4 locations and 6 equipment records. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentRegister.jsx (account-scoped register)`<br>`field-ops-app-vite/src/modules/workOrders/EquipmentPicker.jsx (by name/model/serial, never by id)`<br>`firestore.rules:1439-1442` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S03-A02 — Link the correct C712 to a new Work Order using the equipment picker

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | WO in CREATED for the Mill Ave store; two C712s exist on the account at different stores. |
| **Business purpose** | The technician needs to know which machine, not which model. |
| **Preconditions** | — The WO names an account<br>— Equipment exists under that account |
| **Action** | Open the Equipment picker in the Work Order wizard and select the Mill Ave C712 by serial. |
| **Expected EOS state transition** | No lifecycle transition; the WO gains its equipment reference. |
| **Expected authority / capability** | workOrder.create (the wizard route is gated on workOrder.create, explicitly excluding technicians). |
| **Expected UI result** | The picker is account-scoped, so the other three stores' machines are also offered - location is the disambiguator and must be visible in the row. |
| **Expected audit result** | The WO creation event carries the equipment reference. |
| **Expected cross-object effect** | Downstream: parts planning, model compatibility, and service history all key off this link. |
| **Exception / recovery** | Picking the sister store's C712 produces a Work Order that looks complete and sends a technician to the right address to service the wrong serial. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | Location should be part of the equipment row, not something to hunt for. |
| **Reset / replay** | Recreate the WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information |
| **Evidence** | `field-ops-app-vite/src/App.jsx:1044-1052 (work-orders routes gated on workOrder.create, technicians excluded)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S03-A03 — Discover the fourth store's machine is registered as a C712 but is physically a C713

*Marisol Vega (service_coordinator) · taylor · DESKTOP · BAD_DATA, RECOVERY, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler

| | |
| --- | --- |
| **Starting records / state** | Equipment record says model C712; the technician's last note says C713. |
| **Business purpose** | Model is what drives parts compatibility; a wrong model is a wrong part on the truck. |
| **Preconditions** | — The equipment record exists |
| **Action** | Open the equipment detail page and attempt to correct the model. |
| **Expected EOS state transition** | None to any Work Order. |
| **Expected authority / capability** | Equipment edit. The edit modal treats identity/ownership fields as read-only; whether `model` is editable is governed by the equipment writable-key allowlist. |
| **Expected UI result** | EquipmentEditModal shows identity/ownership read-only; the writable keys include model. |
| **Expected audit result** | An equipment change should be attributable and appear on the equipment timeline. |
| **Expected cross-object effect** | Changing the model changes which parts are compatible; it does NOT retroactively fix parts already planned on open Work Orders. |
| **Exception / recovery** | If model is not editable by this role the correction stalls and the wrong model persists through the next three visits. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | 'Changing the model does not re-plan parts on open Work Orders' is the sentence that belongs in the confirm. |
| **Reset / replay** | Restore the equipment doc to model C712. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `firestore.rules:1371-1380 (equipmentWritableKeys includes manufacturer/model/serialNumber)`<br>`field-ops-app-vite/src/modules/equipment/EquipmentEditModal.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S03-A04 — Read the equipment context on a phone in the Sonoran Scoops parking lot

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, MISSING_DATA*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | Assigned WO in ACCEPTED with equipment linked; Curtis is on LTE with two bars. |
| **Business purpose** | The machine's identity, model and history is what he plans the visit from. |
| **Preconditions** | — Curtis is the assigned technician<br>— The WO carries an equipment reference |
| **Action** | Open the assigned Work Order in the technician workspace and look for the equipment facts. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Technician reads only Work Orders where assignedTechId is their own mapped technicianId. Note: technicians CANNOT open the /service/work-orders/:id route at all; their lifecycle UI lives only on the technician dashboard/field mode. |
| **Expected UI result** | CURRENT: the technician surfaces are TechnicianDashboard/FieldMode/TechnicianShell. How much equipment detail they carry is UNPROVEN by this lane. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The equipment timeline (Work Orders + inventory history) lives on the equipment detail page, which is a route the technician cannot reach. |
| **Exception / recovery** | If the service history is on a page he cannot open, he phones the office - which is the failure this scenario exists to surface. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'What happened last time on this machine?' has no location in the technician's app. |
| **Reset / replay** | Assign a WO with equipment to a technician fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/App.jsx:1044-1052`<br>`field-ops-app-vite/src/modules/equipment/EquipmentTimeline.jsx (equipment detail page only)`<br>`firestore.rules:507-508` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The equipment service timeline exists only on a route technicians are explicitly barred from, so the person standing in front of the machine is the one person who cannot see its history. |

#### P3B1-S03-A05 — Try to see a machine's whole service history across both operating companies

*Marisol Vega (service_coordinator) · taylor · DESKTOP · CROSS_COMPANY, MISSING_DATA, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A (ventana-sold) and FBD 773 frozen beverage (taylor-sold), same store

| | |
| --- | --- |
| **Starting records / state** | Two machines at one address, sold and serviced by different operating companies. |
| **Business purpose** | The customer experiences one store; the company experiences two ledgers. |
| **Preconditions** | — Both machines are registered under the same account and location |
| **Action** | Open Customer Equipment for the account and look for an operating-company column. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | CURRENT: Work Orders carry no operatingCompanyId, so any per-company grouping of service history must be inferred from something else. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Equipment ownership/company attribution and Work Order company attribution are not the same field, and the Work Order has none. |
| **Exception / recovery** | A coordinator answering 'who serviced this last?' cannot answer 'under which company?' from the record. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | There is no obvious place to ask 'why does this record have no company?' |
| **Reset / replay** | Seed one account/location with two machines attributed to different companies. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/types/workOrder.ts (no operatingCompanyId)`<br>`functions/src/ownership/operatingCompanyAuthority.ts:23-24` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Service history cannot be attributed to an operating company because the Work Order never records one. |

#### P3B1-S03-A06 — Register a machine at a location that belongs to a different account

*Marisol Vega (service_coordinator) · taylor · DESKTOP · BAD_DATA, PERMISSION_DENIAL, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | A location record exists whose accountId is a different customer. |
| **Business purpose** | Prove the ownership guard is real and not merely a dropdown convention. |
| **Preconditions** | — A mismatched account/location pair exists |
| **Action** | Attempt an equipment create with accountId A and locationId belonging to account B. |
| **Expected EOS state transition** | Refused. |
| **Expected authority / capability** | Rules require the location to exist AND its accountId to equal the equipment's accountId. |
| **Expected UI result** | The create modal should refuse before the write; the UI already refuses rather than proceeding with a stale locationId toward a doomed write. |
| **Expected audit result** | No write, no event. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The error must name which of the two is wrong; 'invalid' alone leaves the user guessing. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | The field-level hint region (the Field primitive's aria-describedby hint) is the right home for the reason. |
| **Reset / replay** | Seed the mismatched pair. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear |
| **Evidence** | `firestore.rules:1439-1442`<br>`field-ops-app-vite/src/modules/equipment/EquipmentCreateModal.jsx:77 (refuses rather than proceeding with a stale locationId)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S03-A07 — Look for the equipment's stock/inventory identity and find it is a different registry

*Marisol Vega (service_coordinator) · taylor · DESKTOP · BAD_DATA, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | The C712 is installed at a customer; an identical model sits in company inventory as a serialized asset. |
| **Business purpose** | Coordinators routinely conflate 'the machine at the customer' with 'a unit we hold'. |
| **Preconditions** | — Both an installed equipment record and an available serialized asset exist |
| **Action** | Compare the Customer Equipment tab with the Available Equipment tab. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Two tabs, two registries. Available Equipment is a company-inventory serialized-asset view carrying a currentLocationId scalar, not a resolved label. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Equipment locationId resolves into CRM locations; it never resolves into inventory registries. These are two different meanings of 'location' sharing one word. |
| **Exception / recovery** | Reading an inventory location as a customer site (or the reverse) sends a truck to a warehouse. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | The single highest-value explainer in the equipment domain: 'location here means a customer site, not a warehouse bin.' |
| **Reset / replay** | Seed one installed unit and one available serialized asset of the same model. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · help missing when needed · no obvious "why?" location |
| **Evidence** | `firestore.rules:1341 (match /locations/{locationId})`<br>`firestore.rules:1439-1442`<br>`field-ops-app-vite/src/modules/equipment/AvailableEquipment.jsx:32 (currentLocationId scalar, no resolved label)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Two registries both call their field 'location' and mean incompatible things; nothing on screen says so. |

#### P3B1-S03-A08 — Find the machine by scanning its serial plate instead of searching

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, RECOVERY*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | Curtis is at the machine; the WO's equipment link is to the wrong unit. |
| **Business purpose** | The plate is ground truth; the register is a claim about it. |
| **Preconditions** | — The scan workspace is reachable for the technician role |
| **Action** | Open Scan and scan/enter the serial from the plate. |
| **Expected EOS state transition** | None by itself - scanning resolves an identity. |
| **Expected authority / capability** | The scan route is gated on the fieldMode legacy key OR receiving-surface capabilities; a positive capability wins outright. |
| **Expected UI result** | Resolution result: what was scanned, whether it could be read, and what the caller may do with it. |
| **Expected audit result** | None for a pure resolution. |
| **Expected cross-object effect** | A scan that resolves to a different unit than the WO names is the moment the register error is discoverable - and there is no 'this is the wrong machine' action on the Work Order. |
| **Exception / recovery** | If the plate is unreadable (they are, on old machines, behind the panel and covered in mix), manual entry must exist. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'This is not the machine on the Work Order' needs a next step, and has none. |
| **Reset / replay** | Seed a WO pointing at the wrong serial. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/navigation/navConfig.js:663-672 (capability wins outright)`<br>`field-ops-app-vite/src/modules/mobile/PartsScanner.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Discovering the Work Order names the wrong machine has no in-product correction path for the technician. |

#### P3B1-S03-A09 — Ask which Sonoran Scoops machine has consumed the most service hours this year

*Priya Raman (service_manager) · taylor · DESKTOP · NORMAL, END_OF_MONTH, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | 6 machines, ~40 Work Orders across the year. |
| **Business purpose** | Repeat-offender machines are the sales conversation about replacement. |
| **Preconditions** | — Historical Work Orders exist against the equipment |
| **Action** | Look for per-equipment service aggregation. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The equipment timeline is per-unit and newest-first; whether any cross-unit aggregation exists is UNPROVEN by this lane. If it does not, this is MISSING_CAPABILITY. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The manual alternative is opening six timelines and counting. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a year of Work Orders. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentTimeline.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S03-A10 — Abandon the equipment create modal halfway and come back to it

*Marisol Vega (service_coordinator) · taylor · DESKTOP · BACK_BUTTON_ABANDONED_FLOW, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712 two-flavour soft-serve freezer

| | |
| --- | --- |
| **Starting records / state** | The create modal is half-filled: name and model entered, no location chosen. |
| **Business purpose** | Interruption is the normal state of a service coordinator's morning. |
| **Preconditions** | — The modal is open with partial input |
| **Action** | Press the browser back button, then return to the equipment screen. |
| **Expected EOS state transition** | None. No equipment is created. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The half-filled state is lost. The modal refuses submission without a location anyway (submitAttempted && !locationId). |
| **Expected audit result** | No event - correctly, because nothing happened. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | Losing three fields is cheap; losing a long description on a Work Order is not, and the same pattern applies there. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | None needed for three fields. |
| **Reset / replay** | None - nothing was written. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentCreateModal.jsx:47,84` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S04 — 07:55 - Dale builds Tuesday on the dispatcher board

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

Nine Work Orders sit in the Ready-to-Schedule queue. Dale has six technicians, one of whom is at a manufacturer training all day, and a convention centre that needs ice by 11:00. He places jobs on the technician-by-hour lane grid. Every placement is a governed Schedule transition, not a drag that becomes a fact.

<details><summary>10 activities — P3B1-S04-A01 · P3B1-S04-A02 · P3B1-S04-A03 · P3B1-S04-A04 · P3B1-S04-A05 · P3B1-S04-A06 · P3B1-S04-A07 · P3B1-S04-A08 · P3B1-S04-A09 · P3B1-S04-A10</summary>

#### P3B1-S04-A01 — Open the dispatcher board and read the Ready-to-Schedule queue

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | 9 Work Orders in READY_TO_DISPATCH; 6 technicians with lanes drawn for today. |
| **Business purpose** | See the whole day's demand and capacity in one place before committing anyone. |
| **Preconditions** | — Dale's legacy role is dispatcher<br>— Work Orders exist in READY_TO_DISPATCH |
| **Action** | Navigate to Service > Dispatcher Board. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The dispatcher-board route is gated on the legacy ROLE_NAV_ACCESS key `dispatcherBoard` - admin/dispatcher only. Not a capability. |
| **Expected UI result** | Three panes: queue, lane grid, technician pane. Each queue card shows a top technician recommendation. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The board subscribes to Work Orders, technicians and blocked time; the board and the scheduling commands use the same availability functions so drawn availability and enforced availability cannot disagree. |
| **Exception / recovery** | A technician whose working hours are unrecorded draws a lane that cannot honestly be shaded. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | None at this level. |
| **Reset / replay** | Seed 9 ready WOs, 6 technicians, working availability for 5 of them. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherBoard.jsx`<br>`field-ops-app-vite/src/domain/constants.js:374-378 (ROLE_NAV_ACCESS)`<br>`functions/src/scheduling/availabilityModel.ts:5-9 (same records draw the lane and decide validity)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S04-A02 — Place the Camelback Convention Center ice job into Javier's 09:00 lane

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Camelback Convention Center - banquet ice, Manitowoc twin

| | |
| --- | --- |
| **Starting records / state** | WO in READY_TO_DISPATCH; Javier has working hours 07:00-16:00 Tue and no blocked time at 09:00. |
| **Business purpose** | Commit a technician and a time so the customer can be told when. |
| **Preconditions** | — The WO is in READY_TO_DISPATCH<br>— Javier is an eligible technician |
| **Action** | Drag the card into Javier's 09:00-11:00 slot; the placement dialog opens; confirm technician and window. |
| **Expected EOS state transition** | READY_TO_DISPATCH -> SCHEDULED. Schedule writes caller-supplied planning fields (scheduledStart/scheduledEnd/scheduledTechId), not a server execution timestamp. |
| **Expected authority / capability** | Schedule: roles admin/dispatcher, requiresOwnAssignment false. No separate scheduling capability family was registered - deliberately, by Owner ruling. |
| **Expected UI result** | Drag and keyboard/touch placement both funnel through one PlacementDialog, so there is exactly one confirm path. |
| **Expected audit result** | A Schedule transition event carrying the chosen window and technician. |
| **Expected cross-object effect** | The WO now occupies a lane and is counted in the technician's booked capacity. |
| **Exception / recovery** | A refusal (blocked time, conflict, past start) must land in the dialog, not after it closes. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'Scheduled is not dispatched' is a real distinction the status chip should carry. |
| **Reset / replay** | Unschedule returns it to READY_TO_DISPATCH - the only reverse edge in the lifecycle. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:134 (Schedule: admin/dispatcher)`<br>`functions/src/transitionEngine.ts:82-91 (Schedule excluded from execution timestamps)`<br>`functions/src/transitionEngine.ts:130-132 (no new capability family, Owner ruling 2026-08-27)`<br>`field-ops-app-vite/src/modules/dispatcherBoard/PlacementDialog.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S04-A03 — Place a second job into the window Javier is already booked for

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | Javier has WO-A scheduled 09:00-11:00; Dale drags WO-B to 10:00. |
| **Business purpose** | Overlapping placements are the most common dispatch mistake and must be refused, not warned. |
| **Preconditions** | — An overlapping scheduled Work Order exists for the same technician |
| **Action** | Confirm the placement at 10:00-12:00. |
| **Expected EOS state transition** | Refused. No transition. |
| **Expected authority / capability** | Authority is present; this is a SCHEDULE_CONFLICT refusal - same technician, overlapping window. |
| **Expected UI result** | The dialog must name the colliding Work Order, not merely say 'conflict'. |
| **Expected audit result** | No state change. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | Back-to-back is fine: the overlap test is half-open, so a job ending 11:00 and one starting 11:00 do not collide. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'Back-to-back is allowed; overlapping is not' is worth one sentence at the dialog. |
| **Reset / replay** | Remove the first placement. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/scheduling/types.ts:107 (SCHEDULE_CONFLICT)`<br>`functions/src/workOrderAvailability.ts:57-71 (findScheduleConflict, half-open)`<br>`functions/src/scheduling/placementPolicy.ts:106-126` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S04-A04 — Place a job into a window that has already passed

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | It is 07:55; Dale drags a card into the 07:00 slot. |
| **Business purpose** | Scheduling into the past corrupts every on-time metric downstream. |
| **Preconditions** | — The proposed start is before now |
| **Action** | Confirm the placement. |
| **Expected EOS state transition** | Refused with START_IN_PAST. |
| **Expected authority / capability** | Authority present; a validation refusal. |
| **Expected UI result** | DESIRED: past slots should be visually unavailable, not merely refused after the fact. |
| **Expected audit result** | No state change. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A dispatcher back-filling a job that genuinely started at 07:00 has no path - recording history is not the same as scheduling, and the model correctly separates them, but nothing on screen says where history goes. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'To record work that already happened, do X' - and X is not named anywhere on the board. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/scheduling/types.ts:109 (START_IN_PAST)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S04-A05 — Place a job on a technician whose working hours are not recorded

*Dale Brackett (dispatcher) · taylor · DESKTOP · MISSING_DATA, NORMAL, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | A newly hired technician has a fieldops_technicians record but no working-availability document. |
| **Business purpose** | Unrecorded is not the same as unavailable, and the board must not pretend otherwise. |
| **Preconditions** | — The technician has no working availability record |
| **Action** | Place a 13:00-15:00 job on that technician and confirm. |
| **Expected EOS state transition** | READY_TO_DISPATCH -> SCHEDULED. This is a WARNING, never a refusal. |
| **Expected authority / capability** | Schedule. |
| **Expected UI result** | A NO_WORKING_AVAILABILITY_RECORDED warning rides along with the successful schedule. It must read 'we do not know', not 'this is outside hours'. |
| **Expected audit result** | The transition event should carry the warning. |
| **Expected cross-object effect** | Percent-booked for this technician is not 0% - it is unknown, because the denominator is unrecorded. Rendering it as 0% would be a lie the board tells daily. |
| **Exception / recovery** | If the stored IANA time zone is unparseable, the same warning is produced rather than a crash mid-transaction. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | This is the model's own distinction and deserves the (i): 'no schedule recorded' vs 'outside recorded hours'. |
| **Reset / replay** | Delete the availability doc for a technician fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:219-244 (assessWorkingHours, NO_WORKING_AVAILABILITY_RECORDED)`<br>`functions/src/scheduling/availabilityModel.ts:269-291 (availableMinutesInWindow returns null, not 0)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S04-A06 — Place a two-hour job that runs 45 minutes past the end of the technician's shift

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | Curtis works 07:00-16:00; the job is placed 15:15-17:15. |
| **Business purpose** | Overrunning a shift is a business decision a dispatcher is allowed to make. |
| **Preconditions** | — Working availability is recorded for Curtis |
| **Action** | Confirm the placement. |
| **Expected EOS state transition** | READY_TO_DISPATCH -> SCHEDULED with an OUTSIDE_WORKING_HOURS warning naming the exact minutes outside. |
| **Expected authority / capability** | Schedule. |
| **Expected UI result** | '75 minutes of this placement fall outside the technician's working hours.' Outside hours is a warning, never a refusal. |
| **Expected audit result** | Warning recorded with the transition. |
| **Expected cross-object effect** | Overtime cost is not modelled here; the warning is the only signal. |
| **Exception / recovery** | A window crossing local midnight is measured against each day's own intervals, and a DST transition inside the window is handled by Intl rather than by fixed-offset arithmetic. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'This is allowed. Here is what it costs' is the missing half. |
| **Reset / replay** | Remove the placement. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:142-169 (minutesOutsideWorkingHours)`<br>`functions/src/scheduling/availabilityModel.ts:242-250` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S04-A07 — Place nine jobs across six technicians in one sitting

*Dale Brackett (dispatcher) · taylor · DESKTOP · BULK, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | 9 ready Work Orders, 6 technicians. |
| **Business purpose** | The real morning is a run of placements, not one. |
| **Preconditions** | — All nine are in READY_TO_DISPATCH |
| **Action** | Place each in turn through the placement dialog. |
| **Expected EOS state transition** | Nine independent READY_TO_DISPATCH -> SCHEDULED transitions. |
| **Expected authority / capability** | Schedule, nine times. There is no bulk-schedule command; each placement is its own governed transition. |
| **Expected UI result** | Nine dialogs. A dispatcher's morning is nine confirmations. |
| **Expected audit result** | Nine transition events - which is correct: nine commitments were made. |
| **Expected cross-object effect** | Capacity percentages update per technician. |
| **Exception / recovery** | If the fourth refuses, the first three stand. There is no all-or-nothing day build, and nothing tells the dispatcher which placements survived. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | '3 of 9 placed' progress state is absent. |
| **Reset / replay** | Unschedule each. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:134`<br>`field-ops-app-vite/src/modules/dispatcherBoard/PlacementDialog.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A partially-completed day build leaves no summary of what actually got placed. |

#### P3B1-S04-A08 — Switch the board from day view to the two-week projection

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | Today's board is built; Dale checks next week's PM load. |
| **Business purpose** | Preventive maintenance is planned in weeks, not hours. |
| **Preconditions** | — Scheduled Work Orders exist beyond today |
| **Action** | Use the view switcher to Week / 2-Week. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Coarser-grain projections of the same schedule data - the same records, redrawn. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A coarse view that hides a blocked-time collision is worse than no view; whether blocked time renders at 2-week grain is UNPROVEN by this lane. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed scheduled WOs across two weeks. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatchViews.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S04-A09 — Filter the board down to the three technicians on the east route

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, EXCEPTION, DESKTOP*

**Account context.** Mixed Taylor route: Cactus Burger #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | Six lanes drawn. |
| **Business purpose** | A dispatcher works a route at a time. |
| **Preconditions** | — Six technicians visible |
| **Action** | Apply the technician filter. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. The filter is presentation-only - it narrows drawn lanes, never scheduling logic. |
| **Expected UI result** | Three lanes. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None - and this matters: a conflict on a hidden lane is still enforced. A dispatcher may be refused by a technician they cannot currently see. |
| **Exception / recovery** | The refusal must name the technician even when that technician is filtered out of view. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Filtering hides lanes; it does not relax rules.' |
| **Reset / replay** | Clear the filter. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/TechnicianFilter.jsx (presentation-only)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A scheduling refusal can name a technician the dispatcher has filtered out of view, producing a refusal with no visible cause. |

#### P3B1-S04-A10 — Build the Ventana board from the same technician pool on the same day

*Brett Hollins (dispatcher) · ventana · DESKTOP · CROSS_COMPANY, PERMISSION_DENIAL, DESKTOP*

**Account context.** QuikMart Southwest ice route, Tucson Gas & Go

| | |
| --- | --- |
| **Starting records / state** | Brett is a Ventana dispatcher; the technician pool and the Work Order collection are shared. |
| **Business purpose** | Two operating companies, one account base, one technician roster - the daily reality. |
| **Preconditions** | — Brett's legacy role is dispatcher |
| **Action** | Open the dispatcher board and place Ventana jobs. |
| **Expected EOS state transition** | Same governed Schedule transitions. |
| **Expected authority / capability** | Identical. Nothing in ACTION_PERMISSIONS distinguishes a Taylor dispatcher from a Ventana one; the role string is the whole authority. |
| **Expected UI result** | CURRENT: Brett sees Taylor's placements on the same lanes, and nothing on a card says which company owns the job. |
| **Expected audit result** | Events record the actor, not the operating company. |
| **Expected cross-object effect** | A Ventana dispatcher can schedule, unschedule or cancel a Taylor Work Order, and vice versa, with no company boundary in the authority model. |
| **Exception / recovery** | There is no recovery because there is no refusal - the action simply succeeds. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | An operating-company badge on every board card is the single highest-value addition in this story. |
| **Reset / replay** | Seed WOs for both companies on shared technicians. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:128-143 (no company dimension)`<br>`functions/src/types/workOrder.ts (no operatingCompanyId)`<br>`firestore.rules:506-510` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Operating-company separation is unenforceable on Work Orders: no company is recorded and no permission consults one, so either dispatcher can act on either company's jobs. |

</details>

### P3B1-S05 — Blocked time - PTO, lunch, and the July 4th closure that cannot be recorded

**Account context.** n/a - internal workforce records, no customer account

Priya records the shop's absences: Javier's Thursday PTO, the standing 12:00-12:30 lunch each technician carries, a manufacturer training block, a truck in for brakes, and the company holiday closure. The Owner ruled tonight that overlapping blocked-time facts are legitimate - unavailable time is the UNION of blocked intervals, never the sum and never prohibited. A COMPANY_CLOSURE may straddle a daily LUNCH. This story exists to test that ruling against what the code actually does.

<details><summary>10 activities — P3B1-S05-A01 · P3B1-S05-A02 · P3B1-S05-A03 · P3B1-S05-A04 · P3B1-S05-A05 · P3B1-S05-A06 · P3B1-S05-A07 · P3B1-S05-A08 · P3B1-S05-A09 · P3B1-S05-A10</summary>

#### P3B1-S05-A01 — Record Javier's Thursday PTO as a blocked-time fact

*Priya Raman (service_manager) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | Javier has a fieldops_technicians record and recorded working hours; no blocked time on Thursday. |
| **Business purpose** | An absence is a fact about a person, and the board must draw it before anyone plans around it. |
| **Preconditions** | — The technician record exists |
| **Action** | Create a blocked-time record: kind PTO, Thursday 00:00 to Friday 00:00 local. |
| **Expected EOS state transition** | A technician_blocked_time record is created. No Work Order transitions. |
| **Expected authority / capability** | Scheduling command authority (admin/dispatcher bucket - no separate scheduling capability family exists). |
| **Expected UI result** | Javier's Thursday lane shades out on the dispatcher board. |
| **Expected audit result** | An audit event recording the absence. |
| **Expected cross-object effect** | Javier's percent-booked denominator for Thursday drops to zero available working minutes. |
| **Exception / recovery** | Recording PTO is deliberately NOT checked against already-scheduled work. The absence is the fact; the placement is the problem, and a human moves the job. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Recording PTO does not move jobs already scheduled in it' belongs in the confirm. |
| **Reset / replay** | Delete the blocked-time record. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/types.ts:62-69 (BLOCKED_TIME_KINDS)`<br>`functions/src/scheduling/schedulingCommands.ts:471-476 (absence not checked against scheduled work, deliberately)`<br>`functions/src/transitionEngine.ts:130-133` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S05-A02 — Record the standing 12:00-12:30 lunch for Thursday

*Priya Raman (service_manager) · taylor · DESKTOP · EXCEPTION, UNUSUAL_BUT_LEGITIMATE, BAD_DATA, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | Javier's Thursday PTO block already exists, covering the whole day. |
| **Business purpose** | Lunch is recorded per technician per day as a routine matter, often by a different person than the one who recorded the PTO. |
| **Preconditions** | — A PTO block already covers Thursday |
| **Action** | Create a blocked-time record: kind LUNCH, Thursday 12:00-12:30. |
| **Expected EOS state transition** | CURRENT: REFUSED with BLOCKED_TIME_CONFLICT, because the new absence overlaps the existing PTO block. DESIRED, per tonight's Owner ruling: ACCEPTED - overlapping blocked-time facts are legitimate and unavailable time is their UNION. |
| **Expected authority / capability** | Authority is present. The refusal is a business-rule refusal, and the rule now contradicts the ruling. |
| **Expected UI result** | CURRENT: 'Technician <id> already has PTO blocked time <window> overlapping that window (block <blockId>).' |
| **Expected audit result** | No record written on the refusal. |
| **Expected cross-object effect** | None - which is the problem: the LUNCH fact is simply lost. |
| **Exception / recovery** | The user's only recovery is to delete the PTO, add the lunch, and re-add the PTO - which is three writes to record two facts, and leaves a window in which the technician looks available. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | The refusal message explains what it did, not why it is right - and under the new ruling it is not right. |
| **Reset / replay** | Delete both blocks and re-seed. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/scheduling/schedulingCommands.ts:460-468 (createTechnicianBlockedTime refuses an overlapping block)`<br>`functions/src/scheduling/availabilityModel.ts:176-203 (findBlockedTimeConflict, reused for block-vs-block)`<br>`functions/src/scheduling/types.ts:108 (BLOCKED_TIME_CONFLICT)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The blocked-time create command refuses ANY overlapping absence. Tonight's Owner ruling says overlapping blocked-time facts are legitimate and unavailable time is the UNION. The command and the ruling are in direct conflict; the model half (blockedMinutesInWindow) already computes the union correctly, so only the command is wrong. |

#### P3B1-S05-A03 — Record the company holiday closure across a week that already has technicians' lunches in it

*Priya Raman (service_manager) · taylor · DESKTOP · EXCEPTION, BULK, BAD_DATA, RECOVERY, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | Five technicians each carry a 12:00-12:30 LUNCH block on Thursday and Friday. The company is closed both days. |
| **Business purpose** | This is the exact case the Owner ruling names: a COMPANY_CLOSURE may straddle a daily LUNCH. |
| **Preconditions** | — Daily LUNCH blocks exist for the affected technicians |
| **Action** | Create COMPANY_CLOSURE blocks Thursday 00:00 - Saturday 00:00 for all five technicians. |
| **Expected EOS state transition** | CURRENT: all five REFUSED with BLOCKED_TIME_CONFLICT, because each closure straddles that technician's lunch. DESIRED: all five accepted; unavailable time is the union of closure and lunch. |
| **Expected authority / capability** | Authority present; the refusal is the rule, not the role. |
| **Expected UI result** | Five refusals in a row, each naming a lunch break as the obstacle to recording a holiday. |
| **Expected audit result** | Nothing written. |
| **Expected cross-object effect** | The holiday is not on the board. Dispatch will schedule into it. Customers will be promised visits on a day the company is shut. |
| **Exception / recovery** | The only workaround is to delete every technician's lunch, record the closure, and rebuild the lunches afterwards - and nothing in the product suggests it. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | n/a - no explanation makes this outcome acceptable. |
| **Reset / replay** | Seed five technicians with daily lunches; reset by deleting all blocked-time records. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/scheduling/schedulingCommands.ts:460-468`<br>`functions/src/scheduling/types.ts:62-69 (COMPANY_CLOSURE and LUNCH are both BLOCKED_TIME_KINDS)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A company-wide holiday closure is unrecordable for any technician who has a recorded lunch break. This is the highest-consequence instance of the overlap refusal: the product cannot represent the company being shut. |

#### P3B1-S05-A04 — Record a truck-service block that starts exactly when a training block ends

*Priya Raman (service_manager) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | Curtis has a TRAINING block 08:00-12:00 Wednesday. |
| **Business purpose** | Back-to-back absences are routine and must not be treated as overlapping. |
| **Preconditions** | — The TRAINING block exists |
| **Action** | Create a TRUCK_SERVICE block 12:00-15:00 Wednesday. |
| **Expected EOS state transition** | Accepted. The overlap test is half-open (start < otherEnd && otherStart < end), so touching intervals do not collide. |
| **Expected authority / capability** | Scheduling command authority. |
| **Expected UI result** | Two adjacent shaded blocks on the lane. |
| **Expected audit result** | An event per block. |
| **Expected cross-object effect** | Curtis's Wednesday available minutes drop by seven hours. |
| **Exception / recovery** | One minute of genuine overlap (11:59 vs 12:00) flips this to a refusal, and the message will not make the one-minute cause obvious. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Back to back is fine' is exactly the kind of rule that belongs next to the time fields. |
| **Reset / replay** | Delete both blocks. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:176-203 (half-open overlap, one rule for both callers)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S05-A05 — Try to schedule a job into Javier's recorded PTO

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | Javier's Thursday PTO block exists; a Work Order is in READY_TO_DISPATCH. |
| **Business purpose** | The absence must actually stop the placement, not merely shade the lane. |
| **Preconditions** | — The PTO block covers the proposed window |
| **Action** | Place the job at Thursday 10:00-12:00 and confirm. |
| **Expected EOS state transition** | Refused with BLOCKED_TIME_CONFLICT. No transition. |
| **Expected authority / capability** | Schedule authority present; a placement-policy refusal. |
| **Expected UI result** | 'Technician <id> has PTO blocked time overlapping that window.' |
| **Expected audit result** | No state change. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | Correct and enforced - and note the asymmetry with the recommendation engine, which will still rank this technician first (next story). |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | The refusal should name the absence kind, and it does. |
| **Reset / replay** | Delete the PTO block. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/placementPolicy.ts:98-105`<br>`functions/src/scheduling/availabilityModel.ts:176-203` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S05-A06 — Delete one of two identical PTO records for the same day

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | Under the DESIRED union semantics, two overlapping PTO blocks cover the same Thursday. |
| **Business purpose** | The code's own justification for refusing overlap is that deletion becomes dishonest under union semantics. |
| **Preconditions** | — Two overlapping PTO blocks exist (only reachable if the overlap refusal is lifted) |
| **Action** | Delete one of them. |
| **Expected EOS state transition** | One blocked-time record is removed; the technician remains fully blocked by the other. |
| **Expected authority / capability** | Scheduling command authority. |
| **Expected UI result** | DESIRED: 'This absence is removed. The technician is still unavailable Thursday because of <the other block>.' |
| **Expected audit result** | An event saying an absence was removed - which, without the UI sentence above, reads as though availability was restored when it was not. |
| **Expected cross-object effect** | Available minutes do not change. |
| **Exception / recovery** | This is the honest-deletion problem the current refusal was built to avoid. Under the Owner's union ruling it must be solved by saying what remains blocked, not by prohibiting the overlap. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'What is still blocking this technician?' after a delete is the required (i). |
| **Reset / replay** | Seed two overlapping blocks directly in the store, bypassing the command. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | help missing when needed · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/scheduling/schedulingCommands.ts:450-459 (the honest-deletion argument)`<br>`functions/src/scheduling/availabilityModel.ts:289-311 (blockedMinutesInWindow already unions per minute)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Deleting one of several overlapping absences stages an audit event implying the absence was removed while the technician stays fully blocked. Under union semantics the UI must say what still blocks; nothing does. |

#### P3B1-S05-A07 — Check a technician's percent-booked for a week that contains both working hours and absences

*Priya Raman (service_manager) · taylor · DESKTOP · NORMAL, END_OF_MONTH, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | Recorded working hours, one PTO day, daily lunches. |
| **Business purpose** | Capacity is the number a service manager plans hiring from. |
| **Preconditions** | — Working availability and blocked time both exist |
| **Action** | Read the technician's capacity for the week. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Percent booked, with available minutes as the denominator. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | blockedMinutesInWindow walks the window minute by minute and counts a minute once if ANY block covers it - already a UNION, never a sum. The model half of the Owner's ruling is correctly implemented. |
| **Exception / recovery** | If working availability is unrecorded the function returns null and the surface must render 'no working schedule recorded', not 0%. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | '0% booked' vs 'unknown' is the distinction that must survive to the screen. |
| **Reset / replay** | Seed availability plus blocks. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:289-311 (per-minute union)`<br>`functions/src/scheduling/availabilityModel.ts:259-291` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S05-A08 — Record blocked time for a technician id that does not exist

*Priya Raman (service_manager) · taylor · DESKTOP · BAD_DATA, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | A stale technician id from a spreadsheet. |
| **Business purpose** | Workforce data arrives by paste, and the guard must be server-side. |
| **Preconditions** | — The id does not resolve to a fieldops_technicians record |
| **Action** | Submit the blocked-time create. |
| **Expected EOS state transition** | Refused with TECHNICIAN_NOT_FOUND. |
| **Expected authority / capability** | Authority present. |
| **Expected UI result** | The refusal should name the id it could not find. |
| **Expected audit result** | Nothing written. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | None needed. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/schedulingCommands.ts:432`<br>`functions/src/scheduling/types.ts:105` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S05-A09 — Record a blocked-time window whose end is before its start

*Priya Raman (service_manager) · taylor · DESKTOP · BAD_DATA, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | A typo: 14:00 to 04:00. |
| **Business purpose** | A malformed interval must be refused at the edge, not stored and then silently ignored by the model. |
| **Preconditions** | — None |
| **Action** | Submit the block. |
| **Expected EOS state transition** | Refused with INVALID_INPUT. |
| **Expected authority / capability** | Authority present. |
| **Expected UI result** | A field-level error on the time inputs. |
| **Expected audit result** | Nothing written. |
| **Expected cross-object effect** | Note the defence in depth: even if such a record existed, findBlockedTimeConflict skips any block whose end is not after its start, so it would block nothing - a stored malformed absence would be invisible rather than wrong. |
| **Exception / recovery** | An absence that silently blocks nothing is worse than a refusal, which is why the refusal matters. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/types.ts:100`<br>`functions/src/scheduling/availabilityModel.ts:194-196` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S05-A10 — Record the same PTO day twice because the first submit appeared to fail on a flaky connection

*Priya Raman (service_manager) · taylor · DESKTOP · RETRY_IDEMPOTENCY, DUPLICATE_DATA, DESKTOP*

**Account context.** n/a - internal workforce records, no customer account

| | |
| --- | --- |
| **Starting records / state** | The first create committed; the response was lost. |
| **Business purpose** | Workforce entry happens on phones in a shop, and duplicate submits are normal. |
| **Preconditions** | — One PTO block already exists for the window |
| **Action** | Submit the identical PTO block again. |
| **Expected EOS state transition** | CURRENT: refused with BLOCKED_TIME_CONFLICT - which, for an identical resubmit, is accidentally the right answer for the wrong reason. DESIRED under union semantics: an idempotency key should make the resubmit return the existing block. |
| **Expected authority / capability** | Authority present. |
| **Expected UI result** | CURRENT: an error that reads as a rule violation when it is actually a successful first attempt. |
| **Expected audit result** | One event, from the first submit. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | Lifting the overlap refusal without adding idempotency would turn every retry into a duplicate absence - so the two changes belong together. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'You already recorded this' is a different sentence from 'this conflicts'. |
| **Reset / replay** | Delete the block. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/scheduling/schedulingCommands.ts:460-468` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Blocked-time creation has no idempotency key; today the overlap refusal masks that, and removing the overlap refusal (as the Owner ruling requires) would expose it. |

</details>

### P3B1-S06 — The recommendation that does not know about PTO

**Account context.** Mixed Taylor route

The dispatcher board scores technicians for each unscheduled Work Order and shows the top recommendation on every queue card. Dale trusts it. This story tests whether the score deserves that trust, on a Thursday when Javier is on recorded PTO.

<details><summary>10 activities — P3B1-S06-A01 · P3B1-S06-A02 · P3B1-S06-A03 · P3B1-S06-A04 · P3B1-S06-A05 · P3B1-S06-A06 · P3B1-S06-A07 · P3B1-S06-A08 · P3B1-S06-A09 · P3B1-S06-A10</summary>

#### P3B1-S06-A01 — Read the top technician recommendation on a Ready-to-Schedule card

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | 9 ready Work Orders; 6 technicians with fieldops_technicians.status values. |
| **Business purpose** | The recommendation is the first thing on the card and shapes every placement decision. |
| **Preconditions** | — Technicians and Work Orders are loaded |
| **Action** | Read the recommended technician and score on a card. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. The engine runs client-side in the browser, batched across all queued Work Orders. |
| **Expected UI result** | A ranked technician with a 0-100 score and human-readable reasons. |
| **Expected audit result** | None - a recommendation is not a decision. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The engine ships and is wired into the board. ADR-004's claim that 'no implementation exists' is stale. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | 'What does this score mean?' - the reasons list answers it, which is good practice. |
| **Reset / replay** | Seed technicians and WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherBoard.jsx:16,210 (recommendTechniciansBatch is called)`<br>`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:166-190` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S06-A02 — Score technicians on a Thursday when Javier is on recorded PTO all day

*Dale Brackett (dispatcher) · taylor · DESKTOP · BAD_DATA, EXCEPTION, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | Javier has a COMPANY-recorded PTO block covering Thursday. His fieldops_technicians.status is still 'available'. |
| **Business purpose** | This is the defect the whole story exists for. |
| **Preconditions** | — A PTO blocked-time record covers the day<br>— fieldops_technicians.status is 'available' |
| **Action** | Read the recommendation for a Thursday Work Order. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | CURRENT: Javier scores 100 on the availability component and is likely recommended first, with the reason text 'Currently available'. The engine scores availability from the fieldops_technicians.status string and never consults governed blocked time. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The dispatcher acts on the recommendation, places the job, and is THEN refused by BLOCKED_TIME_CONFLICT - the board recommends exactly what the server will refuse. |
| **Exception / recovery** | The recovery is to guess a second technician and try again. Nothing tells the dispatcher why the recommendation was wrong. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'Currently available' is a claim the product makes and cannot support. |
| **Reset / replay** | Seed PTO plus status='available'. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · AI would be noise here · no obvious "why?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:112-126 (AVAILABILITY_BY_STATUS, available: 100; uses the technician's own TECH_STATUS field)`<br>`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:157 (reason text 'Currently available')`<br>`functions/src/scheduling/placementPolicy.ts:98-105 (the server refusal that follows)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The recommendation engine scores availability from fieldops_technicians.status and never reads governed blocked time. A technician on recorded PTO scores 100 and is recommended for the day the scheduler will refuse. Recommendation and enforcement disagree, and the dispatcher finds out only after committing. |

#### P3B1-S06-A03 — Read the territory-match component of the score

*Dale Brackett (dispatcher) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | Six technicians, Work Orders across Phoenix, Tempe and Tucson. |
| **Business purpose** | Drive time is the largest real cost in a service day. |
| **Preconditions** | — Work Orders at widely separated addresses |
| **Action** | Expand the score breakdown and read the territory reason. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | 'Territory match: no location data available for technicians (neutral, +0 pts vs. others)'. The component returns a flat neutral score for everyone because technicians have no comparable location field. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A dispatcher who believes the score accounts for geography will send a Phoenix technician to Tucson and a Tucson technician to Phoenix on the same morning. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The engine says so in the reason text, which is honest - the surface must not compress the reasons away. |
| **Reset / replay** | Seed geographically spread Work Orders. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:128-142 (scoreTerritoryMatch returns a flat neutral)`<br>`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:161` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S06-A04 — Score on a day when nobody has any active Work Orders yet

*Dale Brackett (dispatcher) · taylor · DESKTOP · UNUSUAL_BUT_LEGITIMATE, MISSING_DATA, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | 06:00, no active assignments. |
| **Business purpose** | The first placement of the day is the one the score is least able to help with. |
| **Preconditions** | — No active Work Orders |
| **Action** | Read the workload component. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Everyone scores 100 on workload - nobody is loaded, so nobody is penalised. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | With workload tied and territory flat, the ranking collapses onto availability and experience affinity alone. |
| **Exception / recovery** | If nobody has matching-type history either, everyone scores 0 on affinity and the 'top recommendation' is arbitrary among equals. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | A recommendation that is arbitrary should say it is arbitrary. |
| **Reset / replay** | Seed an empty day. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI would be noise here · no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:79-101` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | When workload is tied and territory is flat, a tie among equals is presented as a ranked recommendation with no signal that the ordering is arbitrary. |

#### P3B1-S06-A05 — Score a frozen-beverage job where only one technician has ever worked that type

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, CROSS_COMPANY, DESKTOP*

**Account context.** Tucson Gas & Go - Taylor 349 frozen beverage

| | |
| --- | --- |
| **Starting records / state** | Tonya has 14 historical FBD/frozen-beverage Work Orders; nobody else has any. |
| **Business purpose** | Experience affinity is the component that actually earns its weight. |
| **Preconditions** | — Historical Work Orders of the matching type exist |
| **Action** | Read the recommendation. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Tonya ranks first on affinity, scored across ALL statuses including active, because 'has handled this type' does not stop being true mid-job. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Tonya is a Ventana technician and the job is Ventana - but the engine does not know that, because neither the Work Order nor the score carries an operating company. |
| **Exception / recovery** | The same affinity logic would recommend a Ventana technician for a Taylor job with equal confidence. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | None needed for affinity itself. |
| **Reset / replay** | Seed 14 typed historical WOs for one technician. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:94-110` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S06-A06 — Place the job on the second-ranked technician against the recommendation

*Dale Brackett (dispatcher) · taylor · DESKTOP · UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | The engine ranks Javier first; Dale knows Javier is at a customer who has banned him. |
| **Business purpose** | A recommendation the dispatcher cannot override is not a recommendation. |
| **Preconditions** | — A ranked list exists |
| **Action** | Place on rank 2. |
| **Expected EOS state transition** | READY_TO_DISPATCH -> SCHEDULED on the chosen technician. |
| **Expected authority / capability** | Schedule. The engine has no authority; it recommends and the dispatcher decides. |
| **Expected UI result** | The placement proceeds normally. Nothing asks why the recommendation was not followed. |
| **Expected audit result** | The transition records the technician chosen, not the one recommended. |
| **Expected cross-object effect** | The override carries no signal back into future scoring - the engine learns nothing. |
| **Exception / recovery** | Facts like 'this customer has banned this technician' have no home in the model at all; that is MISSING_CAPABILITY. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Why did you not take the recommendation?' is a question worth one optional field. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:186-190` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No governed place to record a customer/technician exclusion, so the knowledge lives only in the dispatcher's head. |

#### P3B1-S06-A07 — Read the recommendation for a Work Order whose type is not set

*Dale Brackett (dispatcher) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | A Work Order created from an ambiguous email with no type classification. |
| **Business purpose** | Affinity keys off the Work Order's type. |
| **Preconditions** | — The WO type is absent or unrecognised |
| **Action** | Read the recommendation. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Affinity scores 0 for everyone; the recommendation quietly loses a quarter of its signal with no visible indication. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | Nothing prompts anyone to set the type. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | 'This score is weaker because the job type is not set' is the missing sentence. |
| **Reset / replay** | Seed a typeless WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:102-110,174` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A missing Work Order type silently degrades the recommendation with no signal to the dispatcher. |

#### P3B1-S06-A08 — Score a technician whose status string is a value the engine does not recognise

*Dale Brackett (dispatcher) · taylor · DESKTOP · BAD_DATA, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | A technician record carries status 'on_leave' - not one of available/on_job/off_shift. |
| **Business purpose** | Status strings drift; a legacy or hand-edited value is normal in real data. |
| **Preconditions** | — An unrecognised status value exists |
| **Action** | Read the score. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The engine falls back to a neutral 50 for any unrecognised status - so a technician marked on_leave is treated as half-available rather than unavailable. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Compounds the PTO defect: neither the governed absence nor an unrecognised status keeps a technician out of the ranking. |
| **Exception / recovery** | No warning that the status was not understood. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a technician with an off-vocabulary status. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:118-126 (AVAILABILITY_BY_STATUS[status] ?? 50)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | An unrecognised technician status silently scores 50 rather than being flagged, so data drift becomes a half-endorsement. |

#### P3B1-S06-A09 — Scroll the queue while the engine rescores every Work Order in the batch

*Dale Brackett (dispatcher) · taylor · DESKTOP · BULK, NORMAL, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | 40 Work Orders in the queue, 13 technicians. |
| **Business purpose** | The engine computes aggregates once and reuses them for every Work Order scored - a real board is not one card. |
| **Preconditions** | — A large queue |
| **Action** | Load the board and observe responsiveness. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Batch scoring is the supported shape; aggregates are computed once across technicians and Work Orders. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The whole computation is client-side, so a dispatcher on a weak machine gets a slower board, not a wrong one. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed 40 ready WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:43-50,208-222` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S06-A10 — Ask why the board recommended a technician who was on PTO, after the fact

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, END_OF_DAY, DESKTOP*

**Account context.** Mixed Taylor route

| | |
| --- | --- |
| **Starting records / state** | Thursday's placements were refused twice and the day ran late. |
| **Business purpose** | A service manager needs to know whether it was a person's mistake or the product's. |
| **Preconditions** | — The PTO/recommendation conflict occurred |
| **Action** | Look for any record of what was recommended. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Recommendations are computed in the browser and are not persisted; there is nothing to look at. |
| **Expected audit result** | No audit trail of recommendations. Only the transitions that succeeded are recorded. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The manager cannot distinguish 'the dispatcher ignored the score' from 'the score was wrong'. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherBoard.jsx:210 (computed in a useMemo, not persisted)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Recommendations are ephemeral and unaudited, so a systematic scoring defect leaves no evidence trail. |

</details>

### P3B1-S07 — 09:30 - the day changes: unschedule, reschedule, and the difference between them

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

A Taylor C602 at Cactus Burger goes fully down at 09:30 and jumps the queue. Dale has to take something off Curtis's afternoon. EOS gives him two different tools that look like one button: Unschedule, which is a lifecycle transition and the only reverse edge in the state machine, and Reschedule, which is a separate command that re-times a job without touching the lifecycle table at all.

<details><summary>10 activities — P3B1-S07-A01 · P3B1-S07-A02 · P3B1-S07-A03 · P3B1-S07-A04 · P3B1-S07-A05 · P3B1-S07-A06 · P3B1-S07-A07 · P3B1-S07-A08 · P3B1-S07-A09 · P3B1-S07-A10</summary>

#### P3B1-S07-A01 — Unschedule a SCHEDULED Work Order to return it to the Ready queue

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, RECOVERY, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | WO-2026-000148 SCHEDULED for Curtis 13:00-15:00. |
| **Business purpose** | The job is no longer the right thing to do this afternoon and should go back in the pool. |
| **Preconditions** | — The WO is in SCHEDULED |
| **Action** | Invoke Unschedule with a reason. |
| **Expected EOS state transition** | SCHEDULED -> READY_TO_DISPATCH. This is the FIRST and ONLY reverse edge in the transition table, and it is legal from SCHEDULED and nowhere else. |
| **Expected authority / capability** | Unschedule: admin/dispatcher, same role bucket as Schedule/Dispatch. No new capability family was registered for the scheduling commands. |
| **Expected UI result** | The card leaves Curtis's lane and reappears in the Ready-to-Schedule queue. |
| **Expected audit result** | A transition event with the reason. Unschedule is not in ACTION_TIMESTAMP_FIELD, so no execution timestamp is written. |
| **Expected cross-object effect** | Curtis's lane frees up; his percent-booked drops. |
| **Exception / recovery** | Once a technician has been dispatched the job is committed - DISPATCHED, ACCEPTED, EN_ROUTE, ARRIVED and WORK_IN_PROGRESS have no way back at all. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Unschedule works until you dispatch' is the rule, and the button's absence after dispatch will not explain itself. |
| **Reset / replay** | Re-schedule the WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:30-38 (ND-18, the only reverse edge)`<br>`functions/src/transitionEngine.ts:42 (SCHEDULED: DISPATCHED, READY_TO_DISPATCH, CANCELLED)`<br>`functions/src/transitionEngine.ts:133`<br>`functions/src/transitionEngine.ts:70 (Unschedule -> READY_TO_DISPATCH)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S07-A02 — Reschedule a job to a later window without taking it out of SCHEDULED

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | WO SCHEDULED for Javier 11:00-12:00; the customer asks for 15:00. |
| **Business purpose** | Re-timing is not un-committing; the job is still Javier's. |
| **Preconditions** | — The WO is in SCHEDULED |
| **Action** | Use Reschedule and supply the new window plus a required reason. |
| **Expected EOS state transition** | No lifecycle transition at all. Reschedule is a separate callable that never touches the transition table - it only re-times. |
| **Expected authority / capability** | Same admin/dispatcher bucket. |
| **Expected UI result** | A small modal asking only for the required reason string, then the new window. |
| **Expected audit result** | An event recording the re-timing and its reason. |
| **Expected cross-object effect** | The new window is re-validated against blocked time and overlapping Work Orders through the same placement policy. |
| **Exception / recovery** | NOT_SCHEDULED is refused: if the Work Order is not in SCHEDULED there is no schedule to change. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Unschedule vs Reschedule' is the single most confusable pair in this domain and neither button explains itself. |
| **Reset / replay** | Reschedule back. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:30-34 (ND-19: Reschedule never touches this table)`<br>`functions/src/scheduling/types.ts:103 (NOT_SCHEDULED)`<br>`field-ops-app-vite/src/modules/dispatcherBoard/ReasonPrompt.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Two commands with near-identical names do structurally different things - one is a lifecycle transition, one is not - and nothing on screen distinguishes them. |

#### P3B1-S07-A03 — Reschedule a Work Order using a stale view of its schedule

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, HANDOFF, RETRY_IDEMPOTENCY, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | Dale's board loaded at 08:00; another dispatcher moved the job at 09:15. |
| **Business purpose** | Two dispatchers on one board is the normal shape of a busy morning. |
| **Preconditions** | — The stored schedule differs from the client's view |
| **Action** | Submit the reschedule with the old window as the expected current state. |
| **Expected EOS state transition** | Refused with STALE_WORK_ORDER, mapped to an 'aborted' error. |
| **Expected authority / capability** | Authority present; an optimistic-concurrency refusal. |
| **Expected UI result** | The board must refresh to the real schedule rather than leaving the stale window on screen. |
| **Expected audit result** | No state change. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | This is the correct behaviour and the message must make the cause ('someone else moved it') obvious, not just 'aborted'. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'Who moved this, and to where?' has no location. |
| **Reset / replay** | Two sessions; move the job in one. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/scheduling/types.ts:110 (STALE_WORK_ORDER)`<br>`functions/src/scheduling/errorMapping.ts:66` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S07-A04 — Attempt to Unschedule a job the technician has already accepted

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, PERMISSION_DENIAL, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | WO in ACCEPTED - Curtis tapped Accept at 09:05. |
| **Business purpose** | The commitment boundary is real and must be visible. |
| **Preconditions** | — The WO is in ACCEPTED |
| **Action** | Look for the Unschedule action. |
| **Expected EOS state transition** | Not available. ACCEPTED's only onward moves are EN_ROUTE and CANCELLED. |
| **Expected authority / capability** | Unschedule is admin/dispatcher, but the edge does not exist from ACCEPTED, so getAllowedActions filters it out on the transition check before the role check. |
| **Expected UI result** | The button is simply absent, with no explanation of why it was there ten minutes ago. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | The dispatcher's only tool now is Cancel, which is terminal - a far heavier act than un-scheduling. |
| **Exception / recovery** | The practical recovery is to phone the technician and cancel, then create a new Work Order. That is a lot of ceremony for 'not today after all'. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | A disabled button with a title= explaining 'this job is committed - the technician has accepted it' would be better than absence. |
| **Reset / replay** | Return the WO to SCHEDULED via a fresh fixture; ACCEPTED cannot go back. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:36-38`<br>`functions/src/transitionEngine.ts:44 (ACCEPTED: EN_ROUTE, CANCELLED)`<br>`functions/src/transitionEngine.ts:152-172` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Between ACCEPTED and COMPLETED the only way to stop a job is Cancel, which is terminal. There is no 'stand down, we will re-plan' move. |

#### P3B1-S07-A05 — Cancel a committed job because the customer closed for a burst pipe

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, HANDOFF, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Mill Ave

| | |
| --- | --- |
| **Starting records / state** | WO in EN_ROUTE; Curtis is ten minutes away. |
| **Business purpose** | Cancellation from any active state is legal and should be, because reality cancels jobs. |
| **Preconditions** | — The WO is in a non-terminal, non-COMPLETED state |
| **Action** | Cancel with a reason. |
| **Expected EOS state transition** | EN_ROUTE -> CANCELLED. Every active status carries CANCELLED as an option; COMPLETED is the exception - it goes only to CLOSED and is not cancellable. |
| **Expected authority / capability** | Cancel: admin/dispatcher. |
| **Expected UI result** | The card leaves the board. |
| **Expected audit result** | A cancellation event with reason, and a cancelledAt-style timestamp. |
| **Expected cross-object effect** | Curtis is still driving. Whether the cancellation reaches his phone promptly, and what happens if he is offline, is the live question - see the offline story. |
| **Exception / recovery** | If the technician arrives before the cancellation syncs he works a cancelled Work Order, and CANCELLED is terminal with no way back. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'The technician has not seen this yet' is a state the dispatcher needs and cannot have. |
| **Reset / replay** | Fresh fixture; CANCELLED is terminal. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:39-51`<br>`functions/src/transitionEngine.ts:25 (COMPLETED only goes to CLOSED, not cancellable)`<br>`functions/src/transitionEngine.ts:137` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No read receipt on a cancellation: a dispatcher cannot tell whether the technician's device has received it, and a terminal state has no undo if the technician works the job anyway. |

#### P3B1-S07-A06 — Squeeze the emergency Cactus Burger job into the hole the unscheduled job left

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, EXCEPTION, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | Curtis's 13:00-15:00 is free; the emergency WO is in READY_TO_DISPATCH. |
| **Business purpose** | The whole point of unscheduling was to make room. |
| **Preconditions** | — The window is free of blocked time and other placements |
| **Action** | Place the emergency job 13:00-15:00 on Curtis. |
| **Expected EOS state transition** | READY_TO_DISPATCH -> SCHEDULED. |
| **Expected authority / capability** | Schedule. |
| **Expected UI result** | The lane fills. |
| **Expected audit result** | A transition event. |
| **Expected cross-object effect** | Priority 1 / EQUIPMENT_DOWN is recorded on the Work Order, but nothing in the scheduling model treats priority differently - a priority-1 placement is validated identically to a priority-4 one. |
| **Exception / recovery** | There is no 'emergency override' that lets a priority-1 job displace a blocked-time or conflict refusal, and arguably there should not be - but nothing says so. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'Priority affects what humans do first, not what the scheduler allows.' |
| **Reset / replay** | Unschedule. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/types/workOrder.ts:28-36 (Priority, Severity)`<br>`functions/src/scheduling/placementPolicy.ts:65-126` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S07-A07 — Reschedule without supplying a reason

*Dale Brackett (dispatcher) · taylor · DESKTOP · BAD_DATA, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | A SCHEDULED job; the reason field is blank. |
| **Business purpose** | Re-timing is a decision someone will have to explain at month end. |
| **Preconditions** | — The WO is in SCHEDULED |
| **Action** | Submit the reschedule with an empty reason. |
| **Expected EOS state transition** | Refused with REASON_REQUIRED. |
| **Expected authority / capability** | Authority present. |
| **Expected UI result** | A field-level error in the reason prompt. |
| **Expected audit result** | Nothing written. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A required free-text field invites 'asdf'. The refusal enforces presence, not meaning. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | Reason presets would beat a blank box for both speed and analysis. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/types.ts:104 (REASON_REQUIRED)`<br>`field-ops-app-vite/src/modules/dispatcherBoard/ReasonPrompt.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S07-A08 — Unschedule a Taylor Work Order from the Ventana board

*Brett Hollins (dispatcher) · ventana · DESKTOP · CROSS_COMPANY, PERMISSION_DENIAL, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | A Taylor-originated WO is SCHEDULED on a shared technician. |
| **Business purpose** | Nothing stops it, and that is the finding. |
| **Preconditions** | — Brett holds the dispatcher role |
| **Action** | Invoke Unschedule. |
| **Expected EOS state transition** | SCHEDULED -> READY_TO_DISPATCH. Succeeds. |
| **Expected authority / capability** | ACTION_PERMISSIONS.Unschedule lists admin and dispatcher. There is no company dimension in the permission model and no operatingCompanyId on the Work Order to compare against. |
| **Expected UI result** | Nothing warns. The card simply moves. |
| **Expected audit result** | An event naming Brett as the actor - which is the ONLY trace that a Ventana dispatcher touched a Taylor job, and only because his identity implies it. |
| **Expected cross-object effect** | The Taylor coordinator's committed customer promise evaporates with no notification. |
| **Exception / recovery** | No recovery is offered because no error occurred. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - this is an authority gap, not a help gap. |
| **Reset / replay** | Re-schedule. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · role handoff unclear · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:128-143`<br>`functions/src/types/workOrder.ts (no operatingCompanyId)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Cross-company authority on Work Orders is unenforceable: no Work Order records a company and no permission consults one. Operating-company attribution is recoverable only by inferring it from the actor. |

#### P3B1-S07-A09 — Tell the customer the new time after a reschedule

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, HANDOFF, DESKTOP*

**Account context.** Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | The job moved from 09:00 to 14:00. |
| **Business purpose** | The customer promise is the thing the schedule exists to keep. |
| **Preconditions** | — The reschedule succeeded |
| **Action** | Look for a customer-notification action on the Work Order. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | CURRENT: the Work Order detail page carries a deliberately-disabled 'Message technician' placeholder with a title= explaining it is not available yet and not a permission limit. A customer-facing notification is not present either. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The coordinator picks up the phone. The promise lives outside EOS. |
| **Exception / recovery** | If nobody calls, a technician arrives at a locked convention centre. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | The disabled placeholder with an honest title= is good practice; the missing capability is the point. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrderDetailPage.jsx:289-305 (disabled placeholders with explanatory title=)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Rescheduling changes a customer promise and EOS has no notification path; MISSING_CAPABILITY. |

#### P3B1-S07-A10 — Review what actually changed on the board this morning

*Dale Brackett (dispatcher) · taylor · DESKTOP · HANDOFF, END_OF_DAY, DESKTOP*

**Account context.** Cactus Burger Co. #12, Sonoran Scoops Mill Ave, Camelback Convention Center

| | |
| --- | --- |
| **Starting records / state** | Six placements, two unschedules, three reschedules since 07:55. |
| **Business purpose** | At 10:00 a dispatcher needs to know what the board looked like an hour ago. |
| **Preconditions** | — Several board actions have occurred |
| **Action** | Open the dispatcher activity feed. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | A collapsible SESSION-ONLY recent-activity strip. It shows this browser session's actions, not the day's. |
| **Expected audit result** | The durable record is the audit event stream, which is not this strip. |
| **Expected cross-object effect** | A dispatcher who reloads the page loses the feed; a dispatcher taking over at shift change never had one. |
| **Exception / recovery** | The handoff dispatcher has no view of what the morning dispatcher did. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'This is your session only' must be said, or it reads as the day's history. |
| **Reset / replay** | Reload the page - the feed empties, which is itself the test. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherActivityFeed.jsx (session-only)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The only board-change history a dispatcher can see is session-scoped, so it is empty exactly when it matters most - at a shift handoff or after a reload. |

</details>

### P3B1-S08 — 10:10 - dispatching: committing a named technician to a named job

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

Scheduling says when. Dispatch says go. The Dispatch action is the one that writes assignedTechId and starts the technician's half of the lifecycle, and it is the last point at which a dispatcher can change their mind cheaply.

<details><summary>10 activities — P3B1-S08-A01 · P3B1-S08-A02 · P3B1-S08-A03 · P3B1-S08-A04 · P3B1-S08-A05 · P3B1-S08-A06 · P3B1-S08-A07 · P3B1-S08-A08 · P3B1-S08-A09 · P3B1-S08-A10</summary>

#### P3B1-S08-A01 — Dispatch the emergency Cactus Burger job to Curtis

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, HANDOFF, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | WO SCHEDULED for Curtis 13:00-15:00. |
| **Business purpose** | Turn a plan into an instruction a technician's phone will show. |
| **Preconditions** | — The WO is in SCHEDULED<br>— Curtis is not occupied by another Work Order |
| **Action** | Invoke Dispatch. |
| **Expected EOS state transition** | SCHEDULED -> DISPATCHED. Dispatch is special-cased: it sets assignedTechId (who is actually being dispatched) in addition to writing its own dispatchedAt execution timestamp. |
| **Expected authority / capability** | Dispatch: admin/dispatcher, requiresOwnAssignment false. |
| **Expected UI result** | The card changes state; the job appears on Curtis's device. |
| **Expected audit result** | A transition event with a server-clock dispatchedAt - not a client Date.now(), which is what makes the immutable-timestamp requirement enforceable. |
| **Expected cross-object effect** | assignedTechId is now set, which is the field the technician's own read gate compares against. |
| **Exception / recovery** | Until Dispatch runs, the Work Order carries no assignedTechId at all - pre-dispatch statuses have none. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Scheduled vs Dispatched' deserves the same treatment as 'Unschedule vs Reschedule'. |
| **Reset / replay** | Fresh fixture - DISPATCHED has no reverse edge. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:89-91 (Dispatch sets assignedTechId)`<br>`functions/src/transitionEngine.ts:92-99 (dispatchedAt)`<br>`functions/src/transitionEngine.ts:135`<br>`functions/src/types/workOrder.ts:6-12 (server timestamps, not client Date.now())` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S08-A02 — Dispatch a second Work Order to a technician already occupied by one

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, RETRY_IDEMPOTENCY, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | Curtis is in ARRIVED on WO-A; Dale dispatches WO-B to him. |
| **Business purpose** | Without a guard, transitionWorkOrder would set assignedTechId unconditionally and double-book the technician. |
| **Preconditions** | — Curtis has another WO in an occupying status |
| **Action** | Invoke Dispatch on WO-B. |
| **Expected EOS state transition** | Refused - a double-booking conflict naming WO-A. |
| **Expected authority / capability** | Dispatch authority present; an availability-guard refusal. |
| **Expected UI result** | The refusal should name the Work Order that occupies him. |
| **Expected audit result** | No state change. |
| **Expected cross-object effect** | Occupying statuses are DISPATCHED, ACCEPTED, EN_ROUTE, ARRIVED and WORK_IN_PROGRESS. Pre-dispatch statuses carry no assignedTechId; terminal statuses free the technician. |
| **Exception / recovery** | Re-dispatching the SAME Work Order is explicitly not a conflict, so a retry is safe. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'Occupied means what, exactly?' - the five statuses are worth naming. |
| **Reset / replay** | Complete or cancel WO-A. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/workOrderAvailability.ts:1-4,9-21 (OCCUPYING_STATUSES)`<br>`functions/src/workOrderAvailability.ts:23-42 (findDoubleBookingConflict; same WO is not a conflict)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S08-A03 — Dispatch a job scheduled for Thursday on Tuesday morning

*Dale Brackett (dispatcher) · taylor · DESKTOP · MISTAKE, EXCEPTION, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | WO SCHEDULED for Thursday 09:00; it is Tuesday 10:10. |
| **Business purpose** | Dispatch and schedule are separate facts, and nothing ties Dispatch to the scheduled window. |
| **Preconditions** | — The WO is in SCHEDULED with a future window |
| **Action** | Invoke Dispatch. |
| **Expected EOS state transition** | SCHEDULED -> DISPATCHED. Succeeds. The transition table does not consult scheduledStart. |
| **Expected authority / capability** | Dispatch. |
| **Expected UI result** | Nothing warns that the job is two days out. It now appears on the technician's device as a live assignment. |
| **Expected audit result** | dispatchedAt is recorded as now, which is two days before the work was planned. |
| **Expected cross-object effect** | The technician is now occupied for double-booking purposes for two days, because DISPATCHED is an occupying status - so Dale cannot dispatch anything else to him until Thursday. |
| **Exception / recovery** | This is a real and reachable operational deadlock caused by a premature click. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'Dispatching now will occupy this technician until the job completes' is the missing warning. |
| **Reset / replay** | Cancel the WO and re-create; DISPATCHED has no reverse edge. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:42 (SCHEDULED -> DISPATCHED, no time guard)`<br>`functions/src/workOrderAvailability.ts:9-21` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Dispatching a future-dated Work Order succeeds and occupies the technician immediately, blocking all other dispatch to them until the job leaves an occupying status - with no warning and no reverse edge to undo it. |

#### P3B1-S08-A04 — Dispatch to a technician with no working availability record at all

*Dale Brackett (dispatcher) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | A newly hired technician; fieldops_technicians exists, availability does not. |
| **Business purpose** | Dispatch is a different check from Schedule, and the two do not warn alike. |
| **Preconditions** | — No working availability document |
| **Action** | Invoke Dispatch. |
| **Expected EOS state transition** | SCHEDULED -> DISPATCHED. The working-hours assessment belongs to the scheduling commands; Dispatch does not repeat it. |
| **Expected authority / capability** | Dispatch. |
| **Expected UI result** | No warning at dispatch time, even though the same placement would have warned at schedule time. |
| **Expected audit result** | A transition event without the warning. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | The warning is attached to the wrong moment for a dispatcher who schedules and dispatches in one motion. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Delete the availability doc. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:207-218 (warnings ride with a successful SCHEDULE)`<br>`functions/src/transitionEngine.ts:135` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S08-A05 — Dispatch eleven jobs at the start of the run

*Dale Brackett (dispatcher) · taylor · DESKTOP · BULK, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | Eleven SCHEDULED Work Orders across six technicians. |
| **Business purpose** | Dispatch is a batch act in practice even though it is a per-record command. |
| **Preconditions** | — All eleven are SCHEDULED |
| **Action** | Dispatch each in turn. |
| **Expected EOS state transition** | Eleven SCHEDULED -> DISPATCHED transitions. |
| **Expected authority / capability** | Dispatch, eleven times. No bulk-dispatch command exists; if one is wanted, that is MISSING_CAPABILITY. |
| **Expected UI result** | Eleven actions. |
| **Expected audit result** | Eleven events with eleven distinct dispatchedAt timestamps. |
| **Expected cross-object effect** | Each sets assignedTechId; the second dispatch to any technician already occupied is refused, so ordering matters and the dispatcher must discover that by hitting it. |
| **Exception / recovery** | A partial batch leaves some jobs dispatched and some not, with no summary. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | '8 of 11 dispatched, 3 refused because those technicians are occupied' is the summary nobody gets. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:135`<br>`functions/src/workOrderAvailability.ts:23-42` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S08-A06 — Dispatch from the legacy Jobs surface instead of the board

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | The Service > Job Assignments screen lists pending Work Orders. |
| **Business purpose** | Two surfaces reach the same governed action, and users learn whichever they were shown first. |
| **Preconditions** | — Pending Work Orders exist |
| **Action** | Assign a pending Work Order to an available technician from the Dispatch/Jobs screen. |
| **Expected EOS state transition** | SCHEDULED -> DISPATCHED via the same governed Dispatch transition. |
| **Expected authority / capability** | Dispatch. The Jobs list reads the governed Work Order Engine collection, not the old jobs collection. |
| **Expected UI result** | A different layout reaching the same command - correct architecture, confusing product. |
| **Expected audit result** | Identical events regardless of surface. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A dispatcher who only knows the Jobs screen never sees blocked time, recommendations or capacity. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | Neither surface says the other exists. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/dispatch/Dispatch.jsx`<br>`field-ops-app-vite/src/modules/jobs/Jobs.jsx (reads fieldops_wos, not fieldops_jobs)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Three separate surfaces (Dispatcher Board, Dispatch, Job Assignments) reach the same Dispatch transition with very different context; a dispatcher on the thinnest one makes the same commitment with the least information. |

#### P3B1-S08-A07 — Attempt Dispatch as a service coordinator

*Marisol Vega (service_coordinator) · taylor · DESKTOP · PERMISSION_DENIAL, HANDOFF, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | A SCHEDULED WO; Marisol's legacy role is not dispatcher. |
| **Business purpose** | The coordinator who owns the customer relationship cannot commit a technician. |
| **Preconditions** | — Marisol lacks admin/dispatcher |
| **Action** | Invoke the Dispatch action. |
| **Expected EOS state transition** | Refused. |
| **Expected authority / capability** | ACTION_PERMISSIONS.Dispatch lists admin and dispatcher only. |
| **Expected UI result** | The action is not offered on her surfaces. |
| **Expected audit result** | DESIRED: refused privileged actions recorded. UNPROVEN whether they are. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | At 17:30 when the dispatcher has gone home, the coordinator taking an emergency call cannot dispatch anybody - which is the after-hours story. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | A denial that names who can act is worth more than the denial. |
| **Reset / replay** | Swap roles. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:135`<br>`functions/src/transitionEngine.ts:152-172` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S08-A08 — Dispatch a Work Order with no address on it

*Dale Brackett (dispatcher) · taylor · DESKTOP · MISSING_DATA, EXCEPTION, DESKTOP*

**Account context.** Rio Salado High School District - cafeteria soft-serve, address never captured

| | |
| --- | --- |
| **Starting records / state** | A WO created from an email whose body named a school but not a street. |
| **Business purpose** | The technician has to drive somewhere. |
| **Preconditions** | — The WO carries no usable address |
| **Action** | Invoke Dispatch. |
| **Expected EOS state transition** | SCHEDULED -> DISPATCHED. Succeeds. Neither MarkReady nor Dispatch validates completeness. |
| **Expected authority / capability** | Dispatch. |
| **Expected UI result** | The technician receives a job with nowhere to go. |
| **Expected audit result** | A normal transition event. |
| **Expected cross-object effect** | The technician phones dispatch, which is the whole cost of the missing validation. |
| **Exception / recovery** | There is no 'this job is not workable' action for the technician - only Accept, Travel, Arrive, WorkStart, Complete. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | A readiness checklist at MarkReady is the fix; an (i) is not. |
| **Reset / replay** | Seed a WO without an address. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:128-143 (no completeness gate on any action)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A Work Order with no address can be marked ready, scheduled and dispatched. The technician has no governed way to reject it - the technician action vocabulary has no 'cannot work this' verb. |

#### P3B1-S08-A09 — Watch a dispatched job that the technician has not accepted after 40 minutes

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, MISSING_DATA, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | WO DISPATCHED at 10:10; it is 10:50 and still DISPATCHED. |
| **Business purpose** | An unaccepted dispatch is the earliest signal that a technician's day has gone wrong. |
| **Preconditions** | — The WO has been in DISPATCHED for 40 minutes |
| **Action** | Look for an ageing or exception indicator on the board. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether any time-in-status indicator exists on the board. If none does, this is MISSING_CAPABILITY. |
| **Expected audit result** | dispatchedAt is recorded, so the elapsed time is computable. |
| **Expected cross-object effect** | The most likely causes - phone dead, no signal, technician stuck at the previous job - are all invisible. |
| **Exception / recovery** | The dispatcher phones. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a WO with an old dispatchedAt. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:92-99 (dispatchedAt exists to make this computable)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S08-A10 — Dispatch the same Work Order twice after a slow response

*Dale Brackett (dispatcher) · taylor · DESKTOP · RETRY_IDEMPOTENCY, DESKTOP*

**Account context.** Cactus Burger Co. #12 (emergency), QuikMart #418, Rio Salado High School District

| | |
| --- | --- |
| **Starting records / state** | The first Dispatch committed; the UI did not update. |
| **Business purpose** | Retry under latency is the normal failure mode of a busy dispatcher. |
| **Preconditions** | — The WO is already DISPATCHED |
| **Action** | Invoke Dispatch again. |
| **Expected EOS state transition** | Refused - DISPATCHED is not a legal source for the Dispatch action, whose only legal source is SCHEDULED. |
| **Expected authority / capability** | Authority present; a transition-table refusal. |
| **Expected UI result** | The refusal must read as 'already dispatched', not as a permission or system error. |
| **Expected audit result** | One dispatchedAt, not two - which matters, because the second would overwrite the first and corrupt response-time metrics. |
| **Expected cross-object effect** | Re-dispatching the same Work Order is explicitly not a double-booking conflict, so the refusal comes from the table, not the guard. |
| **Exception / recovery** | Correct behaviour; the risk is the wording. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Already dispatched at 10:10 to Curtis Nally.' |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:59-61 (canTransition)`<br>`functions/src/transitionEngine.ts:42-43`<br>`functions/src/workOrderAvailability.ts:37` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S09 — Who is this technician? - the two-hop identity join and the 13 that resolved to 0

**Account context.** n/a - identity and access, no customer account

A technician's phone shows their jobs because users/{uid}.technicianId points at a fieldops_technicians record. Their truck's stock shows up because trucks.assignedDriverEmployeeId points at an employees record. These are two different id spaces, and joining them is where the day quietly breaks.

<details><summary>10 activities — P3B1-S09-A01 · P3B1-S09-A02 · P3B1-S09-A03 · P3B1-S09-A04 · P3B1-S09-A05 · P3B1-S09-A06 · P3B1-S09-A07 · P3B1-S09-A08 · P3B1-S09-A09 · P3B1-S09-A10</summary>

#### P3B1-S09-A01 — Sign in on the phone and see the jobs assigned to me

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | users/{curtis}.technicianId is set and resolves to a fieldops_technicians record. |
| **Business purpose** | Everything the technician app does depends on this one hop. |
| **Preconditions** | — users/{uid}.technicianId is populated<br>— The fieldops_technicians record exists |
| **Action** | Sign in and open the technician workspace. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Two hops: users/{uid}.technicianId then fieldops_technicians/{technicianId}, resolved live via a snapshot listener - deliberately NOT folded into the auth context. Rules read the same field via callerTechnicianId(), which is Admin-SDK-written and client-immutable, and fails closed when signed out, absent, or missing. |
| **Expected UI result** | The phone-width shell with Home/Jobs/Scan/More tabs. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The Work Order read gate compares fieldops_wos.assignedTechId against this technicianId. |
| **Exception / recovery** | A missing technicianId fails closed: no jobs, rather than everyone's jobs. That is the right direction. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None at this level. |
| **Reset / replay** | Seed users/{uid}.technicianId and a matching technician record. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/hooks/useCurrentTechnician.js:10-20`<br>`firestore.rules:320-327 (callerTechnicianId, fail closed)`<br>`firestore.rules:507-508`<br>`field-ops-app-vite/src/modules/technician/TechnicianShell.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S09-A02 — Sign in as a technician whose users/{uid}.technicianId was never populated

*Wes Tanner (apprentice_technician) · taylor · MOBILE · MISSING_DATA, PERMISSION_DENIAL, MOBILE*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | A newly provisioned account with role 'technician' and no technicianId. |
| **Business purpose** | This is the most common onboarding failure and it presents as 'the app is broken'. |
| **Preconditions** | — users/{uid}.technicianId is absent |
| **Action** | Sign in and open Jobs. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | callerTechnicianId() returns null, so every technician-scoped read is denied. Fail closed. |
| **Expected UI result** | An empty jobs list. DESIRED: the honest-state vocabulary should distinguish 'you have no jobs today' from 'your account is not linked to a technician record'. Which one renders here is UNPROVEN. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The technician cannot read their own fieldops_technicians record either, because that read is also gated on the same field. |
| **Exception / recovery** | The recovery requires an administrator to set a field the technician cannot see or name. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | 'Your account is not linked to a technician record. Ask your administrator.' is the difference between a five-minute fix and a lost morning. |
| **Reset / replay** | Clear users/{uid}.technicianId. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `firestore.rules:320-327`<br>`firestore.rules:397-404 (technician reads only their OWN record)`<br>`field-ops-app-vite/src/shared/ui/HonestState.jsx (EMPTY vs CAPABILITY_NOT_ENABLED vocabulary)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | An unlinked technician account is indistinguishable from a technician with no work, because both render as an empty list. |

#### P3B1-S09-A03 — Open the parts source picker and look for my truck

*Curtis Nally (field_technician) · taylor · MOBILE · BAD_DATA, MOBILE, MISSING_DATA*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | Curtis has a fieldops_technicians record; a truck exists with him as its assigned driver, recorded as an employees id. |
| **Business purpose** | The truck is where 80% of parts on a service call come from. |
| **Preconditions** | — A truck record exists with assignedDriverEmployeeId set<br>— The technician is recording a positive parts delta |
| **Action** | Increment a planned part on the execution capture screen and open the source picker. |
| **Expected EOS state transition** | None until the usage is submitted. |
| **Expected authority / capability** | The server resolves the technician's own governed truck by querying trucks where assignedDriverEmployeeId == technicianId. |
| **Expected UI result** | A select grouped into 'Warehouses' and 'My truck'. If the truck does not resolve, the 'My truck' group is simply absent. |
| **Expected audit result** | None for opening the picker. |
| **Expected cross-object effect** | THE JOIN: the value passed in is a fieldops_technicians id, while assignedDriverEmployeeId holds an employees id. These are different id spaces. A read-side execution of this join resolved 0 of 13 technicians, and it failed silently - an empty query result is indistinguishable from 'this technician has no truck'. |
| **Exception / recovery** | The technician sees only warehouses and either picks a warehouse he was never at, or gives up and does not record the part. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Why is my truck not listed?' has no answer on screen. |
| **Reset / replay** | Seed a truck whose assignedDriverEmployeeId is the technician's employees id, and one where it is their fieldops_technicians id, and compare. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · help missing when needed · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:59-78 (query on assignedDriverEmployeeId == technicianId)`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:77-104 (Warehouses / My truck optgroups)`<br>`field-ops-app-vite/src/hooks/useCurrentTechnician.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The technician-to-truck join crosses two id spaces (fieldops_technicians id vs employees id) and returns empty rather than erroring. A technician whose truck does not resolve is offered warehouses only, and the misattributed consumption that follows is inventory damage that looks like normal use. |

#### P3B1-S09-A04 — Find my truck listed twice because two truck records name me as driver

*Curtis Nally (field_technician) · taylor · MOBILE · BAD_DATA, DUPLICATE_DATA, MOBILE*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | A data-entry error left two trucks with the same assigned driver. |
| **Business purpose** | The Truck Registry promises one truck per driver; if the data says otherwise the promise is broken. |
| **Preconditions** | — Two trucks share an assignedDriverEmployeeId |
| **Action** | Open the source picker. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The resolver returns ambiguous and offers NO mobile option at all - two trucks is fail-closed, not 'pick one'. Choosing arbitrarily would turn a defect into a silent inventory misattribution. |
| **Expected UI result** | No 'My truck' group. The caller can surface the ambiguity; whether the UI does is UNPROVEN. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Cross-truck driver uniqueness is enforced on the write side by the Truck Registry, so this state is reachable only through data import or direct writes. |
| **Exception / recovery** | Correct fail-closed behaviour whose only flaw is silence. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Your truck could not be identified - two vehicles list you as driver' is a fixable message; a missing group is not. |
| **Reset / replay** | Seed two trucks with the same driver. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:63-67,78-79`<br>`functions/src/truckRegistry/truckRegistryCommands.ts:278-283 (uniqueness enforced on write)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S09-A05 — Find my truck missing because it has no locationId

*Curtis Nally (field_technician) · taylor · MOBILE · MISSING_DATA, MOBILE*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | The truck record exists and names Curtis, but carries no inventory locationId. |
| **Business purpose** | A truck without a stock location is not a place stock can come from. |
| **Preconditions** | — The truck has a null or blank locationId |
| **Action** | Open the source picker. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The resolver returns ambiguous - no mobile option. |
| **Expected UI result** | Again, no 'My truck' group, for a third distinct reason, and the three are indistinguishable on screen. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Three different data faults (no truck, two trucks, no location) collapse into one identical empty UI. |
| **Exception / recovery** | None offered. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | Three causes deserve three messages. |
| **Reset / replay** | Null the truck's locationId. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:80-82` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Four distinct truck-resolution outcomes (no truck, two trucks, no locationId, out-of-service) collapse into one indistinguishable absent option. |

#### P3B1-S09-A06 — Find my truck missing because it is marked out of service

*Curtis Nally (field_technician) · taylor · MOBILE · EXCEPTION, UNUSUAL_BUT_LEGITIMATE, MOBILE*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | The truck's status is not ACTIVE - it is in the shop for brakes. |
| **Business purpose** | An out-of-service truck is a legitimate business state. |
| **Preconditions** | — The truck's status is not ACTIVE |
| **Action** | Open the source picker. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The resolver returns no mobile option and, unlike the two-truck case, marks it NOT ambiguous - a deliberate distinction. |
| **Expected UI result** | No 'My truck' group, with no statement that the truck is out of service. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Curtis is driving a loaner and his stock is physically on it; there is no way to say so. |
| **Exception / recovery** | He records the part against a warehouse, and the warehouse count goes wrong. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Your truck is marked out of service' is a sentence the server already knows and does not send. |
| **Reset / replay** | Set truck status to something other than ACTIVE. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:83-84` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A technician driving a loaner truck has no governed way to record which vehicle stock actually came from. |

#### P3B1-S09-A07 — Audit how many technicians actually resolve to a truck

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | 13 technicians, a fleet of trucks. |
| **Business purpose** | This join is invisible until it fails, and it fails for everyone at once. |
| **Preconditions** | — Technicians and trucks exist |
| **Action** | Look for a surface that reports technician-to-truck linkage. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The legacy technicians directory is orphaned - it is no longer reachable from routed navigation, and its own header records that it was attempted and declined for cause. Administration now redirects to users. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | There is no surface that shows the technician/employee/truck triangle, which is exactly why 0 of 13 could go unnoticed. |
| **Exception / recovery** | The finding required a deliberate investigation, not a screen. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/technicians/Technicians.jsx (orphaned, unreachable)`<br>`field-ops-app-vite/src/App.jsx:1011-1015 (administration redirects to users)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No surface reports technician-to-truck or user-to-technician linkage health, so a total join failure produces no alert and no screen anyone would check. |

#### P3B1-S09-A08 — Read my own technician record to check my status

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | Curtis is signed in with a valid technicianId. |
| **Business purpose** | His status drives whether the recommendation engine offers him work. |
| **Preconditions** | — The technicianId resolves |
| **Action** | Open the technician home and look for the status. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | A technician may read ONLY their own mapped technician record, by direct doc read. An unconstrained technician read is denied. |
| **Expected UI result** | A status label mapped from the raw status string. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This status is what the recommendation engine scores on. Curtis cannot see - and cannot change - the field that decides whether he is recommended. |
| **Exception / recovery** | If the status is stale (left at on_job overnight), he is scored as occupied all the next day with no way to notice. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'This status affects whether you get assigned work' is worth saying. |
| **Reset / replay** | Set various status values. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `firestore.rules:397-404`<br>`field-ops-app-vite/src/modules/dispatcherBoard/technicianStatusLabel.js`<br>`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:118-126` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A stale technician status silently suppresses or inflates recommendations and the technician has no visibility into it. |

#### P3B1-S09-A09 — Read the role that actually decides what a user can see

*Dale Brackett (dispatcher) · taylor · DESKTOP · PERMISSION_DENIAL, MISSING_DATA, DESKTOP*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | A user doc with role 'dispatcher'. |
| **Business purpose** | The whole Service/Technician access model rides on one legacy string. |
| **Preconditions** | — The user doc exists |
| **Action** | Trace what gates the dispatcher board. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The app reads users/{uid}.role once at session resolution and exposes it as useAuth().role; nav gating keys off it via ROLE_NAV_ACCESS. A governed capability path exists and is live for newer surfaces (Inbound Work, Report Builder, Scan, Warehouse handheld), and capability wins outright where declared - but it has NOT been extended to the core dispatch and technician routes. |
| **Expected UI result** | Nav visibility, not data access, is what the role string controls in the client; Rules enforce the data side separately. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | No workOrder.read capability exists in the permission catalog at all, so Work Order visibility cannot be expressed in the governed model even if someone wanted to. |
| **Exception / recovery** | A user with the right capabilities and the wrong legacy role sees the wrong app. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Vary users/{uid}.role. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/auth/employeeSession.js:52 (const role = userData?.role ?? null)`<br>`field-ops-app-vite/src/domain/constants.js:374-378 (ROLE_NAV_ACCESS)`<br>`field-ops-app-vite/src/navigation/navConfig.js:663-672 (capability wins outright where declared)`<br>`functions/src/ai/workOrderContext.ts:19 (no workOrder.read capability exists)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Core dispatch and technician access is still gated by a legacy role string while the governed capability system exists and is used elsewhere; Work Order read has no capability at all, so the gap cannot be closed without inventing one. |

#### P3B1-S09-A10 — Reach a technician surface by typing the URL rather than using the nav

*Wes Tanner (apprentice_technician) · taylor · MOBILE · PERMISSION_DENIAL, MOBILE*

**Account context.** n/a - identity and access, no customer account

| | |
| --- | --- |
| **Starting records / state** | Wes's role grants only the fieldMode, jobs and technicianDashboard legacy keys. |
| **Business purpose** | Hidden nav is not access control. |
| **Preconditions** | — Wes is signed in as a technician |
| **Action** | Navigate directly to /service/dispatcher-board and to /service/work-orders/<id>. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The Work Order wizard and detail routes carry an explicit, separate gate on workOrder.create that excludes technicians deliberately - not merely a nav omission. The dispatcher board is gated on the legacy key. |
| **Expected UI result** | The routes should refuse rather than render empty. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Even if a route rendered, Rules deny a technician any Work Order not assigned to them, so the data layer holds. |
| **Exception / recovery** | The correct failure is an honest 'you do not have access to this' state, not a blank page. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | The honest-state vocabulary already has CAPABILITY_NOT_ENABLED for exactly this. |
| **Reset / replay** | Sign in as each role and try each route. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/App.jsx:1044-1052`<br>`field-ops-app-vite/src/domain/constants.js:374-378`<br>`firestore.rules:507-508`<br>`field-ops-app-vite/src/shared/ui/HonestState.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S10 — 06:50 - Curtis starts his day: Accept, Travel, Arrive

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

Curtis reads his phone in his driveway with the truck idling. Four jobs are dispatched to him. The technician half of the lifecycle - Accept, Travel, Arrive, WorkStart, Complete - is the only part of the state machine he can drive, and every one of those actions requires that the job is HIS.

<details><summary>10 activities — P3B1-S10-A01 · P3B1-S10-A02 · P3B1-S10-A03 · P3B1-S10-A04 · P3B1-S10-A05 · P3B1-S10-A06 · P3B1-S10-A07 · P3B1-S10-A08 · P3B1-S10-A09 · P3B1-S10-A10</summary>

#### P3B1-S10-A01 — Accept the first dispatched job of the day

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | WO-2026-000151 DISPATCHED, assignedTechId = Curtis's technicianId. |
| **Business purpose** | Acceptance is the technician saying 'I have seen this and I am doing it'. |
| **Preconditions** | — The WO is in DISPATCHED<br>— assignedTechId matches the caller's mapped technicianId |
| **Action** | Tap Accept. |
| **Expected EOS state transition** | DISPATCHED -> ACCEPTED, with a server-clock acceptedAt. |
| **Expected authority / capability** | Accept: roles ['technician'], requiresOwnAssignment TRUE. Both the role and the ownership must hold. |
| **Expected UI result** | The action buttons are rendered from a client-side mirror of the server's getAllowedActions, so the phone shows exactly the actions the server would permit. |
| **Expected audit result** | A transition event with acceptedAt from the server clock. |
| **Expected cross-object effect** | The technician's response time becomes measurable - dispatchedAt to acceptedAt. |
| **Exception / recovery** | No client writes fieldops_wos.status directly; every transition goes through the callable. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | None needed - Accept is self-explanatory. |
| **Reset / replay** | Fresh fixture; DISPATCHED has no reverse edge. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:138 (Accept: technician, requiresOwnAssignment true)`<br>`functions/src/transitionEngine.ts:92-99 (acceptedAt)`<br>`field-ops-app-vite/src/domain/workOrderWorkflow.js:80 (client mirror of getAllowedActions)`<br>`field-ops-app-vite/src/services/workOrderService.ts:65-72` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S10-A02 — Accept all four of today's jobs before leaving the driveway

*Curtis Nally (field_technician) · taylor · MOBILE · BULK, MOBILE, UNUSUAL_BUT_LEGITIMATE*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | Four Work Orders DISPATCHED to Curtis. |
| **Business purpose** | Technicians accept the whole day at once; the model assumes one at a time. |
| **Preconditions** | — All four are DISPATCHED to him |
| **Action** | Tap Accept on each. |
| **Expected EOS state transition** | Four DISPATCHED -> ACCEPTED transitions. |
| **Expected authority / capability** | Accept on each, each requiring own assignment. |
| **Expected UI result** | Four taps. There is no 'accept all'. |
| **Expected audit result** | Four acceptedAt timestamps, all within a minute - which makes acceptance latency a measure of when he looked at his phone, not of anything operational. |
| **Expected cross-object effect** | All four are now in occupying statuses, so the dispatcher cannot dispatch him anything else all day. |
| **Exception / recovery** | Accepting a job he will not reach until 15:00 is normal behaviour that the double-booking guard was not designed for. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/workOrderAvailability.ts:9-21 (ACCEPTED is an occupying status)`<br>`functions/src/transitionEngine.ts:138` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Accepting the whole day at once puts every job in an occupying status, so the double-booking guard blocks all further dispatch to that technician for the rest of the day. |

#### P3B1-S10-A03 — Tap Travel when pulling out of the driveway

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | WO in ACCEPTED. |
| **Business purpose** | En route is what dispatch and the customer both want to know. |
| **Preconditions** | — The WO is in ACCEPTED and is his |
| **Action** | Tap Travel. |
| **Expected EOS state transition** | ACCEPTED -> EN_ROUTE, with a server-clock enRouteAt. |
| **Expected authority / capability** | Travel: technician, requiresOwnAssignment true. |
| **Expected UI result** | The job card moves to an en-route presentation. |
| **Expected audit result** | enRouteAt recorded. |
| **Expected cross-object effect** | Drive time becomes measurable as enRouteAt to arrivedAt. |
| **Exception / recovery** | No location is captured - EN_ROUTE is a claim, not a position. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:139`<br>`functions/src/transitionEngine.ts:92-99 (enRouteAt)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S10-A04 — Tap Travel on the second job while still en route to the first

*Curtis Nally (field_technician) · taylor · MOBILE · MISTAKE, EXCEPTION, MOBILE*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | WO-A is EN_ROUTE; WO-B is ACCEPTED. |
| **Business purpose** | A technician can only drive to one place at a time. |
| **Preconditions** | — Both jobs are his<br>— One is already EN_ROUTE |
| **Action** | Tap Travel on WO-B. |
| **Expected EOS state transition** | ACCEPTED -> EN_ROUTE. Succeeds. Nothing prevents a technician being en route to two places simultaneously. |
| **Expected authority / capability** | Travel, own assignment - both hold. |
| **Expected UI result** | Two jobs render as en route. |
| **Expected audit result** | Two enRouteAt timestamps that cannot both be true. |
| **Expected cross-object effect** | Drive-time analytics are now wrong for at least one of them. The double-booking guard runs at Dispatch, not at the technician's own transitions, so it does not fire here. |
| **Exception / recovery** | No recovery - EN_ROUTE has no reverse edge; the only exits are ARRIVED and CANCELLED. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'You are already en route to another job' is the missing guard. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:45 (EN_ROUTE: ARRIVED, CANCELLED)`<br>`functions/src/workOrderAvailability.ts:23-42 (the guard is a Dispatch-time check)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A technician can be EN_ROUTE and WORK_IN_PROGRESS on several Work Orders at once. The double-booking guard only runs at Dispatch; the technician's own transitions have no mutual-exclusion check, and none of these states has a reverse edge to correct a mis-tap. |

#### P3B1-S10-A05 — Tap Arrive in the QuikMart parking lot

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | WO in EN_ROUTE. |
| **Business purpose** | Arrival starts the clock the customer is billed against. |
| **Preconditions** | — The WO is EN_ROUTE and his |
| **Action** | Tap Arrive. |
| **Expected EOS state transition** | EN_ROUTE -> ARRIVED, with a server-clock arrivedAt. |
| **Expected authority / capability** | Arrive: technician, requiresOwnAssignment true. |
| **Expected UI result** | The card becomes the on-site view. |
| **Expected audit result** | arrivedAt recorded from the server clock, not the device clock - a device with a wrong clock cannot shift a billable time. |
| **Expected cross-object effect** | On-site time is arrivedAt to completedAt. |
| **Exception / recovery** | No geofence: Arrive can be tapped from anywhere. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:140`<br>`functions/src/transitionEngine.ts:92-99 (arrivedAt)`<br>`functions/src/types/workOrder.ts:6-12` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S10-A06 — Tap Arrive by mistake while still on the freeway

*Curtis Nally (field_technician) · taylor · MOBILE · MISTAKE, MOBILE*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | WO in EN_ROUTE; Curtis fat-fingers Arrive at 07:20, twenty minutes out. |
| **Business purpose** | Mis-taps on a phone mounted in a truck are constant. |
| **Preconditions** | — The WO is EN_ROUTE |
| **Action** | Tap Arrive. |
| **Expected EOS state transition** | EN_ROUTE -> ARRIVED. There is no undo; ARRIVED's only exits are WORK_IN_PROGRESS and CANCELLED. |
| **Expected authority / capability** | Arrive. |
| **Expected UI result** | The card changes and cannot be changed back. |
| **Expected audit result** | arrivedAt is immutable by design - which is correct for integrity and unforgiving for mistakes. |
| **Expected cross-object effect** | Twenty minutes of drive time are billed as on-site time. Over a fleet and a month this is material. |
| **Exception / recovery** | The only recovery is a back-office correction outside the lifecycle, and there is no such correction path in the technician's app. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | A confirm-on-Arrive would cost one tap and prevent this. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:46 (ARRIVED: WORK_IN_PROGRESS, CANCELLED)`<br>`functions/src/transitionEngine.ts:82-88 (immutable execution timestamps)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Every technician execution timestamp is immutable and every technician transition is irreversible, so a single mis-tap permanently corrupts billable time with no in-product correction path. |

#### P3B1-S10-A07 — Attempt to Accept a job dispatched to a different technician

*Javier Ochoa (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, HANDOFF, MOBILE*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | WO-2026-000152 DISPATCHED to Curtis; Javier is covering and taps Accept on it. |
| **Business purpose** | requiresOwnAssignment is the whole basis of technician authority. |
| **Preconditions** | — The WO's assignedTechId is another technician |
| **Action** | Invoke Accept against the callable. |
| **Expected EOS state transition** | Refused. |
| **Expected authority / capability** | Accept requires the technician role AND own assignment; getAllowedActions filters on requiresOwnAssignment after the role check. Rules also deny Javier even READING the Work Order, since the read gate compares assignedTechId to his own technicianId. |
| **Expected UI result** | He cannot see the job at all, so the action is not reachable through the app. |
| **Expected audit result** | No state change. |
| **Expected cross-object effect** | Covering for a colleague requires a dispatcher to re-dispatch, which cannot happen from DISPATCHED - there is no reverse edge, and Dispatch's only legal source is SCHEDULED. |
| **Exception / recovery** | The real-world act of 'I'll grab that one for you' has no representation in the model at all. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Reassign assignedTechId in a fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:138,166-168`<br>`firestore.rules:507-508` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Reassigning a dispatched job to a different technician is impossible without cancelling it: Dispatch is legal only from SCHEDULED and DISPATCHED has no reverse edge. Informal cover, which is how field service actually works, is unrepresentable. |

#### P3B1-S10-A08 — Open the technician workspace on a desktop instead of a phone

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | Curtis is in the shop at a PC. |
| **Business purpose** | Technicians do paperwork at a desk at the start and end of the day. |
| **Preconditions** | — Curtis is signed in |
| **Action** | Open the technician workspace on a wide screen. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Same. The surface resolves by width: a phone-width viewport gets the tabbed technician shell, anything wider gets Field Mode. |
| **Expected UI result** | Two different technician experiences chosen by viewport width, not by user preference. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The technician dashboard is a third surface, reached as the role's landing page rather than through the service nav. |
| **Exception / recovery** | A technician on a tablet in a truck may get either, depending on orientation. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Resize the viewport. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/App.jsx:521-523,839-841 (phone -> TechnicianShell, else FieldMode)`<br>`field-ops-app-vite/src/App.jsx:223-232 (role technician -> TechnicianDashboard as the dashboard root)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Three technician surfaces (TechnicianShell, FieldMode, TechnicianDashboard) with different capabilities are selected by viewport width and route rather than by what the technician is trying to do. |

#### P3B1-S10-A09 — Check the jobs list after dispatch cancelled one of them

*Curtis Nally (field_technician) · taylor · MOBILE · HANDOFF, MOBILE, EXCEPTION*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | WO-C was CANCELLED by Dale at 07:05 while Curtis was driving. |
| **Business purpose** | A cancelled job must disappear from the technician's day promptly. |
| **Preconditions** | — The WO was cancelled after being dispatched |
| **Action** | Pull the jobs list. |
| **Expected EOS state transition** | None - the transition already happened server-side. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The job should leave the active list. Whether it is shown as cancelled or silently vanishes is UNPROVEN by this lane; silently vanishing is worse, because the technician wonders whether he imagined it. |
| **Expected audit result** | The cancellation event names Dale, not Curtis. |
| **Expected cross-object effect** | If Curtis had already tapped Arrive before the cancellation, both facts are now true and the Work Order is CANCELLED with an arrivedAt. |
| **Exception / recovery** | Terminal means terminal: there is no path back even if the customer changes their mind five minutes later. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Cancelled by Dale Brackett at 07:05 - reason: customer closed' is what the technician needs. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:50,53-57` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S10-A10 — Look for today's route in order

*Curtis Nally (field_technician) · taylor · MOBILE · MISSING_DATA, MOBILE*

**Account context.** QuikMart #418, 3900 W Indian School Rd Phoenix - Manitowoc IYT0500A ice machine

| | |
| --- | --- |
| **Starting records / state** | Four accepted jobs at four addresses across Phoenix. |
| **Business purpose** | Sequencing the day is the technician's first and most valuable decision. |
| **Preconditions** | — Four jobs assigned |
| **Action** | Look for a route or ordering on the jobs list. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether any route ordering or mapping exists in the technician surfaces. Technicians have no location data in their records and the recommendation engine's territory component is flat for that reason, so a route optimiser has nothing to work from. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The scheduled windows imply an order, but nothing enforces or displays one. |
| **Exception / recovery** | Curtis sequences by memory and local knowledge, which is usually better than anything the data supports. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed four jobs at spread addresses. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:128-142 (no technician location data exists)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S11 — 07:35 - arrival exceptions: the store is shut, the address is wrong, the machine is fine

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

Half of a technician's exceptions happen in the first ninety seconds on site. The lifecycle gives him five verbs - Accept, Travel, Arrive, WorkStart, Complete - and none of them means 'I got here and I cannot do this'.

<details><summary>10 activities — P3B1-S11-A01 · P3B1-S11-A02 · P3B1-S11-A03 · P3B1-S11-A04 · P3B1-S11-A05 · P3B1-S11-A06 · P3B1-S11-A07 · P3B1-S11-A08 · P3B1-S11-A09 · P3B1-S11-A10</summary>

#### P3B1-S11-A01 — Arrive and find the store does not open until 09:00

*Curtis Nally (field_technician) · taylor · MOBILE · EXCEPTION, MOBILE, MISSING_DATA*

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

| | |
| --- | --- |
| **Starting records / state** | WO ARRIVED at 07:35; the c-store's ice machine is behind a locked service door. |
| **Business purpose** | Wasted trips are the most expensive routine failure in field service. |
| **Preconditions** | — The WO is ARRIVED |
| **Action** | Look for an action that records 'arrived, cannot access'. |
| **Expected EOS state transition** | None available. ARRIVED goes only to WORK_IN_PROGRESS or CANCELLED. |
| **Expected authority / capability** | The technician holds Accept/Travel/Arrive/WorkStart/Complete. Cancel is admin/dispatcher, so he cannot even cancel the wasted trip himself. |
| **Expected UI result** | The only forward button is Work Start, which would be a lie. |
| **Expected audit result** | Whatever he does next is the record - and all his options are wrong. |
| **Expected cross-object effect** | He phones dispatch. The dispatcher cancels, losing the arrivedAt trip evidence, or leaves it open and it ages. |
| **Exception / recovery** | The honest recovery is a second visit, and there is no 'return visit required' state. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Fresh fixture in ARRIVED. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:46`<br>`functions/src/transitionEngine.ts:137-143` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | There is no technician verb for 'arrived and could not work'. Every no-access, customer-not-ready and wrong-address outcome must be miscoded as either work-in-progress or a dispatcher cancellation, and the wasted trip becomes invisible. |

#### P3B1-S11-A02 — Arrive at the address on the Work Order and find a different business

*Curtis Nally (field_technician) · taylor · MOBILE · BAD_DATA, MOBILE, EXCEPTION*

**Account context.** Rio Salado High School District - the WO names the district office, the machine is at a campus

| | |
| --- | --- |
| **Starting records / state** | WO ARRIVED at the wrong address, taken from the account's default location. |
| **Business purpose** | Multi-site accounts are the norm and the default location is usually the billing address. |
| **Preconditions** | — The WO's address is the account's default, not the service location |
| **Action** | Look for a way to correct the address or find the real site. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The technician has no write authority on Work Order identity fields. |
| **Expected UI result** | He cannot see the account's other locations - the equipment register and the locations list are on routes barred to technicians. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Equipment locationId resolves into the CRM locations collection, and the correct site is registered there - on a page he cannot open. |
| **Exception / recovery** | He phones the office, which reads him the address. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a WO with the billing address. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/App.jsx:1044-1052 (technicians excluded from the WO routes)`<br>`firestore.rules:1341,1439-1442` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A technician cannot see the other service locations on an account, so the most common address error can only be resolved by a phone call to the office. |

#### P3B1-S11-A03 — Arrive and find the machine working normally

*Curtis Nally (field_technician) · taylor · MOBILE · UNUSUAL_BUT_LEGITIMATE, NORMAL, MOBILE*

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

| | |
| --- | --- |
| **Starting records / state** | The QuikMart ice machine is producing ice; the complaint was a Friday-night fault nobody can reproduce. |
| **Business purpose** | No-fault-found is a real and frequent outcome that needs a truthful record. |
| **Preconditions** | — The WO is ARRIVED |
| **Action** | Start work, inspect, find nothing, and complete. |
| **Expected EOS state transition** | ARRIVED -> WORK_IN_PROGRESS -> COMPLETED. The lifecycle carries no outcome dimension at all - completion records that work stopped, not what happened. |
| **Expected authority / capability** | WorkStart and Complete: technician, own assignment. |
| **Expected UI result** | He records what he found in a work note, which is free text. |
| **Expected audit result** | completedAt is recorded. The outcome is not. |
| **Expected cross-object effect** | First-time-fix rate cannot be computed, because 'fixed' is not a recorded fact. The technician performance scorecard shows first-time-fix as visibly empty for exactly this reason - which is honest, and is the right way to show an unmeasurable metric. |
| **Exception / recovery** | None. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | Structured outcome codes would beat a free-text note for both the customer conversation and the metric. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:141-142`<br>`field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx (first-time-fix shown as visibly empty/unmeasurable)`<br>`field-ops-app-vite/src/modules/workOrders/WorkOrderDetailPage.jsx:268 ('First-visit fix - not computed')` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Work Order completion records no outcome, so no-fault-found, fixed, and deferred are indistinguishable, and first-time-fix rate is structurally unmeasurable. |

#### P3B1-S11-A04 — Arrive and find the customer refuses the visit because of an unpaid invoice

*Curtis Nally (field_technician) · taylor · MOBILE · EXCEPTION, CROSS_COMPANY, MOBILE*

**Account context.** Sonoran Scoops Creamery - Chandler

| | |
| --- | --- |
| **Starting records / state** | The store manager turns him away at the door. |
| **Business purpose** | Credit holds collide with service reality at the customer's door, not in the office. |
| **Preconditions** | — The WO is ARRIVED |
| **Action** | Look for anything on the Work Order about the account's credit status. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. The technician sees the Work Order, not the account's financial state. |
| **Expected UI result** | Nothing on the technician's surfaces carries account financial context, which is arguably correct - but it means the office knew and he did not. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The Work Order carries no company attribution either, so even 'which company's credit hold?' is unanswerable from the record. |
| **Exception / recovery** | Same dead end as the locked door: no verb for 'could not work'. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Do not dispatch to this account' is a dispatcher-side fact with no dispatcher-side surface. |
| **Reset / replay** | Seed an account on credit hold. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear · operating-company attribution unclear |
| **Evidence** | `functions/src/types/workOrder.ts (no operatingCompanyId)`<br>`functions/src/transitionEngine.ts:46` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No credit-hold signal reaches dispatch or the technician, so a truck is sent to a door that will be closed to it. |

#### P3B1-S11-A05 — Take the call from a technician standing at a locked door

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, RECOVERY, HANDOFF, DESKTOP*

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

| | |
| --- | --- |
| **Starting records / state** | WO in ARRIVED at 07:35; Curtis is on the phone. |
| **Business purpose** | The dispatcher's options are the technician's options, one level up. |
| **Preconditions** | — The WO is ARRIVED |
| **Action** | Decide what to do with the Work Order. |
| **Expected EOS state transition** | Cancel (terminal) or leave it in ARRIVED. |
| **Expected authority / capability** | Cancel: admin/dispatcher. There is no 'return to scheduled' from ARRIVED - the commitment boundary means everything after DISPATCHED is one-way. |
| **Expected UI result** | He chooses between destroying the record of the trip and leaving a job open that nobody is working. |
| **Expected audit result** | Either choice is a lie about what happened. |
| **Expected cross-object effect** | If he cancels and creates a new Work Order for the second visit, the customer gets two WO numbers for one fault, and the trip cost attaches to the cancelled one. |
| **Exception / recovery** | This is the structural gap: the lifecycle models a visit that succeeds. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:39-51`<br>`functions/src/transitionEngine.ts:137` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The Work Order lifecycle has no representation of a failed visit, so every no-access outcome is recorded as either a cancellation or an abandoned open job. |

#### P3B1-S11-A06 — Tap Work Start because it is the only button, then discover he genuinely cannot work

*Curtis Nally (field_technician) · taylor · MOBILE · MISTAKE, EXCEPTION, MOBILE*

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

| | |
| --- | --- |
| **Starting records / state** | WO ARRIVED; the service panel key is with a manager who is 40 minutes away. |
| **Business purpose** | Users take the available action when the correct action does not exist. |
| **Preconditions** | — The WO is ARRIVED |
| **Action** | Tap Work Start. |
| **Expected EOS state transition** | ARRIVED -> WORK_IN_PROGRESS with a workStartedAt he did not earn. |
| **Expected authority / capability** | WorkStart: technician, own assignment. |
| **Expected UI result** | The job now shows as in progress on the dispatcher's board, which is false. |
| **Expected audit result** | workStartedAt is immutable. |
| **Expected cross-object effect** | Labour time computed from workStartedAt is wrong by 40 minutes. WORK_IN_PROGRESS goes only to COMPLETED or CANCELLED. |
| **Exception / recovery** | He now must either complete a job he did not do or have it cancelled with a work-started timestamp on it. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:47,141`<br>`functions/src/transitionEngine.ts:92-99 (workStartedAt)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The absence of a 'cannot work' verb actively produces false workStartedAt timestamps, because Work Start is the only forward action offered. |

#### P3B1-S11-A07 — Arrive at an ice plant and find the equipment on the Work Order is the wrong unit

*Tonya Reese (field_technician) · ventana · MOBILE · BAD_DATA, MOBILE, EXCEPTION*

**Account context.** Desert Ice & Cold Storage - Vogt P24AL #2 named, #3 is the faulty one

| | |
| --- | --- |
| **Starting records / state** | WO ARRIVED, equipment reference points at the wrong tube-ice machine. |
| **Business purpose** | Ice plants have banks of near-identical machines and the register is rarely precise. |
| **Preconditions** | — The WO names the wrong equipment |
| **Action** | Look for a way to correct the equipment reference from the field. |
| **Expected EOS state transition** | None available to a technician. |
| **Expected authority / capability** | Equipment linkage is a Work Order field, and the Work Order routes are gated on workOrder.create, excluding technicians. |
| **Expected UI result** | The scan workspace can resolve the correct unit's identity, but resolving it does not attach it. |
| **Expected audit result** | The Work Order will close naming the wrong machine, so that machine's service history is wrong forever. |
| **Expected cross-object effect** | Equipment history is what drives replacement conversations; corrupting it has a sales consequence years later. |
| **Exception / recovery** | He works the right machine and the record says otherwise. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Seed a WO pointing at the wrong serial. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/App.jsx:1044-1052`<br>`field-ops-app-vite/src/modules/mobile/PartsScanner.jsx (resolves identity, does not re-link the WO)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A technician who discovers the Work Order names the wrong machine cannot correct it, so equipment service history is silently corrupted by every such visit. |

#### P3B1-S11-A08 — Arrive at a site with no mobile signal at all

*Curtis Nally (field_technician) · taylor · MOBILE · NETWORK_INTERRUPTION, MOBILE*

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

| | |
| --- | --- |
| **Starting records / state** | A walk-in freezer room at the back of the store; the phone has no bars. |
| **Business purpose** | Concrete and refrigeration are what field service happens inside. |
| **Preconditions** | — No connectivity |
| **Action** | Tap Arrive. |
| **Expected EOS state transition** | The intent is queued locally rather than transmitted. The transition happens when it syncs. |
| **Expected authority / capability** | Unchanged - authority is evaluated server-side when the intent is finally sent. |
| **Expected UI result** | A sync indicator and a queue card showing the pending intent, rather than a false success. |
| **Expected audit result** | arrivedAt will be the server clock at SYNC time, not at arrival time - so an intent queued for two hours records an arrival two hours late. |
| **Expected cross-object effect** | navigator.onLine is used as a hint only, never as authority. |
| **Exception / recovery** | Optimistic local state is deliberately avoided - there is no second source of truth for quantities. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'This will be recorded when you get signal' is the required message, and the sync queue provides it. |
| **Reset / replay** | Disable the network in the browser. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/offline/submitOrQueue.js`<br>`field-ops-app-vite/src/offline/syncExecutor.js (connectivityHint)`<br>`field-ops-app-vite/src/modules/mobile/SyncQueue.jsx`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx (no local optimistic state)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Execution timestamps are server-clock at sync time, so a transition queued offline records the wrong moment. The integrity guarantee (server clock, not device clock) and the offline queue pull in opposite directions. |

#### P3B1-S11-A09 — Open the Work Order in the parking lot with no signal to read what the problem is

*Curtis Nally (field_technician) · taylor · MOBILE · NETWORK_INTERRUPTION, MOBILE, MISSING_DATA*

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

| | |
| --- | --- |
| **Starting records / state** | Offline; the jobs list was last loaded at 06:50. |
| **Business purpose** | Reading the job is the first thing he does on arrival. |
| **Preconditions** | — No connectivity<br>— The data was loaded earlier in the session |
| **Action** | Open the job detail. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Whatever the live listener's local cache still holds. There is no service worker and no PWA registration anywhere in the app, so there is no offline asset caching and no offline read story beyond the Firestore client's own cache. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The offline runtime covers technician WRITE intents only; it does not cache Work Order reads. |
| **Exception / recovery** | A cold start with no signal gives him nothing - he cannot even load the app. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Cold-start the app offline. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/offline/localIntentStore.js`<br>`field-ops-app-vite/src/offline/intentQueue.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | There is no service worker or offline asset caching, so a technician who closes the app in a dead zone cannot reopen it. Offline support covers writes only. |

#### P3B1-S11-A10 — Arrive at the second job of the day while the first is still WORK_IN_PROGRESS

*Curtis Nally (field_technician) · taylor · MOBILE · EXCEPTION, UNUSUAL_BUT_LEGITIMATE, MOBILE*

**Account context.** QuikMart #418, Rio Salado High School District, Sonoran Scoops Chandler

| | |
| --- | --- |
| **Starting records / state** | WO-A WORK_IN_PROGRESS since 08:10; Curtis got called away and is now at WO-B. |
| **Business purpose** | Interruption mid-job is routine in emergency service. |
| **Preconditions** | — WO-A is WORK_IN_PROGRESS<br>— WO-B is EN_ROUTE |
| **Action** | Tap Arrive on WO-B. |
| **Expected EOS state transition** | EN_ROUTE -> ARRIVED. Succeeds; there is no check against the other job. |
| **Expected authority / capability** | Arrive, own assignment. |
| **Expected UI result** | Two jobs show as active. |
| **Expected audit result** | Both timelines are running. |
| **Expected cross-object effect** | WORK_IN_PROGRESS has no pause. Labour time on WO-A continues accruing while he works WO-B. |
| **Exception / recovery** | To stop the clock on WO-A he must complete it, which he cannot honestly do. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:47`<br>`functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | There is no way to suspend a Work Order. An interrupted job either stays WORK_IN_PROGRESS accruing time or must be dishonestly completed. |

</details>

### P3B1-S12 — 08:10 - the work itself: diagnosis, notes, and what a technician can record

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

Curtis pulls the panel, finds a filthy condenser and a failing water inlet valve. What he can tell EOS about that is the difference between a service history and a pile of free text.

<details><summary>10 activities — P3B1-S12-A01 · P3B1-S12-A02 · P3B1-S12-A03 · P3B1-S12-A04 · P3B1-S12-A05 · P3B1-S12-A06 · P3B1-S12-A07 · P3B1-S12-A08 · P3B1-S12-A09 · P3B1-S12-A10</summary>

#### P3B1-S12-A01 — Start work on the ice machine

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | WO ARRIVED at 07:35; it is 08:10 and the manager has opened the service door. |
| **Business purpose** | Work Start is the boundary between travel/waiting and billable labour. |
| **Preconditions** | — The WO is ARRIVED and his |
| **Action** | Tap Work Start. |
| **Expected EOS state transition** | ARRIVED -> WORK_IN_PROGRESS with a server-clock workStartedAt. |
| **Expected authority / capability** | WorkStart: technician, requiresOwnAssignment true. |
| **Expected UI result** | The execution capture surfaces become available. |
| **Expected audit result** | workStartedAt recorded. |
| **Expected cross-object effect** | The 35 minutes between arrivedAt and workStartedAt are recorded and are exactly the wasted-time signal a service manager wants - if anything reads it. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:141`<br>`functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S12-A02 — Write a work note describing the condenser condition

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | WO in WORK_IN_PROGRESS. |
| **Business purpose** | The note is the whole diagnostic record. |
| **Preconditions** | — The WO is WORK_IN_PROGRESS and his |
| **Action** | Open the note screen and type the finding. |
| **Expected EOS state transition** | No lifecycle transition. The note is saved as execution data. |
| **Expected authority / capability** | Execution data update on his own assigned Work Order. |
| **Expected UI result** | A textarea. Dictation is offered and never auto-saves - the technician always confirms before the note is written. |
| **Expected audit result** | The note is attributable to him and timestamped. |
| **Expected cross-object effect** | The note is the only place equipment condition is recorded; nothing structured captures 'condenser fouled'. |
| **Exception / recovery** | If the write fails it queues as an offline intent rather than being lost. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | None needed. |
| **Reset / replay** | Clear execution data on the fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/JobNote.jsx (executionNote; dictation never auto-saves)`<br>`field-ops-app-vite/src/services/workOrderService.ts (updateWorkOrderExecutionData)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S12-A03 — Dictate a long note in a plant room with compressor noise

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, UNUSUAL_BUT_LEGITIMATE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS; ambient noise is severe. |
| **Business purpose** | Hands are dirty and typing on a phone in a freezer is not happening. |
| **Preconditions** | — Dictation is available on the device |
| **Action** | Dictate, review the transcription, correct it, save. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Same. |
| **Expected UI result** | The review step is mandatory by design - dictation never auto-saves, which is the right call in a noisy environment where transcription will be wrong. |
| **Expected audit result** | The saved text is what he approved, not what was heard. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | A bad transcription he does not catch becomes the permanent service record. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/JobNote.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S12-A04 — Record labour time for the job

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, MISSING_DATA, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS; two hours on site. |
| **Business purpose** | Labour is most of the invoice. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Open the time-entry screen. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | CURRENT: the labour capability is fail-closed (active:false), so the screen renders DISABLED with an explanation rather than hidden or broken. |
| **Expected UI result** | A disabled screen that says why - which is the honest-state convention working correctly. |
| **Expected audit result** | Nothing written. |
| **Expected cross-object effect** | Labour time is therefore captured outside EOS, on paper or in payroll, and the Work Order carries none. |
| **Exception / recovery** | The technician's on-site duration is inferable from workStartedAt to completedAt, which is not the same as billable labour. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The disabled screen with an explanation IS the help, and it is the right pattern. |
| **Reset / replay** | n/a - the capability is off. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/JobLabor.jsx (capability active:false, renders disabled with an explanation)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`MANUAL_CONFIGURATION`) — The labour capability is inactive by configuration; the screen cannot be exercised beyond its disabled state without an environment change.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Labour capture is fail-closed and unavailable, so no Work Order carries billable labour time. |

#### P3B1-S12-A05 — Look up the service history of this ice machine while standing in front of it

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, MISSING_DATA, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS; he suspects the same valve was replaced last year. |
| **Business purpose** | Repeat failures change the diagnosis. |
| **Preconditions** | — Prior Work Orders exist against the equipment |
| **Action** | Look for the equipment's history from the technician surfaces. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The equipment timeline lives on the equipment detail page. Technicians are excluded from the Work Order routes and the equipment register is not in their legacy nav allow-list (fieldMode, jobs, technicianDashboard). |
| **Expected UI result** | No history available to him. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Firestore Rules also deny technicians a general equipment read, deliberately: satisfying a self-scoped equipment read would require querying Work Orders for an assignment naming that equipment, which Rules cannot express - they can only get()/exists() a known path, and the Work Order id is not derivable from the equipment id. |
| **Exception / recovery** | He phones the office or works without the history. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - a genuine architectural constraint that is documented in the Rules themselves. |
| **Reset / replay** | Seed prior WOs against the equipment. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear |
| **Evidence** | `firestore.rules:1362-1370 (why a self-scoped technician equipment read cannot be expressed in Rules)`<br>`field-ops-app-vite/src/domain/constants.js:374-378` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Technicians have no access to equipment service history by design, because Rules cannot express the self-scoped read. The architectural constraint is real and documented; the operational cost lands entirely on the technician. |

#### P3B1-S12-A06 — Record that the water filter was last changed at an unknown date

*Curtis Nally (field_technician) · taylor · MOBILE · MISSING_DATA, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS; the filter has no date sticker. |
| **Business purpose** | Missing maintenance history is the normal case, not the exception. |
| **Preconditions** | — No prior record exists |
| **Action** | Record the unknown in the work note. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Execution note. |
| **Expected UI result** | Free text is the only home for it. |
| **Expected audit result** | Attributable and timestamped. |
| **Expected cross-object effect** | Nothing structured captures maintenance intervals, so the next technician reads prose. |
| **Exception / recovery** | None. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/JobNote.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S12-A07 — Take a photo of the fouled condenser for the customer's file

*Curtis Nally (field_technician) · taylor · MOBILE · MISSING_DATA, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS. |
| **Business purpose** | A photo is what sells a preventive-maintenance contract. |
| **Preconditions** | — The device has a camera |
| **Action** | Look for photo attachment on the Work Order. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | UNPROVEN whether technician photo attachment exists on the Work Order execution surfaces. The scan workspace uses the camera for identity resolution, which is a different thing. If attachment does not exist, this is MISSING_CAPABILITY. |
| **Expected UI result** | n/a. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | Attachment custody exists on the inbound-work side for email attachments, which is a different domain. |
| **Exception / recovery** | He texts the photo to the coordinator, and it lives in a phone. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/PartsScanner.jsx (camera used for scan resolution)`<br>`functions/src/inboundWork/attachmentCustody.ts (attachment custody exists, inbound only)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S12-A08 — Check what parts the office planned for this job

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | The Work Order has a parts plan created by the dispatcher. |
| **Business purpose** | The plan tells him what was expected; the truck tells him what he has. |
| **Preconditions** | — A parts plan exists on the WO |
| **Action** | Open the execution capture screen and read the planned parts. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read on his own assigned WO. |
| **Expected UI result** | Planned parts are listed with +/- counters against each. Planning parts is explicitly NOT reserving and NOT using them - three distinct acts the product keeps separate. |
| **Expected audit result** | None for reading. |
| **Expected cross-object effect** | The parts plan editor is a dispatcher/admin-side planning surface; the technician sees only the resulting list. |
| **Exception / recovery** | A part he needs that was not planned has no counter to increment - only planned lines are listed. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Planned is not reserved' is worth saying somewhere. |
| **Reset / replay** | Seed a parts plan. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrderPartsPlanEditor.jsx (PLAN != RESERVE != USE)`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:153-205` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Execution capture lists planned parts only; a part the technician actually used that nobody planned has no obvious route into the record. |

#### P3B1-S12-A09 — Discover the real fault needs a part nobody planned

*Curtis Nally (field_technician) · taylor · MOBILE · MISSING_DATA, MOBILE, EXCEPTION*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | The water inlet valve is failing; the plan lists only a condenser cleaning kit. |
| **Business purpose** | The diagnosis is what happens on site; the plan is a guess made in the office. |
| **Preconditions** | — The needed part is not on the plan |
| **Action** | Look for a way to add an unplanned part to the job. |
| **Expected EOS state transition** | None to the lifecycle. |
| **Expected authority / capability** | UNPROVEN whether the technician can add an unplanned part line from the execution surfaces. The scan flow records quantity used against a scanned identity, which may be the path. |
| **Expected UI result** | If the only counters are against planned lines, the unplanned part is recorded in prose or not at all. |
| **Expected audit result** | An unrecorded part is inventory shrinkage with a plausible cause and no evidence. |
| **Expected cross-object effect** | This is the single most common inventory-accuracy failure in field service. |
| **Exception / recovery** | He writes it in the note and tells the parts counter later. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a plan missing the needed part. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:153-205`<br>`field-ops-app-vite/src/modules/mobile/PartsScanner.jsx:223,240` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S12-A10 — Read the diagnostic notes across a month of ice-machine calls

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: low ice production, suspected condenser

| | |
| --- | --- |
| **Starting records / state** | 60 completed Work Orders with free-text notes. |
| **Business purpose** | Patterns across a fleet are how a service manager spots a bad model year. |
| **Preconditions** | — Completed WOs with notes exist |
| **Action** | Look for any structured fault coding or note search. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Notes are free text with no fault taxonomy. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Because completion records no outcome and no fault code, the only analysable fields are timestamps and parts. |
| **Exception / recovery** | She reads sixty notes, or she does not. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed 60 completed WOs with notes. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/JobNote.jsx`<br>`functions/src/transitionEngine.ts:68-80 (no outcome dimension in the action vocabulary)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No fault taxonomy and no completion outcome means a month of service data is unanalysable prose. |

</details>

### P3B1-S13 — 09:20 - parts off the truck: where did this actually come from?

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

Curtis fits a water inlet valve from the shelf behind his cab and a cleaning kit he picked up at the main warehouse yesterday. EOS must know which physical place each came from, because a part consumed from the wrong location moves the wrong on-hand balance and the error surfaces at a cycle count weeks later.

<details><summary>10 activities — P3B1-S13-A01 · P3B1-S13-A02 · P3B1-S13-A03 · P3B1-S13-A04 · P3B1-S13-A05 · P3B1-S13-A06 · P3B1-S13-A07 · P3B1-S13-A08 · P3B1-S13-A09 · P3B1-S13-A10</summary>

#### P3B1-S13-A01 — Increment a planned part and be asked where it came from

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS with a parts plan; the condenser kit is planned qty 1. |
| **Business purpose** | Consumption without a source is an inventory guess. |
| **Preconditions** | — The WO is his and in progress<br>— The part is on the plan |
| **Action** | Tap + on the condenser kit. |
| **Expected EOS state transition** | No lifecycle transition. A positive delta triggers a source lookup before anything is recorded. |
| **Expected authority / capability** | The server returns the technician's permitted sources: active warehouses plus their own governed truck. |
| **Expected UI result** | A select grouped into 'Warehouses' and 'My truck', pre-selecting the server's suggested source but letting him override it. |
| **Expected audit result** | Nothing yet - the source choice is part of the submission, not a separate event. |
| **Expected cross-object effect** | The truck option is authorised to APPEAR; it never infers that the part came from there. The technician still selects. |
| **Exception / recovery** | A positive delta with no resolved source is refused client-side first: 'Select where this part came from before recording usage.' |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The inline sentence 'Picked from more than one place - choose the one you used' is the app's explainer convention doing its job. |
| **Reset / replay** | Clear execution data and placements. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:77-104,153-205`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:59-70` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S13-A02 — Record the valve as coming from the truck

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | The truck resolves correctly and appears under 'My truck'. |
| **Business purpose** | This is the common case and the one the inventory ledger depends on. |
| **Preconditions** | — The truck resolves to exactly one ACTIVE record with a locationId |
| **Action** | Select the truck and submit the +1. |
| **Expected EOS state transition** | A consumption record is written against the truck's inventory location. |
| **Expected authority / capability** | Execution data update on his own WO, carrying consumptionSources as sku plus locationId. |
| **Expected UI result** | The counter increments once the write returns; there is no optimistic local state, so the displayed quantity is always the server's. |
| **Expected audit result** | The consumption is attributable to him, the Work Order, and the location. |
| **Expected cross-object effect** | Truck on-hand decreases. The main warehouse is untouched. |
| **Exception / recovery** | A decrement needs no source - it reverses against the original lineage. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Reverse the consumption and restore truck stock. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:178-197`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:68-70` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S13-A03 — Record a part on the phone scan flow instead of the dashboard

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, BAD_DATA, MISSING_DATA*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | He is on the phone shell, not the tablet dashboard. |
| **Business purpose** | Which surface a technician happens to be on should not change what the inventory ledger learns. |
| **Preconditions** | — The scan flow is reachable |
| **Action** | Scan the part and record quantity used. |
| **Expected EOS state transition** | Quantity used is recorded via the same execution-data update. |
| **Expected authority / capability** | Same. |
| **Expected UI result** | The scan flow records qty used but passes NO consumptionSources - there is no warehouse/truck picker in this path at all. |
| **Expected audit result** | A consumption with no source choice. |
| **Expected cross-object effect** | The same physical act recorded on two surfaces produces two different quality of record. Which location the scan path attributes the consumption to, if any, is UNPROVEN by this lane, and that uncertainty is itself the finding. |
| **Exception / recovery** | None offered - the technician is not told the source is missing. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Record the same part on both surfaces and compare the resulting rows. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/PartsScanner.jsx:223,240 (no consumptionSources passed)`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:194-197 (consumptionSources passed)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The phone scan path records parts usage without a source location while the tablet path requires one. The same part, the same job, two different inventory outcomes depending on which screen the technician used. |

#### P3B1-S13-A04 — Record a part from a warehouse he was never at

*Curtis Nally (field_technician) · taylor · MOBILE · BAD_DATA, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | His truck did not resolve; only warehouses are offered. |
| **Business purpose** | When the right answer is absent, users pick the nearest wrong one. |
| **Preconditions** | — The truck resolution returned nothing |
| **Action** | Select the main warehouse and submit. |
| **Expected EOS state transition** | A consumption row is written against the warehouse. |
| **Expected authority / capability** | Authorised - every active warehouse is a permitted source. |
| **Expected UI result** | Nothing questions it. |
| **Expected audit result** | A clean, attributable, entirely incorrect record. |
| **Expected cross-object effect** | Warehouse on-hand drops for stock that never left the truck. The truck's on-hand stays high. Both counts are now wrong, in opposite directions, and neither will be noticed until a cycle count. |
| **Exception / recovery** | No recovery because no error was raised. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Your truck could not be identified' would prevent this entirely. |
| **Reset / replay** | Break the truck join, record a consumption, inspect both balances. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear · ownership unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:59-90`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:77-104` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A silent truck-resolution failure converts directly into a double inventory error: the warehouse is debited for stock it still holds and the truck is credited with stock it no longer has. |

#### P3B1-S13-A05 — Record usage of a part that was picked for this Work Order at the warehouse

*Curtis Nally (field_technician) · taylor · MOBILE · NORMAL, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | Nate picked a condenser kit against this Work Order yesterday; a bin placement exists marked for it. |
| **Business purpose** | Picked-for-this-job stock is the strongest evidence of where a part came from. |
| **Preconditions** | — A bin placement exists with pickedForWorkOrderId equal to this Work Order |
| **Action** | Increment the part. |
| **Expected EOS state transition** | The server's suggested source reflects the placement picked for this Work Order. |
| **Expected authority / capability** | Same. |
| **Expected UI result** | The suggested source should be the placement's warehouse, which it is. |
| **Expected audit result** | A consumption traceable back through the pick. |
| **Expected cross-object effect** | Placements picked for a Work Order are read by single-field equality, so this needs no composite index. |
| **Exception / recovery** | If stock was picked at more than one place, the inline 'Picked from more than one place - choose the one you used' sentence appears. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The inline sentence is the help. |
| **Reset / replay** | Seed a bin placement marked for the WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:94-110`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:107` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S13-A06 — Decrement a part he recorded by mistake

*Curtis Nally (field_technician) · taylor · MOBILE · MISTAKE, RECOVERY, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | He recorded 2 valves and used 1. |
| **Business purpose** | Correcting a counter is the most common field correction there is. |
| **Preconditions** | — A positive consumption exists |
| **Action** | Tap - once. |
| **Expected EOS state transition** | The quantity reduces. |
| **Expected authority / capability** | Same execution-data update. A decrement needs no source because it reverses against the original lineage. |
| **Expected UI result** | The counter drops after the write returns. |
| **Expected audit result** | Both the original and the correction are recorded - the history shows what actually happened, not a tidied result. |
| **Expected cross-object effect** | Inventory is credited back to the original source. |
| **Exception / recovery** | Decrementing below zero must be refused; whether it is, is UNPROVEN by this lane. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Reset execution data. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:153-205` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S13-A07 — Record ten parts across four jobs in one afternoon

*Curtis Nally (field_technician) · taylor · MOBILE · BULK, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | Four active Work Orders, ten distinct part lines. |
| **Business purpose** | A busy afternoon is a batch of small writes, each with its own source decision. |
| **Preconditions** | — Four WOs in progress |
| **Action** | Record each part on each job. |
| **Expected EOS state transition** | Ten independent execution-data updates. |
| **Expected authority / capability** | Each requires own assignment on its own Work Order. |
| **Expected UI result** | Ten source selections. The picker pre-selects a suggestion each time, which is what makes it survivable. |
| **Expected audit result** | Ten consumption records. |
| **Expected cross-object effect** | Ten inventory movements. |
| **Exception / recovery** | One failure among ten leaves nine recorded, and the sync queue is how he finds out which. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Reset all four fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:153-205`<br>`field-ops-app-vite/src/modules/mobile/SyncQueue.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S13-A08 — Reconcile the truck's stock against what the Work Orders say was used

*Nate Purcell (parts_counter) · taylor · DESKTOP · END_OF_MONTH, BAD_DATA, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | A week of Work Orders and a truck count. |
| **Business purpose** | The truck is a stock location that nobody counts until it is wrong. |
| **Preconditions** | — Consumption records exist against the truck's location |
| **Action** | Compare recorded consumption to the physical count. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read, plus whatever the cycle-count surface requires. |
| **Expected UI result** | The mobile-location identity is the truck registry's locationId; the cycle-count surfaces resolve a technician's truck through the same driver authority. |
| **Expected audit result** | None for reading. |
| **Expected cross-object effect** | Every silent join failure and every scan-path consumption with no source shows up here as a variance with no traceable cause. |
| **Exception / recovery** | The variance is real; the explanation is not recoverable from the data. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a week of consumption plus a count. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/cycleCount/cycleCountSheetCallables.ts:181 (same driver authority)`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:59-78` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Truck stock variances caused by the technician-to-truck join failure or by the sourceless scan path arrive at cycle count with no way to attribute them. |

#### P3B1-S13-A09 — Try to record a part consumed at a customer site with no warehouse and no truck

*Curtis Nally (field_technician) · taylor · MOBILE · UNUSUAL_BUT_LEGITIMATE, MISSING_DATA, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | He borrowed a fitting from the customer's own spares. |
| **Business purpose** | It happens, and it must not be recorded as company stock. |
| **Preconditions** | — Neither a truck nor an appropriate warehouse applies |
| **Action** | Look for a way to record a customer-supplied part. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The permitted sources are active warehouses and the technician's own truck. A customer-supplied part has no category. |
| **Expected UI result** | He must either pick a company location, which is false, or not record it, which loses the fact that a part was fitted. |
| **Expected audit result** | Whichever he chooses is wrong. |
| **Expected cross-object effect** | Recording it against a company location debits stock the company still holds. |
| **Exception / recovery** | Not recording it means the equipment history omits a fitted part. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:45-56,59-90` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No source category for customer-supplied or borrowed parts, so recording one necessarily falsifies company inventory. |

#### P3B1-S13-A10 — Record parts while completely offline in a freezer room

*Curtis Nally (field_technician) · taylor · MOBILE · NETWORK_INTERRUPTION, MOBILE, MISSING_DATA*

**Account context.** QuikMart #418 - Manitowoc IYT0500A: water inlet valve and condenser kit

| | |
| --- | --- |
| **Starting records / state** | No connectivity; two parts to record. |
| **Business purpose** | Source selection requires a server round trip, and there is no signal. |
| **Preconditions** | — No connectivity |
| **Action** | Increment a part. |
| **Expected EOS state transition** | The source lookup is a callable. Whether the picker can populate offline is the question; if it cannot, the technician cannot choose a source and the client-side refusal blocks the record entirely. |
| **Expected authority / capability** | Unchanged. |
| **Expected UI result** | If the source list cannot load, the honest result is that the part cannot be recorded here. The client refuses a positive delta without a resolved source. |
| **Expected audit result** | Nothing written. |
| **Expected cross-object effect** | The offline runtime queues write INTENTS; it does not serve reads, and the source list is a read. |
| **Exception / recovery** | He records it in the note instead, and the inventory movement never happens. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'You need signal to choose a source' would at least be honest. |
| **Reset / replay** | Disable the network and attempt a positive delta. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:184-189 (client-side refusal without a source)`<br>`field-ops-app-vite/src/services/workOrderService.ts:202-209 (listWorkOrderConsumptionSources is a callable)`<br>`field-ops-app-vite/src/offline/localIntentStore.js (writes only)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Parts usage requires a server read to resolve sources, and the offline runtime queues writes only, so parts consumed in a dead zone may be unrecordable at the moment they are used. |

</details>

### P3B1-S14 — 11:15 - a serialized compressor, and the row that counted twice

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

Javier replaces a compressor. A compressor is a SERIALIZED part - the company tracks the individual unit, not a quantity. Before Wave 1, the Work Order consumption write path hardcoded trackingMode = 'NONE' for everything it posted, and the read path took trackingMode off the callable REQUEST rather than from the part authority. This story exists to prove the fix holds and to catch its regression.

<details><summary>10 activities — P3B1-S14-A01 · P3B1-S14-A02 · P3B1-S14-A03 · P3B1-S14-A04 · P3B1-S14-A05 · P3B1-S14-A06 · P3B1-S14-A07 · P3B1-S14-A08 · P3B1-S14-A09 · P3B1-S14-A10</summary>

#### P3B1-S14-A01 — Increment a SERIALIZED part on the execution capture screen

*Javier Ochoa (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS; the planned part is a compressor whose part-master controlType makes it SERIAL-tracked. |
| **Business purpose** | A serialized unit's identity is the whole point of tracking it. |
| **Preconditions** | — The part's controlType maps to SERIAL<br>— The WO is his and in progress |
| **Action** | Tap + on the compressor. |
| **Expected EOS state transition** | The source lookup returns a serializedSource. When one exists it is used with no choice offered - serial custody decides, not the technician. |
| **Expected authority / capability** | Execution data update on his own WO. |
| **Expected UI result** | No source picker for this line; the serialized source is imposed. |
| **Expected audit result** | The consumption carries the serial identity. |
| **Expected cross-object effect** | trackingMode is taken from the PART authority, via one controlType-to-trackingMode mapping, not from the callable request and not hardcoded. |
| **Exception / recovery** | Work Order usage capture records quantities only. A part that is not quantity-tracked cannot establish identity through a quantity-only entry, and the refusal says exactly that. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The refusal message is the explanation and it is a good one. |
| **Reset / replay** | Seed a SERIAL-controlled part on a plan. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/workOrderConsumption/consumptionPartTracking.ts:57-65`<br>`functions/src/workOrderConsumption/consumptionPartTracking.ts:29-35 (one mapping, controlType -> trackingMode)`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:190-212`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:178-180` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A02 — Attempt a quantity-only entry against a serialized part

*Javier Ochoa (field_technician) · taylor · MOBILE · EXCEPTION, BAD_DATA, MOBILE*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | No serialized source resolves - the specific unit is not in a custody record. |
| **Business purpose** | This is the exact shape of the pre-Wave-1 defect. |
| **Preconditions** | — The part is SERIAL-tracked<br>— No serialized source is available |
| **Action** | Submit a positive quantity delta. |
| **Expected EOS state transition** | Refused. 'Work Order usage capture records quantities only. This part is SERIAL-tracked, and a quantity-only entry cannot establish SERIAL identity, so its usage cannot be recorded here.' |
| **Expected authority / capability** | Authority present; a tracking-mode refusal. |
| **Expected UI result** | A clear, specific refusal naming the tracking mode. |
| **Expected audit result** | Nothing written - and the absence is the point. The pre-fix behaviour posted a NONE row. |
| **Expected cross-object effect** | Before the fix, a SERIALIZED part consumed on a Work Order posted a trackingMode NONE row that counted against on-hand while serialized_assets still held the unit - the unit was simultaneously used and in stock. |
| **Exception / recovery** | The correct path is a serialized custody movement, not a quantity entry. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | The refusal names the mode and the reason, which is the standard other refusals should meet. |
| **Reset / replay** | Seed a SERIAL part with no serialized source. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `functions/src/workOrderConsumption/consumptionPartTracking.ts:8-14 (the defect being fixed: write path hardcoded NONE, read path took trackingMode off the request)`<br>`functions/src/workOrderConsumption/consumptionPartTracking.ts:57-65` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Regression guard for the pre-Wave-1 defect: a SERIALIZED part consumed on a Work Order posting a trackingMode NONE row, counted against on-hand while serialized_assets still held the unit. |

#### P3B1-S14-A03 — Record a LOT-tracked sanitiser concentrate on the same Work Order

*Javier Ochoa (field_technician) · taylor · MOBILE · EXCEPTION, BAD_DATA, MOBILE*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | A lot-controlled chemical is on the plan. |
| **Business purpose** | LOT is the third tracking mode and behaves like SERIAL for this purpose - it is not quantity-only. |
| **Preconditions** | — The part's controlType maps to LOT |
| **Action** | Submit a quantity delta. |
| **Expected EOS state transition** | Refused with the same reasoning, naming LOT rather than SERIAL. |
| **Expected authority / capability** | Authority present. |
| **Expected UI result** | The message substitutes the actual mode, so the technician learns which mode blocked him. |
| **Expected audit result** | Nothing written. |
| **Expected cross-object effect** | Only the quantity-tracked mode is accepted by Work Order usage capture. |
| **Exception / recovery** | Lot identity requires a lot-bearing movement. |
| **AI opportunity** | `EXPLAIN` — AI's value is explaining a refusal or a state, not changing it. |
| **Help / ⓘ opportunity** | Same refusal pattern. |
| **Reset / replay** | Seed a LOT-controlled part. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `functions/src/workOrderConsumption/consumptionPartTracking.ts:57-65`<br>`functions/src/workOrderConsumption/consumptionPartTracking.ts:64-65 (isQuantityTracked)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A04 — Record a part whose controlType is missing from the part master

*Javier Ochoa (field_technician) · taylor · MOBILE · BAD_DATA, MISSING_DATA, MOBILE*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | A part record with no controlType - an import artifact. |
| **Business purpose** | Data drift in the part master decides what the Work Order may record. |
| **Preconditions** | — The part's controlType is absent or unrecognised |
| **Action** | Submit a quantity delta. |
| **Expected EOS state transition** | The tracking mode is derived from the stored controlType by a single mapping function; what an absent controlType maps to decides whether this is accepted or refused, and that default is the whole risk. |
| **Expected authority / capability** | Authority present. |
| **Expected UI result** | Either a refusal naming a mode the technician has never heard of, or a silent acceptance. |
| **Expected audit result** | If accepted, a quantity row for a part whose tracking is unknown. |
| **Expected cross-object effect** | The exact failure the Wave 1 fix targeted was a wrong tracking mode reaching the ledger; a defaulted one is the same failure wearing a different hat. |
| **Exception / recovery** | The test is worth running specifically to discover which way the default falls. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a part with no controlType. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/workOrderConsumption/consumptionPartTracking.ts:84 (trackingModeFromStoredControlType)`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:141` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A05 — Check that the replaced compressor left serialized custody

*Nate Purcell (parts_counter) · taylor · DESKTOP · BAD_DATA, END_OF_MONTH, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | A compressor was consumed on a Work Order. |
| **Business purpose** | A serialized unit consumed must stop being an asset the company holds. |
| **Preconditions** | — A serialized consumption was recorded |
| **Action** | Look up the serial in the serialized asset register. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The unit should no longer read as available stock. |
| **Expected audit result** | The consumption and the custody change should agree. |
| **Expected cross-object effect** | THIS is the assertion that catches the defect class: on-hand and serialized custody must not disagree about the same physical unit. |
| **Exception / recovery** | If they disagree, the on-hand figure is wrong and so is the asset register, and neither surface says so. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a serialized unit and consume it. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/workOrderConsumption/consumptionPartTracking.ts:8-20` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A06 — Record the old compressor coming off the machine

*Javier Ochoa (field_technician) · taylor · MOBILE · MISSING_DATA, MOBILE, UNUSUAL_BUT_LEGITIMATE*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | The failed unit is now on the truck as a warranty return. |
| **Business purpose** | Warranty returns are a real serialized movement that starts on a Work Order. |
| **Preconditions** | — A serialized unit was removed |
| **Action** | Look for a way to record a removed unit on the Work Order. |
| **Expected EOS state transition** | None in the Work Order consumption path, which records usage, not returns. |
| **Expected authority / capability** | UNPROVEN whether a technician-side removal/return path exists. If not, this is MISSING_CAPABILITY. |
| **Expected UI result** | n/a. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | The equipment's installed compressor serial, if tracked, is now stale. |
| **Exception / recovery** | He writes the serial in a note and hands the unit to the parts counter. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionPartTracking.ts:57-60 (usage capture records quantities only)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A07 — Complete a warranty Work Order and see whether warranty is recorded anywhere

*Javier Ochoa (field_technician) · taylor · MOBILE · MISSING_DATA, NORMAL, MOBILE*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | WO type WARRANTY; the compressor is under manufacturer warranty. |
| **Business purpose** | Warranty recovery is real money and depends on the record. |
| **Preconditions** | — The WO type is WARRANTY |
| **Action** | Complete the job. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED. |
| **Expected authority / capability** | Complete: technician, own assignment. |
| **Expected UI result** | Nothing about warranty claim status appears. |
| **Expected audit result** | completedAt is recorded; warranty status is not a lifecycle concept. |
| **Expected cross-object effect** | WARRANTY is one of the five Work Order types, so it is classifiable - but the type is a classification, not a claim. |
| **Exception / recovery** | The claim is filed outside EOS. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a WARRANTY WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/types/workOrder.ts:37-42 (WorkOrderType includes WARRANTY)`<br>`functions/src/transitionEngine.ts:142` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A08 — Look for the Work Order that consumed a specific serial

*Nate Purcell (parts_counter) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | A serial number from a warranty claim form. |
| **Business purpose** | Working backwards from a part to a job is how warranty and recall work is done. |
| **Preconditions** | — A serialized consumption exists |
| **Action** | Search by serial. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether a serial-to-Work-Order lookup exists in the UI. |
| **Expected audit result** | The consumption record holds the linkage. |
| **Expected cross-object effect** | If the linkage is only in the ledger and not surfaced, the answer requires an engineer. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a serialized consumption. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | had to hunt for necessary information |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:190-212` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A09 — Record two of a serialized part in one action

*Javier Ochoa (field_technician) · taylor · MOBILE · EXCEPTION, UNUSUAL_BUT_LEGITIMATE, MOBILE*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | Two identical serialized units fitted on one machine. |
| **Business purpose** | Quantity and identity are incompatible, and two units means two identities. |
| **Preconditions** | — The part is SERIAL-tracked<br>— Two units were fitted |
| **Action** | Attempt +2. |
| **Expected EOS state transition** | A quantity of two cannot establish two serial identities. The refusal reasoning applies with more force, not less. |
| **Expected authority / capability** | Authority present. |
| **Expected UI result** | The counter allows +2 to be expressed even where it cannot be meaningful. |
| **Expected audit result** | Nothing written if refused. |
| **Expected cross-object effect** | Whether the serializedSource path handles a quantity above one at all is UNPROVEN and worth executing. |
| **Exception / recovery** | The correct answer is two separate serialized movements. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a SERIAL part and two units. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceOptions.ts:88 (input.trackingMode === 'SERIAL')`<br>`functions/src/workOrderConsumption/consumptionPartTracking.ts:57-60` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S14-A10 — Confirm no Work Order consumption row carries a hardcoded tracking mode

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, BAD_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Tempe Mill Ave - Taylor C712: compressor replacement under warranty

| | |
| --- | --- |
| **Starting records / state** | A month of Work Order consumption rows. |
| **Business purpose** | The Wave 1 fix must be verifiable from the data, not only from the code. |
| **Preconditions** | — Consumption rows exist across several tracking modes |
| **Action** | Inspect the tracking mode recorded on each row against the part master's controlType. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether any surface exposes the tracking mode on a consumption row. |
| **Expected audit result** | trackingMode is deliberately NOT carried on the consumption event; the validator takes it from the part authority instead. |
| **Expected cross-object effect** | That design choice is what makes the defect unrepeatable - the mode cannot be smuggled in from the client - but it also means a stored row's mode must be re-derived to audit it. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed rows across modes. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/workOrderConsumption/consumptionMovement.ts:107 (trackingMode deliberately not on the event; taken from the part authority)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S15 — 13:40 - the dead zone: queueing, syncing, and the conflict that comes back

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

Tonya spends ninety minutes inside a tube-ice plant with no signal, records four things, and comes back into coverage. The offline runtime is a durable local intent queue with a dependency graph, idempotency keys and failure classification - and no service worker, so it protects writes and not reads.

<details><summary>10 activities — P3B1-S15-A01 · P3B1-S15-A02 · P3B1-S15-A03 · P3B1-S15-A04 · P3B1-S15-A05 · P3B1-S15-A06 · P3B1-S15-A07 · P3B1-S15-A08 · P3B1-S15-A09 · P3B1-S15-A10</summary>

#### P3B1-S15-A01 — Record a work note with no connectivity

*Tonya Reese (field_technician) · ventana · MOBILE · NETWORK_INTERRUPTION, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | No signal; WO in WORK_IN_PROGRESS. |
| **Business purpose** | The note must not be lost because a building has thick walls. |
| **Preconditions** | — No connectivity<br>— The WO is hers and in progress |
| **Action** | Save a work note. |
| **Expected EOS state transition** | The intent is written to a durable local store, namespaced per user, and queued. |
| **Expected authority / capability** | Deferred - authority is evaluated when the intent reaches the server. |
| **Expected UI result** | A sync indicator shows a pending intent rather than a false success. |
| **Expected audit result** | Nothing server-side yet. |
| **Expected cross-object effect** | The local store reports durable:false if the save did not actually persist, so a failure to queue is knowable rather than silent. |
| **Exception / recovery** | The store is explicitly NOT encrypted, which matters for a lost phone carrying customer notes. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The sync indicator is the help. |
| **Reset / replay** | Clear the local intent store for the test user. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/offline/localIntentStore.js (eos.tech.offline namespace, per-uid, not encrypted, durable flag)`<br>`field-ops-app-vite/src/offline/submitOrQueue.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S15-A02 — Queue four intents in order and watch the dependency graph hold

*Tonya Reese (field_technician) · ventana · MOBILE · NETWORK_INTERRUPTION, MOBILE, RETRY_IDEMPOTENCY*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | Offline: an equipment install, a note, a parts-usage entry and a completion. |
| **Business purpose** | Order matters: completing a job before its install is recorded would be wrong. |
| **Preconditions** | — Four intents queued offline |
| **Action** | Perform all four actions offline, then regain signal. |
| **Expected EOS state transition** | The queue applies them in dependency order. Equipment install to Work Order completion is a HARD required dependency; notes, labour and parts usage before completion are optional sequencing edges. |
| **Expected authority / capability** | Each evaluated server-side on send. |
| **Expected UI result** | The sync queue shows a card per intent with status. |
| **Expected audit result** | Server-side events in the order the queue sent them. |
| **Expected cross-object effect** | A hard dependency means the completion will not be sent until the install succeeds. |
| **Exception / recovery** | If the install is refused, the completion behind it must not be sent either. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Waiting for the install to sync first' is what the queue card should say. |
| **Reset / replay** | Clear the queue. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/offline/intentQueue.js (EQUIPMENT_INSTALL -> WORK_ORDER_COMPLETE hard required dependency)`<br>`field-ops-app-vite/src/modules/mobile/SyncQueue.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S15-A03 — Regain signal and watch the queue drain

*Tonya Reese (field_technician) · ventana · MOBILE · NETWORK_INTERRUPTION, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | Four queued intents; the phone reconnects. |
| **Business purpose** | The moment of reconnection is where an offline system either keeps its promises or quietly loses work. |
| **Preconditions** | — Queued intents exist |
| **Action** | Walk back outside. |
| **Expected EOS state transition** | The runtime listens for the browser online event to trigger a sync pass - there is no polling timer. navigator.onLine is a hint, never authority. |
| **Expected authority / capability** | Each intent authorised on arrival. |
| **Expected UI result** | Queue cards resolve one by one. |
| **Expected audit result** | Server events land with server-clock timestamps, which are the reconnection time, not the action time. |
| **Expected cross-object effect** | A ninety-minute offline session produces four timestamps within seconds of each other. |
| **Exception / recovery** | If the online event never fires (some mobile browsers), the pass does not start until something else triggers it. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Recorded at 15:12 (you were offline from 13:40)' is the honest rendering nobody gets. |
| **Reset / replay** | Toggle network state. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/hooks/useOfflineRuntime.js (online event, no polling)`<br>`field-ops-app-vite/src/offline/syncExecutor.js (connectivityHint)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Offline-queued work is stamped with the sync time rather than the action time, and nothing on the record distinguishes the two, so an entire offline session collapses to one instant in the audit trail. |

#### P3B1-S15-A04 — Have a queued intent refused by the server on arrival

*Tonya Reese (field_technician) · ventana · MOBILE · EXCEPTION, RECOVERY, NETWORK_INTERRUPTION, HANDOFF, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | A completion intent for a Work Order that a dispatcher cancelled while she was offline. |
| **Business purpose** | The world changes while a technician is out of contact. |
| **Preconditions** | — The WO was cancelled during the offline window |
| **Action** | Sync. |
| **Expected EOS state transition** | The completion is refused - COMPLETED is not reachable from CANCELLED, which is terminal. |
| **Expected authority / capability** | A hard server refusal is surfaced immediately and NEVER silently retried, precisely to avoid a misleading 'pending sync' state. |
| **Expected UI result** | The queue card shows the refusal and what action is required. |
| **Expected audit result** | No state change. |
| **Expected cross-object effect** | Her ninety minutes of work exist only as a refused intent. There is no Work Order to attach them to. |
| **Exception / recovery** | The recovery is a new Work Order created by someone else, and her notes must be re-entered. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'This job was cancelled at 14:05 by Dale Brackett. Your notes are still here - where should they go?' is the sentence that saves the work. |
| **Reset / replay** | Cancel a WO while intents are queued against it. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/offline/submitOrQueue.js (refusals surfaced, never retried)`<br>`field-ops-app-vite/src/offline/syncFailureClassification.js`<br>`functions/src/transitionEngine.ts:50` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A refused offline intent has no salvage path: the technician's captured work is stranded in a queue card with nowhere to be re-applied. |

#### P3B1-S15-A05 — Have a queued intent fail retryably on a weak connection

*Tonya Reese (field_technician) · ventana · MOBILE · NETWORK_INTERRUPTION, RETRY_IDEMPOTENCY, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | One bar; the send times out. |
| **Business purpose** | Retryable and refused are different and must be treated differently. |
| **Preconditions** | — A transient failure occurs |
| **Action** | Sync on a weak connection. |
| **Expected EOS state transition** | The failure is classified as retryable and backed off. The executor deliberately does NOT wait out the backoff inside a pass - spinning on an intent that failed retryably is not synchronisation. |
| **Expected authority / capability** | Unchanged. |
| **Expected UI result** | The card shows a retry state, not a failure. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Backoff arithmetic uses an injected clock, so it is testable without waiting. |
| **Exception / recovery** | An intent that never succeeds ages in the queue; whether anything escalates it is UNPROVEN. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Will retry when you have a better signal.' |
| **Reset / replay** | Throttle the network. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/offline/syncFailureClassification.js (FAILURE_CLASS, retryable vs refused)`<br>`field-ops-app-vite/src/offline/syncExecutor.js:74,201-204` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S15-A06 — Send the same intent twice after a timeout that actually succeeded

*Tonya Reese (field_technician) · ventana · MOBILE · RETRY_IDEMPOTENCY, NETWORK_INTERRUPTION, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | The server committed; the response was lost. |
| **Business purpose** | This is the defining offline hazard. |
| **Preconditions** | — A committed intent whose response was lost |
| **Action** | Let the queue retry. |
| **Expected EOS state transition** | The intent's identity is derived from a payload fingerprint, so a replay is recognised rather than duplicated. Install flows carry one idempotency key per attempt and a retry replays and returns the SAME Equipment. |
| **Expected authority / capability** | Unchanged. |
| **Expected UI result** | The card resolves to success, not to a duplicate. |
| **Expected audit result** | One event. |
| **Expected cross-object effect** | Work Order creation uses the same pattern with an idempotency key holder. |
| **Exception / recovery** | A payload edited between attempts produces a different fingerprint and therefore a genuinely new intent - which is correct, and is a sharp edge. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Simulate a lost response. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/offline/intentEnvelope.js (deriveIntentId, payloadFingerprint)`<br>`field-ops-app-vite/src/offline/technicianIntent.js`<br>`field-ops-app-vite/src/modules/mobile/EquipmentInstallCloseout.jsx (one idempotency key per attempt)`<br>`field-ops-app-vite/src/domain/workOrderWizard.js (createIdempotencyKeyHolder)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S15-A07 — Close the app with intents still queued and reopen it an hour later

*Tonya Reese (field_technician) · ventana · MOBILE · NETWORK_INTERRUPTION, MOBILE, RECOVERY*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | Four unsent intents in the local store. |
| **Business purpose** | Phones get closed, batteries die, apps get killed by the OS. |
| **Preconditions** | — Unsent intents exist |
| **Action** | Force-quit and relaunch. |
| **Expected EOS state transition** | The queue is durable across sessions because the store is IndexedDB/localStorage backed and namespaced per uid. |
| **Expected authority / capability** | Unchanged. |
| **Expected UI result** | The sync queue should show the same cards. |
| **Expected audit result** | None until they send. |
| **Expected cross-object effect** | A different user signing in on the same device must not see them - the store is namespaced per uid. |
| **Exception / recovery** | Cleared browser storage loses the work, and the store is not encrypted. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Clear the store. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/offline/localIntentStore.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S15-A08 — Try to open the app cold with no signal

*Tonya Reese (field_technician) · ventana · MOBILE · NETWORK_INTERRUPTION, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | App closed, no connectivity. |
| **Business purpose** | The queue is worthless if the app cannot start. |
| **Preconditions** | — No connectivity<br>— The app is not loaded |
| **Action** | Launch the app. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | There is no service worker, no workbox and no PWA manifest anywhere in the app, so the assets cannot be served offline. The app does not start. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Every offline guarantee assumes a warm session. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Clear cache and load offline. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite (no serviceWorker/workbox/sw.js/manifest found anywhere in src or public)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No service worker means the offline write queue only helps a session that was already open. A technician whose app is killed in a dead zone has no offline capability at all. |

#### P3B1-S15-A09 — Read the sync queue and understand what is actually pending

*Tonya Reese (field_technician) · ventana · MOBILE · MOBILE, HANDOFF*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | Four cards in mixed states. |
| **Business purpose** | The technician is the only person who knows what the queue owes. |
| **Preconditions** | — Mixed queue states |
| **Action** | Open the sync queue. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | A card per intent showing status, conflicts, and the action required - a visible queue rather than a spinner, which is the right design. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Nobody in the office can see this queue. A dispatcher wondering why a job has not completed has no view of the technician's pending intents. |
| **Exception / recovery** | A technician who ignores a refused card leaves work permanently unrecorded. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The queue IS the help. |
| **Reset / replay** | Seed mixed states. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/SyncQueue.jsx`<br>`field-ops-app-vite/src/shared/ui/SyncIndicator.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Pending technician intents are invisible to dispatch, so a job that looks stalled in the office may simply be queued on a phone in a basement. |

#### P3B1-S15-A10 — See why a job shows WORK_IN_PROGRESS three hours after it should have finished

*Dale Brackett (dispatcher) · taylor · DESKTOP · HANDOFF, NETWORK_INTERRUPTION, END_OF_DAY, DESKTOP*

**Account context.** Desert Ice & Cold Storage, Tolleson - a plant room with no signal

| | |
| --- | --- |
| **Starting records / state** | Tonya's completion intent is queued on her phone. |
| **Business purpose** | The dispatcher's board is the office's only window into the field. |
| **Preconditions** | — A completion intent is queued but unsent |
| **Action** | Look at the Work Order. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The board shows WORK_IN_PROGRESS. There is nothing to distinguish 'still working' from 'finished, offline, unsent'. |
| **Expected audit result** | No server event yet. |
| **Expected cross-object effect** | He phones her, which she cannot answer, because she has no signal. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Last seen online 13:40' on the technician lane would answer most of this. |
| **Reset / replay** | Queue a completion and inspect the board. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · no obvious "what next?" location · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherBoard.jsx`<br>`field-ops-app-vite/src/offline/localIntentStore.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No last-seen or connectivity signal per technician on the dispatcher board, so an offline technician is indistinguishable from an unresponsive one. |

</details>

### P3B1-S16 — 12:05 - completion, and the two people it takes to finish a Work Order

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

Curtis finishes. Complete is the last action a technician may take; Close belongs to the office. The gap between them is where the invoice, the warranty claim and the customer's copy of the paperwork live - and it is a genuine handoff between two roles who cannot see each other's screens.

<details><summary>10 activities — P3B1-S16-A01 · P3B1-S16-A02 · P3B1-S16-A03 · P3B1-S16-A04 · P3B1-S16-A05 · P3B1-S16-A06 · P3B1-S16-A07 · P3B1-S16-A08 · P3B1-S16-A09 · P3B1-S16-A10</summary>

#### P3B1-S16-A01 — Complete the Work Order

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL, HANDOFF*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS with a note and two parts recorded. |
| **Business purpose** | Completion is the technician saying the work is done. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Tap Complete. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED with a server-clock completedAt. COMPLETED is terminal for the technician: its ONLY onward move is CLOSED, and it is explicitly not cancellable. |
| **Expected authority / capability** | Complete: roles ['technician'], requiresOwnAssignment true. |
| **Expected UI result** | The action set collapses - there is nothing further he can do. |
| **Expected audit result** | completedAt recorded. |
| **Expected cross-object effect** | COMPLETED appears in TERMINAL_STATUSES alongside CLOSED and CANCELLED, so the technician is freed for double-booking purposes and can be dispatched again. |
| **Exception / recovery** | Completing with no note and no parts is permitted; nothing validates that anything was recorded. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'What happens now?' - the office closes it, and nothing says so. |
| **Reset / replay** | Fresh fixture; COMPLETED cannot be reopened. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:142`<br>`functions/src/transitionEngine.ts:48 (COMPLETED: CLOSED)`<br>`functions/src/transitionEngine.ts:53-57`<br>`functions/src/transitionEngine.ts:25 (COMPLETED only goes to CLOSED, not cancellable)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S16-A02 — Complete a Work Order with nothing recorded at all

*Curtis Nally (field_technician) · taylor · MOBILE · MISSING_DATA, MISTAKE, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS, no note, no parts, no labour. |
| **Business purpose** | The path of least resistance is the path most taken at 17:20 on a Friday. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Tap Complete. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED. Succeeds. |
| **Expected authority / capability** | Complete. |
| **Expected UI result** | No prompt, no warning, no required field. |
| **Expected audit result** | A completion with no content. |
| **Expected cross-object effect** | The Work Order is unbillable, the equipment history gains nothing, and the parts that were physically fitted are now shrinkage. |
| **Exception / recovery** | Nobody finds out until Amanda tries to close it. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | A completion checklist is the fix. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:142`<br>`functions/src/transitionEngine.ts:128-143 (no content validation on any action)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Complete requires no recorded work. An empty Work Order can reach COMPLETED, and the discovery happens downstream at close or invoice time, after the technician has left the site. |

#### P3B1-S16-A03 — Realise ten minutes later that he forgot to record a part

*Curtis Nally (field_technician) · taylor · MOBILE · MISTAKE, RECOVERY, MOBILE*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | WO COMPLETED at 12:05; it is 12:15 and he is still in the car park. |
| **Business purpose** | The ten minutes after completion are when technicians remember things. |
| **Preconditions** | — The WO is COMPLETED |
| **Action** | Try to add the part. |
| **Expected EOS state transition** | None available. The technician's action set is empty in COMPLETED, and there is no reverse edge. |
| **Expected authority / capability** | Whether execution data can still be updated on a COMPLETED Work Order is UNPROVEN by this lane and is the single most valuable thing to execute in this story. |
| **Expected UI result** | If the capture surfaces are gone, the part is lost. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | An unrecorded part is inventory shrinkage and a lost billing line. |
| **Exception / recovery** | He tells the coordinator, who has no way to add it either. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Complete a WO and attempt an execution update. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:48`<br>`functions/src/transitionEngine.ts:152-172 (getAllowedActions returns nothing for a technician in COMPLETED)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S16-A04 — Review a completed Work Order before closing it

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · PERMISSION_DENIAL, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | WO COMPLETED with a note and two parts. |
| **Business purpose** | Close is the office's assertion that the record is good enough to bill. |
| **Preconditions** | — The WO is COMPLETED |
| **Action** | Open the Work Order detail page and read the lifecycle spine and execution data. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. Whether Amanda's legacy role reaches the Work Order routes at all depends on the workOrder.create gate those routes carry - a billing role that lacks workOrder.create cannot open the page. |
| **Expected UI result** | The record page shows status as a sentence, a lifecycle band, an actions cluster and the parts plan. |
| **Expected audit result** | None for reading. |
| **Expected cross-object effect** | The route gate for the Work Order detail page is workOrder.create, which is a creation capability being used as a read gate. |
| **Exception / recovery** | A billing user without workOrder.create is locked out of the record they must bill from. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Sign in as a billing-only role. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/App.jsx:1044-1052 (previewHasPermission('workOrder.create', ...) gates BOTH the wizard and the detail page)`<br>`field-ops-app-vite/src/modules/workOrders/WorkOrderDetailPage.jsx:247-256,331-337` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The Work Order detail page is gated on workOrder.create, so read access to a record requires the authority to create one. Any read-only role - billing, service manager, auditor - is excluded by a creation capability. |

#### P3B1-S16-A05 — Close the Work Order

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · NORMAL, HANDOFF, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | WO COMPLETED and reviewed. |
| **Business purpose** | Close is the terminal state that ends the record's life. |
| **Preconditions** | — The WO is COMPLETED<br>— Amanda holds admin or dispatcher |
| **Action** | Invoke Close. |
| **Expected EOS state transition** | COMPLETED -> CLOSED with a server-clock closedAt. CLOSED is terminal with no outgoing transitions. |
| **Expected authority / capability** | Close: admin/dispatcher. There is no separate billing or close capability. |
| **Expected UI result** | The status chip becomes CLOSED and all actions disappear. |
| **Expected audit result** | closedAt recorded. |
| **Expected cross-object effect** | Nothing downstream is triggered by Close in this lane's reading - no invoice, no customer notification. |
| **Exception / recovery** | A Work Order closed in error cannot be reopened. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | 'Closed is permanent' belongs in the confirm. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:136`<br>`functions/src/transitionEngine.ts:49 (CLOSED: [])`<br>`functions/src/transitionEngine.ts:92-99 (closedAt)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Close is gated on admin/dispatcher, so the billing role that actually performs close-out either runs with dispatcher authority or cannot do its job. |

#### P3B1-S16-A06 — Close a Work Order that the technician completed with no content

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · EXCEPTION, HANDOFF, RECOVERY, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | WO COMPLETED with nothing recorded. |
| **Business purpose** | The office is the last line of defence and has no tools. |
| **Preconditions** | — An empty COMPLETED WO |
| **Action** | Look for a way to send it back. |
| **Expected EOS state transition** | None. COMPLETED goes only to CLOSED. There is no reject, no reopen, no return-to-technician. |
| **Expected authority / capability** | Close is the only action available. |
| **Expected UI result** | Her choices are to close an empty record or leave it open forever. |
| **Expected audit result** | Either choice is recorded faithfully and neither is right. |
| **Expected cross-object effect** | Aged COMPLETED Work Orders accumulate as a queue nobody can clear. |
| **Exception / recovery** | The technician is phoned and re-enters the information verbally; she types it into a note field she may not have access to. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Seed an empty COMPLETED WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:48`<br>`functions/src/transitionEngine.ts:136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | There is no return-to-technician path from COMPLETED. A Work Order completed with insufficient information can only be closed as-is or left open indefinitely. |

#### P3B1-S16-A07 — Close twelve Work Orders at the end of the week

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · BULK, END_OF_DAY, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | Twelve COMPLETED Work Orders from Monday to Thursday. |
| **Business purpose** | Close-out is a batch activity in every service business. |
| **Preconditions** | — Twelve COMPLETED WOs |
| **Action** | Close each. |
| **Expected EOS state transition** | Twelve COMPLETED -> CLOSED transitions. |
| **Expected authority / capability** | Close, twelve times. No bulk close exists; that is MISSING_CAPABILITY if wanted. |
| **Expected UI result** | Twelve record pages, twelve actions. |
| **Expected audit result** | Twelve closedAt timestamps, all within minutes, which makes 'time to close' a measure of her Friday afternoon. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | An interruption halfway leaves six closed and six not, with no view of which. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed twelve COMPLETED WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S16-A08 — Find the Work Orders that are completed but not yet closed

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · CROSS_COMPANY, END_OF_MONTH, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | A mix of CREATED, SCHEDULED, COMPLETED and CLOSED Work Orders. |
| **Business purpose** | The completed-not-closed queue is the close-out worklist. |
| **Preconditions** | — Work Orders exist across statuses |
| **Action** | Filter the Work Orders list by status COMPLETED. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read, subject to the same workOrder.create route gate. |
| **Expected UI result** | A metadata-driven list with search and filter. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | She cannot filter by operating company, because no Work Order carries one - so Taylor and Ventana close-out are one undifferentiated pile. |
| **Exception / recovery** | Two companies' revenue recognition runs off one unsegregated list. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a status mix across both companies. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · operating-company attribution unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrdersList.jsx`<br>`functions/src/types/workOrder.ts (no operatingCompanyId)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Close-out cannot be segregated by operating company, so two companies' service revenue is worked from one list with no attribution. |

#### P3B1-S16-A09 — Measure how long Work Orders sit between COMPLETED and CLOSED

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc IYT0500A, condenser cleaned and valve replaced

| | |
| --- | --- |
| **Starting records / state** | A month of closed Work Orders. |
| **Business purpose** | The completed-to-closed gap is billing latency and it is pure cash. |
| **Preconditions** | — Closed WOs with both timestamps |
| **Action** | Compare completedAt to closedAt across the month. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Both timestamps exist on the record, so this is computable. Whether any surface computes it is UNPROVEN. |
| **Expected audit result** | The timestamps are server-clock and immutable, which makes the measure trustworthy. |
| **Expected cross-object effect** | This is one of the few genuinely well-instrumented service metrics in the model, precisely because both ends are execution timestamps. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month of closed WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information |
| **Evidence** | `functions/src/transitionEngine.ts:92-99`<br>`functions/src/performance/performanceMetricRegistry.ts:217` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S16-A10 — Close a Work Order that a Ventana technician completed on a Taylor account

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · CROSS_COMPANY, UNUSUAL_BUT_LEGITIMATE, END_OF_MONTH, DESKTOP*

**Account context.** QuikMart #418 - a Ventana technician covered a Taylor soft-serve call

| | |
| --- | --- |
| **Starting records / state** | WO COMPLETED by Tonya, a Ventana technician, on a Taylor-originated job. |
| **Business purpose** | Cross-company cover happens weekly and the accounting must land somewhere. |
| **Preconditions** | — The WO was completed by a technician of the other company |
| **Action** | Close it. |
| **Expected EOS state transition** | COMPLETED -> CLOSED. Succeeds. |
| **Expected authority / capability** | Close: admin/dispatcher. No company check exists anywhere in the chain. |
| **Expected UI result** | Nothing indicates that the work crossed companies. |
| **Expected audit result** | The events name Tonya and Amanda; the companies are inferable only from who they are. |
| **Expected cross-object effect** | Intercompany labour cost allocation has no hook in the Work Order at all. |
| **Exception / recovery** | None - nothing refuses. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Complete a WO with a cross-company technician. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:128-143`<br>`functions/src/types/workOrder.ts`<br>`functions/src/ownership/operatingCompanyAuthority.ts:23-24` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Cross-company cover leaves no trace on the Work Order, so intercompany labour cannot be allocated or even detected without inferring company from the actor's identity. |

</details>

### P3B1-S17 — The walls a technician hits, and the ones he should

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

Some refusals protect the business. Some are accidents of an unmigrated access model. This story walks a technician into both kinds so an executor can tell them apart.

<details><summary>10 activities — P3B1-S17-A01 · P3B1-S17-A02 · P3B1-S17-A03 · P3B1-S17-A04 · P3B1-S17-A05 · P3B1-S17-A06 · P3B1-S17-A07 · P3B1-S17-A08 · P3B1-S17-A09 · P3B1-S17-A10</summary>

#### P3B1-S17-A01 — Attempt to read a Work Order assigned to someone else

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | A dispatched WO whose assignedTechId is another technician. |
| **Business purpose** | Technician read scoping is the base of the whole access model. |
| **Preconditions** | — The WO belongs to another technician |
| **Action** | Attempt a direct document read. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Denied. The read gate is admin/dispatcher OR technician-and-own-assignment, and callerTechnicianId() fails closed when signed out, when the user doc is absent, or when the field is missing. |
| **Expected UI result** | The record is not in his list at all. |
| **Expected audit result** | A denied read is not audited. |
| **Expected cross-object effect** | Correct and enforced at the data layer, not merely in the UI. |
| **Exception / recovery** | None needed. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Reassign assignedTechId. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `firestore.rules:507-508`<br>`firestore.rules:320-327` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S17-A02 — Attempt an unconstrained query across all Work Orders

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | Signed in as a technician. |
| **Business purpose** | A list query is where scoped read models usually leak. |
| **Preconditions** | — Signed in as a technician |
| **Action** | Issue a query with no assignedTechId constraint. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Denied. The technician surfaces issue the matching scoped query, which is what makes the LIST provably authorised; an unconstrained technician read is denied. |
| **Expected UI result** | n/a - this is a direct-API test. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The same pattern applies to fieldops_technicians: a technician reads only their own record. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `firestore.rules:352-363`<br>`firestore.rules:397-404`<br>`firestore.rules:507-508` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S17-A03 — Attempt to write the Work Order status directly, bypassing the callable

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | A WO assigned to him in ACCEPTED. |
| **Business purpose** | If the client can write status, the whole transition engine is decoration. |
| **Preconditions** | — The WO is his |
| **Action** | Attempt a direct client write to fieldops_wos. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Denied absolutely: fieldops_wos create, update and delete are all `if false` for every client. Transitions exist only through the trusted callable. |
| **Expected UI result** | n/a. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is the strongest guarantee in the Work Order domain and is worth proving explicitly. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `firestore.rules:509 (allow create, update, delete: if false)`<br>`field-ops-app-vite/src/services/workOrderService.ts:65-72` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S17-A04 — Attempt the same manipulation on the LEGACY fieldops_jobs collection

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, UNUSUAL_BUT_LEGITIMATE, BAD_DATA, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | A legacy job document assigned to his technicianId in status 'assigned'. |
| **Business purpose** | Two lifecycles exist in this system, and only one of them is locked. |
| **Preconditions** | — A fieldops_jobs document exists with technicianId equal to his |
| **Action** | Attempt a client write changing status from 'assigned' to 'in_progress'. |
| **Expected EOS state transition** | PERMITTED. The legacy collection still encodes a client-writable lifecycle in Rules: the assigned technician may perform a status-only start on their own job. |
| **Expected authority / capability** | Allowed by an explicit Rules path - the ONLY transition a technician may perform directly, by Decision #39/O-3. Completion is reserved to the trusted callable, which bypasses Rules by design. |
| **Expected UI result** | No EOS surface exercises this - the Jobs screen reads the governed Work Order collection, not this one. |
| **Expected audit result** | A direct client write produces no audit event, because nothing server-side ran. |
| **Expected cross-object effect** | Two lifecycles - the governed eleven-status Work Order engine and a four-status legacy job model (open/assigned/in_progress/complete) - coexist, with opposite write postures. |
| **Exception / recovery** | A completed legacy job is terminal for every client; job delete is denied for all. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a fieldops_jobs document. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `firestore.rules:328-350 (isValidJobTransition, isTechnicianJobTransition, jobStatusOnlyChange)`<br>`firestore.rules:352-394 (fieldops_jobs read/create/update/delete)`<br>`firestore.rules:509 (fieldops_wos: client writes if false)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A second, client-writable Work Order lifecycle still exists in deployed Rules (fieldops_jobs), with a lifecycle vocabulary and a write posture opposite to the governed engine. Client writes there produce no audit event. |

#### P3B1-S17-A05 — Attempt a dispatcher action as an apprentice technician

*Wes Tanner (apprentice_technician) · taylor · MOBILE · PERMISSION_DENIAL, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | Wes holds the technician role only. |
| **Business purpose** | Apprentices are given phones before they are given authority. |
| **Preconditions** | — Wes's role is technician |
| **Action** | Invoke MarkReady, Schedule, Dispatch, Close and Cancel in turn. |
| **Expected EOS state transition** | All five refused. |
| **Expected authority / capability** | All five list admin/dispatcher only. getAllowedActions filters on role before ownership, so the role check alone disposes of them. |
| **Expected UI result** | None of the five is offered on his surfaces. |
| **Expected audit result** | UNPROVEN whether refused privileged actions are audited. |
| **Expected cross-object effect** | There is no apprentice-versus-journeyman distinction in the model at all - Wes has exactly the same authority as a twenty-year technician. |
| **Exception / recovery** | Supervision and sign-off have no representation. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Vary the role. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:128-143`<br>`functions/src/transitionEngine.ts:152-172` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No skill or seniority dimension exists for technicians, so an apprentice can complete a warranty compressor replacement with no sign-off. |

#### P3B1-S17-A06 — Complete a job that requires a certification he does not hold

*Wes Tanner (apprentice_technician) · taylor · MOBILE · MISSING_DATA, PERMISSION_DENIAL, UNUSUAL_BUT_LEGITIMATE, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | A refrigerant-handling job assigned to Wes. |
| **Business purpose** | EPA 608 certification is a legal requirement for refrigerant work. |
| **Preconditions** | — The job involves refrigerant handling |
| **Action** | Complete it. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED. Succeeds. |
| **Expected authority / capability** | Complete: technician, own assignment. Certification is not consulted anywhere. |
| **Expected UI result** | Nothing warns. |
| **Expected audit result** | A completion with no certification record. |
| **Expected cross-object effect** | Neither the recommendation engine nor the scheduler nor the transition engine reads any skill or certification data. The recommendation engine's own comment notes technicians have name/phone/status only. |
| **Exception / recovery** | The compliance exposure is real and entirely outside the system. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:79-84,128-142 (technicians have name/phone/status only)`<br>`functions/src/transitionEngine.ts:142` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No technician skill, licence or certification data exists anywhere, so certification-restricted work can be dispatched to and completed by anyone. |

#### P3B1-S17-A07 — Act on a Taylor Work Order as a Ventana technician

*Tonya Reese (field_technician) · ventana · MOBILE · CROSS_COMPANY, MOBILE, UNUSUAL_BUT_LEGITIMATE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | A Taylor job dispatched to Tonya to cover. |
| **Business purpose** | The cover is legitimate; the question is whether anything records the crossing. |
| **Preconditions** | — The WO is dispatched to her |
| **Action** | Accept, Travel, Arrive, WorkStart, Complete. |
| **Expected EOS state transition** | All five succeed. |
| **Expected authority / capability** | requiresOwnAssignment is satisfied; no company dimension exists to fail. |
| **Expected UI result** | Nothing distinguishes this from her own company's work. |
| **Expected audit result** | Five events naming her. |
| **Expected cross-object effect** | Her fieldops_technicians record carries no operating company either, so even the actor's company must be looked up elsewhere. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Dispatch a Taylor WO to a Ventana technician. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:138-142`<br>`functions/src/types/workOrder.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S17-A08 — Reach the dispatcher board by URL as a technician

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | Signed in as a technician. |
| **Business purpose** | Nav omission and access control are different things. |
| **Preconditions** | — Signed in as a technician |
| **Action** | Navigate directly to the dispatcher board route. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The route is gated on the legacy nav key dispatcherBoard, which technicians do not hold - their allow-list is fieldMode, jobs and technicianDashboard. |
| **Expected UI result** | The refusal should use the honest-state vocabulary rather than rendering blank. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Even if it rendered, Rules deny him every Work Order not assigned to him, so the board would draw nothing. |
| **Exception / recovery** | A blank board is a worse failure than an explicit refusal. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | CAPABILITY_NOT_ENABLED is the existing vocabulary for exactly this. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/domain/constants.js:374-378`<br>`field-ops-app-vite/src/shared/ui/HonestState.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S17-A09 — Find the job-assignments screen he IS allowed to see

*Curtis Nally (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, UNUSUAL_BUT_LEGITIMATE, MOBILE*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | Signed in as a technician. |
| **Business purpose** | The technician's legacy nav allow-list includes the jobs key, which most technicians never discover. |
| **Preconditions** | — Signed in as a technician |
| **Action** | Navigate to Service > Job Assignments. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Permitted - the jobs legacy key is granted to admin, dispatcher AND technician. |
| **Expected UI result** | A list reading the governed Work Order collection. Whether it is scoped to his own jobs by the query, or merely emptied by Rules, is UNPROVEN. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | A technician therefore has two different Work Order lists (this and the technician dashboard) with different presentations of the same data. |
| **Exception / recovery** | If this screen issues an unconstrained query, Rules deny it and he gets a blank or an error where the dashboard works. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Sign in as a technician and open both lists. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/domain/constants.js:374-378 (technician: fieldMode, jobs, technicianDashboard)`<br>`field-ops-app-vite/src/modules/jobs/Jobs.jsx`<br>`firestore.rules:507-508` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S17-A10 — Grant a service manager read access to all Work Orders

*Priya Raman (service_manager) · taylor · DESKTOP · PERMISSION_DENIAL, MISSING_DATA, CROSS_COMPANY, DESKTOP*

**Account context.** Mixed - Taylor and Ventana jobs on shared technicians

| | |
| --- | --- |
| **Starting records / state** | Priya needs to see every Work Order across both companies. |
| **Business purpose** | This is the most ordinary administrative request in the domain. |
| **Preconditions** | — Priya is not admin or dispatcher |
| **Action** | Look for a capability to grant. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | There is NO workOrder.read capability in the permission catalog. Work Order visibility is decided by the legacy users/{uid}.role string, so the only way to give a service manager full read is to make her a dispatcher or an admin. |
| **Expected UI result** | The governed capability system exists and is live for other surfaces, but has nothing to grant here. |
| **Expected audit result** | The grant that actually happens is a role change, which carries far more than read. |
| **Expected cross-object effect** | Granting dispatcher to see Work Orders also grants Schedule, Dispatch, Close, Cancel and MarkReady - across both operating companies. |
| **Exception / recovery** | Least privilege is unreachable for this role. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/ai/workOrderContext.ts:19`<br>`firestore.rules:507-508`<br>`functions/src/transitionEngine.ts:128-143`<br>`field-ops-app-vite/src/access/useGovernedCapabilities.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Read-only Work Order access cannot be granted. The only route to visibility is a role that also confers full lifecycle write authority over both operating companies' jobs. |

</details>

### P3B1-S18 — Interruptions: back buttons, half-finished flows and the work that vanishes

**Account context.** Mixed

A service coordinator is interrupted every four minutes and a technician every time a customer walks up. This story tests what survives an interruption in each of the domain's multi-step flows.

<details><summary>10 activities — P3B1-S18-A01 · P3B1-S18-A02 · P3B1-S18-A03 · P3B1-S18-A04 · P3B1-S18-A05 · P3B1-S18-A06 · P3B1-S18-A07 · P3B1-S18-A08 · P3B1-S18-A09 · P3B1-S18-A10</summary>

#### P3B1-S18-A01 — Abandon the four-step Work Order wizard at the equipment step

*Marisol Vega (service_coordinator) · taylor · DESKTOP · BACK_BUTTON_ABANDONED_FLOW, DESKTOP*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | Steps 1 and 2 complete: customer chosen, equipment selected; the phone rings. |
| **Business purpose** | The wizard is the longest flow in the service domain. |
| **Preconditions** | — The wizard is at step 2 of 4 |
| **Action** | Navigate away, then return. |
| **Expected EOS state transition** | No Work Order is created. Creation happens only at the final submit. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The entered steps are lost. Whether any draft persistence exists is UNPROVEN; the wizard holds an idempotency key holder for the eventual create, which protects against duplicate submission, not against abandonment. |
| **Expected audit result** | No event - correctly. |
| **Expected cross-object effect** | No woNumber is burned, because the number is allocated inside the creating transaction. |
| **Exception / recovery** | She re-enters everything. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | None - nothing was written. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrderWizard.jsx`<br>`field-ops-app-vite/src/domain/workOrderWizard.js (createIdempotencyKeyHolder)`<br>`functions/src/woNumbering.ts:38-42` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S18-A02 — Submit the wizard twice because the first submit was slow

*Marisol Vega (service_coordinator) · taylor · DESKTOP · RETRY_IDEMPOTENCY, DESKTOP*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | Step 4; she clicks Create twice. |
| **Business purpose** | The idempotency key exists precisely for this. |
| **Preconditions** | — The wizard is at the final step |
| **Action** | Click Create twice. |
| **Expected EOS state transition** | One Work Order. The idempotency key holder makes the second submit a replay. |
| **Expected authority / capability** | workOrder.create. |
| **Expected UI result** | One confirmation, one woNumber. |
| **Expected audit result** | One creation event. |
| **Expected cross-object effect** | One counter increment, one woNumber. |
| **Exception / recovery** | If the key is regenerated between attempts, the protection is lost - one key per attempt is the contract. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Delete the created WO; leave the counter advanced. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/domain/workOrderWizard.js`<br>`functions/src/createWorkOrder.ts:155-170 (replay returns the existing WO)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S18-A03 — Close the placement dialog without confirming

*Dale Brackett (dispatcher) · taylor · DESKTOP · BACK_BUTTON_ABANDONED_FLOW, DESKTOP*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | A card is dragged into a lane; the dialog is open. |
| **Business purpose** | A drag that opens a dialog must not be a commitment. |
| **Preconditions** | — The placement dialog is open |
| **Action** | Dismiss the dialog. |
| **Expected EOS state transition** | None. The Work Order stays in READY_TO_DISPATCH. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The card should return to the queue, not stay drawn in the lane. |
| **Expected audit result** | No event. |
| **Expected cross-object effect** | Both drag-and-drop and keyboard/touch placement funnel through the same dialog, so both abandon identically. |
| **Exception / recovery** | A card left drawn in a lane it was never placed in is a lie the board tells until refresh. |
| **AI opportunity** | `NOISE` — AI would be noise here; the task is already one deliberate act. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/PlacementDialog.jsx (one confirm path for drag and keyboard/touch)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S18-A04 — Abandon the install closeout flow between its two steps

*Curtis Nally (field_technician) · taylor · MOBILE · BACK_BUTTON_ABANDONED_FLOW, MOBILE, RETRY_IDEMPOTENCY*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | The install step succeeded; the completion step has not run. |
| **Business purpose** | A two-step flow with a hard dependency is the sharpest abandonment case in the app. |
| **Preconditions** | — The install has been recorded |
| **Action** | Close the app between the two steps. |
| **Expected EOS state transition** | The equipment install stands; the Work Order does not complete. |
| **Expected authority / capability** | Both steps carry idempotency keys - a retry replays and returns the SAME Equipment rather than creating a second one. |
| **Expected UI result** | On return, the flow must recognise the install already happened. |
| **Expected audit result** | An install event with no completion. |
| **Expected cross-object effect** | The offline queue encodes EQUIPMENT_INSTALL to WORK_ORDER_COMPLETE as a hard required dependency, so the ordering is explicit even offline. |
| **Exception / recovery** | Without the idempotency key, resuming would install a second unit at the customer - which is why the flow is confirm-before-permanent. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'The machine is already installed - you only need to finish the job.' |
| **Reset / replay** | Reset the equipment and the WO together. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/EquipmentInstallCloseout.jsx (two-step, idempotency key per attempt)`<br>`field-ops-app-vite/src/offline/intentQueue.js`<br>`field-ops-app-vite/src/modules/equipment/InstallAtCustomer.jsx (confirm-before-permanent)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S18-A05 — Half-record a parts entry and walk away

*Curtis Nally (field_technician) · taylor · MOBILE · BACK_BUTTON_ABANDONED_FLOW, MOBILE, MISSING_DATA*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | The source picker is open with no selection made. |
| **Business purpose** | A customer interrupting mid-entry is the normal case. |
| **Preconditions** | — A positive delta is pending a source choice |
| **Action** | Navigate away. |
| **Expected EOS state transition** | Nothing is recorded. The client refuses a positive delta without a resolved source, and there is no local optimistic state to leave behind. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The counter shows the server's quantity, which is unchanged - so the screen never lies about what was recorded. |
| **Expected audit result** | No event. |
| **Expected cross-object effect** | The part is physically fitted and not recorded, which is the real-world loss. |
| **Exception / recovery** | Nothing reminds him. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:184-189 (no local optimistic state, no second source of truth)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S18-A06 — Start an inbound accept, open the candidate picker, and abandon it

*Marisol Vega (service_coordinator) · taylor · DESKTOP · BACK_BUTTON_ABANDONED_FLOW, HANDOFF, DESKTOP*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | A NEEDS_REVIEW request with the candidate list open. |
| **Business purpose** | Ambiguous resolution is exactly where a coordinator stops to go and ask someone. |
| **Preconditions** | — The request is decidable<br>— Candidates are ambiguous |
| **Action** | Abandon the flow. |
| **Expected EOS state transition** | The request stays in NEEDS_REVIEW. No Work Order is created. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The row returns to the queue unchanged. |
| **Expected audit result** | No event. |
| **Expected cross-object effect** | Nothing records that she looked at it and could not decide, so the next coordinator starts from zero. |
| **Exception / recovery** | The queue has no in-progress state between decidable and decided. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | None. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:50-53` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The inbound queue has no in-progress or owned state, so investigation effort is invisible and repeated. |

#### P3B1-S18-A07 — Reload the board mid-morning and lose the activity feed

*Dale Brackett (dispatcher) · taylor · DESKTOP · BACK_BUTTON_ABANDONED_FLOW, DESKTOP*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | Twelve board actions this session. |
| **Business purpose** | A browser reload is a routine event, not an exception. |
| **Preconditions** | — Board actions have occurred this session |
| **Action** | Reload the page. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The activity feed is session-only and empties. |
| **Expected audit result** | The durable audit events remain, on a surface the dispatcher does not use. |
| **Expected cross-object effect** | The dispatcher's working memory of the morning is gone. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Reload. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherActivityFeed.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S18-A08 — Have the phone die mid-completion with a queued intent

*Curtis Nally (field_technician) · taylor · MOBILE · NETWORK_INTERRUPTION, MOBILE, RECOVERY*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | A completion intent is queued; the battery dies. |
| **Business purpose** | Phones die at 16:00 on the fourth job. |
| **Preconditions** | — An unsent intent exists |
| **Action** | Power off and later power on. |
| **Expected EOS state transition** | The intent survives, because the local store is durable across sessions and namespaced per uid. |
| **Expected authority / capability** | Evaluated on eventual send. |
| **Expected UI result** | The sync queue shows it again. |
| **Expected audit result** | None until it sends. |
| **Expected cross-object effect** | If he signs in on a different device, the intent is on the dead phone and nowhere else. |
| **Exception / recovery** | A phone lost or destroyed takes the unsent work with it, and the store is not encrypted. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Clear the store. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | recovery unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/offline/localIntentStore.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Queued technician work is device-local and unencrypted; a lost or wiped phone loses it permanently, and nothing in the office knows it existed. |

#### P3B1-S18-A09 — Abandon a close halfway through a batch of twelve

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · BACK_BUTTON_ABANDONED_FLOW, BULK, DESKTOP*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | Six closed, six not. |
| **Business purpose** | Batch work is always interrupted. |
| **Preconditions** | — Twelve COMPLETED WOs |
| **Action** | Close six, then stop. |
| **Expected EOS state transition** | Six COMPLETED -> CLOSED transitions stand. |
| **Expected authority / capability** | Close. |
| **Expected UI result** | No batch state exists, so there is nothing to resume - she re-filters and sees six remaining, which is adequate. |
| **Expected audit result** | Six events. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | This is the case where the absence of a batch abstraction is harmless, and it is worth recording as such. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S18-A10 — Lose an equipment edit because the session expired

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · BACK_BUTTON_ABANDONED_FLOW, EXCEPTION, DESKTOP*

**Account context.** Mixed

| | |
| --- | --- |
| **Starting records / state** | An equipment edit modal open for twenty minutes. |
| **Business purpose** | Sessions expire while coordinators are on the phone. |
| **Preconditions** | — The modal is open with unsaved changes |
| **Action** | Submit after the session expires. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Denied. The correct behaviour is a re-authentication prompt that preserves the input, not a silent failure. |
| **Expected UI result** | UNPROVEN whether the input survives. The field primitive wires errors through aria-describedby, so an auth failure should at least be announced accessibly. |
| **Expected audit result** | No write. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | Losing a twenty-minute edit to an expiry is a small disaster repeated daily. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Expire the session. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/shared/ui/form/Field.jsx`<br>`field-ops-app-vite/src/shared/ui/form/fieldA11y.js:15` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S19 — 22:40 - the after-hours call: an ice plant down before a Wednesday delivery

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

Ken carries the on-call phone. The plant manager calls at 22:40: the primary tube-ice machine is down and 40,000 lb of ice ships Wednesday morning. Everything Ken can do between 22:40 and midnight is constrained by a permission model designed around office hours, on a phone, with no dispatcher awake.

<details><summary>10 activities — P3B1-S19-A01 · P3B1-S19-A02 · P3B1-S19-A03 · P3B1-S19-A04 · P3B1-S19-A05 · P3B1-S19-A06 · P3B1-S19-A07 · P3B1-S19-A08 · P3B1-S19-A09 · P3B1-S19-A10</summary>

#### P3B1-S19-A01 — Create an emergency Work Order from a phone at 22:40

*Ken Iwata (after_hours_coordinator) · taylor · MOBILE · AFTER_HOURS, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | No Work Order exists. Ken is on a phone in his kitchen. |
| **Business purpose** | An emergency must become a governed record even when the office is shut. |
| **Preconditions** | — Ken holds workOrder.create<br>— The account and equipment exist |
| **Action** | Create a SERVICE_CALL Work Order, severity EQUIPMENT_DOWN, priority 1 (Emergency). |
| **Expected EOS state transition** | New Work Order in CREATED. |
| **Expected authority / capability** | workOrder.create. The Work Order wizard route is gated on this capability. |
| **Expected UI result** | The four-step wizard on a phone at night. Whether the wizard is usable at phone width is UNPROVEN by this lane and is worth executing - the technician shell is phone-designed, the Work Order wizard is not. |
| **Expected audit result** | A creation event timestamped 22:41 by the server clock. |
| **Expected cross-object effect** | The counter increments; a woNumber is allocated. |
| **Exception / recovery** | If the wizard is not phone-usable, the on-call coordinator writes it on paper and enters it at 07:00, and the emergency has no record for nine hours. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Delete the WO; leave the counter advanced. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrderWizard.jsx`<br>`field-ops-app-vite/src/App.jsx:1044-1052`<br>`functions/src/types/workOrder.ts:28-36` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The Work Order creation wizard is a desktop four-step flow with no phone-designed equivalent, while the after-hours coordinator who most needs it is always on a phone. |

#### P3B1-S19-A02 — Try to mark the emergency Work Order ready and dispatch it himself

*Ken Iwata (after_hours_coordinator) · taylor · MOBILE · AFTER_HOURS, PERMISSION_DENIAL, HANDOFF, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | WO in CREATED at 22:43. |
| **Business purpose** | At 22:43 there is nobody else. |
| **Preconditions** | — Ken's legacy role is not admin or dispatcher |
| **Action** | Invoke MarkReady, then Schedule, then Dispatch. |
| **Expected EOS state transition** | All three refused if he lacks the dispatcher role. If the on-call coordinator IS given the dispatcher role to work around this, he holds it at 10:00 on a Tuesday too. |
| **Expected authority / capability** | MarkReady, Schedule and Dispatch are all admin/dispatcher, with no time-of-day or on-call dimension. |
| **Expected UI result** | The actions are simply absent. |
| **Expected audit result** | Nothing. |
| **Expected cross-object effect** | The practical outcome is that every on-call coordinator is permanently a dispatcher, which is a standing over-grant created by an after-hours gap. |
| **Exception / recovery** | He phones a dispatcher at home. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Vary the role. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:129,134,135` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | There is no on-call or time-bounded authority. Covering after hours requires a permanent dispatcher grant, so the access model's answer to nights is a standing over-privilege. |

#### P3B1-S19-A03 — Find out which technician is actually on call tonight

*Ken Iwata (after_hours_coordinator) · taylor · MOBILE · AFTER_HOURS, MISSING_DATA, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | Five technicians; one is on the rota. |
| **Business purpose** | The on-call rota is the single most important fact at 22:45. |
| **Preconditions** | — A rota exists somewhere |
| **Action** | Look for on-call information in EOS. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The blocked-time kinds are PTO, LUNCH, TRAINING, MEETING, TRUCK_SERVICE, UNAVAILABLE and COMPANY_CLOSURE. None of them expresses 'on call'. Technician status is available/on_job/off_shift. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | An on-call technician is not 'available' in any sense the model records, and marking them available would put them in the recommendation engine's ranking for daytime work. |
| **Exception / recovery** | The rota lives in a group chat. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/scheduling/types.ts:62-69`<br>`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:19` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | On-call has no representation: not a blocked-time kind, not a technician status, not a schedule. The rota lives entirely outside EOS. |

#### P3B1-S19-A04 — Try to schedule the emergency for 23:30 tonight

*Ken Iwata (after_hours_coordinator) · taylor · MOBILE · AFTER_HOURS, NORMAL, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | WO in READY_TO_DISPATCH (assume a dispatcher was woken). |
| **Business purpose** | Night work is outside every recorded working-hours window. |
| **Preconditions** | — Working availability is recorded for the technician as 07:00-16:00 |
| **Action** | Schedule 23:30-02:30. |
| **Expected EOS state transition** | SCHEDULED, with an OUTSIDE_WORKING_HOURS warning naming the full 180 minutes. |
| **Expected authority / capability** | Schedule. Outside working hours is a warning, never a refusal - which is exactly right for emergency work. |
| **Expected UI result** | A warning that is correct and unhelpful: every legitimate night call produces it. |
| **Expected audit result** | The warning rides with the transition. |
| **Expected cross-object effect** | A window crossing local midnight is measured against each day's own intervals, so the two halves are assessed separately and correctly. |
| **Exception / recovery** | Warning fatigue: a signal that fires on every after-hours job stops being a signal. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | An emergency severity should suppress or reframe this warning. |
| **Reset / replay** | Unschedule. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | unnecessary explanation permanently occupies the page |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:142-169`<br>`functions/src/scheduling/availabilityModel.ts:242-250` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Every after-hours emergency produces an OUTSIDE_WORKING_HOURS warning, so the warning carries no information on exactly the jobs where a genuine anomaly would matter most. |

#### P3B1-S19-A05 — Accept an emergency dispatch at 23:05 from bed

*Javier Ochoa (field_technician) · taylor · MOBILE · AFTER_HOURS, MOBILE, NORMAL*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | WO DISPATCHED to Javier at 23:03. |
| **Business purpose** | The technician half of the lifecycle has no time-of-day dimension, which is correct. |
| **Preconditions** | — The WO is dispatched to him |
| **Action** | Accept, Travel. |
| **Expected EOS state transition** | DISPATCHED -> ACCEPTED -> EN_ROUTE. |
| **Expected authority / capability** | Accept and Travel: technician, own assignment. |
| **Expected UI result** | Identical to a daytime job. |
| **Expected audit result** | acceptedAt and enRouteAt at 23:05 and 23:12. |
| **Expected cross-object effect** | Nothing distinguishes callout hours from regular hours anywhere in the record, so overtime and callout premiums cannot be derived from the Work Order. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:138-139` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Callout and overtime premiums are underivable from the Work Order: no rate, shift or callout concept exists, only timestamps. |

#### P3B1-S19-A06 — Need a part at 23:40 with the warehouse locked

*Javier Ochoa (field_technician) · taylor · MOBILE · AFTER_HOURS, MISSING_DATA, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | ARRIVED at the plant; the failed component is not on the truck. |
| **Business purpose** | Night parts access is the constraint that decides whether the ice ships. |
| **Preconditions** | — The needed part is not on the truck |
| **Action** | Check what sources are offered. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Active warehouses plus his own truck are offered regardless of the hour - the source list has no notion of whether a building is open. |
| **Expected UI result** | He is offered a warehouse he cannot physically enter. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | If he records a consumption from a warehouse he could not enter, the record is false in a way nothing can detect. |
| **Exception / recovery** | He borrows from another technician's truck, which has no representation at all. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:45-56 (active warehouses, no hours concept)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Technician-to-technician parts transfer has no representation, so night-time borrowing from a colleague's truck is recorded as something it was not. |

#### P3B1-S19-A07 — Tell the customer what time the technician will arrive

*Ken Iwata (after_hours_coordinator) · taylor · MOBILE · AFTER_HOURS, MISSING_DATA, MOBILE*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | Javier is en route at 23:12. |
| **Business purpose** | The plant manager is waiting to decide whether to call in a night crew. |
| **Preconditions** | — The WO is EN_ROUTE |
| **Action** | Look for the technician's position or ETA. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | EN_ROUTE is a claim, not a position. No location is captured at any transition. |
| **Expected audit result** | enRouteAt is the only fact. |
| **Expected cross-object effect** | Nothing supports an ETA. |
| **Exception / recovery** | Ken phones Javier while Javier is driving. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:92-99 (timestamps only, no location)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S19-A08 — Complete the job at 02:15 and leave

*Javier Ochoa (field_technician) · taylor · MOBILE · AFTER_HOURS, MOBILE, END_OF_DAY*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS since 23:45. |
| **Business purpose** | The record must be finished before he sleeps or it never will be. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Record the note and parts, then Complete. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED at 02:15. |
| **Expected authority / capability** | Complete: technician, own assignment. |
| **Expected UI result** | Identical to a daytime completion. |
| **Expected audit result** | completedAt 02:15. |
| **Expected cross-object effect** | The Work Order now spans two calendar days, which matters for any day-based reporting. |
| **Exception / recovery** | If he does it in the morning instead, completedAt is 07:30 and the night's work is attributed to the wrong day. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:142`<br>`functions/src/transitionEngine.ts:82-88` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S19-A09 — Pick up the night's work at 06:45 the next morning

*Marisol Vega (service_coordinator) · taylor · DESKTOP · AFTER_HOURS, HANDOFF, END_OF_DAY, DESKTOP*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | One COMPLETED emergency Work Order from 02:15 and a voicemail. |
| **Business purpose** | The morning handoff from on-call is where after-hours work is either finished or lost. |
| **Preconditions** | — The overnight WO is COMPLETED |
| **Action** | Look for a view of what happened overnight. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether any 'what happened since you left' view exists. The dispatcher activity feed is session-only and therefore empty. |
| **Expected audit result** | The audit events exist and are the true record, on a surface coordinators do not use. |
| **Expected cross-object effect** | Ken's decisions, the customer conversation and the reason a night crew was or was not called live nowhere. |
| **Exception / recovery** | She reads the note and phones Ken. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed an overnight WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherActivityFeed.jsx (session-only)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | There is no overnight handoff view. The morning team reconstructs the night from a completed Work Order and a phone call. |

#### P3B1-S19-A10 — Bill the after-hours call at the right rate

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · AFTER_HOURS, END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** Desert Ice & Cold Storage, Tolleson - Vogt P24AL #1 tripped and will not restart

| | |
| --- | --- |
| **Starting records / state** | A COMPLETED Work Order with timestamps spanning 23:03 to 02:15. |
| **Business purpose** | After-hours rates are the difference between profit and loss on emergency work. |
| **Preconditions** | — The WO is COMPLETED |
| **Action** | Determine the billable hours and the applicable rate. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | She has arrivedAt, workStartedAt and completedAt, and nothing else. No labour entry exists because the labour capability is fail-closed. |
| **Expected audit result** | The timestamps are trustworthy - server clock, immutable. |
| **Expected cross-object effect** | Elapsed on-site time is not billable labour, and nothing in the record distinguishes them. |
| **Exception / recovery** | She reconstructs it from the technician's paper timesheet. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed the overnight WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/JobLabor.jsx (capability inactive)`<br>`functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`MANUAL_CONFIGURATION`) — Billable labour cannot be exercised at all while the labour capability is inactive.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S20 — The job that does not finish today - parts on order and the second visit

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

Half of all service calls in this business need a second visit. The lifecycle has eleven statuses and none of them means 'waiting for a part'. This story follows what a coordinator and a technician actually do with a job that cannot be finished.

<details><summary>10 activities — P3B1-S20-A01 · P3B1-S20-A02 · P3B1-S20-A03 · P3B1-S20-A04 · P3B1-S20-A05 · P3B1-S20-A06 · P3B1-S20-A07 · P3B1-S20-A08 · P3B1-S20-A09 · P3B1-S20-A10</summary>

#### P3B1-S20-A01 — Diagnose a fault whose part is not on the truck or in the warehouse

*Curtis Nally (field_technician) · taylor · MOBILE · EXCEPTION, MISSING_DATA, MOBILE*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS; the beater motor must be ordered. |
| **Business purpose** | Diagnosis complete, repair impossible, is the most common partial outcome. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Look for a status or action meaning 'parts required'. |
| **Expected EOS state transition** | None. His vocabulary is Accept, Travel, Arrive, WorkStart and Complete. |
| **Expected authority / capability** | The technician action set has no deferral verb. |
| **Expected UI result** | His only forward action is Complete, which would assert the work is done. |
| **Expected audit result** | Whatever he does is the record. |
| **Expected cross-object effect** | The Work Order lifecycle has no AWAITING_PARTS, ON_HOLD or SUSPENDED status - the eleven statuses run CREATED through CLOSED with no branch for waiting. |
| **Exception / recovery** | He completes it and the office creates a second Work Order, or he leaves it open indefinitely. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/types/workOrder.ts:15-26 (the eleven statuses)`<br>`functions/src/transitionEngine.ts:39-51` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No waiting-for-parts state exists in the Work Order lifecycle, so every multi-visit repair - roughly half of real service work - must be misrepresented as either complete or indefinitely in progress. |

#### P3B1-S20-A02 — Complete the first visit knowing the machine is still down

*Curtis Nally (field_technician) · taylor · MOBILE · MISTAKE, EXCEPTION, MOBILE*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS; diagnosis done, repair not. |
| **Business purpose** | He completes because it is the only button. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Tap Complete with a note saying the motor is on order. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED. |
| **Expected authority / capability** | Complete. |
| **Expected UI result** | The job reads as finished on every surface. |
| **Expected audit result** | completedAt recorded with no outcome dimension, so 'completed' and 'fixed' are indistinguishable. |
| **Expected cross-object effect** | First-time-fix, were it measurable, would count this as a fix. The scorecard shows first-time-fix as visibly empty precisely because it cannot be computed. |
| **Exception / recovery** | The customer's machine is still down and the system says the job is complete. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:142`<br>`field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx`<br>`field-ops-app-vite/src/modules/workOrders/WorkOrderDetailPage.jsx:268` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A completed Work Order on a machine that is still down is indistinguishable from a successful repair, which makes every service-quality metric meaningless. |

#### P3B1-S20-A03 — Order the part and link it to the job

*Marisol Vega (service_coordinator) · taylor · DESKTOP · HANDOFF, MISSING_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | The first-visit WO is COMPLETED; a beater motor must be procured. |
| **Business purpose** | The link between a job and the part it is waiting for is what makes the second visit schedulable. |
| **Preconditions** | — The part is not in stock |
| **Action** | Raise the procurement and look for a way to tie it back to the Work Order. |
| **Expected EOS state transition** | None to the Work Order. |
| **Expected authority / capability** | Procurement authority, separate from service. |
| **Expected UI result** | UNPROVEN whether a Work Order can reference a purchase or reorder request in a way the service surfaces show. A parts plan expresses demand, not a live order. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | The parts plan is planning, not reserving and not ordering - three separate acts. |
| **Exception / recovery** | She writes the WO number in the purchase note and watches for the delivery herself. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `DESIRED` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrderPartsPlanEditor.jsx (PLAN != RESERVE != USE)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S20-A04 — Create the second-visit Work Order

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, DUPLICATE_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | The part arrives nine days later. |
| **Business purpose** | Nine days later, somebody must remember. |
| **Preconditions** | — The part has arrived |
| **Action** | Create a new SERVICE_CALL Work Order for the same equipment. |
| **Expected EOS state transition** | A new Work Order in CREATED with a new woNumber. |
| **Expected authority / capability** | workOrder.create. |
| **Expected UI result** | Nothing links it to the first visit. There is no parent, follow-up or related-Work-Order reference in the model. |
| **Expected audit result** | A fresh creation event with no reference to the first. |
| **Expected cross-object effect** | The customer now has two Work Order numbers for one fault, and the equipment timeline shows two unrelated visits. |
| **Exception / recovery** | If nobody remembers, the customer phones in week three. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Delete both WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/types/workOrder.ts (no parent or related-WO reference)`<br>`functions/src/createWorkOrder.ts:78-100` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No Work Order can reference another, so a multi-visit repair fragments into unrelated records and the equipment history shows repeated independent failures rather than one unresolved fault. |

#### P3B1-S20-A05 — Find the nine-day-old completed Work Order to copy its diagnosis into the new one

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, DUPLICATE_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | Creating the second visit. |
| **Business purpose** | The second technician needs the first technician's findings. |
| **Preconditions** | — The first WO is CLOSED |
| **Action** | Search for the earlier Work Order. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read, gated by the workOrder.create route gate. |
| **Expected UI result** | She searches by customer, reads the note, and copies it by hand. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The copy is now duplicated text that will diverge. |
| **Exception / recovery** | If she does not copy it, the second technician arrives without the diagnosis. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a closed prior WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrdersList.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S20-A06 — Schedule the second visit for the same technician who did the first

*Dale Brackett (dispatcher) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | The second WO is READY_TO_DISPATCH. |
| **Business purpose** | Continuity is worth more than any score. |
| **Preconditions** | — The second WO exists |
| **Action** | Look for an indication of who did the first visit. |
| **Expected EOS state transition** | None until placed. |
| **Expected authority / capability** | Schedule. |
| **Expected UI result** | Nothing on the card connects the two visits. The recommendation engine scores experience affinity by Work Order TYPE, not by this equipment or this customer. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | A technician who has been to this exact machine gets no affinity credit for it. |
| **Exception / recovery** | Dale remembers, or he does not. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed prior WOs on the same equipment. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:94-110 (affinity is by type, not by equipment or account)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Experience affinity is scored by Work Order type only, so 'has been to this machine' and 'has worked this customer' carry no weight in the recommendation. |

#### P3B1-S20-A07 — Arrive for the second visit without the first visit's findings

*Javier Ochoa (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, MISSING_DATA, MOBILE*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | The second WO is ARRIVED; Javier, not Curtis, is assigned. |
| **Business purpose** | The technician is the person who needs the history and the person least able to get it. |
| **Preconditions** | — A prior Work Order exists on the same equipment |
| **Action** | Look for the earlier diagnosis. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | He can read only Work Orders assigned to him. The first visit was Curtis's, so it is invisible to him. The equipment timeline is on a route he cannot open. |
| **Expected UI result** | Nothing. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The scoping rule that correctly protects Work Order privacy also blocks the most useful thing a technician could read. |
| **Exception / recovery** | He phones Curtis. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed two WOs on one machine with different technicians. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear |
| **Evidence** | `firestore.rules:507-508`<br>`firestore.rules:1362-1370` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Technician Work Order scoping blocks a technician from reading any prior visit to the same machine performed by a colleague, which is the single most useful piece of context for a return visit. |

#### P3B1-S20-A08 — Count how many jobs needed a second visit last month

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | A month of completed Work Orders. |
| **Business purpose** | Second-visit rate is the headline service-quality number. |
| **Preconditions** | — A month of Work Orders exists |
| **Action** | Attempt the count. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | There is no link between visits, no outcome on completion and no follow-up flag. The count cannot be computed - only inferred by matching equipment and dates by eye. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The performance goal registry carries a readyToSchedule count metric; nothing comparable exists for repeat visits. |
| **Exception / recovery** | She estimates. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month of WOs with repeat visits. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/performance/performanceMetricRegistry.ts:217`<br>`field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Second-visit rate is structurally unmeasurable: no visit linkage, no completion outcome, no follow-up flag. |

#### P3B1-S20-A09 — Explain to the customer why they have two Work Order numbers

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | The customer has received two references for one broken machine. |
| **Business purpose** | The record's shape becomes the customer's experience. |
| **Preconditions** | — Two WOs exist for one fault |
| **Action** | Explain, and look for a way to present them as one. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | There is no grouping. A coordinated visit concept exists for Work Orders sharing one Sales Order, and it deliberately does NOT merge them into one record - but that concept keys off a Sales Order, not a repeat fault. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The nearest existing abstraction solves a different problem. |
| **Exception / recovery** | She explains it verbally every time. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/modules/service/CoordinatedVisitsWorkspace.jsx (groups by Sales Order, does not merge)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S20-A10 — Bill one fault that produced two Work Orders

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · END_OF_MONTH, HANDOFF, DESKTOP*

**Account context.** Sonoran Scoops Creamery - Chandler - Taylor C713: beater motor seized, part not stocked

| | |
| --- | --- |
| **Starting records / state** | Two Work Orders, one customer expectation of one invoice. |
| **Business purpose** | The billing shape and the record shape disagree. |
| **Preconditions** | — Two closed WOs for one fault |
| **Action** | Close both and prepare the billing. |
| **Expected EOS state transition** | Two COMPLETED -> CLOSED transitions. |
| **Expected authority / capability** | Close, twice. |
| **Expected UI result** | Two independent records. |
| **Expected audit result** | Two closedAt timestamps. |
| **Expected cross-object effect** | Whether the customer is charged one trip charge or two is a decision with no support in the data. |
| **Exception / recovery** | She merges them by hand in the billing system. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S21 — 14:20 - handing a job over: the transfer EOS cannot express

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

Curtis has been on a convention centre ice machine for three hours and has to leave for a school pickup. Javier finishes it. Every real service business does this daily, and the lifecycle has no verb for it.

<details><summary>10 activities — P3B1-S21-A01 · P3B1-S21-A02 · P3B1-S21-A03 · P3B1-S21-A04 · P3B1-S21-A05 · P3B1-S21-A06 · P3B1-S21-A07 · P3B1-S21-A08 · P3B1-S21-A09 · P3B1-S21-A10</summary>

#### P3B1-S21-A01 — Try to hand an in-progress job to another technician

*Curtis Nally (field_technician) · taylor · MOBILE · HANDOFF, MISSING_DATA, MOBILE*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS, assignedTechId is Curtis. |
| **Business purpose** | Handoff is the ordinary shape of a long job or a shift change. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Look for a reassign or hand-over action. |
| **Expected EOS state transition** | None. His action set in WORK_IN_PROGRESS is Complete and nothing else. |
| **Expected authority / capability** | Technicians hold Accept, Travel, Arrive, WorkStart and Complete only, and each requires own assignment. |
| **Expected UI result** | No handoff affordance exists. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | Dispatch cannot help either: Dispatch's only legal source is SCHEDULED, and WORK_IN_PROGRESS has no reverse edge. |
| **Exception / recovery** | The only representable options are complete-and-recreate or cancel-and-recreate. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:138-142`<br>`functions/src/transitionEngine.ts:42-47`<br>`functions/src/transitionEngine.ts:152-172` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A Work Order cannot be transferred between technicians once dispatched. Shift-change and mid-job handoff, which happen daily, have no representation and must be faked by completing or cancelling the record. |

#### P3B1-S21-A02 — Try to reassign the in-progress job from the dispatcher board

*Dale Brackett (dispatcher) · taylor · DESKTOP · HANDOFF, PERMISSION_DENIAL, DESKTOP*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS on Curtis. |
| **Business purpose** | If the technician cannot hand over, perhaps the dispatcher can. |
| **Preconditions** | — Dale holds dispatcher |
| **Action** | Look for a reassign action on the Work Order. |
| **Expected EOS state transition** | None available. Dispatch is legal only from SCHEDULED. |
| **Expected authority / capability** | Dale holds Dispatch, but the edge does not exist from WORK_IN_PROGRESS, so the transition check disposes of it before the role check. |
| **Expected UI result** | The Work Order detail page carries a deliberately disabled placeholder for related actions, with a title= explaining it is not available yet and is not a permission limit - which is honest and correct practice. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | Cancelling and recreating loses the arrivedAt, workStartedAt and three hours of execution data. |
| **Exception / recovery** | Dale tells Javier verbally and the record stays on Curtis. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The existing disabled-placeholder-with-explanation pattern is the right home for this. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:42-47`<br>`field-ops-app-vite/src/modules/workOrders/WorkOrderDetailPage.jsx:289-305` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S21-A03 — Work a job that is assigned to someone else

*Javier Ochoa (field_technician) · taylor · MOBILE · PERMISSION_DENIAL, HANDOFF, MOBILE*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | Javier physically finishes the machine; the WO is Curtis's. |
| **Business purpose** | The physical world does not wait for the data model. |
| **Preconditions** | — The WO is assigned to Curtis |
| **Action** | Open the job on his phone. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Denied. He cannot read it, because the read gate compares assignedTechId to his own technicianId. |
| **Expected UI result** | The job is not in his list. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | He works blind, with no access to the parts plan, the note or the customer detail. |
| **Exception / recovery** | Curtis reads it to him over the phone. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `firestore.rules:507-508` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S21-A04 — Complete the job from the car park on Javier's word

*Curtis Nally (field_technician) · taylor · MOBILE · HANDOFF, BAD_DATA, MOBILE*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | Javier reports by phone that the machine runs. |
| **Business purpose** | When the model blocks the honest path, users take the dishonest one. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Tap Complete. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED with a completedAt. |
| **Expected authority / capability** | Complete: his job, his authority, his tap. |
| **Expected UI result** | Nothing distinguishes this from work he performed. |
| **Expected audit result** | The audit trail says Curtis completed the work. It is wrong, and it is the only record. |
| **Expected cross-object effect** | Javier's labour is unattributed. Curtis's productivity is overstated. The technician performance scorecard's productivity figure is built on exactly this data. |
| **Exception / recovery** | There is no recovery because nothing failed. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:142`<br>`field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx (productivity populated from this data)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The absence of a handoff verb produces falsified attribution: the completing technician is recorded as the performing technician, and the productivity metric is computed from it. |

#### P3B1-S21-A05 — Cancel and recreate as the 'correct' handoff

*Dale Brackett (dispatcher) · taylor · DESKTOP · HANDOFF, RECOVERY, BAD_DATA, DESKTOP*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS on Curtis with three hours of execution data. |
| **Business purpose** | This is the only representable handoff, and it is expensive. |
| **Preconditions** | — The WO is in an active status |
| **Action** | Cancel, then create a new Work Order for Javier. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> CANCELLED (terminal), plus a new WO in CREATED. |
| **Expected authority / capability** | Cancel and workOrder.create, both dispatcher-side. |
| **Expected UI result** | Two records where there was one. |
| **Expected audit result** | A cancellation with a workStartedAt on it, and a creation with none of the history. |
| **Expected cross-object effect** | A new woNumber is burned. Parts already consumed sit on the cancelled Work Order. The customer's three hours of work are attached to a record marked cancelled. |
| **Exception / recovery** | Parts consumption on a cancelled Work Order - whether it reverses, stands, or is orphaned - is UNPROVEN by this lane and is worth executing. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:47,50,137`<br>`functions/src/createWorkOrder.ts:78-100` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Parts consumed on a Work Order that is subsequently cancelled have no defined disposition; the inventory movement has already happened against a record that now says nothing was done. |

#### P3B1-S21-A06 — Accept a newly created Work Order for the second half of a job

*Javier Ochoa (field_technician) · taylor · MOBILE · HANDOFF, BAD_DATA, MOBILE*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | A new WO created at 14:30 for the same machine. |
| **Business purpose** | The recreated job must at least be workable. |
| **Preconditions** | — The new WO is dispatched to him |
| **Action** | Accept, Travel, Arrive, WorkStart. |
| **Expected EOS state transition** | Four transitions, producing an enRouteAt for a journey he did not make and an arrivedAt for a place he was already standing in. |
| **Expected authority / capability** | All four: technician, own assignment. |
| **Expected UI result** | He must tap through a travel sequence for a building he is inside. |
| **Expected audit result** | Four timestamps that describe a fiction. |
| **Expected cross-object effect** | Drive-time analytics gain a zero-second journey; response-time analytics gain an instant arrival. |
| **Exception / recovery** | Skipping the sequence is impossible - the transition table requires each step. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:43-47 (no skips; each step is a distinct edge)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The lifecycle has no way to start a Work Order at the customer's site, so every continuation job manufactures false travel and arrival timestamps. |

#### P3B1-S21-A07 — Attribute the day's work to the right technicians

*Priya Raman (service_manager) · taylor · DESKTOP · HANDOFF, MISSING_DATA, BAD_DATA, DESKTOP*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | Two technicians, one machine, one afternoon, one or two Work Orders depending on the route taken. |
| **Business purpose** | Attribution is what pay, scheduling and performance all rest on. |
| **Preconditions** | — A handoff occurred by one of the two available routes |
| **Action** | Determine who did what. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Either one Work Order attributing everything to Curtis, or two Work Orders with fabricated travel on the second. |
| **Expected audit result** | Faithful records of two different fictions. |
| **Expected cross-object effect** | A Work Order holds exactly one assignedTechId. There is no multi-technician concept anywhere. |
| **Exception / recovery** | Two technicians on one job - routine for an install or a heavy lift - is unrepresentable even without a handoff. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · ownership unclear |
| **Evidence** | `functions/src/types/workOrder.ts (a single assignedTechId)`<br>`functions/src/transitionEngine.ts:89-91` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A Work Order supports exactly one technician, so two-technician jobs - installs, heavy lifts, training ride-alongs - cannot be represented at all. |

#### P3B1-S21-A08 — Ride along with a senior technician for training

*Wes Tanner (apprentice_technician) · taylor · MOBILE · MISSING_DATA, UNUSUAL_BUT_LEGITIMATE, MOBILE*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | Wes accompanies Javier all day; the Work Orders are Javier's. |
| **Business purpose** | Apprentice ride-alongs are how this trade trains. |
| **Preconditions** | — Wes is not assigned to any of the day's jobs |
| **Action** | Open his own jobs list. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | He can read only his own assignments, so he sees nothing all day. |
| **Expected UI result** | An empty list, indistinguishable from an unlinked account or a day off. |
| **Expected audit result** | No record that he was present on any job. |
| **Expected cross-object effect** | His training is invisible; his utilisation reads as zero. |
| **Exception / recovery** | A TRAINING blocked-time kind exists, which would at least mark the day - but marking it blocks him from being scheduled, which is correct, and still records nothing about what he learned. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed an apprentice with no assignments. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · ownership unclear |
| **Evidence** | `firestore.rules:507-508`<br>`functions/src/scheduling/types.ts:62-69 (TRAINING is a blocked-time kind)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S21-A09 — Cover a technician who goes home sick at 11:00 with four jobs outstanding

*Dale Brackett (dispatcher) · taylor · DESKTOP · HANDOFF, BULK, EXCEPTION, RECOVERY, DESKTOP*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | Two DISPATCHED, one ACCEPTED, one WORK_IN_PROGRESS. |
| **Business purpose** | This is the handoff problem at scale and under time pressure. |
| **Preconditions** | — Four active Work Orders on one technician |
| **Action** | Redistribute them. |
| **Expected EOS state transition** | None of the four can be reassigned. All four must be cancelled and recreated. |
| **Expected authority / capability** | Cancel and create, four times each. |
| **Expected UI result** | Eight actions to move four jobs, with four new woNumbers and four lost histories. |
| **Expected audit result** | Four cancellations and four creations for one person going home ill. |
| **Expected cross-object effect** | Four customers get new Work Order numbers. The WORK_IN_PROGRESS one loses its execution data to a cancelled record. |
| **Exception / recovery** | In practice the dispatcher leaves them and phones the customers. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Seed four active WOs on one technician. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:39-51`<br>`functions/src/transitionEngine.ts:135,137` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A technician going home sick requires cancelling and recreating every active Work Order they hold. There is no bulk reassignment and no reassignment at all after Dispatch. |

#### P3B1-S21-A10 — Ask how often work is handed over

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** Camelback Convention Center - twin Manitowoc ice machines before a 2,000-cover banquet

| | |
| --- | --- |
| **Starting records / state** | A month of Work Orders. |
| **Business purpose** | If handoffs are frequent, the missing verb is a priority; if rare, it is not. |
| **Preconditions** | — A month of data |
| **Action** | Attempt to count handoffs. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Handoffs are invisible by construction - they appear either as ordinary completions or as cancellations with a workStartedAt. |
| **Expected audit result** | A cancellation carrying a workStartedAt is in fact a detectable signature of an abandoned or handed-over job, and is the closest thing to a measure available. |
| **Expected cross-object effect** | That signature would also catch the no-access and wrong-address cases, so it measures 'visits that did not finish' rather than handoffs specifically. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month including cancellations with workStartedAt. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:92-99`<br>`functions/src/transitionEngine.ts:47` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S22 — 17:20 - the dispatcher's end of day: what finished, what did not, what tomorrow inherits

**Account context.** Mixed Taylor and Ventana route

Dale closes the board. Eleven jobs went out, seven completed, two are still in progress, one was cancelled and one never left DISPATCHED. Tomorrow's day is built from what is left, and the board has no notion of a day ending.

<details><summary>10 activities — P3B1-S22-A01 · P3B1-S22-A02 · P3B1-S22-A03 · P3B1-S22-A04 · P3B1-S22-A05 · P3B1-S22-A06 · P3B1-S22-A07 · P3B1-S22-A08 · P3B1-S22-A09 · P3B1-S22-A10</summary>

#### P3B1-S22-A01 — Review every Work Order still in a non-terminal state at 17:20

*Dale Brackett (dispatcher) · taylor · DESKTOP · END_OF_DAY, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | 11 dispatched jobs across the day; 7 COMPLETED, 2 WORK_IN_PROGRESS, 1 CANCELLED, 1 DISPATCHED. |
| **Business purpose** | The end-of-day sweep is the last chance to catch a job that is quietly stuck. |
| **Preconditions** | — A full day of Work Orders exists |
| **Action** | Filter the board or the Work Orders list for non-terminal statuses. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Terminal statuses are COMPLETED, CLOSED and CANCELLED, so 'still open' is everything else - a filter the surfaces should support directly. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Every non-terminal Work Order with an assignedTechId also holds that technician in an occupying status, so tomorrow's dispatch to them is blocked until it clears. |
| **Exception / recovery** | A job left in DISPATCHED overnight silently blocks that technician's first dispatch tomorrow. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'Leaving this open blocks tomorrow's dispatch to this technician' is the consequence nobody is told. |
| **Reset / replay** | Seed a day's mix of statuses. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:53-57`<br>`functions/src/workOrderAvailability.ts:9-21` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A Work Order left in DISPATCHED overnight blocks all dispatch to that technician the next morning, and nothing at end of day surfaces the consequence. |

#### P3B1-S22-A02 — Chase the job that never left DISPATCHED

*Dale Brackett (dispatcher) · taylor · DESKTOP · END_OF_DAY, EXCEPTION, MISSING_DATA, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | WO DISPATCHED at 09:40, never accepted. |
| **Business purpose** | Seven and a half hours in DISPATCHED means something went wrong at 09:40. |
| **Preconditions** | — A WO has been DISPATCHED all day |
| **Action** | Determine what happened. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | dispatchedAt makes the age computable; whether any surface shows time-in-status is UNPROVEN. |
| **Expected audit result** | One event at 09:40 and nothing since. |
| **Expected cross-object effect** | The technician may have never seen it, may have no signal, or may have simply worked it without tapping anything. |
| **Exception / recovery** | The last possibility is the worst: the work was done and the record says it was not. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a stale DISPATCHED WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · no obvious "what next?" location · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S22-A03 — Leave two jobs in WORK_IN_PROGRESS overnight

*Dale Brackett (dispatcher) · taylor · DESKTOP · END_OF_DAY, NORMAL, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | Two technicians still on site at 17:20. |
| **Business purpose** | Jobs legitimately run past the end of a dispatcher's day. |
| **Preconditions** | — Two WOs in WORK_IN_PROGRESS |
| **Action** | Close the board and go home. |
| **Expected EOS state transition** | None. WORK_IN_PROGRESS persists. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The board simply reflects reality, which is correct. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | If the technician forgets to complete, the job accrues elapsed time all night and the technician remains occupied. |
| **Exception / recovery** | Nothing sweeps or prompts. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed WOs in progress. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:47`<br>`functions/src/workOrderAvailability.ts:9-21` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Nothing prompts a technician to complete a Work Order left in progress, so overnight WORK_IN_PROGRESS inflates every elapsed-time measure and blocks next-day dispatch. |

#### P3B1-S22-A04 — Look at tomorrow's board and see what is already committed

*Dale Brackett (dispatcher) · taylor · DESKTOP · END_OF_DAY, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | Six Work Orders scheduled for tomorrow. |
| **Business purpose** | Tomorrow starts today. |
| **Preconditions** | — Scheduled WOs exist for tomorrow |
| **Action** | Switch the board to tomorrow. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The same lane grid drawn for a different day. Blocked time and availability are re-evaluated for that date. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Today's unfinished jobs do not appear on tomorrow's board unless they are rescheduled, so the real load is spread across two views. |
| **Exception / recovery** | A technician with two overnight jobs and a full tomorrow looks free tomorrow. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed tomorrow's schedule. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatchViews.jsx`<br>`functions/src/scheduling/availabilityModel.ts:259-311` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Carry-over work is invisible on tomorrow's board, so tomorrow's capacity is systematically overstated by exactly the jobs that ran late. |

#### P3B1-S22-A05 — Sweep the inbound queue before leaving

*Marisol Vega (service_coordinator) · taylor · DESKTOP · END_OF_DAY, EXCEPTION, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | Four requests decided during the day; three arrived after 16:00. |
| **Business purpose** | Anything left in the queue overnight is a customer waiting. |
| **Preconditions** | — Undecided inbound requests exist |
| **Action** | Work the remaining rows. |
| **Expected EOS state transition** | Each decision moves a request out of AWAITING_DECISION or NEEDS_REVIEW. |
| **Expected authority / capability** | Inbound decision authority. |
| **Expected UI result** | The queue does not distinguish 'arrived while you were here' from 'arrived after hours'. |
| **Expected audit result** | Decision events. |
| **Expected cross-object effect** | A request that arrives at 18:30 waits until 06:40, and nothing escalates it regardless of content. |
| **Exception / recovery** | An emergency emailed at 18:30 is indistinguishable from a routine one. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed late-arriving requests. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:32-53` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No urgency detection or escalation on inbound work, so an emergency arriving by email out of hours sits in the queue until morning. |

#### P3B1-S22-A06 — Close everything completed today

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · END_OF_DAY, BULK, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | Seven COMPLETED Work Orders. |
| **Business purpose** | Same-day close is the target. |
| **Preconditions** | — Seven COMPLETED WOs |
| **Action** | Close each. |
| **Expected EOS state transition** | Seven COMPLETED -> CLOSED transitions. |
| **Expected authority / capability** | Close, seven times, requiring admin or dispatcher. |
| **Expected UI result** | Seven record pages. |
| **Expected audit result** | Seven closedAt timestamps. |
| **Expected cross-object effect** | Two of the seven are empty completions and she closes them anyway, because the alternative is leaving them open forever. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed COMPLETED WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task |
| **Evidence** | `functions/src/transitionEngine.ts:136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S22-A07 — Read the day's numbers

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_DAY, MISSING_DATA, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | A full day of activity. |
| **Business purpose** | A service manager's daily rhythm. |
| **Preconditions** | — A day of Work Orders exists |
| **Action** | Look for a daily service summary. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The performance metric registry carries a ready-to-schedule count metric with a goal authority entry that is null - the metric exists and no goal is set against it. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Jobs completed, first-time fix, on-time arrival and jobs per day are all either unmeasurable or absent; the technician scorecard shows three of them as visibly empty slots, which is the honest way to present an unmeasurable metric. |
| **Exception / recovery** | She counts by hand. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | The visibly-empty slot pattern is the right help here and it is already in use. |
| **Reset / replay** | Seed a day. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task |
| **Evidence** | `functions/src/performance/performanceMetricRegistry.ts:217`<br>`functions/src/performance/performanceGoalAuthority.ts:99 (goal is null)`<br>`field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S22-A08 — Hand the board to the evening dispatcher

*Dale Brackett (dispatcher) · taylor · DESKTOP · END_OF_DAY, HANDOFF, DESKTOP*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | Shift change at 17:30. |
| **Business purpose** | The handoff is where the day's context is either transmitted or lost. |
| **Preconditions** | — An evening dispatcher exists |
| **Action** | Hand over. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Both hold dispatcher. |
| **Expected UI result** | The activity feed is session-only, so the incoming dispatcher's feed is empty. There is no shift-note or handover surface. |
| **Expected audit result** | The durable audit events exist and are not where a dispatcher looks. |
| **Expected cross-object effect** | Every in-flight decision - who was phoned, which customer was promised what - is verbal. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/dispatcherBoard/DispatcherActivityFeed.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No shift handover surface exists for dispatch; the only in-product history is a session-scoped feed that is empty for the arriving dispatcher. |

#### P3B1-S22-A09 — Complete the last job of the day at 17:45 in a car park

*Curtis Nally (field_technician) · taylor · MOBILE · END_OF_DAY, MOBILE, MISSING_DATA*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | WORK_IN_PROGRESS; he wants to go home. |
| **Business purpose** | The last completion of the day is the most rushed record of the day. |
| **Preconditions** | — The WO is his and in progress |
| **Action** | Complete with minimal input. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED. |
| **Expected authority / capability** | Complete. |
| **Expected UI result** | No friction, no checklist, no prompt. |
| **Expected audit result** | completedAt 17:45. |
| **Expected cross-object effect** | The parts he fitted at 16:20 were never recorded, and now the capture surfaces may be gone. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | A one-screen 'before you finish' summary would be the highest-value addition in the technician app. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:142`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S22-A10 — Sync a day's queued intents in the depot car park at 18:00

*Tonya Reese (field_technician) · ventana · MOBILE · END_OF_DAY, NETWORK_INTERRUPTION, MOBILE*

**Account context.** Mixed Taylor and Ventana route

| | |
| --- | --- |
| **Starting records / state** | Nine queued intents from a day at an ice plant. |
| **Business purpose** | The end of the day is when offline work finally lands. |
| **Preconditions** | — Nine unsent intents |
| **Action** | Reconnect and let the queue drain. |
| **Expected EOS state transition** | Nine intents send in dependency order. |
| **Expected authority / capability** | Each authorised on arrival. |
| **Expected UI result** | Nine cards resolving. |
| **Expected audit result** | Nine events, all timestamped 18:0x, describing a day that ran 08:00 to 17:30. |
| **Expected cross-object effect** | The dispatcher's end-of-day review at 17:20 saw none of it, so his sweep was based on a false picture of the day. |
| **Exception / recovery** | A refusal at 18:00 is discovered when everyone has gone home. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Queue nine intents and reconnect. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/offline/syncExecutor.js`<br>`field-ops-app-vite/src/hooks/useOfflineRuntime.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A day of offline work lands after the dispatcher's end-of-day review, so the review is systematically wrong for any technician who worked out of coverage. |

</details>

### P3B1-S23 — The quarterly PM campaign - 62 convenience stores, one planning morning

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

Preventive maintenance is the business's steadiest revenue and its worst data-entry experience. Rosa must create, schedule and dispatch preventive-maintenance Work Orders for 62 stores. Every governed action in this domain is a per-record command.

<details><summary>10 activities — P3B1-S23-A01 · P3B1-S23-A02 · P3B1-S23-A03 · P3B1-S23-A04 · P3B1-S23-A05 · P3B1-S23-A06 · P3B1-S23-A07 · P3B1-S23-A08 · P3B1-S23-A09 · P3B1-S23-A10</summary>

#### P3B1-S23-A01 — Identify the 62 machines due for preventive maintenance

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · BULK, MISSING_DATA, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | An account with 62 locations and roughly 110 registered machines. |
| **Business purpose** | Knowing what is due is the first and largest problem. |
| **Preconditions** | — Equipment is registered across the locations |
| **Action** | Look for a PM-due view. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The equipment register is account-scoped and paginated; PM is one of the five Work Order types but no PM schedule, interval or due-date concept exists on equipment in this lane's reading. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Without a PM interval on equipment, 'due' is a spreadsheet maintained outside EOS. |
| **Exception / recovery** | She works from last quarter's list. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Seed 62 locations and 110 machines. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/types/workOrder.ts:37-42 (PM is a WorkOrderType)`<br>`field-ops-app-vite/src/modules/equipment/CustomerEquipment.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No preventive-maintenance interval or due-date exists on equipment, so PM scheduling - the most predictable revenue in the business - is planned entirely outside EOS. |

#### P3B1-S23-A02 — Create 62 PM Work Orders

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · BULK, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | A list of 62 machines. |
| **Business purpose** | Each must become a governed record. |
| **Preconditions** | — The equipment and locations exist |
| **Action** | Run the Work Order wizard 62 times. |
| **Expected EOS state transition** | 62 Work Orders in CREATED, 62 counter increments. |
| **Expected authority / capability** | workOrder.create, 62 times. No bulk creation exists. |
| **Expected UI result** | 248 wizard steps. |
| **Expected audit result** | 62 creation events. |
| **Expected cross-object effect** | The counter advances by 62, all inside individual transactions, so concurrency is safe but the effort is linear. |
| **Exception / recovery** | An interruption at record 40 leaves 40 created with no record of where she stopped. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Delete 62 WOs; leave the counter advanced. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrderWizard.jsx`<br>`functions/src/createWorkOrder.ts:78-100`<br>`functions/src/woNumbering.ts:44-59` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No bulk Work Order creation exists. A routine quarterly PM campaign is 62 four-step wizards, and an interruption leaves no resumable state. |

#### P3B1-S23-A03 — Mark 62 Work Orders ready to dispatch

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · BULK, PERMISSION_DENIAL, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | 62 WOs in CREATED. |
| **Business purpose** | MarkReady is a per-record admin/dispatcher action. |
| **Preconditions** | — Rosa holds dispatcher, or must ask someone who does |
| **Action** | Invoke MarkReady 62 times. |
| **Expected EOS state transition** | 62 CREATED -> READY_TO_DISPATCH transitions. |
| **Expected authority / capability** | MarkReady: admin/dispatcher. If Rosa is a coordinator, all 62 wait on a dispatcher. |
| **Expected UI result** | 62 actions. |
| **Expected audit result** | 62 events. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:129` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S23-A04 — Schedule 62 PM jobs across four technicians and three weeks

*Brett Hollins (dispatcher) · ventana · DESKTOP · BULK, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | 62 READY_TO_DISPATCH Work Orders. |
| **Business purpose** | PM campaigns are scheduled in bulk by geography and week. |
| **Preconditions** | — Technicians with recorded availability |
| **Action** | Place each on the board. |
| **Expected EOS state transition** | 62 READY_TO_DISPATCH -> SCHEDULED transitions, each validated against blocked time and overlapping placements. |
| **Expected authority / capability** | Schedule, 62 times, each through the placement dialog. |
| **Expected UI result** | 62 confirmations. The two-week view helps see the shape; it does not help place them. |
| **Expected audit result** | 62 transition events. |
| **Expected cross-object effect** | Each placement re-reads blocked time and existing placements, so a technician's lane fills correctly - but any that fall in the holiday closure period cannot be blocked out, because the closure could not be recorded. |
| **Exception / recovery** | A refusal at placement 41 leaves 40 placed and no summary. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Unschedule each. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `functions/src/scheduling/placementPolicy.ts:65-126`<br>`functions/src/scheduling/schedulingCommands.ts:460-468 (the closure that could not be recorded)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A three-week PM campaign can be scheduled straight through a company holiday, because the holiday closure is unrecordable for any technician who has a recorded lunch break. |

#### P3B1-S23-A05 — Discover that two stores were scheduled twice

*Brett Hollins (dispatcher) · ventana · DESKTOP · BULK, DUPLICATE_DATA, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | The source spreadsheet listed two stores twice. |
| **Business purpose** | Bulk data always contains duplicates. |
| **Preconditions** | — Duplicate rows in the source list |
| **Action** | Create and schedule from the duplicated list. |
| **Expected EOS state transition** | Two extra Work Orders exist for two stores. |
| **Expected authority / capability** | Nothing refuses. There is no uniqueness constraint on 'one open Work Order per equipment'. |
| **Expected UI result** | Nothing warns at creation that an open Work Order already exists for this machine. |
| **Expected audit result** | Two creation events per store. |
| **Expected cross-object effect** | Two technicians may be dispatched to the same machine on different days. |
| **Exception / recovery** | The customer notices before the company does. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | 'This machine already has an open Work Order' at creation would prevent the whole class. |
| **Reset / replay** | Cancel the duplicates. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/createWorkOrder.ts:78-100 (no per-equipment open-WO uniqueness check)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Nothing warns or refuses when a second open Work Order is created against equipment that already has one, so duplicate demand passes straight through to duplicate truck rolls. |

#### P3B1-S23-A06 — Work eight PM visits in a day across a c-store route

*Tonya Reese (field_technician) · ventana · MOBILE · BULK, MOBILE*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | Eight dispatched PM Work Orders at eight stores. |
| **Business purpose** | A PM route day is eight complete lifecycles, forty transitions and eight sets of capture. |
| **Preconditions** | — Eight WOs dispatched to her |
| **Action** | Accept, Travel, Arrive, WorkStart, Complete at each store. |
| **Expected EOS state transition** | Forty transitions across eight Work Orders. |
| **Expected authority / capability** | Each requires technician role and own assignment. |
| **Expected UI result** | Forty taps, plus notes and parts at each. |
| **Expected audit result** | Forty timestamped events. |
| **Expected cross-object effect** | If she accepts all eight in the morning, all eight occupy her; if she accepts them one at a time, the dispatcher sees a truer picture. |
| **Exception / recovery** | Any store closed on arrival has no representable outcome. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed eight dispatched WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:138-142`<br>`functions/src/workOrderAvailability.ts:9-21` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S23-A07 — Record the same PM parts kit at eight stores

*Tonya Reese (field_technician) · ventana · MOBILE · BULK, MOBILE, EXCEPTION*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | Each PM consumes one filter kit and one sanitiser. |
| **Business purpose** | Identical capture repeated eight times is where errors enter. |
| **Preconditions** | — Each WO has the same parts plan |
| **Action** | Record two parts at each of eight jobs. |
| **Expected EOS state transition** | Sixteen execution-data updates, each requiring a source selection. |
| **Expected authority / capability** | Own assignment on each. |
| **Expected UI result** | Sixteen source selections for a technician who took everything off the same truck this morning. |
| **Expected audit result** | Sixteen consumption records. |
| **Expected cross-object effect** | The source picker pre-selects the server's suggestion, which makes repetition survivable - but the sanitiser may be LOT-tracked, in which case it is refused sixteen times. |
| **Exception / recovery** | A LOT-tracked consumable on a PM route is a refusal per store. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed eight WOs with identical plans. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:153-205`<br>`functions/src/workOrderConsumption/consumptionPartTracking.ts:57-65` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A LOT-tracked consumable on a PM route produces one refusal per store with no alternative capture path, so the chemical usage simply goes unrecorded across the whole campaign. |

#### P3B1-S23-A08 — Close 62 PM Work Orders and bill them as one campaign

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · BULK, END_OF_MONTH, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | 62 COMPLETED Work Orders across three weeks. |
| **Business purpose** | The customer expects one invoice for a quarterly PM programme. |
| **Preconditions** | — 62 COMPLETED WOs |
| **Action** | Close each and assemble the billing. |
| **Expected EOS state transition** | 62 COMPLETED -> CLOSED transitions. |
| **Expected authority / capability** | Close, 62 times. |
| **Expected UI result** | 62 record pages. No campaign, batch or programme abstraction exists. |
| **Expected audit result** | 62 closedAt timestamps. |
| **Expected cross-object effect** | The coordinated-visit concept groups Work Orders that share a Sales Order and deliberately does not merge them; a PM campaign has no Sales Order and no grouping. |
| **Exception / recovery** | She assembles the invoice by hand from 62 records. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:136`<br>`field-ops-app-vite/src/modules/service/CoordinatedVisitsWorkspace.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No campaign or programme grouping exists for Work Orders, so a 62-store quarterly PM contract is 62 unrelated records at every stage: planning, scheduling, execution, close and billing. |

#### P3B1-S23-A09 — Split the campaign between the two operating companies

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, BULK, MISSING_DATA, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | 38 stores buy ice through Ventana; 24 buy frozen beverage through Taylor. |
| **Business purpose** | One account, two companies, one campaign. |
| **Preconditions** | — Machines at the same stores belong to different companies commercially |
| **Action** | Attempt to segregate the Work Orders by company. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Impossible. No Work Order carries an operatingCompanyId, so the 62 records cannot be split or filtered by company at any point. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Revenue recognition for the campaign must be reconstructed from equipment or account attribution, not from the Work Orders themselves. |
| **Exception / recovery** | She maintains the split in a spreadsheet. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed machines of both companies at one account. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/types/workOrder.ts`<br>`functions/src/ownership/operatingCompanyAuthority.ts:23-24` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A campaign spanning both operating companies cannot be split by company at any stage, because company attribution does not exist on the Work Order. |

#### P3B1-S23-A10 — Measure the campaign's completion rate mid-way

*Priya Raman (service_manager) · taylor · DESKTOP · BULK, END_OF_MONTH, DESKTOP*

**Account context.** QuikMart Southwest - 62 stores across Phoenix and Tucson, Manitowoc ice machines and FBD frozen-beverage units

| | |
| --- | --- |
| **Starting records / state** | Week two of three; some stores done, some not. |
| **Business purpose** | Campaign progress is a question asked weekly. |
| **Preconditions** | — Partial completion |
| **Action** | Count completed versus outstanding. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | She filters the Work Orders list by status and counts, with no campaign to filter by - so the count includes every unrelated PM in the period. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Without grouping, campaign progress and background PM work are indistinguishable. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed partial completion. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrdersList.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S24 — Month end - closing the service month across two companies

**Account context.** All accounts, both operating companies

The last working day of the month. Priya and Amanda must close the service month: every completed job closed, every open job explained, every number defensible. This story tests whether the service domain can produce a month.

<details><summary>10 activities — P3B1-S24-A01 · P3B1-S24-A02 · P3B1-S24-A03 · P3B1-S24-A04 · P3B1-S24-A05 · P3B1-S24-A06 · P3B1-S24-A07 · P3B1-S24-A08 · P3B1-S24-A09 · P3B1-S24-A10</summary>

#### P3B1-S24-A01 — Find every Work Order completed but not closed this month

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · END_OF_MONTH, CROSS_COMPANY, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | ~340 Work Orders in the month; 28 COMPLETED and unclosed. |
| **Business purpose** | Unclosed completions are unbilled revenue. |
| **Preconditions** | — A month of Work Orders |
| **Action** | Filter by status COMPLETED. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read, subject to the workOrder.create route gate on the Work Order pages. |
| **Expected UI result** | A filtered list with no company dimension. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Both companies' unbilled revenue is in one undifferentiated list. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · operating-company attribution unclear |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrdersList.jsx`<br>`functions/src/types/workOrder.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S24-A02 — Close 28 Work Orders on the last day of the month

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · END_OF_MONTH, BULK, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | 28 COMPLETED Work Orders, some from three weeks ago. |
| **Business purpose** | Month-end close is the largest single batch of the period. |
| **Preconditions** | — 28 COMPLETED WOs |
| **Action** | Close each. |
| **Expected EOS state transition** | 28 COMPLETED -> CLOSED transitions, all timestamped on the last day. |
| **Expected authority / capability** | Close, 28 times. |
| **Expected UI result** | 28 record pages. |
| **Expected audit result** | 28 closedAt timestamps clustered on one afternoon, which destroys any 'time to close' measure for the month. |
| **Expected cross-object effect** | Revenue recognised by closedAt lands entirely on the last day rather than when the work was done. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:136`<br>`functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Month-end batch closing clusters every closedAt on one day, so completed-to-closed latency - the one well-instrumented service metric - is destroyed by the process that uses it. |

#### P3B1-S24-A03 — Explain the Work Orders still open at month end

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | 14 non-terminal Work Orders, some in CREATED since week one. |
| **Business purpose** | Aged open work is the question a controller asks first. |
| **Preconditions** | — Aged non-terminal WOs exist |
| **Action** | Determine why each is open. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Status and timestamps only. There is no reason, owner, or blocked-on field on a Work Order. |
| **Expected audit result** | The transition events show when each stopped moving, not why. |
| **Expected cross-object effect** | A WO in CREATED for three weeks means nobody marked it ready, and nothing records who was supposed to. |
| **Exception / recovery** | She opens fourteen records and guesses. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed aged WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/types/workOrder.ts`<br>`functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A Work Order has no owner and no blocked-on field, so an aged open job cannot be explained or chased from the record. |

#### P3B1-S24-A04 — Split the month's service activity between Taylor and Ventana

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, CROSS_COMPANY, MISSING_DATA, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | ~340 Work Orders across both companies. |
| **Business purpose** | Two companies file two sets of accounts. |
| **Preconditions** | — A month of Work Orders |
| **Action** | Attempt the split. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Not possible from the Work Orders. Company must be inferred from the account, the equipment, or the actor. |
| **Expected audit result** | Audit events name actors, not companies. |
| **Expected cross-object effect** | The ownership model has a defined operating-company authority with taylor and ventana as the two values, and Work Orders simply do not participate in it. |
| **Exception / recovery** | The split is reconstructed downstream and is a reconciliation, not a report. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month across both companies. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/ownership/operatingCompanyAuthority.ts:23-24`<br>`functions/src/types/workOrder.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Monthly service activity cannot be split by operating company from the Work Order records, which is the single most consequential effect of the missing operatingCompanyId. |

#### P3B1-S24-A05 — Report technician utilisation for the month

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | 13 technicians, recorded working hours for some, blocked time for some. |
| **Business purpose** | Utilisation drives hiring. |
| **Preconditions** | — Availability and blocked time exist for some technicians |
| **Action** | Compute percent booked per technician for the month. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Available minutes returns null where availability is unrecorded, and must render as 'no working schedule recorded' rather than 0%. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Blocked minutes are computed as a per-minute union, so overlapping absences are counted once - which is correct under the Owner's ruling and is the half of the model that already obeys it. |
| **Exception / recovery** | Any technician without a recorded schedule is simply absent from the report rather than showing as 0%. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | The unrecorded-versus-zero distinction must survive to the report. |
| **Reset / replay** | Seed a month of availability and blocks. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:259-291`<br>`functions/src/scheduling/availabilityModel.ts:289-311` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S24-A06 — Report jobs per technician per day

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | A month of completed Work Orders. |
| **Business purpose** | A headline productivity number. |
| **Preconditions** | — A month of data |
| **Action** | Compute it. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The technician scorecard deliberately shows jobs-per-day as a visibly empty slot rather than a fabricated number. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The denominator is the problem: days worked requires availability and blocked-time data that not every technician has. |
| **Exception / recovery** | An honest empty slot is better than a wrong number, and this is a good example of the app choosing correctly. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The visibly-empty slot IS the help. |
| **Reset / replay** | Seed a month. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S24-A07 — Reconcile parts consumed on Work Orders against inventory movements

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · END_OF_MONTH, BAD_DATA, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | A month of Work Order consumption. |
| **Business purpose** | Parts on jobs must equal parts out of stock. |
| **Preconditions** | — A month of consumption records |
| **Action** | Reconcile. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Variances will exist from the scan path's missing source, from truck-join failures, from unrecorded parts and from parts on cancelled Work Orders. |
| **Expected audit result** | Each consumption is individually attributable; the aggregate is not explainable. |
| **Expected cross-object effect** | Four distinct defects all land in this one reconciliation, and nothing distinguishes them. |
| **Exception / recovery** | The variance is written off. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month with each defect present. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/PartsScanner.jsx:223,240`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:59-90` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Four independent parts-capture defects converge on one unexplainable month-end inventory variance. |

#### P3B1-S24-A08 — Produce the count of Work Orders ready to schedule at month end

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | A backlog of READY_TO_DISPATCH Work Orders. |
| **Business purpose** | Backlog is the leading indicator of next month. |
| **Preconditions** | — A backlog exists |
| **Action** | Read the metric. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | A ready-to-schedule count metric is registered in the performance metric registry. Its goal authority entry is explicitly null - the metric exists and no target is set. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | A metric with no goal is a number, not a measure. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'No target set' is worth showing rather than presenting a bare number. |
| **Reset / replay** | Seed a backlog. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/performance/performanceMetricRegistry.ts:217`<br>`functions/src/performance/performanceGoalAuthority.ts:99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S24-A09 — Find a Work Order from the 3rd of the month by its number

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · END_OF_MONTH, DUPLICATE_DATA, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | A customer query about an invoice. |
| **Business purpose** | Month end generates customer queries about old jobs. |
| **Preconditions** | — Closed Work Orders from earlier in the month |
| **Action** | Search by woNumber. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | If the counter document was ever lost and recreated, the number may match two records, with no uniqueness constraint to prevent it. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is the customer-facing consequence of the numbering defect. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed duplicate woNumbers. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · recovery unclear |
| **Evidence** | `functions/src/woNumbering.ts:6-11,50` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S24-A10 — Sign off the service month

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** All accounts, both operating companies

| | |
| --- | --- |
| **Starting records / state** | All the above complete. |
| **Business purpose** | Somebody has to say the month is right. |
| **Preconditions** | — Close-out complete |
| **Action** | Look for a period-close or sign-off action in the service domain. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | There is no service-period close concept. Work Orders close individually and nothing seals a period. |
| **Expected UI result** | Nothing prevents a Work Order from being closed with a closedAt in a signed-off month, because no month is ever signed off. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | A late close in a closed period moves revenue between months with nothing to stop it. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No period close exists in the service domain, so a Work Order closed late lands revenue in whatever month it is closed, with nothing to detect or prevent it. |

</details>

### P3B1-S25 — One customer, four machines, one trip - the coordinated visit

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

A new store opening puts four machines at one address on one day. EOS models this as four Work Orders that share a Sales Order and deliberately does NOT merge them into one record - each unit keeps its own lifecycle. The coordinated-visit surfaces exist to show the group without pretending it is a single job.

<details><summary>10 activities — P3B1-S25-A01 · P3B1-S25-A02 · P3B1-S25-A03 · P3B1-S25-A04 · P3B1-S25-A05 · P3B1-S25-A06 · P3B1-S25-A07 · P3B1-S25-A08 · P3B1-S25-A09 · P3B1-S25-A10</summary>

#### P3B1-S25-A01 — Open the coordinated visits workspace for the new store opening

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | Four Work Orders created from one Sales Order for one location. |
| **Business purpose** | See the whole visit without losing the per-unit truth. |
| **Preconditions** | — Four Work Orders share a Sales Order |
| **Action** | Open Service > Coordinated Visits. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read; the route carries no legacy key so it falls back to the admin/dispatcher default. |
| **Expected UI result** | Per-unit rows showing status, technician/truck, readiness and blockers - shown side by side, never merged into one record. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The grouping key is the Sales Order, not the customer or the address, so two separate orders to the same store on the same day do NOT group. |
| **Exception / recovery** | A service call added to the same day's visit is not part of the group. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'These are four jobs, not one' is the design intent and worth stating. |
| **Reset / replay** | Seed a Sales Order with four Work Orders. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/service/CoordinatedVisitsWorkspace.jsx`<br>`functions/src/fulfillment/coordinatedVisit.ts:15,46` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S25-A02 — Schedule four coordinated Work Orders into one technician's day

*Dale Brackett (dispatcher) · taylor · DESKTOP · BULK, EXCEPTION, DESKTOP*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | Four READY_TO_DISPATCH Work Orders at one address. |
| **Business purpose** | One trip, four installs - the whole point of coordinating them. |
| **Preconditions** | — All four are ready |
| **Action** | Place all four on one technician across one day. |
| **Expected EOS state transition** | Four independent READY_TO_DISPATCH -> SCHEDULED transitions. |
| **Expected authority / capability** | Schedule, four times. |
| **Expected UI result** | Four placements. Each is validated against the others, so the four windows must not overlap even though they are at the same address on the same trip. |
| **Expected audit result** | Four events. |
| **Expected cross-object effect** | The overlap check is half-open, so back-to-back windows are fine - but the dispatcher must guess a duration per machine to make them fit. |
| **Exception / recovery** | Scheduling all four for the same window is refused as a schedule conflict, even though it accurately describes one visit. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | 'Four jobs at one address must still be placed in sequence' is the rule and the dialog does not say it. |
| **Reset / replay** | Unschedule all four. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/workOrderAvailability.ts:57-71`<br>`functions/src/scheduling/placementPolicy.ts:106-126` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A coordinated visit must be scheduled as sequential non-overlapping windows, so the dispatcher invents per-machine durations to make one trip fit a model that has no concept of a trip. |

#### P3B1-S25-A03 — Read the coordinated field mission view on site

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | Four dispatched Work Orders at one address. |
| **Business purpose** | The technician needs to see the whole visit, not four unrelated cards. |
| **Preconditions** | — Four WOs dispatched to him at one location |
| **Action** | Open the coordinated mission view. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | The coordinated-mission route is reachable by admin and technician through the fieldMode legacy key. |
| **Expected UI result** | A read-only multi-equipment view of one customer visit with independent per-unit execution and shared readiness/blockers. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is one of the few places the technician gets cross-Work-Order context, and it works because all four are assigned to him. |
| **Exception / recovery** | If one of the four is assigned to a second technician, he cannot see it at all, and the 'shared' view is silently incomplete. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed four WOs to one technician. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/CoordinatedMissionView.jsx`<br>`field-ops-app-vite/src/domain/constants.js:374-378` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The coordinated mission view silently omits any Work Order in the group assigned to a different technician, so a two-technician install day shows each of them half the visit with no indication anything is missing. |

#### P3B1-S25-A04 — Execute four lifecycles at one address

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, BULK, BAD_DATA*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | Four ACCEPTED Work Orders at the Mesa store. |
| **Business purpose** | Twenty transitions for one trip. |
| **Preconditions** | — Four WOs accepted |
| **Action** | Travel, Arrive, WorkStart and Complete on each. |
| **Expected EOS state transition** | Sixteen transitions after acceptance, including four Travel and four Arrive actions for a single journey. |
| **Expected authority / capability** | Each: technician, own assignment. |
| **Expected UI result** | He taps Travel four times for one drive and Arrive four times for one arrival. |
| **Expected audit result** | Four enRouteAt and four arrivedAt timestamps describing one journey. |
| **Expected cross-object effect** | Drive-time and response-time analytics count this trip four times. |
| **Exception / recovery** | Skipping steps is impossible; each edge is required. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:43-47,138-142` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A coordinated visit multiplies travel and arrival events by the number of machines, so every drive-time and response-time measure is inflated by exactly the cases the coordination was meant to make efficient. |

#### P3B1-S25-A05 — Install the second freezer and find it is the wrong model

*Curtis Nally (field_technician) · taylor · MOBILE · EXCEPTION, BAD_DATA, MOBILE*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | The Sales Order specified a C712; a C713 was delivered. |
| **Business purpose** | Delivery substitutions are routine and the install must record what was actually installed. |
| **Preconditions** | — The delivered unit differs from the ordered one |
| **Action** | Use the install closeout flow and pick the machine. |
| **Expected EOS state transition** | The install step records the equipment; the technician picks which machine, with no customer or location entry because those are server-derived. |
| **Expected authority / capability** | Equipment install capability. |
| **Expected UI result** | Scan-to-resolve then a two-step install-then-complete flow, carrying an idempotency key. |
| **Expected audit result** | An install event. |
| **Expected cross-object effect** | If the actual unit is not in available inventory, it cannot be selected, and the substitution cannot be recorded. |
| **Exception / recovery** | He installs it and records the wrong model, or records nothing. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a mismatched delivery. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/EquipmentInstallCloseout.jsx (no customer/location entry, server-derived)`<br>`field-ops-app-vite/src/modules/equipment/InstallAtCustomer.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S25-A06 — Complete one machine and leave three for tomorrow

*Curtis Nally (field_technician) · taylor · MOBILE · END_OF_DAY, MOBILE, NORMAL*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | One install done at 16:00; the electrician has not finished the other three drops. |
| **Business purpose** | Partial completion of a coordinated visit is the normal outcome. |
| **Preconditions** | — Four WOs, one complete |
| **Action** | Complete one; leave three in WORK_IN_PROGRESS or ACCEPTED. |
| **Expected EOS state transition** | One WORK_IN_PROGRESS -> COMPLETED; three unchanged. |
| **Expected authority / capability** | Complete on his own. |
| **Expected UI result** | The coordinated view shows a mixed group, which is exactly what the per-unit design is for and is a genuine strength. |
| **Expected audit result** | One completion. |
| **Expected cross-object effect** | The three incomplete ones hold him in occupying statuses overnight. |
| **Exception / recovery** | Returning tomorrow means four more Travel and Arrive taps for three machines. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None - the per-unit view handles this well. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/service/CoordinatedVisitsWorkspace.jsx`<br>`functions/src/workOrderAvailability.ts:9-21` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S25-A07 — Tell the customer the status of their store opening

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | One of four machines installed. |
| **Business purpose** | The customer asks about the store, not about four Work Orders. |
| **Preconditions** | — Mixed statuses across the group |
| **Action** | Read the coordinated visit and summarise. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Per-unit rows with readiness and blockers - close to what she needs. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The blockers shown are shared readiness/blockers from the fulfilment side, which is genuinely more than the Work Orders alone would give. |
| **Exception / recovery** | A service call raised for the same store that day is outside the group and invisible here. |
| **AI opportunity** | `DRAFT` — AI's value is drafting text a human then approves. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed mixed statuses. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/service/CoordinatedVisitsWorkspace.jsx`<br>`functions/src/fulfillment/coordinatedVisit.ts:46` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S25-A08 — Add a fifth Work Order to the visit for a machine the customer added late

*Dale Brackett (dispatcher) · taylor · DESKTOP · EXCEPTION, MISSING_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | Four coordinated Work Orders; a fifth machine is ordered on the day. |
| **Business purpose** | Scope grows between order and install. |
| **Preconditions** | — A fifth machine is added |
| **Action** | Create a Work Order for it and try to add it to the group. |
| **Expected EOS state transition** | A new Work Order in CREATED. |
| **Expected authority / capability** | workOrder.create. |
| **Expected UI result** | Grouping is by Sales Order line references, so a Work Order created outside that order does not join the group. |
| **Expected audit result** | A creation event. |
| **Expected cross-object effect** | The coordinated view shows four; the technician's day has five. |
| **Exception / recovery** | The fifth is worked as an unrelated job at the same address. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a fifth WO outside the order. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/fulfillment/coordinatedVisit.ts:15,46`<br>`functions/src/types/workOrder.ts (Sales Order line refs carry qty and kind)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S25-A09 — Bill a coordinated visit

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · END_OF_MONTH, NORMAL, DESKTOP*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | Four completed and closed Work Orders from one Sales Order. |
| **Business purpose** | One order, one invoice. |
| **Preconditions** | — Four closed WOs |
| **Action** | Assemble the billing. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The Sales Order line references on each Work Order carry quantity and kind, which is what lets per-line fulfilment write-back find the right line - so the linkage is genuinely there. |
| **Expected audit result** | Four closures. |
| **Expected cross-object effect** | This is the one grouping in the service domain that actually works end to end, because it was built on the Sales Order spine rather than on the Work Order. |
| **Exception / recovery** | The fifth, ungrouped Work Order is billed separately. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed four closed WOs on one order. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/types/workOrder.ts (Sales Order line refs with lineId, orderedQty, allocatedQty)`<br>`functions/src/fulfillment/coordinatedVisit.ts:46` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S25-A10 — Compare a coordinated install day against four separate service calls

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, BAD_DATA, DESKTOP*

**Account context.** Sonoran Scoops Creamery - new Mesa store: two Taylor C712 freezers, one C302 shake machine, one Manitowoc ice machine, all from one Sales Order

| | |
| --- | --- |
| **Starting records / state** | A month containing both shapes of work. |
| **Business purpose** | Whether coordination actually saves time is a real question. |
| **Preconditions** | — Both shapes exist in the data |
| **Action** | Compare the timestamps. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The coordinated day produces four sets of travel/arrival timestamps for one trip, so it looks like four trips in the data and cannot be distinguished from four genuine ones except by address and date. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The efficiency gain coordination delivers is invisible in the measures, which makes it unarguable to a controller. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed both shapes. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:92-99`<br>`functions/src/fulfillment/coordinatedVisit.ts:46` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Coordinated visits are indistinguishable from separate trips in the timestamp data, so the efficiency they deliver cannot be measured or defended. |

</details>

### P3B1-S26 — Installing a machine at a customer - the irreversible act

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

Installing a unit at a customer moves it permanently from company inventory to a customer's premises. The flow is confirm-before-permanent and idempotency-keyed, because doing it twice would create a second machine that does not exist.

<details><summary>10 activities — P3B1-S26-A01 · P3B1-S26-A02 · P3B1-S26-A03 · P3B1-S26-A04 · P3B1-S26-A05 · P3B1-S26-A06 · P3B1-S26-A07 · P3B1-S26-A08 · P3B1-S26-A09 · P3B1-S26-A10</summary>

#### P3B1-S26-A01 — Pick the machine to install from the scan flow

*Javier Ochoa (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | WO WORK_IN_PROGRESS at the new store; a serialized C602 is on the truck. |
| **Business purpose** | The technician identifies the physical unit; the system does not guess. |
| **Preconditions** | — The unit exists as an available serialized asset |
| **Action** | Scan the serial to resolve the unit. |
| **Expected EOS state transition** | Resolution only. |
| **Expected authority / capability** | Equipment install capability. |
| **Expected UI result** | No customer or location entry - both are server-derived from the Work Order, which removes an entire class of mis-entry. |
| **Expected audit result** | None for resolution. |
| **Expected cross-object effect** | Available Equipment is the company-inventory serialized-asset view; Customer Equipment is the installed register. The install moves a unit between them. |
| **Exception / recovery** | An unreadable plate forces manual entry. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed an available serialized unit. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/EquipmentInstallCloseout.jsx`<br>`field-ops-app-vite/src/modules/equipment/AvailableEquipment.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S26-A02 — Confirm the install and watch the confirm-before-permanent guard

*Javier Ochoa (field_technician) · taylor · MOBILE · MOBILE, NORMAL, RETRY_IDEMPOTENCY*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | The unit is resolved; the confirm step is showing. |
| **Business purpose** | An install cannot be undone, so the confirm must carry weight. |
| **Preconditions** | — The unit is resolved |
| **Action** | Confirm. |
| **Expected EOS state transition** | The unit becomes installed equipment at the customer's location. |
| **Expected authority / capability** | Equipment install capability, carrying one idempotency key per attempt. |
| **Expected UI result** | An explicit confirm-before-permanent step. |
| **Expected audit result** | An install event. |
| **Expected cross-object effect** | The equipment's locationId must resolve into the CRM locations collection, and Rules require that location's accountId to match the equipment's accountId - so a server-derived location is also a validated one. |
| **Exception / recovery** | A retry replays and returns the SAME Equipment rather than creating a second one. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The confirm step IS the help. |
| **Reset / replay** | Return the unit to available inventory. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/InstallAtCustomer.jsx`<br>`field-ops-app-vite/src/modules/mobile/EquipmentInstallCloseout.jsx`<br>`firestore.rules:1439-1442` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S26-A03 — Retry the install after a timeout

*Javier Ochoa (field_technician) · taylor · MOBILE · RETRY_IDEMPOTENCY, MOBILE*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | The install committed; the response was lost. |
| **Business purpose** | A duplicated install creates a machine that does not exist. |
| **Preconditions** | — A committed install with a lost response |
| **Action** | Retry. |
| **Expected EOS state transition** | The same Equipment is returned. No second unit is created. |
| **Expected authority / capability** | One idempotency key per attempt is the documented contract. |
| **Expected UI result** | The flow proceeds to the completion step. |
| **Expected audit result** | One install event. |
| **Expected cross-object effect** | The offline queue encodes EQUIPMENT_INSTALL to WORK_ORDER_COMPLETE as a hard required dependency, so the completion waits for a successful install even across a retry. |
| **Exception / recovery** | This is one of the best-guarded flows in the application and is worth executing specifically to confirm the guard still holds. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Simulate a lost response. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/EquipmentInstallCloseout.jsx`<br>`field-ops-app-vite/src/offline/intentQueue.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S26-A04 — Install a unit that is not in company inventory

*Javier Ochoa (field_technician) · taylor · MOBILE · UNUSUAL_BUT_LEGITIMATE, MISSING_DATA, MOBILE*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | The customer bought the machine elsewhere and wants it commissioned. |
| **Business purpose** | Commissioning third-party equipment is legitimate business. |
| **Preconditions** | — The unit is not an available serialized asset |
| **Action** | Attempt the install flow. |
| **Expected EOS state transition** | The unit cannot be selected, because the flow picks from company inventory. |
| **Expected authority / capability** | Equipment install capability - but there is nothing to install. |
| **Expected UI result** | He cannot record that the machine exists at the customer. |
| **Expected audit result** | Nothing. |
| **Expected cross-object effect** | The equipment register create flow is account-scoped and lives on a route technicians cannot reach. |
| **Exception / recovery** | The coordinator registers it later from a phone call. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentRegister.jsx`<br>`field-ops-app-vite/src/App.jsx:1044-1052` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A technician commissioning customer-owned equipment cannot register it from the field; registration is a desktop, account-scoped flow on a route technicians cannot open. |

#### P3B1-S26-A05 — Install the machine offline in a building with no signal

*Javier Ochoa (field_technician) · taylor · MOBILE · NETWORK_INTERRUPTION, MOBILE*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | No connectivity at the new store. |
| **Business purpose** | New stores rarely have working wifi on install day. |
| **Preconditions** | — No connectivity |
| **Action** | Run the install flow. |
| **Expected EOS state transition** | The install intent queues; the completion intent queues behind it with a hard dependency. |
| **Expected authority / capability** | Deferred to sync. |
| **Expected UI result** | Two queue cards in dependency order. |
| **Expected audit result** | Nothing until sync. |
| **Expected cross-object effect** | If the install is refused on arrival, the completion behind it must not be sent. |
| **Exception / recovery** | The source list for any parts he fits requires a server read that he cannot make. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The queue cards are the help. |
| **Reset / replay** | Clear the queue. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/offline/intentQueue.js`<br>`field-ops-app-vite/src/offline/submitOrQueue.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`DEVICE_OFFLINE`) — Requires a real or simulated device losing and regaining connectivity against a live backend; the Firestore emulator is unavailable (port 8080 occupied).<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S26-A06 — Correct the install location after the technician installed at the wrong store

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISTAKE, RECOVERY, BAD_DATA, DESKTOP*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | The unit was installed against store #17; it is physically at #19. |
| **Business purpose** | Two new stores opening the same week is exactly when this happens. |
| **Preconditions** | — The unit is installed at the wrong location |
| **Action** | Attempt to move it. |
| **Expected EOS state transition** | None straightforwardly. The equipment edit modal treats identity and ownership as read-only, and Rules deny any change to accountId, locationId, status and createdAt. |
| **Expected authority / capability** | Equipment edit does not extend to ownership fields. |
| **Expected UI result** | The fields she needs are read-only. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | The correction requires an administrative path outside the normal edit flow, if one exists at all. |
| **Exception / recovery** | The register is wrong until someone with elevated access fixes it. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Reseed the equipment. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · ownership unclear |
| **Evidence** | `firestore.rules:1383-1385 (denies changing accountId/locationId)`<br>`firestore.rules:1513 (denies ANY change to accountId/locationId/status/createdAt)`<br>`field-ops-app-vite/src/modules/equipment/EquipmentEditModal.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | An equipment install to the wrong location is immutable through the normal edit path: accountId and locationId are deliberately locked, and no correction flow is offered in their place. |

#### P3B1-S26-A07 — Complete the Work Order after the install

*Javier Ochoa (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | The install succeeded; the WO is WORK_IN_PROGRESS. |
| **Business purpose** | The two-step flow ends with the Work Order completing. |
| **Preconditions** | — The install is recorded |
| **Action** | Complete. |
| **Expected EOS state transition** | WORK_IN_PROGRESS -> COMPLETED. |
| **Expected authority / capability** | Complete: technician, own assignment. |
| **Expected UI result** | The flow's second step. |
| **Expected audit result** | completedAt plus the install event. |
| **Expected cross-object effect** | The equipment now appears in Customer Equipment and on the equipment timeline, tying the install to the Work Order. |
| **Exception / recovery** | Completing without the install having succeeded is prevented offline by the hard dependency; online, whether the flow enforces the order is UNPROVEN. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/EquipmentInstallCloseout.jsx`<br>`field-ops-app-vite/src/modules/equipment/EquipmentTimeline.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S26-A08 — Verify the new machine appears in the customer's equipment register

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | The install completed. |
| **Business purpose** | The register is what every future service call reads from. |
| **Preconditions** | — The install succeeded |
| **Action** | Open Customer Equipment for the account. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The unit appears at the correct location with identity and ownership shown as separate honest rows on the detail page. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The inventory-control panel on the equipment detail page shows inventory control, ownership and availability as separate rows rather than collapsing them, which is the right treatment for three facts that are often confused. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The separate honest rows are the help. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/InventoryControlSection.jsx`<br>`field-ops-app-vite/src/modules/equipment/EquipmentDetail.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S26-A09 — Confirm the installed unit has left available inventory

*Nate Purcell (parts_counter) · taylor · DESKTOP · BAD_DATA, DESKTOP*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | A unit installed at a customer. |
| **Business purpose** | A machine cannot be both installed and available. |
| **Preconditions** | — The install succeeded |
| **Action** | Check the Available Equipment tab. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The unit should no longer be listed as available for assignment. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is the same class of assertion as the serialized-consumption check: two registries must not disagree about one physical unit. |
| **Exception / recovery** | If they disagree, the unit can be sold twice. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Install a unit and check both views. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/AvailableEquipment.jsx`<br>`field-ops-app-vite/src/modules/equipment/CustomerEquipment.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S26-A10 — Trace an installed machine back to the Work Order that installed it

*Priya Raman (service_manager) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Cactus Burger Co. #17, new store, Chandler - Taylor C602 shake machine from company inventory

| | |
| --- | --- |
| **Starting records / state** | A customer disputes an install date. |
| **Business purpose** | Install date starts the warranty clock. |
| **Preconditions** | — An installed unit with an install event |
| **Action** | Open the equipment timeline. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | A unified newest-first activity timeline combining Work Orders and an inventory-history placeholder. |
| **Expected audit result** | The install event and the Work Order completion are both on the record. |
| **Expected cross-object effect** | This is the one place equipment and service history come together, and it works - for anyone who can reach the equipment detail route, which excludes technicians. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed an install. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentTimeline.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S27 — The mailbox behind the queue - inbound transport, credentials and the day it stops polling

**Account context.** service@ mailboxes for both operating companies

Everything in the inbound work story assumes messages arrive. Behind the queue is a provider transport with credentials, a connection, a delivery schedule and a quarantine rule for unknown mailboxes. When it stops, the queue looks like a quiet day.

<details><summary>10 activities — P3B1-S27-A01 · P3B1-S27-A02 · P3B1-S27-A03 · P3B1-S27-A04 · P3B1-S27-A05 · P3B1-S27-A06 · P3B1-S27-A07 · P3B1-S27-A08 · P3B1-S27-A09 · P3B1-S27-A10</summary>

#### P3B1-S27-A01 — Check when the service mailbox last polled successfully

*Priya Raman (service_manager) · taylor · DESKTOP · EXCEPTION, MISSING_DATA, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | The inbound queue shows three rows from this morning. |
| **Business purpose** | An empty or thin queue is either a quiet day or a dead connection. |
| **Preconditions** | — An email connection is configured |
| **Action** | Look for connection health. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Email administration capability, distinct from the inbound work read capability the queue uses. |
| **Expected UI result** | UNPROVEN whether last-poll health is surfaced beside the queue. If it is not, the two states are indistinguishable to a coordinator. |
| **Expected audit result** | None for reading. |
| **Expected cross-object effect** | Email intake is the only channel with an implementation; API, portal, web form and manufacturer feed are defined as source channels with no implementation. |
| **Exception / recovery** | A dead poller produces silence, which reads as good news. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Last successful poll' next to the queue count is the single highest-value addition here. |
| **Reset / replay** | Disable the connection and observe the queue. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/inboundWork/emailConnectionCommands.ts`<br>`functions/src/inboundWork/emailDeliverySchedule.ts`<br>`functions/src/inboundWork/inboundWorkModel.ts:19-21` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A failed mail poll is indistinguishable from a quiet mailbox in the inbound queue, so intake can stop entirely without anyone noticing. |

#### P3B1-S27-A02 — Add a new customer email domain so their messages stop quarantining

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, EXCEPTION, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | A customer's new address quarantines on every send. |
| **Business purpose** | Quarantine on unknown mailbox is a security rule with a customer-service cost. |
| **Preconditions** | — Messages from the address are quarantining |
| **Action** | Register the address or domain. |
| **Expected EOS state transition** | Future messages route rather than quarantine. |
| **Expected authority / capability** | Email administration capability. |
| **Expected UI result** | UNPROVEN what the administration surface looks like from a coordinator's seat. |
| **Expected audit result** | An administrative change should be attributable. |
| **Expected cross-object effect** | Already-quarantined messages are not retroactively released - QUARANTINED is not a decidable status. |
| **Exception / recovery** | The customer must resend. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'This does not release the messages already quarantined' is the sentence that saves a follow-up. |
| **Reset / replay** | Remove the address and re-send. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/inboundWork/emailAdminCommands.ts`<br>`functions/src/inboundWork/inboundRouting.ts`<br>`functions/src/inboundWork/inboundWorkModel.ts:32-46` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S27-A03 — Rotate an expired mailbox credential

*Priya Raman (service_manager) · taylor · DESKTOP · EXCEPTION, RECOVERY, CROSS_COMPANY, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | The provider credential has expired and polling has stopped. |
| **Business purpose** | OAuth tokens expire and nobody notices until the queue is empty for a day. |
| **Preconditions** | — The credential has expired |
| **Action** | Re-authorise the connection. |
| **Expected EOS state transition** | Polling resumes. |
| **Expected authority / capability** | Provider credential vault and authorisation-state handling. |
| **Expected UI result** | UNPROVEN whether an expiring credential warns before it expires. |
| **Expected audit result** | A credential change is a security-relevant event. |
| **Expected cross-object effect** | Two operating companies mean two mailboxes and two credentials, each able to fail independently. |
| **Exception / recovery** | Messages received while the connection was down are still in the mailbox and should be taken in on resumption, but whether the poller back-fills is UNPROVEN. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Expire a credential in a test connection. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · recovery unclear · operating-company attribution unclear |
| **Evidence** | `functions/src/inboundWork/providerCredentialVault.ts`<br>`functions/src/inboundWork/providerAuthorizationState.ts`<br>`functions/src/inboundWork/emailTransportCallables.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | An expiring mailbox credential has no visible warning and its failure mode is a silently empty intake queue. |

#### P3B1-S27-A04 — Work a request that came in through the Gmail transport versus the Graph transport

*Marisol Vega (service_coordinator) · taylor · DESKTOP · CROSS_COMPANY, NORMAL, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | Taylor uses one provider, Ventana another. |
| **Business purpose** | Two companies, two mail platforms, one queue. |
| **Preconditions** | — Both transports are configured |
| **Action** | Compare two requests from the two providers. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The provider payload is normalized and bounded before it is ever persisted, with HTML stripped into a normalized body and the raw message retained separately as evidence - so both providers should present identically. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Uniform normalisation across providers is a genuine strength and worth asserting explicitly. |
| **Exception / recovery** | A provider quirk that survives normalisation would show as a rendering difference between two rows. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed messages from both transports. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/inboundWork/gmailTransport.ts`<br>`functions/src/inboundWork/microsoftGraphTransport.ts`<br>`functions/src/inboundWork/inboundWorkModel.ts:10-17` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S27-A05 — Open an attachment a customer sent with a photo of the fault code

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, MISSING_DATA, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | An inbound request with a JPEG attachment. |
| **Business purpose** | Fault-code photos are the most useful thing customers send. |
| **Preconditions** | — The request carries an attachment |
| **Action** | Open it. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Attachment custody governs how the file is held. |
| **Expected UI result** | The normalized body is what renders; the raw message is retained as evidence, never as markup a surface renders. |
| **Expected audit result** | None for reading. |
| **Expected cross-object effect** | If the request is accepted and becomes a Work Order, whether the attachment travels to the Work Order is UNPROVEN and is worth executing - the photo is most useful to the technician. |
| **Exception / recovery** | An attachment stranded on the intake record helps nobody in the field. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a request with an attachment. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/inboundWork/attachmentCustody.ts`<br>`functions/src/inboundWork/inboundWorkModel.ts:10-17` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S27-A06 — Receive a message so large it should not occupy unbounded storage

*Marisol Vega (service_coordinator) · taylor · DESKTOP · BAD_DATA, EXCEPTION, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | A customer forwards a thread with twenty embedded images. |
| **Business purpose** | An external sender must not choose how much storage one message occupies. |
| **Preconditions** | — An oversized message arrives |
| **Action** | Observe intake. |
| **Expected EOS state transition** | The message is bounded at intake - length caps applied before persistence. |
| **Expected authority / capability** | Intake command. |
| **Expected UI result** | A truncated normalized body. |
| **Expected audit result** | The intake record. |
| **Expected cross-object effect** | Bounding at the edge rather than at render is the correct posture and is stated explicitly in the model. |
| **Exception / recovery** | Truncation may remove the only sentence that matters, and nothing flags that truncation occurred. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'This message was truncated' would be worth showing. |
| **Reset / replay** | Send an oversized fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:70-73 (bounds; an external sender does not get to choose how much storage one message occupies)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S27-A07 — Receive the same message on two threads and watch threading resolve it

*Marisol Vega (service_coordinator) · taylor · DESKTOP · EXCEPTION, DUPLICATE_DATA, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | A customer replies to two of our messages in one thread. |
| **Business purpose** | Thread association decides whether this attaches or creates. |
| **Preconditions** | — Ambiguous thread association |
| **Action** | Observe intake. |
| **Expected EOS state transition** | Ambiguous thread association routes to NEEDS_REVIEW - the same queue, louder. |
| **Expected authority / capability** | Intake command. |
| **Expected UI result** | A NEEDS_REVIEW row. |
| **Expected audit result** | The intake record. |
| **Expected cross-object effect** | This is the correct escalation: ambiguity becomes a human decision rather than a guess. |
| **Exception / recovery** | NEEDS_REVIEW and AWAITING_DECISION look the same in the queue unless the surface distinguishes them. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | The difference between the two decidable statuses is worth one line. |
| **Reset / replay** | Seed an ambiguous thread. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `functions/src/inboundWork/inboundThreading.ts`<br>`functions/src/inboundWork/inboundWorkModel.ts:32-46,50-53` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S27-A08 — Handle a FAILED intake record

*Marisol Vega (service_coordinator) · taylor · DESKTOP · EXCEPTION, RECOVERY, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | Processing failed on one message; it is retained with the failure. |
| **Business purpose** | Failed processing must not lose the customer's request. |
| **Preconditions** | — A processing failure occurred |
| **Action** | Open the FAILED record and retry. |
| **Expected EOS state transition** | FAILED is retained so it can be retried, not lost. It is not a decidable status, so a reviewer cannot accept or decline it directly. |
| **Expected authority / capability** | UNPROVEN whether a coordinator-level retry exists, or whether retry is an administrative action. |
| **Expected UI result** | The failure should be visible with its cause. |
| **Expected audit result** | The failure is recorded on the intake record. |
| **Expected cross-object effect** | If retry is administrative, every processing failure becomes a support ticket. |
| **Exception / recovery** | The customer is waiting and nobody is looking at the FAILED filter. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Force a processing failure. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · ownership unclear |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:32-46 (FAILED: retained with the failure so it can be retried)`<br>`functions/src/inboundWork/inboundProcessing.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S27-A09 — Work the queue with the AI enrichment provider switched off

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | The processing provider is EOS_NATIVE rather than an add-on. |
| **Business purpose** | Base EOS must work without any AI add-on. |
| **Preconditions** | — The provider is EOS_NATIVE |
| **Action** | Work the queue normally. |
| **Expected EOS state transition** | Decisions work identically. |
| **Expected authority / capability** | Unchanged. |
| **Expected UI result** | EOS_NATIVE is base EOS and needs no add-on, so the queue must be fully workable without enrichment - only less pre-classified. |
| **Expected audit result** | The processing provider is recorded on the intake record, so it is always knowable which enrichment produced a classification. |
| **Expected cross-object effect** | Recording the provider is good practice: a classification's provenance is auditable. |
| **Exception / recovery** | A coordinator who learned the queue with enrichment on will find it slower without. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Switch providers. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI would be noise here |
| **Evidence** | `functions/src/inboundWork/inboundWorkModel.ts:65-68 (INBOUND_PROCESSING_PROVIDERS; EOS_NATIVE is base EOS)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S27-A10 — Work the Ventana mailbox and find a Taylor customer's message in it

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** service@ mailboxes for both operating companies

| | |
| --- | --- |
| **Starting records / state** | A customer emailed the wrong company's service address. |
| **Business purpose** | Customers do not know which company sold them which machine. |
| **Preconditions** | — A cross-company message arrives |
| **Action** | Accept it and create a Work Order. |
| **Expected EOS state transition** | AWAITING_DECISION -> ACCEPTED, and a Work Order is created. |
| **Expected authority / capability** | Inbound decision authority plus workOrder.create. Nothing distinguishes the two companies in either. |
| **Expected UI result** | Nothing indicates the mailbox and the account belong to different companies. |
| **Expected audit result** | The intake record knows which mailbox it came from; the Work Order records no company at all. |
| **Expected cross-object effect** | The mailbox is the only company signal in the whole chain, and it is dropped at Work Order creation. |
| **Exception / recovery** | None - nothing refuses. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a cross-company message. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/inboundWork/inboundRouting.ts`<br>`functions/src/inboundWork/inboundDecisionCommands.ts:211-221`<br>`functions/src/types/workOrder.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE_PLUS_TRANSPORT`) — Exercises inbound mail intake, which needs both the Firestore emulator and a stubbed provider transport. The emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The receiving mailbox is the only operating-company signal in the intake chain and it is discarded at Work Order creation, because the Work Order has no field to carry it. |

</details>

### P3B1-S28 — The scorecard that refuses to lie

**Account context.** n/a - workforce performance, no customer account

Curtis opens his performance page. Three of the four headline metrics show as visibly empty because they cannot honestly be computed from the data EOS holds. This story tests whether the honesty survives contact with a manager who wants numbers.

<details><summary>10 activities — P3B1-S28-A01 · P3B1-S28-A02 · P3B1-S28-A03 · P3B1-S28-A04 · P3B1-S28-A05 · P3B1-S28-A06 · P3B1-S28-A07 · P3B1-S28-A08 · P3B1-S28-A09 · P3B1-S28-A10</summary>

#### P3B1-S28-A01 — Open my performance scorecard

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | A quarter of completed Work Orders. |
| **Business purpose** | A technician's view of his own numbers. |
| **Preconditions** | — Completed Work Orders exist for him |
| **Action** | Open the performance page. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read of his own performance. |
| **Expected UI result** | Productivity is populated; on-time, first-time-fix and jobs-per-day are shown as visibly empty or unmeasurable slots rather than as fabricated numbers. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is deliberate design, not a bug: the app refuses to show a number it cannot support. |
| **Exception / recovery** | A technician may read empty slots as 'the system is broken' unless they say why they are empty. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | The empty slot must say WHY it is empty, or the honesty is wasted. |
| **Reset / replay** | Seed a quarter of completed WOs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S28-A02 — Read the all-time performance snapshot

*Curtis Nally (field_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | Completed Work Orders across his employment. |
| **Business purpose** | A one-shot summary is what a technician actually looks at. |
| **Preconditions** | — Historical completions exist |
| **Action** | Open the snapshot. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | A read-only one-shot view of all-time execution stats such as average completion time. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Average completion time is derived from workStartedAt and completedAt, both server-clock and immutable, so the number is trustworthy in a way most service metrics are not. |
| **Exception / recovery** | Offline-synced completions distort it, because their timestamps are sync-time rather than action-time. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed history. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/PerformanceSnapshot.jsx`<br>`functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Average completion time is silently distorted by offline-synced work, because queued transitions carry the sync timestamp rather than the time the technician acted. |

#### P3B1-S28-A03 — Ask for on-time arrival performance

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, END_OF_MONTH, DESKTOP*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | Scheduled windows and arrival timestamps both exist. |
| **Business purpose** | On-time arrival is the metric customers care about most. |
| **Preconditions** | — Scheduled windows and arrivedAt exist |
| **Action** | Attempt to compute it. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The scorecard shows on-time as unmeasurable. The raw ingredients exist - scheduledStart is a planning field and arrivedAt is an execution timestamp - so the gap is that nothing computes it, not that it is impossible. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Scheduled fields are deliberately mutable planning data while arrivedAt is immutable execution data, so a rescheduled job's on-time measure depends on which scheduled window you compare against, and nothing records the original. |
| **Exception / recovery** | Rescheduling erases the promise the on-time measure should be judged against. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed scheduled and arrived WOs including reschedules. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:82-88 (Schedule writes mutable planning fields, not an execution timestamp)`<br>`field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | On-time arrival is computable in principle but Reschedule overwrites the scheduled window in place, so the original customer promise is lost and the measure cannot be anchored. |

#### P3B1-S28-A04 — Compare two technicians' productivity

*Priya Raman (service_manager) · taylor · DESKTOP · BAD_DATA, END_OF_MONTH, DESKTOP*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | Two technicians, similar job counts. |
| **Business purpose** | Comparison is what performance data is used for, fairly or not. |
| **Preconditions** | — Two technicians with completions |
| **Action** | Compare their numbers. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Productivity is populated, so a comparison is possible - and it is built on completion counts that include handoffs completed by the wrong technician and jobs completed with nothing recorded. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Every attribution defect in this library lands in this comparison. |
| **Exception / recovery** | A technician penalised by a data model defect has no way to see or contest it. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed two technicians including a handoff. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/technicianDashboard/TechnicianPerformance.jsx`<br>`functions/src/transitionEngine.ts:142` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Productivity comparison inherits every attribution defect - false completions from handoffs, empty completions, offline timestamp drift - with no indication of which numbers are sound. |

#### P3B1-S28-A05 — See a performance page with almost no data

*Wes Tanner (apprentice_technician) · taylor · MOBILE · MISSING_DATA, MOBILE*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | A technician in his second week. |
| **Business purpose** | New starters are the group most damaged by a fabricated number. |
| **Preconditions** | — Very few completions |
| **Action** | Open the performance page. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The honest-state vocabulary distinguishes empty from not-applicable from capability-not-enabled, which is exactly the distinction a new starter's page needs. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | An average over three jobs is not a performance measure and should not be presented as one. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Not enough work yet to show a meaningful average' is the right sentence. |
| **Reset / replay** | Seed a new technician. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/shared/ui/HonestState.jsx`<br>`field-ops-app-vite/src/modules/technicianDashboard/PerformanceSnapshot.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S28-A06 — Set a performance goal against the ready-to-schedule backlog

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, END_OF_MONTH, DESKTOP*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | The metric is registered; its goal is null. |
| **Business purpose** | A metric without a target is decoration. |
| **Preconditions** | — The metric exists |
| **Action** | Look for a way to set a goal. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Goal authority. |
| **Expected UI result** | The goal authority entry for the ready-to-schedule count metric is explicitly null - the registry knows the metric and no goal is set. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | Whether goals can be set at all from a surface is UNPROVEN by this lane. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/performance/performanceMetricRegistry.ts:217`<br>`functions/src/performance/performanceGoalAuthority.ts:99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S28-A07 — Dispute a productivity figure that counts a job he did not do

*Curtis Nally (field_technician) · taylor · MOBILE · RECOVERY, MISSING_DATA, MOBILE*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | A handoff was recorded under his name. |
| **Business purpose** | Contestability is what makes performance data legitimate. |
| **Preconditions** | — A misattributed completion exists |
| **Action** | Look for a way to flag or correct it. |
| **Expected EOS state transition** | None. Execution timestamps are immutable by design and there is no annotation path. |
| **Expected authority / capability** | He has no write authority over a completed Work Order. |
| **Expected UI result** | No dispute affordance. |
| **Expected audit result** | The record stands. |
| **Expected cross-object effect** | Immutability is correct for integrity and leaves no room for correction of a genuine error. |
| **Exception / recovery** | The correction, if any, happens in a conversation. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:82-88`<br>`functions/src/types/workOrder.ts:6-12` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No annotation or correction path exists for a misattributed completion, so immutable execution data becomes uncontestable performance data. |

#### P3B1-S28-A08 — Measure how long jobs wait in READY_TO_DISPATCH before being scheduled

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, END_OF_MONTH, DESKTOP*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | A month of Work Orders. |
| **Business purpose** | Backlog age is the honest measure of whether dispatch is keeping up. |
| **Preconditions** | — A month of transitions |
| **Action** | Compute the READY_TO_DISPATCH-to-SCHEDULED interval. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | MarkReady writes no execution timestamp, and Schedule writes planning fields rather than an execution timestamp - so neither end of this interval has a recorded moment. |
| **Expected audit result** | The transition events exist in the audit stream, which is where the answer would have to come from. |
| **Expected cross-object effect** | Dispatch, Accept, Travel, Arrive, WorkStart, Complete and Close all write execution timestamps; MarkReady, Unschedule and Schedule do not. |
| **Exception / recovery** | The gap is deliberate and documented - scheduled times are a dispatcher's chosen future, not the instant Schedule was invoked - but it leaves the backlog-age measure without an anchor. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:82-99 (ACTION_TIMESTAMP_FIELD omits MarkReady, Unschedule and Schedule)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Neither MarkReady nor Schedule records when it happened, so time-in-backlog - the measure of whether dispatch is coping - has no anchor on the Work Order record. |

#### P3B1-S28-A09 — Read technician availability and capacity as a planning input

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, NORMAL, DESKTOP*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | 13 technicians, some with recorded working hours. |
| **Business purpose** | Capacity planning is the one thing the scheduling model supports well. |
| **Preconditions** | — Availability records exist for some technicians |
| **Action** | Read per-technician capacity for the next two weeks. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Percent booked, with available minutes as the denominator and blocked minutes subtracted as a per-minute union. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is the strongest analytical surface in the domain and it is honest about what it does not know - unrecorded availability returns null rather than zero. |
| **Exception / recovery** | Its value depends entirely on someone having entered working hours, and nothing chases that. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Seed availability for some technicians. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:259-311` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S28-A10 — Find which technicians have no working hours recorded at all

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, END_OF_MONTH, DESKTOP*

**Account context.** n/a - workforce performance, no customer account

| | |
| --- | --- |
| **Starting records / state** | Some of 13 technicians have no availability document. |
| **Business purpose** | Every capacity number is wrong until this list is empty. |
| **Preconditions** | — Some technicians lack availability |
| **Action** | Look for a coverage report. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether any surface lists technicians missing availability. The board draws a lane for them and warns only at placement time. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The warning fires per placement rather than once per technician, so the same missing record produces dozens of warnings and no worklist. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Delete availability for some technicians. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:219-244` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Missing working availability is surfaced as a per-placement warning rather than as a data-coverage worklist, so the same gap is reported dozens of times and fixed none. |

</details>

### P3B1-S29 — Rosa's Ventana day on a shared account base

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

Ventana and Taylor share one account base, one technician roster, one Work Order collection and one number series. Rosa spends her day working a company that the Work Order record does not know exists.

<details><summary>10 activities — P3B1-S29-A01 · P3B1-S29-A02 · P3B1-S29-A03 · P3B1-S29-A04 · P3B1-S29-A05 · P3B1-S29-A06 · P3B1-S29-A07 · P3B1-S29-A08 · P3B1-S29-A09 · P3B1-S29-A10</summary>

#### P3B1-S29-A01 — Open the Work Orders list and see both companies' jobs

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | ~40 open Work Orders across both companies. |
| **Business purpose** | Her first act of the day shows the whole problem. |
| **Preconditions** | — Work Orders exist for both companies |
| **Action** | Open the list. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read, decided by the legacy role string. There is no company scoping in either the Rules or the capability model. |
| **Expected UI result** | One undifferentiated list. No column, filter or badge carries an operating company. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The ownership model defines taylor and ventana as the two operating companies and Work Orders do not participate. |
| **Exception / recovery** | She recognises her accounts by name, which works until a new coordinator starts. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed WOs for both companies. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/ownership/operatingCompanyAuthority.ts:23-24`<br>`functions/src/types/workOrder.ts`<br>`firestore.rules:506-510` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S29-A02 — Create a Ventana Work Order on an account Taylor also serves

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, BAD_DATA, DESKTOP*

**Account context.** QuikMart #418 - Manitowoc ice machine (Ventana) at a store where Taylor services the frozen-beverage unit

| | |
| --- | --- |
| **Starting records / state** | One account, one location, two companies' machines. |
| **Business purpose** | The most common cross-company shape in this business. |
| **Preconditions** | — Both companies' equipment exists at the location |
| **Action** | Create a SERVICE_CALL for the ice machine. |
| **Expected EOS state transition** | A Work Order in CREATED with no company attribution. |
| **Expected authority / capability** | workOrder.create. |
| **Expected UI result** | The equipment picker is account-scoped and shows both companies' machines with nothing distinguishing them. |
| **Expected audit result** | A creation event naming Rosa, which is the only company signal. |
| **Expected cross-object effect** | Choosing the wrong machine in the picker silently switches the job to the other company with no indication at any point. |
| **Exception / recovery** | None. |
| **AI opportunity** | `CLASSIFY` — AI's value is classification/triage, not execution. |
| **Help / ⓘ opportunity** | An operating-company badge in the equipment picker row is the single highest-value change in this story. |
| **Reset / replay** | Seed both companies' equipment at one location. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/EquipmentPicker.jsx`<br>`functions/src/types/workOrder.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Nothing in the equipment picker indicates which operating company a machine belongs to, so a single mis-click silently assigns work to the wrong company with no recoverable trace. |

#### P3B1-S29-A03 — Dispatch a Ventana job to a technician who works mostly for Taylor

*Brett Hollins (dispatcher) · ventana · DESKTOP · CROSS_COMPANY, NORMAL, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | A shared technician roster. |
| **Business purpose** | Technicians are shared; companies are not. |
| **Preconditions** | — The technician is eligible |
| **Action** | Dispatch. |
| **Expected EOS state transition** | SCHEDULED -> DISPATCHED. |
| **Expected authority / capability** | Dispatch: admin/dispatcher. Neither the technician record nor the Work Order carries a company, so no check is possible. |
| **Expected UI result** | Nothing indicates a crossing. |
| **Expected audit result** | An event naming Brett and the technician. |
| **Expected cross-object effect** | Intercompany labour recharge has no data to work from. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a shared technician. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:135`<br>`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:19` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S29-A04 — Look up which company sold a machine before quoting a repair

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | A customer asks whether a repair is under warranty. |
| **Business purpose** | Warranty terms differ by company and by sale. |
| **Preconditions** | — The equipment is registered |
| **Action** | Open the equipment detail page. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The inventory-control panel shows inventory control, ownership and availability as separate honest rows - so ownership IS surfaced on equipment, which is more than the Work Order offers. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Equipment carries an ownership story; Work Orders do not. The attribution exists one object away from where it is needed. |
| **Exception / recovery** | She reads company from the equipment and carries it in her head onto the Work Order. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed equipment with ownership. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · operating-company attribution unclear |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/InventoryControlSection.jsx`<br>`functions/src/ownership/ownershipMatrix.ts:342-369` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S29-A05 — Explain why a truck homed at a Taylor warehouse is a Ventana vehicle

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | Two vehicles are Ventana assets homed at a Taylor warehouse. |
| **Business purpose** | Physical location and company ownership are different facts, and the ownership model says so explicitly. |
| **Preconditions** | — Cross-homed vehicles exist |
| **Action** | Read the ownership derivation. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The ownership matrix records the ruling directly: a truck works out of a depot; it does not thereby belong to the depot's company. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | A naive derivation from the home warehouse would assign two of five vehicles to the wrong company, which the fixture data refutes. |
| **Exception / recovery** | This is a worked example of the exact reasoning error the Work Order lacks a field to avoid. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None - the model states it clearly. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear |
| **Evidence** | `functions/src/ownership/ownershipMatrix.ts:353-369`<br>`functions/src/ownership/ownershipDerivation.ts:87,131`<br>`functions/src/ownership/warehouseRootCompanyAssignment.ts:122-126` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S29-A06 — Try to derive a Work Order's company from its account

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, MISSING_DATA, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | An account served by both companies. |
| **Business purpose** | If the Work Order has no company, perhaps the account does. |
| **Preconditions** | — A dual-served account |
| **Action** | Attempt the derivation. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The account cannot answer it, because both companies serve it. The equipment can, which means company is a property of the machine, not the customer. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Any future backfill of operatingCompanyId onto Work Orders must derive from the equipment, not the account - and Work Orders with no equipment link cannot be derived at all. |
| **Exception / recovery** | The four Work Orders created that morning with no equipment link are permanently underivable. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a dual-served account with and without equipment links. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/ownership/ownershipDerivation.ts:87`<br>`functions/src/types/workOrder.ts`<br>`firestore.rules:1439-1442` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Operating company on a Work Order could only ever be derived from its equipment link, so every Work Order created without one is permanently unattributable - which includes every job created from an ambiguous email. |

#### P3B1-S29-A07 — Work a Taylor job and a Ventana job in the same afternoon

*Tonya Reese (field_technician) · ventana · MOBILE · CROSS_COMPANY, MOBILE*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | Two dispatched Work Orders, one per company. |
| **Business purpose** | Shared technicians cross companies daily. |
| **Preconditions** | — Both jobs are dispatched to her |
| **Action** | Work both. |
| **Expected EOS state transition** | Ten transitions across two Work Orders. |
| **Expected authority / capability** | Technician, own assignment, on both. |
| **Expected UI result** | Identical. Nothing on her phone says the two jobs belong to different companies. |
| **Expected audit result** | Ten events naming her. |
| **Expected cross-object effect** | Her time splits between two companies and nothing records the split. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed two cross-company jobs. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:138-142` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S29-A08 — Send a customer a Work Order number and find it is in the shared series

*Rosa Delgado (service_coordinator) · ventana · DESKTOP · CROSS_COMPANY, UNUSUAL_BUT_LEGITIMATE, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | WO-2026-000214 was issued to a Ventana customer. |
| **Business purpose** | Both companies draw from one counter, so numbers interleave. |
| **Preconditions** | — Both companies create Work Orders |
| **Action** | Note the number sequence across companies. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Exactly one counter document per year is the only writer of the sequence for that year, so the series is shared by construction. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | A customer of one company can infer the other company's volume from the gaps in their own numbers. |
| **Exception / recovery** | Whether that matters is a business judgement, and the design decision is at least explicit. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Create WOs for both companies and observe the sequence. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear |
| **Evidence** | `functions/src/woNumbering.ts:12-14 (exactly one counter doc per year is the only writer)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S29-A09 — Unschedule a Taylor job while building the Ventana board, by mistake

*Brett Hollins (dispatcher) · ventana · DESKTOP · MISTAKE, CROSS_COMPANY, RECOVERY, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | Two companies' cards on one lane grid. |
| **Business purpose** | With no visual company distinction, mis-clicks are inevitable. |
| **Preconditions** | — Both companies' jobs are on the board |
| **Action** | Unschedule the wrong card. |
| **Expected EOS state transition** | SCHEDULED -> READY_TO_DISPATCH on a job that was not his to move. |
| **Expected authority / capability** | Permitted; no company check exists. |
| **Expected UI result** | Nothing distinguishes the cards, so nothing would have prevented it. |
| **Expected audit result** | An event naming Brett - the only evidence, and only because of who he is. |
| **Expected cross-object effect** | The Taylor coordinator's committed customer promise is gone with no notification. |
| **Exception / recovery** | Re-scheduling it is possible; noticing it is not. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | A company badge on every board card prevents this entire class. |
| **Reset / replay** | Re-schedule. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear · operating-company attribution unclear · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:133`<br>`functions/src/types/workOrder.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Two operating companies' Work Orders are visually indistinguishable on one dispatcher board, so cross-company mis-clicks are both likely and undetectable. |

#### P3B1-S29-A10 — Assess how much cross-company activity actually occurs

*Priya Raman (service_manager) · taylor · DESKTOP · CROSS_COMPANY, END_OF_MONTH, MISSING_DATA, DESKTOP*

**Account context.** QuikMart Southwest, Tucson Gas & Go, Desert Ice & Cold Storage - Ventana-side service on accounts Taylor also serves

| | |
| --- | --- |
| **Starting records / state** | A month of Work Orders and audit events. |
| **Business purpose** | Whether the missing operatingCompanyId is urgent depends on the volume. |
| **Preconditions** | — A month of data |
| **Action** | Attempt the measurement. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Not measurable from Work Orders. The nearest proxy is joining each Work Order's equipment to its ownership and comparing with the actor's own company - a reconstruction, not a report. |
| **Expected audit result** | Audit events name actors, which is the only company signal available. |
| **Expected cross-object effect** | The question 'how bad is this?' cannot be answered by the system the question is about. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a month across both companies. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · operating-company attribution unclear |
| **Evidence** | `functions/src/ownership/ownershipMatrix.ts:342-369`<br>`functions/src/types/workOrder.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S30 — The phone-call day - what a coordinator can find while a customer waits

**Account context.** Mixed - inbound phone calls across both companies

Marisol takes about forty calls a day. Each one is a lookup race: find the account, find the machine, find the last visit, find the open job, answer the question. This story measures the domain by how fast a person can answer a customer who is standing next to a broken machine.

<details><summary>10 activities — P3B1-S30-A01 · P3B1-S30-A02 · P3B1-S30-A03 · P3B1-S30-A04 · P3B1-S30-A05 · P3B1-S30-A06 · P3B1-S30-A07 · P3B1-S30-A08 · P3B1-S30-A09 · P3B1-S30-A10</summary>

#### P3B1-S30-A01 — Find an account from a caller who gives a store number and no company name

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | 'This is store 418.' |
| **Business purpose** | Customers identify themselves the way their own business does. |
| **Preconditions** | — The account exists with multiple locations |
| **Action** | Search. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The customer picker is an accessible combobox used by the wizard and inbound flows. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Store numbers are location-level, and whether locations are searchable independently of accounts is UNPROVEN. |
| **Exception / recovery** | She asks for the address instead. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a multi-location account. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/CustomerPicker.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A02 — Tell a caller whether anyone is coming today

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | An open Work Order at their location. |
| **Business purpose** | The most frequent question in service. |
| **Preconditions** | — An open WO exists for the location |
| **Action** | Find the Work Order and read its status and scheduled window. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read, subject to the workOrder.create route gate on the record page. |
| **Expected UI result** | The record page renders status as a sentence plus a lifecycle band, which is genuinely good for this question. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | 'Dispatched' does not mean 'coming today' - a future-dated job can be dispatched now, so the status alone can mislead her. |
| **Exception / recovery** | She reads the scheduled window, which is the answer. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | The status sentence is the right pattern; it must incorporate the scheduled window. |
| **Reset / replay** | Seed WOs across statuses. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrderDetailPage.jsx:247-256,331-337`<br>`functions/src/transitionEngine.ts:42-43` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A03 — Tell a caller where the technician is right now

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | WO in EN_ROUTE. |
| **Business purpose** | The second most frequent question. |
| **Preconditions** | — The WO is EN_ROUTE |
| **Action** | Look for position or ETA. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | EN_ROUTE with an enRouteAt timestamp and nothing else. No location is captured at any transition. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | She can say 'he left at 09:12', which is more than nothing and less than an answer. |
| **Exception / recovery** | She phones the technician. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed an EN_ROUTE WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/transitionEngine.ts:92-99` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A04 — Tell a caller what was done on the last visit

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | A closed Work Order from three weeks ago. |
| **Business purpose** | 'What did you do last time?' precedes every warranty argument. |
| **Preconditions** | — A closed WO with a note exists |
| **Action** | Find it and read the note. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | She searches Work Orders by customer, or opens the equipment timeline, which is the better route. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The equipment timeline combines Work Orders newest-first, which is exactly the shape of this question. |
| **Exception / recovery** | A free-text note may not answer it. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a closed WO with a note. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentTimeline.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A05 — Tell a caller whether their machine is still under warranty

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | A machine installed fourteen months ago. |
| **Business purpose** | Warranty determines who pays. |
| **Preconditions** | — The equipment has an install record |
| **Action** | Find the install date. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The equipment timeline carries the install; whether a warranty term or expiry is recorded anywhere is UNPROVEN. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | WARRANTY is a Work Order type, which classifies a job rather than recording a contract. |
| **Exception / recovery** | She checks the sales paperwork. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed an installed machine. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentTimeline.jsx`<br>`functions/src/types/workOrder.ts:37-42` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A06 — Take a call about a machine at an address she cannot find on any account

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, EXCEPTION, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | A caller at a site EOS does not know. |
| **Business purpose** | New sites, sub-let kiosks and acquired stores arrive by phone. |
| **Preconditions** | — No matching account or location |
| **Action** | Search and fail. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | An empty result. The honest-state vocabulary distinguishes NO_MATCHES from EMPTY, which matters here. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Creating a Work Order requires an account, so she must create the account first or refuse the call. |
| **Exception / recovery** | Emergency service to an unknown site has no fast path. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | 'Create this customer' at the empty result is the missing next step. |
| **Reset / replay** | Search a nonexistent address. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `field-ops-app-vite/src/shared/ui/HonestState.jsx`<br>`field-ops-app-vite/src/modules/workOrders/CustomerPicker.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A07 — Take a second call about a job she created twenty minutes ago

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | A recently created Work Order. |
| **Business purpose** | Customers call back. |
| **Preconditions** | — A WO exists from earlier today |
| **Action** | Find it. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether a recent-items or my-recent-work-orders view exists. Without one she searches from scratch forty times a day. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | None. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/workOrders/WorkOrdersList.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A08 — Take a call about a Ventana machine while signed in on the Taylor side

*Marisol Vega (service_coordinator) · taylor · DESKTOP · CROSS_COMPANY, DESKTOP, UNUSUAL_BUT_LEGITIMATE*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | A Ventana customer calls the Taylor number. |
| **Business purpose** | Customers call whichever number they have. |
| **Preconditions** | — The machine belongs to the other company |
| **Action** | Look up and act. |
| **Expected EOS state transition** | She can do everything - read, create, and, if she holds the role, schedule. |
| **Expected authority / capability** | No company boundary exists in read or write authority. |
| **Expected UI result** | Nothing tells her she is acting for the other company. |
| **Expected audit result** | Her identity is the only signal. |
| **Expected cross-object effect** | Good customer service and unattributable work are the same act. |
| **Exception / recovery** | None. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a cross-company call. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | operating-company attribution unclear · ownership unclear |
| **Evidence** | `firestore.rules:506-510`<br>`functions/src/transitionEngine.ts:128-143` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S30-A09 — Promise a time to a customer on the phone

*Marisol Vega (service_coordinator) · taylor · DESKTOP · PERMISSION_DENIAL, HANDOFF, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | An emergency call at 10:30. |
| **Business purpose** | The promise is the product. |
| **Preconditions** | — A dispatcher is available |
| **Action** | Look for capacity before promising. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. The dispatcher board is gated on the dispatcher legacy key, which a coordinator may not hold. |
| **Expected UI result** | If she cannot open the board, she cannot see capacity, and she promises blind or puts the customer on hold. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | The person talking to the customer and the person who can see the schedule are two people. |
| **Exception / recovery** | She promises 'this afternoon' and hopes. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Sign in as a coordinator without the dispatcher key. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · role handoff unclear · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/domain/constants.js:374-378`<br>`field-ops-app-vite/src/navigation/navConfig.js:660-710` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The coordinator who makes the customer promise cannot see the schedule that determines whether it can be kept, because board visibility is gated on the dispatcher role. |

#### P3B1-S30-A10 — Record what she promised the customer

*Marisol Vega (service_coordinator) · taylor · DESKTOP · MISSING_DATA, DESKTOP*

**Account context.** Mixed - inbound phone calls across both companies

| | |
| --- | --- |
| **Starting records / state** | She told them 'before 15:00'. |
| **Business purpose** | The promise is the only fact that matters at 15:01. |
| **Preconditions** | — A promise was made |
| **Action** | Look for a customer-promise field on the Work Order. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | The Work Order carries scheduled fields, which are a dispatcher's plan, not a customer's promise - and Reschedule overwrites them in place. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is why on-time performance is unanchored: the promise is never recorded and the plan that replaces it is mutable. |
| **Exception / recovery** | She writes it in the description. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:82-88`<br>`functions/src/scheduling/schedulingCommands.ts` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | There is no customer-promise field. The only time on a Work Order is a mutable dispatcher plan, so the commitment the business is judged on is never recorded. |

</details>

### P3B1-S31 — A manufacturer safety notice - finding every affected machine in the field

**Account context.** All accounts holding Taylor C712 units in a serial range

Taylor Company issues a service bulletin for a mix-pump seal on C712 units in a serial range. Priya must find every affected machine, get to each one, and prove afterwards that she did. This is the hardest read in the domain and the one with legal consequences.

<details><summary>10 activities — P3B1-S31-A01 · P3B1-S31-A02 · P3B1-S31-A03 · P3B1-S31-A04 · P3B1-S31-A05 · P3B1-S31-A06 · P3B1-S31-A07 · P3B1-S31-A08 · P3B1-S31-A09 · P3B1-S31-A10</summary>

#### P3B1-S31-A01 — Find every C712 in a serial range across all customers

*Priya Raman (service_manager) · taylor · DESKTOP · BULK, BAD_DATA, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | ~90 C712 units across the customer base. |
| **Business purpose** | Recall coverage starts with an accurate population. |
| **Preconditions** | — Equipment is registered with model and serial |
| **Action** | Search the business-wide installed-equipment list by model and serial range. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Customer Equipment is a business-wide, cross-customer, paginated installed-equipment list - which is exactly the right surface. Whether it supports a serial RANGE filter is UNPROVEN. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Any unit registered with a wrong or missing serial is invisible to the search and therefore to the recall. |
| **Exception / recovery** | The C713 recorded as a C712 earlier in this library is now in the wrong population, in both directions. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed 90 units with mixed data quality. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/CustomerEquipment.jsx (business-wide, cross-customer, paginated)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Recall population accuracy depends entirely on register data quality, and nothing measures or reports how many equipment records have missing or implausible serials. |

#### P3B1-S31-A02 — Find the machines whose serial is missing entirely

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, BULK, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | Some equipment records carry no serial number. |
| **Business purpose** | The units you cannot find are the recall's real risk. |
| **Preconditions** | — Some records lack serials |
| **Action** | Look for a data-quality view of the register. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | UNPROVEN whether any completeness view exists. Serial number is in the equipment writable-key allowlist, so it is editable - but finding the gaps is the problem. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | A machine with no serial cannot be included or excluded from a recall, so it must be visited to find out. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed records with missing serials. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · ownership unclear |
| **Evidence** | `firestore.rules:1371-1380 (serialNumber is writable)`<br>`field-ops-app-vite/src/modules/equipment/CustomerEquipment.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S31-A03 — Create Work Orders for 34 affected machines

*Priya Raman (service_manager) · taylor · DESKTOP · BULK, MISSING_DATA, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | 34 machines identified. |
| **Business purpose** | Each visit must be a governed record. |
| **Preconditions** | — The population is identified |
| **Action** | Create 34 Work Orders. |
| **Expected EOS state transition** | 34 Work Orders in CREATED, type INSPECTION or SERVICE_CALL. |
| **Expected authority / capability** | workOrder.create, 34 times. No bulk creation and no campaign grouping. |
| **Expected UI result** | 136 wizard steps. |
| **Expected audit result** | 34 creation events with nothing linking them. |
| **Expected cross-object effect** | There is no recall, campaign or bulletin object, so the only thing tying the 34 together is a convention in the description text. |
| **Exception / recovery** | A Work Order missed in the batch is indistinguishable from one that was never needed. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Delete 34 WOs; leave the counter advanced. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | AI could materially shorten the task · no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/createWorkOrder.ts:78-100`<br>`functions/src/types/workOrder.ts:37-42` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No campaign or bulletin object exists, so a safety recall is tracked by a text convention in 34 unrelated Work Order descriptions. |

#### P3B1-S31-A04 — Prove afterwards that every affected machine was visited

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, MISSING_DATA, BULK, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | 34 Work Orders in mixed states three weeks later. |
| **Business purpose** | This is the question a regulator or a manufacturer asks. |
| **Preconditions** | — Mixed completion |
| **Action** | Demonstrate coverage. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | She reconstructs the list from the equipment register and matches it by hand against Work Orders, because nothing groups them. |
| **Expected audit result** | Individual transitions are faithfully recorded; the campaign is not an object that can be reported on. |
| **Expected cross-object effect** | Completion records no outcome, so 'visited' and 'seal replaced' are indistinguishable. |
| **Exception / recovery** | A machine visited where the seal was found already correct looks identical to one where the work was done. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed mixed completion. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:68-80`<br>`field-ops-app-vite/src/modules/workOrders/WorkOrdersList.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Recall completion cannot be evidenced: no campaign grouping, and no completion outcome to distinguish 'inspected and corrected' from 'visited'. |

#### P3B1-S31-A05 — Arrive at a machine whose serial is outside the recall range after all

*Javier Ochoa (field_technician) · taylor · MOBILE · BAD_DATA, MOBILE, RECOVERY*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | The register said in-range; the plate says otherwise. |
| **Business purpose** | Plate versus register disagreement is the recurring theme of the equipment domain. |
| **Preconditions** | — The register serial is wrong |
| **Action** | Scan the plate and compare. |
| **Expected EOS state transition** | None. He can resolve the true identity and cannot correct the Work Order. |
| **Expected authority / capability** | Scan resolution; no Work Order edit. |
| **Expected UI result** | He is standing at the answer and cannot record it. |
| **Expected audit result** | Whatever he does is the record. |
| **Expected cross-object effect** | The recall population is now known to be wrong and there is no path to fix it from the field. |
| **Exception / recovery** | He phones it in and someone may or may not correct the register. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a serial mismatch. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `field-ops-app-vite/src/modules/mobile/PartsScanner.jsx`<br>`field-ops-app-vite/src/App.jsx:1044-1052` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The technician can prove the register is wrong and has no in-product way to correct it, so every field-discovered data error depends on a phone call being made and acted on. |

#### P3B1-S31-A06 — Fit the recall kit and record it as a serialized or lot-tracked part

*Javier Ochoa (field_technician) · taylor · MOBILE · EXCEPTION, BAD_DATA, MOBILE*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | The seal kit may be lot-controlled for traceability. |
| **Business purpose** | Recall parts are exactly the parts that need traceability. |
| **Preconditions** | — The kit's controlType determines its tracking mode |
| **Action** | Record the part used. |
| **Expected EOS state transition** | If the kit is LOT-tracked, the quantity-only Work Order capture refuses it. |
| **Expected authority / capability** | Execution capture on his own Work Order. |
| **Expected UI result** | A refusal naming LOT, on the one part class where traceability matters most. |
| **Expected audit result** | Nothing recorded. |
| **Expected cross-object effect** | The recall's own traceability requirement is defeated by the capture surface's quantity-only design. |
| **Exception / recovery** | The lot number goes in a free-text note. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a LOT-controlled kit. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionPartTracking.ts:57-65` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Lot-traceable recall parts cannot be recorded through Work Order usage capture at all, so the traceability the recall exists to provide is captured only as free text. |

#### P3B1-S31-A07 — Report the recall to the manufacturer with serial-level evidence

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, BULK, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | 34 completed visits. |
| **Business purpose** | The manufacturer pays on evidence. |
| **Preconditions** | — Visits completed |
| **Action** | Assemble serial-level evidence. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | She has Work Orders linked to equipment, and equipment carrying serials, so the join exists - assembled by hand. |
| **Expected audit result** | The equipment timeline ties Work Orders to units, which is the evidence. |
| **Expected cross-object effect** | This is one thing the model does support, via the equipment link, and it is worth recording as a strength. |
| **Exception / recovery** | Any Work Order created without an equipment link contributes nothing. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed completed visits with equipment links. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · AI could materially shorten the task |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentTimeline.jsx`<br>`firestore.rules:1439-1442` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S31-A08 — Answer a customer asking whether their machine is affected

*Marisol Vega (service_coordinator) · taylor · DESKTOP · NORMAL, MISSING_DATA, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | A customer calls having read the bulletin online. |
| **Business purpose** | Recalls generate inbound calls immediately. |
| **Preconditions** | — The customer's equipment is registered |
| **Action** | Look up the machine and answer. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | She reads the model and serial from the equipment record - which is only as good as the register. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Nothing on the equipment record flags it as in scope for a recall, because recalls are not an object. |
| **Exception / recovery** | She checks the serial against the bulletin by eye. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a customer machine in range. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `field-ops-app-vite/src/modules/equipment/EquipmentDetail.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S31-A09 — Schedule 34 recall visits around normal service demand

*Priya Raman (service_manager) · taylor · DESKTOP · BULK, EXCEPTION, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | 34 recall Work Orders plus the normal week. |
| **Business purpose** | A recall competes with revenue work for the same technicians. |
| **Preconditions** | — Both kinds of demand exist |
| **Action** | Schedule them. |
| **Expected EOS state transition** | 34 placements interleaved with normal work, each validated identically. |
| **Expected authority / capability** | Schedule. |
| **Expected UI result** | Nothing distinguishes a mandatory recall visit from a routine call on the board - priority is a Work Order field, but the scheduler treats all priorities identically. |
| **Expected audit result** | 34 events. |
| **Expected cross-object effect** | A dispatcher under pressure will defer the recall visits because nothing makes them non-deferrable. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed mixed demand. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location |
| **Evidence** | `functions/src/scheduling/placementPolicy.ts:65-126`<br>`functions/src/types/workOrder.ts:28-30` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Priority has no effect on scheduling behaviour, so mandatory safety work is as deferrable as a routine call. |

#### P3B1-S31-A10 — Close the recall and record that it is complete

*Priya Raman (service_manager) · taylor · DESKTOP · END_OF_MONTH, BULK, MISSING_DATA, DESKTOP*

**Account context.** All accounts holding Taylor C712 units in a serial range

| | |
| --- | --- |
| **Starting records / state** | All 34 visits complete. |
| **Business purpose** | A recall must have an end. |
| **Preconditions** | — All visits complete |
| **Action** | Look for a way to record campaign completion. |
| **Expected EOS state transition** | 34 individual closes and nothing else. |
| **Expected authority / capability** | Close, 34 times. |
| **Expected UI result** | No campaign object means no campaign completion. |
| **Expected audit result** | 34 closedAt timestamps. |
| **Expected cross-object effect** | The recall's completion lives in a document outside EOS, which is where the evidence will be looked for years later. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | Fresh fixtures. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · ownership unclear |
| **Evidence** | `functions/src/transitionEngine.ts:136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S32 — Cleanup Monday - putting right a week that went wrong

**Account context.** Mixed - the accumulated damage from this library's defects

A week of the failures catalogued in this library has left the data in a state someone must now fix: duplicate Work Order numbers, jobs stuck in DISPATCHED, an unrecordable holiday, a truck join that resolves nothing, and parts recorded against warehouses nobody visited. This story tests whether EOS supports recovery at all.

<details><summary>10 activities — P3B1-S32-A01 · P3B1-S32-A02 · P3B1-S32-A03 · P3B1-S32-A04 · P3B1-S32-A05 · P3B1-S32-A06 · P3B1-S32-A07 · P3B1-S32-A08 · P3B1-S32-A09 · P3B1-S32-A10</summary>

#### P3B1-S32-A01 — Find every Work Order stuck in a non-terminal state for more than five days

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, MISSING_DATA, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | Eleven aged Work Orders. |
| **Business purpose** | Stuck work is the first thing to clear. |
| **Preconditions** | — Aged non-terminal WOs exist |
| **Action** | Filter by status and age. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Age is computable from the execution timestamps that exist for Dispatch onwards. For a Work Order stuck in CREATED or READY_TO_DISPATCH there is NO execution timestamp at all, so its age is only knowable from the audit stream. |
| **Expected audit result** | The transition events carry the answer. |
| **Expected cross-object effect** | The statuses most likely to strand a Work Order are exactly the ones with no timestamp. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed aged WOs across statuses. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location |
| **Evidence** | `functions/src/transitionEngine.ts:92-99 (no timestamp for MarkReady, Unschedule or Schedule)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Work Orders stranded in CREATED or READY_TO_DISPATCH have no timestamp on the record, so the two states most likely to strand work are the two whose age cannot be read from it. |

#### P3B1-S32-A02 — Clear a Work Order stuck in DISPATCHED for six days

*Dale Brackett (dispatcher) · taylor · DESKTOP · RECOVERY, EXCEPTION, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | DISPATCHED, never accepted, technician has left the company. |
| **Business purpose** | It blocks dispatch to a technician who no longer exists. |
| **Preconditions** | — An orphaned DISPATCHED WO |
| **Action** | Try to recover it. |
| **Expected EOS state transition** | Cancel is the only available action. There is no way back to SCHEDULED or READY_TO_DISPATCH from DISPATCHED. |
| **Expected authority / capability** | Cancel: admin/dispatcher. |
| **Expected UI result** | He cancels a job the customer still needs, then creates a new one. |
| **Expected audit result** | A cancellation and a creation. |
| **Expected cross-object effect** | A new woNumber is burned and the customer gets a new reference for the same request. |
| **Exception / recovery** | This is the standard recovery for every stranded Work Order and it always costs a number and a customer explanation. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed an orphaned DISPATCHED WO. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:43`<br>`functions/src/transitionEngine.ts:137` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Cancel-and-recreate is the only recovery for any Work Order stranded after Dispatch, because the lifecycle has exactly one reverse edge and it is upstream of the problem. |

#### P3B1-S32-A03 — Find and fix the duplicate Work Order numbers

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, DUPLICATE_DATA, BAD_DATA, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | Two Work Orders share WO-2026-000001. |
| **Business purpose** | Customer-facing ambiguity must be resolved. |
| **Preconditions** | — Duplicate woNumbers exist |
| **Action** | Detect and correct. |
| **Expected EOS state transition** | None available. There is no renumber action and no uniqueness constraint to have prevented it. |
| **Expected authority / capability** | No in-product path exists; this is MISSING_CAPABILITY and requires a data intervention. |
| **Expected UI result** | Nothing detects it. |
| **Expected audit result** | Both creation events stand. |
| **Expected cross-object effect** | The counter must also be reset to the correct high-water mark, or the collision recurs on every subsequent create. |
| **Exception / recovery** | Fixing the counter without fixing the existing duplicates leaves the ambiguity in place forever. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed duplicates and a missing counter. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · ownership unclear |
| **Evidence** | `functions/src/woNumbering.ts:44-59`<br>`functions/src/woNumbering.ts:6-11` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | No detection, no constraint and no renumber path for duplicate woNumbers. Recovery requires a data intervention and the counter must be repaired separately or the defect recurs immediately. |

#### P3B1-S32-A04 — Record the holiday closure that could not be recorded last week

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, EXCEPTION, BULK, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | Technicians' lunch blocks still exist; the closure is still unrecorded. |
| **Business purpose** | The next holiday is in six weeks. |
| **Preconditions** | — Lunch blocks overlap the intended closure |
| **Action** | Delete each technician's lunch block, create the closure, then recreate the lunches. |
| **Expected EOS state transition** | Each delete succeeds; the closure then succeeds; recreating the lunches then FAILS, because they now overlap the closure. |
| **Expected authority / capability** | Scheduling command authority throughout. |
| **Expected UI result** | A workaround that cannot be completed - the lunches cannot be restored while the closure exists. |
| **Expected audit result** | Deletions and one creation. |
| **Expected cross-object effect** | The organisation must choose between recording its holiday and recording its lunch breaks. Under the Owner's union ruling both are legitimate facts and both should coexist. |
| **Exception / recovery** | After the holiday passes, the lunches must be recreated by hand for every technician. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed lunches and attempt a closure. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | help missing when needed · no obvious "why?" location · no obvious "what next?" location · recovery unclear |
| **Evidence** | `functions/src/scheduling/schedulingCommands.ts:460-468`<br>`functions/src/scheduling/availabilityModel.ts:289-311 (the model already unions correctly)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The overlap refusal makes its own workaround impossible: deleting lunches to record a closure means the lunches cannot be restored until the closure is deleted. The organisation must choose which true fact to record. |

#### P3B1-S32-A05 — Correct inventory misattributed by the truck-join failure

*Nate Purcell (parts_counter) · taylor · DESKTOP · RECOVERY, BAD_DATA, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | A week of parts recorded against warehouses that were physically on trucks. |
| **Business purpose** | The counts are wrong in two directions. |
| **Preconditions** | — Misattributed consumption exists |
| **Action** | Identify and correct. |
| **Expected EOS state transition** | A correction is an inventory movement, not a Work Order action. |
| **Expected authority / capability** | Inventory adjustment authority, separate from service. |
| **Expected UI result** | Nothing identifies WHICH consumptions were misattributed - a correct warehouse consumption and a misattributed one are identical rows. |
| **Expected audit result** | The corrections are recorded; the original error is not identifiable. |
| **Expected cross-object effect** | The only way to find them is to know which technicians' truck joins were failing and when. |
| **Exception / recovery** | In practice the variance is written off at cycle count. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed misattributed consumption. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:59-90` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Misattributed parts consumption is indistinguishable from correct consumption after the fact, so the truck-join defect leaves damage that cannot be identified, only written off. |

#### P3B1-S32-A06 — Fix the technician-to-truck join so it stops failing

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, BAD_DATA, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | The join resolved 0 of 13. |
| **Business purpose** | Until this is fixed every subsequent week repeats the damage. |
| **Preconditions** | — The join is failing |
| **Action** | Determine which id belongs in trucks.assignedDriverEmployeeId. |
| **Expected EOS state transition** | A data correction, not a product action. |
| **Expected authority / capability** | Truck registry authority. The registry enforces cross-truck driver uniqueness on write, so correcting it one truck at a time is safe. |
| **Expected UI result** | The correction is made in the truck registry, which validates that the employee is active. |
| **Expected audit result** | Registry changes are attributable. |
| **Expected cross-object effect** | The consumption source service queries trucks by assignedDriverEmployeeId equal to the technicianId it was given, so either the stored value or the value passed must change - and this lane does not adjudicate which. |
| **Exception / recovery** | Correcting it in the wrong direction breaks the driver-uniqueness invariant. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed correct and incorrect joins and compare. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:76`<br>`functions/src/truckRegistry/truckRegistryCommands.ts:193,278-283` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S32-A07 — Close the Work Orders left completed-but-empty

*Amanda Foy (service_billing_admin) · taylor · DESKTOP · RECOVERY, END_OF_MONTH, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | Nine empty completions from the week. |
| **Business purpose** | They are unbillable and they block the close. |
| **Preconditions** | — Empty COMPLETED WOs |
| **Action** | Decide what to do. |
| **Expected EOS state transition** | Close them, or leave them. |
| **Expected authority / capability** | Close: admin/dispatcher. There is no reject or reopen. |
| **Expected UI result** | Two bad options. |
| **Expected audit result** | Whatever she chooses. |
| **Expected cross-object effect** | Closing them asserts the record is good enough to bill, which it is not. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed empty completions. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "what next?" location · recovery unclear · role handoff unclear |
| **Evidence** | `functions/src/transitionEngine.ts:48,136` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S32-A08 — Work out what the week's data actually says happened

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, BAD_DATA, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | Every defect in this library present at once. |
| **Business purpose** | Before fixing anything, know what is true. |
| **Preconditions** | — A week of damaged data |
| **Action** | Reconstruct. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | The audit event stream is the only complete record, and it is not a service-domain surface. |
| **Expected audit result** | Audit events are the ground truth, staged with the transactions that produced them. |
| **Expected cross-object effect** | Client writes to the legacy fieldops_jobs collection produce NO audit event at all, so anything done there is invisible in the reconstruction. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed the full damage set. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "why?" location · ownership unclear |
| **Evidence** | `functions/src/access/auditEventWriter.ts:769-830`<br>`firestore.rules:352-394` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The legacy fieldops_jobs client-write path produces no audit events, so any activity there is permanently absent from any reconstruction of what happened. |

#### P3B1-S32-A09 — Read the audit history for one Work Order end to end

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | One Work Order that went through the full lifecycle. |
| **Business purpose** | Per-record history is the tool a cleanup actually needs. |
| **Preconditions** | — A completed lifecycle |
| **Action** | List the audit events for the record. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. A per-record audit listing exists server-side. |
| **Expected UI result** | UNPROVEN whether a service-domain surface exposes it, or whether it is an engineering-only read. |
| **Expected audit result** | The events are staged with the transactions that produced them, so they cannot disagree with the record. |
| **Expected cross-object effect** | Staging audit events inside the same transaction as the state change is the property that makes this trustworthy. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Seed a full lifecycle. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location |
| **Evidence** | `functions/src/access/auditEventWriter.ts:780,811,867 (stageAuditEvent, listAuditEventsForRecord)` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S32-A10 — Decide which defects to fix first

*Priya Raman (service_manager) · taylor · DESKTOP · RECOVERY, END_OF_MONTH, DESKTOP*

**Account context.** Mixed - the accumulated damage from this library's defects

| | |
| --- | --- |
| **Starting records / state** | The full list from this week. |
| **Business purpose** | The point of a cleanup is to stop the next one. |
| **Preconditions** | — The damage is catalogued |
| **Action** | Prioritise. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | n/a. |
| **Expected UI result** | n/a. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | The defects that recur silently and damage other domains - the truck join, the blocked-time overlap refusal, the missing operating company and the woNumber counter - rank above the ones that merely annoy. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:76`<br>`functions/src/scheduling/schedulingCommands.ts:460-468`<br>`functions/src/types/workOrder.ts`<br>`functions/src/woNumbering.ts:50` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

</details>

### P3B1-S33 — Day one - a new technician, and everything that must be true before he can work

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

Wes Tanner starts on a Monday. Between a signed offer letter and his first tapped Accept lies a chain of records that must all be correct: a user, a role, a technician, a technicianId link, an employee, a truck, working availability. Any one of them missing produces a different kind of broken day.

<details><summary>10 activities — P3B1-S33-A01 · P3B1-S33-A02 · P3B1-S33-A03 · P3B1-S33-A04 · P3B1-S33-A05 · P3B1-S33-A06 · P3B1-S33-A07 · P3B1-S33-A08 · P3B1-S33-A09 · P3B1-S33-A10</summary>

#### P3B1-S33-A01 — Create the technician record for a new starter

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, PERMISSION_DENIAL, DESKTOP*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | No records exist for Wes. |
| **Business purpose** | The technician record is what the Work Order's assignedTechId points at. |
| **Preconditions** | — The new starter exists as a person |
| **Action** | Create a fieldops_technicians record with name and phone. |
| **Expected EOS state transition** | A technician record exists. |
| **Expected authority / capability** | The legacy technicians directory that offered this create is orphaned - no longer reachable from routed navigation, and its own header records it was attempted and declined for cause. Administration now redirects to users. |
| **Expected UI result** | There is no reachable technician-create screen. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | A technician record carries name, phone and status only - no company, no skills, no location, no certifications. |
| **Exception / recovery** | The record must be created by an administrative or scripted path. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Delete the technician record. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/modules/technicians/Technicians.jsx (orphaned, unreachable)`<br>`field-ops-app-vite/src/App.jsx:1011-1015`<br>`field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:79-84` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`MANUAL_CONFIGURATION`) — No reachable UI exists for technician creation; exercising this requires an administrative or scripted path.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | The only technician-create UI is orphaned and unreachable, so onboarding a technician requires an administrative path outside the application. |

#### P3B1-S33-A02 — Link the new user account to the technician record

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, PERMISSION_DENIAL, DESKTOP*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | A user account exists with role technician; technicianId is unset. |
| **Business purpose** | This one field decides whether the app works for him at all. |
| **Preconditions** | — The user account exists |
| **Action** | Set users/{uid}.technicianId. |
| **Expected EOS state transition** | The two-hop identity resolves. |
| **Expected authority / capability** | users/{uid} is Admin-SDK-written with client writes denied, which is what makes technicianId trustworthy as an authorisation input. |
| **Expected UI result** | No self-service path; the field is deliberately client-immutable. |
| **Expected audit result** | An administrative change. |
| **Expected cross-object effect** | Rules read the same field via callerTechnicianId(), so the link governs both the app's reads and the data layer's authorisation. |
| **Exception / recovery** | Forgetting this field is the single most common onboarding failure and presents as an empty jobs list. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Clear the field. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · no obvious "what next?" location · ownership unclear |
| **Evidence** | `firestore.rules:320-327 (Admin-SDK-written, allow write: if false, client-immutable)`<br>`field-ops-app-vite/src/hooks/useCurrentTechnician.js` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S33-A03 — Sign in on day one and see an empty jobs list

*Wes Tanner (apprentice_technician) · taylor · MOBILE · MOBILE, MISSING_DATA*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | Everything linked correctly; no work assigned yet. |
| **Business purpose** | Day one is legitimately empty, and it must not look broken. |
| **Preconditions** | — The identity resolves<br>— No assignments exist |
| **Action** | Open the jobs list. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read, scoped to his own assignments. |
| **Expected UI result** | The honest-state vocabulary distinguishes EMPTY from NO_MATCHES from CAPABILITY_NOT_ENABLED, which is precisely what separates 'no work today' from 'your account is not linked'. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | Whether the technician surfaces actually use the right honest state here is the thing worth executing. |
| **Exception / recovery** | A wrong honest state on day one costs an hour of somebody's time. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | This IS the help, and the vocabulary to deliver it already exists. |
| **Reset / replay** | Seed a linked technician with no work. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location |
| **Evidence** | `field-ops-app-vite/src/shared/ui/HonestState.jsx`<br>`field-ops-app-vite/src/modules/technicianDashboard/TechnicianDashboard.jsx` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S33-A04 — Record Wes's working hours so the board can draw his lane

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, NORMAL, DESKTOP*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | No working availability document. |
| **Business purpose** | Without it, every capacity number for him is null and every placement warns. |
| **Preconditions** | — The technician record exists |
| **Action** | Record weekly hours and a time zone. |
| **Expected EOS state transition** | A working-availability record exists. |
| **Expected authority / capability** | Scheduling command authority. |
| **Expected UI result** | Weekly hours per weekday plus an IANA time zone - stored as a zone rather than a fixed offset deliberately, because a stored offset is correct for half the year and silently wrong for the other half. |
| **Expected audit result** | An administrative change. |
| **Expected cross-object effect** | Until this exists, placements produce NO_WORKING_AVAILABILITY_RECORDED and his capacity reads as unknown rather than zero. |
| **Exception / recovery** | An unparseable zone produces the same warning rather than a crash. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Delete the availability record. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/scheduling/availabilityModel.ts:47-62 (Intl rather than a fixed offset)`<br>`functions/src/scheduling/availabilityModel.ts:219-244` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S33-A05 — Assign Wes a truck so his parts have a source

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, BAD_DATA, DESKTOP*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | A truck exists with no driver. |
| **Business purpose** | Without a truck, the parts source picker offers only warehouses. |
| **Preconditions** | — An active truck exists<br>— Wes has an employees record |
| **Action** | Set the truck's driver. |
| **Expected EOS state transition** | The truck names an assigned driver. |
| **Expected authority / capability** | Truck registry: the command refuses an employee who is not active, and enforces that an employee may be the assigned driver on at most one truck. |
| **Expected UI result** | The registry validates both constraints. |
| **Expected audit result** | A registry change. |
| **Expected cross-object effect** | This is where the two id spaces meet: the registry stores an employees id, while the consumption source service looks the truck up by the technicianId it was passed. |
| **Exception / recovery** | Assigning correctly in the registry does not guarantee the consumption-side lookup resolves, because the two sides may be using different id spaces. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Unassign the driver. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `functions/src/truckRegistry/truckRegistryCommands.ts:193,278-283`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:76` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_CALLABLE`) — Exercises a server command or callable that reads or writes Firestore. Needs the emulator, which hangs on the occupied port.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S33-A06 — Verify on day one that his truck appears as a parts source

*Wes Tanner (apprentice_technician) · taylor · MOBILE · MOBILE, BAD_DATA, NORMAL*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | A truck is assigned; he has a Work Order in progress. |
| **Business purpose** | This is the only way to find out whether the join works, and it is worth doing on day one rather than at month end. |
| **Preconditions** | — A truck is assigned<br>— A WO is in progress |
| **Action** | Increment a part and open the source picker. |
| **Expected EOS state transition** | None until submitted. |
| **Expected authority / capability** | The server resolves his own governed truck. |
| **Expected UI result** | If 'My truck' appears, the join works. If it does not, one of four causes applies and the UI says which of them - none. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | A day-one verification step would have caught the 0-of-13 join failure before a week of misattributed inventory. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Break and restore the join. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/workOrderConsumption/consumptionSourceService.ts:59-90`<br>`field-ops-app-vite/src/modules/technicianDashboard/ExecutionCapture.jsx:77-104` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — Asserts rendered React behaviour. `node --test` cannot run .test.jsx, and the browser harness additionally needs the Firestore emulator.<br>Core assertion: not unit-assertable (`NOT_UNIT_ASSERTABLE`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S33-A07 — Dispatch Wes his first job

*Dale Brackett (dispatcher) · taylor · DESKTOP · NORMAL, HANDOFF, BAD_DATA, DESKTOP*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | A SCHEDULED Work Order. |
| **Business purpose** | The first dispatch exercises the whole chain. |
| **Preconditions** | — Wes's identity resolves<br>— The WO is SCHEDULED |
| **Action** | Dispatch. |
| **Expected EOS state transition** | SCHEDULED -> DISPATCHED with assignedTechId set to Wes's technicianId. |
| **Expected authority / capability** | Dispatch: admin/dispatcher. |
| **Expected UI result** | The job should appear on his phone. |
| **Expected audit result** | dispatchedAt. |
| **Expected cross-object effect** | If the dispatcher picks him from a list keyed on a different id space than the one Rules compare, the job is dispatched to a technician who cannot read it. |
| **Exception / recovery** | A job dispatched to an id that does not match the technician's own technicianId is invisible to everyone except admins and dispatchers. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · recovery unclear |
| **Evidence** | `functions/src/transitionEngine.ts:89-91,135`<br>`firestore.rules:507-508` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A Work Order dispatched with an assignedTechId that does not match any users/{uid}.technicianId is invisible to every technician while looking perfectly normal on the dispatcher board. |

#### P3B1-S33-A08 — Accept his first job

*Wes Tanner (apprentice_technician) · taylor · MOBILE · MOBILE, NORMAL*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | WO DISPATCHED to him. |
| **Business purpose** | The first Accept is the proof the whole chain works. |
| **Preconditions** | — Everything above is correct |
| **Action** | Tap Accept. |
| **Expected EOS state transition** | DISPATCHED -> ACCEPTED with acceptedAt. |
| **Expected authority / capability** | Accept: technician, requiresOwnAssignment true - both must hold, which means the identity chain must be correct end to end. |
| **Expected UI result** | The button appears because the client mirror of getAllowedActions computed the same answer the server would. |
| **Expected audit result** | acceptedAt. |
| **Expected cross-object effect** | This single tap proves: the user doc, the role, the technicianId link, the technician record, the assignedTechId match, the Rules read gate and the callable authorisation. |
| **Exception / recovery** | If any link is wrong he either cannot see the job or cannot act on it, and the two failures look the same. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | None. |
| **Reset / replay** | Fresh fixture. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | none raised |
| **Evidence** | `functions/src/transitionEngine.ts:138,152-172`<br>`field-ops-app-vite/src/domain/workOrderWorkflow.js:80`<br>`firestore.rules:507-508` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER_AND_CLIENT`) |
| **Execution result** | `NOT_RUN` |

#### P3B1-S33-A09 — Check that the new technician does not appear in recommendations before he is ready

*Priya Raman (service_manager) · taylor · DESKTOP · BAD_DATA, MISSING_DATA, DESKTOP*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | The technician record exists with status 'available' from the moment it is created. |
| **Business purpose** | A technician who exists in the data but not yet on the road will be recommended for work. |
| **Preconditions** | — The technician record exists with a default status |
| **Action** | Read the recommendations on the dispatcher board. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | Availability is scored from the technician status string, so a record created as available scores 100 from day zero - before training, before a truck, before working hours. |
| **Expected audit result** | None. |
| **Expected cross-object effect** | This is the same defect as the PTO case seen from the other end: the score reflects a status string, not governed readiness. |
| **Exception / recovery** | Marking him off_shift keeps him out of the ranking and is the only lever available. |
| **AI opportunity** | `NONE` — No AI role; judgement and physical presence carry the task. |
| **Help / ⓘ opportunity** | n/a. |
| **Reset / replay** | Create a technician and read the board. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | no obvious "why?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/domain/technicianRecommendationEngine.ts:112-126` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`UI_BROWSER`) — The activity is a persona acting through an application surface, which needs the app running against the Firestore emulator; the emulator hangs on the occupied port.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_CLIENT`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | A newly created technician record scores 100 on availability immediately and is recommended for work before any onboarding step has been completed. |

#### P3B1-S33-A10 — Record the onboarding chain so the next starter is faster

*Priya Raman (service_manager) · taylor · DESKTOP · MISSING_DATA, RECOVERY, DESKTOP*

**Account context.** n/a - onboarding, then first jobs at Cactus Burger Co. #12

| | |
| --- | --- |
| **Starting records / state** | Seven records had to be correct for one technician to tap Accept. |
| **Business purpose** | The chain is knowledge that currently lives in one person's head. |
| **Preconditions** | — The onboarding is complete |
| **Action** | Look for an onboarding checklist or linkage-health view in EOS. |
| **Expected EOS state transition** | None. |
| **Expected authority / capability** | Read. |
| **Expected UI result** | No surface reports whether a technician is fully onboarded: user, role, technicianId, technician record, employee, truck and availability are seven records with no single view. |
| **Expected audit result** | n/a. |
| **Expected cross-object effect** | This absence is why 0 of 13 technicians could fail a join with nobody noticing. |
| **Exception / recovery** | n/a. |
| **AI opportunity** | `SHORTEN` — AI could materially shorten this task. |
| **Help / ⓘ opportunity** | n/a - MISSING_CAPABILITY. |
| **Reset / replay** | n/a. |
| **Behaviour claim** | `CURRENT` |
| **Friction** | had to hunt for necessary information · no obvious "what next?" location · ownership unclear |
| **Evidence** | `field-ops-app-vite/src/hooks/useCurrentTechnician.js`<br>`functions/src/workOrderConsumption/consumptionSourceService.ts:76`<br>`functions/src/scheduling/availabilityModel.ts:219-244`<br>`firestore.rules:320-327` |
| **Executability** | Full activity `BLOCKED_BY_TEST_ENVIRONMENT` (`EMULATOR_RULES`) — Asserts a Firestore Rules outcome. Rules assertions need the Firestore emulator, whose suites hang because port 8080 is held by an unrelated uvicorn process.<br>Core assertion: **unit-assertable today** (`PURE_UNIT_SERVER`) |
| **Execution result** | `NOT_RUN` |
| **Defects this would catch** | Technician onboarding spans seven records across four domains with no single readiness view, which is the structural reason identity and truck join failures go undetected. |

</details>

## Execution-harness specification

### 1. What an activity is, to a harness

An activity is a tuple of *(seeded world, actor identity, one action, a set of assertions)*. The assertions are the `expected*` fields, and they must be checked on **five independent axes**, because a defect that satisfies four and fails one is exactly the kind this library exists to catch:

1. **State** — the record's status and fields after the action, against `expectedEosStateTransition`.
2. **Authority** — that the action is permitted or refused for the reason given, against `expectedAuthorityCapability`. A refusal for the *wrong* reason is a failure.
3. **Audit** — that history records what `expectedAuditResult` says, and nothing it does not.
4. **Cross-object** — counters, inventory balances, serialized custody, technician capacity, against `expectedCrossObjectEffect`. This is where the highest-value defects live.
5. **Surface** — what the persona actually sees, against `expectedUiResult`. Several defects in this library are *only* visible here: four distinct truck-resolution failures that render identically, and an unlinked technician account that looks like a quiet day.

### 2. Safety rules, non-negotiable

- **Never execute against production.** Not read-only, not "just a lookup". The Taylor and Ventana production project is out of scope for every activity here.
- **Never execute against `/mnt/d/Taylor_Parts`** or any sibling worktree.
- An activity that has not been executed is `NOT_RUN`. **It may never be recorded as `PASS`.**
- An activity whose environment could not be brought up is `BLOCKED_BY_TEST_ENVIRONMENT`, never `PASS` and never a silent skip.
- Seed data must be recognisably synthetic (`cert-`/`sandbox-` prefixes, fictional store numbers) so that a fixture can never be mistaken for a customer record.

### 3. The four execution tiers

| Tier | What it runs | Needs | Available tonight |
| --- | --- | --- | --- |
| **T1 — pure unit** | Domain claims over pure modules: the transition table, the availability model, the double-booking and schedule-conflict guards, WO number allocation arithmetic, tracking-mode derivation, the recommendation engine, the client action mirror | `node --test` over `.mjs`; no emulator, no browser | **Yes** |
| **T2 — Rules** | Read/write gates: `fieldops_wos` client writes denied, technician own-assignment scoping, `callerTechnicianId()` fail-closed, the legacy `fieldops_jobs` client-writable lifecycle, equipment account/location coupling | Firestore emulator + rules-unit-testing | **No** — port 8080 held by an unrelated uvicorn process |
| **T3 — callable / command** | Server commands end to end: create, transition, schedule, reschedule, blocked time, inbound decisions, consumption sources | Firestore emulator + functions runtime + seeded fixtures | **No** — same blocker |
| **T4 — surface** | The persona's actual journey through the app, including the honest-state vocabulary, the source picker, the sync queue, the placement dialog | Vite dev server + emulator + browser driver | **No** — `.test.jsx` is unrunnable under `node --test`, and the browser path additionally needs the emulator |

### 4. Executability of this library, as of authoring

| Measure | Count |
| --- | ---: |
| Activities executable **end to end** today | **0 of 330** |
| Activities whose **core domain assertion** is unit-assertable today (T1) | **223 of 330** |
| Activities blocked, by dominant blocker | UI_BROWSER 226 · EMULATOR_CALLABLE 39 · EMULATOR_RULES 36 · DEVICE_OFFLINE 14 · EMULATOR_CALLABLE_PLUS_TRANSPORT 12 · MANUAL_CONFIGURATION 3 |

This split is the honest answer and it is worth stating plainly: **no activity in this library can be performed end to end tonight**, because every activity is a persona acting through a surface and every surface needs either the Firestore emulator or the browser. What is available tonight is tier T1, and 223 of 330 activities have a central claim that can be asserted there — enough to catch the transition-table, availability-model, double-booking, tracking-mode and recommendation-scoring defects without any environment work at all.

### 5. Unblocking T2–T4

The single blocker is port 8080. The Firestore emulator's default port is occupied by an unrelated uvicorn process, and every emulator suite hangs rather than failing fast. Two remedies, in preference order:

1. **Move the emulator**, not the uvicorn process: set an alternate `firestore.port` in `firebase.json` (or `FIRESTORE_EMULATOR_HOST`) for the test profile, so the suite never contends for 8080. This is reversible and touches no runtime code.
2. **Fail fast instead of hanging**: give emulator-dependent suites a connect timeout, so a blocked environment reports `BLOCKED_BY_TEST_ENVIRONMENT` in seconds instead of appearing to run. A hang is the worst possible outcome, because it is indistinguishable from slow progress.

For T4, `.test.jsx` needs a runner that understands JSX; the `run-field-ops-app-vite` skill already starts the dev server, the emulator and a Playwright driver, and is the intended path once the port contention is resolved.

### 6. Seeding — the world each tier needs

| Fixture set | Contents | Used by |
| --- | --- | --- |
| **Accounts & locations** | 8 accounts, 20 locations, including one account served by both operating companies and one location holding machines of both | S01, S03, S25, S29, S30 |
| **Equipment** | ~40 units across Taylor C602/C712/C713, Manitowoc, Vogt, Scotsman, FBD; deliberately including one wrong model, one missing serial, one registered against a mismatched location | S03, S26, S31 |
| **Technicians & identity** | 13 `fieldops_technicians`; one with no `users/{uid}.technicianId`; one with an off-vocabulary status; trucks assigned by *both* id spaces so the join failure is reproducible in one run | S09, S13, S33 |
| **Availability & blocked time** | Working hours for 5 of 6 technicians; daily LUNCH blocks; a PTO day; a TRAINING block adjacent to a TRUCK_SERVICE block; an intended COMPANY_CLOSURE that currently cannot be created | S05, S06, S22, S28 |
| **Work Orders** | A day's spread across all eleven statuses, plus aged records in `CREATED`, `READY_TO_DISPATCH` and `DISPATCHED` | S07, S08, S22, S32 |
| **Counters** | Two variants: a healthy `counters/work_orders_2026`, and an **absent** one with 140 pre-existing 2026-numbered Work Orders | S02, S24, S32 |
| **Parts & tracking** | One NONE-tracked, one SERIAL-tracked, one LOT-tracked and one part with **no** `controlType`; bin placements picked for a Work Order | S13, S14, S23 |
| **Inbound work** | 11 provider messages: genuine, spam, duplicate message id, unknown mailbox, ambiguous thread, oversized, cross-company | S01, S27 |

### 7. Reset and replay

Every activity carries a `resetReplayNotes` field. Four rules govern them all:

1. **Never roll back the WO number counter.** Deleting a Work Order must leave `counters/work_orders_2026` advanced. Rewinding it reproduces the duplicate-number defect inside the harness itself. (`functions/src/woNumbering.ts:44-59`)
2. **Terminal is terminal.** `COMPLETED`, `CLOSED` and `CANCELLED` have no reverse edge, and neither does anything after `DISPATCHED` except via `CANCELLED`. A reset is a **fresh fixture**, never a status rewrite — rewriting status directly would bypass the very engine under test. (`functions/src/transitionEngine.ts:39-57`)
3. **Replay is a first-class assertion, not cleanup.** Work Order creation, inbound accept and equipment install are all idempotency-keyed; re-running them must return the *same* record. A harness that resets before replaying never tests the guard.
4. **Clear the offline intent store between runs.** It is per-uid, durable across sessions and unencrypted; a leftover intent from a previous run will sync into the next one and be indistinguishable from a genuine result. (`field-ops-app-vite/src/offline/localIntentStore.js`)

### 8. Recording a result

A result is the activity id, the tier it was attempted at, one verdict from the execution vocabulary, and evidence. The vocabulary is `PASS` · `PROCESS_GAP` · `UX_GAP` · `AUTHORITY_GAP` · `DATA_GAP` · `MISSING_CAPABILITY` · `WORKFLOW_GAP` · `TRAINING_ISSUE` · `BLOCKED_BY_TEST_ENVIRONMENT`, plus `NOT_RUN` for everything untouched.

`PASS` requires all five assertion axes to hold at the tier attempted, and the tier must be recorded — a T1 pass says the domain function is right, not that the activity works. **Every activity in this library is currently `NOT_RUN`.**

## The defects these scenarios would catch

158 activities carry an explicit defect assertion. The highest-consequence ones, grouped:

### Owner ruling violated tonight — overlapping blocked time

- **P3B1-S05-A02** (Record the standing 12:00-12:30 lunch for Thursday) — The blocked-time create command refuses ANY overlapping absence. Tonight's Owner ruling says overlapping blocked-time facts are legitimate and unavailable time is the UNION. The command and the ruling are in direct conflict; the model half (blockedMinutesInWindow) already computes the union correctly, so only the command is wrong.
- **P3B1-S05-A03** (Record the company holiday closure across a week that already has technicians' lunches in it) — A company-wide holiday closure is unrecordable for any technician who has a recorded lunch break. This is the highest-consequence instance of the overlap refusal: the product cannot represent the company being shut.
- **P3B1-S32-A04** (Record the holiday closure that could not be recorded last week) — The overlap refusal makes its own workaround impossible: deleting lunches to record a closure means the lunches cannot be restored until the closure is deleted. The organisation must choose which true fact to record.
- **P3B1-S05-A06** (Delete one of two identical PTO records for the same day) — Deleting one of several overlapping absences stages an audit event implying the absence was removed while the technician stays fully blocked. Under union semantics the UI must say what still blocks; nothing does.
- **P3B1-S05-A10** (Record the same PTO day twice because the first submit appeared to fail on a flaky connection) — Blocked-time creation has no idempotency key; today the overlap refusal masks that, and removing the overlap refusal (as the Owner ruling requires) would expose it.

### Recommendation and enforcement disagree

- **P3B1-S06-A02** (Score technicians on a Thursday when Javier is on recorded PTO all day) — The recommendation engine scores availability from fieldops_technicians.status and never reads governed blocked time. A technician on recorded PTO scores 100 and is recommended for the day the scheduler will refuse. Recommendation and enforcement disagree, and the dispatcher finds out only after committing.
- **P3B1-S06-A08** (Score a technician whose status string is a value the engine does not recognise) — An unrecognised technician status silently scores 50 rather than being flagged, so data drift becomes a half-endorsement.
- **P3B1-S33-A09** (Check that the new technician does not appear in recommendations before he is ready) — A newly created technician record scores 100 on availability immediately and is recommended for work before any onboarding step has been completed.
- **P3B1-S06-A10** (Ask why the board recommended a technician who was on PTO, after the fact) — Recommendations are ephemeral and unaudited, so a systematic scoring defect leaves no evidence trail.

### Identity and inventory — the technician-to-truck join

- **P3B1-S09-A03** (Open the parts source picker and look for my truck) — The technician-to-truck join crosses two id spaces (fieldops_technicians id vs employees id) and returns empty rather than erroring. A technician whose truck does not resolve is offered warehouses only, and the misattributed consumption that follows is inventory damage that looks like normal use.
- **P3B1-S09-A05** (Find my truck missing because it has no locationId) — Four distinct truck-resolution outcomes (no truck, two trucks, no locationId, out-of-service) collapse into one indistinguishable absent option.
- **P3B1-S13-A03** (Record a part on the phone scan flow instead of the dashboard) — The phone scan path records parts usage without a source location while the tablet path requires one. The same part, the same job, two different inventory outcomes depending on which screen the technician used.
- **P3B1-S13-A04** (Record a part from a warehouse he was never at) — A silent truck-resolution failure converts directly into a double inventory error: the warehouse is debited for stock it still holds and the truck is credited with stock it no longer has.
- **P3B1-S09-A07** (Audit how many technicians actually resolve to a truck) — No surface reports technician-to-truck or user-to-technician linkage health, so a total join failure produces no alert and no screen anyone would check.

### Work Order numbering

- **P3B1-S02-A03** (Create a Work Order after the year counter document has been lost) — woNumber silently restarts at 000001 when the counter document is absent. The file's own header promises 'Never reused'; that promise holds only while the counter survives. No unique constraint on woNumber catches the collision.
- **P3B1-S32-A03** (Find and fix the duplicate Work Order numbers) — No detection, no constraint and no renumber path for duplicate woNumbers. Recovery requires a data intervention and the counter must be repaired separately or the defect recurs immediately.

### Operating-company attribution

- **P3B1-S04-A10** (Build the Ventana board from the same technician pool on the same day) — Operating-company separation is unenforceable on Work Orders: no company is recorded and no permission consults one, so either dispatcher can act on either company's jobs.
- **P3B1-S07-A08** (Unschedule a Taylor Work Order from the Ventana board) — Cross-company authority on Work Orders is unenforceable: no Work Order records a company and no permission consults one. Operating-company attribution is recoverable only by inferring it from the actor.
- **P3B1-S29-A02** (Create a Ventana Work Order on an account Taylor also serves) — Nothing in the equipment picker indicates which operating company a machine belongs to, so a single mis-click silently assigns work to the wrong company with no recoverable trace.
- **P3B1-S29-A06** (Try to derive a Work Order's company from its account) — Operating company on a Work Order could only ever be derived from its equipment link, so every Work Order created without one is permanently unattributable - which includes every job created from an ambiguous email.
- **P3B1-S27-A10** (Work the Ventana mailbox and find a Taylor customer's message in it) — The receiving mailbox is the only operating-company signal in the intake chain and it is discarded at Work Order creation, because the Work Order has no field to carry it.
- **P3B1-S24-A04** (Split the month's service activity between Taylor and Ventana) — Monthly service activity cannot be split by operating company from the Work Order records, which is the single most consequential effect of the missing operatingCompanyId.

### Two lifecycles, one system

- **P3B1-S17-A04** (Attempt the same manipulation on the LEGACY fieldops_jobs collection) — A second, client-writable Work Order lifecycle still exists in deployed Rules (fieldops_jobs), with a lifecycle vocabulary and a write posture opposite to the governed engine. Client writes there produce no audit event.
- **P3B1-S32-A08** (Work out what the week's data actually says happened) — The legacy fieldops_jobs client-write path produces no audit events, so any activity there is permanently absent from any reconstruction of what happened.

### Lifecycle gaps that force false records

- **P3B1-S11-A01** (Arrive and find the store does not open until 09:00) — There is no technician verb for 'arrived and could not work'. Every no-access, customer-not-ready and wrong-address outcome must be miscoded as either work-in-progress or a dispatcher cancellation, and the wasted trip becomes invisible.
- **P3B1-S11-A06** (Tap Work Start because it is the only button, then discover he genuinely cannot work) — The absence of a 'cannot work' verb actively produces false workStartedAt timestamps, because Work Start is the only forward action offered.
- **P3B1-S20-A01** (Diagnose a fault whose part is not on the truck or in the warehouse) — No waiting-for-parts state exists in the Work Order lifecycle, so every multi-visit repair - roughly half of real service work - must be misrepresented as either complete or indefinitely in progress.
- **P3B1-S21-A01** (Try to hand an in-progress job to another technician) — A Work Order cannot be transferred between technicians once dispatched. Shift-change and mid-job handoff, which happen daily, have no representation and must be faked by completing or cancelling the record.
- **P3B1-S21-A04** (Complete the job from the car park on Javier's word) — The absence of a handoff verb produces falsified attribution: the completing technician is recorded as the performing technician, and the productivity metric is computed from it.
- **P3B1-S11-A10** (Arrive at the second job of the day while the first is still WORK_IN_PROGRESS) — There is no way to suspend a Work Order. An interrupted job either stays WORK_IN_PROGRESS accruing time or must be dishonestly completed.

### Authority that cannot be granted correctly

- **P3B1-S17-A10** (Grant a service manager read access to all Work Orders) — Read-only Work Order access cannot be granted. The only route to visibility is a role that also confers full lifecycle write authority over both operating companies' jobs.
- **P3B1-S16-A04** (Review a completed Work Order before closing it) — The Work Order detail page is gated on workOrder.create, so read access to a record requires the authority to create one. Any read-only role - billing, service manager, auditor - is excluded by a creation capability.
- **P3B1-S19-A02** (Try to mark the emergency Work Order ready and dispatch it himself) — There is no on-call or time-bounded authority. Covering after hours requires a permanent dispatcher grant, so the access model's answer to nights is a standing over-privilege.

### Serialized and lot-tracked parts

- **P3B1-S14-A02** (Attempt a quantity-only entry against a serialized part) — Regression guard for the pre-Wave-1 defect: a SERIALIZED part consumed on a Work Order posting a trackingMode NONE row, counted against on-hand while serialized_assets still held the unit.
- **P3B1-S23-A07** (Record the same PM parts kit at eight stores) — A LOT-tracked consumable on a PM route produces one refusal per store with no alternative capture path, so the chemical usage simply goes unrecorded across the whole campaign.
- **P3B1-S31-A06** (Fit the recall kit and record it as a serialized or lot-tracked part) — Lot-traceable recall parts cannot be recorded through Work Order usage capture at all, so the traceability the recall exists to provide is captured only as free text.

### Offline and mobile

- **P3B1-S11-A08** (Arrive at a site with no mobile signal at all) — Execution timestamps are server-clock at sync time, so a transition queued offline records the wrong moment. The integrity guarantee (server clock, not device clock) and the offline queue pull in opposite directions.
- **P3B1-S15-A08** (Try to open the app cold with no signal) — No service worker means the offline write queue only helps a session that was already open. A technician whose app is killed in a dead zone has no offline capability at all.
- **P3B1-S15-A04** (Have a queued intent refused by the server on arrival) — A refused offline intent has no salvage path: the technician's captured work is stranded in a queue card with nowhere to be re-applied.
- **P3B1-S15-A10** (See why a job shows WORK_IN_PROGRESS three hours after it should have finished) — No last-seen or connectivity signal per technician on the dispatcher board, so an offline technician is indistinguishable from an unresponsive one.

### Every defect assertion, by activity

<details><summary>158 assertions across 158 activities</summary>

- `P3B1-S01-A01` — An empty queue caused by a dead poller is presented identically to a genuinely quiet weekend.
- `P3B1-S01-A03` — A replayed accept rendered as a fresh success teaches coordinators that double-clicking is harmless, which is only true here.
- `P3B1-S01-A06` — A Work Order created from a cross-company-ambiguous email carries no company attribution at all, so the mistake is invisible after the fact.
- `P3B1-S01-A08` — Intent-level duplicates (customer forwards their own email, or calls and emails) are not detected; two Work Orders for one fault is the field consequence.
- `P3B1-S01-A09` — No governed release-from-quarantine path means a real emergency from a new address has no fast route in.
- `P3B1-S01-A10` — No ownership on an inbound row: two coordinators either both chase it or neither does.
- `P3B1-S02-A03` — woNumber silently restarts at 000001 when the counter document is absent. The file's own header promises 'Never reused'; that promise holds only while the counter survives. No unique constraint on woNumber catches the collision.
- `P3B1-S02-A06` — The role that can create a Work Order is not the role that can cancel one, so the person best placed to catch a creation mistake in the first minute cannot act on it.
- `P3B1-S02-A07` — MarkReady validates nothing. A Work Order with no equipment, no address and an empty description can be declared ready, and the cost lands on the technician.
- `P3B1-S02-A10` — Work Order visibility rides a legacy role string rather than a capability, and no Work Order carries an operating company, so neither 'who may see this' nor 'whose job is this' is expressible in the governed model.
- `P3B1-S03-A04` — The equipment service timeline exists only on a route technicians are explicitly barred from, so the person standing in front of the machine is the one person who cannot see its history.
- `P3B1-S03-A05` — Service history cannot be attributed to an operating company because the Work Order never records one.
- `P3B1-S03-A07` — Two registries both call their field 'location' and mean incompatible things; nothing on screen says so.
- `P3B1-S03-A08` — Discovering the Work Order names the wrong machine has no in-product correction path for the technician.
- `P3B1-S04-A07` — A partially-completed day build leaves no summary of what actually got placed.
- `P3B1-S04-A09` — A scheduling refusal can name a technician the dispatcher has filtered out of view, producing a refusal with no visible cause.
- `P3B1-S04-A10` — Operating-company separation is unenforceable on Work Orders: no company is recorded and no permission consults one, so either dispatcher can act on either company's jobs.
- `P3B1-S05-A02` — The blocked-time create command refuses ANY overlapping absence. Tonight's Owner ruling says overlapping blocked-time facts are legitimate and unavailable time is the UNION. The command and the ruling are in direct conflict; the model half (blockedMinutesInWindow) already computes the union correctly, so only the command is wrong.
- `P3B1-S05-A03` — A company-wide holiday closure is unrecordable for any technician who has a recorded lunch break. This is the highest-consequence instance of the overlap refusal: the product cannot represent the company being shut.
- `P3B1-S05-A06` — Deleting one of several overlapping absences stages an audit event implying the absence was removed while the technician stays fully blocked. Under union semantics the UI must say what still blocks; nothing does.
- `P3B1-S05-A10` — Blocked-time creation has no idempotency key; today the overlap refusal masks that, and removing the overlap refusal (as the Owner ruling requires) would expose it.
- `P3B1-S06-A02` — The recommendation engine scores availability from fieldops_technicians.status and never reads governed blocked time. A technician on recorded PTO scores 100 and is recommended for the day the scheduler will refuse. Recommendation and enforcement disagree, and the dispatcher finds out only after committing.
- `P3B1-S06-A04` — When workload is tied and territory is flat, a tie among equals is presented as a ranked recommendation with no signal that the ordering is arbitrary.
- `P3B1-S06-A06` — No governed place to record a customer/technician exclusion, so the knowledge lives only in the dispatcher's head.
- `P3B1-S06-A07` — A missing Work Order type silently degrades the recommendation with no signal to the dispatcher.
- `P3B1-S06-A08` — An unrecognised technician status silently scores 50 rather than being flagged, so data drift becomes a half-endorsement.
- `P3B1-S06-A10` — Recommendations are ephemeral and unaudited, so a systematic scoring defect leaves no evidence trail.
- `P3B1-S07-A02` — Two commands with near-identical names do structurally different things - one is a lifecycle transition, one is not - and nothing on screen distinguishes them.
- `P3B1-S07-A04` — Between ACCEPTED and COMPLETED the only way to stop a job is Cancel, which is terminal. There is no 'stand down, we will re-plan' move.
- `P3B1-S07-A05` — No read receipt on a cancellation: a dispatcher cannot tell whether the technician's device has received it, and a terminal state has no undo if the technician works the job anyway.
- `P3B1-S07-A08` — Cross-company authority on Work Orders is unenforceable: no Work Order records a company and no permission consults one. Operating-company attribution is recoverable only by inferring it from the actor.
- `P3B1-S07-A09` — Rescheduling changes a customer promise and EOS has no notification path; MISSING_CAPABILITY.
- `P3B1-S07-A10` — The only board-change history a dispatcher can see is session-scoped, so it is empty exactly when it matters most - at a shift handoff or after a reload.
- `P3B1-S08-A03` — Dispatching a future-dated Work Order succeeds and occupies the technician immediately, blocking all other dispatch to them until the job leaves an occupying status - with no warning and no reverse edge to undo it.
- `P3B1-S08-A06` — Three separate surfaces (Dispatcher Board, Dispatch, Job Assignments) reach the same Dispatch transition with very different context; a dispatcher on the thinnest one makes the same commitment with the least information.
- `P3B1-S08-A08` — A Work Order with no address can be marked ready, scheduled and dispatched. The technician has no governed way to reject it - the technician action vocabulary has no 'cannot work this' verb.
- `P3B1-S09-A02` — An unlinked technician account is indistinguishable from a technician with no work, because both render as an empty list.
- `P3B1-S09-A03` — The technician-to-truck join crosses two id spaces (fieldops_technicians id vs employees id) and returns empty rather than erroring. A technician whose truck does not resolve is offered warehouses only, and the misattributed consumption that follows is inventory damage that looks like normal use.
- `P3B1-S09-A05` — Four distinct truck-resolution outcomes (no truck, two trucks, no locationId, out-of-service) collapse into one indistinguishable absent option.
- `P3B1-S09-A06` — A technician driving a loaner truck has no governed way to record which vehicle stock actually came from.
- `P3B1-S09-A07` — No surface reports technician-to-truck or user-to-technician linkage health, so a total join failure produces no alert and no screen anyone would check.
- `P3B1-S09-A08` — A stale technician status silently suppresses or inflates recommendations and the technician has no visibility into it.
- `P3B1-S09-A09` — Core dispatch and technician access is still gated by a legacy role string while the governed capability system exists and is used elsewhere; Work Order read has no capability at all, so the gap cannot be closed without inventing one.
- `P3B1-S10-A02` — Accepting the whole day at once puts every job in an occupying status, so the double-booking guard blocks all further dispatch to that technician for the rest of the day.
- `P3B1-S10-A04` — A technician can be EN_ROUTE and WORK_IN_PROGRESS on several Work Orders at once. The double-booking guard only runs at Dispatch; the technician's own transitions have no mutual-exclusion check, and none of these states has a reverse edge to correct a mis-tap.
- `P3B1-S10-A06` — Every technician execution timestamp is immutable and every technician transition is irreversible, so a single mis-tap permanently corrupts billable time with no in-product correction path.
- `P3B1-S10-A07` — Reassigning a dispatched job to a different technician is impossible without cancelling it: Dispatch is legal only from SCHEDULED and DISPATCHED has no reverse edge. Informal cover, which is how field service actually works, is unrepresentable.
- `P3B1-S10-A08` — Three technician surfaces (TechnicianShell, FieldMode, TechnicianDashboard) with different capabilities are selected by viewport width and route rather than by what the technician is trying to do.
- `P3B1-S11-A01` — There is no technician verb for 'arrived and could not work'. Every no-access, customer-not-ready and wrong-address outcome must be miscoded as either work-in-progress or a dispatcher cancellation, and the wasted trip becomes invisible.
- `P3B1-S11-A02` — A technician cannot see the other service locations on an account, so the most common address error can only be resolved by a phone call to the office.
- `P3B1-S11-A03` — Work Order completion records no outcome, so no-fault-found, fixed, and deferred are indistinguishable, and first-time-fix rate is structurally unmeasurable.
- `P3B1-S11-A04` — No credit-hold signal reaches dispatch or the technician, so a truck is sent to a door that will be closed to it.
- `P3B1-S11-A05` — The Work Order lifecycle has no representation of a failed visit, so every no-access outcome is recorded as either a cancellation or an abandoned open job.
- `P3B1-S11-A06` — The absence of a 'cannot work' verb actively produces false workStartedAt timestamps, because Work Start is the only forward action offered.
- `P3B1-S11-A07` — A technician who discovers the Work Order names the wrong machine cannot correct it, so equipment service history is silently corrupted by every such visit.
- `P3B1-S11-A08` — Execution timestamps are server-clock at sync time, so a transition queued offline records the wrong moment. The integrity guarantee (server clock, not device clock) and the offline queue pull in opposite directions.
- `P3B1-S11-A09` — There is no service worker or offline asset caching, so a technician who closes the app in a dead zone cannot reopen it. Offline support covers writes only.
- `P3B1-S11-A10` — There is no way to suspend a Work Order. An interrupted job either stays WORK_IN_PROGRESS accruing time or must be dishonestly completed.
- `P3B1-S12-A04` — Labour capture is fail-closed and unavailable, so no Work Order carries billable labour time.
- `P3B1-S12-A05` — Technicians have no access to equipment service history by design, because Rules cannot express the self-scoped read. The architectural constraint is real and documented; the operational cost lands entirely on the technician.
- `P3B1-S12-A08` — Execution capture lists planned parts only; a part the technician actually used that nobody planned has no obvious route into the record.
- `P3B1-S12-A10` — No fault taxonomy and no completion outcome means a month of service data is unanalysable prose.
- `P3B1-S13-A03` — The phone scan path records parts usage without a source location while the tablet path requires one. The same part, the same job, two different inventory outcomes depending on which screen the technician used.
- `P3B1-S13-A04` — A silent truck-resolution failure converts directly into a double inventory error: the warehouse is debited for stock it still holds and the truck is credited with stock it no longer has.
- `P3B1-S13-A08` — Truck stock variances caused by the technician-to-truck join failure or by the sourceless scan path arrive at cycle count with no way to attribute them.
- `P3B1-S13-A09` — No source category for customer-supplied or borrowed parts, so recording one necessarily falsifies company inventory.
- `P3B1-S13-A10` — Parts usage requires a server read to resolve sources, and the offline runtime queues writes only, so parts consumed in a dead zone may be unrecordable at the moment they are used.
- `P3B1-S14-A02` — Regression guard for the pre-Wave-1 defect: a SERIALIZED part consumed on a Work Order posting a trackingMode NONE row, counted against on-hand while serialized_assets still held the unit.
- `P3B1-S15-A03` — Offline-queued work is stamped with the sync time rather than the action time, and nothing on the record distinguishes the two, so an entire offline session collapses to one instant in the audit trail.
- `P3B1-S15-A04` — A refused offline intent has no salvage path: the technician's captured work is stranded in a queue card with nowhere to be re-applied.
- `P3B1-S15-A08` — No service worker means the offline write queue only helps a session that was already open. A technician whose app is killed in a dead zone has no offline capability at all.
- `P3B1-S15-A09` — Pending technician intents are invisible to dispatch, so a job that looks stalled in the office may simply be queued on a phone in a basement.
- `P3B1-S15-A10` — No last-seen or connectivity signal per technician on the dispatcher board, so an offline technician is indistinguishable from an unresponsive one.
- `P3B1-S16-A02` — Complete requires no recorded work. An empty Work Order can reach COMPLETED, and the discovery happens downstream at close or invoice time, after the technician has left the site.
- `P3B1-S16-A04` — The Work Order detail page is gated on workOrder.create, so read access to a record requires the authority to create one. Any read-only role - billing, service manager, auditor - is excluded by a creation capability.
- `P3B1-S16-A05` — Close is gated on admin/dispatcher, so the billing role that actually performs close-out either runs with dispatcher authority or cannot do its job.
- `P3B1-S16-A06` — There is no return-to-technician path from COMPLETED. A Work Order completed with insufficient information can only be closed as-is or left open indefinitely.
- `P3B1-S16-A08` — Close-out cannot be segregated by operating company, so two companies' service revenue is worked from one list with no attribution.
- `P3B1-S16-A10` — Cross-company cover leaves no trace on the Work Order, so intercompany labour cannot be allocated or even detected without inferring company from the actor's identity.
- `P3B1-S17-A04` — A second, client-writable Work Order lifecycle still exists in deployed Rules (fieldops_jobs), with a lifecycle vocabulary and a write posture opposite to the governed engine. Client writes there produce no audit event.
- `P3B1-S17-A05` — No skill or seniority dimension exists for technicians, so an apprentice can complete a warranty compressor replacement with no sign-off.
- `P3B1-S17-A06` — No technician skill, licence or certification data exists anywhere, so certification-restricted work can be dispatched to and completed by anyone.
- `P3B1-S17-A10` — Read-only Work Order access cannot be granted. The only route to visibility is a role that also confers full lifecycle write authority over both operating companies' jobs.
- `P3B1-S18-A06` — The inbound queue has no in-progress or owned state, so investigation effort is invisible and repeated.
- `P3B1-S18-A08` — Queued technician work is device-local and unencrypted; a lost or wiped phone loses it permanently, and nothing in the office knows it existed.
- `P3B1-S19-A01` — The Work Order creation wizard is a desktop four-step flow with no phone-designed equivalent, while the after-hours coordinator who most needs it is always on a phone.
- `P3B1-S19-A02` — There is no on-call or time-bounded authority. Covering after hours requires a permanent dispatcher grant, so the access model's answer to nights is a standing over-privilege.
- `P3B1-S19-A03` — On-call has no representation: not a blocked-time kind, not a technician status, not a schedule. The rota lives entirely outside EOS.
- `P3B1-S19-A04` — Every after-hours emergency produces an OUTSIDE_WORKING_HOURS warning, so the warning carries no information on exactly the jobs where a genuine anomaly would matter most.
- `P3B1-S19-A05` — Callout and overtime premiums are underivable from the Work Order: no rate, shift or callout concept exists, only timestamps.
- `P3B1-S19-A06` — Technician-to-technician parts transfer has no representation, so night-time borrowing from a colleague's truck is recorded as something it was not.
- `P3B1-S19-A09` — There is no overnight handoff view. The morning team reconstructs the night from a completed Work Order and a phone call.
- `P3B1-S20-A01` — No waiting-for-parts state exists in the Work Order lifecycle, so every multi-visit repair - roughly half of real service work - must be misrepresented as either complete or indefinitely in progress.
- `P3B1-S20-A02` — A completed Work Order on a machine that is still down is indistinguishable from a successful repair, which makes every service-quality metric meaningless.
- `P3B1-S20-A04` — No Work Order can reference another, so a multi-visit repair fragments into unrelated records and the equipment history shows repeated independent failures rather than one unresolved fault.
- `P3B1-S20-A06` — Experience affinity is scored by Work Order type only, so 'has been to this machine' and 'has worked this customer' carry no weight in the recommendation.
- `P3B1-S20-A07` — Technician Work Order scoping blocks a technician from reading any prior visit to the same machine performed by a colleague, which is the single most useful piece of context for a return visit.
- `P3B1-S20-A08` — Second-visit rate is structurally unmeasurable: no visit linkage, no completion outcome, no follow-up flag.
- `P3B1-S21-A01` — A Work Order cannot be transferred between technicians once dispatched. Shift-change and mid-job handoff, which happen daily, have no representation and must be faked by completing or cancelling the record.
- `P3B1-S21-A04` — The absence of a handoff verb produces falsified attribution: the completing technician is recorded as the performing technician, and the productivity metric is computed from it.
- `P3B1-S21-A05` — Parts consumed on a Work Order that is subsequently cancelled have no defined disposition; the inventory movement has already happened against a record that now says nothing was done.
- `P3B1-S21-A06` — The lifecycle has no way to start a Work Order at the customer's site, so every continuation job manufactures false travel and arrival timestamps.
- `P3B1-S21-A07` — A Work Order supports exactly one technician, so two-technician jobs - installs, heavy lifts, training ride-alongs - cannot be represented at all.
- `P3B1-S21-A09` — A technician going home sick requires cancelling and recreating every active Work Order they hold. There is no bulk reassignment and no reassignment at all after Dispatch.
- `P3B1-S22-A01` — A Work Order left in DISPATCHED overnight blocks all dispatch to that technician the next morning, and nothing at end of day surfaces the consequence.
- `P3B1-S22-A03` — Nothing prompts a technician to complete a Work Order left in progress, so overnight WORK_IN_PROGRESS inflates every elapsed-time measure and blocks next-day dispatch.
- `P3B1-S22-A04` — Carry-over work is invisible on tomorrow's board, so tomorrow's capacity is systematically overstated by exactly the jobs that ran late.
- `P3B1-S22-A05` — No urgency detection or escalation on inbound work, so an emergency arriving by email out of hours sits in the queue until morning.
- `P3B1-S22-A08` — No shift handover surface exists for dispatch; the only in-product history is a session-scoped feed that is empty for the arriving dispatcher.
- `P3B1-S22-A10` — A day of offline work lands after the dispatcher's end-of-day review, so the review is systematically wrong for any technician who worked out of coverage.
- `P3B1-S23-A01` — No preventive-maintenance interval or due-date exists on equipment, so PM scheduling - the most predictable revenue in the business - is planned entirely outside EOS.
- `P3B1-S23-A02` — No bulk Work Order creation exists. A routine quarterly PM campaign is 62 four-step wizards, and an interruption leaves no resumable state.
- `P3B1-S23-A04` — A three-week PM campaign can be scheduled straight through a company holiday, because the holiday closure is unrecordable for any technician who has a recorded lunch break.
- `P3B1-S23-A05` — Nothing warns or refuses when a second open Work Order is created against equipment that already has one, so duplicate demand passes straight through to duplicate truck rolls.
- `P3B1-S23-A07` — A LOT-tracked consumable on a PM route produces one refusal per store with no alternative capture path, so the chemical usage simply goes unrecorded across the whole campaign.
- `P3B1-S23-A08` — No campaign or programme grouping exists for Work Orders, so a 62-store quarterly PM contract is 62 unrelated records at every stage: planning, scheduling, execution, close and billing.
- `P3B1-S23-A09` — A campaign spanning both operating companies cannot be split by company at any stage, because company attribution does not exist on the Work Order.
- `P3B1-S24-A02` — Month-end batch closing clusters every closedAt on one day, so completed-to-closed latency - the one well-instrumented service metric - is destroyed by the process that uses it.
- `P3B1-S24-A03` — A Work Order has no owner and no blocked-on field, so an aged open job cannot be explained or chased from the record.
- `P3B1-S24-A04` — Monthly service activity cannot be split by operating company from the Work Order records, which is the single most consequential effect of the missing operatingCompanyId.
- `P3B1-S24-A07` — Four independent parts-capture defects converge on one unexplainable month-end inventory variance.
- `P3B1-S24-A10` — No period close exists in the service domain, so a Work Order closed late lands revenue in whatever month it is closed, with nothing to detect or prevent it.
- `P3B1-S25-A02` — A coordinated visit must be scheduled as sequential non-overlapping windows, so the dispatcher invents per-machine durations to make one trip fit a model that has no concept of a trip.
- `P3B1-S25-A03` — The coordinated mission view silently omits any Work Order in the group assigned to a different technician, so a two-technician install day shows each of them half the visit with no indication anything is missing.
- `P3B1-S25-A04` — A coordinated visit multiplies travel and arrival events by the number of machines, so every drive-time and response-time measure is inflated by exactly the cases the coordination was meant to make efficient.
- `P3B1-S25-A10` — Coordinated visits are indistinguishable from separate trips in the timestamp data, so the efficiency they deliver cannot be measured or defended.
- `P3B1-S26-A04` — A technician commissioning customer-owned equipment cannot register it from the field; registration is a desktop, account-scoped flow on a route technicians cannot open.
- `P3B1-S26-A06` — An equipment install to the wrong location is immutable through the normal edit path: accountId and locationId are deliberately locked, and no correction flow is offered in their place.
- `P3B1-S27-A01` — A failed mail poll is indistinguishable from a quiet mailbox in the inbound queue, so intake can stop entirely without anyone noticing.
- `P3B1-S27-A03` — An expiring mailbox credential has no visible warning and its failure mode is a silently empty intake queue.
- `P3B1-S27-A10` — The receiving mailbox is the only operating-company signal in the intake chain and it is discarded at Work Order creation, because the Work Order has no field to carry it.
- `P3B1-S28-A02` — Average completion time is silently distorted by offline-synced work, because queued transitions carry the sync timestamp rather than the time the technician acted.
- `P3B1-S28-A03` — On-time arrival is computable in principle but Reschedule overwrites the scheduled window in place, so the original customer promise is lost and the measure cannot be anchored.
- `P3B1-S28-A04` — Productivity comparison inherits every attribution defect - false completions from handoffs, empty completions, offline timestamp drift - with no indication of which numbers are sound.
- `P3B1-S28-A07` — No annotation or correction path exists for a misattributed completion, so immutable execution data becomes uncontestable performance data.
- `P3B1-S28-A08` — Neither MarkReady nor Schedule records when it happened, so time-in-backlog - the measure of whether dispatch is coping - has no anchor on the Work Order record.
- `P3B1-S28-A10` — Missing working availability is surfaced as a per-placement warning rather than as a data-coverage worklist, so the same gap is reported dozens of times and fixed none.
- `P3B1-S29-A02` — Nothing in the equipment picker indicates which operating company a machine belongs to, so a single mis-click silently assigns work to the wrong company with no recoverable trace.
- `P3B1-S29-A06` — Operating company on a Work Order could only ever be derived from its equipment link, so every Work Order created without one is permanently unattributable - which includes every job created from an ambiguous email.
- `P3B1-S29-A09` — Two operating companies' Work Orders are visually indistinguishable on one dispatcher board, so cross-company mis-clicks are both likely and undetectable.
- `P3B1-S30-A09` — The coordinator who makes the customer promise cannot see the schedule that determines whether it can be kept, because board visibility is gated on the dispatcher role.
- `P3B1-S30-A10` — There is no customer-promise field. The only time on a Work Order is a mutable dispatcher plan, so the commitment the business is judged on is never recorded.
- `P3B1-S31-A01` — Recall population accuracy depends entirely on register data quality, and nothing measures or reports how many equipment records have missing or implausible serials.
- `P3B1-S31-A03` — No campaign or bulletin object exists, so a safety recall is tracked by a text convention in 34 unrelated Work Order descriptions.
- `P3B1-S31-A04` — Recall completion cannot be evidenced: no campaign grouping, and no completion outcome to distinguish 'inspected and corrected' from 'visited'.
- `P3B1-S31-A05` — The technician can prove the register is wrong and has no in-product way to correct it, so every field-discovered data error depends on a phone call being made and acted on.
- `P3B1-S31-A06` — Lot-traceable recall parts cannot be recorded through Work Order usage capture at all, so the traceability the recall exists to provide is captured only as free text.
- `P3B1-S31-A09` — Priority has no effect on scheduling behaviour, so mandatory safety work is as deferrable as a routine call.
- `P3B1-S32-A01` — Work Orders stranded in CREATED or READY_TO_DISPATCH have no timestamp on the record, so the two states most likely to strand work are the two whose age cannot be read from it.
- `P3B1-S32-A02` — Cancel-and-recreate is the only recovery for any Work Order stranded after Dispatch, because the lifecycle has exactly one reverse edge and it is upstream of the problem.
- `P3B1-S32-A03` — No detection, no constraint and no renumber path for duplicate woNumbers. Recovery requires a data intervention and the counter must be repaired separately or the defect recurs immediately.
- `P3B1-S32-A04` — The overlap refusal makes its own workaround impossible: deleting lunches to record a closure means the lunches cannot be restored until the closure is deleted. The organisation must choose which true fact to record.
- `P3B1-S32-A05` — Misattributed parts consumption is indistinguishable from correct consumption after the fact, so the truck-join defect leaves damage that cannot be identified, only written off.
- `P3B1-S32-A08` — The legacy fieldops_jobs client-write path produces no audit events, so any activity there is permanently absent from any reconstruction of what happened.
- `P3B1-S33-A01` — The only technician-create UI is orphaned and unreachable, so onboarding a technician requires an administrative path outside the application.
- `P3B1-S33-A07` — A Work Order dispatched with an assignedTechId that does not match any users/{uid}.technicianId is invisible to every technician while looking perfectly normal on the dispatcher board.
- `P3B1-S33-A09` — A newly created technician record scores 100 on availability immediately and is recommended for work before any onboarding step has been completed.
- `P3B1-S33-A10` — Technician onboarding spans seven records across four domains with no single readiness view, which is the structural reason identity and truck join failures go undetected.

</details>

## Unproven

This lane verified every `path:line` it cites. The following are explicitly **not** verified and are marked `UNPROVEN` in the activities that rest on them: whether the inbound queue distinguishes a replayed accept from a first accept; whether a decline reason can be corrected; whether detach-from-Work-Order exists; whether refused privileged actions are audited; whether any surface shows time-in-status or last-seen connectivity; whether the Work Order wizard is usable at phone width; whether execution data can still be written to a `COMPLETED` Work Order; whether the phone scan path attributes consumption to any location at all; whether a serialized quantity above one is handled; whether photo attachment exists on Work Order execution; whether parts consumed on a subsequently-cancelled Work Order reverse; whether warranty terms, PM intervals, serial-range search or goal-setting surfaces exist.


---

## Corrections

Applied by lane **P3-DIL-FIX** on 2026-09-12, baseline `night/p3b1-activities-service @ c363fc00`.
**Count- and evidence-description corrections only.** No activity's business content was
re-authored: no `title`, `persona`, `role`, `operatingCompany`, `action`, `expected*`,
`deviceContext`, `evidence`, `executionResult`, `behaviourClaim`, `frictionScore`,
`defectsThisWouldCatch`, executability or core-assertion field was changed. Every figure below
was re-derived from the rows in this lane.

### 1. Device / coverage tag disagreement — fixed

`byCoverageCategory` reported **DESKTOP 213 + MOBILE 119 = 332** across 330 activities, while
`byDeviceContext` reported **DESKTOP 212 / MOBILE 118**. Both blocks reproduced exactly from
the rows, so the artifact was internally consistent and externally wrong: **two activities
carried both tags.**

| Activity | `deviceContext` | Coverage tags before | After | Removed |
|---|---|---|---|---|
| `P3B1-S07-A05` | `DESKTOP` | EXCEPTION, HANDOFF, MOBILE, DESKTOP | EXCEPTION, HANDOFF, DESKTOP | `MOBILE` |
| `P3B1-S10-A08` | `MOBILE` | DESKTOP, MOBILE | MOBILE | `DESKTOP` |

Those two rows account for the whole discrepancy: +1 MOBILE from `S07-A05`, +1 DESKTOP from
`S10-A08`. `byCoverageCategory` now reads DESKTOP 212 / MOBILE 118, identical to
`byDeviceContext`, and 212 + 118 = 330. **All 15 `counts.*` blocks were recomputed from the
rows after the edit and every one reproduces exactly.** Each corrected row keeps its original
tag list in a new `coverageTagCorrection` object, so the record shows what was claimed.

**One open question this lane did not resolve.** `P3B1-S10-A08` is titled *"Open the technician
workspace on a desktop instead of a phone"* and its action is opening that workspace on a wide
screen — yet its `deviceContext` is `MOBILE`. Making the tags agree with `deviceContext`
therefore drops the `DESKTOP` tag from a desktop-centred activity. `deviceContext` was **not**
changed, because that is authored content rather than a count. Either `deviceContext` is wrong
for this row, or the row legitimately spans both surfaces and the coverage vocabulary needs a
way to say so. **For the author / Owner.**

**Three rows the brief named are not in this library.** `S17-A01` (device
`HANDHELD_SCANNER`, tagged both), `S24-A04` (`HANDHELD_SCANNER`, no DESKTOP/MOBILE tag) and
`S24-A06` (`DESKTOP`, no tag) are **P3-B2** rows — P3-B2 ids are un-namespaced. Re-derived
here: P3-B1 has **no** row with `deviceContext` `HANDHELD_SCANNER` (the only values are
DESKTOP 212 and MOBILE 118), and `P3B1-S17-A01`, `P3B1-S24-A04` and `P3B1-S24-A06` are all
already consistent. P3-B2 is in neither worktree this lane owns, so **those three rows remain
unfixed** and are handed to the controller.

### 2. Corpus totals — the duplicate activity

`P3B3-FIN-056` and `P3B3-MGMT-018` in the **P3-B3** library are the same activity recorded
twice: byte-identical title, same `actor_role`, `objects_touched` and `status`, and the same
`OWNER_DECISION_PENDING` blocker citing the same inert
`config/ownership/operating-company-roots.sandbox.json`. Both ids are retained and
cross-referenced there. **P3-B1 itself has no duplicate** — re-derived here, all 330
`activityId`s, all 330 titles and all 330 (title, persona) pairs are distinct.

| | Records | Distinct activities |
|---|---:|---:|
| P3-B1 (this library) | 330 | 330 |
| P3-B2 | 330 | 330 |
| P3-B3 | 350 | 349 |
| **Day-in-the-Life corpus** | **1,010** | **1,009** |

P3-B1's 330 was re-derived here; P3-B3's 350 and its single duplicate were re-derived on
`night/p3b3-activities-sales`; **P3-B2's 330 is the programme figure** and could not be
re-derived — that library is in neither worktree this lane owns.

### 3. The `NOT_RUN` figure was mislabelled

"968 `NOT_RUN`" is arithmetically right and mislabelled. State it as:

> **968 not executed, of which 660 are labelled `NOT_RUN`.**

| Library | Not executed | Labelled `NOT_RUN` |
|---|---:|---:|
| P3-B1 | 330 | 330 |
| P3-B2 | 330 | 330 |
| P3-B3 | 308 | **0** |
| **Total** | **968** | **660** |

Re-derived here: every one of this library's 330 activities has `executionResult` `NOT_RUN`
and no other value appears. P3-B3's 308 unexecuted rows (350 − 42 executed) carry five
different statuses and the token `NOT_RUN` appears nowhere in that library:
`IMPLEMENTED_UNEXECUTED` 141, `PARTIAL` 68, `BLOCKED` 64, `NOT_SUPPORTED` 26,
`DESIGNED_ONLY` 9 = 308. P3-B2's 330 is the programme figure.

### 4. Recorded, deliberately not fixed

1. **Persona-identity collision — a persona-registry reconciliation item for the Owner.**
   *Marisol Vega* is `service_coordinator` here with **49** activities (re-derived) but **Parts
   Manager** in P3-B2 with **65** (programme figure). *Priya Raman* is `service_manager` here
   with **60** (re-derived) but **Operations Manager** in P3-B2 with **17** (programme figure).
   The same named humans hold two different jobs across libraries. **Nobody was renamed** and
   no persona entry was edited — that would rewrite authored content.
2. **Latent id-namespace hazard.** P3-B1 `activityId`s carry the `P3B1-` prefix
   (`P3B1-S01-A01`); P3-B2's are un-namespaced (`S01-A01`) over the same `S..-A..` shape.
   Cross-library uniqueness holds today **only** because of that prefix: any consumer that
   strips or normalises it collides all 330 P3-B1 ids with all 330 P3-B2 ids. No id was
   changed. The hazard already bit this lane — three of the five rows the brief named for
   correction 1 turned out to be P3-B2 rows written in the un-namespaced form.
3. **P3-B3 has no operating-company field at all.** Zero of its 350 records carry one
   (re-derived on `night/p3b3-activities-sales` by scanning every key of every record), so
   Ventana coverage is *structurally unmeasurable* for that third of the corpus. This library
   does carry `operatingCompany` on all 330 rows (taylor 290 / ventana 40), which means no
   corpus-level operating-company split can be stated. **Known gap.**
