def append(path, text):
    s = open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    s = s.rstrip("\r\n") + nl + nl + text.strip("\n").replace("\n", nl) + nl
    open(path, "w", encoding="utf-8", newline="").write(s)

append("docs/DECISIONS.md", """
## #241 — Manufacturers on EOS Core: the Catalog API serves the list and the writes; the screen's door is `inventory.catalog` (Firebase exit F5 + Manufacturers R-1 Option A, 2026-10-17)

**Status: OWNER APPROVED (Manufacturers R-1 Option A); F5 directed by the Controller under the Firebase-exit slice plan (DECISIONS #234 O-1).** No grant, role, identity, Rules or Firebase deploy change.

**Why.**
- **The read was Firebase-only.** The Manufacturers screen and every Part form read `getManufacturerCatalog`, a Firebase callable over Firestore `manufacturers` and Firestore role assignments.
- **The door was closed for everyone.** On the EOS navigation source the screen had no surface, so it refused every principal, Administrator included.
- **Writes were gone.** PR-B (2026-10-15) removed the flag-dead Firebase write affordances. The PostgreSQL writer existed but was unwired.

**Rule.**
- **The read is the Catalog API's.** `listManufacturers`, `getManufacturer` and `searchManufacturers` on `/operations/catalog` read `eos_ops.manufacturers` through `eosOps/manufacturerAuthority.ts`.
  - They require `inventory.catalog.read` (what the retired callable checked) **and** `inventory.manufacturer.read` (the PostgreSQL authority's own key). Migration 1761782400000 grants the second to exactly the nineteen Roles holding the first, so the pair is never wider than either path.
  - The list is bounded at 1,000 rows and says `truncated` past that. It carries each row's `updatedAt`, the writer's concurrency token.
- **The writes are the Catalog API's.** `createManufacturer`, `updateManufacturer` and `changeManufacturerStatus` dispatch to `catalogMaster/postgresManufacturerWriter.ts`: `inventory.catalog.manage` for create and rename, `inventory.catalog.activate` for status. They sit behind the same ACTIVE authority and DQ-034 mutation hold as the Part writers. There is no delete.
- **The client has no fallback.** `services/manufacturerCatalogClient.js` replaces the callable client. The screen restores New Manufacturer, Rename and Status, and shows the server's answer (the Supplier administration pattern, #196).
- **The door follows the read (R-1 Option A).** `inventory/manufacturers` maps to the existing `inventory.catalog` surface. The row changes kind and nothing is added: ungoverned 39 → 38, cutover 23 → 24, register 62. Production (legacy source) is byte-identical, and the item stays `navHidden`.

**Precondition for merge.** `eos_ops.manufacturers` held 0 rows on nonprod when last measured, and there is no operator copy for it. Merging deploys nonprod. If the table is empty, the screen and the Part forms' manufacturer names read empty there until an operator copies the Firestore manufacturers. That copy is a nonprod data write and is reserved.

**Unchanged.** The Firebase callables (`getManufacturerCatalog`, `createManufacturer`, `updateManufacturer`, `changeManufacturerStatus`) stay deployed and frozen; retiring them is an operator undeploy. `CALLABLE_SOURCES` still names `getManufacturerCatalog` for the list-view validator only.

**Proof.**
- `catalogReadAuthorizationPostgres`: create, list, rename, a stale-token refusal, status, get, search, a blank-term refusal, `inventory.catalog.read` alone refused, and tenant isolation, all through the transport.
- `catalogRuntimeCensus`: the operation lists are pinned.
- `manufacturerRuntimeAuthorityPostgres`: the writer's one importer is the Catalog transport.
- `manufacturersMetadataList`: the restored create, rename and status flow sends the right envelopes and tokens, shows a refusal without claiming success, and discloses truncation. The client maps the list and the outcomes.
- `navCutoverEnvironmentScoped`: 24 + 38 = 62, and the Manufacturers transition test.
- Exit baseline 245 → 244.
""")

append("docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md", """
## F5: Manufacturers move to the EOS Catalog API (2026-10-17, exit baseline 245 → 244)

| Removed | Replaced by |
| --- | --- |
| `services/manufacturerReadCallableClient.js` (`getManufacturerCatalog`) | `services/manufacturerCatalogClient.js` → `/operations/catalog` `listManufacturers`, which reads `eos_ops.manufacturers` and needs `inventory.catalog.read` and `inventory.manufacturer.read`. Its consumers (the Manufacturers screen, Part Detail, Parts List and the Part write modal, through `useManufacturerCatalog` / `manufacturerQueries`) keep their envelope. |

**Restored, on EOS.** The New Manufacturer, Rename and Status flow that PR-B removed now calls `createManufacturer` / `updateManufacturer` / `changeManufacturerStatus` on the Catalog API (`postgresManufacturerWriter.ts`). See DECISIONS #241.

**Merge precondition.** `eos_ops.manufacturers` must hold the Firestore manufacturers on nonprod first. It was measured empty, and there is no operator copy script yet.

**Server callables kept.** `getManufacturerCatalog` and the three write callables stay deployed and frozen until an operator undeploy (reserved).
""")
