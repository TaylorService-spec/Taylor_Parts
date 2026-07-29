# Customer Session State

## Baseline
- Main commit: `3591fa8` (admin-reset roadmap AUTH-UI-1 #469 / AUTH-UI-2 #470 / AUTH-UI-3 #471 / AUTH-PR-3.5 #472 all merged, repo/emulator-only); AUTH-PR-4 reverse-order rollback-continuation #467 merged (`bc0fda57`); re-authorization prep #468 **CLOSED/UNMERGED** (Owner cancelled the reverse-order rollback continuation)
- Last reconciled: 2026-07-28
- Relevant PRs (AUTH-PR-4 chain, all **MERGED**): readiness #451 (`8f28d22`), operator workflow #453 (`63b47b7`), production-enablement #457, GRANT #460 (DECISIONS #52), genesis initializer + 3-file governed set #461 (`dba0e33`), CI enforcement #463 (`9b912d7`), three-file re-authorization #462 (`602ed1f`, DECISIONS #53), session-state reconcile #464, reverse-order rollback-continuation #467. Predecessor AUTH-PR-3 #444 (`e53c7b0`, not deployed/enabled).
- Admin password-reset roadmap PR: **AUTH-UI-1** (this gate, docs-only) — DECISIONS #54 (deferrals), #55 (continuous-execution authority).
- Relevant issues: #226 (Functions lane governing AUTH-PR-3 + Admin portal `AdminUsers`)

## Current Objective
Two concurrent Customer/Auth lanes, both owned here and both repository-only:

**(A) Admin password-reset roadmap (NEW active focus — roadmap items #4 Admin reset UI + #5 production admin password reset).** Gate **AUTH-UI-1** (docs-only reconciliation + design) delivered: `docs/assessments/admin-password-reset-current-state.md`, `docs/specifications/admin-password-reset-ui.md`, `docs/implementation-plans/admin-password-reset-ui.md`. **Owner deferrals ratified (DECISIONS #54):** username login, username-input recovery, and external email provider are **indefinitely deferred** — do not build or reopen. **Delivery direction resolved:** AUTH-PR-1 §6.2's external-provider delivery design is superseded by #54; **D-DELIVERY-NATIVE was approved (DECISIONS #56)** and **AUTH-PR-3.5 (#472) implemented it and merged at `3591fa8`** (Firebase-native server send, truthful `REQUEST_ACCEPTED`-only semantics). The repository implementation remains **inactive and undeployed**. The **remaining blocker for production admin reset (#5) is AUTH-PROD-1** — real-Firebase behavior verification, which requires a **separate Owner production authorization**. The **Admin reset UI (#4) is not blocked** (ships truthfully with unavailable/uncertain states). Continuous-execution authority for reversible repository gates is DECISIONS #55. **AUTH-UI-1 is APPROVED (DECISIONS #56):** D-DELIVERY-NATIVE approved (Firebase-native server send, `REQUEST_ACCEPTED`-only, no provider); D-ROUTINE-REVOKE = **NO** (routine reset never revokes sessions); D-RESET-PERMISSION approved (`admin.credentialReset.initiate`, inactive, no grant); guard gap confirmed. Authorized reversible phases executed: **AUTH-UI-2** (#470, pure UI/domain state, merged), **AUTH-UI-3** (#471, AdminUsers integration, merged), **AUTH-PR-3.5** (#472, backend correction, repo/emulator-only, **merged at `3591fa8`**). AUTH-PR-3.5 implements the Firebase-native `REQUEST_ACCEPTED`-only send (fail-closed `NOT_CONFIGURED_NATIVE_SEND`, no external provider, no reset-link generation), removes routine session revocation, enforces all guards (self / disabled / break-glass / missing-or-nonreciprocal Employee↔Auth link / final-active-recoverable-admin) via a pure exported evaluator, and registers `admin.credentialReset.initiate` **inactive** (no grant). **HARD STOP before AUTH-PROD-1** and any deployment / permission activation / role grant / production Auth action.

**(B) AUTH-PR-4 (recovery-email migration) — separate lane; PARTIALLY EXECUTED, then reverse-order rollback continuation CANCELLED by the Owner.** The governed workflow, production gate, genesis initializer, and CI-enforced security suites are merged, and PR #467 (`bc0fda57`) landed the governed reverse-order rollback-continuation + journaled workflow-identity transition (repo/emulator only). **Governed execution history:** Gate A (protected genesis preparation) and Gate B (one-persona-at-a-time execution) were each separately granted and run — the five personas were forward-migrated (positions 1→5) and **position 5 (the primary admin) was then rolled back** at the Owner's direction. **The progression is `suspended` at revision 12; positions 1–4 remain migrated by explicit Owner disposition; position 5 is restored.** Four rollback artifacts remain protected and **must not be altered**; no lock, journal (identity-transition intent), recovery, reconciliation mutex, fence lock, or continuation is active (governed inspection: fingerprint unchanged; still bound to the old workflow identity). **The Owner has CANCELLED the reverse-order rollback continuation:** the re-authorization prep PR **#468 is CLOSED/UNMERGED** (branch retained for recoverability — do **not** reopen/merge/revise/delete). **No re-authorization or workflow-identity transition occurred** — `functions/authpr4/production-authorization.json` on main is still bound to `reviewedHead dba0e33` (pre-#467 hashes), so it no longer verifies against the merged governed code and production stays **fail-closed**. Current-main drift through PRs #469–#472 (AUTH-UI / AUTH-PR-3.5) did **not** change any AUTH-PR-4 governed file or the authorization. **No further AUTH-PR-4 execution is authorized.** The admin-reset roadmap must not touch AUTH-PR-4 governed files, state, mappings, tokens, or operator state, and must never combine releases with it.

## Status
Active.

## Delta Since Last Handoff
- **AUTH-PR-4 — PARTIALLY EXECUTED, rollback continuation CANCELLED (current state, 2026-07-29).** The governed workflow, production gate, genesis initializer, and CI-enforced security suites are merged; PR #467 (`bc0fda57`) merged the reverse-order rollback-continuation + journaled workflow-identity transition (repo/emulator only). Gate A (protected genesis preparation) and Gate B (one-persona-at-a-time execution) were each separately granted and run: positions 1→5 were forward-migrated, then position 5 (primary admin) was rolled back at the Owner's direction. The progression is `suspended` at revision 12; **positions 1–4 remain migrated by explicit Owner disposition; position 5 is restored.** Four rollback artifacts + the state key/progression/anchor remain protected (owner-only) and must not be altered. The Owner then **CANCELLED** the reverse-order rollback continuation: re-authorization prep PR #468 is CLOSED/UNMERGED (branch retained; do not reopen/merge/revise/delete). No re-authorization or workflow-identity transition occurred — main's `production-authorization.json` is still bound to `reviewedHead dba0e33` (pre-#467 hashes), so it no longer verifies against the merged governed code and production stays **fail-closed**. Governed inspection: fingerprint unchanged; still bound to the old workflow identity; no lock/journal/recovery/reconciliation/fence-lock active.
- Per the Owner operating model, the Customer session owns Authentication architecture and repository implementation (and also maintains Platform and Coordination tracking; there is no independent Coordination session).
- **AUTH-PR-4 authorization lineage (history only).** DECISIONS #52 granted the production authorization (PR #460); PR #457 landed the production-enablement gate; PR #461 (`dba0e33`) added the credential-free **genesis initializer** (`authPr4InitProgression.js`) and expanded `GOVERNED_FILES` to **three** files; PR #463 (`9b912d7`) added CI enforcement (`.github/workflows/authpr4-security-tests.yml`) with the gate/migration Auth-emulator layers on `demo-authpr4`; PR #462 (`602ed1f`, DECISIONS #53) re-bound `production-authorization.json` to `reviewedHead dba0e33` + the three governed blob hashes. That authorization verified **at the time**; the later #467 merge moved the governed code, which is why main's authorization no longer verifies **today**. PR #461 did **not** receive an unconditional Codex PASS — its post-merge review returned **CHANGES REQUIRED** (security suites not CI-enforced), corrected by #463.
- **No further AUTH-PR-4 action is authorized.** Prohibited now: reopening/merging #468; any re-authorization or workflow-identity transition/recovery; continuing the rollback; repairing/altering/deleting the protected state, progression, anchor, key, or four rollback artifacts; requesting or handling private alias mappings/UIDs/credentials; any production identity mutation, email migration, reset/verification send, explicit `revokeRefreshTokens`/session revocation, email-provider configuration, AUTH-PR-3 deployment, or any Firestore/role/claim/`accessVersion` change. The admin-reset roadmap must never combine a release with AUTH-PR-4.

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
**(A) Admin password-reset roadmap:** AUTH-UI-1/2/3 merged (#469/#470/#471) and AUTH-PR-3.5 merged (#472, repo/emulator-only, all suites green) — all four land at `3591fa8`. **HARD STOP reached — the next gate is AUTH-PROD-1** (real-Firebase behavior verification), which requires a **separate Owner production authorization** and must NOT begin without it. AUTH-PROD-1..4 remain hard-stopped (deployment, permission activation, role grant, Firebase-native send against the real project, production Auth). Do not introduce an external provider (#54). The exact AUTH-PROD-1 verification requirements, required production inputs, and hard stops are prepared (documentation-only, PENDING / NOT AUTHORIZED FOR PRODUCTION) in [`docs/deployment/admin-password-reset-auth-prod-1-verification-package.md`](../deployment/admin-password-reset-auth-prod-1-verification-package.md); it does not authorize execution.

**(B) AUTH-PR-4:** **CANCELLED lane — Stop.** Gate A + Gate B executed (forward migration positions 1→5; position 5 rolled back); the progression is `suspended` at revision 12 with positions 1–4 migrated by explicit Owner disposition. The Owner has **cancelled** the reverse-order rollback continuation; PR #468 (re-authorization prep) is CLOSED/UNMERGED. **No further AUTH-PR-4 action is authorized:** do not reopen/merge #468, re-authorize, run the workflow-identity transition/recovery, continue rollback, repair state, alter/delete protected artifacts, request private mappings/credentials, or perform any production/Auth mutation. The protected progression + anchor + state key + four rollback artifacts remain owner-only and **must not be altered** outside a future, separately-authorized governed gate. Governed inspection confirms the state is unchanged (fingerprint match; still bound to the old workflow identity; no lock/journal/recovery/reconciliation/fence-lock active).

## Stop Conditions
- Missing authorization for a new implementation phase.
- Proposed destructive migration without approved reconciliation and rollback.
- Any change that absorbs Equipment or breaks existing customer/location references.
- Conflict with another workstream’s active PR.
- **Admin-reset roadmap:** any hard stop in DECISIONS #55 (deployment, Firebase Auth/project mutation, production reset/revocation/email, role/claim/accessVersion mutation, source cutover, removing a recovery fallback, or leaving zero recoverable admins); reopening a #54 deferral; introducing an external email provider; or touching AUTH-PR-4 governed state.

## Last Updated
- Date: 2026-07-29
- Commit: `3591fa87fee24c78b1125cbe067b493a95035aab`
- Updated by: designated Customer session (AUTH-PR-4 rollback-lane closure reconciliation — obsolete-assertion removal)
