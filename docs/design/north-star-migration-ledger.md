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
| **Gate** | *pending* |
| **Acceptance** | `AWAITING_OWNER_VISUAL_ACCEPTANCE` |

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
| **Visual authority** | *At the time of the first pass:* none — composed from the ratified grammar and the shipped family-1/2 pattern. **Superseded 2026-08-26** by `North Star - Account P1.dc.html`; see the second-pass section below. |
| **Proof** | `test/accountNorthStar.test.mjs` (18), `test/accountNorthStarPage.test.jsx` (12), plus `test/compositionConformance.test.jsx` (7, three of them new) |
| **Mutation proofs** | 6 — attention removed from its NS-P2 position · id as the page title · raw enum in the header · a status clause implying a progression · `accountLifecycle` claiming a spine · the new shell gate quietly losing a migrated family. All 6 caught; sources restored byte-identical. |
| **Named decisions** | ND-11 (an Account has no lifecycle to make visible) |
| **Gate** | *pending* |
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

### Family 3, second pass — reconciled against the approved design (2026-08-26)

The table above describes the FIRST pass, which composed from the grammar because no Account
artifact existed. One does now: `design_handoff_account/North Star - Account P1.dc.html`, whose
README states that #1511 was inspected as behavioral evidence only, never as visual truth.

| | |
|---|---|
| **Visual authority** | `North Star - Account P1.dc.html` — 1a desktop 1440, 1b tablet 768, 1c phone 375 |
| **Nature** | Presentation/composition reconciliation. Not a rebuild, not new product. |
| **Proof** | `test/accountNorthStarP1.test.jsx` (33), `test/accountAttentionSection.test.jsx` (11, reconciled), `test/accountNorthStarPage.test.jsx` (14), `test/accountNorthStar.test.mjs` (22), `test/phoneLink.test.mjs` (5), `test/accountArView.test.mjs` (11) |
| **Named decisions** | A-D1–A-D4 **resolved**; A-NS-1 **recorded**; ND-11 unchanged |
| **Authority change** | none |
| **Full Gate** | not triggered |
| **Acceptance** | `AWAITING_OWNER_VISUAL_ACCEPTANCE` |

**What the design changed, and what it confirmed.** The design's own comparison called nine things
in #1511 correct and asked for eleven presentation adjustments. The nine were left alone. The
adjustments, in the order the page reads:

1. **Contacts lead the rail** — the load-bearing move. They rendered at the bottom of the main
   column, so "who do I call" was the last thing on the page.
2. **Standing is one ruled row** between two hairlines, not a grid of metric cards.
3. **Attention and its explanation share one bordered surface**, the explanation beneath the facts.
4. **Classification moved into the kicker** — identity, not a fact about the record.
5. **The terms digest joined the header facts.**
6. **Receivables got their own titled main-column section.**
7. **Standing precedes Attention**; Attention still precedes everything it warns about.
8. **Body proportions** 1fr / 340px / 56px, with real 1024, 768, 375 and 320 compositions.
9. **The equipment-absence sentence** joined Service activity.

**The intelligence line finally has a consumer.** `domain/accountIntelligence.js` shipped fully
tested with **no caller anywhere in the app**. The approved composition gives it its place: inside
the attention surface, beneath the governed facts, as explanation only. Its own contract already
guaranteed that `allowedRecommendation` is structurally null and that it falls silent on
`NO_ATTENTION` / `SOURCE_DEGRADED`; the surface adds no slot for a recommendation, so there is
nowhere for one to appear even if one were someday produced. It consumes the projection already
computed for the rows — no extra read.

**Silence is now the healthy state (A-D1).** The "Nothing needs attention on this account right
now." receipt is gone. A confirmed-healthy, empty account renders **nothing at all** where trouble
would have been. A source that could not be confirmed still speaks, in its own note — silence is
earned by a confirmed read, never by a failed one.

**Denied AR keeps its geography (A-D2).** `MetadataRecordPage` hides a capability-gated section by
rendering nothing, which on this page would delete the financial region for a salesperson — and a
customer record with no financial region reads as a customer who owes nothing. The section keeps its
title and states "Not available to you". Same fail-closed decision, rendered rather than hidden.

**The phone answers, it does not shrink.** Identity → attention → standing → primary contact →
activity, with profile, receivables and notes behind "More". The primary contact carries a working
`tel:` Call built from **that contact's own stored number** — the selection rule is mutation-proven
against an account holding a second, reachable, non-primary contact. No phone, MULTIPLE primaries, or
NONE each render their honest state and offer no Call.

**One defect this pass caused, caught before merge.** Splitting the main column into three
`MetadataRecordPage` calls made each fully-denied group render the **page-level** "You do not have
access to any part of this record" box — twice, on an ordinary denied view. All three fragment calls
now pass `embedded`, which is exactly what that flag exists for.

**A-NS-1 — a design premise the repository contradicts.** The design's note says "useAccount is not a
subscription". It is one (`onSnapshot`). The conclusion is implemented as written — no live badge,
honest "Read-checked *time* · Refresh" — because that wording is true either way. Recorded rather
than silently resolved; it changes no business behavior.

**Gaps preserved, not filled:** Opportunity record route (rows honestly non-navigable; the definition
carries no `rowNavigationTo`, asserted); account-scoped Equipment read (absence stated, workspace
linked, no count invented); pipeline / order-backlog / equipment-count metrics (named as absent in
one sentence rather than shown as tiles); `crm.activity.read` still inactive catalog-wide, so the CRM
timeline renders nowhere it has not been separately activated.

**Recorded for whoever gets there next:** the ≤744px row-to-card conversion is implemented for the
Account's own tables and rows. The shared `MetadataListGrid` still scrolls horizontally at handheld
widths; converting it is a change to cross-family list infrastructure and is deliberately outside a
single family's reconciliation.

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
