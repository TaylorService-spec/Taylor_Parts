---
artifact_type: deployment-handoff
unit: INV-CONVERGENCE-E Stage A — deployment & live-evidence handoff
status: Draft — HANDOFF ONLY, awaiting Owner and ChatGPT review; authorizes no deployment
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: 56094960f3e98fe3478ab3e1745acae1e6ac50ef (origin/main — Stage A code-complete)
implements: docs/implementation-plans/inv-convergence-e-stage-a-completion-note.md
related_decisions: "DECISIONS.md #43, #44, #45"
authorizes: nothing — operator-executed steps below are a separate reviewed action; this doc is docs-only
---

# INV-CONVERGENCE-E Stage A — deployment & live-evidence handoff

Operator handoff to make the code-complete Stage A diagnostic (merged, PR #425) reachable in production and capture one live parity result. **This document authorizes no deployment** — it is a reviewed procedure for a separate, Owner-authorized operator step (F-RULES-1 D-gate precedent). **Decision #44 is NOT satisfied by this handoff**; it is satisfied only by a committed live `PASS` artifact (§7).

**Scope: Firebase Hosting only.** No Rules, Functions, indexes, or data are touched.

## 1. Exact commit to build and deploy
- **Commit:** `56094960f3e98fe3478ab3e1745acae1e6ac50ef` (`origin/main`, Stage A code-complete).
- Build from a **clean checkout of this exact commit** so the injected `__APP_COMMIT__` (git short SHA, `vite.config.js` `define`) matches the deployed bundle. A stale/dirty tree would embed the wrong build id.

## 2. Deployment scope — Firebase Hosting only
- Build: `cd field-ops-app-vite && npm ci && npm run build:firebase` (`vite build --base=/`; produces `field-ops-app-vite/dist`, the Hosting `public` dir; `firebase.json` has **no predeploy hook**, so the build is a manual prerequisite — a stale/absent `dist/` would publish stale assets).
- Deploy: **`firebase deploy --only hosting --project taylor-parts`**. The SPA rewrite (`**` → `/index.html`) makes the client route resolve.
- **Confirm untouched — never pass these:** no `--only firestore:rules`, no `--only firestore:indexes`, no `--only functions`, no data writes. Rules/Functions/indexes/data are outside this deploy's scope; the §2.5 pre/post evidence proves it.

## 2.5 Exact pre/post infrastructure evidence
Capture the following, sanitized (no credentials/tokens/UIDs/emails/records), into `docs/audits/inv-convergence-e-stage-a/deployment/`.

**Before deployment (predeploy):**
- clean checkout commit = `56094960f3e98fe3478ab3e1745acae1e6ac50ef`;
- governed **root `firestore.rules` SHA-256** (`git show 56094960:firestore.rules | sha256sum`);
- **live production Rules hash** (fetch the live ruleset via the Firebase Rules REST API and `sha256sum`, or hash the exported live-Rules artifact) → `predeploy-rules-hash.txt`;
- **deployed Functions inventory** (`firebase functions:list --project taylor-parts`, names/regions/runtimes only) → `predeploy-functions.txt`;
- **current Hosting release identifier** where available (Firebase Hosting release id/version).

**After deployment (postdeploy):**
- deploy command; deploy **exit code**; Hosting **release timestamp**; **Hosting URL**; deployed **bundle build identifier** (`__APP_COMMIT__` from the served bundle) → `hosting-deploy.txt`;
- **live production Rules hash** → `postdeploy-rules-hash.txt`;
- **deployed Functions inventory** → `postdeploy-functions.txt`.

**Explicit required assertions (record PASS/FAIL for each in `verification-summary.md`):**
- postdeploy Rules hash **equals** predeploy Rules hash;
- postdeploy Functions inventory **equals** predeploy Functions inventory;
- **no Rules deployment occurred**;
- **no Functions deployment occurred**;
- **no indexes or data changes occurred**;
- rendered/deployed build identifier **equals short SHA `5609496`**.

**Sanitized evidence layout:**
```
docs/audits/inv-convergence-e-stage-a/deployment/
  predeploy-rules-hash.txt
  predeploy-functions.txt
  hosting-deploy.txt
  postdeploy-rules-hash.txt
  postdeploy-functions.txt
  verification-summary.md
  SHA256SUMS.txt
```
No credentials, tokens, UIDs, emails, or full production records in any file. (Committing this evidence is part of the separate reviewed evidence-commit step, §7.)

## 3. Route + authorization verification (post-deploy)
Route: **`/admin/diagnostics/inventory-parts-parity`** (Firebase Hosting site root; no navigation entry — reached only by direct URL). Verify **all five** states — the app distinguishes signed-out and no-application-access from the component's admin/dispatcher denial:

| # | State | Expected |
|---|---|---|
| A | **Signed out** | The **login screen**; the diagnostics route/component is **not mounted** (this is app auth, **not** the component No Access state). |
| B | **Authenticated, no application access** | The **application-level standard "No access" screen**; the diagnostics route/component is **not mounted**. |
| C | **Authenticated, has app access, role not admin/dispatcher** (e.g. technician) | The **route resolves** and the diagnostics component displays **its own admin/dispatcher-only denial**; the **Run button and diagnostics data are unavailable**. |
| D | **Authenticated admin** | Diagnostic **renders**; **Run** button visible. |
| E | **Authenticated dispatcher** | Diagnostic **renders**; **Run** button visible. |

**Firestore Rules unchanged** — the involved collections (`parts`, `inventory_transactions`, `reorder_requests`, `reorder_purchase_orders`) are already admin/dispatcher-readable, so no Rules change is required for a `PASS`. Do **not** describe the signed-out state (A) as the component No Access state; A/B are app-level auth, C is the component gate.

## 3.5 Dispatcher credential readiness — HARD PRECONDITION
Before deployment execution, confirm that a **valid dispatcher test credential can authenticate** (state E is required; admin verification alone does **not** complete the route matrix).

- **Current state:** the previously attempted dispatcher account was **blocked at authentication** with **"Invalid email or password"** — a **credential failure that occurs before any Firestore authorization**. Record this as **`BLOCKED_CREDENTIAL`**.
- **Do NOT** change the Firestore user role, `operationalRoles`, custom claims, or Rules to resolve it — this is a credential-provisioning issue, not an authorization one.
- **Dispatcher verification (E) cannot be marked PASS until a valid dispatcher credential is available.** The route matrix (and therefore the deployment's verification) stays incomplete while dispatcher readiness is `BLOCKED_CREDENTIAL`.
- **Never** place passwords, tokens, UIDs, or authentication secrets in evidence — record only the readiness state (`BLOCKED_CREDENTIAL` vs `READY`) and the account label.

## 4. One live diagnostic run
As an **admin or dispatcher**, open the route and click **Run shadow-parity** once (single active run; the button disables while running). The run performs one-shot reads only (no subscriptions, no writes).

## 5. Capture (sanitized) from the rendered result
Record: **status**, source/parity **counts** (canonicalMatch, staticOnlyExcluded, rowMissing, fieldDivergence, availabilityDivergence, workflowDivergence, unexpectedUnmatched, structuralIssue), **static-catalog hash**, **build id** (`__APP_COMMIT__`, must equal the §1 commit's short SHA), **run ID**, and **capture start/end timestamps**. Counts/hashes/summaries only — **no** credentials, tokens, UIDs, emails, or full records.

## 6. Interpreting the result
- Expected `PASS` totals: 200 source / 190 CANONICAL_MATCH / 10 STATIC_ONLY_EXCLUDED / 0 rowMissing / 0 field / 0 availability / 0 workflow divergence.
- `FAIL_PARITY` → a real current-vs-shadow divergence; investigate (do not proceed to cutover).
- `BLOCKED_PERMISSION` / `BLOCKED_UNAVAILABLE` / `BLOCKED_INCOMPLETE_INPUT` (incl. a missing/`"unknown"` build id) → the run is inconclusive; fix and re-run.

## 7. Decision #44 qualification (PASS-only) + evidence export
- **Only a `status = PASS`** run satisfies the Decision #44 live pre-cutover parity gate, and only once its artifact (status + counts + static-catalog hash + build id + run ID + capture timestamps) is **manually exported (sanitized)** and **committed to the repository** — a **separate, reviewed operator step** (suggested home: `docs/audits/inv-convergence-e-stage-a/` with SHA-256 + attestation, per the INV-CONVERGENCE-B evidence pattern).
- `FAIL_PARITY` and every `BLOCKED_*` result **do not** satisfy the gate; they may be retained only as diagnostic evidence.

## 8. Safeguards / non-authorizations
- **Hosting-only** deploy; **no** Rules / Functions / indexes / data change (proven by §2.5 pre/post evidence); **no** source switch; **no** PartsList/PartDetail behavior change; **no** ordinary Inventory navigation exposure.
- **Dispatcher credential readiness (§3.5) is a hard precondition** — while it is `BLOCKED_CREDENTIAL` the route matrix (state E) is incomplete and the deployment verification cannot be marked complete; do **not** alter role/`operationalRoles`/claims/Rules to work around it.
- This handoff authorizes nothing; the build+deploy and the evidence export/commit are each separate, Owner-authorized operator actions.
- Decisions #43–#45 unchanged. Stage A remains a diagnostic gate — it does not perform D (approved-ten) or B (operational-role Rules) or C1/C2 cutover.

## 9. Rollback
Hosting rollback only: re-deploy the previous released Hosting version (Firebase Hosting release history / `firebase hosting:clone` or re-deploy the prior commit's build). No data/Rules/Functions rollback is involved because none were changed.
