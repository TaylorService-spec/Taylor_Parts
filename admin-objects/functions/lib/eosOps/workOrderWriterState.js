"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORK_ORDER_WRITER_AUTHORITY = void 0;
exports.assertWorkOrderWriterAuthorityCoherent = assertWorkOrderWriterAuthorityCoherent;
// ACTIVATED (Controller: PR #2005 MERGE + SERVICE ACTIVATION AUTHORIZATION, 2026-09-30, step G): PostgreSQL is the
// Work Order authority and the Firestore Work Order writers are FROZEN -- no active client calls them (the cutover
// removed every browser caller; docs/architecture/work-order-firebase-retirement-ledger.md), and no Firebase deploy
// accompanies this change. There is no Firebase fallback.
exports.WORK_ORDER_WRITER_AUTHORITY = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
/** Two writable authorities at once is the one forbidden state. */
function assertWorkOrderWriterAuthorityCoherent(state) {
    if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
        throw new Error("Work Orders cannot be writable in Firestore and PostgreSQL at the same time");
    }
}
assertWorkOrderWriterAuthorityCoherent(exports.WORK_ORDER_WRITER_AUTHORITY);
//# sourceMappingURL=workOrderWriterState.js.map