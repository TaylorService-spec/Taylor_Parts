# Opportunity North Star — handoff ledger

**Status: CURRENT STATE MAP, 2026-08-27.** What is true about the Opportunity family right now, so
an incoming design or implementation update lands against repository truth instead of against a
remembered version of it.

This is not the design (`Opportunity-North-Star-P1v2.dc.html`), not the design handoff
(`DESIGN-HANDOFF-P1v2.md`), and not the migration record (the ledger's Family 4 row). It is the
short answer to *"where does this family actually stand, and what has moved under it."*

---

## Where the family stands

| | |
|---|---|
| **Composition** | `src/modules/sales/OpportunityDetail.jsx` over `src/domain/opportunityNorthStar.js` + `opportunityView.js` |
| **Route** | `/customers/opportunities/:opportunityId` — shipped |
| **Read** | `getOpportunityContext` — shipped |
| **Visual authority** | `Opportunity-North-Star-P1v2.dc.html` (this folder) |
| **Deployed** | **YES** — sandbox `0cc303ba`, `platform-sandbox`, built 2026-08-27T06:11:31Z |
| **Quick Gate** | **PASS** against that build, 2026-08-27. Zero RAW_ID findings |
| **Ledger acceptance** | `AWAITING_SANDBOX_REFRESH_THEN_OWNER_VISUAL_ACCEPTANCE` — **UNCHANGED** |

**The refresh prerequisite in that acceptance value is now satisfied in fact.** The build carrying
this family is deployed and gated. Only the Owner moves the column, so it still reads as it did.

---

## THE ONE THING THAT MOVED UNDER THIS FAMILY

The ledger's *"Cross-family — the Opportunity workspace cannot retire its pane yet"* entry
(2026-08-27) blocked Workspace P1v3 on this reasoning:

> `SalesAgreementPanel` lives inside the workspace's legacy pane, and it is the **only UI in the
> product** through which a governed Sales Agreement can be drafted, priced/edited and **accepted**
> … P1v2's Agreement composition is read + Create, and P1v2 itself assigns acceptance to "the
> agreement itself", which has no surface.

**Sales Agreement North Star family 5 shipped and was Owner-accepted on 2026-08-27** (ledger:
`Closed 2026-08-27`; PRs #1536–#1541). The agreement now has its own surface, so that paragraph is
no longer accurate as written. The blocker did not disappear — **it got smaller and more specific:**

| Pane capability | Has a home on the Sales Agreement record? |
|---|---|
| read an agreement | **YES** — the routed record page |
| accept an agreement | **YES** — `acceptSalesAgreement`, wired in PR #1539 |
| edit commercial terms | **YES** — six governed scalar fields, edited in place |
| create an agreement | **YES** — still on the Opportunity, which is correct: creation needs to know which Opportunity |
| **price / edit LINES** | **NO — this is the whole remaining blocker (SA-G7)** |

So the recorded retirement sequence — *"Sales Agreement North Star provides the replacement governed
surface → then the legacy pane is retired"* — is **one step in, not complete**. Retiring the pane
today would still delete an activated governed capability, but now exactly one: line pricing, the
only path to clearing an unpriced-line acceptance blocker.

**SA-G7 is therefore the gate on Workspace P1v3, and it is the single highest-value follow-up in
either family.** It is classified as a migration gap, not an outage: users are not blocked, because
the pane still works.

---

## Actual sandbox records (verified live, 2026-08-27)

Three Opportunity records exist and were opened on the deployed build:

| Opportunity | Route | Sales Agreement relationship |
|---|---|---|
| **OPP-2026-000001** | `/customers/opportunities/9FoSxCAOidKzn9glynSu` | **None** — "No sales agreement associated." + **Create Sales Agreement** |
| **OPP-2026-000002** | `/customers/opportunities/4F3bD4p84fjNDQPMbEDv` | **SA-2026-000001**, Accepted — **View agreement** resolves to the record |
| **OPP-2026-000003** | `/customers/opportunities/OCKcmBrXcAcMXidTsNr0` | **SA-2026-000002**, Accepted — **View agreement** resolves |

Both agreement states a review needs — *no agreement* and *agreement exists* — are present in real
data. Sandbox also holds SA-2026-000003/4/5, each with a downstream Sales Order, but their
originating opportunities were not identified during the gate.

**No fixture was created for any of this**, and none should be: a gate that mutates its own
fixtures certifies a sandbox nobody else will see.

---

## What the Quick Gate observed, and what it did not

**Observed and clean.** Route resolves; dynamic sweep resolved
`/customers/opportunities/4F3bD4p84fjNDQPMbEDv` and passed; **zero RAW_ID findings** anywhere; the
Opportunity → Sales Agreement link resolves to the first-class record in both directions.

Opportunity's own findings: **4, all in the two tolerated classes** — three small link targets at
375, one of them `A.ns-agreement__ref` at 18px, which is the agreement link on the card. **Not a
regression:** it was a link of the same size before family 5 changed its destination. Whether it is
in scope is an Owner call, and the Sales Agreement family already documents the general exception
(contextual links are not handheld primary controls).

**NOT observed — no fixture, or outside a bounded read-only gate.** Record these as
`NOT OBSERVABLE — FIXTURE ABSENT` rather than assuming:

- an Opportunity in a **WON** outcome with its downstream Sales Order, walked end to end
- a **LOST** outcome
- permission-restricted and state-restricted action renderings under a second persona
- **768** — the bounded Quick Gate brackets 1440 and 375 only, deliberately
- an Opportunity carrying an agreement that is still **DRAFT** (all five sandbox agreements are ACCEPTED)

---

## Known discrepancy, deliberately uncorrected

`Opportunity-North-Star-P1v2.dc.html` labels a **1440** desktop frame that renders near **1640**: it
draws the composition at `.ns-page`'s 1360px `max-width`, which needs a wider viewport than 1440
once the 252px application rail is accounted for.

**The shipped page is correct** — it is fluid and renders properly at 1440. The artifact's *label*
is what is wrong.

**Do not fix it yet.** It is blocked on **ND-16**, because which artboard is worth drawing depends
on whether the shared record grammar stays at 252 / 340 / 56 or moves toward the Sales Agreement
design's 224 / 300 / 40. Owner deferred the correction on 2026-08-26 for exactly that reason, and
family 5's acceptance on the shipped grammar did **not** reopen ND-16.

---

## Open decisions this family carries

| | |
|---|---|
| **ND-13** | The Opportunity has two compositions — the workspace pane and the record page. Whether the pane retires is *"the question that decides whether EOS workspaces keep detail panes at all."* **Now gated on SA-G7 alone** (see above) |
| **ND-16** | Shared record grammar: shipped 252 / 340 / 56 vs the design's 224 / 300 / 40. Open; blocks the artifact dimensional correction |
| **ND-12** | Withdrawn 2026-08-26 |
| **O1–O6** | The design's own product decisions, carried in `DESIGN-HANDOFF-P1v2.md` |

---

## What an incoming update should land against

1. **The family is deployed and gated, not accepted.** Anything that changes the composition
   re-opens the gate, and the ledger value stays where it is until the Owner moves it.
2. **The agreement relationship changed under this family.** The card links to a first-class record
   now, not to the workspace pane. Any Opportunity redesign inherits that, and the ND-13 pane
   question is narrower than the last write-up says.
3. **Do not correct the artifact's dimensions** as part of a content change — that is ND-16's to
   unblock, and mixing them makes both decisions harder to read.
4. **Build to the shipped grammar.** Family 5 was accepted on 252 / 340 / 56 with its main column at
   680px beside the rail. A new Opportunity composition proposing different widths is proposing a
   change to `.ns-record-body`, which four families share — that is ND-16, not a page decision.

---

## What must not happen quietly

- retiring the workspace pane before SA-G7 gives line pricing a home — it would delete an activated
  governed capability
- moving the Opportunity ledger acceptance value without Owner visual review
- correcting the artifact dimensions while ND-16 is open
- creating sandbox fixtures to make a review case observable
