import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getCallerContext } from "../callerContext";
import {
  ENVIRONMENT_ACTIVATION_REGISTRY,
  resolveSyntheticOperationalInterpretation,
} from "../access/environmentCapabilityOverrides";
import {
  OperationalAIError,
  operationalProviderFromEnvironment,
  type OperationalInterpretationRequest,
  type OperationalProvider,
} from "./operationalProvider";
import {
  verifyWorkOrderModelInterpretation,
  type WorkOrderInterpretationEvidence,
  type WorkOrderInterpretationInput,
  type WorkOrderInterpretationVerification,
} from "./workOrderModelInterpretation";
import { WORK_ORDERS_COLLECTION, INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import {
  INVENTORY_BALANCE_READ_CAPABILITY,
  type PartBalanceProjection,
} from "../inventory/partBalanceReadService";
import { readPartBalances } from "../inventory/partBalanceBatchReadService";
import { buildFirestorePartRepository } from "../partMaster/partMasterRepository";
import { isSerialTracked } from "../partMaster/controlTypeTrackingMode";
import type { PartId } from "../partMaster/types";
import { openWorkOrderReserved } from "../fulfillment/fulfillmentAvailability";
import {
  assertWorkOrderContextReadable,
  resolveWorkOrderContextAccess,
  sanitizeWorkOrderFacts,
  type WorkOrderContextActor,
} from "./workOrderContext";
import { strongestReadinessProcurementStatus } from "./workOrderReadinessSources";
import { AIError } from "./types";

const REORDER_REQUESTS_COLLECTION = "reorder_requests";

export interface WorkOrderReadinessSourceLine {
  readonly name: string | null;
  readonly sku: string | null;
  readonly qtyPlanned: number;
  readonly qtyUsed: number;
  readonly reservedForJob: number;
  readonly warehouse: Readonly<{ status: "KNOWN"; available: number } | { status: "UNKNOWN" } | { status: "UNAVAILABLE" }>;
  readonly truck: Readonly<{ status: "UNAVAILABLE" }>;
  readonly procurement: Readonly<{ status: "PENDING" | "ORDERED" | "RECEIVED" | "NONE" }>;
}

export interface WorkOrderReadinessContextResult {
  readonly schemaVersion: 1;
  readonly subject: ReturnType<typeof sanitizeWorkOrderFacts>["subject"];
  readonly plannedParts: readonly WorkOrderReadinessSourceLine[];
  readonly capabilities: Readonly<{
    warehouse: boolean;
    truckInventory: false;
    purchasing: boolean;
    // Mirrors ONLY the existing READY reorder-create branch in firestore.rules. It creates no
    // capability and grants nothing; the eventual client write is still independently rechecked.
    requestReorder: boolean;
  }>;
  readonly limitations: readonly string[];
}

interface PlannedInternalLine {
  readonly partId: string | null;
  readonly name: string | null;
  readonly sku: string | null;
  readonly qtyPlanned: number;
  readonly qtyUsed: number;
}

export interface WorkOrderReadinessContextDependencies {
  readonly loadCaller: (uid: string) => Promise<{ role: string | null; technicianId: string | null }>;
  readonly loadWorkOrder: (workOrderId: string) => Promise<Record<string, unknown> | null>;
  readonly resolveInventoryBalanceAccess: (uid: string) => Promise<boolean>;
  readonly loadBalances: (partIds: readonly string[]) => Promise<readonly PartBalanceProjection[]>;
  readonly loadReservationRows: (workOrderId: string) => Promise<readonly Record<string, unknown>[]>;
  readonly loadReorderRows: (workOrderId: string) => Promise<readonly Record<string, unknown>[]>;
}

export async function assembleWorkOrderReadinessContext(
  input: { principalUid: string; workOrderId: string },
  deps: WorkOrderReadinessContextDependencies,
): Promise<WorkOrderReadinessContextResult> {
  const caller = await deps.loadCaller(input.principalUid);
  const workOrder = await deps.loadWorkOrder(input.workOrderId);
  if (!workOrder) throw new HttpsError("not-found", "No such work order.");

  const actor: WorkOrderContextActor = {
    authenticated: true,
    role: caller.role,
    technicianId: caller.technicianId,
  };
  assertWorkOrderContextReadable(actor, {
    assignedTechId: typeof workOrder.assignedTechId === "string" ? workOrder.assignedTechId : null,
  });

  let inventoryBalanceReadable = false;
  try {
    inventoryBalanceReadable = await deps.resolveInventoryBalanceAccess(input.principalUid);
  } catch {
    inventoryBalanceReadable = false;
  }

  const access = resolveWorkOrderContextAccess({
    actor,
    workOrder: {
      assignedTechId: typeof workOrder.assignedTechId === "string" ? workOrder.assignedTechId : null,
    },
    capabilityDecisions: {
      [INVENTORY_BALANCE_READ_CAPABILITY]: inventoryBalanceReadable,
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
    .filter((value): value is string => typeof value === "string" && value.length > 0))];

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

  const plannedParts = internalPlan.map((line): WorkOrderReadinessSourceLine => {
    const balance = line.partId ? balanceByPart.get(line.partId) : undefined;
    const reservation = line.partId
      ? openWorkOrderReserved((reservationsByPart.get(line.partId) ?? []) as Array<{ type: string; quantity: number; workOrderId?: string }>)
      : 0;
    const procurement = line.partId && procurementReadable
      ? strongestReadinessProcurementStatus((reordersByPart.get(line.partId) ?? []).map((row) => row.status))
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
      truck: Object.freeze({ status: "UNAVAILABLE" as const }),
      procurement: Object.freeze({ status: procurement }),
    });
  });

  const facts = sanitizeWorkOrderFacts(workOrder);
  const limitations = [
    ...access.limitations,
    ...(procurementReadable ? [] : ["PROCUREMENT_READ_NOT_AUTHORIZED"]),
    "TRUCK_INVENTORY_UNAVAILABLE",
  ];

  return Object.freeze({
    schemaVersion: 1 as const,
    subject: facts.subject,
    plannedParts: Object.freeze(plannedParts),
    capabilities: Object.freeze({
      warehouse: access.inventoryBalanceReadable,
      truckInventory: false as const,
      purchasing: procurementReadable,
      requestReorder: requestReorderEligible,
    }),
    limitations: Object.freeze(limitations),
  });
}

function plannedLines(workOrder: Record<string, unknown>): PlannedInternalLine[] {
  const snapshot = Array.isArray(workOrder.inventorySnapshot)
    ? workOrder.inventorySnapshot as Array<Record<string, unknown>>
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

function groupRowsByPartId(rows: readonly Record<string, unknown>[]) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const partId = cleanString(row.partId);
    if (!partId) continue;
    const current = grouped.get(partId) ?? [];
    current.push(row);
    grouped.set(partId, current);
  }
  return grouped;
}

function warehouseDimension(balance: PartBalanceProjection | undefined, enabled: boolean) {
  if (!enabled) return Object.freeze({ status: "UNAVAILABLE" as const });
  if (!balance || balance.available.state !== "KNOWN" || typeof balance.available.value !== "number") {
    return Object.freeze({ status: "UNKNOWN" as const });
  }
  return Object.freeze({ status: "KNOWN" as const, available: Math.max(0, balance.available.value) });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function realDependencies(db: Firestore): WorkOrderReadinessContextDependencies {
  return {
    loadCaller: (uid) => getCallerContext(uid),
    loadWorkOrder: async (workOrderId) => {
      const snap = await db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId).get();
      return snap.exists ? (snap.data() as Record<string, unknown>) : null;
    },
    resolveInventoryBalanceAccess: async (uid) => {
      const { decisions } = await resolveEffectiveAccess({
        principalUid: uid,
        permissionIds: [INVENTORY_BALANCE_READ_CAPABILITY],
      }, { db });
      return decisions[INVENTORY_BALANCE_READ_CAPABILITY] === true;
    },
    loadBalances: async (partIds) => {
      const repository = buildFirestorePartRepository(db);
      const stored = await Promise.all(partIds.map((id) => repository.getById(null, id as PartId)));
      const serialTrackedByPartId = new Map<string, boolean>(
        stored
          .map((record, i) => record === null ? null : [partIds[i], isSerialTracked(record.part.controlType)] as const)
          .filter((entry): entry is readonly [string, boolean] => entry !== null),
      );
      return readPartBalances(db, partIds, serialTrackedByPartId);
    },
    loadReservationRows: async (workOrderId) => {
      const snap = await db.collection(INVENTORY_TRANSACTIONS_COLLECTION)
        .where("workOrderId", "==", workOrderId)
        .get();
      return snap.docs.map((doc) => doc.data() as Record<string, unknown>);
    },
    loadReorderRows: async (workOrderId) => {
      const snap = await db.collection(REORDER_REQUESTS_COLLECTION)
        .where("workOrderId", "==", workOrderId)
        .get();
      return snap.docs.map((doc) => doc.data() as Record<string, unknown>);
    },
  };
}

export const getWorkOrderReadinessContext = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const workOrderId = cleanString((request.data as { workOrderId?: unknown } | null)?.workOrderId);
  if (!workOrderId) throw new HttpsError("invalid-argument", "workOrderId is required.");

  try {
    const db = getFirestore();
    return await assembleWorkOrderReadinessContext(
      { principalUid: request.auth.uid, workOrderId },
      realDependencies(db),
    );
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof AIError && err.code === "AI_CAPABILITY_DENIED") {
      throw new HttpsError("permission-denied", "You are not authorized to read this Work Order.");
    }
    console.error("[getWorkOrderReadinessContext] failed", err);
    throw new HttpsError("internal", "The readiness context could not be assembled.");
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
 */
const KEYSTONE_INTERPRETATION_SECRETS = [
  defineSecret("KEYSTONE_GATEWAY_URL"),
  defineSecret("KEYSTONE_GATEWAY_API_KEY"),
  defineSecret("KEYSTONE_GATEWAY_TENANT_ID"),
  defineSecret("KEYSTONE_ACCESS_CLIENT_ID"),
  defineSecret("KEYSTONE_ACCESS_CLIENT_SECRET"),
];

/** A model call is an interactive latency budget, not a batch job. */
export const KEYSTONE_INTERPRETATION_TIMEOUT_MS = 20_000;

/** Refusals EOS itself owns. Model-owned refusals keep their existing verifier reasons. */
export type WorkOrderInterpretationRefusalReason =
  /** This environment's operational evidence is not governed as synthetic. */
  | "INTERPRETATION_NOT_PERMITTED_HERE"
  /** No gateway configuration on this runtime, or it is missing its Access credentials. */
  | "PROVIDER_NOT_CONFIGURED"
  /** The gateway could not be reached, refused the request, or answered outside its contract. */
  | "PROVIDER_UNAVAILABLE";

export interface RefusedWorkOrderInterpretation {
  readonly speak: false;
  readonly origin: "EOS";
  readonly reason: WorkOrderInterpretationRefusalReason;
}

export type WorkOrderInterpretationOutcome =
  | WorkOrderInterpretationVerification
  | RefusedWorkOrderInterpretation;

function refuse(reason: WorkOrderInterpretationRefusalReason): RefusedWorkOrderInterpretation {
  return { speak: false, origin: "EOS", reason };
}

function outstandingQuantity(line: WorkOrderReadinessSourceLine): number {
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
export function describeReadinessObservation(
  plannedParts: readonly WorkOrderReadinessSourceLine[],
): string {
  const total = plannedParts.length;
  if (total === 0) return "EOS assembled no planned parts for this work order.";

  let below = 0;
  let unknown = 0;
  for (const line of plannedParts) {
    if (line.warehouse.status !== "KNOWN") unknown += 1;
    else if (line.warehouse.available < outstandingQuantity(line)) below += 1;
  }

  const lines = `${total} planned part ${total === 1 ? "line" : "lines"}`;
  if (unknown === total) return `EOS has no warehouse availability figure for any of ${lines}.`;
  if (below === 0 && unknown === 0) {
    return `Warehouse availability covers the outstanding quantity on all ${lines}.`;
  }
  const observed: string[] = [];
  if (below > 0) observed.push(`${below} below the outstanding quantity`);
  if (unknown > 0) observed.push(`${unknown} with no availability figure`);
  return `Of ${lines}, ${observed.join(" and ")}.`;
}

/**
 * Project the governed context into the interpretation contract.
 *
 * PURE, and an allowlist by construction: every field is written out by name from the already
 * sanitized readiness context. Nothing is spread, so a field added to the context later cannot
 * reach the model by inheritance -- someone has to come here and decide that it may.
 */
export function buildWorkOrderInterpretationInput(
  context: WorkOrderReadinessContextResult,
): WorkOrderInterpretationInput {
  const evidence: WorkOrderInterpretationEvidence[] = context.plannedParts.map((line, index) => {
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
function buildSyntheticOperationalEnvelope(
  input: WorkOrderInterpretationInput,
): OperationalInterpretationRequest {
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
export function boundedFetch(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = KEYSTONE_INTERPRETATION_TIMEOUT_MS,
): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetchImpl(input, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) })
  ) as typeof fetch;
}

export interface WorkOrderInterpretationDependencies {
  readonly context: WorkOrderReadinessContextDependencies;
  /** Whether this environment may send operational evidence to the model. */
  readonly syntheticInterpretationPermitted: () => boolean;
  /** Null when the runtime carries no usable gateway configuration. */
  readonly resolveProvider: () => OperationalProvider | null;
}

/**
 * Assemble governed facts, ask the private model to interpret them, and let the verifier decide
 * whether anything may be said.
 *
 * The ORDER is the safety property. The environment gate runs before any fact is read and long
 * before any network call, so an environment that is not classified synthetic performs zero
 * Keystone requests -- the refusal is not a late filter on a response that has already left.
 */
export async function interpretWorkOrderReadiness(
  input: { principalUid: string; workOrderId: string },
  deps: WorkOrderInterpretationDependencies,
): Promise<WorkOrderInterpretationOutcome> {
  if (!deps.syntheticInterpretationPermitted()) {
    return refuse("INTERPRETATION_NOT_PERMITTED_HERE");
  }

  const provider = deps.resolveProvider();
  if (!provider) return refuse("PROVIDER_NOT_CONFIGURED");

  // Authorization and fact assembly are this module's own, unchanged and unbypassed.
  const context = await assembleWorkOrderReadinessContext(input, deps.context);
  const interpretationInput = buildWorkOrderInterpretationInput(context);

  let candidate: unknown;
  try {
    candidate = await provider.interpret(buildSyntheticOperationalEnvelope(interpretationInput));
  } catch (error) {
    // Nothing from the transport reaches the caller. A gateway status line, an Access denial and a
    // DNS failure are all the same answer here: no interpretation. Anything more specific is a
    // description of our credentials and network position, told to someone who asked about parts.
    if (error instanceof OperationalAIError) {
      return refuse(
        error.code === "AI_NOT_CONFIGURED" || error.code === "AI_REMOTE_INGRESS_DENIED"
          ? "PROVIDER_NOT_CONFIGURED"
          : "PROVIDER_UNAVAILABLE",
      );
    }
    return refuse("PROVIDER_UNAVAILABLE");
  }

  // The last word. Everything above assembled inputs; nothing above decided the model may be
  // believed.
  return verifyWorkOrderModelInterpretation(interpretationInput, candidate);
}

/** Whether THIS runtime may interpret, from the platform-set project identity. Never caller-supplied. */
export function runtimeSyntheticInterpretationPermitted(): boolean {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
  return resolveSyntheticOperationalInterpretation(ENVIRONMENT_ACTIVATION_REGISTRY, projectId);
}

export const interpretWorkOrderReadinessContext = onCall(
  { region: "us-central1", secrets: KEYSTONE_INTERPRETATION_SECRETS },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
    const workOrderId = cleanString((request.data as { workOrderId?: unknown } | null)?.workOrderId);
    if (!workOrderId) throw new HttpsError("invalid-argument", "workOrderId is required.");

    try {
      const db = getFirestore();
      return await interpretWorkOrderReadiness(
        { principalUid: request.auth.uid, workOrderId },
        {
          context: realDependencies(db),
          syntheticInterpretationPermitted: runtimeSyntheticInterpretationPermitted,
          resolveProvider: () => operationalProviderFromEnvironment(process.env, boundedFetch()),
        },
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if (err instanceof AIError && err.code === "AI_CAPABILITY_DENIED") {
        throw new HttpsError("permission-denied", "You are not authorized to read this Work Order.");
      }
      // Logged without the error's own message: a transport failure's text can carry the endpoint,
      // and this project's logs are not where a private gateway address should first appear.
      console.error("[interpretWorkOrderReadinessContext] failed", {
        name: err instanceof Error ? err.name : typeof err,
      });
      throw new HttpsError("internal", "The interpretation could not be produced.");
    }
  },
);
