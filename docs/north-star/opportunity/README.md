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

| File | What it is |
| --- | --- |
| `Opportunity-North-Star-P1v2.dc.html` | **The current visual authority.** 1a desktop 1440 · 1b phone 375 · 1c representative states. |
| `Opportunity-North-Star-P1v1.dc.html` | Superseded by P1v2. Kept for provenance, not for implementation. |
| `DESIGN-HANDOFF-P1v2.md` | Design's own handoff README, verbatim: authority map, composition walk-through, action architecture, the implementation-reality matrix, decisions O1–O6, the do-not-invent list and the acceptance checklist. |

**P1v2 supersedes P1v1** by adding the Sales Agreement relationship — a main-column section, a
header fact, a mobile row, the agreement states, and decision O6. All P1v1 decisions are preserved.

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
superseded artifact retained beside it rather than deleted. The next family to land here is
**Sales Agreement P1v1**.
