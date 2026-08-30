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
| **Gate** | **NONE YET.** Not deployed, not swept. See below. |
| **Acceptance** | `AWAITING_SANDBOX_REFRESH_THEN_OWNER_VISUAL_ACCEPTANCE` |

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
