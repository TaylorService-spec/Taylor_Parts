// WHICH STORE IS THE BIN PLACEMENT (PUT-AWAY) AUTHORITY -- one constant, the same shape as Cycle Count, Relocation
// and Transfer, so activation is a single reviewed change.
//
// Controller ruling DQ-038 (2026-09-28): the EXISTING placement record (inventoryLocation/putAwayCommand.ts,
// collection bin_placements) has a PostgreSQL representation (eos_ops.bin_placements, migration 1764126000000) and
// an EOS command (eosOps/binPlacementOperations.ts). It is NOT activated: while `postgres` is INACTIVE every EOS
// put-away refuses NOT_ACTIVATED before it reads or writes anything.
//
// Activation follows the inventory baseline COPY (DQ-026), together with the relocation that writes the same
// placement: freeze the Firestore put-away writer, flip this constant to { firestore: "FROZEN", postgres: "ACTIVE" },
// then cut the client over. Historical Firestore placements are evidence of where stock was last put; carrying them
// across is part of the baseline COPY, never an inference.
export type FirestorePlacementWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresPlacementWriterState = "INACTIVE" | "ACTIVE";

export interface PlacementWriterAuthority {
  readonly firestore: FirestorePlacementWriterState;
  readonly postgres: PostgresPlacementWriterState;
}

export const PLACEMENT_WRITER_AUTHORITY: PlacementWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertPlacementWriterAuthorityCoherent(state: PlacementWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("Bin placement cannot be writable in Firestore and PostgreSQL at the same time");
  }
}
assertPlacementWriterAuthorityCoherent(PLACEMENT_WRITER_AUTHORITY);
