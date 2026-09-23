// MANUFACTURER MIGRATION -- SNAPSHOT, DRY RUN, COPY ONCE, VERIFY.
//
// ════════════════════ THE SOURCE IS EMPTY, AND THAT IS WHY THIS EXISTS ════════════════════
//
// Measured in eos-platform-sandbox: the `manufacturers` collection holds ZERO documents, while 48
// equipment_models carry a manufacturerId and 288 equipment records carry a free-text manufacturer
// name. So this tooling will copy nothing today. It is built anyway, because the environment that
// has real manufacturers is not one this workstation may read, and a copy into a governed authority
// must not be the first time anybody writes the checks.
//
// ════════════════════ PURE CORE, INJECTED READERS ════════════════════
//
// Nothing here imports firebase-admin or pg. The source reader and the target reader are passed in,
// so the classification can be tested without either database, and so this module cannot become a
// runtime authorization path by accident.

/** One source document, already flattened by the caller's reader. */
export interface SourceManufacturer {
  readonly id: string;
  readonly name: unknown;
  readonly status: unknown;
  readonly normalizedName?: unknown;
}

export interface TargetManufacturer {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export const RECORD_DISPOSITIONS = Object.freeze([
  "COPYABLE", "ALREADY_PRESENT_EQUIVALENT", "CONFLICT", "BLOCKED",
] as const);
export type RecordDisposition = (typeof RECORD_DISPOSITIONS)[number];

/** Why a record cannot be copied. Each is a FACT about the record, never a guess about intent. */
export const BLOCKER_KINDS = Object.freeze([
  "NAME_MISSING", "STATUS_UNKNOWN", "ID_MISSING",
] as const);
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

const STATUSES = new Set(["ACTIVE", "INACTIVE"]);

/** The source's own normalization, reproduced exactly (partMasterRepository.manufacturerToFirestore). */
export const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ").toUpperCase();

export interface ClassifiedRecord {
  readonly id: string;
  readonly disposition: RecordDisposition;
  readonly blockers: readonly BlockerKind[];
  readonly target?: TargetManufacturer;
}

export function classifyRecord(
  source: SourceManufacturer,
  existing: TargetManufacturer | undefined,
): ClassifiedRecord {
  const blockers: BlockerKind[] = [];
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id) blockers.push("ID_MISSING");
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) blockers.push("NAME_MISSING");
  const status = typeof source.status === "string" ? source.status : "";
  if (!STATUSES.has(status)) blockers.push("STATUS_UNKNOWN");
  if (blockers.length > 0) {
    return Object.freeze({ id, disposition: "BLOCKED" as const, blockers: Object.freeze(blockers) });
  }
  const target: TargetManufacturer = Object.freeze({ id, name, status });
  if (existing) {
    // EQUIVALENT means every governed field agrees. A target row that differs is a CONFLICT and is
    // never overwritten -- somebody changed it after the last copy, and silently winning would
    // destroy that edit.
    const same = existing.name === name && existing.status === status;
    return Object.freeze({
      id, disposition: same ? "ALREADY_PRESENT_EQUIVALENT" as const : "CONFLICT" as const,
      blockers: Object.freeze([]), target,
    });
  }
  return Object.freeze({ id, disposition: "COPYABLE" as const, blockers: Object.freeze([]), target });
}

// ════════════════════ SNAPSHOT ════════════════════

export interface Snapshot {
  readonly sourceProject: string;
  readonly sourceCollection: string;
  readonly recordCount: number;
  readonly checksum: string;
  readonly capturedAt: string;
  readonly records: readonly SourceManufacturer[];
}

/**
 * A deterministic checksum over the governed fields, id-ordered.
 *
 * Order-independent by construction, because a Firestore listing order is not a promise. Only the
 * fields a copy actually writes are hashed: a change to some field this migration ignores must not
 * read as drift and block an operator for no reason.
 */
export function snapshotChecksum(records: readonly SourceManufacturer[], hash: (s: string) => string): string {
  const canonical = [...records]
    .map((r) => ({ id: String(r.id ?? ""), name: String(r.name ?? ""), status: String(r.status ?? "") }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => `${r.id}\u0000${r.name}\u0000${r.status}`)
    .join("\u0001");
  return hash(canonical);
}

export function buildSnapshot(input: {
  readonly sourceProject: string;
  readonly sourceCollection: string;
  readonly records: readonly SourceManufacturer[];
  readonly now: string;
  readonly hash: (s: string) => string;
}): Snapshot {
  return Object.freeze({
    sourceProject: input.sourceProject,
    sourceCollection: input.sourceCollection,
    recordCount: input.records.length,
    checksum: snapshotChecksum(input.records, input.hash),
    capturedAt: input.now,
    records: Object.freeze([...input.records]),
  });
}

// ════════════════════ DRY RUN ════════════════════

export interface DryRunReport {
  readonly snapshot: Pick<Snapshot, "sourceProject" | "sourceCollection" | "recordCount" | "checksum" | "capturedAt">;
  readonly rows: readonly ClassifiedRecord[];
  readonly copyable: number;
  readonly alreadyPresentEquivalent: number;
  readonly conflict: number;
  readonly blocked: number;
  /** Data-quality findings that do NOT block a copy but an operator must see. */
  readonly duplicateNameGroups: readonly (readonly string[])[];
  readonly caseOnlyDuplicateGroups: readonly (readonly string[])[];
  readonly applyable: boolean;
}

export function runDryRun(
  snapshot: Snapshot,
  target: readonly TargetManufacturer[],
): DryRunReport {
  const byId = new Map(target.map((t) => [t.id, t]));
  const rows = snapshot.records.map((r) => classifyRecord(r, byId.get(String(r.id ?? "").trim())));
  const count = (d: RecordDisposition) => rows.filter((r) => r.disposition === d).length;

  // DUPLICATES ARE REPORTED, NEVER MERGED. Two manufacturers with the same name may be two real
  // companies, and merging them would destroy a distinction the business made.
  const group = (key: (r: SourceManufacturer) => string) => {
    const m = new Map<string, string[]>();
    for (const r of snapshot.records) {
      const k = key(r);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(String(r.id));
    }
    return Object.freeze([...m.values()].filter((ids) => ids.length > 1).map((ids) => Object.freeze(ids.sort())));
  };
  const exactDuplicates = group((r) => (typeof r.name === "string" ? r.name : ""));
  const normalizedDuplicates = group((r) => (typeof r.name === "string" && r.name.trim() ? normalizeName(r.name) : ""));
  const caseOnly = normalizedDuplicates.filter(
    (ids) => !exactDuplicates.some((e) => e.length === ids.length && e.every((x, i) => x === ids[i])));

  const conflict = count("CONFLICT");
  const blocked = count("BLOCKED");
  return Object.freeze({
    snapshot: Object.freeze({
      sourceProject: snapshot.sourceProject, sourceCollection: snapshot.sourceCollection,
      recordCount: snapshot.recordCount, checksum: snapshot.checksum, capturedAt: snapshot.capturedAt,
    }),
    rows: Object.freeze(rows),
    copyable: count("COPYABLE"),
    alreadyPresentEquivalent: count("ALREADY_PRESENT_EQUIVALENT"),
    conflict, blocked,
    duplicateNameGroups: exactDuplicates,
    caseOnlyDuplicateGroups: Object.freeze(caseOnly),
    // A CONFLICT or a BLOCKED record stops the whole run. Copying "the good ones" leaves the target
    // half-migrated and the operator with no single fact about what happened.
    applyable: conflict === 0 && blocked === 0,
  });
}

// ════════════════════ COPY ONCE ════════════════════

export class ManufacturerCopyError extends Error {
  constructor(readonly code: string, message: string) {
    // The CODE is in the message deliberately: it is what an operator sees in a log, and a caller
    // matching on it is then matching the same string a human reads.
    super(`${code}: ${message}`);
    this.name = "ManufacturerCopyError";
  }
}

export interface CopyPlan {
  readonly checksum: string;
  readonly inserts: readonly TargetManufacturer[];
}

/**
 * Build the plan, refusing anything that makes a copy unsafe.
 *
 * DRIFT REFUSAL is the point: the plan is bound to the snapshot checksum the DRY RUN was reviewed
 * against, and a re-read of the source that no longer matches means the reviewed evidence describes
 * a different collection. Replay-safe: an ALREADY_PRESENT_EQUIVALENT record is simply not inserted
 * again, so running COPY twice writes nothing the second time.
 */
export function buildCopyPlan(
  snapshot: Snapshot,
  target: readonly TargetManufacturer[],
  reviewedChecksum: string,
): CopyPlan {
  if (snapshot.checksum !== reviewedChecksum) {
    throw new ManufacturerCopyError("SOURCE_CHECKSUM_DRIFT",
      "the source no longer matches the reviewed snapshot; re-run SNAPSHOT and DRY RUN");
  }
  const report = runDryRun(snapshot, target);
  if (report.conflict > 0) {
    throw new ManufacturerCopyError("TARGET_CONFLICT",
      `${report.conflict} target record(s) differ from the source and will never be overwritten`);
  }
  if (report.blocked > 0) {
    throw new ManufacturerCopyError("SOURCE_BLOCKED",
      `${report.blocked} source record(s) cannot be copied; fix them at the source`);
  }
  return Object.freeze({
    checksum: snapshot.checksum,
    inserts: Object.freeze(report.rows.filter((r) => r.disposition === "COPYABLE").map((r) => r.target!)),
  });
}

// ════════════════════ VERIFY ════════════════════

export interface VerifyReport {
  readonly checksum: string;
  readonly sourceCount: number;
  readonly targetCount: number;
  readonly missingInTarget: readonly string[];
  readonly differing: readonly string[];
  readonly extraInTarget: readonly string[];
  readonly pass: boolean;
}

/** READ-ONLY. Compares and reports; repairs nothing, ever. */
export function verifyCopy(snapshot: Snapshot, target: readonly TargetManufacturer[]): VerifyReport {
  const byId = new Map(target.map((t) => [t.id, t]));
  const missing: string[] = [];
  const differing: string[] = [];
  for (const r of snapshot.records) {
    const id = String(r.id ?? "").trim();
    const t = byId.get(id);
    if (!t) { missing.push(id); continue; }
    if (t.name !== String(r.name ?? "").trim() || t.status !== String(r.status ?? "")) differing.push(id);
  }
  const sourceIds = new Set(snapshot.records.map((r) => String(r.id ?? "").trim()));
  const extra = target.map((t) => t.id).filter((id) => !sourceIds.has(id));
  return Object.freeze({
    checksum: snapshot.checksum,
    sourceCount: snapshot.records.length,
    targetCount: target.length,
    missingInTarget: Object.freeze(missing.sort()),
    differing: Object.freeze(differing.sort()),
    extraInTarget: Object.freeze(extra.sort()),
    pass: missing.length === 0 && differing.length === 0 && extra.length === 0,
  });
}
