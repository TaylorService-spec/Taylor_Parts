"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOperationsOperation = exports.OPERATIONS_READ_OPERATIONS = void 0;
exports.executeOperation = executeOperation;
exports.handleOperationsRequest = handleOperationsRequest;
exports.createOperationsHttpHandler = createOperationsHttpHandler;
// The HTTP transport for the trusted Operations API — domain-separated from Administration.
//
// ════════════════════ WHY A SEPARATE TRANSPORT, NOT A THIRD adminPolicy OPERATION ════════════════════
//
// `adminPolicyApi.ts`'s closed operation lists (`ADMIN_READ_OPERATIONS` / `ADMIN_MUTATION_OPERATIONS`)
// are the Administration domain's list -- Objects, Fields, Roles, permissions, Workflows. An
// operational command like "resolve my Cycle Count capabilities" is not an Administration act, and
// putting it on that list would blur the one property that makes the closed list meaningful: that
// every entry on it names a governed Administration operation. A SECOND closed list, for a SECOND
// domain, keeps both lists meaning exactly what they say.
//
// ════════════════════ THE SHAPE IS DELIBERATELY IDENTICAL TO adminPolicyHttp.ts ════════════════════
//
// Same rule: this file is a TRANSPORT. It verifies identity, resolves the operational context, hands
// one named operation to `executeOperation`, and writes the result. No SQL, no policy decision that
// belongs to a command, and it must not grow either.
//
// There is deliberately no `POST /sql`, no `mutate(table, id, patch)`, no Firestore proxy, and no
// route that takes a table name.
const capabilityAuthority_1 = require("./capabilityAuthority");
const principalContext_1 = require("../adminPolicy/principalContext");
// ════════════════════ the closed operation list ════════════════════
//
// ONE operation in this P0: a bounded, non-mutating capability read. It proves the full path --
// HTTP -> identity verification -> EOS principal/tenant resolution -> Postgres capability
// authorization -- without wiring a mutating Cycle Count command end to end, which the Owner ruling
// explicitly does not require of this PR.
exports.OPERATIONS_READ_OPERATIONS = Object.freeze(["resolveMyCapabilities"]);
const READS = new Set(exports.OPERATIONS_READ_OPERATIONS);
const isOperationsOperation = (name) => typeof name === "string" && READS.has(name);
exports.isOperationsOperation = isOperationsOperation;
/**
 * Execute one named operational read.
 *
 * `resolveMyCapabilities` never throws for "authenticated but holds nothing" -- it returns an empty
 * list, which is the honest answer for a caller with no qualifying Role. It DOES fail closed for an
 * unknown principal, a disabled principal, no tenant membership, or an ambiguous tenant, by letting
 * `PrincipalContextError` surface as FORBIDDEN.
 */
async function executeOperation(deps, request) {
    try {
        switch (request.operation) {
            case "resolveMyCapabilities": {
                const ctx = await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, {
                    identityProvider: request.caller.identityProvider,
                    externalSubject: request.caller.externalSubject,
                    requestedTenantId: request.caller.requestedTenantId,
                });
                return {
                    ok: true,
                    operation: "resolveMyCapabilities",
                    result: {
                        tenantId: ctx.principalContext.tenantId,
                        uid: ctx.principalContext.uid,
                        heldRoleKeys: ctx.principalContext.heldRoleKeys,
                        capabilities: [...ctx.capabilities].sort(),
                    },
                };
            }
            default:
                return { ok: false, operation: request.operation, code: "UNKNOWN_OPERATION", message: "no such Operations operation" };
        }
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError) {
            return { ok: false, operation: request.operation, code: "FORBIDDEN", message: err.refusal };
        }
        // eslint-disable-next-line no-console -- same posture as adminPolicyHttp.ts's unhandled-error log
        console.error("[eosOpsHttp] unhandled", err);
        return { ok: false, operation: request.operation, code: "INTERNAL", message: "the request could not be completed" };
    }
}
const STATUS_BY_CODE = Object.freeze({
    UNKNOWN_OPERATION: 404,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    INVALID_INPUT: 400,
    INTERNAL: 500,
});
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
/**
 * Handle one request.
 *
 *   POST /operations/inventory   one named operation from the closed list above. Authenticated.
 *   OPTIONS *                    CORS preflight.
 *
 * There is no `/health` here -- `/health` is process-wide and already served by adminPolicyHttp's
 * handler in server.ts; this transport answers only its own route.
 */
async function handleOperationsRequest(options, request) {
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
    if (path !== "/operations/inventory")
        return json(404, notFound(path), origin);
    if (method !== "POST")
        return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);
    let payload;
    try {
        payload = parseBody(request.body);
    }
    catch {
        return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
    }
    const operation = payload.operation;
    if (!(0, exports.isOperationsOperation)(operation))
        return json(404, notFound(String(operation ?? "")), origin);
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
    const result = await executeOperation(options, {
        caller: {
            externalSubject: identity.externalSubject,
            identityProvider: identity.identityProvider,
            requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
        },
        operation,
    });
    if (result.ok)
        return json(200, result, origin);
    return json(STATUS_BY_CODE[result.code] ?? 500, result, origin);
}
/** Adapt the pure handler onto node:http, matching adminPolicyHttp.ts's own adapter. */
function createOperationsHttpHandler(options) {
    return async function nodeHandler(req, res) {
        const body = await readBody(req);
        let response;
        try {
            response = await handleOperationsRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
        }
        catch (err) {
            console.error("[eosOpsHttp] unhandled", err);
            response = json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
// ════════════════════ small helpers (mirrors adminPolicyHttp.ts) ════════════════════
const MAX_BODY_BYTES = 1_000_000;
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
function parseBody(body) {
    if (!body || body.trim().length === 0)
        return {};
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
    return allowed.includes(origin) ? origin : null;
}
const notFound = (what) => ({ ok: false, operation: what, code: "UNKNOWN_OPERATION", message: "no such Operations operation" });
//# sourceMappingURL=eosOpsHttp.js.map