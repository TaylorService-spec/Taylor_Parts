# UX Evidence — Materials/Purchasing mission + Control Tower revalidation

Two bounded, read-only persona missions. Both preflighted; provenance recorded per
the build-currency gate.

| Mission | Build | Class | FUNCTIONAL | EXPERIENCE |
|---|---|---|---|---|
| Materials / Purchasing (dispatcher) | `b99b2bf` D2 MATCH | **C** live, verified | FAIL | FAIL |
| Control Tower five questions (dispatcher) | `c81e7aa` D2 MATCH | **C** live, verified | FAIL | FAIL |

The Control Tower run **replaces** the earlier Class-D five-question mission, which
ran on an unestablished build. That earlier evidence is superseded, not deleted —
its findings recurred here on a verified build, so its substance survives with new
provenance.

---

## Part 1 — Materials / Purchasing

16 screens, 5 modules, chasing one blocked job's part.

### What the persona could and could not answer

| Question | Result |
|---|---|
| Which part is the job waiting on? | **Yes** — plain-language diagnosis on the WO |
| Do we have it anywhere? | **NO** — the app refused; catalog unverifiable, warehouse row absent |
| Has anyone asked for it? | **Partially** — a REJECTED request, no reason, no actor, no date |
| Who acts next? | **Inferred only** — nothing states it |
| When can the technician finish? | **No** |

### Vocabulary — the core question of the mission

The persona was never told multiple concepts exist. What they built unaided:

- **Correctly distinguished:** Reorder Request vs Purchase Order (different objects,
  causal link *asserted in a caption but never demonstrated end-to-end*); reorder-request
  data vs canonical part data (*"one works, one doesn't, on the same page"* — inferred
  from observed behaviour, which is exactly right).
- **Could not tell:** whether **Parts Catalog** and **Part Master** are the same store.
  Two entry points, two different failure messages (*"could not be verified"* vs *"no
  canonical records exist"*). Their reasoning: if the same, the messages should match;
  if different, that needs stating.
- **Actively misled by "Back Orders"** — the most natural place to look when chasing a
  missing part, and an unbuilt stub. *"The most disorienting dead end in the whole app."*
- **Unexplained jargon:** "Needs attention" — attention for what reason?

**#675's premise holds up:** these are genuinely different concepts and the user is
not being taught which one they are looking at. The failure is comprehension, not
disagreement — with one real exception below.

### Service ↔ Materials — the structural finding

Confirmed directly in Firestore, not through the UI: **all four `reorder_requests`
carry no work-order link.** The relationship does not exist in canonical data.

That single fact explains the whole mission: why the part number had to be carried by
memory across five screens, why nothing on the inventory side references the job, and
why "who acts next" has no answer anywhere.

**ROUTED TO PRODUCT/DESIGN — not solved in UX.** And explicitly **not** as "add
`workOrderId`": purchasing may satisfy Work Order, Sales Order, stock, aggregated or
mixed demand. The domain model is Product's decision.

### Integrity state

The `PRT-1001` row (#675's orphan) presents as an ordinary "Needs attention" PO with
Supplier, PO#, Qty, Ordered and Expected all blank. The persona could not tell whether
that meant *stale record*, *different underlying shortage*, or *rendering bug*.

**An integrity exception must not wear the costume of ordinary workflow state.** It
needs to say what is missing and that the relationship is absent — without inventing
the missing record and without discarding the request. **Routed:** presentation of
integrity state requires Product to define what the exception means before UX labels it.

---

## Part 2 — Control Tower revalidation

22 screens, 8 modules. Two of five questions answerable with effort; three not.

### The hazard, now with a consequence

The persona nearly reported a **fabricated** blocked obligation as real while missing
the actual one:

> *"a person who didn't already know that could walk away from this morning review
> believing Metro School District has a blocked obligation that doesn't exist and
> missing the one real blocked job (WO-2026-C71303) that does."*

Second independent confirmation. The disclosure exists but is one paragraph a scanning
user never reads. **Remediated — see below.**

### Contradictions

Three screens named **three different part numbers** (`PRT-1002` blocking the real job,
`PRT-1001` in Purchasing needs-attention, `PRT-1006` in assigned work) with no linkage.
Per #675 these are legitimately different concepts — but the user cannot tell that from
the surfaces, which is the same comprehension failure Part 1 found.

### Ownership

Nowhere. Coordinated Visits states its blocker is *"replenishment status not connected
(routed to Inventory / Purchasing)"* — a screen honestly admitting it hands off
ownership to two modules without connecting to either.

### Control Tower decision — evidence now points to **C (both)**, still not a redesign

The persona reached this unprompted and it is worth quoting precisely, because it
splits the question the way the decision rule does:

> *"What would fix it isn't a new screen — it's linkage inside the screens I already
> have… A single 'Attention' surface that pulled real blocked-WO diagnoses, real
> rejected/needs-attention purchasing records, and matched them by the part ID that's
> already sitting in both places would answer questions 1, 2 and 4 in one screen
> instead of four, and would make question 5 answerable for the first time by simply
> requiring every row to state an owner before it's allowed to exist."*

And the summary judgment: *"each screen tells the truth about itself, but no screen
tells the truth about the business."*

**Reading:** option **C** — domain workspaces for action, plus a cross-domain attention
surface — but **strictly ordered**. The attention surface's value depends entirely on a
linkage that does not exist yet (the demand relationship routed above). Built today it
would aggregate three unrelated part numbers into one confident-looking list.

**PURPOSE, stated before any layout or naming:** *surface committed obligations and
blocked work that are not moving, each with the record it is blocked on and the person
who owns the next action.* If a row cannot state an owner, it should not exist.

**Still NOT recommended:** building it now, naming it, or laying it out. Operating
workspace linkage first. Control Tower naming remains unassessed.

---

## Ordinary UX fixes applied autonomously

- **Per-row SAMPLE badges** on Coordinated Visits and the Coordinated Mission switcher.
  Twice-confirmed hazard with a demonstrated false conclusion; one intro paragraph is
  not enough for a scanning user, and sample customer names are close enough to live
  ones to pass. Authority untouched — presentation only.
- **Honest timestamps** — `Invalid Date` and `19933d ago` replaced with UNKNOWN /
  capped phrasing across 7 Parts and Purchasing call sites.
- **Hosting cache defect** — the cause of the stale-build problem itself.

## Routed to Product, not solved

1. **The demand relationship** — what a reorder request is *for*. Not assumed to be
   `workOrderId`.
2. **What "Rejected" means** and what legitimately follows it.
3. **Are Parts Catalog and Part Master one authority?** Users cannot tell.
4. **What "Needs attention" flags.**
5. **Why Part Master reports zero canonical records** while the part has four
   historical usages.
6. **What an integrity exception means** before UX gives it a label.

## Scenarios discovered

Parts-role view of the same rejected request (does another role see a reason or a
resubmit?); a full Request → approval → PO → Receipt path for any part, since no
example completes end-to-end in this environment; a two-persona sequence where a Parts
Associate actions the needs-attention PO and the dispatcher re-checks whether it
surfaces; six stub screens reachable from primary nav with no visual distinction from
working ones — **carried to the IA backlog, not fixed here**, since nav presentation is
part of the pending IA decision.

---

## Part 3 — Parts-role view of the rejected replenishment request

Build `251c16d` · D2 MATCH · non-cached identity confirmed · premise verified.
One bounded read-only Parts Manager mission.

**FUNCTIONAL: FAIL · EXPERIENCE: FAIL** — 6 routes, 2 modules.

### The question this mission answered

Was the dispatcher's inability to resolve the blocked material condition **A** a
legitimate role handoff, **B** a broken cross-role workflow, **C** missing canonical
linkage, or **D** a combination?

**Answer: D — B and C together, with C as the root cause.**

It is emphatically **not A**. A legitimate handoff means the receiving role can act.
This one cannot.

### The inversion — the role that owns the decision has less context than the role that doesn't

The Parts Manager is **worse off** than the dispatcher who called them:

- They **rejected this request themselves** — and the app cannot tell them why. There
  is no reason field. Confirmed in canonical data before the run: `reorder_requests`
  carry `reviewedBy` but **no reason field exists at all**. This is a model gap, not a
  UI omission.
- They cannot see the **part's name**. The page states *"Some part names are
  unavailable; Part IDs are shown."* They could not determine which of their two open
  rows is even the water inlet valve — *"I can't even prove it's one of mine."*
- They cannot reach the **job**: Job Assignments, Technician Workspace and the
  Dashboard all correctly deny them.
- **Every control is read-only.** No re-request, no reversal, no escalation, no
  annotation. Nothing to hand back.
- Who decided was inferred only from the section's framing (*"requests you personally
  approved, rejected, or assigned"*), never stated on the record. Had a colleague
  rejected it, that would be invisible.

So the chain breaks in both directions: Service cannot see Inventory's decision, and
Inventory cannot see Service's job. Neither side of a "colleague calls about a stuck
part" conversation has a shared record to point at.

### Confirms, with a new dimension

The missing demand relationship (routed to Product) is not only a *dispatcher*
navigation problem. It leaves the **deciding role unable to justify or revisit its own
decision.** That raises the routed question's stakes: this is not merely cross-linking
for convenience, it is whether a replenishment decision is accountable at all.

### Remediated here

`formatAssignmentAge` did its own arithmetic (`Math.max(0, now - value)`), which turns
an unusable timestamp into a confident *"19933d ago"* — about 54 years, on a request
made this week. My earlier timestamp fix wired the absolute-date path but **missed this
age path**, which is why the Parts Manager still hit it and had to mentally flag it as
false data. It now delegates to the shared honest formatter, covering both call sites.

### NOT fixed, correctly

Part names unavailable to the Parts Manager is downstream of **Part Master holding no
canonical records** — already routed. Resolving names in the client would manufacture
an authority the platform has not established.

### Routed to Product (new / sharpened)

- **A rejection with no recorded reason is not an auditable decision.** Whether
  `reorder_requests` should carry a reason is a Product model question, not a label.
- **Can a Parts Manager act at all on a terminal request?** Re-request, reverse and
  escalate do not exist. Whether they *should* is workflow policy.

### Next scenario, selected from this evidence

The page states reorder requests are *"submitted by Purchasing, not here"* — so
Purchasing may hold the missing half of this story. That is the next mission.
