// C-7 SESSION RE-ANCHOR — pure functions (no I/O).
//
// After a Claude session is compacted/summarized, its remembered conversation is a HINT, never an
// AUTHORITY. Re-anchor realigns the session to CURRENT durable EOS truth by REUSING the cold-start
// bootstrap (provenance · current-state pointer · context package · authority-first gate · selector
// interpretation) — it does NOT introduce a second knowledge store or a competing context mechanism.
//
// Three additions over cold-start, all navigation-layer:
//   (1) SESSION_CONTEXT_DRIFT — deterministic comparison of a small set of REMEMBERED claims against
//       DURABLE state (selector, active assignments, superseded decisions, merged PRs). Every conflict
//       resolves to the durable authority and is surfaced as drift — never silently trusted.
//   (2) CONTINUATION SEMANTICS — RE-ANCHOR ONLY (recover + stop) vs RE-ANCHOR AND CONTINUE (recover,
//       then continue only work the DURABLE selector says is actionable). Re-anchor NEVER grants
//       authority: continuation is governed by the durable selector, never by remembered state.
//   (3) REANCHOR_CONTEXT_COST — measured SEPARATELY from cold-start cost. Cheaper by design: session
//       identity/role/governing-authority are already known; only durable state is refreshed, so the
//       governing authority's full text is an on-need upper bound, not part of orientation.
//
// The driver (cold-start.mjs --reanchor) supplies I/O (the built bootstrap, the map entries, and the
// durable facts gathered from git). These functions are pure so they are CI-testable with in-memory
// inputs.

const DURABLE_WINS = "DURABLE_AUTHORITY_WINS";

/**
 * Applicable prior DECISIONS for the scope — the CURRENT decision-kind entries whose scope overlaps.
 * Derived from the same map entries the context package is built from (not a second source): a
 * superseded/historical decision is excluded, exactly as the package excludes it.
 * @returns {Array<{ id, authority, retrievalPath }>}
 */
export function applicableDecisionRefs(entries = [], scope = []) {
  return entries
    .filter((e) => e && e.kind === "decision" && e.lifecycle === "current" && !e.supersededBy)
    .filter((e) => (e.scope || []).some((s) => scope.includes(s)))
    .map((e) => ({ id: e.id, authority: e.authority, retrievalPath: e.retrievalPath }));
}

/**
 * SESSION_CONTEXT_DRIFT — pure, deterministic. Compares only the remembered claims that can be
 * checked SAFELY against durable facts the driver already holds. Anything not deterministically
 * comparable is NOT guessed — it simply doesn't appear (re-anchor falls back to durable truth).
 *
 * @param {object} p
 * @param {object|null} p.remembered  compressed-session claims (all fields optional):
 *   { sourceCommit?, selectorState?, hasReadyWork?, activeAssignmentIds?: string[],
 *     openPrNumbers?: number[], activeDecisionIds?: string[] }
 * @param {object} p.durable  durable facts from the bootstrap + git:
 *   { sourceCommit, selectorState, readyItemIds: string[], activeAssignmentIds: string[],
 *     mergedPrNumbers?: number[], supersededDecisionIds?: string[] }
 * @returns {{ drifts: Array<{kind,field,remembered,durable,resolution}>, hasDrift: boolean, comparisons: number }}
 */
export function detectSessionDrift({ remembered = null, durable = {} } = {}) {
  const drifts = [];
  let comparisons = 0;
  if (!remembered || typeof remembered !== "object") return { drifts, hasDrift: false, comparisons };

  const push = (kind, field, rem, dur) => drifts.push({ kind, field, remembered: rem, durable: dur, resolution: DURABLE_WINS });

  // Source advanced — informational drift (remembered a commit that durable state has moved past).
  if (remembered.sourceCommit && durable.sourceCommit && remembered.sourceCommit !== durable.sourceCommit) {
    comparisons++;
    push("SOURCE_ADVANCED", "sourceCommit", remembered.sourceCommit, durable.sourceCommit);
  }

  // Selector drift — e.g. session remembers RUN/READY work, durable selector says CHECKPOINT.
  if (remembered.selectorState && durable.selectorState && remembered.selectorState !== durable.selectorState) {
    comparisons++;
    push("SELECTOR_DRIFT", "selectorState", remembered.selectorState, durable.selectorState);
  }

  // READY drift — session remembers actionable READY work that the durable digest no longer has.
  if (typeof remembered.hasReadyWork === "boolean") {
    comparisons++;
    const durHasReady = (durable.readyItemIds || []).length > 0;
    if (remembered.hasReadyWork !== durHasReady) push("READY_DRIFT", "hasReadyWork", remembered.hasReadyWork, durHasReady);
  }

  // Assignment drift — session remembers an assignment ACTIVE that durable lifecycle no longer lists
  // as active (advanced to COMPLETED/CONSUMED, or never durable). Compared against the durable RUNNING set.
  if (Array.isArray(remembered.activeAssignmentIds)) {
    const durActive = new Set(durable.activeAssignmentIds || []);
    for (const id of remembered.activeAssignmentIds) {
      comparisons++;
      if (!durActive.has(id)) push("ASSIGNMENT_DRIFT", "activeAssignmentIds", `${id} (remembered ACTIVE)`, "not in durable active set (COMPLETED/CONSUMED or never durable)");
    }
  }

  // PR drift — session remembers a PR OPEN that durable git history shows MERGED. Deterministic +
  // offline: the driver derives mergedPrNumbers from `(#NNN)` in local git log of origin/main.
  if (Array.isArray(remembered.openPrNumbers) && Array.isArray(durable.mergedPrNumbers)) {
    const merged = new Set(durable.mergedPrNumbers);
    for (const n of remembered.openPrNumbers) {
      comparisons++;
      if (merged.has(n)) push("PR_STATE_DRIFT", "openPrNumbers", `#${n} (remembered OPEN)`, `#${n} MERGED into origin/main`);
    }
  }

  // Decision drift — session remembers a decision ACTIVE that the current map marks superseded.
  if (Array.isArray(remembered.activeDecisionIds) && Array.isArray(durable.supersededDecisionIds)) {
    const superseded = new Set(durable.supersededDecisionIds);
    for (const id of remembered.activeDecisionIds) {
      comparisons++;
      if (superseded.has(id)) push("DECISION_SUPERSEDED", "activeDecisionIds", `${id} (remembered ACTIVE)`, `${id} SUPERSEDED by current authority`);
    }
  }

  return { drifts, hasDrift: drifts.length > 0, comparisons };
}

const estTokens = (bytes) => Math.round((bytes || 0) / 4); // heuristic ≈ 4 bytes/token; labeled estimate

/**
 * REANCHOR_CONTEXT_COST — Context Health for a re-anchor, measured separately from cold-start.
 * Orientation = the tiny L0 card + the current-state pointer ONLY. The governing authority's full
 * text is NOT part of re-anchor orientation (the session already knows which authority governs and
 * has it in scope); it is retrieved on need (e.g. to resolve a drift), so it is reported as an upper
 * bound, never front-loaded. This is why re-anchor is normally cheaper than a full cold start.
 */
export function measureReanchorCost({ l0Bytes = 0, pointerBytes = 0, governingAuthorityBytes = 0, l2RetrievedCount = 0, unnecessaryRetrievals = 0, staleRetrievals = 0, sufficiency = "SUFFICIENT", driftComparisons = 0, runtimeTokens = null } = {}) {
  const orientationBytes = (l0Bytes || 0) + (pointerBytes || 0); // pointer refresh only — authority already known
  return Object.freeze({
    signal: "REANCHOR_CONTEXT_COST",
    orientationBytes,
    orientationTokensEstimate: estTokens(orientationBytes),
    governingAuthorityOnNeedBytes: governingAuthorityBytes,       // retrieved only if a drift needs it (upper bound)
    governingAuthorityOnNeedTokensEstimate: estTokens(governingAuthorityBytes),
    l1Retrievals: 0,                                              // re-anchor front-loads no L1; refs are known
    l2RetrievedCount,
    unnecessaryRetrievals,
    staleRetrievals,
    driftComparisons,                                            // how many remembered claims were checked
    sufficiency,
    runtimeTokens,
    healthy: unnecessaryRetrievals === 0 && staleRetrievals === 0 && sufficiency === "SUFFICIENT",
    baselineNote: "Compare against COLD_START_CONTEXT_COST.orientationTokensEstimate — re-anchor should be cheaper (authority already known; only durable state refreshed).",
  });
}

/**
 * Assemble the compact re-anchor result (pure). Consumes the cold-start `boot` (already composed by
 * coldStart()), the map `entries` (for applicable decisions), optional `remembered` claims + durable
 * facts for drift, and the continuation flag. Answers the seven re-anchor questions and decides
 * continuation — which is governed by the DURABLE selector, never by remembered state.
 *
 * @param {object} p
 * @param {object} p.boot           output of coldStart()/assembleBootstrap
 * @param {Array}  p.entries        loaded map entries (for applicableDecisionRefs)
 * @param {string[]} p.scope
 * @param {object|null} p.remembered
 * @param {object} p.durableExtras  { mergedPrNumbers?, supersededDecisionIds? } — offline git-derived facts
 * @param {boolean} p.continue      RE-ANCHOR AND CONTINUE when true; RE-ANCHOR ONLY when false
 * @param {object} p.sizes          { l0Bytes, pointerBytes, governingAuthorityBytes }
 */
export function assembleReanchor({ boot = null, entries = [], scope = [], remembered = null, durableExtras = {}, continue: cont = false, sizes = {} } = {}) {
  const cs = (boot && boot.currentState) || {};
  const prov = (boot && boot.provenance) || {};
  const pkg = (boot && boot.package) || {};
  const decisions = applicableDecisionRefs(entries, scope);

  const durable = {
    sourceCommit: prov.sourceCommit || null,
    selectorState: cs.selectorState || null,
    readyItemIds: cs.readyItemIds || [],
    activeAssignmentIds: cs.activeAssignmentIds || [],
    mergedPrNumbers: durableExtras.mergedPrNumbers || [],
    supersededDecisionIds: durableExtras.supersededDecisionIds || [],
  };
  const drift = detectSessionDrift({ remembered, durable });

  // Continuation is GOVERNED BY THE DURABLE SELECTOR. Actionable only when the selector itself says
  // so (RUN / PREREQUISITE_AVAILABLE). A terminal CHECKPOINT / ROADMAP_COMPLETE / gate does NOT
  // continue — re-anchor never manufactures or resurrects remembered work, and never grants authority.
  const ACTIONABLE = new Set(["RUN", "PREREQUISITE_AVAILABLE"]);
  const selectorActionable = ACTIONABLE.has(durable.selectorState);
  const willContinue = cont === true && selectorActionable;
  const continuation = {
    mode: cont === true ? "RE_ANCHOR_AND_CONTINUE" : "RE_ANCHOR_ONLY",
    willContinue,
    // The target is the durable selector's conclusion, never a remembered assignment.
    continueBasis: willContinue ? `durable selector = ${durable.selectorState}` : null,
    haltReason: cont === true && !selectorActionable
      ? `durable selector = ${durable.selectorState} — no authorized actionable work; stop at the governed boundary`
      : cont !== true ? "RE_ANCHOR_ONLY requested — recover + report, do not continue" : null,
    note: "Re-anchor ≠ authorization. Continuation runs only work already authorized under normal EOS rules; the durable selector governs, remembered state never does.",
  };

  const cost = measureReanchorCost({
    l0Bytes: sizes.l0Bytes || 0,
    pointerBytes: sizes.pointerBytes || 0,
    governingAuthorityBytes: sizes.governingAuthorityBytes || 0,
    l2RetrievedCount: 0,
    unnecessaryRetrievals: 0,
    staleRetrievals: prov.freshness === "CURRENT" ? 0 : 1,
    sufficiency: pkg.sufficiency || (boot && boot.coldStartContextCost ? boot.coldStartContextCost.sufficiency : "EVIDENCE_REQUIRED"),
    driftComparisons: drift.comparisons,
  });

  return {
    contract: "EOS-REANCHOR/1.0.0",
    reanchorPrinciple: "remembered/compressed conversation = HINT; durable EOS repository state = AUTHORITY. On any conflict, the durable authority wins and the conflict is surfaced as drift.",
    provenance: prov,
    // The seven re-anchor questions → durable answers (pointers/refs, not narrative dumps).
    answers: {
      whereAmI: { sourceCommit: prov.sourceCommit || null, freshness: prov.freshness || "UNKNOWN", domain: pkg.domain || null },
      whatAmIDoing: (durable.activeAssignmentIds.length > 0)
        ? { activeAssignmentIds: durable.activeAssignmentIds }
        : { activeAssignmentIds: [], note: `no active assignment — selector ${durable.selectorState}` },
      whatChangedIsCurrent: { selectorState: durable.selectorState, terminalCheckpoint: cs.terminalCheckpoint ?? null, drift: drift.drifts },
      whatGovernsThisWork: { governingAuthority: pkg.governingAuthority || null, applicableDecisionRefs: decisions, authorityFirst: (boot && boot.authorityFirst && boot.authorityFirst.gate) || null },
      whatAmIAuthorizedToDo: { default: "repo-safe reversible work (AGENTS.md); protected boundaries in DelegationCharter §8.3", reanchorGrantsAuthority: false },
      whatNeedsTheOwner: { ownerGateIds: cs.ownerGateIds || [] },
      whatShouldHappenNext: { selectorHint: cs.selectorHint || null, continuation },
    },
    sessionContextDrift: drift,
    continuation,
    reanchorContextCost: cost,
  };
}
