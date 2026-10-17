Issued: 2026-10-16 (America/Phoenix) · base main `931c8af8` (#2109, PR-A merged) · Firebase-exit lane (O-1, DECISIONS #234)

**Do not merge without exact-head Owner authorization.** Lane D independent review is requested on the exact head.

Owner decision (2026-10-15): "PR-B APPROVED: remove orphaned and environment-disabled Firebase clients. Preserve business requirements for EOS Core replacement."

## What this does
Exit baseline **261 → 257**:
- `frontend.firebase_functions_client` 21 → 18;
- `frontend.firestore_client` 13 → 12;
- already-fenced shim consumers 22 → 19.

**No runtime change.** Every removed path was either unreachable or switched off in all five environments.

| Removed | Why nothing reachable used it |
|---|---|
| `services/completionService.js` (the `completeAssignedJob` binding) | No importer. FieldMode completes through the governed Work Order `Complete` transition (F0). |
| `services/manufacturerCommandClient.js`, `hooks/useManufacturerWrite.js`, `config/manufacturerWriteReadiness.js`, and the create / rename / status affordances in `modules/inventory/Manufacturers.jsx` | `MANUFACTURER_WRITE_READY` was `false` in all 5 environments, so the hook returned "write disabled" before any call. The flag is removed from `config/environments.json` and `vitest.config.js`. The page stays a read-only list. |
| `services/inventoryBalanceCallableClient.js` (`getPartBalance`) | `INVENTORY_BALANCE_READ_READY` was `false` in all 5 environments, so the client only ever answered `transport-not-ready`. `LookupScan`'s default now returns exactly that, so the balance row renders the same refusal as before. The flag itself stays: it is a required registry key, and `INVENTORY_BALANCE_UNAVAILABLE_REASON` still comes from that module. |
| The `getCountFromServer` fallback in `hooks/useListViewChrome.js` | It ran only for a `CLIENT_DIRECT` entity with no injected count. Of the five lists using the hook, Accounts, Customer Equipment and Work Orders read through `EOS_API`, Sales Orders reads through `CALLABLE`, and the Part Master (`CLIENT_DIRECT`) injects the Catalog `countParts`. |

Also in this PR:
- Five stale comments that named the now-deleted `useFirestoreCollection` are reworded (the coordinator's post-#2109 docs debt).
- Workflow path filters naming the deleted files are pruned.

## Business requirements preserved
Recorded in `docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md` (PR-B section):

| Requirement | EOS Core owner | State |
|---|---|---|
| Manufacturer create / rename / activate / deactivate, with optimistic concurrency and a separate activate authority | `catalogMaster/postgresManufacturerWriter.ts` (`inventory.catalog.manage` / `.activate`) and `eosOps/manufacturerAuthority.ts` reads | **Built and tested, not routed.** Next: Catalog API operations, then point the page at them. |
| A Part's balance while scanning | An EOS inventory balance read injected as `LookupScan` `deps.fetchBalance` | **No EOS read yet.** The screen states the balance is unavailable, as it always has. |
| Job completion, idempotent and safe on an ambiguous result | The `/operations/work-orders` `Complete` transition | Live |
| An exact list header count | The object's own count authority (`options.count`) | Live for the Part Master |

`domain/manufacturerWrite.js` and `domain/completionFlow.js` are kept on purpose. They are pure (no Firebase) and tested, and they serve as the specification for the EOS cutover.

The server callables (`completeAssignedJob`, `createManufacturer` / `updateManufacturer` / `changeManufacturerStatus`, `getPartBalance`) are not touched here. Each needs a GATED equivalence record and an operator undeploy.

## Tests changed
- `manufacturersMetadataList`: the row-action tests are replaced by a read-only assertion.
- `listsP2Tranche1`: asserts no `rowActions`.
- `catalogClientCutover`: the list chrome is no longer a sanctioned Firebase stop. The test now asserts the chrome consults only the injected count and imports no Firestore.
- `completionFlow`: asserts the orphan stays deleted.
- `partMasterStructuredListScreen`: comment only.

## Verification (local, on the exact pushed tree: WSL Ubuntu-24.04 LF clone, Node 22.23.2)
- Firebase-exit guards (exit / shim / equivalence): **141/141**.
- Exit guard against main's baseline: OK. Shim ratchet against main's census: OK.
- `npm test` (the full client manifest): **316 suites passed**.
- Every `deployment-drift-core` step, including `cssClassCoverage` and `listIndexCoverage --check`.
- vitest: **4077 passed**.
- oxlint: 0 errors. tsc and build: OK.

No Functions, Rules, index, deploy, credential, production or authentication change. Frontend and tests only, so Render does not redeploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
