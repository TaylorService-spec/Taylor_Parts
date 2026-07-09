# Deployment Mode Strategy

Foundational governance document defining how the Enterprise Operations Platform can be deployed across different organizations **without changing the core product**. Where [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) answers "what can the platform do," this document answers "who runs an instance of it, and how does that instance differ from any other, without forking code."

**This is a governance document, not an implementation or operations manual.** It defines *what deployment modes exist and the principles that govern them* — not *how* to provision, configure, or deploy an instance. For deployment procedures and mechanics, see [`Deployment.md`](Deployment.md) (current hosting surfaces) and [`DevelopmentSetup.md`](DevelopmentSetup.md) (local setup); for the operational "how" of standing up and running an instance across its lifecycle, see [`PlatformOperatingModel.md`](PlatformOperatingModel.md) (Section 10). No code, schema, configuration, or infrastructure change is implied or required by this document on its own.

## 1. Purpose

The platform is built to run for more than one organization. This document defines the durable concept of a **deployment mode** — a named, configuration-driven way the platform can be stood up and operated — so that "which environment is this," "who owns the data," and "how does an integration attach" have a standing answer instead of being re-decided ad hoc for each new organization or each new engineering question. It exists to prevent two failure modes: (1) silently assuming a single deployment shape forever, and (2) solving a temporary constraint (see Section 9) by permanently redesigning the platform around it.

## 2. Guiding Principles

1. **Configuration over forking.** A new organization, or a new environment for an existing organization, is onboarded by configuring the platform — not by branching, forking, or maintaining a customer-specific codebase. This is [`ProductVision.md`](ProductVision.md)'s Multi-Tenant Principle and [`PlatformConstitution.md`](PlatformConstitution.md)'s "Configurable Platform" principle, applied specifically to deployment.
2. **One core product, many operating companies.** The product is the same platform regardless of which organization is running it. Deployment mode governs *how* an instance is hosted, integrated, and operated — never *what* the platform's business logic or entity model is.
3. **Firestore remains the operational system of record in every mode.** No deployment mode introduces a second, competing operational database. See Section 6.
4. **Integrations consume; they do not become the system of record.** External systems (ERP, BI, Snowflake, accounting, etc.) read exported/synced operational data. They never become the authority for operational state that Firestore already owns. See Section 7.
5. **Deployment mode is a first-class, explicit concept.** An instance of the platform should be able to state which mode it is running in, rather than one mode being assumed silently and indefinitely. This document exists specifically because that assumption was identified as a risk (see Section 9).

## 3. Supported Deployment Modes

These four modes are the platform's **current deployment strategy** — the governing vocabulary in effect now, not a future aspiration awaiting adoption. Every present and future deployment decision is expected to be describable in terms of one of these four modes. Not all four have a live instance today (see Section 8 for current state), but the strategy itself is active as of this document, not deferred. Naming a mode here is a decision the platform's engineering should build toward and not foreclose — it is not a permanent, unrevisable limitation: this document can be amended by a future revision if the platform's real-world deployment needs change.

| Mode | Who runs it | Primary purpose |
|---|---|---|
| **Development** | Platform engineering | Local/engineering iteration against the platform's own emulated or sandboxed backend. |
| **Demo** | Platform engineering / sales | A disposable, resettable instance used to demonstrate the platform without touching real operational data. |
| **Managed Hosted** | Platform operator, on behalf of a customer | The platform operator hosts and operates the instance for a customer organization (the initial and current real-world mode — see Section 8). |
| **Enterprise Integration** | Customer's own IT/infrastructure, in partnership with the platform operator | A customer organization with its own integration requirements (ERP, BI/Snowflake, accounting) connects those systems to a hosted instance via the export/integration boundary defined in Section 7, without altering the platform's core write paths. |

Every mode shares the same core product (entity model, capability set, write paths). Modes differ in **who operates the instance, what data is real, and what external systems are attached** — never in the underlying platform logic.

## 4. Tenant Strategy

- **Taylor Parts is the initial deployment** of the platform, and today the only operating company running on it.
- **The platform is designed for multiple operating companies**, not just Taylor Parts. This is a design constraint on every capability and entity, not a currently-active multi-tenant runtime feature — see [`ProductVision.md`](ProductVision.md)'s Multi-Tenant Principle and [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)'s Administration capability (`Company` is a named future entity there).
- A future multi-operating-company model is expected to be addressed as a tenant/`Company` boundary in application data and access control, not as separate deployed codebases or separate repositories per organization. The concrete shape of that boundary (e.g. how `Company` scopes existing collections) is deliberately **not decided in this document** — that is planning work for [`PlatformOperatingModel.md`](PlatformOperatingModel.md) (see Section 10).
- Until that boundary exists, "supporting multiple operating companies" means: no capability, entity, or write path should be built in a way that assumes Taylor Parts is the only organization that will ever use it.

## 5. Configuration Strategy

- Differences between deployments (which mode an instance runs in, which integrations are attached, which organization's data it holds) are expressed as **configuration**, not as code branches or forks.
- This extends the platform's existing internal configuration posture — [`PlatformConstitution.md`](PlatformConstitution.md)'s "Configurable Platform" principle already governs business rules, navigation, and role structures per organization; this document extends the same posture to deployment-level concerns (hosting, integration attachment, environment identity).
- No feature should be implemented as "if Taylor Parts, do X; otherwise do Y." Organization- or mode-specific behavior belongs in configuration data, not in conditional code paths.
- The concrete mechanism for storing and reading deployment configuration (a config document, environment variables, a `Company`-scoped settings collection, etc.) is an implementation detail for future architecture work, not specified here.

## 6. Data Ownership

- **Firestore is the operational system of record** for all job, technician, Work Order, inventory, customer, and related operational state, in every deployment mode. This is unchanged from [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md)'s existing "System of record" section, which this document does not restate or alter.
- Data ownership within a deployment belongs to the operating company whose instance holds it. A Managed Hosted or Enterprise Integration deployment does not change who owns the data — it changes who operates the infrastructure the data lives in.
- No deployment mode introduces a parallel or competing operational datastore. Any exported copy of operational data (Section 7) is downstream and read-oriented — it is never promoted back into an authoritative write path.

## 7. Integration Expectations

- **Future integrations — ERP, BI, Snowflake, accounting, and similar external systems — consume exported operational data. They do not become the operational database.**
- The direction of data flow is one-way for operational authority: Firestore → export → external system. External systems may inform reporting, analytics, or downstream business processes, but they never write back into the platform's operational write paths (`domain/jobActions.js`, the Work Order Cloud Functions, the inventory ledger, etc. — see [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md) and [`CLAUDE_CONTEXT.md`](CLAUDE_CONTEXT.md) for the current canonical write paths).
- This document establishes the expectation only. The concrete export mechanism (batch export, event stream, ETL job, customer-hosted integration agent, retry/failure strategy) is out of scope here — see [`IntegrationArchitecture.md`](IntegrationArchitecture.md) (Section 10) for the architecture that fulfills this expectation.
- The Integration Platform capability named in [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) (currently Level 1, conceptual only) is the capability this expectation belongs to.

## 8. Deployment Lifecycle

- **Today's real deployment is Managed Hosted, informally**: Taylor Parts runs on infrastructure operated by the platform operator (Firebase Hosting/GitHub Pages for the frontend, Firestore for data — see [`Deployment.md`](Deployment.md) for the current technical mechanics of that hosting). It has not yet been formally labeled or configured as "Managed Hosted mode" in the platform itself; it is simply the only mode that exists in practice right now.
- **Development mode** exists informally today as local development against the Firebase emulator suite (see [`DevelopmentSetup.md`](DevelopmentSetup.md)) — it has not been formalized as a named, configuration-driven mode either.
- **Demo and Enterprise Integration modes do not exist yet** in any form, formal or informal. They are named here as permanent parts of the platform's deployment vocabulary so future work builds toward them deliberately rather than inventing ad hoc equivalents later.
- Lifecycle events an instance moves through — provisioning, mode assignment, integration attachment, and eventual deprovisioning — are named here as concepts an instance should be able to answer, not designed here as procedures. The operational "how" of standing up, provisioning, and retiring an instance belongs to [`PlatformOperatingModel.md`](PlatformOperatingModel.md) (see Section 10), not to this document or to `Deployment.md`'s hosting mechanics.

## 9. Why This Document Exists Now

This strategy was reached after two rejected alternatives, worth recording so the reasoning isn't lost:

1. A "Cloud Functions Deployment Readiness" plan was drafted to move the existing Work Order Cloud Functions to production. It was not pursued: the platform operator is deliberately not adopting the Firebase Blaze billing plan at this time, as a standing decision — not a temporary blocker awaiting action.
2. A "Spark-Compatible Work Order Enablement" plan was drafted to rebuild Work Order writes as client-direct Firestore writes, avoiding Cloud Functions entirely. It was explicitly rejected before any code was written, because designing the platform's permanent write-path architecture around a temporary billing-plan constraint risked becoming the permanent architecture by inertia — in direct conflict with the platform's long-term multi-operating-company, ERP/BI/Snowflake-integration vision this document formalizes.

Neither alternative is revisited by this document. This document does not resolve the underlying Blaze-plan/Cloud-Functions-deployment question (tracked in issue #15) — it establishes deployment mode as a durable concept so that question, and others like it, have a stable place to be answered rather than being reframed from scratch each time.

## 10. Relationship to Other Governance Documents

- **[`ProductVision.md`](ProductVision.md)** — this document is the deployment-level realization of its Multi-Tenant Principle; it does not restate that principle, only operationalizes it.
- **[`PlatformConstitution.md`](PlatformConstitution.md)** — this document extends the "Configurable Platform" principle (configuration over forking) specifically to deployment and integration concerns.
- **[`PlatformCapabilityModel.md`](PlatformCapabilityModel.md)** — the Integration Platform capability (Section 7 above) and the Administration capability's future `Company` entity (Section 4 above) are the capability-model anchors for this document's concepts; capability maturity for those entries is tracked there, not here.
- **[`BusinessEntityModel.md`](BusinessEntityModel.md)** — any future tenant/`Company` boundary (Section 5) will be modeled there as an entity change; this document does not define entities or schema.
- **[`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md)** — the authoritative statement that Firestore is the system of record (Section 6) lives there; this document defers to it rather than duplicating it.
- **[`Deployment.md`](Deployment.md)** — describes the current, concrete technical deployment surfaces (GitHub Pages, Firebase, Cloud Functions). That document is procedural ("how to deploy today"); this document is governance ("what deployment modes the platform is designed to support, and the principles that govern them"). They should stay in sync in spirit but are not expected to duplicate each other.
- **[`PlatformOperatingModel.md`](PlatformOperatingModel.md)** — defines how the platform operates as a business across deployments: governance responsibilities, onboarding lifecycle, and change/configuration management. This document intentionally stopped short of that operational detail (Sections 4 and 8 both deferred to it explicitly, and it is now written).
- **[`IntegrationArchitecture.md`](IntegrationArchitecture.md)** — defines the concrete architecture for the export/integration expectation set in Section 7 (Snowflake/ETL/BI/ERP, event bus, retry strategy). This document intentionally stopped short of that mechanism, and it is now written.

## 11. Status

This document is a **foundational governance artifact**, the second of four governance documents in the roadmap begun by [`PlatformCapabilityModel.md`](PlatformCapabilityModel.md) and completed by [`PlatformOperatingModel.md`](PlatformOperatingModel.md) and [`IntegrationArchitecture.md`](IntegrationArchitecture.md) — see [`ROADMAP.md`](ROADMAP.md)'s "Planned governance documents" section for authoring order; all four are now written.
