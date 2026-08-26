# North Star migration — family ledger

Status: **LIVE LEDGER.** One row per page family, appended as each is migrated. Never rewritten
retroactively: a family whose acceptance later changes gets a new dated line, not an edited one.

## Why this file exists

The three-authority model ([`eos-north-star-sources.md`](./eos-north-star-sources.md)) separates
Design authority, Behavioral authority, and **Acceptance** — and acceptance belongs to the Owner
looking at the running sandbox. That third authority is the one a build cannot grant itself.

So there has to be somewhere that records, per family, the difference between *shipped and green*
and *accepted*. Without it, "the Work Order family is done" and "the Owner has seen the Work Order
family" collapse into the same sentence, and the programme loses track of which claim it is making.

`AWAITING_OWNER_VISUAL_ACCEPTANCE` is a real state in this ledger, not a caveat. It means: the
behavioral work is complete and proved, and the remaining authority has not spoken.

## What each column means

- **Family** — the page family, in migration order.
- **Composition** — the shipped page and its derivation layer.
- **Proof** — the suites that make the grammar falsifiable, plus mutation proofs run against them.
  A green suite that cannot fail is not proof; the mutation count is what makes the row meaningful.
- **Named decisions** — conflicts surfaced into
  [`north-star-open-product-decisions.md`](./north-star-open-product-decisions.md) rather than
  silently resolved.
- **Acceptance** — the Owner's state. Only the Owner moves this column.

---

## Family 1 — Work Order

| | |
|---|---|
| **Composition** | `src/modules/workOrders/WorkOrderDetailPage.jsx` over `src/domain/workOrderNorthStar.js` |
| **Visual authority** | `North Star - Work Order.dc.html` + `Implementation Render - Work Order.html` (P1v2, Owner ruling 2026-08-25) |
| **Proof** | `test/workOrderNorthStar.test.mjs`, `test/workOrderNorthStarPage.test.jsx`, `test/workOrderNorthStarAuthority.test.jsx`, `test/lifecycleBand.test.jsx`, `test/workOrderActionEmphasis.test.jsx`, `test/workOrderTouchTargets.test.jsx` |
| **Named decisions** | ND-1, ND-2, ND-4, ND-5, ND-6 open; ND-3 answered (behavior deferred); ND-7 resolved as a sentence |
| **Gate** | Full Sandbox Regression Gate, exit 0, all 8 ledger phases, 300/300 visits, 40/40 scanner, zero RAW\_ID findings |
| **Acceptance** | Closed 2026-08-25 |

**A correction that belongs in the record.** During closeout this build reported that the acceptance
gate had a false-green defect. It did not. The root cause was a mid-run edit to the gate script:
bash reads a script by byte offset, so inserting lines under a running interpreter made it resume
mid-line. `set -e` worked correctly and no PASS banner was printed. The claim was withdrawn in the
PR body and the commit message rather than quietly dropped.

**A gap found afterwards, in family 2.** `test/workOrderNorthStar.test.mjs` — this family's own
falsifiable-contract suite — was registered in neither `test/suites.json` nor any workflow, so
nothing ran it, and family 1 was closed partly on the strength of a CI run that never executed it.
Four other suites were in the same position. All five are now registered, and
`test/ciSuiteCoverage.test.mjs` was extended so a node:test suite that nothing runs fails the build.
See the *cross-family* section below.

---

## Family 2 — Sales Order

| | |
|---|---|
| **Composition** | `src/modules/sales/SalesOrderDetail.jsx` over `src/domain/salesOrderNorthStar.js` |
| **Visual authority** | No Sales Order artifact has been handed to this repo. Composed from the ratified grammar (`eos-north-star-design-grammar.md`) and the shipped family-1 pattern, per the standing overnight rule. **This makes Owner visual acceptance load-bearing rather than confirmatory.** |
| **Proof** | `test/salesOrderNorthStar.test.mjs` (37), `test/salesOrderNorthStarPage.test.jsx` (18), plus the reconciled `test/salesOrderDetail.test.jsx` (22) and `test/coreRecordPages.test.jsx` |
| **Mutation proofs** | 10 — 5 against the projection (ND-8 stage-time fabrication, R03 id-as-reference, R04 enum leak, attention on a terminal order, partial allocation counted as complete) and 5 against the composition (id as page title, raw enum in the header, false liveness claim, emptied lifecycle band, a second invocation path in the suggestion). All 10 caught; the source restored byte-identical after each. |
| **Named decisions** | ND-8 (no lifecycle stage times), ND-9 (Sales Agreement has no resolvable reference), ND-10 (the read is not live) |
| **Gate** | Quick Gate PASSED against `1c8095d3` on platform-sandbox, 2026-08-26 — 12/12 sweep visits, 7/7 dynamic entities resolved, **zero blocking findings, zero RAW_ID**. Not the acceptance gate. |
| **Acceptance** | **PASS — closed 2026-08-26** (Owner visual acceptance against deployed `1c8095d3`; Quick Gate PASS, no blocking findings; no Full Gate required under the presentation-migration rule, DECISIONS #128) |

### Owner visual acceptance — 2026-08-26

The Owner accepted the Sales Order family against the running sandbox at `1c8095d3`, and stated that
**no Full Sandbox Regression Gate is required under the North Star presentation-migration rule** —
the rule that a family changing only presentation, with no command, capability, write path or Rules
change, clears on the Quick Gate. Recorded as DECISIONS #128. It is an Owner ruling about *which*
gate the obligation is, not a waiver of one.

This matters more here than it did for family 1. Family 2 shipped with **no Design artifact in
hand** (DECISIONS #125): `Proposed - Sales Order.dc.html` is named in the sources doc and was never
handed to this repository, so the composition was derived from the ratified grammar and the shipped
family-1 pattern. The ledger recorded that this made acceptance *load-bearing rather than
confirmatory*. That is the authority that has now spoken — a grammar-derived composition, confirmed
correct by the one authority a build cannot grant itself.

ND-8, ND-9 and ND-10 remain open. Accepting the composition is not resolving the facts the
composition is honest about.

### What changed, beyond the restyle

- The lifecycle was **absent** from this page entirely. It is now the band, derived once.
- The state was stated **twice** — a pill in the ContextBand and a field in the metadata grid. It is
  stated once, as a sentence, and `salesOrderRecordPageRailSubset` structurally prevents the grid
  from repeating it (or the customer, owner, channel or total).
- `salesOrderView.js` was **dropping `createdAtMillis` and `updatedAtMillis`** — the same
  value-never-arrives defect that had already been found and fixed for the money on this exact
  module. The read service's own comment predicted it would surface "the first time a timestamp was
  displayed". This was that time.
- `SalesOrderActions.jsx` printed a **raw enum in user-facing copy**: "No further actions are
  available for a CLOSED Sales Order." It now sources the word from the one state vocabulary.

### Three honest departures from family 1

1. **No live indicator** — `useSalesOrder` is a one-shot read (ND-10).
2. **The suggestion slot speaks** — the governed deterministic recommendation genuinely has
   something to say here, unlike the Work Order's empty slot. It states an observed fact and points
   at the Allocate button that already exists; it adds no second invocation path and no AI-originated
   write.
3. **Only one stage can state a time** (ND-8).

### Authority, unchanged

No command, capability, write path or Rules change. Every write still resolves through
`transitionSalesOrder`, `allocateSalesOrder` and `createServiceForSalesOrder` via the unmodified
`SalesOrderActions`. All 13 pre-existing authority, capability-gating and action tests pass
untouched.

---

## Cross-family — the CI coverage hole found during family 2

`test/ciSuiteCoverage.test.mjs` existed to stop exactly one failure: a suite merged that CI never
runs. It guarded `.test.jsx` files, and its header asserted that node:test suites "do not need
listing here: they are registered in test/suites.json and run by `npm test`".

That sentence described the intent. It was checked and it was false — **five `.test.mjs` files were
in neither the manifest nor any workflow**:

- `test/workOrderNorthStar.test.mjs`
- `test/accountArView.test.mjs`
- `test/equipmentSerialProjection.test.mjs`
- `test/resolveEffectivePermissionParity.test.mjs`
- `test/salesOrderCapabilityAccess.test.mjs`

All five passed when run. All five are now registered — no allowlist was created, deliberately: an
allowlist seeded at zero is a place for the next one to go. The guard now applies the same rule to
both runners, and carries a second assertion that the manifest names no file that does not exist.
Both new assertions were mutation-proved (a stray unregistered suite, and a phantom manifest entry).

`npm test` now runs 250 suites, up from 244 (251 after family 3).

---

## Family 3 — Account (Customer 360)

| | |
|---|---|
| **Composition** | `src/modules/accounts/AccountDetail.jsx` over `src/domain/accountNorthStar.js` |
| **Visual authority** | No Account artifact has been handed to this repo either. `Proposed - Account.dc.html` is named in the sources doc and has not been seen here. Composed from the ratified grammar and the shipped family-1/2 pattern. |
| **Proof** | `test/accountNorthStar.test.mjs` (18), `test/accountNorthStarPage.test.jsx` (12), plus `test/compositionConformance.test.jsx` (7, three of them new) |
| **Mutation proofs** | 6 — attention removed from its NS-P2 position · id as the page title · raw enum in the header · a status clause implying a progression · `accountLifecycle` claiming a spine · the new shell gate quietly losing a migrated family. All 6 caught; sources restored byte-identical. |
| **Named decisions** | ND-11 (an Account has no lifecycle to make visible) |
| **Gate** | Quick Gate PASSED against `1c8095d3` on platform-sandbox, 2026-08-26 — 12/12 sweep visits, 7/7 dynamic entities resolved, **zero blocking findings, zero RAW_ID**. Not the acceptance gate. |
| **Acceptance** | `AWAITING_OWNER_VISUAL_ACCEPTANCE` |

### The defect was ordering, not absence

`AccountAttentionSection` was already right: bounded, account-scoped, composed from existing
authorities, honest per source, silent when there is nothing to say. It rendered at the **bottom of
the secondary column**, below every related list — a reader reached it after everything it should
have warned them about. It moved to its NS-P2 position and says exactly what it said before.

It is deliberately **not** flattened into the shared `AttentionBand`.
`accountAttentionProjection.js` states that AR and Work-Order past-due are never merged into one
ranked list, and a flat band has nowhere to put its per-source honest notes. A first draft of the
derivation layer did adapt them, and was removed — overriding a behavioral rule to satisfy a visual
pattern is what the three-authority model forbids.

### ND-11, and why the page says so out loud

An Account has four status values that look like a progression and no transition command at all.
Four chevrons would assert a rule nothing enforces. The page renders the status as a sentence and
states the reason in words, rather than leaving an unexplained difference from the other two record
families.

The premise is guarded: a test fails the moment `status` leaves `accountRecordPage.editableFieldIds`,
so ND-11 cannot quietly outlive its own reasoning.

### What else came out

- Two private label maps in the page duplicated the `enumLabels` in the canonical metadata
  definition. The classification now reads the definition, and renders as **words** rather than
  pills — `accountRelationshipTone` and `accountLineOfBusinessTone` return the constant "info" for
  every value, so the pills were colouring nothing.
- A comment claimed `finance.read` is "denied for every current viewer". It is activated for
  `eos-platform-sandbox` in `access/environmentCapabilityOverrides.ts`, along with
  `opportunity.read`, `salesOrder.read` and `crm.activity.read`.

---

## Cross-family — the shell obligation two families had escaped

`compositionConformance.test.jsx` requires every conformant workspace to import `WorkspaceShell`.
The North Star grammar replaces that shell with `ns-page`. Migrating the Account — which WAS on the
Wave-2 conformant list — is what forced the conflict into the open.

Investigating it found something worse. `WorkOrderDetailPage.jsx` and `SalesOrderDetail.jsx` are on
**no list at all**: never added to `CONFORMANT_WORKSPACES` (which would have demanded the shell they
deliberately dropped), so **from 2026-08-25 until 2026-08-26 the two migrated record families
satisfied no composition obligation whatsoever.** They did not defeat the gate; they shipped past
the edge of it.

The obligation is now **replaced, not waived** (DECISIONS #126), by a category that is stricter than
the one it replaces. And when that new gate was mutation-proved, it had the same disease: deleting
an entry made it check fewer files and nothing failed. Membership is now derived from the tree, so a
surface composing the grammar and declared nowhere fails the build.

Two gates in two days — this one and the CI-coverage hole in DECISIONS #124 — turned out not to be
guarding what they claimed. Both were found by asking a gate to fail on purpose rather than by
reading it.

---

## Family 4 — Opportunity: STOPPED, and why

**Status: NOT STARTED. Needs an Owner decision, not more engineering.**

Opportunity is the next surface in the sources table after the Account. It is the point where the
migration stops being a migration.

Verified against the repo on 2026-08-26 (the design grammar's standing-gaps table had already proved
stale once tonight, so this was checked rather than quoted):

- **No per-record route.** `App.jsx` has `opportunities/sales-order/:salesOrderId` and nothing for an
  Opportunity itself. An Opportunity has no URL.
- **No per-id governed read.** `functions/src/opportunity/opportunityReadService.ts` exposes
  `listOpportunitiesForAccount` and `listOpportunityContext` — both LIST reads. There is no
  `getOpportunityContext`.

The first three families each took a page that already existed, already had its data, and already had
its authority, and recomposed it. Family 4 has no page to recompose. Building it means a new trusted
callable and a new route — a **product build** that adds backend surface and would need a deploy this
session cannot perform. The design grammar classifies it the same way: *"Opportunity has a URL → No
per-record route; no per-id governed read → **Requires product build** (small)."*

That is a change of scope, not a change of difficulty, so it is surfaced rather than absorbed.

### What the alternatives cost

| Candidate | Archetype | Why it is not a drop-in continuation |
|---|---|---|
| Opportunity | Record detail | Needs a new callable + route (above). |
| Parts workspace | Operational queue | Different archetype; the grammar's readiness column needs a live truck-stock read that does not exist. |
| Dispatch board | Board/scheduler | Densest surface in the set; drag-scheduling with refusal reasons. |
| Sales Agreement | Create/edit | "Hardest commercial surface" — and already the ONE surface distinguishing all four honest states, so it has the least to gain. |
| Technician / Warehouse mobile | Handheld flow | Explicitly "language inherited, composition rebuilt" — not a desktop migration at all. |

### Sandbox and gate state for families 2 and 3

Both are **merged and green in CI, and neither has been through a sandbox gate.** Refreshing the
sandbox from merged main is an Owner-run action (`.\sandbox-refresh.ps1`); this session does not
deploy. Running the Quick Gate before that refresh would certify the build already deployed, which is
a green result about the wrong commit.

So the honest state of both rows is: behavioral work complete and proved offline, **awaiting a
sandbox refresh from merged main, then the Quick Gate, then Owner visual acceptance.**

---

## Sandbox refresh — 1c8095d3, 2026-08-26

Deployed and verified **from the environment, not from the exit code**:

```
{ "commit": "1c8095d3", "environmentId": "platform-sandbox",
  "environmentRole": "sandbox", "buildTime": "2026-08-26T15:47:39.375Z" }
```

The refresh required advancing the designated release checkout first: it was detached at
`3deb250b` — the previously deployed build, three merges behind — and the runbook neither fetches
nor checks out. It takes `HEAD` as the approved commit and refuses unless `HEAD == origin/main`,
which is the identity invariant working as designed rather than an obstacle. The runbook then
reported Rules and indexes **UNCHANGED vs 1c8095d3**, so no Rules or index deploy was performed.

### Quick Gate — PASSED

| | |
|---|---|
| Deployed identity | `1c8095d3`, confirmed an ancestor of HEAD before certifying |
| Pilot sweep | 12/12 visits, 0 nav failures, 0 browser relaunches |
| Dynamic detail | 7/7 entities resolved — account, opportunity, salesOrder, workOrder, contact, equipment, part |
| **RAW_ID findings** | **zero** — R03 holds on both new record pages |
| Blocking findings | **zero** |

The two finding classes reported — `OFFSCREEN_IN_SCROLLER` and `TINY_TARGET_DESKTOP_SURFACE` — are
the gate's own pre-declared tolerated set, on the stated reasoning that a control inside a
horizontal scroller is still reachable and a desktop workspace never promised a 44px target at
375px. Every sweep finding landed on `/service/job-assignments` and `/service/scheduling`, neither
of which this work touched; they are the same `.fo-button` / scroller cluster the Owner scoped out
of the Work Order closeout, and `.fo-button`'s 40px height is already ND-6.

`certifyDynamic.mjs` reports its findings by KIND rather than per entity, so the 25 tolerated
findings in the dynamic pass cannot be attributed to a specific record page from this run. None is
blocking. The full regression gate is what would give the per-route breakdown.

**This is not acceptance.** The Quick Gate deliberately skips the repo suites, three of five widths,
crash stress, persona reachability and the 40/40 scanner scenarios, and says so in its own exit
banner. Both families remained `AWAITING_OWNER_VISUAL_ACCEPTANCE` at the time of that run.

**Superseded for family 2 only, 2026-08-26:** the Owner has since accepted the Sales Order family
against this same `1c8095d3` build — see the family-2 row. **Family 3 — Account is unchanged and
remains `AWAITING_OWNER_VISUAL_ACCEPTANCE`.** The presentation-migration rule in DECISIONS #128 says
which gate family 3 must clear; it does not clear it. Acceptance was granted for one family, and
this ledger does not widen it to the other.
