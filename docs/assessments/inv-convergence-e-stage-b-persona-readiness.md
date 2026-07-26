---
artifact_type: assessment
unit: INV-CONVERGENCE-E Stage B — production persona readiness (PARTS_MANAGER, WAREHOUSE_MANAGER)
gate: read-only persona readiness assessment — no identity mutation, no deployment
status: Draft — repo-grounded; current live state pending operator read-only re-verification
date: 2026-07-26
baseline: f38703dca4cc6e07c782b098f2677015d68ce648 (origin/main — after PR #434 deploy handoff merge)
related: docs/operations/inv-convergence-e-stage-b-rules-deploy-handoff.md (§3.1 Path A / Path B); docs/DECISIONS.md #11
authorizes: nothing — no identity creation/mutation, no fixture creation, no Rules deployment, no C1
---

# INV-CONVERGENCE-E Stage B — production persona readiness assessment

Resolves the deploy-handoff §3.1 readiness question for the **two blocking positive branches** of the broadened `parts` read predicate: does an **existing governed production test persona** already satisfy each of

- active reciprocally-linked **PARTS_MANAGER**, and
- active reciprocally-linked **WAREHOUSE_MANAGER**

so that each can be exercised **directly** in production during the deploy verification matrix — **without creating or mutating any identity**?

**This assessment authorizes nothing.** It is a read-only, repo-grounded determination. I hold no production credentials and did not (and will not) inspect live production; confirming *current* live state is an operator read-only action (below).

## 1. Rules requirement (origin/main)

`firestore.rules` at `f38703d` grants `parts` read to `isActiveOperationalRole(role)` (helper at `firestore.rules:112`), which requires: signed-in · `users/{uid}.employeeId` set · the reciprocal `employees/{employeeId}.userId == request.auth.uid` · `employmentStatus == "ACTIVE"` · `operationalRoles is list` · `operationalRoles.hasAny([role])`. A persona satisfies a branch only in that exact state.

## 2. Repo-grounded evidence (governed record)

`docs/DECISIONS.md` **entry #11** (2026-07-11; six commands run by the Owner against `taylor-parts` at repo state `f02f0a3…`, per the governed `onboard-employee` runbook) records two personas with the exact target state:

| Employee ID | securityRole | operationalRoles | Provisioned via | Owner-reported verification |
|---|---|---|---|---|
| `emp-rudy-parts-manager` | dispatcher | `[PARTS_MANAGER]` | `provisionEmployeeAccess.js` `--requireExistingAuthUser` | **PASS** — Employee exists, `employmentStatus == ACTIVE`, `employees/{id}.userId` ↔ `users/{uid}.employeeId` reciprocal, roles match |
| `emp-rudy-warehouse-manager` | dispatcher | `[WAREHOUSE_MANAGER]` | `provisionEmployeeAccess.js` `--requireExistingAuthUser` | **PASS** — same as above |

Supporting facts:
- `functions/scripts/provisionEmployeeAccess.js` is the governed **Admin-SDK operator** provisioner (the *only* writer of the bidirectional `employees.userId` ↔ `users.employeeId` link; client writes to both are denied by Rules). Its `VALID_OPERATIONAL_ROLES` includes both `PARTS_MANAGER` and `WAREHOUSE_MANAGER`; it sets `employmentStatus = "ACTIVE"` on create and writes the reciprocal link transactionally.
- `functions/scripts/onboardEmployeeVerify.js` is the governed **read-only** verifier (requires production Admin-SDK creds + `--confirmProduction taylor-parts`; makes no writes).
- The repo **deliberately records no UIDs or emails** for these personas (only Employee IDs + roles) — consistent with the sanitization convention.

## 3. Classification

Both branches map to **READY VIA EXISTING GOVERNED PERSONA** on the repo-grounded record — **conditional on operator read-only re-verification of current live state** (§4):

- **PARTS_MANAGER → READY VIA EXISTING GOVERNED PERSONA (conditional).** Governed persona of record: `emp-rudy-parts-manager`, `operationalRoles:[PARTS_MANAGER]`, ACTIVE, reciprocally linked (DECISIONS #11). No new identity is required; **no mutation** is needed to use it.
- **WAREHOUSE_MANAGER → READY VIA EXISTING GOVERNED PERSONA (conditional).** Governed persona of record: `emp-rudy-warehouse-manager`, `operationalRoles:[WAREHOUSE_MANAGER]`, ACTIVE, reciprocally linked (DECISIONS #11). Same — no new identity, no mutation.

Each persona is **distinct** and carries **only its own** operational role; PARTS_MANAGER and WAREHOUSE_MANAGER are exercised independently (neither substitutes for the other), exactly as the deploy matrix requires.

## 4. What requires operator read-only re-verification (not knowable from the repo)

The record is 15 days old (2026-07-11) and the repo carries no continuous liveness signal — indeed an earlier entry notes production `employees` may have been empty at a verification point. **Persistence of these two personas to today is not determinable from the repo.** Before either persona is used in the deploy verification matrix, the operator must run a **read-only, non-mutating** confirmation (e.g. `functions/scripts/onboardEmployeeVerify.js --confirmProduction taylor-parts` for `emp-rudy-parts-manager` and `emp-rudy-warehouse-manager`, or a Console read) and confirm, for each: Employee exists · `employmentStatus == "ACTIVE"` · `employees.userId` ↔ `users.employeeId` reciprocal link intact · `operationalRoles` contains the required role. Record only sanitized labels + PASS/FAIL (no UID/email/token/raw doc).

- If both re-verify **PASS** → both are **READY VIA EXISTING GOVERNED PERSONA** and Path A is satisfied; **no fixture gate is required**.
- If either re-verify **FAILS** (persona absent/changed) → that role becomes **REQUIRES SEPARATE FIXTURE GATE** (§5).

## 5. Fixture scope — only if operator re-verification fails (NOT authorized here)

If (and only if) re-verification shows a persona no longer satisfies the state, a **separate Owner-authorized governed fixture gate** (deploy-handoff §3.1 Path B) would re-establish it via the existing governed path — `provisionEmployeeAccess.js --requireExistingAuthUser` against the Owner's existing Auth account, `--operationalRoles PARTS_MANAGER` (or `WAREHOUSE_MANAGER`), `employmentStatus` ACTIVE — with a reviewable plan, audit record, lifecycle/cleanup, rollback, and confirmation that no *other* employee's access changes. **That is identity mutation and is a hard stop: it is not authorized by this assessment and must not be performed here.**

## 6. Confirmations

- **No identity mutation occurred.** This assessment is a read-only, repository-only determination; no production user/employee/role/claim/link/status/accessVersion was created, read live, or changed.
- **No production credentials were used** (none are held); no live production inspection was performed.
- **Deployment remains BLOCKED** unless **both** PARTS_MANAGER and WAREHOUSE_MANAGER are READY (Path A confirmed by operator read-only re-verification, or Path B fixture gate completed) **and** each is exercised **directly** in production returning ALLOW during the deploy verification matrix.
- Decisions #43–#46 unchanged.

## 7. Recommended next step (for the Owner — a hard stop, not performed here)

Operator runs the **read-only** re-verification of §4 for the two Employee IDs and reports sanitized PASS/FAIL. On dual PASS, Path A is satisfied and the deploy gate's persona precondition for #5/#6 is met (deployment still separately authorized). On any FAIL, open the Path B fixture gate for the affected role.
