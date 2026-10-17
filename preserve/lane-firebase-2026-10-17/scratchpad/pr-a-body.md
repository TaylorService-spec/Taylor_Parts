Issued: 2026-10-15 (America/Phoenix) · base `93bec3b7`, with main `3f5ed759` (#2108, #2084, #2107, #2111, #2113) merged in · Firebase-exit lane (O-1, DECISIONS #234)

**Do not merge without exact-head Owner authorization.** Lane D independent review requested on the exact head.

Owner decision (2026-10-15): "PR-A APPROVED: remove the unrouted legacy Technicians screen after proving no reachable workflow depends on it."

## What this does

Deletes the unrouted legacy Technicians screen and its private Firebase chain. **Exit baseline: 265 → 261** (`frontend.firestore_client` 17 → 13). **Shim registry: 4 → 2** (`collectionStore.js` and `firebaseSafe.js` are gone). No runtime change: the deleted code had no reachable entry point.

| Deleted | Firebase use |
|---|---|
| `src/modules/technicians/Technicians.jsx` | `onSnapshot` on `fieldops_technicians` (through `useFirestoreCollection`) |
| `src/modules/technicians/NewTechnicianModal.jsx` | the create form for that screen |
| `src/domain/jobActions.js` | `addDoc` / `runTransaction` on `fieldops_jobs` + `fieldops_technicians` |
| `src/firebase/collectionStore.js` | the shared client Firestore writer (shim) |
| `src/lib/firebaseSafe.js` | the `safe*Doc` write wrappers (shim) |
| `src/hooks/useFirestoreCollection.js` | the generic collection `onSnapshot` hook |
| `technicianSaveErrorMessage` | error copy for the deleted modal |
| `test/techniciansErrorState.test.jsx`, `test/techniciansSurfaceEmployeeDivergence.test.jsx` | tests of the deleted screen |

## Proof that no reachable workflow depends on it

1. **Route.** `App.jsx` reached `Technicians` only through `LEGACY_COMPONENTS[item.legacyKey]` (`App.jsx:902`). The `legacyKey` values present in the nav config are: operations, controlTower, jobs, dispatch, fieldMode, dispatcherBoard and inventory. That list was enumerated by importing `navigation/navConfig.js` and walking every object. **`technicians` is not among them.** The Administration Users consolidation removed the last such item (see the `navConfig.js` comment "ADMINISTRATION USERS CONSOLIDATION"). The `/administration` index and `/administration/employees` both redirect to `/administration/users`.
2. **Server navigation catalog.** `functions/src` and `functions/migrations` contain no `"technicians"` key and no `legacyKey`.
3. **Static importers.** I searched for every `from`, `import(`, `require(` and `vi.mock(` that names one of the six modules:
   - `App.jsx` imports `Technicians.jsx`. That import fed only the unreachable `LEGACY_COMPONENTS` entry.
   - `Technicians.jsx` imports `NewTechnicianModal`, `jobActions` and `useFirestoreCollection`.
   - `jobActions` imports `collectionStore`.
   - `collectionStore` imports `firebaseSafe`.

   That is a closed chain. Nothing outside it imports any of these modules. Every other reference is a comment.
4. **Dynamic imports.** No `import()` names any of the six files.
5. **Tests.**
   - Two suites rendered the deleted screen. Both are deleted, and the one named in `metadata-contracts-tests.yml` is removed from that workflow.
   - Nine suites (one is the #2108 visual harness) `vi.mock`ed `useFirestoreCollection` or `collectionStore` for components that no longer import them. Those mocks were inert and are removed.
   - The two "no subscription" tripwires in `customersSurface.test.jsx` now check `AccountsList.jsx`'s own imports.
   - `createdRecordIsReachable` and `collectionStoreTimestampContract` read `collectionStore.js`. They now assert that the retired writer stays deleted. Their general invariants are unchanged.
   - `ciSuiteCoverage`'s known-debt list drops `techniciansErrorState.test.jsx` (shrink-only).
6. **Left as it is.** The `technicians` entry in `ROLE_NAV_ACCESS` (`domain/constants.js`) gates nothing, because no nav item asks for it.

## Business requirements preserved

Recorded in `docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md` (new):

| Requirement | EOS owner |
|---|---|
| Workforce list | The governed Employee directory, plus `listWorkOrderTechnicians` |
| Add a technician | Employee creation and role administration in PostgreSQL |
| Live job status | Derived from `eos_ops` Work Order state |
| Job assignment and transitions | `/operations/work-orders` |

`fieldops_technicians` and `fieldops_jobs` get no EOS writer.

## Ratchet and registry
- `firebase-exit-baseline.json`: −4 entries.
- `firebaseExitGuard.test.mjs`:
  - `firestore_client` 17 → 13;
  - total 265 → 261;
  - the `src/lib/` walk test now proves the walk on a synthetic tree, because no real Firestore importer remains under `src/lib/`.
- `firebaseShimBoundary.test.mjs`: registry 4 → 2 shims; already-fenced consumers 25 → 22.
- `firebase-shim-consumer-census.json`: regenerated with `--write`.
- `ACTIVE_WORKSTREAMS.md`: the Firebase-exit lane is registered.

## Verification (local, on the exact pushed tree, Linux: WSL Ubuntu-24.04, LF clone, Node 22.23.2)
- `node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs scripts/firebaseCapabilityEquivalenceGuard.test.mjs`: **141/141**.
- `node scripts/firebaseExitGuard.mjs --previous-baseline=<main copy>`: no new dependencies; ratchet OK.
- `node scripts/firebaseShimBoundary.mjs --previous-census=<main copy>`: 2 shims, 1 tolerated consumer, 0 new.
- Node suites, each 0 failures:
  - `createdRecordIsReachable` 3;
  - `collectionStoreTimestampContract` 8;
  - `legacyCreateSaveErrors` 3;
  - `ciSuiteCoverage` 6;
  - `completionFlow` 24.
- vitest, on the 9 touched suites: 187/187.
- vitest, full run: 283 files passed (9 skipped), 4065 tests passed, plus `VISUAL=1` on the new `__visual__/renderDispatcherBoard` harness (2/2; its inert `useFirestoreCollection` mock from #2108 is removed). oxlint: 0 errors. `tsc --noEmit`: OK.
- `npm run build`: OK.

## Lane D review fixes (head `ce8a066e`)
- **B-1, `accountWriteContract`.** The self-check proved its write regex by finding a live Firestore writer, and this PR deleted the client's last one. The fix:
  - The regex is hoisted to one constant shared with the sweep.
  - It is proven against fixtures: it matches `addDoc`/`setDoc`/`updateDoc` calls and rejects non-writes.
  - The test now asserts **zero** live client writers by name.
  - The sweep itself is unchanged.
- **B-2, `cssClassCoverage`.** `fo-technician-save-error` is removed from `KNOWN_UNSTYLED`; it lived only in the deleted modal.
- **Workflow path filters.** Four filters naming deleted files are pruned (`deployment-drift-core-tests.yml`, `metadata-contracts-tests.yml`).
- **`firestore.rules`** is untouched.
- **Verification** (WSL LF clone of `ce8a066e`):
  - `npm test` (the full client manifest): **314 suites passed**;
  - every drift-core step, including `cssClassCoverage` and `listIndexCoverage --check`;
  - guards 141/141;
  - vitest 4065 passed;
  - oxlint 0 errors; tsc and build OK.

## Refresh onto main `3f5ed759` (head `8cada898`)
- A merge commit, not a rebase.
- **Conflicts:**
  - `ACTIVE_WORKSTREAMS.md`: a union of the rows.
  - `dispatchNoDemoContamination.test.jsx`: kept **#2113's version**, minus the three dead `useFirestoreCollection` lines (the mock, the import and `mockReturnValue`). That hook is deleted by this PR.
- **#2113's Jobs page (`Dispatch.jsx`) is untouched.**
- **Guard counts re-derived:** main touched no ratchet file and added no Firebase import, so the total stays **261**.
  - Exit guard against main's baseline: OK.
  - Shim ratchet against main's census: OK.
- **Verification** (WSL LF clone of `8cada898`):
  - guards 141/141;
  - `npm test` manifest: **316 suites passed**;
  - all drift-core steps;
  - vitest: **4078 passed**;
  - oxlint 0 errors; tsc and build OK.

No Functions, Rules, index, deploy, credential, production or authentication change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
