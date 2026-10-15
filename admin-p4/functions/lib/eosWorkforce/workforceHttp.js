"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_WORKFORCE_BODY_BYTES = exports.STATUS_BY_CATEGORY = exports.AUTHORITY_BEARING_FIELDS = exports.WORKFORCE_OPTIONAL_INPUT_OPERATIONS = exports.isWorkforceOperation = exports.WORKFORCE_COMMAND_OPERATIONS = exports.WORKFORCE_READ_OPERATIONS = exports.WORKFORCE_ROUTE = void 0;
exports.executeWorkforceOperation = executeWorkforceOperation;
exports.handleWorkforceRequest = handleWorkforceRequest;
exports.createWorkforceHttpHandler = createWorkforceHttpHandler;
const requestText_1 = require("../adminPolicy/requestText");
const capabilityAuthority_1 = require("../eosOps/capabilityAuthority");
const entitledActionAuthority_1 = require("../eosOps/entitledActionAuthority");
const principalContext_1 = require("../adminPolicy/principalContext");
const employeeReadKernel_1 = require("./reads/employeeReadKernel");
const myEmployeeProfile_1 = require("./reads/myEmployeeProfile");
const myWorkforceCapabilities_1 = require("./reads/myWorkforceCapabilities");
const employeeResponsibilityReads_1 = require("./reads/employeeResponsibilityReads");
const employeeDirectoryReads_1 = require("./reads/employeeDirectoryReads");
const workforceRoster_1 = require("../eosAdministration/workforceRoster");
const assignedWorkReads_1 = require("./reads/assignedWorkReads");
const employeePrincipalLinkRead_1 = require("./reads/employeePrincipalLinkRead");
const employeeCommandKernel_1 = require("./commands/employeeCommandKernel");
const employeeProfileCommand_1 = require("./commands/employeeProfileCommand");
const reportingRelationshipCommands_1 = require("./commands/reportingRelationshipCommands");
const employeeEditCommand_1 = require("./commands/employeeEditCommand");
const employeeLifecycleCommand_1 = require("./commands/employeeLifecycleCommand");
const employeeCreationCommand_1 = require("./commands/employeeCreationCommand");
const employeePrincipalLinkCommands_1 = require("./commands/employeePrincipalLinkCommands");
const employeeJobRoleCommands_1 = require("./commands/employeeJobRoleCommands");
const jobRoleReads_1 = require("./reads/jobRoleReads");
const employeeChangeHistoryRead_1 = require("./reads/employeeChangeHistoryRead");
const employeeWorkEligibilityCommands_1 = require("./commands/employeeWorkEligibilityCommands");
const employeeOperationalScopeCommands_1 = require("./commands/employeeOperationalScopeCommands");
const workEligibilityReads_1 = require("./reads/workEligibilityReads");
const operationalScopeReads_1 = require("./reads/operationalScopeReads");
const employeeFunctionalRoleCommands_1 = require("./commands/employeeFunctionalRoleCommands");
const functionalRoleReads_1 = require("./reads/functionalRoleReads");
const assignableEmployeeReads_1 = require("./reads/assignableEmployeeReads");
exports.WORKFORCE_ROUTE = "/workforce/employees";
const read = (fn) => (deps, actor, input) => fn({ pool: deps.pool }, actor, input);
/** The same pool-only adapter, named for what it composes: a governed command owns its transaction, never the transport. */
const command = read;
// ════════════════════ the closed operation list (reads only) ════════════════════
const READ_RUNNERS = Object.freeze({
    readMyEmployeeProfile: read(myEmployeeProfile_1.readMyEmployeeProfile),
    readMyWorkforceCapabilities: read(myWorkforceCapabilities_1.readMyWorkforceCapabilities),
    readEmployee: read(employeeDirectoryReads_1.readEmployee),
    listEmployees: read(employeeDirectoryReads_1.listEmployees),
    readEmployeePrincipalLink: read(employeePrincipalLinkRead_1.readEmployeePrincipalLink),
    listManagedEmployees: read(employeeDirectoryReads_1.listManagedEmployees),
    listRecordsOwnedByEmployee: read(employeeResponsibilityReads_1.listRecordsOwnedByEmployee),
    listAccountabilitiesForEmployee: read(employeeResponsibilityReads_1.listAccountabilitiesForEmployee),
    listJobRoles: read(jobRoleReads_1.listJobRoles),
    listEmployeeJobRoleHistory: read(jobRoleReads_1.listEmployeeJobRoleHistory),
    listEmployeesWithoutJobRole: read(jobRoleReads_1.listEmployeesWithoutJobRole),
    listEmployeeChangeHistory: read(employeeChangeHistoryRead_1.listEmployeeChangeHistory),
    listEmployeeWorkEligibility: read(workEligibilityReads_1.listEmployeeWorkEligibility),
    listEmployeeWorkEligibilityHistory: read(workEligibilityReads_1.listEmployeeWorkEligibilityHistory),
    listEmployeeOperationalScopes: read(operationalScopeReads_1.listEmployeeOperationalScopes),
    listEmployeeOperationalScopeHistory: read(operationalScopeReads_1.listEmployeeOperationalScopeHistory),
    // Lane GA: the governed values the Operational Scope picker offers (warehouses; reorder-queue company keys).
    listOperationalScopeTargets: read(operationalScopeReads_1.listOperationalScopeTargets),
    listAssignableEmployees: read(assignableEmployeeReads_1.listAssignableEmployees),
    // Functional Role (migration 1762819200000): employee.record.read, like the Job Role and Work Eligibility reads.
    listFunctionalRoles: read(functionalRoleReads_1.listFunctionalRoles),
    listFunctionalRoleHolders: read(functionalRoleReads_1.listFunctionalRoleHolders),
    listEmployeeFunctionalRoles: read(functionalRoleReads_1.listEmployeeFunctionalRoles),
    listFunctionalRoleHistory: read(functionalRoleReads_1.listFunctionalRoleHistory),
    // Administration control plane (#210): the workforce roster -- Job Role, Security Roles (admin.principalAccess.read only),
    // scopes, eligibility and manager per Employee, filterable; employee.record.read.
    listWorkforceRoster: read(workforceRoster_1.listWorkforceRoster),
    // EMP-RT-05 (#210): CURRENT work assigned to an Employee -- served now that assignment authority is in PostgreSQL.
    listAssignedWorkForEmployee: read(assignedWorkReads_1.listAssignedWorkForEmployee),
});
// ════════════════════ the closed operation list (commands) ════════════════════
const COMMAND_RUNNERS = Object.freeze({
    updateEmployeeProfile: command(employeeProfileCommand_1.updateEmployeeProfile),
    establishReportingRelationship: command(reportingRelationshipCommands_1.establishReportingRelationship),
    endReportingRelationship: command(reportingRelationshipCommands_1.endReportingRelationship),
    saveEmployeeEdit: command(employeeEditCommand_1.saveEmployeeEdit),
    changeEmploymentStatus: command(employeeLifecycleCommand_1.changeEmploymentStatus),
    changeOperatingCompany: command(employeeLifecycleCommand_1.changeOperatingCompany),
    createJobRole: command(employeeJobRoleCommands_1.createJobRole),
    updateJobRole: command(employeeJobRoleCommands_1.updateJobRole),
    assignEmployeeJobRole: command(employeeJobRoleCommands_1.assignEmployeeJobRole),
    assignEmployeeWorkEligibility: command(employeeWorkEligibilityCommands_1.assignEmployeeWorkEligibility),
    endEmployeeWorkEligibility: command(employeeWorkEligibilityCommands_1.endEmployeeWorkEligibility),
    assignEmployeeOperationalScope: command(employeeOperationalScopeCommands_1.assignEmployeeOperationalScope),
    endEmployeeOperationalScope: command(employeeOperationalScopeCommands_1.endEmployeeOperationalScope),
    createEmployee: command(employeeCreationCommand_1.createEmployee),
    linkEmployeePrincipal: command(employeePrincipalLinkCommands_1.linkEmployeePrincipal),
    unlinkEmployeePrincipal: command(employeePrincipalLinkCommands_1.unlinkEmployeePrincipal),
    relinkEmployeePrincipal: command(employeePrincipalLinkCommands_1.relinkEmployeePrincipal),
    // Functional Role: admin.employeeFunctionalRole.write, each under the tenant governance lock.
    createFunctionalRole: command(employeeFunctionalRoleCommands_1.createFunctionalRole),
    updateFunctionalRoleMetadata: command(employeeFunctionalRoleCommands_1.updateFunctionalRoleMetadata),
    setFunctionalRoleStatus: command(employeeFunctionalRoleCommands_1.setFunctionalRoleStatus),
    assignEmployeeFunctionalRole: command(employeeFunctionalRoleCommands_1.assignEmployeeFunctionalRole),
    endEmployeeFunctionalRoleAssignment: command(employeeFunctionalRoleCommands_1.endEmployeeFunctionalRoleAssignment),
});
const RUNNERS = Object.freeze({ ...READ_RUNNERS, ...COMMAND_RUNNERS });
exports.WORKFORCE_READ_OPERATIONS = Object.freeze(Object.keys(READ_RUNNERS));
exports.WORKFORCE_COMMAND_OPERATIONS = Object.freeze(Object.keys(COMMAND_RUNNERS));
const isWorkforceOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(RUNNERS, name);
exports.isWorkforceOperation = isWorkforceOperation;
/** The ONLY operations whose `input` may be omitted: the two self reads (no input at all) and the unfiltered directory. */
exports.WORKFORCE_OPTIONAL_INPUT_OPERATIONS = Object.freeze(["readMyEmployeeProfile", "readMyWorkforceCapabilities", "listEmployees", "listWorkforceRoster"]);
const OPTIONAL_INPUT = new Set(exports.WORKFORCE_OPTIONAL_INPUT_OPERATIONS);
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
    FAILED: 500,
});
/**
 * Execute one named Workforce read for an already-verified caller. An unknown, disabled or non-member Principal
 * refuses FORBIDDEN through resolveOperationalContext's own errors; it is never downgraded to an empty context.
 */
async function executeWorkforceOperation(deps, request) {
    const { operation } = request;
    try {
        const input = {
            identityProvider: request.caller.identityProvider,
            externalSubject: request.caller.externalSubject,
            requestedTenantId: request.caller.requestedTenantId,
        };
        // DEFAULT: conditions from PostgreSQL, resolved LAZILY -- a request whose kernel refuses on the
        // flat capability set first reads no condition. "POSTGRES" keeps the eager composition
        // (resolveEntitledOperationalContext); "SHIPPED" the empty in-code catalog.
        const ctx = deps.grantConditionSource === undefined
            ? await (0, capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, input, (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool))
            : await (deps.grantConditionSource === "POSTGRES"
                ? entitledActionAuthority_1.resolveEntitledOperationalContext : capabilityAuthority_1.resolveOperationalContext)(deps.reader, deps.pool, input);
        const actor = Object.freeze({
            tenantId: ctx.principalContext.tenantId,
            principalId: ctx.principalContext.uid,
            capabilities: ctx.capabilities,
            conditionallyHeld: ctx.conditionallyHeld,
            // Scope-qualified holdings (lane SC): honoured ONLY by a read that decides each Employee by its operating
            // company; every other gate site ignores them and refuses a scoped-only caller exactly as before.
            scopedHeld: ctx.scopedHeld,
            // The conditional-entitlement obligation, as the REQUIRED request-scoped resolver
            // resolveOperationalContext built for this request. The same actor serves the read kernel and
            // the command kernel, and the resolver memoizes, so both gate sites -- and a read requiring
            // several capabilities -- reach a per-GRANT decision on ONE resolution of the stores. A
            // request whose gate sites never ask resolves nothing at all.
            entitlements: ctx.entitlements,
        });
        return { ok: true, operation, result: await RUNNERS[operation](deps, actor, request.input) };
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError) {
            return { ok: false, operation, code: "FORBIDDEN", message: err.refusal, status: 403 };
        }
        if (err instanceof employeeReadKernel_1.EmployeeReadError || err instanceof employeeCommandKernel_1.EmployeeCommandError) {
            return { ok: false, operation, code: err.code, message: err.message, status: exports.STATUS_BY_CATEGORY[err.category] ?? 500 };
        }
        // eslint-disable-next-line no-console -- same posture as the sibling transports' unhandled-error log
        console.error("[workforceHttp] unhandled", err);
        return { ok: false, operation, code: "INTERNAL", message: "the request could not be completed", status: 500 };
    }
}
exports.MAX_WORKFORCE_BODY_BYTES = 1_000_000;
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
 *   POST    /workforce/employees   { "operation": <closed name>, "input": { ... } }. Authenticated.
 *   OPTIONS /workforce/employees   CORS preflight.
 */
async function handleWorkforceRequest(options, request) {
    const method = (request.method ?? "GET").toUpperCase();
    const path = pathOf(request.url ?? "/");
    const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));
    if (path !== exports.WORKFORCE_ROUTE)
        return failure(404, "", "UNKNOWN_OPERATION", "no such Workforce route", origin);
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
    if (typeof request.body === "string" && Buffer.byteLength(request.body, "utf8") > exports.MAX_WORKFORCE_BODY_BYTES) {
        return failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", origin);
    }
    let envelope;
    try {
        envelope = parseEnvelope(request.body);
    }
    catch {
        return failure(400, "", "INVALID_INPUT", "body must be a JSON object", origin);
    }
    // U+0000 is refused at the envelope, before identity or any query (adminPolicy/requestText.ts; Controller XLF-002).
    if ((0, requestText_1.containsNulCharacter)(envelope)) {
        return failure(400, typeof envelope.operation === "string" ? envelope.operation : "", "INVALID_INPUT", requestText_1.NUL_CHARACTER_REFUSAL, origin);
    }
    const extra = Object.keys(envelope).filter((k) => k !== "operation" && k !== "input");
    if (extra.length > 0)
        return failure(400, String(envelope.operation ?? ""), "INVALID_INPUT", "the envelope accepts only operation and input", origin);
    const operation = envelope.operation;
    if (!(0, exports.isWorkforceOperation)(operation))
        return failure(404, typeof operation === "string" ? operation : "", "UNKNOWN_OPERATION", "no such Workforce operation", origin);
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
    const result = await executeWorkforceOperation(options, {
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
function createWorkforceHttpHandler(options) {
    return async function nodeHandler(req, res) {
        let response;
        try {
            const body = await readBody(req);
            response = body === null
                ? failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", resolveOrigin(options.allowedOrigins, req.headers.origin))
                : await handleWorkforceRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
        }
        catch (err) {
            console.error("[workforceHttp] unhandled", err);
            response = failure(500, "", "INTERNAL", "the request could not be completed", null);
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
    };
}
// ════════════════════ small helpers (mirrors commercialHttp.ts) ════════════════════
/** Resolves null once the body exceeds the limit; the rest of the stream is drained, not buffered. */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let total = 0;
        let tooLarge = false;
        const chunks = [];
        req.on("data", (chunk) => {
            total += chunk.length;
            if (total > exports.MAX_WORKFORCE_BODY_BYTES) {
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
//# sourceMappingURL=workforceHttp.js.map