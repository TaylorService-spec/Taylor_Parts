// WHICH STORE IS THE WORK ORDER AUTHORITY -- one constant, the same shape as Cycle Count, Relocation, Transfer and
// Placement, so activation is a single reviewed change.
//
// WORK ORDER DOMAIN CUTOVER AUTHORIZATION (2026-09-30), DQ-S4. The governed PostgreSQL Work Order domain (create,
// reads, assignment, scheduling, dispatch, the technician lifecycle, execution facts, completion, parts plan) is
// served on /operations/work-orders and is ACTIVE below. Equipment install is built (workOrderEquipmentInstall.ts)
// but NOT on that route. While `postgres` is INACTIVE every operation but the readiness probe refuses NOT_ACTIVATED,
// and the client reads the probe and shows NOT_YET_ACTIVATED rather than a half-working screen.
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

// ACTIVATED (Controller: PR #2005 MERGE + SERVICE ACTIVATION AUTHORIZATION, 2026-09-30, step G): PostgreSQL is the
// Work Order authority and the Firestore Work Order writers are FROZEN -- no active client calls them (the cutover
// removed every browser caller; docs/architecture/work-order-firebase-retirement-ledger.md), and no Firebase deploy
// accompanies this change. There is no Firebase fallback.
export const WORK_ORDER_WRITER_AUTHORITY: WorkOrderWriterAuthority = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertWorkOrderWriterAuthorityCoherent(state: WorkOrderWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("Work Orders cannot be writable in Firestore and PostgreSQL at the same time");
  }
}
assertWorkOrderWriterAuthorityCoherent(WORK_ORDER_WRITER_AUTHORITY);
