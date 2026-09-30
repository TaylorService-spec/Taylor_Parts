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
export const REORDER_EXCLUSION_VERSION = 2;

export interface ExclusionEntry {
  readonly collection: ReorderSnapshotCollection;
  readonly id: string;
}

export interface ClassifiedExclusionSection {
  readonly classification: "CERTIFICATION_LIVE_PROOF" | "LEGACY_INCOMPLETE_OPERATING_CONTEXT";
  readonly disposition: "EXCLUDED" | "HOLD";
  readonly ruling: string;
  readonly reason: string;
  readonly count: number;
  readonly entries: readonly ExclusionEntry[];
}

export interface ReorderExclusionManifest {
  readonly format: typeof REORDER_EXCLUSION_FORMAT;
  readonly version: typeof REORDER_EXCLUSION_VERSION;
  readonly ruling: "DQ-032";
  readonly scenarioId: string;
  readonly reason: string;
  /** The SBX-SCN-001 synthetic fixtures (DQ-032). `count` and `entries` keep their original meaning. */
  readonly count: number;
  readonly entries: readonly ExclusionEntry[];
  /** Controller ruling 2026-09-30: the Decision #155 / 2C / R-34 live-proof records on certification part CW-P-0000. */
  readonly certificationLiveProof: ClassifiedExclusionSection;
  /** Controller ruling 2026-09-30: held, NOT a fixture exclusion -- never copied, never inferred, never mutated. */
  readonly holds: ClassifiedExclusionSection;
}

/** The certification part the Catalog census excludes (CERTIFICATION_FIXTURE_EXCLUDED); live-proof records name it. */
export const CERTIFICATION_LIVE_PROOF_PART_ID = "CW-P-0000";
// Exact source ids, reconciled from the FP-0 snapshot (2026-09-30). Mutually exclusive with the fixtures and the hold.
const CERTIFICATION_LIVE_PROOF_REQUEST_IDS = Object.freeze([
  "8qKjYorWjvNyYRH53Uzy", "KuYv3Ld0pFSGBz3bHvpc", "P1Ia7fpUTKPq3RloYEvF", "Sz8QPa815EgkmvmObQ1K", "YqD07rXiAE3jLoHf4q6x",
  "ggJNjr0LsxEEn7Hwc2zX", "kLbfmkzNcUGYITlWzFGG", "veqnZP7HHnaa09PgXTqe", "ywq7UpdczU1KZ6Z86ejS",
]);
const CERTIFICATION_LIVE_PROOF_PURCHASE_ORDER_IDS = Object.freeze(["Sz8QPa815EgkmvmObQ1K"]);
const LEGACY_INCOMPLETE_REQUEST_IDS = Object.freeze(["eA7o3t8DyUXmtg8MCKjT"]);

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
    certificationLiveProof: section("CERTIFICATION_LIVE_PROOF", "EXCLUDED",
      "Controller ruling 2026-09-30 (CW-P-0000 / Reorder migration)",
      "Decision #155 / workstream 2C / R-34 live-proof evidence on certification part CW-P-0000, which the Catalog census "
        + "excludes as a certification fixture. Excluded from the PostgreSQL business-data migration; retained unchanged "
        + "in Firestore as historical evidence until the final Firebase retirement.",
      [...CERTIFICATION_LIVE_PROOF_REQUEST_IDS.map((id) => ({ collection: "reorder_requests" as const, id })),
        ...CERTIFICATION_LIVE_PROOF_PURCHASE_ORDER_IDS.map((id) => ({ collection: "reorder_purchase_orders" as const, id }))]),
    holds: section("LEGACY_INCOMPLETE_OPERATING_CONTEXT", "HOLD",
      "Controller ruling (LEGACY_INCOMPLETE_OPERATING_CONTEXT)",
      "The source Reorder states no warehouse and no operating company. It is HELD: not copied, its company is never "
        + "inferred, and the source is never mutated. It is not a fixture exclusion.",
      LEGACY_INCOMPLETE_REQUEST_IDS.map((id) => ({ collection: "reorder_requests" as const, id }))),
  });
}

function section(
  classification: ClassifiedExclusionSection["classification"], disposition: ClassifiedExclusionSection["disposition"],
  ruling: string, reason: string, list: ExclusionEntry[],
): ClassifiedExclusionSection {
  const entries = [...list].sort(byEntry).map((e) => Object.freeze({ collection: e.collection, id: e.id }));
  return Object.freeze({ classification, disposition, ruling, reason, count: entries.length, entries: Object.freeze(entries) });
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
  /** Per collection: source = retained + excluded + held (excluded = fixtures + certification live proof). */
  readonly counts: Readonly<Record<ReorderSnapshotCollection, { source: number; excluded: number; held: number; retained: number }>>;
  /** The SBX-SCN-001 fixtures removed. */
  readonly excluded: readonly ExcludedRecord[];
  /** Declared fixtures the snapshot does not hold. Absence is a fact, never an error. */
  readonly absent: readonly ExclusionEntry[];
  /** True iff every removed record is a declared, fact-matching record of its class and nothing else was removed. */
  readonly onlyDeclaredFixturesExcluded: boolean;
  readonly certificationLiveProof: { readonly classification: "CERTIFICATION_LIVE_PROOF"; readonly reason: string;
    readonly excluded: readonly ExclusionEntry[]; readonly absent: readonly ExclusionEntry[] };
  readonly held: { readonly classification: "LEGACY_INCOMPLETE_OPERATING_CONTEXT"; readonly reason: string;
    readonly held: readonly ExclusionEntry[]; readonly absent: readonly ExclusionEntry[] };
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
  const liveProof = new Set(manifest.certificationLiveProof.entries.map((e) => key(e.collection, e.id)));
  const holdIds = new Set(manifest.holds.entries.map((e) => key(e.collection, e.id)));
  const liveProofRequests = new Set(manifest.certificationLiveProof.entries
    .filter((e) => e.collection === "reorder_requests").map((e) => e.id));
  const liveRemoved: ExclusionEntry[] = [];
  const heldRemoved: ExclusionEntry[] = [];
  const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const excluded: ExcludedRecord[] = [];
  const refusals: string[] = [];
  const collections = {} as Record<ReorderSnapshotCollection, readonly ReorderSnapshotDocument[]>;
  const counts = {} as Record<ReorderSnapshotCollection, { source: number; excluded: number; held: number; retained: number }>;

  for (const name of REORDER_SNAPSHOT_COLLECTIONS) {
    const source = snapshot.collections[name];
    const retained: ReorderSnapshotDocument[] = [];
    let heldHere = 0;
    for (const doc of source) {
      const k = key(name, doc.id);
      if (liveProof.has(k)) {
        // It must still BE the live-proof record: it names the certification part (and a PO belongs to a live-proof request).
        const partOk = doc.data.partId === CERTIFICATION_LIVE_PROOF_PART_ID;
        const lineageOk = name !== "reorder_purchase_orders" || liveProofRequests.has(String(doc.data.reorderRequestId));
        if (!partOk || !lineageOk) {
          refusals.push(`${name}/${doc.id} is declared CERTIFICATION_LIVE_PROOF but no longer matches it (part/lineage diverged)`);
          continue;
        }
        liveRemoved.push(Object.freeze({ collection: name, id: doc.id }));
        continue;
      }
      if (holdIds.has(k)) {
        // It must still lack its operating context; if it gained one, it needs a fresh ruling, not a silent hold.
        if (!blank(doc.data.warehouseId) || !blank(doc.data.operatingCompanyId)) {
          refusals.push(`${name}/${doc.id} is HELD as LEGACY_INCOMPLETE_OPERATING_CONTEXT but now states an operating context`);
          continue;
        }
        heldRemoved.push(Object.freeze({ collection: name, id: doc.id }));
        heldHere += 1;
        continue;
      }
      if (!declared.has(k)) {
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
    counts[name] = { source: source.length, excluded: source.length - retained.length - heldHere, held: heldHere, retained: retained.length };
  }

  const excludedKeys = new Set([...excluded, ...liveRemoved, ...heldRemoved].map((e) => key(e.collection, e.id)));
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
  const totalRemoved = REORDER_SNAPSHOT_COLLECTIONS.reduce((n, c) => n + counts[c].excluded + counts[c].held, 0);
  const liveKeys = new Set(liveRemoved.map((e) => key(e.collection, e.id)));
  const heldKeys = new Set(heldRemoved.map((e) => key(e.collection, e.id)));

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
      onlyDeclaredFixturesExcluded: totalRemoved === excluded.length + liveRemoved.length + heldRemoved.length,
      certificationLiveProof: Object.freeze({
        classification: "CERTIFICATION_LIVE_PROOF" as const, reason: manifest.certificationLiveProof.reason,
        excluded: Object.freeze(liveRemoved.sort(byEntry)),
        absent: Object.freeze(manifest.certificationLiveProof.entries.filter((e) => !liveKeys.has(key(e.collection, e.id)))),
      }),
      held: Object.freeze({
        classification: "LEGACY_INCOMPLETE_OPERATING_CONTEXT" as const, reason: manifest.holds.reason,
        held: Object.freeze(heldRemoved.sort(byEntry)),
        absent: Object.freeze(manifest.holds.entries.filter((e) => !heldKeys.has(key(e.collection, e.id)))),
      }),
    }),
  };
}
