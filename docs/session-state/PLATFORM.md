# Platform Session State

## Baseline
- Main commit: `8f28d22a12aa0a19912fddd50f1605befc9a3a89`
- Last reconciled: 2026-07-27
- Relevant PRs: #451 (AUTH-PR-4 readiness, merged `8f28d22`); #444 (AUTH-PR-3, merged `e53c7b0`, not deployed)
- Relevant issues: #226

## Current Objective
None active. Platform is on **standby** for two future, separately-authorized authentication gates: (1) building/reviewing the **governed operator workflow** for AUTH-PR-4, and (2) the **later production identity-mutation gate** (and any AUTH-PR-3 deployment / email-provider configuration). Authentication architecture and repository implementation are owned by the Customer session.

## Status
Standby (production configuration / deployment only).

## Delta Since Last Handoff
- AUTH-PR-2 and AUTH-PR-3 (#444, `e53c7b0`) are merged; AUTH-PR-3 is **not deployed and not enabled**. The **AUTH-PR-4 readiness package** (PR #451) is now merged at `8f28d22` — see [`docs/deployment/auth-pr-4-readiness-authorization-package.md`](../deployment/auth-pr-4-readiness-authorization-package.md).
- **No deployment or production activation** is established by any of this. The **governed operator workflow is not built and not yet authorized**; **production identity mutation is not authorized**; **no email migration, reset/verification send, explicit `revokeRefreshTokens`/operator session revocation, provider configuration, or deployment** occurred. A **Firebase-triggered** session invalidation is only a documented possible future platform effect of an email change — **none occurred, because no email was changed.**
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
None active. Engage only when the Owner opens a separately-authorized gate — the AUTH-PR-4 operator-workflow build/review, or a later production identity-mutation / AUTH-PR-3 deployment / email-provider configuration gate. Until then, no Platform production action.

## Stop Conditions
- PR head changes during review.
- Missing emulator evidence for security-sensitive paths.
- Any provider configuration, deployment, production reset, revocation, identity, role, or claim mutation.
- Architecture change outside the approved AUTH-PR-1 boundary.

## Last Updated
- Date: 2026-07-27
- Commit: `8f28d22a12aa0a19912fddd50f1605befc9a3a89`
- Updated by: Customer session (maintains Platform tracking)
