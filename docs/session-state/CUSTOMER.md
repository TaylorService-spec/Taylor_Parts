# Customer Session State

## Baseline
- Main commit: `1a036f6` (admin-reset roadmap: AUTH-UI-1 #469, AUTH-UI-2 #470, AUTH-UI-3 #471 merged; AUTH-PR-3.5 open); prior `bc0fda5` advanced by Equipment D5 #466 and AUTH-PR-4 rollback-continuation #467 (repo/emulator-only)
- Last reconciled: 2026-07-28
- Relevant PRs (AUTH-PR-4 chain, all **MERGED**): readiness #451 (`8f28d22`), operator workflow #453 (`63b47b7`), production-enablement #457, GRANT #460 (DECISIONS #52), genesis initializer + 3-file governed set #461 (`dba0e33`), CI enforcement #463 (`9b912d7`), three-file re-authorization #462 (`602ed1f`, DECISIONS #53), session-state reconcile #464, reverse-order rollback-continuation #467. Predecessor AUTH-PR-3 #444 (`e53c7b0`, not deployed/enabled).
- Admin password-reset roadmap PR: **AUTH-UI-1** (this gate, docs-only) — DECISIONS #54 (deferrals), #55 (continuous-execution authority).
- Relevant issues: #226 (Functions lane governing AUTH-PR-3 + Admin portal `AdminUsers`)

## Current Objective
Two concurrent Customer/Auth lanes, both owned here and both repository-only:

**(A) Admin password-reset roadmap (NEW active focus — roadmap items #4 Admin reset UI + #5 production admin password reset).** Gate **AUTH-UI-1** (docs-only reconciliation + design) delivered: `docs/assessments/admin-password-reset-current-state.md`, `docs/specifications/admin-password-reset-ui.md`, `docs/implementation-plans/admin-password-reset-ui.md`. **Owner deferrals ratified (DECISIONS #54):** username login, username-input recovery, and external email provider are **indefinitely deferred** — do not build or reopen. **Central blocker:** AUTH-PR-1 §6.2's external-provider delivery design is superseded by #54, so the merged AUTH-PR-3 backend (PR #444) is **fail-closed with no delivery path** — production admin reset (#5) is **BLOCKED** pending Owner decision **D-DELIVERY-NATIVE** (a Firebase-native server send with truthful "accepted"-only semantics) or a UI-only direction. The **Admin reset UI (#4) is not blocked** (ships truthfully with unavailable/uncertain states). Continuous-execution authority for reversible repository gates is DECISIONS #55. **AUTH-UI-1 is APPROVED (DECISIONS #56):** D-DELIVERY-NATIVE approved (Firebase-native server send, `REQUEST_ACCEPTED`-only, no provider); D-ROUTINE-REVOKE = **NO** (routine reset never revokes sessions); D-RESET-PERMISSION approved (`admin.credentialReset.initiate`, inactive, no grant); guard gap confirmed. Authorized reversible phases executed: **AUTH-UI-2** (#470, pure UI/domain state, merged), **AUTH-UI-3** (#471, AdminUsers integration, merged), **AUTH-PR-3.5** (backend correction, repo/emulator only — open PR). AUTH-PR-3.5 implements the Firebase-native `REQUEST_ACCEPTED`-only send (fail-closed `NOT_CONFIGURED_NATIVE_SEND`, no external provider, no reset-link generation), removes routine session revocation, enforces all guards (self / disabled / break-glass / missing-or-nonreciprocal Employee↔Auth link / final-active-recoverable-admin) via a pure exported evaluator, and registers `admin.credentialReset.initiate` **inactive** (no grant). **HARD STOP before AUTH-PROD-1** and any deployment / permission activation / role grant / production Auth action.

**(B) AUTH-PR-4 (recovery-email migration) — separate, operationally active, NOT executed.** The governed workflow, production gate, genesis initializer, and CI-enforced security suites are merged; the **production identity-mutation authorization is GRANTED** (DECISIONS #52) and **re-bound to the three-file governed set** (DECISIONS #53) — the committed `functions/authpr4/production-authorization.json` **verifies** against `reviewedHead dba0e33`. Reverse-order rollback-continuation + workflow-identity transition landed via #467 (repo/emulator only). **AUTH-PR-4 has NOT been executed:** no state key, genesis progression, private alias mapping, or credentials created/requested; no production Auth mutation. Next steps remain two separate, not-yet-granted Owner gates — **Gate A** (protected genesis preparation) and **Gate B** (one-persona-at-a-time execution, position 1 first). **The admin-reset roadmap must not touch AUTH-PR-4 governed files, state, mappings, tokens, or operator state, and must never combine releases with it.**

## Status
Active.

## Delta Since Last Handoff
- Per the Owner operating model, the Customer session owns Authentication architecture and repository implementation (and also maintains Platform and Coordination tracking; there is no independent Coordination session).
- **The AUTH-PR-4 production authorization is now GRANTED and re-bound to the three-file governed set.** DECISIONS #52 GRANTED it (PR #460); PR #457 landed the production-enablement gate; PR #461 (`dba0e33`) added the governed, credential-free **genesis initializer** (`authPr4InitProgression.js`) and expanded the gate's `GOVERNED_FILES` to **three** files; PR #463 (`9b912d7`) added CI enforcement (`.github/workflows/authpr4-security-tests.yml`) running the initializer/gate/migration suites, with the gate/migration **Auth-emulator** layers on `demo-authpr4`; PR #462 (`602ed1f`, DECISIONS #53) re-bound `production-authorization.json` to `reviewedHead dba0e33` + the three governed blob hashes. The committed artifact **verifies** (GRANTED, 3 files, hashes match derived at head); AUTH-PR-4 CI is green on `main` (initializer 63, gate 34, migration 30).
- **Governance-history accuracy:** PR #461 did **not** receive an unconditional Codex PASS — its post-merge Codex review returned **CHANGES REQUIRED** because the security suites were not CI-enforced; that gap was corrected by PR #463.
- **What is STILL NOT authorized (nothing has executed):** creating a state key or genesis progression; requesting/accessing private alias mappings, UIDs, or credentials; any dry-run; any production identity mutation / email migration / reset or verification send; explicit `revokeRefreshTokens`/operator session revocation; email-provider configuration; AUTH-PR-3 deployment; any Firestore/role/claim/`accessVersion` change. Merging the re-authorization changed **nothing** in production. Execution requires two further separate Owner gates (**Gate A** genesis preparation, then **Gate B** one-persona-at-a-time execution — position 1 only first), and even then nothing runs automatically. **Firebase-triggered session invalidation** remains only a documented possible future platform effect; none occurred, because no email was changed.

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
**(A) Admin password-reset roadmap:** AUTH-UI-1/2/3 merged (#469/#470/#471); AUTH-PR-3.5 open (repo/emulator-only, all suites green). **HARD STOP reached — the next gate is AUTH-PROD-1** (real-Firebase behavior verification), which requires a **separate Owner production authorization** and must NOT begin without it. AUTH-PROD-1..4 remain hard-stopped (deployment, permission activation, role grant, Firebase-native send against the real project, production Auth). Do not introduce an external provider (#54). See the production-verification handoff for the exact AUTH-PROD-1 proposal.

**(B) AUTH-PR-4:** unchanged — **Stop.** The genuine next gate is the Owner's, in two separate, not-yet-granted decisions:
- **Gate A — protected genesis preparation:** named operator creates protected state-key material out-of-band and runs the credential-free genesis initializer (`authPr4InitProgression.js`, no Firebase SDK/network, no private mapping) to produce the canonical revision-0/position-1 signed progression + anchor; returns sanitized evidence only.
- **Gate B — production migration execution:** only after Gate A passes; obtain the private base inbox + persona alias mapping out-of-band; confirm the named executor matches the artifact; execute **one persona at a time** in order — **position 1 only first**, stop and return sanitized evidence before position 2; positions 2–4 each need prior PASS; position 5 additionally needs fresh break-glass; any failure/uncertainty/collision/disabled/missing/UID-mismatch/integrity/read-back-mismatch **halts the entire sequence**.
**Do not create a state key or genesis, request private mappings/credentials, run any initializer/dry-run/rollback/migration command, or perform any production/Auth mutation until the Owner explicitly grants Gate A, then Gate B position 1.**

## Stop Conditions
- Missing authorization for a new implementation phase.
- Proposed destructive migration without approved reconciliation and rollback.
- Any change that absorbs Equipment or breaks existing customer/location references.
- Conflict with another workstream’s active PR.
- **Admin-reset roadmap:** any hard stop in DECISIONS #55 (deployment, Firebase Auth/project mutation, production reset/revocation/email, role/claim/accessVersion mutation, source cutover, removing a recovery fallback, or leaving zero recoverable admins); reopening a #54 deferral; introducing an external email provider; or touching AUTH-PR-4 governed state.

## Last Updated
- Date: 2026-07-28
- Commit: `bc0fda57c9b35a967cef75b3df747a6fac91ec15`
- Updated by: designated Customer session (AUTH-UI-1)
