# Opportunity — North Star design sources

**These files are VISUAL ACCEPTANCE AUTHORITY.**

They are **not** runtime authority, data authority, workflow authority, or permission authority.
Nothing here grants a capability, defines a state machine, or decides who may do what. When one of
these artifacts implies a behaviour the engine does not have, the repository is right and the gap is
recorded as a named product decision — never closed in the UI.

## Why these are in the repository

`docs/design/eos-north-star-sources.md` opens with the reason this file exists:

> A design direction that lives only in a conversation is one cleared cache away from being lost.

That was written about the *direction*. It applies just as squarely to the *artifacts*, and until
2026-08-26 they were in exactly the position it warns about: recovered once from a `.zip` in a
Downloads folder, listed in a register, and present in no repository. A `find` for `*.dc.html`
across this tree returned nothing.

Three page families were built without ever seeing their design source because of it. Family 4 was
built that way once too, and rebuilding it against the real artifact changed the composition
materially — see the family 4 row in
[`../../design/north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md).

## What is here

The family has **two surfaces and therefore two authorities**, which is the thing to get right
before reading anything below: the collection and the record are separate North Star pages with
separate artifacts, and neither one governs the other.

| File | What it is |
| --- | --- |
| `Opportunity-North-Star-List-P1v4.dc.html` | **Current visual authority for the COLLECTION**, `/customers/opportunities`. 1a desktop 1440 · 1b tablet 768 · 1c phone 375 · 1d the five designed states · 1e reuse/customization/gaps map. |
| `DESIGN-HANDOFF-LIST-P1v4.md` | Design's own handoff README for the collection, verbatim: columns, the state view, the responsive folds, gaps G1–G5, the do-not-invent list and the acceptance checklist. |
| `Opportunity-North-Star-P1v2.dc.html` | **Current visual authority for the RECORD**, `/customers/opportunities/:opportunityId`. 1a desktop 1440 · 1b phone 375 · 1c representative states. |
| `DESIGN-HANDOFF-P1v2.md` | Design's handoff README for the record, verbatim: authority map, composition walk-through, action architecture, the implementation-reality matrix, decisions O1–O6, the do-not-invent list and the acceptance checklist. |
| `Opportunity-North-Star-P1v1.dc.html` | Superseded by P1v2. Kept for provenance, not for implementation. |

**P1v2 supersedes P1v1** by adding the Sales Agreement relationship — a main-column section, a
header fact, a mobile row, the agreement states, and decision O6. All P1v1 decisions are preserved.

**P1v4 supersedes Workspace P1 for the collection**, and it supersedes **P1v3 without P1v3 ever
having been built.** P1v3 was a revision of the master-detail *workspace*; P1v4 abandons that shape
entirely, because the record it previewed in a pane has had its own certified route since P1v2 and
the pane was rendering a second, lesser copy of a page that already exists. Nothing from the P1v3
branch was merged. Two derivations were lifted from it — the `NEEDS_ATTENTION` and `AT_DECISION`
pipeline views, which are pure domain slices P1v4 also names — and the branch was then abandoned.
No P1v3 presentation reached `main`.

P1v4 provenance: `Claude Design Docs/Opportunity North Star P1v4.zip`, folder
`design_handoff_opportunity_workspace`, received 2026-08-26. The retained
`North Star - Opportunity Workspace P1.dc.html` in that package is the superseded workspace artifact
and is deliberately **not** copied here — the workspace is retired, and keeping its artifact beside
the live one invites somebody to build from it.

Provenance: `Claude Design Docs/Opportunity North Star P1v2.zip`, folder
`design_handoff_opportunity`, received 2026-08-26. The files are byte-identical to that package;
only the filenames are normalised (spaces removed, version made explicit) so they sort and link
cleanly.

## How to use them

Open the `.dc.html` in a browser and compare it against the running sandbox — **not** against
memory, and not against the grammar alone. The grammar
([`../../design/eos-north-star-design-grammar.md`](../../design/eos-north-star-design-grammar.md))
is how Design and the repository speak to each other; it is not a substitute for the artifact, and
composing from it when an artifact exists is how family 4 got built wrong the first time.

## What is implemented, and what deviates

### The collection (P1v4)

`field-ops-app-vite/src/modules/sales/OpportunityList.jsx` over
`src/domain/opportunityListView.js`, with the view engine in `src/domain/opportunityLifecycle.js`
and the shared collection header in `src/shared/ui/WorkspaceIdentity.jsx`.

**G2 resolved further than the design expected, and this is the one place to read carefully.**
P1v4 names G2 as "the agreement reference is not on the opportunity list read", and instructs the
column to render `No agreement` / `—` truthfully until list-level resolution exists. Verified
against the repository rather than assumed: `projectOpportunity` is shared by the list read and the
per-id read, and it **does** return `salesAgreementId` and `salesOrderId`. So **existence is
knowable at list level for free** — the design's premise was one generation out of date.

What it does **not** return is either *reference* (`salesAgreementNumber`, `salesOrderNumber`) or
either *state*. So the column states existence and stops:

| Design (P1v4) | Implemented | Why |
| --- | --- | --- |
| `SA-2026-000003` over `Accepted` | `Agreement` | No reference and no state on the list read. A document id is not a label (DECISIONS #106). |
| `SO-2026-000015` | `Order created` | Same. |
| `No agreement` | `No agreement` | Matches. |
| `Order not created` | `Order not created` | Matches. |

This is **more than the design's fallback and less than its full treatment**, and it is recorded as
a named product decision rather than taken as a silent win: populating the column with references
needs list-level resolution or denormalisation, which is a read change, not a presentation change.
Resolving them per row is explicitly forbidden — it is one round trip per visible opportunity on a
scanning surface — and a test renders 25 rows and asserts the governed source was invoked once.

**Deferred from P1v4 with reasons, not silently dropped:**

- **`+ Save as view`** — needs somewhere to persist a named view. That is new authority (a write
  path and a read path for user-scoped list state), not presentation, so it is not built here.
- **Sort control and `Columns`** — the pipeline's order (attention first, then closing soonest) is
  a governed derivation this page does not own. Offering an arbitrary column sort would quietly
  replace the queue's meaning with a spreadsheet's. Named, not built.
- **Pagination (`1–41 of 41 · 59 total`)** — the governed read is not paged; it returns what the
  caller may see in one call. Rendering Previous/Next over a complete list would imply a boundary
  that does not exist. The result line states what is shown and out of what instead.
- **`Updated moments ago · Refresh`** — the read seam exposes `refetch()`, but there is no
  trustworthy "as of" timestamp to print beside it, and a relative time the page invents is exactly
  the class of fabrication this family keeps finding. Deferred together.

**G1, G4 and G5 stand as the design describes them, with one correction.** G1: there is no
Opportunity Name field, so identity is the governed reference with `need` beneath it. G4 is in fact
**already resolved in the repository** — `resolveAccountNames` populates `accountNameById`
server-side and `opportunitySource` carries it through — so rows normally show a real customer
name; the `Customer — name unavailable` wording remains for the case where resolution genuinely
fails, and it never falls back to an account id. G5 stands: `expectedValue` has no governed
currency, so the page renders bare numbers and `Not estimated`, and there are zero currency symbols
on it.

### The record (P1v2)

The implementation is `field-ops-app-vite/src/modules/sales/OpportunityDetail.jsx` over
`src/domain/opportunityNorthStar.js`, with the agreement card in `OpportunityAgreementCard.jsx`.

**One accepted structural deviation:** P1v2 draws Solution as a three-column table (Line / Kind /
Qty). The implementation renders the shared `LineSummary` list, because that renderer belongs to the
workspace detail pane too, where a three-column table in a ~340px column would read worse. Content
is complete — kind, reference and quantity all render. **Owner may reject this deviation**, in which
case the shared renderer gains a table layout rather than the page forking its own.

**One artifact detail is illustrative, not a rule.** The attention strip reads "expected close is in
9 days"; `deriveAttention` raises `CLOSE_SOON` only within **seven**. The threshold is domain
authority and stands.

## Naming, for the families that follow

`docs/north-star/<family>/<Family>-North-Star-<version>.dc.html`, with the version explicit and the
superseded artifact retained beside it rather than deleted. A family with more than one surface
names the surface too, as `Opportunity-North-Star-List-P1v4.dc.html` does here — a family is not a
page, and flattening the two is how a collection ends up governed by a record's artifact.

Sales Agreement P1v1 has since landed in `../sales-agreement/`.
