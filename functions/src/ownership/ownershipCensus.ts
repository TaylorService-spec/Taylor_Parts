// EOS Ownership Model v1 — the census CLASSIFIER (Owner authorization, next-pass item 12).
//
// The counting logic lives here, under typecheck and under test, rather than inside the CLI
// script that reads Firestore. A census whose classification rules only exist in an unrunnable
// script is a number nobody can check, and this number decides whether enforcement may be turned
// on -- so it is exercised by functions/test/ownershipCensus.test.mjs against a fake document
// source, with no emulator and no credentials.
//
// READ-ONLY BY CONSTRUCTION: nothing in this module can write. It takes documents and returns
// counts.
//
// It classifies using the SAME derivations the runtime uses (typedOwner.ts) over the SAME family
// declarations the handoff command uses (ownershipMatrix.ts), so a census total cannot disagree
// with what the application would derive for the same document.

import {
  OWNERSHIP_RESOLUTION,
  combineOwnerDerivations,
  deriveAccountOwner,
  deriveCompanyOwner,
  deriveEmployeeRefOwner,
  deriveStoredOwner,
  type OwnerDerivation,
} from "./typedOwner";
import { OWNERSHIP_MATRIX, ownableFamilies, type OwnershipFamily } from "./ownershipMatrix";
import { resolveOperatingCompany } from "./operatingCompanyAuthority";

export const MAX_SAMPLE_IDS = 10;

/**
 * The census buckets, per the Owner's census ruling (2026-08-30). UNRESOLVED is REPORTED as its two
 * constituent facts rather than as one number, because they call for different work:
 *
 *   resolved   exactly one governed owner was derived
 *   ownerless  no ownership-bearing field is present at all -- a decision to make
 *   invalid    a value IS present and is malformed or the wrong shape -- data to repair
 *   unknown    a well-formed value naming nothing this build recognises -- nothing broken
 *   ambiguous  two ownership-bearing fields resolve to DIFFERENT owners -- needs a human
 *
 * `invalid + unknown` is the old `unresolved` total, and nothing is double-counted: every document
 * lands in exactly one bucket.
 */
export interface CensusCounts {
  resolved: number;
  ownerless: number;
  invalid: number;
  unknown: number;
  ambiguous: number;
}

/** Reason strings tallied per bucket, so a large family reports WHY without listing every id. */
export type ReasonTally = Record<string, number>;

export interface CensusFamilyReport {
  family: string;
  collection: string;
  ownerClass: string;
  // Never null on a census row: only PERSON and COMPANY families are censused, and both carry an
  // owner type. REFERENCE/EXCLUDED families -- the ones with a null type -- are not scanned at all.
  ownerType: string;
  scanned: number;
  truncated: boolean;
  counts: CensusCounts;
  /** reason -> count, for every non-resolved document. The volume-safe form of the sample list. */
  reasons: ReasonTally;
  samples: { invalid: string[]; unknown: string[]; ambiguous: string[]; ownerless: string[] };
}

/** A family the census could not read. Distinct from an empty family, and it blocks the gate. */
export interface CensusFamilyError {
  family: string;
  collection: string;
  ownerClass: string;
  ownerType: string;
  error: string;
}

const emptyCounts = (): CensusCounts => ({ resolved: 0, ownerless: 0, invalid: 0, unknown: 0, ambiguous: 0 });

/** Which bucket a derivation lands in. The one place resolution+code becomes a column. */
export function censusBucket(derivation: OwnerDerivation): keyof CensusCounts {
  if (derivation.resolution === OWNERSHIP_RESOLUTION.RESOLVED) return "resolved";
  if (derivation.resolution === OWNERSHIP_RESOLUTION.OWNERLESS) return "ownerless";
  if (derivation.resolution === OWNERSHIP_RESOLUTION.AMBIGUOUS) return "ambiguous";
  // UNRESOLVED without a code should be impossible -- every UNRESOLVED path sets one. Counting an
  // uncoded one as INVALID keeps it visible rather than dropping it from the totals.
  return derivation.code === "UNKNOWN" ? "unknown" : "invalid";
}

export interface CensusDocument {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Classify one document against its family's declared ownership storage.
 *
 * A family with NO declared ownerFields is OWNERLESS by construction. That is the honest answer
 * for the entire company-owned section until `operatingCompanyId` exists, and it is reported
 * rather than skipped -- a skipped family would read as a clean zero, which is the one wrong
 * answer a gate like this must never produce.
 */
export function classifyDocument(family: OwnershipFamily, data: Record<string, unknown>): OwnerDerivation {
  // PARTICIPATING_COMPANIES resolves only when BOTH participants are present. One of two is not
  // half-owned -- it is a transaction that does not yet say where it went, which is unresolved.
  if (family.ownerClass === "PARTICIPATING_COMPANIES") {
    const fields = family.participatingFields ?? [];
    const present = fields.filter((f) => typeof data?.[f] === "string" && data[f].trim().length > 0);
    if (present.length === 0) {
      return { resolution: OWNERSHIP_RESOLUTION.OWNERLESS, owner: null, reason: "no participating companies recorded", code: null };
    }
    if (present.length < fields.length) {
      return {
        resolution: OWNERSHIP_RESOLUTION.UNRESOLVED, owner: null,
        reason: `only ${present.length} of ${fields.length} participating companies recorded`, code: "INVALID",
      };
    }
    const unresolved = present.filter((f) => resolveOperatingCompany(data[f]).company === null);
    if (unresolved.length > 0) {
      return { resolution: OWNERSHIP_RESOLUTION.UNRESOLVED, owner: null, reason: `participating company not governed: ${unresolved.join(", ")}`, code: "UNKNOWN" };
    }
    // No single `owner` is produced, and that is the point -- the shape IS the pair.
    return { resolution: OWNERSHIP_RESOLUTION.RESOLVED, owner: null, reason: null, code: null };
  }
  // A COMPANY family may hold a PARTICIPATING PAIR on individual records: an inventory movement
  // between two companies takes source+destination rather than one owner, exactly as a transfer
  // does. The family is still single-company in the ordinary case, so the pair is a fallback rather
  // than the declaration -- and without it the census reports a correctly-recorded cross-company
  // movement as OWNERLESS, which is the reader being wrong about the data rather than the reverse.
  if (family.ownerClass === "COMPANY" && (family.participatingFields?.length ?? 0) > 0) {
    const scalarPresent = family.ownerFields.some((f) => data?.[f] !== undefined);
    if (!scalarPresent) {
      const pair = family.participatingFields!;
      const present = pair.filter((f) => typeof data?.[f] === "string" && (data[f] as string).trim().length > 0);
      if (present.length === pair.length) {
        const ungoverned = present.filter((f) => resolveOperatingCompany(data[f]).company === null);
        if (ungoverned.length > 0) {
          return {
            resolution: OWNERSHIP_RESOLUTION.UNRESOLVED,
            owner: null,
            reason: `participating company not governed: ${ungoverned.join(", ")}`,
            code: "UNKNOWN",
          };
        }
        return { resolution: OWNERSHIP_RESOLUTION.RESOLVED, owner: null, reason: null, code: null };
      }
      if (present.length > 0) {
        return {
          resolution: OWNERSHIP_RESOLUTION.UNRESOLVED,
          owner: null,
          reason: `only ${present.length} of ${pair.length} participating companies recorded`,
          code: "INVALID",
        };
      }
    }
  }
  if (family.ownerFields.length === 0) {
    return {
      resolution: OWNERSHIP_RESOLUTION.OWNERLESS,
      owner: null,
      reason: "family has no ownership storage yet",
      code: null,
    };
  }
  const derivations = family.ownerFields.map((field) => {
    if (field === "accountOwner") return deriveAccountOwner(data);
    // The typed owner the backfill writes. Without this the census reports a backfilled record as
    // OWNERLESS -- a projection that cannot read its own storage describes a backlog that is gone.
    if (field === "owner") return deriveStoredOwner(data, field);
    if (family.ownerType === "COMPANY") return deriveCompanyOwner(data, field);
    return deriveEmployeeRefOwner(data, field);
  });
  return combineOwnerDerivations(derivations);
}

/** Tally one family's documents. `truncated` says a --limit cut the scan short -- never silently. */
export function censusFamily(
  family: OwnershipFamily,
  documents: readonly CensusDocument[],
  truncated = false,
): CensusFamilyReport {
  const counts = emptyCounts();
  const reasons: ReasonTally = {};
  const samples: CensusFamilyReport["samples"] = { invalid: [], unknown: [], ambiguous: [], ownerless: [] };

  for (const doc of documents) {
    const derivation = classifyDocument(family, doc.data);
    const key = censusBucket(derivation);
    counts[key] += 1;
    if (key === "resolved") continue;
    // The reason TALLY is the volume-safe answer: a family with 40,000 ownerless rows reports one
    // line saying so, instead of 40,000 ids or a truncated sample that hides the shape.
    const reason = derivation.reason ?? "(no reason given)";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    if (samples[key].length < MAX_SAMPLE_IDS) samples[key].push(doc.id);
  }

  return {
    family: family.family,
    collection: family.collection,
    ownerClass: family.ownerClass,
    ownerType: family.ownerType ?? "",
    scanned: documents.length,
    truncated,
    counts,
    reasons,
    samples,
  };
}

/**
 * The gate the ruling defined: enforcement may be assessed only when NOTHING is outstanding.
 *
 * A family that could not be READ blocks the gate too. A permission or index failure that counted
 * as zero would let enforcement be enabled over records nobody managed to look at -- the exact
 * failure mode "do not deploy enforcement solely because the code exists" is guarding against.
 */
export function censusGate(reports: readonly (CensusFamilyReport | CensusFamilyError)[]): {
  blocking: number;
  unreadable: string[];
  truncated: string[];
  totals: CensusCounts;
  assessable: boolean;
} {
  const unreadable = reports.filter((r): r is CensusFamilyError => "error" in r).map((r) => r.family);
  const ok = reports.filter((r): r is CensusFamilyReport => !("error" in r));
  const totals = emptyCounts();
  for (const r of ok) {
    for (const k of Object.keys(totals) as (keyof CensusCounts)[]) totals[k] += r.counts[k];
  }
  const blocking = totals.ownerless + totals.invalid + totals.unknown + totals.ambiguous;
  // A TRUNCATED family also blocks. A --limit run measured a page, not a population, and a gate
  // decided on a page would be a guess wearing a number's clothes.
  const truncated = ok.filter((r) => r.truncated).map((r) => r.family);
  return {
    blocking,
    unreadable,
    truncated,
    totals,
    assessable: blocking === 0 && unreadable.length === 0 && truncated.length === 0,
  };
}

/**
 * Every family the census must cover: the OWNABLE ones (ruling D-8). REFERENCE and EXCLUDED
 * families are deliberately absent -- they are not ownerless-in-error, they are not owned, and
 * counting them would report a backlog that no decision could ever clear.
 *
 * Exported so the CLI cannot iterate a narrower list of its own choosing.
 */
export const CENSUS_FAMILIES: readonly OwnershipFamily[] = ownableFamilies();

/** The full matrix, for reporting the classification itself rather than the ownership counts. */
export const ALL_FAMILIES: readonly OwnershipFamily[] = OWNERSHIP_MATRIX;
