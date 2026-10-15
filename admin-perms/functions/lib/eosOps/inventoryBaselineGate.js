"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE = exports.INVENTORY_BASELINE_STAGES = void 0;
exports.isInventoryBaselineCertified = isInventoryBaselineCertified;
exports.INVENTORY_BASELINE_STAGES = Object.freeze(["LEDGER", "CUSTODY"]);
/** True when every baseline stage is certified for the tenant. */
async function isInventoryBaselineCertified(db, tenantId) {
    const { rows } = await db.query(`SELECT count(DISTINCT stage)::int AS n FROM eos_ops.inventory_baseline_cutovers WHERE tenant_id = $1 AND stage = ANY($2)`, [tenantId, exports.INVENTORY_BASELINE_STAGES]);
    return (rows[0]?.n ?? 0) === exports.INVENTORY_BASELINE_STAGES.length;
}
/** The refusal every gated writer answers while the baseline is uncertified. */
exports.INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE = "the inventory baseline has not been certified for this tenant; EOS inventory writes open only after the governed baseline COPY is verified";
//# sourceMappingURL=inventoryBaselineGate.js.map