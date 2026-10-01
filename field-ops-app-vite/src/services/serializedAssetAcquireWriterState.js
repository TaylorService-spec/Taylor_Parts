// WHICH TRANSPORT ACQUIRES AN EXISTING SERIALIZED UNIT -- the client MIRROR of the server's governed switch
// (functions/src/serializedAsset/acquireWriterState.ts ACQUIRE_WRITER_AUTHORITY, Controller ruling DQ-036(b)).
//
// FLIPPED (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): both constants move together in one
// reviewed change (serializedAssetAcquireEosClient.test.mjs pins them equal). The client routes ONLY to Client -> EOS
// API (/operations/serialized-asset) -> governed authorization -> PostgreSQL. The Firebase callable path is retired:
// there is no per-call fallback, and a server refusal (NOT_ACTIVATED included) is the answer.
export const SERIALIZED_ASSET_ACQUIRE_WRITER_AUTHORITY = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
