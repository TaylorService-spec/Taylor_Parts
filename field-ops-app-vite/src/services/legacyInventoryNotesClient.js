// THE ARCHIVED LEGACY INVENTORY-ACTION NOTES, READ FROM EOS. Firebase exit B3 (DECISIONS #B3; Owner ruling 8).
//
//   browser -> THIS -> POST /operations/inventory: listLegacyInventoryActionNotes { partId }
//   -> verified bearer -> EOS Principal + tenant + inventory.action.read -> PostgreSQL eos_ops.legacy_inventory_action_notes (READ ONLY)
//
// The notes are the frozen Firestore `inventory_actions` trail (Owner ruling 2026-08-30): ARCHIVED EVIDENCE of what someone once recorded,
// never current facts and never stock movements. Pure and Firebase-free so the EOS build never loads Firestore to show them.
// Imported LAZILY, on the first real call (reorderApiClient.js reaches the Firebase module for the user's token): this stays node-importable.
const callReorderApi = async (...args) => (await import("./reorderApiClient.js")).callReorderApi(...args);

export const LEGACY_NOTES_OPERATION = "listLegacyInventoryActionNotes";

/**
 * One governed read of a Part's archived notes: `{ rows, archiveLoaded }`, or a thrown Error carrying the server's code (a refusal is never
 * an empty-looking list). `rows` have the legacy document shape the panels already read: id, transactionType, quantityDelta, reason,
 * createdBy (the FIREBASE uid as stored) and createdAt (epoch ms). `archiveLoaded` tells "nothing has been archived here" from "this Part has none".
 */
export async function readArchivedNotes(partId, { call = callReorderApi, signal } = {}) {
  const res = await call(LEGACY_NOTES_OPERATION, { partId }, signal ? { signal } : {});
  if (!res || res.ok !== true) throw Object.assign(new Error(res?.message ?? "the archived notes could not be read"), { code: res?.code ?? "INTERNAL" });
  const items = Array.isArray(res.result?.items) ? res.result.items : null;
  if (items === null) throw Object.assign(new Error("malformed answer"), { code: "MALFORMED" });
  return {
    rows: items.map((n) => ({
      id: n.id, transactionType: n.transactionType, quantityDelta: n.quantityDelta,
      reason: n.reason ?? undefined, createdBy: n.createdBy ?? undefined, createdAt: n.createdAt,
    })),
    archiveLoaded: res.result?.archiveLoaded === true,
  };
}
