// PARTIAL-STATE DETECTION. The load-bearing half of this whole mechanism.
//
// ============================ WHY THIS EXISTS ============================
//
// A certification dataset that is 80% present looks, to every query anyone will run against it, like
// a dataset that is 100% present with a slightly different shape. Absence produces no error. This
// program has now met that same failure in five separate instruments -- a guard that matched nothing,
// a sweep that measured 136 of 270 visits, a profile that covered 53 of 54 routes, a wait that
// measured pages before they rendered, and a gate pointed at the wrong URL. Every one of them
// reported success.
//
// So the world declares its expected shape, and the only honest answers are these five:
export const WORLD_STATE = Object.freeze({
  ABSENT: "ABSENT",                     // nothing here. Seeding is safe.
  COMPLETE: "COMPLETE",                 // exactly the expected dataset at the expected version.
  PARTIAL: "PARTIAL",                   // some of it. NEVER resumed automatically -- see below.
  VERSION_MISMATCH: "VERSION_MISMATCH", // a different version's world is installed.
  // Same version, same counts, DIFFERENT CONTENT. Its own state on purpose: flattening it into
  // PARTIAL would say "records are missing" when none are, and flattening it into VERSION_MISMATCH
  // would say "install a different version" when the version is the one asked for. Both would send
  // an operator to fix the wrong thing.
  CONTENT_DRIFT: "CONTENT_DRIFT",
  CORRUPT: "CORRUPT",                   // present, but its own invariants disagree.
  // Every expected RECORD is present, but the employees are not linked to their Auth principals.
  IDENTITY_LINKAGE_INCOMPLETE: "IDENTITY_LINKAGE_INCOMPLETE",
});

// ============================ WHY DATA COMPLETENESS IS NOT COMPLETENESS ============================
//
// A rebuild deletes the marker-scoped records and reseeds them from the repository. The 47
// certification employees carry a `userId` pointing at their Auth principal -- and `buildWorld()`
// does not contain it, correctly, because a UID is ENVIRONMENT state and a deterministic fixture
// must not depend on it.
//
// The consequence is that a rebuild recreates all 717 records, every count matches, the fingerprint
// matches, and all 47 employee->principal links are gone. Role assignments are keyed on UID and
// survive independently, so they would still exist -- pointing at principals no employee document
// claims any more. The world would report COMPLETE while nobody could sign in as anyone.
//
// So COMPLETE now requires DATA + IDENTITY. A world that has every record and no links is not a
// smaller version of a working world; it is a differently-broken one, and it gets its own state
// rather than being flattened into PARTIAL, whose meaning ("some records are missing") would send a
// reader looking for the wrong thing.

// PARTIAL FAILS CLOSED, and that is a deliberate refusal rather than a missing feature.
//
// "Seed the missing bits" sounds obviously right and is the trap: a partial world can be partial
// because a previous seed crashed halfway, because someone deleted records by hand, or because a
// DIFFERENT version left residue. Those need different responses, and a seeder that guesses will
// confidently produce a fourth thing that matches no version at all. The normal seeder must not
// become an implicit repair engine -- reset and rebuild is one line, and it is knowable.

/**
 * Compare expectation against measurement.
 *
 * `expected` is derived from the manifest, never from the database, so a world that lost records
 * cannot lower the bar it is judged against.
 */
// ============================ WHY A FINGERPRINT CHECK HAD TO EXIST ============================
//
// This function compared VERSION and COUNTS, and nothing else. That is sufficient for exactly as
// long as no change ever alters content without altering one of them -- and on 2026-08-30 one did.
//
// EOS Ownership Model v1 added deterministic ownership fields to accounts and equipment. It created
// no records and deleted none. Version 1.6.0, 1092 records, every per-collection count identical --
// and every account and equipment document different. verify reported COMPLETE against a repository
// that no longer described the installed world, and went on reporting it. The only thing that
// noticed was a separate test that happened to pin the fingerprint.
//
// A world can now be wrong in a way this function could not see, which makes COMPLETE a claim it was
// not entitled to make. So content is compared too, when the caller can measure it.
//
// FINGERPRINT IS OPTIONAL, DELIBERATELY. The pure unit tests of count classification must not be
// forced to model content to assert record counts -- the same reasoning as identityLinkage above. A
// LIVE verify always supplies it. When it is absent, this cannot report COMPLETE on content it never
// looked at, so it says so rather than implying a check it did not run.
export function classifyWorld({ expected, actual, versionsFound, duplicateIds, invariantViolations, identityLinkage = null, fingerprint = null }) {
  const findings = [];
  const totalActual = Object.values(actual).reduce((a, b) => a + b, 0);

  if (totalActual === 0) {
    return { state: WORLD_STATE.ABSENT, findings: [], missing: {}, extra: {} };
  }

  // Version first: counts compared across versions are meaningless.
  const foreign = versionsFound.filter((v) => v !== expected.version);
  if (foreign.length > 0) {
    return {
      state: WORLD_STATE.VERSION_MISMATCH,
      findings: [`expected version ${expected.version}, found ${foreign.join(", ")}`],
      missing: {}, extra: {},
    };
  }

  // A duplicate deterministic id means two records claim one identity -- the world is not merely
  // incomplete, its identity model is broken, and reseeding would not repair it.
  if (duplicateIds.length > 0) {
    return {
      state: WORLD_STATE.CORRUPT,
      findings: [`duplicate deterministic ids: ${duplicateIds.slice(0, 10).join(", ")}`],
      missing: {}, extra: {},
    };
  }
  if (invariantViolations.length > 0) {
    return { state: WORLD_STATE.CORRUPT, findings: invariantViolations, missing: {}, extra: {} };
  }

  const missing = {};
  const extra = {};
  for (const [kind, want] of Object.entries(expected.counts)) {
    const have = actual[kind] ?? 0;
    if (have < want) missing[kind] = want - have;
    // MORE than expected is not "fine". A deterministic world has an exact size; a surplus means
    // records nothing accounts for, which is its own kind of unknown.
    if (have > want) extra[kind] = have - want;
  }
  if (Object.keys(missing).length === 0 && Object.keys(extra).length === 0) {
    // Data is right. Identity is a separate question, and it is only asked when the caller
    // supplied an answer -- a live verify always does; the pure unit tests of DATA classification
    // do not, and must not be forced to model identity to assert record counts.
    // CONTENT BEFORE IDENTITY. Relinking principals into a world that is the wrong dataset repairs
    // nothing, so a drifted world must not be reported as a linkage problem.
    if (fingerprint) {
      const { expected: wantFp, installed: haveFp } = fingerprint;
      if (wantFp && haveFp && wantFp !== haveFp) {
        return {
          state: WORLD_STATE.CONTENT_DRIFT,
          findings: [
            `content fingerprint ${haveFp} does not match the expected ${wantFp}`,
            `version ${expected.version} matches and every per-collection record count matches `
            + "-- the records are the right shape and the wrong content",
          ],
          missing, extra,
        };
      }
      // Absent evidence is not evidence of agreement. Reporting COMPLETE here would claim a check
      // that never ran, which is the same lie as reporting it over a mismatch.
      if (wantFp && !haveFp) {
        return {
          state: WORLD_STATE.CONTENT_DRIFT,
          findings: [`the installed world records no content fingerprint to compare against ${wantFp}`],
          missing, extra,
        };
      }
    }
    if (identityLinkage) {
      const linkageFindings = identityLinkageFindings(identityLinkage);
      if (linkageFindings.length) {
        return { state: WORLD_STATE.IDENTITY_LINKAGE_INCOMPLETE, findings: linkageFindings, missing, extra };
      }
    }
    return { state: WORLD_STATE.COMPLETE, findings: [], missing, extra };
  }
  for (const [k, n] of Object.entries(missing)) findings.push(`${k}: missing ${n}`);
  for (const [k, n] of Object.entries(extra)) findings.push(`${k}: ${n} unexpected`);
  return { state: WORLD_STATE.PARTIAL, findings, missing, extra };
}

/** What the seeder is permitted to do for each state. One table, so behaviour cannot drift per call site. */
export const SEED_POLICY = Object.freeze({
  [WORLD_STATE.ABSENT]: { proceed: true, reason: "no certification world present" },
  [WORLD_STATE.COMPLETE]: { proceed: false, alreadyApplied: true, reason: "expected dataset already present at this version" },
  [WORLD_STATE.PARTIAL]: { proceed: false, reason: "PARTIAL world -- run reset then seed. Refusing to guess which records to resume." },
  [WORLD_STATE.VERSION_MISMATCH]: { proceed: false, reason: "a different dataset version is installed -- run reset, or provide an explicit migration." },
  // NOT alreadyApplied. The whole point is that the installed world is NOT what the repository
  // expects, so treating it as already-applied would be the silence this state exists to break.
  [WORLD_STATE.CONTENT_DRIFT]: { proceed: false, reason: "same version and counts, different content -- the installed world no longer matches the repository. Reset and rebuild, or reconcile the builder. VERIFY IS EVIDENCE, NOT REPAIR." },
  [WORLD_STATE.CORRUPT]: { proceed: false, reason: "the installed world violates its own invariants -- reset required." },
  // Reseeding would not help: the RECORDS are all present. What is missing is the link between
  // employees and their principals, which is repaired by the reconcile/relink phase, not by another
  // copy of the data.
  [WORLD_STATE.IDENTITY_LINKAGE_INCOMPLETE]: { proceed: false, reason: "records are complete but employee->principal links are missing -- run the principal reconcile/relink phase (provisionPrincipals.mjs --apply)." },
});

/**
 * What is wrong with the identity linkage, if anything.
 *
 * Pure: takes a measurement, returns findings. The four questions are deliberately separate because
 * they fail for different reasons and are repaired differently:
 *
 *   unlinked        an employee document carries no userId -- the rebuild dropped it
 *   reverseMissing  users/{uid}.employeeId is absent -- half a link, which reads as a working link
 *                   from one side only
 *   mismatched      the two sides disagree about who is who. The dangerous one: both links exist,
 *                   so every presence check passes, and the identities are crossed
 *   duplicateUids   two employees claim the same principal
 */
export function identityLinkageFindings({ expectedLinked = 0, linked = 0, reverseLinked = 0, mismatched = [], duplicateUids = [] } = {}) {
  const findings = [];
  if (linked < expectedLinked) {
    findings.push(`${expectedLinked - linked} of ${expectedLinked} certification employees have no userId link`);
  }
  if (reverseLinked < expectedLinked) {
    findings.push(`${expectedLinked - reverseLinked} of ${expectedLinked} reverse users/{uid}.employeeId links are missing`);
  }
  for (const m of mismatched) {
    findings.push(`link mismatch: employee ${m.employeeId} -> ${m.userId}, but users/${m.userId} -> ${m.employeeId ?? "(none)"}`);
  }
  for (const d of duplicateUids) {
    findings.push(`duplicate principal: uid ${d.userId} claimed by ${d.employeeIds.join(", ")}`);
  }
  return findings;
}
