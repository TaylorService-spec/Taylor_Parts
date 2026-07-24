# INV-1 I-1 — Read-only Part Master Visibility — Implementation & Deployment Plan

**Status:** PLANNING ONLY (docs-only). Authorizes **no** deployment, runtime change, Rules/Functions/frontend/Firebase-config change, production access, feature-flag activation, or migration. Baseline: verified `origin/main` = `a6daf63545f66e051aa922f9354a25ebc3074afa` (`git fetch origin --prune`, remote `TaylorService-spec/Taylor_Parts`).

**Objective:** safely show the 190 production Parts in the application as **read-only** data for `admin`/`dispatcher`, with all client writes remaining denied and `PART_MASTER_REFERENCE` OFF.

---

## 1. Headline finding — I-1 is deploy-only; zero runtime files change

Every piece of the read path is **already merged** on `a6daf63`. No new or modified runtime code is required for the simplest supported design. Verified in the repository:

| Concern | Evidence on `a6daf63` | State |
|---|---|---|
| `parts` read grant | `firestore.rules` + `field-ops-app-vite/firestore.rules` (byte-identical): `match /parts/{partId} { allow read: if isAdminOrDispatcher(); allow create, update, delete: if false; }` | present, **undeployed** |
| Sibling collections closed | `manufacturers` / `part_aliases` / `part_supplier_items`: `allow read, write: if false` | present |
| Read route wired | `field-ops-app-vite/src/App.jsx:23,146-147` (imports `PartMasterList`, renders it for `inventory`/`partMaster`) | wired |
| Nav item | `field-ops-app-vite/src/navigation/navConfig.js:175` (`{ key: "partMaster", label: "Part Master", path: "part-master" }`) | wired |
| Role→nav gating | `field-ops-app-vite/src/domain/constants.js:319-320` — `ADMIN` and `DISPATCHER` both include `inventory`; `TECHNICIAN` does not | aligned with the Rules grant (defense in depth) |
| Read service (write-free) | `field-ops-app-vite/src/services/partMasterQueries.js` — one-shot `getDocs(collection(db,"parts"))`; no `where`/`orderBy` ⇒ **no composite index needed**; zero write imports | present |
| Pure mapper / types | `domain/partMasterView.js`, `types/partMaster.ts` (read-only subset) | present |
| Feature flag | `functions/src/partMaster/partReferenceCompatibility.ts:66` — `PART_MASTER_REFERENCE === "enabled"`, **defaults OFF** | OFF; out of scope |
| Production data | 190 Parts live, reconciled (`docs/audits/inv1-phase1/create-execution-20260724/`); `part_aliases`=0, `part_supplier_items`=0 | ready |

**Exact runtime files a later implementation gate would change: NONE** (for the recommended design). The runtime artifacts are *deployed as-is*, not edited:
- `firestore.rules` (deploy source per `firebase.json`) — shipped verbatim; the byte-identical `field-ops-app-vite/firestore.rules` is a sync-only mirror, **not** a deploy source.
- The frontend bundle built from the already-merged `PartMasterList.jsx` / `partMasterQueries.js` / `partMasterView.js` / `types/partMaster.ts` / `navConfig.js` / `App.jsx`.

(The only scenario that edits a runtime file is decision **D-I1-1** choosing the Issue #100 matrix over the compatibility posture — see §8; that would change the `parts` read predicate in both `firestore.rules` files and is *not* the simplest supported design.)

## 2. Proposed architecture (simplest supported design)

Read is allowed **only** at two aligned layers, both already in the repo:
1. **Data layer (authoritative):** `firestore.rules` grants `parts` read to `admin`/`dispatcher` and denies every `parts` write (`create, update, delete: if false`). Mutation stays trusted-writer-only (`functions/src/partMaster/partMasterCommands.ts`, Admin SDK) per ADR-009.
2. **UI layer (defense in depth, not the enforcement boundary):** `ROLE_NAV_ACCESS` shows the Part Master nav only to `admin`/`dispatcher`; the surface has no write controls (source-scan-tested by `field-ops-app-vite/test/partMasterView.test.mjs`).

I-1 makes this live by **deploying the already-merged Rules + frontend**. No Functions change (createPart is unaffected), no index change, no config change, flag OFF.

## 3. Deployment sequence (documented, NOT executed)

Operator/Cloud Shell from a clean checkout of the authorized commit; project `taylor-parts` (`.firebaserc`). Mirrors the F-RULES-1 D2 rules-deployment precedent (`docs/operations/f-rules-1-d2-deployment-handoff.md`).

**A. Rules (`firebase deploy --only firestore:rules`)**
1. Secure the Customer-session release-lock on the shared `firestore.rules` (§7); pin the exact deploy commit.
2. Capture the pre-deploy **production ruleset** as the rollback artifact (Firebase Rules REST API → `rollback/firestore.rules`); record its SHA-256. Empty/malformed ⇒ **STOP, do not deploy.**
3. `firebase deploy --only firestore:rules --project taylor-parts`.
4. **Byte-verify:** fetch the live ruleset content; `sha256sum` must equal the governed git-blob `git show <commit>:firestore.rules | sha256sum` (at `a6daf63` this is `fda242399023b400c0f441b96e4103fc86f79f18e2bf04005cbc745e3785bac7`; re-derive from the actual deploy commit). Mismatch ⇒ **STOP → ROLLBACK.**
5. Run the §4 production matrix.

**B. Frontend (`firebase deploy --only hosting`)**
6. Build the SPA: `cd field-ops-app-vite && npm ci && npm run build` (produces `dist/`; `firebase.json` has **no predeploy hook**, so the build is a manual prerequisite — a stale/absent `dist/` would deploy stale assets).
7. `firebase deploy --only hosting --project taylor-parts`.
8. Confirm the `inventory/part-master` route renders the read-only list for admin/dispatcher and lists the 190 Parts; run the §4 UI rows.
9. Package evidence (deploy outputs, live-ruleset hash, matrix results, attestations) for a later import PR (docs/audits pattern).

**Ordering:** Rules **before** frontend so the UI has data on first render. The two are separable (Rules-only exposes read at the data layer; frontend-only shows its `permission-denied` state until Rules land).

## 4. Verification matrix & smoke tests

| Actor | `parts` read | `parts` write | manufacturers / part_aliases / part_supplier_items |
|---|---:|---:|---|
| unauthenticated | deny | deny | deny |
| technician | deny | deny | deny |
| dispatcher | **ALLOW** (sees 190) | deny | deny |
| admin | **ALLOW** (sees 190) | deny | deny |

Plus: live-ruleset SHA-256 == governed blob; an admin `parts` create/update/delete attempt **denied**; siblings read+write denied for all; UI at `inventory/part-master` renders read-only (no write affordance), lists 190 for admin/dispatcher, shows access-denied for technician. Pre-deploy test basis (already green in CI): `functions/test/partMasterRules.test.js` (parts read matrix, 20 checks, in the pinned Rules regression) and `field-ops-app-vite/test/partMasterView.test.mjs` (client read-only proofs, 8 checks). Use disposable fixtures only for the production run (D2 seed→run→cleanup pattern).

## 5. Reconciliation

The 190 Parts are already reconciled at write time (`docs/audits/inv1-phase1/create-execution-20260724/`: SUCCESS=190, post-write analyzer 190 NO_CHANGE). I-1 adds no data; reconciliation for this unit = the UI/read count equals the production `parts` count (190) for an authorized reader, and no non-parts collection becomes readable.

## 6. Rollback

- **Rules:** redeploy the §3.A.2 preserved baseline (`firebase deploy --only firestore:rules`); re-fetch and confirm the live hash equals the baseline. `parts` returns to fully client-closed; trusted-writer path unaffected; no data change. Bounded, immediate.
- **Frontend:** redeploy the prior hosting release (Firebase Hosting keeps release history / `firebase hosting:rollback`), or a build without the route. Under reverted Rules the UI degrades to access-denied/empty — no data risk.
- Triggers: live hash ≠ governed blob · any matrix row fails · unexpected write allowed · UI exposes a write control · Customer-content drift in the deployed `firestore.rules`.

## 7. Parallel Customer session control

`firestore.rules` (both files) is **shared** with the Customer workstream; deploying it ships the **entire current file** (Inventory's `parts` read grant + all Customer-owned blocks). Therefore:
- **Inventory owns the active deployment lane.** Only one production deployment owner may be active at a time.
- **Customer C-1 may do docs-only architecture in parallel** but may **not** merge deployment-bound runtime changes or deploy.
- **Release-lock:** freeze `firestore.rules` merges from baseline capture (§3.A.2) through post-deploy byte-verify (§3.A.4); record a combined-content acknowledgement of exactly which commit's full ruleset ships. If a Customer rules change is mid-flight, wait-and-re-pin or defer — never deploy a file whose Customer content wasn't intended.

## 8. Decisions needed

- **D-I1-1 — read-authorization posture.** Ship the seeded `admin`/`dispatcher` **compatibility** read grant as-is (already merged; the PR 1.9 Owner-approved compatibility posture), **or** first move `parts` read to the **Issue #100 governed permission matrix**? The PR 1.9 record and `docs/architecture/SYSTEM_AUTHORITIES.md` note that operational-role read expansion belongs to Issue #100 and raw role checks retire only after permission-model parity + production verification. *Recommended for I-1: ship the compatibility posture (zero runtime change, simplest supported design); treat the matrix migration as a separate later unit.* Choosing the matrix now = a runtime `firestore.rules` change (both files) + new tests — no longer deploy-only.
- **D-I1-2 — deploy pairing.** Rules-only (data-layer read) vs Rules + frontend together (visible UI). *Recommended: together, Rules first.*
- **D-I1-3 — release-lock window.** When to take the shared-rules freeze with the Customer session.

## 9. Risks

- **Shared-rules combined-content drift** — mitigated by §7 release-lock + §3.A.4 byte-verify.
- **Stale hosting bundle** — `firebase.json` has no predeploy build hook; `dist/` must be freshly built at the deploy commit (§3.B.6), else stale assets ship.
- **Compatibility-posture debt** — deploying admin/dispatcher raw-role reads adds to the Issue #100 raw-role-retirement backlog (D-I1-1).
- **Exposure of a partially-understood dataset** — low: the 190 Parts are reconciled and descriptive-only (no cost/quantity fields; stock stays the ledger; siblings stay closed).

## 10. Dependencies

Governed Parts live + reconciled ✅ (#408) · Decision #42 **D-M7** ("deploy read Rules only after migration + reconciliation") ✅ satisfied · both `firestore.rules` byte-identical ✅ · read UI merged + write-free ✅ · role-nav gating aligned ✅ · no index required ✅ · rollback-baseline procedure ✅ (D2 precedent) · Customer release-lock ⚠ to secure at the deployment gate.

## 11. Extension points (recorded, NOT implemented)

Future units, each its own separately-authorized gate — do **not** build here: Issue #100 governed-matrix read authorization (replaces the compatibility grant) · `PART_MASTER_REFERENCE` activation (D-M6, ledger resolver) · a governed Part **write/edit** UI via a trusted `createPart` callable (ADR-009 gap G2) · alias / supplier-item read visibility (their collections stay closed until their own migrations, D-M2/D-M4) · quantity/availability surfacing (stays the ledger). This plan surfaces these as boundaries only.

## 12. Next gate

**INV-1 I-1 Deployment Authorization** — resolves D-I1-1/2/3, secures the Customer release-lock, and authorizes the operator handoff (Rules deploy + byte-verify + verification matrix, then frontend build + hosting deploy + verification), followed by an evidence-import PR. No deployment occurs until that gate.
