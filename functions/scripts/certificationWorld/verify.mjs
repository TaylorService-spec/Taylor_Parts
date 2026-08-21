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
  CORRUPT: "CORRUPT",                   // present, but its own invariants disagree.
});

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
export function classifyWorld({ expected, actual, versionsFound, duplicateIds, invariantViolations }) {
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
  [WORLD_STATE.CORRUPT]: { proceed: false, reason: "the installed world violates its own invariants -- reset required." },
});
