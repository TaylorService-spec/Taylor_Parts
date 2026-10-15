"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_GOVERNED_REASON_LENGTH = exports.MIN_GOVERNED_REASON_LENGTH = void 0;
exports.requireGovernedReason = requireGovernedReason;
// SHARED INPUT RULES OF THE GOVERNED EMPLOYEE ADMINISTRATION COMMANDS. Pure: no database, no I/O.
//
// `optionalReason` in the command kernel is right for the commands that already shipped, where a
// reason is a courtesy. It is wrong for these:
//
//   * CREATING an Employee introduces a business identity every ownership, accountability and
//     assignment row downstream can then name. "Why does this person exist in EOS" is the first
//     question an auditor asks and the one thing no column records.
//   * LINKING an Employee to a Principal says WHICH LOGIN IS THIS PERSON. Migration 1758412800000
//     already refuses an OPERATOR_ASSERTED link with no author and no reason at the DATABASE level,
//     "because the caller that would forget is exactly the caller that is guessing".
//
// So every Employee administration operation REQUIRES a reason, and a reason has to be checkably
// specific or it is decoration. The floor is deliberately low enough for a real operator sentence and
// high enough that "fix", "x" and "test" cannot pass; the ceiling is the audit column's own width.
const employeeCommandKernel_1 = require("./employeeCommandKernel");
/** Long enough to be a sentence a later reader can act on. */
exports.MIN_GOVERNED_REASON_LENGTH = 10;
/** eos_policy.audit_events.reason, and the same bound optionalReason() enforces. */
exports.MAX_GOVERNED_REASON_LENGTH = 500;
/**
 * A REQUIRED, specific reason. Refused when absent, not a string, untrimmed, too short or too long --
 * never defaulted, never derived from the operation name, and never supplied by the transport.
 */
function requireGovernedReason(value) {
    if (typeof value !== "string" || value.trim() !== value || value.length < exports.MIN_GOVERNED_REASON_LENGTH
        || value.length > exports.MAX_GOVERNED_REASON_LENGTH) {
        (0, employeeCommandKernel_1.refuse)("REASON_REQUIRED", "INVALID_INPUT", `reason is required: a trimmed sentence of ${exports.MIN_GOVERNED_REASON_LENGTH}-${exports.MAX_GOVERNED_REASON_LENGTH} characters `
            + "saying why this Employee administration change is being made");
    }
    return value;
}
//# sourceMappingURL=employeeAdministrationInput.js.map