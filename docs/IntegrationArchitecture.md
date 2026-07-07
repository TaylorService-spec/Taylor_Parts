# Integration Architecture

Foundational governance document defining how the Enterprise Operations Platform integrates with external systems — ERP, BI/Snowflake, accounting, CRM, AI, and future systems not yet named — while preserving clear system boundaries and long-term maintainability. Where [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) established the *expectation* that integrations consume exported data rather than becoming the operational database, this document defines the *architecture* that expectation is built on: which systems are operational vs. analytical, how data moves between them, and what principles every integration — present or future — must satisfy.

**This is a governance document, not an implementation guide.** It defines *what boundaries integrations must respect* and *what architectural shape they must take* — not specific APIs, endpoints, connector code, or deployment steps. For deployment mechanics, see [`Deployment.md`](Deployment.md); for current write-path implementation, see [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md) and [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md). No code, schema, API surface, or infrastructure change is implied or required by this document on its own.

## 1. Purpose

As the platform matures, external systems — ERP, BI/Snowflake, accounting, CRM, AI, and systems not yet identified — will need to read the platform's operational data, and in some cases feed data back into planning or reporting processes. This document establishes the durable architectural boundary that makes that possible without turning any external system into a second source of truth, without coupling the platform's internal write paths to any one integration's shape, and without requiring a bespoke integration architecture to be invented per external system. It exists so that "can this system connect to the platform, and how" has a standing architectural answer, gated on the deployment-mode and tenant groundwork already laid by [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) and [`PlatformOperatingModel.md`](PlatformOperatingModel.md).

## 2. Guiding Principles

1. **Firestore remains the operational system of record.** No integration, of any kind, introduces a competing operational datastore or becomes an alternate authority for job/technician/Work Order/inventory/customer state. This is unchanged from [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md) and restated as the foundation every principle below builds on.
2. **External systems consume; they do not replace.** ERP, BI, Snowflake, accounting, CRM, and AI systems read exported or synced operational data to do their own job (planning, reporting, compliance, insight) — none of them becomes the operational database, and none of them is authoritative for state Firestore already owns.
3. **Loosely coupled, not tightly wired.** An integration depends on a stable export/interface contract, not on the platform's internal implementation details (collection names, internal document shape, function internals). The platform's internal write paths must be free to evolve without breaking an integration, and an integration's failure or absence must never block or degrade core operational write paths.
4. **Configuration over custom integration logic.** A new integration's connection details (what to export, how often, to where) are expressed as configuration — the same posture [`PlatformConstitution.md`](PlatformConstitution.md)'s "Configurable Platform" principle and [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s Configuration Strategy already establish, extended here to integrations specifically. A one-off custom code path built to satisfy a single external system's quirks is the failure mode this principle exists to prevent.
5. **Customer-specific integrations plug into the platform; they do not modify it.** A customer's particular ERP or BI requirement is satisfied by configuring or extending the integration boundary this document defines — never by forking platform code or adding customer-conditional logic to core write paths (the same standing rule [`PlatformOperatingModel.md`](PlatformOperatingModel.md)'s Configuration Governance section already sets for the platform generally).
6. **Common architecture, not one-off implementations.** Every future integration — ERP, BI, Snowflake, Accounting, CRM, AI, reporting, and anything named later — is expected to be an instance of the same architectural pattern (Sections 6–9), not a bespoke design exercise each time a new external system is proposed.

## 3. Integration Philosophy

Integration is treated as a **boundary concern**, not a feature. A capability doesn't "add an integration" the way it adds a screen; instead, the platform exposes a stable, general-purpose export/import boundary (Sections 8–9), and each integration is a consumer or producer against that boundary. This keeps the number of integration-shaped decisions constant as the number of connected external systems grows — the tenth ERP integration should require the same kind of decision-making as the first, not a new architectural negotiation each time.

Integration work is evaluated by the same standard [`PlatformOperatingModel.md`](PlatformOperatingModel.md) sets for all platform change: long-term maintainability is prioritized over short-term integration speed. An integration that is fast to stand up but couples the platform to one external system's specifics is not an acceptable trade.

## 4. System Boundaries

- **The platform's boundary is the export/import interface defined in Sections 8–9** — not any external system's schema, API, or internal model. Nothing outside the platform dictates the shape of the platform's own operational data.
- **No external system reaches into Firestore directly.** All integration traffic crosses through the platform's own export/import boundary; an ERP, BI tool, or AI system never queries or writes the operational Firestore project directly. (The specific transport — API, file export, event stream, etc. — is deliberately not chosen here; see Section 10.)
- **The boundary is bidirectional in principle but asymmetric in authority**: data can flow out (export, Section 9) more freely than it flows in (import, Section 8), because inbound data must never be trusted as automatically authoritative — see Section 7.

## 5. Operational vs. Analytical Systems

- **Operational systems** are systems the platform's core business processes depend on to function correctly *right now* — today, this is Firestore alone (jobs, technicians, Work Orders, inventory, customers). An operational system's data must be current, consistent, and rules-enforced.
- **Analytical systems** are systems that consume operational data to produce insight, reporting, forecasting, or compliance records after the fact — ERP, BI/Snowflake, accounting, and AI/reporting tools all fall here. An analytical system's data can lag the operational system (eventual consistency is acceptable) and its unavailability must never block an operational workflow.
- **This distinction is the architectural reason integrations never become the system of record**: an analytical system, by definition, is downstream of operational truth, not a peer to it. A proposal that would make an external system's data required for an operational workflow to proceed has effectively reclassified it as operational, and must be rejected or re-scoped rather than allowed to blur the line.

## 6. Supported Integration Patterns

These patterns are the platform's general-purpose integration vocabulary — a way of describing what shape a given integration takes, not a commitment that all are built today (see Section 16 for current state):

| Pattern | Direction | Typical use |
|---|---|---|
| **Export / Extract** | Platform → external system | BI/Snowflake ingestion, accounting/ERP sync, reporting extracts. |
| **Import / Ingest** | External system → platform | Reference/master data brought in from an external system of origin (e.g. a customer's existing ERP as the source of certain reference data). |
| **Event Notification** | Platform → external system | Notifying an external system that something happened, without that system being able to act back on the platform's operational state (see Section 11). |
| **Customer-Hosted Agent** | Bidirectional, customer-operated | A customer-operated intermediary that mediates between the platform's boundary and the customer's own systems, for Enterprise Integration deployments (see [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s Supported Deployment Modes). |

Every concrete integration (a specific ERP, a specific BI tool) is expected to be describable as one or more of these patterns, not as a new pattern invented for that integration alone.

## 7. Data Ownership Across Systems

- **Firestore owns operational data.** Any copy of that data that exists in an external system (a BI warehouse, an ERP mirror, an accounting ledger sync) is a **derived copy**, not a second original. The derived copy's staleness relative to Firestore is an expected, accepted property of an analytical system (Section 5), not a defect to be engineered away by making the copy authoritative.
- **External systems own their own native data.** An ERP's purchasing workflow state, an accounting system's ledger entries, a CRM's pipeline data — these remain owned by their respective systems. The platform does not attempt to become the system of record for a concern that legitimately belongs to an external system's own domain (e.g. this platform does not become the accounting ledger of record just because it exports Work Order cost data to one).
- **Imported reference data is owned by its origin system until the platform's domain layer takes custody of it.** If an external system's data is imported (Section 8), the platform's existing single-write-path rules ([`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md), [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md)) govern it identically to any other Firestore-resident data from that point forward — an import does not create a second, parallel write path for that data.

## 8. Import Strategy

- Data entering the platform from an external system is treated as **untrusted input until validated against the platform's existing domain rules** — the same posture applied to any external input, per [`PlatformConstitution.md`](PlatformConstitution.md). An import is never granted a bypass of the write-path rules that would otherwise govern the data it's populating.
- Imported data never creates a second, competing write path for data an existing Cloud Function or domain module already owns (Rule 6, [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md)) — an import populates or updates through the same sanctioned path, or is rejected as out of scope until that path is extended to accommodate it.
- The concrete import mechanism (file upload, scheduled pull, real-time API, customer-hosted agent per Section 6) is deliberately not specified here — that is implementation-level design, gated behind a specific integration being approved through the governance process [`PlatformOperatingModel.md`](PlatformOperatingModel.md) already defines.

## 9. Export Strategy

- Operational data leaves the platform through an **export boundary that is additive and read-oriented**: producing a copy for an external system to consume never mutates the operational data being exported, and export failures never roll back or block the operational write that produced the data being exported.
- Exports are **the primary, expected direction of integration traffic** (Guiding Principle 2) — BI/Snowflake, accounting, and reporting integrations are expected to be satisfied primarily through export, with import (Section 8) reserved for cases where the platform genuinely needs to bring external reference data in.
- The concrete export mechanism (batch, streaming, event-driven, file-based) is deliberately not chosen here, for the same reason import mechanics aren't chosen in Section 8 — this document defines the strategy's shape and constraints, not its implementation.

## 10. API Philosophy

- Any API surface the platform exposes for integration purposes is a **contract with external consumers, not an extension of internal implementation**. It should be designed to remain stable even as the platform's internal write paths, entity model, or Cloud Functions evolve — internal refactors must not be integration-breaking changes.
- No specific API shape, protocol, versioning scheme, or endpoint is defined in this document. Those are implementation decisions that follow from this document's principles, made when a concrete integration is actually being designed, not decided speculatively here.
- An integration-facing API is additive to, and separate from, the platform's internal client-service layer (`services/*.ts` per [`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md)) — it is never the same surface, so that internal service evolution and external API stability are not forced into lockstep.

## 11. Event-Driven Architecture Considerations

- An event-driven mechanism (an event bus, webhooks, pub/sub) is one possible transport for the Event Notification pattern (Section 6) — named here as a future architectural option, not adopted or designed in this document.
- **No event-driven mechanism may become a second write path.** An event consumed by the platform can trigger validation and entry through an existing sanctioned write path (Section 8); it can never write Firestore state directly, bypassing the domain/Cloud-Function layer that already owns that state (restated from Rule 6, [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md), applied to a hypothetical future mechanism rather than existing code).
- Adopting any event-driven mechanism is future architecture work, to be designed and governed when a concrete need for it exists — this document only states the constraint such a mechanism must satisfy if and when it's built.

## 12. Authentication and Security Boundaries

- Every integration crosses a security boundary: an external system authenticates to the platform (or vice versa) using credentials scoped narrowly to the integration's actual need, never using the same credentials or trust level as an internal admin/dispatcher/technician user session.
- The platform's existing Firebase Auth model and Firestore rules enforcement ([`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md)) are not weakened or bypassed for the sake of an integration. No integration is granted a client-side exception to rules that would otherwise deny direct writes — the same standing constraint already applied to Admin-SDK-only write paths (Rule 10, [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md)) extends to any future integration credential.
- The specific authentication mechanism (API keys, OAuth, service-account credentials, customer-hosted-agent identity) is an implementation decision for a specific integration's design, not specified in this document.

## 13. AI Integration Strategy

- AI systems that consume the platform's operational data (for reporting, prediction, or recommendation) are governed by the same Operational vs. Analytical distinction as any other integration (Section 5): an AI system informs decisions, it does not become an operational write authority.
- This is architecturally distinct from the platform's own internal AI Platform capability ([`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s AI Platform capability, e.g. the Technician Recommendation Engine) — an internal, deterministic scoring module that is part of the platform's own domain layer is not "an integration" in this document's sense, even though both are AI-adjacent. This document governs AI systems *external* to the platform; internal AI/scoring capability maturity remains owned by `PlatformCapabilityModel.md`.
- An external AI system that would need to write back into operational state (e.g. an AI system proposing a Work Order transition) must do so through the platform's existing sanctioned write paths, exactly as any other external system would (Section 8) — it receives no special bypass for being AI-driven.

## 14. Customer-Owned Integrations

- A customer operating an Enterprise Integration deployment (per [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s Supported Deployment Modes) may connect their own ERP, BI, or accounting systems to a hosted platform instance via the Customer-Hosted Agent pattern (Section 6).
- **Customer-specific integration needs plug into the platform; they do not modify it.** A customer's particular connector, mapping, or schedule is configuration and/or a customer-operated agent living outside the platform's own codebase — never a customer-specific branch, fork, or conditional code path inside the platform (Guiding Principle 5, and consistent with [`PlatformOperatingModel.md`](PlatformOperatingModel.md)'s Configuration Governance).
- Responsibility for a customer-hosted agent's operation, credentials, and maintenance belongs to the customer (in partnership with the platform operator, per [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)'s mode definition) — the platform's obligation is to expose a stable, documented boundary (Sections 8–10), not to operate the customer's own integration infrastructure.

## 15. Future Integration Expansion

- ERP, BI/Snowflake, Accounting, CRM, AI, and reporting integrations are all expected to be **instances of the same architecture** defined in this document (Sections 4–13), not individually-designed systems. A new integration proposal should be evaluated first against "which supported pattern (Section 6) does this fit," not designed from a blank slate.
- A named future integration that doesn't fit any pattern in Section 6, or that would require violating a guiding principle in Section 2 to work, is a signal to revisit this document's architecture deliberately (per [`PlatformOperatingModel.md`](PlatformOperatingModel.md)'s Documentation Governance section) — not a signal to build a one-off exception silently.
- No specific integration (a named ERP vendor, a named BI tool) is committed to, scheduled, or designed in this document. This document defines the architecture any of them would need to conform to, whenever one is actually proposed.

## 16. Relationship to Other Governance Documents

- **[`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md)** — the authoritative statement that Firestore is the system of record lives there; this document's Guiding Principles and System Boundaries sections defer to it rather than restating it.
- **[`DeploymentModeStrategy.md`](DeploymentModeStrategy.md)** — that document established the expectation that integrations consume exported data (its Section 7, Integration Expectations) and explicitly deferred the concrete mechanism to this document. This document fulfills that forward reference; it does not redefine deployment modes, tenant strategy, or data ownership at the deployment level, all of which remain owned there.
- **[`PlatformOperatingModel.md`](PlatformOperatingModel.md)** — this document's governance-first change process (Section 15) and configuration-over-customization posture (Sections 2, 14) both apply that document's Change Management and Configuration Governance sections to integrations specifically, rather than redefining them.
- **[`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)** — the Integration Platform capability (currently Level 1, conceptual) is the capability this document's architecture belongs to; capability maturity for it is tracked there, not here. Section 13 (AI Integration Strategy) explicitly distinguishes this document's scope from that document's AI Platform capability, which governs the platform's own internal AI/scoring modules, not external integrations.
- **[`architecture/SYSTEM_AUTHORITIES.md`](architecture/SYSTEM_AUTHORITIES.md)** — the code-level "who owns what" map for the platform's actual write paths; this document's Import Strategy and Event-Driven Architecture sections both defer to it rather than re-deriving which write paths exist.
- **[`BusinessEntityModel.md`](BusinessEntityModel.md)** — any future entity introduced specifically to support integration (e.g. an integration-configuration entity) would be modeled there; this document does not define entities or schema.
- No further planned governance companion exists beyond this document — see [`ROADMAP.md`](ROADMAP.md)'s "Planned governance documents" section, where this is the fourth and final artifact in that list.

## 17. Status

This document is a **foundational governance artifact**, the fourth and final document in the governance roadmap begun by [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) and continued by [`DeploymentModeStrategy.md`](DeploymentModeStrategy.md) and [`PlatformOperatingModel.md`](PlatformOperatingModel.md) — see [`ROADMAP.md`](ROADMAP.md)'s "Planned governance documents" section. No integration described here (ERP, BI/Snowflake, accounting, CRM, AI, event bus) is implemented, scheduled, or designed at the code level as of this writing; this document establishes the architecture any future integration must conform to, not a build plan.
