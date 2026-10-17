Issued: 2026-10-17 (America/Phoenix) · base main `50235a1e` (#2130 F3 merged) · Firebase-exit lane, slice **F1-0**

**Measurement only.** This PR changes no access decision. F1-1 (the cutover) waits for the Owner's rulings (a)–(e). Lane D reviews after the lane is idle. Updated at `3e068979` for Lane D's review (C-1, C-2, S-1..S-4). **Do not merge without the controller's exact-head decision.**

## What it adds
- **Harness:** `functions/scripts/firebaseExit/personaCapabilityParity.mjs` compares, for each persona:
  - **OLD:** the Firebase feed's `resolveEffectiveAccessCallable` decisions on the shell's own 51 ids.
  - **NEW:** EOS `resolveMyCapabilities`.
  - It also evaluates the 8 legacy role gates (G1–G8) against candidate EOS capabilities. Those candidates are proposals for ruling (b).
- **Report:** `docs/architecture/firebase-exit-persona-capability-parity-2026-10-17.md`, the 51 × 16-persona table plus the gate table.
  - Rudy Admin is the `administrator` row (the same account), so the 16 rows cover all 17 personas.
  - The inputs were read-only captures made with each persona's own session. They contain no tokens and no customer data.
- **Classes:** a cell with a same-named EOS key is EQUAL, WIDEN or NARROW. A cell without one is UNMAPPED and is never guessed. A failed capture is refused rather than read as "denies everything".
- **Test:** `functions/test/personaCapabilityParity.test.mjs` (5 tests), wired into `test:access` and the `access-catalog-unit-tests` workflow paths.
- **Lane D's two notes from #2130:**
  - a test for a registered non-Commercial `readCallable` (`getManufacturerCatalog`): it throws `unavailable` and calls nothing;
  - a corrected `Suppliers.jsx` readVia comment.

## Measured
Totals: **EQUAL 461 · WIDEN 74 · NARROW 9 · UNMAPPED_ALLOW 22 · UNMAPPED_DENY 362 · NO_CANDIDATE 32** (16 × (51 ids + 9 gates)). Gate OLD values assume a **Firebase** session; G6/G7 OLD come from the captured employee doc (operationalRoles `[]` for all 4) and `users.technicianId` (null for all 4).

| Persona | Legacy role | WIDEN | NARROW | Unmapped allow | Gate differences |
|---|---|---|---|---|---|
| administrator | admin | 7 (explained by the 2026-10-17 grant) | 0 | 20 | G3 NARROW |
| dispatcher | dispatcher | 0 | 0 | 0 | G3 NARROW, G6 WIDEN |
| financeAccounting | dispatcher (anomaly) | 1 | **2** | 2 | G1/G1-alt/G2/G3/G4 NARROW |
| generalEmployee | technician | 0 | 0 | 0 | none |
| generalManager | none | 5 | 0 | 0 | G2 WIDEN |
| nationalAccountsSales | none | 1 | 0 | 0 | none |
| officeManager | none | 1 | 0 | 0 | G2 WIDEN |
| ownerExecutive | none | 14 | 0 | 0 | G2/G6 WIDEN |
| partsAssociate | none | 3 | 0 | 0 | G2/G6 WIDEN |
| partsManager | none | 5 | 0 | 0 | G2/G6 WIDEN |
| reportingAnalyst | none | 0 | 0 | 0 | none |
| retailSales | none | 1 | 0 | 0 | none |
| serviceManager | none | 5 | 0 | 0 | G1/G1-alt/G2/G4 WIDEN |
| serviceTechnician | none | 1 | 0 | 0 | G7 WIDEN |
| warehouseAssociate | none | 9 | 0 | 0 | none |
| warehouseManager | none | 6 | 0 | 0 | G6 WIDEN |

G1-alt offers `workOrder.lifecycle.dispatch` as an alternative candidate for G1 (ruling (b)). G5 (Account governed pencils) and G8 (shadow-parity diagnostics) have no EOS candidate for any persona.

## What the Owner needs to rule on
- **The 8 NARROW cells.**
  - **financeAccounting** loses 2 ids: `fulfillment.coordinatedVisit.read` and `inventory.catalog.manage`. It also loses gates G1, G1-alt and G2–G4, because its legacy `users.role` is `dispatcher`, which is an anomaly.
  - **administrator** and **dispatcher** each lose G3 (reorder queue notifications).
- **The 22 UNMAPPED_ALLOW cells.** These are ids the Firebase feed allows that have no same-named EOS key:
  - administrator: 20 (`report.*` ×9, `finance.*`, `financialPolicy.profile.*`, `inventory.location.bin.*`, `inventory.balance.read`, `inventory.returns.intake`, `admin.dataImport.stage`, `administration.emailIntake.read`, `service.inboundWork.read`);
  - financeAccounting: 2 (`finance.read`, `inventory.balance.read`).
  - Each one is lost unless ruling (a) maps it.
- **The WIDEN rows.** 4 personas have a legacy `users` doc (administrator, dispatcher, financeAccounting, generalEmployee); the other 12 got little or nothing from the Firebase feed. EOS already enforces their governed Roles server-side; in the shell each WIDEN row **becomes a visible control or screen at F1-1**. The administrator's 7 WIDEN rows come from the 2026-10-17 business-role grant.

## Verification
- The `personaCapabilityParity` test passes 6/6 (Node 22, after `npm run build`).
- The `metadataCallableListSource` vitest suite passes.
- The report was regenerated from the captures in a WSL LF clone.

No server, migration, Rules, deploy or credential change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
