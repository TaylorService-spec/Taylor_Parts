# Read-only Persona UAT: Firebase Equivalence Backlog (nonprod, 2026-10-12)

This UAT ran under the Owner authorization of 2026-10-11, Phase 4 ("read-only nonproduction persona UAT").

| | |
|---|---|
| Target | `https://eos-api-nonprod.onrender.com` at main `b0d6c21b` (Render deploy `dep-db66vdn40ujc73d46h40`) |
| Personas | All 16 canonical personas |
| Session mechanism | The approved EOS persona session mechanism (`scripts/eosPersonaSession.mjs`) |
| Raw evidence | [`persona-uat-2026-10-12.json`](persona-uat-2026-10-12.json) (principal ids removed) |

## What was and was not exercised

The harness could send only a closed list of operations. Anything else was refused before a request was
made.

| Operation | Executed? | Mutation risk |
|---|---|---|
| Reads | Executed | None |
| **Refusal probes** (`createPart {part:{}}`, `changePartStatus` / `setSupplierStatus` on a nonexistent id) | Executed | None: their input cannot change a record whoever sends it. They prove authority (refused for non-holders, reaching validation or not-found for holders) without mutation. |
| Writes: Part, identifier, supplier, supplier-terms, labor, put-away | **NOT EXECUTED** | Each needs separate mutation authorization |

**Expected outcomes** come from each persona's own resolved EOS capabilities (`resolveMyCapabilities`). A
capability holder must be answered; a non-holder must be refused. Work Order reads are entitled
per-record decisions:
- The technician must be allowed on their own assigned job and refused on another technician's.
- Fixtures were selected by reading the assignee, not inferred from a list.
- Unconditional `workOrder.record.read` holders are recorded but not judged.

**This UAT proves authority and enforcement on the deployed API. It does not prove that a screen is
reachable**, which needs a screen-level test against the real result shape. Gate B is therefore not
upgraded by this run alone.

## Result: 272 PASS, 0 FAIL, 6 NOT EXECUTED

| Capability | Probe | Result | Personas answered (rest refused) |
|---|---|---|---|
| Part Master | `searchParts`, `readPart` | PASS 16/16 each | 13: all except office manager, reporting analyst, general employee |
| Part Master | `createPart` refusal probe | PASS 16/16 | holders reach validation: admin, owner, GM, service mgr, parts mgr, warehouse mgr |
| Part Master | `changePartStatus` refusal probe | PASS 16/16 | only admin (sole `inventory.catalog.activate` holder; CAT-3) |
| Part identifiers | `listPartAliases`, `probePartAlias` | PASS 16/16 each | admin, owner, GM, service mgr, parts mgr, warehouse mgr |
| Part identifiers (scanner) | `lookupScannedPart` | PASS 16/16 | 13 catalog readers; `aliasDenied` matched alias.read for every persona |
| Supplier maintenance | `listSuppliers` | PASS 16/16 | admin, dispatcher, parts mgr, parts associate |
| Supplier maintenance | `listSupplierOrganizationOptions` | PASS 16/16 | admin, owner, GM, service mgr, parts mgr, warehouse mgr |
| Supplier maintenance | `setSupplierStatus` refusal probe | PASS 16/16 | only admin |
| Put-away reads | `listInventoryLocations`, `readInventoryOnHand` | PASS 16/16 each | 11: admin, owner, GM, service mgr, dispatcher, technician, parts mgr/assoc, warehouse mgr/assoc, finance |
| WO Labor | `readWorkOrderLabor` own job / other's job | PASS 16/16 each | the technician is allowed on their own job and **refused** on the contract technician's |
| WO Field Context (F5) | `readWorkOrderFieldContext` own / other | PASS 16/16 each | the same: the technician is narrowed to their own assignment |

## Findings

1. **Put Away and Pick are offered to no EOS persona.**
   - The Scan workspace offers them only to holders of BOTH `inventory.placement.record` AND
     `inventory.location.bin.read` (`field-ops-app-vite/src/access/scanWorkflows.js`, `deriveScanWorkflows`).
   - `inventory.location.bin.read` is **not an EOS (PostgreSQL) capability**. It is declared by legacy roles
     but never registered (`functions/scripts/fixtures/sampleCompany.v2.json` records this).
   - The Warehouse Associate resolves `inventory.placement.record` without it.
   - The screen gate reads the shell's capability source, which still includes Firebase-era
     environment overrides (`functions/src/access/environmentCapabilityOverrides.ts`). Put-away UI
     reachability therefore depends on a legacy access path.
   - This is a **Gate B gap for `recordPutAway`**. Fixing it needs an authority decision (register the key or
     change the screen's rule), not a code-only change.
2. **Labor and field-context reads enforce own-assignment for the technician on the deployed API.** This is
   Gate C evidence for F5, but F5 still lacks a screen-level test against the real result shape, so
   **F5 stays not retirable.**
3. Part-supplier terms (#2064) were not exercised: the PR is held and not deployed.

## Not executed (needs separate mutation authorization)

- Part Master create, update and status success paths.
- Identifier create, deactivate and reactivate.
- Supplier create, update and status.
- Part-supplier terms.
- Labor record and correction.
- Put-away and relocation.
