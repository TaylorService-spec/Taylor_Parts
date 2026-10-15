"use strict";
// Reads one Warehouse's conversion evidence and reconciles it. Shared by the read-only reconciliation
// script and the completion step, so the gate is passed on EXACTLY the report an operator reviewed.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBinConversionReport = readBinConversionReport;
const node_crypto_1 = require("node:crypto");
const binCommands_js_1 = require("../inventoryLocation/binCommands.js");
const binParentage_js_1 = require("../inventoryLocation/binParentage.js");
const collections_js_1 = require("../constants/collections.js");
const operationalMovementRepository_js_1 = require("./operationalMovementRepository.js");
const binConversionReconciliation_js_1 = require("./binConversionReconciliation.js");
async function readBinConversionReport(db, warehouseId, start, end) {
    // Every bin of this warehouse, from its governed documents -- the ONLY source of parentage.
    const binSnap = await db.collection(binCommands_js_1.BINS_COLLECTION).where("warehouseId", "==", warehouseId).get();
    const parentage = (0, binParentage_js_1.parentageFromBinSnapshots)(binSnap.docs);
    const locationIds = [warehouseId, ...parentage.keys()];
    const rows = [];
    let malformedRows = 0;
    for (let i = 0; i < locationIds.length; i += 30) { // `in` takes 30 values per query
        const snap = await db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("location.locationId", "in", locationIds.slice(i, i + 30)).get();
        for (const doc of snap.docs) {
            const data = doc.data();
            if ((0, operationalMovementRepository_js_1.classifyLedgerDoc)(data) !== "operational")
                continue;
            try {
                const d = (0, operationalMovementRepository_js_1.deserializeOperationalMovement)(data);
                rows.push({ value: d.value, recordedAt: d.recordedAt });
            }
            catch {
                malformedRows += 1; // reported, never trusted
            }
        }
    }
    const report = (0, binConversionReconciliation_js_1.reconcileBinConversion)(rows, warehouseId, parentage, start, end);
    const reportSha256 = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(report)).digest("hex");
    return { report, binCount: parentage.size, rowsRead: rows.length, malformedRows, reportSha256 };
}
//# sourceMappingURL=binConversionReport.js.map