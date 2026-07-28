# Customer Session State

## Baseline
- Main commit: `602ed1f9e3e3c0cceb6025cc547b91972630f747`
- Last reconciled: 2026-07-28
- Relevant PRs (AUTH-PR-4 chain, all **MERGED**): readiness #451 (`8f28d22`), operator workflow #453 (`63b47b7`), production-enablement #457, GRANT #460 (DECISIONS #52), genesis initializer + 3-file governed set #461 (`dba0e33`), CI enforcement #463 (`9b912d7`), three-file re-authorization #462 (`602ed1f`, DECISIONS #53). Predecessor AUTH-PR-3 #444 (`e53c7b0`, not deployed/enabled).
- Relevant issues: #226 (Functions lane governing AUTH-PR-3)

## Current Objective
Authentication Modernization (owned here): the AUTH-PR-4 governed workflow, production gate, genesis initializer, and their CI-enforced security suites are all merged, and the **production identity-mutation authorization is GRANTED** (DECISIONS #52) and **re-bound to the three-file governed set** (DECISIONS #53) — the committed `functions/authpr4/production-authorization.json` **verifies** against `reviewedHead dba0e33` at the current head. **AUTH-PR-4 has NOT been executed:** no state key, genesis progression, private alias mapping, or credentials have been created or requested, and no production Auth mutation has occurred. Current work: repository/read-only **execution-readiness reconciliation** only. The genuine next steps are two separate, not-yet-granted Owner gates — **Gate A** (protected genesis preparation: out-of-band state key + the credential-free genesis initializer producing a canonical revision-0/position-1 signed progression) and **Gate B** (one-persona-at-a-time production migration execution, position 1 first). Neither is authorized.

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
Execution-readiness reconciliation is complete; the re-authorization is live and verifying. **Stop** — the genuine next gate is the Owner's, and it is two separate, not-yet-granted decisions:
- **Gate A — protected genesis preparation:** named operator creates protected state-key material out-of-band and runs the credential-free genesis initializer (`authPr4InitProgression.js`, no Firebase SDK/network, no private mapping) to produce the canonical revision-0/position-1 signed progression + anchor; returns sanitized evidence only.
- **Gate B — production migration execution:** only after Gate A passes; obtain the private base inbox + persona alias mapping out-of-band; confirm the named executor matches the artifact; execute **one persona at a time** in order — **position 1 only first**, stop and return sanitized evidence before position 2; positions 2–4 each need prior PASS; position 5 additionally needs fresh break-glass; any failure/uncertainty/collision/disabled/missing/UID-mismatch/integrity/read-back-mismatch **halts the entire sequence**.
**Do not create a state key or genesis, request private mappings/credentials, run any initializer/dry-run/rollback/migration command, or perform any production/Auth mutation until the Owner explicitly grants Gate A, then Gate B position 1.**

## Stop Conditions
- Missing authorization for a new implementation phase.
- Proposed destructive migration without approved reconciliation and rollback.
- Any change that absorbs Equipment or breaks existing customer/location references.
- Conflict with another workstream’s active PR.

## Last Updated
- Date: 2026-07-28
- Commit: `602ed1f9e3e3c0cceb6025cc547b91972630f747`
- Updated by: designated Customer session
