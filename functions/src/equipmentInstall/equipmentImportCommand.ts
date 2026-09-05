// Equipment -- the TRUSTED create used by Data Import.
//
// The same situation as Customers, and the same obligation. Equipment is written
// client-direct under firestore.rules today; a trusted Function uses the Admin SDK, which
// evaluates no Rules, so every guarantee that block makes has to be made again HERE or
// import is a hole in it. The existing client writer is untouched.
//
// ============================ WHAT firestore.rules SAYS, RE-STATED ============================
//
//   * SHAPE. equipmentCreateShapeValid() requires accountId, locationId, name, status,
//     createdAt and updatedAt, and permits ONLY the keys on equipmentWritableKeys(). The
//     allow-list is the anti-injection guard -- any key nobody has thought of yet denies the
//     write -- so this command writes exactly that key set and refuses anything else.
//   * STATUS IS ACTIVE ON CREATE. Reaching RETIRED or INACTIVE is an audited lifecycle
//     transition (Spec sec5), and create must not be a side door into a non-ACTIVE state.
//     The contract hard-codes ACTIVE; this refuses anything else that reaches it.
//   * THE LOCATION BELONGS TO THE ACCOUNT. equipmentLocationBelongsToAccount() is a
//     referential rule, and it is re-checked here INSIDE the transaction, against stored
//     state -- not trusted from the resolution the caller did a moment ago.
//   * TIMESTAMPS ARE NUMBERS. Equipment governs createdAt/updatedAt as NUMBER (epoch
//     millis), unlike accounts, which govern Timestamp. Writing the wrong one would pass
//     every test that does not read it back and then sort wrongly forever.
//
// ============================ THE SERIAL UNIQUENESS RULE ============================
//
// Nothing in Rules or in the Equipment domain enforces a unique serial number. Import
// enforces it, inside the transaction, because import is the bulk path: a duplicate serial
// created by hand is one machine somebody can see and fix, and a duplicate serial created by
// a re-run is a register that quietly doubled.

import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import type { Role } from "../types/access.js";

export const EQUIPMENT_COLLECTION = "equipment";
export const LOCATIONS_COLLECTION = "locations";

/**
 * The authority to create Equipment, and the NEAREST EXISTING one rather than a perfect fit.
 *
 * `equipment.install` names creating an Equipment record for a customer, which is what this
 * does. It is not an exact match: its catalogued description is about installing a
 * company-held SERIALIZED ASSET and linking the two, and an imported machine has no such
 * asset behind it.
 *
 * REUSED ANYWAY, DELIBERATELY, because the alternative is worse. Inventing
 * `equipment.record.create` would put a new authority in the catalog to serve one import
 * path, and a capability that exists to make one caller work is how a permission model stops
 * meaning anything. Reusing this one WIDENS NOTHING: it is registered active:false, activated
 * only in the sandbox, and held by admin/owner and equipmentInstaller -- exactly the people
 * who could already create a machine. Whether Equipment deserves its own create capability is
 * a real question and a separate decision, and this comment is where it is recorded.
 */
export const CAP_EQUIPMENT_CREATE = "equipment.install";

/** The ONLY keys firestore.rules permits on an equipment create. */
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

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const AUDIT_COLLECTION = "auditEvents";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

export type EquipmentImportFailureCode =
  | "UNAUTHORIZED"
  | "INVALID"
  | "DUPLICATE_SERIAL"
  | "LOCATION_NOT_UNDER_CUSTOMER"
  | "UNKNOWN_KEY";

export class EquipmentImportError extends Error {
  constructor(
    readonly code: EquipmentImportFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "EquipmentImportError";
  }
}

export interface EquipmentImportInput {
  readonly actorUid: string;
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly locationId: string;
  /** Canonical draft MINUS the two name fields, which have already been resolved to ids. */
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface EquipmentImportOutcome {
  readonly outcome: "applied" | "replayed";
  readonly equipmentId: string;
}

export interface EquipmentImportDeps {
  db?: Firestore;
  now?: () => Date;
}

export async function createEquipmentFromImport(
  input: EquipmentImportInput,
  deps: EquipmentImportDeps = {},
): Promise<EquipmentImportOutcome> {
  const db = deps.db ?? getFirestore();
  const now = deps.now ?? (() => new Date());

  const serialNumber = String(input.fields.serialNumber ?? "").trim();
  if (!serialNumber) throw new EquipmentImportError("INVALID", "A serial number is required.");
  if (!String(input.fields.name ?? "").trim()) throw new EquipmentImportError("INVALID", "An equipment name is required.");
  if (input.fields.status !== undefined && input.fields.status !== "ACTIVE") {
    throw new EquipmentImportError("INVALID", "Equipment is always created ACTIVE.");
  }
  for (const key of Object.keys(input.fields)) {
    if (!EQUIPMENT_WRITABLE_KEYS.includes(key)) {
      // The Rules allow-list, re-stated. Refusing an unexpected key is the whole point of an
      // allow-list: it fails closed for fields nobody has thought of yet.
      throw new EquipmentImportError("UNKNOWN_KEY", `"${key}" is not a writable equipment field.`);
    }
  }

  await assertCapability(db, input.actorUid);

  const auditId = `dataImport_createEquipment_${input.idempotencyKey}`;
  const serialKey = serialNumber.toUpperCase().replace(/\s+/g, "");

  return db.runTransaction(async (txn) => {
    const auditRef = db.collection(AUDIT_COLLECTION).doc(auditId);
    if ((await txn.get(auditRef)).exists) {
      return { outcome: "replayed" as const, equipmentId: `replayed:${input.idempotencyKey}` };
    }

    // REFERENTIAL INTEGRITY, RE-CHECKED AGAINST STORED STATE. The caller resolved these
    // names to ids before the preview; this reads the location back inside the transaction,
    // because the answer could have changed and because a caller's claim about ownership is
    // not evidence of it.
    const locSnap = await txn.get(db.collection(LOCATIONS_COLLECTION).doc(input.locationId));
    if (!locSnap.exists || String((locSnap.data() ?? {}).accountId ?? "") !== input.accountId) {
      throw new EquipmentImportError(
        "LOCATION_NOT_UNDER_CUSTOMER",
        "That location does not belong to that customer.",
      );
    }

    // SERIAL UNIQUENESS, inside the transaction, and TWO queries rather than one.
    //
    // A query and not an id check, because equipment ids are not derived from the serial:
    // machines created through the interface carry auto-ids, and checking only a derived id
    // would compare imports against imports.
    //
    // TWO because `serialNumberKey` is new. Every machine this command writes carries the
    // normalized key, but machines created before it exists carry only the raw serial -- so
    // a key-only check would happily re-register a machine somebody added last year. The
    // second query is exact-match on the raw field, which catches those.
    //
    // THE HONEST LIMIT OF THE SECOND ONE: it matches the serial as written, so a legacy
    // machine recorded as "AB 12345" is not found by a file saying "AB12345". That gap is
    // closed a layer up -- the preview loader normalizes every existing serial in memory and
    // reports the clash before anyone approves anything. This check is the backstop against a
    // race, not the primary duplicate detector, and it is deliberately the cheaper of the two.
    for (const query of [
      db.collection(EQUIPMENT_COLLECTION).where("serialNumberKey", "==", serialKey).limit(1),
      db.collection(EQUIPMENT_COLLECTION).where("serialNumber", "==", serialNumber).limit(1),
    ]) {
      if (!(await txn.get(query)).empty) {
        throw new EquipmentImportError("DUPLICATE_SERIAL", `Serial number "${serialNumber}" is already registered.`);
      }
    }

    const at = now().getTime();
    const ref = db.collection(EQUIPMENT_COLLECTION).doc();

    txn.set(ref, {
      ...stripUndefined(input.fields),
      accountId: input.accountId,
      locationId: input.locationId,
      status: "ACTIVE",
      // The derived comparison key the uniqueness check queries. Derived by the WRITER for
      // the same reason `nameLower` is: a caller cannot forget what it never had to remember,
      // and a machine missing this key would be invisible to every future duplicate check.
      serialNumberKey: serialKey,
      // NUMBERS, not Timestamps. Equipment governs these as NUMBER; the wrong type passes
      // every test that does not read it back, and then sorts wrongly forever.
      createdAt: at,
      updatedAt: at,
    });

    txn.set(auditRef, {
      action: "createEquipmentFromImport",
      actorUid: input.actorUid,
      targetType: "equipment",
      targetId: ref.id,
      at,
      summary: `Equipment "${String(input.fields.name)}" (serial ${serialNumber}) created by Data Import (${input.idempotencyKey}).`,
    });

    return { outcome: "applied" as const, equipmentId: ref.id };
  });
}

async function assertCapability(db: Firestore, actorUid: string): Promise<void> {
  if (typeof actorUid !== "string" || actorUid.trim() === "") {
    throw new EquipmentImportError("UNAUTHORIZED", "An actor is required.");
  }
  const userSnap = await db.collection(USERS_COLLECTION).doc(actorUid).get();
  const assignments = await db
    .collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("principalUid", "==", actorUid)
    .where("status", "==", "active")
    .get();

  const result = resolveEffectivePermission({
    permissionId: CAP_EQUIPMENT_CREATE,
    assignments: assignments.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
    roles: ROLE_CATALOG,
    currentAccessVersion: Number((userSnap.data() ?? {}).accessVersion ?? 0),
    target: GLOBAL_TARGET,
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });

  if (result.decision !== "ALLOW") {
    throw new EquipmentImportError("UNAUTHORIZED", "You are not authorized to create equipment.");
  }
}

function stripUndefined(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out;
}
