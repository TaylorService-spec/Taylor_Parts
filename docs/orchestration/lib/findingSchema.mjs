// Structured finding contract — what an audit worker (or a disposition step) must emit so a finding can flow
// through consolidation → the findings register without falling back to "surface everything". A finding is only
// dedup-able and verifiable when it carries a stable location, a stable issue discriminator, a severity, a
// category, and concrete evidence. This module is the fail-closed gate on that contract: anything missing the
// load-bearing fields is INVALID (never silently accepted as a vague finding).
//
// Pure, deterministic. `validateFinding` returns {ok, errors}; `normalizeFinding` returns the canonical shape
// consumed downstream (file+symbol+discriminator identity for fingerprinting, plus severity/category/evidence).

export const SEVERITIES = Object.freeze(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

// A repo-relative path — not absolute, no traversal, forward slashes.
const REPO_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+$/;
// The stable issue discriminator: a lowercase kebab slug (e.g. "no-technician-availability-check"). Stable across
// audits precisely because it is a deliberate identity, not the drifting prose/line — 3..80 chars.
const DISCRIMINATOR = /^[a-z0-9]([a-z0-9-]{1,78})[a-z0-9]$/;

const norm = (s) => String(s ?? "").trim();
const normPath = (p) => norm(p).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");

/**
 * Validate one structured finding against the contract. Required: `file` (repo-relative), `discriminator`
 * (stable slug), `severity` (one of SEVERITIES), `category` (non-empty), `evidence` (non-empty — a finding
 * without evidence can't be verified or dispositioned). `symbol` is optional but recommended (sharper identity).
 * @returns {{ ok:boolean, errors:string[] }}
 */
export function validateFinding(f = {}) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(f && typeof f === "object" && !Array.isArray(f), "finding must be an object");
  if (!f || typeof f !== "object") return { ok: false, errors };
  need(typeof f.file === "string" && REPO_PATH.test(normPath(f.file)), "file must be a repo-relative path (no absolute, no '..')");
  need(typeof f.discriminator === "string" && DISCRIMINATOR.test(norm(f.discriminator)), "discriminator must be a stable lowercase-kebab slug (3-80 chars) — the issue identity");
  need(SEVERITIES.includes(f.severity), `severity must be one of ${SEVERITIES.join("/")}`);
  need(typeof f.category === "string" && norm(f.category).length > 0, "category is required");
  need(typeof f.evidence === "string" && norm(f.evidence).length > 0, "evidence is required (a finding must be verifiable)");
  if (f.symbol != null) need(typeof f.symbol === "string" && norm(f.symbol).length > 0, "symbol, when present, must be a non-empty string");
  if (f.line != null) need(Number.isInteger(f.line) && f.line > 0, "line, when present, must be a positive integer");
  return { ok: errors.length === 0, errors };
}

/** Canonical shape consumed by consolidation/reconcile. Assumes the finding already passed validateFinding. */
export function normalizeFinding(f) {
  return Object.freeze({
    file: normPath(f.file),
    symbol: f.symbol != null ? norm(f.symbol) : null,
    discriminator: norm(f.discriminator),
    severity: f.severity,
    category: norm(f.category),
    evidence: norm(f.evidence),
    line: f.line ?? null,
  });
}

/**
 * Validate a batch of worker findings. Fail-closed: invalid findings are separated out (with their errors), never
 * silently passed through. Only `valid` (normalized) findings are safe to consolidate/reconcile.
 * @returns {{ valid:Array, invalid:Array<{finding, errors}> }}
 */
export function validateFindings(findings = []) {
  const valid = [], invalid = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    const r = validateFinding(f);
    if (r.ok) valid.push(normalizeFinding(f));
    else invalid.push({ finding: f, errors: r.errors });
  }
  return { valid: Object.freeze(valid), invalid: Object.freeze(invalid) };
}

// The machine-readable block an audit worker emits alongside its human report. A single fenced code block tagged
// `eos-findings` containing a JSON array of findings (see the contract in docs/orchestration/findings/output-
// contract.md). This is the bridge from worker OUTPUT to the dedup-able consolidation INPUT.
const FINDINGS_BLOCK = /```eos-findings\s*\n([\s\S]*?)\n```/;

/**
 * Extract structured findings from a worker's result content. Finds the single `eos-findings` JSON block, parses
 * it, and validates each finding against the contract. Fail-closed and total (never throws):
 *   - no block            → { found:false, findings:[], invalid:[], reason:"no eos-findings block" }
 *   - block but bad JSON  → { found:false, ..., reason:"invalid JSON in eos-findings block" }
 *   - block parses        → { found:true, findings:[valid, normalized], invalid:[{finding,errors}] }
 * A worker that emits no/invalid block yields no structured findings, so downstream the child's findings are
 * empty and reconcile fail-closes (surfaces for disposition) — never a silent, unverifiable pass.
 */
export function extractFindings(content = "") {
  const text = typeof content === "string" ? content : "";
  const m = FINDINGS_BLOCK.exec(text);
  if (!m) return Object.freeze({ found: false, findings: Object.freeze([]), invalid: Object.freeze([]), reason: "no eos-findings block" });
  let parsed;
  try { parsed = JSON.parse(m[1]); }
  catch { return Object.freeze({ found: false, findings: Object.freeze([]), invalid: Object.freeze([]), reason: "invalid JSON in eos-findings block" }); }
  if (!Array.isArray(parsed)) return Object.freeze({ found: false, findings: Object.freeze([]), invalid: Object.freeze([]), reason: "eos-findings block must be a JSON array" });
  const { valid, invalid } = validateFindings(parsed);
  return Object.freeze({ found: true, findings: valid, invalid });
}

/**
 * Build the consolidation-input shape for one executed child from its raw result content — the wiring point that
 * turns worker output into a dedup-able consolidation child. `findings` are the extracted+validated structured
 * findings (empty if the worker emitted none/invalid — which fail-closes downstream, by design).
 */
export function childFromResult({ requestId, disposition = "COMPLETE", sector = null, content = "" } = {}) {
  const ex = extractFindings(content);
  return Object.freeze({ requestId, disposition, sector, findings: ex.findings, findingsExtraction: Object.freeze({ found: ex.found, invalidCount: ex.invalid.length, reason: ex.reason ?? null }) });
}
