Issued: 2026-10-17 (America/Phoenix) · head `a3fc8fd1` (main `18a7aee1` merged in) · Firebase-exit lane, slice **F5** + Owner-approved **Manufacturers R-1 Option A** · DECISIONS #241

**Do not merge without the controller's exact-head decision.** Lane D reviews after the lane is idle.

## Nonprod data: empty on EOS matches the source (controller ruling, 2026-10-17)
`eos_ops.manufacturers` is empty on nonprod; the #2114 post-deploy evidence showed the EOS read returning 0 records. **That matches the legacy source, so merging blanks nothing:**
- `eosOps/migration/manufacturerMigration.ts` records that the sandbox Firestore `manufacturers` collection held **0 documents** when measured.
- That collection **cannot have grown since**:
  - Firestore Rules deny every client write to `manufacturers`;
  - the only write client was removed in PR-B (#2114), and `MANUFACTURER_WRITE_READY` was false in every environment before that;
  - the server write callables are frozen (`catalogWriterState`).
- No nonprod copy is needed. The **production** copy, from Firestore `manufacturers` into `eos_ops.manufacturers`, is a **separate, Owner-gated step**. Its operator tool is held locally and not in this PR. It needs the Owner to rule on extending the 2026-09-14 migration-exporter exception to `manufacturers`.

## Open Owner decision (B-2, measured): catalog.read without manufacturer.read
The live nonprod captures show **nationalAccountsSales** and **retailSales** (`commercialSharedContext`) and **serviceTechnician** (`technician`, `equipmentInstaller`, `inventoryLookupReader`) hold `inventory.catalog.read` **without** `inventory.manufacturer.read`. Migration 1761782400000 granted the second key only to the Roles that held the first at that time.

For these personas the `inventory.catalog` door opens, the list is refused, and Part screens show ids without manufacturer names. The options are:
- (i) grant `inventory.manufacturer.read` to those Roles;
- (ii) accept door-then-denied;
- (iii) make the door require both keys.

**None is implemented**; both keys stay required. The decision is recorded in DECISIONS #241.

## Review round 1 (Lane D, NOT APPROVE at `6cf1d318`), addressed at `a3fc8fd1`
- **B-1 (red CI):**
  - `precedence-sweep.json` regenerated;
  - `experienceAuthority` manifest: parts-associate and parts-manager gain `inventory/manufacturers`;
  - `salesAgreementsAndNavCutover` register pin 23/39 → 24/38 (plus `CUTOVER_ROWS`);
  - `listsP2Tranche1` pins the F5 contract.
- **B-2:** #241, `catalogHttp.ts` and `navConfig.js` now state the measured state and the open decision. The user guide says the list needs manufacturer read access.
- **N-1:** the line-ending churn is gone: the nav test is +32/−11 and the vitest file is real lines only.
- **N-2:** the client really never throws (a failed load or a throwing client is `UNREACHABLE`), with a test.
- **Checks (bounded, WSL):**
  - functions build;
  - governance generators: only `precedence-sweep.json` changed;
  - `experienceAuthority` + `catalogRuntimeCensus` + `catalogMaster` 77/77;
  - vitest Manufacturers + `listsP2Tranche1` 38/38;
  - node nav, sales-agreement cutover, Manufacturers nav and queries 42/42;
  - lint 0 errors.

## Server (`/operations/catalog`)
| Operation | Backed by | Requires |
|---|---|---|
| `listManufacturers` | `manufacturerAuthority.listManufacturersPage`. Bounded at 1,000 rows; returns `truncated` and each row's `updatedAt` token. | `inventory.catalog.read` **and** `inventory.manufacturer.read`. Never wider than either path. **Measured:** they are not held by the same Roles; see the open Owner decision below. |
| `getManufacturer`, `searchManufacturers` | `manufacturerAuthority` | same |
| `createManufacturer`, `updateManufacturer` | `postgresManufacturerWriter` | `inventory.catalog.manage` |
| `changeManufacturerStatus` | `postgresManufacturerWriter` | `inventory.catalog.activate` |

- The writes sit behind the same ACTIVE authority and DQ-034 hold as the Part writers. The hold-table test covers them automatically.
- There is no delete. Concurrency uses the writer's `updatedAt` token.

## Client
- `services/manufacturerCatalogClient.js` replaces `manufacturerReadCallableClient.js`. It has no fallback, and it imports the Catalog client lazily so `manufacturerQueries` keeps no Firebase import-time side effect.
- The **Manufacturers screen restores New Manufacturer, Rename and Status**, removed by PR-B.
  - It sends the row's `updatedAt` as `expectedUpdatedAt`.
  - It shows the server's refusal and never claims success. This is the Supplier administration pattern (#196).
  - A truncated list prints no count and says so.
- The Part forms (Part Detail, Parts List, the write modal) keep their `useManufacturerCatalog` envelope.

## R-1 Option A
- `"inventory/manufacturers": ["inventory.catalog"]` is added and its `NAV_SURFACE_GAPS` entry removed.
- The row changes kind and nothing is added: ungoverned **39 → 38**, cutover **23 → 24**, register 62.
- Production (legacy source) is byte-identical, and the item stays `navHidden`.

## Ratchets and docs
- Exit baseline **245 → 244** (`frontend.firebase_functions_client` 17 → 16). The shim census is unchanged (18).
- DECISIONS #241, the ledger's F5 section, and the user guide `inventory/view-manufacturers.md` (now covers managing manufacturers).
- The Firebase callables stay deployed and frozen; undeploying them is reserved.

## Verification (local; WSL LF clone; bounded workers; DB stopped after)
- functions: build OK.
  - `catalogRuntimeCensus`, `catalogLane1Runtime` and `catalogMutationHold` pass 32/32.
  - Postgres suites (`catalogReadAuthorizationPostgres` with a new F5 subtest, `manufacturerAuthorityPostgres`, `manufacturerRuntimeAuthorityPostgres`): all pass except **one pre-existing failure**. `manufacturerRuntimeAuthorityPostgres` "this change adds no migration" is a stale newest-migration pin that fails on main too. It is not in any workflow and is already queued for the test-only re-baseline PR.
  - The new F5 subtest covers: create, list, rename, a stale-token 409, status, get, search, a blank-term 400, `inventory.catalog.read` alone refused (403), and tenant isolation.
- Firebase-exit guards: 99/99.
- client:
  - vitest: Manufacturers, catalog hold, and the Part surfaces that read manufacturers, 13/13 in the Manufacturers suite.
  - node: nav cutover (including the new TRANSITION test), Manufacturers nav, manufacturer queries/view, catalog client cutover, CI suite coverage and financials nav, all passing.
  - oxlint: 0 errors. tsc and build: OK.
- **Not done:** a browser check against a live EOS API. That needs the stack running plus seeded manufacturers, which conflicts with the resource directive; it is left to the post-merge nonprod verification.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
