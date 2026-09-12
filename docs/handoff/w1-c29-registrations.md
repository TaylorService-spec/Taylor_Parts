# W1-C29 — Data Import identifier authority: registrations

Branch `impl/w1-dataimport-authority`. Lane C29 owns the **import boundary**
(`functions/src/dataImport/`), not the domains it writes into.

## Required registrations

**None.** This lane registers nothing new and consumes nothing new.

| Registry | Change |
| --- | --- |
| `functions/package.json` | none — no new dependency |
| `entityRegistry.js` | none — no new object type |
| `objectPermissionMap.js` / `permissionCatalog.ts` | none — no new capability; the writers call the same governed commands they already called |
| `firestore.rules` | none |
| `functions/src/constants/collections.ts` | none — no new collection |
| `field-ops-app-vite/test/suites.json` | none — the new suite is `node --test`, not vitest |
| Migrations | **none** (see below) |

## Migration

**No migration.** The reserved id `1760227200000` was **not used**. Every change is to
TypeScript at the import boundary; no table, column, constraint or seed is touched, and
`functions/migrations/` is untouched. Per the lane brief ("prefer adding no migration at
all"), the honest answer here is that this work needs no schema.

## New error codes on the wire

These are **row-result failure codes and preview finding codes**, returned by existing
surfaces. No new transport, callable, or collection carries them.

| Code | Surface | Replaces |
| --- | --- | --- |
| `WAREHOUSE_NAME_AMBIGUOUS` | inventory preview finding + opening-balance row result | a misreported `WAREHOUSE_NOT_FOUND` |
| `PART_NUMBER_AMBIGUOUS` | opening-balance row result | a silent pick (`.limit(2)` then `.docs[0]`) |
| `PART_ID_CONFLICT` | opening-balance row result | a silent preference for a stored `partId` field over the document id |
| `PART_ID_NOT_CANONICAL` | opening-balance row result | nothing — the ledger accepted any non-empty string |

Any UI that switches on inventory finding codes should render
`WAREHOUSE_NAME_AMBIGUOUS`; every one of these already falls through to the finding's own
`message`, which is written for an operator.

## New reference name

`INVENTORY_REFERENCES.WAREHOUSE_AMBIGUOUS` (`"warehouseAmbiguous"`), emitted by
`loadInventoryReferences` alongside `warehouse` from the **same single pass** over the
ACTIVE warehouse register. It is a reference name in the existing
`ImportContext.references` map — no type change, no new plumbing. A caller that builds an
inventory preview from its own fixtures may omit it; the contract treats an absent
ambiguous set as "nothing is ambiguous".

## One shared symbol added

`compactIdentityKey` in `functions/src/dataImport/contracts/entityContract.ts`, beside the
existing `naturalIdentityKey`. It is the single definition of the whitespace-**removing**
identity fold that previously existed as five byte-identical copies. Any new import
contract comparing a part number or a serial must call it rather than spell it out;
`test/dataImportIdentifierAuthority.test.mjs` fails if a sixth copy appears.

## Cross-lane notes (NOT changed here — deliberately)

The same "ambiguity reported as absence" defect exists one lane over, in resolvers that
live in this lane's files but write into other lanes' domains. They are **censused, not
changed**, because fixing them properly requires the owning lane's reference sets:

* `functions/src/dataImport/firestoreDataImportAdapters.ts:440` `resolveAccountIdByName`
  — `snap.size !== 1 ⇒ null`, reported as `CUSTOMER_NOT_FOUND` (lane C9).
* `functions/src/dataImport/firestoreDataImportAdapters.ts:452` `resolveLocationIdByName`
  — `matches.length === 1 ? id : null`, reported as `LOCATION_NOT_FOUND` (lane C9).
* `functions/src/dataImport/firestoreServiceHistoryAdapters.ts:142`
  `resolveAccountIdByName` — a third copy of the same shape (lane C9).

None of the three **picks** — all three refuse — so none writes an invented identity. What
they get wrong is the *sentence*, and they write a record rather than a ledger movement.
