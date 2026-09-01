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

### Family 3, second pass — reconciled against the approved design (2026-08-26)

The table above describes the FIRST pass, which composed from the grammar because no Account
artifact existed. One does now: `design_handoff_account/North Star - Account P1.dc.html`, whose
README states that #1511 was inspected as behavioral evidence only, never as visual truth.

| | |
|---|---|
| **Visual authority** | `North Star - Account P1.dc.html` — 1a desktop 1440, 1b tablet 768, 1c phone 375 |
| **Nature** | Presentation/composition reconciliation. Not a rebuild, not new product. |
| **Proof** | `test/accountNorthStarPage.test.jsx` (47), `test/accountAttentionSection.test.jsx` (11, reconciled), `test/accountNorthStar.test.mjs` (22), `test/phoneLink.test.mjs` (5), `test/accountArView.test.mjs` (11) |
| **Named decisions** | A-D1–A-D4 **resolved**; A-NS-1 **recorded**; ND-11 unchanged |
| **Authority change** | none |
| **Full Gate** | not triggered |
| **Merged** | `7b6eaf14` (#1520), 2026-08-26, 16/16 checks green |
| **Gate** | *pending.* The Quick Gate recorded above certified `1c8095d3`, which predates this pass -- it says nothing about it. A refresh from merged `7b6eaf14` and a fresh Quick Gate are owed, and `scripts/_sandboxRefresh.run.sh` is human-triggered by design (`releaseRoot.mjs` refuses an agent worktree outright). |
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

### The CI finding this pass turned up (defect E)

The P1 assertions were first written as a SECOND suite beside `accountNorthStarPage.test.jsx`, which
`test/ciSuiteCoverage.test.mjs` correctly refused until a workflow named it — the DECISIONS #124
rule. Naming it meant editing `composition-conformance-tests.yml`, and **the PR carrying that edit
received no `pull_request` workflow runs at all.** Not a slow queue and not a red check: GitHub
created no check suite for the `pull_request` event on either head, on two different branches, while
other PRs opened in the same minutes got theirs normally.

It was bisected rather than guessed. A docs-only probe PR from this same session and worktree got
its three runs; the identical Account change with the workflow edit **removed** got fourteen. The
workflow-file edit is the cause — the push is accepted and the runs are then withheld, so the failure
mode is a PR that looks merely idle.

The finding matters beyond this change: **a PR that edits a workflow file can silently lose its
entire CI, and nothing reports it.** A red check is visible; an absent check suite is not. Whoever
next needs to register a suite should expect this and check for it explicitly rather than waiting.

The assertions were folded into `accountNorthStarPage.test.jsx` — already CI-named — so no workflow
edit is needed and no coverage is lost. That is where they belonged anyway: one page, one suite, one
mock block.

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

## Family 4 — Opportunity

**The stop was answered.** The row below replaces nothing: the previous entry (*"STOPPED, and why"*,
2026-08-26) recorded that this family needed an Owner decision rather than more engineering, and it
was right. The decision came back **build it**, and this is the build. The original entry is
preserved verbatim at the end of this section, because a ledger that rewrites its own stops loses
the record of having stopped.

| | |
|---|---|
| **Composition** | `src/modules/sales/OpportunityDetail.jsx` over `src/domain/opportunityNorthStar.js` and `src/domain/opportunityView.js` |
| **Read** | **NEW:** `getOpportunityContext` in `functions/src/opportunity/opportunityReadService.ts` |
| **Route** | **NEW:** `/customers/opportunities/:opportunityId` |
| **Visual authority** | **`North Star - Opportunity P1v2.dc.html`** — received 2026-08-26 (`Claude Design Docs/Opportunity North Star P1v2.zip`, folder `design_handoff_opportunity`, with a README mapping every element to repository authority). **The first family in this programme built against its real design source rather than from the grammar.** P1v2 supersedes P1v1 by adding the Sales Agreement relationship. |
| **Proof** | `test/opportunityNorthStar.test.mjs` (23), `test/opportunityNorthStarPage.test.jsx` (39 — Opportunity · Agreement · Sales Order · responsive · authority), plus the reconciled `test/opportunityLifecycleControl.test.jsx` (16), `test/salesWorkspace.test.jsx` (25) and `test/compositionConformance.test.jsx` (7) |
| **Visual validation** | Real browser, real stylesheet, fixture data, three widths — 1440 / 768 / 375. Zero horizontal overflow at every width; body resolves 964px + 340px at 1440 (the artifact's 1fr/340); chevrons at ≥760px container, the same position in words below it; all 10 controls ≥44px at 375. |
| **Named decisions** | ND-12 **withdrawn** (see below), ND-13 (the Opportunity has two compositions — now narrowed by P1v2), plus the design's own O1–O6 carried forward |
| **Gate** | **Sandbox Quick Gate PASSED** against deployed `8d239210`, 2026-08-27. See the reconciliation below. |
| **Acceptance** | `AWAITING_OWNER_VISUAL_ACCEPTANCE` |

### Built blind first, then rebuilt against the real design

This family was implemented once from the ratified grammar, before any Opportunity artifact existed
in this repository — and the ledger row said so. The design package then arrived, and the blind
build turned out to be wrong in ways that matter. **That is the whole argument for the three-authority
model, demonstrated rather than asserted.**

What the design changed:

| The blind build | P1v2 |
|---|---|
| A `LifecycleBand` with the chevrons deliberately suppressed | **Chevrons** — "this family legally gets chevrons" |
| `DECISION_PENDING` dropped from attention on NS-P4 grounds | `deriveAttention` **verbatim**, all four reasons |
| Kicker "Opportunity"; no subtitle | Kicker `Opportunity · {channel}`; serif subtitle = `need` |
| Lineage + Milestones rail | **Customer · Commercial details · Qualification · Record** |
| No Sales Agreement composition at all | A first-class **agreement card** with six honest states |
| No "When this closes"; no Activity slot | Both, stating the two governed paths and the O3 gap |
| Value with a tooltip | Bare number + **"(no currency recorded)"** (O1) |

The attention reversal is the sharpest of these. The blind build argued NS-P4 — the header already
says "awaiting customer decision", so the strip should not repeat it — and suppressed the reason.
P1v2 keeps both, because the header states WHERE the deal is and the strip states WHAT IS OWED.
Under the three rules, a conflict that changes only how an already-permitted fact is drawn is
**Design's to decide**, so the design was followed and the earlier call reversed in the code and in
the register.

### ND-12 is withdrawn — the design did not ask for stage times

ND-12 recorded that an Opportunity stores no per-stage timestamps, and the blind build wrote that
absence into a lifecycle band that opened one line of recorded fact per stage. **P1v2 draws no such
band.** Chevrons state position, not history, so there is no slot for a stage time and no gap for
the decision to describe. The underlying data fact is unchanged and still true; it simply stopped
being a product question the moment the real composition arrived.

`closedAtMillis` — added to the projection during the blind build — is kept. It is a real fact the
transition writes, it was projected to nobody, and the Activity section's honest note is the better
place for it than a fabricated stage row.

### What P1v2 composes, and from where

| Element | Existing authority composed |
|---|---|
| Identity, facts | `getOpportunityContext` via `useOpportunity`, shared `RecordIdentity` |
| Stage chevrons | `stageProgress` — the SAME derivation the pipeline row draws |
| One legal advance | `allowedActions` |
| Won / Lost | `useOpportunityTransitions` → `transitionOpportunity` / `closeOpportunityAsWon` |
| Section editing | `useOpportunitySectionSave` → `updateOpportunity`, version-checked |
| Attention strip | `deriveAttention`, worded by `opportunityNorthStar.js` |
| Sales agreement | `useSalesAgreement`, `salesAgreementView`, `agreementAcceptability` |

**No capability, command, Rules change, state machine, numbering or pricing was added.** The
lifecycle control gained a `slot` prop that decides only WHERE a control renders; the page mounts it
twice and passes ONE `transitions` object, so both slots share a single idempotency cache and a
single invocation path.

### Two defects the design surfaced

- **A fabricated currency, on the pipeline surface.** The shared value formatter hardcoded
  `style: "currency", currency: "USD"` on `expectedValue` — a field stored as a bare number with no
  currency anywhere. Every Opportunity ever shown in the workspace carried a `$` nothing justified.
  This is decision O1's exact prohibition, and it was live. Now grouped digits, with the
  "(no currency recorded)" annotation stated once in the header.
- **Two renderings of one fact.** The record page's rail fell back to the model's bare defaults and
  rendered `41000` and `2026-08-31` beside a header saying `41,000` and `Aug 31`. The page now
  injects the same formatters the workspace uses.

Also corrected: a raw Firestore id printed as the link text of the WON acknowledgement — **with a
test pinning it in place**, titled "falls back to the id — a reachable order beats a pretty label".
The trade-off is false: the id is in the `href`, so the link works either way. Only the label
changed, and the test now asserts the rule.

### Known visual deviation, reported rather than absorbed

**The Solution table.** P1v2 draws Line / Kind / Qty as a three-column table with a thick head rule.
The shipped page renders the existing `LineSummary` list ("Taylor C712 ×2"), because that renderer
is shared with the workspace detail pane, where a three-column table in a ~340px column would be
worse than the list. Changing it is a shared-component decision affecting a surface this run was
told not to redesign. Content is complete — kind, reference and quantity all render — and the
deviation is structural only.

**One artifact detail is illustrative, not a rule.** The P1v2 attention strip reads "expected close
is in 9 days", but `deriveAttention` raises `CLOSE_SOON` only within **seven**. The threshold is
domain authority and stands; the wording follows the engine.

### CORRECTION — a Quick Gate PASS that was not evidence (2026-08-27)

The Quick Gate run against `c45979b7` reported, and this build reported onward:

> **Agreement — permission state · PASS** — "Sales agreements aren't enabled in this environment
> yet." NOT_ENABLED rendering honestly on real config.

**That was wrong, and the error was mine rather than the gate's.** The environment was never the
reason. `salesAgreement.read`, `.create`, `.updateDraft` and `.accept` are all **ACTIVATED** for
`platform-sandbox` in `access/environmentCapabilityOverrides.ts`.

The real cause: `OpportunityDetailConnected` in `App.jsx` resolved `hasCapability` from the trusted
feed, used it for write-readiness, and **never passed it to `OpportunityDetail`**. The page fell
back to its own fail-closed default (`() => false`), so `useSalesAgreement` was called with
`enabled: false` and returned `NOT_ENABLED` on every record, permanently. "Create Sales Agreement"
could never render either.

**Why it survived a gate and a reviewer.** The sentence was honest about what the component had
been told; the component had been told something false. A truthful-looking `NOT_ENABLED` reads as a
deliberate environment gate — so nothing about it invites investigation. The Quick Gate asserts no
text and could not have caught it. I looked at it, saw the state I expected, and stopped.

It was found only when the Workspace P1v3 package required knowing whether the Agreement layer was
live, and the override file said it was.

**What the earlier row does and does not now claim.** The Quick Gate's route resolution, RAW_ID
result, currency correction and customer-name resolution stand — each was read from rendered output.
The Agreement permission-state line is **withdrawn**: it was a statement about a disconnected seam,
not about environment configuration. Fixed in PR #1529, guarded by a test that fails if a seam is
resolved without being threaded.

### Gate state — deliberately not claimed

This work is **repo-complete and green offline. It has not been deployed and no gate has been run
against it.** Refreshing the sandbox from merged main is an Owner-run action; this session does not
deploy. Running the Quick Gate before that refresh would certify the build already deployed, which
is a green result about the wrong commit.

**This family additionally needs a Functions deploy that families 1–3 did not.**
`getOpportunityContext` is a new callable, and until it exists in the environment the page renders
its honest `unavailable` state. That is the one genuinely new operator step this build introduces,
and it is why this row's acceptance value names the refresh explicitly rather than jumping straight
to `AWAITING_OWNER_VISUAL_ACCEPTANCE`.

The visual validation above was run against a temporary local harness — the real component tree and
the real stylesheet over fixture data, in a real browser at three widths — and the harness was
removed afterwards. It proves the COMPOSITION: geometry, the responsive swap, overflow and touch
targets. It does not prove the LIVE DATA PATH, which needs the deploy. Both halves are required, and
only one of them is done.

So the honest state is: behavioral work complete and proved offline, **awaiting a Functions deploy
and a sandbox refresh from merged main, then the Quick Gate, then Owner visual acceptance.**

---

### The original stop, preserved (2026-08-26, before the decision)

> **Status: NOT STARTED. Needs an Owner decision, not more engineering.**
>
> Opportunity is the next surface in the sources table after the Account. It is the point where the
> migration stops being a migration. Verified against the repo on 2026-08-26:
>
> - **No per-record route.** `App.jsx` has `opportunities/sales-order/:salesOrderId` and nothing for
>   an Opportunity itself. An Opportunity has no URL.
> - **No per-id governed read.** `opportunityReadService.ts` exposes `listOpportunitiesForAccount`
>   and `listOpportunityContext` — both LIST reads. There is no `getOpportunityContext`.
>
> The first three families each took a page that already existed, already had its data, and already
> had its authority, and recomposed it. Family 4 has no page to recompose. Building it means a new
> trusted callable and a new route — a **product build** that adds backend surface and would need a
> deploy this session cannot perform. The design grammar classifies it the same way. That is a
> change of scope, not a change of difficulty, so it is surfaced rather than absorbed.

**Both bullets are now false, and that is exactly what this row records.** The candidate table in
that entry — Parts workspace, Dispatch board, Sales Agreement, handheld — is unchanged and still
describes the surfaces after this one.

### Sandbox and gate state for families 2 and 3

Both are **merged and green in CI**; both went through the Quick Gate against `1c8095d3` recorded
below, and both remain `AWAITING_OWNER_VISUAL_ACCEPTANCE`.

---

## Family 5 — Sales Agreement

**The first family built against a design source that was itself verified against the repository.**
P1v2 was not handed over and implemented; it was produced from the Owner’s correction order by
re-checking every design-driving claim in source, and four of those checks changed the design
before a line of implementation existed. That is why this row has no “built blind first” section.

| | |
|---|---|
| **Composition** | `src/modules/sales/SalesAgreementDetail.jsx` over `src/domain/salesAgreementNorthStar.js`, `src/domain/salesAgreementRead.js` and the existing `src/domain/salesAgreementView.js` |
| **Read** | **EXISTING, previously uncalled:** `getSalesAgreementContext` (by id). No new callable, capability, index or Rules change in any of the six PRs. |
| **Route** | **NEW:** `/customers/opportunities/sales-agreement/:salesAgreementId` — nested under `opportunities/` following the Sales Order precedent (#129). A URL shape is not ownership. |
| **Visual authority** | **`North Star - Sales Agreement P1v2.dc.html`** — `docs/north-star/sales-agreement/`, merged as PR #1533 (`7f1ab681`), registered in `eos-north-star-sources.md`, Owner-approved 2026-08-26. Five artboards at true 1440 / 768 / 375 / 375 plus twelve state studies. |
| **Implementation** | Six PRs: [#1536](https://github.com/TaylorService-spec/Taylor_Parts/pull/1536) derivation · [#1537](https://github.com/TaylorService-spec/Taylor_Parts/pull/1537) by-id read seam · [#1538](https://github.com/TaylorService-spec/Taylor_Parts/pull/1538) record page · [#1539](https://github.com/TaylorService-spec/Taylor_Parts/pull/1539) command wiring · [#1540](https://github.com/TaylorService-spec/Taylor_Parts/pull/1540) lineage · this PR, closeout. Work order: `docs/implementation-plans/sales-agreement-north-star.md`. |
| **Proof** | `test/salesAgreementNorthStar.test.mjs` (26) · `test/salesAgreementByIdRead.test.mjs` (18) · `test/salesAgreementNorthStarPage.test.jsx` (30) · `test/salesAgreementCommandWiring.test.jsx` (24) · `test/salesAgreementLineage.test.jsx` (19), plus the reconciled Opportunity, Sales Order and conformance suites |
| **Mutation proofs** | **20 — all caught, every source restored byte-identically.** Raw doc id as identity · fabricated line name · unknown money as zero · “binding” reintroduced · signature evidence implied · accepted facts synthesized locally · direct Firestore read · direct Firestore mutation · a third command exposed · decline · revise · CREATE from a by-id NOT_FOUND · NONE_YET/NOT_FOUND collapsed · terminal Edit restored · state relabelled as permission · permission relabelled as state · duplicate route alias · Opportunity raw id exposed · `sourceAgreementId` shown as identity · shared `.ns-record-body` changed. Two initially escaped and are recorded below. |
| **Visual validation** | Real browser, real stylesheet, the page’s own markup, with the 252px application rail accounted for. **1440** → content 1188, body overflow 0, `.ns-record-body` `760px 340px` gap 56, commercial table 760px with no scroll needed. **768** → overflow 0, `352px 352px` gap 32. **375** → overflow 0, single column 343px. Zero elements overflow outside a declared scroll container at any width. |
| **Named decisions** | ND-14 (`DECLINED` modelled, unreachable), ND-15 (no post-acceptance revision path), ND-16 (the design’s 224/300/40 vs the shipped 252/340/56 — Owner ruled *build to the shipped grammar*), and ND-9 carried forward unchanged |
| **Gate** | **Sandbox Quick Gate PASSED** against deployed `0cc303ba` on `platform-sandbox`, 2026-08-27 — pilot route sweep, dynamic detail sweep, **zero RAW_ID findings**. Not the full regression gate. |
| **Acceptance** | Closed 2026-08-27 |

### Owner visual acceptance — 2026-08-27

Reviewed on the deployed sandbox and **APPROVED**. The Owner accepted the visual implementation
**as composed on the shipped 252 / 340 / 56 grammar** — the main column lands at 680px beside the
252px application rail, not the artifact's 820px, and that is the accepted result.

| | |
|---|---|
| **Sandbox release** | `0cc303ba` · `platform-sandbox` · built 2026-08-27T06:11:31Z, read from `/version.json` |
| **Quick Gate** | PASS |
| **Owner visual acceptance** | APPROVED |

**ND-16 is NOT reopened by this review.** The question of whether the shared record grammar should
move toward the design's 224 / 300 / 40 for every family stays open on its own terms; accepting
this family on 252 / 340 / 56 answers what family 5 ships, not what the grammar should become.

**Draft and blocked-Draft were NOT OBSERVABLE at review.** All five sandbox agreements
(SA-2026-000001 through 000005) are ACCEPTED, so no Draft fixture existed to open — and none was
created, because a gate that mutates its own fixtures certifies a sandbox nobody else will see.
Automated Draft coverage remains green: the derivation, page and command-wiring suites all assert
the Draft composition, the unpriced-line blocker and its named reason. **The acceptance therefore
rests on live evidence for the accepted states and on suite evidence for the draft ones**, and the
distinction is recorded rather than smoothed over.

**What was observed live**, across all five records at 1440 / 768 / 375: governed number as the
title with no document id anywhere visible; reference-first lines; the two-block money ladder;
exactly three acceptance evidence facts with the actor resolved to a person; the
no-customer-signature statement; terminal records offering no action control at all; upstream
opportunity links and downstream Sales Order links both resolving; a by-id address with nothing
behind it reading *No sales agreement matches this address* and offering no Create; and zero
horizontal overflow at every width.

**SA-G2 through SA-G7 remain follow-ups under their existing classifications.** Acceptance of the
family is not acceptance of its gaps.

### What the design pass found before implementation started

Four claims in the P1v1 handoff did not survive being checked against source, and each changed the
design rather than the code:

- **Agreement lines persist `ref` and no durable display name.** P1v1 led each line with a product
  name that nothing stores. The reference became the identity (SA-G4).
- **`DECLINED` is modelled with a legal transition and no producing command** (ND-14).
- **A terminal agreement cannot be edited AND a second agreement for the same opportunity is
  transactionally refused**, so there is no governed post-acceptance revision path. P1v1 asserted
  “a changed mind is a new agreement”, which the engine refuses (ND-15).
- **The Sales Order is produced by the Opportunity’s `closeOpportunityAsWon`**, which can still
  refuse. Acceptance is a precondition, not the trigger.

P1v1 also labelled its frames 1440/768/375 while composing roughly 1640/792/407. P1v2’s frames were
measured after authoring and render at exactly their stated widths.

### The two mutations that escaped first, and what they mean

Recorded because a mutation register that only lists successes is not evidence.

1. **Duplicate route alias — a real coverage gap, now closed.** The assertion counted routes whose
   *path* contained `sales-agreement`. An alias at `opportunities/agreement/:id` mounts the same
   page at a second address and contains no such substring, so the assertion could not see it. It
   now counts routes by their **element** (`<SalesAgreementDetailConnected />`) and requires exactly
   one. Re-run: caught.
2. **CREATE from a by-id NOT_FOUND — an inert mutation, not a weak test.** The mutation passed an
   `action` prop to `HonestState` in the `NOT_APPLICABLE` branch, and that branch **ignores
   `action` entirely** — the same trap `SalesOrderDetail.jsx` already documents about its
   `UNAVAILABLE`/`onRetry` pair. Nothing rendered, so nothing could be caught. Re-run with a
   mutation that genuinely renders a Create control: caught.

   *Worth knowing:* `HonestState`’s `NOT_APPLICABLE` branch silently drops `action`. A future
   developer adding one there gets no button and no error.

### Known incompleteness, recorded rather than smoothed over

**SA-G7 — line pricing is not on the record page.** The page’s Draft editor covers the six scalar
commercial terms, all on the server’s own allowlist. It does not price lines, so an acceptance
blocked by an unpriced line cannot be cleared from this page.

**This is a migration-completeness gap, not a functional one, and the distinction was corrected
during closeout.** The PR 4 report called it “the only way to clear the unpriced-line blocker”,
which implied users are stuck. They are not: `SalesAgreementPanel` inside `SalesWorkspace` ships a
full line editor today — `ProductReferencePicker`, per-line quantity and unit price — and remains
mounted. The gap is that two surfaces now show one record and only one of them can price it, which
is the same question ND-13 asks about the Opportunity’s pane.

**Closed 2026-08-27 (#1544).** The editor was **moved**, not reimplemented: `BLANK_LINE`, `toMinor`,
`LinesEditor` and `buildLines` were extracted from `SalesAgreementPanel.jsx` to
`salesAgreementLines.jsx`, and both surfaces import them. Two editors pricing one agreement would
eventually round differently or disagree about which price shapes are acceptable, and that
disagreement would be about what a customer agreed to pay. `toMinor` is the whole currency contract
in eight lines — empty means UNPRICED and not zero, and anything that is not a plain amount is
refused rather than coerced. A second copy of that is a second answer.

With it, pane-only Sales Agreement capabilities reached **zero**, which is what unblocked the pane
retirement recorded below — and, with it, ND-13.

---

## Cross-family — the Opportunity pane could not retire, and now has (2026-08-27)

**Owner ruling, 2026-08-27.** Opportunity Workspace P1v3 is DESIGN APPROVED and its architecture is
final: a full-width workspace, no master-detail pane, no preview. **The deployed retirement is
blocked**, and the reason is repository truth rather than a design disagreement.

`SalesAgreementPanel` lives inside the workspace's legacy pane, and it is the **only UI in the
product** through which a governed Sales Agreement can be drafted, priced/edited and **accepted**.
Those capabilities — `salesAgreement.create`, `.updateDraft`, `.accept`, `.read` — are ACTIVATED for
`platform-sandbox`.

The workspace design's premise for retirement is stated in its README: *"nothing from the pane needs
a new home; the record already carries all of it."* That holds for six of the seven pane sections —
Overview, Commercial Terms, Pricing, Instructions, Provenance and Items all exist on the approved
P1v2 record. It does **not** hold for the Agreement panel: P1v2's Agreement composition is
read + Create, and P1v2 itself assigns acceptance to "the agreement itself", which has no surface.

Retiring the pane now would delete an activated governed business capability. That is not a
presentation migration, and no workaround is acceptable: not a temporary Agreement page, not
duplicating the panel onto the record, not disabling the capabilities.

**This is not a new Opportunity product gap.** It is a cross-family presentation dependency:

```
Opportunity legacy pane  ──hosts──▶  Sales Agreement governed UI  ──belongs in──▶  Sales Agreement North Star
```

**Sequence:** Sales Agreement North Star P1v1 provides the replacement governed surface → then the
legacy pane is retired and Workspace P1v3 completes → focused tests → sandbox refresh → Quick Gate →
live-render validation → Owner visual acceptance.

The domain half of the workspace package (two governed pipeline views) is parked, tested and
unmerged on `claude/opportunity-workspace-p1`. It touches no pane code.

### Discharged, 2026-08-27 — and the count is now zero

The sequence above ran to completion, in the order it specifies.

**Sales Agreement North Star P1v1 provided the record** (family 5), which took over `read`,
`accept` and terms editing. That left exactly one capability behind, and naming it precisely
mattered: the blocker above says *"those capabilities — `salesAgreement.create`, `.updateDraft`,
`.accept`, `.read`"*, four in total. Re-verified against `main` at `b926adf9` rather than carried
forward on the strength of the earlier sentence:

| Capability | Where it lives outside the pane | Since |
| --- | --- | --- |
| `salesAgreement.read` | `SalesAgreementDetail.jsx` | family 5 |
| `salesAgreement.accept` | `SalesAgreementDetail.jsx` | family 5 |
| `salesAgreement.updateDraft` | `SalesAgreementDetail.jsx` — terms, then **line pricing** via SA-G7 | SA-G7 (#1544) |
| `salesAgreement.create` | `OpportunityAgreementCard.jsx`, on the P1v2 record | family 4 P1v2 |

**Pane-only Sales Agreement capabilities: zero.** `create` was never trapped — it belongs on the
Opportunity, because creating an agreement *for* an opportunity is an act performed from the
opportunity and there is no agreement yet to open. The genuinely trapped one was line pricing,
which SA-G7 moved by **extracting the editor to `salesAgreementLines.jsx` and composing it onto the
Agreement record** — one price parser serving both surfaces, rather than a second copy that would
eventually round differently or disagree about which price shapes are acceptable.

**The pane is now unrouted.** `SalesWorkspace` is mounted nowhere in the app; `/customers/opportunities`
renders the P1v4 collection. The retirement is **behavioral** — the module and its tests remain in
the tree, because several of those tests still guard shared domain behaviour that has no other home
yet, and deleting them to make a directory tidier would remove coverage this family is still using.
That deletion is **ND-17**, with the order that matters written down: enumerate what those suites
uniquely cover, rehome each assertion on a surface that still exists and prove the new home fails
when the behaviour breaks, and only then remove the module.

**Workspace P1v3 did not complete; it was superseded.** The sequence above anticipated
"Workspace P1v3 completes". It did not, and the reason is worth recording because it changed the
answer rather than the schedule: P1v3 was a revision of the *workspace*, and by the time the pane
was free to retire, the record had had its own certified route since P1v2. A full-width workspace
would still have been a surface whose job was previewing a page that already exists. **P1v4 replaced
the shape**, not the styling — `/customers/opportunities` is now a collection whose only job is
finding one opportunity, and the record is reached, not embedded.

Two derivations were lifted from the parked branch — the `NEEDS_ATTENTION` and `AT_DECISION`
pipeline views, pure domain slices that P1v4 also names — and `claude/opportunity-workspace-p1` was
abandoned rather than merged. No P1v3 presentation reached `main`.

---

## Family 4b — Opportunity collection (P1v4)

**Design authority:** `docs/north-star/opportunity/Opportunity-North-Star-List-P1v4.dc.html`.
**Route:** `/customers/opportunities`. **Supersedes:** Workspace P1, and P1v3 unbuilt.

The family has two surfaces now, and this is the first time that has been true in this ledger. The
record (P1v2) and the collection (P1v4) are separate North Star pages with separate artifacts, and
the migration README says so explicitly — a family is not a page, and flattening the two is how a
collection ends up governed by a record's artifact.

### What the pane was still holding, checked before it was removed

Retiring a surface deletes whatever only that surface offered. SA-G7 was exactly that failure one
family earlier, found *after* the record page shipped. So the check ran first this time, on the
governed write commands rather than on the components:

| Command | Only in the pane? | Where it is now |
| --- | --- | --- |
| `useOpportunityCreate` → `NewOpportunityForm` | **Yes** | Mounted by the collection |
| `useOpportunitySectionSave` | No | Already on the P1v2 record |
| `useOpportunityTransitions` | No | Already on the P1v2 record |

One genuine trap, found before it could become a regression rather than after.

### A second link was still pointing at the pane

The P1v2 record's header fact linked the agreement to
`/customers/opportunities?opportunity=<opportunityId>` — the pane's row selection — while the
Sales agreement section directly below it linked to the agreement record. **One fact, two
destinations** (NS-P4), and the header's was a surface this change removes. It also passed the
*opportunity* id where the *agreement's* id belongs, so it would have been wrong even if the route
had survived. Both now point at `/customers/opportunities/sales-agreement/:salesAgreementId`.

Worth noting how it survived: the card immediately beneath it had been correct all along. A defect
sitting inches from its own fixed twin reads as intentional.

### G2 — the repository knew more than the design assumed

P1v4 names G2 as *"the agreement reference is not on the opportunity list read"* and instructs the
column to render `No agreement` truthfully. Verified rather than assumed: `projectOpportunity` is
**shared** by the list read and the per-id read, and it returns `salesAgreementId` and
`salesOrderId`. Existence is knowable at list level for free; `buildPipelineRow` was simply dropping
`salesAgreementId` — the identical defect `salesOrderId` had one generation earlier, and the third
instance of "written to Firestore, projected to nobody" in this family.

What the read does **not** carry is either reference or either state. So the column states existence
and stops — `Agreement` / `No agreement`, `Order created` / `Order not created` — which is **more
than the design's fallback and less than its full treatment.** Recorded here as a named product
decision rather than taken as a silent win: populating references needs list-level resolution or
denormalisation, which is a read change, not a presentation change.

The forbidden alternative is the one that would have looked easiest: resolving each row's agreement
on demand. That is one round trip per visible opportunity on a surface built for scanning. A test
renders 25 rows and asserts the governed source was invoked exactly once.

### The tablet was built to the artifact, and the Owner rejected it (#136)

1b specifies a fold at 768: owner, channel and attention move into the identity cell. Built that way
first. Rendering it beside the 1440 and 375 frames is what surfaced the problem, and the Owner named
it in one sentence — *"the middle one goes into detail that consumes more space."*

Folding does not remove content; it moves it **downward**. Every row gained a third and often a
fourth line at exactly the width where vertical space is scarcest, so the tablet stopped answering
*"which of these needs me?"* and started answering *"tell me about each of these"* — the record's
question, on a surface whose whole job is finding one.

The tablet now **drops** rather than folds, which is what the desktop already does as it narrows.
Average row height went 68 → 58 against the desktop's 56; the phone frame, which the Owner accepted,
is untouched at 249.

Two things only measurement caught. The clamp holding rows to two lines had to begin at **1200**
rather than at the drop breakpoint, because wrapping starts as soon as the table narrows while
dropping is only needed once columns stop fitting — treated as one breakpoint, 1024 became the worst
band on the page. And it had to be bounded **below** at 601 too: below that a row is a card, where a
one-line clamp is wrong, and leaving it open cost 30px per card on the phone — regressing the one
frame that had just been approved.

The four row sub-lines had all shared a single class, which is *why* folding was the only lever
available: nothing could drop one without dropping all of them. They are now named for the fact each
carries, with three tests pinning the names, because merging them back would restore the rejected
behaviour with every test still green.

### Deferred from the artifact, with reasons

`+ Save as view` needs persistence authority for user-scoped list state. A sort control and column
chooser would replace a governed order (attention first, then closing soonest) with a spreadsheet's.
Pagination would imply a boundary the unpaged governed read does not have. `Updated moments ago`
would require an "as of" timestamp nothing supplies — and inventing a relative time is precisely
the class of fabrication this family keeps catching.

### Absence carried the tests, because last time it did not

The P1v2 blank-Owner defect survived 2,330 passing tests, every one of which resolved every fixture.
So most of the 43 tests here are about missing facts: unassigned and unresolved are different
sentences; an absent value is `Not estimated` and never `0`; `expectedValue` renders bare because no
currency is recorded for it (G5); no document id appears anywhere, for any of the four entities on a
row. Nineteen mutations were run against the load-bearing claims and all were caught but one
equivalent mutant — including three that survived a first pass and exposed real weaknesses in the
tests rather than in the code: an assertion matching a phrase where a bare `0` slipped through, a
navigation claim made against a harness with no route table to navigate in, and two slices whose
coverage lived in a different suite than the one being mutated.

### My opportunities is viewer-scoped, and says so when it cannot be

The only view whose membership depends on who is looking. The viewer's employee id resolves from the
directory subscription already open for owner names — no extra read. An account with no linked
Employee record gets a stated reason rather than an empty queue: *"we can't tell which are yours"*
is true; *"you have no opportunities"* is a confident false claim about somebody's work. Its tab
renders **no count** rather than a `0`, which would say the same wrong thing more quietly. An empty
collection still outranks it — telling a brand-new tenant their sign-in is unlinked describes the
wrong problem.

---

## Current-state reconciliation — the Opportunity family no longer awaits a refresh (2026-08-27)

**Appended, not rewritten.** Family 4’s two cells above moved; everything either row ever said
about its reasoning stands. This section records what changed and on what evidence.

**The prerequisite in the old acceptance value is discharged.** Family 4 read
`AWAITING_SANDBOX_REFRESH_THEN_OWNER_VISUAL_ACCEPTANCE` because nothing carrying it had been
deployed, and its Gate cell said *“NONE YET. Not deployed, not swept.”* Both are now false:

| | |
|---|---|
| **Sandbox release** | `8d239210` — deployed and identity-confirmed |
| **Opportunity P1v4 Quick Gate** | **PASS** |
| **List → Detail** | **PASS** |
| **Agreement-card live state** | The claim withdrawn earlier is now **PROVEN against real sandbox data** |

So the value becomes `AWAITING_OWNER_VISUAL_ACCEPTANCE` — the register’s existing token, the one
families 2 and 3 already carry. No new status was invented, and **nothing here is an acceptance**:
only the Owner moves that column, and both Opportunity surfaces are still waiting on it.

**Both surfaces, one family.** P1v2 remains the individual-record authority at
`/customers/opportunities/:opportunityId`; **P1v4** (family 4b) is the collection authority at
`/customers/opportunities`. The navigation is Sales → Opportunities → P1v4 list and state views →
select → P1v2 detail. Family 4b awaits Owner visual acceptance on the same release.

**Three statuses this does not change**, stated because a reconciliation is where they get changed
by accident:

- **Workspace P1v3 stays SUPERSEDED.** It was never built and never merged, and the discharge
  section above already records why the answer changed rather than the schedule. It is **not**
  unblocked for future implementation.
- **ND-17 stays OPEN.** The unrouted `SalesWorkspace` module is legacy cleanup, and it is **not**
  a P1v4 acceptance blocker. It must not be deleted until its uniquely useful coverage is rehomed
  and mutation-proved — the order the ND itself specifies.
- **ND-16 stays OPEN and untouched.** The Opportunity artifact’s dimensional discrepancy is not
  corrected here.

**ND-13 is CLOSED** (register: *RESOLVED 2026-08-27: the pane is retired*), and pane-only Sales
Agreement capabilities are **zero** — both already recorded above, and re-verified here rather than
restated on the strength of the earlier sentence.

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
banner. Both families remain `AWAITING_OWNER_VISUAL_ACCEPTANCE`.

---

## Dispatch & Scheduling — P1v1 · **ACCEPTED** (Owner, 2026-08-29)

**Accepted deployed commit:** `36280c306188b725ac549a4e31ef321b20abb0ac`
**Accepted against:** `eos-platform-sandbox`, Hosting only — no Functions, Rules or index deploy.
**State:** `OWNER_VISUAL_ACCEPTANCE: CLOSED / ACCEPTED`. This is the first family in this ledger to
leave `AWAITING_OWNER_VISUAL_ACCEPTANCE` by an Owner pass over live interactions rather than over a
rendered page alone.

### The evidence, and what each piece does NOT prove

Recorded this way deliberately. Three green numbers were produced during this acceptance and they
prove three different things; collapsing them into "the gate passed" is exactly the error that made
the second half of this work necessary.

| evidence | result | what it proves | what it does NOT |
| --- | --- | --- | --- |
| Dispatch Quick Gate (`dispatchNorthStarQuickGate.mjs`) | **27/27** | composition and honesty: the North Star renders, availability arrives through the trusted callable, no lane fabricates a percentage | **nothing about VC-1..VC-4.** Audited during this acceptance: it contains no assertion mentioning a window-less record, weekend, outside-band, reason, resize, keyboard or past time. It predates the corrections. |
| Corrections probe (`dispatchCorrectionsProbe.mjs`) | **14/14** | what the DEPLOYED board draws: R23 fallback visible and named, past region present with real width and `pointer-events: none`, no dead region on a future day, resize grips and `aria-keyshortcuts` on live chips, distinct geometry offsets, band widening to 13 columns for the 18:30 placement | any interaction. It is read-only by construction. |
| Interaction pass (`dispatchInteractionPass.mjs`) | **26/26** | VC-1..VC-4 as governed WRITES against live sandbox, each confirmed by reading Firestore back | anything about production, which it refuses by name |

### The accepted behaviours

- **Initial schedule drag** — queue → lane IS the Schedule action. No modal. Persisted `SCHEDULED`
  on the lane dropped on.
- **Reason-only reschedule** — one human reason; technician, start, end, duration and date are not
  re-asked. Persisted through `rescheduleWorkOrderCallable`, status unchanged, duration preserved.
- **Resize** — start held, end moved, persisted on the 15-minute grain. No separate duration
  authority: `setWorkOrderEstimatedDuration` is a PLANNING estimate and was not used.
- **Keyboard** — the same governed commands at the same 15-minute grain as the pointer.
- **Past slots** — visibly unavailable, unselectable, and **never silently moved forward**.
  `START_IN_PAST` was not reached in any accepted interaction: it stayed the server fallback.
- **R23** — a SCHEDULED windowless record (`wo-sbx-011`) stays visible under the lossless fallback.
- **Availability honesty** — known availability may truthfully show `0% booked`; unknown says
  "Shift not recorded" and withholds the percentage.

### Corrections to the record, preserved because they were wrong in flight

- The 27/27 Quick Gate is **composition/honesty evidence, not VC-1..VC-4 interaction evidence.**
- **Known availability with no booked work may correctly show 0%.** This was nearly reported as a
  defect during review; `tech-sbx-01` genuinely has a recorded 07:00–16:00 shift and nothing booked.
  The rule is about UNKNOWN, and only unknown.
- An earlier observation that the sandbox held **zero** availability records was **stale and
  incorrect** — read through an expired token that returned empty rather than erroring. Two records
  existed; one pre-dated this work.

### The friction that was accepted rather than removed

`rescheduleWorkOrder` and `reassignScheduledWorkOrder` require a caller-supplied reason
**server-side**. Two ways to make the gesture frictionless were considered and both were rejected by
the Owner: auto-generating the text (which would restate what the audit event already carries and
make every reason identical) and making the argument optional (which would change certified
semantics). The prompt therefore stays, and asks only WHY.

Accepted for P1v1. **If dispatch volume later shows reason collection is too expensive, that is a
governed policy decision about reschedule audit semantics — not a UX change.** Reasons must not be
auto-generated or removed in UX code.

Resize discoverability — an 8px hover-revealed grip — is accepted for P1v1 and should be watched in
real use.

### Still open, and not part of this acceptance

**DB-G1** — the artifact draws a queue "past due" note EOS cannot render, because there is no
due-date model for UNSCHEDULED work. Named gap, unchanged by this acceptance.

The acceptance fixture estate is deliberately **left as the interaction pass left it**, drift
included: `wo-sbx-008` at 495m is visually unusual and is the evidence that repeated governed
resizes persisted. Restoring canonical fixtures is separate sandbox maintenance.

---

## Family 6 — Service Operations

| | |
|---|---|
| **Composition** | `src/modules/controlTower/ControlTower.jsx` over `src/domain/serviceOperationsNorthStar.js` |
| **Visual authority** | `North Star - Service Operations P1.dc.html` (frames 1a–1d) + `DESIGN-HANDOFF-SERVICE-OPERATIONS-P1.md`, filed at `docs/north-star/service-operations/` |
| **Reconciliation** | [`service-operations-north-star-composition-map.md`](./service-operations-north-star-composition-map.md) — item-by-item, produced before any UI code changed |
| **Proof** | `test/serviceOperationsNorthStar.test.jsx` (33), `test/serviceOperationsComposition.test.jsx` (20), plus the reconciled `test/workOrderAttentionPanel.test.jsx` (9) and `test/serviceOperationsRisk.test.jsx` (11) |
| **Named decisions** | SO-N1…SO-N9 all ANSWERED by Owner ruling 2026-08-30 (behavioral truth wins in every case); SO-G4, SO-G5, SO-G6 carried; **SO-G7 opened by this migration** |
| **CI** | `.github/workflows/service-operations-north-star-tests.yml`, path-filtered. Both new suites were caught as CI-uncovered by `ciSuiteCoverage.test.mjs` before they could ship. |
| **Gate** | Local: 258/258 node suites, 2743/2743 vitest, `vite build` clean, oxlint clean. Not the acceptance gate. |
| **Acceptance** | `AWAITING_OWNER_VISUAL_ACCEPTANCE` |

### Why this family reads differently from families 1–5

The other five migrated a **record** whose grammar the artifact and the engine broadly agreed on.
This one migrated an **accumulation** — five sprints of appended blocks with no composition — and the
artifact and the engine disagreed in nine specific places, every one of which would have required the
page to state a fact the system does not hold.

That is the substance of this row. The layout change is the visible part; the nine rulings are the
part that keeps the page honest. Each is recorded in
[`north-star-open-product-decisions.md`](./north-star-open-product-decisions.md) so a later session
cannot reopen them as unresolved design questions, and each is pinned by a test so the page cannot
quietly reacquire what was removed.

### A gap this migration found rather than fixed

**SO-G7.** An unreadable `createdAt` scores 0 for both the age and stagnation risk factors, so the
work order drops below `detectStalledJobs`'s HIGH threshold and disappears from At risk entirely. The
work order the system knows least about is the one it shows least — the inverse of R23. Pre-existing,
not introduced here, and a domain authority change to fix. Pinned by a test rather than left as a
comment.

### Family 6 — Owner acceptance, 2026-08-30

Appended, not rewritten: the row above records what was shipped and proved; this records what the
Owner then did with it.

| | |
|---|---|
| **Acceptance** | **CLOSED 2026-08-30** — Owner visual acceptance given on the live sandbox composition |
| **Accepted deployed SHA** | `0a5aeca3` |
| **Sandbox identity** | `platform-sandbox` / `sandbox`, buildTime 2026-08-30T11:23:24.012Z |
| **Accepted URL** | https://eos-platform-sandbox.web.app/service-operations |
| **Final corrective gate** | **25/25 PASS** — RAW_ID PASS · 1440 PASS · 375 PASS · runtime/console errors PASS |
| **Corrective PRs after the first refresh** | #1592 (routing + activity subject), #1594 (table-scroller containment) |
| **Reusable gate** | `.claude/skills/run-field-ops-app-vite/serviceOperationsNorthStarGate.mjs` |

**What acceptance did NOT resolve.** SO-G5, SO-G6 and SO-G7 remain **OPEN** and separately scoped.
Nothing about them was solved by this acceptance, and the accepted page states the SO-G5 boundary on
its own face rather than hiding it.

### Two defects the engineering gate missed, and the Owner did not

Recorded because the pattern is more useful than the fixes.

**#1592 — a link verified by reading, not by following.** The header *Work orders* button and two
metrics pointed at `/service/work-orders`, which matches no route: the Work Orders list is the
Service domain index (`path: ""`). All three fell through to My Dashboard. Every test asserted the
links *existed*. The Owner clicked one. The gate now FOLLOWS the header link rather than reading its
`href`, because a plausible-looking route that resolves to nothing is exactly what an href assertion
cannot see.

**#1592 — an event with no subject.** `describeEvent()` returns a static per-type label, so the
activity rail rendered a column of "Job assigned" / "Job completed" with nothing to attach them to.
The panel it replaced printed `event.entity.id` there — a raw document key — and removing that was
right; removing it *without putting the real reference back* is what left the rail saying nothing.
Entries now lead with the work order number and carry the account.

**#1594 — a hidden label that scrolled the page sideways.** Found by the live corrective gate at
375, after two *other* failures in the same run turned out to be measurement artifacts — the kind of
run where the third finding is easiest to dismiss. `.ns-visually-hidden` is `position: absolute`
with no offsets, so inside a scrolling table it sat 122px past the viewport; with no positioned
ancestor it escaped `.ns-table-wrap`'s `overflow-x: auto` and extended `documentElement.scrollWidth`
to 497 against a 375 viewport. `body.scrollWidth` stayed exactly correct, which is why the
certification sweep reported the route clean — correctly, by its own measure — and why jsdom could
never have seen it. Fixed at the shared primitive, so it holds for every `ns-table`.

**The transferable lesson:** three defects on an accepted-looking page, none visible to a component
test, all visible in a real browser at a real width to someone actually using the surface. The gate
now measures `documentElement.scrollWidth` and follows its links, and says in its own comments why.
---

## Family 7 — Parts

| | |
|---|---|
| **Composition** | `src/modules/inventory/PartDetail.jsx` over `src/domain/partsNorthStar.js`; workspace `src/modules/inventory/PartsList.jsx` (quantity column withdrawn, search corrected — its multi-panel shell is unchanged) |
| **Visual authority** | `docs/north-star/parts/North Star - Parts P1.dc.html` (1a–1d) + `DESIGN-HANDOFF-PARTS-P1.md`, received 2026-08-30 |
| **Reconciliation** | [`parts-north-star-composition-map.md`](./parts-north-star-composition-map.md) — 15 drawn elements checked, **9 not buildable as drawn**, produced before any UI code changed |
| **Proof** | `test/partsNorthStarProjection.test.mjs` (11), `test/partsNorthStarIdentity.test.jsx` (4), `test/partsNorthStarRecord.test.jsx` (21), `test/partsNorthStarWorkspace.test.mjs` (10) |
| **Mutation proofs** | **28 run, 27 caught**, source restored byte-identical after each. The one missed is recorded in [#1593](https://github.com/TaylorService-spec/Taylor_Parts/pull/1593)'s body rather than dropped: reverting the Manufacturer row's JSX alone is no longer observable, because the projection now supplies the same key to both objects. The two mutations that remove it *at the projection* are both caught. |
| **Named decisions** | ND-25, ND-26, ND-27 raised and **CLOSED by the Owner the same day**; ND-28 raised and open |
| **Implementation** | Four PRs: [#1590](https://github.com/TaylorService-spec/Taylor_Parts/pull/1590) reconciliation · [#1593](https://github.com/TaylorService-spec/Taylor_Parts/pull/1593) projection + defects · [#1596](https://github.com/TaylorService-spec/Taylor_Parts/pull/1596) record · this PR, workspace + closeout |
| **Gate** | **29/29 PASS** against the deployed `0f1ac714` (P1v2 closing run). The P1 run's 25/25 is superseded — the composition it gated was rejected on sight. |
| **Acceptance** | **CLOSED 2026-08-31 — Owner visual acceptance given on the deployed `0f1ac714`**, after the P1v2 recomposition (see the closing section at the end of this ledger) |

### The design's central number did not exist

Frames 1a and 1b are built on **On hand**, sourced — the handoff says so explicitly — from
`warehouseQty`, whose own file header reads *"METADATA ONLY — NO STOCK AUTHORITY … NOT
authoritative."* The Owner had ruled on that exact cell six days earlier and removed the number as
FALSE_COMFORT. A migration that reproduced the mockup would have shipped the defect back as the
centrepiece of the North Star, while carrying a handoff whose first non-negotiable rule is *"never
manufacture inventory mathematics."*

The Owner closed it as **ND-25, Option (b): TRUTHFUL ABSENCE > FALSE COMFORT.** The record states no
quantity; the workspace column is withdrawn; three sections say why they are empty.

### Capability inactive is not authority required

Three of the four data sections in frame 1b read through capabilities registered `active: false` and
granted to no role — balances, serialized units, location display. The handoff labelled their absence
**AUTHORITY REQUIRED**. `getPartBalance` already returns `available` and `onOrder` from fulfillment's
ratified functions; it is switched off, not missing. Two different states, two different sentences,
two different owners — and §16 of the directive is why the distinction is load-bearing.

### Six defects, all of one family, all pre-existing

Every one was a value that never arrived, or a stored token that reached a reader:

1. `PartDetail`'s **Manufacturer row could never render** — gated on `canonicalPart?.manufacturerId`,
   which the projection never carried, under a key no document uses (`primaryManufacturerId`).
2. `PartIdentifiersSection` was passed an always-`undefined` `partNumber`, so its fallback labelled
   the section with the document id.
3. `PartsList` **headed a column "Part Number" and rendered the document id into it**, under a comment
   asserting it was not one.
4. **Activity's Type column printed the raw enum** — `CONSUMED`, `TRANSFER_OUT`.
5. **The Risk cell printed `urgency` raw**, while `PartsList` showed the word for the same value one
   page away.
6. **The parts search matched the document id and not the Part Number** — created by ND-26 and fixed
   in the same pass, because a person reading `C712-COMP` off a row and finding nothing is the one
   search a warehouse actually performs.

`test/partsMasterDataEntryPoints.test.jsx` had been **green about #1 the whole time**: it mocked a
canonical row that already carried `manufacturerId`, so it proved the name-resolution helper and not
the row's reachability. A test can be green about a value the running system never produces.

### GATE 2b² worked

`PartDetail.jsx` left `CONFORMANT_WORKSPACES` when it stopped hosting `WorkspaceShell` and had to be
declared in `NORTH_STAR_RECORD_PAGES` in the same commit. The gate written after families 1 and 2
shipped into exactly that hole caught it on the first run.

### Two existing assertions re-anchored, one superseded — none deleted

- `partDetailView`'s ordering check pinned the literal `Unknown part "{partId}"` when its subject is
  the **order**; re-anchored on the branch so improving the sentence stops looking like a regression.
- `partsMasterDataEntryPoints` pinned button labels the design renames. Renamed, not rewired.
- `inventoryHealthScaleSemantics`'s availability assertion is now in its **third** superseding form,
  with the chain recorded in place, so a reader can see why the column left instead of guessing.

### Authority, unchanged

No new Firestore read, Function, index, Rules change, capability grant or activation, readiness
constant, state-machine change or write path. The projection widening happens **inside the read the
page already performs**. `partLookup.js`'s *lookup never moves inventory* invariant and every scanner
invariant travel through untouched.

### Family 7 — ND-28 closed, and the gate waiting on a deploy (2026-08-30)

Appended, not rewritten: the row above records what was shipped and proved; this records the ruling
that closed the family's last open question and the state of its gate.

| | |
|---|---|
| **ND-28** | **CLOSED 2026-08-30 — keep the Stock forecast card and `RequestReorderControl`.** The shipped interpretation was correct. |
| **The separation** | *Information* may compose clearly identified derived facts; *command* remains governed by its existing EOS authority. **The informational number does not become the authority for the command merely because they share a card.** |
| **ND-28-F** | **OPEN follow-up.** When `getPartBalance` is activated, reconcile the forecast composition against the governed balance — replace, supplement, or remain distinct — as an explicit authority change with its own tests. Semantics must not change silently when the capability flips. |
| **PartsList scope** | Owner-agreed: the pre-North-Star multi-panel shell stays. Its four-panel role-home composition and governed reorder queues are a Lists P2 / role-workspace recomposition. **Parts P1 does not absorb it.** |
| **Gate ruling** | **Quick Gate, not Full Regression** — Owner, 2026-08-30. Basis: presentation-layer changes, projection corrections, family-local defect corrections; no callable authority, capability activation, Rules, index, or transactional/state-machine change. |
| **Gate** | `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/partsNorthStarQuickGate.mjs`. Superseded by the closeout below: it grew to 20 checks after three gate defects, and PASSED 20/20 against `79df93c1`. |
| **Acceptance** | `AWAITING_OWNER_VISUAL_ACCEPTANCE` — unchanged, and blocked on the refresh below. |

### The refresh this family is waiting on

The Owner authorized the sandbox refresh against `main @ 67da42a9` on 2026-08-30. **It has not been
performed, and this build could not perform it:** `firebase deploy` and the `sandbox-refresh.ps1`
launcher are both blocked by the session permission layer, which an Owner authorization does not
lift. That constraint is pre-existing and was measured on 2026-08-27; it is a property of the
session, not of the authorization.

What was verified read-only instead, which is the honest half of the work:

| | |
|---|---|
| **Live sandbox now** | `0a5aeca3`, buildTime 2026-08-30T11:23:24.012Z, `platform-sandbox`/`sandbox` — the family-6 accepted release |
| **Parts P1 is therefore NOT live** | Confirmed from `/version.json`, not inferred from a merge |
| **Release preconditions** | Working tree clean; `HEAD == origin/main == 67da42a9`, so `_releaseProvenanceGuard.mjs` would pass |
| **Gate identity guard** | Run against the live origin with `--expect 67da42a9`: correctly **REFUSED**, exit 2, `deployed=0a5aeca3 expected=67da42a9` |

That last line is the point of the guard. Every other check in the gate would otherwise have measured
the wrong bundle and reported a green family, which is the failure mode
the standing rule exists to prevent: **the
environment is the authority on what is deployed, never an exit code from a deploy command.**

The operator command, to be run from the repository root:

```
powershell -ExecutionPolicy Bypass -File .\sandbox-refresh.ps1 -HostingOnly
```

`-HostingOnly` is correct here and is not a shortcut: the Parts P1 diff touches no `functions/` file,
so redeploying the Functions estate would be authority this release does not need — and a large
Functions batch exiting non-zero after some functions have already updated is this repository's own
documented failure mode. Every guard, build verification, artifact stamp and identity gate still runs;
only the scope changes.

### Family 7 — the Quick Gate passed (2026-08-30)

Appended, not rewritten: the rows above record what was built and what it was waiting on. This
records the gate actually running, and supersedes the earlier line that said *"Not yet run."*

| | |
|---|---|
| **Deployed SHA** | `79df93c1` — sandbox `platform-sandbox`/`sandbox`, buildTime 2026-08-30T12:55:09.833Z |
| **Gate** | `partsNorthStarQuickGate.mjs --expect 79df93c1` — **20/20 PASS**, desktop 1440 and handheld 375, runtime clean |
| **Verified independently** | Owner ran it; this build re-ran it and read `/version.json` first-hand rather than recording a result it had not seen |
| **Rulings** | ND-25, ND-26, ND-27, ND-28, ND-29 — **all CLOSED** |
| **Gate ruling applied** | Quick Gate, not Full Regression (Owner, 2026-08-30) |
| **Acceptance** | `AWAITING_OWNER_VISUAL_ACCEPTANCE` — the one authority a build cannot grant itself |

### FRAME 1a WAS NOT BUILT, and offering `/inventory` for acceptance was wrong

The Owner opened the sandbox at `/inventory` and said it looks nothing like the design view. It does
not, and it was never going to: the **PartsList scope ruling of 2026-08-30** deliberately left the
pre-North-Star multi-panel role home alone, and this build is the one that asked for that scope. So
the workspace still renders Work / Parts / Flow groups with the reorder queues above a catalogue
table — the agreed outcome, and nothing like frame 1a.

**The error is not the scope. It is that the closeout listed `/inventory` as an Owner acceptance
surface.** Frames 1a–1d were the acceptance criteria, and offering a surface that was deliberately
not migrated to 1a — without saying so in the same breath — invited exactly the comparison that
failed. A deferral that is not visible at the moment of acceptance is not a deferral, it is a
surprise.

**Acceptance surfaces, corrected — the RECORD family only:**

| Frame | Surface | State |
|---|---|---|
| 1b desktop record | `/inventory/CW-P-0001` | **migrated**, ready for acceptance |
| 1c handheld record | the same at 375 | **migrated**, ready for acceptance |
| 1d honest states | reachable on the record | **migrated**, ready for acceptance |
| **1a workspace** | `/inventory` | **NOT MIGRATED — do not accept against 1a** |

Neither existing surface is frame 1a. `/inventory` is the role home. `/inventory/part-master`
("Catalog Admin") is a flat admin table carrying Part Number / Name / Category / Control Type /
Stocking Class / Unit / Status — closer to 1a's COLUMNS, but it is not a North Star page: no serif
header block with counts, no view chips, no toolbar, no Attention column. **No surface in the
product looks like frame 1a**, and what to do about that is the Owner's call, recorded as ND-30
rather than assumed by this build.

### Two results in that run that are weaker than they look, named rather than counted

- **Check 4 and check 7 cannot decide the ND-26 field contract on this data.** The certification
  fixture makes `partId` and `internalPartNumber` the *same string* (`CW-P-0000`), so "the cell shows
  the Part Number, not the document id" is unfalsifiable live. The gate says so in its own output.
  The contract is proved in `partsNorthStarProjection` and `partsNorthStarIdentity`, whose fixtures
  make the two differ, and both are mutation-proved.
- **Check 11 saw a `STANDARD` part.** The serialized and lot treatments were not exercised live; they
  are covered by `partsNorthStarRecord.test.jsx`. Owner ruled this not required for P1 acceptance.

### Checked during closeout, and NOT a defect

The handheld full-page capture shows the fixed `fo-tabbar` sitting mid-content. That is an artefact of
`fullPage` screenshots with `position: fixed`, not an overlap. Measured at the true page bottom at
375×812: the last rail section ends at **y=646**, the bar begins at **y=739** — 93px clearance,
`occluded: false`. Recorded because the screenshot looks like a defect and the next reader deserves
the measurement rather than a second investigation.

### Follow-ups that survive acceptance

| | |
|---|---|
| **ND-28-F** | OPEN — when `getPartBalance` is activated, reconcile the Stock forecast against the governed balance (replace / supplement / remain distinct) as an explicit authority change with its own tests. Semantics must not change silently. |
| **P-G1** | OPEN — every Parts surface reads the whole `parts` collection; a cold record deep-link is slow. Its own performance concern, not absorbed into Parts P1. |
| **Serialized / lot live exercise** | Not required for P1. Focused Parts family tests remain the proof. |

---

## Family 8 — Equipment

| | |
|---|---|
| **Composition** | Record `src/modules/equipment/EquipmentDetail.jsx` over `src/domain/equipmentNorthStar.js`; workspace `src/modules/equipment/EquipmentWorkspace.jsx` (three tabs, unchanged) with `CustomerEquipment.jsx`, `AvailableEquipment.jsx`, `EquipmentTimeline.jsx`, `InstallAtCustomer.jsx` |
| **Visual authority** | `docs/north-star/equipment/North Star - Equipment P1v2.dc.html` (1a–1e) + `DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md`, received 2026-08-30. Revision label **EQUIPMENT NORTH STAR P1v2.1 — DESIGN LOCKED** |
| **Reconciliation** | [`equipment-north-star-composition-map.md`](./equipment-north-star-composition-map.md) — 22 drawn elements checked, **16 already built and correct**, 4 needing composition work, **2 not buildable as drawn**; produced before any UI code changed |
| **Proof** | `test/equipmentNorthStarProjection.test.mjs` (27), `test/equipmentNorthStarRecord.test.jsx` (21), `test/equipmentNorthStarWorkspace.test.jsx` (17) and 3 new assertions in the shared `test/metadataListPresentation.test.mjs`, plus the re-anchored `equipmentTimeline`, `equipmentListMigration`, `availableEquipmentInstall`, `availableEquipmentLocationDisplay`, `listsP2Tranche1`, `rawIdPresentationGuard`, `activeLabelConformance`, `coreRecordPages` and `accountRecordPage` suites |
| **Named decisions** | **ND-31** (unresolved location: four reasons, not one string) and **ND-32** (identity cell: columns, not a concatenated summary) — both raised and open. Both are cases where the repository is ahead of the artifact |
| **Gate** | `equipmentNorthStarQuickGate.mjs` — **RAN 2026-08-31 against the deployed `9848ec9d`: 35 passed, 0 failed, 3 skipped, exit 0.** See the gate-result section below |
| **Acceptance** | **CLOSED 2026-08-31 — Owner visual acceptance given on the deployed `f33dd113`** (see the closing section below) |

### The family was already most of the way there, and the stale claim was the repository's

Sixteen of the twenty-two drawn elements needed no change at all — the three populations, the
countless workspace header, the server-side Customer/Status filters over three live composites, the
five honest Available-Equipment states, the governed line composition, the independent
Customer/Location failure states with Retry, the honest inventory-control UNKNOWN, and the
present-but-disabled lifecycle actions. **Warranty Expires was already on the record page**, which
the design's own EQ-D2 had closed on the same evidence.

What was stale was in the code, not the artifact. `AvailableEquipment.jsx`'s header asserted twice
that `inventory.serializedAsset.read` and `inventory.location.display.read` were *"granted to no
Role … fails closed to the DENIED state in every environment."* Both are granted to eight governed
Roles and both are in the sandbox `capabilityActivationOverrides`. The design corrected exactly this
in P1v2 (EQ-G1/EQ-G2); the handoff's warning about stale comments landed on the repository. Nothing
about the read, the gating or the fail-closed default changed — only the sentences describing them.

### Three defects, every one a stored token or a wrong value reaching a reader

1. **The activity timeline printed raw enums.** `e.type` and `e.status` went to the screen unmapped,
   so a row read `Service · WO-873 · REPAIR · IN_PROGRESS` while every other Work Order surface in
   EOS already sourced those words from `WORK_ORDER_TYPE_LABEL` / `WORK_ORDER_STATUS_LABEL`. Same
   shape as Parts defects #4 and #5.
2. **A calendar date was rendered one day early.** `formatDateOnly("2024-03-14")` returned
   *"Mar 13, 2024"* for every reader west of Greenwich: a bare `YYYY-MM-DD` parses as UTC midnight,
   and formatting that instant locally lands on the previous day. Found by this family's own *render
   the recorded date only* check on **Warranty Expires**, and fixed in the shared formatter for the
   date-only shape alone — Timestamps, epoch numbers and full ISO strings keep their exact coercion.
   It reached `equipment.installedDate` and `purchaseOrder.expectedArrivalDate` too.

Also removed: `EquipmentDetail.jsx`'s private `STATUS_LABEL` copy (one of the two
`domain/equipmentStatus.js` was created to replace, which had survived because nothing forced the
question), and a dead `Row()` helper with no caller.

### A third defect, found by the Owner on the live sandbox — and it was never Equipment-only

The Owner sent a screenshot of the deployed Equipment record showing, in its Record section:

```
Created   Timestamp(seconds=1786163702, nanoseconds=367000000)
Updated   Timestamp(seconds=1786163702, nanoseconds=367000000)
```

**Why the type declaration was right and the render was still wrong.** `equipment.js` types
`createdAt`/`updatedAt` as **NUMBER**, with its reasoning recorded in place: `firestore.rules`
asserts `data.createdAt is number`, so the governed write path stores epoch milliseconds, and
declaring TIMESTAMP would claim storage semantics the collection does not have. The sandbox document
holds a Firestore Timestamp anyway — written by a path that did not go through those Rules. No
branch of `cellValue` claimed the shape, the generic fallback returned it, and `MetadataRecordPage`
handed it to `String()`.

**The fix is a refusal, not a guess.** Not a re-typed field on the strength of one non-conforming
document, and not "any object carrying `seconds` is a date". A value whose shape contradicts its
declared type is **not displayable**, and `ABSENCE.UNREADABLE` — *"Recorded in an unreadable
format"* — says so. Deliberately **not** an em dash: that would claim there is no value, and the
whole point is that there is one.

**It is a shared-layer change, and that is the news.** `cellValue` is what every metadata list AND
every record page reads through, so this reached **six record pages**, not one. `MetadataRecordPage`
already special-cased ADDRESS for exactly this reason (`String({street: …})` renders
`[object Object]`) — the defect had been caught for one type and left open as a class.

**Proof:** `test/metadataListPresentation.test.mjs` (3 new) asserts the refusal in the shared layer,
that it is not a blanket refusal (a conforming number, and **zero**, still render), and that the
sentence does not carry the shape it refused. `test/equipmentNorthStarRecord.test.jsx` (2 new) fixes
the record on the **shape the live sandbox actually holds** and asserts the exact string from the
screenshot never renders. Three mutation proofs: removing the shared guard fails the shared suite;
removing both guards reproduces `Timestamp(seconds=…)` on the page. Removing the record-page guard
**alone** is not observable — the shared guard returns first — and that is recorded rather than
dressed up: it is defence-in-depth on the line that actually performed the stringification.

**The layout half of the same screenshot needed nothing.** The collapsed middle column and the
five-line wrap of "Ice Machine C713 — Unit 1" are `fo-detail-grid`, the three-panel row this
migration replaced with `ns-record-body` (main column + rail). That screenshot is `main`, not this
branch.


### Three burn-down lists shrank, and one gate caught the migration

`EquipmentDetail.jsx` moved from `CONFORMANT_WORKSPACES` to `NORTH_STAR_RECORD_PAGES` when it stopped
hosting the workspace shell — **GATE 2b² caught the omission on the first run**, exactly as it did for
family 7. Deleting the private status map removed the file from `activeLabelConformance`'s allowlist;
naming three previously-unrun suites in the new workflow removed them from `ciSuiteCoverage`'s
`KNOWN_UNNAMED`; and retiring the timeline's `<ol>` removed `fo-tag` and `fo-timeline` from
`cssClassCoverage`'s unstyled backlog. Every one of those lists may only shrink, and each shrank
because the gate refused to let it stay stale.

### The family's Quick Gate, written after the merge and proved fail-closed before it can run

`equipmentNorthStarQuickGate.mjs` joins the dispatch, parts and serviceOperations gates —
one per accepted family. It drives the DEPLOYED workspace and record as an admin and asserts the
locked design's rulings against the running pages. It is read-only: it looks, switches tabs and
follows links; it opens the install confirmation far enough to read it back and **never presses
Confirm**, because installation is irreversible and no recovery authority exists.

**Two checks read Firestore, and that is deliberate.** H2 (a calendar date must not shift a day) and
H3 (a stored object must not be stringified) are claims about the relationship between what is
STORED and what is SHOWN — reading only the screen cannot falsify either, because "Mar 13" looks
correct unless you know the document says `2024-03-14`. Both fetch the record through the Firestore
REST API with the SAME governed idToken the browser session holds: same principal, same Rules, no
elevated credential. H2 compares against the stored value rather than a hard-coded fixture date, and
SKIPs when the chosen record has no date-only value — inventing one would be fabricated evidence.

**Three refusals, all exercised against the live origin before the release existed:**

| Invocation | Result |
|---|---|
| `--expect 97b630e5` against the deployed `52ed729d` | `FAIL 0 release identity` · REFUSE · exit 2 |
| no `--expect` at all | REFUSE · exit 2 — stricter than the Parts gate, which allows omitting it |
| a production origin | REFUSE · exit 2, before any network read of that origin |

That is a successful test of fail-closed behaviour, not a failed Equipment gate.

**The Parts gate's four recorded defects were designed out rather than inherited.**
`test/equipmentNorthStarQuickGateContract.test.mjs` (12) holds each one as a rule CI can enforce,
since CI cannot run the gate itself: no pinned column name where the ruling protects the VALUE
(ND-32 addresses cells by the index of their own deployed heading); ND-31 accepts any governed
reference-state sentence rather than one literal string, because collapsing four reasons into one
IS the regression; every surface resolved once and scoped; exact class tokens, never a substring
that also matches BEM children; no silent `catch {}`; and a SKIP counted separately from a PASS so a
run of skips cannot read as a green family.


### The gate's first live run found four defects, all of them the gate's

Run one against the correctly deployed `2b090a7e` returned **28 PASS / 2 FAIL / 2 SKIP**. The Owner
ruled both failures Quick-Gate defects and refused to send the Equipment implementation back. That
ruling was right, and chasing them turned up two more the run had not surfaced:

| # | What the gate reported | What was actually true |
|---|---|---|
| 1 | `FAIL 1 … h1s=["Equipment","Equipment","Equipment"]` | `page.locator("h1")` counts every MOUNTED h1. All three tab panels stay mounted so each keeps its state, and `EquipmentRegister` hosts a shell whose title is also "Equipment". "One h1 in the DOM" was never the invariant. |
| 1b | The first fix, `h1:visible`, still failed | The app shell renders a screen-reader heading with `fo-visually-hidden` — `display: block`, clipped to **1×1** — so Playwright counts it visible. It occupies no page and competes with nothing. Now decided by **measured geometry**, not by class name: `1x1` and `0x0` are not page titles. |
| 5 | `FAIL 5 … filterFields=["Default order","Name – A to Z","Status – grouped A to Z", …]` | Those are `SortControl`'s options. Finding the "+ Add Filter" *button* established nothing about which `<select>` came first in the panel. |
| 5b | The first fix, `getByLabel(/^Field$/)`, reported `offered=[]` | The select sits inside an implicit `<label>Field<select>…</select>`, so its accessible name is the label's whole text — `"FieldChoose a field…CustomerStatus"`. Now reached from inside the resolved builder. |

**A race the run did not surface, found because two runs of one bundle disagreed.** `openWorkspace`
waits for the tab rail, which arrives long before the list. One run measured a 50-row register; the
next reported `no ns-table … data-list-state=LOADING` on the identical release. The list is now
settled on its own declared `data-list-state`, and the two batched reference resolvers are settled
after it — the first green run had measured `firstRow=[…,"Loading…","Loading…",…]` and check 9a
"passed" on cells still in flight. `"Loading…"` is no longer an acceptable settled answer.

**And a defect in the contract suite itself, which is the one worth remembering.** Its comment
stripper was `source.replace(/\/\*[\s\S]*?\*\//g, " ")`. The gate contains an XPath —
`xpath=//*[${EXACT_CLASS("ns-workspace__count")}]` — and `//*` reads as a block-comment opener, so
the stripper deleted **6314 characters** through to the next `*/`: the Add-filter block, the settle
waits, and part of the install-confirmation flow. Every `doesNotMatch` over that span passed because
the span was gone. **Mutation-proved after the fix:** making the gate press *Confirm installation*
now fails the read-only test; before the fix it did not. That is the silent-vacuous-pass failure
these tests exist to prevent, occurring inside them.

**Live re-run: 29 passed, 0 failed, 3 skipped, exit 0.** The count moved from 30/0/2 to 29/0/3 and
that is an improvement: settling the resolvers turned check 9a from a PASS that had measured
`"Loading…"` into an honest SKIP — on this data every installed Location resolves to a real name,
so there is nothing unresolved to measure. Three unmeasured checks, all named.


### Two findings from the Owner's own eyes on the deployed page (2026-08-30)

Both were on the family, both after the Quick Gate reported 29/0/3, and neither was something the
gate was looking for. Recorded plainly: a green gate measured what it was told to measure.

**1. The page was composed as a card, not a page — FIXED.** The workspace rendered
`<div className="fo-panel">` with a self-closing `<WorkspaceIdentity />` and the tab rail and panels
as its SIBLINGS. `.ns-workspace` is what carries the collection container — `max-width: 1360px;
margin: 0 auto; padding: 0 32px 80px` — so only the title block was inside it: the title sat inset
and centred while the rail and every row ran hard against the left edge with no measure. And
`.fo-panel` is the retired card treatment (elevated surface, radius, drop shadow), which no other
North Star collection renders inside. `WorkspaceIdentity` takes `children` for exactly this and every
shipped collection page uses it that way; the two tab bodies dropped their own nested `.fo-panel`
cards with it. Held by three structural assertions in
`test/equipmentNorthStarWorkspace.test.jsx` — the rail and all three panels must be DESCENDANTS of
`.ns-workspace`, no `.fo-panel` may wrap the collection, and there must be exactly one container so
the inset is not applied twice. Mutation-proved: restoring the card wrapper fails the suite.

**2. Stock cannot be created from anywhere in the application — RECORDED, not built.** See
**ND-33**, including its **2026-08-31 correction**: the first missing piece is SERVER-side, not
client-side. `inventory.serializedAsset.acquire` is registered, granted and sandbox-ACTIVATED, and
the pure command and its production seams are built — but there is **no `onCall` endpoint and no
`index.ts` export**, so nothing is deployed for a client to call. This build first reported the
callable as "wired"; the file is named `acquireCallableWiring.ts` and contains resolvers, not a
callable. The correction is recorded rather than quietly fixed. The Owner ruled its placement the same
day: **Inventory → Receiving**, not Equipment. Approved placement, client composition not yet built.

**What this says about the gate.** It asserted the rulings it was given and passed honestly. It was
not asked whether the page sits on the site's own grid, and it inspected only the DEFAULT tab —
so the second `Equipment` title that appeared when Add Equipment was selected was invisible to it.
A gate proves the claims it encodes; it does not notice a claim nobody made. **Both are now
encoded** — see the closeout below.


### Add Equipment closeout — the tab stopped claiming to be a page (2026-08-30)

The last composition defect on the family, and the honest description of it is an ARCHITECTURAL one
rather than a visual one: two files both believed they owned the Equipment page.

`EquipmentRegister` was a standalone route when Wave 3 declared it in `CONFORMANT_WORKSPACES`, and
site-work #10 mounted it as the Add Equipment tab of `EquipmentWorkspace` without removing its
`WorkspaceShell title="Equipment"`. Selecting the tab therefore put a second visible **Equipment**
page title inside an Equipment page that already had one — the Owner saw it on the deployed sandbox.

**Removed, not hidden.** A CSS-hidden `h1` would have satisfied any gate and left the architecture
lying about ownership. The shell is gone; the `ActionRail` that carried the customer picker and
`+ New Equipment` was its `actions` region and is now the tab's own control row. `.fo-equipment-register`
takes over the flex column and 16px gap `.fo-workspace` had been supplying — removing a page identity
is not a reason to lose the spacing it happened to carry.

**The classification was reconciled rather than excepted.** The file moved out of
`CONFORMANT_WORKSPACES` (which demands `WorkspaceShell`) into `CONFORMANT_SURFACES`, alongside
`InventoryControlSection` and the other non-shell-hosting conformant surfaces. It keeps the
`fo-badge` rule and drops the obligation it can no longer honestly meet. **No exception was added
and GATE 2 was not weakened** — the list membership now states something true.

| | |
|---|---|
| `EquipmentWorkspace` | owns the page identity |
| `EquipmentRegister` | nested tab content |

**Nothing about what Add Equipment does changed.** Account picker, account-scoped query boundary,
location scoping, search, Location and Status filters, result count, `+ New Equipment`,
`EquipmentCreateModal`, the `createEquipment` write path, post-create focus handoff, the polite live
region, and every loading/empty/error branch are untouched. ND-33 was not implemented here and Add
Equipment was not reused for acquisition.

**Proof.** Six new assertions in `test/equipmentNorthStarWorkspace.test.jsx`: each of the three tabs
selected in turn must show exactly one visible Equipment identity and that one must be the
workspace's, not a panel's; the Add panel must host no `.fo-workspace` and no `h1`; its controls and
account-scoped prompt must survive; and a heading inside a hidden panel must not count.
**Mutation-proved** — restoring the nested shell fails two of them.

**The gate was widened to match.** Identity is now measured after selecting ALL THREE tabs (3a/3b/3c)
from one shared `measureIdentity` helper, and every panel is checked for a nested page shell rather
than only the one that had it. The default-tab-only version is exactly why this defect reached a
deployed page with a green 29/0/3 behind it.

`fo-equipment-register` also left `cssClassCoverage`'s unstyled backlog: it had no rule because
`.fo-workspace` was doing its layout, and it has one now. Another list that may only shrink, shrinking.


### Family 8 — the Quick Gate ran against the deployed release (2026-08-31)

| | |
|---|---|
| **Deployed** | `9848ec9d`, buildTime 2026-08-31T00:27:12.821Z, `platform-sandbox`/`sandbox` |
| **Expected** | `9848ec9d` — and it is `origin/main`'s tip, so the release is the whole family, not a slice of it |
| **Identity** | PASS, check zero. Read from `/version.json`, never inferred from a deploy command's exit code |
| **Result** | **35 passed · 0 failed · 3 skipped** (of 38), exit 0 |
| **Command** | `node equipmentNorthStarQuickGate.mjs --expect 9848ec9d` |

**The Add-tab fix is visible in the measurement, not just in the diff.** `mountedH1s=2`, where every
earlier run reported `3`. The nested `WorkspaceShell`'s heading is gone from the DOM rather than
hidden from view — which is what "removed structurally" has to mean, and what a CSS-hidden `h1`
would have faked. All three tabs report `nestedWorkspaceShells=0 panelH1s=[]`.

**What the live run positively proved, beyond the rulings:**

- **H3 on genuinely malformed data.** The record's document really does store `createdAt`/`updatedAt`
  as `timestampValue` where the field declares NUMBER, and the renderer refuses honestly. The fix is
  proved against the actual defect, not a fixture.
- **The install confirmation** read back `Taylor C161 · CW-C161-0001 · Ahwatukee Creamery ·
  Ahwatukee Creamery - Gilbert #1`, with Confirm and Cancel both present. **Confirm was never
  pressed and no sandbox data was mutated.**
- **Available Equipment** reached READY: 30 of 30, Taylor 17 · Ventana/Icetro 13, and an unresolvable
  location renders `Location unavailable` with no key anywhere in the rows.

**Three skips, all honest, none forced green:**

| Check | Why unmeasured |
|---|---|
| 9a ND-31 unresolved Location | every installed Location on this data resolves to a real name — there is nothing unresolved to measure |
| 24 Activity human labels | the selected record has no activity rows to inspect |
| 25 H2 date-only shift | the selected record stores no `YYYY-MM-DD` to compare, and inventing one would be fabricated evidence |

The first is the one worth remembering: it was a PASS until the resolver settle-wait landed, at which
point it turned out to have been measuring `"Loading…"`. A skip that says so is worth more than a
pass that does not.

**Acceptance surfaces for the Owner:**

- workspace — <https://eos-platform-sandbox.web.app/equipment>
- record — <https://eos-platform-sandbox.web.app/equipment/eq-c713-1> ("Ice Machine C713 — Unit 1",
  reached by clicking a real row, not by constructing a URL)
- Available Equipment and the install confirmation are tab state, not routes: `/equipment` →
  **Available Equipment** → **Install at customer** on any row.

**Acceptance remains `AWAITING_OWNER_VISUAL_ACCEPTANCE`.** A green gate is the behavioral half; the
third authority has not spoken.



### Family 8 — CLOSED, Owner accepted 2026-08-31

| | |
|---|---|
| **Accepted release** | `f33dd113` — `origin/main`'s tip and the deployed sandbox build, verified from `/version.json` rather than inferred |
| **Surfaces accepted** | Workspace · Customer Equipment · Available Equipment · Add Equipment · Equipment record · Install confirmation · Secondary filter rail — all PASS |
| **Closing gate** | `equipmentNorthStarQuickGate.mjs --expect f33dd113` → **35 passed, 0 failed, 3 skipped** (38 checks), exit 0 |
| **Acceptance** | **CLOSED / OWNER ACCEPTED** |

The third authority has spoken. Behavioral completeness and a green gate were never the same claim
as acceptance, and this row is where the difference stopped mattering for this family.

**The three skips are unmeasured, not green, and they stay that way.** No unresolved Location exists
on this data; the record the gate reaches has no activity rows; and it stores no `YYYY-MM-DD` to
compare. Each is a precondition the sandbox does not currently offer, and forcing any of them green —
or seeding data to eliminate them — would have been fabricated evidence.

**What the family shipped, beyond the composition.** Three reader defects were corrected on the way
through, every one a stored token or a wrong value reaching a person: the activity timeline printing
raw Work Order enums; `formatDateOnly` shifting a calendar date one day west of Greenwich; and a
stored object stringified as `Timestamp(seconds=…)` on six record pages. The last is still visible in
the gate's own evidence — check 26 confirms the sandbox document really does store
`createdAt`/`updatedAt` as `timestampValue` where the field declares NUMBER, and the renderer refuses
it honestly. The fix is proved against the actual defect, not a fixture.

**Two named decisions remain open and are not blockers**: **ND-31** (an unresolved location states
which of four reasons, not one string) and **ND-32** (the identity cell is columns, not a
concatenated summary). Both are cases where the repository is ahead of the locked artifact, and both
are recorded rather than silently resolved.

**ND-33 is a separate stream** and does not gate this family: non-PO serialized-asset acquisition
lives under Inventory → Receiving, is merged, and awaits its own Functions deploy.

### Authority, unchanged

No Firestore rule, index, Function, callable, capability, activation, role grant, collection, schema,
backfill or deployment-config change. Every rendered value is an existing read; install still resolves
through `callInstallSerializedAsset` → `equipment.install`; edit still resolves through
`updateEquipment`, with its allowlist still **imported** from the write path rather than restated. No
lifecycle action was enabled, and `EQ-G5` — the installed-unit operating company — is preserved as a
seam that answers UNKNOWN with the reason, never a value derived from the Customer.

### Family 7 — the Owner's acceptance boundary (2026-08-30)

Appended, not rewritten. This records the **scope and the known states** the Owner fixed before
looking, so that what was accepted — and what was deliberately not — cannot be re-argued later from
memory. **It is not an acceptance.** The Owner stated the boundary; the acceptance itself is a
separate act and this row does not anticipate it.

| | |
|---|---|
| **Deployed release** | `2b090a7e` — `platform-sandbox` / `sandbox` |
| **Quick Gate** | **25/25 PASS** against that live release |
| **Accepted scope** | Frame 1a at `/inventory`; Frames 1b–1d at `/inventory/CW-P-0001` |
| **Acceptance** | `AWAITING_COMPLETE_OWNER_VISUAL_ACCEPTANCE` |

### Known truthful fixture states — acknowledged, NOT defects

Pinned because each looks like a finding and is not. A later reader, or a later gate, must not
"discover" them:

| Observation | Why it is truthful |
|---|---|
| Manufacturer reads **"Not recorded"** on every row | The certification fixture writes no `primaryManufacturerId` (`functions/scripts/certificationWorld/build.mjs`). The column is built, resolves the governed id to its name where one exists, and states the absence otherwise. |
| **62 total · 52 active · 10 status not recorded** | The ten approved `STATIC_ONLY_EXCLUDED` skus have no canonical document and therefore no status. Counted as neither active nor inactive — which is why `active` is deliberately not `total − inactive`. |

### Follow-ups the Owner placed OUTSIDE Parts P1

None of these is a Parts P1 debt, and none blocks acceptance:

| | |
|---|---|
| **ND-28-F** | Reconcile the Stock forecast against `getPartBalance` when that capability is activated — replace, supplement, or remain distinct — as an explicit authority change with its own tests. |
| **P-G1** | Whole-collection read; cold record deep-link. Its own performance concern. |
| **Serialized / lot live exercise** | Additional live coverage. The treatments are proved in `test/partsNorthStarRecord.test.jsx`. |
| **Shared workspace document outline** | Two `<h1>`s per page — `AppShell`'s hidden domain landmark plus `PageHeader`'s visible title — across all 14 conformant workspaces. A shared-shell accessibility concern, **not Parts-specific**, and the reason a correct page once looked like a cross-family regression. |

## Family 9 — Receiving

**OPENED 2026-08-30. Design source received; no UI code changed yet.** This row records the
starting state so the family begins from a written baseline rather than memory.

| | |
|---|---|
| **Composition** | Workspace `src/modules/inventory/Receiving.jsx` with `src/modules/receiving/MultiScanReceiving.jsx`, `ReceiveAgainstPurchaseOrder.jsx`, `AcquireExistingUnit.jsx` over `domain/receivingScanQueue.js`, `receiveAgainstPurchaseOrder.js`, `receivingLocationOptionAdapter.js`, `serializedAssetAcquireForm.js` |
| **Visual authority** | `docs/north-star/receiving/North Star - Receiving P1.dc.html` (frames 1a–1f) + `DESIGN-HANDOFF-RECEIVING-P1.md`, received 2026-08-30 (`Claude Design Docs/Receiving North Star P1v1.zip`). Binding brief committed beside them: `RECEIVING-NORTH-STAR-DESIGN-START.md` |
| **Baseline** | `7d221497` — PR #1639 already composed the Add existing unit dialog (two-stage Review → Confirm, truthful location states); frame 1c re-hosts that work, it does not redo it. ND-33 (non-PO acquisition) is **CLOSED** (#1640) and is settled authority this family composes, not a question it may reopen |
| **Reconciliation** | Handoff composition map verified against the repository 2026-08-30: every COMPOSE row's module exists. One handoff claim corrected on the way in — see RCV-G2 below |
| **Proof** | Existing suites anchor the behavior being re-composed: `receivingScanQueue`, `receiveAgainstPurchaseOrder(+Component)`, `receivingLocationOptionAdapter`, `multiScanReceiving`, `acquireExistingUnitComposition`, `serializedAssetAcquire`. Family-specific North Star suites not yet written |
| **Named decisions** | **RCV-G1** (no governed read of `receiving_orders` — deny-all is deliberate; Recent receipts renders an honest unavailable slot until a read-service ruling), **RCV-G2**, **RCV-D1** (one Awaiting-receipt queue with a Journey column, replacing the chip toggle — Owner may prefer two entries; only frame 1a would change) |
| **Gate** | Not yet built |
| **Acceptance** | `DESIGN_RECEIVED — implementation not started` |

### RCV-G2 — the handoff's stale claim was corrected before it could become a defect

The handoff zip's README said the `RO-YYYY-######` numbering lane was "not built, absent on all
documents." The lane **is** built: `functions/src/inventoryReceiving/receivingOrderNumbering.ts`
(merged 2026-08-18, #1259) allocates the number transaction-safely inside
`receiveInventoryStockCommand`. What survives as the gap is narrower and is what Design actually
needs: no governed read exposes the number to any client (RCV-G1 blocks the only surface that
would), documents created before #1259 carry no number, and the deployed Functions release may
predate the allocator. Renderers show an honest placeholder wherever the number is absent — never
the document id. The committed `DESIGN-HANDOFF-RECEIVING-P1.md` records the corrected form; the
zip's README keeps the stale sentence and is superseded.

---

### Family 7 — P1v2 CLOSED, Owner accepted 2026-08-31

| | |
|---|---|
| **Accepted release** | `0f1ac714` — verified from `/version.json` and proved to contain itself and to be an ancestor of `origin/main` with `git merge-base --is-ancestor`, never inferred from a matching string |
| **Surfaces accepted** | `/inventory` and `/inventory/CW-P-0001`, at 1440 and 375 |
| **Closing gate** | `partsNorthStarQuickGate.mjs --expect 0f1ac714` → **29/29 PASS**, exit 0 |
| **Acceptance** | **CLOSED / OWNER ACCEPTED** |

Family 7's first P1 pass was gated 25/25 and *rejected on sight* — the information was right and the
composition was not. P1v2 is what came of separating those two claims, and this row is where the
third authority finally spoke for Parts.

**The design handoff claimed no drawn element needed new business authority. Two did.** Frame 1b drew
`Adjusted · Opening adjustment · D. Reyes · +6` under a band headed *the work-order and receiving
ledger*; `LedgerTransaction` carries `id · workOrderId · partId · type · quantity · timestamp` and
nothing else. The actor and the note exist on `inventory_actions` — the collection the entity register
says is "never joined or reconciled by any code in this repository", whose write side was retired in
#1625 for being a parallel assertion about stock. Sourcing them there would have rebuilt the join that
retirement removed. Design had already drawn the buildable row in its own MOBILE frame, so that
grammar is used at both widths. **Used on** was drawn populated over `equipment.compatibility.view`,
registered `active:false` and granted to nobody; it states that it is built, governed and switched
off. Both were caught by reconciling the artifact against the repository *before* any code — the
practice that found nine of fifteen unbuildable elements in P1.

**ND-30 was amended rather than overridden.** Its boundary — "do not relocate the Work group / the
Flow group" — read literally forbade the 320px rail the composition asks for. Raised as a conflict
instead of resolved by preference; the Owner amended it to the narrow reading: the boundary protects
**route ownership and functional presence**, not visual placement within `/inventory`. Both groups
keep every hook, panel, queue and command, on the same route, and the gate now asserts that as
containment and width rather than as a vertical order the composition no longer has.

**Two of the three implementation seams the handoff named did not exist.** `WorkspaceShell` already
exposed a `supporting` aside and a split body; `.ns-tabrail` was already the shared underlined tab
control, and is *not* the collection-views markup, so wearing it does not give this route the
collection identity ND-30 withholds. Only the breadcrumb needed a new slot, and it is opt-in, so the
fourteen conformant workspaces render exactly as before.

**The height budgets are reconciled, not waived.** Design's figures were targets drawn against a
mockup; the accepted ceilings are set from the deployed composition, and both are reported on every
run so the distance stays visible. The variance was accounted for before any ceiling moved: the
workspace is dominated by the truthful 25-row collection (1,538px of table beside a 340px rail), and
the record's is the Part information band the Owner ordered populated plus the shared 80px North Star
record padding held out of this family's scope. The real result is the reduction against the
pre-P1v2 page — **−44%, −62%, −18%, −25%**.

| Surface | Before | Deployed | Accepted | Design target |
|---|---|---|---|---|
| workspace 1440 | 3,406px | **1,901px** | ≤ 1,950 | 1,700 |
| workspace 375 | 9,277px | **3,543px** | ≤ 3,600 | 2,400 |
| record 1440 | 1,508px | **1,242px** | ≤ 1,250 | 1,050 |
| record 375 | 2,615px | **1,957px** | ≤ 2,000 | 1,500 |

**Four reader defects were corrected on the way through**, each one a stored token or a wrong value
reaching a person: three reorder cards rendering `request.urgency` raw while the helper that words it
was already imported two lines up; the Manufacturer column reading `Not recorded` on 25 of 25 rows;
the ND-25 catalogue explanation rendered permanently *and* behind its own disclosure, the same
governed text twice on one page; and **Part information shipping with an empty left column** — it
read `partRecordRailSubset`, which withholds every fact the header already states, and on a real part
the header stated all of them. The Owner ruled that repetition intentional: identity is for
recognition, the band is the structured master-data summary.

**The gate itself carried the worst defect of the family, and it was mine.** Three record checks were
re-anchored off renamed headings onto stable ids in #1642 — and never landed. They were applied by a
script whose guard checked only that *something* in the file had changed; a single-line label rename
matched while three multi-line replacements silently no-opped on CRLF, and the guard passed on the
label alone. A full deployed run then reported four failures against a correct page: the probe found
no forecast on any candidate, fell back to a part with no ledger activity, and took two more checks
vacuous with it, so the record heights it printed were for the wrong part. **A gate that measures the
wrong structure reports the wrong thing confidently, which is worse than not running it.** The anchors
are now asserted in CI, where a silent no-op cannot hide, and every gate edit since has been verified
present — and every stale form verified absent — before commit.

### Authority, unchanged

No Firestore rule, index, Function, callable, capability, activation, role grant, collection, schema,
backfill or deployment-config change. `PART_IDENTIFIER_UNAVAILABLE_REASON` was not mutated to save
pixels — the record simply stopped printing all of it as permanent copy, and its deployed-versus-
granted distinction is one tap away. `inventory_actions` stays read-only and unjoined. Quantitative
inventory facts still reach a surface only through `getPartBalance`, which remains inactive.

**Open and not blockers:** ND-28-F; P-G1; the `firestore.rules` orphaned `allow create` on
`inventory_actions` (Tier-2, tracked separately); the shared 80px North Star record padding, which
belongs to a family-wide decision rather than to Parts.

### Family 9 — frames 1a and 1b merged (2026-08-31)

Appended per the ledger's rule; the opening row above is not rewritten. **Merged is not accepted,
and neither frame is live until a Hosting refresh** — no Functions, Rules, capability, Role,
schema, command or numbering change in either.

| | |
|---|---|
| **Frame 1a** | #1650, squash-merged `543303ae` — workspace shell + ONE Awaiting-receipt queue (RCV-D1) over the two existing candidate reads; truthful LOADING/READY/EMPTY/DENIED/UNAVAILABLE/FAILED/PARTIAL ladder; ND-33 path set apart; RCV-G1 slot held honestly |
| **Frame 1a correction** | The drawn scan-first order entry was NOT built. **RCV-G7** recorded: no governed scan-identifier/barcode contract exists for purchase orders, and canonical POs carry no business number (RCV-G5) — a "scan a purchase order" field would claim identifier authority that does not exist. Queue-row navigation is the entry path; pinned by regression tests in both suites |
| **Frame 1b** | #1654, squash-merged `69bf5981` — supplier multi-scan session recomposed: journey identity is the governed supplier name (the opaque order id never renders), "No order number recorded" stated, receipt result states the missing RO number instead of `receivingId`, ruled sections replace the panel farm, labelled-cell handheld recomposition, no duplicate back affordance from the workspace, legacy standalone picker reworded as internal-id entry with no scan-label claim |
| **New named gaps** | **RCV-G5** (canonical `purchase_orders` carry no business order number anywhere; doc ids are opaque and never promoted), **RCV-G6** (the list read carries no per-row receipt progress; none fabricated), **RCV-G7** (no PO scan-identifier contract) — all recorded in `DESIGN-HANDOFF-RECEIVING-P1.md` |
| **A test moved with the truth** | `multiScanReceiving.test.jsx` asserted `heading { name: "PO-1" }` — the document id AS the journey title. Corrected to assert the supplier-name identity and the id's absence, with the correction recorded in the test (the RCV-G4 discipline: a test that requires a false claim is that claim restated) |
| **Remaining** | 1d reorder journey · 1c Add existing unit side sheet · 1e states · 1f handheld · Hosting refresh · Quick Gate vs the deployed SHA · Owner visual acceptance |
| **Acceptance** | unchanged — `AWAITING` (nothing in this entry is an acceptance) |

### Family 9 — frames 1d and 1c merged (2026-08-31)

Appended per the ledger's rule. **Merged is not accepted, and none of frames 1a–1d/1c is live
until a Hosting refresh.** No Functions, Rules, capability, Role, schema, command, provenance,
reason-enum or numbering change in either.

| | |
|---|---|
| **Frame 1d** | #1656, squash-merged `10e06190` — reorder PO linear journey recomposed: one subordinate identity (external PO number → supplier → truthful generic), the `?? reorderRequestId` raw-id fallback removed from the candidate list and the review read-back (absence STATED, pattern source-pinned unrepresentable), step line labelling the existing RECEIVE_STEP stages, full-quantity contract explicit, RO-number absence stated on terminal results, bordered card root retired |
| **Frame 1c** | #1657, squash-merged `6e27d5a0` — Add existing unit re-hosted in the shared Modal primitive as a right-docked side sheet (additive `variant="sheet"`; same trap/Escape/backdrop/restore contract). Post-success truth corrected: the sheet stops looking armed — consequence lede replaced by the recorded post-state, stale stage heading removed. Close discards only local draft before Confirm and is inert mid-write. ND-33 authority untouched; no replay-proof claim made |
| **Guards that caught real things** | css-class coverage refused an unstyled journey class (1d); the acquire suite's portal re-point carries a non-null guard so zero-length assertions cannot pass vacuously (1c) |
| **Remaining** | 1e truth states · 1f handheld sweep · Hosting refresh · Quick Gate vs the deployed SHA · Owner visual acceptance |
| **Acceptance** | unchanged — `AWAITING` |

### Family 9 — frame 1e merged: the family truth sweep found two real defects (2026-08-31)

Appended per the ledger's rule. **Merged is not accepted; nothing in frames 1a–1e is live until a
Hosting refresh.** No authority change.

| | |
|---|---|
| **Frame 1e** | #1659, squash-merged `3adcc15d` — family-level truth/state sweep across 1a/1b/1d/1c |
| **Defect 1** | 1b's destination picker discarded the location read's STATUS — a denied/unavailable/failed read rendered as an innocently empty select. Now five mutually exclusive states with their own sentences, picker rendered only from READY, and the protected submit repeats the state instead of advising "choose one" when none can be chosen. Pattern source-pinned unrepresentable |
| **Defect 2** | 1b's option label fell back to the raw `locationId` — a storage key as a place name. Dropped (the governed adapter guarantees READY labels); pattern source-pinned |
| **Alignment** | queue rows state each journey's OWN reference absence: supplier "No order number recorded" (RCV-G5 — no authority), reorder "No PO number recorded" (a governed field, absent on the record — frame 1d's words) |
| **Stale claims corrected** | "legacy reorder-PO workflow is untouched" (recomposed in 1d) · "when the dialog opens" (a sheet since 1c) · a submit reason advising the impossible under a failed read. Historical defect narrations deliberately kept |
| **Family pins added** | no synthesized RR/PO/RO numbers · no PO scan-identity wording outside a gap-recording comment (RCV-G4 quoting discipline) · no raw err.message/stack rendering · no new firebase/callable/readiness surface |
| **Remaining** | 1f handheld sweep · Hosting refresh · Quick Gate vs the deployed SHA · Owner visual acceptance |
| **Acceptance** | unchanged — `AWAITING` |

### Family 9 — frame 1f merged: REPO-COMPLETE, and the gate now exists (2026-08-31)

All six frames are merged (1a `543303ae` · 1b `69bf5981` · 1d `10e06190` · 1c `6e27d5a0` ·
1e `3adcc15d` · 1f `33b72707`). **Repo-complete is not deployed, not gated, not accepted.**

| | |
|---|---|
| **Frame 1f** | #1661 — family handheld sweep, measured in a real browser over rendered family states (1440/768/375/320): ZERO horizontal overflow on every representative state; one genuine touch-floor failure (inline link-buttons at ~15px) fixed, scoped to the Receiving workspace; the 13px reason radios recorded as label-row targets and the structure pinned; CI holds the stylesheet contracts the measurement relied on |
| **Quick Gate** | `receivingNorthStarQuickGate.mjs` now exists (this entry's commit) — sandbox-only, read-only, data-adaptive with honest SKIPs; asserts the deployed commit, the queue's mutually exclusive truth states, stated reference absences, RCV-G1/G7 held, ND-33 sheet composition with a measured no-command-left-the-page close, deny-all discipline, and a live 375px overflow measurement |
| **Next** | Hosting refresh (platform-sandbox build via `buildForEnvironment.mjs`, deploy `--only hosting`) → verify `/version.json` → run the gate against that exact SHA → Owner visual acceptance |
| **Acceptance** | unchanged — `AWAITING` |

### Family 9 — deployed, and the first Quick Gate run failed its own gate, not the product (2026-08-31)

**Hosting refresh ran (Owner-executed): deployed commit `0abc2353`, `platform-sandbox`, verified
from the environment (`/version.json`). Functions and Rules NOT deployed — none were needed.**

**First Quick Gate run vs `0abc2353`: 18 PASS · 2 FAIL · 0 SKIP. Both failures were GATE defects;
no product defect surfaced; the deployed artifact was not changed.** Recorded as run, not
rewritten as green:

| | |
|---|---|
| **False negative (crumb)** | the gate searched `document.body.innerText` for `Inventory → Receiving` while `.ns-page__context` was rendering the crumb correctly. Corrected: the gate now reads the actual crumb element and requires exactly one, with the full directional relationship |
| **False positive (order reference)** | an id-shape heuristic (`/^[A-Za-z0-9_-]{18,28}$/`) rejected `PO-LIVE-1788220473108` — a legitimate governed `externalPoNumber` value. The parts gate's own lesson, relearned: a gate must not reverse-engineer field provenance from string shape. Corrected: the live gate asserts journey-conditional truth (supplier rows MUST state the RCV-G5 absence; reorder rows carry a reference or state theirs), and WHICH field supplied a visible reference is pinned by the source contract (`orderReference ← externalPoNumber` only; ids only inside `open`) |
| **Gate-contract pins** | the corrected assertions are themselves source-pinned (crumb element + strict equality; no shape heuristic; journey-conditional check), with new domain proofs: a long machine-shaped external PO number is ACCEPTED; rewiring either builder's reference to a document id fails |
| **Second run, corrected gate, same artifact** | **20 PASS · 0 FAIL · 0 SKIP** vs deployed `0abc2353` — identity, truth grammar (3 reorder rows live), held gaps, ND-33 sheet with measured no-command close, deny-all discipline, live 375px overflow 0 |
| **Acceptance** | unchanged — `AWAITING_OWNER_VISUAL_ACCEPTANCE`. A green gate is not acceptance |

### Family 9 — CLOSED, Owner accepted 2026-08-31

**The Owner gave visual acceptance on the deployed `0abc2353` (`platform-sandbox`).** Family 9 —
Receiving — is closed: six frames merged, Hosting refreshed, the Quick Gate green against the
exact deployed SHA (20 PASS · 0 FAIL · 0 SKIP, second run after the gate corrected its own two
defects), and the acceptance itself given by the Owner, not inferred from a gate.

| | |
|---|---|
| **Deployed release** | `0abc2353` — `platform-sandbox` / `sandbox`, verified from `/version.json` |
| **Quick Gate** | `receivingNorthStarQuickGate.mjs` — **20/20** vs that live release |
| **Functions / Rules** | NOT deployed — the whole family was presentation/composition; no authority changed at any point |
| **Acceptance** | **CLOSED — Owner visual acceptance given 2026-08-31** |

### What stays open, deliberately, and is NOT Family 9 debt

The named gaps are recorded seams awaiting their own rulings, each rendered honestly by the
shipped surfaces in the meantime:

| | |
|---|---|
| **RCV-G1** | governed receipt-history read (`receiving_orders` deny-all is deliberate; the slot renders "Not connected yet") |
| **RCV-G2** | receiving-order number readable client-side (allocated server-side since #1259; absence stated, never `receivingId`) |
| **RCV-G5** | canonical supplier PO business number (none exists; absence stated) |
| **RCV-G6** | per-row receipt progress on the list read (progress renders per opened order) |
| **RCV-G7** | purchase-order scan-identifier contract (no scan-entry field until ruled and built) |
| **RR numbering** | declared, allocator built, UNWIRED (RCV-G4 record governs the metadata truth) |
