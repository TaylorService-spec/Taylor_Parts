Issued: 2026-10-16 (America/Phoenix) · base **main `6a677c42`** (#2114 PR-B merged; retargeted from the stacked base) · Firebase-exit lane (O-1, DECISIONS #234)

**Do not merge without exact-head Owner authorization.** Lane D delta review is requested on the exact head.

Commits:
- `6e8978ce`: the type-only change.
- `dade199e`: a merge of main. Main's tree equals PR-B's `be1afc3c`, so this merge changes nothing.
- `beb0e060`: the Lane D PR-B follow-ups (C-1 to C-3, plus item 4), which **do** change output, as listed below.

Owner decision (2026-10-15): "PR-C APPROVED: obsolete type-reference cleanup."

## What this does
Ten record-type modules imported the Firestore `Timestamp` type only to name a field's type. That type-only import still counted as a Firestore dependency of each file. They now import a structural `TimestampShape` (`seconds`, `nanoseconds`, `toDate()`, `toMillis()`) from a **declaration file**, which emits nothing:
- `functions/src/types/timestampShape.d.ts`;
- `field-ops-app-vite/src/types/timestampShape.d.ts`.

Each file changes exactly one line:
`import type { TimestampShape as Timestamp } from "…/timestampShape";`

The ten files:
- Server: `types/{access,inventoryTransaction,procurement,warehouse,workOrder}.ts`, `scheduling/types.ts`, `supplierMaster/supplierMasterTypes.ts`, `access/parityFixtures.ts`.
- Client: `types/access.ts`, `access/parityFixtures.ts`.

A real Firestore `Timestamp` satisfies the shape structurally. `functions` `tsc` and the client `tsc --noEmit` both pass.

Other changes:
- `syncAccessContracts.mjs`: the `parityFixtures.ts` platform substitution (firebase-admin vs firebase Timestamp) is **retired**. Both copies now import the same relative path, so the generated copy is byte-identical apart from its banner. `--check` passes.
- `firebaseExitGuard.test.mjs`: the prose-classification test that pinned `types/workOrder.ts` as a Firestore entry now expects no category. It still mentions `admin.firestore` in a comment, which must still add nothing.

Exit baseline **257 → 247**:
- `frontend.firestore_client` 12 → 10;
- `server.firebase_admin_firestore` 166 → 158.

## The type commit (`6e8978ce`): proof of no runtime change
| Output | Before (main `6a677c42`) | After (type commit, same tree as `6e8978ce`) |
|---|---|---|
| `functions/lib`, 1391 files, aggregate sha256 | `ffdcad08…` | `ffdcad08…` (identical) |
| vite `dist`, 213 files, aggregate sha256 | `f0add7f0…` | `f0add7f0…` (identical) |

- The dist was built from `git archive` trees, so the commit stamp is equal on both sides. `version.json` differs only in `buildTime`.
- Because this touches `functions/**`, Render redeploys **identical JavaScript**.

## The cleanup commit (`beb0e060`): intended runtime changes (Lane D #2114 review C-1 to C-3, plus item 4)

| # | Change | Output effect |
|---|---|---|
| C-1 | `functions/src/catalogMaster/catalogWriterState.ts`: the `manufacturer.create` / `update` / `changeStatus` `reachedFrom` strings no longer name the deleted `manufacturerCommandClient.js` as a live client. They now read "…removed from the repository in Firebase exit PR-B…", in the F2 / F3a wording. | `functions/lib` changes **only** in `catalogMaster/catalogWriterState.js` and its `.map`. This is a diagnostic caller inventory string, and no behaviour depends on it. `catalogMaster.test` 31/31. |
| C-2 | `index.css`: removes 33 `fo-mfr__*` rules with no remaining user. Only `fo-mfr__hint` stays. | The vite `dist` changes **only** in `assets/index-*.css`: after normalizing content-hash suffixes, 212 of 212 files match except that one, and all 32 differing CSS rule lines are `fo-mfr__*` rules. The renamed JS chunks are only a hash cascade from the CSS filename. `cssClassCoverage` passes. |
| C-3 | `domain/dashboardComposition.js:637`: the comment points at the EOS Core balance read instead of the deleted client transport. | None (a comment). |
| 4 | `domain/manufacturerWrite.js` is deleted (only its own test imported it). `manufacturerWrite.test.mjs` keeps its live `manufacturersView` checks. The stale workflow path filter is pruned and the ledger row corrected. | None (it was not in the bundle). |

## Verification (local, on the exact pushed tree `0581a2e7` (tested as the rebased `57b7a1f2`, identical tree): WSL Ubuntu-24.04 LF clone, Node 22.23.2)
- Firebase-exit guards: **141/141**.
- Exit guard and shim ratchet against main `6a677c42`: OK. Total **247**.
- `syncAccessContracts --check`: OK.
- `npm test` (the full client manifest): **316 suites passed**.
- Every `deployment-drift-core` step passed.
- vitest: **4077 passed**.
- oxlint: 0 errors. tsc and build: OK.
- Affected functions suites, all green: `adminCredentialEligibility`, `certificationAuthorityGenesis`, `certificationGenesisRoleAdministration`, `compactClaimsMirrorIntegrity`, `conditionKindInventory`, `equipmentCompatibilityRegistry`, `schedulingAvailabilityModel`, `shadowParityHarness`, `catalogMaster`.

No Functions deploy, Rules, index, credential, production or authentication change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
