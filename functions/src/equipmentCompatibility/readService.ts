// D5 (Read service) — governed, server-only, emulator-only READ model for Part↔Equipment compatibility.
// Authorized by the Owner's OD-1..OD-6 decision on the merged design package
// (docs/implementation-plans/equipment-compatibility-d5-read-service.md).
//
// SCOPE (repository/emulator only): bounded FORWARD (by partId) and REVERSE (by equipmentModelId) reads
// over the merged D4 authorities, a page/window-scoped fail-closed read model, a bounded evidence window
// with a per-request read-work budget, and the untrusted navigation cursor (readCursor.ts, posture B).
// It MUTATES NOTHING, emits NO audit event, opens NO client Rules path, activates NO capability, and is
// consumed only by an UNEXPORTED callable adapter (equipmentCompatibilityReadCallable.ts). The
// `equipment.compatibility.view` capability remains active:false; authorized-path tests inject a
// permission-resolution fixture. Any required composite index is proposed repository-only and stays
// undeployed until D10.
//
// KEY design properties enforced here:
//  - EXACT queries: `where(<keyField>,==,X).orderBy(FieldPath.documentId()).startAfter(afterId).limit(n+1)`
//    — one equality filter + order on __name__, so no composite index (design §5.4; proven executably in
//    the emulator suite).
//  - EVERY returned record is re-validated through the D4 deserializers (fail closed on drift) AND is
//    proven to belong to the bound query (defence in depth) — the cursor is not trusted for either.
//  - PAGE/WINDOW-SCOPED disposition + counts: they describe only THIS returned page, never the whole
//    collection. `AVAILABLE` asserts nothing about later pages; whole-query cleanliness is knowable only
//    at end of traversal (nextCursor === null with every page AVAILABLE/EMPTY) — the caller's conclusion.
//  - NO snapshot isolation is promised (Firestore pagination provides none across pages).
import type { Firestore } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";
import {
  EQUIPMENT_MODELS_COLLECTION,
  EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
  EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION,
  MalformedStoredRecordError,
  requireData,
} from "./repository";
import { compatibilityFromFirestore, sourceFromFirestore } from "./compatibilityRepository";
import { modelFromFirestore } from "./equipmentModelRepository";
import { AUTHORITY_RANK, isValidPartId } from "./domain/compatibility";
import { isCanonicalEquipmentModelId } from "./domain/equipmentModel";
import { InvalidInputError } from "./errors";
import { decodeCursor, encodeCursor, type ReadDirection } from "./readCursor";

export const READ_CAPABILITY = "equipment.compatibility.view";
export const DEFAULT_PAGE = 25;
export const MAX_PAGE = 50;
export const MAX_EVIDENCE_PER_RELATIONSHIP = 20;
export const MAX_EVIDENCE_READS_PER_REQUEST = 100;
const MAX_SERIAL_SUMMARY = 160;

export type PageDisposition = "AVAILABLE" | "DEGRADED" | "EMPTY" | "UNAVAILABLE" | "DENIED";
export type EvidenceStatus = "OK" | "INCOMPLETE" | "UNAVAILABLE";
export type ModelSummaryDisposition = "AVAILABLE" | "EMPTY" | "DEGRADED" | "UNAVAILABLE" | "DENIED";

export interface EquipmentModelSummary {
  readonly manufacturerName: string;
  readonly modelNumber: string;
  readonly displayName: string;
  readonly family: string | null;
  readonly subtype: string | null;
}

export interface CompatibilityEvidenceSummary {
  // "OK" only when the FULL evidence set was read within bounds. Per-relationship overflow (>
  // MAX_EVIDENCE_PER_RELATIONSHIP) or request-budget exhaustion => "INCOMPLETE"; a malformed evidence
  // doc => "UNAVAILABLE". Any non-OK status forces the item non-operational.
  readonly status: EvidenceStatus;
  readonly windowComplete: boolean;
  readonly strongestSupportingAuthority: string | null;
  // Authoritative TOTALS only when windowComplete === true; otherwise bounded-window counts.
  readonly boundedSupportsCount: number;
  readonly boundedContradictsCount: number;
  readonly windowSize: number;
}

export interface CompatibilityReadItem {
  readonly compatibilityId: string;
  readonly equipmentModelId: string;
  readonly partId: string;
  readonly model: EquipmentModelSummary | null; // null => model missing/malformed (fail-closed, not "none")
  readonly compatibilityType: string;
  readonly assembly: string | null;
  readonly installationPosition: string | null;
  readonly quantityRequired: number | null;
  readonly serialApplicabilitySummary: string; // DERIVED, bounded; never a raw serial list
  readonly verificationStatus: string;
  readonly applicabilityResolved: boolean;
  readonly confidenceLevel: string;
  readonly operational: boolean;
  readonly evidence: CompatibilityEvidenceSummary;
}

export interface CompatibilityWindowCounts {
  readonly returned: number;
  readonly operational: number;
  readonly excludedRejected: number;
  readonly malformedOmitted: number;
  readonly evidenceIncomplete: number;
}

export interface CompatibilityReadResponse {
  // WINDOW-SCOPED — describes ONLY the returned page, never the whole collection.
  readonly pageDisposition: PageDisposition;
  readonly items: readonly CompatibilityReadItem[];
  readonly nextCursor: string | null; // untrusted navigation cursor; null => last page
  readonly windowCounts: CompatibilityWindowCounts;
}

export interface ModelSummaryResponse {
  readonly disposition: ModelSummaryDisposition;
  readonly model: EquipmentModelSummary | null;
}

export interface ReadServiceDeps {
  readonly db: Firestore;
  // The #226 effective-permission seam, injected. A resolver that throws is a DENIAL, never an approval.
  // In production this resolves `equipment.compatibility.view`, which is active:false => DENY; authorized-
  // path emulator tests inject a fixture. D5 activates nothing.
  readonly resolvePermission: (input: { actorUid: string; capabilityId: string }) => boolean | Promise<boolean>;
  // Serial schemes are a governed registry the D2 validator needs; unresolved scheme => malformed record
  // (fail closed), never silently accepted.
  readonly serialSchemes?: Record<string, unknown>;
}

const ZERO_COUNTS: CompatibilityWindowCounts = { returned: 0, operational: 0, excludedRejected: 0, malformedOmitted: 0, evidenceIncomplete: 0 };
const denied = (): CompatibilityReadResponse => ({ pageDisposition: "DENIED", items: [], nextCursor: null, windowCounts: ZERO_COUNTS });
const unavailable = (): CompatibilityReadResponse => ({ pageDisposition: "UNAVAILABLE", items: [], nextCursor: null, windowCounts: ZERO_COUNTS });
const emptyPage = (): CompatibilityReadResponse => ({ pageDisposition: "EMPTY", items: [], nextCursor: null, windowCounts: ZERO_COUNTS });

async function isGranted(deps: ReadServiceDeps, actorUid: string): Promise<boolean> {
  try {
    return (await deps.resolvePermission({ actorUid, capabilityId: READ_CAPABILITY })) === true;
  } catch {
    return false; // a throwing resolver denies, never approves
  }
}

const clampLimit = (limit: unknown): number => {
  if (limit === undefined || limit === null) return DEFAULT_PAGE;
  if (typeof limit !== "number" || !Number.isInteger(limit)) throw new InvalidInputError("limit must be an integer");
  return Math.max(1, Math.min(MAX_PAGE, limit));
};

// DERIVED, bounded, and serial-safe: never emits a raw serial value or list.
function serialApplicabilitySummary(applicability: { kind: string; modelRevision: string | null }): string {
  let s: string;
  switch (applicability.kind) {
    case "ALL_SERIALS": s = "Applies to all serial numbers"; break;
    case "SERIAL_RANGE": s = "Applies to a specific serial range"; break;
    case "MODEL_REVISION": s = `Applies to model revision ${applicability.modelRevision ?? ""}`.trim(); break;
    default: s = "Serial applicability unresolved"; break; // UNRESOLVED
  }
  return s.length > MAX_SERIAL_SUMMARY ? s.slice(0, MAX_SERIAL_SUMMARY) : s;
}

// Point read of the model for display. Malformed/missing => model null (item non-operational). A genuine
// backend error is rethrown so the whole response becomes UNAVAILABLE (distinct from a data problem).
async function readModelForDisplay(deps: ReadServiceDeps, equipmentModelId: string): Promise<EquipmentModelSummary | null> {
  const snap = await deps.db.collection(EQUIPMENT_MODELS_COLLECTION).doc(equipmentModelId).get();
  if (!snap.exists) return null;
  try {
    const stored = modelFromFirestore(snap.id, requireData(snap.id, snap.data() as Record<string, unknown>));
    const m = stored.model;
    return { manufacturerName: m.manufacturerName, modelNumber: m.modelNumber, displayName: m.displayName, family: m.family, subtype: m.subtype };
  } catch (e) {
    if (e instanceof MalformedStoredRecordError) return null;
    throw e;
  }
}

interface EvidenceBudget { remaining: number }

// Bounded evidence read for ONE relationship, subject to a per-request read-work budget. D5 issues its
// OWN bounded query rather than D4's unlimited listByCompatibilityId.
async function readEvidenceSummary(deps: ReadServiceDeps, compatibilityId: string, budget: EvidenceBudget): Promise<CompatibilityEvidenceSummary> {
  const incomplete = (windowSize: number, supports: number, contradicts: number, strongest: string | null): CompatibilityEvidenceSummary =>
    ({ status: "INCOMPLETE", windowComplete: false, strongestSupportingAuthority: strongest, boundedSupportsCount: supports, boundedContradictsCount: contradicts, windowSize });

  if (budget.remaining <= 0) return incomplete(0, 0, 0, null); // request read-work budget exhausted

  // HARD budget: never request more than the request budget still allows. `cap` is at most the
  // per-relationship window+1 probe, and at most the remaining budget — so `snap.size <= cap <=
  // budget.remaining` and the running total of actual evidence reads can never exceed
  // MAX_EVIDENCE_READS_PER_REQUEST, nor can `budget.remaining` go negative.
  const cap = Math.min(MAX_EVIDENCE_PER_RELATIONSHIP + 1, budget.remaining);
  const snap = await deps.db
    .collection(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION)
    .where("compatibilityId", "==", compatibilityId)
    .orderBy(FieldPath.documentId())
    .limit(cap)
    .get();
  budget.remaining -= snap.size;

  // Two DISTINCT reasons completeness cannot be established, both => INCOMPLETE:
  //  - relationship OVERFLOW: a full window was allowed (cap === window+1) yet the +1 probe still returned;
  //  - BUDGET-limited truncation: the budget capped us at/under the window and we filled that cap, so more
  //    evidence MAY exist that we are not permitted to read.
  // A short result strictly below `cap` proves we read the whole set => completeness established (OK).
  const overflow = snap.size > MAX_EVIDENCE_PER_RELATIONSHIP;
  const budgetTruncated = cap <= MAX_EVIDENCE_PER_RELATIONSHIP && snap.size === cap;
  const docs = snap.docs.slice(0, MAX_EVIDENCE_PER_RELATIONSHIP);
  let supports = 0, contradicts = 0, malformed = false;
  let strongest: string | null = null, strongestRank = -1;
  for (const d of docs) {
    let claim: string, authorityType: string;
    try {
      const stored = sourceFromFirestore(d.id, requireData(d.id, d.data() as Record<string, unknown>));
      if (stored.source.compatibilityId !== compatibilityId) { malformed = true; continue; } // defence in depth
      claim = stored.source.observedClaim;
      authorityType = stored.source.authorityType;
    } catch (e) {
      if (e instanceof MalformedStoredRecordError) { malformed = true; continue; }
      throw e; // genuine backend error => outer catch => UNAVAILABLE
    }
    if (claim === "SUPPORTS") {
      supports += 1;
      const rank = AUTHORITY_RANK[authorityType] ?? -1;
      if (rank > strongestRank) { strongestRank = rank; strongest = authorityType; }
    } else if (claim === "CONTRADICTS") {
      contradicts += 1;
    }
  }
  if (malformed) return { status: "UNAVAILABLE", windowComplete: false, strongestSupportingAuthority: strongest, boundedSupportsCount: supports, boundedContradictsCount: contradicts, windowSize: docs.length };
  if (overflow || budgetTruncated) return incomplete(docs.length, supports, contradicts, strongest);
  return { status: "OK", windowComplete: true, strongestSupportingAuthority: strongest, boundedSupportsCount: supports, boundedContradictsCount: contradicts, windowSize: docs.length };
}

interface RelationshipReadArgs {
  actorUid: string;
  dir: ReadDirection;
  keyField: "partId" | "equipmentModelId";
  key: string;
  cursor?: string;
  limit?: number;
}

async function runRelationshipRead(deps: ReadServiceDeps, args: RelationshipReadArgs): Promise<CompatibilityReadResponse> {
  // Malformed-request validation FIRST — purely SYNTACTIC on caller-supplied input (key format, limit,
  // cursor shape). It reads no data, so it leaks nothing to an unauthorized caller, and it lets a
  // malformed request surface as invalid-argument rather than being masked by DENIED. A WELL-FORMED
  // request from an unauthorized caller still returns DENIED below (no data revealed).
  if (args.keyField === "partId") {
    if (!isValidPartId(args.key)) throw new InvalidInputError("partId is malformed");
  } else if (!isCanonicalEquipmentModelId(args.key)) {
    throw new InvalidInputError("equipmentModelId is malformed");
  }
  const pageLimit = clampLimit(args.limit);
  const afterId = args.cursor !== undefined ? decodeCursor(args.cursor, { dir: args.dir, key: args.key }).afterId : undefined;

  if (!(await isGranted(deps, args.actorUid))) return denied();

  try {
    let query = deps.db
      .collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION)
      .where(args.keyField, "==", args.key)
      .orderBy(FieldPath.documentId());
    if (afterId !== undefined) query = query.startAfter(afterId);
    const snap = await query.limit(pageLimit + 1).get();

    if (snap.empty) return emptyPage();

    const hasMore = snap.size > pageLimit;
    const pageDocs = snap.docs.slice(0, pageLimit);
    const nextCursor = hasMore ? encodeCursor({ dir: args.dir, key: args.key, afterId: pageDocs[pageDocs.length - 1].id }) : null;

    const budget: EvidenceBudget = { remaining: MAX_EVIDENCE_READS_PER_REQUEST };
    const items: CompatibilityReadItem[] = [];
    let excludedRejected = 0, malformedOmitted = 0, evidenceIncomplete = 0, degraded = false;

    for (const doc of pageDocs) {
      let c: any;
      try {
        c = compatibilityFromFirestore(doc.id, requireData(doc.id, doc.data() as Record<string, unknown>), { serialSchemes: deps.serialSchemes }).compatibility;
      } catch (e) {
        if (e instanceof MalformedStoredRecordError) { malformedOmitted += 1; degraded = true; continue; }
        throw e;
      }
      // Defence in depth: a doc returned by the bound query MUST actually carry the queried key.
      if (c[args.keyField] !== args.key) { malformedOmitted += 1; degraded = true; continue; }
      // REJECTED is excluded from results but COUNTED — never represented as "no records".
      if (c.verificationStatus === "REJECTED") { excludedRejected += 1; continue; }

      // Model and evidence are independent. Start the model lookup before the budgeted evidence read so the
      // two network round trips overlap; evidence remains sequential because it consumes the shared budget.
      const modelPromise = readModelForDisplay(deps, c.equipmentModelId);
      const evidence = await readEvidenceSummary(deps, c.compatibilityId, budget);
      const model = await modelPromise;
      if (model === null) degraded = true;
      if (evidence.status !== "OK") { evidenceIncomplete += 1; degraded = true; }
      const applicabilityResolved = c.applicability.kind !== "UNRESOLVED";
      const operational = c.verificationStatus === "VERIFIED" && applicabilityResolved && model !== null && evidence.status === "OK";

      items.push({
        compatibilityId: c.compatibilityId,
        equipmentModelId: c.equipmentModelId,
        partId: c.partId,
        model,
        compatibilityType: c.compatibilityType,
        assembly: c.assembly,
        installationPosition: c.installationPosition,
        quantityRequired: c.quantityRequired,
        serialApplicabilitySummary: serialApplicabilitySummary(c.applicability),
        verificationStatus: c.verificationStatus,
        applicabilityResolved,
        confidenceLevel: c.confidenceLevel,
        operational,
        evidence,
      });
    }

    const pageDisposition: PageDisposition = degraded ? "DEGRADED" : "AVAILABLE";
    return {
      pageDisposition,
      items,
      nextCursor,
      windowCounts: {
        returned: items.length,
        operational: items.filter((i) => i.operational).length,
        excludedRejected,
        malformedOmitted,
        evidenceIncomplete,
      },
    };
  } catch (e) {
    if (e instanceof InvalidInputError) throw e; // (defensive) — malformed request, not a backend failure
    return unavailable(); // genuine backend/read error, rendered distinctly from EMPTY
  }
}

// FORWARD: the compatibility relationships that cite a canonical Part.
export function readCompatibilityForPart(deps: ReadServiceDeps, input: { actorUid: string; partId: string; cursor?: string; limit?: number }): Promise<CompatibilityReadResponse> {
  return runRelationshipRead(deps, { actorUid: input.actorUid, dir: "forward", keyField: "partId", key: input.partId, cursor: input.cursor, limit: input.limit });
}

// REVERSE: the compatibility relationships that cite an Equipment Model.
export function readCompatibilityForModel(deps: ReadServiceDeps, input: { actorUid: string; equipmentModelId: string; cursor?: string; limit?: number }): Promise<CompatibilityReadResponse> {
  return runRelationshipRead(deps, { actorUid: input.actorUid, dir: "reverse", keyField: "equipmentModelId", key: input.equipmentModelId, cursor: input.cursor, limit: input.limit });
}

// Point read of a single Equipment Model's display summary.
export async function readModelSummary(deps: ReadServiceDeps, input: { actorUid: string; equipmentModelId: string }): Promise<ModelSummaryResponse> {
  if (!isCanonicalEquipmentModelId(input.equipmentModelId)) throw new InvalidInputError("equipmentModelId is malformed"); // syntactic, pre-auth
  if (!(await isGranted(deps, input.actorUid))) return { disposition: "DENIED", model: null };
  try {
    const snap = await deps.db.collection(EQUIPMENT_MODELS_COLLECTION).doc(input.equipmentModelId).get();
    if (!snap.exists) return { disposition: "EMPTY", model: null };
    let model: EquipmentModelSummary | null;
    try {
      const stored = modelFromFirestore(snap.id, requireData(snap.id, snap.data() as Record<string, unknown>));
      const m = stored.model;
      model = { manufacturerName: m.manufacturerName, modelNumber: m.modelNumber, displayName: m.displayName, family: m.family, subtype: m.subtype };
    } catch (e) {
      if (e instanceof MalformedStoredRecordError) return { disposition: "DEGRADED", model: null };
      throw e;
    }
    return { disposition: "AVAILABLE", model };
  } catch (e) {
    if (e instanceof InvalidInputError) throw e;
    return { disposition: "UNAVAILABLE", model: null };
  }
}
