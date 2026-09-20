// THE `assignedToUserId` CONSUMER CENSUS -- the retirement gate for the Reorder assignment identity seam.
//
// Pure data plus one derivation: no database, no Firebase, no I/O, no scanning. Its companion suite derives the
// executable set from the repository and asserts the two correspond in BOTH directions, so this cannot go stale.
//
// ════════════════════ WHY A CENSUS BEFORE A CUTOVER ════════════════════
//
// `assignedToUserId` holds a FIREBASE AUTH UID, and the governed Reorder assignment authority (migration
// 1760140800000) names an EMPLOYEE. Those two cannot both answer "who is assigned" at once: the moment PostgreSQL
// becomes the assignment answer, every path still deciding access from the uid is deciding from a stale field.
//
// So the field cannot stop being written until EVERY LIVE AUTHORIZATION consumer moves. This census is how "every"
// is known rather than assumed -- and the first pass proved the assumption wrong: the seam was scoped to four write
// transitions, and the derivation found assignee-scoped READS as well.
//
// ════════════════════ TWO UNRELATED FIELDS SHARE THE NAME ════════════════════
//
// `assignedToUserId` also appears in the CRM/Commercial PERSON ASSIGNMENT map, alongside `assignedToEmployeeId`.
// That is a different object, a different authority and a different seam -- and notably it ALREADY carries the
// Employee id, so it is not the identity defect this census exists for. Every entry therefore records its OBJECT,
// and only REORDER entries gate the Reorder retirement. Collapsing the two would make the gate unsatisfiable.
export const CENSUS_OBJECTS = Object.freeze(["REORDER", "COMMERCIAL"] as const);
export type CensusObject = (typeof CENSUS_OBJECTS)[number];

/**
 * What a consumer DOES with the field. Only the three authorization kinds block retirement: the others either
 * survive it, or describe a record rather than deciding anything.
 */
export const CENSUS_CLASSIFICATIONS = Object.freeze([
  /** Writes the assignment. Must move to the governed Employee assignment authority. */
  "ASSIGNMENT_WRITE",
  /** Decides whether the caller may ACT, by comparing a uid to the field. Must move to the Employee predicate. */
  "ASSIGNEE_ACTION_AUTHORIZATION",
  /** Decides whether the caller may READ, the same way. Must move with the writes, not after them. */
  "ASSIGNEE_READ_AUTHORIZATION",
  /** Renders or routes by the value; decides no access. Retires with the field, blocks nothing. */
  "DISPLAY_ONLY",
  /** Fixtures, seeds and verification scripts. Evidence, never runtime authority. */
  "MIGRATION_EVIDENCE",
  /** Names the field in a shape, key list or payload contract without deciding anything. */
  "HISTORICAL_SCHEMA",
  /** Reachable by nothing. Delete rather than convert. */
  "DEAD",
] as const);
export type CensusClassification = (typeof CENSUS_CLASSIFICATIONS)[number];

/** The classifications that must be CONVERTED before the governed assignment may become the live answer. */
export const BLOCKING_CLASSIFICATIONS: readonly CensusClassification[] = Object.freeze([
  "ASSIGNMENT_WRITE", "ASSIGNEE_ACTION_AUTHORIZATION", "ASSIGNEE_READ_AUTHORIZATION",
]);

export const CENSUS_STATUSES = Object.freeze(["NOT_STARTED", "CONVERTED", "DEAD"] as const);
export type CensusStatus = (typeof CENSUS_STATUSES)[number];

export interface CensusEntry {
  readonly path: string;
  readonly object: CensusObject;
  readonly classification: CensusClassification;
  /** What this file does with the field, in one line. */
  readonly consumer: string;
  /** Executable occurrences, comments excluded. Derived and asserted; never a guess. */
  readonly occurrences: number;
  readonly status: CensusStatus;
}

const e = (entry: CensusEntry): CensusEntry => Object.freeze(entry);

/**
 * Every executable consumer, comments excluded.
 *
 * ════════════════════ WHAT THE REORDER DOMAIN CUTOVER REMOVED ════════════════════
 *
 * Five entries are gone from this list because their files no longer name the field AT ALL, which is
 * what conversion looks like when it is real. They were the entire blocking client surface:
 *
 *   inventoryReorderRequests.js   the assignment write -- now the governed command, naming an Employee
 *   ManagerQueuePanel.jsx         the picked value -- now the Employee id the picker already chose
 *   PartDetail.jsx                five `user.uid === request.assignedToUserId` guards -- now the
 *                                 server's own `isAssignee`, computed from Employee to Employee
 *   reorderPurchaseOrders.js      the void's assignee check -- now the governed command's
 *   useReorderRequests.js         `where(assignedToUserId == uid)` -- now readMyAssignedReorders,
 *                                 scoped server side with no uid stated by the browser
 *
 * WHAT REMAINS BLOCKING IS firestore.rules, and only that. Its twenty-four occurrences are where the
 * uid comparison is actually ENFORCED, and they stop mattering when Firestore stops being Reorder
 * authority -- which is an activation, not a code change, and is fenced from production.
 */
export const ASSIGNED_TO_USER_ID_CENSUS: readonly CensusEntry[] = Object.freeze([
  // ── Firestore Rules: where the uid comparison is actually enforced ──
  e({
    path: "firestore.rules", object: "REORDER", classification: "ASSIGNEE_ACTION_AUTHORIZATION",
    // 24 executable occurrences across 19 lines. By enclosing match block: 13 lines in /reorder_requests (the
    // assignee READ arm plus Assign, Start Purchasing, Post Purchasing Update and the closeout transitions), 2 in
    // /reorder_purchase_order_voids, 1 in /reorder_purchase_orders, and 3 in root shape helpers that only list the
    // field among a document's canonical keys.
    consumer: "the reorder_requests assignee read arm and its assign/transition writes, the purchase-order and void "
      + "assignee reads, and three canonical-key shape helpers",
    occurrences: 24, status: "NOT_STARTED",
  }),




  // ── presentation and notification routing: retire with the field, block nothing ──
  e({
    path: "field-ops-app-vite/src/domain/partsAttentionProjection.js", object: "REORDER", classification: "DISPLAY_ONLY",
    consumer: "carries the uid as recipientUserId to route an attention notification", occurrences: 4, status: "NOT_STARTED",
  }),
  e({
    path: "field-ops-app-vite/src/shared/reorder/AssignedWorkOversightTable.jsx", object: "REORDER", classification: "DISPLAY_ONLY",
    consumer: "renders the assignee name from the uid", occurrences: 1, status: "NOT_STARTED",
  }),

  // ── shape and payload contracts: they name the field, they decide nothing ──
  e({
    path: "field-ops-app-vite/src/domain/reorderRequestPayload.js", object: "REORDER", classification: "HISTORICAL_SCHEMA",
    consumer: "names the field in the canonical creation payload", occurrences: 1, status: "NOT_STARTED",
  }),
  e({
    path: "field-ops-app-vite/src/metadata/definitions/reorderRequest.js", object: "REORDER", classification: "HISTORICAL_SCHEMA",
    consumer: "the Reorder Request metadata definition's field descriptors", occurrences: 6, status: "NOT_STARTED",
  }),
  e({
    path: "functions/src/reorderRequest/reorderCallables.ts", object: "REORDER", classification: "HISTORICAL_SCHEMA",
    consumer: "initializes assignedToUserId to null at creation and never reads it for authorization",
    occurrences: 1, status: "NOT_STARTED",
  }),

  // ── fixtures, seeds and verification: evidence, never runtime authority ──
  e({
    path: "functions/scripts/bootstrapIssue100VerificationFixtures.js", object: "REORDER", classification: "MIGRATION_EVIDENCE",
    consumer: "seeds Issue #100 verification fixtures", occurrences: 9, status: "NOT_STARTED",
  }),
  e({
    path: "functions/scripts/verifyIssue100ProductionRules.js", object: "REORDER", classification: "MIGRATION_EVIDENCE",
    consumer: "verifies the Issue #100 Rules behaviour against a live project", occurrences: 7, status: "NOT_STARTED",
  }),
  e({
    path: "functions/scripts/seedSandboxTransactional.js", object: "REORDER", classification: "MIGRATION_EVIDENCE",
    consumer: "seeds sandbox reorder requests with an assignee", occurrences: 5, status: "NOT_STARTED",
  }),
  e({
    path: "functions/scripts/seedSandboxPerformanceStory.mjs", object: "REORDER", classification: "MIGRATION_EVIDENCE",
    consumer: "seeds the performance story's assigned work", occurrences: 1, status: "NOT_STARTED",
  }),

  // The migration tooling for THIS seam. It reads the legacy field as the migration SOURCE and resolves it to an
  // Employee; it never writes it, never decides access from it, and never copies the uid forward. It is the only
  // code that may keep naming the field after the authorization consumers move, because reading a field in order to
  // retire it is not a dependency on it -- and it retires with the field, so it gates nothing.
  e({
    path: "functions/src/eosOps/migration/reorderAssignmentMigration.ts", object: "REORDER", classification: "MIGRATION_EVIDENCE",
    consumer: "the pure classifier: names the field on the legacy source row and resolves it through the uid "
      + "resolution map to an Employee disposition",
    occurrences: 3, status: "NOT_STARTED",
  }),
  e({
    path: "functions/src/eosOps/migration/reorderAssignmentMigrationCopy.ts", object: "REORDER", classification: "MIGRATION_EVIDENCE",
    consumer: "the DRY RUN / COPY / VERIFY executor: gathers the source uids for resolution and records the legacy "
      + "field as the copy's audit reason",
    occurrences: 3, status: "NOT_STARTED",
  }),
  e({
    path: "functions/src/eosOps/migration/reorderFieldParityMatrix.ts", object: "REORDER", classification: "MIGRATION_EVIDENCE",
    consumer: "names the field once, as the legacy key whose disposition sends it to the governed Employee "
      + "assignment authority rather than to a Reorder column",
    occurrences: 1, status: "NOT_STARTED",
  }),

  // ── COMMERCIAL: the same NAME, a different object, a different seam ──
  //
  // The Person Assignment map already carries assignedToEmployeeId beside the uid, so it does not have the identity
  // defect this census exists for. Listed because the derivation finds it, and excluded from the Reorder gate.
  e({
    path: "field-ops-app-vite/src/domain/commercialProfile.js", object: "COMMERCIAL", classification: "DISPLAY_ONLY",
    consumer: "reads accountOwner.assignedToUserId beside assignedToEmployeeId for the owner display",
    occurrences: 2, status: "NOT_STARTED",
  }),
  e({
    path: "field-ops-app-vite/src/modules/accounts/AccountForm.jsx", object: "COMMERCIAL", classification: "DISPLAY_ONLY",
    consumer: "carries the account owner's Person Assignment map", occurrences: 1, status: "NOT_STARTED",
  }),
  e({
    path: "functions/src/coverage/coverageCommands.ts", object: "COMMERCIAL", classification: "HISTORICAL_SCHEMA",
    consumer: "validates the Person Assignment map's required keys for coverage assignment",
    occurrences: 6, status: "NOT_STARTED",
  }),
  e({
    path: "functions/src/crm/crmCutoverSnapshot.ts", object: "COMMERCIAL", classification: "MIGRATION_EVIDENCE",
    consumer: "reads the Person Assignment map from the CRM cutover snapshot", occurrences: 5, status: "NOT_STARTED",
  }),
  e({
    path: "functions/scripts/crmCutover.js", object: "COMMERCIAL", classification: "MIGRATION_EVIDENCE",
    consumer: "the CRM cutover operator script", occurrences: 1, status: "NOT_STARTED",
  }),
  e({
    path: "functions/scripts/certificationWorld/seedAccountOwners.mjs", object: "COMMERCIAL", classification: "MIGRATION_EVIDENCE",
    consumer: "seeds certification-world account owners", occurrences: 2, status: "NOT_STARTED",
  }),
]);

export interface RetirementReadiness {
  /** True only when every BLOCKING Reorder consumer is CONVERTED or DEAD. */
  readonly ready: boolean;
  /** The Reorder consumers still deciding access from the uid. Empty exactly when `ready`. */
  readonly blockedBy: readonly string[];
  readonly blockingByClassification: Readonly<Record<string, number>>;
}

/**
 * May the governed Employee assignment become the LIVE answer?
 *
 * Only REORDER entries count, and only the three authorization classifications: display, schema and evidence
 * consumers retire with the field rather than gating it. A COMMERCIAL entry never gates this, because it belongs to
 * a different object whose assignment already names an Employee.
 */
export function assignmentCutoverReadiness(
  census: readonly CensusEntry[] = ASSIGNED_TO_USER_ID_CENSUS,
): RetirementReadiness {
  const blocking = census.filter((c) =>
    c.object === "REORDER" && BLOCKING_CLASSIFICATIONS.includes(c.classification) && c.status === "NOT_STARTED");
  const byClassification: Record<string, number> = {};
  for (const c of blocking) byClassification[c.classification] = (byClassification[c.classification] ?? 0) + 1;
  return Object.freeze({
    ready: blocking.length === 0,
    blockedBy: Object.freeze(blocking.map((c) => c.path).sort()),
    blockingByClassification: Object.freeze(byClassification),
  });
}
