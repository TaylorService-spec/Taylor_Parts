---
artifact_type: implementation-plan
gate: Implementation Plan
status: Complete
date: 2026-08-26
owner: Claude Code
related_adrs: []
depends_on: [DECISIONS-134, ND-14, ND-15, ND-16]
implements: [sales-agreement-north-star-p1v2]
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Implementation Plan: Sales Agreement North Star (family 5)

**Design authority (this plan's specification):**
[`docs/north-star/sales-agreement/README.md`](../north-star/sales-agreement/README.md) and
`North Star - Sales Agreement P1v2.dc.html`, merged as PR #1533 and registered in
[`eos-north-star-sources.md`](../design/eos-north-star-sources.md).

There is no separate Sprint Specification. The design handoff *is* the specification: it carries the
composition, the decisions SA-D1–SA-D12, the responsive rules, the acceptance-evidence rule, an
AUTHORITY VERIFICATION source map, and an implementation mapping. This document adds only what that
one cannot: the order in which the code lands, and the boundaries the Owner drew around it.

**Owner ruling (DECISIONS #134):** the Sales Agreement becomes a **first-class routed record page**.
That settles direction only. This pass **composes existing governed authority** — it adds no
callable, no capability, no state transition and no read.

---

## The three constraints that bound every PR below

**1. No new backend authority.** Every read and every action this family needs already exists:
`getSalesAgreementContext` (by-id read, exported and client-wired), `getSalesAgreementForOpportunity`,
`updateSalesAgreementDraft`, `acceptSalesAgreement`, and the four capabilities in
`salesAgreementCapabilityAccess.js`. A PR here that adds a callable, a capability, a Firestore index
or a Rules change has left this plan's scope and needs its own authorization.

**2. Build to the shipped record grammar, not to the artifact's widths (ND-16).** The artifact
composes 224 nav / 300 rail / 40 gap; `index.css` ships `--rail-width: 252px` and
`.ns-record-body { grid-template-columns: minmax(0,1fr) 340px; gap: 0 56px }`, shared by all four
existing families. Owner ruling: **use the shipped 252 / 340 / 56.** Everything else in the
artifact — hierarchy, ranking, copy, states, responsive behaviour — is implementation authority as
written. `.ns-record-body` is not this family's file to change.

**3. The acceptance-evidence rule is not negotiable.** EOS proves three things: state `ACCEPTED`,
`acceptedAtMillis`, `acceptedByUid`. No rendered string may imply a customer signature, electronic
acceptance, external acceptance, or legal enforceability. The permitted and forbidden vocabularies
are listed in the design README and must be asserted by test, not left to review.

---

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | Sales Agreement North Star derivation + contract suite | One derivation owns the composition's truth, testable under `node --test` before any JSX exists | — | Merged #1536 |
| 2 | The by-id read seam | A routed record page needs a by-id read; the callable exists, the hook does not use it | — | Merged #1537 |
| 3 | The record page and its route | `ns-page` + `RecordIdentity`, no `WorkspaceShell`; the route the Owner authorized | 1, 2 | Merged #1538 |
| 4 | Governed actions: accept, edit draft, and the state × permission split | Two commands, four capabilities, and the distinction P1v1 was built to protect | 3 | Merged #1539 |
| 5 | Lineage in both directions | The Opportunity card and the Sales Order back-link learn the new address | 3 | Merged #1540 |
| 6 | Mutation proofs, user guide, ledger row | The family's proof that its tests can fail, and its closeout record | 1–5 | This PR |

### PR 1 — Derivation + contract suite

`src/domain/salesAgreementNorthStar.js`, matching `workOrderNorthStar.js` / `salesOrderNorthStar.js`
/ `accountNorthStar.js` / `opportunityNorthStar.js`. It composes over the **existing**
`salesAgreementView.js` rather than re-projecting: that file already carries every projected field
and already owns `salesAgreementLabel`, `agreementIsEditable` and `agreementAcceptability`.

What the derivation owns, from the design decisions:

- the ranked identity group (SA-D1) and the state word from the entity definition's `enumLabels` —
  never a third private copy of the three strings;
- **SA-D3's incompleteness rule**: a draft with any `unitPriceMinor === null` claims no subtotal, no
  total and no balance. The suite must prove a partial sum can never be produced;
- **SA-D8's two ladder blocks**, and the rule that a zero or null optional charge row is omitted
  rather than rendered as `$0.00`;
- **SA-D5's line identity**: `ref` is the identity; a catalogue name is decoration that may be
  absent. No display name is persisted (SA-G4);
- the acceptance evidence triple, with `resolveActorDisplayName`'s `Unknown user` for an unresolved
  actor — never a raw uid (F-UID-1);
- the six view states, kept distinct.

`test/salesAgreementNorthStar.test.mjs`, **registered in `test/suites.json` and in
`.github/workflows/composition-conformance-tests.yml`'s path filters in the same PR.** DECISIONS
#124 exists because five suites — including family 1's own contract suite — were registered nowhere
and had never run. `ciSuiteCoverage.test.mjs` now fails the build for an unregistered node:test
suite; do not rely on that alone, because a path filter that never triggers is a second way to be
uncovered (memory: a new subsystem needs its own workflow lane or it is CI-invisible).

### PR 2 — The by-id read seam

`useSalesAgreement` currently reads by `opportunityId` only. A routed record page arrives holding a
`salesAgreementId`. `getSalesAgreementContext` already accepts one and is already wired in
`salesAgreementCommandClient.js`.

Add the by-id path to the existing hook rather than writing a second one, and keep everything the
hook already gets right: per-intent idempotency keys, every mutation re-reads, the request-sequence
guard, the unmounted-tree guard, and the `enabled: false` → `NOT_ENABLED` short circuit that exists
so an undeployed callable does not log a CORS error on every selection.

**Watch for:** the hook's comment block says `salesAgreement.read` is granted in no environment.
That is stale — `environmentCapabilityOverrides.ts` activates all four for `eos-platform-sandbox`.
Correcting that comment belongs in this PR, where the file is already open for a real reason.

### PR 3 — The record page and its route

`src/modules/sales/SalesAgreementDetail.jsx`.

- Composes `ns-page` + `RecordIdentity`, and **must not** host `WorkspaceShell` (DECISIONS #126).
  Add the file to `NORTH_STAR_RECORD_PAGES` in `compositionConformance.test.jsx` in this PR —
  membership is derived, so a North Star page that declares itself nowhere fails the gate.
- **No `LifecycleBand` and no chevrons** (SA-D2). This is the first family to compose the grammar
  *without* them, and that is the point: DRAFT → ACCEPTED | DECLINED is a gate, not a journey. The
  page test should assert their absence, so a later "consistency" pass cannot add them back quietly.
- Route: `customers/opportunities/sales-agreement/:salesAgreementId`, following the Sales Order
  precedent (`opportunities/sales-order/:salesOrderId`, DECISIONS #129) and its documented ordering
  constraint — the static-prefix route is declared **before** `opportunities/:opportunityId`, or
  React Router reads the address as an Opportunity id.
- `test/salesAgreementNorthStarPage.test.jsx`, registered alongside PR 1's suite.

**A judgment this PR should not make silently.** Nesting the URL under `opportunities/` follows the
shipped precedent for a genuinely first-class object, and a URL shape is not ownership. If the Owner
reads "first-class routed record page" as requiring a top-level address, say so before PR 3 — it is
a one-line change now and a redirect later.

### PR 4 — Governed actions and the state × permission split

Wire `acceptSalesAgreement` and `updateSalesAgreementDraft` through the page, resolving all four
capabilities in the one request `SALES_AGREEMENT_CAPABILITY_REQUEST` already defines — a screen that
asked twice could render an accept button authorized under a version the edit was denied under.

SA-D11, asserted by test rather than reviewed by eye:

- DRAFT, all priced → **Record acceptance** primary, **Edit draft** secondary.
- DRAFT, unpriced → Record acceptance disabled carrying `agreementAcceptability`'s **own reason**,
  which names every unpriced line. The screen states the rule; the server remains the control.
- ACCEPTED → the edit affordance is **absent, not disabled** — the engine forbids it, and a disabled
  control invites someone to go looking for a permission problem.
- DECLINED → no actions; the record stays readable.
- Permission is the **different** sentence, from `SALES_AGREEMENT_DISABLED_REASON`, rendered
  protected + disabled. State and permission never collapse into one message.

### PR 5 — Lineage in both directions

`OpportunityAgreementCard` gains a link to the new address. The Sales Order surface gains its
back-link to the agreement, which is the practical half of **ND-9** ("a Sales Agreement has no
resolvable reference") — the reference now resolves to a page. ND-9 itself stays open; this PR does
not close it, it removes its worst consequence.

Both are other families' files. Keep the diff to the link and its test.

### PR 6 — Mutation proofs, user guide, ledger row

- **Mutation proofs**, the family pattern from family 2: mutate the derivation and the composition,
  prove each mutation is caught, restore byte-identical. At minimum — a partial total surviving an
  unpriced line; `$0.00` standing in for an absent charge; a raw uid reaching the DOM; the document
  id used as the title; a chevron band appearing; state and permission sentences collapsed; an edit
  control appearing on a terminal record.
- **User guide** under `docs/user-guide/sales/` — nothing is done here without one.
- **Migration ledger family 5 row**, including `Acceptance: AWAITING_OWNER_VISUAL_ACCEPTANCE`. The
  ledger row belongs to this pass, not to the design PR: its own header says one row per family
  *appended as each is migrated*, and until PR 3 lands there is no migration to record.

---

## Sequencing notes

PR 1 before everything because the derivation is what the page and its tests both consume, and it is
node-testable without a DOM — the cheapest place to get the money rules and the incompleteness rule
wrong and find out.

PR 2 before PR 3 because the page cannot mount without a by-id read; PR 2 is independently
mergeable and independently useful.

PR 4 after PR 3 rather than inside it, so the read surface can be seen and accepted before any
command is wired to it. A page that renders a governed agreement correctly is worth merging on its
own; the actions are a distinct review.

PR 5 after PR 3 because a link needs an address to point at.

PR 6 last, and it is not ceremony: the mutation proofs are what make the preceding five PRs' green
suites mean something, and DECISIONS #124 is the standing reminder that a green suite which cannot
fail is not proof.

---

## Explicitly out of scope

Named because each is a live temptation, and because the Owner drew these lines rather than the
implementation discovering them.

| Gap | What must not happen |
|---|---|
| **SA-G2** external presentation / acceptance evidence | No signature, send-to-customer, presented/viewed, or document-generation behaviour. Not designed, not built. |
| **SA-G3** agreement list / index read | No workspace, no list, no index read. That page family gets its own North Star treatment later. |
| **SA-G4** line display-name resolution | The catalogue name stays a marked design recommendation. **Do not persist a duplicate display name on the line** to make the mock come true. |
| **SA-G5 / ND-14** decline | **Do not create a decline command.** Do not show Decline as an available action. The state study documents that `DECLINED` is modelled and currently unreachable, and stops there. |
| **SA-G6 / ND-15** post-acceptance revision | **Do not invent** revise, supersede, duplicate, reopen, replace-agreement, or create-a-second-Agreement. The engine refuses both editing and re-creation; that dead end is a domain question and must not be solved in the presentation layer. |
| **ND-16** shared record grammar | `.ns-record-body` and `--rail-width` are not this family's to change. Build to 252 / 340 / 56. |

Also out of scope: the Opportunity P1v2 artifact's own dimensional defect, deferred by the Owner
pending ND-16.

---

## External dependencies

- **PR #1534** (visual-authority register, DECISIONS #134, ND-14/15/16) should merge first. This
  plan references those entries by number.
- **Sandbox capability activation is already in place** — all four `salesAgreement.*` capabilities
  are activated for `eos-platform-sandbox` in `environmentCapabilityOverrides.ts`. No grant is
  needed. Production stays triple-blocked and this pass does not touch that.
- **No deploy is in this plan.** Sandbox deploy and the Owner's visual acceptance are separate,
  Owner-gated steps after PR 6.

---

## What "done" is, and what it is not

Merged is not done. Green CI is not done. Per `eos-north-star-sources.md`, this family is
North Star-complete when the real sandbox implementation has passed engineering regression **and**
has been visually compared against `North Star - Sales Agreement P1v2.dc.html` by Design and by the
Owner. Until then the ledger row reads `AWAITING_OWNER_VISUAL_ACCEPTANCE`, and that is a state, not
a caveat.

The design README's acceptance checklist is the comparison list.

---

## Tracking

Update the PR breakdown's Status column as each merges. This document is the running source of truth
for what is left in this family until PR 6 closes it.

---

## Closeout (PR 6, 2026-08-27)

All six PRs merged. The family's ledger row is in
[`north-star-migration-ledger.md`](../design/north-star-migration-ledger.md) with
`Acceptance: AWAITING_OWNER_VISUAL_ACCEPTANCE` — merged, tested and green is not acceptance, and
only the Owner moves that column.

### Implemented

- a first-class routed record page at `/customers/opportunities/sales-agreement/:salesAgreementId`
- one derivation owning every displayed fact, node-testable without a DOM
- the by-id read seam over the **existing** `getSalesAgreementContext`
- honest read states, with NOT_FOUND kept distinct from NONE_YET
- the two existing governed commands, with authoritative post-command re-read and a synchronous
  double-submit guard
- upstream and downstream lineage, navigable in both directions without becoming resolvable
- the acceptance-evidence boundary, held by test rather than by review
- responsive composition on the shipped grammar, measured at 1440 / 768 / 375

### Not implemented, and not claimed

| | |
|---|---|
| **SA-G2** external presentation / acceptance evidence | nonblocking product gap |
| **SA-G3** agreement list / index read | nonblocking product gap |
| **SA-G4** human-readable line display-name resolution | design recommendation; `ref` fallback stands, nothing persisted |
| **SA-G5 / ND-14** `DECLINED` has no producing command | nonblocking product gap |
| **SA-G6 / ND-15** no post-acceptance revision path | nonblocking, important domain gap |
| **SA-G7** line pricing not on the record page | migration gap — the workspace panel still owns the line editor |
| **ND-16** shared record grammar widths | open; built to the shipped 252 / 340 / 56 |

Also untouched, deliberately: the Opportunity P1v2 dimensional artifact (blocked on ND-16), and the
`ApprovalRequests.jsx` unguarded-setState defect found while reading a flaky CI lane during PR 4.

### What happens next

merge → sandbox refresh/deploy → Quick Gate → Owner visual acceptance → ledger acceptance update.
Nothing in these six PRs deployed anything, and none of them may mark visual acceptance.
