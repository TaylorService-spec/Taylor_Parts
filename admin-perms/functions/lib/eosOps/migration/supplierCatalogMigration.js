"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierCatalogMigrationError = void 0;
exports.mapSupplier = mapSupplier;
exports.mapSupplierItem = mapSupplierItem;
exports.planSupplierCatalogMigration = planSupplierCatalogMigration;
exports.reconcileSupplierCatalogMigration = reconcileSupplierCatalogMigration;
// MIGRATION_ONLY -- mapping the governed Firestore Supplier / part_supplier_item records onto the
// PostgreSQL authority created by migration 008, plus the reconciliation that proves the move.
//
// ════════════════════ WHY THIS IS PURE ════════════════════
//
// It takes PLAIN OBJECTS -- the shapes supplierMasterRepository.supplierToFirestore and
// partSupplierItems.supplierItemToFirestore produce -- and returns row inputs for
// supplierCatalogRepository. It reads no Firestore, opens no pool, and has no clock. The same
// discipline as legacyInventoryMovementMapping.ts: the mapping is the part that can be wrong, so it
// is the part that is provable offline, and the I/O around it is somebody else's function.
//
// ════════════════════ WHAT IT REFUSES ════════════════════
//
//   * A part id that is not ALREADY the canonical `Part.partId`. requireCanonicalPartId
//     (partIdContract.ts) is the one gate; this module adds no second canonicalization, consults no
//     alias table, and never trims a value into shape.
//   * A stored `itemId` that is not exactly `<partId>__<supplierId>`. The pair is the identity
//     (partSupplierItems.ts buildSupplierItemId); a doc id that disagrees with its own fields means
//     one of the two is wrong, and picking a winner would be inventing the answer. This mirrors
//     partMasterRepository.ts's refusal when `manufacturerId !== docId`.
//   * A supplier record whose `id` disagrees with the document id it was read from.
//
// ════════════════════ WHAT IT DOES NOT DECIDE ════════════════════
//
//   * NOTHING IS MERGED OR DEDUPLICATED. Two ACTIVE suppliers sharing a normalized key are a
//     suspected duplicate for a person (S2: detection, never auto-merge). The plan REPORTS them.
//   * NO OPERATING COMPANY IS INVENTED. No source record carries one; see migration 008's header.
//   * NOTHING IS WRITTEN. `planSupplierCatalogMigration` returns a plan; executing it is a separate,
//     separately authorized step, and there is no execute function in this file.
const partIdContract_1 = require("./partIdContract");
class SupplierCatalogMigrationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.SupplierCatalogMigrationError = SupplierCatalogMigrationError;
function fail(code, message) {
    throw new SupplierCatalogMigrationError(code, message);
}
function requireString(value, field) {
    if (typeof value !== "string" || value.trim().length === 0) {
        fail("FIELD_INVALID", `${field} must be a non-blank string`);
    }
    return value;
}
function optionalString(value, field) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string" || value.trim().length === 0) {
        fail("FIELD_INVALID", `${field} must be a non-blank string when present`);
    }
    return value;
}
function requireEnum(value, allowed, field) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        fail("FIELD_INVALID", `${field} must be one of ${allowed.join("/")}`);
    }
    return value;
}
/**
 * A Firestore Timestamp, a Date, or an ISO string -> an ISO-8601 instant. Accepted structurally
 * (`toDate`) rather than by `instanceof Timestamp`, because importing firebase-admin here would put
 * Firebase inside src/eosOps -- which test/eosOpsNoFirebase.test.mjs forbids outright.
 */
function optionalInstant(value, field) {
    if (value === undefined || value === null)
        return null;
    if (value instanceof Date)
        return value.toISOString();
    const maybe = value;
    if (typeof maybe.toDate === "function") {
        const d = maybe.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime()))
            return d.toISOString();
    }
    if (typeof value === "string") {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime()))
            return d.toISOString();
    }
    return fail("FIELD_INVALID", `${field} must be a timestamp`);
}
/**
 * One stored governed Supplier -> the repository's create input. `docId` is the document it was
 * read from; the stored `id` must equal it, the same binding supplierMasterValidation.ts enforces.
 */
function mapSupplier(docId, source) {
    if (source === null || typeof source !== "object")
        fail("NOT_AN_OBJECT", `supplier ${docId} is not an object`);
    const id = requireString(source.id, "id");
    if (id !== docId)
        fail("IDENTITY_MISMATCH", `supplier ${docId} stores id ${JSON.stringify(id)}`);
    return {
        supplierId: id,
        name: requireString(source.name, "name"),
        // Verbatim. Recomputing it here would be a second definition of "normalized" -- see the
        // repository header and partIdContract.ts's no-rewriting rule.
        normalizedKey: requireString(source.normalizedKey, "normalizedKey"),
        status: requireEnum(source.status, ["ACTIVE", "INACTIVE"], "status"),
        vendorNumber: optionalString(source.vendorNumber, "vendorNumber"),
        contactName: optionalString(source.contactName, "contactName"),
        phone: optionalString(source.phone, "phone"),
        email: optionalString(source.email, "email"),
        address: optionalString(source.address, "address"),
        paymentTermsRef: optionalString(source.paymentTermsRef, "paymentTermsRef"),
        notes: optionalString(source.notes, "notes"),
    };
}
/**
 * One stored governed part_supplier_item -> the repository's create input.
 *
 * `preferred` is deliberately NOT part of the create input: the repository sets it through
 * setPreferredSupplier, so that the one-preferred-per-part index is what decides, and a migration
 * cannot smuggle in a second preferred item for a part by writing the flag directly. The plan
 * reports the preferred pairs separately, for the caller to apply after the rows land.
 */
function mapSupplierItem(docId, source) {
    if (source === null || typeof source !== "object")
        fail("NOT_AN_OBJECT", `supplier item ${docId} is not an object`);
    const partId = (0, partIdContract_1.requireCanonicalPartId)(source.partId, `supplier item ${docId} partId`);
    const supplierId = requireString(source.supplierId, "supplierId");
    const itemId = requireString(source.itemId, "itemId");
    if (itemId !== docId)
        fail("IDENTITY_MISMATCH", `supplier item ${docId} stores itemId ${JSON.stringify(itemId)}`);
    if (itemId !== `${partId}__${supplierId}`) {
        fail("ITEM_ID_MISMATCH", `supplier item ${docId} is not <partId>__<supplierId> for its own fields`);
    }
    const leadTimeDays = source.leadTimeDays;
    if (!Number.isInteger(leadTimeDays))
        fail("FIELD_INVALID", "leadTimeDays must be an integer");
    const conversionSource = source.conversionToStockingUnit;
    let conversion = null;
    if (source.purchaseUnit !== undefined || (conversionSource !== undefined && conversionSource !== null)) {
        const purchaseUnit = requireString(source.purchaseUnit, "purchaseUnit");
        if (conversionSource === undefined || conversionSource === null || typeof conversionSource !== "object") {
            fail("FIELD_INVALID", "purchaseUnit requires conversionToStockingUnit");
        }
        const { numerator, denominator } = conversionSource;
        if (!Number.isInteger(numerator) || numerator <= 0)
            fail("FIELD_INVALID", "conversion numerator must be a positive integer");
        if (!Number.isInteger(denominator) || denominator <= 0)
            fail("FIELD_INVALID", "conversion denominator must be a positive integer");
        conversion = { purchaseUnit, numerator: numerator, denominator: denominator };
    }
    return {
        partId,
        supplierId,
        supplierSku: requireString(source.supplierSku, "supplierSku"),
        // Carried as the decimal STRING it is stored as. Parsing it to a number and back is how a
        // fourth decimal place quietly disappears; NUMERIC(19,4) accepts the string directly.
        cost: requireString(source.cost, "cost"),
        currency: requireString(source.currency, "currency"),
        leadTimeDays: leadTimeDays,
        minOrderQty: optionalString(source.minOrderQty, "minOrderQty"),
        orderMultiple: optionalString(source.orderMultiple, "orderMultiple"),
        conversion,
        contractStart: optionalString(source.contractStart, "contractStart"),
        contractEnd: optionalString(source.contractEnd, "contractEnd"),
        lastVerifiedAt: optionalInstant(source.lastVerifiedAt, "lastVerifiedAt"),
        availability: requireEnum(source.availability, ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"], "availability"),
        status: requireEnum(source.status, ["ACTIVE", "INACTIVE"], "status"),
    };
}
/**
 * Classify and map every source record. It PARTITIONS rather than failing on the first bad row --
 * the same choice isCanonicalPartId exists for -- so one malformed document cannot hide the shape
 * of the whole move. Deterministic: same input, same plan, in the input's own order.
 */
function planSupplierCatalogMigration(suppliers, items) {
    const mappedSuppliers = [];
    const mappedItems = [];
    const preferred = [];
    const rejected = [];
    const orphanedItems = [];
    for (const doc of suppliers) {
        try {
            mappedSuppliers.push(mapSupplier(doc.docId, doc.data));
        }
        catch (err) {
            rejected.push(describe(doc.docId, err));
        }
    }
    const knownSupplierIds = new Set(mappedSuppliers.map((s) => s.supplierId));
    for (const doc of items) {
        let mapped;
        try {
            mapped = mapSupplierItem(doc.docId, doc.data);
        }
        catch (err) {
            rejected.push(describe(doc.docId, err));
            continue;
        }
        // The FK is the target's answer, so the plan states it here rather than discovering it as a
        // failed INSERT halfway through a run.
        if (!knownSupplierIds.has(mapped.supplierId)) {
            orphanedItems.push({
                docId: doc.docId,
                code: "SUPPLIER_NOT_FOUND",
                reason: `supplierId ${JSON.stringify(mapped.supplierId)} names no migratable supplier`,
            });
            continue;
        }
        mappedItems.push(mapped);
        if (doc.data.preferred === true && mapped.status === "ACTIVE") {
            preferred.push({ partId: mapped.partId, supplierId: mapped.supplierId });
        }
    }
    return {
        suppliers: mappedSuppliers,
        items: mappedItems,
        preferred,
        rejected,
        orphanedItems,
        suspectedDuplicates: detectDuplicates(mappedSuppliers),
        preferredConflicts: detectPreferredConflicts(preferred),
        counts: {
            sourceSuppliers: suppliers.length,
            sourceItems: items.length,
            mappedSuppliers: mappedSuppliers.length,
            mappedItems: mappedItems.length,
            rejected: rejected.length,
            orphanedItems: orphanedItems.length,
        },
    };
}
function describe(docId, err) {
    const code = err?.code;
    return {
        docId,
        code: typeof code === "string" ? code : "UNKNOWN",
        reason: err instanceof Error ? err.message : String(err),
    };
}
function detectDuplicates(suppliers) {
    const byKey = new Map();
    for (const s of suppliers) {
        if (s.status === "INACTIVE")
            continue;
        const bucket = byKey.get(s.normalizedKey);
        if (bucket)
            bucket.push(s.supplierId);
        else
            byKey.set(s.normalizedKey, [s.supplierId]);
    }
    const out = [];
    for (const [normalizedKey, supplierIds] of byKey) {
        if (supplierIds.length > 1)
            out.push({ normalizedKey, supplierIds: [...supplierIds].sort() });
    }
    return out.sort((a, b) => (a.normalizedKey < b.normalizedKey ? -1 : a.normalizedKey > b.normalizedKey ? 1 : 0));
}
function detectPreferredConflicts(preferred) {
    const byPart = new Map();
    for (const p of preferred) {
        const bucket = byPart.get(p.partId);
        if (bucket)
            bucket.push(p.supplierId);
        else
            byPart.set(p.partId, [p.supplierId]);
    }
    const out = [];
    for (const [partId, supplierIds] of byPart) {
        if (supplierIds.length > 1)
            out.push({ partId, supplierIds: [...supplierIds].sort() });
    }
    return out.sort((a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
}
/**
 * THE PROOF. A migration that "ran without errors" is not evidence; three counts that agree are.
 *
 * `balanced` says the destination holds exactly what the plan said it would. `complete` is the
 * stricter question -- balanced AND nothing was rejected or orphaned -- and it is reported
 * separately on purpose: a run can be perfectly balanced and still have left records behind, and
 * collapsing the two would let the second fact hide inside the first.
 */
function reconcileSupplierCatalogMigration(plan, destination) {
    const expectedPreferred = plan.preferred.length - plan.preferredConflicts.reduce(
    // A conflicting part contributes exactly ONE preferred row to the destination -- the index
    // permits no more -- so the excess is not a discrepancy, it is the conflict already reported.
    (excess, c) => excess + (c.supplierIds.length - 1), 0);
    const discrepancies = [];
    const check = (what, expected, actual) => {
        if (expected !== actual)
            discrepancies.push({ what, expected, actual });
    };
    check("suppliers", plan.counts.mappedSuppliers, destination.suppliers);
    check("supplier_catalog_items", plan.counts.mappedItems, destination.items);
    check("preferred supplier items", expectedPreferred, destination.preferred);
    const unmigrated = [...plan.rejected, ...plan.orphanedItems];
    return {
        balanced: discrepancies.length === 0,
        discrepancies,
        unmigrated,
        complete: discrepancies.length === 0 && unmigrated.length === 0,
    };
}
//# sourceMappingURL=supplierCatalogMigration.js.map