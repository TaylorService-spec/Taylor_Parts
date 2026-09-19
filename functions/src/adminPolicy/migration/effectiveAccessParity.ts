// ████████████████████████████ TEMPORARY ████████████████████████████
//
// EFFECTIVE-ACCESS PARITY -- the deterministic proof required BEFORE any Security Role assignment migrates.
//
// Pure: no database, no Firebase, no I/O, no clock. Both sides arrive as already-gathered FACTS, so the comparison
// is a function of its inputs and two runs over the same evidence produce identical verdicts.
//
// ════════════════════ WHAT IT PROVES, AND WHAT IT DOES NOT ════════════════════
//
// It answers ONE question per Principal: would moving Security Role assignment authority to PostgreSQL change what
// this Principal can do? It does NOT migrate anything, does NOT activate the PostgreSQL assignment authority, and
// does NOT relax the census's MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY. Evaluator code existing is not parity
// proven; this module is how parity gets proven, and it is a separate gate from acting on the result.
//
// ════════════════════ THE VERDICTS ════════════════════
//
//   EXACT_PARITY                  both authorities answer identically. The only verdict that needs no ruling.
//   APPROVED_RETIREMENT_NARROWING PostgreSQL grants LESS, and the difference is explained by an ALREADY-APPROVED
//                                 retirement ruling named in the comparison. Narrowing is safe in kind, but it is
//                                 only ACCEPTABLE when somebody decided it deliberately.
//   UNAPPROVED_NARROWING          PostgreSQL grants less with no approved ruling. Blocks migration: an unexplained
//                                 loss of access is a defect until someone says otherwise.
//   WIDENING_BLOCKER              PostgreSQL grants MORE. HARD STOP, always, with no approval path in this module.
//   UNRESOLVED_EVIDENCE           the comparison cannot be made -- an unresolved subject, a malformed row, a Role
//                                 outside the governed catalog. Blocks migration: an unanswerable question has not
//                                 been answered.
//
// WIDENING IS NEVER APPROVABLE HERE. A narrowing can be justified by a ruling; a widening cannot, because the whole
// purpose of the gate is that migration must not hand anybody access they do not already have. There is deliberately
// no parameter, allowlist or flag that converts a widening into an acceptable outcome.
//
// ════════════════════ NO FUZZY MAPPING ════════════════════
//
// An approved narrowing must be declared as an EXACT (roleKey, capability) pair against a named ruling. Nothing is
// matched by prefix, similarity or category, and nothing is inferred from a Job Role, a title or a legacy
// operationalRole value. A difference that is not exactly declared is UNAPPROVED_NARROWING, which blocks.
export const PARITY_VERDICTS = Object.freeze([
  "EXACT_PARITY", "APPROVED_RETIREMENT_NARROWING", "UNAPPROVED_NARROWING", "WIDENING_BLOCKER", "UNRESOLVED_EVIDENCE",
] as const);
export type ParityVerdict = (typeof PARITY_VERDICTS)[number];

/** Verdicts that permit migration to proceed for that Principal. Everything else blocks. */
export const MIGRATION_PERMITTING_VERDICTS: readonly ParityVerdict[] = Object.freeze(["EXACT_PARITY", "APPROVED_RETIREMENT_NARROWING"]);

/** One grant, identified exactly. A global grant carries no scope value in either store. */
export interface EffectiveGrant {
  readonly roleKey: string;
  readonly scopeType: string;
  readonly scopeValue: string | null;
  /** Capability keys this grant confers, already resolved by the side that produced it. */
  readonly capabilities: readonly string[];
  /** Capability keys this grant confers ONLY under a Condition. Parity must preserve conditioned-ness exactly. */
  readonly conditionedCapabilities: readonly string[];
}

/** What one authority says about one Principal. Gathered by the caller; never resolved here. */
export interface EffectiveAccessFacts {
  readonly principalId: string;
  /** False when the Principal is disabled, has no membership, or its membership is not active. */
  readonly membershipActive: boolean;
  readonly grants: readonly EffectiveGrant[];
  /**
   * Anything that made this side's answer indeterminate: an unresolved legacy subject, a malformed assignment row,
   * a Role outside the governed catalog. A non-empty list forces UNRESOLVED_EVIDENCE regardless of what else agrees.
   */
  readonly unresolved: readonly string[];
}

/** An approved deliberate narrowing, declared EXACTLY and tied to the ruling that approved it. */
export interface ApprovedNarrowing {
  readonly roleKey: string;
  readonly capability: string;
  /** The ruling that approved it, e.g. "R-32". Required: an approval with no ruling is not an approval. */
  readonly ruling: string;
}

export interface ParityDifference {
  readonly kind: "CAPABILITY_ONLY_IN_LEGACY" | "CAPABILITY_ONLY_IN_POSTGRES" | "GRANT_ONLY_IN_LEGACY"
    | "GRANT_ONLY_IN_POSTGRES" | "SCOPE_DIFFERS" | "CONDITION_DIFFERS" | "MEMBERSHIP_DIFFERS";
  readonly detail: string;
  /** The ruling approving this difference, when one applies. Null otherwise. */
  readonly ruling: string | null;
}

export interface ParityComparison {
  readonly principalId: string;
  readonly verdict: ParityVerdict;
  readonly differences: readonly ParityDifference[];
  readonly migrationPermitted: boolean;
}

const key = (g: { roleKey: string; scopeType: string; scopeValue: string | null }) =>
  `${g.roleKey}|${g.scopeType}|${g.scopeValue ?? ""}`;

const sorted = (xs: readonly string[]) => [...new Set(xs)].sort();

/**
 * Compare one Principal's effective access across the two authorities.
 *
 * ORDER OF PRECEDENCE, and it is not arbitrary:
 *
 *   1. UNRESOLVED_EVIDENCE   an indeterminate side cannot be compared, so nothing else it says can be trusted.
 *   2. WIDENING_BLOCKER      a widening outranks every narrowing found alongside it. A comparison that both gains
 *                            and loses access is still, first, a comparison that gains access.
 *   3. narrowing             approved only when EVERY narrowing difference is exactly declared.
 *   4. EXACT_PARITY          no differences at all.
 */
export function compareEffectiveAccess(
  legacy: EffectiveAccessFacts, postgres: EffectiveAccessFacts, approved: readonly ApprovedNarrowing[] = [],
): ParityComparison {
  if (legacy.principalId !== postgres.principalId) {
    return frozen(legacy.principalId, "UNRESOLVED_EVIDENCE", [{
      kind: "MEMBERSHIP_DIFFERS", detail: "the two sides describe different Principals", ruling: null,
    }]);
  }
  const unresolved = [...legacy.unresolved, ...postgres.unresolved];
  if (unresolved.length > 0) {
    return frozen(legacy.principalId, "UNRESOLVED_EVIDENCE",
      sorted(unresolved).map((detail) => ({ kind: "MEMBERSHIP_DIFFERS" as const, detail, ruling: null })));
  }

  const differences: ParityDifference[] = [];
  const widening: ParityDifference[] = [];
  const narrowing: ParityDifference[] = [];

  // MEMBERSHIP. An inactive Principal must be inactive on both sides: becoming active in PostgreSQL is a widening.
  if (legacy.membershipActive !== postgres.membershipActive) {
    const d: ParityDifference = {
      kind: "MEMBERSHIP_DIFFERS",
      detail: `membershipActive legacy=${legacy.membershipActive} postgres=${postgres.membershipActive}`,
      ruling: null,
    };
    (postgres.membershipActive ? widening : narrowing).push(d);
  }
  // A Principal inactive on BOTH sides grants nothing anywhere; comparing its grants would compare two empty answers
  // and could only produce noise.
  if (!legacy.membershipActive && !postgres.membershipActive && widening.length === 0 && narrowing.length === 0) {
    return frozen(legacy.principalId, "EXACT_PARITY", []);
  }

  const legacyByKey = new Map(legacy.grants.map((g) => [key(g), g]));
  const postgresByKey = new Map(postgres.grants.map((g) => [key(g), g]));

  for (const [k, g] of legacyByKey) {
    if (!postgresByKey.has(k)) narrowing.push({ kind: "GRANT_ONLY_IN_LEGACY", detail: k, ruling: null });
  }
  for (const [k, g] of postgresByKey) {
    if (!legacyByKey.has(k)) {
      // A grant PostgreSQL has and legacy does not is a widening -- INCLUDING a grant that differs only by scope,
      // because a scoped grant appearing unscoped is exactly the widening the census refuses.
      widening.push({ kind: "GRANT_ONLY_IN_POSTGRES", detail: k, ruling: null });
      if ([...legacyByKey.keys()].some((lk) => lk.split("|")[0] === g.roleKey)) {
        widening.push({ kind: "SCOPE_DIFFERS", detail: `${g.roleKey} appears at a different scope in PostgreSQL`, ruling: null });
      }
    }
  }

  // Capabilities, per grant both sides agree exists.
  for (const [k, legacyGrant] of legacyByKey) {
    const pgGrant = postgresByKey.get(k);
    if (!pgGrant) continue;
    const legacyCaps = new Set(legacyGrant.capabilities);
    const pgCaps = new Set(pgGrant.capabilities);
    for (const c of sorted(legacyGrant.capabilities)) {
      if (!pgCaps.has(c)) {
        const ruling = approved.find((a) => a.roleKey === legacyGrant.roleKey && a.capability === c)?.ruling ?? null;
        narrowing.push({ kind: "CAPABILITY_ONLY_IN_LEGACY", detail: `${k} :: ${c}`, ruling });
      }
    }
    for (const c of sorted(pgGrant.capabilities)) {
      if (!legacyCaps.has(c)) widening.push({ kind: "CAPABILITY_ONLY_IN_POSTGRES", detail: `${k} :: ${c}`, ruling: null });
    }
    // CONDITIONED-NESS MUST SURVIVE. A capability legacy grants only under a Condition, granted unconditioned by
    // PostgreSQL, is a widening even though both sides "grant" it -- that is precisely the reorder.purchaseOrder.void
    // defect the parity work exists to prevent.
    const legacyConditioned = new Set(legacyGrant.conditionedCapabilities);
    const pgConditioned = new Set(pgGrant.conditionedCapabilities);
    for (const c of sorted(legacyGrant.conditionedCapabilities)) {
      if (pgCaps.has(c) && !pgConditioned.has(c)) {
        widening.push({ kind: "CONDITION_DIFFERS", detail: `${k} :: ${c} is conditioned in legacy and unconditioned in PostgreSQL`, ruling: null });
      }
    }
    for (const c of sorted(pgGrant.conditionedCapabilities)) {
      if (legacyCaps.has(c) && !legacyConditioned.has(c)) {
        narrowing.push({ kind: "CONDITION_DIFFERS", detail: `${k} :: ${c} is conditioned in PostgreSQL and unconditioned in legacy`, ruling: null });
      }
    }
  }

  differences.push(...widening, ...narrowing);
  if (widening.length > 0) return frozen(legacy.principalId, "WIDENING_BLOCKER", differences);
  if (narrowing.length === 0) return frozen(legacy.principalId, "EXACT_PARITY", []);
  // EVERY narrowing must be approved. One unexplained loss makes the whole comparison unapproved: a partial
  // explanation is not an explanation of the rest.
  const allApproved = narrowing.every((d) => d.ruling !== null);
  return frozen(legacy.principalId, allApproved ? "APPROVED_RETIREMENT_NARROWING" : "UNAPPROVED_NARROWING", differences);
}

function frozen(principalId: string, verdict: ParityVerdict, differences: readonly ParityDifference[]): ParityComparison {
  return Object.freeze({
    principalId, verdict,
    differences: Object.freeze(differences.map((d) => Object.freeze(d))),
    migrationPermitted: MIGRATION_PERMITTING_VERDICTS.includes(verdict),
  });
}

export interface ParityReport {
  readonly comparisons: readonly ParityComparison[];
  readonly counts: Readonly<Record<ParityVerdict, number>>;
  /**
   * True only when EVERY Principal's verdict permits migration. One blocker blocks the whole population: assignment
   * migration is not a per-Principal decision anybody makes by hand.
   */
  readonly migrationPermitted: boolean;
  /** Principals whose verdict blocks, so the refusal can name them rather than just refusing. */
  readonly blockedBy: readonly string[];
}

/** Compare a whole population. Deterministic: comparisons are returned sorted by Principal id. */
export function buildParityReport(
  pairs: readonly { readonly legacy: EffectiveAccessFacts; readonly postgres: EffectiveAccessFacts }[],
  approved: readonly ApprovedNarrowing[] = [],
): ParityReport {
  const comparisons = pairs
    .map((p) => compareEffectiveAccess(p.legacy, p.postgres, approved))
    .sort((a, b) => a.principalId.localeCompare(b.principalId));
  const counts = Object.fromEntries(PARITY_VERDICTS.map((v) => [v, 0])) as Record<ParityVerdict, number>;
  for (const c of comparisons) counts[c.verdict] += 1;
  const blockedBy = comparisons.filter((c) => !c.migrationPermitted).map((c) => c.principalId);
  return Object.freeze({
    comparisons: Object.freeze(comparisons),
    counts: Object.freeze(counts),
    // An EMPTY population does not prove parity -- it proves nothing was compared.
    migrationPermitted: comparisons.length > 0 && blockedBy.length === 0,
    blockedBy: Object.freeze(blockedBy),
  });
}

/**
 * Whether the census may stop refusing a given refusal reason.
 *
 * Deliberately narrow: parity being proven for the population is NECESSARY, not sufficient, and this returns a
 * recommendation rather than performing anything. Relaxing the refusal is a separate, reviewed change, and it may
 * never happen in the same PR as the proof.
 */
export function refusalRelaxationCandidates(report: ParityReport): readonly string[] {
  if (!report.migrationPermitted) return Object.freeze([]);
  // SCOPED and CONDITIONED_ROLE are the census's two refusal reasons. Both are representable now that the evaluator
  // consumes scope and evaluates isOwnAssignment -- but only the proof above can say they are representable WITHOUT
  // widening, which is why this is gated on the whole report rather than on the evaluator's existence.
  return Object.freeze(["SCOPED", "CONDITIONED_ROLE"]);
}
