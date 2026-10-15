"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EQUIPMENT_WRITER_AUTHORITY = void 0;
exports.assertEquipmentWriterAuthorityCoherent = assertEquipmentWriterAuthorityCoherent;
exports.EQUIPMENT_WRITER_AUTHORITY = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
/** Two writable authorities at once is the one forbidden state. */
function assertEquipmentWriterAuthorityCoherent(state) {
    if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
        throw new Error("EQUIPMENT_WRITER_AUTHORITY: Firestore OPEN and PostgreSQL ACTIVE at once is a dual write");
    }
}
assertEquipmentWriterAuthorityCoherent(exports.EQUIPMENT_WRITER_AUTHORITY);
//# sourceMappingURL=equipmentWriterState.js.map