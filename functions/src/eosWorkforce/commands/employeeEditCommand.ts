// The COMBINED Employee edit: profile facts AND the reporting relationship in ONE governed PostgreSQL transaction
// (#1930 completion requirement, Owner correction 2026-09-16).
//
// When one submitted Save changes both, either every effect commits -- profile columns, the reporting-relationship
// end/insert, and each audit event -- or none does. There is no client-side sequencing and no partial success.
//
// CLOSED, AND ONLY FOR THE COMBINED CASE. A profile-only Save uses updateEmployeeProfile; a manager-only Save uses
// establishReportingRelationship / endReportingRelationship. This command refuses an input that is not both, so it never
// becomes a second way to do either alone, and it is not a generic patch.
//
// NO NEW AUTHORITY. It composes the existing transaction bodies (applyProfileUpdate, applyEstablish, applyEnd) inside
// one runEmployeeCommand transaction -- the same capability (admin.employeeProfile.write), the same active Principal +
// membership check, the same validation, locks and audit actions as the single commands. Profile first, then manager,
// under the same Employee row lock.
import {
  EmployeeCommandError, acceptOnly, refuse, runEmployeeCommand,
  type EmployeeCommandActor, type EmployeeCommandDeps,
} from "./employeeCommandKernel";
import { applyProfileUpdate, employeeNumberTaken, prepareProfileUpdate, type EmployeeProfileChangeResult } from "./employeeProfileCommand";
import {
  applyEnd, applyEstablish, prepareEnd, prepareEstablish, reportingConcurrentChange, type ReportingChangeResult,
} from "./reportingRelationshipCommands";

export const EMPLOYEE_EDIT_MANAGER_ACTIONS = Object.freeze(["ESTABLISH", "END"] as const);

export interface EmployeeEditResult {
  readonly employeeId: string;
  readonly profile: EmployeeProfileChangeResult;
  readonly manager: ReportingChangeResult;
}

/** `{ employeeId, changes, manager: { action: "ESTABLISH", managerEmployeeId } | { action: "END" }, reason? }` */
export function saveEmployeeEdit(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<EmployeeEditResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "changes", "manager", "reason"]);
      if (i.changes === undefined || i.manager === undefined) {
        refuse("COMBINED_EDIT_REQUIRES_BOTH", "INVALID_INPUT",
          "saveEmployeeEdit is only for a Save that changes profile facts AND the manager; use the single command otherwise");
      }
      const profile = prepareProfileUpdate({ employeeId: i.employeeId, changes: i.changes, ...(i.reason === undefined ? {} : { reason: i.reason }) });
      const m = acceptOnly(i.manager as Record<string, unknown>, ["action", "managerEmployeeId"]);
      const reason = i.reason === undefined ? {} : { reason: i.reason };
      if (m.action === "ESTABLISH") {
        return { profile, manager: { action: "ESTABLISH" as const, prepared: prepareEstablish({ employeeId: i.employeeId, managerEmployeeId: m.managerEmployeeId, ...reason }) } };
      }
      if (m.action === "END") {
        if (m.managerEmployeeId !== undefined) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", "manager.managerEmployeeId is not accepted when ending");
        return { profile, manager: { action: "END" as const, prepared: prepareEnd({ employeeId: i.employeeId, ...reason }) } };
      }
      return refuse("MANAGER_ACTION_INVALID", "INVALID_INPUT", `manager.action must be one of ${EMPLOYEE_EDIT_MANAGER_ACTIONS.join(", ")}`);
    },
    async (db, p, at) => {
      const profile = await applyProfileUpdate(db, actor, p.profile, at);
      const manager = p.manager.action === "ESTABLISH"
        ? await applyEstablish(db, actor, p.manager.prepared, at)
        : await applyEnd(db, actor, p.manager.prepared, at);
      return { employeeId: p.profile.employeeId, profile, manager };
    },
    (err) => (err.constraint === "employee_reporting_one_current_per_employee" ? reportingConcurrentChange() : employeeNumberTaken()));
}

export { EmployeeCommandError };
