# Platform Operating Model

Foundational governance document defining how the Enterprise Operations Platform is **operated, governed, maintained, and evolved over time**. Where [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) answers "what can the platform do" and [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) answers "who runs an instance of it," this document answers "who decides what changes, in what order, under what authority, and how does that decision-making stay coherent as the platform and its operating companies grow."

**This is a governance document, not an operations manual or a runbook.** It defines *who is responsible for what kind of decision* and *what process a change must pass through* — not the concrete mechanics of running, deploying, or supporting a live instance. For deployment mechanics, see [`Deployment.md`](Deployment.md); for local setup, see [`DevelopmentSetup.md`](DevelopmentSetup.md); for day-to-day contribution conventions, see [`DEVELOPMENT_STANDARDS.md`](DEVELOPMENT_STANDARDS.md). No code, schema, configuration, or infrastructure change is implied or required by this document on its own.

## 1. Purpose

As the platform grows — more capabilities, more operating companies, more integrations — decisions about what to build, who approves it, and how it stays consistent cannot be re-litigated from scratch each time. This document establishes the platform's **standing governance model**: a durable answer to "who is responsible for this kind of decision" and "what must be true before a change is made," so that growth doesn't erode the coherence the platform's other governance documents already establish. It exists to keep Product, Architecture, and Implementation from drifting apart as more people and more organizations touch the platform.

## 2. Operating Principles

1. **Governed through documented authorities.** Every category of decision — product direction, architecture, entity model, capability maturity, deployment mode, navigation — has a named document that is the authority for it. A decision is not "settled" until it is reflected in the document that owns that concern. See Section 3.
2. **Governance documents are the source of truth before implementation.** A change that conflicts with an existing governance document is not implemented as-is; the conflict is resolved in governance first (by updating the document, deliberately and visibly) and only then in code. Code does not silently override governance, and governance is not retrofitted to match code after the fact.
3. **Defined ownership per layer.** Product, Architecture, and Implementation are distinct layers with distinct owners and distinct documents. See Sections 4–6.
4. **Capability-driven, not screen-driven.** Releases and roadmap planning are organized around capability maturity (per [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s maturity model), not around shipping isolated screens or features that don't map to a named capability. See Section 7.
5. **Configuration over customization.** The same preference [`PlatformConstitution.md`](PlatformConstitution.md)'s "Configurable Platform" principle and [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s Configuration Strategy establish for deployment applies to ongoing operation: a new requirement is met by configuring the platform before it is met by writing organization-specific code. See Section 9.
6. **Long-term maintainability over short-term implementation speed.** A decision that is fast today but forecloses the platform's long-term scope or fragments its governance is reconsidered rather than accepted by default — the same standard [`PlatformConstitution.md`](PlatformConstitution.md)'s "Build for the Next Decade" principle already sets, applied here to how the platform is operated and changed, not only how it is architected.

## 3. Governance Responsibilities

| Governance concern | Authority | Layer |
|---|---|---|
| Mission, long-term scope, multi-tenant principle | [`ProductVision.md`](ProductVision.md) | Product |
| Platform-wide product principles | [`PlatformConstitution.md`](PlatformConstitution.md) | Product |
| Business capabilities and maturity | [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) | Product |
| Business-domain navigation, business objects | [`ProductBlueprint.md`](ProductBlueprint.md) | Product |
| Enterprise business object model (entities, relationships) | [`BusinessEntityModel.md`](BusinessEntityModel.md) | Product/Architecture boundary |
| System design, system of record, write-path rules | [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md) | Architecture |
| "Who owns what" code-level map | [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md) | Architecture |
| Deployment modes, tenant/configuration/integration strategy | [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) | Product/Architecture boundary |
| How the platform operates as a business over time (this document) | `PlatformOperatingModel.md` | Governance |
| Contribution conventions (branching, commits, PR discipline) | [`DEVELOPMENT_STANDARDS.md`](DEVELOPMENT_STANDARDS.md) | Implementation |

This table names *which document* is authoritative for a concern; it does not restate what those documents say. If this table and the named document disagree, the named document wins — update this table to match, the same standing rule [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md) already applies to itself.

## 4. Product Ownership

Product ownership — the same role [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md) calls "Product Authority" — answers **why** the platform does something and **whether** it should exist at all. It is exercised through [`ProductVision.md`](ProductVision.md), [`PlatformConstitution.md`](PlatformConstitution.md), [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md), [`ProductBlueprint.md`](ProductBlueprint.md), [`GuidingPrinciples.md`](GuidingPrinciples.md), and [`MobileStrategy.md`](MobileStrategy.md) — the "Product Authorities" set already named in [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md). A request that cannot be located in this set (no capability it advances, no domain it fits) is a signal to pause and place it correctly before treating it as approved scope — not a signal to refuse it outright.

## 5. Architecture Ownership

Architecture ownership — the same role [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md) calls "Architecture Authority" — answers **how** the platform is built to satisfy what Product has approved. It is exercised through [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md), the `docs/architecture/ADR-*.md` decision records, and [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md)'s code-level ownership map. Architecture ownership does not decide *whether* a feature should exist — that is Product's decision — only *how* it is implemented once approved, and whether a proposed implementation conflicts with an existing architectural invariant (a single write path, a frozen analytics contract, a read-only reporting layer, etc.).

## 6. Documentation Governance

- Every governance document has a single owner concern and is not duplicated by another document. Where two documents relate, the newer or narrower one defers to and cross-references the other rather than restating its content — the same pattern [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) and [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) already follow.
- A governance document is updated **in the same change** that alters the thing it governs — not after the fact, not "eventually." [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md) already states this rule for itself; this document generalizes it to every governance document listed in Section 3.
- Cross-references (README index, ROADMAP entries, related-documents lines) are updated wherever a new governance document is added, so the documentation set stays navigable without requiring prior conversation history to locate anything.
- A doc's claims about live system state (deploy status, merged PRs, branch state) are snapshots, not standing fact — see [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md)'s "Standing operating rule: verify, don't assume" for why every session re-verifies rather than trusting a prior doc's snapshot. This document is itself subject to that rule.

## 7. Release Management

- **Releases are capability-driven, not screen-driven.** A release is planned and described in terms of which capabilities (from [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)) move from one maturity level to another — e.g. "Dispatch Management: Level 3 → 4" — not as an unordered bundle of screens or tickets that happen to land in the same window. This is [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s own "Release Planning" section, restated here as a standing operating principle rather than a capability-document footnote.
- Sprint-level and epic-level implementation work (tracked in [`ROADMAP.md`](ROADMAP.md) and [`SPRINT_STATUS.md`](SPRINT_STATUS.md)) is how a capability-maturity release is actually delivered — this document governs the *planning frame*, not the sprint mechanics themselves.
- Every capability progresses independently; there is no platform-wide version number that all capabilities must advance in lockstep with (restated from [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s Maturity Model section, not re-derived here).

## 8. Change Management

- A proposed change is checked against the governance documents in Section 3 **before** implementation begins, in the order [`DEVELOPMENT_STANDARDS.md`](DEVELOPMENT_STANDARDS.md)'s Feature Lifecycle already establishes (Business Need → Product Review → Blueprint → Architecture Review → Implementation → Testing → Release).
- A change that conflicts with a governance document is not implemented around the conflict. The conflict is surfaced and the governing document is either upheld (the change is adjusted) or deliberately amended (the document is updated, visibly, as part of the same body of work) — never silently bypassed.
- Two rejected framings recorded in [`ROADMAP.md`](ROADMAP.md) and [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md) (a Cloud-Functions-deployment plan, then a client-direct-write rebuild, both proposed as fixes for the Work Order creation blocker) are the concrete precedent for this principle: both were caught and stopped before implementation because they conflicted with longer-term governance (the Blaze-plan standing decision, and the multi-operating-company/integration vision respectively), not because the code itself was wrong.

## 9. Configuration Governance

- **Configuration is preferred over customization.** A new operating company's requirements, a new deployment mode's needs, or a new organization-specific business rule are met by configuring the platform, not by writing code conditioned on which organization or environment is running ("if Taylor Parts, do X" is not an acceptable pattern — restated from [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s Configuration Strategy, which this document does not repeat further).
- Where a genuine capability gap exists that configuration cannot address, the correct escalation is a Product Review (Section 4) to decide whether the capability itself should grow — not a one-off customization that bypasses governance.
- The concrete mechanism for storing/reading configuration is an architecture concern (see Section 5), not decided in this document.

## 10. Customer Onboarding Lifecycle

- Onboarding a new operating company is expected to be a **configuration exercise carried out within an existing deployment mode** (see [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s Supported Deployment Modes and Tenant Strategy sections) — not a new codebase, fork, or bespoke engineering effort per customer.
- **Taylor Parts is the platform's first operating company**, onboarded as the platform itself was built, and remains the reference deployment other operating companies' onboarding will be measured against.
- The concrete onboarding steps (provisioning an instance, assigning a deployment mode, attaching integrations) are operational procedure, not governance, and are explicitly out of scope for this document — see [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s Section 8 (Deployment Lifecycle), which already defers that same procedural detail onward. Neither document specifies the mechanism; a future operations-focused artifact, not yet named on the governance roadmap, would be where that procedure belongs if and when it needs to exist.

## 11. Versioning Philosophy

- The platform is versioned at the **Product Release** level (Version 1–4, per [`ROADMAP.md`](ROADMAP.md)'s Product Release Roadmap), expressing platform-wide milestones in business terms ("Platform Foundation," "Platform Experience," "Enterprise Operations," "Enterprise Intelligence") — not at the level of individual capability maturity, which advances independently per Section 7.
- Sprint/epic numbering (`ROADMAP.md`'s sprint breakdown, `SPRINT_STATUS.md`) is an implementation-tracking convention nested under a Product Release; it is not itself a governance-level version and does not need to align 1:1 with capability maturity changes.
- This document does not introduce a new versioning scheme. It states which existing one (`ROADMAP.md`'s Product Release Roadmap) is authoritative, so a future proposal for versioning doesn't reinvent one from scratch.

## 12. Support and Maintenance Model

- Maintenance work (bug fixes, dependency upkeep, documentation sync) follows the same governance and change-management path as new capability work (Section 8) — a maintenance change is not exempt from Product/Architecture Review merely because it is small, though the review may be proportionally lighter for a well-contained fix.
- Long-term maintainability is prioritized over short-term implementation speed: a maintenance fix that would create a second write path, a competing implementation, or a governance-document conflict to save time is not an acceptable trade — the same standard applied to new-feature work in Section 8 applies equally here.
- This document does not define incident response, SLAs, or customer support procedures. Those are operational concerns for a future operations-focused artifact, not this governance document.

## 13. AI-Assisted Development Workflow

- AI-assisted sessions (Claude Code or otherwise) follow the same governance authority chain as human contributors: Product Vision → Platform Capability → Business Entity → Architecture → Implementation Plan → Code → Review, as already established in [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s "AI Development Workflow" section. This document does not restate that workflow's steps, only affirms that it is the standing model for how AI-assisted changes are planned and traced.
- An AI session's context documents ([`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md), [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md)) are working aids for locating the governing authority quickly — they are not themselves a governance authority and defer to the documents named in Section 3 when the two disagree.
- The standing verification discipline in [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md) ("verify, don't assume" — live PR/branch/deploy state, doc paths that actually exist) applies to every AI-assisted change made under this operating model, not only to the session that first wrote that rule.

## 14. Relationship to Other Governance Documents

- **[`ProductVision.md`](ProductVision.md)** / **[`PlatformConstitution.md`](PlatformConstitution.md)** — this document operationalizes their principles (multi-tenant, configurable platform, build-for-the-decade) into standing governance process; it does not restate the principles themselves.
- **[`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)** — this document's Release Management section (7) and AI-Assisted Development Workflow section (13) both point back to that document as the authority for capability maturity and the AI development sequence, rather than duplicating either.
- **[`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)** — this document is the planned "next companion" that document's own Section 10 named; Customer Onboarding Lifecycle (Section 10 above) and Configuration Governance (Section 9 above) fulfill that forward reference without redefining deployment modes, tenant strategy, or the export/integration boundary, all of which remain owned there.
- **[`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md)** — this document's Governance Responsibilities table (Section 3) is a governance-layer complement to that document's code-level ownership map; the two do not compete, and this document's table explicitly defers to the code-level map for architecture-concern detail.
- **[`DEVELOPMENT_STANDARDS.md`](DEVELOPMENT_STANDARDS.md)** — this document's Change Management section (8) references that document's Feature Lifecycle rather than redefining it.
- **`IntegrationArchitecture.md`** *(planned, not yet written)* — will define the concrete export/integration mechanism [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) named the expectation for. This document does not begin or anticipate that document's content.

## 15. Status

This document is a **foundational governance artifact**, the third of four planned governance documents in the roadmap begun by [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) and continued by [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) — see [`ROADMAP.md`](ROADMAP.md)'s "Planned governance documents" section for authoring order and the status of the remaining document (`IntegrationArchitecture.md`).
