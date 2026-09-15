// The CATALOG SNAPSHOT -- the legacy Firestore `parts` and `equipment_models` documents, as a file, and the pure
// census / canonicalization the one-time copy runs on it (functions/scripts/catalogCutover.js).
//
// ════════════════════ WHY A FILE ════════════════════
//
// The copy tool never loads a Firebase module. The Firestore read is a separate, read-only export step
// (functions/scripts/exportCatalogSnapshot.js) that writes this file; census, copy and verify consume it. So the
// PostgreSQL side of the cutover is Firebase-free by construction, and the exact bytes that were copied are a
// durable, hashable artifact rather than a moment in a live collection.
//
// ════════════════════ THE FORMAT (version 1) ════════════════════
//
//   { "format": "EOS_CATALOG_SNAPSHOT", "version": 1,
//     "source": { "firebaseProjectId": "<project>", "exportedAt": "<ISO>" },
//     "parts":            [ { "id": "<document id>", "data": { ...document fields } }, ... ],
//     "equipmentModels":  [ { "id": "<document id>", "data": { ...document fields } }, ... ] }
//
// A Firestore Timestamp is encoded as { "$timestamp": { "seconds": <int>, "nanoseconds": <int 0..999999999> } }.
// Any other non-JSON Firestore value is refused at export.
//
// ════════════════════ WHAT "CANONICAL" MEANS ════════════════════
//
// Exactly what the Firestore repository adapters read back, because that is what every Firestore reader sees:
//   Part            partMasterRepository.ts#partFromFirestore -- data.partId === doc id, validatePart, readMeta
//   Equipment Model equipmentModelRepository.ts#modelFromFirestore -- data.equipmentModelId === doc id, canonical id,
//                   validateEquipmentModel, repository.ts#readMeta (updatedAt >= createdAt)
// A document either side refuses is INVALID here too and blocks the copy. Nothing is repaired or defaulted.
import { createHash } from "node:crypto";
import { validatePart } from "../partMaster/validation";
import { isCanonicalEquipmentModelId, validateEquipmentModel } from "../equipmentCompatibility/domain/equipmentModel";
import { type CanonicalEquipmentModel, type CanonicalPart, canonicalPartOf, EQUIPMENT_MODEL_FIELDS, PART_FIELDS } from "./catalogRows";

export const SNAPSHOT_FORMAT = "EOS_CATALOG_SNAPSHOT";
export const SNAPSHOT_VERSION = 1;
/** The marker certification-world records carry (functions/scripts/_releaseStateSnapshot.mjs MARKER_FIELD). */
export const CERTIFICATION_MARKER_FIELD = "certificationWorld";

/** The fields partToFirestore / modelToFirestore write. Everything else on a document is not master data. */
const PART_STORED_FIELDS = new Set([
  "partId", "internalPartNumber", "name", "description", "category", "status", "stockingUnit", "controlType", "stockingClass",
  "flags", "primaryManufacturerId", "primaryManufacturerPartNumber", "oemStatus", "wholeUnit", "equipmentModelId",
  "version", "createdAt", "createdBy", "updatedAt", "updatedBy",
]);
const MODEL_STORED_FIELDS = new Set([
  "equipmentModelId", "manufacturerId", "manufacturerName", "modelNumber", "displayName", "family", "subtype", "revision",
  "status", "sourceAuthority", "version", "createdAt", "createdBy", "updatedAt", "updatedBy",
]);
const MAX_ACTOR = 128;

export class CatalogSnapshotError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CatalogSnapshotError";
  }
}

export interface SnapshotDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

export interface CatalogSnapshot {
  readonly source: { readonly firebaseProjectId: string; readonly exportedAt: string };
  readonly parts: readonly SnapshotDocument[];
  readonly equipmentModels: readonly SnapshotDocument[];
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** Structural parse. Content problems are census findings, not parse errors. */
export function parseCatalogSnapshot(json: unknown): CatalogSnapshot {
  if (!isPlain(json) || json.format !== SNAPSHOT_FORMAT || json.version !== SNAPSHOT_VERSION) {
    throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", `not an ${SNAPSHOT_FORMAT} version ${SNAPSHOT_VERSION} file`);
  }
  const source = json.source;
  if (!isPlain(source) || typeof source.firebaseProjectId !== "string" || source.firebaseProjectId === "" || typeof source.exportedAt !== "string") {
    throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", "source.firebaseProjectId and source.exportedAt are required");
  }
  const docs = (name: "parts" | "equipmentModels"): SnapshotDocument[] => {
    const list = json[name];
    if (!Array.isArray(list)) throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name} must be a list`);
    return list.map((d, i) => {
      if (!isPlain(d) || typeof d.id !== "string" || !isPlain(d.data)) {
        throw new CatalogSnapshotError("SNAPSHOT_FORMAT_INVALID", `${name}[${i}] must be { id, data }`);
      }
      return { id: d.id, data: d.data };
    });
  };
  return { source: { firebaseProjectId: source.firebaseProjectId, exportedAt: source.exportedAt }, parts: docs("parts"), equipmentModels: docs("equipmentModels") };
}

interface TimestampValue { seconds: number; nanoseconds: number }

function readTimestamp(v: unknown): TimestampValue | null {
  if (!isPlain(v) || Object.keys(v).length !== 1 || !isPlain(v.$timestamp)) return null;
  const { seconds, nanoseconds } = v.$timestamp;
  if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanoseconds) || (nanoseconds as number) < 0 || (nanoseconds as number) > 999_999_999) return null;
  if (Object.keys(v.$timestamp).length !== 2) return null;
  return { seconds: seconds as number, nanoseconds: nanoseconds as number };
}

/** A timestamp as the canonical microsecond ISO string, and whether sub-microsecond digits were dropped. */
export function timestampToIsoMicros(t: TimestampValue): { iso: string; truncated: boolean } {
  const ms = t.seconds * 1000 + Math.floor(t.nanoseconds / 1_000_000);
  const base = new Date(ms).toISOString().slice(0, 19);
  const micros = String(Math.floor(t.nanoseconds / 1000)).padStart(6, "0");
  return { iso: `${base}.${micros}Z`, truncated: t.nanoseconds % 1000 !== 0 };
}

const compareTs = (a: TimestampValue, b: TimestampValue) => (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds);

interface MetaResult { version: number; createdAt: string; updatedAt: string; truncated: number }

function readMeta(data: Record<string, unknown>, requireOrder: boolean): MetaResult | string {
  const created = readTimestamp(data.createdAt), updated = readTimestamp(data.updatedAt);
  if (!Number.isInteger(data.version) || (data.version as number) < 1) return "META_VERSION_INVALID";
  if (created === null || updated === null) return "META_TIMESTAMP_INVALID";
  const actor = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= MAX_ACTOR;
  if (!actor(data.createdBy) || !actor(data.updatedBy)) return "META_ACTOR_INVALID";
  if (requireOrder && compareTs(updated, created) < 0) return "META_UPDATED_BEFORE_CREATED";
  const c = timestampToIsoMicros(created), u = timestampToIsoMicros(updated);
  return { version: data.version as number, createdAt: c.iso, updatedAt: u.iso, truncated: Number(c.truncated) + Number(u.truncated) };
}

export type Canonicalized<T> = { ok: true; record: T; truncatedTimestamps: number } | { ok: false; reason: string };

export function canonicalizePart(doc: SnapshotDocument): Canonicalized<CanonicalPart> {
  const d = doc.data;
  if (d.partId !== doc.id) return { ok: false, reason: "IDENTITY_MISMATCH" };
  const v = validatePart({
    partId: d.partId, internalPartNumber: d.internalPartNumber, name: d.name, description: d.description, category: d.category,
    status: d.status, stockingUnit: d.stockingUnit, controlType: d.controlType, stockingClass: d.stockingClass, flags: d.flags,
    manufacturerId: d.primaryManufacturerId, manufacturerPartNumber: d.primaryManufacturerPartNumber, oemStatus: d.oemStatus,
    wholeUnit: d.wholeUnit, equipmentModelId: d.equipmentModelId,
  });
  if (!v.valid) return { ok: false, reason: `DOMAIN_INVALID:${v.errors.map((e) => `${e.path}:${e.code}`).join(",")}` };
  // parsePartId trims; partFromFirestore compares the untrimmed doc id first, so a padded id never reaches here.
  if (v.value.partId !== doc.id) return { ok: false, reason: "IDENTITY_NOT_CANONICAL" };
  const meta = readMeta(d, false); // partMasterRepository.readMeta imposes no created/updated order
  if (typeof meta === "string") return { ok: false, reason: meta };
  return { ok: true, record: canonicalPartOf(v.value, meta), truncatedTimestamps: meta.truncated };
}

export function canonicalizeEquipmentModel(doc: SnapshotDocument): Canonicalized<CanonicalEquipmentModel> {
  const d = doc.data;
  if (d.equipmentModelId !== doc.id) return { ok: false, reason: "IDENTITY_MISMATCH" };
  if (!isCanonicalEquipmentModelId(doc.id)) return { ok: false, reason: "IDENTITY_NOT_CANONICAL" };
  const v = validateEquipmentModel({
    equipmentModelId: d.equipmentModelId, manufacturerId: d.manufacturerId, manufacturerName: d.manufacturerName,
    modelNumber: d.modelNumber, displayName: d.displayName, family: d.family, subtype: d.subtype, revision: d.revision,
    status: d.status, sourceAuthority: d.sourceAuthority, version: d.version,
  });
  if (!v.valid) return { ok: false, reason: `DOMAIN_INVALID:${v.reason}` };
  const meta = readMeta(d, true);
  if (typeof meta === "string") return { ok: false, reason: meta };
  const m = v.value;
  return {
    ok: true,
    truncatedTimestamps: meta.truncated,
    record: {
      id: m.equipmentModelId, manufacturerId: m.manufacturerId, manufacturerName: m.manufacturerName, modelNumber: m.modelNumber,
      displayName: m.displayName, family: m.family, subtype: m.subtype, revision: m.revision, status: m.status,
      sourceAuthority: m.sourceAuthority, version: meta.version, createdAt: meta.createdAt, updatedAt: meta.updatedAt,
    },
  };
}

export type CertificationDecision = "include" | "exclude" | null;

export interface CatalogFinding {
  readonly kind: "part" | "equipment_model";
  readonly id: string;
  readonly reason: string;
}

export interface CatalogCensus {
  readonly source: CatalogSnapshot["source"];
  readonly counts: { readonly parts: number; readonly equipmentModels: number };
  readonly certificationMarked: { readonly parts: number; readonly equipmentModels: number };
  readonly selected: { readonly parts: number; readonly equipmentModels: number };
  readonly invalid: readonly CatalogFinding[];
  readonly duplicateIdentities: readonly CatalogFinding[];
  readonly missingReferences: readonly CatalogFinding[];
  readonly statusDistribution: { readonly parts: Record<string, number>; readonly equipmentModels: Record<string, number> };
  /** Non-master fields present on documents (name -> document count). Reported, never copied. */
  readonly nonMasterFields: { readonly parts: Record<string, number>; readonly equipmentModels: Record<string, number> };
  readonly skuDisagreesWithPartId: readonly string[];
  readonly duplicateInternalPartNumbers: readonly { internalPartNumber: string; partIds: string[] }[];
  readonly crossKindIdentities: readonly string[];
  readonly truncatedTimestamps: number;
  readonly blockers: readonly string[];
  readonly copyReady: boolean;
  /** sha256 over the canonical selected records -- what a copy of this snapshot writes. */
  readonly canonicalDigest: string;
}

export interface CanonicalCatalog {
  readonly parts: readonly CanonicalPart[];
  readonly equipmentModels: readonly CanonicalEquipmentModel[];
}

const asciiSort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const countInto = (bag: Record<string, number>, key: string) => { bag[key] = (bag[key] ?? 0) + 1; };
const sortedBag = (bag: Record<string, number>) => Object.fromEntries(Object.entries(bag).sort(([a], [b]) => asciiSort(a, b)));

export function canonicalDigest(catalog: CanonicalCatalog): string {
  const h = createHash("sha256");
  for (const m of catalog.equipmentModels) h.update(JSON.stringify(EQUIPMENT_MODEL_FIELDS.map((f) => m[f])) + "\n");
  h.update("--parts--\n");
  for (const p of catalog.parts) h.update(JSON.stringify(PART_FIELDS.map((f) => p[f])) + "\n");
  return h.digest("hex");
}

/**
 * Census the snapshot and produce the canonical catalog a copy would write.
 *
 * `certification` decides certification-world-marked documents. When any exist and no decision is given, the census
 * still reports everything, but copyReady is false: whether synthetic certification fixtures become tenant catalog
 * records is not this tool's to guess.
 */
export function censusCatalogSnapshot(snapshot: CatalogSnapshot, certification: CertificationDecision = null): { census: CatalogCensus; catalog: CanonicalCatalog } {
  const invalid: CatalogFinding[] = [];
  const duplicates: CatalogFinding[] = [];
  const blockers: string[] = [];
  let truncated = 0;
  const marked = { parts: 0, equipmentModels: 0 };
  const nonMaster = { parts: {} as Record<string, number>, equipmentModels: {} as Record<string, number> };
  const statuses = { parts: {} as Record<string, number>, equipmentModels: {} as Record<string, number> };

  const select = <T extends { id: string }>(
    docs: readonly SnapshotDocument[], kind: CatalogFinding["kind"], storedFields: Set<string>, bag: "parts" | "equipmentModels",
    canonicalize: (d: SnapshotDocument) => Canonicalized<T>,
  ): T[] => {
    const seen = new Map<string, number>();
    for (const d of docs) seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
    for (const [id, n] of seen) if (n > 1) duplicates.push({ kind, id, reason: `DUPLICATE_CANONICAL_IDENTITY:${n}` });
    const out: T[] = [];
    for (const d of docs) {
      for (const f of Object.keys(d.data)) if (!storedFields.has(f)) countInto(nonMaster[bag], f);
      const isMarked = Object.prototype.hasOwnProperty.call(d.data, CERTIFICATION_MARKER_FIELD);
      if (isMarked) marked[bag] += 1;
      const c = canonicalize(d);
      if (!c.ok) { invalid.push({ kind, id: d.id, reason: c.reason }); continue; }
      countInto(statuses[bag], (c.record as unknown as { status: string }).status);
      truncated += c.truncatedTimestamps;
      if (isMarked && certification !== "include") continue;
      if ((seen.get(d.id) ?? 0) > 1) continue;
      out.push(c.record);
    }
    return out.sort((a, b) => asciiSort(a.id, b.id));
  };

  const equipmentModels = select(snapshot.equipmentModels, "equipment_model", MODEL_STORED_FIELDS, "equipmentModels", canonicalizeEquipmentModel);
  const parts = select(snapshot.parts, "part", PART_STORED_FIELDS, "parts", canonicalizePart);

  // A Part's equipment-model FK must resolve INSIDE what is being copied (assertEquipmentModelExists, at copy time).
  const modelIds = new Set(equipmentModels.map((m) => m.id));
  const missingReferences: CatalogFinding[] = parts
    .filter((p) => p.equipmentModelId !== null && !modelIds.has(p.equipmentModelId))
    .map((p) => ({ kind: "part", id: p.id, reason: `EQUIPMENT_MODEL_NOT_IN_SNAPSHOT:${p.equipmentModelId}` }));

  const skuDisagrees = snapshot.parts.filter((d) => d.data.sku !== undefined && d.data.sku !== d.id).map((d) => d.id).sort(asciiSort);
  const byIpn = new Map<string, string[]>();
  for (const p of parts) byIpn.set(p.internalPartNumber, [...(byIpn.get(p.internalPartNumber) ?? []), p.id]);
  const duplicateIpns = [...byIpn].filter(([, ids]) => ids.length > 1).map(([internalPartNumber, partIds]) => ({ internalPartNumber, partIds })).sort((a, b) => asciiSort(a.internalPartNumber, b.internalPartNumber));
  const partIds = new Set(snapshot.parts.map((d) => d.id));
  const crossKind = [...new Set(snapshot.equipmentModels.map((d) => d.id))].filter((id) => partIds.has(id)).sort(asciiSort);

  if (invalid.length > 0) blockers.push("INVALID_SOURCE_RECORDS");
  if (duplicates.length > 0) blockers.push("DUPLICATE_CANONICAL_IDENTITY");
  if (missingReferences.length > 0) blockers.push("MISSING_REFERENCES");
  if ((marked.parts > 0 || marked.equipmentModels > 0) && certification === null) blockers.push("CERTIFICATION_MARKED_RECORDS_REQUIRE_DECISION");

  const catalog: CanonicalCatalog = { parts, equipmentModels };
  const census: CatalogCensus = {
    source: snapshot.source,
    counts: { parts: snapshot.parts.length, equipmentModels: snapshot.equipmentModels.length },
    certificationMarked: marked,
    selected: { parts: parts.length, equipmentModels: equipmentModels.length },
    invalid: invalid.sort((a, b) => asciiSort(`${a.kind}|${a.id}`, `${b.kind}|${b.id}`)),
    duplicateIdentities: duplicates.sort((a, b) => asciiSort(`${a.kind}|${a.id}`, `${b.kind}|${b.id}`)),
    missingReferences,
    statusDistribution: { parts: sortedBag(statuses.parts), equipmentModels: sortedBag(statuses.equipmentModels) },
    nonMasterFields: { parts: sortedBag(nonMaster.parts), equipmentModels: sortedBag(nonMaster.equipmentModels) },
    skuDisagreesWithPartId: skuDisagrees,
    duplicateInternalPartNumbers: duplicateIpns,
    crossKindIdentities: crossKind,
    truncatedTimestamps: truncated,
    blockers,
    copyReady: blockers.length === 0,
    canonicalDigest: canonicalDigest(catalog),
  };
  return { census, catalog };
}
