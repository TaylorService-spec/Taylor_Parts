"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSelfSchedulingRequest = handleSelfSchedulingRequest;
exports.createSelfSchedulingHttpHandler = createSelfSchedulingHttpHandler;
const requestText_1 = require("../adminPolicy/requestText");
const workOrderWriterState_1 = require("./workOrderWriterState");
const selfScheduling_1 = require("./selfScheduling");
const STATUS_BY_CATEGORY = Object.freeze({
    INVALID_INPUT: 400, NOT_FOUND: 404, PRECONDITION_FAILED: 412, CONFLICT: 409, FORBIDDEN: 403, UNAVAILABLE: 503,
});
/** A link that WAS valid and no longer is: 410, so a page can say "ask for a new link" rather than "try again". */
const GONE_CODES = new Set(["SESSION_EXPIRED", "SESSION_REVOKED", "SESSION_AUTHORITY_WITHDRAWN"]);
function headers(origin) {
    return {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    };
}
const json = (status, body, origin) => ({ status, headers: headers(origin), body: JSON.stringify(body) });
function originOf(allowed, value) {
    const origin = Array.isArray(value) ? value[0] : value;
    if (!origin || !allowed || allowed.length === 0)
        return null;
    return allowed.includes(origin) ? origin : null;
}
async function handleSelfSchedulingRequest(options, request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = (request.url ?? "/").split("?")[0].replace(/\/$/, "");
    const origin = originOf(options.allowedOrigins, request.headers?.origin);
    if (method === "OPTIONS") {
        return { status: 204, headers: { ...headers(origin), "access-control-allow-methods": "POST, OPTIONS",
                "access-control-allow-headers": "content-type", "access-control-max-age": "600" }, body: "" };
    }
    if (path !== selfScheduling_1.SELF_SCHEDULING_ROUTE)
        return json(404, { ok: false, code: "UNKNOWN_OPERATION", message: "no such route" }, origin);
    if (method !== "POST")
        return json(405, { ok: false, code: "UNKNOWN_OPERATION", message: "use POST" }, origin);
    let payload;
    try {
        const parsed = request.body && request.body.trim() ? JSON.parse(request.body) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("not an object");
        payload = parsed;
    }
    catch {
        return json(400, { ok: false, code: "INVALID_INPUT", message: "body must be a JSON object" }, origin);
    }
    if ((0, requestText_1.containsNulCharacter)(payload))
        return json(400, { ok: false, code: "INVALID_INPUT", message: requestText_1.NUL_CHARACTER_REFUSAL }, origin);
    const operation = payload.operation;
    if (operation !== "readSchedulingOffer" && operation !== "selectSchedulingSlot") {
        return json(404, { ok: false, operation: String(operation ?? ""), code: "UNKNOWN_OPERATION", message: "no such operation" }, origin);
    }
    const state = options.workOrderPostgresState ?? workOrderWriterState_1.WORK_ORDER_WRITER_AUTHORITY.postgres;
    if (state !== "ACTIVE")
        return json(503, { ok: false, operation, code: "NOT_ACTIVATED", message: "online scheduling is not available yet" }, origin);
    const input = payload.input === undefined ? {} : payload.input;
    try {
        const result = operation === "readSchedulingOffer"
            ? await (0, selfScheduling_1.readSchedulingOffer)({ pool: options.pool, now: options.now }, input)
            : await (0, selfScheduling_1.selectSchedulingSlot)({ pool: options.pool, reader: options.reader, now: options.now }, input);
        return json(200, { ok: true, operation, result }, origin);
    }
    catch (err) {
        const e = err;
        if (e?.name === "WorkOrderLifecycleError" || e?.name === "WorkOrderAssignmentError") {
            const status = GONE_CODES.has(e.code ?? "") ? 410 : STATUS_BY_CATEGORY[e.category ?? ""] ?? 500;
            return json(status, { ok: false, operation, code: e.code, message: e.message, ...(e.refreshed ? { refreshed: e.refreshed } : {}) }, origin);
        }
        // eslint-disable-next-line no-console -- never the token; the error class only
        console.error("[selfScheduling] unhandled", e?.name ?? "error");
        return json(500, { ok: false, operation, code: "INTERNAL", message: "the request could not be completed" }, origin);
    }
}
const MAX_BODY_BYTES = 16_384;
function createSelfSchedulingHttpHandler(options) {
    return async function nodeHandler(req, res) {
        let response;
        try {
            const body = await new Promise((resolve, reject) => {
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
            response = await handleSelfSchedulingRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
        }
        catch {
            response = json(400, { ok: false, code: "INVALID_INPUT", message: "the request could not be read" }, null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
//# sourceMappingURL=selfSchedulingHttp.js.map