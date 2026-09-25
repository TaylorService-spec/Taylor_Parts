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
import { refuse } from "./employeeCommandKernel";

/** Long enough to be a sentence a later reader can act on. */
export const MIN_GOVERNED_REASON_LENGTH = 10;
/** eos_policy.audit_events.reason, and the same bound optionalReason() enforces. */
export const MAX_GOVERNED_REASON_LENGTH = 500;

/**
 * A REQUIRED, specific reason. Refused when absent, not a string, untrimmed, too short or too long --
 * never defaulted, never derived from the operation name, and never supplied by the transport.
 */
export function requireGovernedReason(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < MIN_GOVERNED_REASON_LENGTH
    || value.length > MAX_GOVERNED_REASON_LENGTH) {
    refuse("REASON_REQUIRED", "INVALID_INPUT",
      `reason is required: a trimmed sentence of ${MIN_GOVERNED_REASON_LENGTH}-${MAX_GOVERNED_REASON_LENGTH} characters `
      + "saying why this Employee administration change is being made");
  }
  return value as string;
}
