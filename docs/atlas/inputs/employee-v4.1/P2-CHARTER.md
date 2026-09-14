# NS2 — EOS North Star Design P2 Charter (v1)
Status: SUPERSEDED by ATLAS-CHARTER-v2.md (Atlas correction pass, 2026-09-12) — retained unchanged below as acceptance trail. Previously: ADOPTED WITH AMENDMENTS — awaiting Owner countersign on A1
Source: Owner brief "EOS NORTH STAR DESIGN P2 — Whole-Product Operational Experience Synthesis", received 2026-09-12, plus Owner addendum §27 "Design Fidelity — North Star is a target, not inspiration" (same day; chat, verbatim record in conversation). This charter adopts that brief in full except as amended below. Where this file and the brief conflict, the amendment wins; where both are silent, project CLAUDE.md (Three-Authority Model) governs.

## Amendments (the "changes as needed" review)

**A1 — Visual language conflict (BLOCKING, Owner ruling requested).**
Brief §3 orders: ignore Broadsheet styling; use the EOS/Verenward design language. This workspace currently has the Broadsheet design system bound as its visual authority, and prior Owner direction (2026-09-02, Cycle Counts P1v2) was "use the live deployed template" — the src/index.css semantic tokens (true-white surfaces, #005A3C actions, evergreen rail, status surface pairs).
Default until ruled: **P2 designs render in the Verenward live-token language (P1v2 pattern of record). Broadsheet is retired to exploratory/print artifacts only.** Logged as decision P2-D1.

**A2 — Target architecture is a design assumption, not current truth.**
The Browser→Vercel→Render→PostgreSQL model in Layer 3 is TARGET. Current EOS authority runs through Functions callables/commands (e.g. cycleCountSheetCallables.ts). P2 designs assume governed server-side authority generically; no page may depend on a fact only the target architecture could provide. Claims from old artifacts ("Firestore Rules are the boundary", "every module is an existing read") are HISTORICAL and already superseded in this project's later packages.

**A3 — Contract extended.**
Brief §22's 30-point contract gains three fields from established project practice:
31. ANNOTATION CONVENTION — all design notes behind hover ⓘ (.hlp/.tip), per CLAUDE.md; pattern of record North Star - Parts P1v2.
32. SOURCE FILES — repo grounding per surface, feeding github.md ## Screen map.
33. TRUTH-STATE SET — each surface names its rendered states from the shared vocabulary (Lists P2 17-state system is the base register).

**A4 — P2 starts with disposition, not a blank page.**
Sixteen designed families exist (see 04-PAGE-INVENTORY.md). Step one of every P2 family is the §20 archaeology verdict (KEEP / IMPROVE / REPLACE / REMOVE / ADD / *-GAP) against the P1 source, not re-design from zero. Unavailable historic acceptance evidence is labeled HISTORICAL ACCEPTANCE EVIDENCE — SOURCE UNAVAILABLE, never recreated from memory.

**A5 — Naming.**
The brief defines no artifact naming. The NS2 system (01-NAMING.md) is adopted: all P2 work is authored under NS2-* identities, cleanly separable from the P1 corpus, which stays untouched in place.

**A6 — Reuse of existing outputs against §23.**
Already partially satisfied and to be promoted, not re-authored: E (role dashboards — My Dashboard P1v2, 7 personas), F (Nav Mapping - Current EOS to North Star), M (Lists P2 17-state system), P (per-family gap registers, consolidated in 05-GAP-REGISTER.md), Q (per-family named decisions, consolidated in 06-DECISION-LOG.md).

**A7 — Acceptance.**
Addendum §27 now defines acceptance explicitly and matches the Three-Authority Model: dual review — FUNCTIONAL (authority/workflow/data/actions/states/recovery) and VISUAL/EXPERIENCE (hierarchy, composition, density, proportions, spacing, action placement, responsive behavior, attention hierarchy). A surface can pass one and fail the other; both must pass. Every material implementation difference is APPROVED CHANGE or DEFECT — no third category. Change control: constraint → recorded → returned to Design → reference revised → re-accepted → implemented. No prose-only handoff: approved frames remain part of the requirement.

**A8 — Reference-frame naming harmonized with NS2 ids.**
§27 requires named approved frames (its example: NS-P2-WORK-ORDER-1440). To keep one identity system, a frame reference is `<NS2 id>-<width>`, e.g. NS2-SVC-03-1440 / -1024 / -375. Minimum widths per §27: 1440 / 1024 / 375 where appropriate; intentionally device-specific surfaces still state their responsive behavior explicitly. Frame references survive into implementation handoffs and drive side-by-side / visual-diff comparison at matching viewports.

## Condensed operating rules (from the brief, binding)
1. One product. Design from process outward: OUTCOME → WORKFLOW → AUTHORITY → PERSONA → QUESTIONS → ACTION → EXCEPTION/RECOVERY → AI → RESPONSIVE → VISUAL. Visual last.
2. Never invent authority, workflow transitions, ownership, operating-company rules, or facts. Mark WORKFLOW GAP / AUTHORITY GAP / MISSING CAPABILITY and design the desired experience honestly.
3. Dashboards are operating start pages: SITUATION → ATTENTION → KEY OUTCOMES → WORK → DRILL-THROUGH. No dead KPIs.
4. Pages are operating surfaces: helpful explanation behind ⓘ; operational truth (errors, blocks, denials, consequences) always visible.
5. Record pages divide by user job, not schema. Stable default sections; contextual deep links; URL-addressable major sections (back/refresh/share safe).
6. Action states rendered truthfully and distinctly: AVAILABLE / UNAVAILABLE WITH REASON / NOT APPLICABLE / NOT AUTHORIZED / NOT YET IMPLEMENTED.
7. Exception & recovery paths are first-class; use the 1,010 Day-in-the-Life activities and the Workflow Registry as evidence. NOT_RUN is never proven behavior. Every recommendation states its workflow status (WORKS END TO END … OWNER DECISION REQUIRED).
8. AI interprets, summarizes, drafts, recommends; accepting a recommendation invokes the normal governed EOS action. Quiet or absent when ungrounded. No parallel write path; no capability explosion.
9. Responsive = recompose, never shrink. Width never changes authority. Desktop-oriented surfaces get an honest phone alternative.
10. Source discipline on every finding: CURRENT EOS / OWNER RULING / WORKFLOW REGISTRY / DAY-IN-LIFE / HISTORIC NORTH STAR / USABILITY STUDY / MOCKUP IDEA / DESIGN INFERENCE; code claims carry branch/commit.
11. Every surface ships the 35-point contract (07-CONTRACT-TEMPLATE.md).
11a. §27 fidelity: the approved North Star frame is the implementation target, not inspiration. Experience/visual authority (composition, hierarchy, density, spacing, placement, responsive transformation, attention presentation) belongs to Design; engineering adapts mechanics only. "We already have another component" never justifies degrading an approved experience; repeated approved patterns get promoted into reusable EOS components (Attention Strip, Operational Figure, Work Queue, Record Header, Context Rail, Exception Banner, Progressive Help, Workflow Action Group…). Explicit per page: max content width, column ratios, section order, spacing rhythm, heading scale, action placement, density, rail/sticky behavior, responsive stacking (what disappears vs relocates), empty-state composition, AI/help placement, drill-through.
12. Success feel: quiet, fast, clear, role-aware, process-aware, exception-aware, recoverable, connected, responsive, AI-native, governed.

## Workbook outputs (brief §23 → files)
A Principles → this charter. B Personas → 02-PERSONAS.md. C/D IA & role navigation → 03-IA.md. E Dashboards → NS2-HOME family. F Route inventory → 04-PAGE-INVENTORY.md. G Contracts → ns2/pages/ + 07 template. H–L matrices → authored per family, consolidated as P2 progresses. M Error/recovery library → promoted from Lists P2 states. N Help model → A3.31. O Search/findability → OPEN (not yet designed; inventory row NS2-PLT-05). P Gaps → 05-GAP-REGISTER.md. Q Decisions → 06-DECISION-LOG.md. R Handoff → last, per family, in design_handoff_* convention under NS2 names.
