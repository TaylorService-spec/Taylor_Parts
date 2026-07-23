# F-RULES-1 Gate D3 — Final Production Verification & Workstream Closure

**Gate:** D3 — one end-to-end completion through the SHIPPED production Field Mode UI with a controlled sign-in; workstream closure. **Executed 2026-07-23** (operator: browser + Cloud Shell; Customer session: tooling, blocker fix, evidence import, closure). Governing: Decision #39 · D1 (`../d1-activation/`) · D2 (`../d2-rules-deployment/`) · runbook `../../../operations/f-rules-1-d3-closure-handoff.md`.

## 1. Pre-checks

Live Function re-confirmed (`completeAssignedJob`, v2 callable, us-central1) and live Rules re-confirmed equal to the governed blob `b37c666fff0018375df11afa5078f8499e10fea9df7a862d5c373e112f5903fd` (`LIVE-RULES-EQUAL-GOVERNED-BLOB`).

## 2. Run-1 blocker and fix (PR #393, merged `a94c2f4`)

Run 1 crashed the production Technician Workspace with React error #31: `FieldMode.jsx` rendered the legacy job `customer` field raw, and the governed fixture (like newer tooling) carries the object shape `{ name }`. Fixed narrowly with the pure normalizer `src/domain/jobDisplay.js#jobCustomerName` routed through every FieldMode customer site + a 5-check regression (including the exact crash shape); released through the normal Pages flow; the live bundle `assets/index-TVEo-0Q1.js` was verified byte-identical to the reviewed build. The exposed fixture password was rotated at the retry re-seed. (Dispatcher views share the latent raw-render class — flagged as a separate follow-up, out of D3 scope.)

## 3. Retry run — operator attestation (recorded exactly as observed)

From `attestation.txt` (imported evidence): `PRODUCTION_UI_LOADED=YES` · `TECHNICIAN_WORKSPACE_LOADED_WITHOUT_REACT31=YES` · `CONTROLLED_D3_USER_SIGNED_IN=YES` · `SEEDED_JOB_VISIBLE=YES` · `COMPLETE_CLICKED_ONCE=YES` · `SUCCESS_STATE_RENDERED=YES` · `PASSWORD_OR_TOKEN_CAPTURED_IN_EVIDENCE=NO` — and, honestly recorded, three network-forensic observations **NOT_CAPTURED** (`COMPLETE_ASSIGNED_JOB_REQUEST_OBSERVED`, `DIRECT_FIRESTORE_COMPLETION_WRITE_OBSERVED`, `REFRESH_REMAINS_COMPLETE`): the browser network evidence was not independently preserved.

## 4. Data-plane verification — `D3 VERIFY PASS: 7 passed, 0 failed`

Post-UI checks against production (03:56:58–59Z): job `complete` and otherwise untouched · technician `available` · **exactly ONE applied audit event** · `action=completeAssignedJob`, `actorUid` = the signed-in controlled user · **audit document id is a UI-minted `cmpl-*` idempotency key** (only the shipped `completionFlow` generates that format) · `scope=ownAssignment` of the fixture technician.

## 5. NOT_CAPTURED lines — compensating evidence (stated plainly, no overclaim)

The three NOT_CAPTURED attestations are not directly evidenced by preserved browser captures. Their substance is established by data-plane + structural evidence:

1. *Completion occurred via `completeAssignedJob`:* only the trusted callable can write an `auditEvents` document (client writes deny-all — D2-verified in production), and the applied event's id is a UI-format `cmpl-*` idempotency key with the signed-in user as actor — a direct write could produce **no** audit event, and nothing else produces that key format.
2. *No direct Firestore completion write:* the deployed Rules **deny** direct client completion (D2 production check 22/22; live ruleset hash re-confirmed in D3 pre-checks) — such a write could not have succeeded; and exactly one applied cascade exists.
3. *Durable completion:* the verify ran after the browser session ended and shows the job durably `complete` with a single cascade — the substance of "refresh remains complete."

**Limitation recorded:** browser-network capture is absent from the evidence set; this report does not claim it exists.

## 6. Cleanup

`d3smoke` fixture documents and the Auth user removed; remaining `d3smoke` Auth users: 0; session password unset (and the run-1 password had been rotated). Append-only audit events retained by design.

## 7. Evidence set (this directory)

`d3-smoke-results.json` · `attestation.txt` · `checksums.sha256` (re-verified 2/2 at import) · `.gitattributes` (`* -text`). Source archive `f-rules-1-d3-evidence.tgz` sha256: `5e46864e2a0f2dc780b31ae73add0398e956e0fd7278e430a1b007081c5cff8f`. Sensitive scan clean (the single grep hit is the attestation key name `PASSWORD_OR_TOKEN_CAPTURED_IN_EVIDENCE=NO` itself, not credential material).

## 8. F-RULES-1 — CLOSED

| Decision #39 end state | Production status |
|---|---|
| Technician direct completion | **DENIED** (D2-verified live) |
| Technician self-availability | **DENIED** (D2-verified live) |
| Technician direct `assigned→in_progress` (status-only) | preserved (D2-verified live) |
| Technician completion authority | **`completeAssignedJob`** — live, smoke-verified (D1 12/12, D2 22/22, D3 7/7 + UI) |
| Frontend trusted path | live (byte-verified bundles at D1 and post-#393) |
| Audit authority | trusted-writer only (client deny-all, forge-tested) |
| Open item | **U-R1–U-R4** (a/d correction-field allowlist) — separate governed assessment, tracked, not part of this closure |

**F-RULES-1 is COMPLETE**: repository chain (PR-0…PR-C, strict suite @ CI), production chain (D1 → D2 → D3), evidence immutable under `docs/audits/f-rules-1/`.
