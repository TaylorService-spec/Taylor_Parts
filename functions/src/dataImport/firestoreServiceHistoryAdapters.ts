// EOS Data Import -- the FIRESTORE side, for imported service history.
//
// ============================ THE COLLECTION, AND WHY IT IS ITS OWN ============================
//
// `imported_service_history` is a NEW collection and the only one import creates besides its
// own job log. It is deliberately not `fieldops_wos`: a Work Order is a lifecycle, and a
// record dropped into a terminal state never had one. Every question the system can ask a
// Work Order -- who transitioned it, when it was scheduled, what was consumed -- has no
// honest answer for a job that happened in another system in 2019, and a fabricated record
// would be indistinguishable from a real one in every metric that counts Work Orders.
//
// ONE WRITER, WHICH IS WHY THE AUTHORITY IS THE IMPORT CAPABILITY.
//
// Every other entity's writer calls a command that already had an owner: Parts have
// createPart, Customers have their account authority, Inventory has the opening-balance
// command. This record type exists only because import creates it -- no screen writes it, no
// other command touches it, and no lifecycle acts on it. So the authority to write one IS the
// authority to execute an import, which the callable has already checked.
//
// Reusing a domain capability here would be worse than it looks: `workOrder.create` would
// imply that these ARE work orders, which is the exact confusion this collection exists to
// prevent, and inventing `serviceHistory.record.create` would add a catalog entry whose only
// holder and only caller is this file. A capability that exists to make one caller work is
// how a permission model stops meaning anything.

import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";

import { ACCOUNTS_COLLECTION } from "../account/accountPortfolioSummary.js";
import { normalizeAccountSearchName } from "../account/accountImportCommand.js";
import { naturalIdentityKey } from "./contracts/entityContract.js";
import {
  SERVICE_HISTORY_REFERENCES,
  SERVICE_HISTORY_IMPORT_CONTRACT,
} from "./contracts/serviceHistoryImportContract.js";
import type { RowWriter } from "./importExecution.js";

/** The one collection this entity introduces. Admin-SDK-only; client access is denied. */
export const IMPORTED_SERVICE_HISTORY_COLLECTION = "imported_service_history";

const AUDIT_COLLECTION = "auditEvents";

/** The customers a service-history file may point at. */
export async function loadServiceHistoryReferences(
  db: Firestore = getFirestore(),
): Promise<Readonly<Record<string, ReadonlySet<string>>>> {
  const snap = await db.collection(ACCOUNTS_COLLECTION).select("name").get();
  const customers = new Set<string>();
  for (const doc of snap.docs) {
    const name = String((doc.data() ?? {}).name ?? "").trim();
    if (name) customers.add(naturalIdentityKey(name));
  }
  return Object.freeze({ [SERVICE_HISTORY_REFERENCES.CUSTOMER]: customers });
}

/**
 * Service records already imported, by their identity key.
 *
 * Read whole and compared in memory, like equipment serials and for the same reason: the
 * identity is a composite the contract computes, and no query can reproduce it. Bounded by
 * what this environment has already imported.
 */
export async function loadExistingServiceHistoryIdentities(
  _identities: readonly string[],
  db: Firestore = getFirestore(),
): Promise<ReadonlySet<string>> {
  const snap = await db.collection(IMPORTED_SERVICE_HISTORY_COLLECTION).select("identityKey").get();
  const found = new Set<string>();
  for (const doc of snap.docs) {
    const key = String((doc.data() ?? {}).identityKey ?? "");
    if (key) found.add(key);
  }
  return found;
}

/**
 * The service-history writer.
 *
 * It resolves the customer to an id -- the ONE thing it links -- and stores everything else as
 * the file wrote it. The technician stays a name and the equipment serial stays a string, on
 * purpose: linking a 2019 job to a current employee on a name match would attribute somebody
 * else's work to a real person inside a record that looks authoritative, and linking a serial
 * would attach a replaced machine's history to its replacement.
 */
export function firestoreServiceHistoryWriter(
  actorUid: string,
  db: Firestore = getFirestore(),
  importJobId = "unknown",
): RowWriter {
  return {
    async write(draft, idempotencyKey) {
      try {
        const customerName = String(draft.customerName ?? "");
        const accountId = await resolveAccountIdByName(db, customerName);
        if (!accountId) {
          return { kind: "failed", code: "CUSTOMER_NOT_FOUND", message: `No customer named "${customerName}" exists.` };
        }

        // Recomputed from the CONTRACT rather than passed in: the stored key and the key
        // preview compares against must be the same function, or a record could be written
        // under a key that no future duplicate check would ever look for.
        const identityKey = SERVICE_HISTORY_IMPORT_CONTRACT.identityKey(draft);
        const docId = `SH-${idempotencyKey}`;

        return await db.runTransaction(async (txn) => {
          const ref = db.collection(IMPORTED_SERVICE_HISTORY_COLLECTION).doc(docId);
          if ((await txn.get(ref)).exists) return { kind: "replayed" as const };

          const at = Timestamp.now();
          txn.set(ref, {
            ...stripUndefined(draft),
            accountId,
            identityKey,
            // PROVENANCE IS PART OF THE RECORD, not metadata about it. Anyone reading this
            // row -- now or in five years -- must be able to see that it describes service
            // performed in another system, not work EOS did. A field nobody can miss is the
            // only version of that claim that survives being copied into a report.
            recordKind: "IMPORTED_SERVICE_HISTORY",
            sourceSystem: "DATA_IMPORT",
            importJobId,
            importedAt: at,
            importedBy: actorUid,
          });

          txn.set(db.collection(AUDIT_COLLECTION).doc(`dataImport_serviceHistory_${idempotencyKey}`), {
            action: "createServiceHistoryFromImport",
            actorUid,
            targetType: "imported_service_history",
            targetId: docId,
            at,
            summary: `Historical service record for "${customerName}" on ${String(draft.serviceDate)} imported (${importJobId}).`,
          });

          return { kind: "created" as const };
        });
      } catch {
        return { kind: "failed", code: "UNEXPECTED", message: "The record could not be written." };
      }
    },
  };
}

async function resolveAccountIdByName(db: Firestore, name: string): Promise<string | null> {
  const snap = await db
    .collection(ACCOUNTS_COLLECTION)
    .where("nameLower", "==", normalizeAccountSearchName(name))
    .limit(2)
    .get();
  // Two customers with one name is a question, not a resolution.
  return snap.size === 1 ? snap.docs[0].id : null;
}

function stripUndefined(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out;
}
