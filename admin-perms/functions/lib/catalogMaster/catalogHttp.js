"use strict";
// THE GOVERNED RENDER CATALOG API.
//
//   Vercel UI  ->  Render EOS API  ->  PostgreSQL Catalog authority
//
// ONE route with an operation discriminator, exactly as `/operations/inventory` already does. A
// route per table would put the shape of the database in the URL space and make every future schema
// change a public API change; the discriminator keeps the contract about BUSINESS OPERATIONS.
//
// ════════════════════ IDENTITY ════════════════════
//
//   external authenticated identity -> EOS Principal -> tenant membership -> effective capability
//
// `resolveOperationalContext` performs all four, and `principalContext.uid` IS the EOS Principal id.
// NO Firebase uid becomes the Catalog actor: the commands take `principalId`, every actor column
// carries it, and a uid never reaches this layer as anything but a token subject to be resolved.
//
// ════════════════════ READS ARE BOUNDED ════════════════════
//
// There is deliberately no "list every Part" operation. The Firestore client reads the whole
// collection from six surfaces; re-exposing that as an HTTP endpoint would move the defect rather
// than remove it. `searchParts` is a bounded, searchable, keyset-paged answer and its limit is
// CLAMPED rather than trusted, so an unbounded read is not reachable through this API at all.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG_ROUTE = exports.isCatalogOperation = exports.CATALOG_MUTATION_OPERATIONS = exports.SCANNER_PART_FIELDS = exports.CATALOG_ALIAS_READ_CAPABILITY = exports.CATALOG_READ_REQUIREMENTS = exports.CATALOG_READ_CAPABILITY = exports.CATALOG_READ_OPERATIONS = void 0;
exports.executeCatalogOperation = executeCatalogOperation;
exports.handleCatalogRequest = handleCatalogRequest;
exports.createCatalogHttpHandler = createCatalogHttpHandler;
const capabilityAuthority_1 = require("../eosOps/capabilityAuthority");
const principalContext_1 = require("../adminPolicy/principalContext");
const requestText_1 = require("../adminPolicy/requestText");
const catalogMasterKernel_js_1 = require("./catalogMasterKernel.js");
const catalogWriterState_js_1 = require("./catalogWriterState.js");
const postgresPartMasterWriter_js_1 = require("./postgresPartMasterWriter.js");
const postgresPartAliasWriter_js_1 = require("./postgresPartAliasWriter.js");
const postgresCatalogReads_js_1 = require("./postgresCatalogReads.js");
/** Reads: bounded by construction. Nothing here can return the whole catalogue. */
exports.CATALOG_READ_OPERATIONS = Object.freeze([
    "readPart",
    "readPartsByIds",
    "searchParts",
    "countParts",
    "listPartAliases",
    "probePartAlias",
    "lookupScannedPart",
    "listEquipmentModels",
]);
// ════════════════════ EVERY READ IS CAPABILITY-GATED, SERVER-SIDE (DQ-031) ════════════════════
//
// Tenant membership alone is NOT authority to read the Catalog, and a screen hiding a control is not
// authorization. Every read names the capabilities it requires here, and the transport refuses a caller who
// does not hold ALL of them before a connection is taken for the read. `inventory.catalog.read` is the
// existing, registered key ("may this principal read the product catalog") -- no new capability.
//
// The alias reads keep the ADDITIONAL predicate their legacy callable always enforced, because a migration
// read must not be wider than the path it replaces (a dropped predicate is a parity defect, not a
// simplification):
//   listPartAliases / probePartAlias   legacy listPartAliasesCallable / probePartAliasCallable required
//                                      inventory.catalog.manage (identifier ADMINISTRATION reads).
//   lookupScannedPart                  the scanner's ONE Part read (Controller OD-T6, 2026-10-01), in the legacy
//                                      callable's contract { parts, alias, aliasDenied }: the catalogue half
//                                      (the <=3 Parts the scan names by id) needs inventory.catalog.read; the
//                                      ALIAS half additionally needs inventory.catalog.alias.read, exactly as the
//                                      legacy lookupScannedPart enforced it -- without it the alias half is not
//                                      run and `aliasDenied` says so. Never wider than the legacy path.
exports.CATALOG_READ_CAPABILITY = "inventory.catalog.read";
exports.CATALOG_READ_REQUIREMENTS = Object.freeze({
    readPart: [exports.CATALOG_READ_CAPABILITY],
    readPartsByIds: [exports.CATALOG_READ_CAPABILITY],
    searchParts: [exports.CATALOG_READ_CAPABILITY],
    countParts: [exports.CATALOG_READ_CAPABILITY],
    listEquipmentModels: [exports.CATALOG_READ_CAPABILITY],
    listPartAliases: [exports.CATALOG_READ_CAPABILITY, "inventory.catalog.manage"],
    probePartAlias: [exports.CATALOG_READ_CAPABILITY, "inventory.catalog.manage"],
    lookupScannedPart: [exports.CATALOG_READ_CAPABILITY],
});
/** OD-T6: the resolve-only right the alias half of the scanner lookup requires (registered in PostgreSQL 2026-10-01). */
exports.CATALOG_ALIAS_READ_CAPABILITY = "inventory.catalog.alias.read";
/** Catalogue fields a scanner may see -- exactly what the client's toPartView reads (legacy SCANNER_PART_FIELDS). */
exports.SCANNER_PART_FIELDS = Object.freeze([
    "partId", "internalPartNumber", "name", "description", "category", "status", "stockingUnit",
    "controlType", "stockingClass", "primaryManufacturerId", "primaryManufacturerPartNumber", "oemStatus", "version",
]);
const SCANNER_MAX_RAW = 256;
const SCANNER_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Writes: the governed Part and alias commands, each with its own capability check. */
exports.CATALOG_MUTATION_OPERATIONS = Object.freeze([
    "createPart",
    "updatePart",
    "changePartStatus",
    "createPartAlias",
    "deactivatePartAlias",
    "reactivatePartAlias",
]);
const READS = new Set(exports.CATALOG_READ_OPERATIONS);
const MUTATIONS = new Set(exports.CATALOG_MUTATION_OPERATIONS);
const isCatalogOperation = (name) => typeof name === "string" && (READS.has(name) || MUTATIONS.has(name));
exports.isCatalogOperation = isCatalogOperation;
exports.CATALOG_ROUTE = "/operations/catalog";
/**
 * The governed search filters a caller may state -- the SAME set for a page and for its count.
 *
 * Only the named keys are carried, so nothing else a body happens to contain reaches the query; their
 * VALUES are validated by postgresCatalogReads, which refuses anything outside the governed enums.
 */
function searchFilters(input) {
    return {
        query: input.query,
        status: input.status,
        statuses: input.statuses,
        stockingClass: input.stockingClass,
        stockingClasses: input.stockingClasses,
        controlType: input.controlType,
        wholeUnit: input.wholeUnit,
    };
}
/**
 * Execute one named Catalog operation.
 *
 * The actor is resolved ONCE per request, the same way every other EOS operation resolves one. A WRITE's
 * capability check lives in its command, so the transport never makes a second decision about it. A READ
 * is a bare SQL projection with no command around it, so its capability requirement
 * (CATALOG_READ_REQUIREMENTS) is decided HERE, once, before the read runs.
 */
async function executeCatalogOperation(deps, request) {
    const input = request.input ?? {};
    try {
        // FIRST ACT: the PostgreSQL Catalog authority must be ACTIVE (the activation window's step 18). Before that, the
        // transport answers nothing -- not a read of a not-yet-copied catalogue, and certainly not a write.
        (0, catalogWriterState_js_1.assertPostgresCatalogActive)(`catalog.transport.${request.operation}`, deps.writerAuthority ?? catalogWriterState_js_1.CATALOG_WRITER_AUTHORITY);
        // SECOND ACT (DQ-034): a MUTATION is refused while the compatibility hold exists -- before identity resolution,
        // before a connection is taken, before any write. The hold is the committed constant; there is no dep, flag or
        // input that lifts it.
        if (MUTATIONS.has(request.operation))
            (0, catalogWriterState_js_1.assertCatalogMutationNotHeld)(`catalog.transport.${request.operation}`);
        const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
            identityProvider: request.caller.identityProvider,
            externalSubject: request.caller.externalSubject,
            requestedTenantId: request.caller.requestedTenantId,
        });
        // THE EOS PRINCIPAL. Never the Firebase uid the token happened to carry.
        const actor = {
            tenantId: ctx.principalContext.tenantId,
            principalId: ctx.principalContext.uid,
            capabilities: new Set(ctx.capabilities),
        };
        // DQ-031: a READ is refused unless the resolved Principal holds every capability it requires. Writes are
        // checked by their command (runCatalogCommand), so a write is not double-decided here.
        if (READS.has(request.operation)) {
            const required = exports.CATALOG_READ_REQUIREMENTS[request.operation];
            const missing = required.filter((k) => !actor.capabilities.has(k));
            if (missing.length > 0) {
                return {
                    ok: false, operation: request.operation, code: "FORBIDDEN",
                    message: `reading the Catalog requires ${missing.join(" and ")}`,
                };
            }
        }
        const commandDeps = { pool: deps.pool };
        const ok = (result) => ({ ok: true, operation: request.operation, result });
        const withClient = async (fn) => {
            const c = await deps.pool.connect();
            try {
                return await fn(c);
            }
            finally {
                c.release();
            }
        };
        const str = (v) => (typeof v === "string" ? v : "");
        switch (request.operation) {
            // ---- READS ----
            case "readPart":
                return ok(await withClient((c) => (0, postgresCatalogReads_js_1.readPart)(c, actor.tenantId, str(input.partId))));
            case "readPartsByIds":
                return ok(await withClient((c) => (0, postgresCatalogReads_js_1.readPartsByIds)(c, actor.tenantId, Array.isArray(input.partIds) ? input.partIds : [])));
            case "searchParts":
                // PASSED THROUGH, NOT FILTERED BY TYPE HERE. The read validates every value against the
                // governed vocabulary and REFUSES what it does not recognise; dropping a malformed filter at
                // the transport would answer a narrower question with a broader list and say nothing.
                return ok(await withClient((c) => (0, postgresCatalogReads_js_1.searchParts)(c, actor.tenantId, {
                    ...searchFilters(input),
                    limit: typeof input.limit === "number" ? input.limit : undefined,
                    cursor: input.cursor,
                    sort: input.sort,
                })));
            case "countParts":
                return ok(await withClient((c) => (0, postgresCatalogReads_js_1.countParts)(c, actor.tenantId, searchFilters(input))));
            case "listPartAliases":
                return ok(await withClient((c) => (0, postgresPartAliasWriter_js_1.listPartAliases)(c, actor.tenantId, str(input.partId))));
            case "probePartAlias":
                return ok(await withClient((c) => (0, postgresPartAliasWriter_js_1.probePartAlias)(c, actor.tenantId, {
                    aliasType: input.aliasType,
                    rawValue: str(input.rawValue),
                    ...(typeof input.manufacturerId === "string" ? { manufacturerId: input.manufacturerId } : {}),
                })));
            case "lookupScannedPart": {
                // The legacy request contract: { rawValue, partCode? } and nothing else.
                if (Object.keys(input).some((k) => k !== "rawValue" && k !== "partCode")) {
                    return { ok: false, operation: request.operation, code: "INVALID_INPUT", message: "lookupScannedPart accepts rawValue and partCode only" };
                }
                const rawValue = str(input.rawValue);
                if (rawValue.trim() === "" || rawValue.length > SCANNER_MAX_RAW) {
                    return { ok: false, operation: request.operation, code: "INVALID_INPUT", message: `rawValue is a non-empty string of at most ${SCANNER_MAX_RAW} characters` };
                }
                const partCode = typeof input.partCode === "string" && SCANNER_SAFE_ID.test(input.partCode.trim()) ? input.partCode.trim() : null;
                const aliasAllowed = actor.capabilities.has(exports.CATALOG_ALIAS_READ_CAPABILITY);
                return ok(await withClient(async (c) => {
                    const alias = aliasAllowed ? await (0, postgresPartAliasWriter_js_1.resolveScannedPartIdentifier)(c, actor.tenantId, { rawValue }) : null;
                    const ids = new Set();
                    if (partCode) {
                        ids.add(partCode);
                        ids.add(partCode.toUpperCase());
                    }
                    if (alias && alias.result === "FOUND")
                        ids.add(alias.partId);
                    const parts = (await (0, postgresCatalogReads_js_1.readPartsByIds)(c, actor.tenantId, [...ids])).map((p) => {
                        const src = { ...p, partId: p.id };
                        const data = {};
                        for (const k of exports.SCANNER_PART_FIELDS)
                            if (src[k] !== undefined)
                                data[k] = src[k];
                        return { id: p.id, data };
                    });
                    return { parts, alias, aliasDenied: !aliasAllowed };
                }));
            }
            case "listEquipmentModels":
                // DQ-030: the Sales Agreement Equipment Model picker. Bounded; see postgresCatalogReads.
                return ok(await withClient((c) => (0, postgresCatalogReads_js_1.listEquipmentModels)(c, actor.tenantId, {
                    limit: typeof input.limit === "number" ? input.limit : undefined,
                    cursor: input.cursor,
                })));
            // ---- WRITES ----
            case "createPart":
                return ok(await (0, postgresPartMasterWriter_js_1.createPart)(commandDeps, actor, { part: input.part }));
            case "updatePart":
                return ok(await (0, postgresPartMasterWriter_js_1.updatePart)(commandDeps, actor, {
                    partId: input.partId, expectedVersion: input.expectedVersion, changes: input.changes,
                }));
            case "changePartStatus":
                return ok(await (0, postgresPartMasterWriter_js_1.changePartStatus)(commandDeps, actor, {
                    partId: input.partId, expectedVersion: input.expectedVersion, newStatus: input.newStatus ?? input.status,
                }));
            case "createPartAlias":
                return ok(await (0, postgresPartAliasWriter_js_1.createPartAlias)(commandDeps, actor, {
                    partId: input.partId, aliasType: input.aliasType, rawValue: input.rawValue,
                    source: input.source, manufacturerId: input.manufacturerId,
                    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
                }));
            case "deactivatePartAlias":
                return ok(await (0, postgresPartAliasWriter_js_1.deactivatePartAlias)(commandDeps, actor, { aliasId: input.aliasId, expectedVersion: input.expectedVersion }));
            case "reactivatePartAlias":
                return ok(await (0, postgresPartAliasWriter_js_1.reactivatePartAlias)(commandDeps, actor, { aliasId: input.aliasId, expectedVersion: input.expectedVersion }));
            default:
                return { ok: false, operation: request.operation, code: "UNKNOWN_OPERATION", message: "no such Catalog operation" };
        }
    }
    catch (err) {
        if (err instanceof catalogWriterState_js_1.CatalogMutationHeldError) {
            return { ok: false, operation: request.operation, code: "CATALOG_MUTATION_HELD", message: err.message };
        }
        if (err instanceof catalogWriterState_js_1.PostgresCatalogWriterInactiveError) {
            return { ok: false, operation: request.operation, code: "PRECONDITION_FAILED", message: err.message };
        }
        if (err instanceof principalContext_1.PrincipalContextError) {
            return { ok: false, operation: request.operation, code: "FORBIDDEN", message: err.refusal };
        }
        // A governed refusal is the ANSWER, not a failure: the caller is told which rule refused them,
        // with the command's own category preserved rather than flattened to 500.
        if (err instanceof catalogMasterKernel_js_1.CatalogMasterError) {
            const code = err.category === "FAILED" ? "INTERNAL" : err.category;
            return { ok: false, operation: request.operation, code, message: err.message };
        }
        return { ok: false, operation: request.operation, code: "INTERNAL", message: "the operation could not be completed" };
    }
}
const STATUS_BY_CODE = Object.freeze({
    UNKNOWN_OPERATION: 404,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INVALID_INPUT: 400,
    PRECONDITION_FAILED: 412,
    // A standing system precondition (the DQ-034 hold), the same status the not-yet-active transport answers with; never
    // 409, which the clients read as an optimistic-concurrency conflict on the record.
    CATALOG_MUTATION_HELD: 412,
    CONFLICT: 409,
    UNAVAILABLE: 503,
    INTERNAL: 500,
});
const MAX_BODY_BYTES = 1_000_000;
function baseHeaders(origin) {
    return {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    };
}
const json = (status, body, origin) => ({
    status, headers: baseHeaders(origin), body: JSON.stringify(body),
});
const header = (req, name) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
const singleHeader = (value) => {
    if (Array.isArray(value))
        return value[0] ?? null;
    return typeof value === "string" && value.length > 0 ? value : null;
};
function bearerToken(value) {
    const raw = singleHeader(value);
    if (!raw)
        return null;
    const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
    return match ? match[1].trim() : null;
}
function pathOf(url) {
    const idx = url.indexOf("?");
    const path = idx >= 0 ? url.slice(0, idx) : url;
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
function resolveOrigin(allowed, value) {
    const origin = singleHeader(value);
    if (!origin || !allowed || allowed.length === 0)
        return null;
    return allowed.includes(origin) ? origin : null;
}
function parseBody(body) {
    if (!body || body.trim().length === 0)
        return {};
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
    return parsed;
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error("request body too large"));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
/**
 * Handle one request.
 *
 *   POST /operations/catalog   one named operation from the closed lists above. Authenticated.
 *   OPTIONS *                  CORS preflight.
 *
 * `/health` is process-wide and served by the Administration handler; this transport answers only
 * its own route.
 */
async function handleCatalogRequest(options, request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = pathOf(request.url ?? "/");
    const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));
    if (method === "OPTIONS") {
        return {
            status: 204,
            headers: {
                ...baseHeaders(origin),
                "access-control-allow-methods": "POST, OPTIONS",
                "access-control-allow-headers": "authorization, content-type, x-eos-tenant",
                "access-control-max-age": "600",
            },
            body: "",
        };
    }
    if (path !== exports.CATALOG_ROUTE) {
        return json(404, { ok: false, operation: path, code: "UNKNOWN_OPERATION", message: "no such Catalog route" }, origin);
    }
    if (method !== "POST")
        return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);
    let payload;
    try {
        payload = parseBody(request.body);
    }
    catch {
        return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
    }
    // U+0000 is refused at the envelope, before identity or any query (adminPolicy/requestText.ts; Controller XLF-002).
    if ((0, requestText_1.containsNulCharacter)(payload)) {
        return json(400, { ok: false, operation: typeof payload.operation === "string" ? payload.operation : "", code: "INVALID_INPUT", message: requestText_1.NUL_CHARACTER_REFUSAL }, origin);
    }
    const operation = payload.operation;
    if (!(0, exports.isCatalogOperation)(operation)) {
        return json(404, { ok: false, operation: String(operation ?? ""), code: "UNKNOWN_OPERATION", message: "no such Catalog operation" }, origin);
    }
    // AUTHENTICATION BEFORE ANYTHING ELSE. A caller with no token learns which operations exist and
    // nothing more, and no database connection is taken on their behalf.
    const bearer = bearerToken(header(request, "authorization"));
    if (!bearer) {
        return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
    }
    let identity;
    try {
        identity = await options.verifyToken(bearer);
    }
    catch {
        return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
    }
    const result = await executeCatalogOperation(options, {
        caller: {
            externalSubject: identity.externalSubject,
            identityProvider: identity.identityProvider,
            // STATED, never adopted: the server checks it against membership.
            requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
        },
        operation,
        input: payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
            ? payload.input
            : {},
    });
    if (result.ok)
        return json(200, result, origin);
    return json(STATUS_BY_CODE[result.code] ?? 500, result, origin);
}
/** Adapt the pure handler onto node:http, matching every other EOS transport's adapter. */
function createCatalogHttpHandler(options) {
    return async function nodeHandler(req, res) {
        const body = await readBody(req);
        let response;
        try {
            response = await handleCatalogRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
        }
        catch (err) {
            console.error("[catalogHttp] unhandled", err);
            response = json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
//# sourceMappingURL=catalogHttp.js.map