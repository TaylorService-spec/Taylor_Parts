// THE REORDER MIGRATION EXCLUSION -- Controller ruling DQ-032 (2026-09-28).
//
// The eight SBX-SCN-001 Reorder records are repository-authored scenario fixtures, not legacy business records. The
// earlier plan retired them by DELETING them from Firestore; DQ-032 reverses that: the zero-new-Firebase-mutation
// direction wins, the Firestore source is left exactly as it is, and the COPY excludes them instead. They disappear
// with the final Firebase retirement.
//
// What this module guarantees, and what the cutover evidence therefore proves:
//
//   * EXACTLY THE DECLARED EIGHT. The manifest is derived from REORDER_SCENARIO_FIXTURES, the same declaration the
//     fixture tooling uses. An operator-supplied manifest is accepted only if it is byte-identical to the derived one
//     (and matches its .sha256 sidecar), so it cannot widen or narrow the exclusion.
//   * AN EXCLUDED ID MUST BE THE FIXTURE. A snapshot record occupying a declared id is excluded only when its facts
//     match the declaration (classifyCandidate: CONFIRMED_SYNTHETIC). A diverged or unmarked occupant REFUSES the whole
//     run -- it may be real data wearing a fixture's id, and excluding it would silently drop it.
//   * NOTHING ELSE IS EXCLUDED. The proof reports, per collection, source = retained + excluded, and lists every
//     excluded id; retained ids are the source ids minus exactly those.
//   * NO DANGLING REFERENCE. A retained record that points at an excluded one (a Reorder naming an excluded purchase
//     order, a purchase order or void naming an excluded Reorder or purchase order) refuses: the exclusion would
//     otherwise change the meaning of a record that IS copied.
//
// Pure: no database, no Firestore, no file system.
import {
  REORDER_SCENARIO_FIXTURES, SCENARIO_ID, classifyCandidate,
} from "../../sandboxFixtures/reorderScenarioFixtures.js";
import {
  REORDER_SNAPSHOT_COLLECTIONS, type ReorderSnapshot, type ReorderSnapshotCollection, type ReorderSnapshotDocument,
} from "./reorderSnapshot.js";

export const REORDER_EXCLUSION_FORMAT = "EOS_REORDER_MIGRATION_EXCLUSION";
export const REORDER_EXCLUSION_VERSION = 1;

export interface ExclusionEntry {
  readonly collection: ReorderSnapshotCollection;
  readonly id: string;
}

export interface ReorderExclusionManifest {
  readonly format: typeof REORDER_EXCLUSION_FORMAT;
  readonly version: typeof REORDER_EXCLUSION_VERSION;
  readonly ruling: "DQ-032";
  readonly scenarioId: string;
  readonly reason: string;
  readonly count: number;
  readonly entries: readonly ExclusionEntry[];
}

export class ReorderExclusionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReorderExclusionError";
  }
}

const key = (collection: string, id: string) => `${collection}|${id}`;
const byEntry = (a: ExclusionEntry, b: ExclusionEntry) =>
  (key(a.collection, a.id) < key(b.collection, b.id) ? -1 : key(a.collection, a.id) > key(b.collection, b.id) ? 1 : 0);

/** The one manifest the repository declares. Deterministic: same bytes every time. */
export function buildReorderExclusionManifest(): ReorderExclusionManifest {
  const entries = REORDER_SCENARIO_FIXTURES
    .map((f) => Object.freeze({ collection: f.collection as ReorderSnapshotCollection, id: f.id }))
    .sort(byEntry);
  return Object.freeze({
    format: REORDER_EXCLUSION_FORMAT,
    version: REORDER_EXCLUSION_VERSION,
    ruling: "DQ-032" as const,
    scenarioId: SCENARIO_ID,
    reason: "Repository-authored SBX-SCN-001 scenario fixtures: excluded from the governed COPY, left unchanged in "
      + "Firestore, removed only by the final Firebase retirement.",
    count: entries.length,
    entries: Object.freeze(entries),
  });
}

/** The canonical file text of the manifest (what is committed and checksummed). */
export function renderReorderExclusionManifest(): string {
  return JSON.stringify(buildReorderExclusionManifest(), null, 2) + "\n";
}

/** Accept an operator-supplied manifest only if it is exactly the declared one. */
export function assertDeclaredExclusionManifest(text: string): ReorderExclusionManifest {
  if (text !== renderReorderExclusionManifest()) {
    throw new ReorderExclusionError(
      "the exclusion manifest is not the repository's declared DQ-032 manifest; it can neither widen nor narrow the exclusion.");
  }
  return buildReorderExclusionManifest();
}

export interface ExcludedRecord {
  readonly collection: ReorderSnapshotCollection;
  readonly id: string;
  readonly fingerprint: string;
}

export interface ReorderExclusionProof {
  readonly ruling: "DQ-032";
  readonly manifestCount: number;
  /** Per collection: source = retained + excluded. */
  readonly counts: Readonly<Record<ReorderSnapshotCollection, { source: number; excluded: number; retained: number }>>;
  readonly excluded: readonly ExcludedRecord[];
  /** Declared fixtures the snapshot does not hold. Absence is a fact, never an error. */
  readonly absent: readonly ExclusionEntry[];
  /** True iff every excluded record is a declared, fact-matching fixture and nothing else was removed. */
  readonly onlyDeclaredFixturesExcluded: boolean;
}

const REFERENCE_FIELDS: Readonly<Record<ReorderSnapshotCollection, readonly [string, ReorderSnapshotCollection][]>> = {
  reorder_requests: [["purchaseOrderId", "reorder_purchase_orders"]],
  reorder_purchase_orders: [["reorderRequestId", "reorder_requests"]],
  reorder_purchase_order_voids: [["reorderRequestId", "reorder_requests"], ["purchaseOrderId", "reorder_purchase_orders"]],
};

/**
 * Remove exactly the declared fixtures from a parsed snapshot. Returns the filtered snapshot (the ONLY input the
 * copy and verify stages then see) and the proof. Refuses on a diverged occupant or a dangling reference.
 */
export function applyReorderExclusion(
  snapshot: ReorderSnapshot,
  manifest: ReorderExclusionManifest,
  sha256Hex: (input: string) => string,
): { readonly snapshot: ReorderSnapshot; readonly proof: ReorderExclusionProof } {
  const declared = new Set(manifest.entries.map((e) => key(e.collection, e.id)));
  const excluded: ExcludedRecord[] = [];
  const refusals: string[] = [];
  const collections = {} as Record<ReorderSnapshotCollection, readonly ReorderSnapshotDocument[]>;
  const counts = {} as Record<ReorderSnapshotCollection, { source: number; excluded: number; retained: number }>;

  for (const name of REORDER_SNAPSHOT_COLLECTIONS) {
    const source = snapshot.collections[name];
    const retained: ReorderSnapshotDocument[] = [];
    for (const doc of source) {
      if (!declared.has(key(name, doc.id))) {
        retained.push(doc);
        continue;
      }
      const c = classifyCandidate({ collection: name, id: doc.id, data: doc.data }, sha256Hex);
      if (c.classification !== "CONFIRMED_SYNTHETIC") {
        refusals.push(`${name}/${doc.id} occupies a declared fixture id but is ${c.classification}`);
        continue;
      }
      excluded.push(Object.freeze({ collection: name, id: doc.id, fingerprint: c.fingerprint }));
    }
    collections[name] = Object.freeze(retained);
    counts[name] = { source: source.length, excluded: source.length - retained.length, retained: retained.length };
  }

  const excludedKeys = new Set(excluded.map((e) => key(e.collection, e.id)));
  for (const name of REORDER_SNAPSHOT_COLLECTIONS) {
    for (const doc of collections[name]) {
      for (const [field, target] of REFERENCE_FIELDS[name]) {
        const ref = doc.data[field];
        if (typeof ref === "string" && excludedKeys.has(key(target, ref))) {
          refusals.push(`${name}/${doc.id} is copied but its ${field} names the excluded ${target}/${ref}`);
        }
      }
    }
  }
  if (refusals.length > 0) {
    throw new ReorderExclusionError(`exclusion refused: ${refusals.join("; ")}`);
  }

  const present = new Set(excluded.map((e) => key(e.collection, e.id)));
  const absent = manifest.entries.filter((e) => !present.has(key(e.collection, e.id)));
  const totalRemoved = REORDER_SNAPSHOT_COLLECTIONS.reduce((n, c) => n + counts[c].excluded, 0);

  const filtered: ReorderSnapshot = Object.freeze({
    source: snapshot.source,
    counts: Object.freeze(Object.fromEntries(REORDER_SNAPSHOT_COLLECTIONS.map((c) => [c, counts[c].retained])) as
      Record<ReorderSnapshotCollection, number>),
    collections: Object.freeze(collections),
  });
  return {
    snapshot: filtered,
    proof: Object.freeze({
      ruling: "DQ-032" as const,
      manifestCount: manifest.count,
      counts: Object.freeze(counts),
      excluded: Object.freeze(excluded.sort(byEntry)),
      absent: Object.freeze(absent),
      onlyDeclaredFixturesExcluded: totalRemoved === excluded.length,
    }),
  };
}
