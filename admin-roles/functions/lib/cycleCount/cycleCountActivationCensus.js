"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.censusCycleCountDocuments = censusCycleCountDocuments;
const isPlain = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function censusCycleCountDocuments(docs) {
    let legacyV1 = 0;
    const v2 = [];
    const byStatus = {};
    const bad = [];
    for (const d of docs) {
        const data = d.data;
        if (!isPlain(data)) {
            bad.push(d.id);
            continue;
        }
        if (data.schemaVersion === 1) {
            legacyV1 += 1;
            continue;
        }
        if (data.schemaVersion === 2) {
            v2.push(d.id);
            const status = typeof data.status === "string" ? data.status : "UNKNOWN_STATUS";
            byStatus[status] = (byStatus[status] ?? 0) + 1;
            continue;
        }
        bad.push(d.id);
    }
    const verdict = bad.length > 0 ? "UNCLASSIFIABLE_PRESENT" : v2.length > 0 ? "V2_SHEETS_PRESENT" : "ZERO_POPULATION";
    return Object.freeze({
        total: docs.length, legacyV1, v2Sheets: v2.length, v2ByStatus: Object.freeze({ ...byStatus }),
        v2SheetIds: Object.freeze([...v2].sort()), unclassifiable: bad.length, unclassifiableIds: Object.freeze([...bad].sort()), verdict,
    });
}
//# sourceMappingURL=cycleCountActivationCensus.js.map