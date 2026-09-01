# Implementation delta — Parts P1v2

**Produced before any code, per Owner instruction of 2026-08-31: *"Reconcile current implementation
against the NEW design artifact, not merely fix H1 in isolation. Produce an implementation delta
before changing code."***

> ## CLOSED — Owner visual acceptance given 2026-08-31
>
> **Accepted release `0f1ac714`**, deployed to `platform-sandbox`, release identity proved from
> `/version.json` with `git merge-base --is-ancestor` rather than inferred from a matching string.
> Closing gate: `partsNorthStarQuickGate.mjs --expect 0f1ac714` → **29/29 PASS**.
>
> The full closeout — what the frames could not supply, the ND-30 amendment, the two seams that
> turned out to already exist, the four reader defects corrected on the way through, the gate defect
> that was mine, and the reconciled height ceilings — is recorded at the end of
> [`north-star-migration-ledger.md`](../../design/north-star-migration-ledger.md).
>
> Parts is not to be reopened to chase the original mockup height numbers.

**Status: the Owner ruled on all seven items on 2026-08-31 — design direction APPROVED with authority
corrections. §6 is now the implementation contract.** The delta below is preserved as written, so the
rulings can be read against the evidence that produced them.

---

## 0. Provenance of the artifact

`Parts North Star P1v3.zip` is **byte-identical to `Parts North Star P1v2.zip`** — the handoff, the
`.dc.html`, and all four frames compare `SAME`. P1v3 carries no change. The design authority
reconciled below is that single composition.

| | |
|---|---|
| **Design authority** | `DESIGN-HANDOFF-PARTS-P1v2.md` + frames `1a`, `1a-m`, `1b`, `1b-m` |
| **Acceptance authority** | the four frames, per the handoff |
| **Current deployed** | `9848ec9d` — `platform-sandbox` / `sandbox` |
| **Current `main`** | `7d221497` (the deployed release is an ancestor; `#1625` has landed since) |

---

## 1. The handoff's authority claim, tested

> **PROPOSED — REQUIRES AUTHORITY REVIEW: None requiring new business authority.** Every drawn fact
> and action exists in the governed system today.

**Falsified on two counts.** Both are the same class of finding as the nine of fifteen that P1 could
not build: a fact drawn onto a surface that no governed authority supplies.

### A1 — Activity: the actor and the description do not exist · **NOT AVAILABLE**

Frame **1b** draws, under a band headed *ACTIVITY · the work-order and receiving ledger*:

```
Aug 28, 2:03 PM    Adjusted    Opening adjustment · D. Reyes    +6
```

The ledger carries neither of the middle two facts. `LedgerTransaction`
(`src/domain/inventoryAnalyticsEngine.ts:17`) is exactly:

```
id · workOrderId · partId · type · quantity · timestamp
```

`partActivityRows()` carries those six and no more. There is no actor and no description to render.

An actor and a note *do* exist — on **`inventory_actions`**, a different collection. The entity
register states the two "are never joined or reconciled by any code in this repository", and its
write side was retired on 2026-08-30 (`#1625`) precisely because each note was a second, parallel
assertion that stock had moved. **Sourcing this band's actor from there would rebuild the join the
retirement removed**, and would attribute a governed ledger movement to a person who was recording
something else.

**Design has already drawn the buildable version.** Frame **1b-mobile** renders the same movement as:

```
Adjusted · Aug 28                                              +6
The work-order and receiving ledger.
```

— no actor, no description. The mobile frame is the one that matches governed truth.

**Recommendation: adopt the mobile grammar at both widths.** Zero authority change, and it is
Design's own drawing rather than a Claude substitution.

### A2 — "Used on" is a switched-off capability · **CAPABILITY INACTIVE**

Frame **1b** draws a populated right column:

```
USED ON
Taylor C712 · Soft Serve Freezer
From the existing compatibility catalog.
```

`equipment.compatibility.view` is registered **`active:false`** and granted to nobody
(`src/metadata/definitions/equipmentModel.js:38`, `functions/src/equipmentCompatibility/readService.ts:41`).
`UsedInEquipmentSection` is gated on it and renders nothing today. The reassurance line
*"From the existing compatibility catalog"* is true of the catalogue and false of the read.

This is exactly the class ND-27 already ruled on — built, governed, switched off — and the Owner's
standing instruction is: **"activate no capability except through an explicit governed activation
decision."**

**Options:**
- **(a) Recommended.** Render the truthful-absence line, consistent with the three other switched-off
  reads already on this record.
- **(b)** A governed activation decision for `equipment.compatibility.view` — a separate Owner
  decision, not something a presentation migration may carry.

### Nothing else conflicts with a settled ruling

Checked and clean: no **On hand**; no `warehouseQty`; no cost or price; `Ledger-derived stock` named
by its derivation and kept out of the identity layer; `Reorder point — Not established` exactly as
ruled; `Request reorder` present but not fed by the informational number (ND-28); the ND-25 custody
sentence and the identifier *"unread, not empty"* sentence both survive; scanner semantics untouched.

---

## 2. Governance conflict the composition creates

### C1 — the Work/Flow rail versus ND-30's scope boundary

Frame **1a** collapses the Work group and the Flow group into a **320px right rail**. ND-30's ruling
closes with an explicit scope boundary:

> **DO NOT: relocate the Work group / relocate the Flow group / relocate governed reorder queues.**

The new design authority relocates both. Read literally, the two instruments contradict each other.
Read charitably, ND-30 meant "do not move them off this page" — but that is not what it says, and
this is not a reading Claude may make on its own.

**This needs an Owner amendment to ND-30 (or an explicit confirmation of the narrower reading)
before the rail is built.** It is not a detail that can be absorbed into implementation.

---

## 3. Workspace `/inventory` — element by element

Current deployed against Frame 1a (1440) and 1a-mobile (375).

| # | Element | Today | Design | Classification |
|---|---|---|---|---|
| W1 | Breadcrumb `INVENTORY → PARTS` + rule pair | absent | present | **SEAM** — Design-named #3 |
| W2 | Page identity `Parts` | **reads `Inventory`** | one serif `Parts` | **DEFECT, subsumed** — §3.1 |
| W3 | `Read-checked 9:41 AM · Refresh` | refresh exists, unlabelled | labelled pair | **BUILDABLE** — §3.2 |
| W4 | View selector | pill chips | underlined tabs | **SEAM** — Design-named #1 |
| W5 | View label `Active` | `Active parts` | `Active` | **KEEP OURS** — §3.3 |
| W6 | Summary line | 4 segments incl. status-unknown | 3 segments | composition only |
| W7 | Table columns | 6 (incl. Manufacturer) | 5, manufacturer folded into the Part cell | **BUILDABLE** — §3.4 |
| W8 | Attention cell when empty | `—` | nothing | composition only |
| W9 | Row grammar, `· serialized` marker | partial | bold number + description + marker | **BUILDABLE** (`controlType` carried) |
| W10 | Footer | `Page 1 of 3`, Previous/Next | `62 parts`, no pager | **DECISION** — §3.5 |
| W11 | Work + Flow placement | full-width, 1,220px, below | 320px rail | **SEAM** #2 **+ conflict C1** |
| W12 | Work group content | 8 headings, 4 empty states, 1 row | 1 card + three `— none` lines + one link | **BUILDABLE** — same data, less furniture |
| W13 | Mobile rows | stacked cards, ~300px each | two lines, ~64px | **BUILDABLE** |
| W14 | Mobile Filter/Sort | present | not drawn (search only) | **CONFIRM** intentional |

### 3.1 W2 — the `Inventory` heading, and why it is not fixed in isolation

The Owner classified the live 24/25 failure as `PARTS_PRESENTATION_DEFECT` and affirmed check 3b as
valid. **The runtime cause is not reproducible from source**, and this is stated rather than guessed:

- `PartsList.jsx` passes `title="Parts"` — at `main` **and** at the deployed `9848ec9d`.
- `.fo-page-header__title` is emitted only by `PageHeader.jsx`, reached only via `WorkspaceHeader`.
- The `/inventory` route mounts `PartsList` alone; the domain `<Route>` carries no element, so there
  is no wrapping shell.
- No component imported by `PartsList` renders a second `WorkspaceShell` or `PageHeader`.
- The legacy `Inventory.jsx` — which *does* say `title="Inventory"`, with `On Hand` quantities — is
  unrouted; deprecated, not deleted.
- Nothing in `App.jsx`, `src/navigation/`, `PartsList.jsx` or `shared/ui/` changed between the
  deployed SHA and `main`.

So the cause is runtime — persona, capability resolution, or composition order — and must be
diagnosed **against the live build**, not the tree. That diagnosis is implementation step 1.

It is not a standalone fix because **the design replaces this entire header region**: breadcrumb,
rule pair, single serif H1, and the read-checked line all land together. Patching the heading now
would be work thrown away, and would leave check 3b passing over a region about to be rebuilt.

### 3.2 W3 — the read-checked line is buildable, with one constraint

The refresh already exists (`catalogRefreshToken`, `PartsList.jsx:399`). The timestamp is the
**client's read time** — it must be labelled as that, and must never be presented as data freshness
or as any statement about the currency of the underlying records.

### 3.3 W5 — `Active parts` outranks the frame

ADR-012 §2.2a: "Active" names four different concepts in this codebase, and this page shows
reorder-request statuses beside the catalogue. A bare `Active` chip sits within reading distance of a
second sense of the word. The vocabulary ruling is the stronger authority and the qualifier costs
nothing. **Recommend keeping `Active parts`** and recording the divergence, exactly as was done in
P1.

### 3.4 W7 — dropping the Manufacturer column, honestly

The column reads `Not recorded` on 25 of 25 rows and costs 194px. Folding it into the Part cell is
composition only.

But `test/partsNorthStarWorkspace.test.mjs` currently **pins** Manufacturer as a required column,
with a comment explaining that ND-30 named the grammar. That pin must be rewritten to name the new
design authority as superseding ND-30's column list — **not silently relaxed**. A test that stops
asserting something without saying why is how a ruling gets lost.

### 3.5 W10 — pagination is a scale decision, not a drawing

The frame shows 62 rows and no pager. At 62 rows that is fine. The production catalogue is
~1,400 parts, where rendering every row is a different proposition. **Recommend keeping pagination
and showing the true total**, or virtualizing. Flagged rather than dropped on the frame's authority,
because the frame was drawn against a 62-row fixture.

---

## 4. Record `/inventory/:partId` — element by element

Current seven `RuledSection`s against Frame 1b's five bands.

| # | Element | Today | Design | Classification |
|---|---|---|---|---|
| R1 | Band *Availability / Inventory* | two sections (Stock forecast + location) | one band, two-up | composition only |
| R2 | Rows in that band | **6** | **4** — drops *Recommended reorder qty* and *Risk* | **DECISION** — §4.1 |
| R3 | Derivation sentence | inside the section | band header, right | composition only |
| R4 | `Request reorder` | gated on health + terminal request state | drawn unconditionally | **PRESERVE GATING** — §4.2 |
| R5 | Band *Demand & purchasing* | separate purchasing section | two-up, both sentences survive | composition only |
| R6 | Band *Part information*, left | scattered | Status/Control/Stocking/Unit/Manufacturer | **BUILDABLE** — Manufacturer populated since `#1593` |
| R7 | *Used on*, right | hidden (capability off) | populated | **A2** |
| R8 | *Identifiers* | full section, three paragraphs | reference tier, two lines | composition — **verify the shortened wording still carries "unread, not empty"** |
| R9 | *Activity* | 4-column table | one line per movement | composition, **minus A1** |
| R10 | *Inventory action history* | on the record, part-scoped | moved to the workspace rail under FLOW | **CONFIRM** — §4.3 |
| R11 | Action order | Edit part, then Change status | **1b:** Change status, then Edit part · **1b-m:** Edit part, then Change status | **Design is internally inconsistent** — §4.4 |
| R12 | Mobile bands | 7 sections | drops *Part information* and *Used on*; folds status/category/unit into the fact line | **BUILDABLE** |

### 4.1 R2 — two governed facts disappear

*Recommended reorder qty* and *Risk* are rendered today and are absent from the frame. **Removing a
governed fact from a surface is a product decision, not composition.** Keep them, or record that they
were deliberately dropped — but not by silence.

### 4.2 R4 — the frame draws the button enabled; the rule is not the drawing

`Request reorder` is gated on inventory health and on the terminal state of any existing request. The
frame cannot loosen that. ND-28 is explicit that sharing a card does not make the informational
number the authority for the command.

### 4.3 R10 — which history moves

`#1625` retired the writer; `inventory_actions` is now read-only history. Relocating it is fine, but
the record's panel is **part-scoped** and a rail link is naturally **global**. Confirm which is
intended; a global link labelled like the part-scoped panel would misdescribe what it opens.

### 4.4 R11 — pick one order

The two frames disagree with each other. **Recommend the mobile order — primary action first — at
both widths.**

---

## 5. Height budgets

Targets from the handoff, measurable at gate time. Recorded here so the gate can assert them rather
than trust them.

| Surface | Today | Budget |
|---|---|---|
| workspace 1440 | 3,406px | **≤ 1,700px** |
| workspace 375 | 9,277px | **≤ 2,400px** |
| record 1440 | 1,508px | **≤ 1,050px** |
| record 375 | 2,615px | **≤ 1,500px** |

---

## 6. Owner rulings — **CLOSED 2026-08-31**

**Design direction APPROVED with authority corrections.** All seven were ruled, and all seven landed
on the recommendation. This section is now the implementation contract; the recommendations above are
history.

| | Item | **Ruling** |
|---|---|---|
| **1** | **C1** — ND-30 vs the Work/Flow rail | **AMEND ND-30 — NARROW READING.** The boundary protects route ownership and functional presence, not visual placement within `/inventory`. The 320px secondary rail is approved. Recorded as the ND-30 amendment. |
| **2** | **A1** — Activity actor and description | **ADOPT DESIGN'S MOBILE GRAMMAR AT BOTH WIDTHS.** Do not synthesize the actor. Do not join `inventory_actions` to the governed ledger. Render only what the ledger projection carries. |
| **3** | **A2** — *Used on* | **TRUTHFUL ABSENCE.** `equipment.compatibility.view` stays inactive; no alternate source. Design's section grammar survives with the concise capability-inactive treatment. |
| **4** | **R2** — *Recommended reorder qty* and *Risk* | **REMOVE FROM THE RECORD** — follow Design. An intentional presentation removal, not accidental loss. Underlying domain behaviour and authority are untouched. |
| **5** | **W10** — pagination | **KEEP PAGINATION, SHOW THE TRUE TOTAL.** Design controls visual grammar, not permission to remove operational collection scaling. Never imply the rendered page is the whole catalogue. |
| **6** | **W5** — `Active` vs `Active parts` | **KEEP `Active parts`.** ADR-012 §2.2a remains controlling. Views: `All` · `Active parts` · `Needs attention` · `Serialized`. |
| **7** | **R11** — button order | **PRIMARY FIRST AT BOTH WIDTHS** — `Edit part`, then `Change status`. Responsive layout may restack; it may not reverse the hierarchy. |

### 6.1 Band 1, as ruled

**KEEP:** Ledger-derived stock · Avg daily usage · Days remaining *where truthfully derivable* ·
Reorder point / `Not established` · `Request reorder`.

**REMOVE from this composition:** Recommended reorder qty · Risk.

### 6.2 Design conflict precedence

Implementation authority for this pass, highest first:

1. Existing governed EOS business/domain authority
2. ND-25 through ND-30, **including the ND-30 amendment**
3. These seven Owner/Product rulings
4. The Parts P1v2 / P1v3 visual composition
5. Existing implementation where Design is silent

> **A Design mockup never creates a fact, capability, mutation, permission, derivation, or data
> relationship.**

### 6.3 Implementation boundary

**Approved:** presentation composition · responsive composition · workspace rail placement · concise
truthful-absence grammar · existing facts, actions and navigation composed into Design · pagination
preservation · existing capability gating.

**Not approved:** Functions changes · Rules changes · capability activation · permission changes ·
inventory authority changes · new joins · `inventory_actions` resurrection · new reorder calculations
· `warehouseQty` as stock authority · scanner semantic changes · compatibility capability activation
· backend or data-model changes.

If implementation finds another Design element requiring one of those: **stop that element, report
the conflict, do not approximate it.**

### 6.4 H1

Owner agrees with the handling: **no isolated speculative patch.** Diagnosis of the live runtime
discrepancy is implementation step 1; the correction then lands as part of the approved workspace
migration. Acceptance remains **visible workspace H1 = `Parts`**, and the Quick Gate assertion stands.

### 6.5 Seams

The three seams Design named — underlined tabs vs the Lists P2 COMPOSE contract, the absent rail slot
on `WorkspaceShell`, and a breadcrumb touching 14 conformant workspaces — are engineering questions,
not Owner decisions, and were not put to the Owner.

**Owner visual acceptance remains OPEN.**
