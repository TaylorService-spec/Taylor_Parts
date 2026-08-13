// The sixth arrow — "Agent Manager consolidates". Reduces the decomposed children's results into ONE durable
// report, and enforces the parent COMPLETE precondition. Pure, deterministic, fail-closed. Thin by design.
//
// Governance: a parent intent is NOT complete merely because its children exited. consolidateChildResults first
// gates on completeness — every expected child must be present AND COMPLETE — and refuses to consolidate a
// partial run (returns ok:false with what's missing/incomplete). Only then does it dedupe the findings and
// surface, deterministically, exactly what the model asks the manager to identify: agreements, conflicts,
// duplicates removed, and cross-sector risks. This is the governed input to the parent's completion gate.

import { reconcileFindings } from "./findingsRegister.mjs";

const SEVERITY_RANK = Object.freeze({ INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });
const sevRank = (s) => (s in SEVERITY_RANK ? SEVERITY_RANK[s] : -1);
const normPath = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
// A finding's identity across children: same file + line + category is the SAME finding (two children reporting
// it is agreement, not two findings). Category is case-normalized so "Bug"/"bug" collapse.
const findingKey = (f) => `${normPath(f?.file)}:${f?.line ?? ""}:${String(f?.category ?? "").toLowerCase()}`;

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
  return { ok: missing.length === 0 && incomplete.length === 0, missing, incomplete, expected };
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
  if (!gate.ok) return Object.freeze({ ok: false, parentWorkId, missing: gate.missing, incomplete: gate.incomplete, ...(gate.reason ? { reason: gate.reason } : {}) });

  // Group every reported finding by identity across all children.
  const groups = new Map();
  let totalReported = 0;
  for (const c of children) {
    for (const f of Array.isArray(c.findings) ? c.findings : []) {
      totalReported++;
      const key = findingKey(f);
      // Carry symbol + the stable issue discriminator through consolidation so the reconcile step downstream can
      // fingerprint against the findings register (without them a finding fails closed → surfaces for disposition).
      const g = groups.get(key) || { key, file: normPath(f.file), line: f.line ?? null, category: f.category ?? null, symbol: f.symbol ?? null, discriminator: f.discriminator ?? null, reports: [] };
      g.reports.push({ requestId: c.requestId, sector: c.sector ?? null, severity: f.severity ?? null, summary: f.summary ?? null, verdict: f.verdict ?? null });
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
    const canonical = Object.freeze({ key: g.key, file: g.file, line: g.line, category: g.category, symbol: g.symbol, discriminator: g.discriminator, severity, agreedBy, sectors });
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
