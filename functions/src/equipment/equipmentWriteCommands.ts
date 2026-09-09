// Equipment create and update — the last governed business writes to leave the browser.
//
// These are the richest contracts in the migration, and the two things that make them so are the
// two most likely to be lost in a naive port:
//
//   CREATE  proves a CROSS-DOCUMENT relationship: the Location must belong to the named Account.
//           The browser used to pass the Location object it already had; that object is no longer
//           evidence. The server reads `locations/{locationId}` itself.
//
//   UPDATE  restricts the CHANGED KEYS, not the resulting document's key set. Those are different
//           claims, and confusing them bricks records.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";

const EQUIPMENT = "equipment";
const LOCATIONS = "locations";

export const EQUIPMENT_CREATE = "service.equipment.create";
export const EQUIPMENT_UPDATE = "service.equipment.update";

/** Mirrors `equipmentWritableKeys()`. The create allowlist: anything else denies the whole write. */
export const EQUIPMENT_WRITABLE_KEYS = Object.freeze([
  "accountId",
  "locationId",
  "name",
  "status",
  "manufacturer",
  "model",
  "serialNumber",
  "assetTag",
  "installedDate",
  "warrantyExpiresDate",
  "notes",
  "createdAt",
  "updatedAt",
]);

/** Mirrors `equipmentEditableKeys()`. The set an ordinary edit may CHANGE — not the set a document may contain. */
export const EQUIPMENT_EDITABLE_KEYS = Object.freeze([
  "name",
  "manufacturer",
  "model",
  "serialNumber",
  "assetTag",
  "installedDate",
  "warrantyExpiresDate",
  "notes",
  "status",
  "updatedAt",
]);

const REQUIRED_CREATE_KEYS = Object.freeze(["accountId", "locationId", "name", "status", "createdAt", "updatedAt"]);

const OPTIONAL_STRING_FIELDS = Object.freeze([
  "manufacturer",
  "model",
  "serialNumber",
  "assetTag",
  "installedDate",
  "warrantyExpiresDate",
  "notes",
]);

export const STATUS = Object.freeze({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", RETIRED: "RETIRED" });

export class EquipmentCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "EquipmentCommandError";
  }
}

type Rec = Record<string, unknown>;

/** Mirrors `equipmentStatusValid()`. */
export function statusValid(status: unknown): boolean {
  return status === STATUS.ACTIVE || status === STATUS.INACTIVE || status === STATUS.RETIRED;
}

/**
 * Mirrors `equipmentNameValid()`.
 *
 * The Rules predicate is `name is string && name.trim().size() > 0 &&
 * !name.matches("[\\p{Z}\\p{Cf}\\s]*") && name.size() <= 200`. The negated match is a
 * whitespace/format-character-only test that `trim()` alone does not cover: U+200B and friends are
 * format characters that survive a trim, so a "name" of invisible characters would otherwise pass.
 */
export function nameValid(name: unknown): boolean {
  if (typeof name !== "string") return false;
  if (name.length > 200) return false;
  if (name.trim().length === 0) return false;
  // \p{Z} separators, \p{Cf} format characters, and ordinary whitespace. A name made only of these
  // is not a name.
  return !/^[\p{Z}\p{Cf}\s]*$/u.test(name);
}

/** Mirrors `equipmentOptionalFieldsValid()`: present-and-not-a-string is the only failure. */
export function optionalFieldsValid(data: Rec): boolean {
  return OPTIONAL_STRING_FIELDS.every((f) => {
    const v = data[f] ?? null;
    return v === null || typeof v === "string";
  });
}

/**
 * Mirrors `equipmentTransitionAllowed()` EXACTLY, including what it refuses.
 *
 * ACTIVE <-> INACTIVE, or no change at all. RETIRED is reachable and leavable only through the
 * trusted lifecycle actions, so an ordinary edit can neither retire nor reactivate. A record whose
 * STORED status is malformed or absent is denied whatever it is given — the fail-closed direction,
 * and deliberate: such a record is repairable only by the trusted writer.
 */
export function transitionAllowed(before: unknown, after: unknown): boolean {
  if (!statusValid(before) || !statusValid(after)) return false;
  if (after === before) return true;
  if (before === STATUS.ACTIVE && after === STATUS.INACTIVE) return true;
  if (before === STATUS.INACTIVE && after === STATUS.ACTIVE) return true;
  return false;
}

// ════════════════════════════ CREATE ════════════════════════════

export interface CreateContext {
  readonly actorUid: string;
  readonly nowMillis: number;
  /** The Location document the SERVER read. Never one the caller supplied. */
  readonly storedLocation: Rec | null;
}

/**
 * Build the Equipment document, or throw.
 *
 * OWNERSHIP IS PROVEN FROM THE STORED LOCATION. The caller names an accountId and a locationId as
 * business inputs; the server reads that location and checks its `accountId`. A caller-supplied
 * location object, or a pre-resolved "ownership is fine" boolean, is not evidence and there is no
 * parameter here to carry one.
 */
export function buildEquipmentCreate(input: Rec, ctx: CreateContext): Rec {
  const data = input ?? {};

  // THE ANTI-INJECTION ALLOWLIST, first. An unknown key denies the whole write rather than being
  // stripped: a deny-list cannot fail closed on fields nobody has thought of yet.
  for (const key of Object.keys(data)) {
    if (key === "createdAt" || key === "updatedAt") continue; // server-owned, supplied below
    if (!EQUIPMENT_WRITABLE_KEYS.includes(key)) {
      throw new EquipmentCommandError("UNKNOWN_FIELD", `"${key}" is not a writable Equipment field.`);
    }
  }

  const accountId = typeof data.accountId === "string" ? data.accountId.trim() : "";
  const locationId = typeof data.locationId === "string" ? data.locationId.trim() : "";
  if (!accountId || !locationId) {
    throw new EquipmentCommandError("MALFORMED", "An account and a location are required.");
  }
  if (!nameValid(data.name)) throw new EquipmentCommandError("INVALID", "Enter an equipment name.");
  if (!optionalFieldsValid(data)) throw new EquipmentCommandError("INVALID", "Check the highlighted fields.");

  // THE CROSS-DOCUMENT PROOF. Refused BEFORE any equipment is created.
  if (ctx.storedLocation === null) {
    throw new EquipmentCommandError("OWNERSHIP_UNPROVABLE", "That location could not be verified.");
  }
  if (ctx.storedLocation.accountId !== accountId) {
    throw new EquipmentCommandError("OWNERSHIP_INVALID", "That location does not belong to this customer.");
  }

  const built: Rec = {
    accountId,
    locationId,
    name: data.name,
    // ACTIVE ON CREATE, chosen not validated. The rule required `data.status == "ACTIVE"` precisely
    // so create could not be a side door into a non-ACTIVE state; choosing it here removes the
    // question of what happens when a caller sends something else.
    status: STATUS.ACTIVE,
    createdAt: ctx.nowMillis,
    updatedAt: ctx.nowMillis,
  };
  for (const f of OPTIONAL_STRING_FIELDS) {
    if (f in data) built[f] = data[f] ?? null;
  }
  return built;
}

// ════════════════════════════ UPDATE ════════════════════════════

export interface UpdateResult {
  /** The patch to apply. Only changed keys, plus the server's updatedAt. */
  readonly patch: Rec;
  /** The keys the caller actually changed, for the caller's own reporting. */
  readonly changed: readonly string[];
}

/**
 * Build the ordinary-edit patch from the STORED record, or throw.
 *
 * ============================ THE INVARIANT THIS FUNCTION EXISTS FOR ============================
 *
 * The retired rule was:
 *
 *   request.resource.data.diff(resource.data).affectedKeys().hasOnly(equipmentEditableKeys())
 *
 * That restricts the CHANGED KEYS. It does NOT say the stored document may contain only editable
 * keys, and the difference is not academic: a record may legitimately carry audit, lifecycle or
 * lineage fields stamped by a trusted writer, and requiring the resulting document to contain only
 * editable keys would make every such record permanently uneditable.
 *
 * So this NEVER reconstructs a document from a client schema, never requires the candidate's key
 * set to be a subset of anything, and never strips unknown fields. It computes:
 *
 *   stored record + bounded allowed patch = candidate
 *
 * and validates the changed-key set, the resulting values, and the transition.
 */
export function buildEquipmentUpdate(stored: Rec | null, input: Rec, ctx: { actorUid: string; nowMillis: number }): UpdateResult {
  if (stored === null) throw new EquipmentCommandError("NOT_FOUND", "No such equipment.");
  const data = input ?? {};

  // Which keys is the caller actually CHANGING? Compared against the stored record, so re-sending an
  // identical value is not a change -- exactly what `diff().affectedKeys()` produced.
  const changed: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    // updatedAt is the server's and is never a caller-driven change.
    if (key === "updatedAt") continue;
    if (!Object.is(stored[key] ?? null, value ?? null)) changed.push(key);
  }

  for (const key of changed) {
    if (!EQUIPMENT_EDITABLE_KEYS.includes(key)) {
      // Covers the governed fields (accountId, locationId) AND any attempt to add or alter a trusted
      // audit field -- both are simply keys absent from the editable list, which is how the rule
      // expressed it too.
      throw new EquipmentCommandError("FIELD_NOT_EDITABLE", `"${key}" cannot be changed here.`);
    }
  }

  if (changed.length === 0) throw new EquipmentCommandError("NOOP", "Nothing was changed.");

  // THE CANDIDATE: the stored record with the patch laid over it. Validated as a whole for VALUES --
  // the deliberate no-grandfathering rule -- while its KEY SET is left alone.
  const candidate: Rec = { ...stored };
  for (const key of changed) candidate[key] = data[key];

  if (!nameValid(candidate.name)) throw new EquipmentCommandError("INVALID", "Enter an equipment name.");
  if (!optionalFieldsValid(candidate)) throw new EquipmentCommandError("INVALID", "Check the highlighted fields.");

  // THE TRANSITION GUARD, against the STORED status. Without the status a record is moving FROM,
  // ACTIVE->INACTIVE and RETIRED->INACTIVE are the same request.
  if (!transitionAllowed(stored.status ?? null, candidate.status ?? null)) {
    // A refused status change is its own answer, distinct from an ordinary validation failure: the
    // status CAN change here, just not this way. Retire and reactivate are trusted lifecycle
    // actions and this command has no authority to perform either.
    throw new EquipmentCommandError(
      "STATUS_REFUSED",
      "Retiring or reactivating equipment isn't available here.",
    );
  }

  const patch: Rec = { updatedAt: ctx.nowMillis };
  for (const key of changed) patch[key] = data[key];
  return { patch, changed };
}

// ════════════════════════════ THE CALLABLES ════════════════════════════

async function requireCapability(uid: string, capabilityId: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capabilityId] });
    allowed = decisions[capabilityId] === true;
  } catch (err) {
    console.error(`[equipment] capability resolution failed for ${capabilityId}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", `You are not authorized: ${capabilityId}`);
}

function requireUid(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  return uid;
}

/**
 * Map to an HttpsError, preserving the DISTINCTIONS the surface already renders.
 *
 * EquipmentDetail tells a person four different things -- "check the highlighted fields", "customer
 * and location can't be changed here", "retiring isn't available here", "nothing was changed" --
 * and collapsing them into one denial would make the screen less honest than it is today. The
 * domain code travels in `details.code` so the client can keep saying the right one.
 */
function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof EquipmentCommandError) {
    switch (err.code) {
      case "FIELD_NOT_EDITABLE":
      case "STATUS_REFUSED":
      case "OWNERSHIP_INVALID":
        return new HttpsError("permission-denied", err.message, { code: err.code });
      case "NOT_FOUND":
      case "NOOP":
      case "OWNERSHIP_UNPROVABLE":
        return new HttpsError("failed-precondition", err.message, { code: err.code });
      default:
        return new HttpsError("invalid-argument", err.message, { code: err.code });
    }
  }
  return new HttpsError("internal", "The equipment could not be saved.");
}

const asRecord = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

export const createEquipmentRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  await requireCapability(actorUid, EQUIPMENT_CREATE);
  const db: Firestore = getFirestore();
  const values = asRecord(asRecord(request.data).values);
  try {
    // The SERVER reads the location. The browser's copy is not evidence.
    const locationId = typeof values.locationId === "string" ? values.locationId.trim() : "";
    const locSnap = locationId ? await db.collection(LOCATIONS).doc(locationId).get() : null;
    const built = buildEquipmentCreate(values, {
      actorUid,
      nowMillis: Date.now(),
      storedLocation: locSnap?.exists ? (locSnap.data() as Rec) : null,
    });
    const ref = db.collection(EQUIPMENT).doc();
    await ref.set(built);
    return { equipment: { ...built, id: ref.id } };
  } catch (err) {
    throw mapError(err);
  }
});

export const updateEquipmentRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  await requireCapability(actorUid, EQUIPMENT_UPDATE);
  const db: Firestore = getFirestore();
  const payload = asRecord(request.data);
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) throw new HttpsError("invalid-argument", "An equipment id is required.");
  try {
    // `before` may still arrive from the client for its own error handling. It is IGNORED as
    // authority: the server loads its own stored record, which is the only version that can be
    // trusted to say what the equipment currently is.
    const snap = await db.collection(EQUIPMENT).doc(id).get();
    const stored = snap.exists ? (snap.data() as Rec) : null;
    const { patch } = buildEquipmentUpdate(stored, asRecord(payload.values), { actorUid, nowMillis: Date.now() });
    await db.collection(EQUIPMENT).doc(id).update(patch);
    return { equipment: { ...(stored as Rec), ...patch, id } };
  } catch (err) {
    throw mapError(err);
  }
});
