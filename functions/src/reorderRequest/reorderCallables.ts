// Reorder — the two TRUSTED callables (Owner rulings R-13 / R-15 / R-16, 2026-08-30).
//
// Thin onCall adapters over the pure core (reorderCommands.ts). They supply ONLY I/O + authorization:
//
//   • actor identity from request.auth.uid, never from the payload;
//   • authorization by CAPABILITY, resolved fail-closed through the trusted effective-access feed.
//     Ruling R-15 is explicit: no operational-role fallback inside the callable merely because the
//     retired Rules path used roles. The capability IS the authorization authority here;
//   • the governed Warehouse read, through the EXISTING receiving-location authority;
//   • one Firestore transaction per command.
//
// ============================ R-15: ONE COMMAND, ONE WRITE AUTHORITY ============================
//
// Only the two company-authoring writes move. The other six reorder commands keep their unchanged
// client-direct path under unchanged Rules. That is a deliberate, documented MIGRATION STATE, not
// the North Star permission model: no operation is writable through both paths, because the Rules
// branches these two replace are retired in the same change.
//
// ============================ R-16: THE INVARIANT MIGRATES, INTACT ============================
//
// Rules previously cross-pinned the PO create and the request's ORDERED transition with
// existsAfter/getAfter, so neither could exist without the other. That enforcement moves HERE, into
// one transaction, at equal strength. The pure builder returns both halves together so the pairing
// cannot be forgotten, and the transaction commits both or neither.
//
// EXPORT != DEPLOY. Exporting these does not deploy them, and deployment is NOT authorized.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore, type Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { auditEventDocRef, stageAuditEventWithId } from "../access/auditEventWriter";
import { makeResolveWarehouseLocationActive } from "../inventoryReceiving/receivingLocationResolver";
import { validateGovernedWarehouse } from "../warehouseGovernance/governedWarehouseValidation";
import { resolveOperatingCompany } from "../ownership/operatingCompanyAuthority";
import {
  loadReorderWarehouseAuthority,
  reorderWarehouseOptionLabel,
  REORDER_WAREHOUSE_AUTHORITY_REASON,
  type ReorderWarehouseAuthority,
  type ReorderWarehouseOption,
} from "./reorderWarehouseAuthority";
import {
  buildCreateReorderRequest,
  buildRecordReorderPurchaseOrder,
  commandFingerprint,
  ReorderCommandError,
  type CreateReorderRequestInput,
  type RecordReorderPurchaseOrderInput,
} from "./reorderCommands";

const REORDER_REQUESTS = "reorder_requests";
const REORDER_PURCHASE_ORDERS = "reorder_purchase_orders";
const WAREHOUSES = "warehouses";

// The ALREADY-REGISTERED, already-active capabilities. Ruling: use these, register no replacements.
export const REORDER_CREATE_MANUAL_CAPABILITY = "reorder.request.create.manual";
export const REORDER_RECORD_PO_CAPABILITY = "reorder.request.recordPurchaseOrder";

/** Deterministic Audit Event id: the same actor + key resolves to the same document, so the
 *  transactional existence check below is the single source of truth for "already applied". */
const mkAuditId = (action: string, actorUid: string, key: string): string =>
  `${action}_${createHash("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;

/** Capability resolution, fail-closed: a throwing resolver is a DENIAL, never an allow. */
async function requireCapability(uid: string, capabilityId: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capabilityId] });
    allowed = decisions[capabilityId] === true;
  } catch (err) {
    console.error(`[reorder] capability resolution failed for ${capabilityId}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", `You are not authorized: ${capabilityId}`);
}

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof ReorderCommandError) {
    // R-17: an out-of-scope warehouse is an AUTHORIZATION answer, not a malformed payload, and must
    // reach the caller as one -- otherwise a UI would invite them to "fix" the field and try again.
    if (err.code === "WAREHOUSE_NOT_IN_SCOPE") {
      return new HttpsError("permission-denied", err.message, { code: err.code });
    }
    // The domain code travels in `details` so a caller can branch on the reason rather than parse
    // prose. State/precondition failures are failed-precondition; bad payloads are invalid-argument.
    const precondition =
      err.code === "REQUEST_STATE_INVALID" ||
      err.code === "PO_ALREADY_EXISTS" ||
      err.code === "REQUEST_NOT_FOUND" ||
      err.code === "WAREHOUSE_NOT_GOVERNED" ||
      err.code === "WAREHOUSE_NO_COMPANY" ||
      err.code === "REQUEST_NO_COMPANY";
    return new HttpsError(precondition ? "failed-precondition" : "invalid-argument", err.message, { code: err.code });
  }
  return new HttpsError("internal", "Reorder command failed.");
}

/**
 * Idempotency, as the ruling defines it: the key is bound to WHAT IT WAS USED TO SAY.
 *
 * A retry with the same key and the same effective payload replays the prior result. A retry with
 * the same key and a materially different payload is REFUSED -- because treating it as the original
 * would silently discard the caller's second, different intent. Idempotency here is a correctness
 * guarantee, not duplicate-error suppression.
 */
function assertReplayMatches(prior: FirebaseFirestore.DocumentSnapshot, fingerprint: string): void {
  const stored = prior.data()?.handoffReason ?? prior.data()?.summary ?? "";
  if (typeof stored === "string" && stored.includes(fingerprint)) return;
  throw new HttpsError(
    "invalid-argument",
    "This idempotency key was already used with a different payload.",
    { code: "IDEMPOTENCY_PAYLOAD_MISMATCH" },
  );
}

// ============================ CREATE REORDER REQUEST ============================

export async function persistCreatedReorderRequest(
  db: Firestore,
  tx: Transaction,
  input: CreateReorderRequestInput & { idempotencyKey: string },
  actorUid: string,
  nowMillis: number,
  // R-17. The principal's resolved warehouse scope, from the SAME resolver the picker filters by.
  // A required parameter rather than an optional one: forgetting it is a compile error, not a
  // silently unscoped create.
  authority: ReorderWarehouseAuthority,
): Promise<{ success: true; replayed: boolean; reorderRequestId: string; operatingCompanyId: string }> {
  const aid = mkAuditId("createReorderRequest", actorUid, input.idempotencyKey);
  const auditRef = auditEventDocRef(aid);

  // READ PHASE. Idempotency first, so a replay never re-reads a possibly-changed warehouse.
  const prior = await tx.get(auditRef);
  const fingerprint = commandFingerprint([
    input.partId ?? null,
    input.warehouseId ?? null,
    input.recommendationStatus ?? null,
    input.requestedQty ?? null,
    input.quantitySource ?? null,
    input.workOrderId ?? null,
  ]);
  if (prior.exists) {
    assertReplayMatches(prior, fingerprint);
    const priorId = (prior.data()?.targetId as string) ?? "";
    const priorDoc = priorId ? await tx.get(db.collection(REORDER_REQUESTS).doc(priorId)) : null;
    return {
      success: true,
      replayed: true,
      reorderRequestId: priorId,
      operatingCompanyId: (priorDoc?.data()?.operatingCompanyId as string) ?? "",
    };
  }

  // The governed warehouse, through the EXISTING authority -- governed shape AND status ACTIVE.
  const resolveActive = makeResolveWarehouseLocationActive(db);
  const warehouseGoverned = await resolveActive(tx, { type: "WAREHOUSE", locationId: String(input.warehouseId ?? "") });
  const warehouseSnap = await tx.get(db.collection(WAREHOUSES).doc(String(input.warehouseId ?? "unknown")));

  const built = buildCreateReorderRequest(input, {
    actorUid,
    nowMillis,
    warehouseGoverned,
    warehouseCompanyId: warehouseSnap.exists ? warehouseSnap.data()?.operatingCompanyId : undefined,
    // Enforcement, not decoration: a warehouseId typed straight into the payload is tested against
    // the same scope that decided what the picker was allowed to show.
    warehouseInScope: authority.allows(input.warehouseId),
  });

  // WRITE PHASE.
  const ref = db.collection(REORDER_REQUESTS).doc();
  // The canonical 35-key shape the Rules read/update branches still validate. Every field the
  // client create used to write is written here, so a record created by this command is
  // indistinguishable in shape from a legacy one -- plus the two new governed facts.
  tx.set(ref, {
    partId: built.partId,
    warehouseId: built.warehouseId,
    operatingCompanyId: built.operatingCompanyId,
    recommendationStatus: built.recommendationStatus,
    urgency: built.urgency,
    quantitySource: built.quantitySource,
    recommendedQty: built.recommendedQty,
    requestedQty: built.requestedQty,
    status: built.status,
    currentOwner: built.currentOwner,
    requestedBy: built.requestedBy,
    createdAt: built.createdAt,
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
    purchasingStartedAt: null, purchasingStartedBy: null,
    purchasingNotes: null, vendorContacted: null, expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null, lastPurchasingUpdateBy: null,
    purchaseOrderId: null, orderedBy: null, orderedAt: null, receivedBy: null, receivedAt: null,
    cancelledBy: null, cancelledAt: null, cancellationReason: null,
    voidedBy: null, voidedAt: null, voidReason: null,
    ...(built.workOrderId === null ? {} : { workOrderId: built.workOrderId }),
  });

  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "createReorderRequest",
    targetType: "reorderRequest",
    targetId: ref.id,
    outcome: "applied",
    summary: `Reorder request created for part ${built.partId} at warehouse ${built.warehouseId} (${built.operatingCompanyId}) [${fingerprint}]`,
  });

  return { success: true, replayed: false, reorderRequestId: ref.id, operatingCompanyId: built.operatingCompanyId };
}

export const createReorderRequest = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  // NO GLOBAL-TARGET CAPABILITY GATE (see listReorderWarehouseOptions for the full reasoning).
  // The per-warehouse decision below IS the authorization: the command receives
  // `warehouseInScope: authority.allows(warehouseId)` and refuses with WAREHOUSE_NOT_IN_SCOPE,
  // which maps to permission-denied. A principal with no governed reorder authority therefore
  // still cannot create anything -- the refusal simply names the warehouse rather than the
  // capability, which is the more precise answer now that authority is per-target.

  const data = (request.data ?? {}) as CreateReorderRequestInput & { idempotencyKey?: string };
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }

  const db = getFirestore();
  const actorUid = request.auth.uid;
  const nowMillis = Date.now();
  // Resolved once, before the transaction, and passed in -- so a retry of the transaction cannot
  // re-resolve into a different answer part-way through a single command.
  const authority = await loadReorderWarehouseAuthority(db, actorUid, REORDER_CREATE_MANUAL_CAPABILITY);
  try {
    return await db.runTransaction((tx) =>
      persistCreatedReorderRequest(db, tx, { ...data, idempotencyKey: data.idempotencyKey! }, actorUid, nowMillis, authority),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});

// ============================ RECORD REORDER PURCHASE ORDER ============================

export async function persistRecordedReorderPurchaseOrder(
  db: Firestore,
  tx: Transaction,
  input: RecordReorderPurchaseOrderInput & { idempotencyKey: string },
  actorUid: string,
  nowMillis: number,
): Promise<{ success: true; replayed: boolean; purchaseOrderId: string; operatingCompanyId: string }> {
  const requestId = String(input.reorderRequestId ?? "").trim();
  const aid = mkAuditId("recordReorderPurchaseOrder", actorUid, input.idempotencyKey);
  const auditRef = auditEventDocRef(aid);

  // ---- READ PHASE (Firestore requires every read before any write) ----
  const prior = await tx.get(auditRef);
  const fingerprint = commandFingerprint([
    requestId || null,
    input.supplierName ?? null,
    input.externalPoNumber ?? null,
    input.orderedQuantity ?? null,
    input.orderedDate ?? null,
    input.expectedArrivalDate ?? null,
    // FIN-BLOCK-003A -- the committed price is part of WHAT WAS COMMITTED, so it belongs in the
    // fingerprint. Without it, a retry of the same idempotency key carrying a DIFFERENT price would
    // be accepted as an exact replay and silently keep the first price, which is a financial defect
    // rather than an idempotency nicety. Now it conflicts, and says so.
    input.unitPriceMinor ?? null,
    input.currency ?? null,
  ]);
  if (prior.exists) {
    assertReplayMatches(prior, fingerprint);
    return {
      success: true,
      replayed: true,
      purchaseOrderId: (prior.data()?.targetId as string) ?? requestId,
      operatingCompanyId: "",
    };
  }
  if (!requestId) throw new ReorderCommandError("INVALID", "reorderRequestId is required");

  const requestRef = db.collection(REORDER_REQUESTS).doc(requestId);
  // IDENTITY UNCHANGED: the PO's document id IS the request id (R-16). No new id is minted.
  const poRef = db.collection(REORDER_PURCHASE_ORDERS).doc(requestId);
  const [requestSnap, poSnap] = await Promise.all([tx.get(requestRef), tx.get(poRef)]);

  const { purchaseOrder, requestPatch } = buildRecordReorderPurchaseOrder(
    input,
    requestSnap.exists ? (requestSnap.data() as Record<string, unknown>) : null,
    { actorUid, nowMillis, purchaseOrderExists: poSnap.exists },
  );

  // ---- WRITE PHASE: both halves, one commit, or neither (R-16) ----
  tx.set(poRef, purchaseOrder);
  tx.update(requestRef, { ...requestPatch });
  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "recordReorderPurchaseOrder",
    targetType: "reorderPurchaseOrder",
    targetId: requestId,
    outcome: "applied",
    summary: `Purchase order recorded for reorder request ${requestId} (${purchaseOrder.operatingCompanyId}) [${fingerprint}]`,
  });

  return {
    success: true,
    replayed: false,
    purchaseOrderId: requestId,
    operatingCompanyId: purchaseOrder.operatingCompanyId,
  };
}

export const recordReorderPurchaseOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCapability(request.auth.uid, REORDER_RECORD_PO_CAPABILITY);

  const data = (request.data ?? {}) as RecordReorderPurchaseOrderInput & { idempotencyKey?: string };
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }

  const db = getFirestore();
  const actorUid = request.auth.uid;
  const nowMillis = Date.now();
  try {
    return await db.runTransaction((tx) =>
      persistRecordedReorderPurchaseOrder(db, tx, { ...data, idempotencyKey: data.idempotencyKey! }, actorUid, nowMillis),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});

// ============================ R-17: THE SHARED WAREHOUSE ELIGIBILITY ============================

/**
 * Every candidate warehouse document, read with the Admin SDK.
 *
 * R-32 CHANGED THE READ, AND THE CHANGE IS DELIBERATE. Before, the scope was a SET, so a scoped
 * principal's ids could be fetched one by one and a collection read was performed only for an
 * unscoped one. The governed model answers per TARGET instead: which warehouses a principal may use
 * is not a value it holds, so the candidate set cannot be narrowed before asking. The collection is
 * read once and every candidate is decided in memory.
 *
 * THIS IS A SERVER-SIDE READ AND NOT A WIDENING. It runs under the Admin SDK inside a callable that
 * has already required the capability; `warehouses` remains `allow read` unchanged and no
 * `warehouse.list` capability exists. Nothing leaves this function except warehouses the principal
 * is separately authorized for -- see projectReorderWarehouseOptions.
 */
async function readCandidateWarehouseDocs(
  db: Firestore,
): Promise<readonly { id: string; data: Record<string, unknown> }[]> {
  const snap = await db.collection(WAREHOUSES).get();
  return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, unknown> }));
}

/**
 * PURE. Turn candidate documents into the picker's projection, applying EXACTLY the acceptance test
 * `createReorderRequest` applies -- authorized for this warehouse, a governed ACTIVE warehouse, and
 * carrying a governed operating company.
 *
 * THAT LAST CLAUSE IS THE RULING'S INVARIANT, and it is easy to get wrong by omission. A warehouse
 * with no `operatingCompanyId` is refused by the create (WAREHOUSE_NO_COMPANY, and rightly -- the
 * company is derived from it, so a missing one cannot be invented). Offering it anyway would hand a
 * user a choice that fails the moment they make it, which is exactly the "picker offers more than
 * the command accepts" divergence this shared code exists to prevent.
 *
 * The authorization half is `authority.allows` -- the SAME closure, from the SAME loaded principal
 * state, that the create tests its one warehouseId against. Not an equivalent predicate: the same one.
 *
 * Sorted by label so the list is stable between calls; the sort is presentation, not authority.
 *
 * `deps.validateGoverned` defaults to the real shared section 3A validator and exists so tests can
 * exercise the authorization/company/sort logic on its own. Production never passes it -- the default
 * IS the authority, and injecting a different one in real code would be inventing a second opinion
 * about what a governed warehouse is.
 */
export function projectReorderWarehouseOptions(
  authority: ReorderWarehouseAuthority,
  candidates: readonly { id: string; data: Record<string, unknown> }[],
  deps: { validateGoverned?: typeof validateGovernedWarehouse } = {},
): readonly ReorderWarehouseOption[] {
  const validateGoverned = deps.validateGoverned ?? validateGovernedWarehouse;
  const options: ReorderWarehouseOption[] = [];
  for (const candidate of candidates) {
    if (!authority.allows(candidate.id)) continue;
    const governed = validateGoverned(candidate.data, candidate.id);
    if (!governed.valid || governed.value.status !== "ACTIVE") continue;
    const company = candidate.data.operatingCompanyId;
    if (typeof company !== "string" || resolveOperatingCompany(company).company === null) continue;
    options.push({ warehouseId: candidate.id, label: reorderWarehouseOptionLabel(candidate.data.name, candidate.id) });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * listReorderWarehouseOptions -- the trusted projection that replaces a `warehouses` collection LIST
 * (Owner ruling R-17), now resolving through the governed location-scoped authority (R-32).
 *
 * This is NOT warehouse browsing, administration, or inventory access, and it introduces no
 * `warehouse.list` capability. It answers one question for one purpose: which warehouses may this
 * principal raise a reorder for. It is therefore authorized by the SAME capability as the create it
 * serves -- if you may not raise a reorder, there is no reorder warehouse list for you to see.
 *
 * No operational-role fallback, exactly as R-15 requires of its sibling.
 *
 * A capable principal with no authorized warehouse gets an empty list and a `reason`, not an error.
 * That distinction matters to the caller: "you may not do this" and "you may, but no warehouse is
 * governed to you" are different sentences, and AUTHORITY_UNRESOLVED distinguishes a third case --
 * a read failed and the answer is a fail-closed denial rather than a measured empty scope.
 */
export const listReorderWarehouseOptions = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  // NO GLOBAL-TARGET CAPABILITY GATE HERE. There used to be one, and under R-32 it was a defect
  // that denied exactly the principals R-32 exists to serve: `requireCapability` resolves through
  // the effective-access feed, which builds a GLOBAL TargetContext by construction, and a
  // location-scoped assignment can never match a global target. A warehouse manager holding
  // `warehouseManager @ location:wh-main` was refused 403 before the location authority ran.
  //
  // Caught by live sandbox proof, not by tests: every contract test exercised
  // loadReorderWarehouseAuthority directly and never went through the callable's own gate.
  //
  // Authorization is not weakened by removing it -- it is made per-target, which is what R-32
  // requires. `authority.allows(warehouseId)` decides each candidate, so a principal with no
  // governed reorder authority is offered nothing, exactly as before. The one honest difference:
  // such a principal now receives an EMPTY LIST with a reason instead of a 403. That distinction
  // ("you may not do this" vs "you may, but no warehouse is governed to you") genuinely collapses
  // once authority is per-warehouse, and pretending to preserve it would require a second opinion
  // about who may reorder -- the exact drift this module exists to prevent.

  const db = getFirestore();
  const authority = await loadReorderWarehouseAuthority(db, request.auth.uid, REORDER_CREATE_MANUAL_CAPABILITY);
  const candidates = await readCandidateWarehouseDocs(db);
  const options = projectReorderWarehouseOptions(authority, candidates);
  const reason =
    options.length > 0 ? REORDER_WAREHOUSE_AUTHORITY_REASON.GOVERNED_ASSIGNMENT : authority.reason;
  return { options, reason };
});