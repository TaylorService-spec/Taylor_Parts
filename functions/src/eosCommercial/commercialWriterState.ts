// THE COMMERCIAL WRITER AUTHORITY STATE -- which writer set may mutate Opportunity / Sales Agreement / Sales Order data,
// stated once.
//
// The Commercial twin of functions/src/crm/crmWriterState.ts, under the C-wave Owner rule restated in
// docs/architecture/commercial-c5-data-migration-plan.md §10: "never both Firebase and Render mutation authority for the
// same operation"; no dual write; no fallback. Two writer sets, NEVER two authoritative ones.
//
//   Firestore (legacy)  OPEN     the Firebase Commercial callables (createOpportunity, updateOpportunity,
//                                transitionOpportunity, closeOpportunityAsWon, createSalesAgreement,
//                                updateSalesAgreementDraft, acceptSalesAgreement, createSalesOrder,
//                                createSalesOrderFromOpportunity, transitionSalesOrder) are the Commercial authority
//                       FROZEN   the Firestore Commercial writers refuse (plan §10's retirement switch -- not built here);
//                                reversible only while PostgreSQL is INACTIVE
//                       RETIRED  refused for good; removal follows (C7). Not reversible.
//   PostgreSQL (target) INACTIVE the Render /commercial/sales transport refuses EVERY mutation (503
//                                COMMERCIAL_WRITER_INACTIVE) after authentication and before any caller context or
//                                Commercial table is touched; reads stay available
//                       ACTIVE   the governed PostgreSQL Commercial commands accept authoritative writes (C6)
//
//   OPEN/INACTIVE   --FREEZE-->                          FROZEN/INACTIVE
//   FROZEN/INACTIVE --ROLLBACK_BEFORE_POSTGRES_WRITES-->  OPEN/INACTIVE
//   FROZEN/INACTIVE --ACTIVATE_POSTGRES-->               FROZEN/ACTIVE
//   FROZEN/ACTIVE   --RETIRE_FIRESTORE-->                RETIRED/ACTIVE
//
// OPEN/ACTIVE is incoherent (two authoritative writer sets); nothing leaves ACTIVE (no silent revert). The committed
// state is a CODE constant -- never an environment variable, a request field or a Firestore flag (that would be a
// second place the answer lives, and a new Firebase dependency). Moving it is a reviewed code change.
//
// Pure: no Firebase, no I/O.

export type FirestoreCommercialWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresCommercialWriterState = "INACTIVE" | "ACTIVE";

export interface CommercialWriterAuthority {
  readonly firestore: FirestoreCommercialWriterState;
  readonly postgres: PostgresCommercialWriterState;
}

/**
 * THE COMMITTED STATE. The Firebase Commercial callables are the current authority (active in platform-sandbox);
 * PostgreSQL Commercial writes are NOT active. Flipping this is the C6 cutover, not a configuration change.
 */
export const COMMERCIAL_WRITER_AUTHORITY: CommercialWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

export const COMMERCIAL_WRITER_TRANSITIONS = Object.freeze([
  Object.freeze({ name: "FREEZE", from: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }) }),
  Object.freeze({ name: "ROLLBACK_BEFORE_POSTGRES_WRITES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" }) }),
  Object.freeze({ name: "ACTIVATE_POSTGRES", from: Object.freeze({ firestore: "FROZEN", postgres: "INACTIVE" }), to: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }) }),
  Object.freeze({ name: "RETIRE_FIRESTORE", from: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }), to: Object.freeze({ firestore: "RETIRED", postgres: "ACTIVE" }) }),
] as const);

export class CommercialWriterStateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CommercialWriterStateError";
  }
}

export function assertCommercialWriterAuthorityCoherent(state: CommercialWriterAuthority): void {
  const f = state?.firestore, p = state?.postgres;
  if (!["OPEN", "FROZEN", "RETIRED"].includes(f as string) || !["INACTIVE", "ACTIVE"].includes(p as string)) {
    throw new CommercialWriterStateError("COMMERCIAL_WRITER_STATE_INVALID", "unknown Commercial writer state");
  }
  if (f === "OPEN" && p === "ACTIVE") {
    throw new CommercialWriterStateError("TWO_AUTHORITATIVE_WRITER_SETS", "Firestore OPEN with PostgreSQL ACTIVE would be two authoritative Commercial writer sets");
  }
  if (f === "RETIRED" && p === "INACTIVE") {
    throw new CommercialWriterStateError("NO_AUTHORITATIVE_WRITER_SET", "Firestore RETIRED with PostgreSQL INACTIVE leaves no Commercial writer at all");
  }
}

export function assertCommercialWriterTransition(from: CommercialWriterAuthority, to: CommercialWriterAuthority): string {
  assertCommercialWriterAuthorityCoherent(from);
  assertCommercialWriterAuthorityCoherent(to);
  const match = COMMERCIAL_WRITER_TRANSITIONS.find((t) => t.from.firestore === from.firestore && t.from.postgres === from.postgres
    && t.to.firestore === to.firestore && t.to.postgres === to.postgres);
  if (!match) {
    const code = from.postgres === "ACTIVE" && to.firestore === "OPEN" ? "NO_SILENT_REVERT_TO_FIRESTORE" : "COMMERCIAL_WRITER_TRANSITION_NOT_ALLOWED";
    throw new CommercialWriterStateError(code, `${from.firestore}/${from.postgres} -> ${to.firestore}/${to.postgres} is not an allowed Commercial writer transition`);
  }
  return match.name;
}

export class CommercialWriterInactiveError extends Error {
  readonly code = "COMMERCIAL_WRITER_INACTIVE";
  constructor(readonly writer: string) {
    super(`the PostgreSQL Commercial writer ${writer} is not active; the Commercial cutover has not activated PostgreSQL writes`);
    this.name = "CommercialWriterInactiveError";
  }
}

/**
 * First act of every PostgreSQL Commercial MUTATION path. Throws unless the authority is coherent and PostgreSQL is
 * ACTIVE. An incoherent authority throws CommercialWriterStateError -- it is never read as "active".
 */
export function assertPostgresCommercialWriterActive(writer: string, authority: CommercialWriterAuthority = COMMERCIAL_WRITER_AUTHORITY): void {
  assertCommercialWriterAuthorityCoherent(authority);
  if (authority.postgres !== "ACTIVE") throw new CommercialWriterInactiveError(writer);
}
