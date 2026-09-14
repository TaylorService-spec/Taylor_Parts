// THE ACCOUNTABILITY CENSUS — dedicated, per Owner ruling #187 §1 (`MI-Y`, option ii).
//
// ════════════════════ WHY THIS IS A SECOND CENSUS AND NOT A COLUMN IN THE FIRST ════════════════════
//
// #187 §1 ruled the choice #182 §6 had reserved:
//
//     "Ruled: (ii). Do NOT expand the ownership census into a generic mega-census. OWNERSHIP ·
//      ACCOUNTABILITY · ASSIGNMENT · APPROVAL · ESCALATION are distinct business axes. Ownership
//      integrity remains ownership integrity; accountability integrity gets its own measurement."
//
//         OWNERSHIP CENSUS + ACCOUNTABILITY CENSUS + other required governed integrity facts
//             → RESPONSIBILITY / ENFORCEMENT GATE
//
// So this module is the second box, not a widening of the first. `accountablePerson` is NOT in
// `ownershipMatrix.ownerFields` and nothing here puts it there; #186 §9 says the same thing from the
// other direction — "the `ownershipMatrix.ownerFields` mechanism must not be made to carry this
// multi-axis model."
//
// `functions/src/responsibility/responsibilityEnforcementGate.ts` is the third box, and it COMPOSES
// the two without collapsing them.
//
// ════════════════════ WHAT IT MEASURES, PER APPLICABLE ACTIONABLE RECORD ════════════════════
//
// Six facts, kept separate because the rulings keep them separate:
//
//   IS AN ACCOUNTABLE PERSON PRESENT      the stored field — present, absent, or unreadable
//   IS THE REFERENCE VALID                the authoritative Employee answer (#182 §1, layer 1)
//   IS THE PERSON CURRENTLY ELIGIBLE      a governed policy's verdict (#182 §4, layer 2)
//   WAS AN AUTHORITATIVE ANSWER OBTAINED  #187 §2, and it is NEVER folded into the two above
//   HISTORICAL OR ACTIONABLE              #186 §7 vs §8 — history is preserved, current work is not
//   EXPLICIT GOVERNED EXCEPTION           #180's "unless an explicit, separately Owner-approved
//                                         exception defines otherwise"
//
// ════════════════════ THE THREE THINGS THIS CENSUS MUST NEVER DO ════════════════════
//
//   1. NEVER CONVERT `AUTHORITY_UNAVAILABLE` INTO `INVALID` OR `MISSING`. #187 §2: they "mean
//      different things" — one is the authority answering no, the other is EOS failing to ask. It is
//      its own bucket here, it is ALWAYS blocking, and no code path assigns a record to any other
//      bucket when the lookup failed.
//   2. NEVER REPORT AN OUT-OF-SCOPE FAMILY AS A FINDING. #189 `OD-16`: accountability for those
//      families is "NOT APPLICABLE — not MISSING, not OWNERLESS, not DEFECTIVE". They get a report
//      that carries no counts at all, so there is no number that could be summed into a backlog.
//   3. NEVER TREAT A HISTORICAL RECORD'S INELIGIBLE PERSON AS A DEFECT. #186 §7: "Historical
//      ownership and accountability references remain valid when the Employee later becomes
//      INACTIVE, TERMINATED or former. Do not rewrite history." It is COUNTED — the census can see
//      it — and it does not block.
//
// READ-ONLY BY CONSTRUCTION: this module has no write of any kind. It takes documents and an
// authority port and returns counts. It imports no storage client, no Firebase and no `node:` module.

import {
  composePersonReferenceState,
  type AccountabilityEligibilityPolicy,
  type ComposedPersonReference,
  type EmployeeAuthority,
} from "../employeeIdentity/employeeAuthority";
import { accountabilityFamilyScope } from "./accountabilityFamilyScope";
import {
  ACCOUNTABLE_PERSON_FIELD,
  accountabilityExceptionId,
  accountabilityRecordContext,
  accountablePersonStorage,
  readStoredAccountablePerson,
  type AccountabilityRecordContext,
} from "./accountablePersonStorage";

/** Sample ids per bucket, matching the ownership census's own ceiling so the two reports read alike. */
export const MAX_SAMPLE_IDS = 10;

/**
 * The buckets. SEVEN, and every applicable record lands in exactly one.
 *
 * The names say which of the six facts produced them, and the two that are most often collapsed are
 * deliberately the furthest apart in this list:
 *
 *   presentValidEligible              #182 state A. The only healthy state for actionable work.
 *   presentValidNotCurrentlyEligible  #182 state B / #186 cases B and C. A VALID reference. Blocks on
 *                                     an ACTIONABLE record (#189 MI-ε) and does NOT block on history.
 *   presentInvalid                    #182 state C. The authority ANSWERED and nothing resolves.
 *   presentUnreadable                 #189 MI-λ. A stored value that could never be an id. Quarantine.
 *   missing                           No accountable person at all. #180 prohibits this for actionable
 *                                     work absent a governed exception.
 *   authorityUnavailable              #187 §2. NOT a verdict about the person. Always blocks.
 *   governedException                 #180's explicit, separately Owner-approved exception. Counted,
 *                                     never blocking, and nothing in EOS writes one yet.
 */
export const ACCOUNTABILITY_BUCKETS = Object.freeze([
  "presentValidEligible",
  "presentValidNotCurrentlyEligible",
  "presentInvalid",
  "presentUnreadable",
  "missing",
  "authorityUnavailable",
  "governedException",
] as const);

export type AccountabilityBucket = (typeof ACCOUNTABILITY_BUCKETS)[number];

export type AccountabilityCounts = Record<AccountabilityBucket, number>;

/** reason → count, so a large family reports WHY without listing every id. */
export type AccountabilityReasonTally = Record<string, number>;

export const emptyAccountabilityCounts = (): AccountabilityCounts => {
  const counts = {} as AccountabilityCounts;
  for (const bucket of ACCOUNTABILITY_BUCKETS) counts[bucket] = 0;
  return counts;
};

/** One record's classification. The bucket AND the context, because the gate needs both. */
export interface AccountabilityRecordClassification {
  readonly bucket: AccountabilityBucket;
  readonly context: AccountabilityRecordContext;
  /** Why, for every bucket but `presentValidEligible`. `null` for the healthy one. */
  readonly reason: string | null;
  /** The composed person state, when a reference was present and a resolution was available. */
  readonly composed: ComposedPersonReference | null;
}

/**
 * A resolved-reference lookup. The census resolves each DISTINCT id ONCE and hands the map in, so the
 * classifier stays pure and a family of 40,000 records with 30 salespeople makes 30 lookups.
 *
 * A reference NOT in the map is `authorityUnavailable`, never `presentInvalid`: an id that was never
 * looked up has no authoritative answer, and #187 §2 forbids reading the absence of an answer as a
 * verdict. That is why the map's miss case is fail-closed rather than a thrown programming error —
 * a throw here would abort a census run, and an aborted census reports nothing at all.
 */
export type ResolvedReferences = ReadonlyMap<string, ComposedPersonReference>;

/**
 * Classify ONE record. PURE, TOTAL, and it never throws.
 *
 * Order is the ruling's order, and each step's precedence is a decision:
 *
 *   1. A GOVERNED EXCEPTION WINS FIRST. #180 makes the exception an exemption from the one-accountable-
 *      person requirement itself, so a record carrying one is not measured against that requirement.
 *   2. THE STORED VALUE, before any lookup. `UNREADABLE` and `ABSENT` are answerable without asking
 *      the authority, and asking it about an unusable id would produce a `presentInvalid` that
 *      misdescribes the finding.
 *   3. THE COMPOSED PERSON STATE, which is where validity and eligibility stay separate.
 */
export function classifyAccountabilityRecord(
  family: string,
  data: Readonly<Record<string, unknown>>,
  resolved: ResolvedReferences,
): AccountabilityRecordClassification {
  const context = accountabilityRecordContext(family, data);
  const exception = accountabilityExceptionId(data);
  if (exception !== null) {
    return {
      bucket: "governedException",
      context,
      reason: `explicit governed accountability exception ${exception} (#180)`,
      composed: null,
    };
  }

  const stored = readStoredAccountablePerson(data);
  if (stored.state === "ABSENT") {
    return { bucket: "missing", context, reason: "no accountable person is recorded", composed: null };
  }
  if (stored.state === "UNREADABLE") {
    return {
      bucket: "presentUnreadable",
      context,
      reason: stored.detail ?? `stored ${ACCOUNTABLE_PERSON_FIELD} is not a usable Employee id`,
      composed: null,
    };
  }

  const composed = resolved.get(stored.accountableEmployeeId as string);
  if (composed === undefined) {
    return {
      bucket: "authorityUnavailable",
      context,
      reason:
        `no authoritative answer was obtained for ${stored.accountableEmployeeId}. This is NOT a ` +
        "finding that the person is missing or invalid (#187 s2).",
      composed: null,
    };
  }
  switch (composed.state) {
    case "VALID_CURRENT":
      return { bucket: "presentValidEligible", context, reason: null, composed };
    case "VALID_NOT_CURRENTLY_ELIGIBLE":
      return {
        bucket: "presentValidNotCurrentlyEligible",
        context,
        reason:
          `${stored.accountableEmployeeId} is a VALID reference (lifecycle status ` +
          `${composed.eligibility?.employmentStatus ?? "unknown"}) that is NOT currently eligible ` +
          `under governed policy ${composed.eligibility?.policyId ?? "unknown"}`,
        composed,
      };
    case "MISSING_OR_INVALID_REFERENCE":
      return {
        bucket: "presentInvalid",
        context,
        reason: `no governed Employee resolves ${stored.accountableEmployeeId}`,
        composed,
      };
    case "AUTHORITY_UNAVAILABLE":
      return {
        bucket: "authorityUnavailable",
        context,
        reason:
          `the Employee authority could not answer for ${stored.accountableEmployeeId}. NOT a finding ` +
          "about the person (#187 s2).",
        composed,
      };
    default:
      // An unrecognised composed state is not a healthy record. Fail closed rather than default-pass.
      return {
        bucket: "authorityUnavailable",
        context,
        reason: `unrecognised composed person state for ${stored.accountableEmployeeId}`,
        composed: null,
      };
  }
}

export interface AccountabilityCensusDocument {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** A family that carries governed accountability, measured. */
export interface AccountabilityCensusFamilyReport {
  readonly family: string;
  readonly collection: string;
  readonly scope: "IN_SCOPE";
  readonly scanned: number;
  /** A `--limit` run measured a page, not a population. It blocks, like the ownership census's. */
  readonly truncated: boolean;
  /** The whole family. */
  readonly counts: AccountabilityCounts;
  /** The same buckets, split by context, because #186 §7 and §8 give them different consequences. */
  readonly actionable: AccountabilityCounts;
  readonly historical: AccountabilityCounts;
  readonly reasons: AccountabilityReasonTally;
  readonly samples: Readonly<Record<AccountabilityBucket, readonly string[]>>;
  /** The governed policy the eligibility half of every count was decided under. #189 `MI-ε`. */
  readonly eligibilityPolicyId: string;
}

/**
 * A family that carries NO governed accountability. #189 `OD-16`.
 *
 * IT HAS NO COUNTS, deliberately. A report shaped like the one above with seven zeroes in it would be
 * summable into a backlog, and the ruling is explicit that these families are "NOT APPLICABLE — not
 * MISSING, not OWNERLESS, not DEFECTIVE". There is no number here to add up.
 */
export interface AccountabilityNotApplicableReport {
  readonly family: string;
  readonly scope: "NOT_APPLICABLE";
  readonly why: string;
}

/** A family the census could not read. Distinct from an empty family, and it blocks. */
export interface AccountabilityCensusFamilyError {
  readonly family: string;
  readonly collection: string;
  readonly error: string;
}

export type AccountabilityCensusEntry =
  | AccountabilityCensusFamilyReport
  | AccountabilityNotApplicableReport
  | AccountabilityCensusFamilyError;

export const isNotApplicable = (
  entry: AccountabilityCensusEntry,
): entry is AccountabilityNotApplicableReport => "scope" in entry && entry.scope === "NOT_APPLICABLE";

export const isCensusError = (
  entry: AccountabilityCensusEntry,
): entry is AccountabilityCensusFamilyError => "error" in entry;

export const isMeasured = (
  entry: AccountabilityCensusEntry,
): entry is AccountabilityCensusFamilyReport => "scope" in entry && entry.scope === "IN_SCOPE";

/** The answer for a family outside the governed scope. The ONLY thing this census says about one. */
export function accountabilityNotApplicable(family: string): AccountabilityNotApplicableReport {
  return {
    family,
    scope: "NOT_APPLICABLE",
    why:
      `${family} carries no governed ACCOUNTABLE PERSON semantics (#189 OD-16). Accountability is NOT ` +
      "APPLICABLE to it — not MISSING, not OWNERLESS, not DEFECTIVE. A family enters scope only when " +
      "governed authority admits it, and this census must not manufacture a backlog for one that has not.",
  };
}

/** The ports the census needs. The authority, and the governed policy its verdicts come from. */
export interface AccountabilityCensusDeps {
  readonly employeeAuthority: EmployeeAuthority;
  /** REQUIRED. #189 `MI-ε`: the census consumes a governed policy and must never assume one. */
  readonly eligibilityPolicy: AccountabilityEligibilityPolicy;
}

export class AccountabilityCensusConfigurationError extends Error {
  readonly code = "ELIGIBILITY_POLICY_REQUIRED";
  constructor(message: string) {
    super(message);
    this.name = "AccountabilityCensusConfigurationError";
  }
}

/**
 * Resolve every DISTINCT present reference in one family, once each, and compose each with the policy.
 *
 * A reference whose lookup THROWS is recorded as `AUTHORITY_UNAVAILABLE` rather than omitted, because
 * omitting it would send the classifier down its map-miss branch, which reports the same thing but
 * loses the reason the authority gave.
 */
async function resolveReferences(
  deps: AccountabilityCensusDeps,
  tenantId: string,
  ids: readonly string[],
): Promise<ResolvedReferences> {
  const resolved = new Map<string, ComposedPersonReference>();
  for (const employeeId of ids) {
    const reference = { tenantId, employeeId };
    let composed: ComposedPersonReference;
    try {
      const resolution = await deps.employeeAuthority.resolveEmployeeReference(reference);
      composed = composePersonReferenceState(resolution, deps.eligibilityPolicy);
    } catch (err) {
      composed = composePersonReferenceState(
        {
          outcome: "AUTHORITY_UNAVAILABLE",
          reference,
          reason: "AUTHORITY_READ_FAILED",
          detail: err instanceof Error ? err.message : String(err),
        },
        deps.eligibilityPolicy,
      );
    }
    resolved.set(employeeId, composed);
  }
  return resolved;
}

/**
 * Measure ONE family.
 *
 * A family outside the governed scope returns the NOT APPLICABLE report WITHOUT reading a single
 * document — the applicability question is about the family, so answering it needs no records, and
 * scanning them would produce the fake backlog #189 `OD-16` forbids.
 */
export async function censusAccountabilityFamily(
  deps: AccountabilityCensusDeps,
  family: string,
  tenantId: string,
  documents: readonly AccountabilityCensusDocument[],
  truncated = false,
): Promise<AccountabilityCensusFamilyReport | AccountabilityNotApplicableReport> {
  if (!deps?.eligibilityPolicy || !deps.eligibilityPolicy.policyId) {
    throw new AccountabilityCensusConfigurationError(
      "the accountability census requires a governed eligibility policy stating its author. #189 " +
        "MI-epsilon: the gate consumes the governed eligibility result and must not flatten the " +
        "six-value employment vocabulary into a hidden boolean policy.",
    );
  }
  if (accountabilityFamilyScope(family) !== "IN_SCOPE") return accountabilityNotApplicable(family);
  const storage = accountablePersonStorage(family);
  if (storage === null) {
    // Unreachable while the scope module and the storage declaration agree, and asserted in the
    // tests. Fail closed rather than measure a family whose storage nobody declared.
    return accountabilityNotApplicable(family);
  }

  // DISTINCT ids only — one authority call per person, not per record.
  const ids = new Set<string>();
  for (const doc of documents) {
    if (accountabilityExceptionId(doc.data) !== null) continue;
    const stored = readStoredAccountablePerson(doc.data);
    if (stored.state === "PRESENT") ids.add(stored.accountableEmployeeId as string);
  }
  const resolved = await resolveReferences(deps, tenantId, [...ids]);

  const counts = emptyAccountabilityCounts();
  const actionable = emptyAccountabilityCounts();
  const historical = emptyAccountabilityCounts();
  const reasons: AccountabilityReasonTally = {};
  const samples = {} as Record<AccountabilityBucket, string[]>;
  for (const bucket of ACCOUNTABILITY_BUCKETS) samples[bucket] = [];

  for (const doc of documents) {
    const classification = classifyAccountabilityRecord(family, doc.data, resolved);
    counts[classification.bucket] += 1;
    (classification.context === "ACTIONABLE" ? actionable : historical)[classification.bucket] += 1;
    if (classification.bucket === "presentValidEligible") continue;
    const reason = classification.reason ?? "(no reason given)";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    if (samples[classification.bucket].length < MAX_SAMPLE_IDS) {
      samples[classification.bucket].push(doc.id);
    }
  }

  return {
    family,
    collection: storage.collection,
    scope: "IN_SCOPE",
    scanned: documents.length,
    truncated,
    counts,
    actionable,
    historical,
    reasons,
    samples,
    eligibilityPolicyId: deps.eligibilityPolicy.policyId,
  };
}

/** What the accountability half contributes to the enforcement gate. */
export interface AccountabilityCensusVerdict {
  /** Records that cannot satisfy CURRENT responsibility integrity. #186 §8, #189 `MI-ε`. */
  readonly blocking: number;
  /** How many of those are the fail-closed kind. Reported separately; #187 §2. */
  readonly authorityUnavailable: number;
  /** Measured, NOT blocking — history is preserved. #186 §7. Reported so it stays visible. */
  readonly historicalFindings: number;
  /** Families the census could not read. Each blocks: an unread family is not a clean zero. */
  readonly unreadable: readonly string[];
  /** Families measured over a page rather than a population. Each blocks. */
  readonly truncated: readonly string[];
  /** Families for which accountability is NOT APPLICABLE. Named, and contributing NOTHING. */
  readonly notApplicable: readonly string[];
  readonly totals: AccountabilityCounts;
  readonly actionable: AccountabilityCounts;
  readonly historical: AccountabilityCounts;
  readonly assessable: boolean;
  /** How many families were actually measured. ZERO is never assessable — see below. */
  readonly measuredFamilies: number;
}

/**
 * Reduce the family reports to the gate's input.
 *
 * ════════════════════ WHAT BLOCKS, AND WHY EACH ONE ════════════════════
 *
 * ON AN ACTIONABLE RECORD: `missing` (#180 — exactly one accountable person, absent a governed
 * exception) · `presentInvalid` (#182 state C) · `presentUnreadable` (#189 `MI-λ` — a legacy
 * unresolved reference "cannot satisfy current responsibility integrity") · and
 * `presentValidNotCurrentlyEligible`, which is the one that is easiest to get wrong in the lenient
 * direction. #189 `MI-ε`: "the actionable record may become RESPONSIBILITY DEFECT — ACCOUNTABLE PERSON
 * NOT CURRENTLY ELIGIBLE... the census must detect the defect."
 *
 * IN EITHER CONTEXT: `authorityUnavailable`. It blocks on a HISTORICAL record too, and that is not an
 * oversight — we do not know what the record holds, so we cannot know that it is history we are
 * looking at rather than a current defect. #187 §2's fail-closed means the unknown blocks.
 *
 * WHAT DOES NOT BLOCK: every finding on a HISTORICAL record other than an unobtainable answer (#186
 * §7 — "Do not rewrite history. Do not invalidate historical audit solely because the employee is not
 * currently eligible"), and `governedException` in either context (#180).
 *
 * ════════════════════ ZERO MEASURED FAMILIES IS NEVER ASSESSABLE ════════════════════
 *
 * `measuredFamilies === 0` makes `assessable` false even with nothing blocking, because a gate that
 * passed on an empty report would pass hardest when the census was misconfigured. The ownership
 * census's own `censusGate` has the same property by a different route — a family it could not read
 * lands in `unreadable` — and this is the accountability axis's version of it.
 */
export function accountabilityCensusVerdict(
  entries: readonly AccountabilityCensusEntry[],
): AccountabilityCensusVerdict {
  const unreadable = entries.filter(isCensusError).map((e) => e.family);
  const notApplicable = entries.filter(isNotApplicable).map((e) => e.family);
  const measured = entries.filter(isMeasured);

  const totals = emptyAccountabilityCounts();
  const actionable = emptyAccountabilityCounts();
  const historical = emptyAccountabilityCounts();
  for (const report of measured) {
    for (const bucket of ACCOUNTABILITY_BUCKETS) {
      totals[bucket] += report.counts[bucket];
      actionable[bucket] += report.actionable[bucket];
      historical[bucket] += report.historical[bucket];
    }
  }

  const blocking =
    actionable.missing +
    actionable.presentInvalid +
    actionable.presentUnreadable +
    actionable.presentValidNotCurrentlyEligible +
    // BOTH contexts. An unobtainable answer is not evidence that the record is historical.
    actionable.authorityUnavailable +
    historical.authorityUnavailable;

  const historicalFindings =
    historical.missing +
    historical.presentInvalid +
    historical.presentUnreadable +
    historical.presentValidNotCurrentlyEligible;

  const truncated = measured.filter((r) => r.truncated).map((r) => r.family);

  return {
    blocking,
    authorityUnavailable: totals.authorityUnavailable,
    historicalFindings,
    unreadable,
    truncated,
    notApplicable,
    totals,
    actionable,
    historical,
    measuredFamilies: measured.length,
    assessable:
      blocking === 0 && unreadable.length === 0 && truncated.length === 0 && measured.length > 0,
  };
}
