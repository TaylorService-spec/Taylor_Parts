# Platform Session State

## Baseline
- Main commit: `3591fa87fee24c78b1125cbe067b493a95035aab` (was `bc0fda57`; advanced by AUTH-UI / AUTH-PR-3.5 #469–#472, repo/emulator-only — no AUTH-PR-4 governed-file change)
- Last reconciled: 2026-07-28
- Relevant PRs: AUTH-PR-4 chain merged — readiness #451, operator workflow #453, enablement #457, GRANT #460 (DECISIONS #52), initializer + 3-file set #461 (`dba0e33`), CI enforcement #463 (`9b912d7`), three-file re-authorization #462 (`602ed1f`, DECISIONS #53); #444 (AUTH-PR-3, `e53c7b0`, not deployed)
- Relevant issues: #226

## Current Objective
None active. **AUTH-PR-4 status (reconciled 2026-07-28):** Gate A + Gate B were granted and run (forward positions 1→5, position 5 rolled back); the progression is `suspended` at revision 12 with positions 1–4 migrated by explicit Owner disposition; four rollback artifacts remain protected. PR #467 (`bc0fda57`) merged the reverse-order rollback-continuation + workflow-identity transition (repo/emulator only). **The Owner CANCELLED the reverse-order rollback continuation**; the re-authorization prep PR #468 is CLOSED/UNMERGED (retained; do not reopen/merge/revise/delete). No re-authorization or workflow-identity transition occurred — main's `production-authorization.json` is still bound to `reviewedHead dba0e33` and no longer verifies against the merged code (production fail-closed). **No further AUTH-PR-4 execution is authorized, so no Platform action is required.** Platform remains on standby only for a future, separately-authorized AUTH-PR-3 deployment gate. Authentication architecture and repository implementation are owned by the Customer session.

## Admin Password-Reset Production Boundary (roadmap items #4/#5)
Platform remains on **standby** for admin password reset. **No Platform action is required or authorized now.** The delivery decision is **resolved: D-DELIVERY-NATIVE APPROVED (DECISIONS #56)** — a **Firebase-native server-side send** (`REQUEST_ACCEPTED`-only, **no external provider**; external providers remain indefinitely deferred, #54). The revised backend (AUTH-PR-3.5) is **built and tested repository/emulator-only** (native send seam wired `NOT_CONFIGURED_NATIVE_SEND` = fail-closed; no reset-link generation; guards enforced; `admin.credentialReset.initiate` registered **inactive**). **Nothing is deployed or activated.** The next gate is **AUTH-PROD-1** (real-Firebase behavior verification), which needs a **separate Owner production authorization**; then AUTH-PROD-2/3 for any deployment. When a production gate opens it must deploy **only** `initiateAdminPasswordReset` + `listResetEligibleUsers`, never bundled with AUTH-PR-4 or Inventory/Equipment, and satisfy the DECISIONS #55 hard stops. No Functions/config deployment is pending or authorized for admin reset; **no production authorization exists** for it; **no production execution has occurred.** When a production gate opens it must deploy **only** `initiateAdminPasswordReset` + `listResetEligibleUsers` — never bundled with AUTH-PR-4 or Inventory/Equipment — and must satisfy the DECISIONS #55 hard stops and gate-specification requirements. Do not introduce an external provider (#54).

## Status
Standby (production configuration / deployment only).

## Delta Since Last Handoff
- **AUTH-PR-4 ROLLBACK-LANE CLOSURE (2026-07-28, supersedes the "no deployment or production activation" bullet below):** Gate A + Gate B ran (forward 1→5, position 5 rolled back); progression `suspended` at revision 12, positions 1–4 migrated; four rollback artifacts protected. PR #467 (`bc0fda57`) merged the rollback-continuation + workflow-identity transition. The Owner **cancelled** the reverse-order rollback continuation; PR #468 (re-authorization prep) is CLOSED/UNMERGED (retained; do not reopen/merge/revise/delete). No re-authorization / workflow-identity transition occurred; production stays fail-closed (main's artifact still bound to `reviewedHead dba0e33`). No further AUTH-PR-4 execution is authorized; no Platform action required. The bullet immediately below (about AUTH-PR-4) predates Gate A/B and is retained only as lineage.
- AUTH-PR-2 and AUTH-PR-3 (#444, `e53c7b0`) are merged; AUTH-PR-3 is **not deployed and not enabled**.
- The **AUTH-PR-4 production authorization is now GRANTED and re-bound to the three-file governed set** (DECISIONS #52 grant via #460; three-file re-binding #53 via #462, `602ed1f`). The governed workflow + production gate + genesis initializer are merged (#453/#457/#461, `dba0e33`), and their security suites are **CI-enforced** on `main` (#463, `9b912d7`) with the gate/migration Auth-emulator layers on `demo-authpr4`. The committed artifact **verifies** (GRANTED, 3 files). Still, **no deployment or production activation** has occurred: **no email migration, reset/verification send, explicit `revokeRefreshTokens`/operator session revocation, provider configuration, deployment, state key, genesis, private mapping, or credential** — merging changed nothing in production. A **Firebase-triggered** session invalidation is only a documented possible future platform effect; none occurred, because no email was changed. The next AUTH-PR-4 steps are Gate A (genesis prep) then Gate B (one-at-a-time execution); neither is authorized.
- Per the Owner operating model, the Customer session owns Authentication architecture and repository implementation; Platform involvement is required only for separately-authorized production configuration or deployment. The prior ownership-confirmation gate is closed.

## Decisions
- [`auth-modernization-architecture.md`](../assessments/auth-modernization-architecture.md)
- [`ADR-005-enterprise-authorization-migration-strategy.md`](../architecture/ADR-005-enterprise-authorization-migration-strategy.md)
- [`DECISIONS.md`](../DECISIONS.md)

## Dependencies
- Issue #226 governed access and audit mechanisms.
- Separate authorization for any Functions deployment or production enablement.
- Owner decision for an email-delivery provider remains outside repository-only implementation.
- Equipment and Work Orders remain Platform concerns unless governance assigns a narrower lane.

## Production Evidence

### Verified
- None for AUTH-PR-3.

### Unverified
- Deployed behavior of AUTH-PR-3.
- Delivery-provider integration.
- Production enumeration-protection compatibility.

### Failed
- None recorded here.

### Not applicable
- Green CI does not constitute production verification.

## Risks
- Critical: credential-reset behavior causing lockout, secret disclosure, duplicate effects, or incomplete auditing.
- High: deploying exported Functions without a separate production gate.

## Next Action
None active. AUTH-PR-4's reverse-order rollback continuation was **cancelled** by the Owner (PR #468 CLOSED/UNMERGED); no Platform action is required. Engage only when the Owner opens a later, separately-authorized AUTH-PR-3 deployment gate. Until then, no Platform production action.

## Stop Conditions
- PR head changes during review.
- Missing emulator evidence for security-sensitive paths.
- Any provider configuration, deployment, production reset, revocation, identity, role, or claim mutation.
- Architecture change outside the approved AUTH-PR-1 boundary.

## Last Updated
- Date: 2026-07-28
- Commit: `3591fa87fee24c78b1125cbe067b493a95035aab`
- Updated by: Customer session (maintains Platform tracking) — AUTH-PR-4 rollback-lane closure reconciliation
