// INSTALLATION — the moment a company-held unit becomes a customer's equipment.
//
// ============================ THE GAP THIS CLOSES ============================
//
// The Serialized Asset contract names it directly: "`currentEquipmentId` is explicitly null: a
// received unit is in inventory, not installed -- the install link is §H's job and §H is not built."
//
// So INSTALLED existed in the lifecycle vocabulary and nothing could reach it. Three writers touch
// serialized assets -- receipt, put-away, transfer -- and every one of them moves a unit around
// INSIDE the company. None of them hands anything to a customer.
//
// ============================ WHY EQUIPMENT IS CREATED HERE, NOT EARLIER ============================
//
// An `equipment/{id}` document REQUIRES accountId and locationId at creation, and Rules deny changing
// either one afterwards. That is not an obstacle to work around -- it is the model. A customer's
// equipment record is a statement about whose machine this is and where it sits, and the domain has
// decided that statement is not editable.
//
// The consequence is that a pre-customer Equipment record cannot exist, which is exactly what the
// Serialized Asset contract lists as SUPERSEDED and deliberately not reintroduced. Before
// installation the unit's identity lives in `serialized_assets`; installation is what mints the
// Equipment record.
//
// SO IDENTITY IS NOT "PRESERVED" ACROSS INSTALLATION IN THE WAY A CALLER MIGHT EXPECT. The serialized
// asset id and its serial persist unchanged; the Equipment id is NEW, because before this moment
// there was no Equipment. What is preserved is the SERIAL -- and the link, in both directions.
//
// ============================ IRREVERSIBLE, AND SAID OUT LOUD ============================
//
// There is no recovery command. Once installed, this unit cannot be un-installed, reassigned to
// another customer, or returned to internal custody by any governed path, because accountId is
// immutable and nothing clears currentEquipmentId. The double-install refusal below is therefore not
// merely a duplicate guard -- it is the only thing standing between a mistake and a permanent one.
import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { SERIALIZED_ASSETS_COLLECTION } from "../constants/collections.js";
import { projectSerializedAsset } from "../serializedAsset/serializedAssetReadService.js";
import type { SerializedAssetState } from "../serializedAsset/types.js";

export const EQUIPMENT_COLLECTION = "equipment";
export const ACCOUNTS_COLLECTION = "accounts";
export const LOCATIONS_COLLECTION = "locations";

/** The capability this command requires. Declared active:false; granted to no Role by default. */
export const EQUIPMENT_INSTALL_CAPABILITY = "equipment.install";

/**
 * Lifecycle states from which a unit may be installed.
 *
 * A SUBSET, and deliberately not "anything that is not INSTALLED". The states below are the ones
 * where the unit is in settled company custody and available to hand over:
 *
 *   AVAILABLE   on the shelf, unreserved
 *   RESERVED    set aside, presumably for this very job
 *   STAGED      picked and waiting to go out
 *   DELIVERED   physically at the customer, not yet linked
 *
 * The excluded ones are excluded for a reason, not by oversight:
 *
 *   RECEIVED    arrived at the dock and not yet put away -- installing it would skip custody
 *   LOADED      on a van as cargo
 *   IN_TRANSIT  mid-transfer; a transfer's own commit would race this one
 *   INSTALLED   already somebody's
 */
export const INSTALLABLE_STATES: readonly SerializedAssetState[] =
  Object.freeze(["AVAILABLE", "RESERVED", "STAGED", "DELIVERED"]);

export const INSTALLED_STATE: SerializedAssetState = "INSTALLED";

export type InstallFailureCode =
  | "PERMISSION_DENIED"
  | "ASSET_NOT_FOUND"
  | "ASSET_MALFORMED"
  | "ALREADY_INSTALLED"
  | "STATE_NOT_INSTALLABLE"
  | "ACCOUNT_NOT_FOUND"
  | "LOCATION_NOT_FOUND"
  | "LOCATION_NOT_OF_ACCOUNT"
  | "REQUEST_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "INSTALL_INTEGRITY";

export class InstallCommandError extends Error {
  readonly code: InstallFailureCode;
  constructor(code: InstallFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = "InstallCommandError";
  }
}

export interface InstallActor { readonly kind: "USER" | "SYSTEM"; readonly id: string; }

/**
 * Where an installation came from, when it came from somewhere.
 *
 * OPTIONAL, and deliberately not a second audit event. A technician installing at Work Order
 * closeout and a manager installing from the Equipment surface are the SAME act through the same
 * authority; writing two independent events would make "how many machines were installed" a question
 * with two answers.
 *
 * The actor already distinguishes the two paths -- a technician's uid or a manager's. This adds the
 * one thing the actor cannot carry: WHICH Work Order the installation discharged.
 */
export interface InstallSourceContext {
  readonly kind: "WORK_ORDER";
  readonly workOrderId: string;
}

export interface InstallAuditInput {
  readonly actorId: string;
  readonly sourceContext?: InstallSourceContext;
  readonly serializedAssetId: string;
  readonly equipmentId: string;
  readonly accountId: string;
  readonly locationId: string;
  readonly serialNo: string;
  readonly priorLocationId: string;
  readonly priorState: string;
}

export interface InstallCommandDeps {
  readonly db: Firestore;
  /** Set only by a trusted server-side caller that established the origin itself. */
  readonly sourceContext?: InstallSourceContext;
  readonly actor: InstallActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: InstallAuditInput) => void;
  readonly now: () => Date;
}

export interface InstallOutcome {
  readonly outcome: "installed" | "replayed";
  readonly serializedAssetId: string;
  readonly equipmentId: string;
  readonly serialNo: string;
  readonly accountId: string;
  readonly locationId: string;
  readonly state: SerializedAssetState;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** The keys a caller may send. Anything else denies the whole request. */
const ALLOWED_KEYS = new Set([
  "serializedAssetId", "accountId", "locationId", "name",
  "installedDate", "assetTag", "notes", "idempotencyKey",
]);

// Source context is NOT a request field. It is supplied by the trusted caller that already knows the
// origin -- the Work Order closeout command, which read the Work Order server-side. Accepting it from
// a client payload would let any caller stamp an installation with a Work Order it never touched.

export interface ValidatedInstallRequest {
  readonly serializedAssetId: string;
  readonly accountId: string;
  readonly locationId: string;
  readonly name: string;
  readonly idempotencyKey: string;
  readonly installedDate?: string;
  readonly assetTag?: string;
  readonly notes?: string;
}

export function validateInstallRequest(input: unknown): ValidatedInstallRequest {
  if (!isPlainObject(input)) throw new InstallCommandError("REQUEST_INVALID", "request is not an object");
  for (const k of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(k)) throw new InstallCommandError("REQUEST_INVALID", `unknown field ${k}`);
  }
  const serializedAssetId = str(input.serializedAssetId);
  const accountId = str(input.accountId);
  const locationId = str(input.locationId);
  const name = str(input.name);
  const idempotencyKey = str(input.idempotencyKey);
  if (!serializedAssetId) throw new InstallCommandError("REQUEST_INVALID", "serializedAssetId required");
  if (!accountId) throw new InstallCommandError("REQUEST_INVALID", "accountId required");
  if (!locationId) throw new InstallCommandError("REQUEST_INVALID", "locationId required");
  // `name` is the human reference in the Equipment register and Rules require it. A caller that does
  // not supply one is not helped by a generated placeholder nobody chose.
  if (!name) throw new InstallCommandError("REQUEST_INVALID", "name required");
  if (!idempotencyKey) throw new InstallCommandError("REQUEST_INVALID", "idempotencyKey required");

  const optional = (k: "installedDate" | "assetTag" | "notes") => {
    const v = input[k];
    if (v === undefined) return undefined;
    const s = str(v);
    if (!s) throw new InstallCommandError("REQUEST_INVALID", `${k} must be a non-empty string when present`);
    return s;
  };
  return {
    serializedAssetId, accountId, locationId, name, idempotencyKey,
    installedDate: optional("installedDate"),
    assetTag: optional("assetTag"),
    notes: optional("notes"),
  };
}

/**
 * The Equipment document id, DERIVED from the request identity.
 *
 * Derived rather than allocated for the same reason the receiving and transfer commands derive
 * theirs: `create` on a derived id IS the idempotency check. Firestore rejects a create on an
 * existing document, inside the transaction, with no separate existence race.
 */
export function equipmentDocIdFor(idempotencyKey: string): string {
  return "eq_" + createHash("sha256").update(JSON.stringify(["equipmentInstall", idempotencyKey]))
    .digest("hex").slice(0, 40);
}

/** What the stored request meant, so a replay can be told from a conflicting reuse of the key. */
export function installFingerprint(req: ValidatedInstallRequest): string {
  return createHash("sha256").update(JSON.stringify([
    req.serializedAssetId, req.accountId, req.locationId, req.name,
    req.installedDate ?? null, req.assetTag ?? null,
  ])).digest("hex").slice(0, 16);
}

/**
 * Install one serialized asset as customer Equipment.
 *
 * ONE TRANSACTION. Creating the Equipment record and linking the asset are two writes describing one
 * fact, and a world where either happened without the other is worse than a world where neither did:
 * an Equipment record nothing points at is a customer machine with no unit behind it, and an asset
 * marked INSTALLED with no Equipment is a unit that has left inventory and arrived nowhere.
 */
export async function installSerializedAsset(request: unknown, deps: InstallCommandDeps): Promise<InstallOutcome> {
  const actor = deps.actor;
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
    throw new InstallCommandError("PERMISSION_DENIED", "trusted actor context missing");
  }
  const req = validateInstallRequest(request);
  const equipmentId = equipmentDocIdFor(req.idempotencyKey);
  const fingerprint = installFingerprint(req);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    const writes: Array<{ op: "create" | "update"; ref: DocumentReference; data: Record<string, unknown> }> = [];

    // ---- 1. AUTHORIZATION, read through the transaction so a concurrent revocation conflicts.
    if (!(await deps.authorize(txn, actor.id, EQUIPMENT_INSTALL_CAPABILITY))) {
      throw new InstallCommandError("PERMISSION_DENIED", "actor is not authorized to install equipment");
    }

    // ---- 2. IDEMPOTENCY. A prior Equipment at this derived id means this exact request already ran.
    const equipmentRef = deps.db.collection(EQUIPMENT_COLLECTION).doc(equipmentId);
    const existing = await txn.get(equipmentRef);
    if (existing.exists) {
      const stored = existing.data() ?? {};
      if (stored.installFingerprint !== fingerprint) {
        throw new InstallCommandError("IDEMPOTENCY_CONFLICT",
          "idempotencyKey was already used for a different installation");
      }
      return {
        outcome: "replayed" as const,
        serializedAssetId: req.serializedAssetId,
        equipmentId,
        serialNo: String(stored.serialNumber ?? ""),
        accountId: String(stored.accountId ?? ""),
        locationId: String(stored.locationId ?? ""),
        state: INSTALLED_STATE,
      };
    }

    // ---- 3. THE ASSET.
    const assetRef = deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(req.serializedAssetId);
    const assetSnap = await txn.get(assetRef);
    if (!assetSnap.exists) throw new InstallCommandError("ASSET_NOT_FOUND", "serialized asset not found");
    // THE PRODUCT'S OWN PROJECTION, not a second reader. A stored asset carries provenance fields
    // (schemaVersion, createdAtMillis, activatedByReceivingId, ...) that the VALUE validator's strict
    // allow-list rejects; projectSerializedAsset plucks the governed value subset first and returns
    // null for anything malformed, unknown-stated, or carrying a contradictory INSTALLED/link pairing.
    // Validating the raw document here would have refused every genuine asset in existence.
    const asset = projectSerializedAsset(req.serializedAssetId, assetSnap.data());
    if (asset === null) {
      throw new InstallCommandError("ASSET_MALFORMED", "stored serialized asset is malformed or foreign");
    }

    // ALREADY INSTALLED is checked on the LINK, not on the state. The two are kept in step by the
    // asset contract, and the link is the fact that matters: a unit pointing at an Equipment record
    // belongs to somebody, whatever its state field says.
    if (asset.currentEquipmentId !== null) {
      throw new InstallCommandError("ALREADY_INSTALLED",
        `serialized asset is already installed as equipment ${asset.currentEquipmentId}`);
    }
    if (!INSTALLABLE_STATES.includes(asset.inventoryState)) {
      throw new InstallCommandError("STATE_NOT_INSTALLABLE",
        `serialized asset is ${asset.inventoryState}; installable states are ${INSTALLABLE_STATES.join("/")}`);
    }

    // ---- 4. THE CUSTOMER AND THE PLACE.
    const accountSnap = await txn.get(deps.db.collection(ACCOUNTS_COLLECTION).doc(req.accountId));
    if (!accountSnap.exists) throw new InstallCommandError("ACCOUNT_NOT_FOUND", "customer not found");
    const locationSnap = await txn.get(deps.db.collection(LOCATIONS_COLLECTION).doc(req.locationId));
    if (!locationSnap.exists) throw new InstallCommandError("LOCATION_NOT_FOUND", "customer location not found");

    // THE SAME INTEGRITY RULES ENFORCE, checked here because this command bypasses Rules entirely.
    // `equipmentLocationBelongsToAccount` is the client-path guard; a trusted writer that skipped the
    // equivalent check would be the one hole in it.
    const locationAccount = (locationSnap.data() ?? {}).accountId;
    if (locationAccount !== req.accountId) {
      throw new InstallCommandError("LOCATION_NOT_OF_ACCOUNT",
        `location ${req.locationId} belongs to ${String(locationAccount)}, not ${req.accountId}`);
    }

    // ---- 5. THE TWO WRITES THAT ARE ONE FACT.
    writes.push({
      op: "create",
      ref: equipmentRef,
      data: {
        accountId: req.accountId,
        locationId: req.locationId,
        name: req.name,
        status: "ACTIVE",
        serialNumber: asset.serialNo,
        ...(req.assetTag === undefined ? {} : { assetTag: req.assetTag }),
        ...(req.installedDate === undefined ? {} : { installedDate: req.installedDate }),
        ...(req.notes === undefined ? {} : { notes: req.notes }),
        // THE LINK BACK. Equipment carried no reference to the unit behind it; without this the
        // relationship would be navigable in one direction only, and a serial would be the only
        // thread connecting a customer's machine to the asset it came from.
        serializedAssetId: req.serializedAssetId,
        partId: asset.partId,
        installFingerprint: fingerprint,
        installedFromLocationId: asset.currentLocationId,
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
        createdBy: actor.id,
        updatedBy: actor.id,
      },
    });
    writes.push({
      op: "update",
      ref: assetRef,
      data: {
        inventoryState: INSTALLED_STATE,
        currentEquipmentId: equipmentId,
        updatedAtMillis: now.getTime(),
        updatedByUid: actor.id,
      },
    });

    deps.stageAudit(txn, {
      actorId: actor.id,
      serializedAssetId: req.serializedAssetId,
      equipmentId,
      accountId: req.accountId,
      locationId: req.locationId,
      serialNo: asset.serialNo,
      priorLocationId: asset.currentLocationId,
      priorState: asset.inventoryState,
      ...(deps.sourceContext ? { sourceContext: deps.sourceContext } : {}),
    });

    for (const w of writes) {
      if (w.op === "create") txn.create(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }

    return {
      outcome: "installed" as const,
      serializedAssetId: req.serializedAssetId,
      equipmentId,
      serialNo: asset.serialNo,
      accountId: req.accountId,
      locationId: req.locationId,
      state: INSTALLED_STATE,
    };
  });
}
