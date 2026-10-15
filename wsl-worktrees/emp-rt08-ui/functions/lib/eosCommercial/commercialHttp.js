"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_COMMERCIAL_BODY_BYTES = exports.STATUS_BY_CATEGORY = exports.AUTHORITY_BEARING_FIELDS = exports.COMMERCIAL_OPTIONAL_INPUT_OPERATIONS = exports.isCommercialOperation = exports.COMMERCIAL_MUTATION_OPERATIONS = exports.COMMERCIAL_READ_OPERATIONS = exports.COMMERCIAL_ROUTE = void 0;
exports.executeCommercialOperation = executeCommercialOperation;
exports.handleCommercialRequest = handleCommercialRequest;
exports.createCommercialHttpHandler = createCommercialHttpHandler;
const capabilityAuthority_1 = require("../eosOps/capabilityAuthority");
const principalContext_1 = require("../adminPolicy/principalContext");
const commercialCommandKernel_1 = require("./commands/commercialCommandKernel");
const opportunityCommandService_1 = require("./commands/opportunityCommandService");
const salesAgreementCommandService_1 = require("./commands/salesAgreementCommandService");
const salesOrderCommandService_1 = require("./commands/salesOrderCommandService");
const accountCommercialProjection_1 = require("./reads/accountCommercialProjection");
const opportunityReadProjection_1 = require("./reads/opportunityReadProjection");
const salesAgreementReadProjection_1 = require("./reads/salesAgreementReadProjection");
const salesOrderReadProjection_1 = require("./reads/salesOrderReadProjection");
exports.COMMERCIAL_ROUTE = "/commercial/sales";
const command = (fn) => (deps, actor, input) => fn({ pool: deps.pool, catalog: deps.catalog, now: deps.now }, actor, input);
const read = (fn) => (deps, actor, input) => fn({ pool: deps.pool }, actor, input);
// ════════════════════ the closed operation lists ════════════════════
const READ_RUNNERS = Object.freeze({
    getOpportunityDetail: read(opportunityReadProjection_1.getOpportunityDetail),
    listOpportunities: read(opportunityReadProjection_1.listOpportunities),
    getSalesAgreementDetail: read(salesAgreementReadProjection_1.getSalesAgreementDetail),
    listSalesAgreements: read(salesAgreementReadProjection_1.listSalesAgreements),
    getSalesOrderDetail: read(salesOrderReadProjection_1.getSalesOrderDetail),
    listSalesOrders: read(salesOrderReadProjection_1.listSalesOrders),
    getAccountCommercialProjection: read(accountCommercialProjection_1.getAccountCommercialProjection),
});
const MUTATION_RUNNERS = Object.freeze({
    createOpportunity: command(opportunityCommandService_1.createOpportunity),
    updateOpportunity: command(opportunityCommandService_1.updateOpportunity),
    transitionOpportunity: command(opportunityCommandService_1.transitionOpportunity),
    closeOpportunityAsWon: command(opportunityCommandService_1.closeOpportunityAsWon),
    createSalesAgreement: command(salesAgreementCommandService_1.createSalesAgreement),
    updateSalesAgreementDraft: command(salesAgreementCommandService_1.updateSalesAgreementDraft),
    acceptSalesAgreement: command(salesAgreementCommandService_1.acceptSalesAgreement),
    createSalesOrder: command(salesOrderCommandService_1.createSalesOrder),
    createSalesOrderFromOpportunity: command(salesOrderCommandService_1.createSalesOrderFromOpportunity),
    transitionSalesOrder: command(salesOrderCommandService_1.transitionSalesOrder),
});
exports.COMMERCIAL_READ_OPERATIONS = Object.freeze(Object.keys(READ_RUNNERS));
exports.COMMERCIAL_MUTATION_OPERATIONS = Object.freeze(Object.keys(MUTATION_RUNNERS));
const RUNNERS = Object.freeze({ ...READ_RUNNERS, ...MUTATION_RUNNERS });
const isCommercialOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(RUNNERS, name);
exports.isCommercialOperation = isCommercialOperation;
/**
 * The ONLY operations whose `input` may be omitted: the unfiltered list reads, whose C3 signatures take an optional input.
 * Every detail read, the Account projection and every mutation requires `input` to be present as an object.
 */
exports.COMMERCIAL_OPTIONAL_INPUT_OPERATIONS = Object.freeze(["listOpportunities", "listSalesAgreements", "listSalesOrders"]);
const OPTIONAL_INPUT = new Set(exports.COMMERCIAL_OPTIONAL_INPUT_OPERATIONS);
/** Fields that would state authority. Authority comes from the verified subject and PostgreSQL, never from the body. */
exports.AUTHORITY_BEARING_FIELDS = Object.freeze([
    "tenantId", "principalId", "capabilities", "externalSubject", "identityProvider", "uid", "heldRoleKeys", "roles",
    "securityRole", "jobRole",
]);
exports.STATUS_BY_CATEGORY = Object.freeze({
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    PRECONDITION_FAILED: 412,
    CONFLICT: 409,
    FORBIDDEN: 403,
    UNAVAILABLE: 503,
    FAILED: 500,
});
/**
 * Execute one named Commercial operation for an already-verified caller.
 *
 * An unknown, disabled or non-member Principal refuses FORBIDDEN through resolveOperationalContext's own errors; it is
 * never downgraded to an empty authority context. A Principal that resolves with no Commercial capability reaches the
 * operation, which refuses CAPABILITY_REQUIRED itself.
 */
async function executeCommercialOperation(deps, request) {
    const { operation } = request;
    try {
        const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
            identityProvider: request.caller.identityProvider,
            externalSubject: request.caller.externalSubject,
            requestedTenantId: request.caller.requestedTenantId,
        });
        const actor = Object.freeze({
            tenantId: ctx.principalContext.tenantId,
            principalId: ctx.principalContext.uid,
            capabilities: ctx.capabilities,
        });
        return { ok: true, operation, result: await RUNNERS[operation](deps, actor, request.input) };
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError) {
            return { ok: false, operation, code: "FORBIDDEN", message: err.refusal, status: 403 };
        }
        if (err instanceof commercialCommandKernel_1.CommercialCommandError) {
            return { ok: false, operation, code: err.code, message: err.message, status: exports.STATUS_BY_CATEGORY[err.category] ?? 500 };
        }
        // eslint-disable-next-line no-console -- same posture as the sibling transports' unhandled-error log
        console.error("[commercialHttp] unhandled", err);
        return { ok: false, operation, code: "INTERNAL", message: "the request could not be completed", status: 500 };
    }
}
exports.MAX_COMMERCIAL_BODY_BYTES = 1_000_000;
function baseHeaders(origin) {
    return {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    };
}
const json = (status, body, origin) => ({ status, headers: baseHeaders(origin), body: JSON.stringify(body) });
const failure = (status, operation, code, message, origin) => json(status, { ok: false, operation, code, message }, origin);
/**
 *   POST    /commercial/sales   { "operation": <closed name>, "input": { ... } }. Authenticated.
 *   OPTIONS /commercial/sales   CORS preflight.
 */
async function handleCommercialRequest(options, request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = pathOf(request.url ?? "/");
    const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));
    if (path !== exports.COMMERCIAL_ROUTE)
        return failure(404, "", "UNKNOWN_OPERATION", "no such Commercial route", origin);
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
    if (method !== "POST")
        return failure(405, "", "METHOD_NOT_ALLOWED", "use POST", origin);
    if (typeof request.body === "string" && Buffer.byteLength(request.body, "utf8") > exports.MAX_COMMERCIAL_BODY_BYTES) {
        return failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", origin);
    }
    let envelope;
    try {
        envelope = parseEnvelope(request.body);
    }
    catch {
        return failure(400, "", "INVALID_INPUT", "body must be a JSON object", origin);
    }
    const extra = Object.keys(envelope).filter((k) => k !== "operation" && k !== "input");
    if (extra.length > 0)
        return failure(400, String(envelope.operation ?? ""), "INVALID_INPUT", "the envelope accepts only operation and input", origin);
    const operation = envelope.operation;
    if (!(0, exports.isCommercialOperation)(operation))
        return failure(404, typeof operation === "string" ? operation : "", "UNKNOWN_OPERATION", "no such Commercial operation", origin);
    if (envelope.input === undefined && !OPTIONAL_INPUT.has(operation)) {
        return failure(400, operation, "INVALID_INPUT", "input is required for this operation", origin);
    }
    const input = envelope.input === undefined ? {} : envelope.input;
    if (!input || typeof input !== "object" || Array.isArray(input))
        return failure(400, operation, "INVALID_INPUT", "input must be a JSON object", origin);
    const stated = exports.AUTHORITY_BEARING_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(input, f));
    if (stated.length > 0) {
        return failure(400, operation, "AUTHORITY_FIELD_NOT_ACCEPTED", `authority is resolved from the verified caller, never supplied: ${stated.join(", ")}`, origin);
    }
    const bearer = bearerToken(header(request, "authorization"));
    if (!bearer)
        return failure(401, operation, "UNAUTHENTICATED", "a bearer token is required", origin);
    let identity;
    try {
        identity = await options.verifyToken(bearer);
    }
    catch {
        return failure(401, operation, "UNAUTHENTICATED", "the token could not be verified", origin);
    }
    const result = await executeCommercialOperation(options, {
        caller: {
            externalSubject: identity.externalSubject,
            identityProvider: identity.identityProvider,
            requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
        },
        operation,
        input: input,
    });
    if (result.ok)
        return json(200, result, origin);
    return failure(result.status, result.operation, result.code, result.message, origin);
}
/** Adapt the pure handler onto node:http, matching the sibling transports' adapters. */
function createCommercialHttpHandler(options) {
    return async function nodeHandler(req, res) {
        let response;
        try {
            const body = await readBody(req);
            response = body === null
                ? failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", resolveOrigin(options.allowedOrigins, req.headers.origin))
                : await handleCommercialRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
        }
        catch (err) {
            console.error("[commercialHttp] unhandled", err);
            response = failure(500, "", "INTERNAL", "the request could not be completed", null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
// ════════════════════ small helpers (mirrors eosOpsHttp.ts) ════════════════════
/** Resolves null once the body exceeds the limit; the rest of the stream is drained, not buffered. */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let total = 0;
        let tooLarge = false;
        const chunks = [];
        req.on("data", (chunk) => {
            total += chunk.length;
            if (total > exports.MAX_COMMERCIAL_BODY_BYTES) {
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            if (!tooLarge)
                chunks.push(chunk);
        });
        req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
function parseEnvelope(body) {
    if (!body || body.trim().length === 0)
        throw new Error("empty");
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
    return parsed;
}
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
    // A wildcard is never an origin grant, even if configuration somehow carried one.
    return origin !== "*" && allowed.includes(origin) ? origin : null;
}
//# sourceMappingURL=commercialHttp.js.map