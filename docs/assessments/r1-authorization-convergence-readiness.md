---
artifact_type: assessment
gate: R-1 Authorization Convergence — readiness against ADR-005 §2.7
status: Complete — readiness assessed; execution is Owner-gated at its first step
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: c002b5ee0834998207f7966be40bbd718cbd0e28 (verified origin/main)
extends: docs/implementation-plans/enterprise-access-and-administration-platform.md (Issue #226, Rows 19-31)
authority: docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md §2.7
scope: Assessment only. No Rules, Functions, identity, capability-grant, migration, or deployment change.
---

# R-1 — Authorization Convergence Readiness

**This assessment does not restate or replace the Issue #226 implementation plan.** That plan already owns Rows 19–31, including Row 27 (prove all twelve ADR-005 §2.7 criteria) and Row 28 (remove raw role authority). What did not exist — and what this adds — is a **measured current-state readiness baseline** against those twelve criteria, plus the critical-path analysis that determines when Rows 23–28 can actually begin.

Per Owner direction 2026-08-06: R-1 is elevated above C1 Company Charter. **Do not collapse it into a broad rewrite** — follow the governed sequence, preserving parity tests, rollback coverage, production verification, and existing protected boundaries.

---

## 1. The finding that determines the whole program

**R-1's critical path does not begin with repository work. It begins with a protected production deployment that has not been authorized.**

ADR-005 §2.7 forbids retirement until, among others, criterion **4** ("applicable Cloud Functions use the approved model") and criterion **5** ("the approved Admin portal is active") are true. Both depend on the trusted access backend being deployed. That deployment is Issue #226 **Row 20** (`#262`), which is gated on **Row 19** (`#261`, production authorization request) — **both OPEN**. Row 22 (`#264`, enable admin mutations) is likewise OPEN.

The domain enforcement cutovers the Owner named — Rows 23–26 (`#265`–`#268`) — move each domain onto the Permission engine. Cutting a domain over to an engine whose trusted mutation backend is not deployed would either (a) fail closed and remove working functionality, or (b) require a temporary client-side authority path, which is precisely the second authorization model this program exists to eliminate.

**Therefore:**

| Phase | Rows | Who can execute | Status |
|---|---|---|---|
| **R1-A — Readiness (repo-only)** | pre-23 | AI agent, Tier 1 | **Available now.** Not yet done. |
| **R1-B — Backend activation** | 19, 20, 22 | **Owner + human operator only** | **BLOCKED — protected boundary.** |
| **R1-C — Domain cutovers** | 23, 24, 25, 26 | AI agent builds; each Rules change Tier 2 | Blocked behind R1-B. |
| **R1-D — Retirement** | 27, 28 | Row 27 proof, then Owner-confirmed removal | Blocked behind R1-C. |
| **R1-E — Closure** | 29, 30, 31 | Verification, docs, close #226 | Blocked behind R1-D. |

The single highest-value action available to an AI agent on R-1 today is **completing R1-A so that R1-B's authorization request is decidable on evidence rather than judgment**. That is the recommendation in §5.

## 2. Measured conformance baseline (criterion 1)

ADR-005 §2.7 criterion 1: *"no direct `admin`/`dispatcher`/`technician` authorization checks remain outside the compatibility boundary."* Measured at `c002b5e`:

| Surface | Legacy-role authority sites | Notes |
|---|---|---|
| `firestore.rules` (**deployed**) | **66** | `isAdminOrDispatcher()` ×61, `isAdmin()` ×3, `isTechnician()` ×2 — all resolving through `userData().role`, i.e. `users/{uid}.role`. |
| `firestore.rules` governed-model sites | 12 | `operationalRoles` reciprocal-link checks (Issue #100 model). |
| Client raw role comparisons | **20** | `role === "admin"|"dispatcher"|"technician"` / `ROLES.*` literals. |
| Client nav authority | 6 files | via `domain/constants.js` `ROLE_NAV_ACCESS`. |
| Client capability-based surfaces | 16 files | `resolveEffectivePermission` / `permissionCatalog` / `useReportCapabilities`. |
| Functions compatibility-role surfaces | 12 files | `access/compatibilityRoles.ts` and consumers. |

Rules mirror parity (`firestore.rules` ↔ `field-ops-app-vite/firestore.rules`): **in sync**.

**Reading:** 66 live authorization decisions in production Rules still resolve through the legacy role field. This is not a residue — it is still the *primary* authorization authority for most collections. The governed model is additive alongside it, exactly as ADR-005 §2.1's Hybrid Compatibility Model intends at this stage. Criterion 1 is **far from met**, and the number is the honest measure of the remaining program.

## 3. Criterion-by-criterion readiness

| # | ADR-005 §2.7 criterion | Status | Evidence / gap |
|---|---|---|---|
| 1 | No direct role checks outside the compatibility boundary | **NOT MET** | 66 Rules sites + 20 client sites (§2). |
| 2 | Every protected domain uses the Permission engine | **NOT MET** | Rows 23–26 are the work; all OPEN. |
| 3 | Applicable Firestore Rules use the approved model | **PARTIAL** | 12 governed sites vs 66 legacy. |
| 4 | Applicable Cloud Functions use the approved model | **BLOCKED** | Trusted access mutation Functions undeployed (Row 20). |
| 5 | Approved Admin portal is active | **BLOCKED** | Row 22 OPEN; `AdministrationUnavailable.jsx` is the current state. |
| 6 | Immutable auditing production-verified | **UNKNOWN** | `access/auditEventWriter.ts` exists; production verification not evidenced. Needs U-5-class read-only evidence. |
| 7 | Compatibility and parity tests pass | **PARTIAL** | `shadowParityHarness.ts` exists and is dual-mirrored; 10 parity test files; **no shadow-parity CI workflow gates the cutover**. See §4. |
| 8 | Issue #100 operational-role behaviour preserved | **PARTIAL** | 12 `operationalRoles` Rules sites live; no regression harness spanning both models. |
| 9 | Issue #175 governed-field enforcement preserved | **UNKNOWN** | #175 still OPEN. |
| 10 | Production verification passes | **BLOCKED** | Requires R1-B. |
| 11 | Rollback tested and documented | **NOT MET** | No rollback procedure exists for an authorization cutover specifically. See §4. |
| 12 | No authorization regression remains | **NOT MET** | Cannot be asserted without 7 + 11. |

**Zero of twelve criteria are met. Three are blocked on a protected production action. Two are UNKNOWN pending read-only evidence.**

## 4. The two gaps that make R-1 unsafe to start

These are the reasons R1-A exists as a distinct phase rather than going straight to Row 23.

**G-1 · Parity is measurable but not enforced.** `shadowParityHarness.ts` is pure, non-authoritative, dual-mirrored, and correctly designed — it compares the new resolver against the seeded-compatibility oracle and enforces nothing. But **no CI workflow runs it as a gate**, and there is no per-domain parity corpus covering the 66 Rules decision sites. A domain cutover (Row 23–26) is a change to who can read and write production data; without an enforced, domain-scoped parity gate, the only regression detector is production itself. ADR-005 criterion 7 cannot be honestly asserted from "the harness exists."

**G-2 · No authorization rollback procedure exists.** The repository has mature rollback practice for deployments (pinned revisions, pre-deploy baselines, `docs/operations/*-handoff.md`). It has none for an authorization model cutover, where rollback means restoring a prior Rules revision *and* reconciling any access decision made in the interim. Criterion 11 is unmet by absence, not by failure.

Both gaps are **repo-only and Tier-1 addressable**. Neither requires a production action. This is what makes R1-A both available and worth doing first.

## 5. Recommended R1-A scope (repo-only, no protected boundary)

Ordered by leverage. Each is independently mergeable; none touches Rules, Functions, identity, grants, or deployment.

1. **Domain parity corpus.** Enumerate the 66 Rules legacy-role decision sites and the 20 client sites, grouped by the Row 23–26 domain that will cut them over (Customer/Account · Inventory/Reorder/Purchasing · Service/Work Orders · Navigation/shared-UI). Output: a per-domain inventory that makes each cutover's blast radius explicit and countable. *This is also the artifact Row 27 needs to prove criterion 1 with citations rather than assertions.*
2. **Enforced shadow-parity CI gate.** Promote the existing harness to a blocking workflow over that corpus, so divergence from the compatibility oracle fails the build. Closes G-1 and makes criterion 7 assertable.
3. **Authorization rollback procedure.** A runbook for reverting a domain cutover: prior Rules revision pinning, the reconciliation question for interim decisions, and the verification that rollback restored prior behaviour. Closes G-2 and criterion 11. Reuses `docs/governance/audit-artifact-standard.md` and the existing handoff template — no new governance.
4. **Criteria 6 and 9 evidence.** Resolve the two UNKNOWNs — audit immutability via read-only production evidence (§6), and #175 governed-field enforcement by repository inspection.

Completing 1–4 converts Row 19's authorization request from a judgment call into an evidenced decision, which is the actual bottleneck.

## 6. Evidence still required from the Owner

Criterion 6 (immutable auditing production-verified) cannot be established from repository evidence. The required read-only commands are bundled into [`../operations/eao-readonly-evidence-package.md`](../operations/eao-readonly-evidence-package.md) rather than requested separately.

## 7. Sequencing note (Operating Model §1a)

Applying evidence-based sequencing to R-1 itself: the Owner elevated R-1 to first position on *active production security risk*, which is priority 1 and correct. But R-1's execution front is **blocked by a protected dependency** (priority 2), and the unblocking work is repo-only readiness. So the honest order within R-1 is **R1-A now, R1-B on Owner authorization** — not "start Row 23."

This also means R-1 and **R-2** (Pages promotion remediation) are **not mutually blocking**: R-2's design work is available in parallel and has no dependency on R1-B. Both were therefore progressed in the same program window rather than serialized. See [`../design/pages-production-promotion-target-state.md`](../design/pages-production-promotion-target-state.md).

## 8. Boundaries honored

No change to `firestore.rules`, Cloud Functions, identity, capability grants, role assignments, data, or any deployment. No production command executed. This assessment authorizes nothing; each Rules change in Rows 23–26 remains Tier 2, and Rows 19/20/22 remain Owner-gated production actions.
