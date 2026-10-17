Issued: 2026-10-17 (America/Phoenix) · base main `3f52f52f` (#2129 F2 merged) · Firebase-exit lane, slice **F3** of the controller-confirmed plan

**Do not merge without the controller's / Owner's exact-head decision.** Lane D reviews after the lane is idle.

## What changes
Exit baseline **247 → 245**:
- `frontend.firestore_client` 10 → 9;
- `frontend.firebase_functions_client` 18 → 17;
- already-fenced shim consumers 19 → 18 (census regenerated).

**No screen changes.**

| Removed | Zero-consumer proof |
|---|---|
| `metadata/firestoreListSource.js`, the Firestore page reader for `readVia: "CLIENT_DIRECT"` | **Its only importers** were `hooks/useMetadataList.js` and `metadata/MetadataRecordPage.jsx`, and both reach it only for a `CLIENT_DIRECT` entity. **Mounted lists:** `useMetadataList(` is mounted for account, equipment, salesOrder, supplier, warehouse and workOrder only, and those are `EOS_API` / `CALLABLE`. **RELATED_LIST sections** (`accountPage.js` `listId`s): Opportunities and Sales Orders (`CALLABLE`), Contacts and Locations (`EOS_API`). **Other record pages:** Equipment and Sales Agreement declare none. **Result:** `CLIENT_DIRECT` now resolves to **no source** and fails closed with the existing "could not be loaded" state, the same as an unknown `readVia`. |
| The `httpsCallable` fallback in `metadata/callableListSource.js` | **Reachable names:** every `readCallable` a mounted list or RELATED section resolves is one of the four EOS Commercial lists (`listOpportunityContext`, `listOpportunitiesForAccount`, `listSalesOrderIndex`, `listSalesOrdersForAccount`). **Other registered names:** `getManufacturerCatalog`, `listAccountInvoiceAr`, `equipmentCompatibilityReadCallable` and `getSalesAgreementForOpportunity` stay in `CALLABLE_SOURCES` only for the list-view validator; their surfaces read through their own clients. **Result:** reaching one now throws `unavailable` rather than calling Firebase. |

The guard ratchet confirms both: the exit guard against main's baseline shows no new dependencies, and the shim ratchet holds.

## Planned for F3 but NOT removed: the receiving callable client
`services/receivingCallableClient.js` is flag-dead (`RECEIVING_TRANSPORT_READY` is false in all 5 environments). It stays, for three reasons:
- **The ruling.** Controller ruling DQ-034 (2026-10-01) says the canonical supplier-PO receiving domain "is kept, not deleted".
- **Live consumers.** MyDashboard, Receiving, MultiScanReceiving and the warehouse offline bindings render its UNAVAILABLE outcome.
- **No EOS replacement.** EOS has no canonical supplier-PO receive; Reorder-PO receiving is already EOS.

Recorded in the ledger as a ruling to request: retire canonical supplier-PO receiving, or build its EOS receive.

## Tests
- `metadataRecordPage` / `metadataUseMetadataListReadVia`: the RELATED_LIST and INDEX fixtures that fetched now use a registered CALLABLE source. The "CLIENT_DIRECT → Firestore" cases now assert that **CLIENT_DIRECT fails closed and touches no source**.
- `metadataFirestoreListSource.test.jsx` is deleted with its module, and removed from `metadata-contracts-tests.yml`.
- Three inert `vi.mock`s of the deleted module are dropped (`accountPageComponents`, `catalogMutationHold`, `partMasterStructuredListScreen`).

## Verification (local; WSL Ubuntu-24.04 LF clone; bounded workers)
- vitest, the 6 affected suites: **144 / 144**.
- `catalogClientCutover`, `ciSuiteCoverage`: 16 / 16.
- `npm test` (full client manifest): **319 suites passed**.
- Firebase-exit guards: **141 / 141**.
- oxlint: 0 errors. tsc and build: OK.

No server, migration, Rules, deploy or credential change. Frontend only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
