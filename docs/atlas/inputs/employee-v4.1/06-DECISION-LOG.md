# NS2 Design Decision Log (output Q)
Format per brief §23.Q: CHOSEN / ALTERNATIVES / WHY / EVIDENCE.

## P2-D1 — Visual language for P2 — RESOLVED / SUPERSEDED IN SCOPE BY P2-D7
Historical record; the literal token values named below are acceptance evidence only, never Atlas process authority (v3 charter §4). No Owner ruling is outstanding on this question.
CHOSEN: Verenward live-token language (src/index.css semantic tokens; pattern of record: Cycle Counts P1v2 restyle — true-white surfaces, #005A3C actions, evergreen rail, status surface pairs, 6/10px radii).
ALTERNATIVES: (a) Broadsheet system currently bound to this workspace; (b) fresh P2 visual system.
WHY: Brief §3 explicitly excludes Broadsheet styling; Owner already directed "use the live deployed template" on 2026-09-02; a fresh system would violate "visual design comes last".
EVIDENCE: OWNER RULING (2026-09-02), Owner brief 2026-09-12 §3, HISTORIC NORTH STAR (P1v2 files).

## P2-D2 — NS2 naming system adopted
CHOSEN: NS2-<DOMAIN>-<NN> ids, r-suffix revisions, ns2/ workbook, P1 corpus untouched (01-NAMING.md).
ALTERNATIVES: renaming existing files in place; per-family P2 suffixes on old names.
WHY: clean separation for review/zip/pull without breaking the P1 acceptance trail or handoff packages already referenced by engineering.
EVIDENCE: DESIGN INFERENCE; Owner request 2026-09-12 ("new naming system so that we can pull them away from what is already made").

## P2-D3 — Target architecture treated as assumption, not truth
CHOSEN: Design against generic governed server authority; label anything only the Render/Postgres target could provide as TARGET-ONLY.
ALTERNATIVES: design directly against target; design against current Firebase implementation detail.
WHY: brief forbids Firebase as future authority and forbids inventing capability; current EOS is the only verifiable truth.
EVIDENCE: Owner brief §3 (Layer 3); CURRENT EOS observed at ATLAS-BASE-2026-09-10-A. REVERIFICATION REQUIRED AT FAMILY OPEN before treating the historical runtime observation as current product truth.

## P2-D4 — Disposition before design
CHOSEN: every family opens with the §20 archaeology verdict against its P1 source of record before any new composition.
ALTERNATIVES: blank-page P2 redesigns.
WHY: 16 accepted/near-accepted families exist; the brief demands extraction, not amnesia; protects the sandbox acceptance trail.
EVIDENCE: HISTORIC NORTH STAR (project corpus), brief §20.

## P2-D5 — Dashboard consolidation question deferred
CHOSEN: NS2-HOME-01 remains the persona start page; SLS-06 and INV-01 standalone dashboards carried as IA questions (03-IA.md), not silently merged.
WHY: merging would be an IA change with workflow evidence not yet reviewed.
EVIDENCE: USABILITY STUDY grammar, EXPLORATORY MOCKUP.

## P2-D6 — Atlas is the internal process name (Owner correction pass, 2026-09-12)
CHOSEN: Atlas = internal methodology; North Star = approved experience target; EOS = the product. Atlas never appears in the customer-facing product (guard in ATLAS-CHARTER-v2.md §2). NS2-* artifact ids preserved unchanged.
EVIDENCE: OWNER RULING (2026-09-12 correction pass).

## P2-D7 — Visual identity vs legacy composition (clarifies P2-D1 scope)
CHOSEN: The approved Verenward/EOS visual identity and semantic token system observed at the applicable Atlas baseline (ns2/ATLAS-OBSERVATION-BASE.md) is the visual identity source. Atlas may radically change composition, hierarchy, density, spacing, proportions, responsive behavior, navigation, and interaction placement; the current page composition is not binding. Individual token values are never permanent Atlas methodology rules — exact values are referenced from the authoritative token source at the frame’s design baseline. Broadsheet / Source Serif / newsprint / cyan-magenta are not carried forward from exploratory work.
ALTERNATIVES: treat "use the EOS visual system" as "reuse current EOS layouts".
WHY: Owner correction pass §3 — identity serves the North Star; legacy layout must not constrain it.
EVIDENCE: OWNER RULING (2026-09-12). Note: this resolves the substance of charter A1 — Broadsheet is out; Verenward identity is in. A1's countersign is hereby satisfied by the correction pass.

## P2-D8a — Responsibility vocabulary adopted (Owner handoff 2026-09-13)
CHOSEN: OWNED / ACCOUNTABLE / ASSIGNED / APPROVAL / ESCALATED as the product-wide relationship vocabulary; three distinct governed actions (transfer accountability / reassign execution / transfer ownership); company-owned records never display an employee as owner; anti-patterns §33 binding.
EVIDENCE: OWNER RULING (handoff). Semantics owned by the operating-model workstream — design consumes, never redefines.

## P2-D9 — Visual-authority conflict — RESOLVED 2026-09-13 (Owner propagation package §13: use current approved Verenward/EOS visual authority; Source Serif / Broadsheet / newsprint not binding; brand identity must not be accidentally redefined)
CONTEXT: On 2026-09-13 the workspace re-attached the Broadsheet design system as binding. Owner rulings (correction pass, P2-D7, charter v3.1 §4) had retired Broadsheet for North Star surfaces in favor of the Verenward/EOS identity.
CURRENT AUTHORITY: Verenward / EOS visual authority governs current North Star. Broadsheet / Source Serif / newsprint treatments are historical/exploratory and non-binding unless specifically re-approved. (Historical note: the 2026-09-13 re-attachment was surfaced here as a conflict and resolved by Owner the same day — no default-pending state remains.)

## P2-D8 — VDX terminology
CHOSEN: VDX — Verenward Data Exchange — replaces KDX for the customer-agnostic integration/data platform capability; customer-specific connectors are adapters on VDX; historical references keep KDX with "HISTORIC TERM: KDX — now VDX".
EVIDENCE: OWNER RULING (2026-09-12).

## P2-D10 — Governed handoff semantics are a design hypothesis (Owner propagation pass, 2026-09-13)
UPDATED 2026-09-13 (v3 pass): OD-7 is SETTLED — authoritative fact resolution → governed orchestration → pure family/axis validation → audit → atomic commit; the orchestration boundary is authoritative and the pure builder performs no second authoritative Employee lookup. Settled platform semantics: zero responsibility gap, authoritative target resolution, explicit governed transition, distinct owner/accountable/assigned, audit, atomic commit, invalid targets refused before mutation. Per-workflow behavior (recipient acceptance, immediacy, forcing rights, decline windows, post-rejection escalation) carries DESIGN HYPOTHESIS — WORKFLOW-SPECIFIC HANDOFF SEMANTICS until each workflow is established.
EVIDENCE: OWNER RULING (§10).

## P2-D11 — Record responsibility context uses family applicability (Owner propagation pass §7)
CHOSEN: Owner / Operating Company / Accountable / Assigned / Approval / Escalated render only where the record family truly carries them; reference/master-data records never get fake personal accountability. Commercial records (Opportunity, Sales Agreement, Sales Order) carry ACCOUNTABLE separately from RECORD OWNER; accountability may default from ownership but is separately transferable (§5 — settled direction).
EVIDENCE: OWNER RULING.

## P2-D12 — No Change-Company command on Service Jobs (v3 pass §15)
CHOSEN: operating company displays where useful; no interaction to change it on an existing Service Job — BUSINESS CASE NOT ESTABLISHED. A field existing never justifies a command.
EVIDENCE: OWNER RULING (2026-09-13).
