from ed import edit
edit("docs/DECISIONS.md", [
("""(the PostgreSQL authority's own key). Migration 1761782400000 grants the second to exactly the nineteen Roles holding the first, so the pair is never wider than either path.""",
"""(the PostgreSQL authority's own key). Requiring both is never wider than either path.
  - **Measured, the two keys are not held by the same Roles.** Migration 1761782400000 granted `inventory.manufacturer.read` to the nineteen Roles that held `inventory.catalog.read` at that time. Roles that gained `inventory.catalog.read` later did not get it. The live nonprod captures (2026-10-17) show three personas holding `inventory.catalog.read` **without** `inventory.manufacturer.read`:
    - nationalAccountsSales (`commercialSharedContext`);
    - retailSales (`commercialSharedContext`);
    - serviceTechnician (`technician`, `equipmentInstaller`, `inventoryLookupReader`).
  - For them the door opens (`inventory.catalog`) but the list is refused, and Part screens show manufacturer ids without names."""),
("""**Precondition for merge.** `eos_ops.manufacturers` held 0 rows on nonprod when last measured, and there is no operator copy for it. Merging deploys nonprod. If the table is empty, the screen and the Part forms' manufacturer names read empty there until an operator copies the Firestore manufacturers. That copy is a nonprod data write and is reserved.""",
"""**Open Owner decision: the three personas above.** This PR implements **none** of the options, and requiring both keys stays.
- (i) Grant `inventory.manufacturer.read` to `commercialSharedContext`, `technician`, `equipmentInstaller` and `inventoryLookupReader`. This is a governed grant.
- (ii) Accept that those Roles see the door and are refused the list.
- (iii) Make the door require both keys.

**Nonprod data (controller ruling, 2026-10-17).** `eos_ops.manufacturers` is empty on nonprod, and so is the source:
- `eosOps/migration/manufacturerMigration.ts` measured the sandbox Firestore `manufacturers` collection at 0 documents.
- It cannot have grown since: Rules deny client writes, the only write client was removed in PR-B (#2114), and the write callables are frozen.

So merging empties nothing. The **production** copy (Firestore `manufacturers` → `eos_ops.manufacturers`) is a separate Owner-gated step. Its operator tool is held until the Owner rules on extending the 2026-09-14 migration-exporter exception to `manufacturers`."""),
])
edit("docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md", [
("""**Merge precondition.** `eos_ops.manufacturers` must hold the Firestore manufacturers on nonprod first. It was measured empty, and there is no operator copy script yet.""",
"""**Nonprod data.** `eos_ops.manufacturers` is empty on nonprod, and so is its source: the sandbox Firestore `manufacturers` collection was measured at 0 documents and cannot have grown since. Rules deny writes, the write client was removed in PR-B, and the callables are frozen. No nonprod copy is needed. The production copy is a separate Owner-gated step (DECISIONS #241)."""),
])
edit("functions/src/catalogMaster/catalogHttp.ts", [
("""  // is the PostgreSQL authority's own (manufacturerAuthority.ts). Migration 1761782400000 grants the second to exactly
  // the nineteen Roles holding the first, so requiring both is never wider than either path.""",
"""  // is the PostgreSQL authority's own (manufacturerAuthority.ts). Requiring both is never wider than either path. MEASURED, the
  // two are NOT held by the same Roles: migration 1761782400000 granted the second to the nineteen Roles that held the first
  // THEN, and Roles that gained catalog.read later (commercialSharedContext, technician, equipmentInstaller,
  // inventoryLookupReader) did not get it -- those principals are refused here. The Owner decision is open (DECISIONS #241)."""),
])
edit("field-ops-app-vite/src/navigation/navConfig.js", [
("""      // read requires (with inventory.manufacturer.read, held by the same nineteen Roles). Before this the row had""",
"""      // read requires, together with inventory.manufacturer.read (not held by every catalog.read Role -- DECISIONS #241,
      // an open Owner decision: those principals reach the door and are refused the list). Before this the row had"""),
])
edit("field-ops-app-vite/src/services/manufacturerCatalogClient.js", [
("""const defaultClient = async () => (await import("./catalogApiClient.js")).catalogApiClient;""",
"""const defaultClient = async () => (await import("./catalogApiClient.js")).catalogApiClient;

// "Never throws" made true: a module that fails to load (a stale bundle after a deploy) is a failed call, not an exception.
const UNLOADABLE = Object.freeze({ ok: false, code: "UNREACHABLE", message: "the Catalog client could not be loaded" });
async function callCatalog(deps, operation, input) {
  try {
    const client = deps.client ?? (await defaultClient());
    return await (input === undefined ? client.call(operation) : client.call(operation, input));
  } catch {
    return UNLOADABLE;
  }
}"""),
("""  const res = await (deps.client ?? (await defaultClient())).call("listManufacturers");""",
"""  const res = await callCatalog(deps, "listManufacturers");"""),
("""  manufacturerWriteOutcome(await (deps.client ?? (await defaultClient())).call(operation, input));""",
"""  manufacturerWriteOutcome(await callCatalog(deps, operation, input));"""),
])
