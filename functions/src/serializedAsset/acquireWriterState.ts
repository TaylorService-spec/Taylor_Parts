// WHICH STORE IS THE SERIALIZED ASSET ACQUISITION AUTHORITY -- one constant, the same shape as the other
// inventory domains, so activation is a single reviewed change.
//
// Controller ruling DQ-036(b) (2026-09-28): acquire-existing-unit moves to Client -> EOS API -> governed
// authorization -> PostgreSQL Catalog / inventory authority (eosOps/serializedAssetAcquireOperations.ts; capability
// inventory.serializedAsset.acquire, migration 1764129600000, granted only through Administration). It is NOT
// activated: while `postgres` is INACTIVE the EOS acquisition refuses NOT_ACTIVATED before it reads anything, and
// the client keeps its Firebase path (field-ops-app-vite services/serializedAssetAcquireCallableClient.js reads the
// SAME switch, mirrored).
//
// At activation (after the Catalog COPY and the inventory baseline / serialized custody COPY), the Firestore
// acquireSerializedAsset callable -- the last J6 Firebase Catalog reader on this path -- is RETIRED:
// flip to { firestore: "FROZEN", postgres: "ACTIVE" } here and in the client mirror, together.
export type FirestoreAcquireWriterState = "OPEN" | "FROZEN" | "RETIRED";
export type PostgresAcquireWriterState = "INACTIVE" | "ACTIVE";

export interface AcquireWriterAuthority {
  readonly firestore: FirestoreAcquireWriterState;
  readonly postgres: PostgresAcquireWriterState;
}

export const ACQUIRE_WRITER_AUTHORITY: AcquireWriterAuthority = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });

/** Two writable authorities at once is the one forbidden state. */
export function assertAcquireWriterAuthorityCoherent(state: AcquireWriterAuthority): void {
  if (state.firestore === "OPEN" && state.postgres === "ACTIVE") {
    throw new Error("Serialized asset acquisition cannot be writable in Firestore and PostgreSQL at the same time");
  }
}
assertAcquireWriterAuthorityCoherent(ACQUIRE_WRITER_AUTHORITY);
