"use strict";
// EOS Data Import -- the entity contract, and the registry of them.
//
// PORTABILITY BOUNDARY. Pure: no firebase-admin, no Firestore, no collection names.
//
// WHY A REGISTRY RATHER THAN FIVE PIPELINES. Everything import does between "here are some
// mapped values" and "write this" is identical for every entity: suggest a mapping, detect
// which entity a header describes, normalize a row, classify it, refuse a duplicate. Only
// the FIELDS differ. Writing that logic once per entity would produce five copies that
// agree today and disagree after the first bug fix lands in four of them.
//
// So an entity contributes a CONTRACT -- its canonical fields, how a row normalizes, what
// its natural identity is -- and the pipeline stays one pipeline.
//
// AN UNWIRED ENTITY IS `null`, NOT AN EMPTY CONTRACT. An empty field list would make
// detection quietly succeed with zero confidence and mapping quietly validate a file with
// no fields at all. Absence has to be distinguishable from emptiness, because "we do not
// import this yet" and "this file has no columns" are different sentences.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPORT_ENTITY_TYPES = void 0;
exports.registerEntityContract = registerEntityContract;
exports.entityContractFor = entityContractFor;
exports.wiredEntityContracts = wiredEntityContracts;
exports.naturalIdentityKey = naturalIdentityKey;
/** The five entities named in the P1 brief. Order is display order. */
exports.IMPORT_ENTITY_TYPES = ["PARTS", "CUSTOMERS", "EQUIPMENT", "INVENTORY", "SERVICE_HISTORY"];
const REGISTRY = new Map();
/**
 * Register a contract.
 *
 * Called once per contract module at import time rather than assembled in a central list,
 * so adding an entity is one file plus one import -- and so this module does not depend on
 * every contract, which would make the registry a cycle.
 */
function registerEntityContract(contract) {
    REGISTRY.set(contract.entityType, contract);
    return contract;
}
/** The contract for an entity, or null if this release does not import it. */
function entityContractFor(entityType) {
    return REGISTRY.get(entityType) ?? null;
}
/** Every wired contract, in the declared entity order (not registration order). */
function wiredEntityContracts() {
    return Object.freeze(exports.IMPORT_ENTITY_TYPES.map((t) => REGISTRY.get(t)).filter((c) => c !== undefined));
}
/** Shared normalization for a natural-identity key. */
function naturalIdentityKey(value) {
    return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}
//# sourceMappingURL=entityContract.js.map