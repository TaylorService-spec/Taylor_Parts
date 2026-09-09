// Technician profile — the one trusted write.
//
// This replaces the LAST direct client write in the application: `techniciansStore.add(...)` from
// `domain/jobActions.js`, reached from the Technicians surface's New Technician modal.
//
// ============================ THE STATUS IS THE SERVER'S ============================
//
// The retired rule was `isAdminOrDispatcher() && request.resource.data.status == 'available'`, and
// that second clause is part of the AUTHORITY rather than a client convention: it REFUSED a create
// that started a technician in any other state. So the command does not validate a supplied status
// — it does not accept one at all. Choosing it here rather than checking it removes the question of
// what happens when a caller sends something else, which is the kind of question a validation
// eventually gets wrong.
//
// `available` is also the only sane starting state: a technician who has just been created cannot
// already be on a job.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";

const TECHNICIANS = "fieldops_technicians";

export const TECHNICIAN_CREATE_CAPABILITY = "service.technician.create";

/** Mirrors domain/constants.js's TECH_STATUS.AVAILABLE and the retired rule's required value. */
export const TECHNICIAN_STATUS_AVAILABLE = "available";

export class TechnicianCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TechnicianCommandError";
  }
}

export interface BuiltTechnician {
  readonly name: string;
  readonly phone: string | null;
  readonly status: typeof TECHNICIAN_STATUS_AVAILABLE;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Build the technician document. Pure.
 *
 * THE FIELD SET IS CLOSED. Exactly the three fields the client write produced — name, phone,
 * status — and nothing a caller adds can join them. The old path spread nothing, so neither does
 * this; an open field set on a create is how a client starts populating fields no rule ever
 * reviewed.
 */
export function buildTechnician(input: { name?: unknown; phone?: unknown }): BuiltTechnician {
  const name = text(input?.name);
  // The modal already requires a name. Required again here because this is now the only write path,
  // and a bound only the UI applies is not a bound.
  if (!name) throw new TechnicianCommandError("NAME_REQUIRED", "A technician name is required.");
  return {
    name,
    // The client wrote `phone` straight through, including undefined. Normalised to null so an
    // absent phone is a stored fact rather than a missing key.
    phone: text(input?.phone),
    status: TECHNICIAN_STATUS_AVAILABLE,
  };
}

export async function persistTechnician(
  db: Firestore,
  input: { name?: unknown; phone?: unknown },
): Promise<{ id: string; name: string; phone: string | null; status: string }> {
  const built = buildTechnician(input);
  const ref = db.collection(TECHNICIANS).doc();
  await ref.set(built);
  // The caller needs the id and the name back: the surface closes its modal, focuses the new row
  // and announces "Technician <name> added." The MINTED id, never one a caller supplied.
  return { ...built, id: ref.id };
}

export const createTechnician = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const actorUid = request.auth.uid;

  // Fail-closed: a resolver that throws is a denial, never an allow.
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: actorUid,
      permissionIds: [TECHNICIAN_CREATE_CAPABILITY],
    });
    allowed = decisions[TECHNICIAN_CREATE_CAPABILITY] === true;
  } catch (err) {
    console.error(`[technician] capability resolution failed for ${TECHNICIAN_CREATE_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", `You are not authorized: ${TECHNICIAN_CREATE_CAPABILITY}`);

  const data = (request.data ?? {}) as { name?: unknown; phone?: unknown };
  try {
    return await persistTechnician(getFirestore(), data);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof TechnicianCommandError) {
      throw new HttpsError("invalid-argument", err.message, { code: err.code });
    }
    throw new HttpsError("internal", "The technician could not be created.");
  }
});
