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
//   #17       readMyWorkforceCapabilities     The caller's OWN resolved capabilities, intersected with the closed Workforce
//                                             list -- what the Administration Employee pages OFFER. No capability beyond an
//                                             active Principal + membership; no selector; no Role, Principal or other id.
//   EMP-RT-01 readEmployee / listEmployees    employee.record.read. Business record + bounded directory; no Principal,
//                                             provider, Role or account status.
//   EMP-RT-02 readEmployeePrincipalLink       admin.principalAccess.read (Owner ruling B).
//   EMP-RT-03 listRecordsOwnedByEmployee      the Commercial families, gated by each family's read capability.
//   EMP-RT-04 listAccountabilitiesForEmployee the Commercial families, gated by each family's read capability.
//   #210      listWorkforceRoster             employee.record.read (+ admin.principalAccess.read for the Security Role column).
//   EMP-RT-06 listManagedEmployees            employee.record.read over eos_workforce.employee_reporting_relationships.
//   EMP-RT-05 listAssignedWorkForEmployee     employee.record.read + the family read (workOrder.record.read unconditional;
//                                             reorder.request.read within REORDER_QUEUE reach). Served since #210: the
//                                             assignment authority is now PostgreSQL (work_order / reorder assignments).
//   EMP-RT-08 listJobRoles / listEmployeeJobRoleHistory / listEmployeesWithoutJobRole   employee.record.read.
//   EMP-RT-08 createJobRole / updateJobRole / assignEmployeeJobRole                      admin.employeeJobRole.write.
//   step C   listEmployeeWorkEligibility / ...History                                    employee.record.read.
//   step C   assignEmployeeWorkEligibility / endEmployeeWorkEligibility                  admin.employeeWorkEligibility.write.
//   FR       listFunctionalRoles / listFunctionalRoleHolders / listEmployeeFunctionalRoles /
//            listFunctionalRoleHistory                                                  employee.record.read.
//   FR       createFunctionalRole / updateFunctionalRoleMetadata / setFunctionalRoleStatus /
//            assignEmployeeFunctionalRole / endEmployeeFunctionalRoleAssignment        admin.employeeFunctionalRole.write.
//   step C   listEmployeeOperationalScopes / ...History                                  employee.record.read.
//   lane GA  listOperationalScopeTargets (governed WAREHOUSE / REORDER_QUEUE values)     employee.record.read.
//   step C   assignEmployeeOperationalScope / endEmployeeOperationalScope                admin.employeeOperationalScope.write.
//   step G   listAssignableEmployees                                                      employee.record.read.
//             A Job Role is a business function only: no Security Role, permission, ownership, assignment,
//             reporting or operating-company authority is read or written by these operations.
//   EMP-RT-H1 listEmployeeChangeHistory      employee.record.read. The governed Employee audit trail (ten closed actions,
//                                             projected values); the actor's display name only with
//                                             admin.principalAccess.read, never a Principal id.
//   EMP-RT-W1B updateEmployeeProfile          admin.employeeProfile.write. The 17 profile facts only (W1A command).
//   EMP-RT-W1B establishReportingRelationship admin.employeeProfile.write. Reporting relationship, history kept.
//   EMP-RT-W1B endReportingRelationship       admin.employeeProfile.write.
//   EMP-RT-W1C saveEmployeeEdit               admin.employeeProfile.write. ONLY a Save changing profile AND manager:
//                                             both in one transaction, or neither.
//   EMP-RT-W2  changeEmploymentStatus         admin.employeeProfile.write. Allowed transitions only.
//   EMP-RT-W2  changeOperatingCompany         admin.employeeProfile.write. A known, active operating company only.
//   lane BT    createEmployee                 admin.employeeProfile.write. The governed birth of an Employee: the two
//                                             lifecycle facts plus the optional 17 profile facts, and NO authority --
//                                             no Security Role, Job Role, Work Eligibility, Operational Scope or link.
//                                             A duplicate id REFUSES; it is never an upsert.
//   lane BT    linkEmployeePrincipal          admin.employeeProfile.write. The FIRST Employee <-> Principal link.
//   lane BT    unlinkEmployeePrincipal        admin.employeeProfile.write. Revoke, with MANDATORY
//   lane BT    relinkEmployeePrincipal        admin.employeeProfile.write. Move, with MANDATORY
//                                             expectedCurrentPrincipalId -- a stale value refuses rather than
//                                             proceeding. The TARGET Principal is spelled linkedPrincipalId /
//                                             newPrincipalId, never `principalId`, which this transport refuses as an
//                                             authority-bearing field before it verifies a token.
//                                             These four also count DIRECT Principal grants
//                                             (eosWorkforce/commands/employeeAdministrationAuthority.ts, standing Owner ruling);
//                                             every other operation here resolves from Roles exactly as before.
// Security Roles and Job Roles are NOT served, and creating an Employee grants neither.
// An unserved name is an ordinary unknown operation (404); nothing is stubbed.
import type { Pool } from "pg";
import { containsNulCharacter, NUL_CHARACTER_REFUSAL } from "../adminPolicy/requestText";
import { resolveOperationalContext } from "../eosOps/capabilityAuthority";
import { postgresGrantConditionProvider, resolveEntitledOperationalContext } from "../eosOps/entitledActionAuthority";
import { PrincipalContextError } from "../adminPolicy/principalContext";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { EmployeeReadError, type EmployeeReadActor, type EmployeeReadErrorCategory } from "./reads/employeeReadKernel";
import { readMyEmployeeProfile } from "./reads/myEmployeeProfile";
import { readMyWorkforceCapabilities } from "./reads/myWorkforceCapabilities";
import { listAccountabilitiesForEmployee, listRecordsOwnedByEmployee } from "./reads/employeeResponsibilityReads";
import { listEmployees, listManagedEmployees, readEmployee } from "./reads/employeeDirectoryReads";
import { listWorkforceRoster } from "../eosAdministration/workforceRoster";
import { listAssignedWorkForEmployee } from "./reads/assignedWorkReads";
import { readEmployeePrincipalLink } from "./reads/employeePrincipalLinkRead";
import { EmployeeCommandError } from "./commands/employeeCommandKernel";
import { updateEmployeeProfile } from "./commands/employeeProfileCommand";
import { endReportingRelationship, establishReportingRelationship } from "./commands/reportingRelationshipCommands";
import { saveEmployeeEdit } from "./commands/employeeEditCommand";
import { changeEmploymentStatus, changeOperatingCompany } from "./commands/employeeLifecycleCommand";
import { createEmployee } from "./commands/employeeCreationCommand";
import { linkEmployeePrincipal, relinkEmployeePrincipal, unlinkEmployeePrincipal } from "./commands/employeePrincipalLinkCommands";
import { assignEmployeeJobRole, createJobRole, updateJobRole } from "./commands/employeeJobRoleCommands";
import { listEmployeeJobRoleHistory, listEmployeesWithoutJobRole, listJobRoles } from "./reads/jobRoleReads";
import { listEmployeeChangeHistory } from "./reads/employeeChangeHistoryRead";
import { assignEmployeeWorkEligibility, endEmployeeWorkEligibility } from "./commands/employeeWorkEligibilityCommands";
import { assignEmployeeOperationalScope, endEmployeeOperationalScope } from "./commands/employeeOperationalScopeCommands";
import { listEmployeeWorkEligibility, listEmployeeWorkEligibilityHistory } from "./reads/workEligibilityReads";
import { listEmployeeOperationalScopes, listEmployeeOperationalScopeHistory, listOperationalScopeTargets } from "./reads/operationalScopeReads";
import {
  assignEmployeeFunctionalRole, createFunctionalRole, endEmployeeFunctionalRoleAssignment, setFunctionalRoleStatus,
  updateFunctionalRoleMetadata,
} from "./commands/employeeFunctionalRoleCommands";
import {
  listEmployeeFunctionalRoles, listFunctionalRoleHistory, listFunctionalRoleHolders, listFunctionalRoles,
} from "./reads/functionalRoleReads";
import { listAssignableEmployees } from "./reads/assignableEmployeeReads";

export interface VerifiedIdentity {
  readonly externalSubject: string;
  readonly identityProvider: string;
}
export type TokenVerifier = (bearerToken: string) => Promise<VerifiedIdentity>;

export const WORKFORCE_ROUTE = "/workforce/employees";

export interface WorkforceApiDeps {
  readonly reader: PolicyReader;
  readonly pool: Pool;
  /**
   * WHERE PER-GRANT CONDITIONS COME FROM. Server composition, never a request field.
   *
   *   (unset)    DEFAULT since 2026-09-26: eos_policy.capability_grant_conditions, read LAZILY through
   *              postgresGrantConditionProvider -- the same relation, the same withheld-cell guard.
   *   "POSTGRES" eos_policy.capability_grant_conditions, ACTIVE rows only, resolved EAGERLY --
   *              the relation EOS Administration writes (setGrantCondition / retireGrantCondition).
   *              With zero rows it produces exactly the SHIPPED catalog, so behaviour is unchanged
   *              until an administrator conditions a grant. A database that cannot answer refuses
   *              the request; it never degrades to "unconditioned".
   *   "SHIPPED"  the in-code catalog, EMPTY and frozen. Kept only as an explicit composition for
   *              isolated tests; no deployed composition selects it.
   */
  readonly grantConditionSource?: "SHIPPED" | "POSTGRES";
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
  readMyWorkforceCapabilities: read(readMyWorkforceCapabilities),
  readEmployee: read(readEmployee),
  listEmployees: read(listEmployees),
  readEmployeePrincipalLink: read(readEmployeePrincipalLink),
  listManagedEmployees: read(listManagedEmployees),
  listRecordsOwnedByEmployee: read(listRecordsOwnedByEmployee),
  listAccountabilitiesForEmployee: read(listAccountabilitiesForEmployee),
  listJobRoles: read(listJobRoles),
  listEmployeeJobRoleHistory: read(listEmployeeJobRoleHistory),
  listEmployeesWithoutJobRole: read(listEmployeesWithoutJobRole),
  listEmployeeChangeHistory: read(listEmployeeChangeHistory),
  listEmployeeWorkEligibility: read(listEmployeeWorkEligibility),
  listEmployeeWorkEligibilityHistory: read(listEmployeeWorkEligibilityHistory),
  listEmployeeOperationalScopes: read(listEmployeeOperationalScopes),
  listEmployeeOperationalScopeHistory: read(listEmployeeOperationalScopeHistory),
  // Lane GA: the governed values the Operational Scope picker offers (warehouses; reorder-queue company keys).
  listOperationalScopeTargets: read(listOperationalScopeTargets),
  listAssignableEmployees: read(listAssignableEmployees),
  // Functional Role (migration 1762819200000): employee.record.read, like the Job Role and Work Eligibility reads.
  listFunctionalRoles: read(listFunctionalRoles),
  listFunctionalRoleHolders: read(listFunctionalRoleHolders),
  listEmployeeFunctionalRoles: read(listEmployeeFunctionalRoles),
  listFunctionalRoleHistory: read(listFunctionalRoleHistory),
  // Administration control plane (#210): the workforce roster -- Job Role, Security Roles (admin.principalAccess.read only),
  // scopes, eligibility and manager per Employee, filterable; employee.record.read.
  listWorkforceRoster: read(listWorkforceRoster),
  // EMP-RT-05 (#210): CURRENT work assigned to an Employee -- served now that assignment authority is in PostgreSQL.
  listAssignedWorkForEmployee: read(listAssignedWorkForEmployee),
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
  assignEmployeeWorkEligibility: command(assignEmployeeWorkEligibility),
  endEmployeeWorkEligibility: command(endEmployeeWorkEligibility),
  assignEmployeeOperationalScope: command(assignEmployeeOperationalScope),
  endEmployeeOperationalScope: command(endEmployeeOperationalScope),
  createEmployee: command(createEmployee),
  linkEmployeePrincipal: command(linkEmployeePrincipal),
  unlinkEmployeePrincipal: command(unlinkEmployeePrincipal),
  relinkEmployeePrincipal: command(relinkEmployeePrincipal),
  // Functional Role: admin.employeeFunctionalRole.write, each under the tenant governance lock.
  createFunctionalRole: command(createFunctionalRole),
  updateFunctionalRoleMetadata: command(updateFunctionalRoleMetadata),
  setFunctionalRoleStatus: command(setFunctionalRoleStatus),
  assignEmployeeFunctionalRole: command(assignEmployeeFunctionalRole),
  endEmployeeFunctionalRoleAssignment: command(endEmployeeFunctionalRoleAssignment),
} as const);

const RUNNERS: Readonly<Record<string, Runner>> = Object.freeze({ ...READ_RUNNERS, ...COMMAND_RUNNERS });

export type WorkforceOperation = keyof typeof READ_RUNNERS | keyof typeof COMMAND_RUNNERS;
export const WORKFORCE_READ_OPERATIONS = Object.freeze(Object.keys(READ_RUNNERS) as WorkforceOperation[]);
export const WORKFORCE_COMMAND_OPERATIONS = Object.freeze(Object.keys(COMMAND_RUNNERS) as WorkforceOperation[]);

export const isWorkforceOperation = (name: unknown): name is WorkforceOperation =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(RUNNERS, name);

/** The ONLY operations whose `input` may be omitted: the two self reads (no input at all) and the unfiltered directory. */
export const WORKFORCE_OPTIONAL_INPUT_OPERATIONS: readonly WorkforceOperation[] = Object.freeze(["readMyEmployeeProfile", "readMyWorkforceCapabilities", "listEmployees", "listWorkforceRoster"]);
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
    const input = {
      identityProvider: request.caller.identityProvider,
      externalSubject: request.caller.externalSubject,
      requestedTenantId: request.caller.requestedTenantId,
    };
    // DEFAULT: conditions from PostgreSQL, resolved LAZILY -- a request whose kernel refuses on the
    // flat capability set first reads no condition. "POSTGRES" keeps the eager composition
    // (resolveEntitledOperationalContext); "SHIPPED" the empty in-code catalog.
    const ctx = deps.grantConditionSource === undefined
      ? await resolveOperationalContext(deps.reader, deps.pool, input, postgresGrantConditionProvider(deps.pool))
      : await (deps.grantConditionSource === "POSTGRES"
        ? resolveEntitledOperationalContext : resolveOperationalContext)(deps.reader, deps.pool, input);
    const actor: EmployeeReadActor = Object.freeze({
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
  // U+0000 is refused at the envelope, before identity or any query (adminPolicy/requestText.ts; Controller XLF-002).
  if (containsNulCharacter(envelope)) {
    return failure(400, typeof envelope.operation === "string" ? envelope.operation : "", "INVALID_INPUT", NUL_CHARACTER_REFUSAL, origin);
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
