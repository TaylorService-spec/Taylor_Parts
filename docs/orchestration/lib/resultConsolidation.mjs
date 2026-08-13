// The sixth arrow — "Agent Manager consolidates". Reduces the decomposed children's results into ONE durable
// report, and enforces the parent COMPLETE precondition. Pure, deterministic, fail-closed. Thin by design.
//
// Governance: a parent intent is NOT complete merely because its children exited. consolidateChildResults first
// gates on completeness — every expected child must be present AND COMPLETE — and refuses to consolidate a
// partial run (returns ok:false with what's missing/incomplete). Only then does it dedupe the findings and
// surface, deterministically, exactly what the model asks the manager to identify: agreements, conflicts,
// duplicates removed, and cross-sector risks. This is the governed input to the parent's completion gate.

import { reconcileFindings, canonicalizeIdentity } from "./findingsRegister.mjs";
import { childFromResult } from "./findingSchema.mjs";

const SEVERITY_RANK = Object.freeze({ INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });
const sevRank = (s) => (s in SEVERITY_RANK ? SEVERITY_RANK[s] : -1);
const normPath = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
const normId = (s) => String(s ?? "").trim().toLowerCase();
// A finding's identity across children. When a stable DISCRIMINATOR is present, identity is
// file + symbol + discriminator (matching the findings register) — drift-immune (line/category ignored), so the
// same issue from multiple children dedupes/agrees while two DIFFERENT discriminators in the same file/symbol
// stay distinct and can never collapse into one group. Without a discriminator we fall back to the legacy
// file + line + category identity; such findings then fail closed at reconcile (no discriminator ⇒ surfaced),
// so they are never silently deduped away against a real, discriminated issue.
const findingKey = (f) => {
  if (normId(f?.discriminator)) {
    const id = canonicalizeIdentity(f); // SAME canonicalization the register fingerprints on — stages agree exactly
    return `disc::${id.file}::${id.symbol}::${id.discriminator}`;
  }
  return `nodisc::${normPath(f?.file)}:${f?.line ?? ""}:${normId(f?.category)}`;
};

/**
 * Fail-closed completeness gate for a decomposed parent: every expected child must be present with a COMPLETE
 * disposition and a findings array. Returns { ok, missing, incomplete } — the parent may not be marked COMPLETE
 * unless ok is true (this is what stops "workers exited ⇒ done").
 */
export function assertChildrenComplete({ expectedChildIds = [], children = [] } = {}) {
  // The expected set MUST be supplied explicitly. Deriving it from the children that happened to show up is
  // circular — a child that never ran cannot be missed by an expected set defined as "whoever reported" — so an
  // absent/empty expectedChildIds fails closed rather than silently declaring an unknown decomposition complete.
  const expected = (Array.isArray(expectedChildIds) ? expectedChildIds : []).filter((id) => typeof id === "string" && id);
  if (expected.length === 0) {
    return { ok: false, missing: [], incomplete: [], expected: [], reason: "expectedChildIds is required — completeness cannot be verified against an implicit set" };
  }
  const byId = new Map((Array.isArray(children) ? children : []).map((c) => [c?.requestId, c]));
  const missing = expected.filter((id) => !byId.has(id));
  const incomplete = expected
    .filter((id) => byId.has(id))
    .filter((id) => { const c = byId.get(id); return c?.disposition !== "COMPLETE" || !Array.isArray(c?.findings); });
  // SET EQUALITY, not just superset: a child NOT in the declared expected set must never participate in the
  // parent's consolidation (it could contribute findings/agreements/conflicts/counts to a mission it was never
  // authorized for). An unexpected child fails the gate closed — the parent cannot consolidate/COMPLETE.
  const expectedSet = new Set(expected);
  const unexpected = [...byId.keys()].filter((id) => id != null && !expectedSet.has(id));
  return { ok: missing.length === 0 && incomplete.length === 0 && unexpected.length === 0, missing, incomplete, unexpected, expected };
}

/**
 * Consolidate children's findings into one durable report. Fail-closed: if the completeness gate fails, returns
 * { ok:false, missing, incomplete } and does NOT consolidate. On success returns a frozen report with deduped
 * findings (severity-desc, key-asc), agreements (≥2 children on the same finding), conflicts (children disagree
 * on severity for the same finding), cross-sector risks (same finding surfaced by children in different sectors),
 * duplicates removed, and counts.
 */
export function consolidateChildResults({ parentWorkId = null, expectedChildIds = [], children = [] } = {}) {
  const gate = assertChildrenComplete({ expectedChildIds, children });
  if (!gate.ok) return Object.freeze({ ok: false, parentWorkId, missing: gate.missing, incomplete: gate.incomplete, unexpected: gate.unexpected ?? [], ...(gate.reason ? { reason: gate.reason } : {}) });

  // Group every reported finding by identity across all children.
  const groups = new Map();
  let totalReported = 0;
  for (const c of children) {
    for (const f of Array.isArray(c.findings) ? c.findings : []) {
      totalReported++;
      const key = findingKey(f);
      // Carry symbol + the stable issue discriminator through consolidation so reconcile can fingerprint against
      // the register. For a discriminated finding the stored identity is the CANONICAL form (same canonicalizer as
      // the register), so the durable artifact is deterministic — independent of which child/casing arrived first —
      // and byte-for-byte consistent with how the register matches. Undiscriminated findings keep raw display
      // fields (they fail closed at reconcile regardless).
      const id = normId(f.discriminator) ? canonicalizeIdentity(f) : null;
      const g = groups.get(key) || { key, file: id ? id.file : normPath(f.file), line: f.line ?? null, category: f.category ?? null, symbol: id ? (id.symbol || null) : (f.symbol ?? null), discriminator: id ? id.discriminator : (f.discriminator ?? null), reports: [] };
      // Per-occurrence DETAILS (including the drifting line + category) live here, not in the canonical identity.
      g.reports.push({ requestId: c.requestId, sector: c.sector ?? null, severity: f.severity ?? null, summary: f.summary ?? null, verdict: f.verdict ?? null, line: f.line ?? null, category: f.category ?? null });
      groups.set(key, g);
    }
  }

  const findings = [], agreements = [], conflicts = [], crossSectorRisks = [];
  let duplicatesRemoved = 0;
  for (const g of groups.values()) {
    const agreedBy = [...new Set(g.reports.map((r) => r.requestId))];
    duplicatesRemoved += g.reports.length - 1; // every extra report of the same finding is one duplicate removed
    const severities = [...new Set(g.reports.map((r) => r.severity).filter((s) => s != null))];
    const severity = g.reports.map((r) => r.severity).reduce((a, b) => (sevRank(b) > sevRank(a) ? b : a), null); // worst wins
    const sectors = [...new Set(g.reports.map((r) => r.sector).filter(Boolean))];
    // The canonical record is FULLY deterministic — every field is order-independent, so the durable artifact is
    // byte-stable regardless of child order. Identity: canonical file/discriminator (+ symbol only when it is
    // identity, i.e. for a discriminated finding). Aggregates: worst severity, SORTED agreedBy + sectors. Drifting
    // per-occurrence line/category live only in `reports`, sorted by requestId.
    const reports = Object.freeze(g.reports.slice().sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0)).map(Object.freeze));
    const canonical = Object.freeze({
      key: g.key, file: g.file, discriminator: g.discriminator,
      symbol: g.discriminator ? g.symbol : null,
      severity, agreedBy: Object.freeze([...agreedBy].sort()), sectors: Object.freeze([...sectors].sort()),
      reports,
    });
    findings.push(canonical);
    if (agreedBy.length >= 2) agreements.push(canonical);
    if (severities.length > 1) conflicts.push(Object.freeze({ ...canonical, severities })); // children disagree on severity
    if (sectors.length > 1) crossSectorRisks.push(canonical); // one issue seen from multiple sectors
  }

  // Deterministic order for EVERY consolidated collection: worst severity first, then key ascending. Applying
  // the one comparator to all of them keeps the report stable across runs / machines regardless of the order
  // children were reported or findings were grouped.
  const byWorstThenKey = (a, b) => (sevRank(b.severity) - sevRank(a.severity)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  findings.sort(byWorstThenKey);
  agreements.sort(byWorstThenKey);
  conflicts.sort(byWorstThenKey);
  crossSectorRisks.sort(byWorstThenKey);

  return Object.freeze({
    ok: true,
    parentWorkId,
    sourceChildren: Object.freeze([...gate.expected]),
    findings: Object.freeze(findings),
    agreements: Object.freeze(agreements),
    conflicts: Object.freeze(conflicts),
    crossSectorRisks: Object.freeze(crossSectorRisks),
    counts: Object.freeze({
      children: children.length,
      totalReported,
      unique: findings.length,
      duplicatesRemoved,
      agreements: agreements.length,
      conflicts: conflicts.length,
      crossSectorRisks: crossSectorRisks.length,
    }),
  });
}

/**
 * WIRE the consolidation into the findings register (the audit closed loop). Runs consolidateChildResults, then
 * reconciles its findings against the durable register so already-dispositioned items (fixed/known/deferred)
 * don't re-surface — only genuinely NEW findings, regressions, or unproven-fixed reappearances need attention.
 *
 * Fail-closed throughout: a partial child set never consolidates; a consolidated finding without a stable
 * discriminator is surfaced for disposition (never silently suppressed by a same-symbol register entry).
 *
 * @param {object} p  { parentWorkId, expectedChildIds, children, register }  — register is the parsed
 *                    register.json ({entries:[...]}) or a bare entries array.
 * @returns {{ ok, consolidated, reconciled?, actionable?, actionableCount? }}
 */
export function consolidateAndReconcile({ parentWorkId = null, expectedChildIds = [], children = [], register = [] } = {}) {
  const consolidated = consolidateChildResults({ parentWorkId, expectedChildIds, children });
  if (!consolidated.ok) return Object.freeze({ ok: false, consolidated });
  const entries = Array.isArray(register?.entries) ? register.entries : (Array.isArray(register) ? register : []);
  const reconciled = reconcileFindings(consolidated.findings, entries);
  // What a human/EOS must actually act on after applying memory: new work + integrity alarms.
  const actionable = Object.freeze([...reconciled.surfaced, ...reconciled.regressions, ...reconciled.unprovenFixed]);
  return Object.freeze({ ok: true, consolidated, reconciled, actionable, actionableCount: actionable.length });
}

/**
 * END-TO-END audit loop: raw worker RESULT CONTENT → structured findings → consolidate → reconcile against the
 * findings register. This is the whole loop as one call: extractFindings (per child) + completeness gate +
 * deterministic consolidation + register memory. Fail-closed throughout — a child whose worker emitted no valid
 * eos-findings block contributes no findings (surfaces nothing silently); a partial child set never consolidates.
 *
 * @param {object} p  { parentWorkId, expectedChildIds, childResults, register }
 *   childResults: [{ requestId, disposition?, sector?, content }] — one per executed child (content = its result).
 * @returns same shape as consolidateAndReconcile, plus `extractions` (per-child block-extraction status).
 */
export function runAuditReconcile({ parentWorkId = null, expectedChildIds = [], childResults = [], register = [] } = {}) {
  const children = (Array.isArray(childResults) ? childResults : []).map(childFromResult);
  const out = consolidateAndReconcile({ parentWorkId, expectedChildIds, children, register });
  const extractions = Object.freeze(children.map((c) => Object.freeze({ requestId: c.requestId, ...c.findingsExtraction })));
  return Object.freeze({ ...out, extractions });
}
