"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAREHOUSE_PROVENANCES = exports.WAREHOUSE_STATUSES = void 0;
// ---------------------------------------------------------------------------
// Receiving Location Authority -- I-LA C2 (ratified: docs/specifications/
// receiving-location-authority-i-la-c2-warehouse-status.md). The governed
// §3A warehouse-eligibility record. These constants + the GovernedWarehouse
// shape are the SHARED contract consumed by the pure validator/deserializer
// (governedWarehouseValidation.ts) and, in later gates, by the migration,
// verifier, trusted writer, and Receiving resolver. INERT here: this gate adds
// types + a pure validator only -- no writer, migration, resolver, or Rules.
// ---------------------------------------------------------------------------
// Governed eligibility state. Receiving treats ONLY "ACTIVE" as eligible; the
// resolver fails closed on anything else (spec §3/§6).
exports.WAREHOUSE_STATUSES = ["ACTIVE", "INACTIVE"];
// Governance-initialization provenance discriminator (spec §3A.1). NATIVE =
// created by the trusted writer; MIGRATED = governance applied by the I-LA3
// migration to a legacy document.
exports.WAREHOUSE_PROVENANCES = ["NATIVE", "MIGRATED"];
//# sourceMappingURL=warehouse.js.map