"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeOpportunityAsWon = void 0;
exports.persistCloseOpportunityAsWon = persistCloseOpportunityAsWon;
// CLOSE OPPORTUNITY AS WON — the atomic Won + Sales Order operation.
//
// ======================= WHY THIS EXISTS =======================
//
// Closing an Opportunity as WON must produce exactly one Sales Order. Before this, the two
// halves were separate transactions: `transitionOpportunity` committed WON, and
// `createSalesOrderFromOpportunity` then REQUIRED `outcome === "WON"` to already be
// committed. If the second call failed or was never made, the Opportunity was WON, terminal,
// and had no Sales Order — a state the business does not permit, reachable by an ordinary
// network failure between two calls.
//
// ============ WHY THE TWO EXISTING CORES CANNOT SIMPLY BE COMPOSED ============
//
// Both `persistTransitionedOpportunity` and `persistSalesOrderFromOpportunity` accept a
// Transaction, so composing them looks trivial. It is not: Firestore requires ALL reads
// before ANY writes, and each core is internally read-then-write. Calling them in either
// order puts a read after a write and the transaction is rejected outright.
//
// So this orchestrator re-derives the ORDER, not the LOGIC. Every decision it makes is made
// by the same pure builders the standalone callables use — `buildTransitionPatch`,
// `buildCreateSalesOrder`, `deriveSalesOrderLines`, `allocateSalesOrderNumber`. There is no
// second Sales Order service and no second numbering scheme.
//
// ============ THE ORDERING CONSTRAINT, INCLUDING THE ALLOCATOR ============
//
// `allocateSalesOrderNumber` is itself a MIXED operation: it reads the year counter and then
// writes it back. That makes it the transaction's first write boundary, and it must
// therefore run after every other read. Calling it earlier would be harmless; calling it
// after the transition or audit writes would break the transaction at runtime, in the exact
// path that must never fail. The order below is load-bearing and is stated step by step:
//
//   READS
//     1. idempotency / audit state
//     2. the Opportunity
//     3. any existing Sales Order for this Opportunity
//     4. remaining validation (pure, over what was read)
//     5. existing order found -> reconcile and return, WITHOUT allocating a number
//   WRITES
//     6. allocate + reserve the counter   <- first write
//     7. the Opportunity transition
//     8. the Sales Order
//     9. lineage, both directions
//    10. audit evidence
//
// A number is never allocated on a path that returns an existing order, so a retry cannot
// burn a sequence value.
//
// ============ NO CLIENT-REACHABLE "ALREADY WON" FLAG ============
//
// A tempting shortcut is to let the caller assert "WON is being set in this transaction" so
// the Sales Order half skips its precondition. This does not do that, and deliberately: any
// such flag becomes a way to create a Sales Order against an Opportunity that is not WON.
// This function reads the Opportunity itself and decides. The standalone callables keep
// their own preconditions unchanged.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const auditEventWriter_1 = require("../access/auditEventWriter");
const collections_1 = require("../constants/collections");
const salesOrderCommands_1 = require("../salesOrder/salesOrderCommands");
const salesOrderNumbering_1 = require("../salesOrder/salesOrderNumbering");
const createSalesOrderFromOpportunity_1 = require("./createSalesOrderFromOpportunity");
const collections_js_1 = require("../constants/collections.js");
const agreementToSalesOrder_js_1 = require("../salesAgreement/agreementToSalesOrder.js");
const opportunityCommands_1 = require("./opportunityCommands");
const opportunityCallables_1 = require("./opportunityCallables");
const opportunityLifecycle_1 = require("./opportunityLifecycle");
const typedOwner_1 = require("../ownership/typedOwner");
// Keyed by THIS action, so a replay key collides only with a prior call through this
// operation — never with the standalone transition or create callables, which own their own
// idempotency spaces.
const mkParentAuditId = (actorUid, opportunityId, key) => `closeOpportunityAsWon_${(0, node_crypto_1.createHash)("sha256").update(`${actorUid}|${opportunityId}|${key}`).digest("hex").slice(0, 40)}`;
// The two child facts hang off the parent id, so the audit trail shows one atomic action
// with its two constituent events rather than two unrelated ones that happen to share a
// timestamp.
const childAuditId = (parentAid, suffix) => `${parentAid}__${suffix}`;
async function persistCloseOpportunityAsWon(db, tx, input, actorUid) {
    const opportunityId = input.opportunityId;
    const opportunityRef = db.collection(collections_1.OPPORTUNITIES_COLLECTION).doc(opportunityId);
    // ---------------------------------------------------------------- 1. READ: idempotency
    // First, so a replay returns the prior outcome without re-deriving anything against an
    // Opportunity that may have changed since.
    const parentAid = mkParentAuditId(actorUid, opportunityId, input.idempotencyKey);
    const priorAudit = await tx.get((0, auditEventWriter_1.auditEventDocRef)(parentAid));
    if (priorAudit.exists) {
        const priorId = priorAudit.data()?.targetId ?? "";
        // DEFECT FIXED HERE: this read `prior.salesOrderNumber` off the audit event, which NEVER
        // carries it. buildAuditEventDoc writes a fixed field set, so the number staged onto the input
        // below is dropped, and every replay of the atomic WON returned salesOrderNumber: null -- a
        // retrying caller lost the reference to the order it had just created.
        //
        // The number is authoritative on the Sales Order. Read it from there.
        const priorDoc = priorId ? await tx.get(db.collection(collections_1.SALES_ORDERS_COLLECTION).doc(priorId)) : null;
        return {
            success: true,
            replayed: true,
            recovered: false,
            opportunityId,
            salesOrderId: priorId,
            salesOrderNumber: priorDoc?.data()?.salesOrderNumber ?? null,
        };
    }
    // ---------------------------------------------------------------- 2. READ: Opportunity
    const oppSnap = await tx.get(opportunityRef);
    if (!oppSnap.exists)
        throw new https_1.HttpsError("not-found", `No Opportunity with id ${opportunityId}`);
    const opp = oppSnap.data();
    // ------------------------------------------------- 3. READ: an existing Sales Order
    // Queried IN-TRANSACTION so concurrent Won attempts see a consistent snapshot and
    // Firestore serializes the conflicting one.
    const dupSnap = await tx.get(db.collection(collections_1.SALES_ORDERS_COLLECTION).where("sourceOpportunityId", "==", opportunityId).limit(1));
    // ---------------------------------------------------------- 4. remaining validation
    // Pure, over what was read. No further reads occur after this point except the counter.
    if (opp.outcome === "LOST") {
        throw new https_1.HttpsError("failed-precondition", "Opportunity is LOST and cannot be closed as WON.");
    }
    if (!opp.accountId) {
        throw new https_1.HttpsError("failed-precondition", "Opportunity has no accountId; cannot derive Sales Order account.");
    }
    if (!(0, opportunityLifecycle_1.isChannel)(input.salesChannel)) {
        throw new https_1.HttpsError("invalid-argument", "salesChannel is invalid.");
    }
    const alreadyWon = opp.outcome === "WON";
    // The stage gate. Delegated to the ratified lifecycle graph rather than restated here, so
    // "WON only from DECISION" has exactly one definition. Skipped when already WON, because
    // the recovery path is not performing a transition.
    let transitionPatch = null;
    if (!alreadyWon) {
        try {
            transitionPatch = (0, opportunityCommands_1.buildTransitionPatch)(
            // Cast at the boundary: the stored document is untyped Firestore data, and
            // buildTransitionPatch validates `stage` itself (isStage) rather than trusting it.
            { stage: opp.stage, outcome: opp.outcome ?? null, lines: opp.lines }, { kind: "OUTCOME", outcome: "WON" }, { actorUid, nowMillis: Date.now() });
        }
        catch (err) {
            if (err instanceof opportunityCommands_1.OpportunityCommandError) {
                // NO_LINES and an illegal stage are both business preconditions, not server faults.
                throw new https_1.HttpsError("failed-precondition", err.message);
            }
            throw err;
        }
    }
    // ------------------------------- 5. existing order -> reconcile and return, NO allocation
    if (!dupSnap.empty) {
        const existing = dupSnap.docs[0];
        const existingData = existing.data() ?? {};
        // FAIL CLOSED on conflicting lineage. An order claiming this Opportunity but belonging to
        // a different account is not something to quietly hand back — it means the lineage is
        // already wrong, and returning it would launder that into a success.
        if (existingData.accountId && existingData.accountId !== opp.accountId) {
            throw new https_1.HttpsError("failed-precondition", `Existing Sales Order ${existing.id} is for account ${existingData.accountId}, not this Opportunity's account ${opp.accountId}.`);
        }
        // Recover a missing back-link. The order exists and points here; the Opportunity does not
        // point back. That is a repairable half-write from an older split-brain, and repairing it
        // is a WRITE with no read after it, so the ordering constraint still holds.
        const patch = {};
        if (opp.salesOrderId !== existing.id)
            patch.salesOrderId = existing.id;
        // An Opportunity holding an order but not marked WON is the other half of the same
        // split-brain. Close it, using the same lifecycle-derived patch.
        if (!alreadyWon && transitionPatch)
            Object.assign(patch, transitionPatch);
        if (Object.keys(patch).length > 0) {
            patch.updatedAt = firestore_1.FieldValue.serverTimestamp();
            tx.update(opportunityRef, patch);
        }
        (0, auditEventWriter_1.stageAuditEventWithId)(tx, parentAid, {
            actorUid,
            action: "closeOpportunityAsWon",
            targetType: "salesOrder",
            targetId: existing.id,
            outcome: "applied",
            summary: `reconciled existing sales order ${existing.id} for opportunity ${opportunityId}`,
        });
        return {
            success: true,
            replayed: true,
            recovered: Object.keys(patch).length > 0,
            opportunityId,
            salesOrderId: existing.id,
            salesOrderNumber: existingData.salesOrderNumber ?? null,
        };
    }
    // ══════════ THE AGREEMENT IS THE PRICE SOURCE — STILL IN THE READ PHASE ══════════
    //
    // This path had the SAME unpriced shortcut as createSalesOrderFromOpportunity: it mapped
    // Opportunity { kind, ref, qty } through with no price. Fixing only the other one would have left
    // the hole open through the atomic WON route, which is the route that actually runs.
    //
    // Read here, before the first write, because Firestore requires every read to precede every write
    // and the counter allocation below is a write.
    //
    // ONE equality predicate on one field: Firestore's automatic single-field index serves it. No
    // composite is declared, and none is needed.
    const agreementSnap = await tx.get(db.collection(collections_js_1.SALES_AGREEMENTS_COLLECTION).where("sourceOpportunityId", "==", opportunityId).limit(1));
    const agreementDoc = agreementSnap.empty ? null : agreementSnap.docs[0];
    const agreementData = agreementDoc?.data() ?? {};
    (0, agreementToSalesOrder_js_1.assertAgreementConvertible)({
        exists: agreementDoc !== null,
        state: agreementData.state,
        accountId: agreementData.accountId ?? null,
        sourceOpportunityId: agreementData.sourceOpportunityId ?? null,
        lines: agreementData.lines ?? [],
    }, { id: opportunityId, accountId: opp.accountId });
    const agreementLines = (0, agreementToSalesOrder_js_1.salesOrderLinesFromAgreement)({ state: agreementData.state, lines: agreementData.lines ?? [] });
    const fromAgreement = (0, agreementToSalesOrder_js_1.salesOrderFieldsFromAgreement)({
        locationId: agreementData.locationId ?? null,
        customerPO: agreementData.customerPO ?? null,
        specialInstructions: agreementData.specialInstructions ?? null,
    });
    // Build the Sales Order body BEFORE the first write: pure, and a validation failure here
    // must not leave a reserved counter behind.
    let built;
    try {
        built = (0, salesOrderCommands_1.buildCreateSalesOrder)({
            accountId: opp.accountId,
            ownerEmployeeId: input.ownerEmployeeId,
            // Ruling D-4: the Opportunity's own owner is the default for the Sales Order it produces.
            // `opp` was read inside this transaction, so the inherited owner is the one in force at
            // commit -- not one that could have been handed off between the read and the write.
            inheritedOwner: (0, typedOwner_1.deriveEmployeeRefOwner)(opp),
            // FIN-002: attribution flows DELIBERATELY, snapshot semantics (copied, not followed). The
            // accepted Agreement's frozen values win — that is what the customer committed to; the
            // Opportunity's are the fallback for chains created before the Agreement carried them.
            // This call site previously passed NEITHER, which is exactly the FIN-001 finding that a
            // converted order's company attribution resolved to null.
            inheritedOperatingCompanyId: (agreementData.operatingCompanyId ?? opp.operatingCompanyId ?? null),
            inheritedCreditedSalespersonId: (agreementData.creditedSalespersonId ?? opp.creditedSalespersonId ?? null),
            salesChannel: input.salesChannel,
            // The caller's own values still win where supplied; the Agreement fills what was left out.
            locationId: input.locationId ?? fromAgreement.locationId,
            sourceOpportunityId: opportunityId,
            customerPO: input.customerPO ?? fromAgreement.customerPO,
            notes: fromAgreement.notes,
            lines: agreementLines,
        }, 
        // BOOKED at acceptance: the agreement's server-stamped acceptedAtMillis is when the
        // commercial terms were committed (DECISIONS #154). Fallback to now only if a pre-FIN-002
        // accepted agreement carries no stamp.
        { actorUid, nowMillis: Date.now(), bookedAtMillis: agreementData.acceptedAtMillis ?? undefined });
    }
    catch (err) {
        if (err instanceof salesOrderCommands_1.SalesOrderCommandError)
            throw new https_1.HttpsError("invalid-argument", err.message);
        throw err;
    }
    // ============================== WRITE PHASE BEGINS ==============================
    // ------------------------------------------- 6. allocate + reserve the counter (1st write)
    const { salesOrderNumber } = await (0, salesOrderNumbering_1.allocateSalesOrderNumber)(tx, new Date().getUTCFullYear());
    const soRef = db.collection(collections_1.SALES_ORDERS_COLLECTION).doc();
    const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
    // ------------------------------------------------ 7 + 9. transition and lineage, one write
    const oppPatch = {
        salesOrderId: soRef.id,
        // BESIDE salesOrderId, never instead of it: existing consumers navigate by the order link, and
        // one id field cannot mean two objects.
        salesAgreementId: agreementDoc.id,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    if (transitionPatch)
        Object.assign(oppPatch, transitionPatch);
    tx.update(opportunityRef, oppPatch);
    // The agreement's result link, in the SAME commit -- it can never point at an order that was not
    // committed. A replay returns the prior outcome long before reaching here.
    tx.update(agreementDoc.ref, { salesOrderId: soRef.id, updatedAt: firestore_1.FieldValue.serverTimestamp() });
    // ------------------------------------------------------------------ 8. the Sales Order
    tx.set(soRef, {
        ...fields,
        salesOrderNumber,
        // Denormalized deliberately: the reference is IMMUTABLE, so a copy cannot go stale. The
        // Opportunity's human NAME is deliberately not copied, for the opposite reason.
        sourceOpportunityNumber: opp.opportunityNumber ?? null,
        // Which commitment this order fulfils.
        sourceAgreementId: agreementDoc.id,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    // ------------------------------------------------------------------ 10. audit evidence
    // Three facts: the parent atomic action, and the two constituent events preserved
    // separately so the trail is not collapsed into one entry that hides half of what happened.
    (0, auditEventWriter_1.stageAuditEventWithId)(tx, parentAid, {
        actorUid,
        action: "closeOpportunityAsWon",
        targetType: "salesOrder",
        targetId: soRef.id,
        outcome: "applied",
        summary: `closed opportunity ${opportunityId} as WON and created sales order ${salesOrderNumber}`,
    });
    if (transitionPatch) {
        (0, auditEventWriter_1.stageAuditEventWithId)(tx, childAuditId(parentAid, "transition"), {
            actorUid,
            action: "transitionOpportunity",
            targetType: "opportunity",
            targetId: opportunityId,
            outcome: "applied",
            summary: `opportunity ${opportunityId} closed as WON`,
        });
    }
    (0, auditEventWriter_1.stageAuditEventWithId)(tx, childAuditId(parentAid, "salesOrder"), {
        actorUid,
        action: "createSalesOrderFromOpportunity",
        targetType: "salesOrder",
        targetId: soRef.id,
        outcome: "applied",
        summary: `created sales order ${salesOrderNumber} for account ${opp.accountId} from opportunity ${opportunityId}`,
    });
    return {
        success: true,
        replayed: false,
        recovered: alreadyWon,
        opportunityId,
        salesOrderId: soRef.id,
        salesOrderNumber,
    };
}
// ================================ THE CALLABLE ================================
//
// REQUIRES BOTH CAPABILITIES. Closing as WON is a transition (opportunity.write) that also
// creates a Sales Order (opportunity.createSalesOrder). Requiring both is not belt-and-braces:
// this operation is a strictly greater authority than either alone, and someone who may
// advance stages but may not commit an order must not gain that power by routing through the
// combined action. Fail-closed on a throwing resolver, same as every other gate here.
async function requireCloseAsWon(uid) {
    const ids = [opportunityCallables_1.OPPORTUNITY_WRITE_CAPABILITY, createSalesOrderFromOpportunity_1.OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY];
    let decisions = {};
    try {
        ({ decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: ids }));
    }
    catch (err) {
        console.error("[requireCloseAsWon] capability resolution failed", err);
        throw new https_1.HttpsError("permission-denied", "You are not authorized to close this Opportunity as Won.");
    }
    const missing = ids.filter((id) => decisions[id] !== true);
    if (missing.length > 0) {
        throw new https_1.HttpsError("permission-denied", "You are not authorized to close this Opportunity as Won.");
    }
}
exports.closeOpportunityAsWon = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    await requireCloseAsWon(request.auth.uid);
    const data = (request.data ?? {});
    if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "opportunityId is required.");
    }
    // Ruling D-4: ownerEmployeeId is now OPTIONAL here. An omitted owner is no longer rejected at the
    // door -- it falls through to inheritance from the Opportunity, and the builder still REFUSES if
    // nothing resolves. A supplied value is still shape-checked, because a caller that sends a
    // non-string or a blank string means to set an owner and got it wrong -- that is a bad payload,
    // not an omission, and silently inheriting over it would hide the mistake.
    if (data.ownerEmployeeId !== undefined && data.ownerEmployeeId !== null) {
        if (typeof data.ownerEmployeeId !== "string" || data.ownerEmployeeId.trim().length === 0) {
            throw new https_1.HttpsError("invalid-argument", "ownerEmployeeId, when provided, must be a non-empty string.");
        }
    }
    if (!(0, opportunityLifecycle_1.isChannel)(data.salesChannel))
        throw new https_1.HttpsError("invalid-argument", "salesChannel is invalid.");
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
        throw new https_1.HttpsError("invalid-argument", "idempotencyKey is required.");
    }
    const db = (0, firestore_1.getFirestore)();
    // Fields are copied individually, never spread from `data` — so no client key can reach the
    // persist core except the five named here. Account and lines are always server-derived.
    return await db.runTransaction((tx) => persistCloseOpportunityAsWon(db, tx, {
        opportunityId: data.opportunityId.trim(),
        // undefined travels through to the builder, which inherits the Opportunity's owner.
        ownerEmployeeId: typeof data.ownerEmployeeId === "string" ? data.ownerEmployeeId.trim() : undefined,
        salesChannel: data.salesChannel,
        locationId: typeof data.locationId === "string" ? data.locationId.trim() : null,
        customerPO: typeof data.customerPO === "string" ? data.customerPO.trim() : null,
        idempotencyKey: data.idempotencyKey.trim(),
    }, request.auth.uid));
});
//# sourceMappingURL=closeOpportunityAsWon.js.map