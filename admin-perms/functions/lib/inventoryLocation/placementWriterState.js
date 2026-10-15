"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLACEMENT_WRITER_AUTHORITY = void 0;
exports.assertPlacementWriterAuthorityCoherent = assertPlacementWriterAuthorityCoherent;
// ACTIVATED (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): the client is cut over to EOS, the Firestore
// writer is FROZEN (its export is retired from the repository; the deployed copy stays runtime-stale until the bounded
// Firebase removal window), and the PostgreSQL writer is ACTIVE -- but FAILS CLOSED (NOT_ACTIVATED) for any tenant whose
// legacy inventory baseline is not yet CERTIFIED by the governed cutover (eosOps/inventoryBaselineGate.ts). No dual write.
exports.PLACEMENT_WRITER_AUTHORITY = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
/** Two writable authorities at once is the one forbidden state. */
function assertPlacementWriterAuthorityCoherent(state) {
    if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
        throw new Error("Bin placement cannot be writable in Firestore and PostgreSQL at the same time");
    }
}
assertPlacementWriterAuthorityCoherent(exports.PLACEMENT_WRITER_AUTHORITY);
//# sourceMappingURL=placementWriterState.js.map