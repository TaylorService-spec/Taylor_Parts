"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.interpretWorkOrderReadinessContext = exports.KEYSTONE_INTERPRETATION_TIMEOUT_MS = exports.getWorkOrderReadinessContext = void 0;
exports.assembleWorkOrderReadinessContext = assembleWorkOrderReadinessContext;
exports.describeReadinessObservation = describeReadinessObservation;
exports.buildWorkOrderInterpretationInput = buildWorkOrderInterpretationInput;
exports.boundedFetch = boundedFetch;
exports.interpretWorkOrderReadiness = interpretWorkOrderReadiness;
exports.runtimeSyntheticInterpretationPermitted = runtimeSyntheticInterpretationPermitted;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const callerContext_1 = require("../callerContext");
const environmentCapabilityOverrides_1 = require("../access/environmentCapabilityOverrides");
const operationalProvider_1 = require("./operationalProvider");
const workOrderModelInterpretation_1 = require("./workOrderModelInterpretation");
const collections_js_1 = require("../constants/collections.js");
const effectiveAccessFeed_1 = require("../access/effectiveAccessFeed");
const partBalanceReadService_1 = require("../inventory/partBalanceReadService");
const partBalanceBatchReadService_1 = require("../inventory/partBalanceBatchReadService");
const partMasterRepository_1 = require("../partMaster/partMasterRepository");
const controlTypeTrackingMode_1 = require("../partMaster/controlTypeTrackingMode");
const fulfillmentAvailability_1 = require("../fulfillment/fulfillmentAvailability");
const workOrderContext_1 = require("./workOrderContext");
const workOrderReadinessSources_1 = require("./workOrderReadinessSources");
const types_1 = require("./types");
const REORDER_REQUESTS_COLLECTION = "reorder_requests";
async function assembleWorkOrderReadinessContext(input, deps) {
    const caller = await deps.loadCaller(input.principalUid);
    const workOrder = await deps.loadWorkOrder(input.workOrderId);
    if (!workOrder)
        throw new https_1.HttpsError("not-found", "No such work order.");
    const actor = {
        authenticated: true,
        role: caller.role,
        technicianId: caller.technicianId,
    };
    (0, workOrderContext_1.assertWorkOrderContextReadable)(actor, {
        assignedTechId: typeof workOrder.assignedTechId === "string" ? workOrder.assignedTechId : null,
    });
    let inventoryBalanceReadable = false;
    try {
        inventoryBalanceReadable = await deps.resolveInventoryBalanceAccess(input.principalUid);
    }
    catch {
        inventoryBalanceReadable = false;
    }
    const access = (0, workOrderContext_1.resolveWorkOrderContextAccess)({
        actor,
        workOrder: {
            assignedTechId: typeof workOrder.assignedTechId === "string" ? workOrder.assignedTechId : null,
        },
        capabilityDecisions: {
            [partBalanceReadService_1.INVENTORY_BALANCE_READ_CAPABILITY]: inventoryBalanceReadable,
        },
    });
    // Reorder Request client-read authority is broad only for admin/dispatcher. Other roles have
    // request-specific predicates, so a server-side WO query could over-return for them. Until a
    // dedicated governed procurement read exists, only this exact broad Rules branch is mirrored.
    const procurementReadable = caller.role === "admin" || caller.role === "dispatcher";
    // EXISTING ACTION ELIGIBILITY, NOT A NEW AUTHORITY. The READY reorder-request create branch in
    // firestore.rules is admin/dispatcher-only. Exposing that boolean lets intelligence decide whether
    // the already-existing requestReorderForRecommendation action may be PROPOSED. If a human accepts,
    // firestore.rules evaluates the write again from current user state; this boolean is never trusted
    // as authorization by the write path.
    const requestReorderEligible = caller.role === "admin" || caller.role === "dispatcher";
    const internalPlan = plannedLines(workOrder);
    const canonicalPartIds = [...new Set(internalPlan
            .map((line) => line.partId)
            .filter((value) => typeof value === "string" && value.length > 0))];
    const [balances, reservationRows, reorderRows] = await Promise.all([
        access.inventoryBalanceReadable && canonicalPartIds.length > 0
            ? deps.loadBalances(canonicalPartIds)
            : Promise.resolve([]),
        access.inventoryBalanceReadable && canonicalPartIds.length > 0
            ? deps.loadReservationRows(input.workOrderId)
            : Promise.resolve([]),
        procurementReadable && canonicalPartIds.length > 0
            ? deps.loadReorderRows(input.workOrderId)
            : Promise.resolve([]),
    ]);
    const balanceByPart = new Map(balances.map((balance) => [balance.partId, balance]));
    const reservationsByPart = groupRowsByPartId(reservationRows);
    const reordersByPart = groupRowsByPartId(reorderRows);
    const plannedParts = internalPlan.map((line) => {
        const balance = line.partId ? balanceByPart.get(line.partId) : undefined;
        const reservation = line.partId
            ? (0, fulfillmentAvailability_1.openWorkOrderReserved)((reservationsByPart.get(line.partId) ?? []))
            : 0;
        const procurement = line.partId && procurementReadable
            ? (0, workOrderReadinessSources_1.strongestReadinessProcurementStatus)((reordersByPart.get(line.partId) ?? []).map((row) => row.status))
            : "NONE";
        return Object.freeze({
            name: line.name,
            sku: line.sku,
            qtyPlanned: line.qtyPlanned,
            qtyUsed: line.qtyUsed,
            reservedForJob: reservation,
            warehouse: warehouseDimension(balance, access.inventoryBalanceReadable),
            // No authoritative MOBILE/truck quantity source exists yet. This is a capability absence,
            // never a guessed zero.
            truck: Object.freeze({ status: "UNAVAILABLE" }),
            procurement: Object.freeze({ status: procurement }),
        });
    });
    const facts = (0, workOrderContext_1.sanitizeWorkOrderFacts)(workOrder);
    const limitations = [
        ...access.limitations,
        ...(procurementReadable ? [] : ["PROCUREMENT_READ_NOT_AUTHORIZED"]),
        "TRUCK_INVENTORY_UNAVAILABLE",
    ];
    return Object.freeze({
        schemaVersion: 1,
        subject: facts.subject,
        plannedParts: Object.freeze(plannedParts),
        capabilities: Object.freeze({
            warehouse: access.inventoryBalanceReadable,
            truckInventory: false,
            purchasing: procurementReadable,
            requestReorder: requestReorderEligible,
        }),
        limitations: Object.freeze(limitations),
    });
}
function plannedLines(workOrder) {
    const snapshot = Array.isArray(workOrder.inventorySnapshot)
        ? workOrder.inventorySnapshot
        : [];
    return snapshot
        .filter((line) => positiveNumber(line.qtyPlanned) > 0)
        .map((line) => ({
        partId: cleanString(line.partId),
        name: cleanString(line.name),
        sku: cleanString(line.sku),
        qtyPlanned: positiveNumber(line.qtyPlanned),
        qtyUsed: positiveNumber(line.qtyUsed),
    }));
}
function groupRowsByPartId(rows) {
    const grouped = new Map();
    for (const row of rows) {
        const partId = cleanString(row.partId);
        if (!partId)
            continue;
        const current = grouped.get(partId) ?? [];
        current.push(row);
        grouped.set(partId, current);
    }
    return grouped;
}
function warehouseDimension(balance, enabled) {
    if (!enabled)
        return Object.freeze({ status: "UNAVAILABLE" });
    if (!balance || balance.available.state !== "KNOWN" || typeof balance.available.value !== "number") {
        return Object.freeze({ status: "UNKNOWN" });
    }
    return Object.freeze({ status: "KNOWN", available: Math.max(0, balance.available.value) });
}
function cleanString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function positiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
function realDependencies(db) {
    return {
        loadCaller: (uid) => (0, callerContext_1.getCallerContext)(uid),
        loadWorkOrder: async (workOrderId) => {
            const snap = await db.collection(collections_js_1.WORK_ORDERS_COLLECTION).doc(workOrderId).get();
            return snap.exists ? snap.data() : null;
        },
        resolveInventoryBalanceAccess: async (uid) => {
            const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
                principalUid: uid,
                permissionIds: [partBalanceReadService_1.INVENTORY_BALANCE_READ_CAPABILITY],
            }, { db });
            return decisions[partBalanceReadService_1.INVENTORY_BALANCE_READ_CAPABILITY] === true;
        },
        loadBalances: async (partIds) => {
            const repository = (0, partMasterRepository_1.buildFirestorePartRepository)(db);
            const stored = await Promise.all(partIds.map((id) => repository.getById(null, id)));
            const serialTrackedByPartId = new Map(stored
                .map((record, i) => record === null ? null : [partIds[i], (0, controlTypeTrackingMode_1.isSerialTracked)(record.part.controlType)])
                .filter((entry) => entry !== null));
            return (0, partBalanceBatchReadService_1.readPartBalances)(db, partIds, serialTrackedByPartId);
        },
        loadReservationRows: async (workOrderId) => {
            const snap = await db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION)
                .where("workOrderId", "==", workOrderId)
                .get();
            return snap.docs.map((doc) => doc.data());
        },
        loadReorderRows: async (workOrderId) => {
            const snap = await db.collection(REORDER_REQUESTS_COLLECTION)
                .where("workOrderId", "==", workOrderId)
                .get();
            return snap.docs.map((doc) => doc.data());
        },
    };
}
exports.getWorkOrderReadinessContext = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const workOrderId = cleanString(request.data?.workOrderId);
    if (!workOrderId)
        throw new https_1.HttpsError("invalid-argument", "workOrderId is required.");
    try {
        const db = (0, firestore_1.getFirestore)();
        return await assembleWorkOrderReadinessContext({ principalUid: request.auth.uid, workOrderId }, realDependencies(db));
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        if (err instanceof types_1.AIError && err.code === "AI_CAPABILITY_DENIED") {
            throw new https_1.HttpsError("permission-denied", "You are not authorized to read this Work Order.");
        }
        console.error("[getWorkOrderReadinessContext] failed", err);
        throw new https_1.HttpsError("internal", "The readiness context could not be assembled.");
    }
});
// =================================================================================================
// TRUSTED PRIVATE-AI INTERPRETATION OF THE GOVERNED READINESS CONTEXT
//
// The only EOS path that sends operational evidence to the private Keystone model. It composes
// existing authorities and creates none: the caller predicate is workOrderContext's mirror of
// firestore.rules, the facts are the readiness context assembled above, the transport is the
// operational provider seam, and the last word belongs to verifyWorkOrderModelInterpretation.
//
// FOUR THINGS THIS DELIBERATELY CANNOT DO.
//
// 1. It cannot write. There is no Firestore write, no command dispatch, and no lookup of a command
//    by a name the model supplied. An interpretation is a returned value and nothing else.
// 2. It cannot recommend. `allowedRecommendation` is null for this slice, so the verifier rejects
//    any action the model names. The deterministic recommendation authority currently lives in the
//    browser, and reproducing it here would be a second copy of a governed business rule.
// 3. It cannot be pointed at arbitrary evidence. The request carries a workOrderId and nothing
//    else. Every fact in the envelope is server-assembled from the governed record, so there is no
//    field a caller can use to put words into the model's input.
// 4. It cannot decide where it may run. The synthetic classification comes from the environment
//    registry keyed on the runtime's own project identity, which the platform sets and no caller
//    can influence.
// =================================================================================================
/**
 * Server-only configuration, bound through Firebase Secret Manager.
 *
 * The repository had no Functions secret convention before this -- the seam read `process.env`
 * directly and nothing populated it. Secret Manager is the platform mechanism for exactly this, and
 * binding it here keeps the existing env-var contract intact rather than introducing a second one:
 * the platform populates `process.env` under these names, and `operationalProviderFromEnvironment`
 * reads them exactly as it always has.
 *
 * All five are bound the same way on purpose. The URL and tenant id are not credentials, but a
 * split mechanism -- some values here, some somewhere else -- is the arrangement where one half
 * quietly stops being server-only and nobody notices.
 *
 * WHY THESE ARE NAMES AND NOT `defineSecret(...)` PARAMS.
 *
 * `defineSecret` does two separate things, and this function only ever wanted one of them. It binds
 * the secret to whatever function lists it -- which is what we want -- and it also registers a
 * PARAMETER on the whole Functions codebase, which is not. The parameter is the wider claim: the
 * CLI resolves every declared param for the entire codebase during `functions:prepare`, BEFORE it
 * filters endpoints by `--only`, and prompts to create any secret that does not yet exist in Secret
 * Manager. That is how deploying an unrelated single function -- `acquireSerializedAsset`, which
 * has no Keystone dependency of any kind -- came to demand a KEYSTONE_GATEWAY_URL value (ND-33).
 *
 * Naming the secrets as strings keeps the binding and drops the codebase-wide claim. The endpoint
 * the SDK emits is byte-identical either way (`optionsToEndpoint` reads `secret.name` for a
 * SecretParam and the string itself otherwise), so this function still declares exactly the same
 * five secret environment variables and still cannot run without them. What changes is only WHEN
 * the CLI cares: secret existence and access are validated against the FILTERED backend, so these
 * five are still checked whenever this function is actually being deployed, and are correctly
 * irrelevant when it is not.
 *
 * This is a narrowing, not a relaxation. Nothing here is weaker: no plaintext fallback, no default,
 * no shared binding. A deploy of THIS function with a missing secret still fails.
 */
const KEYSTONE_INTERPRETATION_SECRETS = [
    "KEYSTONE_GATEWAY_URL",
    "KEYSTONE_GATEWAY_API_KEY",
    "KEYSTONE_GATEWAY_TENANT_ID",
    "KEYSTONE_ACCESS_CLIENT_ID",
    "KEYSTONE_ACCESS_CLIENT_SECRET",
];
/** A model call is an interactive latency budget, not a batch job. */
exports.KEYSTONE_INTERPRETATION_TIMEOUT_MS = 20_000;
function refuse(reason) {
    return { speak: false, origin: "EOS", reason };
}
function outstandingQuantity(line) {
    const remaining = line.qtyPlanned - line.qtyUsed;
    return remaining > 0 ? remaining : 0;
}
/**
 * State the assembled context in one sentence, arithmetically.
 *
 * This is deliberately NOT the readiness taxonomy. READY / ATTENTION / UNKNOWN and the shortage
 * reasons are the client's governed derivation, and restating them here would be a second copy of
 * that authority which could disagree with the one the user is looking at. What this says is only
 * what the numbers in the context already say: how many planned lines the warehouse figure covers,
 * how many it does not, and how many have no figure at all.
 */
function describeReadinessObservation(plannedParts) {
    const total = plannedParts.length;
    if (total === 0)
        return "EOS assembled no planned parts for this work order.";
    let below = 0;
    let unknown = 0;
    for (const line of plannedParts) {
        if (line.warehouse.status !== "KNOWN")
            unknown += 1;
        else if (line.warehouse.available < outstandingQuantity(line))
            below += 1;
    }
    const lines = `${total} planned part ${total === 1 ? "line" : "lines"}`;
    if (unknown === total)
        return `EOS has no warehouse availability figure for any of ${lines}.`;
    if (below === 0 && unknown === 0) {
        return `Warehouse availability covers the outstanding quantity on all ${lines}.`;
    }
    const observed = [];
    if (below > 0)
        observed.push(`${below} below the outstanding quantity`);
    if (unknown > 0)
        observed.push(`${unknown} with no availability figure`);
    return `Of ${lines}, ${observed.join(" and ")}.`;
}
/**
 * Project the governed context into the interpretation contract.
 *
 * PURE, and an allowlist by construction: every field is written out by name from the already
 * sanitized readiness context. Nothing is spread, so a field added to the context later cannot
 * reach the model by inheritance -- someone has to come here and decide that it may.
 */
function buildWorkOrderInterpretationInput(context) {
    const evidence = context.plannedParts.map((line, index) => {
        const availability = line.warehouse.status === "KNOWN"
            ? `warehouse available ${line.warehouse.available}`
            : `warehouse availability ${line.warehouse.status.toLowerCase()}`;
        return {
            key: `E${index + 1}`,
            kind: `PLANNED_PART_${line.warehouse.status}`,
            summary: [
                line.name ?? line.sku ?? "Unnamed planned part",
                `planned ${line.qtyPlanned}`,
                `used ${line.qtyUsed}`,
                `outstanding ${outstandingQuantity(line)}`,
                availability,
                `procurement ${line.procurement.status.toLowerCase()}`,
            ].join(", "),
        };
    });
    return {
        schemaVersion: 1,
        subjectReference: context.subject.reference,
        observedFact: describeReadinessObservation(context.plannedParts),
        // EOS states no conclusion of its own here, so the model has nothing to echo back as though
        // EOS had already reached one.
        deterministicInterpretation: null,
        deterministicBusinessConsequence: null,
        evidence,
        // See (2) in the header. Null means the verifier refuses every action the model might name.
        allowedRecommendation: null,
    };
}
/**
 * Wrap the interpretation contract in the operational transport envelope.
 *
 * `classification: "SYNTHETIC"` is asserted here, and is true only because the caller has already
 * proved -- from the environment registry keyed on this runtime's own project identity -- that this
 * environment's operational evidence is synthetic. That is why this function is module-private and
 * why the orchestration below checks the gate before it can be reached: the label is the entire
 * data boundary, and it must never be applied to facts nobody has classified.
 */
function buildSyntheticOperationalEnvelope(input) {
    return {
        schemaVersion: 1,
        classification: "SYNTHETIC",
        synthetic: true,
        source: "eos-work-order-readiness",
        domain: "WORK_ORDER",
        subjectReference: input.subjectReference,
        observedFact: input.observedFact,
        deterministicInterpretation: input.deterministicInterpretation,
        deterministicBusinessConsequence: input.deterministicBusinessConsequence,
        evidence: input.evidence,
        allowedRecommendation: null,
        mode: "fast",
        maxOutputTokens: 512,
    };
}
/**
 * `fetch` with a deadline and no redirect-following.
 *
 * Both matter on this route specifically. Cloudflare Access answers an unauthenticated request with
 * a 302 to its login page; followed, that returns HTML with a 200 status, and the provider would
 * try to read an interpretation out of a sign-in form. Refusing redirects turns that into the
 * transport failure it actually is.
 */
function boundedFetch(fetchImpl = fetch, timeoutMs = exports.KEYSTONE_INTERPRETATION_TIMEOUT_MS) {
    return ((input, init) => fetchImpl(input, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) }));
}
/**
 * Assemble governed facts, ask the private model to interpret them, and let the verifier decide
 * whether anything may be said.
 *
 * The ORDER is the safety property. The environment gate runs before any fact is read and long
 * before any network call, so an environment that is not classified synthetic performs zero
 * Keystone requests -- the refusal is not a late filter on a response that has already left.
 */
async function interpretWorkOrderReadiness(input, deps) {
    if (!deps.syntheticInterpretationPermitted()) {
        return refuse("INTERPRETATION_NOT_PERMITTED_HERE");
    }
    const provider = deps.resolveProvider();
    if (!provider)
        return refuse("PROVIDER_NOT_CONFIGURED");
    // Authorization and fact assembly are this module's own, unchanged and unbypassed.
    const context = await assembleWorkOrderReadinessContext(input, deps.context);
    const interpretationInput = buildWorkOrderInterpretationInput(context);
    let candidate;
    try {
        candidate = await provider.interpret(buildSyntheticOperationalEnvelope(interpretationInput));
    }
    catch (error) {
        // Nothing from the transport reaches the caller. A gateway status line, an Access denial and a
        // DNS failure are all the same answer here: no interpretation. Anything more specific is a
        // description of our credentials and network position, told to someone who asked about parts.
        if (error instanceof operationalProvider_1.OperationalAIError) {
            return refuse(error.code === "AI_NOT_CONFIGURED" || error.code === "AI_REMOTE_INGRESS_DENIED"
                ? "PROVIDER_NOT_CONFIGURED"
                : "PROVIDER_UNAVAILABLE");
        }
        return refuse("PROVIDER_UNAVAILABLE");
    }
    // The last word. Everything above assembled inputs; nothing above decided the model may be
    // believed.
    return (0, workOrderModelInterpretation_1.verifyWorkOrderModelInterpretation)(interpretationInput, candidate);
}
/** Whether THIS runtime may interpret, from the platform-set project identity. Never caller-supplied. */
function runtimeSyntheticInterpretationPermitted() {
    const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
    return (0, environmentCapabilityOverrides_1.resolveSyntheticOperationalInterpretation)(environmentCapabilityOverrides_1.ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
}
exports.interpretWorkOrderReadinessContext = (0, https_1.onCall)({ region: "us-central1", secrets: KEYSTONE_INTERPRETATION_SECRETS }, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const workOrderId = cleanString(request.data?.workOrderId);
    if (!workOrderId)
        throw new https_1.HttpsError("invalid-argument", "workOrderId is required.");
    try {
        const db = (0, firestore_1.getFirestore)();
        return await interpretWorkOrderReadiness({ principalUid: request.auth.uid, workOrderId }, {
            context: realDependencies(db),
            syntheticInterpretationPermitted: runtimeSyntheticInterpretationPermitted,
            resolveProvider: () => (0, operationalProvider_1.operationalProviderFromEnvironment)(process.env, boundedFetch()),
        });
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        if (err instanceof types_1.AIError && err.code === "AI_CAPABILITY_DENIED") {
            throw new https_1.HttpsError("permission-denied", "You are not authorized to read this Work Order.");
        }
        // Logged without the error's own message: a transport failure's text can carry the endpoint,
        // and this project's logs are not where a private gateway address should first appear.
        console.error("[interpretWorkOrderReadinessContext] failed", {
            name: err instanceof Error ? err.name : typeof err,
        });
        throw new https_1.HttpsError("internal", "The interpretation could not be produced.");
    }
});
//# sourceMappingURL=workOrderReadinessContext.js.map