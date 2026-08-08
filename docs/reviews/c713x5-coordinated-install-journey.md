# UX Journey — C713 × 5 Coordinated Install (J-COORD-INSTALL, round 1)

Build `71a9adf`, sandbox `eos-platform-sandbox`, D2 MATCH. Scenario `SBX-SCN-002`.
Four persona missions: Dispatcher, Technician, Warehouse/Parts, plus one clean
read-only Dispatcher re-run on a restored scenario premise.

## The substrate finding — read this before any verdict below

**PRODUCT MODEL EXISTS. USER EXPERIENCE DOES NOT.**

Cycles 4–9 built the entire multi-equipment spine: Sales Order authority,
`allocateSalesOrder`, allocation projection, coordinated-visit projection,
coordinated field mission, billing eligibility. Verified against the client:

- `grep` for `coordinatedVisit | coordinatedFieldMission | billingEligibility |
  allocationProjection | allocateSalesOrder` across `field-ops-app-vite/src/`
  returns **zero** hits.
- `salesOrderId` — the coordination link the whole model rests on — appears
  **zero** times in the client.
- All six callables are `EXPORT != DEPLOY` with capabilities `active:false`;
  `gcloud functions list` shows none deployed to the sandbox.

So none of these missions could test the coordinated projection. They tested the
layer that *is* exposed: five governed Work Orders sharing a customer, a site and
a day. **No projection may be awarded a FUNCTIONAL PASS on this evidence.**

A second constraint, from `multi-equipment-coordination-assessment.md`: per-unit
Work Order fan-out is blocked on serialized allocation, so `createServiceForSalesOrder`
today creates ONE coordinated Work Order per Sales Order. **The product cannot yet
produce the C713×5 shape at all.** The five Work Orders were seeded directly onto
the real model. They are honest data; there is no product path that creates them.

## Verdicts

| Persona | FUNCTIONAL | EXPERIENCE |
|---|---|---|
| Dispatcher / Service Manager (clean re-run) | **PARTIAL** — 2 of 3 customer questions answerable | **FAIL** |
| Technician | **PASS (barely)** | **FAIL** |
| Warehouse / Parts | **FAIL** | **FAIL** |

## Method failure in round 1 — recorded, not hidden

Three mutating persona agents ran **concurrently against one shared sandbox**, and
the scenario was re-seeded **while they were live**. Consequences:

- The technician agent COMPLETED the blocked unit mid-run, consuming the scenario
  premise. The warehouse agent then arrived to find 5/5 complete and reported a
  "damning contradiction" — a completed Work Order whose diagnosis says the unit
  cannot be commissioned. The dispatcher agent independently observed the same
  record change from `WORK_IN_PROGRESS` to `COMPLETED` between two page loads
  "with no user action of mine."
- That contradiction is an **artifact of the test method**, not a product defect.
  **RETRACTED.** It must not be routed, cited, or counted as corroboration.
- Both agents' "silent completion" claims are unverifiable from live state for the
  same reason.

Corrections applied:
1. **Personas that mutate run sequentially, never concurrently**, against a shared
   environment. Read-only personas may still run in parallel.
2. **Never re-seed while a mission is live.**
3. The fixture is now **genuinely idempotent** — it asserts every blocked/complete
   discriminating field in BOTH directions, including deleting `completedAt`. A
   fixture that cannot restore its own premise produces evidence about the last
   agent that touched it, not about the product.

Also fixture artifacts, not defects: identical `dispatchedAt/acceptedAt/enRouteAt/
arrivedAt/workStartedAt` timestamps across all five Work Orders (the seed writes
`now` to each), and the original invented `coordinationKey` (corrected to the
product's real `salesOrderId`).

## Credential handling — three failures in one day

Three separate persona agents mishandled sandbox credentials: hardcoding into
scratch scripts, printing raw file contents, and printing the password's exact
character codes (fully reversible). These are fictional `.invalid` sandbox
personas, so impact is low, but the pattern is the finding. Two runs were also
wasted pointing agents at `sandbox.txt`, which is stale; the current file is
`sandbox-credentials.local.json`.

**RESOLVED** by the single-source-of-truth contract:
`docs/testing/sandbox-persona-credentials.md` plus one read-only loader
(`scripts/sandboxCredentials.mjs`) that cannot fall back to `sandbox.txt` and
has no write path. **Rule:** persona prompts must forbid *any* derivative of a credential —
character codes, hex, base64, hashes, partial masks, per-character inspection —
and permit only a success boolean and a length. Parse straight into `fill()`;
never read the value back.

## Finding 1 — coordination is invisible, and three personas independently invented the same missing object · **HIGH**

Not one persona was told the five Work Orders were related. All three discovered it
by archaeology:

- Dispatcher: consecutive WO-number suffixes + identical date + same assigned tech
  + a matching free-text phrase. *"That's archaeology, not a feature."*
- Technician: read every card's Customer field and noticed a repeating INSTALL
  pattern. Standing in front of five identical machines, unit identity ("unit 3 of
  5, serial C713-SBX-0003") exists **only inside a free-text complaint sentence**.
- Warehouse: could not see them at all.

The dispatcher needed **13–14 screens across 6 modules** to answer one phone call,
opening five Work Order pages individually — none hyperlinked to any other.

All three then proposed the same fix: **add a Job / Visit / WorkOrderGroup object.**

**That proposal is rejected, and the convergence is the evidence.** Product settled
this (`multi-equipment-coordination-assessment.md`): the Sales Order is the
coordination anchor and no new authority is required. Three personas reaching for
the same missing object independently does not prove a new authority is needed — it
proves **the existing coordination link is completely invisible in the experience**.
`salesOrderId` already groups these five records and the client never reads it.

**Route:** UX/IA — surface the existing `salesOrderId` group as a projection.
**Do NOT create a domain object to satisfy a presentation gap.**

## Finding 2 — partial completion cannot be stated to a customer · **HIGH**

The clean read-only mission asked the three questions a customer actually asks.

- *"Is our installation finished?"* — answerable, but only by opening five separate
  Work Orders and holding "4 of 5, unit 3 is the odd one out" in the dispatcher's
  head. **Nothing anywhere renders a 4/5 rollup.**
- *"What is still outstanding?"* — answerable, and this is the one genuine success:
  read **directly**, not inferred, from the Work Order — *"Water inlet valve missing
  from the delivered kit; unit cannot be commissioned."*
- *"When will it be resolved?"* — **not answerable anywhere.** No ETA on the Work
  Order, no follow-up visit on the Dispatcher Board or Scheduling, no order for the
  part. The obligation exists but nothing owns it.

**Route:** UX/IA (rollup) + Service (follow-up scheduling for a blocked unit).

## Finding 3 — Equipment asserts ACTIVE for a unit that cannot be commissioned · **HIGH**

All five units show status `ACTIVE`, including unit 3, whose own Work Order says it
cannot be commissioned. Equipment is a reasonable place for a dispatcher to check
"is our equipment installed" — and it would have produced a **confidently wrong
answer to the customer**. Caught only by cross-referencing two screens.

This is a distinct honest-state failure from the retracted one: it is visible on a
restored, uncontaminated scenario and does not depend on any agent's writes.
Equipment has no commissioning state; installed and commissioned are the same value.

**Route:** Equipment / Serialized Asset programme.

## Finding 4 — Service ↔ Inventory seam: confirmed, not narrowed · **HIGH** (Finding A)

The Work Order's own parts panel says *"Visual only — no inventory engine connected
yet."* Concretely, on this journey:

- The blocked part `PRT-1002` appears in **no** warehouse stock table, **no** truck,
  and **no** purchase order.
- A **Reorder Request for exactly that part was Rejected** — sitting in the Parts
  Manager's own history, unclickable, with no reason, no actor, and a date rendering
  as `Invalid Date`. Nothing connects it to the job it is now blocking.
- Part detail refuses to load: *"could not be verified against the canonical
  source."* Part Master reports **no valid canonical Part records exist** (6
  malformed, excluded) — so every inventory screen fails closed for **every role,
  including admin**.

The dispatcher could tell the customer a part is missing, but not why the resupply
was refused or when another is coming. F2 closed the *identity* half of this seam.
Availability, location, truck stock and load verification remain severed.

**Route:** Materials / F2 remainder. Part Master data integrity is upstream of all
of it.

## Finding 5 — Warehouse Manager and Parts Manager cannot reach any Work Order · **HIGH** (Finding E, second corroboration)

Neither role has a Work Orders destination. "Job Assignments" tells them their own
assigned work is in Technician Workspace — neither role is a technician. There is no
search anywhere. Their entire inventory workspace is two permanently empty panels.

The people responsible for materials **cannot see the job that is blocked on
materials.** Independently corroborated across Round 2 and this journey.

**Route:** #226 / R-1.

## Finding 6 — DENIED is being rendered as EMPTY · **MEDIUM** · owner: UX

Navigating directly to `/inventory` as Warehouse Manager or Parts Manager renders a
bare heading with no content — no redirect, no denial message, no explanation. A
blank page is the worst possible answer to "did I do something wrong?" This breaks
the four-state honesty rule (LOADING / EMPTY / DENIED / UNAVAILABLE must stay
distinct) that the codebase applies well elsewhere.

Related, same owner: Warehouse Manager's default landing page is technician-shaped —
"My Work Orders" over *"Your account isn't linked to a technician record yet"* — an
error message as the first thing a non-technician sees.

## Finding 7 — the customer record buries the only useful panel · **MEDIUM** · owner: UX

The Service Activity panel was, in the dispatcher's words, "the single most useful
screen." It sits beneath five consecutive "Sales data source not connected"
placeholders (Commercial Profile, Financial Summary, Credit, Forecast Horizons,
Pipeline). Worse on mobile.

## Finding 8 — fabricated CRITICAL severity · **MEDIUM** · carried forward, still open

Operations Overview reconciliation rows still show `Actual NaN · Variance NaN ·
Severity CRITICAL`. Never badge a row whose value is non-numeric.

## Remediated in this round (UX-owned, merged)

Completion no longer proceeds **silently** when planned parts are unrecorded —
`domain/plannedPartsCompletion.js` plus a one-time confirmation. It warns rather
than blocks: the server is the completion authority, jobs legitimately finish
without consuming every planned part, and a client-side block would be a workflow
policy change this layer has no standing to make. Justified on **static** evidence
(`TechnicianWorkOrderActions` had no parts check of any kind), independent of the
contaminated run.

Technician execution controls raised to a 44px minimum (WCAG 2.5.5). They render in
the ordinary desktop workspace and never inherited the 48px minimum
`.fo-workspace[data-density="field"]` gives FieldMode — measured at 31px, including
the parts steppers a technician taps most with wet or gloved hands.

## Service IA — evidence status: still accumulating, no recommendation

Second independent probe of Finding C. The five Work Orders were reachable through
Work Orders, Dispatcher Board, Job Assignments, Scheduling and the customer record,
and the dispatcher traversed six modules for one question. That is consistent with
fragmentation, but this journey deliberately **does not** produce a consolidation
recommendation: the coordinated projection that would most change the answer is
unexposed, so the strongest available design input is missing. Consolidating now
would be deciding IA from an incomplete substrate.

## Journey status

`J-COORD-INSTALL` — **PARTIAL.** Work Order layer traversed end to end. The Sales
Order, allocation and billing legs terminate at "no client consumer"; downstream
behaviour was **not** analyzed, per the rule against burning tokens on behaviour
that cannot yet exist.

Billing question: the customer cannot be told anything. Financials says *"This area
isn't built yet"*; the customer record says *"Sales data source not connected"* in
three places. This is the correct honest state for an unbuilt domain — recorded as
**substrate absence, not a defect**, and Finance personas remain correctly
unactivated.
