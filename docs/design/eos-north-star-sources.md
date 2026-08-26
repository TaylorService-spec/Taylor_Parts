# EOS North Star — recovered source artifacts

Status: **AUTHORITATIVE VISUAL/COMPOSITIONAL SOURCE**, Owner-approved 2026-08-25.

The North Star concepts were produced in a design session outside this repository and recovered from
`HTML Site Scoping answers needed.zip` (2026-08-25 04:07). This file records what was recovered and
what each artifact is, so the direction never again depends on a chat transcript or an artifact URL
that this repository cannot read.

## Why this file exists

A repository-analysis session searched for these concepts, found only two passing mentions in
unrelated architecture notes, and correctly reported that they did not exist here. It then derived a
design system from current EOS behavior instead. That derivation is useful — it is the
implementation-reality overlay — but it is **not** the North Star, and the distinction was only
recoverable because the original package still existed in a Downloads folder.

**A design direction that lives only in a conversation is one cleared cache away from being lost.**

## The three authorities

Ratified by the Owner, 2026-08-25. This supersedes the earlier table, which named Visual,
Behavioral and *Translation* as the three, and which resolved every conflict in favour of the
domain. What changed and why is recorded under **Reconciliation** below.

| Authority | Held by | Owns |
| --- | --- | --- |
| **Design** | Claude Design | Visual composition, hierarchy, interaction presentation, responsive behavior, and the North Star design grammar |
| **Behavioral** | The EOS repository / Claude Code | Domain vocabulary, data authority, permissions, capabilities, state transitions, reads, writes, accounting and inventory truth, transactional behavior |
| **Acceptance** | The running sandbox + the Owner | Whether a page is North Star-complete |

### The three rules that bind them

> Design may restructure presentation substantially but **may not invent authority**.
>
> Code may correct implementation defects but **may not materially reinterpret an approved
> composition for implementation convenience**.
>
> When Design and behavioral reality conflict, **neither silently wins**. The conflict is surfaced
> as a **named product decision**.

### What "North Star-complete" means

A page is not complete when it renders, when its tests pass, or when a reviewer approves the diff.
It is complete when **the real sandbox implementation has passed engineering regression AND has been
visually compared against the approved Design source by Design and by the Owner.**

Merged is not complete. Deployed is not complete. Green CI is not complete. Those are the gates
Acceptance runs *through*, not a substitute for it.

Per-family Acceptance state is recorded in
[`north-star-migration-ledger.md`](./north-star-migration-ledger.md) — including the explicit
`AWAITING_OWNER_VISUAL_ACCEPTANCE` state, which exists so that "shipped and green" and "accepted"
can never collapse into the same sentence. Only the Owner moves that column.

*Green CI is not complete — and during family 2 that turned out to be true more literally than
intended: five node:test suites, one of them family 1's own contract suite, were registered nowhere
and had never run in CI at all. See DECISIONS #124.*

Open named decisions live in
[`north-star-open-product-decisions.md`](./north-star-open-product-decisions.md). A page family
carrying an unresolved decision can still ship — the decision is named and visible rather than
silently resolved by whichever authority happened to be holding the keyboard.

### Reconciliation with what this replaces

Two differences are load-bearing, and neither is cosmetic.

**Translation is no longer an authority.** [`eos-north-star-design-grammar.md`](./eos-north-star-design-grammar.md)
remains the instrument by which Design is expressed in Behavioral terms, and every rule in it still
holds. It is not a third party to a disagreement: it is how the first two speak to each other. The
third authority is **Acceptance**, which the old table had no seat for at all — and its absence is
exactly why a page could be declared done on the strength of a diff.

**"The domain authority wins" is narrowed to "the domain constrains what ships".** The old sentence
read: *where the visual source implies a behavior the domain does not grant, the domain wins and the
gap is reported*. The first half survives intact and is not negotiable — **an implementation still
may not invent backend semantics to satisfy a mockup**, and a gap is still reported rather than
closed in the UI. What no longer follows is that reporting it settles it. The domain constrains the
*code*; it does not decide the *product*. A composition asking for something the engine cannot do is
as likely to be a gap in the engine as an error in the composition, and which one it is is a named
decision, not an implementation detail.

The practical test: if resolving a conflict would change what the business can do, it is a product
decision and gets named. If it would only change how something already permitted is drawn, Design
decides. If it would change who may do what, or what is recorded, Behavioral decides — and says so.

## Inventory

### Programme reports

| Artifact | What it is |
| --- | --- |
| `EOS UX Pilot.dc.html` | The pilot report. Audits five canonical surfaces, names the eight-pattern design language, scores each page, and lists the governance findings that bound what design can achieve. |
| `North Star - Subpage Expansion.dc.html` | Tests the language across ~46 destinations. Establishes the ten page archetypes, the AI continuity model, four design-system adjustments found under stress, and the P0–P3 migration order. |

### Proposed surfaces (visual source of truth)

| Artifact | Surface | Notes |
| --- | --- | --- |
| `Proposed - Work Order.dc.html` | Work Order detail | ~~Pilot 1 primary source.~~ **SUPERSEDED 2026-08-25** — the approved source is now `North Star - Work Order.dc.html` (see below). Technician run sheet still reference for a later family. |
| `Proposed - Sales Order.dc.html` | Sales Order detail | Pilot 2. **NEVER HANDED TO THIS REPOSITORY.** The family was migrated 2026-08-26 from the ratified grammar and the shipped family-1 pattern instead, which makes Owner visual acceptance load-bearing rather than confirmatory (DECISIONS #125). If this artifact exists, it has not been seen here. |
| `Proposed - Account.dc.html` | Customer 360 | Ceiling set by capability activation. |
| `Proposed - Opportunity.dc.html` | Opportunity detail | **SUPERSEDED 2026-08-26** by `North Star - Opportunity P1v2.dc.html` (see below). Its note — "requires a per-record route" — was answered: the route and its governed per-id read shipped with the P1v2 build. |
| `Proposed - Parts.dc.html` | Parts workspace | Persona-scoped queues. |
| `Proposed - Dispatch Board.dc.html` · `Proposed - Dispatch Map.html` | Dispatch | Densest board; drag-scheduling with refusal reasons. |
| `Proposed - Technician Mobile.dc.html` | Handheld, technician | Four moments of a field day. |
| `Proposed - Warehouse Mobile.dc.html` | Handheld, warehouse | Pick / receive / count. |
| `Subpages - Commercial.dc.html` | Sales Agreement edit / accepted / states | Hardest commercial surface. |
| `Subpages - Operations.dc.html` | Receiving, scheduling, exception, balances | Cross-object consequence. |
| `Subpages - Lists and States.dc.html` | 142-row list + 12 honest states | The density floor and the state vocabulary. |

### `North Star - Opportunity P1v2.dc.html` — the CURRENT approved Opportunity visual source

**Received 2026-08-26**, as `Claude Design Docs/Opportunity North Star P1v2.zip` → folder
`design_handoff_opportunity`, containing:

| File | What it is |
| --- | --- |
| `North Star - Opportunity P1v2.dc.html` | **The visual authority.** 1a desktop 1440 · 1b phone 375 · 1c representative states. |
| `North Star - Opportunity P1.dc.html` | P1v1, retained for provenance. Superseded. |
| `README.md` | The handoff: authority map, composition walk-through, action architecture, an implementation-reality matrix, decisions O1–O6, a do-not-invent list and an acceptance checklist. |

**P1v2 supersedes P1v1** by adding the Sales Agreement relationship — a main-column section, a
header fact, a mobile row, the agreement states, and decision O6. All P1v1 decisions are preserved.

**This is the first family in the programme to be implemented against its real design source.**
Families 2 and 3 were composed from the ratified grammar because no artifact had been handed over,
and family 4 was built that way once too, before this package arrived. Rebuilding it against P1v2
changed the composition materially — see the migration ledger's family 4 row for the table of what
the design decided differently.

**The Opportunity artifacts are now IN this repository** — `docs/north-star/opportunity/`, committed
2026-08-26. That closes, for one family, the condition this document's own opening paragraph warns
about: "a design direction that lives only in a conversation is one cleared cache away from being
lost" applies to the artifacts as squarely as to the direction, and until now they existed only as a
`.zip` in a Downloads folder.

They are **visual acceptance authority only** — not runtime, data, workflow or permission authority.
See [`../north-star/opportunity/README.md`](../north-star/opportunity/README.md).

**Still outside the repository:** every other family's artifacts, including the Work Order and
Account sources this programme has already built against. The naming convention for bringing them in
is `docs/north-star/<family>/<Family>-North-Star-<version>.dc.html`.

### `North Star - Work Order.dc.html` — the CURRENT approved Work Order visual source

**Superseded, 2026-08-25 (P1v2, Owner ruling).** This section previously classified the artifact as
"Horizon concept — NOT the pilot" and directed implementers to `Proposed - Work Order.dc.html`
instead. That classification no longer holds and must not be acted on.

| Artifact | What it is |
| --- | --- |
| `North Star - Work Order.dc.html` | **The approved visual source for the Work Order family.** The implementation must materially reproduce its composition, hierarchy, density, geometry, typography, lifecycle treatment, action architecture, content/rail proportions and first-viewport experience — not a reinterpretation into the existing EOS composition. |
| `Implementation Render - Work Order.html` | The explicit **pixel target**: a static render of what the approved JSX and CSS produce for a DISPATCHED record with today's capabilities, honest gap states included. What a running page is compared against. |
| `Proposed - Work Order.dc.html` | The earlier pilot composition. Superseded as visual truth; kept for history. Its technician-mobile concept remains reference for a later family. |

#### Structure may anticipate a capability. Content may not.

The artifact's own masthead still says what it always said — *"live truck-stock reads · WO naming
service · notification channel · suggestion engine. None exist today."* That remains true, and it is
why the earlier reading was cautious. The distinction that makes the artifact implementable, and the
rule for every family that follows:

> **KEEP THE DESIGNED STRUCTURAL SLOT. RENDER A TRUTHFUL STATE IN IT. NEVER FABRICATE THE CONTENT.**

- **Visual structure may represent future capability.** A suggestion strip, a dispatcher-context
  section, a first-visit-fix slot — each keeps its position and its geometry, so the page does not
  reflow when the capability ships and the design is not relitigated to add it back.
- **Live content must remain truthful to current EOS behavior.** The slot states what is missing, in
  words, in a muted treatment. Never a percentage, a confidence, an ETA, a repair count, a presence
  indicator or a recommendation that no service computed.
- **A slot may not be silently dropped either.** Omitting it hides the gap as effectively as faking
  it fills it — the reader cannot tell an absent capability from an absent design.
- **Emphasis colour is reserved.** An empty slot must not be dressed in the palette's
  attention colour; an empty band that looks like advice is a fabrication by styling.
- **Where no slot can be honest, omit and say so.** The concept's ⌘K hint and presence chip have no
  command palette and no presence channel behind them; an affordance for a shortcut that does
  nothing is worse than its absence. Omissions are recorded as gaps, not left unexplained.

Where the concept implies an ACTION the engine does not grant, the affordance may hold its place
**disabled and explicitly unavailable**, with copy that distinguishes *not yet, for anyone* from
*not you* — never wired to a no-op, and never to a direct write. The behavior itself is separate,
separately-approved work.

### Comparison and current-state

`1–5 * Before-After.dc.html` pair each current surface with its proposal plus a severity-graded
audit. `Current - *.dc.html` are recreations of the production surfaces at the time of the audit
(Barlow Condensed + Inter, no inline palette — they reference real stylesheets).

### Supporting design system — influence, not source

`_ds/broadsheet-…/` is a complete newsprint design system: Source Serif 4 throughout, paper ground
`#f3f2f2`, cyan `#0088b0` and magenta `#d6006c` spot color, Phosphor duotone icons, no boxes.

**Broadsheet is not the EOS visual language.** Exactly one of the 27 recovered HTML files links its
stylesheet — `Proposed - Account -Broadsheet-.dc.html`, the file named for the experiment. Every
other concept carries its own styling on the Verenward palette with Inter for body and data.

What crossed over is one idea, not the system: **hierarchy from type scale and whitespace rather
than boxes**, plus the thick–thin rule pair as page furniture. Broadsheet's serif body text, spot
colors and "no dark surfaces" rule are contradicted by the concepts, which use Inter for all data and
specify a **dark** condensed handheld header.

Adopting Broadsheet wholesale would replace the North Star rather than implement it.

## Where the files live

The recovered package is **not** committed to this repository — it contains a full third-party design
system and image assets, and the repository already carries a rule against committing bulk artifacts.
The Design Grammar exists so that the direction survives without it. If the package is needed again
it should be attached to the Owner decision record rather than vendored here.
