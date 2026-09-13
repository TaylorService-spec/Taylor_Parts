# Parts — North Star P1v2 Handoff

**Rendered frames (acceptance authority):** `frames/1a-workspace-1440.png` · `frames/1a-m-workspace-375.png` · `frames/1b-record-1440.png` · `frames/1b-m-record-375.png` (2× PNG)
**Editable source:** `North Star - Parts P1v2.dc.html`
**Brief:** `docs/north-star/parts/DESIGN-BRIEF-PARTS-P1v2.md` @ branch `claude/parts-p1v2-design-brief`
**Grounding:** `docs/design/parts-north-star-composition-map.md` Parts I–XI (ND-25–ND-30 rulings respected; nothing re-proposed that was ruled unbuildable)
**Next step per brief:** Claude authority/feasibility review of this composition → Owner approval → implementation. **No code until Owner approves.**

## Frames
- **1a Workspace 1440** — catalogue leads and owns the main column; Work + Flow collapse into a 320px rail (nothing relocated off `/inventory`, ND-30); columns Part (internalPartNumber + description, manufacturer folded in when recorded) · Category · Control · Status · Attention (words or nothing); no quantity column (ND-25). Height budget ≤ 1,700px (was 3,406).
- **1a-mobile 375** — two-line list rows (~64px/part), absent facts render nothing; Work group = one summary block. Target ≤ 2,400px (was 9,277).
- **1b Record 1440** — Owner band arrangement: Availability/Inventory · Demand & purchasing · Part information · Identifiers · Activity, each a full-width band with two-up sub-columns. Absence priced at one italic line; contract sentences survive (custody line, "unread, not empty", derivation label). No cost/price (ND-27); reorder point "Not established"; forecast informs but never authorizes the reorder (ND-28). Height budget ≤ 1,050px (was 1,508).
- **1b-mobile 375** — same bands stacked. Target ≤ 1,500px (was 2,615).

## Annotation convention
All design rationale sits behind hover ⓘ icons (`.hlp`/`.tip`) per the project-wide convention; permanently visible copy is design contract only.

## Design rationale (per completion request)
- **Primary hierarchy.** Workspace: one H1, the catalogue owns the main column with views/search/attention forming its working area; Work + Flow subordinate in a 320px rail. Record: three weight tiers — the Availability/Inventory band is primary (strong rule, serif heading); Demand & purchasing and Part information are secondary (light rule, smaller serif); Identifiers and Activity are reference (hairline rule, small-caps label). No two tiers share a treatment.
- **What changed from P1.** Quantity column and per-location quantity rows removed (ND-25); Part Number is internalPartNumber everywhere (ND-26); cost/price rows gone (ND-27); the record's main/rail split replaced by the Owner's full-width bands, eliminating the dead area beside inactive sections; Work group shrank from 1,220px of panels to one rail block; Manufacturer column folded into the Part cell until the data earns a column; annotations moved off-page behind hover icons.
- **Unavailable information.** Never hidden, never dominant: each inactive capability costs exactly one italic line ("built and governed, switched off in this environment") beneath its heading; the contract sentences (custody line, "unread, not empty", derivation label) remain visible; no paragraphs of governance prose, no empty tables, no "authority required" wording for capability-inactive states.
- **Mobile composition.** Workspace 375 is a two-line list (~64px/part, absent facts render nothing) with the Work summary one row deep after the catalogue — target ≤ 2,400px vs the audited 9,277px. Record 375 stacks the same bands with the same one-line absences — target ≤ 1,500px vs 2,615px. Full-width rows, ≥44px targets, no horizontal overflow.

## PROPOSED — REQUIRES AUTHORITY REVIEW
- **None requiring new business authority.** Every drawn fact and action exists in the governed system today.
- Implementation seams to review (presentation contracts, not authority): (1) underlined view tabs — if the Lists P2 COMPOSE contract reserves that markup for declared collection pages, pill chips in this arrangement are the accepted interim; (2) the Work/Flow rail — WorkspaceShell may expose no rail slot today; (3) breadcrumb + rule pair above the shell header touches 14 conformant workspaces and may be deferred as in P1.

## Named differences to reconcile at review
- Underlined view tabs drawn as the target; if the Lists P2 COMPOSE contract reserves that markup for declared collection pages, pill chips in this arrangement are the accepted interim (named in the frame).
- Work/Flow rail placement is composition on the same route — if the WorkspaceShell exposes no rail slot today, that is an implementation seam to name, not a license to restore the stacked panels.
- Manufacturer column removal is data-conditional: it returns when more than a fraction of the catalogue records one.

## Acceptance checklist
- [ ] Whole-composition side-by-side vs 1a/1a-m/1b/1b-m at deployed SHA
- [ ] No quantity column / no quantity in record identity (ND-25); no cost or price (ND-27)
- [ ] Part number everywhere = internalPartNumber (ND-26)
- [ ] Absences: one line each, capability-inactive vocabulary, never "authority required"
- [ ] Catalogue leads at 1440 and 375; Work/Flow subordinate; height budgets met
- [ ] Serialized/lot/untracked parts render their own unit treatment (P-N5)
