# INV-CONVERGENCE-E C1 -- Rollback

**Trigger:** any post-review/post-deploy failure of the Parts Catalog (unexpected
BLOCKED for an authorized reader, a dropped/duplicated Part, a broken route/search/
detail link, a ledger-overlay mismatch, or a reorder-workflow regression).

**Rollback action (repository):** revert this PR's single functional commit. That
restores `PartsList.jsx` to sourcing the Parts Catalog directly from the static
`PARTS_CATALOG` + `getCatalogItem` (the prior behavior), removes the
`buildPartsCatalogRows` wiring and the canonical `useEffect`, and drops the new pure
module + test. `src/domain/partsCatalogView.js` is additive and inert once unreferenced.

**No data change.** C1 is a client read-path source change only: it performs no
Firestore writes, no Rules/Functions/index deployment, and no identity/data mutation.
Rollback is therefore a pure code revert with **zero data effect** and no migration.

**No deploy coupling.** C1 is a repository-only draft; nothing is deployed by merging
it. If a later C1 deploy gate ships this frontend, rollback there is a Hosting-only
redeploy of the prior bundle (no data change) -- defined at that separate gate.

**Boundary preserved on rollback:** PartDetail, routes, `useInventoryLedger`, the
reorder/PO/receiving/cancellation/voiding workflows, GlobalSearch, and the static
catalog + Functions mirror are all unchanged by C1, so reverting C1 cannot affect them.
