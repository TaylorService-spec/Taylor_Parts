// WHICH STORE IS THE EQUIPMENT REGISTER AUTHORITY -- one constant, the same shape as the Work Order, Cycle Count,
// Relocation, Transfer and Placement writer states, so the activation is one reviewed change.
//
// Controller EQUIPMENT ACTIVATION AUTHORIZED (2026-10-01): the active register moves from the Firestore `equipment`
// collection to eos_ops.equipment. The client no longer reads or writes Firestore Equipment; Firestore is FROZEN (no
// dual write). Installation additionally waits on the tenant's certified inventory baseline (inventoryBaselineGate.ts),
// because it moves stock.
export type FirestoreEquipmentWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresEquipmentWriterState = "INACTIVE" | "ACTIVE";

export interface EquipmentWriterAuthority {
  readonly firestore: FirestoreEquipmentWriterState;
  readonly postgres: PostgresEquipmentWriterState;
}

export const EQUIPMENT_WRITER_AUTHORITY: EquipmentWriterAuthority = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertEquipmentWriterAuthorityCoherent(state: EquipmentWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("EQUIPMENT_WRITER_AUTHORITY: Firestore OPEN and PostgreSQL ACTIVE at once is a dual write");
  }
}
assertEquipmentWriterAuthorityCoherent(EQUIPMENT_WRITER_AUTHORITY);
