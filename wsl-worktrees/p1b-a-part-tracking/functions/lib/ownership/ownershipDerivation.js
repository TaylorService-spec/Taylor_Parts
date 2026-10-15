"use strict";
// EOS Ownership Model v1 — the READ-ONLY REFERENTIAL DERIVATION CHECK (Owner ruling, physical
// roots: "Do not assume the full 138 are derivable until that check passes").
//
// The backfill plan proposed that 138 descendant records could take their operating company from a
// governed physical root. That was a proposal from the MATRIX, not a measurement of the DATA, and
// the two are different claims: the matrix says where a company COULD come from, this says whether
// the reference actually exists on each record.
//
// It classifies every descendant into exactly one bucket:
//
//   DERIVABLE                 one resolvable reference to one known root
//   MISSING_REFERENCE         the record carries no location reference at all
//   INVALID_REFERENCE         a reference is present but names no known root
//   POTENTIALLY_CROSS_COMPANY two DISTINCT roots are referenced. Whether that is genuinely
//                             cross-company depends on the companies those roots are later
//                             assigned, so it cannot be decided yet -- and calling it DERIVABLE
//                             now would hide a transfer that crosses the Taylor/Ventana boundary
//   CONFLICT                  two references that must agree do not (e.g. a legacy warehouseId and
//                             a structured location pointing at different warehouses)
//
// WHY IT RUNS BEFORE THE ROOTS CARRY COMPANIES. The question "does this record reference a root at
// all" is answerable today and is the one actually in doubt. The question "which company" needs the
// Owner's 14 root assignments. Splitting them means the referential truth is measured now rather
// than discovered halfway through a backfill.
//
// PURE: no Firestore, no I/O. The CLI reads documents and hands them here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DERIVATION_RULES = void 0;
exports.deriveRoot = deriveRoot;
exports.tallyDerivation = tallyDerivation;
exports.DERIVATION_RULES = Object.freeze([
    {
        family: "cycleCount", collection: "cycle_counts",
        paths: ["location.locationId"], multiRootIsExpected: false,
    },
    {
        family: "receivingOrder", collection: "receiving_orders",
        paths: ["receivingLocation.locationId"], multiRootIsExpected: false,
    },
    {
        family: "inventoryTransaction", collection: "inventory_transactions",
        paths: ["location.locationId", "counterpartyLocation.locationId"], multiRootIsExpected: true,
        note: "The ledger has two shapes. Newer entries carry a structured location and sometimes a counterparty; the legacy shape carries neither, and that is exactly what this check exists to count.",
    },
    {
        family: "transferOrder", collection: "transfer_orders",
        paths: ["origin.locationId", "destination.locationId", "fromWarehouseId", "toWarehouseId"],
        multiRootIsExpected: true,
        note: "Origin and destination are SUPPOSED to differ. A transfer resolving to two roots is correct, and whether it crosses companies depends on the root assignments.",
    },
    {
        family: "stockLocation", collection: "stock_locations",
        paths: ["warehouseId"], multiRootIsExpected: false,
        note: "A per-warehouse-per-part BALANCE record, not a physical place. It derives from its warehouse -- it is not a root, which is a correction to the first plan.",
    },
    {
        family: "truck", collection: "trucks",
        paths: ["homeWarehouseId"], multiRootIsExpected: false,
        note: "A truck derives from its home warehouse -- a real governed reference, not a proxy.",
    },
    {
        family: "reorderRequest", collection: "reorder_requests",
        paths: [], multiRootIsExpected: false,
        note: "Carries NO location reference of any kind. Declared with an empty path list so it is measured and reported as MISSING_REFERENCE rather than omitted from the check.",
    },
    {
        family: "reorderPurchaseOrder", collection: "reorder_purchase_orders",
        paths: [], multiRootIsExpected: false,
        note: "Reaches a root only through its Reorder Request, which has none. A two-hop derivation over a broken first hop is not a derivation.",
    },
    {
        family: "mobileLocation", collection: "mobile_locations",
        paths: ["homeWarehouseId"], multiRootIsExpected: false,
        note: "Stored mobile locations do not carry a home warehouse today; declared so the gap is counted.",
    },
]);
/** Read a dotted path. Returns undefined for any missing link -- never throws on a partial shape. */
function at(doc, path) {
    let cur = doc;
    for (const seg of path.split(".")) {
        if (cur === null || typeof cur !== "object")
            return undefined;
        cur = cur[seg];
    }
    return cur;
}
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
/**
 * Classify one document against its family's rule and the set of KNOWN root ids.
 *
 * `knownRoots` is the set of root ids that exist, not their company assignments -- this check
 * deliberately answers referential resolvability, which is answerable today.
 */
function deriveRoot(rule, doc, knownRoots) {
    if (rule.paths.length === 0) {
        return { outcome: "MISSING_REFERENCE", roots: [], reason: "family carries no location reference" };
    }
    const found = [];
    const unknown = [];
    for (const path of rule.paths) {
        const value = at(doc, path);
        if (!nonEmpty(value))
            continue;
        if (knownRoots.has(value))
            found.push(value);
        else
            unknown.push(`${path}=${value}`);
    }
    if (found.length === 0 && unknown.length === 0) {
        return { outcome: "MISSING_REFERENCE", roots: [], reason: "no location reference present on this record" };
    }
    if (found.length === 0) {
        return { outcome: "INVALID_REFERENCE", roots: [], reason: `names no known root: ${unknown.join(", ")}` };
    }
    const distinct = [...new Set(found)];
    if (distinct.length > 1) {
        // Expected for a transfer, a defect for a cycle count. The rule says which, so the check does
        // not have to guess -- and an unexpected pair is reported as a CONFLICT rather than averaged
        // away into one of them.
        return rule.multiRootIsExpected
            ? {
                outcome: "POTENTIALLY_CROSS_COMPANY",
                roots: distinct,
                reason: `two roots: ${distinct.join(" -> ")} (cross-company depends on their assignments)`,
            }
            : { outcome: "CONFLICT", roots: distinct, reason: `references disagree: ${distinct.join(", ")}` };
    }
    // A partial record -- one good reference and one dangling -- still derives, and the dangling half
    // is named rather than dropped.
    return {
        outcome: "DERIVABLE",
        roots: distinct,
        reason: unknown.length > 0 ? `derivable from ${distinct[0]}; also carries unknown ${unknown.join(", ")}` : `derivable from ${distinct[0]}`,
    };
}
const emptyOutcomeCounts = () => ({
    DERIVABLE: 0,
    MISSING_REFERENCE: 0,
    INVALID_REFERENCE: 0,
    POTENTIALLY_CROSS_COMPANY: 0,
    CONFLICT: 0,
});
function tallyDerivation(rule, documents, knownRoots) {
    const counts = emptyOutcomeCounts();
    const reasons = {};
    for (const doc of documents) {
        const result = deriveRoot(rule, doc.data, knownRoots);
        counts[result.outcome] += 1;
        if (result.outcome !== "DERIVABLE")
            reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    }
    return { family: rule.family, collection: rule.collection, scanned: documents.length, counts, reasons };
}
//# sourceMappingURL=ownershipDerivation.js.map