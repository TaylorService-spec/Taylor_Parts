// THE RESPONSIBILITY ENFORCEMENT GATE — where the two axes compose WITHOUT collapsing.
//
// ════════════════════ THE SHAPE THE RULING DREW ════════════════════
//
// #187 §1 (`MI-Y`, option ii) drew it literally:
//
//     OWNERSHIP CENSUS + ACCOUNTABILITY CENSUS + other required governed integrity facts
//         → RESPONSIBILITY / ENFORCEMENT GATE
//
// This module is the arrow. `functions/src/ownership/ownershipCensus.ts` is the first box and
// `functions/src/responsibility/accountabilityCensus.ts` is the second; nothing here computes either
// census, and nothing here can turn one into the other.
//
// ════════════════════ COMPOSED, NOT COLLAPSED — AND WHAT THAT MEANS IN CODE ════════════════════
//
// The tempting implementation is one number: `blocking = ownership.blocking + accountability.blocking`.
// It is refused, and the reason is #180 rather than taste: OWNERSHIP and ACCOUNTABILITY are different
// business questions with different remedies. A summed number tells an operator that thirty things are
// wrong and nothing about whether to transfer a customer relationship or to hand off responsibility for
// an open deal — and those are not interchangeable actions.
//
// So three mechanisms keep them apart, none of which is a comment:
//
//   1. EACH AXIS'S VERDICT IS CARRIED WHOLE. `ownership` is exactly what `censusGate` returned and
//      `accountability` is exactly what `accountabilityCensusVerdict` returned. Neither is rewritten,
//      re-bucketed or summed into the other.
//   2. EVERY DEFECT IS TAGGED WITH ITS AXIS, and the codes are disjoint by construction — an ownership
//      code cannot be produced from an accountability count, because the two are built by two functions
//      that each read one verdict.
//   3. THERE IS NO COMBINED `blocking` COUNT. The only combined value is the BOOLEAN `enforceable`,
//      because "may enforcement be assessed" genuinely is one question. A caller that wants a number
//      has to name an axis.
//
// ════════════════════ NOT APPLICABLE MUST NOT FAIL THE GATE ════════════════════
//
// #189 `OD-16`: "Out-of-scope families: accountability is NOT APPLICABLE — not MISSING, not OWNERLESS,
// not DEFECTIVE. Reference and master-data objects must not acquire fake personal accountability."
//
// The ownership census covers ~30 families. The accountability census covers 3. The gate therefore
// DOES NOT REQUIRE COVERAGE PARITY between the two, and an ownership-censused family with no
// accountability storage contributes NOTHING to the accountability side. That is not achieved by
// filtering a defect out at the end — a filter is a thing somebody removes — but by the accountability
// census reporting such a family with NO COUNTS AT ALL, so there is no number here to ignore.
//
// What the gate DOES require is that every family that IS in governed accountability scope was
// actually censused. Otherwise a run could pass by simply not looking, which is the same vacuous pass
// in a different costume.
//
// ════════════════════ FAIL CLOSED ════════════════════
//
// #187 §2: `AUTHORITY_UNAVAILABLE` "must FAIL CLOSED... must not be represented as healthy empty
// data". Here that has a specific meaning: `failClosed` is true when either axis could not obtain an
// answer — an unreadable census family, a truncated scan, or an unobtainable Employee answer — and
// `enforceable` is false whenever `failClosed` is true, regardless of how few record-level defects were
// found. An unknown is not a pass.
//
// PURE. This module reads two verdict objects and returns a third. No storage, no authority, no clock,
// no Firebase, no `node:` module — and no census computation of its own, so it cannot disagree with
// either census about what it found.

import { censusGate, type CensusFamilyError, type CensusFamilyReport } from "../ownership/ownershipCensus";
import { ACCOUNTABILITY_FAMILIES } from "./accountabilityFamilyScope";
import {
  accountabilityCensusVerdict,
  isCensusError,
  isMeasured,
  isNotApplicable,
  type AccountabilityCensusEntry,
  type AccountabilityCensusVerdict,
} from "./accountabilityCensus";

/** The axes this gate composes. TWO, and #187 `M-1` keeps ASSIGNMENT out of both. */
export const RESPONSIBILITY_GATE_AXES = Object.freeze(["RECORD_OWNERSHIP", "ACCOUNTABILITY"] as const);

export type ResponsibilityGateAxis = (typeof RESPONSIBILITY_GATE_AXES)[number];

/**
 * Every way responsibility integrity can be outstanding. DISJOINT BY AXIS: the `OWNERSHIP_` codes are
 * produced only from the ownership verdict and the `ACCOUNTABILITY_` codes only from the accountability
 * one, so a reader can tell from the code alone which census found it.
 */
export type ResponsibilityDefectCode =
  // ── RECORD OWNERSHIP ────────────────────────────────────────────────────────────────────────────
  /** Records the ownership census could not resolve to exactly one governed owner. */
  | "OWNERSHIP_INTEGRITY_OUTSTANDING"
  /** A family the ownership census could not read. Not a clean zero. */
  | "OWNERSHIP_CENSUS_UNREADABLE"
  /** A family measured over a page rather than a population. */
  | "OWNERSHIP_CENSUS_TRUNCATED"
  // ── ACCOUNTABILITY ──────────────────────────────────────────────────────────────────────────────
  /** An ACTIONABLE record in scope with no accountable person. #180, absent a governed exception. */
  | "ACCOUNTABILITY_MISSING"
  /** An ACTIONABLE record whose accountable person resolves to no governed Employee. #182 state C. */
  | "ACCOUNTABILITY_REFERENCE_INVALID"
  /** An ACTIONABLE record whose stored value could never be an Employee id. #189 `MI-λ`. */
  | "ACCOUNTABILITY_REFERENCE_UNREADABLE"
  /**
   * An ACTIONABLE record whose accountable person is a VALID reference but is NOT CURRENTLY ELIGIBLE.
   *
   * #189 `MI-ε`: "the actionable record may become RESPONSIBILITY DEFECT — ACCOUNTABLE PERSON NOT
   * CURRENTLY ELIGIBLE... the census must detect the defect." It is a DEFECT and NOT an invalid
   * reference, which is why it has its own code rather than being folded into the one above.
   */
  | "ACCOUNTABILITY_NOT_CURRENTLY_ELIGIBLE"
  /** EOS could not obtain an authoritative Employee answer. #187 §2. FAIL CLOSED, both contexts. */
  | "ACCOUNTABILITY_AUTHORITY_UNAVAILABLE"
  /** A family the accountability census could not read. */
  | "ACCOUNTABILITY_CENSUS_UNREADABLE"
  /** A family measured over a page rather than a population. */
  | "ACCOUNTABILITY_CENSUS_TRUNCATED"
  /** A family IN governed accountability scope that was not censused at all. Never a pass. */
  | "ACCOUNTABILITY_FAMILY_NOT_CENSUSED"
  /** The accountability census measured NOTHING. An empty report is not a clean one. */
  | "ACCOUNTABILITY_CENSUS_EMPTY";

/** One outstanding fact. Carries its axis, so the two are never confused at the point of reading. */
export interface ResponsibilityDefect {
  readonly axis: ResponsibilityGateAxis;
  readonly code: ResponsibilityDefectCode;
  /** How many records or families. Never a sum across axes. */
  readonly count: number;
  /** Which families, where the defect is per-family rather than per-record. */
  readonly families: readonly string[];
  /** What it means and what it does NOT mean. Written for the operator who has to act on it. */
  readonly detail: string;
}

export interface ResponsibilityGateInput {
  /** Exactly what the ownership census produced. Reports and errors, unfiltered. */
  readonly ownership: readonly (CensusFamilyReport | CensusFamilyError)[];
  /** Exactly what the accountability census produced, NOT APPLICABLE entries included. */
  readonly accountability: readonly AccountabilityCensusEntry[];
}

export interface ResponsibilityGateVerdict {
  /** The ownership axis's own verdict, UNCHANGED. `censusGate`'s return value verbatim. */
  readonly ownership: ReturnType<typeof censusGate>;
  /** The accountability axis's own verdict, UNCHANGED. */
  readonly accountability: AccountabilityCensusVerdict;
  /** Every outstanding fact, tagged by axis. NEVER a single merged number. */
  readonly defects: readonly ResponsibilityDefect[];
  /** Families for which accountability is NOT APPLICABLE. Named so their absence is visible, and
   *  contributing NOTHING to any defect. #189 `OD-16`. */
  readonly accountabilityNotApplicable: readonly string[];
  /** True when either axis failed to obtain an answer. #187 §2. */
  readonly failClosed: boolean;
  /** May responsibility enforcement be assessed? The ONE genuinely combined value. */
  readonly enforceable: boolean;
}

const defect = (
  axis: ResponsibilityGateAxis,
  code: ResponsibilityDefectCode,
  count: number,
  families: readonly string[],
  detail: string,
): ResponsibilityDefect => ({ axis, code, count, families: Object.freeze([...families]), detail });

/**
 * The ownership half. Reads the ownership verdict and NOTHING else.
 *
 * It reports ONE record-level code rather than five, and that is the ownership census's own shape
 * rather than a simplification: `censusGate` already returns `blocking` as the sum of its four
 * non-resolved buckets, and the per-bucket breakdown stays available on `verdict.ownership.totals`.
 * Re-deriving five codes here would be this module re-interpreting a census it does not own.
 */
function ownershipDefects(verdict: ReturnType<typeof censusGate>): ResponsibilityDefect[] {
  const defects: ResponsibilityDefect[] = [];
  if (verdict.blocking > 0) {
    defects.push(
      defect(
        "RECORD_OWNERSHIP",
        "OWNERSHIP_INTEGRITY_OUTSTANDING",
        verdict.blocking,
        [],
        `${verdict.blocking} record(s) do not resolve to exactly one governed owner ` +
          `(ownerless ${verdict.totals.ownerless} · invalid ${verdict.totals.invalid} · unknown ` +
          `${verdict.totals.unknown} · ambiguous ${verdict.totals.ambiguous}). This is the RECORD ` +
          "OWNERSHIP axis: it is about who owns the record, and it is not an accountability finding.",
      ),
    );
  }
  if (verdict.unreadable.length > 0) {
    defects.push(
      defect(
        "RECORD_OWNERSHIP",
        "OWNERSHIP_CENSUS_UNREADABLE",
        verdict.unreadable.length,
        verdict.unreadable,
        "the ownership census could not read these families. A family that counted as zero would let " +
          "enforcement be enabled over records nobody managed to look at.",
      ),
    );
  }
  if (verdict.truncated.length > 0) {
    defects.push(
      defect(
        "RECORD_OWNERSHIP",
        "OWNERSHIP_CENSUS_TRUNCATED",
        verdict.truncated.length,
        verdict.truncated,
        "these families were measured over a page rather than a population; a gate decided on a page " +
          "is a guess wearing a number's clothes.",
      ),
    );
  }
  return defects;
}

/**
 * The accountability half. Reads the accountability verdict and NOTHING else.
 *
 * Per-record codes come from the ACTIONABLE counts only, except `AUTHORITY_UNAVAILABLE` which is taken
 * from the total. #186 §7 is why: a HISTORICAL record's invalid or ineligible person is preserved
 * history and is NOT a defect, while an unobtainable answer is not evidence that the record is
 * historical at all.
 */
function accountabilityDefects(verdict: AccountabilityCensusVerdict): ResponsibilityDefect[] {
  const defects: ResponsibilityDefect[] = [];
  const perRecord: readonly [ResponsibilityDefectCode, number, string][] = [
    [
      "ACCOUNTABILITY_MISSING",
      verdict.actionable.missing,
      "actionable record(s) in governed accountability scope carry NO accountable person. #180 requires " +
        "exactly one accountable person for every actionable business item, absent an explicit " +
        "Owner-approved exception.",
    ],
    [
      "ACCOUNTABILITY_REFERENCE_INVALID",
      verdict.actionable.presentInvalid,
      "actionable record(s) name an accountable person that resolves to NO governed Employee. The " +
        "authority answered; the reference does not resolve (#182 state C).",
    ],
    [
      "ACCOUNTABILITY_REFERENCE_UNREADABLE",
      verdict.actionable.presentUnreadable,
      "actionable record(s) hold a stored value that could never be an Employee id. Quarantine it; do " +
        "not overwrite it and do not delete it (#189 MI-lambda).",
    ],
    [
      "ACCOUNTABILITY_NOT_CURRENTLY_ELIGIBLE",
      verdict.actionable.presentValidNotCurrentlyEligible,
      "actionable record(s) name a VALID accountable person who is NOT CURRENTLY ELIGIBLE. The " +
        "reference and all historical accountability REMAIN VALID (#186 s7); the current responsibility " +
        "state is the defect (#189 MI-epsilon). Resolution is a governed handoff -- there is no " +
        "automatic reassignment and no automatic transfer.",
    ],
  ];
  for (const [code, count, detail] of perRecord) {
    if (count > 0) defects.push(defect("ACCOUNTABILITY", code, count, [], `${count} ${detail}`));
  }
  if (verdict.authorityUnavailable > 0) {
    defects.push(
      defect(
        "ACCOUNTABILITY",
        "ACCOUNTABILITY_AUTHORITY_UNAVAILABLE",
        verdict.authorityUnavailable,
        [],
        `${verdict.authorityUnavailable} record(s) could not be answered for by the Employee authority. ` +
          "This is NOT a finding that those people are missing or invalid, and no other store may be " +
          "consulted instead (#187 s2). It fails closed in BOTH the actionable and historical contexts, " +
          "because an unobtainable answer is not evidence that a record is history.",
      ),
    );
  }
  if (verdict.unreadable.length > 0) {
    defects.push(
      defect(
        "ACCOUNTABILITY",
        "ACCOUNTABILITY_CENSUS_UNREADABLE",
        verdict.unreadable.length,
        verdict.unreadable,
        "the accountability census could not read these families.",
      ),
    );
  }
  if (verdict.truncated.length > 0) {
    defects.push(
      defect(
        "ACCOUNTABILITY",
        "ACCOUNTABILITY_CENSUS_TRUNCATED",
        verdict.truncated.length,
        verdict.truncated,
        "these families were measured over a page rather than a population.",
      ),
    );
  }
  return defects;
}

/**
 * COMPOSE. The gate.
 *
 * Every argument is a census RESULT. This function measures nothing, so it cannot produce a number
 * neither census found.
 */
export function responsibilityEnforcementGate(
  input: ResponsibilityGateInput,
): ResponsibilityGateVerdict {
  const ownership = censusGate(input.ownership ?? []);
  const accountabilityEntries = input.accountability ?? [];
  const accountability = accountabilityCensusVerdict(accountabilityEntries);

  const defects = [...ownershipDefects(ownership), ...accountabilityDefects(accountability)];

  // COVERAGE, on the accountability axis only. The gate requires that every family IN governed scope
  // was actually looked at -- otherwise a run passes by not looking, which is the vacuous pass in a
  // different costume. It deliberately does NOT require the reverse: an ownership family with no
  // accountability storage is NOT APPLICABLE and owes this gate nothing (#189 OD-16).
  const seen = new Set<string>();
  for (const entry of accountabilityEntries) {
    if (isMeasured(entry) || isCensusError(entry) || isNotApplicable(entry)) seen.add(entry.family);
  }
  const notCensused = ACCOUNTABILITY_FAMILIES.filter((family) => !seen.has(family));
  if (notCensused.length > 0) {
    defects.push(
      defect(
        "ACCOUNTABILITY",
        "ACCOUNTABILITY_FAMILY_NOT_CENSUSED",
        notCensused.length,
        notCensused,
        "these families carry governed ACCOUNTABLE PERSON semantics (#189 OD-16) and were not censused " +
          "at all. A gate that passed because a family was never measured would pass hardest when the " +
          "census was misconfigured.",
      ),
    );
  }
  if (accountability.measuredFamilies === 0) {
    defects.push(
      defect(
        "ACCOUNTABILITY",
        "ACCOUNTABILITY_CENSUS_EMPTY",
        0,
        [],
        "the accountability census measured NO family. Zero measured families can never be a pass: " +
          "'every accountable person is valid and eligible' is vacuously true over an empty set.",
      ),
    );
  }

  // FAIL CLOSED. An unobtainable answer on either axis, in any of its three forms.
  const failClosed =
    ownership.unreadable.length > 0 ||
    ownership.truncated.length > 0 ||
    accountability.unreadable.length > 0 ||
    accountability.truncated.length > 0 ||
    accountability.authorityUnavailable > 0;

  return {
    ownership,
    accountability,
    defects: Object.freeze(defects),
    accountabilityNotApplicable: accountability.notApplicable,
    failClosed,
    // BOTH axes, and never one standing in for the other. `assessable` on each side already carries
    // that axis's own rule; `failClosed` catches the unknowns; and `defects.length === 0` is the
    // record-level statement. All three must hold.
    enforceable: ownership.assessable && accountability.assessable && !failClosed && defects.length === 0,
  };
}

/** The defects for one axis. The way a caller asks for a number — by naming which axis it is about. */
export function defectsForAxis(
  verdict: ResponsibilityGateVerdict,
  axis: ResponsibilityGateAxis,
): readonly ResponsibilityDefect[] {
  return verdict.defects.filter((d) => d.axis === axis);
}
