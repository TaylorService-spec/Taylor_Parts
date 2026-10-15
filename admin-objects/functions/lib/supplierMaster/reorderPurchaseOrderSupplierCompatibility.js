"use strict";
// Supplier Master (S4) -- PURE compatibility layer that links a live reorder_purchase_orders record
// to a governed Supplier (Supplier Master) WHEN RESOLVABLE, while preserving the historical free-text
// supplierName verbatim as supplierNameSnapshot. Same discipline as workOrderSnapshotCompatibility
// (INV-1 PR 1.7): no I/O, never throws, never mutates/backfills a document, and it adds identity only
// when it can be resolved -- an unresolved record passes through as a readable historical row.
//
// IMPORTANT (integration boundary): this module DERIVES the linkage; it does NOT persist it. The live
// reorder_purchase_orders create Rule pins its fields with keys().hasOnly([...]) and that allowlist
// does NOT yet include supplierId/supplierNameSnapshot, so actually WRITING these fields (client
// writer OR migration) requires a protected reorder_purchase_orders Rules update first. That delta is
// a separate promotion step; nothing here writes.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGovernedSupplierIndex = buildGovernedSupplierIndex;
exports.deriveSupplierLinkage = deriveSupplierLinkage;
const supplierMasterValidation_js_1 = require("./supplierMasterValidation.js");
function keyFor(row) {
    if (typeof row.normalizedKey === "string" && row.normalizedKey.length > 0)
        return row.normalizedKey;
    return (0, supplierMasterValidation_js_1.normalizeSupplierName)(row.name);
}
// Build a normalizedKey -> {activeIds, inactiveIds} index. Deterministic: ids are sorted; a supplier
// whose status is neither ACTIVE nor INACTIVE, or whose key is empty, is skipped (cannot be a match
// target). Pure.
function buildGovernedSupplierIndex(suppliers) {
    const active = new Map();
    const inactive = new Map();
    const push = (m, key, id) => {
        const list = m.get(key);
        if (list)
            list.push(id);
        else
            m.set(key, [id]);
    };
    for (const s of suppliers ?? []) {
        if (!s || typeof s.id !== "string" || s.id.length === 0)
            continue;
        const key = keyFor(s);
        if (key === "")
            continue;
        if (s.status === "ACTIVE")
            push(active, key, s.id);
        else if (s.status === "INACTIVE")
            push(inactive, key, s.id);
    }
    const keys = new Set([...active.keys(), ...inactive.keys()]);
    const index = new Map();
    for (const key of keys) {
        index.set(key, {
            activeIds: (active.get(key) ?? []).slice().sort(),
            inactiveIds: (inactive.get(key) ?? []).slice().sort(),
        });
    }
    return index;
}
// Derive the supplier linkage for ONE reorder PO. Never throws. Preserves supplierName verbatim as the
// snapshot; assigns supplierId only for an unambiguous ACTIVE match. Order of precedence: HISTORICAL
// (no name) -> EXACT (1 active) -> AMBIGUOUS (>1 active) -> INACTIVE (0 active, >=1 inactive) ->
// UNMATCHED (nothing).
function deriveSupplierLinkage(po, index) {
    const rawName = po && typeof po.supplierName === "string" ? po.supplierName : "";
    const snapshot = rawName.trim().length > 0 ? rawName : null;
    if (snapshot === null) {
        return { supplierNameSnapshot: null, supplierId: null, classification: "HISTORICAL", candidateIds: [] };
    }
    const key = (0, supplierMasterValidation_js_1.normalizeSupplierName)(snapshot);
    const entry = key === "" ? undefined : index.get(key);
    if (!entry) {
        return { supplierNameSnapshot: snapshot, supplierId: null, classification: "UNMATCHED", candidateIds: [] };
    }
    if (entry.activeIds.length === 1) {
        return { supplierNameSnapshot: snapshot, supplierId: entry.activeIds[0], classification: "EXACT", candidateIds: [entry.activeIds[0]] };
    }
    if (entry.activeIds.length > 1) {
        return { supplierNameSnapshot: snapshot, supplierId: null, classification: "AMBIGUOUS", candidateIds: entry.activeIds };
    }
    // activeIds.length === 0 here, and entry exists only if there was at least one active OR inactive id.
    return { supplierNameSnapshot: snapshot, supplierId: null, classification: "INACTIVE", candidateIds: entry.inactiveIds };
}
//# sourceMappingURL=reorderPurchaseOrderSupplierCompatibility.js.map