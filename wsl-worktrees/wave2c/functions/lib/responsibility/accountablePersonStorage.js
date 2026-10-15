"use strict";
// ACCOUNTABLE PERSON — the STORAGE DECLARATION and the GOVERNED VALUE. Owner rulings #181, #189.
//
// ════════════════════ WHAT THIS MODULE IS ════════════════════
//
// Three things, and deliberately only three:
//
//   1. WHERE the accountable person is carried, for each of the three admitted families — one
//      document field name, one SQL column name, one table, stated once.
//   2. WHAT a STORED value means when it is read back — present, absent, or unreadable — with
//      "unreadable" kept separate from "absent" because #189 `MI-λ` requires it.
//   3. The GOVERNED VALUE a command may persist: a token that can only be minted from a resolved
//      Employee and an eligibility verdict, so a raw caller-supplied string cannot become an
//      accountability fact by being passed to a builder.
//
// PURE. It imports only TYPES from the Employee authority port, so it holds no storage client, no
// clock, no Firebase, no `pg`, and no `node:` module. The one runtime import would have been
// `decideAccountabilityEligibility`, and it is deliberately absent: this module never decides
// eligibility, it only refuses to mint a value whose eligibility verdict is negative.
//
// ════════════════════ WHY THIS IS A DISTINCT FIELD AND NOT A REUSED ONE ════════════════════
//
// #180 (`OD-1`) rules ACCOUNTABLE PERSON a distinct first-class axis from RECORD OWNER · ASSIGNEE ·
// MANAGER · ESCALATION OWNER · OPERATING COMPANY, and lists the axes that "may all be different
// people or facts on one record". #181 then rules, for these three families specifically, that it
// "IS A SEPARATELY CARRIED BUSINESS FACT... not permanently derived from RECORD OWNER", and forbids
// `accountablePerson = ownerEmployeeId` as a permanent computed identity in those words.
//
// So `ownerEmployeeId` is not overloaded, `assignedEmployeeId` is not overloaded, `technicianId` and
// `managerId` are not touched, and `creditedSalespersonId` — which is a THIRD thing again, sales
// credit (#182 §7: "existing `creditedSalespersonId` semantics must not be silently changed") — is
// left exactly as it is. The accountable person gets its own field.
//
// ════════════════════ WHY THE SCOPE IS A LITERAL OF THREE ════════════════════
//
// #189 `OD-16`: "Initial governed scope: OPPORTUNITY · SALES AGREEMENT · SALES ORDER... Do not infer
// that Service, Dispatch, Parts, Inventory, Warehouse, Purchasing, Equipment, reference/master data
// or any other family is in scope." `accountabilityFamilyScope` beside this file is the membership
// test; this file is the STORAGE for the members. A family absent from here has no accountability
// storage, which is the mechanism that makes "NOT APPLICABLE" true of it rather than merely claimed.
//
// ════════════════════ WHY "UNREADABLE" IS NOT "ABSENT" ════════════════════
//
// #189 `MI-λ` ("declare and quarantine") rules that a person reference which does not resolve must
// not be "deleted from immutable history · rewritten merely to satisfy a foreign key · or counted as
// a valid resolved Employee reference", and must stay "visibly distinguishable from a VALID
// HISTORICAL EMPLOYEE". A stored `""`, a whitespace string, a path-shaped string or a number is not
// an id and is not an absence either — it is a legacy value somebody wrote. Collapsing it into
// ABSENT would license a command to overwrite it as though nothing had been there, and collapsing it
// into PRESENT would hand the authority a lookup key that can never resolve. So it is its own state,
// and the governed change path refuses on it rather than writing over it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNTABILITY_FAMILIES = exports.AccountablePersonMintError = exports.ACCOUNTABLE_PERSON_STORAGE = exports.ACCOUNTABLE_PERSON_SOURCES = exports.ACCOUNTABILITY_EXCEPTION_FIELD = exports.ACCOUNTABLE_PERSON_SOURCE_FIELD = exports.ACCOUNTABLE_PERSON_FIELD = void 0;
exports.accountablePersonStorage = accountablePersonStorage;
exports.readStoredAccountablePerson = readStoredAccountablePerson;
exports.accountabilityRecordContext = accountabilityRecordContext;
exports.accountabilityExceptionId = accountabilityExceptionId;
exports.mintGovernedAccountablePerson = mintGovernedAccountablePerson;
exports.isGovernedAccountablePerson = isGovernedAccountablePerson;
exports.accountablePersonFields = accountablePersonFields;
const accountabilityFamilyScope_1 = require("./accountabilityFamilyScope");
Object.defineProperty(exports, "ACCOUNTABILITY_FAMILIES", { enumerable: true, get: function () { return accountabilityFamilyScope_1.ACCOUNTABILITY_FAMILIES; } });
// ════════════════════ 1. WHERE IT LIVES ════════════════════
/**
 * The document field, for the three families' document projection. ONE literal, one place.
 *
 * Chosen to read as the axis it is. It is NOT `ownerAccountableEmployeeId`, which would suggest a
 * qualifier on ownership, and it is NOT bare `accountablePerson`, which would suggest a nested
 * person object of the kind `accountOwner` already is on the Account family — a shape #182 §1 warns
 * against reusing, since a nested map invites "has type USER, therefore valid".
 */
exports.ACCOUNTABLE_PERSON_FIELD = "accountableEmployeeId";
/**
 * How the value got there — `EXPLICIT` or `DERIVED_FROM_RECORD_OWNER`. Recorded, never recomputed.
 *
 * #181 permits derivation at creation and forbids it as a permanent identity: "This is
 * initialization / defaulting. It is NOT permanent equivalence." A stored source is what lets a
 * later reader tell an initialized value from an asserted one WITHOUT re-deriving it — and
 * re-deriving it is the thing that would turn defaulting into equivalence.
 */
exports.ACCOUNTABLE_PERSON_SOURCE_FIELD = "accountablePersonSource";
/**
 * The explicit governed exception marker, per #180: every actionable item has exactly one accountable
 * person "unless an explicit, separately Owner-approved exception defines otherwise."
 *
 * MEASURED ONLY. Nothing in this repository writes it, and nothing here creates a way to. It exists
 * so the census can report an exception that a governed decision recorded, rather than reporting
 * such a record as a defect — and so that the absence of any writer is a visible fact instead of an
 * omission. Minting exceptions is a separate, separately-authorized decision (#189's deferred set).
 */
exports.ACCOUNTABILITY_EXCEPTION_FIELD = "accountabilityExceptionId";
/** How an accountable person came to be on the record. Two values, and both are honest. */
exports.ACCOUNTABLE_PERSON_SOURCES = Object.freeze([
    "EXPLICIT",
    "DERIVED_FROM_RECORD_OWNER",
]);
/**
 * The three admitted families, and nothing else. #189 `OD-16`.
 *
 * The historical value sets are each family's own terminal states, cited:
 *
 *   * OPPORTUNITY — `outcome` WON or LOST. `opportunityLifecycle.ts:74`: "if (state.outcome ===
 *     'WON' || state.outcome === 'LOST') return { ok: false, code: 'ALREADY_CLOSED' }", and
 *     `opportunityCommands.ts` refuses an ordinary edit on either with code `CLOSED`.
 *   * SALES AGREEMENT — `state` ACCEPTED or DECLINED. `salesAgreementLifecycle.ts:76`: "ACCEPTED and
 *     DECLINED are TERMINAL." A DRAFT is still being negotiated, so a DRAFT is actionable.
 *   * SALES ORDER — `state` CLOSED or CANCELLED. `salesOrderLifecycle.ts:53`: "if (state ===
 *     'CLOSED' || state === 'CANCELLED') return { ok: false, code: 'TERMINAL' }". CONFIRMED,
 *     IN_FULFILLMENT and FULFILLED can all still advance, so all three are actionable.
 *
 * NOTE what is absent: there is no "closed" or "archived" generic flag consulted for all three. Each
 * family's terminality is its own vocabulary, and flattening them would be inventing a lifecycle.
 */
exports.ACCOUNTABLE_PERSON_STORAGE = Object.freeze([
    Object.freeze({
        family: "opportunity",
        collection: "opportunities",
        table: "eos_commercial.opportunities",
        field: exports.ACCOUNTABLE_PERSON_FIELD,
        column: "accountable_employee_id",
        lifecycleField: "outcome",
        historicalLifecycleValues: Object.freeze(["WON", "LOST"]),
    }),
    Object.freeze({
        family: "salesAgreement",
        collection: "sales_agreements",
        table: "eos_commercial.sales_agreements",
        field: exports.ACCOUNTABLE_PERSON_FIELD,
        column: "accountable_employee_id",
        lifecycleField: "state",
        historicalLifecycleValues: Object.freeze(["ACCEPTED", "DECLINED"]),
    }),
    Object.freeze({
        family: "salesOrder",
        collection: "sales_orders",
        table: "eos_commercial.sales_orders",
        field: exports.ACCOUNTABLE_PERSON_FIELD,
        column: "accountable_employee_id",
        lifecycleField: "state",
        historicalLifecycleValues: Object.freeze(["CLOSED", "CANCELLED"]),
    }),
]);
/** The storage declaration for a family, or `null` when the family carries no accountability. */
function accountablePersonStorage(family) {
    return exports.ACCOUNTABLE_PERSON_STORAGE.find((s) => s.family === family) ?? null;
}
/** The id shape `employees.id` itself requires (migration 019 `employees_id_shape`). */
function isUsableId(value) {
    return typeof value === "string" && value !== "" && value.trim() === value && !value.includes("/");
}
/**
 * Read one record's stored accountable person. TOTAL — never throws, never guesses.
 *
 * There is deliberately no `?? ownerEmployeeId` anywhere in this function. A reader that fell back
 * to the owner would make every un-established record look accountable, which is #181's forbidden
 * permanent computed identity arriving through the read path instead of the write path — and it
 * would make the census structurally unable to count the very thing it exists to count.
 */
function readStoredAccountablePerson(data) {
    const raw = data?.[exports.ACCOUNTABLE_PERSON_FIELD];
    const storedSource = data?.[exports.ACCOUNTABLE_PERSON_SOURCE_FIELD];
    const source = typeof storedSource === "string" &&
        exports.ACCOUNTABLE_PERSON_SOURCES.includes(storedSource)
        ? storedSource
        : null;
    if (raw === undefined || raw === null) {
        return { state: "ABSENT", accountableEmployeeId: null, source, detail: null };
    }
    if (isUsableId(raw)) {
        return { state: "PRESENT", accountableEmployeeId: raw, source, detail: null };
    }
    return {
        state: "UNREADABLE",
        accountableEmployeeId: null,
        source,
        detail: typeof raw === "string"
            ? `stored ${exports.ACCOUNTABLE_PERSON_FIELD} is a string that could never be an Employee id ` +
                `(empty, untrimmed or path-shaped): ${JSON.stringify(raw.slice(0, 80))}`
            : `stored ${exports.ACCOUNTABLE_PERSON_FIELD} is a ${typeof raw}, not an Employee id`,
    };
}
/**
 * Classify one record as actionable or historical, from its OWN family's terminal states.
 *
 * FAILS TOWARD ACTIONABLE, and that direction is the safe one. A record whose lifecycle field is
 * missing, misspelled or of the wrong type is classified ACTIONABLE, because HISTORICAL is the
 * lenient answer here: #186 §7 exempts history from current-eligibility enforcement, so a record
 * that got called historical by accident would be silently exempted from the gate. An unreadable
 * lifecycle is a reason to look, not a reason to stop looking.
 */
function accountabilityRecordContext(family, data) {
    const storage = accountablePersonStorage(family);
    if (storage === null)
        return "ACTIONABLE";
    const value = data?.[storage.lifecycleField];
    if (typeof value !== "string")
        return "ACTIONABLE";
    return storage.historicalLifecycleValues.includes(value) ? "HISTORICAL" : "ACTIONABLE";
}
/** Whether an explicit governed accountability exception is recorded on this record. #180. */
function accountabilityExceptionId(data) {
    const raw = data?.[exports.ACCOUNTABILITY_EXCEPTION_FIELD];
    return isUsableId(raw) ? raw : null;
}
// ════════════════════ 3. THE GOVERNED VALUE ════════════════════
/**
 * The mark. A module-private `WeakSet` of the objects this module actually minted — NOT a property.
 *
 * A property was the obvious implementation and it is the wrong one. A symbol-keyed own enumerable
 * property IS copied by object spread, so `{ ...established }` would carry the mark and a forged
 * value assembled by spreading a real one would pass. Identity in a WeakSet cannot be copied: spread,
 * `JSON.parse(JSON.stringify(...))` and `structuredClone` each produce a DIFFERENT object, and a
 * different object was never minted.
 *
 * This is what makes "all reachable accountability write paths are governed" a property of the CODE
 * rather than of everybody's discipline. The only way a value is in this set is to have come out of
 * `mintGovernedAccountablePerson` below, which cannot be called without an `EmployeeFacts` the
 * authority produced and an eligibility verdict that says yes.
 *
 * `WeakSet`, not `Set`: holding minted values strongly would keep every established accountable
 * person alive for the life of the process.
 */
const GOVERNED_ESTABLISHMENTS = new WeakSet();
class AccountablePersonMintError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "AccountablePersonMintError";
    }
}
exports.AccountablePersonMintError = AccountablePersonMintError;
/**
 * Mint the governed value. THE ONLY WAY ONE COMES INTO EXISTENCE.
 *
 * The signature is the enforcement. It requires:
 *
 *   * `EmployeeFacts` — which only a `RESOLVED` answer from the Employee authority produces
 *     (`employeeAuthority.ts`'s resolution union has no other branch that carries them), so a
 *     caller cannot mint for an Employee it never looked up; and
 *   * `AccountabilityEligibility` — which only `decideAccountabilityEligibility` produces, and which
 *     that function cannot produce without a stated governed policy.
 *
 * And it REFUSES when the verdict is negative. #189 `MI-ε`: "When the authoritative eligibility
 * result is *not currently eligible*, a governed command attempting to establish or transfer current
 * accountability to that Employee must REFUSE." Refusing at the mint means every downstream writer
 * inherits the refusal without restating it — and cannot restate it wrongly.
 *
 * It also refuses when the eligibility verdict's `employmentStatus` disagrees with the Employee's,
 * which closes the one way a hand-assembled verdict could otherwise lie: presenting a TERMINATED
 * Employee alongside an eligibility object computed for an ACTIVE one.
 *
 * There is NO status comparison in this function. It does not know which statuses are eligible and
 * has no literal to compare against — #189: "Do NOT implement this as `status != ACTIVE → refuse`...
 * The gate consumes the governed eligibility result and must not flatten the six-value vocabulary
 * into a hidden boolean policy."
 */
function mintGovernedAccountablePerson(employee, eligibility, source) {
    if (!employee || !isUsableId(employee.employeeId)) {
        throw new AccountablePersonMintError("EMPLOYEE_FACTS_UNUSABLE", "an accountable person can only be minted from governed Employee facts carrying a usable " +
            "Employee id; an id that is empty, untrimmed or path-shaped is not an id");
    }
    if (!exports.ACCOUNTABLE_PERSON_SOURCES.includes(source)) {
        throw new AccountablePersonMintError("SOURCE_UNGOVERNED", `"${String(source)}" is not a governed establishment source. #181 permits exactly two: an ` +
            `EXPLICIT governed accountable person, or DERIVED_FROM_RECORD_OWNER at initialization.`);
    }
    if (!eligibility || typeof eligibility.policyId !== "string" || eligibility.policyId.trim() === "") {
        throw new AccountablePersonMintError("ELIGIBILITY_POLICY_UNSTATED", "the eligibility verdict states no governed policy author. #189 MI-epsilon makes the " +
            "eligibility answer a governed fact, and a governed fact with no stated author cannot be " +
            "re-examined later.");
    }
    if (eligibility.employmentStatus !== employee.employmentStatus) {
        throw new AccountablePersonMintError("ELIGIBILITY_DOES_NOT_MATCH_EMPLOYEE", `the eligibility verdict was made against lifecycle status ${eligibility.employmentStatus} ` +
            `but the Employee's authoritative status is ${employee.employmentStatus}. A verdict about a ` +
            "different fact is not a verdict about this person.");
    }
    if (!eligibility.eligible) {
        throw new AccountablePersonMintError("NOT_CURRENTLY_ELIGIBLE", `Employee ${employee.employeeId} is a VALID reference but is NOT CURRENTLY ELIGIBLE under ` +
            `governed policy ${eligibility.policyId} (lifecycle status ${employee.employmentStatus}). ` +
            "The reference and any historical accountability remain valid (#186 s7); establishing NEW " +
            "accountability is refused (#189 MI-epsilon).");
    }
    const minted = Object.freeze({
        accountableEmployeeId: employee.employeeId,
        source,
        eligibilityPolicyId: eligibility.policyId,
        employmentStatus: employee.employmentStatus,
    });
    GOVERNED_ESTABLISHMENTS.add(minted);
    return minted;
}
/**
 * Is this value a governed establishment? The check every writer makes before it persists anything.
 *
 * A plain string, a plain object with the right keys, a JSON round-trip of a real one, and a
 * `structuredClone` of a real one all answer NO — symbol-keyed properties do not survive any of
 * those. That is intended: a value that crossed a serialization boundary is no longer evidence that
 * the authority was consulted in this process.
 */
function isGovernedAccountablePerson(value) {
    return typeof value === "object" && value !== null && GOVERNED_ESTABLISHMENTS.has(value);
}
/**
 * The field map a governed establishment persists. The ONLY function that produces it.
 *
 * Two fields, both named above. It writes no owner field, no assignment field and no credit field —
 * a patch that could touch `ownerEmployeeId` would be the collapse #187 §1 forbids, expressed as a
 * convenience.
 */
function accountablePersonFields(established) {
    if (!isGovernedAccountablePerson(established)) {
        throw new AccountablePersonMintError("EMPLOYEE_FACTS_UNUSABLE", "refusing to build an accountability field map from a value that did not come from a governed " +
            "establishment. Accountability is established through the governed orchestration boundary " +
            "(#184), never by handing a builder an id.");
    }
    return {
        [exports.ACCOUNTABLE_PERSON_FIELD]: established.accountableEmployeeId,
        [exports.ACCOUNTABLE_PERSON_SOURCE_FIELD]: established.source,
    };
}
//# sourceMappingURL=accountablePersonStorage.js.map