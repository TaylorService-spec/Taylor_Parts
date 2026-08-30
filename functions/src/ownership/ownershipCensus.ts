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
  type OwnerDerivation,
} from "./typedOwner";
import { OWNERSHIP_MATRIX, type OwnershipFamily } from "./ownershipMatrix";

export const MAX_SAMPLE_IDS = 10;

export interface CensusCounts {
  resolved: number;
  unresolved: number;
  ambiguous: number;
  ownerless: number;
}

export interface CensusFamilyReport {
  family: string;
  collection: string;
  ownerType: string;
  scanned: number;
  truncated: boolean;
  counts: CensusCounts;
  samples: { unresolved: string[]; ambiguous: string[]; ownerless: string[] };
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
  if (family.ownerFields.length === 0) {
    return { resolution: OWNERSHIP_RESOLUTION.OWNERLESS, owner: null, reason: "family has no ownership storage yet" };
  }
  const derivations = family.ownerFields.map((field) => {
    if (field === "accountOwner") return deriveAccountOwner(data);
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
  const counts: CensusCounts = { resolved: 0, unresolved: 0, ambiguous: 0, ownerless: 0 };
  const samples: CensusFamilyReport["samples"] = { unresolved: [], ambiguous: [], ownerless: [] };

  for (const doc of documents) {
    const { resolution, reason } = classifyDocument(family, doc.data);
    const key = resolution.toLowerCase() as keyof CensusCounts;
    counts[key] += 1;
    if (key !== "resolved" && samples[key].length < MAX_SAMPLE_IDS) {
      samples[key].push(reason ? `${doc.id} (${reason})` : doc.id);
    }
  }

  return {
    family: family.family,
    collection: family.collection,
    ownerType: family.ownerType,
    scanned: documents.length,
    truncated,
    counts,
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
export function censusGate(
  reports: readonly (CensusFamilyReport | { family: string; error: string })[],
): { blocking: number; unreadable: string[]; assessable: boolean } {
  const unreadable = reports.filter((r): r is { family: string; error: string } => "error" in r).map((r) => r.family);
  const blocking = reports
    .filter((r): r is CensusFamilyReport => !("error" in r))
    .reduce((n, r) => n + r.counts.unresolved + r.counts.ambiguous + r.counts.ownerless, 0);
  return { blocking, unreadable, assessable: blocking === 0 && unreadable.length === 0 };
}

/** Every family the census must cover. Exported so the CLI cannot iterate a narrower list. */
export const CENSUS_FAMILIES: readonly OwnershipFamily[] = OWNERSHIP_MATRIX;
