---
artifact_type: deployment-handoff
unit: INV-CONVERGENCE-E Stage A — Hosting-only redeployment & new live-evidence handoff
status: Draft — HANDOFF ONLY, awaiting Owner and ChatGPT review; authorizes no deployment
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: 73d9e1b07f13c7f42cc525c3c037dec6b47d289d (origin/main — evidence-surface correction merged)
supersedes_procedure_of: docs/operations/inv-convergence-e-stage-a-deploy-live-evidence-handoff.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing — operator-executed, separately Owner-authorized; docs-only
---

# INV-CONVERGENCE-E Stage A — Hosting-only redeployment & new live-evidence handoff

The evidence-surface correction (PR #427) merged, so the diagnostic now renders and can copy **capture timestamps + sourceCounts**. A **new Hosting-only redeployment of the new merge commit** is required so a fresh live `PASS` carries the full evidence needed for Decision #44. **This document authorizes no deployment** — it is a reviewed procedure for a separate, Owner-authorized operator step. **Decision #44 stays OPEN.**

This handoff is a **delta** over the merged deployment handoff (`docs/operations/inv-convergence-e-stage-a-deploy-live-evidence-handoff.md`); its full procedure (§2–§9 there — Hosting-only scope, pre/post infrastructure evidence, A–E auth matrix, dispatcher-credential precondition, sanitized capture, PASS-only qualification, rollback) applies unchanged **except** for the pinned commit/build id below.

## 1. Exact commit to build and deploy (updated)
- **Commit:** `73d9e1b07f13c7f42cc525c3c037dec6b47d289d` (`origin/main`, PR #427 merge — evidence-surface correction).
- Build from a **clean detached checkout** of this exact commit.
- **Embedded build id assertion:** the deployed/rendered `__APP_COMMIT__` **must equal this commit's short SHA `73d9e1b`** (not the prior `5609496`).

## 2. Deployment scope — Firebase Hosting only (unchanged)
- `cd field-ops-app-vite && npm ci && npm run build:firebase` → **`firebase deploy --only hosting --project taylor-parts`**.
- **No Rules, Functions, or index deployment; no data modification.** Never pass `--only firestore:rules|indexes|functions`.

## 3. Infrastructure baselines and evidence (corrected)
**What was previously verified** (prior work): the **governed root `firestore.rules` SHA-256 = `fda242399023b400c0f441b96e4103fc86f79f18e2bf04005cbc745e3785bac7`**; the Hosting-only deployment command; and the **deployed Functions inventory before and after (unchanged)**.

**What was NOT previously captured:** a **fresh live production Rules ruleset hash before deployment**, and a **fresh live production Rules ruleset hash after deployment**. Do **not** treat any "previously verified live Rules hash" as existing — it does not.

**Capture this redeployment (sanitized, under `docs/audits/inv-convergence-e-stage-a/deployment/`):**

*Predeploy:*
- **governed repository Rules hash** = `git show 73d9e1b:firestore.rules | sha256sum`;
- **fresh live production Rules artifact/hash** (export the live ruleset now and hash it) → `predeploy-rules-hash.txt`;
- **deployed Functions inventory** (`firebase functions:list --project taylor-parts`) → `predeploy-functions.txt`.

*Postdeploy:*
- **fresh live production Rules artifact/hash** → `postdeploy-rules-hash.txt`;
- **deployed Functions inventory** → `postdeploy-functions.txt`.

**Required assertions (record in `verification-summary.md`):**
- governed **repository** Rules hash **equals** `fda242399023b400c0f441b96e4103fc86f79f18e2bf04005cbc745e3785bac7`;
- **postdeploy live Rules hash equals predeploy live Rules hash**;
- **postdeploy Functions inventory equals predeploy Functions inventory**;
- **no Rules deployment**, **no Functions deployment**, **no index deployment** occurred;
- **no data change** occurred.

**Do NOT assert that the live Rules hash equals the repository Rules hash** unless the chosen live-rules export is normalized in a reviewed way that makes the two artifacts directly comparable (raw live-ruleset serialization and the git blob are not byte-identical by default). The Rules-unchanged proof is **postdeploy live == predeploy live**, plus the governed repository-hash equality above.

## 4. Route + authorization verification (full A–E matrix)
Verify all five states at **`/admin/diagnostics/inventory-parts-parity`** exactly as in the merged handoff §3 (A signed-out → login, route not mounted; B authenticated-no-app-access → app No Access, not mounted; C authenticated non-admin/dispatcher → route resolves + component denial, Run/data unavailable; D admin → renders + Run; E dispatcher → renders + Run).
- **Dispatcher credential readiness: READY** — valid governed dispatcher test authentication confirmed by the Owner out-of-band; **no credential or identity value recorded** (no email, password, UID, reset link, token, or secret in evidence). Do **not** modify role/`operationalRoles`/claims/Firestore Rules. **State E remains a required live route verification**, and admin-only verification still does **not** complete the matrix.

## 5. One new live diagnostic run + capture
As **admin and dispatcher** (dispatcher readiness = READY, §4), click **Run shadow-parity** once (single active run), then click **"Copy sanitized evidence"** to capture the **exact payload**:
```
{ status, counts:{canonicalMatch,staticOnlyExcluded,rowMissing,fieldDivergence,
  availabilityDivergence,workflowDivergence,unexpectedUnmatched,structuralIssue},
  sourceCounts, staticCatalogHash, buildId, runId, capturedAtStart, capturedAtEnd }
```
`buildId` **must equal `73d9e1b`**. Sanitized only — no credentials/tokens/UIDs/emails/records/divergence values.

## 6. Return for review — do NOT open the evidence PR yet
Return the copied sanitized payload **and** the A–E route-verification result **for review**. **Do not create the evidence PR until ChatGPT reviews the new live payload.** Only a `status = PASS` payload (with all fields incl. capture timestamps and `buildId == 73d9e1b`) may qualify for Decision #44 after governed evidence export and review; `FAIL_PARITY`/`BLOCKED_*` are diagnostic evidence only. **No timestamps may be reconstructed or approximated.**

## 7. Safeguards / non-authorizations
- Handoff-only; Hosting-only; no Rules/Functions/indexes/data change; no source switch; no PartsList/PartDetail behavior change; no ordinary Inventory navigation exposure.
- Authorizes nothing; build+deploy, the live run, and any evidence export/commit are each separate, Owner-authorized operator actions, executed only after explicit authorization.
- Hosting-only rollback (re-deploy the prior released Hosting version). Decisions #43–#45 unchanged.

## 8. Stop conditions (abort immediately)
Dirty/wrong checkout · build id ≠ `73d9e1b` · dispatcher authentication fails at run time (readiness regresses from READY) · **postdeploy live Rules hash ≠ predeploy live Rules hash** · governed repository Rules hash ≠ `fda2423…5bac7` · Functions-inventory deviation (postdeploy ≠ predeploy) · any Rules/Functions/index/data change · deploy failure · any unexpected infrastructure change.
