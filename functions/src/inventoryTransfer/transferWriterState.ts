// WHICH STORE IS THE TRANSFER AUTHORITY -- one constant, the same shape as Cycle Count and Relocation, so
// activation is a single reviewed change.
//
// The EXISTING Transfer lifecycle (inventoryTransfer/transferOrderCommand.ts: create / dispatch / receive /
// cancel) is BUILT on EOS (eosOps/transferOperations.ts) over the PostgreSQL inventory authority, with the
// DQ-024 per-act warehouse scope enforced by the server. It is HELD: while `postgres` is INACTIVE every EOS
// Transfer operation refuses NOT_ACTIVATED before it reads or writes anything.
//
// Activation is LAST in the DQ-026 order:
//   1. Catalog COPY; 2. inventory baseline / ledger COPY + reconciliation (the ledger and serialized custody the
//   lifecycle debits and credits); 3. Cycle Count activation;
//   4. Transfer COPY of the 47 governed sandbox transfer orders (functions/scripts/transferCopyCensus.js), with the
//      IN_TRANSIT orders' TRANSFER_OUT agreeing between the ledger COPY and the transfer COPY;
//   5. freeze the Firestore transfer writers, flip this constant to { firestore: "FROZEN", postgres: "ACTIVE" };
//   6. client cutover; prove the Firestore writers unavailable.
export type FirestoreTransferWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresTransferWriterState = "INACTIVE" | "ACTIVE";

export interface TransferWriterAuthority {
  readonly firestore: FirestoreTransferWriterState;
  readonly postgres: PostgresTransferWriterState;
}

export const TRANSFER_WRITER_AUTHORITY: TransferWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertTransferWriterAuthorityCoherent(state: TransferWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("Transfer cannot be writable in Firestore and PostgreSQL at the same time");
  }
}
assertTransferWriterAuthorityCoherent(TRANSFER_WRITER_AUTHORITY);
