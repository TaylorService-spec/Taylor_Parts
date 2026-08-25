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

| Authority | Held by | Meaning |
| --- | --- | --- |
| **Visual / compositional** | The approved recovered `Proposed - *` artifacts | What the screen looks like and how it is composed |
| **Behavioral / domain** | Existing governed EOS backend contracts — commands, state machines, capabilities, Rules, audit | What the system may do and who may do it |
| **Translation** | [`eos-north-star-design-grammar.md`](./eos-north-star-design-grammar.md) | How the first is expressed in terms of the second |

Where the visual source implies a behavior the domain authority does not grant, **the domain
authority wins and the gap is reported** — it is never closed by inventing backend semantics to
satisfy a mockup.

## Inventory

### Programme reports

| Artifact | What it is |
| --- | --- |
| `EOS UX Pilot.dc.html` | The pilot report. Audits five canonical surfaces, names the eight-pattern design language, scores each page, and lists the governance findings that bound what design can achieve. |
| `North Star - Subpage Expansion.dc.html` | Tests the language across ~46 destinations. Establishes the ten page archetypes, the AI continuity model, four design-system adjustments found under stress, and the P0–P3 migration order. |

### Proposed surfaces (visual source of truth)

| Artifact | Surface | Notes |
| --- | --- | --- |
| `Proposed - Work Order.dc.html` | Work Order detail | **Pilot 1 primary source.** Dispatcher composition + technician run sheet. |
| `Proposed - Sales Order.dc.html` | Sales Order detail | Pilot 2. |
| `Proposed - Account.dc.html` | Customer 360 | Ceiling set by capability activation. |
| `Proposed - Opportunity.dc.html` | Opportunity detail | Requires a per-record route. |
| `Proposed - Parts.dc.html` | Parts workspace | Persona-scoped queues. |
| `Proposed - Dispatch Board.dc.html` · `Proposed - Dispatch Map.html` | Dispatch | Densest board; drag-scheduling with refusal reasons. |
| `Proposed - Technician Mobile.dc.html` | Handheld, technician | Four moments of a field day. |
| `Proposed - Warehouse Mobile.dc.html` | Handheld, warehouse | Pick / receive / count. |
| `Subpages - Commercial.dc.html` | Sales Agreement edit / accepted / states | Hardest commercial surface. |
| `Subpages - Operations.dc.html` | Receiving, scheduling, exception, balances | Cross-object consequence. |
| `Subpages - Lists and States.dc.html` | 142-row list + 12 honest states | The density floor and the state vocabulary. |

### Horizon concept — NOT the pilot

| Artifact | What it is |
| --- | --- |
| `North Star - Work Order.dc.html` | The post-pilot horizon. Its own masthead states the assumption: *"live truck-stock reads · WO naming service · notification channel · suggestion engine. **None exist today — this is the destination, not the pilot.**"* Every projection on it (ETA confidence, first-visit-fix percentages, median completion) depends on services that do not exist. |

Treat this artifact as **compositional guidance for where AI belongs**, never as a specification of
numbers to render.

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
