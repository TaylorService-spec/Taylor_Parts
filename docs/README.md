# Repository Documentation

This is the front door to this repository's documentation. Start here — it maps every governance document to what it's for, so a new developer or a future AI session doesn't have to rediscover the structure.

If you're implementing a new feature, read `CLAUDE_CONTEXT.md`'s "Product Authorities" section first — it lists the order to consult Product vs. Architecture documents in.

## Product

Defines **why** the platform exists and how users are meant to interact with it.

- [ProductVision.md](ProductVision.md) — mission, long-term business-domain scope, multi-tenant/configurable-platform principle.
- [PlatformConstitution.md](PlatformConstitution.md) — the ten platform-wide product principles.
- [PlatformCapabilityModel.md](PlatformCapabilityModel.md) — foundational governance document defining the platform by business capability (not screen or entity): capability hierarchy, maturity model (Level 1–5), and the capability-first AI development workflow.
- [DeploymentModeStrategy.md](DeploymentModeStrategy.md) — foundational governance document defining how the platform is deployed across organizations (Development/Demo/Managed Hosted/Enterprise Integration modes) without forking code; tenant, configuration, data-ownership, and integration expectations.
- [PlatformOperatingModel.md](PlatformOperatingModel.md) — foundational governance document defining how the platform is operated, governed, and evolved over time: governance responsibilities, Product/Architecture ownership, release/change/configuration management, customer onboarding lifecycle, versioning philosophy, AI-assisted development workflow.
- [IntegrationArchitecture.md](IntegrationArchitecture.md) — foundational governance document defining how the platform integrates with external systems (ERP/BI/Snowflake/Accounting/CRM/AI) while preserving system boundaries: operational-vs-analytical systems, supported integration patterns, import/export strategy, API philosophy, customer-owned integrations. Fourth and final planned governance artifact.
- [ProductBlueprint.md](ProductBlueprint.md) — approved business-domain navigation, business objects, role-based navigation philosophy.
- [GuidingPrinciples.md](GuidingPrinciples.md) — concrete UX/product working principles.
- [MobileStrategy.md](MobileStrategy.md) — multi-experience (desktop/technician mobile/warehouse mobile) and PWA strategy.

## Architecture

Defines **how** the platform is implemented.

- [Architecture.md](Architecture.md) — stack overview (React/Vite, Firestore, Firebase Auth), hosting model.
- [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) — authoritative system design: system of record, canonical enums, write-path rules, relationship to Product governance.
- [architecture/SYSTEM_AUTHORITIES.md](architecture/SYSTEM_AUTHORITIES.md) — table-form "who owns what" map, both Product and Architecture authorities.
- [architecture/ADR-002-work-order-engine.md](architecture/ADR-002-work-order-engine.md) — Work Order Engine design decision.
- [architecture/ADR-003-inventory-trigger-system.md](architecture/ADR-003-inventory-trigger-system.md) — ledger-based inventory design decision.
- [architecture/ADR-004-technician-recommendation-engine.md](architecture/ADR-004-technician-recommendation-engine.md) — Technician Recommendation Engine (TRE-v1) design decision.
- [DataModel.md](DataModel.md) — the actual, currently-implemented Firestore schema.
- [BusinessEntityModel.md](BusinessEntityModel.md) — the enterprise business object model (Account/Contact/Location/Work Order/etc.), core (Version 2) vs. future entities, and the Firestore collection recommendation that will implement it.
- [FirebaseIntegration.md](FirebaseIntegration.md) — the real Firebase client integration layer (init, sanctioned write functions).
- [FUTURE_ARCHITECTURE_BACKLOG.md](FUTURE_ARCHITECTURE_BACKLOG.md) — known limitations and deliberate simplifications, tracked so they aren't silently forgotten or "fixed" out of turn.
- [design/job-status-transaction-safety.md](design/job-status-transaction-safety.md) — design doc for `updateJobStatus()` transaction safety.

## Development

Working conventions for contributing to this repo (human or AI).

- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — branching, commits, feature lifecycle (Business Need → Product Review → Blueprint → Architecture Review → Implementation → Testing → Release).
- [DevelopmentSetup.md](DevelopmentSetup.md) — prerequisites and local setup steps.
- [Deployment.md](Deployment.md) — the three independent deployment surfaces (GitHub Pages, Firebase, Cloud Functions).
- [CLAUDE_CONTEXT.md](CLAUDE_CONTEXT.md) — AI-session orientation: Product Authorities, non-negotiable rules, verified branch/PR/deployment state, key files, gotchas.

## Roadmaps

What's shipped, what's next, at both the release and sprint level.

- [ROADMAP.md](ROADMAP.md) — forward-looking plan, including the Product Release Roadmap (Version 1–4).
- [SprintRoadmap.md](SprintRoadmap.md) — a 5-phase roadmap annotated against actual current status.
- [SPRINT_STATUS.md](SPRINT_STATUS.md) — point-in-time snapshot of completed/merged sprint work.

## Epics

Feature-level planning documents for major work efforts.

- [epics/EPIC-6-Technician-Execution-Workspace.md](epics/EPIC-6-Technician-Execution-Workspace.md) — technician execution workspace planning doc.
- [epics/INVENTORY-CAPABILITY-EXPANSION-PLAN.md](epics/INVENTORY-CAPABILITY-EXPANSION-PLAN.md) — Release 2.0 Capability Expansion planning doc for the Inventory Management capability (Sprints 2.1.1–2.1.3), traced to `PlatformCapabilityModel.md`.
