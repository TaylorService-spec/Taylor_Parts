// SBX-SCN-001, THE REORDER DOMAIN: the ONE definition of the scenario's Reorder fixtures.
//
// NONPROD ONLY, and pure: no Firebase, no Postgres, no clock, no randomness. It states WHAT the
// scenario's Reorder records are, in business terms, and it is the single source three different
// consumers read:
//
//   1. the Firestore sandbox seeder, which writes them today;
//   2. the PostgreSQL scenario seeder, which writes them after the Reorder cutover;
//   3. the retirement tool, which decides whether a document in the sandbox IS one of them.
//
// One definition, because the alternative is a retirement tool with its own private idea of what a
// fixture looks like -- and the first time the seeder changed, the tool would either refuse to
// retire a real fixture or, far worse, fail to notice that a document it was about to delete no
// longer matched anything the seeder writes.
//
// ════════════════════ WHAT MAKES A DOCUMENT A FIXTURE ════════════════════
//
// NOT its id. An id is a name, and a business record can be given any name -- including one that
// looks like a fixture. Three things must hold together before anything is deleted:
//
//   1. the id is one this module DECLARES;
//   2. the deterministic BUSINESS FACTS match exactly (the fingerprint below);
//   3. the scenario marker is present where the seeder writes one.
//
// ════════════════════ THE MARKER GAP, RECORDED RATHER THAN PAPERED OVER ════════════════════
//
// `reorder_purchase_orders` fixtures carry `scenarioId`. The `reorder_requests` fixtures DO NOT --
// the seeder's `reorderRequest()` helper never stamped one. That is a real gap, and the honest
// response is neither to pretend the marker exists nor to refuse to retire the records it is
// missing from: it is to say which evidence each collection actually carries, and to require ALL of
// the evidence that exists for that collection. `markerRequired` below is that statement, and it is
// per-collection rather than global for exactly this reason.
//
// ════════════════════ WHY TIMESTAMPS AND ACTORS ARE NOT FINGERPRINTED ════════════════════
//
// The seeder writes `createdAt: now` and resolves actor uids from whichever personas that
// environment happens to hold. Both legitimately differ between two runs of the same deterministic
// seed, so including them would make every fixture look diverged and the tool would retire nothing.
// The fingerprint covers the facts the seeder HARD-CODES, which are the facts that make the record
// the scenario record.

export const SCENARIO_ID = "SBX-SCN-001";

/** The only project this scenario may ever be touched in. */
export const SANDBOX_PROJECT_ID = "eos-platform-sandbox";
/** Named explicitly so a refusal can be tested, rather than relying on "not the sandbox". */
export const PRODUCTION_PROJECT_ID = "taylor-parts";

export const REORDER_FIXTURE_COLLECTIONS = Object.freeze([
  "reorder_requests",
  "reorder_purchase_orders",
  "reorder_purchase_order_voids",
] as const);
export type ReorderFixtureCollection = (typeof REORDER_FIXTURE_COLLECTIONS)[number];

/**
 * Does the seeder stamp `scenarioId` on this collection's fixtures?
 *
 * The marker is checked HERE and is deliberately NOT one of the fingerprinted facts. Putting it in
 * both places made the marker check unreachable: a document missing the marker already failed the
 * fact comparison, so `MARKER_MISSING` could never be reported and the distinction between "someone
 * edited this record" and "this is not a scenario record" was lost.
 */
export const MARKER_REQUIRED: Readonly<Record<ReorderFixtureCollection, boolean>> = Object.freeze({
  reorder_requests: false,
  reorder_purchase_orders: true,
  reorder_purchase_order_voids: true,
});

/** One declared fixture: its identity, its deterministic facts, and what it is FOR. */
export interface ReorderFixture {
  readonly collection: ReorderFixtureCollection;
  readonly id: string;
  /** The facts the seeder hard-codes. Compared exactly; nothing here varies between runs. */
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
  /**
   * Other fixtures this one points at. COLLECTION-AWARE on purpose: a Reorder Purchase Order is
   * keyed by its Reorder Request's id, so the two share an id across two collections. A lineage
   * check that compared ids alone would find the purchase order itself and conclude its request was
   * present -- which is exactly the broken chain it exists to catch.
   */
  readonly relatedRefs: readonly FixtureRef[];
  /** The business behaviour this record exists to make testable. Preserved by any replacement. */
  readonly purpose: string;
}

export interface FixtureRef {
  readonly collection: ReorderFixtureCollection;
  readonly id: string;
}

const f = (x: ReorderFixture): ReorderFixture => Object.freeze({
  ...x, facts: Object.freeze(x.facts), relatedRefs: Object.freeze(x.relatedRefs),
});
const req = (id: string): FixtureRef => Object.freeze({ collection: "reorder_requests" as const, id });

/**
 * THE DECLARED POPULATION. Derived from `scripts/seedSandboxTransactional.js`, which writes these
 * ids and these values literally.
 *
 * `ro-sbx-005` is deliberately present as a PURCHASE ORDER with NO Reorder Request: the seeder
 * writes the order and never writes the request. That asymmetry is recorded here rather than
 * corrected, because the retirement tool must recognise the population that actually exists.
 */
export const REORDER_SCENARIO_FIXTURES: readonly ReorderFixture[] = Object.freeze([
  f({
    collection: "reorder_requests", id: "ro-sbx-001",
    facts: { partId: "PRT-1001", status: "ORDERED", recommendedQty: 4, requestedQty: 4,
      urgency: "HIGH", purchaseOrderId: "ro-sbx-001", reviewDecision: "APPROVED" },
    relatedRefs: [req("ro-sbx-001")],
    purpose: "the STANDARD-part receiving candidate: ORDERED, with a purchase order awaiting receipt",
  }),
  f({
    collection: "reorder_requests", id: "ro-sbx-002",
    facts: { partId: "PRT-1003", status: "PENDING_REVIEW", recommendedQty: 10, requestedQty: 10,
      urgency: "MEDIUM", purchaseOrderId: null, reviewDecision: null },
    relatedRefs: [],
    purpose: "an unreviewed queue item",
  }),
  f({
    collection: "reorder_requests", id: "ro-sbx-003",
    facts: { partId: "PRT-1006", status: "PURCHASING_IN_PROGRESS", recommendedQty: 8, requestedQty: 8,
      urgency: "LOW", purchaseOrderId: null, reviewDecision: "APPROVED" },
    relatedRefs: [],
    purpose: "a mid-flight purchasing item",
  }),
  f({
    collection: "reorder_requests", id: "ro-sbx-004",
    facts: { partId: "PRT-1002", status: "REJECTED", recommendedQty: 2, requestedQty: 2,
      urgency: "LOW", purchaseOrderId: null, reviewDecision: "REJECTED" },
    relatedRefs: [],
    purpose: "the alternate terminal branch",
  }),
  f({
    collection: "reorder_requests", id: "ro-sbx-006",
    facts: { partId: "PRT-2001", status: "ORDERED", recommendedQty: 2, requestedQty: 2,
      urgency: "HIGH", purchaseOrderId: "ro-sbx-006", reviewDecision: "APPROVED" },
    relatedRefs: [req("ro-sbx-006")],
    purpose: "the SERIALIZED-part receiving candidate: receiving it exercises serial capture and custody activation",
  }),
  f({
    collection: "reorder_purchase_orders", id: "ro-sbx-001",
    facts: { reorderRequestId: "ro-sbx-001", purchaseOrderId: "ro-sbx-001", externalPoNumber: "po-sbx-001",
      partId: "PRT-1001", supplierId: "sup-arcticparts", orderedQuantity: 4, status: "ORDERED" },
    relatedRefs: [req("ro-sbx-001")],
    purpose: "the STANDARD receiving candidate's purchase order, keyed by the Reorder Request id",
  }),
  f({
    collection: "reorder_purchase_orders", id: "ro-sbx-005",
    facts: { reorderRequestId: "ro-sbx-005", purchaseOrderId: "ro-sbx-005", externalPoNumber: "po-sbx-002",
      partId: "PRT-1002", supplierId: "sup-coldchain", orderedQuantity: 5, status: "VOIDED",
      voidReason: "Duplicate order raised in error." },
    relatedRefs: [],
    purpose: "the VOIDED purchase order branch. The seeder writes NO Reorder Request for it.",
  }),
  f({
    collection: "reorder_purchase_orders", id: "ro-sbx-006",
    facts: { reorderRequestId: "ro-sbx-006", purchaseOrderId: "ro-sbx-006", externalPoNumber: "po-sbx-003",
      partId: "PRT-2001", supplierId: "sup-coldchain", orderedQuantity: 2, status: "ORDERED" },
    relatedRefs: [req("ro-sbx-006")],
    purpose: "the SERIALIZED receiving candidate's purchase order; orderedQuantity 2 binds the serial count",
  }),
]);

/** Every part id the scenario's Reorder records reference. */
export const SCENARIO_PART_IDS: readonly string[] = Object.freeze(
  [...new Set(REORDER_SCENARIO_FIXTURES
    .map((x) => x.facts.partId)
    .filter((v): v is string => typeof v === "string"))].sort(),
);

export const FIXTURE_CLASSIFICATIONS = Object.freeze([
  /** Declared, marker present where required, every deterministic fact matches. Safe to retire. */
  "CONFIRMED_SYNTHETIC",
  /** Occupies a declared fixture id but the facts differ. Someone else's record, or an edited one. */
  "CONTENT_DIVERGED",
  /** Declared, facts match, but the scenario marker this collection should carry is absent. */
  "MARKER_MISSING",
  /** Not a declared fixture id at all. Never touched. */
  "NOT_DECLARED",
] as const);
export type FixtureClassification = (typeof FIXTURE_CLASSIFICATIONS)[number];

export interface CandidateDocument {
  readonly collection: string;
  readonly id: string;
  readonly data: unknown;
}

export interface ClassifiedCandidate {
  readonly collection: string;
  readonly id: string;
  readonly classification: FixtureClassification;
  readonly scenarioId: string | null;
  /** sha256 over the declared facts AS FOUND. Stable across seed runs; changes if a fact changes. */
  readonly fingerprint: string;
  /** The fingerprint the declaration expects. Equal iff the facts match. */
  readonly expectedFingerprint: string | null;
  readonly relatedRefs: readonly FixtureRef[];
  readonly divergences: readonly string[];
  /** True only for CONFIRMED_SYNTHETIC. Anything else is left alone. */
  readonly retirable: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Key-sorted encoding, so a fingerprint cannot depend on property insertion order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The deterministic content fingerprint, over the DECLARED facts only.
 *
 * Injected hasher so this module stays free of `node:crypto` and therefore free of any runtime at
 * all; the callers pass the one they already have.
 */
export function fingerprintFacts(
  facts: Readonly<Record<string, unknown>>,
  sha256Hex: (input: string) => string,
): string {
  return sha256Hex(canonicalJson(facts)).slice(0, 32);
}

const declarationFor = (collection: string, id: string): ReorderFixture | undefined =>
  REORDER_SCENARIO_FIXTURES.find((x) => x.collection === collection && x.id === id);

/**
 * Classify ONE document against the declaration. Deletes nothing and decides nothing beyond this.
 *
 * FAIL CLOSED: every path that is not "declared, marked and identical" yields a classification that
 * is NOT retirable. There is deliberately no "probably fine" outcome.
 */
export function classifyCandidate(
  candidate: CandidateDocument,
  sha256Hex: (input: string) => string,
): ClassifiedCandidate {
  const declaration = declarationFor(candidate.collection, candidate.id);
  const data = isObject(candidate.data) ? candidate.data : {};
  const scenarioId = typeof data.scenarioId === "string" ? data.scenarioId : null;

  if (declaration === undefined) {
    return Object.freeze({
      collection: candidate.collection, id: candidate.id, classification: "NOT_DECLARED" as const,
      scenarioId, fingerprint: fingerprintFacts({}, sha256Hex), expectedFingerprint: null,
      relatedRefs: Object.freeze([]), retirable: false,
      divergences: Object.freeze(["this id is not a declared SBX-SCN-001 Reorder fixture"]),
    });
  }

  // The facts AS FOUND, read through the declaration's own key set -- so an extra field a person
  // added does not change the fingerprint, and a missing one does.
  const found: Record<string, unknown> = {};
  const divergences: string[] = [];
  for (const key of Object.keys(declaration.facts)) {
    const actual = data[key] === undefined ? null : data[key];
    found[key] = actual;
    const expected = declaration.facts[key];
    if (actual !== expected) {
      divergences.push(`${key}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
    }
  }
  const fingerprint = fingerprintFacts(found, sha256Hex);
  const expectedFingerprint = fingerprintFacts(declaration.facts, sha256Hex);

  const markerRequired = MARKER_REQUIRED[declaration.collection];
  let classification: FixtureClassification = "CONFIRMED_SYNTHETIC";
  if (divergences.length > 0) classification = "CONTENT_DIVERGED";
  else if (markerRequired && scenarioId !== SCENARIO_ID) classification = "MARKER_MISSING";

  return Object.freeze({
    collection: candidate.collection,
    id: candidate.id,
    classification,
    scenarioId,
    fingerprint,
    expectedFingerprint,
    relatedRefs: declaration.relatedRefs,
    divergences: Object.freeze(divergences),
    retirable: classification === "CONFIRMED_SYNTHETIC",
  });
}

export interface RetirementManifest {
  readonly scenarioId: string;
  readonly projectId: string;
  readonly declaredCount: number;
  readonly candidates: readonly ClassifiedCandidate[];
  /** Declared fixtures the sandbox does not hold. Absence is a fact, never an error. */
  readonly absent: readonly { readonly collection: string; readonly id: string }[];
  readonly counts: Readonly<Record<FixtureClassification, number>>;
  /** Every reason the tool refuses to proceed. Empty means APPLY is permitted. */
  readonly refusals: readonly string[];
  readonly retirable: readonly ClassifiedCandidate[];
  readonly safeToApply: boolean;
}

/**
 * Build the pre-delete manifest.
 *
 * `documents` is EVERY document in the three Reorder collections -- not a pre-filtered set. The tool
 * must see the whole population to notice an unexpected occupant of a declared id, and a caller that
 * filtered first could hide exactly the record this refuses on.
 */
export function buildRetirementManifest(input: {
  readonly projectId: string;
  readonly documents: readonly CandidateDocument[];
  readonly sha256Hex: (input: string) => string;
}): RetirementManifest {
  const refusals: string[] = [];
  if (input.projectId === PRODUCTION_PROJECT_ID) {
    refusals.push(`${PRODUCTION_PROJECT_ID} is PRODUCTION: this tool never runs there`);
  } else if (input.projectId !== SANDBOX_PROJECT_ID) {
    refusals.push(`only ${SANDBOX_PROJECT_ID} may be retired; "${input.projectId}" was named instead`);
  }

  const declaredIds = new Set(REORDER_SCENARIO_FIXTURES.map((x) => `${x.collection}|${x.id}`));
  const candidates = input.documents
    .filter((d) => declaredIds.has(`${d.collection}|${d.id}`))
    .map((d) => classifyCandidate(d, input.sha256Hex));

  const present = new Set(candidates.map((c) => `${c.collection}|${c.id}`));
  const absent = REORDER_SCENARIO_FIXTURES
    .filter((x) => !present.has(`${x.collection}|${x.id}`))
    .map((x) => Object.freeze({ collection: x.collection, id: x.id }));

  const counts = { CONFIRMED_SYNTHETIC: 0, CONTENT_DIVERGED: 0, MARKER_MISSING: 0, NOT_DECLARED: 0 } as
    Record<FixtureClassification, number>;
  for (const c of candidates) counts[c.classification] += 1;

  // ONE diverged or unmarked occupant stops the WHOLE run. A per-document decision would delete the
  // seven it was sure about and leave a person to reason about the eighth in a half-changed sandbox.
  for (const c of candidates) {
    if (c.classification === "CONTENT_DIVERGED") {
      refusals.push(`${c.collection}/${c.id} occupies a declared fixture id but its facts differ: ${c.divergences.join("; ")}`);
    }
    if (c.classification === "MARKER_MISSING") {
      refusals.push(`${c.collection}/${c.id} matches the fixture facts but carries no ${SCENARIO_ID} marker, and this collection's fixtures are marked`);
    }
  }

  // LINEAGE. A fixture that points at a record this run is not retiring would be deleted while the
  // thing referring to it stayed behind.
  const retirableRefs = new Set(candidates.filter((c) => c.retirable).map((c) => `${c.collection}|${c.id}`));
  for (const c of candidates) {
    if (!c.retirable) continue;
    for (const related of c.relatedRefs) {
      if (!retirableRefs.has(`${related.collection}|${related.id}`)) {
        refusals.push(`${c.collection}/${c.id} names ${related.collection}/${related.id}, which this run is not retiring; the lineage would be left broken`);
      }
    }
  }

  const retirable = candidates.filter((c) => c.retirable);
  return Object.freeze({
    scenarioId: SCENARIO_ID,
    projectId: input.projectId,
    declaredCount: REORDER_SCENARIO_FIXTURES.length,
    candidates: Object.freeze(candidates),
    absent: Object.freeze(absent),
    counts: Object.freeze(counts),
    refusals: Object.freeze(refusals),
    retirable: Object.freeze(retirable),
    safeToApply: refusals.length === 0 && retirable.length > 0,
  });
}
