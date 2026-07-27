# Customer Session State

## Baseline
- Main commit: `8f28d22a12aa0a19912fddd50f1605befc9a3a89`
- Last reconciled: 2026-07-27
- Relevant PRs: #451 (AUTH-PR-4 readiness/authorization package, Customer-owned) — **MERGED** at `8f28d22`; predecessor #444 (AUTH-PR-3) merged at `e53c7b0` (not deployed, not enabled)
- Relevant issues: #226 (Functions lane governing AUTH-PR-3)

## Current Objective
Authentication Modernization (owned here): the **AUTH-PR-4 readiness & Owner authorization package** ([`docs/deployment/auth-pr-4-readiness-authorization-package.md`](../deployment/auth-pr-4-readiness-authorization-package.md)) is **merged** (PR #451, `8f28d22`). **AUTH-PR-4 execution remains BLOCKED** — it is authorized by nothing yet and STOPS at the gate.

## Status
Active.

## Delta Since Last Handoff
- Per the Owner operating model, the Customer session owns Authentication architecture and repository implementation (and also maintains Platform and Coordination tracking; there is no independent Coordination session).
- **AUTH-PR-4 readiness is complete and merged** (PR #451 → `8f28d22`; Codex FINAL PASS at head `b76ccc2`). The package defines the sanitized persona inventory, Gmail `+alias` readiness, one-at-a-time order (lower-risk first, primary admin last, break-glass untouched), preflight/stop conditions, collision/disabled-user handling, exact `emailVerified` rollback, reset-email/session boundaries, evidence sanitization, the exact production identity-mutation authorization wording (drafted, not granted), and the unresolved Owner decisions.
- **What has NOT happened and is NOT authorized:** the **governed operator workflow/script is not built and not yet authorized** (its own separate repository gate); **production identity mutation is not authorized**; **no email migration, no reset/verification email send, no explicit `revokeRefreshTokens`/operator session revocation, no email-provider configuration, and no deployment** occurred. **Firebase-triggered refresh-token/session invalidation** is only a **documented possible future platform effect** of an email change — **none occurred, because no email was changed.**

## Decisions
- [`customer-domain-foundation.md`](../architecture/customer-domain-foundation.md)
- [`DECISIONS.md`](../DECISIONS.md)

## Dependencies
- Preserve `customerId` and `locationId` compatibility with Work Orders.
- Equipment remains outside this workstream unless repository governance explicitly reassigns it.
- Authentication architecture and repository implementation are owned here; Platform involvement is required only for separately-authorized production configuration or deployment.

## Production Evidence

### Verified
- None recorded here.

### Unverified
- Current Customer-domain production parity.

### Failed
- None recorded here.

### Not applicable
- No production operation is authorized by this file.

## Risks
- High: destructive customer/location migration could break Work Order references.
- Medium: absorbing Equipment would create unclear domain ownership.

## Next Action
Return the next Owner decision package: (A) authorization to build the **repository-only governed operator workflow** (dry-run default, `taylor-parts` project guard, exact ordered persona allowlist, protected out-of-band alias mapping, enabled-user/UID/collision/break-glass preflight, one-at-a-time, forward `emailVerified=false`, exact rollback to prior address + captured prior verification state, no reset-email send, no explicit `revokeRefreshTokens`, sanitized evidence + secret cleanup, emulator/non-production tests, **no deployment or execution**); and (B) the decisions still deferred until after that workflow is reviewed (production identity-mutation authorization, private Gmail base inbox + alias mapping, named production executor, break-glass readiness confirmation, later mailbox-verification/reset-delivery test, D-EMAIL-DELIVERY provider, enumeration-protection production gate). **Do not build the operator workflow and do not begin AUTH-PR-4 execution until the Owner explicitly authorizes that gate.**

## Stop Conditions
- Missing authorization for a new implementation phase.
- Proposed destructive migration without approved reconciliation and rollback.
- Any change that absorbs Equipment or breaks existing customer/location references.
- Conflict with another workstream’s active PR.

## Last Updated
- Date: 2026-07-27
- Commit: `8f28d22a12aa0a19912fddd50f1605befc9a3a89`
- Updated by: designated Customer session
