# F-RULES-1 Gate D2 — Hardened Rules Deployment Report

**Gate:** D2 — deploy the governed `firestore.rules`, verify the technician self-write closure in production, preserve rollback. **Executed 2026-07-23**: production commands by the operator (Cloud Shell; no IAM widened, no SA keys); repository work by the Customer session. Governing: Decision #39 · PR-C validation (`../pr-c-completion-rules-validation.md`) · D1 activation report (`../d1-activation/d1-activation-report.md`) · runbook `../../../operations/f-rules-1-d2-deployment-handoff.md`.

## 1. Pre-deploy validation (Customer session, base `75289cc`)

Combined-content acknowledgement (Owner-confirmed): the deploy ships the entire governed file — F-RULES-1 technician hardening **plus** Inventory's client-closed `parts`/`manufacturers`/`part_aliases`/`part_supplier_items` blocks. Verified: root/mirror byte-identical · full regression **498/0 (15 suites)** incl. strict 43/43, partMaster 16/16, partAlias 8/8, partSupplierItem 8/8.

**Hash-correction note (operator run 1):** the handoff initially recorded a Windows-worktree CRLF hash; the governed value is the **git-blob** sha256 — `b37c666fff0018375df11afa5078f8499e10fea9df7a862d5c373e112f5903fd` — and every handoff check was made self-deriving from the blob (`7c1d4e1`, guarded by `functions/test/d2HandoffStatic.test.js`).

## 2. Rollback baseline (captured BEFORE deploy; deploy gated on it)

Pre-D2 production ruleset fetched via the Firebase Rules API into an independently deployable `rollback/` artifact. **Pre-D2 production baseline sha256: `1c589f56212c03213b984ee25b53871390c8e823f2e30e087a35c8788732a08a`** (`pre-deploy-production.rules` + `.sha256`, this directory). Rollback command staged; **rollback was not required**.

## 3. Deployment & rules identity

`firebase deploy --only firestore:rules --project taylor-parts` → success; nothing else deployed (`deploy-output.txt`). Post-deploy fetch of the live ruleset: **byte-identical to the governed repository blob** (`LIVE-EQUALS-GOVERNED-BLOB`; `post-deploy-production.rules` hashes to `b37c666…903fd`).

## 4. Production verification — `D2 SMOKE PASS: 22 passed, 0 failed`

All against production with `d2smoke` fixtures only (fake customer; real client REST with password-authenticated ID tokens, so every allow/deny is the deployed Rules' behavior):

- **Technician contract:** wrong-technician direct start denied · assigned technician **status-only `assigned→in_progress` ALLOWED** (job became `in_progress`) · **direct completion DENIED** (no mutation) · **self-availability DENIED**.
- **Trusted path intact under the hardened Rules:** `completeAssignedJob` HTTP 200 with the exact response contract · job → `complete` · technician → `available` · applied audit event at the idempotency key · exact replay `idempotentReplay=true` with **no duplicate cascade** and **exactly one applied audit event**.
- **Inventory closure preserved:** client read denied ×4 and client create denied ×4 across `parts`, `manufacturers`, `part_aliases`, `part_supplier_items`.

Raw results: `d2-smoke-results.json` (imported evidence).

## 5. Cleanup (operator)

All `d2smoke` fixture documents and both temporary Auth users removed (remaining `d2smoke` Auth users = `[]`); `D2_SMOKE_PASSWORD` cleared. The callable's `d2smoke`-keyed Audit Events are retained by design (append-only).

## 6. Final production posture after D2

| Item | State |
|---|---|
| Trusted callable (`completeAssignedJob`) | LIVE (D1) |
| Trusted Field Mode completion | LIVE (D1) |
| Hardened Rules | **LIVE — live ruleset == governed blob `b37c666…903fd`** |
| Technician direct completion | **DENIED in production** (verified) |
| Technician direct `assigned→in_progress` | preserved (status-only, verified) |
| Technician self-availability | **DENIED in production** (verified) |
| Audit client writes | denied (Rules) — trusted-writer only |
| Inventory Part Master/alias/supplier client access | denied (verified ×8) |
| Rollback | pre-D2 baseline `1c589f56…2a08a` preserved, deployable; unused |
| D3 | **not begun**, pending separate Owner authorization |

**The F-RULES-1 technician self-write closure — Decision #39's end state — is now enforced in production.** Known open governance item (not a D2 defect): the a/d update branch has no field allowlist (Spec U-R1–U-R4; separate future assessment).

## 7. Evidence set (this directory)

Operator-produced, checksummed (`checksums.sha256`, re-verified at import), sensitive scan `SENSITIVE-SCAN-CLEAN`: `d2-smoke-results.json` · `pre-deploy-production.rules` + `pre-deploy-production-rules.sha256` · `post-deploy-production.rules` · `deploy-output.txt`. Source archive `f-rules-1-d2-evidence.tgz` sha256: `5dee8004551d6403adcfa6b900b980d83f442090c86329e0062986f095f67861`. A `.gitattributes` (`* -text`) preserves evidence bytes exactly.
