"use strict";
// Part identifier READ service -- the projection the Barcodes & Identifiers administration
// surface renders. Trusted: capability is enforced by the caller (the callable adapter) before
// this runs, and the projection never leaves this file's allow-list.
//
// WHY A PROJECTION RATHER THAN THE STORED DOCUMENT. The stored alias carries `normalizedValue`
// alongside `originalValue`. Normalization is an internal matching detail -- it is what makes the
// deterministic document id work -- and shipping it to a client would publish the matching
// algorithm's output as if it were data the user entered. The surface shows what a person typed
// and what the system decided it IS; it does not show the intermediate form.
//
// SENSITIVE IDENTIFIERS. partAliasCommands.ts keeps raw values out of AUDIT summaries and carries
// a fingerprint instead, because customer and vendor references must not leak through audit
// surfaces. That is not the same rule as this one: an administrator looking at a Part's identifier
// list is exactly who is supposed to read those values, and a list of fingerprints would be
// unusable for the job the screen exists to do. Audit hides them; the authorized administration
// read shows them. Both are deliberate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPartAliases = listPartAliases;
const partAliasRepository_js_1 = require("./partAliasRepository.js");
const millis = (v) => v instanceof Date ? v.getTime() : typeof v === "number" && Number.isFinite(v) ? v : null;
/**
 * Order: ACTIVE before INACTIVE, then by type, then by value.
 *
 * Applied IN MEMORY on purpose. An `orderBy` would turn the single-field equality query into one
 * needing a composite index, and adding an index is a protected boundary this slice must not
 * cross. The list is bounded, so sorting it here costs nothing.
 */
function compare(a, b) {
    if (a.status !== b.status)
        return a.status === "ACTIVE" ? -1 : 1;
    if (a.aliasType !== b.aliasType)
        return a.aliasType.localeCompare(b.aliasType);
    return a.value.localeCompare(b.value);
}
async function listPartAliases(db, partId) {
    const { aliases, truncated } = await (0, partAliasRepository_js_1.buildFirestorePartAliasRepository)(db).listByPartId(partId);
    const projected = aliases
        .map((a) => ({
        aliasId: a.aliasId,
        aliasType: a.aliasType,
        value: a.originalValue,
        status: a.status,
        source: a.source,
        manufacturerId: a.manufacturerId ?? null,
        effectiveFrom: a.effectiveFrom ?? null,
        effectiveTo: a.effectiveTo ?? null,
        version: a.version,
        createdAtMillis: millis(a.createdAt),
        updatedAtMillis: millis(a.updatedAt),
    }))
        .sort(compare);
    return { partId, aliases: projected, truncated, limit: partAliasRepository_js_1.PART_ALIAS_LIST_LIMIT };
}
//# sourceMappingURL=partAliasReadService.js.map