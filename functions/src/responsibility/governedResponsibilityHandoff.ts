// GOVERNED RESPONSIBILITY HANDOFF — the authoritative handoff boundary (Owner ruling #184, `OD-7`
// option (e)).
//
// ════════════════════ WHAT THIS IS, AND WHY IT IS NOT IN functions/src/ownership/ ════════════════════
//
// #184 ruled the placement question: the authoritative boundary is the GOVERNED ORCHESTRATION layer,
// the pure family/axis builder is RETAINED, and the audit writer keeps audit construction and
// performs no second Employee lookup. This module is that orchestration layer and nothing else — it
// owns the SEQUENCE and owns none of the three jobs the ruling assigned elsewhere.
//
// Every module in `functions/src/ownership/` declares itself pure and I/O-free, and
// `ownershipHandoffCommand.ts`'s purity is load-bearing: it is the ruling's "PURE FAMILY / AXIS
// VALIDATION" layer, and an `await` inside it would end that claim. This module awaits authority
// reads, so it lives in its own directory. The name is `responsibility/` because #187 §1 names the
// composition it belongs to — "OWNERSHIP CENSUS + ACCOUNTABILITY CENSUS + other required governed
// integrity facts → RESPONSIBILITY / ENFORCEMENT GATE" — and because the two axes it governs are two
// axes, so it could not honestly be called `ownership/` anything.
//
// ════════════════════ THE SEQUENCE, AND IT IS THE WHOLE POINT ════════════════════
//
//   AUTHORITATIVE READ → CALLER AUTHORIZATION → TARGET RESOLUTION → CURRENT ELIGIBILITY (where
//   applicable) → PURE FAMILY/AXIS VALIDATION → MUTATION → AUDIT → ATOMIC COMMIT
//
// On failure anywhere: ZERO PARTIAL MUTATION · ZERO PARTIAL AUDIT · ZERO RESPONSIBILITY GAP. Three
// mechanisms hold that, none of which is this comment:
//
//   1. NOTHING IS STAGED UNTIL EVERY CHECK HAS PASSED. Reads, authorization, target resolution,
//      eligibility and pure validation all complete — and the audit event is fully BUILT and
//      validated — before the first `stage*` call. A refusal therefore cannot have written anything,
//      because the only writes are after the last refusal.
//   2. THE MUTATION AND THE AUDIT ARE STAGED IN ONE UNINTERRUPTED BLOCK, with no `await` between
//      them and nothing that can refuse between them. They reach the caller's atomic unit together.
//   3. THE PREVIOUS RESPONSIBILITY IS READ AUTHORITATIVELY, NOT ASSERTED BY THE CALLER. A caller
//      cannot tell this boundary what the record used to say, so a stale client cannot open a
//      responsibility gap by claiming the record was ownerless when it was not.
//
// This module NEVER commits. It stages onto a caller-supplied atomic unit, exactly as
// `stageOwnershipHandoff` does and for the same reason: the business mutation and its audit evidence
// must commit together or not at all, and a function that committed on its own could not offer that.
// `functions/scripts/assignWarehouseRootCompany.js` is the working precedent for the shape.
//
// ════════════════════ THREE AXES, AND NONE IS INFERRED FROM ANOTHER (#187 `M-1`) ════════════════════
//
// #184: "ASSIGNMENT · ACCOUNTABILITY · RECORD OWNERSHIP remain distinct axes... Never infer
// assignment changed → accountability changed, nor accountability changed → ownership changed."
// #187 `M-1` adds that `OD-7` covers ownership and accountability, NOT assignment.
//
// That is enforced STRUCTURALLY here rather than by discipline:
//
//   * the command is a DISCRIMINATED UNION on `axis`. A `RECORD_OWNERSHIP` command has no field that
//     could name an accountable person; an `ACCOUNTABILITY` command has no field that could name an
//     owner. Changing the other axis is not something a caller can express.
//   * `ASSIGNMENT` IS NOT A MEMBER of `RESPONSIBILITY_AXES`, so an assignment cannot travel through
//     this boundary at all. An untyped caller sending it is refused `AXIS_UNSUPPORTED` — which is
//     the correct answer, because ordinary work assignment is not a responsibility handoff and #184
//     explicitly declines to make it one.
//   * the two axes use DIFFERENT PORTS. An ownership handoff never touches the accountability store;
//     an accountability handoff never touches the ownership store. Neither can reach the other's
//     storage even by mistake.
//
// ════════════════════ NO ACCOUNTABILITY STORAGE IS INVENTED HERE ════════════════════
//
// There is no accountability storage in this repository, and this module does not create any. No
// family's stored shape gains an `accountablePerson` field, no collection is named, and no generic
// responsibility framework is built. What exists here is the SMALLEST SEAM the sequence needs —
// `AccountabilityStore` (read the current accountable person, stage the next one) and
// `AccountabilityAuditPort` (stage the accountability audit record) — two interfaces that the future
// governed storage will satisfy.
//
// NEITHER HAS AN IMPLEMENTATION IN THIS REPOSITORY, deliberately, and the reason for the audit half
// is worth stating because it is a real constraint rather than a scoping choice: the governed
// `AuditAction` vocabulary (`functions/src/access/auditEventWriter.ts`) contains exactly one
// ownership action, `OWNERSHIP_HANDOFF`, and NO accountability action. Recording an accountability
// change as an `OWNERSHIP_HANDOFF` — carrying the accountable person in `previousOwner`/`newOwner` —
// would be precisely #187 §1's "accountability must not be redefined as ownership". So this module
// refuses to guess: an accountability handoff requires both ports to be supplied, and refuses
// closed when they are not.
//
// ════════════════════ ELIGIBILITY: CONSUMED, NEVER INVENTED (#189 `MI-ε`) ════════════════════
//
// #189: "Do NOT implement this as `status != ACTIVE → refuse` unless the governed eligibility policy
// for that operation explicitly says so... The gate consumes the governed eligibility result and
// must not flatten the six-value vocabulary into a hidden boolean policy."
//
// So this module declares NO eligibility policy, exports no list of eligible statuses, and contains
// no comparison against any employment status literal. The policy arrives on the command, and the
// verdict comes from `decideAccountabilityEligibility` in the Employee authority port. For the
// ACCOUNTABILITY axis the policy is REQUIRED — a command without one is refused
// `ELIGIBILITY_POLICY_REQUIRED` rather than run under an assumed policy, because an assumed policy is
// the hidden boolean the ruling forbids. For RECORD OWNERSHIP it is optional and enforced when
// present: #189 `MI-ε` rules on accountability, and inventing an ownership eligibility rule here
// would be this module deciding a question no ruling has answered.
//
// ════════════════════ TARGET RESOLUTION HAPPENS EXACTLY ONCE (#184) ════════════════════
//
// "Do NOT duplicate authoritative Employee/person lookups inside the writer... Duplicating that
// lookup in a lower writer would create two authority decisions that could drift." The single lookup
// is `mustResolveEmployeeReference` here, and the audit writer is left synchronous and lookup-free.
// A COMPANY-owned family resolves no Employee at all — a company is not a person, and asking the
// Employee authority about one would be a category error, so the company target is checked against
// the existing governed company authority instead.
//
// ════════════════════ FAIL CLOSED, EVERY BRANCH ════════════════════
//
// #187 §2: `AUTHORITY_UNAVAILABLE` "must FAIL CLOSED. It must not be interpreted as person missing or
// person invalid, must not be represented as healthy empty data, and must not fall back silently."
// Every port here has an "I could not answer" outcome that is DISTINCT from "the answer is no", and
// every one of them refuses the command with its own code. There is no fallback parameter anywhere in
// this file, and no `catch` that converts an unavailable authority into an absent fact.

import {
  decideAccountabilityEligibility,
  mustResolveEmployeeReference,
  EmployeeAuthorityFailure,
  type AccountabilityEligibility,
  type AccountabilityEligibilityPolicy,
  type EmployeeAuthority,
  type EmployeeFacts,
} from "../employeeIdentity/employeeAuthority";
import { classifyDocument } from "../ownership/ownershipCensus";
import { ownershipFamily } from "../ownership/ownershipMatrix";
import { resolveOperatingCompany } from "../ownership/operatingCompanyAuthority";
import { OWNERSHIP_RESOLUTION, OWNER_TYPES, typedOwner, type TypedOwner } from "../ownership/typedOwner";
import { buildOwnershipHandoff, OwnershipHandoffError } from "../ownership/ownershipHandoffCommand";
import { accountabilityFamilyScope } from "./accountabilityFamilyScope";
// TYPE-ONLY, and that is deliberate: the audit event SHAPE is the governed writer's, and staging it
// is the governed writer's job. This module never imports the writer's runtime, so it cannot stage an
// audit event by itself — it is handed a port that does.
import type { OwnershipHandoffSource, RecordAuditEventInput } from "../access/auditEventWriter";

/**
 * The axes this boundary governs. TWO, per #187 `M-1`: "`OD-7` covers ownership and accountability,
 * not assignment." ASSIGNMENT is absent on purpose and its absence is tested.
 */
export const RESPONSIBILITY_AXES = Object.freeze(["RECORD_OWNERSHIP", "ACCOUNTABILITY"] as const);

export type ResponsibilityAxis = (typeof RESPONSIBILITY_AXES)[number];

/** Every way this boundary refuses. Distinct codes, because they are distinct facts. */
export type GovernedResponsibilityRefusalCode =
  /** The requested axis is not one this boundary governs — ASSIGNMENT included. */
  | "AXIS_UNSUPPORTED"
  /** The command's own shape is unusable (missing tenant, record, actor, target). */
  | "COMMAND_INVALID"
  /** The authoritative read said the record does not exist. Nothing to hand off. */
  | "RECORD_NOT_FOUND"
  /** The authoritative read could not answer. FAIL CLOSED — not "the record is empty". */
  | "AUTHORITATIVE_READ_UNAVAILABLE"
  /** The stored current responsibility cannot be read as a governed reference (#189 `MI-λ`). */
  | "CURRENT_RESPONSIBILITY_UNRESOLVED"
  /** The caller's stated expectation of the current value does not match the authoritative read. */
  | "PRECONDITION_STALE"
  /** The caller may not perform this change. */
  | "CALLER_NOT_AUTHORIZED"
  /** The authorization decision could not be obtained. FAIL CLOSED. */
  | "CALLER_AUTHORIZATION_UNAVAILABLE"
  /** The target Employee reference does not validly resolve, or could never be an id (#186 case D). */
  | "TARGET_EMPLOYEE_INVALID"
  /** EOS could not obtain an authoritative Employee answer (#187 §2). FAIL CLOSED. */
  | "TARGET_AUTHORITY_UNAVAILABLE"
  /** The target company is not a governed operating company. */
  | "TARGET_COMPANY_INVALID"
  /** A governed eligibility policy is required for this axis and none was supplied (#189 `MI-ε`). */
  | "ELIGIBILITY_POLICY_REQUIRED"
  /** A real, valid Employee who is NOT CURRENTLY ELIGIBLE. #189 `MI-ε`: refuse. */
  | "TARGET_NOT_CURRENTLY_ELIGIBLE"
  /** The family is outside the governed accountability scope (#189 `OD-16`). NOT a record defect. */
  | "FAMILY_NOT_ACCOUNTABLE"
  /** The named family is not in the governed ownership matrix at all — the matrix is the allow-list. */
  | "FAMILY_UNGOVERNED"
  /** The family has no single governed ownership field to write. Fail closed rather than guess. */
  | "OWNERSHIP_STORAGE_UNRESOLVED"
  /** The port this axis needs was not supplied. FAIL CLOSED — never a silent no-op. */
  | "PORT_UNAVAILABLE"
  /** Staging failed after the checks passed. The atomic unit MUST be abandoned, not committed. */
  | "STAGING_FAILED";

/**
 * The refusal. `code` is the governed fact; `builderCode` carries the pure validator's own refusal
 * code unchanged when the pure layer is what refused, so a family/axis refusal is not flattened into
 * a generic one.
 */
export class GovernedResponsibilityHandoffError extends Error {
  constructor(
    readonly code: GovernedResponsibilityRefusalCode,
    message: string,
    /** The pure builder's code (`FAMILY_IMMUTABLE`, `NO_OP`, `OWNER_TYPE_MISMATCH`, …) when it refused. */
    readonly builderCode?: string,
  ) {
    super(message);
    this.name = "GovernedResponsibilityHandoffError";
  }
}

// ════════════════════ THE PORTS ════════════════════

/** The one record this command acts on. Tenant-scoped, because an Employee reference is. */
export interface ResponsibilityTarget {
  readonly tenantId: string;
  readonly family: string;
  readonly recordId: string;
}

/** What the caller is asking to do, as the authorization layer sees it. */
export interface ResponsibilityAuthorizationRequest {
  readonly actorUid: string;
  readonly axis: ResponsibilityAxis;
  readonly target: ResponsibilityTarget;
}

/**
 * THREE outcomes, never a boolean. "Denied" and "I could not decide" are different sentences and the
 * second one must fail closed, which a boolean cannot express.
 */
export type ResponsibilityAuthorizationDecision =
  | { readonly outcome: "ALLOWED" }
  | { readonly outcome: "DENIED"; readonly reason: string }
  | { readonly outcome: "AUTHORIZATION_UNAVAILABLE"; readonly detail: string };

/**
 * Caller authorization, as a PORT.
 *
 * It is injected rather than wired to the capability catalogue here for a reason that is a
 * constraint, not a preference: the capabilities that would gate these commands are registered
 * `active: false`, and activating one is a separate governed decision this boundary has no standing
 * to make. A port keeps the sequence complete and provable while leaving activation where it belongs.
 */
export interface ResponsibilityCallerAuthority {
  authorizeResponsibilityChange(
    request: ResponsibilityAuthorizationRequest,
  ): Promise<ResponsibilityAuthorizationDecision>;
}

/** The authoritative read of one record's stored fields. THREE outcomes; the third fails closed. */
export type AuthoritativeRecordRead =
  | { readonly outcome: "READ"; readonly fields: Readonly<Record<string, unknown>> }
  | { readonly outcome: "RECORD_NOT_FOUND" }
  | { readonly outcome: "READ_UNAVAILABLE"; readonly detail: string };

/**
 * RECORD OWNERSHIP storage, as a port.
 *
 * `stageOwnerFieldWrite` takes the TYPED OWNER rather than a raw string, and takes the field name,
 * because the STORAGE SHAPE belongs to storage: `ownerEmployeeId` holds a bare id, `owner` holds a
 * typed-owner map, and `accountOwner` holds a Person Assignment map. An orchestrator that shaped those
 * itself would be a fourth place that knows the storage layout. It MUST NOT commit.
 */
export interface OwnershipRecordPort {
  readAuthoritative(target: ResponsibilityTarget): Promise<AuthoritativeRecordRead>;
  stageOwnerFieldWrite(target: ResponsibilityTarget, field: string, owner: TypedOwner): void;
}

/** Stage one already-validated `OWNERSHIP_HANDOFF` event onto the same atomic unit. Returns its id. */
export interface OwnershipAuditPort {
  stageOwnershipHandoffEvent(event: RecordAuditEventInput): string;
}

/** The authoritative read of the current accountable person. `null` = genuinely none, never a guess. */
export type AccountablePersonRead =
  | { readonly outcome: "READ"; readonly accountableEmployeeId: string | null }
  | { readonly outcome: "RECORD_NOT_FOUND" }
  | { readonly outcome: "READ_UNAVAILABLE"; readonly detail: string };

/**
 * THE ACCOUNTABILITY SEAM — the smallest contract the sequence needs, and NOT an implementation.
 *
 * There is no accountability storage in this repository. This interface says what the future governed
 * storage must be able to do and nothing about where it lives, what collection or table holds it, or
 * what the field is called. Nothing in this repository implements it.
 */
export interface AccountabilityStore {
  readCurrentAccountablePerson(target: ResponsibilityTarget): Promise<AccountablePersonRead>;
  stageAccountablePersonWrite(target: ResponsibilityTarget, accountableEmployeeId: string): void;
}

/**
 * The accountability audit record, as the boundary produces it.
 *
 * NOT a `RecordAuditEventInput`: the governed `AuditAction` vocabulary has no accountability action,
 * and reusing `OWNERSHIP_HANDOFF` would redefine accountability as ownership (#187 §1). The
 * eligibility policy id rides along because #189 makes the eligibility answer a governed fact and a
 * governed fact needs a stated author.
 */
export interface AccountabilityHandoffRecord {
  readonly actorUid: string;
  readonly target: ResponsibilityTarget;
  readonly previousAccountableEmployeeId: string | null;
  readonly newAccountableEmployeeId: string;
  readonly eligibilityPolicyId: string;
  readonly reason?: string;
}

/** Stage the accountability audit record onto the same atomic unit. Returns its id. */
export interface AccountabilityAuditPort {
  stageAccountabilityHandoff(record: AccountabilityHandoffRecord): string;
}

/**
 * The ports one call may use. Each axis needs its own pair and neither can see the other's.
 *
 * They are OPTIONAL in the type and REQUIRED at runtime for the axis that needs them, so a caller
 * that forgets one is refused `PORT_UNAVAILABLE` rather than silently doing half the sequence.
 */
export interface GovernedResponsibilityHandoffDeps {
  readonly callerAuthority: ResponsibilityCallerAuthority;
  readonly employeeAuthority: EmployeeAuthority;
  readonly ownershipRecords?: OwnershipRecordPort;
  readonly ownershipAudit?: OwnershipAuditPort;
  readonly accountabilityStore?: AccountabilityStore;
  readonly accountabilityAudit?: AccountabilityAuditPort;
}

// ════════════════════ THE COMMANDS ════════════════════

interface ResponsibilityCommandBase {
  readonly tenantId: string;
  readonly family: string;
  readonly recordId: string;
  readonly actorUid: string;
  /** Optional free text, held to the audit writer's own length and secret guards. */
  readonly reason?: string;
  /**
   * The value the caller BELIEVES is current, for optimistic concurrency. Optional, and it is a
   * CROSS-CHECK rather than the source of truth: the previous value always comes from the
   * authoritative read, so omitting this cannot let a caller rewrite history, it only gives up the
   * detection of a concurrent change.
   */
  readonly expectedCurrentId?: string | null;
}

/** Change WHO OWNS THE RECORD. Carries no accountability field, because it changes no accountability. */
export interface RecordOwnershipHandoffCommand extends ResponsibilityCommandBase {
  readonly axis: "RECORD_OWNERSHIP";
  /** The new owner. Its `type` must match the family's governed owner type — the builder enforces it. */
  readonly newOwner: TypedOwner;
  /** Which authority this handoff came from. The governed `OWNERSHIP_HANDOFF` source vocabulary. */
  readonly source: OwnershipHandoffSource;
  /**
   * Optional for this axis. #189 `MI-ε` rules on ACCOUNTABILITY eligibility; no ruling establishes an
   * ownership eligibility policy, so this boundary enforces one only when the operation states one.
   */
  readonly eligibilityPolicy?: AccountabilityEligibilityPolicy;
}

/** Change WHO IS ACCOUNTABLE. Carries no owner field, because it changes no ownership. */
export interface AccountabilityHandoffCommand extends ResponsibilityCommandBase {
  readonly axis: "ACCOUNTABILITY";
  /** The Employee who becomes accountable. A person, always — accountability is personal (#180). */
  readonly newAccountableEmployeeId: string;
  /** REQUIRED. #189 `MI-ε`: the gate consumes a governed policy and must not assume one. */
  readonly eligibilityPolicy: AccountabilityEligibilityPolicy;
}

export type GovernedResponsibilityHandoffCommand =
  | RecordOwnershipHandoffCommand
  | AccountabilityHandoffCommand;

/** What committed — reported per axis, so a caller can prove which axis moved and which did not. */
export interface GovernedResponsibilityHandoffResult {
  readonly axis: ResponsibilityAxis;
  readonly target: ResponsibilityTarget;
  /** The authoritative previous value. `null` when the record genuinely had none. */
  readonly previousId: string | null;
  readonly newId: string;
  /** The id of the staged audit record. Present always — an unaudited handoff is not a handoff. */
  readonly auditEventId: string;
  /** The single stored field written, for RECORD_OWNERSHIP. `null` for ACCOUNTABILITY (seam). */
  readonly mutatedOwnerField: string | null;
  /** Present only when a governed policy was consumed. Never synthesised. */
  readonly eligibility?: AccountabilityEligibility;
}

// ════════════════════ THE ORCHESTRATOR ════════════════════

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function refuse(
  code: GovernedResponsibilityRefusalCode,
  message: string,
  builderCode?: string,
): never {
  throw new GovernedResponsibilityHandoffError(code, message, builderCode);
}

/** Turn the Employee authority's fail-closed failure into this boundary's refusal, code intact. */
function refuseFromAuthorityFailure(err: EmployeeAuthorityFailure): never {
  if (err.code === "EMPLOYEE_AUTHORITY_UNAVAILABLE") {
    // #187 §2: NOT "the person is missing". Its own code, so the audit trail keeps the distinction.
    refuse("TARGET_AUTHORITY_UNAVAILABLE", err.message, err.code);
  }
  refuse("TARGET_EMPLOYEE_INVALID", err.message, err.code);
}

async function resolveTargetEmployee(
  authority: EmployeeAuthority,
  tenantId: string,
  employeeId: string,
): Promise<EmployeeFacts> {
  try {
    return await mustResolveEmployeeReference(authority, { tenantId, employeeId });
  } catch (err) {
    if (err instanceof EmployeeAuthorityFailure) refuseFromAuthorityFailure(err);
    // An authority that threw something else did not give us an authoritative answer either, and
    // #187 §2 forbids reading that as a verdict about the person.
    refuse(
      "TARGET_AUTHORITY_UNAVAILABLE",
      `the Employee authority threw a non-governed error for ${employeeId} in tenant ${tenantId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * CURRENT ELIGIBILITY, where applicable. Consumes the governed policy; decides nothing itself.
 *
 * #189 `MI-ε`. The verdict comes from `decideAccountabilityEligibility`, and the refusal quotes the
 * lifecycle status and the policy id so the audit record carries three separate facts rather than one
 * bit: the reference resolved, the status is what it is, and this policy does not accept it.
 */
function requireCurrentEligibility(
  employee: EmployeeFacts,
  policy: AccountabilityEligibilityPolicy,
): AccountabilityEligibility {
  const eligibility = decideAccountabilityEligibility(employee, policy);
  if (!eligibility.eligible) {
    refuse(
      "TARGET_NOT_CURRENTLY_ELIGIBLE",
      `Employee ${employee.employeeId} is a VALID reference but is NOT CURRENTLY ELIGIBLE under ` +
        `governed policy ${policy.policyId} (lifecycle status ${employee.employmentStatus}). The ` +
        "reference and any historical responsibility remain valid; this new/changed responsibility is refused.",
    );
  }
  return eligibility;
}

function assertCommandShape(command: GovernedResponsibilityHandoffCommand): ResponsibilityTarget {
  if (!command || typeof command !== "object") refuse("COMMAND_INVALID", "missing command");
  if (!(RESPONSIBILITY_AXES as readonly string[]).includes(command.axis)) {
    refuse(
      "AXIS_UNSUPPORTED",
      `"${String((command as { axis?: unknown }).axis)}" is not a governed responsibility axis. ` +
        `This boundary governs ${RESPONSIBILITY_AXES.join(" and ")} only — ASSIGNMENT is a separate ` +
        "axis and changing it is not a responsibility handoff (#187 M-1).",
    );
  }
  if (!nonEmpty(command.tenantId)) refuse("COMMAND_INVALID", "tenantId is required");
  if (!nonEmpty(command.recordId)) refuse("COMMAND_INVALID", "recordId is required");
  if (!nonEmpty(command.actorUid)) refuse("COMMAND_INVALID", "actorUid is required");
  if (!nonEmpty(command.family)) refuse("COMMAND_INVALID", "family is required");
  return {
    tenantId: command.tenantId.trim(),
    family: command.family,
    recordId: command.recordId.trim(),
  };
}

async function authorizeCaller(
  deps: GovernedResponsibilityHandoffDeps,
  request: ResponsibilityAuthorizationRequest,
): Promise<void> {
  let decision: ResponsibilityAuthorizationDecision;
  try {
    decision = await deps.callerAuthority.authorizeResponsibilityChange(request);
  } catch (err) {
    refuse(
      "CALLER_AUTHORIZATION_UNAVAILABLE",
      `the authorization decision could not be obtained: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  switch (decision?.outcome) {
    case "ALLOWED":
      return;
    case "DENIED":
      refuse(
        "CALLER_NOT_AUTHORIZED",
        `${request.actorUid} may not change ${request.axis} on ${request.target.family} ` +
          `${request.target.recordId}: ${decision.reason}`,
      );
      break;
    case "AUTHORIZATION_UNAVAILABLE":
      refuse("CALLER_AUTHORIZATION_UNAVAILABLE", decision.detail);
      break;
    default:
      // An unrecognised decision is not an approval. There is no default-allow branch in this file.
      refuse(
        "CALLER_AUTHORIZATION_UNAVAILABLE",
        `the authorization port returned an unrecognised decision: ${JSON.stringify(decision)}`,
      );
  }
}

function assertPrecondition(expected: string | null | undefined, actual: string | null): void {
  if (expected === undefined) return;
  if (expected !== actual) {
    refuse(
      "PRECONDITION_STALE",
      `the caller expected the current value to be ${expected === null ? "(none)" : expected} but the ` +
        `authoritative read says ${actual === null ? "(none)" : actual}. Refusing on stale evidence ` +
        "rather than overwriting a change made since.",
    );
  }
}

/**
 * The RECORD OWNERSHIP path.
 *
 * The ruling's five steps, in order, with the pure builder doing C and this function doing nothing
 * the builder already does — no family list, no owner-type table, no no-op rule of its own.
 */
async function handoffRecordOwnership(
  deps: GovernedResponsibilityHandoffDeps,
  command: RecordOwnershipHandoffCommand,
  target: ResponsibilityTarget,
): Promise<GovernedResponsibilityHandoffResult> {
  const records = deps.ownershipRecords;
  const audit = deps.ownershipAudit;
  if (!records || !audit) {
    refuse(
      "PORT_UNAVAILABLE",
      "a RECORD_OWNERSHIP handoff requires both an ownership record port and an ownership audit port. " +
        "Refusing rather than performing a partial sequence.",
    );
  }

  // The family is looked up FIRST because the storage field the read must inspect comes from it. The
  // builder validates the family again on its own terms; this is not that check, it is "which field".
  const family = ownershipFamily(command.family);
  if (family === null) {
    // A DIFFERENT refusal from OWNERSHIP_STORAGE_UNRESOLVED below, and the distinction is the one the
    // pure builder already draws: an ungoverned family is not in the allow-list at all, while a
    // governed family with no ownership field is governed and simply has nowhere to write yet.
    refuse(
      "FAMILY_UNGOVERNED",
      `"${String(command.family)}" is not a governed ownership family — the matrix is the allow-list, ` +
        "not a hint",
      "FAMILY_UNKNOWN",
    );
  }
  if (family.ownerFields.length !== 1) {
    // 0 = the family has no ownership storage yet, so there is no field to mutate and a governed
    // MUTATION cannot happen (the pure builder can still produce the event; this boundary mutates).
    // >1 = ambiguous, and picking one would be this module inventing a governed decision.
    refuse(
      "OWNERSHIP_STORAGE_UNRESOLVED",
      `${family.family} declares ${family.ownerFields.length} ownership field(s) ` +
        `(${family.ownerFields.join(", ") || "none"}); a governed mutation needs exactly one. ` +
        "Fail closed rather than choose.",
    );
  }
  const ownerField = family.ownerFields[0];

  // ── A. AUTHORITATIVE READ ───────────────────────────────────────────────────────────────────────
  const read = await records.readAuthoritative(target);
  if (read.outcome === "RECORD_NOT_FOUND") {
    refuse("RECORD_NOT_FOUND", `${target.family} ${target.recordId} does not exist`);
  }
  if (read.outcome !== "READ") {
    // FAIL CLOSED. An unavailable read is not an empty record.
    refuse(
      "AUTHORITATIVE_READ_UNAVAILABLE",
      `the authoritative read of ${target.family} ${target.recordId} could not be obtained: ${read.detail}`,
    );
  }

  // The CURRENT owner comes from the record, derived by the existing pure projection — the same one
  // the census uses, so the boundary and the measurement cannot disagree about what a record says.
  const derived = classifyDocument(family, { ...read.fields });
  let previousOwner: TypedOwner | null;
  switch (derived.resolution) {
    case OWNERSHIP_RESOLUTION.RESOLVED:
      previousOwner = derived.owner;
      break;
    case OWNERSHIP_RESOLUTION.OWNERLESS:
      // A STATED FACT, not a fallback: this record genuinely has no owner, and the first handoff of
      // such a record is a real event the builder accepts with previousOwner = null.
      previousOwner = null;
      break;
    default:
      // #189 `MI-λ`: a reference that does not resolve must not be "fabricated", "silently mapped",
      // or "counted as a valid resolved Employee reference" — and for a CURRENT ACTIONABLE record,
      // "FAIL CLOSED". Treating it as null here would quietly erase a legacy unresolved reference.
      refuse(
        "CURRENT_RESPONSIBILITY_UNRESOLVED",
        `the stored owner of ${target.family} ${target.recordId} is ${derived.resolution}` +
          `${derived.reason === null ? "" : ` (${derived.reason})`}. A handoff from a state EOS cannot ` +
          "read authoritatively is refused; the existing reference is preserved, not overwritten.",
      );
  }
  assertPrecondition(command.expectedCurrentId, previousOwner === null ? null : previousOwner.id);

  // ── B. CALLER AUTHORIZATION ─────────────────────────────────────────────────────────────────────
  await authorizeCaller(deps, { actorUid: command.actorUid, axis: command.axis, target });

  // ── C. TARGET RESOLUTION, and it happens exactly once ───────────────────────────────────────────
  let eligibility: AccountabilityEligibility | undefined;
  if (!command.newOwner || typeof command.newOwner !== "object" || !nonEmpty(command.newOwner.id)) {
    // The builder refuses this too; this early check exists so the target-resolution step below has
    // an id to resolve rather than resolving `undefined` against the Employee authority.
    refuse("COMMAND_INVALID", "newOwner must be a typed owner with a non-empty id");
  }
  if (command.newOwner.type === OWNER_TYPES.USER) {
    const employee = await resolveTargetEmployee(
      deps.employeeAuthority,
      target.tenantId,
      command.newOwner.id,
    );
    // ── D. CURRENT ELIGIBILITY, WHERE APPLICABLE ─────────────────────────────────────────────────
    if (command.eligibilityPolicy !== undefined) {
      eligibility = requireCurrentEligibility(employee, command.eligibilityPolicy);
    }
  } else {
    // A company is not a person. #187 `M-1`/#184: no Employee lookup for a company target, and no
    // second authority either — the existing governed company authority answers.
    const company = resolveOperatingCompany(command.newOwner.id);
    if (company.company === null) {
      refuse(
        "TARGET_COMPANY_INVALID",
        `${command.newOwner.id} is not a governed operating company (${company.state})`,
      );
    }
  }

  // ── E. PURE FAMILY / AXIS VALIDATION — the RETAINED builder, composed, not reimplemented ────────
  let event: RecordAuditEventInput;
  try {
    event = buildOwnershipHandoff(
      {
        family: command.family,
        recordId: target.recordId,
        previousOwner,
        newOwner: command.newOwner,
        source: command.source,
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      },
      { actorUid: command.actorUid },
    );
  } catch (err) {
    if (err instanceof OwnershipHandoffError) {
      // The builder's code is carried through unchanged — NO_OP stays NO_OP, FAMILY_IMMUTABLE stays
      // FAMILY_IMMUTABLE. Flattening them would lose the refusal vocabulary #184 says to retain.
      refuse("COMMAND_INVALID", err.message, err.code);
    }
    throw err;
  }

  // ── F. MUTATION + G. AUDIT — one uninterrupted block, no await, nothing that can refuse ─────────
  // Everything above has passed and the event is BUILT AND VALIDATED. From here the only failures are
  // the writer's own, and a throw must abandon the whole atomic unit rather than commit half of it.
  let auditEventId: string;
  try {
    records.stageOwnerFieldWrite(target, ownerField, command.newOwner);
    auditEventId = audit.stageOwnershipHandoffEvent(event);
  } catch (err) {
    refuse(
      "STAGING_FAILED",
      `staging the ownership handoff for ${target.family} ${target.recordId} failed after every ` +
        `check passed: ${err instanceof Error ? err.message : String(err)}. The atomic unit MUST be ` +
        "abandoned — a staged mutation without its audit event is the partial state the ruling forbids.",
    );
  }

  // ── H. ATOMIC COMMIT is the CALLER's, on the unit both were staged onto. Never this function's. ──
  return {
    axis: "RECORD_OWNERSHIP",
    target,
    previousId: previousOwner === null ? null : previousOwner.id,
    newId: command.newOwner.id,
    auditEventId,
    mutatedOwnerField: ownerField,
    ...(eligibility === undefined ? {} : { eligibility }),
  };
}

/**
 * The ACCOUNTABILITY path.
 *
 * Same sequence, different axis, and it touches NO ownership storage — not the record port, not the
 * ownership audit port, not `ownerFields`. #187 §1: accountability must not be redefined as ownership.
 */
async function handoffAccountability(
  deps: GovernedResponsibilityHandoffDeps,
  command: AccountabilityHandoffCommand,
  target: ResponsibilityTarget,
): Promise<GovernedResponsibilityHandoffResult> {
  const store = deps.accountabilityStore;
  const audit = deps.accountabilityAudit;
  if (!store || !audit) {
    refuse(
      "PORT_UNAVAILABLE",
      "an ACCOUNTABILITY handoff requires both an accountability store and an accountability audit " +
        "port. Neither is implemented in this repository yet (no accountability storage exists, and " +
        "the governed AuditAction vocabulary has no accountability action), so this axis refuses " +
        "closed rather than recording an accountability change as an ownership handoff.",
    );
  }

  // ── PURE FAMILY APPLICABILITY, first, because #189 `OD-16` makes it a precondition on the FAMILY ──
  // NOT_APPLICABLE is a statement about the family. It is NOT "this record is missing an accountable
  // person" and must never be reported as a defect.
  if (accountabilityFamilyScope(command.family) !== "IN_SCOPE") {
    refuse(
      "FAMILY_NOT_ACCOUNTABLE",
      `${command.family} is outside the governed accountability scope, so accountability is NOT ` +
        "APPLICABLE to it — not MISSING, not OWNERLESS, not DEFECTIVE (#189 OD-16). A family enters " +
        "scope only when governed authority admits it.",
    );
  }
  if (!nonEmpty(command.newAccountableEmployeeId)) {
    refuse("COMMAND_INVALID", "newAccountableEmployeeId is required");
  }
  // #189 `MI-ε`. No policy means no governed eligibility answer, and this boundary will not assume one.
  if (!command.eligibilityPolicy || !nonEmpty(command.eligibilityPolicy.policyId)) {
    refuse(
      "ELIGIBILITY_POLICY_REQUIRED",
      "an ACCOUNTABILITY handoff requires a governed eligibility policy with a stated policyId. " +
        "Assuming one here would be the hidden boolean policy #189 MI-ε forbids.",
    );
  }
  const newId = command.newAccountableEmployeeId.trim();

  // ── A. AUTHORITATIVE READ ───────────────────────────────────────────────────────────────────────
  const read = await store.readCurrentAccountablePerson(target);
  if (read.outcome === "RECORD_NOT_FOUND") {
    refuse("RECORD_NOT_FOUND", `${target.family} ${target.recordId} does not exist`);
  }
  if (read.outcome !== "READ") {
    refuse(
      "AUTHORITATIVE_READ_UNAVAILABLE",
      `the authoritative accountability read of ${target.family} ${target.recordId} could not be ` +
        `obtained: ${read.detail}`,
    );
  }
  const previousId = read.accountableEmployeeId;
  if (previousId !== null && !nonEmpty(previousId)) {
    refuse(
      "CURRENT_RESPONSIBILITY_UNRESOLVED",
      `the stored accountable person of ${target.family} ${target.recordId} is neither a usable id ` +
        "nor an honest null. Fail closed (#189 MI-λ) rather than overwrite an unreadable reference.",
    );
  }
  assertPrecondition(command.expectedCurrentId, previousId);

  // ── B. CALLER AUTHORIZATION ─────────────────────────────────────────────────────────────────────
  await authorizeCaller(deps, { actorUid: command.actorUid, axis: command.axis, target });

  // ── C. TARGET RESOLUTION ────────────────────────────────────────────────────────────────────────
  const employee = await resolveTargetEmployee(deps.employeeAuthority, target.tenantId, newId);

  // ── D. CURRENT ELIGIBILITY — MANDATORY on this axis ─────────────────────────────────────────────
  const eligibility = requireCurrentEligibility(employee, command.eligibilityPolicy);

  // ── E. PURE AXIS VALIDATION — the no-op rule, restated for this axis ───────────────────────────
  // The same reason the ownership builder gives: "a handoff that moves nothing is not an event".
  if (previousId !== null && previousId === newId) {
    refuse(
      "COMMAND_INVALID",
      `${newId} is already the accountable person for ${target.family} ${target.recordId} — a handoff ` +
        "that moves nothing is not an event",
      "NO_OP",
    );
  }

  // ── F. MUTATION + G. AUDIT — one uninterrupted block ────────────────────────────────────────────
  let auditEventId: string;
  try {
    store.stageAccountablePersonWrite(target, newId);
    auditEventId = audit.stageAccountabilityHandoff({
      actorUid: command.actorUid,
      target,
      previousAccountableEmployeeId: previousId,
      newAccountableEmployeeId: newId,
      eligibilityPolicyId: eligibility.policyId,
      ...(command.reason === undefined ? {} : { reason: command.reason }),
    });
  } catch (err) {
    refuse(
      "STAGING_FAILED",
      `staging the accountability handoff for ${target.family} ${target.recordId} failed after every ` +
        `check passed: ${err instanceof Error ? err.message : String(err)}. The atomic unit MUST be abandoned.`,
    );
  }

  return {
    axis: "ACCOUNTABILITY",
    target,
    previousId,
    newId,
    auditEventId,
    // NULL, and it is a fact rather than an omission: this axis wrote NO ownership field, and a
    // reader can prove from the result that no ownership storage was touched.
    mutatedOwnerField: null,
    eligibility,
  };
}

/**
 * THE GOVERNED RESPONSIBILITY HANDOFF BOUNDARY.
 *
 * Stages ONE single-axis responsibility change and its audit evidence onto the caller's atomic unit,
 * or refuses having staged nothing at all. The caller commits.
 *
 * NOT EXPORTED FROM `functions/src/index.ts`, and that is a governed constraint rather than an
 * oversight: every capability that would gate such a command is registered `active: false`, and
 * exporting a callable that needed one activated would be this wave activating a capability. #184 was
 * ruled before any surface existed precisely so the placement would be free, so the boundary ships as
 * a composable, fully-tested server-side unit and the surface is a separate, separately-authorized
 * decision.
 */
export async function stageGovernedResponsibilityHandoff(
  deps: GovernedResponsibilityHandoffDeps,
  command: GovernedResponsibilityHandoffCommand,
): Promise<GovernedResponsibilityHandoffResult> {
  const target = assertCommandShape(command);
  if (!deps || !deps.callerAuthority || !deps.employeeAuthority) {
    refuse(
      "PORT_UNAVAILABLE",
      "the caller authority and the Employee authority are both required. A boundary missing either " +
        "cannot authorize or resolve, and proceeding would be the silent fallback #187 §2 forbids.",
    );
  }
  switch (command.axis) {
    case "RECORD_OWNERSHIP":
      return handoffRecordOwnership(deps, command, target);
    case "ACCOUNTABILITY":
      return handoffAccountability(deps, command, target);
    default:
      return assertExhaustive(command);
  }
}

/** A `never` that names what was unhandled, so a new axis breaks the build rather than a request. */
function assertExhaustive(value: never): never {
  throw new GovernedResponsibilityHandoffError(
    "AXIS_UNSUPPORTED",
    `unhandled responsibility axis: ${JSON.stringify(value)}`,
  );
}

/**
 * Build a typed owner for a PERSON target, so a caller naming an Employee cannot accidentally build a
 * COMPANY owner. A thin, honest convenience over the existing pure constructor — it adds no policy.
 */
export function personOwner(employeeId: unknown): TypedOwner | null {
  return typedOwner(OWNER_TYPES.USER, employeeId);
}

/** The same, for a COMPANY target. */
export function companyOwner(companyId: unknown): TypedOwner | null {
  return typedOwner(OWNER_TYPES.COMPANY, companyId);
}
