"use strict";
// THE CRM WRITER AUTHORITY STATE -- which writer set may write Account / Contact / customer-site data, stated once.
//
// The CRM twin of functions/src/catalogMaster/catalogWriterState.ts, under the controller's CRM cutover ruling 6
// (docs/architecture/crm-cutover-plan.md §6): two writer sets, NEVER two authoritative ones.
//
//   Firestore (legacy)  OPEN     the legacy CRM writers write, as today
//                       FROZEN   every server-side legacy CRM writer REFUSES before its first write (customer import,
//                                sandbox seeds, ownership backfill); client-direct writers are frozen by the documented
//                                Rules step. Reversible only while PostgreSQL is still INACTIVE (the rollback path).
//                       RETIRED  refused for good; removal follows. Not reversible.
//   PostgreSQL (target) INACTIVE nothing composes the eos_crm writers (or the PostgreSQL customer import) for use
//                       ACTIVE   the governed PostgreSQL CRM authority accepts authoritative writes
//
//   OPEN/INACTIVE   --FREEZE-->                          FROZEN/INACTIVE
//   FROZEN/INACTIVE --ROLLBACK_BEFORE_POSTGRES_WRITES-->  OPEN/INACTIVE
//   FROZEN/INACTIVE --ACTIVATE_POSTGRES-->               FROZEN/ACTIVE
//   FROZEN/ACTIVE   --RETIRE_FIRESTORE-->                RETIRED/ACTIVE
//
// OPEN/ACTIVE is incoherent; nothing leaves ACTIVE (no silent revert). The committed state is a CODE constant --
// never an environment variable or a Firestore flag (that would be a second place the answer lives, and a new Firebase
// dependency). An import that cannot honour FROZEN before its first write stays disabled: the guard is its first act.
//
// Pure: no Firebase, no I/O. Loadable by operator scripts before any SDK.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresCrmWriterInactiveError = exports.FirestoreCrmWriterClosedError = exports.FIRESTORE_CRM_WRITERS = exports.CrmWriterStateError = exports.CRM_WRITER_TRANSITIONS = exports.CRM_WRITER_AUTHORITY = void 0;
exports.assertCrmWriterAuthorityCoherent = assertCrmWriterAuthorityCoherent;
exports.assertCrmWriterTransition = assertCrmWriterTransition;
exports.assertFirestoreCrmWriterOpen = assertFirestoreCrmWriterOpen;
exports.assertPostgresCrmWriterActive = assertPostgresCrmWriterActive;
/** THE COMMITTED STATE. Change only through an allowed transition, with the authorization the plan requires. */
exports.CRM_WRITER_AUTHORITY = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });
exports.CRM_WRITER_TRANSITIONS = Object.freeze([
    Object.freeze({ name: "FREEZE", from: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }) }),
    Object.freeze({ name: "ROLLBACK_BEFORE_POSTGRES_WRITES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }) }),
    Object.freeze({ name: "ACTIVATE_POSTGRES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }) }),
    Object.freeze({ name: "RETIRE_FIRESTORE", from: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }), to: Object.freeze({ firestore: "RETIRED", postgres: "ACTIVE" }) }),
]);
class CrmWriterStateError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CrmWriterStateError";
    }
}
exports.CrmWriterStateError = CrmWriterStateError;
function assertCrmWriterAuthorityCoherent(state) {
    const f = state?.firestore, p = state?.postgres;
    if (!["OPEN", "FROZEN", "RETIRED"].includes(f) || !["INACTIVE", "ACTIVE"].includes(p)) {
        throw new CrmWriterStateError("CRM_WRITER_STATE_INVALID", "unknown CRM writer state");
    }
    if (f === "OPEN" && p === "ACTIVE")
        throw new CrmWriterStateError("TWO_AUTHORITATIVE_WRITER_SETS", "Firestore OPEN with PostgreSQL ACTIVE would be two authoritative CRM writer sets");
    if (f === "RETIRED" && p === "INACTIVE")
        throw new CrmWriterStateError("NO_AUTHORITATIVE_WRITER_SET", "Firestore RETIRED with PostgreSQL INACTIVE leaves no CRM writer at all");
}
function assertCrmWriterTransition(from, to) {
    assertCrmWriterAuthorityCoherent(from);
    assertCrmWriterAuthorityCoherent(to);
    const match = exports.CRM_WRITER_TRANSITIONS.find((t) => t.from.firestore === from.firestore && t.from.postgres === from.postgres && t.to.firestore === to.firestore && t.to.postgres === to.postgres);
    if (!match) {
        const code = from.postgres === "ACTIVE" && to.firestore === "OPEN" ? "NO_SILENT_REVERT_TO_FIRESTORE" : "CRM_WRITER_TRANSITION_NOT_ALLOWED";
        throw new CrmWriterStateError(code, `${from.firestore}/${from.postgres} -> ${to.firestore}/${to.postgres} is not an allowed CRM writer transition`);
    }
    return match.name;
}
/**
 * Every legacy Firestore CRM writer. SERVER_GUARD writers call assertFirestoreCrmWriterOpen with their own id before
 * their first write (crmCutover.test.mjs proves it). RULES_FREEZE writers are client-direct: Firestore Rules are their
 * only gate, and the Rules freeze is a documented, separately authorized step (firestore.rules is not edited here).
 */
exports.FIRESTORE_CRM_WRITERS = Object.freeze({
    "account.import": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/src/account/accountImportCommand.ts", entry: "createAccountFromImport; callable executeDataImport refuses a CUSTOMERS job before claiming it (dataImport/dataImportCallables.ts)" }),
    "crm.sandboxBaselineSeed": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/seedSandboxBaseline.js", entry: "main (accounts, locations, contacts upserts)" }),
    "crm.sandboxInboundSeed": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/seedSandboxInboundWork.mjs", entry: "main (accounts, locations, contacts create-if-absent)" }),
    "crm.ownershipBackfill": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/ownershipSandboxBackfill.js", entry: "main --apply (contacts / locations typed owner)" }),
    "crm.certificationAccountOwners": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/certificationWorld/seedAccountOwners.mjs", entry: "main --apply (the Account owner assignment map)" }),
    "account.clientCreate": Object.freeze({ enforcement: "RULES_FREEZE", module: "field-ops-app-vite/src/domain/accounts.js", entry: "createAccount / updateAccount (firestore.rules accounts create/update)" }),
    "contact.clientWrite": Object.freeze({ enforcement: "RULES_FREEZE", module: "field-ops-app-vite/src/domain/contacts.js, domain/contactImport.js", entry: "createContact / updateContact / importContacts (firestore.rules contacts create/update)" }),
    "location.clientWrite": Object.freeze({ enforcement: "RULES_FREEZE", module: "field-ops-app-vite/src/domain/locations.js", entry: "createLocation / updateLocation (firestore.rules locations create/update)" }),
});
class FirestoreCrmWriterClosedError extends Error {
    writer;
    state;
    code;
    constructor(writer, state) {
        super(state === "FROZEN"
            ? `the Firestore CRM writer ${writer} is frozen for the CRM cutover; no Account, Contact or customer-site write is accepted until the cutover completes`
            : `the Firestore CRM writer ${writer} is retired; CRM data is written through the PostgreSQL CRM authority`);
        this.writer = writer;
        this.state = state;
        this.name = "FirestoreCrmWriterClosedError";
        this.code = state === "FROZEN" ? "FIRESTORE_CRM_WRITER_FROZEN" : "FIRESTORE_CRM_WRITER_RETIRED";
    }
}
exports.FirestoreCrmWriterClosedError = FirestoreCrmWriterClosedError;
/** First act of every server-side legacy Firestore CRM writer. A no-op only while Firestore is OPEN. */
function assertFirestoreCrmWriterOpen(writer, authority = exports.CRM_WRITER_AUTHORITY) {
    const entry = exports.FIRESTORE_CRM_WRITERS[writer];
    if (!Object.prototype.hasOwnProperty.call(exports.FIRESTORE_CRM_WRITERS, writer) || entry.enforcement !== "SERVER_GUARD") {
        throw new Error(`unknown server-side Firestore CRM writer ${String(writer)}`);
    }
    assertCrmWriterAuthorityCoherent(authority);
    if (authority.firestore !== "OPEN")
        throw new FirestoreCrmWriterClosedError(writer, authority.firestore);
}
class PostgresCrmWriterInactiveError extends Error {
    writer;
    code = "POSTGRES_CRM_WRITER_INACTIVE";
    constructor(writer) {
        super(`the PostgreSQL CRM writer ${writer} is not active; the CRM cutover has not activated PostgreSQL writes`);
        this.writer = writer;
        this.name = "PostgresCrmWriterInactiveError";
    }
}
exports.PostgresCrmWriterInactiveError = PostgresCrmWriterInactiveError;
/** First act of every PostgreSQL CRM writer path that is not yet composed for use (e.g. the PostgreSQL customer import). */
function assertPostgresCrmWriterActive(writer, authority = exports.CRM_WRITER_AUTHORITY) {
    assertCrmWriterAuthorityCoherent(authority);
    if (authority.postgres !== "ACTIVE")
        throw new PostgresCrmWriterInactiveError(writer);
}
//# sourceMappingURL=crmWriterState.js.map