# W1-C23 — Scanner / warehouse-operations surface: registrations

Branch `impl/w1-scanner-warehouse`, from `33945090d66d2287fe0cdc362c80ad6e4e311067`.

## Registrations made

**NONE.** This lane added no capability, no collection, no callable, no migration and no
Admin→Objects profile. Every shared registry file (`permissionCatalog.ts`, `capability-graph.json`,
`entityRegistry.js`, `objectPermissionMap.js`, `firestore.rules`, `test/suites.json`,
`.github/workflows/**`, `constants/collections.ts`) is untouched.

The change is one behavioural correction inside an already-registered pure module plus two
assertions in already-registered test suites, so there is nothing new to register:

| Artifact | Already registered where |
| --- | --- |
| `field-ops-app-vite/src/domain/scannedIdentity.js` | `.github/workflows/scan-workspace-tests.yml:142` (path trigger) |
| `field-ops-app-vite/test/scannedIdentity.test.mjs` | `field-ops-app-vite/test/suites.json` (runner `node`) |
| `field-ops-app-vite/test/partLookup.test.mjs` | `suites.json` + `scan-workspace-tests.yml:424` (run step) |

The new enforcement assertion therefore runs in CI on any change to `scannedIdentity.js`, with no
edit to a shared file.

## Admin→Objects (C2 framework, PR #1866)

No object profile is contributed. C2's framework is not on main and a profile would be dormant
until #1866 merges; more importantly, this lane's surface is the **operator-facing resolution
layer**, not an object. The objects a scan resolves to — Part (C2), Warehouse/BIN (C3),
Serialized Asset (C20), Truck/MOBILE (C4) — are each owned by another lane and each registers its
own profile there. Registering one here would fork C2's framework for a non-object.

**Registry line, if a future lane does wire the scanner as an Admin→Objects read surface:** it must
reuse C2's Part profile and C3's Bin profile rather than declaring its own — the scanner holds no
identity authority of its own and has nothing to register that is not already one of theirs.

## Capability state observed (unchanged by this lane)

All scanner-reachable capabilities are registered `active: false` and granted to no Role:

| Capability | `permissionCatalog.ts` |
| --- | --- |
| `inventory.catalog.read` | 1086 / active 1090 |
| `inventory.catalog.alias.read` | 1249 / active 1254 |
| `inventory.placement.record` | 1128 / active 1133 |
| `inventory.stock.relocate` | 1157 / active 1162 |
| `inventory.location.bin.manage` | 1182 / active 1187 |
| `inventory.location.bin.read` | 1190 / active 1195 |
| `inventory.location.display.read` | 1493 / active 1498 |

`bins`, `bin_code_claims` and `bin_placements` have **no `match` block in `firestore.rules`** —
deny-all by absence, stated at `firestore.rules:1189-1191`. Scanner authorization is governed
command capability only; no Rules predicate carries it.

## Migration

None. Migration id `1759881600000` was reserved for this lane and is **unused** — the defect fixed
here is in pure client matching logic and no stored data changes shape or meaning.
