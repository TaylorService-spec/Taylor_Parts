"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockLocationLockKey = void 0;
exports.lockStockLocation = lockStockLocation;
const stockLocationLockKey = (tenantId, partId, locationType, locationId) => `eos-relocation:${tenantId}:${partId}:${locationType}:${locationId}`;
exports.stockLocationLockKey = stockLocationLockKey;
/** Held until the caller's transaction ends. Call it BEFORE reading the balance the movement is decided from. */
async function lockStockLocation(db, tenantId, partId, locationType, locationId) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [(0, exports.stockLocationLockKey)(tenantId, partId, locationType, locationId)]);
}
//# sourceMappingURL=stockLocationLock.js.map