Issued: 2026-10-17 (America/Phoenix) · head `636d577f` on main `a947a3bb` · Firebase-exit lane, slice **F7a** · **Owner ruling F7a (2026-10-17)** · DECISIONS #242

**Do not merge without the controller's exact-head decision.** Lane D reviews after the lane is idle. It touches authorization (a new capability, a grant to one memberless Role), so the review is authorization-touching.

## ⚠ Existing data is NOT moved, so this is not a completed data transition
`eos_ops.inventory_returns` starts **empty**, and existing Firestore `inventory_returns` records are **not copied** by this PR. Two tools are prepared; per the ruling, neither blocks the merge:
- `scripts/exportReturnIntakeSnapshot.js`: a read-only Firestore export, a migration-only exception authorized by the ruling.
- `scripts/returnIntakeCopy.js`:
  - **census** is the default and read-only. It reports counts by source, condition and company, the company/warehouse **mapping gaps**, and the copy checksum.
  - **copy** is insert-only and **refuses without `--ownerAuthorization`**. Every record's company is named by a person in `--mapping` and never guessed. Rows are MIGRATED with no Firebase uid in any column. It loads no Firebase module, so it cannot delete Firestore records.
  - **verify** is read-only. Every snapshot record must be present with equal fields, with no extra MIGRATED rows and agreeing counts.

The copy runs only with the Owner's explicit go-ahead.

## What the ruling asked, and where it is
| Ruling | Implementation |
|---|---|
| 1. Model: `eos_ops.inventory_returns`; exact vocabularies and behaviour; no ledger entry (#118); audit, validation, idempotency | Migration `1764580000000`. One state, AWAITING_DISPOSITION, enforced by a CHECK. The same source and condition sets: unknown is refused, never coerced. Quantity XOR serials. Id `ret_<key>`. A replay answers from the stored row; a different return under a used key is `IDEMPOTENCY_CONFLICT`. One `eos_policy.audit_events` row per recorded return; a replay writes nothing; **no ledger movement**. `eosOps/returnIntake.ts`. |
| 2. Company required, warehouse optional; server-side #237 check; warehouse must be that company's and accessible | `resolveCompanyAuthority`. No authority gives `COMPANY_AUTHORITY_REQUIRED`. Out-of-company ≡ unknown (`OPERATING_COMPANY_NOT_GOVERNED`). A warehouse of another company, or out of the caller's reach, ≡ unknown (`WAREHOUSE_NOT_FOUND`). Every refusal precedes any write. |
| 3. A clerk Role with no members; it must not become the exclusive path that removes Admin's ability; register the key | `inventory.returns.intake` (object `inventoryReturn`, BUSINESS_ACTION) is granted only to `inventoryReturnsIntakeClerk`, which has **no members**. **No one is assigned.** Rudy Admin's nonprod ability is restored after deploy by the controller through governed `previewAuthorityChange → assignRole`, audited. No production access change. Grant-bearing (Owner ruling E): the authority baseline goes **481 → 482** in this change. |
| 4. Census and copy scripts, Owner-gated, never deleting source | As above. |

## Transport and client
- **`/operations/inventory`:** `recordReturnIntake` and `listReturnIntakeOptions` (the caller's companies, and the in-reach warehouses of each). They are deliberately **not** behind the Reorder activation boundary.
- **`services/returnCommandClient.js`:** EOS only, with no Firebase fallback.
- **Scan › Take a return in:** a **company** picker, auto-chosen when there is one company and never guessed when there are several, plus an optional **receiving warehouse** filtered to that company. Refusals are said in words.
  - **Offline intake keeps working** from the last options the server gave the device. The server re-checks on replay, and a refusal is never answered from the cache.
- **Scan's unavailable reason** is now "You are not authorized to take returns in. An administrator can grant it." This supersedes #231's "not yet in EOS", because the capability is now registered and grantable.

## Ratchets and docs
- Exit baseline **245 → 244** (functions client 17 → 16); shim fenced consumers 18 → 17.
- Migration pins 99 → 100 in: `migrationLedgerOrderGuard`, `administrationReadEnforcement`, `personaBusinessAccessRegression`, `governedNonprodReplayPostgres`, `sampleCompanyPostgres`, and `authorityActivationVehiclePostgres` (peel order and counts).
- Capability vocabulary 139 → 140 (Sample Company manifest, `ownerCapabilityContract`); governed replay +1 grant per stage.
- `capability-graph.json` and `precedence-sweep.json` regenerated.
- DECISIONS #242, the ledger's F7a section, and the user guide `inventory/scan-workspace.md`.
- **Merge note:** #2132 (F5) also moves exit-guard pin 245 → 244. Whichever PR merges second needs a one-line merge lap (244 → 243, and functions client 16 → 15).

## Verification (local; WSL LF clone; bounded workers; DB stopped after)
- **`returnIntakePostgres`:** 9/9, covering:
  - validation parity;
  - refusals before any write, proved by snapshot;
  - out-of-company and out-of-reach ≡ unknown;
  - one row plus one audit row and **zero ledger movements**;
  - replay and conflict;
  - the table's CHECKs;
  - the options read;
  - the copy CLI end to end: census gaps, Owner go-ahead required, drift refused, MIGRATED rows with NULL `received_by`, a no-op rerun, verify;
  - static checks: insert-only, no Firebase, an exporter that only reads.
- **`roleCapabilityAuthorityBaselinePostgres`:** 14/14 (482, rebuilt exactly).
- `authorityActivationVehiclePostgres` 10/10, `governedNonprodReplayPostgres` 1/1, `sampleCompanyPostgres` 43/43.
- `test:adminPolicy` 1721/1721; `test:governance` 687/687 (generators clean); fence, ops shape, catalog, migration-ledger and Owner contract 316/316.
- Firebase-exit guards 99/99.
- **Client:** vitest for return intake, offline screens and put-away 40/40; node scan workflows and CI coverage 35/35; lint 0 errors; tsc and build OK.
- **Not done:** a live browser check against nonprod. Nobody holds the capability until the post-deploy assignment, so it belongs in the controller's nonprod verification.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
