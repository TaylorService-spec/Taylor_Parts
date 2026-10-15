"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeCommandError = exports.EMPLOYEE_EDIT_MANAGER_ACTIONS = void 0;
exports.saveEmployeeEdit = saveEmployeeEdit;
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
const employeeCommandKernel_1 = require("./employeeCommandKernel");
Object.defineProperty(exports, "EmployeeCommandError", { enumerable: true, get: function () { return employeeCommandKernel_1.EmployeeCommandError; } });
const employeeProfileCommand_1 = require("./employeeProfileCommand");
const reportingRelationshipCommands_1 = require("./reportingRelationshipCommands");
exports.EMPLOYEE_EDIT_MANAGER_ACTIONS = Object.freeze(["ESTABLISH", "END"]);
/** `{ employeeId, changes, manager: { action: "ESTABLISH", managerEmployeeId } | { action: "END" }, reason? }` */
function saveEmployeeEdit(deps, actor, input) {
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, actor, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "changes", "manager", "reason"]);
        if (i.changes === undefined || i.manager === undefined) {
            (0, employeeCommandKernel_1.refuse)("COMBINED_EDIT_REQUIRES_BOTH", "INVALID_INPUT", "saveEmployeeEdit is only for a Save that changes profile facts AND the manager; use the single command otherwise");
        }
        const profile = (0, employeeProfileCommand_1.prepareProfileUpdate)({ employeeId: i.employeeId, changes: i.changes, ...(i.reason === undefined ? {} : { reason: i.reason }) });
        const m = (0, employeeCommandKernel_1.acceptOnly)(i.manager, ["action", "managerEmployeeId"]);
        const reason = i.reason === undefined ? {} : { reason: i.reason };
        if (m.action === "ESTABLISH") {
            return { profile, manager: { action: "ESTABLISH", prepared: (0, reportingRelationshipCommands_1.prepareEstablish)({ employeeId: i.employeeId, managerEmployeeId: m.managerEmployeeId, ...reason }) } };
        }
        if (m.action === "END") {
            if (m.managerEmployeeId !== undefined)
                (0, employeeCommandKernel_1.refuse)("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", "manager.managerEmployeeId is not accepted when ending");
            return { profile, manager: { action: "END", prepared: (0, reportingRelationshipCommands_1.prepareEnd)({ employeeId: i.employeeId, ...reason }) } };
        }
        return (0, employeeCommandKernel_1.refuse)("MANAGER_ACTION_INVALID", "INVALID_INPUT", `manager.action must be one of ${exports.EMPLOYEE_EDIT_MANAGER_ACTIONS.join(", ")}`);
    }, async (db, p, at) => {
        const profile = await (0, employeeProfileCommand_1.applyProfileUpdate)(db, actor, p.profile, at);
        const manager = p.manager.action === "ESTABLISH"
            ? await (0, reportingRelationshipCommands_1.applyEstablish)(db, actor, p.manager.prepared, at)
            : await (0, reportingRelationshipCommands_1.applyEnd)(db, actor, p.manager.prepared, at);
        return { employeeId: p.profile.employeeId, profile, manager };
    }, (err) => (err.constraint === "employee_reporting_one_current_per_employee" ? (0, reportingRelationshipCommands_1.reportingConcurrentChange)() : (0, employeeProfileCommand_1.employeeNumberTaken)()));
}
//# sourceMappingURL=employeeEditCommand.js.map