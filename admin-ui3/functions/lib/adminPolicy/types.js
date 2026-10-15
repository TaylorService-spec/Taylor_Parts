"use strict";
// EOS Administration policy — the domain contracts.
//
// ════════════════════ WHAT THIS FILE IS FOR ════════════════════
//
// The target architecture is: the authentication provider supplies IDENTITY; EOS decides
// AUTHORIZATION; and everything a customer configures lives in the EOS database behind the DAL.
// These are the shapes that travel between those layers. They carry no persistence, no Firebase and
// no framework -- deliberately, and still deliberately now that PostgreSQL is chosen (Owner ruling
// D-1). A domain type that knew about a column, a driver or a connection would make the storage
// choice irreversible and would leak the database into every module that names a Role.
//
// ════════════════════ WHAT THIS FILE IS NOT ════════════════════
//
// NOT a second capability model. `functions/src/types/access.ts` already defines Permission, Role,
// RoleAssignment, Scope and Condition, and those remain the capability-level contracts. This file
// adds the layer above them -- Objects, Fields, CRED, and Workflows -- which the existing contracts
// do not express.
//
// NOT a second field-metadata model. The repository already has one: 28 entities and 389 field
// definitions in field-ops-app-vite/src/metadata/definitions, with its own type vocabulary. That
// registry stays the DESIGN-TIME description of shipped fields. `ObjectFieldRecord` below is the
// RUN-TIME governance record: it carries what a tenant owns and what an administrator can change,
// and for a system field it CITES the registry rather than copying it. One field model, two layers.
//
// NOT a compatibility-role layer. Nothing here re-declares `admin`/`dispatcher`/`technician`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_CAPABILITY_DECISIONS = exports.WORKFLOW_BINDING_KINDS = exports.WORKFLOW_GUARD_KINDS = exports.FIELD_SENSITIVITIES = exports.FIELD_DATA_TYPES = exports.EMPTY_CRED = exports.CRED_VERB_LABEL = exports.CRED_VERBS = void 0;
// ════════════════════ CRED ════════════════════
//
// The Owner's four business verbs. CRED == CRUD; "Edit" and "Update" are the same verb and the
// business says Edit. This vocabulary is shared by Object permissions and Field permissions, which
// is the whole point -- an administrator learns one grid and reads it twice.
exports.CRED_VERBS = ["C", "R", "E", "D"];
exports.CRED_VERB_LABEL = Object.freeze({
    C: "Create",
    R: "Read",
    E: "Edit",
    D: "Delete",
});
exports.EMPTY_CRED = Object.freeze({ C: false, R: false, E: false, D: false });
/**
 * The data types a field may take.
 *
 * DELIBERATELY THE REPOSITORY'S EXISTING VOCABULARY, copied here as a frozen list rather than
 * imported: the source is `field-ops-app-vite/src/metadata/entityDefinition.js`'s FIELD_TYPE, which
 * is client-side ESM that functions/ cannot import (no shared/monorepo tooling exists in this repo
 * -- the same reason types/access.ts is mirrored by hand). A drift test pins the two together, so
 * this is a mirror with a guard rather than a second vocabulary.
 */
exports.FIELD_DATA_TYPES = [
    "STRING",
    "TEXT",
    "NUMBER",
    "CURRENCY_MINOR",
    "BOOLEAN",
    "DATE",
    "TIMESTAMP",
    "ENUM",
    "ENUM_SET",
    "ADDRESS",
    "REFERENCE",
    "ID",
];
/**
 * How sensitive a field's contents are.
 *
 * Distinct from permissions: a permission says who may read it, this says what it IS. The two are
 * different questions and conflating them is how "who can see salaries" becomes unanswerable.
 * NORMAL is the default so a field is never accidentally classified by omission.
 */
exports.FIELD_SENSITIVITIES = ["NORMAL", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
/**
 * The closed guard vocabulary. Each is an EXISTING evaluator primitive -- never authorable logic:
 *   RECORD_ASSIGNMENT  contextualAuthorization's ASSIGNED_EMPLOYEE relation (Employee against
 *                      Employee, through the ACTIVE principal link and the open assignment).
 */
exports.WORKFLOW_GUARD_KINDS = Object.freeze(["RECORD_ASSIGNMENT"]);
/**
 * Who a binding names. Both kinds are evaluable (migration 1762819200000):
 *
 *   SECURITY_ROLE    a Security Role the principal must hold (role_id). Unchanged.
 *   FUNCTIONAL_ROLE  a Functional Role (eos_workforce.functional_roles) the principal's LINKED EMPLOYEE must
 *                    currently hold (functional_role_id). It only NARROWS: the action is allowed only if the
 *                    capability comes from a qualifying Security Role (the same evaluator) AND the Security Role
 *                    binding rule holds AND, when the action has any FUNCTIONAL_ROLE binding, the linked Employee
 *                    holds one of them. A Functional Role never grants a capability.
 */
exports.WORKFLOW_BINDING_KINDS = Object.freeze(["SECURITY_ROLE", "FUNCTIONAL_ROLE"]);
// ════════════════════ ADMINISTRATION DECISIONS AND GRANT CONDITIONS ════════════════════
//
// `role_capabilities` answers WHAT a Role holds. A decision answers WHY -- because an administrator
// granted it, or why it is ABSENT although a default would put it there. See
// adminPolicy/roleCapabilityAdministration.ts for the precedence rule these rows take part in.
exports.ROLE_CAPABILITY_DECISIONS = ["ADMIN_GRANTED", "ADMIN_REVOKED"];
//# sourceMappingURL=types.js.map