#!/usr/bin/env node
// BIN CONVERSION RECONCILIATION -- READ-ONLY proof that converting a warehouse to bins created and
// destroyed nothing. Pure logic: src/inventoryLedger/binConversionReconciliation.ts.
//
// Usage (after `npm run build` in functions/):
//   Emulator:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/binConversionReconciliation.mjs \
//                --warehouse WH-PHX --start 2026-09-15T13:00:00Z [--end 2026-09-15T21:00:00Z]
//   Sandbox:   node scripts/binConversionReconciliation.mjs --projectId eos-platform-sandbox \
//                --warehouse WH-PHX --start ... [--end ...]
//
// SAFETY
//   - Writes NOTHING, anywhere. Conversion itself happens through the governed relocateStock command
//     (Scan -> Move stock); passing the gate is scripts/completeBinConversion.mjs, a separate step.
//   - taylor-parts (production) is refused BY NAME.
//   - Uses the operator's existing `gcloud auth` login for sandbox. It creates no credential.
//
// Exit: 0 balanced, 2 NOT balanced (a part whose change is not explained), 1 refused / error.

import { openBinConversionContext, printReport } from "./_binConversionCli.mjs";

const { db, warehouseId, start, end } = openBinConversionContext(process.argv.slice(2));
const { readBinConversionReport } = await import("../lib/inventoryLedger/binConversionReport.js");
const loaded = await readBinConversionReport(db, warehouseId, start, end);
printReport(loaded);
process.exit(loaded.report.balanced && loaded.malformedRows === 0 ? 0 : 2);
