# F-RULES-1 Gate D1 — Activation Report

**Gate:** D1 — deploy `completeAssignedJob`, verify, backend smoke, activate trusted Field Mode completion. **Executed 2026-07-22/23** under the Owner's D1 authorization: production commands by the operator (Cloud Shell, no IAM widened, no SA keys); repository/release work by the Customer session. Governing: Decision #39 · `../../../implementation-plans/technician-self-write.md` · PR-C validation (`../pr-c-completion-rules-validation.md`).

## 1. Callable deployment (operator)

`completeAssignedJob` deployed to `taylor-parts` / `us-central1`: **GEN_2, nodejs20, callable, ACTIVE** — the ONLY Function deployed; no Firestore Rules, indexes, hosting, or other Functions touched. Pre-deploy baseline (`pre-deploy-functions-list.txt`, this directory) shows the callable **absent** before the run; the post-deploy list and `gcloud functions describe` output are in the imported evidence set.

## 2. Operator smoke-auth correction (run 1 blocker)

Run 1 failed at `auth.createCustomToken()`: custom-token signing requires service-account `signBlob`, unavailable to Cloud Shell **user**-ADC; impersonation of the Admin SDK service account was **correctly denied** and — by design — no Token Creator role was granted and no SA key was created. Correction (`787e29f`, merged with this report): the smoke authenticates like the real client app — two deterministic `d1smoke` Auth users (synthetic `@d1smoke.example.com` emails) created at seed with a session-only throwaway password from `D1_SMOKE_PASSWORD` (≥12 chars, never printed or persisted), exchanged via the public `signInWithPassword` endpoint. Static validation: `functions/test/d1SmokeStatic.test.js` — **8/8** (no signing path in code; env-only password; no credential material in logs/evidence; fixture-scoped doc paths; all 12 assertions present; deploys nothing).

## 3. Controlled backend smoke (operator) — `D1 SMOKE PASS: 12 passed, 0 failed`

Against the LIVE callable with `d1smoke` fixtures only (fake customer; no real records): positive completion HTTP 200 with the exact response contract · job `in_progress→complete` · technician → `available` · **applied `completeAssignedJob` Audit Event at the idempotency key** · exact replay HTTP 200 with `idempotentReplay=true` · **no duplicate cascade** (perturbed technician doc untouched) · **exactly one applied audit event** · wrong technician → `PERMISSION_DENIED` · assigned-state → `FAILED_PRECONDITION` · denied attempts mutated nothing. Raw results: `d1-smoke-results.json` (imported evidence).

## 4. Cleanup (operator)

All `d1smoke` fixture documents and both temporary Auth users removed (verified: remaining `d1smoke` Auth users = `[]`); `D1_SMOKE_PASSWORD` cleared. The two `d1smoke`-keyed Audit Events are **retained by design** — `auditEvents` is append-only; they record genuine trusted-writer activity and are identifiable by their ids.

## 5. Frontend activation (Customer session)

Held release PR **#387** merged after the smoke passed — merge commit `30a80c4` (one-line `trustedCompletion.js` flip to `true` + the single gate-posture structural test update; 23/23 FE completion tests, full FE chain, production build all green pre-merge). GitHub Pages workflow run on `30a80c4`: **SUCCESS**.

## 6. Production publication verification (credential-free, artifact-level)

- Site structure: the Pages **root** serves the legacy standalone "Parts Control" app (untouched by this release); Field Ops publishes under `/Taylor_Parts/field-ops/` (see `deploy-field-ops.yml`'s combined-site assembly).
- The live bundle `assets/index-BzCfH1yG.js` is **byte-identical** to the locally built, reviewed flip-branch bundle — production serves exactly the reviewed artifact.
- The live bundle **contains the `completeAssignedJob` path** (the pre-flip production bundle contained **0** occurrences — Option C verification in the PR-B record); trusted UX strings ("Completing", "Retry completion", same-attempt-retry copy) present.
- **No-legacy-fallback proof:** the release gate compiled to constant `true`, so the legacy branch (the gate's early return — the only site of a direct completion call, test-asserted) is dead code in the shipped bundle; PR-B's direct-write regression proves trusted-path errors return outcomes and can invoke no other effect. Runtime sign-in verification was not performed (no production user credentials, by policy); the operator smoke already proved the live callable end-to-end.

## 7. D1 final production posture

| Item | State |
|---|---|
| `completeAssignedJob` | **LIVE**, backend-verified (12/12 smoke) |
| Trusted Field Mode completion | **LIVE** (byte-identical reviewed bundle) |
| Legacy direct completion | dead code in the shipped bundle; **still permitted by production Rules** — closure is Gate D2 |
| Hardened PR-C Rules | merged in repo, **NOT deployed** (D2, separately gated — now safe to deploy) |
| Firestore Rules in production | unchanged by D1 |
| D2 / D3 | **not begun**, pending Owner authorization |

Rollback readiness (unexercised): frontend = revert `30a80c4` (Pages auto-republishes); backend = `firebase functions:delete completeAssignedJob --region us-central1` (only on a trigger); baselines in this directory + the imported evidence.

## 8. Evidence set (this directory)

Operator-produced, checksummed (`checksums.sha256`, verified at import), sensitive-scan clean (`SENSITIVE-SCAN-CLEAN`): `d1-smoke-results.json` · `d1-evidence-pre-functions-list.txt` · `d1-evidence-post-functions-list.txt` · `d1-evidence-describe.txt`. Session-captured: `pre-deploy-functions-list.txt` (pre-handoff baseline). A `.gitattributes` (`* -text`) preserves evidence bytes exactly. Source archive `f-rules-1-d1-evidence.tgz` sha256: `0442bf46fc4ec2f29b96ba92d2e4f6ccb002666a5500aadaf8d33b7d6e478556`; all member checksums re-verified at import (`sha256sum -c`: 4/4 OK); smoke timestamps (01:51:05–01:51:10Z) correctly precede the #387 merge (01:53:52Z).
