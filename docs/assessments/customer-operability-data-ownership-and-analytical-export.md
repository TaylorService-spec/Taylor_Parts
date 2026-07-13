---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-13
owner: Claude Code
related_adrs: []
depends_on: [docs/PROJECT_ARCHITECTURE.md, docs/architecture/SYSTEM_AUTHORITIES.md, docs/DeploymentModeStrategy.md, docs/IntegrationArchitecture.md, docs/PlatformOperatingModel.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: 140
target_release: TBD
---

# Assessment Report: Customer Operability, Data Ownership, and Analytical Export Architecture

**Status: DRAFT (pending Architecture Review).** Assesses **Issue #140** only — how a future customer can operate Taylor Parts independently, own and move its data, and connect customer-managed analytical platforms without needing GitHub, Firebase Console, or CLI expertise. It verifies the current architecture, names the gaps between today's developer-operated workflow and customer self-operation, compares deployment/integration options, and recommends the smallest safe path plus the ADR/Specification follow-ups it implies.

**This is a documentation-only Assessment and authorizes nothing.** It changes no application code, no Firestore Rules, no indexes; it deploys nothing; it accesses no production data; it edits no global/status document (`ROADMAP.md`, `SPRINT_STATUS.md`, `CLAUDE_CONTEXT.md`, capability/entity models, etc.); and it does not touch Customer initiative **#175** or Inventory initiative **#154**. Every implementation, migration, provisioning, deployment, or production-data action named here remains its own separate gate under `docs/ai/workflow.md` and `PlatformOperatingModel.md`'s Change Management. It defines *what customer self-operation must satisfy and what stands in the way today* — a Specification or ADR, if the Owner authorizes one after Architecture Review, is a separate step.

## Scope of this assessment

Investigated, read-only:
- The operational system of record and sanctioned write paths — `docs/PROJECT_ARCHITECTURE.md` (System of record; Person Assignment Platform Service Standard; Forbidden patterns) and `docs/architecture/SYSTEM_AUTHORITIES.md` (per-concern write/read ownership).
- The deployment and integration governance already on `main` — `docs/DeploymentModeStrategy.md`, `docs/IntegrationArchitecture.md`, `docs/PlatformOperatingModel.md`.
- The current administration mechanics implied by code: `users/{uid}` is `allow write: if false`, so the **normal** Employee/User access writer is the Admin-SDK script `functions/scripts/provisionEmployeeAccess.js` (the one `src/auth/AuthContext.jsx`'s `resolveEmployeeSession` comment names as what populates `users/{uid}.employeeId`), with technician mapping via `functions/scripts/assignTechnicianToUser.js` (`SYSTEM_AUTHORITIES.md`). Both are manual, service-account-credentialed scripts — not an in-app path.
- The standing Cloud Functions / Blaze constraint (`DeploymentModeStrategy.md` §9, issue **#15**) and its consequence for any server-side operability automation.

Explicitly **not** addressed here: any application code, Firestore Rules/schema/index change, provider integration, migration, deployment, production-data action, global-document edit, or #175/#154 work. No concrete API surface, connector, vendor, or schema is designed here.

## 1. Current architecture — verified

**Operational plane (system of record).** Firestore is the operational source of truth in every deployment mode (`PROJECT_ARCHITECTURE.md` "System of record"; `DeploymentModeStrategy.md` §6). **Four** operational write-path groupings coexist on `main` — the three canonically-named operational models (Job/Technician, Work Order Engine, Customer) plus the inventory/warehouse/procurement Cloud-Function ledger group — each with exactly one sanctioned write path:

| Model | Collections | Sanctioned write path | Enforcement |
|---|---|---|---|
| Work Order Engine | `fieldops_wos`, `counters` | `createWorkOrder()` / `transitionWorkOrder()` **Cloud Functions** only | `firestore.rules` denies all direct client writes unconditionally |
| Inventory / Warehouse / Procurement | `inventory_transactions` (append-only), warehouse, procurement | `functions/src/*Service.ts` **Cloud Functions** | Rules-enforced; ledger is immutable Platform Events |
| Job / Technician (legacy, still live) | `fieldops_jobs`, `fieldops_technicians` | `domain/jobActions.js` (client-direct) | Rules-enforced |
| Customer model | `accounts`, `contacts`, `locations` | `domain/accounts.js` / `locations.js` / `contacts.js` (client-direct) | Rules-enforced, admin/dispatcher only |

**Merged-on-`main` vs. deployed — distinct.** All four groupings' *application code* is merged on `main`, but deployment status differs by layer and must not be conflated:
- **Firestore Rules** — deployed and enforced in the live project (last verified live 2026-07-09; there is no CI that auto-deploys Rules, so this is re-verified, not assumed).
- **Cloud Functions** — present in the repo (`functions/`) but **not deployed** to production (Blaze not adopted; `DeploymentModeStrategy.md` §9, issue **#15**). The two Cloud-Function-dependent groupings (Work Order Engine; inventory/warehouse/procurement) are therefore **not production-operational** today; only the two client-direct, Rules-enforced models (Job/Technician, Customer) actually function in production. This is the concrete shape of the "Work Order creation blocker" the governance docs reference.

**Identity.** Firebase Authentication is the credential/session authority. The platform separates **Employee** (`employees/{employeeId}`, workforce identity), **User** (`users/{uid}`, application-access identity), and **Firebase Auth** (credential) as three structurally distinct tiers, deliberately so a future identity provider (Entra ID, Okta, Workspace, SAML) *could* be adopted without redesigning what an Employee is (`PROJECT_ARCHITECTURE.md` §A). This is a **data-model asset for future provider replacement — not operational provider-neutrality today.** The running system is Firebase-Auth-specific end to end: `AuthContext.jsx` is the sole auth-state source (no parallel session/local layer), sign-in uses the Firebase Auth SDK, and `firestore.rules` authorizes on `request.auth` (the Firebase UID). Replacing the provider would require real auth/session/Rules adapter work; the separation lowers that cost, it does not make the runtime portable as-is.

**Governance already in place.** `DeploymentModeStrategy.md` defines four modes (Development, Demo, Managed Hosted, Enterprise Integration) and the principle *configuration over forking* — no customer-specific branches. `IntegrationArchitecture.md` defines an export/import boundary, five integration patterns (Export/Extract, Import/Ingest, Event Notification, Customer-Hosted Agent), the operational-vs-analytical distinction, and the rule that external systems never write Firestore directly. These establish the **target boundary** #140 asks about — but at governance level only.

**Execution reality (the central constraint).** Because Cloud Functions are undeployed (above), the platform has **no server-side privileged/scheduled execution substrate** today. Any operability feature that needs one — automated backup/export, incremental sync, credential rotation, a trusted admin-provisioning or hierarchy writer — has nowhere to run. Managed Hosted is the only mode that exists in practice, informally. This is the single largest gate on customer self-operation and must be sequenced first (issue **#15**).

## 2. Gap analysis — developer-operated today vs. customer self-operation

Today every one of the following requires a developer with GitHub, Firebase Console, and/or CLI + service-account credentials:

| Administration concern (#140) | How it works **today** | Gap for customer self-operation |
|---|---|---|
| Tenant/customer provisioning | No `Company`/tenant boundary exists; single-tenant runtime (`DeploymentModeStrategy.md` §4) | No tenant entity, no provisioning surface |
| Employee/user/role administration | `users/{uid}` is `allow write: if false`; the normal access writer is the manual Admin-SDK script `functions/scripts/provisionEmployeeAccess.js`, with technician mapping via `assignTechnicianToUser.js` — both run from a developer workstation with service-account credentials | No in-app admin; requires service-account credentials + CLI |
| Workflow/business configuration | Config lives in code/constants (`ROLE_NAV_ACCESS`, `navConfig.js`); "configurable platform" is a principle, not yet a data-driven runtime | Requires code change + redeploy |
| Backup & restore | None in-repo; relies on Firebase project-level tooling via Console/CLI | No customer-accessible backup/restore |
| Monitoring & alerting | None in-repo; Console-only | No customer-facing health surface |
| Deployment & upgrade automation | Frontend via Firebase Hosting/GitHub Pages; Functions undeployed (Blaze) | No documented customer-run install/upgrade automation |
| Schema/data migrations | Ad hoc, developer-run | No governed migration mechanism |
| Credential rotation | Firebase Console / service accounts, developer-run | No customer-controlled rotation surface |
| Disaster recovery | Undefined; no runbook | No DR plan or RTO/RPO |
| Audit access | `inventory_transactions` is immutable Platform Events; no general audit-log surface or reader | No customer audit-access UI |
| Data export & customer exit | None; no export contract exists | No portability / exit path |
| Support ownership & runbooks | Implicit (developer) | No documented ownership split |

**Summary gap:** the platform has a well-governed **operational plane** but essentially no **administration plane** and no **data-ownership/export plane** that a non-developer customer can operate. The operational plane is production-viable only for the client-direct, rules-enforced models (Job/Technician, Customer) until #15 is resolved.

## 3. Deployment / integration modes assessed

#140 names three modes. Mapped against the existing `DeploymentModeStrategy.md` vocabulary:

1. **Managed mode** (operator runs infra + Firestore) — this **is** the existing **Managed Hosted** mode, already the de-facto current state. Gap is formalization (explicit mode identity) + the operability surfaces in §2, not a new architecture.
2. **Customer-controlled mode** (customer owns the cloud project/backend, installed/upgraded via documented automation, never a fork) — **not covered by any existing mode.** Managed Hosted = operator-run; Enterprise Integration = customer *connects integrations to* a hosted instance. Neither is "customer owns and operates the whole backend." This is a genuine **new mode** and requires amending `DeploymentModeStrategy.md` (an ADR-level decision), plus install/upgrade automation and a support/security responsibility split. *Configuration over forking* is the hard constraint: this mode must be the same core product configured differently, never a per-customer codebase.
3. **Customer analytical mode** (operational data exported to a customer-owned lake/warehouse/BI/archive) — aligns with the existing **Enterprise Integration** mode and `IntegrationArchitecture.md`'s Export/Extract + Customer-Hosted Agent patterns. Governed at strategy level; **nothing built.** Needs a concrete, versioned export contract (§4).
4. **Coexistence of modes 2 and 3, and the responsibility split.** They can coexist: a customer-controlled backend can also export to a customer-owned analytical destination. The division that must be written down: the platform operator owns the *core product + stable boundaries*; the customer owns *their infrastructure, their destination credentials, their analytical copies, and their retention/deletion* (`IntegrationArchitecture.md` §14). Security responsibility follows operation — whoever operates the backend owns its hardening, with the operator responsible for the product's default posture (Rules, auth model).

## 4. Customer-owned exports and stable / versioned data contracts

Any export design (whenever authorized) must satisfy, per `IntegrationArchitecture.md` §§7–9 and #140:
- **Stable business identifiers** — exports key on durable IDs, not internal document shape. The Person Assignment Standard already models stable `employeeId`/`userId` keys with a display-name *snapshot* that is explicitly not an identity key (`PROJECT_ARCHITECTURE.md` §A) — the same discipline generalizes to every exported entity.
- **Versioned export contract** — a published, versioned schema decoupled from internal collection names; internal refactors must not be breaking changes (`IntegrationArchitecture.md` §10). Requires an ADR before the first export ships.
- **Incremental / high-water-mark semantics**, **idempotency/retry**, **immutable event/audit lineage** (the `inventory_transactions` append-only ledger is the existing precedent), **health/failure visibility**, **customer-controlled destination credentials**, **customer-owned retention/deletion**, and a **full portability/exit export**.
- **Additive and read-oriented** — producing an export never mutates or blocks the operational write that produced the data (`IntegrationArchitecture.md` §9).

**An export is a data-egress action, not merely a read.** Bulk extraction of operational data is a distinct, higher-risk operation than an operator viewing a record in the app, and must not be treated as low-risk simply because it performs no writes. Any export (including the "smallest" one below) must define:
- **Explicit export authorization** — a dedicated export permission/step-up, **separate from ordinary read access**; a user who can view records is not thereby entitled to bulk-egress them.
- **Data classification & masking** — per-field sensitivity classification with masking/redaction of sensitive fields by default, and a governed path to include them.
- **Names alongside stable IDs** — export both the stable identifier and the resolved display name (the Person Assignment snapshot discipline), so the extract is human-reviewable without re-keying identity.
- **Audit evidence** — an immutable record of who exported what scope, when, to which destination, under which authorization.
- **Schema version** — every extract stamped with the versioned export-contract version.
- **`asOf` / consistency semantics** — a defined point-in-time / consistency guarantee (Firestore queries are not a single snapshot across collections), stated on the extract.
- **Pagination & size limits** — bounded page/size limits and back-pressure; no unbounded full-collection pull.
- **Encryption & destination handling** — encryption in transit and at rest, and explicit, customer-controlled destination handling of the output artifact.
- **Retention & deletion** — customer-owned retention/deletion responsibility for the extract, stated at export time.
- **Failure reporting** — explicit partial-failure/failure reporting; a failed or partial export is surfaced, never silently truncated.

**Sequencing (still smallest-first, but gated).** The first viable increment is a manual, admin-triggered export of the client-direct, Rules-enforced collections (Customer model `accounts`/`contacts`/`locations` first, then Job/Technician) — chosen because it needs no Cloud Functions, no new write path, and no Rules change. **It is not, however, "safe because it is read-only":** it is a data-egress action and requires an **approved export Specification and security review before any implementation.** Incremental/scheduled export and Work-Order/inventory export (Cloud-Function-owned) are additionally gated behind #15.

## 5. Operational-write authority boundaries (must-preserve invariants)

Any operability, admin, or export work must preserve these, without exception:
1. **Firestore remains the operational system of record** in every mode; no second operational datastore, and no browser-local/workstation DB as shared SoR (#140 non-goal; `DeploymentModeStrategy.md` §6).
2. **The sanctioned write paths in §1 remain the only writers.** No customer analytical system, integration, import, or event mechanism writes operational collections directly; any operational write-back goes through an explicitly supported platform API/command that itself routes through an existing sanctioned path (`IntegrationArchitecture.md` §§4, 8, 11; `PROJECT_ARCHITECTURE.md` "Forbidden patterns").
3. **`firestore.rules` stays the enforcement authority** (both root and client-repo mirror, kept in sync); `users/{uid}` stays non-client-writable. An admin plane grants no client-side rules exception — privileged provisioning runs through a trusted server-side path (Admin SDK), never a relaxed rule.
4. **Exports are additive/read-oriented; imports are validated through existing paths** — an import never becomes a second write path (`IntegrationArchitecture.md` §§8–9).
5. **Configuration over forking** — no customer-specific branch, fork, or `if (customer X)` code path in any mode (`DeploymentModeStrategy.md` §2; `PlatformOperatingModel.md` §9).

## 6. Administration without GitHub / Firebase Console / CLI

Removing the Console/CLI/GitHub dependency requires **two distinct planes** — they must not be collapsed into one admin UI:

**(a) Ordinary product administration** — employee/user/role administration and workflow/business configuration. This is an in-product **Administration plane** (an admin surface in the app), with privileged writes executed by a trusted server-side path (Admin SDK), replacing the manual `provisionEmployeeAccess.js` / `assignTechnicianToUser.js` scripts. The existing three-tier identity model and the "no Firebase UID in user-facing workflows" rule (`PROJECT_ARCHITECTURE.md` §A) already point the right direction: select people and roles by recognizable identity, resolving keys behind the selection — never by pasting UIDs or editing the Console.

**(b) Privileged operational control** — **backup/restore, infrastructure credentials, deployments, schema/data migrations, and disaster recovery.** These are **not** ordinary product administration and must **not** be exposed through an Account-page-style admin UI. They require a **hardened control plane** with: **step-up authorization** (re-authentication for privileged actions), **explicit approvals** (four-eyes on destructive/irreversible operations), **immutable audit** of every privileged action, **IAM/secret management** for infrastructure credentials (never client-held), and **separation of duties** (the role that operates a workflow is not automatically the role that can restore/migrate/deploy or rotate infrastructure secrets). Conflating these with product admin would hand operational-workflow admins latent infrastructure authority — precisely the failure this separation prevents.

**Hard dependencies for both planes:**
- **Execution substrate.** Every privileged server-side action in (a) and (b) needs server-side privileged execution — the Cloud Functions / Blaze decision (**#15**) or an operator-run equivalent control service. Until that is decided, neither plane can be built server-side; only client-direct, Rules-gated product actions (already true for the Customer model) are available.
- **Tenancy — two separate cases:**
  - **Multi-tenant managed operation** (one operator-run backend serving multiple customers) **does** require a `Company`/tenant boundary that does not yet exist (`DeploymentModeStrategy.md` §4) — a `BusinessEntityModel.md` entity decision, out of scope here, so administration and data are scoped per customer.
  - **Single-tenant customer-controlled deployment** (a customer running their own dedicated backend) does **not** require a `Company` entity — the entire instance and its data belong to that one customer, so tenant scoping is the deployment boundary itself. A `Company` entity is therefore a prerequisite for *multi-tenant managed* administration, **not** a universal prerequisite for customer self-operation.

## 7. Operability lifecycle concerns — current state and what each needs

Backup, restore, credentials, migrations, and DR below belong to the **hardened privileged control plane (§6b)** — step-up authorization, approvals, immutable audit, IAM/secret management, separation of duties — **not** the ordinary product Administration plane. Monitoring, audit-access, portability, and exit are product/analytical-plane surfaces.

| Concern | Current state | What customer self-operation needs (later gate) |
|---|---|---|
| Backup | Project-level only, Console/CLI | Governed, customer-triggerable backup; server-side substrate (#15) |
| Restore | None documented | Restore procedure + integrity verification; DR runbook |
| Monitoring / alerting | None in-repo | Health/failure surface for exports + workflows (`IntegrationArchitecture.md` §health visibility) |
| Upgrades | Frontend hosting; Functions undeployed | Documented install/upgrade automation (esp. customer-controlled mode), never a fork |
| Credentials | Console / service accounts | Customer-controlled destination credentials + rotation surface |
| Disaster recovery | Undefined | DR plan with RTO/RPO; mode-specific ownership |
| Audit | Immutable ledger exists; no general audit reader | Audit-access surface; immutable lineage in exports |
| Portability | None | Full versioned portability export |
| Exit | None | Complete customer-owned exit export + deletion responsibility handoff |

## 8. Options and tradeoffs

- **Option A — Governance/ADR only, no build now (smallest, safest).** Formalize the plane boundary, the export contract, and the customer-controlled mode as ADRs/amendments; sequence everything behind #15. **Pro:** zero operational risk, unblocks nothing prematurely, keeps the operational plane untouched. **Con:** delivers no customer-visible capability yet. **This is the recommended first step.**
- **Option B — Minimal export increment (after Option A's export-contract ADR *and* an approved export Specification + security review).** Ship the manual, admin-triggered export of the client-direct collections (§4) with the full export-control set (separate export authorization, classification/masking, audit evidence, schema version, `asOf` semantics, size limits, encryption, retention/deletion, failure reporting). **Pro:** real data-ownership/portability value without needing Cloud Functions or a new write path. **Con:** it is a **data-egress action, not a free read** — it must clear its own Specification/security-review gate, and it is partial (no Work-Order/inventory data until #15; no incremental/scheduled export).
- **Option C — Full product-admin plane + hardened control plane + scheduled export + backup automation.** **Pro:** true self-operation. **Con:** hard-blocked on #15 (server-side substrate); the managed multi-tenant variant additionally needs the `Company` boundary (the single-tenant customer-controlled variant does not, §6); large, multi-Specification effort. Not safe to start before A and the #15 decision.

Rejected framings to avoid (consistent with `DeploymentModeStrategy.md` §9 / `PlatformOperatingModel.md` §8): do **not** rebuild write paths as client-direct to dodge the Blaze constraint, and do **not** solve customer-controlled mode with a fork or customer-conditional code.

## 9. Smallest safe recommendation

1. **Adopt Option A now (governance only).** Author, in separate authorized steps: (a) an ADR fixing the four-plane boundary — **operational / analytical / ordinary product administration / privileged operational control** — reaffirming the no-external-direct-write invariant and the separation-of-duties line between product admin and privileged control; (b) an ADR defining **stable business identifiers + a versioned export contract** with incremental/idempotency/lineage semantics *and* the export-control set in §4 (export authorization separate from read, classification/masking, audit, `asOf`, limits, encryption, retention, failure reporting); (c) an amendment to `DeploymentModeStrategy.md` recognizing **Customer-Controlled** as a named mode with its configuration-not-fork constraint, support/security responsibility split, and the single-tenant-vs-multi-tenant tenancy distinction (§6).
2. **Treat issue #15 (Blaze / Cloud Functions execution substrate) as the explicit prerequisite** for every server-side operability surface (backup/restore automation, scheduled/incremental export, credential rotation, trusted admin provisioning, hierarchy writers). Do not design those around a temporary billing constraint.
3. **Defer implementation.** The first implementation increment, when separately authorized, is **Option B** (manual export of the client-direct Customer model) — deliverable without #15 or a new write path, but **only after its own approved export Specification and security review**; it is a governed data-egress action, not a free read.

This keeps the operational plane and its invariants completely untouched while giving the Owner a decision-ordered path to customer self-operation.

## 10. Recommended follow-ups (each its own separate gate)

- **ADR — Four-plane boundary:** operational / analytical / ordinary product administration / privileged operational control separation; no external direct operational writes; sanctioned-path-only write-back; separation-of-duties line between product admin and privileged control.
- **ADR — Export contract:** stable identifiers, versioning, incremental/high-water-mark, idempotency/retry, immutable lineage, customer-owned retention/deletion, exit export.
- **ADR / `DeploymentModeStrategy.md` amendment — Customer-Controlled mode:** definition, install/upgrade automation expectation, support/security responsibility split, single-tenant-vs-multi-tenant tenancy distinction, mode-2/mode-3 coexistence.
- **Decision dependency — issue #15:** resolve the Cloud Functions / Blaze (or operator-run control service) execution substrate; prerequisite for §7 automation, the export automation, and both admin planes.
- **`BusinessEntityModel.md` entity decision — `Company`/tenant boundary:** prerequisite for **multi-tenant managed** administration only — **not** for single-tenant customer-controlled deployment (Product/Architecture gate, not this assessment).
- **Specification — Product Administration Console:** in-app employee/user/role/config administration executed via a trusted server-side path (depends on #15).
- **Specification (+ security review) — Privileged Operational Control Plane:** backup/restore, infrastructure credentials, deployments, migrations, and DR with step-up authorization, approvals, immutable audit, IAM/secret management, and separation of duties — explicitly separate from the product Administration Console.
- **Specification (+ security review) — Data Export:** the export-control set in §4 (separate export authorization, classification/masking, names-with-IDs, audit evidence, schema version, `asOf`/consistency, pagination/limits, encryption/destination, retention/deletion, failure reporting). Required before any export implementation, including the "smallest" Option B.
- **Specification — Monitoring/alerting + DR runbook:** export/workflow health surface and DR RTO/RPO.
- **Roadmap / capability mapping:** map the above to `PlatformCapabilityModel.md`'s Administration and Integration Platform capabilities and to `ROADMAP.md` (a later, separately authorized edit — not done here).
- **Issue hygiene:** cross-link this initiative to #15; open per-workstream tracking issues when the Owner authorizes the corresponding Specification.

## 11. Non-goals honored and relationship to existing governance

Consistent with #140's explicit non-goals: Firestore is **not** replaced; no browser-local/workstation DB becomes the shared SoR; **no** customer-specific branch/fork is proposed; **no** direct external write to operational collections is permitted; and this future-facing assessment does **not** block current operational workflow PRs (including PR #138's Cancel/Void work, whose Merge/Deployment authorizations remain separate gates). This assessment defers to `PROJECT_ARCHITECTURE.md` (system of record), `SYSTEM_AUTHORITIES.md` (write-path ownership), `DeploymentModeStrategy.md` (modes/tenant/config), `IntegrationArchitecture.md` (export/import boundary), and `PlatformOperatingModel.md` (change/config governance) rather than restating or altering them.

## 12. Explicitly not done by this assessment

No application code, Firestore Rules/schema/index change, provider/connector integration, migration, backup/export execution, deployment, production-data access, or global/status-document edit was made. No `Company` entity, ADR, or Specification was authored — those are named as follow-ups only. Customer initiative #175 and Inventory initiative #154 were not touched. This document is the assessment artifact only; every action it recommends remains a separate, individually-authorized gate.
