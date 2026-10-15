"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GovernedResponsibilityHandoffError = exports.RESPONSIBILITY_AXES = void 0;
exports.stageGovernedResponsibilityHandoff = stageGovernedResponsibilityHandoff;
exports.personOwner = personOwner;
exports.companyOwner = companyOwner;
const employeeAuthority_1 = require("../employeeIdentity/employeeAuthority");
const ownershipCensus_1 = require("../ownership/ownershipCensus");
const ownershipMatrix_1 = require("../ownership/ownershipMatrix");
const operatingCompanyAuthority_1 = require("../ownership/operatingCompanyAuthority");
const typedOwner_1 = require("../ownership/typedOwner");
const ownershipHandoffCommand_1 = require("../ownership/ownershipHandoffCommand");
const accountabilityFamilyScope_1 = require("./accountabilityFamilyScope");
const accountablePersonStorage_1 = require("./accountablePersonStorage");
/**
 * The axes this boundary governs. TWO, per #187 `M-1`: "`OD-7` covers ownership and accountability,
 * not assignment." ASSIGNMENT is absent on purpose and its absence is tested.
 */
exports.RESPONSIBILITY_AXES = Object.freeze(["RECORD_OWNERSHIP", "ACCOUNTABILITY"]);
/**
 * The refusal. `code` is the governed fact; `builderCode` carries the pure validator's own refusal
 * code unchanged when the pure layer is what refused, so a family/axis refusal is not flattened into
 * a generic one.
 */
class GovernedResponsibilityHandoffError extends Error {
    code;
    builderCode;
    constructor(code, message, 
    /** The pure builder's code (`FAMILY_IMMUTABLE`, `NO_OP`, `OWNER_TYPE_MISMATCH`, …) when it refused. */
    builderCode) {
        super(message);
        this.code = code;
        this.builderCode = builderCode;
        this.name = "GovernedResponsibilityHandoffError";
    }
}
exports.GovernedResponsibilityHandoffError = GovernedResponsibilityHandoffError;
// ════════════════════ THE ORCHESTRATOR ════════════════════
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
function refuse(code, message, builderCode) {
    throw new GovernedResponsibilityHandoffError(code, message, builderCode);
}
/** Turn the Employee authority's fail-closed failure into this boundary's refusal, code intact. */
function refuseFromAuthorityFailure(err) {
    if (err.code === "EMPLOYEE_AUTHORITY_UNAVAILABLE") {
        // #187 §2: NOT "the person is missing". Its own code, so the audit trail keeps the distinction.
        refuse("TARGET_AUTHORITY_UNAVAILABLE", err.message, err.code);
    }
    refuse("TARGET_EMPLOYEE_INVALID", err.message, err.code);
}
async function resolveTargetEmployee(authority, tenantId, employeeId) {
    try {
        return await (0, employeeAuthority_1.mustResolveEmployeeReference)(authority, { tenantId, employeeId });
    }
    catch (err) {
        if (err instanceof employeeAuthority_1.EmployeeAuthorityFailure)
            refuseFromAuthorityFailure(err);
        // An authority that threw something else did not give us an authoritative answer either, and
        // #187 §2 forbids reading that as a verdict about the person.
        refuse("TARGET_AUTHORITY_UNAVAILABLE", `the Employee authority threw a non-governed error for ${employeeId} in tenant ${tenantId}: ` +
            `${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * CURRENT ELIGIBILITY, where applicable. Consumes the governed policy; decides nothing itself.
 *
 * #189 `MI-ε`. The verdict comes from `decideAccountabilityEligibility`, and the refusal quotes the
 * lifecycle status and the policy id so the audit record carries three separate facts rather than one
 * bit: the reference resolved, the status is what it is, and this policy does not accept it.
 */
function requireCurrentEligibility(employee, policy) {
    const eligibility = (0, employeeAuthority_1.decideAccountabilityEligibility)(employee, policy);
    if (!eligibility.eligible) {
        refuse("TARGET_NOT_CURRENTLY_ELIGIBLE", `Employee ${employee.employeeId} is a VALID reference but is NOT CURRENTLY ELIGIBLE under ` +
            `governed policy ${policy.policyId} (lifecycle status ${employee.employmentStatus}). The ` +
            "reference and any historical responsibility remain valid; this new/changed responsibility is refused.");
    }
    return eligibility;
}
function assertCommandShape(command) {
    if (!command || typeof command !== "object")
        refuse("COMMAND_INVALID", "missing command");
    if (!exports.RESPONSIBILITY_AXES.includes(command.axis)) {
        refuse("AXIS_UNSUPPORTED", `"${String(command.axis)}" is not a governed responsibility axis. ` +
            `This boundary governs ${exports.RESPONSIBILITY_AXES.join(" and ")} only — ASSIGNMENT is a separate ` +
            "axis and changing it is not a responsibility handoff (#187 M-1).");
    }
    if (!nonEmpty(command.tenantId))
        refuse("COMMAND_INVALID", "tenantId is required");
    if (!nonEmpty(command.recordId))
        refuse("COMMAND_INVALID", "recordId is required");
    if (!nonEmpty(command.actorUid))
        refuse("COMMAND_INVALID", "actorUid is required");
    if (!nonEmpty(command.family))
        refuse("COMMAND_INVALID", "family is required");
    return {
        tenantId: command.tenantId.trim(),
        family: command.family,
        recordId: command.recordId.trim(),
    };
}
async function authorizeCaller(deps, request) {
    let decision;
    try {
        decision = await deps.callerAuthority.authorizeResponsibilityChange(request);
    }
    catch (err) {
        refuse("CALLER_AUTHORIZATION_UNAVAILABLE", `the authorization decision could not be obtained: ${err instanceof Error ? err.message : String(err)}`);
    }
    switch (decision?.outcome) {
        case "ALLOWED":
            return;
        case "DENIED":
            refuse("CALLER_NOT_AUTHORIZED", `${request.actorUid} may not change ${request.axis} on ${request.target.family} ` +
                `${request.target.recordId}: ${decision.reason}`);
            break;
        case "AUTHORIZATION_UNAVAILABLE":
            refuse("CALLER_AUTHORIZATION_UNAVAILABLE", decision.detail);
            break;
        default:
            // An unrecognised decision is not an approval. There is no default-allow branch in this file.
            refuse("CALLER_AUTHORIZATION_UNAVAILABLE", `the authorization port returned an unrecognised decision: ${JSON.stringify(decision)}`);
    }
}
function assertPrecondition(expected, actual) {
    if (expected === undefined)
        return;
    if (expected !== actual) {
        refuse("PRECONDITION_STALE", `the caller expected the current value to be ${expected === null ? "(none)" : expected} but the ` +
            `authoritative read says ${actual === null ? "(none)" : actual}. Refusing on stale evidence ` +
            "rather than overwriting a change made since.");
    }
}
/**
 * The RECORD OWNERSHIP path.
 *
 * The ruling's five steps, in order, with the pure builder doing C and this function doing nothing
 * the builder already does — no family list, no owner-type table, no no-op rule of its own.
 */
async function handoffRecordOwnership(deps, command, target) {
    const records = deps.ownershipRecords;
    const audit = deps.ownershipAudit;
    if (!records || !audit) {
        refuse("PORT_UNAVAILABLE", "a RECORD_OWNERSHIP handoff requires both an ownership record port and an ownership audit port. " +
            "Refusing rather than performing a partial sequence.");
    }
    // The family is looked up FIRST because the storage field the read must inspect comes from it. The
    // builder validates the family again on its own terms; this is not that check, it is "which field".
    const family = (0, ownershipMatrix_1.ownershipFamily)(command.family);
    if (family === null) {
        // A DIFFERENT refusal from OWNERSHIP_STORAGE_UNRESOLVED below, and the distinction is the one the
        // pure builder already draws: an ungoverned family is not in the allow-list at all, while a
        // governed family with no ownership field is governed and simply has nowhere to write yet.
        refuse("FAMILY_UNGOVERNED", `"${String(command.family)}" is not a governed ownership family — the matrix is the allow-list, ` +
            "not a hint", "FAMILY_UNKNOWN");
    }
    if (family.ownerFields.length !== 1) {
        // 0 = the family has no ownership storage yet, so there is no field to mutate and a governed
        // MUTATION cannot happen (the pure builder can still produce the event; this boundary mutates).
        // >1 = ambiguous, and picking one would be this module inventing a governed decision.
        refuse("OWNERSHIP_STORAGE_UNRESOLVED", `${family.family} declares ${family.ownerFields.length} ownership field(s) ` +
            `(${family.ownerFields.join(", ") || "none"}); a governed mutation needs exactly one. ` +
            "Fail closed rather than choose.");
    }
    const ownerField = family.ownerFields[0];
    // ── A. AUTHORITATIVE READ ───────────────────────────────────────────────────────────────────────
    const read = await records.readAuthoritative(target);
    if (read.outcome === "RECORD_NOT_FOUND") {
        refuse("RECORD_NOT_FOUND", `${target.family} ${target.recordId} does not exist`);
    }
    if (read.outcome !== "READ") {
        // FAIL CLOSED. An unavailable read is not an empty record.
        refuse("AUTHORITATIVE_READ_UNAVAILABLE", `the authoritative read of ${target.family} ${target.recordId} could not be obtained: ${read.detail}`);
    }
    // The CURRENT owner comes from the record, derived by the existing pure projection — the same one
    // the census uses, so the boundary and the measurement cannot disagree about what a record says.
    const derived = (0, ownershipCensus_1.classifyDocument)(family, { ...read.fields });
    let previousOwner;
    switch (derived.resolution) {
        case typedOwner_1.OWNERSHIP_RESOLUTION.RESOLVED:
            previousOwner = derived.owner;
            break;
        case typedOwner_1.OWNERSHIP_RESOLUTION.OWNERLESS:
            // A STATED FACT, not a fallback: this record genuinely has no owner, and the first handoff of
            // such a record is a real event the builder accepts with previousOwner = null.
            previousOwner = null;
            break;
        default:
            // #189 `MI-λ`: a reference that does not resolve must not be "fabricated", "silently mapped",
            // or "counted as a valid resolved Employee reference" — and for a CURRENT ACTIONABLE record,
            // "FAIL CLOSED". Treating it as null here would quietly erase a legacy unresolved reference.
            refuse("CURRENT_RESPONSIBILITY_UNRESOLVED", `the stored owner of ${target.family} ${target.recordId} is ${derived.resolution}` +
                `${derived.reason === null ? "" : ` (${derived.reason})`}. A handoff from a state EOS cannot ` +
                "read authoritatively is refused; the existing reference is preserved, not overwritten.");
    }
    assertPrecondition(command.expectedCurrentId, previousOwner === null ? null : previousOwner.id);
    // ── B. CALLER AUTHORIZATION ─────────────────────────────────────────────────────────────────────
    await authorizeCaller(deps, { actorUid: command.actorUid, axis: command.axis, target });
    // ── C. TARGET RESOLUTION, and it happens exactly once ───────────────────────────────────────────
    let eligibility;
    if (!command.newOwner || typeof command.newOwner !== "object" || !nonEmpty(command.newOwner.id)) {
        // The builder refuses this too; this early check exists so the target-resolution step below has
        // an id to resolve rather than resolving `undefined` against the Employee authority.
        refuse("COMMAND_INVALID", "newOwner must be a typed owner with a non-empty id");
    }
    if (command.newOwner.type === typedOwner_1.OWNER_TYPES.USER) {
        const employee = await resolveTargetEmployee(deps.employeeAuthority, target.tenantId, command.newOwner.id);
        // ── D. CURRENT ELIGIBILITY, WHERE APPLICABLE ─────────────────────────────────────────────────
        if (command.eligibilityPolicy !== undefined) {
            eligibility = requireCurrentEligibility(employee, command.eligibilityPolicy);
        }
    }
    else {
        // A company is not a person. #187 `M-1`/#184: no Employee lookup for a company target, and no
        // second authority either — the existing governed company authority answers.
        const company = (0, operatingCompanyAuthority_1.resolveOperatingCompany)(command.newOwner.id);
        if (company.company === null) {
            refuse("TARGET_COMPANY_INVALID", `${command.newOwner.id} is not a governed operating company (${company.state})`);
        }
    }
    // ── E. PURE FAMILY / AXIS VALIDATION — the RETAINED builder, composed, not reimplemented ────────
    let event;
    try {
        event = (0, ownershipHandoffCommand_1.buildOwnershipHandoff)({
            family: command.family,
            recordId: target.recordId,
            previousOwner,
            newOwner: command.newOwner,
            source: command.source,
            ...(command.reason === undefined ? {} : { reason: command.reason }),
        }, { actorUid: command.actorUid });
    }
    catch (err) {
        if (err instanceof ownershipHandoffCommand_1.OwnershipHandoffError) {
            // The builder's code is carried through unchanged — NO_OP stays NO_OP, FAMILY_IMMUTABLE stays
            // FAMILY_IMMUTABLE. Flattening them would lose the refusal vocabulary #184 says to retain.
            refuse("COMMAND_INVALID", err.message, err.code);
        }
        throw err;
    }
    // ── F. MUTATION + G. AUDIT — one uninterrupted block, no await, nothing that can refuse ─────────
    // Everything above has passed and the event is BUILT AND VALIDATED. From here the only failures are
    // the writer's own, and a throw must abandon the whole atomic unit rather than commit half of it.
    let auditEventId;
    try {
        records.stageOwnerFieldWrite(target, ownerField, command.newOwner);
        auditEventId = audit.stageOwnershipHandoffEvent(event);
    }
    catch (err) {
        refuse("STAGING_FAILED", `staging the ownership handoff for ${target.family} ${target.recordId} failed after every ` +
            `check passed: ${err instanceof Error ? err.message : String(err)}. The atomic unit MUST be ` +
            "abandoned — a staged mutation without its audit event is the partial state the ruling forbids.");
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
async function handoffAccountability(deps, command, target) {
    const store = deps.accountabilityStore;
    const audit = deps.accountabilityAudit;
    if (!store || !audit) {
        refuse("PORT_UNAVAILABLE", "an ACCOUNTABILITY handoff requires both an accountability store and an accountability audit " +
            "port. Neither is implemented in this repository yet (no accountability storage exists, and " +
            "the governed AuditAction vocabulary has no accountability action), so this axis refuses " +
            "closed rather than recording an accountability change as an ownership handoff.");
    }
    // ── PURE FAMILY APPLICABILITY, first, because #189 `OD-16` makes it a precondition on the FAMILY ──
    // NOT_APPLICABLE is a statement about the family. It is NOT "this record is missing an accountable
    // person" and must never be reported as a defect.
    if ((0, accountabilityFamilyScope_1.accountabilityFamilyScope)(command.family) !== "IN_SCOPE") {
        refuse("FAMILY_NOT_ACCOUNTABLE", `${command.family} is outside the governed accountability scope, so accountability is NOT ` +
            "APPLICABLE to it — not MISSING, not OWNERLESS, not DEFECTIVE (#189 OD-16). A family enters " +
            "scope only when governed authority admits it.");
    }
    if (!nonEmpty(command.newAccountableEmployeeId)) {
        refuse("COMMAND_INVALID", "newAccountableEmployeeId is required");
    }
    // #189 `MI-ε`. No policy means no governed eligibility answer, and this boundary will not assume one.
    if (!command.eligibilityPolicy || !nonEmpty(command.eligibilityPolicy.policyId)) {
        refuse("ELIGIBILITY_POLICY_REQUIRED", "an ACCOUNTABILITY handoff requires a governed eligibility policy with a stated policyId. " +
            "Assuming one here would be the hidden boolean policy #189 MI-ε forbids.");
    }
    const newId = command.newAccountableEmployeeId.trim();
    // ── A. AUTHORITATIVE READ ───────────────────────────────────────────────────────────────────────
    const read = await store.readCurrentAccountablePerson(target);
    if (read.outcome === "RECORD_NOT_FOUND") {
        refuse("RECORD_NOT_FOUND", `${target.family} ${target.recordId} does not exist`);
    }
    if (read.outcome === "CURRENT_UNREADABLE") {
        // #189 `MI-λ`, declare and quarantine. The stored value is NOT an absence and NOT an outage, so
        // it gets neither of those refusals: this boundary will not overwrite a legacy unresolved person
        // reference as though the field had been empty. Repairing one is a separate governed decision.
        refuse("CURRENT_RESPONSIBILITY_UNRESOLVED", `the stored accountable person of ${target.family} ${target.recordId} is neither a usable ` +
            `Employee id nor an honest absence: ${read.detail}. Fail closed (#189 MI-λ) rather than ` +
            "overwrite an unresolved historical reference.");
    }
    if (read.outcome !== "READ") {
        refuse("AUTHORITATIVE_READ_UNAVAILABLE", `the authoritative accountability read of ${target.family} ${target.recordId} could not be ` +
            `obtained: ${read.detail}`);
    }
    const previousId = read.accountableEmployeeId;
    if (previousId !== null && !nonEmpty(previousId)) {
        refuse("CURRENT_RESPONSIBILITY_UNRESOLVED", `the stored accountable person of ${target.family} ${target.recordId} is neither a usable id ` +
            "nor an honest null. Fail closed (#189 MI-λ) rather than overwrite an unreadable reference.");
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
        refuse("COMMAND_INVALID", `${newId} is already the accountable person for ${target.family} ${target.recordId} — a handoff ` +
            "that moves nothing is not an event", "NO_OP");
    }
    // ── F. MUTATION + G. AUDIT — one uninterrupted block ────────────────────────────────────────────
    // The GOVERNED VALUE. Minted here, from the authoritative facts this sequence already established,
    // so the store cannot be handed anything else. The source is EXPLICIT because a governed handoff
    // NAMES the person — `DERIVED_FROM_RECORD_OWNER` belongs to initialization only (#181), and a
    // transfer that recorded itself as a derivation would be claiming it followed the owner.
    const established = (0, accountablePersonStorage_1.mintGovernedAccountablePerson)(employee, eligibility, "EXPLICIT");
    let auditEventId;
    try {
        store.stageAccountablePersonWrite(target, established);
        auditEventId = audit.stageAccountabilityHandoff({
            actorUid: command.actorUid,
            target,
            previousAccountableEmployeeId: previousId,
            newAccountableEmployeeId: newId,
            eligibilityPolicyId: eligibility.policyId,
            ...(command.reason === undefined ? {} : { reason: command.reason }),
        });
    }
    catch (err) {
        refuse("STAGING_FAILED", `staging the accountability handoff for ${target.family} ${target.recordId} failed after every ` +
            `check passed: ${err instanceof Error ? err.message : String(err)}. The atomic unit MUST be abandoned.`);
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
async function stageGovernedResponsibilityHandoff(deps, command) {
    const target = assertCommandShape(command);
    if (!deps || !deps.callerAuthority || !deps.employeeAuthority) {
        refuse("PORT_UNAVAILABLE", "the caller authority and the Employee authority are both required. A boundary missing either " +
            "cannot authorize or resolve, and proceeding would be the silent fallback #187 §2 forbids.");
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
function assertExhaustive(value) {
    throw new GovernedResponsibilityHandoffError("AXIS_UNSUPPORTED", `unhandled responsibility axis: ${JSON.stringify(value)}`);
}
/**
 * Build a typed owner for a PERSON target, so a caller naming an Employee cannot accidentally build a
 * COMPANY owner. A thin, honest convenience over the existing pure constructor — it adds no policy.
 */
function personOwner(employeeId) {
    return (0, typedOwner_1.typedOwner)(typedOwner_1.OWNER_TYPES.USER, employeeId);
}
/** The same, for a COMPANY target. */
function companyOwner(companyId) {
    return (0, typedOwner_1.typedOwner)(typedOwner_1.OWNER_TYPES.COMPANY, companyId);
}
//# sourceMappingURL=governedResponsibilityHandoff.js.map