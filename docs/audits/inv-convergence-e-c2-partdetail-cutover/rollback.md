# INV-CONVERGENCE-E C2 -- Rollback

**Trigger:** any post-review/post-deploy failure of the Parts **detail** page (an
unexpected BLOCKED for an authorized reader, a Part ID that stops resolving, a broken
route or Global Search -> detail link, a metadata/ledger key mismatch, a stock-position
or usage-history regression, or any reorder / PO / receive / cancel / void /
inventory-action workflow regression).

**Rollback action (repository):** revert this PR's single functional commit
(`94e322e5299e56e67fa8c8b99e46558d56a62502`). That restores `PartDetail.jsx` to
sourcing metadata from the static `getCatalogItem(partId)` and filtering the ledger on
the raw route param, removes the `buildPartDetailView` / `selectPartLedger` wiring and
the canonical `useEffect`, and drops the new pure module + test.

The same revert also restores `buildPartsCatalogRows` to its inlined guard. The C2
extraction of `composeGovernedPartsWorkspace()` is a behavior-neutral refactor of
already-merged C1 logic (C1's 23/23 pass unchanged both before and after), so reverting
C2 returns C1 to exactly its merged behavior. **C1 does not need to be reverted to roll
back C2**, and `src/domain/partDetailView.js` is additive and inert once unreferenced.

**No data change.** C2 is a client read-path source change only: it performs no
Firestore writes, no Rules/Functions/index deployment, and no identity, role, claim, or
production-data mutation. Rollback is therefore a pure code revert with **zero data
effect** and no migration. No Part was migrated, renamed, restructured, deleted, or
rewritten at any point, so there is nothing to restore.

**No deploy coupling.** C2 is a repository-only draft; nothing is deployed by merging
it. If a later C2 deploy gate ships this frontend, rollback there is a Hosting-only
redeploy of the prior pinned bundle (no data change) -- defined at that separate gate.
Per the C1 Hosting evidence, `hosting:rollback` remains prohibited; use the
pinned-version Console path or an exact Hosting clone.

**Boundary preserved on rollback:** the inventory ledger, truck inventory, usage
history, reorder, Procurement, Work Order, manufacturer, alias, and supplier
relationships, `useInventoryLedger`, Global Search, the `/inventory/:partId` route
contract, the static catalog + Functions mirror, and the entire Customer/Auth stream
are all untouched by C2, so reverting C2 cannot affect them.
