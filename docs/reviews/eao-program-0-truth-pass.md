---
artifact_type: review
gate: Executive Architecture Office — Program 0 (Authoritative Truth Pass)
status: Complete
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: 633a335f746cd3825478437fc2103a2988dc2288 (verified origin/main)
scope: Documentation-only. No code, Rules, Functions, identity, migration, or deployment change.
---

# Program 0 — Authoritative Truth Pass

**Purpose.** Bring repository statements into alignment with implemented reality *before* any new company or platform architecture is created. Not a rewrite and not a documentation-expansion exercise: the output is corrections plus this record.

**Method.** Repository-grounded. Every claim below is derived from committed source at `633a335`, from `DECISIONS.md`, or from committed evidence under `docs/audits/`. Live production state is treated as externally-verified-only per [`../governance/audit-artifact-standard.md`](../governance/audit-artifact-standard.md); no command was executed against production. Facts that repository evidence cannot establish are marked **UNKNOWN** with the read-only evidence that would resolve them.

---

## 1. The core finding

**Documentation completeness had been standing in for architecture completeness.**

The governance corpus is mature, internally consistent, and unusually disciplined. Several of its documents describe, in the present tense, platform properties that **do not exist in code**: multi-tenancy, a configuration mechanism, and an integration/event/API surface. Two further properties — observability and backup/recovery — are absent from both the code *and* the governance set, so nothing was even claiming them.

This is not a documentation defect to be fixed by writing more documentation. It is the gap this program exists to close, and the corrections below are scoped to **stop the repository from misstating it**, not to close it.

## 2. Maturity, by the five required dimensions

| Dimension | Rating | Basis |
|---|---|---|
| **Application architecture** | **4 / 5 — mature** | Governed write paths, trusted callables, capability-through-transaction checks, append-only ledgers and audit events, idempotency keys, fail-closed defaults, dual-mirrored Rules (1,718 lines), 238 test files, 27 CI suites. |
| **Platform architecture** | **1.5 / 5 — largely absent** | No tenancy, no configuration layer, no integration/event/API surface. These are the properties that distinguish a platform from one company's application. |
| **Engineering organization** | **4 / 5 — mature** | AI-SDLC, Delegation Charter tiers, AI Engineering Operating Model, active-workstream registry, independent review loop, append-only decision log (67 entries). |
| **Operational** | **1.5 / 5 — weakest** | No observability of any kind; no backup/DR posture, RPO/RTO, incident response, or SLA. A frontend surface auto-publishes to production outside the promotion lifecycle. |
| **Company** | **1 / 5 — nascent** | `OWNERSHIP.md` + `LICENSE` + root `README.md` only. No commercial, operational-readiness, or organizational architecture. |

**Owner-directed framing, confirmed by evidence:** mature application architecture and engineering discipline; largest remaining gaps are **platform services** and **operational readiness**.

## 3. Truth corrections made

| # | Artifact | Correction |
|---|---|---|
| T-1 | [`../README.md`](../README.md) | Index reconciled to the real tree (previously omitted `audits/`, `operations/`, `deployment/`, `governance/`, `engineering/`, `roadmaps/`, `session-state/`, `user-guide/`, and ADR-005…010). Added the five-class artifact legend. |
| T-2 | [`../PlatformCapabilityModel.md`](../PlatformCapabilityModel.md) | Added §5a implementation-state axis (7 dimensions) covering all capabilities **and** platform services. Corrected four stale current-maturity claims (Technician Operations, Warehouse, Procurement, Inventory). |
| T-3 | [`../Deployment.md`](../Deployment.md) | Rewritten to four surfaces. Corrected three false statements about Firebase Hosting. Recorded the GitHub Pages governance gap and four known unknowns. |
| T-4 | [`../ProductVision.md`](../ProductVision.md) | "Multi-Tenant Principle" → "Multi-Company Principle *(design objective — not implemented)*", with the single-company implementation truth stated first. |
| T-5 | [`../DeploymentModeStrategy.md`](../DeploymentModeStrategy.md) §4 | Marked FUTURE-STATE ARCHITECTURE; records the Owner's 2026-08-06 deferral and the no-cosmetic-tenancy constraint. |
| T-6 | [`../IntegrationArchitecture.md`](../IntegrationArchitecture.md) | Marked FUTURE-STATE ARCHITECTURE; states plainly that no integration code exists and forbids present-tense integration claims in commercial material. |
| T-7 | [`../PlatformConstitution.md`](../PlatformConstitution.md) §9 | Distinguishes the binding design constraint from the absent configuration mechanism. |
| T-8 | [`../session-state/README.md`](../session-state/README.md) | Classified HISTORICAL SNAPSHOT; active coordination reassigned to the registry. Preserves the still-live AUTH-PR-4 protected-artifact constraint. |
| T-9 | [`../engineering/ACTIVE_WORKSTREAMS.md`](../engineering/ACTIVE_WORKSTREAMS.md) | Declared sole owner of active-assignment coordination. This program declared. Concurrent undeclared writer recorded. |
| T-10 | [`../engineering/AI_ENGINEERING_OPERATING_MODEL.md`](../engineering/AI_ENGINEERING_OPERATING_MODEL.md) | Added §8a baseline and worktree discipline (verified-baseline guard, abort-and-rebranch, dirty-tree preservation, read-only assessment worktrees). |
| T-11 | [`../governance/ENTERPRISE_CERTIFICATION_FRAMEWORK.md`](../governance/ENTERPRISE_CERTIFICATION_FRAMEWORK.md) | "Baseline Approved" → "NOT ACTIVATED"; none of its three core artifacts exist. |

**Deliberately not rewritten:** `ROADMAP.md`, `SPRINT_STATUS.md`, `SprintRoadmap.md`, `CLAUDE_CONTEXT.md`, and `session-state/*.md` are historical snapshots. They already self-warn. Making them *look* current would destroy provenance; they were classified, not edited.

## 4. Canonical owner per duplicated concern

| Concern | Canonical owner | Others reclassified as |
|---|---|---|
| Active assignment coordination | `engineering/ACTIVE_WORKSTREAMS.md` | `session-state/*` → historical snapshot |
| Current build program | `specifications/rough-complete-build-blueprint.md` | — |
| Reconciled roadmap | `roadmaps/roadmap-reconciliation-2026-07.md` | `ROADMAP.md` → superseded; `SPRINT_STATUS.md`, `SprintRoadmap.md` → historical snapshots |
| Deployment truth | `Deployment.md` | `DeploymentModeStrategy.md` keeps mode *vocabulary* only |
| Capability + implementation state | `PlatformCapabilityModel.md` §5a | — |
| Code-level ownership | `architecture/SYSTEM_AUTHORITIES.md` | — |
| Decision record | `DECISIONS.md` | `CLAUDE_CONTEXT.md` → working aid / historical snapshot |
| Baseline & worktree discipline | `engineering/AI_ENGINEERING_OPERATING_MODEL.md` §8a | `ai/claude-code.md` line retained, subordinate |

## 5. Deployment topology and unresolved unknowns

Four independent surfaces; three gated, one not. Full detail in [`../Deployment.md`](../Deployment.md).

**Highest-priority finding — GitHub Pages is an ungated production surface.** `.github/workflows/deploy-field-ops.yml` publishes on every merge to `main`. The client's Firebase configuration is **hardcoded in `src/firebase/firebase.js`** (`projectId: "taylor-parts"`, production `authDomain`, `us-central1` Functions); the workflow injects no environment and consumes no secrets; the emulator branch is `import.meta.env.DEV`-gated and unreachable in a production build; and `src/config/env.js` blocks writes only under `?env=demo`. **A merge to `main` therefore publishes a write-enabled production client** with no release candidate, no Owner experience review, and no production authorization — bypassing the promotion lifecycle in `AI_ENGINEERING_OPERATING_MODEL.md` §7 and the Owner reservation in `DelegationCharter.md` §8.3/§8.7.

Recorded only. **No remediation performed** — changing this workflow alters production behavior and is protected.

| # | UNKNOWN | Read-only evidence required |
|---|---|---|
| U-1 | Which surface real users use (Pages vs Hosting); whether both are live. | Owner statement of the distributed URL + `firebase hosting:releases:list --project taylor-parts` + read-only fetch of both URLs. |
| U-2 | Whether the published Pages build matches current `main`. | Read-only fetch of the Pages asset manifest vs a local build at the same SHA. |
| U-3 | Whether any Firestore backup/PITR configuration exists. | `gcloud firestore databases describe` (read-only). No repository evidence of any backup posture exists. |
| U-4 | Live index state vs `firestore.indexes.json`. | `firebase firestore:indexes --project taylor-parts` (read-only). |
| U-5 | Whether the 22-Function estate still matches the repository record. | `firebase functions:list --project taylor-parts --json` (read-only). |

## 6. Elevated risks — confirmed, not solved

Per assignment these were confirmed from repository evidence and elevated; **no Rules, migration, authorization, routing, or data-model change was made.**

**R-1 · Duplicate authorization model (live in production).** The governed capability/role model (`functions/src/access/`, 17 modules; `roleAssignment` + audited grants) runs **alongside** legacy `users/{uid}.role`, still an active compatibility source inside the deployed `firestore.rules`. Two authorities decide access in production simultaneously. Governing sequence: Issue **#226**, Rows 23–28 (`#265`–`#270`), with **#270 "Retire raw role authority"** as the terminal step, then #271 full release verification, #272 document reconciliation, #273 close #226. This is a **security-model** concern and every step is Tier 2.

**R-2 · Duplicate domain model.** `fieldops_jobs` (12 source files) and `fieldops_wos` (31) both persist. `modules/mobile/FieldMode.jsx` — the technician's primary surface — remains entirely job-based and untouched by the Work Order model. Governing sequence: build-blueprint wave **W4**, explicitly non-destructive per ruling R1.

**Ranked implementation gaps (highest first):**

1. **R-1 duplicate authorization model** — live production security surface, two authorities.
2. **Ungated production frontend** (Pages) — releases bypass the promotion lifecycle.
3. **No observability** — no ability to detect that 1 or 2 has caused harm.
4. **No backup/recovery posture** — unbounded blast radius for any data incident; U-3 unresolved.
5. **R-2 duplicate domain model** — correctness and user-experience fragmentation; contained by W4.
6. **No configuration layer** — blocks any second operating company.
7. **No integration surface** — blocks the Enterprise Integration deployment mode.
8. **Administration mutations undeployed** (#226 Rows 19/20) — governed admin actions unavailable in production.

Note the ordering rationale: gaps 3 and 4 rank above most functional work because they are what make every other gap *detectable and survivable*. This supports sequencing C3 Operational Readiness ahead of commercial work.

## 7. ECF disposition — RECONCILE THEN ACTIVATE

**Evidence.** [`../governance/ENTERPRISE_CERTIFICATION_FRAMEWORK.md`](../governance/ENTERPRISE_CERTIFICATION_FRAMEWORK.md) is 22 lines. It names three Core Artifacts — Enterprise Certification Matrix, Recommendation Register, Certification History. A repository-wide search finds **no instance of any of the three**. No certification has been run; its "Baseline Approved" status was misleading and is corrected.

**Is it superseded?** No. Its concern is *periodic, delta-based, whole-estate conformance certification with executive exception reporting*. Nothing else owns that: `AI_ENGINEERING_OPERATING_MODEL.md` §6 governs **per-capability** completion; `audit-artifact-standard.md` governs **evidence shape**; `DECISIONS.md` records **decisions**. None certifies the estate as a whole on a cadence.

**Would activation add real control?** Yes — and this truth pass is the proof. Its findings (index drift, four stale maturity claims, three false deployment statements, an ungated production surface) are exactly what a delta certification is designed to catch on a cadence rather than by luck.

**Reconciliations required before activation:** (a) bind certification scope to the DESIGNED→…→RETIRED promotion lifecycle instead of defining a parallel review; (b) adopt `audit-artifact-standard.md` for evidence shape rather than inventing one; (c) define Green/Yellow/Red against the §5a implementation-state axis so certification cannot repeat the maturity-vs-implementation conflation this program corrected.

**Recommended baseline commit:** the merge commit of this truth pass — the first point at which repository statements are verified true against implementation.

Activation is a separate assignment and was **not** performed here.

## 8. Recommended sequence after Program 0

Unchanged from the accepted assessment, with one evidence-based amendment.

1. **C1 — Company Charter.**
2. **C3 — Operational Readiness Architecture.** Confirmed as the binding constraint: gaps 3 and 4 above make every other gap undetectable and unsurvivable.
3. **Tier-2 ADR program** — Tenancy, Configuration, Integration & platform events.
4. **C4 — Delivery Organization.**
5. **C2 — Commercial Architecture** (deferred by Owner decision until C3 has a credible baseline).
6. **C5 — Certification Activation** (per §7).

**Amendment — the risk exception is met.** R-1 is a *live production* duplicate authorization model, not a latent one. Its retirement sequence (#265–#270) should be scheduled against C3 rather than behind the company-document sequence. Sequencing is an Owner call; the evidence supports elevation.

## 9. Scope boundary honored

No change was made to: `firestore.rules`, Cloud Functions, Hosting, GitHub Pages, DNS, identity, capability grants, data, or any deployment. No production command was executed. No implementation of tenancy, configuration, integrations, observability, authorization migration, or domain migration was begun — this program defines target state and sequencing only; Product Engineering implements approved capabilities separately.
