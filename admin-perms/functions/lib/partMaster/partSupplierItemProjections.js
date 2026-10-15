"use strict";
// Part↔Supplier procurement terms -- PURE governed projection contracts. No Firebase/I/O; the trusted
// READ SERVICE that resolves capabilities + reads Firestore is NOT built/activated here (it is gated on
// R-1 supplying inventory.catalog.read / inventory.catalog.cost.read). This module encodes the FIELD-TIER
// separation that the cost-exposure model depends on, so it can be tested offline now:
//
//   RELATIONSHIP  -- supplier identity, supplier sku, relationship status, preferred flag
//   OPERATIONAL   -- lead time, availability, ordering constraints (min/multiple/unit/conversion)
//   COST/COMMERCIAL -- unit cost, currency, contract dates, other sensitive purchasing economics
//
// TWO projections (Owner-ratified):
//   RELATIONSHIP projection = RELATIONSHIP + OPERATIONAL (NO cost)   -> requires inventory.catalog.read
//   COST projection         = the above + COST/COMMERCIAL           -> requires inventory.catalog.read AND
//                                                                       inventory.catalog.cost.read
//
// The cost projection MUST NOT broaden general catalog visibility, and cost fields MUST NEVER appear in the
// relationship projection. Fails closed: without inventory.catalog.read there is NO projection at all.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COST_FIELDS = exports.OPERATIONAL_FIELDS = exports.RELATIONSHIP_FIELDS = void 0;
exports.projectPartSupplierItem = projectPartSupplierItem;
exports.projectPartSupplierItems = projectPartSupplierItems;
// Tiers follow the Owner-ratified tier definition (catalog-sequencing decision §1): COST/COMMERCIAL =
// unit cost, currency, AND contract/commercial terms. So `currency` and `contractStart`/`contractEnd` are
// COST (not "operational"/"cost-adjacent"). `lastVerifiedAt` is a verification timestamp (operational
// metadata about relationship freshness), not sensitive economics -> operational.
exports.RELATIONSHIP_FIELDS = Object.freeze(["partId", "supplierId", "supplierSku", "status", "preferred"]);
exports.OPERATIONAL_FIELDS = Object.freeze(["leadTimeDays", "availability", "minOrderQty", "orderMultiple", "purchaseUnit", "conversionToStockingUnit", "lastVerifiedAt"]);
exports.COST_FIELDS = Object.freeze(["cost", "currency", "contractStart", "contractEnd"]);
function pick(src, keys) {
    const out = {};
    for (const k of keys)
        if (Object.prototype.hasOwnProperty.call(src, k))
            out[k] = src[k];
    return out;
}
// Project ONE raw part_supplier_item record under the caller's resolved catalog read authority. Returns
// null (FAIL CLOSED) when the caller lacks inventory.catalog.read -- no relationship, no cost, nothing.
// Cost/commercial fields are included ONLY when costRead is also true, and never otherwise -- a client
// with only catalogRead can never infer cost through this projection.
function projectPartSupplierItem(raw, authority) {
    if (!authority || authority.catalogRead !== true)
        return null; // fail closed: no catalog.read -> no projection
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const base = { ...pick(src, exports.RELATIONSHIP_FIELDS), ...pick(src, exports.OPERATIONAL_FIELDS) };
    if (authority.costRead === true) {
        return { tier: "cost", fields: { ...base, ...pick(src, exports.COST_FIELDS) } };
    }
    return { tier: "relationship", fields: base };
}
// Project a list; drops (fails closed) every item the caller can't read. Preserves order.
function projectPartSupplierItems(rows, authority) {
    if (!authority || authority.catalogRead !== true)
        return [];
    return (Array.isArray(rows) ? rows : []).map((r) => projectPartSupplierItem(r, authority)).filter((p) => p !== null);
}
//# sourceMappingURL=partSupplierItemProjections.js.map