// Email Connections + Inbound Work -- CANDIDATE RESOLUTION. The one module here that reads Firestore.
//
// SUGGESTIONS, NOT DECISIONS, AND CERTAINLY NOT MASTER-DATA WRITES. This turns two exact keys extracted
// from a message into EOS record ids so the reviewer does not retype them. It matches on unique keys only
// -- an equipment serial and a contact's email address -- and reports NONE when there is not exactly one
// hit. There is no fuzzy matching, no scoring, no entity resolution and no stewardship here on purpose:
// those are Verenward Data Governance's subject matter (or a customer's own MDM platform), and base EOS
// must not grow a second, weaker copy of them.
//
// NOTHING HERE WRITES. An inbound email that spells the customer's address differently does not update the
// customer; the mastered record is read and never touched. Acceptance uses the operational values for the
// Work Order and leaves master-data change to the governance product the customer chose.
import type { Firestore } from "firebase-admin/firestore";
import { EQUIPMENT_COLLECTION } from "../workOrderInstall/workOrderInstallCommand";
import { NO_CANDIDATE, type CandidateMatch } from "./inboundProcessing";
import { MAX_EXTRACTED_FIELD_LENGTH, boundedString, normalizeEmailAddress } from "./inboundWorkModel";

const CONTACTS_COLLECTION = "contacts";

/** The comparison key `equipment.serialNumberKey` holds -- derived exactly as equipmentImportCommand does. */
export function serialNumberKey(serial: unknown): string {
  return boundedString(serial, MAX_EXTRACTED_FIELD_LENGTH).toUpperCase().replace(/\s+/g, "");
}

export interface ResolvedCandidates {
  customerCandidate: CandidateMatch;
  locationCandidate: CandidateMatch;
  equipmentCandidate: CandidateMatch;
}

const candidate = (id: string | null, rawValue: string, matchedOn: string): CandidateMatch => ({
  id,
  rawValue: boundedString(rawValue, MAX_EXTRACTED_FIELD_LENGTH),
  confidence: id ? "EXACT" : "NONE",
  matchedOn: id ? matchedOn : "",
});

/**
 * Resolve the customer / location / equipment suggestions for one inbound message.
 *
 * EQUIPMENT FIRST, because a serial is the strongest identifier in a service email and it carries the
 * account and site with it. The sender address is only consulted for the customer, and only when the
 * serial produced nothing -- a vendor emailing on a customer's behalf must not silently retarget a request
 * that already named a machine.
 *
 * `limit(2)` everywhere: two hits means the key is not unique in this data, and the honest answer is then
 * NONE plus the raw value, not the first row.
 */
export async function resolveInboundCandidates(
  db: Firestore,
  input: { senderEmail?: string | null; serialNumber?: string | null },
): Promise<ResolvedCandidates> {
  const serialRaw = boundedString(input?.serialNumber, MAX_EXTRACTED_FIELD_LENGTH);
  const sender = normalizeEmailAddress(input?.senderEmail);

  let customerCandidate = NO_CANDIDATE;
  let locationCandidate = NO_CANDIDATE;
  let equipmentCandidate = serialRaw ? candidate(null, serialRaw, "") : NO_CANDIDATE;

  if (serialRaw) {
    const key = serialNumberKey(serialRaw);
    const snap = await db.collection(EQUIPMENT_COLLECTION).where("serialNumberKey", "==", key).limit(2).get();
    if (snap.size === 1) {
      const doc = snap.docs[0];
      const data = doc.data() as Record<string, unknown>;
      equipmentCandidate = candidate(doc.id, serialRaw, "serialNumberKey");
      const accountId = boundedString(data.accountId, 255);
      const locationId = boundedString(data.locationId, 255);
      if (accountId) customerCandidate = candidate(accountId, serialRaw, "equipmentAccount");
      if (locationId) locationCandidate = candidate(locationId, serialRaw, "equipmentLocation");
    }
  }

  if (!customerCandidate.id && sender) {
    const snap = await db.collection(CONTACTS_COLLECTION).where("email", "==", sender).limit(2).get();
    if (snap.size === 1) {
      const accountId = boundedString((snap.docs[0].data() as Record<string, unknown>).accountId, 255);
      customerCandidate = accountId ? candidate(accountId, sender, "contactEmail") : candidate(null, sender, "");
    } else {
      customerCandidate = candidate(null, sender, "");
    }
  }

  return { customerCandidate, locationCandidate, equipmentCandidate };
}
