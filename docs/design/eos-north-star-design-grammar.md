# EOS North Star Design Grammar

Status: **TRANSLATION CONTRACT**, Owner-approved 2026-08-25. Source-grounded — every `[NS]` claim is
evidenced in a recovered artifact listed in [`eos-north-star-sources.md`](./eos-north-star-sources.md).

Labels used throughout:

- **`[NS]`** — extracted directly from a recovered North Star concept.
- **`[REC]`** — a recommendation added during extraction. Deliberately rare.
- **`[EOS]`** — a constraint or fact from the current repository/runtime.

## 0. What this document is for

The recovered `Proposed - *` artifacts hold visual and compositional authority. The existing governed
backend holds behavioral authority. **This file is how one is expressed in terms of the other**, so
an implementer never has to guess whether a pixel implies a permission.

Where they conflict, the design is not quietly changed. The gap is stated, classified, and reported.

## 1. The Vital Few — protected implementation requirements

Five decisions account for most of the perceived difference. A build that ships the signature (serif
titles, brass kicker, rule pair) and none of these will look like the concepts and operate like
today.

| # | Principle | Why it is vital |
| --- | --- | --- |
| **NS-P1** | **The lifecycle spine is visible and navigable** `[NS]` | Named as a critical absence in all five pilot audits. Converts a database object into an operating surface. |
| **NS-P2** | **One page grammar, in order:** kicker → header → lifecycle → attention → work → rail `[NS]` | The pilot's own conclusion: the problems "are compositional and repeat on every surface, which also means one shared page grammar fixes them everywhere." |
| **NS-P3** | **Honest states are designed content** `[NS]` `[EOS]` | "Fail-closed became fail-blank." EOS's governance strength either becomes visible quality or stays invisible damage. |
| **NS-P4** | **One fact, one rendering** `[NS]` | Status shown 4×, AR denial 3×, facts stated 3×, one reorder request rendered three ways. Deduplication is most of the perceived calm. |
| **NS-P5** | **Composition per persona, authority unchanged** `[NS]` | Same record, different first screen. Costs no governance change and is what makes the handheld a product rather than a shrink. |

Add for implementation: **NS-P6 — behavioral acceptance.** Visual similarity is insufficient; the
page must survive real sandbox data, real personas, deep-link, refresh, error states, five widths and
the regression gate.

## 2. Visual DNA `[NS]`

Extracted from the concepts' own inline styling — not from Broadsheet.

### Color — the Verenward palette, untouched

| Token | Value | Role |
| --- | --- | --- |
| Page ground | `#F3F0E9` | Warm paper |
| Raised surface | `#FCFAF6` | Boards, panels, handheld cards |
| Ink | `#102B24` | Titles, rules, primary text |
| Ink 2 / 3 | `#4A5B55` / `#6B7A74` | Secondary / tertiary text |
| Rules | `#D9D3C6` `#E8E2D6` `#C3BCAB` `#E3DDD0` | Hairlines and sunken fills — the structure of the page |
| Accent | `#1C4638` | Links, primary action fill |
| **Brass** | `#B08A55` | **The kicker: object type · governed reference** |
| Positive / Warn / Negative / Info | `#237A45` / `#A9740D` / `#B23B3B` / `#2B5B7A` | Status tone — never color alone |
| Tints | `#F0E4C8` amber · `#FDECEC` red | Amber = suggestion. Red fill = destructive only. |

These map to the repository's existing Verenward CSS variables; **use the variables, not the hexes.**

### Type

- **Source Serif 4** — titles and display numerals only.
- **Inter** — body, UI, and **all tabular data**. The expansion report is explicit: serif numerals
  jitter in dense tables, so data tables set numerals in Inter with tabular figures.
- **Three-step header scale:** 40px top-level record · 30–34px workspace/subpage · 22px drill-in.
  The kicker and rule pair stay constant so identity survives the shrink.

### Structure

Exactly three structural elements: **whitespace**, **rules**, and **the ruled panel** (hairline
border, paper fill) — the last admitted by the expansion report for editors, dialogs and suggestion
bands **only**, never for read-only layout.

Hierarchy comes from the type scale and whitespace, **not boxes**. The thick–thin rule pair under the
masthead is page identity. Elevation is essentially absent.

### Tables

Thick head rule, hairline row rules, uppercase micro-labels, right-aligned tabular numerals, one
status word per row **in words, not enums**. Never wrapped in cards. Working density is 32px rows.

### Iconography `[REC]`

The concepts use text and a few inline glyphs; no icon set is established. Broadsheet specifies
Phosphor duotone but is not the source language. Adopt one family at implementation and put it in
tokens — this is a genuine gap, not an extraction.

## 3. Information architecture — the eight patterns `[NS]`

Ordering law: **kicker → header → lifecycle → attention → work → rail.**

1. **Enterprise record header** — kicker (object type · governed reference), serif title, status in
   words, owner, and the 3–5 facts that identify the record. Detail pages only; index and workspace
   pages get a workspace header instead.
2. **Lifecycle band** — one line placing the record in the business chain: done ✓, current ●,
   future ○, with upstream/downstream records as links. Never restated in body sections.
3. **Attention block** — "Needs attention / Blocking" **first** in the work area: severity word,
   plain-language fact, owner, deep link. **Renders nothing when clean.** Not for informational status.
4. **Metric strip** — 3–5 operating numbers, each with its exception count and link. Never more than
   five; never unlinked vanity numbers.
5. **Operational table** — one table pattern for all row data.
6. **Action cluster** — right end of the header. Never scattered through body sections.
7. **Honest-state vocabulary** — six states, one rendering each (§5).
8. **Detail rail** — master data in a right rail, least-used blocks collapsed. Never actions or
   attention.

## 4. Action architecture `[NS]`

- **One filled primary** = the likeliest next state transition. Outlined secondaries.
- **Destructive** = red text + consequence + reason, with confirm. Red *fill* is destructive only.
- **Protected actions state the reason in words, once** — "never a page of locks."
- **Blocked actions carry their checklist.**
- **Bulk = one governed transition per record, reported per row.**

`[EOS]` The live Accept control explains one reason at a time. Preconditions must accumulate — return
all unmet ones rather than throwing on the first. **Gap, not a design change.**

## 5. Honest-state model `[NS]`

Twelve situations, one rendering each. "No lock farms, no blank regions, no spinners pretending to be
content."

| State | Rendering, from the source |
| --- | --- |
| No data yet | "No opportunities on this account yet." + *New opportunity* |
| None match filters | "142 work orders exist; none match these filters." + *Clear filters* |
| Not available to you | "Accounts Receivable isn't part of your role. Ask an administrator if you believe you need it." |
| Capability not enabled | "Activity Notes isn't switched on for this workspace yet." — one sentence, once, never a page of padlocks |
| Loading | A stated loading state, never a spinner standing in for content |
| Temporarily unavailable | "Sales Orders couldn't be loaded. **Your work elsewhere is unaffected.**" + *Try again* |
| Partly priced money | "Order value: $56,000 **+ 1 unpriced**" — incompleteness is part of the number |
| Not applicable | The fact does not apply to this record — distinct from absent |

The second sentence in *temporarily unavailable* is load-bearing: telling somebody their other work
is unaffected is the difference between a failed panel and a frightening application.

## 6. Page archetypes `[NS]`

Ten archetypes govern all ~46 destinations. "No eleventh grammar needed."

Overview · Entity list · Operational queue · Record detail · Sub-record drill-in · Create/edit ·
Workflow execution · Board/scheduler · Handheld flow · State page.

Admin/config pages are Record detail + Create/edit at low ceremony. Search and pickers are the Entity
list rendered in a dialog.

## 7. Handheld model `[NS]`

"Language inherited, composition rebuilt" — explicitly **not** compressed desktop.

- Dark condensed header, status inline; **one filled action per screen**; 44px+ targets.
- **A route, not a list** — pickups appear as route steps; the next action is the only filled button.
- **Offline-first with a visible sync queue** — "every write queues and syncs — the sync state is
  always visible."
- Scan-first tab bar; mode before capture (use / look up / return).
- **Honest exits are first-class** — "Could not complete…" sits beside Complete.
- **Unplanned parts flag variance, never block the job.**
- Tables become labelled stacks; the bottom bar holds 1–2 actions at ≥44px.

## 8. AI interaction model `[NS]`

AI is **contextual intervention, not a destination.** There is no chat panel.

| Surface | Role |
| --- | --- |
| Record details | Advisory — what needs attention, what's next |
| Operational queues | Informational ranking — visible reasons, **never hides rows** |
| Dispatch board | Recommended action — placements you accept/undo |
| Schedule/assign, exception recovery | Governed action proposal — drafts the bundle; a human approves; **the engine validates** |
| Agreement terms · money entry | **Quiet** — commercial terms are authored, never suggested into existence |
| Scanner · cycle count · signatures | **Quiet** — suggestions would bias counts |
| Admin / permissions | **Quiet** — authority configuration stays human-only |

**The pattern:** observed fact → why it matters → consequence → one recommended governed action →
human acknowledgement → existing EOS authority executes.

### Trust contract

1. Reasons always stated. 2. Accept-with-undo. 3. One suggestion slot per page (a collapsible tray on
boards). 4. Decline never nags. 5. Proposals ≠ records, visually and semantically. 6. Quiet zones are
contractual, not stylistic. 7. `[REC]` Provenance for every claim, and failure renders as failure — a
suggestion band that silently disappears is indistinguishable from "nothing to suggest".

### The prohibition `[REC]`

If the AI capability does not exist, **do not fabricate it**: no hardcoded insight text, no
deterministic logic presented as AI, no invented numbers. A truthful deterministic attention state
may occupy the composition where EOS already holds the underlying fact. The future AI location may be
structurally prepared **without fake content**.

## 9. What not to copy

- **From today's EOS** `[NS]`: sprint-order section stacking · three coexisting UI generations · lock
  farms · document ids as content · one layout for every persona · desktop squeezed onto phones.
- **Broadsheet wholesale** `[REC]` — see §2 and the sources file.
- **The horizon Work Order's live numbers** `[REC]` — ETAs, confidence percentages and first-visit-fix
  rates. Shipping them without the services behind them would be the most damaging possible outcome:
  a fabricated number in an operations system.

## 10. Falsifiable rules

Each carries provenance and a test that can fail. A check incapable of failing is not evidence.

| # | Rule | Provenance |
| --- | --- | --- |
| R01 | Every detail page renders kicker → header → lifecycle → attention in that DOM order | `[NS]` |
| R02 | The governed reference is the page's single `h1` | `[NS]` |
| R03 | No raw document id is rendered as content, ever — including inside stored machine-written text | `[NS]` `[EOS]` |
| R04 | Status renders as a word, never an enum, never color-only | `[NS]` |
| R05 | Each honest state has exactly one rendering, stated once per page | `[NS]` |
| R06 | A protected action states its reason once — never a page of locks | `[NS]` |
| R07 | One filled primary action per surface | `[NS]` |
| R08 | Every governed action shows all unmet preconditions at once | `[REC]` `[EOS]` |
| R09 | Lifecycle links resolve in both directions | `[NS]` `[EOS]` |
| R10 | One fact has one rendering per page | `[NS]` |
| R11 | Data numerals are Inter, tabular, right-aligned | `[NS]` |
| R12 | Tables are never wrapped in cards | `[NS]` |
| R13 | The ruled panel appears only in editors, dialogs and suggestion bands | `[NS]` |
| R14 | Entity lists hold 32px rows and support `j`/`k`/`x`/`o`/`/`/`Esc` | `[NS]` |
| R15 | Bulk actions run one governed transition per record, reported per row | `[NS]` |
| R16 | Every interactive target is ≥44px on handheld, enforced at authoring time | `[NS]` `[EOS]` |
| R17 | Handheld writes queue offline with the sync state always visible | `[NS]` |
| R18 | Completion cannot be tapped past | `[NS]` |
| R19 | One suggestion slot per page; a tray on boards | `[NS]` |
| R20 | Every suggestion states reason, consequence and offers undo | `[NS]` |
| R21 | AI is contractually silent in terms, counts and admin | `[NS]` |
| R22 | AI proposes; the engine validates; a human approves | `[NS]` `[EOS]` |

## 11. Implementation reality — standing gaps

| North Star intent | Current EOS reality | Classification |
| --- | --- | --- |
| Honest states everywhere | Sales Agreement distinguishes all four; it is the only surface that does | **Foundation exists** — extract as a shared primitive |
| Lifecycle band on every record | Lineage exists in Firestore; two fields were written and projected to nobody until 2026-08-25 | **Foundation exists** — audit every chain edge for both directions |
| Account shows commercial life | `opportunity.read`, `salesOrder.read`, `finance.read`, `crm.activity.read` registered inactive catalog-wide | **Governance decision required** |
| Opportunity has a URL | No per-record route; no per-id governed read | **Requires product build** (small) |
| SO lineage names its Work Orders | No WO naming service | **Requires product build** |
| Parts readiness (truck / staged / missing) | No live truck-stock read | **Requires product build** |
| Suggestion band, ETAs, first-visit-fix | Assistant seam exists, disabled, private-only; no routing, notifications or suggestion engine | **Requires AI** + services |
| Master/detail composition | No reusable primitive; zero module files use a CSS grid split | **Implementation must solve it** |
| Contact detail links | No Contact route or per-contact read | **Product decision required** |
| Merged dispatcher/technician WO surface | Two separate surfaces today | **Product decision required** — changes no authority |
| Exception recovery bundle | No transactional boundary spanning WO + reservation + notification | **Governance decision required** |
