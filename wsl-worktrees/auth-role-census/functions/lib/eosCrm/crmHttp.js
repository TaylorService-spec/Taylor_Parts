"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CRM_BODY_BYTES = exports.STATUS_BY_CATEGORY = exports.isCrmOperation = exports.CRM_OPERATIONS = exports.CRM_ROUTE = void 0;
exports.executeCrmOperation = executeCrmOperation;
exports.handleCrmRequest = handleCrmRequest;
exports.createCrmHttpHandler = createCrmHttpHandler;
const capabilityAuthority_1 = require("../eosOps/capabilityAuthority");
const principalContext_1 = require("../adminPolicy/principalContext");
const crmAuthorityKernel_1 = require("./crmAuthorityKernel");
const accountAuthority_1 = require("./accountAuthority");
const contactAuthority_1 = require("./contactAuthority");
const accountLocationAuthority_1 = require("./accountLocationAuthority");
const crmWriterState_1 = require("../crm/crmWriterState");
exports.CRM_ROUTE = "/crm/customer";
const RUNNERS = Object.freeze({
    createAccount: accountAuthority_1.createAccount, updateAccount: accountAuthority_1.updateAccount, getAccount: accountAuthority_1.getAccount, listAccounts: accountAuthority_1.listAccounts, listAccountOwnershipHistory: accountAuthority_1.listAccountOwnershipHistory,
    createContact: contactAuthority_1.createContact, importAccountContacts: contactAuthority_1.importAccountContacts, updateContact: contactAuthority_1.updateContact, getContact: contactAuthority_1.getContact, listAccountContacts: contactAuthority_1.listAccountContacts,
    createAccountLocation: accountLocationAuthority_1.createAccountLocation, updateAccountLocation: accountLocationAuthority_1.updateAccountLocation, getAccountLocation: accountLocationAuthority_1.getAccountLocation, listAccountLocations: accountLocationAuthority_1.listAccountLocations,
});
exports.CRM_OPERATIONS = Object.freeze(Object.keys(RUNNERS));
const isCrmOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(RUNNERS, name);
exports.isCrmOperation = isCrmOperation;
exports.STATUS_BY_CATEGORY = Object.freeze({
    INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403, UNAVAILABLE: 503, FAILED: 500,
});
/** Execute one named CRM operation for an already-verified caller. */
async function executeCrmOperation(deps, request) {
    const { operation } = request;
    try {
        (0, crmWriterState_1.assertPostgresCrmWriterActive)(`crm.transport.${operation}`, deps.writerAuthority ?? crmWriterState_1.CRM_WRITER_AUTHORITY);
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
        const run = RUNNERS[operation];
        return { ok: true, operation, result: await run({ pool: deps.pool }, actor, request.input) };
    }
    catch (err) {
        if (err instanceof crmWriterState_1.PostgresCrmWriterInactiveError) {
            return { ok: false, operation, code: err.code, message: "the PostgreSQL CRM authority is not active yet; the CRM cutover has not completed", status: 503 };
        }
        if (err instanceof principalContext_1.PrincipalContextError)
            return { ok: false, operation, code: "FORBIDDEN", message: err.refusal, status: 403 };
        if (err instanceof crmAuthorityKernel_1.CrmAuthorityError) {
            return {
                ok: false, operation, code: err.code, message: err.message, status: exports.STATUS_BY_CATEGORY[err.category] ?? 500,
                ...(err.findings ? { findings: err.findings } : {}),
            };
        }
        // eslint-disable-next-line no-console -- same posture as the sibling transports' unhandled-error log
        console.error("[crmHttp] unhandled", err);
        return { ok: false, operation, code: "INTERNAL", message: "the request could not be completed", status: 500 };
    }
}
exports.MAX_CRM_BODY_BYTES = 1_000_000;
const baseHeaders = (origin) => ({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
});
const json = (status, body, origin) => ({ status, headers: baseHeaders(origin), body: JSON.stringify(body) });
const failure = (status, operation, code, message, origin, findings) => json(status, { ok: false, operation, code, message, ...(findings ? { findings } : {}) }, origin);
/**
 *   POST    /crm/customer   { "operation": <closed name>, "input": { ... } }. Authenticated.
 *   OPTIONS /crm/customer   CORS preflight.
 */
async function handleCrmRequest(options, request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = pathOf(request.url ?? "/");
    const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));
    if (path !== exports.CRM_ROUTE)
        return failure(404, "", "UNKNOWN_OPERATION", "no such CRM route", origin);
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
    if (typeof request.body === "string" && Buffer.byteLength(request.body, "utf8") > exports.MAX_CRM_BODY_BYTES) {
        return failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", origin);
    }
    let envelope;
    try {
        envelope = parseEnvelope(request.body);
    }
    catch {
        return failure(400, "", "INVALID_INPUT", "body must be a JSON object", origin);
    }
    if (Object.keys(envelope).some((k) => k !== "operation" && k !== "input")) {
        return failure(400, String(envelope.operation ?? ""), "INVALID_INPUT", "the envelope accepts only operation and input", origin);
    }
    const operation = envelope.operation;
    if (!(0, exports.isCrmOperation)(operation))
        return failure(404, typeof operation === "string" ? operation : "", "UNKNOWN_OPERATION", "no such CRM operation", origin);
    const input = envelope.input === undefined && operation === "listAccounts" ? {} : envelope.input;
    if (!input || typeof input !== "object" || Array.isArray(input))
        return failure(400, operation, "INVALID_INPUT", "input must be a JSON object", origin);
    const stated = crmAuthorityKernel_1.CALLER_AUTHORITY_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(input, f));
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
    const result = await executeCrmOperation(options, {
        caller: { externalSubject: identity.externalSubject, identityProvider: identity.identityProvider, requestedTenantId: singleHeader(header(request, "x-eos-tenant")) },
        operation,
        input: input,
    });
    if (result.ok)
        return json(200, result, origin);
    return failure(result.status, result.operation, result.code, result.message, origin, result.findings);
}
/** Adapt the pure handler onto node:http, matching the sibling transports' adapters. */
function createCrmHttpHandler(options) {
    return async function nodeHandler(req, res) {
        let response;
        try {
            const body = await readBody(req);
            response = body === null
                ? failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", resolveOrigin(options.allowedOrigins, req.headers.origin))
                : await handleCrmRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
        }
        catch (err) {
            console.error("[crmHttp] unhandled", err);
            response = failure(500, "", "INTERNAL", "the request could not be completed", null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let total = 0;
        let tooLarge = false;
        const chunks = [];
        req.on("data", (chunk) => {
            total += chunk.length;
            if (total > exports.MAX_CRM_BODY_BYTES) {
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
    return origin !== "*" && allowed.includes(origin) ? origin : null;
}
//# sourceMappingURL=crmHttp.js.map