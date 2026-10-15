"use strict";
// THE POSTGRESQL PART ALIAS AUTHORITY -- alias commands and reads, in the Catalog bounded context.
//
// It restates NO domain rule. Normalization, the alias key, the storage-safe id encoding, the type
// and status vocabularies and the scanned-identifier fan-out are all REUSED from the pure
// `partMaster` modules -- a second normalization algorithm would mean the same barcode resolved to
// two different identities depending on which store answered, which is the one defect an identifier
// authority cannot have.
//
// ════════════════════ IDENTITY IS DERIVED, NEVER GENERATED ════════════════════
//
// `deriveAliasDocId` produces the id from (type, raw value, manufacturer scope) through
// `normalizeIdentifier` -> `buildAliasKey` -> `encodeAliasDocId`. That id is the primary key, so
// "is this identifier already taken" is answered by the key rather than by a query somebody has to
// remember to run, and a row copied from Firestore keeps the id it already had.
//
// ════════════════════ WHAT THE PROJECTION MAY SHOW ════════════════════
//
// Alias administration, which requires the Catalog capability, sees `originalValue` -- a person
// correcting a mis-typed supplier SKU has to see what was typed. AUDIT carries a FINGERPRINT of the
// normalized value instead, exactly as the Firestore authority does: an audit trail is read by more
// people, kept longer, and exported more often than the record it describes, and a raw customer or
// vendor identifier in it is the copy that outlives every control around the original.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALIAS_STATUS_VOCABULARY = exports.reactivatePartAlias = exports.deactivatePartAlias = exports.INSERT_ALIAS_SQL = exports.ALIAS_SELECT = exports.ALIAS_PROVENANCE = void 0;
exports.aliasValueFingerprint = aliasValueFingerprint;
exports.aliasFromRow = aliasFromRow;
exports.insertAliasValues = insertAliasValues;
exports.lockAlias = lockAlias;
exports.aliasAuthorityPresent = aliasAuthorityPresent;
exports.preserveInternalPartNumberAlias = preserveInternalPartNumberAlias;
exports.createPartAlias = createPartAlias;
exports.listPartAliases = listPartAliases;
exports.probePartAlias = probePartAlias;
exports.resolveScannedPartIdentifier = resolveScannedPartIdentifier;
const node_crypto_1 = require("node:crypto");
const catalogMasterKernel_js_1 = require("./catalogMasterKernel.js");
const partAliasIdentity_js_1 = require("../partMaster/partAliasIdentity.js");
const types_js_1 = require("../partMaster/types.js");
const partAliasScanCore_js_1 = require("../partMaster/partAliasScanCore.js");
const catalogRows_js_1 = require("./catalogRows.js");
const SCHEMA = "eos_ops";
exports.ALIAS_PROVENANCE = Object.freeze({ NATIVE: "NATIVE", MIGRATED: "MIGRATED" });
/** The audit-safe form of an identifier value. Never the value itself. */
function aliasValueFingerprint(normalizedValue) {
    return (0, node_crypto_1.createHash)("sha256").update(normalizedValue).digest("hex").slice(0, 16);
}
exports.ALIAS_SELECT = `
  SELECT id AS alias_id, part_id, alias_type::text AS alias_type, original_value, normalized_value,
         status::text AS status, source, manufacturer_id,
         effective_from::text AS effective_from, effective_to::text AS effective_to,
         version, provenance::text AS provenance,
         created_at, created_by, updated_at, updated_by, deactivated_at, deactivated_by
    FROM ${SCHEMA}.part_aliases`;
const iso = (v) => (v instanceof Date ? (0, catalogRows_js_1.isoMicros)(v) : (v === null || v === undefined ? null : String(v)));
function aliasFromRow(r) {
    return Object.freeze({
        aliasId: r.alias_id,
        partId: r.part_id,
        aliasType: r.alias_type,
        originalValue: r.original_value,
        normalizedValue: r.normalized_value,
        status: r.status,
        source: r.source,
        manufacturerId: r.manufacturer_id ?? null,
        effectiveFrom: r.effective_from ?? null,
        effectiveTo: r.effective_to ?? null,
        version: Number(r.version),
        provenance: r.provenance,
        createdAt: iso(r.created_at),
        createdBy: r.created_by ?? null,
        updatedAt: iso(r.updated_at),
        updatedBy: r.updated_by ?? null,
        deactivatedAt: iso(r.deactivated_at),
        deactivatedBy: r.deactivated_by ?? null,
    });
}
exports.INSERT_ALIAS_SQL = `
  INSERT INTO ${SCHEMA}.part_aliases
    (id, tenant_id, part_id, alias_type, original_value, normalized_value, status, source,
     manufacturer_id, effective_from, effective_to, version, provenance,
     created_at, created_by, updated_at, updated_by, deactivated_at, deactivated_by)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$13,$14,$15,$16,$17,$18,$19)`;
function insertAliasValues(tenantId, a) {
    return [
        a.aliasId, tenantId, a.partId, a.aliasType, a.originalValue, a.normalizedValue, a.status, a.source,
        a.manufacturerId, a.effectiveFrom, a.effectiveTo, a.version, a.provenance,
        a.createdAt, a.createdBy, a.updatedAt, a.updatedBy, a.deactivatedAt, a.deactivatedBy,
    ];
}
// ─────────────────────────────── shared client-scoped primitives ───────────────────────────────
/** Read one alias by its DERIVED id, locked. Null when the identity is unclaimed. */
async function lockAlias(client, tenantId, aliasId) {
    const { rows } = await client.query(`${exports.ALIAS_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, aliasId]);
    return rows.length === 0 ? null : aliasFromRow(rows[0]);
}
async function requirePart(client, tenantId, partId) {
    const { rows } = await client.query(`SELECT 1 FROM ${SCHEMA}.parts WHERE tenant_id = $1 AND id = $2`, [tenantId, partId]);
    if (rows.length === 0)
        (0, catalogMasterKernel_js_1.refuse)("PART_NOT_FOUND", "NOT_FOUND", `no part ${partId} in this tenant`);
}
function derive(aliasType, rawValue, manufacturerId) {
    if (typeof aliasType !== "string" || !types_js_1.ALIAS_TYPES.includes(aliasType)) {
        (0, catalogMasterKernel_js_1.refuse)("ALIAS_TYPE_INVALID", "INVALID_INPUT", "aliasType is not a governed alias type");
    }
    if (typeof rawValue !== "string" || rawValue.trim() === "") {
        (0, catalogMasterKernel_js_1.refuse)("ALIAS_VALUE_REQUIRED", "INVALID_INPUT", "an alias records an identifier value");
    }
    const scope = manufacturerId === undefined || manufacturerId === null ? undefined : manufacturerId;
    if (scope !== undefined && (typeof scope !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(scope))) {
        (0, catalogMasterKernel_js_1.refuse)("MANUFACTURER_ID_INVALID", "INVALID_INPUT", "manufacturerId is not a governed reference");
    }
    // THE ONE normalization + key + encoding authority. A null answer means the value is not a
    // well-formed identifier for this type, which is a refusal rather than a stored oddity.
    const derived = (0, partAliasIdentity_js_1.deriveAliasDocId)(aliasType, rawValue, scope);
    if (derived === null) {
        (0, catalogMasterKernel_js_1.refuse)("ALIAS_VALUE_MALFORMED", "INVALID_INPUT", `the value is not a well-formed ${aliasType} identifier`);
    }
    return {
        aliasId: derived.docId, normalizedValue: derived.normalizedValue,
        aliasType: aliasType, manufacturerId: scope ?? null,
    };
}
/**
 * PRESERVE THE OLD INTERNAL PART NUMBER, inside the caller's transaction.
 *
 * This is the primitive the Part update needs and could not have. It opens no transaction and takes
 * no pool: the caller owns BEGIN and COMMIT, which is what makes "no Part update without the alias"
 * structural rather than a convention.
 *
 * BOTH identities are probed BEFORE anything is written -- the OLD number that is about to become an
 * alias, and the NEW number the Part is moving to. Either one owned by a different Part refuses the
 * WHOLE update, because an internal part number that already resolves elsewhere cannot also resolve
 * here, and discovering that after the Part row changed would leave two Parts answering to one
 * number.
 *
 * An alias that ALREADY records exactly this fact -- same identity, same Part, ACTIVE -- is left
 * untouched and reported, rather than refused. Re-running an update that renamed a Part is not a
 * collision with itself.
 */
async function aliasAuthorityPresent(client) {
    const { rows } = await client.query(`SELECT to_regclass('${SCHEMA}.part_aliases') IS NOT NULL AS present`);
    return rows[0].present === true;
}
async function preserveInternalPartNumberAlias(client, input) {
    // THE ORIGINAL REFUSAL, STILL CORRECT WHERE IT IS STILL TRUE.
    //
    // A database that has not run the catalog alias migration genuinely has no alias authority, and
    // renaming a Part there would break historical lookup exactly as before. Fail closed with the code
    // that says so, rather than letting a missing relation surface as COMMAND_FAILED -- an operator
    // reading that would look for a bug instead of a migration.
    if (!(await aliasAuthorityPresent(client))) {
        (0, catalogMasterKernel_js_1.refuse)("INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "changing internalPartNumber preserves the prior number as an alias, and eos_ops.part_aliases is not present in this database");
    }
    const previous = derive("INTERNAL_PN", input.previousInternalPartNumber, undefined);
    const next = derive("INTERNAL_PN", input.nextInternalPartNumber, undefined);
    // ---- PROBE BOTH, BEFORE ANY WRITE ----
    const existingNext = await lockAlias(client, input.tenantId, next.aliasId);
    if (existingNext !== null && existingNext.partId !== input.partId) {
        (0, catalogMasterKernel_js_1.refuse)("ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART", "CONFLICT", "the new internal part number is already an identifier for a different part");
    }
    const existingPrevious = await lockAlias(client, input.tenantId, previous.aliasId);
    if (existingPrevious !== null && existingPrevious.partId !== input.partId) {
        (0, catalogMasterKernel_js_1.refuse)("ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART", "CONFLICT", "the previous internal part number is already an identifier for a different part");
    }
    if (existingPrevious !== null) {
        if (existingPrevious.status === "ACTIVE") {
            // The fact is already recorded, truthfully, for this same Part.
            return { aliasId: previous.aliasId, created: false };
        }
        // An INACTIVE alias for this Part, holding the number we must now preserve. Reactivating it
        // silently here would be a lifecycle change nobody asked for and no audit would explain; the
        // Part update refuses instead, and a person decides.
        (0, catalogMasterKernel_js_1.refuse)("ALIAS_INACTIVE_FOR_THIS_PART", "CONFLICT", "the previous internal part number is a deactivated identifier for this part; reactivate it deliberately before renaming");
    }
    const at = (0, catalogRows_js_1.isoMicros)(input.now);
    await client.query(exports.INSERT_ALIAS_SQL, insertAliasValues(input.tenantId, {
        aliasId: previous.aliasId,
        partId: input.partId,
        aliasType: "INTERNAL_PN",
        originalValue: input.previousInternalPartNumber,
        normalizedValue: previous.normalizedValue,
        status: "ACTIVE",
        // Not "manual": nobody typed this alias. It exists because the Part was renamed, and the source
        // says so, so a person reading the row later knows why it is there.
        source: "internal-part-number-preservation",
        manufacturerId: null, effectiveFrom: null, effectiveTo: null,
        version: 1, provenance: "NATIVE",
        createdAt: at, createdBy: input.actorPrincipalId,
        updatedAt: at, updatedBy: input.actorPrincipalId,
        deactivatedAt: null, deactivatedBy: null,
    }));
    return { aliasId: previous.aliasId, created: true };
}
async function createPartAlias(deps, actor, input) {
    return (0, catalogMasterKernel_js_1.runCatalogCommand)(deps, actor, catalogMasterKernel_js_1.CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
        const envelope = (0, catalogMasterKernel_js_1.requirePlainObject)(input, "input");
        const partId = envelope.partId;
        if (typeof partId !== "string" || partId.trim() === "")
            (0, catalogMasterKernel_js_1.refuse)("PART_ID_REQUIRED", "INVALID_INPUT", "partId is required");
        const d = derive(envelope.aliasType, envelope.rawValue, envelope.manufacturerId);
        const source = typeof envelope.source === "string" && envelope.source.trim() !== "" ? envelope.source : "manual";
        const effectiveFrom = envelope.effectiveFrom === undefined || envelope.effectiveFrom === null ? null : String(envelope.effectiveFrom);
        const effectiveTo = envelope.effectiveTo === undefined || envelope.effectiveTo === null ? null : String(envelope.effectiveTo);
        if (effectiveFrom !== null && effectiveTo !== null && effectiveTo < effectiveFrom) {
            (0, catalogMasterKernel_js_1.refuse)("EFFECTIVE_RANGE_INVALID", "INVALID_INPUT", "effectiveTo must not precede effectiveFrom");
        }
        await requirePart(client, actor.tenantId, partId);
        const existing = await lockAlias(client, actor.tenantId, d.aliasId);
        if (existing !== null) {
            if (existing.partId === partId && existing.status === "ACTIVE") {
                // An equivalent ACTIVE alias for the SAME part: idempotent-equivalent success, never a
                // second row, because there cannot be a second row.
                return { result: { aliasId: d.aliasId, partId, version: existing.version, status: existing.status }, replayed: true, audit: null };
            }
            (0, catalogMasterKernel_js_1.refuse)(existing.partId === partId ? "ALIAS_INACTIVE_FOR_THIS_PART" : "ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART", "CONFLICT", existing.partId === partId
                ? "this identifier exists but is deactivated for this part; reactivate it rather than creating a second one"
                : "this identifier is already an alias of a different part");
        }
        const at = (0, catalogRows_js_1.isoMicros)(now);
        const row = {
            aliasId: d.aliasId, partId, aliasType: d.aliasType,
            originalValue: envelope.rawValue, normalizedValue: d.normalizedValue,
            status: "ACTIVE", source, manufacturerId: d.manufacturerId,
            effectiveFrom, effectiveTo, version: 1, provenance: "NATIVE",
            createdAt: at, createdBy: actor.principalId, updatedAt: at, updatedBy: actor.principalId,
            deactivatedAt: null, deactivatedBy: null,
        };
        await client.query(exports.INSERT_ALIAS_SQL, insertAliasValues(actor.tenantId, row));
        return {
            result: { aliasId: d.aliasId, partId, version: 1, status: "ACTIVE" },
            replayed: false,
            // FINGERPRINT, never the identifier. See the header.
            audit: { action: "catalog.partAlias.create", targetKind: "part_alias", targetId: d.aliasId,
                before: null, after: { partId, aliasType: d.aliasType, valueFingerprint: aliasValueFingerprint(d.normalizedValue), status: "ACTIVE" } },
        };
    });
}
async function setAliasStatus(deps, actor, input, to, action) {
    return (0, catalogMasterKernel_js_1.runCatalogCommand)(deps, actor, catalogMasterKernel_js_1.CATALOG_CAPABILITIES.PART_MANAGE, async (client, now) => {
        const envelope = (0, catalogMasterKernel_js_1.requirePlainObject)(input, "input");
        const aliasId = envelope.aliasId;
        if (typeof aliasId !== "string" || aliasId.trim() === "")
            (0, catalogMasterKernel_js_1.refuse)("ALIAS_ID_REQUIRED", "INVALID_INPUT", "aliasId is required");
        const expectedVersion = (0, catalogMasterKernel_js_1.requireExpectedVersion)(envelope.expectedVersion);
        const stored = await lockAlias(client, actor.tenantId, aliasId);
        if (stored === null)
            (0, catalogMasterKernel_js_1.refuse)("ALIAS_NOT_FOUND", "NOT_FOUND", "no such alias in this tenant");
        if (stored.version === expectedVersion + 1 && stored.status === to) {
            return { result: { aliasId, partId: stored.partId, version: stored.version, status: stored.status }, replayed: true, audit: null };
        }
        if (stored.version !== expectedVersion)
            (0, catalogMasterKernel_js_1.refuse)("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
        if (stored.status === to)
            (0, catalogMasterKernel_js_1.refuse)("NO_CHANGES", "PRECONDITION_FAILED", `the alias is already ${to}`);
        const at = (0, catalogRows_js_1.isoMicros)(now);
        const deactivating = to === "INACTIVE";
        await client.query(`UPDATE ${SCHEMA}.part_aliases
          SET status = $4, version = version + 1, updated_at = $5, updated_by = $6,
              deactivated_at = $7, deactivated_by = $8
        WHERE tenant_id = $1 AND id = $2 AND version = $3`, [actor.tenantId, aliasId, expectedVersion, to, at, actor.principalId,
            deactivating ? at : null, deactivating ? actor.principalId : null]);
        return {
            result: { aliasId, partId: stored.partId, version: stored.version + 1, status: to },
            replayed: false,
            audit: { action, targetKind: "part_alias", targetId: aliasId,
                before: { status: stored.status }, after: { status: to, valueFingerprint: aliasValueFingerprint(stored.normalizedValue) } },
        };
    });
}
const deactivatePartAlias = (deps, actor, input) => setAliasStatus(deps, actor, input, "INACTIVE", "catalog.partAlias.deactivate");
exports.deactivatePartAlias = deactivatePartAlias;
const reactivatePartAlias = (deps, actor, input) => setAliasStatus(deps, actor, input, "ACTIVE", "catalog.partAlias.reactivate");
exports.reactivatePartAlias = reactivatePartAlias;
// ─────────────────────────────── reads ───────────────────────────────
/** Alias administration for one Part. Authorized callers see the ORIGINAL value. */
async function listPartAliases(client, tenantId, partId) {
    const { rows } = await client.query(`${exports.ALIAS_SELECT} WHERE tenant_id = $1 AND part_id = $2 ORDER BY alias_type, normalized_value`, [tenantId, partId]);
    return rows.map(aliasFromRow);
}
/** Probe ONE identity. The per-type answer the scanned-identifier fan-out is built from. */
async function probePartAlias(client, tenantId, input) {
    const derived = (0, partAliasIdentity_js_1.deriveAliasDocId)(input.aliasType, input.rawValue, input.manufacturerId);
    if (derived === null)
        return { result: "MALFORMED", detail: `not a well-formed ${input.aliasType} identifier` };
    const { rows } = await client.query(`${exports.ALIAS_SELECT} WHERE tenant_id = $1 AND id = $2`, [tenantId, derived.docId]);
    if (rows.length === 0)
        return { result: "NOT_FOUND" };
    const a = aliasFromRow(rows[0]);
    return {
        result: a.status === "ACTIVE" ? "FOUND" : "INACTIVE",
        partId: a.partId, aliasType: a.aliasType, aliasId: a.aliasId,
    };
}
/** The scanner's question, answered through the SHARED pure fan-out. */
async function resolveScannedPartIdentifier(client, tenantId, input) {
    return (0, partAliasScanCore_js_1.resolveScannedIdentifierWith)((probe) => probePartAlias(client, tenantId, probe), input);
}
exports.ALIAS_STATUS_VOCABULARY = types_js_1.ALIAS_STATUSES;
//# sourceMappingURL=postgresPartAliasWriter.js.map