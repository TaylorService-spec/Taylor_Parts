# Firebase Retirement: Business Capability Matrix

This matrix covers every Firebase operation retired before the Business Capability Equivalence Gate
was introduced (audited at main `acc65f2e`, 2026-10-11).

- **Source of truth:** `docs/architecture/firebase-capability-equivalence.json`. It is
  machine-checked by `scripts/firebaseCapabilityEquivalenceGuard.mjs`. If this table and the manifest
  disagree, the manifest wins.
- **Findings:** the IDs in the Key gap column point to
  [the retrospective](../audits/firebase-retirement-equivalence-2026-10-11/README.md).

Gate status codes: **V** = verified, **P** = partial, **U** = unverified, **G** = gap, **–** = not
applicable.

| # | Retired operation | Cluster | Business capability | EOS replacement | A | B | C | D | E | Audit | Disposition (candidate) | Key gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `recordPutAway` | put-away (`5d6a84ac`) | Record a bin placement | `/operations/placement recordPutAway`; `/operations/relocation relocateStock` | V | P | V | V | V | V | **UNVERIFIED** (REPLACED) | No live proof; PA-1 persona question |
| 2 | `createSupplier` | F2 | Create supplier | `/operations/inventory createSupplier` | V | P | V | V | V | P | **UNVERIFIED** (SUPERSEDED, #196) | No live proof; form omits 4 fields; AUD-1 |
| 3 | `updateSupplier` | F2 | Maintain supplier fields | `/operations/inventory updateSupplier` (server only) | V | G | P | V | P | P | **GAP** | SUP-2: no screen; no rename |
| 4 | `activateSupplier` | F2 | Reactivate supplier | `setSupplierStatus` | V | P | V | V | V | P | **UNVERIFIED** (SUPERSEDED, #196) | Admin-only; hard-coded reason (SUP-3) |
| 5 | `deactivateSupplier` | F2 | Deactivate supplier | `setSupplierStatus` | V | P | V | V | V | P | **UNVERIFIED** (SUPERSEDED, #196) | Admin-only; hard-coded reason (SUP-3) |
| 6 | `createPartSupplierItem` | F2 | Record part-supplier terms | repository only | P | G | G | P | P | G | **GAP** | SUP-1 |
| 7 | `updatePartSupplierItem` | F2 | Change part-supplier terms | none | G | G | G | G | G | G | **GAP** | SUP-1: no PostgreSQL equivalent |
| 8 | `changePartSupplierItemStatus` | F2 | Retire part-supplier terms | repository only | P | G | G | P | G | G | **GAP** | SUP-1 |
| 9 | `setPreferredSupplier` | F2 | Choose preferred supplier | repository only | P | G | G | P | G | G | **GAP** | SUP-1 |
| 10 | `recordWorkOrderLabor` | F4 | Technician records time | `/operations/work-orders recordWorkOrderLabor` | V | P | V | P | V | G | **UNVERIFIED** (SUPERSEDED, needs Owner) | WOL-2 offline; WOL-3; AUD-2 |
| 11 | `correctWorkOrderLabor` | F4 | Manager corrects time | same op + `correctsLaborEntryId` (server only) | V | G | V | P | V | G | **GAP** | WOL-1: no UI; AUD-2 |
| 12 | `getWorkOrderLabor` | F4 | Read a job's time | `/operations/work-orders readWorkOrderLabor` | V | P | V | – | V | V | **UNVERIFIED** (SUPERSEDED, needs Owner) | WOL-4 read widened; totals-only UI |
| 13 | `createPart` | F3a | Create Part | `/operations/catalog createPart` | P | P | V | V | P | P | **GAP** | CAT-1: success shown as error |
| 14 | `updatePart` | F3a | Edit Part | `/operations/catalog updatePart` | P | P | V | V | P | P | **GAP** | CAT-1 |
| 15 | `changePartStatus` | F3a | Part lifecycle | `/operations/catalog changePartStatus` | P | G | P | V | P | P | **GAP** | CAT-1; CAT-3: no business holder |
| 16 | `createPartAlias` | F3b | Register barcode / identifier | `/operations/catalog createPartAlias` | P | P | V | V | P | P | **UNVERIFIED** (REPLACED) | Error/replay mapping; no executed E2E |
| 17 | `deactivatePartAlias` | F3b | Retire identifier | `/operations/catalog deactivatePartAlias` | G | G | V | V | P | P | **GAP** | CAT-2: unreachable |
| 18 | `reactivatePartAlias` | F3b | Restore identifier | `/operations/catalog reactivatePartAlias` | G | G | V | V | P | P | **GAP** | CAT-2: unreachable |
| 19 | `listPartAliases` | F3b | See a Part's identifiers | `/operations/catalog listPartAliases` | G | G | V | – | G | V | **GAP** | CAT-2: list always empty |
| 20 | `probePartAlias` | F3b | Test a scan | `/operations/catalog probePartAlias` | V | P | V | – | P | V | **UNVERIFIED** | ALS-2 gate narrowed |
| 21 | `lookupScannedPart` | F3b | Scanner Part lookup | `/operations/catalog lookupScannedPart` | V | P | V | V | V | V | **UNVERIFIED** (REPLACED) | Only live proof missing |
| 22 | `resolveScannedPartIdentifier` | F3b | Resolve a scan of unknown type | `lookupScannedPart` alias half | V | P | V | V | P | V | **UNVERIFIED** (SUPERSEDED, needs Owner) | ALS-1: 4 behaviour changes |

## Totals

| Outcome | Count | Operations |
|---|---|---|
| REPLACED (verified) | 0 | |
| SUPERSEDED (verified) | 0 | |
| UNVERIFIED | 10 | 1, 2, 4, 5, 10, 12, 16, 20, 21, 22 |
| GAP | 12 | 3, 6, 7, 8, 9, 11, 13, 14, 15, 17, 18, 19 |

Gate B is not VERIFIED for any operation: no live persona run is recorded in the repository for any
of them. Every PostgreSQL suite cited in the manifest was executed on 2026-10-11 and passed (10 suites,
141 tests).
