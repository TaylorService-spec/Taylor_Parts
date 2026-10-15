"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAdminRequest = handleAdminRequest;
exports.createAdminPolicyHttpHandler = createAdminPolicyHttpHandler;
// The HTTP transport for the trusted Administration API.
//
// ════════════════════ WHAT THIS FILE IS, AND IS NOT ════════════════════
//
// It is a TRANSPORT: it reads a request, establishes who is calling, hands one named operation to
// `executeAdminOperation`, and writes the result. It contains no policy, no authorization decision
// and no SQL, and it must not grow any -- the moment a transport starts deciding things, there are
// two authorization models and only one of them is tested.
//
// It is not a framework. `node:http` is enough for a handful of routes, and the directive against
// introducing a large framework where a small abstraction works applies exactly here.
//
// ════════════════════ IDENTITY IS INJECTED, DELIBERATELY ════════════════════
//
// `verifyToken` is a parameter. This file therefore does not import firebase-admin -- which is not
// a stylistic preference: the policy subsystem's Firebase regression guard is a STATIC check over
// this directory, and it should stay absolute. The concrete verifier lives outside, in the service
// entry point, so replacing the identity provider later is a change in one small file that this one
// never learns about.
//
// The verifier returns a SUBJECT and nothing else that matters. No claim it carries is read as
// authority: not a custom claim, not a role, not a tenant. Those come from the policy database.
const adminPolicyApi_1 = require("./adminPolicyApi");
const STATUS_BY_CODE = Object.freeze({
    UNKNOWN_OPERATION: 404,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL: 500,
});
/** Every response, including errors, carries these. */
function baseHeaders(origin) {
    return {
        "content-type": "application/json; charset=utf-8",
        // The API returns policy configuration. Nothing about it should be cached by a browser or an
        // intermediary, least of all after a mutation.
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    };
}
const json = (status, body, origin) => ({
    status,
    headers: baseHeaders(origin),
    body: JSON.stringify(body),
});
/**
 * Handle one request.
 *
 * ROUTES, and there are only three:
 *
 *   GET  /health              liveness and database readiness. No authentication, no policy data.
 *   POST /admin/policy        one named operation. Authenticated.
 *   OPTIONS *                 CORS preflight.
 *
 * There is deliberately no route that takes a table name, a SQL fragment or a generic patch.
 */
async function handleAdminRequest(options, request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = pathOf(request.url ?? "/");
    const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));
    if (method === "OPTIONS") {
        return {
            status: 204,
            headers: {
                ...baseHeaders(origin),
                "access-control-allow-methods": "POST, GET, OPTIONS",
                "access-control-allow-headers": "authorization, content-type, x-eos-tenant",
                "access-control-max-age": "600",
            },
            body: "",
        };
    }
    if (path === "/health" && method === "GET") {
        // No authentication and no policy content: a health probe that required a token would be
        // useless to the platform that has to decide whether to route traffic here.
        const health = options.health ? await options.health() : {};
        const ok = health.reachable !== false;
        return json(ok ? 200 : 503, { ok, ...health }, origin);
    }
    if (path !== "/admin/policy")
        return json(404, notFound(path), origin);
    if (method !== "POST") {
        // POST for reads too. A read takes structured input and must never be cached or land in a
        // browser history or a proxy log, all of which a GET with a query string invites.
        return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);
    }
    let payload;
    try {
        payload = parseBody(request.body);
    }
    catch {
        return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
    }
    const operation = payload.operation;
    if (!(0, adminPolicyApi_1.isAdminOperation)(operation)) {
        return json(404, notFound(String(operation ?? "")), origin);
    }
    const bearer = bearerToken(header(request, "authorization"));
    if (!bearer) {
        return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "a bearer token is required" }, origin);
    }
    let identity;
    try {
        identity = await options.verifyToken(bearer);
    }
    catch {
        // The verifier's own error text can name a project, a key id or an expiry; none of it helps a
        // caller and some of it helps an attacker.
        return json(401, { ok: false, operation, code: "UNAUTHENTICATED", message: "the token could not be verified" }, origin);
    }
    const result = await (0, adminPolicyApi_1.executeAdminOperation)(options, {
        caller: {
            externalSubject: identity.externalSubject,
            identityProvider: identity.identityProvider,
            // A HEADER, not a body field, and it is still only a preference: the API checks it against
            // membership and refuses rather than adopting it. Carried separately so it is obvious in a
            // log which tenant a caller CLAIMED versus which one it got.
            requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
        },
        operation,
        input: asObject(payload.input),
        requestId: singleHeader(header(request, "x-request-id")) ?? undefined,
    });
    if (result.ok) {
        // 201 for a create, 200 for everything else -- including a mutation that was idempotent.
        const created = (0, adminPolicyApi_1.isMutation)(result.operation) && /^create/.test(result.operation);
        return json(created ? 201 : 200, result, origin);
    }
    return json(STATUS_BY_CODE[result.code] ?? 500, result, origin);
}
/** Adapt the pure handler onto node:http. The only place a stream is read. */
function createAdminPolicyHttpHandler(options) {
    return async function nodeHandler(req, res) {
        const body = await readBody(req);
        let response;
        try {
            response = await handleAdminRequest(options, {
                method: req.method,
                url: req.url,
                headers: req.headers,
                body,
            });
        }
        catch (err) {
            // A throw here is a defect in the transport, not a refusal. It is logged in full and reported
            // opaquely -- the same rule the API uses for INTERNAL.
            console.error("[adminPolicyHttp] unhandled", err);
            response = json(500, { ok: false, code: "INTERNAL", message: "the request could not be completed" }, null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
// ════════════════════ small helpers ════════════════════
/** BODY SIZE IS BOUNDED. An unbounded read is a memory exhaustion an unauthenticated caller can trigger. */
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
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
/** An origin is echoed only if it is on the list. Never `*`, and never the caller's own value unchecked. */
function resolveOrigin(allowed, value) {
    const origin = singleHeader(value);
    if (!origin || !allowed || allowed.length === 0)
        return null;
    return allowed.includes(origin) ? origin : null;
}
const notFound = (what) => ({
    ok: false,
    operation: what,
    code: "UNKNOWN_OPERATION",
    message: "no such Administration operation",
});
//# sourceMappingURL=adminPolicyHttp.js.map