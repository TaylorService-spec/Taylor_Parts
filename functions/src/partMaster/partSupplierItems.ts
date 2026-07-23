// INV-1 Phase 1, PR 1.4 -- part_supplier_items: the normalized PROCUREMENT
// authority for supplier-specific Part data (ADR-008 Accepted / Decision
// #40; spec sec3). Supplier cost/terms live HERE, never on the Part core;
// a Part supports many supplier items; changing suppliers never changes
// canonical partId. Trusted-service only, client-closed, tenant-inert,
// no physical delete. Reuses PR 1.2's capability/idempotency/versioning/
// audit/transaction machinery -- nothing reimplemented.
//
// DOC IDENTITY: deterministic `<partId>__<supplierId>` (both IDs conform to
// the internal ID pattern [A-Za-z0-9_-]{1,64} -- storage-safe by
// construction; tenant-prefixable under Issue #140). Duplicate supplier-item
// identity is a create-collision conflict, never a silent overwrite.
//
// PREFERRED SUPPLIER: at most one ACTIVE preferred item per part, enforced
// by setPreferredSupplier inside one transaction (equality-only query --
// no composite index required) that clears the prior preferred item and
// sets the new one atomically, both audited under one action.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { stageAuditEventWithId } from "../access/auditEventWriter";
import type { ManufacturerId, PartId, Result, SupplierItemId, UnitCode, ValidationIssue, ConversionFactor } from "./types";
import { parsePartId } from "./validation";
import { isUnitCode, parseQuantity, validateConversionFactor } from "./units";
import { INITIAL_VERSION, MalformedStoredRecordError, buildFirestorePartRepository, type StoredMeta } from "./partMasterRepository";
import {
  AlreadyExistsError,
  CAP_CATALOG_ACTIVATE,
  CAP_CATALOG_MANAGE,
  InvalidInputError,
  NotFoundError,
  VersionConflictError,
  type MutationOutcome,
  type PartMasterDeps,
  __pm_internal_assertActorUid,
  __pm_internal_assertIdempotencyKey,
  __pm_internal_auditDocId,
  __pm_internal_checkIdempotency,
  __pm_internal_fingerprint,
  __pm_internal_requireCapabilityOrAudit,
  __pm_internal_resolveDeps,
} from "./partMasterCommands";

export const PART_SUPPLIER_ITEMS_COLLECTION = "part_supplier_items";

export const SUPPLIER_ITEM_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type SupplierItemStatus = (typeof SUPPLIER_ITEM_STATUSES)[number];
export const AVAILABILITY_STATES = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/; // procurement decimals as strings -- never floats
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function buildSupplierItemId(partId: PartId, supplierId: string): SupplierItemId {
  return `${partId}__${supplierId}` as SupplierItemId;
}

export interface StoredPartSupplierItem extends StoredMeta {
  readonly itemId: SupplierItemId;
  readonly partId: PartId;
  readonly supplierId: string;
  readonly supplierSku: string;
  readonly cost: string; // decimal string
  readonly currency: string; // ISO-4217 style, 3 uppercase letters
  readonly leadTimeDays: number;
  readonly minOrderQty?: string;
  readonly orderMultiple?: string;
  readonly purchaseUnit?: UnitCode;
  readonly conversionToStockingUnit?: ConversionFactor;
  readonly contractStart?: string;
  readonly contractEnd?: string;
  readonly availability: AvailabilityState;
  readonly preferred: boolean;
  readonly lastVerifiedAt?: Date;
  readonly status: SupplierItemStatus;
}

function issue(path: string, code: ValidationIssue["code"], message: string): ValidationIssue {
  return { code, path, message };
}

// Pure field validation shared by create/update (terms allowlist).
export interface SupplierItemTermsInput {
  readonly supplierSku?: unknown;
  readonly cost?: unknown;
  readonly currency?: unknown;
  readonly leadTimeDays?: unknown;
  readonly minOrderQty?: unknown;
  readonly orderMultiple?: unknown;
  readonly purchaseUnit?: unknown;
  readonly conversionToStockingUnit?: unknown;
  readonly contractStart?: unknown;
  readonly contractEnd?: unknown;
  readonly availability?: unknown;
  readonly lastVerifiedAt?: unknown;
}
const TERM_KEYS = new Set(["supplierSku", "cost", "currency", "leadTimeDays", "minOrderQty", "orderMultiple", "purchaseUnit", "conversionToStockingUnit", "contractStart", "contractEnd", "availability", "lastVerifiedAt"]);

export function validateSupplierItemTerms(input: SupplierItemTermsInput, requireCore: boolean): Result<Partial<StoredPartSupplierItem>> {
  const errors: ValidationIssue[] = [];
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input)) {
    if (!TERM_KEYS.has(k)) errors.push(issue(k, "CONFLICTING_FIELDS", `field "${k}" is not a supplier-item term`));
  }
  const need = (k: string, present: boolean) => {
    if (requireCore && !present) errors.push(issue(k, "REQUIRED", `${k} is required`));
  };
  if (input.supplierSku !== undefined) {
    if (typeof input.supplierSku !== "string" || input.supplierSku.trim().length === 0 || input.supplierSku.length > 120) {
      errors.push(issue("supplierSku", "INVALID_FORMAT", "supplierSku must be a non-empty string (max 120)"));
    } else out.supplierSku = input.supplierSku.trim();
  } else need("supplierSku", false);
  if (input.cost !== undefined) {
    if (typeof input.cost !== "string" || !DECIMAL_PATTERN.test(input.cost)) {
      errors.push(issue("cost", "INVALID_FORMAT", "cost must be a decimal string (max 4 dp)"));
    } else out.cost = input.cost;
  } else need("cost", false);
  if (input.currency !== undefined) {
    if (typeof input.currency !== "string" || !CURRENCY_PATTERN.test(input.currency)) {
      errors.push(issue("currency", "INVALID_FORMAT", "currency must be 3 uppercase letters"));
    } else out.currency = input.currency;
  } else need("currency", false);
  if (input.leadTimeDays !== undefined) {
    if (!Number.isInteger(input.leadTimeDays) || (input.leadTimeDays as number) < 0 || (input.leadTimeDays as number) > 3650) {
      errors.push(issue("leadTimeDays", "OUT_OF_RANGE", "leadTimeDays must be an integer 0..3650"));
    } else out.leadTimeDays = input.leadTimeDays;
  } else need("leadTimeDays", false);
  for (const k of ["minOrderQty", "orderMultiple"] as const) {
    const v = input[k];
    if (v !== undefined) {
      if (typeof v !== "string" || !DECIMAL_PATTERN.test(v) || Number(v) <= 0) {
        errors.push(issue(k, "INVALID_FORMAT", `${k} must be a positive decimal string`));
      } else out[k] = v;
    }
  }
  if (input.purchaseUnit !== undefined || input.conversionToStockingUnit !== undefined) {
    if (!isUnitCode(input.purchaseUnit)) {
      errors.push(issue("purchaseUnit", "INVALID_ENUM", "purchaseUnit must be a known unit code"));
    } else if (input.conversionToStockingUnit === undefined || input.conversionToStockingUnit === null || typeof input.conversionToStockingUnit !== "object") {
      errors.push(issue("conversionToStockingUnit", "REQUIRED", "purchaseUnit requires conversionToStockingUnit"));
    } else {
      const f = validateConversionFactor(input.conversionToStockingUnit as ConversionFactor);
      if (!f.valid) errors.push(...f.errors.map((e) => ({ ...e, path: "conversionToStockingUnit" })));
      else {
        out.purchaseUnit = input.purchaseUnit;
        out.conversionToStockingUnit = f.value;
        // sanity: a purchase-unit quantity of "1" must convert cleanly enough to parse
        const probe = parseQuantity(input.purchaseUnit, "1");
        if (!probe.valid) errors.push(...probe.errors);
      }
    }
  }
  for (const k of ["contractStart", "contractEnd"] as const) {
    const v = input[k];
    if (v !== undefined) {
      if (typeof v !== "string" || !ISO_DATE_PATTERN.test(v)) errors.push(issue(k, "INVALID_FORMAT", `${k} must be YYYY-MM-DD`));
      else out[k] = v;
    }
  }
  if (typeof out.contractStart === "string" && typeof out.contractEnd === "string" && out.contractStart > out.contractEnd) {
    errors.push(issue("contractEnd", "INVALID_DATE_RANGE", "contractEnd must not precede contractStart"));
  }
  if (input.availability !== undefined) {
    if (!(AVAILABILITY_STATES as readonly string[]).includes(input.availability as string)) {
      errors.push(issue("availability", "INVALID_ENUM", `availability must be ${AVAILABILITY_STATES.join("/")}`));
    } else out.availability = input.availability;
  }
  if (input.lastVerifiedAt !== undefined) {
    if (!(input.lastVerifiedAt instanceof Date)) errors.push(issue("lastVerifiedAt", "INVALID_FORMAT", "lastVerifiedAt must be a Date"));
    else out.lastVerifiedAt = input.lastVerifiedAt;
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: out as Partial<StoredPartSupplierItem> };
}

// ---------------------------------------------------------------------------
// Serialization (strict; same conventions as the other partMaster adapters)
// ---------------------------------------------------------------------------
export function supplierItemToFirestore(s: StoredPartSupplierItem): Record<string, unknown> {
  return {
    itemId: s.itemId,
    partId: s.partId,
    supplierId: s.supplierId,
    supplierSku: s.supplierSku,
    cost: s.cost,
    currency: s.currency,
    leadTimeDays: s.leadTimeDays,
    ...(s.minOrderQty !== undefined ? { minOrderQty: s.minOrderQty } : {}),
    ...(s.orderMultiple !== undefined ? { orderMultiple: s.orderMultiple } : {}),
    ...(s.purchaseUnit !== undefined ? { purchaseUnit: s.purchaseUnit } : {}),
    ...(s.conversionToStockingUnit !== undefined ? { conversionToStockingUnit: { ...s.conversionToStockingUnit } } : {}),
    ...(s.contractStart !== undefined ? { contractStart: s.contractStart } : {}),
    ...(s.contractEnd !== undefined ? { contractEnd: s.contractEnd } : {}),
    availability: s.availability,
    preferred: s.preferred,
    ...(s.lastVerifiedAt !== undefined ? { lastVerifiedAt: Timestamp.fromDate(s.lastVerifiedAt) } : {}),
    status: s.status,
    version: s.version,
    createdAt: Timestamp.fromDate(s.createdAt),
    createdBy: s.createdBy,
    updatedAt: Timestamp.fromDate(s.updatedAt),
    updatedBy: s.updatedBy,
  };
}

export function supplierItemFromFirestore(docId: string, data: Record<string, unknown> | undefined): StoredPartSupplierItem {
  if (data === undefined) throw new MalformedStoredRecordError(`supplier item ${docId} has no data`);
  if (data.itemId !== docId) throw new MalformedStoredRecordError(`supplier item ${docId} carries mismatched itemId`);
  const partId = parsePartId(data.partId);
  if (!partId.valid) throw new MalformedStoredRecordError(`supplier item ${docId} has malformed partId`);
  if (typeof data.supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(data.supplierId)) {
    throw new MalformedStoredRecordError(`supplier item ${docId} has malformed supplierId`);
  }
  if (buildSupplierItemId(partId.value, data.supplierId) !== docId) {
    throw new MalformedStoredRecordError(`supplier item ${docId} id/identity integrity failure`);
  }
  const terms = validateSupplierItemTerms(
    {
      supplierSku: data.supplierSku, cost: data.cost, currency: data.currency, leadTimeDays: data.leadTimeDays,
      minOrderQty: data.minOrderQty, orderMultiple: data.orderMultiple,
      ...(data.purchaseUnit !== undefined ? { purchaseUnit: data.purchaseUnit, conversionToStockingUnit: data.conversionToStockingUnit } : {}),
      contractStart: data.contractStart, contractEnd: data.contractEnd, availability: data.availability,
      ...(data.lastVerifiedAt instanceof Timestamp ? { lastVerifiedAt: data.lastVerifiedAt.toDate() } : {}),
    },
    false
  );
  if (!terms.valid || typeof data.supplierSku !== "string" || typeof data.cost !== "string" || typeof data.currency !== "string" || typeof data.leadTimeDays !== "number") {
    throw new MalformedStoredRecordError(`supplier item ${docId} failed term validation`);
  }
  if (typeof data.status !== "string" || !(SUPPLIER_ITEM_STATUSES as readonly string[]).includes(data.status)) {
    throw new MalformedStoredRecordError(`supplier item ${docId} has invalid status`);
  }
  if (typeof data.preferred !== "boolean") throw new MalformedStoredRecordError(`supplier item ${docId} has invalid preferred flag`);
  const { version, createdAt, createdBy, updatedAt, updatedBy } = data;
  if (
    typeof version !== "number" || !Number.isInteger(version) || version < INITIAL_VERSION ||
    !(createdAt instanceof Timestamp) || !(updatedAt instanceof Timestamp) ||
    typeof createdBy !== "string" || typeof updatedBy !== "string"
  ) {
    throw new MalformedStoredRecordError(`supplier item ${docId} has malformed version/audit metadata`);
  }
  return {
    itemId: docId as SupplierItemId,
    partId: partId.value,
    supplierId: data.supplierId,
    supplierSku: data.supplierSku,
    cost: data.cost,
    currency: data.currency,
    leadTimeDays: data.leadTimeDays,
    ...(terms.value.minOrderQty !== undefined ? { minOrderQty: terms.value.minOrderQty } : {}),
    ...(terms.value.orderMultiple !== undefined ? { orderMultiple: terms.value.orderMultiple } : {}),
    ...(terms.value.purchaseUnit !== undefined ? { purchaseUnit: terms.value.purchaseUnit, conversionToStockingUnit: terms.value.conversionToStockingUnit } : {}),
    ...(terms.value.contractStart !== undefined ? { contractStart: terms.value.contractStart } : {}),
    ...(terms.value.contractEnd !== undefined ? { contractEnd: terms.value.contractEnd } : {}),
    availability: (data.availability as AvailabilityState) ?? "UNKNOWN",
    preferred: data.preferred,
    ...(data.lastVerifiedAt instanceof Timestamp ? { lastVerifiedAt: data.lastVerifiedAt.toDate() } : {}),
    status: data.status as SupplierItemStatus,
    version,
    createdAt: createdAt.toDate(),
    createdBy,
    updatedAt: updatedAt.toDate(),
    updatedBy,
  };
}

function ref(db: Firestore, itemId: SupplierItemId) {
  return db.collection(PART_SUPPLIER_ITEMS_COLLECTION).doc(itemId);
}
async function getItem(db: Firestore, txn: Transaction, itemId: SupplierItemId): Promise<StoredPartSupplierItem | null> {
  const snap = await txn.get(ref(db, itemId));
  return snap.exists ? supplierItemFromFirestore(snap.id, snap.data()) : null;
}

// ---------------------------------------------------------------------------
// Trusted commands
// ---------------------------------------------------------------------------
export interface CreatePartSupplierItemInput extends SupplierItemTermsInput {
  actorUid: string;
  idempotencyKey: string;
  partId: string;
  supplierId: string;
}

export async function createPartSupplierItem(input: CreatePartSupplierItemInput, deps?: PartMasterDeps): Promise<MutationOutcome & { itemId: SupplierItemId }> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  const partId = parsePartId(input.partId);
  if (!partId.valid) throw new InvalidInputError("invalid partId");
  if (typeof input.supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(input.supplierId)) {
    throw new InvalidInputError("supplierId must match [A-Za-z0-9_-]{1,64}");
  }
  const { actorUid, idempotencyKey, partId: _p, supplierId, ...terms } = input;
  const validated = validateSupplierItemTerms(terms, true);
  if (!validated.valid || validated.value.supplierSku === undefined || validated.value.cost === undefined || validated.value.currency === undefined || validated.value.leadTimeDays === undefined) {
    const msgs = validated.valid ? "supplierSku/cost/currency/leadTimeDays are required" : validated.errors.map((e) => `${e.path}:${e.code}`).join(",");
    throw new InvalidInputError(`invalid supplier item: ${msgs}`);
  }
  const itemId = buildSupplierItemId(partId.value, supplierId);
  await __pm_internal_requireCapabilityOrAudit(db, roles, actorUid, CAP_CATALOG_MANAGE, "createPartSupplierItem", "part_supplier_item", itemId);

  const partRepo = buildFirestorePartRepository(db);
  const fp = __pm_internal_fingerprint(["createPartSupplierItem", itemId, validated.value]);
  const auditId = __pm_internal_auditDocId("createPartSupplierItem", actorUid, partId.value, idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return { ...replay, itemId };
    const part = await partRepo.getById(txn, partId.value);
    if (part === null) throw new NotFoundError(`part ${partId.value} not found`);
    const existing = await getItem(db, txn, itemId);
    if (existing !== null) throw new AlreadyExistsError(`supplier item ${itemId} already exists`);
    // PR 1.5: purchase unit must share the part stocking unit family
    if (validated.value.purchaseUnit !== undefined) {
      const { areUnitsCompatible } = await import("./units.js");
      if (!areUnitsCompatible(validated.value.purchaseUnit, part.part.stockingUnit)) {
        throw new InvalidInputError(`purchaseUnit family is incompatible with stocking unit ${part.part.stockingUnit}`);
      }
    }
    const at = now();
    txn.create(ref(db, itemId), supplierItemToFirestore({
      itemId,
      partId: partId.value,
      supplierId,
      supplierSku: validated.value.supplierSku as string,
      cost: validated.value.cost as string,
      currency: validated.value.currency as string,
      leadTimeDays: validated.value.leadTimeDays as number,
      ...(validated.value.minOrderQty !== undefined ? { minOrderQty: validated.value.minOrderQty } : {}),
      ...(validated.value.orderMultiple !== undefined ? { orderMultiple: validated.value.orderMultiple } : {}),
      ...(validated.value.purchaseUnit !== undefined ? { purchaseUnit: validated.value.purchaseUnit, conversionToStockingUnit: validated.value.conversionToStockingUnit } : {}),
      ...(validated.value.contractStart !== undefined ? { contractStart: validated.value.contractStart } : {}),
      ...(validated.value.contractEnd !== undefined ? { contractEnd: validated.value.contractEnd } : {}),
      availability: (validated.value.availability as AvailabilityState) ?? "UNKNOWN",
      preferred: false, // preferred status is ONLY granted via setPreferredSupplier
      ...(validated.value.lastVerifiedAt !== undefined ? { lastVerifiedAt: validated.value.lastVerifiedAt } : {}),
      status: "ACTIVE",
      version: INITIAL_VERSION,
      createdAt: at,
      createdBy: actorUid,
      updatedAt: at,
      updatedBy: actorUid,
    }));
    stageAuditEventWithId(txn, auditId, {
      actorUid,
      action: "createPartSupplierItem",
      targetType: "part_supplier_item",
      targetId: itemId,
      outcome: "applied",
      summary: `created supplier item for part ${partId.value} supplier ${supplierId} v=1 fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: INITIAL_VERSION, itemId };
  });
}

export interface UpdatePartSupplierItemInput {
  actorUid: string;
  idempotencyKey: string;
  itemId: string;
  expectedVersion: number;
  changes: SupplierItemTermsInput;
}

export async function updatePartSupplierItem(input: UpdatePartSupplierItemInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  if (typeof input.itemId !== "string" || input.itemId.length === 0) throw new InvalidInputError("itemId is required");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new InvalidInputError("expectedVersion must be a positive integer");
  const keys = Object.keys(input.changes ?? {});
  if (keys.length === 0) throw new InvalidInputError("changes must not be empty");
  const validated = validateSupplierItemTerms(input.changes, false);
  if (!validated.valid) throw new InvalidInputError(`invalid changes: ${validated.errors.map((e) => `${e.path}:${e.code}`).join(",")}`);
  await __pm_internal_requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "updatePartSupplierItem", "part_supplier_item", input.itemId);

  const fp = __pm_internal_fingerprint(["updatePartSupplierItem", input.itemId, input.expectedVersion, validated.value]);
  const auditId = __pm_internal_auditDocId("updatePartSupplierItem", input.actorUid, input.itemId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await getItem(db, txn, input.itemId as SupplierItemId);
    if (existing === null) throw new NotFoundError(`supplier item ${input.itemId} not found`);
    if (existing.version !== input.expectedVersion) throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    const newVersion = existing.version + 1;
    txn.set(ref(db, existing.itemId), supplierItemToFirestore({
      ...existing,
      ...validated.value,
      itemId: existing.itemId, // identity immutable
      partId: existing.partId,
      supplierId: existing.supplierId,
      preferred: existing.preferred, // only via setPreferredSupplier
      status: existing.status,
      version: newVersion,
      updatedAt: now(),
      updatedBy: input.actorUid,
    }));
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "updatePartSupplierItem",
      targetType: "part_supplier_item",
      targetId: existing.itemId,
      outcome: "applied",
      summary: `updated supplier item ${existing.itemId} fields=[${keys.sort().join(",")}] v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

export interface ChangeSupplierItemStatusInput {
  actorUid: string;
  idempotencyKey: string;
  itemId: string;
  expectedVersion: number;
  newStatus: string;
}

export async function changePartSupplierItemStatus(input: ChangeSupplierItemStatusInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  if (!(SUPPLIER_ITEM_STATUSES as readonly string[]).includes(input.newStatus)) {
    throw new InvalidInputError(`newStatus must be ${SUPPLIER_ITEM_STATUSES.join("/")}`);
  }
  await __pm_internal_requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_ACTIVATE, "changePartSupplierItemStatus", "part_supplier_item", input.itemId);
  const fp = __pm_internal_fingerprint(["changePartSupplierItemStatus", input.itemId, input.expectedVersion, input.newStatus]);
  const auditId = __pm_internal_auditDocId("changePartSupplierItemStatus", input.actorUid, input.itemId, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const existing = await getItem(db, txn, input.itemId as SupplierItemId);
    if (existing === null) throw new NotFoundError(`supplier item ${input.itemId} not found`);
    if (existing.version !== input.expectedVersion) throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${existing.version}`);
    if (existing.status === input.newStatus) throw new InvalidInputError(`supplier item is already ${input.newStatus}`);
    const newVersion = existing.version + 1;
    txn.set(ref(db, existing.itemId), supplierItemToFirestore({
      ...existing,
      status: input.newStatus as SupplierItemStatus,
      // deactivating a preferred item clears preference (no dangling preferred-inactive)
      preferred: input.newStatus === "INACTIVE" ? false : existing.preferred,
      version: newVersion,
      updatedAt: now(),
      updatedBy: input.actorUid,
    }));
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "changePartSupplierItemStatus",
      targetType: "part_supplier_item",
      targetId: existing.itemId,
      outcome: "applied",
      summary: `supplier item ${existing.itemId} ${existing.status}->${input.newStatus} v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}

export interface SetPreferredSupplierInput {
  actorUid: string;
  idempotencyKey: string;
  partId: string;
  supplierId: string;
  expectedVersion: number; // of the item being made preferred
}

/** Atomically makes exactly one ACTIVE supplier item preferred for the part:
 * clears any currently-preferred item (equality-only query -- no composite
 * index) and sets the target, both in one transaction under one audit. */
export async function setPreferredSupplier(input: SetPreferredSupplierInput, deps?: PartMasterDeps): Promise<MutationOutcome> {
  const { db, roles, now, failAfterStage } = __pm_internal_resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  const partId = parsePartId(input.partId);
  if (!partId.valid) throw new InvalidInputError("invalid partId");
  if (typeof input.supplierId !== "string" || !SUPPLIER_ID_PATTERN.test(input.supplierId)) throw new InvalidInputError("invalid supplierId");
  const itemId = buildSupplierItemId(partId.value, input.supplierId);
  await __pm_internal_requireCapabilityOrAudit(db, roles, input.actorUid, CAP_CATALOG_MANAGE, "setPreferredSupplier", "part_supplier_item", itemId);
  const fp = __pm_internal_fingerprint(["setPreferredSupplier", itemId, input.expectedVersion]);
  const auditId = __pm_internal_auditDocId("setPreferredSupplier", input.actorUid, partId.value, input.idempotencyKey);

  return db.runTransaction(async (txn) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return replay;
    const target = await getItem(db, txn, itemId);
    if (target === null) throw new NotFoundError(`supplier item ${itemId} not found`);
    if (target.version !== input.expectedVersion) throw new VersionConflictError(`expectedVersion ${input.expectedVersion}, stored ${target.version}`);
    if (target.status !== "ACTIVE") throw new InvalidInputError("only an ACTIVE supplier item can be preferred");
    const currentPreferredSnap = await txn.get(
      db.collection(PART_SUPPLIER_ITEMS_COLLECTION)
        .where("partId", "==", partId.value)
        .where("preferred", "==", true)
    );
    const at = now();
    let clearedId: string | null = null;
    for (const doc of currentPreferredSnap.docs) {
      const prior = supplierItemFromFirestore(doc.id, doc.data());
      if (prior.itemId === target.itemId) {
        // already preferred: idempotent-equivalent success, nothing to change
        return { outcome: "replayed", version: target.version };
      }
      clearedId = prior.itemId;
      txn.set(ref(db, prior.itemId), supplierItemToFirestore({
        ...prior, preferred: false, version: prior.version + 1, updatedAt: at, updatedBy: input.actorUid,
      }));
    }
    const newVersion = target.version + 1;
    txn.set(ref(db, target.itemId), supplierItemToFirestore({
      ...target, preferred: true, version: newVersion, updatedAt: at, updatedBy: input.actorUid,
    }));
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "setPreferredSupplier",
      targetType: "part_supplier_item",
      targetId: target.itemId,
      outcome: "applied",
      summary: `preferred supplier for part ${partId.value} -> ${input.supplierId}${clearedId ? ` (cleared ${clearedId})` : ""} v=${newVersion} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied", version: newVersion };
  });
}
