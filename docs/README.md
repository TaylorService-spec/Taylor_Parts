# Repository Documentation

This is the front door to this repository's documentation. Start here — it maps every governance document to what it's for, so a new developer or a future AI session doesn't have to rediscover the structure.

If you're implementing a new feature, read `CLAUDE_CONTEXT.md`'s "Product Authorities" section first — it lists the order to consult Product vs. Architecture documents in.

## How to read this index — artifact classification

A document in this repository is one of five things. **Check the classification before treating any statement as current fact.** This distinction exists because several documents here describe target architecture in the present tense; the Program 0 truth pass ([`reviews/eao-program-0-truth-pass.md`](reviews/eao-program-0-truth-pass.md)) corrected the worst cases and established this legend.

| Class | Meaning | How to treat it |
|---|---|---|
| **AUTHORITATIVE** | The current, governing statement for its concern. | Binding. Update it in the same change that alters what it governs. |
| **FUTURE-STATE ARCHITECTURE** | Approved target design that is **not implemented**. | Do not cite as a description of how the system behaves today. |
| **HISTORICAL SNAPSHOT** | Accurate as of a stated commit/date; not maintained. | Read for history. Never as current state. Do not rewrite to look current. |
| **SUPERSEDED** | Replaced by a named successor, retained for provenance. | Follow the successor. |
| **EVIDENCE** | Immutable run artifacts (hashes, exports, attestations). | Never modified after generation. |

**Implemented capability** is a separate axis, tracked in [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s implementation-state table — not in this index.

## Product

Defines **why** the platform exists and how users are meant to interact with it.

- [ProductVision.md](ProductVision.md) — **AUTHORITATIVE.** Mission, long-term business-domain scope, multi-operating-company design objective.
- [PlatformConstitution.md](PlatformConstitution.md) — **AUTHORITATIVE.** The ten platform-wide product principles.
- [PlatformCapabilityModel.md](PlatformCapabilityModel.md) — **AUTHORITATIVE.** The platform defined by business capability (not screen or entity): capability hierarchy, the Level 1–5 maturity model, the **implementation-state table** (designed → operationally verified → platformized), and the capability-first AI development workflow.
- [DeploymentModeStrategy.md](DeploymentModeStrategy.md) — **AUTHORITATIVE** for mode vocabulary; its multi-company tenant model is **FUTURE-STATE ARCHITECTURE**. Development/Demo/Managed Hosted/Enterprise Integration modes; tenant, configuration, data-ownership, and integration expectations.
- [PlatformOperatingModel.md](PlatformOperatingModel.md) — **AUTHORITATIVE.** Governance responsibilities, Product/Architecture ownership, release/change/configuration management, customer onboarding lifecycle, versioning philosophy.
- [IntegrationArchitecture.md](IntegrationArchitecture.md) — **FUTURE-STATE ARCHITECTURE.** No integration, export, event, or API surface is implemented today. Defines the boundary every future integration must satisfy.
- [ProductBlueprint.md](ProductBlueprint.md) — **AUTHORITATIVE.** Approved business-domain navigation, business objects, role-based navigation philosophy.
- [GuidingPrinciples.md](GuidingPrinciples.md) — **AUTHORITATIVE.** Concrete UX/product working principles.
- [MobileStrategy.md](MobileStrategy.md) — **AUTHORITATIVE.** Multi-experience (desktop/technician mobile/warehouse mobile) and PWA strategy.

## Architecture

Defines **how** the platform is implemented.

- [Architecture.md](Architecture.md) — stack overview (React/Vite, Firestore, Firebase Auth), hosting model.
- [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) — **AUTHORITATIVE.** System of record, canonical enums, write-path rules, Enterprise Platform Classification Model, Person Assignment Platform Service Standard.
- [architecture/SYSTEM_AUTHORITIES.md](architecture/SYSTEM_AUTHORITIES.md) — **AUTHORITATIVE.** Table-form "who owns what" map, both Product and Architecture authorities.
- [DataModel.md](DataModel.md) — the currently-implemented Firestore schema.
- [BusinessEntityModel.md](BusinessEntityModel.md) — the enterprise business object model, core (Version 2) vs. future entities.
- [FirebaseIntegration.md](FirebaseIntegration.md) — the real Firebase client integration layer (init, sanctioned write functions).
- [architecture/enterprise-business-metrics-framework.md](architecture/enterprise-business-metrics-framework.md) — **AUTHORITATIVE** (Accepted) for revenue-lifecycle terminology and financial ownership rules. Acceptance authorizes no implementation.
- [architecture/customer-domain-foundation.md](architecture/customer-domain-foundation.md) · [architecture/inventory-parts-authority-contract.md](architecture/inventory-parts-authority-contract.md) · [architecture/equipment-part-compatibility.md](architecture/equipment-part-compatibility.md) — domain architecture contracts.
- [FUTURE_ARCHITECTURE_BACKLOG.md](FUTURE_ARCHITECTURE_BACKLOG.md) — known limitations and deliberate simplifications.
- [design/](design/) — design docs: [job-status-transaction-safety.md](design/job-status-transaction-safety.md), [creation-and-page-formatting-design-reference.md](design/creation-and-page-formatting-design-reference.md).

### Architecture Decision Records

- [ADR-001](architecture/ADR-001-retired-operational-core-branch.md) — retired operational-core branch.
- [ADR-002](architecture/ADR-002-work-order-engine.md) — Work Order Engine.
- [ADR-003](architecture/ADR-003-inventory-trigger-system.md) — ledger-based inventory.
- [ADR-004](architecture/ADR-004-technician-recommendation-engine.md) — Technician Recommendation Engine (TRE-v1).
- [ADR-005](architecture/ADR-005-enterprise-authorization-migration-strategy.md) — enterprise authorization migration strategy.
- [ADR-006](architecture/ADR-006-equipment-and-installed-asset-management.md) — Equipment and installed-asset management.
- [ADR-007](architecture/ADR-007-governed-object-based-report-creator.md) — governed object-based report creator.
- [ADR-008](architecture/ADR-008-part-master.md) — Part Master.
- [ADR-009](architecture/ADR-009-business-operations-through-application.md) — business operations through the application.
- [ADR-010](architecture/ADR-010-equipment-custody-and-available-inventory.md) — equipment custody and available inventory.
- [ADR-011](architecture/ADR-011-environment-configuration-architecture.md) — environment configuration architecture (one registry for environment identity, readiness, and the project allow-list).

## Development

Working conventions for contributing to this repo (human or AI).

- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — branching, commits, feature lifecycle.
- [DevelopmentSetup.md](DevelopmentSetup.md) — prerequisites and local setup steps.
- [Deployment.md](Deployment.md) — **AUTHORITATIVE.** The deployment surfaces, what each one actually publishes, what is manual, and the recorded unknowns.
- [CLAUDE_CONTEXT.md](CLAUDE_CONTEXT.md) — **HISTORICAL SNAPSHOT + working aid.** Cold-start orientation and the non-negotiable rules. Its branch/PR/deployment narratives are point-in-time and heavily accreted; re-verify with `gh`/`git` before trusting any status line. Not a governance authority (per [`PlatformOperatingModel.md`](PlatformOperatingModel.md) §13).
- [DelegationCharter.md](DelegationCharter.md) — **AUTHORITATIVE.** Tier 1/2/3 decision authority and §8 the default-autonomy operating mode. Read before touching code in a new session.
- [engineering/AI_ENGINEERING_OPERATING_MODEL.md](engineering/AI_ENGINEERING_OPERATING_MODEL.md) — **AUTHORITATIVE.** Capability-level delivery, the DESIGNED→…→RETIRED promotion lifecycle, the multi-agent model, the baseline/worktree guard, and cost discipline.
- [engineering/ACTIVE_WORKSTREAMS.md](engineering/ACTIVE_WORKSTREAMS.md) — **AUTHORITATIVE.** The single live registry of who is actively writing where.
- [OWNERSHIP.md](OWNERSHIP.md) — **AUTHORITATIVE.** Human/company and IP ownership + AI-attribution posture. See also the root [`README.md`](../README.md) and [`LICENSE`](../LICENSE).
- [DECISIONS.md](DECISIONS.md) — **AUTHORITATIVE.** Append-only log of Tier 1 decisions. Read alongside the active workstream registry at the start of every session.

## Governance and evidence

- [governance/audit-artifact-standard.md](governance/audit-artifact-standard.md) — **AUTHORITATIVE.** The required shape of run evidence (hashing, sanitization, immutability).
- [governance/execution-environments.md](governance/execution-environments.md) — **AUTHORITATIVE.** Which environment a given command class may run against.
- [governance/privileged-approval-classification.md](governance/privileged-approval-classification.md) — **AUTHORITATIVE.** Which grants need one approver vs. two.
- [governance/ecf-reconciliation-plan.md](governance/ecf-reconciliation-plan.md) — **AUTHORITATIVE** plan for the accepted RECONCILE-THEN-ACTIVATE disposition of ECF (proposed baseline `c002b5e`). Not an activation.
- [governance/ENTERPRISE_CERTIFICATION_FRAMEWORK.md](governance/ENTERPRISE_CERTIFICATION_FRAMEWORK.md) — **NOT ACTIVATED.** Baseline v1.0 names three core artifacts (Certification Matrix, Recommendation Register, Certification History); none exist. See [`reviews/eao-program-0-truth-pass.md`](reviews/eao-program-0-truth-pass.md) for the disposition recommendation.
- [governance/templates/operational-handoff.md](governance/templates/operational-handoff.md) — handoff template.
- [audits/](audits/) — **EVIDENCE.** Immutable run artifacts. Never edited after generation.
- [assessments/sandbox-integration-environment-readiness.md](assessments/sandbox-integration-environment-readiness.md) - **AWAITING OWNER DECISION.** Sandbox/Integration sequencing assessment + design readiness: what the current product needs to be reviewable outside production, the configuration coupling that blocks it, and the infrastructure/spend decisions required.
- [deployment/sandbox-o1-o2-authorization-package.md](deployment/sandbox-o1-o2-authorization-package.md) - **AWAITING OWNER AUTHORIZATION.** O-1/O-2 sandbox infrastructure + spend: project identity, services, personas, scenario packs, rebuild automation, cost ($0/month within Blaze no-cost quotas), and the 9 protected actions.
- [deployment/c3-p5-restore-rehearsal-package.md](deployment/c3-p5-restore-rehearsal-package.md) - **AWAITING OWNER AUTHORIZATION.** P5 restore rehearsal: two paths (PITR clone available now; backup restore after V2), exact commands, RTO measurement, cleanup safety.
- [design/c3-delivery-reliability-and-release-visibility.md](design/c3-delivery-reliability-and-release-visibility.md) - C3 delivery reliability and release visibility.
- [specifications/sandbox-persona-authorization-matrix.md](specifications/sandbox-persona-authorization-matrix.md) - the single sandbox persona authorization matrix (v1, evidence-based): 7 personas verified by real client sign-in, plus the structural gaps blocking the fuller model.
- [specifications/r1-rows-23-24-permission-cutover.md](specifications/r1-rows-23-24-permission-cutover.md) - R-1 Rows 23/24 permission cutover specification.
- [deployment/c3-firestore-data-protection-decision-package.md](deployment/c3-firestore-data-protection-decision-package.md) — **AWAITING OWNER AUTHORIZATION.** C3 production decision package: current posture (no PITR, no backups, no delete protection, 1-hour recoverable history), target posture, exact protected commands, verification plan, rollback.
- [assessments/r1-permission-coverage-design.md](assessments/r1-permission-coverage-design.md) — R-1 permission design for the 15 uncovered collections (5 new permissions, not 15).
- [operations/authorization-cutover-rollback.md](operations/authorization-cutover-rollback.md) — ADR-005 §2.7 criterion 11 rollback procedure.
- [operations/](operations/) — runbooks and operator handoffs for governed, credentialed procedures. Currently open: [operations/eao-readonly-evidence-package.md](operations/eao-readonly-evidence-package.md) (bundled read-only evidence run, resolves U-1…U-6) and [operations/local-checkout-and-worktree-reconciliation.md](operations/local-checkout-and-worktree-reconciliation.md) (preservation task — nothing deleted pending attribution).
- [deployment/](deployment/) — per-program deployment authorization and verification packages.

## Working artifacts (AI-SDLC)

Per-workstream artifacts produced by [`ai/workflow.md`](ai/workflow.md). Templates live in [`ai/templates/`](ai/templates/).

- [ai/](ai/) — the AI-SDLC operating manual: [workflow.md](ai/workflow.md), [claude-code.md](ai/claude-code.md), [chatgpt.md](ai/chatgpt.md), [codex.md](ai/codex.md).
- [assessments/](assessments/) — repository assessments (what exists, what it would take).
- [specifications/](specifications/) — approved implementation specifications.
- [implementation-plans/](implementation-plans/) — PR-level breakdowns.
- [reviews/](reviews/) — architecture reviews and program execution records.
- Current EAO programs: [assessments/r1-authorization-convergence-readiness.md](assessments/r1-authorization-convergence-readiness.md) (**R-1**, readiness against ADR-005 §2.7) · [design/pages-production-promotion-target-state.md](design/pages-production-promotion-target-state.md) (**R-2**, frontend promotion target state).
- [capabilities/](capabilities/) — per-capability maturity plans, traced to [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md). See [capabilities/InventoryManagementPlan.md](capabilities/InventoryManagementPlan.md).
- [epics/](epics/) — feature-level planning for work that doesn't map to a single capability: [EPIC-6](epics/EPIC-6-Technician-Execution-Workspace.md), [EPIC-9](epics/EPIC-9-Platform-Workspace-Framework.md).

## Roadmaps and status

**One authoritative surface per concern.** These four overlap by history; treat them per their class.

| Artifact | Class | Concern |
|---|---|---|
| [specifications/rough-complete-build-blueprint.md](specifications/rough-complete-build-blueprint.md) | **AUTHORITATIVE** | The current build program (waves W0–W6) and its execution model. |
| [roadmaps/roadmap-reconciliation-2026-07.md](roadmaps/roadmap-reconciliation-2026-07.md) | **AUTHORITATIVE** (as of its stated baseline) | The reconciled capability-and-dependency roadmap that supersedes the two below. |
| [ROADMAP.md](ROADMAP.md) | **SUPERSEDED** | Historical release/sprint plan. Self-warns; retained for provenance. |
| [SPRINT_STATUS.md](SPRINT_STATUS.md) | **HISTORICAL SNAPSHOT** | Sprint-by-sprint history. Self-warns; ~139 merges stale at its stamp. |
| [SprintRoadmap.md](SprintRoadmap.md) | **HISTORICAL SNAPSHOT** | An early 5-phase framing, annotated against status at the time. |

## End-user documentation

- [user-guide/](user-guide/) — **AUTHORITATIVE** for end users. Plain-language, role-based, status-tagged task guides. Start at [user-guide/README.md](user-guide/README.md).

## Session state (superseded for active coordination)

- [session-state/](session-state/) — **HISTORICAL SNAPSHOT.** Per-lane delta summaries from the multi-session period (last reconciled 2026-07-28/29). **Active coordination is owned by [`engineering/ACTIVE_WORKSTREAMS.md`](engineering/ACTIVE_WORKSTREAMS.md)**; do not record new in-flight assignments here. Retained as history — see [session-state/README.md](session-state/README.md).
