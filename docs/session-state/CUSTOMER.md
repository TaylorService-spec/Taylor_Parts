# Customer Session State

## Baseline
- Main commit: `63b47b7d362d1da6e09041879b77eab676c07a61`
- Last reconciled: 2026-07-27
- Relevant PRs: AUTH-PR-4 readiness #451 (`8f28d22`) + operator workflow #453 (`63b47b7`) — both **MERGED**; predecessor AUTH-PR-3 #444 (`e53c7b0`, not deployed/enabled). This session opens the production-enablement **design** PR (repository-only preparation).
- Relevant issues: #226 (Functions lane governing AUTH-PR-3)

## Current Objective
Authentication Modernization (owned here): the AUTH-PR-4 readiness package (#451) **and** the governed operator workflow (#453, `63b47b7`) are merged. The workflow is on `main` but **mechanically production-disabled** (production `--execute`/`--rollback` throw before SDK init). **AUTH-PR-4 production identity mutation remains NOT AUTHORIZED.** Current work: a repository-only **production-enablement design package** ([`docs/deployment/auth-pr-4-production-enablement-design.md`](../deployment/auth-pr-4-production-enablement-design.md)) proposing the DECISIONS #52 authorization (PENDING/unsigned) and designing the narrow, authorization-bound enablement change — **no enablement code, no execution.**

## Status
Active.

## Delta Since Last Handoff
- Per the Owner operating model, the Customer session owns Authentication architecture and repository implementation (and also maintains Platform and Coordination tracking; there is no independent Coordination session).
- **AUTH-PR-4 readiness is complete and merged** (PR #451 → `8f28d22`; Codex FINAL PASS at head `b76ccc2`). The package defines the sanitized persona inventory, Gmail `+alias` readiness, one-at-a-time order (lower-risk first, primary admin last, break-glass untouched), preflight/stop conditions, collision/disabled-user handling, exact `emailVerified` rollback, reset-email/session boundaries, evidence sanitization, the exact production identity-mutation authorization wording (drafted, not granted), and the unresolved Owner decisions.
- **The governed operator workflow is now built and merged** (#453, `63b47b7`; Codex FINAL PASS; includes the read-back-failure rollback-state-retention fix). It is **production-disabled** by `assertExecutionAuthorization()` (throws before SDK init on any production write).
- **What is STILL NOT authorized:** production identity mutation; enabling production writes; any email migration / reset or verification send; explicit `revokeRefreshTokens`/operator session revocation; email-provider configuration; AUTH-PR-3 deployment. Enabling execution requires **two** later Owner actions — recording DECISIONS #52 **and** authorizing a separate narrow enablement PR — and even then nothing runs automatically. **Firebase-triggered session invalidation** remains only a documented possible future platform effect; none occurred, because no email was changed.

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
Return the production-enablement design PR for Codex review. It contains the PROPOSED (PENDING/unsigned) DECISIONS #52 authorization and the design for a separate, narrow, authorization-bound enablement change; it enables **no** production writes. After Codex review and merge, **stop** — the genuine next gate is the Owner's: (OD-1) record + sign DECISIONS #52; (OD-2) supply the private alias mapping out-of-band; (OD-3) confirm break-glass recoverable + login-verified before the owner step; (OD-6) name the executor + authorize the separate enablement PR. **Do not enable production writes or begin AUTH-PR-4 execution until the Owner grants these.**

## Stop Conditions
- Missing authorization for a new implementation phase.
- Proposed destructive migration without approved reconciliation and rollback.
- Any change that absorbs Equipment or breaks existing customer/location references.
- Conflict with another workstream’s active PR.

## Last Updated
- Date: 2026-07-27
- Commit: `63b47b7d362d1da6e09041879b77eab676c07a61`
- Updated by: designated Customer session
