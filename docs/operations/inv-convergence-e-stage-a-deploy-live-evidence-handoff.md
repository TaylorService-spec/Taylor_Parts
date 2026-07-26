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
- **Confirm untouched — never pass these:** no `--only firestore:rules`, no `--only firestore:indexes`, no `--only functions`, no data writes. After deploy, confirm the live ruleset hash and the deployed Functions list are **unchanged** from pre-deploy (Rules/Functions/indexes/data are outside this deploy's scope).

## 3. Route + authorization verification (post-deploy)
Route: **`/admin/diagnostics/inventory-parts-parity`** (Firebase Hosting site root; no navigation entry — reached only by direct URL).
- **admin** session → route renders the diagnostic (Run button visible).
- **dispatcher** session → route renders the diagnostic.
- **unauthorized role** (e.g. technician / PARTS_MANAGER / signed-out) → the **standard No Access** state ("available to admin/dispatcher only"); no diagnostic, no data. This is a real gate (component `isDiagnosticsAuthorized(role)`), not route obscurity. **Firestore Rules unchanged** — the involved collections (`parts`, `inventory_transactions`, `reorder_requests`, `reorder_purchase_orders`) are already admin/dispatcher-readable, so no Rules change is required for a `PASS`.

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
- **Hosting-only** deploy; **no** Rules / Functions / indexes / data change; **no** source switch; **no** PartsList/PartDetail behavior change; **no** ordinary Inventory navigation exposure.
- This handoff authorizes nothing; the build+deploy and the evidence export/commit are each separate, Owner-authorized operator actions.
- Decisions #43–#45 unchanged. Stage A remains a diagnostic gate — it does not perform D (approved-ten) or B (operational-role Rules) or C1/C2 cutover.

## 9. Rollback
Hosting rollback only: re-deploy the previous released Hosting version (Firebase Hosting release history / `firebase hosting:clone` or re-deploy the prior commit's build). No data/Rules/Functions rollback is involved because none were changed.
