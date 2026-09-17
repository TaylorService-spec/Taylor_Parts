// The HTTP transport for the governed PostgreSQL Employee (Workforce) reads and the governed Employee commands (EMP-RT-W1B).
// Domain-separated from Administration, Operations and Commercial, and modelled exactly on commercialHttp.ts.
//
// ════════════════════ A TRANSPORT, AND ONLY A TRANSPORT ════════════════════
//
//   bearer token -> injected TokenVerifier (external subject + provider, nothing else)
//               -> resolveOperationalContext (EOS Principal, ACTIVE tenant membership, qualifying Roles,
//                  eos_policy.role_capabilities) -- the SAME resolver the Operations and Commercial transports use
//               -> the resolved actor { tenantId, principalId = EOS Principal id, capabilities }
//               -> ONE operation from the closed lists below -> a safe HTTP response
//
// No SQL, no capability policy and no Employee rule lives here. Reads call eosWorkforce/reads; the three commands call
// the internal governed commands in eosWorkforce/commands, which own their own capability check, transaction and audit.
// The external subject is used ONLY to resolve the Principal and is never handed to a read, so no Employee can be
// matched by it.
//
// Firebase is TRANSITIONAL IDENTITY ONLY and never imported here: the verifier is injected, and server.ts is the only
// concrete composition. The requested tenant arrives ONLY as the x-eos-tenant header, which resolveOperationalContext
// checks against membership and never adopts; a tenant, principal, capability or identity field in the body refuses.
//
// ════════════════════ WHAT IS SERVED, AND WHAT IS NOT ════════════════════
//
//   EMP-RT-07 readMyEmployeeProfile           Own Employee via the governed link; no capability beyond an active
//                                             Principal + membership + exactly one active link. No selector.
//   EMP-RT-01 readEmployee / listEmployees    employee.record.read. Business record + bounded directory; no Principal,
//                                             provider, Role or account status.
//   EMP-RT-02 readEmployeePrincipalLink       admin.principalAccess.read (Owner ruling B).
//   EMP-RT-03 listRecordsOwnedByEmployee      the Commercial families, gated by each family's read capability.
//   EMP-RT-04 listAccountabilitiesForEmployee the Commercial families, gated by each family's read capability.
//   EMP-RT-06 listManagedEmployees            employee.record.read over eos_workforce.employee_reporting_relationships.
//   EMP-RT-05 listAssignedWorkForEmployee     NOT SERVED -- ASSIGNMENT_AUTHORITY_NOT_IN_POSTGRES (held, Owner ruling H).
//   EMP-RT-08 listJobRoles / listEmployeeJobRoleHistory / listEmployeesWithoutJobRole   employee.record.read.
//   EMP-RT-08 createJobRole / updateJobRole / assignEmployeeJobRole                      admin.employeeJobRole.write.
//             A Job Role is a business function only: no Security Role, permission, ownership, assignment,
//             reporting or operating-company authority is read or written by these operations.
//   EMP-RT-W1B updateEmployeeProfile          admin.employeeProfile.write. The 17 profile facts only (W1A command).
//   EMP-RT-W1B establishReportingRelationship admin.employeeProfile.write. Reporting relationship, history kept.
//   EMP-RT-W1B endReportingRelationship       admin.employeeProfile.write.
//   EMP-RT-W1C saveEmployeeEdit               admin.employeeProfile.write. ONLY a Save changing profile AND manager:
//                                             both in one transaction, or neither.
//   EMP-RT-W2  changeEmploymentStatus         admin.employeeProfile.write. Allowed transitions only.
//   EMP-RT-W2  changeOperatingCompany         admin.employeeProfile.write. A known, active operating company only.
// User Access, Security Roles and Job Roles are NOT served.
// An unserved name is an ordinary unknown operation (404); nothing is stubbed.
import type { Pool } from "pg";
import { resolveOperationalContext } from "../eosOps/capabilityAuthority";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { EmployeeReadError, type EmployeeReadActor, type EmployeeReadErrorCategory } from "./reads/employeeReadKernel";
import { readMyEmployeeProfile } from "./reads/myEmployeeProfile";
import { listAccountabilitiesForEmployee, listRecordsOwnedByEmployee } from "./reads/employeeResponsibilityReads";
import { listEmployees, listManagedEmployees, readEmployee } from "./reads/employeeDirectoryReads";
import { readEmployeePrincipalLink } from "./reads/employeePrincipalLinkRead";
import { EmployeeCommandError } from "./commands/employeeCommandKernel";
import { updateEmployeeProfile } from "./commands/employeeProfileCommand";
import { endReportingRelationship, establishReportingRelationship } from "./commands/reportingRelationshipCommands";
import { saveEmployeeEdit } from "./commands/employeeEditCommand";
import { changeEmploymentStatus, changeOperatingCompany } from "./commands/employeeLifecycleCommand";
import { assignEmployeeJobRole, createJobRole, updateJobRole } from "./commands/employeeJobRoleCommands";
import { listEmployeeJobRoleHistory, listEmployeesWithoutJobRole, listJobRoles } from "./reads/jobRoleReads";

export interface VerifiedIdentity {
  readonly externalSubject: string;
  readonly identityProvider: string;
}
export type TokenVerifier = (bearerToken: string) => Promise<VerifiedIdentity>;

export const WORKFORCE_ROUTE = "/workforce/employees";

export interface WorkforceApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
}

type Input = Record<string, unknown>;
type Runner = (deps: WorkforceApiDeps, actor: EmployeeReadActor, input: Input) => Promise<unknown>;
const read = (fn: (d: { pool: Pool }, a: EmployeeReadActor, i: Input) => Promise<unknown>): Runner =>
  (deps, actor, input) => fn({ pool: deps.pool }, actor, input);
/** The same pool-only adapter, named for what it composes: a governed command owns its transaction, never the transport. */
const command = read;

// ════════════════════ the closed operation list (reads only) ════════════════════

const READ_RUNNERS = Object.freeze({
  readMyEmployeeProfile: read(readMyEmployeeProfile),
  readEmployee: read(readEmployee),
  listEmployees: read(listEmployees),
  readEmployeePrincipalLink: read(readEmployeePrincipalLink),
  listManagedEmployees: read(listManagedEmployees),
  listRecordsOwnedByEmployee: read(listRecordsOwnedByEmployee),
  listAccountabilitiesForEmployee: read(listAccountabilitiesForEmployee),
  listJobRoles: read(listJobRoles),
  listEmployeeJobRoleHistory: read(listEmployeeJobRoleHistory),
  listEmployeesWithoutJobRole: read(listEmployeesWithoutJobRole),
} as const);

// ════════════════════ the closed operation list (commands) ════════════════════

const COMMAND_RUNNERS = Object.freeze({
  updateEmployeeProfile: command(updateEmployeeProfile),
  establishReportingRelationship: command(establishReportingRelationship),
  endReportingRelationship: command(endReportingRelationship),
  saveEmployeeEdit: command(saveEmployeeEdit),
  changeEmploymentStatus: command(changeEmploymentStatus),
  changeOperatingCompany: command(changeOperatingCompany),
  createJobRole: command(createJobRole),
  updateJobRole: command(updateJobRole),
  assignEmployeeJobRole: command(assignEmployeeJobRole),
} as const);

const RUNNERS: Readonly<Record<string, Runner>> = Object.freeze({ ...READ_RUNNERS, ...COMMAND_RUNNERS });

export type WorkforceOperation = keyof typeof READ_RUNNERS | keyof typeof COMMAND_RUNNERS;
export const WORKFORCE_READ_OPERATIONS = Object.freeze(Object.keys(READ_RUNNERS) as WorkforceOperation[]);
export const WORKFORCE_COMMAND_OPERATIONS = Object.freeze(Object.keys(COMMAND_RUNNERS) as WorkforceOperation[]);

export const isWorkforceOperation = (name: unknown): name is WorkforceOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(RUNNERS, name);

/** The ONLY operations whose `input` may be omitted: the self read (no input at all) and the unfiltered directory. */
export const WORKFORCE_OPTIONAL_INPUT_OPERATIONS: readonly WorkforceOperation[] = Object.freeze(["readMyEmployeeProfile", "listEmployees"]);
const OPTIONAL_INPUT = new Set<string>(WORKFORCE_OPTIONAL_INPUT_OPERATIONS);

/** Fields that would state authority. Authority comes from the verified subject and PostgreSQL, never from the body. */
export const AUTHORITY_BEARING_FIELDS = Object.freeze([
  "tenantId", "principalId", "capabilities", "externalSubject", "identityProvider", "uid", "heldRoleKeys", "roles",
  "securityRole", "jobRole",
]);

// ════════════════════ execution ════════════════════

export type WorkforceApiResult =
  | { readonly ok: true; readonly operation: WorkforceOperation; readonly result: unknown }
  | { readonly ok: false; readonly operation: string; readonly code: string; readonly message: string; readonly status: number };

export const STATUS_BY_CATEGORY: Readonly<Record<EmployeeReadErrorCategory, number>> = Object.freeze({
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
export async function executeWorkforceOperation(
  deps: WorkforceApiDeps,
  request: {
    readonly caller: { readonly externalSubject: string; readonly identityProvider: string; readonly requestedTenantId: string | null };
    readonly operation: WorkforceOperation;
    readonly input: Input;
  },
): Promise<WorkforceApiResult> {
  const { operation } = request;
  try {
    const ctx = await resolveOperationalContext(deps.reader, deps.pool, {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    });
    const actor: EmployeeReadActor = Object.freeze({
      tenantId: ctx.principalContext.tenantId,
      principalId: ctx.principalContext.uid,
      capabilities: ctx.capabilities,
    });
    return { ok: true, operation, result: await RUNNERS[operation](deps, actor, request.input) };
  } catch (err) {
    if (err instanceof PrincipalContextError) {
      return { ok: false, operation, code: "FORBIDDEN", message: err.refusal, status: 403 };
    }
    if (err instanceof EmployeeReadError || err instanceof EmployeeCommandError) {
      return { ok: false, operation, code: err.code, message: err.message, status: STATUS_BY_CATEGORY[err.category] ?? 500 };
    }
    // eslint-disable-next-line no-console -- same posture as the sibling transports' unhandled-error log
    console.error("[workforceHttp] unhandled", err);
    return { ok: false, operation, code: "INTERNAL", message: "the request could not be completed", status: 500 };
  }
}

// ════════════════════ transport ════════════════════

export interface WorkforceHttpOptions extends WorkforceApiDeps {
  readonly verifyToken: TokenVerifier;
  readonly allowedOrigins?: readonly string[];
}

export interface HttpRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: string;
}
export interface HttpResponseShape {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export const MAX_WORKFORCE_BODY_BYTES = 1_000_000;

function baseHeaders(origin: string | null): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  };
}
const json = (status: number, body: unknown, origin: string | null): HttpResponseShape => ({ status, headers: baseHeaders(origin), body: JSON.stringify(body) });
const failure = (status: number, operation: string, code: string, message: string, origin: string | null) =>
  json(status, { ok: false, operation, code, message }, origin);

/**
 *   POST    /workforce/employees   { "operation": <closed name>, "input": { ... } }. Authenticated.
 *   OPTIONS /workforce/employees   CORS preflight.
 */
export async function handleWorkforceRequest(options: WorkforceHttpOptions, request: HttpRequestLike): Promise<HttpResponseShape> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = pathOf(request.url ?? "/");
  const origin = resolveOrigin(options.allowedOrigins, header(request, "origin"));

  if (path !== WORKFORCE_ROUTE) return failure(404, "", "UNKNOWN_OPERATION", "no such Workforce route", origin);
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
  if (method !== "POST") return failure(405, "", "METHOD_NOT_ALLOWED", "use POST", origin);

  if (typeof request.body === "string" && Buffer.byteLength(request.body, "utf8") > MAX_WORKFORCE_BODY_BYTES) {
    return failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", origin);
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = parseEnvelope(request.body);
  } catch {
    return failure(400, "", "INVALID_INPUT", "body must be a JSON object", origin);
  }
  const extra = Object.keys(envelope).filter((k) => k !== "operation" && k !== "input");
  if (extra.length > 0) return failure(400, String(envelope.operation ?? ""), "INVALID_INPUT", "the envelope accepts only operation and input", origin);

  const operation = envelope.operation;
  if (!isWorkforceOperation(operation)) return failure(404, typeof operation === "string" ? operation : "", "UNKNOWN_OPERATION", "no such Workforce operation", origin);

  if (envelope.input === undefined && !OPTIONAL_INPUT.has(operation)) {
    return failure(400, operation, "INVALID_INPUT", "input is required for this operation", origin);
  }
  const input = envelope.input === undefined ? {} : envelope.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure(400, operation, "INVALID_INPUT", "input must be a JSON object", origin);
  const stated = AUTHORITY_BEARING_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(input, f));
  if (stated.length > 0) {
    return failure(400, operation, "AUTHORITY_FIELD_NOT_ACCEPTED", `authority is resolved from the verified caller, never supplied: ${stated.join(", ")}`, origin);
  }

  const bearer = bearerToken(header(request, "authorization"));
  if (!bearer) return failure(401, operation, "UNAUTHENTICATED", "a bearer token is required", origin);
  let identity: VerifiedIdentity;
  try {
    identity = await options.verifyToken(bearer);
  } catch {
    return failure(401, operation, "UNAUTHENTICATED", "the token could not be verified", origin);
  }

  const result = await executeWorkforceOperation(options, {
    caller: {
      externalSubject: identity.externalSubject,
      identityProvider: identity.identityProvider,
      requestedTenantId: singleHeader(header(request, "x-eos-tenant")),
    },
    operation,
    input: input as Input,
  });
  if (result.ok) return json(200, result, origin);
  return failure(result.status, result.operation, result.code, result.message, origin);
}

/** Adapt the pure handler onto node:http, matching the sibling transports' adapters. */
export function createWorkforceHttpHandler(options: WorkforceHttpOptions) {
  return async function nodeHandler(
    req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; on: Function },
    res: { writeHead: Function; end: Function },
  ): Promise<void> {
    let response: HttpResponseShape;
    try {
      const body = await readBody(req);
      response = body === null
        ? failure(413, "", "PAYLOAD_TOO_LARGE", "the request body is too large", resolveOrigin(options.allowedOrigins, req.headers.origin))
        : await handleWorkforceRequest(options, { method: req.method, url: req.url, headers: req.headers, body });
    } catch (err) {
      console.error("[workforceHttp] unhandled", err);
      response = failure(500, "", "INTERNAL", "the request could not be completed", null);
    }
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };
}

// ════════════════════ small helpers (mirrors commercialHttp.ts) ════════════════════

/** Resolves null once the body exceeds the limit; the rest of the stream is drained, not buffered. */
function readBody(req: { on: Function }): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_WORKFORCE_BODY_BYTES) { tooLarge = true; chunks.length = 0; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseEnvelope(body: string | undefined): Record<string, unknown> {
  if (!body || body.trim().length === 0) throw new Error("empty");
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Record<string, unknown>;
}

const header = (req: HttpRequestLike, name: string) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
const singleHeader = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
};
function bearerToken(value: string | string[] | undefined): string | null {
  const raw = singleHeader(value);
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}
function pathOf(url: string): string {
  const idx = url.indexOf("?");
  const path = idx >= 0 ? url.slice(0, idx) : url;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
function resolveOrigin(allowed: readonly string[] | undefined, value: string | string[] | undefined): string | null {
  const origin = singleHeader(value);
  if (!origin || !allowed || allowed.length === 0) return null;
  // A wildcard is never an origin grant, even if configuration somehow carried one.
  return origin !== "*" && allowed.includes(origin) ? origin : null;
}
