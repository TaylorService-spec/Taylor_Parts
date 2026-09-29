// WHICH TRANSPORT ACQUIRES AN EXISTING SERIALIZED UNIT -- the client MIRROR of the server's governed switch
// (functions/src/serializedAsset/acquireWriterState.ts ACQUIRE_WRITER_AUTHORITY, Controller ruling DQ-036(b)).
//
// While `postgres` is INACTIVE the client keeps its Firebase callable path, unchanged. At activation BOTH constants
// flip together in one reviewed change (serializedAssetAcquireEosClient.test.mjs pins them equal), and the client
// routes to Client -> EOS API (/operations/serialized-asset) -> governed authorization -> PostgreSQL. There is no
// per-call fallback between the two: the switch picks one transport, and the EOS path never reads Firebase.
export const SERIALIZED_ASSET_ACQUIRE_WRITER_AUTHORITY = Object.freeze({ firestore: "OPEN", postgres: "INACTIVE" });
