// WHICH STORE IS THE CYCLE COUNT AUTHORITY -- one constant, the same shape Catalog (catalogWriterState.ts)
// and CRM use, so activation is a single reviewed change rather than a scattering of flags.
//
// Controller ruling DQ-018 (2026-09-28): Cycle Count is the FIRST inventory domain to cut over to the EOS
// operations transport (Render -> PostgreSQL), with warehouse scope enforced server-side (DQ-017). The
// transport and its commands are BUILT and locally proven; they are NOT activated. While `postgres` is
// INACTIVE every EOS Cycle Count operation refuses NOT_ACTIVATED before it reads or writes anything, so
// merging this cannot open a second, empty Cycle Count authority beside the live Firestore one.
//
// Activation is a later governed gate, in this order (docs/architecture/cycle-count-eos-cutover.md):
//   1. zero-population census of the legacy sheets (2026-09-20 ruling: v1 records are LEGACY_HISTORICAL_
//      EVIDENCE; ANY schemaVersion=2 sheet present at the window means STOP and do a real migration);
//   2. inventory ledger census (DQ-019) READY for the parts the warehouse counts;
//   3. Catalog COPY done (eos_ops.parts is the Part authority these commands read);
//   4. freeze the Firestore sheet/line writers, flip this constant to { firestore: "FROZEN", postgres: "ACTIVE" };
//   5. client cutover to the EOS route; prove the Firestore writers unavailable.
export type FirestoreCycleCountWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresCycleCountWriterState = "INACTIVE" | "ACTIVE";

export interface CycleCountWriterAuthority {
  readonly firestore: FirestoreCycleCountWriterState;
  readonly postgres: PostgresCycleCountWriterState;
}

export const CYCLE_COUNT_WRITER_AUTHORITY: CycleCountWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertCycleCountWriterAuthorityCoherent(state: CycleCountWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("Cycle Count cannot be writable in Firestore and PostgreSQL at the same time");
  }
}
assertCycleCountWriterAuthorityCoherent(CYCLE_COUNT_WRITER_AUTHORITY);
