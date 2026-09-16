// THE CRM WRITER AUTHORITY STATE -- which writer set may write Account / Contact / customer-site data, stated once.
//
// The CRM twin of functions/src/catalogMaster/catalogWriterState.ts, under the controller's CRM cutover ruling 6
// (docs/architecture/crm-cutover-plan.md §6): two writer sets, NEVER two authoritative ones.
//
//   Firestore (legacy)  OPEN     the legacy CRM writers write
//                       FROZEN   every server-side legacy CRM writer REFUSES before its first write (customer import,
//                                sandbox seeds, ownership backfill); the deployed platform-sandbox client has an
//                                explicit pre-Firestore cutover fuse for Account / Contact / Location mutations.
//                                Firestore Rules are NOT the freeze authority. Stale-client risk is handled by source
//                                quiescence proof before export/copy. Reversible only while PostgreSQL is INACTIVE.
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

export type FirestoreCrmWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresCrmWriterState = "INACTIVE" | "ACTIVE";

export interface CrmWriterAuthority {
  readonly firestore: FirestoreCrmWriterState;
  readonly postgres: PostgresCrmWriterState;
}

/** THE COMMITTED STATE. Nonprod CRM source is frozen; PostgreSQL writes are not active yet. */
export const CRM_WRITER_AUTHORITY: CrmWriterAuthority = Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" });

export const CRM_WRITER_TRANSITIONS = Object.freeze([
  Object.freeze({ name: "FREEZE", from: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }) }),
  Object.freeze({ name: "ROLLBACK_BEFORE_POSTGRES_WRITES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }) }),
  Object.freeze({ name: "ACTIVATE_POSTGRES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }) }),
  Object.freeze({ name: "RETIRE_FIRESTORE", from: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }), to: Object.freeze({ firestore: "RETIRED", postgres: "ACTIVE" }) }),
] as const);

export class CrmWriterStateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CrmWriterStateError";
  }
}

export function assertCrmWriterAuthorityCoherent(state: CrmWriterAuthority): void {
  const f = state?.firestore, p = state?.postgres;
  if (!["OPEN", "FROZEN", "RETIRED"].includes(f as string) || !["INACTIVE", "ACTIVE"].includes(p as string)) {
    throw new CrmWriterStateError("CRM_WRITER_STATE_INVALID", "unknown CRM writer state");
  }
  if (f === "OPEN" && p === "ACTIVE") throw new CrmWriterStateError("TWO_AUTHORITATIVE_WRITER_SETS", "Firestore OPEN with PostgreSQL ACTIVE would be two authoritative CRM writer sets");
  if (f === "RETIRED" && p === "INACTIVE") throw new CrmWriterStateError("NO_AUTHORITATIVE_WRITER_SET", "Firestore RETIRED with PostgreSQL INACTIVE leaves no CRM writer at all");
}

export function assertCrmWriterTransition(from: CrmWriterAuthority, to: CrmWriterAuthority): string {
  assertCrmWriterAuthorityCoherent(from);
  assertCrmWriterAuthorityCoherent(to);
  const match = CRM_WRITER_TRANSITIONS.find((t) => t.from.firestore === from.firestore && t.from.postgres === from.postgres && t.to.firestore === to.firestore && t.to.postgres === to.postgres);
  if (!match) {
    const code = from.postgres === "ACTIVE" && to.firestore === "OPEN" ? "NO_SILENT_REVERT_TO_FIRESTORE" : "CRM_WRITER_TRANSITION_NOT_ALLOWED";
    throw new CrmWriterStateError(code, `${from.firestore}/${from.postgres} -> ${to.firestore}/${to.postgres} is not an allowed CRM writer transition`);
  }
  return match.name;
}

/**
 * Every legacy Firestore CRM writer. SERVER_GUARD writers call assertFirestoreCrmWriterOpen with their own id before
 * their first write. CLIENT_FUSE writers are the browser-direct legacy paths; the platform-sandbox bundle refuses them
 * before any Firestore mutation call. This is deliberately not a Firestore Rules freeze.
 */
export const FIRESTORE_CRM_WRITERS = Object.freeze({
  "account.import": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/src/account/accountImportCommand.ts", entry: "createAccountFromImport; callable executeDataImport refuses a CUSTOMERS job before claiming it (dataImport/dataImportCallables.ts)" }),
  "crm.sandboxBaselineSeed": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/seedSandboxBaseline.js", entry: "main (accounts, locations, contacts upserts)" }),
  "crm.sandboxInboundSeed": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/seedSandboxInboundWork.mjs", entry: "main (accounts, locations, contacts create-if-absent)" }),
  "crm.ownershipBackfill": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/ownershipSandboxBackfill.js", entry: "main --apply (contacts / locations typed owner)" }),
  "crm.certificationAccountOwners": Object.freeze({ enforcement: "SERVER_GUARD", module: "functions/scripts/certificationWorld/seedAccountOwners.mjs", entry: "main --apply (the Account owner assignment map)" }),
  "account.clientWrite": Object.freeze({ enforcement: "CLIENT_FUSE", module: "field-ops-app-vite/src/domain/accounts.js", entry: "createAccount / updateAccount" }),
  "contact.clientWrite": Object.freeze({ enforcement: "CLIENT_FUSE", module: "field-ops-app-vite/src/domain/contacts.js, field-ops-app-vite/src/domain/contactImport.js", entry: "createContact / updateContact / importContacts" }),
  "location.clientWrite": Object.freeze({ enforcement: "CLIENT_FUSE", module: "field-ops-app-vite/src/domain/locations.js", entry: "createLocation / updateLocation" }),
});

export type FirestoreCrmWriterId = keyof typeof FIRESTORE_CRM_WRITERS;

export class FirestoreCrmWriterClosedError extends Error {
  readonly code: "FIRESTORE_CRM_WRITER_FROZEN" | "FIRESTORE_CRM_WRITER_RETIRED";
  constructor(readonly writer: FirestoreCrmWriterId, readonly state: "FROZEN" | "RETIRED") {
    super(state === "FROZEN"
      ? `the Firestore CRM writer ${writer} is frozen for the CRM cutover; no Account, Contact or customer-site write is accepted until the cutover completes`
      : `the Firestore CRM writer ${writer} is retired; CRM data is written through the PostgreSQL CRM authority`);
    this.name = "FirestoreCrmWriterClosedError";
    this.code = state === "FROZEN" ? "FIRESTORE_CRM_WRITER_FROZEN" : "FIRESTORE_CRM_WRITER_RETIRED";
  }
}

/** First act of every server-side legacy Firestore CRM writer. A no-op only while Firestore is OPEN. */
export function assertFirestoreCrmWriterOpen(writer: FirestoreCrmWriterId, authority: CrmWriterAuthority = CRM_WRITER_AUTHORITY): void {
  const entry = (FIRESTORE_CRM_WRITERS as Record<string, { enforcement: string }>)[writer as string];
  if (!Object.prototype.hasOwnProperty.call(FIRESTORE_CRM_WRITERS, writer) || entry.enforcement !== "SERVER_GUARD") {
    throw new Error(`unknown server-side Firestore CRM writer ${String(writer)}`);
  }
  assertCrmWriterAuthorityCoherent(authority);
  if (authority.firestore !== "OPEN") throw new FirestoreCrmWriterClosedError(writer, authority.firestore);
}

export class PostgresCrmWriterInactiveError extends Error {
  readonly code = "POSTGRES_CRM_WRITER_INACTIVE";
  constructor(readonly writer: string) {
    super(`the PostgreSQL CRM writer ${writer} is not active; the CRM cutover has not activated PostgreSQL writes`);
    this.name = "PostgresCrmWriterInactiveError";
  }
}

/** First act of every PostgreSQL CRM writer path that is not yet composed for use (e.g. the PostgreSQL customer import). */
export function assertPostgresCrmWriterActive(writer: string, authority: CrmWriterAuthority = CRM_WRITER_AUTHORITY): void {
  assertCrmWriterAuthorityCoherent(authority);
  if (authority.postgres !== "ACTIVE") throw new PostgresCrmWriterInactiveError(writer);
}
