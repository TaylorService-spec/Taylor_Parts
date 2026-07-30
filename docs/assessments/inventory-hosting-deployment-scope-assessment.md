# Inventory Hosting Deployment — Scope Assessment (read-only, documentation-only)

**Status:** DRAFT for independent Codex review. **Assessment only — authorizes no deployment, no deployment-package preparation, no release commit, no code change, no production access.** Owner-authorized read-only assessment, 2026-07-30.

**Question answered:** would deploying a Firebase Hosting build from `1f76f84cc38ddf9f611e79615c3b311ed1b21b2b` (the pinned Inventory WMH/C1/C2 commit) release **only** the intended Inventory changes, or would it also release unrelated Customer/Auth, Equipment, Reporting, or other frontend changes?

**Answer (summary):** it would release a **combined multi-lane frontend build** — Inventory **and** Customer/Auth **and** Equipment runtime code — which is a prohibited combined-lane release under DECISIONS #57/#58 and the standing Auth/Equipment "not deployed" holds. The Inventory C2 surface (`PartDetail.jsx`) at `1f76f84` is additionally **hard-entangled with Equipment D6**, so a clean Inventory-only isolation is not achievable without a code change that alters merged behavior. **Recommended: defer and deploy current `main` once Customer/Auth and Equipment independently reach deployment clearance, under one coordinated cross-lane release authorization** (Option C).

---

## 1. Evidenced live baseline (expected only — not re-verified)

- **Expected live commit:** `081df750d89d9044f0e09bb0241796b8171ed33f` (PR #447 merge, "ops/inv-convergence-e-c2-hosting-deploy-prep", 2026-07-26).
- **Source of the claim:** DECISIONS **#50** (C2 Hosting deployment SATISFIED). It records the authorized artifact `081df750`, predeploy Hosting version `sites/taylor-parts/versions/0bd9029d010914b7`, new release `sites/taylor-parts/versions/1ef5d23b1c0b9466`, and live asset `/assets/index-Bpj7e20-.js` (`sha256 756693f2…eb11ff5`). Sanitized evidence under `docs/audits/inv-convergence-e-c2-hosting-deploy/`.
- **Treatment:** this is the **expected** baseline. This assessment does **not** access production and therefore does **not** re-assert that `081df750` is still the live release. Any deployment gate that follows must re-establish the true current live release with fresh authorized evidence before acting.

## 2. Runtime (shipping) delta `081df750..1f76f84`

- Window size: **127 commits**, ~20 merged PRs across Inventory, Customer/Auth, Equipment, and Reporting/Platform lanes.
- `081df750` is a **direct ancestor** of `1f76f84` (linear-forward; a `1f76f84` build strictly adds to the baseline, reverts nothing that is on the baseline).
- **Shipping runtime source files changed = 18** (files that compile into the SPA bundle; excludes tests, CI, docs). Breakdown: Inventory 5 + Customer/Auth 5 + Equipment 6 + shared frontend infrastructure 2 = **18**.
- **Not shipping:** `package.json` / `package-lock.json` changed **dev-tooling only** (`@testing-library/*`, `jsdom`, `vitest`, added `test:components` script and test-list entries). The production dependency block (`firebase`, `react`, `react-dom`, `react-router-dom`) is **unchanged** — no runtime dependency enters the bundle from this delta.

### Lane classification of the 18 shipping runtime files

| Lane | Files | Driving PR(s) |
|---|---|---|
| **Inventory (intended)** | `domain/partsCatalogView.js` (shared composer, invalid-guard hardening), `domain/warehouseManagerCatalogView.js` (new), `modules/inventoryRole/WarehouseManagerHome.jsx`, `modules/inventory/PartsList.jsx` (C1), `modules/inventory/PartDetail.jsx` (C2) | #479, #481 |
| **Customer/Auth** | `access/adminPasswordResetClient.js`, `access/permissionCatalog.ts`, `domain/adminPasswordReset.js`, `domain/adminUsersResetView.js`, `modules/administration/AdminUsers.jsx` | AUTH-UI-2 (#470), AUTH-UI-3 (#471), AUTH-PR-3.5 (#472) |
| **Equipment** | `domain/equipmentModel.js`, `domain/equipmentCompatibility.js`, `domain/equipmentCompatibilityImport.js`, `domain/equipmentCompatibilitySection.js`, `services/equipmentCompatibilitySource.js`, `modules/inventory/UsedInEquipmentSection.jsx` (Part Detail "Used In Equipment" section, D6) | D4 (#459), D3 (#456), D6 (#475) |
| **Shared frontend infrastructure** | `src/App.jsx` (route wiring), `src/index.css` (global styles) | Both last modified by **Equipment D6** (`7fd656c`, `eae4339`); the App.jsx delta adds the `hasCapability`/`accessVersion` props on the PartDetail route that D6's section consumes |
| **Reporting/Platform** | *(none)* | — |
| **Documentation / test / CI only** | not shipped; excluded from the runtime delta | — |

**Note on `UsedInEquipmentSection.jsx`:** it lives under `src/modules/inventory/` by directory but is **Equipment lane** (D6 Part–Equipment compatibility). Directory location does not make it Inventory.

## 3. Intervening Hosting deployments after the C2 evidence

**No later frontend Hosting deployment is recorded or proven by repository evidence.** This assessment inspected only committed governance and evidence; it did **not** access production and therefore cannot assert as fact that none occurred — only that the repository records none. Every governance entry after DECISIONS #50 (#51 Equipment architecture, #52/#53 AUTH-PR-4 production identity-mutation *(Functions/Auth, not frontend Hosting)*, #54/#55/#56 Customer password-reset roadmap/authority/design, #57 WMH cutover, #58 C1/C2) is **repository-only** and each explicitly states "**not deployed**" and/or "**merge ≠ deployment**", with hard-stops before any Hosting deployment. No committed deployment-evidence directory records a **frontend Hosting** release after `081df750`:

- `docs/audits/inv-convergence-e-c1-hosting-deploy/` and `…-c2-hosting-deploy/` — the C1 and C2 frontend deploys (≤ `081df750`).
- `docs/audits/firestore-deployment-verification-20260727/`, `…/f-rules-1/d2-rules-deployment/` — **Rules** deploys, not frontend.
- `docs/audits/inv-convergence-e-stage-a/deployment/` — the Stage-A diagnostic deploy (≤ C2).

**Conclusion (repository-evidence-bounded):** no later frontend Hosting deployment is **recorded or proven by repository evidence**; on that evidence the Customer/Auth (AUTH-UI-2/3, AUTH-PR-3.5) and Equipment (D3/D4/D6) runtime changes in the window are **not recorded as released to Hosting**. `081df750` therefore remains the **expected** baseline. Because no production inspection was performed, an **authorized read-only production check must establish the actual current live baseline before any deployment gate** — this assessment does not, and cannot, prove the live state.

## 4. Monolithic-bundle impact

Firebase Hosting for this project serves the **complete built SPA** (`vite build` → `dist/` → content-hashed JS/CSS chunks + `index.html`), published wholesale via `firebase deploy --only hosting`. **Hosting does not deploy selected source files** — it publishes whatever the build compiled from the working tree at build time.

Therefore a build from `1f76f84` compiles and makes live **all 18 shipping runtime changes at once**, including:

- **Customer/Auth:** the admin password-reset client/domain/view state and the `AdminUsers.jsx` reset action (AUTH-UI-3 wires a reset control into the admin surface; AUTH-PR-3.5's Firebase-native reset path and `permissionCatalog` entry are compiled in). DECISIONS #56 states production use of admin password reset **remains blocked until separately authorized**; the permission is registered **inactive** with **no role grants**.
- **Equipment:** the D3/D4 pure compatibility/model domains and the D6 Part Detail "Used In Equipment" section (`UsedInEquipmentSection.jsx` + `equipmentCompatibilitySource.js`), described at merge as **INERT / repository-only**.

**This constitutes a prohibited combined-lane release.** It violates the explicit "**no combined Inventory + Customer release**" clause in DECISIONS #50/#57, the Auth "production blocked" hold (#56), and the Equipment "not deployed" posture (#51 and the D6 INERT framing). Even where the non-Inventory code is permission-gated or inert (not user-reachable), the bundle would still **ship and release that code**, which is outside any current deployment authorization.

## 5. Safe release options (evaluated, not implemented)

| Option | Description | Assessment |
|---|---|---|
| **A. Cross-lane release of current `main`** | Deploy `main` (or `1f76f84`) under **one separately-reviewed cross-lane release authorization** covering Inventory + Auth + Equipment together. | Legitimate, but requires **every** lane to reach deployment clearance and sign off in a single authorization. Not available today (Auth reset is production-blocked; Equipment D-lanes are repository-only). |
| **B. Isolated Inventory-only release commit from the baseline** | Build from `081df750` + only the Inventory changes. | **Not cleanly feasible.** `PartDetail.jsx@1f76f84` **imports and renders** Equipment D6 `UsedInEquipmentSection` (line 5 + line 1394) and receives D6 props via the `App.jsx` route — neither exists on `081df750`. Isolating Inventory would require **reverting the D6 import from PartDetail** (and the App.jsx props), i.e. a **code change** producing a `PartDetail` that matches neither the baseline nor `main`. Lowers build-identity/provenance trust and would itself need a separate reviewed repository gate. See §6. |
| **C. Defer + coordinated cross-lane release (RECOMMENDED)** | Defer Inventory Hosting deployment until Customer/Auth and Equipment **independently** reach deployment clearance; then deploy current `main` once, under one coordinated cross-lane authorization. | **No isolation surgery, reverts no live behavior, trustworthy build identity** (a real `main` commit). Cost: Inventory WMH/C1/C2 waits on the other lanes. This is the same endpoint as Option A, sequenced safely. |
| **D. Other** | — | No repository-supported option was found that releases Inventory alone without either the §6 isolation surgery (B) or a combined-lane release (A). |

**Recommendation: Option C.** It is the only path that neither rolls back already-live behavior nor silently releases unauthorized Auth/Equipment code nor depends on fragile source isolation. Option A is its eventual mechanism once all lanes clear. Option B is not recommended: the PartDetail↔D6 entanglement makes an "Inventory-only" build a novel, lower-trust artifact requiring a code change.

## 6. Isolated-release-commit proof (for Option B, if ever pursued — assessment only)

Were an isolated Inventory-only release commit built on `081df750`:

- **Would be included (Inventory runtime):** `domain/partsCatalogView.js`, `domain/warehouseManagerCatalogView.js`, `modules/inventoryRole/WarehouseManagerHome.jsx`, `modules/inventory/PartsList.jsx`, `modules/inventory/PartDetail.jsx`.
- **Would be excluded:** all Customer/Auth (5 files) and Equipment domain/services (`equipmentModel.js`, `equipmentCompatibility*.js`, `equipmentCompatibilitySource.js`) and `UsedInEquipmentSection.jsx`.
- **Reverting already-live behavior?** No — the baseline `081df750` contains **none** of the excluded lanes' code, so excluding them removes nothing users currently have. (This is why the linear-ancestor fact in §2 matters.)
- **But — a required code change:** `PartDetail.jsx@1f76f84` **depends on** the excluded D6 `UsedInEquipmentSection` import (and the App.jsx D6 props). An isolated commit must therefore **drop that import/usage** (and the App.jsx prop wiring), yielding a `PartDetail`/`App.jsx` that differ from both `081df750` and `main`. That is a source change, not a pure subset.
- **Build identity / rollback provenance:** the resulting artifact would be a **new, never-reviewed commit** distinct from any point in `main` history. Its build hash would match nothing previously reviewed or deployed; rollback provenance (which commit to revert to) becomes ambiguous relative to `main`. Trust is materially lower than deploying a real `main` commit.
- **Gate requirement:** creating such a release commit is itself a **code change** and would require its **own separate reviewed repository gate** (Codex + Owner) before it could even be considered for a deployment gate. It is explicitly **not** authorized by this assessment.

## 7. Owner decisions requested

1. **Release strategy** — adopt **Option C** (defer; coordinated cross-lane release of `main` when Auth + Equipment clear), **Option A** (authorize a cross-lane release now — requires Auth + Equipment deployment clearance in the same authorization), or direct **Option B** (accept the §6 isolation surgery + its separate gate)?
2. **Baseline re-verification** — authorize (separately) a read-only production check to confirm the true current live release before any future deployment gate, since this assessment did not access production?
3. **Sequencing** — if Option C, should the deployment-package preparation remain HELD until Auth and Equipment each record independent Hosting deployment clearance?

## 8. Hard boundaries honored by this assessment

No production access; no Hosting deployment; no deployment-package preparation; no release branch or cherry-pick; no code change; no build presented as production-authorized; no Customer/Auth or Equipment authorization; no Issue #100 production verifier; no cross-domain roadmap reconciliation. **Documentation-only.** Merge requires independent Codex review and a separate Owner decision. **Stop before deployment-package preparation.**
