# Roadmap Reconciliation — July 2026

**Baseline:** `origin/main` @ `b31f871475c7421e60182ad54bf2f91e76fdc2f9` (includes PRs #362–#366).
**Type:** Documentation and analysis only. No implementation, Rules, Functions, indexes, CI, deployment, or production changes. This report does not authorize any gate.
**Provenance:** Repository-grounded. Every status claim is grounded in committed repository material and Git history; chat history is not treated as authoritative. Live production state is treated as **externally-verified-only** per `../governance/audit-artifact-standard.md`.

## Executive Summary

- **What the old roadmap said:** `ROADMAP.md` and `SPRINT_STATUS.md` are both stamped **"Combined Release Checkpoint — 2026-07-14 (`origin/main` @ `414ea95`)"** and describe a forward queue centered on Customer (Issue #175, contact CSV), a CRM/Sales rename, and Work Order production creation "gated on Issue #15 — no production Functions are currently confirmed."
- **What the repository actually shows:** `origin/main` has advanced **139 merges** past `414ea95`. Large programs merged since then are entirely absent from the roadmap: the **Governed Report Creator (#325 / ADR-007)**, **Enterprise Access & Administration (#226 / ADR-005)**, **Equipment & Installed Assets (#232 / ADR-006)**, the **F-UID-1** fix, and the **F-RULES-1 governance chain**. Most consequentially, **DECISIONS.md #36** records a consolidated **production deployment of the Firestore Rules and 11 Cloud Functions** (report execution, six saved-definition callables, the effective-access feed, and the three Work Order Functions), verified twice — directly **contradicting** the roadmap's "no production Functions are currently confirmed."
- **Largest differences:** (1) production Functions exist per the repo record (roadmap says none); (2) three major domains shipped and are unlisted; (3) the roadmap's "next queued" list is stale/partly superseded; (4) sprint numbering no longer maps to reality.
- **Is the roadmap still reliable?** **No.** `ROADMAP.md`/`SPRINT_STATUS.md` are a point-in-time snapshot ~139 PRs behind and should be treated as historical until reconciled. `SPRINT_STATUS.md` self-warns exactly this.
- **Recommended structure going forward:** a **capability-and-dependency** roadmap (8 phases below), with the audit-artifact/execution-environment governance and the F-RULES-1 chain as the current governance frontier — and an explicit Owner decision on whether Issue #15's "Functions blocked" premise still holds given DECISIONS #36.

## Sources Reviewed

- `docs/ROADMAP.md`, `docs/SPRINT_STATUS.md`, `docs/SprintRoadmap.md`, `docs/README.md` (roadmap/status/index).
- `docs/DECISIONS.md` (append-only decision log, entries #1–#36).
- `docs/architecture/` — 7 ADRs (ADR-001…007), `SYSTEM_AUTHORITIES.md`, `enterprise-business-metrics-framework.md`.
- `docs/assessments/` (18), `docs/specifications/` (14), `docs/implementation-plans/` (15).
- `docs/audits/f-rules-1/` (production audit evidence), `docs/governance/` (execution-environments, audit-artifact-standard, operational-handoff template, ENTERPRISE_CERTIFICATION_FRAMEWORK), `docs/epics/`, `docs/capabilities/`, `docs/reviews/`.
- Git history: `git log --merges 414ea95..b31f871` (139 merges) and code-surface presence checks at `b31f871`.
- Code surfaces confirmed present at `b31f871`: `functions/src/{access(13), reporting(7)}`, `functions/src/index.ts` exports (createWorkOrder, grantRole…, runReportDefinitionCallable, savedDefinition…, resolveEffectiveAccessCallable), `field-ops-app-vite/src/modules/{reporting, administration, equipment, inventoryRole}`, and `firestore.rules`.

## Status Definitions

- **COMPLETE** — merged implementation with evidence (and, where claimed, tests / deploy record).
- **PARTIALLY COMPLETE** — some layers merged; material work remains.
- **IN PROGRESS** — evidenced active work.
- **READY** — plan/prereqs exist; not authorized.
- **BLOCKED** — a dependency prevents progress.
- **DEFERRED** — explicitly postponed.
- **SUPERSEDED** — replaced by newer architecture/entry.
- **NOT STARTED** — no implementation.
- **UNCLEAR** — status cannot be grounded in repository evidence.

> Distinctions applied throughout: a merged **assessment/spec/plan is not implementation**; **merged code without tests/deploy is partial**; **an accepted audit closes a compatibility gate, not enforcement**; **architecture ≠ product capability**; **a domain model/framework ≠ an end-to-end operational workflow**; **a UI placeholder ≠ a capability**. **Deployment is not inferred without a repository deploy record; current live state requires external evidence.**

## Completed Work

### Implemented capabilities (merged code)
- **Governed Report Creator (#325 / ADR-007):** governed catalogs + pure query model/validation (F1–F4), Report Builder (W1), Saved Reports (W-SAVE), trusted report execution (D-FN), inert field-level read + report-audit extensions (D-226/D-AUDIT), reportDefinitions collection + Rules (D-RULES). Code merged (`functions/src/reporting`, `src/domain/reporting`, `src/modules/reporting`).
- **Enterprise Access & Administration (#226 / ADR-005):** eight governed business Roles, permission catalog, WAREHOUSE_MANAGER scoped access (Rows A/B, `isAssignedToWarehouse`), trusted read-only effective-access feed, corrected accessVersion contract (#358), Admin portal inert MVP. Code merged (`functions/src/access`, `src/modules/administration`).
- **Work Order Engine (ADR-002):** createWorkOrder / transitionWorkOrder / updateWorkOrderExecutionData (merged).
- **Inventory ledger (ADR-003)** and **Reorder Request lifecycle** (Cancel/Void PRs #117–#148, several deployed per DECISIONS #17–#32) and **Issue #100** operational-role surfaces (`src/modules/inventoryRole`).
- **Equipment & Installed Assets (#232 / ADR-006):** register/detail/edit modules (`src/modules/equipment`).
- **F-UID-1:** raw-UID suppression on non-Admin surfaces — merged (PR #362) and deployed to the GitHub Pages frontend.

### Governance and architecture (design/governance complete)
- 7 ADRs; assessment→specification→implementation-plan chains across domains.
- **Execution-environment & audit-artifact governance + operational-handoff template** (PR #365).
- **F-RULES-1 governance chain:** production audit tooling (PR #363), GO audit evidence (PR #364), Assessment + Specification + reconciled Implementation Plan (PR #366).

### Production evidence (repository record; live state externally-verified-only)
- **DECISIONS #36:** Firestore Rules + **11 Cloud Functions** deployed to `taylor-parts` (from `3a9c3ff`), `firebase functions:list` showed exactly 11 (v2/Node 20, `us-central1`), all unauth 401; corrected verification passed twice. **No access-mutation (Row-7) Function was deployed.** (DECISIONS #35 records an earlier deploy that was rolled back, then corrected.)
- Multiple production **Rules/index deploys** verified by the Owner (DECISIONS #7–#9, #26, #28, #30, #32).
- **F-RULES-1 production compatibility audit: GO** (`docs/audits/f-rules-1/`).

### Test & platform infrastructure
- **Firestore Rules regression:** 11 emulator suites / **423 tests** green (rulesRegressionRunner + CI `firestore-rules-regression.yml`). Frontend and Functions unit suites; CI workflows for access/reporting/work-order/rules.

## Partially Complete Work

- **F-RULES-1 (legacy job/technician Rules hardening):** governance COMPLETE (assessment/spec/plan/audit merged); **implementation NOT started**. `fieldops_jobs`/`fieldops_technicians` remain `allow read, write: if isSignedIn()`. Remaining: PR-1 contract test suite → PR-2 query migration → PR-2A parity → PR-3 hardened Rules → PR-4 deploy package.
- **Enterprise Access enforcement:** the RoleAssignment/effective-access model is deployed (per #36), but domain collections still authorize via the **legacy `users/{uid}.role`** model; Admin mutation UI is **inert**; the access-mutation Functions are exported but **undeployed**. Domain cutover + legacy-role retirement remain.
- **Report Creator activation:** deployed per #36, but the client run-seam is capability-gated/fail-closed and only Owner holds wave-1 report grants (W1); CSV export (W-CSV) not built.
- **Work Order production creation:** Functions deployed per #36; end-to-end production workflow verification and governed test data remain an Owner/ops concern.

## Current Active Work

- **None evidenced as in-progress in the repository** at `b31f871`. The most recent merges (#362–#366) are complete. **PR-1 is explicitly NOT active and NOT next** — it is future work requiring separate Owner authorization. No open branches on `origin` should be inferred as active from this report.

## Ready but Not Authorized

- **F-RULES-1 PR-1** (contract Rules test suite): governance chain complete, plan merged; **awaits explicit Owner authorization**.
- **F-UID-1 production verification** (close-out): requires an authenticated operator in-app check (repository-side agent cannot execute it).
- **W-CSV report export** (next Report Creator code item): dependent on Owner sequencing decision.

## Blocked Work

- **INV-1 (High) — post-commit inventory-effect loss:** identified by the comprehensive review; reconciliation does not detect the missing-effect condition and no retry driver exists. **No governance home** (assessment/spec/plan) — blocked pending an authoring authorization for a "Work-Order Inventory Effect Recovery" chain.
- **Enterprise Access domain cutover / Admin mutation activation:** blocked on Owner production authorization and deployment of the access-mutation Functions.

## Deferred Work

- **Issue #140** — tenant/company scope: explicitly deferred (referenced across ADR-005/006/007 and the F-RULES-1 contract as out of scope).
- **Warehouse/Transfers/Procurement operational activation (Epic 4/5):** the services are implemented but **dormant** (unwired — no callable/importer), pending activation gates.
- **ADR-004 Technician Recommendation Engine:** design-only, no implementation (explicitly).

## Superseded or Obsolete Roadmap Entries

- **`ROADMAP.md`/`SPRINT_STATUS.md` @ `414ea95`:** superseded as current status (~139 merges stale). Retain as history; mark superseded; link this report.
- **"no production Functions are currently confirmed" (`ROADMAP.md`):** **factually superseded by DECISIONS #36** (11 Functions deployed + verified). Correct or annotate.
- **"CRM/Sales top-level rename" (queued):** superseded — the stale Sales/CRM nav placeholder was removed (Issue #288, merged this cycle). Retire.
- **Issue #15 framing ("Cloud Functions deployment blocks Work Orders"):** materially changed — DECISIONS #36 deployed Work Order Functions to production. Whether #15 is now closed/partially-satisfied is an **Owner decision** (see Open Questions), not silently assumed here.

## Domain-by-Domain Reconciliation

### 1. Governance & AI-SDLC
| Capability | Previous Status | Reconciled Status | Evidence | Remaining Work | Dependency |
|---|---|---|---|---|---|
| Assessment→Spec→Plan→ADR gates | (implicit) | COMPLETE | 7 ADRs; 18/14/15 assessments/specs/plans | maintain | — |
| Execution/audit governance | (absent) | COMPLETE | docs/governance/* (PR #365) | — | — |
| F-RULES-1 governance chain | (absent) | COMPLETE | docs/{assessments,specifications,implementation-plans,audits}/f-rules-1 (#364/#366) | — | — |

### 2. Security & Authorization
| Capability | Previous | Reconciled | Evidence | Remaining | Dependency |
|---|---|---|---|---|---|
| Enterprise Access model | (absent) | PARTIALLY COMPLETE | functions/src/access; #36 feed deployed | domain cutover; mutation Fn deploy; legacy-role retirement | Owner prod auth |
| F-UID-1 | (absent) | COMPLETE (prod-verify pending) | PR #362 merged+deployed | in-app prod verification | operator |
| F-RULES-1 | (absent) | PARTIALLY COMPLETE (governance only) | permissive Rules still live | PR-1→PR-4 | Owner authorization |
| Issue #15 Functions gate | BLOCKED (roadmap) | UNCLEAR/likely superseded | #36 deployed 11 Functions | confirm #15 disposition | Owner decision |

### 3. Core Field Service Operations
| Capability | Previous | Reconciled | Evidence | Remaining | Dependency |
|---|---|---|---|---|---|
| Work Order Engine | partial (roadmap) | COMPLETE (code) / deployed per #36 | functions/src + #36 | E2E prod verification; WO-1 actor attribution | ops |
| Legacy jobs/Field Mode | (implicit) | PARTIALLY COMPLETE (legacy, permissive) | jobActions/jobWorkflow/FieldMode | F-RULES-1 hardening; retirement | F-RULES-1 |
| Technician recommendation (ADR-004) | design | NOT STARTED | ADR-004 design-only | implementation | — |

### 4. Inventory, Warehouse & Procurement
| Capability | Previous | Reconciled | Evidence | Remaining | Dependency |
|---|---|---|---|---|---|
| Inventory ledger (ADR-003) | partial | COMPLETE (code) | functions/src/inventoryService | INV-1 recovery | INV-1 home |
| Reorder lifecycle | in progress | COMPLETE + deployed (Cancel/Void) | DECISIONS #17–#32 | — | — |
| INV-1 effect recovery | (absent) | BLOCKED (no home) | comprehensive review | assessment/spec/plan | Owner authoring auth |
| Warehouse/Transfers/Procurement (Epic 4/5) | (implicit) | DORMANT (design/services only) | services unwired | activation | Issue #15 + gates |

### 5. Mobile & Technician Experience
| Capability | Previous | Reconciled | Evidence | Remaining | Dependency |
|---|---|---|---|---|---|
| Responsive/mobile fixes | (implicit) | PARTIALLY COMPLETE | index.css @media work | app-like/PWA, sidebar collapse, offline, scanning | product decision |

### 6. AI-Assisted Operations
| Capability | Previous | Reconciled | Evidence | Remaining | Dependency |
|---|---|---|---|---|---|
| Recommendations / next-best-action / scoring | concept | NOT STARTED / conceptual | ADR-004 design; dispatch scoring (pure fns over legacy jobs) | implementation | — |

### 7. Enterprise Platform & Multi-Company
| Capability | Previous | Reconciled | Evidence | Remaining | Dependency |
|---|---|---|---|---|---|
| Multi-tenant / Issue #140 | (implicit) | DEFERRED | referenced as out-of-scope | design→impl | Owner |
| Report Creator | (absent) | COMPLETE (code) / deployed per #36; activation partial | functions/src/reporting; #36 | W-CSV; grants; activation | Owner |

### 8. Integrations & Commercial Readiness
| Capability | Previous | Reconciled | Evidence | Remaining | Dependency |
|---|---|---|---|---|---|
| Customer/Sales/Accounting | queued (roadmap) | NOT STARTED (mostly) / Customer partial | Customer modules exist; no sales/invoicing | per repository artifacts only | Owner |

## Proposed Roadmap

Capability-and-dependency phases (not dates; order by dependency, not by this list):

1. **Foundation & Governance** — *Status: COMPLETE (ongoing maintenance).* Exit: governance chain + evidence standards in force (met).
2. **Security & Authorization Completion** — *Status: IN GOVERNANCE / PARTIAL.* Completed: F-UID-1; Enterprise Access model deployed (feed). Remaining: F-RULES-1 hardening (PR-1→PR-4); Enterprise Access domain cutover + mutation activation; confirm Issue #15 disposition. Dependency: Owner authorizations + deploy gates. Exit: legacy permissive Rules retired with parity; access mutations trusted+audited.
3. **Core Field Service Operations** — *Status: COMPLETE (code) / verification partial.* Remaining: E2E production verification; WO-1 attribution decision; legacy-jobs retirement (couples Phase 2). Exit: Work Orders verified end-to-end in production.
4. **Inventory, Warehouse & Procurement** — *Status: PARTIAL + DORMANT.* Remaining: INV-1 recovery (needs a governance home); activate Epic 4/5 warehouse/procurement. Dependency: Issue #15 for trusted cascades. Exit: reconcilable ledger with detected/repairable effects; activated procurement-to-inventory chain.
5. **Mobile & Technician Experience** — *Status: PARTIAL.* Remaining: app-like/PWA, offline, scanning, calendar. Exit: a defined technician mobile experience beyond responsive fixes.
6. **AI-Assisted Operations** — *Status: NOT STARTED / conceptual.* Exit: at least one governed AI-assisted workflow implemented (recommendation/scoring) under the AI-SDLC gates.
7. **Enterprise Platform & Multi-Company** — *Status: DEFERRED.* Exit: Issue #140 tenant scoping designed and implemented with isolation tests.
8. **Integrations & Commercial Readiness** — *Status: NOT STARTED (mostly).* Exit: repository-approved integration/commercial artifacts before any implementation.

## Recommended Immediate Next Decision

This report does **not** select the next gate. Candidate next gates, with tradeoffs:

- **A. Authorize F-RULES-1 PR-1** (contract test suite). *Supports:* complete governance chain + merged plan; closes a confirmed High permissive-Rules gap; production audit is GO. *Tradeoff:* test-only, low risk; leaves unresolved contract items (U-R1–U-R4) for PR-3, not PR-1. *Protect:* do not let PR-1 imply PR-3 deploy.
- **B. Author an INV-1 governance home** (assessment/spec/plan for Work-Order Inventory Effect Recovery). *Supports:* a High integrity finding with no home; docs-only. *Tradeoff:* documentation effort before any code.
- **C. F-UID-1 production verification close-out.** *Supports:* closes a Critical already merged/deployed. *Tradeoff:* requires an operator in-app check (not repository-side).
- **D. Confirm current production live-state + Issue #15 disposition.** *Supports:* the largest roadmap contradiction (Functions live per #36 vs roadmap "none"); needs external evidence. *Tradeoff:* operator/Owner action, not repository work.
- **E. W-CSV report export** (next Report Creator code item). *Supports:* continues an active, deployed program. *Tradeoff:* Owner sequencing vs Phase-2 security completion.

**Owner decision required:** which candidate is the next authorized gate, and (independently) whether Issue #15 is now considered satisfied/closed given DECISIONS #36. **Work to protect:** none is mid-flight in-repo; do not interrupt by treating PR-1 as pre-authorized.

## Open Questions

- **OQ-1:** Is **Issue #15** (Cloud Functions deployment blocker) now closed/partially satisfied given DECISIONS #36's 11-Function deploy? (Roadmap still treats it as a hard blocker.)
- **OQ-2:** What is the **current live production state** of the 11 Functions + Rules from #36? (Repository records the deploy; the audit-artifact standard requires external evidence for *current* live state.)
- **OQ-3:** Should **ROADMAP.md / SPRINT_STATUS.md** be fully rewritten now, or retained as history behind this reconciliation report? (A full rewrite needs Owner prioritization of Phases 2–8.)
- **OQ-4:** Where does **INV-1** get its governance home, and at what priority relative to F-RULES-1 PR-1?
- **OQ-5:** Do any **Sales/Customer/Accounting** items have committed repository artifacts that should be promoted, or do they remain ideas (not active priorities)?
- **OQ-6:** Confirmation of the **F-RULES-1 Unresolved contract items** (U-R1–U-R4) ownership/timing — required before PR-3, not PR-1.
