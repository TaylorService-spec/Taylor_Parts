// ACCESS EXPLAINED -- "why can or can't this person do X", gate by gate. READ-ONLY; decides nothing.
//
// Design: docs/architecture/access-explained-2026-10-23.md; the eleven-gate chain is section 3A.1 of the simplified
// permission model proposal (D:/eos-lanes/evidence/security/SIMPLIFIED-PERMISSION-MODEL-PROPOSAL-2026-10-23.md), the
// setting ids ("1.1", "3.1" ...) are its Appendix G register.
//
// ════════════════════ NO NEW AUTHORIZATION LOGIC ════════════════════
// Every gate is read off a resolver that already decides it for real requests:
//   1 sign-in             EosLoginService.readLoginAccount (injected as `readSignIn`; same key, admin.principalAccess.read)
//   2 principal / tenant  resolvePrincipalContextById       -- the runtime's own tail (principalContext.ts)
//   3 employment          the same call: EMPLOYEE_NOT_ACCESS_ELIGIBLE (DQ-007)
//   4 company             resolveCompanyAuthority            -- companyAuthority.ts
//   5 activation          NOT COVERED: the EOS API does not read the code-side `active:false` flags (setting 5.1)
//   6 door                explainEffectiveAccess.surfaces    -- grantedSurfaceKeys, the runtime's own projection
//   7 object, 9 record    explainEffectiveAccess.questionDecision -- authorizeOperationalAction, the runtime evaluator
//   8 field               NOT COVERED: field groups are defined per command module; there is no registry to ask
//   10 process            deriveWorkflowResponsibilities     -- the same derivation as listPrincipalWorkflowResponsibilities;
//                         INFORMATIONAL only (a binding is enforced just on workflow-instance transitions), never a refusal
//   11 system             NOT COVERED: the protected rules apply to a concrete change, not to a standing question
// The chain stops at the FIRST refusal (section 3A.1): later gates are NOT_EVALUATED.
//
// SAME READ AUTHORITY as explainEffectiveAccess (READ_OPERATION_SURFACE "users" -> admin.principalAccess.read); the
// dispatcher decides it before this module runs. This module takes no actor and writes nothing.
import type { Pool } from "pg";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { PolicyValidationError } from "../adminPolicy/policyCommands";
import { PrincipalContextError, resolvePrincipalContextById } from "../adminPolicy/principalContext";
import { ASSIGNMENT_SCOPE_DIMENSIONS, type BusinessContext, isAdministrationCapability } from "../adminPolicy/assignmentScopeRuntime";
import { deriveWorkflowResponsibilities, loadActiveWorkflowDefinitions, type ExplainedAuthority } from "../adminPolicy/workflowResponsibilities";
import { findPermission } from "../access/permissionCatalog";
import { DEFAULT_LOGIN_SESSION_POLICY } from "../eosAuth/eosLoginService";
import { resolveCompanyAuthority } from "./companyAuthority";
import { EXPERIENCE_SURFACES } from "./experienceAuthority";
import { explainEffectiveAccess, type EffectiveAccessExplanation, type ExplainOptions } from "./effectiveAccessExplanation";

export type GateStatus = "PASS" | "FAIL" | "NOT_APPLICABLE" | "NOT_EVALUATED" | "NOT_COVERED";
/** ALLOWED = every gate passed or was not applicable. ALLOWED_AS_CHECKED = nothing refused, but `notCoveredCount` gates could not be checked. */
export type AccessVerdict = "OVERVIEW" | "ALLOWED" | "ALLOWED_AS_CHECKED" | "BLOCKED" | "NEEDS_RECORD";

export interface GateSetting {
  /** Appendix G register id of the proposal ("1.1"). */
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Where the setting lives (table or file), so an administrator knows what to change. */
  readonly authority: string;
}

export interface AccessGate {
  readonly step: number;
  readonly key: string;
  readonly label: string;
  /** The PROPOSED layer name (section 3A.1). Shown only once the Owner approves the model: see `layerNamesApproved`. */
  readonly proposedLayer: string;
  readonly status: GateStatus;
  /** One plain sentence about this gate's result. */
  readonly summary: string;
  /** Plain-words sentence for a FAIL (the part after "Blocked at: <gate>."); null otherwise. */
  readonly failure: string | null;
  readonly settings: readonly GateSetting[];
}

export interface AccessQuestion {
  readonly capabilityKey: string | null;
  readonly surfaceKey: string | null;
  readonly businessContext: BusinessContext;
}

export interface AccessGatesExplanation {
  readonly tenantId: string;
  readonly principalId: string;
  readonly question: { readonly kind: "PERSON" | "ACTION" | "PAGE"; readonly capabilityKey: string | null; readonly surfaceKey: string | null;
    readonly label: string | null; readonly businessContext: BusinessContext };
  readonly verdict: AccessVerdict;
  /** How many gates are NOT_COVERED (cannot be checked from here). */
  readonly notCoveredCount: number;
  /** Always the eleven gates, in order. */
  readonly gates: readonly AccessGate[];
  readonly firstFailure: { readonly step: number; readonly key: string; readonly label: string; readonly text: string } | null;
  /** False until the Owner approves the layer model (proposal D1..D13): the page must not show `proposedLayer`. */
  readonly layerNamesApproved: false;
  /** What the picker offers; only when no question was asked. */
  readonly options?: {
    readonly actions: readonly { readonly objectKey: string; readonly actionKey: string; readonly capabilityKey: string }[];
    readonly surfaces: readonly { readonly key: string; readonly label: string }[];
  };
}

export interface ExplainGatesInput {
  readonly tenantId: string;
  readonly principalId: string;
  /** Raw request input (`question`), validated here. */
  readonly question?: unknown;
  /** The login-account read, composed by the dispatcher over the SAME key; null when EOS login is not composed. */
  readonly readSignIn?: (() => Promise<unknown>) | null;
}

const LAYER = Object.freeze({
  signIn: "Layer 0", principal: "Layer 0", employment: "Layer 0", company: "Layer 3", activation: "Layer A", door: "Experience",
  object: "Layer 1", field: "Layer 2", record: "Layer 3", process: "Layer 4", system: "Layer 5",
});

const GATE_DEFS = Object.freeze([
  { key: "signIn", label: "Sign-in" },
  { key: "principal", label: "Principal and tenant" },
  { key: "employment", label: "Employment eligibility" },
  { key: "company", label: "Company" },
  { key: "activation", label: "Activation" },
  { key: "door", label: "Door" },
  { key: "object", label: "Object" },
  { key: "field", label: "Field" },
  { key: "record", label: "Record access" },
  { key: "process", label: "Process" },
  { key: "system", label: "System" },
] as const);
type GateKey = typeof GATE_DEFS[number]["key"];

const s = (id: string, label: string, value: unknown, authority: string): GateSetting =>
  Object.freeze({ id, label, value: value === null || value === undefined || value === "" ? "none" : String(value), authority });

const list = (items: readonly string[]): string => (items.length > 0 ? items.join(", ") : "none");

/** Validate the raw question. Unknown keys are refused, never ignored. */
export function parseAccessQuestion(raw: unknown, capabilityKeys: ReadonlySet<string>, byObjectAction: ReadonlyMap<string, string>): AccessQuestion {
  if (raw === undefined || raw === null) return Object.freeze({ capabilityKey: null, surfaceKey: null, businessContext: Object.freeze({}) });
  if (typeof raw !== "object" || Array.isArray(raw)) throw new PolicyValidationError("question must be an object");
  const q = raw as Record<string, unknown>;
  const str = (v: unknown, what: string): string | null => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || v.trim().length > 200) throw new PolicyValidationError(`${what} must be a short string`);
    return v.trim();
  };
  const objectKey = str(q.objectKey, "objectKey");
  const actionKey = str(q.actionKey, "actionKey");
  let capabilityKey = str(q.capabilityKey, "capabilityKey");
  const surfaceKey = str(q.surfaceKey, "surfaceKey");
  if ((objectKey === null) !== (actionKey === null)) throw new PolicyValidationError("objectKey and actionKey go together");
  if (objectKey && actionKey) {
    capabilityKey = byObjectAction.get(`${objectKey}|${actionKey}`) ?? null;
    if (!capabilityKey) throw new PolicyValidationError("unknown object action");
  }
  if (capabilityKey && surfaceKey) throw new PolicyValidationError("ask about an action or a page, not both");
  if (capabilityKey && !capabilityKeys.has(capabilityKey)) throw new PolicyValidationError("unknown object action");
  if (surfaceKey && !EXPERIENCE_SURFACES.some((x) => x.key === surfaceKey)) throw new PolicyValidationError("unknown page");
  const ctx = q.businessContext;
  if (ctx !== undefined && ctx !== null && (typeof ctx !== "object" || Array.isArray(ctx))) throw new PolicyValidationError("businessContext must be an object");
  const c = (ctx ?? {}) as Record<string, unknown>;
  const businessContext: Record<string, string> = {};
  for (const key of ["operatingCompanyId", "warehouseId", "salesChannel"] as const) {
    const v = str(c[key], key);
    if (v) businessContext[key] = v;
  }
  return Object.freeze({ capabilityKey, surfaceKey, businessContext: Object.freeze(businessContext) });
}

export async function explainAccessGates(
  reader: PolicyReader,
  pool: Pick<Pool, "query">,
  input: ExplainGatesInput,
  options: ExplainOptions = {},
): Promise<AccessGatesExplanation> {
  const { tenantId, principalId } = input;
  const catalog = await reader.listCapabilities();
  const q = parseAccessQuestion(input.question, new Set(catalog.map((c) => c.key)), new Map(catalog.map((c) => [`${c.objectKey}|${c.actionKey}`, c.key])));
  const kind = q.capabilityKey ? "ACTION" : q.surfaceKey ? "PAGE" : "PERSON";
  const surfaceLabel = q.surfaceKey ? EXPERIENCE_SURFACES.find((x) => x.key === q.surfaceKey)?.label ?? q.surfaceKey : null;
  const cap = q.capabilityKey ? catalog.find((c) => c.key === q.capabilityKey) ?? null : null;
  const label = cap ? `${cap.displayLabel}` : surfaceLabel;

  const done = new Map<GateKey, Omit<AccessGate, "step" | "key" | "label" | "proposedLayer">>();
  let failedAt: GateKey | null = null;
  const set = (key: GateKey, status: GateStatus, summary: string, settings: readonly GateSetting[], failure: string | null = null): void => {
    if (status === "FAIL" && failedAt === null) failedAt = key;
    done.set(key, { status, summary, failure, settings });
  };
  const alive = (): boolean => failedAt === null;

  // ──────────── 1 SIGN-IN ────────────
  const policy = DEFAULT_LOGIN_SESSION_POLICY;
  const sessionSetting = s("1.5", "Session limits", `idle ${policy.idleSeconds / 3600} h, absolute ${policy.absoluteSeconds / 86400} d, lock after ${policy.lockThreshold} failures`,
    "DEFAULT_LOGIN_SESSION_POLICY, eosAuth/eosLoginService.ts (code constants, pending Owner ruling D-4)");
  if (!input.readSignIn) {
    set("signIn", "NOT_COVERED", "EOS sign-in is not composed on this service, so the login account cannot be read.", [sessionSetting]);
  } else {
    type SignIn = { account?: Record<string, unknown> | null; eosIdentity?: { kind?: string } | null };
    let read = null as SignIn | null;
    try { read = (await input.readSignIn()) as SignIn; } catch { read = null; }
    if (!read) {
      set("signIn", "NOT_COVERED", "The sign-in account could not be read.", [sessionSetting]);
    } else if (!read.account) {
      if (read.eosIdentity?.kind === "persona") {
        set("signIn", "NOT_APPLICABLE", "Signs in with a nonprod test-persona identity, not a login account.", [sessionSetting]);
      } else {
        set("signIn", "FAIL", "No EOS sign-in account exists for this person.", [s("1.1", "Login account status", "no account", "eos_policy.login_accounts.status"), sessionSetting],
          "There is no sign-in account for this person, so they cannot sign in.");
      }
    } else {
      const a = read.account;
      const status = String(a.status ?? "unknown");
      const locked = typeof a.lockedUntil === "string" ? a.lockedUntil : null;
      const mfaRequired = a.mfaRequired === true;
      const mfaEnrolled = a.mfaEnrolled === true;
      const settings = [
        s("1.1", "Login account status", status, "eos_policy.login_accounts.status"),
        s("1.2", "Locked until", locked, "login_accounts.locked_until (failed attempts: " + String(a.failedAttempts ?? 0) + ")"),
        s("1.4", "Two-step verification", `${mfaRequired ? "required" : "not required"}, ${mfaEnrolled ? "set up" : "not set up"}`, "login_accounts.mfa_required, login_mfa_factors"),
        sessionSetting,
      ];
      if (status === "pending_enrollment") {
        set("signIn", "FAIL", "The sign-in account is waiting for first-time setup.", settings, "The sign-in account has not finished first-time setup, so they cannot sign in yet.");
      } else if (status !== "active") {
        set("signIn", "FAIL", `The sign-in account is ${status}.`, settings, `The sign-in account is ${status}, so they cannot sign in.`);
      } else if (locked) {
        set("signIn", "FAIL", `The sign-in account is locked until ${locked}.`, settings, `The sign-in account is locked until ${locked} after too many failed attempts.`);
      } else if (mfaRequired && !mfaEnrolled) {
        set("signIn", "FAIL", "Two-step verification is required but not set up.", settings,
          "Two-step verification is required for this account and has not been set up, so the session reaches only the sign-in self-service pages.");
      } else {
        set("signIn", "PASS", "The sign-in account is active and not locked.", settings);
      }
    }
  }

  // ──────────── 2 PRINCIPAL / TENANT and 3 EMPLOYMENT ────────────
  const linkFact = await reader.getLinkedEmployeeAccessFact(tenantId, principalId);
  const employmentSettings = [
    s("1.12", "Employee link", linkFact ? (linkFact.ambiguous ? "ambiguous" : "one active link") : "no link", "eos_policy.employee_principal_links"),
    s("2.1", "Employment status", linkFact?.employmentStatus ?? (linkFact ? "unresolved" : "not applicable"), "eos_workforce.employees.employment_status"),
  ];
  let context: Awaited<ReturnType<typeof resolvePrincipalContextById>> | null = null;
  try {
    context = await resolvePrincipalContextById(reader, principalId, tenantId);
  } catch (err) {
    if (!(err instanceof PrincipalContextError)) throw err;
    const principal = await reader.getPrincipal(principalId);
    const tenantSettings = [
      s("1.9", "Principal status", principal?.status ?? "unknown", "eos_policy.principals.status"),
      s("1.11", "Tenant membership", err.refusal, "eos_policy.tenant_memberships, eos_policy.tenants"),
    ];
    if (err.refusal === "EMPLOYEE_NOT_ACCESS_ELIGIBLE") {
      set("principal", "PASS", "The principal is active in exactly one active tenant.", tenantSettings);
      set("employment", "FAIL", `The linked Employee is ${linkFact?.employmentStatus ?? "not resolvable"}, which is not eligible for access.`, employmentSettings,
        `The linked Employee's status is ${linkFact?.employmentStatus ?? "unresolved"}. Only Active and Contractor employees have access; roles stay assigned but give nothing.`);
    } else {
      const words: Record<string, string> = {
        UNKNOWN_PRINCIPAL: "This identity is not known to EOS.",
        PRINCIPAL_DISABLED: "The principal is disabled.",
        NO_TENANT_MEMBERSHIP: "The principal has no active tenant membership.",
        TENANT_NOT_A_MEMBERSHIP: "The principal is not a member of this tenant.",
        AMBIGUOUS_TENANT: "The principal belongs to several tenants.",
        TENANT_NOT_ACTIVE: "The tenant is not active.",
      };
      const text = words[err.refusal] ?? "The principal does not resolve to a usable context.";
      set("principal", "FAIL", text, tenantSettings, `${text} Nothing else is evaluated.`);
    }
  }
  if (context) {
    set("principal", "PASS", "The principal is active in exactly one active tenant.", [
      s("1.9", "Principal status", context.principal.status, "eos_policy.principals.status"),
      s("1.11", "Tenant membership", `${context.tenantId} (active)`, "eos_policy.tenant_memberships, eos_policy.tenants"),
    ]);
    set("employment", linkFact ? "PASS" : "NOT_APPLICABLE",
      linkFact ? `The linked Employee is ${linkFact.employmentStatus}, which is eligible.` : "No Employee is linked, so employment status does not apply.", employmentSettings);
  }

  // ──────────── evaluator (only once the principal resolves) ────────────
  let explanation: EffectiveAccessExplanation | null = null;
  if (context) {
    explanation = await explainEffectiveAccess(reader, pool, { tenantId, principalId }, {
      ...options,
      ...(q.capabilityKey ? { question: { capabilityKey: q.capabilityKey, businessContext: q.businessContext } } : {}),
    });
  }

  // ──────────── 4 COMPANY ────────────
  if (context && alive()) {
    const authority = await resolveCompanyAuthority(pool as never, tenantId, principalId);
    const wanted = q.businessContext.operatingCompanyId ?? null;
    const home = explanation?.employeeFacts.employee?.operatingCompanyId ?? null;
    // The DATABASE clock decides a grant's window (companyAuthority.ts), never this process's clock.
    const now = new Date((await pool.query("SELECT now() AS now")).rows[0].now).getTime();
    const grants = (explanation?.employeeId && reader.listCompanyAuthorityGrants
      ? await reader.listCompanyAuthorityGrants(tenantId, explanation.employeeId) : [])
      .filter((g) => g.status === "active" && Date.parse(g.effectiveFrom) <= now && (g.effectiveUntil === null || Date.parse(g.effectiveUntil) > now))
      .map((g) => g.effectiveUntil ? `${g.operatingCompanyId} (until ${g.effectiveUntil.slice(0, 10)})` : g.operatingCompanyId);
    const settings = [
      s("3.1", "Companies this person may see or act in", list(authority.companies), "resolveCompanyAuthority, eosOps/companyAuthority.ts"),
      s("2.2", "Home operating company", home, "eos_workforce.employees.operating_company_id"),
      s("3.3", "Explicit company-access grants", list(grants), "the Company Access grants (Employee > Company Access); the database clock decides the window"),
    ];
    if (wanted && !authority.companies.includes(wanted)) {
      set("company", "FAIL", `The record's company ${wanted} is outside this person's reach.`, settings,
        `Their company reach is ${list(authority.companies)}; this record belongs to ${wanted}.`);
    } else if (authority.companies.length > 0) {
      set("company", "PASS", wanted ? `${wanted} is inside this person's company reach.` : `Company reach: ${list(authority.companies)}.`, settings);
    } else {
      set("company", "NOT_APPLICABLE", "This person reaches no operating company; that only matters for company records.", settings);
    }
  }

  // ──────────── 5 ACTIVATION ────────────
  if (context && alive()) {
    const flag = q.capabilityKey ? findPermission(q.capabilityKey) : undefined;
    const activationSettings = q.capabilityKey ? [s("5.1", "Permission catalog flag", flag ? (flag.active === false ? "active:false (legacy gates only)" : "active") : "not in the legacy catalog",
      "access/permissionCatalog.ts; per-environment lifting in access/environmentCapabilityOverrides.ts")] : [];
    set("activation", kind === "PERSON" ? "NOT_EVALUATED" : "NOT_COVERED",
      kind === "PERSON" ? "Choose an action or a page to check activation."
        : "Not covered: the EOS API does not read the code-side activation flags, so this gate cannot be answered from here (a read-only activation register is proposed).", activationSettings);
  }

  // ──────────── 6 DOOR ────────────
  if (context && alive() && explanation) {
    const offered = new Set(explanation.surfaces);
    const doorSettings = [s("6.1", "Pages offered", `${explanation.surfaces.length}`, "EXPERIENCE_SURFACES, eosOps/experienceAuthority.ts")];
    if (q.surfaceKey) {
      const def = EXPERIENCE_SURFACES.find((x) => x.key === q.surfaceKey);
      const needs = def?.containerOf ? `one of its pages (${def.containerOf.join(", ")})` : list((def?.grants ?? []).map((g) => g.capabilityKey));
      if (offered.has(q.surfaceKey)) set("door", "PASS", `${surfaceLabel} is offered to this person.`, doorSettings);
      else set("door", "FAIL", `${surfaceLabel} is not offered to this person.`, [...doorSettings, s("6.1", `${surfaceLabel} needs`, needs, "EXPERIENCE_SURFACES")],
        `${surfaceLabel} needs ${needs}; this person does not hold a way in. The page is a door only, never the security boundary.`);
    } else if (q.capabilityKey) {
      const earned = explanation.actions.find((a) => a.capabilityKey === q.capabilityKey)?.surfaces ?? [];
      set("door", earned.length > 0 ? "PASS" : "NOT_APPLICABLE",
        earned.length > 0 ? `Offered on: ${earned.join(", ")}.` : "No page is offered for this action; a door never decides the action itself.", doorSettings);
    } else {
      set("door", explanation.surfaces.length > 0 ? "PASS" : "NOT_APPLICABLE",
        explanation.surfaces.length > 0 ? `${explanation.surfaces.length} pages are offered.` : "No page is offered to this person.", doorSettings);
    }
  }

  // The capability behind the question: an action, or the page's way in.
  const pageCaps = q.surfaceKey ? (EXPERIENCE_SURFACES.find((x) => x.key === q.surfaceKey)?.grants ?? []).map((g) => g.capabilityKey) : [];

  // ──────────── 7 OBJECT, 9 RECORD ACCESS ────────────
  const d = explanation?.questionDecision ?? null;
  const askedAction = q.capabilityKey && explanation ? explanation.actions.find((a) => a.capabilityKey === q.capabilityKey) ?? null : null;
  if (context && alive()) {
    if (!q.capabilityKey && !q.surfaceKey) {
      set("object", "NOT_EVALUATED", "Choose an object and action to check this gate.", []);
    } else if (q.surfaceKey && explanation) {
      const held = pageCaps.filter((k) => explanation!.capabilities.includes(k) || explanation!.conditionallyHeld.includes(k) || explanation!.scopedHeld.some((h) => h.capabilityKey === k));
      set("object", held.length > 0 || explanation.surfaces.includes(q.surfaceKey) ? "PASS" : "NOT_APPLICABLE",
        held.length > 0 ? `Holds ${list(held)}.` : "This page checks its object actions when you open it.", [s("4.1", "Security Roles held", list(explanation.securityRoleKeys), "eos_policy.user_role_assignments")]);
    } else if (d && askedAction) {
      const roleSettings = [
        s("4.1", "Security Roles held", list(explanation!.securityRoleKeys), "eos_policy.user_role_assignments"),
        s("4.7", "Direct exception", askedAction.directGrant ? `yes (${askedAction.directGrant.exceptionReason ?? "no reason recorded"})` : "none", "eos_policy.principal_capabilities"),
        s("keys", "How the key is held", askedAction.provenance,"role_capabilities / principal_capabilities"),
      ];
      if (d.outcome === "CAPABILITY_MISSING") {
        set("object", "FAIL", `${label ?? q.capabilityKey} is not granted.`, roleSettings,
          `None of their Security Roles (${list(explanation!.securityRoleKeys)}) or direct exceptions grants ${label ?? q.capabilityKey}.`);
      } else {
        set("object", "PASS", `${label ?? q.capabilityKey} is granted (${askedAction.provenance.toLowerCase().replace(/_/g, " ")}).`, roleSettings);
      }
    }
  }
  if (context && alive()) {
    set("field", q.capabilityKey || q.surfaceKey ? "NOT_COVERED" : "NOT_EVALUATED",
      q.capabilityKey || q.surfaceKey ? "Not covered: field restrictions are defined inside each command module; there is no registry to ask yet."
        : "Choose an object and action to check this gate.", []);
  }
  if (context && alive()) {
    const dims = explanation!;
    const recordSettings = [
      s("4.2", "Operational scopes", list(dims.operationalScopes.map((x) => `${x.scopeType} ${x.scopeId}`)), "eos_workforce.employee_operational_scopes"),
      s("2.3", "Work eligibility", list(dims.workEligibility), "eos_workforce.employee_work_eligibility"),
      s("4.1", "Scoped role assignments", list(dims.assignments.scoped.map((x) => `${x.roleKey} @ ${x.scopeType} ${x.scopeValue}`)), "eos_policy.user_role_assignments (scope)"),
    ];
    if (!q.capabilityKey) {
      set("record", "NOT_EVALUATED", q.surfaceKey ? "A page opens a list; each record is checked when it is read." : "Choose an object and action to check this gate.", recordSettings);
    } else if (d?.allowed) {
      set("record", "PASS", Object.keys(q.businessContext).length > 0 ? "The record falls inside this person's reach." : "No record restriction applies to this action.", recordSettings);
    } else if (d && d.needsRecord) {
      set("record", "NOT_EVALUATED", "Access depends on the particular record (for example, being assigned to it); it is decided per record at runtime.", recordSettings);
    } else if (d && d.outcome === "SCOPE_CONTEXT_REQUIRED") {
      const held = dims.scopedHeld.filter((h) => h.capabilityKey === q.capabilityKey).map((h) => `${ASSIGNMENT_SCOPE_DIMENSIONS[h.scopeType as keyof typeof ASSIGNMENT_SCOPE_DIMENSIONS]?.label ?? h.scopeType} ${h.scopeValue}`);
      set("record", "NOT_EVALUATED", `Held only within: ${list(held)}. Name the record's company, warehouse or channel to decide.`, recordSettings);
    } else if (d && d.outcome === "OUTSIDE_ASSIGNMENT_SCOPE") {
      const held = dims.scopedHeld.filter((h) => h.capabilityKey === q.capabilityKey);
      const scopeText = held.map((h) => `${ASSIGNMENT_SCOPE_DIMENSIONS[h.scopeType as keyof typeof ASSIGNMENT_SCOPE_DIMENSIONS]?.label.toLowerCase() ?? h.scopeType} ${h.scopeValue}`);
      const recordText = held.map((h) => {
        const dim = ASSIGNMENT_SCOPE_DIMENSIONS[h.scopeType as keyof typeof ASSIGNMENT_SCOPE_DIMENSIONS];
        return dim ? (q.businessContext as Record<string, string>)[dim.contextKey] : undefined;
      }).filter((v): v is string => typeof v === "string");
      set("record", "FAIL", "The record is outside the scope this access is held in.", recordSettings,
        `They are scoped to ${list(scopeText)}; this record is in ${list([...new Set(recordText)])}.`);
    } else if (d) {
      const words: Record<string, string> = {
        EMPLOYEE_LINK_REQUIRED: "This action needs a linked Employee, and none is linked.",
        WORK_ELIGIBILITY_MISSING: `They lack the work eligibility this action needs${d.detail ? ` (${d.detail})` : ""}.`,
        OUTSIDE_OPERATIONAL_SCOPE: "The record is outside the warehouse, queue or truck they are assigned to work in.",
        NOT_ASSIGNED: "They are not assigned to this record.",
        WORK_ELIGIBILITY_UNMAPPED: "The work eligibility this action needs cannot be decided yet.",
        CONTEXT_AUTHORITY_UNAVAILABLE: "The record-access data could not be consulted, so the answer is refused.",
        SCOPE_NOT_EVALUABLE: "This scope has no consumer for this action, so it grants nothing.",
      };
      const text = words[d.outcome] ?? `The record-access check refused (${d.outcome}).`;
      set("record", "FAIL", text, recordSettings, text);
    }
  }

  // ──────────── 10 PROCESS ────────────
  if (context && alive() && explanation) {
    const caps = q.capabilityKey ? [q.capabilityKey] : pageCaps;
    if (caps.length === 0) {
      set("process", "NOT_EVALUATED", "Choose an object and action to check this gate.", []);
    } else {
      const active = await loadActiveWorkflowDefinitions(reader, tenantId);
      const steps = active.flatMap((w) => w.definition.actions.filter((a) => a.capabilityKey && caps.includes(a.capabilityKey))
        .map((a) => ({ workflow: w.workflow.name ?? w.workflow.key, action: a.key })));
      if (steps.length === 0) {
        set("process", "NOT_APPLICABLE", "No published process step uses this action.", [s("7.2", "Workflow role bindings", "none for this action", "eos_policy.workflow_role_bindings")]);
      } else {
        const derived = deriveWorkflowResponsibilities(principalId, active, explanation as unknown as ExplainedAuthority);
        const mine = derived.responsibilities.filter((r) => r.capabilityKey && caps.includes(r.capabilityKey) && r.source !== "FUNCTIONAL_ROLE_BINDING_ONLY");
        const settings = [s("7.2", "Process steps using this action", steps.map((x) => `${x.workflow}: ${x.action}`).join("; "), "eos_policy.workflow_role_bindings")];
        // INFORMATIONAL, NEVER A REFUSAL. "A binding never grants" (adminPolicy/types.ts:410), and the runtime enforces a binding
        // ONLY on a workflow-instance transition: authorizeWorkflowAction (adminPolicy/workflowEngine.ts:244) is called solely from
        // transitionWorkflowInstance (adminPolicy/workflowInstances.ts:186, reached via eosOps/workflowRuntimeOperations.ts:100).
        // No domain command calls it yet (workflowInstances.ts:11-16, "No domain command calls these yet"), so an action is refused
        // for lack of its capability (the Object gate), never for lack of a binding. Reporting BLOCKED here would claim a refusal
        // the runtime does not make. If a domain command is switched to the engine, restore FAIL and cite that call site.
        if (mine.length > 0) {
          set("process", "PASS", `Can move: ${mine.map((r) => `${r.workflowName}, ${r.actionLabel}`).join("; ")}.`, settings);
        } else {
          set("process", "NOT_APPLICABLE", "No stage responsibility is bound to a role this person holds; the action is decided by its permission.", settings);
        }
      }
    }
  }

  // ──────────── 11 SYSTEM ────────────
  if (context && alive()) {
    const adminCap = q.capabilityKey ? isAdministrationCapability(q.capabilityKey) : false;
    set("system", adminCap ? "NOT_COVERED" : q.capabilityKey || q.surfaceKey ? "NOT_APPLICABLE" : "NOT_EVALUATED",
      adminCap ? "Not covered: the protected rules (anti-lockout, no self-administration, no privilege escalation) apply to a specific change, not to a standing question."
        : q.capabilityKey || q.surfaceKey ? "This is not an administration action." : "Choose an object and action to check this gate.",
      adminCap ? [s("1.13", "Protected Owner and Administrator rules", "applied when a change is made", "adminPolicy/administrationAuthority.ts")] : []);
  }

  // The first refusal stops the request (section 3A.1): every later gate is NOT_EVALUATED, whatever was read above.
  const failIdx = GATE_DEFS.findIndex((x) => done.get(x.key)?.status === "FAIL");
  GATE_DEFS.forEach((g, i) => {
    if (failIdx >= 0 && i > failIdx) done.set(g.key, { status: "NOT_EVALUATED", summary: "Not evaluated: an earlier gate already refused.", failure: null, settings: [] });
    else if (!done.has(g.key)) done.set(g.key, { status: "NOT_EVALUATED", summary: "Not evaluated.", failure: null, settings: [] });
  });

  const gates: AccessGate[] = GATE_DEFS.map((g, i) => Object.freeze({
    step: i + 1, key: g.key, label: g.label, proposedLayer: LAYER[g.key], ...(done.get(g.key) as NonNullable<ReturnType<typeof done.get>>),
  }));
  const failed = gates.find((g) => g.status === "FAIL") ?? null;
  const needsRecord = gates.some((g) => g.key === "record" && g.status === "NOT_EVALUATED" && kind === "ACTION");
  const notCoveredCount = gates.filter((g) => g.status === "NOT_COVERED").length;
  const verdict: AccessVerdict = failed ? "BLOCKED" : kind === "PERSON" ? "OVERVIEW" : needsRecord ? "NEEDS_RECORD"
    : notCoveredCount > 0 ? "ALLOWED_AS_CHECKED" : "ALLOWED";

  return Object.freeze({
    tenantId, principalId,
    question: Object.freeze({ kind, capabilityKey: q.capabilityKey, surfaceKey: q.surfaceKey, label, businessContext: q.businessContext }),
    verdict, notCoveredCount,
    gates: Object.freeze(gates),
    firstFailure: failed ? Object.freeze({ step: failed.step, key: failed.key, label: failed.label, text: `Blocked at: ${failed.label}. ${failed.failure ?? failed.summary}` }) : null,
    layerNamesApproved: false as const,
    ...(kind === "PERSON" ? {
      options: Object.freeze({
        actions: Object.freeze(catalog.map((c) => Object.freeze({ objectKey: c.objectKey, actionKey: c.actionKey, capabilityKey: c.key }))
          .sort((a, b) => a.objectKey === b.objectKey ? a.actionKey.localeCompare(b.actionKey) : a.objectKey.localeCompare(b.objectKey))),
        surfaces: Object.freeze(EXPERIENCE_SURFACES.map((x) => Object.freeze({ key: x.key, label: x.label }))),
      }),
    } : {}),
  });
}
