"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCreationAccountablePerson = resolveCreationAccountablePerson;
exports.stageCreationAccountablePerson = stageCreationAccountablePerson;
const postgresEmployeeAuthority_1 = require("../../employeeIdentity/postgresEmployeeAuthority");
const accountablePersonEstablishment_1 = require("../../responsibility/accountablePersonEstablishment");
const commercialAccountabilityRepository_1 = require("../commercialAccountabilityRepository");
const commercialCommandKernel_1 = require("./commercialCommandKernel");
/**
 * ABSENT means the caller supplied no explicit person: `undefined` or `null`. Anything else that was supplied is an
 * EXPLICIT request -- and a supplied value that is not a non-empty string (a number, an object, a boolean, an array, a
 * blank string) is a MALFORMED explicit person. It refuses exactly as an unresolvable one does; it is never read as
 * "no explicit person", so it can never fall through to derivation from the owner.
 */
function explicitAccountableEmployeeIdOf(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string" || value.trim() === "") {
        (0, commercialCommandKernel_1.fail)("EXPLICIT_PERSON_INVALID", "INVALID_INPUT", "the explicit accountable person is not an Employee id; no derivation from the owner is attempted");
    }
    return value;
}
/** Resolve (never persist) the creation Accountable Person. Call BEFORE any row is written, so a refusal writes nothing. */
async function resolveCreationAccountablePerson(db, tenantId, family, explicitAccountableEmployeeId, ownerEmployeeId) {
    const explicit = explicitAccountableEmployeeIdOf(explicitAccountableEmployeeId);
    return (0, accountablePersonEstablishment_1.establishCreationAccountablePerson)({ employeeAuthority: (0, postgresEmployeeAuthority_1.createPostgresEmployeeAuthority)(db) }, {
        tenantId,
        family,
        explicitAccountableEmployeeId: explicit,
        currentRecordOwnerEmployeeId: ownerEmployeeId,
        eligibilityPolicy: commercialCommandKernel_1.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1,
    });
}
/** Persist the minted person and its ESTABLISHMENT history on the just-created record, in the same transaction. */
async function stageCreationAccountablePerson(db, tenantId, actorId, family, recordId, established) {
    const history = await (0, commercialAccountabilityRepository_1.stageCommercialAccountablePersonChange)(db, tenantId, actorId, "ESTABLISHMENT", {
        family,
        recordId,
        accountablePerson: established,
    });
    return { accountableEmployeeId: history.newAccountableEmployeeId, accountablePersonSource: history.source };
}
//# sourceMappingURL=commercialCreation.js.map