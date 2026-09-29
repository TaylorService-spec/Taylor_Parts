// WHICH STORE IS THE STOCK RELOCATION AUTHORITY -- one constant, the same shape as Cycle Count
// (cycleCount/cycleCountWriterState.ts), so activation is a single reviewed change.
//
// Controller ruling DQ-036 (2026-09-28): the EXISTING relocation (relocateStock, BIN-P6 / Decision #170)
// moves onto EOS -- Client -> EOS API -> governed server authorization -> PostgreSQL inventory authority --
// with no new business behavior. The EOS command is BUILT and locally proven (eosOps/stockRelocationOperations.ts);
// it is NOT activated. While `postgres` is INACTIVE every EOS relocation refuses NOT_ACTIVATED before it
// reads or writes anything, so merging this cannot open a second relocation authority beside the live
// Firestore one.
//
// Activation is a later governed gate (DQ-026 order):
//   1. Catalog COPY done (eos_ops.parts is the Part authority the command reads);
//   2. inventory baseline / ledger COPY + reconciliation done (the command's sufficiency check reads the
//      PostgreSQL ledger and serialized custody -- an empty ledger would refuse every move, a partial one
//      would permit wrong ones);
//   3. freeze the Firestore relocation writer, flip this constant to { firestore: "FROZEN", postgres: "ACTIVE" };
//   4. client cutover to the EOS route; prove the Firestore writer unavailable.
export type FirestoreRelocationWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresRelocationWriterState = "INACTIVE" | "ACTIVE";

export interface RelocationWriterAuthority {
  readonly firestore: FirestoreRelocationWriterState;
  readonly postgres: PostgresRelocationWriterState;
}

export const RELOCATION_WRITER_AUTHORITY: RelocationWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertRelocationWriterAuthorityCoherent(state: RelocationWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("Stock relocation cannot be writable in Firestore and PostgreSQL at the same time");
  }
}
assertRelocationWriterAuthorityCoherent(RELOCATION_WRITER_AUTHORITY);
