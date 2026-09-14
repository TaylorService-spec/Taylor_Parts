# ATLAS CHARTER — v2 — SUPERSEDED by ATLAS-CHARTER-v3.md (consistency cleanup, 2026-09-12); retained as acceptance trail. (Originally superseded P2-CHARTER.md.)
Atlas correction pass applied 2026-09-12 per Owner "ATLAS WORKBOOK — PROCESS/NAMING CORRECTION PASS". Internal design-process document only. Where v1 and v2 conflict, v2 wins; v1's amendments A1–A8 remain in force except as restated here.

## 1. Definitions
**ATLAS** — Verenward's internal process-to-experience design methodology. It connects business process, authority, personas, scenarios, workflow, information architecture, interaction design, and visual fidelity to produce an approved EOS North Star. "Atlas does not design screens in isolation. Atlas designs the operating experience, then produces North Star screens that express it."
**NORTH STAR** — the approved target experience produced by Atlas.
**EOS / VERENWARD EOS** — the actual product the customer uses.
Atlas is not a product, feature, site section, navigation item, customer-facing brand, or EOS runtime concept.

## 2. Internal-only guard (binding)
The word "Atlas" must never appear in: customer navigation, visible page titles, product copy, field labels, help text, customer documentation, runtime object names, URLs/routes, API concepts, or customer-facing release notes — absent a future explicit product decision. Atlas may appear in: Claude prompts, this workbook, internal process docs, implementation handoffs, acceptance records, issue/PR metadata. No Atlas branding inside designed EOS screens.

## 3. Process chain (canonical order; visual never precedes process/authority/role)
BUSINESS OUTCOME → WORKFLOW/PROCESS → AUTHORITY → PERSONA/RESPONSIBILITY → USER QUESTIONS → INFORMATION → ACTIONS → EXCEPTIONS/RECOVERY → AI/ASSISTANCE → RESPONSIVE COMPOSITION → VISUAL NORTH STAR → IMPLEMENTATION HANDOFF → FIDELITY ACCEPTANCE.
Atlas may identify missing workflow, authority, projection, or capability; it must never silently invent them.

## 4. Visual system (restates A1/P2-D1 with Owner's clarification)
USE THE VERENWARD/EOS VISUAL IDENTITY. DO NOT BE LIMITED BY THE EXISTING EOS PAGE COMPOSITION.
- Not binding from exploratory work: Broadsheet, Source Serif, newsprint metaphor, cyan/magenta palette, page-template styling.
- "Use the EOS visual system" does NOT mean "reuse current EOS layouts": Atlas has full freedom over composition, hierarchy, density, spacing, proportions, responsive behavior, navigation treatment, section structure, interaction placement, whitespace, page organization. Tokens/brand serve the North Star; legacy layout/components never constrain it.

## 5. Artifact identity stability
Existing NS2-* identifiers (and established North Star artifact names) remain stable. Atlas names the process; North Star names the experience target. No cosmetic mass rename that breaks acceptance records, screenshots, or handoffs. Any Atlas-specific naming convention requires a separate deliberate decision.

## 6. Terminology: VDX
**VDX — Verenward Data Exchange** is the customer-agnostic platform capability (integration, exchange, data quality, mastering, governance, source-system provenance). Customer-specific connectors/mappings are configuration/adapters on top of VDX. In historical material quoted as evidence, use "HISTORIC TERM: KDX — now VDX"; do not rewrite historical references.

## 7. Evidence versioning (binding source discipline)
No unqualified "EOS currently uses X as authority." Every code-derived finding carries OBSERVED AGAINST: repository / branch / commit SHA (or another exact durable source). A finding from a feature branch is never silently a claim about main; a pre-integration finding is never assumed true after the integrated branch lands. **"A correct code reading from the wrong branch is still a false statement about the product."**
Provenance vocabulary (every meaningful recommendation carries one): OWNER RULING / CURRENT EOS / WORKFLOW REGISTRY / DAY-IN-LIFE / HISTORIC NORTH STAR / USABILITY STUDY / EXPLORATORY MOCKUP / DESIGN INFERENCE / PRODUCT DECISION REQUIRED. Usability package and standalone page concepts are VALUABLE DESIGN INPUT, never automatically approved product behavior; their exact styling/layout/behavior binds only when Atlas adopts it into an approved North Star.

## 8. Dispositions without KEEP bias
KEEP / IMPROVE / REPLACE / REMOVE / ADD / PRODUCT GAP / WORKFLOW GAP / AUTHORITY GAP.
**KEEP** = "after comparison against current workflow, authority, scenarios, usability findings, and current product direction, this remains the best experience." KEEP never means: already built, historically approved, expensive to replace, familiar, easiest to implement, or "existing component available." REPLACE is legitimate whenever current evidence supports a materially better design. Preserve historical intent without being trapped by it.
Unrecoverable historic sources: classify HISTORICAL ACCEPTANCE EVIDENCE — SOURCE UNAVAILABLE; preserve name, acceptance record, screenshots, derivative docs; never recreate from memory as the original. The new Owner-approved North Star supersedes unrecoverable historical visual authority.

## 9. Fidelity (binding; carries forward §27/A7/A8)
Atlas produces two complementary authorities per surface: the PRODUCT/PROCESS CONTRACT and the EXPERIENCE/VISUAL REFERENCE. Implementation preserves both. A page may pass functional acceptance and fail visual acceptance. Material difference from an approved North Star = APPROVED CHANGE or DEFECT — there is no "implementation interpretation."
Approved reference frames: `<NS2 id>-<width>` (e.g. NS2-SVC-03-1440/-1024/-375), only the widths relevant to the surface; frames survive the handoff; no prose-only handoffs.
**Fidelity loop:** ATLAS → NORTH STAR → OWNER DESIGN ACCEPTANCE → IMPLEMENTATION → FUNCTIONAL VERIFICATION → SAME-VIEWPORT SCREENSHOT → VISUAL COMPARISON (composition, hierarchy, density, proportions, spacing, action placement, responsive transformation, attention prominence, information order, navigation, AI placement, progressive disclosure) → CORRECTION → OWNER VISUAL ACCEPTANCE → FAMILY COMPLETE. Experience fidelity, not pixel-perfection.
**No silent redesign during implementation:** constraint → documented → returned to Atlas/Design → North Star revised → re-approved → implemented.
**Component system serves the design:** reuse where it reproduces the experience; modify/create where the approved experience requires it; promote patterns (Attention Strip, Operational Figure, Work Queue, Record Header, Section Navigation, Context Rail, AI Insight, Exception Banner, Workflow Action Group, Progressive Help) only after genuine repeated use. YAGNI applies; "we already have a Card component" is not permission to flatten a North Star into a card grid.

## 10. Contract
Every surface ships the **35-POINT NORTH STAR PAGE CONTRACT** (07-CONTRACT-TEMPLATE.md). All "33-point" references in earlier artifacts are superseded by this count.
