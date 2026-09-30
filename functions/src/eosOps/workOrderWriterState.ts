// WHICH STORE IS THE WORK ORDER AUTHORITY -- one constant, the same shape as Cycle Count, Relocation, Transfer and
// Placement, so activation is a single reviewed change.
//
// WORK ORDER DOMAIN CUTOVER AUTHORIZATION (2026-09-30), DQ-S4: readiness stays FAIL-CLOSED. The governed PostgreSQL
// Work Order domain (create, reads, assignment, scheduling, dispatch, the technician lifecycle, execution facts,
// completion, parts plan, equipment install) is BUILT and served on /operations/work-orders, and every operation but
// the readiness probe refuses NOT_ACTIVATED while `postgres` is INACTIVE. The client reads the probe and shows
// NOT_YET_ACTIVATED rather than a half-working screen.
//
// Activation: freeze the Firebase Work Order callables (transitionWorkOrder, createWorkOrder, the scheduling and
// execution callables), flip this to { firestore: "FROZEN", postgres: "ACTIVE" }, then cut the client over. The
// Firestore records are classified by the DQ-S2 census; no record is copied by this constant.
export type FirestoreWorkOrderWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresWorkOrderWriterState = "INACTIVE" | "ACTIVE";

export interface WorkOrderWriterAuthority {
  readonly firestore: FirestoreWorkOrderWriterState;
  readonly postgres: PostgresWorkOrderWriterState;
}

export const WORK_ORDER_WRITER_AUTHORITY: WorkOrderWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertWorkOrderWriterAuthorityCoherent(state: WorkOrderWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("Work Orders cannot be writable in Firestore and PostgreSQL at the same time");
  }
}
assertWorkOrderWriterAuthorityCoherent(WORK_ORDER_WRITER_AUTHORITY);
