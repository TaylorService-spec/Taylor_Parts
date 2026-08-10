// C-7 cold-start contract — pure functions (no I/O).
//
// Three additions over slice 1–2 (context map + package generator), all navigation-layer, no new
// authority, no knowledge store:
//   (1) AUTHORITY-FIRST GATE  — for every governed subject in the assignment scope, the governing
//       authority must already be in the package's required set; a governed subject with no current
//       authority escalates to EVIDENCE_REQUIRED (retrieve-don't-guess). Prevents the model-routing
//       defect class: a policy that a durable authority already owns must never be re-invented.
//   (2) GOVERNED-SUBJECTS CATALOG — the scope tokens that have a governing authority, so a cold
//       worker can check "does my task touch a governed subject outside my declared scope?".
//   (3) COLD_START_CONTEXT_COST — a measurable Context Health signal (refs supplied/retrieved, L0/L1
//       bytes, L2 count, unnecessary/stale counts, estimated bytes/tokens). Token estimates are
//       explicitly labeled estimates; runtime-true counts are never fabricated.
//
// The driver (cold-start.mjs) supplies I/O (map load, file sizes, git). These functions are pure so
// they are deterministic and CI-testable with in-memory inputs.

const AUTHORITY_KINDS = Object.freeze(["principle", "decision", "model"]); // kinds that GOVERN
const scopeOverlap = (a = [], b = []) => a.some((s) => b.includes(s));

/**
 * The catalog of governed subjects: every scope token carried by a CURRENT, authority-bearing entry
 * (principle/decision/model). This is what "authority-first" is checked against — and what a cold
 * worker scans to notice a governed subject its declared scope omitted.
 * @returns {Array<{ subject, authorities: Array<{id, authority, level, retrievalPath}> }>}
 */
export function governedSubjects(entries = []) {
  const bySubject = new Map();
  for (const e of entries) {
    if (e.lifecycle !== "current" || !AUTHORITY_KINDS.includes(e.kind) || !e.authority) continue;
    for (const s of e.scope || []) {
      if (!bySubject.has(s)) bySubject.set(s, []);
      bySubject.get(s).push({ id: e.id, authority: e.authority, level: e.level, retrievalPath: e.retrievalPath });
    }
  }
  return [...bySubject.entries()]
    .map(([subject, authorities]) => ({ subject, authorities }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/**
 * AUTHORITY-FIRST GATE. Given the built package and the same entries, verify that for every governed
 * subject that overlaps the assignment scope, at least one governing authority for that subject is in
 * the package's `required` set (by retrievalPath). Any governed subject in scope with no CURRENT
 * authority present → a `missing` finding and gate = EVIDENCE_REQUIRED.
 *
 * @returns {{ gate: "SATISFIED"|"EVIDENCE_REQUIRED", present: Array, missing: Array, checkedSubjects: string[] }}
 */
export function authorityFirstGate({ entries = [], pkg = null, scope = [] } = {}) {
  const requiredPaths = new Set((pkg && pkg.required ? pkg.required : []).map((r) => r.retrievalPath));
  const catalog = governedSubjects(entries);
  const inScope = catalog.filter((c) => scope.includes(c.subject));
  const present = [];
  const missing = [];
  for (const c of inScope) {
    const covered = c.authorities.find((a) => requiredPaths.has(a.retrievalPath));
    if (covered) present.push({ subject: c.subject, authority: covered.authority, retrievalPath: covered.retrievalPath });
    else missing.push({ subject: c.subject, expectedAuthorities: c.authorities.map((a) => a.authority) });
  }
  return {
    gate: missing.length === 0 ? "SATISFIED" : "EVIDENCE_REQUIRED",
    present,
    missing,
    checkedSubjects: inScope.map((c) => c.subject),
  };
}

/**
 * Governed subjects that have an authority but are NOT in the declared scope — surfaced so a cold
 * worker can widen scope before authoring a policy an existing authority already owns. This is the
 * visible checklist that turns the model-routing defect ("independently hard-coded Sonnet") into a
 * caught case: model-routing appears here unless the assignment declared it.
 */
export function governedSubjectsOutsideScope(entries = [], scope = []) {
  return governedSubjects(entries)
    .filter((c) => !scope.includes(c.subject))
    .map((c) => ({ subject: c.subject, authorities: c.authorities.map((a) => ({ authority: a.authority, retrievalPath: a.retrievalPath })) }));
}

const estTokens = (bytes) => Math.round((bytes || 0) / 4); // heuristic ≈ 4 bytes/token; labeled estimate

/**
 * COLD_START_CONTEXT_COST — the measurable Context Health signal for a cold start.
 * Bytes are exact (measured by the driver from real files); token counts are an EXPLICIT estimate
 * (`approxTokensEstimate`) — runtime-true token usage is only filled when a runtime exposes it.
 *
 * @param {object} m
 * @param {number} m.refsSupplied         refs handed in the bootstrap package (L0 + pointer + required)
 * @param {number} m.refsRetrieved        refs actually opened to reach sufficiency
 * @param {number} m.l0Bytes              bytes of the L0 card actually read
 * @param {number} m.pointerBytes         bytes of the current-state pointer read
 * @param {number} m.governingAuthorityBytes bytes of the ONE governing authority (the orientation read)
 * @param {number} m.requiredAllBytes     bytes of ALL required (L1) refs if each were read in full
 * @param {number} m.l2RetrievedCount     on-demand (L2) refs actually retrieved
 * @param {number} m.unnecessaryRetrievals refs retrieved that the package marked excluded/out-of-scope
 * @param {number} m.staleRetrievals      retrievals against a non-CURRENT / non-origin-main source
 * @param {string} m.sufficiency          SUFFICIENT | EVIDENCE_REQUIRED
 * @param {number|null} [m.runtimeTokens] runtime-true tokens if the host exposes them (else null)
 */
export function measureColdStartCost(m = {}) {
  const {
    refsSupplied = 0, refsRetrieved = 0, l0Bytes = 0, pointerBytes = 0,
    governingAuthorityBytes = 0, requiredAllBytes = 0,
    l2RetrievedCount = 0, unnecessaryRetrievals = 0, staleRetrievals = 0,
    sufficiency = "SUFFICIENT", runtimeTokens = null,
  } = m;
  // ORIENTATION = the minimum a cold worker reads to know where it is + what governs it: the tiny L0
  // card + the tiny current-state pointer + its ONE governing authority. Everything else is a REF,
  // pulled on need — never front-loaded. This is the number to compare against the ≈121k baseline.
  const orientationBytes = (l0Bytes || 0) + (pointerBytes || 0) + (governingAuthorityBytes || 0);
  return Object.freeze({
    signal: "COLD_START_CONTEXT_COST",
    refsSupplied,
    refsRetrieved,
    l0Bytes,
    pointerBytes,
    governingAuthorityBytes,
    orientationBytes,                                   // exact: L0 + pointer + governing authority
    orientationTokensEstimate: estTokens(orientationBytes), // ESTIMATE (bytes/4), not a runtime count
    requiredAllBytes,                                   // if EVERY required L1 ref were read in full (upper bound)
    requiredAllTokensEstimate: estTokens(requiredAllBytes),
    l2RetrievedCount,                                   // on-demand refs pulled later, by need
    runtimeTokens,                                      // null unless the host truthfully exposes it
    unnecessaryRetrievals,                              // negative-retrieval health (C6): should be 0
    staleRetrievals,                                    // provenance health: should be 0
    sufficiency,
    healthy: unnecessaryRetrievals === 0 && staleRetrievals === 0 && sufficiency === "SUFFICIENT",
    baselineNote: "Observed fresh-session baseline ≈121k tokens (broad archaeology). That is an observed session total, not a C-7-only measurement; compare orientationTokensEstimate directionally, not to the byte.",
  });
}

/**
 * Assemble the full cold-start bootstrap (pure). The driver injects the loaded map entries, the built
 * package, the current-state pointer object, and the measured byte sizes; this composes the answer +
 * runs the authority-first gate + attaches the cost signal. No I/O here.
 */
export function assembleBootstrap({ entries = [], pkg = null, scope = [], currentState = null, sizes = {}, l0Path = "docs/orchestration/context/EOS-BOOTSTRAP.md" } = {}) {
  const gate = authorityFirstGate({ entries, pkg, scope });
  const outside = governedSubjectsOutsideScope(entries, scope);
  const cost = measureColdStartCost({
    refsSupplied: 1 /* L0 */ + 1 /* pointer */ + (pkg && pkg.required ? pkg.required.length : 0),
    refsRetrieved: 1 /* L0 */ + 1 /* pointer */ + 1 /* governing authority */,
    l0Bytes: sizes.l0Bytes || 0,
    pointerBytes: sizes.pointerBytes || 0,
    governingAuthorityBytes: sizes.governingAuthorityBytes || 0,
    requiredAllBytes: sizes.l1Bytes || 0,
    l2RetrievedCount: 0, // on-demand refs are pulled later, by need
    unnecessaryRetrievals: 0,
    staleRetrievals: currentState && currentState.provenance && currentState.provenance.freshness === "CURRENT" ? 0 : (currentState ? 1 : 0),
    sufficiency: pkg ? pkg.sufficiency : "EVIDENCE_REQUIRED",
  });
  return {
    contract: "EOS-COLD-START/1.0.0",
    l0: l0Path,
    provenance: (currentState && currentState.provenance) || (pkg && pkg.provenance) || null,
    currentState: currentState ? { readyItemIds: currentState.derived?.readyItemIds || [], ownerGateIds: currentState.derived?.ownerGateIds || [], protectedActionIds: currentState.derived?.protectedActionIds || [], activeAssignmentIds: currentState.derived?.activeAssignmentIds || [] } : null,
    package: pkg,
    authorityFirst: gate,
    governedSubjectsOutsideScope: outside,
    coldStartContextCost: cost,
  };
}
