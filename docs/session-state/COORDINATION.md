# Coordination Session State

## Baseline
- Main commit: `bc0fda57c9b35a967cef75b3df747a6fac91ec15` (was `602ed1f`; advanced by #466/#467, repo/emulator-only)
- Last reconciled: 2026-07-28
- Relevant PRs: AUTH-PR-4 chain merged (readiness #451, workflow #453, enablement #457, GRANT #460, initializer/3-file #461 `dba0e33`, CI enforcement #463 `9b912d7`, re-authorization #462 `602ed1f`); #444, #445
- Relevant issues: #226 (AUTH-PR-3 Functions lane); C2 repository-only authorization recorded in DECISIONS #49

## Current Objective
Coordination tracking is maintained by the Customer session. **Authentication (Customer lane):** the AUTH-PR-4 governed workflow, production gate, genesis initializer, and CI-enforced security suites are merged, and the **production authorization is GRANTED** (DECISIONS #52) and **re-bound to the three-file governed set** (DECISIONS #53, PR #462 `602ed1f`) — the committed artifact **verifies**. **AUTH-PR-4 has NOT been executed** (no state key, genesis, private mapping, or credentials; no production mutation). The genuine next steps are two separate, not-yet-granted Owner gates — Gate A (protected genesis preparation) then Gate B (one-persona-at-a-time execution, position 1 first). **Inventory/Equipment remains a separate lane** (INVENTORY.md, maintained by the Inventory session; not edited here; note main also advanced with Equipment D1/D2 #450/#454 and further Equipment compatibility work at `24573ae`, not owned here) — C2 status recorded below unchanged. The C2 (PR #445) authorization is DECISIONS #49; PR #445 (`2d08e2e`) and PR #447 (`081df750`) merged, so no C2 authorization item remains open.

## Admin Password-Reset Lane (Customer-owned; separate from AUTH-PR-4 and from Inventory/Equipment)
The Customer/Auth session owns a **new active lane**: the admin password-reset roadmap (items #4 Admin reset UI + #5 production admin reset). **AUTH-UI-1 APPROVED (DECISIONS #56).** Reversible repository phases done under #55: AUTH-UI-1 #469, AUTH-UI-2 #470, AUTH-UI-3 #471 merged; AUTH-PR-3.5 open (repo/emulator-only). **HARD STOP reached** — next is AUTH-PROD-1 (separate Owner production authorization required). AUTH-UI-3 edited `AdminUsers.jsx` and AUTH-PR-3.5 edited `functions/src/access/adminCredential*.ts` + `permissionCatalog.ts` (both mirrors) — coordinate any other #226 Admin-portal / permission-catalog work. Owner deferrals (#54) and continuous-execution authority (#55) recorded. **Collision-awareness:** (a) AUTH-UI-3 will edit `field-ops-app-vite/src/modules/administration/AdminUsers.jsx` — any other #226 Admin-portal work must coordinate. (b) This lane is **separate from AUTH-PR-4** (which is operationally active, repo/emulator-only, GRANTED-but-not-executed) — no shared governed files, state, tokens, or operator state, and **no combined release**. (c) Inventory/Equipment remains a separate lane (INVENTORY.md, not edited here). **No combined Customer and Inventory production release is authorized.**

## Status
Active (maintained by the Customer session).

## Delta Since Last Handoff
- **AUTH-PR-4 authorization is now GRANTED and re-bound to the three-file governed set (Customer/Auth lane).** The full chain merged: readiness #451, workflow #453, enablement #457, GRANT #460 (DECISIONS #52), genesis initializer + 3-file `GOVERNED_FILES` #461 (`dba0e33`), CI enforcement #463 (`9b912d7`), and three-file re-authorization #462 (`602ed1f`, DECISIONS #53). The committed artifact **verifies** (GRANTED, 3 files); AUTH-PR-4 CI is green on `main` (initializer 63, gate 34, migration 30). **Governance accuracy:** PR #461 did **not** get an unconditional Codex PASS — its post-merge review returned CHANGES REQUIRED (security suites not CI-enforced), corrected by #463. **Nothing has executed:** no state key, genesis, private mapping, credentials, dry-run, email migration/reset/verification send, `revokeRefreshTokens`, provider config, or deployment; merge ≠ run. The next steps are two separate, not-yet-granted Owner gates (Gate A genesis prep, then Gate B one-at-a-time execution). This lane does not touch Inventory/Equipment, PR #448, or PR #450.
- PR #443 merged and closed the C1 Hosting evidence gate.
- PR #444 (AUTH-PR-3) merged as `e53c7b0` (Customer-owned; not deployed, not enabled).
- PR #445 (C2 PartDetail cutover, Inventory-owned) merged as `2d08e2e`; its separate repository-only authorization is recorded in DECISIONS #49.
- PR #447 merged as `081df750`, landing the C2 Hosting runbook/preparation; C2 has since been deployed to production, with sanitized evidence pending repository merge on draft PR #448.
- Ownership RECONCILED per the Owner operating model: the Customer session owns Authentication architecture and repository implementation and maintains Platform and Coordination tracking; there is no independent Coordination session; Platform involvement is required only for separately-authorized production configuration or deployment.

## Decisions
- [`AGENTS.md`](../../AGENTS.md)
- [`DelegationCharter.md`](../DelegationCharter.md)
- [`DECISIONS.md`](../DECISIONS.md)
- [`CLAUDE_CONTEXT.md`](../CLAUDE_CONTEXT.md)

## Dependencies
- Any further C2 action (evidence merge, deployment, or catalog retirement) requires its own separately-verified authorization; the repository-only cutover authorization (DECISIONS #49) does not extend to it.
- Independent review of Customer-owned PRs (e.g. #444) is provided by the external ChatGPT/Codex repository review, not by a separate Coordination session.
- The Customer session maintains CUSTOMER, PLATFORM, and COORDINATION tracking; the Inventory session maintains INVENTORY and must not be edited by other sessions.

## Production Evidence

### Verified
- C1 Hosting deployment evidence merged through PR #443.
- C2 repository-only authorization: DECISIONS #49.
- C2 PartDetail cutover merged (`2d08e2e`, PR #445) and C2 Hosting runbook/preparation merged (`081df750`, PR #447).
- C2 production deployment: deployed and verified in production after the `081df750` baseline; sanitized evidence pending repository merge on draft PR #448 — not yet merged truth.

### Unverified
- AUTH-PR-3 production behavior.

### Failed
- None recorded here.

### Not applicable
- Coordination performs no deployment or production mutation.

## Risks
- Critical: proceeding from a stale or missing gate.
- High: concurrent sessions changing overlapping files.

## Next Action
- **Customer/Auth lane:** execution-readiness reconciliation complete; the re-authorization is live and verifying. **Stop.** The genuine next gate is the Owner's, in two separate steps: **Gate A** (named operator creates protected state-key material out-of-band + runs the credential-free genesis initializer, no SDK/network, sanitized evidence only) then **Gate B** (obtain private mapping out-of-band, confirm named executor, execute one persona at a time — position 1 only first, stop for evidence before position 2; position 5 needs fresh break-glass). Do not create a state key/genesis, request private mappings/credentials, run any initializer/dry-run/rollback/migration command, or perform any production/Auth mutation until the Owner grants Gate A, then Gate B position 1.
- **Inventory lane (separate, not owned here):** merging the sanitized C2 Hosting production evidence (draft PR #448) remains the Inventory session's action — recorded for coordination only, not acted on here.
Authentication ownership is reconciled; no further ownership action is required.

## Stop Conditions
- Authorization or ownership cannot be proven from repository or owner record.
- Active branches overlap unexpectedly.
- A session attempts to rewrite another stream’s conclusions.
- Production completion is claimed without linked evidence.

## Last Updated
- Date: 2026-07-28
- Commit: `bc0fda57c9b35a967cef75b3df747a6fac91ec15`
- Updated by: Customer session — AUTH-UI-1
